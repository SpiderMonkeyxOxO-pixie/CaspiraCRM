import { describe, it, expect } from "vitest";
import {
  PIPELINE_CONFIGS, findPipelineConfig, DEAL_PIPELINES, DEAL_STAGE_COLORS, DEAL_STAGES,
  createDealRecord, queryDealsLocal, companies, deals,
} from "./mockCrmData";
import { CURRENT_MOCK_OWNER_ID } from "./mockUsersData";

describe("mockCrmData — Pipeline configuration", () => {
  it("defines exactly the three named pipelines the Pipeline route supports", () => {
    expect(DEAL_PIPELINES).toEqual(["New Business", "Renewals", "Partnerships"]);
  });

  it("every pipeline config carries id/name/description/currency/visibility — the single shared source of truth", () => {
    for (const p of PIPELINE_CONFIGS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(p.currency).toBeTruthy();
      expect(typeof p.visible).toBe("boolean");
    }
  });

  it("findPipelineConfig resolves by id or by name, falling back to the first config", () => {
    expect(findPipelineConfig("new-business").name).toBe("New Business");
    expect(findPipelineConfig("Renewals").id).toBe("renewals");
    expect(findPipelineConfig("does-not-exist")).toBe(PIPELINE_CONFIGS[0]);
  });

  it("DEAL_STAGE_COLORS covers every open stage and every outcome", () => {
    for (const stage of DEAL_STAGES) expect(DEAL_STAGE_COLORS[stage]).toBeTruthy();
    for (const outcome of ["Lost", "Cancelled", "On Hold"]) expect(DEAL_STAGE_COLORS[outcome]).toBeTruthy();
  });

  it("every deal fixture's pipeline value is one of the three configured pipelines (no orphaned/legacy pipeline names)", () => {
    for (const d of deals) expect(DEAL_PIPELINES).toContain(d.pipeline);
  });

  it("each configured pipeline has at least one real deal — no meaningless empty pipeline option", () => {
    for (const name of DEAL_PIPELINES) {
      expect(deals.some((d) => d.pipeline === name)).toBe(true);
    }
  });
});

describe("mockCrmData — queryDealsLocal Pipeline-only additions", () => {
  it("resolves ownerId='me' to the shared CURRENT_MOCK_OWNER_ID, same convention as Leads", () => {
    const deal = createDealRecord({ name: "Owned by me", companyId: companies[0]._id, ownerId: CURRENT_MOCK_OWNER_ID }, "Tester");
    const result = queryDealsLocal(deals, { ownerId: "me", search: "Owned by me" });
    expect(result.deals.map((d) => d._id)).toContain(deal._id);
  });

  it("closingOverdue filters to open deals whose expected close date has passed", () => {
    const overdue = createDealRecord({ name: "Overdue close test", companyId: companies[0]._id, expectedClosingDate: new Date(Date.now() - 86400000).toISOString() }, "Tester");
    const future = createDealRecord({ name: "Overdue close test future", companyId: companies[0]._id, expectedClosingDate: new Date(Date.now() + 86400000).toISOString() }, "Tester");
    const result = queryDealsLocal(deals, { closingOverdue: "true", search: "Overdue close test", pageSize: 1000 });
    const ids = result.deals.map((d) => d._id);
    expect(ids).toContain(overdue._id);
    expect(ids).not.toContain(future._id);
  });

  it("hasProducts filters to deals with at least one line item", () => {
    const withProducts = createDealRecord({ name: "Products filter test", companyId: companies[0]._id, lineItems: [{ name: "X", quantity: 1, unitPrice: 10 }] }, "Tester");
    const withoutProducts = createDealRecord({ name: "Products filter test empty", companyId: companies[0]._id }, "Tester");
    const result = queryDealsLocal(deals, { hasProducts: "true", search: "Products filter test", pageSize: 1000 });
    const ids = result.deals.map((d) => d._id);
    expect(ids).toContain(withProducts._id);
    expect(ids).not.toContain(withoutProducts._id);
  });

  it("tag filters to deals carrying that exact tag", () => {
    const tagged = createDealRecord({ name: "Tag filter test", companyId: companies[0]._id, tags: ["strategic"] }, "Tester");
    const untagged = createDealRecord({ name: "Tag filter test untagged", companyId: companies[0]._id }, "Tester");
    const result = queryDealsLocal(deals, { tag: "strategic", search: "Tag filter test", pageSize: 1000 });
    const ids = result.deals.map((d) => d._id);
    expect(ids).toContain(tagged._id);
    expect(ids).not.toContain(untagged._id);
  });

  it("search also matches by company and primary contact name, not just deal name/description", () => {
    const company = companies[0];
    const result = queryDealsLocal(deals, { search: company.name, pageSize: 1000 });
    expect(result.deals.some((d) => d.companyId === company._id)).toBe(true);
  });
});
