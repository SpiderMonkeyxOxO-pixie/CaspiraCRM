// Backend Phase 13 — disaster-recovery plans, drills and incidents with
// explicit, authorized and audited state transitions.
import prisma from "../lib/prisma.js";
import { PlatformError, currentEnvironment, publicId, platformAudit, toJson } from "./common.js";
import { DR_PLANS } from "./drPlans.js";
import { assertSeparation } from "./rbac.js";

export const PLAN_STATES = ["Draft", "Ready for Review", "Approved"];
export const DRILL_STATES = ["Drill Scheduled", "Drill Running", "Drill Passed", "Drill Failed", "Cancelled"];
export const INCIDENT_STATES = ["Incident Declared", "Containment", "Recovery", "Validation", "Service Restored", "Post-Incident Review", "Closed"];

// Allowed transitions (anything else is refused).
export const INCIDENT_TRANSITIONS = {
  "Incident Declared": ["Containment"],
  Containment: ["Recovery"],
  Recovery: ["Validation", "Containment"],
  Validation: ["Service Restored", "Recovery"],
  "Service Restored": ["Post-Incident Review"],
  "Post-Incident Review": ["Closed"],
  Closed: [],
};
const PLAN_TRANSITIONS = { Draft: ["Ready for Review"], "Ready for Review": ["Approved", "Draft"], Approved: ["Draft"] };
const DRILL_TRANSITIONS = { "Drill Scheduled": ["Drill Running", "Cancelled"], "Drill Running": ["Drill Passed", "Drill Failed"], "Drill Passed": [], "Drill Failed": [], Cancelled: [] };

export function canTransition(map, from, to) { return (map[from] || []).includes(to); }

export async function seedDrPlans(environment = currentEnvironment()) {
  let created = 0;
  for (const p of DR_PLANS) {
    const exists = await prisma.drPlan.findUnique({ where: { key_environment: { key: p.key, environment } } });
    if (exists) continue;
    await prisma.drPlan.create({ data: { ...p, environment, recoverySteps: p.recoverySteps, participants: p.participants } });
    created += 1;
  }
  return created;
}

export const serializePlan = (p) => toJson({ key: p.key, title: p.title, severity: p.severity, incidentOwnerRole: p.incidentOwnerRole, participants: p.participants, detection: p.detection, containment: p.containment, evidence: p.evidence, recoverySteps: p.recoverySteps, backupRequirements: p.backupRequirements, communication: p.communication, rpoTargetMinutes: p.rpoTargetMinutes, rtoTargetMinutes: p.rtoTargetMinutes, validation: p.validation, returnToService: p.returnToService, postIncidentReview: p.postIncidentReview, singleHostNotes: p.singleHostNotes, status: p.status, approvedAt: p.approvedAt, lastDrillAt: p.lastDrillAt, drillIntervalDays: p.drillIntervalDays, version: p.version });

export async function transitionPlan(req, key, to, { expectedVersion, note } = {}) {
  const p = await prisma.drPlan.findUnique({ where: { key_environment: { key: String(key), environment: currentEnvironment() } } });
  if (!p) throw new PlatformError(404, "NOT_FOUND", "Disaster-recovery plan not found.");
  if (!canTransition(PLAN_TRANSITIONS, p.status, to)) throw new PlatformError(409, "INVALID_TRANSITION", `A ${p.status} plan can't move to ${to}.`);
  const { count } = await prisma.drPlan.updateMany({ where: { id: p.id, ...(expectedVersion !== undefined ? { version: Number(expectedVersion) } : {}) }, data: { status: to, version: { increment: 1 }, ...(to === "Approved" ? { approvedByUserId: req.user.id, approvedAt: new Date() } : {}) } });
  if (!count) throw new PlatformError(409, "VERSION_CONFLICT", "The plan changed. Refresh and try again.");
  await platformAudit(req, "dr.plan_transition", "DrPlan", p.key, { reason: note, before: { status: p.status }, after: { status: to } });
  return serializePlan(await prisma.drPlan.findUnique({ where: { id: p.id } }));
}

export async function scheduleDrill(req, { planKey, scheduledFor, notes }) {
  const p = await prisma.drPlan.findUnique({ where: { key_environment: { key: String(planKey), environment: currentEnvironment() } } });
  if (!p) throw new PlatformError(404, "NOT_FOUND", "Disaster-recovery plan not found.");
  const when = scheduledFor ? new Date(scheduledFor) : new Date();
  if (Number.isNaN(when.getTime())) throw new PlatformError(422, "INVALID_DATE", "scheduledFor must be a date.");
  const d = await prisma.drDrill.create({ data: { publicId: publicId("dd"), planId: p.id, environment: p.environment, scenario: p.title, scheduledFor: when, notes: notes ? String(notes).slice(0, 2000) : null, operatorUserId: req.user.id, correlationId: req.correlationId } });
  await platformAudit(req, "dr.drill_scheduled", "DrDrill", d.publicId, { after: { plan: p.key, scheduledFor: when } });
  return d;
}

export async function transitionDrill(req, id, to, { findings, remediation, restoreDrillId, notes, separationException } = {}) {
  const d = await prisma.drDrill.findFirst({ where: { publicId: String(id), environment: currentEnvironment() } });
  if (!d) throw new PlatformError(404, "NOT_FOUND", "Drill not found.");
  if (!canTransition(DRILL_TRANSITIONS, d.status, to)) throw new PlatformError(409, "INVALID_TRANSITION", `A ${d.status} drill can't move to ${to}.`);
  const data = { status: to, version: { increment: 1 } };
  if (to === "Drill Running") data.startedAt = new Date();
  if (to === "Drill Passed" || to === "Drill Failed") {
    // The result is signed off by someone other than the operator.
    const exception = await assertSeparation(req, d.operatorUserId, "disaster-recovery drill result", separationException);
    Object.assign(data, { completedAt: new Date(), approverUserId: req.user.id, findings: toJson(findings || []), remediation: toJson(remediation || []), notes: exception ? `${notes || ""}\nSeparation exception: ${exception}`.trim() : notes || d.notes });
    if (restoreDrillId) {
      const rd = await prisma.restoreDrill.findFirst({ where: { publicId: String(restoreDrillId) } });
      if (!rd) throw new PlatformError(422, "INVALID_REFERENCE", "Restore drill not found.");
      data.restoreDrillId = rd.id;
    }
    await prisma.drPlan.update({ where: { id: d.planId }, data: { lastDrillAt: new Date() } });
    if (to === "Drill Failed") {
      const { recordFinding } = await import("./findings.js");
      await recordFinding({ category: "drill", source: "dr-drill", title: `Disaster-recovery drill ${d.publicId} failed: ${d.scenario}`, severity: "High", component: "disaster-recovery", fingerprint: `dr-drill-failed:${d.publicId}` });
    }
  }
  await prisma.drDrill.update({ where: { id: d.id }, data });
  await platformAudit(req, "dr.drill_transition", "DrDrill", d.publicId, { before: { status: d.status }, after: { status: to } });
  return prisma.drDrill.findUnique({ where: { id: d.id } });
}

export async function declareIncident(req, { planKey, title, severity, summary }) {
  if (String(title || "").trim().length < 5) throw new PlatformError(422, "INVALID_INCIDENT", "Give the incident a title.");
  if (!["SEV-0", "SEV-1", "SEV-2", "SEV-3"].includes(severity)) throw new PlatformError(422, "INVALID_INCIDENT", "severity must be SEV-0 to SEV-3.");
  const p = planKey ? await prisma.drPlan.findUnique({ where: { key_environment: { key: String(planKey), environment: currentEnvironment() } } }) : null;
  if (planKey && !p) throw new PlatformError(404, "NOT_FOUND", "Disaster-recovery plan not found.");
  const inc = await prisma.drIncident.create({ data: { publicId: publicId("di"), planId: p?.id || null, environment: currentEnvironment(), title: String(title).slice(0, 200), severity, summary: summary ? String(summary).slice(0, 4000) : null, declaredByUserId: req.user.id, ownerUserId: req.user.id } });
  await prisma.drIncidentAction.create({ data: { incidentId: inc.id, toStatus: "Incident Declared", action: "declared", note: summary || null, actorUserId: req.user.id, correlationId: req.correlationId } });
  await platformAudit(req, "dr.disaster_declared", "DrIncident", inc.publicId, { after: { severity, plan: p?.key || null } });
  return inc;
}

export async function transitionIncident(req, id, to, { note, expectedVersion } = {}) {
  const inc = await prisma.drIncident.findFirst({ where: { publicId: String(id), environment: currentEnvironment() } });
  if (!inc) throw new PlatformError(404, "NOT_FOUND", "Incident not found.");
  if (!canTransition(INCIDENT_TRANSITIONS, inc.status, to)) throw new PlatformError(409, "INVALID_TRANSITION", `A ${inc.status} incident can't move to ${to}.`);
  if (to === "Closed" && String(note || inc.reviewNotes || "").trim().length < 20) throw new PlatformError(422, "REVIEW_REQUIRED", "Closing needs the post-incident review summary (at least 20 characters).");
  const { count } = await prisma.drIncident.updateMany({ where: { id: inc.id, ...(expectedVersion !== undefined ? { version: Number(expectedVersion) } : {}) }, data: { status: to, version: { increment: 1 }, ...(to === "Closed" ? { closedAt: new Date(), reviewNotes: note || inc.reviewNotes } : {}) } });
  if (!count) throw new PlatformError(409, "VERSION_CONFLICT", "The incident changed. Refresh and try again.");
  await prisma.drIncidentAction.create({ data: { incidentId: inc.id, fromStatus: inc.status, toStatus: to, action: "transition", note: note ? String(note).slice(0, 4000) : null, actorUserId: req.user.id, correlationId: req.correlationId } });
  await platformAudit(req, "dr.incident_transition", "DrIncident", inc.publicId, { reason: note, before: { status: inc.status }, after: { status: to } });
  return prisma.drIncident.findUnique({ where: { id: inc.id } });
}

// Worker: plans whose drill interval has passed get a scheduled drill reminder.
export async function drillReminders(now = new Date()) {
  const plans = await prisma.drPlan.findMany({ where: { environment: currentEnvironment() } });
  let reminded = 0;
  for (const p of plans) {
    const due = !p.lastDrillAt || now - p.lastDrillAt > p.drillIntervalDays * 86_400_000;
    if (!due) continue;
    const open = await prisma.drDrill.findFirst({ where: { planId: p.id, status: { in: ["Drill Scheduled", "Drill Running"] } } });
    if (open) continue;
    await prisma.drDrill.create({ data: { publicId: publicId("dd"), planId: p.id, environment: p.environment, scenario: p.title, scheduledFor: new Date(now.getTime() + 14 * 86_400_000), notes: "Scheduled automatically: drill interval reached." } });
    reminded += 1;
  }
  return reminded;
}
