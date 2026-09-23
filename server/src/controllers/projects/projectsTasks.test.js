import { describe, it, expect, vi, beforeEach } from "vitest";

const mockProjectFindFirst = vi.fn();
const mockProjectCreate = vi.fn();
const mockProjectUpdate = vi.fn();
const mockTaskFindFirst = vi.fn();
const mockTaskFindUnique = vi.fn();
const mockTaskCreate = vi.fn();
const mockTaskUpdate = vi.fn();
const mockMilestoneUpdate = vi.fn();
const mockTimeCreate = vi.fn();
const mockMemberFindFirst = vi.fn();

vi.mock("../../lib/prisma.js", () => ({
  default: {
    project: {
      findFirst: (...a) => mockProjectFindFirst(...a), findUnique: vi.fn(async () => ({ id: "p1" })),
      create: (...a) => mockProjectCreate(...a), update: (...a) => mockProjectUpdate(...a),
    },
    task: {
      findFirst: (...a) => mockTaskFindFirst(...a), findUnique: (...a) => mockTaskFindUnique(...a),
      create: (...a) => mockTaskCreate(...a), update: (...a) => mockTaskUpdate(...a),
    },
    milestone: { create: vi.fn(), update: (...a) => mockMilestoneUpdate(...a) },
    taskComment: { create: vi.fn() },
    taskTimeEntry: { create: (...a) => mockTimeCreate(...a) },
    company: { findFirst: vi.fn(async () => ({ id: "co1" })) },
    deal: { findFirst: vi.fn() },
    organizationMembership: { findFirst: (...a) => mockMemberFindFirst(...a) },
    $transaction: vi.fn(async (arg) => arg),
  },
}));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));

const projects = await import("./projectsController.js");
const tasks = await import("./tasksController.js");
const { createsDependencyCycle } = await import("../../services/projects/projectRulesService.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const ALL = ["view", "create", "edit", "assign"];
const req = (body, params = {}, { scope = "Organization", actions = ALL } = {}) => ({
  body, params, query: {}, organizationId: "org1", user: { id: "u1" }, isSystemOwnerOverride: false,
  membership: {
    id: "m1",
    roles: [{ role: { defaultScope: scope, permissionGrants: [{ moduleId: "projects", actions }, { moduleId: "tasks", actions }] } }],
  },
});

// Project tests moved to projectsLifecycle.test.js (full spec).

describe("tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemberFindFirst.mockResolvedValue({ id: "m2" });
    mockTaskFindUnique.mockResolvedValue({ id: "t1" });
  });

  it("create always starts To Do and ignores logged hours / status from the client", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1", status: "Active" });
    mockTaskCreate.mockImplementation(({ data }) => ({ id: "t1", ...data }));
    await tasks.create(req({ projectId: "p1", title: "Kickoff", status: "Done", loggedHours: 99, estimateHours: "4" }), mockRes());
    const { data } = mockTaskCreate.mock.calls[0][0];
    expect(data).toMatchObject({ title: "Kickoff", status: "To Do", organizationId: "org1", estimateHours: 4, priority: "Medium" });
    expect(data).not.toHaveProperty("loggedHours");
  });

  it("without assign, a new task can only be assigned to yourself", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1", status: "Active" });
    const res = mockRes();
    await tasks.create(req({ projectId: "p1", title: "T", assigneeMembershipId: "m2" }, {}, { actions: ["view", "create", "edit"] }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("won't add tasks to a completed project", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: "p1", status: "Completed" });
    const res = mockRes();
    await tasks.create(req({ projectId: "p1", title: "T" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("can't be marked Done while the task it depends on isn't", async () => {
    mockTaskFindFirst.mockResolvedValue({ id: "t1", projectId: "p1", status: "Review", dependsOnId: "t0", version: 1 });
    mockTaskFindUnique.mockResolvedValueOnce({ title: "Design", status: "In Progress" });
    const res = mockRes();
    await tasks.update(req({ status: "Done" }, { taskId: "t1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe("PROJECTS_DEPENDENCY_BLOCKED");
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it("marking Done records completedAt", async () => {
    mockTaskFindFirst.mockResolvedValue({ id: "t1", projectId: "p1", status: "Review", dependsOnId: null, version: 1 });
    await tasks.update(req({ status: "Done" }, { taskId: "t1" }), mockRes());
    expect(mockTaskUpdate.mock.calls[0][0].data).toMatchObject({ status: "Done" });
    expect(mockTaskUpdate.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
  });

  it("rejects a dependency on a task in another project", async () => {
    mockTaskFindFirst
      .mockResolvedValueOnce({ id: "t1", projectId: "p1", status: "To Do", dependsOnId: null, version: 1 })
      .mockResolvedValueOnce({ id: "t9", projectId: "p2" });
    const res = mockRes();
    await tasks.update(req({ dependsOnId: "t9" }, { taskId: "t1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("detects dependency loops", async () => {
    const chain = { b: { id: "b", dependsOnId: "c" }, c: { id: "c", dependsOnId: "a" } };
    const find = async (id) => chain[id] || null;
    expect(await createsDependencyCycle("a", "b", find)).toBe(true);
    expect(await createsDependencyCycle("x", "b", find)).toBe(false);
  });

  it("logging time adds an entry and increments loggedHours server-side; bad hours are rejected", async () => {
    mockTaskFindFirst.mockResolvedValue({ id: "t1", version: 1 });
    await tasks.logTime(req({ hours: "2.5", note: "Setup", author: "Someone Else" }, { taskId: "t1" }), mockRes());
    expect(mockTimeCreate.mock.calls[0][0].data).toMatchObject({ hours: 2.5, note: "Setup", authorMembershipId: "m1" });
    expect(mockTaskUpdate.mock.calls[0][0].data.loggedHours).toEqual({ increment: 2.5 });

    const res = mockRes();
    await tasks.logTime(req({ hours: 80 }, { taskId: "t1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
