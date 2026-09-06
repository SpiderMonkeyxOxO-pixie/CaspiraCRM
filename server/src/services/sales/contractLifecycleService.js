// Pure Contract lifecycle checks — mirrors mockContractData.js's
// isRenewalDue()/isExpiringSoon()/hasIncompleteSignatory() exactly, so the
// worker jobs (which only ever detect and notify, never act) and the API
// controller agree on what counts as "due."
const EXPIRING_SOON_DAYS = 30;

function daysUntil(date) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export function isRenewalDue(contract) {
  if (contract.status !== "Signed" || contract.renewalType === "No Renewal" || !contract.endDate) return false;
  const days = daysUntil(contract.endDate);
  return days >= 0 && days <= (contract.renewalNoticeDays ?? 60);
}

export function isExpiringSoon(contract) {
  if (contract.status !== "Signed" || !contract.endDate) return false;
  const days = daysUntil(contract.endDate);
  return days >= 0 && days <= EXPIRING_SOON_DAYS;
}

export function isExpired(contract) {
  return contract.status === "Signed" && contract.endDate && new Date(contract.endDate).getTime() < Date.now();
}

export function hasIncompleteSignatory(contract) {
  if (!["Sent for Signature", "Signed"].includes(contract.status)) return false;
  return !contract.internalSignedAt || !contract.customerSignedAt;
}

export function isObligationOverdue(obligation) {
  if (["Completed", "Waived", "Cancelled"].includes(obligation.status)) return false;
  return !!obligation.dueDate && new Date(obligation.dueDate).getTime() < Date.now();
}
