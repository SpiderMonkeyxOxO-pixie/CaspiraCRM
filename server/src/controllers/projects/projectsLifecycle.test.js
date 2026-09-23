import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  project: { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ id: "p1", milestones: [], members: [] })), create: vi.fn(), update: vi.fn(), findMany: vi.fn(async () => []), count: vi.fn() },
  projectMember: { create: vi.fn(), upsert: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  projectActivity: { create: vi.fn() },
  taskBoard: { findFirst: vi.fn(async () => ({ id: "b1", columns: [{ id: "c1", name: "To Do", category: "Ready" }] })), create: vi.fn() },
  task: { findMany: vi.fn(async () => []), create: vi.fn(), updateMany: vi.fn() },
  taskAssignee: { updateMany: vi.fn() },
  deliverable: { count: vi.fn(async () => 0) },
  milestone: { update: vi.fn(), create: vi.fn() },
  organizationMembership: { findFirst: vi.fn() },
  company: { findFirst: vi.fn() },
  salesDocumentCounter: { upsert: vi.fn(), update: vi.fn(async () => ({ value: 4 })) },
};
db.$transaction = vi.fn(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
vi.mock("../../lib/prisma.js", () => ({ default: db }));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));

const ctrl = await import("./projectsController.js");
const setup = await import("./projectSetupController.js");
const { validateTemplateContent } = await import("../../services/projects/templateService.js");
const { computeProgress } = await import("../../services/projects/progressService.js");
const access = await import("../../services/projects/projectAccess.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const ALL = { projects: ["view", "create", "edit", "transition", "reopen", "archive", "restore", "manage_members", "assign", "override_progress"] };
const req = (body = {}, params = {}, { scope = "Organization", grants = ALL, membershipId = "m1" } = {}) => ({
  body, params, query: {}, organizationId: "org1", user: { id: "u1" }, isSystemOwnerOverride: false,
  membership: { id: membershipId, roles: [{ role: { defaultScope: scope, permissionGrants: Object.entries(grants).map(([moduleId, actions]) => ({ moduleId, actions })) } }] },
});
const project = (over = {}) => ({ id: "p1", organizationId: "org1", status: "Planning", version: 1, ownerMembershipId: "m1", startDate: new Date("2026-10-01"), dueDate: new Date("2026-12-01"), milestones: [], members: [{ membershipId: "m1", role: "Project Manager", active: true, accessLevel: "Edit" }], archivedAt: null, ...over });

beforeEach(() => {
  for (const m of Object.values(db)) if (typeof m === "object") for (const fn of Object.values(m)) fn.mockClear?.();
  db.project.findFirst.mockReset();
  db.$transaction.mockImplementation(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
});

describe("project lifecycle", () => {
  it("creates in Planning with a number, the creator as Project Manager member, and a default board", async () => {
    db.project.create.mockImplementation(({ data }) => ({ id: "p1", ...data }));
    await ctrl.create(req({ name: "Rollout", status: "Completed" }), mockRes());
    expect(db.project.create).not.toHaveBeenCalled(); // can't be created Completed

    db.organizationMembership.findFirst.mockResolvedValue({ id: "m1" });
    await ctrl.create(req({ name: "Rollout" }), mockRes());
    expect(db.project.create.mock.calls[0][0].data).toMatchObject({ status: "Planning", projectNumber: expect.stringMatching(/^PROJECT-\d{4}-000004$/), ownerMembershipId: "m1" });
    expect(db.projectMember.create.mock.calls[0][0].data).toMatchObject({ membershipId: "m1", role: "Project Manager" });
  });

  it("activation needs a manager, planned dates and members", async () => {
    db.project.findFirst.mockResolvedValue(project({ startDate: null, members: [] }));
    const res = mockRes();
    await ctrl.transitionRoute(req({ status: "Active" }, { projectId: "p1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/planned start and end dates/);
  });

  it("cancelling needs a reason; reopening a completed project needs the reopen grant and a reason", async () => {
    db.project.findFirst.mockResolvedValue(project({ status: "Active" }));
    const cancel = mockRes();
    await ctrl.transitionRoute(req({ status: "Cancelled" }, { projectId: "p1" }), cancel);
    expect(cancel.status).toHaveBeenCalledWith(400);

    db.project.findFirst.mockResolvedValue(project({ status: "Completed" }));
    const noGrant = mockRes();
    await ctrl.transitionRoute(req({ status: "Active", reason: "More work" }, { projectId: "p1" }, { grants: { projects: ["view", "transition"] } }), noGrant);
    expect(noGrant.status).toHaveBeenCalledWith(403);
  });

  it("completion waits for acceptance-required milestones", async () => {
    db.project.findFirst.mockResolvedValue(project({ status: "Active", milestones: [{ id: "ms1", name: "UAT sign-off", acceptanceRequired: true, status: "Planned" }] }));
    const res = mockRes();
    await ctrl.transitionRoute(req({ status: "Completed" }, { projectId: "p1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/UAT sign-off/);
  });

  it("only completed or cancelled projects are archived, with a reason; nothing is deleted", async () => {
    db.project.findFirst.mockResolvedValue(project({ status: "Active" }));
    const res = mockRes();
    await ctrl.archive(req({ reason: "Done" }, { projectId: "p1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    db.project.findFirst.mockResolvedValue(project({ status: "Completed" }));
    await ctrl.archive(req({ reason: "Delivered" }, { projectId: "p1" }), mockRes());
    expect(db.project.update.mock.calls[0][0].data).toMatchObject({ archiveReason: "Delivered", statusBeforeArchive: "Completed" });
  });

  it("budget is hidden without the financial-fields grant and can't be set", async () => {
    const out = ctrl.serializeProject(req(), { id: "p1", plannedBudget: 5000, milestones: [] });
    expect(out).not.toHaveProperty("plannedBudget");
    db.project.findFirst.mockResolvedValue(project());
    const res = mockRes();
    await ctrl.update(req({ plannedBudget: 9999 }, { projectId: "p1" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("manual progress needs a reason", async () => {
    db.project.findFirst.mockResolvedValue(project());
    const res = mockRes();
    await ctrl.setManualProgress(req({ progress: 60 }, { projectId: "p1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("narrower scopes see managed, created, member or assigned projects", () => {
    expect(access.projectScopeWhere(req({}, {}, { scope: "Own" })).OR).toContainEqual({ members: { some: { membershipId: "m1", active: true } } });
  });
});

describe("progress", () => {
  it("is explained, excludes archived/cancelled work and handles empty projects", () => {
    const tasks = [
      { statusCategory: "Completed", weight: 3 }, { statusCategory: "In Progress", weight: 1 },
      { statusCategory: "Completed", weight: 1, archivedAt: new Date() }, { statusCategory: "Cancelled", weight: 5 },
    ];
    expect(computeProgress({ progressMode: "Task Count" }, tasks)).toMatchObject({ progress: 50, basis: "1 of 2 tasks completed" });
    expect(computeProgress({ progressMode: "Weighted" }, tasks)).toMatchObject({ progress: 75 });
    expect(computeProgress({ progressMode: "Task Count" }, [])).toMatchObject({ progress: 0, basis: "No tasks yet" });
    expect(computeProgress({ progressMode: "Milestones" }, [], [{ status: "Achieved" }, { status: "Planned" }, { status: "Cancelled" }])).toMatchObject({ progress: 50 });
  });
});

describe("templates and members", () => {
  it("template content is validated, including dependency loops", () => {
    expect(validateTemplateContent({ tasks: [{ key: "a", title: "A" }, { key: "b", title: "B" }], dependencies: [{ from: "a", to: "b" }, { from: "b", to: "a" }] })).toMatch(/loop/);
    expect(validateTemplateContent({ phases: [{ name: "Build" }], tasks: [{ key: "a", title: "A", phase: "Nope" }] })).toMatch(/unknown phase/);
    expect(validateTemplateContent({ phases: [{ name: "Build" }], milestones: [{ name: "Go-live", offsetDays: 30 }], tasks: [{ key: "a", title: "A", phase: "Build", milestone: "Go-live" }] })).toBeNull();
  });

  it("members must be active in the organization; allocation is bounded", async () => {
    db.project.findFirst.mockResolvedValue(project());
    db.organizationMembership.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await setup.addMember(req({ membershipId: "suspended" }, { projectId: "p1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);

    db.organizationMembership.findFirst.mockResolvedValue({ id: "m2" });
    const alloc = mockRes();
    await setup.addMember(req({ membershipId: "m2", allocationPercent: 150 }, { projectId: "p1" }), alloc);
    expect(alloc.status).toHaveBeenCalledWith(400);
  });

  it("from-template preview creates nothing; creating needs an idempotency key", async () => {
    db.projectTemplate = { findFirst: vi.fn(async () => ({ id: "t1", name: "Onboarding", currentVersionId: "v1", projectType: "Delivery" })) };
    db.projectTemplateVersion = { findUnique: vi.fn(async () => ({ id: "v1", versionNumber: 2, content: { tasks: [{ key: "a", title: "Kickoff", offsetDays: 1 }] } })) };
    const res = mockRes();
    await setup.createFromTemplate(req({ templateId: "t1", name: "Acme onboarding", startDate: "2026-10-01", preview: true }), res);
    expect(res.json.mock.calls[0][0].preview).toMatchObject({ versionNumber: 2, tasks: [{ title: "Kickoff" }] });
    expect(db.project.create).not.toHaveBeenCalled();
    const noKey = mockRes();
    await setup.createFromTemplate(req({ templateId: "t1", name: "Acme onboarding" }), noKey);
    expect(noKey.status).toHaveBeenCalledWith(400);
  });
});
