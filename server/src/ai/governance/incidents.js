// Backend Phase 11 — AI incident management: detect → triage → contain →
// investigate → remediate → monitor → resolve → close (or reopen). Evidence is
// redacted metadata only, hashed, permission-controlled, audited and
// time-limited. A blocked capability is restored only after its regression
// suite passes and someone other than the incident owner approves.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { recordOutboxEvent } from "../../services/outboxService.js";
import { INCIDENT_CATEGORIES, INCIDENT_SEVERITIES, INCIDENT_STATES, RISK_RULES } from "./catalog.js";
import { scanOutput, digest } from "./safety.js";

const bad = (m, status = 422) => Object.assign(new AiError(CATEGORIES.INVALID_REQUEST, m), { httpStatus: status });
const EVIDENCE_DAYS = Number(process.env.AI_INCIDENT_EVIDENCE_DAYS) || 90;
const TRANSITIONS = {
  Detected: ["Triage", "Contained", "Investigating"], Triage: ["Contained", "Investigating", "Resolved"], Contained: ["Investigating", "Remediating"],
  Investigating: ["Contained", "Remediating", "Resolved"], Remediating: ["Monitoring", "Resolved"], Monitoring: ["Resolved", "Remediating"],
  Resolved: ["Closed", "Reopened"], Closed: ["Reopened"], Reopened: ["Triage", "Contained", "Investigating"],
};

export const serializeIncident = (i) => ({
  _id: i.publicId, title: i.title, category: i.category, severity: i.severity, status: i.status, capabilityKey: i.capabilityKey, scope: i.scope === "platform" ? "Platform" : "Organization",
  ownerUserId: i.ownerUserId, detectedBy: i.detectedBy, summary: i.summary, rootCause: i.rootCause, remediation: i.remediation, containment: i.containment,
  regressionCaseIds: i.regressionCaseIds, restorationApproved: !!i.restorationApprovedAt, restorationApprovedAt: i.restorationApprovedAt,
  acknowledgedAt: i.acknowledgedAt, containedAt: i.containedAt, resolvedAt: i.resolvedAt, closedAt: i.closedAt, createdAt: i.createdAt, updatedAt: i.updatedAt, version: i.version,
});

async function event(incident, type, actorUserId, { fromStatus = null, toStatus = null, note = null } = {}) {
  await prisma.aiIncidentEvent.create({ data: { incidentId: incident.id, organizationId: incident.organizationId, type, fromStatus, toStatus, note: note ? String(note).slice(0, 2000) : null, actorUserId } });
}

export async function loadIncident(req, id) {
  const i = await prisma.aiIncident.findFirst({ where: { publicId: String(id), scope: { in: ["platform", req.organizationId] } } });
  if (!i) throw bad("Incident not found.", 404);
  return i;
}

export async function createIncident(req, { title, category, severity, capabilityKey = null, summary, detectedBy = "person", platform = false }) {
  if (!INCIDENT_CATEGORIES.includes(category)) throw bad(`category: ${INCIDENT_CATEGORIES.join(", ")}.`);
  if (!INCIDENT_SEVERITIES.includes(severity)) throw bad(`severity: ${INCIDENT_SEVERITIES.join(", ")}.`);
  if (!title || !summary) throw bad("A title and a summary are required.");
  const scope = platform ? "platform" : req.organizationId;
  const clean = scanOutput(String(summary)).text.slice(0, 2000);
  const i = await prisma.aiIncident.create({
    data: {
      publicId: `aii_${crypto.randomBytes(8).toString("base64url")}`, organizationId: platform ? null : req.organizationId, scope, title: String(title).slice(0, 200), category, severity,
      capabilityKey, detectedBy, summary: clean, ownerUserId: req?.user?.id || null, createdByUserId: req?.user?.id || null,
    },
  });
  await event(i, "created", req?.user?.id || null, { toStatus: "Detected", note: `${severity} ${category}` });
  await aiAudit(req, "ai.incident.created", "AiIncident", i.id, { organizationId: i.organizationId, after: { severity, category, capabilityKey } });
  await recordOutboxEvent(prisma, { aggregateType: "AiIncident", aggregateId: i.id, eventType: "ai.incident.created", payload: { organizationId: i.organizationId, severity, category, title: i.title, notifyRoleKeys: ["admin", "ai_safety_reviewer", ...(["SEV-0", "SEV-1"].includes(severity) ? ["super_admin"] : [])] } });
  // Serious incidents block promotion of the affected capability's releases.
  if (capabilityKey && ["SEV-0", "SEV-1", "SEV-2"].includes(severity)) await prisma.aiRelease.updateMany({ where: { capabilityKey, status: { notIn: ["Retired", "Rolled back"] } }, data: { promotionBlocked: true, promotionBlockReason: `Open ${severity} incident ${i.publicId}` } });
  return i;
}

export async function updateIncident(req, i, body) {
  const data = {};
  if (body.status && body.status !== i.status) {
    if (!INCIDENT_STATES.includes(body.status)) throw bad(`status: ${INCIDENT_STATES.join(", ")}.`);
    if (!(TRANSITIONS[i.status] || []).includes(body.status)) throw bad(`An incident can't move from ${i.status} to ${body.status}.`);
    if (body.status === "Resolved") return resolveIncident(req, i, body);
    data.status = body.status;
    if (!i.acknowledgedAt) data.acknowledgedAt = new Date();
  }
  if (body.severity) { if (!INCIDENT_SEVERITIES.includes(body.severity)) throw bad("Invalid severity."); data.severity = body.severity; }
  if (body.ownerUserId !== undefined) data.ownerUserId = body.ownerUserId || null;
  for (const k of ["rootCause", "remediation", "summary"]) if (body[k] !== undefined) data[k] = scanOutput(String(body[k])).text.slice(0, 4000);
  if (!Object.keys(data).length) return i;
  const u = await prisma.aiIncident.update({ where: { id: i.id }, data: { ...data, version: { increment: 1 } } });
  await event(u, data.status ? "status_changed" : "updated", req.user?.id, { fromStatus: i.status, toStatus: u.status, note: body.note || Object.keys(data).join(", ") });
  await aiAudit(req, "ai.incident.updated", "AiIncident", i.id, { organizationId: i.organizationId, before: { status: i.status, severity: i.severity }, after: { status: u.status, severity: u.severity, fields: Object.keys(data) } });
  return u;
}

// Containment: kill switches and/or release pauses, recorded on the incident.
export async function containIncident(req, i, { killSwitchIds = [], pauseReleaseIds = [], reason }) {
  if (!reason) throw bad("Give a reason for the containment.");
  const { activateKillSwitch } = await import("./killSwitches.js");
  const actions = [...(i.containment || [])];
  for (const id of killSwitchIds) {
    const r = await activateKillSwitch(req, id, { reason: `Incident ${i.publicId}: ${reason}`, activeWorkPolicy: ["SEV-0", "SEV-1"].includes(i.severity) ? "cancel_active" : "cancel_queued", organizationScope: i.scope !== "platform", incidentId: i.publicId });
    actions.push({ type: "kill_switch", killSwitchId: r.killSwitch.id, kind: r.killSwitch.kind, target: r.killSwitch.target, at: new Date().toISOString() });
  }
  if (pauseReleaseIds.length) {
    const { pauseRelease } = await import("./releases.js");
    for (const rid of pauseReleaseIds) { const rel = await pauseRelease(req, rid, { reason: `Incident ${i.publicId}: ${reason}` }); actions.push({ type: "release_paused", releaseId: rel.publicId, at: new Date().toISOString() }); }
  }
  const u = await prisma.aiIncident.update({ where: { id: i.id }, data: { containment: actions, status: ["Detected", "Triage", "Reopened", "Investigating"].includes(i.status) ? "Contained" : i.status, containedAt: i.containedAt || new Date(), acknowledgedAt: i.acknowledgedAt || new Date(), version: { increment: 1 } } });
  await event(u, "contained", req.user?.id, { fromStatus: i.status, toStatus: u.status, note: reason });
  await aiAudit(req, "ai.incident.contained", "AiIncident", i.id, { organizationId: i.organizationId, reason, after: { actions: actions.length } });
  return u;
}

// Evidence: redacted, hashed, time-limited. Never keys or tokens.
export async function addEvidence(req, i, { kind, data }) {
  const scanned = scanOutput(JSON.stringify(data || {}));
  const clean = JSON.parse(scanned.text.replace(/"(authorization|apiKey|api_key|token|password|secret|cookie)"\s*:\s*"[^"]*"/gi, '"$1":"[removed]"'));
  const row = await prisma.aiIncidentEvidence.create({ data: { incidentId: i.id, organizationId: i.organizationId, kind: String(kind || "note").slice(0, 60), data: clean, hash: digest(clean), expiresAt: new Date(Date.now() + EVIDENCE_DAYS * 86_400_000), addedByUserId: req.user?.id || null } });
  await event(i, "evidence_added", req.user?.id, { note: `${row.kind} (${row.hash.slice(0, 12)})` });
  await aiAudit(req, "ai.incident.evidence_added", "AiIncident", i.id, { organizationId: i.organizationId, after: { kind: row.kind, hash: row.hash, redactions: scanned.findings } });
  return row;
}

export async function readEvidence(req, i) {
  const rows = await prisma.aiIncidentEvidence.findMany({ where: { incidentId: i.id, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: "asc" } });
  await aiAudit(req, "ai.incident.evidence_accessed", "AiIncident", i.id, { organizationId: i.organizationId, after: { items: rows.length } });
  return rows.map((r) => ({ _id: r.id, kind: r.kind, data: r.data, hash: r.hash, expiresAt: r.expiresAt, createdAt: r.createdAt }));
}

// A regression case from an incident, added to the incident dataset (new version).
export async function createRegressionCase(req, i, { input, expectations, zeroTolerance = [] }) {
  if (!input?.kind) throw bad("input.kind is required (deterministic, gateway or copilot).");
  const ds = await prisma.aiEvaluationDataset.findUnique({ where: { scope_key: { scope: "platform", key: "incident_regressions" } } });
  if (!ds) throw bad("The incident regression dataset isn't seeded. Run npm run db:seed:ai.");
  const { newDatasetVersion } = await import("./evaluation/datasets.js");
  const key = `inc-${i.publicId}-${(i.regressionCaseIds || []).length + 1}`;
  const { version, cases } = await newDatasetVersion(req, ds, { add: [{ key, type: "incident_derived", input, expectations: expectations || {}, zeroTolerance, sourceIncidentId: i.id }], notes: `Regression case from incident ${i.publicId}` });
  const created = cases.find((c) => c.key === key);
  const u = await prisma.aiIncident.update({ where: { id: i.id }, data: { regressionCaseIds: [...(i.regressionCaseIds || []), created.id], status: ["Investigating", "Contained"].includes(i.status) ? "Remediating" : i.status, version: { increment: 1 } } });
  await event(u, "regression_case_created", req.user?.id, { note: `${key} → dataset v${version.version}` });
  await aiAudit(req, "ai.incident.regression_case_created", "AiIncident", i.id, { organizationId: i.organizationId, after: { caseKey: key, datasetVersion: version.version } });
  return { incident: u, caseId: created.id, datasetVersion: version.version };
}

// Restoration approval: a passing run of a suite that includes the incident's
// regression cases, created after the last case, and a different approver.
export async function approveRestoration(req, i, { runId, reason }) {
  if (!reason) throw bad("Give a reason for approving restoration.");
  if (i.ownerUserId && i.ownerUserId === req.user?.id) throw bad("Restoration must be approved by someone other than the incident owner.", 403);
  if (!(i.regressionCaseIds || []).length) throw bad("Create at least one regression case from this incident before restoration.");
  const run = await prisma.aiEvalRun.findFirst({ where: { publicId: String(runId || "") } });
  if (!run || !["Passed", "Passed with warnings"].includes(run.status)) throw bad("Restoration needs a passing evaluation run of the regression suite.");
  const covered = await prisma.aiEvalResult.findMany({ where: { runId: run.id, caseId: { in: i.regressionCaseIds } }, select: { caseId: true, outcome: true } });
  if (covered.length < i.regressionCaseIds.length || covered.some((c) => c.outcome !== "Pass")) throw bad("That run didn't include (or didn't pass) every regression case from this incident.");
  const u = await prisma.aiIncident.update({ where: { id: i.id }, data: { restorationApprovedByUserId: req.user?.id || null, restorationApprovedAt: new Date(), status: i.status === "Remediating" ? "Monitoring" : i.status, version: { increment: 1 } } });
  await prisma.aiGovernanceApproval.create({ data: { organizationId: i.organizationId, subjectType: "Restoration", subjectId: i.id, reviewerUserId: req.user.id, decision: "Approve", reason: String(reason).slice(0, 500) } });
  await event(u, "restoration_approved", req.user?.id, { note: `run ${run.publicId}: ${reason}` });
  await aiAudit(req, "ai.incident.restoration_approved", "AiIncident", i.id, { organizationId: i.organizationId, reason, after: { runId: run.publicId } });
  return u;
}

export async function resolveIncident(req, i, { rootCause, remediation, note } = {}) {
  const root = rootCause ?? i.rootCause;
  if (!root) throw bad("Record the root cause before resolving.");
  const contained = (i.containment || []).some((c) => c.type === "kill_switch");
  if (contained && !i.restorationApprovedAt) throw bad("This incident contained a capability; approve restoration (passing regression suite) before resolving.", 409);
  const u = await prisma.aiIncident.update({ where: { id: i.id }, data: { status: "Resolved", rootCause: scanOutput(String(root)).text.slice(0, 4000), remediation: remediation ? scanOutput(String(remediation)).text.slice(0, 4000) : i.remediation, resolvedAt: new Date(), version: { increment: 1 } } });
  await event(u, "resolved", req.user?.id, { fromStatus: i.status, toStatus: "Resolved", note });
  await aiAudit(req, "ai.incident.resolved", "AiIncident", i.id, { organizationId: i.organizationId, before: { status: i.status }, after: { status: "Resolved" } });
  return u;
}

export async function closeIncident(req, i, { note } = {}) {
  if (i.status !== "Resolved") throw bad("Only a resolved incident can be closed.");
  const u = await prisma.aiIncident.update({ where: { id: i.id }, data: { status: "Closed", closedAt: new Date(), version: { increment: 1 } } });
  // Lift the promotion block this incident placed, if no other serious incident is open.
  if (i.capabilityKey) {
    const others = await prisma.aiIncident.count({ where: { capabilityKey: i.capabilityKey, id: { not: i.id }, status: { notIn: ["Resolved", "Closed"] }, severity: { in: ["SEV-0", "SEV-1", "SEV-2"] } } });
    if (!others) await prisma.aiRelease.updateMany({ where: { capabilityKey: i.capabilityKey, promotionBlockReason: { contains: i.publicId } }, data: { promotionBlocked: false, promotionBlockReason: null } });
  }
  await event(u, "closed", req.user?.id, { fromStatus: "Resolved", toStatus: "Closed", note });
  await aiAudit(req, "ai.incident.closed", "AiIncident", i.id, { organizationId: i.organizationId, before: { status: "Resolved" }, after: { status: "Closed" } });
  return u;
}

export async function reopenIncident(req, i, { reason }) {
  if (!["Resolved", "Closed"].includes(i.status)) throw bad("Only a resolved or closed incident can be reopened.");
  if (!reason) throw bad("Give a reason for reopening.");
  const u = await prisma.aiIncident.update({ where: { id: i.id }, data: { status: "Reopened", resolvedAt: null, closedAt: null, restorationApprovedAt: null, restorationApprovedByUserId: null, version: { increment: 1 } } });
  await event(u, "reopened", req.user?.id, { fromStatus: i.status, toStatus: "Reopened", note: reason });
  await aiAudit(req, "ai.incident.reopened", "AiIncident", i.id, { organizationId: i.organizationId, reason });
  return u;
}

// Critical safety event → incident, notification, containment when configured.
export async function escalateCriticalEvent(req, ev) {
  const category = { cross_tenant_attempt: "data_leakage", credential_exposure_attempt: "credential_exposure", approval_bypass_attempt: "unauthorized_action", unauthorized_tool_request: "unsafe_tool_use", prompt_injection_suspected: "prompt_injection" }[ev.category] || "authorization_failure";
  const actor = req?.user ? req : { user: null, organizationId: ev.organizationId };
  const i = await createIncident(actor, { title: `Critical safety event: ${ev.category.replace(/_/g, " ")}`, category, severity: ["cross_tenant_attempt", "credential_exposure_attempt"].includes(ev.category) ? "SEV-0" : "SEV-1", capabilityKey: ev.capabilityKey, summary: ev.summary, detectedBy: `safety_event:${ev.source}`, platform: !ev.organizationId });
  await prisma.aiSafetyEvent.update({ where: { id: ev.id }, data: { incidentId: i.id, reviewStatus: "Escalated" } });
  await addEvidence(actor, i, { kind: "safety_event", data: { eventId: ev.id, category: ev.category, severity: ev.severity, requestId: ev.requestId, providerKey: ev.providerKey, modelId: ev.modelId, correlationId: ev.correlationId, policyVersion: ev.policyVersion } });
  if (ev.capabilityKey && process.env.AI_CRITICAL_AUTO_PAUSE !== "false") {
    const sw = await prisma.aiKillSwitch.findUnique({ where: { kind_target_scope: { kind: "capability", target: ev.capabilityKey, scope: "platform" } } });
    if (sw && ev.organizationId) {
      const copy = await prisma.aiKillSwitch.upsert({ where: { kind_target_scope: { kind: "capability", target: ev.capabilityKey, scope: ev.organizationId } }, update: { active: true, reason: `Automatic containment for ${i.publicId}`, activatedAt: new Date(), activeWorkPolicy: "cancel_active" }, create: { kind: "capability", target: ev.capabilityKey, scope: ev.organizationId, organizationId: ev.organizationId, active: true, reason: `Automatic containment for ${i.publicId}`, activatedAt: new Date(), activeWorkPolicy: "cancel_active" } });
      const { invalidateGovernanceCache } = await import("./runtime.js");
      invalidateGovernanceCache();
      await prisma.aiIncident.update({ where: { id: i.id }, data: { containment: [{ type: "kill_switch", killSwitchId: copy.id, kind: "capability", target: ev.capabilityKey, automatic: true, at: new Date().toISOString() }], status: "Contained", containedAt: new Date() } });
      await event(i, "contained", null, { toStatus: "Contained", note: "Automatic containment (critical safety event)" });
      await aiAudit(actor, "ai.kill_switch.activated", "AiKillSwitch", copy.id, { organizationId: ev.organizationId, reason: `Automatic containment for ${i.publicId}`, after: { kind: "capability", target: ev.capabilityKey, automatic: true } });
    }
  }
  return i;
}

export const defaultSeverityFor = (riskLevel) => RISK_RULES[riskLevel]?.defaultIncidentSeverity || "SEV-3";
