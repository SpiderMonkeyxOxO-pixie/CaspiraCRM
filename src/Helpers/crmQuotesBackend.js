// Backend-mode data source for the Quotes pages (VITE_BACKEND_CRM_SALES_MODE=true).
// The UI keeps one `approval` object per quote; the backend keeps each
// approval request as a SalesApproval row, so the object is rebuilt from
// those rows. Totals always come from the server's calculation.
import * as sales from "./backendSalesClient";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "./backendCrmClient";
import { orgId, ownersMap, ownerFields, listAll, newIdempotencyKey } from "./crmBackendCommon";

export const BACKEND_ENABLED = BACKEND_CRM_SALES_MODE_ENABLED;

const num = (v) => (v == null ? v : Number(v));

function toUiLineItem(line) {
  return {
    ...line,
    sku: line.skuSnapshot ?? null,
    quantity: num(line.quantity),
    listPrice: num(line.listPrice),
    priceBookPrice: num(line.priceBookPrice),
    unitPrice: num(line.unitPrice),
    discountValue: num(line.discountValue),
    lineSubtotal: num(line.lineSubtotal),
    taxAmount: num(line.taxAmount),
    lineTotal: num(line.lineTotal),
  };
}

const DECISION_TYPE = { Approved: "Approve", Rejected: "Reject", "Changes Requested": "Request Changes" };
const NO_APPROVAL = { required: false, requestedBy: null, requestedAt: null, reviewerId: null, reviewerName: null, reason: null, status: "Not Required", comments: [] };

// Latest approval request drives the status; every decided request adds a
// comment, oldest first, so the review history reads like the mock's.
export function toUiApproval(approvals = [], ownersById = new Map()) {
  if (!approvals.length) return NO_APPROVAL;
  const sorted = [...approvals].sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));
  const latest = sorted[sorted.length - 1];
  const nameOf = (id) => ownersById.get(id)?.name || (id ? "Member" : null);
  return {
    required: true,
    requestedBy: nameOf(latest.requestedByMembershipId),
    requestedAt: latest.requestedAt,
    reviewerId: latest.decidedByMembershipId || null,
    reviewerName: nameOf(latest.decidedByMembershipId),
    reason: latest.reason || null,
    status: latest.status,
    comments: sorted
      .filter((a) => a.decidedAt)
      .map((a) => ({ author: nameOf(a.decidedByMembershipId), at: a.decidedAt, text: a.decisionReason || "", type: DECISION_TYPE[a.status] || a.status })),
  };
}

export function toUiQuote(quote, ownersById = new Map()) {
  if (!quote) return quote;
  return {
    ...quote,
    ...ownerFields(quote, ownersById),
    supersededBy: quote.supersededByQuoteId || null,
    lineItems: (quote.lineItems || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(toUiLineItem),
    approval: toUiApproval(quote.approvals || [], ownersById),
    subtotal: num(quote.subtotal),
    discountTotal: num(quote.discountTotal),
    taxTotal: num(quote.taxTotal),
    grandTotal: num(quote.grandTotal),
    files: [],
    auditLog: [],
  };
}

const NOT_SENT = new Set([
  "approval", "sendPreview", "customerResponse", "supersededBy", "files", "auditLog", "activity", "ownerName", "status",
  "subtotal", "discountTotal", "taxTotal", "grandTotal", "effectiveStatus", "archived", "archiveReason", "archivedAt",
]);

export function toApiQuote(payload = {}) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (NOT_SENT.has(key)) continue;
    if (key === "ownerId") out.ownerMembershipId = value || null;
    else if (key === "lineItems") out.lineItems = (value || []).map((l, i) => ({ ...l, order: l.order ?? i }));
    else out[key] = value;
  }
  return out;
}

export async function listQuotes() {
  const organizationId = orgId();
  const owners = await ownersMap();
  const fetchAll = (archived) =>
    listAll(async (page, pageSize) => {
      const { quotes, total } = await sales.listQuotes(organizationId, { page, pageSize, archived });
      return { items: quotes || [], total };
    });
  const [active, archived] = await Promise.all([fetchAll("false"), fetchAll("true")]);
  return [...active, ...archived].map((q) => toUiQuote(q, owners));
}

export async function getQuote(id) {
  const [{ quote }, owners] = await Promise.all([sales.getQuote(orgId(), id), ownersMap()]);
  return toUiQuote(quote, owners);
}

// Each workflow call returns the bare quote; re-read it so the UI gets the
// full record (line items and approval history included).
const then = (promise, id) => promise.then(() => getQuote(id));

export async function createQuote(payload) {
  const { quote } = await sales.createQuote(orgId(), toApiQuote(payload));
  return getQuote(quote._id);
}

export const updateQuote = (id, changes) => then(sales.updateQuote(orgId(), id, toApiQuote(changes)), id);
export const archiveQuote = (id, reason) => then(sales.archiveQuote(orgId(), id, reason), id);
export const restoreQuote = (id) => then(sales.restoreQuote(orgId(), id), id);
export const submitForReview = (id) => then(sales.submitQuote(orgId(), id, newIdempotencyKey(`submit-${id}`)), id);
export const approveReview = (id, comment) => then(sales.approveQuote(orgId(), id, newIdempotencyKey(`approve-${id}`), comment), id);
export const rejectReview = (id, comment) => then(sales.rejectQuote(orgId(), id, comment), id);
export const requestReviewChanges = (id, comment) => then(sales.rejectQuote(orgId(), id, comment, true), id);
export const cancelQuote = (id, reason) => then(sales.cancelQuote(orgId(), id, reason), id);
export const previewSend = (id, sendDetails) => then(sales.issueQuote(orgId(), id, sendDetails), id);

export function customerResponse(id, type, details = {}) {
  if (type === "Accepted") return then(sales.acceptQuote(orgId(), id, details), id);
  if (type === "Rejected") return then(sales.rejectQuoteByCustomer(orgId(), id, details), id);
  return then(sales.recordQuoteCustomerResponse(orgId(), id, type, details), id);
}

export async function createNewVersion(id, payload) {
  const { quote } = await sales.createQuoteVersion(orgId(), id, toApiQuote(payload));
  const [newQuote, previous] = await Promise.all([getQuote(quote._id), getQuote(id)]);
  return { quote: newQuote, previous };
}

async function bulk(payload) {
  await sales.bulkQuotes(orgId(), payload);
  return Promise.all(payload.ids.map((id) => getQuote(id).catch(() => null))).then((list) => list.filter(Boolean));
}

export const bulkAssignQuotes = (ids, ownerId) => bulk({ action: "assign", ids, ownerMembershipId: ownerId });
export const bulkArchiveQuotes = (ids, reason) => bulk({ action: "archive", ids, reason });
