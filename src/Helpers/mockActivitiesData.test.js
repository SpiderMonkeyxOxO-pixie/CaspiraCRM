import { describe, it, expect, vi } from "vitest";
import {
  createActivityRecord,
  updateActivityRecord,
  completeActivityRecord,
  rescheduleActivityRecord,
  cancelActivityRecord,
  reopenActivityRecord,
  createFollowUpForActivity,
  queryActivitiesLocal,
  findConflicts,
  effectiveStatus,
  isDoNotContact,
  activities,
} from "./mockActivitiesData";
import { contacts } from "./mockCrmData";

describe("mockActivitiesData", () => {
  it("createActivityRecord stamps createdAt as \"now\", not a random past fixture date (regression)", () => {
    const before = Date.now();
    const activity = createActivityRecord({ type: "Task", title: "Freshly created task" }, "Tester");
    const createdAtMs = new Date(activity.createdAt).getTime();
    expect(createdAtMs).toBeGreaterThanOrEqual(before - 1000);
    expect(createdAtMs).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("effectiveStatus derives Overdue from a past due/start date rather than storing it", () => {
    const overdue = createActivityRecord({ type: "Follow-up", title: "Should be overdue", dueDate: new Date(Date.now() - 86400000).toISOString(), status: "Scheduled" }, "Tester");
    expect(overdue.status).toBe("Scheduled"); // never stored as "Overdue"
    expect(effectiveStatus(overdue)).toBe("Overdue");

    const completed = createActivityRecord({ type: "Task", title: "Completed late task", dueDate: new Date(Date.now() - 86400000).toISOString(), status: "Completed" }, "Tester");
    expect(effectiveStatus(completed)).toBe("Completed");
  });

  it("createActivityRecord logs Notes as already-completed activity records", () => {
    const note = createActivityRecord({ type: "Note", title: "A quick note", description: "Some content" }, "Tester");
    expect(note.status).toBe("Completed");
    expect(note.completedBy).toBe("Tester");
    expect(note.completedAt).toBeTruthy();
  });

  it("updateActivityRecord logs a field-level audit entry with primitive before/after values (no circular structure)", () => {
    const activity = createActivityRecord({ type: "Task", title: "Audit field test" }, "Tester");
    const updated = updateActivityRecord(activity._id, { title: "Renamed task" }, "Tester");
    const entry = updated.auditLog.find((e) => e.field === "title");
    expect(entry).toBeTruthy();
    expect(entry.after).toBe("Renamed task");
    expect(() => JSON.stringify(updated)).not.toThrow();
  });

  it("completeActivityRecord requires an outcome path to still work without one, and records completedBy/completedAt", () => {
    vi.useFakeTimers();
    try {
      const activity = createActivityRecord({ type: "Task", title: "Complete me" }, "Tester");
      vi.advanceTimersByTime(5);
      const { activity: completed, followUp } = completeActivityRecord(activity._id, { outcome: "Connected", completionNote: "Done" }, "Tester");
      expect(completed.status).toBe("Completed");
      expect(completed.outcome).toBe("Connected");
      expect(completed.completedBy).toBe("Tester");
      expect(completed.completedAt).toBeTruthy();
      expect(followUp).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("completeActivityRecord creates and links a follow-up when requested", () => {
    const activity = createActivityRecord({ type: "Call", title: "Call needing follow-up", relatedRecordType: null }, "Tester");
    const dueDate = new Date(Date.now() + 3 * 86400000).toISOString();
    const { activity: completed, followUp } = completeActivityRecord(activity._id, { outcome: "Follow-up Required", followUp: { dueDate, ownerId: "u2" } }, "Tester");
    expect(followUp).toBeTruthy();
    expect(followUp.type).toBe("Follow-up");
    expect(followUp.parentActivityId).toBe(activity._id);
    expect(completed.followUpActivityId).toBe(followUp._id);
  });

  it("createFollowUpForActivity links a follow-up without completing the parent", () => {
    const parent = createActivityRecord({ type: "Meeting", title: "Standalone meeting" }, "Tester");
    const dueDate = new Date(Date.now() + 2 * 86400000).toISOString();
    const result = createFollowUpForActivity(parent._id, { title: "Standalone follow-up", dueDate, ownerId: "u1" }, "Tester");
    expect(result.followUp.parentActivityId).toBe(parent._id);
    expect(result.activity.followUpActivityId).toBe(result.followUp._id);
    expect(parent.status).not.toBe("Completed"); // parent is untouched aside from the link
  });

  it("rescheduleActivityRecord updates the schedule and un-cancels/un-misses the activity", () => {
    const activity = createActivityRecord({ type: "Call", title: "Missed call", status: "Missed" }, "Tester");
    const newStart = new Date(Date.now() + 86400000).toISOString();
    const updated = rescheduleActivityRecord(activity._id, { startAt: newStart }, "Tester");
    expect(updated.startAt).toBe(newStart);
    expect(updated.status).toBe("Scheduled");
  });

  it("cancelActivityRecord requires the reason to be stored and does not delete the record", () => {
    const activity = createActivityRecord({ type: "Meeting", title: "To be cancelled" }, "Tester");
    const cancelled = cancelActivityRecord(activity._id, "Client rescheduled", "Tester");
    expect(cancelled.status).toBe("Cancelled");
    expect(cancelled.cancelReason).toBe("Client rescheduled");
    expect(activities.find((a) => a._id === activity._id)).toBeTruthy(); // still present, not deleted
  });

  it("reopenActivityRecord clears completion/cancellation fields and returns to Scheduled", () => {
    const activity = createActivityRecord({ type: "Task", title: "Reopen me" }, "Tester");
    cancelActivityRecord(activity._id, "test", "Tester");
    const reopened = reopenActivityRecord(activity._id, "Tester");
    expect(reopened.status).toBe("Scheduled");
    expect(reopened.cancelReason).toBeNull();
  });

  it("findConflicts detects overlapping scheduled activities for the same owner only", () => {
    const start = new Date(Date.now() + 5 * 86400000);
    const a = createActivityRecord({ type: "Call", title: "Conflict A", ownerId: "u3", startAt: start.toISOString(), endAt: new Date(start.getTime() + 30 * 60000).toISOString(), status: "Scheduled" }, "Tester");
    const b = createActivityRecord({ type: "Meeting", title: "Conflict B", ownerId: "u3", startAt: new Date(start.getTime() + 15 * 60000).toISOString(), endAt: new Date(start.getTime() + 45 * 60000).toISOString(), status: "Scheduled" }, "Tester");
    const c = createActivityRecord({ type: "Meeting", title: "Different owner", ownerId: "u4", startAt: a.startAt, endAt: a.endAt, status: "Scheduled" }, "Tester");
    const conflicts = findConflicts(a);
    expect(conflicts.map((x) => x._id)).toContain(b._id);
    expect(conflicts.map((x) => x._id)).not.toContain(c._id);
  });

  it("isDoNotContact reflects the related contact's doNotContact flag", () => {
    const dncContact = contacts.find((c) => c.doNotContact);
    expect(dncContact).toBeTruthy();
    const activity = createActivityRecord({ type: "Call", title: "DNC test", relatedRecordType: "Contact", relatedRecordId: dncContact._id }, "Tester");
    expect(isDoNotContact(activity)).toBe(true);
    const normalContact = contacts.find((c) => !c.doNotContact);
    const normalActivity = createActivityRecord({ type: "Call", title: "Normal test", relatedRecordType: "Contact", relatedRecordId: normalContact._id }, "Tester");
    expect(isDoNotContact(normalActivity)).toBe(false);
  });

  it("queryActivitiesLocal never returns more items than pageSize, regardless of total matches", () => {
    for (let i = 0; i < 5; i++) {
      createActivityRecord({ type: "Task", title: `Page sizing activity ${i} ${Date.now()}` }, "Tester");
    }
    const result = queryActivitiesLocal(activities, { search: "Page sizing activity", page: 1, pageSize: 2 });
    expect(result.activities.length).toBeLessThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(5);
  });

  it("queryActivitiesLocal filters by type and effective status", () => {
    const overdueTask = createActivityRecord({ type: "Task", title: "Filter test overdue", dueDate: new Date(Date.now() - 86400000).toISOString() }, "Tester");
    const result = queryActivitiesLocal(activities, { search: "Filter test overdue", status: "Overdue" });
    expect(result.activities.find((a) => a._id === overdueTask._id)).toBeTruthy();
  });
});
