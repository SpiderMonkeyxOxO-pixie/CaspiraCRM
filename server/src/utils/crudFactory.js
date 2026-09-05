import prisma from "../lib/prisma.js";
import { toApi } from "./serialize.js";

// Generates list/get/create/update/archive/restore handlers for a Prisma
// model. Covers the majority of the ~150 mocked endpoints this backend
// replaces (list+get+create+update+archive+restore across ~25 entities);
// modules with real status-transition business logic (Deals, Quotes,
// Orders, Contracts, Tickets) layer bespoke handlers on top of this in
// their own controller files rather than forcing that logic in here.
export function crudFactory({
  model, // Prisma model name, e.g. "company"
  entityName, // human label for error messages, e.g. "Company"
  responseKey, // JSON response key for a single record, e.g. "company"
  listKey, // JSON response key for a list, e.g. "companies" — defaults to responseKey + "s", which is wrong for "company"/"activity"; pass this explicitly for any irregular plural
  searchFields = [], // string fields eligible for a `search` query param
  defaultInclude = undefined,
  supportsArchive = true,
  beforeCreate = (payload) => payload,
  beforeUpdate = (payload) => payload,
}) {
  const db = prisma[model];
  const plural = listKey || responseKey + "s";

  const list = async (req, res) => {
    const { search, archived, ...filters } = req.query;
    const where = {};

    if (supportsArchive) {
      where.archived = archived === "true";
    }
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === "") return;
      // Scalar equality filters only — every list endpoint's more advanced
      // filtering (date ranges, derived-status filters) already happens
      // client-side against the full set, matching how the mock layer's
      // queryXLocal() functions work today.
      where[key] = value;
    });
    if (search && searchFields.length > 0) {
      where.OR = searchFields.map((field) => ({ [field]: { contains: search, mode: "insensitive" } }));
    }

    const records = await db.findMany({ where, include: defaultInclude, orderBy: { updatedAt: "desc" } });
    res.json({ [plural]: toApi(records) });
  };

  const getOne = async (req, res) => {
    const record = await db.findUnique({ where: { id: req.params.id }, include: defaultInclude });
    if (!record) return res.status(404).json({ message: `${entityName} not found` });
    res.json({ [responseKey]: toApi(record) });
  };

  const create = async (req, res) => {
    const payload = await beforeCreate(req.body, req);
    const record = await db.create({ data: payload, include: defaultInclude });
    res.status(201).json({ [responseKey]: toApi(record) });
  };

  const update = async (req, res) => {
    const existing = await db.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: `${entityName} not found` });
    const payload = await beforeUpdate(req.body, req, existing);
    const record = await db.update({ where: { id: req.params.id }, data: payload, include: defaultInclude });
    res.json({ [responseKey]: toApi(record) });
  };

  const archive = async (req, res) => {
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ message: "A reason is required to archive" });
    const existing = await db.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: `${entityName} not found` });
    const record = await db.update({
      where: { id: req.params.id },
      data: { archived: true, archiveReason: reason, archivedAt: new Date(), statusBeforeArchive: existing.status ?? null },
    });
    res.json({ [responseKey]: toApi(record) });
  };

  const restore = async (req, res) => {
    const existing = await db.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: `${entityName} not found` });
    const record = await db.update({
      where: { id: req.params.id },
      data: {
        archived: false,
        archiveReason: null,
        archivedAt: null,
        ...(existing.statusBeforeArchive !== undefined ? { status: existing.statusBeforeArchive || "Draft", statusBeforeArchive: null } : {}),
      },
    });
    res.json({ [responseKey]: toApi(record) });
  };

  const bulkAssign = async (req, res) => {
    const { ids, ownerId } = req.body;
    const idField = responseKey + "Ids"; // unused, kept for readability
    void idField;
    await db.updateMany({ where: { id: { in: ids || [] } }, data: { ownerId } });
    const records = await db.findMany({ where: { id: { in: ids || [] } } });
    res.json({ [plural]: toApi(records) });
  };

  const bulkArchive = async (req, res) => {
    const { ids, reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ message: "A reason is required to archive" });
    await db.updateMany({ where: { id: { in: ids || [] } }, data: { archived: true, archiveReason: reason, archivedAt: new Date() } });
    const records = await db.findMany({ where: { id: { in: ids || [] } } });
    res.json({ [plural]: toApi(records) });
  };

  return { list, getOne, create, update, archive, restore, bulkAssign, bulkArchive };
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
