import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";
import { previewOrderToContract, convertOrderToContract } from "../../services/sales/orderToContractService.js";
import { recordIdempotentResponse } from "../../middleware/idempotency.js";

const MAX_PAGE_SIZE = 100;

function scopeWhere(req) {
  return resolveCrmScopeWhere(req, "contracts", { ownerField: "ownerMembershipId" });
}

function buildListWhere(req) {
  const q = req.query;
  const where = { organizationId: req.organizationId, ...scopeWhere(req) };
  where.archived = q.archived === "true";
  if (q.search) where.contractNumber = { contains: q.search, mode: "insensitive" };
  if (q.status) where.status = q.status;
  if (q.companyId) where.companyId = q.companyId;
  if (q.sourceOrderId) where.sourceOrderId = q.sourceOrderId;
  return where;
}

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const where = buildListWhere(req);
  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.contract.count({ where }),
  ]);
  res.json({ contracts: toApi(contracts), total, page, pageSize });
}

export async function getOne(req, res) {
  const contract = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) }, include: { lineItems: true, obligations: true, renewalReviews: true } });
  if (!contract) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  res.json({ contract: toApi(contract) });
}

export async function create(req, res) {
  const { companyId, currency = "USD" } = req.body;
  if (companyId) {
    const c = await prisma.company.findFirst({ where: { id: companyId, organizationId: req.organizationId } });
    if (!c) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "companyId must reference a record in this organization." });
  }
  const contract = await prisma.$transaction(async (tx) => {
    const { nextDocumentNumber } = await import("../../services/sales/documentNumberService.js");
    const contractNumber = await nextDocumentNumber(tx, req.organizationId, "Contract");
    return tx.contract.create({
      data: { organizationId: req.organizationId, contractNumber, contractType: req.body.contractType || "One-Time Agreement", companyId, contactId: req.body.contactId, dealId: req.body.dealId, currency, status: "Draft", renewalType: req.body.renewalType || "Manual Renew", renewalNoticeDays: req.body.renewalNoticeDays ?? 60, ownerMembershipId: req.membership?.id, createdByMembershipId: req.membership?.id, updatedByMembershipId: req.membership?.id },
    });
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.created", targetType: "Contract", targetId: contract.id, result: "Success" });
  res.status(201).json({ contract: toApi(contract) });
}

export async function update(req, res) {
  const existing = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "SALES_VERSION_CONFLICT", message: "This contract was updated by someone else. Refresh and try again." });
  }
  const { version, id, organizationId, createdAt, contractNumber, lineItems, ...rest } = req.body;
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { ...rest, updatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.updated", targetType: "Contract", targetId: contract.id, result: "Success" });
  res.json({ contract: toApi(contract) });
}

export async function submit(req, res) {
  const existing = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  if (existing.status !== "Draft") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Draft Contract can be submitted for review." });
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { status: "Pending Internal Review", version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.submitted", targetType: "Contract", targetId: contract.id, result: "Success" });
  res.json({ contract: toApi(contract) });
}

// Approval here means "cleared internal review, ready to send for
// signature" — a distinct, human-triggered step before signatures are
// ever collected.
export async function approve(req, res) {
  const existing = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  if (existing.status !== "Pending Internal Review") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Contract pending internal review can be approved." });
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { status: "Sent for Signature", sentForSignatureAt: new Date(), version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.approved", targetType: "Contract", targetId: contract.id, result: "Success" });
  res.json({ contract: toApi(contract) });
}

export async function recordSignature(req, res) {
  const { party, name, title } = req.body;
  if (!party || !["internal", "customer"].includes(party)) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "party must be 'internal' or 'customer'." });
  if (!name?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A signatory name is required." });
  const existing = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  if (existing.status !== "Sent for Signature") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Contract sent for signature can record a signature." });

  const signedAt = new Date();
  const data = party === "internal" ? { internalSignatoryName: name, internalSignatoryTitle: title || null, internalSignedAt: signedAt } : { customerSignatoryName: name, customerSignatoryTitle: title || null, customerSignedAt: signedAt };
  const otherSigned = party === "internal" ? existing.customerSignedAt : existing.internalSignedAt;
  if (otherSigned) { data.status = "Signed"; data.signedAt = signedAt; }
  data.version = { increment: 1 };

  const contract = await prisma.contract.update({ where: { id: existing.id }, data });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.signature_recorded", targetType: "Contract", targetId: contract.id, result: "Success", after: { party, fullyExecuted: !!otherSigned } });
  res.json({ contract: toApi(contract) });
}

// Contract activation is explicitly human-controlled and permission-gated
// — distinct from signature capture (which only records execution of the
// paper contract). Never called automatically anywhere in this codebase.
export async function activate(req, res) {
  const existing = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  if (existing.status !== "Signed") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a fully Signed Contract can be activated." });
  if (existing.activationDate) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "This Contract has already been activated." });
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { activationDate: new Date(), activatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.activated", targetType: "Contract", targetId: contract.id, result: "Success" });
  await recordIdempotentResponse(req, 200, { contract: toApi(contract) });
  res.json({ contract: toApi(contract) });
}

export async function startRenewalReview(req, res) {
  const existing = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  if (existing.status !== "Signed") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Signed Contract can start a renewal review." });

  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.contractRenewalReview.create({
      data: { contractId: existing.id, renewalOwnerMembershipId: req.body.renewalOwnerMembershipId || existing.ownerMembershipId, renewalNoticeDeadline: existing.endDate, proposedStartDate: req.body.proposedStartDate ? new Date(req.body.proposedStartDate) : null, proposedEndDate: req.body.proposedEndDate ? new Date(req.body.proposedEndDate) : null, proposedValue: req.body.proposedValue },
    });
    await tx.contract.update({ where: { id: existing.id }, data: { status: "Renewal Review", version: { increment: 1 } } });
    return created;
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.renewal_review_started", targetType: "Contract", targetId: existing.id, result: "Success" });
  res.status(201).json({ renewalReview: toApi(review) });
}

export async function decideRenewal(req, res) {
  const { decision, decisionReason } = req.body;
  if (!["Renew", "Do Not Renew", "Renegotiate"].includes(decision)) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "decision must be Renew, Do Not Renew, or Renegotiate." });
  const contract = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!contract) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  const review = await prisma.contractRenewalReview.findFirst({ where: { id: req.params.reviewId, contractId: contract.id } });
  if (!review) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Renewal review not found." });

  // No Contract is automatically renewed — a "Renew" decision here records
  // the human decision only; creating the actual replacement/amended
  // Contract (relatedNewContractId) is a separate, explicit follow-up
  // action outside this phase's minimum scope.
  const updated = await prisma.contractRenewalReview.update({ where: { id: review.id }, data: { decision, decisionReason, decidedByMembershipId: req.membership?.id, decidedAt: new Date() } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.renewal_decided", targetType: "ContractRenewalReview", targetId: review.id, result: "Success", after: { decision } });
  res.json({ renewalReview: toApi(updated) });
}

export async function expire(req, res) {
  const existing = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { status: "Expired", version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.expired", targetType: "Contract", targetId: contract.id, result: "Success" });
  res.json({ contract: toApi(contract) });
}

export async function terminate(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A termination reason is required." });
  const existing = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { status: "Terminated", terminationReason: req.body.reason, terminationEffectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : new Date(), version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.terminated", targetType: "Contract", targetId: contract.id, result: "Success", reason: req.body.reason });
  res.json({ contract: toApi(contract) });
}

export async function cancel(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A cancellation reason is required." });
  const existing = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  if (!["Draft", "Pending Internal Review", "Sent for Signature"].includes(existing.status)) {
    return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Draft, Pending Internal Review, or Sent-for-Signature Contract can be cancelled." });
  }
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { status: "Cancelled", cancellationReason: req.body.reason, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.cancelled", targetType: "Contract", targetId: contract.id, result: "Success", reason: req.body.reason });
  res.json({ contract: toApi(contract) });
}

export async function archive(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to archive a Contract." });
  const existing = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), statusBeforeArchive: existing.status, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.archived", targetType: "Contract", targetId: contract.id, result: "Success" });
  res.json({ contract: toApi(contract) });
}

export async function restore(req, res) {
  const existing = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, status: existing.statusBeforeArchive || "Draft", statusBeforeArchive: null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.restored", targetType: "Contract", targetId: contract.id, result: "Success" });
  res.json({ contract: toApi(contract) });
}

// --- Obligations ---

export async function listObligations(req, res) {
  const contract = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!contract) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  const obligations = await prisma.contractObligation.findMany({ where: { contractId: contract.id }, orderBy: { dueDate: "asc" } });
  res.json({ obligations: toApi(obligations) });
}

export async function createObligation(req, res) {
  const contract = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!contract) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  if (!req.body.title?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "title is required." });
  const obligation = await prisma.contractObligation.create({
    data: { contractId: contract.id, organizationId: req.organizationId, title: req.body.title, description: req.body.description, ownerMembershipId: req.body.ownerMembershipId, dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null, status: "Open" },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.obligation_created", targetType: "ContractObligation", targetId: obligation.id, result: "Success" });
  res.status(201).json({ obligation: toApi(obligation) });
}

export async function updateObligation(req, res) {
  const contract = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!contract) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  const existing = await prisma.contractObligation.findFirst({ where: { id: req.params.obligationId, contractId: contract.id } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Obligation not found." });
  const { id, contractId, organizationId, version, ...rest } = req.body;
  if ("dueDate" in rest) rest.dueDate = rest.dueDate ? new Date(rest.dueDate) : null;
  const obligation = await prisma.contractObligation.update({ where: { id: existing.id }, data: { ...rest, version: { increment: 1 } } });
  res.json({ obligation: toApi(obligation) });
}

export async function completeObligation(req, res) {
  const contract = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!contract) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  const existing = await prisma.contractObligation.findFirst({ where: { id: req.params.obligationId, contractId: contract.id } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Obligation not found." });
  const obligation = await prisma.contractObligation.update({ where: { id: existing.id }, data: { status: "Completed", completedDate: new Date(), completedByMembershipId: req.membership?.id, evidenceNote: req.body.evidenceNote, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.obligation_completed", targetType: "ContractObligation", targetId: obligation.id, result: "Success" });
  res.json({ obligation: toApi(obligation) });
}

export async function waiveObligation(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to waive an obligation." });
  const contract = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!contract) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  const existing = await prisma.contractObligation.findFirst({ where: { id: req.params.obligationId, contractId: contract.id } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Obligation not found." });
  const obligation = await prisma.contractObligation.update({ where: { id: existing.id }, data: { status: "Waived", waiveReason: req.body.reason, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.contract.obligation_waived", targetType: "ContractObligation", targetId: obligation.id, result: "Success", reason: req.body.reason });
  res.json({ obligation: toApi(obligation) });
}

// --- Order-to-Contract conversion (mounted under /sales/orders/:orderId) ---

export async function contractPreview(req, res) {
  const result = await previewOrderToContract(req.organizationId, req.params.orderId);
  if (result.error) return res.status(result.error.status).json({ code: result.error.code, message: result.error.message });
  res.json({ preview: toApi(result.preview) });
}

export async function convertToContract(req, res) {
  const result = await convertOrderToContract({
    organizationId: req.organizationId, orderId: req.params.orderId, actorUserId: req.user.id, actorMembershipId: req.membership?.id,
    ipAddress: req.ip, userAgent: req.headers["user-agent"], correlationId: req.correlationId,
    termMonths: req.body.termMonths, renewalType: req.body.renewalType, renewalNoticeDays: req.body.renewalNoticeDays,
  });
  if (result.error) return res.status(result.error.status).json({ code: result.error.code, message: result.error.message });
  await recordIdempotentResponse(req, 201, { contract: toApi(result.contract) });
  res.status(201).json({ contract: toApi(result.contract) });
}
