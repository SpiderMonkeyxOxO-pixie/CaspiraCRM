// Deal-level risk/data-quality checks — pure functions, no I/O. Mirrors
// dealUtils.js's computeDealRiskReasons() on the frontend so both surfaces
// agree on what counts as "stale," "missing a next action," etc. Deal
// inactivity is deliberately NEVER stored — it's derived here from the
// Deal's own fields plus an authorized `lastActivityAt` the caller passes
// in (looked up from real Activity records, never a cached counter).
const STALE_THRESHOLD_MS = 21 * 24 * 60 * 60 * 1000; // 21 days, matching dealUtils.js

export function isStaleDeal(deal, lastActivityAt) {
  if (deal.status !== "Open") return false;
  const reference = lastActivityAt || deal.updatedAt;
  if (!reference) return false;
  return Date.now() - new Date(reference).getTime() > STALE_THRESHOLD_MS;
}

export function isMissingNextAction(deal) {
  return !deal.nextAction;
}

export function isMissingDecisionMaker(deal) {
  const roles = Array.isArray(deal.contactRoles) ? deal.contactRoles : [];
  return !roles.some((r) => r.role === "Decision Maker");
}

export function isMissingOwner(deal) {
  return !deal.ownerMembershipId;
}

export function isMissingProducts(deal, lineItemCount) {
  return (lineItemCount ?? deal.lineItems?.length ?? 0) === 0;
}

export function hasPassedExpectedCloseDate(deal) {
  if (deal.status !== "Open" || !deal.expectedClosingDate) return false;
  return new Date(deal.expectedClosingDate).getTime() < Date.now();
}

// Aggregates every reason for one Deal, matching the frontend's
// computeDealRiskReasons() human-readable output.
export function computeDealRiskReasons(deal, { lastActivityAt, lineItemCount } = {}) {
  const reasons = [];
  if (isStaleDeal(deal, lastActivityAt)) reasons.push("No recent activity");
  if (isMissingNextAction(deal)) reasons.push("No next action set");
  if (hasPassedExpectedCloseDate(deal)) reasons.push("Expected close date has passed");
  if (!deal.primaryContactId) reasons.push("Missing a primary contact");
  if (isMissingDecisionMaker(deal)) reasons.push("Missing a decision maker");
  if (isMissingOwner(deal)) reasons.push("Missing an owner");
  if (isMissingProducts(deal, lineItemCount)) reasons.push("Missing Products or Services");
  return reasons;
}
