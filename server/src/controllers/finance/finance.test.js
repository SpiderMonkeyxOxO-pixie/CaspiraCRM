import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const D = (v) => new Prisma.Decimal(v);

const mockInvoiceFindFirst = vi.fn();
const mockInvoiceUpdate = vi.fn();
const mockInvoiceCreate = vi.fn();
const mockPaymentCreate = vi.fn();
const mockCreditCreate = vi.fn();
const mockExpenseFindFirst = vi.fn();
const mockExpenseUpdate = vi.fn();
const mockExpenseCreate = vi.fn();
const mockRecurringFindFirst = vi.fn();

const tx = {
  invoice: { create: (...a) => mockInvoiceCreate(...a), update: (...a) => mockInvoiceUpdate(...a) },
  creditNote: { create: (...a) => mockCreditCreate(...a) },
  expense: { create: (...a) => mockExpenseCreate(...a) },
  recurringInvoice: { update: vi.fn() },
  salesDocumentCounter: { upsert: vi.fn(), update: vi.fn(async () => ({ value: 3 })) },
};

vi.mock("../../lib/prisma.js", () => ({
  default: {
    invoice: {
      findFirst: (...a) => mockInvoiceFindFirst(...a), findUnique: vi.fn(async () => ({ id: "i1", status: "Draft" })),
      update: (...a) => mockInvoiceUpdate(...a), findMany: vi.fn(async () => []), count: vi.fn(async () => 0),
    },
    payment: { create: (...a) => mockPaymentCreate(...a) },
    creditNote: { findMany: vi.fn(async () => []) },
    expense: { findFirst: (...a) => mockExpenseFindFirst(...a), update: (...a) => mockExpenseUpdate(...a), updateMany: (...a) => mockExpenseUpdate(...a), findUnique: vi.fn() },
    financeSettings: { findUnique: vi.fn(async () => null) },
    financeOverride: { create: vi.fn() },
    recurringInvoice: { findFirst: (...a) => mockRecurringFindFirst(...a), findUnique: vi.fn() },
    company: { findFirst: vi.fn(async () => ({ id: "co1" })) },
    deal: { findFirst: vi.fn() },
    $transaction: vi.fn(async (arg) => (typeof arg === "function" ? arg(tx) : arg)),
  },
}));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));

const invoices = await import("./invoicesController.js");
const expenses = await import("./expensesController.js");
const recurring = await import("./recurringInvoicesController.js");
const rules = await import("../../services/finance/financeRulesService.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const ADMIN = {
  invoices: ["view", "create", "edit", "approve", "issue", "cancel", "credit"],
  expenses: ["view", "create", "approve", "reject"],
};
const req = (body, params = {}, { scope = "Organization", grants = ADMIN, membershipId = "m1", department = null } = {}) => ({
  body, params, query: {}, organizationId: "org1", user: { id: "u1", department }, isSystemOwnerOverride: false,
  membership: { id: membershipId, roles: [{ role: { defaultScope: scope, permissionGrants: Object.entries(grants).map(([moduleId, actions]) => ({ moduleId, actions })) } }] },
});

const sentInvoice = (over = {}) => ({
  id: "i1", status: "Sent", currency: "USD", total: D(1080), amountPaid: D(0), amountCredited: D(0), amountDue: D(1080),
  createdByMembershipId: "m9", dueDate: new Date(Date.now() + 86400000), company: { name: "Northwind" }, ...over,
});

describe("finance rules", () => {
  it("computes totals server-side with the 8% standard tax, exactly", () => {
    const { subtotal, tax, total, items } = rules.computeInvoice([{ name: "License", qty: 3, unitPrice: 33.33 }]);
    expect([subtotal.toString(), tax.toString(), total.toString()]).toEqual(["99.99", "8", "107.99"]);
    expect(items[0]).toMatchObject({ name: "License", qty: 3, lineTotal: 107.99 });
  });

  it("rejects empty invoices and bad lines", () => {
    expect(() => rules.computeInvoice([])).toThrow(RangeError);
    expect(() => rules.computeInvoice([{ name: "X", qty: 0, unitPrice: 5 }])).toThrow(/quantity/);
    expect(() => rules.computeInvoice([{ name: "", qty: 1, unitPrice: 5 }])).toThrow(/description/);
  });

  it("derives Overdue only for unsettled sent invoices past due", () => {
    const past = new Date(Date.now() - 86400000);
    expect(rules.displayStatus({ status: "Sent", dueDate: past })).toBe("Overdue");
    expect(rules.displayStatus({ status: "Paid", dueDate: past })).toBe("Paid");
    expect(rules.displayStatus({ status: "Draft", dueDate: past })).toBe("Draft");
  });
});

describe("invoices", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create numbers per org, starts Draft, and ignores client totals/status", async () => {
    mockInvoiceCreate.mockImplementation(({ data }) => ({ id: "i1", ...data }));
    await invoices.create(req({ items: [{ name: "Setup", qty: 1, unitPrice: 1000 }], total: 1, status: "Paid", amountPaid: 999 }), mockRes());
    const { data } = mockInvoiceCreate.mock.calls[0][0];
    expect(data).toMatchObject({ status: "Draft", organizationId: "org1", invoiceNumber: expect.stringMatching(/^INV-\d{4}-000003$/), createdByMembershipId: "m1" });
    expect(data.total.toString()).toBe("1080");
    expect(Number(data.amountPaid)).toBe(0);
  });

  it("an invoice at or above the threshold can't be approved by its creator", async () => {
    mockInvoiceFindFirst.mockResolvedValue({ id: "i1", status: "Draft", total: D(12000), createdByMembershipId: "m1" });
    const res = mockRes();
    await invoices.approve(req({}, { invoiceId: "i1" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();

    mockInvoiceFindFirst.mockResolvedValue({ id: "i1", status: "Draft", total: D(500), createdByMembershipId: "m1" });
    await invoices.approve(req({}, { invoiceId: "i1" }), mockRes());
    expect(mockInvoiceUpdate.mock.calls[0][0].data).toMatchObject({ status: "Approved", approvedByMembershipId: "m1" });
  });

  it("payments: none before sending, never more than is due, and they settle the status", async () => {
    mockInvoiceFindFirst.mockResolvedValue(sentInvoice({ status: "Approved" }));
    const draftRes = mockRes();
    await invoices.recordPayment(req({ amount: 10 }, { invoiceId: "i1" }), draftRes);
    expect(draftRes.status).toHaveBeenCalledWith(400);

    mockInvoiceFindFirst.mockResolvedValue(sentInvoice());
    const overRes = mockRes();
    await invoices.recordPayment(req({ amount: 2000 }, { invoiceId: "i1" }), overRes);
    expect(overRes.status).toHaveBeenCalledWith(400);

    await invoices.recordPayment(req({ amount: 80 }, { invoiceId: "i1" }), mockRes());
    expect(mockInvoiceUpdate.mock.calls[0][0].data).toMatchObject({ status: "Partially Paid" });
    expect(mockInvoiceUpdate.mock.calls[0][0].data.amountDue.toString()).toBe("1000");

    mockInvoiceFindFirst.mockResolvedValue(sentInvoice({ status: "Partially Paid", amountPaid: D(80), amountDue: D(1000) }));
    await invoices.recordPayment(req({ amount: 1000, method: "Cash" }, { invoiceId: "i1" }), mockRes());
    expect(mockInvoiceUpdate.mock.calls[1][0].data).toMatchObject({ status: "Paid" });
    expect(mockPaymentCreate.mock.calls[1][0].data).toMatchObject({ method: "Cash", recordedByMembershipId: "m1" });
  });

  it("an invoice with payments can't be voided", async () => {
    mockInvoiceFindFirst.mockResolvedValue(sentInvoice({ amountPaid: D(10) }));
    const res = mockRes();
    await invoices.voidInvoice(req({ reason: "Duplicate" }, { invoiceId: "i1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });

  it("credit notes: capped at what's left to credit, and they reduce what's due", async () => {
    mockInvoiceFindFirst.mockResolvedValue(sentInvoice({ amountCredited: D(1000) }));
    const res = mockRes();
    await invoices.issueCreditNote(req({ invoiceId: "i1", amount: 100, reason: "Discount" }), res);
    expect(res.status).toHaveBeenCalledWith(400);

    mockInvoiceFindFirst.mockResolvedValue(sentInvoice({ status: "Partially Paid", amountPaid: D(1000), amountDue: D(80) }));
    mockCreditCreate.mockImplementation(({ data }) => ({ id: "cn1", ...data }));
    await invoices.issueCreditNote(req({ invoiceId: "i1", amount: 80, reason: "Goodwill" }), mockRes());
    expect(mockCreditCreate.mock.calls[0][0].data).toMatchObject({ creditNoteNumber: expect.stringMatching(/^CN-/), reason: "Goodwill" });
    expect(mockInvoiceUpdate.mock.calls[0][0].data).toMatchObject({ status: "Paid" });
    expect(mockInvoiceUpdate.mock.calls[0][0].data.amountDue.toString()).toBe("0");
  });

  it("narrower scopes: own invoices, or the caller's department", () => {
    expect(invoices.financeScopeWhere(req({}, {}, { scope: "Own" }), "invoices", "createdByMembership", "createdByMembershipId")).toEqual({ createdByMembershipId: "m1" });
    expect(invoices.financeScopeWhere(req({}, {}, { scope: "Department", department: "Sales" }), "invoices", "createdByMembership", "createdByMembershipId"))
      .toEqual({ createdByMembership: { user: { department: "Sales" } } });
  });
});

describe("expenses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submitting always starts Pending and records the submitter", async () => {
    mockExpenseCreate.mockImplementation(({ data }) => ({ id: "e1", ...data }));
    await expenses.create(req({ description: "Taxi", amount: "42.5", category: "Travel", status: "Approved" }), mockRes());
    expect(mockExpenseCreate.mock.calls[0][0].data).toMatchObject({ status: "Pending", submittedByMembershipId: "m1", expenseNumber: expect.stringMatching(/^EXP-/) });
  });

  it("nobody reviews their own expense; only Pending ones; rejecting needs the reject grant", async () => {
    mockExpenseFindFirst.mockResolvedValue({ id: "e1", status: "Pending", submittedByMembershipId: "m1" });
    const own = mockRes();
    await expenses.review(req({ status: "Approved" }, { expenseId: "e1" }), own);
    expect(own.status).toHaveBeenCalledWith(403);

    mockExpenseFindFirst.mockResolvedValue({ id: "e1", status: "Approved", submittedByMembershipId: "m2" });
    const done = mockRes();
    await expenses.review(req({ status: "Rejected" }, { expenseId: "e1" }), done);
    expect(done.status).toHaveBeenCalledWith(400);

    const noGrant = mockRes();
    await expenses.review(req({ status: "Rejected" }, { expenseId: "e1" }, { grants: { expenses: ["view", "approve"] } }), noGrant);
    expect(noGrant.status).toHaveBeenCalledWith(403);
    expect(mockExpenseUpdate).not.toHaveBeenCalled();
  });
});

describe("recurring invoices", () => {
  it("a paused template can't generate invoices", async () => {
    mockRecurringFindFirst.mockResolvedValue({ id: "r1", active: false, items: [] });
    const res = mockRes();
    await recurring.generate(req({}, { recurringId: "r1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
