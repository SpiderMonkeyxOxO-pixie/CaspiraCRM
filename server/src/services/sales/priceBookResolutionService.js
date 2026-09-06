// Ports the frontend's Price Book resolution rules (mockPriceBookData.js's
// specificityRank()/findConflicts()/computeEntryFinalPrice()) server-side,
// verbatim in spirit: same precedence order, same "never silently resolve
// a tie" behavior, same "never convert currency" rule.
import { toMoney, round } from "./moneyService.js";

// Higher number = more specific = wins when multiple Price Books could
// apply to the same context. Matches the frontend's exact ranking.
export function specificityRank(priceBook) {
  if (priceBook.companyIds?.length) return 6;
  if (priceBook.contractTypes?.length) return 5;
  if (priceBook.customerSegment) return 4;
  if (priceBook.market) return 3;
  if (priceBook.salesChannel) return 2;
  return 1;
}

// Returns the single applicable Price Book among candidates already
// filtered to match the request context (same org, active, effective-dated,
// currency), or { conflict: true, candidates } if two or more tie on both
// specificity AND priority — the frontend's own rule is that this must
// never be silently resolved, so callers must surface the conflict rather
// than guess.
export function resolveApplicablePriceBook(candidates) {
  if (candidates.length === 0) return { priceBook: null };
  const ranked = candidates
    .map((pb) => ({ pb, specificity: specificityRank(pb) }))
    .sort((a, b) => b.specificity - a.specificity || b.pb.priority - a.pb.priority);

  const top = ranked[0];
  const tied = ranked.filter((r) => r.specificity === top.specificity && r.pb.priority === top.pb.priority);
  if (tied.length > 1) return { conflict: true, candidates: tied.map((t) => t.pb) };
  return { priceBook: top.pb };
}

// Cross-currency entries may only use Fixed Price / Quantity Tier / Custom
// Quote adjustment types — Percentage/Fixed-amount adjustments require the
// SAME currency as the catalog item's standard price, since this system
// never assumes a live exchange rate.
const CURRENCY_SAFE_ADJUSTMENTS = new Set(["Fixed Price", "Quantity Tier", "Custom Quote"]);

export function computeEntryFinalPrice(entry, catalogItem, quantity = 1) {
  const sameCurrency = entry.currency === catalogItem.currency;
  if (!sameCurrency && !CURRENCY_SAFE_ADJUSTMENTS.has(entry.adjustmentType)) {
    return { error: `A ${entry.adjustmentType} adjustment requires the entry currency to match the catalog item's currency (${catalogItem.currency}).` };
  }

  if (entry.adjustmentType === "Quantity Tier" && Array.isArray(entry.tiers) && entry.tiers.length > 0) {
    const tier = entry.tiers.find((t) => quantity >= (t.minQty ?? 0) && (t.maxQty == null || quantity <= t.maxQty));
    if (tier) return { price: round(tier.unitPrice, entry.currency) };
  }
  if (entry.adjustmentType === "Fixed Price" || entry.adjustmentType === "Custom Quote") {
    return { price: round(entry.adjustmentValue, entry.currency) };
  }
  const base = toMoney(catalogItem.standardPrice);
  if (entry.adjustmentType === "Percentage Increase") return { price: round(base.times(toMoney(entry.adjustmentValue).dividedBy(100).plus(1)), entry.currency) };
  if (entry.adjustmentType === "Percentage Decrease") return { price: round(base.times(toMoney(1).minus(toMoney(entry.adjustmentValue).dividedBy(100))), entry.currency) };
  if (entry.adjustmentType === "Fixed Increase") return { price: round(base.plus(entry.adjustmentValue), entry.currency) };
  if (entry.adjustmentType === "Fixed Decrease") return { price: round(base.minus(entry.adjustmentValue), entry.currency) };
  return { price: round(base, entry.currency) };
}
