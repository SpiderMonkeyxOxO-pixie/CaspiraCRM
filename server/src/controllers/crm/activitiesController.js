import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";
import { canTransition } from "../../services/crm/activityLifecycleService.js";
import { activitySummary } from "../../services/crm/crmSummaryService.js";

const MAX_PAGE_SIZE = 100;
const SORTABLE_FIELDS = new Set(["createdAt", "updatedAt", "dueDate", "scheduledStart", "priority"]);
const MAX_BULK_BATCH_SIZE = 200;

function scopeWhere(req) {
  return resolveCrmScopeWhere(req, "activities", { ownerField: "ownerMembershipId", assignedField: "assignedMembershipId" });
}

// A Lead/Contact/Company an Activity links to must belong to the SAME
// organization — never left to a bare FK (Postgres can't express "same
// organizationId as me" across tables), and never trusted from the client
// without a lookup.
async function validateSameOrgRelations(organizationId, { leadId, contactId, companyId, dealId }) {
  if (leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!lead) return { field: "leadId" };
  }
  if (contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
    if (!contact) return { field: "contactId" };
  }
  if (companyId) {
    const company = await prisma.company.findFirst({ where: { id: companyId, organizationId } });
    if (!company) return { field: "companyId" };
  }
  if (dealId) {
    // Backend Phase 3 — Deal is the one relation the legacy Activity model
    // already had a raw FK for, but never same-organization validated.
    const deal = await prisma.deal.findFirst({ where: { id: dealId, organizationId } });
    if (!deal) return { field: "dealId" };
  }
  return null;
}

function buildListWhere(req) {
  const q = req.query;
  const where = { organizationId: req.organizationId, ...scopeWhere(req) };
  where.archivedAt = q.archived === "true" ? { not: null } : null;
  if (q.search) where.OR = [{ title: { contains: q.search, mode: "insensitive" } }, { description: { contains: q.search, mode: "insensitive" } }];
  if (q.type) where.type = q.type;
  if (q.status) where.status = q.status;
  if (q.priority) where.priority = q.priority;
  if (q.leadId) where.leadId = q.leadId;
  if (q.contactId) where.contactId = q.contactId;
  if (q.companyId) where.companyId = q.companyId;
  if (q.ownerMembershipId === "unassigned") where.ownerMembershipId = null;
  else if (q.ownerMembershipId) where.ownerMembershipId = q.ownerMembershipId;
  if (q.assignedMembershipId) where.assignedMembershipId = q.assignedMembershipId;
  if (q.dueFrom || q.dueTo) {
    where.dueDate = {};
    if (q.dueFrom) where.dueDate.gte = new Date(q.dueFrom);
    if (q.dueTo) where.dueDate.lte = new Date(q.dueTo);
  }
  if (q.overdue === "true") { where.status = { notIn: ["Completed", "Cancelled"] }; where.dueDate = { lt: new Date() }; }
  if (q.upcoming === "true") { where.status = { notIn: ["Completed", "Cancelled"] }; where.dueDate = { gte: new Date() }; }
  if (q.completed === "true") where.status = "Completed";
  return where;
}

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const sortField = SORTABLE_FIELDS.has(req.query.sort) ? req.query.sort : "updatedAt";
  const sortOrder = req.query.order === "asc" ? "asc" : "desc";
  const where = buildListWhere(req);

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({ where, orderBy: [{ [sortField]: sortOrder }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.activity.count({ where }),
  ]);
  res.json({ activities: toApi(activities), total, page, pageSize });
}

export async function getOne(req, res) {
  const activity = await prisma.activity.findFirst({ where: { id: req.params.activityId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!activity) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Activity not found." });
  res.json({ activity: toApi(activity) });
}

export async function create(req, res) {
  const { title, type, description, priority, leadId, contactId, companyId, dealId, dueDate, scheduledStart, scheduledEnd, ownerMembershipId, assignedMembershipId, source } = req.body;
  if (!title?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "title is required." });

  const relationError = await validateSameOrgRelations(req.organizationId, { leadId, contactId, companyId, dealId });
  if (relationError) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: `${relationError.field} must reference a record in this organization.` });

  const activity = await prisma.activity.create({
    data: {
      organizationId: req.organizationId, title, type, description, priority, leadId: leadId || null, contactId: contactId || null, companyId: companyId || null, dealId: dealId || null,
      dueDate: dueDate ? new Date(dueDate) : null, scheduledStart: scheduledStart ? new Date(scheduledStart) : null, scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
      status: "Scheduled", ownerMembershipId: ownerMembershipId || req.membership?.id || null, assignedMembershipId: assignedMembershipId || null, source,
      createdByMembershipId: req.membership?.id || null, updatedByMembershipId: req.membership?.id || null,
    },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.activity.created", targetType: "Activity", targetId: activity.id, result: "Success" });
  res.status(201).json({ activity: toApi(activity) });
}

export async function update(req, res) {
  const existing = await prisma.activity.findFirst({ where: { id: req.params.activityId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Activity not found." });
  if (existing.archivedAt) return res.status(400).json({ code: "CRM_INVALID_TRANSITION", message: "An archived activity cannot be edited — restore it first." });
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "CRM_VERSION_CONFLICT", message: "This activity was updated by someone else. Refresh and try again." });
  }
  if (req.body.status && req.body.status !== existing.status) {
    return res.status(400).json({ code: "CRM_INVALID_TRANSITION", message: "Use /complete, /cancel, or /reopen to change activity status." });
  }
  const relationError = await validateSameOrgRelations(req.organizationId, req.body);
  if (relationError) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: `${relationError.field} must reference a record in this organization.` });

  const { version, id, organizationId, createdAt, status, ...rest } = req.body;
  const data = { ...rest, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } };
  if ("dueDate" in rest) data.dueDate = rest.dueDate ? new Date(rest.dueDate) : null;
  if ("scheduledStart" in rest) data.scheduledStart = rest.scheduledStart ? new Date(rest.scheduledStart) : null;
  if ("scheduledEnd" in rest) data.scheduledEnd = rest.scheduledEnd ? new Date(rest.scheduledEnd) : null;

  const activity = await prisma.activity.update({ where: { id: existing.id }, data });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.activity.updated", targetType: "Activity", targetId: activity.id, result: "Success", before: toApi(existing), after: toApi(activity) });
  res.json({ activity: toApi(activity) });
}

// Returns the updated activity, or null after already sending an error
// response — callers must check for null, not merely falsy-ness, since
// res.status().json() itself returns a truthy `res`.
async function transition(req, res, { toStatus, extraData = {}, auditAction, requireReason = false }) {
  if (requireReason && !req.body.reason?.trim()) { res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "A reason is required." }); return null; }
  const existing = await prisma.activity.findFirst({ where: { id: req.params.activityId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) { res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Activity not found." }); return null; }
  if (!canTransition(existing.status, toStatus)) {
    res.status(400).json({ code: "CRM_INVALID_TRANSITION", message: `Cannot move an activity from "${existing.status}" to "${toStatus}".` });
    return null;
  }

  const activity = await prisma.activity.update({ where: { id: existing.id }, data: { status: toStatus, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 }, ...extraData } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: auditAction, targetType: "Activity", targetId: activity.id, result: "Success", reason: req.body.reason, before: { status: existing.status }, after: { status: toStatus } });
  return activity;
}

export async function complete(req, res) {
  const { outcome, followUpRequired, followUpDate, createFollowUp } = req.body;
  const activity = await transition(req, res, {
    toStatus: "Completed", auditAction: "crm.activity.completed",
    extraData: { completedAt: new Date(), outcome: outcome || null, followUpRequired: !!followUpRequired, followUpDate: followUpDate ? new Date(followUpDate) : null },
  });
  if (!activity) return; // transition() already sent the error response

  let followUp = null;
  // Follow-up creation is human-confirmed (createFollowUp must be
  // explicitly true) and transactional with the completion itself having
  // already committed — a separate create here, not silently automatic.
  if (followUpRequired && createFollowUp) {
    followUp = await prisma.activity.create({
      data: {
        organizationId: req.organizationId, title: `Follow up: ${activity.title}`, type: activity.type,
        leadId: activity.leadId, contactId: activity.contactId, companyId: activity.companyId,
        dueDate: followUpDate ? new Date(followUpDate) : null, status: "Scheduled",
        ownerMembershipId: activity.ownerMembershipId, assignedMembershipId: activity.assignedMembershipId,
        followUpActivityId: activity.id, createdByMembershipId: req.membership?.id || null, updatedByMembershipId: req.membership?.id || null,
      },
    });
    await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.activity.follow_up_created", targetType: "Activity", targetId: followUp.id, result: "Success", after: { parentActivityId: activity.id } });
  }
  res.json({ activity: toApi(activity), followUp: toApi(followUp) });
}

export async function cancel(req, res) {
  const activity = await transition(req, res, { toStatus: "Cancelled", auditAction: "crm.activity.cancelled", requireReason: true, extraData: { cancelledAt: new Date(), cancelReason: req.body.reason } });
  if (!activity) return;
  res.json({ activity: toApi(activity) });
}

export async function reopen(req, res) {
  const activity = await transition(req, res, { toStatus: "Scheduled", auditAction: "crm.activity.reopened", extraData: { completedAt: null, cancelledAt: null, cancelReason: null } });
  if (!activity) return;
  res.json({ activity: toApi(activity) });
}

export async function archive(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "A reason is required to archive an activity." });
  const existing = await prisma.activity.findFirst({ where: { id: req.params.activityId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Activity not found." });
  const activity = await prisma.activity.update({ where: { id: existing.id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.activity.archived", targetType: "Activity", targetId: activity.id, result: "Success", reason: req.body.reason });
  res.json({ activity: toApi(activity) });
}

export async function restore(req, res) {
  const existing = await prisma.activity.findFirst({ where: { id: req.params.activityId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Activity not found." });
  const activity = await prisma.activity.update({ where: { id: existing.id }, data: { archivedAt: null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.activity.restored", targetType: "Activity", targetId: activity.id, result: "Success" });
  res.json({ activity: toApi(activity) });
}

export async function assign(req, res) {
  const { assignedMembershipId } = req.body;
  if (!assignedMembershipId) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "assignedMembershipId is required." });
  const membership = await prisma.organizationMembership.findFirst({ where: { id: assignedMembershipId, organizationId: req.organizationId, status: "Active" } });
  if (!membership) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: "assignedMembershipId must reference an active membership in this organization." });
  const existing = await prisma.activity.findFirst({ where: { id: req.params.activityId, organizationId: req.organizationId, ...scopeWhere(req) } });
  if (!existing) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Activity not found." });
  const activity = await prisma.activity.update({ where: { id: existing.id }, data: { assignedMembershipId, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.activity.assigned", targetType: "Activity", targetId: activity.id, result: "Success", after: { assignedMembershipId } });
  res.json({ activity: toApi(activity) });
}

export async function summary(req, res) {
  const data = await activitySummary(req.organizationId, scopeWhere(req));
  res.json(data);
}

export async function bulk(req, res) {
  const { action, ids, ownerMembershipId, assignedMembershipId, dueDate } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "ids must be a non-empty array." });
  if (ids.length > MAX_BULK_BATCH_SIZE) return res.status(400).json({ code: "CRM_BATCH_LIMIT_EXCEEDED", message: `A bulk operation may include at most ${MAX_BULK_BATCH_SIZE} records.` });
  if (action === "cancel" && !req.body.reason?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "A reason is required for bulk cancel." });

  const authorized = await prisma.activity.findMany({ where: { id: { in: ids }, organizationId: req.organizationId, ...scopeWhere(req) } });
  let authorizedIds = authorized.map((a) => a.id);
  let data;

  if (action === "assign") {
    if (!assignedMembershipId) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "assignedMembershipId is required." });
    data = { assignedMembershipId };
  } else if (action === "reschedule") {
    if (!dueDate) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "dueDate is required." });
    data = { dueDate: new Date(dueDate) };
  } else if (action === "complete") {
    // Only records that are actually in a completable state proceed —
    // per-record authorization AND per-record transition validity, never
    // an unconditional blanket update.
    authorizedIds = authorized.filter((a) => canTransition(a.status, "Completed")).map((a) => a.id);
    data = { status: "Completed", completedAt: new Date() };
  } else if (action === "cancel") {
    authorizedIds = authorized.filter((a) => canTransition(a.status, "Cancelled")).map((a) => a.id);
    data = { status: "Cancelled", cancelledAt: new Date(), cancelReason: req.body.reason };
  } else {
    return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: `Unsupported bulk action "${action}".` });
  }

  await prisma.activity.updateMany({ where: { id: { in: authorizedIds } }, data: { ...data, version: { increment: 1 } } });
  void ownerMembershipId; // reserved for a future "assign owner" bulk action distinct from "assign" (assignee)
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: `crm.activity.bulk_${action}`, result: "Success", after: { affectedCount: authorizedIds.length, requestedCount: ids.length } });
  res.json({ affected: authorizedIds.length, requested: ids.length, skipped: ids.length - authorizedIds.length });
}
