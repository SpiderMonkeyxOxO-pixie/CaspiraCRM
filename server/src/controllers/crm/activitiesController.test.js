import { describe, it, expect, vi, beforeEach } from "vitest";

const mockActivityFindFirst = vi.fn();
const mockActivityFindMany = vi.fn();
const mockActivityCreate = vi.fn();
const mockActivityUpdate = vi.fn();
const mockActivityUpdateMany = vi.fn();
const mockMembershipFindFirst = vi.fn();

vi.mock("../../lib/prisma.js", () => ({
  default: {
    activity: {
      findFirst: (...a) => mockActivityFindFirst(...a),
      findMany: (...a) => mockActivityFindMany(...a),
      create: (...a) => mockActivityCreate(...a),
      update: (...a) => mockActivityUpdate(...a),
      updateMany: (...a) => mockActivityUpdateMany(...a),
    },
    organizationMembership: { findFirst: (...a) => mockMembershipFindFirst(...a) },
    lead: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
  },
}));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));
vi.mock("../../services/crm/scopeService.js", () => ({ resolveCrmScopeWhere: () => ({}) }));

const { create, update, bulk } = await import("./activitiesController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const req = (body, params = {}) => ({ body, params, query: {}, organizationId: "org1", membership: { id: "m1" }, user: { id: "u1" } });

describe("activitiesController writable fields and membership checks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create keeps per-type fields, always starts Scheduled, and drops status/archive/unknown fields", async () => {
    mockActivityCreate.mockImplementation(({ data }) => ({ id: "a1", ...data }));
    await create(req({
      title: "Discovery call", type: "Call", callDirection: "Outbound", expectedDurationMinutes: "30", scheduledStart: "2026-10-01T09:00:00Z",
      status: "Completed", archivedAt: "2026-01-01", organizationId: "x", ownerName: "Someone",
    }), mockRes());

    const { data } = mockActivityCreate.mock.calls[0][0];
    expect(data).toMatchObject({ title: "Discovery call", callDirection: "Outbound", expectedDurationMinutes: 30, status: "Scheduled", organizationId: "org1" });
    expect(data.scheduledStart).toBeInstanceOf(Date);
    for (const field of ["archivedAt", "ownerName"]) expect(data).not.toHaveProperty(field);
  });

  it("update rejects an owner from outside the organization", async () => {
    mockActivityFindFirst.mockResolvedValueOnce({ id: "a1", version: 1, status: "Scheduled", archivedAt: null });
    mockMembershipFindFirst.mockResolvedValueOnce(null);
    const res = mockRes();
    await update(req({ ownerMembershipId: "foreign-member" }, { activityId: "a1" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockActivityUpdate).not.toHaveBeenCalled();
  });

  it("bulk assign validates the assignee before touching any record", async () => {
    mockActivityFindMany.mockResolvedValueOnce([{ id: "a1", status: "Scheduled" }]);
    mockMembershipFindFirst.mockResolvedValueOnce(null);
    const res = mockRes();
    await bulk(req({ action: "assign", ids: ["a1"], assignedMembershipId: "foreign-member" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockActivityUpdateMany).not.toHaveBeenCalled();
  });
});
