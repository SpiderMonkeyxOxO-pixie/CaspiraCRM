import { describe, it, expect } from "vitest";
import { canTransition, isOverdue } from "./activityLifecycleService.js";

describe("canTransition", () => {
  it("allows Scheduled -> In Progress -> Completed", () => {
    expect(canTransition("Scheduled", "In Progress")).toBe(true);
    expect(canTransition("In Progress", "Completed")).toBe(true);
  });

  it("allows Completed/Cancelled -> Scheduled (reopen)", () => {
    expect(canTransition("Completed", "Scheduled")).toBe(true);
    expect(canTransition("Cancelled", "Scheduled")).toBe(true);
  });

  it("rejects an arbitrary status change that bypasses the transition table", () => {
    expect(canTransition("Completed", "In Progress")).toBe(false);
    expect(canTransition("Cancelled", "Completed")).toBe(false);
    expect(canTransition("Scheduled", "Scheduled")).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(canTransition("NotARealStatus", "Completed")).toBe(false);
  });
});

describe("isOverdue", () => {
  it("is never overdue once completed or cancelled, regardless of due date", () => {
    expect(isOverdue({ status: "Completed", dueDate: new Date(Date.now() - 100000) })).toBe(false);
    expect(isOverdue({ status: "Cancelled", dueDate: new Date(Date.now() - 100000) })).toBe(false);
  });

  it("is overdue when the due date has passed and the activity is still open", () => {
    expect(isOverdue({ status: "Scheduled", dueDate: new Date(Date.now() - 1000) })).toBe(true);
  });

  it("is not overdue when the due date is in the future", () => {
    expect(isOverdue({ status: "Scheduled", dueDate: new Date(Date.now() + 100000) })).toBe(false);
  });

  it("is not overdue when there is no deadline at all", () => {
    expect(isOverdue({ status: "Scheduled" })).toBe(false);
  });
});
