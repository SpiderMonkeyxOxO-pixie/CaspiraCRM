import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { normalizeEmail, normalizePhone } from "../../services/crm/normalizationService.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";
import { findLeadDuplicateCandidates } from "../../services/crm/duplicateDetectionService.js";
import { convertLead as runLeadConversion } from "../../services/crm/leadConversionService.js";
import { leadSummary, recentlyCreatedLeads, recentlyUpdatedLeads } from "../../services/crm/crmSummaryService.js";
import { recordIdempotentResponse } from "../../middleware/idempotency.js";
import { pickWritable } from "../../utils/pickWritable.js";

const MAX_PAGE_SIZE = 100;
const SORTABLE_FIELDS = new Set(["createdAt", "updatedAt", "name", "status", "priority", "score", "nextActionDate"]);
const MAX_BULK_BATCH_SIZE = 200;

// The only fields a client may write on create/update (see pickWritable).
const WRITABLE_FIELDS = [
  "name", "firstName", "lastName", "companyName", "email", "phone", "source", "status", "priority", "score",
  "ownerMembershipId", "department", "team", "country", "region", "city", "lifecycleStage", "qualificationStatus",
  "estimatedValue", "currency", "nextActionText", "nextActionDate", "lastContactDate", "doNotContact",
  "jobTitle", "preferredContactChannel", "interestedProduct", "consent", "disqualifyReason", "description",
];
const REASON_REQUIRED_STATUSES = ["Unqualified", "Duplicate", "Spam"];

const pickLeadFields = (body) =>
  pickWritable(body, WRITABLE_FIELDS, { dates: ["nextActionDate", "lastContactDate"], numbers: ["score", "estimatedValue"] });

function scopeWhere(req) {
  return resolveCrmScopeWhere(req, "leads", { ownerField: "ownerMembershipId" });
}

function buildListWhere(req) {
  const q = req.query;
  const where = { organizationId: req.organizationId, ...scopeWhere(req) };
  where.archived = q.archived === "true";

  if (q.search) {
    where.OR = [
      { name: { contains: q.search, mode: "insensitive" } },
      { companyName: { contains: q.search, mode: "insensitive" } },
      { email: { contains: q.search, mode: "insensitive" } },
    ];
  }
  if (q.status) where.status = q.status;
  if (q.source) where.source = q.source;
  if (q.priority) where.priority = q.priority;
  if (q.ownerMembershipId) where.ownerMembershipId = q.ownerMembershipId;
  if (q.department) where.department = q.department;
  if (q.team) where.team = q.team;
  if (q.converted === "true") where.status = "Converted";
  if (q.converted === "false") where.status = { not: "Converted" };
  if (q.createdFrom || q.createdTo) {
    where.createdAt = {};
    if (q.createdFrom) where.createdAt.gte = new Date(q.createdFrom);
    if (q.createdTo) where.createdAt.lte = new Date(q.createdTo);
  }
  if (q.updatedFrom || q.updatedTo) {
    where.updatedAt = {};
    if (q.updatedFrom) where.updatedAt.gte = new Date(q.updatedFrom);
    if (q.updatedTo) where.updatedAt.lte = new Date(q.updatedTo);
  }
  if (q.followUpOverdue === "true") {
    where.nextActionDate = { lt: new Date() };
    where.status = { not: "Converted" };
  }
  if (q.followUpFrom || q.followUpTo) {
    where.nextActionDate = { ...(where.nextActionDate || {}) };
    if (q.followUpFrom) where.nextActionDate.gte = new Date(q.followUpFrom);
    if (q.followUpTo) where.nextActionDate.lte = new Date(q.followUpTo);
  }
  if (q.scoreMin !== undefined || q.scoreMax !== undefined) {
    where.score = {};
    if (q.scoreMin !== undefined) where.score.gte = Number(q.scoreMin);
    if (q.scoreMax !== undefined) where.score.lte = Number(q.scoreMax);
  }
  return where;
}

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const sortField = SORTABLE_FIELDS.has(req.query.sort) ? req.query.sort : "updatedAt";
  const sortOrder = req.query.order === "asc" ? "asc" : "desc";
  const where = buildListWhere(req);

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where, orderBy: [{ [sortField]: sortOrder }, { id: "asc" }], // stable secondary sort
      skip: (page - 1) * pageSize, take: pageSize,
    }),
    prisma.lead.count({ where }),
  ]);

  res.json({ leads: toApi(leads), total, page, pageSize });
}

export async function getOne(req, res) {
  const lead = await prisma.lead.findFirst({ where: { id: req.params.leadId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!lead) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Lead not found." });
  res.json({ lead: toApi(lead) });
}

export async function create(req, res) {
  const fields = pickLeadFields(req.body);
  if (!fields.name && (fields.firstName || fields.lastName)) fields.name = [fields.firstName, fields.lastName].filter(Boolean).join(" ");
  const { email, phone, name, ownerMembershipId } = fields;
  if (!email && !phone && !name) {
    return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "At least a name, email, or phone is required." });
  }
  if (ownerMembershipId) {
    const membership = await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
    if (!membership) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  }

  const lead = await prisma.lead.create({
    data: {
      ...fields, organizationId: req.organizationId, ownerMembershipId: ownerMembershipId || null,
      normalizedEmail: normalizeEmail(email), normalizedPhone: normalizePhone(phone),
      createdByMembershipId: req.membership?.id || null, updatedByMembershipId: req.membership?.id || null,
    },
  });

  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.lead.created", targetType: "Lead", targetId: lead.id, result: "Success" });
  res.status(201).json({ lead: toApi(lead) });
}

export async function update(req, res) {
  const existing = await prisma.lead.findFirst({ where: { id: req.params.leadId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Lead not found." });
  if (existing.archived) return res.status(400).json({ code: "CRM_INVALID_TRANSITION", message: "An archived lead cannot be edited — restore it first." });

  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "CRM_VERSION_CONFLICT", message: "This lead was updated by someone else. Refresh and try again." });
  }
  if (req.body.ownerMembershipId) {
    const membership = await prisma.organizationMembership.findFirst({ where: { id: req.body.ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
    if (!membership) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  }

  const rest = pickLeadFields(req.body);
  if (rest.status && REASON_REQUIRED_STATUSES.includes(rest.status) && !(rest.disqualifyReason || existing.disqualifyReason)?.trim()) {
    return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: `A reason is required to set status to ${rest.status}.` });
  }
  const data = { ...rest, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } };
  if ("email" in rest) data.normalizedEmail = normalizeEmail(rest.email);
  if ("phone" in rest) data.normalizedPhone = normalizePhone(rest.phone);

  const lead = await prisma.lead.update({ where: { id: existing.id }, data });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.lead.updated", targetType: "Lead", targetId: lead.id, result: "Success", before: toApi(existing), after: toApi(lead) });
  res.json({ lead: toApi(lead) });
}

export async function archive(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "A reason is required to archive a lead." });
  const existing = await prisma.lead.findFirst({ where: { id: req.params.leadId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Lead not found." });

  const lead = await prisma.lead.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), archivedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.lead.archived", targetType: "Lead", targetId: lead.id, result: "Success", reason: req.body.reason });
  res.json({ lead: toApi(lead) });
}

export async function restore(req, res) {
  const existing = await prisma.lead.findFirst({ where: { id: req.params.leadId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Lead not found." });

  const lead = await prisma.lead.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, archivedAt: null, archivedByMembershipId: null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.lead.restored", targetType: "Lead", targetId: lead.id, result: "Success" });
  res.json({ lead: toApi(lead) });
}

export async function assign(req, res) {
  const { ownerMembershipId } = req.body;
  if (!ownerMembershipId) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "ownerMembershipId is required." });
  const membership = await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
  if (!membership) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });

  const existing = await prisma.lead.findFirst({ where: { id: req.params.leadId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Lead not found." });

  const lead = await prisma.lead.update({ where: { id: existing.id }, data: { ownerMembershipId, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.lead.assigned", targetType: "Lead", targetId: lead.id, result: "Success", after: { ownerMembershipId } });
  res.json({ lead: toApi(lead) });
}

export async function duplicateCandidates(req, res) {
  const lead = await prisma.lead.findFirst({ where: { id: req.params.leadId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!lead) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Lead not found." });

  const candidates = await findLeadDuplicateCandidates(req.organizationId, lead, scopeWhere(req));
  res.json({ candidates: candidates.map((c) => ({ record: toApi(c.record), matchedRules: c.matchedRules })) });
}

export async function convert(req, res) {
  const result = await runLeadConversion({
    organizationId: req.organizationId, leadId: req.params.leadId,
    actorUserId: req.user.id, actorMembershipId: req.membership?.id,
    ...requestContext(req),
    contactId: req.body.contactId, companyId: req.body.companyId,
    createContact: req.body.createContact !== false, createCompany: req.body.createCompany !== false,
  });
  if (result.error) {
    const { status, ...body } = result.error;
    await recordIdempotentResponse(req, status, body);
    return res.status(status).json(body);
  }
  const body = { lead: toApi(result.lead), contact: toApi(result.contact), company: toApi(result.company) };
  await recordIdempotentResponse(req, 200, body);
  res.json(body);
}

export async function summary(req, res) {
  // Same filters as the list (minus pagination), so summary cards reflect
  // whatever the list is currently filtered to.
  const { organizationId, archived, ...filterWhere } = buildListWhere(req);
  const data = await leadSummary(req.organizationId, filterWhere);
  const [recentlyCreated, recentlyUpdated] = await Promise.all([
    recentlyCreatedLeads(req.organizationId, scopeWhere(req)),
    recentlyUpdatedLeads(req.organizationId, scopeWhere(req)),
  ]);
  res.json({ ...data, recentlyCreated: toApi(recentlyCreated), recentlyUpdated: toApi(recentlyUpdated) });
}

export async function bulk(req, res) {
  const { action, ids, reason, ownerMembershipId, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "ids must be a non-empty array." });
  if (ids.length > MAX_BULK_BATCH_SIZE) return res.status(400).json({ code: "CRM_BATCH_LIMIT_EXCEEDED", message: `A bulk operation may include at most ${MAX_BULK_BATCH_SIZE} records.` });
  if ((action === "archive" || action === "restore") && !reason?.trim()) {
    return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "A reason is required for bulk archive/restore." });
  }

  // Per-record authorization: only records within scope and organization
  // are ever touched — an id outside scope is silently excluded from
  // `affected`, never disclosed as "exists but forbidden."
  const authorizedIds = (await prisma.lead.findMany({ where: { id: { in: ids }, organizationId: req.organizationId, ...scopeWhere(req) }, select: { id: true } })).map((l) => l.id);

  let data;
  if (action === "assign") {
    if (!ownerMembershipId) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "ownerMembershipId is required." });
    const membership = await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
    if (!membership) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
    data = { ownerMembershipId };
  } else if (action === "status") {
    if (!status) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "status is required." });
    data = { status };
  } else if (action === "archive") {
    data = { archived: true, archiveReason: reason, archivedAt: new Date(), archivedByMembershipId: req.membership?.id || null };
  } else if (action === "restore") {
    data = { archived: false, archiveReason: null, archivedAt: null, archivedByMembershipId: null };
  } else {
    return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: `Unsupported bulk action "${action}".` });
  }

  await prisma.lead.updateMany({ where: { id: { in: authorizedIds } }, data: { ...data, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: `crm.lead.bulk_${action}`, result: "Success", after: { affectedCount: authorizedIds.length, requestedCount: ids.length }, reason });

  res.json({ affected: authorizedIds.length, requested: ids.length, skipped: ids.length - authorizedIds.length });
}
