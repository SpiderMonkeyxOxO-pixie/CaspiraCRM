// Backend Phase 5 — task rules shared by the task endpoints: loading in
// scope, what the caller may see (comments, time), assignee validation,
// dependency cycles and board moves.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { broadestScope } from "../crm/scopeService.js";
import { taskScopeWhere, managesProject } from "./projectAccess.js";
import { reaches } from "./projectRulesService.js";

// Comments: everyone on the project sees Project Team and Customer Visible
// comments; Restricted Management only managers and auditors. Filtered in
// the query, never in the UI.
export function commentVisibilities(req, project) {
  const v = ["Project Team", "Customer Visible"];
  if (managesProject(req, project) || hasGrant(req, "projects", "view_audit_history")) v.push("Restricted Management");
  return v;
}

// Time: your own entries always; the whole team's with project_time:view_team.
export function timeScope(req) {
  if (req.isSystemOwnerOverride || hasGrant(req, "project_time", "view_team")) return {};
  return { authorMembershipId: req.membership?.id || "__none__" };
}

export function taskInclude(req, project) {
  return {
    column: { select: { id: true, name: true, category: true, isCompletion: true } },
    assignees: { where: { removedAt: null }, orderBy: { assignedAt: "asc" } },
    checklist: { where: { archivedAt: null }, orderBy: { displayOrder: "asc" } },
    labels: { include: { label: { select: { id: true, name: true, colorToken: true } } } },
    predecessorLinks: { include: { predecessor: { select: { id: true, title: true, taskNumber: true, statusCategory: true } } } },
    subtasks: { where: { archivedAt: null }, select: { id: true, title: true, taskNumber: true, status: true, statusCategory: true } },
    commentEntries: { where: { archivedAt: null, visibility: { in: commentVisibilities(req, project) } }, orderBy: { createdAt: "asc" } },
    timeLog: { where: { archivedAt: null, ...timeScope(req) }, orderBy: { createdAt: "asc" } },
  };
}

export function serializeTask(task) {
  const out = toApi(task);
  out.labels = (task.labels || []).map((l) => toApi(l.label));
  out.dependencies = (task.predecessorLinks || []).map((d) => ({ _id: d.id, type: d.type, lagMinutes: d.lagMinutes, predecessor: toApi(d.predecessor) }));
  delete out.predecessorLinks;
  return out;
}

export async function loadProjectForTasks(req, projectId) {
  const { projectScopeWhere } = await import("./projectAccess.js");
  return prisma.project.findFirst({ where: { id: projectId, organizationId: req.organizationId, ...projectScopeWhere(req) }, include: { members: true } });
}

export async function loadTask(req, taskId, projectId = null) {
  const task = await prisma.task.findFirst({ where: { id: taskId, organizationId: req.organizationId, ...(projectId && { projectId }), ...taskScopeWhere(req) }, include: { project: { include: { members: true } } } });
  return task;
}

// Assignees must be ACTIVE members of the organization AND active members
// of the project. Returns an error message or null.
export async function invalidAssignees(organizationId, project, membershipIds) {
  for (const id of membershipIds) {
    const orgMember = await prisma.organizationMembership.findFirst({ where: { id, organizationId, status: "Active" } });
    if (!orgMember) return "Every assignee must be an active member of this organization.";
    const onProject = project.ownerMembershipId === id || project.members.some((m) => m.membershipId === id && m.active);
    if (!onProject) return "Every assignee must be an active member of the project — add them to the project first.";
  }
  return null;
}

// Would linking predecessor → successor close a loop? Walks from the
// successor forward through existing dependencies.
export async function dependencyWouldLoop(predecessorId, successorId) {
  return reaches(successorId, predecessorId, async (id) => (await prisma.taskDependency.findMany({ where: { predecessorId: id }, select: { successorId: true } })).map((d) => d.successorId));
}

// Parent loops: a task can't become its own ancestor.
export async function parentWouldLoop(taskId, parentId) {
  let current = parentId;
  const seen = new Set();
  while (current) {
    if (current === taskId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = (await prisma.task.findUnique({ where: { id: current }, select: { parentTaskId: true } }))?.parentTaskId || null;
  }
  return false;
}

export function scopeIsOrganizationWide(req, moduleId) {
  if (req.isSystemOwnerOverride) return true;
  const scope = broadestScope(req.membership, moduleId);
  return scope === "Organization" || scope === "System-wide";
}

// Keeps Task.loggedHours in step with the time entries that count
// (Submitted or Approved, not archived).
export async function refreshLoggedHours(tx, taskId) {
  if (!taskId) return;
  const agg = await tx.taskTimeEntry.aggregate({ where: { taskId, archivedAt: null, status: { in: ["Submitted", "Approved"] } }, _sum: { durationMinutes: true } });
  await tx.task.update({ where: { id: taskId }, data: { loggedHours: Math.round(((agg._sum.durationMinutes || 0) / 60) * 100) / 100 } });
}
