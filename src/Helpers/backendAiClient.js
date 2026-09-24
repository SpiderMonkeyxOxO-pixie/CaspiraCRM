// Typed adapter for Backend Phase 9's AI surface (/api/v1/ai/*). Same
// conventions as the other backend clients: httpOnly session cookies,
// double-submit CSRF, one-shot refresh-on-401, organizationId on every call.
// Gated by VITE_BACKEND_AI_MODE. API keys are sent once when connecting or
// rotating and are never stored in the browser or read back.
import axios from "axios";
import { getActiveOrganizationId } from "./backendSession";

const BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1";

export const BACKEND_AI_MODE_ENABLED = import.meta.env.VITE_BACKEND_AI_MODE === "true";

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
const once = () => ({ "Idempotency-Key": globalThis.crypto?.randomUUID?.() || `ai-${Date.now()}-${Math.random().toString(36).slice(2)}` });
const get = (path, params) => client.get(path, { params: { ...params, organizationId: org() } }).then((r) => r.data);
const post = (path, body = {}, headers) => client.post(path, { ...body, organizationId: org() }, headers ? { headers } : undefined).then((r) => r.data);
const patch = (path, body = {}) => client.patch(path, { ...body, organizationId: org() }).then((r) => r.data);
const put = (path, body = {}) => client.put(path, { ...body, organizationId: org() }).then((r) => r.data);
const del = (path, body = {}) => client.delete(path, { params: { organizationId: org() }, data: { ...body, organizationId: org() } }).then((r) => r.data);
const enc = encodeURIComponent;

// A readable message from an API error.
export const aiErrorMessage = (e, fallback = "The request failed.") => e?.response?.data?.message || e?.message || fallback;

// Providers and connections
export const listProviders = () => get("/ai/providers");
export const getProvider = (key) => get(`/ai/providers/${enc(key)}`);
export const listConnections = () => get("/ai/connections");
export const getConnection = (id) => get(`/ai/connections/${enc(id)}`);
export const createConnection = (providerKey, apiKey, name) => post("/ai/connections", { providerKey, apiKey: apiKey || undefined, name });
export const verifyConnection = (id) => post(`/ai/connections/${enc(id)}/verify`);
export const rotateKey = (id, apiKey) => post(`/ai/connections/${enc(id)}/rotate-key`, { apiKey });
export const disableConnection = (id, reason) => post(`/ai/connections/${enc(id)}/disable`, { reason });
export const enableConnection = (id) => post(`/ai/connections/${enc(id)}/enable`);
export const removeConnection = (id, reason) => del(`/ai/connections/${enc(id)}`, { reason });

// Models, use cases, routing
export const listModels = () => get("/ai/models");
export const listAliases = () => get("/ai/model-aliases");
export const setAlias = (alias, providerKey, modelId, version) => put(`/ai/model-aliases/${enc(alias)}`, { providerKey, modelId, version });
export const listUseCases = () => get("/ai/use-cases");
export const updateUseCase = (key, changes) => patch(`/ai/use-cases/${enc(key)}`, changes);
export const listRouting = () => get("/ai/routing-policies");
export const setRouting = (useCase, body) => put(`/ai/routing-policies/${enc(useCase)}`, body);

// Policy and privacy
export const getPolicy = () => get("/ai/policy");
export const updatePolicy = (changes) => patch("/ai/policy", changes);
export const getRedactionRules = () => get("/ai/redaction-rules");
export const putRedactionRules = (rules) => put("/ai/redaction-rules", { rules });
export const contextPreview = (useCaseKey, sample, providerKey) => post("/ai/context-preview", { useCaseKey, sample, providerKey });

// Generation (AI Overview)
export const narrative = (body) => post("/ai/narrative", body, once());
export const explore = (body) => post("/ai/explore", body, once());
export const getRequest = (id) => get(`/ai/requests/${enc(id)}`);
export const cancelRequest = (id) => post(`/ai/requests/${enc(id)}/cancel`);
export const sendFeedback = (body) => post("/ai/feedback", body);
export const requestEventsUrl = (id) => `${BASE_URL}/ai/requests/${enc(id)}/events?organizationId=${enc(org())}`;

// Usage, prices, budgets
export const listUsage = (params) => get("/ai/usage", params);
export const usageSummary = (params) => get("/ai/usage/summary", params);
export const listPriceTables = () => get("/ai/price-tables");
export const putPriceTable = (provider, body) => put(`/ai/price-tables/${enc(provider)}`, body);
export const listBudgets = () => get("/ai/budgets");
export const createBudget = (body) => post("/ai/budgets", body);
export const updateBudget = (id, changes) => patch(`/ai/budgets/${enc(id)}`, changes);

// Governed actions
export const listActions = (params) => get("/ai/actions", params);
export const previewAction = (body) => post("/ai/actions/preview", body);
export const suggestAction = (body) => post("/ai/actions/suggest", body);
export const getAction = (id) => get(`/ai/actions/${enc(id)}`);
export const confirmAction = (id) => post(`/ai/actions/${enc(id)}/confirm`, {}, once());
export const approveAction = (id, reason) => post(`/ai/actions/${enc(id)}/approve`, { reason }, once());
export const rejectAction = (id, reason) => post(`/ai/actions/${enc(id)}/reject`, { reason });
export const cancelAction = (id) => post(`/ai/actions/${enc(id)}/cancel`);
export const undoAction = (id) => post(`/ai/actions/${enc(id)}/undo`, {}, once());

// Evaluations and audit
export const listScenarios = () => get("/ai/evaluations/scenarios");
export const listRuns = () => get("/ai/evaluations/runs");
export const startRun = (body) => post("/ai/evaluations/runs", body);
export const getRun = (id) => get(`/ai/evaluations/runs/${enc(id)}`);
export const listAudit = (params) => get("/ai/audit", params);

// AI Copilot (Backend Phase 10)
export const copilotInfo = () => get("/ai/copilot");
export const listCopilotConversations = (params) => get("/ai/copilot/conversations", params);
export const createCopilotConversation = (body = {}) => post("/ai/copilot/conversations", body);
export const getCopilotConversation = (id) => get(`/ai/copilot/conversations/${enc(id)}`);
export const updateCopilotConversation = (id, changes) => patch(`/ai/copilot/conversations/${enc(id)}`, changes);
export const archiveCopilotConversation = (id) => post(`/ai/copilot/conversations/${enc(id)}/archive`);
export const restoreCopilotConversation = (id) => post(`/ai/copilot/conversations/${enc(id)}/restore`);
export const deleteCopilotConversation = (id) => del(`/ai/copilot/conversations/${enc(id)}`);
export const listCopilotMessages = (id) => get(`/ai/copilot/conversations/${enc(id)}/messages`);
export const sendCopilotMessage = (id, text) => post(`/ai/copilot/conversations/${enc(id)}/messages`, { text }, once());
export const copilotScope = (id) => get(`/ai/copilot/conversations/${enc(id)}/scope`);
export const addCopilotContext = (id, recordType, recordId) => post(`/ai/copilot/conversations/${enc(id)}/context`, { recordType, recordId });
export const removeCopilotContext = (id, contextId) => del(`/ai/copilot/conversations/${enc(id)}/context/${enc(contextId)}`);
export const searchCopilotContext = (q, type) => get("/ai/copilot/context/search", { q, type });
export const getCopilotMessage = (id) => get(`/ai/copilot/messages/${enc(id)}`);
export const cancelCopilotMessage = (id) => post(`/ai/copilot/messages/${enc(id)}/cancel`);
export const regenerateCopilotMessage = (id) => post(`/ai/copilot/messages/${enc(id)}/regenerate`, {}, once());
export const copilotFeedback = (id, rating, reason, comment) => post(`/ai/copilot/messages/${enc(id)}/feedback`, { rating, reason, comment });
export const copilotEventsUrl = (messageId) => `${BASE_URL}/ai/copilot/messages/${enc(messageId)}/events?organizationId=${enc(org())}`;
export const answerCopilotClarification = (id, recordId) => post(`/ai/copilot/clarifications/${enc(id)}/answer`, { recordId });
export const approveCopilotToolCall = (id) => post(`/ai/copilot/tool-calls/${enc(id)}/approve`);
export const listCopilotMemory = () => get("/ai/copilot/memory");
export const createCopilotMemory = (key, value, expiresInDays) => post("/ai/copilot/memory", { key, value, expiresInDays });
export const updateCopilotMemory = (id, changes) => patch(`/ai/copilot/memory/${enc(id)}`, changes);
export const deleteCopilotMemory = (id) => del(`/ai/copilot/memory/${enc(id)}`);
export const listCopilotWorkflows = () => get("/ai/copilot/workflows");
export const runCopilotWorkflow = (key, input, conversationId) => post(`/ai/copilot/workflows/${enc(key)}/run`, { input, conversationId }, once());
export const getCopilotWorkflowRun = (id) => get(`/ai/copilot/workflow-runs/${enc(id)}`);
export const cancelCopilotWorkflowRun = (id) => post(`/ai/copilot/workflow-runs/${enc(id)}/cancel`);
export const approveCopilotWorkflowRun = (id) => post(`/ai/copilot/workflow-runs/${enc(id)}/approve`);
export const rejectCopilotWorkflowRun = (id, reason) => post(`/ai/copilot/workflow-runs/${enc(id)}/reject`, { reason });
export const copilotIndexStatus = () => get("/ai/copilot/index");
export const rebuildCopilotIndex = () => post("/ai/copilot/index/rebuild");
