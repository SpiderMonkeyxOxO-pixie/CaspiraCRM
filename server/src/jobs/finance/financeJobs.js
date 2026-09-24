// Backend Phase 6 (full spec) — deterministic Finance sweep. Identifies:
// overdue invoices and bills, invoices and bills falling due soon, fiscal
// periods nearing their end while still open, and statement lines left
// unreconciled. It only records internal notifications (OutboxEvent rows
// with no recipient, never emailed), once per subject — rerunning changes
// nothing. It never approves, posts, pays, closes a period, contacts a
// customer or calls AI. "Overdue" itself is derived on read, so no status
// is changed here. Reports are computed live, so there is no report cache
// to refresh.
import prisma from "../../lib/prisma.js";

const DAY = 86400000;
export const DUE_SOON_DAYS = 3;
export const PERIOD_WARNING_DAYS = 5;
export const UNRECONCILED_AFTER_DAYS = 30;

async function notify(aggregateType, aggregateId, eventType, payload) {
  const existing = await prisma.outboxEvent.findFirst({ where: { aggregateType, aggregateId, eventType } });
  if (existing) return false;
  await prisma.outboxEvent.create({ data: { aggregateType, aggregateId, eventType, payload } });
  return true;
}

export async function detectOverdueDocuments(now = new Date()) {
  const [invoices, bills] = await Promise.all([
    prisma.invoice.findMany({ where: { status: { in: ["Posted", "Sent", "Partially Paid"] }, dueDate: { lt: now }, amountDue: { gt: 0 } }, select: { id: true, organizationId: true, invoiceNumber: true, dueDate: true, amountDue: true, currency: true } }),
    prisma.vendorBill.findMany({ where: { status: { in: ["Posted", "Partially Paid"] }, dueDate: { lt: now }, amountDue: { gt: 0 } }, select: { id: true, organizationId: true, billNumber: true, dueDate: true, amountDue: true, currency: true } }),
  ]);
  let created = 0;
  for (const i of invoices) created += await notify("Invoice", i.id, "finance.invoice.overdue_detected", { organizationId: i.organizationId, invoiceNumber: i.invoiceNumber, dueDate: i.dueDate, amountDue: String(i.amountDue), currency: i.currency });
  for (const b of bills) created += await notify("VendorBill", b.id, "finance.bill.overdue_detected", { organizationId: b.organizationId, billNumber: b.billNumber, dueDate: b.dueDate, amountDue: String(b.amountDue), currency: b.currency });
  return { overdueInvoices: invoices.length, overdueBills: bills.length, created };
}

export async function detectDueSoon(now = new Date()) {
  const until = new Date(now.getTime() + DUE_SOON_DAYS * DAY);
  const [invoices, bills] = await Promise.all([
    prisma.invoice.findMany({ where: { status: { in: ["Posted", "Sent", "Partially Paid"] }, dueDate: { gte: now, lte: until }, amountDue: { gt: 0 } }, select: { id: true, organizationId: true, invoiceNumber: true, dueDate: true } }),
    prisma.vendorBill.findMany({ where: { status: { in: ["Posted", "Partially Paid"] }, dueDate: { gte: now, lte: until }, amountDue: { gt: 0 } }, select: { id: true, organizationId: true, billNumber: true, dueDate: true } }),
  ]);
  for (const i of invoices) await notify("Invoice", i.id, "finance.invoice.due_soon", { organizationId: i.organizationId, invoiceNumber: i.invoiceNumber, dueDate: i.dueDate });
  for (const b of bills) await notify("VendorBill", b.id, "finance.bill.due_soon", { organizationId: b.organizationId, billNumber: b.billNumber, dueDate: b.dueDate });
  return invoices.length + bills.length;
}

export async function detectPeriodsNearingClose(now = new Date()) {
  const periods = await prisma.fiscalPeriod.findMany({ where: { status: { in: ["Open", "Reopened"] }, endDate: { lte: new Date(now.getTime() + PERIOD_WARNING_DAYS * DAY) } }, select: { id: true, organizationId: true, name: true, endDate: true } });
  for (const p of periods) await notify("FiscalPeriod", p.id, "finance.period.nearing_close", { organizationId: p.organizationId, period: p.name, endDate: p.endDate, note: "Periods are never closed automatically." });
  return periods.length;
}

export async function detectUnreconciledLines(now = new Date()) {
  const groups = await prisma.statementLine.groupBy({ by: ["organizationId", "financialAccountId"], where: { reconciliationStatus: "Unmatched", transactionDate: { lt: new Date(now.getTime() - UNRECONCILED_AFTER_DAYS * DAY) } }, _count: { _all: true } });
  // One notice per account per calendar month.
  const month = now.toISOString().slice(0, 7);
  for (const g of groups) await notify("FinancialAccount", `${g.financialAccountId}:${month}`, "finance.statement.unreconciled_lines", { organizationId: g.organizationId, financialAccountId: g.financialAccountId, lines: g._count._all, olderThanDays: UNRECONCILED_AFTER_DAYS });
  return groups.length;
}

export async function runFinanceSweep(now = new Date()) {
  const overdue = await detectOverdueDocuments(now);
  const [dueSoon, periods, unreconciled] = await Promise.all([detectDueSoon(now), detectPeriodsNearingClose(now), detectUnreconciledLines(now)]);
  return { ...overdue, dueSoon, periodsNearingClose: periods, accountsWithUnreconciledLines: unreconciled };
}
