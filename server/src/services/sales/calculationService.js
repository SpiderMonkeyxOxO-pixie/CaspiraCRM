// Deterministic Sales summary/forecast calculations — every function here
// takes an already organization-scoped, record-scope-filtered list of
// Deals (the caller resolves scope via scopeService.js before calling, the
// same discipline crmSummaryService.js established in Phase 2) and returns
// typed, numeric results. Never LLM-generated, never a stored counter.
// Mirrors the frontend's dashboardSelectors.js formulas exactly so the two
// never silently diverge.
import { sumByCurrency, currencyMapToApi, toMoney } from "./moneyService.js";

function isOpen(deal) {
  return deal.status === "Open";
}

// Weighted value = Deal amount x Stage probability / 100 — computed live
// from the Deal's own `probability` field (kept in sync with its Stage on
// every transition), never a separately stored column.
function weightedValue(deal) {
  return toMoney(deal.value).times(deal.probability || 0).dividedBy(100);
}

export function computeOpenPipeline(deals) {
  const open = deals.filter(isOpen);
  return { count: open.length, valueByCurrency: currencyMapToApi(sumByCurrency(open, { amountField: "value" })) };
}

export function computeWeightedPipeline(deals) {
  const open = deals.filter(isOpen).map((d) => ({ currency: d.currency, amount: weightedValue(d) }));
  return { valueByCurrency: currencyMapToApi(sumByCurrency(open)) };
}

export function computePipelineStageTotals(deals) {
  const open = deals.filter(isOpen);
  const byStage = new Map();
  for (const deal of open) {
    const key = deal.stage || "Unknown";
    if (!byStage.has(key)) byStage.set(key, []);
    byStage.get(key).push(deal);
  }
  const result = {};
  for (const [stage, stageDeals] of byStage.entries()) {
    result[stage] = {
      count: stageDeals.length,
      valueByCurrency: currencyMapToApi(sumByCurrency(stageDeals, { amountField: "value" })),
      weightedByCurrency: currencyMapToApi(sumByCurrency(stageDeals.map((d) => ({ currency: d.currency, amount: weightedValue(d) })))),
    };
  }
  return result;
}

export function computeWonValue(deals, { from, to } = {}) {
  const won = deals.filter((d) => d.status === "Won" && inRange(d.actualClosingDate, from, to));
  return { count: won.length, valueByCurrency: currencyMapToApi(sumByCurrency(won, { amountField: "value" })) };
}

export function computeLostValue(deals, { from, to } = {}) {
  const lost = deals.filter((d) => d.status === "Lost" && inRange(d.actualClosingDate, from, to));
  return { count: lost.length, valueByCurrency: currencyMapToApi(sumByCurrency(lost, { amountField: "value" })) };
}

function inRange(date, from, to) {
  if (!date) return !from && !to;
  const t = new Date(date).getTime();
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to).getTime()) return false;
  return true;
}

// Win rate: won / (won + lost) in the given range, per currency — never a
// single blended percentage across currencies, since count-based rates
// don't need currency grouping but the underlying deal sets do.
export function computeWinRate(deals, { from, to } = {}) {
  const won = deals.filter((d) => d.status === "Won" && inRange(d.actualClosingDate, from, to)).length;
  const lost = deals.filter((d) => d.status === "Lost" && inRange(d.actualClosingDate, from, to)).length;
  const decided = won + lost;
  return { won, lost, winRate: decided > 0 ? Number((won / decided).toFixed(4)) : 0 };
}

export function computeAvgDealSize(deals) {
  const open = deals.filter(isOpen);
  const byCurrency = new Map();
  for (const deal of open) {
    const list = byCurrency.get(deal.currency) || [];
    list.push(deal);
    byCurrency.set(deal.currency, list);
  }
  const result = {};
  for (const [currency, list] of byCurrency.entries()) {
    const total = list.reduce((sum, d) => sum.plus(toMoney(d.value)), toMoney(0));
    result[currency] = list.length > 0 ? Math.round(total.dividedBy(list.length).toNumber()) : 0;
  }
  return result;
}

export function computeDealCountByOwner(deals) {
  const counts = {};
  for (const deal of deals.filter(isOpen)) {
    const key = deal.ownerMembershipId || "unassigned";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function computeDealCountByStage(deals) {
  const counts = {};
  for (const deal of deals.filter(isOpen)) counts[deal.stage || "Unknown"] = (counts[deal.stage || "Unknown"] || 0) + 1;
  return counts;
}

// Pipeline concentration by Company — what share of OPEN pipeline value sits
// with each Company, grouped by currency (never blended). Flags concern
// when a single Company holds a large share, but this function only
// returns the raw breakdown; the caller decides what counts as "too much."
export function computePipelineConcentrationByCompany(deals) {
  const open = deals.filter((d) => isOpen(d) && d.companyId);
  const byCompany = new Map();
  for (const deal of open) {
    const list = byCompany.get(deal.companyId) || [];
    list.push(deal);
    byCompany.set(deal.companyId, list);
  }
  const result = {};
  for (const [companyId, list] of byCompany.entries()) {
    result[companyId] = { count: list.length, valueByCurrency: currencyMapToApi(sumByCurrency(list, { amountField: "value" })) };
  }
  return result;
}

// Deterministic, date-based forecast buckets — NOT an AI prediction and
// never described as one. Matches the frontend's computeForecastBuckets:
// overdue / thisWeek / thisMonth / nextMonth / later, based on
// expectedClosingDate for currently-Open Deals only.
export function computeForecastBuckets(deals, now = new Date()) {
  const open = deals.filter(isOpen);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfWeek = new Date(startOfDay); endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  const buckets = { overdue: [], thisWeek: [], thisMonth: [], nextMonth: [], later: [] };
  for (const deal of open) {
    if (!deal.expectedClosingDate) continue;
    const date = new Date(deal.expectedClosingDate);
    if (date < startOfDay) buckets.overdue.push(deal);
    else if (date <= endOfWeek) buckets.thisWeek.push(deal);
    else if (date <= endOfMonth) buckets.thisMonth.push(deal);
    else if (date <= endOfNextMonth) buckets.nextMonth.push(deal);
    else buckets.later.push(deal);
  }

  const out = {};
  for (const [bucket, list] of Object.entries(buckets)) {
    out[bucket] = { count: list.length, valueByCurrency: currencyMapToApi(sumByCurrency(list, { amountField: "value" })) };
  }
  return out;
}
