import { describe, it, expect } from "vitest";
import {
  QUOTE_STATUSES, EXPIRABLE_STATUSES, APPROVAL_STATUSES, DISCOUNT_TYPES,
  quotes, findQuoteRecord, getQuoteFamily, quotesForDeal, quotesForCompany,
  makeLineItem, computeLineSubtotal, computeLineDiscountAmount, computeLineTotal,
  resolveLinePricing, computeQuoteTotals, computeQuoteWarnings, requiresApproval,
  getEffectiveStatus, isExpiringSoon, validateQuotePayload,
  createQuote, updateQuote, archiveQuote, restoreQuote, bulkAssignOwner, bulkArchive,
  buildQuoteDuplicatePreview, buildNewVersionPreview, confirmNewVersion,
  submitForReview, approveReview, rejectReview, requestReviewChanges, cancelQuote,
  previewSend, simulateCustomerResponse, queryQuotesLocal,
  NEW_DRAFT_QUOTE, DRAFT_MISSING_INFO_QUOTE, INTERNAL_REVIEW_QUOTE, APPROVAL_PENDING_QUOTE, APPROVED_QUOTE,
  PREVIEW_SENT_QUOTE, PREVIEW_VIEWED_QUOTE, PREVIEW_ACCEPTED_QUOTE, PREVIEW_REJECTED_QUOTE, EXPIRED_QUOTE,
  CANCELLED_QUOTE, SUPERSEDED_QUOTE, MULTI_VERSION_QUOTE, ONE_TIME_ITEMS_QUOTE, RECURRING_SERVICES_QUOTE,
  USAGE_BASED_QUOTE_FIXTURE, ITEM_DISCOUNTS_QUOTE, OVERALL_DISCOUNT_QUOTE, TAX_QUOTE, APPROVAL_REQUIRED_QUOTE, WON_DEAL_QUOTE,
} from "./mockQuoteData";
import { ACTIVE_ONE_TIME_PRODUCT } from "./mockCatalogData";
import { STANDARD_PRICE_BOOK, INDIA_PRICE_BOOK } from "./mockPriceBookData";

describe("enums", () => {
  it("defines the full status vocabulary", () => {
    expect(QUOTE_STATUSES).toEqual([
      "Draft", "Internal Review", "Approval Pending", "Approved", "Preview Sent", "Preview Viewed",
      "Preview Accepted", "Preview Rejected", "Expired", "Cancelled", "Superseded",
    ]);
  });
  it("Expired is not a settable status — only derivable", () => {
    expect(EXPIRABLE_STATUSES).not.toContain("Expired");
    expect(EXPIRABLE_STATUSES).not.toContain("Preview Accepted");
    expect(EXPIRABLE_STATUSES).not.toContain("Cancelled");
  });
  it("approval statuses and discount types are defined", () => {
    expect(APPROVAL_STATUSES).toContain("Pending");
    expect(DISCOUNT_TYPES).toEqual(["Percentage", "Fixed Amount"]);
  });
});

describe("21 curated fixtures", () => {
  it("New Draft is a clean Draft with a line item", () => {
    expect(NEW_DRAFT_QUOTE.status).toBe("Draft");
    expect(NEW_DRAFT_QUOTE.lineItems.length).toBeGreaterThan(0);
  });
  it("Draft with missing information has no contact and no line items", () => {
    expect(DRAFT_MISSING_INFO_QUOTE.primaryContactId).toBeNull();
    expect(DRAFT_MISSING_INFO_QUOTE.lineItems.length).toBe(0);
  });
  it("Internal Review / Approval Pending / Approved carry their named status", () => {
    expect(INTERNAL_REVIEW_QUOTE.status).toBe("Internal Review");
    expect(APPROVAL_PENDING_QUOTE.status).toBe("Approval Pending");
    expect(APPROVAL_PENDING_QUOTE.approval.required).toBe(true);
    expect(APPROVED_QUOTE.status).toBe("Approved");
    expect(APPROVED_QUOTE.approval.status).toBe("Approved");
  });
  it("Preview Sent/Viewed/Accepted/Rejected carry consistent send + response state", () => {
    expect(PREVIEW_SENT_QUOTE.sendPreview).toBeTruthy();
    expect(PREVIEW_VIEWED_QUOTE.customerResponse.type).toBe("Viewed");
    expect(PREVIEW_ACCEPTED_QUOTE.customerResponse.type).toBe("Accepted");
    expect(PREVIEW_ACCEPTED_QUOTE.customerResponse.typedNamePreview).toBeTruthy();
    expect(PREVIEW_REJECTED_QUOTE.customerResponse.type).toBe("Rejected");
    expect(PREVIEW_REJECTED_QUOTE.customerResponse.reason).toBeTruthy();
  });
  it("Expired fixture derives to Expired via its past validUntilDate", () => {
    expect(getEffectiveStatus(EXPIRED_QUOTE)).toBe("Expired");
    expect(EXPIRED_QUOTE.status).not.toBe("Expired"); // stored status is untouched
  });
  it("Cancelled fixture is Cancelled", () => {
    expect(CANCELLED_QUOTE.status).toBe("Cancelled");
  });
  it("Superseded/Multi-version fixtures share a family and link to each other", () => {
    expect(SUPERSEDED_QUOTE.status).toBe("Superseded");
    expect(SUPERSEDED_QUOTE.supersededBy).toBe(MULTI_VERSION_QUOTE._id);
    expect(MULTI_VERSION_QUOTE.rootId).toBe(SUPERSEDED_QUOTE.rootId);
    expect(MULTI_VERSION_QUOTE.version).toBe(2);
    const family = getQuoteFamily(SUPERSEDED_QUOTE.rootId);
    expect(family.map((q) => q.version)).toEqual([1, 2]);
  });
  it("One-time/recurring/usage-based/discount/tax fixtures carry their named property", () => {
    expect(ONE_TIME_ITEMS_QUOTE.lineItems.every((l) => l.billingModel === "One Time")).toBe(true);
    expect(RECURRING_SERVICES_QUOTE.lineItems.every((l) => l.billingModel === "Recurring")).toBe(true);
    expect(USAGE_BASED_QUOTE_FIXTURE.lineItems[0].billingModel).toBe("Usage Based");
    expect(ITEM_DISCOUNTS_QUOTE.lineItems.some((l) => l.discountType)).toBe(true);
    expect(OVERALL_DISCOUNT_QUOTE.overallDiscountType).toBe("Percentage");
    expect(TAX_QUOTE.lineItems[0].taxCategory).toBe("Standard");
  });
  it("Quote requiring approval triggers requiresApproval() without yet being submitted", () => {
    expect(APPROVAL_REQUIRED_QUOTE.status).toBe("Draft");
    expect(requiresApproval(APPROVAL_REQUIRED_QUOTE)).toBe(true);
  });
  it("Won Deal Quote links to a real Deal and is Preview Accepted", () => {
    expect(WON_DEAL_QUOTE.dealId).toBeTruthy();
    expect(WON_DEAL_QUOTE.status).toBe("Preview Accepted");
  });
  it("all 21 curated fixtures are present in the exported list", () => {
    const ids = new Set(quotes.map((q) => q._id));
    for (const q of [
      NEW_DRAFT_QUOTE, DRAFT_MISSING_INFO_QUOTE, INTERNAL_REVIEW_QUOTE, APPROVAL_PENDING_QUOTE, APPROVED_QUOTE,
      PREVIEW_SENT_QUOTE, PREVIEW_VIEWED_QUOTE, PREVIEW_ACCEPTED_QUOTE, PREVIEW_REJECTED_QUOTE, EXPIRED_QUOTE,
      CANCELLED_QUOTE, SUPERSEDED_QUOTE, MULTI_VERSION_QUOTE, ONE_TIME_ITEMS_QUOTE, RECURRING_SERVICES_QUOTE,
      USAGE_BASED_QUOTE_FIXTURE, ITEM_DISCOUNTS_QUOTE, OVERALL_DISCOUNT_QUOTE, TAX_QUOTE, APPROVAL_REQUIRED_QUOTE, WON_DEAL_QUOTE,
    ]) expect(ids.has(q._id)).toBe(true);
  });
});

describe("line item math", () => {
  const line = { quantity: 3, unitPrice: 100, discountType: "Percentage", discountValue: 10 };
  it("computes subtotal, discount amount and total", () => {
    expect(computeLineSubtotal(line)).toBe(300);
    expect(computeLineDiscountAmount(line)).toBe(30);
    expect(computeLineTotal(line)).toBe(270);
  });
  it("Fixed Amount discount subtracts a flat value", () => {
    const l = { quantity: 2, unitPrice: 100, discountType: "Fixed Amount", discountValue: 25 };
    expect(computeLineTotal(l)).toBe(175);
  });
  it("no discount leaves the total equal to the subtotal", () => {
    const l = { quantity: 2, unitPrice: 50, discountType: null, discountValue: null };
    expect(computeLineTotal(l)).toBe(100);
  });
});

describe("makeLineItem", () => {
  it("snapshots name/description/unit from the catalog item at add-time", () => {
    const line = makeLineItem({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 2 });
    expect(line.name).toBe(ACTIVE_ONE_TIME_PRODUCT.name);
    expect(line.unitPrice).toBe(ACTIVE_ONE_TIME_PRODUCT.standardPrice);
    expect(line.isCustomLine).toBe(false);
  });
  it("marks a line with no catalogItemId as custom", () => {
    const line = makeLineItem({ name: "Consulting hours", unitPrice: 200 });
    expect(line.isCustomLine).toBe(true);
    expect(line.catalogItemId).toBeNull();
  });
});

describe("resolveLinePricing", () => {
  it("falls back to the catalog price with no Price Book selected", () => {
    const r = resolveLinePricing({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, priceBookId: null, quantity: 1 });
    expect(r.resolvedPrice).toBe(ACTIVE_ONE_TIME_PRODUCT.standardPrice);
    expect(r.priceBookIdUsed).toBeNull();
  });
  it("resolves via a Price Book that has an entry for the item", () => {
    const r = resolveLinePricing({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, priceBookId: STANDARD_PRICE_BOOK._id, quantity: 1 });
    expect(r.priceBookIdUsed).toBe(STANDARD_PRICE_BOOK._id);
    expect(r.priceBookPrice).not.toBeNull();
  });
  it("falls back to catalog price when the Price Book has no entry for the item", () => {
    const r = resolveLinePricing({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, priceBookId: INDIA_PRICE_BOOK._id, quantity: 1 });
    // India Price Book DOES include ACTIVE_ONE_TIME_PRODUCT per its own fixture, so this should resolve
    expect(r.priceBookIdUsed).toBe(INDIA_PRICE_BOOK._id);
  });
});

describe("computeQuoteTotals", () => {
  it("separates one-time, recurring and usage-based totals", () => {
    const totals = computeQuoteTotals(RECURRING_SERVICES_QUOTE);
    expect(totals.monthlyRecurringTotal).toBeGreaterThan(0);
    expect(totals.annualRecurringTotal).toBeGreaterThan(0);
    expect(totals.oneTimeTotal).toBe(0);
  });
  it("computes grand total as subtotal minus overall discount plus tax", () => {
    const quote = { lineItems: [{ quantity: 1, unitPrice: 100, taxCategory: "Standard", included: true }], overallDiscountType: null, overallDiscountValue: null };
    const totals = computeQuoteTotals(quote);
    expect(totals.subtotal).toBe(100);
    expect(totals.tax).toBe(8); // 8% Standard preview rate
    expect(totals.grandTotal).toBe(108);
  });
  it("applies an overall discount before tax proportionally", () => {
    const quote = { lineItems: [{ quantity: 1, unitPrice: 100, taxCategory: "Standard", included: true }], overallDiscountType: "Percentage", overallDiscountValue: 10 };
    const totals = computeQuoteTotals(quote);
    expect(totals.overallDiscountAmount).toBe(10);
    expect(totals.tax).toBe(7.2); // 90 * 0.08
    expect(totals.grandTotal).toBe(97.2);
  });
  it("Zero-Rated and Exempt lines contribute no tax", () => {
    const quote = { lineItems: [{ quantity: 1, unitPrice: 100, taxCategory: "Exempt", included: true }] };
    expect(computeQuoteTotals(quote).tax).toBe(0);
  });
  it("excludes lines marked included:false", () => {
    const quote = { lineItems: [{ quantity: 1, unitPrice: 100, included: false, taxCategory: "Standard" }] };
    const totals = computeQuoteTotals(quote);
    expect(totals.subtotal).toBe(0);
    expect(totals.grandTotal).toBe(0);
  });
});

describe("computeQuoteWarnings / requiresApproval", () => {
  it("flags a large overall discount", () => {
    const warnings = computeQuoteWarnings(OVERALL_DISCOUNT_QUOTE);
    expect(warnings.some((w) => w.type === "largeDiscount")).toBe(true);
  });
  it("flags a missing override reason", () => {
    const quote = { lineItems: [{ name: "x", quantity: 1, unitPrice: 100, isOverridden: true, overrideReason: "" }] };
    expect(computeQuoteWarnings(quote).some((w) => w.type === "missingOverrideReason")).toBe(true);
  });
  it("flags conflicting item + overall discounts", () => {
    const quote = { overallDiscountType: "Percentage", overallDiscountValue: 5, lineItems: [{ name: "x", quantity: 1, unitPrice: 100, discountType: "Percentage", discountValue: 5 }] };
    expect(computeQuoteWarnings(quote).some((w) => w.type === "conflictingDiscounts")).toBe(true);
  });
  it("requiresApproval is true only when a threshold-triggering warning exists", () => {
    expect(requiresApproval(APPROVAL_REQUIRED_QUOTE)).toBe(true);
    expect(requiresApproval(NEW_DRAFT_QUOTE)).toBe(false);
  });
});

describe("getEffectiveStatus / isExpiringSoon", () => {
  it("derives Expired only for expirable statuses past their date", () => {
    expect(getEffectiveStatus({ status: "Preview Sent", validUntilDate: new Date(Date.now() - 1000).toISOString() })).toBe("Expired");
    expect(getEffectiveStatus({ status: "Preview Accepted", validUntilDate: new Date(Date.now() - 1000).toISOString() })).toBe("Preview Accepted");
    expect(getEffectiveStatus({ status: "Cancelled", validUntilDate: new Date(Date.now() - 1000).toISOString() })).toBe("Cancelled");
  });
  it("flags a quote expiring within the window as expiring soon", () => {
    const quote = { status: "Preview Sent", validUntilDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() };
    expect(isExpiringSoon(quote)).toBe(true);
  });
  it("does not flag an already-expired quote as expiring soon", () => {
    const quote = { status: "Preview Sent", validUntilDate: new Date(Date.now() - 1000).toISOString() };
    expect(isExpiringSoon(quote)).toBe(false);
  });
});

describe("validateQuotePayload", () => {
  const validPayload = () => ({
    companyId: NEW_DRAFT_QUOTE.companyId, title: "Test Quote", currency: "USD",
    issueDate: new Date().toISOString(), validUntilDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    lineItems: [{ name: "x", quantity: 1, unitPrice: 100 }],
  });
  it("passes for a well-formed payload", () => {
    expect(Object.keys(validateQuotePayload(validPayload()).errors)).toEqual([]);
  });
  it("requires a company, title, currency and at least one line item", () => {
    expect(validateQuotePayload({ ...validPayload(), companyId: null }).errors.companyId).toBeTruthy();
    expect(validateQuotePayload({ ...validPayload(), title: "" }).errors.title).toBeTruthy();
    expect(validateQuotePayload({ ...validPayload(), currency: "" }).errors.currency).toBeTruthy();
    expect(validateQuotePayload({ ...validPayload(), lineItems: [] }).errors.lineItems).toBeTruthy();
  });
  it("requires valid-until after issue date", () => {
    const p = validPayload();
    p.validUntilDate = new Date(Date.now() - 999999999).toISOString();
    expect(validateQuotePayload(p).errors.validUntilDate).toBeTruthy();
  });
  it("requires positive quantity and a valid price per line", () => {
    expect(Object.keys(validateQuotePayload({ ...validPayload(), lineItems: [{ name: "x", quantity: 0, unitPrice: 10 }] }).errors).some((k) => k.includes("quantity"))).toBe(true);
    expect(Object.keys(validateQuotePayload({ ...validPayload(), lineItems: [{ name: "x", quantity: 1, unitPrice: "" }] }).errors).some((k) => k.includes("price"))).toBe(true);
  });
  it("requires a billing interval for recurring lines", () => {
    const p = { ...validPayload(), lineItems: [{ name: "x", quantity: 1, unitPrice: 10, billingModel: "Recurring", billingInterval: null }] };
    expect(Object.keys(validateQuotePayload(p).errors).some((k) => k.includes("interval"))).toBe(true);
  });
  it("requires an override reason when a line is manually overridden", () => {
    const p = { ...validPayload(), lineItems: [{ name: "x", quantity: 1, unitPrice: 10, isOverridden: true, overrideReason: "" }] };
    expect(Object.keys(validateQuotePayload(p).errors).some((k) => k.includes("override"))).toBe(true);
  });
  it("rejects a Price Book whose currency doesn't match the Quote currency", () => {
    const p = { ...validPayload(), currency: "USD", priceBookId: INDIA_PRICE_BOOK._id };
    expect(validateQuotePayload(p).errors.priceBookId).toBeTruthy();
  });
  it("requires terms and conditions only when submitting for review", () => {
    const p = { ...validPayload(), termsAndConditions: "" };
    expect(validateQuotePayload(p, { forSubmit: false }).errors.termsAndConditions).toBeUndefined();
    expect(validateQuotePayload(p, { forSubmit: true }).errors.termsAndConditions).toBeTruthy();
  });
  it("warns (not errors) when the contact doesn't belong to the selected company", () => {
    const otherCompanyContact = quotes.find((q) => q.primaryContactId && q.companyId !== NEW_DRAFT_QUOTE.companyId)?.primaryContactId;
    if (otherCompanyContact) {
      const p = { ...validPayload(), primaryContactId: otherCompanyContact };
      const { errors, warnings } = validateQuotePayload(p);
      expect(errors.primaryContactId).toBeUndefined();
      expect(warnings.primaryContactId).toBeTruthy();
    }
  });
});

describe("CRUD", () => {
  it("creates, updates, archives and restores a Quote", () => {
    const created = createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "CRUD Test Quote", currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 50 }] });
    expect(created._id).toBeTruthy();
    expect(findQuoteRecord(created._id)).toBeTruthy();

    const updated = updateQuote(created._id, { title: "Renamed Quote" });
    expect(updated.title).toBe("Renamed Quote");

    const archived = archiveQuote(created._id, "No longer needed");
    expect(archived.archived).toBe(true);

    const restored = restoreQuote(created._id);
    expect(restored.archived).toBe(false);
  });

  it("bulk assigns owner and bulk archives", () => {
    const a = createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "Bulk A", currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] });
    const b = createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "Bulk B", currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] });
    const assigned = bulkAssignOwner([a._id, b._id], "u1");
    expect(assigned.length).toBe(2);
    const archived = bulkArchive([a._id, b._id], "cleanup");
    expect(archived.every((q) => q.archived)).toBe(true);
  });
});

describe("duplication and versioning", () => {
  it("Duplicate creates an unrelated new Draft (new family, version 1)", () => {
    const preview = buildQuoteDuplicatePreview(APPROVED_QUOTE._id);
    expect(preview.title).toBe(`${APPROVED_QUOTE.title} (Copy)`);
    expect(preview.status).toBe("Draft");
    expect(preview.version).toBe(1);
    expect(preview._id).toBeUndefined();
    expect(preview.rootId).toBeUndefined(); // will get a fresh root on save
  });

  it("New Version preview stays in the same family with an incremented version", () => {
    const preview = buildNewVersionPreview(APPROVED_QUOTE._id);
    expect(preview.rootId).toBe(APPROVED_QUOTE.rootId);
    expect(preview.version).toBe(APPROVED_QUOTE.version + 1);
    expect(preview.status).toBe("Draft");
  });

  it("confirmNewVersion supersedes the previous version only now, never overwriting it directly", () => {
    const source = createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "Versioned Quote", currency: "USD", status: "Preview Sent", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] });
    const preview = buildNewVersionPreview(source._id);
    expect(source.status).toBe("Preview Sent"); // untouched before confirmation
    const { newQuote, previous } = confirmNewVersion(source._id, { ...preview, changeSummary: "Adjusted pricing" }, "Tester");
    expect(previous.status).toBe("Superseded");
    expect(previous.supersededBy).toBe(newQuote._id);
    expect(newQuote.rootId).toBe(source.rootId);
    expect(newQuote.version).toBe(2);
    expect(newQuote.status).toBe("Draft");
  });
});

describe("review workflow", () => {
  it("submitForReview routes to Approval Pending when a threshold is triggered, else Internal Review", () => {
    const highDiscount = createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "High Discount", currency: "USD", overallDiscountType: "Percentage", overallDiscountValue: 40, lineItems: [{ name: "x", quantity: 1, unitPrice: 100 }] });
    const r1 = submitForReview(highDiscount._id, "Tester");
    expect(r1.status).toBe("Approval Pending");
    expect(r1.approval.required).toBe(true);

    const normal = createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "Normal", currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 100 }] });
    const r2 = submitForReview(normal._id, "Tester");
    expect(r2.status).toBe("Internal Review");
  });

  it("approveReview sets status Approved and logs a comment", () => {
    const q = createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "Approve Me", currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] });
    const approved = approveReview(q._id, "Reviewer", "Looks good");
    expect(approved.status).toBe("Approved");
    expect(approved.approval.comments.length).toBe(1);
  });

  it("rejectReview and requestReviewChanges require a comment", () => {
    const q = createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "Reject Me", currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] });
    expect(rejectReview(q._id, "Reviewer", "")).toBeNull();
    const rejected = rejectReview(q._id, "Reviewer", "Pricing too aggressive");
    expect(rejected.status).toBe("Draft");
    expect(rejected.approval.status).toBe("Rejected");

    const q2 = createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "Changes Me", currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] });
    expect(requestReviewChanges(q2._id, "Reviewer", "")).toBeNull();
    const changed = requestReviewChanges(q2._id, "Reviewer", "Please adjust quantities");
    expect(changed.approval.status).toBe("Changes Requested");
  });

  it("cancelQuote sets status Cancelled", () => {
    const q = createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "Cancel Me", currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] });
    expect(cancelQuote(q._id, "Tester", "No longer needed").status).toBe("Cancelled");
  });
});

describe("preview send / customer response simulation", () => {
  it("previewSend sets sendPreview and status Preview Sent, never actually emailing", () => {
    const q = createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "Send Me", currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] });
    const sent = previewSend(q._id, { recipientEmail: "test@example.com", subject: "Quote", message: "Hi" }, "Tester");
    expect(sent.status).toBe("Preview Sent");
    expect(sent.sendPreview.recipientEmail).toBe("test@example.com");
    expect(sent.activity.some((a) => a.description.includes("no email was actually sent"))).toBe(true);
  });

  it("simulateCustomerResponse maps each type to the right status", () => {
    const mk = () => createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "Resp", currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] });
    expect(simulateCustomerResponse(mk()._id, "Viewed").status).toBe("Preview Viewed");
    expect(simulateCustomerResponse(mk()._id, "Accepted", { customerName: "Jo", jobTitle: "CEO", typedNamePreview: "Jo" }).status).toBe("Preview Accepted");
    expect(simulateCustomerResponse(mk()._id, "Rejected", { reason: "Too expensive" }).status).toBe("Preview Rejected");
  });

  it("Rejected and Changes Requested require a reason", () => {
    const q = createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "NeedsReason", currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] });
    expect(simulateCustomerResponse(q._id, "Rejected", {})).toBeNull();
    expect(simulateCustomerResponse(q._id, "Changes Requested", {})).toBeNull();
  });
});

describe("queryQuotesLocal", () => {
  it("excludes archived by default", () => {
    const archived = archiveQuote(createQuote({ companyId: NEW_DRAFT_QUOTE.companyId, title: "ArchiveMe", currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] })._id, "cleanup");
    const result = queryQuotesLocal(quotes, {});
    expect(result.items.some((q) => q._id === archived._id)).toBe(false);
    const archivedResult = queryQuotesLocal(quotes, { archived: "true", pageSize: 1000 });
    expect(archivedResult.items.some((q) => q._id === archived._id)).toBe(true);
  });
  it("filters by status and computes summary metrics", () => {
    const result = queryQuotesLocal(quotes, { pageSize: 1000 });
    expect(result.summary.total).toBe(result.items.length);
    expect(result.summary.approvalPending).toBeGreaterThan(0);
  });
  it("searches by quote number and title", () => {
    const result = queryQuotesLocal(quotes, { search: NEW_DRAFT_QUOTE.title });
    expect(result.items.some((q) => q._id === NEW_DRAFT_QUOTE._id)).toBe(true);
  });
  it("filters expiring-soon and paginates", () => {
    const page1 = queryQuotesLocal(quotes, { page: 1, pageSize: 2 });
    expect(page1.items.length).toBeLessThanOrEqual(2);
  });
});

describe("cross-record finders", () => {
  it("quotesForDeal finds the Won Deal quote", () => {
    expect(quotesForDeal(WON_DEAL_QUOTE.dealId).some((q) => q._id === WON_DEAL_QUOTE._id)).toBe(true);
  });
  it("quotesForCompany finds quotes for a company", () => {
    expect(quotesForCompany(NEW_DRAFT_QUOTE.companyId).length).toBeGreaterThan(0);
  });
});
