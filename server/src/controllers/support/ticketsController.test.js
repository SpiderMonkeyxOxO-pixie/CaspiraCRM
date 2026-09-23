import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  ticket: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  ticketMessage: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  ticketEvent: { create: vi.fn(), findMany: vi.fn() },
  ticketFollower: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  ticketEscalation: { create: vi.fn() },
  ticketCategory: { findFirst: vi.fn(), findUnique: vi.fn() },
  supportInbox: { findFirst: vi.fn(), findUnique: vi.fn() },
  supportQueue: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  supportQueueMember: { findMany: vi.fn(), findFirst: vi.fn() },
  organizationMembership: { findFirst: vi.fn() },
  company: { findFirst: vi.fn() },
  contact: { findFirst: vi.fn() },
  salesDocumentCounter: { upsert: vi.fn(), update: vi.fn(async () => ({ value: 7 })) },
};
db.$transaction = vi.fn(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
vi.mock("../../lib/prisma.js", () => ({ default: db }));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));

const tickets = await import("./ticketsController.js");
const lifecycle = await import("../../services/support/ticketLifecycleService.js");
const service = await import("../../services/support/ticketService.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const AGENT = ["view", "create", "edit", "transition", "resolve", "close", "reply", "escalate", "view_internal_notes", "add_internal_notes"];
const req = (body = {}, params = {}, { scope = "Organization", actions = AGENT, query = {}, department = null } = {}) => ({
  body, params, query, organizationId: "org1", user: { id: "u1", department }, isSystemOwnerOverride: false,
  membership: { id: "m1", roles: [{ role: { defaultScope: scope, permissionGrants: [{ moduleId: "tickets", actions }] } }] },
});

const ticket = (over = {}) => ({
  id: "t1", organizationId: "org1", ticketNumber: "TICKET-2026-000001", subject: "Login fails", status: "Open", priority: "Medium",
  version: 1, messages: [], followers: [], createdAt: new Date("2026-09-01T00:00:00Z"), archivedAt: null, ...over,
});

beforeEach(() => {
  for (const model of Object.values(db)) if (typeof model === "object") for (const fn of Object.values(model)) fn.mockReset?.();
  db.salesDocumentCounter.update.mockResolvedValue({ value: 7 });
  db.ticket.findUnique.mockResolvedValue(ticket());
  db.$transaction.mockImplementation(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
});

describe("status workflow", () => {
  it("enforces the transition table; resolve/close have their own endpoints", () => {
    expect(lifecycle.canTransition("New", "Open")).toBe(true);
    expect(lifecycle.canTransition("Open", "Waiting for Internal Team")).toBe(true);
    expect(lifecycle.canTransition("Waiting for Customer", "Open")).toBe(true);
    expect(lifecycle.canTransition("Open", "Resolved")).toBe(false);
    expect(lifecycle.canTransition("Cancelled", "Open")).toBe(false);
    expect(lifecycle.canTransition("Resolved", "Closed")).toBe(false);
  });

  it("cancelling needs a reason; the move and an event are recorded", async () => {
    db.ticket.findFirst.mockResolvedValue(ticket());
    const res = mockRes();
    await tickets.transition(req({ status: "Cancelled" }, { ticketId: "t1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);

    await tickets.transition(req({ status: "Cancelled", reason: "Duplicate request" }, { ticketId: "t1" }), mockRes());
    expect(db.ticket.update.mock.calls[0][0].data).toMatchObject({ status: "Cancelled", cancellationReason: "Duplicate request" });
    expect(db.ticketEvent.create.mock.calls[0][0].data).toMatchObject({ eventType: "Cancelled", fromValue: "Open", toValue: "Cancelled" });
  });

  it("resolving needs a summary or code; only resolved tickets close; reopening needs a reason", async () => {
    db.ticket.findFirst.mockResolvedValue(ticket());
    const noSummary = mockRes();
    await tickets.resolve(req({}, { ticketId: "t1" }), noSummary);
    expect(noSummary.status).toHaveBeenCalledWith(400);

    const early = mockRes();
    await tickets.close(req({}, { ticketId: "t1" }), early);
    expect(early.status).toHaveBeenCalledWith(400);

    db.ticket.findFirst.mockResolvedValue(ticket({ status: "Closed" }));
    const noReason = mockRes();
    await tickets.reopen(req({}, { ticketId: "t1" }), noReason);
    expect(noReason.status).toHaveBeenCalledWith(400);
  });

  it("closing never records a satisfaction score from staff", async () => {
    db.ticket.findFirst.mockResolvedValue(ticket({ status: "Resolved" }));
    await tickets.close(req({ csatScore: 5 }, { ticketId: "t1" }), mockRes());
    expect(db.ticket.update.mock.calls[0][0].data).not.toHaveProperty("csatScore");
  });

  it("edits are version-checked", async () => {
    db.ticket.findFirst.mockResolvedValue(ticket({ version: 4 }));
    const res = mockRes();
    await tickets.update(req({ subject: "X", version: 3 }, { ticketId: "t1" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe("conversation", () => {
  it("notes are filtered by permission in the query itself", () => {
    expect(tickets.allowedVisibilities(req({}, {}, { actions: ["view"] }))).toEqual(["Customer Visible"]);
    expect(tickets.allowedVisibilities(req({}, {}, { actions: ["view", "view_internal_notes", "view_restricted_notes"] }))).toEqual(["Customer Visible", "Internal Only", "Restricted Management"]);
  });

  it("a public reply sets the first response by server time and never claims it was sent", async () => {
    db.ticket.findFirst.mockResolvedValue(ticket({ status: "New", firstRespondedAt: null, portalAccountId: null }));
    db.ticketMessage.create.mockResolvedValue({ id: "msg1" });
    await tickets.reply(req({ message: "Hi <b>there</b>", firstRespondedAt: "2020-01-01" }, { ticketId: "t1" }), mockRes());
    const msg = db.ticketMessage.create.mock.calls[0][0].data;
    expect(msg).toMatchObject({ messageType: "Agent Reply", visibility: "Customer Visible", body: "Hi there", deliveryStatus: "Pending Provider" });
    const upd = db.ticket.update.mock.calls[0][0].data;
    expect(upd.status).toBe("Open");
    expect(upd.firstRespondedAt.getFullYear()).toBeGreaterThan(2020);
  });

  it("an internal note is internal-only, not delivered, and doesn't count as a response", async () => {
    db.ticket.findFirst.mockResolvedValue(ticket({ status: "New", firstRespondedAt: null }));
    db.ticketMessage.create.mockResolvedValue({ id: "n1" });
    await tickets.addInternalNote(req({ message: "VIP customer" }, { ticketId: "t1" }), mockRes());
    expect(db.ticketMessage.create.mock.calls[0][0].data).toMatchObject({ messageType: "Internal Note", visibility: "Internal Only", deliveryStatus: "Not Applicable" });
    expect(db.ticket.update).not.toHaveBeenCalled();
  });

  it("restricted notes need the restricted permission", async () => {
    const res = mockRes();
    await tickets.addInternalNote(req({ message: "Legal hold", restricted: true }, { ticketId: "t1" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("assignment and scope", () => {
  it("narrower scopes see created, owned, assigned, followed or queue tickets only", () => {
    const where = service.ticketScopeWhere(req({}, {}, { scope: "Own" }));
    expect(where.OR).toEqual(expect.arrayContaining([{ assignedMembershipId: "m1" }, { followers: { some: { membershipId: "m1" } } }, { queue: { members: { some: { membershipId: "m1", active: true } } } }]));
    expect(service.ticketScopeWhere(req({}, {}, { scope: "Department", department: "Support" })).OR).toContainEqual({ queue: { department: "Support" } });
  });

  it("round robin skips members at capacity and advances the cursor with a version check", async () => {
    db.supportQueue.findUnique.mockResolvedValue({ id: "q1", name: "Tier 1", organizationId: "org1", version: 2, lastAssignedMembershipId: "a" });
    db.supportQueueMember.findMany.mockResolvedValue([{ membershipId: "a" }, { membershipId: "b", capacity: 1 }, { membershipId: "c" }]);
    db.organizationMembership.findFirst.mockResolvedValue({ id: "x" });
    db.ticket.count.mockResolvedValue(1); // b is full
    db.supportQueue.updateMany.mockResolvedValue({ count: 1 });
    const pick = await service.pickRoundRobin(db, { id: "q1" });
    expect(pick.membershipId).toBe("c");
    expect(pick.reason).toMatch(/Round robin/);
    expect(db.supportQueue.updateMany.mock.calls[0][0].where).toEqual({ id: "q1", version: 2 });
  });

  it("a follower who can't see the ticket isn't added", async () => {
    db.ticket.findFirst.mockResolvedValue(ticket());
    db.organizationMembership.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await tickets.addFollower(req({ membershipId: "m9" }, { ticketId: "t1" }, { actions: [...AGENT, "assign"] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.ticketFollower.create).not.toHaveBeenCalled();
  });

  it("an archived category can't be picked for a new ticket", async () => {
    db.ticketCategory.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await tickets.create(req({ subject: "Help", categoryId: "archived-cat" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.ticket.create).not.toHaveBeenCalled();
  });

  it("create gets a per-org number, starts New and records a Created event", async () => {
    db.ticket.create.mockImplementation(({ data }) => ({ id: "t9", ...data }));
    await tickets.create(req({ subject: "Can't log in", priority: "High", status: "Closed" }), mockRes());
    expect(db.ticket.create.mock.calls[0][0].data).toMatchObject({ status: "New", priority: "High", ticketNumber: expect.stringMatching(/^TICKET-\d{4}-000007$/), organizationId: "org1" });
    expect(db.ticketEvent.create.mock.calls[0][0].data).toMatchObject({ eventType: "Created" });
  });
});

describe("related, merge and bulk", () => {
  it("related tickets come from deterministic signals", () => {
    const signals = service.relatedSignals(
      { contactId: "c1", companyId: "co1", subject: "Cannot login to portal", categoryId: "k1", createdAt: new Date("2026-09-01") },
      { contactId: "c1", companyId: "co1", subject: "cannot login to the portal", categoryId: "k2", createdAt: new Date("2026-09-03") },
    );
    expect(signals).toEqual(["Same requester", "Same company", "Similar subject", "Created within 7 days"]);
  });

  it("merging needs a reason and never merges a ticket into itself", async () => {
    const noReason = mockRes();
    await tickets.merge(req({ targetTicketId: "t2" }, { ticketId: "t1" }), noReason);
    expect(noReason.status).toHaveBeenCalledWith(400);

    db.ticket.findFirst.mockResolvedValue(ticket());
    const self = mockRes();
    await tickets.merge(req({ targetTicketId: "t1", reason: "dup" }, { ticketId: "t1" }), self);
    expect(self.status).toHaveBeenCalledWith(400);
  });

  it("bulk actions need the action's own permission", async () => {
    const res = mockRes();
    await tickets.bulk(req({ action: "archive", ticketIds: ["t1"] }, {}, { actions: [...AGENT, "bulk_actions"] }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
