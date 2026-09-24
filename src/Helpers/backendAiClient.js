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
export const listRuns = () => get("/ai/evaluations/scenario-runs");
export const startRun = (body) => post("/ai/evaluations/scenario-runs", body);
export const getRun = (id) => get(`/ai/evaluations/scenario-runs/${enc(id)}`);
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

// AI governance, evaluation, releases, monitoring, incidents (Backend Phase 11)
export const aiAdminAccess = () => get("/ai/governance/access");
export const governanceDashboard = () => get("/ai/governance");
export const listCapabilities = () => get("/ai/governance/capabilities");
export const getCapability = (key) => get(`/ai/governance/capabilities/${enc(key)}`);
export const updateCapability = (key, changes) => patch(`/ai/governance/capabilities/${enc(key)}`, changes);
export const getReadiness = (key) => get(`/ai/governance/capabilities/${enc(key)}/readiness`);
export const confirmReadiness = (key, item, status, evidence) => post(`/ai/governance/capabilities/${enc(key)}/readiness/${enc(item)}`, { status, evidence });
export const listPolicies = () => get("/ai/governance/policies");
export const getGovernancePolicy = (id) => get(`/ai/governance/policies/${enc(id)}`);
export const createPolicy = (body) => post("/ai/governance/policies", body);
export const addPolicyVersion = (id, body, changeSummary) => post(`/ai/governance/policies/${enc(id)}/versions`, { body, changeSummary });
export const policyAction = (id, action, body = {}) => post(`/ai/governance/policies/${enc(id)}/${action}`, body);
export const listProviderGovernance = () => get("/ai/governance/providers");
export const updateProviderGovernance = (key, changes) => patch(`/ai/governance/providers/${enc(key)}`, changes);
export const verifyProviderGovernance = (key) => post(`/ai/governance/providers/${enc(key)}/verify`);
export const setProviderGovernanceStatus = (key, status, reason) => post(`/ai/governance/providers/${enc(key)}/status`, { status, reason });
export const listModelGovernance = () => get("/ai/governance/models");
export const updateModelGovernance = (id, changes) => patch(`/ai/governance/models/${enc(id)}`, changes);
export const approveModelGovernance = (id, body) => post(`/ai/governance/models/${enc(id)}/approve`, body);
export const listPromptGovernance = () => get("/ai/governance/prompts");
export const getPromptGovernance = (id) => get(`/ai/governance/prompts/${enc(id)}`);
export const createPromptVersion = (body) => post("/ai/governance/prompts", body);
export const transitionPrompt = (id, to, reason, runId) => post(`/ai/governance/prompts/${enc(id)}/transition`, { to, reason, runId });
export const listToolGovernance = () => get("/ai/governance/tools");
export const transitionTool = (id, to, reason, runId) => post(`/ai/governance/tools/${enc(id)}/transition`, { to, reason, runId });
export const listWorkflowGovernance = () => get("/ai/governance/workflows");
export const registerWorkflowVersions = () => post("/ai/governance/workflows/register");
export const transitionWorkflow = (id, to, reason, runId) => post(`/ai/governance/workflows/${enc(id)}/transition`, { to, reason, runId });
export const listFlags = () => get("/ai/governance/flags");
export const setFlag = (body) => put("/ai/governance/flags", body);
export const listExceptions = () => get("/ai/governance/exceptions");
export const requestException = (body) => post("/ai/governance/exceptions", body);
export const decideException = (id, decision, reason) => post(`/ai/governance/exceptions/${enc(id)}/decide`, { decision, reason });
export const costGovernance = (params) => get("/ai/governance/cost", params);
export const recordProviderInvoice = (body) => post("/ai/governance/cost/invoices", body);
export const listReportTypes = () => get("/ai/governance/reports");
export const getReport = (type) => get(`/ai/governance/reports/${enc(type)}`);
export const reportDownloadUrl = (type, format) => `${BASE_URL}/ai/governance/reports/${enc(type)}?organizationId=${enc(org())}&format=${enc(format)}&download=true`;
export const governanceHealth = () => get("/ai/governance/health");
export const listEvalSuites = () => get("/ai/evaluations/suites");
export const listEvalDatasets = () => get("/ai/evaluations/datasets");
export const getEvalDatasetVersion = (versionId) => get(`/ai/evaluations/datasets/versions/${enc(versionId)}`);
export const listEvalRuns = () => get("/ai/evaluations/runs");
export const startEvalRun = (body) => post("/ai/evaluations/runs", body, once());
export const getEvalRun = (id) => get(`/ai/evaluations/runs/${enc(id)}`);
export const cancelEvalRun = (id) => post(`/ai/evaluations/runs/${enc(id)}/cancel`);
export const reviewEvalResult = (id, resultId, decision, reason) => post(`/ai/evaluations/runs/${enc(id)}/review`, { resultId, decision, reason });
export const listEvalComparisons = () => get("/ai/evaluations/comparisons");
export const createEvalComparison = (body) => post("/ai/evaluations/comparisons", body);
export const listReleases = (params) => get("/ai/releases", params);
export const getRelease = (id) => get(`/ai/releases/${enc(id)}`);
export const createRelease = (body) => post("/ai/releases", body);
export const releaseAction = (id, action, body = {}) => post(`/ai/releases/${enc(id)}/${action}`, body, once());
export const monitoringSummary = (params) => get("/ai/monitoring/summary", params);
export const listSafetyEvents = (params) => get("/ai/monitoring/safety-events", params);
export const reviewSafetyEvent = (id, reviewStatus, reason) => post(`/ai/monitoring/safety-events/${enc(id)}/review`, { reviewStatus, reason });
export const listAlerts = (params) => get("/ai/monitoring/alerts", params);
export const alertAction = (id, action, note) => post(`/ai/monitoring/alerts/${enc(id)}/${action}`, { note });
export const measureSlos = () => post("/ai/monitoring/slos/measure");
export const evaluateAlerts = () => post("/ai/monitoring/alerts/evaluate");
export const listIncidents = (params) => get("/ai/incidents", params);
export const getIncident = (id) => get(`/ai/incidents/${enc(id)}`);
export const createIncident = (body) => post("/ai/incidents", body);
export const updateIncident = (id, changes) => patch(`/ai/incidents/${enc(id)}`, changes);
export const incidentAction = (id, action, body = {}) => post(`/ai/incidents/${enc(id)}/${action}`, body);
export const readIncidentEvidence = (id) => get(`/ai/incidents/${enc(id)}/evidence`);
export const listKillSwitches = () => get("/ai/kill-switches");
export const activateKillSwitch = (id, body) => post(`/ai/kill-switches/${enc(id)}/activate`, body);
export const deactivateKillSwitch = (id, reason) => post(`/ai/kill-switches/${enc(id)}/deactivate`, { reason });
export const listReviews = (params) => get("/ai/reviews", params);
export const decideReview = (id, action, body) => post(`/ai/reviews/${enc(id)}/${action}`, body);
