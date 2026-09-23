import prisma from "../../lib/prisma.js";
import { recordAuditEvent } from "../auditService.js";
import { nextDocumentNumber } from "./documentNumberService.js";

// Any confirmed order that is still live or already delivered can become a contract.
const ELIGIBLE_ORDER_STATUSES = ["Confirmed", "Processing", "Partially Fulfilled", "Fulfilled", "Completed"];

function snapshotLineItem(line, index) {
  return {
    catalogItemId: line.catalogItemId, isCustomLine: line.isCustomLine, name: line.name, description: line.description,
    unit: line.unit, billingModel: line.billingModel, billingInterval: line.billingInterval, quantity: line.quantity,
    listPriceSnapshot: line.listPriceSnapshot, priceBookIdUsed: line.priceBookIdUsed, priceBookPriceSnapshot: line.priceBookPriceSnapshot,
    unitPrice: line.unitPrice, discountType: line.discountType, discountValue: line.discountValue, taxCategory: line.taxCategory, order: index,
  };
}

function deriveContractType(lineItems) {
  return lineItems.some((l) => l.billingModel === "Recurring") ? "Subscription / Recurring Service Agreement" : "One-Time Agreement";
}

export async function previewOrderToContract(organizationId, orderId) {
  const order = await prisma.order.findFirst({ where: { id: orderId, organizationId }, include: { lineItems: true } });
  if (!order) return { error: { status: 404, code: "SALES_RECORD_NOT_FOUND", message: "Order not found." } };
  if (!ELIGIBLE_ORDER_STATUSES.includes(order.status)) {
    return { error: { status: 400, code: "SALES_INVALID_TRANSITION", message: "Only a Confirmed, In-Progress, or Fulfilled Order can be converted to a Contract." } };
  }
  const existingContract = await prisma.contract.findFirst({ where: { sourceOrderId: order.id, status: { not: "Cancelled" } } });
  if (existingContract) return { error: { status: 409, code: "SALES_DUPLICATE_CONFLICT", message: "A Contract already exists for this Order." } };

  return {
    preview: {
      companyId: order.companyId, contactId: order.contactId, dealId: order.dealId, sourceOrderId: order.id, sourceQuoteId: order.sourceQuoteId,
      currency: order.currency, contractValue: order.grandTotal, contractType: deriveContractType(order.lineItems),
      lineItems: order.lineItems.map((l, i) => snapshotLineItem(l, i)),
    },
  };
}

// Same discipline as quoteToOrderService: transactional, re-checks for a
// duplicate INSIDE the transaction (concurrency-safe), audited, never
// activates the Contract — it is created in "Draft" and only ever moves to
// "Signed"/activated through the dedicated, human-initiated actions.
export async function convertOrderToContract({ organizationId, orderId, actorUserId, actorMembershipId, ipAddress, userAgent, correlationId, termMonths, renewalType, renewalNoticeDays }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, organizationId }, include: { lineItems: true } });
    if (!order) return { error: { status: 404, code: "SALES_RECORD_NOT_FOUND", message: "Order not found." } };
    if (!ELIGIBLE_ORDER_STATUSES.includes(order.status)) {
      return { error: { status: 400, code: "SALES_INVALID_TRANSITION", message: "Only a Confirmed, In-Progress, or Fulfilled Order can be converted to a Contract." } };
    }
    const existingContract = await tx.contract.findFirst({ where: { sourceOrderId: order.id, status: { not: "Cancelled" } } });
    if (existingContract) return { error: { status: 409, code: "SALES_DUPLICATE_CONFLICT", message: "A Contract already exists for this Order." } };

    const contractNumber = await nextDocumentNumber(tx, organizationId, "Contract");
    const lineData = order.lineItems.map((l, i) => snapshotLineItem(l, i));
    const effectiveDate = new Date();
    const endDate = termMonths ? new Date(effectiveDate.getFullYear(), effectiveDate.getMonth() + Number(termMonths), effectiveDate.getDate()) : null;

    const contract = await tx.contract.create({
      data: {
        organizationId, contractNumber, contractType: deriveContractType(order.lineItems), companyId: order.companyId, contactId: order.contactId,
        dealId: order.dealId, sourceOrderId: order.id, sourceQuoteId: order.sourceQuoteId, sourceQuoteVersion: order.sourceQuoteVersion,
        currency: order.currency, status: "Draft", effectiveDate, endDate, termMonths: termMonths ? Number(termMonths) : null,
        renewalType: renewalType || "Manual Renew", renewalNoticeDays: renewalNoticeDays ?? 60, contractValue: order.grandTotal,
        ownerMembershipId: order.ownerMembershipId, createdByMembershipId: actorMembershipId, updatedByMembershipId: actorMembershipId,
        lineItems: { create: lineData },
      },
    });

    await recordAuditEvent({ tx, correlationId, actorUserId, actorMembershipId, organizationId, action: "sales.order.converted_to_contract", targetType: "Contract", targetId: contract.id, result: "Success", after: { sourceOrderId: order.id, contractId: contract.id }, ipAddress, userAgent });
    return { contract };
  });
}
