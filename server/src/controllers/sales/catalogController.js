import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { pickWritable } from "../../utils/pickWritable.js";
import { authorizeOrgAccess } from "../../middleware/rbac.js";

const MAX_PAGE_SIZE = 100;
const MAX_BULK_BATCH_SIZE = 200;

// The only fields a client may write on create/update (see pickWritable).
// Archive state moves through /archive and /restore; costPreview is
// dropped for callers who can't view cost (see catalogFields below).
const WRITABLE_FIELDS = [
  "name", "sku", "type", "category", "shortDescription", "description", "status", "billingModel", "billingInterval", "unit",
  "standardPrice", "currency", "alternativePrices", "costPreview", "taxCategory", "discountEligible", "minQuantity", "maxQuantity",
  "effectiveDate", "expirationDate", "ownerMembershipId", "tags", "includedItems", "optionalAddOnIds", "compatibleParentIds",
  "termsSummary", "internalNotes", "customerFacingDescription", "usageConfig", "recurringConfig", "tieredPricing",
  "promotionalPrice", "promotionalUntil", "upcomingPriceChange",
];

function catalogFields(req) {
  const fields = pickWritable(req.body, WRITABLE_FIELDS, {
    dates: ["effectiveDate", "expirationDate", "promotionalUntil"],
    numbers: ["standardPrice", "costPreview", "minQuantity", "maxQuantity", "promotionalPrice"],
  });
  if (!canViewCost(req)) delete fields.costPreview;
  if (fields.status === "Archived") delete fields.status; // only /archive archives
  return fields;
}

async function ownerInOrg(req, ownerMembershipId) {
  return !ownerMembershipId || !!(await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId: req.organizationId, status: "Active" } }));
}

function canViewCost(req) {
  if (req.isSystemOwnerOverride) return true;
  return (req.membership?.roles || []).some((mr) => (mr.role.permissionGrants || []).some((g) => g.moduleId === "products_services" && g.actions.includes("view_financial_fields")));
}

// Product cost and margin are sensitive — never exposed through the
// general catalog endpoints without the view_financial_fields grant,
// matching Phase 2's maskSensitive()/maskFinancial() pattern.
function maskCost(item, req) {
  if (canViewCost(req)) return item;
  const { costPreview, ...rest } = item;
  return { ...rest, costFieldsRedacted: true };
}

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const q = req.query;
  const where = { organizationId: req.organizationId };
  where.archived = q.archived === "true";
  if (q.search) where.OR = [{ name: { contains: q.search, mode: "insensitive" } }, { sku: { contains: q.search, mode: "insensitive" } }];
  if (q.type) where.type = q.type;
  if (q.category) where.category = q.category;
  if (q.status) where.status = q.status;

  const [items, total] = await Promise.all([
    prisma.catalogItem.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.catalogItem.count({ where }),
  ]);
  res.json({ products: toApi(items.map((i) => maskCost(i, req))), total, page, pageSize });
}

export async function getOne(req, res) {
  const item = await prisma.catalogItem.findFirst({ where: { id: req.params.itemId, organizationId: req.organizationId } });
  if (!item) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Catalog item not found." });
  res.json({ product: toApi(maskCost(item, req)) });
}

export async function create(req, res) {
  const fields = catalogFields(req);
  const { name, sku, type = "Product", standardPrice = 0, currency = "USD" } = fields;
  if (!name?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "name is required." });
  if (!(await ownerInOrg(req, fields.ownerMembershipId))) {
    return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  }
  if (Number(standardPrice) < 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "standardPrice cannot be negative." });
  if ((type === "Product" || type === "Service") && !sku?.trim()) {
    return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "sku is required for a Product or Service." });
  }

  if (sku) {
    const clash = await prisma.catalogItem.findFirst({ where: { organizationId: req.organizationId, sku } });
    if (clash) return res.status(409).json({ code: "SALES_DUPLICATE_CONFLICT", message: "A catalog item with this SKU already exists in this organization." });
  }

  const item = await prisma.catalogItem.create({
    data: {
      ...fields, organizationId: req.organizationId, name: name.trim(), sku: sku || null, type, standardPrice, currency, status: fields.status || "Draft",
      ownerMembershipId: fields.ownerMembershipId || req.membership?.id, createdByMembershipId: req.membership?.id, updatedByMembershipId: req.membership?.id,
    },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.catalog_item.created", targetType: "CatalogItem", targetId: item.id, result: "Success" });
  res.status(201).json({ product: toApi(maskCost(item, req)) });
}

export async function update(req, res) {
  const existing = await prisma.catalogItem.findFirst({ where: { id: req.params.itemId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Catalog item not found." });
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "SALES_VERSION_CONFLICT", message: "This catalog item was updated by someone else. Refresh and try again." });
  }
  if (req.body.standardPrice !== undefined && Number(req.body.standardPrice) < 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "standardPrice cannot be negative." });

  if (req.body.sku && req.body.sku !== existing.sku) {
    const clash = await prisma.catalogItem.findFirst({ where: { organizationId: req.organizationId, sku: req.body.sku, id: { not: existing.id } } });
    if (clash) return res.status(409).json({ code: "SALES_DUPLICATE_CONFLICT", message: "A catalog item with this SKU already exists in this organization." });
  }

  // Historical documents (Deal/Quote/Order/Contract line items) already
  // snapshot name/price/sku at creation time — a catalog change never
  // rewrites those. This affects only future reads/new line items.
  const rest = catalogFields(req);
  if (!(await ownerInOrg(req, rest.ownerMembershipId))) {
    return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  }
  const item = await prisma.catalogItem.update({ where: { id: existing.id }, data: { ...rest, updatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.catalog_item.updated", targetType: "CatalogItem", targetId: item.id, result: "Success", before: toApi(maskCost(existing, req)), after: toApi(maskCost(item, req)) });
  res.json({ product: toApi(maskCost(item, req)) });
}

export async function archive(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required to archive a catalog item." });
  const existing = await prisma.catalogItem.findFirst({ where: { id: req.params.itemId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Catalog item not found." });
  const item = await prisma.catalogItem.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), statusBeforeArchive: existing.status, status: "Archived", version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.catalog_item.archived", targetType: "CatalogItem", targetId: item.id, result: "Success" });
  res.json({ product: toApi(maskCost(item, req)) });
}

export async function restore(req, res) {
  const existing = await prisma.catalogItem.findFirst({ where: { id: req.params.itemId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Catalog item not found." });
  const item = await prisma.catalogItem.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, archivedAt: null, status: existing.statusBeforeArchive || "Draft", statusBeforeArchive: null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.catalog_item.restored", targetType: "CatalogItem", targetId: item.id, result: "Success" });
  res.json({ product: toApi(maskCost(item, req)) });
}

export async function bulk(req, res) {
  const { action, ids, reason, ownerMembershipId, category, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "ids must be a non-empty array." });
  if (ids.length > MAX_BULK_BATCH_SIZE) return res.status(400).json({ code: "SALES_BATCH_LIMIT_EXCEEDED", message: `A bulk operation may include at most ${MAX_BULK_BATCH_SIZE} records.` });

  const authorized = await prisma.catalogItem.findMany({ where: { id: { in: ids }, organizationId: req.organizationId } });
  let targets = authorized;
  let data;
  if (action === "assign") {
    if (!ownerMembershipId || !(await ownerInOrg(req, ownerMembershipId))) {
      return res.status(400).json({ code: "SALES_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
    }
    data = { ownerMembershipId };
  } else if (action === "category") {
    if (!category?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "category is required." });
    data = { category };
  } else if (action === "status") {
    if (!status || status === "Archived") return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A valid status is required (use the archive action to archive)." });
    targets = authorized.filter((i) => !i.archived);
    data = { status };
  } else if (action === "archive") {
    if (!reason?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "A reason is required for bulk archive." });
    if (!req.isSystemOwnerOverride && !(await authorizeOrgAccess(req.user, req.organizationId, "products_services", "archive")).ok) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not have permission to archive catalog items." });
    }
    targets = authorized.filter((i) => !i.archived);
    // statusBeforeArchive differs per item, so each is archived individually.
    await prisma.$transaction(targets.map((i) => prisma.catalogItem.update({
      where: { id: i.id },
      data: { archived: true, archiveReason: reason, archivedAt: new Date(), statusBeforeArchive: i.status, status: "Archived", version: { increment: 1 } },
    })));
  } else {
    return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: `Unsupported bulk action "${action}".` });
  }

  const targetIds = targets.map((i) => i.id);
  if (data) await prisma.catalogItem.updateMany({ where: { id: { in: targetIds } }, data: { ...data, updatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: `sales.catalog_item.bulk_${action}`, result: "Success", reason, after: { affectedCount: targetIds.length, requestedCount: ids.length } });
  res.json({ affected: targetIds.length, requested: ids.length, skipped: ids.length - targetIds.length });
}
