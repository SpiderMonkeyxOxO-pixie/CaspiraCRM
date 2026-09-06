// Centralized money arithmetic for the entire Sales domain (Deals, Catalog,
// Price Books, Quotes, Orders, Contracts). Every first-class relational
// money column is Postgres `numeric`/Prisma `Decimal` — this module is the
// ONLY place that does arithmetic on those values, so every document type
// computes totals identically and floating-point error never enters a
// calculation. `toApi()` (utils/serialize.js) converts Decimal -> plain
// number only at the API response boundary, never before.
import { Prisma } from "@prisma/client";

const { Decimal } = Prisma;

// Round-half-up to a currency's minor unit. Every currency this phase
// supports (USD/EUR/GBP/INR/IDR — see mockPriceBookData.js's
// PRICE_BOOK_CURRENCIES) uses 2 decimal places; if a zero-decimal currency
// is ever added, extend this map rather than assuming 2 everywhere.
const MINOR_UNIT_DECIMALS = { USD: 2, EUR: 2, GBP: 2, INR: 2, IDR: 2 };

export function minorUnitDecimals(currency) {
  return MINOR_UNIT_DECIMALS[currency] ?? 2;
}

export function toMoney(value) {
  if (value === null || value === undefined) return new Decimal(0);
  return value instanceof Decimal ? value : new Decimal(value);
}

export function round(value, currency = "USD") {
  return toMoney(value).toDecimalPlaces(minorUnitDecimals(currency), Decimal.ROUND_HALF_UP);
}

export function add(a, b) {
  return toMoney(a).plus(toMoney(b));
}

export function subtract(a, b) {
  return toMoney(a).minus(toMoney(b));
}

export function multiply(a, b) {
  return toMoney(a).times(toMoney(b));
}

export function isNegative(value) {
  return toMoney(value).isNegative();
}

// Sums a list of { currency, amount } entries INTO a Map<currency, Decimal>
// — the one and only way multi-currency values are ever combined in this
// codebase. Never returns a single blended number; callers must handle a
// map, forcing them to either display per-currency or explicitly pick one.
export function sumByCurrency(entries, { currencyField = "currency", amountField = "amount" } = {}) {
  const totals = new Map();
  for (const entry of entries) {
    const currency = entry[currencyField] || "USD";
    const amount = entry[amountField];
    totals.set(currency, add(totals.get(currency) || 0, amount));
  }
  return totals;
}

export function currencyMapToApi(map) {
  const out = {};
  for (const [currency, value] of map.entries()) out[currency] = round(value, currency).toNumber();
  return out;
}

// --- Documented calculation order (Deal line items, Quote line items,
// Order line items, Contract line items — identical across all four) ---
//   1. Quantity × unit price               -> gross
//   2. Line discount (Percentage | Fixed Amount) applied to gross -> lineSubtotal
//   3. Tax applied to lineSubtotal (a flat preview rate per taxCategory,
//      matching the frontend's own TAX_RATE_PREVIEW map — never a real
//      tax-jurisdiction engine) -> taxAmount
//   4. lineSubtotal + taxAmount            -> lineTotal
// Document-level: sum of lineSubtotal -> subtotal; sum of per-line discount
// amounts -> discountTotal; an optional document-level discount/tax is
// applied AFTER line totals per the spec's documented order; sum of
// lineTotal (post any document-level adjustment) -> grandTotal.
const TAX_RATE_PREVIEW = { Standard: 0.08, Reduced: 0.04, "Zero-Rated": 0, Exempt: 0, "Digital Services": 0.08 };

export function taxRateFor(taxCategory) {
  return TAX_RATE_PREVIEW[taxCategory] ?? TAX_RATE_PREVIEW.Standard;
}

export function computeLineDiscountAmount(gross, discountType, discountValue) {
  if (!discountValue) return new Decimal(0);
  const value = toMoney(discountValue);
  if (discountType === "Percentage") {
    if (value.isNegative() || value.greaterThan(100)) throw new RangeError("Percentage discount must be between 0 and 100.");
    return gross.times(value).dividedBy(100);
  }
  // Fixed Amount — never allowed to exceed the gross it's discounting.
  if (value.isNegative()) throw new RangeError("Discount amount cannot be negative.");
  return value.greaterThan(gross) ? gross : value;
}

// Computes { lineSubtotal, taxAmount, lineTotal } for one line item.
// Never trusts a client-submitted total — this is the ONLY function that
// produces those three values anywhere in the Sales domain.
export function computeLineTotals({ quantity, unitPrice, discountType, discountValue, taxCategory, currency = "USD" }) {
  const qty = toMoney(quantity);
  const price = toMoney(unitPrice);
  if (qty.isNegative()) throw new RangeError("Quantity cannot be negative.");
  if (price.isNegative()) throw new RangeError("Unit price cannot be negative.");

  const gross = multiply(qty, price);
  const discountAmount = computeLineDiscountAmount(gross, discountType, discountValue);
  const lineSubtotal = round(subtract(gross, discountAmount), currency);
  const taxAmount = round(multiply(lineSubtotal, taxRateFor(taxCategory)), currency);
  const lineTotal = round(add(lineSubtotal, taxAmount), currency);

  return { lineSubtotal, taxAmount, lineTotal, discountAmount: round(discountAmount, currency) };
}

// Computes document-level { subtotal, discountTotal, taxTotal, grandTotal }
// from an array of already-computed line results (see computeLineTotals),
// plus an optional document-level discount (applied to the subtotal before
// tax has already been baked into line totals — so a document-level
// discount here is an additional reduction applied to the post-line-tax
// grand total, kept separate from taxTotal so it's never double-taxed).
export function computeDocumentTotals(lines, { currency = "USD", documentDiscountType, documentDiscountValue } = {}) {
  let subtotal = new Decimal(0);
  let taxTotal = new Decimal(0);
  let lineDiscountTotal = new Decimal(0);
  for (const line of lines) {
    subtotal = add(subtotal, line.lineSubtotal);
    taxTotal = add(taxTotal, line.taxAmount);
    lineDiscountTotal = add(lineDiscountTotal, line.discountAmount || 0);
  }
  const documentDiscountAmount = documentDiscountValue
    ? computeLineDiscountAmount(subtotal, documentDiscountType, documentDiscountValue)
    : new Decimal(0);
  const discountTotal = add(lineDiscountTotal, documentDiscountAmount);
  const grandTotal = round(subtract(add(subtotal, taxTotal), documentDiscountAmount), currency);

  return {
    subtotal: round(subtotal, currency),
    discountTotal: round(discountTotal, currency),
    taxTotal: round(taxTotal, currency),
    grandTotal,
  };
}
