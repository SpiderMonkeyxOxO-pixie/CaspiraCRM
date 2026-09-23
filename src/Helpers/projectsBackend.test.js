import { describe, it, expect } from "vitest";
import { toUiProject, toUiTask, toApiProject, toApiTask, BACKEND_ENABLED } from "./projectsBackend";

describe("projectsBackend shape translation", () => {
  it("is off under test regardless of the developer's .env", () => {
    expect(BACKEND_ENABLED).toBe(false);
  });

  const owners = new Map([["m1", { id: "m1", name: "Sam Rep" }]]);

  it("maps a project's company and owner membership onto names", () => {
    const ui = toUiProject({ _id: "p1", name: "Rollout", ownerMembershipId: "m1", company: { _id: "co1", name: "Northwind" } }, owners);
    expect(ui).toMatchObject({ companyName: "Northwind", owner: "Sam Rep", ownerId: "m1", milestones: [] });
  });

  it("maps a task's comments and time log back onto the UI arrays", () => {
    const ui = toUiTask(
      {
        _id: "t1", assigneeMembershipId: "m1", dependsOnId: "t0",
        commentEntries: [{ _id: "c1", body: "Started", authorMembershipId: "m1", createdAt: "2026-09-01T00:00:00.000Z" }],
        timeLog: [{ _id: "e1", hours: 1.5, note: null, authorMembershipId: "m9", createdAt: "2026-09-01T01:00:00.000Z" }],
      },
      owners,
    );
    expect(ui).toMatchObject({ assignee: "Sam Rep", assigneeId: "m1", dependsOn: "t0" });
    expect(ui.comments).toEqual([{ _id: "c1", message: "Started", author: "Sam Rep", at: "2026-09-01T00:00:00.000Z" }]);
    expect(ui.timeEntries).toEqual([{ _id: "e1", hours: 1.5, note: "", author: "Member", at: "2026-09-01T01:00:00.000Z" }]);
    expect(toUiTask({ _id: "t2" }, owners).assignee).toBeNull();
  });

  it("sends only real fields (never names or server-kept values), with ids renamed", () => {
    expect(toApiProject({ name: "P", companyName: "X", owner: "Sam", ownerId: "", dueDate: "", completedAt: "x" })).toEqual({
      name: "P", dueDate: null, ownerMembershipId: null,
    });
    expect(toApiTask({ title: "T", assignee: "Sam", assigneeId: "m1", loggedHours: 9, comments: [], dependsOn: "t0", estimateHours: 4 })).toEqual({
      title: "T", estimateHours: 4, assigneeMembershipId: "m1", dependsOnId: "t0",
    });
  });
});
