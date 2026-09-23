import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOrderFindFirst = vi.fn();
const mockOrderUpdate = vi.fn();
const mockContractFindFirst = vi.fn();
const mockContractUpdate = vi.fn();
const mockTxOrderUpdate = vi.fn();
const mockTxLineUpdate = vi.fn();
const mockTxLineFindMany = vi.fn();
const mockTxContractUpdate = vi.fn();

vi.mock("../../lib/prisma.js", () => ({
  default: {
    order: { findFirst: (...a) => mockOrderFindFirst(...a), update: (...a) => mockOrderUpdate(...a) },
    contract: { findFirst: (...a) => mockContractFindFirst(...a), update: (...a) => mockContractUpdate(...a) },
    contractRenewalReview: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    catalogItem: { count: vi.fn() },
    organizationMembership: { findFirst: vi.fn() },
    $transaction: vi.fn(async (cb) =>
      cb({
        order: { update: (...a) => mockTxOrderUpdate(...a) },
        orderLineItem: { update: (...a) => mockTxLineUpdate(...a), findMany: (...a) => mockTxLineFindMany(...a) },
        contract: { update: (...a) => mockTxContractUpdate(...a) },
      }),
    ),
  },
}));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));
vi.mock("../../services/crm/scopeService.js", () => ({ resolveCrmScopeWhere: () => ({}) }));

const orders = await import("./ordersController.js");
const contracts = await import("./contractsController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const req = (body, params = {}) => ({ body, params, query: {}, organizationId: "org1", membership: { id: "m1" }, user: { id: "u1" } });

describe("order rules", () => {
  beforeEach(() => vi.clearAllMocks());

  it("an order edit can't set status or confirmation fields directly", async () => {
    mockOrderFindFirst.mockResolvedValueOnce({ id: "o1", status: "Draft", version: 1, currency: "USD", lineItems: [] });
    mockTxOrderUpdate.mockImplementation(({ data }) => ({ id: "o1", ...data }));
    await orders.update(req({ customerReference: "PO-7", status: "Fulfilled", confirmedByMembershipId: "m1", grandTotal: 1 }, { orderId: "o1" }), mockRes());

    const { data } = mockTxOrderUpdate.mock.calls[0][0];
    expect(data.customerReference).toBe("PO-7");
    for (const field of ["status", "confirmedByMembershipId", "grandTotal"]) expect(data).not.toHaveProperty(field);
  });

  it("a fulfilled order can't be cancelled", async () => {
    mockOrderFindFirst.mockResolvedValueOnce({ id: "o1", status: "Fulfilled", lineItems: [] });
    const res = mockRes();
    await orders.cancel(req({ reason: "Changed mind" }, { orderId: "o1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockOrderUpdate).not.toHaveBeenCalled();
  });

  it("partial delivery moves a Processing order to Partially Fulfilled", async () => {
    const lines = [{ id: "l1", lineKind: "Product", quantity: 10, quantityFulfilled: 0 }, { id: "l2", lineKind: "Product", quantity: 5, quantityFulfilled: 5 }];
    mockOrderFindFirst.mockResolvedValueOnce({ id: "o1", status: "Processing", lineItems: lines });
    mockTxLineFindMany.mockResolvedValueOnce([{ ...lines[0], quantityFulfilled: 4 }, lines[1]]);
    mockTxOrderUpdate.mockImplementation(({ data }) => ({ id: "o1", ...data }));
    await orders.updateLineFulfillment(req({ quantityFulfilled: 4 }, { orderId: "o1", lineId: "l1" }), mockRes());

    expect(mockTxLineUpdate.mock.calls[0][0].data).toMatchObject({ quantityFulfilled: 4, deliveryStatus: "Partial" });
    expect(mockTxOrderUpdate.mock.calls[0][0].data.status).toBe("Partially Fulfilled");
  });

  it("rejects delivering more than was ordered", async () => {
    mockOrderFindFirst.mockResolvedValueOnce({ id: "o1", status: "Processing", lineItems: [{ id: "l1", lineKind: "Product", quantity: 3, quantityFulfilled: 0 }] });
    const res = mockRes();
    await orders.updateLineFulfillment(req({ quantityFulfilled: 4 }, { orderId: "o1", lineId: "l1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("computes progress as the unweighted average of line progress", () => {
    expect(orders.orderProgress([
      { lineKind: "Product", quantity: 10, quantityFulfilled: 5 },
      { lineKind: "Service", completionPercentage: 100 },
    ])).toBe(75);
  });
});

describe("contract rules", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a contract edit can't mark it Signed without signatures", async () => {
    mockContractFindFirst.mockResolvedValueOnce({ id: "c1", status: "Draft", version: 1, currency: "USD" });
    mockTxContractUpdate.mockImplementation(({ data }) => ({ id: "c1", ...data }));
    await contracts.update(req({ status: "Signed", signedAt: "2026-01-01", customerSignedAt: "2026-01-01", internalNote: "x" }, { contractId: "c1" }), mockRes());

    const { data } = mockTxContractUpdate.mock.calls[0][0];
    expect(data.internalNote).toBe("x");
    for (const field of ["status", "signedAt", "customerSignedAt"]) expect(data).not.toHaveProperty(field);
  });

  it("terms are locked once the contract is out for signature; notes stay editable", async () => {
    mockContractFindFirst.mockResolvedValueOnce({ id: "c1", status: "Sent for Signature", version: 1, currency: "USD" });
    const res = mockRes();
    await contracts.update(req({ endDate: "2030-01-01" }, { contractId: "c1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("only a Signed contract can be terminated or expired", async () => {
    mockContractFindFirst.mockResolvedValueOnce({ id: "c1", status: "Draft" });
    const res = mockRes();
    await contracts.terminate(req({ reason: "Breach" }, { contractId: "c1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);

    mockContractFindFirst.mockResolvedValueOnce({ id: "c1", status: "Draft" });
    const res2 = mockRes();
    await contracts.expire(req({}, { contractId: "c1" }), res2);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(mockContractUpdate).not.toHaveBeenCalled();
  });

  it("renew extends a Signed contract's end date and records the amendment", async () => {
    mockContractFindFirst.mockResolvedValueOnce({ id: "c1", status: "Signed", endDate: new Date("2026-12-31"), amendmentHistory: [] });
    mockContractUpdate.mockImplementation(({ data }) => ({ id: "c1", ...data }));
    await contracts.renew(req({ newEndDate: "2027-12-31", note: "One more year" }, { contractId: "c1" }), mockRes());

    const { data } = mockContractUpdate.mock.calls[0][0];
    expect(data.endDate).toEqual(new Date("2027-12-31"));
    expect(data.amendmentHistory).toHaveLength(1);
    expect(data.amendmentHistory[0]).toMatchObject({ note: "One more year", newEndDate: new Date("2027-12-31").toISOString() });
  });

  it("renew rejects an end date that doesn't extend the contract", async () => {
    mockContractFindFirst.mockResolvedValueOnce({ id: "c1", status: "Signed", endDate: new Date("2026-12-31"), amendmentHistory: [] });
    const res = mockRes();
    await contracts.renew(req({ newEndDate: "2026-06-30" }, { contractId: "c1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
