import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  supportInbox: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  supportQueue: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  supportQueueMember: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  organizationMembership: { findFirst: vi.fn() },
  ticket: { count: vi.fn() },
  ticketCategory: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  cannedResponse: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  slaPolicy: { findFirst: vi.fn() },
};
vi.mock("../../lib/prisma.js", () => ({ default: db }));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));

const ctrl = await import("./supportSettingsController.js");
const { sanitizeText } = await import("../../services/support/supportCommon.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const req = (body = {}, params = {}, query = {}) => ({ body, params, query, organizationId: "org1", user: { id: "u1" }, membership: { id: "m1" } });

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
});

describe("sanitizing", () => {
  it("strips markup and script content, keeps the text", () => {
    expect(sanitizeText('Hi <b>there</b><script>alert(1)</script> <img src=x onerror=alert(2)>ok')).toBe("Hi there ok");
    expect(sanitizeText("a < b and c > d")).toBe("a < b and c > d");
  });
});

describe("inboxes", () => {
  it("placeholder channels are created but marked disconnected", async () => {
    db.supportInbox.findFirst.mockResolvedValue(null);
    db.supportInbox.create.mockImplementation(({ data }) => ({ id: "i1", ...data }));
    const res = mockRes();
    await ctrl.createInbox(req({ name: "Email", channelType: "Email Placeholder" }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].inbox).toMatchObject({ channelType: "Email Placeholder", connected: false, organizationId: "org1" });
  });

  it("rejects unknown channels and a default queue from another organization", async () => {
    const bad = mockRes();
    await ctrl.createInbox(req({ name: "X", channelType: "WhatsApp" }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);

    db.supportQueue.findFirst.mockResolvedValue(null); // not in this org
    const cross = mockRes();
    await ctrl.createInbox(req({ name: "Y", defaultQueueId: "q-other-org" }), cross);
    expect(cross.status).toHaveBeenCalledWith(400);
    expect(db.supportInbox.create).not.toHaveBeenCalled();
  });

  it("edits are version-checked", async () => {
    db.supportInbox.findFirst.mockResolvedValue({ id: "i1", version: 3, archivedAt: null });
    const res = mockRes();
    await ctrl.updateInbox(req({ name: "New", version: 2 }, { inboxId: "i1" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe("queues", () => {
  it("only active members of the same organization can join a queue", async () => {
    db.supportQueue.findFirst.mockResolvedValue({ id: "q1", organizationId: "org1" });
    db.organizationMembership.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await ctrl.addQueueMember(req({ membershipId: "m-other-org" }, { queueId: "q1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.organizationMembership.findFirst.mock.calls[0][0].where).toMatchObject({ organizationId: "org1", status: "Active" });
  });

  it("capacity is bounded; re-adding reactivates instead of duplicating", async () => {
    db.supportQueue.findFirst.mockResolvedValue({ id: "q1" });
    const bad = mockRes();
    await ctrl.addQueueMember(req({ membershipId: "m2", capacity: 0 }, { queueId: "q1" }), bad);
    expect(bad.status).toHaveBeenCalledWith(400);

    db.organizationMembership.findFirst.mockResolvedValue({ id: "m2" });
    db.supportQueueMember.upsert.mockResolvedValue({ id: "qm1", active: true });
    await ctrl.addQueueMember(req({ membershipId: "m2", capacity: 5 }, { queueId: "q1" }), mockRes());
    expect(db.supportQueueMember.upsert.mock.calls[0][0]).toMatchObject({ where: { queueId_membershipId: { queueId: "q1", membershipId: "m2" } }, update: { active: true, capacity: 5 } });
  });

  it("a queue with open tickets can't be archived", async () => {
    db.supportQueue.findFirst.mockResolvedValue({ id: "q1", archivedAt: null });
    db.ticket.count.mockResolvedValue(2);
    const res = mockRes();
    await ctrl.archiveQueue(req({}, { queueId: "q1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.supportQueue.update).not.toHaveBeenCalled();
  });
});

describe("categories", () => {
  it("allows one level of subcategories, from an active parent", async () => {
    db.ticketCategory.findFirst.mockResolvedValueOnce({ id: "c1", parentId: "c0" });
    const res = mockRes();
    await ctrl.createCategory(req({ name: "Too deep", parentId: "c1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("an archived category can't be edited", async () => {
    db.ticketCategory.findFirst.mockResolvedValue({ id: "c1", archivedAt: new Date() });
    const res = mockRes();
    await ctrl.updateCategory(req({ name: "X" }, { categoryId: "c1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("canned responses", () => {
  it("are sanitized, and personal ones are only visible to their author", async () => {
    db.cannedResponse.create.mockImplementation(({ data }) => ({ id: "r1", ...data }));
    await ctrl.createCannedResponse(req({ name: "Thanks", body: "Thanks <script>x</script>for waiting" }), mockRes());
    expect(db.cannedResponse.create.mock.calls[0][0].data.body).toBe("Thanks for waiting");

    db.cannedResponse.findMany.mockResolvedValue([]);
    await ctrl.listCannedResponses(req(), mockRes());
    expect(db.cannedResponse.findMany.mock.calls[0][0].where.OR).toEqual([{ visibility: "Team" }, { visibility: "Personal", createdByMembershipId: "m1" }]);
  });
});
