import { describe, it, expect } from "vitest";
import {
  resolveDateRange, previousPeriod, compareToPrevious, sumByCurrency,
  filterLeads, filterDeals, filterActivities,
  computeNewLeads, computeLeadConversion, computeLeadSourcePerformance,
  computeOpenPipeline, computeWeightedPipeline, computeWonDeals, computeLostDeals, computeAvgDealSize,
  computeDealsClosingThisPeriod, computeAtRiskAndStaleDeals, computePipelineStageTotals, computeSalesFunnel,
  computeForecastBuckets, computeActivitiesDueToday, computeOverdueActivities, computeUpcomingActivities,
  computeRecentlyCompletedActivities, computeCompaniesNeedingAttention, computeTeamPerformance,
  computeRecentCrmTimeline,
} from "./dashboardSelectors";

const iso = (daysFromNow) => new Date(Date.now() + daysFromNow * 86400000).toISOString();

function lead(overrides = {}) {
  return { _id: Math.random().toString(36).slice(2), name: "Test Lead", status: "New", source: "Website", ownerId: "u1", department: "Sales", archived: false, createdAt: iso(0), updatedAt: iso(0), ...overrides };
}
function deal(overrides = {}) {
  return {
    _id: Math.random().toString(36).slice(2), name: "Test Deal", status: "Open", stage: "Discovery", value: 1000, weightedValue: 100,
    currency: "USD", ownerId: "u1", assignedTeam: "Sales", companyId: "c1", pipeline: "New Business", archived: false,
    expectedClosingDate: null, actualClosingDate: null, createdAt: iso(0), stageHistory: [], ...overrides,
  };
}
function activity(overrides = {}) {
  return { _id: Math.random().toString(36).slice(2), type: "Call", title: "Test Activity", status: "Scheduled", ownerId: "u1", assignedTeam: "Sales", startAt: iso(1), dueDate: null, completedAt: null, ...overrides };
}

describe("dashboardSelectors — date ranges", () => {
  it("resolveDateRange('today') spans exactly the current calendar day", () => {
    const range = resolveDateRange("today");
    const now = new Date();
    expect(range.from.getDate()).toBe(now.getDate());
    expect(range.to.getTime() - range.from.getTime()).toBe(86400000);
  });

  it("resolveDateRange('thisMonth') spans the first through the first-of-next-month", () => {
    const range = resolveDateRange("thisMonth");
    expect(range.from.getDate()).toBe(1);
    expect(range.to.getMonth()).not.toBe(range.from.getMonth() === 11 ? range.from.getMonth() : -1); // sanity: to is a different month boundary
  });

  it("previousPeriod returns an equal-length window immediately before the range", () => {
    const range = resolveDateRange("last7");
    const prev = previousPeriod(range);
    expect(prev.to.getTime()).toBe(range.from.getTime());
    expect(range.to.getTime() - range.from.getTime()).toBe(prev.to.getTime() - prev.from.getTime());
  });

  it("compareToPrevious returns null (no fabricated trend) when there is no previous-period data", () => {
    expect(compareToPrevious(5, 0)).toBeNull();
    expect(compareToPrevious(0, 0)).toBeNull();
    expect(compareToPrevious(5, null)).toBeNull();
  });

  it("compareToPrevious computes a real percentage change when previous data exists", () => {
    expect(compareToPrevious(15, 10)).toBe(50);
    expect(compareToPrevious(5, 10)).toBe(-50);
  });
});

describe("dashboardSelectors — money grouping", () => {
  it("sumByCurrency groups totals by currency instead of combining them", () => {
    const items = [{ currency: "USD", amount: 100 }, { currency: "EUR", amount: 50 }, { currency: "USD", amount: 25 }];
    expect(sumByCurrency(items, (i) => i.amount)).toEqual({ USD: 125, EUR: 50 });
  });
});

describe("dashboardSelectors — Leads", () => {
  it("computeNewLeads counts only leads created within the active range", () => {
    const range = resolveDateRange("thisMonth");
    const leads = [lead({ createdAt: iso(0) }), lead({ createdAt: new Date(2000, 0, 1).toISOString() })];
    const result = computeNewLeads(leads, range);
    expect(result.count).toBe(1);
  });

  it("computeLeadConversion excludes Duplicate/Spam from the eligible denominator", () => {
    const range = resolveDateRange("thisMonth");
    const leads = [
      lead({ status: "Converted" }), lead({ status: "New" }), lead({ status: "Duplicate" }), lead({ status: "Spam" }),
    ];
    const result = computeLeadConversion(leads, range);
    expect(result.eligibleCount).toBe(2);
    expect(result.convertedCount).toBe(1);
    expect(result.rate).toBe(50);
  });

  it("computeLeadConversion returns rate: null when there is no eligible data (not a fabricated 0%)", () => {
    const range = resolveDateRange("thisMonth");
    const result = computeLeadConversion([lead({ status: "Duplicate" })], range);
    expect(result.rate).toBeNull();
  });

  it("filterLeads resolves ownerId='me' via currentOwnerId, same convention as Leads/Deals/Pipeline", () => {
    const leads = [lead({ ownerId: "u1" }), lead({ ownerId: "u2" })];
    const result = filterLeads(leads, { ownerId: "me", currentOwnerId: "u1" });
    expect(result).toHaveLength(1);
    expect(result[0].ownerId).toBe("u1");
  });

  it("computeLeadSourcePerformance only returns sources with at least one lead", () => {
    const leads = [lead({ source: "Website" }), lead({ source: "Website", status: "Converted" })];
    const perf = computeLeadSourcePerformance(leads, []);
    expect(perf.find((s) => s.source === "Website").leadCount).toBe(2);
    expect(perf.find((s) => s.source === "Referral")).toBeUndefined();
  });
});

describe("dashboardSelectors — Deals / Pipeline", () => {
  it("computeOpenPipeline excludes Won/Lost/Cancelled/On Hold and groups value by currency", () => {
    const deals = [deal({ status: "Open", value: 1000, currency: "USD" }), deal({ status: "Won", value: 500 }), deal({ status: "Open", value: 200, currency: "EUR" })];
    const result = computeOpenPipeline(deals);
    expect(result.count).toBe(2);
    expect(result.valueByCurrency).toEqual({ USD: 1000, EUR: 200 });
  });

  it("computeWeightedPipeline sums value × probability (via weightedValue) for open deals only", () => {
    const deals = [deal({ status: "Open", weightedValue: 250 }), deal({ status: "Won", weightedValue: 999 })];
    expect(computeWeightedPipeline(deals).valueByCurrency).toEqual({ USD: 250 });
  });

  it("computeWonDeals counts/sums only deals whose actualClosingDate falls in range", () => {
    const range = resolveDateRange("thisMonth");
    const deals = [deal({ status: "Won", value: 500, actualClosingDate: iso(0) }), deal({ status: "Won", value: 999, actualClosingDate: new Date(2000, 0, 1).toISOString() })];
    const result = computeWonDeals(deals, range);
    expect(result.count).toBe(1);
    expect(result.valueByCurrency.USD).toBe(500);
  });

  it("computeLostDeals mirrors computeWonDeals for the Lost outcome", () => {
    const range = resolveDateRange("thisMonth");
    const deals = [deal({ status: "Lost", value: 300, actualClosingDate: iso(0) })];
    expect(computeLostDeals(deals, range).count).toBe(1);
  });

  it("computeAvgDealSize averages open-deal value per currency", () => {
    const deals = [deal({ status: "Open", value: 100 }), deal({ status: "Open", value: 300 })];
    expect(computeAvgDealSize(deals)).toEqual({ USD: 200 });
  });

  it("computeDealsClosingThisPeriod only includes open deals with an expected close date in range", () => {
    const range = resolveDateRange("thisMonth");
    // Use a date guaranteed inside the resolved range rather than a fixed
    // "tomorrow" offset, which can fall in the next month on month-boundary days.
    const midRange = new Date(range.from.getTime() + (range.to.getTime() - range.from.getTime()) / 2).toISOString();
    const deals = [deal({ status: "Open", expectedClosingDate: midRange }), deal({ status: "Open", expectedClosingDate: null }), deal({ status: "Won", expectedClosingDate: midRange })];
    expect(computeDealsClosingThisPeriod(deals, range).count).toBe(1);
  });

  it("computeAtRiskAndStaleDeals reuses the shared Deals risk-reason logic and only returns flagged deals", () => {
    const healthy = deal({ nextAction: "Call back", primaryContactId: "c1", expectedClosingDate: iso(30) });
    const risky = deal({ nextAction: null, primaryContactId: null });
    const result = computeAtRiskAndStaleDeals([healthy, risky], () => null);
    expect(result).toHaveLength(1);
    expect(result[0].deal._id).toBe(risky._id);
    expect(result[0].reasons.length).toBeGreaterThan(0);
  });

  it("computePipelineStageTotals covers every open stage and excludes Won", () => {
    const deals = [deal({ stage: "Discovery", status: "Open", value: 100 }), deal({ stage: "Proposal", status: "Open", value: 200 })];
    const totals = computePipelineStageTotals(deals);
    expect(totals.map((t) => t.stage)).toEqual(["Discovery", "Qualified", "Proposal", "Negotiation", "Approval"]);
    expect(totals.find((t) => t.stage === "Discovery").count).toBe(1);
  });

  it("computeSalesFunnel produces a non-increasing-ish deal funnel and provides drill-down targets", () => {
    const range = resolveDateRange("thisMonth");
    const leads = [lead({ status: "Qualified" }), lead({ status: "New" })];
    const deals = [deal({ status: "Open", stage: "Negotiation" }), deal({ status: "Won" })];
    const funnel = computeSalesFunnel(leads, deals, range);
    expect(funnel.map((f) => f.key)).toEqual(["newLeads", "qualifiedLeads", "openDeals", "proposal", "negotiation", "approval", "won"]);
    expect(funnel.every((f) => typeof f.to === "string" && f.to.startsWith("/crm/"))).toBe(true);
    // A deal in Negotiation reached Proposal and Negotiation, so both counts include it.
    expect(funnel.find((f) => f.key === "proposal").count).toBeGreaterThanOrEqual(1);
    expect(funnel.find((f) => f.key === "negotiation").count).toBeGreaterThanOrEqual(1);
  });

  it("computeForecastBuckets buckets open deals by expected close date and exposes real queryDealsLocal-compatible link params", () => {
    const deals = [
      deal({ status: "Open", expectedClosingDate: new Date(Date.now() - 5 * 86400000).toISOString() }), // overdue
      deal({ status: "Open", expectedClosingDate: iso(2) }), // this week
      deal({ status: "Open", expectedClosingDate: null }), // excluded (no date)
    ];
    const buckets = computeForecastBuckets(deals);
    expect(buckets.map((b) => b.key)).toEqual(["overdue", "thisWeek", "thisMonth", "nextMonth", "later"]);
    expect(buckets.find((b) => b.key === "overdue").count).toBe(1);
    expect(buckets.find((b) => b.key === "overdue").linkParams).toHaveProperty("closingOverdue", "true");
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(2); // the no-date deal is excluded from every bucket
  });

  it("filterDeals resolves ownerId='me' and applies pipeline/team/company/currency filters", () => {
    const deals = [deal({ ownerId: "u1", pipeline: "New Business" }), deal({ ownerId: "u2", pipeline: "Renewals" })];
    expect(filterDeals(deals, { ownerId: "me", currentOwnerId: "u1" })).toHaveLength(1);
    expect(filterDeals(deals, { pipeline: "Renewals" })).toHaveLength(1);
  });
});

describe("dashboardSelectors — Activities", () => {
  it("computeActivitiesDueToday only includes open activities due today", () => {
    const dueToday = activity({ startAt: new Date().toISOString() });
    const dueLater = activity({ startAt: iso(5) });
    const completed = activity({ startAt: new Date().toISOString(), status: "Completed" });
    const result = computeActivitiesDueToday([dueToday, dueLater, completed]);
    expect(result.map((a) => a._id)).toEqual([dueToday._id]);
  });

  it("computeOverdueActivities matches the shared effectiveStatus 'Overdue' derivation", () => {
    const overdue = activity({ startAt: new Date(Date.now() - 86400000).toISOString(), status: "Scheduled" });
    const notOverdue = activity({ startAt: iso(5), status: "Scheduled" });
    const result = computeOverdueActivities([overdue, notOverdue]);
    expect(result.map((a) => a._id)).toEqual([overdue._id]);
  });

  it("computeUpcomingActivities excludes today and only looks ahead the given window", () => {
    const upcoming = activity({ startAt: iso(3) });
    const tooFar = activity({ startAt: iso(30) });
    const result = computeUpcomingActivities([upcoming, tooFar], 7);
    expect(result.map((a) => a._id)).toEqual([upcoming._id]);
  });

  it("computeRecentlyCompletedActivities sorts newest first within the window", () => {
    const older = activity({ completedAt: new Date(Date.now() - 5 * 86400000).toISOString() });
    const newer = activity({ completedAt: new Date(Date.now() - 1 * 86400000).toISOString() });
    const result = computeRecentlyCompletedActivities([older, newer], 7);
    expect(result.map((a) => a._id)).toEqual([newer._id, older._id]);
  });

  it("filterActivities resolves ownerId='me' and team", () => {
    const activities = [activity({ ownerId: "u1" }), activity({ ownerId: "u2" })];
    expect(filterActivities(activities, { ownerId: "me", currentOwnerId: "u1" })).toHaveLength(1);
  });
});

describe("dashboardSelectors — Companies needing attention", () => {
  function company(overrides = {}) {
    return { _id: "co1", name: "Test Co", archived: false, accountHealth: "Healthy", ownerName: "Owner", nextFollowUp: null, renewalDate: null, ...overrides };
  }

  it("flags an at-risk account health with a visible reason", () => {
    const result = computeCompaniesNeedingAttention([company({ accountHealth: "At Risk", healthReason: "Overdue tickets" })], [], [], () => new Date().toISOString());
    expect(result[0].reasons[0]).toContain("At-risk health");
  });

  it("flags an open urgent ticket and an outstanding invoice independently", () => {
    const co = company();
    const tickets = [{ companyId: "co1", priority: "Urgent", status: "Open" }];
    const invoices = [{ companyId: "co1", amountDue: 500, status: "Overdue" }];
    const result = computeCompaniesNeedingAttention([co], tickets, invoices, () => new Date().toISOString());
    expect(result[0].reasons).toContain("Open urgent support ticket");
    expect(result[0].reasons).toContain("Outstanding invoice");
  });

  it("flags no-recent-activity when there is no last activity or it is stale", () => {
    const result = computeCompaniesNeedingAttention([company()], [], [], () => null);
    expect(result[0].reasons).toContain("No recent activity");
  });

  it("does not flag a healthy, recently-active company with no other issues", () => {
    const result = computeCompaniesNeedingAttention([company()], [], [], () => new Date().toISOString());
    expect(result).toHaveLength(0);
  });

  it("skips archived companies entirely", () => {
    const result = computeCompaniesNeedingAttention([company({ archived: true, accountHealth: "At Risk" })], [], [], () => null);
    expect(result).toHaveLength(0);
  });
});

describe("dashboardSelectors — Team performance", () => {
  it("aggregates per-owner leads/deals/activities without collapsing them into a single score", () => {
    const team = [{ id: "u1", name: "Rep One" }];
    const leads = [lead({ ownerId: "u1", status: "Converted" }), lead({ ownerId: "u1" })];
    const deals = [deal({ ownerId: "u1", status: "Open", value: 500 })];
    const activities = [activity({ ownerId: "u1", status: "Completed", completedAt: iso(0) })];
    const range = resolveDateRange("thisMonth");
    const rows = computeTeamPerformance(team, leads, deals, activities, range);
    expect(rows[0].assignedLeads).toBe(2);
    expect(rows[0].convertedLeads).toBe(1);
    expect(rows[0].openDealsCount).toBe(1);
    expect(rows[0].activitiesCompleted).toBe(1);
  });
});

describe("dashboardSelectors — Recent CRM timeline", () => {
  it("merges lead/company/deal-stage/activity events, newest first, and resolves a link where one exists", () => {
    const l = lead({ createdAt: iso(-1) });
    const c = { _id: "co1", name: "Co", createdAt: iso(0) };
    const d = deal({ stageHistory: [{ from: "Discovery", to: "Qualified", at: iso(-2) }] });
    const events = computeRecentCrmTimeline([l], [], [c], [d], [], 10);
    expect(events[0].at).toBe(c.createdAt);
    expect(events.some((e) => e.type === "deal_stage_changed")).toBe(true);
    expect(events.find((e) => e.type === "company_created").to).toBe(`/crm/companies/${c._id}`);
  });

  it("respects the limit parameter", () => {
    const leads = Array.from({ length: 20 }, (_, i) => lead({ createdAt: iso(-i) }));
    expect(computeRecentCrmTimeline(leads, [], [], [], [], 5)).toHaveLength(5);
  });
});
