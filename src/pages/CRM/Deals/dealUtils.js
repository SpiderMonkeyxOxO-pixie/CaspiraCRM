// Pure formatting/calculation helpers — split out from the badge components
// so this file can mix plain function exports without tripping the
// react-refresh/only-export-components rule (same pattern as
// Activities/activityUtils.js).

export function formatMoney(amount, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount || 0);
  } catch {
    return `${currency} ${Math.round(amount || 0).toLocaleString()}`;
  }
}

// Formats a currency-keyed totals map (e.g. {USD: 100, EUR: 50}) grouped by
// currency rather than silently summed across currencies.
export function formatByCurrency(byCurrency = {}) {
  const entries = Object.entries(byCurrency).filter(([, v]) => v);
  if (entries.length === 0) return formatMoney(0);
  if (entries.length === 1) return formatMoney(entries[0][1], entries[0][0]);
  return entries.map(([cur, v]) => formatMoney(v, cur)).join(" + ");
}

export function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

export function formatDateTime(iso) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return "less than a day";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return "less than a day";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month" : `${months} months`;
}

export function timeInCurrentStage(deal) {
  const last = deal.stageHistory?.[deal.stageHistory.length - 1];
  if (!last) return null;
  return Date.now() - new Date(last.at).getTime();
}

// A deal reads as "stale" once it's gone quiet for a while — used by the
// "Stale activity" filter and the Stalled health state's fallback reason.
export const STALE_THRESHOLD_MS = 21 * 24 * 60 * 60 * 1000;

export function isStaleDeal(deal, lastActivityAt) {
  if (deal.status !== "Open") return false;
  const reference = lastActivityAt || deal.updatedAt || deal.createdAt;
  return !!reference && Date.now() - new Date(reference).getTime() > STALE_THRESHOLD_MS;
}

// Every stale/at-risk indicator shown anywhere (Deals table, Pipeline cards)
// must carry a reason — never an unexplained flag or color. Shared here so
// Pipeline doesn't reinvent its own version of these checks.
export function computeDealRiskReasons(deal, { lastActivityAt } = {}) {
  if (deal.status !== "Open") return [];
  const reasons = [];
  const reference = lastActivityAt || deal.updatedAt || deal.createdAt;
  if (reference && Date.now() - new Date(reference).getTime() > STALE_THRESHOLD_MS) reasons.push("No activity for over 3 weeks");
  if (!deal.nextAction) reasons.push("No next action set");
  if (deal.expectedClosingDate && new Date(deal.expectedClosingDate) < new Date()) reasons.push("Expected close date has passed");
  if (!deal.primaryContactId) reasons.push("Missing a primary contact");
  if ((deal.quotes || []).some((q) => q.status !== "Accepted" && q.expirationDate && new Date(q.expirationDate) < new Date())) reasons.push("A proposal/quote has expired");
  const stageVisits = (deal.stageHistory || []).filter((h) => h.to === deal.stage).length;
  if (stageVisits > 1) reasons.push("Re-entered this stage more than once — may indicate repeated delays");
  return reasons;
}
