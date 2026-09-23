// Backend Phase 6 — the one place invoices are created, whether by hand, from
// a recurring template or from a confirmed Sales order. Always a Draft,
// numbered per organization, with totals computed server-side.
import { nextDocumentNumber } from "../sales/documentNumberService.js";
import { computeInvoice, DEFAULT_DUE_DAYS } from "./financeRulesService.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function createDraftInvoice(tx, { organizationId, membershipId, companyId = null, dealId = null, orderId = null, recurringInvoiceId = null, source = "Manual", lines, currency = "USD", dueDate = null, dueDays = DEFAULT_DUE_DAYS }) {
  const { items, subtotal, tax, total } = computeInvoice(lines, currency);
  const invoiceNumber = await nextDocumentNumber(tx, organizationId, "Invoice");
  const now = new Date();
  return tx.invoice.create({
    data: {
      organizationId, invoiceNumber, source, companyId, dealId, orderId, recurringInvoiceId, currency,
      items, subtotal, tax, total, amountPaid: 0, amountCredited: 0, amountDue: total, status: "Draft",
      issueDate: now, dueDate: dueDate || new Date(now.getTime() + dueDays * DAY_MS),
      createdByMembershipId: membershipId || null, updatedByMembershipId: membershipId || null,
    },
  });
}

// Order line → invoice line: the order's own price, quantity, discount and
// tax category, so the invoice totals match the order.
export function orderLinesToInvoiceLines(lineItems) {
  return (lineItems || []).map((l) => ({
    name: l.name, qty: l.quantity, unitPrice: Number(l.unitPrice), taxCategory: l.taxCategory || "Standard",
    ...(l.discountValue && Number(l.discountValue) > 0 && { discountType: l.discountType || "Fixed Amount", discountValue: Number(l.discountValue) }),
  }));
}
