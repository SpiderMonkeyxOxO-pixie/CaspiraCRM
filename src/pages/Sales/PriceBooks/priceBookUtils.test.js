import { describe, it, expect } from "vitest";
import { formatMoney, formatPercent, PB_STATUS_COLORS, scopeSummary } from "./priceBookUtils";

describe("formatMoney (re-exported from catalogUtils)", () => {
  it("formats whole numbers without decimals", () => {
    expect(formatMoney(100, "USD")).toBe("$100");
  });
  it("returns null for a missing amount", () => {
    expect(formatMoney(null, "USD")).toBeNull();
  });
});

describe("formatPercent", () => {
  it("adds a + sign for positive values", () => {
    expect(formatPercent(12.34)).toBe("+12.3%");
  });
  it("does not add a sign for negative values", () => {
    expect(formatPercent(-12.34)).toBe("-12.3%");
  });
  it("returns an em dash for null/undefined/NaN", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPercent(NaN)).toBe("—");
  });
});

describe("PB_STATUS_COLORS", () => {
  it("has an entry for every derived status", () => {
    for (const s of ["Draft", "Scheduled", "Active", "Expired", "Inactive", "Archived"]) {
      expect(PB_STATUS_COLORS[s]).toBeTruthy();
    }
  });
});

describe("scopeSummary", () => {
  it("summarizes a broad Price Book as Global", () => {
    expect(scopeSummary({ market: "Global", customerSegment: null, salesChannel: null, companyIds: [] })).toBe("Global");
  });
  it("summarizes a narrow Price Book with its restrictions", () => {
    expect(scopeSummary({ market: "India", customerSegment: "Enterprise", salesChannel: "Partner", companyIds: ["a", "b"] })).toBe("India · Enterprise · Partner · 2 companies");
  });
  it("uses singular 'company' for exactly one specific company", () => {
    expect(scopeSummary({ market: "Global", customerSegment: null, salesChannel: null, companyIds: ["a"] })).toBe("Global · 1 company");
  });
});
