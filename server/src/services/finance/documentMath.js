// Backend Phase 6 (full spec) — line and document totals for invoices,
// vendor bills, credit notes and expenses. Decimal arithmetic only; the
// client's totals are never used.
//
// Calculation order (per line), rounding half-up to the currency's minor
// unit at each numbered step:
//   1. gross    = quantity × unit price
//   2. net      = gross − line discount (never below 0)
//   3. exclusive tax: tax = net × rate;   total = net + tax
//      inclusive tax: total = net;        net = total ÷ (1 + rate); tax = total − net
// Document totals are the sums of the rounded line values (never
// re-rounded), so lines always add up to the document.
import { Prisma } from "@prisma/client";
import { round, toMoney } from "../sales/moneyService.js";
import { parseQuantity, text } from "./financeCommon.js";

const { Decimal } = Prisma;
const ZERO = new Decimal(0);

// What a document keeps of a tax rate — later edits to the rate never
// change a line that already has it.
export const taxSnapshot = (rate) => (rate ? { taxRateId: rate.id, code: rate.code, name: rate.name, rateBasisPoints: rate.rateBasisPoints, inclusive: rate.inclusive, recoverable: rate.recoverable } : null);

export function lineAmounts({ quantity, unitPrice, discountAmount = ZERO, snapshot = null, currency }) {
  const gross = round(toMoney(quantity).times(toMoney(unitPrice)), currency);
  const discount = round(toMoney(discountAmount), currency);
  if (discount.isNegative()) throw new RangeError("A discount can't be negative.");
  const net = gross.minus(discount).isNegative() ? ZERO : gross.minus(discount);
  if (!snapshot || !snapshot.rateBasisPoints) return { lineSubtotal: net, taxAmount: ZERO, lineTotal: net, discountAmount: discount };
  const rate = new Decimal(snapshot.rateBasisPoints).dividedBy(10000);
  if (snapshot.inclusive) {
    const subtotal = round(net.dividedBy(rate.plus(1)), currency);
    return { lineSubtotal: subtotal, taxAmount: net.minus(subtotal), lineTotal: net, discountAmount: discount };
  }
  const tax = round(net.times(rate), currency);
  return { lineSubtotal: net, taxAmount: tax, lineTotal: net.plus(tax), discountAmount: discount };
}

// Validates raw lines ({ description, quantity, unitPrice, discountAmount?,
// taxRateId?, accountId?, costCenterId?, projectId?, productId? }) and
// computes every amount. `taxRatesById` holds the organization's rates;
// `kind` is "Sales" or "Purchase" (a rate must allow it).
export function computeDocument(rawLines, { currency, taxRatesById = new Map(), kind = "Sales", maxLines = 200 }) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw new RangeError("A document needs at least one line.");
  if (rawLines.length > maxLines) throw new RangeError(`At most ${maxLines} lines.`);
  const lines = rawLines.map((raw, i) => {
    const n = i + 1;
    const description = text(raw?.description ?? raw?.name, 500);
    if (!description) throw new RangeError(`Line ${n} needs a description.`);
    const quantity = parseQuantity(raw.quantity ?? raw.qty ?? 1, { field: `Line ${n} quantity` });
    const unitPrice = parseQuantity(raw.unitPrice ?? "", { field: `Line ${n} unit price`, allowZero: true });
    let snapshot = null;
    if (raw.taxRateId) {
      const rate = taxRatesById.get(raw.taxRateId);
      if (!rate || !rate.active) throw new RangeError(`Line ${n}: that tax rate isn't available.`);
      if (rate.type !== "Both" && rate.type !== kind) throw new RangeError(`Line ${n}: tax ${rate.code} is a ${rate.type.toLowerCase()} tax.`);
      snapshot = taxSnapshot(rate);
    }
    const amounts = lineAmounts({ quantity, unitPrice, discountAmount: raw.discountAmount || 0, snapshot, currency });
    return {
      lineNumber: n, description, quantity, unitPrice, taxRateId: snapshot?.taxRateId || null, taxSnapshot: snapshot, ...amounts,
      accountId: raw.accountId || raw.revenueAccountId || null, costCenterId: raw.costCenterId || null, projectId: raw.projectId || null, productId: raw.productId || null,
    };
  });
  const sum = (field) => lines.reduce((s, l) => s.plus(l[field]), ZERO);
  return { lines, subtotal: sum("lineSubtotal"), tax: sum("taxAmount"), total: sum("lineTotal"), discountTotal: sum("discountAmount") };
}

export async function loadTaxRates(db, organizationId, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Map();
  return new Map((await db.taxRate.findMany({ where: { organizationId, id: { in: wanted } } })).map((r) => [r.id, r]));
}

// Tax lines for a journal, grouped by account. Sales tax goes to the rate's
// sales account (or Tax Payable); recoverable purchase tax to the rate's
// purchase account (or Tax Recoverable). Non-recoverable purchase tax is
// part of the cost and stays on the expense line (callers handle that).
export function taxPostings(lines, { kind, settings, taxRatesById }) {
  const byAccount = new Map();
  for (const line of lines) {
    if (!line.taxSnapshot || toMoney(line.taxAmount).isZero()) continue;
    const rate = taxRatesById.get(line.taxSnapshot.taxRateId);
    let accountId;
    if (kind === "Sales") accountId = rate?.salesAccountId || settings.taxPayableAccountId;
    else if (line.taxSnapshot.recoverable) accountId = rate?.purchaseAccountId || settings.taxRecoverableAccountId;
    else continue;
    if (!accountId) throw new RangeError(`No tax account is configured for ${line.taxSnapshot.code}. Set one on the tax rate or in Finance settings.`);
    byAccount.set(accountId, (byAccount.get(accountId) || ZERO).plus(toMoney(line.taxAmount)));
  }
  return [...byAccount.entries()].map(([accountId, amount]) => ({ accountId, amount }));
}
