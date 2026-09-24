// Backend Phase 11 — kill switches. Checked server-side on every AI path
// (runtime.js); take effect without a redeploy; need permission and a written
// reason; are audited and notified; stop new work and cancel queued work
// (active work per the switch's policy). Read-only history stays available.
// Platform-wide switches are operated by a System Owner; organization
// administrators operate organization-scoped copies. The model never can.
import prisma from "../../lib/prisma.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { recordOutboxEvent } from "../../services/outboxService.js";
import { cancelAiRequest } from "../gateway/gateway.js";
import { invalidateGovernanceCache, governanceSnapshot, activeSwitch, CACHE_MS } from "./runtime.js";
import { KILL_SWITCH_KINDS, ACTIVE_WORK_POLICIES } from "./catalog.js";

export const isSystemOwner = (req) => !!req?.isSystemOwnerOverride || req?.user?.role === "Super-Admin";
const bad = (m) => new AiError(CATEGORIES.INVALID_REQUEST, m);

export const serializeSwitch = (s) => ({ _id: s.id, kind: s.kind, target: s.target, scope: s.scope === "platform" ? "Platform" : "Organization", active: s.active, activeWorkPolicy: s.activeWorkPolicy, reason: s.reason, activatedAt: s.activatedAt, deactivatedAt: s.deactivatedAt, version: s.version });

export async function listKillSwitches(req) {
  return prisma.aiKillSwitch.findMany({ where: { scope: { in: ["platform", req.organizationId] } }, orderBy: [{ kind: "asc" }, { target: "asc" }] });
}

// The switch to operate: a platform switch (System Owner) or this
// organization's copy of it (created on first use).
async function resolveSwitch(req, id, { organizationScope }) {
  const base = await prisma.aiKillSwitch.findUnique({ where: { id: String(id) } });
  if (!base || (base.scope !== "platform" && base.scope !== req.organizationId)) throw Object.assign(bad("Kill switch not found."), { httpStatus: 404 });
  if (base.scope === req.organizationId) return base;
  if (organizationScope || base.kind === "organization") {
    if (base.kind === "global") throw bad("The global kill switch is platform-wide; use the organization kill switch instead.");
    const target = base.kind === "organization" ? req.organizationId : base.target;
    return prisma.aiKillSwitch.upsert({ where: { kind_target_scope: { kind: base.kind, target, scope: req.organizationId } }, update: {}, create: { kind: base.kind, target, scope: req.organizationId, organizationId: req.organizationId } });
  }
  if (!isSystemOwner(req)) throw Object.assign(new AiError(CATEGORIES.PERMISSION, "Platform-wide kill switches are operated by a System Owner. Use an organization-scoped switch instead."), { httpStatus: 403 });
  return base;
}

export async function organizationSwitch(req) {
  return prisma.aiKillSwitch.upsert({ where: { kind_target_scope: { kind: "organization", target: req.organizationId, scope: req.organizationId } }, update: {}, create: { kind: "organization", target: req.organizationId, scope: req.organizationId, organizationId: req.organizationId } });
}

// Queued (and optionally active) work in the switch's scope.
async function cancelWork(s, policy) {
  const org = s.scope === "platform" ? {} : { organizationId: s.scope };
  const out = { requests: 0, messages: 0, workflowRuns: 0, evaluationRuns: 0, indexingJobs: 0, activeCancelled: 0 };
  const requestWhere = { ...org };
  if (s.kind === "capability") requestWhere.capabilityKey = s.target;
  if (s.kind === "provider") requestWhere.providerKey = s.target;
  if (s.kind === "model") { const [p, ...m] = s.target.split(":"); requestWhere.providerKey = p; requestWhere.modelId = m.join(":"); }
  const affectsRequests = ["global", "organization", "capability", "provider", "model"].includes(s.kind);
  if (affectsRequests) {
    out.requests = (await prisma.aiRequest.updateMany({ where: { ...requestWhere, status: "Queued" }, data: { status: "Cancelled", safeError: "Cancelled: an administrator paused this AI capability.", completedAt: new Date() } })).count;
    if (policy === "cancel_active") {
      const active = await prisma.aiRequest.findMany({ where: { ...requestWhere, status: { in: ["Running", "Streaming"] } }, select: { id: true, organizationId: true }, take: 500 });
      for (const r of active) { await cancelAiRequest(r.organizationId, r.id).catch(() => {}); out.activeCancelled += 1; }
    }
  }
  if (["global", "organization"].includes(s.kind) || (s.kind === "capability" && s.target === "ai_copilot")) {
    out.messages = (await prisma.aiCopilotMessage.updateMany({ where: { ...org, status: "Queued" }, data: { status: "Cancelled", safeError: "Cancelled: an administrator paused the AI Copilot.", cancelledAt: new Date(), completedAt: new Date() } })).count;
  }
  const runWhere = { ...org, status: { in: ["Ready", "Awaiting clarification", "Awaiting tool approval"] } };
  if (s.kind === "workflow") runWhere.templateKey = s.target;
  if (s.kind === "capability" && s.target !== "ai_copilot") runWhere.templateKey = s.target;
  if (["global", "organization", "workflow", "capability"].includes(s.kind)) {
    out.workflowRuns = (await prisma.aiWorkflowRun.updateMany({ where: runWhere, data: { status: "Cancelled", safeError: "Cancelled: an administrator paused this workflow.", completedAt: new Date() } })).count;
  }
  if (["global", "organization"].includes(s.kind)) out.evaluationRuns = (await prisma.aiEvalRun.updateMany({ where: { ...org, status: "Queued" }, data: { status: "Cancelled", cancelledAt: new Date() } })).count;
  if (["semantic_retrieval", "global"].includes(s.kind) || (s.kind === "capability" && s.target === "semantic_retrieval")) {
    out.indexingJobs = (await prisma.aiIndexingJob.updateMany({ where: { ...org, status: "Queued" }, data: { status: "Skipped", error: "Semantic retrieval paused by an administrator.", completedAt: new Date() } })).count;
  }
  return out;
}

export async function activateKillSwitch(req, id, { reason, activeWorkPolicy = "cancel_queued", organizationScope = false, incidentId = null } = {}) {
  if (!reason || String(reason).trim().length < 5) throw bad("A written reason (at least 5 characters) is required.");
  if (!ACTIVE_WORK_POLICIES.includes(activeWorkPolicy)) throw bad(`activeWorkPolicy: ${ACTIVE_WORK_POLICIES.join(", ")}.`);
  const s = await resolveSwitch(req, id, { organizationScope });
  if (!KILL_SWITCH_KINDS.includes(s.kind)) throw bad("Unknown kill switch.");
  if (s.active) return { killSwitch: s, alreadyActive: true, cancelled: null };
  const t0 = Date.now();
  const updated = await prisma.aiKillSwitch.update({ where: { id: s.id }, data: { active: true, reason: String(reason).slice(0, 500), activeWorkPolicy, activatedByUserId: req.user?.id || null, activatedAt: new Date(), version: { increment: 1 } } });
  invalidateGovernanceCache();
  // Propagation: this process sees it now; other processes within CACHE_MS.
  const snap = await governanceSnapshot();
  const seen = !!activeSwitch(snap, updated.kind, updated.target, updated.scope === "platform" ? null : updated.scope);
  const propagationMs = Date.now() - t0;
  const cancelled = await cancelWork(updated, activeWorkPolicy);
  await aiAudit(req, "ai.kill_switch.activated", "AiKillSwitch", updated.id, { reason, before: { active: false }, after: { active: true, kind: updated.kind, target: updated.target, scope: updated.scope, activeWorkPolicy, cancelled, propagationMs, maxPropagationMs: CACHE_MS, seenInProcess: seen, incidentId } });
  await recordOutboxEvent(prisma, { aggregateType: "AiKillSwitch", aggregateId: updated.id, eventType: "ai.kill_switch.activated", payload: { organizationId: updated.scope === "platform" ? null : updated.scope, kind: updated.kind, target: updated.target, notifyRoleKeys: ["admin", "super_admin", "ai_safety_reviewer"] } });
  const { recordSafetyEvent } = await import("./safety.js");
  await recordSafetyEvent(req, { organizationId: updated.scope === "platform" ? null : updated.scope, severity: "Informational", category: "kill_switch_activated", capabilityKey: updated.kind === "capability" ? updated.target : null, summary: `Kill switch ${updated.kind}:${updated.target} activated.`, source: "administrator", actionTaken: "Stopped new work; cancelled queued work" });
  return { killSwitch: updated, cancelled, propagationMs, maxPropagationMs: CACHE_MS };
}

export async function deactivateKillSwitch(req, id, { reason } = {}) {
  if (!reason || String(reason).trim().length < 5) throw bad("A written reason (at least 5 characters) is required.");
  const s = await prisma.aiKillSwitch.findUnique({ where: { id: String(id) } });
  if (!s || (s.scope !== "platform" && s.scope !== req.organizationId)) throw Object.assign(bad("Kill switch not found."), { httpStatus: 404 });
  if (s.scope === "platform" && !isSystemOwner(req)) throw Object.assign(new AiError(CATEGORIES.PERMISSION, "Platform-wide kill switches are operated by a System Owner."), { httpStatus: 403 });
  if (!s.active) return { killSwitch: s, alreadyInactive: true };
  // Restoration gate: a switch used to contain an open incident stays on until
  // the incident's regression suite passed and restoration was approved.
  const incidents = await prisma.aiIncident.findMany({ where: { status: { notIn: ["Closed"] }, scope: { in: ["platform", req.organizationId] } } });
  const holding = incidents.find((i) => (i.containment || []).some((c) => c.killSwitchId === s.id) && !i.restorationApprovedAt);
  if (holding) throw Object.assign(bad(`This kill switch contains incident ${holding.publicId}. Restoration needs a passing regression suite and an approved restoration first.`), { httpStatus: 409, code: "AI_RESTORATION_REQUIRED" });
  const updated = await prisma.aiKillSwitch.update({ where: { id: s.id }, data: { active: false, deactivatedByUserId: req.user?.id || null, deactivatedAt: new Date(), version: { increment: 1 } } });
  invalidateGovernanceCache();
  await aiAudit(req, "ai.kill_switch.deactivated", "AiKillSwitch", s.id, { reason, before: { active: true }, after: { active: false, kind: s.kind, target: s.target, scope: s.scope } });
  await recordOutboxEvent(prisma, { aggregateType: "AiKillSwitch", aggregateId: s.id, eventType: "ai.kill_switch.deactivated", payload: { organizationId: s.scope === "platform" ? null : s.scope, kind: s.kind, target: s.target, notifyRoleKeys: ["admin", "super_admin"] } });
  return { killSwitch: updated };
}
