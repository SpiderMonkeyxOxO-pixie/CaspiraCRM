import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuoteFindFirst = vi.fn();
const mockQuoteUpdate = vi.fn();
const mockCatalogCount = vi.fn();
const mockTxQuoteUpdate = vi.fn();

vi.mock("../../lib/prisma.js", () => ({
  default: {
    quote: { findFirst: (...a) => mockQuoteFindFirst(...a), update: (...a) => mockQuoteUpdate(...a) },
    catalogItem: { count: (...a) => mockCatalogCount(...a) },
    priceBook: { count: vi.fn(), findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    $transaction: vi.fn(async (cb) =>
      cb({
        quote: { update: (...a) => mockTxQuoteUpdate(...a) },
        quoteLineItem: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
      }),
    ),
  },
}));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));
vi.mock("../../services/crm/scopeService.js", () => ({ resolveCrmScopeWhere: () => ({}) }));

const { update, cancel, newVersion, recordCustomerResponse } = await import("./quotesController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const req = (body, params = {}) => ({ body, params, query: {}, organizationId: "org1", membership: { id: "m1" }, user: { id: "u1" } });

describe("quote workflow protections", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a Draft edit can't set its own status, approval or acceptance (no approval bypass)", async () => {
    mockQuoteFindFirst.mockResolvedValueOnce({ id: "q1", status: "Draft", rowVersion: 1, currency: "USD" });
    mockTxQuoteUpdate.mockImplementation(({ data }) => ({ id: "q1", status: "Draft", ...data }));
    await update(req({ title: "Renamed", status: "Approved", approvedByMembershipId: "m1", approvedAt: "2026-01-01", grandTotal: 1 }, { quoteId: "q1" }), mockRes());

    const headerWrite = mockTxQuoteUpdate.mock.calls[0][0].data;
    expect(headerWrite.title).toBe("Renamed");
    for (const field of ["status", "approvedByMembershipId", "approvedAt", "grandTotal"]) expect(headerWrite).not.toHaveProperty(field);
  });

  it("rejects line items that reference another organization's catalog item", async () => {
    mockQuoteFindFirst.mockResolvedValueOnce({ id: "q1", status: "Draft", rowVersion: 1, currency: "USD" });
    mockCatalogCount.mockResolvedValueOnce(0);
    const res = mockRes();
    await update(req({ lineItems: [{ catalogItemId: "foreign-item", quantity: 1, unitPrice: 10 }] }, { quoteId: "q1" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockTxQuoteUpdate).not.toHaveBeenCalled();
  });

  it("an accepted quote can't be cancelled", async () => {
    mockQuoteFindFirst.mockResolvedValueOnce({ id: "q1", status: "Preview Accepted", lineItems: [] });
    const res = mockRes();
    await cancel(req({ reason: "Changed our mind" }, { quoteId: "q1" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuoteUpdate).not.toHaveBeenCalled();
  });

  it("a superseded version can't be revised again (no forked version history)", async () => {
    mockQuoteFindFirst.mockResolvedValueOnce({ id: "q1", status: "Superseded", lineItems: [] });
    const res = mockRes();
    await newVersion(req({ changeSummary: "Lower price" }, { quoteId: "q1" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("records a customer's 'Viewed' response only on a freshly issued quote", async () => {
    mockQuoteFindFirst.mockResolvedValueOnce({ id: "q1", status: "Preview Sent", lineItems: [] });
    mockQuoteUpdate.mockImplementation(({ data }) => ({ id: "q1", ...data }));
    await recordCustomerResponse(req({ type: "Viewed" }, { quoteId: "q1" }), mockRes());
    expect(mockQuoteUpdate.mock.calls[0][0].data).toMatchObject({ status: "Preview Viewed", customerResponse: { type: "Viewed" } });

    mockQuoteFindFirst.mockResolvedValueOnce({ id: "q2", status: "Draft", lineItems: [] });
    const res = mockRes();
    await recordCustomerResponse(req({ type: "Viewed" }, { quoteId: "q2" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
