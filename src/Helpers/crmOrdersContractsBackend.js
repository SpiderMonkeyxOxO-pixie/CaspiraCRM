// Backend-mode data source for the Orders and Contracts pages
// (VITE_BACKEND_CRM_SALES_MODE=true). Both UIs keep the whole list in the
// store and filter client-side, so lists load every record. Totals and
// contract value always come from the server's calculation.
import * as sales from "./backendSalesClient";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "./backendCrmClient";
import { orgId, ownersMap, ownerFields, listAll, newIdempotencyKey } from "./crmBackendCommon";

export const BACKEND_ENABLED = BACKEND_CRM_SALES_MODE_ENABLED;

const num = (v) => (v == null ? v : Number(v));
const MONEY_LINE_FIELDS = ["quantity", "listPriceSnapshot", "priceBookPriceSnapshot", "unitPrice", "discountValue", "lineSubtotal", "taxAmount", "lineTotal", "quantityFulfilled", "completionPercentage"];

function toUiLine(line) {
  const ui = { ...line };
  for (const f of MONEY_LINE_FIELDS) if (f in ui) ui[f] = num(ui[f]);
  if ("fulfillmentNotes" in ui) ui.fulfillmentNotes = Array.isArray(ui.fulfillmentNotes) ? ui.fulfillmentNotes : [];
  return ui;
}

const sortLines = (lines = []) => [...lines].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(toUiLine);

// Fields the UI carries that are derived, or changed only by lifecycle actions.
const NOT_SENT = new Set([
  "status", "ownerName", "files", "auditLog", "activity", "archived", "archiveReason", "archivedAt", "statusBeforeArchive",
  "subtotal", "discountTotal", "taxTotal", "grandTotal", "contractValue", "confirmedDate", "cancellationReason", "holdReason",
  "holdReviewDate", "invoiceRequestedAt", "signatories", "sentForSignatureAt", "signedAt", "terminationReason", "amendmentHistory",
  "obligations", "renewalReviews", "orderNumber", "contractNumber", "sourceQuoteId", "sourceOrderId",
]);

function toApi(payload = {}) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (NOT_SENT.has(key)) continue;
    if (key === "ownerId") out.ownerMembershipId = value || null;
    else if (key === "lineItems") out.lineItems = (value || []).map((l, i) => ({ ...l, order: l.order ?? i }));
    else out[key] = value;
  }
  return out;
}

async function loadAll(listPage, key) {
  const organizationId = orgId();
  const fetchAll = (archived) =>
    listAll(async (page, pageSize) => {
      const data = await listPage(organizationId, { page, pageSize, archived });
      return { items: data[key] || [], total: data.total };
    });
  const [active, archived] = await Promise.all([fetchAll("false"), fetchAll("true")]);
  return [...active, ...archived];
}

// --- Orders ---

export function toUiOrder(order, ownersById = new Map()) {
  if (!order) return order;
  return {
    ...order,
    ...ownerFields(order, ownersById),
    lineItems: sortLines(order.lineItems),
    subtotal: num(order.subtotal),
    discountTotal: num(order.discountTotal),
    taxTotal: num(order.taxTotal),
    grandTotal: num(order.grandTotal),
    files: Array.isArray(order.files) ? order.files : [],
    auditLog: [],
  };
}

export const toApiOrder = toApi;

export async function listOrders() {
  const [orders, owners] = await Promise.all([loadAll(sales.listOrders, "orders"), ownersMap()]);
  return orders.map((o) => toUiOrder(o, owners));
}

export async function getOrder(id) {
  const [{ order }, owners] = await Promise.all([sales.getOrder(orgId(), id), ownersMap()]);
  return toUiOrder(order, owners);
}

const refreshOrder = (promise, id) => promise.then(() => getOrder(id));

export async function createOrder(payload) {
  const { order } = await sales.createOrder(orgId(), toApiOrder(payload));
  return getOrder(order._id);
}

export const updateOrder = (id, changes) => refreshOrder(sales.updateOrder(orgId(), id, toApiOrder(changes)), id);
export const archiveOrder = (id, reason) => refreshOrder(sales.archiveOrder(orgId(), id, reason), id);
export const restoreOrder = (id) => refreshOrder(sales.restoreOrder(orgId(), id), id);
export const submitOrderForReview = (id) => refreshOrder(sales.submitOrder(orgId(), id), id);
export const confirmOrder = (id, { confirmedDate, ownerId, internalNote } = {}) =>
  refreshOrder(sales.confirmOrder(orgId(), id, newIdempotencyKey(`confirm-${id}`), { confirmedDate, ownerMembershipId: ownerId || undefined, internalNote }), id);

// "Start processing" can also hand the order to a new owner.
export async function startProcessing(id, { ownerId } = {}) {
  if (ownerId) await sales.updateOrder(orgId(), id, { ownerMembershipId: ownerId });
  return refreshOrder(sales.markOrderInProgress(orgId(), id), id);
}

export async function putOnHold(id, { reason, holdReviewDate, ownerId } = {}) {
  if (ownerId) await sales.updateOrder(orgId(), id, { ownerMembershipId: ownerId });
  return refreshOrder(sales.holdOrder(orgId(), id, reason, holdReviewDate), id);
}

export const resumeOrder = (id, { targetStatus } = {}) => refreshOrder(sales.resumeOrder(orgId(), id, targetStatus), id);
export const cancelOrder = (id, { reason } = {}) => refreshOrder(sales.cancelOrder(orgId(), id, reason), id);
export const markFulfilled = (id) => refreshOrder(sales.markOrderFulfilled(orgId(), id), id);
export const markCompleted = (id) => refreshOrder(sales.completeOrder(orgId(), id), id);
export const requestInvoice = (id) => refreshOrder(sales.requestOrderInvoice(orgId(), id), id);
export const updateLineFulfillment = (id, lineId, changes) => refreshOrder(sales.updateOrderLineFulfillment(orgId(), id, lineId, changes), id);

async function bulkOrders(payload) {
  await sales.bulkOrders(orgId(), payload);
  return Promise.all(payload.ids.map((id) => getOrder(id).catch(() => null))).then((list) => list.filter(Boolean));
}

export const bulkAssignOrders = (ids, ownerId) => bulkOrders({ action: "assign", ids, ownerMembershipId: ownerId });
export const bulkArchiveOrders = (ids, reason) => bulkOrders({ action: "archive", ids, reason });

// --- Contracts ---

function signatories(contract) {
  const party = (name, title, signedAt) => (name || signedAt ? { name: name || "", title: title || "", signedAt: signedAt || null } : null);
  return {
    internal: party(contract.internalSignatoryName, contract.internalSignatoryTitle, contract.internalSignedAt),
    customer: party(contract.customerSignatoryName, contract.customerSignatoryTitle, contract.customerSignedAt),
  };
}

export function toUiContract(contract, ownersById = new Map()) {
  if (!contract) return contract;
  const nameOf = (id) => ownersById.get(id)?.name || (id ? "Member" : "System");
  return {
    ...contract,
    ...ownerFields(contract, ownersById),
    lineItems: sortLines(contract.lineItems),
    contractValue: num(contract.contractValue),
    signatories: signatories(contract),
    amendmentHistory: (Array.isArray(contract.amendmentHistory) ? contract.amendmentHistory : []).map((a, i) => ({
      _id: a._id || `${contract._id}-amendment-${i}`,
      ...a,
      actor: a.actor || nameOf(a.actorMembershipId),
    })),
    obligations: contract.obligations || [],
    renewalReviews: contract.renewalReviews || [],
    files: Array.isArray(contract.files) ? contract.files : [],
    auditLog: [],
  };
}

export const toApiContract = toApi;

export async function listContracts() {
  const [contracts, owners] = await Promise.all([loadAll(sales.listContracts, "contracts"), ownersMap()]);
  return contracts.map((c) => toUiContract(c, owners));
}

export async function getContract(id) {
  const [{ contract }, owners] = await Promise.all([sales.getContract(orgId(), id), ownersMap()]);
  return toUiContract(contract, owners);
}

const refreshContract = (promise, id) => promise.then(() => getContract(id));

export async function createContract(payload) {
  const { contract } = await sales.createContract(orgId(), toApiContract(payload));
  return getContract(contract._id);
}

export const updateContract = (id, changes) => refreshContract(sales.updateContract(orgId(), id, toApiContract(changes)), id);
export const archiveContract = (id, reason) => refreshContract(sales.archiveContract(orgId(), id, reason), id);
export const restoreContract = (id) => refreshContract(sales.restoreContract(orgId(), id), id);
export const submitForInternalReview = (id) => refreshContract(sales.submitContract(orgId(), id), id);
export const sendForSignature = (id, { sentAt } = {}) => refreshContract(sales.approveContract(orgId(), id, sentAt), id);
export const recordSignature = (id, { party, name, title, signedAt }) => refreshContract(sales.recordContractSignature(orgId(), id, { party, name, title, signedAt }), id);
export const renewContract = (id, { newEndDate, note }) => refreshContract(sales.renewContract(orgId(), id, newEndDate, note), id);
export const terminateContract = (id, { reason, effectiveDate }) => refreshContract(sales.terminateContract(orgId(), id, reason, effectiveDate), id);
export const cancelContract = (id, { reason }) => refreshContract(sales.cancelContract(orgId(), id, reason), id);
export const expireContract = (id) => refreshContract(sales.expireContract(orgId(), id), id);

async function bulkContracts(payload) {
  await sales.bulkContracts(orgId(), payload);
  return Promise.all(payload.ids.map((id) => getContract(id).catch(() => null))).then((list) => list.filter(Boolean));
}

export const bulkAssignContracts = (ids, ownerId) => bulkContracts({ action: "assign", ids, ownerMembershipId: ownerId });
export const bulkArchiveContracts = (ids, reason) => bulkContracts({ action: "archive", ids, reason });
