import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDealFindFirst = vi.fn();
const mockDealFindMany = vi.fn();
const mockDealUpdate = vi.fn();
const mockDealUpdateMany = vi.fn();
const mockContactCount = vi.fn();
const mockMembershipFindFirst = vi.fn();
const mockStageFindUnique = vi.fn();
const mockStageFindFirst = vi.fn();
const mockPipelineFindFirst = vi.fn();

vi.mock("../../lib/prisma.js", () => ({
  default: {
    deal: {
      findFirst: (...a) => mockDealFindFirst(...a),
      findMany: (...a) => mockDealFindMany(...a),
      update: (...a) => mockDealUpdate(...a),
      updateMany: (...a) => mockDealUpdateMany(...a),
    },
    contact: { count: (...a) => mockContactCount(...a), findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    organizationMembership: { findFirst: (...a) => mockMembershipFindFirst(...a) },
    pipeline: { findFirst: (...a) => mockPipelineFindFirst(...a) },
    pipelineStage: { findUnique: (...a) => mockStageFindUnique(...a), findFirst: (...a) => mockStageFindFirst(...a) },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));
vi.mock("../../services/crm/scopeService.js", () => ({ resolveCrmScopeWhere: () => ({}) }));
vi.mock("../../services/sales/pipelineSeedService.js", () => ({ ensureDefaultPipelines: vi.fn() }));

const { create, update, bulk } = await import("./dealsController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const req = (body, params = {}) => ({ body, params, query: {}, organizationId: "org1", membership: { id: "m1" }, user: { id: "u1" }, isSystemOwnerOverride: true });

describe("dealsController writable fields and organization checks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("update keeps form fields and drops archive/close-reason/unknown fields", async () => {
    mockDealFindFirst.mockResolvedValueOnce({ id: "d1", version: 1, archived: false });
    mockDealUpdate.mockImplementation(({ data }) => ({ id: "d1", ...data }));
    await update(req({ nextAction: "Send proposal", value: "1200", archived: true, winReason: "x", dealNumber: "DEAL-9", ownerName: "y" }, { dealId: "d1" }), mockRes());

    const { data } = mockDealUpdate.mock.calls[0][0];
    expect(data).toMatchObject({ nextAction: "Send proposal", value: 1200 });
    for (const field of ["archived", "winReason", "dealNumber", "ownerName"]) expect(data).not.toHaveProperty(field);
  });

  it("update rejects contact roles that point at another organization's contact", async () => {
    mockDealFindFirst.mockResolvedValueOnce({ id: "d1", version: 1, archived: false });
    mockContactCount.mockResolvedValueOnce(1); // only one of the two ids is in org1
    const res = mockRes();
    await update(req({ contactRoles: [{ contactId: "c1", role: "Champion" }, { contactId: "foreign", role: "Buyer" }] }, { dealId: "d1" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockDealUpdate).not.toHaveBeenCalled();
  });

  it("create refuses to start a deal in a closed stage", async () => {
    mockPipelineFindFirst.mockResolvedValue({ id: "p1" });
    mockStageFindFirst.mockResolvedValue({ id: "s-won" });
    mockStageFindUnique.mockResolvedValueOnce({ id: "s-won", name: "Won", classification: "Won" });
    const res = mockRes();
    await create(req({ name: "Big deal", pipelineId: "p1", pipelineStageId: "s-won" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("bulk assign validates the owner before touching any record", async () => {
    mockDealFindMany.mockResolvedValueOnce([{ id: "d1" }]);
    mockMembershipFindFirst.mockResolvedValueOnce(null);
    const res = mockRes();
    await bulk(req({ action: "assign", ids: ["d1"], ownerMembershipId: "foreign-member" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockDealUpdateMany).not.toHaveBeenCalled();
  });
});
