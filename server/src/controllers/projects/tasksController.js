// Backend Phase 5 (full spec) — tasks, subtasks, checklists, assignees,
// labels, dependencies, board moves, comments and bulk actions. Mounted
// under /projects/:projectId/tasks (spec routes) and /tasks (the routes the
// frontend already calls).
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { sanitizeText } from "../../services/support/supportCommon.js";
import { TASK_PRIORITIES, DEPENDENCY_TYPES, MAX_MINUTES_PER_ENTRY } from "../../services/projects/projectRulesService.js";
import { taskScopeWhere, managesProject, projectRoleOf, projectActivity } from "../../services/projects/projectAccess.js";
import { ensureDefaultBoard, columnForStatus, checkColumnMove } from "../../services/projects/boardService.js";
import {
  taskInclude, serializeTask, loadProjectForTasks, loadTask, invalidAssignees, dependencyWouldLoop, parentWouldLoop, commentVisibilities, refreshLoggedHours,
} from "../../services/projects/taskService.js";

const MAX_PAGE_SIZE = 200;
const MAX_BULK = 100;
const who = (req) => req.membership?.id || null;
const text = (v, max) => (typeof v === "string" && v.trim() ? sanitizeText(v, { max }) : null);
const invalid = (res, message) => res.status(400).json({ code: "PROJECTS_VALIDATION_FAILED", message });
const notFound = (res, what = "Task") => res.status(404).json({ code: "PROJECTS_RECORD_NOT_FOUND", message: `${what} not found.` });
const forbidden = (res, message) => res.status(403).json({ code: "RBAC_FORBIDDEN", message });
const blocked = (res, message) => res.status(400).json({ code: "PROJECTS_TRANSITION_BLOCKED", message });
const conflict = (res, what = "task") => res.status(409).json({ code: "PROJECTS_VERSION_CONFLICT", message: `This ${what} was updated by someone else. Refresh and try again.` });

async function audit(req, action, taskId, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: who(req), organizationId: req.organizationId, action, targetType: "Task", targetId: taskId, result: "Success", ...extra });
}

const projectIdOf = (req) => req.params.projectId || req.body?.projectId || req.query?.projectId || null;

async function sendTask(req, res, taskId, project, status = 200) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: taskInclude(req, project) });
  res.status(status).json({ task: serializeTask(task) });
}

// Loads the task (in scope) and its project; 404 otherwise.
async function load(req, res) {
  const task = await loadTask(req, req.params.taskId, req.params.projectId || null);
  if (!task) { notFound(res); return null; }
  return task;
}

// ---------------------------------------------------------------- List / read

export async function list(req, res) {
  const q = req.query;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.pageSize) || 50));
  const projectId = projectIdOf(req);
  let project = null;
  if (projectId) {
    project = await loadProjectForTasks(req, projectId);
    if (!project) return notFound(res, "Project");
  }
  const where = { organizationId: req.organizationId, ...taskScopeWhere(req) };
  if (projectId) where.projectId = projectId;
  if (q.includeArchived !== "true") where.archivedAt = null;
  for (const f of ["status", "columnId", "priority", "phaseId", "milestoneId", "boardId"]) if (q[f]) where[f] = q[f];
  if (q.parentTaskId) where.parentTaskId = q.parentTaskId === "none" ? null : q.parentTaskId;
  if (q.assigneeMembershipId === "unassigned") where.assigneeMembershipId = null;
  else if (q.assigneeMembershipId) where.assigneeMembershipId = q.assigneeMembershipId;
  if (q.blocked) where.blocked = q.blocked === "true";
  const and = [];
  if (q.labelId) and.push({ labels: { some: { labelId: q.labelId } } });
  if (q.search) and.push({ OR: [{ title: { contains: q.search, mode: "insensitive" } }, { taskNumber: { contains: q.search, mode: "insensitive" } }] });
  if (and.length) where.AND = and;
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({ where, include: { ...taskInclude(req, project || { members: [] }), project: { select: { id: true, ownerMembershipId: true } } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.task.count({ where }),
  ]);
  res.json({ tasks: tasks.map(serializeTask), total, page, pageSize });
}

export async function getOne(req, res) {
  const task = await load(req, res);
  if (!task) return;
  await sendTask(req, res, task.id, task.project);
}

// ---------------------------------------------------------------- Create / update

function parseTaskFields(body, { partial }) {
  const out = {};
  if (!partial || "title" in body) {
    out.title = text(body.title, 300);
    if (!out.title) return { error: "title is required." };
  }
  if ("description" in body) out.description = text(body.description, 20000);
  if ("taskType" in body) out.taskType = text(body.taskType, 40) || "Task";
  if ("priority" in body) {
    if (!TASK_PRIORITIES.includes(body.priority)) return { error: `priority must be one of ${TASK_PRIORITIES.join(", ")}.` };
    out.priority = body.priority;
  }
  for (const f of ["dueDate", "plannedStartDate"]) {
    if (f in body) {
      out[f] = body[f] ? new Date(body[f]) : null;
      if (out[f] && Number.isNaN(out[f].getTime())) return { error: `${f} must be a valid date.` };
    }
  }
  if (out.plannedStartDate && out.dueDate && out.dueDate < out.plannedStartDate) return { error: "dueDate can't be before plannedStartDate." };
  // Effort in minutes; estimateHours (the frontend's field) is converted.
  if ("estimateHours" in body && !("estimatedMinutes" in body)) body = { ...body, estimatedMinutes: body.estimateHours === null || body.estimateHours === "" ? null : Math.round(Number(body.estimateHours) * 60) };
  for (const f of ["estimatedMinutes", "remainingMinutes"]) {
    if (f in body) {
      const n = body[f] === null || body[f] === "" ? null : Number(body[f]);
      if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= 1_000_000)) return { error: `${f} must be whole minutes.` };
      out[f] = n;
    }
  }
  if ("estimatedMinutes" in out) out.estimateHours = out.estimatedMinutes === null ? null : Math.round((out.estimatedMinutes / 60) * 100) / 100;
  if ("weight" in body) {
    const w = Number(body.weight);
    if (!Number.isInteger(w) || w < 0 || w > 100) return { error: "weight must be a whole number from 0 to 100." };
    out.weight = w;
  }
  if ("progress" in body) {
    const p = Number(body.progress);
    if (!Number.isInteger(p) || p < 0 || p > 100) return { error: "progress must be a whole number from 0 to 100." };
    out.progress = p;
  }
  if ("customerVisible" in body) out.customerVisible = Boolean(body.customerVisible);
  if ("recurring" in body) out.recurring = Boolean(body.recurring);
  return { data: out };
}

async function validateTaskRefs(project, { parentTaskId, phaseId, milestoneId }, taskId = null) {
  if (parentTaskId) {
    const parent = await prisma.task.findFirst({ where: { id: parentTaskId, projectId: project.id, archivedAt: null } });
    if (!parent) return "The parent must be an active task in the same project.";
    if (taskId && (await parentWouldLoop(taskId, parentTaskId))) return "A task can't be its own ancestor.";
  }
  if (phaseId && !(await prisma.projectPhase.findFirst({ where: { id: phaseId, projectId: project.id, archivedAt: null } }))) return "phaseId must be a phase of this project.";
  if (milestoneId && !(await prisma.milestone.findFirst({ where: { id: milestoneId, projectId: project.id, archivedAt: null } }))) return "milestoneId must be a milestone of this project.";
  return null;
}

async function validateLabels(req, project, labelIds) {
  if (!Array.isArray(labelIds)) return "labelIds must be a list.";
  const count = await prisma.projectLabel.count({ where: { id: { in: labelIds }, organizationId: req.organizationId, archivedAt: null, OR: [{ projectId: null }, { projectId: project.id }] } });
  return count === new Set(labelIds).size ? null : "labelIds must be labels of this project or organization.";
}

function assigneeList(body) {
  if (Array.isArray(body.assigneeMembershipIds)) return [...new Set(body.assigneeMembershipIds.filter(Boolean))];
  if ("assigneeMembershipId" in body) return body.assigneeMembershipId ? [body.assigneeMembershipId] : [];
  if ("assigneeId" in body) return body.assigneeId ? [body.assigneeId] : [];
  return null;
}

export async function create(req, res) {
  const projectId = projectIdOf(req);
  if (!projectId) return invalid(res, "projectId is required.");
  const project = await loadProjectForTasks(req, projectId);
  if (!project) return invalid(res, "projectId must reference a project you can see in this organization.");
  if (project.archivedAt || ["Completed", "Cancelled"].includes(project.status)) return res.status(400).json({ code: "PROJECTS_INVALID_TRANSITION", message: "This project is completed, cancelled or archived — reopen it before adding tasks." });
  const { data, error } = parseTaskFields(req.body, { partial: false });
  if (error) return invalid(res, error);
  const refs = { parentTaskId: req.body.parentTaskId || null, phaseId: req.body.phaseId || null, milestoneId: req.body.milestoneId || null };
  const refError = await validateTaskRefs(project, refs);
  if (refError) return invalid(res, refError);
  const assignees = assigneeList(req.body) || [];
  if (assignees.some((id) => id !== who(req)) && !hasGrant(req, "tasks", "assign")) return forbidden(res, "You don't have permission to assign tasks to other members.");
  const assigneeError = await invalidAssignees(req.organizationId, project, assignees);
  if (assigneeError) return invalid(res, assigneeError);
  if (req.body.labelIds) { const e = await validateLabels(req, project, req.body.labelIds); if (e) return invalid(res, e); }

  const task = await prisma.$transaction(async (tx) => {
    const board = await ensureDefaultBoard(tx, project);
    // A new task starts in the board's first column (the frontend's "To Do").
    const column = board.columns[0];
    const taskNumber = await nextDocumentNumber(tx, req.organizationId, "Task");
    const t = await tx.task.create({
      data: {
        ...data, ...refs, organizationId: req.organizationId, projectId: project.id, taskNumber, priority: data.priority || "Medium",
        boardId: board.id, columnId: column.id, status: column.name, statusCategory: column.category, assigneeMembershipId: assignees[0] || null,
        createdByMembershipId: who(req), updatedByMembershipId: who(req), reporterMembershipId: who(req),
      },
    });
    for (const [i, id] of assignees.entries()) await tx.taskAssignee.create({ data: { organizationId: req.organizationId, taskId: t.id, membershipId: id, role: i === 0 ? "Owner" : "Contributor", assignedByMembershipId: who(req) } });
    for (const labelId of req.body.labelIds || []) await tx.taskLabel.create({ data: { taskId: t.id, labelId } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, taskId: t.id, eventType: "Task Created", actorMembershipId: who(req), toValue: column.name, snapshot: { taskNumber, title: t.title } });
    return t;
  });
  await audit(req, "projects.task.created", task.id, { after: { projectId: project.id } });
  await sendTask(req, res, task.id, project, 201);
}

export async function update(req, res) {
  const existing = await load(req, res);
  if (!existing) return;
  if (existing.archivedAt) return res.status(400).json({ code: "PROJECTS_INVALID_TRANSITION", message: "This task is archived — restore it first." });
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) return conflict(res);
  // The frontend moves a task by setting `status`, and assigns through the
  // same call — both go through their own rules.
  if ("status" in req.body && req.body.status !== existing.status) return transition(req, res, existing);
  const newAssignees = assigneeList(req.body);
  if (newAssignees) return assign(req, res, existing, newAssignees);
  const { data, error } = parseTaskFields(req.body, { partial: true });
  if (error) return invalid(res, error);
  const refs = {};
  for (const f of ["parentTaskId", "phaseId", "milestoneId"]) if (f in req.body) refs[f] = req.body[f] || null;
  const refError = await validateTaskRefs(existing.project, refs, existing.id);
  if (refError) return invalid(res, refError);
  if ("blocked" in req.body) {
    const reason = text(req.body.blockedReason, 1000);
    if (req.body.blocked && !reason) return invalid(res, "A blocked task needs a reason.");
    Object.assign(data, { blocked: Boolean(req.body.blocked), blockedReason: req.body.blocked ? reason : null });
  }
  if (req.body.labelIds) { const e = await validateLabels(req, existing.project, req.body.labelIds); if (e) return invalid(res, e); }
  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: existing.id }, data: { ...data, ...refs, updatedByMembershipId: who(req), version: { increment: 1 } } });
    if (req.body.labelIds) {
      await tx.taskLabel.deleteMany({ where: { taskId: existing.id } });
      for (const labelId of new Set(req.body.labelIds)) await tx.taskLabel.create({ data: { taskId: existing.id, labelId } });
    }
    if ("blocked" in data && data.blocked !== existing.blocked) {
      await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.projectId, taskId: existing.id, eventType: data.blocked ? "Task Blocked" : "Task Unblocked", actorMembershipId: who(req), reason: data.blockedReason });
    }
    if (data.priority && data.priority !== existing.priority) {
      await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.projectId, taskId: existing.id, eventType: "Task Priority Changed", actorMembershipId: who(req), fromValue: existing.priority, toValue: data.priority });
    }
  });
  await audit(req, "projects.task.updated", existing.id);
  await sendTask(req, res, existing.id, existing.project);
}

// ---------------------------------------------------------------- Board moves

// POST /transition { columnId | status, blockedReason? } — the same rules as
// Kanban drag-and-drop: allowed source columns and roles, WIP limit,
// required fields, open subtasks and dependencies (policy: block).
export async function transition(req, res, preloaded = null) {
  const existing = preloaded || (await load(req, res));
  if (!existing) return;
  if (existing.archivedAt) return res.status(400).json({ code: "PROJECTS_INVALID_TRANSITION", message: "This task is archived — restore it first." });
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) return conflict(res);
  if (!hasGrant(req, "tasks", "transition")) return forbidden(res, "You don't have permission to move tasks.");
  const board = await prisma.$transaction((tx) => ensureDefaultBoard(tx, existing.project));
  const taskBoard = existing.boardId && existing.boardId !== board.id
    ? await prisma.taskBoard.findUnique({ where: { id: existing.boardId }, include: { columns: { orderBy: { displayOrder: "asc" } } } })
    : board;
  const to = req.body.columnId ? taskBoard.columns.find((c) => c.id === req.body.columnId) : columnForStatus(taskBoard, req.body.status);
  const from = taskBoard.columns.find((c) => c.id === existing.columnId) || columnForStatus(taskBoard, existing.status);
  if (!to) return invalid(res, `"${req.body.status || req.body.columnId}" isn't a column on this task's board.`);
  const candidate = { ...existing, blockedReason: text(req.body.blockedReason, 1000) || existing.blockedReason };
  const [wipCount, openSubtasks, deps] = await Promise.all([
    prisma.task.count({ where: { columnId: to.id, archivedAt: null, id: { not: existing.id } } }),
    prisma.task.count({ where: { parentTaskId: existing.id, archivedAt: null, statusCategory: { notIn: ["Completed", "Cancelled"] } } }),
    prisma.taskDependency.findMany({ where: { successorId: existing.id }, include: { predecessor: { select: { title: true, statusCategory: true } } } }),
  ]);
  const problem = checkColumnMove(candidate, from, to, {
    projectRole: projectRoleOf(req, existing.project), wipCount, openSubtasks,
    blockingDependencies: deps.map((d) => ({ type: d.type, predecessorTitle: d.predecessor.title, predecessorCategory: d.predecessor.statusCategory })),
  });
  if (problem) return blocked(res, problem);

  const now = new Date();
  const data = { columnId: to.id, boardId: taskBoard.id, status: to.name, statusCategory: to.category };
  if (["In Progress", "Review", "Blocked", "Completed"].includes(to.category) && !existing.actualStartDate) data.actualStartDate = now;
  data.completedAt = to.category === "Completed" ? now : null;
  if (to.category === "Completed") Object.assign(data, { progress: 100, remainingMinutes: 0 });
  if (to.category === "Blocked") Object.assign(data, { blocked: true, blockedReason: candidate.blockedReason });
  else if (existing.blocked && from?.category === "Blocked") Object.assign(data, { blocked: false, blockedReason: null });
  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: existing.id }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } } });
    await projectActivity(tx, {
      organizationId: req.organizationId, projectId: existing.projectId, taskId: existing.id, eventType: to.category === "Completed" ? "Task Completed" : "Task Moved",
      actorMembershipId: who(req), fromValue: existing.status, toValue: to.name, customerVisible: existing.customerVisible,
    });
  });
  await audit(req, "projects.task.transitioned", existing.id, { before: { status: existing.status }, after: { status: to.name } });
  await sendTask(req, res, existing.id, existing.project);
}

// ---------------------------------------------------------------- Assignment

// POST /assign { assigneeMembershipIds: [...] } — replaces the set. The
// first is the primary assignee. Assignees must be active project members.
export async function assign(req, res, preloaded = null, list = null) {
  const existing = preloaded || (await load(req, res));
  if (!existing) return;
  const ids = list || assigneeList(req.body) || [];
  const current = await prisma.taskAssignee.findMany({ where: { taskId: existing.id, removedAt: null } });
  const changingOthers = ids.some((id) => id !== who(req)) || current.some((a) => a.membershipId !== who(req) && !ids.includes(a.membershipId));
  if (changingOthers && !hasGrant(req, "tasks", "assign")) return forbidden(res, "You don't have permission to reassign tasks.");
  const error = await invalidAssignees(req.organizationId, existing.project, ids);
  if (error) return invalid(res, error);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const a of current.filter((a) => !ids.includes(a.membershipId))) await tx.taskAssignee.update({ where: { id: a.id }, data: { removedAt: now } });
    for (const [i, id] of ids.entries()) {
      if (!current.find((a) => a.membershipId === id)) await tx.taskAssignee.create({ data: { organizationId: req.organizationId, taskId: existing.id, membershipId: id, role: i === 0 ? "Owner" : "Contributor", assignedByMembershipId: who(req) } });
    }
    await tx.task.update({ where: { id: existing.id }, data: { assigneeMembershipId: ids[0] || null, updatedByMembershipId: who(req), version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.projectId, taskId: existing.id, eventType: "Task Assigned", actorMembershipId: who(req), fromValue: current.map((a) => a.membershipId).join(",") || null, toValue: ids.join(",") || null });
  });
  await audit(req, "projects.task.assigned", existing.id, { before: { assignees: current.map((a) => a.membershipId) }, after: { assignees: ids } });
  await sendTask(req, res, existing.id, existing.project);
}

// ---------------------------------------------------------------- Archive

export async function archive(req, res) {
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "A reason is required to archive a task.");
  const existing = await load(req, res);
  if (!existing) return;
  if (existing.archivedAt) return invalid(res, "This task is already archived.");
  await prisma.$transaction(async (tx) => {
    // Archiving keeps time entries, comments and history.
    await tx.task.update({ where: { id: existing.id }, data: { archivedAt: new Date(), archiveReason: reason, version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.projectId, taskId: existing.id, eventType: "Task Archived", actorMembershipId: who(req), reason });
  });
  await audit(req, "projects.task.archived", existing.id, { reason });
  await sendTask(req, res, existing.id, existing.project);
}

export async function restore(req, res) {
  const existing = await load(req, res);
  if (!existing) return;
  if (!existing.archivedAt) return invalid(res, "This task isn't archived.");
  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: existing.id }, data: { archivedAt: null, archiveReason: null, version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.projectId, taskId: existing.id, eventType: "Task Restored", actorMembershipId: who(req) });
  });
  await audit(req, "projects.task.restored", existing.id);
  await sendTask(req, res, existing.id, existing.project);
}

// ---------------------------------------------------------------- Dependencies

// POST /dependencies { predecessorId, type?, lagMinutes? } — this task is the
// successor. Same project, not itself, not archived, no loops (direct or
// through other tasks). Existing dates are never rescheduled.
export async function addDependency(req, res) {
  const existing = await load(req, res);
  if (!existing) return;
  const { predecessorId } = req.body;
  const type = req.body.type || "Finish to Start";
  if (!DEPENDENCY_TYPES.includes(type)) return invalid(res, `type must be one of ${DEPENDENCY_TYPES.join(", ")}.`);
  const lagMinutes = req.body.lagMinutes === undefined ? 0 : Number(req.body.lagMinutes);
  if (!Number.isInteger(lagMinutes) || Math.abs(lagMinutes) > 525600) return invalid(res, "lagMinutes must be whole minutes (up to a year either way).");
  if (!predecessorId || predecessorId === existing.id) return invalid(res, "A task can't depend on itself.");
  const pred = await prisma.task.findFirst({ where: { id: predecessorId, organizationId: req.organizationId, ...taskScopeWhere(req) } });
  if (!pred || pred.projectId !== existing.projectId) return invalid(res, "The predecessor must be a task you can see in the same project.");
  if (pred.archivedAt || existing.archivedAt) return invalid(res, "Archived tasks can't be used in new dependencies.");
  if (await prisma.taskDependency.findUnique({ where: { predecessorId_successorId: { predecessorId, successorId: existing.id } } })) return invalid(res, "That dependency already exists.");
  if (await dependencyWouldLoop(predecessorId, existing.id)) return invalid(res, "That dependency would create a loop.");
  await prisma.$transaction(async (tx) => {
    await tx.taskDependency.create({ data: { organizationId: req.organizationId, projectId: existing.projectId, predecessorId, successorId: existing.id, type, lagMinutes, createdByMembershipId: who(req) } });
    await tx.task.update({ where: { id: existing.id }, data: { version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.projectId, taskId: existing.id, eventType: "Dependency Added", actorMembershipId: who(req), toValue: pred.taskNumber || pred.id, snapshot: { type, lagMinutes } });
  });
  await audit(req, "projects.task.dependency_added", existing.id, { after: { predecessorId, type } });
  await sendTask(req, res, existing.id, existing.project, 201);
}

export async function removeDependency(req, res) {
  const existing = await load(req, res);
  if (!existing) return;
  const dep = await prisma.taskDependency.findFirst({ where: { id: req.params.dependencyId, successorId: existing.id } });
  if (!dep) return notFound(res, "Dependency");
  await prisma.$transaction(async (tx) => {
    await tx.taskDependency.delete({ where: { id: dep.id } });
    await tx.task.update({ where: { id: existing.id }, data: { version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.projectId, taskId: existing.id, eventType: "Dependency Removed", actorMembershipId: who(req), fromValue: dep.predecessorId });
  });
  await audit(req, "projects.task.dependency_removed", existing.id, { before: { predecessorId: dep.predecessorId } });
  await sendTask(req, res, existing.id, existing.project);
}

// ---------------------------------------------------------------- Checklist

// Checklist items never complete the task by themselves.
export async function addChecklistItem(req, res) {
  const existing = await load(req, res);
  if (!existing) return;
  const title = text(req.body.title, 300);
  if (!title) return invalid(res, "title is required.");
  const count = await prisma.taskChecklistItem.count({ where: { taskId: existing.id, archivedAt: null } });
  await prisma.$transaction([
    prisma.taskChecklistItem.create({ data: { organizationId: req.organizationId, taskId: existing.id, title, displayOrder: count } }),
    prisma.task.update({ where: { id: existing.id }, data: { version: { increment: 1 } } }),
  ]);
  await audit(req, "projects.task.checklist_added", existing.id);
  await sendTask(req, res, existing.id, existing.project, 201);
}

export async function updateChecklistItem(req, res) {
  const existing = await load(req, res);
  if (!existing) return;
  const item = await prisma.taskChecklistItem.findFirst({ where: { id: req.params.itemId, taskId: existing.id, archivedAt: null } });
  if (!item) return notFound(res, "Checklist item");
  if (req.body.version !== undefined && Number(req.body.version) !== item.version) return conflict(res, "checklist item");
  const data = {};
  if ("title" in req.body) { data.title = text(req.body.title, 300); if (!data.title) return invalid(res, "title can't be empty."); }
  if ("completed" in req.body) Object.assign(data, { completed: Boolean(req.body.completed), completedAt: req.body.completed ? new Date() : null, completedByMembershipId: req.body.completed ? who(req) : null });
  if (req.body.archived === true) data.archivedAt = new Date();
  // Optimistic concurrency: only updates if nobody changed it meanwhile.
  const changed = await prisma.taskChecklistItem.updateMany({ where: { id: item.id, version: item.version }, data: { ...data, version: { increment: 1 } } });
  if (!changed.count) return conflict(res, "checklist item");
  await audit(req, "projects.task.checklist_updated", existing.id);
  await sendTask(req, res, existing.id, existing.project);
}

export async function reorderChecklist(req, res) {
  const existing = await load(req, res);
  if (!existing) return;
  const items = await prisma.taskChecklistItem.findMany({ where: { taskId: existing.id, archivedAt: null } });
  const ids = req.body.itemIds;
  if (!Array.isArray(ids) || ids.length !== items.length || new Set(ids).size !== ids.length || ids.some((id) => !items.find((i) => i.id === id))) {
    return invalid(res, "itemIds must list every checklist item of this task exactly once.");
  }
  await prisma.$transaction([
    ...ids.map((id, i) => prisma.taskChecklistItem.update({ where: { id }, data: { displayOrder: i, version: { increment: 1 } } })),
    prisma.task.update({ where: { id: existing.id }, data: { version: { increment: 1 } } }),
  ]);
  await sendTask(req, res, existing.id, existing.project);
}

// ---------------------------------------------------------------- Comments

// GET/POST /projects/:projectId/comments[?taskId=]. Customer-visible
// comments need the project's managers; restricted ones are only shown to
// managers and auditors (filtered in the query).
export async function listComments(req, res) {
  const project = await loadProjectForTasks(req, req.params.projectId);
  if (!project) return notFound(res, "Project");
  const where = { projectId: project.id, archivedAt: null, visibility: { in: commentVisibilities(req, project) } };
  if (req.query.taskId) where.taskId = req.query.taskId;
  const comments = await prisma.taskComment.findMany({ where, orderBy: { createdAt: "asc" }, take: 500 });
  res.json({ comments: toApi(comments) });
}

export async function addComment(req, res) {
  const body = text(req.body.message ?? req.body.body, 10000);
  if (!body) return invalid(res, "A comment can't be empty.");
  let task = null;
  let project;
  if (req.params.taskId) {
    task = await load(req, res);
    if (!task) return;
    project = task.project;
  } else {
    project = await loadProjectForTasks(req, req.params.projectId);
    if (!project) return notFound(res, "Project");
    if (req.body.taskId) {
      task = await prisma.task.findFirst({ where: { id: req.body.taskId, projectId: project.id } });
      if (!task) return invalid(res, "taskId must be a task of this project.");
    }
  }
  const visibility = req.body.visibility || "Project Team";
  if (!["Project Team", "Restricted Management", "Customer Visible"].includes(visibility)) return invalid(res, "visibility must be Project Team, Restricted Management or Customer Visible.");
  if (visibility !== "Project Team" && !managesProject(req, project)) return forbidden(res, `Only the project's managers can post ${visibility.toLowerCase()} comments.`);
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.taskComment.create({ data: { organizationId: req.organizationId, projectId: project.id, taskId: task?.id || null, body, visibility, authorMembershipId: who(req) } });
    if (task) await tx.task.update({ where: { id: task.id }, data: { version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, taskId: task?.id || null, eventType: "Comment Added", actorMembershipId: who(req), snapshot: { commentId: c.id, visibility }, customerVisible: visibility === "Customer Visible" });
    return c;
  });
  await audit(req, "projects.comment.added", task?.id || project.id, { after: { visibility } });
  if (req.params.taskId) return sendTask(req, res, task.id, project);
  res.status(201).json({ comment: toApi(comment) });
}

async function loadOwnComment(req, res) {
  const project = await loadProjectForTasks(req, req.params.projectId);
  if (!project) { notFound(res, "Project"); return null; }
  const comment = await prisma.taskComment.findFirst({ where: { id: req.params.commentId, projectId: project.id, archivedAt: null, visibility: { in: commentVisibilities(req, project) } } });
  if (!comment) { notFound(res, "Comment"); return null; }
  if (comment.authorMembershipId !== who(req) && !managesProject(req, project)) { forbidden(res, "You can only change your own comments."); return null; }
  return comment;
}

export async function editComment(req, res) {
  const comment = await loadOwnComment(req, res);
  if (!comment) return;
  if (req.body.version !== undefined && Number(req.body.version) !== comment.version) return conflict(res, "comment");
  const body = text(req.body.body ?? req.body.message, 10000);
  if (!body) return invalid(res, "A comment can't be empty.");
  const updated = await prisma.taskComment.update({ where: { id: comment.id }, data: { body, editedAt: new Date(), version: { increment: 1 } } });
  await audit(req, "projects.comment.edited", comment.taskId || comment.projectId);
  res.json({ comment: toApi(updated) });
}

export async function archiveComment(req, res) {
  const comment = await loadOwnComment(req, res);
  if (!comment) return;
  const updated = await prisma.taskComment.update({ where: { id: comment.id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
  await audit(req, "projects.comment.archived", comment.taskId || comment.projectId);
  res.json({ comment: toApi(updated) });
}

// ---------------------------------------------------------------- Legacy time log

// POST /tasks/:taskId/time { hours, note } — the frontend's "log time".
// Records a Submitted entry for the caller (the full time workflow lives
// under /projects/time-entries).
export async function logTime(req, res) {
  const minutes = Math.round(Number(req.body.hours) * 60);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES_PER_ENTRY) return invalid(res, "hours must be more than 0 and at most 24.");
  const existing = await load(req, res);
  if (!existing) return;
  if (!hasGrant(req, "project_time", "create")) return forbidden(res, "You don't have permission to log time.");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.taskTimeEntry.create({
      data: {
        organizationId: req.organizationId, projectId: existing.projectId, taskId: existing.id, authorMembershipId: who(req), workDate: now, durationMinutes: minutes,
        hours: minutes / 60, note: text(req.body.note, 1000), status: "Submitted", submittedAt: now, source: "Manual",
      },
    });
    await refreshLoggedHours(tx, existing.id);
    await tx.task.update({ where: { id: existing.id }, data: { version: { increment: 1 } } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: existing.projectId, taskId: existing.id, eventType: "Time Submitted", actorMembershipId: who(req), toValue: minutes });
  });
  await audit(req, "projects.task.time_logged", existing.id, { after: { minutes } });
  await sendTask(req, res, existing.id, existing.project);
}

// ---------------------------------------------------------------- Bulk

// POST /projects/:projectId/tasks/bulk { action, taskIds, changes } — each
// task re-checked against scope and the action's own permission.
const BULK_ACTIONS = { assign: ["tasks", "assign"], transition: ["tasks", "transition"], archive: ["tasks", "archive"] };

export async function bulk(req, res) {
  const { action, taskIds } = req.body;
  if (!BULK_ACTIONS[action]) return invalid(res, `action must be one of ${Object.keys(BULK_ACTIONS).join(", ")}.`);
  if (!Array.isArray(taskIds) || !taskIds.length || taskIds.length > MAX_BULK) return invalid(res, `taskIds must list 1 to ${MAX_BULK} tasks.`);
  if (!hasGrant(req, ...BULK_ACTIONS[action])) return forbidden(res, `You don't have permission to ${action} tasks.`);
  const handler = { assign: (r, s) => assign(r, s), transition: (r, s) => transition(r, s), archive }[action];
  const results = [];
  for (const taskId of [...new Set(taskIds)]) {
    const captured = { statusCode: 200, body: null };
    const fakeRes = { status(code) { captured.statusCode = code; return this; }, json(body) { captured.body = body; return this; } };
    await handler(Object.assign(Object.create(req), { params: { ...req.params, taskId }, body: { ...req.body.changes } }), fakeRes);
    results.push({ taskId, ok: captured.statusCode < 300, ...(captured.statusCode >= 300 && { error: captured.body?.message }) });
  }
  await audit(req, `projects.task.bulk_${action}`, null, { after: { count: results.length, succeeded: results.filter((r) => r.ok).length } });
  res.json({ results });
}

// Route entries — Express passes `next` as a third argument.
export const transitionRoute = (req, res) => transition(req, res);
export const assignRoute = (req, res) => assign(req, res);
