// Typed adapter for Backend Phase 3's Sales persistence surface
// (/api/v1/sales/{pipelines,deals,catalog,price-books,quotes,orders,
// contracts,reports}). Same conventions as backendAuthClient.js/
// backendCrmClient.js: httpOnly session cookies, no token in
// localStorage, double-submit CSRF, one-shot refresh-on-401. Gated by a
// new VITE_BACKEND_SALES_MODE env flag (separate from
// VITE_BACKEND_AUTH_MODE/VITE_BACKEND_CRM_MODE/the legacy
// VITE_USE_MOCK_API — never mixed). NOT wired into any live Sales page
// or Redux slice this phase — src/redux/sales/*Slice.js and
// src/redux/crm/dealsSlice.js remain the active data source until that
// switch is made as its own piece of work.
import axios from "axios";

const BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1";

export const BACKEND_SALES_MODE_ENABLED = import.meta.env.VITE_BACKEND_SALES_MODE === "true";

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const client = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

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

function withOrg(organizationId, params = {}) {
  return { ...params, organizationId };
}

// --- Pipelines ---
export const listPipelines = (organizationId) => client.get("/sales/pipelines", { params: withOrg(organizationId) }).then((r) => r.data);
export const createPipeline = (organizationId, payload) => client.post("/sales/pipelines", { ...payload, organizationId }).then((r) => r.data);
export const getPipeline = (organizationId, pipelineId) => client.get(`/sales/pipelines/${pipelineId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const updatePipeline = (organizationId, pipelineId, changes) => client.patch(`/sales/pipelines/${pipelineId}`, { ...changes, organizationId }).then((r) => r.data);
export const archivePipeline = (organizationId, pipelineId) => client.post(`/sales/pipelines/${pipelineId}/archive`, { organizationId }).then((r) => r.data);
export const restorePipeline = (organizationId, pipelineId) => client.post(`/sales/pipelines/${pipelineId}/restore`, { organizationId }).then((r) => r.data);
export const createStage = (organizationId, pipelineId, payload) => client.post(`/sales/pipelines/${pipelineId}/stages`, { ...payload, organizationId }).then((r) => r.data);
export const updateStage = (organizationId, pipelineId, stageId, changes) => client.patch(`/sales/pipelines/${pipelineId}/stages/${stageId}`, { ...changes, organizationId }).then((r) => r.data);
export const reorderStages = (organizationId, pipelineId, stageIds) => client.post(`/sales/pipelines/${pipelineId}/stages/reorder`, { organizationId, stageIds }).then((r) => r.data);

// --- Deals ---
export const listDeals = (organizationId, params) => client.get("/sales/deals", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getDeal = (organizationId, dealId) => client.get(`/sales/deals/${dealId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createDeal = (organizationId, payload) => client.post("/sales/deals", { ...payload, organizationId }).then((r) => r.data);
export const updateDeal = (organizationId, dealId, changes) => client.patch(`/sales/deals/${dealId}`, { ...changes, organizationId }).then((r) => r.data);
export const assignDeal = (organizationId, dealId, ownerMembershipId) => client.post(`/sales/deals/${dealId}/assign`, { organizationId, ownerMembershipId }).then((r) => r.data);
// The same endpoint backs both the detail-form transition control and
// Kanban drag-and-drop — never a separate "quick move" call.
export const transitionDeal = (organizationId, dealId, payload) => client.post(`/sales/deals/${dealId}/transition`, { ...payload, organizationId }).then((r) => r.data);
export const markDealWon = (organizationId, dealId, payload) => client.post(`/sales/deals/${dealId}/mark-won`, { ...payload, organizationId }).then((r) => r.data);
export const markDealLost = (organizationId, dealId, lossReason) => client.post(`/sales/deals/${dealId}/mark-lost`, { organizationId, lossReason }).then((r) => r.data);
export const reopenDeal = (organizationId, dealId, reason) => client.post(`/sales/deals/${dealId}/reopen`, { organizationId, reason }).then((r) => r.data);
export const archiveDeal = (organizationId, dealId, reason) => client.post(`/sales/deals/${dealId}/archive`, { organizationId, reason }).then((r) => r.data);
export const restoreDeal = (organizationId, dealId) => client.post(`/sales/deals/${dealId}/restore`, { organizationId }).then((r) => r.data);
export const getDealStageHistory = (organizationId, dealId) => client.get(`/sales/deals/${dealId}/stage-history`, { params: withOrg(organizationId) }).then((r) => r.data);
export const getDealRiskFlags = (organizationId, dealId) => client.get(`/sales/deals/${dealId}/risk-flags`, { params: withOrg(organizationId) }).then((r) => r.data);
export const listDealLineItems = (organizationId, dealId) => client.get(`/sales/deals/${dealId}/line-items`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createDealLineItem = (organizationId, dealId, payload) => client.post(`/sales/deals/${dealId}/line-items`, { ...payload, organizationId }).then((r) => r.data);
export const updateDealLineItem = (organizationId, dealId, lineItemId, changes) => client.patch(`/sales/deals/${dealId}/line-items/${lineItemId}`, { ...changes, organizationId }).then((r) => r.data);
export const deleteDealLineItem = (organizationId, dealId, lineItemId) => client.delete(`/sales/deals/${dealId}/line-items/${lineItemId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const bulkDeals = (organizationId, payload) => client.post("/sales/deals/bulk", { ...payload, organizationId }).then((r) => r.data);

// --- Catalog ---
export const listCatalogItems = (organizationId, params) => client.get("/sales/catalog", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getCatalogItem = (organizationId, itemId) => client.get(`/sales/catalog/${itemId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createCatalogItem = (organizationId, payload) => client.post("/sales/catalog", { ...payload, organizationId }).then((r) => r.data);
export const updateCatalogItem = (organizationId, itemId, changes) => client.patch(`/sales/catalog/${itemId}`, { ...changes, organizationId }).then((r) => r.data);
export const archiveCatalogItem = (organizationId, itemId, reason) => client.post(`/sales/catalog/${itemId}/archive`, { organizationId, reason }).then((r) => r.data);
export const restoreCatalogItem = (organizationId, itemId) => client.post(`/sales/catalog/${itemId}/restore`, { organizationId }).then((r) => r.data);
export const bulkCatalogItems = (organizationId, payload) => client.post("/sales/catalog/bulk", { ...payload, organizationId }).then((r) => r.data);

// --- Price Books ---
export const listPriceBooks = (organizationId, params) => client.get("/sales/price-books", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getPriceBook = (organizationId, priceBookId) => client.get(`/sales/price-books/${priceBookId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createPriceBook = (organizationId, payload) => client.post("/sales/price-books", { ...payload, organizationId }).then((r) => r.data);
export const updatePriceBook = (organizationId, priceBookId, changes) => client.patch(`/sales/price-books/${priceBookId}`, { ...changes, organizationId }).then((r) => r.data);
export const archivePriceBook = (organizationId, priceBookId, reason) => client.post(`/sales/price-books/${priceBookId}/archive`, { organizationId, reason }).then((r) => r.data);
export const restorePriceBook = (organizationId, priceBookId) => client.post(`/sales/price-books/${priceBookId}/restore`, { organizationId }).then((r) => r.data);
export const createPriceBookEntry = (organizationId, priceBookId, payload) => client.post(`/sales/price-books/${priceBookId}/entries`, { ...payload, organizationId }).then((r) => r.data);
export const updatePriceBookEntry = (organizationId, priceBookId, entryId, changes) => client.patch(`/sales/price-books/${priceBookId}/entries/${entryId}`, { ...changes, organizationId }).then((r) => r.data);
export const deletePriceBookEntry = (organizationId, priceBookId, entryId) => client.delete(`/sales/price-books/${priceBookId}/entries/${entryId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const bulkPriceBooks = (organizationId, payload) => client.post("/sales/price-books/bulk", { ...payload, organizationId }).then((r) => r.data);

// --- Quotes ---
export const listQuotes = (organizationId, params) => client.get("/sales/quotes", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getQuote = (organizationId, quoteId) => client.get(`/sales/quotes/${quoteId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createQuote = (organizationId, payload) => client.post("/sales/quotes", { ...payload, organizationId }).then((r) => r.data);
export const updateQuote = (organizationId, quoteId, changes) => client.patch(`/sales/quotes/${quoteId}`, { ...changes, organizationId }).then((r) => r.data);
export const submitQuote = (organizationId, quoteId, idempotencyKey) => client.post(`/sales/quotes/${quoteId}/submit`, { organizationId }, { headers: { "Idempotency-Key": idempotencyKey } }).then((r) => r.data);
export const approveQuote = (organizationId, quoteId, idempotencyKey) => client.post(`/sales/quotes/${quoteId}/approve`, { organizationId }, { headers: { "Idempotency-Key": idempotencyKey } }).then((r) => r.data);
export const rejectQuote = (organizationId, quoteId, reason) => client.post(`/sales/quotes/${quoteId}/reject`, { organizationId, reason }).then((r) => r.data);
export const issueQuote = (organizationId, quoteId) => client.post(`/sales/quotes/${quoteId}/issue`, { organizationId }).then((r) => r.data);
export const acceptQuote = (organizationId, quoteId, payload) => client.post(`/sales/quotes/${quoteId}/accept`, { ...payload, organizationId }).then((r) => r.data);
export const rejectQuoteByCustomer = (organizationId, quoteId, reason) => client.post(`/sales/quotes/${quoteId}/reject-by-customer`, { organizationId, reason }).then((r) => r.data);
export const cancelQuote = (organizationId, quoteId, reason) => client.post(`/sales/quotes/${quoteId}/cancel`, { organizationId, reason }).then((r) => r.data);
export const createQuoteVersion = (organizationId, quoteId, payload) => client.post(`/sales/quotes/${quoteId}/new-version`, { ...payload, organizationId }).then((r) => r.data);
export const previewQuoteToOrder = (organizationId, quoteId) => client.post(`/sales/quotes/${quoteId}/order-preview`, { organizationId }).then((r) => r.data);
export const convertQuoteToOrder = (organizationId, quoteId, payload, idempotencyKey) =>
  client.post(`/sales/quotes/${quoteId}/convert-to-order`, { ...payload, organizationId }, { headers: { "Idempotency-Key": idempotencyKey } }).then((r) => r.data);
export const archiveQuote = (organizationId, quoteId, reason) => client.post(`/sales/quotes/${quoteId}/archive`, { organizationId, reason }).then((r) => r.data);
export const restoreQuote = (organizationId, quoteId) => client.post(`/sales/quotes/${quoteId}/restore`, { organizationId }).then((r) => r.data);
export const bulkQuotes = (organizationId, payload) => client.post("/sales/quotes/bulk", { ...payload, organizationId }).then((r) => r.data);

// --- Orders ---
export const listOrders = (organizationId, params) => client.get("/sales/orders", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getOrder = (organizationId, orderId) => client.get(`/sales/orders/${orderId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createOrder = (organizationId, payload) => client.post("/sales/orders", { ...payload, organizationId }).then((r) => r.data);
export const updateOrder = (organizationId, orderId, changes) => client.patch(`/sales/orders/${orderId}`, { ...changes, organizationId }).then((r) => r.data);
export const submitOrder = (organizationId, orderId) => client.post(`/sales/orders/${orderId}/submit`, { organizationId }).then((r) => r.data);
export const confirmOrder = (organizationId, orderId, idempotencyKey) => client.post(`/sales/orders/${orderId}/confirm`, { organizationId }, { headers: { "Idempotency-Key": idempotencyKey } }).then((r) => r.data);
export const cancelOrder = (organizationId, orderId, reason) => client.post(`/sales/orders/${orderId}/cancel`, { organizationId, reason }).then((r) => r.data);
export const markOrderInProgress = (organizationId, orderId) => client.post(`/sales/orders/${orderId}/mark-in-progress`, { organizationId }).then((r) => r.data);
export const markOrderFulfilled = (organizationId, orderId) => client.post(`/sales/orders/${orderId}/mark-fulfilled`, { organizationId }).then((r) => r.data);
export const previewOrderToContract = (organizationId, orderId) => client.post(`/sales/orders/${orderId}/contract-preview`, { organizationId }).then((r) => r.data);
export const convertOrderToContract = (organizationId, orderId, payload, idempotencyKey) =>
  client.post(`/sales/orders/${orderId}/convert-to-contract`, { ...payload, organizationId }, { headers: { "Idempotency-Key": idempotencyKey } }).then((r) => r.data);
export const archiveOrder = (organizationId, orderId, reason) => client.post(`/sales/orders/${orderId}/archive`, { organizationId, reason }).then((r) => r.data);
export const restoreOrder = (organizationId, orderId) => client.post(`/sales/orders/${orderId}/restore`, { organizationId }).then((r) => r.data);

// --- Contracts ---
export const listContracts = (organizationId, params) => client.get("/sales/contracts", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getContract = (organizationId, contractId) => client.get(`/sales/contracts/${contractId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createContract = (organizationId, payload) => client.post("/sales/contracts", { ...payload, organizationId }).then((r) => r.data);
export const updateContract = (organizationId, contractId, changes) => client.patch(`/sales/contracts/${contractId}`, { ...changes, organizationId }).then((r) => r.data);
export const submitContract = (organizationId, contractId) => client.post(`/sales/contracts/${contractId}/submit`, { organizationId }).then((r) => r.data);
export const approveContract = (organizationId, contractId) => client.post(`/sales/contracts/${contractId}/approve`, { organizationId }).then((r) => r.data);
export const recordContractSignature = (organizationId, contractId, payload) => client.post(`/sales/contracts/${contractId}/record-signature`, { ...payload, organizationId }).then((r) => r.data);
export const activateContract = (organizationId, contractId, idempotencyKey) => client.post(`/sales/contracts/${contractId}/activate`, { organizationId }, { headers: { "Idempotency-Key": idempotencyKey } }).then((r) => r.data);
export const startRenewalReview = (organizationId, contractId, payload) => client.post(`/sales/contracts/${contractId}/start-renewal-review`, { ...payload, organizationId }).then((r) => r.data);
export const decideRenewal = (organizationId, contractId, reviewId, payload) => client.post(`/sales/contracts/${contractId}/renewal-reviews/${reviewId}/decide`, { ...payload, organizationId }).then((r) => r.data);
export const expireContract = (organizationId, contractId) => client.post(`/sales/contracts/${contractId}/expire`, { organizationId }).then((r) => r.data);
export const terminateContract = (organizationId, contractId, reason) => client.post(`/sales/contracts/${contractId}/terminate`, { organizationId, reason }).then((r) => r.data);
export const cancelContract = (organizationId, contractId, reason) => client.post(`/sales/contracts/${contractId}/cancel`, { organizationId, reason }).then((r) => r.data);
export const archiveContract = (organizationId, contractId, reason) => client.post(`/sales/contracts/${contractId}/archive`, { organizationId, reason }).then((r) => r.data);
export const restoreContract = (organizationId, contractId) => client.post(`/sales/contracts/${contractId}/restore`, { organizationId }).then((r) => r.data);
export const listObligations = (organizationId, contractId) => client.get(`/sales/contracts/${contractId}/obligations`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createObligation = (organizationId, contractId, payload) => client.post(`/sales/contracts/${contractId}/obligations`, { ...payload, organizationId }).then((r) => r.data);
export const updateObligation = (organizationId, contractId, obligationId, changes) => client.patch(`/sales/contracts/${contractId}/obligations/${obligationId}`, { ...changes, organizationId }).then((r) => r.data);
export const completeObligation = (organizationId, contractId, obligationId, payload) => client.post(`/sales/contracts/${contractId}/obligations/${obligationId}/complete`, { ...payload, organizationId }).then((r) => r.data);
export const waiveObligation = (organizationId, contractId, obligationId, reason) => client.post(`/sales/contracts/${contractId}/obligations/${obligationId}/waive`, { organizationId, reason }).then((r) => r.data);

// --- Reports (forecast/summary) ---
export const getPipelineSummary = (organizationId, params) => client.get("/sales/reports/pipeline-summary", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getForecast = (organizationId) => client.get("/sales/reports/forecast", { params: withOrg(organizationId) }).then((r) => r.data);

export default client;
