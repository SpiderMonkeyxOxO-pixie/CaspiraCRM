// Typed adapter for Backend Phase 4's Support surface (/api/v1/support/tickets).
// Same conventions as backendCrmClient.js: httpOnly session cookies,
// double-submit CSRF, one-shot refresh-on-401. Gated by its own flag,
// VITE_BACKEND_SUPPORT_MODE.
import axios from "axios";

const BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1";

export const BACKEND_SUPPORT_MODE_ENABLED = import.meta.env.VITE_BACKEND_SUPPORT_MODE === "true";

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

// One key per user action: a retried or double-clicked request is answered
// from the server's record instead of creating a second ticket or reply.
const idempotencyKey = () => globalThis.crypto?.randomUUID?.() || `support-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const once = () => ({ headers: { "Idempotency-Key": idempotencyKey() } });

const post = (organizationId, ticketId, action, body = {}, config) =>
  client.post(`/support/tickets/${ticketId}/${action}`, { ...body, organizationId }, config).then((r) => r.data);

export const listTickets = (organizationId, params) => client.get("/support/tickets", { params: { ...params, organizationId } }).then((r) => r.data);
export const getTicket = (organizationId, ticketId) => client.get(`/support/tickets/${ticketId}`, { params: { organizationId } }).then((r) => r.data);
export const listTicketEvents = (organizationId, ticketId) => client.get(`/support/tickets/${ticketId}/events`, { params: { organizationId } }).then((r) => r.data);
export const createTicket = (organizationId, payload) => client.post("/support/tickets", { ...payload, organizationId }, once()).then((r) => r.data);
export const updateTicket = (organizationId, ticketId, changes) => client.patch(`/support/tickets/${ticketId}`, { ...changes, organizationId }).then((r) => r.data);
export const transitionTicket = (organizationId, ticketId, status, reason) => post(organizationId, ticketId, "transition", { status, reason });
export const advanceTicket = (organizationId, ticketId, status) => transitionTicket(organizationId, ticketId, status);
export const assignTicket = (organizationId, ticketId, assignedMembershipId) => post(organizationId, ticketId, "assign", { assignedMembershipId });
export const replyToTicket = (organizationId, ticketId, message) => post(organizationId, ticketId, "replies", { message }, once());
export const addTicketNote = (organizationId, ticketId, message, restricted = false) => post(organizationId, ticketId, "internal-notes", { message, restricted });
export const escalateTicket = (organizationId, ticketId, to, reason) => post(organizationId, ticketId, "escalate", { to, reason });
export const resolveTicket = (organizationId, ticketId, summary, resolutionCode) => post(organizationId, ticketId, "resolve", { summary, resolutionCode }, once());
// Staff never record the customer's satisfaction — only the customer can, in the portal.
export const closeTicket = (organizationId, ticketId) => post(organizationId, ticketId, "close", {}, once());
export const reopenTicket = (organizationId, ticketId, reason) => post(organizationId, ticketId, "reopen", { reason }, once());

// ---- Backend Phase 4 (full spec) adapters -------------------------------
const get = (path, organizationId, params) => client.get(path, { params: { ...params, organizationId } }).then((r) => r.data);
const send = (method, path, organizationId, body = {}, config) => client[method](path, { ...body, organizationId }, config).then((r) => r.data);

// Configuration
export const listQueues = (organizationId) => get("/support/queues", organizationId);
export const listInboxes = (organizationId) => get("/support/inboxes", organizationId);
export const listTicketCategories = (organizationId) => get("/support/categories", organizationId);
export const listCannedResponses = (organizationId, params) => get("/support/canned-responses", organizationId, params);
export const listSlaPolicies = (organizationId) => get("/support/sla-policies", organizationId);
export const listEntitlements = (organizationId, params) => get("/support/entitlements", organizationId, params);

// Ticket extras
export const bulkTickets = (organizationId, action, ticketIds, changes) => send("post", "/support/tickets/bulk", organizationId, { action, ticketIds, changes });
export const relatedTickets = (organizationId, ticketId) => get(`/support/tickets/${ticketId}/related`, organizationId);
export const followTicket = (organizationId, ticketId, membershipId) => send("post", `/support/tickets/${ticketId}/followers`, organizationId, { membershipId });
export const archiveTicket = (organizationId, ticketId, reason) => post(organizationId, ticketId, "archive", { reason });
export const restoreTicket = (organizationId, ticketId) => post(organizationId, ticketId, "restore");
export const mergeTicketPreview = (organizationId, ticketId, targetTicketId) => post(organizationId, ticketId, "merge-preview", { targetTicketId });
export const mergeTicket = (organizationId, ticketId, targetTicketId, reason) => post(organizationId, ticketId, "merge", { targetTicketId, reason }, once());

// Knowledge Base (internal)
export const listKbArticles = (organizationId, params) => get("/support/kb/articles", organizationId, params);
export const getKbArticle = (organizationId, articleId) => get(`/support/kb/articles/${articleId}`, organizationId);

// Reports and satisfaction
export const getSupportSummary = (organizationId, params) => get("/support/reports/summary", organizationId, params);
export const listSatisfaction = (organizationId, params) => get("/support/satisfaction", organizationId, params);

// Customer Portal (customer logins only)
export const portalListTickets = (params) => client.get("/portal/support/tickets", { params }).then((r) => r.data);
export const portalGetTicket = (ticketId) => client.get(`/portal/support/tickets/${ticketId}`).then((r) => r.data);
export const portalCreateTicket = (payload) => client.post("/portal/support/tickets", payload, once()).then((r) => r.data);
export const portalReply = (ticketId, message) => client.post(`/portal/support/tickets/${ticketId}/replies`, { message }, once()).then((r) => r.data);
export const portalRate = (ticketId, rating, comment) => client.post(`/portal/support/tickets/${ticketId}/satisfaction`, { rating, comment }, once()).then((r) => r.data);
export const portalListArticles = (params) => client.get("/portal/knowledge-base/articles", { params }).then((r) => r.data);
export const portalGetArticle = (slug) => client.get(`/portal/knowledge-base/articles/${slug}`).then((r) => r.data);
