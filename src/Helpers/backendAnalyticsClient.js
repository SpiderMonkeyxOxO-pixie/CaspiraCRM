// Typed adapter for Backend Phase 12's Analytics & Reports surface
// (/api/v1/analytics/*, /api/v1/reports/*). Same conventions as the other
// backend clients: httpOnly session cookies, double-submit CSRF, one-shot
// refresh-on-401, organizationId on every call. Gated by
// VITE_BACKEND_ANALYTICS_MODE. Queries name governed metrics only — the
// browser never sends SQL, tables or columns.
import axios from "axios";
import { getActiveOrganizationId } from "./backendSession";

const BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1";

export const BACKEND_ANALYTICS_MODE_ENABLED = import.meta.env.VITE_BACKEND_ANALYTICS_MODE === "true";

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

const org = () => {
  const id = getActiveOrganizationId();
  if (!id) throw new Error("No active organization — log out and back in.");
  return id;
};
const get = (path, params) => client.get(path, { params: { ...params, organizationId: org() } }).then((r) => r.data);
const post = (path, body = {}) => client.post(path, { ...body, organizationId: org() }).then((r) => r.data);
const patch = (path, body = {}) => client.patch(path, { ...body, organizationId: org() }).then((r) => r.data);
const del = (path) => client.delete(path, { params: { organizationId: org() } }).then((r) => r.data);
const enc = encodeURIComponent;

export function analyticsErrorMessage(err, fallback = "Something went wrong.") {
  return err?.response?.data?.message || err?.message || fallback;
}

// Access, dashboards, queries
export const analyticsAccess = () => get("/analytics/access");
export const dashboard = (name, params) => get(`/analytics/${enc(name)}`, params);
export const freshness = () => get("/analytics/freshness");
export const query = (body) => post("/analytics/query", body);
export const drilldown = (body) => post("/analytics/drilldown", body);
export const explainMetric = (body) => post("/analytics/explain", body);

// Metric registry
export const listMetrics = () => get("/analytics/metrics");
export const getMetric = (key) => get(`/analytics/metrics/${enc(key)}`);
export const draftMetric = (key, body) => post(`/analytics/metrics/${enc(key)}/versions`, body);
export const publishMetric = (key, version) => post(`/analytics/metrics/${enc(key)}/versions/${enc(version)}/publish`);
export const retireMetric = (key) => post(`/analytics/metrics/${enc(key)}/retire`);

// Warehouse administration
export const warehouseStatus = () => get("/analytics/warehouse");
export const startWarehouseJob = (body) => post("/analytics/warehouse/jobs", body);
export const retryWarehouseJob = (id) => post(`/analytics/warehouse/jobs/${enc(id)}/retry`);
export const refreshViews = () => post("/analytics/warehouse/refresh-views");

// Reports
export const listReports = (params) => get("/reports", params);
export const getReport = (id) => get(`/reports/${enc(id)}`);
export const createReport = (body) => post("/reports", body);
export const updateReport = (id, body) => patch(`/reports/${enc(id)}`, body);
export const archiveReport = (id, archived = true) => post(`/reports/${enc(id)}/archive`, { archived });
export const cloneReport = (id, body) => post(`/reports/${enc(id)}/clone`, body);
export const shareReport = (id, body) => post(`/reports/${enc(id)}/share`, body);
export const runReport = (id, params) => get(`/reports/${enc(id)}/run`, params);

// Schedules
export const listSchedules = () => get("/reports/schedules");
export const getSchedule = (id) => get(`/reports/schedules/${enc(id)}`);
export const createSchedule = (body) => post("/reports/schedules", body);
export const updateSchedule = (id, body) => patch(`/reports/schedules/${enc(id)}`, body);
export const deleteSchedule = (id) => del(`/reports/schedules/${enc(id)}`);
export const runScheduleNow = (id) => post(`/reports/schedules/${enc(id)}/run-now`);

// Exports
export const listExports = (params) => get("/reports/exports", params);
export const getExport = (id) => get(`/reports/exports/${enc(id)}`);
export const requestExport = (body) => post("/reports/exports", body);
export const approveExport = (id, reason) => post(`/reports/exports/${enc(id)}/approve`, { reason });
export const rejectExport = (id, reason) => post(`/reports/exports/${enc(id)}/reject`, { reason });
export const revokeExport = (id, reason) => post(`/reports/exports/${enc(id)}/revoke`, { reason });

// Downloads go through the authenticated API (never a public link).
export async function downloadExport(id) {
  const res = await client.get(`/reports/exports/${enc(id)}/download`, { params: { organizationId: org() }, responseType: "blob" });
  const match = /filename="([^"]+)"/.exec(res.headers?.["content-disposition"] || "");
  const filename = match ? match[1] : `export-${id}`;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
