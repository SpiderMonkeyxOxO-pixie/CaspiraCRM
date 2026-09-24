import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const D = (v) => new Prisma.Decimal(v);
const empty = () => vi.fn(async () => []);
const db = {
  organizationMembership: { findUnique: vi.fn() },
  journalEntry: { findMany: empty() },
  invoice: { findMany: empty() },
  vendorBill: { findMany: empty() },
  payment: { findMany: empty() },
  creditNote: { findMany: empty() },
  expense: { findMany: empty() },
  expenseReport: { findMany: empty() },
  budgetVersion: { findMany: empty() },
  reconciliationSession: { findMany: empty() },
};
vi.mock("../../lib/prisma.js", () => ({ default: db }));

const { workQueue } = await import("./financeQueueController.js");
const { myAccess } = await import("./ledgerSetupController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const member = (grants, id = "m1") => ({ id, status: "Active", roles: [{ role: { name: "Role", defaultScope: "Organization", permissionGrants: Object.entries(grants).map(([moduleId, actions]) => ({ moduleId, actions })) } }] });
const req = (grants, id) => ({ query: { organizationId: "org1" }, organizationId: "org1", user: { id: "u1", role: "User" }, isSystemOwnerOverride: false, membership: member(grants, id) });

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockClear?.();
});

describe("finance access", () => {
  it("returns the member's finance grants only; non-members get 404", async () => {
    db.organizationMembership.findUnique.mockResolvedValueOnce(member({ journals: ["view", "post"], deals: ["view"] }));
    const res = mockRes();
    await myAccess({ query: { organizationId: "org1" }, user: { id: "u1", role: "User" } }, res);
    const out = res.json.mock.calls[0][0];
    expect(out.access.journals).toEqual(["view", "post"]);
    expect(out.access).not.toHaveProperty("deals");
    db.organizationMembership.findUnique.mockResolvedValueOnce(null);
    const none = mockRes();
    await myAccess({ query: { organizationId: "org1" }, user: { id: "u2", role: "User" } }, none);
    expect(none.status).toHaveBeenCalledWith(404);
  });
});

describe("work queue", () => {
  it("shows only sections the caller can view, with only the actions they hold", async () => {
    db.payment.findMany.mockResolvedValueOnce([{ id: "p1", paymentNumber: "PAY-1", direction: "Incoming", method: "Cash", amount: D(50), currency: "USD", status: "Approved", createdByMembershipId: "m2", date: new Date() }]);
    const res = mockRes();
    await workQueue(req({ payments: ["view", "post"] }), res);
    const { queue } = res.json.mock.calls[0][0];
    expect(Object.keys(queue)).toEqual(["payments"]);
    expect(queue.payments[0]).toMatchObject({ number: "PAY-1", actions: ["post"], ownRecord: false, amount: 50 });
    expect(db.journalEntry.findMany).not.toHaveBeenCalled();
  });

  it("flags the caller's own records (someone else must approve)", async () => {
    db.invoice.findMany.mockResolvedValueOnce([{ id: "i1", invoiceNumber: "INV-1", total: D(10), currency: "USD", status: "Draft", createdByMembershipId: "m1", issueDate: new Date(), company: null }]);
    const res = mockRes();
    await workQueue(req({ invoices: ["view", "approve"] }), res);
    expect(res.json.mock.calls[0][0].queue.invoices[0]).toMatchObject({ ownRecord: true, actions: ["approve"] });
  });
});
