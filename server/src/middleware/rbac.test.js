import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
vi.mock("../lib/prisma.js", () => ({
  default: { organizationMembership: { findUnique: (...args) => mockFindUnique(...args) } },
}));

const { requireOrgPermission, requireCrmOrgPermission, canGrantRole } = await import("./rbac.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("canGrantRole", () => {
  it("System Owner can grant any role, including admin/super_admin", () => {
    expect(canGrantRole("Super-Admin", "admin")).toBe(true);
    expect(canGrantRole("Super-Admin", "super_admin")).toBe(true);
  });

  it("an ordinary Organization Administrator cannot grant admin or super_admin", () => {
    expect(canGrantRole("Admin", "admin")).toBe(false);
    expect(canGrantRole("Admin", "super_admin")).toBe(false);
  });

  it("an ordinary role can grant a non-privileged role like checker or user", () => {
    expect(canGrantRole("Admin", "checker")).toBe(true);
    expect(canGrantRole("Admin", "user")).toBe(true);
  });
});

describe("requireOrgPermission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets System Owner through without any membership", async () => {
    mockFindUnique.mockResolvedValue(null);
    const req = { params: { organizationId: "org-1" }, user: { role: "Super-Admin" } };
    const next = vi.fn();
    await requireOrgPermission("organizations", "view")(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.isSystemOwnerOverride).toBe(true);
  });

  it("still attaches System Owner's own active membership, when they have one, for attribution", async () => {
    mockFindUnique.mockResolvedValue({ id: "m-owner", status: "Active", roles: [] });
    const req = { params: { organizationId: "org-1" }, user: { id: "u-owner", role: "Super-Admin" } };
    const next = vi.fn();
    await requireOrgPermission("organizations", "view")(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.membership?.id).toBe("m-owner");
    expect(req.isSystemOwnerOverride).toBe(true);
  });

  it("404s (not 403) when the caller has no membership at all — never confirms the org exists", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = mockRes();
    const next = vi.fn();
    await requireOrgPermission("organizations", "view")({ params: { organizationId: "org-1" }, user: { role: "User", id: "u1" } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("403s a suspended member instead of a generic 404", async () => {
    mockFindUnique.mockResolvedValue({ status: "Suspended", roles: [] });
    const res = mockRes();
    const next = vi.fn();
    await requireOrgPermission("organizations", "view")({ params: { organizationId: "org-1" }, user: { role: "User", id: "u1" } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("403s an active member whose role grants don't include the requested action", async () => {
    mockFindUnique.mockResolvedValue({ status: "Active", roles: [{ role: { permissionGrants: [{ moduleId: "organizations", actions: ["view"] }] } }] });
    const res = mockRes();
    const next = vi.fn();
    await requireOrgPermission("organizations", "edit")({ params: { organizationId: "org-1" }, user: { role: "User", id: "u1" } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows an active member whose role grants include the requested action", async () => {
    mockFindUnique.mockResolvedValue({ status: "Active", roles: [{ role: { permissionGrants: [{ moduleId: "organizations", actions: ["view", "edit"] }] } }] });
    const req = { params: { organizationId: "org-1" }, user: { role: "User", id: "u1" } };
    const next = vi.fn();
    await requireOrgPermission("organizations", "edit")(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.isSystemOwnerOverride).toBe(false);
  });
});

describe("requireCrmOrgPermission — no :organizationId path segment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("400s when no organizationId is found anywhere (query, body, or header)", async () => {
    const res = mockRes();
    const next = vi.fn();
    await requireCrmOrgPermission("leads", "view")({ query: {}, body: {}, headers: {}, user: { role: "User", id: "u1" } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("reads organizationId from the query string on a GET-shaped request and authorizes it exactly like the path-based version", async () => {
    mockFindUnique.mockResolvedValue({ status: "Active", roles: [{ role: { permissionGrants: [{ moduleId: "leads", actions: ["view"] }] } }] });
    const req = { query: { organizationId: "org-1" }, body: {}, headers: {}, user: { role: "User", id: "u1" } };
    const next = vi.fn();
    await requireCrmOrgPermission("leads", "view")(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.organizationId).toBe("org-1");
    expect(mockFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId_userId: { organizationId: "org-1", userId: "u1" } } }));
  });

  it("reads organizationId from the request body on a mutation", async () => {
    mockFindUnique.mockResolvedValue({ status: "Active", roles: [{ role: { permissionGrants: [{ moduleId: "leads", actions: ["create"] }] } }] });
    const req = { query: {}, body: { organizationId: "org-2", name: "New Lead" }, headers: {}, user: { role: "User", id: "u1" } };
    const next = vi.fn();
    await requireCrmOrgPermission("leads", "create")(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.organizationId).toBe("org-2");
  });

  it("still 404s (not 403) for a caller with no membership — same non-enumeration guarantee as the path-based version", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = mockRes();
    const next = vi.fn();
    await requireCrmOrgPermission("leads", "view")({ query: { organizationId: "org-1" }, body: {}, headers: {}, user: { role: "User", id: "u1" } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("still lets System Owner through without any membership", async () => {
    mockFindUnique.mockResolvedValue(null);
    const req = { query: { organizationId: "org-1" }, body: {}, headers: {}, user: { role: "Super-Admin" } };
    const next = vi.fn();
    await requireCrmOrgPermission("leads", "view")(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.membership).toBeNull();
    expect(req.isSystemOwnerOverride).toBe(true);
  });
});
