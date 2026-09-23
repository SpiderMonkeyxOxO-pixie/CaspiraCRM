import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { broadestScope } from "../../services/crm/scopeService.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { pickWritable } from "../../utils/pickWritable.js";
import { slaDeadlines, canAdvance, TICKET_PRIORITIES } from "../../services/support/ticketLifecycleService.js";

const MAX_PAGE_SIZE = 100;

// The only fields a client may write on create/update (see pickWritable).
// Status moves through /advance, /resolve, /close and /reopen; assignment
// through /assign; department changes through /escalate (so each one is
// recorded); SLA deadlines are always computed from the priority.
const CREATE_FIELDS = ["subject", "description", "source", "category", "priority", "department", "companyId", "contactId", "assignedMembershipId"];
const UPDATE_FIELDS = ["subject", "description", "source", "category", "priority", "companyId", "contactId"];

// Tickets carry their own "department" (the support queue), which isn't the
// member's HR department — so Department/Team scope can't match on it.
// Anything narrower than the whole organization sees the tickets the member
// created or is assigned to.
function scopeWhere(req) {
  if (req.isSystemOwnerOverride) return {};
  const scope = broadestScope(req.membership, "tickets");
  if (scope === "Organization" || scope === "System-wide") return {};
  return { OR: [{ createdByMembershipId: req.membership.id }, { assignedMembershipId: req.membership.id }] };
}

const INCLUDE = {
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
  messages: { orderBy: { createdAt: "asc" } },
  escalationEvents: { orderBy: { createdAt: "asc" } },
};

async function validateRefs(organizationId, { companyId, contactId, assignedMembershipId }) {
  if (companyId && !(await prisma.company.findFirst({ where: { id: companyId, organizationId } }))) return "companyId";
  if (contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
    if (!contact) return "contactId";
    if (companyId && contact.companyId && contact.companyId !== companyId) return "contactId (belongs to a different company)";
  }
  if (assignedMembershipId && !(await prisma.organizationMembership.findFirst({ where: { id: assignedMembershipId, organizationId, status: "Active" } }))) return "assignedMembershipId";
  return null;
}

async function loadTicket(req, res) {
  const ticket = await prisma.ticket.findFirst({ where: { id: req.params.ticketId, organizationId: req.organizationId, ...scopeWhere(req) }, include: INCLUDE });
  if (!ticket) res.status(404).json({ code: "SUPPORT_RECORD_NOT_FOUND", message: "Ticket not found." });
  return ticket;
}

async function audit(req, action, ticketId, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action, targetType: "Ticket", targetId: ticketId, result: "Success", ...extra });
}

async function saved(req, res, ticketId, status = 200) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: INCLUDE });
  res.status(status).json({ ticket: toApi(ticket) });
}

function buildListWhere(req) {
  const q = req.query;
  const where = { organizationId: req.organizationId, ...scopeWhere(req) };
  if (q.status) where.status = q.status;
  if (q.priority) where.priority = q.priority;
  if (q.department) where.department = q.department;
  if (q.companyId) where.companyId = q.companyId;
  if (q.assignedMembershipId === "unassigned") where.assignedMembershipId = null;
  else if (q.assignedMembershipId) where.assignedMembershipId = q.assignedMembershipId;
  if (q.search) {
    where.AND = [{ OR: [{ ticketNumber: { contains: q.search, mode: "insensitive" } }, { subject: { contains: q.search, mode: "insensitive" } }] }];
  }
  return where;
}

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const where = buildListWhere(req);
  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({ where, include: INCLUDE, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.ticket.count({ where }),
  ]);
  res.json({ tickets: toApi(tickets), total, page, pageSize });
}

export async function getOne(req, res) {
  const ticket = await loadTicket(req, res);
  if (!ticket) return;
  res.json({ ticket: toApi(ticket) });
}

export async function create(req, res) {
  const fields = pickWritable(req.body, CREATE_FIELDS);
  if (!fields.subject?.trim()) return res.status(400).json({ code: "SUPPORT_VALIDATION_FAILED", message: "subject is required." });
  const priority = fields.priority || "Medium";
  if (!TICKET_PRIORITIES.includes(priority)) return res.status(400).json({ code: "SUPPORT_VALIDATION_FAILED", message: `priority must be one of ${TICKET_PRIORITIES.join(", ")}.` });
  const refError = await validateRefs(req.organizationId, fields);
  if (refError) return res.status(400).json({ code: "SUPPORT_REFERENCE_INVALID", message: `${refError} must reference a record in this organization.` });

  const now = new Date();
  const ticket = await prisma.$transaction(async (tx) => {
    const ticketNumber = await nextDocumentNumber(tx, req.organizationId, "Ticket");
    return tx.ticket.create({
      data: {
        ...fields, priority, organizationId: req.organizationId, ticketNumber, status: "New", createdAt: now, ...slaDeadlines(priority, now),
        createdByMembershipId: req.membership?.id || null, updatedByMembershipId: req.membership?.id || null,
      },
    });
  });
  await audit(req, "support.ticket.created", ticket.id);
  await saved(req, res, ticket.id, 201);
}

export async function update(req, res) {
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (["Resolved", "Closed"].includes(existing.status)) {
    return res.status(400).json({ code: "SUPPORT_INVALID_TRANSITION", message: "A resolved or closed ticket can't be edited — reopen it first." });
  }
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "SUPPORT_VERSION_CONFLICT", message: "This ticket was updated by someone else. Refresh and try again." });
  }
  const fields = pickWritable(req.body, UPDATE_FIELDS);
  if (fields.priority && !TICKET_PRIORITIES.includes(fields.priority)) {
    return res.status(400).json({ code: "SUPPORT_VALIDATION_FAILED", message: `priority must be one of ${TICKET_PRIORITIES.join(", ")}.` });
  }
  const refError = await validateRefs(req.organizationId, { companyId: fields.companyId ?? existing.companyId, contactId: fields.contactId });
  if (refError) return res.status(400).json({ code: "SUPPORT_REFERENCE_INVALID", message: `${refError} must reference a record in this organization.` });

  // A priority change re-derives the SLA deadlines from when the ticket was
  // opened — never lets a client set deadlines directly.
  const sla = fields.priority && fields.priority !== existing.priority ? slaDeadlines(fields.priority, existing.createdAt) : {};
  await prisma.ticket.update({ where: { id: existing.id }, data: { ...fields, ...sla, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await audit(req, "support.ticket.updated", existing.id, { before: { priority: existing.priority }, after: { priority: fields.priority ?? existing.priority } });
  await saved(req, res, existing.id);
}

// Moves an open ticket forward one step: New → Open → In Progress →
// Waiting for Customer (and back from Waiting to In Progress). Resolving
// and closing have their own endpoints and requirements.
export async function advance(req, res) {
  const existing = await loadTicket(req, res);
  if (!existing) return;
  const { status } = req.body;
  if (!canAdvance(existing.status, status)) {
    return res.status(400).json({ code: "SUPPORT_INVALID_TRANSITION", message: `Can't move a ticket from "${existing.status}" to "${status}".` });
  }
  await prisma.ticket.update({ where: { id: existing.id }, data: { status, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await audit(req, "support.ticket.status_changed", existing.id, { before: { status: existing.status }, after: { status } });
  await saved(req, res, existing.id);
}

export async function assign(req, res) {
  const existing = await loadTicket(req, res);
  if (!existing) return;
  const { assignedMembershipId } = req.body;
  const refError = await validateRefs(req.organizationId, { assignedMembershipId });
  if (refError) return res.status(400).json({ code: "SUPPORT_REFERENCE_INVALID", message: "assignedMembershipId must reference an active membership in this organization." });
  await prisma.ticket.update({ where: { id: existing.id }, data: { assignedMembershipId: assignedMembershipId || null, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await audit(req, "support.ticket.assigned", existing.id, { after: { assignedMembershipId: assignedMembershipId || null } });
  await saved(req, res, existing.id);
}

async function addMessage(req, res, kind) {
  const body = req.body.message?.trim();
  if (!body) return res.status(400).json({ code: "SUPPORT_VALIDATION_FAILED", message: `${kind === "Reply" ? "A reply" : "A note"} can't be empty.` });
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (existing.status === "Closed") return res.status(400).json({ code: "SUPPORT_INVALID_TRANSITION", message: "A closed ticket can't take new messages — reopen it first." });

  await prisma.$transaction(async (tx) => {
    await tx.ticketMessage.create({ data: { ticketId: existing.id, organizationId: req.organizationId, kind, body, authorMembershipId: req.membership?.id || null } });
    // The first customer-facing reply stops the response SLA clock, and
    // answering a brand-new ticket opens it.
    if (kind === "Reply") {
      const data = {};
      if (!existing.firstRespondedAt) data.firstRespondedAt = new Date();
      if (existing.status === "New") data.status = "Open";
      if (Object.keys(data).length) await tx.ticket.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
    }
  });
  await audit(req, kind === "Reply" ? "support.ticket.replied" : "support.ticket.note_added", existing.id);
  await saved(req, res, existing.id);
}

export const reply = (req, res) => addMessage(req, res, "Reply");
export const addNote = (req, res) => addMessage(req, res, "Note");

export async function escalate(req, res) {
  const { to, reason } = req.body;
  if (!to?.trim()) return res.status(400).json({ code: "SUPPORT_VALIDATION_FAILED", message: "A destination department is required." });
  if (!reason?.trim()) return res.status(400).json({ code: "SUPPORT_VALIDATION_FAILED", message: "A reason is required to escalate a ticket." });
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (["Resolved", "Closed"].includes(existing.status)) return res.status(400).json({ code: "SUPPORT_INVALID_TRANSITION", message: "A resolved or closed ticket can't be escalated." });
  if (to === existing.department) return res.status(400).json({ code: "SUPPORT_VALIDATION_FAILED", message: `The ticket is already with ${to}.` });

  await prisma.$transaction([
    prisma.ticketEscalation.create({ data: { ticketId: existing.id, organizationId: req.organizationId, fromDepartment: existing.department, toDepartment: to, reason, escalatedByMembershipId: req.membership?.id || null } }),
    prisma.ticket.update({ where: { id: existing.id }, data: { department: to, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } }),
  ]);
  await audit(req, "support.ticket.escalated", existing.id, { reason, before: { department: existing.department }, after: { department: to } });
  await saved(req, res, existing.id);
}

export async function resolve(req, res) {
  const summary = req.body.summary?.trim();
  if (!summary) return res.status(400).json({ code: "SUPPORT_VALIDATION_FAILED", message: "A resolution summary is required." });
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (["Resolved", "Closed"].includes(existing.status)) return res.status(400).json({ code: "SUPPORT_INVALID_TRANSITION", message: `This ticket is already ${existing.status}.` });
  await prisma.ticket.update({ where: { id: existing.id }, data: { status: "Resolved", resolutionSummary: summary, resolvedAt: new Date(), updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await audit(req, "support.ticket.resolved", existing.id);
  await saved(req, res, existing.id);
}

// Closing records the customer's satisfaction score (1–5); only a resolved
// ticket can be closed.
export async function close(req, res) {
  const score = req.body.csatScore === undefined || req.body.csatScore === null ? null : Number(req.body.csatScore);
  if (score !== null && !(Number.isInteger(score) && score >= 1 && score <= 5)) {
    return res.status(400).json({ code: "SUPPORT_VALIDATION_FAILED", message: "csatScore must be a whole number from 1 to 5." });
  }
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (existing.status !== "Resolved") return res.status(400).json({ code: "SUPPORT_INVALID_TRANSITION", message: "Only a resolved ticket can be closed." });
  await prisma.ticket.update({ where: { id: existing.id }, data: { status: "Closed", csatScore: score, closedAt: new Date(), updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } });
  await audit(req, "support.ticket.closed", existing.id, { after: { csatScore: score } });
  await saved(req, res, existing.id);
}

export async function reopen(req, res) {
  if (!req.body.reason?.trim()) return res.status(400).json({ code: "SUPPORT_VALIDATION_FAILED", message: "A reason is required to reopen a ticket." });
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (!["Resolved", "Closed"].includes(existing.status)) return res.status(400).json({ code: "SUPPORT_INVALID_TRANSITION", message: "Only a resolved or closed ticket can be reopened." });
  await prisma.ticket.update({
    where: { id: existing.id },
    data: { status: "Open", resolvedAt: null, closedAt: null, csatScore: null, updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } },
  });
  await audit(req, "support.ticket.reopened", existing.id, { reason: req.body.reason });
  await saved(req, res, existing.id);
}
