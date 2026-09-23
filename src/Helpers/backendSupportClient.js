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
