import { describe, it, expect } from "vitest";
import { toUiInvoice, toUiExpense, toApiInvoice, toApiExpense, BACKEND_ENABLED } from "./financeBackend";

describe("financeBackend shape translation", () => {
  it("is off under test regardless of the developer's .env", () => {
    expect(BACKEND_ENABLED).toBe(false);
  });

  const owners = new Map([["m1", { id: "m1", name: "Sam Rep" }]]);

  it("maps an invoice's company, approver and payments onto the UI's shape", () => {
    const ui = toUiInvoice(
      {
        _id: "i1", invoiceNumber: "INV-2026-000001", status: "Paid", total: 1080, approvedByMembershipId: "m1", company: { _id: "co1", name: "Northwind" },
        payments: [{ _id: "p1", amount: 1080, method: "Cash", date: "2026-09-01T00:00:00.000Z", reference: null, recordedByMembershipId: "m1" }],
      },
      owners,
    );
    expect(ui).toMatchObject({ companyName: "Northwind", approvedBy: "Sam Rep", total: 1080 });
    expect(ui.payments).toEqual([{ _id: "p1", amount: 1080, method: "Cash", date: "2026-09-01T00:00:00.000Z", reference: null }]);
  });

  it("maps an expense's submitter and reviewer to names", () => {
    expect(toUiExpense({ _id: "e1", submittedByMembershipId: "m1", reviewedByMembershipId: null }, owners)).toMatchObject({ submittedBy: "Sam Rep", reviewedBy: null });
  });

  it("never sends totals, statuses or names", () => {
    expect(toApiInvoice({ companyId: "co1", companyName: "X", total: 5, status: "Paid", items: [{ name: "A", qty: 1, unitPrice: 10, lineTotal: 999 }] })).toEqual({
      companyId: "co1", items: [{ name: "A", qty: 1, unitPrice: 10 }],
    });
    expect(toApiExpense({ description: "Taxi", amount: 12, submittedBy: "Me", status: "Approved" })).toEqual({ description: "Taxi", amount: 12 });
  });
});
