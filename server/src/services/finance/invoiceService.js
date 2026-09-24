// Backend Phase 6 — the one place invoices are created, whether by hand, from
// a recurring template or from a confirmed Sales order. Always a Draft,
// numbered per organization, with totals computed server-side.
//
// Full spec: every invoice also gets immutable InvoiceLine snapshots
// (description, quantity, price, discount, tax snapshot, revenue account,
// cost center, project). Lines that name a configured tax rate (taxRateId)
// use it; otherwise the Sales preview tax category is kept and snapshotted
// (same totals as Quotes and Orders). The `items` JSON stays for the
// existing pages.
import { nextDocumentNumber } from "../sales/documentNumberService.js";
import { taxRateFor, toMoney } from "../sales/moneyService.js";
import { computeInvoice, DEFAULT_DUE_DAYS } from "./financeRulesService.js";
import { computeDocument, loadTaxRates } from "./documentMath.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// → { items, subtotal, tax, total, discountTotal, lines } with lines ready
// for InvoiceLine rows.
export async function computeInvoiceDocument(tx, organizationId, rawLines, currency) {
  if (Array.isArray(rawLines) && rawLines.some((l) => l?.taxRateId)) {
    const taxRatesById = await loadTaxRates(tx, organizationId, rawLines.map((l) => l?.taxRateId));
    const doc = computeDocument(rawLines, { currency, taxRatesById, kind: "Sales" });
    const items = doc.lines.map((l) => ({
      name: l.description, qty: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRateId: l.taxRateId, taxCode: l.taxSnapshot?.code || null,
      lineSubtotal: Number(l.lineSubtotal), taxAmount: Number(l.taxAmount), lineTotal: Number(l.lineTotal),
    }));
    return { items, subtotal: doc.subtotal, tax: doc.tax, total: doc.total, discountTotal: doc.discountTotal, lines: doc.lines };
  }
  const computed = computeInvoice(rawLines, currency);
  const lines = computed.items.map((item, i) => ({
    lineNumber: i + 1, description: item.name, quantity: toMoney(item.qty), unitPrice: toMoney(item.unitPrice),
    discountAmount: toMoney(0), taxRateId: null,
    taxSnapshot: { taxCategory: item.taxCategory, rateBasisPoints: Math.round(Number(taxRateFor(item.taxCategory)) * 10000), source: "Sales tax category (preview rate)" },
    lineSubtotal: toMoney(item.lineSubtotal), taxAmount: toMoney(item.taxAmount), lineTotal: toMoney(item.lineTotal),
    accountId: rawLines[i]?.revenueAccountId || null, costCenterId: rawLines[i]?.costCenterId || null, projectId: rawLines[i]?.projectId || null, productId: rawLines[i]?.productId || null,
  }));
  const discountTotal = lines.reduce((s, l) => s.plus(l.discountAmount), toMoney(0));
  return { items: computed.items, subtotal: computed.subtotal, tax: computed.tax, total: computed.total, discountTotal, lines };
}

export const invoiceLineRows = (organizationId, invoiceId, lines, orderId = null) => lines.map((l) => ({
  organizationId, invoiceId, lineNumber: l.lineNumber, productId: l.productId || null, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice,
  discountAmount: l.discountAmount || 0, taxRateId: l.taxRateId || null, taxSnapshot: l.taxSnapshot ?? undefined, lineSubtotal: l.lineSubtotal, taxAmount: l.taxAmount,
  lineTotal: l.lineTotal, revenueAccountId: l.accountId || null, costCenterId: l.costCenterId || null, projectId: l.projectId || null, orderId,
}));

export async function createDraftInvoice(tx, { organizationId, membershipId, companyId = null, dealId = null, orderId = null, recurringInvoiceId = null, source = "Manual", lines, currency = "USD", dueDate = null, dueDays = DEFAULT_DUE_DAYS, extra = {} }) {
  const doc = await computeInvoiceDocument(tx, organizationId, lines, currency);
  const invoiceNumber = await nextDocumentNumber(tx, organizationId, "Invoice");
  const now = new Date();
  const invoice = await tx.invoice.create({
    data: {
      organizationId, invoiceNumber, source, companyId, dealId, orderId, recurringInvoiceId, currency,
      items: doc.items, subtotal: doc.subtotal, tax: doc.tax, total: doc.total, discountTotal: doc.discountTotal, amountPaid: 0, amountCredited: 0, amountDue: doc.total, status: "Draft",
      issueDate: now, dueDate: dueDate || new Date(now.getTime() + dueDays * DAY_MS), paymentTermsDays: dueDate ? null : dueDays,
      createdByMembershipId: membershipId || null, updatedByMembershipId: membershipId || null, ...extra,
    },
  });
  await tx.invoiceLine.createMany({ data: invoiceLineRows(organizationId, invoice.id, doc.lines, orderId) });
  return invoice;
}

// Order line → invoice line: the order's own price, quantity, discount and
// tax category, so the invoice totals match the order.
export function orderLinesToInvoiceLines(lineItems) {
  return (lineItems || []).map((l) => ({
    name: l.name, qty: l.quantity, unitPrice: Number(l.unitPrice), taxCategory: l.taxCategory || "Standard", productId: l.productId || null,
    ...(l.discountValue && Number(l.discountValue) > 0 && { discountType: l.discountType || "Fixed Amount", discountValue: Number(l.discountValue) }),
  }));
}
