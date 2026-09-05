import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";

let quoteCounter = 1000;

function activityEntry(type, actor, description) {
  return { _id: crypto.randomUUID(), type, actor, at: new Date().toISOString(), description };
}

function lineItemsCreateData(lineItems = []) {
  return lineItems.map((l, i) => ({
    catalogItemId: l.catalogItemId || null, priceBookIdUsed: l.priceBookIdUsed || null, isCustomLine: !!l.isCustomLine,
    included: l.included !== false, name: l.name, description: l.description || "", unit: l.unit || "Each",
    billingModel: l.billingModel || "One Time", billingInterval: l.billingInterval || null, quantity: Number(l.quantity) || 1,
    listPrice: Number(l.listPrice) || 0, priceBookPrice: l.priceBookPrice ?? null, unitPrice: Number(l.unitPrice) || 0,
    discountType: l.discountType || null, discountValue: l.discountValue ?? null, taxCategory: l.taxCategory || "Standard", order: i,
  }));
}

const include = { company: true, contact: true, deal: true, priceBook: true, lineItems: true };

export async function list(req, res) {
  const { search, status, companyId, dealId, archived } = req.query;
  const where = {};
  if (archived !== undefined) where.archived = archived === "true";
  if (status) where.status = status;
  if (companyId) where.companyId = companyId;
  if (dealId) where.dealId = dealId;
  if (search) where.OR = [{ quoteNumber: { contains: search, mode: "insensitive" } }, { title: { contains: search, mode: "insensitive" } }];
  const quotes = await prisma.quote.findMany({ where, include, orderBy: { updatedAt: "desc" } });
  res.json({ quotes: toApi(quotes) });
}

export async function getOne(req, res) {
  const quote = await prisma.quote.findUnique({ where: { id: req.params.id }, include });
  if (!quote) return res.status(404).json({ message: "Quote not found" });
  res.json({ quote: toApi(quote) });
}

export async function create(req, res) {
  const { lineItems = [], ...rest } = req.body;
  const quote = await prisma.quote.create({
    data: {
      ...rest, quoteNumber: `Q-PREVIEW-${++quoteCounter}`, version: 1,
      activityLog: [activityEntry("created", req.user.name, "Quote created")],
      lineItems: { create: lineItemsCreateData(lineItems) },
    },
    include,
  });
  res.status(201).json({ quote: toApi(quote) });
}

export async function update(req, res) {
  const { lineItems, ...rest } = req.body;
  if (lineItems) {
    await prisma.quoteLineItem.deleteMany({ where: { quoteId: req.params.id } });
    await prisma.quoteLineItem.createMany({ data: lineItemsCreateData(lineItems).map((l) => ({ ...l, quoteId: req.params.id })) });
  }
  const quote = await prisma.quote.update({ where: { id: req.params.id }, data: rest, include });
  res.json({ quote: toApi(quote) });
}

async function transition(req, res, { status, extra = {}, activityType, activityDescription, guard }) {
  const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
  if (!quote) return res.status(404).json({ message: "Quote not found" });
  if (guard) {
    const err = guard(quote, req.body);
    if (err) return res.status(400).json({ message: err });
  }
  const activityLog = [...(quote.activityLog || []), activityEntry(activityType, req.user.name, activityDescription(req.body))];
  const updated = await prisma.quote.update({ where: { id: req.params.id }, data: { status, ...extra, activityLog }, include });
  res.json({ quote: toApi(updated) });
}

export const submitForReview = (req, res) => transition(req, res, {
  status: "Internal Review", activityType: "review_submitted", activityDescription: () => "Submitted for internal review",
});
export const approveReview = (req, res) => transition(req, res, {
  status: "Approved", extra: { approvalStatus: "Approved" }, activityType: "approved", activityDescription: () => "Approved",
});
export const rejectReview = (req, res) => transition(req, res, {
  status: "Draft", extra: { approvalStatus: "Rejected" }, activityType: "rejected",
  activityDescription: (b) => `Rejected: ${b.reason || ""}`, guard: (_q, b) => (!b.reason?.trim() ? "A reason is required" : null),
});
export const requestReviewChanges = (req, res) => transition(req, res, {
  status: "Draft", extra: { approvalStatus: "Changes Requested" }, activityType: "changes_requested",
  activityDescription: (b) => `Changes requested: ${b.reason || ""}`, guard: (_q, b) => (!b.reason?.trim() ? "A reason is required" : null),
});
export const cancelQuote = (req, res) => transition(req, res, {
  status: "Cancelled", activityType: "cancelled", activityDescription: (b) => `Cancelled: ${b.reason || ""}`,
  guard: (_q, b) => (!b.reason?.trim() ? "A cancellation reason is required" : null),
});
export const previewSend = (req, res) => transition(req, res, {
  status: "Sent", activityType: "sent", activityDescription: () => "Sent to customer (preview only)",
});

export async function customerResponse(req, res) {
  const { type, customerName, jobTitle, reason } = req.body;
  const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
  if (!quote) return res.status(404).json({ message: "Quote not found" });
  const customerResponseData = { type, customerName, jobTitle, reason: reason || null, at: new Date().toISOString() };
  const status = type === "Accepted" ? "Accepted" : type === "Rejected" ? "Rejected" : quote.status;
  const activityLog = [...(quote.activityLog || []), activityEntry("customer_response", customerName || "Customer", `Customer ${type}`)];
  const updated = await prisma.quote.update({ where: { id: req.params.id }, data: { customerResponse: customerResponseData, status, activityLog }, include });
  res.json({ quote: toApi(updated) });
}

export async function newVersion(req, res) {
  const { changeSummary, ...payload } = req.body;
  if (!changeSummary?.trim()) return res.status(400).json({ message: "A change summary is required" });
  const previous = await prisma.quote.findUnique({ where: { id: req.params.id }, include: { lineItems: true } });
  if (!previous) return res.status(404).json({ message: "Quote not found" });

  const newQuote = await prisma.quote.create({
    data: {
      quoteNumber: previous.quoteNumber, rootId: previous.rootId || previous.id, version: previous.version + 1,
      title: payload.title ?? previous.title, companyId: previous.companyId, primaryContactId: previous.primaryContactId,
      dealId: previous.dealId, priceBookId: previous.priceBookId, ownerId: previous.ownerId, assignedTeam: previous.assignedTeam,
      currency: previous.currency, paymentTerms: previous.paymentTerms, billingSchedule: previous.billingSchedule,
      customerNote: previous.customerNote, changeSummary,
      activityLog: [activityEntry("new_version", req.user.name, `New version created: ${changeSummary}`)],
      lineItems: { create: lineItemsCreateData((payload.lineItems || previous.lineItems).map((l) => ({ ...l }))) },
    },
    include,
  });
  res.status(201).json({ quote: toApi(newQuote), previous: toApi(previous) });
}

export async function archiveQuote(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ message: "A reason is required to archive" });
  const quote = await prisma.quote.update({ where: { id: req.params.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), statusBeforeArchive: (await prisma.quote.findUnique({ where: { id: req.params.id } })).status } });
  res.json({ quote: toApi(quote) });
}
export async function restoreQuote(req, res) {
  const existing = await prisma.quote.findUnique({ where: { id: req.params.id } });
  const quote = await prisma.quote.update({ where: { id: req.params.id }, data: { archived: false, archiveReason: null, status: existing.statusBeforeArchive || "Draft", statusBeforeArchive: null } });
  res.json({ quote: toApi(quote) });
}
export async function bulkAssign(req, res) {
  const { ids, ownerId } = req.body;
  await prisma.quote.updateMany({ where: { id: { in: ids || [] } }, data: { ownerId } });
  res.json({ quotes: toApi(await prisma.quote.findMany({ where: { id: { in: ids || [] } } })) });
}
export async function bulkArchive(req, res) {
  const { ids, reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ message: "A reason is required" });
  await prisma.quote.updateMany({ where: { id: { in: ids || [] } }, data: { archived: true, archiveReason: reason, archivedAt: new Date() } });
  res.json({ quotes: toApi(await prisma.quote.findMany({ where: { id: { in: ids || [] } } })) });
}
