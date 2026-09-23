// Backend Phase 5 (full spec) — projects: CRUD, lifecycle, archive/restore,
// history and milestones (kept here for the frontend's milestone list).
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { round } from "../../services/sales/moneyService.js";
import { sanitizeText } from "../../services/support/supportCommon.js";
import {
  PROJECT_STATUSES, PROJECT_PRIORITIES, HEALTH_STATES, PROGRESS_MODES, MILESTONE_STATUSES, ARCHIVABLE_PROJECT_STATUSES, canTransitionProject,
} from "../../services/projects/projectRulesService.js";
import { projectScopeWhere as scopeWhere, managesProject, canSeeFinancials, projectActivity } from "../../services/projects/projectAccess.js";
import { ensureDefaultBoard } from "../../services/projects/boardService.js";
import { computeProgress } from "../../services/projects/progressService.js";

export { scopeWhere as projectScopeWhere };

const MAX_PAGE_SIZE = 100;
const who = (req) => req.membership?.id || null;
const text = (v, max) => (typeof v === "string" && v.trim() ? sanitizeText(v, { max }) : null);
const invalid = (res, message) => res.status(400).json({ code: "PROJECTS_VALIDATION_FAILED", message });
const badRef = (res, field) => res.status(400).json({ code: "PROJECTS_REFERENCE_INVALID", message: `${field} must reference a record in this organization.` });
const badTransition = (res, message) => res.status(400).json({ code: "PROJECTS_INVALID_TRANSITION", message });
const forbidden = (res, message) => res.status(403).json({ code: "RBAC_FORBIDDEN", message });
const conflict = (res) => res.status(409).json({ code: "PROJECTS_VERSION_CONFLICT", message: "This project was updated by someone else. Refresh and try again." });

const INCLUDE = {
  company: { select: { id: true, name: true } },
  deal: { select: { id: true, name: true, companyId: true } },
  portfolio: { select: { id: true, name: true } },
  milestones: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } },
  members: { where: { active: true }, orderBy: { createdAt: "asc" } },
};

// Budget is a sensitive field: without the financial-fields grant it's
// removed from every response. Progress is computed and explained.
export function serializeProject(req, project, tasks = null) {
  const out = toApi(project);
  if (!canSeeFinancials(req)) { delete out.plannedBudget; }
  if (tasks) out.progress = computeProgress(project, tasks, project.milestones || []);
  return out;
}

async function loadProject(req, res, id = req.params.projectId) {
  const project = await prisma.project.findFirst({ where: { id, organizationId: req.organizationId, ...scopeWhere(req) }, include: INCLUDE });
  if (!project) res.status(404).json({ code: "PROJECTS_RECORD_NOT_FOUND", message: "Project not found." });
  return project;
}

async function audit(req, action, projectId, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: who(req), organizationId: req.organizationId, action, targetType: "Project", targetId: projectId, result: "Success", ...extra });
}

async function tasksFor(projectIds) {
  return prisma.task.findMany({ where: { projectId: { in: projectIds } }, select: { projectId: true, statusCategory: true, weight: true, archivedAt: true } });
}

async function saved(req, res, projectId, status = 200) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: INCLUDE });
  res.status(status).json({ project: serializeProject(req, project, await tasksFor([projectId])) });
}

async function validateRefs(organizationId, { companyId, dealId, ownerMembershipId, portfolioId, primaryContactId, sourceOrderId, sourceContractId }) {
  const inOrg = (model, id, extra = {}) => prisma[model].findFirst({ where: { id, organizationId, ...extra } });
  if (companyId && !(await inOrg("company", companyId))) return "companyId";
  if (dealId) {
    const deal = await inOrg("deal", dealId);
    if (!deal) return "dealId";
    if (companyId && deal.companyId && deal.companyId !== companyId) return "dealId (belongs to a different company)";
  }
  if (primaryContactId) {
    const contact = await inOrg("contact", primaryContactId);
    if (!contact) return "primaryContactId";
    if (companyId && contact.companyId && contact.companyId !== companyId) return "primaryContactId (belongs to a different company)";
  }
  if (sourceOrderId && !(await inOrg("order", sourceOrderId))) return "sourceOrderId";
  if (sourceContractId && !(await inOrg("contract", sourceContractId))) return "sourceContractId";
  if (portfolioId && !(await inOrg("projectPortfolio", portfolioId, { archivedAt: null }))) return "portfolioId";
  if (ownerMembershipId && !(await inOrg("organizationMembership", ownerMembershipId, { status: "Active" }))) return "ownerMembershipId";
  return null;
}

const DATE_FIELDS = ["startDate", "dueDate", "actualStartDate", "actualEndDate"];
const REF_FIELDS = ["companyId", "dealId", "portfolioId", "primaryContactId", "sourceOrderId", "sourceContractId"];

function fields(req, body, existing) {
  const out = {};
  if (!existing || "name" in body) {
    out.name = text(body.name, 200);
    if (!out.name) return { error: "name is required." };
  }
  for (const f of ["description", "customerSummary", "department", "team", "projectType"]) if (f in body) out[f] = text(body[f], f.endsWith("Summary") || f === "description" ? 5000 : 120);
  for (const f of REF_FIELDS) if (f in body) out[f] = body[f] || null;
  if ("ownerMembershipId" in body) out.ownerMembershipId = body.ownerMembershipId || null;
  for (const f of DATE_FIELDS) {
    if (f in body) {
      const v = body[f] ? new Date(body[f]) : null;
      if (v && Number.isNaN(v.getTime())) return { error: `${f} must be a valid date.` };
      out[f] = v;
    }
  }
  const start = "startDate" in out ? out.startDate : existing?.startDate;
  const due = "dueDate" in out ? out.dueDate : existing?.dueDate;
  if (start && due && due < start) return { error: "The planned end can't be before the planned start." };
  if ("priority" in body) {
    if (!PROJECT_PRIORITIES.includes(body.priority)) return { error: `priority must be one of ${PROJECT_PRIORITIES.join(", ")}.` };
    out.priority = body.priority;
  }
  if ("healthState" in body) {
    if (body.healthState && !HEALTH_STATES.includes(body.healthState)) return { error: `healthState must be one of ${HEALTH_STATES.join(", ")}.` };
    out.healthState = body.healthState || null;
    out.healthNote = text(body.healthNote, 1000);
  }
  if ("progressMode" in body) {
    if (!PROGRESS_MODES.includes(body.progressMode)) return { error: `progressMode must be one of ${PROGRESS_MODES.join(", ")}.` };
    out.progressMode = body.progressMode;
  }
  if ("customerVisible" in body) out.customerVisible = Boolean(body.customerVisible);
  if ("plannedEffortMinutes" in body) {
    const n = body.plannedEffortMinutes === null || body.plannedEffortMinutes === "" ? null : Number(body.plannedEffortMinutes);
    if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= 10_000_000)) return { error: "plannedEffortMinutes must be a whole number of minutes." };
    out.plannedEffortMinutes = n;
  }
  if ("plannedBudget" in body || "currency" in body) {
    if (!canSeeFinancials(req)) return { forbidden: "You don't have permission to set the project budget." };
    if ("currency" in body) out.currency = body.currency ? String(body.currency).toUpperCase().slice(0, 3) : null;
    if ("plannedBudget" in body) {
      const b = body.plannedBudget === null || body.plannedBudget === "" ? null : Number(body.plannedBudget);
      if (b !== null && !(Number.isFinite(b) && b >= 0)) return { error: "plannedBudget must be zero or more." };
      out.plannedBudget = b === null ? null : round(b, out.currency || existing?.currency || "USD");
    }
  }
  return { data: out };
}

// ---------------------------------------------------------------- Read

export async function list(req, res) {
  const q = req.query;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.pageSize) || 25));
  const where = { organizationId: req.organizationId, ...scopeWhere(req) };
  if (q.includeArchived !== "true") where.archivedAt = null;
  for (const f of ["status", "companyId", "ownerMembershipId", "portfolioId", "priority", "department"]) if (q[f]) where[f] = q[f];
  // Search stays inside the caller's scope (ANDed with it).
  if (q.search) where.AND = [{ OR: [{ name: { contains: q.search, mode: "insensitive" } }, { projectNumber: { contains: q.search, mode: "insensitive" } }] }];
  const [projects, total] = await Promise.all([
    prisma.project.findMany({ where, include: INCLUDE, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.project.count({ where }),
  ]);
  const tasks = await tasksFor(projects.map((p) => p.id));
  res.json({ projects: projects.map((p) => serializeProject(req, p, tasks.filter((t) => t.projectId === p.id))), total, page, pageSize });
}

export async function getOne(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  res.json({ project: serializeProject(req, project, await tasksFor([project.id])) });
}

export async function history(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  const activities = await prisma.projectActivity.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" }, take: 1000 });
  res.json({ history: toApi(activities) });
}

// ---------------------------------------------------------------- Create / update

export async function create(req, res) {
  const { data, error, forbidden: denied } = fields(req, req.body, null);
  if (denied) return forbidden(res, denied);
  if (error) return invalid(res, error);
  if (!data.ownerMembershipId) data.ownerMembershipId = who(req);
  const refError = await validateRefs(req.organizationId, data);
  if (refError) return badRef(res, refError);
  const status = req.body.status && req.body.status !== "Planning" ? null : "Planning";
  if (!status) return invalid(res, "A new project starts in Planning — activate it through a transition.");
  const project = await prisma.$transaction(async (tx) => {
    const projectNumber = await nextDocumentNumber(tx, req.organizationId, "Project");
    const p = await tx.project.create({ data: { ...data, organizationId: req.organizationId, projectNumber, status, createdByMembershipId: who(req), updatedByMembershipId: who(req) } });
    if (p.ownerMembershipId) await tx.projectMember.create({ data: { organizationId: req.organizationId, projectId: p.id, membershipId: p.ownerMembershipId, role: "Project Manager" } });
    await ensureDefaultBoard(tx, p);
    await projectActivity(tx, { organizationId: req.organizationId, projectId: p.id, eventType: "Project Created", actorMembershipId: who(req), toValue: status, snapshot: { projectNumber, name: p.name } });
    return p;
  });
  await audit(req, "projects.project.created", project.id);
  await saved(req, res, project.id, 201);
}

export async function update(req, res) {
  const existing = await loadProject(req, res);
  if (!existing) return;
  if (existing.archivedAt) return badTransition(res, "An archived project can't be edited — restore it first.");
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) return conflict(res);
  // The frontend changes status through the same update call; that's a
  // lifecycle transition with its own rules.
  if ("status" in req.body && req.body.status !== existing.status) return transition(req, res, existing);
  if (!managesProject(req, existing)) return forbidden(res, "Only the project's managers can edit it.");
  const { data, error, forbidden: denied } = fields(req, req.body, existing);
  if (denied) return forbidden(res, denied);
  if (error) return invalid(res, error);
  if ("ownerMembershipId" in data && data.ownerMembershipId !== existing.ownerMembershipId && !hasGrant(req, "projects", "assign")) {
    return forbidden(res, "You don't have permission to change the project manager.");
  }
  if (data.progressMode === "Manual" && existing.progressMode !== "Manual") {
    return invalid(res, "Manual progress is set through POST /progress (it needs a value, a reason and its own permission).");
  }
  const refError = await validateRefs(req.organizationId, {
    ...Object.fromEntries(REF_FIELDS.map((f) => [f, f in data ? data[f] : existing[f]])), ownerMembershipId: data.ownerMembershipId,
  });
  if (refError) return badRef(res, refError);
  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: existing.id }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } } });
    if ("ownerMembershipId" in data && data.ownerMembershipId && data.ownerMembershipId !== existing.ownerMembershipId) {
      await tx.projectMember.upsert({
        where: { projectId_membershipId: { projectId: existing.id, membershipId: data.ownerMembershipId } },
        update: { role: "Project Manager", active: true, accessLevel: "Edit" },
        create: { organizationId: req.organizationId, projectId: existing.id, membershipId: data.ownerMembershipId, role: "Project Manager" },
      });
      await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.id, eventType: "Manager Changed", actorMembershipId: who(req), fromValue: existing.ownerMembershipId, toValue: data.ownerMembershipId });
    }
    if ("healthState" in data && data.healthState !== existing.healthState) {
      await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.id, eventType: "Health Updated", actorMembershipId: who(req), fromValue: existing.healthState, toValue: data.healthState, reason: data.healthNote });
    }
  });
  await audit(req, "projects.project.updated", existing.id);
  await saved(req, res, existing.id);
}

// Manual progress needs its own permission and a reason.
export async function setManualProgress(req, res) {
  const existing = await loadProject(req, res);
  if (!existing) return;
  const value = Number(req.body.progress);
  const reason = text(req.body.reason, 500);
  if (!Number.isInteger(value) || value < 0 || value > 100) return invalid(res, "progress must be a whole number from 0 to 100.");
  if (!reason) return invalid(res, "A reason is required to set progress manually.");
  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: existing.id }, data: { progressMode: "Manual", manualProgress: value, manualProgressReason: reason, updatedByMembershipId: who(req), version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.id, eventType: "Progress Overridden", actorMembershipId: who(req), fromValue: existing.manualProgress, toValue: value, reason });
  });
  await audit(req, "projects.project.progress_overridden", existing.id, { reason });
  await saved(req, res, existing.id);
}

// ---------------------------------------------------------------- Lifecycle

// POST /transition { status, reason? }. Activating needs a manager, planned
// dates and at least one active member; completing needs every milestone
// that requires acceptance achieved and no deliverable still in review;
// cancelling and reopening need a reason (reopening also its own grant).
export async function transition(req, res, preloaded = null) {
  const existing = preloaded || (await loadProject(req, res));
  if (!existing) return;
  if (existing.archivedAt) return badTransition(res, "An archived project can't change status — restore it first.");
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) return conflict(res);
  const to = req.body.status;
  const reason = text(req.body.reason, 1000);
  if (!PROJECT_STATUSES.includes(to) || !canTransitionProject(existing.status, to)) return badTransition(res, `Can't move a project from "${existing.status}" to "${to}".`);
  if (!hasGrant(req, "projects", "transition")) return forbidden(res, "You don't have permission to change a project's status.");
  if (!managesProject(req, existing)) return forbidden(res, "Only the project's managers can change its status.");

  if (to === "Active" && existing.status === "Planning") {
    const missing = [];
    if (!existing.ownerMembershipId) missing.push("a project manager");
    if (!existing.startDate || !existing.dueDate) missing.push("planned start and end dates");
    if (!existing.members.length) missing.push("at least one member");
    if (missing.length) return badTransition(res, `To activate, the project needs ${missing.join(", ")}.`);
  }
  if (to === "Active" && existing.status === "Completed") {
    if (!hasGrant(req, "projects", "reopen")) return forbidden(res, "You don't have permission to reopen a completed project.");
    if (!reason) return invalid(res, "A reason is required to reopen a completed project.");
  }
  if (to === "Cancelled" && !reason) return invalid(res, "A reason is required to cancel a project.");
  if (to === "Completed") {
    const pendingMilestones = existing.milestones.filter((m) => m.acceptanceRequired && m.status !== "Achieved" && m.status !== "Cancelled");
    if (pendingMilestones.length) return badTransition(res, `Milestones needing acceptance aren't achieved yet: ${pendingMilestones.map((m) => m.name).join(", ")}.`);
    const inReview = await prisma.deliverable.count({ where: { projectId: existing.id, archivedAt: null, status: { in: ["Ready for Review", "Changes Requested", "Ready for Customer Review"] } } });
    if (inReview) return badTransition(res, `${inReview} deliverable(s) are still in review.`);
  }

  const now = new Date();
  const data = { status: to };
  if (to === "Active" && !existing.actualStartDate) data.actualStartDate = now;
  if (to === "Completed") Object.assign(data, { completedAt: now, actualEndDate: now });
  if (existing.status === "Completed") Object.assign(data, { completedAt: null, actualEndDate: null });
  if (to === "Cancelled") Object.assign(data, { cancelledAt: now, cancellationReason: reason });
  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: existing.id }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.id, eventType: "Status Changed", actorMembershipId: who(req), fromValue: existing.status, toValue: to, reason, customerVisible: true });
  });
  await audit(req, "projects.project.status_changed", existing.id, { reason, before: { status: existing.status }, after: { status: to } });
  await saved(req, res, existing.id);
}

// Archiving never deletes tasks, time or history.
export async function archive(req, res) {
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "A reason is required to archive a project.");
  const existing = await loadProject(req, res);
  if (!existing) return;
  if (existing.archivedAt) return badTransition(res, "This project is already archived.");
  if (!ARCHIVABLE_PROJECT_STATUSES.includes(existing.status)) return badTransition(res, "Only a completed or cancelled project can be archived.");
  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: existing.id }, data: { archivedAt: new Date(), archiveReason: reason, archivedByMembershipId: who(req), statusBeforeArchive: existing.status, version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.id, eventType: "Archived", actorMembershipId: who(req), reason });
  });
  await audit(req, "projects.project.archived", existing.id, { reason });
  await saved(req, res, existing.id);
}

export async function restore(req, res) {
  const existing = await loadProject(req, res);
  if (!existing) return;
  if (!existing.archivedAt) return badTransition(res, "This project isn't archived.");
  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: existing.id }, data: { archivedAt: null, archiveReason: null, archivedByMembershipId: null, version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.id, eventType: "Restored", actorMembershipId: who(req) });
  });
  await audit(req, "projects.project.restored", existing.id);
  await saved(req, res, existing.id);
}

// ---------------------------------------------------------------- Milestones

// POST /:projectId/milestones { name, dueDate, phaseId?, ownerMembershipId?, customerVisible?, acceptanceRequired? }
export async function addMilestone(req, res) {
  const name = text(req.body.name, 200);
  if (!name) return invalid(res, "A milestone name is required.");
  const dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) return invalid(res, "dueDate must be a valid date.");
  const existing = await loadProject(req, res);
  if (!existing) return;
  if (!managesProject(req, existing)) return forbidden(res, "Only the project's managers can plan milestones.");
  if (req.body.phaseId && !(await prisma.projectPhase.findFirst({ where: { id: req.body.phaseId, projectId: existing.id } }))) return badRef(res, "phaseId");
  if (req.body.ownerMembershipId && !(await prisma.organizationMembership.findFirst({ where: { id: req.body.ownerMembershipId, organizationId: req.organizationId, status: "Active" } }))) return badRef(res, "ownerMembershipId");
  await prisma.$transaction(async (tx) => {
    const m = await tx.milestone.create({
      data: {
        projectId: existing.id, organizationId: req.organizationId, name, dueDate, description: text(req.body.description, 2000), phaseId: req.body.phaseId || null,
        ownerMembershipId: req.body.ownerMembershipId || null, customerVisible: Boolean(req.body.customerVisible), acceptanceRequired: Boolean(req.body.acceptanceRequired),
      },
    });
    await tx.project.update({ where: { id: existing.id }, data: { updatedByMembershipId: who(req), version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.id, eventType: "Milestone Added", actorMembershipId: who(req), toValue: name, snapshot: { milestoneId: m.id } });
  });
  await audit(req, "projects.milestone.added", existing.id, { after: { name } });
  await saved(req, res, existing.id, 201);
}

// PATCH /:projectId/milestones/:milestoneId — details and status. Achieved
// goes through /achieve (a person confirms it).
export async function updateMilestone(req, res) {
  const existing = await loadProject(req, res);
  if (!existing) return;
  if (!managesProject(req, existing)) return forbidden(res, "Only the project's managers can change milestones.");
  const m = existing.milestones.find((x) => x.id === req.params.milestoneId);
  if (!m) return res.status(404).json({ code: "PROJECTS_RECORD_NOT_FOUND", message: "Milestone not found." });
  if (req.body.version !== undefined && Number(req.body.version) !== m.version) return conflict(res);
  const data = {};
  if ("name" in req.body) { data.name = text(req.body.name, 200); if (!data.name) return invalid(res, "name can't be empty."); }
  if ("description" in req.body) data.description = text(req.body.description, 2000);
  if ("dueDate" in req.body) { data.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null; if (data.dueDate && Number.isNaN(data.dueDate.getTime())) return invalid(res, "dueDate must be a valid date."); }
  for (const f of ["customerVisible", "acceptanceRequired"]) if (f in req.body) data[f] = Boolean(req.body[f]);
  if ("status" in req.body) {
    if (!MILESTONE_STATUSES.includes(req.body.status) || req.body.status === "Achieved") return invalid(res, "status must be Planned, In Progress, At Risk, Missed or Cancelled (use achieve to confirm Achieved).");
    Object.assign(data, { status: req.body.status, completed: false, completedAt: null, completedByMembershipId: null });
  }
  await prisma.$transaction(async (tx) => {
    await tx.milestone.update({ where: { id: m.id }, data: { ...data, version: { increment: 1 } } });
    if (data.status && data.status !== m.status) await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.id, eventType: "Milestone Status Changed", actorMembershipId: who(req), fromValue: m.status, toValue: data.status, snapshot: { milestoneId: m.id, name: m.name } });
  });
  await audit(req, "projects.milestone.updated", existing.id, { after: { milestoneId: m.id } });
  await saved(req, res, existing.id);
}

// POST /achieve — a person confirms the milestone (never automatic).
export async function achieveMilestone(req, res) {
  req.body = { ...req.body, completed: true };
  return toggleMilestone(req, res);
}

// Kept for the frontend: flips (or sets, with `completed`) Achieved.
export async function toggleMilestone(req, res) {
  const existing = await loadProject(req, res);
  if (!existing) return;
  if (!managesProject(req, existing)) return forbidden(res, "Only the project's managers can confirm milestones.");
  const milestone = existing.milestones.find((m) => m.id === req.params.milestoneId);
  if (!milestone) return res.status(404).json({ code: "PROJECTS_RECORD_NOT_FOUND", message: "Milestone not found." });
  const completed = typeof req.body?.completed === "boolean" ? req.body.completed : !milestone.completed;
  await prisma.$transaction(async (tx) => {
    await tx.milestone.update({
      where: { id: milestone.id },
      data: { completed, status: completed ? "Achieved" : "Planned", completedAt: completed ? new Date() : null, completedByMembershipId: completed ? who(req) : null, version: { increment: 1 } },
    });
    await tx.project.update({ where: { id: existing.id }, data: { updatedByMembershipId: who(req), version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.id, eventType: completed ? "Milestone Achieved" : "Milestone Reopened", actorMembershipId: who(req), snapshot: { milestoneId: milestone.id, name: milestone.name }, customerVisible: milestone.customerVisible });
  });
  await audit(req, completed ? "projects.milestone.completed" : "projects.milestone.reopened", existing.id, { after: { milestoneId: milestone.id } });
  await saved(req, res, existing.id);
}

// Route entry for POST /transition — Express passes `next` as a third
// argument, which must not be mistaken for a preloaded project.
export const transitionRoute = (req, res) => transition(req, res);
