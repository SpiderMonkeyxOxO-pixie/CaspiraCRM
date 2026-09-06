import { describe, it, expect } from "vitest";
import { specificityRank, resolveApplicablePriceBook, computeEntryFinalPrice } from "./priceBookResolutionService.js";

describe("specificityRank", () => {
  it("ranks company-specific highest and standard lowest", () => {
    expect(specificityRank({ companyIds: ["c1"] })).toBe(6);
    expect(specificityRank({ contractTypes: ["MSA"] })).toBe(5);
    expect(specificityRank({ customerSegment: "Enterprise" })).toBe(4);
    expect(specificityRank({ market: "US" })).toBe(3);
    expect(specificityRank({ salesChannel: "Direct" })).toBe(2);
    expect(specificityRank({})).toBe(1);
  });
});

describe("resolveApplicablePriceBook", () => {
  it("picks the single most specific candidate", () => {
    const result = resolveApplicablePriceBook([{ id: "a", priority: 10 }, { id: "b", companyIds: ["c1"], priority: 10 }]);
    expect(result.priceBook.id).toBe("b");
  });

  it("breaks a specificity tie by priority", () => {
    const result = resolveApplicablePriceBook([{ id: "a", market: "US", priority: 10 }, { id: "b", market: "EU", priority: 20 }]);
    expect(result.priceBook.id).toBe("b");
  });

  it("reports an unresolved conflict when specificity AND priority both tie, rather than silently picking one", () => {
    const result = resolveApplicablePriceBook([{ id: "a", market: "US", priority: 10 }, { id: "b", market: "EU", priority: 10 }]);
    expect(result.conflict).toBe(true);
    expect(result.candidates).toHaveLength(2);
  });

  it("returns null when there are no candidates", () => {
    expect(resolveApplicablePriceBook([]).priceBook).toBeNull();
  });
});

describe("computeEntryFinalPrice", () => {
  const catalogItem = { standardPrice: 100, currency: "USD" };

  it("rejects a percentage adjustment in a different currency than the catalog item", () => {
    const result = computeEntryFinalPrice({ currency: "EUR", adjustmentType: "Percentage Decrease", adjustmentValue: 10 }, catalogItem);
    expect(result.error).toMatch(/requires the entry currency to match/);
  });

  it("allows a Fixed Price entry in a different currency (no conversion needed)", () => {
    const result = computeEntryFinalPrice({ currency: "EUR", adjustmentType: "Fixed Price", adjustmentValue: 85 }, catalogItem);
    expect(result.price.toNumber()).toBe(85);
  });

  it("applies a percentage decrease in the same currency", () => {
    const result = computeEntryFinalPrice({ currency: "USD", adjustmentType: "Percentage Decrease", adjustmentValue: 20 }, catalogItem);
    expect(result.price.toNumber()).toBe(80);
  });

  it("resolves a quantity tier by the requested quantity", () => {
    const entry = { currency: "USD", adjustmentType: "Quantity Tier", tiers: [{ minQty: 1, maxQty: 9, unitPrice: 100 }, { minQty: 10, maxQty: null, unitPrice: 80 }] };
    expect(computeEntryFinalPrice(entry, catalogItem, 15).price.toNumber()).toBe(80);
    expect(computeEntryFinalPrice(entry, catalogItem, 5).price.toNumber()).toBe(100);
  });
});
