import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const D = (v) => new Prisma.Decimal(v);
const db = {
  financeSettings: { findUnique: vi.fn(async () => null) },
  financeOverride: { create: vi.fn() },
  invoice: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
  vendorBill: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
  payment: { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ id: "p1", amount: D(0), allocations: [] })), updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() },
  paymentAllocation: { count: vi.fn(async () => 0), updateMany: vi.fn(), createMany: vi.fn() },
  creditNote: { findMany: vi.fn(async () => []), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(async ({ data }) => ({ id: "cn1", ...data })), updateMany: vi.fn(async () => ({ count: 1 })) },
  financialAccount: { findFirst: vi.fn(), create: vi.fn(async ({ data }) => ({ id: "fa1", ...data })) },
  ledgerAccount: { findFirst: vi.fn() },
  taxRate: { findMany: vi.fn(async () => []) },
  company: { findFirst: vi.fn(async () => ({ id: "co1" })) },
  auditEvent: { create: vi.fn() },
  salesDocumentCounter: { upsert: vi.fn(), update: vi.fn(async () => ({ value: 1 })) },
};
db.$transaction = vi.fn(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
vi.mock("../../lib/prisma.js", () => ({ default: db }));

const invoices = await import("./invoicesController.js");
const payments = await import("./paymentsController.js");
const credits = await import("./creditNotesController.js");
const settlement = await import("../../services/finance/settlementService.js");

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
const settings = { baseCurrency: "USD", receivableAccountId: "ar", revenueAccountId: "rev", taxPayableAccountId: "tax", payableAccountId: "ap" };
const invoice = (over = {}) => ({ id: "i1", organizationId: "org1", invoiceNumber: "INV-1", status: "Sent", sentAt: new Date(), currency: "USD", total: D(1080), tax: D(80), amountPaid: D(0), amountCredited: D(0), amountDue: D(1080), version: 4, journalEntryId: "je1", companyId: "co1", ...over });

beforeEach(() => {
  for (const m of Object.values(db)) if (typeof m === "object") for (const fn of Object.values(m)) fn.mockClear?.();
});

describe("invoice posting", () => {
  it("journal: Dr receivable for the total, Cr revenue and tax, balanced", async () => {
    const lines = await invoices.invoiceJournalLines(db, { ...invoice(), lines: [
      { lineSubtotal: D(600), taxAmount: D(48), revenueAccountId: null },
      { lineSubtotal: D(400), taxAmount: D(32), revenueAccountId: "rev2" },
    ] }, settings);
    const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    expect([dr, cr]).toEqual([1080, 1080]);
    expect(lines.find((l) => l.accountId === "tax")).toMatchObject({ credit: "80.00" });
  });

  it("only an approved invoice posts; sending needs posting first", async () => {
    db.invoice.findFirst.mockResolvedValue({ ...invoice({ status: "Draft" }), lines: [] });
    const res = mockRes();
    await invoices.post(req({ invoices: ["post"] }, {}, { invoiceId: "i1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    db.invoice.findFirst.mockResolvedValue({ ...invoice({ status: "Approved" }), lines: [] });
    const send = mockRes();
    await invoices.send(req({ invoices: ["issue"] }, {}, { invoiceId: "i1" }), send);
    expect(send.json.mock.calls[0][0].message).toMatch(/Post the invoice/);
  });

  it("Overdue is derived; legacy invoices are labelled as outside the ledger", () => {
    expect(invoices.displayStatus({ status: "Sent", dueDate: new Date("2020-01-01"), amountDue: D(5) })).toBe("Overdue");
    expect(invoices.displayStatus({ status: "Paid", dueDate: new Date("2020-01-01"), amountDue: D(0) })).toBe("Paid");
    expect(invoices.serializeInvoice({ id: "i", status: "Sent", journalEntryId: null, amountDue: D(0) }).ledgerState).toMatch(/Legacy/);
  });
});

describe("settlement", () => {
  it("a partial payment → Partially Paid, full → Paid, reversal → back to Sent", async () => {
    db.invoice.findUnique.mockResolvedValueOnce(invoice());
    const partial = await settlement.settleInvoice(db, "i1", D(80));
    expect([partial.status, partial.amountDue.toFixed(2)]).toEqual(["Partially Paid", "1000.00"]);
    db.invoice.findUnique.mockResolvedValueOnce(invoice({ status: "Partially Paid", amountPaid: D(80), amountDue: D(1000) }));
    expect((await settlement.settleInvoice(db, "i1", D(1000))).status).toBe("Paid");
    db.invoice.findUnique.mockResolvedValueOnce(invoice({ status: "Paid", amountPaid: D(1080), amountDue: D(0) }));
    expect((await settlement.settleInvoice(db, "i1", D(1080), -1)).status).toBe("Sent");
  });

  it("never more than is due, and a concurrent change is a conflict", async () => {
    db.invoice.findUnique.mockResolvedValueOnce(invoice());
    await expect(settlement.settleInvoice(db, "i1", D(2000))).rejects.toThrow(/still due/);
    db.invoice.findUnique.mockResolvedValueOnce(invoice());
    db.invoice.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(settlement.settleInvoice(db, "i1", D(10))).rejects.toMatchObject({ status: 409 });
    expect(db.invoice.updateMany.mock.calls.at(-1)[0].where).toEqual({ id: "i1", version: 4 });
  });

  it("bills settle the same way", async () => {
    db.vendorBill.findUnique.mockResolvedValueOnce({ id: "b1", billNumber: "BILL-1", status: "Posted", currency: "USD", total: D(100), amountPaid: D(0), amountDue: D(100), version: 1 });
    expect((await settlement.settleBill(db, "b1", D(100))).status).toBe("Paid");
  });
});

describe("payments", () => {
  const account = { id: "fa1", name: "Operating", currency: "USD", ledgerAccountId: "bank", active: true };

  it("recording is a Draft with pending allocations, labelled as a record only", async () => {
    db.financialAccount.findFirst.mockResolvedValue(account);
    db.invoice.findFirst.mockResolvedValue(invoice());
    db.payment.create.mockImplementation(async ({ data }) => ({ id: "p1", ...data, allocations: data.allocations.create }));
    const res = mockRes();
    await payments.createPayment(req({ payments: ["create"] }, { financialAccountId: "fa1", amount: "100", date: "2026-09-01", companyId: "co1", allocations: [{ invoiceId: "i1", amount: "100" }] }), res);
    const { payment } = res.json.mock.calls[0][0];
    expect(payment).toMatchObject({ status: "Draft", label: "Recorded payment — no bank or payment-provider transfer was performed.", allocatedAmount: 100 });
    expect(db.payment.create.mock.calls[0][0].data.allocations.create[0]).toMatchObject({ status: "Pending", invoiceId: "i1" });
  });

  it("refuses over-allocation, other currencies and unposted invoices", async () => {
    db.financialAccount.findFirst.mockResolvedValue(account);
    const cases = [
      [invoice(), { amount: "100", allocations: [{ invoiceId: "i1", amount: "150" }] }, /exceed/],
      [invoice({ currency: "EUR" }), { amount: "100", allocations: [{ invoiceId: "i1", amount: "50" }] }, /EUR/],
      [invoice({ journalEntryId: null }), { amount: "100", allocations: [{ invoiceId: "i1", amount: "50" }] }, /posted, open/],
      [invoice(), { amount: "100", currency: "EUR" }, /record the payment in USD/],
    ];
    for (const [inv, body, message] of cases) {
      db.invoice.findFirst.mockResolvedValue(inv);
      const res = mockRes();
      await payments.createPayment(req({ payments: ["create"] }, { financialAccountId: "fa1", date: "2026-09-01", ...body }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].message).toMatch(message);
    }
  });

  it("the recorder can't approve; only approved payments post; reversing needs a reason", async () => {
    db.payment.findFirst.mockResolvedValue({ id: "p1", status: "Submitted", version: 1, createdByMembershipId: "m1", amount: D(10), allocations: [] });
    const own = mockRes();
    await payments.approvePayment(req({ payments: ["approve"] }, {}, { paymentId: "p1" }), own);
    expect(own.status).toHaveBeenCalledWith(403);
    const notApproved = mockRes();
    await payments.postPayment(req({ payments: ["post"] }, {}, { paymentId: "p1" }), notApproved);
    expect(notApproved.status).toHaveBeenCalledWith(400);
    db.payment.findFirst.mockResolvedValue({ id: "p1", status: "Posted", version: 3, allocations: [] });
    const noReason = mockRes();
    await payments.reversePayment(req({ payments: ["reverse"] }, {}, { paymentId: "p1" }), noReason);
    expect(noReason.status).toHaveBeenCalledWith(400);
  });

  it("financial accounts take the last 4 digits only, shown masked without the sensitive grant", async () => {
    const full = mockRes();
    await payments.createFinancialAccount(req({}, { name: "Bank", type: "Bank", currency: "USD", lastDigits: "123456789", ledgerAccountId: "bank" }), full);
    expect(full.status).toHaveBeenCalledWith(400);
    db.ledgerAccount.findFirst.mockResolvedValue({ id: "bank", currency: null });
    db.financialAccount.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await payments.createFinancialAccount(req({}, { name: "Bank", type: "Bank", currency: "USD", lastDigits: "4321", ledgerAccountId: "bank" }), res);
    expect(db.financialAccount.create.mock.calls[0][0].data.maskedReference).toBe("•••• 4321");
    expect(res.json.mock.calls[0][0].financialAccount.maskedReference).toBe("••••");
  });
});

describe("credit notes", () => {
  it("only against a posted invoice, capped (drafts included), split into revenue and tax", async () => {
    db.invoice.findFirst.mockResolvedValue(invoice({ journalEntryId: null }));
    const legacy = mockRes();
    await credits.createCreditNote(req({ credit_notes: ["create"] }, { invoiceId: "i1", amount: "10", reason: "x" }), legacy);
    expect(legacy.status).toHaveBeenCalledWith(400);

    db.invoice.findFirst.mockResolvedValue(invoice({ amountCredited: D(1000) }));
    db.creditNote.findMany.mockResolvedValue([{ amount: D(50) }]);
    const over = mockRes();
    await credits.createCreditNote(req({ credit_notes: ["create"] }, { invoiceId: "i1", amount: "40", reason: "x" }), over);
    expect(over.json.mock.calls[0][0].message).toMatch(/30.00 left/);

    expect(credits.splitCredit(invoice(), D(108))).toMatchObject({ taxAdjustment: D(8) });
  });

  it("a posted credit reduces what's due, never below zero", async () => {
    db.invoice.findUnique.mockResolvedValueOnce(invoice({ status: "Partially Paid", amountPaid: D(1000), amountDue: D(80) }));
    const after = await settlement.creditInvoice(db, "i1", D(100));
    expect([after.amountDue.toFixed(2), after.status]).toEqual(["0.00", "Paid"]);
  });

  it("the creator can't approve their own credit note", async () => {
    db.creditNote.findFirst.mockResolvedValue({ id: "cn1", status: "Draft", version: 1, createdByMembershipId: "m1", invoice: invoice() });
    const res = mockRes();
    await credits.approveCreditNote(req({ credit_notes: ["approve"] }, {}, { creditNoteId: "cn1" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
