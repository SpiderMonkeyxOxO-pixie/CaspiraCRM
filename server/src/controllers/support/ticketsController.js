// Backend Phase 4 (full spec) — tickets: lifecycle, assignment, followers,
// conversation, events, archive, related tickets, merge and bulk actions.
// Workflow rules live in services/support/*; this file only orchestrates.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import {
  TICKET_PRIORITIES, TICKET_STATUSES, ACTIVE_STATUSES, RESOLVABLE_FROM, REOPENABLE_FROM,
  canTransition, customerVisibleStatus, normalizeSubject, slaDeadlines,
} from "../../services/support/ticketLifecycleService.js";
import { ticketScopeWhere, invalidTicketRef, activeMember, pickRoundRobin, membershipCanSeeTicket, relatedSignals } from "../../services/support/ticketService.js";
import * as sla from "../../services/support/slaService.js";
import { sanitizeText, invalid, notFound, badTransition, versionConflict, staleVersion, audit, ticketEvent } from "../../services/support/supportCommon.js";

const MAX_PAGE_SIZE = 100;
const MAX_BULK = 100;
const SOURCES = ["Email", "Phone", "Chat", "Portal", "Manual", "Internal"];
const who = (req) => req.membership?.id || null;
const text = (v, max) => (typeof v === "string" && v.trim() ? sanitizeText(v, { max }) : null);

// Notes are filtered by permission IN THE QUERY — a frontend mistake can't
// reveal what the API never returned.
export function allowedVisibilities(req) {
  const v = ["Customer Visible"];
  if (hasGrant(req, "tickets", "view_internal_notes")) v.push("Internal Only");
  if (hasGrant(req, "tickets", "view_restricted_notes")) v.push("Restricted Management");
  return v;
}

const include = (req) => ({
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
  queue: { select: { id: true, name: true } },
  inbox: { select: { id: true, name: true, channelType: true } },
  categoryRef: { select: { id: true, name: true } },
  subcategoryRef: { select: { id: true, name: true } },
  followers: { select: { membershipId: true, createdAt: true } },
  messages: { where: { visibility: { in: allowedVisibilities(req) }, archivedAt: null }, orderBy: { createdAt: "asc" } },
  escalationEvents: { orderBy: { createdAt: "asc" } },
});

const serialize = (ticket) => ticket && { ...toApi(ticket), customerVisibleStatus: customerVisibleStatus(ticket.status) };

async function loadTicket(req, res, id = req.params.ticketId, { includeArchived = true } = {}) {
  const ticket = await prisma.ticket.findFirst({
    where: { id, organizationId: req.organizationId, ...(includeArchived ? {} : { archivedAt: null }), ...ticketScopeWhere(req) },
    include: include(req),
  });
  if (!ticket) notFound(res, "Ticket");
  return ticket;
}

async function saved(req, res, ticketId, status = 200) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: include(req) });
  res.status(status).json({ ticket: serialize(ticket) });
}

const refErr = (res, field) => res.status(400).json({ code: "SUPPORT_REFERENCE_INVALID", message: `${field} must reference an active record in this organization.` });
const archivedErr = (res) => badTransition(res, "This ticket is archived — restore it first.");

const bump = (req, data = {}) => ({ ...data, updatedByMembershipId: who(req), version: { increment: 1 } });

// ---------------------------------------------------------------- List / read

const SORTS = { createdAt: "createdAt", updatedAt: "updatedAt", priority: "priority", ticketNumber: "ticketNumber" };

export function buildListWhere(req) {
  const q = req.query;
  const where = { organizationId: req.organizationId, ...ticketScopeWhere(req) };
  if (q.includeArchived !== "true") where.archivedAt = null;
  for (const f of ["status", "priority", "department", "queueId", "inboxId", "categoryId", "companyId", "contactId", "source"]) if (q[f]) where[f] = q[f];
  if (q.assignedMembershipId === "unassigned") where.assignedMembershipId = null;
  else if (q.assignedMembershipId) where.assignedMembershipId = q.assignedMembershipId;
  const and = [];
  if (q.open === "true") and.push({ status: { in: ACTIVE_STATUSES } });
  if (q.followedByMe === "true" && req.membership) and.push({ followers: { some: { membershipId: req.membership.id } } });
  // Search stays inside the caller's scope (it's ANDed with the scope above).
  if (q.search) and.push({ OR: [{ ticketNumber: { contains: q.search, mode: "insensitive" } }, { subject: { contains: q.search, mode: "insensitive" } }] });
  if (and.length) where.AND = and;
  return where;
}

export async function list(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25));
  const sortField = SORTS[req.query.sort] || "createdAt";
  const where = buildListWhere(req);
  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({ where, include: include(req), orderBy: { [sortField]: req.query.order === "asc" ? "asc" : "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.ticket.count({ where }),
  ]);
  res.json({ tickets: tickets.map(serialize), total, page, pageSize });
}

export async function getOne(req, res) {
  const ticket = await loadTicket(req, res);
  if (!ticket) return;
  res.json({ ticket: serialize(ticket) });
}

export async function listEvents(req, res) {
  const ticket = await loadTicket(req, res);
  if (!ticket) return;
  const events = await prisma.ticketEvent.findMany({ where: { ticketId: ticket.id }, orderBy: { createdAt: "asc" } });
  res.json({ events: toApi(events) });
}

export async function listMessages(req, res) {
  const ticket = await loadTicket(req, res);
  if (!ticket) return;
  res.json({ messages: toApi(ticket.messages) });
}

// ---------------------------------------------------------------- Create / update

const CREATE_REFS = ["companyId", "contactId", "inboxId", "queueId", "categoryId", "subcategoryId", "relatedLeadId", "relatedDealId", "relatedOrderId", "relatedContractId"];

export async function create(req, res) {
  const b = req.body;
  const subject = text(b.subject, 300);
  if (!subject) return invalid(res, "subject is required.");
  const refs = Object.fromEntries(CREATE_REFS.map((f) => [f, b[f] || null]));
  const refError = await invalidTicketRef(req.organizationId, refs);
  if (refError) return refErr(res, refError);

  // Defaults come from the category, then the inbox.
  const category = refs.categoryId ? await prisma.ticketCategory.findUnique({ where: { id: refs.categoryId } }) : null;
  const inbox = refs.inboxId ? await prisma.supportInbox.findUnique({ where: { id: refs.inboxId } }) : null;
  const queueId = refs.queueId || category?.defaultQueueId || inbox?.defaultQueueId || null;
  const priority = b.priority || category?.defaultPriority || "Medium";
  if (!TICKET_PRIORITIES.includes(priority)) return invalid(res, `priority must be one of ${TICKET_PRIORITIES.join(", ")}.`);
  const source = b.source || "Manual";
  if (!SOURCES.includes(source)) return invalid(res, `source must be one of ${SOURCES.join(", ")}.`);

  let assignedMembershipId = b.assignedMembershipId || null;
  if (assignedMembershipId) {
    if (assignedMembershipId !== who(req) && !hasGrant(req, "tickets", "assign")) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "You don't have permission to assign tickets to other members." });
    if (!(await activeMember(req.organizationId, assignedMembershipId))) return refErr(res, "assignedMembershipId");
  }
  const ownerMembershipId = b.ownerMembershipId || null;
  if (ownerMembershipId && !(await activeMember(req.organizationId, ownerMembershipId))) return refErr(res, "ownerMembershipId");

  const now = new Date();
  const ticket = await prisma.$transaction(async (tx) => {
    let assignmentReason = assignedMembershipId ? "Assigned when the ticket was created." : null;
    if (!assignedMembershipId && queueId) {
      const queue = await tx.supportQueue.findUnique({ where: { id: queueId } });
      if (queue?.assignmentMode === "Round Robin") {
        const pick = await pickRoundRobin(tx, queue);
        assignedMembershipId = pick.membershipId;
        assignmentReason = pick.reason;
      }
    }
    const ticketNumber = await nextDocumentNumber(tx, req.organizationId, "Ticket");
    const created = await tx.ticket.create({
      data: {
        ...refs, queueId, subject, normalizedSubject: normalizeSubject(subject), description: text(b.description, 20000), source, priority,
        category: category?.name || (typeof b.category === "string" ? b.category : "General"),
        department: text(b.department, 80) || "Support", team: text(b.team, 80),
        organizationId: req.organizationId, ticketNumber, status: "New", createdAt: now, ...slaDeadlines(priority, now),
        assignedMembershipId, ownerMembershipId, createdByMembershipId: who(req), updatedByMembershipId: who(req),
      },
    });
    await ticketEvent(tx, { organizationId: req.organizationId, ticketId: created.id, eventType: "Created", actorMembershipId: who(req), toValue: "New", customerVisible: true, snapshot: { ticketNumber, priority, queueId, categoryName: category?.name || null } });
    if (assignedMembershipId) {
      await ticketEvent(tx, { organizationId: req.organizationId, ticketId: created.id, eventType: "Assigned", actorMembershipId: who(req), toValue: assignedMembershipId, reason: assignmentReason });
    }
    await sla.startClocks(tx, created);
    return created;
  });
  await audit(req, "support.ticket.created", "Ticket", ticket.id);
  await saved(req, res, ticket.id, 201);
}

const UPDATE_REFS = ["companyId", "contactId", "categoryId", "subcategoryId", "relatedLeadId", "relatedDealId", "relatedOrderId", "relatedContractId"];

export async function update(req, res) {
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (existing.archivedAt) return archivedErr(res);
  if (["Resolved", "Closed", "Cancelled"].includes(existing.status)) return badTransition(res, "A resolved, closed or cancelled ticket can't be edited — reopen it first.");
  if (staleVersion(req.body, existing)) return versionConflict(res, "ticket");
  const b = req.body;
  const data = {};
  if ("subject" in b) {
    const subject = text(b.subject, 300);
    if (!subject) return invalid(res, "subject can't be empty.");
    Object.assign(data, { subject, normalizedSubject: normalizeSubject(subject) });
  }
  if ("description" in b) data.description = text(b.description, 20000);
  if ("source" in b) {
    if (!SOURCES.includes(b.source)) return invalid(res, `source must be one of ${SOURCES.join(", ")}.`);
    data.source = b.source;
  }
  for (const f of ["team", "waitingReason"]) if (f in b) data[f] = text(b[f], 500);
  if ("category" in b && !("categoryId" in b)) data.category = text(b.category, 80) || "General";
  if ("priority" in b) {
    if (!TICKET_PRIORITIES.includes(b.priority)) return invalid(res, `priority must be one of ${TICKET_PRIORITIES.join(", ")}.`);
    data.priority = b.priority;
  }
  for (const f of UPDATE_REFS) if (f in b) data[f] = b[f] || null;
  const refError = await invalidTicketRef(req.organizationId, {
    companyId: "companyId" in data ? data.companyId : existing.companyId,
    contactId: "contactId" in data ? data.contactId : undefined,
    categoryId: "categoryId" in data ? data.categoryId : undefined,
    subcategoryId: "subcategoryId" in data ? data.subcategoryId : undefined,
    relatedLeadId: data.relatedLeadId, relatedDealId: data.relatedDealId, relatedOrderId: data.relatedOrderId, relatedContractId: data.relatedContractId,
  });
  if (refError) return refErr(res, refError);
  if ("categoryId" in data && data.categoryId) data.category = (await prisma.ticketCategory.findUnique({ where: { id: data.categoryId } })).name;

  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: existing.id }, data: bump(req, data) });
    const ev = (eventType, fromValue, toValue, snapshot = {}) => ticketEvent(tx, { organizationId: req.organizationId, ticketId: existing.id, eventType, actorMembershipId: who(req), fromValue, toValue, snapshot });
    if (data.priority && data.priority !== existing.priority) {
      await ev("Priority Changed", existing.priority, data.priority);
      await sla.onPriorityChange(tx, { ...existing, ...data }, existing.priority);
    }
    if ("categoryId" in data && data.categoryId !== existing.categoryId) await ev("Category Changed", existing.categoryRef?.name || existing.category, data.category, { categoryId: data.categoryId });
    const relFields = ["companyId", "contactId", "relatedLeadId", "relatedDealId", "relatedOrderId", "relatedContractId"].filter((f) => f in data && data[f] !== existing[f]);
    if (relFields.length) await ev("Relationship Changed", null, null, { fields: relFields });
  });
  await audit(req, "support.ticket.updated", "Ticket", existing.id, { before: { priority: existing.priority }, after: { priority: data.priority ?? existing.priority } });
  await saved(req, res, existing.id);
}

// ---------------------------------------------------------------- Status

async function changeStatus(req, res, existing, to, { reason = null, data = {}, eventType = "Status Changed", auditAction = "support.ticket.status_changed" } = {}) {
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: existing.id }, data: bump(req, { status: to, ...data }) });
    await ticketEvent(tx, { organizationId: req.organizationId, ticketId: existing.id, eventType, actorMembershipId: who(req), fromValue: existing.status, toValue: to, reason, customerVisible: true });
    await sla.onStatusChange(tx, { ...existing, status: to }, existing.status);
  });
  await audit(req, auditAction, "Ticket", existing.id, { reason, before: { status: existing.status }, after: { status: to } });
  await saved(req, res, existing.id);
}

// POST /transition { status, reason? } — the working moves. Cancelling
// needs a reason; waiting states may carry one.
export async function transition(req, res) {
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (existing.archivedAt) return archivedErr(res);
  if (staleVersion(req.body, existing)) return versionConflict(res, "ticket");
  const to = req.body.status;
  if (!TICKET_STATUSES.includes(to) || !canTransition(existing.status, to)) {
    return badTransition(res, `Can't move a ticket from "${existing.status}" to "${to}".${["Resolved", "Closed"].includes(to) ? ` Use ${to === "Resolved" ? "resolve" : "close"} instead.` : ""}`);
  }
  const reason = text(req.body.reason, 1000);
  if (to === "Cancelled") {
    if (!reason) return invalid(res, "A reason is required to cancel a ticket.");
    return changeStatus(req, res, existing, to, { reason, data: { cancelledAt: new Date(), cancellationReason: reason }, eventType: "Cancelled", auditAction: "support.ticket.cancelled" });
  }
  const waiting = to.startsWith("Waiting") ? { waitingReason: reason } : { waitingReason: null };
  return changeStatus(req, res, existing, to, { reason, data: waiting });
}

export async function resolve(req, res) {
  const summary = text(req.body.summary, 5000);
  const code = text(req.body.resolutionCode, 80);
  if (!summary && !code) return invalid(res, "A resolution summary or resolution code is required.");
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (existing.archivedAt) return archivedErr(res);
  if (!RESOLVABLE_FROM.includes(existing.status)) return badTransition(res, `A ${existing.status} ticket can't be resolved.`);
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: existing.id }, data: bump(req, { status: "Resolved", resolutionSummary: summary, resolutionCode: code, resolvedAt: new Date(), waitingReason: null }) });
    await ticketEvent(tx, { organizationId: req.organizationId, ticketId: existing.id, eventType: "Resolved", actorMembershipId: who(req), fromValue: existing.status, toValue: "Resolved", reason: code, customerVisible: true });
    await sla.onResolved(tx, existing);
  });
  await audit(req, "support.ticket.resolved", "Ticket", existing.id);
  await saved(req, res, existing.id);
}

// Closing needs its own permission (route) and a resolved ticket. Agents
// never record customer satisfaction — only the customer can (portal).
export async function close(req, res) {
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (existing.archivedAt) return archivedErr(res);
  if (existing.status !== "Resolved") return badTransition(res, "Only a resolved ticket can be closed.");
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: existing.id }, data: bump(req, { status: "Closed", closedAt: new Date() }) });
    await ticketEvent(tx, { organizationId: req.organizationId, ticketId: existing.id, eventType: "Closed", actorMembershipId: who(req), fromValue: "Resolved", toValue: "Closed", customerVisible: true });
    await sla.onFinished(tx, existing);
  });
  await audit(req, "support.ticket.closed", "Ticket", existing.id);
  await saved(req, res, existing.id);
}

export async function reopen(req, res) {
  const reason = text(req.body.reason, 1000);
  if (!reason) return invalid(res, "A reason is required to reopen a ticket.");
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (existing.archivedAt) return archivedErr(res);
  if (!REOPENABLE_FROM.includes(existing.status)) return badTransition(res, "Only a resolved or closed ticket can be reopened.");
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: existing.id }, data: bump(req, { status: "Open", reopenedAt: new Date(), resolvedAt: null, closedAt: null }) });
    await ticketEvent(tx, { organizationId: req.organizationId, ticketId: existing.id, eventType: "Reopened", actorMembershipId: who(req), fromValue: existing.status, toValue: "Open", reason, customerVisible: true });
    await sla.onReopened(tx, existing);
  });
  await audit(req, "support.ticket.reopened", "Ticket", existing.id, { reason });
  await saved(req, res, existing.id);
}

// ---------------------------------------------------------------- Assignment

// POST /assign { assignedMembershipId? | roundRobin: true, queueId? }
// Moves the ticket to another queue and/or assigns it: manually, to nobody,
// or to the next eligible queue member (round robin, recorded with why).
export async function assign(req, res) {
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (existing.archivedAt) return archivedErr(res);
  if (staleVersion(req.body, existing)) return versionConflict(res, "ticket");
  const b = req.body;
  const queueId = "queueId" in b ? b.queueId || null : existing.queueId;
  if (queueId && queueId !== existing.queueId && (await invalidTicketRef(req.organizationId, { queueId }))) return refErr(res, "queueId");
  if (b.assignedMembershipId && !(await activeMember(req.organizationId, b.assignedMembershipId))) return refErr(res, "assignedMembershipId");

  const result = await prisma.$transaction(async (tx) => {
    let assignee = "assignedMembershipId" in b ? b.assignedMembershipId || null : existing.assignedMembershipId;
    let reason = text(b.reason, 500) || (b.assignedMembershipId ? "Manual assignment." : "assignedMembershipId" in b ? "Unassigned." : null);
    if (b.roundRobin) {
      if (!queueId) return { error: "Round robin needs a queue." };
      const queue = await tx.supportQueue.findUnique({ where: { id: queueId } });
      const pick = await pickRoundRobin(tx, queue);
      if (!pick.membershipId) return { error: pick.reason };
      assignee = pick.membershipId;
      reason = pick.reason;
    }
    await tx.ticket.update({ where: { id: existing.id }, data: bump(req, { assignedMembershipId: assignee, queueId }) });
    if (queueId !== existing.queueId) {
      const queue = queueId ? await tx.supportQueue.findUnique({ where: { id: queueId } }) : null;
      await ticketEvent(tx, { organizationId: req.organizationId, ticketId: existing.id, eventType: "Queue Changed", actorMembershipId: who(req), fromValue: existing.queue?.name || null, toValue: queue?.name || null, snapshot: { fromQueueId: existing.queueId, toQueueId: queueId } });
    }
    if (assignee !== existing.assignedMembershipId) {
      await ticketEvent(tx, { organizationId: req.organizationId, ticketId: existing.id, eventType: existing.assignedMembershipId ? "Reassigned" : "Assigned", actorMembershipId: who(req), fromValue: existing.assignedMembershipId, toValue: assignee, reason });
    }
    return { assignee, reason };
  });
  if (result.error) return invalid(res, result.error);
  await audit(req, "support.ticket.assigned", "Ticket", existing.id, { reason: result.reason, before: { assignedMembershipId: existing.assignedMembershipId, queueId: existing.queueId }, after: { assignedMembershipId: result.assignee, queueId } });
  await saved(req, res, existing.id);
}

// ---------------------------------------------------------------- Followers

// Following never widens access: the follower must already be able to see
// the ticket. Following someone else needs the assign permission.
export async function addFollower(req, res) {
  const existing = await loadTicket(req, res);
  if (!existing) return;
  const membershipId = req.body.membershipId || who(req);
  if (membershipId !== who(req) && !hasGrant(req, "tickets", "assign")) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "You can only follow tickets yourself." });
  if (membershipId !== who(req) && !(await membershipCanSeeTicket(membershipId, existing))) {
    return invalid(res, "That member can't see this ticket, so they can't follow it.");
  }
  const already = existing.followers.some((f) => f.membershipId === membershipId);
  if (!already) {
    await prisma.$transaction([
      prisma.ticketFollower.create({ data: { organizationId: req.organizationId, ticketId: existing.id, membershipId, addedByMembershipId: who(req) } }),
      prisma.ticketEvent.create({ data: { organizationId: req.organizationId, ticketId: existing.id, eventType: "Follower Added", actorMembershipId: who(req), toValue: membershipId } }),
    ]);
    await audit(req, "support.ticket.follower_added", "Ticket", existing.id, { after: { membershipId } });
  }
  await saved(req, res, existing.id);
}

export async function removeFollower(req, res) {
  const existing = await loadTicket(req, res);
  if (!existing) return;
  const membershipId = req.params.membershipId;
  if (membershipId !== who(req) && !hasGrant(req, "tickets", "assign")) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "You can only unfollow tickets yourself." });
  const follower = await prisma.ticketFollower.findUnique({ where: { ticketId_membershipId: { ticketId: existing.id, membershipId } } });
  if (!follower) return notFound(res, "Follower");
  await prisma.$transaction([
    prisma.ticketFollower.delete({ where: { id: follower.id } }),
    prisma.ticketEvent.create({ data: { organizationId: req.organizationId, ticketId: existing.id, eventType: "Follower Removed", actorMembershipId: who(req), fromValue: membershipId } }),
  ]);
  await audit(req, "support.ticket.follower_removed", "Ticket", existing.id, { before: { membershipId } });
  await saved(req, res, existing.id);
}

// ---------------------------------------------------------------- Conversation

// Public reply: customer-visible. Delivery is honest — the portal shows it
// immediately when the requester has portal access; otherwise it waits for
// a provider that isn't connected yet. Never "Sent".
export async function reply(req, res) {
  const body = text(req.body.message, 20000);
  if (!body) return invalid(res, "A reply can't be empty.");
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (existing.archivedAt) return archivedErr(res);
  if (["Closed", "Cancelled"].includes(existing.status)) return badTransition(res, "A closed or cancelled ticket can't take replies — reopen it first.");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const message = await tx.ticketMessage.create({
      data: {
        ticketId: existing.id, organizationId: req.organizationId, kind: "Reply", messageType: "Agent Reply", visibility: "Customer Visible", authorType: "Agent",
        body, sanitizedBody: body, authorMembershipId: who(req), source: "Agent Console",
        deliveryStatus: existing.portalAccountId ? "Delivered to Portal" : "Pending Provider",
      },
    });
    // The server's clock decides the first response — never the client's.
    const data = {};
    if (!existing.firstRespondedAt) data.firstRespondedAt = now;
    if (existing.status === "New") data.status = "Open";
    if (Object.keys(data).length) await tx.ticket.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
    await ticketEvent(tx, { organizationId: req.organizationId, ticketId: existing.id, eventType: "Public Reply", actorMembershipId: who(req), customerVisible: true, snapshot: { messageId: message.id } });
    if (data.status) await ticketEvent(tx, { organizationId: req.organizationId, ticketId: existing.id, eventType: "Status Changed", actorType: "System", fromValue: "New", toValue: "Open", reason: "First reply" , customerVisible: true });
    await sla.onPublicAgentReply(tx, existing, now);
  });
  await audit(req, "support.ticket.replied", "Ticket", existing.id);
  await saved(req, res, existing.id);
}

// Internal note — never customer-visible, never delivered, never counts as
// a response. `restricted: true` limits it to restricted-note readers.
export async function addInternalNote(req, res) {
  const body = text(req.body.message, 20000);
  if (!body) return invalid(res, "A note can't be empty.");
  const restricted = Boolean(req.body.restricted);
  if (restricted && !hasGrant(req, "tickets", "view_restricted_notes")) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "You don't have permission to write restricted notes." });
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (existing.archivedAt) return archivedErr(res);
  await prisma.$transaction(async (tx) => {
    const message = await tx.ticketMessage.create({
      data: {
        ticketId: existing.id, organizationId: req.organizationId, kind: "Note", messageType: "Internal Note", visibility: restricted ? "Restricted Management" : "Internal Only",
        authorType: "Agent", body, sanitizedBody: body, authorMembershipId: who(req), source: "Agent Console", deliveryStatus: "Not Applicable",
      },
    });
    await ticketEvent(tx, { organizationId: req.organizationId, ticketId: existing.id, eventType: "Internal Note", actorMembershipId: who(req), snapshot: { messageId: message.id, restricted } });
  });
  await audit(req, "support.ticket.note_added", "Ticket", existing.id);
  await saved(req, res, existing.id);
}

async function loadMessage(req, res) {
  const message = await prisma.ticketMessage.findFirst({ where: { id: req.params.messageId, organizationId: req.organizationId, visibility: { in: allowedVisibilities(req) } } });
  if (!message) { notFound(res, "Message"); return null; }
  // The message's ticket must be visible to the caller too.
  const ticket = await loadTicket(req, res, message.ticketId);
  if (!ticket) return null;
  if (message.authorType !== "Agent") { res.status(403).json({ code: "RBAC_FORBIDDEN", message: "Customer messages can't be edited by staff." }); return null; }
  if (message.authorMembershipId !== who(req) && !hasGrant(req, "tickets", "edit")) { res.status(403).json({ code: "RBAC_FORBIDDEN", message: "You can only edit your own messages." }); return null; }
  return { message, ticket };
}

export async function editMessage(req, res) {
  const loaded = await loadMessage(req, res);
  if (!loaded) return;
  const { message } = loaded;
  if (message.archivedAt) return badTransition(res, "An archived message can't be edited.");
  if (staleVersion(req.body, message)) return versionConflict(res, "message");
  const body = text(req.body.message, 20000);
  if (!body) return invalid(res, "A message can't be empty.");
  const updated = await prisma.ticketMessage.update({ where: { id: message.id }, data: { body, sanitizedBody: body, editedAt: new Date(), version: { increment: 1 } } });
  await audit(req, "support.message.edited", "TicketMessage", message.id);
  res.json({ message: toApi(updated) });
}

export async function archiveMessage(req, res) {
  const loaded = await loadMessage(req, res);
  if (!loaded) return;
  const { message } = loaded;
  if (message.archivedAt) return badTransition(res, "This message is already archived.");
  const updated = await prisma.ticketMessage.update({ where: { id: message.id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
  await audit(req, "support.message.archived", "TicketMessage", message.id, { reason: text(req.body.reason, 500) });
  res.json({ message: toApi(updated) });
}

// ---------------------------------------------------------------- Escalation

export async function escalate(req, res) {
  const to = text(req.body.to, 80);
  const reason = text(req.body.reason, 1000);
  if (!to) return invalid(res, "A destination department is required.");
  if (!reason) return invalid(res, "A reason is required to escalate a ticket.");
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (existing.archivedAt) return archivedErr(res);
  if (!ACTIVE_STATUSES.includes(existing.status)) return badTransition(res, "Only an active ticket can be escalated.");
  if (to === existing.department) return invalid(res, `The ticket is already with ${to}.`);
  await prisma.$transaction([
    prisma.ticketEscalation.create({ data: { ticketId: existing.id, organizationId: req.organizationId, fromDepartment: existing.department, toDepartment: to, reason, escalatedByMembershipId: who(req) } }),
    prisma.ticket.update({ where: { id: existing.id }, data: bump(req, { department: to }) }),
    prisma.ticketEvent.create({ data: { organizationId: req.organizationId, ticketId: existing.id, eventType: "Escalated", actorMembershipId: who(req), fromValue: existing.department, toValue: to, reason } }),
  ]);
  await audit(req, "support.ticket.escalated", "Ticket", existing.id, { reason, before: { department: existing.department }, after: { department: to } });
  await saved(req, res, existing.id);
}

// ---------------------------------------------------------------- Archive

export async function archive(req, res) {
  const reason = text(req.body.reason, 500);
  if (!reason) return invalid(res, "A reason is required to archive a ticket.");
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (existing.archivedAt) return badTransition(res, "This ticket is already archived.");
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: existing.id }, data: bump(req, { archivedAt: new Date(), archiveReason: reason, archivedByMembershipId: who(req), statusBeforeArchive: existing.status }) });
    await ticketEvent(tx, { organizationId: req.organizationId, ticketId: existing.id, eventType: "Archived", actorMembershipId: who(req), reason });
    await sla.onFinished(tx, existing);
  });
  await audit(req, "support.ticket.archived", "Ticket", existing.id, { reason });
  await saved(req, res, existing.id);
}

export async function restore(req, res) {
  const existing = await loadTicket(req, res);
  if (!existing) return;
  if (!existing.archivedAt) return badTransition(res, "This ticket isn't archived.");
  if (existing.mergedIntoTicketId) return badTransition(res, "A merged ticket can't be restored.");
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: existing.id }, data: bump(req, { archivedAt: null, archiveReason: null, archivedByMembershipId: null }) });
    await ticketEvent(tx, { organizationId: req.organizationId, ticketId: existing.id, eventType: "Restored", actorMembershipId: who(req) });
  });
  await audit(req, "support.ticket.restored", "Ticket", existing.id);
  await saved(req, res, existing.id);
}

// ---------------------------------------------------------------- Related / merge

// Deterministic candidates, inside the caller's scope only.
export async function related(req, res) {
  const existing = await loadTicket(req, res);
  if (!existing) return;
  const or = [
    existing.contactId && { contactId: existing.contactId },
    existing.companyId && { companyId: existing.companyId },
    existing.categoryId && { categoryId: existing.categoryId },
    existing.relatedContractId && { relatedContractId: existing.relatedContractId },
    existing.relatedOrderId && { relatedOrderId: existing.relatedOrderId },
    { createdAt: { gte: new Date(existing.createdAt.getTime() - 7 * 86400000), lte: new Date(existing.createdAt.getTime() + 7 * 86400000) } },
  ].filter(Boolean);
  const candidates = await prisma.ticket.findMany({
    where: { organizationId: req.organizationId, id: { not: existing.id }, mergedIntoTicketId: null, AND: [ticketScopeWhere(req), { OR: or }] },
    select: { id: true, ticketNumber: true, subject: true, status: true, contactId: true, companyId: true, categoryId: true, relatedContractId: true, relatedOrderId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const scored = candidates
    .map((c) => ({ ticket: toApi(c), signals: relatedSignals(existing, c) }))
    .filter((c) => c.signals.length >= 2)
    .sort((a, b) => b.signals.length - a.signals.length)
    .slice(0, 10);
  res.json({ related: scored });
}

async function mergePair(req, res) {
  const source = await loadTicket(req, res);
  if (!source) return null;
  const target = await loadTicket(req, res, req.body.targetTicketId);
  if (!target) return null;
  if (source.id === target.id) { invalid(res, "A ticket can't be merged into itself."); return null; }
  if (source.archivedAt || source.mergedIntoTicketId) { badTransition(res, "This ticket is already archived or merged."); return null; }
  if (target.archivedAt || target.mergedIntoTicketId) { badTransition(res, "The destination ticket is archived or merged."); return null; }
  return { source, target };
}

export async function mergePreview(req, res) {
  const pair = await mergePair(req, res);
  if (!pair) return;
  const { source, target } = pair;
  res.json({
    preview: {
      keep: { id: target.id, ticketNumber: target.ticketNumber, subject: target.subject, status: target.status },
      archive: { id: source.id, ticketNumber: source.ticketNumber, subject: source.subject, status: source.status, messageCount: source.messages.length },
      effects: [
        `${source.ticketNumber} is archived as "Merged into ${target.ticketNumber}".`,
        `${source.ticketNumber} keeps its conversation history, linked to ${target.ticketNumber}.`,
        `${target.ticketNumber} is not changed apart from a merge event in its history.`,
      ],
    },
  });
}

// Manual merge: explicit permission (route), a written reason, one
// transaction, idempotency key (route). Never automatic.
export async function merge(req, res) {
  const reason = text(req.body.reason, 1000);
  if (!reason) return invalid(res, "A reason is required to merge tickets.");
  const pair = await mergePair(req, res);
  if (!pair) return;
  const { source, target } = pair;
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: source.id },
      data: bump(req, { mergedIntoTicketId: target.id, archivedAt: new Date(), archiveReason: `Merged into ${target.ticketNumber}`, archivedByMembershipId: who(req), statusBeforeArchive: source.status }),
    });
    await ticketEvent(tx, { organizationId: req.organizationId, ticketId: source.id, eventType: "Merged", actorMembershipId: who(req), toValue: target.ticketNumber, reason, snapshot: { targetTicketId: target.id } });
    await ticketEvent(tx, { organizationId: req.organizationId, ticketId: target.id, eventType: "Merge Received", actorMembershipId: who(req), fromValue: source.ticketNumber, reason, snapshot: { sourceTicketId: source.id } });
    await tx.ticket.update({ where: { id: target.id }, data: { version: { increment: 1 } } });
    await sla.onFinished(tx, source);
  });
  await audit(req, "support.ticket.merged", "Ticket", source.id, { reason, after: { mergedIntoTicketId: target.id } });
  await saved(req, res, target.id);
}

// ---------------------------------------------------------------- Bulk

// Each ticket is checked against the caller's scope and the action's own
// permission — bulk never bypasses either.
const BULK_ACTIONS = { assign: "assign", transition: "transition", archive: "archive" };

export async function bulk(req, res) {
  const { action, ticketIds } = req.body;
  if (!BULK_ACTIONS[action]) return invalid(res, `action must be one of ${Object.keys(BULK_ACTIONS).join(", ")}.`);
  if (!Array.isArray(ticketIds) || !ticketIds.length || ticketIds.length > MAX_BULK) return invalid(res, `ticketIds must list 1 to ${MAX_BULK} tickets.`);
  if (!hasGrant(req, "tickets", BULK_ACTIONS[action])) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: `You don't have permission to ${action} tickets.` });
  const handler = { assign, transition, archive }[action];
  const results = [];
  for (const ticketId of [...new Set(ticketIds)]) {
    const captured = { statusCode: 200, body: null };
    const fakeRes = { status(code) { captured.statusCode = code; return this; }, json(body) { captured.body = body; return this; } };
    // Object.create keeps the request's prototype (client IP, headers) for audit.
    await handler(Object.assign(Object.create(req), { params: { ticketId }, body: { ...req.body.changes } }), fakeRes);
    results.push({ ticketId, ok: captured.statusCode < 300, ...(captured.statusCode >= 300 && { error: captured.body?.message }) });
  }
  await audit(req, `support.ticket.bulk_${action}`, "Ticket", null, { after: { count: results.length, succeeded: results.filter((r) => r.ok).length } });
  res.json({ results });
}

// ---------------------------------------------------------------- Legacy aliases

// Pre-full-spec endpoints the frontend adapter already calls.
export const advance = transition;
export const addNote = addInternalNote;
