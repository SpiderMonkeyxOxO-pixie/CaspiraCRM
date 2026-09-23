import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = {
  project: { findFirst: vi.fn() },
  task: { findFirst: vi.fn(), update: vi.fn() },
  taskTimeEntry: { findFirst: vi.fn(), findMany: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn(async () => ({ id: "e1" })), aggregate: vi.fn(async () => ({ _sum: { durationMinutes: 0 } })) },
  workTimer: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  projectActivity: { create: vi.fn() },
};
db.$transaction = vi.fn(async (arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));
vi.mock("../../lib/prisma.js", () => ({ default: db }));
vi.mock("../../services/auditService.js", () => ({ recordAuditEvent: vi.fn(), requestContext: () => ({}) }));

const time = await import("./timeController.js");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
const GRANTS = { project_time: ["view_own", "view_team", "create", "submit", "approve", "correct"], projects: ["view", "edit"] };
const req = (body = {}, params = {}, membershipId = "m1") => ({
  body, params, query: {}, organizationId: "org1", user: { id: "u1" }, isSystemOwnerOverride: false,
  membership: { id: membershipId, roles: [{ role: { defaultScope: "Organization", permissionGrants: Object.entries(GRANTS).map(([moduleId, actions]) => ({ moduleId, actions })) } }] },
});
const PROJECT = { id: "p1", status: "Active", ownerMembershipId: "m1", members: [{ membershipId: "m1", role: "Project Manager", active: true, accessLevel: "Edit" }] };
const entry = (over = {}) => ({ id: "e1", projectId: "p1", taskId: null, authorMembershipId: "m2", status: "Submitted", durationMinutes: 60, version: 2, workDate: new Date("2026-09-24"), project: PROJECT, ...over });

beforeEach(() => {
  for (const m of Object.values(db)) if (typeof m === "object") for (const fn of Object.values(m)) fn.mockClear?.();
  db.taskTimeEntry.findMany.mockResolvedValue([]);
  db.taskTimeEntry.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.useRealTimers());

describe("time entries", () => {
  it("validate duration and ranges; overlapping ranges are refused", async () => {
    db.project.findFirst.mockResolvedValue(PROJECT);
    const zero = mockRes();
    await time.createEntry(req({ projectId: "p1", workDate: "2026-09-24", durationMinutes: 0 }), zero);
    expect(zero.status).toHaveBeenCalledWith(400);
    const backwards = mockRes();
    await time.createEntry(req({ projectId: "p1", workDate: "2026-09-24", startTime: "2026-09-24T10:00:00Z", endTime: "2026-09-24T09:00:00Z" }), backwards);
    expect(backwards.status).toHaveBeenCalledWith(400);

    db.taskTimeEntry.findMany.mockResolvedValue([{ id: "x", startTime: new Date("2026-09-24T09:30:00Z"), endTime: new Date("2026-09-24T11:00:00Z"), durationMinutes: 90 }]);
    const overlap = mockRes();
    await time.createEntry(req({ projectId: "p1", workDate: "2026-09-24", startTime: "2026-09-24T10:00:00Z", endTime: "2026-09-24T12:00:00Z" }), overlap);
    expect(overlap.status).toHaveBeenCalledWith(400);
    expect(overlap.json.mock.calls[0][0].message).toMatch(/overlaps/);
  });

  it("new entries are Drafts of your own time", async () => {
    db.project.findFirst.mockResolvedValue(PROJECT);
    db.taskTimeEntry.create.mockImplementation(({ data }) => ({ id: "e9", ...data }));
    await time.createEntry(req({ projectId: "p1", workDate: "2026-09-24", hours: 1.5, status: "Approved", authorMembershipId: "someone" }), mockRes());
    expect(db.taskTimeEntry.create.mock.calls[0][0].data).toMatchObject({ status: "Draft", authorMembershipId: "m1", durationMinutes: 90 });
  });

  it("nobody approves their own time; rejection needs a reason", async () => {
    db.taskTimeEntry.findFirst.mockResolvedValue(entry({ authorMembershipId: "m1" }));
    const self = mockRes();
    await time.approveEntry(req({}, { entryId: "e1" }), self);
    expect(self.status).toHaveBeenCalledWith(403);
    expect(self.json.mock.calls[0][0].code).toBe("PROJECTS_SEPARATION_OF_DUTIES");

    const noReason = mockRes();
    await time.rejectEntry(req({}, { entryId: "e1" }), noReason);
    expect(noReason.status).toHaveBeenCalledWith(400);
  });

  it("approval is version-checked (a concurrent decision wins once)", async () => {
    db.taskTimeEntry.findFirst.mockResolvedValue(entry());
    db.taskTimeEntry.updateMany.mockResolvedValue({ count: 0 });
    const res = mockRes();
    await time.approveEntry(req({}, { entryId: "e1" }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("approved time is immutable; corrections are linked entries with a reason", async () => {
    db.taskTimeEntry.findFirst.mockResolvedValue(entry({ status: "Approved", authorMembershipId: "m1" }));
    const edit = mockRes();
    await time.updateEntry(req({ durationMinutes: 30 }, { entryId: "e1" }), edit);
    expect(edit.status).toHaveBeenCalledWith(400);

    db.taskTimeEntry.create.mockImplementation(({ data }) => ({ id: "c1", ...data }));
    await time.correctEntry(req({ adjustmentMinutes: -15, reason: "Double-counted standup" }, { entryId: "e1" }), mockRes());
    expect(db.taskTimeEntry.create.mock.calls[0][0].data).toMatchObject({ correctsEntryId: "e1", durationMinutes: -15, status: "Submitted", source: "Correction" });
    const tooMuch = mockRes();
    await time.correctEntry(req({ adjustmentMinutes: -90, reason: "x" }, { entryId: "e1" }), tooMuch);
    expect(tooMuch.status).toHaveBeenCalledWith(400);
  });
});

describe("timers", () => {
  it("run on the server clock; starting again is idempotent; one active timer", async () => {
    db.project.findFirst.mockResolvedValue(PROJECT);
    db.workTimer.findFirst.mockResolvedValue({ id: "w1", projectId: "p1", taskId: null, state: "Running", accumulatedSeconds: 0, lastResumedAt: new Date() });
    const same = mockRes();
    await time.startTimer(req({ projectId: "p1", startedAt: "1999-01-01" }), same);
    expect(same.json.mock.calls[0][0].timer._id).toBe("w1");
    expect(db.workTimer.create).not.toHaveBeenCalled();

    db.workTimer.findFirst.mockResolvedValue({ id: "w1", projectId: "p-other", taskId: null, state: "Running", accumulatedSeconds: 0, lastResumedAt: new Date() });
    const other = mockRes();
    await time.startTimer(req({ projectId: "p1" }), other);
    expect(other.status).toHaveBeenCalledWith(409);
  });

  it("stopping creates a Draft entry from server time, ignoring client values", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T10:45:00Z"));
    db.workTimer.findFirst.mockResolvedValue({ id: "w1", projectId: "p1", taskId: "t1", state: "Running", startedAt: new Date("2026-09-24T09:00:00Z"), lastResumedAt: new Date("2026-09-24T10:00:00Z"), accumulatedSeconds: 1800 });
    db.taskTimeEntry.create.mockImplementation(({ data }) => ({ id: "e5", ...data }));
    db.workTimer.update.mockImplementation(({ data }) => ({ id: "w1", ...data }));
    await time.stopTimer(req({ durationMinutes: 999, elapsedSeconds: 99999 }, { timerId: "w1" }), mockRes());
    expect(db.taskTimeEntry.create.mock.calls[0][0].data).toMatchObject({ durationMinutes: 75, status: "Draft", source: "Timer" }); // 30 + 45 minutes
  });
});
