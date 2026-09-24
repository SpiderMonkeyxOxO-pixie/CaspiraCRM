// Backend Phase 6 (full spec) — what's paid and what's still owed on
// invoices and bills, changed only inside the transaction that posts (or
// reverses) a payment or credit note, under a version check so two
// concurrent allocations can't both spend the same balance.
import { toMoney, round } from "../sales/moneyService.js";
import { LedgerError } from "./ledgerService.js";

export const INVOICE_OPEN = ["Posted", "Sent", "Partially Paid", "Disputed"];
export const BILL_OPEN = ["Posted", "Partially Paid", "Disputed"];

// Posted-but-unpaid base status: an invoice marked as sent stays "Sent".
const invoiceBase = (invoice) => (invoice.sentAt ? "Sent" : "Posted");

export function invoiceStatusAfter(invoice, { amountPaid, amountCredited, amountDue }) {
  if (["Void", "Written Off", "Disputed"].includes(invoice.status)) return invoice.status;
  if (toMoney(amountDue).isZero()) return "Paid";
  if (toMoney(amountPaid).greaterThan(0) || toMoney(amountCredited).greaterThan(0)) return "Partially Paid";
  return invoiceBase(invoice);
}

export function billStatusAfter(bill, { amountPaid, amountDue }) {
  if (["Void", "Disputed"].includes(bill.status)) return bill.status;
  if (toMoney(amountDue).isZero()) return "Paid";
  if (toMoney(amountPaid).greaterThan(0)) return "Partially Paid";
  return "Posted";
}

// Applies (sign = 1) or reverses (sign = -1) a payment amount on an invoice.
export async function settleInvoice(tx, invoiceId, amount, sign = 1) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new LedgerError("Invoice not found.");
  if (sign > 0 && !INVOICE_OPEN.includes(invoice.status) && invoice.status !== "Partially Paid") throw new LedgerError(`Invoice ${invoice.invoiceNumber} is ${invoice.status.toLowerCase()} and can't take a payment.`);
  const change = toMoney(amount).times(sign);
  const amountPaid = round(toMoney(invoice.amountPaid).plus(change), invoice.currency);
  const amountDue = round(toMoney(invoice.total).minus(amountPaid).minus(toMoney(invoice.amountCredited)), invoice.currency);
  if (amountDue.isNegative()) throw new LedgerError(`That is more than the ${toMoney(invoice.amountDue).toFixed(2)} ${invoice.currency} still due on ${invoice.invoiceNumber}.`);
  if (amountPaid.isNegative()) throw new LedgerError("Payments on an invoice can't go below zero.");
  const status = invoiceStatusAfter(invoice, { amountPaid, amountCredited: invoice.amountCredited, amountDue });
  const updated = await tx.invoice.updateMany({
    where: { id: invoice.id, version: invoice.version },
    data: { amountPaid, amountDue, status, paidAt: status === "Paid" ? invoice.paidAt || new Date() : null, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new LedgerError("That invoice was changed at the same time. Try again.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
  return { ...invoice, amountPaid, amountDue, status };
}

export async function settleBill(tx, billId, amount, sign = 1) {
  const bill = await tx.vendorBill.findUnique({ where: { id: billId } });
  if (!bill) throw new LedgerError("Bill not found.");
  if (sign > 0 && !BILL_OPEN.includes(bill.status)) throw new LedgerError(`Bill ${bill.billNumber} is ${bill.status.toLowerCase()} and can't take a payment.`);
  const change = toMoney(amount).times(sign);
  const amountPaid = round(toMoney(bill.amountPaid).plus(change), bill.currency);
  const amountDue = round(toMoney(bill.total).minus(amountPaid), bill.currency);
  if (amountDue.isNegative()) throw new LedgerError(`That is more than the ${toMoney(bill.amountDue).toFixed(2)} ${bill.currency} still due on ${bill.billNumber}.`);
  if (amountPaid.isNegative()) throw new LedgerError("Payments on a bill can't go below zero.");
  const status = billStatusAfter(bill, { amountPaid, amountDue });
  const updated = await tx.vendorBill.updateMany({ where: { id: bill.id, version: bill.version }, data: { amountPaid, amountDue, status, version: { increment: 1 } } });
  if (updated.count !== 1) throw new LedgerError("That bill was changed at the same time. Try again.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
  return { ...bill, amountPaid, amountDue, status };
}

// Applies (sign = 1) or reverses (sign = -1) a posted credit note.
export async function creditInvoice(tx, invoiceId, amount, sign = 1) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new LedgerError("Invoice not found.");
  const amountCredited = round(toMoney(invoice.amountCredited).plus(toMoney(amount).times(sign)), invoice.currency);
  if (amountCredited.greaterThan(toMoney(invoice.total))) throw new LedgerError("Credits can't exceed the invoice total.");
  const raw = toMoney(invoice.total).minus(toMoney(invoice.amountPaid)).minus(amountCredited);
  // A credit beyond what's still owed becomes the customer's credit balance
  // (visible on the receivables ledger); what's due never goes below zero.
  const amountDue = raw.isNegative() ? toMoney(0) : round(raw, invoice.currency);
  const status = invoiceStatusAfter(invoice, { amountPaid: invoice.amountPaid, amountCredited, amountDue });
  const updated = await tx.invoice.updateMany({ where: { id: invoice.id, version: invoice.version }, data: { amountCredited, amountDue, status, version: { increment: 1 } } });
  if (updated.count !== 1) throw new LedgerError("That invoice was changed at the same time. Try again.", { status: 409, code: "FINANCE_VERSION_CONFLICT" });
  return { ...invoice, amountCredited, amountDue, status };
}
