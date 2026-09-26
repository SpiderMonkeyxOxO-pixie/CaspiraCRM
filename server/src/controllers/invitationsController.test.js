import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvitationFindFirst = vi.fn();
const mockTransaction = vi.fn(async (fn) => fn(tx));
const tx = {
  invitation: {
    create: vi.fn(async ({ data }) => ({ id: "inv1", status: "Pending", ...data })),
    update: vi.fn(async ({ data }) => ({ id: "inv1", status: "Pending", email: "new@example.com", ...data })),
  },
};

vi.mock("../lib/prisma.js", () => ({
  default: {
    role: { findUnique: vi.fn(async () => ({ id: "r1", key: "sales_rep", name: "Sales Rep" })) },
    organization: { findUnique: vi.fn(async () => ({ id: "o1", name: "Acme" })) },
    invitation: { findFirst: (...a) => mockInvitationFindFirst(...a), findUnique: vi.fn(async () => ({ id: "inv1", email: "new@example.com", status: "Pending" })) },
    user: { findFirst: vi.fn(async () => null) },
    $transaction: (...a) => mockTransaction(...a),
  },
}));
vi.mock("../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));
vi.mock("../services/outboxService.js", () => ({ recordOutboxEvent: vi.fn() }));
vi.mock("../middleware/rbac.js", () => ({ canGrantRole: () => true }));
vi.mock("./auth2SessionHelper.js", () => ({ issueSessionCookies: vi.fn() }));

const { createInvitation, resendInvitation, acceptInvitation } = await import("./invitationsController.js");
const { acceptJoinToken } = await import("./inviteLinksController.js");

const res = () => {
  const r = { statusCode: 200 };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const req = (body = {}, params = {}) => ({ body, params: { organizationId: "o1", ...params }, user: { id: "u1", name: "Admin", role: "Admin" }, membership: { id: "m1" } });

describe("invitations: the accept link goes back to the inviter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create returns an accept link and never the token hash", async () => {
    const r = res();
    await createInvitation(req({ email: "New@Example.com", roleId: "r1" }), r);
    expect(r.statusCode).toBe(201);
    expect(r.body.acceptUrl).toMatch(/\/invitations\/[^/]+\/accept$/);
    expect(r.body.invitation.tokenHash).toBeUndefined();
    expect(r.body.invitation.email).toBe("new@example.com");
  });

  it("resend returns a new accept link", async () => {
    mockInvitationFindFirst.mockResolvedValue({ id: "inv1", status: "Pending", organizationId: "o1", roleId: "r1", email: "new@example.com" });
    const first = res();
    await resendInvitation(req({}, { invitationId: "inv1" }), first);
    const second = res();
    await resendInvitation(req({}, { invitationId: "inv1" }), second);
    expect(first.body.acceptUrl).toMatch(/\/invitations\/[^/]+\/accept$/);
    expect(second.body.acceptUrl).not.toBe(first.body.acceptUrl);
  });
});

describe("accepting refuses a weak password before anything is used up", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invitation: weak password is a 400 and the invitation is not claimed", async () => {
    const r = res();
    await acceptInvitation({ params: { token: "t" }, body: { name: "New Person", password: "short" } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe("WEAK_PASSWORD");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("invite link: weak password is a 400 and no use of the link is claimed", async () => {
    const r = res();
    await acceptJoinToken({ params: { token: "t" }, body: { email: "new@example.com", name: "New Person", password: "passwordonly" } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe("WEAK_PASSWORD");
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
