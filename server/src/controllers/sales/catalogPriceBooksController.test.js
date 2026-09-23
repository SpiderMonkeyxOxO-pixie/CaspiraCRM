import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCatalogFindFirst = vi.fn();
const mockCatalogUpdate = vi.fn();
const mockCatalogCreate = vi.fn();
const mockPriceBookFindFirst = vi.fn();
const mockPriceBookUpdate = vi.fn();
const mockEntryFindFirst = vi.fn();
const mockEntryUpdate = vi.fn();
const mockCompanyCount = vi.fn();

vi.mock("../../lib/prisma.js", () => ({
  default: {
    catalogItem: { findFirst: (...a) => mockCatalogFindFirst(...a), update: (...a) => mockCatalogUpdate(...a), create: (...a) => mockCatalogCreate(...a) },
    priceBook: { findFirst: (...a) => mockPriceBookFindFirst(...a), update: (...a) => mockPriceBookUpdate(...a) },
    priceBookEntry: { findFirst: (...a) => mockEntryFindFirst(...a), update: (...a) => mockEntryUpdate(...a) },
    company: { count: (...a) => mockCompanyCount(...a) },
    organizationMembership: { findFirst: vi.fn() },
  },
}));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));
vi.mock("../../middleware/rbac.js", () => ({ authorizeOrgAccess: vi.fn(async () => ({ ok: false })) }));

const catalog = await import("./catalogController.js");
const priceBooks = await import("./priceBooksController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

// A caller WITHOUT products_services:view_financial_fields.
const req = (body, params = {}) => ({ body, params, query: {}, organizationId: "org1", membership: { id: "m1", roles: [] }, user: { id: "u1" }, isSystemOwnerOverride: false });

describe("catalog and price book write rules", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a caller who can't view cost can't change it either, and can't archive through update", async () => {
    mockCatalogFindFirst.mockResolvedValueOnce({ id: "i1", version: 1, sku: "SKU-1" });
    mockCatalogUpdate.mockImplementation(({ data }) => ({ id: "i1", ...data }));
    await catalog.update(req({ name: "Renamed", costPreview: 1, status: "Archived", archived: true }, { itemId: "i1" }), mockRes());

    const { data } = mockCatalogUpdate.mock.calls[0][0];
    expect(data.name).toBe("Renamed");
    for (const field of ["costPreview", "status", "archived"]) expect(data).not.toHaveProperty(field);
  });

  it("archiving a catalog item requires a reason", async () => {
    const res = mockRes();
    await catalog.archive(req({}, { itemId: "i1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("a price book can't target another organization's companies", async () => {
    mockPriceBookFindFirst.mockResolvedValueOnce({ id: "pb1", version: 1 });
    mockCompanyCount.mockResolvedValueOnce(0);
    const res = mockRes();
    await priceBooks.update(req({ companyIds: ["foreign-company"] }, { priceBookId: "pb1" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPriceBookUpdate).not.toHaveBeenCalled();
  });

  it("rejects saving a cross-currency percentage entry (needs the catalog item's currency)", async () => {
    mockPriceBookFindFirst.mockResolvedValueOnce({ id: "pb1" });
    mockEntryFindFirst.mockResolvedValueOnce({ id: "e1", currency: "USD", adjustmentType: "Fixed Price", catalogItem: { currency: "USD" } });
    const res = mockRes();
    await priceBooks.updateEntry(req({ currency: "EUR", adjustmentType: "Percentage Decrease" }, { priceBookId: "pb1", entryId: "e1" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockEntryUpdate).not.toHaveBeenCalled();
  });
});
