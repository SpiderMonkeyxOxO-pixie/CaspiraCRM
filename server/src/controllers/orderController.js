import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

let orderCounter = 1000;

function activityEntry(type, actor, description) {
  return { _id: crypto.randomUUID(), type, actor, at: new Date().toISOString(), description };
}

function lineItemsCreateData(lineItems = []) {
  return lineItems.map((l, i) => ({
    catalogItemId: l.catalogItemId || null, isCustomLine: !l.catalogItemId, lineKind: l.lineKind || "Product",
    name: l.name, description: l.description || "", unit: l.unit || "Each", billingModel: l.billingModel || "One Time",
    billingInterval: l.billingInterval || null, quantity: Number(l.quantity) || 1,
    listPriceSnapshot: l.listPriceSnapshot ?? null, priceBookIdUsed: l.priceBookIdUsed || null,
    priceBookPriceSnapshot: l.priceBookPriceSnapshot ?? null, unitPrice: Number(l.unitPrice) || 0,
    discountType: l.discountType || null, discountValue: l.discountValue ?? null, taxCategory: l.taxCategory || "Standard", order: i,
  }));
}

const include = { company: true, contact: true, deal: true, sourceQuote: true, lineItems: true };

export async function list(req, res) {
  const { search, status, companyId, sourceQuoteId, archived } = req.query;
  const where = {};
  if (archived !== undefined) where.archived = archived === "true";
  if (status) where.status = status;
  if (companyId) where.companyId = companyId;
  if (sourceQuoteId) where.sourceQuoteId = sourceQuoteId;
  if (search) where.orderNumber = { contains: search, mode: "insensitive" };
  const orders = await prisma.order.findMany({ where, include, orderBy: { updatedAt: "desc" } });
  res.json({ orders: toApi(orders) });
}

export async function getOne(req, res) {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include });
  if (!order) return res.status(404).json({ message: "Order not found" });
  res.json({ order: toApi(order) });
}

function deriveOrderType(lineItems) {
  const kinds = new Set(lineItems.map((l) => l.lineKind || "Product"));
  if (kinds.size === 0) return "Product Order";
  if (kinds.size > 1) return "Mixed Order";
  return kinds.has("Service") ? "Service Order" : "Product Order";
}

export async function create(req, res) {
  const { lineItems = [], ...rest } = req.body;
  const order = await prisma.order.create({
    data: {
      ...rest, orderNumber: `O-PREVIEW-${++orderCounter}`, orderType: rest.orderType || deriveOrderType(lineItems),
      activityLog: [activityEntry("created", req.user.name, "Order created")],
      lineItems: { create: lineItemsCreateData(lineItems) },
    },
    include,
  });
  res.status(201).json({ order: toApi(order) });
}

export async function update(req, res) {
  const { lineItems, ...rest } = req.body;
  if (lineItems) {
    await prisma.orderLineItem.deleteMany({ where: { orderId: req.params.id } });
    await prisma.orderLineItem.createMany({ data: lineItemsCreateData(lineItems).map((l) => ({ ...l, orderId: req.params.id })) });
  }
  const order = await prisma.order.update({ where: { id: req.params.id }, data: rest, include });
  res.json({ order: toApi(order) });
}

async function transition(req, res, { status, extra = {}, activityType, activityDescription, guard }) {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).json({ message: "Order not found" });
  if (guard) {
    const err = guard(order, req.body);
    if (err) return res.status(400).json({ message: err });
  }
  const activityLog = [...(order.activityLog || []), activityEntry(activityType, req.user.name, activityDescription(req.body))];
  const updated = await prisma.order.update({ where: { id: req.params.id }, data: { status, ...extra, activityLog }, include });
  res.json({ order: toApi(updated) });
}

export const submitForReview = (req, res) => transition(req, res, { status: "Pending Review", activityType: "review_submitted", activityDescription: () => "Submitted for review" });
export const confirmOrder = (req, res) => transition(req, res, {
  status: "Confirmed", extra: { confirmedDate: req.body.confirmedDate ? new Date(req.body.confirmedDate) : new Date(), ownerId: req.body.ownerId || undefined, internalNote: req.body.internalNote || undefined },
  activityType: "confirmed", activityDescription: () => "Confirmed",
});
export const startProcessing = (req, res) => transition(req, res, { status: "Processing", activityType: "processing_started", activityDescription: (b) => b.note ? `Processing started: ${b.note}` : "Processing started" });
export const putOnHold = (req, res) => transition(req, res, {
  status: "On Hold", extra: { holdReason: req.body.reason, holdReviewDate: req.body.reviewDate ? new Date(req.body.reviewDate) : null },
  activityType: "on_hold", activityDescription: (b) => `On hold: ${b.reason}`, guard: (_o, b) => (!b.reason?.trim() ? "A reason is required to put an Order on hold" : null),
});
export const resumeOrder = (req, res) => transition(req, res, { status: req.body.targetStatus || "Processing", extra: { holdReason: null, holdReviewDate: null }, activityType: "resumed", activityDescription: () => "Resumed" });
export const cancelOrder = (req, res) => transition(req, res, {
  status: "Cancelled", extra: { cancellationReason: req.body.reason, cancellationEffectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : new Date() },
  activityType: "cancelled", activityDescription: (b) => `Cancelled: ${b.reason}`, guard: (_o, b) => (!b.reason?.trim() ? "A cancellation reason is required" : null),
});
export const markFulfilled = (req, res) => transition(req, res, { status: "Fulfilled", activityType: "fulfilled", activityDescription: () => "Marked fulfilled" });
export const markCompleted = (req, res) => transition(req, res, { status: "Completed", activityType: "completed", activityDescription: (b) => b.completionNote ? `Completed: ${b.completionNote}` : "Completed" });

export async function requestInvoicePreview(req, res) {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).json({ message: "Order not found" });
  const activityLog = [...(order.activityLog || []), activityEntry("invoice_requested", req.user.name, "Requested invoice preview — no Invoice was created (Finance route not yet implemented)")];
  const updated = await prisma.order.update({ where: { id: req.params.id }, data: { invoiceRequestedAt: new Date(), activityLog } });
  res.json({ order: toApi(updated) });
}

// The single most complex piece of business logic in this module: prevents
// negative/over-fulfillment, double-completion, and auto-promotes the
// Order's overall status once every line reaches (or partially reaches)
// full fulfillment — mirroring exactly what the frontend's mock layer did.
export async function updateLineFulfillment(req, res) {
  const { lineId } = req.params;
  const line = await prisma.orderLineItem.findUnique({ where: { id: lineId } });
  if (!line || line.orderId !== req.params.id) return res.status(404).json({ message: "Line item not found" });

  const changes = {};
  if (line.lineKind === "Service") {
    const pct = Number(req.body.completionPercentage);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) return res.status(400).json({ message: "Completion percentage must be between 0 and 100" });
    if (line.completionPercentage >= 100 && pct >= 100) return res.status(400).json({ message: "This line is already fully complete" });
    changes.completionPercentage = pct;
    changes.activationStatus = pct >= 100 ? "Active" : line.activationStatus;
  } else {
    const qty = Number(req.body.quantityFulfilled);
    if (Number.isNaN(qty) || qty < 0) return res.status(400).json({ message: "Fulfilled quantity cannot be negative" });
    if (qty > line.quantity) return res.status(400).json({ message: "Fulfilled quantity cannot exceed the ordered quantity" });
    if (line.quantityFulfilled >= line.quantity && qty >= line.quantity) return res.status(400).json({ message: "This line is already fully fulfilled" });
    changes.quantityFulfilled = qty;
    changes.deliveryStatus = qty >= line.quantity ? "Delivered" : qty > 0 ? "Partial" : "Not Started";
  }
  if (req.body.note) {
    changes.fulfillmentNotes = [...(line.fulfillmentNotes || []), { _id: crypto.randomUUID(), note: req.body.note, actor: req.user.name, at: new Date().toISOString() }];
  }
  await prisma.orderLineItem.update({ where: { id: lineId }, data: changes });

  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { lineItems: true } });
  const progress = (l) => (l.lineKind === "Service" ? l.completionPercentage : l.quantity > 0 ? (l.quantityFulfilled / l.quantity) * 100 : 0);
  const overall = order.lineItems.length ? order.lineItems.reduce((s, l) => s + progress(l), 0) / order.lineItems.length : 0;

  let newStatus = order.status;
  if (["Processing", "Partially Fulfilled"].includes(order.status)) {
    if (overall >= 100) newStatus = "Fulfilled";
    else if (overall > 0) newStatus = "Partially Fulfilled";
  }
  const activityLog = [...(order.activityLog || []), activityEntry("fulfillment_updated", req.user.name, `Updated fulfillment on line "${line.name}"`)];
  const updated = await prisma.order.update({ where: { id: req.params.id }, data: { status: newStatus, activityLog }, include });
  res.json({ order: toApi(updated) });
}

export async function archiveOrder(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ message: "A reason is required to archive an Order" });
  const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
  const order = await prisma.order.update({ where: { id: req.params.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), statusBeforeArchive: existing.status } });
  res.json({ order: toApi(order) });
}
export async function restoreOrder(req, res) {
  const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
  const order = await prisma.order.update({ where: { id: req.params.id }, data: { archived: false, archiveReason: null, status: existing.statusBeforeArchive || "Draft", statusBeforeArchive: null } });
  res.json({ order: toApi(order) });
}
export async function bulkAssign(req, res) {
  const { ids, ownerId } = req.body;
  await prisma.order.updateMany({ where: { id: { in: ids || [] } }, data: { ownerId } });
  res.json({ orders: toApi(await prisma.order.findMany({ where: { id: { in: ids || [] } } })) });
}
export async function bulkArchive(req, res) {
  const { ids, reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ message: "A reason is required to archive" });
  await prisma.order.updateMany({ where: { id: { in: ids || [] } }, data: { archived: true, archiveReason: reason, archivedAt: new Date() } });
  res.json({ orders: toApi(await prisma.order.findMany({ where: { id: { in: ids || [] } } })) });
}
