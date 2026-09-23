import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  project: { findFirst: vi.fn() },
  task: { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ id: "t1", labels: [], predecessorLinks: [] })), create: vi.fn(), update: vi.fn(), count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
  taskBoard: { findFirst: vi.fn(), create: vi.fn() },
  taskAssignee: { create: vi.fn(), findMany: vi.fn(async () => []), update: vi.fn() },
  taskDependency: { findMany: vi.fn(async () => []), findUnique: vi.fn(), create: vi.fn() },
  taskChecklistItem: { findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn(async () => 0), create: vi.fn() },
  taskComment: { create: vi.fn(), findMany: vi.fn(async () => []) },
  taskTimeEntry: { create: vi.fn(), aggregate: vi.fn(async () => ({ _sum: { durationMinutes: 150 } })) },
  taskLabel: { create: vi.fn(), deleteMany: vi.fn() },
  projectLabel: { count: vi.fn() },
  projectActivity: { create: vi.fn() },
  projectPhase: { findFirst: vi.fn() },
  milestone: { findFirst: vi.fn() },
  organizationMembership: { findFirst: vi.fn() },
  salesDocumentCounter: { upsert: vi.fn(), update: vi.fn(async () => ({ value: 12 })) },
};
db.$transaction = vi.fn(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
vi.mock("../../lib/prisma.js", () => ({ default: db }));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));

const tasks = await import("./tasksController.js");
const { checkColumnMove } = await import("../../services/projects/boardService.js");
const { reaches } = await import("../../services/projects/projectRulesService.js");
const { commentVisibilities } = await import("../../services/projects/taskService.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const GRANTS = { tasks: ["view", "create", "edit", "assign", "transition", "archive", "bulk_actions"], project_time: ["view_own", "create"], projects: ["view", "edit"] };
const req = (body = {}, params = {}, { grants = GRANTS, membershipId = "m1" } = {}) => ({
  body, params, query: {}, organizationId: "org1", user: { id: "u1" }, isSystemOwnerOverride: false,
  membership: { id: membershipId, roles: [{ role: { defaultScope: "Organization", permissionGrants: Object.entries(grants).map(([moduleId, actions]) => ({ moduleId, actions })) } }] },
});
const COLS = [
  { id: "c1", name: "To Do", category: "Ready", active: true },
  { id: "c2", name: "In Progress", category: "In Progress", active: true, wipLimit: 2 },
  { id: "c3", name: "Review", category: "Review", active: true, requiredFields: ["estimatedMinutes"] },
  { id: "c4", name: "Done", category: "Completed", active: true, isCompletion: true },
];
const BOARD = { id: "b1", columns: COLS };
const project = (over = {}) => ({ id: "p1", organizationId: "org1", status: "Active", ownerMembershipId: "m1", members: [{ membershipId: "m1", active: true, role: "Project Manager", accessLevel: "Edit" }, { membershipId: "m2", active: true, role: "Contributor", accessLevel: "Edit" }], ...over });
const task = (over = {}) => ({ id: "t1", organizationId: "org1", projectId: "p1", title: "Build", status: "To Do", columnId: "c1", boardId: "b1", statusCategory: "Ready", version: 1, archivedAt: null, project: project(), ...over });

beforeEach(() => {
  for (const m of Object.values(db)) if (typeof m === "object") for (const fn of Object.values(m)) fn.mockClear?.();
  db.task.findFirst.mockReset();
  db.project.findFirst.mockReset();
  db.taskBoard.findFirst.mockResolvedValue(BOARD);
  db.task.count.mockResolvedValue(0);
  db.taskDependency.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
});

describe("board rules", () => {
  it("enforce WIP limits, required fields, open subtasks, blocked reasons and dependency types", () => {
    const t = { estimatedMinutes: null };
    expect(checkColumnMove(t, COLS[0], COLS[1], { wipCount: 2 })).toMatch(/work-in-progress limit of 2/);
    expect(checkColumnMove(t, COLS[1], COLS[2], {})).toMatch(/an estimate/);
    expect(checkColumnMove({ estimatedMinutes: 60 }, COLS[2], COLS[3], { openSubtasks: 1 })).toMatch(/open subtask/);
    expect(checkColumnMove({}, COLS[0], { id: "x", name: "Blocked", category: "Blocked", active: true }, {})).toMatch(/needs a reason/);
    const dep = (type, predecessorCategory) => ({ blockingDependencies: [{ type, predecessorTitle: "Design", predecessorCategory }] });
    expect(checkColumnMove({}, COLS[0], COLS[1], dep("Finish to Start", "In Progress"))).toMatch(/Finish to Start/);
    expect(checkColumnMove({}, COLS[0], COLS[1], dep("Start to Start", "In Progress"))).toBeNull();
    expect(checkColumnMove({}, COLS[2], COLS[3], dep("Finish to Finish", "Review"))).toMatch(/Finish to Finish/);
    expect(checkColumnMove({}, COLS[0], { ...COLS[1], allowedFromColumnIds: ["c3"] }, {})).toMatch(/can't move/);
  });

  it("the transition endpoint applies them (Kanban and status changes share the rules)", async () => {
    db.task.findFirst.mockResolvedValue(task());
    db.task.count.mockResolvedValueOnce(2); // WIP already full
    const res = mockRes();
    await tasks.transitionRoute(req({ status: "In Progress" }, { taskId: "t1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe("PROJECTS_TRANSITION_BLOCKED");
  });

  it("completing records the time, progress 100, and a Task Completed event", async () => {
    db.task.findFirst.mockResolvedValue(task({ status: "Review", columnId: "c3", statusCategory: "Review", estimatedMinutes: 60 }));
    await tasks.transitionRoute(req({ columnId: "c4" }, { taskId: "t1" }), mockRes());
    const data = db.task.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "Done", statusCategory: "Completed", progress: 100 });
    expect(data.completedAt).toBeInstanceOf(Date);
    expect(db.projectActivity.create.mock.calls[0][0].data).toMatchObject({ eventType: "Task Completed" });
  });
});

describe("dependencies and subtasks", () => {
  it("detects indirect loops", async () => {
    const graph = { a: ["b"], b: ["c"], c: [] };
    expect(await reaches("a", "c", async (id) => graph[id])).toBe(true);
    expect(await reaches("c", "a", async (id) => graph[id])).toBe(false);
  });

  it("rejects self-dependency, other projects and loops", async () => {
    db.task.findFirst.mockResolvedValueOnce(task());
    const self = mockRes();
    await tasks.addDependency(req({ predecessorId: "t1" }, { taskId: "t1" }), self);
    expect(self.status).toHaveBeenCalledWith(400);

    db.task.findFirst.mockResolvedValueOnce(task()).mockResolvedValueOnce({ id: "t9", projectId: "p2" });
    const cross = mockRes();
    await tasks.addDependency(req({ predecessorId: "t9" }, { taskId: "t1" }), cross);
    expect(cross.status).toHaveBeenCalledWith(400);

    // t1 → t2 already exists; making t2 a predecessor of t1 would loop.
    db.task.findFirst.mockResolvedValueOnce(task()).mockResolvedValueOnce({ id: "t2", projectId: "p1", archivedAt: null });
    db.taskDependency.findUnique.mockResolvedValue(null);
    db.taskDependency.findMany.mockImplementation(async ({ where }) => (where.predecessorId === "t1" ? [{ successorId: "t2" }] : []));
    const loop = mockRes();
    await tasks.addDependency(req({ predecessorId: "t2" }, { taskId: "t1" }), loop);
    expect(loop.status).toHaveBeenCalledWith(400);
    expect(loop.json.mock.calls[0][0].message).toMatch(/loop/);
  });

  it("a task can't become its own ancestor", async () => {
    db.task.findFirst.mockResolvedValueOnce(task()).mockResolvedValueOnce({ id: "t5", projectId: "p1" });
    db.task.findUnique.mockImplementation(async ({ where }) => (where.id === "t5" ? { parentTaskId: "t1" } : { id: "t1", labels: [], predecessorLinks: [] }));
    const res = mockRes();
    await tasks.update(req({ parentTaskId: "t5" }, { taskId: "t1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/ancestor/);
    db.task.findUnique.mockImplementation(async () => ({ id: "t1", labels: [], predecessorLinks: [] }));
  });
});

describe("tasks", () => {
  it("create gets a TASK number, the board's first column, and validated assignees", async () => {
    db.project.findFirst.mockResolvedValue(project());
    db.organizationMembership.findFirst.mockResolvedValue({ id: "m9" });
    const notMember = mockRes();
    await tasks.create(req({ title: "Kickoff", assigneeMembershipIds: ["m9"] }, { projectId: "p1" }), notMember);
    expect(notMember.status).toHaveBeenCalledWith(400); // m9 isn't on the project

    db.task.create.mockImplementation(({ data }) => ({ id: "t1", ...data }));
    await tasks.create(req({ title: "Kickoff", status: "Done", assigneeMembershipIds: ["m2"], estimateHours: 1.5 }, { projectId: "p1" }), mockRes());
    expect(db.task.create.mock.calls[0][0].data).toMatchObject({ taskNumber: expect.stringMatching(/^TASK-\d{4}-000012$/), status: "To Do", columnId: "c1", assigneeMembershipId: "m2", estimatedMinutes: 90 });
  });

  it("without assign, you can only assign yourself", async () => {
    db.project.findFirst.mockResolvedValue(project());
    const res = mockRes();
    await tasks.create(req({ title: "X", assigneeMembershipIds: ["m2"] }, { projectId: "p1" }, { grants: { tasks: ["view", "create"] } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("no new tasks on completed projects; blocked needs a reason", async () => {
    db.project.findFirst.mockResolvedValue(project({ status: "Completed" }));
    const done = mockRes();
    await tasks.create(req({ title: "Late" }, { projectId: "p1" }), done);
    expect(done.status).toHaveBeenCalledWith(400);

    db.task.findFirst.mockResolvedValue(task());
    const blockedRes = mockRes();
    await tasks.update(req({ blocked: true }, { taskId: "t1" }), blockedRes);
    expect(blockedRes.status).toHaveBeenCalledWith(400);
  });

  it("checklist edits are concurrency-protected", async () => {
    db.task.findFirst.mockResolvedValue(task());
    db.taskChecklistItem.findFirst.mockResolvedValue({ id: "i1", version: 3 });
    db.taskChecklistItem.updateMany.mockResolvedValue({ count: 0 }); // someone else changed it
    const res = mockRes();
    await tasks.updateChecklistItem(req({ completed: true }, { taskId: "t1", itemId: "i1" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("restricted comments are only for managers/auditors; contributors can't post them", async () => {
    expect(commentVisibilities(req({}, {}, { grants: { projects: ["view"] }, membershipId: "m2" }), project())).toEqual(["Project Team", "Customer Visible"]);
    db.project.findFirst.mockResolvedValue(project());
    const res = mockRes();
    await tasks.addComment(req({ body: "Pricing concern", visibility: "Restricted Management" }, { projectId: "p1" }, { grants: { projects: ["view"] }, membershipId: "m2" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("the frontend's time log records a Submitted entry and recomputes logged hours", async () => {
    db.task.findFirst.mockResolvedValue(task());
    await tasks.logTime(req({ hours: 2.5, note: "Setup", author: "Someone Else" }, { taskId: "t1" }), mockRes());
    expect(db.taskTimeEntry.create.mock.calls[0][0].data).toMatchObject({ durationMinutes: 150, status: "Submitted", authorMembershipId: "m1", source: "Manual" });
    expect(db.task.update.mock.calls[0][0].data).toEqual({ loggedHours: 2.5 });
    const res = mockRes();
    await tasks.logTime(req({ hours: 30 }, { taskId: "t1" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("bulk needs the action's own permission", async () => {
    const res = mockRes();
    await tasks.bulk(req({ action: "archive", taskIds: ["t1"] }, { projectId: "p1" }, { grants: { tasks: ["view", "bulk_actions"] } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
