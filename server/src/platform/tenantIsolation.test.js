import { describe, it, expect, vi, beforeEach } from "vitest";

// Backend Phase 13 — tenant isolation of platform operations. Platform
// features are operator-only and cross-tenant by nature, so isolation here
// means: organization roles never confer platform access, and tenant data
// operations (retention) respect each organization's own settings and legal
// holds without touching other tenants.
const calls = { count: [], findMany: [], deleteMany: [] };
const model = {
  fields: { organizationId: {} },
  count: vi.fn(async (a) => { calls.count.push(a.where); return 2; }),
  findMany: vi.fn(async (a) => { calls.findMany.push(a.where); return calls.findMany.length % 2 ? [{ id: 1 }, { id: 2 }] : []; }),
  deleteMany: vi.fn(async (a) => { calls.deleteMany.push(a.where); return { count: a.where.id.in.length }; }),
};
const db = {
  auditEvent: { ...model, create: vi.fn() },
  retentionPolicy: { findMany: vi.fn() },
  retentionRun: { create: vi.fn(async () => ({ id: "run1" })), update: vi.fn() },
  platformRoleAssignment: { findMany: vi.fn(async () => []) },
};
vi.mock("../lib/prisma.js", () => ({ default: db }));

const { runRetention } = await import("./retention.js");
const { platformPermissionsFor } = await import("./rbac.js");

beforeEach(() => { for (const k of Object.keys(calls)) calls[k] = []; vi.clearAllMocks(); });

describe("retention respects each tenant", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  it("never purges an organization under legal hold and applies each override only to its own organization", async () => {
    db.retentionPolicy.findMany.mockResolvedValue([
      { category: "audit_events", organizationId: null, retentionDays: 365, legalHold: false },
      { category: "audit_events", organizationId: "org-held", retentionDays: 90, legalHold: true },
      { category: "audit_events", organizationId: "org-long", retentionDays: 2000, legalHold: false },
    ]);
    await runRetention("audit_events", { now });
    const [base, override] = calls.count;
    // The platform-wide purge excludes both the held and the overridden tenant.
    expect(base.AND[0].OR[1].organizationId.notIn.sort()).toEqual(["org-held", "org-long"]);
    expect(base.createdAt.lt.toISOString()).toBe(new Date(now.getTime() - 365 * 86_400_000).toISOString());
    // The override purge is scoped to exactly its organization, with its own cutoff.
    expect(override.organizationId).toBe("org-long");
    expect(override.createdAt.lt.toISOString()).toBe(new Date(now.getTime() - 2000 * 86_400_000).toISOString());
    expect(calls.count.some((w) => w.organizationId === "org-held")).toBe(false);
  });
  it("a platform-wide legal hold stops the category entirely", async () => {
    db.retentionPolicy.findMany.mockResolvedValue([{ category: "audit_events", organizationId: null, retentionDays: 365, legalHold: true }]);
    expect(await runRetention("audit_events", { now })).toEqual({ category: "audit_events", skipped: "legal hold" });
    expect(model.deleteMany).not.toHaveBeenCalled();
  });
  it("dry runs count without deleting", async () => {
    db.retentionPolicy.findMany.mockResolvedValue([]);
    const r = await runRetention("audit_events", { now, dryRun: true });
    expect(r).toMatchObject({ dryRun: true, eligible: 2, purged: 0 });
    expect(model.deleteMany).not.toHaveBeenCalled();
  });
});

describe("organization roles never grant platform access", () => {
  it.each(["Admin", "Owner", "Team Lead", "User", "Finance", undefined])("organization role %s has no platform permissions", async (role) => {
    expect((await platformPermissionsFor({ id: "u", role })).size).toBe(0);
  });
});
