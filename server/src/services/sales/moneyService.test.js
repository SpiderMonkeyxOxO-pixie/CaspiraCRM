import { describe, it, expect } from "vitest";
import { computeLineTotals, computeDocumentTotals, sumByCurrency, currencyMapToApi, round } from "./moneyService.js";

describe("computeLineTotals", () => {
  it("computes quantity x price -> discount -> subtotal -> tax -> total in order", () => {
    const result = computeLineTotals({ quantity: 3, unitPrice: 100, discountType: "Percentage", discountValue: 10, taxCategory: "Standard" });
    expect(result.lineSubtotal.toNumber()).toBe(270); // 300 - 10%
    expect(result.taxAmount.toNumber()).toBe(21.6); // 270 * 8%
    expect(result.lineTotal.toNumber()).toBe(291.6);
  });

  it("never produces a negative subtotal from a Fixed Amount discount larger than the gross", () => {
    const result = computeLineTotals({ quantity: 1, unitPrice: 50, discountType: "Fixed Amount", discountValue: 500, taxCategory: "Exempt" });
    expect(result.lineSubtotal.toNumber()).toBe(0);
  });

  it("rejects a negative quantity", () => {
    expect(() => computeLineTotals({ quantity: -1, unitPrice: 10, taxCategory: "Standard" })).toThrow(/negative/);
  });

  it("rejects a negative unit price", () => {
    expect(() => computeLineTotals({ quantity: 1, unitPrice: -10, taxCategory: "Standard" })).toThrow(/negative/);
  });

  it("rejects a percentage discount above 100", () => {
    expect(() => computeLineTotals({ quantity: 1, unitPrice: 10, discountType: "Percentage", discountValue: 150, taxCategory: "Standard" })).toThrow(/between 0 and 100/);
  });

  it("uses no discount when discountValue is absent", () => {
    const result = computeLineTotals({ quantity: 2, unitPrice: 25, taxCategory: "Zero-Rated" });
    expect(result.lineSubtotal.toNumber()).toBe(50);
    expect(result.taxAmount.toNumber()).toBe(0);
  });
});

describe("computeDocumentTotals", () => {
  it("sums lines and applies an optional document-level discount to the grand total only", () => {
    const lines = [
      computeLineTotals({ quantity: 1, unitPrice: 100, taxCategory: "Standard" }),
      computeLineTotals({ quantity: 2, unitPrice: 50, taxCategory: "Standard" }),
    ];
    const totals = computeDocumentTotals(lines, { documentDiscountType: "Fixed Amount", documentDiscountValue: 20 });
    expect(totals.subtotal.toNumber()).toBe(200);
    expect(totals.taxTotal.toNumber()).toBe(16);
    expect(totals.grandTotal.toNumber()).toBe(196); // (200+16) - 20
  });
});

describe("sumByCurrency / currencyMapToApi", () => {
  it("never combines totals across currencies", () => {
    const map = sumByCurrency([
      { currency: "USD", amount: 100 },
      { currency: "EUR", amount: 50 },
      { currency: "USD", amount: 25 },
    ]);
    const out = currencyMapToApi(map);
    expect(out).toEqual({ USD: 125, EUR: 50 });
  });
});

describe("round", () => {
  it("rounds half up to 2 decimal places", () => {
    expect(round(10.005).toNumber()).toBe(10.01);
    expect(round(10.004).toNumber()).toBe(10);
  });
});
