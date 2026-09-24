// Typed adapter for Backend Phase 8's Integration surface (/api/v1/integrations/*).
// Same conventions as backendFinanceClient.js: httpOnly session cookies,
// double-submit CSRF, one-shot refresh-on-401. Gated by its own flag,
// VITE_BACKEND_INTEGRATIONS_MODE. Provider tokens and secrets never reach
// the browser — the backend returns labels and statuses only.
import axios from "axios";

const BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1";

export const BACKEND_INTEGRATIONS_MODE_ENABLED = import.meta.env.VITE_BACKEND_INTEGRATIONS_MODE === "true";

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
const get = (path, organizationId, params) => client.get(path, { params: withOrg(organizationId, params) }).then((r) => r.data);
const post = (path, organizationId, body) => client.post(path, withOrg(organizationId, body)).then((r) => r.data);
const I = "/integrations";
const enc = encodeURIComponent;

export const listProviders = (organizationId, params) => get(`${I}/providers`, organizationId, params);
export const getProvider = (organizationId, key) => get(`${I}/providers/${enc(key)}`, organizationId);
export const listConnections = (organizationId, params) => get(`${I}/connections`, organizationId, params);
export const getConnection = (organizationId, id) => get(`${I}/connections/${enc(id)}`, organizationId);
// OAuth: the backend creates the connection and returns the provider's
// authorization URL; the browser goes there and comes back via the backend.
export const startOAuth = (organizationId, providerKey, body) => post(`${I}/oauth/${enc(providerKey)}/start`, organizationId, body);
export const reauthorize = (organizationId, id, capabilityKeys) => post(`${I}/connections/${enc(id)}/reauthorize`, organizationId, { capabilityKeys });
export const testConnection = (organizationId, id) => post(`${I}/connections/${enc(id)}/test`, organizationId);
export const pauseConnection = (organizationId, id) => post(`${I}/connections/${enc(id)}/pause`, organizationId);
export const resumeConnection = (organizationId, id) => post(`${I}/connections/${enc(id)}/resume`, organizationId);
export const disconnectConnection = (organizationId, id, reason) => post(`${I}/connections/${enc(id)}/disconnect`, organizationId, { reason });
export const getScopes = (organizationId, id) => get(`${I}/connections/${enc(id)}/scopes`, organizationId);

export const listSyncConfigurations = (organizationId, id) => get(`${I}/connections/${enc(id)}/sync-configurations`, organizationId);
export const saveSyncConfiguration = (organizationId, id, body) => post(`${I}/connections/${enc(id)}/sync-configurations`, organizationId, body);
export const createSyncPreview = (organizationId, id, syncConfigurationId) => post(`${I}/connections/${enc(id)}/sync-preview`, organizationId, { syncConfigurationId });
export const confirmSyncPreview = (organizationId, id, previewRunId) => post(`${I}/connections/${enc(id)}/sync`, organizationId, { previewRunId, confirm: true });
export const runIncrementalSync = (organizationId, id, syncConfigurationId) => post(`${I}/connections/${enc(id)}/sync`, organizationId, { syncConfigurationId });
export const listSyncRuns = (organizationId, params) => get(`${I}/sync-runs`, organizationId, params);
export const cancelSyncRun = (organizationId, runId) => post(`${I}/sync-runs/${enc(runId)}/cancel`, organizationId);

export const listConflicts = (organizationId, params) => get(`${I}/conflicts`, organizationId, params);
export const resolveConflict = (organizationId, conflictId, body) => post(`${I}/conflicts/${enc(conflictId)}/resolve`, organizationId, body);

export const listAudit = (organizationId, params) => get(`${I}/audit`, organizationId, params);
export const listUsage = (organizationId) => get(`${I}/usage`, organizationId);
export const listWebhooks = (organizationId) => get(`${I}/webhooks`, organizationId);
export const listOutboundWebhooks = (organizationId) => get(`${I}/outbound-webhooks`, organizationId);
