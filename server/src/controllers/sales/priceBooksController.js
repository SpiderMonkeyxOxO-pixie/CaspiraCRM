import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { pickWritable } from "../../utils/pickWritable.js";
import { authorizeOrgAccess } from "../../middleware/rbac.js";
import { CURRENCY_SAFE_ADJUSTMENTS } from "../../services/sales/priceBookResolutionService.js";

const MAX_PAGE_SIZE = 100;
const MAX_BULK_BATCH_SIZE = 200;

// The only fields a client may write (see pickWritable). Archive state
// moves through /archive and /restore; entries through the entry endpoints.
const WRITABLE_FIELDS = [
  "name", "code", "description", "status", "priority", "currency", "market", "customerSegment", "companyIds", "salesChannel",
  "categories", "dealTypes", "contractTypes", "effectiveDate", "expirationDate", "ownerMembershipId", "tags",
];
const ENTRY_WRITABLE_FIELDS = [
  "currency", "adjustmentType", "adjustmentValue", "tiers", "minQuantity", "maxQuantity", "billingInterval", "effectiveDate",
  "expirationDate", "notes", "enabled",
];

function priceBookFields(body) {
  const fields = pickWritable(body, WRITABLE_FIELDS, { dates: ["effectiveDate", "expirationDate"], numbers: ["priority"] });
  if (fields.status === "Archived") delete fields.status; // only /archive archives
  return fields;
}

const entryFields = (body) =>
  pickWritable(body, ENTRY_WRITABLE_FIELDS, { dates: ["effectiveDate", "expirationDate"], numbers: ["adjustmentValue", "minQuantity", "maxQuantity"] });

function validateEffectiveDates(effectiveDate, expirationDate) {
  if (effectiveDate && expirationDate && new Date(expirationDate) < new Date(effectiveDate)) {
    return "expirationDate cannot be before effectiveDate.";
  }
  return null;
}

// companyIds and the owner must belong to this organization.
async function validateRefs(req, { companyIds, ownerMembershipId }) {
  if (Array.isArray(companyIds) && companyIds.length > 0) {
    const unique = [...new Set(companyIds)];
    const found = await prisma.company.count({ where: { id: { in: unique }, organizationId: req.organizationId } });
    if (found !== unique.length) return "companyIds must reference companies in this organization.";
  }
  if (ownerMembershipId) {
    const m = await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
    if (!m) return "ownerMembershipId must reference an active membership in this organization.";
  }
  return null;
}

// Percentage/fixed-amount adjustments need the catalog item's own currency
// (no live exchange rates) — rejected at save time, not first at pricing time.
function validateEntryCurrency({ currency, adjustmentType }, catalogItem) {
  if (currency && currency !== catalogItem.currency && adjustmentType && !CURRENCY_SAFE_ADJUSTMENTS.has(adjustmentType)) {
    return `A ${adjustmentType} adjustment requires the entry currency to match the catalog item's currency (${catalogItem.currency}).`;
  }
  return null;
}

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const where = { organizationId: req.organizationId };
  where.archived = req.query.archived === "true";
  if (req.query.search) where.name = { contains: req.query.search, mode: "insensitive" };
  if (req.query.currency) where.currency = req.query.currency;

  const [priceBooks, total] = await Promise.all([
    prisma.priceBook.findMany({ where, include: { entries: true }, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.priceBook.count({ where }),
  ]);
  res.json({ priceBooks: toApi(priceBooks), total, page, pageSize });
}

export async function getOne(req, res) {
  const priceBook = await prisma.priceBook.findFirst({ where: { id: req.params.priceBookId, organizationId: req.organizationId }, include: { entries: true } });
  if (!priceBook) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book not found." });
  res.json({ priceBook: toApi(priceBook) });
}

export async function create(req, res) {
  const fields = priceBookFields(req.body);
  if (!fields.name?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "name is required." });
  const dateError = validateEffectiveDates(fields.effectiveDate, fields.expirationDate);
  if (dateError) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: dateError });
  const refError = await validateRefs(req, fields);
  if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: refError });
  if (fields.code) {
    const clash = await prisma.priceBook.findFirst({ where: { organizationId: req.organizationId, code: fields.code } });
    if (clash) return res.status(409).json({ code: "SALES_DUPLICATE_CONFLICT", message: "A price book with this code already exists in this organization." });
  }

  const priceBook = await prisma.priceBook.create({
    data: {
      ...fields, organizationId: req.organizationId, name: fields.name.trim(), currency: fields.currency || "USD", priority: fields.priority ?? 50,
      companyIds: fields.companyIds || [], categories: fields.categories || [], dealTypes: fields.dealTypes || [], contractTypes: fields.contractTypes || [],
      status: fields.status || "Draft", ownerMembershipId: fields.ownerMembershipId || req.membership?.id,
      createdByMembershipId: req.membership?.id, updatedByMembershipId: req.membership?.id,
    },
    include: { entries: true },
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
  const rest = priceBookFields(req.body);
  const dateError = validateEffectiveDates(rest.effectiveDate ?? existing.effectiveDate, rest.expirationDate ?? existing.expirationDate);
  if (dateError) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: dateError });
  const refError = await validateRefs(req, rest);
  if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: refError });
  if (rest.code && rest.code !== existing.code) {
    const clash = await prisma.priceBook.findFirst({ where: { organizationId: req.organizationId, code: rest.code, id: { not: existing.id } } });
    if (clash) return res.status(409).json({ code: "SALES_DUPLICATE_CONFLICT", message: "A price book with this code already exists in this organization." });
  }

  // Existing Quote/Order/Contract snapshots already froze their prices at
  // creation — changing a Price Book here never rewrites those documents.
  const priceBook = await prisma.priceBook.update({
    where: { id: existing.id },
    data: { ...rest, updatedByMembershipId: req.membership?.id, version: { increment: 1 } },
    include: { entries: true },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.price_book.updated", targetType: "PriceBook", targetId: priceBook.id, result: "Success" });
  res.json({ priceBook: toApi(priceBook) });
}

export async function archive(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to archive a price book." });
  const existing = await prisma.priceBook.findFirst({ where: { id: req.params.priceBookId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book not found." });
  const priceBook = await prisma.priceBook.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), statusBeforeArchive: existing.status, status: "Archived", version: { increment: 1 } }, include: { entries: true } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.price_book.archived", targetType: "PriceBook", targetId: priceBook.id, result: "Success", reason: req.body.reason });
  res.json({ priceBook: toApi(priceBook) });
}

export async function restore(req, res) {
  const existing = await prisma.priceBook.findFirst({ where: { id: req.params.priceBookId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book not found." });
  const priceBook = await prisma.priceBook.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, archivedAt: null, status: existing.statusBeforeArchive || "Draft", statusBeforeArchive: null, version: { increment: 1 } }, include: { entries: true } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.price_book.restored", targetType: "PriceBook", targetId: priceBook.id, result: "Success" });
  res.json({ priceBook: toApi(priceBook) });
}

export async function createEntry(req, res) {
  const priceBook = await prisma.priceBook.findFirst({ where: { id: req.params.priceBookId, organizationId: req.organizationId } });
  if (!priceBook) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book not found." });
  const { catalogItemId } = req.body;
  if (!catalogItemId) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "catalogItemId is required." });

  const catalogItem = await prisma.catalogItem.findFirst({ where: { id: catalogItemId, organizationId: req.organizationId } });
  if (!catalogItem) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "catalogItemId must reference a catalog item in this organization." });
  if (catalogItem.archived) return res.status(400).json({ code: "SALES_INVALID_TRANSITION", message: "An archived catalog item cannot be added to a Price Book entry." });

  const fields = entryFields(req.body);
  const entry = { ...fields, adjustmentType: fields.adjustmentType || "Fixed Price", adjustmentValue: fields.adjustmentValue ?? 0, currency: fields.currency || priceBook.currency };
  const dateError = validateEffectiveDates(entry.effectiveDate, entry.expirationDate);
  if (dateError) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: dateError });
  const currencyError = validateEntryCurrency(entry, catalogItem);
  if (currencyError) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: currencyError });

  const created = await prisma.priceBookEntry.create({ data: { ...entry, tiers: entry.tiers || [], priceBookId: priceBook.id, catalogItemId } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.price_book.entry_created", targetType: "PriceBookEntry", targetId: created.id, result: "Success" });
  res.status(201).json({ entry: toApi(created) });
}

export async function updateEntry(req, res) {
  const priceBook = await prisma.priceBook.findFirst({ where: { id: req.params.priceBookId, organizationId: req.organizationId } });
  if (!priceBook) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book not found." });
  const existing = await prisma.priceBookEntry.findFirst({ where: { id: req.params.entryId, priceBookId: priceBook.id }, include: { catalogItem: true } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book entry not found." });

  const rest = entryFields(req.body);
  const dateError = validateEffectiveDates(rest.effectiveDate ?? existing.effectiveDate, rest.expirationDate ?? existing.expirationDate);
  if (dateError) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: dateError });
  const currencyError = validateEntryCurrency({ currency: rest.currency ?? existing.currency, adjustmentType: rest.adjustmentType ?? existing.adjustmentType }, existing.catalogItem);
  if (currencyError) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: currencyError });

  const entry = await prisma.priceBookEntry.update({ where: { id: existing.id }, data: rest });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.price_book.entry_updated", targetType: "PriceBookEntry", targetId: entry.id, result: "Success" });
  res.json({ entry: toApi(entry) });
}

export async function deleteEntry(req, res) {
  const priceBook = await prisma.priceBook.findFirst({ where: { id: req.params.priceBookId, organizationId: req.organizationId } });
  if (!priceBook) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book not found." });
  const existing = await prisma.priceBookEntry.findFirst({ where: { id: req.params.entryId, priceBookId: priceBook.id } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Price book entry not found." });
  // Quote/Order/Contract line items keep their own frozen price snapshot, so
  // removing an entry never changes an existing document.
  await prisma.priceBookEntry.delete({ where: { id: existing.id } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.price_book.entry_deleted", targetType: "PriceBookEntry", targetId: existing.id, result: "Success" });
  res.status(204).send();
}

export async function bulk(req, res) {
  const { action, ids, reason, ownerMembershipId, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "ids must be a non-empty array." });
  if (ids.length > MAX_BULK_BATCH_SIZE) return res.status(400).json({ code: "SALES_BATCH_LIMIT_EXCEEDED", message: `A bulk operation may include at most ${MAX_BULK_BATCH_SIZE} records.` });

  const authorized = await prisma.priceBook.findMany({ where: { id: { in: ids }, organizationId: req.organizationId } });
  let targets = authorized;
  let data;
  if (action === "assign") {
    const refError = ownerMembershipId ? await validateRefs(req, { ownerMembershipId }) : "ownerMembershipId is required.";
    if (refError) return res.status(400).json({ code: "SALES_OWNER_INVALID", message: refError });
    data = { ownerMembershipId };
  } else if (action === "status") {
    if (!status || status === "Archived") return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A valid status is required (use the archive action to archive)." });
    targets = authorized.filter((pb) => !pb.archived);
    data = { status };
  } else if (action === "archive") {
    if (!reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required for bulk archive." });
    if (!req.isSystemOwnerOverride && !(await authorizeOrgAccess(req.user, req.organizationId, "price_books", "archive")).ok) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not have permission to archive price books." });
    }
    targets = authorized.filter((pb) => !pb.archived);
    // statusBeforeArchive differs per price book, so each is archived individually.
    await prisma.$transaction(targets.map((pb) => prisma.priceBook.update({
      where: { id: pb.id },
      data: { archived: true, archiveReason: reason, archivedAt: new Date(), statusBeforeArchive: pb.status, status: "Archived", version: { increment: 1 } },
    })));
  } else {
    return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: `Unsupported bulk action "${action}".` });
  }

  const targetIds = targets.map((pb) => pb.id);
  if (data) await prisma.priceBook.updateMany({ where: { id: { in: targetIds } }, data: { ...data, updatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: `sales.price_book.bulk_${action}`, result: "Success", reason, after: { affectedCount: targetIds.length, requestedCount: ids.length } });
  res.json({ affected: targetIds.length, requested: ids.length, skipped: ids.length - targetIds.length });
}
