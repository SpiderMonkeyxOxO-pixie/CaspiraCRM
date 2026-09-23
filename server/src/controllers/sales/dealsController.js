import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";
import { ensureDefaultPipelines } from "../../services/sales/pipelineSeedService.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { validateTransition, validateReopen, statusForClassification } from "../../services/sales/dealTransitionService.js";
import { computeDealRiskReasons } from "../../services/sales/dealRiskService.js";
import { computeLineTotals } from "../../services/sales/moneyService.js";
import { pickWritable } from "../../utils/pickWritable.js";

const MAX_PAGE_SIZE = 100;
const MAX_BULK_BATCH_SIZE = 200;

// The only fields a client may write through create/update (see
// pickWritable). Stage, status and pipeline only change through the
// transition endpoints; close/loss reasons are set by those endpoints too.
const WRITABLE_FIELDS = [
  "name", "dealType", "source", "companyId", "primaryContactId", "additionalContactIds", "contactRoles", "ownerMembershipId",
  "assignedTeam", "currency", "value", "expectedClosingDate", "billingFrequency", "priority", "dealHealth", "healthReason",
  "nextAction", "competitors", "forecastCategory", "tags", "internalNote", "lossCompetitor", "onHoldReviewDate",
  "handoffOwnerMembershipId", "description",
];
const pickDealFields = (body) =>
  pickWritable(body, WRITABLE_FIELDS, { dates: ["expectedClosingDate", "onHoldReviewDate"], numbers: ["value"] });

// Quotes raised against a deal, summarized for the deal's Quotes tab.
const QUOTE_SUMMARY_INCLUDE = {
  quotes: { select: { id: true, quoteNumber: true, version: true, status: true, grandTotal: true, currency: true, validUntilDate: true, createdAt: true }, orderBy: { createdAt: "asc" } },
};

function scopeWhere(req) {
  return resolveCrmScopeWhere(req, "deals", { ownerField: "ownerMembershipId" });
}

function canViewFinancial(req) {
  if (req.isSystemOwnerOverride) return true;
  return (req.membership?.roles || []).some((mr) => (mr.role.permissionGrants || []).some((g) => g.moduleId === "deals" && g.actions.includes("view_financial_fields")));
}

// Deal margin (value vs. line-item cost) is a sensitive figure — never
// leaked to a caller without the view_financial_fields grant, mirroring
// Phase 2's maskSensitive()/maskFinancial() pattern exactly.
function maskFinancial(deal, req) {
  if (canViewFinancial(req)) return deal;
  const { value, ...rest } = deal;
  return { ...rest, financialFieldsRedacted: true };
}

async function validateSameOrgRefs(organizationId, { companyId, primaryContactId, ownerMembershipId, handoffOwnerMembershipId, pipelineId, pipelineStageId, additionalContactIds, contactRoles }) {
  // Every contact the deal references — additional contacts and role
  // entries included — must belong to this organization.
  const contactIds = [...new Set([...(Array.isArray(additionalContactIds) ? additionalContactIds : []), ...(Array.isArray(contactRoles) ? contactRoles.map((r) => r?.contactId) : [])].filter(Boolean))];
  if (contactIds.length > 0) {
    const found = await prisma.contact.count({ where: { id: { in: contactIds }, organizationId } });
    if (found !== contactIds.length) return { field: "additionalContactIds" };
  }
  if (handoffOwnerMembershipId) {
    const m = await prisma.organizationMembership.findFirst({ where: { id: handoffOwnerMembershipId, organizationId, status: "Active" } });
    if (!m) return { field: "handoffOwnerMembershipId" };
  }
  if (companyId) {
    const c = await prisma.company.findFirst({ where: { id: companyId, organizationId } });
    if (!c) return { field: "companyId" };
  }
  if (primaryContactId) {
    const c = await prisma.contact.findFirst({ where: { id: primaryContactId, organizationId } });
    if (!c) return { field: "primaryContactId" };
  }
  if (ownerMembershipId) {
    const m = await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId, status: "Active" } });
    if (!m) return { field: "ownerMembershipId" };
  }
  if (pipelineId) {
    const p = await prisma.pipeline.findFirst({ where: { id: pipelineId, organizationId } });
    if (!p) return { field: "pipelineId" };
  }
  if (pipelineStageId) {
    const s = await prisma.pipelineStage.findFirst({ where: { id: pipelineStageId, organizationId, ...(pipelineId ? { pipelineId } : {}) } });
    if (!s) return { field: "pipelineStageId" };
  }
  return null;
}

function buildListWhere(req) {
  const q = req.query;
  const where = { organizationId: req.organizationId, ...scopeWhere(req) };
  where.archived = q.archived === "true";
  if (q.search) where.OR = [{ name: { contains: q.search, mode: "insensitive" } }, { dealNumber: { contains: q.search, mode: "insensitive" } }];
  if (q.pipelineId) where.pipelineId = q.pipelineId;
  if (q.pipelineStageId) where.pipelineStageId = q.pipelineStageId;
  if (q.status) where.status = q.status;
  if (q.ownerMembershipId === "unassigned") where.ownerMembershipId = null;
  else if (q.ownerMembershipId) where.ownerMembershipId = q.ownerMembershipId;
  if (q.companyId) where.companyId = q.companyId;
  if (q.closingFrom || q.closingTo) {
    where.expectedClosingDate = {};
    if (q.closingFrom) where.expectedClosingDate.gte = new Date(q.closingFrom);
    if (q.closingTo) where.expectedClosingDate.lte = new Date(q.closingTo);
  }
  if (q.noNextAction === "true") where.nextAction = null;
  if (q.passedExpectedClose === "true") { where.status = "Open"; where.expectedClosingDate = { lt: new Date() }; }
  return where;
}

export async function list(req, res) {
  await ensureDefaultPipelines(req.organizationId, req.membership?.id);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const where = buildListWhere(req);

  const [deals, total] = await Promise.all([
    prisma.deal.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: { pipelineStage: true } }),
    prisma.deal.count({ where }),
  ]);
  res.json({ deals: toApi(deals.map((d) => maskFinancial(d, req))), total, page, pageSize });
}

export async function getOne(req, res) {
  const deal = await prisma.deal.findFirst({
    where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) },
    include: { pipelineRef: true, pipelineStage: true, lineItems: { orderBy: { displayOrder: "asc" } }, ...QUOTE_SUMMARY_INCLUDE },
  });
  if (!deal) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  res.json({ deal: toApi(maskFinancial(deal, req)) });
}

export async function create(req, res) {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "name is required." });
  if (req.body.value !== undefined && Number(req.body.value) < 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "value cannot be negative." });

  await ensureDefaultPipelines(req.organizationId, req.membership?.id);

  let { pipelineId, pipelineStageId } = req.body;
  if (!pipelineId) {
    const defaultPipeline = await prisma.pipeline.findFirst({ where: { organizationId: req.organizationId, isDefault: true, archivedAt: null } });
    pipelineId = defaultPipeline?.id;
  }
  if (pipelineId && !pipelineStageId) {
    const firstStage = await prisma.pipelineStage.findFirst({ where: { pipelineId, classification: "Open" }, orderBy: { displayOrder: "asc" } });
    pipelineStageId = firstStage?.id;
  }

  const fields = pickDealFields(req.body);
  const refError = await validateSameOrgRefs(req.organizationId, { ...fields, pipelineId, pipelineStageId });
  if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: `${refError.field} must reference a record in this organization.` });

  const stage = pipelineStageId ? await prisma.pipelineStage.findUnique({ where: { id: pipelineStageId } }) : null;
  // A new deal may start in any Open stage, never directly Won/Lost/etc. —
  // those outcomes carry their own required fields and go through /transition.
  if (stage && stage.classification !== "Open") {
    return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "A new Deal must start in an open Stage." });
  }

  const deal = await prisma.$transaction(async (tx) => {
    const dealNumber = await nextDocumentNumber(tx, req.organizationId, "Deal");
    return tx.deal.create({
      data: {
        ...fields, organizationId: req.organizationId, dealNumber, name: name.trim(), stage: stage?.name || "Discovery", status: statusForClassification(stage?.classification || "Open"),
        pipelineId, pipelineStageId, probability: stage?.probability ?? 0,
        ownerMembershipId: fields.ownerMembershipId || req.membership?.id, currency: fields.currency || "USD", value: fields.value ?? 0,
        tags: fields.tags || [], additionalContactIds: fields.additionalContactIds || [], contactRoles: fields.contactRoles || [],
        createdByMembershipId: req.membership?.id, updatedByMembershipId: req.membership?.id,
      },
    });
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.deal.created", targetType: "Deal", targetId: deal.id, result: "Success" });
  res.status(201).json({ deal: toApi(maskFinancial(deal, req)) });
}

export async function update(req, res) {
  const existing = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  if (existing.archived) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "An archived Deal cannot be edited — restore it first." });
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "SALES_VERSION_CONFLICT", message: "This Deal was updated by someone else. Refresh and try again." });
  }
  // Stage/status/pipeline changes ONLY go through /transition, /mark-won,
  // /mark-lost, /reopen — never silently through ordinary update. A closed
  // Deal cannot be edited back to Open this way either.
  if (["stage", "status", "pipelineId", "pipelineStageId"].some((f) => f in req.body)) {
    return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Use /transition, /mark-won, /mark-lost, or /reopen to change a Deal's Stage or status." });
  }
  if (req.body.value !== undefined && Number(req.body.value) < 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "value cannot be negative." });

  const rest = pickDealFields(req.body);
  const refError = await validateSameOrgRefs(req.organizationId, rest);
  if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: `${refError.field} must reference a record in this organization.` });

  const deal = await prisma.deal.update({ where: { id: existing.id }, data: { ...rest, updatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.deal.updated", targetType: "Deal", targetId: deal.id, result: "Success", before: toApi(existing), after: toApi(deal) });
  res.json({ deal: toApi(maskFinancial(deal, req)) });
}

export async function assign(req, res) {
  const { ownerMembershipId } = req.body;
  if (!ownerMembershipId) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "ownerMembershipId is required." });
  const membership = await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
  if (!membership) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  const existing = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });

  const deal = await prisma.deal.update({ where: { id: existing.id }, data: { ownerMembershipId, updatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.deal.assigned", targetType: "Deal", targetId: deal.id, result: "Success", after: { ownerMembershipId } });
  res.json({ deal: toApi(maskFinancial(deal, req)) });
}

async function loadStageContext(organizationId, existing, body) {
  const fromStage = existing.pipelineStageId ? await prisma.pipelineStage.findUnique({ where: { id: existing.pipelineStageId } }) : null;
  const toPipelineId = body.pipelineId || existing.pipelineId;
  const toPipeline = toPipelineId ? await prisma.pipeline.findFirst({ where: { id: toPipelineId, organizationId } }) : null;
  const toStage = body.pipelineStageId ? await prisma.pipelineStage.findFirst({ where: { id: body.pipelineStageId, organizationId, pipelineId: toPipelineId } }) : fromStage;
  return { fromStage, toStage, toPipeline };
}

async function writeStageHistory(tx, { deal, fromStage, toStage, membershipId, reason, correlationId }) {
  const timeInPreviousStage = deal.updatedAt ? Math.round((Date.now() - new Date(deal.updatedAt).getTime()) / 1000) : null;
  await tx.dealStageHistory.create({
    data: {
      dealId: deal.id, organizationId: deal.organizationId,
      fromStageId: fromStage?.id, fromStageName: fromStage?.name, fromProbability: fromStage?.probability,
      toStageId: toStage?.id, toStageName: toStage?.name, toProbability: toStage?.probability,
      changedByMembershipId: membershipId, reason, timeInPreviousStageSeconds: timeInPreviousStage, correlationId,
    },
  });
}

async function performTransition(req, res, { toStage, toPipeline, reason, actualClosingDate }) {
  const existing = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return { error: res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." }) };
  if (existing.archived) return { error: res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "An archived Deal cannot be transitioned — restore it first." }) };

  const { fromStage } = await loadStageContext(req.organizationId, existing, {});
  const errors = validateTransition({ deal: existing, fromStage, toStage, toPipeline, reason, actualClosingDate });
  if (errors.length > 0) return { error: res.status(400).json(errors[0]) };

  const deal = await prisma.$transaction(async (tx) => {
    const data = {
      pipelineId: toPipeline?.id ?? existing.pipelineId, pipelineStageId: toStage.id, stage: toStage.name, status: statusForClassification(toStage.classification),
      probability: toStage.probability, updatedByMembershipId: req.membership?.id, version: { increment: 1 },
    };
    if (toStage.classification === "Won") data.actualClosingDate = actualClosingDate ? new Date(actualClosingDate) : existing.actualClosingDate || new Date();
    if (toStage.classification === "Won") data.winReason = reason || existing.winReason;
    if (toStage.classification === "Lost") data.lossReason = reason;
    if (toStage.classification === "Cancelled") data.cancelReason = reason;
    if (toStage.classification === "OnHold") data.holdReason = reason;

    const updated = await tx.deal.update({ where: { id: existing.id }, data });
    await writeStageHistory(tx, { deal: existing, fromStage, toStage, membershipId: req.membership?.id, reason, correlationId: req.correlationId });
    return updated;
  });

  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.deal.stage_transitioned", targetType: "Deal", targetId: deal.id, result: "Success", reason, before: { stage: fromStage?.name }, after: { stage: toStage.name } });
  return { deal };
}

// The ONE transition endpoint — used by both Kanban drag-and-drop and the
// detail form, so the two surfaces enforce identical rules.
export async function transition(req, res) {
  const existing = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  const { toStage, toPipeline } = await loadStageContext(req.organizationId, existing, req.body);
  if (!toStage) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "pipelineStageId must reference a Stage in this organization." });

  const result = await performTransition(req, res, { toStage, toPipeline, reason: req.body.reason, actualClosingDate: req.body.actualClosingDate });
  if (result.error) return;
  res.json({ deal: toApi(maskFinancial(result.deal, req)) });
}

export async function markWon(req, res) {
  const existing = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  const wonStage = await prisma.pipelineStage.findFirst({ where: { organizationId: req.organizationId, pipelineId: existing.pipelineId, classification: "Won" } });
  if (!wonStage) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "This Pipeline has no Won stage configured." });

  const result = await performTransition(req, res, { toStage: wonStage, toPipeline: null, reason: req.body.winReason, actualClosingDate: req.body.actualClosingDate || new Date() });
  if (result.error) return;
  res.json({ deal: toApi(maskFinancial(result.deal, req)) });
}

export async function markLost(req, res) {
  if (!req.body.lossReason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "Marking a Deal Lost requires a loss reason." });
  const existing = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  const lostStage = await prisma.pipelineStage.findFirst({ where: { organizationId: req.organizationId, pipelineId: existing.pipelineId, classification: "Lost" } });
  if (!lostStage) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "This Pipeline has no Lost stage configured." });

  const result = await performTransition(req, res, { toStage: lostStage, toPipeline: null, reason: req.body.lossReason });
  if (result.error) return;
  res.json({ deal: toApi(maskFinancial(result.deal, req)) });
}

export async function reopen(req, res) {
  const existing = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  const errors = validateReopen({ deal: existing, reason: req.body.reason });
  if (errors.length > 0) return res.status(400).json(errors[0]);

  const openStage = await prisma.pipelineStage.findFirst({ where: { organizationId: req.organizationId, pipelineId: existing.pipelineId, classification: "Open" }, orderBy: { displayOrder: "asc" } });
  if (!openStage) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "This Pipeline has no Open stage to reopen into." });

  const deal = await prisma.$transaction(async (tx) => {
    const updated = await tx.deal.update({
      where: { id: existing.id },
      data: { pipelineStageId: openStage.id, stage: openStage.name, status: "Open", probability: openStage.probability, actualClosingDate: null, updatedByMembershipId: req.membership?.id, version: { increment: 1 } },
    });
    const fromStage = existing.pipelineStageId ? await tx.pipelineStage.findUnique({ where: { id: existing.pipelineStageId } }) : null;
    await writeStageHistory(tx, { deal: existing, fromStage, toStage: openStage, membershipId: req.membership?.id, reason: req.body.reason, correlationId: req.correlationId });
    return updated;
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.deal.reopened", targetType: "Deal", targetId: deal.id, result: "Success", reason: req.body.reason });
  res.json({ deal: toApi(maskFinancial(deal, req)) });
}

export async function archive(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to archive a Deal." });
  const existing = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  const deal = await prisma.deal.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), archivedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.deal.archived", targetType: "Deal", targetId: deal.id, result: "Success", reason: req.body.reason });
  res.json({ deal: toApi(maskFinancial(deal, req)) });
}

export async function restore(req, res) {
  const existing = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  const deal = await prisma.deal.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, archivedAt: null, archivedByMembershipId: null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.deal.restored", targetType: "Deal", targetId: deal.id, result: "Success" });
  res.json({ deal: toApi(maskFinancial(deal, req)) });
}

export async function stageHistory(req, res) {
  const deal = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!deal) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  const history = await prisma.dealStageHistory.findMany({ where: { dealId: deal.id }, orderBy: { changedAt: "asc" } });
  res.json({ stageHistory: toApi(history) });
}

// --- Deal line items ---

export async function listLineItems(req, res) {
  const deal = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!deal) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  const lineItems = await prisma.dealLineItem.findMany({ where: { dealId: deal.id }, orderBy: { displayOrder: "asc" } });
  res.json({ lineItems: toApi(lineItems) });
}

async function resolveCatalogSnapshot(organizationId, catalogItemId) {
  if (!catalogItemId) return null;
  const item = await prisma.catalogItem.findFirst({ where: { id: catalogItemId, organizationId } });
  if (!item || item.archived) return { error: true };
  return item;
}

export async function createLineItem(req, res) {
  const deal = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!deal) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  if (deal.archived) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "An archived Deal cannot be edited." });

  const { catalogItemId, quantity = 1, unitPrice, discountType, discountValue, taxCategory = "Standard", billingFrequency } = req.body;
  let snapshot = null;
  if (catalogItemId) {
    snapshot = await resolveCatalogSnapshot(req.organizationId, catalogItemId);
    if (!snapshot || snapshot.error) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "catalogItemId must reference an active catalog item in this organization." });
  }
  const resolvedUnitPrice = unitPrice ?? snapshot?.standardPrice ?? 0;

  let totals;
  try {
    totals = computeLineTotals({ quantity, unitPrice: resolvedUnitPrice, discountType, discountValue, taxCategory, currency: deal.currency });
  } catch (err) {
    return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: err.message });
  }

  const maxOrder = await prisma.dealLineItem.aggregate({ where: { dealId: deal.id }, _max: { displayOrder: true } });
  const lineItem = await prisma.dealLineItem.create({
    data: {
      dealId: deal.id, catalogItemId: catalogItemId || null, quantity, unitPrice: resolvedUnitPrice, discountType, discountValue, taxCategory,
      nameSnapshot: snapshot?.name || req.body.name, descriptionSnapshot: snapshot?.description, skuSnapshot: snapshot?.sku, unitSnapshot: snapshot?.unit, billingFrequency: billingFrequency || null,
      lineSubtotal: totals.lineSubtotal, taxAmount: totals.taxAmount, lineTotal: totals.lineTotal, displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
    },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.deal.line_item_added", targetType: "DealLineItem", targetId: lineItem.id, result: "Success" });
  res.status(201).json({ lineItem: toApi(lineItem) });
}

export async function updateLineItem(req, res) {
  const deal = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!deal) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  if (deal.archived) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "An archived Deal cannot be edited." });
  const existing = await prisma.dealLineItem.findFirst({ where: { id: req.params.lineItemId, dealId: deal.id } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Line item not found." });

  const quantity = req.body.quantity ?? existing.quantity;
  const unitPrice = req.body.unitPrice ?? existing.unitPrice;
  const discountType = "discountType" in req.body ? req.body.discountType : existing.discountType;
  const discountValue = "discountValue" in req.body ? req.body.discountValue : existing.discountValue;
  const taxCategory = req.body.taxCategory ?? existing.taxCategory;

  let totals;
  try {
    totals = computeLineTotals({ quantity, unitPrice, discountType, discountValue, taxCategory, currency: deal.currency });
  } catch (err) {
    return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: err.message });
  }

  const lineItem = await prisma.dealLineItem.update({
    where: { id: existing.id },
    data: {
      quantity, unitPrice, discountType, discountValue, taxCategory, lineSubtotal: totals.lineSubtotal, taxAmount: totals.taxAmount, lineTotal: totals.lineTotal,
      ...("billingFrequency" in req.body ? { billingFrequency: req.body.billingFrequency || null } : {}),
      ...("name" in req.body && !existing.catalogItemId ? { nameSnapshot: req.body.name } : {}),
      version: { increment: 1 },
    },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.deal.line_item_updated", targetType: "DealLineItem", targetId: lineItem.id, result: "Success" });
  res.json({ lineItem: toApi(lineItem) });
}

export async function deleteLineItem(req, res) {
  const deal = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!deal) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  if (deal.archived) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "An archived Deal cannot be edited." });
  const existing = await prisma.dealLineItem.findFirst({ where: { id: req.params.lineItemId, dealId: deal.id } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Line item not found." });
  await prisma.dealLineItem.delete({ where: { id: existing.id } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.deal.line_item_removed", targetType: "DealLineItem", targetId: existing.id, result: "Success" });
  res.status(204).send();
}

export async function bulk(req, res) {
  const { action, ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "ids must be a non-empty array." });
  if (ids.length > MAX_BULK_BATCH_SIZE) return res.status(400).json({ code: "SALES_BATCH_LIMIT_EXCEEDED", message: `A bulk operation may include at most ${MAX_BULK_BATCH_SIZE} records.` });

  const authorized = await prisma.deal.findMany({ where: { id: { in: ids }, organizationId: req.organizationId, ...scopeWhere(req) } });
  const authorizedIds = authorized.map((d) => d.id);
  let data;
  if (action === "assign") {
    if (!req.body.ownerMembershipId) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "ownerMembershipId is required." });
    const membership = await prisma.organizationMembership.findFirst({ where: { id: req.body.ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
    if (!membership) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
    data = { ownerMembershipId: req.body.ownerMembershipId };
  } else if (action === "archive") {
    if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required for bulk archive." });
    data = { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), archivedByMembershipId: req.membership?.id };
  } else {
    return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: `Unsupported bulk action "${action}".` });
  }

  await prisma.deal.updateMany({ where: { id: { in: authorizedIds } }, data: { ...data, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: `sales.deal.bulk_${action}`, result: "Success", after: { affectedCount: authorizedIds.length, requestedCount: ids.length } });
  res.json({ affected: authorizedIds.length, requested: ids.length, skipped: ids.length - authorizedIds.length });
}

export async function riskFlags(req, res) {
  const deal = await prisma.deal.findFirst({ where: { id: req.params.dealId, organizationId: req.organizationId, ...scopeWhere(req) }, include: { lineItems: true } });
  if (!deal) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Deal not found." });
  const lastActivity = await prisma.activity.findFirst({ where: { dealId: deal.id, organizationId: req.organizationId }, orderBy: { updatedAt: "desc" } });
  const reasons = computeDealRiskReasons(deal, { lastActivityAt: lastActivity?.updatedAt, lineItemCount: deal.lineItems.length });
  res.json({ reasons });
}
