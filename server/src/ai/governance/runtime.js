// Backend Phase 11 — server-side governance checks, used by the gateway, the
// Copilot, workflows, tools and governed actions. Everything is read from the
// database (cached for at most CACHE_MS, invalidated in-process on change), so
// kill switches, flags and releases take effect without a redeploy. The model
// never reaches any of this: it cannot operate a kill switch or a flag.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiMode } from "../common/mode.js";
import { UNAVAILABLE_STATUSES, aiEnvironment } from "./catalog.js";

export const CACHE_MS = Number(process.env.AI_GOVERNANCE_CACHE_MS) || 2000;
let cache = null;
let loading = null;

export function invalidateGovernanceCache() { cache = null; }

async function load() {
  const [switches, flags, capabilities, releases, cohorts, tools, workflows, models, providers, prompts, pausedPolicies] = await Promise.all([
    prisma.aiKillSwitch.findMany({ where: { active: true } }),
    prisma.aiFeatureFlag.findMany(),
    prisma.aiCapability.findMany({ select: { key: true, name: true, status: true, riskLevel: true, currentReleaseId: true } }),
    prisma.aiRelease.findMany({ where: { status: { in: ["Shadow", "Pilot", "Canary", "Generally available"] } } }),
    prisma.aiRolloutCohort.findMany({ where: { status: "Active" } }),
    prisma.aiToolGovernance.findMany({ select: { toolName: true, version: true, status: true } }),
    prisma.aiWorkflowGovernance.findMany({ select: { workflowKey: true, version: true, status: true, checksum: true } }),
    prisma.aiModelGovernance.findMany({ select: { providerKey: true, modelId: true, releaseStatus: true } }),
    prisma.aiProviderGovernance.findMany({ select: { scope: true, providerKey: true, status: true } }),
    prisma.aiPromptGovernance.findMany({ select: { promptKey: true, version: true, status: true } }),
    prisma.aiGovernancePolicy.findMany({ where: { status: "Paused", capabilityKey: { not: null } }, select: { scope: true, capabilityKey: true } }),
  ]);
  return { at: Date.now(), switches, flags, capabilities: new Map(capabilities.map((c) => [c.key, c])), releases, cohorts, tools, workflows, models, providers, prompts, pausedPolicies };
}

export async function governanceSnapshot() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  loading ||= load().then((s) => { cache = s; loading = null; return s; }, (e) => { loading = null; throw e; });
  return loading;
}

const deny = (message, kind, target, category = CATEGORIES.POLICY) => new AiError(category, message, { details: { governance: { kind, target } } });

export function activeSwitch(snap, kind, target, organizationId) {
  return snap.switches.find((s) => s.kind === kind && (s.target === target || s.target === "*") && (s.scope === "platform" || s.scope === organizationId)) || null;
}

const roleKeysOf = (req) => (req?.membership?.roles || []).map((r) => r.role?.key).filter(Boolean);

// A member matches targeting only on dimensions this backend can check.
// Department/team targeting fails closed (there is no department/team model).
function matchesTargeting(t = {}, req) {
  if (t.departmentIds?.length || t.teamIds?.length) return false;
  if (t.roleKeys?.length && !roleKeysOf(req).some((k) => t.roleKeys.includes(k))) return false;
  if (t.membershipIds?.length && !t.membershipIds.includes(req?.membership?.id)) return false;
  return true;
}

// Organization-scoped flags win over platform flags; environment-specific
// over "all". The browser never decides this.
export function flagEnabled(snap, key, req, environment = aiEnvironment()) {
  const orgId = req?.organizationId;
  const pick = (scope) => snap.flags.find((f) => f.key === key && f.scope === scope && f.environment === environment) || snap.flags.find((f) => f.key === key && f.scope === scope && f.environment === "all");
  const f = (orgId && pick(orgId)) || pick("platform");
  if (!f) return false;
  return f.enabled && matchesTargeting(f.targeting, req);
}

const bucket = (a, b) => parseInt(crypto.createHash("sha256").update(`${a}:${b}`).digest("hex").slice(0, 8), 16) % 100;

export function inCohort(cohort, req) {
  const r = cohort.rules || {};
  if (r.organizationIds?.length && !r.organizationIds.includes(req.organizationId)) return false;
  if (!matchesTargeting(r, req)) return false;
  if (typeof r.percentage === "number" && r.percentage < 100 && bucket(req.membership?.id || req.user?.id || "", cohort.releaseId) >= r.percentage) return false;
  return true;
}

// The release this member is served for a capability (or null).
export function releaseFor(snap, capabilityKey, req) {
  const candidates = snap.releases.filter((r) => r.capabilityKey === capabilityKey && r.status !== "Shadow" && (r.scope === "platform" || r.scope === req.organizationId));
  const ordered = candidates.sort((a, b) => (a.scope === "platform") - (b.scope === "platform") || b.version - a.version);
  for (const r of ordered) {
    if (r.status === "Generally available") return r;
    const cohorts = snap.cohorts.filter((c) => c.releaseId === r.id);
    if (cohorts.some((c) => inCohort(c, req))) return r;
  }
  return null;
}
export const shadowReleaseFor = (snap, capabilityKey, req) =>
  snap.releases.find((r) => r.capabilityKey === capabilityKey && r.status === "Shadow" && (r.scope === "platform" || r.scope === req.organizationId)) || null;

// → { capabilityKey, release, shadowRelease } or throws a POLICY/PERMISSION AiError.
export async function checkCapability(req, capabilityKey, { evaluation = false } = {}) {
  if (!req?.organizationId || !(req.user?.id || req.membership?.id)) throw deny("AI requires an authenticated organization member.", "session", null, CATEGORIES.PERMISSION);
  const snap = await governanceSnapshot();
  if (activeSwitch(snap, "global", "*", req.organizationId)) throw deny("AI is paused by an administrator.", "global", "*");
  if (!evaluation && activeSwitch(snap, "organization", req.organizationId, req.organizationId)) throw deny("AI is paused for your organization by an administrator.", "organization", req.organizationId);
  if (!capabilityKey || evaluation) return { capabilityKey, release: null, shadowRelease: null, snap };
  const cap = snap.capabilities.get(capabilityKey);
  if (!cap) throw deny("This AI capability isn't registered in AI governance.", "capability", capabilityKey);
  if (activeSwitch(snap, "capability", capabilityKey, req.organizationId)) throw deny(`${cap.name} is paused by an administrator.`, "capability", capabilityKey);
  if (snap.pausedPolicies.some((p) => p.capabilityKey === capabilityKey && (p.scope === "platform" || p.scope === req.organizationId))) throw deny(`${cap.name} is paused by an AI governance policy.`, "policy", capabilityKey);
  if (UNAVAILABLE_STATUSES.includes(cap.status)) throw deny(`${cap.name} isn't available (${cap.status.toLowerCase()}).`, "capability", capabilityKey);
  const release = releaseFor(snap, capabilityKey, req);
  const flagged = flagEnabled(snap, `capability.${capabilityKey}`, req);
  if (!flagged && !release) throw deny(`${cap.name} isn't enabled for your organization.`, "flag", capabilityKey);
  // Production: only an approved release (pilot, canary or generally available) serves users.
  if (aiEnvironment() === "production" && !release) throw deny(`${cap.name} has no approved release for your organization yet.`, "release", capabilityKey);
  return { capabilityKey, release, shadowRelease: shadowReleaseFor(snap, capabilityKey, req), snap };
}

// Provider and model: kill switches and governance state.
export async function checkTarget(req, { providerKey, modelId }) {
  const snap = await governanceSnapshot();
  if (activeSwitch(snap, "provider", providerKey, req.organizationId)) throw deny(`The ${providerKey} provider is paused by an administrator.`, "provider", providerKey);
  if (modelId && activeSwitch(snap, "model", `${providerKey}:${modelId}`, req.organizationId)) throw deny(`The model ${modelId} is paused by an administrator.`, "model", `${providerKey}:${modelId}`);
  const pg = snap.providers.find((p) => p.providerKey === providerKey && p.scope === req.organizationId) || snap.providers.find((p) => p.providerKey === providerKey && p.scope === "platform");
  if (pg && ["Suspended", "Policy blocked", "Credential expired"].includes(pg.status)) throw deny(`The ${providerKey} provider is ${pg.status.toLowerCase()} in AI governance.`, "provider", providerKey);
  const mg = modelId && snap.models.find((m) => m.providerKey === providerKey && m.modelId === modelId);
  if (mg && ["Blocked", "Retired"].includes(mg.releaseStatus)) throw deny(`The model ${modelId} is ${mg.releaseStatus.toLowerCase()} in AI governance.`, "model", `${providerKey}:${modelId}`);
}

// Tools are deny-by-default: only a governed, Active version is exposed.
export async function checkTool(req, toolName, version) {
  const snap = await governanceSnapshot();
  if (activeSwitch(snap, "tool", toolName, req.organizationId)) return { ok: false, reason: "tool_killed", message: `The ${toolName} tool is paused by an administrator.` };
  const g = snap.tools.find((t) => t.toolName === toolName && t.version === String(version));
  if (!g || g.status !== "Active") return { ok: false, reason: "tool_not_activated", message: `The ${toolName} tool isn't activated in AI governance.` };
  return { ok: true };
}
export async function activeToolNames(req, version) {
  const snap = await governanceSnapshot();
  return new Set(snap.tools.filter((t) => t.version === String(version) && t.status === "Active" && !activeSwitch(snap, "tool", t.toolName, req.organizationId)).map((t) => t.toolName));
}

// Workflows: only the governed, Active version whose steps match the code runs.
export async function checkWorkflow(req, workflowKey, checksum) {
  const snap = await governanceSnapshot();
  if (activeSwitch(snap, "workflow", workflowKey, req.organizationId)) throw deny("This workflow is paused by an administrator.", "workflow", workflowKey);
  const g = snap.workflows.find((w) => w.workflowKey === workflowKey && w.checksum === checksum);
  if (!g || g.status !== "Active") throw deny("This workflow version isn't activated in AI governance.", "workflow", workflowKey);
}

export async function checkActionExecution(organizationId) {
  const snap = await governanceSnapshot();
  if (activeSwitch(snap, "global", "*", organizationId)) throw deny("AI is paused by an administrator.", "global", "*");
  if (activeSwitch(snap, "action_execution", "*", organizationId)) throw deny("Applying AI proposals is paused by an administrator.", "action_execution", "*");
}

export async function semanticAllowed(req) {
  const snap = await governanceSnapshot();
  if (activeSwitch(snap, "semantic_retrieval", "*", req.organizationId)) return false;
  try { await checkCapability(req, "semantic_retrieval", { evaluation: !!req.aiEvaluation }); return true; } catch { return false; }
}

export async function providerStorageAllowed(organizationId) {
  const snap = await governanceSnapshot();
  return !activeSwitch(snap, "provider_storage", "*", organizationId);
}

// The prompt version to use: the Active governed version, or (evaluations
// only) an explicitly requested candidate that isn't retired.
export async function promptVersionFor(promptKey, { candidateVersion = null, evaluation = false } = {}) {
  const snap = await governanceSnapshot();
  if (candidateVersion && evaluation) {
    const c = snap.prompts.find((p) => p.promptKey === promptKey && p.version === Number(candidateVersion));
    if (c && !["Retired", "Superseded"].includes(c.status)) return c.version;
  }
  const active = snap.prompts.find((p) => p.promptKey === promptKey && p.status === "Active");
  if (!active) throw deny(`The ${promptKey} prompt has no approved, active version.`, "prompt", promptKey);
  return active.version;
}

// Stable, versioned, HMAC-derived safety identifier for providers that accept
// one. Never a name, email or raw account id.
export function safetyIdentifier(req) {
  const secret = process.env.AI_SAFETY_ID_SECRET || (aiMode() === "simulator" && process.env.NODE_ENV !== "production" ? "dev-only-safety-id-secret" : null);
  if (!secret || !req?.user?.id || !req?.organizationId) return null;
  const version = process.env.AI_SAFETY_ID_VERSION || "1";
  const id = crypto.createHmac("sha256", secret).update(`${version}:${req.organizationId}:${req.user.id}`).digest("hex").slice(0, 32);
  return { id: `sid${version}_${id}`, version };
}
