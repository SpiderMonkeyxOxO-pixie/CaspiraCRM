import { describe, it, expect, vi, beforeEach } from "vitest";

const mockContactFindFirst = vi.fn();
const mockContactUpdate = vi.fn();
const mockCompanyFindFirst = vi.fn();
const mockCompanyUpdate = vi.fn();
const mockRelFindFirst = vi.fn();
const mockRelUpdate = vi.fn();

vi.mock("../../lib/prisma.js", () => ({
  default: {
    contact: { findFirst: (...a) => mockContactFindFirst(...a), update: (...a) => mockContactUpdate(...a), findUnique: vi.fn() },
    company: { findFirst: (...a) => mockCompanyFindFirst(...a), update: (...a) => mockCompanyUpdate(...a) },
    companyContactRelationship: { findFirst: (...a) => mockRelFindFirst(...a), update: (...a) => mockRelUpdate(...a), updateMany: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    $transaction: (cb) => cb({ companyContactRelationship: { update: (...a) => mockRelUpdate(...a), updateMany: vi.fn() } }),
  },
}));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));
vi.mock("../../services/crm/scopeService.js", () => ({ resolveCrmScopeWhere: () => ({}) }));
vi.mock("../../middleware/rbac.js", () => ({ authorizeOrgAccess: vi.fn(async () => ({ ok: true })) }));

const contacts = await import("./contactsController.js");
const companies = await import("./companiesController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const req = (body, params = {}) => ({ body, params, query: {}, organizationId: "org1", membership: { id: "m1" }, user: { id: "u1" } });

describe("contact/company writable-field allow-lists", () => {
  beforeEach(() => vi.clearAllMocks());

  it("contact update rejects a companyId from another organization", async () => {
    mockContactFindFirst.mockResolvedValueOnce({ id: "c1", version: 1, archived: false });
    mockCompanyFindFirst.mockResolvedValueOnce(null); // not found in org1
    const res = mockRes();
    await contacts.update(req({ companyId: "foreign-company" }, { contactId: "c1" }), res);

    expect(mockCompanyFindFirst).toHaveBeenCalledWith({ where: { id: "foreign-company", organizationId: "org1" } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockContactUpdate).not.toHaveBeenCalled();
  });

  it("contact update keeps form fields and drops server-controlled ones", async () => {
    mockContactFindFirst.mockResolvedValueOnce({ id: "c1", version: 1, archived: false });
    mockContactUpdate.mockImplementation(({ data }) => ({ id: "c1", ...data }));
    await contacts.update(req({ relationshipType: "Customer", nextActionDate: "2026-10-01", archived: true, organizationId: "x", ownerId: "u9" }, { contactId: "c1" }), mockRes());

    const { data } = mockContactUpdate.mock.calls[0][0];
    expect(data.relationshipType).toBe("Customer");
    expect(data.nextActionDate).toBeInstanceOf(Date);
    for (const field of ["archived", "organizationId", "ownerId"]) expect(data).not.toHaveProperty(field);
  });

  it("company update drops archive state and unknown fields", async () => {
    mockCompanyFindFirst.mockResolvedValueOnce({ id: "co1", version: 1, archived: false });
    mockCompanyUpdate.mockImplementation(({ data }) => ({ id: "co1", ...data }));
    await companies.update(req({ accountTier: "Gold", estimatedAnnualValue: "1200.50", archived: true, statusBeforeArchive: "x", tags: [] }, { companyId: "co1" }), mockRes());

    const { data } = mockCompanyUpdate.mock.calls[0][0];
    expect(data).toMatchObject({ accountTier: "Gold", estimatedAnnualValue: 1200.5 });
    for (const field of ["archived", "statusBeforeArchive", "tags"]) expect(data).not.toHaveProperty(field);
  });

  it("company-contact relationship update can never re-point companyId/contactId", async () => {
    mockCompanyFindFirst.mockResolvedValueOnce({ id: "co1" });
    mockRelFindFirst.mockResolvedValueOnce({ id: "r1", companyId: "co1", contactId: "c1" });
    mockRelUpdate.mockImplementation(({ data }) => ({ id: "r1", ...data }));
    await companies.updateContactRelationship(
      { ...req({ jobTitleAtCompany: "CFO", companyId: "foreign-co", contactId: "foreign-contact" }, { companyId: "co1", contactId: "c1" }) },
      mockRes(),
    );

    const { data } = mockRelUpdate.mock.calls[0][0];
    expect(data).toEqual({ jobTitleAtCompany: "CFO" });
  });
});
