import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  project: { findMany: vi.fn(async () => []), findFirst: vi.fn() },
  task: { findMany: vi.fn(async () => []) },
  milestone: { findMany: vi.fn(async () => []) },
  projectRisk: { findMany: vi.fn(async () => []) },
  projectIssue: { findMany: vi.fn(async () => []) },
  changeRequest: { findMany: vi.fn(async () => []) },
  deliverable: { findMany: vi.fn(async () => []), findFirst: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn(async () => ({ id: "d1", decisions: [] })) },
  deliverableDecision: { create: vi.fn() },
  projectBaseline: { findMany: vi.fn(async () => []) },
  taskTimeEntry: { groupBy: vi.fn(async () => []) },
  projectMember: { findMany: vi.fn(async () => []) },
  taskAssignee: { findMany: vi.fn(async () => []) },
  projectActivity: { create: vi.fn() },
};
db.$transaction = vi.fn(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
vi.mock("../../lib/prisma.js", () => ({ default: db }));

const reports = await import("./projectReportsController.js");
const portal = await import("./portalProjectsController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const req = (grants, scope = "Own") => ({
  query: {}, organizationId: "org1", user: { id: "u1" }, isSystemOwnerOverride: false,
  membership: { id: "m1", roles: [{ role: { defaultScope: scope, permissionGrants: Object.entries(grants).map(([moduleId, actions]) => ({ moduleId, actions })) } }] },
});

beforeEach(() => {
  for (const m of Object.values(db)) if (typeof m === "object") for (const fn of Object.values(m)) fn.mockClear?.();
});

describe("project reports", () => {
  it("apply the caller's scope before counting; time needs view_team", async () => {
    const res = mockRes();
    await reports.summary(req({ projects: ["view"], project_reports: ["view"] }), res);
    expect(db.project.findMany.mock.calls[0][0].where.OR).toBeDefined(); // narrower scope applied
    const s = res.json.mock.calls[0][0].summary;
    expect(s.effort).toMatchObject({ restricted: true });
    expect(s.taskCompletionRate).toMatchObject({ rate: null, denominator: 0 });
    expect(db.taskTimeEntry.groupBy).not.toHaveBeenCalled();
  });

  it("schedule variance names the baseline used", () => {
    expect(reports.scheduleVariance({ dueDate: new Date("2026-12-11") }, { baselineNumber: 2, snapshot: { project: { dueDate: "2026-12-01" } } })).toEqual({ baselineNumber: 2, days: 10 });
    expect(reports.scheduleVariance({ dueDate: new Date("2026-12-11") }, null)).toBeNull();
  });

  it("workload reports missing capacity instead of inventing utilization", async () => {
    db.projectMember.findMany.mockResolvedValue([{ membershipId: "m1", allocationPercent: 50 }]);
    const res = mockRes();
    await reports.workload(req({ projects: ["view"], project_reports: ["view"] }), res);
    expect(res.json.mock.calls[0][0].workload[0]).toMatchObject({ membershipId: "m1", allocationPercent: 50, capacity: "Capacity not configured", utilization: null });
    // Not organization-wide: only the caller's own line is queried.
    expect(db.projectMember.findMany.mock.calls[0][0].where).toMatchObject({ membershipId: "m1" });
  });
});

describe("portal projects", () => {
  const account = { id: "pa1", organizationId: "org1", companyId: "co1" };

  it("only the customer's company's customer-visible projects", () => {
    expect(portal.portalProjectWhere(account)).toEqual({ organizationId: "org1", companyId: "co1", customerVisible: true, archivedAt: null });
    expect(portal.portalProjectWhere({ ...account, companyId: null })).toEqual({ id: "__none__" });
  });

  it("the portal serializer never includes budget, members or internal fields", () => {
    const out = portal.serializePortalProject({ id: "p1", name: "Rollout", status: "Active", plannedBudget: 50000, ownerMembershipId: "m1", members: [], customerSummary: "On track", progressMode: "Task Count" }, [], []);
    for (const f of ["plannedBudget", "ownerMembershipId", "members"]) expect(out).not.toHaveProperty(f);
    expect(out).toMatchObject({ summary: "On track", progress: { percent: 0 } });
  });

  it("customers can only decide on deliverables awaiting their review; change requests need a comment", async () => {
    db.project.findFirst.mockResolvedValue({ id: "p1", organizationId: "org1" });
    db.deliverable.findFirst.mockResolvedValue({ id: "d1", status: "Approved Internally", version: 1, currentVersionNumber: 1 });
    const notReady = mockRes();
    await portal.acceptDeliverable({ params: { projectId: "p1", deliverableId: "d1" }, body: {}, portal: account }, notReady);
    expect(notReady.status).toHaveBeenCalledWith(400);

    db.deliverable.findFirst.mockResolvedValue({ id: "d1", status: "Ready for Customer Review", version: 1, currentVersionNumber: 1 });
    const noComment = mockRes();
    await portal.requestDeliverableChanges({ params: { projectId: "p1", deliverableId: "d1" }, body: {}, portal: account }, noComment);
    expect(noComment.status).toHaveBeenCalledWith(400);

    await portal.acceptDeliverable({ params: { projectId: "p1", deliverableId: "d1" }, body: {}, portal: account }, mockRes());
    expect(db.deliverableDecision.create.mock.calls[0][0].data).toMatchObject({ decision: "Accepted", actorType: "Customer", actorPortalAccountId: "pa1", customerVisible: true });
  });
});
