import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { broadestScope } from "../../services/crm/scopeService.js";
import { pickWritable } from "../../utils/pickWritable.js";
import { TASK_STATUSES, TASK_PRIORITIES, MAX_HOURS_PER_ENTRY, createsDependencyCycle, hasGrant } from "../../services/projects/projectRulesService.js";
import { projectScopeWhere } from "./projectsController.js";

const MAX_PAGE_SIZE = 200;

// The only fields a client may write (see pickWritable). A new task always
// starts "To Do"; loggedHours only moves through /time; comments through
// /comments; a task never moves to another project.
const CREATE_FIELDS = ["projectId", "title", "description", "assigneeMembershipId", "priority", "dueDate", "estimateHours", "dependsOnId", "recurring"];
const UPDATE_FIELDS = ["title", "description", "assigneeMembershipId", "priority", "status", "dueDate", "estimateHours", "dependsOnId", "recurring"];
const COERCE = { dates: ["dueDate"], numbers: ["estimateHours"] };

// Anything narrower than the whole organization sees the tasks the member
// is assigned to or created, plus every task in projects they own.
export function taskScopeWhere(req) {
  if (req.isSystemOwnerOverride) return {};
  const scope = broadestScope(req.membership, "tasks");
  if (scope === "Organization" || scope === "System-wide") return {};
  const me = req.membership.id;
  return { OR: [{ assigneeMembershipId: me }, { createdByMembershipId: me }, { project: { ownerMembershipId: me } }] };
}

const INCLUDE = {
  project: { select: { id: true, name: true, status: true } },
  dependsOn: { select: { id: true, title: true, status: true } },
  commentEntries: { orderBy: { createdAt: "asc" } },
  timeLog: { orderBy: { createdAt: "asc" } },
};

const invalid = (res, message) => res.status(400).json({ code: "PROJECTS_VALIDATION_FAILED", message });

function validateFields(fields) {
  if ("title" in fields && !fields.title?.trim()) return "title is required.";
  if ("status" in fields && !TASK_STATUSES.includes(fields.status)) return `status must be one of ${TASK_STATUSES.join(", ")}.`;
  if ("priority" in fields && !TASK_PRIORITIES.includes(fields.priority)) return `priority must be one of ${TASK_PRIORITIES.join(", ")}.`;
  if (fields.dueDate && Number.isNaN(fields.dueDate.getTime())) return "dueDate must be a valid date.";
  if (fields.estimateHours !== undefined && fields.estimateHours !== null && !(Number.isFinite(fields.estimateHours) && fields.estimateHours >= 0)) {
    return "estimateHours must be zero or more.";
  }
  if ("recurring" in fields) fields.recurring = Boolean(fields.recurring);
  return null;
}

async function activeMember(organizationId, membershipId) {
  return !!(await prisma.organizationMembership.findFirst({ where: { id: membershipId, organizationId, status: "Active" } }));
}

// A dependency must be another task in the same project, and must not loop
// back to this task.
async function dependencyError(organizationId, projectId, taskId, dependsOnId) {
  if (!dependsOnId) return null;
  if (dependsOnId === taskId) return "A task can't depend on itself.";
  const dep = await prisma.task.findFirst({ where: { id: dependsOnId, organizationId } });
  if (!dep || dep.projectId !== projectId) return "dependsOnId must be a task in the same project.";
  if (taskId && (await createsDependencyCycle(taskId, dependsOnId, (id) => prisma.task.findFirst({ where: { id, organizationId }, select: { id: true, dependsOnId: true } })))) {
    return "That dependency would create a loop.";
  }
  return null;
}

async function loadTask(req, res) {
  const task = await prisma.task.findFirst({ where: { id: req.params.taskId, organizationId: req.organizationId, ...taskScopeWhere(req) }, include: INCLUDE });
  if (!task) res.status(404).json({ code: "PROJECTS_RECORD_NOT_FOUND", message: "Task not found." });
  return task;
}

async function audit(req, action, taskId, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action, targetType: "Task", targetId: taskId, result: "Success", ...extra });
}

async function saved(res, taskId, status = 200) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: INCLUDE });
  res.status(status).json({ task: toApi(task) });
}

export async function list(req, res) {
  const q = req.query;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.pageSize) || 50));
  const where = { organizationId: req.organizationId, ...taskScopeWhere(req) };
  if (q.projectId) where.projectId = q.projectId;
  if (q.status) where.status = q.status;
  if (q.priority) where.priority = q.priority;
  if (q.assigneeMembershipId === "unassigned") where.assigneeMembershipId = null;
  else if (q.assigneeMembershipId) where.assigneeMembershipId = q.assigneeMembershipId;
  if (q.search) where.AND = [{ title: { contains: q.search, mode: "insensitive" } }];
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({ where, include: INCLUDE, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.task.count({ where }),
  ]);
  res.json({ tasks: toApi(tasks), total, page, pageSize });
}

export async function getOne(req, res) {
  const task = await loadTask(req, res);
  if (!task) return;
  res.json({ task: toApi(task) });
}

export async function create(req, res) {
  const fields = pickWritable(req.body, CREATE_FIELDS, COERCE);
  if (!fields.title?.trim()) return invalid(res, "title is required.");
  if (!fields.projectId) return invalid(res, "projectId is required.");
  const error = validateFields(fields);
  if (error) return invalid(res, error);

  // The project must be one the caller can see in this organization.
  const project = await prisma.project.findFirst({ where: { id: fields.projectId, organizationId: req.organizationId, ...projectScopeWhere(req) } });
  if (!project) return res.status(400).json({ code: "PROJECTS_REFERENCE_INVALID", message: "projectId must reference a project in this organization." });
  if (project.status === "Completed") return res.status(400).json({ code: "PROJECTS_INVALID_TRANSITION", message: "This project is completed — reopen it before adding tasks." });
  if (fields.assigneeMembershipId) {
    // Without "assign", a new task can only go to the caller themself.
    if (fields.assigneeMembershipId !== req.membership?.id && !hasGrant(req, "tasks", "assign")) {
      return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "You don't have permission to assign tasks to other members." });
    }
    if (!(await activeMember(req.organizationId, fields.assigneeMembershipId))) {
      return res.status(400).json({ code: "PROJECTS_REFERENCE_INVALID", message: "assigneeMembershipId must reference an active membership in this organization." });
    }
  }
  const depError = await dependencyError(req.organizationId, project.id, null, fields.dependsOnId);
  if (depError) return invalid(res, depError);

  const task = await prisma.task.create({
    data: {
      ...fields, priority: fields.priority || "Medium", status: "To Do", organizationId: req.organizationId,
      createdByMembershipId: req.membership?.id || null, updatedByMembershipId: req.membership?.id || null,
    },
  });
  await audit(req, "projects.task.created", task.id, { after: { projectId: project.id } });
  await saved(res, task.id, 201);
}

export async function update(req, res) {
  const existing = await loadTask(req, res);
  if (!existing) return;
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "PROJECTS_VERSION_CONFLICT", message: "This task was updated by someone else. Refresh and try again." });
  }
  const fields = pickWritable(req.body, UPDATE_FIELDS, COERCE);
  const error = validateFields(fields);
  if (error) return invalid(res, error);

  if ("assigneeMembershipId" in fields && fields.assigneeMembershipId !== existing.assigneeMembershipId) {
    // Reassigning needs the "assign" grant, not just "edit".
    if (!hasGrant(req, "tasks", "assign")) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "You don't have permission to reassign tasks." });
    if (fields.assigneeMembershipId && !(await activeMember(req.organizationId, fields.assigneeMembershipId))) {
      return res.status(400).json({ code: "PROJECTS_REFERENCE_INVALID", message: "assigneeMembershipId must reference an active membership in this organization." });
    }
  }
  if ("dependsOnId" in fields && fields.dependsOnId !== existing.dependsOnId) {
    const depError = await dependencyError(req.organizationId, existing.projectId, existing.id, fields.dependsOnId);
    if (depError) return invalid(res, depError);
  }

  const statusChanged = fields.status && fields.status !== existing.status;
  if (statusChanged && fields.status === "Done") {
    // A task can't be finished before the task it waits on.
    const dependsOnId = "dependsOnId" in fields ? fields.dependsOnId : existing.dependsOnId;
    const dep = dependsOnId ? await prisma.task.findUnique({ where: { id: dependsOnId }, select: { title: true, status: true } }) : null;
    if (dep && dep.status !== "Done") {
      return res.status(400).json({ code: "PROJECTS_DEPENDENCY_BLOCKED", message: `This task depends on "${dep.title}", which isn't done yet.` });
    }
  }

  await prisma.task.update({
    where: { id: existing.id },
    data: {
      ...fields,
      ...(statusChanged && { completedAt: fields.status === "Done" ? new Date() : null }),
      updatedByMembershipId: req.membership?.id || null, version: { increment: 1 },
    },
  });
  const action = statusChanged ? "projects.task.status_changed" : "assigneeMembershipId" in fields && fields.assigneeMembershipId !== existing.assigneeMembershipId ? "projects.task.assigned" : "projects.task.updated";
  await audit(req, action, existing.id, {
    before: { status: existing.status, assigneeMembershipId: existing.assigneeMembershipId },
    after: { status: fields.status ?? existing.status, assigneeMembershipId: "assigneeMembershipId" in fields ? fields.assigneeMembershipId : existing.assigneeMembershipId },
  });
  await saved(res, existing.id);
}

export async function addComment(req, res) {
  const body = req.body.message?.trim();
  if (!body) return invalid(res, "A comment can't be empty.");
  const existing = await loadTask(req, res);
  if (!existing) return;
  await prisma.$transaction([
    prisma.taskComment.create({ data: { taskId: existing.id, organizationId: req.organizationId, body, authorMembershipId: req.membership?.id || null } }),
    prisma.task.update({ where: { id: existing.id }, data: { version: { increment: 1 } } }),
  ]);
  await audit(req, "projects.task.commented", existing.id);
  await saved(res, existing.id);
}

export async function logTime(req, res) {
  const hours = Number(req.body.hours);
  if (!(Number.isFinite(hours) && hours > 0 && hours <= MAX_HOURS_PER_ENTRY)) {
    return invalid(res, `hours must be more than 0 and at most ${MAX_HOURS_PER_ENTRY}.`);
  }
  const existing = await loadTask(req, res);
  if (!existing) return;
  const note = typeof req.body.note === "string" && req.body.note.trim() ? req.body.note.trim() : null;
  await prisma.$transaction([
    prisma.taskTimeEntry.create({ data: { taskId: existing.id, organizationId: req.organizationId, hours, note, authorMembershipId: req.membership?.id || null } }),
    prisma.task.update({ where: { id: existing.id }, data: { loggedHours: { increment: hours }, version: { increment: 1 } } }),
  ]);
  await audit(req, "projects.task.time_logged", existing.id, { after: { hours } });
  await saved(res, existing.id);
}
