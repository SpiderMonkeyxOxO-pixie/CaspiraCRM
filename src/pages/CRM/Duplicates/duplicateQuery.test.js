import { describe, it, expect } from "vitest";
import { resolveGroupRecords, computeGroupDerived, filterGroups, sortGroups, computeMetrics, compareTypeFor } from "./duplicateQuery";

function makeLookups() {
  const leads = new Map([["l1", { _id: "l1", name: "Jordan Baxter", email: "jordan@example.com", source: "Website" }]]);
  const contacts = new Map([
    ["c1", { _id: "c1", name: "Elena Marsh", email: "elena@example.com" }],
    ["c2", { _id: "c2", name: "Elena Marsh", email: "elena.alt@example.com" }],
  ]);
  const companies = new Map([["co1", { _id: "co1", name: "Acme Inc", source: "Import" }]]);
  const deals = new Map();
  return { leads, contacts, companies, deals };
}

function group(overrides) {
  return {
    id: "g1", recordType: "leads", mixedTypes: false, records: [{ type: "leads", id: "l1" }, { type: "contacts", id: "c1" }],
    confidencePercent: 80, confidenceLabel: "High", matchingFields: ["email"], matchingRules: ["Exact normalized email"],
    detectionSource: "Frontend Scan", detectedAt: new Date().toISOString(), reviewStatus: "Needs Review", assignedReviewer: null, reviewNotes: "",
    ...overrides,
  };
}

describe("duplicateQuery — resolveGroupRecords / computeGroupDerived", () => {
  it("resolves each { type, id } pair to its full record via the lookup maps", () => {
    const resolved = resolveGroupRecords(group(), makeLookups());
    expect(resolved).toHaveLength(2);
    expect(resolved[0].record.name).toBe("Jordan Baxter");
    expect(resolved[1].record.name).toBe("Elena Marsh");
  });

  it("silently drops a record id that no longer resolves (defensive — never crashes the table)", () => {
    const g = group({ records: [{ type: "leads", id: "l1" }, { type: "leads", id: "does-not-exist" }] });
    expect(resolveGroupRecords(g, makeLookups())).toHaveLength(1);
  });

  it("compareTypeFor uses the Contact field set for a mixed Lead+Contact group", () => {
    expect(compareTypeFor(group({ mixedTypes: true, recordType: "leads" }))).toBe("contacts");
    expect(compareTypeFor(group({ mixedTypes: false, recordType: "companies" }))).toBe("companies");
  });

  it("flags hasImportedRecord when any resolved record's source is Import", () => {
    const g = group({ records: [{ type: "companies", id: "co1" }] });
    expect(computeGroupDerived(g, makeLookups()).hasImportedRecord).toBe(true);
  });

  it("computes a conflictCount using the field-comparison engine", () => {
    const g = group({ recordType: "contacts", records: [{ type: "contacts", id: "c1" }, { type: "contacts", id: "c2" }] });
    // c1/c2 share the same name but differ in email — exactly 1 conflicting field.
    expect(computeGroupDerived(g, makeLookups()).conflictCount).toBe(1);
  });
});

describe("duplicateQuery — filterGroups", () => {
  const lookups = makeLookups();
  const groups = [
    group({ id: "g1", recordType: "leads", confidenceLabel: "High", reviewStatus: "Needs Review" }),
    group({ id: "g2", recordType: "companies", records: [{ type: "companies", id: "co1" }, { type: "leads", id: "l1" }], confidenceLabel: "Low", reviewStatus: "Not Duplicate", assignedReviewer: "u2" }),
  ];

  it("filters by record type", () => {
    expect(filterGroups(groups, { type: "companies" }, lookups).map((r) => r.group.id)).toEqual(["g2"]);
  });
  it("filters by confidence", () => {
    expect(filterGroups(groups, { confidence: "Low" }, lookups).map((r) => r.group.id)).toEqual(["g2"]);
  });
  it("filters by review status", () => {
    expect(filterGroups(groups, { status: "Not Duplicate" }, lookups).map((r) => r.group.id)).toEqual(["g2"]);
  });
  it("filters by assigned reviewer, including the special 'unassigned' value", () => {
    expect(filterGroups(groups, { reviewer: "u2" }, lookups).map((r) => r.group.id)).toEqual(["g2"]);
    expect(filterGroups(groups, { reviewer: "unassigned" }, lookups).map((r) => r.group.id)).toEqual(["g1"]);
  });
  it("filters to groups touching an imported record", () => {
    expect(filterGroups(groups, { imported: "true" }, lookups).map((r) => r.group.id)).toEqual(["g2"]);
  });
  it("filters by two-record vs multi-record groups", () => {
    const triple = group({ id: "g3", records: [{ type: "leads", id: "l1" }, { type: "contacts", id: "c1" }, { type: "contacts", id: "c2" }] });
    const all = [...groups, triple];
    expect(filterGroups(all, { recordCount: "two" }, lookups).map((r) => r.group.id).sort()).toEqual(["g1", "g2"]);
    expect(filterGroups(all, { recordCount: "multi" }, lookups).map((r) => r.group.id)).toEqual(["g3"]);
  });
  it("searches across resolved record identifiers and matching rules", () => {
    expect(filterGroups(groups, { search: "elena" }, lookups).map((r) => r.group.id)).toEqual(["g1"]);
    expect(filterGroups(groups, { search: "nonexistent-name" }, lookups)).toEqual([]);
  });
});

describe("duplicateQuery — sortGroups", () => {
  const lookups = makeLookups();
  it("sorts by confidence percent", () => {
    const rows = [
      { group: group({ id: "a", confidencePercent: 30 }), derived: computeGroupDerived(group({ id: "a" }), lookups) },
      { group: group({ id: "b", confidencePercent: 90 }), derived: computeGroupDerived(group({ id: "b" }), lookups) },
    ];
    expect(sortGroups(rows, "confidence", "desc").map((r) => r.group.id)).toEqual(["b", "a"]);
    expect(sortGroups(rows, "confidence", "asc").map((r) => r.group.id)).toEqual(["a", "b"]);
  });
  it("sorts by number of records in the group", () => {
    const rows = [
      { group: group({ id: "pair", records: [{ type: "leads", id: "l1" }, { type: "contacts", id: "c1" }] }) },
      { group: group({ id: "triple", records: [{ type: "leads", id: "l1" }, { type: "contacts", id: "c1" }, { type: "contacts", id: "c2" }] }) },
    ];
    expect(sortGroups(rows, "recordCount", "desc").map((r) => r.group.id)).toEqual(["triple", "pair"]);
  });
});

describe("duplicateQuery — computeMetrics", () => {
  it("counts groups by confidence and review status", () => {
    const groups = [
      group({ confidenceLabel: "High", reviewStatus: "Needs Review" }),
      group({ confidenceLabel: "High", reviewStatus: "Confirmed Duplicate" }),
      group({ confidenceLabel: "Low", reviewStatus: "Not Duplicate" }),
      group({ confidenceLabel: "Medium", reviewStatus: "Preview Resolved" }),
    ];
    const m = computeMetrics(groups);
    expect(m).toEqual({ total: 4, highConfidence: 2, needsReview: 1, confirmedDuplicate: 1, notDuplicate: 1, previewResolved: 1 });
  });
});
