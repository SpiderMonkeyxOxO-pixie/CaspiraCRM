import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  portalAccount: { findMany: vi.fn(), update: vi.fn() },
  ticket: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  ticketMessage: { create: vi.fn() },
  ticketEvent: { create: vi.fn() },
  ticketSatisfaction: { findFirst: vi.fn(), create: vi.fn() },
  ticketCategory: { findFirst: vi.fn() },
  supportInbox: { findFirst: vi.fn() },
  kbArticle: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  kbArticleVersion: { update: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
  kbCategory: { findFirst: vi.fn(), findMany: vi.fn() },
  salesDocumentCounter: { upsert: vi.fn(), update: vi.fn(async () => ({ value: 1 })) },
};
db.$transaction = vi.fn(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
vi.mock("../../lib/prisma.js", () => ({ default: db }));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));
vi.mock("../../services/support/slaService.js", () => ({ startClocks: vi.fn(), onReopened: vi.fn(), onStatusChange: vi.fn(), onCustomerMessage: vi.fn() }));

const { requirePortalAccount } = await import("../../middleware/portal.js");
const portal = await import("./portalSupportController.js");
const kb = await import("./knowledgeBaseController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const account = (over = {}) => ({ id: "pa1", organizationId: "org1", contactId: "c1", companyId: "co1", companyWideAccess: false, status: "Active", lastAccessAt: new Date(), ...over });
const preq = (body = {}, params = {}, acc = account()) => ({ body, params, query: {}, portal: acc, organizationId: acc.organizationId, user: { id: "u9" } });

beforeEach(() => {
  for (const model of Object.values(db)) if (typeof model === "object") for (const fn of Object.values(model)) fn.mockReset?.();
  db.salesDocumentCounter.update.mockResolvedValue({ value: 1 });
  db.$transaction.mockImplementation(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
});

describe("portal access", () => {
  it("refuses logins without a portal account, and suspended accounts immediately", async () => {
    db.portalAccount.findMany.mockResolvedValue([]);
    const none = mockRes();
    await requirePortalAccount({ user: { id: "staff" }, query: {}, body: {} }, none, vi.fn());
    expect(none.status).toHaveBeenCalledWith(403);

    db.portalAccount.findMany.mockResolvedValue([account({ status: "Suspended" })]);
    const suspended = mockRes();
    const next = vi.fn();
    await requirePortalAccount({ user: { id: "u9" }, query: {}, body: {} }, suspended, next);
    expect(suspended.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("scopes tickets to the requester, or their company only when granted", () => {
    expect(portal.portalTicketWhere(account()).OR).toEqual([{ portalAccountId: "pa1" }, { contactId: "c1" }]);
    expect(portal.portalTicketWhere(account({ companyWideAccess: true })).OR).toContainEqual({ companyId: "co1" });
  });

  it("portal serializer never includes internal fields", () => {
    const out = portal.serializePortalTicket(
      { id: "t1", ticketNumber: "T-1", subject: "S", status: "Waiting for Internal Team", assignedMembershipId: "m1", queueId: "q1", priority: "Urgent", relatedDealId: "d1", slaResolutionDeadline: new Date(), portalAccountId: "pa1" },
      account(),
      { messages: [{ id: "m", body: "hi", authorType: "Agent", authorMembershipId: "m1", createdAt: new Date() }] },
    );
    expect(out.status).toBe("In progress");
    for (const f of ["assignedMembershipId", "queueId", "priority", "relatedDealId", "slaResolutionDeadline"]) expect(out).not.toHaveProperty(f);
    expect(out.messages[0]).toEqual({ _id: "m", body: "hi", createdAt: expect.any(Date), from: "Support team" });
  });

  it("the portal loads only customer-visible messages", async () => {
    db.ticket.findFirst.mockResolvedValue(null);
    await portal.getTicket(preq({}, { ticketId: "t1" }), mockRes());
    expect(db.ticket.findFirst.mock.calls[0][0].include.messages.where).toEqual({ visibility: "Customer Visible", archivedAt: null });
  });

  it("a new portal ticket uses the account's own contact and company, not the request's", async () => {
    db.ticket.create.mockImplementation(({ data }) => ({ id: "t9", ...data }));
    await portal.createTicket(preq({ subject: "Help", contactId: "someone-else", companyId: "other-co" }), mockRes());
    expect(db.ticket.create.mock.calls[0][0].data).toMatchObject({ contactId: "c1", companyId: "co1", portalAccountId: "pa1", source: "Portal" });
  });

  it("satisfaction: requester only, once resolved, rating 1–5, once", async () => {
    const bad = mockRes();
    await portal.submitSatisfaction(preq({ rating: 9 }, { ticketId: "t1" }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);

    db.ticket.findFirst.mockResolvedValue({ id: "t1", status: "Resolved", portalAccountId: "pa2", contactId: "c2", messages: [] });
    const notMine = mockRes();
    await portal.submitSatisfaction(preq({ rating: 5 }, { ticketId: "t1" }, account({ companyWideAccess: true })), notMine);
    expect(notMine.status).toHaveBeenCalledWith(403);

    db.ticket.findFirst.mockResolvedValue({ id: "t1", status: "Resolved", portalAccountId: "pa1", contactId: "c1", messages: [] });
    db.ticketSatisfaction.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const dup = mockRes();
    await portal.submitSatisfaction(preq({ rating: 5 }, { ticketId: "t1" }), dup);
    expect(dup.status).toHaveBeenCalledWith(409);
  });

  it("a closed ticket can't take customer replies; a resolved one reopens", async () => {
    db.ticket.findFirst.mockResolvedValue({ id: "t1", status: "Closed", messages: [] });
    const closed = mockRes();
    await portal.reply(preq({ message: "still broken" }, { ticketId: "t1" }), closed);
    expect(closed.status).toHaveBeenCalledWith(400);

    db.ticket.findFirst.mockResolvedValue({ id: "t1", status: "Resolved", messages: [] });
    db.ticket.findUnique.mockResolvedValue({ id: "t1", status: "Open", messages: [] });
    await portal.reply(preq({ message: "still broken" }, { ticketId: "t1" }), mockRes());
    expect(db.ticket.update.mock.calls[0][0].data).toMatchObject({ status: "Open" });
    expect(db.ticketMessage.create.mock.calls[0][0].data).toMatchObject({ messageType: "Customer Message", authorType: "Customer", authorContactId: "c1", visibility: "Customer Visible" });
  });

  it("portal KB only lists published, customer-visible articles in customer-visible categories", async () => {
    db.kbArticle.findMany.mockResolvedValue([]);
    await portal.listKbArticles({ query: {}, organizationId: "org1" }, mockRes());
    expect(db.kbArticle.findMany.mock.calls[0][0].where).toMatchObject({ status: "Published", visibility: "Customers", archivedAt: null });
  });
});

describe("knowledge base", () => {
  const sreq = (body = {}, params = {}, membershipId = "m1", actions = ["view", "create", "review", "publish", "archive"]) => ({
    body, params, query: {}, organizationId: "org1", user: { id: "u1" }, isSystemOwnerOverride: false,
    membership: { id: membershipId, roles: [{ role: { defaultScope: "Organization", permissionGrants: [{ moduleId: "knowledge_base", actions }] } }] },
  });
  const article = (latest) => ({ id: "a1", organizationId: "org1", status: "In Review", currentVersionId: null, version: 1, archivedAt: null, versions: [latest] });

  it("authors can't approve or publish their own article", async () => {
    db.kbArticle.findFirst.mockResolvedValue(article({ id: "v1", versionNumber: 1, reviewStatus: "In Review", authorMembershipId: "m1" }));
    const res = mockRes();
    await kb.approve(sreq(), res);
    expect(res.status).toHaveBeenCalledWith(403);

    db.kbArticle.findFirst.mockResolvedValue(article({ id: "v1", versionNumber: 1, reviewStatus: "Approved", authorMembershipId: "m1" }));
    const pub = mockRes();
    await kb.publish(sreq(), pub);
    expect(pub.status).toHaveBeenCalledWith(403);
  });

  it("editing a published article creates a new draft version instead of changing it", async () => {
    db.kbArticle.findFirst.mockResolvedValue({ ...article({ id: "v1", versionNumber: 1, reviewStatus: "Published", title: "T", summary: null, body: "old" }), status: "Published", slug: "t" });
    db.kbArticle.findUnique.mockResolvedValue({ id: "a1", versions: [] });
    await kb.updateArticle(sreq({ body: "new text" }, { articleId: "a1" }), mockRes());
    expect(db.kbArticleVersion.update).not.toHaveBeenCalled();
    expect(db.kbArticleVersion.create.mock.calls[0][0].data).toMatchObject({ versionNumber: 2, body: "new text" });
  });

  it("rejecting needs a reason", async () => {
    const res = mockRes();
    await kb.reject(sreq({}, { articleId: "a1" }, "m2"), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
