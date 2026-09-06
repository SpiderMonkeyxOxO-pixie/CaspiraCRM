// Deterministic internal-only Sales background jobs — quote expiration
// detection, contract expiration detection, renewal-notice deadline
// detection, and overdue obligation detection. Every job here is
// idempotent (rerunning produces the same end state, not duplicate
// notifications) and organization-scoped implicitly (it queries across all
// organizations but every row it touches already carries its own
// organizationId). None of these jobs approve a Quote, confirm an Order,
// or activate/renew/terminate a Contract — they only ever create an
// internal OutboxEvent notification or, for obligations, flip a stored
// status the obligation model already defines (Overdue), never anything
// that represents a business decision a human must make.
import prisma from "../../lib/prisma.js";
import { isRenewalDue, isExpired } from "../../services/sales/contractLifecycleService.js";

const EXPIRABLE_QUOTE_STATUSES = ["Draft", "Internal Review", "Approval Pending", "Approved", "Preview Sent", "Preview Viewed"];

async function notify(aggregateType, aggregateId, eventType, payload) {
  // Idempotent: skip if an identical, still-pending notification already
  // exists for this aggregate+eventType — reruns never pile up duplicates.
  const existing = await prisma.outboxEvent.findFirst({ where: { aggregateType, aggregateId, eventType, status: "Pending" } });
  if (existing) return;
  await prisma.outboxEvent.create({ data: { aggregateType, aggregateId, eventType, payload } });
}

export async function detectExpiredQuotes() {
  const candidates = await prisma.quote.findMany({ where: { status: { in: EXPIRABLE_QUOTE_STATUSES }, validUntilDate: { lt: new Date() }, archived: false } });
  for (const quote of candidates) {
    await notify("Quote", quote.id, "sales.quote.expired_detected", { organizationId: quote.organizationId, quoteNumber: quote.quoteNumber, validUntilDate: quote.validUntilDate });
  }
  return candidates.length;
}

export async function detectExpiredContracts() {
  const signed = await prisma.contract.findMany({ where: { status: "Signed", archived: false, endDate: { not: null } } });
  const expired = signed.filter(isExpired);
  for (const contract of expired) {
    await notify("Contract", contract.id, "sales.contract.expired_detected", { organizationId: contract.organizationId, contractNumber: contract.contractNumber, endDate: contract.endDate });
  }
  return expired.length;
}

export async function detectRenewalNoticeDeadlines() {
  const signed = await prisma.contract.findMany({ where: { status: "Signed", archived: false, renewalType: { not: "No Renewal" }, endDate: { not: null } } });
  const due = signed.filter(isRenewalDue);
  for (const contract of due) {
    await notify("Contract", contract.id, "sales.contract.renewal_notice_due", { organizationId: contract.organizationId, contractNumber: contract.contractNumber, renewalOwnerMembershipId: contract.ownerMembershipId, endDate: contract.endDate });
  }
  return due.length;
}

// The only job that mutates a row directly — "Overdue" is an explicit
// stored status ContractObligation already defines (per the spec's own
// obligation-status list), a deterministic re-computation from due date
// and current status, not a business decision. Rerunning this is a no-op
// once every overdue obligation already carries the status.
export async function detectOverdueObligations() {
  const result = await prisma.contractObligation.updateMany({
    where: { status: { in: ["Open", "In Progress"] }, dueDate: { lt: new Date() } },
    data: { status: "Overdue" },
  });
  return result.count;
}

export async function runSalesDeadlineSweep() {
  const [expiredQuotes, expiredContracts, renewalNotices, overdueObligations] = await Promise.all([
    detectExpiredQuotes(), detectExpiredContracts(), detectRenewalNoticeDeadlines(), detectOverdueObligations(),
  ]);
  return { expiredQuotes, expiredContracts, renewalNotices, overdueObligations };
}
