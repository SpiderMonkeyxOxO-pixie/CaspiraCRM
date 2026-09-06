import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";

const MAX_PAGE_SIZE = 100;

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
  const { name, sku, type = "Product", standardPrice = 0, currency = "USD" } = req.body;
  if (!name?.trim()) return res.status(400).json({ code: "SALES_VALIDATION_FAILED", message: "name is required." });
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
      organizationId: req.organizationId, name: name.trim(), sku: sku || null, type, category: req.body.category, description: req.body.description,
      status: req.body.status || "Draft", billingModel: req.body.billingModel, billingInterval: req.body.billingInterval, unit: req.body.unit,
      standardPrice, currency, costPreview: req.body.costPreview, taxCategory: req.body.taxCategory,
      ownerMembershipId: req.membership?.id, createdByMembershipId: req.membership?.id, updatedByMembershipId: req.membership?.id,
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
  const { version, id, organizationId, createdAt, ...rest } = req.body;
  const item = await prisma.catalogItem.update({ where: { id: existing.id }, data: { ...rest, updatedByMembershipId: req.membership?.id, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.catalog_item.updated", targetType: "CatalogItem", targetId: item.id, result: "Success", before: toApi(maskCost(existing, req)), after: toApi(maskCost(item, req)) });
  res.json({ product: toApi(maskCost(item, req)) });
}

export async function archive(req, res) {
  const existing = await prisma.catalogItem.findFirst({ where: { id: req.params.itemId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Catalog item not found." });
  const item = await prisma.catalogItem.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), statusBeforeArchive: existing.status, status: "Archived", version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.catalog_item.archived", targetType: "CatalogItem", targetId: item.id, result: "Success" });
  res.json({ product: toApi(maskCost(item, req)) });
}

export async function restore(req, res) {
  const existing = await prisma.catalogItem.findFirst({ where: { id: req.params.itemId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "SALES_RECORD_NOT_FOUND", message: "Catalog item not found." });
  const item = await prisma.catalogItem.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, status: existing.statusBeforeArchive || "Draft", statusBeforeArchive: null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "sales.catalog_item.restored", targetType: "CatalogItem", targetId: item.id, result: "Success" });
  res.json({ product: toApi(maskCost(item, req)) });
}
