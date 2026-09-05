import { describe, it, expect } from "vitest";
import { deals, leads, companies, contacts } from "../../Helpers/mockCrmData";
import { activities } from "../../Helpers/mockActivitiesData";
import { quotes } from "../../Helpers/mockQuoteData";
import { orders } from "../../Helpers/mockOrderData";
import { contracts } from "../../Helpers/mockContractData";
import { scopeSharedData } from "./aiInsightEngine";
import { createAnalysisRequest } from "./aiTypes";
import { buildExploreRecordsPayload, findingToPseudoInsight } from "./aiExploreEngine";

const sharedData = { deals, leads, companies, contacts, activities, quotes, orders, contracts };

function scopedFor(role, scope = "all") {
  const request = createAnalysisRequest({ userId: "u1", role, scope, dateRange: { preset: "thisMonth" } });
  return scopeSharedData(sharedData, request);
}

describe("buildExploreRecordsPayload", () => {
  it("returns all eight record arrays, each an array", () => {
    const payload = buildExploreRecordsPayload(scopedFor("Super-Admin"), "Super-Admin");
    for (const key of ["deals", "leads", "companies", "contacts", "activities", "quotes", "orders", "contracts"]) {
      expect(Array.isArray(payload[key])).toBe(true);
    }
  });

  it("caps each record type at 40 entries", () => {
    const manyDeals = Array.from({ length: 60 }, (_, i) => ({ _id: `d${i}`, name: `Deal ${i}`, value: 100 }));
    const payload = buildExploreRecordsPayload({ ...scopedFor("Super-Admin"), deals: manyDeals }, "Super-Admin");
    expect(payload.deals).toHaveLength(40);
  });

  it("only includes allowlisted fields on a Deal, never arbitrary extra fields", () => {
    const scoped = scopedFor("Super-Admin");
    const payload = buildExploreRecordsPayload(scoped, "Super-Admin");
    const deal = payload.deals.find((d) => d._id);
    expect(deal).toBeTruthy();
    expect(Object.keys(deal).every((k) =>
      ["_id", "name", "stage", "value", "expectedClosingDate", "ownerId", "companyId", "nextAction", "dealHealth", "priority", "createdAt", "updatedAt"].includes(k)
    )).toBe(true);
  });

  it("masks Deal value and Quote amount to null for the Checker role", () => {
    const scoped = scopedFor("Super-Admin"); // shape only — masking is applied regardless of what actually scoped for Checker
    const payload = buildExploreRecordsPayload(scoped, "Checker");
    for (const d of payload.deals) expect(d.value === null || d.value === undefined).toBe(true);
    for (const q of payload.quotes) expect(q.amount === null || q.amount === undefined).toBe(true);
  });

  it("leaves Deal value intact for a non-Checker role", () => {
    const scoped = scopedFor("Super-Admin");
    const payload = buildExploreRecordsPayload(scoped, "Super-Admin");
    const dealWithValue = payload.deals.find((d) => typeof d.value === "number");
    expect(dealWithValue).toBeTruthy();
  });
});

describe("findingToPseudoInsight", () => {
  const scoped = scopedFor("Super-Admin");

  it("prefixes the title with 'Unverified:' and pins confidence to Insufficient Data", () => {
    const insight = findingToPseudoInsight({ title: "Stalled deal", observation: "Idle 20 days.", citedRecordIds: [] }, scoped, "Super-Admin");
    expect(insight.title).toBe("Unverified: Stalled deal");
    expect(insight.confidence.level).toBe("Insufficient Data");
    expect(insight.summary).toBe("Idle 20 days.");
  });

  it("resolves a cited Deal id into a real evidence reference with a route", () => {
    const deal = scoped.deals[0];
    const insight = findingToPseudoInsight({ title: "x", observation: "y", citedRecordIds: [deal._id] }, scoped, "Super-Admin");
    expect(insight.evidence).toHaveLength(1);
    expect(insight.evidence[0].recordType).toBe("Deal");
    expect(insight.evidence[0].recordId).toBe(deal._id);
    expect(insight.evidence[0].route).toBe(`/crm/deals/${deal._id}`);
    expect(insight.affectedRecordIds).toEqual([deal._id]);
  });

  it("resolves a cited Activity id with a null route, since Activities have no detail page", () => {
    const activity = scoped.activities[0];
    const insight = findingToPseudoInsight({ title: "x", observation: "y", citedRecordIds: [activity._id] }, scoped, "Super-Admin");
    expect(insight.evidence[0].recordType).toBe("Activity");
    expect(insight.evidence[0].route).toBeNull();
  });

  it("silently drops a cited id that doesn't resolve against any scoped record", () => {
    const insight = findingToPseudoInsight({ title: "x", observation: "y", citedRecordIds: ["totally-invented-id"] }, scoped, "Super-Admin");
    expect(insight.evidence).toEqual([]);
    expect(insight.affectedRecordIds).toEqual([]);
  });

  it("adapts a suggestedAction into a real AISuggestedAction requiring human approval", () => {
    const deal = scoped.deals[0];
    const insight = findingToPseudoInsight({
      title: "x", observation: "y", citedRecordIds: [deal._id],
      suggestedAction: { type: "create_follow_up", label: "Follow up", reason: "Re-engage", affectedRecordId: deal._id, affectedRecordType: "Deal" },
    }, scoped, "Super-Admin");
    expect(insight.suggestedActions).toHaveLength(1);
    expect(insight.suggestedActions[0].type).toBe("create_follow_up");
    expect(insight.suggestedActions[0].affectedRecordType).toBe("Deal");
    expect(insight.suggestedActions[0].requiresHumanApproval).toBe(true);
  });

  it("produces a unique id for each call so multiple findings never collide", () => {
    const a = findingToPseudoInsight({ title: "a", observation: "x", citedRecordIds: [] }, scoped, "Super-Admin");
    const b = findingToPseudoInsight({ title: "b", observation: "x", citedRecordIds: [] }, scoped, "Super-Admin");
    expect(a.id).not.toBe(b.id);
  });
});
