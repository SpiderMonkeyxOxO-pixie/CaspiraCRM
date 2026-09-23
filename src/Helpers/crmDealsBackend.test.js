import { describe, it, expect } from "vitest";
import { toUiDeal, toApiDeal, BACKEND_ENABLED } from "./crmDealsBackend";

const pipelines = [{ _id: "p1", name: "New Business", isDefault: true, stages: [{ _id: "s1", name: "Discovery", classification: "Open" }] }];

describe("crmDealsBackend shape translation", () => {
  it("is off under test regardless of the developer's .env", () => {
    expect(BACKEND_ENABLED).toBe(false);
  });

  it("names the pipeline, derives weighted value and maps line items, quotes and stage history", () => {
    const owners = new Map([["m1", { id: "m1", name: "Priya Nair" }]]);
    const ui = toUiDeal(
      {
        _id: "d1", name: "Rollout", pipelineId: "p1", stage: "Proposal", value: 10000, probability: 50, ownerMembershipId: "m1",
        cancelReason: null, holdReason: "Budget freeze", createdAt: "2026-09-01T00:00:00.000Z",
        lineItems: [
          { _id: "li1", catalogItemId: "cat1", nameSnapshot: "License", quantity: 10, unitPrice: 100, discountType: "Percentage", discountValue: 10, billingFrequency: "Monthly" },
          { _id: "li2", nameSnapshot: "Setup", quantity: 1, unitPrice: 500, billingFrequency: null },
        ],
        quotes: [{ _id: "q1", quoteNumber: "QUOTE-2026-000001", version: 1, grandTotal: 1080, status: "Draft", validUntilDate: null, createdAt: "2026-09-02T00:00:00.000Z" }],
      },
      {
        ownersById: owners,
        pipelines,
        stageHistory: [{ _id: "h1", fromStageName: "Discovery", toStageName: "Proposal", changedAt: "2026-09-03T00:00:00.000Z", reason: null, timeInPreviousStageSeconds: 60 }],
      },
    );

    expect(ui).toMatchObject({ pipeline: "New Business", ownerName: "Priya Nair", weightedValue: 5000, onHoldReason: "Budget freeze", expectedRecurringValue: 900 });
    expect(ui.lineItems[0]).toMatchObject({ productId: "cat1", name: "License", discountPercent: 10, lineTotal: 900, billingFrequency: "Monthly" });
    expect(ui.lineItems[1]).toMatchObject({ discountPercent: 0, billingFrequency: "One-time", lineTotal: 500 });
    expect(ui.quotes[0]).toMatchObject({ quoteNumber: "QUOTE-2026-000001", amount: 1080 });
    expect(ui.stageHistory[0]).toMatchObject({ from: "Discovery", to: "Proposal", timeInStagePriorMs: 60000 });
  });

  it("never sends pipeline/stage/status/outcome fields through an ordinary update", () => {
    expect(toApiDeal({ name: "X", stage: "Won", status: "Won", pipeline: "Renewals", winReason: "r", ownerId: "m2", handoffOwnerId: "", weightedValue: 1 })).toEqual({
      name: "X", ownerMembershipId: "m2", handoffOwnerMembershipId: null,
    });
  });
});
