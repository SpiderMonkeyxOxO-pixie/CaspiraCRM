// In-memory mock Quotes module — a frontend-only Quote management workspace
// built entirely on the shared Companies/Contacts/Deals/Products/Price
// Books data. Same pattern as every other mock*Data.js module: plain
// mutable arrays and business-logic functions instead of a real backend,
// reset on a full page reload. Every Quote line item snapshots its
// name/description/unit at add-time (matching the established Deal
// line-item convention) because a Quote is a document-in-time that must
// stay stable even if the underlying catalog item later changes — this is
// deliberately different from a Price Book pricing *rule*, which never
// snapshots the record it prices.
import { faker } from "@faker-js/faker";
import { CRM_TEAM, findTeamMember } from "./mockUsersData";
import {
  catalogItems, findCatalogItem, TAX_CATEGORIES, BILLING_INTERVALS,
  ACTIVE_ONE_TIME_PRODUCT, ACTIVE_RECURRING_SERVICE, ANNUAL_SUBSCRIPTION_SERVICE,
  USAGE_BASED_SERVICE, TIERED_PRICING_PRODUCT, MONTHLY_MANAGED_SERVICE,
} from "./mockCatalogData";
import {
  findPriceBook, computeEntryFinalPrice, findConflicts as findPriceBookConflicts,
  STANDARD_PRICE_BOOK, ENTERPRISE_CUSTOMER_PRICE_BOOK,
} from "./mockPriceBookData";
import { companies, contacts, deals, findCompany, findContact, findDeal } from "./mockCrmData";

const id = () => faker.database.mongodbObjectId();
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------
export const QUOTE_STATUSES = [
  "Draft", "Internal Review", "Approval Pending", "Approved", "Preview Sent", "Preview Viewed",
  "Preview Accepted", "Preview Rejected", "Expired", "Cancelled", "Superseded",
];
// "Expired" is always DERIVED from the validity date for these statuses —
// never a status a user sets directly. Everything else (including terminal
// preview-customer states) passes through unchanged even past its date.
export const EXPIRABLE_STATUSES = ["Draft", "Internal Review", "Approval Pending", "Approved", "Preview Sent", "Preview Viewed"];
export const APPROVAL_STATUSES = ["Not Required", "Pending", "Approved", "Rejected", "Changes Requested"];
export const DISCOUNT_TYPES = ["Percentage", "Fixed Amount"];
export const PAYMENT_TERMS_OPTIONS = ["Due on Receipt", "Net 15", "Net 30", "Net 45", "Net 60", "50% Upfront, 50% on Delivery"];
export const BILLING_SCHEDULES = ["One-time billing", "Monthly billing", "Quarterly billing", "Annual billing", "Milestone billing"];
export const DOCUMENT_LAYOUTS = ["Standard", "Compact", "Detailed"];
export const CUSTOMER_RESPONSE_TYPES = ["Viewed", "Accepted", "Rejected", "Changes Requested"];
export const HANDOFF_ACTIONS = ["Create Order", "Prepare Contract", "Create Project", "Request Invoice", "Start Onboarding"];
// Preview-only frontend approval threshold — never backend-enforced.
export const DISCOUNT_WARNING_THRESHOLD = 20;
export const EXPIRING_SOON_DAYS = 14;
// A simple, clearly-labeled frontend approximation — not real tax logic.
export const TAX_RATE_PREVIEW = { Standard: 0.08, Reduced: 0.04, "Zero-Rated": 0, Exempt: 0, "Digital Services": 0.08 };

function quoteActivityEntry(type, actor, description, meta = {}) {
  return { _id: id(), type, actor: actor || "System", at: new Date().toISOString(), description, meta };
}
function quoteAuditEntry(action, actor, { field, before, after, reason } = {}) {
  return { _id: id(), action, actor: actor || "System", at: new Date().toISOString(), field: field || null, before: before ?? null, after: after ?? null, reason: reason || null };
}

let quoteCounter = 1000;
function nextQuoteNumber() { return `Q-PREVIEW-${++quoteCounter}`; }

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------
export function makeLineItem(overrides = {}) {
  const catalogItem = overrides.catalogItemId ? findCatalogItem(overrides.catalogItemId) : null;
  return {
    _id: overrides._id || id(),
    catalogItemId: overrides.catalogItemId || null,
    isCustomLine: overrides.isCustomLine ?? !overrides.catalogItemId,
    sectionTitle: overrides.sectionTitle || null,
    order: overrides.order ?? 0,
    name: overrides.name || catalogItem?.name || "Custom line",
    description: overrides.description ?? catalogItem?.shortDescription ?? "",
    unit: overrides.unit || catalogItem?.unit || "Each",
    billingModel: overrides.billingModel || catalogItem?.billingModel || "One Time",
    billingInterval: overrides.billingInterval !== undefined ? overrides.billingInterval : (catalogItem?.billingInterval ?? null),
    quantity: overrides.quantity ?? 1,
    listPrice: overrides.listPrice ?? catalogItem?.standardPrice ?? 0,
    priceBookPrice: overrides.priceBookPrice ?? null,
    priceBookIdUsed: overrides.priceBookIdUsed ?? null,
    unitPrice: overrides.unitPrice ?? (overrides.priceBookPrice ?? catalogItem?.standardPrice ?? 0),
    isOverridden: overrides.isOverridden ?? false,
    overrideReason: overrides.overrideReason || "",
    discountType: overrides.discountType ?? null,
    discountValue: overrides.discountValue ?? null,
    taxCategory: overrides.taxCategory || catalogItem?.taxCategory || "Standard",
    included: overrides.included ?? true,
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
// Price resolution for a single line — reuses the Price Book resolution
// engine directly rather than re-implementing it.
// ---------------------------------------------------------------------------
export function resolveLinePricing({ catalogItemId, priceBookId, quantity }) {
  const catalogItem = findCatalogItem(catalogItemId);
  if (!catalogItem) return null;
  const listPrice = catalogItem.standardPrice;
  if (!priceBookId) {
    return { listPrice, priceBookPrice: null, priceBookIdUsed: null, resolvedPrice: listPrice, reason: "No Price Book selected — using the standard catalog price.", conflict: false };
  }
  const pb = findPriceBook(priceBookId);
  const entry = pb?.items?.find((i) => i.catalogItemId === catalogItemId && i.enabled !== false);
  if (!pb || !entry) {
    return { listPrice, priceBookPrice: null, priceBookIdUsed: null, resolvedPrice: listPrice, reason: pb ? `"${pb.name}" has no entry for this item — using the standard catalog price.` : "Price Book not found — using the standard catalog price.", conflict: false };
  }
  const priced = computeEntryFinalPrice(entry, catalogItem, quantity || entry.minQuantity || 1);
  const conflicts = findPriceBookConflicts(pb);
  return {
    listPrice, priceBookPrice: priced.finalPrice, priceBookIdUsed: pb._id,
    resolvedPrice: priced.finalPrice ?? listPrice,
    reason: priced.finalPrice != null ? `Resolved via "${pb.name}"` : `"${pb.name}" doesn't resolve a numeric price for this item — using the standard catalog price.`,
    conflict: conflicts.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Quote-level totals — one-time, recurring and usage-based are always kept
// separate, never combined into one unexplained number.
// ---------------------------------------------------------------------------
export function computeQuoteTotals(quote) {
  const lines = (quote.lineItems || []).filter((l) => l.included !== false);
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
  const overallDiscountAmount = !quote.overallDiscountType || !quote.overallDiscountValue ? 0
    : quote.overallDiscountType === "Percentage" ? subtotal * (Number(quote.overallDiscountValue) / 100) : Number(quote.overallDiscountValue);
  const discountRatio = subtotal > 0 ? overallDiscountAmount / subtotal : 0;
  let tax = 0;
  for (const line of lines) {
    const taxableAmount = computeLineTotal(line) * (1 - discountRatio);
    tax += taxableAmount * (TAX_RATE_PREVIEW[line.taxCategory] ?? 0);
  }
  const grandTotal = subtotal - overallDiscountAmount + tax;
  return {
    subtotal: round2(subtotal), overallDiscountAmount: round2(overallDiscountAmount), tax: round2(tax),
    oneTimeTotal: round2(oneTimeTotal), monthlyRecurringTotal: round2(monthlyRecurringTotal),
    annualRecurringTotal: round2(annualRecurringTotal), otherRecurringTotal: round2(otherRecurringTotal),
    usageBasedEstimate: round2(usageBasedEstimate), grandTotal: round2(grandTotal),
  };
}

// ---------------------------------------------------------------------------
// Discount/pricing safeguards — frontend preview warnings only, never
// backend-enforced.
// ---------------------------------------------------------------------------
export function computeQuoteWarnings(quote, { allCatalogItems = catalogItems } = {}) {
  const warnings = [];
  const totals = computeQuoteTotals(quote);
  if (totals.grandTotal < 0) warnings.push({ type: "negativeTotal", message: "The grand total is negative." });
  if (quote.overallDiscountType === "Percentage" && Number(quote.overallDiscountValue) > DISCOUNT_WARNING_THRESHOLD) {
    warnings.push({ type: "largeDiscount", message: `Overall discount of ${quote.overallDiscountValue}% exceeds the ${DISCOUNT_WARNING_THRESHOLD}% preview approval threshold.` });
  }
  const hasItemDiscount = (quote.lineItems || []).some((l) => l.discountType && Number(l.discountValue) > 0);
  if (hasItemDiscount && quote.overallDiscountType && Number(quote.overallDiscountValue) > 0) {
    warnings.push({ type: "conflictingDiscounts", message: "Both item-level and overall discounts are applied — review for unintended stacking." });
  }
  (quote.lineItems || []).forEach((line, idx) => {
    const label = line.name || `Line ${idx + 1}`;
    if (computeLineTotal(line) < 0) warnings.push({ type: "negativeLineTotal", message: `"${label}" totals below zero.` });
    if (line.discountType === "Percentage" && Number(line.discountValue) > DISCOUNT_WARNING_THRESHOLD) {
      warnings.push({ type: "largeDiscount", message: `"${label}" discount of ${line.discountValue}% exceeds the ${DISCOUNT_WARNING_THRESHOLD}% preview approval threshold.` });
    }
    if (line.isOverridden && !line.overrideReason?.trim()) {
      warnings.push({ type: "missingOverrideReason", message: `"${label}" has a manual price override with no reason.` });
    }
    const catalogItem = allCatalogItems.find((c) => c._id === line.catalogItemId);
    if (catalogItem?.costPreview != null && Number(line.unitPrice) < catalogItem.costPreview) {
      warnings.push({ type: "belowCost", message: `"${label}" is priced below its cost preview.` });
    }
  });
  return warnings;
}
export function requiresApproval(quote) {
  return computeQuoteWarnings(quote).some((w) => ["largeDiscount", "belowCost", "negativeTotal"].includes(w.type));
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------
export function getEffectiveStatus(quote, atDate = new Date()) {
  if (!EXPIRABLE_STATUSES.includes(quote.status)) return quote.status;
  if (quote.validUntilDate && new Date(atDate) > new Date(quote.validUntilDate)) return "Expired";
  return quote.status;
}
export function isExpiringSoon(quote, days = EXPIRING_SOON_DAYS) {
  if (getEffectiveStatus(quote) !== quote.status) return false; // already expired
  if (!EXPIRABLE_STATUSES.includes(quote.status) || !quote.validUntilDate) return false;
  const msLeft = new Date(quote.validUntilDate).getTime() - Date.now();
  return msLeft > 0 && msLeft <= days * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Quote builder
// ---------------------------------------------------------------------------
function makeQuote(overrides = {}) {
  const owner = overrides.ownerId === null ? null : findTeamMember(overrides.ownerId) || faker.helpers.arrayElement(CRM_TEAM);
  const createdAt = overrides.createdAt || faker.date.past({ years: 1 }).toISOString();
  const rootId = overrides.rootId || id();
  const version = overrides.version ?? 1;
  const base = {
    _id: id(), rootId,
    quoteNumber: overrides.quoteNumber || nextQuoteNumber(), version,
    title: overrides.title || "Untitled Quote",
    companyId: overrides.companyId || null, primaryContactId: overrides.primaryContactId || null, dealId: overrides.dealId || null,
    ownerId: owner?.id || null, ownerName: owner?.name || null, assignedTeam: overrides.assignedTeam || "Sales",
    priceBookId: overrides.priceBookId || null, currency: overrides.currency || "USD",
    status: overrides.status || "Draft",
    issueDate: overrides.issueDate || daysAgo(0),
    validUntilDate: overrides.validUntilDate !== undefined ? overrides.validUntilDate : daysFromNow(30),
    lineItems: (overrides.lineItems || []).map((l, i) => makeLineItem({ ...l, order: l.order ?? i })),
    overallDiscountType: overrides.overallDiscountType ?? null, overallDiscountValue: overrides.overallDiscountValue ?? null,
    paymentTerms: overrides.paymentTerms || "Net 30", billingSchedule: overrides.billingSchedule || "One-time billing",
    serviceStartEstimate: overrides.serviceStartEstimate || "", deliveryEstimate: overrides.deliveryEstimate || "",
    minimumCommitment: overrides.minimumCommitment || "", renewalSummary: overrides.renewalSummary || "",
    customerNote: overrides.customerNote || "", internalNote: overrides.internalNote || "",
    termsAndConditions: overrides.termsAndConditions || "Standard preview terms and conditions apply. This is a frontend preview document only.",
    assumptions: overrides.assumptions || "", exclusions: overrides.exclusions || "",
    documentLayout: overrides.documentLayout || "Standard",
    changeSummary: overrides.changeSummary || (version > 1 ? "Updated pricing" : ""),
    supersededBy: overrides.supersededBy ?? null,
    approval: overrides.approval || { required: false, requestedBy: null, requestedAt: null, reviewerId: null, reviewerName: null, reason: null, status: "Not Required", comments: [] },
    sendPreview: overrides.sendPreview ?? null,
    customerResponse: overrides.customerResponse ?? null,
    files: overrides.files || [],
    auditLog: [],
    archived: overrides.archived ?? false, archiveReason: overrides.archiveReason || null, archivedAt: overrides.archivedAt || null, statusBeforeArchive: overrides.statusBeforeArchive || null,
    createdBy: overrides.createdBy || "System", updatedBy: overrides.updatedBy || "System",
    createdAt, updatedAt: overrides.updatedAt || createdAt,
  };
  base.activity = overrides.activity || [quoteActivityEntry("created", base.createdBy, `Quote ${base.quoteNumber} (v${base.version}) created`)];
  return base;
}

// ---------------------------------------------------------------------------
// Curated fixtures — one real, findable Quote for every scenario named in
// the /sales/quotes spec.
// ---------------------------------------------------------------------------
const FIXTURE_COMPANY = companies.find((c) => c.accountType === "Customer") || companies[0];
const FIXTURE_CONTACT = contacts.find((c) => c.companyId === FIXTURE_COMPANY._id) || contacts[0];
const FIXTURE_DEAL = deals.find((d) => d.companyId === FIXTURE_COMPANY._id) || deals[0];
const WON_DEAL = deals.find((d) => d.status === "Won") || deals[0];
const WON_DEAL_CONTACT = contacts.find((c) => c.companyId === WON_DEAL.companyId) || contacts[0];

// 1. New Draft
export const NEW_DRAFT_QUOTE = makeQuote({
  title: "Onboarding Package Proposal", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  dealId: FIXTURE_DEAL?._id || null, priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Draft",
  lineItems: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 1, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice }],
});

// 2. Draft with missing information (no contact, no line items yet)
export const DRAFT_MISSING_INFO_QUOTE = makeQuote({
  title: "Untitled Quote", companyId: FIXTURE_COMPANY._id, primaryContactId: null, dealId: null,
  priceBookId: null, currency: "USD", status: "Draft", lineItems: [],
});

// 3. Internal Review
export const INTERNAL_REVIEW_QUOTE = makeQuote({
  title: "Managed Services Renewal", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Internal Review",
  lineItems: [{ catalogItemId: MONTHLY_MANAGED_SERVICE._id, quantity: 1, unitPrice: MONTHLY_MANAGED_SERVICE.standardPrice }],
});

// 4. Approval Pending — a large item discount triggers a formal approval.
export const APPROVAL_PENDING_QUOTE = makeQuote({
  title: "Enterprise Platform Deal", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: ENTERPRISE_CUSTOMER_PRICE_BOOK._id, currency: "USD", status: "Approval Pending",
  lineItems: [{ catalogItemId: ANNUAL_SUBSCRIPTION_SERVICE._id, quantity: 1, unitPrice: ANNUAL_SUBSCRIPTION_SERVICE.standardPrice, discountType: "Percentage", discountValue: 30 }],
  approval: { required: true, requestedBy: "Grace Kim", requestedAt: daysAgo(1), reviewerId: null, reviewerName: "Marcus Chen", reason: "Discount exceeds the 20% preview threshold", status: "Pending", comments: [] },
});

// 5. Approved
export const APPROVED_QUOTE = makeQuote({
  title: "Support Plan Expansion", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Approved",
  lineItems: [{ catalogItemId: ACTIVE_RECURRING_SERVICE._id, quantity: 2, unitPrice: ACTIVE_RECURRING_SERVICE.standardPrice }],
  approval: { required: true, requestedBy: "Grace Kim", requestedAt: daysAgo(3), reviewerId: null, reviewerName: "Marcus Chen", reason: "Manager review requested", status: "Approved", comments: [{ author: "Marcus Chen", at: daysAgo(2), text: "Looks good — approved.", type: "Approve" }] },
});

// 6. Preview Sent
export const PREVIEW_SENT_QUOTE = makeQuote({
  title: "Cloud Hosting Agreement", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Preview Sent",
  lineItems: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 1, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice }],
  sendPreview: { recipientEmail: FIXTURE_CONTACT?.email || "customer@example.com", cc: "", subject: "Your Quote from Caspira", message: "Please find your quote attached.", sentAt: daysAgo(2) },
});

// 7. Preview Viewed
export const PREVIEW_VIEWED_QUOTE = makeQuote({
  title: "Analytics Add-on Proposal", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Preview Viewed",
  lineItems: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 1, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice }],
  sendPreview: { recipientEmail: FIXTURE_CONTACT?.email || "customer@example.com", cc: "", subject: "Your Quote from Caspira", message: "Please review.", sentAt: daysAgo(3) },
  customerResponse: { type: "Viewed", at: daysAgo(1), customerName: null, jobTitle: null, typedNamePreview: null, reason: null },
});

// 8. Preview Accepted
export const PREVIEW_ACCEPTED_QUOTE = makeQuote({
  title: "Professional Services Package", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Preview Accepted",
  lineItems: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 1, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice }],
  sendPreview: { recipientEmail: FIXTURE_CONTACT?.email || "customer@example.com", cc: "", subject: "Your Quote from Caspira", message: "Please review.", sentAt: daysAgo(5) },
  customerResponse: { type: "Accepted", at: daysAgo(2), customerName: FIXTURE_CONTACT?.name || "Jordan Customer", jobTitle: "Operations Manager", typedNamePreview: FIXTURE_CONTACT?.name || "Jordan Customer", reason: null },
});

// 9. Preview Rejected
export const PREVIEW_REJECTED_QUOTE = makeQuote({
  title: "Legacy Migration Quote", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Preview Rejected",
  lineItems: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 1, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice }],
  sendPreview: { recipientEmail: FIXTURE_CONTACT?.email || "customer@example.com", cc: "", subject: "Your Quote from Caspira", message: "Please review.", sentAt: daysAgo(6) },
  customerResponse: { type: "Rejected", at: daysAgo(4), customerName: FIXTURE_CONTACT?.name || "Jordan Customer", jobTitle: "Finance Director", typedNamePreview: null, reason: "Pricing exceeds our budget for this cycle." },
});

// 10. Expired — status is still "Preview Sent" internally; getEffectiveStatus derives "Expired" from the past validUntilDate.
export const EXPIRED_QUOTE = makeQuote({
  title: "Q1 Renewal Quote", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Preview Sent", validUntilDate: daysAgo(5),
  lineItems: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 1, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice }],
  sendPreview: { recipientEmail: FIXTURE_CONTACT?.email || "customer@example.com", cc: "", subject: "Your Quote from Caspira", message: "Please review.", sentAt: daysAgo(20) },
});

// 11. Cancelled
export const CANCELLED_QUOTE = makeQuote({
  title: "Discontinued Hardware Order", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: null, currency: "USD", status: "Cancelled",
  lineItems: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 1, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice }],
});

// 12 / 19. Multi-version family — v1 Superseded, v2 the current version.
const MULTI_VERSION_ROOT = id();
export const SUPERSEDED_QUOTE = makeQuote({
  rootId: MULTI_VERSION_ROOT, version: 1, title: "Platform Subscription — Initial Proposal",
  companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null, priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD",
  status: "Superseded", createdAt: daysAgo(20), updatedAt: daysAgo(15),
  lineItems: [{ catalogItemId: ANNUAL_SUBSCRIPTION_SERVICE._id, quantity: 1, unitPrice: ANNUAL_SUBSCRIPTION_SERVICE.standardPrice }],
});
export const MULTI_VERSION_QUOTE = makeQuote({
  rootId: MULTI_VERSION_ROOT, version: 2, quoteNumber: SUPERSEDED_QUOTE.quoteNumber, title: "Platform Subscription — Revised Proposal",
  companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null, priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD",
  status: "Approved", createdAt: daysAgo(15), changeSummary: "Reduced seat count and added a support add-on based on customer feedback.",
  lineItems: [
    { catalogItemId: ANNUAL_SUBSCRIPTION_SERVICE._id, quantity: 1, unitPrice: ANNUAL_SUBSCRIPTION_SERVICE.standardPrice },
    { catalogItemId: ACTIVE_RECURRING_SERVICE._id, quantity: 1, unitPrice: ACTIVE_RECURRING_SERVICE.standardPrice },
  ],
});
SUPERSEDED_QUOTE.supersededBy = MULTI_VERSION_QUOTE._id;
SUPERSEDED_QUOTE.activity.push(quoteActivityEntry("superseded", "System", `Superseded by version 2 (${MULTI_VERSION_QUOTE._id})`));

// 13. Quote with one-time items
export const ONE_TIME_ITEMS_QUOTE = makeQuote({
  title: "Hardware and Setup Bundle", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Draft",
  lineItems: [
    { catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 2, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice },
    { isCustomLine: true, name: "On-site setup labor", description: "One-time on-site configuration visit", unit: "Each", billingModel: "One Time", quantity: 1, unitPrice: 350, taxCategory: "Standard" },
  ],
});

// 14. Quote with recurring services
export const RECURRING_SERVICES_QUOTE = makeQuote({
  title: "Ongoing Support & Hosting", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Draft",
  lineItems: [
    { catalogItemId: ACTIVE_RECURRING_SERVICE._id, quantity: 1, unitPrice: ACTIVE_RECURRING_SERVICE.standardPrice },
    { catalogItemId: ANNUAL_SUBSCRIPTION_SERVICE._id, quantity: 1, unitPrice: ANNUAL_SUBSCRIPTION_SERVICE.standardPrice },
  ],
});

// 15. Quote with usage-based pricing
export const USAGE_BASED_QUOTE_FIXTURE = makeQuote({
  title: "API Platform Usage Estimate", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: null, currency: "USD", status: "Draft",
  lineItems: [{ catalogItemId: USAGE_BASED_SERVICE._id, quantity: 100000, unitPrice: USAGE_BASED_SERVICE.usageConfig?.unitPrice || 0.001, billingModel: "Usage Based", taxCategory: "Digital Services" }],
});

// 16. Quote with item-level discounts
export const ITEM_DISCOUNTS_QUOTE = makeQuote({
  title: "Volume Seat License Order", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Draft",
  lineItems: [
    { catalogItemId: TIERED_PRICING_PRODUCT._id, quantity: 50, unitPrice: TIERED_PRICING_PRODUCT.standardPrice, discountType: "Percentage", discountValue: 10 },
    { catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 1, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice, discountType: "Fixed Amount", discountValue: 50 },
  ],
});

// 17. Quote with overall discount
export const OVERALL_DISCOUNT_QUOTE = makeQuote({
  title: "Bundled Renewal Offer", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Draft",
  overallDiscountType: "Percentage", overallDiscountValue: 25,
  lineItems: [
    { catalogItemId: ACTIVE_RECURRING_SERVICE._id, quantity: 1, unitPrice: ACTIVE_RECURRING_SERVICE.standardPrice },
    { catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 1, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice },
  ],
});

// 18. Quote with tax
export const TAX_QUOTE = makeQuote({
  title: "Taxable Standard Order", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Draft",
  lineItems: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 3, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice, taxCategory: "Standard" }],
});

// 20. Quote requiring approval (not yet submitted — content alone would trigger it)
export const APPROVAL_REQUIRED_QUOTE = makeQuote({
  title: "Deep Discount Renewal Draft", companyId: FIXTURE_COMPANY._id, primaryContactId: FIXTURE_CONTACT?._id || null,
  priceBookId: STANDARD_PRICE_BOOK._id, currency: "USD", status: "Draft",
  lineItems: [{ catalogItemId: ACTIVE_RECURRING_SERVICE._id, quantity: 1, unitPrice: ACTIVE_RECURRING_SERVICE.standardPrice, discountType: "Percentage", discountValue: 35 }],
});

// 21. Quote connected to a Won Deal preview
export const WON_DEAL_QUOTE = makeQuote({
  title: "Closed-Won Order Confirmation", companyId: WON_DEAL.companyId, primaryContactId: WON_DEAL_CONTACT?._id || null,
  dealId: WON_DEAL._id, priceBookId: STANDARD_PRICE_BOOK._id, currency: WON_DEAL.currency || "USD", status: "Preview Accepted",
  lineItems: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 1, unitPrice: ACTIVE_ONE_TIME_PRODUCT.standardPrice }],
  sendPreview: { recipientEmail: WON_DEAL_CONTACT?.email || "customer@example.com", cc: "", subject: "Your Quote from Caspira", message: "Confirming your order.", sentAt: daysAgo(10) },
  customerResponse: { type: "Accepted", at: daysAgo(8), customerName: WON_DEAL_CONTACT?.name || "Customer", jobTitle: "Decision Maker", typedNamePreview: WON_DEAL_CONTACT?.name || "Customer", reason: null },
});

const CURATED_QUOTES = [
  NEW_DRAFT_QUOTE, DRAFT_MISSING_INFO_QUOTE, INTERNAL_REVIEW_QUOTE, APPROVAL_PENDING_QUOTE, APPROVED_QUOTE,
  PREVIEW_SENT_QUOTE, PREVIEW_VIEWED_QUOTE, PREVIEW_ACCEPTED_QUOTE, PREVIEW_REJECTED_QUOTE, EXPIRED_QUOTE,
  CANCELLED_QUOTE, SUPERSEDED_QUOTE, MULTI_VERSION_QUOTE, ONE_TIME_ITEMS_QUOTE, RECURRING_SERVICES_QUOTE,
  USAGE_BASED_QUOTE_FIXTURE, ITEM_DISCOUNTS_QUOTE, OVERALL_DISCOUNT_QUOTE, TAX_QUOTE, APPROVAL_REQUIRED_QUOTE, WON_DEAL_QUOTE,
];

const RANDOM_QUOTES = faker.helpers.multiple(() => {
  const company = faker.helpers.arrayElement(companies);
  const item = faker.helpers.arrayElement(catalogItems.filter((c) => c.standardPrice != null));
  return makeQuote({
    companyId: company._id, primaryContactId: (contacts.find((c) => c.companyId === company._id) || {})._id || null,
    priceBookId: faker.helpers.arrayElement([null, STANDARD_PRICE_BOOK._id]),
    lineItems: [{ catalogItemId: item._id, quantity: faker.number.int({ min: 1, max: 5 }), unitPrice: item.standardPrice }],
  });
}, { count: 8 });

export const quotes = [...CURATED_QUOTES, ...RANDOM_QUOTES];

// ---------------------------------------------------------------------------
// Finders
// ---------------------------------------------------------------------------
export function findQuoteRecord(quoteId) {
  return quotes.find((q) => q._id === quoteId);
}
export function getQuoteFamily(rootId) {
  return quotes.filter((q) => q.rootId === rootId).sort((a, b) => a.version - b.version);
}
export function quotesForDeal(dealId) {
  return quotes.filter((q) => q.dealId === dealId);
}
export function quotesForCompany(companyId) {
  return quotes.filter((q) => q.companyId === companyId);
}
export function quotesForPriceBook(priceBookId) {
  return quotes.filter((q) => q.priceBookId === priceBookId);
}
export function quotesForCatalogItem(catalogItemId) {
  return quotes.filter((q) => (q.lineItems || []).some((li) => li.catalogItemId === catalogItemId));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export function validateQuotePayload(payload, { forSubmit = false } = {}) {
  const errors = {};
  const warnings = {};

  if (!payload.companyId) errors.companyId = "Company is required";
  if (payload.primaryContactId) {
    const contact = findContact(payload.primaryContactId);
    if (contact && contact.companyId !== payload.companyId) warnings.primaryContactId = "This contact doesn't belong to the selected Company — confirm before continuing.";
  }
  if (!payload.title?.trim()) errors.title = "Quote title is required";
  if (!payload.currency) errors.currency = "Currency is required";
  if (payload.priceBookId) {
    const pb = findPriceBook(payload.priceBookId);
    if (pb && pb.currency !== payload.currency) errors.priceBookId = `Selected Price Book is priced in ${pb.currency}, not the Quote's currency (${payload.currency}).`;
  }
  if (payload.issueDate && payload.validUntilDate && new Date(payload.issueDate) >= new Date(payload.validUntilDate)) {
    errors.validUntilDate = "Valid-until date must be after the issue date";
  }
  if (!(payload.lineItems || []).length) errors.lineItems = "Add at least one line item";

  (payload.lineItems || []).forEach((line, idx) => {
    const label = line.name || `Line ${idx + 1}`;
    if (!(Number(line.quantity) > 0)) errors[`line_${idx}_quantity`] = `"${label}" needs a positive quantity`;
    if (line.unitPrice === "" || line.unitPrice === null || line.unitPrice === undefined || Number.isNaN(Number(line.unitPrice))) {
      errors[`line_${idx}_price`] = `"${label}" needs a valid price`;
    }
    if (line.discountType && (line.discountValue === "" || line.discountValue === null || Number.isNaN(Number(line.discountValue)) || Number(line.discountValue) < 0)) {
      errors[`line_${idx}_discount`] = `"${label}" has an invalid discount value`;
    }
    if (line.billingModel === "Recurring" && !line.billingInterval) errors[`line_${idx}_interval`] = `"${label}" needs a billing interval`;
    if (line.isOverridden && !line.overrideReason?.trim()) errors[`line_${idx}_override`] = `"${label}" needs a reason for its manual price override`;
  });

  if (forSubmit && !payload.termsAndConditions?.trim()) errors.termsAndConditions = "Terms and conditions are required before submitting for review";

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export function createQuote(payload, actor = "System") {
  const quote = makeQuote({ ...payload, createdBy: actor, updatedBy: actor, createdAt: new Date().toISOString() });
  quotes.unshift(quote);
  return quote;
}

const AUDIT_TRACKED_FIELDS = ["status", "priceBookId", "currency", "ownerId", "validUntilDate"];

export function updateQuote(quoteId, changes, actor = "System") {
  const quote = findQuoteRecord(quoteId);
  if (!quote) return null;

  if (changes.ownerId !== undefined && changes.ownerId !== quote.ownerId) {
    const newOwner = findTeamMember(changes.ownerId);
    changes.ownerName = newOwner?.name || null;
  }
  if (changes.status && changes.status !== quote.status) {
    quote.activity.push(quoteActivityEntry("status_changed", actor, `Status changed from ${quote.status} to ${changes.status}`));
  }
  if (changes.lineItems && JSON.stringify(changes.lineItems) !== JSON.stringify(quote.lineItems)) {
    quote.activity.push(quoteActivityEntry("line_items_changed", actor, "Line items or pricing changed"));
    changes.lineItems = changes.lineItems.map((l) => makeLineItem(l));
  }
  for (const field of AUDIT_TRACKED_FIELDS) {
    if (field in changes && changes[field] !== quote[field]) {
      quote.auditLog.push(quoteAuditEntry("update", actor, { field, before: quote[field] ?? null, after: changes[field] ?? null, reason: changes.reason || null }));
    }
  }

  Object.assign(quote, changes);
  quote.updatedAt = new Date().toISOString();
  quote.updatedBy = actor;
  return quote;
}

export function archiveQuote(quoteId, reason, actor = "System") {
  const quote = findQuoteRecord(quoteId);
  if (!quote) return null;
  quote.statusBeforeArchive = quote.status;
  quote.archived = true;
  quote.archiveReason = reason;
  quote.archivedAt = new Date().toISOString();
  quote.activity.push(quoteActivityEntry("archived", actor, `Archived: ${reason}`));
  quote.auditLog.push(quoteAuditEntry("archive", actor, { field: "archived", before: false, after: true, reason }));
  quote.updatedAt = new Date().toISOString();
  quote.updatedBy = actor;
  return quote;
}
export function restoreQuote(quoteId, actor = "System") {
  const quote = findQuoteRecord(quoteId);
  if (!quote) return null;
  quote.archived = false;
  quote.archiveReason = null;
  quote.archivedAt = null;
  quote.statusBeforeArchive = null;
  quote.activity.push(quoteActivityEntry("restored", actor, "Restored from archive"));
  quote.auditLog.push(quoteAuditEntry("restore", actor, { field: "archived", before: true, after: false }));
  quote.updatedAt = new Date().toISOString();
  quote.updatedBy = actor;
  return quote;
}

export function bulkAssignOwner(quoteIds, ownerId, actor = "System") {
  return quoteIds.map((qid) => updateQuote(qid, { ownerId }, actor)).filter(Boolean);
}
export function bulkArchive(quoteIds, reason, actor = "System") {
  return quoteIds.map((qid) => archiveQuote(qid, reason, actor)).filter(Boolean);
}

// A pure preview — never touches `quotes` until the caller explicitly
// saves it. Duplicate creates a wholly unrelated new Quote (new family);
// New Version stays in the same family (see buildNewVersionPreview).
export function buildQuoteDuplicatePreview(quoteId) {
  const source = findQuoteRecord(quoteId);
  if (!source) return null;
  return {
    ...source, _id: undefined, rootId: undefined, quoteNumber: undefined, version: 1,
    title: `${source.title} (Copy)`, status: "Draft",
    approval: { required: false, requestedBy: null, requestedAt: null, reviewerId: null, reviewerName: null, reason: null, status: "Not Required", comments: [] },
    sendPreview: null, customerResponse: null, changeSummary: "", supersededBy: null,
    archived: false, archiveReason: null, archivedAt: null, statusBeforeArchive: null,
    activity: [], auditLog: [], files: [], createdAt: undefined, updatedAt: undefined,
    lineItems: source.lineItems.map((l) => ({ ...l, _id: undefined })),
  };
}

export function buildNewVersionPreview(quoteId) {
  const source = findQuoteRecord(quoteId);
  if (!source) return null;
  const family = getQuoteFamily(source.rootId);
  const nextVersion = Math.max(...family.map((q) => q.version)) + 1;
  return {
    ...source, _id: undefined, rootId: source.rootId, quoteNumber: source.quoteNumber, version: nextVersion,
    status: "Draft", changeSummary: "",
    approval: { required: false, requestedBy: null, requestedAt: null, reviewerId: null, reviewerName: null, reason: null, status: "Not Required", comments: [] },
    sendPreview: null, customerResponse: null, supersededBy: null,
    archived: false, archiveReason: null, archivedAt: null, statusBeforeArchive: null,
    activity: [], auditLog: [], files: [], createdAt: undefined, updatedAt: undefined,
    lineItems: source.lineItems.map((l) => ({ ...l, _id: undefined })),
  };
}

// Called when a new version is actually SAVED — marks the previous active
// version Superseded only now, per "do not overwrite an accepted or sent
// version directly."
export function confirmNewVersion(previousQuoteId, newVersionPayload, actor = "System") {
  const newQuote = createQuote(newVersionPayload, actor);
  const previous = findQuoteRecord(previousQuoteId);
  if (previous) {
    previous.status = "Superseded";
    previous.supersededBy = newQuote._id;
    previous.activity.push(quoteActivityEntry("superseded", actor, `Superseded by version ${newQuote.version} (${newQuote.quoteNumber})`));
    previous.updatedAt = new Date().toISOString();
    previous.updatedBy = actor;
  }
  newQuote.activity.push(quoteActivityEntry("version_created", actor, `Version ${newQuote.version} created from version ${previous?.version ?? "?"}`));
  return { newQuote, previous };
}

// ---------------------------------------------------------------------------
// Review / approval workflow — internal, distinct from the customer-facing
// Preview Accepted/Rejected states.
// ---------------------------------------------------------------------------
export function submitForReview(quoteId, actor = "System") {
  const quote = findQuoteRecord(quoteId);
  if (!quote) return null;
  const needsApproval = requiresApproval(quote);
  if (needsApproval) {
    quote.status = "Approval Pending";
    quote.approval = { ...quote.approval, required: true, requestedBy: actor, requestedAt: new Date().toISOString(), status: "Pending" };
    quote.activity.push(quoteActivityEntry("review_requested", actor, "Submitted for formal approval (discount/pricing threshold triggered)"));
  } else {
    quote.status = "Internal Review";
    quote.activity.push(quoteActivityEntry("review_requested", actor, "Submitted for internal review"));
  }
  quote.updatedAt = new Date().toISOString();
  quote.updatedBy = actor;
  return quote;
}
export function approveReview(quoteId, actor, comment) {
  const quote = findQuoteRecord(quoteId);
  if (!quote) return null;
  quote.status = "Approved";
  quote.approval = { ...quote.approval, status: "Approved", comments: [...(quote.approval?.comments || []), { author: actor, at: new Date().toISOString(), text: comment || "", type: "Approve" }] };
  quote.activity.push(quoteActivityEntry("approved", actor, "Preview approved"));
  quote.updatedAt = new Date().toISOString();
  quote.updatedBy = actor;
  return quote;
}
export function rejectReview(quoteId, actor, comment) {
  if (!comment?.trim()) return null;
  const quote = findQuoteRecord(quoteId);
  if (!quote) return null;
  quote.status = "Draft";
  quote.approval = { ...quote.approval, status: "Rejected", comments: [...(quote.approval?.comments || []), { author: actor, at: new Date().toISOString(), text: comment, type: "Reject" }] };
  quote.activity.push(quoteActivityEntry("changes_requested", actor, `Review rejected: ${comment}`));
  quote.updatedAt = new Date().toISOString();
  quote.updatedBy = actor;
  return quote;
}
export function requestReviewChanges(quoteId, actor, comment) {
  if (!comment?.trim()) return null;
  const quote = findQuoteRecord(quoteId);
  if (!quote) return null;
  quote.status = "Draft";
  quote.approval = { ...quote.approval, status: "Changes Requested", comments: [...(quote.approval?.comments || []), { author: actor, at: new Date().toISOString(), text: comment, type: "Request Changes" }] };
  quote.activity.push(quoteActivityEntry("changes_requested", actor, `Changes requested: ${comment}`));
  quote.updatedAt = new Date().toISOString();
  quote.updatedBy = actor;
  return quote;
}
export function cancelQuote(quoteId, actor, reason) {
  const quote = findQuoteRecord(quoteId);
  if (!quote) return null;
  quote.status = "Cancelled";
  quote.activity.push(quoteActivityEntry("cancelled", actor, reason ? `Cancelled: ${reason}` : "Cancelled"));
  quote.updatedAt = new Date().toISOString();
  quote.updatedBy = actor;
  return quote;
}

// ---------------------------------------------------------------------------
// Preview Send / customer response simulation — never a real email, never a
// real customer action.
// ---------------------------------------------------------------------------
export function previewSend(quoteId, { recipientEmail, cc, subject, message }, actor = "System") {
  const quote = findQuoteRecord(quoteId);
  if (!quote) return null;
  quote.sendPreview = { recipientEmail, cc: cc || "", subject, message, sentAt: new Date().toISOString() };
  quote.status = "Preview Sent";
  quote.activity.push(quoteActivityEntry("preview_sent", actor, `Preview send simulated to ${recipientEmail} — no email was actually sent`));
  quote.updatedAt = new Date().toISOString();
  quote.updatedBy = actor;
  return quote;
}

export function simulateCustomerResponse(quoteId, type, details = {}, actor = "System") {
  const quote = findQuoteRecord(quoteId);
  if (!quote) return null;
  if ((type === "Rejected" || type === "Changes Requested") && !details.reason?.trim()) return null;
  quote.customerResponse = { type, at: new Date().toISOString(), customerName: details.customerName || null, jobTitle: details.jobTitle || null, typedNamePreview: details.typedNamePreview || null, reason: details.reason || null };
  if (type === "Viewed") quote.status = "Preview Viewed";
  else if (type === "Accepted") quote.status = "Preview Accepted";
  else if (type === "Rejected") quote.status = "Preview Rejected";
  else if (type === "Changes Requested") quote.status = "Draft";
  quote.activity.push(quoteActivityEntry(`preview_${type.toLowerCase().replace(" ", "_")}`, actor, `Customer response simulated: ${type}`));
  quote.updatedAt = new Date().toISOString();
  quote.updatedBy = actor;
  return quote;
}

// ---------------------------------------------------------------------------
// Query — filter/sort/paginate client-side, same pattern as every other
// mock*Data.js query function.
// ---------------------------------------------------------------------------
export function queryQuotesLocal(list, params = {}) {
  const {
    search = "", status, approvalStatus, companyId, contactId, dealId, ownerId, team, currency, priceBookId,
    issueDateFrom, issueDateTo, validUntilFrom, validUntilTo, expiringSoon, totalMin, totalMax,
    hasRecurring, hasDiscounts, archived = "false", sort = "updatedAt", order = "desc", page = 1, pageSize = 20,
  } = params;

  const effectiveArchived = status === "Archived" ? "true" : archived;

  let result = list.filter((q) => {
    if (effectiveArchived === "true" && !q.archived) return false;
    if (effectiveArchived !== "true" && q.archived) return false;
    const effStatus = getEffectiveStatus(q);
    if (status && status !== "Archived" && effStatus !== status) return false;
    if (approvalStatus && q.approval?.status !== approvalStatus) return false;
    if (companyId && q.companyId !== companyId) return false;
    if (contactId && q.primaryContactId !== contactId) return false;
    if (dealId && q.dealId !== dealId) return false;
    if (ownerId && q.ownerId !== ownerId) return false;
    if (team && q.assignedTeam !== team) return false;
    if (currency && q.currency !== currency) return false;
    if (priceBookId && q.priceBookId !== priceBookId) return false;
    if (issueDateFrom && (!q.issueDate || new Date(q.issueDate) < new Date(issueDateFrom))) return false;
    if (issueDateTo && (!q.issueDate || new Date(q.issueDate) > new Date(issueDateTo))) return false;
    if (validUntilFrom && (!q.validUntilDate || new Date(q.validUntilDate) < new Date(validUntilFrom))) return false;
    if (validUntilTo && (!q.validUntilDate || new Date(q.validUntilDate) > new Date(validUntilTo))) return false;
    if (expiringSoon === "true" && !isExpiringSoon(q)) return false;
    const totals = computeQuoteTotals(q);
    if (totalMin !== undefined && totalMin !== "" && totals.grandTotal < Number(totalMin)) return false;
    if (totalMax !== undefined && totalMax !== "" && totals.grandTotal > Number(totalMax)) return false;
    if (hasRecurring === "true" && totals.monthlyRecurringTotal === 0 && totals.annualRecurringTotal === 0 && totals.otherRecurringTotal === 0) return false;
    if (hasDiscounts === "true" && !q.overallDiscountType && !(q.lineItems || []).some((l) => l.discountType)) return false;
    if (search) {
      const qStr = search.toLowerCase();
      const company = findCompany(q.companyId);
      const haystack = `${q.quoteNumber} ${q.title} ${company?.name || ""}`.toLowerCase();
      if (!haystack.includes(qStr)) return false;
    }
    return true;
  });

  const summary = {
    total: result.length,
    draft: result.filter((q) => getEffectiveStatus(q) === "Draft").length,
    approvalPending: result.filter((q) => getEffectiveStatus(q) === "Approval Pending").length,
    approved: result.filter((q) => getEffectiveStatus(q) === "Approved").length,
    previewSent: result.filter((q) => getEffectiveStatus(q) === "Preview Sent").length,
    expiringSoon: result.filter((q) => isExpiringSoon(q)).length,
    previewAcceptedValue: round2(result.filter((q) => getEffectiveStatus(q) === "Preview Accepted").reduce((sum, q) => sum + computeQuoteTotals(q).grandTotal, 0)),
  };

  result = [...result].sort((a, b) => {
    const dir = order === "asc" ? 1 : -1;
    let av, bv;
    if (sort === "total") { av = computeQuoteTotals(a).grandTotal; bv = computeQuoteTotals(b).grandTotal; }
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

export { findCompany, findContact, findDeal };
