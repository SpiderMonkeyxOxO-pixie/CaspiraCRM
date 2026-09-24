// Backend Phase 6 (full spec) — the customer's invoices, credit notes and
// recorded payments in the Customer Portal.
//
// A portal login sees its own company's POSTED invoices only: all of them
// with company-wide access, otherwise those addressed to its contact.
// Dedicated serializers never expose ledger accounts, journals, cost or
// margin, approvals, internal notes, bills or other customers. There is no
// "Pay now": payments shown are records of what was received.
import prisma from "../../lib/prisma.js";
import { toMoney } from "../../services/sales/moneyService.js";
import { PAYMENT_LABEL } from "../../services/finance/financeCommon.js";
import { displayStatus } from "./invoicesController.js";

const VISIBLE = ["Posted", "Sent", "Partially Paid", "Paid", "Disputed", "Written Off"];
const n = (d) => Number(toMoney(d).toFixed(2));

export function portalInvoiceWhere(account) {
  if (!account.companyId) return { id: "__none__" };
  return { organizationId: account.organizationId, companyId: account.companyId, status: { in: VISIBLE }, journalEntryId: { not: null }, archivedAt: null, ...(account.companyWideAccess ? {} : { contactId: account.contactId }) };
}

export function serializePortalInvoice(invoice) {
  return {
    _id: invoice.id, invoiceNumber: invoice.invoiceNumber, issueDate: invoice.issueDate, dueDate: invoice.dueDate, currency: invoice.currency,
    status: displayStatus(invoice), subtotal: n(invoice.subtotal), discount: n(invoice.discountTotal), tax: n(invoice.tax), total: n(invoice.total),
    amountPaid: n(invoice.amountPaid), amountCredited: n(invoice.amountCredited), amountDue: n(invoice.amountDue), billingAddress: invoice.billingAddress || null,
    ...(invoice.lines && { lines: invoice.lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), tax: n(l.taxAmount), total: n(l.lineTotal) })) }),
    payNow: false,
  };
}

export async function listInvoices(req, res) {
  const invoices = await prisma.invoice.findMany({ where: portalInvoiceWhere(req.portal), orderBy: { issueDate: "desc" }, take: 200 });
  res.json({ invoices: invoices.map(serializePortalInvoice) });
}

export async function getInvoice(req, res) {
  const invoice = await prisma.invoice.findFirst({ where: { id: req.params.invoiceId, ...portalInvoiceWhere(req.portal) }, include: { lines: { orderBy: { lineNumber: "asc" } } } });
  if (!invoice) return res.status(404).json({ code: "PORTAL_RECORD_NOT_FOUND", message: "Invoice not found." });
  res.json({ invoice: serializePortalInvoice(invoice) });
}

export async function listCreditNotes(req, res) {
  const notes = await prisma.creditNote.findMany({ where: { organizationId: req.portal.organizationId, status: "Posted", invoice: portalInvoiceWhere(req.portal) }, include: { invoice: { select: { invoiceNumber: true } } }, orderBy: { creditDate: "desc" }, take: 200 });
  res.json({ creditNotes: notes.map((c) => ({ _id: c.id, creditNoteNumber: c.creditNoteNumber, invoiceNumber: c.invoice?.invoiceNumber || null, date: c.creditDate, currency: c.currency, amount: n(c.amount), reason: c.reason })) });
}

export async function listPayments(req, res) {
  const allocations = await prisma.paymentAllocation.findMany({
    where: { organizationId: req.portal.organizationId, status: "Active", invoice: portalInvoiceWhere(req.portal), payment: { status: "Posted", direction: "Incoming" } },
    include: { payment: { select: { paymentNumber: true, date: true, method: true, currency: true } }, invoice: { select: { invoiceNumber: true } } },
    orderBy: { allocationDate: "desc" }, take: 200,
  });
  res.json({ payments: allocations.map((a) => ({ paymentNumber: a.payment.paymentNumber, invoiceNumber: a.invoice?.invoiceNumber, date: a.payment.date, method: a.payment.method, currency: a.payment.currency, amount: n(a.amount), label: PAYMENT_LABEL })) });
}
