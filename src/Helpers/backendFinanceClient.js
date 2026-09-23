// Typed adapter for Backend Phase 6's Finance surface (/api/v1/finance/*).
// Same conventions as backendCrmClient.js: httpOnly session cookies,
// double-submit CSRF, one-shot refresh-on-401. Gated by its own flag,
// VITE_BACKEND_FINANCE_MODE.
import axios from "axios";

const BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1";

export const BACKEND_FINANCE_MODE_ENABLED = import.meta.env.VITE_BACKEND_FINANCE_MODE === "true";

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

export const listInvoices = (organizationId, params) => get("/finance/invoices", organizationId, params);
export const getInvoice = (organizationId, id) => get(`/finance/invoices/${id}`, organizationId);
export const createInvoice = (organizationId, payload) => post("/finance/invoices", organizationId, payload);
export const approveInvoice = (organizationId, id) => post(`/finance/invoices/${id}/approve`, organizationId);
export const sendInvoice = (organizationId, id) => post(`/finance/invoices/${id}/send`, organizationId);
export const voidInvoice = (organizationId, id, reason) => post(`/finance/invoices/${id}/void`, organizationId, { reason });
export const recordPayment = (organizationId, id, payment) => post(`/finance/invoices/${id}/payments`, organizationId, payment);
export const requestOrderInvoice = (organizationId, orderId) => post(`/sales/orders/${orderId}/request-invoice`, organizationId);

export const listCreditNotes = (organizationId) => get("/finance/credit-notes", organizationId);
export const issueCreditNote = (organizationId, payload) => post("/finance/credit-notes", organizationId, payload);

export const listExpenses = (organizationId, params) => get("/finance/expenses", organizationId, params);
export const createExpense = (organizationId, payload) => post("/finance/expenses", organizationId, payload);
export const reviewExpense = (organizationId, id, status, note) => post(`/finance/expenses/${id}/review`, organizationId, { status, note });

export const listRecurringInvoices = (organizationId) => get("/finance/recurring-invoices", organizationId);
export const createRecurringInvoice = (organizationId, payload) => post("/finance/recurring-invoices", organizationId, payload);
export const updateRecurringInvoice = (organizationId, id, changes) => client.patch(`/finance/recurring-invoices/${id}`, withOrg(organizationId, changes)).then((r) => r.data);
export const generateRecurringInvoice = (organizationId, id) => post(`/finance/recurring-invoices/${id}/generate`, organizationId);
