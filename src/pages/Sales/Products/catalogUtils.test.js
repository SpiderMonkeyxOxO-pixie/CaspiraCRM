import { describe, it, expect } from "vitest";
import { formatMoney, formatPricingLabel } from "./catalogUtils";

describe("catalogUtils — formatMoney", () => {
  it("formats a whole-number amount with no decimals", () => {
    expect(formatMoney(10000, "USD")).toBe("$10,000");
  });
  it("formats a fractional amount (e.g. usage pricing) with decimals", () => {
    expect(formatMoney(0.1, "EUR")).toBe("€0.10");
  });
  it("returns null for a missing amount rather than a misleading $0", () => {
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
  });
});

describe("catalogUtils — formatPricingLabel — pricing is never a plain number", () => {
  it("shows a one-time price with its context", () => {
    expect(formatPricingLabel({ billingModel: "One Time", standardPrice: 10000, currency: "USD" })).toBe("$10,000 one time");
  });
  it("shows a recurring price with its billing interval", () => {
    expect(formatPricingLabel({ billingModel: "Recurring", billingInterval: "Monthly", standardPrice: 250, currency: "USD" })).toBe("$250 per month");
  });
  it("shows a usage-based price with its billing unit", () => {
    expect(formatPricingLabel({ billingModel: "Usage Based", currency: "EUR", usageConfig: { unitPrice: 0.1, billingUnit: "Request" } })).toBe("€0.10 per request");
  });
  it("shows Custom Quote instead of any number", () => {
    expect(formatPricingLabel({ billingModel: "Custom Quote", standardPrice: null })).toBe("Custom Quote");
  });
  it("is honest about missing pricing rather than showing a fabricated number", () => {
    expect(formatPricingLabel({ billingModel: "One Time", standardPrice: null })).toBe("Pricing not set");
  });
  it("handles a null/undefined item without throwing", () => {
    expect(formatPricingLabel(null)).toBe("—");
  });
});
