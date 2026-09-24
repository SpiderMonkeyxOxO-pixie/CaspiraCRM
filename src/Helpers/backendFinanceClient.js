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
// One key per user action: a retried or double-clicked request is answered
// from the server's record instead of posting twice.
const once = () => ({ headers: { "Idempotency-Key": globalThis.crypto?.randomUUID?.() || `finance-${Date.now()}-${Math.random().toString(36).slice(2)}` } });
const post = (path, organizationId, body, config) => client.post(path, withOrg(organizationId, body), config).then((r) => r.data);
const patch = (path, organizationId, body) => client.patch(path, withOrg(organizationId, body)).then((r) => r.data);

export const listInvoices = (organizationId, params) => get("/finance/invoices", organizationId, params);
export const getInvoice = (organizationId, id) => get(`/finance/invoices/${id}`, organizationId);
export const createInvoice = (organizationId, payload) => post("/finance/invoices", organizationId, payload);
export const approveInvoice = (organizationId, id) => post(`/finance/invoices/${id}/approve`, organizationId);
export const sendInvoice = (organizationId, id) => post(`/finance/invoices/${id}/send`, organizationId);
export const voidInvoice = (organizationId, id, reason) => post(`/finance/invoices/${id}/void`, organizationId, { reason });
export const postInvoice = (organizationId, id) => post(`/finance/invoices/${id}/post`, organizationId, {}, once());
export const recordPayment = (organizationId, id, payment) => post(`/finance/invoices/${id}/payments`, organizationId, payment, once());
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

// ---- Backend Phase 6 (full spec) adapters --------------------------------
// Payments are records only: "Recorded payment — no bank or payment-provider
// transfer was performed." Posting steps send an Idempotency-Key.
export const PAYMENT_LABEL = "Recorded payment — no bank or payment-provider transfer was performed.";
// Generic POST for the work-queue actions (financeActions.js).
export const financePost = (path, organizationId, body, idempotent) => post(path, organizationId, body, idempotent ? once() : undefined);
export const getFinanceAccess = (organizationId) => get("/finance/access", organizationId);
export const getWorkQueue = (organizationId) => get("/finance/queue", organizationId);
export const getFinanceSettings = (organizationId) => get("/finance/settings", organizationId);
export const updateFinanceSettings = (organizationId, changes) => patch("/finance/settings", organizationId, changes);
export const createFinancialAccount = (organizationId, payload) => post("/finance/financial-accounts", organizationId, payload);
export const listFinanceReports = (organizationId) => get("/finance/reports", organizationId);
export const initializeChart = (organizationId, confirm) => post("/finance/setup/chart-of-accounts", organizationId, { confirm });
export const listFiscalYears = (organizationId) => get("/finance/fiscal-years", organizationId);
export const createFiscalYear = (organizationId, payload) => post("/finance/fiscal-years", organizationId, payload);
export const softClosePeriod = (organizationId, periodId) => post(`/finance/periods/${periodId}/soft-close`, organizationId);
export const closePeriod = (organizationId, periodId) => post(`/finance/periods/${periodId}/close`, organizationId);
export const reopenPeriod = (organizationId, periodId, reason) => post(`/finance/periods/${periodId}/reopen`, organizationId, { reason });
export const listAccounts = (organizationId, params) => get("/finance/accounts", organizationId, params);
export const createAccount = (organizationId, payload) => post("/finance/accounts", organizationId, payload);
export const listCostCenters = (organizationId) => get("/finance/cost-centers", organizationId);
export const listTaxRates = (organizationId) => get("/finance/tax-rates", organizationId);
export const listExchangeRates = (organizationId) => get("/finance/exchange-rates", organizationId);
export const listJournals = (organizationId, params) => get("/finance/journals", organizationId, params);
export const getJournal = (organizationId, id) => get(`/finance/journals/${id}`, organizationId);
export const createJournal = (organizationId, payload) => post("/finance/journals", organizationId, payload);
export const submitJournal = (organizationId, id) => post(`/finance/journals/${id}/submit`, organizationId);
export const approveJournal = (organizationId, id) => post(`/finance/journals/${id}/approve`, organizationId);
export const postJournal = (organizationId, id) => post(`/finance/journals/${id}/post`, organizationId, {}, once());
export const reverseJournal = (organizationId, id, reason) => post(`/finance/journals/${id}/reverse`, organizationId, { reason }, once());
export const listExpenseReports = (organizationId) => get("/finance/expense-reports", organizationId);
export const createExpenseReport = (organizationId, payload) => post("/finance/expense-reports", organizationId, payload);
export const submitExpenseReport = (organizationId, id) => post(`/finance/expense-reports/${id}/submit`, organizationId);
export const approveExpenseReport = (organizationId, id) => post(`/finance/expense-reports/${id}/approve`, organizationId);
export const rejectExpenseReport = (organizationId, id, reason) => post(`/finance/expense-reports/${id}/reject`, organizationId, { reason });
export const postExpenseReport = (organizationId, id) => post(`/finance/expense-reports/${id}/post`, organizationId, {}, once());
export const postExpense = (organizationId, id) => post(`/finance/expenses/${id}/post`, organizationId, {}, once());
export const listVendors = (organizationId) => get("/finance/vendors", organizationId);
export const listBills = (organizationId, params) => get("/finance/bills", organizationId, params);
export const createBill = (organizationId, payload) => post("/finance/bills", organizationId, payload);
export const approveBill = (organizationId, id) => post(`/finance/bills/${id}/approve`, organizationId);
export const postBill = (organizationId, id) => post(`/finance/bills/${id}/post`, organizationId, {}, once());
export const listPayments = (organizationId, params) => get("/finance/payments", organizationId, params);
export const createPayment = (organizationId, payload) => post("/finance/payments", organizationId, payload);
export const approvePayment = (organizationId, id) => post(`/finance/payments/${id}/approve`, organizationId);
export const postPayment = (organizationId, id) => post(`/finance/payments/${id}/post`, organizationId, {}, once());
export const reversePayment = (organizationId, id, reason) => post(`/finance/payments/${id}/reverse`, organizationId, { reason }, once());
export const allocatePayment = (organizationId, id, allocations) => post(`/finance/payments/${id}/allocations`, organizationId, { allocations }, once());
export const approveCreditNote = (organizationId, id) => post(`/finance/credit-notes/${id}/approve`, organizationId);
export const postCreditNote = (organizationId, id) => post(`/finance/credit-notes/${id}/post`, organizationId, {}, once());
export const listFinancialAccounts = (organizationId) => get("/finance/financial-accounts", organizationId);
export const previewStatementImport = (organizationId, payload) => post("/finance/statements/import-preview", organizationId, payload);
export const confirmStatementImport = (organizationId, payload) => post("/finance/statements/import-confirm", organizationId, payload, once());
export const listReconciliations = (organizationId) => get("/finance/reconciliations", organizationId);
export const getReconciliation = (organizationId, id) => get(`/finance/reconciliations/${id}`, organizationId);
export const confirmMatches = (organizationId, id, groups) => post(`/finance/reconciliations/${id}/matches`, organizationId, { groups });
export const completeReconciliation = (organizationId, id) => post(`/finance/reconciliations/${id}/complete`, organizationId, {}, once());
export const listBudgets = (organizationId) => get("/finance/budgets", organizationId);
export const createBudget = (organizationId, payload) => post("/finance/budgets", organizationId, payload);
export const updateBudgetVersion = (organizationId, budgetId, versionId, payload) => patch(`/finance/budgets/${budgetId}/versions/${versionId}`, organizationId, payload);
export const activateBudgetVersion = (organizationId, budgetId, versionId) => post(`/finance/budgets/${budgetId}/versions/${versionId}/activate`, organizationId, {}, once());
export const financeReport = (organizationId, report, params) => get(`/finance/reports/${report}`, organizationId, params);

// Customer Portal (customer logins only; read-only, no "Pay now")
export const portalInvoices = () => client.get("/portal/finance/invoices").then((r) => r.data);
export const portalInvoice = (id) => client.get(`/portal/finance/invoices/${id}`).then((r) => r.data);
export const portalCreditNotes = () => client.get("/portal/finance/credit-notes").then((r) => r.data);
export const portalPayments = () => client.get("/portal/finance/payments").then((r) => r.data);
