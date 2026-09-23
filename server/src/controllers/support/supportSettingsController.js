// Backend Phase 4 — Support configuration: Inboxes, Queues (and their
// members), Ticket Categories and Canned Responses. All organization-scoped,
// version-checked, archived rather than deleted, and audited.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { TICKET_PRIORITIES } from "../../services/support/ticketLifecycleService.js";
import { sanitizeText, normalizeName, invalid, notFound, versionConflict, staleVersion, audit } from "../../services/support/supportCommon.js";

export const CHANNEL_TYPES = ["Manual", "Customer Portal", "Internal", "Email Placeholder", "Chat Placeholder"];
// Placeholder channels exist so tickets can be labelled, but nothing is
// connected: no provider, no inbound webhooks, no delivery.
const DISCONNECTED_CHANNELS = ["Email Placeholder", "Chat Placeholder"];
export const ASSIGNMENT_MODES = ["Manual", "Round Robin"];
const QUEUE_ROLES = ["Agent", "Lead", "Manager"];
const MAX_CAPACITY = 500;

const who = (req) => req.membership?.id || null;
const text = (v, max) => (typeof v === "string" && v.trim() ? sanitizeText(v, { max }) : null);

async function queueInOrg(organizationId, queueId) {
  return !queueId || !!(await prisma.supportQueue.findFirst({ where: { id: queueId, organizationId, archivedAt: null } }));
}

// ---------------------------------------------------------------- Inboxes

const serializeInbox = (inbox) => ({ ...toApi(inbox), connected: !DISCONNECTED_CHANNELS.includes(inbox.channelType) });

export async function listInboxes(req, res) {
  const where = { organizationId: req.organizationId, ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }) };
  const inboxes = await prisma.supportInbox.findMany({ where, orderBy: { name: "asc" } });
  res.json({ inboxes: inboxes.map(serializeInbox) });
}

export async function getInbox(req, res) {
  const inbox = await prisma.supportInbox.findFirst({ where: { id: req.params.inboxId, organizationId: req.organizationId } });
  if (!inbox) return notFound(res, "Inbox");
  res.json({ inbox: serializeInbox(inbox) });
}

function inboxFields(body, { partial }) {
  const out = {};
  if (!partial || "name" in body) {
    const name = text(body.name, 120);
    if (!name) return { error: "name is required." };
    out.name = name;
  }
  if ("description" in body) out.description = text(body.description, 1000);
  if (!partial || "channelType" in body) {
    const channelType = body.channelType || "Manual";
    if (!CHANNEL_TYPES.includes(channelType)) return { error: `channelType must be one of ${CHANNEL_TYPES.join(", ")}.` };
    out.channelType = channelType;
  }
  if ("customerDisplayName" in body) out.customerDisplayName = text(body.customerDisplayName, 120);
  if ("active" in body) out.active = Boolean(body.active);
  if ("defaultQueueId" in body) out.defaultQueueId = body.defaultQueueId || null;
  return { data: out };
}

export async function createInbox(req, res) {
  const { data, error } = inboxFields(req.body, { partial: false });
  if (error) return invalid(res, error);
  if (!(await queueInOrg(req.organizationId, data.defaultQueueId))) return invalid(res, "defaultQueueId must be an active queue in this organization.");
  if (await prisma.supportInbox.findFirst({ where: { organizationId: req.organizationId, name: data.name } })) return invalid(res, `An inbox named "${data.name}" already exists.`);
  const inbox = await prisma.supportInbox.create({ data: { ...data, organizationId: req.organizationId, createdByMembershipId: who(req), updatedByMembershipId: who(req) } });
  await audit(req, "support.inbox.created", "SupportInbox", inbox.id);
  res.status(201).json({ inbox: serializeInbox(inbox) });
}

export async function updateInbox(req, res) {
  const existing = await prisma.supportInbox.findFirst({ where: { id: req.params.inboxId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Inbox");
  if (existing.archivedAt) return invalid(res, "An archived inbox can't be edited.");
  if (staleVersion(req.body, existing)) return versionConflict(res, "inbox");
  const { data, error } = inboxFields(req.body, { partial: true });
  if (error) return invalid(res, error);
  if ("defaultQueueId" in data && !(await queueInOrg(req.organizationId, data.defaultQueueId))) return invalid(res, "defaultQueueId must be an active queue in this organization.");
  const inbox = await prisma.supportInbox.update({ where: { id: existing.id }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } } });
  await audit(req, "support.inbox.updated", "SupportInbox", inbox.id);
  res.json({ inbox: serializeInbox(inbox) });
}

export async function archiveInbox(req, res) {
  const existing = await prisma.supportInbox.findFirst({ where: { id: req.params.inboxId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Inbox");
  if (existing.archivedAt) return invalid(res, "This inbox is already archived.");
  const inbox = await prisma.supportInbox.update({ where: { id: existing.id }, data: { archivedAt: new Date(), active: false, updatedByMembershipId: who(req), version: { increment: 1 } } });
  await audit(req, "support.inbox.archived", "SupportInbox", inbox.id, { reason: text(req.body.reason, 500) });
  res.json({ inbox: serializeInbox(inbox) });
}

// ---------------------------------------------------------------- Queues

const QUEUE_INCLUDE = { members: { where: { active: true }, orderBy: { createdAt: "asc" } } };

export async function listQueues(req, res) {
  const where = { organizationId: req.organizationId, ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }) };
  const queues = await prisma.supportQueue.findMany({ where, include: QUEUE_INCLUDE, orderBy: { name: "asc" } });
  res.json({ queues: toApi(queues) });
}

export async function getQueue(req, res) {
  const queue = await prisma.supportQueue.findFirst({ where: { id: req.params.queueId, organizationId: req.organizationId }, include: QUEUE_INCLUDE });
  if (!queue) return notFound(res, "Queue");
  res.json({ queue: toApi(queue) });
}

async function queueFields(req, { partial }) {
  const body = req.body;
  const out = {};
  if (!partial || "name" in body) {
    const name = text(body.name, 120);
    if (!name) return { error: "name is required." };
    out.name = name;
  }
  for (const f of ["description", "department", "team"]) if (f in body) out[f] = text(body[f], f === "description" ? 1000 : 120);
  if ("active" in body) out.active = Boolean(body.active);
  if (!partial || "assignmentMode" in body) {
    const mode = body.assignmentMode || "Manual";
    if (!ASSIGNMENT_MODES.includes(mode)) return { error: `assignmentMode must be one of ${ASSIGNMENT_MODES.join(", ")}.` };
    out.assignmentMode = mode;
  }
  if ("defaultSlaPolicyId" in body) {
    if (body.defaultSlaPolicyId && !(await prisma.slaPolicy.findFirst({ where: { id: body.defaultSlaPolicyId, organizationId: req.organizationId, archivedAt: null } }))) {
      return { error: "defaultSlaPolicyId must be an active SLA policy in this organization." };
    }
    out.defaultSlaPolicyId = body.defaultSlaPolicyId || null;
  }
  return { data: out };
}

export async function createQueue(req, res) {
  const { data, error } = await queueFields(req, { partial: false });
  if (error) return invalid(res, error);
  if (await prisma.supportQueue.findFirst({ where: { organizationId: req.organizationId, name: data.name } })) return invalid(res, `A queue named "${data.name}" already exists.`);
  const queue = await prisma.supportQueue.create({ data: { ...data, organizationId: req.organizationId, createdByMembershipId: who(req), updatedByMembershipId: who(req) }, include: QUEUE_INCLUDE });
  await audit(req, "support.queue.created", "SupportQueue", queue.id);
  res.status(201).json({ queue: toApi(queue) });
}

export async function updateQueue(req, res) {
  const existing = await prisma.supportQueue.findFirst({ where: { id: req.params.queueId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Queue");
  if (existing.archivedAt) return invalid(res, "An archived queue can't be edited.");
  if (staleVersion(req.body, existing)) return versionConflict(res, "queue");
  const { data, error } = await queueFields(req, { partial: true });
  if (error) return invalid(res, error);
  const queue = await prisma.supportQueue.update({ where: { id: existing.id }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } }, include: QUEUE_INCLUDE });
  await audit(req, "support.queue.updated", "SupportQueue", queue.id, { before: { assignmentMode: existing.assignmentMode }, after: { assignmentMode: queue.assignmentMode } });
  res.json({ queue: toApi(queue) });
}

export async function archiveQueue(req, res) {
  const existing = await prisma.supportQueue.findFirst({ where: { id: req.params.queueId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Queue");
  if (existing.archivedAt) return invalid(res, "This queue is already archived.");
  const open = await prisma.ticket.count({ where: { organizationId: req.organizationId, queueId: existing.id, archivedAt: null, status: { notIn: ["Resolved", "Closed", "Cancelled"] } } });
  if (open) return invalid(res, `This queue still has ${open} open ticket${open === 1 ? "" : "s"} — move them first.`);
  const queue = await prisma.supportQueue.update({ where: { id: existing.id }, data: { archivedAt: new Date(), active: false, updatedByMembershipId: who(req), version: { increment: 1 } }, include: QUEUE_INCLUDE });
  await audit(req, "support.queue.archived", "SupportQueue", queue.id, { reason: text(req.body.reason, 500) });
  res.json({ queue: toApi(queue) });
}

export async function listQueueMembers(req, res) {
  const queue = await prisma.supportQueue.findFirst({ where: { id: req.params.queueId, organizationId: req.organizationId } });
  if (!queue) return notFound(res, "Queue");
  const members = await prisma.supportQueueMember.findMany({ where: { queueId: queue.id, ...(req.query.includeInactive === "true" ? {} : { active: true }) }, orderBy: { createdAt: "asc" } });
  res.json({ members: toApi(members) });
}

// An agent must be an ACTIVE member of the same organization. Re-adding a
// removed member reactivates their row (no duplicates).
export async function addQueueMember(req, res) {
  const queue = await prisma.supportQueue.findFirst({ where: { id: req.params.queueId, organizationId: req.organizationId, archivedAt: null } });
  if (!queue) return notFound(res, "Queue");
  const { membershipId } = req.body;
  const role = req.body.role || "Agent";
  if (!QUEUE_ROLES.includes(role)) return invalid(res, `role must be one of ${QUEUE_ROLES.join(", ")}.`);
  const capacity = req.body.capacity === undefined || req.body.capacity === null || req.body.capacity === "" ? null : Number(req.body.capacity);
  if (capacity !== null && !(Number.isInteger(capacity) && capacity >= 1 && capacity <= MAX_CAPACITY)) return invalid(res, `capacity must be a whole number from 1 to ${MAX_CAPACITY}.`);
  const membership = membershipId && (await prisma.organizationMembership.findFirst({ where: { id: membershipId, organizationId: req.organizationId, status: "Active" } }));
  if (!membership) return invalid(res, "membershipId must be an active member of this organization.");
  const member = await prisma.supportQueueMember.upsert({
    where: { queueId_membershipId: { queueId: queue.id, membershipId } },
    update: { active: true, role, capacity },
    create: { organizationId: req.organizationId, queueId: queue.id, membershipId, role, capacity },
  });
  await audit(req, "support.queue.member_added", "SupportQueue", queue.id, { after: { membershipId, role, capacity } });
  res.status(201).json({ member: toApi(member) });
}

export async function removeQueueMember(req, res) {
  const queue = await prisma.supportQueue.findFirst({ where: { id: req.params.queueId, organizationId: req.organizationId } });
  if (!queue) return notFound(res, "Queue");
  const member = await prisma.supportQueueMember.findUnique({ where: { queueId_membershipId: { queueId: queue.id, membershipId: req.params.membershipId } } });
  if (!member || !member.active) return notFound(res, "Queue member");
  const updated = await prisma.supportQueueMember.update({ where: { id: member.id }, data: { active: false } });
  await audit(req, "support.queue.member_removed", "SupportQueue", queue.id, { before: { membershipId: member.membershipId } });
  res.json({ member: toApi(updated) });
}

// ---------------------------------------------------------------- Categories

export async function listCategories(req, res) {
  const where = { organizationId: req.organizationId, ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }) };
  const categories = await prisma.ticketCategory.findMany({ where, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
  res.json({ categories: toApi(categories) });
}

async function categoryFields(req, existing) {
  const body = req.body;
  const out = {};
  if (!existing || "name" in body) {
    const name = text(body.name, 120);
    if (!name) return { error: "name is required." };
    out.name = name;
    out.normalizedName = normalizeName(name);
  }
  if ("description" in body) out.description = text(body.description, 1000);
  if ("displayOrder" in body) {
    const n = Number(body.displayOrder);
    if (!Number.isInteger(n) || n < 0 || n > 10000) return { error: "displayOrder must be a whole number from 0 to 10000." };
    out.displayOrder = n;
  }
  if ("active" in body) out.active = Boolean(body.active);
  if ("defaultPriority" in body) {
    if (body.defaultPriority && !TICKET_PRIORITIES.includes(body.defaultPriority)) return { error: `defaultPriority must be one of ${TICKET_PRIORITIES.join(", ")}.` };
    out.defaultPriority = body.defaultPriority || null;
  }
  if ("defaultQueueId" in body) {
    if (!(await queueInOrg(req.organizationId, body.defaultQueueId))) return { error: "defaultQueueId must be an active queue in this organization." };
    out.defaultQueueId = body.defaultQueueId || null;
  }
  // Two levels only: a category, or a subcategory of a top-level category.
  if (!existing && body.parentId) {
    const parent = await prisma.ticketCategory.findFirst({ where: { id: body.parentId, organizationId: req.organizationId, archivedAt: null } });
    if (!parent) return { error: "parentId must be an active category in this organization." };
    if (parent.parentId) return { error: "Subcategories can't have their own subcategories." };
    out.parentId = parent.id;
  }
  const parentId = existing ? existing.parentId : out.parentId || null;
  if (out.normalizedName) {
    const clash = await prisma.ticketCategory.findFirst({ where: { organizationId: req.organizationId, parentId, normalizedName: out.normalizedName, ...(existing && { id: { not: existing.id } }) } });
    if (clash) return { error: `A category named "${out.name}" already exists here.` };
  }
  return { data: out };
}

export async function createCategory(req, res) {
  const { data, error } = await categoryFields(req, null);
  if (error) return invalid(res, error);
  const category = await prisma.ticketCategory.create({ data: { ...data, organizationId: req.organizationId } });
  await audit(req, "support.category.created", "TicketCategory", category.id);
  res.status(201).json({ category: toApi(category) });
}

export async function updateCategory(req, res) {
  const existing = await prisma.ticketCategory.findFirst({ where: { id: req.params.categoryId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Category");
  if (existing.archivedAt) return invalid(res, "An archived category can't be edited.");
  if (staleVersion(req.body, existing)) return versionConflict(res, "category");
  const { data, error } = await categoryFields(req, existing);
  if (error) return invalid(res, error);
  const category = await prisma.ticketCategory.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
  await audit(req, "support.category.updated", "TicketCategory", category.id);
  res.json({ category: toApi(category) });
}

// Archived categories stay on existing tickets but can't be chosen for new ones.
export async function archiveCategory(req, res) {
  const existing = await prisma.ticketCategory.findFirst({ where: { id: req.params.categoryId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Category");
  if (existing.archivedAt) return invalid(res, "This category is already archived.");
  const category = await prisma.ticketCategory.update({ where: { id: existing.id }, data: { archivedAt: new Date(), active: false, version: { increment: 1 } } });
  await audit(req, "support.category.archived", "TicketCategory", category.id);
  res.json({ category: toApi(category) });
}

// ---------------------------------------------------------------- Canned Responses

// Personal responses are only visible to their author.
function cannedScope(req) {
  return { OR: [{ visibility: "Team" }, { visibility: "Personal", createdByMembershipId: req.membership?.id || "__none__" }] };
}

export async function listCannedResponses(req, res) {
  const where = { organizationId: req.organizationId, archivedAt: null, ...cannedScope(req) };
  if (req.query.queueId) where.AND = [{ OR: [{ queueId: null }, { queueId: req.query.queueId }] }];
  if (req.query.categoryId) where.AND = [...(where.AND || []), { OR: [{ categoryId: null }, { categoryId: req.query.categoryId }] }];
  const responses = await prisma.cannedResponse.findMany({ where, orderBy: { name: "asc" } });
  res.json({ cannedResponses: toApi(responses) });
}

async function cannedFields(req, partial) {
  const body = req.body;
  const out = {};
  if (!partial || "name" in body) {
    const name = text(body.name, 120);
    if (!name) return { error: "name is required." };
    out.name = name;
  }
  if (!partial || "body" in body) {
    const b = text(body.body, 10000);
    if (!b) return { error: "body is required." };
    out.body = b;
  }
  if (!partial || "visibility" in body) {
    const visibility = body.visibility || "Team";
    if (!["Team", "Personal"].includes(visibility)) return { error: 'visibility must be "Team" or "Personal".' };
    out.visibility = visibility;
  }
  if ("queueId" in body) {
    if (!(await queueInOrg(req.organizationId, body.queueId))) return { error: "queueId must be an active queue in this organization." };
    out.queueId = body.queueId || null;
  }
  if ("categoryId" in body) {
    if (body.categoryId && !(await prisma.ticketCategory.findFirst({ where: { id: body.categoryId, organizationId: req.organizationId, archivedAt: null } }))) {
      return { error: "categoryId must be an active category in this organization." };
    }
    out.categoryId = body.categoryId || null;
  }
  return { data: out };
}

// Canned responses are text to fill a reply draft — creating or using one
// never sends anything.
export async function createCannedResponse(req, res) {
  const { data, error } = await cannedFields(req, false);
  if (error) return invalid(res, error);
  const response = await prisma.cannedResponse.create({ data: { ...data, organizationId: req.organizationId, createdByMembershipId: who(req), updatedByMembershipId: who(req) } });
  await audit(req, "support.canned_response.created", "CannedResponse", response.id);
  res.status(201).json({ cannedResponse: toApi(response) });
}

export async function updateCannedResponse(req, res) {
  const existing = await prisma.cannedResponse.findFirst({ where: { id: req.params.responseId, organizationId: req.organizationId, archivedAt: null, ...cannedScope(req) } });
  if (!existing) return notFound(res, "Canned response");
  if (staleVersion(req.body, existing)) return versionConflict(res, "canned response");
  const { data, error } = await cannedFields(req, true);
  if (error) return invalid(res, error);
  const response = await prisma.cannedResponse.update({ where: { id: existing.id }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } } });
  await audit(req, "support.canned_response.updated", "CannedResponse", response.id);
  res.json({ cannedResponse: toApi(response) });
}

export async function archiveCannedResponse(req, res) {
  const existing = await prisma.cannedResponse.findFirst({ where: { id: req.params.responseId, organizationId: req.organizationId, archivedAt: null, ...cannedScope(req) } });
  if (!existing) return notFound(res, "Canned response");
  const response = await prisma.cannedResponse.update({ where: { id: existing.id }, data: { archivedAt: new Date(), updatedByMembershipId: who(req), version: { increment: 1 } } });
  await audit(req, "support.canned_response.archived", "CannedResponse", response.id);
  res.json({ cannedResponse: toApi(response) });
}
