import { describe, it, expect } from "vitest";
import { toUiOrder, toApiOrder, toUiContract, toApiContract, BACKEND_ENABLED } from "./crmOrdersContractsBackend";

const owners = new Map([["m1", { id: "m1", name: "Org Admin" }]]);

describe("crmOrdersContractsBackend shape translation", () => {
  it("is off under test regardless of the developer's .env", () => {
    expect(BACKEND_ENABLED).toBe(false);
  });

  it("maps an order's owner, money and lines (ordered, numeric)", () => {
    const ui = toUiOrder({
      _id: "o1", ownerMembershipId: "m1", grandTotal: "1080.00",
      lineItems: [
        { _id: "l2", order: 1, quantity: "2", unitPrice: "50.00", quantityFulfilled: "1", fulfillmentNotes: null },
        { _id: "l1", order: 0, quantity: "1", unitPrice: "980.00" },
      ],
    }, owners);
    expect(ui).toMatchObject({ ownerId: "m1", ownerName: "Org Admin", grandTotal: 1080 });
    expect(ui.lineItems.map((l) => l._id)).toEqual(["l1", "l2"]);
    expect(ui.lineItems[1]).toMatchObject({ quantity: 2, unitPrice: 50, quantityFulfilled: 1, fulfillmentNotes: [] });
  });

  it("builds the signatories object and amendment authors for a contract", () => {
    const ui = toUiContract({
      _id: "c1", contractValue: "12000.00",
      internalSignatoryName: "Org Admin", internalSignedAt: "2026-09-01T00:00:00.000Z",
      amendmentHistory: [{ actorMembershipId: "m1", previousEndDate: "2026-12-31", newEndDate: "2027-12-31", note: "" }],
    }, owners);
    expect(ui.contractValue).toBe(12000);
    expect(ui.signatories).toEqual({ internal: { name: "Org Admin", title: "", signedAt: "2026-09-01T00:00:00.000Z" }, customer: null });
    expect(ui.amendmentHistory[0]).toMatchObject({ actor: "Org Admin", newEndDate: "2027-12-31" });
  });

  it("never sends lifecycle state (status, signatures, totals, hold/cancel data) through an edit", () => {
    expect(toApiOrder({ customerReference: "PO-7", status: "Fulfilled", grandTotal: 1, holdReason: "x", ownerId: "m1" })).toEqual({ customerReference: "PO-7", ownerMembershipId: "m1" });
    expect(toApiContract({ internalNote: "n", status: "Signed", signatories: {}, signedAt: "x", contractValue: 1, lineItems: [{ name: "A" }] })).toEqual({
      internalNote: "n", lineItems: [{ name: "A", order: 0 }],
    });
  });
});
