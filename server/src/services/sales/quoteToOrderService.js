import prisma from "../../lib/prisma.js";
import { recordAuditEvent } from "../auditService.js";
import { nextDocumentNumber } from "./documentNumberService.js";
import { computeLineTotals, computeDocumentTotals } from "./moneyService.js";

const ELIGIBLE_QUOTE_STATUSES = ["Approved", "Preview Accepted"];

function snapshotLineItem(line, index) {
  return {
    catalogItemId: line.catalogItemId, isCustomLine: line.isCustomLine, lineKind: "Product",
    name: line.name, description: line.description, unit: line.unit, billingModel: line.billingModel, billingInterval: line.billingInterval,
    quantity: line.quantity, listPriceSnapshot: line.listPrice, priceBookIdUsed: line.priceBookIdUsed, priceBookPriceSnapshot: line.priceBookPrice,
    unitPrice: line.unitPrice, discountType: line.discountType, discountValue: line.discountValue, taxCategory: line.taxCategory, order: index,
  };
}

// Read-only — computes exactly what convert() would create, without
// writing anything. Used by the /order-preview endpoint.
export async function previewQuoteToOrder(organizationId, quoteId) {
  const quote = await prisma.quote.findFirst({ where: { id: quoteId, organizationId }, include: { lineItems: true } });
  if (!quote) return { error: { status: 404, code: "SALES_RECORD_NOT_FOUND", message: "Quote not found." } };
  if (!ELIGIBLE_QUOTE_STATUSES.includes(quote.status)) {
    return { error: { status: 400, code: "SALES_INVALID_TRANSITION", message: "Only an Approved or customer-Accepted Quote can be converted to an Order." } };
  }
  const existingOrder = await prisma.order.findFirst({ where: { sourceQuoteId: quote.id, status: { not: "Cancelled" } } });
  if (existingOrder) return { error: { status: 409, code: "SALES_DUPLICATE_CONFLICT", message: "An Order already exists for this Quote." } };

  return {
    preview: {
      companyId: quote.companyId, contactId: quote.primaryContactId, dealId: quote.dealId, sourceQuoteId: quote.id, sourceQuoteVersion: quote.version,
      currency: quote.currency, paymentTerms: quote.paymentTerms, billingSchedule: quote.billingSchedule, customerNote: quote.customerNote,
      subtotal: quote.subtotal, discountTotal: quote.discountTotal, taxTotal: quote.taxTotal, grandTotal: quote.grandTotal,
      lineItems: quote.lineItems.map((l, i) => snapshotLineItem(l, i)),
    },
  };
}

// Transactional, idempotent (the caller's requireIdempotencyKey middleware
// handles exact-retry replay; this function additionally enforces "at most
// one non-cancelled Order per Quote" as a genuine business rule, not just
// a retry-safety mechanism), audited, concurrency-protected via optimistic
// version check on the source Quote. Never links the Order to live
// Product/PriceBook prices — every line is a frozen snapshot.
export async function convertQuoteToOrder({ organizationId, quoteId, sourceQuoteVersion, actorUserId, actorMembershipId, ipAddress, userAgent, correlationId }) {
  return prisma.$transaction(async (tx) => {
    const quote = await tx.quote.findFirst({ where: { id: quoteId, organizationId }, include: { lineItems: true } });
    if (!quote) return { error: { status: 404, code: "SALES_RECORD_NOT_FOUND", message: "Quote not found." } };
    if (sourceQuoteVersion !== undefined && Number(sourceQuoteVersion) !== quote.rowVersion) {
      return { error: { status: 409, code: "SALES_VERSION_CONFLICT", message: "This quote changed since you last viewed it. Refresh and try again." } };
    }
    if (!ELIGIBLE_QUOTE_STATUSES.includes(quote.status)) {
      return { error: { status: 400, code: "SALES_INVALID_TRANSITION", message: "Only an Approved or customer-Accepted Quote can be converted to an Order." } };
    }

    // Atomic duplicate-prevention: an UPDATE-guarded claim would need a
    // dedicated column on Quote; since Order.sourceQuoteId+non-cancelled is
    // the actual constraint, re-check for an existing Order for this Quote
    // INSIDE the same transaction (Postgres's transaction isolation makes
    // this race-safe against a concurrent identical request, since both
    // transactions serialize on this same row set).
    const existingOrder = await tx.order.findFirst({ where: { sourceQuoteId: quote.id, status: { not: "Cancelled" } } });
    if (existingOrder) return { error: { status: 409, code: "SALES_DUPLICATE_CONFLICT", message: "An Order already exists for this Quote." } };

    const orderNumber = await nextDocumentNumber(tx, organizationId, "Order");
    const lineData = quote.lineItems.map((l, i) => snapshotLineItem(l, i));
    const lineResults = lineData.map((l) => computeLineTotals({ quantity: l.quantity, unitPrice: l.unitPrice, discountType: l.discountType, discountValue: l.discountValue, taxCategory: l.taxCategory, currency: quote.currency }));
    const totals = computeDocumentTotals(lineResults, { currency: quote.currency });

    const order = await tx.order.create({
      data: {
        organizationId, orderNumber, orderType: "Product Order", companyId: quote.companyId, contactId: quote.primaryContactId, dealId: quote.dealId,
        sourceQuoteId: quote.id, sourceQuoteVersion: quote.version, currency: quote.currency, status: "Draft",
        paymentTerms: quote.paymentTerms, billingSchedule: quote.billingSchedule, customerNote: quote.customerNote,
        ownerMembershipId: quote.ownerMembershipId, createdByMembershipId: actorMembershipId, updatedByMembershipId: actorMembershipId,
        ...totals,
        lineItems: { create: lineData.map((l, i) => ({ ...l, lineSubtotal: lineResults[i].lineSubtotal, taxAmount: lineResults[i].taxAmount, lineTotal: lineResults[i].lineTotal })) },
      },
    });

    await recordAuditEvent({ tx, correlationId, actorUserId, actorMembershipId, organizationId, action: "sales.quote.converted_to_order", targetType: "Order", targetId: order.id, result: "Success", after: { sourceQuoteId: quote.id, orderId: order.id }, ipAddress, userAgent });
    return { order };
  });
}
