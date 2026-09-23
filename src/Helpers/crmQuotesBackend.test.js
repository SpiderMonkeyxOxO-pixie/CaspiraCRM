import { describe, it, expect } from "vitest";
import { toUiQuote, toApiQuote, toUiApproval, BACKEND_ENABLED } from "./crmQuotesBackend";

const owners = new Map([
  ["m1", { id: "m1", name: "Sam Rep" }],
  ["m2", { id: "m2", name: "Org Admin" }],
]);

describe("crmQuotesBackend shape translation", () => {
  it("is off under test regardless of the developer's .env", () => {
    expect(BACKEND_ENABLED).toBe(false);
  });

  it("rebuilds the UI approval object from SalesApproval rows (latest drives status, decisions become comments)", () => {
    const approval = toUiApproval(
      [
        { requestedByMembershipId: "m1", requestedAt: "2026-09-01T00:00:00.000Z", status: "Changes Requested", decidedByMembershipId: "m2", decidedAt: "2026-09-02T00:00:00.000Z", decisionReason: "Lower the discount" },
        { requestedByMembershipId: "m1", requestedAt: "2026-09-03T00:00:00.000Z", status: "Pending", reason: "Discount exceeds threshold" },
      ],
      owners,
    );
    expect(approval).toMatchObject({ required: true, status: "Pending", requestedBy: "Sam Rep", reason: "Discount exceeds threshold" });
    expect(approval.comments).toEqual([{ author: "Org Admin", at: "2026-09-02T00:00:00.000Z", text: "Lower the discount", type: "Request Changes" }]);
    expect(toUiApproval([], owners)).toMatchObject({ required: false, status: "Not Required" });
  });

  it("maps money to numbers, orders line items and exposes the superseding quote", () => {
    const ui = toUiQuote({
      _id: "q1", ownerMembershipId: "m1", supersededByQuoteId: "q2", grandTotal: "1080.00",
      lineItems: [
        { _id: "l2", order: 1, name: "Setup", quantity: "1", unitPrice: "500.00", skuSnapshot: "SET-1" },
        { _id: "l1", order: 0, name: "License", quantity: "10", unitPrice: "90.00" },
      ],
    }, owners);
    expect(ui).toMatchObject({ ownerName: "Sam Rep", supersededBy: "q2", grandTotal: 1080 });
    expect(ui.lineItems.map((l) => l.name)).toEqual(["License", "Setup"]);
    expect(ui.lineItems[1]).toMatchObject({ sku: "SET-1", quantity: 1, unitPrice: 500 });
  });

  it("never sends status, approval, totals or send/response records through an edit", () => {
    expect(toApiQuote({ title: "T", status: "Approved", approval: {}, grandTotal: 1, sendPreview: {}, ownerId: "m1", lineItems: [{ name: "A" }] })).toEqual({
      title: "T", ownerMembershipId: "m1", lineItems: [{ name: "A", order: 0 }],
    });
  });
});
