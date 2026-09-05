// In-memory mock Contracts module — a frontend-only Contract management
// workspace built on the shared Companies/Contacts/Deals/Quotes/Orders/
// Products/Price Books data. Same pattern as every other mock*Data.js
// module: plain mutable arrays and business-logic functions instead of a
// real backend, reset on a full page reload.
//
// A Contract is the LEGAL AGREEMENT governing a customer relationship —
// distinct from a Quote (a proposal), an Order (a confirmed commitment to
// buy/deliver) and an Invoice (a bill). Like an Order line, a Contract
// line item is a frozen PRICING SNAPSHOT: unitPrice/discount/tax are
// captured once at creation and never recomputed, so a later catalog,
// Price Book, Quote or Order edit can never silently change an existing
// Contract.
import { faker } from "@faker-js/faker";
import { CRM_TEAM, findTeamMember } from "./mockUsersData";
import { findCatalogItem } from "./mockCatalogData";
import { companies, contacts, deals, findCompany, findContact, findDeal } from "./mockCrmData";
import { findQuoteRecord, TAX_RATE_PREVIEW } from "./mockQuoteData";
import { findOrderRecord } from "./mockOrderData";

const id = () => faker.database.mongodbObjectId();
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------
export const CONTRACT_TYPES = ["One-Time Agreement", "Subscription / Recurring Service Agreement", "Master Service Agreement", "Amendment"];
// "Archived" is a listed status value (matching Orders' convention) — we
// still track archived/statusBeforeArchive internally so Restore has
// something to return to; getEffectiveStatus() surfaces "Archived" whenever
// the flag is set. "Signed" is the operative/in-force state — SalesDashboard
// already counts contracts by this exact status name, so it must never be
// renamed. Renewal/expiry proximity is a DERIVED flag (isRenewalDue /
// isExpiringSoon), not a separate status, matching Orders' isOverdueRequestedDate.
export const CONTRACT_STATUSES = [
  "Draft", "Pending Internal Review", "Sent for Signature", "Signed",
  "Expired", "Terminated", "Cancelled", "Archived",
];
export const SETTABLE_STATUSES = CONTRACT_STATUSES.filter((s) => s !== "Archived");
export const RENEWAL_TYPES = ["Auto-Renew", "Manual Renew", "No Renewal"];
export const PAYMENT_TERMS_OPTIONS = ["Due on Receipt", "Net 15", "Net 30", "Net 45", "Net 60"];
export const BILLING_SCHEDULES = ["One-time billing", "Monthly billing", "Quarterly billing", "Annual billing"];
export const DISCOUNT_TYPES = ["Percentage", "Fixed Amount"];
export const RENEWAL_NOTICE_DAYS_DEFAULT = 60;
export const EXPIRING_SOON_DAYS = 30;
export const RELATED_RECORD_PREVIEWS = ["Future Invoice preview", "Future Renewal-billing preview"];

let contractCounter = 1000;
function nextContractNumber() { return `CTR-PREVIEW-${++contractCounter}`; }

function contractActivityEntry(type, actor, description, meta = {}) {
  return { _id: id(), type, actor: actor || "System", at: new Date().toISOString(), description, meta };
}
function contractAuditEntry(action, actor, { field, before, after, reason } = {}) {
  return { _id: id(), action, actor: actor || "System", at: new Date().toISOString(), field: field || null, before: before ?? null, after: after ?? null, reason: reason || null };
}

// ---------------------------------------------------------------------------
// Line items — frozen pricing snapshots (no fulfillment tracking; that's
// Orders' job — a Contract line represents a contracted term, not delivery).
// ---------------------------------------------------------------------------
export function makeContractLine(overrides = {}) {
  const catalogItem = overrides.catalogItemId ? findCatalogItem(overrides.catalogItemId) : null;
  return {
    _id: overrides._id || id(),
    catalogItemId: overrides.catalogItemId || null,
    isCustomLine: overrides.isCustomLine ?? !overrides.catalogItemId,
    name: overrides.name || catalogItem?.name || "Custom line",
    description: overrides.description ?? catalogItem?.shortDescription ?? "",
    unit: overrides.unit || catalogItem?.unit || "Each",
    billingModel: overrides.billingModel || catalogItem?.billingModel || "One Time",
    billingInterval: overrides.billingInterval !== undefined ? overrides.billingInterval : (catalogItem?.billingInterval ?? null),
    quantity: overrides.quantity ?? 1,
    // Frozen snapshot fields — never re-resolved after creation.
    listPriceSnapshot: overrides.listPriceSnapshot ?? catalogItem?.standardPrice ?? null,
    priceBookIdUsed: overrides.priceBookIdUsed ?? null,
    priceBookPriceSnapshot: overrides.priceBookPriceSnapshot ?? null,
    unitPrice: overrides.unitPrice ?? (overrides.priceBookPriceSnapshot ?? catalogItem?.standardPrice ?? 0),
    discountType: overrides.discountType ?? null,
    discountValue: overrides.discountValue ?? null,
    taxCategory: overrides.taxCategory || catalogItem?.taxCategory || "Standard",
    order: overrides.order ?? 0,
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

// ---------------------------------------------------------------------------
// Contract-level totals — always computed from the frozen line snapshots.
// ---------------------------------------------------------------------------
export function computeContractTotals(contract) {
  const lines = contract.lineItems || [];
  let oneTimeTotal = 0, recurringTotal = 0, subtotal = 0;
  for (const line of lines) {
    const lineTotal = computeLineTotal(line);
    subtotal += lineTotal;
    if (line.billingModel === "Recurring") recurringTotal += lineTotal;
    else oneTimeTotal += lineTotal;
  }
  let tax = 0;
  for (const line of lines) tax += computeLineTotal(line) * (TAX_RATE_PREVIEW[line.taxCategory] ?? 0);
  const grandTotal = subtotal + tax;
  return { subtotal: round2(subtotal), tax: round2(tax), grandTotal: round2(grandTotal), oneTimeTotal: round2(oneTimeTotal), recurringTotal: round2(recurringTotal) };
}

// ---------------------------------------------------------------------------
// Status derivation / metrics helpers
// ---------------------------------------------------------------------------
export function getEffectiveStatus(contract) {
  return contract.archived ? "Archived" : contract.status;
}
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}
export function isRenewalDue(contract) {
  if (getEffectiveStatus(contract) !== "Signed" || contract.renewalType === "No Renewal") return false;
  const remaining = daysUntil(contract.endDate);
  return remaining !== null && remaining <= (contract.renewalNoticeDays || RENEWAL_NOTICE_DAYS_DEFAULT) && remaining >= 0;
}
export function isExpiringSoon(contract) {
  if (getEffectiveStatus(contract) !== "Signed") return false;
  const remaining = daysUntil(contract.endDate);
  return remaining !== null && remaining <= EXPIRING_SOON_DAYS && remaining >= 0;
}
export function hasIncompleteSignatory(contract) {
  const status = getEffectiveStatus(contract);
  if (!["Sent for Signature", "Signed"].includes(status)) return false;
  return !contract.signatories?.internal?.signedAt || !contract.signatories?.customer?.signedAt;
}
export function deriveContractType(lineItems) {
  const hasRecurring = (lineItems || []).some((l) => l.billingModel === "Recurring");
  return hasRecurring ? "Subscription / Recurring Service Agreement" : "One-Time Agreement";
}

// ---------------------------------------------------------------------------
// Contract builder
// ---------------------------------------------------------------------------
function makeContract(overrides = {}) {
  const owner = overrides.ownerId === null ? null : findTeamMember(overrides.ownerId) || faker.helpers.arrayElement(CRM_TEAM);
  const createdAt = overrides.createdAt || faker.date.past({ years: 1 }).toISOString();
  const lineItems = (overrides.lineItems || []).map((l, i) => makeContractLine({ ...l, order: l.order ?? i }));
  const base = {
    _id: id(), contractNumber: overrides.contractNumber || nextContractNumber(),
    contractType: overrides.contractType || deriveContractType(lineItems),
    companyId: overrides.companyId || null, contactId: overrides.contactId || null, dealId: overrides.dealId || null,
    sourceQuoteId: overrides.sourceQuoteId || null, sourceQuoteVersion: overrides.sourceQuoteVersion ?? null,
    sourceOrderId: overrides.sourceOrderId || null, parentContractId: overrides.parentContractId || null,
    ownerId: owner?.id || null, ownerName: owner?.name || null, assignedTeam: overrides.assignedTeam || "Sales",
    currency: overrides.currency || "USD", status: overrides.status || "Draft",
    effectiveDate: overrides.effectiveDate !== undefined ? overrides.effectiveDate : daysFromNow(14),
    endDate: overrides.endDate !== undefined ? overrides.endDate : daysFromNow(379),
    termMonths: overrides.termMonths ?? 12,
    renewalType: overrides.renewalType || "Manual Renew",
    renewalNoticeDays: overrides.renewalNoticeDays ?? RENEWAL_NOTICE_DAYS_DEFAULT,
    lineItems,
    paymentTerms: overrides.paymentTerms || "Net 30", billingSchedule: overrides.billingSchedule || "One-time billing",
    billingContactId: overrides.billingContactId ?? overrides.contactId ?? null,
    billingAddress: overrides.billingAddress || null,
    signatories: overrides.signatories || { internal: { name: null, title: null, signedAt: null }, customer: { name: null, title: null, signedAt: null } },
    sentForSignatureAt: overrides.sentForSignatureAt || null,
    signedAt: overrides.signedAt || null,
    terminationReason: overrides.terminationReason || null, terminationEffectiveDate: overrides.terminationEffectiveDate || null,
    cancellationReason: overrides.cancellationReason || null,
    amendmentHistory: overrides.amendmentHistory || [],
    internalNote: overrides.internalNote || "", customerNote: overrides.customerNote || "",
    files: overrides.files || [], auditLog: [],
    archived: overrides.archived ?? false, archiveReason: overrides.archiveReason || null, archivedAt: overrides.archivedAt || null, statusBeforeArchive: overrides.statusBeforeArchive || null,
    createdBy: overrides.createdBy || "System", updatedBy: overrides.updatedBy || "System",
    createdAt, updatedAt: overrides.updatedAt || createdAt,
  };
  base.activity = overrides.activity || [contractActivityEntry("created", base.createdBy, `Contract ${base.contractNumber} created`)];
  return base;
}

// Pure previews — build a would-be Contract from a Quote/Order/Deal WITHOUT
// saving it or mutating the source. Snapshots line items at the moment of
// copy; never dynamically inherits later source changes.
export function buildContractFromQuotePreview(quoteId) {
  const quote = findQuoteRecord(quoteId);
  if (!quote) return null;
  return {
    companyId: quote.companyId, contactId: quote.primaryContactId, dealId: quote.dealId,
    sourceQuoteId: quote._id, sourceQuoteVersion: quote.version,
    ownerId: quote.ownerId, assignedTeam: quote.assignedTeam, currency: quote.currency,
    paymentTerms: quote.paymentTerms, billingSchedule: quote.billingSchedule,
    customerNote: quote.customerNote, internalNote: "",
    lineItems: (quote.lineItems || []).filter((l) => l.included !== false).map((l) => ({
      catalogItemId: l.catalogItemId, isCustomLine: l.isCustomLine, name: l.name, description: l.description,
      unit: l.unit, billingModel: l.billingModel, billingInterval: l.billingInterval, quantity: l.quantity,
      listPriceSnapshot: l.listPrice, priceBookIdUsed: l.priceBookIdUsed, priceBookPriceSnapshot: l.priceBookPrice,
      unitPrice: l.unitPrice, discountType: l.discountType, discountValue: l.discountValue, taxCategory: l.taxCategory,
    })),
  };
}

export function buildContractFromOrderPreview(orderId) {
  const order = findOrderRecord(orderId);
  if (!order) return null;
  return {
    companyId: order.companyId, contactId: order.contactId, dealId: order.dealId,
    sourceQuoteId: order.sourceQuoteId, sourceQuoteVersion: order.sourceQuoteVersion, sourceOrderId: order._id,
    ownerId: order.ownerId, assignedTeam: order.assignedTeam, currency: order.currency,
    paymentTerms: order.paymentTerms, billingSchedule: order.billingSchedule,
    customerNote: order.customerNote, internalNote: "",
    lineItems: (order.lineItems || []).map((l) => ({
      catalogItemId: l.catalogItemId, isCustomLine: l.isCustomLine, name: l.name, description: l.description,
      unit: l.unit, billingModel: l.billingModel, billingInterval: l.billingInterval, quantity: l.quantity,
      listPriceSnapshot: l.listPriceSnapshot, priceBookIdUsed: l.priceBookIdUsed, priceBookPriceSnapshot: l.priceBookPriceSnapshot,
      unitPrice: l.unitPrice, discountType: l.discountType, discountValue: l.discountValue, taxCategory: l.taxCategory,
    })),
  };
}

export function buildContractFromDealPreview(dealId) {
  const deal = findDeal(dealId);
  if (!deal) return null;
  return {
    companyId: deal.companyId, contactId: deal.primaryContactId || null, dealId: deal._id,
    ownerId: deal.ownerId, assignedTeam: deal.assignedTeam || "Sales", currency: deal.currency || "USD",
    paymentTerms: "Net 30", billingSchedule: "One-time billing", internalNote: "", customerNote: "",
    lineItems: [],
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export function validateContractPayload(payload) {
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

  if (!payload.effectiveDate) errors.effectiveDate = "An effective (start) date is required";
  if (!payload.endDate) errors.endDate = "An end date is required";
  if (payload.effectiveDate && payload.endDate && new Date(payload.endDate) <= new Date(payload.effectiveDate)) {
    errors.endDate = "End date must be after the effective date";
  }
  if (!payload.renewalType) errors.renewalType = "A renewal type is required";
  if (!payload.paymentTerms) errors.paymentTerms = "Payment terms are required";
  if (!payload.billingContactId) warnings.billingContactId = "No billing contact selected — defaulting to the primary contact";

  if (payload.sourceQuoteId) {
    const quote = findQuoteRecord(payload.sourceQuoteId);
    if (quote && quote.currency !== payload.currency) errors.currency = `Source Quote is priced in ${quote.currency}, not the Contract's currency (${payload.currency})`;
  }
  if (payload.sourceOrderId) {
    const order = findOrderRecord(payload.sourceOrderId);
    if (order && order.currency !== payload.currency) errors.currency = `Source Order is priced in ${order.currency}, not the Contract's currency (${payload.currency})`;
  }

  const totals = computeContractTotals(payload);
  if (totals.grandTotal < 0) warnings.grandTotal = "The grand total is negative";

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export function createContract(payload, actor = "System") {
  const contract = makeContract({ ...payload, createdBy: actor, updatedBy: actor, createdAt: new Date().toISOString() });
  contracts.unshift(contract);
  return contract;
}

export function findContractRecord(contractId) {
  return contracts.find((c) => c._id === contractId);
}
export function contractsForQuote(quoteId) {
  return contracts.filter((c) => c.sourceQuoteId === quoteId);
}
export function contractsForOrder(orderId) {
  return contracts.filter((c) => c.sourceOrderId === orderId);
}
export function contractsForDeal(dealId) {
  return contracts.filter((c) => c.dealId === dealId);
}
export function contractsForCompany(companyId) {
  return contracts.filter((c) => c.companyId === companyId);
}

const AUDIT_TRACKED_FIELDS = ["status", "ownerId", "endDate", "renewalType"];

export function updateContract(contractId, changes, actor = "System") {
  const contract = findContractRecord(contractId);
  if (!contract) return null;
  if (changes.ownerId !== undefined && changes.ownerId !== contract.ownerId) {
    const newOwner = findTeamMember(changes.ownerId);
    contract.auditLog.push(contractAuditEntry("update", actor, { field: "ownerId", before: contract.ownerName, after: newOwner?.name || null }));
    contract.ownerName = newOwner?.name || null;
  }
  AUDIT_TRACKED_FIELDS.forEach((field) => {
    if (field !== "ownerId" && changes[field] !== undefined && changes[field] !== contract[field]) {
      contract.auditLog.push(contractAuditEntry("update", actor, { field, before: contract[field], after: changes[field] }));
    }
  });
  Object.assign(contract, changes);
  contract.updatedAt = new Date().toISOString();
  contract.updatedBy = actor;
  return contract;
}

export function archiveContract(contractId, reason, actor = "System") {
  const contract = findContractRecord(contractId);
  if (!contract) return null;
  contract.statusBeforeArchive = contract.status;
  contract.archived = true;
  contract.archiveReason = reason;
  contract.archivedAt = new Date().toISOString();
  contract.activity.push(contractActivityEntry("archived", actor, `Archived: ${reason}`));
  contract.auditLog.push(contractAuditEntry("archive", actor, { field: "archived", before: false, after: true, reason }));
  contract.updatedAt = new Date().toISOString();
  contract.updatedBy = actor;
  return contract;
}
export function restoreContract(contractId, actor = "System") {
  const contract = findContractRecord(contractId);
  if (!contract) return null;
  contract.status = contract.statusBeforeArchive || "Draft";
  contract.archived = false;
  contract.archiveReason = null;
  contract.archivedAt = null;
  contract.statusBeforeArchive = null;
  contract.activity.push(contractActivityEntry("restored", actor, "Restored from archive"));
  contract.auditLog.push(contractAuditEntry("restore", actor, { field: "archived", before: true, after: false }));
  contract.updatedAt = new Date().toISOString();
  contract.updatedBy = actor;
  return contract;
}
export function bulkAssignOwner(contractIds, ownerId, actor = "System") {
  return contractIds.map((cid) => updateContract(cid, { ownerId }, actor)).filter(Boolean);
}
export function bulkArchive(contractIds, reason, actor = "System") {
  return contractIds.map((cid) => archiveContract(cid, reason, actor)).filter(Boolean);
}

export function buildContractDuplicatePreview(contractId) {
  const source = findContractRecord(contractId);
  if (!source) return null;
  return {
    ...source, _id: undefined, contractNumber: undefined, status: "Draft",
    signatories: { internal: { name: null, title: null, signedAt: null }, customer: { name: null, title: null, signedAt: null } },
    sentForSignatureAt: null, signedAt: null, terminationReason: null, terminationEffectiveDate: null, cancellationReason: null,
    amendmentHistory: [], archived: false, archiveReason: null, archivedAt: null, statusBeforeArchive: null,
    activity: [], auditLog: [], files: [], createdAt: undefined, updatedAt: undefined,
    lineItems: source.lineItems.map((l) => ({ ...l, _id: undefined })),
  };
}

// ---------------------------------------------------------------------------
// Status transitions — every transition is a frontend preview only. Each
// opens a confirmation dialog in the UI rather than flipping status directly.
// ---------------------------------------------------------------------------
export function submitForInternalReview(contractId, actor = "System") {
  const contract = findContractRecord(contractId);
  if (!contract) return null;
  contract.status = "Pending Internal Review";
  contract.activity.push(contractActivityEntry("review_submitted", actor, "Submitted for internal review"));
  contract.updatedAt = new Date().toISOString(); contract.updatedBy = actor;
  return contract;
}

export function sendForSignature(contractId, { sentAt } = {}, actor = "System") {
  const contract = findContractRecord(contractId);
  if (!contract) return null;
  contract.status = "Sent for Signature";
  contract.sentForSignatureAt = sentAt || new Date().toISOString();
  contract.activity.push(contractActivityEntry("sent_for_signature", actor, "Sent for signature"));
  contract.updatedAt = new Date().toISOString(); contract.updatedBy = actor;
  return contract;
}

// Recording one party's signature; once BOTH internal and customer
// signatories are present, the contract auto-promotes to "Signed".
export function recordSignature(contractId, { party, name, title, signedAt }, actor = "System") {
  if (!party || !["internal", "customer"].includes(party)) return null;
  if (!name?.trim()) return null;
  const contract = findContractRecord(contractId);
  if (!contract) return null;
  contract.signatories = { ...contract.signatories, [party]: { name, title: title || "", signedAt: signedAt || new Date().toISOString() } };
  contract.activity.push(contractActivityEntry("signature_recorded", actor, `${party === "internal" ? "Internal" : "Customer"} signature recorded: ${name}`));
  if (contract.signatories.internal?.signedAt && contract.signatories.customer?.signedAt) {
    contract.status = "Signed";
    contract.signedAt = new Date().toISOString();
    contract.activity.push(contractActivityEntry("signed", actor, "Contract fully executed — both parties have signed"));
  }
  contract.updatedAt = new Date().toISOString(); contract.updatedBy = actor;
  return contract;
}

export function renewContract(contractId, { newEndDate, note }, actor = "System") {
  if (!newEndDate) return null;
  const contract = findContractRecord(contractId);
  if (!contract || contract.status !== "Signed") return null;
  const previousEndDate = contract.endDate;
  contract.amendmentHistory = [...contract.amendmentHistory, { _id: id(), at: new Date().toISOString(), actor, note: note || "", previousEndDate, newEndDate }];
  contract.endDate = newEndDate;
  contract.activity.push(contractActivityEntry("renewed", actor, `Renewed through ${new Date(newEndDate).toLocaleDateString()}${note ? `: ${note}` : ""}`));
  contract.updatedAt = new Date().toISOString(); contract.updatedBy = actor;
  return contract;
}

export function terminateContract(contractId, { reason, effectiveDate }, actor = "System") {
  if (!reason?.trim()) return null;
  const contract = findContractRecord(contractId);
  if (!contract) return null;
  contract.status = "Terminated";
  contract.terminationReason = reason;
  contract.terminationEffectiveDate = effectiveDate || new Date().toISOString();
  contract.activity.push(contractActivityEntry("terminated", actor, `Terminated: ${reason}`));
  contract.updatedAt = new Date().toISOString(); contract.updatedBy = actor;
  return contract;
}

export function cancelContract(contractId, { reason }, actor = "System") {
  if (!reason?.trim()) return null;
  const contract = findContractRecord(contractId);
  if (!contract) return null;
  if (!["Draft", "Pending Internal Review", "Sent for Signature"].includes(contract.status)) return null;
  contract.status = "Cancelled";
  contract.cancellationReason = reason;
  contract.activity.push(contractActivityEntry("cancelled", actor, `Cancelled: ${reason}`));
  contract.updatedAt = new Date().toISOString(); contract.updatedBy = actor;
  return contract;
}

export function expireContract(contractId, actor = "System") {
  const contract = findContractRecord(contractId);
  if (!contract) return null;
  contract.status = "Expired";
  contract.activity.push(contractActivityEntry("expired", actor, "Marked expired"));
  contract.updatedAt = new Date().toISOString(); contract.updatedBy = actor;
  return contract;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const acmeCo = companies[0];
const acmeContact = contacts.find((c) => c.companyId === acmeCo?._id) || contacts[0];
const acmeDeal = deals.find((d) => d.companyId === acmeCo?._id) || deals[0];
const secondCo = companies[1] || companies[0];
const secondContact = contacts.find((c) => c.companyId === secondCo?._id) || contacts[1] || contacts[0];

function sampleLine(overrides = {}) {
  return makeContractLine({ isCustomLine: true, name: "Managed Services Retainer", billingModel: "Recurring", billingInterval: "Monthly", quantity: 1, unitPrice: 2500, listPriceSnapshot: 2500, taxCategory: "Standard", ...overrides });
}

export const DRAFT_MANUAL_CONTRACT = makeContract({
  companyId: acmeCo?._id, contactId: acmeContact?._id, dealId: acmeDeal?._id,
  status: "Draft", contractType: "One-Time Agreement",
  lineItems: [makeContractLine({ isCustomLine: true, name: "Implementation Services", billingModel: "One Time", quantity: 1, unitPrice: 15000, listPriceSnapshot: 15000 })],
  effectiveDate: daysFromNow(21), endDate: daysFromNow(386), renewalType: "No Renewal",
});

export const DRAFT_FROM_QUOTE_CONTRACT = makeContract({
  companyId: secondCo?._id, contactId: secondContact?._id,
  status: "Draft", contractType: "Subscription / Recurring Service Agreement",
  lineItems: [sampleLine()], renewalType: "Manual Renew",
});

export const PENDING_INTERNAL_REVIEW_CONTRACT = makeContract({
  companyId: acmeCo?._id, contactId: acmeContact?._id,
  status: "Pending Internal Review", lineItems: [sampleLine({ name: "Platform Subscription", unitPrice: 4200 })],
  renewalType: "Auto-Renew",
});

export const SENT_AWAITING_CUSTOMER_CONTRACT = makeContract({
  companyId: secondCo?._id, contactId: secondContact?._id,
  status: "Sent for Signature", sentForSignatureAt: daysAgo(3),
  signatories: { internal: { name: "Priya Nair", title: "Sales Manager", signedAt: daysAgo(3) }, customer: { name: null, title: null, signedAt: null } },
  lineItems: [sampleLine({ name: "Enterprise Support Plan" })], renewalType: "Auto-Renew",
});

export const SENT_AWAITING_INTERNAL_CONTRACT = makeContract({
  companyId: acmeCo?._id, contactId: acmeContact?._id,
  status: "Sent for Signature", sentForSignatureAt: daysAgo(1),
  signatories: { internal: { name: null, title: null, signedAt: null }, customer: { name: "Rico Dietrich", title: "VP Operations", signedAt: daysAgo(1) } },
  lineItems: [sampleLine()], renewalType: "Manual Renew",
});

export const SIGNED_ONE_TIME_CONTRACT = makeContract({
  companyId: secondCo?._id, contactId: secondContact?._id,
  status: "Signed", contractType: "One-Time Agreement",
  effectiveDate: daysAgo(30), endDate: daysFromNow(335),
  signedAt: daysAgo(35), sentForSignatureAt: daysAgo(40),
  signatories: { internal: { name: "Dominic Wuckert", title: "Sales Manager", signedAt: daysAgo(35) }, customer: { name: "Anais Beier", title: "Procurement Lead", signedAt: daysAgo(35) } },
  lineItems: [makeContractLine({ isCustomLine: true, name: "Hardware Supply Agreement", billingModel: "One Time", quantity: 20, unitPrice: 899, listPriceSnapshot: 899 })],
  renewalType: "No Renewal",
});

export const SIGNED_SUBSCRIPTION_AUTO_RENEW_CONTRACT = makeContract({
  companyId: acmeCo?._id, contactId: acmeContact?._id, dealId: acmeDeal?._id,
  status: "Signed", contractType: "Subscription / Recurring Service Agreement",
  effectiveDate: daysAgo(60), endDate: daysFromNow(305),
  signedAt: daysAgo(65),
  signatories: { internal: { name: "Marcus Chen", title: "Sales Manager", signedAt: daysAgo(65) }, customer: { name: "Lavern Nitzsche", title: "IT Director", signedAt: daysAgo(65) } },
  lineItems: [sampleLine({ name: "Annual Platform License", billingModel: "Recurring", billingInterval: "Annual", unitPrice: 48000, listPriceSnapshot: 48000 })],
  renewalType: "Auto-Renew", renewalNoticeDays: 60,
});

export const SIGNED_RENEWAL_DUE_CONTRACT = makeContract({
  companyId: secondCo?._id, contactId: secondContact?._id,
  status: "Signed", contractType: "Subscription / Recurring Service Agreement",
  effectiveDate: daysAgo(340), endDate: daysFromNow(25),
  signedAt: daysAgo(345),
  signatories: { internal: { name: "Fatima Al-Sayed", title: "Sales Manager", signedAt: daysAgo(345) }, customer: { name: "Major Kris", title: "Owner", signedAt: daysAgo(345) } },
  lineItems: [sampleLine()], renewalType: "Manual Renew", renewalNoticeDays: 60,
});

export const RECENTLY_RENEWED_CONTRACT = makeContract({
  companyId: acmeCo?._id, contactId: acmeContact?._id,
  status: "Signed", contractType: "Subscription / Recurring Service Agreement",
  effectiveDate: daysAgo(400), endDate: daysFromNow(340),
  signedAt: daysAgo(405),
  signatories: { internal: { name: "Grace Kim", title: "Sales Manager", signedAt: daysAgo(405) }, customer: { name: "Darrell Nikolaus", title: "CFO", signedAt: daysAgo(405) } },
  lineItems: [sampleLine({ name: "Support & Maintenance", unitPrice: 3100 })],
  renewalType: "Auto-Renew",
  amendmentHistory: [{ _id: id(), at: daysAgo(25), actor: "Grace Kim", note: "Renewed for another 12 months at the same rate", previousEndDate: daysAgo(25), newEndDate: daysFromNow(340) }],
});

export const EXPIRED_CONTRACT = makeContract({
  companyId: secondCo?._id, contactId: secondContact?._id,
  status: "Expired", effectiveDate: daysAgo(400), endDate: daysAgo(35),
  signedAt: daysAgo(405),
  signatories: { internal: { name: "Liam O'Connor", title: "Support Manager", signedAt: daysAgo(405) }, customer: { name: "Sarah Johnson", title: "Ops Manager", signedAt: daysAgo(405) } },
  lineItems: [sampleLine({ name: "Legacy Support Plan", unitPrice: 1800 })], renewalType: "No Renewal",
});

export const TERMINATED_CONTRACT = makeContract({
  companyId: acmeCo?._id, contactId: acmeContact?._id,
  status: "Terminated", effectiveDate: daysAgo(120), endDate: daysFromNow(245),
  signedAt: daysAgo(125), terminationReason: "Customer consolidated vendors during a budget review", terminationEffectiveDate: daysAgo(10),
  signatories: { internal: { name: "Priya Nair", title: "Sales Manager", signedAt: daysAgo(125) }, customer: { name: "Emily Wilson", title: "Finance Director", signedAt: daysAgo(125) } },
  lineItems: [sampleLine({ name: "Consulting Retainer", unitPrice: 6000 })], renewalType: "Manual Renew",
});

export const CANCELLED_CONTRACT = makeContract({
  companyId: secondCo?._id, contactId: secondContact?._id,
  status: "Cancelled", cancellationReason: "Customer withdrew before countersignature",
  lineItems: [sampleLine({ name: "Pilot Program Agreement", unitPrice: 900 })], renewalType: "No Renewal",
});

export const ARCHIVED_CONTRACT = makeContract({
  companyId: acmeCo?._id, contactId: acmeContact?._id,
  status: "Expired", archived: true, statusBeforeArchive: "Expired",
  archiveReason: "Superseded by a new master agreement", archivedAt: daysAgo(5),
  effectiveDate: daysAgo(500), endDate: daysAgo(120),
  lineItems: [sampleLine({ name: "Original Services Agreement", unitPrice: 2000 })], renewalType: "No Renewal",
});

export const FROM_ORDER_CONTRACT = makeContract({
  companyId: secondCo?._id, contactId: secondContact?._id,
  status: "Draft", contractType: "One-Time Agreement",
  lineItems: [makeContractLine({ isCustomLine: true, name: "Equipment Supply Agreement", billingModel: "One Time", quantity: 5, unitPrice: 3200, listPriceSnapshot: 3200 })],
  renewalType: "No Renewal",
});

export const FROM_DEAL_CONTRACT = makeContract({
  companyId: acmeCo?._id, dealId: acmeDeal?._id,
  status: "Draft", lineItems: [], renewalType: "Manual Renew",
});

export const INCOMPLETE_SIGNATORY_CONTRACT = makeContract({
  companyId: secondCo?._id, contactId: secondContact?._id,
  status: "Sent for Signature", sentForSignatureAt: daysAgo(45),
  signatories: { internal: { name: "Marcus Chen", title: "Sales Manager", signedAt: daysAgo(45) }, customer: { name: null, title: null, signedAt: null } },
  lineItems: [sampleLine({ name: "Overdue Signature Example" })], renewalType: "Manual Renew",
});

export const contracts = [
  DRAFT_MANUAL_CONTRACT, DRAFT_FROM_QUOTE_CONTRACT, PENDING_INTERNAL_REVIEW_CONTRACT,
  SENT_AWAITING_CUSTOMER_CONTRACT, SENT_AWAITING_INTERNAL_CONTRACT, SIGNED_ONE_TIME_CONTRACT,
  SIGNED_SUBSCRIPTION_AUTO_RENEW_CONTRACT, SIGNED_RENEWAL_DUE_CONTRACT, RECENTLY_RENEWED_CONTRACT,
  EXPIRED_CONTRACT, TERMINATED_CONTRACT, CANCELLED_CONTRACT, ARCHIVED_CONTRACT,
  FROM_ORDER_CONTRACT, FROM_DEAL_CONTRACT, INCOMPLETE_SIGNATORY_CONTRACT,
];

// A handful of additional randomized Draft contracts so the directory has
// realistic bulk/pagination/filter behavior beyond the 16 curated fixtures.
export const RANDOM_CONTRACTS = faker.helpers.multiple(
  () => {
    const company = faker.helpers.arrayElement(companies);
    const contact = contacts.find((c) => c.companyId === company?._id) || faker.helpers.arrayElement(contacts);
    return makeContract({
      companyId: company?._id, contactId: contact?._id,
      status: faker.helpers.arrayElement(["Draft", "Pending Internal Review", "Sent for Signature"]),
      lineItems: [makeContractLine({ isCustomLine: true, name: faker.commerce.productName(), billingModel: faker.helpers.arrayElement(["One Time", "Recurring"]), billingInterval: "Monthly", quantity: faker.number.int({ min: 1, max: 5 }), unitPrice: faker.number.int({ min: 200, max: 5000 }) })],
      renewalType: faker.helpers.arrayElement(RENEWAL_TYPES),
    });
  },
  { count: 6 }
);
contracts.push(...RANDOM_CONTRACTS);

// ---------------------------------------------------------------------------
// Directory query
// ---------------------------------------------------------------------------
export function queryContractsLocal(list, params = {}) {
  const {
    search = "", status, contractType, companyId, contactId, dealId, sourceQuoteId, sourceOrderId, ownerId, team, currency,
    renewalDue, expiringSoon, incompleteSignatory,
    archived = "false", sort = "updatedAt", order = "desc", page = 1, pageSize = 20,
  } = params;

  const effectiveArchived = status === "Archived" ? "true" : archived;

  let result = list.filter((c) => {
    if (effectiveArchived === "true" && !c.archived) return false;
    if (effectiveArchived !== "true" && c.archived) return false;
    const effStatus = getEffectiveStatus(c);
    if (status && status !== "Archived" && effStatus !== status) return false;
    if (contractType && c.contractType !== contractType) return false;
    if (companyId && c.companyId !== companyId) return false;
    if (contactId && c.contactId !== contactId) return false;
    if (dealId && c.dealId !== dealId) return false;
    if (sourceQuoteId && c.sourceQuoteId !== sourceQuoteId) return false;
    if (sourceOrderId && c.sourceOrderId !== sourceOrderId) return false;
    if (ownerId && c.ownerId !== ownerId) return false;
    if (team && c.assignedTeam !== team) return false;
    if (currency && c.currency !== currency) return false;
    if (renewalDue === "true" && !isRenewalDue(c)) return false;
    if (expiringSoon === "true" && !isExpiringSoon(c)) return false;
    if (incompleteSignatory === "true" && !hasIncompleteSignatory(c)) return false;
    if (search) {
      const q = search.toLowerCase();
      const companyName = findCompany(c.companyId)?.name || "";
      const haystack = `${c.contractNumber} ${companyName}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  result = result.slice().sort((a, b) => {
    const av = a[sort], bv = b[sort];
    if (av === bv) return 0;
    const cmp = av > bv ? 1 : -1;
    return order === "asc" ? cmp : -cmp;
  });

  const total = result.length;
  const start = (Number(page) - 1) * Number(pageSize);
  const paged = result.slice(start, start + Number(pageSize));
  return { contracts: paged, total, page: Number(page), pageSize: Number(pageSize) };
}
