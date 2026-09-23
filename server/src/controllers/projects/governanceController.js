// Backend Phase 5 — delivery and governance: deliverables (internal review;
// customer review happens through the portal), risks, issues, change
// requests and baselines.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { round } from "../../services/sales/moneyService.js";
import { sanitizeText } from "../../services/support/supportCommon.js";
import { projectScopeWhere, managesProject, canSeeFinancials, projectActivity } from "../../services/projects/projectAccess.js";
import { computeProgress } from "../../services/projects/progressService.js";

const who = (req) => req.membership?.id || null;
const text = (v, max) => (typeof v === "string" && v.trim() ? sanitizeText(v, { max }) : null);
const invalid = (res, message) => res.status(400).json({ code: "PROJECTS_VALIDATION_FAILED", message });
const notFound = (res, what) => res.status(404).json({ code: "PROJECTS_RECORD_NOT_FOUND", message: `${what} not found.` });
const forbidden = (res, message) => res.status(403).json({ code: "RBAC_FORBIDDEN", message });
const sod = (res, message) => res.status(403).json({ code: "PROJECTS_SEPARATION_OF_DUTIES", message });
const badTransition = (res, message) => res.status(400).json({ code: "PROJECTS_INVALID_TRANSITION", message });
const conflict = (res, what) => res.status(409).json({ code: "PROJECTS_VERSION_CONFLICT", message: `This ${what} was updated by someone else. Refresh and try again.` });
const stale = (req, record) => req.body.version !== undefined && Number(req.body.version) !== record.version;

const LEVELS = ["Low", "Medium", "High", "Very High"];
const RISK_STATUSES = ["Identified", "Assessing", "Monitoring", "Mitigating", "Closed", "Accepted"];
const RESPONSE_STRATEGIES = ["Avoid", "Mitigate", "Transfer", "Accept"];
const ISSUE_STATUSES = ["Open", "Investigating", "In Progress", "Blocked", "Resolved", "Closed"];
const SEVERITIES = ["Minor", "Moderate", "Major", "Critical"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

async function audit(req, action, targetType, targetId, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: who(req), organizationId: req.organizationId, action, targetType, targetId, result: "Success", ...extra });
}

async function loadProject(req, res) {
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, organizationId: req.organizationId, ...projectScopeWhere(req) }, include: { members: true } });
  if (!project) notFound(res, "Project");
  return project;
}

const activeMember = async (organizationId, id) => !id || !!(await prisma.organizationMembership.findFirst({ where: { id, organizationId, status: "Active" } }));
const parseDate = (v) => (v ? new Date(v) : null);
const badDate = (d) => d && Number.isNaN(d.getTime());

// ================================================================ Deliverables

const DELIVERABLE_EDITABLE = ["Draft", "In Progress", "Changes Requested"];
const DELIVERABLE_LOCKED = ["Approved Internally", "Ready for Customer Review", "Accepted"];
const DELIVERABLE_INCLUDE = { decisions: { orderBy: { createdAt: "asc" } } };

async function loadDeliverable(req, res, project) {
  const d = await prisma.deliverable.findFirst({ where: { id: req.params.deliverableId, projectId: project.id }, include: DELIVERABLE_INCLUDE });
  if (!d) notFound(res, "Deliverable");
  return d;
}

export async function listDeliverables(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  const deliverables = await prisma.deliverable.findMany({ where: { projectId: project.id, ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }) }, include: DELIVERABLE_INCLUDE, orderBy: { createdAt: "asc" } });
  res.json({ deliverables: toApi(deliverables) });
}

async function deliverableFields(req, project, body) {
  const out = {};
  if ("name" in body) { out.name = text(body.name, 200); if (!out.name) return { error: "name is required." }; }
  for (const f of ["description", "acceptanceCriteria"]) if (f in body) out[f] = text(body[f], 5000);
  if ("dueDate" in body) { out.dueDate = parseDate(body.dueDate); if (badDate(out.dueDate)) return { error: "dueDate must be a valid date." }; }
  if ("customerVisible" in body) out.customerVisible = Boolean(body.customerVisible);
  if ("milestoneId" in body) {
    if (body.milestoneId && !(await prisma.milestone.findFirst({ where: { id: body.milestoneId, projectId: project.id } }))) return { error: "milestoneId must be a milestone of this project." };
    out.milestoneId = body.milestoneId || null;
  }
  for (const f of ["ownerMembershipId", "reviewerMembershipId"]) {
    if (f in body) {
      if (!(await activeMember(req.organizationId, body[f]))) return { error: `${f} must be an active member of this organization.` };
      out[f] = body[f] || null;
    }
  }
  return { data: out };
}

export async function createDeliverable(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  if (!managesProject(req, project)) return forbidden(res, "Only the project's managers can add deliverables.");
  if (!text(req.body.name, 200)) return invalid(res, "name is required.");
  const { data, error } = await deliverableFields(req, project, req.body);
  if (error) return invalid(res, error);
  const deliverable = await prisma.$transaction(async (tx) => {
    const deliverableNumber = await nextDocumentNumber(tx, req.organizationId, "Deliverable");
    const d = await tx.deliverable.create({ data: { ...data, organizationId: req.organizationId, projectId: project.id, deliverableNumber, ownerMembershipId: data.ownerMembershipId ?? who(req), status: "Draft" } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Deliverable Added", actorMembershipId: who(req), toValue: d.name, snapshot: { deliverableId: d.id, deliverableNumber } });
    return d;
  });
  await audit(req, "projects.deliverable.created", "Deliverable", deliverable.id);
  res.status(201).json({ deliverable: toApi(await prisma.deliverable.findUnique({ where: { id: deliverable.id }, include: DELIVERABLE_INCLUDE })) });
}

// A material change after internal approval creates a new version and
// sends the deliverable back to work (its earlier decisions stay on record).
export async function updateDeliverable(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  const d = await loadDeliverable(req, res, project);
  if (!d) return;
  if (d.ownerMembershipId !== who(req) && !managesProject(req, project)) return forbidden(res, "Only the owner or the project's managers can change this deliverable.");
  if (stale(req, d)) return conflict(res, "deliverable");
  if (["Accepted", "Rejected", "Cancelled"].includes(d.status)) return badTransition(res, `A ${d.status.toLowerCase()} deliverable can't be changed.`);
  const { data, error } = await deliverableFields(req, project, req.body);
  if (error) return invalid(res, error);
  if (req.body.status === "Cancelled") {
    const reason = text(req.body.reason, 1000);
    if (!reason) return invalid(res, "A reason is required to cancel a deliverable.");
    Object.assign(data, { status: "Cancelled", rejectionReason: reason });
  } else if (req.body.status === "In Progress" && d.status === "Draft") data.status = "In Progress";
  const material = ["name", "description", "acceptanceCriteria"].some((f) => f in data && data[f] !== d[f]);
  const newVersion = material && DELIVERABLE_LOCKED.includes(d.status);
  await prisma.$transaction(async (tx) => {
    await tx.deliverable.update({ where: { id: d.id }, data: { ...data, ...(newVersion && { currentVersionNumber: d.currentVersionNumber + 1, status: "In Progress" }), version: { increment: 1 } } });
    if (newVersion) await tx.deliverableDecision.create({ data: { organizationId: req.organizationId, deliverableId: d.id, versionNumber: d.currentVersionNumber + 1, decision: "New Version", actorMembershipId: who(req), comment: "Changed after approval" } });
  });
  await audit(req, "projects.deliverable.updated", "Deliverable", d.id, { after: { newVersion } });
  res.json({ deliverable: toApi(await prisma.deliverable.findUnique({ where: { id: d.id }, include: DELIVERABLE_INCLUDE })) });
}

async function decide(req, res, { from, to, decision, reasonRequired = false, check, customerVisible = false, extraData = {} }) {
  const project = await loadProject(req, res);
  if (!project) return;
  const d = await loadDeliverable(req, res, project);
  if (!d) return;
  if (stale(req, d)) return conflict(res, "deliverable");
  if (!from.includes(d.status)) return badTransition(res, `A deliverable that is ${d.status} can't be ${decision.toLowerCase()}.`);
  const reason = text(req.body.reason ?? req.body.comment, 2000);
  if (reasonRequired && !reason) return invalid(res, "A comment explaining the decision is required.");
  const blocked = check?.(d, project);
  if (blocked) return blocked(res);
  const now = new Date();
  const target = typeof to === "function" ? to(d) : to;
  const data = { status: target, ...extraData };
  if (target === "Ready for Review") data.submittedAt = now;
  if (["Approved Internally", "Changes Requested", "Rejected"].includes(target)) data.reviewedAt = now;
  if (target === "Accepted") data.acceptedAt = now;
  if (target === "Rejected") Object.assign(data, { rejectedAt: now, rejectionReason: reason });
  const changed = await prisma.$transaction(async (tx) => {
    const r = await tx.deliverable.updateMany({ where: { id: d.id, version: d.version }, data: { ...data, version: { increment: 1 } } });
    if (!r.count) return false;
    await tx.deliverableDecision.create({ data: { organizationId: req.organizationId, deliverableId: d.id, versionNumber: d.currentVersionNumber, decision, comment: reason, actorType: "Internal", actorMembershipId: who(req), customerVisible } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: `Deliverable ${decision}`, actorMembershipId: who(req), fromValue: d.status, toValue: target, reason, snapshot: { deliverableId: d.id, versionNumber: d.currentVersionNumber } });
    return true;
  });
  if (!changed) return conflict(res, "deliverable");
  await audit(req, `projects.deliverable.${decision.toLowerCase().replace(/\s+/g, "_")}`, "Deliverable", d.id, { reason });
  res.json({ deliverable: toApi(await prisma.deliverable.findUnique({ where: { id: d.id }, include: DELIVERABLE_INCLUDE })) });
}

// Submission is done by a person (owner or manager).
export const submitDeliverable = (req, res) => decide(req, res, {
  from: DELIVERABLE_EDITABLE, to: "Ready for Review", decision: "Submitted",
  check: (d, project) => (d.ownerMembershipId !== who(req) && !managesProject(req, project) ? (r) => forbidden(r, "Only the owner or the project's managers can submit this deliverable.") : null),
});

// Internal review: the reviewer can't be whoever owns the deliverable.
// `sendToCustomer: true` (customer-visible only) makes it ready for the
// customer's review in the portal; otherwise it stays Approved Internally.
export const approveDeliverable = (req, res) => decide(req, res, {
  from: ["Ready for Review"], decision: "Approved Internally",
  to: (d) => (req.body.sendToCustomer && d.customerVisible ? "Ready for Customer Review" : "Approved Internally"),
  extraData: {},
  check: (d, project) => {
    if (d.ownerMembershipId === who(req)) return (r) => sod(r, "You can't review your own deliverable.");
    if (d.reviewerMembershipId && d.reviewerMembershipId !== who(req) && !managesProject(req, project)) return (r) => forbidden(r, "Only the assigned reviewer or the project's managers can review this deliverable.");
    return null;
  },
});

export const requestDeliverableChanges = (req, res) => decide(req, res, {
  from: ["Ready for Review", "Approved Internally"], to: "Changes Requested", decision: "Changes Requested", reasonRequired: true,
  check: (d) => (d.ownerMembershipId === who(req) ? (r) => sod(r, "You can't review your own deliverable.") : null),
});

// Internal acceptance (for deliverables not reviewed by the customer). A
// recorded decision — never an electronic signature.
export const acceptDeliverable = (req, res) => decide(req, res, {
  from: ["Approved Internally"], to: "Accepted", decision: "Accepted",
  check: (d) => {
    if (d.customerVisible) return (r) => badTransition(r, "A customer-visible deliverable is accepted by the customer in the portal.");
    if (d.ownerMembershipId === who(req)) return (r) => sod(r, "You can't accept your own deliverable.");
    return null;
  },
});

export const rejectDeliverable = (req, res) => decide(req, res, {
  from: ["Ready for Review", "Approved Internally"], to: "Rejected", decision: "Rejected", reasonRequired: true,
  check: (d) => (d.ownerMembershipId === who(req) ? (r) => sod(r, "You can't reject your own deliverable.") : null),
});

// ================================================================ Risks

export async function listRisks(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  res.json({ risks: toApi(await prisma.projectRisk.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } })) });
}

async function riskFields(req, body, existing) {
  const out = {};
  if (!existing || "title" in body) { out.title = text(body.title, 200); if (!out.title) return { error: "title is required." }; }
  for (const f of ["description", "mitigationPlan", "trigger"]) if (f in body) out[f] = text(body[f], 5000);
  if ("category" in body) out.category = text(body.category, 60) || "Delivery";
  for (const [f, allowed] of [["probabilityLevel", LEVELS], ["impactLevel", LEVELS], ["priority", PRIORITIES], ["responseStrategy", RESPONSE_STRATEGIES]]) {
    if (f in body) {
      if (body[f] && !allowed.includes(body[f])) return { error: `${f} must be one of ${allowed.join(", ")}.` };
      out[f] = body[f] || null;
    }
  }
  if ("status" in body) {
    if (!RISK_STATUSES.includes(body.status) || ["Accepted", "Closed"].includes(body.status)) return { error: "Use accept or close for those statuses." };
    out.status = body.status;
  }
  if ("reviewDate" in body) { out.reviewDate = parseDate(body.reviewDate); if (badDate(out.reviewDate)) return { error: "reviewDate must be a valid date." }; }
  if ("internalOnly" in body) out.internalOnly = Boolean(body.internalOnly);
  if ("ownerMembershipId" in body) {
    if (!(await activeMember(req.organizationId, body.ownerMembershipId))) return { error: "ownerMembershipId must be an active member." };
    out.ownerMembershipId = body.ownerMembershipId || null;
  }
  return { data: out };
}

export async function createRisk(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  const { data, error } = await riskFields(req, req.body, null);
  if (error) return invalid(res, error);
  const risk = await prisma.$transaction(async (tx) => {
    const r = await tx.projectRisk.create({ data: { ...data, organizationId: req.organizationId, projectId: project.id } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Risk Identified", actorMembershipId: who(req), toValue: r.title, snapshot: { riskId: r.id, probability: r.probabilityLevel, impact: r.impactLevel } });
    return r;
  });
  await audit(req, "projects.risk.created", "ProjectRisk", risk.id);
  res.status(201).json({ risk: toApi(risk) });
}

async function loadRisk(req, res) {
  const project = await loadProject(req, res);
  if (!project) return {};
  const risk = await prisma.projectRisk.findFirst({ where: { id: req.params.riskId, projectId: project.id } });
  if (!risk) { notFound(res, "Risk"); return {}; }
  return { project, risk };
}

export async function updateRisk(req, res) {
  const { project, risk } = await loadRisk(req, res);
  if (!risk) return;
  if (stale(req, risk)) return conflict(res, "risk");
  const { data, error } = await riskFields(req, req.body, risk);
  if (error) return invalid(res, error);
  const updated = await prisma.projectRisk.update({ where: { id: risk.id }, data: { ...data, version: { increment: 1 } } });
  await audit(req, "projects.risk.updated", "ProjectRisk", risk.id, { before: { status: risk.status }, after: { status: updated.status } });
  res.json({ risk: toApi(updated), projectId: project.id });
}

// Accepting a risk means consciously living with it — its own permission
// (route) and a reason.
export async function acceptRisk(req, res) {
  const reason = text(req.body.reason, 2000);
  if (!reason) return invalid(res, "A reason is required to accept a risk.");
  const { project, risk } = await loadRisk(req, res);
  if (!risk) return;
  if (stale(req, risk)) return conflict(res, "risk");
  if (["Accepted", "Closed"].includes(risk.status)) return badTransition(res, `This risk is already ${risk.status.toLowerCase()}.`);
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.projectRisk.update({ where: { id: risk.id }, data: { status: "Accepted", acceptanceReason: reason, acceptedByMembershipId: who(req), version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Risk Accepted", actorMembershipId: who(req), reason, snapshot: { riskId: risk.id } });
    return r;
  });
  await audit(req, "projects.risk.accepted", "ProjectRisk", risk.id, { reason });
  res.json({ risk: toApi(updated) });
}

export async function closeRisk(req, res) {
  const { project, risk } = await loadRisk(req, res);
  if (!risk) return;
  if (risk.status === "Closed") return badTransition(res, "This risk is already closed.");
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.projectRisk.update({ where: { id: risk.id }, data: { status: "Closed", closedAt: new Date(), version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Risk Closed", actorMembershipId: who(req), reason: text(req.body.reason, 1000), snapshot: { riskId: risk.id } });
    return r;
  });
  await audit(req, "projects.risk.closed", "ProjectRisk", risk.id);
  res.json({ risk: toApi(updated) });
}

// ================================================================ Issues

export async function listIssues(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  res.json({ issues: toApi(await prisma.projectIssue.findMany({ where: { projectId: project.id }, orderBy: { detectedAt: "asc" } })) });
}

async function issueFields(req, project, body, existing) {
  const out = {};
  if (!existing || "title" in body) { out.title = text(body.title, 200); if (!out.title) return { error: "title is required." }; }
  if ("description" in body) out.description = text(body.description, 5000);
  for (const [f, allowed] of [["priority", PRIORITIES], ["severity", SEVERITIES]]) {
    if (f in body) { if (!allowed.includes(body[f])) return { error: `${f} must be one of ${allowed.join(", ")}.` }; out[f] = body[f]; }
  }
  if ("status" in body) {
    if (!ISSUE_STATUSES.includes(body.status) || body.status === "Resolved") return { error: "Use resolve to resolve an issue." };
    if (body.status === "Closed" && existing?.status !== "Resolved") return { error: "Only a resolved issue can be closed." };
    out.status = body.status;
  }
  if ("targetResolutionDate" in body) { out.targetResolutionDate = parseDate(body.targetResolutionDate); if (badDate(out.targetResolutionDate)) return { error: "targetResolutionDate must be a valid date." }; }
  if ("internalOnly" in body) out.internalOnly = Boolean(body.internalOnly);
  if ("ownerMembershipId" in body) {
    if (!(await activeMember(req.organizationId, body.ownerMembershipId))) return { error: "ownerMembershipId must be an active member." };
    out.ownerMembershipId = body.ownerMembershipId || null;
  }
  if ("relatedTaskId" in body) {
    if (body.relatedTaskId && !(await prisma.task.findFirst({ where: { id: body.relatedTaskId, projectId: project.id } }))) return { error: "relatedTaskId must be a task of this project." };
    out.relatedTaskId = body.relatedTaskId || null;
  }
  // A link to a Support ticket — the two histories stay separate.
  if ("relatedTicketId" in body) {
    if (body.relatedTicketId && !(await prisma.ticket.findFirst({ where: { id: body.relatedTicketId, organizationId: req.organizationId } }))) return { error: "relatedTicketId must be a ticket in this organization." };
    out.relatedTicketId = body.relatedTicketId || null;
  }
  return { data: out };
}

export async function createIssue(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  const { data, error } = await issueFields(req, project, req.body, null);
  if (error) return invalid(res, error);
  const issue = await prisma.$transaction(async (tx) => {
    const i = await tx.projectIssue.create({ data: { ...data, organizationId: req.organizationId, projectId: project.id } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Issue Raised", actorMembershipId: who(req), toValue: i.title, snapshot: { issueId: i.id, severity: i.severity } });
    return i;
  });
  await audit(req, "projects.issue.created", "ProjectIssue", issue.id);
  res.status(201).json({ issue: toApi(issue) });
}

async function loadIssue(req, res) {
  const project = await loadProject(req, res);
  if (!project) return {};
  const issue = await prisma.projectIssue.findFirst({ where: { id: req.params.issueId, projectId: project.id } });
  if (!issue) { notFound(res, "Issue"); return {}; }
  return { project, issue };
}

export async function updateIssue(req, res) {
  const { project, issue } = await loadIssue(req, res);
  if (!issue) return;
  if (stale(req, issue)) return conflict(res, "issue");
  const { data, error } = await issueFields(req, project, req.body, issue);
  if (error) return invalid(res, error);
  const updated = await prisma.projectIssue.update({ where: { id: issue.id }, data: { ...data, version: { increment: 1 } } });
  await audit(req, "projects.issue.updated", "ProjectIssue", issue.id, { before: { status: issue.status }, after: { status: updated.status } });
  res.json({ issue: toApi(updated) });
}

export async function resolveIssue(req, res) {
  const summary = text(req.body.summary ?? req.body.resolutionSummary, 5000);
  if (!summary) return invalid(res, "A resolution summary is required.");
  const { project, issue } = await loadIssue(req, res);
  if (!issue) return;
  if (stale(req, issue)) return conflict(res, "issue");
  if (["Resolved", "Closed"].includes(issue.status)) return badTransition(res, `This issue is already ${issue.status.toLowerCase()}.`);
  const updated = await prisma.$transaction(async (tx) => {
    const i = await tx.projectIssue.update({ where: { id: issue.id }, data: { status: "Resolved", resolvedAt: new Date(), resolutionSummary: summary, version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Issue Resolved", actorMembershipId: who(req), snapshot: { issueId: issue.id } });
    return i;
  });
  await audit(req, "projects.issue.resolved", "ProjectIssue", issue.id);
  res.json({ issue: toApi(updated) });
}

// ================================================================ Change requests

// Budget impact is a sensitive field (financial-fields grant only).
function serializeChange(req, cr) {
  const out = toApi(cr);
  if (!canSeeFinancials(req)) {
    delete out.budgetImpact;
    if (out.impactSnapshot) delete out.impactSnapshot.budgetImpact;
  }
  return out;
}

export async function listChanges(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  const changes = await prisma.changeRequest.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } });
  res.json({ changeRequests: changes.map((c) => serializeChange(req, c)) });
}

// scheduleImpact: { newPlannedEndDate?, tasks?: [{ taskId, dueDate }] }
async function changeFields(req, project, body) {
  const out = {};
  if ("title" in body) { out.title = text(body.title, 200); if (!out.title) return { error: "title is required." }; }
  for (const f of ["description", "businessReason", "scopeImpact", "riskImpact"]) if (f in body) out[f] = text(body[f], 5000);
  if ("effortImpactMinutes" in body) {
    const n = body.effortImpactMinutes === null ? null : Number(body.effortImpactMinutes);
    if (n !== null && !Number.isInteger(n)) return { error: "effortImpactMinutes must be whole minutes." };
    out.effortImpactMinutes = n;
  }
  if ("budgetImpact" in body) {
    if (!canSeeFinancials(req)) return { forbidden: "You don't have permission to set budget impact." };
    const b = body.budgetImpact === null ? null : Number(body.budgetImpact);
    if (b !== null && !Number.isFinite(b)) return { error: "budgetImpact must be a number." };
    out.budgetImpact = b === null ? null : round(b, project.currency || "USD");
  }
  if ("scheduleImpact" in body) {
    const s = body.scheduleImpact || {};
    const clean = {};
    if (s.newPlannedEndDate) { const d = new Date(s.newPlannedEndDate); if (badDate(d)) return { error: "scheduleImpact.newPlannedEndDate must be a valid date." }; clean.newPlannedEndDate = d.toISOString(); }
    if (s.tasks) {
      if (!Array.isArray(s.tasks) || s.tasks.length > 200) return { error: "scheduleImpact.tasks must be a list." };
      for (const t of s.tasks) {
        const d = new Date(t?.dueDate);
        if (!t?.taskId || badDate(d)) return { error: "Each scheduleImpact task needs a taskId and a dueDate." };
        if (!(await prisma.task.findFirst({ where: { id: t.taskId, projectId: project.id } }))) return { error: "scheduleImpact tasks must belong to this project." };
      }
      clean.tasks = s.tasks.map((t) => ({ taskId: t.taskId, dueDate: new Date(t.dueDate).toISOString() }));
    }
    out.scheduleImpact = clean;
  }
  if ("reviewerMembershipId" in body) {
    if (!(await activeMember(req.organizationId, body.reviewerMembershipId))) return { error: "reviewerMembershipId must be an active member." };
    out.reviewerMembershipId = body.reviewerMembershipId || null;
  }
  return { data: out };
}

async function loadChange(req, res) {
  const project = await loadProject(req, res);
  if (!project) return {};
  const cr = await prisma.changeRequest.findFirst({ where: { id: req.params.changeId, projectId: project.id } });
  if (!cr) { notFound(res, "Change request"); return {}; }
  return { project, cr };
}

export async function createChange(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  if (!text(req.body.title, 200)) return invalid(res, "title is required.");
  const { data, error, forbidden: denied } = await changeFields(req, project, req.body);
  if (denied) return forbidden(res, denied);
  if (error) return invalid(res, error);
  const cr = await prisma.$transaction(async (tx) => {
    const changeNumber = await nextDocumentNumber(tx, req.organizationId, "ChangeRequest");
    const c = await tx.changeRequest.create({ data: { ...data, organizationId: req.organizationId, projectId: project.id, changeNumber, requestedByMembershipId: who(req), status: "Draft" } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Change Request Created", actorMembershipId: who(req), toValue: changeNumber });
    return c;
  });
  await audit(req, "projects.change_request.created", "ChangeRequest", cr.id);
  res.status(201).json({ changeRequest: serializeChange(req, cr) });
}

export async function updateChange(req, res) {
  const { project, cr } = await loadChange(req, res);
  if (!cr) return;
  if (cr.status !== "Draft") return badTransition(res, "Only a draft change request can be edited.");
  if (cr.requestedByMembershipId !== who(req) && !managesProject(req, project)) return forbidden(res, "Only the requester can edit this change request.");
  if (stale(req, cr)) return conflict(res, "change request");
  const { data, error, forbidden: denied } = await changeFields(req, project, req.body);
  if (denied) return forbidden(res, denied);
  if (error) return invalid(res, error);
  const updated = await prisma.changeRequest.update({ where: { id: cr.id }, data: { ...data, version: { increment: 1 } } });
  await audit(req, "projects.change_request.updated", "ChangeRequest", cr.id);
  res.json({ changeRequest: serializeChange(req, updated) });
}

async function changeDecision(req, res, { from, to, auditAction, eventType, data = {}, reasonRequired = false, check }) {
  const { project, cr } = await loadChange(req, res);
  if (!cr) return;
  if (stale(req, cr)) return conflict(res, "change request");
  if (!from.includes(cr.status)) return badTransition(res, `A ${cr.status} change request can't be ${to.toLowerCase()}.`);
  const reason = text(req.body.reason, 2000);
  if (reasonRequired && !reason) return invalid(res, "A reason is required.");
  const blocked = check?.(cr, project);
  if (blocked) return blocked(res);
  const extra = typeof data === "function" ? data(cr, reason) : data;
  const changed = await prisma.$transaction(async (tx) => {
    const r = await tx.changeRequest.updateMany({ where: { id: cr.id, version: cr.version }, data: { status: to, ...extra, version: { increment: 1 } } });
    if (!r.count) return false;
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType, actorMembershipId: who(req), fromValue: cr.status, toValue: to, reason, snapshot: { changeRequestId: cr.id, changeNumber: cr.changeNumber } });
    return true;
  });
  if (!changed) return conflict(res, "change request");
  await audit(req, auditAction, "ChangeRequest", cr.id, { reason });
  res.json({ changeRequest: serializeChange(req, await prisma.changeRequest.findUnique({ where: { id: cr.id } })) });
}

// Submitting freezes an impact snapshot.
export const submitChange = (req, res) => changeDecision(req, res, {
  from: ["Draft"], to: "Submitted", auditAction: "projects.change_request.submitted", eventType: "Change Request Submitted",
  data: (cr) => ({ impactSnapshot: { scopeImpact: cr.scopeImpact, scheduleImpact: cr.scheduleImpact, effortImpactMinutes: cr.effortImpactMinutes, budgetImpact: cr.budgetImpact === null ? null : String(cr.budgetImpact), riskImpact: cr.riskImpact, submittedAt: new Date().toISOString() } }),
  check: (cr, project) => (cr.requestedByMembershipId !== who(req) && !managesProject(req, project) ? (r) => forbidden(r, "Only the requester can submit this change request.") : null),
});

// The requester never approves their own request. Approval changes nothing
// in the project — applying is a separate, previewed step.
export const approveChange = (req, res) => changeDecision(req, res, {
  from: ["Submitted", "Under Review"], to: "Approved", auditAction: "projects.change_request.approved", eventType: "Change Request Approved",
  data: (cr, reason) => ({ decision: "Approved", decisionReason: reason, approvedByMembershipId: who(req), approvedAt: new Date() }),
  check: (cr) => (cr.requestedByMembershipId === who(req) ? (r) => sod(r, "You can't approve your own change request.") : null),
});

export const rejectChange = (req, res) => changeDecision(req, res, {
  from: ["Submitted", "Under Review"], to: "Rejected", reasonRequired: true, auditAction: "projects.change_request.rejected", eventType: "Change Request Rejected",
  data: (cr, reason) => ({ decision: "Rejected", decisionReason: reason }),
  check: (cr) => (cr.requestedByMembershipId === who(req) ? (r) => sod(r, "You can't decide on your own change request.") : null),
});

export const cancelChange = (req, res) => changeDecision(req, res, {
  from: ["Draft", "Submitted", "Under Review", "Approved"], to: "Cancelled", reasonRequired: true, auditAction: "projects.change_request.cancelled", eventType: "Change Request Cancelled",
  data: (cr, reason) => ({ cancelledReason: reason }),
});

function applyPlan(project, cr, tasks) {
  const s = cr.scheduleImpact || {};
  const changes = [];
  if (s.newPlannedEndDate) changes.push({ what: "Project planned end", from: project.dueDate, to: s.newPlannedEndDate });
  for (const t of s.tasks || []) {
    const task = tasks.find((x) => x.id === t.taskId);
    if (task) changes.push({ what: `Task ${task.taskNumber || task.title} due date`, taskId: task.id, from: task.dueDate, to: t.dueDate });
  }
  return changes;
}

export async function applyPreview(req, res) {
  const { project, cr } = await loadChange(req, res);
  if (!cr) return;
  if (cr.status !== "Approved") return badTransition(res, "Only an approved change request can be applied.");
  const tasks = await prisma.task.findMany({ where: { projectId: project.id }, select: { id: true, title: true, taskNumber: true, dueDate: true } });
  res.json({ preview: { changeNumber: cr.changeNumber, changes: applyPlan(project, cr, tasks), note: "Nothing is changed until you apply with confirm: true." } });
}

// Applies an APPROVED change's schedule impact, with explicit confirmation
// and an idempotency key (route).
export async function applyChange(req, res) {
  if (req.body.confirm !== true) return invalid(res, "Review the apply-preview first, then apply with confirm: true.");
  const { project, cr } = await loadChange(req, res);
  if (!cr) return;
  if (!managesProject(req, project)) return forbidden(res, "Only the project's managers can apply changes.");
  if (cr.status !== "Approved") return badTransition(res, "Only an approved change request can be applied.");
  const tasks = await prisma.task.findMany({ where: { projectId: project.id }, select: { id: true, title: true, taskNumber: true, dueDate: true } });
  const plan = applyPlan(project, cr, tasks);
  await prisma.$transaction(async (tx) => {
    for (const c of plan) {
      if (c.taskId) await tx.task.update({ where: { id: c.taskId }, data: { dueDate: new Date(c.to), version: { increment: 1 } } });
      else await tx.project.update({ where: { id: project.id }, data: { dueDate: new Date(c.to), version: { increment: 1 } } });
    }
    await tx.changeRequest.update({ where: { id: cr.id }, data: { status: "Implemented", implementedAt: new Date(), version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Change Request Applied", actorMembershipId: who(req), snapshot: { changeRequestId: cr.id, changeNumber: cr.changeNumber, changes: plan.map((p) => ({ what: p.what, from: p.from, to: p.to })) } });
  });
  await audit(req, "projects.change_request.applied", "ChangeRequest", cr.id, { after: { changes: plan.length } });
  res.json({ changeRequest: serializeChange(req, await prisma.changeRequest.findUnique({ where: { id: cr.id } })), applied: plan });
}

// ================================================================ Baselines

export async function listBaselines(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  const baselines = await prisma.projectBaseline.findMany({ where: { projectId: project.id }, orderBy: { baselineNumber: "asc" } });
  res.json({ baselines: baselines.map((b) => { const out = toApi(b); if (!canSeeFinancials(req) && out.snapshot) delete out.snapshot.plannedBudget; return out; }) });
}

// Immutable snapshot; earlier baselines are kept. There are no update or
// delete routes for baselines.
export async function createBaseline(req, res) {
  const reason = text(req.body.reason, 1000);
  if (!reason) return invalid(res, "A reason is required to create a baseline.");
  const project = await loadProject(req, res);
  if (!project) return;
  if (!managesProject(req, project)) return forbidden(res, "Only the project's managers can baseline it.");
  const [phases, milestones, tasks, last] = await Promise.all([
    prisma.projectPhase.findMany({ where: { projectId: project.id, archivedAt: null }, orderBy: { displayOrder: "asc" } }),
    prisma.milestone.findMany({ where: { projectId: project.id, archivedAt: null } }),
    prisma.task.findMany({ where: { projectId: project.id, archivedAt: null } }),
    prisma.projectBaseline.findFirst({ where: { projectId: project.id }, orderBy: { baselineNumber: "desc" } }),
  ]);
  const snapshot = {
    project: { startDate: project.startDate, dueDate: project.dueDate, plannedEffortMinutes: project.plannedEffortMinutes },
    plannedBudget: project.plannedBudget === null ? null : String(project.plannedBudget),
    phases: phases.map((p) => ({ id: p.id, name: p.name, plannedStartDate: p.plannedStartDate, plannedEndDate: p.plannedEndDate })),
    milestones: milestones.map((m) => ({ id: m.id, name: m.name, dueDate: m.dueDate, status: m.status })),
    tasks: tasks.map((t) => ({ id: t.id, taskNumber: t.taskNumber, title: t.title, plannedStartDate: t.plannedStartDate, dueDate: t.dueDate, estimatedMinutes: t.estimatedMinutes, statusCategory: t.statusCategory })),
    progress: computeProgress(project, tasks, milestones),
  };
  const baseline = await prisma.$transaction(async (tx) => {
    const b = await tx.projectBaseline.create({ data: { organizationId: req.organizationId, projectId: project.id, baselineNumber: (last?.baselineNumber || 0) + 1, reason, snapshot, createdByMembershipId: who(req) } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Baseline Created", actorMembershipId: who(req), toValue: b.baselineNumber, reason });
    return b;
  });
  await audit(req, "projects.baseline.created", "Project", project.id, { reason, after: { baselineNumber: baseline.baselineNumber } });
  const out = toApi(baseline);
  if (!canSeeFinancials(req)) delete out.snapshot.plannedBudget;
  res.status(201).json({ baseline: out });
}

