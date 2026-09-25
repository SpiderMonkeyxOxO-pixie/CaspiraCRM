// Typed adapter for Backend Phase 13's platform operations surface
// (/api/v1/admin/{platform,security,backups,restores,restore-drills,
// disaster-recovery,releases,deployments,system,retention}). Operator-only
// and environment-wide, so no organizationId. Same conventions as the other
// backend clients: httpOnly session cookies, double-submit CSRF, one-shot
// refresh-on-401. Sensitive actions answer 401 REAUTHENTICATION_REQUIRED;
// the page registers a password prompt (setReauthPrompt) and the request is
// retried once after POST /auth/reauthenticate. Passwords are never stored.
import axios from "axios";
import { BACKEND_AUTH_MODE_ENABLED } from "./backendAuthClient";

const BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1";

export const PLATFORM_MODE_ENABLED = BACKEND_AUTH_MODE_ENABLED;

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export const client = axios.create({ baseURL: BASE_URL, withCredentials: true, headers: { "Content-Type": "application/json" } });

client.interceptors.request.use((config) => {
  if (!["get", "head", "options"].includes((config.method || "get").toLowerCase())) {
    const csrfToken = readCookie("csrm_csrf");
    if (csrfToken) config.headers["X-CSRF-Token"] = csrfToken;
  }
  return config;
});

let reauthPrompt = null;
// fn: () => Promise<string|null> — resolves the password, or null if cancelled.
export function setReauthPrompt(fn) { reauthPrompt = fn; }

let refreshInFlight = null;
client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const code = error.response?.data?.code;
    if (status === 401 && code === "REAUTHENTICATION_REQUIRED" && reauthPrompt && !original?._reauthed) {
      const password = await reauthPrompt();
      if (!password) throw error;
      await client.post("/auth/reauthenticate", { password });
      original._reauthed = true;
      return client(original);
    }
    if (status === 401 && code !== "REAUTHENTICATION_REQUIRED" && !original?._retried && !original?.url?.includes("/auth/")) {
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

const get = (path, params) => client.get(`/admin${path}`, { params }).then((r) => r.data);
const post = (path, body = {}) => client.post(`/admin${path}`, body).then((r) => r.data);
const put = (path, body = {}) => client.put(`/admin${path}`, body).then((r) => r.data);
const patch = (path, body = {}) => client.patch(`/admin${path}`, body).then((r) => r.data);
const del = (path) => client.delete(`/admin${path}`).then((r) => r.data);
const enc = encodeURIComponent;

// Access
export const platformAccess = () => get("/platform/access");

// Security
export const securityOverview = () => get("/security/overview");
export const listFindings = (params) => get("/security/findings", params);
export const setDisposition = (id, body) => post(`/security/findings/${enc(id)}/disposition`, body);
export const requestException = (id, body) => post(`/security/findings/${enc(id)}/exceptions`, body);
export const decideException = (id, body) => post(`/security/exceptions/${enc(id)}/decision`, body);
export const listBaseline = () => get("/security/baseline");
export const recordBaseline = (body) => put("/security/baseline", body);
export const listSecrets = () => get("/security/secrets");
export const advanceRotation = (id, body) => post(`/security/secrets/${enc(id)}/rotate`, body);
export const emergencyRevoke = (id, reason) => post(`/security/secrets/${enc(id)}/revoke`, { reason });
export const listPlatformRoles = () => get("/security/platform-roles");
export const grantPlatformRole = (body) => post("/security/platform-roles/grant", body);
export const revokePlatformRole = (body) => post("/security/platform-roles/revoke", body);
export const listTokens = () => get("/security/automation-tokens");
export const createToken = (body) => post("/security/automation-tokens", body);
export const revokeToken = (id) => del(`/security/automation-tokens/${enc(id)}`);

// Backups and restores
export const backupStatus = () => get("/backups/status");
export const listBackupPolicies = () => get("/backups/policies");
export const listBackupJobs = () => get("/backups/jobs");
export const runBackup = (backupType) => post("/backups/run", { backupType });
export const listArtifacts = () => get("/backups/artifacts");
export const verifyArtifact = (id) => post(`/backups/artifacts/${enc(id)}/verify`);
export const listRestores = () => get("/restores");
export const planRestore = (body) => post("/restores/plan", body);
export const approveRestore = (id, body = {}) => post(`/restores/${enc(id)}/approve`, body);
export const rejectRestore = (id, note) => post(`/restores/${enc(id)}/reject`, { note });
export const executeRestore = (id) => post(`/restores/${enc(id)}/execute`);
export const cancelRestore = (id, reason) => post(`/restores/${enc(id)}/cancel`, { reason });
export const listRestoreDrills = () => get("/restore-drills");
export const startRestoreDrill = (body = {}) => post("/restore-drills", { ...body, mode: "start" });

// Disaster recovery
export const listDrPlans = () => get("/disaster-recovery/plans");
export const transitionDrPlan = (key, body) => post(`/disaster-recovery/plans/${enc(key)}/transition`, body);
export const listDrDrills = () => get("/disaster-recovery/drills");
export const scheduleDrDrill = (body) => post("/disaster-recovery/drills", body);
export const transitionDrDrill = (id, body) => post(`/disaster-recovery/drills/${enc(id)}/transition`, body);
export const listIncidents = () => get("/disaster-recovery/incidents");
export const declareIncident = (body) => post("/disaster-recovery/incidents", body);
export const transitionIncident = (id, body) => post(`/disaster-recovery/incidents/${enc(id)}/transition`, body);

// Releases and deployments
export const listReleases = () => get("/releases");
export const approveRelease = (id, body = {}) => post(`/releases/${enc(id)}/approve`, body);
export const listDeployments = () => get("/deployments");
export const getDeployment = (id) => get(`/deployments/${enc(id)}`);
export const planDeployment = (body) => post("/deployments/plan", body);
export const approveDeployment = (id, body = {}) => post(`/deployments/${enc(id)}/approve`, body);
export const executeDeployment = (id) => post(`/deployments/${enc(id)}/execute`);
export const requestRollback = (id, body) => post(`/deployments/${enc(id)}/rollback`, body);
export const approveRollback = (id, body = {}) => post(`/deployments/rollbacks/${enc(id)}/approve`, body);
export const cancelDeployment = (id, reason) => post(`/deployments/${enc(id)}/cancel`, { reason });

// System
export const systemHealth = () => get("/system/health");
export const systemCapacity = () => get("/system/capacity");
export const listAlerts = () => get("/system/alerts");
export const updateAlertPolicy = (key, body) => patch(`/system/alerts/policies/${enc(key)}`, body);
export const acknowledgeAlert = (id) => post(`/system/alerts/${enc(id)}/acknowledge`);
export const evaluateAlerts = () => post("/system/alerts/evaluate");
export const listJobRuns = () => get("/system/jobs");
export const listRetention = () => get("/retention");
export const setRetention = (body) => put("/retention", body);
export const runRetention = (body) => post("/retention/run", body);

// Readable error text from an API failure (never includes internals — the
// API's error envelope is already safe).
export const errorText = (e) => e?.response?.data?.message || e?.message || "Request failed.";
