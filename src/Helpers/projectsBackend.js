// Backend-mode data source for the Projects pages (VITE_BACKEND_PROJECTS_MODE=true).
// The project/task UI was built against the mock layer's shape — owner and
// assignee as names, comments and time entries as arrays on the task — so
// this maps the backend's membership ids and related records onto it.
import * as api from "./backendProjectsClient";
import { orgId, ownersMap, listAll } from "./crmBackendCommon";

export const BACKEND_ENABLED = api.BACKEND_PROJECTS_MODE_ENABLED;

const nameOf = (ownersById, membershipId) => (membershipId ? ownersById.get(membershipId)?.name || "Member" : null);

export function toUiProject(project, ownersById = new Map()) {
  if (!project) return project;
  return {
    ...project,
    companyName: project.company?.name || "",
    ownerId: project.ownerMembershipId || null,
    owner: nameOf(ownersById, project.ownerMembershipId),
    milestones: project.milestones || [],
  };
}

export function toUiTask(task, ownersById = new Map()) {
  if (!task) return task;
  return {
    ...task,
    assigneeId: task.assigneeMembershipId || null,
    assignee: nameOf(ownersById, task.assigneeMembershipId),
    dependsOn: task.dependsOnId || null,
    comments: (task.commentEntries || []).map((c) => ({ _id: c._id, message: c.body, author: nameOf(ownersById, c.authorMembershipId) || "Member", at: c.createdAt })),
    timeEntries: (task.timeLog || []).map((e) => ({ _id: e._id, hours: e.hours, note: e.note || "", author: nameOf(ownersById, e.authorMembershipId) || "Member", at: e.createdAt })),
  };
}

const PROJECT_FIELDS = ["name", "companyId", "dealId", "status", "startDate", "dueDate", "description", "customerVisible"];
const TASK_FIELDS = ["projectId", "title", "description", "priority", "status", "dueDate", "estimateHours", "recurring"];

// Sends only real fields — never display names (companyName, owner,
// assignee) or server-kept values (loggedHours, comments, completedAt).
function pick(payload, fields) {
  return Object.fromEntries(fields.filter((f) => f in payload).map((f) => [f, payload[f] === "" ? null : payload[f]]));
}

export function toApiProject(payload = {}) {
  const out = pick(payload, PROJECT_FIELDS);
  if ("ownerId" in payload) out.ownerMembershipId = payload.ownerId || null;
  return out;
}

export function toApiTask(payload = {}) {
  const out = pick(payload, TASK_FIELDS);
  if ("assigneeId" in payload) out.assigneeMembershipId = payload.assigneeId || null;
  if ("dependsOn" in payload) out.dependsOnId = payload.dependsOn || null;
  return out;
}

async function mappedProject(promise) {
  const [{ project }, owners] = await Promise.all([promise, ownersMap()]);
  return toUiProject(project, owners);
}

async function mappedTask(promise) {
  const [{ task }, owners] = await Promise.all([promise, ownersMap()]);
  return toUiTask(task, owners);
}

export async function listProjects() {
  const organizationId = orgId();
  const [projects, owners] = await Promise.all([
    listAll(async (page, pageSize) => {
      const { projects: items, total } = await api.listProjects(organizationId, { page, pageSize });
      return { items: items || [], total };
    }),
    ownersMap(),
  ]);
  return projects.map((p) => toUiProject(p, owners));
}

export async function listTasks() {
  const organizationId = orgId();
  const [tasks, owners] = await Promise.all([
    listAll(async (page, pageSize) => {
      const { tasks: items, total } = await api.listTasks(organizationId, { page, pageSize });
      return { items: items || [], total };
    }),
    ownersMap(),
  ]);
  return tasks.map((t) => toUiTask(t, owners));
}

export const getProject = (id) => mappedProject(api.getProject(orgId(), id));
export const createProject = (payload) => mappedProject(api.createProject(orgId(), toApiProject(payload)));
export const updateProject = (id, changes) => mappedProject(api.updateProject(orgId(), id, toApiProject(changes)));
export const addMilestone = (id, name, dueDate) => mappedProject(api.addMilestone(orgId(), id, { name, dueDate: dueDate || null }));
export const toggleMilestone = (id, milestoneId) => mappedProject(api.toggleMilestone(orgId(), id, milestoneId));

export const createTask = (payload) => mappedTask(api.createTask(orgId(), toApiTask(payload)));
export const updateTask = (id, changes) => mappedTask(api.updateTask(orgId(), id, toApiTask(changes)));
export const addTaskComment = (id, message) => mappedTask(api.addTaskComment(orgId(), id, message));
export const logTaskTime = (id, hours, note) => mappedTask(api.logTaskTime(orgId(), id, hours, note));
