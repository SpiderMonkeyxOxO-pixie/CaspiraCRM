import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const D = (v) => new Prisma.Decimal(v);
const db = {
  financeSettings: { findUnique: vi.fn(async () => null) },
  financeOverride: { create: vi.fn() },
  expense: { findFirst: vi.fn(), findMany: vi.fn(async () => []), findUnique: vi.fn(async () => ({ id: "e1" })), create: vi.fn(async ({ data }) => ({ id: "e1", ...data })), updateMany: vi.fn(async () => ({ count: 1 })) },
  expenseReport: { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ id: "r1", expenses: [], totals: {} })), updateMany: vi.fn(async () => ({ count: 1 })) },
  taxRate: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
  ledgerAccount: { findFirst: vi.fn(async () => ({ id: "acc-6100" })) },
  vendor: { findFirst: vi.fn() },
  vendorBill: { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ id: "b1", lines: [] })), updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() },
  paymentAllocation: { count: vi.fn(async () => 0) },
  exchangeRate: { findFirst: vi.fn(async () => null) },
  auditEvent: { create: vi.fn() },
  salesDocumentCounter: { upsert: vi.fn(), update: vi.fn(async () => ({ value: 7 })) },
};
db.$transaction = vi.fn(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
vi.mock("../../lib/prisma.js", () => ({ default: db }));

const expenses = await import("./expensesController.js");
const reports = await import("./expenseReportsController.js");
const bills = await import("./billsController.js");
const { computeDocument, lineAmounts } = await import("../../services/finance/documentMath.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const req = (grants, body = {}, params = {}, membershipId = "m1") => ({
  body, params, query: {}, headers: {}, organizationId: "org1", user: { id: "u1" }, isSystemOwnerOverride: false,
  membership: { id: membershipId, roles: [{ role: { defaultScope: "Organization", permissionGrants: Object.entries(grants).map(([moduleId, actions]) => ({ moduleId, actions })) } }] },
});
const settings = { organizationId: "org1", baseCurrency: "USD", separationOfDuties: true, employeePayableAccountId: "acc-2300", payableAccountId: "acc-2100", taxRecoverableAccountId: "acc-1200", expenseAccountId: "acc-6900", expensePolicyLimit: D(500) };

beforeEach(() => {
  for (const m of Object.values(db)) if (typeof m === "object") for (const fn of Object.values(m)) fn.mockClear?.();
  db.financeSettings.findUnique.mockResolvedValue(null);
});

describe("document math", () => {
  it("exclusive tax per line, rounded half-up; totals are sums of lines", () => {
    const doc = computeDocument([{ description: "A", quantity: "3", unitPrice: "3.335" }, { description: "B", quantity: 1, unitPrice: "10", taxRateId: "t1" }], { currency: "USD", taxRatesById: new Map([["t1", { id: "t1", code: "VAT12", name: "VAT", rateBasisPoints: 1250, inclusive: false, recoverable: true, active: true, type: "Both" }]]) });
    expect(doc.lines[0].lineTotal.toFixed(2)).toBe("10.01");
    expect(doc.lines[1].taxAmount.toFixed(2)).toBe("1.25");
    expect(doc.total.toFixed(2)).toBe("21.26");
    expect(doc.lines[1].taxSnapshot).toMatchObject({ code: "VAT12", rateBasisPoints: 1250 });
  });

  it("inclusive tax splits the total; tax type must fit the document", () => {
    const inc = lineAmounts({ quantity: 1, unitPrice: "112", snapshot: { rateBasisPoints: 1200, inclusive: true }, currency: "USD" });
    expect([inc.lineSubtotal.toFixed(2), inc.taxAmount.toFixed(2), inc.lineTotal.toFixed(2)]).toEqual(["100.00", "12.00", "112.00"]);
    expect(() => computeDocument([{ description: "A", unitPrice: 1, taxRateId: "s" }], { currency: "USD", kind: "Purchase", taxRatesById: new Map([["s", { id: "s", code: "OUT", active: true, type: "Sales", rateBasisPoints: 100 }]]) })).toThrow(/sales tax/);
    expect(() => computeDocument([], { currency: "USD" })).toThrow(/at least one line/);
  });
});

describe("expenses", () => {
  it("over the policy limit needs a reason, and is flagged", async () => {
    db.financeSettings.findUnique.mockResolvedValue(settings);
    const res = mockRes();
    await expenses.create(req({}, { description: "Flight", amount: "900", category: "Travel", date: "2026-09-01" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    await expenses.create(req({}, { description: "Flight", amount: "900", category: "Travel", date: "2026-09-01", policyExceptionReason: "Last-minute customer visit" }), mockRes());
    expect(db.expense.create.mock.calls[0][0].data).toMatchObject({ policyException: true, status: "Pending", policyExceptionReason: "Last-minute customer visit" });
  });

  it("computes purchase tax server-side and ignores client totals", async () => {
    db.taxRate.findFirst.mockResolvedValue({ id: "t1", code: "VAT", name: "VAT", rateBasisPoints: 1000, inclusive: false, recoverable: true, type: "Purchase", active: true });
    await expenses.create(req({}, { description: "Laptop stand", amountBeforeTax: "50", taxRateId: "t1", amount: "1", taxAmount: "0", date: "2026-09-01" }), mockRes());
    const data = db.expense.create.mock.calls[0][0].data;
    expect([data.amountBeforeTax.toFixed(2), data.taxAmount.toFixed(2), data.amount.toFixed(2)]).toEqual(["50.00", "5.00", "55.00"]);
  });

  it("rejecting needs a reason; a policy exception needs approve_exception", async () => {
    db.expense.findFirst.mockResolvedValue({ id: "e1", status: "Pending", version: 1, submittedByMembershipId: "m2", policyException: true });
    const noReason = mockRes();
    await expenses.review(req({ expenses: ["reject"] }, { status: "Rejected" }, { expenseId: "e1" }), noReason);
    expect(noReason.status).toHaveBeenCalledWith(400);
    const noException = mockRes();
    await expenses.review(req({ expenses: ["approve"] }, { status: "Approved" }, { expenseId: "e1" }), noException);
    expect(noException.status).toHaveBeenCalledWith(403);
    await expenses.review(req({ expenses: ["approve", "approve_exception"] }, { status: "Approved" }, { expenseId: "e1" }), mockRes());
    expect(db.expense.updateMany.mock.calls[0][0].data).toMatchObject({ status: "Approved", reviewedByMembershipId: "m1" });
  });

  it("a material edit after approval sends it back to Pending", async () => {
    db.expense.findFirst.mockResolvedValue({ id: "e1", status: "Approved", version: 2, submittedByMembershipId: "m1", currency: "USD", date: new Date("2026-09-01"), amount: D(10), category: "Meals" });
    await expenses.update(req({}, { amount: "12" }, { expenseId: "e1" }), mockRes());
    expect(db.expense.updateMany.mock.calls[0][0].data).toMatchObject({ status: "Pending", reviewedByMembershipId: null });
  });

  it("posting journal: expense and recoverable tax against employee payable, balanced", async () => {
    db.taxRate.findFirst.mockResolvedValue({ id: "t1", purchaseAccountId: null });
    const lines = await expenses.expenseJournalLines(db, "org1", [
      { expenseNumber: "EXP-1", description: "Taxi", category: "Travel", amount: D(22), amountBeforeTax: D(20), taxAmount: D(2), taxRateId: "t1", taxSnapshot: { recoverable: true, code: "VAT" } },
      { expenseNumber: "EXP-2", description: "Lunch", category: "Meals", amount: D(15), amountBeforeTax: D(15), taxAmount: D(0) },
    ], settings);
    const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    expect(debit).toBe(37);
    expect(credit).toBe(37);
    expect(lines.find((l) => l.accountId === "acc-1200")).toMatchObject({ debit: "2.00" });
    expect(lines.at(-1)).toMatchObject({ accountId: "acc-2300", credit: "37.00" });
  });
});

describe("expense reports", () => {
  const report = (over = {}) => ({ id: "r1", reportNumber: "EXPR-2026-000001", status: "Submitted", version: 1, submitterMembershipId: "m1", expenses: [{ id: "e1", currency: "USD", amount: D(10), policyException: false }], totals: {}, ...over });

  it("the submitter can't approve their own report", async () => {
    db.expenseReport.findFirst.mockResolvedValue(report());
    const res = mockRes();
    await reports.approveReport(req({ expenses: ["approve"] }, {}, { reportId: "r1" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("totals are per currency and one report holds one currency", async () => {
    expect(reports.reportTotals([{ currency: "USD", amount: D("10.10") }, { currency: "USD", amount: D("0.20") }])).toEqual({ USD: "10.30" });
    db.expense.findMany.mockResolvedValue([{ id: "e1", currency: "USD", status: "Draft", submittedByMembershipId: "m1" }, { id: "e2", currency: "EUR", status: "Draft", submittedByMembershipId: "m1" }]);
    const res = mockRes();
    await reports.createReport(req({}, { title: "Trip", expenseIds: ["e1", "e2"] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/one currency/);
  });

  it("rejection needs a reason; approval moves the expenses with it and posts nothing", async () => {
    db.expenseReport.findFirst.mockResolvedValue(report({ submitterMembershipId: "m2" }));
    const res = mockRes();
    await reports.rejectReport(req({ expenses: ["reject"] }, {}, { reportId: "r1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    await reports.approveReport(req({ expenses: ["approve"] }, {}, { reportId: "r1" }), mockRes());
    expect(db.expense.updateMany.mock.calls[0][0].data).toMatchObject({ status: "Approved" });
    expect(db.salesDocumentCounter.update).not.toHaveBeenCalled(); // no journal number taken
  });
});

describe("vendor bills", () => {
  const bill = (over = {}) => ({ id: "b1", organizationId: "org1", billNumber: "BILL-2026-000001", vendorReference: "INV-77", status: "Submitted", version: 1, createdByMembershipId: "m1", total: D(112), amountPaid: D(0), vendor: { companyId: "co1", company: { name: "Acme" } }, lines: [], ...over });

  it("the person who entered a bill can't approve it", async () => {
    db.vendorBill.findFirst.mockResolvedValue(bill());
    const res = mockRes();
    await bills.approveBill(req({ bills: ["approve"] }, {}, { billId: "b1" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("a duplicate vendor reference is a conflict", async () => {
    db.vendor.findFirst.mockResolvedValue({ id: "v1", active: true, paymentTermsDays: 30, currency: "USD", defaultExpenseAccountId: null });
    db.ledgerAccount.findFirst.mockResolvedValue({ id: "acc-6200", type: "Expense" });
    db.vendorBill.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    const res = mockRes();
    await bills.createBill(req({ bills: ["create"] }, { vendorId: "v1", vendorReference: "INV-77", billDate: "2026-09-01", lines: [{ description: "Licences", quantity: 1, unitPrice: "100", accountId: "acc-6200" }] }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("posting lines: recoverable tax split out, payable for the total", async () => {
    const lines = await bills.billJournalLines(db, bill({ lines: [{ accountId: "acc-6200", lineSubtotal: D(100), taxAmount: D(12), lineTotal: D(112), taxRateId: "t1", taxSnapshot: { recoverable: true, code: "VAT" }, description: "Licences" }] }), settings);
    expect(lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: "acc-6200", debit: "100.00" }), expect.objectContaining({ accountId: "acc-1200", debit: "12.00" }), expect.objectContaining({ accountId: "acc-2100", credit: "112.00" })]));
  });

  it("a bill with payments can't be voided; void needs a reason; overdue is derived", async () => {
    db.vendorBill.findFirst.mockResolvedValue(bill({ status: "Posted" }));
    const noReason = mockRes();
    await bills.voidBill(req({ bills: ["cancel"] }, {}, { billId: "b1" }), noReason);
    expect(noReason.status).toHaveBeenCalledWith(400);
    db.paymentAllocation.count.mockResolvedValueOnce(1);
    const allocated = mockRes();
    await bills.voidBill(req({ bills: ["cancel"] }, { reason: "Duplicate" }, { billId: "b1" }), allocated);
    expect(allocated.json.mock.calls[0][0].message).toMatch(/Reverse the payments/);
    expect(bills.billDisplayStatus({ status: "Posted", dueDate: new Date("2020-01-01") })).toBe("Overdue");
    expect(bills.billDisplayStatus({ status: "Paid", dueDate: new Date("2020-01-01") })).toBe("Paid");
  });
});
