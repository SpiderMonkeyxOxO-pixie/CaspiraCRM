// Backend-mode data source for the Support pages (VITE_BACKEND_SUPPORT_MODE=true).
// The ticket UI was built against the mock layer's shape — names instead of
// ids, replies/notes/escalations as arrays on the ticket — so this maps the
// backend's related records (TicketMessage, TicketEscalation, memberships)
// onto that shape.
import * as support from "./backendSupportClient";
import { orgId, ownersMap, listAll } from "./crmBackendCommon";

export const BACKEND_ENABLED = support.BACKEND_SUPPORT_MODE_ENABLED;

export function toUiTicket(ticket, ownersById = new Map()) {
  if (!ticket) return ticket;
  const nameOf = (membershipId) => ownersById.get(membershipId)?.name || (membershipId ? "Member" : "Agent");
  const messages = (kind) =>
    (ticket.messages || []).filter((m) => m.kind === kind).map((m) => ({ _id: m._id, message: m.body, author: nameOf(m.authorMembershipId), at: m.createdAt }));
  return {
    ...ticket,
    companyName: ticket.company?.name || "",
    contactName: ticket.contact?.name || "Unknown",
    assignedAgentId: ticket.assignedMembershipId || null,
    assignedAgent: ticket.assignedMembershipId ? nameOf(ticket.assignedMembershipId) : null,
    publicReplies: messages("Reply"),
    privateNotes: messages("Note"),
    escalations: (ticket.escalationEvents || []).map((e) => ({ from: e.fromDepartment, to: e.toDepartment, reason: e.reason, at: e.createdAt })),
    resolution: ticket.resolutionSummary ? { summary: ticket.resolutionSummary, resolvedAt: ticket.resolvedAt } : null,
  };
}

const CREATE_FIELDS = ["subject", "description", "source", "category", "priority", "department", "companyId", "contactId"];

export function toApiTicket(payload = {}) {
  const out = Object.fromEntries(CREATE_FIELDS.filter((f) => f in payload).map((f) => [f, payload[f] || null]));
  if (payload.assignedAgentId) out.assignedMembershipId = payload.assignedAgentId;
  return out;
}

export async function listTickets() {
  const organizationId = orgId();
  const [tickets, owners] = await Promise.all([
    listAll(async (page, pageSize) => {
      const { tickets: items, total } = await support.listTickets(organizationId, { page, pageSize });
      return { items: items || [], total };
    }),
    ownersMap(),
  ]);
  return tickets.map((t) => toUiTicket(t, owners));
}

async function mapped(promise) {
  const [{ ticket }, owners] = await Promise.all([promise, ownersMap()]);
  return toUiTicket(ticket, owners);
}

export const getTicket = (id) => mapped(support.getTicket(orgId(), id));
export const createTicket = (payload) => mapped(support.createTicket(orgId(), toApiTicket(payload)));
export const advanceTicket = (id, status) => mapped(support.advanceTicket(orgId(), id, status));
export const replyToTicket = (id, message) => mapped(support.replyToTicket(orgId(), id, message));
export const addTicketNote = (id, message) => mapped(support.addTicketNote(orgId(), id, message));
export const escalateTicket = (id, to, reason) => mapped(support.escalateTicket(orgId(), id, to, reason));
export const resolveTicket = (id, summary) => mapped(support.resolveTicket(orgId(), id, summary));
export const closeTicket = (id, csatScore) => mapped(support.closeTicket(orgId(), id, csatScore));

// The assign dialog also picks a department. Moving a ticket to another
// department is an escalation on the backend (it keeps a history), so a
// department change is recorded as one, with the reason saying so.
export async function assignTicket(id, { assignedAgentId, department }) {
  const organizationId = orgId();
  const { ticket } = await support.getTicket(organizationId, id);
  if (department && department !== ticket.department) {
    await support.escalateTicket(organizationId, id, department, `Routed to ${department} while assigning the ticket`);
  }
  return mapped(support.assignTicket(organizationId, id, assignedAgentId || null));
}
