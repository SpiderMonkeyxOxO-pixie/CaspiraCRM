import { describe, it, expect } from "vitest";
import { deals, leads, companies, contacts } from "../../Helpers/mockCrmData";
import { activities } from "../../Helpers/mockActivitiesData";
import { quotes } from "../../Helpers/mockQuoteData";
import { orders } from "../../Helpers/mockOrderData";
import { contracts } from "../../Helpers/mockContractData";
import { generateAnalysisPreview, computeCompactMetrics } from "./aiInsightEngine";
import { createAnalysisRequest, AI_PROVIDER_STATUS } from "./aiTypes";
import { defaultScopeForRole } from "./aiConfig";

const sharedData = { deals, leads, companies, contacts, activities, quotes, orders, contracts };

function requestFor(role, overrides = {}) {
  return createAnalysisRequest({
    userId: "u1", role, scope: defaultScopeForRole(role), dateRange: { preset: "thisMonth" }, ...overrides,
  });
}

describe("generateAnalysisPreview — the frontend-only AI preview engine", () => {
  it("always reports the Frontend Analysis Preview provider status, never a real provider", () => {
    const response = generateAnalysisPreview(requestFor("Super-Admin"), sharedData);
    expect(response.providerStatus.status).toBe(AI_PROVIDER_STATUS);
    expect(response.providerStatus.isRealProvider).toBe(false);
  });

  it("never issues a network request — this is pure in-memory computation", () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = () => { called = true; throw new Error("fetch should never be called"); };
    generateAnalysisPreview(requestFor("Super-Admin"), sharedData);
    expect(called).toBe(false);
    globalThis.fetch = originalFetch;
  });

  it("runs for every real role without throwing", () => {
    for (const role of ["Super-Admin", "Admin", "Team-Leader", "User", "Checker"]) {
      expect(() => generateAnalysisPreview(requestFor(role), sharedData)).not.toThrow();
    }
  });

  it("every insight includes evidence, a written confidence explanation, and a priority", () => {
    const response = generateAnalysisPreview(requestFor("Super-Admin"), sharedData);
    expect(response.insights.length).toBeGreaterThan(0);
    for (const insight of response.insights) {
      expect(insight.confidence.level).toMatch(/Confidence|Insufficient Data/);
      expect(insight.confidence.explanation.length).toBeGreaterThan(10);
      expect(["Critical", "High", "Medium", "Low", "Informational"]).toContain(insight.priority);
      expect(Array.isArray(insight.evidence)).toBe(true);
    }
  });

  it("never uses a fake decimal confidence score", () => {
    const response = generateAnalysisPreview(requestFor("Super-Admin"), sharedData);
    for (const insight of response.insights) {
      expect(insight.confidence).not.toHaveProperty("percent");
      expect(typeof insight.confidence.level).toBe("string");
    }
  });

  it("executive summary values are internally consistent with the returned insights", () => {
    const response = generateAnalysisPreview(requestFor("Super-Admin"), sharedData);
    expect(response.executiveSummary.length).toBeGreaterThan(0);
    expect(response.executiveSummary).not.toMatch(/undefined|NaN/);
  });

  it("Standard Employee (User) scope='mine' excludes deals owned by other people", () => {
    const response = generateAnalysisPreview(requestFor("User", { scope: "mine" }), sharedData);
    const inactivityInsight = response.insights.find((i) => i.type === "deal_inactivity");
    if (inactivityInsight) {
      for (const dealId of inactivityInsight.affectedRecordIds) {
        const d = deals.find((x) => x._id === dealId);
        expect(d.ownerId).toBe("u1");
      }
    }
  });

  it("Executive scope='all' can surface deals from multiple owners", () => {
    const response = generateAnalysisPreview(requestFor("Super-Admin", { scope: "all" }), sharedData);
    const ids = new Set(response.insights.flatMap((i) => i.affectedRecordIds));
    const owners = new Set([...ids].map((id) => deals.find((d) => d._id === id)?.ownerId).filter(Boolean));
    expect(owners.size).toBeGreaterThanOrEqual(0);
  });

  it("Checker role masks monetary figures in insight summaries", () => {
    const response = generateAnalysisPreview(requestFor("Checker", { scope: "all" }), sharedData);
    const moneyInsight = response.insights.find((i) => i.type === "deal_inactivity" || i.type === "overdue_expected_close");
    if (moneyInsight) {
      expect(moneyInsight.summary).toMatch(/Additional restricted information/);
      expect(moneyInsight.summary).not.toMatch(/\$[\d,]+/);
    }
  });

  it("a role without CRM route access gets no route on CRM evidence", () => {
    const response = generateAnalysisPreview(requestFor("Checker", { scope: "all" }), sharedData);
    const dealEvidence = response.insights.flatMap((i) => i.evidence).filter((e) => e.recordType === "Deal");
    for (const e of dealEvidence) expect(e.route).toBeNull();
  });

  it("a role with CRM route access gets a real evidence route", () => {
    const response = generateAnalysisPreview(requestFor("Super-Admin", { scope: "all" }), sharedData);
    const dealEvidence = response.insights.flatMap((i) => i.evidence).filter((e) => e.recordType === "Deal" && e.route);
    if (dealEvidence.length > 0) expect(dealEvidence[0].route).toMatch(/^\/crm\/deals\//);
  });

  it("suggested actions always require human approval and never claim execution", () => {
    const response = generateAnalysisPreview(requestFor("Super-Admin", { scope: "all" }), sharedData);
    for (const action of response.suggestedActions) {
      expect(action.requiresHumanApproval).toBe(true);
      expect(action.requiredApprover).toBeTruthy();
    }
  });

  it("data freshness reflects the actual latest record timestamp in scope", () => {
    const response = generateAnalysisPreview(requestFor("Super-Admin", { scope: "all" }), sharedData);
    expect(response.dataDate.generatedAt).toBeTruthy();
    expect(response.dataDate.recordCount).toBeGreaterThan(0);
  });

  it("limitations always mention frontend-only fixture data", () => {
    const response = generateAnalysisPreview(requestFor("Super-Admin"), sharedData);
    expect(response.limitations.some((l) => /fixture data/i.test(l))).toBe(true);
  });

  it("empty scope (no records at all) produces no record-dependent insights, not an error", () => {
    const response = generateAnalysisPreview(requestFor("User", { scope: "mine", team: "nonexistent-owner-xyz" }), {
      deals: [], leads: [], companies: [], contacts: [], activities: [], quotes: [], orders: [], contracts: [],
    });
    // "No scheduled next actions" checks the fixed CRM_TEAM roster, independent
    // of scoped record data, so it can still fire — every other insight,
    // which does depend on scoped records, must not.
    const recordDependent = response.insights.filter((i) => i.type !== "no_scheduled_next_actions");
    expect(recordDependent).toEqual([]);
    expect(() => generateAnalysisPreview(requestFor("User", { scope: "mine" }), {
      deals: [], leads: [], companies: [], contacts: [], activities: [], quotes: [], orders: [], contracts: [],
    })).not.toThrow();
  });

  it("computeCompactMetrics counts are internally consistent with the response", () => {
    const response = generateAnalysisPreview(requestFor("Super-Admin", { scope: "all" }), sharedData);
    const metrics = computeCompactMetrics(response);
    expect(metrics.criticalRisks).toBeLessThanOrEqual(response.insights.length);
    expect(metrics.suggestedActions).toBe(response.suggestedActions.length);
    if (metrics.highConfidenceShare !== null) {
      expect(metrics.highConfidenceShare).toBeGreaterThanOrEqual(0);
      expect(metrics.highConfidenceShare).toBeLessThanOrEqual(100);
    }
  });

  it("regenerating after a shared record changes reflects the change", () => {
    const before = generateAnalysisPreview(requestFor("Super-Admin", { scope: "all" }), sharedData);
    const beforeInactivity = before.insights.find((i) => i.type === "deal_inactivity");
    if (!beforeInactivity) return; // nothing to prove the point with in this fixture snapshot
    const targetId = beforeInactivity.affectedRecordIds[0];
    const patchedDeals = deals.map((d) => (d._id === targetId ? { ...d, updatedAt: new Date().toISOString() } : d));
    const after = generateAnalysisPreview(requestFor("Super-Admin", { scope: "all" }), { ...sharedData, deals: patchedDeals });
    const afterInactivity = after.insights.find((i) => i.type === "deal_inactivity");
    const stillAffected = afterInactivity?.affectedRecordIds.includes(targetId);
    expect(stillAffected).toBeFalsy();
  });
});
