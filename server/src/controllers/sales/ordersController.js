import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";
import { previewQuoteToOrder, convertQuoteToOrder } from "../../services/sales/quoteToOrderService.js";
import { recordIdempotentResponse } from "../../middleware/idempotency.js";

const MAX_PAGE_SIZE = 100;

function scopeWhere(req) {
  return resolveCrmScopeWhere(req, "orders", { ownerField: "ownerMembershipId" });
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

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const where = buildListWhere(req);
  const [orders, total] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.order.count({ where }),
  ]);
  res.json({ orders: toApi(orders), total, page, pageSize });
}

export async function getOne(req, res) {
  const order = await prisma.order.findFirst({ where: { id: req.params.orderId, organizationId: req.organizationId, ...scopeWhere(req) }, include: { lineItems: true } });
  if (!order) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Order not found." });
  res.json({ order: toApi(order) });
}

// Direct (non-Quote-sourced) Order creation — still org-scoped, still
// server-calculated totals if line items are supplied, but most Orders in
// practice arrive via /quotes/:id/convert-to-order.
export async function create(req, res) {
  const { companyId, contactId, currency = "USD" } = req.body;
  if (companyId) {
    const c = await prisma.company.findFirst({ where: { id: companyId, organizationId: req.organizationId } });
    if (!c) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "companyId must reference a record in this organization." });
  }
  const order = await prisma.$transaction(async (tx) => {
    const { nextDocumentNumber } = await import("../../services/sales/documentNumberService.js");
    const orderNumber = await nextDocumentNumber(tx, req.organizationId, "Order");
    return tx.order.create({
      data: { organizationId: req.organizationId, orderNumber, orderType: req.body.orderType || "Product Order", companyId, contactId, dealId: req.body.dealId, currency, status: "Draft", ownerMembershipId: req.membership?.id, createdByMembershipId: req.membership?.id, updatedByMembershipId: req.membership?.id },
    });
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.order.created", targetType: "Order", targetId: order.id, result: "Success" });
  res.status(201).json({ order: toApi(order) });
}

export async function update(req, res) {
  const existing = await prisma.order.findFirst({ where: { id: req.params.orderId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Order not found." });
  // Order Line Items are immutable commercial snapshots after confirmation
  // — an ordinary update can still change non-commercial fields, but never
  // line items, once the Order has left Draft/Pending Confirmation.
  if (!["Draft", "Pending Confirmation"].includes(existing.status) && "lineItems" in req.body) {
    return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Order line items are immutable once the Order has been confirmed." });
  }
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "SALES_VERSION_CONFLICT", message: "This order was updated by someone else. Refresh and try again." });
  }
  const { version, id, organizationId, createdAt, orderNumber, lineItems, ...rest } = req.body;
  const order = await prisma.order.update({ where: { id: existing.id }, data: { ...rest, updatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.order.updated", targetType: "Order", targetId: order.id, result: "Success" });
  res.json({ order: toApi(order) });
}

export async function submit(req, res) {
  const existing = await prisma.order.findFirst({ where: { id: req.params.orderId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Order not found." });
  if (existing.status !== "Draft") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Draft Order can be submitted." });
  const order = await prisma.order.update({ where: { id: existing.id }, data: { status: "Pending Confirmation", version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.order.submitted", targetType: "Order", targetId: order.id, result: "Success" });
  res.json({ order: toApi(order) });
}

// Order confirmation requires: explicit permission (route-level),
// human confirmation (this is never called automatically — nothing in
// this codebase calls confirm() except this handler), a valid Company and
// Contact, at least one line item, a valid currency, and an audit event.
// The backend never auto-confirms an Order when a Quote is accepted —
// convertQuoteToOrder() only ever creates a Draft Order.
export async function confirm(req, res) {
  const existing = await prisma.order.findFirst({ where: { id: req.params.orderId, organizationId: req.organizationId, ...scopeWhere(req) }, include: { lineItems: true } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Order not found." });
  if (!["Draft", "Pending Confirmation"].includes(existing.status)) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Draft or Pending-Confirmation Order can be confirmed." });
  if (!existing.companyId) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A Company is required to confirm an Order." });
  if (!existing.contactId) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A Contact is required to confirm an Order." });
  if (existing.lineItems.length === 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "At least one line item is required to confirm an Order." });
  if (!existing.currency) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A currency is required to confirm an Order." });

  const order = await prisma.order.update({ where: { id: existing.id }, data: { status: "Confirmed", confirmedDate: new Date(), confirmedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.order.confirmed", targetType: "Order", targetId: order.id, result: "Success" });
  await recordIdempotentResponse(req, 200, { order: toApi(order) });
  res.json({ order: toApi(order) });
}

export async function cancel(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to cancel an Order." });
  const existing = await prisma.order.findFirst({ where: { id: req.params.orderId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Order not found." });
  const order = await prisma.order.update({ where: { id: existing.id }, data: { status: "Cancelled", cancellationReason: req.body.reason, cancellationEffectiveDate: new Date(), version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.order.cancelled", targetType: "Order", targetId: order.id, result: "Success", reason: req.body.reason });
  res.json({ order: toApi(order) });
}

export async function markInProgress(req, res) {
  const existing = await prisma.order.findFirst({ where: { id: req.params.orderId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Order not found." });
  if (existing.status !== "Confirmed") return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Confirmed Order can move to In Progress." });
  const order = await prisma.order.update({ where: { id: existing.id }, data: { status: "Processing", version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.order.processing_started", targetType: "Order", targetId: order.id, result: "Success" });
  res.json({ order: toApi(order) });
}

export async function markFulfilled(req, res) {
  const existing = await prisma.order.findFirst({ where: { id: req.params.orderId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Order not found." });
  if (!["Processing", "Confirmed"].includes(existing.status)) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "Only a Confirmed or In-Progress Order can be marked Fulfilled." });
  const order = await prisma.order.update({ where: { id: existing.id }, data: { status: "Fulfilled", version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.order.fulfilled", targetType: "Order", targetId: order.id, result: "Success" });
  res.json({ order: toApi(order) });
}

export async function archive(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to archive an Order." });
  const existing = await prisma.order.findFirst({ where: { id: req.params.orderId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Order not found." });
  const order = await prisma.order.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), statusBeforeArchive: existing.status, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.order.archived", targetType: "Order", targetId: order.id, result: "Success" });
  res.json({ order: toApi(order) });
}

export async function restore(req, res) {
  const existing = await prisma.order.findFirst({ where: { id: req.params.orderId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Order not found." });
  const order = await prisma.order.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, status: existing.statusBeforeArchive || "Draft", statusBeforeArchive: null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.order.restored", targetType: "Order", targetId: order.id, result: "Success" });
  res.json({ order: toApi(order) });
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
