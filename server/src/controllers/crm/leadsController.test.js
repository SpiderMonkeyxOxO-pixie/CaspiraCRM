import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLeadCreate = vi.fn();
const mockLeadUpdate = vi.fn();
const mockLeadFindFirst = vi.fn();

vi.mock("../../lib/prisma.js", () => ({
  default: {
    lead: {
      create: (...a) => mockLeadCreate(...a),
      update: (...a) => mockLeadUpdate(...a),
      findFirst: (...a) => mockLeadFindFirst(...a),
    },
    organizationMembership: { findFirst: vi.fn() },
  },
}));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));
vi.mock("../../services/crm/scopeService.js", () => ({ resolveCrmScopeWhere: () => ({}) }));

const { create, update } = await import("./leadsController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const req = (body, params = {}) => ({ body, params, organizationId: "org1", membership: { id: "m1" }, user: { id: "u1" } });

describe("leadsController writable-field allow-list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create keeps form fields, maps first/last name into name, and drops server-controlled or unknown fields", async () => {
    mockLeadCreate.mockImplementation(({ data }) => ({ id: "l1", ...data }));
    const res = mockRes();
    await create(req({
      firstName: "Tom", lastName: "Reilly", email: "tom@x.example", jobTitle: "CTO", consent: false, nextActionDate: "2026-10-01",
      organizationId: "other-org", archived: true, version: 99, tags: ["vip"], ownerId: "u9",
    }), res);

    const { data } = mockLeadCreate.mock.calls[0][0];
    expect(data).toMatchObject({ name: "Tom Reilly", jobTitle: "CTO", consent: false, organizationId: "org1" });
    expect(data.nextActionDate).toBeInstanceOf(Date);
    for (const field of ["archived", "version", "tags", "ownerId"]) expect(data).not.toHaveProperty(field);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("update never lets the body move a lead to another organization or change archive state", async () => {
    mockLeadFindFirst.mockResolvedValueOnce({ id: "l1", version: 1, archived: false });
    mockLeadUpdate.mockImplementation(({ data }) => ({ id: "l1", ...data }));
    await update(req({ companyName: "Reilly Consulting", organizationId: "other-org", archived: true, convertedDealId: "d9" }, { leadId: "l1" }), mockRes());

    const { data } = mockLeadUpdate.mock.calls[0][0];
    expect(data.companyName).toBe("Reilly Consulting");
    for (const field of ["organizationId", "archived", "convertedDealId"]) expect(data).not.toHaveProperty(field);
  });

  it("update requires a reason before setting a disqualifying status", async () => {
    mockLeadFindFirst.mockResolvedValueOnce({ id: "l1", version: 1, archived: false, disqualifyReason: null });
    const res = mockRes();
    await update(req({ status: "Spam" }, { leadId: "l1" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });
});
