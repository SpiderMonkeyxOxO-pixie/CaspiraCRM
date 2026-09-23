// Backend Phase 4 — ticket visibility, reference validation, assignment
// (manual and deterministic round-robin) and related-ticket detection.
import prisma from "../../lib/prisma.js";
import { broadestScope } from "../crm/scopeService.js";
import { membershipHasGrant } from "../../utils/grants.js";
import { ACTIVE_STATUSES, normalizeSubject } from "./ticketLifecycleService.js";

// ---- Visibility ---------------------------------------------------------
// Organization/System-wide scope sees every ticket. Narrower scopes see a
// ticket when they created it, own it, are assigned it, follow it, or are
// an active member of its queue. Department/Team scope also sees tickets in
// queues of their department.
export function ticketScopeWhere(req) {
  if (req.isSystemOwnerOverride) return {};
  const scope = broadestScope(req.membership, "tickets");
  if (scope === "Organization" || scope === "System-wide") return {};
  const me = req.membership.id;
  const or = [
    { createdByMembershipId: me },
    { ownerMembershipId: me },
    { assignedMembershipId: me },
    { followers: { some: { membershipId: me } } },
    { queue: { members: { some: { membershipId: me, active: true } } } },
  ];
  if ((scope === "Department" || scope === "Team") && req.user?.department) or.push({ queue: { department: req.user.department } });
  return { OR: or };
}

// Whether another member could see this ticket under their own scope —
// used before adding them as a follower (following never widens access).
export async function membershipCanSeeTicket(membershipId, ticket) {
  const membership = await prisma.organizationMembership.findFirst({
    where: { id: membershipId, organizationId: ticket.organizationId, status: "Active" },
    include: { roles: { include: { role: true } }, user: { select: { department: true } } },
  });
  if (!membership || !membershipHasGrant(membership, "tickets", "view")) return false;
  const scope = broadestScope(membership, "tickets");
  if (scope === "Organization" || scope === "System-wide") return true;
  if ([ticket.createdByMembershipId, ticket.ownerMembershipId, ticket.assignedMembershipId].includes(membershipId)) return true;
  if (ticket.queueId) {
    const inQueue = await prisma.supportQueueMember.findFirst({ where: { queueId: ticket.queueId, membershipId, active: true } });
    if (inQueue) return true;
    if ((scope === "Department" || scope === "Team") && membership.user?.department) {
      const queue = await prisma.supportQueue.findUnique({ where: { id: ticket.queueId } });
      if (queue?.department === membership.user.department) return true;
    }
  }
  return false;
}

// ---- References -----------------------------------------------------------
// Every linked record must belong to the ticket's organization. Returns the
// name of the first invalid field, or null.
export async function invalidTicketRef(organizationId, refs) {
  const { companyId, contactId, inboxId, queueId, categoryId, subcategoryId, relatedLeadId, relatedDealId, relatedOrderId, relatedContractId } = refs;
  const inOrg = (model, id, extra = {}) => prisma[model].findFirst({ where: { id, organizationId, ...extra } });
  if (companyId && !(await inOrg("company", companyId))) return "companyId";
  if (contactId) {
    const contact = await inOrg("contact", contactId);
    if (!contact) return "contactId";
    if (companyId && contact.companyId && contact.companyId !== companyId) return "contactId (belongs to a different company)";
  }
  if (inboxId && !(await inOrg("supportInbox", inboxId, { archivedAt: null, active: true }))) return "inboxId";
  if (queueId && !(await inOrg("supportQueue", queueId, { archivedAt: null, active: true }))) return "queueId";
  // Archived categories stay on old tickets but can't be chosen.
  if (categoryId && !(await inOrg("ticketCategory", categoryId, { archivedAt: null, active: true, parentId: null }))) return "categoryId";
  if (subcategoryId) {
    const sub = await inOrg("ticketCategory", subcategoryId, { archivedAt: null, active: true });
    if (!sub || !sub.parentId || (categoryId && sub.parentId !== categoryId)) return "subcategoryId";
  }
  if (relatedLeadId && !(await inOrg("lead", relatedLeadId))) return "relatedLeadId";
  if (relatedDealId && !(await inOrg("deal", relatedDealId))) return "relatedDealId";
  if (relatedOrderId && !(await inOrg("order", relatedOrderId))) return "relatedOrderId";
  if (relatedContractId && !(await inOrg("contract", relatedContractId))) return "relatedContractId";
  return null;
}

export async function activeMember(organizationId, membershipId) {
  return !!(await prisma.organizationMembership.findFirst({ where: { id: membershipId, organizationId, status: "Active" } }));
}

// ---- Round-robin assignment ------------------------------------------------
// Deterministic: active queue members ordered by when they joined, starting
// after whoever was picked last, skipping anyone at their open-ticket
// capacity. Concurrency-safe: the queue's cursor is advanced with a
// version-checked update, so two simultaneous picks can't both use the
// same position (the loser retries). Never uses AI and never leaves the
// organization.
export async function pickRoundRobin(tx, queue, { attempts = 3 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await tx.supportQueue.findUnique({ where: { id: queue.id } });
    const members = await tx.supportQueueMember.findMany({ where: { queueId: queue.id, active: true }, orderBy: { createdAt: "asc" } });
    const eligible = [];
    for (const m of members) {
      const membership = await tx.organizationMembership.findFirst({ where: { id: m.membershipId, organizationId: current.organizationId, status: "Active" } });
      if (!membership) continue;
      if (m.capacity) {
        const open = await tx.ticket.count({ where: { organizationId: current.organizationId, assignedMembershipId: m.membershipId, archivedAt: null, status: { in: ACTIVE_STATUSES } } });
        if (open >= m.capacity) continue;
      }
      eligible.push(m);
    }
    if (!eligible.length) return { membershipId: null, reason: "No active queue member has capacity." };
    const lastIndex = eligible.findIndex((m) => m.membershipId === current.lastAssignedMembershipId);
    const chosen = eligible[(lastIndex + 1) % eligible.length];
    const moved = await tx.supportQueue.updateMany({ where: { id: current.id, version: current.version }, data: { lastAssignedMembershipId: chosen.membershipId, version: { increment: 1 } } });
    if (moved.count === 1) {
      return { membershipId: chosen.membershipId, reason: `Round robin in queue "${current.name}": next of ${eligible.length} eligible member(s) after the previous pick.` };
    }
  }
  return { membershipId: null, reason: "The queue was busy — try again." };
}

// ---- Related tickets --------------------------------------------------------
// Deterministic signals only — never merges or closes anything.
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function tokens(subject) {
  return new Set(normalizeSubject(subject).split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}

export function subjectSimilarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

export function relatedSignals(ticket, other) {
  const signals = [];
  if (ticket.contactId && ticket.contactId === other.contactId) signals.push("Same requester");
  if (ticket.companyId && ticket.companyId === other.companyId) signals.push("Same company");
  const similarity = subjectSimilarity(ticket.subject, other.subject);
  if (similarity >= 0.6) signals.push(similarity === 1 ? "Same subject" : "Similar subject");
  if (ticket.categoryId && ticket.categoryId === other.categoryId) signals.push("Same category");
  if (Math.abs(new Date(ticket.createdAt) - new Date(other.createdAt)) <= WINDOW_MS) signals.push("Created within 7 days");
  if (ticket.relatedContractId && ticket.relatedContractId === other.relatedContractId) signals.push("Same contract");
  if (ticket.relatedOrderId && ticket.relatedOrderId === other.relatedOrderId) signals.push("Same order");
  return signals;
}
