import { describe, it, expect } from "vitest";
import { formatMoney, formatByCurrency, isStaleDeal, computeDealRiskReasons, STALE_THRESHOLD_MS } from "./dealUtils";

function baseDeal(overrides = {}) {
  return {
    status: "Open", updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    nextAction: "Follow up", expectedClosingDate: null, primaryContactId: "c1", quotes: [], stageHistory: [], stage: "Proposal",
    ...overrides,
  };
}

describe("dealUtils", () => {
  it("formatMoney formats a currency amount and falls back gracefully on a bad currency code", () => {
    expect(formatMoney(1000, "USD")).toContain("1,000");
    expect(formatMoney(500, "NOTREAL")).toContain("500");
  });

  it("formatByCurrency shows a single formatted amount for one currency and joins multiple currencies", () => {
    expect(formatByCurrency({ USD: 1000 })).toContain("1,000");
    const combined = formatByCurrency({ USD: 1000, EUR: 500 });
    expect(combined).toContain("+");
  });

  it("isStaleDeal is false for non-open deals regardless of last activity", () => {
    expect(isStaleDeal(baseDeal({ status: "Won", updatedAt: new Date(Date.now() - 100 * 86400000).toISOString() }))).toBe(false);
  });

  it("isStaleDeal is true only once the reference date exceeds the stale threshold", () => {
    const justUnderThreshold = new Date(Date.now() - (STALE_THRESHOLD_MS - 86400000)).toISOString();
    const overThreshold = new Date(Date.now() - (STALE_THRESHOLD_MS + 86400000)).toISOString();
    expect(isStaleDeal(baseDeal({ updatedAt: justUnderThreshold }))).toBe(false);
    expect(isStaleDeal(baseDeal({ updatedAt: overThreshold }))).toBe(true);
  });

  it("computeDealRiskReasons returns nothing for a healthy, non-open, or fully-populated deal", () => {
    expect(computeDealRiskReasons(baseDeal({ status: "Lost" }))).toEqual([]);
    expect(computeDealRiskReasons(baseDeal())).toEqual([]);
  });

  it("computeDealRiskReasons flags a missing next action", () => {
    expect(computeDealRiskReasons(baseDeal({ nextAction: null }))).toContain("No next action set");
  });

  it("computeDealRiskReasons flags an overdue expected closing date", () => {
    const reasons = computeDealRiskReasons(baseDeal({ expectedClosingDate: new Date(Date.now() - 86400000).toISOString() }));
    expect(reasons).toContain("Expected close date has passed");
  });

  it("computeDealRiskReasons flags a missing primary contact", () => {
    expect(computeDealRiskReasons(baseDeal({ primaryContactId: null }))).toContain("Missing a primary contact");
  });

  it("computeDealRiskReasons flags an expired, non-accepted quote", () => {
    const reasons = computeDealRiskReasons(baseDeal({ quotes: [{ status: "Draft", expirationDate: new Date(Date.now() - 86400000).toISOString() }] }));
    expect(reasons).toContain("A proposal/quote has expired");
  });

  it("computeDealRiskReasons does not flag an accepted quote even if its expiration date has passed", () => {
    const reasons = computeDealRiskReasons(baseDeal({ quotes: [{ status: "Accepted", expirationDate: new Date(Date.now() - 86400000).toISOString() }] }));
    expect(reasons).not.toContain("A proposal/quote has expired");
  });

  it("computeDealRiskReasons flags a deal that re-entered the same stage more than once", () => {
    const reasons = computeDealRiskReasons(baseDeal({ stageHistory: [{ to: "Proposal" }, { to: "Negotiation" }, { to: "Proposal" }] }));
    expect(reasons.some((r) => r.includes("Re-entered"))).toBe(true);
  });

  it("computeDealRiskReasons flags staleness using the provided lastActivityAt", () => {
    const stale = new Date(Date.now() - (STALE_THRESHOLD_MS + 86400000)).toISOString();
    const reasons = computeDealRiskReasons(baseDeal(), { lastActivityAt: stale });
    expect(reasons).toContain("No activity for over 3 weeks");
  });
});
