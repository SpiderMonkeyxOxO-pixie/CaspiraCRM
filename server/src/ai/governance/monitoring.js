// Backend Phase 11 — AI monitoring: metrics (no prompts, no record labels),
// SLO measurements over defined windows, and alert rules with deduplication,
// cooldown, escalation, acknowledgement, resolution and suppression, sent
// through the existing notification outbox. Evaluation (synthetic) traffic is
// excluded from operational metrics.
import prisma from "../../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { recordOutboxEvent } from "../../services/outboxService.js";
import { CACHE_MS } from "./runtime.js";

const bad = (m, status = 422) => Object.assign(new AiError(CATEGORIES.INVALID_REQUEST, m), { httpStatus: status });
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const rate = (n, d) => (d ? Math.round((n / d) * 10000) / 100 : null);
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// Filters: organization (scope), provider, model, capability, prompt version,
// release, user (membership), severity. Department/team aren't modelled.
function requestWhere(scopeOrg, f = {}) {
  return {
    ...(scopeOrg && { organizationId: scopeOrg }), ...(f.providerKey && { providerKey: f.providerKey }), ...(f.modelId && { modelId: f.modelId }),
    ...(f.capabilityKey && { capabilityKey: f.capabilityKey }), ...(f.releaseId && { releaseId: f.releaseId }), ...(f.membershipId && { membershipId: f.membershipId }),
    createdAt: { gte: f.from || new Date(Date.now() - 24 * 3_600_000), ...(f.to && { lte: f.to }) },
  };
}

// → operational metrics for a window (safe aggregates only).
export async function computeMetrics(scopeOrg, f = {}) {
  const where = requestWhere(scopeOrg, f);
  const requests = await prisma.aiRequest.findMany({ where, select: { status: true, errorCategory: true, durationMs: true, validation: true, providerKey: true, modelId: true, capabilityKey: true, membershipId: true, mode: true, removedFields: true, injectionFlags: true, useCaseKey: true, createdAt: true, startedAt: true }, take: 20000 });
  const usage = await prisma.aiUsageRecord.findMany({ where: { ...where, NOT: { outcome: "Shadow" } }, select: { inputTokens: true, outputTokens: true, estimatedCost: true, costKnown: true, providerKey: true, modelId: true, capabilityKey: true, outcome: true, billingSource: true, releaseId: true, promptVersion: true, membershipId: true }, take: 50000 });
  const orgWhere = scopeOrg ? { organizationId: scopeOrg } : {};
  const since = where.createdAt;
  const [messages, tools, safety, incidents, proposals, feedback, indexQueued, indexFailed] = await Promise.all([
    prisma.aiCopilotMessage.findMany({ where: { ...orgWhere, role: "assistant", createdAt: since, conversationId: { notIn: (await prisma.aiCopilotConversation.findMany({ where: { ...orgWhere, status: "Evaluation" }, select: { id: true } })).map((c) => c.id) } }, select: { status: true, limitations: true, confidence: true } }),
    prisma.aiCopilotToolCall.groupBy({ by: ["status"], where: { ...orgWhere, createdAt: since }, _count: { _all: true } }),
    prisma.aiSafetyEvent.findMany({ where: { ...(scopeOrg ? { OR: [{ organizationId: scopeOrg }, { organizationId: null }] } : {}), createdAt: since, NOT: { source: { startsWith: "evaluation:" } }, ...(f.severity && { severity: f.severity }), ...(f.capabilityKey && { capabilityKey: f.capabilityKey }) }, select: { category: true, severity: true } }),
    prisma.aiIncident.findMany({ where: { scope: { in: scopeOrg ? [scopeOrg, "platform"] : undefined }, status: { notIn: ["Closed"] } }, select: { severity: true, status: true } }),
    prisma.aiActionProposal.groupBy({ by: ["status"], where: { ...orgWhere, createdAt: since }, _count: { _all: true } }),
    prisma.aiFeedback.groupBy({ by: ["rating"], where: { ...orgWhere, createdAt: since }, _count: { _all: true } }),
    prisma.aiIndexingJob.findFirst({ where: { ...orgWhere, status: "Queued" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.aiIndexingJob.count({ where: { ...orgWhere, status: "Failed", completedAt: since } }),
  ]);
  const done = requests.filter((r) => ["Completed", "Completed with Warnings", "Failed", "Refused", "Cancelled"].includes(r.status));
  const byStatus = (s) => requests.filter((r) => r.status === s).length;
  const providerErrors = requests.filter((r) => r.status === "Failed" && ["provider_unavailable", "timeout", "authentication", "rate_limited", "unknown"].includes(r.errorCategory)).length;
  const structured = requests.filter((r) => r.validation && ["overview.explore", "action.proposal", "copilot.plan", "copilot.answer", "evaluation.grade"].includes(r.useCaseKey));
  const validationFails = requests.filter((r) => r.validation && r.validation.ok === false).length;
  const toolCount = (s) => tools.find((t) => t.status === s)?._count._all || 0;
  const toolTotal = tools.reduce((a, t) => a + t._count._all, 0);
  const copilotDone = messages.filter((m) => !["Queued", "Classifying", "Retrieving", "Generating", "Validating"].includes(m.status));
  const citationFailed = copilotDone.filter((m) => (m.limitations || []).some((l) => /removed because/.test(l))).length;
  const retrievalLimited = copilotDone.filter((m) => (m.limitations || []).some((l) => /Text search/.test(l))).length;
  const cost = usage.reduce((a, u) => a + Number(u.estimatedCost || 0), 0);
  const group = (key) => Object.entries(usage.reduce((acc, u) => { const k = u[key] || "unattributed"; acc[k] ||= { requests: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0, unknownCost: 0 }; acc[k].requests += 1; acc[k].inputTokens += u.inputTokens; acc[k].outputTokens += u.outputTokens; acc[k].estimatedCost = round6(acc[k].estimatedCost + Number(u.estimatedCost || 0)); if (!u.costKnown) acc[k].unknownCost += 1; return acc; }, {})).map(([k, v]) => ({ key: k, ...v }));
  const firstProgress = requests.filter((r) => r.startedAt).map((r) => new Date(r.startedAt) - new Date(r.createdAt));
  return {
    window: { from: since.gte, to: since.lte || new Date() }, sampleSize: requests.length,
    requests: { total: requests.length, completed: byStatus("Completed") + byStatus("Completed with Warnings"), failed: byStatus("Failed"), refused: byStatus("Refused"), cancelled: byStatus("Cancelled"), queued: byStatus("Queued") },
    activeUsers: new Set(requests.map((r) => r.membershipId).filter(Boolean)).size,
    availability: rate(done.length - providerErrors, done.length), errorRate: rate(byStatus("Failed"), done.length), providerErrorRate: rate(providerErrors, done.length),
    refusalRate: rate(byStatus("Refused"), done.length), validationFailureRate: rate(validationFails, done.length), structuredValidityRate: rate(structured.filter((r) => r.validation.ok !== false).length, structured.length),
    latency: { p50Ms: pct(requests.map((r) => r.durationMs).filter(Boolean), 50), p95Ms: pct(requests.map((r) => r.durationMs).filter(Boolean), 95), firstProgressP95Ms: pct(firstProgress, 95) },
    copilot: { answers: copilotDone.length, successRate: rate(copilotDone.filter((m) => ["Completed", "Completed with limitations", "Refused", "Awaiting tool"].includes(m.status)).length, copilotDone.length), citationFailures: citationFailed, citationCleanRate: rate(copilotDone.length - citationFailed, copilotDone.length), retrievalLimited, lowConfidence: copilotDone.filter((m) => ["Low Confidence", "Insufficient Data"].includes(m.confidence)).length },
    tools: { total: toolTotal, succeeded: toolCount("Succeeded"), denied: toolCount("Denied"), failed: toolCount("Failed"), awaitingApproval: toolCount("Awaiting approval"), successRate: rate(toolCount("Succeeded"), toolCount("Succeeded") + toolCount("Failed")) },
    retrieval: { indexFailures: indexFailed, indexLagMinutes: indexQueued ? Math.round((Date.now() - indexQueued.createdAt) / 60000) : 0 },
    approvals: Object.fromEntries(proposals.map((p) => [p.status, p._count._all])),
    safety: { total: safety.length, bySeverity: safety.reduce((a, e) => ({ ...a, [e.severity]: (a[e.severity] || 0) + 1 }), {}), byCategory: safety.reduce((a, e) => ({ ...a, [e.category]: (a[e.category] || 0) + 1 }), {}) },
    incidents: { active: incidents.filter((i) => i.status !== "Resolved").length, bySeverity: incidents.reduce((a, i) => ({ ...a, [i.severity]: (a[i.severity] || 0) + 1 }), {}) },
    tokens: { input: usage.reduce((a, u) => a + u.inputTokens, 0), output: usage.reduce((a, u) => a + u.outputTokens, 0) },
    cost: { estimated: round6(cost), label: "Estimated — not a provider invoice", unknownCostRequests: usage.filter((u) => !u.costKnown).length },
    byProvider: group("providerKey"), byModel: group("modelId"), byCapability: group("capabilityKey"), byRelease: group("releaseId"), byPromptVersion: group("promptVersion"), byBillingSource: group("billingSource"),
    privacy: { redactedFieldRequests: requests.filter((r) => (r.removedFields || []).length).length, redactedFields: requests.reduce((a, r) => a + (r.removedFields || []).length, 0), injectionFlaggedRequests: requests.filter((r) => (r.injectionFlags || []).length).length },
    feedback: Object.fromEntries(feedback.map((x) => [x.rating, x._count._all])),
  };
}

// Privacy monitoring: what goes where, retention and deletion status.
export async function privacyStatus(organizationId) {
  const [policy, payloadsPending, providerStorage, evalDatasets] = await Promise.all([
    prisma.aiPolicy.findUnique({ where: { organizationId } }),
    prisma.aiRequest.count({ where: { organizationId, payloadExpiresAt: { lt: new Date() }, NOT: { payload: { equals: Prisma.DbNull } } } }),
    prisma.aiKillSwitch.findFirst({ where: { kind: "provider_storage", active: true, scope: { in: ["platform", organizationId] } } }),
    prisma.aiEvaluationDataset.count({ where: { OR: [{ organizationId }, { scope: "platform" }], source: "Production", status: "Active" } }),
  ]);
  const recent = await prisma.aiRequest.findMany({ where: { organizationId, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, select: { providerKey: true, mode: true, removedFields: true }, take: 5000 });
  const sentTo = recent.reduce((a, r) => { const k = r.providerKey || "none"; a[k] = (a[k] || 0) + 1; return a; }, {});
  return {
    providerStorageMode: policy?.providerStorage && !providerStorage ? "On (policy)" : "Off", providerStorageKillSwitch: !!providerStorage,
    providerHostedInventory: { files: 0, conversations: 0, note: "The CRM creates no provider-hosted files or conversations; retrieval and conversation state stay in the CRM database." },
    requestsByProvider7d: sentTo, redactedFields7d: recent.reduce((a, r) => a + (r.removedFields || []).length, 0),
    retention: policy?.retention || null, expiredPayloadsAwaitingDeletion: payloadsPending, productionEvaluationDatasets: evalDatasets,
    retrievalSources: await prisma.aiSourceChunk.groupBy({ by: ["recordType"], where: { organizationId }, _count: { _all: true } }).then((g) => g.map((x) => ({ recordType: x.recordType, chunks: x._count._all }))),
  };
}

// ---- SLOs ------------------------------------------------------------------------------

const SLO_VALUE = {
  gateway_success_rate: (m) => [m.availability, m.requests.total], copilot_success_rate: (m) => [m.copilot.successRate, m.copilot.answers],
  first_progress_p95_ms: (m) => [m.latency.firstProgressP95Ms, m.requests.total], completed_p95_ms: (m) => [m.latency.p95Ms, m.requests.total],
  provider_error_rate: (m) => [m.providerErrorRate, m.requests.total], structured_validity_rate: (m) => [m.structuredValidityRate, m.requests.total],
  citation_clean_rate: (m) => [m.copilot.citationCleanRate, m.copilot.answers], tool_success_rate: (m) => [m.tools.successRate, m.tools.succeeded + m.tools.failed],
  index_lag_minutes: (m) => [m.retrieval.indexLagMinutes, 1],
};

export async function measureSlos(now = new Date()) {
  const defs = await prisma.aiSloDefinition.findMany({ where: { active: true } });
  const out = [];
  for (const d of defs) {
    const windowStart = new Date(Math.floor((now.getTime() - d.windowMinutes * 60_000) / 60_000) * 60_000);
    let value = null; let sample = 0;
    if (SLO_VALUE[d.metric]) { const m = await computeMetrics(null, { from: windowStart, to: now }); [value, sample] = SLO_VALUE[d.metric](m); }
    else if (d.metric === "queue_delay_ms") { const q = await prisma.aiRequest.findFirst({ where: { status: "Queued" }, orderBy: { createdAt: "asc" } }); value = q ? now - q.createdAt : 0; sample = 1; }
    else if (d.metric === "usage_lag_minutes") { const u = await prisma.aiUsageRecord.findFirst({ orderBy: { createdAt: "desc" } }); const r = await prisma.aiRequest.findFirst({ where: { status: { in: ["Completed", "Completed with Warnings"] } }, orderBy: { completedAt: "desc" } }); value = u && r?.completedAt ? Math.max(0, Math.round((r.completedAt - u.createdAt) / 60000)) : 0; sample = r ? 1 : 0; }
    else if (d.metric === "incident_ack_minutes") { const inc = await prisma.aiIncident.findMany({ where: { createdAt: { gte: windowStart }, severity: { in: ["SEV-0", "SEV-1", "SEV-2"] } } }); const acks = inc.map((i) => ((i.acknowledgedAt || now) - i.createdAt) / 60000); value = acks.length ? Math.max(...acks) : null; sample = acks.length; }
    else if (d.metric === "kill_switch_propagation_seconds") { const acts = await prisma.auditEvent.findMany({ where: { action: "ai.kill_switch.activated", createdAt: { gte: windowStart } }, select: { afterData: true } }); const vals = acts.map((a) => Number(a.afterData?.maxPropagationMs ?? CACHE_MS) / 1000); value = vals.length ? Math.max(...vals) : null; sample = vals.length; }
    const status = value === null || value === undefined || !sample ? "Insufficient data" : (d.comparator === "gte" ? value >= Number(d.objective) : value <= Number(d.objective)) ? "Met" : "Missed";
    const row = await prisma.aiSloMeasurement.upsert({ where: { sloId_scope_windowStart: { sloId: d.id, scope: "platform", windowStart } }, update: { windowEnd: now, value, sampleSize: sample, status }, create: { sloId: d.id, scope: "platform", windowStart, windowEnd: now, value, sampleSize: sample, status } });
    out.push({ key: d.key, name: d.name, objective: Number(d.objective), comparator: d.comparator, unit: d.unit, windowMinutes: d.windowMinutes, value, sampleSize: sample, status, measuredAt: row.windowEnd });
  }
  return out;
}

// ---- Alerts -------------------------------------------------------------------------------

async function alertValue(rule, now) {
  const from = new Date(now - rule.windowMinutes * 60_000);
  const m = () => computeMetrics(null, { from, to: now });
  switch (rule.metric) {
    case "provider_error_rate": { const x = await m(); return [x.providerErrorRate, x.requests.total]; }
    case "validation_failure_rate": { const x = await m(); return [x.validationFailureRate, x.requests.total]; }
    case "citation_failure_rate": { const x = await m(); return [x.copilot.answers ? 100 - (x.copilot.citationCleanRate ?? 100) : null, x.copilot.answers]; }
    case "retrieval_failure_count": { const x = await m(); return [x.retrieval.indexFailures + x.copilot.retrievalLimited, 1]; }
    case "index_lag_minutes": { const x = await m(); return [x.retrieval.indexLagMinutes, 1]; }
    case "credential_failures": return [await prisma.aiProviderConnection.count({ where: { status: { in: ["Verification Failed", "Error"] }, updatedAt: { gte: from } } }), 1];
    case "rate_limited_count": return [await prisma.aiRequest.count({ where: { errorCategory: "rate_limited", createdAt: { gte: from } } }), 1];
    case "budget_warnings": return [await prisma.outboxEvent.count({ where: { eventType: "ai.budget.warning", createdAt: { gte: from } } }).catch(() => 0), 1];
    case "safety_events_medium_plus": return [await prisma.aiSafetyEvent.count({ where: { createdAt: { gte: from }, severity: { in: ["Medium", "High", "Critical"] }, NOT: { source: { startsWith: "evaluation:" } } } }), 1];
    case "cross_tenant_attempts": return [await prisma.aiSafetyEvent.count({ where: { createdAt: { gte: from }, category: "cross_tenant_attempt", NOT: { source: { startsWith: "evaluation:" } } } }), 1];
    case "approval_bypass_attempts": return [await prisma.aiSafetyEvent.count({ where: { createdAt: { gte: from }, category: "approval_bypass_attempt", NOT: { source: { startsWith: "evaluation:" } } } }), 1];
    case "evaluation_regressions": {
      const failed = await prisma.aiEvalRun.findMany({ where: { status: "Failed", completedAt: { gte: from } }, select: { suiteId: true, completedAt: true } });
      let n = 0;
      for (const f of failed) if (await prisma.aiEvalRun.findFirst({ where: { suiteId: f.suiteId, status: { in: ["Passed", "Passed with warnings"] }, completedAt: { lt: f.completedAt } } })) n += 1;
      return [n, 1];
    }
    case "models_deprecating": return [await prisma.aiModelGovernance.count({ where: { deprecationAt: { lte: new Date(now.getTime() + 30 * 86_400_000) }, releaseStatus: { notIn: ["Retired"] } } }), 1];
    case "release_failures": return [await prisma.aiRelease.count({ where: { status: "Evaluation failed", updatedAt: { gte: from } } }), 1];
    case "queue_backlog": return [await prisma.aiIndexingJob.count({ where: { status: "Queued" } }) + await prisma.aiRequest.count({ where: { status: "Queued", createdAt: { lt: new Date(now - 5 * 60_000) } } }), 1];
    case "cost_anomaly_ratio": {
      const hour = await prisma.aiUsageRecord.aggregate({ where: { createdAt: { gte: from } }, _sum: { estimatedCost: true } });
      const week = await prisma.aiUsageRecord.aggregate({ where: { createdAt: { gte: new Date(now - 7 * 86_400_000), lt: from } }, _sum: { estimatedCost: true } });
      const recent = Number(hour._sum.estimatedCost || 0);
      const baseline = Number(week._sum.estimatedCost || 0) / (7 * 24 - rule.windowMinutes / 60 || 1);
      return [recent >= 1 && baseline > 0 ? recent / baseline : recent >= 1 && baseline === 0 ? rule.threshold + 1 : 0, 1];
    }
    default: return [null, 0];
  }
}

// Opens (deduplicated), refreshes, escalates or auto-resolves alerts.
export async function evaluateAlerts(now = new Date()) {
  const rules = await prisma.aiAlertRule.findMany({ where: { active: true } });
  const out = { opened: 0, updated: 0, escalated: 0, resolved: 0, suppressed: 0 };
  for (const rule of rules) {
    const [value, sample] = await alertValue(rule, now);
    const breached = value !== null && sample >= (rule.minSamples || 1) && (rule.comparator === "lte" ? value <= Number(rule.threshold) : value >= Number(rule.threshold));
    const dedupeKey = `${rule.key}:platform`;
    const open = await prisma.aiAlertEvent.findFirst({ where: { dedupeKey, status: { in: ["Open", "Acknowledged"] } } });
    if (breached) {
      if (rule.suppressedUntil && rule.suppressedUntil > now) { out.suppressed += 1; continue; }
      if (open) {
        await prisma.aiAlertEvent.update({ where: { id: open.id }, data: { count: { increment: 1 }, lastAt: now, value } });
        out.updated += 1;
        if (open.status === "Open" && !open.escalatedAt && now - open.firstAt > rule.escalateAfterMinutes * 60_000) {
          await prisma.aiAlertEvent.update({ where: { id: open.id }, data: { escalatedAt: now } });
          await recordOutboxEvent(prisma, { aggregateType: "AiAlertEvent", aggregateId: open.id, eventType: "ai.alert.escalated", payload: { rule: rule.key, severity: rule.severity, notifyRoleKeys: ["super_admin", "admin"] } });
          out.escalated += 1;
        }
        continue;
      }
      const last = await prisma.aiAlertEvent.findFirst({ where: { dedupeKey }, orderBy: { lastAt: "desc" } });
      if (last && now - (last.resolvedAt || last.lastAt) < rule.cooldownMinutes * 60_000) { out.suppressed += 1; continue; }
      const ev = await prisma.aiAlertEvent.create({ data: { ruleId: rule.id, scope: "platform", dedupeKey, severity: rule.severity, value, summary: `${rule.name}: ${Math.round(value * 100) / 100} (threshold ${Number(rule.threshold)} over ${rule.windowMinutes} min).` } });
      await recordOutboxEvent(prisma, { aggregateType: "AiAlertEvent", aggregateId: ev.id, eventType: "ai.alert.opened", payload: { rule: rule.key, severity: rule.severity, value, notifyRoleKeys: rule.notifyRoleKeys } });
      await aiAudit({ user: null }, "ai.alert.opened", "AiAlertEvent", ev.id, { after: { rule: rule.key, severity: rule.severity, value } });
      out.opened += 1;
    } else if (open && open.status === "Open" && value !== null) {
      await prisma.aiAlertEvent.update({ where: { id: open.id }, data: { status: "Resolved", resolvedAt: now, note: "Resolved automatically: the condition cleared." } });
      out.resolved += 1;
    }
  }
  return out;
}

export async function acknowledgeAlert(req, id, { note }) {
  const a = await prisma.aiAlertEvent.findUnique({ where: { id: String(id) } });
  if (!a) throw bad("Alert not found.", 404);
  if (a.status !== "Open") throw bad(`This alert is ${a.status.toLowerCase()}.`);
  const u = await prisma.aiAlertEvent.update({ where: { id: a.id }, data: { status: "Acknowledged", acknowledgedByUserId: req.user?.id, acknowledgedAt: new Date(), note: note ? String(note).slice(0, 500) : a.note } });
  await aiAudit(req, "ai.alert.acknowledged", "AiAlertEvent", a.id, { before: { status: a.status }, after: { status: "Acknowledged" } });
  return u;
}

export async function resolveAlert(req, id, { note }) {
  const a = await prisma.aiAlertEvent.findUnique({ where: { id: String(id) } });
  if (!a) throw bad("Alert not found.", 404);
  if (a.status === "Resolved") throw bad("This alert is already resolved.");
  if (!note) throw bad("Say how it was resolved.");
  const u = await prisma.aiAlertEvent.update({ where: { id: a.id }, data: { status: "Resolved", resolvedByUserId: req.user?.id, resolvedAt: new Date(), note: String(note).slice(0, 500) } });
  await aiAudit(req, "ai.alert.resolved", "AiAlertEvent", a.id, { reason: note, before: { status: a.status }, after: { status: "Resolved" } });
  return u;
}

export async function suppressAlertRule(req, key, { minutes, reason }) {
  if (!reason) throw bad("Give a reason.");
  const m = Math.min(24 * 60, Math.max(5, Number(minutes) || 60));
  const rule = await prisma.aiAlertRule.findUnique({ where: { key } });
  if (!rule) throw bad("Alert rule not found.", 404);
  const u = await prisma.aiAlertRule.update({ where: { key }, data: { suppressedUntil: new Date(Date.now() + m * 60_000) } });
  await aiAudit(req, "ai.alert.suppressed", "AiAlertRule", rule.id, { reason, after: { minutes: m } });
  return u;
}

// Drift: model deprecations and pricing/retention changes open review items.
export async function checkDrift(now = new Date()) {
  let n = 0;
  const soon = await prisma.aiModelGovernance.findMany({ where: { deprecationAt: { lte: new Date(now.getTime() + 30 * 86_400_000) }, releaseStatus: { notIn: ["Retired"] } } });
  for (const m of soon) {
    const exists = await prisma.aiHumanReviewItem.findFirst({ where: { subjectType: "Model", subjectId: m.id, status: "Open" } });
    if (exists) continue;
    await prisma.aiHumanReviewItem.create({ data: { scope: "platform", queue: "high_risk_release", subjectType: "Model", subjectId: m.id, priority: "High", summary: `${m.displayName} is deprecated on ${m.deprecationAt.toISOString().slice(0, 10)}; a model change needs a new release candidate, evaluation and approval.`, context: { providerKey: m.providerKey, modelId: m.modelId, replacement: m.replacementModelId }, recommendedDecision: "Create a release candidate for the replacement model" } });
    n += 1;
  }
  return n;
}
