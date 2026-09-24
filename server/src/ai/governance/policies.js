// Backend Phase 11 — governance policy lifecycle. Every change is a new,
// immutable version: Draft → Submitted → Under review → (Changes requested)
// → Approved → Active; policies can be Paused, Superseded, Retired. A version
// becomes Active only when reviewers approved (the author is never the sole
// approver for moderate/high risk), evaluation gates passed, the provider is
// verified, and retention, budgets, monitoring and a rollback target exist.
// Only people with governance permissions act here; the model never can.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { invalidateGovernanceCache } from "./runtime.js";
import { RISK_RULES, RISK_LEVELS, PROHIBITED_AUTOMATIONS } from "./catalog.js";
import { isSystemOwner } from "./killSwitches.js";
import { digest } from "./safety.js";

const bad = (m, status = 422) => Object.assign(new AiError(CATEGORIES.INVALID_REQUEST, m), { httpStatus: status });

export const serializePolicy = (p, versions = [], approvals = []) => ({
  _id: p.publicId, name: p.name, capabilityKey: p.capabilityKey, riskLevel: p.riskLevel, status: p.status, scope: p.scope === "platform" ? "Platform" : "Organization",
  latestVersion: p.latestVersion, activeVersionId: p.activeVersionId, createdByUserId: p.createdByUserId, createdAt: p.createdAt, updatedAt: p.updatedAt,
  versions: versions.map((v) => ({ _id: v.id, version: v.version, status: v.status, body: v.body, checksum: v.checksum, changeSummary: v.changeSummary, authorUserId: v.authorUserId, submittedAt: v.submittedAt, approvedAt: v.approvedAt, activatedAt: v.activatedAt, createdAt: v.createdAt })),
  approvals: approvals.map((a) => ({ decision: a.decision, reviewerUserId: a.reviewerUserId, version: a.subjectVersion, role: a.role, reason: a.reason, at: a.createdAt })),
});

// Policy body: what this organization allows for a capability.
function validateBody(body = {}) {
  const issues = [];
  for (const a of body.automations || []) if (PROHIBITED_AUTOMATIONS.includes(a)) issues.push(`"${a}" is a prohibited AI automation and can never be enabled.`);
  if (body.allowModifyGovernance) issues.push("AI can never modify AI governance policies.");
  for (const k of ["allowedProviders", "allowedModels", "permittedData", "prohibitedData", "humanApprovals"]) if (body[k] !== undefined && !Array.isArray(body[k])) issues.push(`${k} must be a list.`);
  return issues;
}

export async function loadPolicy(req, id) {
  const p = await prisma.aiGovernancePolicy.findFirst({ where: { publicId: String(id), scope: { in: ["platform", req.organizationId] } } });
  if (!p) throw bad("Policy not found.", 404);
  return p;
}

export async function createPolicy(req, { name, capabilityKey, riskLevel, body, changeSummary = "Initial version", platform = false }) {
  if (!name) throw bad("name is required.");
  const cap = capabilityKey ? await prisma.aiCapability.findUnique({ where: { key: capabilityKey } }) : null;
  if (capabilityKey && !cap) throw bad("Unknown capability.", 404);
  const risk = riskLevel || cap?.riskLevel || "Moderate";
  if (!RISK_LEVELS.includes(risk)) throw bad(`riskLevel: ${RISK_LEVELS.join(", ")}.`);
  if (risk === "Prohibited") throw bad("A prohibited AI automation can't be given a policy.", 403);
  if (platform && !isSystemOwner(req)) throw bad("Platform policies are managed by a System Owner.", 403);
  const issues = validateBody(body);
  if (issues.length) throw bad(issues.join(" "));
  const p = await prisma.aiGovernancePolicy.create({ data: { publicId: `agp_${crypto.randomBytes(8).toString("base64url")}`, organizationId: platform ? null : req.organizationId, scope: platform ? "platform" : req.organizationId, capabilityKey: capabilityKey || null, name: String(name).slice(0, 120), riskLevel: risk, latestVersion: 1, createdByUserId: req.user?.id || null } });
  await prisma.aiGovernancePolicyVersion.create({ data: { policyId: p.id, organizationId: p.organizationId, version: 1, body: body || {}, checksum: digest(body || {}), changeSummary: String(changeSummary).slice(0, 500), authorUserId: req.user?.id || null } });
  await aiAudit(req, "ai.policy.created", "AiGovernancePolicy", p.id, { after: { name: p.name, capabilityKey, riskLevel: risk } });
  return p;
}

// A change is always a new version (versions are never edited).
export async function addPolicyVersion(req, p, { body, changeSummary }) {
  if (["Retired"].includes(p.status)) throw bad("A retired policy can't change.");
  if (!changeSummary) throw bad("Describe the change (changeSummary).");
  const issues = validateBody(body);
  if (issues.length) throw bad(issues.join(" "));
  const v = await prisma.aiGovernancePolicyVersion.create({ data: { policyId: p.id, organizationId: p.organizationId, version: p.latestVersion + 1, body: body || {}, checksum: digest(body || {}), changeSummary: String(changeSummary).slice(0, 500), authorUserId: req.user?.id || null } });
  await prisma.aiGovernancePolicy.update({ where: { id: p.id }, data: { latestVersion: v.version, status: p.status === "Active" ? "Active" : "Draft" } });
  await aiAudit(req, "ai.policy.versioned", "AiGovernancePolicy", p.id, { after: { version: v.version, checksum: v.checksum } });
  return v;
}

const latestVersion = (p) => prisma.aiGovernancePolicyVersion.findUnique({ where: { policyId_version: { policyId: p.id, version: p.latestVersion } } });

export async function submitPolicy(req, p) {
  const v = await latestVersion(p);
  if (!["Draft", "Changes requested"].includes(v.status)) throw bad(`Version ${v.version} is ${v.status.toLowerCase()}.`);
  await prisma.aiGovernancePolicyVersion.update({ where: { id: v.id }, data: { status: "Under review", submittedAt: new Date() } });
  const u = await prisma.aiGovernancePolicy.update({ where: { id: p.id }, data: { status: p.status === "Active" ? "Active" : "Under review" } });
  await prisma.aiHumanReviewItem.create({ data: { organizationId: p.organizationId, scope: p.scope, queue: p.riskLevel === "High" ? "high_risk_release" : "high_risk_release", subjectType: "Policy", subjectId: p.id, priority: p.riskLevel === "High" ? "High" : "Normal", summary: `Policy "${p.name}" v${v.version} submitted for review.`, context: { policyId: p.publicId, version: v.version, changeSummary: v.changeSummary }, createdByUserId: req.user?.id || null } });
  await aiAudit(req, "ai.policy.submitted", "AiGovernancePolicy", p.id, { after: { version: v.version } });
  return u;
}

// Activation prerequisites → list of unmet items.
export async function activationBlockers(p, v) {
  const out = [];
  const body = v.body || {};
  if (p.capabilityKey) {
    const cap = await prisma.aiCapability.findUnique({ where: { key: p.capabilityKey } });
    const recent = await prisma.aiEvalRun.findFirst({ where: { status: { in: ["Passed", "Passed with warnings"] }, completedAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, suiteId: { in: (await prisma.aiEvaluationSuite.findMany({ where: { OR: [{ capabilityKey: p.capabilityKey }, { key: cap?.evaluationSuiteKey || "__none__" }] }, select: { id: true } })).map((s) => s.id) } } });
    if (!recent) out.push("Evaluation gates: no passing run of this capability's suite in the last 30 days.");
  }
  for (const pk of body.allowedProviders || []) {
    const pg = await prisma.aiProviderGovernance.findFirst({ where: { providerKey: pk, scope: { in: [p.scope, "platform"] } }, orderBy: { scope: "desc" } });
    if (!pg || pg.status !== "Verified") out.push(`Provider ${pk} isn't verified.`);
  }
  if (!(body.allowedProviders || []).length) out.push("No approved provider is configured.");
  if (!body.retention || !Object.keys(body.retention).length) out.push("Retention isn't configured.");
  const budgets = p.organizationId ? await prisma.aiBudget.count({ where: { organizationId: p.organizationId, active: true } }) : 1;
  if (!body.budget && !budgets) out.push("No budget limit exists.");
  if (!(await prisma.aiAlertRule.count({ where: { active: true } }))) out.push("Monitoring isn't active (no alert rules).");
  if (!body.rollbackTarget) out.push("No rollback configuration (rollbackTarget).");
  return out;
}

export async function approvePolicy(req, p, { reason }) {
  if (!reason) throw bad("Give a reason.");
  const v = await latestVersion(p);
  if (!["Under review", "Approved"].includes(v.status)) throw bad(`Version ${v.version} is ${v.status.toLowerCase()}; submit it first.`);
  const me = req.user?.id;
  if (p.riskLevel !== "Low" && v.authorUserId === me) {
    const { recordSafetyEvent } = await import("./safety.js");
    await recordSafetyEvent(req, { severity: "Medium", category: "approval_bypass_attempt", capabilityKey: p.capabilityKey, summary: `The author of policy ${p.publicId} tried to approve it.`, source: "policies", actionTaken: "Refuse" });
    throw bad("Separation of duties: the author of a moderate- or high-risk policy can't approve it.", 403);
  }
  await prisma.aiGovernanceApproval.create({ data: { organizationId: p.organizationId, subjectType: "Policy", subjectId: p.id, subjectVersion: v.version, reviewerUserId: me, decision: "Approve", reason: String(reason).slice(0, 500), role: hasGrant(req, "ai_safety", "review") ? "safety_reviewer" : "approver" } });
  const approvals = await prisma.aiGovernanceApproval.findMany({ where: { subjectType: "Policy", subjectId: p.id, subjectVersion: v.version, decision: "Approve" } });
  const independent = [...new Set(approvals.filter((a) => a.reviewerUserId !== v.authorUserId).map((a) => a.reviewerUserId))];
  const rules = RISK_RULES[p.riskLevel] || RISK_RULES.Moderate;
  const needed = p.riskLevel === "Low" ? 1 : rules.independentApprovals;
  const safetyOk = !rules.safetyReviewerRequired || approvals.some((a) => a.role === "safety_reviewer" && a.reviewerUserId !== v.authorUserId);
  await aiAudit(req, "ai.policy.approved", "AiGovernancePolicy", p.id, { reason, after: { version: v.version, independentApprovals: independent.length, needed } });
  if (independent.length < needed || !safetyOk) {
    return { policy: await prisma.aiGovernancePolicy.findUnique({ where: { id: p.id } }), pending: `${independent.length}/${needed} independent approvals${safetyOk ? "" : "; a safety reviewer must approve"}` };
  }
  await prisma.aiGovernancePolicyVersion.update({ where: { id: v.id }, data: { status: "Approved", approvedAt: new Date() } });
  return activatePolicy(req, p);
}

export async function activatePolicy(req, p) {
  // Resuming a paused policy restores its (unchanged) active version.
  if (p.status === "Paused" && p.activeVersionId) {
    const u = await prisma.aiGovernancePolicy.update({ where: { id: p.id }, data: { status: "Active" } });
    invalidateGovernanceCache();
    await aiAudit(req, "ai.policy.resumed", "AiGovernancePolicy", p.id, { before: { status: "Paused" }, after: { status: "Active" } });
    return { policy: u, blockers: [] };
  }
  if (p.status === "Paused") {
    const u = await prisma.aiGovernancePolicy.update({ where: { id: p.id }, data: { status: "Draft" } });
    invalidateGovernanceCache();
    await aiAudit(req, "ai.policy.resumed", "AiGovernancePolicy", p.id, { before: { status: "Paused" }, after: { status: "Draft" } });
    return { policy: u, blockers: ["The policy never had an active version; it returned to Draft."] };
  }
  const v = await latestVersion(p);
  if (v.status !== "Approved") throw bad("Only an approved version can be activated.");
  const blockers = await activationBlockers(p, v);
  if (blockers.length) {
    const u = await prisma.aiGovernancePolicy.update({ where: { id: p.id }, data: { status: p.status === "Active" ? "Active" : "Approved" } });
    return { policy: u, blockers };
  }
  if (p.activeVersionId) await prisma.aiGovernancePolicyVersion.update({ where: { id: p.activeVersionId }, data: { status: "Superseded" } });
  await prisma.aiGovernancePolicyVersion.update({ where: { id: v.id }, data: { status: "Active", activatedAt: new Date() } });
  const u = await prisma.aiGovernancePolicy.update({ where: { id: p.id }, data: { status: "Active", activeVersionId: v.id } });
  invalidateGovernanceCache();
  await aiAudit(req, "ai.policy.activated", "AiGovernancePolicy", p.id, { before: { activeVersionId: p.activeVersionId }, after: { activeVersionId: v.id, version: v.version } });
  return { policy: u, blockers: [] };
}

export async function rejectPolicy(req, p, { reason, requestChanges = true }) {
  if (!reason) throw bad("Give a reason.");
  const v = await latestVersion(p);
  if (!["Under review", "Approved"].includes(v.status)) throw bad(`Version ${v.version} is ${v.status.toLowerCase()}.`);
  await prisma.aiGovernancePolicyVersion.update({ where: { id: v.id }, data: { status: "Changes requested" } });
  await prisma.aiGovernanceApproval.create({ data: { organizationId: p.organizationId, subjectType: "Policy", subjectId: p.id, subjectVersion: v.version, reviewerUserId: req.user.id, decision: requestChanges ? "Request changes" : "Reject", reason: String(reason).slice(0, 500) } });
  const u = await prisma.aiGovernancePolicy.update({ where: { id: p.id }, data: { status: p.status === "Active" ? "Active" : "Changes requested" } });
  await aiAudit(req, "ai.policy.rejected", "AiGovernancePolicy", p.id, { reason, after: { version: v.version } });
  return u;
}

export async function pausePolicy(req, p, { reason }) {
  if (!reason) throw bad("Give a reason.");
  const u = await prisma.aiGovernancePolicy.update({ where: { id: p.id }, data: { status: "Paused" } });
  invalidateGovernanceCache();
  await aiAudit(req, "ai.policy.paused", "AiGovernancePolicy", p.id, { reason, before: { status: p.status }, after: { status: "Paused" } });
  return u;
}
