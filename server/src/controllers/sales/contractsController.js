import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";
import { previewOrderToContract, convertOrderToContract } from "../../services/sales/orderToContractService.js";
import { recordIdempotentResponse } from "../../middleware/idempotency.js";
import { computeLineTotals, computeDocumentTotals } from "../../services/sales/moneyService.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { authorizeOrgAccess } from "../../middleware/rbac.js";
import { pickWritable } from "../../utils/pickWritable.js";

const MAX_PAGE_SIZE = 100;
const MAX_BULK_BATCH_SIZE = 200;

// Contract terms (header and lines) are editable only before the contract
// goes out for signature; after that the only changes are signatures,
// renewal, expiry, termination and notes.
const EDITABLE_STATUSES = ["Draft", "Pending Internal Review"];

// The only header fields a client may write (see pickWritable). Status,
// signatures, activation, termination and amendment history change only
// through their own endpoints.
const WRITABLE_FIELDS = [
  "contractType", "companyId", "contactId", "dealId", "ownerMembershipId", "renewalOwnerMembershipId", "assignedTeam", "currency",
  "effectiveDate", "endDate", "termMonths", "renewalType", "renewalNoticeDays", "paymentTerms", "billingSchedule", "billingContactId",
  "billingAddress", "internalNote", "customerNote",
];
// Notes stay editable for the life of the contract.
const ALWAYS_EDITABLE = ["internalNote", "customerNote", "ownerMembershipId", "renewalOwnerMembershipId", "assignedTeam"];
const OBLIGATION_FIELDS = ["title", "description", "ownerMembershipId", "dueDate"];

const pickContractFields = (body) =>
  pickWritable(body, WRITABLE_FIELDS, { dates: ["effectiveDate", "endDate"], numbers: ["termMonths", "renewalNoticeDays"] });

function scopeWhere(req) {
  return resolveCrmScopeWhere(req, "contracts", { ownerField: "ownerMembershipId" });
}

async function validateSameOrgRefs(organizationId, { companyId, contactId, billingContactId, dealId, ownerMembershipId, renewalOwnerMembershipId, lineItems }) {
  const member = (id) => prisma.organizationMembership.findFirst({ where: { id, organizationId, status: "Active" } });
  const checks = [
    [companyId, "companyId", () => prisma.company.findFirst({ where: { id: companyId, organizationId } })],
    [contactId, "contactId", () => prisma.contact.findFirst({ where: { id: contactId, organizationId } })],
    [billingContactId, "billingContactId", () => prisma.contact.findFirst({ where: { id: billingContactId, organizationId } })],
    [dealId, "dealId", () => prisma.deal.findFirst({ where: { id: dealId, organizationId } })],
    [ownerMembershipId, "ownerMembershipId", () => member(ownerMembershipId)],
    [renewalOwnerMembershipId, "renewalOwnerMembershipId", () => member(renewalOwnerMembershipId)],
  ];
  for (const [value, field, find] of checks) if (value && !(await find())) return { field };
  const catalogIds = [...new Set((Array.isArray(lineItems) ? lineItems : []).map((l) => l?.catalogItemId).filter(Boolean))];
  if (catalogIds.length && (await prisma.catalogItem.count({ where: { id: { in: catalogIds }, organizationId } })) !== catalogIds.length) return { field: "lineItems.catalogItemId" };
  return null;
}

function validateTerm({ effectiveDate, endDate }) {
  if (effectiveDate && endDate && new Date(endDate) < new Date(effectiveDate)) return "endDate cannot be before effectiveDate.";
  return null;
}

function lineItemData(l, index) {
  return {
    catalogItemId: l.catalogItemId || null, isCustomLine: !!l.isCustomLine, name: l.name, description: l.description, unit: l.unit || "Each",
    billingModel: l.billingModel || "One Time", billingInterval: l.billingInterval, quantity: l.quantity ?? 1,
    listPriceSnapshot: l.listPriceSnapshot ?? l.unitPrice ?? 0, priceBookIdUsed: l.priceBookIdUsed || null, priceBookPriceSnapshot: l.priceBookPriceSnapshot ?? null,
    unitPrice: l.unitPrice ?? 0, discountType: l.discountType, discountValue: l.discountValue, taxCategory: l.taxCategory || "Standard", order: index,
  };
}

// The contract's value is always the server-computed grand total of its lines.
async function replaceLinesAndValue(tx, contractId, lineItems, currency) {
  await tx.contractLineItem.deleteMany({ where: { contractId } });
  const data = lineItems.map(lineItemData);
  const results = data.map((l) => computeLineTotals({ quantity: l.quantity, unitPrice: l.unitPrice, discountType: l.discountType, discountValue: l.discountValue, taxCategory: l.taxCategory, currency }));
  if (data.length) {
    await tx.contractLineItem.createMany({ data: data.map((l, i) => ({ ...l, contractId, lineSubtotal: results[i].lineSubtotal, taxAmount: results[i].taxAmount, lineTotal: results[i].lineTotal })) });
  }
  return { contractValue: computeDocumentTotals(results, { currency }).grandTotal };
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

const withDetail = { lineItems: { orderBy: { order: "asc" } }, obligations: { orderBy: { dueDate: "asc" } }, renewalReviews: true };

async function loadContract(req, res, include) {
  const contract = await prisma.contract.findFirst({ where: { id: req.params.contractId, organizationId: req.organizationId, ...scopeWhere(req) }, include });
  if (!contract) res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Contract not found." });
  return contract;
}

async function audit(req, action, targetId, extra = {}, targetType = "Contract") {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action, targetType, targetId, result: "Success", ...extra });
}

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const where = buildListWhere(req);
  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({ where, include: withDetail, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.contract.count({ where }),
  ]);
  res.json({ contracts: toApi(contracts), total, page, pageSize });
}

export async function getOne(req, res) {
  const contract = await loadContract(req, res, withDetail);
  if (!contract) return;
  res.json({ contract: toApi(contract) });
}

export async function create(req, res) {
  const fields = pickContractFields(req.body);
  const lineItems = Array.isArray(req.body.lineItems) ? req.body.lineItems : [];
  const refError = await validateSameOrgRefs(req.organizationId, { ...fields, lineItems });
  if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: `${refError.field} must reference a record in this organization.` });
  const termError = validateTerm(fields);
  if (termError) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: termError });
  const currency = fields.currency || "USD";

  const contract = await prisma.$transaction(async (tx) => {
    const contractNumber = await nextDocumentNumber(tx, req.organizationId, "Contract");
    const created = await tx.contract.create({
      data: {
        ...fields, organizationId: req.organizationId, contractNumber, contractType: fields.contractType || "One-Time Agreement", currency, status: "Draft",
        renewalType: fields.renewalType || "Manual Renew", renewalNoticeDays: fields.renewalNoticeDays ?? 60,
        ownerMembershipId: fields.ownerMembershipId || req.membership?.id, createdByMembershipId: req.membership?.id, updatedByMembershipId: req.membership?.id,
      },
    });
    const value = await replaceLinesAndValue(tx, created.id, lineItems, currency);
    return tx.contract.update({ where: { id: created.id }, data: value, include: withDetail });
  });
  await audit(req, "sales.contract.created", contract.id);
  res.status(201).json({ contract: toApi(contract) });
}

export async function update(req, res) {
  const existing = await loadContract(req, res);
  if (!existing) return;
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "SALES_VERSION_CONFLICT", message: "This contract was updated by someone else. Refresh and try again." });
  }
  let rest = pickContractFields(req.body);
  const lineItems = Array.isArray(req.body.lineItems) ? req.body.lineItems : null;
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    // Past internal review the commercial terms are what the parties sign
    // (or signed) — only notes and ownership stay editable.
    const locked = Object.keys(rest).filter((f) => !ALWAYS_EDITABLE.includes(f));
    if (locked.length || lineItems) {
      return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: `Contract terms can't change once it is ${existing.status} — only notes and ownership can.` });
    }
    rest = Object.fromEntries(Object.entries(rest).filter(([f]) => ALWAYS_EDITABLE.includes(f)));
  }
  const refError = await validateSameOrgRefs(req.organizationId, { ...rest, lineItems });
  if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: `${refError.field} must reference a record in this organization.` });
  const termError = validateTerm({ effectiveDate: rest.effectiveDate ?? existing.effectiveDate, endDate: rest.endDate ?? existing.endDate });
  if (termError) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: termError });

  const contract = await prisma.$transaction(async (tx) => {
    const value = lineItems ? await replaceLinesAndValue(tx, existing.id, lineItems, rest.currency || existing.currency) : {};
    return tx.contract.update({ where: { id: existing.id }, data: { ...rest, ...value, updatedByMembershipId: req.membership?.id, version: { increment: 1 } }, include: withDetail });
  });
  await audit(req, "sales.contract.updated", contract.id);
  res.json({ contract: toApi(contract) });
}

async function transition(req, res, { from, to, auditAction, message, data = {}, includeReason = false }) {
  const existing = await loadContract(req, res);
  if (!existing) return;
  if (!from.includes(existing.status)) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message });
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { status: to, ...data, updatedByMembershipId: req.membership?.id, version: { increment: 1 } }, include: withDetail });
  await audit(req, auditAction, contract.id, { ...(includeReason ? { reason: req.body.reason } : {}), before: { status: existing.status }, after: { status: to } });
  res.json({ contract: toApi(contract) });
}

export const submit = (req, res) =>
  transition(req, res, { from: ["Draft"], to: "Pending Internal Review", auditAction: "sales.contract.submitted", message: "Only a Draft Contract can be submitted for review." });

// Approval means "cleared internal review, ready to send for signature" —
// a distinct, human-triggered step before any signature is collected.
export const approve = (req, res) =>
  transition(req, res, {
    from: ["Pending Internal Review"], to: "Sent for Signature", auditAction: "sales.contract.approved",
    message: "Only a Contract pending internal review can be sent for signature.",
    data: { sentForSignatureAt: req.body.sentAt ? new Date(req.body.sentAt) : new Date() },
  });

export async function recordSignature(req, res) {
  const { party, name, title, signedAt: signedAtInput } = req.body;
  if (!party || !["internal", "customer"].includes(party)) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "party must be 'internal' or 'customer'." });
  if (!name?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A signatory name is required." });
  const existing = await loadContract(req, res);
  if (!existing) return;
  if (existing.status !== "Sent for Signature") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Contract sent for signature can record a signature." });

  const signedAt = signedAtInput ? new Date(signedAtInput) : new Date();
  const data = party === "internal" ? { internalSignatoryName: name, internalSignatoryTitle: title || null, internalSignedAt: signedAt } : { customerSignatoryName: name, customerSignatoryTitle: title || null, customerSignedAt: signedAt };
  // Both parties signed → "Signed" (the operative in-force status the
  // frontend keys off). Activation stays a separate, explicit step.
  const otherSigned = party === "internal" ? existing.customerSignedAt : existing.internalSignedAt;
  if (otherSigned) { data.status = "Signed"; data.signedAt = new Date(); }

  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } }, include: withDetail });
  await audit(req, "sales.contract.signature_recorded", contract.id, { after: { party, fullyExecuted: !!otherSigned } });
  res.json({ contract: toApi(contract) });
}

// Activation is explicitly human-controlled and permission-gated — distinct
// from signature capture. Never called automatically anywhere.
export async function activate(req, res) {
  const existing = await loadContract(req, res);
  if (!existing) return;
  if (existing.status !== "Signed") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a fully Signed Contract can be activated." });
  if (existing.activationDate) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "This Contract has already been activated." });
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { activationDate: new Date(), activatedByMembershipId: req.membership?.id, version: { increment: 1 } }, include: withDetail });
  await audit(req, "sales.contract.activated", contract.id);
  await recordIdempotentResponse(req, 200, { contract: toApi(contract) });
  res.json({ contract: toApi(contract) });
}

// Direct renewal: extends a Signed contract's end date and records the
// change in its amendment history (the frontend's "Renew" action). The
// review workflow below is for renewals that need a decision first.
export async function renew(req, res) {
  const { newEndDate, note } = req.body;
  if (!newEndDate) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "newEndDate is required." });
  const existing = await loadContract(req, res);
  if (!existing) return;
  if (existing.status !== "Signed") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Signed Contract can be renewed." });
  if (existing.endDate && new Date(newEndDate) <= new Date(existing.endDate)) {
    return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "The new end date must be after the current end date." });
  }
  const history = Array.isArray(existing.amendmentHistory) ? existing.amendmentHistory : [];
  const entry = { at: new Date().toISOString(), actorMembershipId: req.membership?.id || null, note: note || "", previousEndDate: existing.endDate?.toISOString() || null, newEndDate: new Date(newEndDate).toISOString() };
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { endDate: new Date(newEndDate), amendmentHistory: [...history, entry], version: { increment: 1 } }, include: withDetail });
  await audit(req, "sales.contract.renewed", contract.id, { after: { newEndDate: entry.newEndDate } });
  res.json({ contract: toApi(contract) });
}

// A renewal review records a human decision on an upcoming renewal. The
// contract stays Signed while a review is open (the frontend has no
// separate "under review" status); at most one open review at a time.
export async function startRenewalReview(req, res) {
  const existing = await loadContract(req, res);
  if (!existing) return;
  if (existing.status !== "Signed") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Signed Contract can start a renewal review." });
  const open = await prisma.contractRenewalReview.findFirst({ where: { contractId: existing.id, decidedAt: null } });
  if (open) return res.status(409).json({ code: "SALES_DUPLICATE_CONFLICT", message: "This Contract already has an open renewal review." });
  const refError = await validateSameOrgRefs(req.organizationId, { renewalOwnerMembershipId: req.body.renewalOwnerMembershipId });
  if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: `${refError.field} must reference a record in this organization.` });

  const review = await prisma.contractRenewalReview.create({
    data: {
      contractId: existing.id, renewalOwnerMembershipId: req.body.renewalOwnerMembershipId || existing.ownerMembershipId, renewalNoticeDeadline: existing.endDate,
      proposedStartDate: req.body.proposedStartDate ? new Date(req.body.proposedStartDate) : null, proposedEndDate: req.body.proposedEndDate ? new Date(req.body.proposedEndDate) : null,
      proposedValue: req.body.proposedValue,
    },
  });
  await audit(req, "sales.contract.renewal_review_started", existing.id);
  res.status(201).json({ renewalReview: toApi(review) });
}

export async function decideRenewal(req, res) {
  const { decision, decisionReason } = req.body;
  if (!["Renew", "Do Not Renew", "Renegotiate"].includes(decision)) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "decision must be Renew, Do Not Renew, or Renegotiate." });
  const contract = await loadContract(req, res);
  if (!contract) return;
  const review = await prisma.contractRenewalReview.findFirst({ where: { id: req.params.reviewId, contractId: contract.id } });
  if (!review) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Renewal review not found." });
  if (review.decidedAt) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "This renewal review has already been decided." });

  // "Renew" records the human decision only — extending the contract is
  // the separate /renew action.
  const updated = await prisma.contractRenewalReview.update({ where: { id: review.id }, data: { decision, decisionReason, decidedByMembershipId: req.membership?.id, decidedAt: new Date() } });
  await audit(req, "sales.contract.renewal_decided", review.id, { after: { decision } }, "ContractRenewalReview");
  res.json({ renewalReview: toApi(updated) });
}

export const expire = (req, res) =>
  transition(req, res, { from: ["Signed"], to: "Expired", auditAction: "sales.contract.expired", message: "Only a Signed Contract can expire." });

export async function terminate(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A termination reason is required." });
  return transition(req, res, {
    from: ["Signed"], to: "Terminated", auditAction: "sales.contract.terminated", includeReason: true,
    message: "Only a Signed Contract can be terminated (cancel one that isn't signed yet).",
    data: { terminationReason: req.body.reason, terminationEffectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : new Date() },
  });
}

export async function cancel(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A cancellation reason is required." });
  return transition(req, res, {
    from: ["Draft", "Pending Internal Review", "Sent for Signature"], to: "Cancelled", auditAction: "sales.contract.cancelled", includeReason: true,
    message: "Only a Draft, Pending Internal Review, or Sent-for-Signature Contract can be cancelled.",
    data: { cancellationReason: req.body.reason },
  });
}

export async function archive(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to archive a Contract." });
  const existing = await loadContract(req, res);
  if (!existing) return;
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), archivedByMembershipId: req.membership?.id, statusBeforeArchive: existing.status, version: { increment: 1 } }, include: withDetail });
  await audit(req, "sales.contract.archived", contract.id, { reason: req.body.reason });
  res.json({ contract: toApi(contract) });
}

export async function restore(req, res) {
  const existing = await loadContract(req, res);
  if (!existing) return;
  const contract = await prisma.contract.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, archivedAt: null, archivedByMembershipId: null, status: existing.statusBeforeArchive || existing.status, statusBeforeArchive: null, version: { increment: 1 } }, include: withDetail });
  await audit(req, "sales.contract.restored", contract.id);
  res.json({ contract: toApi(contract) });
}

export async function bulk(req, res) {
  const { action, ids, reason, ownerMembershipId } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "ids must be a non-empty array." });
  if (ids.length > MAX_BULK_BATCH_SIZE) return res.status(400).json({ code: "SALES_BATCH_LIMIT_EXCEEDED", message: `A bulk operation may include at most ${MAX_BULK_BATCH_SIZE} records.` });

  const authorized = await prisma.contract.findMany({ where: { id: { in: ids }, organizationId: req.organizationId, ...scopeWhere(req) } });
  let targets = authorized;
  if (action === "assign") {
    if (!ownerMembershipId || (await validateSameOrgRefs(req.organizationId, { ownerMembershipId }))) {
      return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
    }
    await prisma.contract.updateMany({ where: { id: { in: targets.map((c) => c.id) } }, data: { ownerMembershipId, updatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  } else if (action === "archive") {
    if (!reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required for bulk archive." });
    if (!req.isSystemOwnerOverride && !(await authorizeOrgAccess(req.user, req.organizationId, "contracts", "archive")).ok) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not have permission to archive contracts." });
    }
    targets = authorized.filter((c) => !c.archived);
    await prisma.$transaction(targets.map((c) => prisma.contract.update({
      where: { id: c.id },
      data: { archived: true, archiveReason: reason, archivedAt: new Date(), archivedByMembershipId: req.membership?.id, statusBeforeArchive: c.status, version: { increment: 1 } },
    })));
  } else {
    return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: `Unsupported bulk action "${action}".` });
  }
  await audit(req, `sales.contract.bulk_${action}`, null, { reason, after: { affectedCount: targets.length, requestedCount: ids.length } });
  res.json({ affected: targets.length, requested: ids.length, skipped: ids.length - targets.length });
}

// --- Obligations ---

async function loadObligation(req, res) {
  const contract = await loadContract(req, res);
  if (!contract) return null;
  const obligation = await prisma.contractObligation.findFirst({ where: { id: req.params.obligationId, contractId: contract.id } });
  if (!obligation) res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Obligation not found." });
  return obligation;
}

const pickObligationFields = (body) => pickWritable(body, OBLIGATION_FIELDS, { dates: ["dueDate"] });

export async function listObligations(req, res) {
  const contract = await loadContract(req, res);
  if (!contract) return;
  const obligations = await prisma.contractObligation.findMany({ where: { contractId: contract.id }, orderBy: { dueDate: "asc" } });
  res.json({ obligations: toApi(obligations) });
}

export async function createObligation(req, res) {
  const contract = await loadContract(req, res);
  if (!contract) return;
  const fields = pickObligationFields(req.body);
  if (!fields.title?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "title is required." });
  if (await validateSameOrgRefs(req.organizationId, { ownerMembershipId: fields.ownerMembershipId })) {
    return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  }
  const obligation = await prisma.contractObligation.create({ data: { ...fields, contractId: contract.id, organizationId: req.organizationId, status: "Open" } });
  await audit(req, "sales.contract.obligation_created", obligation.id, {}, "ContractObligation");
  res.status(201).json({ obligation: toApi(obligation) });
}

export async function updateObligation(req, res) {
  const existing = await loadObligation(req, res);
  if (!existing) return;
  if (existing.status !== "Open") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: `A ${existing.status} obligation can't be edited.` });
  const fields = pickObligationFields(req.body);
  if (await validateSameOrgRefs(req.organizationId, { ownerMembershipId: fields.ownerMembershipId })) {
    return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  }
  const obligation = await prisma.contractObligation.update({ where: { id: existing.id }, data: { ...fields, version: { increment: 1 } } });
  res.json({ obligation: toApi(obligation) });
}

export async function completeObligation(req, res) {
  const existing = await loadObligation(req, res);
  if (!existing) return;
  if (existing.status !== "Open") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: `This obligation is already ${existing.status}.` });
  const obligation = await prisma.contractObligation.update({ where: { id: existing.id }, data: { status: "Completed", completedDate: new Date(), completedByMembershipId: req.membership?.id, evidenceNote: req.body.evidenceNote, version: { increment: 1 } } });
  await audit(req, "sales.contract.obligation_completed", obligation.id, {}, "ContractObligation");
  res.json({ obligation: toApi(obligation) });
}

export async function waiveObligation(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to waive an obligation." });
  const existing = await loadObligation(req, res);
  if (!existing) return;
  if (existing.status !== "Open") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: `This obligation is already ${existing.status}.` });
  const obligation = await prisma.contractObligation.update({ where: { id: existing.id }, data: { status: "Waived", waiveReason: req.body.reason, version: { increment: 1 } } });
  await audit(req, "sales.contract.obligation_waived", obligation.id, { reason: req.body.reason }, "ContractObligation");
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
