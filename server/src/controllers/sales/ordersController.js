import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";
import { previewQuoteToOrder, convertQuoteToOrder } from "../../services/sales/quoteToOrderService.js";
import { recordIdempotentResponse } from "../../middleware/idempotency.js";
import { computeLineTotals, computeDocumentTotals } from "../../services/sales/moneyService.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { authorizeOrgAccess } from "../../middleware/rbac.js";
import { pickWritable } from "../../utils/pickWritable.js";
import { createDraftInvoice, orderLinesToInvoiceLines } from "../../services/finance/invoiceService.js";

const MAX_PAGE_SIZE = 100;
const MAX_BULK_BATCH_SIZE = 200;

// Order status vocabulary — the frontend's ORDER_STATUSES ("Archived" is a
// flag, not a status). Lines stay editable only while the order is in one
// of EDITABLE_STATUSES; after confirmation they are frozen snapshots.
const EDITABLE_STATUSES = ["Draft", "Pending Review"];
const HOLDABLE_STATUSES = ["Confirmed", "Processing", "Partially Fulfilled"];
const RESUMABLE_TO = ["Confirmed", "Processing", "Partially Fulfilled"];
const CLOSED_STATUSES = ["Cancelled", "Completed"];

// The only header fields a client may write (see pickWritable). Status,
// confirmation, cancellation, hold and invoice-request state change only
// through the lifecycle endpoints.
const WRITABLE_FIELDS = [
  "orderType", "companyId", "contactId", "dealId", "ownerMembershipId", "assignedTeam", "currency", "orderDate", "requestedDate",
  "paymentTerms", "billingSchedule", "billingContactId", "billingAddress", "serviceAddress", "deliveryInstructions",
  "serviceStartInstructions", "customerReference", "internalNote", "customerNote",
];
const pickOrderFields = (body) => pickWritable(body, WRITABLE_FIELDS, { dates: ["orderDate", "requestedDate"] });

function scopeWhere(req) {
  return resolveCrmScopeWhere(req, "orders", { ownerField: "ownerMembershipId" });
}

async function validateSameOrgRefs(organizationId, { companyId, contactId, billingContactId, dealId, ownerMembershipId, lineItems }) {
  const checks = [
    [companyId, "companyId", () => prisma.company.findFirst({ where: { id: companyId, organizationId } })],
    [contactId, "contactId", () => prisma.contact.findFirst({ where: { id: contactId, organizationId } })],
    [billingContactId, "billingContactId", () => prisma.contact.findFirst({ where: { id: billingContactId, organizationId } })],
    [dealId, "dealId", () => prisma.deal.findFirst({ where: { id: dealId, organizationId } })],
    [ownerMembershipId, "ownerMembershipId", () => prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId, status: "Active" } })],
  ];
  for (const [value, field, find] of checks) if (value && !(await find())) return { field };
  const catalogIds = [...new Set((Array.isArray(lineItems) ? lineItems : []).map((l) => l?.catalogItemId).filter(Boolean))];
  if (catalogIds.length && (await prisma.catalogItem.count({ where: { id: { in: catalogIds }, organizationId } })) !== catalogIds.length) return { field: "lineItems.catalogItemId" };
  return null;
}

function lineItemData(l, index) {
  return {
    catalogItemId: l.catalogItemId || null, isCustomLine: !!l.isCustomLine, lineKind: l.lineKind === "Service" ? "Service" : "Product",
    name: l.name, description: l.description, unit: l.unit || "Each", billingModel: l.billingModel || "One Time", billingInterval: l.billingInterval,
    quantity: l.quantity ?? 1, listPriceSnapshot: l.listPriceSnapshot ?? l.unitPrice ?? 0, priceBookIdUsed: l.priceBookIdUsed || null,
    priceBookPriceSnapshot: l.priceBookPriceSnapshot ?? null, unitPrice: l.unitPrice ?? 0, discountType: l.discountType, discountValue: l.discountValue,
    taxCategory: l.taxCategory || "Standard", order: index, requestedDeliveryDate: l.requestedDeliveryDate ? new Date(l.requestedDeliveryDate) : null,
    serviceStartDate: l.serviceStartDate ? new Date(l.serviceStartDate) : null,
  };
}

// Totals are always computed server-side from the lines — never trusted from the client.
async function replaceLinesAndTotals(tx, orderId, lineItems, currency) {
  await tx.orderLineItem.deleteMany({ where: { orderId } });
  const data = lineItems.map(lineItemData);
  const results = data.map((l) => computeLineTotals({ quantity: l.quantity, unitPrice: l.unitPrice, discountType: l.discountType, discountValue: l.discountValue, taxCategory: l.taxCategory, currency }));
  if (data.length) {
    await tx.orderLineItem.createMany({ data: data.map((l, i) => ({ ...l, orderId, lineSubtotal: results[i].lineSubtotal, taxAmount: results[i].taxAmount, lineTotal: results[i].lineTotal })) });
  }
  return computeDocumentTotals(results, { currency });
}

// Unweighted average of each line's progress — the frontend's
// computeOrderProgress(): delivered ÷ ordered for Product lines, completion
// percentage for Service lines.
export function orderProgress(lines) {
  if (!lines.length) return 0;
  const lineProgress = (l) => {
    if (l.lineKind === "Service") return Math.max(0, Math.min(100, Number(l.completionPercentage) || 0));
    const ordered = Number(l.quantity) || 0;
    return ordered <= 0 ? 0 : Math.max(0, Math.min(100, ((Number(l.quantityFulfilled) || 0) / ordered) * 100));
  };
  return Math.round((lines.reduce((sum, l) => sum + lineProgress(l), 0) / lines.length) * 10) / 10;
}

function buildListWhere(req) {
  const q = req.query;
  const where = { organizationId: req.organizationId, ...scopeWhere(req) };
  where.archived = q.archived === "true";
  if (q.search) where.orderNumber = { contains: q.search, mode: "insensitive" };
  if (q.status) where.status = q.status;
  if (q.companyId) where.companyId = q.companyId;
  if (q.sourceQuoteId) where.sourceQuoteId = q.sourceQuoteId;
  return where;
}

async function loadOrder(req, res, include = { lineItems: true }) {
  const order = await prisma.order.findFirst({ where: { id: req.params.orderId, organizationId: req.organizationId, ...scopeWhere(req) }, include });
  if (!order) res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Order not found." });
  return order;
}

const withLines = { lineItems: { orderBy: { order: "asc" } } };

async function audit(req, action, orderId, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action, targetType: "Order", targetId: orderId, result: "Success", ...extra });
}

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const where = buildListWhere(req);
  const [orders, total] = await Promise.all([
    prisma.order.findMany({ where, include: withLines, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.order.count({ where }),
  ]);
  res.json({ orders: toApi(orders), total, page, pageSize });
}

export async function getOne(req, res) {
  const order = await loadOrder(req, res, withLines);
  if (!order) return;
  res.json({ order: toApi(order) });
}

// Direct (non-Quote-sourced) Order creation. Most Orders arrive via
// /quotes/:id/convert-to-order; either way the order starts as a Draft.
export async function create(req, res) {
  const fields = pickOrderFields(req.body);
  const lineItems = Array.isArray(req.body.lineItems) ? req.body.lineItems : [];
  const refError = await validateSameOrgRefs(req.organizationId, { ...fields, lineItems });
  if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: `${refError.field} must reference a record in this organization.` });
  const currency = fields.currency || "USD";

  const order = await prisma.$transaction(async (tx) => {
    const orderNumber = await nextDocumentNumber(tx, req.organizationId, "Order");
    const created = await tx.order.create({
      data: {
        ...fields, organizationId: req.organizationId, orderNumber, orderType: fields.orderType || "Product Order", currency, status: "Draft",
        ownerMembershipId: fields.ownerMembershipId || req.membership?.id, createdByMembershipId: req.membership?.id, updatedByMembershipId: req.membership?.id,
      },
    });
    const totals = await replaceLinesAndTotals(tx, created.id, lineItems, currency);
    return tx.order.update({ where: { id: created.id }, data: totals, include: withLines });
  });
  await audit(req, "sales.order.created", order.id);
  res.status(201).json({ order: toApi(order) });
}

export async function update(req, res) {
  const existing = await loadOrder(req, res);
  if (!existing) return;
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "SALES_VERSION_CONFLICT", message: "This order was updated by someone else. Refresh and try again." });
  }
  const lineItems = Array.isArray(req.body.lineItems) ? req.body.lineItems : null;
  // Line items are immutable commercial snapshots once the Order is confirmed.
  if (lineItems && !EDITABLE_STATUSES.includes(existing.status)) {
    return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Order line items are immutable once the Order has been confirmed." });
  }
  const rest = pickOrderFields(req.body);
  const refError = await validateSameOrgRefs(req.organizationId, { ...rest, lineItems });
  if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: `${refError.field} must reference a record in this organization.` });

  const order = await prisma.$transaction(async (tx) => {
    const totals = lineItems ? await replaceLinesAndTotals(tx, existing.id, lineItems, rest.currency || existing.currency) : {};
    return tx.order.update({ where: { id: existing.id }, data: { ...rest, ...totals, updatedByMembershipId: req.membership?.id, version: { increment: 1 } }, include: withLines });
  });
  await audit(req, "sales.order.updated", order.id);
  res.json({ order: toApi(order) });
}

// Moves an order between statuses after checking where it currently is.
async function transition(req, res, { from, to, auditAction, data = {}, message }) {
  const existing = await loadOrder(req, res);
  if (!existing) return;
  if (!from.includes(existing.status)) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message });
  const order = await prisma.order.update({ where: { id: existing.id }, data: { status: to, ...data, updatedByMembershipId: req.membership?.id, version: { increment: 1 } }, include: withLines });
  await audit(req, auditAction, order.id, { reason: req.body.reason, before: { status: existing.status }, after: { status: to } });
  res.json({ order: toApi(order) });
}

export const submit = (req, res) =>
  transition(req, res, { from: ["Draft"], to: "Pending Review", auditAction: "sales.order.submitted", message: "Only a Draft Order can be submitted for review." });

// Confirmation requires explicit permission (route-level), a human action
// (nothing calls this automatically — convertQuoteToOrder only ever creates
// a Draft), a valid Company and Contact, at least one line and a currency.
export async function confirm(req, res) {
  const existing = await loadOrder(req, res);
  if (!existing) return;
  if (!EDITABLE_STATUSES.includes(existing.status)) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Draft or Pending Review Order can be confirmed." });
  if (!existing.companyId) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A Company is required to confirm an Order." });
  if (!existing.contactId) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A Contact is required to confirm an Order." });
  if (existing.lineItems.length === 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "At least one line item is required to confirm an Order." });
  if (!existing.currency) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A currency is required to confirm an Order." });
  const { ownerMembershipId, internalNote, confirmedDate } = req.body;
  if (ownerMembershipId && (await validateSameOrgRefs(req.organizationId, { ownerMembershipId }))) {
    return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  }

  const order = await prisma.order.update({
    where: { id: existing.id },
    data: {
      status: "Confirmed", confirmedDate: confirmedDate ? new Date(confirmedDate) : new Date(), confirmedByMembershipId: req.membership?.id,
      ...(ownerMembershipId ? { ownerMembershipId } : {}), ...(internalNote ? { internalNote } : {}), version: { increment: 1 },
    },
    include: withLines,
  });
  await audit(req, "sales.order.confirmed", order.id);
  await recordIdempotentResponse(req, 200, { order: toApi(order) });
  res.json({ order: toApi(order) });
}

export async function cancel(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to cancel an Order." });
  const existing = await loadOrder(req, res);
  if (!existing) return;
  // Once anything has been delivered, the order is finished through
  // fulfilment/completion, not cancelled.
  if ([...CLOSED_STATUSES, "Fulfilled"].includes(existing.status)) {
    return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: `A ${existing.status} Order can't be cancelled.` });
  }
  const order = await prisma.order.update({ where: { id: existing.id }, data: { status: "Cancelled", cancellationReason: req.body.reason, cancellationEffectiveDate: new Date(), version: { increment: 1 } }, include: withLines });
  await audit(req, "sales.order.cancelled", order.id, { reason: req.body.reason });
  res.json({ order: toApi(order) });
}

export const markInProgress = (req, res) =>
  transition(req, res, { from: ["Confirmed"], to: "Processing", auditAction: "sales.order.processing_started", message: "Only a Confirmed Order can start processing." });

export const markFulfilled = (req, res) =>
  transition(req, res, { from: ["Confirmed", "Processing", "Partially Fulfilled"], to: "Fulfilled", auditAction: "sales.order.fulfilled", message: "Only a Confirmed or in-progress Order can be marked Fulfilled." });

export const complete = (req, res) =>
  transition(req, res, { from: ["Fulfilled"], to: "Completed", auditAction: "sales.order.completed", message: "Only a Fulfilled Order can be completed." });

export async function hold(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to put an Order on hold." });
  return transition(req, res, {
    from: HOLDABLE_STATUSES, to: "On Hold", auditAction: "sales.order.held", message: "Only a Confirmed or in-progress Order can be put on hold.",
    data: { holdReason: req.body.reason, holdReviewDate: req.body.holdReviewDate ? new Date(req.body.holdReviewDate) : null },
  });
}

export async function resume(req, res) {
  const to = RESUMABLE_TO.includes(req.body.targetStatus) ? req.body.targetStatus : "Processing";
  return transition(req, res, { from: ["On Hold"], to, auditAction: "sales.order.resumed", message: "Only an Order on hold can be resumed.", data: { holdReason: null, holdReviewDate: null } });
}

// Requests an invoice for a confirmed order: creates a Draft invoice
// (Backend Phase 6) from the order's own lines, which Finance then approves
// and sends. One open invoice per order — a voided one can be replaced.
export async function requestInvoice(req, res) {
  const existing = await loadOrder(req, res);
  if (!existing) return;
  if (["Draft", "Pending Review", "Cancelled"].includes(existing.status)) {
    return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "An invoice can only be requested for a confirmed Order." });
  }
  if (!existing.lineItems?.length) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "This order has no line items to invoice." });
  const open = await prisma.invoice.findFirst({ where: { organizationId: req.organizationId, orderId: existing.id, status: { not: "Void" } } });
  if (open) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: `This order already has invoice ${open.invoiceNumber}.` });

  let invoice;
  const order = await prisma.$transaction(async (tx) => {
    invoice = await createDraftInvoice(tx, {
      organizationId: req.organizationId, membershipId: req.membership?.id, companyId: existing.companyId, dealId: existing.dealId,
      orderId: existing.id, source: "Order", lines: orderLinesToInvoiceLines(existing.lineItems), currency: existing.currency,
    });
    return tx.order.update({ where: { id: existing.id }, data: { invoiceRequestedAt: new Date(), version: { increment: 1 } }, include: withLines });
  });
  await audit(req, "sales.order.invoice_requested", order.id, { after: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber } });
  res.json({ order: toApi(order), invoice: toApi(invoice) });
}

// Per-line delivery/completion progress; moves the order to Partially
// Fulfilled / Fulfilled automatically, exactly like the frontend rules.
export async function updateLineFulfillment(req, res) {
  const existing = await loadOrder(req, res);
  if (!existing) return;
  if (!["Confirmed", "Processing", "Partially Fulfilled"].includes(existing.status)) {
    return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Fulfilment can only be recorded on a confirmed, in-progress Order." });
  }
  const line = existing.lineItems.find((l) => l.id === req.params.lineId);
  if (!line) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Line item not found." });

  const b = req.body;
  const at = b.fulfillmentDate ? new Date(b.fulfillmentDate) : new Date();
  const data = {};
  if (line.lineKind === "Product" && b.quantityFulfilled !== undefined) {
    const next = Number(b.quantityFulfilled);
    const ordered = Number(line.quantity);
    if (Number.isNaN(next) || next < 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "Fulfilled quantity cannot be negative." });
    if (next > ordered) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "Fulfilled quantity cannot exceed the ordered quantity." });
    if (Number(line.quantityFulfilled) >= ordered && next === ordered) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "This line is already fully fulfilled." });
    data.quantityFulfilled = next;
    data.deliveryStatus = next === 0 ? "Not Started" : next >= ordered ? "Delivered" : "Partial";
    if (next >= ordered) data.completedDate = at;
    if (b.deliveryReferencePreview) data.deliveryReferencePreview = b.deliveryReferencePreview;
  }
  if (line.lineKind === "Service") {
    if (b.completionPercentage !== undefined) {
      const next = Number(b.completionPercentage);
      if (Number.isNaN(next) || next < 0 || next > 100) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "Completion percentage must be between 0 and 100." });
      if (Number(line.completionPercentage) >= 100 && next === 100) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "This service line is already complete." });
      data.completionPercentage = next;
      data.activationStatus = next > 0 ? "Active" : "Not Started";
      if (next >= 100) data.completedDate = at;
    }
    if (b.setupStatus) data.setupStatus = b.setupStatus;
    if (b.nextMilestone !== undefined) data.nextMilestone = b.nextMilestone;
    if (b.serviceStartDate !== undefined) data.serviceStartDate = b.serviceStartDate ? new Date(b.serviceStartDate) : null;
    if (b.responsibleOwnerId !== undefined) {
      const owner = b.responsibleOwnerId ? await prisma.organizationMembership.findFirst({ where: { id: b.responsibleOwnerId, organizationId: req.organizationId, status: "Active" }, include: { user: true } }) : null;
      if (b.responsibleOwnerId && !owner) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "responsibleOwnerId must reference an active membership in this organization." });
      data.responsibleOwnerId = b.responsibleOwnerId || null;
      data.responsibleOwnerName = owner?.user?.name || null;
    }
  }
  if (b.note?.trim()) {
    const notes = Array.isArray(line.fulfillmentNotes) ? line.fulfillmentNotes : [];
    data.fulfillmentNotes = [...notes, { at: at.toISOString(), authorMembershipId: req.membership?.id || null, text: b.note.trim() }];
  }

  const order = await prisma.$transaction(async (tx) => {
    await tx.orderLineItem.update({ where: { id: line.id }, data: { ...data, version: { increment: 1 } } });
    const lines = await tx.orderLineItem.findMany({ where: { orderId: existing.id } });
    const progress = orderProgress(lines);
    let status = existing.status;
    if (progress >= 100 && ["Processing", "Partially Fulfilled"].includes(status)) status = "Fulfilled";
    else if (progress > 0 && progress < 100 && status === "Processing") status = "Partially Fulfilled";
    return tx.order.update({ where: { id: existing.id }, data: { status, version: { increment: 1 } }, include: withLines });
  });
  await audit(req, "sales.order.fulfillment_updated", order.id, { after: { lineId: line.id, status: order.status } });
  res.json({ order: toApi(order) });
}

export async function archive(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to archive an Order." });
  const existing = await loadOrder(req, res, undefined);
  if (!existing) return;
  const order = await prisma.order.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), archivedByMembershipId: req.membership?.id, statusBeforeArchive: existing.status, version: { increment: 1 } }, include: withLines });
  await audit(req, "sales.order.archived", order.id, { reason: req.body.reason });
  res.json({ order: toApi(order) });
}

export async function restore(req, res) {
  const existing = await loadOrder(req, res, undefined);
  if (!existing) return;
  const order = await prisma.order.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, archivedAt: null, archivedByMembershipId: null, status: existing.statusBeforeArchive || existing.status, statusBeforeArchive: null, version: { increment: 1 } }, include: withLines });
  await audit(req, "sales.order.restored", order.id);
  res.json({ order: toApi(order) });
}

export async function bulk(req, res) {
  const { action, ids, reason, ownerMembershipId } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "ids must be a non-empty array." });
  if (ids.length > MAX_BULK_BATCH_SIZE) return res.status(400).json({ code: "SALES_BATCH_LIMIT_EXCEEDED", message: `A bulk operation may include at most ${MAX_BULK_BATCH_SIZE} records.` });

  const authorized = await prisma.order.findMany({ where: { id: { in: ids }, organizationId: req.organizationId, ...scopeWhere(req) } });
  let targets = authorized;
  if (action === "assign") {
    if (!ownerMembershipId || (await validateSameOrgRefs(req.organizationId, { ownerMembershipId }))) {
      return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
    }
    await prisma.order.updateMany({ where: { id: { in: targets.map((o) => o.id) } }, data: { ownerMembershipId, updatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  } else if (action === "archive") {
    if (!reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required for bulk archive." });
    if (!req.isSystemOwnerOverride && !(await authorizeOrgAccess(req.user, req.organizationId, "orders", "archive")).ok) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not have permission to archive orders." });
    }
    targets = authorized.filter((o) => !o.archived);
    await prisma.$transaction(targets.map((o) => prisma.order.update({
      where: { id: o.id },
      data: { archived: true, archiveReason: reason, archivedAt: new Date(), archivedByMembershipId: req.membership?.id, statusBeforeArchive: o.status, version: { increment: 1 } },
    })));
  } else {
    return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: `Unsupported bulk action "${action}".` });
  }
  await audit(req, `sales.order.bulk_${action}`, null, { reason, after: { affectedCount: targets.length, requestedCount: ids.length } });
  res.json({ affected: targets.length, requested: ids.length, skipped: ids.length - targets.length });
}

// --- Quote-to-Order conversion (mounted under /sales/quotes/:quoteId) ---

export async function orderPreview(req, res) {
  const result = await previewQuoteToOrder(req.organizationId, req.params.quoteId);
  if (result.error) return res.status(result.error.status).json({ code: result.error.code, message: result.error.message });
  res.json({ preview: toApi(result.preview) });
}

export async function convertToOrder(req, res) {
  const result = await convertQuoteToOrder({
    organizationId: req.organizationId, quoteId: req.params.quoteId, sourceQuoteVersion: req.body.sourceQuoteVersion,
    actorUserId: req.user.id, actorMembershipId: req.membership?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"], correlationId: req.correlationId,
  });
  if (result.error) return res.status(result.error.status).json({ code: result.error.code, message: result.error.message });
  await recordIdempotentResponse(req, 201, { order: toApi(result.order) });
  res.status(201).json({ order: toApi(result.order) });
}
