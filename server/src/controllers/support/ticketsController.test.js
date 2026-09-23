import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTicketFindFirst = vi.fn();
const mockTicketFindUnique = vi.fn();
const mockTicketUpdate = vi.fn();
const mockTicketCreate = vi.fn();
const mockMessageCreate = vi.fn();
const mockTxTicketUpdate = vi.fn();
const mockContactFindFirst = vi.fn();

vi.mock("../../lib/prisma.js", () => ({
  default: {
    ticket: { findFirst: (...a) => mockTicketFindFirst(...a), findUnique: (...a) => mockTicketFindUnique(...a), update: (...a) => mockTicketUpdate(...a) },
    ticketEscalation: { create: vi.fn() },
    company: { findFirst: vi.fn(async () => ({ id: "co1" })) },
    contact: { findFirst: (...a) => mockContactFindFirst(...a) },
    organizationMembership: { findFirst: vi.fn() },
    $transaction: vi.fn(async (arg) =>
      typeof arg === "function"
        ? arg({
            ticket: { create: (...a) => mockTicketCreate(...a), update: (...a) => mockTxTicketUpdate(...a) },
            ticketMessage: { create: (...a) => mockMessageCreate(...a) },
            salesDocumentCounter: { upsert: vi.fn(), update: vi.fn(async () => ({ value: 7 })) },
          })
        : arg,
    ),
  },
}));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));

const tickets = await import("./ticketsController.js");
const { slaDeadlines, canAdvance } = await import("../../services/support/ticketLifecycleService.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const req = (body, params = {}, scope = "Organization") => ({
  body, params, query: {}, organizationId: "org1", user: { id: "u1" }, isSystemOwnerOverride: false,
  membership: { id: "m1", roles: [{ role: { defaultScope: scope, permissionGrants: [{ moduleId: "tickets", actions: ["view"] }] } }] },
});

describe("ticket rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTicketFindUnique.mockResolvedValue({ id: "t1" });
  });

  it("computes SLA deadlines from the priority, server-side", () => {
    const { slaResponseDeadline, slaResolutionDeadline } = slaDeadlines("Urgent", "2026-09-01T00:00:00.000Z");
    expect(slaResponseDeadline.toISOString()).toBe("2026-09-01T01:00:00.000Z");
    expect(slaResolutionDeadline.toISOString()).toBe("2026-09-01T04:00:00.000Z");
  });

  it("only allows the working status steps; resolve/close/reopen have their own endpoints", () => {
    expect(canAdvance("New", "Open")).toBe(true);
    expect(canAdvance("Waiting for Customer", "In Progress")).toBe(true);
    expect(canAdvance("Open", "Resolved")).toBe(false);
    expect(canAdvance("New", "Closed")).toBe(false);
  });

  it("create numbers the ticket from the org counter, starts it New, and ignores client-set SLA/status", async () => {
    mockTicketCreate.mockImplementation(({ data }) => ({ id: "t1", ...data }));
    await tickets.create(req({ subject: "Can't log in", priority: "High", status: "Closed", slaResponseDeadline: "2030-01-01", csatScore: 5 }), mockRes());

    const { data } = mockTicketCreate.mock.calls[0][0];
    expect(data).toMatchObject({ subject: "Can't log in", priority: "High", status: "New", organizationId: "org1" });
    expect(data.ticketNumber).toMatch(/^TICKET-\d{4}-000007$/);
    expect(data).not.toHaveProperty("csatScore");
    expect(data.slaResponseDeadline.getTime() - Date.now()).toBeGreaterThan(3.9 * 3600 * 1000); // 4h for High, not 2030
  });

  it("the first public reply opens a New ticket and stops the response clock; notes don't", async () => {
    mockTicketFindFirst.mockResolvedValueOnce({ id: "t1", status: "New", firstRespondedAt: null });
    await tickets.reply(req({ message: "Looking into it" }, { ticketId: "t1" }), mockRes());
    expect(mockMessageCreate.mock.calls[0][0].data).toMatchObject({ kind: "Reply", body: "Looking into it", authorMembershipId: "m1" });
    expect(mockTxTicketUpdate.mock.calls[0][0].data).toMatchObject({ status: "Open" });
    expect(mockTxTicketUpdate.mock.calls[0][0].data.firstRespondedAt).toBeInstanceOf(Date);

    mockTxTicketUpdate.mockClear();
    mockTicketFindFirst.mockResolvedValueOnce({ id: "t1", status: "New", firstRespondedAt: null });
    await tickets.addNote(req({ message: "Customer is on the enterprise plan" }, { ticketId: "t1" }), mockRes());
    expect(mockTxTicketUpdate).not.toHaveBeenCalled();
  });

  it("only a resolved ticket can be closed, and CSAT must be 1–5", async () => {
    mockTicketFindFirst.mockResolvedValueOnce({ id: "t1", status: "Open" });
    const res = mockRes();
    await tickets.close(req({ csatScore: 5 }, { ticketId: "t1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);

    const res2 = mockRes();
    await tickets.close(req({ csatScore: 9 }, { ticketId: "t1" }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  it("rejects a contact from a different company than the ticket's", async () => {
    mockContactFindFirst.mockResolvedValueOnce({ id: "c9", companyId: "other-co" });
    const res = mockRes();
    await tickets.create(req({ subject: "X", companyId: "co1", contactId: "c9" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockTicketCreate).not.toHaveBeenCalled();
  });

  it("an Own-scoped member only sees tickets they created or are assigned to", async () => {
    mockTicketFindFirst.mockResolvedValueOnce(null);
    await tickets.getOne(req({}, { ticketId: "t1" }, "Own"), mockRes());
    expect(mockTicketFindFirst.mock.calls[0][0].where).toMatchObject({
      organizationId: "org1", OR: [{ createdByMembershipId: "m1" }, { assignedMembershipId: "m1" }],
    });
  });
});
