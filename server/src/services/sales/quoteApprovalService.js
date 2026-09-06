// Human-controlled Quote approval — a focused SalesApproval model (no
// shared approval system exists anywhere else in this codebase). Reuses
// the frontend's own approval triggers (mockQuoteData.js's
// computeQuoteWarnings/requiresApproval): a large discount, a total this
// system considers unusually high, or margin concerns. No automatic
// approval is ever granted — every SalesApproval row starts "Pending"
// and is only ever decided by an explicit human action.
export const DISCOUNT_WARNING_THRESHOLD = 20; // percent — matches the frontend's own constant
export const HIGH_VALUE_THRESHOLD = 50000; // grand total, in the quote's own currency

export function requiresApproval(quote, lineItems) {
  const reasons = [];
  for (const line of lineItems) {
    if (line.discountType === "Percentage" && Number(line.discountValue) > DISCOUNT_WARNING_THRESHOLD) {
      reasons.push(`Line "${line.name || line.nameSnapshot}" has a discount above ${DISCOUNT_WARNING_THRESHOLD}%.`);
    }
    if (line.isOverridden) reasons.push(`Line "${line.name || line.nameSnapshot}" has a manually overridden price.`);
  }
  if (quote.grandTotal != null && Number(quote.grandTotal) > HIGH_VALUE_THRESHOLD) {
    reasons.push(`Quote total exceeds $${HIGH_VALUE_THRESHOLD.toLocaleString()}.`);
  }
  return { required: reasons.length > 0, reasons };
}

// Requester must not approve their own restricted Quote — separation of
// duties, enforced here rather than left to the frontend's presentational
// approval object.
export function canDecide(approval, decidingMembershipId) {
  return approval.requestedByMembershipId !== decidingMembershipId;
}
