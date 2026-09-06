import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { sanitizeNoteBody } from "../../services/crm/normalizationService.js";
import { resolveCrmScopeWhere } from "../../services/crm/scopeService.js";

const RECORD_FK_FIELDS = ["leadId", "contactId", "companyId", "activityId", "dealId"];
const RECORD_MODEL = { leadId: "lead", contactId: "contact", companyId: "company", activityId: "activity", dealId: "deal" };
const RECORD_MODULE = { leadId: "leads", contactId: "contacts", companyId: "companies", activityId: "activities", dealId: "deals" };

// Exactly one of lead/contact/company/activity must be set, and that record
// must be within the caller's own RECORD SCOPE for that module — not merely
// same organization — otherwise a Sales-Rep-scoped caller could read/write
// notes on a record they aren't authorized to view at all.
async function resolveSingleRecordFk(req, field, recordId) {
  const model = RECORD_MODEL[field];
  const scopeWhere = resolveCrmScopeWhere(req, RECORD_MODULE[field], { ownerField: "ownerMembershipId", assignedField: field === "activityId" ? "assignedMembershipId" : null });
  const record = await prisma[model].findFirst({ where: { id: recordId, organizationId: req.organizationId, ...scopeWhere } });
  if (!record) return { error: `${field} must reference a record you have access to in this organization.` };
  return { field, recordId };
}

function pickRecordField(source) {
  const set = RECORD_FK_FIELDS.filter((f) => source[f]);
  if (set.length !== 1) return null;
  return set[0];
}

export async function list(req, res) {
  const field = pickRecordField(req.query);
  if (!field) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "Exactly one of leadId, contactId, companyId, or activityId is required." });
  const resolved = await resolveSingleRecordFk(req, field, req.query[field]);
  if (resolved.error) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Record not found." });

  const where = { organizationId: req.organizationId, [field]: req.query[field] };
  if (req.query.archived !== "true") where.archivedAt = null;
  const notes = await prisma.crmNote.findMany({ where, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] });
  res.json({ notes: toApi(notes) });
}

export async function create(req, res) {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "body is required." });
  const field = pickRecordField(req.body);
  if (!field) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "Exactly one of leadId, contactId, companyId, or activityId is required." });
  const resolved = await resolveSingleRecordFk(req, field, req.body[field]);
  if (resolved.error) return res.status(400).json({ code: "CRM_OWNER_INVALID", message: resolved.error });

  const note = await prisma.crmNote.create({
    data: {
      organizationId: req.organizationId, authorMembershipId: req.membership?.id,
      body: sanitizeNoteBody(body), pinned: !!req.body.pinned, [resolved.field]: resolved.recordId,
    },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.note.created", targetType: "CrmNote", targetId: note.id, result: "Success" });
  res.status(201).json({ note: toApi(note) });
}

async function assertNoteInScope(req, note) {
  const field = pickRecordField(note);
  if (!field) return true;
  const resolved = await resolveSingleRecordFk(req, field, note[field]);
  return !resolved.error;
}

export async function update(req, res) {
  const existing = await prisma.crmNote.findFirst({ where: { id: req.params.noteId, organizationId: req.organizationId } });
  if (!existing || !(await assertNoteInScope(req, existing))) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Note not found." });
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "CRM_VERSION_CONFLICT", message: "This note was updated by someone else. Refresh and try again." });
  }
  const data = { version: { increment: 1 } };
  if (req.body.body !== undefined) {
    if (!req.body.body?.trim()) return res.status(400).json({ code: "CRM_VALIDATION_FAILED", message: "body cannot be empty." });
    data.body = sanitizeNoteBody(req.body.body);
    data.edited = true;
  }
  if (req.body.pinned !== undefined) data.pinned = !!req.body.pinned;

  const note = await prisma.crmNote.update({ where: { id: existing.id }, data });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.note.updated", targetType: "CrmNote", targetId: note.id, result: "Success", before: { body: existing.body }, after: { body: note.body } });
  res.json({ note: toApi(note) });
}

export async function archive(req, res) {
  const existing = await prisma.crmNote.findFirst({ where: { id: req.params.noteId, organizationId: req.organizationId } });
  if (!existing || !(await assertNoteInScope(req, existing))) return res.status(404).json({ code: "CRM_RECORD_NOT_FOUND", message: "Note not found." });
  const note = await prisma.crmNote.update({ where: { id: existing.id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action: "crm.note.archived", targetType: "CrmNote", targetId: note.id, result: "Success" });
  res.json({ note: toApi(note) });
}
