import { describe, it, expect, vi } from "vitest";
import {
  createLeadRecord,
  updateLeadRecord,
  queryLeads,
  findDuplicateLeads,
} from "./mockCrmData";

describe("mockCrmData — Leads", () => {
  it("updateLeadRecord does not produce a circular structure (regression)", () => {
    // updateLeadRecord used to log `after: { ...lead }` into lead.auditLog
    // itself. A shallow spread keeps a live reference to lead.auditLog, so
    // the pushed entry ended up containing a reference back to the array it
    // was just pushed into — a genuine circular structure. That doesn't
    // throw when building the object, only later when something (e.g. the
    // mock adapter) tries to serialize it — which silently failed every
    // lead edit after the first with a generic "Failed to update lead".
    const lead = createLeadRecord({ firstName: "Circular", lastName: "Test", email: "circular@example.com" }, "Tester");
    const updated = updateLeadRecord(lead._id, { jobTitle: "VP of Testing" }, "Tester");
    expect(() => JSON.stringify(updated)).not.toThrow();

    // A second edit re-exercises the same path with an already-populated
    // audit log, which is what actually triggered the bug in practice.
    const updatedAgain = updateLeadRecord(lead._id, { jobTitle: "Director of Testing" }, "Tester");
    expect(() => JSON.stringify(updatedAgain)).not.toThrow();
    expect(updatedAgain.jobTitle).toBe("Director of Testing");
  });

  it("updateLeadRecord persists field changes and stamps updatedBy/updatedAt", () => {
    // Both timestamps come from new Date().toISOString(); on a fast run they
    // can land in the same millisecond, so advance a fake clock between the
    // two calls rather than relying on real wall-clock time to differ.
    vi.useFakeTimers();
    try {
      const lead = createLeadRecord({ firstName: "Edit", lastName: "Persist", email: "editpersist@example.com" }, "Creator");
      const before = lead.updatedAt;
      vi.advanceTimersByTime(5);
      const updated = updateLeadRecord(lead._id, { country: "Canada" }, "Editor");
      expect(updated.country).toBe("Canada");
      expect(updated.updatedBy).toBe("Editor");
      expect(updated.updatedAt).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("updateLeadRecord logs an activity + audit entry on status change", () => {
    const lead = createLeadRecord({ firstName: "Status", lastName: "Change", email: "statuschange@example.com" }, "Tester");
    const updated = updateLeadRecord(lead._id, { status: "Attempted" }, "Tester");
    expect(updated.status).toBe("Attempted");
    expect(updated.activity.some((a) => a.type === "status_change")).toBe(true);
    expect(updated.auditLog.some((a) => a.action === "status_change")).toBe(true);
  });

  it("findDuplicateLeads matches on normalized email regardless of case/whitespace", () => {
    createLeadRecord({ firstName: "Original", lastName: "Owner", email: "  Dup.Check@Example.com  " }, "Tester");
    const matches = findDuplicateLeads({ email: "dup.check@example.com" });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].reasons).toContain("Same email address");
  });

  it("findDuplicateLeads excludes a given lead id (self-match while editing)", () => {
    const lead = createLeadRecord({ firstName: "Self", lastName: "Match", email: "selfmatch@example.com" }, "Tester");
    const matches = findDuplicateLeads({ email: "selfmatch@example.com" }, lead._id);
    expect(matches.find((m) => m.lead._id === lead._id)).toBeUndefined();
  });

  it("queryLeads never returns more items than pageSize, regardless of total matches", () => {
    for (let i = 0; i < 5; i++) {
      createLeadRecord({ firstName: `Page${i}`, lastName: "Sizing", email: `pagesizing${i}${Date.now()}@example.com`, companyName: "PageSizeCo" }, "Tester");
    }
    const result = queryLeads({ search: "PageSizeCo", page: 1, pageSize: 2 });
    expect(result.leads.length).toBeLessThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(5);
  });

  it("queryLeads summary counts are computed from the filtered set, not the full dataset", () => {
    const tag = `filtertag${Date.now()}`;
    createLeadRecord({ firstName: "Filtered", lastName: "One", email: `${tag}1@example.com`, companyName: tag, status: "New" }, "Tester");
    createLeadRecord({ firstName: "Filtered", lastName: "Two", email: `${tag}2@example.com`, companyName: tag, status: "New" }, "Tester");
    const result = queryLeads({ search: tag, page: 1, pageSize: 20 });
    expect(result.summary.total).toBe(2);
    expect(result.summary.new).toBe(2);
  });

  it("queryLeads excludes archived leads by default and includes them when archived=true", () => {
    const lead = createLeadRecord({ firstName: "Archive", lastName: "Filter", email: `archivefilter${Date.now()}@example.com` }, "Tester");
    lead.archived = true;
    lead.archiveReason = "test";
    const activeResult = queryLeads({ search: "Archive Filter" });
    expect(activeResult.leads.find((l) => l._id === lead._id)).toBeUndefined();
    const archivedResult = queryLeads({ search: "Archive Filter", archived: "true" });
    expect(archivedResult.leads.find((l) => l._id === lead._id)).toBeDefined();
  });
});
