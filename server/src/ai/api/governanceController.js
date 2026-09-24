// Backend Phase 9 — usage, prices, budgets, governed actions, evaluations
// and the AI audit log.
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { guard, notFound, versionConflict, checkVersion, invalid, page } from "./common.js";
import { aiAudit } from "../common/audit.js";
import { SIMULATOR_LABEL } from "../common/mode.js";
import { getAiPolicy } from "../policy/policyService.js";
import { ESTIMATE_LABEL, budgetStatus, periodKey, periodWindow } from "../usage/usageService.js";
import { previewAction, confirmProposal, approveProposal, rejectProposal, cancelProposal, undoProposal, loadProposal, serializeProposal } from "../actions/actionService.js";
import { ACTION_TYPES, PROHIBITED } from "../actions/actionTypes.js";
import { startEvaluationRun } from "../evaluations/evaluationService.js";
import { USE_CASES } from "../catalog.js";

const orgWide = (req) => hasGrant(req, "ai_usage", "view_organization");
const num = (v) => (v === null || v === undefined ? null : Number(v));

// ---- Usage ---------------------------------------------------------------------------

function usageWhere(req) {
  const q = req.query;
  const where = { organizationId: req.organizationId };
  if (!orgWide(req)) where.membershipId = req.membership?.id || "none";
  else if (q.membershipId) where.membershipId = String(q.membershipId);
  if (q.useCaseKey) where.useCaseKey = String(q.useCaseKey);
  if (q.requestId) where.requestId = String(q.requestId);
  if (q.providerKey) where.providerKey = String(q.providerKey);
  if (q.from || q.to) where.createdAt = { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lte: new Date(q.to) }) };
  return where;
}

export const listUsage = guard(async (req, res) => {
  const p = page(req.query);
  const where = usageWhere(req);
  const [rows, total] = await Promise.all([prisma.aiUsageRecord.findMany({ where, orderBy: { createdAt: "desc" }, take: p.take, skip: p.skip }), prisma.aiUsageRecord.count({ where })]);
  res.json({
    usage: rows.map((u) => ({ ...u, _id: u.id, estimatedCost: num(u.estimatedCost), costLabel: u.costKnown ? ESTIMATE_LABEL : "Cost unknown", simulatorLabel: u.mode === "Simulator" ? SIMULATOR_LABEL : null })),
    total, page: p.page, pageSize: p.pageSize, scope: orgWide(req) ? "Organization" : "Own",
  });
});

export const usageSummary = guard(async (req, res) => {
  const period = req.query.period === "Daily" ? "Daily" : "Monthly";
  const key = String(req.query.periodKey || periodKey(period));
  const { start, end } = periodWindow(period, key);
  const where = { ...usageWhere(req), createdAt: { gte: start, lt: end } };
  const group = (by) => prisma.aiUsageRecord.groupBy({ by, where, _sum: { inputTokens: true, outputTokens: true, cachedTokens: true, requests: true, estimatedCost: true }, _count: { _all: true } });
  const [byProvider, byUseCase, unknown, policy, budgets] = await Promise.all([
    group(["providerKey", "modelId", "mode"]), group(["useCaseKey"]),
    prisma.aiUsageRecord.count({ where: { ...where, costKnown: false } }),
    getAiPolicy(req.organizationId),
    hasGrant(req, "ai_budgets", "view") ? prisma.aiBudget.findMany({ where: { organizationId: req.organizationId, active: true } }) : [],
  ]);
  const fmt = (g) => ({ requests: g._sum.requests || 0, inputTokens: g._sum.inputTokens || 0, outputTokens: g._sum.outputTokens || 0, cachedTokens: g._sum.cachedTokens || 0, estimatedCost: num(g._sum.estimatedCost) || 0 });
  res.json({
    period, periodKey: key, scope: orgWide(req) ? "Organization" : "Own", costLabel: ESTIMATE_LABEL, requestsWithUnknownCost: unknown,
    providerStorageEnabled: policy.providerStorage === true,
    byProvider: byProvider.map((g) => ({ providerKey: g.providerKey, modelId: g.modelId, mode: g.mode, simulatorLabel: g.mode === "Simulator" ? SIMULATOR_LABEL : null, ...fmt(g) })),
    byUseCase: byUseCase.map((g) => ({ useCaseKey: g.useCaseKey, label: USE_CASES[g.useCaseKey]?.label || g.useCaseKey, ...fmt(g) })),
    budgets: await Promise.all(budgets.map(async (b) => ({ _id: b.id, scope: b.scope, scopeRef: b.scopeRef, period: b.period, currency: b.currency, ...(await budgetStatus(b)) }))),
  });
});

// ---- Price tables ----------------------------------------------------------------------

const serializeTable = async (t) => ({
  _id: t.id, providerKey: t.providerKey, organizationSpecific: !!t.organizationId, version: t.version, currency: t.currency, unit: t.unit, effectiveFrom: t.effectiveFrom, sourceNote: t.sourceNote, status: t.status,
  entries: (await prisma.aiPriceEntry.findMany({ where: { priceTableId: t.id }, orderBy: { modelId: "asc" } })).map((e) => ({ modelId: e.modelId, inputPrice: num(e.inputPrice), outputPrice: num(e.outputPrice), cachedInputPrice: num(e.cachedInputPrice) })),
  label: ESTIMATE_LABEL,
});

export const listPriceTables = guard(async (req, res) => {
  const tables = await prisma.aiPriceTable.findMany({ where: { status: "Active", OR: [{ organizationId: req.organizationId }, { organizationId: null }] }, orderBy: [{ providerKey: "asc" }, { organizationId: "asc" }] });
  res.json({ priceTables: await Promise.all(tables.map(serializeTable)), note: "Prices are estimates for budgeting. Your provider's invoice is authoritative." });
});

export const putPriceTable = guard(async (req, res) => {
  const providerKey = req.params.provider;
  if (!(await prisma.aiProvider.findUnique({ where: { key: providerKey } }))) throw invalid("Unknown AI provider.");
  const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
  if (!entries.length) throw invalid("Send entries: [{ modelId, inputPrice, outputPrice, cachedInputPrice }] per million tokens.");
  const sourceNote = String(req.body.sourceNote || "").trim();
  if (!sourceNote) throw invalid("sourceNote is required (where the prices come from).");
  const clean = entries.map((e) => {
    const vals = [e.inputPrice, e.outputPrice].map(Number);
    if (!e.modelId || vals.some((v) => !Number.isFinite(v) || v < 0)) throw invalid("Each entry needs modelId and non-negative inputPrice and outputPrice.");
    const cached = e.cachedInputPrice === undefined || e.cachedInputPrice === null ? null : Number(e.cachedInputPrice);
    if (cached !== null && (!Number.isFinite(cached) || cached < 0)) throw invalid("cachedInputPrice must be non-negative.");
    return { modelId: String(e.modelId).slice(0, 120), inputPrice: vals[0], outputPrice: vals[1], cachedInputPrice: cached };
  });
  const last = await prisma.aiPriceTable.findFirst({ where: { organizationId: req.organizationId, providerKey }, orderBy: { version: "desc" } });
  const table = await prisma.$transaction(async (tx) => {
    await tx.aiPriceTable.updateMany({ where: { organizationId: req.organizationId, providerKey, status: "Active" }, data: { status: "Superseded" } });
    const t = await tx.aiPriceTable.create({ data: { organizationId: req.organizationId, providerKey, version: (last?.version || 0) + 1, currency: String(req.body.currency || "USD").slice(0, 3).toUpperCase(), unit: "per_million_tokens", effectiveFrom: new Date(), sourceNote: sourceNote.slice(0, 500), createdByMembershipId: req.membership?.id || null } });
    for (const e of clean) await tx.aiPriceEntry.create({ data: { priceTableId: t.id, ...e } });
    return t;
  });
  await aiAudit(req, "ai.price_table.changed", "AiPriceTable", table.id, { after: { providerKey, version: table.version, entries: clean.length } });
  res.json({ priceTable: await serializeTable(table) });
});

// ---- Budgets ------------------------------------------------------------------------------

const SCOPES = ["Organization", "Use Case", "User", "Provider"];
function budgetData(body, partial = false) {
  const data = {};
  if (!partial || "scope" in body) { if (!SCOPES.includes(body.scope)) throw invalid(`scope: ${SCOPES.join(", ")}.`); data.scope = body.scope; }
  if (!partial || "scopeRef" in body) data.scopeRef = body.scope === "Organization" ? null : String(body.scopeRef || "").slice(0, 120) || null;
  if (data.scope && data.scope !== "Organization" && !data.scopeRef) throw invalid("scopeRef is required for this scope.");
  if (data.scope === "Use Case" && !USE_CASES[data.scopeRef]) throw invalid("Unknown use case.");
  if (!partial || "period" in body) { if (!["Daily", "Monthly"].includes(body.period || "Monthly")) throw invalid("period: Daily or Monthly."); data.period = body.period || "Monthly"; }
  for (const k of ["softLimit", "hardLimit"]) if (!partial || k in body) { const n = Number(body[k]); if (!Number.isFinite(n) || n < 0) throw invalid(`${k} must be a non-negative amount.`); data[k] = n; }
  if ("currency" in body || !partial) data.currency = String(body.currency || "USD").slice(0, 3).toUpperCase();
  if ("notifyMembershipIds" in body) data.notifyMembershipIds = Array.isArray(body.notifyMembershipIds) ? body.notifyMembershipIds.map(String).slice(0, 20) : [];
  if ("active" in body) data.active = body.active === true;
  return data;
}

export const listBudgets = guard(async (req, res) => {
  const rows = await prisma.aiBudget.findMany({ where: { organizationId: req.organizationId }, orderBy: { createdAt: "asc" } });
  res.json({ budgets: await Promise.all(rows.map(async (b) => ({ ...b, _id: b.id, softLimit: num(b.softLimit), hardLimit: num(b.hardLimit), status: b.active ? await budgetStatus(b) : null }))), label: ESTIMATE_LABEL });
});

export const createBudget = guard(async (req, res) => {
  const data = budgetData(req.body);
  if (data.softLimit > data.hardLimit) throw invalid("The soft limit must not exceed the hard limit.");
  const b = await prisma.aiBudget.create({ data: { ...data, organizationId: req.organizationId, createdByMembershipId: req.membership?.id || null } });
  await aiAudit(req, "ai.budget.created", "AiBudget", b.id, { after: { ...data } });
  res.status(201).json({ budget: { ...b, _id: b.id, softLimit: num(b.softLimit), hardLimit: num(b.hardLimit), status: await budgetStatus(b) } });
});

export const updateBudget = guard(async (req, res) => {
  const b = await prisma.aiBudget.findFirst({ where: { id: req.params.id, organizationId: req.organizationId } });
  if (!b) return notFound(res, "Budget");
  if (!checkVersion(req.body, b)) return versionConflict(res, "budget");
  const data = budgetData({ scope: b.scope, scopeRef: b.scopeRef, ...req.body }, true);
  const soft = data.softLimit ?? Number(b.softLimit); const hard = data.hardLimit ?? Number(b.hardLimit);
  if (soft > hard) throw invalid("The soft limit must not exceed the hard limit.");
  const updated = await prisma.aiBudget.update({ where: { id: b.id }, data: { ...data, version: { increment: 1 }, ...(hard > Number(b.hardLimit) && { exhaustedPeriodKey: null }) } });
  if (b.scope === "Provider" && hard > Number(b.hardLimit)) await prisma.aiProviderConnection.updateMany({ where: { organizationId: req.organizationId, providerKey: b.scopeRef, status: "Budget Exhausted" }, data: { status: "Connected" } });
  await aiAudit(req, "ai.budget.changed", "AiBudget", b.id, { before: { softLimit: num(b.softLimit), hardLimit: num(b.hardLimit), active: b.active }, after: data });
  res.json({ budget: { ...updated, _id: updated.id, softLimit: num(updated.softLimit), hardLimit: num(updated.hardLimit), status: await budgetStatus(updated) } });
});

// ---- Governed actions ----------------------------------------------------------------------

export const listActions = guard(async (req, res) => {
  const p = page(req.query);
  const where = { organizationId: req.organizationId, ...(req.query.status && { status: String(req.query.status) }) };
  if (!hasGrant(req, "ai_actions", "approve")) where.proposedByMembershipId = req.membership?.id || "none";
  const [rows, total] = await Promise.all([prisma.aiActionProposal.findMany({ where, orderBy: { createdAt: "desc" }, take: p.take, skip: p.skip }), prisma.aiActionProposal.count({ where })]);
  res.json({
    actions: rows.map((r) => serializeProposal(r, req)), total, page: p.page, pageSize: p.pageSize,
    actionTypes: Object.entries(ACTION_TYPES).map(([k, d]) => ({ key: k, label: d.label, targets: d.targets, requiredPermission: `${d.grant[0]}:${d.grant[1]}`, undoable: !!d.undo })),
    prohibited: Object.entries(PROHIBITED).map(([k, [what, who]]) => ({ key: k, what, authorized: who })),
  });
});

export const previewActionHandler = guard(async (req, res) => {
  const p = await previewAction(req, { ...req.body, source: req.body.source === "Model" ? "Model" : "User" });
  res.status(201).json({ action: serializeProposal(p, req), note: "Nothing has changed yet. Review, then confirm." });
});

const withProposal = (fn) => guard(async (req, res) => {
  const p = await loadProposal(req, req.params.id);
  if (!p) return notFound(res, "Action proposal");
  if (!hasGrant(req, "ai_actions", "approve") && p.proposedByMembershipId !== req.membership?.id && req.method === "GET") return notFound(res, "Action proposal");
  const next = await fn(req, p);
  res.json({ action: serializeProposal(next, req) });
});

export const getAction = withProposal(async (_req, p) => p);
export const confirmAction = withProposal((req, p) => confirmProposal(req, p));
export const approveAction = withProposal((req, p) => approveProposal(req, p, req.body?.reason));
export const rejectAction = withProposal((req, p) => rejectProposal(req, p, req.body?.reason));
export const cancelAction = withProposal((req, p) => cancelProposal(req, p));
export const undoAction = withProposal((req, p) => undoProposal(req, p));

// ---- Evaluations -------------------------------------------------------------------------

export const listScenarios = guard(async (req, res) => {
  const rows = await prisma.aiEvaluationScenario.findMany({ where: { active: true, OR: [{ organizationId: null }, { organizationId: req.organizationId }] }, orderBy: [{ useCaseKey: "asc" }, { name: "asc" }] });
  const last = await prisma.aiEvaluationResult.findMany({ where: { organizationId: req.organizationId, scenarioId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "desc" } });
  res.json({ scenarios: rows.map((s) => ({ ...s, _id: s.id, platform: !s.organizationId, lastResult: last.find((r) => r.scenarioId === s.id) || null })) });
});

export const createScenario = guard(async (req, res) => {
  const { useCaseKey, name, input, expectations } = req.body || {};
  if (!["overview.narrative", "overview.explore", "action.proposal"].includes(useCaseKey)) throw invalid("useCaseKey: overview.narrative, overview.explore or action.proposal.");
  if (!name || !input || typeof input !== "object" || !expectations || typeof expectations !== "object") throw invalid("name, input and expectations are required.");
  for (const p of expectations.forbiddenPatterns || []) { try { new RegExp(p); } catch { throw invalid(`Invalid pattern: ${p}`); } }
  const s = await prisma.aiEvaluationScenario.create({ data: { organizationId: req.organizationId, useCaseKey, name: String(name).slice(0, 200), input, expectations, createdByMembershipId: req.membership?.id || null } });
  await aiAudit(req, "ai.evaluation.scenario_created", "AiEvaluationScenario", s.id, { after: { useCaseKey, name: s.name } });
  res.status(201).json({ scenario: { ...s, _id: s.id } });
});

export const createRun = guard(async (req, res) => {
  const run = await startEvaluationRun(req, { providerKey: req.body.providerKey || null, alias: req.body.alias || null, scenarioIds: Array.isArray(req.body.scenarioIds) ? req.body.scenarioIds : [] });
  await aiAudit(req, "ai.evaluation.run_started", "AiEvaluationRun", run.id, { after: { scenarios: run.scenarioIds.length, providerKey: req.body.providerKey || "routing" } });
  res.status(202).json({ run: { ...run, _id: run.id }, note: "Evaluation runs use the organization's AI budget." });
});

export const listRuns = guard(async (req, res) => {
  const rows = await prisma.aiEvaluationRun.findMany({ where: { organizationId: req.organizationId }, orderBy: { createdAt: "desc" }, take: 50 });
  res.json({ runs: rows.map((r) => ({ ...r, _id: r.id, estimatedCost: num(r.estimatedCost) })) });
});

export const getRun = guard(async (req, res) => {
  const run = await prisma.aiEvaluationRun.findFirst({ where: { id: req.params.id, organizationId: req.organizationId } });
  if (!run) return notFound(res, "Evaluation run");
  const results = await prisma.aiEvaluationResult.findMany({ where: { runId: run.id }, orderBy: { createdAt: "asc" } });
  res.json({ run: { ...run, _id: run.id, estimatedCost: num(run.estimatedCost), simulatorLabel: run.mode === "Simulator" ? SIMULATOR_LABEL : null }, results: results.map((r) => ({ ...r, _id: r.id })) });
});

// ---- Audit ----------------------------------------------------------------------------------

export const listAiAudit = guard(async (req, res) => {
  const p = page(req.query);
  const where = { organizationId: req.organizationId, action: { startsWith: req.query.action ? String(req.query.action) : "ai." } };
  const [rows, total] = await Promise.all([prisma.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: p.take, skip: p.skip }), prisma.auditEvent.count({ where })]);
  res.json({ auditEvents: rows.map((e) => ({ _id: e.id, action: e.action, targetType: e.targetType, targetId: e.targetId, result: e.result, reason: e.reason, actorMembershipId: e.actorMembershipId, createdAt: e.createdAt, after: e.afterData, before: e.beforeData })), total, page: p.page, pageSize: p.pageSize });
});
