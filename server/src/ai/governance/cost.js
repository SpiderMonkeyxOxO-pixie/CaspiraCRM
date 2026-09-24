// Backend Phase 11 — cost governance. Keeps provider-reported usage,
// estimated provider cost, reconciled provider cost (invoices an
// administrator enters), internal allocation and customer charges distinct.
// No markup is ever added and nothing is invoiced or charged to customers.
import prisma from "../../lib/prisma.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { ESTIMATE_LABEL } from "../usage/usageService.js";

const bad = (m, status = 422) => Object.assign(new AiError(CATEGORIES.INVALID_REQUEST, m), { httpStatus: status });
const r6 = (n) => Math.round(n * 1e6) / 1e6;

export async function costGovernance(organizationId, { from, to } = {}) {
  const now = new Date();
  const start = from ? new Date(from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = to ? new Date(to) : now;
  const where = { organizationId, createdAt: { gte: start, lte: end } };
  const usage = await prisma.aiUsageRecord.findMany({ where, select: { estimatedCost: true, costKnown: true, inputTokens: true, outputTokens: true, providerKey: true, modelId: true, capabilityKey: true, membershipId: true, promptVersion: true, releaseId: true, billingSource: true, outcome: true, requestId: true, useCaseKey: true } });
  const sum = (rows) => r6(rows.reduce((a, u) => a + Number(u.estimatedCost || 0), 0));
  const by = (key, rows = usage) => Object.entries(rows.reduce((acc, u) => { const k = u[key] || "unattributed"; (acc[k] ||= []).push(u); return acc; }, {})).map(([k, rs]) => ({ key: k, requests: rs.length, inputTokens: rs.reduce((a, u) => a + u.inputTokens, 0), outputTokens: rs.reduce((a, u) => a + u.outputTokens, 0), estimatedCost: sum(rs), unknownCost: rs.filter((u) => !u.costKnown).length })).sort((a, b) => b.estimatedCost - a.estimatedCost);
  const live = usage.filter((u) => u.outcome !== "Shadow");
  const succeeded = live.filter((u) => u.outcome === "Succeeded");
  // Workflows: usage of the requests each workflow run's messages made.
  const runs = await prisma.aiWorkflowRun.findMany({ where: { organizationId, createdAt: { gte: start, lte: end } }, select: { templateKey: true, messageId: true } });
  const msgs = runs.length ? await prisma.aiCopilotMessage.findMany({ where: { id: { in: runs.map((r) => r.messageId).filter(Boolean) } }, select: { id: true, requestIds: true } }) : [];
  const reqToWorkflow = {};
  for (const r of runs) for (const id of msgs.find((m) => m.id === r.messageId)?.requestIds || []) reqToWorkflow[id] = r.templateKey;
  const byWorkflow = by("workflow", live.filter((u) => reqToWorkflow[u.requestId]).map((u) => ({ ...u, workflow: reqToWorkflow[u.requestId] })));
  const [validCitations, executedActions, invoices] = await Promise.all([
    prisma.aiCopilotCitation.count({ where: { organizationId, status: "Valid", createdAt: { gte: start, lte: end } } }),
    prisma.aiActionProposal.count({ where: { organizationId, status: "Executed", updatedAt: { gte: start, lte: end } } }),
    prisma.aiProviderInvoice.findMany({ where: { organizationId }, orderBy: { periodKey: "desc" }, take: 24 }),
  ]);
  const copilotCost = sum(live.filter((u) => (u.useCaseKey || "").startsWith("copilot")));
  const actionCost = sum(live.filter((u) => ["action.proposal", "copilot.chat"].includes(u.useCaseKey)));
  const total = sum(live);
  const daysElapsed = Math.max(1, (end - start) / 86_400_000);
  const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    window: { from: start, to: end },
    labels: { estimated: ESTIMATE_LABEL, reconciled: "Reconciled against provider invoices entered by an administrator", allocation: "Internal allocation (proportional to estimated usage; not a charge)", customerCharge: "No customer charge: there is no approved billing workflow, and no markup is added." },
    providerReported: { inputTokens: live.reduce((a, u) => a + u.inputTokens, 0), outputTokens: live.reduce((a, u) => a + u.outputTokens, 0), requests: live.length },
    estimated: { total, unknownCostRequests: live.filter((u) => !u.costKnown).length, shadow: sum(usage.filter((u) => u.outcome === "Shadow")) },
    byCapability: by("capabilityKey", live), byProvider: by("providerKey", live), byModel: by("modelId", live), byUser: by("membershipId", live), byPromptVersion: by("promptVersion", live), byRelease: by("releaseId", live), byWorkflow, byBillingSource: by("billingSource", usage),
    unitCosts: {
      perSuccessfulResponse: succeeded.length ? r6(sum(succeeded) / succeeded.length) : null, successfulResponses: succeeded.length,
      perValidatedCitation: validCitations ? r6(copilotCost / validCitations) : null, validatedCitations: validCitations,
      perApprovedAction: executedActions ? r6(actionCost / executedActions) : null, approvedActions: executedActions,
    },
    forecast: { monthEstimate: r6((total / daysElapsed) * daysInMonth), method: "Month-to-date estimate projected linearly; an estimate, not a commitment." },
    allocation: by("capabilityKey", live).map((c) => ({ capabilityKey: c.key, share: total ? Math.round((c.estimatedCost / total) * 10000) / 100 : 0, amount: c.estimatedCost })),
    byok: { organizationKeySpend: sum(usage.filter((u) => u.billingSource === "Organization key")), simulator: usage.filter((u) => u.billingSource === "Simulator").length, note: "Organization key (BYOK) spend is billed by the provider directly to the organization." },
    invoices: invoices.map((i) => ({ _id: i.id, providerKey: i.providerKey, periodKey: i.periodKey, invoicedAmount: Number(i.invoicedAmount), estimatedAmount: i.estimatedAmount === null ? null : Number(i.estimatedAmount), difference: i.difference === null ? null : Number(i.difference), currency: i.currency, status: i.status, reconciledAt: i.reconciledAt })),
    customerCharge: { amount: null, status: "Not billed" },
  };
}

// An administrator enters a provider invoice; the CRM compares it with the
// estimated organization-key spend for that provider and month.
export async function recordProviderInvoice(req, { providerKey, periodKey, invoicedAmount, currency = "USD", notes = null }) {
  if (!providerKey || !/^\d{4}-\d{2}$/.test(String(periodKey || ""))) throw bad("providerKey and periodKey (YYYY-MM) are required.");
  const amount = Number(invoicedAmount);
  if (!Number.isFinite(amount) || amount < 0) throw bad("invoicedAmount must be a non-negative number.");
  const start = new Date(`${periodKey}-01T00:00:00.000Z`);
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  const est = await prisma.aiUsageRecord.aggregate({ where: { organizationId: req.organizationId, providerKey, billingSource: "Organization key", createdAt: { gte: start, lt: end } }, _sum: { estimatedCost: true } });
  const estimated = r6(Number(est._sum.estimatedCost || 0));
  const difference = r6(amount - estimated);
  const status = amount === 0 && estimated === 0 ? "Reconciled" : Math.abs(difference) <= Math.max(0.01, amount * 0.05) ? "Reconciled" : "Needs review";
  const row = await prisma.aiProviderInvoice.upsert({
    where: { organizationId_providerKey_periodKey: { organizationId: req.organizationId, providerKey, periodKey } },
    update: { invoicedAmount: amount, currency, estimatedAmount: estimated, difference, status, notes, enteredByUserId: req.user?.id, reconciledAt: status === "Reconciled" ? new Date() : null },
    create: { organizationId: req.organizationId, providerKey, periodKey, invoicedAmount: amount, currency, estimatedAmount: estimated, difference, status, notes, enteredByUserId: req.user?.id, reconciledAt: status === "Reconciled" ? new Date() : null },
  });
  await aiAudit(req, "ai.cost.invoice_reconciled", "AiProviderInvoice", row.id, { after: { providerKey, periodKey, invoiced: amount, estimated, difference, status } });
  return row;
}
