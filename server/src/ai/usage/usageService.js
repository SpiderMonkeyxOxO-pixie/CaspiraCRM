// Backend Phase 9 — usage ledger, cost estimation and budgets.
//
// The organization pays its AI provider directly. The CRM records the
// provider-reported usage and ESTIMATES cost from a versioned price table
// ("Estimated — not a provider invoice"). A model without a price shows
// "Cost unknown", never zero.
//
// Budgets (Organization, Use Case, User, Provider; daily or monthly) are
// enforced with reservations: before a request, the maximum possible cost
// is reserved on every applicable budget under a per-budget lock; a hard
// limit that would be exceeded refuses the request. After the request the
// reservation is reconciled with the actual estimate and the rest released.
import prisma from "../../lib/prisma.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { recordOutboxEvent } from "../../services/outboxService.js";
import { recordAuditEvent } from "../../services/auditService.js";

export const ESTIMATE_LABEL = "Estimated — not a provider invoice";
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// ---- Prices -----------------------------------------------------------------------

export async function getPriceFor(organizationId, providerKey, modelId, db = prisma) {
  if (!providerKey || !modelId) return null;
  const tables = await db.aiPriceTable.findMany({ where: { providerKey, status: "Active", OR: [{ organizationId }, { organizationId: null }] }, orderBy: [{ organizationId: "asc" }, { version: "desc" }] });
  // Organization table first, then the platform default.
  for (const table of [...tables.filter((t) => t.organizationId), ...tables.filter((t) => !t.organizationId)]) {
    const entry = await db.aiPriceEntry.findUnique({ where: { priceTableId_modelId: { priceTableId: table.id, modelId } } });
    if (entry) return { table, entry: { inputPrice: Number(entry.inputPrice), outputPrice: Number(entry.outputPrice), cachedInputPrice: entry.cachedInputPrice === null ? null : Number(entry.cachedInputPrice) } };
  }
  return null;
}

export function estimateCost(price, usage) {
  if (!price) return null;
  const { inputPrice, outputPrice, cachedInputPrice } = price.entry;
  const cached = Math.min(usage.cachedTokens || 0, usage.inputTokens || 0);
  const uncached = (usage.inputTokens || 0) - cached;
  return round6((uncached * inputPrice + cached * (cachedInputPrice ?? inputPrice) + (usage.outputTokens || 0) * outputPrice) / 1_000_000);
}

// Worst case for a request: all input uncached, the full output limit used.
export const maxCostFor = (price, { inputChars, maxOutputTokens }) => estimateCost(price, { inputTokens: Math.ceil(inputChars / 3), outputTokens: maxOutputTokens, cachedTokens: 0 });

export async function recordUsage({ organizationId, membershipId = null, requestId = null, useCaseKey, providerKey, modelId, alias, mode, usage, price, outcome, errorCategory = null, durationMs = null, correlationId = null, capabilityKey = null, releaseId = null, promptVersion = null, billingSource = null }, db = prisma) {
  const cost = estimateCost(price, usage);
  return db.aiUsageRecord.create({
    data: {
      organizationId, membershipId, requestId, useCaseKey, providerKey, modelId, alias, mode,
      inputTokens: usage?.inputTokens || 0, outputTokens: usage?.outputTokens || 0, cachedTokens: usage?.cachedTokens || 0,
      estimatedCost: cost, currency: price?.table.currency || "USD", costKnown: cost !== null,
      priceTableId: price?.table.id || null, priceTableVersion: price?.table.version ?? null,
      outcome, errorCategory, durationMs, correlationId,
      // Phase 11 attribution; a simulator call is never organization-key spend.
      capabilityKey, releaseId, promptVersion, billingSource: billingSource || (mode === "Simulator" ? "Simulator" : "Organization key"),
    },
  });
}

// ---- Budgets -----------------------------------------------------------------------

export function periodKey(period, date = new Date()) {
  const iso = date.toISOString();
  return period === "Daily" ? iso.slice(0, 10) : iso.slice(0, 7);
}

export function periodWindow(period, key) {
  const start = new Date(period === "Daily" ? `${key}T00:00:00.000Z` : `${key}-01T00:00:00.000Z`);
  const end = new Date(start);
  if (period === "Daily") end.setUTCDate(end.getUTCDate() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

const scopeWhere = (budget) => ({
  organizationId: budget.organizationId,
  ...(budget.scope === "Use Case" && { useCaseKey: budget.scopeRef }),
  ...(budget.scope === "User" && { membershipId: budget.scopeRef }),
  ...(budget.scope === "Provider" && { providerKey: budget.scopeRef }),
});

export async function applicableBudgets(organizationId, { useCaseKey, membershipId, providerKey }, db = prisma) {
  const all = await db.aiBudget.findMany({ where: { organizationId, active: true } });
  return all.filter((b) => b.scope === "Organization"
    || (b.scope === "Use Case" && b.scopeRef === useCaseKey)
    || (b.scope === "User" && b.scopeRef === membershipId)
    || (b.scope === "Provider" && b.scopeRef === providerKey));
}

// Spent (usage estimates) + held reservations in the budget's current period.
export async function budgetStatus(budget, now = new Date(), db = prisma) {
  const key = periodKey(budget.period, now);
  const { start, end } = periodWindow(budget.period, key);
  const [spent, held, unknown] = await Promise.all([
    db.aiUsageRecord.aggregate({ where: { ...scopeWhere(budget), createdAt: { gte: start, lt: end } }, _sum: { estimatedCost: true } }),
    db.aiBudgetReservation.aggregate({ where: { budgetId: budget.id, periodKey: key, status: "Held" }, _sum: { amount: true } }),
    db.aiUsageRecord.count({ where: { ...scopeWhere(budget), createdAt: { gte: start, lt: end }, costKnown: false } }),
  ]);
  const s = Number(spent._sum.estimatedCost || 0);
  const h = Number(held._sum.amount || 0);
  const hard = Number(budget.hardLimit);
  const soft = Number(budget.softLimit);
  return {
    periodKey: key, periodStart: start, periodEnd: end, spent: round6(s), held: round6(h), remaining: round6(Math.max(0, hard - s - h)),
    softLimit: soft, hardLimit: hard, warning: s >= soft, exhausted: s >= hard, requestsWithUnknownCost: unknown, label: ESTIMATE_LABEL,
  };
}

// Reserves `amount` on every budget, or refuses. Returns reservation ids.
export async function reserveBudgets(budgets, amount, { requestId = null, now = new Date(), ttlMs = 15 * 60_000 } = {}, db = prisma) {
  if (!budgets.length) return [];
  if (amount === null) {
    // Unknown cost can't be checked against a limit; refuse only if a hard
    // limit is already reached.
    for (const b of budgets) {
      const st = await budgetStatus(b, now, db);
      if (st.spent >= st.hardLimit) throw budgetRefusal(b, st);
    }
    return [];
  }
  return db.$transaction(async (tx) => {
    const ids = [];
    for (const b of [...budgets].sort((x, y) => x.id.localeCompare(y.id))) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${b.id}`}))`;
      const st = await budgetStatus(b, now, tx);
      if (st.spent + st.held + amount > st.hardLimit) throw budgetRefusal(b, st);
      const r = await tx.aiBudgetReservation.create({ data: { organizationId: b.organizationId, budgetId: b.id, requestId, periodKey: st.periodKey, amount, expiresAt: new Date(now.getTime() + ttlMs) } });
      ids.push(r.id);
    }
    return ids;
  });
}

function budgetRefusal(budget, st) {
  return new AiError(CATEGORIES.BUDGET, `The ${budget.scope.toLowerCase()} AI budget for this ${budget.period === "Daily" ? "day" : "month"} would be exceeded (estimated ${st.spent} of ${st.hardLimit} ${budget.currency} used). Ask an administrator to raise the limit or wait for the next period.`, {
    details: { budgetId: budget.id, scope: budget.scope, spent: st.spent, held: st.held, hardLimit: st.hardLimit, periodKey: st.periodKey },
  });
}

export async function settleReservations(ids, actualAmount, db = prisma) {
  if (!ids?.length) return;
  await db.aiBudgetReservation.updateMany({ where: { id: { in: ids }, status: "Held" }, data: actualAmount === null ? { status: "Released" } : { status: "Reconciled", actualAmount } });
}

export async function expireReservations(now = new Date(), db = prisma) {
  return (await db.aiBudgetReservation.updateMany({ where: { status: "Held", expiresAt: { lt: now } }, data: { status: "Expired" } })).count;
}

// After usage is recorded: soft-limit warnings (once per period, through the
// notification outbox) and hard-limit exhaustion markers.
export async function checkThresholds(budgets, now = new Date(), db = prisma) {
  for (const b of budgets) {
    const st = await budgetStatus(b, now, db);
    if (st.warning && b.warnedPeriodKey !== st.periodKey) {
      await db.aiBudget.update({ where: { id: b.id }, data: { warnedPeriodKey: st.periodKey } });
      await recordOutboxEvent(db, { aggregateType: "AiBudget", aggregateId: b.id, eventType: "ai.budget.warning", payload: { organizationId: b.organizationId, scope: b.scope, scopeRef: b.scopeRef, periodKey: st.periodKey, spent: st.spent, softLimit: st.softLimit, hardLimit: st.hardLimit, notify: b.notifyMembershipIds, label: ESTIMATE_LABEL } });
      await recordAuditEvent({ organizationId: b.organizationId, action: "ai.budget.warning_reached", targetType: "AiBudget", targetId: b.id, result: "Success", after: { periodKey: st.periodKey, spent: st.spent, softLimit: st.softLimit } });
    }
    if (st.exhausted && b.exhaustedPeriodKey !== st.periodKey) {
      await db.aiBudget.update({ where: { id: b.id }, data: { exhaustedPeriodKey: st.periodKey } });
      if (b.scope === "Provider") await db.aiProviderConnection.updateMany({ where: { organizationId: b.organizationId, providerKey: b.scopeRef, status: { in: ["Connected", "Connected with Warnings"] } }, data: { status: "Budget Exhausted" } });
      await recordAuditEvent({ organizationId: b.organizationId, action: "ai.budget.hard_stop", targetType: "AiBudget", targetId: b.id, result: "Success", after: { periodKey: st.periodKey, spent: st.spent, hardLimit: st.hardLimit } });
    }
  }
}

// Period rollover: connections held at "Budget Exhausted" by a provider
// budget from an earlier period go back to Connected.
export async function resetBudgetPeriods(now = new Date(), db = prisma) {
  let restored = 0;
  const exhausted = await db.aiProviderConnection.findMany({ where: { status: "Budget Exhausted" } });
  for (const c of exhausted) {
    const budgets = await db.aiBudget.findMany({ where: { organizationId: c.organizationId, scope: "Provider", scopeRef: c.providerKey, active: true } });
    const stillOut = [];
    for (const b of budgets) if ((await budgetStatus(b, now, db)).exhausted) stillOut.push(b.id);
    if (!stillOut.length) { await db.aiProviderConnection.update({ where: { id: c.id }, data: { status: "Connected" } }); restored += 1; }
  }
  return restored;
}
