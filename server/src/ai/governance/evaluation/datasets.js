// Backend Phase 11 — evaluation datasets. Versions are immutable snapshots;
// a change creates a new version. Production-derived data needs explicit
// authorization by someone other than the requester, a purpose, a retention
// period and redaction — and is never copied from conversations
// automatically (only the cases a person submits are stored).
import prisma from "../../../lib/prisma.js";
import { AiError, CATEGORIES } from "../../common/errors.js";
import { aiAudit } from "../../common/audit.js";
import { scanOutput, digest } from "../safety.js";

const bad = (m, status = 422) => Object.assign(new AiError(CATEGORIES.INVALID_REQUEST, m), { httpStatus: status });
export const DATASET_TYPES = ["synthetic", "golden", "regression", "adversarial", "prompt_injection", "authorization", "sensitive_data", "retrieval", "citation", "tool_selection", "action_proposal", "cost", "latency", "provider_refusal", "incident_derived", "production_redacted"];
const INPUT_KINDS = ["deterministic", "gateway", "copilot"];

// Deep redaction for case content: credentials, emails, phone numbers.
export function redactValue(v) {
  if (typeof v === "string") {
    return scanOutput(v).text
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => `${m[0]}***@${m.split("@")[1]}`)
      .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
  }
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactValue(x)]));
  return v;
}

function validateCase(c) {
  if (!c?.key || !/^[a-z0-9-_.]{3,80}$/i.test(c.key)) throw bad("Each case needs a key (3–80 letters, digits, - _ .).");
  if (!INPUT_KINDS.includes(c.input?.kind)) throw bad(`Case ${c.key}: input.kind must be ${INPUT_KINDS.join(", ")}.`);
  if (c.input.kind === "copilot" && !String(c.input.text || "").trim()) throw bad(`Case ${c.key}: a Copilot case needs input.text.`);
  if (c.input.kind === "gateway" && !c.input.useCaseKey) throw bad(`Case ${c.key}: a gateway case needs input.useCaseKey.`);
  if (c.input.kind === "deterministic" && !c.input.check) throw bad(`Case ${c.key}: a deterministic case needs input.check.`);
}

export const serializeDataset = (d, versions = []) => ({ _id: d.id, key: d.key, name: d.name, type: d.type, purpose: d.purpose, source: d.source, scope: d.scope === "platform" ? "Platform" : "Organization", ownerUserId: d.ownerUserId, authorization: d.authorization, retentionDays: d.retentionDays, status: d.status, versions: versions.map((v) => ({ _id: v.id, version: v.version, caseCount: v.caseCount, checksum: v.checksum, status: v.status, notes: v.notes, createdAt: v.createdAt })), createdAt: d.createdAt });

export async function createDataset(req, { key, name, type, purpose, source = "Synthetic", authorization = null, retentionDays = null, cases = [], platform = false }) {
  if (!key || !name || !purpose) throw bad("key, name and purpose are required.");
  if (!DATASET_TYPES.includes(type)) throw bad(`type: ${DATASET_TYPES.join(", ")}.`);
  if (!["Synthetic", "Fixture", "Production"].includes(source)) throw bad("source: Synthetic, Fixture or Production.");
  if (source === "Production") {
    if (!authorization?.approvedByUserId || !authorization.purpose) throw bad("Production-derived data needs an authorization: approvedByUserId and purpose.");
    if (authorization.approvedByUserId === req.user?.id) throw bad("Production data must be authorized by someone other than the requester.", 403);
    if (!retentionDays || retentionDays > 365) throw bad("Production-derived datasets need a retention period (1–365 days).");
    const approver = await prisma.organizationMembership.findFirst({ where: { organizationId: req.organizationId, userId: authorization.approvedByUserId, status: "Active" }, include: { roles: { include: { role: true } } } });
    const mayApprove = approver?.roles.some((r) => (r.role.permissionGrants || []).some((g) => g.moduleId === "ai_gov_evaluations" && g.actions.includes("review")));
    if (!mayApprove) throw bad("The authorizing person must hold evaluation review permission in this organization.", 403);
  }
  for (const c of cases) validateCase(c);
  const scope = platform ? "platform" : req.organizationId;
  if (await prisma.aiEvaluationDataset.findUnique({ where: { scope_key: { scope, key } } })) throw bad("A dataset with this key already exists.", 409);
  const ds = await prisma.aiEvaluationDataset.create({ data: { scope, organizationId: platform ? null : req.organizationId, key, name: String(name).slice(0, 120), type, purpose: String(purpose).slice(0, 500), source, ownerUserId: req.user?.id || null, authorization: source === "Production" ? { ...authorization, approvedAt: new Date().toISOString(), redaction: "applied" } : null, retentionDays } });
  const { version } = await newDatasetVersion(req, ds, { add: cases, notes: "Initial version", initial: true });
  await aiAudit(req, "ai.evaluation.dataset_created", "AiEvaluationDataset", ds.id, { after: { key, type, source, cases: cases.length } });
  return { dataset: ds, version };
}

// Copies the latest version's cases, applies additions/removals, publishes v+1.
export async function newDatasetVersion(req, ds, { add = [], remove = [], notes = null, initial = false }) {
  for (const c of add) validateCase(c);
  const latest = initial ? null : await prisma.aiEvaluationDatasetVersion.findFirst({ where: { datasetId: ds.id }, orderBy: { version: "desc" } });
  const previous = latest ? await prisma.aiEvaluationCase.findMany({ where: { datasetVersionId: latest.id } }) : [];
  const kept = previous.filter((c) => !remove.includes(c.key) && !add.some((a) => a.key === c.key));
  const incoming = add.map((c) => ({ key: c.key, type: c.type || ds.type, input: redactValue(c.input), expectations: c.expectations || {}, zeroTolerance: c.zeroTolerance || [], tags: c.tags || [], sourceIncidentId: c.sourceIncidentId || null }));
  const all = [...kept.map((c) => ({ key: c.key, type: c.type, input: c.input, expectations: c.expectations, zeroTolerance: c.zeroTolerance, tags: c.tags, sourceIncidentId: c.sourceIncidentId })), ...incoming];
  const version = await prisma.aiEvaluationDatasetVersion.create({ data: { datasetId: ds.id, organizationId: ds.organizationId, version: (latest?.version || 0) + 1, caseCount: all.length, checksum: digest(all), notes: notes ? String(notes).slice(0, 500) : null, createdByUserId: req.user?.id || null } });
  if (all.length) await prisma.aiEvaluationCase.createMany({ data: all.map((c) => ({ ...c, datasetVersionId: version.id, organizationId: ds.organizationId, redacted: true })) });
  const cases = await prisma.aiEvaluationCase.findMany({ where: { datasetVersionId: version.id } });
  if (!initial) await aiAudit(req, "ai.evaluation.dataset_versioned", "AiEvaluationDataset", ds.id, { after: { version: version.version, added: add.length, removed: remove.length } });
  return { version, cases };
}

// Deletion support (production-derived data): cases removed, versions marked Deleted.
export async function deleteDataset(req, ds, reason) {
  if (!reason) throw bad("Give a reason for deleting this dataset.");
  const versions = await prisma.aiEvaluationDatasetVersion.findMany({ where: { datasetId: ds.id }, select: { id: true } });
  await prisma.aiEvaluationCase.deleteMany({ where: { datasetVersionId: { in: versions.map((v) => v.id) } } });
  await prisma.aiEvaluationDatasetVersion.updateMany({ where: { datasetId: ds.id }, data: { status: "Deleted", caseCount: 0 } });
  await prisma.aiEvaluationDataset.update({ where: { id: ds.id }, data: { status: "Deleted" } });
  await aiAudit(req, "ai.evaluation.dataset_deleted", "AiEvaluationDataset", ds.id, { reason });
}

// Datasets past their retention period (production-derived) are deleted by the worker.
export async function expireDatasets(now = new Date()) {
  const due = await prisma.aiEvaluationDataset.findMany({ where: { status: "Active", retentionDays: { not: null } } });
  let n = 0;
  for (const d of due) {
    if (d.createdAt.getTime() + d.retentionDays * 86_400_000 < now.getTime()) { await deleteDataset(null, d, "Retention period ended"); n += 1; }
  }
  return n;
}
