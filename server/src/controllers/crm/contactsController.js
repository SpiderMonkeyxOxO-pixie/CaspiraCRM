import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { normalizeEmail, normalizePhone } from "../../services/crm/normalizationService.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";
import { findContactDuplicateCandidates } from "../../services/crm/duplicateDetectionService.js";
import { mergePreview as runMergePreview, merge as runMerge } from "../../services/crm/mergeService.js";
import { crmContactSummary, recentlyCreated, recentlyUpdated } from "../../services/crm/crmContactCompanySummaryService.js";
import { authorizeOrgAccess } from "../../middleware/rbac.js";
import { recordIdempotentResponse } from "../../middleware/idempotency.js";
import { pickWritable } from "../../utils/pickWritable.js";

const MAX_PAGE_SIZE = 100;
const SORTABLE_FIELDS = new Set(["createdAt", "updatedAt", "name", "lifecycleStage"]);
const MAX_BULK_BATCH_SIZE = 200;

// The only fields a client may write on create/update (see pickWritable).
const WRITABLE_FIELDS = [
  "name", "firstName", "lastName", "email", "phone", "jobTitle", "companyId", "ownerMembershipId", "lifecycleStage", "department",
  "emailOptIn", "phoneOptIn", "smsOptIn", "marketingOptIn", "doNotContact", "doNotContactReason", "preferredChannel", "preferredLanguage",
  "country", "region", "city", "timeZone", "lastContactDate", "businessDepartment", "decisionMakingRole", "relationshipType", "source",
  "nextActionDate", "description",
];
const pickContactFields = (body) => pickWritable(body, WRITABLE_FIELDS, { dates: ["lastContactDate", "nextActionDate"] });

async function companyInOrg(req, companyId) {
  return !companyId || !!(await prisma.company.findFirst({ where: { id: companyId, organizationId: req.organizationId } }));
}

// Sensitive fields (personal email/phone/address/DNC/consent) are masked
// server-side for anyone without "view_sensitive_fields" on "contacts" —
// masking only in the frontend is explicitly not acceptable per the spec.
// Applied uniformly to list, detail, duplicate-candidates, exports, and
// merge previews — never selectively skipped for one surface.
const SENSITIVE_FIELDS = ["email", "phone", "normalizedEmail", "normalizedPhone", "country", "region", "city", "timeZone", "doNotContact", "emailOptIn", "phoneOptIn", "smsOptIn", "marketingOptIn"];

function maskSensitive(contact, canViewSensitive) {
  if (canViewSensitive || !contact) return contact;
  const masked = { ...contact };
  for (const field of SENSITIVE_FIELDS) if (field in masked) masked[field] = null;
  masked.sensitiveFieldsRedacted = true;
  return masked;
}

async function canViewSensitive(req) {
  if (req.isSystemOwnerOverride) return true;
  const result = await authorizeOrgAccess(req.user, req.organizationId, "contacts", "view_sensitive_fields");
  return result.ok;
}

function scopeWhere(req) {
  return resolveCrmScopeWhere(req, "contacts", { ownerField: "ownerMembershipId" });
}

function buildListWhere(req) {
  const q = req.query;
  const where = { organizationId: req.organizationId, ...scopeWhere(req) };
  where.archived = q.archived === "true";
  if (q.search) {
    where.OR = [
      { name: { contains: q.search, mode: "insensitive" } },
      { email: { contains: q.search, mode: "insensitive" } },
      { phone: { contains: q.search, mode: "insensitive" } },
    ];
  }
  if (q.lifecycleStage) where.lifecycleStage = q.lifecycleStage;
  if (q.ownerMembershipId) where.ownerMembershipId = q.ownerMembershipId;
  if (q.companyId) where.companyId = q.companyId;
  if (q.department) where.department = q.department;
  if (q.relationshipType) where.relationshipType = q.relationshipType;
  if (q.source) where.source = q.source;
  if (q.country) where.country = q.country;
  if (q.followUpOverdue === "true") where.nextActionDate = { lt: new Date() };
  if (q.createdFrom || q.createdTo) {
    where.createdAt = {};
    if (q.createdFrom) where.createdAt.gte = new Date(q.createdFrom);
    if (q.createdTo) where.createdAt.lte = new Date(q.createdTo);
  }
  return where;
}

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const sortField = SORTABLE_FIELDS.has(req.query.sort) ? req.query.sort : "updatedAt";
  const sortOrder = req.query.order === "asc" ? "asc" : "desc";
  const where = buildListWhere(req);
  const showSensitive = await canViewSensitive(req);

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({ where, include: { company: { select: { id: true, name: true } } }, orderBy: [{ [sortField]: sortOrder }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.contact.count({ where }),
  ]);
  res.json({ contacts: toApi(contacts).map((c) => maskSensitive(c, showSensitive)), total, page, pageSize });
}

export async function getOne(req, res) {
  const contact = await prisma.contact.findFirst({ where: { id: req.params.contactId, organizationId: req.organizationId, ...scopeWhere(req) }, include: { company: { select: { id: true, name: true } } } });
  if (!contact) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Contact not found." });
  const showSensitive = await canViewSensitive(req);
  res.json({ contact: maskSensitive(toApi(contact), showSensitive) });
}

export async function create(req, res) {
  const fields = pickContactFields(req.body);
  if (!fields.name && (fields.firstName || fields.lastName)) fields.name = [fields.firstName, fields.lastName].filter(Boolean).join(" ");
  const { name, email, phone, companyId, ownerMembershipId } = fields;
  if (!name?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "name is required." });

  if (!(await companyInOrg(req, companyId))) {
    return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "companyId must reference a company in this organization." });
  }
  if (ownerMembershipId) {
    const membership = await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
    if (!membership) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  }

  const contact = await prisma.contact.create({
    data: {
      ...fields, organizationId: req.organizationId, companyId: companyId || null, ownerMembershipId: ownerMembershipId || null,
      normalizedEmail: normalizeEmail(email), normalizedPhone: normalizePhone(phone),
      createdByMembershipId: req.membership?.id || null, updatedByMembershipId: req.membership?.id || null,
    },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.contact.created", targetType: "Contact", targetId: contact.id, result: "Success" });
  res.status(201).json({ contact: toApi(contact) });
}

export async function update(req, res) {
  const existing = await prisma.contact.findFirst({ where: { id: req.params.contactId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Contact not found." });
  if (existing.archived) return res.status(400).json({ code: "CRM_INVALID_TRANSITION", message: "An archived contact cannot be edited — restore it first." });
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "CRM_VERSION_CONFLICT", message: "This contact was updated by someone else. Refresh and try again." });
  }

  // Do-Not-Contact side effects: setting doNotContact true disables every
  // channel opt-in in the same update — never left for the frontend to
  // remember to also toggle.
  const rest = pickContactFields(req.body);
  if (!(await companyInOrg(req, rest.companyId))) {
    return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "companyId must reference a company in this organization." });
  }
  if (rest.ownerMembershipId) {
    const membership = await prisma.organizationMembership.findFirst({ where: { id: rest.ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
    if (!membership) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  }
  const data = { ...rest, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } };
  if ("email" in rest) data.normalizedEmail = normalizeEmail(rest.email);
  if ("phone" in rest) data.normalizedPhone = normalizePhone(rest.phone);
  if (rest.doNotContact === true) {
    data.emailOptIn = false; data.phoneOptIn = false; data.smsOptIn = false; data.marketingOptIn = false;
  }

  const contact = await prisma.contact.update({ where: { id: existing.id }, data });
  await recordAuditEvent({
    ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId,
    action: rest.doNotContact !== undefined && rest.doNotContact !== existing.doNotContact ? "crm.contact.do_not_contact_changed" : "crm.contact.updated",
    targetType: "Contact", targetId: contact.id, result: "Success", before: toApi(existing), after: toApi(contact),
  });
  res.json({ contact: toApi(contact) });
}

export async function archive(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "A reason is required to archive a contact." });
  const existing = await prisma.contact.findFirst({ where: { id: req.params.contactId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Contact not found." });

  // A Contact that's the ACTIVE primary on any company can't be archived
  // silently — the primary slot must be explicitly reassigned first
  // (matches "archived Contacts cannot remain the primary Contact without
  // an explicit warning and controlled reassignment").
  const activePrimaryFor = await prisma.companyContactRelationship.findMany({ where: { contactId: existing.id, isPrimaryContact: true, endDate: null } });
  if (activePrimaryFor.length > 0 && req.query.confirmPrimaryReassignment !== "true") {
    return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "This contact is the primary contact for one or more companies. Reassign the primary contact first, or resubmit with confirmPrimaryReassignment=true.", companyIds: activePrimaryFor.map((r) => r.companyId) });
  }

  const contact = await prisma.contact.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), archivedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.contact.archived", targetType: "Contact", targetId: contact.id, result: "Success", reason: req.body.reason });
  res.json({ contact: toApi(contact) });
}

export async function restore(req, res) {
  const existing = await prisma.contact.findFirst({ where: { id: req.params.contactId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Contact not found." });
  const contact = await prisma.contact.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, archivedAt: null, archivedByMembershipId: null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.contact.restored", targetType: "Contact", targetId: contact.id, result: "Success" });
  res.json({ contact: toApi(contact) });
}

export async function assign(req, res) {
  const { ownerMembershipId } = req.body;
  if (!ownerMembershipId) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "ownerMembershipId is required." });
  const membership = await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
  if (!membership) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  const existing = await prisma.contact.findFirst({ where: { id: req.params.contactId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Contact not found." });
  const contact = await prisma.contact.update({ where: { id: existing.id }, data: { ownerMembershipId, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.contact.assigned", targetType: "Contact", targetId: contact.id, result: "Success", after: { ownerMembershipId } });
  res.json({ contact: toApi(contact) });
}

export async function duplicateCandidates(req, res) {
  const contact = await prisma.contact.findFirst({ where: { id: req.params.contactId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!contact) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Contact not found." });
  const showSensitive = await canViewSensitive(req);
  const candidates = await findContactDuplicateCandidates(req.organizationId, contact, scopeWhere(req));
  res.json({ candidates: candidates.map((c) => ({ record: maskSensitive(toApi(c.record), showSensitive), matchedRules: c.matchedRules })) });
}

export async function mergePreviewHandler(req, res) {
  const { destinationId } = req.body;
  if (!destinationId) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "destinationId is required." });
  const result = await runMergePreview("Contact", req.organizationId, req.params.contactId, destinationId);
  if (result.error) return res.status(result.error.status).json({ code: result.error.code, message: result.error.message });
  res.json(result);
}

export async function mergeHandler(req, res) {
  const { destinationId, destinationVersion, reason } = req.body;
  if (!destinationId || destinationVersion === undefined) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "destinationId and destinationVersion are required." });
  if (!reason?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "A written reason is required to merge contacts." });

  const result = await runMerge({
    recordType: "Contact", organizationId: req.organizationId, sourceId: req.params.contactId, destinationId, destinationVersion, reason,
    actorUserId: req.user.id, actorMembershipId: req.membership?.id, ...requestContext(req),
  });
  if (result.error) {
    const { status, ...body } = result.error;
    await recordIdempotentResponse(req, status, body);
    return res.status(status).json(body);
  }
  const body = { destination: toApi(result.destination), source: toApi(result.source) };
  await recordIdempotentResponse(req, 200, body);
  res.json(body);
}

export async function summary(req, res) {
  // Same filters as the list (minus paging), so the cards follow the list.
  const { organizationId, archived, ...filterWhere } = buildListWhere(req);
  const data = await crmContactSummary(req.organizationId, filterWhere);
  const [created, updated] = await Promise.all([
    recentlyCreated("contact", req.organizationId, scopeWhere(req)),
    recentlyUpdated("contact", req.organizationId, scopeWhere(req)),
  ]);
  res.json({ ...data, recentlyCreated: toApi(created), recentlyUpdated: toApi(updated) });
}

export async function bulk(req, res) {
  const { action, ids, reason, ownerMembershipId, lifecycleStage, tagId } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "ids must be a non-empty array." });
  if (ids.length > MAX_BULK_BATCH_SIZE) return res.status(400).json({ code: "CRM_BATCH_LIMIT_EXCEEDED", message: `A bulk operation may include at most ${MAX_BULK_BATCH_SIZE} records.` });
  if ((action === "archive" || action === "restore") && !reason?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "A reason is required for bulk archive/restore." });

  const authorizedIds = (await prisma.contact.findMany({ where: { id: { in: ids }, organizationId: req.organizationId, ...scopeWhere(req) }, select: { id: true } })).map((c) => c.id);

  if (action === "tag") {
    if (!tagId) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "tagId is required." });
    const tag = await prisma.crmTag.findFirst({ where: { id: tagId, organizationId: req.organizationId } });
    if (!tag) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "tagId must reference a tag in this organization." });
    await Promise.all(authorizedIds.map((contactId) => prisma.crmRecordTag.upsert({ where: { tagId_contactId: { tagId, contactId } }, create: { tagId, contactId }, update: {} })));
  } else {
    let data;
    if (action === "assign") {
      if (!ownerMembershipId) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "ownerMembershipId is required." });
      const membership = await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
      if (!membership) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
      data = { ownerMembershipId };
    } else if (action === "lifecycle") {
      if (!lifecycleStage) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "lifecycleStage is required." });
      data = { lifecycleStage };
    } else if (action === "archive") {
      data = { archived: true, archiveReason: reason, archivedAt: new Date(), archivedByMembershipId: req.membership?.id || null };
    } else if (action === "restore") {
      data = { archived: false, archiveReason: null, archivedAt: null, archivedByMembershipId: null };
    } else {
      return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: `Unsupported bulk action "${action}".` });
    }
    await prisma.contact.updateMany({ where: { id: { in: authorizedIds } }, data: { ...data, version: { increment: 1 } } });
  }

  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: `crm.contact.bulk_${action}`, result: "Success", after: { affectedCount: authorizedIds.length, requestedCount: ids.length }, reason });
  res.json({ affected: authorizedIds.length, requested: ids.length, skipped: ids.length - authorizedIds.length });
}
