import { describe, it, expect } from "vitest";
import { sortDeals, groupDeals, formatAgo, expectedCloseMonthLabel, DEFAULT_BOARD_SETTINGS, SORT_OPTIONS, GROUP_OPTIONS } from "./pipelineUtils";

const deal = (overrides) => ({
  _id: overrides.id, value: 1000, weightedValue: 500, priority: "Medium", createdAt: "2026-01-01T00:00:00.000Z",
  expectedClosingDate: null, companyId: null, ...overrides,
});

describe("pipelineUtils", () => {
  it("sortDeals by value sorts descending", () => {
    const deals = [deal({ id: "a", value: 100 }), deal({ id: "b", value: 500 }), deal({ id: "c", value: 300 })];
    const sorted = sortDeals(deals, "value");
    expect(sorted.map((d) => d._id)).toEqual(["b", "c", "a"]);
  });

  it("sortDeals by weightedValue sorts descending", () => {
    const deals = [deal({ id: "a", weightedValue: 10 }), deal({ id: "b", weightedValue: 90 })];
    expect(sortDeals(deals, "weightedValue").map((d) => d._id)).toEqual(["b", "a"]);
  });

  it("sortDeals by expectedClosingDate sorts ascending and pushes missing dates last", () => {
    const deals = [
      deal({ id: "a", expectedClosingDate: "2026-06-01" }),
      deal({ id: "b", expectedClosingDate: null }),
      deal({ id: "c", expectedClosingDate: "2026-01-01" }),
    ];
    expect(sortDeals(deals, "expectedClosingDate").map((d) => d._id)).toEqual(["c", "a", "b"]);
  });

  it("sortDeals by priority ranks Urgent > High > Medium > Low", () => {
    const deals = [deal({ id: "a", priority: "Low" }), deal({ id: "b", priority: "Urgent" }), deal({ id: "c", priority: "Medium" })];
    expect(sortDeals(deals, "priority").map((d) => d._id)).toEqual(["b", "c", "a"]);
  });

  it("sortDeals by manual order uses the provided Map and pushes unlisted deals last", () => {
    const deals = [deal({ id: "a" }), deal({ id: "b" }), deal({ id: "c" })];
    const manualOrder = new Map([["b", 0], ["a", 1]]);
    expect(sortDeals(deals, "manual", { manualOrder }).map((d) => d._id)).toEqual(["b", "a", "c"]);
  });

  it("sortDeals by company uses the companyById resolver", () => {
    const deals = [deal({ id: "a", companyId: "co-z" }), deal({ id: "b", companyId: "co-a" })];
    const companyById = (id) => ({ name: id === "co-z" ? "Zeta" : "Alpha" });
    expect(sortDeals(deals, "company", { companyById }).map((d) => d._id)).toEqual(["b", "a"]);
  });

  it("groupDeals with no groupKey returns a single ungrouped bucket", () => {
    const deals = [deal({ id: "a" }), deal({ id: "b" })];
    const groups = groupDeals(deals, "");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
    expect(groups[0].deals).toHaveLength(2);
  });

  it("groupDeals buckets by an arbitrary field, defaulting missing values to Unassigned", () => {
    const deals = [deal({ id: "a", ownerName: "Priya Nair" }), deal({ id: "b", ownerName: null }), deal({ id: "c", ownerName: "Priya Nair" })];
    const groups = groupDeals(deals, "ownerName");
    const priya = groups.find((g) => g.key === "Priya Nair");
    const unassigned = groups.find((g) => g.key === "Unassigned");
    expect(priya.deals).toHaveLength(2);
    expect(unassigned.deals).toHaveLength(1);
  });

  it("groupDeals by expectedCloseMonth uses a human-readable month label", () => {
    const deals = [deal({ id: "a", expectedClosingDate: "2026-03-15T00:00:00.000Z" })];
    const groups = groupDeals(deals, "expectedCloseMonth");
    expect(groups[0].label).toBe(expectedCloseMonthLabel("2026-03-15T00:00:00.000Z"));
  });

  it("formatAgo describes recency in human terms", () => {
    expect(formatAgo(null)).toBe("No activity yet");
    expect(formatAgo(new Date().toISOString())).toBe("today");
    expect(formatAgo(new Date(Date.now() - 2 * 86400000).toISOString())).toBe("2 days ago");
  });

  it("DEFAULT_BOARD_SETTINGS ships with a sane, complete shape", () => {
    expect(DEFAULT_BOARD_SETTINGS.density).toBe("comfortable");
    expect(DEFAULT_BOARD_SETTINGS.visibleFields).toHaveProperty("primaryContact");
    expect(typeof DEFAULT_BOARD_SETTINGS.showWeighted).toBe("boolean");
  });

  it("SORT_OPTIONS and GROUP_OPTIONS cover the documented choices", () => {
    expect(SORT_OPTIONS.map((o) => o.value)).toEqual(
      expect.arrayContaining(["expectedClosingDate", "value", "weightedValue", "lastActivity", "createdAt", "priority", "company", "manual"])
    );
    expect(GROUP_OPTIONS.map((o) => o.value)).toEqual(expect.arrayContaining(["", "ownerName", "assignedTeam", "dealHealth", "expectedCloseMonth"]));
  });
});
