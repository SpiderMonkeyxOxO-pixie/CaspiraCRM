// Backend Phase 11 — the governed registry: capabilities, providers, models,
// prompts, tools, workflows and feature flags. Contractual, residency,
// privacy and retention fields stay "Unverified" until an authorized
// administrator confirms them (recorded with who and when). Prompts are
// immutable once published and are never edited in place; tools and
// workflows are deny-by-default until activated through the gate.
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { TOOLS, PROPOSAL_TOOLS, TOOL_REGISTRY_VERSION } from "../copilot/tools/registry.js";
import { WORKFLOWS, workflowChecksum, WORKFLOW_LIMITS } from "../copilot/workflows.js";
import { templateChecksum } from "../catalogSeed.js";
import { invalidateGovernanceCache } from "./runtime.js";
import { RISK_LEVELS, PROHIBITED_AUTOMATIONS, CAPABILITY_STATUSES, aiEnvironment } from "./catalog.js";
import { isSystemOwner } from "./killSwitches.js";

const bad = (m, status = 422) => Object.assign(new AiError(CATEGORIES.INVALID_REQUEST, m), { httpStatus: status });
const recentPassingSuite = async (keys, days = 30) => prisma.aiEvalRun.findFirst({ where: { status: { in: ["Passed", "Passed with warnings"] }, completedAt: { gte: new Date(Date.now() - days * 86_400_000) }, suiteId: { in: (await prisma.aiEvaluationSuite.findMany({ where: { key: { in: keys } }, select: { id: true } })).map((s) => s.id) } }, orderBy: { completedAt: "desc" } });

// ---- Capabilities ------------------------------------------------------------------

export const serializeCapability = (c, extra = {}) => ({ _id: c.id, key: c.key, name: c.name, description: c.description, purpose: c.purpose, riskLevel: c.riskLevel, owners: c.owners, organizationScope: c.organizationScope, roles: c.roles, modules: c.modules, dataClassifications: c.dataClassifications, providers: c.providers, models: c.models, promptVersions: c.promptVersions, toolVersions: c.toolVersions, workflowVersions: c.workflowVersions, requiredApprovals: c.requiredApprovals, evaluationSuiteKey: c.evaluationSuiteKey, retentionPolicy: c.retentionPolicy, budgetPolicy: c.budgetPolicy, status: c.status, currentReleaseId: c.currentReleaseId, lastReviewAt: c.lastReviewAt, nextReviewAt: c.nextReviewAt, sunsetAt: c.sunsetAt, version: c.version, updatedAt: c.updatedAt, ...extra });

const CAP_FIELDS = ["name", "description", "purpose", "riskLevel", "owners", "organizationScope", "roles", "modules", "dataClassifications", "providers", "models", "promptVersions", "toolVersions", "workflowVersions", "requiredApprovals", "evaluationSuiteKey", "retentionPolicy", "budgetPolicy", "nextReviewAt", "sunsetAt"];

function checkCapabilityBody(body) {
  for (const a of body.automations || []) if (PROHIBITED_AUTOMATIONS.includes(a)) throw bad(`"${a}" is a prohibited AI automation; it can't be registered as a capability.`, 403);
  if (body.riskLevel && !RISK_LEVELS.includes(body.riskLevel)) throw bad(`riskLevel: ${RISK_LEVELS.join(", ")}.`);
  if (body.riskLevel === "Prohibited") throw bad("Prohibited AI automation can't be registered as a usable capability.", 403);
}

export async function createCapability(req, body) {
  if (!isSystemOwner(req)) throw bad("Capabilities are registered platform-wide by a System Owner.", 403);
  checkCapabilityBody(body);
  if (!/^[a-z][a-z0-9_]{2,60}$/.test(body.key || "")) throw bad("key: lowercase letters, digits and underscores.");
  if (await prisma.aiCapability.findUnique({ where: { key: body.key } })) throw bad("A capability with this key exists.", 409);
  for (const f of ["name", "description", "purpose", "riskLevel"]) if (!body[f]) throw bad(`${f} is required.`);
  const data = Object.fromEntries(CAP_FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, f.endsWith("At") ? new Date(body[f]) : body[f]]));
  const c = await prisma.aiCapability.create({ data: { key: body.key, ...data, status: "Draft" } });
  await prisma.aiCapabilityVersion.create({ data: { capabilityId: c.id, version: 1, snapshot: c, changeSummary: "Registered", createdByUserId: req.user?.id || null } });
  await aiAudit(req, "ai.capability.created", "AiCapability", c.id, { after: { key: c.key, riskLevel: c.riskLevel } });
  return c;
}

export async function updateCapability(req, key, body) {
  if (!isSystemOwner(req)) throw bad("Capabilities are changed platform-wide by a System Owner.", 403);
  const c = await prisma.aiCapability.findUnique({ where: { key } });
  if (!c) throw bad("Unknown capability.", 404);
  checkCapabilityBody(body);
  if (!body.changeSummary) throw bad("Describe the change (changeSummary).");
  if (body.status && !CAPABILITY_STATUSES.includes(body.status)) throw bad("Invalid status.");
  if (body.status && ["Pilot", "Canary", "Generally available", "Ready for pilot"].includes(body.status)) throw bad("Rollout statuses are set by promoting a release, not by editing the capability.");
  const data = Object.fromEntries(CAP_FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, f.endsWith("At") ? new Date(body[f]) : body[f]]));
  if (body.status) data.status = body.status;
  if (body.reviewed) data.lastReviewAt = new Date();
  const u = await prisma.aiCapability.update({ where: { key }, data: { ...data, version: { increment: 1 } } });
  await prisma.aiCapabilityVersion.create({ data: { capabilityId: c.id, version: u.version, snapshot: u, changeSummary: String(body.changeSummary).slice(0, 500), createdByUserId: req.user?.id || null } });
  invalidateGovernanceCache();
  await aiAudit(req, "ai.capability.updated", "AiCapability", c.id, { before: { status: c.status, version: c.version }, after: { status: u.status, version: u.version, fields: Object.keys(data) } });
  return u;
}

// ---- Providers -------------------------------------------------------------------------

const CONFIRMABLE = ["dpaStatus", "residencyStatus", "retentionMode", "zdrEligibility"];
const PROVIDER_FIELDS = ["contractOwner", "approvedClassifications", "prohibitedClassifications", "region", "hostedStorage", "approvedModels", "rateLimits", "spendLimits", "incidentContact", "nextReviewAt", "deprecations", "limitations", ...CONFIRMABLE];

export async function providerGovernanceFor(req, providerKey) {
  const org = await prisma.aiProviderGovernance.findUnique({ where: { scope_providerKey: { scope: req.organizationId, providerKey } } });
  if (org) return org;
  const base = await prisma.aiProviderGovernance.findUnique({ where: { scope_providerKey: { scope: "platform", providerKey } } });
  if (!base) throw bad("Unknown provider.", 404);
  return base;
}

// Organization copy of the provider record (contracts are per organization).
export async function updateProviderGovernance(req, providerKey, body) {
  const base = await providerGovernanceFor(req, providerKey);
  const data = Object.fromEntries(PROVIDER_FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, f === "nextReviewAt" ? new Date(body[f]) : body[f]]));
  const confirmations = { ...(base.confirmations || {}) };
  for (const f of CONFIRMABLE) {
    if (body[f] === undefined) continue;
    const v = String(body[f]);
    // "Verified"-style values need an explicit confirmation note by an authorized administrator.
    if (/^(Confirmed|Verified|Eligible)/i.test(v)) {
      if (!body.confirmationNote) throw bad(`Confirming ${f} needs a confirmationNote (what was reviewed).`);
      confirmations[f] = { byUserId: req.user?.id || null, at: new Date().toISOString(), note: String(body.confirmationNote).slice(0, 500) };
    } else delete confirmations[f];
  }
  if (body.securityReviewed) data.lastSecurityReviewAt = new Date();
  const scope = req.organizationId;
  const { id, createdAt, updatedAt, scope: _s, organizationId: _o, ...copy } = base;
  const row = base.scope === scope
    ? await prisma.aiProviderGovernance.update({ where: { id: base.id }, data: { ...data, confirmations, version: { increment: 1 } } })
    : await prisma.aiProviderGovernance.create({ data: { ...copy, ...data, confirmations, scope, organizationId: scope, version: 1 } });
  invalidateGovernanceCache();
  await aiAudit(req, "ai.provider_governance.updated", "AiProviderGovernance", row.id, { before: Object.fromEntries(Object.keys(data).map((k) => [k, base[k]])), after: { ...data, confirmed: Object.keys(confirmations) } });
  return row;
}

// Verification through the Phase 9 connection check (a live provider call only
// when a live connection exists; the simulator is local).
export async function verifyProviderGovernance(req, providerKey) {
  const { verifyAiConnection } = await import("../connections/connectionService.js");
  const conn = providerKey === "simulator" ? null : await prisma.aiProviderConnection.findFirst({ where: { organizationId: req.organizationId, providerKey, status: { not: "Revoked" } }, orderBy: { updatedAt: "desc" } });
  let status; let credentialStatus;
  if (providerKey === "simulator") { status = "Verified"; credentialStatus = "Not required"; }
  else if (!conn) { status = "Not configured"; credentialStatus = "Not configured"; }
  else {
    try { const out = await verifyAiConnection(conn); status = ["Connected", "Connected with Warnings"].includes(out?.status || conn.status) ? "Verified" : "Verification pending"; credentialStatus = status === "Verified" ? "Valid" : "Invalid"; }
    catch { status = "Verification pending"; credentialStatus = "Invalid"; }
  }
  const row = await updateProviderGovernance(req, providerKey, {});
  const u = await prisma.aiProviderGovernance.update({ where: { id: row.id }, data: { status, credentialStatus, lastVerifiedAt: status === "Verified" ? new Date() : row.lastVerifiedAt } });
  invalidateGovernanceCache();
  await aiAudit(req, "ai.provider_governance.verified", "AiProviderGovernance", u.id, { after: { providerKey, status, credentialStatus, mode: providerKey === "simulator" ? "Simulator" : conn?.mode || null } });
  return u;
}

export async function setProviderStatus(req, providerKey, { status, reason }) {
  const allowed = ["Suspended", "Policy blocked", "Configured", "Degraded"];
  if (!allowed.includes(status)) throw bad(`status: ${allowed.join(", ")} (verification sets Verified).`);
  if (!reason) throw bad("Give a reason.");
  const row = await updateProviderGovernance(req, providerKey, {});
  const u = await prisma.aiProviderGovernance.update({ where: { id: row.id }, data: { status } });
  invalidateGovernanceCache();
  await aiAudit(req, status === "Suspended" || status === "Policy blocked" ? "ai.provider.disabled" : "ai.provider.enabled", "AiProviderGovernance", u.id, { reason, before: { status: row.status }, after: { status } });
  return u;
}

// ---- Models ----------------------------------------------------------------------------

export async function updateModelGovernance(req, id, body) {
  const m = await prisma.aiModelGovernance.findUnique({ where: { id: String(id) } });
  if (!m) throw bad("Model not found.", 404);
  const data = {};
  for (const f of ["displayName", "approvedUseCases", "prohibitedUseCases", "pricingVersion", "replacementModelId", "rollbackModelId", "pinned"]) if (body[f] !== undefined) data[f] = body[f];
  if (body.deprecationAt !== undefined) data.deprecationAt = body.deprecationAt ? new Date(body.deprecationAt) : null;
  if (body.releaseStatus) {
    if (!["Draft", "Blocked", "Retired"].includes(body.releaseStatus)) throw bad("releaseStatus: Draft, Blocked or Retired (approval goes through /approve).");
    if (!body.reason) throw bad("Give a reason.");
    data.releaseStatus = body.releaseStatus;
  }
  const u = await prisma.aiModelGovernance.update({ where: { id: m.id }, data: { ...data, version: { increment: 1 } } });
  invalidateGovernanceCache();
  await aiAudit(req, "ai.model_governance.updated", "AiModelGovernance", m.id, { reason: body.reason, before: Object.fromEntries(Object.keys(data).map((k) => [k, m[k]])), after: data });
  return u;
}

// Approving a model needs evidence: a passing evaluation with this model as
// the candidate, a comparison (evaluation, cost, latency) and someone other
// than whoever last configured the model.
export async function approveModel(req, id, { runId, comparisonId, reason }) {
  const m = await prisma.aiModelGovernance.findUnique({ where: { id: String(id) } });
  if (!m) throw bad("Model not found.", 404);
  if (!reason) throw bad("Give a reason.");
  if (!m.pinned) throw bad("Pin a dated model version before approving it; moving aliases aren't approved for production.");
  const run = await prisma.aiEvalRun.findFirst({ where: { publicId: String(runId || "") } });
  if (!run || !["Passed", "Passed with warnings"].includes(run.status) || run.candidate?.modelId !== m.modelId) throw bad("Needs a passing evaluation run with this model as the candidate (contract, structured-output and tool behavior are part of the suite).");
  const cmp = comparisonId ? await prisma.aiEvaluationComparison.findUnique({ where: { id: String(comparisonId) } }) : null;
  if (!cmp || cmp.candidateRunId !== run.id) throw bad("Needs a comparison (evaluation, cost and latency) against the current model with that run as the candidate.");
  if (cmp.summary?.safety?.candidateWorse) throw bad("The comparison shows a safety regression; the model can't be approved.");
  const lastConfig = await prisma.auditEvent.findFirst({ where: { targetType: "AiModelGovernance", targetId: m.id, action: "ai.model_governance.updated" }, orderBy: { createdAt: "desc" } });
  if (lastConfig?.actorUserId && lastConfig.actorUserId === req.user?.id) throw bad("The person who configured this model can't be the one who approves it.", 403);
  const u = await prisma.aiModelGovernance.update({ where: { id: m.id }, data: { releaseStatus: "Approved", evaluationStatus: run.status === "Passed" ? "Passed" : "Passed with warnings", lastVerifiedAt: new Date(), version: { increment: 1 } } });
  await prisma.aiGovernanceApproval.create({ data: { subjectType: "Model", subjectId: m.id, reviewerUserId: req.user.id, decision: "Approve", reason: String(reason).slice(0, 500) } });
  invalidateGovernanceCache();
  await aiAudit(req, "ai.model.approved", "AiModelGovernance", m.id, { reason, after: { runId: run.publicId, comparison: cmp.id } });
  return u;
}

// ---- Prompts ---------------------------------------------------------------------------

const PROMPT_FLOW = { Draft: ["Internal testing"], "Internal testing": ["Evaluation", "Draft"], Evaluation: ["Under review", "Draft"], "Under review": ["Approved", "Draft"], Approved: ["Active", "Retired"], Active: ["Retired"], Superseded: ["Retired"] };

// A new prompt version (never an edit). Untrusted CRM values can't reach the
// system instructions: the system text may not contain any placeholder.
export async function createPromptVersion(req, { promptKey, system, userTemplate, outputSchema = null, changeSummary, providerCompat = ["openai", "anthropic", "simulator"], safetyInstructions = "", citationRules = "", refusalBehavior = "", humanApproval = "" }) {
  const t = await prisma.aiPromptTemplate.findUnique({ where: { key: String(promptKey || "") } });
  if (!t) throw bad("Unknown prompt.", 404);
  if (!system || !userTemplate || !changeSummary) throw bad("system, userTemplate and changeSummary are required.");
  if (/\{\{[^}]*\}\}/.test(system)) throw bad("System instructions can't contain placeholders: CRM values never go into system or developer instructions.");
  if (!/<data>/.test(userTemplate) && /\{\{/.test(userTemplate)) throw bad("CRM data placeholders must sit inside <data>…</data> blocks in the user template.");
  const last = await prisma.aiPromptTemplateVersion.findFirst({ where: { templateId: t.id }, orderBy: { version: "desc" } });
  const version = (last?.version || 0) + 1;
  const checksum = templateChecksum({ system, userTemplate, outputSchema });
  await prisma.aiPromptTemplateVersion.create({ data: { templateId: t.id, version, system, userTemplate, outputSchema, status: "Draft", checksum } });
  const g = await prisma.aiPromptGovernance.create({ data: { promptKey: t.key, version, capabilityKey: t.useCaseKey?.startsWith("copilot") ? "ai_copilot" : t.useCaseKey === "action.proposal" ? "suggested_actions" : "ai_overview", status: "Draft", providerCompat, outputSchema, checksum, changeSummary: String(changeSummary).slice(0, 500), authorUserId: req.user?.id || null, safetyInstructions, citationRules, refusalBehavior, humanApproval } });
  await aiAudit(req, "ai.prompt.version_created", "AiPromptGovernance", g.id, { after: { promptKey: t.key, version, checksum } });
  return g;
}

export async function transitionPrompt(req, id, { to, runId = null, reason }) {
  const g = await prisma.aiPromptGovernance.findUnique({ where: { id: String(id) } });
  if (!g) throw bad("Prompt version not found.", 404);
  if (!(PROMPT_FLOW[g.status] || []).includes(to)) throw bad(`A ${g.status.toLowerCase()} prompt can't move to ${to}.`);
  if (!reason) throw bad("Give a reason.");
  const data = { status: to };
  if (to === "Under review" || to === "Approved") {
    const run = await prisma.aiEvalRun.findFirst({ where: { publicId: String(runId || "") } });
    if (!run || !["Passed", "Passed with warnings"].includes(run.status) || Number(run.candidate?.promptVersions?.[g.promptKey]) !== g.version) throw bad("Needs a passing evaluation run with this prompt version as the candidate.");
    data.evaluationRunIds = [...new Set([...(g.evaluationRunIds || []), run.publicId])];
  }
  if (to === "Approved" || to === "Active") {
    if (g.authorUserId && g.authorUserId === req.user?.id) throw bad("The prompt author can't approve or publish their own prompt.", 403);
  }
  if (to === "Approved") { data.approvedAt = new Date(); data.reviewers = [...new Set([...(g.reviewers || []), req.user?.id])]; }
  if (to === "Active") {
    const t = await prisma.aiPromptTemplate.findUnique({ where: { key: g.promptKey } });
    const tv = await prisma.aiPromptTemplateVersion.findUnique({ where: { templateId_version: { templateId: t.id, version: g.version } } });
    if (tv.checksum !== g.checksum) throw bad("The stored prompt doesn't match its approved checksum.");
    // Publish (immutable) and supersede the previous active version.
    await prisma.aiPromptTemplateVersion.update({ where: { id: tv.id }, data: { status: "Published", publishedAt: new Date() } });
    await prisma.aiPromptGovernance.updateMany({ where: { promptKey: g.promptKey, status: "Active", id: { not: g.id } }, data: { status: "Superseded" } });
    data.activatedAt = new Date();
  }
  if (to === "Retired") data.retiredAt = new Date();
  const u = await prisma.aiPromptGovernance.update({ where: { id: g.id }, data });
  invalidateGovernanceCache();
  await aiAudit(req, to === "Active" ? "ai.prompt.published" : "ai.prompt.transitioned", "AiPromptGovernance", g.id, { reason, before: { status: g.status }, after: { status: to, runId } });
  return u;
}

// ---- Tools and workflows -------------------------------------------------------------

// Activation gate: registered, schema present in code, a passing authorization /
// tenant-isolation / sensitive-data / injection suite, and an approval by
// someone other than the requester.
export async function transitionTool(req, id, { to, reason, runId = null }) {
  const t = await prisma.aiToolGovernance.findUnique({ where: { id: String(id) } });
  if (!t) throw bad("Tool not found.", 404);
  if (!reason) throw bad("Give a reason.");
  const flow = { Draft: ["Under review"], "Under review": ["Approved", "Draft"], Approved: ["Active", "Retired"], Active: ["Paused", "Retired"], Paused: ["Active", "Retired"] };
  if (!(flow[t.status] || []).includes(to)) throw bad(`A ${t.status.toLowerCase()} tool can't move to ${to}.`);
  const activation = { ...(t.activation || {}) };
  if (to === "Approved" || to === "Active") {
    const code = TOOLS[t.toolName] || PROPOSAL_TOOLS[t.toolName];
    if (!code || !code.schema) throw bad("The tool has no code or input schema in this version.");
    if (code.unavailable) throw bad(`The tool is unavailable: ${code.unavailable}`);
    if (t.version !== TOOL_REGISTRY_VERSION) throw bad(`Only registry version ${TOOL_REGISTRY_VERSION} can be activated.`);
    const run = runId ? await prisma.aiEvalRun.findFirst({ where: { publicId: String(runId), status: { in: ["Passed", "Passed with warnings"] } } }) : await recentPassingSuite(["ai_copilot_release", "zero_tolerance_quick"]);
    if (!run) throw bad("Needs a passing authorization, tenant-isolation, sensitive-data and prompt-injection suite run in the last 30 days.");
    activation.evaluationRun = run.publicId;
  }
  if (to === "Active") {
    const approvals = await prisma.aiGovernanceApproval.findMany({ where: { subjectType: "Tool", subjectId: t.id, decision: "Approve" } });
    if (!approvals.some((a) => a.reviewerUserId !== req.user?.id)) throw bad("Activation needs a release approval by someone other than the person activating it.", 403);
  }
  if (to === "Approved") await prisma.aiGovernanceApproval.create({ data: { subjectType: "Tool", subjectId: t.id, reviewerUserId: req.user.id, decision: "Approve", reason: String(reason).slice(0, 500) } });
  const u = await prisma.aiToolGovernance.update({ where: { id: t.id }, data: { status: to, activation: { ...activation, [`${to.toLowerCase()}By`]: req.user?.id, [`${to.toLowerCase()}At`]: new Date().toISOString() }, activatedAt: to === "Active" ? new Date() : t.activatedAt, rowVersion: { increment: 1 } } });
  invalidateGovernanceCache();
  await aiAudit(req, to === "Active" ? "ai.tool.activated" : "ai.tool.transitioned", "AiToolGovernance", t.id, { reason, before: { status: t.status }, after: { status: to } });
  return u;
}

// Registers the code's current workflow definitions as new versions when
// their steps changed (the new version starts as Draft: not runnable).
export async function registerWorkflowVersions(req) {
  const out = [];
  for (const [key, w] of Object.entries(WORKFLOWS)) {
    const checksum = workflowChecksum(w);
    if (await prisma.aiWorkflowGovernance.findFirst({ where: { workflowKey: key, checksum } })) continue;
    const last = await prisma.aiWorkflowGovernance.findFirst({ where: { workflowKey: key }, orderBy: { version: "desc" } });
    const row = await prisma.aiWorkflowGovernance.create({ data: { workflowKey: key, version: (last?.version || 0) + 1, purpose: w.description, steps: w.steps, tools: [...new Set(w.steps.filter((s) => s.tool).map((s) => s.tool))], maxProviderCalls: 3, maxToolCalls: WORKFLOW_LIMITS.maxToolCalls, maxRuntimeMs: WORKFLOW_LIMITS.maxRuntimeMs, maxCostUsd: WORKFLOW_LIMITS.maxCostUsd, checksum, status: "Draft" } });
    out.push(row);
    await aiAudit(req, "ai.workflow.version_registered", "AiWorkflowGovernance", row.id, { after: { workflowKey: key, version: row.version } });
  }
  return out;
}

export async function transitionWorkflow(req, id, { to, reason, runId = null }) {
  const w = await prisma.aiWorkflowGovernance.findUnique({ where: { id: String(id) } });
  if (!w) throw bad("Workflow version not found.", 404);
  if (!reason) throw bad("Give a reason.");
  const flow = { Draft: ["Under review"], "Under review": ["Approved", "Draft"], Approved: ["Active", "Retired"], Active: ["Paused", "Retired"], Paused: ["Active", "Retired"] };
  if (!(flow[w.status] || []).includes(to)) throw bad(`A ${w.status.toLowerCase()} workflow can't move to ${to}.`);
  if (to === "Approved" || to === "Active") {
    const code = WORKFLOWS[w.workflowKey];
    if (!code || workflowChecksum(code) !== w.checksum) throw bad("This version's steps don't match the code; register the code's version instead.");
    const run = runId ? await prisma.aiEvalRun.findFirst({ where: { publicId: String(runId), status: { in: ["Passed", "Passed with warnings"] } } }) : await recentPassingSuite(["ai_copilot_release"]);
    if (!run) throw bad("Needs a passing Copilot evaluation run in the last 30 days.");
  }
  if (to === "Active") {
    const approvals = await prisma.aiGovernanceApproval.findMany({ where: { subjectType: "Workflow", subjectId: w.id, decision: "Approve" } });
    if (!approvals.some((a) => a.reviewerUserId !== req.user?.id)) throw bad("Activation needs an approval by someone other than the person activating it.", 403);
    await prisma.aiWorkflowGovernance.updateMany({ where: { workflowKey: w.workflowKey, status: "Active", id: { not: w.id } }, data: { status: "Retired" } });
  }
  if (to === "Approved") await prisma.aiGovernanceApproval.create({ data: { subjectType: "Workflow", subjectId: w.id, reviewerUserId: req.user.id, decision: "Approve", reason: String(reason).slice(0, 500) } });
  const u = await prisma.aiWorkflowGovernance.update({ where: { id: w.id }, data: { status: to, activatedAt: to === "Active" ? new Date() : w.activatedAt } });
  invalidateGovernanceCache();
  await aiAudit(req, to === "Active" ? "ai.workflow.activated" : "ai.workflow.transitioned", "AiWorkflowGovernance", w.id, { reason, before: { status: w.status }, after: { status: to } });
  return u;
}

// ---- Feature flags -----------------------------------------------------------------------

export async function setFeatureFlag(req, { key, enabled, environment = aiEnvironment(), targeting = {}, platform = false, description = "", reason }) {
  if (!/^capability\.[a-z0-9_]+$|^[a-z][a-z0-9_.]{2,80}$/.test(String(key || ""))) throw bad("Invalid flag key.");
  if (!reason) throw bad("Give a reason.");
  if (platform && !isSystemOwner(req)) throw bad("Platform flags are set by a System Owner.", 403);
  const capabilityKey = key.startsWith("capability.") ? key.slice(11) : null;
  if (capabilityKey) {
    const cap = await prisma.aiCapability.findUnique({ where: { key: capabilityKey } });
    if (!cap) throw bad("Unknown capability.", 404);
    if (enabled && (cap.riskLevel === "Prohibited" || cap.status === "Blocked")) throw bad("A blocked capability can't be enabled.", 403);
    if (enabled && environment === "production" && !["Pilot", "Canary", "Generally available", "Rolled back"].includes(cap.status)) throw bad("In production a capability is enabled through an approved release (pilot, canary or general availability), not a flag alone.", 409);
  }
  const scope = platform ? "platform" : req.organizationId;
  const before = await prisma.aiFeatureFlag.findUnique({ where: { key_scope_environment: { key, scope, environment } } });
  const f = await prisma.aiFeatureFlag.upsert({ where: { key_scope_environment: { key, scope, environment } }, update: { enabled: !!enabled, targeting, description, updatedByUserId: req.user?.id, version: { increment: 1 } }, create: { key, scope, organizationId: platform ? null : req.organizationId, environment, capabilityKey, targeting, enabled: !!enabled, description, updatedByUserId: req.user?.id } });
  invalidateGovernanceCache();
  await aiAudit(req, "ai.feature_flag.set", "AiFeatureFlag", f.id, { reason, before: before ? { enabled: before.enabled, targeting: before.targeting } : null, after: { key, enabled: f.enabled, environment, scope: platform ? "platform" : "organization", targeting } });
  return f;
}

export const canManageRegistry = (req, kind) => hasGrant(req, `ai_gov_${kind}`, "manage");
