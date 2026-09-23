import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { computeLineTotals, computeDocumentTotals } from "../../services/sales/moneyService.js";
import { requiresApproval, canDecide } from "../../services/sales/quoteApprovalService.js";
import { pickWritable } from "../../utils/pickWritable.js";

const MAX_PAGE_SIZE = 100;

// The only header fields a client may write on create/update (see
// pickWritable). Status, approval, acceptance and totals only change
// through the workflow endpoints and the server-side calculation.
const WRITABLE_FIELDS = [
  "title", "companyId", "primaryContactId", "dealId", "priceBookId", "ownerMembershipId", "assignedTeam", "currency",
  "validUntilDate", "paymentTerms", "billingSchedule", "customerNote", "internalNote", "issueDate", "overallDiscountType",
  "serviceStartEstimate", "minimumCommitment", "termsAndConditions", "assumptions", "documentLayout",
];
function pickQuoteFields(body) {
  const fields = pickWritable(body, WRITABLE_FIELDS, { dates: ["validUntilDate", "issueDate"] });
  // Prisma needs Prisma.JsonNull, not null, to clear a Json column — an
  // empty layout just leaves the current one in place.
  if (fields.documentLayout === null) delete fields.documentLayout;
  return fields;
}

// Statuses from which nothing further can happen to the quote itself.
const CLOSED_STATUSES = ["Cancelled", "Superseded", "Preview Accepted"];
// Statuses a Quote may still be freely edited/expired FROM — anything past
// this (Preview Accepted/Rejected/Cancelled/Superseded) is a closed record;
// only a new version can change its commercial terms.
const EXPIRABLE_STATUSES = ["Draft", "Internal Review", "Approval Pending", "Approved", "Preview Sent", "Preview Viewed"];

function scopeWhere(req) {
  return resolveCrmScopeWhere(req, "quotes", { ownerField: "ownerMembershipId" });
}

// A Quote is "Expired" purely by comparing validUntilDate to now — never
// stored, matching the frontend's own getEffectiveStatus() derivation.
// Terminal preview states (Accepted/Rejected/Cancelled/Superseded) pass
// through unchanged even past the date.
function effectiveStatus(quote) {
  if (!EXPIRABLE_STATUSES.includes(quote.status)) return quote.status;
  if (quote.validUntilDate && new Date(quote.validUntilDate) < new Date()) return "Expired";
  return quote.status;
}

function withEffectiveStatus(quote) {
  return { ...quote, effectiveStatus: effectiveStatus(quote) };
}

async function computeAndPersistTotals(tx, quoteId, currency) {
  const lineItems = await tx.quoteLineItem.findMany({ where: { quoteId } });
  const lineResults = lineItems.map((l) => computeLineTotals({ quantity: l.quantity, unitPrice: l.unitPrice, discountType: l.discountType, discountValue: l.discountValue, taxCategory: l.taxCategory, currency }));
  await Promise.all(lineItems.map((l, i) => tx.quoteLineItem.update({ where: { id: l.id }, data: { lineSubtotal: lineResults[i].lineSubtotal, taxAmount: lineResults[i].taxAmount, lineTotal: lineResults[i].lineTotal } })));
  const totals = computeDocumentTotals(lineResults, { currency });
  return tx.quote.update({ where: { id: quoteId }, data: totals });
}

function buildListWhere(req) {
  const q = req.query;
  const where = { organizationId: req.organizationId, ...scopeWhere(req) };
  where.archived = q.archived === "true";
  if (q.search) where.OR = [{ quoteNumber: { contains: q.search, mode: "insensitive" } }, { title: { contains: q.search, mode: "insensitive" } }];
  if (q.status) where.status = q.status;
  if (q.dealId) where.dealId = q.dealId;
  if (q.companyId) where.companyId = q.companyId;
  return where;
}

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const where = buildListWhere(req);
  const [quotes, total] = await Promise.all([
    prisma.quote.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.quote.count({ where }),
  ]);
  res.json({ quotes: toApi(quotes.map(withEffectiveStatus)), total, page, pageSize });
}

export async function getOne(req, res) {
  const quote = await prisma.quote.findFirst({ where: { id: req.params.quoteId, organizationId: req.organizationId, ...scopeWhere(req) }, include: { lineItems: true, approvals: true } });
  if (!quote) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Quote not found." });
  res.json({ quote: toApi(withEffectiveStatus(quote)) });
}

async function validateSameOrgRefs(organizationId, { companyId, primaryContactId, dealId, priceBookId, ownerMembershipId, lineItems }) {
  // Every catalog item and price book a line references must be this
  // organization's too — line items are the easiest place to smuggle in a
  // foreign record, since they arrive as a nested array.
  const lines = Array.isArray(lineItems) ? lineItems : [];
  const catalogIds = [...new Set(lines.map((l) => l?.catalogItemId).filter(Boolean))];
  if (catalogIds.length && (await prisma.catalogItem.count({ where: { id: { in: catalogIds }, organizationId } })) !== catalogIds.length) return { field: "lineItems.catalogItemId" };
  const bookIds = [...new Set(lines.map((l) => l?.priceBookIdUsed).filter(Boolean))];
  if (bookIds.length && (await prisma.priceBook.count({ where: { id: { in: bookIds }, organizationId } })) !== bookIds.length) return { field: "lineItems.priceBookIdUsed" };
  if (ownerMembershipId) { const m = await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId, status: "Active" } }); if (!m) return { field: "ownerMembershipId" }; }
  if (companyId) { const c = await prisma.company.findFirst({ where: { id: companyId, organizationId } }); if (!c) return { field: "companyId" }; }
  if (primaryContactId) { const c = await prisma.contact.findFirst({ where: { id: primaryContactId, organizationId } }); if (!c) return { field: "primaryContactId" }; }
  if (dealId) { const d = await prisma.deal.findFirst({ where: { id: dealId, organizationId } }); if (!d) return { field: "dealId" }; }
  if (priceBookId) { const p = await prisma.priceBook.findFirst({ where: { id: priceBookId, organizationId } }); if (!p) return { field: "priceBookId" }; }
  return null;
}

export async function create(req, res) {
  const fields = pickQuoteFields(req.body);
  const lineItems = Array.isArray(req.body.lineItems) ? req.body.lineItems : [];
  const currency = fields.currency || "USD";
  const refError = await validateSameOrgRefs(req.organizationId, { ...fields, lineItems });
  if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: `${refError.field} must reference a record in this organization.` });

  const quote = await prisma.$transaction(async (tx) => {
    const quoteNumber = await nextDocumentNumber(tx, req.organizationId, "Quote");
    const created = await tx.quote.create({
      data: {
        ...fields, organizationId: req.organizationId, quoteNumber, version: 1, status: "Draft", currency,
        ownerMembershipId: fields.ownerMembershipId || req.membership?.id, createdByMembershipId: req.membership?.id, updatedByMembershipId: req.membership?.id,
        lineItems: { create: lineItems.map((l, i) => ({ ...lineItemCreateData(l), order: i })) },
      },
    });
    return computeAndPersistTotals(tx, created.id, currency);
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.quote.created", targetType: "Quote", targetId: quote.id, result: "Success" });
  res.status(201).json({ quote: toApi(withEffectiveStatus(quote)) });
}

function lineItemCreateData(l) {
  return {
    catalogItemId: l.catalogItemId || null, priceBookIdUsed: l.priceBookIdUsed || null, isCustomLine: !!l.isCustomLine, included: l.included !== false,
    name: l.name, description: l.description, unit: l.unit || "Each", billingModel: l.billingModel || "One Time", billingInterval: l.billingInterval,
    quantity: l.quantity ?? 1, listPrice: l.listPrice ?? l.unitPrice ?? 0, priceBookPrice: l.priceBookPrice ?? null, unitPrice: l.unitPrice ?? 0,
    discountType: l.discountType, discountValue: l.discountValue, taxCategory: l.taxCategory || "Standard", skuSnapshot: l.sku ?? l.skuSnapshot,
    isOverridden: !!l.isOverridden, overrideReason: l.overrideReason, sectionTitle: l.sectionTitle || null,
  };
}

export async function update(req, res) {
  const existing = await prisma.quote.findFirst({ where: { id: req.params.quoteId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Quote not found." });
  if (existing.status !== "Draft") {
    return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Draft Quote can be edited directly — create a new version for a non-Draft Quote." });
  }
  if (req.body.rowVersion !== undefined && Number(req.body.rowVersion) !== existing.rowVersion) {
    return res.status(409).json({ code: "SALES_VERSION_CONFLICT", message: "This quote was updated by someone else. Refresh and try again." });
  }
  const rest = pickQuoteFields(req.body);
  const lineItems = Array.isArray(req.body.lineItems) ? req.body.lineItems : null;
  const refError = await validateSameOrgRefs(req.organizationId, { ...rest, lineItems });
  if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: `${refError.field} must reference a record in this organization.` });

  const quote = await prisma.$transaction(async (tx) => {
    if (lineItems) {
      await tx.quoteLineItem.deleteMany({ where: { quoteId: existing.id } });
      await tx.quoteLineItem.createMany({ data: lineItems.map((l, i) => ({ ...lineItemCreateData(l), order: i, quoteId: existing.id })) });
    }
    await tx.quote.update({ where: { id: existing.id }, data: { ...rest, updatedByMembershipId: req.membership?.id, rowVersion: { increment: 1 } } });
    return computeAndPersistTotals(tx, existing.id, rest.currency || existing.currency);
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.quote.updated", targetType: "Quote", targetId: quote.id, result: "Success" });
  res.json({ quote: toApi(withEffectiveStatus(quote)) });
}

// --- Status transitions ---

async function loadQuote(req, res) {
  const quote = await prisma.quote.findFirst({ where: { id: req.params.quoteId, organizationId: req.organizationId, ...scopeWhere(req) }, include: { lineItems: true } });
  if (!quote) { res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Quote not found." }); return null; }
  return quote;
}

export async function submit(req, res) {
  const quote = await loadQuote(req, res);
  if (!quote) return;
  if (quote.status !== "Draft") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Draft Quote can be submitted for review." });
  // An approval request records who asked, so the requester can never
  // decide it — that needs a membership in this organization.
  if (!req.membership?.id) return res.status(403).json({ code: "SALES_MEMBERSHIP_REQUIRED", message: "Join this organization to submit its quotes for review." });

  const { required, reasons } = requiresApproval(quote, quote.lineItems);
  const nextStatus = required ? "Approval Pending" : "Internal Review";

  const updated = await prisma.$transaction(async (tx) => {
    if (required) {
      await tx.salesApproval.create({
        data: { organizationId: req.organizationId, resourceType: "Quote", resourceId: quote.id, quoteId: quote.id, requestedByMembershipId: req.membership?.id, reason: reasons.join(" "), snapshot: { grandTotal: quote.grandTotal ? Number(quote.grandTotal) : null, currency: quote.currency } },
      });
    }
    return tx.quote.update({ where: { id: quote.id }, data: { status: nextStatus, rowVersion: { increment: 1 } } });
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.quote.submitted", targetType: "Quote", targetId: quote.id, result: "Success", after: { status: nextStatus, approvalRequired: required } });
  res.json({ quote: toApi(withEffectiveStatus(updated)) });
}

export async function approve(req, res) {
  const quote = await loadQuote(req, res);
  if (!quote) return;
  if (quote.status !== "Approval Pending") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Quote pending approval can be approved." });

  const approval = await prisma.salesApproval.findFirst({ where: { quoteId: quote.id, status: "Pending" }, orderBy: { requestedAt: "desc" } });
  if (!approval) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "No pending approval request found for this quote." });
  if (!canDecide(approval, req.membership?.id)) return res.status(403).json({ code: "SALES_SELF_APPROVAL_FORBIDDEN", message: "You cannot approve your own submitted Quote." });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.salesApproval.update({ where: { id: approval.id }, data: { status: "Approved", decidedByMembershipId: req.membership?.id, decisionReason: req.body.reason, decidedAt: new Date() } });
    return tx.quote.update({ where: { id: quote.id }, data: { status: "Approved", approvedByMembershipId: req.membership?.id, approvedAt: new Date(), rowVersion: { increment: 1 } } });
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.quote.approved", targetType: "Quote", targetId: quote.id, result: "Success" });
  res.json({ quote: toApi(withEffectiveStatus(updated)) });
}

// Sends a quote under review back to Draft. `changesRequested: true` records
// the reviewer's decision as "Changes Requested" rather than "Rejected" —
// same transition, different meaning in the approval history.
export async function reject(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to reject a Quote." });
  const decision = req.body.changesRequested ? "Changes Requested" : "Rejected";
  const quote = await loadQuote(req, res);
  if (!quote) return;
  if (!["Approval Pending", "Internal Review"].includes(quote.status)) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Quote under review can be rejected." });

  const approval = await prisma.salesApproval.findFirst({ where: { quoteId: quote.id, status: "Pending" }, orderBy: { requestedAt: "desc" } });
  const updated = await prisma.$transaction(async (tx) => {
    if (approval) {
      if (!canDecide(approval, req.membership?.id)) throw Object.assign(new Error("self-approval"), { code: "SELF" });
      await tx.salesApproval.update({ where: { id: approval.id }, data: { status: decision, decidedByMembershipId: req.membership?.id, decisionReason: req.body.reason, decidedAt: new Date() } });
    }
    return tx.quote.update({ where: { id: quote.id }, data: { status: "Draft", rejectedAt: new Date(), rejectionReason: req.body.reason, rowVersion: { increment: 1 } } });
  }).catch((err) => { if (err.code === "SELF") return null; throw err; });
  if (!updated) return res.status(403).json({ code: "SALES_SELF_APPROVAL_FORBIDDEN", message: "You cannot reject your own submitted Quote." });

  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: req.body.changesRequested ? "sales.quote.changes_requested" : "sales.quote.rejected", targetType: "Quote", targetId: quote.id, result: "Success", reason: req.body.reason });
  res.json({ quote: toApi(withEffectiveStatus(updated)) });
}

// "Issue" means the Quote was formally marked ready/delivered outside the
// system — this never sends a real email.
export async function issue(req, res) {
  const quote = await loadQuote(req, res);
  if (!quote) return;
  // "Approved" covers the required-approval path; "Internal Review" covers
  // a Quote that was submitted but never required approval in the first
  // place (submit() only routes to "Approval Pending" when a trigger
  // fires) — never straight from "Draft", which must go through /submit.
  if (!["Approved", "Internal Review"].includes(quote.status)) {
    return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "A Quote must be submitted, and Approved if required, before it can be issued." });
  }
  // Recipient/subject/message are recorded for reference only — nothing is emailed.
  const { recipientEmail, cc, subject, message } = req.body;
  const sendPreview = recipientEmail ? { recipientEmail, cc: cc || "", subject: subject || "", message: message || "", sentAt: new Date().toISOString() } : undefined;
  const updated = await prisma.quote.update({ where: { id: quote.id }, data: { status: "Preview Sent", ...(sendPreview ? { sendPreview } : {}), rowVersion: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.quote.issued", targetType: "Quote", targetId: quote.id, result: "Success" });
  res.json({ quote: toApi(withEffectiveStatus(updated)) });
}

export async function accept(req, res) {
  const quote = await loadQuote(req, res);
  if (!quote) return;
  if (!["Preview Sent", "Preview Viewed"].includes(quote.status)) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only an issued Quote can be accepted." });
  const updated = await prisma.quote.update({ where: { id: quote.id }, data: { status: "Preview Accepted", acceptedAt: new Date(), customerResponse: customerResponseRecord("Accepted", req.body), rowVersion: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.quote.accepted", targetType: "Quote", targetId: quote.id, result: "Success" });
  res.json({ quote: toApi(withEffectiveStatus(updated)) });
}

export async function rejectByCustomer(req, res) {
  const quote = await loadQuote(req, res);
  if (!quote) return;
  if (!["Preview Sent", "Preview Viewed"].includes(quote.status)) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only an issued Quote can be rejected by the customer." });
  const updated = await prisma.quote.update({ where: { id: quote.id }, data: { status: "Preview Rejected", rejectedAt: new Date(), rejectionReason: req.body.reason, customerResponse: customerResponseRecord("Rejected", req.body), rowVersion: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.quote.rejected_by_customer", targetType: "Quote", targetId: quote.id, result: "Success" });
  res.json({ quote: toApi(withEffectiveStatus(updated)) });
}

function customerResponseRecord(type, body) {
  return {
    type, at: new Date().toISOString(), customerName: body.customerName || null, jobTitle: body.jobTitle || null,
    typedNamePreview: body.typedNamePreview || null, reason: body.reason || null,
  };
}

// The other two customer responses on an issued quote: "Viewed" (Preview
// Sent → Preview Viewed) and "Changes Requested" (back to Draft, reason
// required). Accept/reject have their own endpoints above.
export async function recordCustomerResponse(req, res) {
  const { type } = req.body;
  if (!["Viewed", "Changes Requested"].includes(type)) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: 'type must be "Viewed" or "Changes Requested".' });
  if (type === "Changes Requested" && !req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required when the customer requests changes." });
  const quote = await loadQuote(req, res);
  if (!quote) return;
  const allowedFrom = type === "Viewed" ? ["Preview Sent"] : ["Preview Sent", "Preview Viewed"];
  if (!allowedFrom.includes(quote.status)) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: `A "${type}" response needs an issued Quote.` });

  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data: { status: type === "Viewed" ? "Preview Viewed" : "Draft", customerResponse: customerResponseRecord(type, req.body), rowVersion: { increment: 1 } },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: type === "Viewed" ? "sales.quote.viewed" : "sales.quote.customer_changes_requested", targetType: "Quote", targetId: quote.id, result: "Success", reason: req.body.reason });
  res.json({ quote: toApi(withEffectiveStatus(updated)) });
}

export async function cancel(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to cancel a Quote." });
  const quote = await loadQuote(req, res);
  if (!quote) return;
  if (CLOSED_STATUSES.includes(quote.status)) {
    return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: `A ${quote.status} Quote can't be cancelled.` });
  }
  const updated = await prisma.quote.update({ where: { id: quote.id }, data: { status: "Cancelled", rowVersion: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.quote.cancelled", targetType: "Quote", targetId: quote.id, result: "Success", reason: req.body.reason });
  res.json({ quote: toApi(withEffectiveStatus(updated)) });
}

// A material change (new commercial terms) invalidates the previous
// approval and creates a new, read-only-once-superseded version — the old
// Quote's line items are never mutated in place once it has left Draft.
export async function newVersion(req, res) {
  const { changeSummary, lineItems } = req.body;
  if (!changeSummary?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A change summary is required to create a new version." });
  const previous = await prisma.quote.findFirst({ where: { id: req.params.quoteId, organizationId: req.organizationId, ...scopeWhere(req) }, include: { lineItems: true } });
  if (!previous) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Quote not found." });
  // Only the latest version can be revised — branching from a superseded
  // one would leave two "current" versions. A Draft is edited in place.
  if (previous.status === "Superseded") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "This version was already superseded — revise the latest version instead." });
  if (previous.status === "Draft") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "A Draft Quote is edited directly; new versions are for Quotes past Draft." });
  // The new version starts from the previous header, with any header
  // changes sent alongside the change summary applied on top.
  const headerChanges = pickQuoteFields(req.body);
  const header = Object.fromEntries(
    Object.entries({ ...Object.fromEntries(WRITABLE_FIELDS.map((f) => [f, previous[f]])), ...headerChanges }).filter(([, v]) => v !== null && v !== undefined),
  );
  const refError = await validateSameOrgRefs(req.organizationId, { ...headerChanges, lineItems });
  if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: `${refError.field} must reference a record in this organization.` });

  const { nextVersion, updatedPrevious } = await prisma.$transaction(async (tx) => {
    await tx.salesApproval.updateMany({ where: { quoteId: previous.id, status: "Pending" }, data: { status: "Rejected", decisionReason: "Invalidated by a new Quote version." } });
    const created = await tx.quote.create({
      data: {
        ...header, organizationId: req.organizationId, quoteNumber: previous.quoteNumber, rootId: previous.rootId || previous.id, version: previous.version + 1,
        status: "Draft", changeSummary, createdByMembershipId: req.membership?.id, updatedByMembershipId: req.membership?.id,
        lineItems: { create: (lineItems || previous.lineItems).map((l, i) => ({ ...lineItemCreateData(l), order: i })) },
      },
    });
    const updatedPrevious = await tx.quote.update({ where: { id: previous.id }, data: { status: "Superseded", supersededByQuoteId: created.id } });
    const nextVersion = await computeAndPersistTotals(tx, created.id, header.currency);
    return { nextVersion, updatedPrevious };
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.quote.new_version_created", targetType: "Quote", targetId: nextVersion.id, result: "Success", after: { previousQuoteId: previous.id, version: nextVersion.version } });
  res.status(201).json({ quote: toApi(withEffectiveStatus(nextVersion)), previous: toApi(withEffectiveStatus(updatedPrevious)) });
}

export async function archive(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to archive a Quote." });
  const existing = await prisma.quote.findFirst({ where: { id: req.params.quoteId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Quote not found." });
  const quote = await prisma.quote.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), statusBeforeArchive: existing.status, rowVersion: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.quote.archived", targetType: "Quote", targetId: quote.id, result: "Success" });
  res.json({ quote: toApi(withEffectiveStatus(quote)) });
}

export async function restore(req, res) {
  const existing = await prisma.quote.findFirst({ where: { id: req.params.quoteId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Quote not found." });
  const quote = await prisma.quote.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, archivedAt: null, status: existing.statusBeforeArchive || existing.status, statusBeforeArchive: null, rowVersion: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.quote.restored", targetType: "Quote", targetId: quote.id, result: "Success" });
  res.json({ quote: toApi(withEffectiveStatus(quote)) });
}

export async function bulk(req, res) {
  const { action, ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "ids must be a non-empty array." });
  if (ids.length > 200) return res.status(400).json({ code: "SALES_BATCH_LIMIT_EXCEEDED", message: "A bulk operation may include at most 200 records." });
  const authorized = await prisma.quote.findMany({ where: { id: { in: ids }, organizationId: req.organizationId, ...scopeWhere(req) } });
  const authorizedIds = authorized.map((q) => q.id);
  let data;
  if (action === "assign") {
    if (!req.body.ownerMembershipId) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "ownerMembershipId is required." });
    const ownerError = await validateSameOrgRefs(req.organizationId, { ownerMembershipId: req.body.ownerMembershipId });
    if (ownerError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
    data = { ownerMembershipId: req.body.ownerMembershipId };
  } else if (action === "archive") {
    if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required for bulk archive." });
    data = { archived: true, archiveReason: req.body.reason, archivedAt: new Date() };
  } else {
    return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: `Unsupported bulk action "${action}".` });
  }
  await prisma.quote.updateMany({ where: { id: { in: authorizedIds } }, data: { ...data, rowVersion: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: `sales.quote.bulk_${action}`, result: "Success", after: { affectedCount: authorizedIds.length, requestedCount: ids.length } });
  res.json({ affected: authorizedIds.length, requested: ids.length, skipped: ids.length - authorizedIds.length });
}
