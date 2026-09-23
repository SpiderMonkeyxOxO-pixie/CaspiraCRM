// Idempotent Support fixture import — LOCAL DEVELOPMENT ONLY, never
// production. Same approach as seedCrmFixtures.js / seedSalesFixtures.js:
// a small, hand-curated dataset mirroring the SHAPE of the frontend's
// mockSupportData.js (its subjects, categories, sources, departments,
// priorities and statuses) — not a port of its faker-random generator,
// which produces different data on every load and so has no stable IDs to
// preserve.
//
// Stable keys: inboxes, queues, categories, calendars, policies and KB
// articles are matched by their unique name/slug; tickets by a
// "[Fixture]" subject. Re-running creates nothing twice. Companies and
// contacts come from the organization's existing Phase 2 records; owners
// and agents from its active memberships.
//
// Usage: SUPPORT_FIXTURE_ORG_ID=<org id> node prisma/seedSupportFixtures.js
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { nextDocumentNumber } from "../src/services/sales/documentNumberService.js";
import { normalizeSubject } from "../src/services/support/ticketLifecycleService.js";
import * as sla from "../src/services/support/slaService.js";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to import Support fixtures in production.");
  process.exit(1);
}
const organizationId = process.env.SUPPORT_FIXTURE_ORG_ID;
if (!organizationId) {
  console.error("Set SUPPORT_FIXTURE_ORG_ID to the organization to import into.");
  process.exit(1);
}

const report = { created: {}, skipped: {}, warnings: [] };
const tally = (kind, created) => { const bucket = created ? report.created : report.skipped; bucket[kind] = (bucket[kind] || 0) + 1; };

async function upsertByName(model, where, data, kind) {
  const existing = await prisma[model].findFirst({ where });
  if (existing) { tally(kind, false); return existing; }
  tally(kind, true);
  return prisma[model].create({ data });
}

const WEEK = (iv) => ({ mon: iv, tue: iv, wed: iv, thu: iv, fri: iv, sat: [], sun: [] });
const TARGETS = {
  Urgent: { firstResponseMinutes: 60, nextResponseMinutes: 60, resolutionMinutes: 240 },
  High: { firstResponseMinutes: 240, nextResponseMinutes: 240, resolutionMinutes: 1440 },
  Medium: { firstResponseMinutes: 480, nextResponseMinutes: 480, resolutionMinutes: 2880 },
  Low: { firstResponseMinutes: 1440, nextResponseMinutes: 1440, resolutionMinutes: 4320 },
};

const TICKETS = [
  { subject: "Unable to access account", category: "Account", priority: "High", source: "Email", status: "Open", reply: "We've reset your session — please try again." },
  { subject: "Invoice discrepancy", category: "Billing", priority: "Medium", source: "Portal", status: "Waiting for Customer", reply: "Could you send the invoice number?" },
  { subject: "Login page throwing an error", category: "Technical", priority: "Urgent", source: "Chat", status: "In Progress", note: "Reproduced on staging." },
  { subject: "Question about billing cycle", category: "Billing", priority: "Low", source: "Phone", status: "New" },
];

async function main() {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new Error(`Organization ${organizationId} not found.`);
  const memberships = await prisma.organizationMembership.findMany({ where: { organizationId, status: "Active" }, orderBy: { createdAt: "asc" }, take: 3 });
  if (!memberships.length) throw new Error("The organization has no active members to assign fixtures to.");
  const contacts = await prisma.contact.findMany({ where: { organizationId, companyId: { not: null } }, orderBy: { createdAt: "asc" }, take: 4 });
  if (!contacts.length) report.warnings.push("No contacts with a company — tickets are imported without a requester (run seedCrmFixtures.js first for a fuller set).");

  const calendar = await upsertByName("businessHoursCalendar", { organizationId, name: "Fixture — Office hours (Manila)" },
    { organizationId, name: "Fixture — Office hours (Manila)", timeZone: "Asia/Manila", workingHours: WEEK([["09:00", "12:00"], ["13:00", "18:00"]]), holidays: [{ date: "2026-12-25", name: "Christmas Day" }] }, "calendars");

  let policy = await prisma.slaPolicy.findFirst({ where: { organizationId, name: "Fixture — Standard support" } });
  if (!policy) {
    policy = await prisma.slaPolicy.create({ data: { organizationId, name: "Fixture — Standard support", description: "Business-hours targets by priority." } });
    const version = await prisma.slaPolicyVersion.create({
      data: { organizationId, policyId: policy.id, versionNumber: 1, businessHours: true, calendarId: calendar.id, timeZone: calendar.timeZone, targets: TARGETS, calendarSnapshot: { timeZone: calendar.timeZone, workingHours: calendar.workingHours, holidays: calendar.holidays, calendarId: calendar.id, calendarVersion: calendar.version } },
    });
    policy = await prisma.slaPolicy.update({ where: { id: policy.id }, data: { currentVersionId: version.id } });
    tally("slaPolicies", true);
  } else tally("slaPolicies", false);

  const queue = await upsertByName("supportQueue", { organizationId, name: "Fixture — Tier 1" }, { organizationId, name: "Fixture — Tier 1", department: "Support", assignmentMode: "Round Robin", defaultSlaPolicyId: policy.id }, "queues");
  for (const m of memberships) {
    const existing = await prisma.supportQueueMember.findUnique({ where: { queueId_membershipId: { queueId: queue.id, membershipId: m.id } } });
    if (existing) tally("queueMembers", false);
    else { await prisma.supportQueueMember.create({ data: { organizationId, queueId: queue.id, membershipId: m.id } }); tally("queueMembers", true); }
  }
  const inbox = await upsertByName("supportInbox", { organizationId, name: "Fixture — Customer Portal" }, { organizationId, name: "Fixture — Customer Portal", channelType: "Customer Portal", defaultQueueId: queue.id }, "inboxes");
  await upsertByName("supportInbox", { organizationId, name: "Fixture — Email (not connected)" }, { organizationId, name: "Fixture — Email (not connected)", channelType: "Email Placeholder", defaultQueueId: queue.id }, "inboxes");

  const categories = {};
  for (const name of ["Billing", "Technical", "Account", "General"]) {
    categories[name] = await upsertByName("ticketCategory", { organizationId, parentId: null, normalizedName: `fixture ${name.toLowerCase()}` },
      { organizationId, name: `Fixture ${name}`, normalizedName: `fixture ${name.toLowerCase()}`, defaultQueueId: queue.id }, "categories");
  }

  await upsertByName("cannedResponse", { organizationId, name: "Fixture — Ask for details" },
    { organizationId, name: "Fixture — Ask for details", body: "Thanks for reaching out. Could you share a screenshot and the time the problem happened?", visibility: "Team", queueId: queue.id }, "cannedResponses");

  for (const [i, t] of TICKETS.entries()) {
    const subject = `[Fixture] ${t.subject}`;
    const existing = await prisma.ticket.findFirst({ where: { organizationId, subject } });
    if (existing) { tally("tickets", false); continue; }
    const contact = contacts[i % Math.max(contacts.length, 1)];
    const agent = memberships[i % memberships.length];
    await prisma.$transaction(async (tx) => {
      const ticketNumber = await nextDocumentNumber(tx, organizationId, "Ticket");
      const ticket = await tx.ticket.create({
        data: {
          organizationId, ticketNumber, subject, normalizedSubject: normalizeSubject(subject), description: "Imported development fixture.",
          source: t.source, priority: t.priority, category: `Fixture ${t.category}`, categoryId: categories[t.category].id, department: "Support",
          status: "New", queueId: queue.id, inboxId: inbox.id, assignedMembershipId: t.status === "New" ? null : agent.id,
          contactId: contact?.id || null, companyId: contact?.companyId || null, createdByMembershipId: memberships[0].id,
        },
      });
      await tx.ticketEvent.create({ data: { organizationId, ticketId: ticket.id, eventType: "Created", actorType: "System", toValue: "New", reason: "Fixture import", customerVisible: true } });
      await sla.startClocks(tx, ticket);
      if (t.reply) {
        await tx.ticketMessage.create({ data: { organizationId, ticketId: ticket.id, kind: "Reply", messageType: "Agent Reply", visibility: "Customer Visible", body: t.reply, sanitizedBody: t.reply, authorMembershipId: agent.id, deliveryStatus: "Pending Provider" } });
        await tx.ticket.update({ where: { id: ticket.id }, data: { firstRespondedAt: new Date() } });
        await sla.onPublicAgentReply(tx, ticket);
      }
      if (t.note) {
        await tx.ticketMessage.create({ data: { organizationId, ticketId: ticket.id, kind: "Note", messageType: "Internal Note", visibility: "Internal Only", body: t.note, sanitizedBody: t.note, authorMembershipId: agent.id } });
      }
      if (t.status !== "New") {
        await tx.ticket.update({ where: { id: ticket.id }, data: { status: t.status } });
        await tx.ticketEvent.create({ data: { organizationId, ticketId: ticket.id, eventType: "Status Changed", actorType: "System", fromValue: "New", toValue: t.status, reason: "Fixture import", customerVisible: true } });
        await sla.onStatusChange(tx, { ...ticket, status: t.status }, "New");
      }
    });
    tally("tickets", true);
  }

  const kbCategory = await upsertByName("kbCategory", { organizationId, slug: "fixture-getting-started" }, { organizationId, name: "Fixture — Getting started", slug: "fixture-getting-started", visibility: "Customers" }, "kbCategories");
  if (!(await prisma.kbArticle.findFirst({ where: { organizationId, slug: "fixture-reset-your-password" } }))) {
    await prisma.$transaction(async (tx) => {
      const articleNumber = await nextDocumentNumber(tx, organizationId, "KbArticle");
      const article = await tx.kbArticle.create({ data: { organizationId, articleNumber, categoryId: kbCategory.id, title: "How to reset your password", slug: "fixture-reset-your-password", summary: "Step-by-step password reset.", status: "Published", visibility: "Customers", publishedAt: new Date(), authorMembershipId: memberships[0].id } });
      const version = await tx.kbArticleVersion.create({ data: { organizationId, articleId: article.id, versionNumber: 1, title: article.title, summary: article.summary, body: "Open the login page, choose Forgot password, and follow the link we email you.", reviewStatus: "Published", publishedAt: new Date(), authorMembershipId: memberships[0].id } });
      await tx.kbArticle.update({ where: { id: article.id }, data: { currentVersionId: version.id } });
    });
    tally("kbArticles", true);
  } else tally("kbArticles", false);

  console.log("Support fixture import report:");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => { console.error("Support fixture import failed:", err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
