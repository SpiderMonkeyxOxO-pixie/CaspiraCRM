// Backend Phase 12 — currency governance. Original currency and amount are
// always kept; the base-currency amount uses the approved Finance rate in
// effect on the transaction's business date (never today's rate for
// history). Finance rates mean 1 base = rate × quote. No rate → the base
// amount stays null and the row is marked "Unavailable".
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma.js";

export const UNAVAILABLE_NOTE = "Currency conversion unavailable for part of this result.";
const D = (v) => new Prisma.Decimal(v);

// Copies approved Finance rates into the warehouse (versioned by the source row version).
export async function syncRates(organizationId, db = prisma) {
  const rates = await db.exchangeRate.findMany({ where: { organizationId, status: "Approved" } });
  let added = 0;
  for (const r of rates) {
    const exists = await db.analyticsExchangeRate.findUnique({ where: { organizationId_sourceRateId_version: { organizationId, sourceRateId: r.id, version: r.version } } });
    if (exists) continue;
    await db.analyticsExchangeRate.create({ data: { organizationId, baseCurrency: r.baseCurrency, quoteCurrency: r.quoteCurrency, rate: r.rate, effectiveDate: new Date(`${r.effectiveDate.toISOString().slice(0, 10)}T00:00:00Z`), source: r.source, sourceRateId: r.id, version: r.version } });
    added += 1;
  }
  return added;
}

// A converter bound to one organization's rates (loaded once per job).
export async function converterFor(organizationId, baseCurrency, db = prisma) {
  const rates = await db.analyticsExchangeRate.findMany({ where: { organizationId }, orderBy: [{ effectiveDate: "desc" }, { version: "desc" }] });
  return function convert(amount, currency, dateValue) {
    if (amount === null || amount === undefined) return { baseAmount: null, rateDate: null, rateVersion: null, conversionStatus: "No amount" };
    const cur = String(currency || "").toUpperCase();
    if (!cur) return { baseAmount: null, rateDate: null, rateVersion: null, conversionStatus: "Unavailable" };
    if (cur === baseCurrency) return { baseAmount: D(amount).toDecimalPlaces(2), rateDate: null, rateVersion: null, conversionStatus: "Same currency" };
    const when = dateValue ? new Date(dateValue) : new Date();
    // 1 base = rate × quote → base = amount / rate.
    const direct = rates.find((r) => r.baseCurrency === baseCurrency && r.quoteCurrency === cur && r.effectiveDate <= when);
    if (direct) return { baseAmount: D(amount).div(direct.rate).toDecimalPlaces(2), rateDate: direct.effectiveDate, rateVersion: direct.version, conversionStatus: "Converted" };
    const inverse = rates.find((r) => r.baseCurrency === cur && r.quoteCurrency === baseCurrency && r.effectiveDate <= when);
    if (inverse) return { baseAmount: D(amount).mul(inverse.rate).toDecimalPlaces(2), rateDate: inverse.effectiveDate, rateVersion: inverse.version, conversionStatus: "Converted" };
    return { baseAmount: null, rateDate: null, rateVersion: null, conversionStatus: "Unavailable" };
  };
}
