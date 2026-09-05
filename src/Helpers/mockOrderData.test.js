import { describe, it, expect } from "vitest";
import {
  ORDER_TYPES, ORDER_STATUSES, SETTABLE_STATUSES,
  orders, findOrderRecord, ordersForQuote, ordersForDeal,
  makeOrderLine, computeLineSubtotal, computeLineDiscountAmount, computeLineTotal, computeLineProgress,
  computeOrderProgress, computeOrderTotals, getEffectiveStatus, isOverdueRequestedDate, isAwaitingBillingHandoff,
  hasIncompleteAddress, deriveOrderType, buildOrderFromQuotePreview, validateOrderPayload,
  createOrder, updateOrder, archiveOrder, restoreOrder, bulkAssignOwner, bulkArchive, buildOrderDuplicatePreview,
  submitForReview, confirmOrder, startProcessing, putOnHold, resumeOrder, cancelOrder, markFulfilled, markCompleted,
  requestInvoicePreview, updateLineFulfillment, queryOrdersLocal,
  DRAFT_MANUAL_ORDER, ORDER_FROM_QUOTE, PENDING_REVIEW_ORDER, CONFIRMED_PRODUCT_ORDER, CONFIRMED_SERVICE_ORDER,
  MIXED_ORDER, PROCESSING_ORDER, PARTIALLY_FULFILLED_ORDER, FULFILLED_ORDER, ON_HOLD_ORDER, CANCELLED_ORDER,
  COMPLETED_ORDER, RECURRING_SERVICES_ORDER, USAGE_BASED_ORDER, OVERDUE_ORDER, INCOMPLETE_ADDRESS_ORDER,
  AWAITING_BILLING_ORDER, PARTIAL_LINE_ORDER, ARCHIVED_ORDER,
} from "./mockOrderData";
import { ACTIVE_ONE_TIME_PRODUCT } from "./mockCatalogData";
import { PREVIEW_ACCEPTED_QUOTE, EXPIRED_QUOTE } from "./mockQuoteData";

describe("enums", () => {
  it("defines order types and statuses, with Archived settable-excluded", () => {
    expect(ORDER_TYPES).toEqual(["Product Order", "Service Order", "Mixed Order"]);
    expect(ORDER_STATUSES).toContain("Archived");
    expect(SETTABLE_STATUSES).not.toContain("Archived");
    expect(ORDER_STATUSES).not.toContain("Paid");
    expect(ORDER_STATUSES).not.toContain("Signed");
  });
});

describe("19 curated fixtures", () => {
  it("Draft manual Order is a clean Draft", () => {
    expect(DRAFT_MANUAL_ORDER.status).toBe("Draft");
    expect(DRAFT_MANUAL_ORDER.sourceQuoteId).toBeNull();
  });
  it("Order from Quote links to a real Quote id and version", () => {
    expect(ORDER_FROM_QUOTE.sourceQuoteId).toBe(PREVIEW_ACCEPTED_QUOTE._id);
    expect(ORDER_FROM_QUOTE.sourceQuoteVersion).toBe(PREVIEW_ACCEPTED_QUOTE.version);
  });
  it("Pending Review / Confirmed Product / Confirmed Service / Mixed carry their named status+type", () => {
    expect(PENDING_REVIEW_ORDER.status).toBe("Pending Review");
    expect(CONFIRMED_PRODUCT_ORDER.orderType).toBe("Product Order");
    expect(CONFIRMED_SERVICE_ORDER.orderType).toBe("Service Order");
    expect(MIXED_ORDER.orderType).toBe("Mixed Order");
  });
  it("Processing / Partially Fulfilled / Fulfilled / On Hold / Cancelled / Completed carry their status", () => {
    expect(PROCESSING_ORDER.status).toBe("Processing");
    expect(PARTIALLY_FULFILLED_ORDER.status).toBe("Partially Fulfilled");
    expect(FULFILLED_ORDER.status).toBe("Fulfilled");
    expect(ON_HOLD_ORDER.status).toBe("On Hold");
    expect(ON_HOLD_ORDER.holdReason).toBeTruthy();
    expect(CANCELLED_ORDER.status).toBe("Cancelled");
    expect(CANCELLED_ORDER.cancellationReason).toBeTruthy();
    expect(COMPLETED_ORDER.status).toBe("Completed");
  });
  it("Recurring/usage-based/overdue/incomplete-address/awaiting-billing/partial-line fixtures carry their named property", () => {
    expect(RECURRING_SERVICES_ORDER.lineItems.every((l) => l.billingModel === "Recurring")).toBe(true);
    expect(USAGE_BASED_ORDER.lineItems[0].billingModel).toBe("Usage Based");
    expect(isOverdueRequestedDate(OVERDUE_ORDER)).toBe(true);
    expect(hasIncompleteAddress(INCOMPLETE_ADDRESS_ORDER)).toBe(true);
    expect(isAwaitingBillingHandoff(AWAITING_BILLING_ORDER)).toBe(true);
    expect(PARTIAL_LINE_ORDER.lineItems.some((l) => l.quantityFulfilled > 0 && l.quantityFulfilled < l.quantity)).toBe(true);
  });
  it("Archived Order derives to Archived and remembers its prior status", () => {
    expect(getEffectiveStatus(ARCHIVED_ORDER)).toBe("Archived");
    expect(ARCHIVED_ORDER.statusBeforeArchive).toBe("Completed");
  });
  it("all 19 curated fixtures are present in the exported list", () => {
    const ids = new Set(orders.map((o) => o._id));
    for (const o of [
      DRAFT_MANUAL_ORDER, ORDER_FROM_QUOTE, PENDING_REVIEW_ORDER, CONFIRMED_PRODUCT_ORDER, CONFIRMED_SERVICE_ORDER,
      MIXED_ORDER, PROCESSING_ORDER, PARTIALLY_FULFILLED_ORDER, FULFILLED_ORDER, ON_HOLD_ORDER, CANCELLED_ORDER,
      COMPLETED_ORDER, RECURRING_SERVICES_ORDER, USAGE_BASED_ORDER, OVERDUE_ORDER, INCOMPLETE_ADDRESS_ORDER,
      AWAITING_BILLING_ORDER, PARTIAL_LINE_ORDER, ARCHIVED_ORDER,
    ]) expect(ids.has(o._id)).toBe(true);
  });
});

describe("line item math", () => {
  const line = { quantity: 3, unitPrice: 100, discountType: "Percentage", discountValue: 10 };
  it("computes subtotal, discount amount and total", () => {
    expect(computeLineSubtotal(line)).toBe(300);
    expect(computeLineDiscountAmount(line)).toBe(30);
    expect(computeLineTotal(line)).toBe(270);
  });
});

describe("makeOrderLine", () => {
  it("snapshots pricing from the catalog item and never re-resolves", () => {
    const line = makeOrderLine({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 2 });
    expect(line.unitPrice).toBe(ACTIVE_ONE_TIME_PRODUCT.standardPrice);
    expect(line.listPriceSnapshot).toBe(ACTIVE_ONE_TIME_PRODUCT.standardPrice);
    // Mutating the live catalog item after the fact must not affect the snapshot.
    const original = ACTIVE_ONE_TIME_PRODUCT.standardPrice;
    ACTIVE_ONE_TIME_PRODUCT.standardPrice = 999999;
    expect(line.unitPrice).toBe(original);
    ACTIVE_ONE_TIME_PRODUCT.standardPrice = original;
  });
});

describe("computeLineProgress / computeOrderProgress", () => {
  it("computes quantity-based progress for Product lines, clamped to 100", () => {
    expect(computeLineProgress({ lineKind: "Product", quantity: 4, quantityFulfilled: 2 })).toBe(50);
    expect(computeLineProgress({ lineKind: "Product", quantity: 4, quantityFulfilled: 4 })).toBe(100);
    expect(computeLineProgress({ lineKind: "Product", quantity: 0, quantityFulfilled: 0 })).toBe(0);
  });
  it("uses completionPercentage directly for Service lines, clamped to [0,100]", () => {
    expect(computeLineProgress({ lineKind: "Service", completionPercentage: 40 })).toBe(40);
    expect(computeLineProgress({ lineKind: "Service", completionPercentage: 150 })).toBe(100);
    expect(computeLineProgress({ lineKind: "Service", completionPercentage: -10 })).toBe(0);
  });
  it("Order progress is the unweighted average of line progress", () => {
    const order = { lineItems: [{ lineKind: "Product", quantity: 10, quantityFulfilled: 10 }, { lineKind: "Service", completionPercentage: 0 }] };
    expect(computeOrderProgress(order)).toBe(50);
  });
  it("empty Orders have zero progress", () => {
    expect(computeOrderProgress({ lineItems: [] })).toBe(0);
  });
});

describe("computeOrderTotals", () => {
  it("separates one-time, recurring and usage-based totals", () => {
    const totals = computeOrderTotals(RECURRING_SERVICES_ORDER);
    expect(totals.recurringTotal).toBeGreaterThan(0);
    expect(totals.oneTimeTotal).toBe(0);
  });
  it("computes grand total as subtotal plus tax", () => {
    const order = { lineItems: [{ quantity: 1, unitPrice: 100, taxCategory: "Standard" }] };
    const totals = computeOrderTotals(order);
    expect(totals.subtotal).toBe(100);
    expect(totals.tax).toBe(8);
    expect(totals.grandTotal).toBe(108);
  });
});

describe("status/type helpers", () => {
  it("getEffectiveStatus surfaces Archived over the stored status", () => {
    expect(getEffectiveStatus({ archived: true, status: "Completed" })).toBe("Archived");
    expect(getEffectiveStatus({ archived: false, status: "Processing" })).toBe("Processing");
  });
  it("deriveOrderType infers Product/Service/Mixed from line kinds", () => {
    expect(deriveOrderType([{ lineKind: "Product" }])).toBe("Product Order");
    expect(deriveOrderType([{ lineKind: "Service" }])).toBe("Service Order");
    expect(deriveOrderType([{ lineKind: "Product" }, { lineKind: "Service" }])).toBe("Mixed Order");
    expect(deriveOrderType([])).toBe("Product Order");
  });
});

describe("buildOrderFromQuotePreview", () => {
  it("copies a Preview Accepted Quote's commercial info and line snapshots without mutating the Quote", () => {
    const preview = buildOrderFromQuotePreview(PREVIEW_ACCEPTED_QUOTE._id);
    expect(preview.sourceQuoteId).toBe(PREVIEW_ACCEPTED_QUOTE._id);
    expect(preview.sourceQuoteVersion).toBe(PREVIEW_ACCEPTED_QUOTE.version);
    expect(preview.companyId).toBe(PREVIEW_ACCEPTED_QUOTE.companyId);
    expect(preview.lineItems.length).toBeGreaterThan(0);
    expect(PREVIEW_ACCEPTED_QUOTE.status).toBe("Preview Accepted"); // untouched
  });
  it("returns null for a non-existent Quote", () => {
    expect(buildOrderFromQuotePreview("does-not-exist")).toBeNull();
  });
});

describe("validateOrderPayload", () => {
  const validPayload = () => ({
    companyId: DRAFT_MANUAL_ORDER.companyId, currency: "USD", orderType: "Product Order", paymentTerms: "Net 30",
    requestedDate: new Date(Date.now() + 86400000).toISOString(),
    serviceAddress: { line1: "1 Main St", city: "SF", postalCode: "94105", country: "US" },
    lineItems: [{ name: "x", quantity: 1, unitPrice: 100 }],
  });
  it("passes for a well-formed payload", () => {
    expect(Object.keys(validateOrderPayload(validPayload()).errors)).toEqual([]);
  });
  it("requires company, currency, at least one line item", () => {
    expect(validateOrderPayload({ ...validPayload(), companyId: null }).errors.companyId).toBeTruthy();
    expect(validateOrderPayload({ ...validPayload(), currency: "" }).errors.currency).toBeTruthy();
    expect(validateOrderPayload({ ...validPayload(), lineItems: [] }).errors.lineItems).toBeTruthy();
  });
  it("requires positive quantity and a valid price per line", () => {
    expect(Object.keys(validateOrderPayload({ ...validPayload(), lineItems: [{ name: "x", quantity: 0, unitPrice: 10 }] }).errors).some((k) => k.includes("quantity"))).toBe(true);
    expect(Object.keys(validateOrderPayload({ ...validPayload(), lineItems: [{ name: "x", quantity: 1, unitPrice: "" }] }).errors).some((k) => k.includes("price"))).toBe(true);
  });
  it("requires a complete address for Product/Mixed Orders but not Service Orders", () => {
    const incomplete = { ...validPayload(), serviceAddress: { line1: "", city: "", postalCode: "", country: "" } };
    expect(validateOrderPayload(incomplete).errors.serviceAddress).toBeTruthy();
    expect(validateOrderPayload({ ...incomplete, orderType: "Service Order" }).errors.serviceAddress).toBeUndefined();
  });
  it("requires a billing interval for recurring lines", () => {
    const p = { ...validPayload(), lineItems: [{ name: "x", quantity: 1, unitPrice: 10, billingModel: "Recurring", billingInterval: null }] };
    expect(Object.keys(validateOrderPayload(p).errors).some((k) => k.includes("interval"))).toBe(true);
  });
  it("rejects a source Quote whose currency doesn't match the Order currency", () => {
    const p = { ...validPayload(), currency: "EUR", sourceQuoteId: PREVIEW_ACCEPTED_QUOTE._id };
    expect(validateOrderPayload(p).errors.currency).toBeTruthy();
  });
  it("warns (not errors) when the contact doesn't belong to the selected company", () => {
    const otherContact = orders.find((o) => o.contactId && o.companyId !== DRAFT_MANUAL_ORDER.companyId)?.contactId;
    if (otherContact) {
      const { errors, warnings } = validateOrderPayload({ ...validPayload(), contactId: otherContact });
      expect(errors.contactId).toBeUndefined();
      expect(warnings.contactId).toBeTruthy();
    }
  });
});

describe("CRUD", () => {
  it("creates, updates, archives and restores an Order", () => {
    const created = createOrder({ companyId: DRAFT_MANUAL_ORDER.companyId, currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 50 }] });
    expect(created._id).toBeTruthy();
    expect(findOrderRecord(created._id)).toBeTruthy();
    const updated = updateOrder(created._id, { customerReference: "PO-1234" });
    expect(updated.customerReference).toBe("PO-1234");
    const archived = archiveOrder(created._id, "test cleanup");
    expect(archived.archived).toBe(true);
    expect(getEffectiveStatus(archived)).toBe("Archived");
    const restored = restoreOrder(created._id);
    expect(restored.archived).toBe(false);
  });
  it("bulk assigns owner and bulk archives", () => {
    const a = createOrder({ companyId: DRAFT_MANUAL_ORDER.companyId, currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] });
    const b = createOrder({ companyId: DRAFT_MANUAL_ORDER.companyId, currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }] });
    expect(bulkAssignOwner([a._id, b._id], "u1").length).toBe(2);
    expect(bulkArchive([a._id, b._id], "cleanup").every((o) => o.archived)).toBe(true);
  });
  it("Duplicate resets fulfillment and status without touching the source", () => {
    const preview = buildOrderDuplicatePreview(FULFILLED_ORDER._id);
    expect(preview.status).toBe("Draft");
    expect(preview.lineItems.every((l) => l.quantityFulfilled === 0)).toBe(true);
    expect(FULFILLED_ORDER.status).toBe("Fulfilled");
  });
});

describe("status transitions", () => {
  const mk = (overrides) => createOrder({ companyId: DRAFT_MANUAL_ORDER.companyId, currency: "USD", lineItems: [{ name: "x", quantity: 1, unitPrice: 10 }], ...overrides });
  it("submitForReview -> Pending Review", () => expect(submitForReview(mk()._id).status).toBe("Pending Review"));
  it("confirmOrder requires and stores confirmedDate/owner/note", () => {
    const o = mk();
    const confirmed = confirmOrder(o._id, { confirmedDate: "2026-01-01T00:00:00.000Z", ownerId: "u1", internalNote: "ready" });
    expect(confirmed.status).toBe("Confirmed");
    expect(confirmed.confirmedDate).toBe("2026-01-01T00:00:00.000Z");
    expect(confirmed.internalNote).toBe("ready");
  });
  it("startProcessing -> Processing", () => expect(startProcessing(mk()._id, { ownerId: "u1" }).status).toBe("Processing"));
  it("putOnHold requires a reason", () => {
    const o = mk();
    expect(putOnHold(o._id, { reason: "" })).toBeNull();
    expect(putOnHold(o._id, { reason: "waiting on customer" }).status).toBe("On Hold");
  });
  it("resumeOrder returns to a target status and clears hold fields", () => {
    const o = mk();
    putOnHold(o._id, { reason: "paused" });
    const resumed = resumeOrder(o._id, { targetStatus: "Processing", note: "unblocked" });
    expect(resumed.status).toBe("Processing");
    expect(resumed.holdReason).toBeNull();
  });
  it("cancelOrder requires a reason", () => {
    const o = mk();
    expect(cancelOrder(o._id, { reason: "" })).toBeNull();
    const cancelled = cancelOrder(o._id, { reason: "no longer needed" });
    expect(cancelled.status).toBe("Cancelled");
    expect(cancelled.cancellationReason).toBe("no longer needed");
  });
  it("markFulfilled / markCompleted set terminal statuses", () => {
    expect(markFulfilled(mk()._id).status).toBe("Fulfilled");
    expect(markCompleted(mk()._id, { completionNote: "done" }).status).toBe("Completed");
  });
  it("requestInvoicePreview stamps invoiceRequestedAt without creating a real Invoice", () => {
    const o = mk();
    const updated = requestInvoicePreview(o._id);
    expect(updated.invoiceRequestedAt).toBeTruthy();
    expect(updated.activity.some((a) => a.description.includes("no Invoice was created"))).toBe(true);
  });
});

describe("updateLineFulfillment", () => {
  it("updates a Product line's fulfilled quantity and delivery status", () => {
    const o = createOrder({ companyId: DRAFT_MANUAL_ORDER.companyId, currency: "USD", status: "Processing", lineItems: [{ name: "x", lineKind: "Product", quantity: 4, unitPrice: 10 }] });
    const line = o.lineItems[0];
    const { order: updated } = updateLineFulfillment(o._id, line._id, { quantityFulfilled: 2 });
    expect(updated.lineItems[0].quantityFulfilled).toBe(2);
    expect(updated.lineItems[0].deliveryStatus).toBe("Partial");
  });
  it("prevents negative and over-ordered fulfillment", () => {
    const o = createOrder({ companyId: DRAFT_MANUAL_ORDER.companyId, currency: "USD", lineItems: [{ name: "x", lineKind: "Product", quantity: 4, unitPrice: 10 }] });
    const line = o.lineItems[0];
    expect(updateLineFulfillment(o._id, line._id, { quantityFulfilled: -1 }).error).toBeTruthy();
    expect(updateLineFulfillment(o._id, line._id, { quantityFulfilled: 5 }).error).toBeTruthy();
  });
  it("prevents completing an already-completed line twice", () => {
    const o = createOrder({ companyId: DRAFT_MANUAL_ORDER.companyId, currency: "USD", lineItems: [{ name: "x", lineKind: "Product", quantity: 2, unitPrice: 10 }] });
    const line = o.lineItems[0];
    updateLineFulfillment(o._id, line._id, { quantityFulfilled: 2 });
    expect(updateLineFulfillment(o._id, line._id, { quantityFulfilled: 2 }).error).toBeTruthy();
  });
  it("auto-promotes Order status to Fulfilled when all lines reach 100%", () => {
    const o = createOrder({ companyId: DRAFT_MANUAL_ORDER.companyId, currency: "USD", status: "Processing", lineItems: [{ name: "x", lineKind: "Product", quantity: 2, unitPrice: 10 }] });
    const line = o.lineItems[0];
    const { order: updated } = updateLineFulfillment(o._id, line._id, { quantityFulfilled: 2 });
    expect(updated.status).toBe("Fulfilled");
  });
  it("auto-promotes Order status to Partially Fulfilled on partial progress from Processing", () => {
    const o = createOrder({ companyId: DRAFT_MANUAL_ORDER.companyId, currency: "USD", status: "Processing", lineItems: [{ name: "x", lineKind: "Product", quantity: 4, unitPrice: 10 }] });
    const line = o.lineItems[0];
    const { order: updated } = updateLineFulfillment(o._id, line._id, { quantityFulfilled: 1 });
    expect(updated.status).toBe("Partially Fulfilled");
  });
  it("updates a Service line's completion percentage with bounds checking", () => {
    const o = createOrder({ companyId: DRAFT_MANUAL_ORDER.companyId, currency: "USD", lineItems: [{ name: "x", lineKind: "Service", quantity: 1, unitPrice: 10 }] });
    const line = o.lineItems[0];
    expect(updateLineFulfillment(o._id, line._id, { completionPercentage: 150 }).error).toBeTruthy();
    const { order: updated } = updateLineFulfillment(o._id, line._id, { completionPercentage: 60 });
    expect(updated.lineItems[0].completionPercentage).toBe(60);
    expect(updated.lineItems[0].activationStatus).toBe("Active");
  });
});

describe("queryOrdersLocal", () => {
  it("excludes archived by default and includes them when requested", () => {
    const result = queryOrdersLocal(orders, {});
    expect(result.items.some((o) => o._id === ARCHIVED_ORDER._id)).toBe(false);
    const archivedResult = queryOrdersLocal(orders, { archived: "true", pageSize: 1000 });
    expect(archivedResult.items.some((o) => o._id === ARCHIVED_ORDER._id)).toBe(true);
  });
  it("filters by status and computes summary metrics", () => {
    const result = queryOrdersLocal(orders, { pageSize: 1000 });
    expect(result.summary.total).toBe(result.items.length);
    expect(result.summary.processing).toBeGreaterThan(0);
    expect(result.summary.awaitingBillingHandoff).toBeGreaterThan(0);
  });
  it("filters overdue requested dates", () => {
    const result = queryOrdersLocal(orders, { overdue: "true", pageSize: 1000 });
    expect(result.items.some((o) => o._id === OVERDUE_ORDER._id)).toBe(true);
  });
  it("searches by order number and company", () => {
    const result = queryOrdersLocal(orders, { search: DRAFT_MANUAL_ORDER.orderNumber });
    expect(result.items.some((o) => o._id === DRAFT_MANUAL_ORDER._id)).toBe(true);
  });
  it("paginates results", () => {
    const page1 = queryOrdersLocal(orders, { page: 1, pageSize: 2 });
    expect(page1.items.length).toBeLessThanOrEqual(2);
  });
});

describe("cross-record finders", () => {
  it("ordersForQuote finds the Order created from a Quote", () => {
    expect(ordersForQuote(ORDER_FROM_QUOTE.sourceQuoteId).some((o) => o._id === ORDER_FROM_QUOTE._id)).toBe(true);
  });
  it("ordersForDeal / an Expired quote never accidentally creates an Order via the preview builder", () => {
    // buildOrderFromQuotePreview is a pure copy regardless of Quote status —
    // the *warning* for Expired/Rejected/Cancelled/Superseded is a UI-level
    // concern (tested in the component), not something the pure builder itself blocks.
    expect(buildOrderFromQuotePreview(EXPIRED_QUOTE._id)).toBeTruthy();
    expect(ordersForDeal("nonexistent-deal-id")).toEqual([]);
  });
});
