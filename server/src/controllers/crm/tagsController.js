import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { normalizeTagName, isValidTagColorToken } from "../../services/crm/normalizationService.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";

const RECORD_FK_FIELDS = ["leadId", "contactId", "companyId", "activityId", "dealId"];
const RECORD_MODEL = { leadId: "lead", contactId: "contact", companyId: "company", activityId: "activity", dealId: "deal" };
const RECORD_MODULE = { leadId: "leads", contactId: "contacts", companyId: "companies", activityId: "activities", dealId: "deals" };
// Never construct a dynamic table/model name from client input beyond this
// fixed allowlist — the same discipline the notes association uses.
const ALLOWED_RECORD_TYPES = new Set(Object.keys(RECORD_MODEL));

function pickRecordField(source) {
  const set = RECORD_FK_FIELDS.filter((f) => source[f]);
  if (set.length !== 1) return null;
  return set[0];
}

async function assertRecordInScope(req, field, recordId) {
  const model = RECORD_MODEL[field];
  const scopeWhere = resolveCrmScopeWhere(req, RECORD_MODULE[field], { ownerField: "ownerMembershipId", assignedField: field === "activityId" ? "assignedMembershipId" : null });
  const record = await prisma[model].findFirst({ where: { id: recordId, organizationId: req.organizationId, ...scopeWhere } });
  return !!record;
}

export async function list(req, res) {
  const where = { organizationId: req.organizationId };
  if (req.query.archived !== "true") where.archivedAt = null;
  const tags = await prisma.crmTag.findMany({ where, orderBy: { name: "asc" } });
  res.json({ tags: toApi(tags) });
}

export async function create(req, res) {
  const { name, colorToken } = req.body;
  if (!name?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "name is required." });
  if (!isValidTagColorToken(colorToken)) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "colorToken must be a recognized color name." });

  const normalizedName = normalizeTagName(name);
  const existing = await prisma.crmTag.findFirst({ where: { organizationId: req.organizationId, normalizedName } });
  if (existing) return res.status(409).json({ code: "CRM_DUPLICATE_CONFLICT", message: "A tag with this name already exists in this organization." });

  const tag = await prisma.crmTag.create({ data: { organizationId: req.organizationId, name: name.trim(), normalizedName, colorToken: colorToken || null, createdByMembershipId: req.membership?.id || null } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.tag.created", targetType: "CrmTag", targetId: tag.id, result: "Success" });
  res.status(201).json({ tag: toApi(tag) });
}

export async function update(req, res) {
  const existing = await prisma.crmTag.findFirst({ where: { id: req.params.tagId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Tag not found." });
  const data = {};
  if (req.body.name !== undefined) {
    if (!req.body.name?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "name cannot be empty." });
    const normalizedName = normalizeTagName(req.body.name);
    const clash = await prisma.crmTag.findFirst({ where: { organizationId: req.organizationId, normalizedName, id: { not: existing.id } } });
    if (clash) return res.status(409).json({ code: "CRM_DUPLICATE_CONFLICT", message: "A tag with this name already exists in this organization." });
    data.name = req.body.name.trim();
    data.normalizedName = normalizedName;
  }
  if (req.body.colorToken !== undefined) {
    if (!isValidTagColorToken(req.body.colorToken)) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "colorToken must be a recognized color name." });
    data.colorToken = req.body.colorToken;
  }
  const tag = await prisma.crmTag.update({ where: { id: existing.id }, data });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.tag.updated", targetType: "CrmTag", targetId: tag.id, result: "Success" });
  res.json({ tag: toApi(tag) });
}

export async function archive(req, res) {
  const existing = await prisma.crmTag.findFirst({ where: { id: req.params.tagId, organizationId: req.organizationId } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Tag not found." });
  const tag = await prisma.crmTag.update({ where: { id: existing.id }, data: { archivedAt: new Date() } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.tag.archived", targetType: "CrmTag", targetId: tag.id, result: "Success" });
  res.json({ tag: toApi(tag) });
}

export async function assign(req, res) {
  const { tagId } = req.body;
  const field = pickRecordField(req.body);
  if (!tagId || !field) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "tagId and exactly one of leadId, contactId, companyId, or activityId are required." });
  if (!ALLOWED_RECORD_TYPES.has(field)) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "Unsupported record type." });

  const tag = await prisma.crmTag.findFirst({ where: { id: tagId, organizationId: req.organizationId } });
  if (!tag) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Tag not found." });
  const recordId = req.body[field];
  if (!(await assertRecordInScope(req, field, recordId))) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Record not found." });

  const recordTag = await prisma.crmRecordTag.upsert({
    where: { [`tagId_${field}`]: { tagId, [field]: recordId } },
    update: {},
    create: { tagId, [field]: recordId },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.tag.assigned", targetType: "CrmRecordTag", targetId: recordTag.id, result: "Success", after: { tagId, [field]: recordId } });
  res.status(201).json({ recordTag: toApi(recordTag) });
}

export async function unassign(req, res) {
  const field = pickRecordField(req.query);
  const { tagId } = req.params;
  if (!field) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "Exactly one of leadId, contactId, companyId, or activityId is required." });
  const recordId = req.query[field];

  const recordTag = await prisma.crmRecordTag.findFirst({ where: { tagId, [field]: recordId, tag: { organizationId: req.organizationId } } });
  if (!recordTag) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Tag assignment not found." });
  if (!(await assertRecordInScope(req, field, recordId))) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Record not found." });

  await prisma.crmRecordTag.delete({ where: { id: recordTag.id } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.tag.unassigned", targetType: "CrmRecordTag", targetId: recordTag.id, result: "Success" });
  res.status(204).send();
}

export async function listForRecord(req, res) {
  const field = pickRecordField(req.query);
  if (!field) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "Exactly one of leadId, contactId, companyId, or activityId is required." });
  const recordId = req.query[field];
  if (!(await assertRecordInScope(req, field, recordId))) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Record not found." });

  const recordTags = await prisma.crmRecordTag.findMany({ where: { [field]: recordId, tag: { organizationId: req.organizationId } }, include: { tag: true } });
  res.json({ tags: toApi(recordTags.map((rt) => rt.tag)) });
}
