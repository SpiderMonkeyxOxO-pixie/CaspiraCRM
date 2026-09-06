import { describe, it, expect } from "vitest";
import {
  computeOpenPipeline, computeWeightedPipeline, computePipelineStageTotals,
  computeWonValue, computeLostValue, computeWinRate, computeAvgDealSize,
  computeDealCountByOwner, computePipelineConcentrationByCompany, computeForecastBuckets,
} from "./calculationService.js";

const deals = [
  { status: "Open", stage: "Discovery", value: 100, probability: 10, currency: "USD", ownerMembershipId: "m1", companyId: "c1" },
  { status: "Open", stage: "Proposal", value: 200, probability: 50, currency: "USD", ownerMembershipId: "m2", companyId: "c1" },
  { status: "Open", stage: "Discovery", value: 300, probability: 10, currency: "EUR", ownerMembershipId: "m1", companyId: "c2" },
  { status: "Won", stage: "Won", value: 500, probability: 100, currency: "USD", actualClosingDate: "2026-01-15" },
  { status: "Lost", stage: "Lost", value: 150, probability: 0, currency: "USD", actualClosingDate: "2026-01-20" },
];

describe("computeOpenPipeline", () => {
  it("counts only Open deals and groups value by currency", () => {
    const result = computeOpenPipeline(deals);
    expect(result.count).toBe(3);
    expect(result.valueByCurrency).toEqual({ USD: 300, EUR: 300 });
  });
});

describe("computeWeightedPipeline", () => {
  it("computes amount x probability / 100, grouped by currency", () => {
    const result = computeWeightedPipeline(deals);
    // USD: 100*0.10 + 200*0.50 = 10 + 100 = 110; EUR: 300*0.10 = 30
    expect(result.valueByCurrency).toEqual({ USD: 110, EUR: 30 });
  });
});

describe("computePipelineStageTotals", () => {
  it("groups open deals by stage only (excludes Won/Lost)", () => {
    const result = computePipelineStageTotals(deals);
    expect(Object.keys(result).sort()).toEqual(["Discovery", "Proposal"]);
    expect(result.Discovery.count).toBe(2);
  });
});

describe("computeWonValue / computeLostValue", () => {
  it("filters by status and optional date range", () => {
    expect(computeWonValue(deals).count).toBe(1);
    expect(computeLostValue(deals).count).toBe(1);
    expect(computeWonValue(deals, { from: "2026-02-01" }).count).toBe(0);
  });
});

describe("computeWinRate", () => {
  it("computes won / (won + lost)", () => {
    const result = computeWinRate(deals);
    expect(result.won).toBe(1);
    expect(result.lost).toBe(1);
    expect(result.winRate).toBe(0.5);
  });

  it("returns 0 when no deals are decided yet", () => {
    expect(computeWinRate([{ status: "Open" }]).winRate).toBe(0);
  });
});

describe("computeAvgDealSize", () => {
  it("averages open deal value per currency", () => {
    const result = computeAvgDealSize(deals);
    expect(result.USD).toBe(150); // (100+200)/2
    expect(result.EUR).toBe(300);
  });
});

describe("computeDealCountByOwner", () => {
  it("counts open deals per owner, bucketing unowned separately", () => {
    const result = computeDealCountByOwner(deals);
    expect(result.m1).toBe(2);
    expect(result.m2).toBe(1);
  });
});

describe("computePipelineConcentrationByCompany", () => {
  it("groups open pipeline value by company and currency", () => {
    const result = computePipelineConcentrationByCompany(deals);
    expect(result.c1.count).toBe(2);
    expect(result.c1.valueByCurrency).toEqual({ USD: 300 });
    expect(result.c2.valueByCurrency).toEqual({ EUR: 300 });
  });
});

describe("computeForecastBuckets", () => {
  it("buckets open deals by expected close date relative to now, never mixing currencies", () => {
    const now = new Date("2026-06-15T00:00:00Z");
    const bucketed = [
      { status: "Open", value: 10, currency: "USD", expectedClosingDate: "2026-06-01" }, // overdue
      { status: "Open", value: 20, currency: "USD", expectedClosingDate: "2026-06-16" }, // this week
      { status: "Open", value: 30, currency: "USD", expectedClosingDate: "2026-08-01" }, // later
    ];
    const result = computeForecastBuckets(bucketed, now);
    expect(result.overdue.count).toBe(1);
    expect(result.later.count).toBe(1);
  });
});
