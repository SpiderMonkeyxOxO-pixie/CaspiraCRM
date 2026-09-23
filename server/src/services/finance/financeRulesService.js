// Backend Phase 6 — Finance rules: invoice totals, statuses and settlement.
// Money arithmetic goes through services/sales/moneyService.js (Decimal),
// so invoices total exactly like Quotes and Orders.
import { computeLineTotals, computeDocumentTotals, toMoney, add, subtract, round } from "../sales/moneyService.js";

export const INVOICE_STATUSES = ["Draft", "Approved", "Sent", "Partially Paid", "Paid", "Overdue", "Void"];
// Invoices at or above this total need approval by someone other than
// their creator (the frontend's APPROVAL_THRESHOLD).
export const APPROVAL_THRESHOLD = 10000;
export const PAYMENT_METHODS = ["Bank Transfer", "Credit Card", "Cash", "Check", "Other"];
export const EXPENSE_CATEGORIES = ["Travel", "Software", "Office Supplies", "Meals", "Other"];
export const RECURRING_INTERVALS = ["Weekly", "Monthly", "Quarterly", "Annually"];
export const DEFAULT_DUE_DAYS = 30;

// Statuses in which a customer can still pay.
export const PAYABLE_STATUSES = ["Sent", "Partially Paid"];

// Validates client-supplied lines and computes every total server-side.
// Input lines: { name, qty, unitPrice, taxCategory? }. Returns
// { items, subtotal, tax, total } or throws RangeError with a message.
export function computeInvoice(lines, currency = "USD") {
  if (!Array.isArray(lines) || lines.length === 0) throw new RangeError("An invoice needs at least one line.");
  const items = lines.map((line, i) => {
    const name = typeof line?.name === "string" ? line.name.trim() : "";
    if (!name) throw new RangeError(`Line ${i + 1} needs a description.`);
    const qty = Number(line.qty ?? 1);
    const unitPrice = Number(line.unitPrice);
    if (!Number.isFinite(qty) || qty <= 0) throw new RangeError(`Line ${i + 1}: quantity must be more than 0.`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new RangeError(`Line ${i + 1}: unit price can't be negative.`);
    const taxCategory = line.taxCategory || "Standard";
    // Discounts only arrive from order lines (copied as-is); the invoice
    // pages themselves don't offer them.
    const discount = line.discountValue ? { discountType: line.discountType || "Fixed Amount", discountValue: line.discountValue } : {};
    const totals = computeLineTotals({ quantity: qty, unitPrice, taxCategory, currency, ...discount });
    return { name, qty, unitPrice: Number(round(unitPrice, currency)), taxCategory, ...(line.discountValue && { discountType: discount.discountType, discountValue: Number(discount.discountValue) }), ...totals };
  });
  const doc = computeDocumentTotals(items, { currency });
  return {
    items: items.map(({ lineSubtotal, taxAmount, lineTotal, discountAmount, ...rest }) => ({
      ...rest, lineSubtotal: Number(lineSubtotal), taxAmount: Number(taxAmount), lineTotal: Number(lineTotal),
    })),
    subtotal: doc.subtotal,
    tax: doc.taxTotal,
    total: doc.grandTotal,
  };
}

// What's still owed after payments and credit notes — never below zero.
export function amountDueFor({ total, amountPaid, amountCredited }, currency = "USD") {
  const due = round(subtract(subtract(toMoney(total), toMoney(amountPaid)), toMoney(amountCredited)), currency);
  return due.isNegative() ? toMoney(0) : due;
}

// The stored status after money moves: fully settled → Paid, some paid →
// Partially Paid, otherwise it stays where it was (Sent). Draft/Approved/
// Void never change here — payments are only accepted once Sent.
export function settledStatus(invoice, { amountPaid, amountDue }) {
  if (["Draft", "Approved", "Void"].includes(invoice.status)) return invoice.status;
  if (toMoney(amountDue).isZero()) return "Paid";
  if (toMoney(amountPaid).greaterThan(0)) return "Partially Paid";
  return "Sent";
}

// "Overdue" is time-dependent, so it's derived on every read: an invoice
// that's been sent, isn't settled and is past its due date.
export function displayStatus(invoice, now = new Date()) {
  if (PAYABLE_STATUSES.includes(invoice.status) && invoice.dueDate && new Date(invoice.dueDate) < now) return "Overdue";
  return invoice.status;
}

export { add as addMoney, toMoney };
