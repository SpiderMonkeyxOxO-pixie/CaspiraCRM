// Typed adapter for Backend Phase 5's Projects surface (/api/v1/projects, /api/v1/tasks).
// Same conventions as backendCrmClient.js: httpOnly session cookies,
// double-submit CSRF, one-shot refresh-on-401. Gated by its own flag,
// VITE_BACKEND_PROJECTS_MODE.
import axios from "axios";

const BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1";

export const BACKEND_PROJECTS_MODE_ENABLED = import.meta.env.VITE_BACKEND_PROJECTS_MODE === "true";

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const client = axios.create({ baseURL: BASE_URL, withCredentials: true, headers: { "Content-Type": "application/json" } });

client.interceptors.request.use((config) => {
  if (!["get", "head", "options"].includes((config.method || "get").toLowerCase())) {
    const csrfToken = readCookie("csrm_csrf");
    if (csrfToken) config.headers["X-CSRF-Token"] = csrfToken;
  }
  return config;
});

let refreshInFlight = null;
client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original?._retried && !original?.url?.includes("/auth/refresh") && !original?.url?.includes("/auth/login")) {
      original._retried = true;
      try {
        refreshInFlight ||= client.post("/auth/refresh");
        await refreshInFlight;
        refreshInFlight = null;
        return client(original);
      } catch (refreshError) {
        refreshInFlight = null;
        throw refreshError;
      }
    }
    throw error;
  }
);

const withOrg = (organizationId, body = {}) => ({ ...body, organizationId });
// One key per user action: a retried or double-clicked request is answered
// from the server's record instead of creating a duplicate.
const once = () => ({ headers: { "Idempotency-Key": globalThis.crypto?.randomUUID?.() || `projects-${Date.now()}-${Math.random().toString(36).slice(2)}` } });
const get = (path, organizationId, params) => client.get(path, { params: withOrg(organizationId, params) }).then((r) => r.data);
const post = (path, organizationId, body, config) => client.post(path, withOrg(organizationId, body), config).then((r) => r.data);

export const listProjects = (organizationId, params) => client.get("/projects", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getProject = (organizationId, projectId) => client.get(`/projects/${projectId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createProject = (organizationId, payload) => client.post("/projects", withOrg(organizationId, payload), once()).then((r) => r.data);
export const updateProject = (organizationId, projectId, changes) => client.patch(`/projects/${projectId}`, withOrg(organizationId, changes)).then((r) => r.data);
export const addMilestone = (organizationId, projectId, milestone) => client.post(`/projects/${projectId}/milestones`, withOrg(organizationId, milestone)).then((r) => r.data);
export const toggleMilestone = (organizationId, projectId, milestoneId) =>
  client.post(`/projects/${projectId}/milestones/${milestoneId}/toggle`, withOrg(organizationId)).then((r) => r.data);

export const listTasks = (organizationId, params) => client.get("/tasks", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const createTask = (organizationId, payload) => client.post("/tasks", withOrg(organizationId, payload), once()).then((r) => r.data);
export const updateTask = (organizationId, taskId, changes) => client.patch(`/tasks/${taskId}`, withOrg(organizationId, changes)).then((r) => r.data);
export const addTaskComment = (organizationId, taskId, message) => client.post(`/tasks/${taskId}/comments`, withOrg(organizationId, { message })).then((r) => r.data);
export const logTaskTime = (organizationId, taskId, hours, note) => client.post(`/tasks/${taskId}/time`, withOrg(organizationId, { hours, note })).then((r) => r.data);

// ---- Backend Phase 5 (full spec) adapters -------------------------------
const P = (projectId, path = "") => `/projects/${projectId}${path}`;
export const transitionProject = (organizationId, projectId, status, reason) => post(P(projectId, "/transition"), organizationId, { status, reason });
export const projectHistory = (organizationId, projectId) => get(P(projectId, "/history"), organizationId);
export const listProjectMembers = (organizationId, projectId) => get(P(projectId, "/members"), organizationId);
export const addProjectMember = (organizationId, projectId, member) => post(P(projectId, "/members"), organizationId, member);
export const listPortfolios = (organizationId) => get("/projects/portfolios", organizationId);
export const listTemplates = (organizationId) => get("/projects/templates", organizationId);
export const previewFromTemplate = (organizationId, payload) => post("/projects/from-template", organizationId, { ...payload, preview: true });
export const createFromTemplate = (organizationId, payload) => post("/projects/from-template", organizationId, payload, once());
export const listPhases = (organizationId, projectId) => get(P(projectId, "/phases"), organizationId);
export const listBoards = (organizationId, projectId) => get(P(projectId, "/boards"), organizationId);
export const moveTask = (organizationId, projectId, taskId, columnId) => post(P(projectId, `/tasks/${taskId}/transition`), organizationId, { columnId });
export const addTaskDependency = (organizationId, projectId, taskId, predecessorId, type) => post(P(projectId, `/tasks/${taskId}/dependencies`), organizationId, { predecessorId, type });
export const addChecklistItem = (organizationId, projectId, taskId, title) => post(P(projectId, `/tasks/${taskId}/checklist`), organizationId, { title });
export const listProjectComments = (organizationId, projectId, taskId) => get(P(projectId, "/comments"), organizationId, taskId ? { taskId } : {});
export const listTimeEntries = (organizationId, params) => get("/projects/time-entries", organizationId, params);
export const createTimeEntry = (organizationId, entry) => post("/projects/time-entries", organizationId, entry);
export const submitTimeEntry = (organizationId, entryId) => post(`/projects/time-entries/${entryId}/submit`, organizationId, {}, once());
export const approveTimeEntry = (organizationId, entryId) => post(`/projects/time-entries/${entryId}/approve`, organizationId);
export const rejectTimeEntry = (organizationId, entryId, reason) => post(`/projects/time-entries/${entryId}/reject`, organizationId, { reason });
export const activeTimer = (organizationId) => get("/projects/timers/active", organizationId);
export const startTimer = (organizationId, projectId, taskId) => post("/projects/timers/start", organizationId, { projectId, taskId }, once());
export const stopTimer = (organizationId, timerId) => post(`/projects/timers/${timerId}/stop`, organizationId, {}, once());
export const listDeliverables = (organizationId, projectId) => get(P(projectId, "/deliverables"), organizationId);
export const listRisks = (organizationId, projectId) => get(P(projectId, "/risks"), organizationId);
export const listIssues = (organizationId, projectId) => get(P(projectId, "/issues"), organizationId);
export const listChangeRequests = (organizationId, projectId) => get(P(projectId, "/change-requests"), organizationId);
export const listBaselines = (organizationId, projectId) => get(P(projectId, "/baselines"), organizationId);
export const projectSummary = (organizationId) => get("/projects/summary", organizationId);
export const projectWorkload = (organizationId) => get("/projects/workload", organizationId);
export const projectCalendar = (organizationId, from, to) => get("/projects/calendar", organizationId, { from, to });

// Customer Portal (customer logins only)
export const portalListProjects = () => client.get("/portal/projects").then((r) => r.data);
export const portalGetProject = (projectId) => client.get(`/portal/projects/${projectId}`).then((r) => r.data);
export const portalDeliverables = (projectId) => client.get(`/portal/projects/${projectId}/deliverables`).then((r) => r.data);
export const portalAcceptDeliverable = (projectId, deliverableId, comment) => client.post(`/portal/projects/${projectId}/deliverables/${deliverableId}/accept`, { comment }, once()).then((r) => r.data);
export const portalRequestChanges = (projectId, deliverableId, comment) => client.post(`/portal/projects/${projectId}/deliverables/${deliverableId}/request-changes`, { comment }, once()).then((r) => r.data);
