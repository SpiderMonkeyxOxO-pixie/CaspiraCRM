import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { normalizeDomain, normalizeName } from "../../services/crm/normalizationService.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";
import { findCompanyDuplicateCandidates } from "../../services/crm/duplicateDetectionService.js";
import { mergePreview as runMergePreview, merge as runMerge } from "../../services/crm/mergeService.js";
import { crmCompanySummary, recentlyCreated, recentlyUpdated } from "../../services/crm/crmContactCompanySummaryService.js";
import { authorizeOrgAccess } from "../../middleware/rbac.js";
import { recordIdempotentResponse } from "../../middleware/idempotency.js";
import { pickWritable } from "../../utils/pickWritable.js";

const MAX_PAGE_SIZE = 100;
const SORTABLE_FIELDS = new Set(["createdAt", "updatedAt", "name", "lifecycleStage"]);
const MAX_BULK_BATCH_SIZE = 200;

// The only fields a client may write on create/update (see pickWritable).
const WRITABLE_FIELDS = [
  "name", "legalName", "website", "industry", "phone", "email", "addressLine1", "addressLine2", "city", "state", "postalCode",
  "country", "region", "size", "annualRevenue", "annualRevenueRange", "employeeSizeRange", "currency", "companyType", "accountStatus",
  "lifecycleStage", "ownerMembershipId", "team", "department", "customerStatus", "accountTier", "accountHealth", "healthReason",
  "timeZone", "preferredLanguage", "source", "estimatedAnnualValue", "renewalDate", "nextActionDate", "description",
];
const pickCompanyFields = (body) =>
  pickWritable(body, WRITABLE_FIELDS, { dates: ["renewalDate", "nextActionDate"], numbers: ["annualRevenue", "estimatedAnnualValue"] });

// The company's current primary contact (at most one, enforced by a partial
// unique index), returned with list/detail so callers needn't look it up.
const PRIMARY_CONTACT_INCLUDE = {
  contactRelationships: { where: { isPrimaryContact: true, endDate: null }, select: { contactId: true }, take: 1 },
};

// Only these relationship fields are editable — companyId/contactId never
// move through an update.
const RELATIONSHIP_FIELDS = ["relationshipType", "jobTitleAtCompany", "isDecisionMaker", "isPrimaryContact"];

// Financial fields (annualRevenue/annualRevenueRange/currency) require
// "view_financial_fields" on "companies" — masked server-side, uniformly,
// same discipline as Contact's sensitive-field masking.
const FINANCIAL_FIELDS = ["annualRevenue", "annualRevenueRange", "estimatedAnnualValue", "currency"];

function maskFinancial(company, canViewFinancial) {
  if (canViewFinancial || !company) return company;
  const masked = { ...company };
  for (const field of FINANCIAL_FIELDS) if (field in masked) masked[field] = null;
  masked.financialFieldsRedacted = true;
  return masked;
}

async function canViewFinancial(req) {
  if (req.isSystemOwnerOverride) return true;
  const result = await authorizeOrgAccess(req.user, req.organizationId, "companies", "view_financial_fields");
  return result.ok;
}

function scopeWhere(req) {
  return resolveCrmScopeWhere(req, "companies", { ownerField: "ownerMembershipId" });
}

function buildListWhere(req) {
  const q = req.query;
  const where = { organizationId: req.organizationId, ...scopeWhere(req) };
  where.archived = q.archived === "true";
  if (q.search) {
    where.OR = [
      { name: { contains: q.search, mode: "insensitive" } },
      { website: { contains: q.search, mode: "insensitive" } },
      { industry: { contains: q.search, mode: "insensitive" } },
    ];
  }
  if (q.lifecycleStage) where.lifecycleStage = q.lifecycleStage;
  if (q.accountStatus) where.accountStatus = q.accountStatus;
  if (q.ownerMembershipId) where.ownerMembershipId = q.ownerMembershipId;
  if (q.country) where.country = q.country;
  if (q.team) where.team = q.team;
  if (q.department) where.department = q.department;
  if (q.industry) where.industry = q.industry;
  if (q.customerStatus) where.customerStatus = q.customerStatus;
  if (q.accountTier) where.accountTier = q.accountTier;
  if (q.accountHealth) where.accountHealth = q.accountHealth;
  return where;
}

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const sortField = SORTABLE_FIELDS.has(req.query.sort) ? req.query.sort : "updatedAt";
  const sortOrder = req.query.order === "asc" ? "asc" : "desc";
  const where = buildListWhere(req);
  const showFinancial = await canViewFinancial(req);

  const [companies, total] = await Promise.all([
    prisma.company.findMany({ where, include: PRIMARY_CONTACT_INCLUDE, orderBy: [{ [sortField]: sortOrder }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.company.count({ where }),
  ]);
  res.json({ companies: toApi(companies).map((c) => maskFinancial(c, showFinancial)), total, page, pageSize });
}

export async function getOne(req, res) {
  const company = await prisma.company.findFirst({ where: { id: req.params.companyId, organizationId: req.organizationId, ...scopeWhere(req) }, include: PRIMARY_CONTACT_INCLUDE });
  if (!company) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Company not found." });
  res.json({ company: maskFinancial(toApi(company), await canViewFinancial(req)) });
}

export async function create(req, res) {
  const fields = pickCompanyFields(req.body);
  const { name, website, ownerMembershipId } = fields;
  if (!name?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "name is required." });
  if (ownerMembershipId) {
    const membership = await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
    if (!membership) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  }

  const company = await prisma.company.create({
    data: {
      ...fields, organizationId: req.organizationId, ownerMembershipId: ownerMembershipId || null,
      normalizedName: normalizeName(name), normalizedDomain: normalizeDomain(website),
      createdByMembershipId: req.membership?.id || null, updatedByMembershipId: req.membership?.id || null,
    },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.company.created", targetType: "Company", targetId: company.id, result: "Success" });
  res.status(201).json({ company: toApi(company) });
}

export async function update(req, res) {
  const existing = await prisma.company.findFirst({ where: { id: req.params.companyId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Company not found." });
  if (existing.archived) return res.status(400).json({ code: "CRM_INVALID_TRANSITION", message: "An archived company cannot be edited — restore it first." });
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "CRM_VERSION_CONFLICT", message: "This company was updated by someone else. Refresh and try again." });
  }

  const rest = pickCompanyFields(req.body);
  if (rest.ownerMembershipId) {
    const membership = await prisma.organizationMembership.findFirst({ where: { id: rest.ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
    if (!membership) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  }
  const data = { ...rest, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } };
  if ("name" in rest) data.normalizedName = normalizeName(rest.name);
  if ("website" in rest) data.normalizedDomain = normalizeDomain(rest.website);

  const company = await prisma.company.update({ where: { id: existing.id }, data });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.company.updated", targetType: "Company", targetId: company.id, result: "Success", before: toApi(existing), after: toApi(company) });
  res.json({ company: toApi(company) });
}

export async function archive(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "A reason is required to archive a company." });
  const existing = await prisma.company.findFirst({ where: { id: req.params.companyId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Company not found." });
  const company = await prisma.company.update({ where: { id: existing.id }, data: { archived: true, archiveReason: req.body.reason, archivedAt: new Date(), archivedByMembershipId: req.membership?.id || null, statusBeforeArchive: existing.status, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.company.archived", targetType: "Company", targetId: company.id, result: "Success", reason: req.body.reason });
  res.json({ company: toApi(company) });
}

export async function restore(req, res) {
  const existing = await prisma.company.findFirst({ where: { id: req.params.companyId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Company not found." });
  const company = await prisma.company.update({ where: { id: existing.id }, data: { archived: false, archiveReason: null, archivedAt: null, archivedByMembershipId: null, status: existing.statusBeforeArchive || existing.status, statusBeforeArchive: null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.company.restored", targetType: "Company", targetId: company.id, result: "Success" });
  res.json({ company: toApi(company) });
}

export async function assign(req, res) {
  const { ownerMembershipId } = req.body;
  if (!ownerMembershipId) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "ownerMembershipId is required." });
  const membership = await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId: req.organizationId, status: "Active" } });
  if (!membership) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "ownerMembershipId must reference an active membership in this organization." });
  const existing = await prisma.company.findFirst({ where: { id: req.params.companyId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Company not found." });
  const company = await prisma.company.update({ where: { id: existing.id }, data: { ownerMembershipId, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.company.assigned", targetType: "Company", targetId: company.id, result: "Success", after: { ownerMembershipId } });
  res.json({ company: toApi(company) });
}

export async function duplicateCandidates(req, res) {
  const company = await prisma.company.findFirst({ where: { id: req.params.companyId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!company) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Company not found." });
  const showFinancial = await canViewFinancial(req);
  const candidates = await findCompanyDuplicateCandidates(req.organizationId, company, scopeWhere(req));
  res.json({ candidates: candidates.map((c) => ({ record: maskFinancial(toApi(c.record), showFinancial), matchedRules: c.matchedRules })) });
}

export async function mergePreviewHandler(req, res) {
  const { destinationId } = req.body;
  if (!destinationId) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "destinationId is required." });
  const result = await runMergePreview("Company", req.organizationId, req.params.companyId, destinationId);
  if (result.error) return res.status(result.error.status).json({ code: result.error.code, message: result.error.message });
  res.json(result);
}

export async function mergeHandler(req, res) {
  const { destinationId, destinationVersion, reason } = req.body;
  if (!destinationId || destinationVersion === undefined) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "destinationId and destinationVersion are required." });
  if (!reason?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "A written reason is required to merge companies." });

  const result = await runMerge({
    recordType: "Company", organizationId: req.organizationId, sourceId: req.params.companyId, destinationId, destinationVersion, reason,
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

// --- Company <-> Contact relationships ---

export async function listContacts(req, res) {
  const company = await prisma.company.findFirst({ where: { id: req.params.companyId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!company) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Company not found." });
  const relationships = await prisma.companyContactRelationship.findMany({ where: { companyId: company.id }, include: { contact: true } });
  res.json({ relationships: relationships.map((r) => ({ ...toApi(r), contact: toApi(r.contact) })) });
}

export async function linkContact(req, res) {
  const { contactId, relationshipType, jobTitleAtCompany, isDecisionMaker, isPrimaryContact } = req.body;
  if (!contactId) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "contactId is required." });
  const company = await prisma.company.findFirst({ where: { id: req.params.companyId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!company) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Company not found." });
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId: req.organizationId } });
  if (!contact) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "contactId must reference a contact in this organization." });

  // Changing/setting the primary contact is transactional: demote any
  // existing active primary before promoting the new one, so the
  // database-level partial unique index is never even momentarily violated.
  const relationship = await prisma.$transaction(async (tx) => {
    if (isPrimaryContact) {
      await tx.companyContactRelationship.updateMany({ where: { companyId: company.id, isPrimaryContact: true, endDate: null }, data: { isPrimaryContact: false } });
    }
    // Keep the legacy Contact.companyId column in step with the junction —
    // the contact pages and older consumers still read it.
    await tx.contact.update({ where: { id: contactId }, data: { companyId: company.id } });
    // Re-linking an already-linked contact is idempotent: only the fields
    // actually sent change, so it never silently drops primary status.
    const open = await tx.companyContactRelationship.findFirst({ where: { companyId: company.id, contactId, endDate: null } });
    if (open) return tx.companyContactRelationship.update({ where: { id: open.id }, data: pickWritable(req.body, RELATIONSHIP_FIELDS) });
    return tx.companyContactRelationship.create({
      data: { companyId: company.id, contactId, relationshipType, jobTitleAtCompany, isDecisionMaker: !!isDecisionMaker, isPrimaryContact: !!isPrimaryContact },
    });
  });

  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.company.contact_linked", targetType: "Company", targetId: company.id, result: "Success", after: { contactId, isPrimaryContact: !!isPrimaryContact } });
  res.status(201).json({ relationship: toApi(relationship) });
}

export async function updateContactRelationship(req, res) {
  const company = await prisma.company.findFirst({ where: { id: req.params.companyId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!company) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Company not found." });
  const relationship = await prisma.companyContactRelationship.findFirst({ where: { companyId: company.id, contactId: req.params.contactId, endDate: null } });
  if (!relationship) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Relationship not found." });

  if (req.body.isPrimaryContact === true) {
    // Archived contacts cannot become/remain primary without explicit
    // confirmation — the caller must acknowledge the warning.
    const contact = await prisma.contact.findUnique({ where: { id: req.params.contactId } });
    if (contact.archived && req.query.confirmArchivedPrimary !== "true") {
      return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "This contact is archived. Resubmit with confirmArchivedPrimary=true to make an archived contact the primary contact." });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (req.body.isPrimaryContact === true) {
      await tx.companyContactRelationship.updateMany({ where: { companyId: company.id, isPrimaryContact: true, endDate: null, id: { not: relationship.id } }, data: { isPrimaryContact: false } });
    }
    return tx.companyContactRelationship.update({ where: { id: relationship.id }, data: pickWritable(req.body, RELATIONSHIP_FIELDS) });
  });

  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.company.primary_contact_changed", targetType: "Company", targetId: company.id, result: "Success", before: toApi(relationship), after: toApi(updated) });
  res.json({ relationship: toApi(updated) });
}

export async function unlinkContact(req, res) {
  const company = await prisma.company.findFirst({ where: { id: req.params.companyId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!company) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Company not found." });
  const relationship = await prisma.companyContactRelationship.findFirst({ where: { companyId: company.id, contactId: req.params.contactId, endDate: null } });
  if (!relationship) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Relationship not found." });

  await prisma.$transaction([
    prisma.companyContactRelationship.update({ where: { id: relationship.id }, data: { endDate: new Date(), isPrimaryContact: false } }),
    prisma.contact.updateMany({ where: { id: req.params.contactId, companyId: company.id }, data: { companyId: null } }),
  ]);
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.company.contact_unlinked", targetType: "Company", targetId: company.id, result: "Success" });
  res.json({ message: "Contact unlinked from company." });
}

export async function summary(req, res) {
  const data = await crmCompanySummary(req.organizationId, scopeWhere(req));
  const [created, updated] = await Promise.all([
    recentlyCreated("company", req.organizationId, scopeWhere(req)),
    recentlyUpdated("company", req.organizationId, scopeWhere(req)),
  ]);
  res.json({ ...data, recentlyCreated: toApi(created), recentlyUpdated: toApi(updated) });
}

export async function bulk(req, res) {
  const { action, ids, reason, ownerMembershipId, lifecycleStage, tagId } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "ids must be a non-empty array." });
  if (ids.length > MAX_BULK_BATCH_SIZE) return res.status(400).json({ code: "CRM_BATCH_LIMIT_EXCEEDED", message: `A bulk operation may include at most ${MAX_BULK_BATCH_SIZE} records.` });
  if ((action === "archive" || action === "restore") && !reason?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "A reason is required for bulk archive/restore." });

  const authorizedIds = (await prisma.company.findMany({ where: { id: { in: ids }, organizationId: req.organizationId, ...scopeWhere(req) }, select: { id: true } })).map((c) => c.id);

  if (action === "tag") {
    if (!tagId) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "tagId is required." });
    const tag = await prisma.crmTag.findFirst({ where: { id: tagId, organizationId: req.organizationId } });
    if (!tag) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "tagId must reference a tag in this organization." });
    await Promise.all(authorizedIds.map((companyId) => prisma.crmRecordTag.upsert({ where: { tagId_companyId: { tagId, companyId } }, create: { tagId, companyId }, update: {} })));
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
    await prisma.company.updateMany({ where: { id: { in: authorizedIds } }, data: { ...data, version: { increment: 1 } } });
  }

  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: `crm.company.bulk_${action}`, result: "Success", after: { affectedCount: authorizedIds.length, requestedCount: ids.length }, reason });
  res.json({ affected: authorizedIds.length, requested: ids.length, skipped: ids.length - authorizedIds.length });
}
