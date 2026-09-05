// In-memory mock Orders module — a frontend-only Order management workspace
// built entirely on the shared Companies/Contacts/Deals/Quotes/Products/
// Price Books data. Same pattern as every other mock*Data.js module: plain
// mutable arrays and business-logic functions instead of a real backend,
// reset on a full page reload.
//
// An Order line item is a frozen PRICING SNAPSHOT, not a live reference —
// unlike a Price Book pricing rule (which never snapshots) or even a Quote
// line (which snapshots but is still shown alongside its live catalogItemId
// for context), an Order line's unitPrice/discount/tax are captured once at
// creation and never recomputed, so a later catalog, Price Book or Quote
// edit can never silently change an existing Order.
import { faker } from "@faker-js/faker";
import { CRM_TEAM, findTeamMember } from "./mockUsersData";
import { findCatalogItem, ACTIVE_ONE_TIME_PRODUCT, ACTIVE_RECURRING_SERVICE, ANNUAL_SUBSCRIPTION_SERVICE, USAGE_BASED_SERVICE, TIERED_PRICING_PRODUCT } from "./mockCatalogData";
import { companies, contacts, deals, findCompany, findContact, findDeal } from "./mockCrmData";
import { findQuoteRecord, TAX_RATE_PREVIEW, PREVIEW_ACCEPTED_QUOTE } from "./mockQuoteData";

const id = () => faker.database.mongodbObjectId();
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------
export const ORDER_TYPES = ["Product Order", "Service Order", "Mixed Order"];
// "Archived" is listed as a status value (unlike Quotes/Price Books, where
// archiving is a separate flag) — internally we still track archived/
// statusBeforeArchive so Restore has something to return to, and
// getEffectiveStatus() surfaces "Archived" whenever the flag is set.
export const ORDER_STATUSES = [
  "Draft", "Pending Review", "Confirmed", "Processing", "Partially Fulfilled",
  "Fulfilled", "On Hold", "Cancelled", "Completed", "Archived",
];
export const SETTABLE_STATUSES = ORDER_STATUSES.filter((s) => s !== "Archived");
export const PAYMENT_TERMS_OPTIONS = ["Due on Receipt", "Net 15", "Net 30", "Net 45", "Net 60", "50% Upfront, 50% on Delivery"];
export const BILLING_SCHEDULES = ["One-time billing", "Monthly billing", "Quarterly billing", "Annual billing", "Milestone billing"];
export const DELIVERY_STATUSES = ["Not Started", "Partial", "Delivered"];
export const SETUP_STATUSES = ["Not Started", "In Progress", "Complete"];
export const ACTIVATION_STATUSES = ["Not Started", "Active"];
export const DISCOUNT_TYPES = ["Percentage", "Fixed Amount"];
export const OVERDUE_REQUESTED_DAYS_PAST = 0; // any requested date strictly before today counts as overdue
export const RELATED_RECORD_PREVIEWS = ["Future Project preview", "Future Invoice preview"];

let orderCounter = 1000;
function nextOrderNumber() { return `O-PREVIEW-${++orderCounter}`; }

function orderActivityEntry(type, actor, description, meta = {}) {
  return { _id: id(), type, actor: actor || "System", at: new Date().toISOString(), description, meta };
}
function orderAuditEntry(action, actor, { field, before, after, reason } = {}) {
  return { _id: id(), action, actor: actor || "System", at: new Date().toISOString(), field: field || null, before: before ?? null, after: after ?? null, reason: reason || null };
}

// ---------------------------------------------------------------------------
// Line items — frozen pricing snapshots.
// ---------------------------------------------------------------------------
export function makeOrderLine(overrides = {}) {
  const catalogItem = overrides.catalogItemId ? findCatalogItem(overrides.catalogItemId) : null;
  const lineKind = overrides.lineKind || (catalogItem?.type === "Service" ? "Service" : "Product");
  const quantity = overrides.quantity ?? 1;
  return {
    _id: overrides._id || id(),
    catalogItemId: overrides.catalogItemId || null,
    isCustomLine: overrides.isCustomLine ?? !overrides.catalogItemId,
    lineKind,
    name: overrides.name || catalogItem?.name || "Custom line",
    description: overrides.description ?? catalogItem?.shortDescription ?? "",
    unit: overrides.unit || catalogItem?.unit || "Each",
    billingModel: overrides.billingModel || catalogItem?.billingModel || "One Time",
    billingInterval: overrides.billingInterval !== undefined ? overrides.billingInterval : (catalogItem?.billingInterval ?? null),
    quantity,
    // Frozen snapshot fields — never re-resolved after creation.
    listPriceSnapshot: overrides.listPriceSnapshot ?? catalogItem?.standardPrice ?? null,
    priceBookIdUsed: overrides.priceBookIdUsed ?? null,
    priceBookPriceSnapshot: overrides.priceBookPriceSnapshot ?? null,
    unitPrice: overrides.unitPrice ?? (overrides.priceBookPriceSnapshot ?? catalogItem?.standardPrice ?? 0),
    discountType: overrides.discountType ?? null,
    discountValue: overrides.discountValue ?? null,
    taxCategory: overrides.taxCategory || catalogItem?.taxCategory || "Standard",
    order: overrides.order ?? 0,
    // Fulfillment state
    quantityFulfilled: overrides.quantityFulfilled ?? 0,
    deliveryStatus: overrides.deliveryStatus || "Not Started",
    requestedDeliveryDate: overrides.requestedDeliveryDate || null,
    completedDate: overrides.completedDate || null,
    deliveryReferencePreview: overrides.deliveryReferencePreview || null,
    serviceStartDate: overrides.serviceStartDate || null,
    responsibleOwnerId: overrides.responsibleOwnerId || null,
    responsibleOwnerName: overrides.responsibleOwnerName || null,
    setupStatus: overrides.setupStatus || "Not Started",
    activationStatus: overrides.activationStatus || "Not Started",
    completionPercentage: overrides.completionPercentage ?? 0,
    nextMilestone: overrides.nextMilestone || "",
    fulfillmentNotes: overrides.fulfillmentNotes || [],
  };
}

export function computeLineSubtotal(line) {
  return (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
}
export function computeLineDiscountAmount(line) {
  const subtotal = computeLineSubtotal(line);
  if (!line.discountType || !line.discountValue) return 0;
  return line.discountType === "Percentage" ? subtotal * (Number(line.discountValue) / 100) : Number(line.discountValue);
}
export function computeLineTotal(line) {
  return computeLineSubtotal(line) - computeLineDiscountAmount(line);
}

// Fulfillment progress for a single line — quantity-based for Product lines,
// milestone-based for Service lines. Always clamped to [0, 100].
export function computeLineProgress(line) {
  if (line.lineKind === "Service") return Math.max(0, Math.min(100, Number(line.completionPercentage) || 0));
  const ordered = Number(line.quantity) || 0;
  if (ordered <= 0) return 0;
  return Math.max(0, Math.min(100, (Number(line.quantityFulfilled) || 0) / ordered * 100));
}

// Order-level progress is a simple, honestly-labeled unweighted average of
// each line's own progress — not weighted by value, so a Mixed Order's
// number is easy to explain to a user (see ORDER_PROGRESS_EXPLANATION).
export const ORDER_PROGRESS_EXPLANATION = "Fulfillment progress is the average of each line item's own progress (quantity delivered ÷ quantity ordered for Product lines, completion percentage for Service lines) — not weighted by line value.";
export function computeOrderProgress(order) {
  const lines = order.lineItems || [];
  if (lines.length === 0) return 0;
  const total = lines.reduce((sum, l) => sum + computeLineProgress(l), 0);
  return Math.round((total / lines.length) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Order-level totals — always computed from the frozen line snapshots.
// ---------------------------------------------------------------------------
export function computeOrderTotals(order) {
  const lines = order.lineItems || [];
  let oneTimeTotal = 0, monthlyRecurringTotal = 0, annualRecurringTotal = 0, otherRecurringTotal = 0, usageBasedEstimate = 0, subtotal = 0;
  for (const line of lines) {
    const lineTotal = computeLineTotal(line);
    subtotal += lineTotal;
    if (line.billingModel === "Recurring") {
      if (line.billingInterval === "Monthly") monthlyRecurringTotal += lineTotal;
      else if (line.billingInterval === "Annual") annualRecurringTotal += lineTotal;
      else otherRecurringTotal += lineTotal;
    } else if (line.billingModel === "Usage Based") usageBasedEstimate += lineTotal;
    else oneTimeTotal += lineTotal;
  }
  let tax = 0;
  for (const line of lines) tax += computeLineTotal(line) * (TAX_RATE_PREVIEW[line.taxCategory] ?? 0);
  const recurringTotal = monthlyRecurringTotal + annualRecurringTotal + otherRecurringTotal;
  const grandTotal = subtotal + tax;
  return {
    subtotal: round2(subtotal), tax: round2(tax), grandTotal: round2(grandTotal),
    oneTimeTotal: round2(oneTimeTotal), recurringTotal: round2(recurringTotal),
    monthlyRecurringTotal: round2(monthlyRecurringTotal), annualRecurringTotal: round2(annualRecurringTotal),
    otherRecurringTotal: round2(otherRecurringTotal), usageBasedEstimate: round2(usageBasedEstimate),
  };
}

// ---------------------------------------------------------------------------
// Status derivation / metrics helpers
// ---------------------------------------------------------------------------
export function getEffectiveStatus(order) {
  return order.archived ? "Archived" : order.status;
}
export function isOverdueRequestedDate(order) {
  const status = getEffectiveStatus(order);
  if (["Fulfilled", "Completed", "Cancelled", "Archived"].includes(status)) return false;
  return !!order.requestedDate && new Date(order.requestedDate) < new Date();
}
export function isAwaitingBillingHandoff(order) {
  return ["Fulfilled", "Completed"].includes(getEffectiveStatus(order)) && !order.invoiceRequestedAt;
}
export function hasIncompleteAddress(order) {
  if (order.orderType === "Service Order") return false;
  const a = order.serviceAddress || {};
  return !a.line1 || !a.city || !a.postalCode || !a.country;
}
export function deriveOrderType(lineItems) {
  const kinds = new Set((lineItems || []).map((l) => l.lineKind));
  if (kinds.size === 0) return "Product Order";
  if (kinds.size > 1) return "Mixed Order";
  return kinds.has("Service") ? "Service Order" : "Product Order";
}

// ---------------------------------------------------------------------------
// Order builder
// ---------------------------------------------------------------------------
function makeOrder(overrides = {}) {
  const owner = overrides.ownerId === null ? null : findTeamMember(overrides.ownerId) || faker.helpers.arrayElement(CRM_TEAM);
  const createdAt = overrides.createdAt || faker.date.past({ years: 1 }).toISOString();
  const lineItems = (overrides.lineItems || []).map((l, i) => makeOrderLine({ ...l, order: l.order ?? i }));
  const base = {
    _id: id(), orderNumber: overrides.orderNumber || nextOrderNumber(),
    orderType: overrides.orderType || deriveOrderType(lineItems),
    companyId: overrides.companyId || null, contactId: overrides.contactId || null, dealId: overrides.dealId || null,
    sourceQuoteId: overrides.sourceQuoteId || null, sourceQuoteVersion: overrides.sourceQuoteVersion ?? null,
    ownerId: owner?.id || null, ownerName: owner?.name || null, assignedTeam: overrides.assignedTeam || "Sales",
    currency: overrides.currency || "USD", status: overrides.status || "Draft",
    orderDate: overrides.orderDate || daysAgo(0),
    requestedDate: overrides.requestedDate !== undefined ? overrides.requestedDate : daysFromNow(14),
    confirmedDate: overrides.confirmedDate ?? null,
    lineItems,
    paymentTerms: overrides.paymentTerms || "Net 30", billingSchedule: overrides.billingSchedule || "One-time billing",
    billingContactId: overrides.billingContactId ?? overrides.contactId ?? null,
    billingAddress: overrides.billingAddress || null,
    serviceAddress: overrides.serviceAddress !== undefined ? overrides.serviceAddress : {
      line1: "500 Market Street", city: "San Francisco", state: "CA", postalCode: "94105", country: "United States",
    },
    deliveryInstructions: overrides.deliveryInstructions || "", serviceStartInstructions: overrides.serviceStartInstructions || "",
    customerReference: overrides.customerReference || "", internalNote: overrides.internalNote || "", customerNote: overrides.customerNote || "",
    cancellationReason: overrides.cancellationReason || null, cancellationEffectiveDate: overrides.cancellationEffectiveDate || null,
    holdReason: overrides.holdReason || null, holdReviewDate: overrides.holdReviewDate || null,
    invoiceRequestedAt: overrides.invoiceRequestedAt || null,
    files: overrides.files || [], auditLog: [],
    archived: overrides.archived ?? false, archiveReason: overrides.archiveReason || null, archivedAt: overrides.archivedAt || null, statusBeforeArchive: overrides.statusBeforeArchive || null,
    createdBy: overrides.createdBy || "System", updatedBy: overrides.updatedBy || "System",
    createdAt, updatedAt: overrides.updatedAt || createdAt,
  };
  base.activity = overrides.activity || [orderActivityEntry("created", base.createdBy, `Order ${base.orderNumber} created`)];
  return base;
}

// A pure preview — builds a would-be Order from a Quote WITHOUT saving it or
// mutating the Quote. Snapshots line items at the moment of copy; never
// dynamically inherits later Quote changes.
export function buildOrderFromQuotePreview(quoteId) {
  const quote = findQuoteRecord(quoteId);
  if (!quote) return null;
  return {
    companyId: quote.companyId, contactId: quote.primaryContactId, dealId: quote.dealId,
    sourceQuoteId: quote._id, sourceQuoteVersion: quote.version,
    ownerId: quote.ownerId, assignedTeam: quote.assignedTeam, currency: quote.currency,
    paymentTerms: quote.paymentTerms, billingSchedule: quote.billingSchedule,
    customerNote: quote.customerNote, internalNote: "",
    requestedDate: quote.serviceStartEstimate ? null : daysFromNow(14),
    lineItems: (quote.lineItems || []).filter((l) => l.included !== false).map((l) => ({
      catalogItemId: l.catalogItemId, isCustomLine: l.isCustomLine, name: l.name, description: l.description,
      unit: l.unit, billingModel: l.billingModel, billingInterval: l.billingInterval, quantity: l.quantity,
      listPriceSnapshot: l.listPrice, priceBookIdUsed: l.priceBookIdUsed, priceBookPriceSnapshot: l.priceBookPrice,
      unitPrice: l.unitPrice, discountType: l.discountType, discountValue: l.discountValue, taxCategory: l.taxCategory,
    })),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export function validateOrderPayload(payload) {
  const errors = {};
  const warnings = {};

  if (!payload.companyId) errors.companyId = "Company is required";
  if (payload.contactId) {
    const contact = findContact(payload.contactId);
    if (contact && contact.companyId !== payload.companyId) warnings.contactId = "This contact doesn't belong to the selected Company — confirm before continuing.";
  }
  if (!payload.currency) errors.currency = "Currency is required";
  if (!(payload.lineItems || []).length) errors.lineItems = "Add at least one line item";

  (payload.lineItems || []).forEach((line, idx) => {
    const label = line.name || `Line ${idx + 1}`;
    if (!(Number(line.quantity) > 0)) errors[`line_${idx}_quantity`] = `"${label}" needs a positive quantity`;
    if (line.unitPrice === "" || line.unitPrice === null || line.unitPrice === undefined || Number.isNaN(Number(line.unitPrice))) {
      errors[`line_${idx}_price`] = `"${label}" needs a valid price`;
    }
    if (line.billingModel === "Recurring" && !line.billingInterval) errors[`line_${idx}_interval`] = `"${label}" needs a billing interval`;
  });

  if (payload.orderType !== "Service Order" && hasIncompleteAddress(payload)) {
    errors.serviceAddress = "A complete delivery address (street, city, postal code, country) is required for Product/Mixed Orders";
  }
  if ((payload.orderType === "Service Order" || payload.orderType === "Mixed Order") && !payload.serviceStartInstructions?.trim()) {
    warnings.serviceStartInstructions = "Service-start instructions are recommended for Service/Mixed Orders";
  }
  if (!payload.billingContactId) warnings.billingContactId = "No billing contact selected — defaulting to the primary contact";
  if (!payload.paymentTerms) errors.paymentTerms = "Payment terms are required";
  if (!payload.requestedDate) warnings.requestedDate = "No requested start/delivery date set";

  if (payload.sourceQuoteId) {
    const quote = findQuoteRecord(payload.sourceQuoteId);
    if (quote && quote.currency !== payload.currency) errors.currency = `Source Quote is priced in ${quote.currency}, not the Order's currency (${payload.currency})`;
  }

  const totals = computeOrderTotals(payload);
  if (totals.grandTotal < 0) warnings.grandTotal = "The grand total is negative";

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export function createOrder(payload, actor = "System") {
  const order = makeOrder({ ...payload, createdBy: actor, updatedBy: actor, createdAt: new Date().toISOString() });
  orders.unshift(order);
  return order;
}

export function findOrderRecord(orderId) {
  return orders.find((o) => o._id === orderId);
}
export function ordersForQuote(quoteId) {
  return orders.filter((o) => o.sourceQuoteId === quoteId);
}
export function ordersForDeal(dealId) {
  return orders.filter((o) => o.dealId === dealId);
}
export function ordersForCompany(companyId) {
  return orders.filter((o) => o.companyId === companyId);
}

const AUDIT_TRACKED_FIELDS = ["status", "ownerId", "requestedDate", "confirmedDate"];

export function updateOrder(orderId, changes, actor = "System") {
  const order = findOrderRecord(orderId);
  if (!order) return null;
  if (changes.ownerId !== undefined && changes.ownerId !== order.ownerId) {
    const newOwner = findTeamMember(changes.ownerId);
    changes.ownerName = newOwner?.name || null;
  }
  if (changes.status && changes.status !== order.status) {
    order.activity.push(orderActivityEntry("status_changed", actor, `Status changed from ${order.status} to ${changes.status}`));
  }
  if (changes.lineItems && JSON.stringify(changes.lineItems) !== JSON.stringify(order.lineItems)) {
    order.activity.push(orderActivityEntry("line_items_changed", actor, "Line items changed"));
    changes.lineItems = changes.lineItems.map((l) => makeOrderLine(l));
  }
  for (const field of AUDIT_TRACKED_FIELDS) {
    if (field in changes && changes[field] !== order[field]) {
      order.auditLog.push(orderAuditEntry("update", actor, { field, before: order[field] ?? null, after: changes[field] ?? null, reason: changes.reason || null }));
    }
  }
  Object.assign(order, changes);
  order.updatedAt = new Date().toISOString();
  order.updatedBy = actor;
  return order;
}

export function archiveOrder(orderId, reason, actor = "System") {
  const order = findOrderRecord(orderId);
  if (!order) return null;
  order.statusBeforeArchive = order.status;
  order.archived = true;
  order.archiveReason = reason;
  order.archivedAt = new Date().toISOString();
  order.activity.push(orderActivityEntry("archived", actor, `Archived: ${reason}`));
  order.auditLog.push(orderAuditEntry("archive", actor, { field: "archived", before: false, after: true, reason }));
  order.updatedAt = new Date().toISOString();
  order.updatedBy = actor;
  return order;
}
export function restoreOrder(orderId, actor = "System") {
  const order = findOrderRecord(orderId);
  if (!order) return null;
  order.status = order.statusBeforeArchive || "Draft";
  order.archived = false;
  order.archiveReason = null;
  order.archivedAt = null;
  order.statusBeforeArchive = null;
  order.activity.push(orderActivityEntry("restored", actor, "Restored from archive"));
  order.auditLog.push(orderAuditEntry("restore", actor, { field: "archived", before: true, after: false }));
  order.updatedAt = new Date().toISOString();
  order.updatedBy = actor;
  return order;
}
export function bulkAssignOwner(orderIds, ownerId, actor = "System") {
  return orderIds.map((oid) => updateOrder(oid, { ownerId }, actor)).filter(Boolean);
}
export function bulkArchive(orderIds, reason, actor = "System") {
  return orderIds.map((oid) => archiveOrder(oid, reason, actor)).filter(Boolean);
}

export function buildOrderDuplicatePreview(orderId) {
  const source = findOrderRecord(orderId);
  if (!source) return null;
  return {
    ...source, _id: undefined, orderNumber: undefined, status: "Draft",
    confirmedDate: null, cancellationReason: null, cancellationEffectiveDate: null, holdReason: null, holdReviewDate: null,
    invoiceRequestedAt: null, archived: false, archiveReason: null, archivedAt: null, statusBeforeArchive: null,
    activity: [], auditLog: [], files: [], createdAt: undefined, updatedAt: undefined,
    lineItems: source.lineItems.map((l) => ({ ...l, _id: undefined, quantityFulfilled: 0, deliveryStatus: "Not Started", completedDate: null, setupStatus: "Not Started", activationStatus: "Not Started", completionPercentage: 0 })),
  };
}

// ---------------------------------------------------------------------------
// Status transitions — frontend previews only, each requiring the fields
// named in the spec before the transition is recorded.
// ---------------------------------------------------------------------------
export function submitForReview(orderId, actor = "System") {
  const order = findOrderRecord(orderId);
  if (!order) return null;
  order.status = "Pending Review";
  order.activity.push(orderActivityEntry("review_submitted", actor, "Submitted for review"));
  order.updatedAt = new Date().toISOString(); order.updatedBy = actor;
  return order;
}
export function confirmOrder(orderId, { confirmedDate, ownerId, internalNote }, actor = "System") {
  const order = findOrderRecord(orderId);
  if (!order) return null;
  order.status = "Confirmed";
  order.confirmedDate = confirmedDate || new Date().toISOString();
  if (ownerId) { order.ownerId = ownerId; order.ownerName = findTeamMember(ownerId)?.name || order.ownerName; }
  if (internalNote) order.internalNote = internalNote;
  order.activity.push(orderActivityEntry("confirmed", actor, `Confirmed for ${order.confirmedDate ? new Date(order.confirmedDate).toLocaleDateString() : "an unspecified date"}`));
  order.updatedAt = new Date().toISOString(); order.updatedBy = actor;
  return order;
}
export function startProcessing(orderId, { ownerId, startDate, note }, actor = "System") {
  const order = findOrderRecord(orderId);
  if (!order) return null;
  order.status = "Processing";
  if (ownerId) { order.ownerId = ownerId; order.ownerName = findTeamMember(ownerId)?.name || order.ownerName; }
  order.activity.push(orderActivityEntry("processing_started", actor, note ? `Processing started: ${note}` : `Processing started${startDate ? ` on ${new Date(startDate).toLocaleDateString()}` : ""}`));
  order.updatedAt = new Date().toISOString(); order.updatedBy = actor;
  return order;
}
export function putOnHold(orderId, { reason, reviewDate, ownerId }, actor = "System") {
  if (!reason?.trim()) return null;
  const order = findOrderRecord(orderId);
  if (!order) return null;
  order.status = "On Hold";
  order.holdReason = reason;
  order.holdReviewDate = reviewDate || null;
  if (ownerId) { order.ownerId = ownerId; order.ownerName = findTeamMember(ownerId)?.name || order.ownerName; }
  order.activity.push(orderActivityEntry("on_hold", actor, `Put on hold: ${reason}`));
  order.updatedAt = new Date().toISOString(); order.updatedBy = actor;
  return order;
}
export function resumeOrder(orderId, { targetStatus, note }, actor = "System") {
  const order = findOrderRecord(orderId);
  if (!order) return null;
  order.status = targetStatus && SETTABLE_STATUSES.includes(targetStatus) ? targetStatus : "Processing";
  order.holdReason = null; order.holdReviewDate = null;
  order.activity.push(orderActivityEntry("resumed", actor, note ? `Resumed: ${note}` : "Resumed"));
  order.updatedAt = new Date().toISOString(); order.updatedBy = actor;
  return order;
}
export function cancelOrder(orderId, { reason, effectiveDate }, actor = "System") {
  if (!reason?.trim()) return null;
  const order = findOrderRecord(orderId);
  if (!order) return null;
  order.status = "Cancelled";
  order.cancellationReason = reason;
  order.cancellationEffectiveDate = effectiveDate || new Date().toISOString();
  order.activity.push(orderActivityEntry("cancelled", actor, `Cancelled: ${reason}`));
  order.updatedAt = new Date().toISOString(); order.updatedBy = actor;
  return order;
}
export function markFulfilled(orderId, actor = "System") {
  const order = findOrderRecord(orderId);
  if (!order) return null;
  order.status = "Fulfilled";
  order.activity.push(orderActivityEntry("fulfilled", actor, "Marked fulfilled"));
  order.updatedAt = new Date().toISOString(); order.updatedBy = actor;
  return order;
}
export function markCompleted(orderId, { completionDate, completionNote }, actor = "System") {
  const order = findOrderRecord(orderId);
  if (!order) return null;
  order.status = "Completed";
  order.activity.push(orderActivityEntry("completed", actor, completionNote ? `Completed: ${completionNote}` : `Completed${completionDate ? ` on ${new Date(completionDate).toLocaleDateString()}` : ""}`));
  order.updatedAt = new Date().toISOString(); order.updatedBy = actor;
  return order;
}
export function requestInvoicePreview(orderId, actor = "System") {
  const order = findOrderRecord(orderId);
  if (!order) return null;
  order.invoiceRequestedAt = new Date().toISOString();
  order.activity.push(orderActivityEntry("invoice_requested", actor, "Invoice request previewed — no Invoice was created (Finance route not yet implemented)"));
  order.updatedAt = new Date().toISOString(); order.updatedBy = actor;
  return order;
}

// ---------------------------------------------------------------------------
// Fulfillment updates — never negative, never above ordered quantity, never
// double-completing a line. Auto-promotes Order status based on progress.
// ---------------------------------------------------------------------------
export function updateLineFulfillment(orderId, lineId, changes, actor = "System") {
  const order = findOrderRecord(orderId);
  if (!order) return { error: "Order not found" };
  const line = order.lineItems.find((l) => l._id === lineId);
  if (!line) return { error: "Line item not found" };

  if (line.lineKind === "Product" && changes.quantityFulfilled !== undefined) {
    const next = Number(changes.quantityFulfilled);
    if (Number.isNaN(next) || next < 0) return { error: "Fulfilled quantity cannot be negative" };
    if (next > line.quantity) return { error: "Fulfilled quantity cannot exceed the ordered quantity" };
    if (line.quantityFulfilled >= line.quantity && next === line.quantity) return { error: "This line is already fully fulfilled" };
    line.quantityFulfilled = next;
    line.deliveryStatus = next === 0 ? "Not Started" : next >= line.quantity ? "Delivered" : "Partial";
    if (next >= line.quantity) line.completedDate = changes.fulfillmentDate || new Date().toISOString();
    if (changes.deliveryReferencePreview) line.deliveryReferencePreview = changes.deliveryReferencePreview;
  }
  if (line.lineKind === "Service") {
    if (changes.completionPercentage !== undefined) {
      const next = Number(changes.completionPercentage);
      if (Number.isNaN(next) || next < 0 || next > 100) return { error: "Completion percentage must be between 0 and 100" };
      if (line.completionPercentage >= 100 && next === 100) return { error: "This service line is already complete" };
      line.completionPercentage = next;
      line.activationStatus = next > 0 ? "Active" : "Not Started";
      if (next >= 100) line.completedDate = changes.fulfillmentDate || new Date().toISOString();
    }
    if (changes.setupStatus) line.setupStatus = changes.setupStatus;
    if (changes.nextMilestone !== undefined) line.nextMilestone = changes.nextMilestone;
    if (changes.serviceStartDate !== undefined) line.serviceStartDate = changes.serviceStartDate;
    if (changes.responsibleOwnerId !== undefined) { line.responsibleOwnerId = changes.responsibleOwnerId; line.responsibleOwnerName = findTeamMember(changes.responsibleOwnerId)?.name || null; }
  }
  if (changes.note?.trim()) line.fulfillmentNotes.push({ _id: id(), at: new Date().toISOString(), author: actor, text: changes.note });

  order.activity.push(orderActivityEntry("fulfillment_updated", actor, `Fulfillment updated for "${line.name}"`));

  const progress = computeOrderProgress(order);
  if (progress >= 100 && ["Processing", "Partially Fulfilled"].includes(order.status)) {
    order.status = "Fulfilled";
    order.activity.push(orderActivityEntry("fulfilled", actor, "All lines fulfilled — status automatically updated to Fulfilled"));
  } else if (progress > 0 && progress < 100 && order.status === "Processing") {
    order.status = "Partially Fulfilled";
  }
  order.updatedAt = new Date().toISOString();
  order.updatedBy = actor;
  return { order };
}

// ---------------------------------------------------------------------------
// Curated fixtures — one real, findable Order for every scenario named in
// the /sales/orders spec.
// ---------------------------------------------------------------------------
const FIXTURE_COMPANY = companies.find((c) => c.accountType === "Customer") || companies[0];
const FIXTURE_CONTACT = contacts.find((c) => c.companyId === FIXTURE_COMPANY._id) || contacts[0];
const FIXTURE_DEAL = deals.find((d) => d.companyId === FIXTURE_COMPANY._id) || deals[0];

function productLine(overrides = {}) {
  return { catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 2, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice, lineKind: "Product", ...overrides };
}
function serviceLine(overrides = {}) {
  return { catalogItemId: ACTIVE_RECURRING_SERVICE._id, quantity: 1, unitPrice: ACTIVE_RECURRING_SERVICE.standardPrice, lineKind: "Service", ...overrides };
}

// 1. Draft manual Order
export const DRAFT_MANUAL_ORDER = makeOrder({
  status: "Draft", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, dealId: FIXTURE_DEAL?._id || null,
  currency: "USD", lineItems: [productLine()],
});

// 2. Order created from a Preview Accepted Quote (snapshot copy, no live link)
export const ORDER_FROM_QUOTE = makeOrder({
  status: "Confirmed", companyId: PREVIEW_ACCEPTED_QUOTE.companyId, contactId: PREVIEW_ACCEPTED_QUOTE.primaryContactId,
  sourceQuoteId: PREVIEW_ACCEPTED_QUOTE._id, sourceQuoteVersion: PREVIEW_ACCEPTED_QUOTE.version, currency: PREVIEW_ACCEPTED_QUOTE.currency,
  confirmedDate: daysAgo(2), lineItems: [productLine({ quantity: 1 })],
});

// 3. Pending Review
export const PENDING_REVIEW_ORDER = makeOrder({
  status: "Pending Review", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  lineItems: [productLine(), serviceLine()],
});

// 4. Confirmed Product Order
export const CONFIRMED_PRODUCT_ORDER = makeOrder({
  status: "Confirmed", orderType: "Product Order", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null,
  currency: "USD", confirmedDate: daysAgo(1), lineItems: [productLine({ quantity: 3 })],
});

// 5. Confirmed Service Order
export const CONFIRMED_SERVICE_ORDER = makeOrder({
  status: "Confirmed", orderType: "Service Order", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null,
  currency: "USD", confirmedDate: daysAgo(1), lineItems: [serviceLine({ serviceStartDate: daysFromNow(7), responsibleOwnerId: FIXTURE_COMPANY.ownerId })],
});

// 6. Mixed Order
export const MIXED_ORDER = makeOrder({
  status: "Confirmed", orderType: "Mixed Order", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null,
  currency: "USD", lineItems: [productLine(), serviceLine()],
});

// 7. Processing
export const PROCESSING_ORDER = makeOrder({
  status: "Processing", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  confirmedDate: daysAgo(5), lineItems: [productLine({ quantityFulfilled: 0 }), serviceLine({ completionPercentage: 0 })],
});

// 8. Partially Fulfilled (order-level status)
export const PARTIALLY_FULFILLED_ORDER = makeOrder({
  status: "Partially Fulfilled", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  confirmedDate: daysAgo(8),
  lineItems: [
    productLine({ quantity: 4, quantityFulfilled: 2, deliveryStatus: "Partial" }),
    serviceLine({ completionPercentage: 50, setupStatus: "In Progress", activationStatus: "Active", nextMilestone: "Complete configuration review" }),
  ],
});

// 9. Fulfilled
export const FULFILLED_ORDER = makeOrder({
  status: "Fulfilled", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  confirmedDate: daysAgo(20),
  lineItems: [
    productLine({ quantityFulfilled: 2, deliveryStatus: "Delivered", completedDate: daysAgo(5), deliveryReferencePreview: "DEL-PREVIEW-88213" }),
  ],
});

// 10. On Hold
export const ON_HOLD_ORDER = makeOrder({
  status: "On Hold", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  holdReason: "Awaiting customer confirmation of delivery address", holdReviewDate: daysFromNow(5),
  lineItems: [productLine()],
});

// 11. Cancelled
export const CANCELLED_ORDER = makeOrder({
  status: "Cancelled", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  cancellationReason: "Customer switched to a competitor offering", cancellationEffectiveDate: daysAgo(3),
  lineItems: [productLine()],
});

// 12. Completed
export const COMPLETED_ORDER = makeOrder({
  status: "Completed", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  confirmedDate: daysAgo(40),
  lineItems: [
    productLine({ quantityFulfilled: 2, deliveryStatus: "Delivered", completedDate: daysAgo(30) }),
    serviceLine({ completionPercentage: 100, setupStatus: "Complete", activationStatus: "Active", completedDate: daysAgo(28) }),
  ],
});

// 13. Order with recurring services
export const RECURRING_SERVICES_ORDER = makeOrder({
  status: "Confirmed", orderType: "Service Order", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  billingSchedule: "Monthly billing",
  lineItems: [serviceLine(), { catalogItemId: ANNUAL_SUBSCRIPTION_SERVICE._id, quantity: 1, unitPrice: ANNUAL_SUBSCRIPTION_SERVICE.standardPrice, lineKind: "Service" }],
});

// 14. Order with usage-based services
export const USAGE_BASED_ORDER = makeOrder({
  status: "Confirmed", orderType: "Service Order", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  lineItems: [{ catalogItemId: USAGE_BASED_SERVICE._id, quantity: 100000, unitPrice: USAGE_BASED_SERVICE.usageConfig?.unitPrice || 0.001, lineKind: "Service", billingModel: "Usage Based", taxCategory: "Digital Services" }],
});

// 15. Order with an overdue start date
export const OVERDUE_ORDER = makeOrder({
  status: "Confirmed", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  requestedDate: daysAgo(4), confirmedDate: daysAgo(10), lineItems: [productLine()],
});

// 16. Order with an incomplete customer address
export const INCOMPLETE_ADDRESS_ORDER = makeOrder({
  status: "Pending Review", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  serviceAddress: { line1: "", city: "San Francisco", state: "", postalCode: "", country: "United States" },
  lineItems: [productLine()],
});

// 17. Order awaiting billing handoff
export const AWAITING_BILLING_ORDER = makeOrder({
  status: "Fulfilled", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  confirmedDate: daysAgo(15),
  lineItems: [productLine({ quantityFulfilled: 2, deliveryStatus: "Delivered", completedDate: daysAgo(2) })],
});

// 18. Order with partial line fulfillment (line-level partial while order stays Processing)
export const PARTIAL_LINE_ORDER = makeOrder({
  status: "Processing", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  confirmedDate: daysAgo(6),
  lineItems: [
    productLine({ quantity: 10, quantityFulfilled: 3, deliveryStatus: "Partial" }),
    productLine({ catalogItemId: TIERED_PRICING_PRODUCT._id, quantity: 5, unitPrice: TIERED_PRICING_PRODUCT.standardPrice, quantityFulfilled: 0 }),
  ],
});

// 19. Archived Order
export const ARCHIVED_ORDER = makeOrder({
  status: "Completed", archived: true, archiveReason: "Superseded by a renewal Order", archivedAt: daysAgo(10),
  statusBeforeArchive: "Completed", companyId: FIXTURE_COMPANY._id, contactId: FIXTURE_CONTACT?._id || null, currency: "USD",
  lineItems: [productLine({ quantityFulfilled: 2, deliveryStatus: "Delivered" })],
});

const CURATED_ORDERS = [
  DRAFT_MANUAL_ORDER, ORDER_FROM_QUOTE, PENDING_REVIEW_ORDER, CONFIRMED_PRODUCT_ORDER, CONFIRMED_SERVICE_ORDER,
  MIXED_ORDER, PROCESSING_ORDER, PARTIALLY_FULFILLED_ORDER, FULFILLED_ORDER, ON_HOLD_ORDER, CANCELLED_ORDER,
  COMPLETED_ORDER, RECURRING_SERVICES_ORDER, USAGE_BASED_ORDER, OVERDUE_ORDER, INCOMPLETE_ADDRESS_ORDER,
  AWAITING_BILLING_ORDER, PARTIAL_LINE_ORDER, ARCHIVED_ORDER,
];

const RANDOM_ORDERS = faker.helpers.multiple(() => {
  const company = faker.helpers.arrayElement(companies);
  const item = faker.helpers.arrayElement([ACTIVE_ONE_TIME_PRODUCT, ACTIVE_RECURRING_SERVICE, TIERED_PRICING_PRODUCT]);
  return makeOrder({
    companyId: company._id, contactId: (contacts.find((c) => c.companyId === company._id) || {})._id || null,
    lineItems: [{ catalogItemId: item._id, quantity: faker.number.int({ min: 1, max: 5 }), unitPrice: item.standardPrice }],
  });
}, { count: 6 });

export const orders = [...CURATED_ORDERS, ...RANDOM_ORDERS];

// ---------------------------------------------------------------------------
// Query — filter/sort/paginate client-side, same pattern as every other
// mock*Data.js query function.
// ---------------------------------------------------------------------------
export function queryOrdersLocal(list, params = {}) {
  const {
    search = "", status, orderType, companyId, contactId, dealId, sourceQuoteId, ownerId, team, currency,
    orderDateFrom, orderDateTo, requestedDateFrom, requestedDateTo, overdue, awaitingBilling, hasRecurring,
    archived = "false", sort = "updatedAt", order = "desc", page = 1, pageSize = 20,
  } = params;

  const effectiveArchived = status === "Archived" ? "true" : archived;

  let result = list.filter((o) => {
    if (effectiveArchived === "true" && !o.archived) return false;
    if (effectiveArchived !== "true" && o.archived) return false;
    const effStatus = getEffectiveStatus(o);
    if (status && status !== "Archived" && effStatus !== status) return false;
    if (orderType && o.orderType !== orderType) return false;
    if (companyId && o.companyId !== companyId) return false;
    if (contactId && o.contactId !== contactId) return false;
    if (dealId && o.dealId !== dealId) return false;
    if (sourceQuoteId && o.sourceQuoteId !== sourceQuoteId) return false;
    if (ownerId && o.ownerId !== ownerId) return false;
    if (team && o.assignedTeam !== team) return false;
    if (currency && o.currency !== currency) return false;
    if (orderDateFrom && (!o.orderDate || new Date(o.orderDate) < new Date(orderDateFrom))) return false;
    if (orderDateTo && (!o.orderDate || new Date(o.orderDate) > new Date(orderDateTo))) return false;
    if (requestedDateFrom && (!o.requestedDate || new Date(o.requestedDate) < new Date(requestedDateFrom))) return false;
    if (requestedDateTo && (!o.requestedDate || new Date(o.requestedDate) > new Date(requestedDateTo))) return false;
    if (overdue === "true" && !isOverdueRequestedDate(o)) return false;
    if (awaitingBilling === "true" && !isAwaitingBillingHandoff(o)) return false;
    const totals = computeOrderTotals(o);
    if (hasRecurring === "true" && totals.recurringTotal === 0) return false;
    if (search) {
      const q = search.toLowerCase();
      const company = findCompany(o.companyId);
      const haystack = `${o.orderNumber} ${company?.name || ""} ${o.customerReference || ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const summary = {
    total: result.length,
    open: result.filter((o) => !["Completed", "Cancelled", "Archived"].includes(getEffectiveStatus(o))).length,
    confirmedValue: round2(result.filter((o) => !["Draft", "Pending Review", "Cancelled"].includes(getEffectiveStatus(o))).reduce((sum, o) => sum + computeOrderTotals(o).grandTotal, 0)),
    processing: result.filter((o) => getEffectiveStatus(o) === "Processing").length,
    partiallyFulfilled: result.filter((o) => getEffectiveStatus(o) === "Partially Fulfilled").length,
    onHold: result.filter((o) => getEffectiveStatus(o) === "On Hold").length,
    awaitingBillingHandoff: result.filter((o) => isAwaitingBillingHandoff(o)).length,
  };

  result = [...result].sort((a, b) => {
    const dir = order === "asc" ? 1 : -1;
    let av, bv;
    if (sort === "total") { av = computeOrderTotals(a).grandTotal; bv = computeOrderTotals(b).grandTotal; }
    else if (sort === "status") { av = getEffectiveStatus(a); bv = getEffectiveStatus(b); }
    else if (sort === "company") { av = findCompany(a.companyId)?.name || ""; bv = findCompany(b.companyId)?.name || ""; }
    else { av = a[sort]; bv = b[sort]; }
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    return av > bv ? dir : -dir;
  });

  const total = result.length;
  const pageNum = Math.max(1, Number(page));
  const size = Math.max(1, Number(pageSize));
  const start = (pageNum - 1) * size;
  return { items: result.slice(start, start + size), total, page: pageNum, pageSize: size, summary };
}

export { findCompany, findContact, findDeal, findQuoteRecord };
