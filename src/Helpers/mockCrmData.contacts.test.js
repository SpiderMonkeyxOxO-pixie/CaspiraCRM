import { describe, it, expect, vi } from "vitest";
import {
  createContactRecord,
  updateContactRecord,
  queryContacts,
  findDuplicateContacts,
  contactCommunicationStatus,
} from "./mockCrmData";

describe("mockCrmData — Contacts", () => {
  it("updateContactRecord auto-clears channel flags the moment doNotContact is set", () => {
    const contact = createContactRecord({ firstName: "Dnc", lastName: "Test", email: "dnctest@example.com" }, "Tester");
    expect(contact.emailAllowed).toBe(true);
    const updated = updateContactRecord(contact._id, { doNotContact: true, doNotContactReason: "Requested" }, "Tester");
    expect(updated.doNotContact).toBe(true);
    expect(updated.emailAllowed).toBe(false);
    expect(updated.phoneAllowed).toBe(false);
    expect(updated.smsAllowed).toBe(false);
    expect(updated.marketingAllowed).toBe(false);
    expect(contactCommunicationStatus(updated)).toBe("Do Not Contact");
  });

  it("updateContactRecord persists field changes and stamps updatedBy/updatedAt", () => {
    // Both timestamps come from new Date().toISOString(); on a fast run they
    // can land in the same millisecond, so advance a fake clock between the
    // two calls rather than relying on real wall-clock time to differ.
    vi.useFakeTimers();
    try {
      const contact = createContactRecord({ firstName: "Edit", lastName: "Persist", email: "editpersist2@example.com" }, "Creator");
      const before = contact.updatedAt;
      vi.advanceTimersByTime(5);
      const updated = updateContactRecord(contact._id, { country: "Canada" }, "Editor");
      expect(updated.country).toBe("Canada");
      expect(updated.updatedBy).toBe("Editor");
      expect(updated.updatedAt).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("updateContactRecord logs a field-level audit entry with primitive before/after values (no circular structure)", () => {
    const contact = createContactRecord({ firstName: "Audit", lastName: "Field", email: "auditfield@example.com" }, "Tester");
    const updated = updateContactRecord(contact._id, { jobTitle: "VP of Testing" }, "Tester");
    const entry = updated.auditLog.find((e) => e.field === "jobTitle");
    expect(entry).toBeTruthy();
    // "before" is whatever random job title the fixture seeded — just
    // confirm it's a captured primitive string, distinct from "after".
    expect(typeof entry.before).toBe("string");
    expect(entry.after).toBe("VP of Testing");
    // Regression guard: Leads' whole-object audit snapshot created a
    // circular structure that only surfaced on serialization. Contacts use
    // field-level primitives instead — this should never throw.
    expect(() => JSON.stringify(updated)).not.toThrow();
  });

  it("updateContactRecord logs an activity entry on owner change", () => {
    const contact = createContactRecord({ firstName: "Owner", lastName: "Change", email: "ownerchange@example.com", ownerId: "u1" }, "Tester");
    const updated = updateContactRecord(contact._id, { ownerId: "u3" }, "Tester");
    expect(updated.ownerId).toBe("u3");
    expect(updated.activity.some((a) => a.type === "owner_changed")).toBe(true);
  });

  it("findDuplicateContacts matches on normalized email regardless of case/whitespace", () => {
    createContactRecord({ firstName: "Original", lastName: "Owner", email: "  Dup.Check@Example.com  " }, "Tester");
    const matches = findDuplicateContacts({ email: "dup.check@example.com" });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].reasons).toContain("Same email address");
  });

  it("findDuplicateContacts excludes a given contact id (self-match while editing)", () => {
    const contact = createContactRecord({ firstName: "Self", lastName: "Match", email: "selfmatch2@example.com" }, "Tester");
    const matches = findDuplicateContacts({ email: "selfmatch2@example.com" }, contact._id);
    expect(matches.find((m) => m.contact._id === contact._id)).toBeUndefined();
  });

  it("queryContacts never returns more items than pageSize, regardless of total matches", () => {
    for (let i = 0; i < 5; i++) {
      createContactRecord({ firstName: `Page${i}`, lastName: "Sizing", email: `pagesizingc${i}${Date.now()}@example.com`, companyName: "PageSizeCoC" }, "Tester");
    }
    const result = queryContacts({ search: "PageSizeCoC", page: 1, pageSize: 2 });
    expect(result.contacts.length).toBeLessThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(5);
  });

  it("queryContacts summary counts are computed from the filtered set, not the full dataset", () => {
    const tag = `filtertagc${Date.now()}`;
    createContactRecord({ firstName: "Filtered", lastName: "One", email: `${tag}1@example.com`, companyName: tag, relationshipType: "Prospect" }, "Tester");
    createContactRecord({ firstName: "Filtered", lastName: "Two", email: `${tag}2@example.com`, companyName: tag, relationshipType: "Prospect" }, "Tester");
    const result = queryContacts({ search: tag, page: 1, pageSize: 20 });
    expect(result.summary.total).toBe(2);
    expect(result.summary.prospects).toBe(2);
  });

  it("queryContacts excludes archived contacts by default and includes them when archived=true", () => {
    const contact = createContactRecord({ firstName: "Archive", lastName: "FilterC", email: `archivefilterc${Date.now()}@example.com` }, "Tester");
    contact.archived = true;
    contact.archiveReason = "test";
    const activeResult = queryContacts({ search: "Archive FilterC" });
    expect(activeResult.contacts.find((c) => c._id === contact._id)).toBeUndefined();
    const archivedResult = queryContacts({ search: "Archive FilterC", archived: "true" });
    expect(archivedResult.contacts.find((c) => c._id === contact._id)).toBeDefined();
  });

  it("contactCommunicationStatus reflects Active/Restricted/Do Not Contact correctly", () => {
    expect(contactCommunicationStatus({ doNotContact: false, emailAllowed: true, phoneAllowed: false, smsAllowed: false })).toBe("Active");
    expect(contactCommunicationStatus({ doNotContact: false, emailAllowed: false, phoneAllowed: false, smsAllowed: false })).toBe("Restricted");
    expect(contactCommunicationStatus({ doNotContact: true, emailAllowed: false, phoneAllowed: false, smsAllowed: false })).toBe("Do Not Contact");
  });
});
