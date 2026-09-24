// Backend Phase 11 — release management. A release pins everything a
// capability runs with (manifest) and moves through gates:
//   Draft → Testing (evaluation) → Evaluation failed | Awaiting approval →
//   Approved → Shadow → Pilot (internal, organization) → Canary →
//   Generally available;  Paused / Rolled back / Retired at any point.
// Separation of duties: for moderate and high risk the author (and the
// candidate prompt authors and model-configuration owner) are never the sole
// approvers; activation needs independent approval. A successful deploy is
// never an approval: general availability needs every mandatory readiness
// item and a recorded production approval.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { recordOutboxEvent } from "../../services/outboxService.js";
import { invalidateGovernanceCache } from "./runtime.js";
import { RISK_RULES, RELEASE_STAGES, STAGE_STATUS, CAPABILITY_STATUS_FOR_STAGE, ZERO_TOLERANCE, aiEnvironment } from "./catalog.js";
import { isSystemOwner } from "./killSwitches.js";
import { digest } from "./safety.js";

const bad = (m, status = 422) => Object.assign(new AiError(CATEGORIES.INVALID_REQUEST, m), { httpStatus: status });
const LIVE = ["Shadow", "Pilot", "Canary", "Generally available"];

export const serializeRelease = (r, extra = {}) => ({
  _id: r.publicId, capabilityKey: r.capabilityKey, version: r.version, riskLevel: r.riskLevel, manifest: r.manifest, manifestChecksum: r.manifestChecksum, status: r.status, stage: r.stage,
  environment: r.environment, scope: r.scope === "platform" ? "Platform" : "Organization", authorUserId: r.authorUserId, previousReleaseId: r.previousReleaseId, promotionBlocked: r.promotionBlocked,
  promotionBlockReason: r.promotionBlockReason, notes: r.notes, submittedAt: r.submittedAt, approvedAt: r.approvedAt, promotedAt: r.promotedAt, pausedAt: r.pausedAt, rolledBackAt: r.rolledBackAt,
  retiredAt: r.retiredAt, createdAt: r.createdAt, updatedAt: r.updatedAt, ...extra,
});

export async function loadRelease(req, id) {
  const r = await prisma.aiRelease.findFirst({ where: { publicId: String(id), scope: { in: ["platform", req.organizationId] } } });
  if (!r) throw bad("Release not found.", 404);
  return r;
}

// Validates a manifest against governance: approved providers, pinned and
// governed models, approved/active prompts, activated tools and workflows.
export async function validateManifest(capability, m) {
  const issues = [];
  if (!m.providerKey) issues.push("providerKey is required.");
  if (m.providerKey && capability.providers?.length && !capability.providers.includes(m.providerKey)) issues.push(`${m.providerKey} isn't an approved provider for ${capability.name}.`);
  if (m.providerKey) {
    const pg = await prisma.aiProviderGovernance.findUnique({ where: { scope_providerKey: { scope: "platform", providerKey: m.providerKey } } });
    if (!pg || ["Suspended", "Policy blocked", "Unavailable"].includes(pg.status)) issues.push(`${m.providerKey} is ${pg?.status?.toLowerCase() || "not governed"}.`);
  }
  if (!m.modelId) issues.push("modelId (a pinned model version) is required.");
  else {
    const mg = await prisma.aiModelGovernance.findUnique({ where: { providerKey_modelId: { providerKey: m.providerKey, modelId: m.modelId } } });
    if (!mg) issues.push(`${m.modelId} isn't in the model registry.`);
    else {
      if (!mg.pinned) issues.push(`${m.modelId} is a moving alias; pin a dated model version.`);
      if (["Blocked", "Retired"].includes(mg.releaseStatus)) issues.push(`${m.modelId} is ${mg.releaseStatus.toLowerCase()}.`);
      if (mg.deprecationAt && mg.deprecationAt < new Date()) issues.push(`${m.modelId} is past its deprecation date.`);
    }
  }
  for (const [key, version] of Object.entries(m.promptVersions || {})) {
    const pg = await prisma.aiPromptGovernance.findUnique({ where: { promptKey_version: { promptKey: key, version: Number(version) } } });
    if (!pg) issues.push(`Prompt ${key}@${version} isn't governed.`);
    else if (!["Approved", "Active"].includes(pg.status)) issues.push(`Prompt ${key}@${version} is ${pg.status.toLowerCase()} (needs approval).`);
  }
  for (const [name, version] of Object.entries(m.toolVersions || {})) {
    const tg = await prisma.aiToolGovernance.findUnique({ where: { toolName_version: { toolName: name, version: String(version) } } });
    if (!tg || !["Approved", "Active"].includes(tg.status)) issues.push(`Tool ${name}@${version} isn't approved.`);
  }
  for (const [key, version] of Object.entries(m.workflowVersions || {})) {
    const wg = await prisma.aiWorkflowGovernance.findUnique({ where: { workflowKey_version: { workflowKey: key, version: Number(version) } } });
    if (!wg || !["Approved", "Active"].includes(wg.status)) issues.push(`Workflow ${key}@${version} isn't approved.`);
  }
  if (!m.evaluationSuite?.key) issues.push("evaluationSuite.key is required.");
  else if (!(await prisma.aiEvaluationSuite.findFirst({ where: { key: m.evaluationSuite.key } }))) issues.push(`Evaluation suite ${m.evaluationSuite.key} doesn't exist.`);
  if (!m.budgetPolicy) issues.push("budgetPolicy is required.");
  if (!m.retentionPolicy) issues.push("retentionPolicy is required.");
  return issues;
}

export async function createRelease(req, { capabilityKey, manifest, notes = null, platform = false }) {
  const capability = await prisma.aiCapability.findUnique({ where: { key: String(capabilityKey || "") } });
  if (!capability) throw bad("Unknown capability.", 404);
  if (capability.riskLevel === "Prohibited" || capability.status === "Blocked") throw bad(`${capability.name} is blocked and can't be released.`, 403);
  if (platform && !isSystemOwner(req)) throw bad("Platform releases are created by a System Owner.", 403);
  const m = {
    providerKey: manifest?.providerKey, modelId: manifest?.modelId, modelSettings: manifest?.modelSettings || {}, promptVersions: manifest?.promptVersions || {},
    outputSchemaVersion: manifest?.outputSchemaVersion || "1", selectorVersion: manifest?.selectorVersion || "1", retrieval: manifest?.retrieval || null,
    toolVersions: manifest?.toolVersions || {}, workflowVersions: manifest?.workflowVersions || {}, policyVersionId: manifest?.policyVersionId || null,
    evaluationSuite: manifest?.evaluationSuite || (capability.evaluationSuiteKey ? { key: capability.evaluationSuiteKey } : null),
    budgetPolicy: manifest?.budgetPolicy || capability.budgetPolicy, retentionPolicy: manifest?.retentionPolicy || capability.retentionPolicy, featureFlags: manifest?.featureFlags || {},
  };
  const issues = await validateManifest(capability, m);
  if (issues.length) throw Object.assign(bad(`The manifest isn't valid: ${issues.join(" ")}`), { details: { issues } });
  const scope = platform ? "platform" : req.organizationId;
  const last = await prisma.aiRelease.findFirst({ where: { scope, capabilityKey }, orderBy: { version: "desc" } });
  const current = await prisma.aiRelease.findFirst({ where: { scope, capabilityKey, status: { in: LIVE } }, orderBy: { version: "desc" } });
  const r = await prisma.aiRelease.create({
    data: {
      publicId: `arl_${crypto.randomBytes(8).toString("base64url")}`, organizationId: platform ? null : req.organizationId, scope, capabilityKey, version: (last?.version || 0) + 1,
      riskLevel: capability.riskLevel, manifest: m, manifestChecksum: digest(m), environment: aiEnvironment(), authorUserId: req.user?.id || null, previousReleaseId: current?.id || null, notes: notes ? String(notes).slice(0, 1000) : null,
    },
  });
  const gates = [
    { gateKey: "zero_tolerance", kind: "zero_tolerance", threshold: { failures: 0, categories: ZERO_TOLERANCE } },
    { gateKey: "quality", kind: "quality", threshold: { suite: m.evaluationSuite.key } },
    { gateKey: "independent_approval", kind: "approval", threshold: { independentApprovals: RISK_RULES[r.riskLevel]?.independentApprovals || 1, safetyReviewerRequired: !!RISK_RULES[r.riskLevel]?.safetyReviewerRequired } },
    { gateKey: "production_readiness", kind: "checklist", threshold: { mandatoryItems: "all" } },
  ];
  await prisma.aiReleaseGate.createMany({ data: gates.map((g) => ({ ...g, releaseId: r.id })) });
  await aiAudit(req, "ai.release.created", "AiRelease", r.id, { after: { capabilityKey, version: r.version, manifestChecksum: r.manifestChecksum, riskLevel: r.riskLevel } });
  return r;
}

// Submit → Testing: queues the release-gate evaluation of the pinned configuration.
export async function submitRelease(req, r) {
  if (!["Draft", "Evaluation failed"].includes(r.status)) throw bad(`A ${r.status.toLowerCase()} release can't be submitted.`);
  const { startEvaluationRun } = await import("./evaluation/runner.js");
  const m = r.manifest;
  const run = await startEvaluationRun(req, { suiteKey: m.evaluationSuite.key, suiteVersion: m.evaluationSuite.version || null, releaseId: r.id, trigger: "release", candidate: { providerKey: m.providerKey, modelId: m.modelId, promptVersions: m.promptVersions, toolVersions: m.toolVersions, workflowVersions: m.workflowVersions, retrieval: m.retrieval } });
  const u = await prisma.aiRelease.update({ where: { id: r.id }, data: { status: "Testing", submittedAt: new Date() } });
  await prisma.aiReleaseGate.updateMany({ where: { releaseId: r.id, gateKey: { in: ["zero_tolerance", "quality"] } }, data: { status: "Pending", runId: run.id } });
  if (r.riskLevel === "High") await prisma.aiHumanReviewItem.create({ data: { organizationId: r.organizationId, scope: r.scope, queue: "high_risk_release", subjectType: "Release", subjectId: r.id, priority: "High", summary: `High-risk release ${r.capabilityKey} v${r.version} needs independent review.`, context: { releaseId: r.publicId, manifestChecksum: r.manifestChecksum }, createdByUserId: req.user?.id || null, recommendedDecision: "Review evaluation results before approving" } });
  await aiAudit(req, "ai.release.submitted", "AiRelease", r.id, { before: { status: r.status }, after: { status: "Testing", runId: run.publicId } });
  return { release: u, run };
}

export async function onEvaluationFinished(releaseId, run) {
  const r = await prisma.aiRelease.findUnique({ where: { id: releaseId } });
  if (!r || r.status !== "Testing") return;
  const zt = (run.gateResults || []).find((g) => g.kind === "zero_tolerance");
  const quality = (run.gateResults || []).filter((g) => g.kind === "quality");
  await prisma.aiReleaseGate.update({ where: { releaseId_gateKey: { releaseId, gateKey: "zero_tolerance" } }, data: { status: zt?.status === "Passed" ? "Passed" : "Failed", result: zt || null, sampleSize: zt?.sampleSize ?? null, datasetVersion: (zt?.datasetVersions || []).join(", "), evaluatedAt: new Date() } });
  const qOk = quality.every((g) => g.level === "warn" || g.status === "Passed");
  await prisma.aiReleaseGate.update({ where: { releaseId_gateKey: { releaseId, gateKey: "quality" } }, data: { status: qOk ? "Passed" : "Failed", result: { gates: quality, runStatus: run.status }, sampleSize: run.sampleSize, datasetVersion: (zt?.datasetVersions || []).join(", "), evaluatedAt: new Date() } });
  const passed = ["Passed", "Passed with warnings"].includes(run.status);
  const status = passed ? "Awaiting approval" : run.status === "Awaiting human review" ? "Testing" : "Evaluation failed";
  await prisma.aiRelease.update({ where: { id: releaseId }, data: { status } });
  if (status === "Evaluation failed") {
    await prisma.aiCapability.updateMany({ where: { key: r.capabilityKey, status: { in: ["Draft", "Approved", "Under review"] } }, data: { status: "Evaluation failed" } });
    await recordOutboxEvent(prisma, { aggregateType: "AiRelease", aggregateId: r.id, eventType: "ai.release.evaluation_failed", payload: { organizationId: r.organizationId, capabilityKey: r.capabilityKey, version: r.version, notifyRoleKeys: ["admin", "ai_governance_admin"] } });
  }
}

// Approvals with separation of duties.
export async function approveRelease(req, r, { decision = "Approve", reason, emergency = false }) {
  if (!["Approve", "Reject", "Request changes", "Escalate"].includes(decision)) throw bad("decision: Approve, Reject, Request changes or Escalate.");
  if (r.status !== "Awaiting approval") throw bad(`Only a release awaiting approval can be reviewed (this one is ${r.status.toLowerCase()}).`);
  if (!reason) throw bad("Give a reason.");
  const me = req.user?.id;
  const rules = RISK_RULES[r.riskLevel] || RISK_RULES.Moderate;
  const promptAuthors = (await prisma.aiPromptGovernance.findMany({ where: { OR: Object.entries(r.manifest.promptVersions || {}).map(([k, v]) => ({ promptKey: k, version: Number(v) })).concat([{ promptKey: "__none__" }]) }, select: { authorUserId: true } })).map((p) => p.authorUserId).filter(Boolean);
  const conflicted = new Set([r.authorUserId, ...promptAuthors].filter(Boolean));
  if (decision === "Approve" && r.riskLevel !== "Low" && conflicted.has(me)) {
    const { recordSafetyEvent } = await import("./safety.js");
    await recordSafetyEvent(req, { severity: "Medium", category: "approval_bypass_attempt", capabilityKey: r.capabilityKey, summary: `The author of release ${r.publicId} (or of its prompts) tried to approve it.`, source: "releases", actionTaken: "Refuse" });
    throw bad("Separation of duties: the release author and the authors of its prompts can't approve it.", 403);
  }
  if (emergency && !isSystemOwner(req)) throw bad("An emergency override needs System Owner review.", 403);
  await prisma.aiGovernanceApproval.create({ data: { organizationId: r.organizationId, subjectType: "Release", subjectId: r.id, subjectVersion: r.version, reviewerUserId: me, decision, reason: String(reason).slice(0, 500), role: hasGrant(req, "ai_safety", "review") ? "safety_reviewer" : "approver" } });
  await aiAudit(req, "ai.release.reviewed", "AiRelease", r.id, { reason, after: { decision } });
  if (decision === "Reject") return prisma.aiRelease.update({ where: { id: r.id }, data: { status: "Draft", notes: `Rejected: ${String(reason).slice(0, 300)}` } });
  if (decision === "Request changes") return prisma.aiRelease.update({ where: { id: r.id }, data: { status: "Draft", notes: `Changes requested: ${String(reason).slice(0, 300)}` } });
  if (decision === "Escalate") {
    await prisma.aiHumanReviewItem.create({ data: { organizationId: r.organizationId, scope: r.scope, queue: "high_risk_release", subjectType: "Release", subjectId: r.id, priority: "High", status: "Escalated", summary: `Release ${r.capabilityKey} v${r.version} escalated for review.`, context: { releaseId: r.publicId, reason }, createdByUserId: me } });
    return r;
  }
  const approvals = await prisma.aiGovernanceApproval.findMany({ where: { subjectType: "Release", subjectId: r.id, decision: "Approve" } });
  const independent = [...new Set(approvals.filter((a) => !conflicted.has(a.reviewerUserId)).map((a) => a.reviewerUserId))];
  const safetyOk = !rules.safetyReviewerRequired || approvals.some((a) => a.role === "safety_reviewer" && !conflicted.has(a.reviewerUserId));
  const enough = independent.length >= (rules.independentApprovals || 1) && safetyOk;
  await prisma.aiReleaseGate.update({ where: { releaseId_gateKey: { releaseId: r.id, gateKey: "independent_approval" } }, data: { status: enough ? "Passed" : "Pending", result: { independentApprovers: independent.length, required: rules.independentApprovals, safetyReviewerApproved: safetyOk }, reviewerUserId: me, evaluatedAt: new Date() } });
  if (!enough) return prisma.aiRelease.findUnique({ where: { id: r.id } });
  const u = await prisma.aiRelease.update({ where: { id: r.id }, data: { status: "Approved", approvedAt: new Date() } });
  await prisma.aiCapability.update({ where: { key: r.capabilityKey }, data: { status: "Approved" } }).catch(() => {});
  await aiAudit(req, "ai.release.approved", "AiRelease", r.id, { after: { independentApprovers: independent.length } });
  return u;
}

// Stage requirements; returns the list of unmet requirements.
async function stageBlockers(req, r, stage, body) {
  const out = [];
  const gates = await prisma.aiReleaseGate.findMany({ where: { releaseId: r.id } });
  const g = (k) => gates.find((x) => x.gateKey === k);
  if (r.promotionBlocked) out.push(`Promotion is blocked: ${r.promotionBlockReason || "after a rollback or incident"}.`);
  if (g("zero_tolerance")?.status !== "Passed") out.push("Zero-tolerance gate hasn't passed.");
  if (g("independent_approval")?.status !== "Passed") out.push("Independent approval hasn't been recorded.");
  const openSerious = await prisma.aiIncident.count({ where: { capabilityKey: r.capabilityKey, status: { notIn: ["Resolved", "Closed"] }, severity: { in: ["SEV-0", "SEV-1"] } } });
  if (openSerious) out.push("A SEV-0/SEV-1 incident for this capability is open.");
  const exception = await activeException(r, "quality");
  if (g("quality")?.status !== "Passed" && !exception) out.push("Quality gate hasn't passed (no approved, unexpired emergency exception).");
  if (stage === "shadow" && (!body.dataPolicyApproved || !body.budgetAuthorized)) out.push("Shadow needs data-policy approval and budget authorization (dataPolicyApproved, budgetAuthorized).");
  if (["internal_pilot", "organization_pilot", "canary"].includes(stage) && !body.cohort) out.push("Pilot and canary stages need a named cohort.");
  if (stage === "organization_pilot" && !hasGrant(req, "ai_governance", "manage")) out.push("An organization pilot needs Organization Administrator approval.");
  if (stage === "canary" && (!body.cohort?.stopConditions || !Object.keys(body.cohort.stopConditions).length)) out.push("A canary needs automatic stop conditions.");
  if (stage === "canary" && !r.previousReleaseId && !body.allowNoRollbackTarget) out.push("A canary needs an active rollback target (a previous approved release).");
  if (stage === "canary" && typeof body.cohort?.rules?.percentage === "number" && body.cohort.rules.percentage > (RISK_RULES[r.riskLevel]?.maxCanaryPercent || 25)) out.push(`Canary size is limited to ${RISK_RULES[r.riskLevel]?.maxCanaryPercent}% for ${r.riskLevel.toLowerCase()} risk.`);
  if (stage === "generally_available") {
    const { readinessFor } = await import("./readiness.js");
    const rd = await readinessFor(req, r.capabilityKey, r);
    const missing = rd.items.filter((i) => i.mandatory && i.status !== "Complete" && i.key !== "production_approval");
    if (missing.length) out.push(`Production readiness is incomplete: ${missing.map((i) => i.label).join(", ")}.`);
    if (!body.productionApproval) out.push("General availability needs a recorded production approval (productionApproval: true with a reason).");
    const alerts = await prisma.aiAlertRule.count({ where: { active: true } });
    if (!alerts) out.push("Monitoring (alert rules) isn't active.");
  }
  return out;
}

async function activeException(r, control) {
  const ex = await prisma.aiEmergencyException.findMany({ where: { status: "Approved", expiresAt: { gt: new Date() }, scope: { in: ["platform", r.scope] } } });
  return ex.find((e) => e.target?.releaseId === r.publicId && (e.target?.controls || []).includes(control) && e.systemOwnerReviewedByUserId) || null;
}

export async function promoteRelease(req, r, body = {}) {
  const stage = body.stage;
  if (!RELEASE_STAGES.includes(stage)) throw bad(`stage: ${RELEASE_STAGES.join(", ")}.`);
  if (!["Approved", ...LIVE].includes(r.status)) throw bad(`A ${r.status.toLowerCase()} release can't be promoted.`);
  if (!body.reason) throw bad("Give a reason for the promotion.");
  if (RELEASE_STAGES.indexOf(stage) <= RELEASE_STAGES.indexOf(r.stage) && r.status !== "Approved") throw bad(`The release is already at ${r.stage}.`);
  if (r.scope === "platform" && !isSystemOwner(req)) throw bad("Platform releases are promoted by a System Owner.", 403);
  const blockers = await stageBlockers(req, r, stage, body);
  if (blockers.length) throw Object.assign(bad(`This promotion isn't allowed yet: ${blockers.join(" ")}`, 409), { details: { blockers } });
  if (body.cohort) {
    await prisma.aiRolloutCohort.updateMany({ where: { releaseId: r.id, status: "Active" }, data: { status: "Superseded" } });
    const rules = body.cohort.rules || {};
    if (stage === "organization_pilot" && !rules.organizationIds?.length) rules.organizationIds = [req.organizationId];
    await prisma.aiRolloutCohort.create({ data: { releaseId: r.id, organizationId: r.organizationId, stage, rules, stopConditions: body.cohort.stopConditions || {}, approvedByUserId: req.user?.id || null } });
  }
  if (stage === "generally_available") {
    await prisma.aiGovernanceApproval.create({ data: { organizationId: r.organizationId, subjectType: "Release", subjectId: r.id, subjectVersion: r.version, reviewerUserId: req.user.id, decision: "Approve", role: "production_approval", reason: String(body.reason).slice(0, 500) } });
    // An organization opts in explicitly; never automatic for every organization.
    if (r.scope !== "platform") await prisma.aiFeatureFlag.upsert({ where: { key_scope_environment: { key: `capability.${r.capabilityKey}`, scope: r.scope, environment: r.environment } }, update: { enabled: true, updatedByUserId: req.user?.id, version: { increment: 1 } }, create: { key: `capability.${r.capabilityKey}`, scope: r.scope, organizationId: r.organizationId, environment: r.environment, capabilityKey: r.capabilityKey, enabled: true, description: `Enabled by general availability of release v${r.version}.`, updatedByUserId: req.user?.id } });
  }
  const status = STAGE_STATUS[stage] === "Testing" ? "Approved" : STAGE_STATUS[stage];
  const u = await prisma.aiRelease.update({ where: { id: r.id }, data: { stage, status, promotedAt: new Date(), pausedAt: null } });
  // The previous live release is superseded once this one serves users.
  if (["Pilot", "Canary", "Generally available"].includes(status) && r.previousReleaseId && status === "Generally available") await prisma.aiRelease.updateMany({ where: { id: r.previousReleaseId, status: { in: LIVE } }, data: { status: "Retired", retiredAt: new Date() } });
  if (CAPABILITY_STATUS_FOR_STAGE[stage]) await prisma.aiCapability.update({ where: { key: r.capabilityKey }, data: { status: CAPABILITY_STATUS_FOR_STAGE[stage], currentReleaseId: r.id } }).catch(() => {});
  invalidateGovernanceCache();
  await aiAudit(req, "ai.release.promoted", "AiRelease", r.id, { reason: body.reason, before: { stage: r.stage, status: r.status }, after: { stage, status } });
  await recordOutboxEvent(prisma, { aggregateType: "AiRelease", aggregateId: r.id, eventType: "ai.release.promoted", payload: { organizationId: r.organizationId, capabilityKey: r.capabilityKey, version: r.version, stage, notifyRoleKeys: ["admin", "ai_governance_admin"] } });
  return u;
}

export async function pauseRelease(req, id, { reason }) {
  const r = typeof id === "object" ? id : await loadRelease(req, id);
  if (!reason) throw bad("Give a reason for pausing.");
  if (!LIVE.includes(r.status) && r.status !== "Approved") throw bad(`A ${r.status.toLowerCase()} release can't be paused.`);
  const u = await prisma.aiRelease.update({ where: { id: r.id }, data: { status: "Paused", pausedAt: new Date() } });
  await prisma.aiCapability.updateMany({ where: { key: r.capabilityKey, currentReleaseId: r.id }, data: { status: "Paused" } });
  invalidateGovernanceCache();
  await aiAudit(req, "ai.release.paused", "AiRelease", r.id, { reason, before: { status: r.status }, after: { status: "Paused" } });
  return u;
}

// Rollback: this release → Rolled back (and blocked from re-promotion without
// review); the previous approved release is restored for the capability.
export async function rollbackRelease(req, r, { reason, automatic = false, trigger = null }) {
  if (!reason) throw bad("Give a reason for the rollback.");
  if (!["Paused", ...LIVE, "Approved"].includes(r.status)) throw bad(`A ${r.status.toLowerCase()} release can't be rolled back.`);
  const previous = r.previousReleaseId ? await prisma.aiRelease.findUnique({ where: { id: r.previousReleaseId } }) : null;
  // Governed actions pause while the transition happens (organization scope).
  const u = await prisma.aiRelease.update({ where: { id: r.id }, data: { status: "Rolled back", rolledBackAt: new Date(), promotionBlocked: true, promotionBlockReason: `Rolled back: ${String(reason).slice(0, 200)}` } });
  await prisma.aiRolloutCohort.updateMany({ where: { releaseId: r.id, status: "Active" }, data: { status: "Superseded" } });
  if (previous && ["Retired", "Paused", ...LIVE].includes(previous.status)) {
    await prisma.aiRelease.update({ where: { id: previous.id }, data: { status: previous.stage === "generally_available" || previous.status === "Retired" ? "Generally available" : STAGE_STATUS[previous.stage] || "Approved", retiredAt: null, rolledBackFromId: r.id } });
    await prisma.aiCapability.update({ where: { key: r.capabilityKey }, data: { currentReleaseId: previous.id, status: "Rolled back" } }).catch(() => {});
  } else {
    await prisma.aiCapability.update({ where: { key: r.capabilityKey }, data: { status: "Rolled back", currentReleaseId: null } }).catch(() => {});
  }
  invalidateGovernanceCache();
  await aiAudit(req, "ai.release.rolled_back", "AiRelease", r.id, { reason, before: { status: r.status, stage: r.stage }, after: { status: "Rolled back", restored: previous?.publicId || null, automatic, trigger } });
  await recordOutboxEvent(prisma, { aggregateType: "AiRelease", aggregateId: r.id, eventType: "ai.release.rolled_back", payload: { organizationId: r.organizationId, capabilityKey: r.capabilityKey, version: r.version, automatic, trigger, notifyRoleKeys: ["admin", "ai_governance_admin", "ai_safety_reviewer"] } });
  return { release: u, restored: previous };
}

export async function retireRelease(req, r, { reason }) {
  if (!reason) throw bad("Give a reason for retiring.");
  if (r.status === "Retired") return r;
  const u = await prisma.aiRelease.update({ where: { id: r.id }, data: { status: "Retired", retiredAt: new Date() } });
  await prisma.aiRolloutCohort.updateMany({ where: { releaseId: r.id, status: "Active" }, data: { status: "Superseded" } });
  invalidateGovernanceCache();
  await aiAudit(req, "ai.release.retired", "AiRelease", r.id, { reason, before: { status: r.status }, after: { status: "Retired" } });
  return u;
}

// Worker: canary/pilot stop conditions and declared incidents → automatic rollback.
export async function checkAutomaticRollback(now = new Date()) {
  const live = await prisma.aiRelease.findMany({ where: { status: { in: ["Pilot", "Canary"] } } });
  const actor = { user: null };
  let rolled = 0;
  for (const r of live) {
    const since = new Date(now.getTime() - 30 * 60_000);
    const cohort = await prisma.aiRolloutCohort.findFirst({ where: { releaseId: r.id, status: "Active" } });
    const stop = cohort?.stopConditions || {};
    const reqs = await prisma.aiRequest.findMany({ where: { releaseId: r.id, createdAt: { gte: since } }, select: { status: true, validation: true, durationMs: true, errorCategory: true } });
    const incident = await prisma.aiIncident.findFirst({ where: { capabilityKey: r.capabilityKey, status: { notIn: ["Resolved", "Closed"] }, severity: { in: ["SEV-0", "SEV-1"] } } });
    const critical = await prisma.aiSafetyEvent.count({ where: { capabilityKey: r.capabilityKey, severity: "Critical", createdAt: { gte: since }, NOT: { source: { startsWith: "evaluation:" } } } });
    let trigger = null;
    if (incident) trigger = `declared incident ${incident.publicId}`;
    else if (critical) trigger = "critical safety event (tenant isolation, restricted-field leakage or prohibited action)";
    else if (reqs.length >= 10) {
      const rate = (f) => (reqs.filter(f).length / reqs.length) * 100;
      const p95 = [...reqs.map((x) => x.durationMs || 0)].sort((a, b) => a - b)[Math.ceil(reqs.length * 0.95) - 1];
      if (stop.validationFailureRate !== undefined && rate((x) => x.validation && x.validation.ok === false) > stop.validationFailureRate) trigger = "validation-failure spike";
      else if (stop.providerErrorRate !== undefined && rate((x) => x.status === "Failed") > stop.providerErrorRate) trigger = "provider-error spike";
      else if (stop.p95LatencyMs !== undefined && p95 > stop.p95LatencyMs) trigger = "latency breach";
    }
    if (!trigger && stop.costPerRequestUsd !== undefined) {
      const usage = await prisma.aiUsageRecord.aggregate({ where: { releaseId: r.id, createdAt: { gte: since } }, _sum: { estimatedCost: true }, _count: true });
      if (usage._count >= 10 && Number(usage._sum.estimatedCost || 0) / usage._count > stop.costPerRequestUsd) trigger = "cost anomaly";
    }
    if (!trigger && stop.negativeFeedbackRate !== undefined) {
      const fb = await prisma.aiFeedback.findMany({ where: { createdAt: { gte: since }, requestId: { in: (await prisma.aiRequest.findMany({ where: { releaseId: r.id, createdAt: { gte: since } }, select: { id: true } })).map((x) => x.id) } } });
      if (fb.length >= 5 && (fb.filter((f) => ["Not Helpful", "Incorrect", "Unsafe"].includes(f.rating)).length / fb.length) * 100 > stop.negativeFeedbackRate) trigger = "negative-feedback spike";
    }
    if (trigger) { await rollbackRelease(actor, r, { reason: `Automatic rollback: ${trigger}`, automatic: true, trigger }); rolled += 1; }
  }
  return rolled;
}
