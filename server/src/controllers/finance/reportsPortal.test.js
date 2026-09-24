import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const D = (v) => new Prisma.Decimal(v);
const db = {
  financeSettings: { findUnique: vi.fn(async () => null) },
  journalLine: { groupBy: vi.fn(async () => []) },
  ledgerAccount: { findMany: vi.fn(async () => []) },
  invoice: { findMany: vi.fn(async () => []), findFirst: vi.fn() },
  vendorBill: { findMany: vi.fn(async () => []) },
  outboxEvent: { findFirst: vi.fn(async () => null), create: vi.fn() },
  fiscalPeriod: { findMany: vi.fn(async () => []) },
  statementLine: { groupBy: vi.fn(async () => []) },
};
vi.mock("../../lib/prisma.js", () => ({ default: db }));

const reports = await import("./financeReportsController.js");
const portal = await import("./portalFinanceController.js");
const jobs = await import("../../jobs/finance/financeJobs.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const req = (params, query = {}) => ({ params, query, organizationId: "org1" });

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockClear?.();
});

const acct = (id, code, type, normalBalance, subtype = null) => ({ id, code, name: code, type, normalBalance, subtype, archivedAt: null });

describe("financial statements", () => {
  beforeEach(() => {
    db.ledgerAccount.findMany.mockResolvedValue([acct("bank", "1020", "Asset", "Debit", "Bank"), acct("ar", "1100", "Asset", "Debit", "Receivable"), acct("rev", "4100", "Revenue", "Credit"), acct("exp", "6100", "Expense", "Debit"), acct("tax", "2200", "Liability", "Credit", "Tax Payable")]);
    db.journalLine.groupBy.mockResolvedValue([
      { accountId: "ar", _sum: { baseDebit: D(1080), baseCredit: D(500) } },
      { accountId: "bank", _sum: { baseDebit: D(500), baseCredit: D(45) } },
      { accountId: "rev", _sum: { baseDebit: D(0), baseCredit: D(1000) } },
      { accountId: "tax", _sum: { baseDebit: D(0), baseCredit: D(80) } },
      { accountId: "exp", _sum: { baseDebit: D(45), baseCredit: D(0) } },
    ]);
  });

  it("trial balance uses posted journals only and balances", async () => {
    const res = mockRes();
    await reports.runReport(req({ report: "trial-balance" }, { asOf: "2026-09-30" }), res);
    const out = res.json.mock.calls[0][0];
    expect(out.totals).toEqual({ debit: 1625, credit: 1625, balanced: true });
    expect(db.journalLine.groupBy.mock.calls[0][0].where.journalEntry.status).toEqual({ in: ["Posted", "Reversed"] });
    expect(out.meta).toMatchObject({ report: "Trial Balance", notAudited: true, source: expect.stringMatching(/Posted journals/) });
  });

  it("P&L nets revenue and expenses; the balance sheet balances with accumulated earnings", async () => {
    const pl = mockRes();
    await reports.runReport(req({ report: "profit-and-loss" }, { from: "2026-01-01", to: "2026-12-31" }), pl);
    expect(pl.json.mock.calls[0][0].totals).toEqual({ revenue: 1000, expenses: 45, netIncome: 955 });
    const bs = mockRes();
    await reports.runReport(req({ report: "balance-sheet" }, { asOf: "2026-09-30" }), bs);
    expect(bs.json.mock.calls[0][0].totals).toEqual({ assets: 1035, liabilities: 80, equity: 955, balanced: true });
  });

  it("tax summary is labelled an operational estimate; unknown reports are 404; bad ranges 400", async () => {
    const tax = mockRes();
    await reports.runReport(req({ report: "tax-summary" }), tax);
    expect(tax.json.mock.calls[0][0]).toMatchObject({ label: "Operational estimate", totals: { payable: 80 } });
    const unknown = mockRes();
    await reports.runReport(req({ report: "nope" }), unknown);
    expect(unknown.status).toHaveBeenCalledWith(404);
    const bad = mockRes();
    await reports.runReport(req({ report: "profit-and-loss" }, { from: "2026-12-01", to: "2026-01-01" }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);
  });

  it("aging buckets by days past due, per currency", async () => {
    const asOf = new Date("2026-09-30");
    expect(reports.agingBucket(new Date("2026-10-05"), asOf)).toBe("Current");
    expect(reports.agingBucket(new Date("2026-09-30"), asOf)).toBe("Current");
    expect(reports.agingBucket(new Date("2026-09-29"), asOf)).toBe("1–30");
    expect(reports.agingBucket(new Date("2026-07-31"), asOf)).toBe("61–90");
    expect(reports.agingBucket(new Date("2026-01-01"), asOf)).toBe("90+");
    db.invoice.findMany.mockResolvedValue([
      { invoiceNumber: "INV-1", dueDate: new Date("2026-09-15"), currency: "USD", amountDue: D(100), company: { name: "A" } },
      { invoiceNumber: "INV-2", dueDate: new Date("2026-09-15"), currency: "EUR", amountDue: D(50), company: { name: "B" } },
    ]);
    const res = mockRes();
    await reports.runReport(req({ report: "receivables-aging" }, { asOf: "2026-09-30" }), res);
    expect(res.json.mock.calls[0][0].totals).toMatchObject({ USD: { "1–30": 100 }, EUR: { "1–30": 50 } });
  });
});

describe("portal invoices", () => {
  it("only the company's posted invoices; contact-only access narrows further", () => {
    expect(portal.portalInvoiceWhere({ organizationId: "org1", companyId: "co1", contactId: "c1", companyWideAccess: true })).toMatchObject({ companyId: "co1", journalEntryId: { not: null } });
    expect(portal.portalInvoiceWhere({ organizationId: "org1", companyId: "co1", contactId: "c1", companyWideAccess: false })).toMatchObject({ contactId: "c1" });
    expect(portal.portalInvoiceWhere({ companyId: null })).toEqual({ id: "__none__" });
    expect(portal.portalInvoiceWhere({ organizationId: "org1", companyId: "co1", companyWideAccess: true }).status.in).not.toContain("Draft");
  });

  it("the serializer never includes journals, approvals or internal fields, and has no Pay now", () => {
    const out = portal.serializePortalInvoice({ id: "i1", invoiceNumber: "INV-1", status: "Sent", total: D(10), subtotal: D(10), tax: D(0), discountTotal: D(0), amountPaid: D(0), amountCredited: D(0), amountDue: D(10), journalEntryId: "je1", approvedByMembershipId: "m1", createdByMembershipId: "m2", lines: [{ description: "x", quantity: D(1), unitPrice: D(10), taxAmount: D(0), lineTotal: D(10), revenueAccountId: "rev" }] });
    for (const f of ["journalEntryId", "approvedByMembershipId", "createdByMembershipId"]) expect(out).not.toHaveProperty(f);
    expect(out.lines[0]).not.toHaveProperty("revenueAccountId");
    expect(out.payNow).toBe(false);
  });
});

describe("finance sweep", () => {
  it("notifies once per subject and changes no status", async () => {
    db.invoice.findMany.mockResolvedValueOnce([{ id: "i1", organizationId: "org1", invoiceNumber: "INV-1", dueDate: new Date("2026-01-01"), amountDue: D(5), currency: "USD" }]).mockResolvedValue([]);
    const first = await jobs.detectOverdueDocuments(new Date("2026-09-30"));
    expect(first.created).toBe(1);
    expect(db.outboxEvent.create.mock.calls[0][0].data).toMatchObject({ aggregateType: "Invoice", eventType: "finance.invoice.overdue_detected" });
    db.invoice.findMany.mockResolvedValueOnce([{ id: "i1", organizationId: "org1", invoiceNumber: "INV-1", dueDate: new Date("2026-01-01"), amountDue: D(5), currency: "USD" }]);
    db.outboxEvent.findFirst.mockResolvedValueOnce({ id: "already" });
    expect((await jobs.detectOverdueDocuments(new Date("2026-09-30"))).created).toBe(0);
    expect(db.invoice.updateMany).toBeUndefined();
  });
});
