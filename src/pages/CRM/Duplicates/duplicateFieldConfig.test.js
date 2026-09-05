import { describe, it, expect } from "vitest";
import {
  getCompareFields, compareRecords, countConflictingFields, getIdentityMeta,
  recommendMaster, detectSafetyConflicts, MARK_NOT_DUPLICATE_REASONS, buildFinalValues,
} from "./duplicateFieldConfig";

describe("duplicateFieldConfig — getCompareFields", () => {
  it("defines the exact Lead compare fields from the spec", () => {
    const keys = getCompareFields("leads").map((f) => f.label);
    expect(keys).toEqual(["Name", "Company", "Email", "Phone", "Source", "Status", "Priority", "Owner", "Estimated value", "Next follow-up", "Tags"]);
  });
  it("defines the exact Contact compare fields from the spec", () => {
    const keys = getCompareFields("contacts").map((f) => f.label);
    expect(keys).toEqual(["Name", "Company", "Job title", "Email", "Phone", "Country", "Language", "Lifecycle", "Owner", "Communication preferences", "Do-not-contact", "Tags"]);
  });
  it("defines the exact Company compare fields from the spec", () => {
    const keys = getCompareFields("companies").map((f) => f.label);
    expect(keys).toEqual(["Company name", "Domain", "Website", "Industry", "Size", "Account type", "Lifecycle", "Account tier", "Account health", "Owner", "Address", "Estimated annual value", "Tags"]);
  });
  it("defines the exact Deal compare fields from the spec", () => {
    const keys = getCompareFields("deals").map((f) => f.label);
    expect(keys).toEqual(["Deal name", "Company", "Primary Contact", "Stage", "Value", "Currency", "Probability", "Expected close", "Owner", "Products", "Next action", "Tags"]);
  });
  it("returns an empty list for an unknown record type", () => {
    expect(getCompareFields("bogus")).toEqual([]);
  });
});

describe("duplicateFieldConfig — compareRecords", () => {
  const a = { _id: "1", name: "Jordan Baxter", email: "jordan@example.com", phone: "5551234567", source: "Website", status: "New", priority: "Medium", ownerId: "u2", estimatedValue: 5000, currency: "USD", nextFollowUp: null, tags: ["warm"] };
  const b = { _id: "2", name: "Jordan Baxter", email: "jordan@other.com", phone: "", source: "Website", status: "Contacted", priority: "Medium", ownerId: "u2", estimatedValue: 5000, currency: "USD", nextFollowUp: null, tags: ["warm"] };

  it("marks a field where every record agrees as allMatch, with no blank/conflict", () => {
    const comparison = compareRecords("leads", [a, b]);
    const nameField = comparison.find((f) => f.key === "name");
    expect(nameField.allMatch).toBe(true);
    expect(nameField.hasConflict).toBe(false);
    expect(nameField.hasBlank).toBe(false);
  });

  it("marks a field with different non-blank values as a conflict", () => {
    const comparison = compareRecords("leads", [a, b]);
    const emailField = comparison.find((f) => f.key === "email");
    expect(emailField.hasConflict).toBe(true);
    expect(emailField.allMatch).toBe(false);
  });

  it("marks a field blank on at least one record as hasBlank, not a false conflict", () => {
    const comparison = compareRecords("leads", [a, b]);
    const phoneField = comparison.find((f) => f.key === "phone");
    expect(phoneField.hasBlank).toBe(true);
    expect(phoneField.hasConflict).toBe(false); // blank + one real value isn't a "conflict"
  });

  it("carries each record's display value alongside its raw value", () => {
    const comparison = compareRecords("leads", [a, b]);
    const statusField = comparison.find((f) => f.key === "status");
    expect(statusField.entries.map((e) => e.display)).toEqual(["New", "Contacted"]);
  });

  it("countConflictingFields tallies exactly the conflicting fields", () => {
    // email differs → 1 conflict; status differs → 2 conflicts total.
    expect(countConflictingFields("leads", [a, b])).toBe(2);
  });
});

describe("duplicateFieldConfig — getIdentityMeta", () => {
  it("computes completeness as the share of non-blank compare fields", () => {
    const full = { _id: "1", name: "A", companyName: "Co", email: "a@x.com", phone: "555", source: "Website", status: "New", priority: "Medium", ownerId: "u1", estimatedValue: 100, nextFollowUp: "2026-01-01", tags: ["x"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const meta = getIdentityMeta("leads", full);
    expect(meta.completenessPercent).toBe(100);
  });

  it("falls back to \"Unassigned\" when there is no owner", () => {
    const record = { _id: "1", name: "A", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    expect(getIdentityMeta("leads", record).owner).toBe("Unassigned");
  });

  it("reports the archive flag", () => {
    const record = { _id: "1", name: "A", archived: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    expect(getIdentityMeta("leads", record).archived).toBe(true);
  });
});

describe("duplicateFieldConfig — recommendMaster", () => {
  it("recommends the Active/Customer record, explaining why", () => {
    const prospect = { _id: "1", name: "A", lifecycleStage: "New", createdAt: new Date(Date.now() - 1000).toISOString(), updatedAt: new Date().toISOString() };
    const customer = { _id: "2", name: "B", lifecycleStage: "Active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const rec = recommendMaster("contacts", [prospect, customer]);
    expect(rec.recordId).toBe("2");
    expect(rec.reasons).toContain("Active Customer record");
  });

  it("always returns a recommendation with at least one reason, even with no strong signal", () => {
    const a = { _id: "1", name: "A", createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString() };
    const b = { _id: "2", name: "B", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const rec = recommendMaster("contacts", [a, b]);
    expect(["1", "2"]).toContain(rec.recordId);
    expect(rec.reasons.length).toBeGreaterThan(0);
  });

  it("never auto-selects when there is only one record — still returns a recommendation, not a merge", () => {
    const only = { _id: "1", name: "A", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const rec = recommendMaster("contacts", [only]);
    expect(rec.recordId).toBe("1");
  });
});

describe("duplicateFieldConfig — detectSafetyConflicts", () => {
  it("flags a Do Not Contact conflict between two Contacts and recommends the restrictive setting", () => {
    const a = { _id: "1", doNotContact: true };
    const b = { _id: "2", doNotContact: false };
    const conflicts = detectSafetyConflicts("contacts", [a, b]);
    expect(conflicts.consent.recommendedValue).toBe(true);
  });

  it("does not flag a consent conflict when both records agree", () => {
    const a = { _id: "1", doNotContact: false };
    const b = { _id: "2", doNotContact: false };
    expect(detectSafetyConflicts("contacts", [a, b]).consent).toBeUndefined();
  });

  it("flags a Customer-vs-Prospect lifecycle conflict and recommends preserving Customer", () => {
    const customer = { _id: "1", lifecycleStage: "Active" };
    const prospect = { _id: "2", lifecycleStage: "Prospect" };
    const conflicts = detectSafetyConflicts("companies", [customer, prospect]);
    expect(conflicts.lifecycle.recommendedValue).toBe("Active");
  });

  it("flags an owner conflict without silently picking one", () => {
    const a = { _id: "1", ownerId: "u1" };
    const b = { _id: "2", ownerId: "u2" };
    const conflicts = detectSafetyConflicts("leads", [a, b]);
    expect(conflicts.owner.ownerIds.sort()).toEqual(["u1", "u2"]);
  });

  it("flags a currency conflict for Deals only", () => {
    const a = { _id: "1", currency: "USD" };
    const b = { _id: "2", currency: "EUR" };
    expect(detectSafetyConflicts("deals", [a, b]).currency.currencies.sort()).toEqual(["EUR", "USD"]);
    expect(detectSafetyConflicts("leads", [a, b]).currency).toBeUndefined();
  });

  it("flags a converted-Lead relationship instead of treating it as two ordinary records", () => {
    const converted = { _id: "1", status: "Converted", convertedTo: { contactId: "c1" } };
    const open = { _id: "2", status: "New" };
    const conflicts = detectSafetyConflicts("leads", [converted, open]);
    expect(conflicts.convertedLead.leadId).toBe("1");
  });
});

describe("duplicateFieldConfig — buildFinalValues", () => {
  const master = { _id: "m", name: "Jordan Baxter", email: "old@example.com", ownerId: "u1", ownerName: "Dominic Wuckert", tags: ["a"] };
  const other = { _id: "o", name: "Jordan Baxter", email: "new@example.com", ownerId: "u2", ownerName: "Priya Nair", tags: ["b", "c"] };

  it("produces no changes when every field defaults to the master's own value", () => {
    expect(buildFinalValues("leads", [master, other], {}, "m")).toEqual({});
  });

  it("copies a simple field's real value when a non-master record is selected for it", () => {
    const changes = buildFinalValues("leads", [master, other], { email: "o" }, "m");
    expect(changes).toEqual({ email: "new@example.com" });
  });

  it("expands a composite field (owner) into every real property it represents", () => {
    const changes = buildFinalValues("leads", [master, other], { ownerId: "o" }, "m");
    expect(changes).toEqual({ ownerId: "u2", ownerName: "Priya Nair" });
  });

  it("expands the tags field into a real array, not the joined display string", () => {
    const changes = buildFinalValues("leads", [master, other], { tags: "o" }, "m");
    expect(changes.tags).toEqual(["b", "c"]);
  });
});

describe("duplicateFieldConfig — MARK_NOT_DUPLICATE_REASONS", () => {
  it("offers the exact suggested reasons from the spec, plus Other", () => {
    expect(MARK_NOT_DUPLICATE_REASONS).toEqual([
      "Different people", "Different Companies", "Shared phone number", "Shared domain", "Similar name only", "Separate Deals", "Other",
    ]);
  });
});
