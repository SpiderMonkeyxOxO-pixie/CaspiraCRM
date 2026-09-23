// Backend Phase 4 — the Customer Portal's own Support API (/api/v1/portal).
//
// Uses DEDICATED serializers: a portal response never contains internal
// notes, restricted messages, staff names or ids, queue, priority, SLA
// configuration, audit data, linked leads/deals/orders/contracts, or other
// customers' tickets. A customer sees tickets they raised or that are for
// their own contact — and, only when an administrator granted
// company-wide access, their company's tickets.
import prisma from "../../lib/prisma.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { customerVisibleStatus, normalizeSubject } from "../../services/support/ticketLifecycleService.js";
import * as sla from "../../services/support/slaService.js";
import { sanitizeText, invalid, notFound, badTransition, ticketEvent } from "../../services/support/supportCommon.js";

const CSAT_MIN = 1;
const CSAT_MAX = 5;

export function portalTicketWhere(account) {
  const or = [{ portalAccountId: account.id }, { contactId: account.contactId }];
  if (account.companyWideAccess && account.companyId) or.push({ companyId: account.companyId });
  return { organizationId: account.organizationId, archivedAt: null, mergedIntoTicketId: null, OR: or };
}

// Only the requester themself can rate a ticket — never a company-wide viewer.
const isRequester = (account, ticket) => ticket.portalAccountId === account.id || ticket.contactId === account.contactId;

export function serializePortalTicket(ticket, account, { messages = null, satisfaction = null } = {}) {
  const status = customerVisibleStatus(ticket.status);
  const out = {
    _id: ticket.id, ticketNumber: ticket.ticketNumber, subject: ticket.subject, description: ticket.description,
    status, createdAt: ticket.createdAt, updatedAt: ticket.updatedAt, resolvedAt: ticket.resolvedAt, closedAt: ticket.closedAt,
    resolutionSummary: ["Resolved", "Closed"].includes(ticket.status) ? ticket.resolutionSummary : null,
    canReply: !["Closed", "Cancelled"].includes(ticket.status),
    canRate: ["Resolved", "Closed"].includes(ticket.status) && isRequester(account, ticket) && !satisfaction,
  };
  if (messages) {
    out.messages = messages.map((m) => ({
      _id: m.id, body: m.body, createdAt: m.createdAt,
      from: m.authorType === "Customer" ? (m.authorPortalAccountId === account.id ? "You" : "Customer") : "Support team",
    }));
  }
  if (satisfaction) out.satisfaction = { rating: satisfaction.rating, comment: satisfaction.comment, submittedAt: satisfaction.submittedAt };
  return out;
}

// The query itself can only ever return customer-visible, live messages.
const CUSTOMER_MESSAGES = { where: { visibility: "Customer Visible", archivedAt: null }, orderBy: { createdAt: "asc" } };

async function loadPortalTicket(req, res) {
  const ticket = await prisma.ticket.findFirst({ where: { id: req.params.ticketId, ...portalTicketWhere(req.portal) }, include: { messages: CUSTOMER_MESSAGES } });
  if (!ticket) notFound(res, "Ticket");
  return ticket;
}

async function mySatisfaction(ticketId, accountId) {
  return prisma.ticketSatisfaction.findFirst({ where: { ticketId, portalAccountId: accountId, status: "Valid" } });
}

export async function listTickets(req, res) {
  const where = portalTicketWhere(req.portal);
  if (req.query.search) where.AND = [{ OR: [{ ticketNumber: { contains: req.query.search, mode: "insensitive" } }, { subject: { contains: req.query.search, mode: "insensitive" } }] }];
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.ticket.count({ where }),
  ]);
  res.json({ tickets: tickets.map((t) => serializePortalTicket(t, req.portal)), total, page, pageSize });
}

export async function getTicket(req, res) {
  const ticket = await loadPortalTicket(req, res);
  if (!ticket) return;
  res.json({ ticket: serializePortalTicket(ticket, req.portal, { messages: ticket.messages, satisfaction: await mySatisfaction(ticket.id, req.portal.id) }) });
}

// A customer raises a ticket for THEIR OWN account — contact and company
// come from the portal account, never from the request.
export async function createTicket(req, res) {
  const subject = sanitizeText(req.body.subject || "", { max: 300 });
  if (!subject) return invalid(res, "subject is required.");
  const description = sanitizeText(req.body.description || "", { max: 20000 }) || null;
  const account = req.portal;
  let category = null;
  if (req.body.categoryId) {
    category = await prisma.ticketCategory.findFirst({ where: { id: req.body.categoryId, organizationId: account.organizationId, active: true, archivedAt: null, parentId: null } });
    if (!category) return invalid(res, "categoryId must be an active support category.");
  }
  const inbox = await prisma.supportInbox.findFirst({ where: { organizationId: account.organizationId, channelType: "Customer Portal", active: true, archivedAt: null }, orderBy: { createdAt: "asc" } });
  const now = new Date();
  const ticket = await prisma.$transaction(async (tx) => {
    const ticketNumber = await nextDocumentNumber(tx, account.organizationId, "Ticket");
    const created = await tx.ticket.create({
      data: {
        organizationId: account.organizationId, ticketNumber, subject, normalizedSubject: normalizeSubject(subject), description, source: "Portal", status: "New",
        priority: category?.defaultPriority || "Medium", category: category?.name || "General", categoryId: category?.id || null,
        inboxId: inbox?.id || null, queueId: category?.defaultQueueId || inbox?.defaultQueueId || null,
        contactId: account.contactId, companyId: account.companyId, portalAccountId: account.id, department: "Support", createdAt: now,
      },
    });
    await ticketEvent(tx, { organizationId: account.organizationId, ticketId: created.id, eventType: "Created", actorType: "Customer", actorPortalAccountId: account.id, toValue: "New", customerVisible: true, snapshot: { ticketNumber, source: "Portal" } });
    await sla.startClocks(tx, created);
    return created;
  });
  res.status(201).json({ ticket: serializePortalTicket(ticket, account, { messages: [] }) });
}

// Customer reply. It moves a ticket that was waiting for the customer back
// to Open, and reopens a Resolved one (the portal policy). A Closed or
// Cancelled ticket needs a new ticket instead.
export async function reply(req, res) {
  const body = sanitizeText(req.body.message || "", { max: 20000 });
  if (!body) return invalid(res, "A reply can't be empty.");
  const ticket = await loadPortalTicket(req, res);
  if (!ticket) return;
  if (["Closed", "Cancelled"].includes(ticket.status)) return badTransition(res, "This ticket is closed — please open a new ticket.");
  const account = req.portal;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id, organizationId: account.organizationId, kind: "Reply", messageType: "Customer Message", visibility: "Customer Visible",
        authorType: "Customer", authorContactId: account.contactId, authorPortalAccountId: account.id, body, sanitizedBody: body, source: "Customer Portal", deliveryStatus: "Not Applicable",
      },
    });
    await ticketEvent(tx, { organizationId: account.organizationId, ticketId: ticket.id, eventType: "Customer Reply", actorType: "Customer", actorPortalAccountId: account.id, customerVisible: true });
    let to = null;
    if (ticket.status === "Waiting for Customer") to = "Open";
    if (ticket.status === "Resolved") to = "Open";
    if (to) {
      await tx.ticket.update({ where: { id: ticket.id }, data: { status: to, waitingReason: null, ...(ticket.status === "Resolved" && { reopenedAt: now, resolvedAt: null }), version: { increment: 1 } } });
      await ticketEvent(tx, {
        organizationId: account.organizationId, ticketId: ticket.id, eventType: ticket.status === "Resolved" ? "Reopened" : "Status Changed", actorType: "Customer",
        actorPortalAccountId: account.id, fromValue: ticket.status, toValue: to, reason: "Customer replied", customerVisible: true,
      });
      if (ticket.status === "Resolved") await sla.onReopened(tx, ticket, now);
      else await sla.onStatusChange(tx, { ...ticket, status: to }, ticket.status, now);
    } else {
      await tx.ticket.update({ where: { id: ticket.id }, data: { version: { increment: 1 } } });
    }
    await sla.onCustomerMessage(tx, ticket, now);
  });
  const fresh = await prisma.ticket.findUnique({ where: { id: ticket.id }, include: { messages: CUSTOMER_MESSAGES } });
  res.json({ ticket: serializePortalTicket(fresh, account, { messages: fresh.messages, satisfaction: await mySatisfaction(ticket.id, account.id) }) });
}

// One rating per resolved/closed ticket, by its requester only.
export async function submitSatisfaction(req, res) {
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < CSAT_MIN || rating > CSAT_MAX) return invalid(res, `rating must be a whole number from ${CSAT_MIN} to ${CSAT_MAX}.`);
  const ticket = await loadPortalTicket(req, res);
  if (!ticket) return;
  const account = req.portal;
  if (!isRequester(account, ticket)) return res.status(403).json({ code: "PORTAL_NOT_REQUESTER", message: "Only the person who raised this ticket can rate it." });
  if (!["Resolved", "Closed"].includes(ticket.status)) return badTransition(res, "You can rate a ticket once it's resolved.");
  const comment = sanitizeText(req.body.comment || "", { max: 2000 }) || null;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.ticketSatisfaction.create({ data: { organizationId: account.organizationId, ticketId: ticket.id, portalAccountId: account.id, contactId: account.contactId, rating, comment } });
      await ticketEvent(tx, { organizationId: account.organizationId, ticketId: ticket.id, eventType: "CSAT Submitted", actorType: "Customer", actorPortalAccountId: account.id, toValue: String(rating) });
    });
  } catch (err) {
    if (err?.code === "P2002") return res.status(409).json({ code: "CSAT_ALREADY_SUBMITTED", message: "You've already rated this ticket." });
    throw err;
  }
  res.status(201).json({ satisfaction: { rating, comment } });
}

// ---------------------------------------------------------------- Knowledge Base (portal)

// Only published articles whose article AND category are customer-visible.
function portalArticleWhere(organizationId) {
  return {
    organizationId, status: "Published", visibility: "Customers", archivedAt: null, currentVersionId: { not: null },
    OR: [{ categoryId: null }, { category: { visibility: "Customers", active: true, archivedAt: null } }],
  };
}

export async function listKbCategories(req, res) {
  const categories = await prisma.kbCategory.findMany({ where: { organizationId: req.organizationId, visibility: "Customers", active: true, archivedAt: null }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
  res.json({ categories: categories.map((c) => ({ _id: c.id, name: c.name, slug: c.slug, description: c.description, parentId: c.parentId })) });
}

export async function listKbArticles(req, res) {
  const where = portalArticleWhere(req.organizationId);
  if (req.query.categoryId) where.categoryId = req.query.categoryId;
  if (req.query.search) where.AND = [{ OR: [{ title: { contains: req.query.search, mode: "insensitive" } }, { summary: { contains: req.query.search, mode: "insensitive" } }] }];
  const articles = await prisma.kbArticle.findMany({ where, orderBy: { publishedAt: "desc" }, take: 100 });
  res.json({ articles: articles.map((a) => ({ _id: a.id, title: a.title, slug: a.slug, summary: a.summary, categoryId: a.categoryId, publishedAt: a.publishedAt })) });
}

export async function getKbArticle(req, res) {
  const article = await prisma.kbArticle.findFirst({ where: { ...portalArticleWhere(req.organizationId), slug: req.params.slug } });
  if (!article) return notFound(res, "Article");
  const version = await prisma.kbArticleVersion.findUnique({ where: { id: article.currentVersionId } });
  await prisma.kbArticle.update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } });
  res.json({ article: { _id: article.id, title: version.title, slug: article.slug, summary: version.summary, body: version.body, publishedAt: version.publishedAt, categoryId: article.categoryId } });
}
