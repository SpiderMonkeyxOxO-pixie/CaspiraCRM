// Backend Phase 11 — governance reports and exports. Permission-checked by
// the route, tenant-bounded, without secrets or prompt text, masked, and
// audited. The secure Document service (Backend Phase 7) isn't built yet, so
// exports are returned directly to the requester (CSV or JSON) and the audit
// event records a content hash.
import prisma from "../../lib/prisma.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { digest } from "./safety.js";
import { costGovernance } from "./cost.js";

const bad = (m, status = 422) => Object.assign(new AiError(CATEGORIES.INVALID_REQUEST, m), { httpStatus: status });
const d = (v) => (v ? new Date(v).toISOString() : "");
const inScope = (org) => ({ scope: { in: ["platform", org] } });

export const REPORTS = {
  capabilities: async () => (await prisma.aiCapability.findMany({ orderBy: { key: "asc" } })).map((c) => ({ key: c.key, name: c.name, riskLevel: c.riskLevel, status: c.status, providers: (c.providers || []).join(" "), roles: (c.roles || []).join(" "), evaluationSuite: c.evaluationSuiteKey || "", lastReview: d(c.lastReviewAt), nextReview: d(c.nextReviewAt), sunset: d(c.sunsetAt), version: c.version })),
  providers: async (org) => (await prisma.aiProviderGovernance.findMany({ where: inScope(org), orderBy: { providerKey: "asc" } })).map((p) => ({ provider: p.providerKey, scope: p.scope === "platform" ? "Platform" : "Organization", status: p.status, credentials: p.credentialStatus, dpa: p.dpaStatus, residency: p.residencyStatus, retention: p.retentionMode, zeroDataRetention: p.zdrEligibility, hostedStorage: p.hostedStorage, lastVerified: d(p.lastVerifiedAt), lastSecurityReview: d(p.lastSecurityReviewAt), nextReview: d(p.nextReviewAt) })),
  models: async () => (await prisma.aiModelGovernance.findMany({ orderBy: [{ providerKey: "asc" }, { modelId: "asc" }] })).map((m) => ({ provider: m.providerKey, model: m.modelId, pinned: m.pinned, evaluation: m.evaluationStatus, release: m.releaseStatus, deprecation: d(m.deprecationAt), replacement: m.replacementModelId || "", rollback: m.rollbackModelId || "", lastVerified: d(m.lastVerifiedAt) })),
  prompts: async () => (await prisma.aiPromptGovernance.findMany({ orderBy: [{ promptKey: "asc" }, { version: "asc" }] })).map((p) => ({ prompt: p.promptKey, version: p.version, status: p.status, capability: p.capabilityKey || "", checksum: p.checksum.slice(0, 16), approved: d(p.approvedAt), activated: d(p.activatedAt), retired: d(p.retiredAt), changeSummary: p.changeSummary })),
  tools: async () => (await prisma.aiToolGovernance.findMany({ orderBy: { toolName: "asc" } })).map((t) => ({ tool: t.toolName, version: t.version, kind: t.kind, risk: t.riskLevel, permission: t.requiredPermission || "", approval: t.requiredApproval || "", status: t.status, activated: d(t.activatedAt) })),
  workflows: async () => (await prisma.aiWorkflowGovernance.findMany({ orderBy: [{ workflowKey: "asc" }, { version: "asc" }] })).map((w) => ({ workflow: w.workflowKey, version: w.version, status: w.status, steps: (w.steps || []).length, maxToolCalls: w.maxToolCalls, maxRuntimeMs: w.maxRuntimeMs, maxCostUsd: Number(w.maxCostUsd), checksum: w.checksum.slice(0, 16) })),
  evaluations: async (org) => (await prisma.aiEvalRun.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, take: 500 })).map((r) => ({ run: r.publicId, status: r.status, trigger: r.trigger, provider: r.candidate?.providerKey || "", model: r.candidate?.modelId || "", sampleSize: r.sampleSize, passed: r.passed, failed: r.failed, errored: r.errored, zeroToleranceFailures: r.zeroToleranceFailures, estimatedCost: r.estimatedCost === null ? "" : Number(r.estimatedCost), completed: d(r.completedAt) })),
  releases: async (org) => (await prisma.aiRelease.findMany({ where: inScope(org), orderBy: { createdAt: "desc" }, take: 500 })).map((r) => ({ release: r.publicId, capability: r.capabilityKey, version: r.version, risk: r.riskLevel, status: r.status, stage: r.stage, provider: r.manifest?.providerKey || "", model: r.manifest?.modelId || "", manifestChecksum: r.manifestChecksum.slice(0, 16), promoted: d(r.promotedAt), rolledBack: d(r.rolledBackAt) })),
  incidents: async (org) => (await prisma.aiIncident.findMany({ where: inScope(org), orderBy: { createdAt: "desc" }, take: 500 })).map((i) => ({ incident: i.publicId, severity: i.severity, category: i.category, status: i.status, capability: i.capabilityKey || "", detected: d(i.createdAt), contained: d(i.containedAt), resolved: d(i.resolvedAt), closed: d(i.closedAt) })),
  safety_trends: async (org) => {
    const rows = await prisma.aiSafetyEvent.findMany({ where: { organizationId: org, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, NOT: { source: { startsWith: "evaluation:" } } }, select: { createdAt: true, category: true, severity: true } });
    const m = {};
    for (const r of rows) { const k = `${d(r.createdAt).slice(0, 10)}|${r.category}|${r.severity}`; m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).map(([k, count]) => { const [day, category, severity] = k.split("|"); return { day, category, severity, count }; }).sort((a, b) => a.day.localeCompare(b.day));
  },
  usage_cost: async (org) => { const c = await costGovernance(org); return c.byCapability.map((x) => ({ capability: x.key, requests: x.requests, inputTokens: x.inputTokens, outputTokens: x.outputTokens, estimatedCost: x.estimatedCost, unknownCost: x.unknownCost, label: c.labels.estimated })); },
  retention: async (org) => { const p = await prisma.aiPolicy.findUnique({ where: { organizationId: org } }); return Object.entries(p?.retention || {}).map(([setting, value]) => ({ setting, value })); },
  policy_reviews: async (org) => [...(await prisma.aiCapability.findMany()).map((c) => ({ type: "Capability", key: c.key, nextReview: d(c.nextReviewAt), sunset: d(c.sunsetAt) })), ...(await prisma.aiProviderGovernance.findMany({ where: inScope(org) })).map((p) => ({ type: "Provider", key: p.providerKey, nextReview: d(p.nextReviewAt), sunset: "" }))].sort((a, b) => a.nextReview.localeCompare(b.nextReview)),
  exceptions: async (org) => (await prisma.aiEmergencyException.findMany({ where: inScope(org), orderBy: { createdAt: "desc" } })).map((e) => ({ exception: e.publicId, status: e.status, controls: (e.target?.controls || []).join(" "), systemOwnerReviewed: !!e.systemOwnerReviewedByUserId, expires: d(e.expiresAt), postReviewDue: d(e.postReviewDueAt) })),
  review_workload: async (org) => { const g = await prisma.aiHumanReviewItem.groupBy({ by: ["queue", "status"], where: inScope(org), _count: { _all: true } }); return g.map((x) => ({ queue: x.queue, status: x.status, items: x._count._all })); },
};

const csvCell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows) => (rows.length ? [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).map(csvCell).join(","))].join("\n") : "");

export async function buildReport(req, type, format = "json") {
  const fn = REPORTS[type];
  if (!fn) throw bad(`Reports: ${Object.keys(REPORTS).join(", ")}.`, 404);
  if (!["json", "csv"].includes(format)) throw bad("format: json or csv.");
  const rows = await fn(req.organizationId);
  const body = format === "csv" ? toCsv(rows) : JSON.stringify({ report: type, generatedAt: new Date().toISOString(), rows }, null, 2);
  await aiAudit(req, "ai.governance.report_exported", "AiGovernanceReport", type, { after: { type, format, rows: rows.length, sha256: digest(body) } });
  return { rows, body, contentType: format === "csv" ? "text/csv; charset=utf-8" : "application/json", filename: `ai-${type.replace(/_/g, "-")}-${new Date().toISOString().slice(0, 10)}.${format}` };
}
