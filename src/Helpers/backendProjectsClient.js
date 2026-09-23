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

export const listProjects = (organizationId, params) => client.get("/projects", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getProject = (organizationId, projectId) => client.get(`/projects/${projectId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createProject = (organizationId, payload) => client.post("/projects", withOrg(organizationId, payload)).then((r) => r.data);
export const updateProject = (organizationId, projectId, changes) => client.patch(`/projects/${projectId}`, withOrg(organizationId, changes)).then((r) => r.data);
export const addMilestone = (organizationId, projectId, milestone) => client.post(`/projects/${projectId}/milestones`, withOrg(organizationId, milestone)).then((r) => r.data);
export const toggleMilestone = (organizationId, projectId, milestoneId) =>
  client.post(`/projects/${projectId}/milestones/${milestoneId}/toggle`, withOrg(organizationId)).then((r) => r.data);

export const listTasks = (organizationId, params) => client.get("/tasks", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const createTask = (organizationId, payload) => client.post("/tasks", withOrg(organizationId, payload)).then((r) => r.data);
export const updateTask = (organizationId, taskId, changes) => client.patch(`/tasks/${taskId}`, withOrg(organizationId, changes)).then((r) => r.data);
export const addTaskComment = (organizationId, taskId, message) => client.post(`/tasks/${taskId}/comments`, withOrg(organizationId, { message })).then((r) => r.data);
export const logTaskTime = (organizationId, taskId, hours, note) => client.post(`/tasks/${taskId}/time`, withOrg(organizationId, { hours, note })).then((r) => r.data);
