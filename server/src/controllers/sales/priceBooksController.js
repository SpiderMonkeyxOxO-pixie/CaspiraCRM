import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";

const MAX_PAGE_SIZE = 100;

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const where = { organizationId: req.organizationId };
  where.archived = req.query.archived === "true";
  if (req.query.search) where.name = { contains: req.query.search, mode: "insensitive" };
  if (req.query.currency) where.currency = req.query.currency;

  const [priceBooks, total] = await Promise.all([
    prisma.priceBook.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.priceBook.count({ where }),
  ]);
  res.json({ priceBooks: toApi(priceBooks), total, page, pageSize });
}

export async function getOne(req, res) {
  const priceBook = await prisma.priceBook.findFirst({ where: { id: req.params.priceBookId, organizationId: req.organizationId }, include: { entries: true } });
  if (!priceBook) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book not found." });
  res.json({ priceBook: toApi(priceBook) });
}

function validateEffectiveDates(effectiveDate, expirationDate) {
  if (effectiveDate && expirationDate && new Date(expirationDate) < new Date(effectiveDate)) {
    return "expirationDate cannot be before effectiveDate.";
  }
  return null;
}

export async function create(req, res) {
  const { name, currency = "USD" } = req.body;
  if (!name?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "name is required." });
  const dateError = validateEffectiveDates(req.body.effectiveDate, req.body.expirationDate);
  if (dateError) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: dateError });
  if (req.body.code) {
    const clash = await prisma.priceBook.findFirst({ where: { organizationId: req.organizationId, code: req.body.code } });
    if (clash) return res.status(409).json({ code: "SALES_DUPLICATE_CONFLICT", message: "A price book with this code already exists in this organization." });
  }

  const priceBook = await prisma.priceBook.create({
    data: {
      organizationId: req.organizationId, name: name.trim(), code: req.body.code, description: req.body.description, currency,
      priority: req.body.priority ?? 50, market: req.body.market, customerSegment: req.body.customerSegment, salesChannel: req.body.salesChannel,
      companyIds: req.body.companyIds || [], categories: req.body.categories || [], dealTypes: req.body.dealTypes || [], contractTypes: req.body.contractTypes || [],
      effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : null, expirationDate: req.body.expirationDate ? new Date(req.body.expirationDate) : null,
      status: req.body.status || "Draft", ownerMembershipId: req.membership?.id, createdByMembershipId: req.membership?.id, updatedByMembershipId: req.membership?.id,
    },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.price_book.created", targetType: "PriceBook", targetId: priceBook.id, result: "Success" });
  res.status(201).json({ priceBook: toApi(priceBook) });
}

export async function update(req, res) {
  const existing = await prisma.priceBook.findFirst({ where: { id: req.params.priceBookId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book not found." });
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "SALES_VERSION_CONFLICT", message: "This price book was updated by someone else. Refresh and try again." });
  }
  const dateError = validateEffectiveDates(req.body.effectiveDate ?? existing.effectiveDate, req.body.expirationDate ?? existing.expirationDate);
  if (dateError) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: dateError });

  // Existing Quote/Order/Contract snapshots already froze their prices at
  // creation — changing a Price Book here never rewrites those documents.
  const { version, id, organizationId, createdAt, entries, ...rest } = req.body;
  if ("effectiveDate" in rest) rest.effectiveDate = rest.effectiveDate ? new Date(rest.effectiveDate) : null;
  if ("expirationDate" in rest) rest.expirationDate = rest.expirationDate ? new Date(rest.expirationDate) : null;

  const priceBook = await prisma.priceBook.update({ where: { id: existing.id }, data: { ...rest, updatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.price_book.updated", targetType: "PriceBook", targetId: priceBook.id, result: "Success" });
  res.json({ priceBook: toApi(priceBook) });
}

export async function archive(req, res) {
  const existing = await prisma.priceBook.findFirst({ where: { id: req.params.priceBookId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book not found." });
  const priceBook = await prisma.priceBook.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), statusBeforeArchive: existing.status, status: "Archived", version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.price_book.archived", targetType: "PriceBook", targetId: priceBook.id, result: "Success" });
  res.json({ priceBook: toApi(priceBook) });
}

export async function restore(req, res) {
  const existing = await prisma.priceBook.findFirst({ where: { id: req.params.priceBookId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book not found." });
  const priceBook = await prisma.priceBook.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, status: existing.statusBeforeArchive || "Draft", statusBeforeArchive: null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.price_book.restored", targetType: "PriceBook", targetId: priceBook.id, result: "Success" });
  res.json({ priceBook: toApi(priceBook) });
}

export async function createEntry(req, res) {
  const priceBook = await prisma.priceBook.findFirst({ where: { id: req.params.priceBookId, organizationId: req.organizationId } });
  if (!priceBook) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book not found." });
  const { catalogItemId, adjustmentType = "Fixed Price", adjustmentValue = 0, currency } = req.body;
  if (!catalogItemId) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "catalogItemId is required." });

  const catalogItem = await prisma.catalogItem.findFirst({ where: { id: catalogItemId, organizationId: req.organizationId } });
  if (!catalogItem) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "catalogItemId must reference a catalog item in this organization." });
  if (catalogItem.archived) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "An archived catalog item cannot be added to a Price Book entry." });

  const dateError = validateEffectiveDates(req.body.effectiveDate, req.body.expirationDate);
  if (dateError) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: dateError });

  const entry = await prisma.priceBookEntry.create({
    data: {
      priceBookId: priceBook.id, catalogItemId, currency: currency || priceBook.currency, adjustmentType, adjustmentValue,
      tiers: req.body.tiers || [], minQuantity: req.body.minQuantity, maxQuantity: req.body.maxQuantity, billingInterval: req.body.billingInterval,
      effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : null, expirationDate: req.body.expirationDate ? new Date(req.body.expirationDate) : null, notes: req.body.notes,
    },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.price_book.entry_created", targetType: "PriceBookEntry", targetId: entry.id, result: "Success" });
  res.status(201).json({ entry: toApi(entry) });
}

export async function updateEntry(req, res) {
  const priceBook = await prisma.priceBook.findFirst({ where: { id: req.params.priceBookId, organizationId: req.organizationId } });
  if (!priceBook) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book not found." });
  const existing = await prisma.priceBookEntry.findFirst({ where: { id: req.params.entryId, priceBookId: priceBook.id } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book entry not found." });

  const dateError = validateEffectiveDates(req.body.effectiveDate ?? existing.effectiveDate, req.body.expirationDate ?? existing.expirationDate);
  if (dateError) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: dateError });

  const { id, priceBookId, catalogItemId, ...rest } = req.body;
  if ("effectiveDate" in rest) rest.effectiveDate = rest.effectiveDate ? new Date(rest.effectiveDate) : null;
  if ("expirationDate" in rest) rest.expirationDate = rest.expirationDate ? new Date(rest.expirationDate) : null;

  const entry = await prisma.priceBookEntry.update({ where: { id: existing.id }, data: rest });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.price_book.entry_updated", targetType: "PriceBookEntry", targetId: entry.id, result: "Success" });
  res.json({ entry: toApi(entry) });
}
