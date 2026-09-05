import { describe, it, expect } from "vitest";
import {
  levenshteinDistance, stringSimilarity, confidenceFromScore, evaluateMatch,
  findCandidateClusters, mergeScanResultsIntoGroups, recordKey,
} from "./duplicateMatching";

describe("duplicateMatching — levenshteinDistance / stringSimilarity", () => {
  it("is 0 for identical strings", () => {
    expect(levenshteinDistance("acme", "acme")).toBe(0);
    expect(stringSimilarity("Acme Inc", "Acme Inc")).toBe(1);
  });
  it("counts a single substitution/insertion/deletion as distance 1", () => {
    expect(levenshteinDistance("jon", "john")).toBe(1);
    expect(levenshteinDistance("cat", "bat")).toBe(1);
  });
  it("treats an empty string as the full length of the other string", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });
  it("stringSimilarity is case-insensitive and trims whitespace", () => {
    expect(stringSimilarity("  Acme Inc  ", "acme inc")).toBe(1);
  });
  it("stringSimilarity is low for very different strings", () => {
    expect(stringSimilarity("Acme Inc", "Totally Different Co")).toBeLessThan(0.5);
  });
});

describe("duplicateMatching — confidenceFromScore", () => {
  it("buckets below 35 as Low, 35-64 as Medium, 65+ as High", () => {
    expect(confidenceFromScore(10).label).toBe("Low");
    expect(confidenceFromScore(35).label).toBe("Medium");
    expect(confidenceFromScore(64).label).toBe("Medium");
    expect(confidenceFromScore(65).label).toBe("High");
  });
  it("caps the displayed percent at 98 — never claims absolute certainty", () => {
    expect(confidenceFromScore(500).percent).toBe(98);
  });
  it("never goes below 0", () => {
    expect(confidenceFromScore(-10).percent).toBe(0);
  });
});

describe("duplicateMatching — evaluateMatch(\"leads\"/\"contacts\", ...) person evidence", () => {
  it("returns null when nothing matches", () => {
    const a = { _id: "1", email: "a@example.com", phone: "5550001111", name: "Alice Adams", companyName: "Acme" };
    const b = { _id: "2", email: "b@example.com", phone: "5559998888", name: "Bob Baker", companyName: "Zenith" };
    expect(evaluateMatch("leads", a, b)).toBeNull();
  });

  it("an exact normalized email match alone is High confidence", () => {
    const a = { _id: "1", email: "Jordan.Baxter@Example.com", name: "Nobody Alpha" };
    const b = { _id: "2", email: "jordan.baxter@example.com", name: "Nobody Beta" };
    const match = evaluateMatch("leads", a, b);
    expect(match.matchingRules).toContain("Exact normalized email");
    expect(match.matchingFields).toEqual(["email"]);
    expect(match.confidenceLabel).toBe("High");
  });

  it("phone alone is a weaker signal than email — Medium, not High, confidence", () => {
    const a = { _id: "1", phone: "+1-555-0199", name: "Nobody Alpha" };
    const b = { _id: "2", phone: "15550199", name: "Nobody Beta" };
    const match = evaluateMatch("contacts", a, b);
    expect(match.matchingRules).toContain("Exact normalized phone");
    expect(match.confidenceLabel).toBe("Medium");
  });

  it("never matches on a contributory-only signal alone (same source), even though it's real corroborating evidence once something stronger fires", () => {
    // Regression: two unrelated people who merely share a lead source must
    // never register as a "duplicate" on that basis alone — with many
    // records sharing a small set of source values, this would otherwise
    // chain unrelated records into one giant false cluster via transitive
    // union-find during a scan.
    const a = { _id: "1", name: "Alice Adams", source: "Website" };
    const b = { _id: "2", name: "Bob Baker", source: "Website" };
    expect(evaluateMatch("leads", a, b)).toBeNull();
  });

  it("never matches two Contacts on \"same Company\" alone, with no name/email/phone signal", () => {
    const a = { _id: "1", name: "Alice Adams", companyName: "Acme Inc" };
    const b = { _id: "2", name: "Bob Baker", companyName: "Acme Inc" };
    expect(evaluateMatch("contacts", a, b)).toBeNull();
  });

  it("does not treat a phone shorter than 7 digits as a match", () => {
    const a = { _id: "1", phone: "12345", name: "A" };
    const b = { _id: "2", phone: "12345", name: "B" };
    expect(evaluateMatch("contacts", a, b)).toBeNull();
  });

  it("an exact name match combined with same Company reaches Medium confidence", () => {
    const a = { _id: "1", name: "Jon Whitfield", companyName: "Acme Manufacturing" };
    const b = { _id: "2", name: "Jon Whitfield", companyName: "Acme Manufacturing" };
    const match = evaluateMatch("contacts", a, b);
    expect(match.matchingRules).toEqual(expect.arrayContaining(["Exact full name match", "Same Company"]));
    expect(match.confidenceLabel).toBe("Medium");
  });

  it("flags a similar (not identical) name as its own, weaker rule", () => {
    const a = { _id: "1", name: "Jon Whitfield" };
    const b = { _id: "2", name: "John Whitfield" };
    const match = evaluateMatch("contacts", a, b);
    expect(match.matchingRules).toContain("Similar full name");
    expect(match.matchingRules).not.toContain("Exact full name match");
  });
});

describe("duplicateMatching — evaluateMatch(\"companies\", ...)", () => {
  it("an exact domain match is High confidence", () => {
    const a = { _id: "1", name: "Cascade Ridge Logistics", primaryDomain: "cascaderidge.example.com" };
    const b = { _id: "2", name: "Cascade Ridge Logistics LLC", primaryDomain: "cascaderidge.example.com" };
    const match = evaluateMatch("companies", a, b);
    expect(match.matchingRules).toContain("Exact domain");
    expect(match.confidenceLabel).toBe("High");
  });

  it("a similar name with no other signal is Low confidence — the canonical false-positive shape", () => {
    const a = { _id: "1", name: "Summit Retail Group", country: "United States" };
    const b = { _id: "2", name: "Summit Retail Group Inc", country: "Australia" };
    const match = evaluateMatch("companies", a, b);
    expect(match.matchingRules).toContain("Similar normalized Company name");
    expect(match.confidenceLabel).toBe("Low");
  });

  it("a shared phone number alone (no name/domain match) is a weak, Low-confidence signal", () => {
    const a = { _id: "1", name: "Bright Harbor Consulting", phone: "+1-555-0100" };
    const b = { _id: "2", name: "Coastal Ventures Partners", phone: "+1-555-0100" };
    const match = evaluateMatch("companies", a, b);
    expect(match.matchingRules).toEqual(["Same phone"]);
    expect(match.confidenceLabel).toBe("Low");
  });

  it("counts a matching website separately from an exact domain match only when domains differ or are absent", () => {
    const a = { _id: "1", name: "A", website: "https://www.example.com" };
    const b = { _id: "2", name: "B", website: "https://example.com" };
    const match = evaluateMatch("companies", a, b);
    expect(match.matchingRules).toContain("Matching website");
  });

  it("never matches two Companies on \"same country and city\" alone, with no name/domain/phone signal", () => {
    const a = { _id: "1", name: "Totally Different Name Ltd", country: "United States", city: "Austin" };
    const b = { _id: "2", name: "Something Else Entirely Co", country: "United States", city: "Austin" };
    expect(evaluateMatch("companies", a, b)).toBeNull();
  });
});

describe("duplicateMatching — evaluateMatch(\"deals\", ...) requires 2+ signals", () => {
  it("a single signal (Company alone) is not enough to flag a Deal pair", () => {
    const a = { _id: "1", name: "Totally Different Name", companyId: "co-1" };
    const b = { _id: "2", name: "Something Else Entirely", companyId: "co-1" };
    expect(evaluateMatch("deals", a, b)).toBeNull();
  });

  it("same name + same Company together reach High confidence", () => {
    const a = { _id: "1", name: "Acme — Q4 Renewal", companyId: "co-1", value: 12000 };
    const b = { _id: "2", name: "Acme — Q4 Renewal", companyId: "co-1", value: 12500 };
    const match = evaluateMatch("deals", a, b);
    expect(match.matchingRules).toEqual(expect.arrayContaining(["Same Deal name", "Same Company"]));
    expect(match.confidenceLabel).toBe("High");
  });

  it("flags similar (within 10%) values as corroborating evidence", () => {
    const a = { _id: "1", name: "Acme — Renewal", companyId: "co-1", value: 10000 };
    const b = { _id: "2", name: "Acme — Renewal", companyId: "co-1", value: 10500 };
    const match = evaluateMatch("deals", a, b);
    expect(match.matchingRules).toContain("Similar value");
  });

  it("never matches two unrelated Deals on similar value + similar close date alone — neither is a primary signal", () => {
    const a = { _id: "1", name: "Totally Different Deal", companyId: "co-1", value: 10000, expectedClosingDate: "2026-06-15" };
    const b = { _id: "2", name: "Something Else Entirely", companyId: "co-2", value: 10200, expectedClosingDate: "2026-06-20" };
    expect(evaluateMatch("deals", a, b)).toBeNull();
  });
});

describe("duplicateMatching — findCandidateClusters", () => {
  it("groups a 3-way match (A~B, B~C) into a single cluster via transitivity", () => {
    const records = [
      { _id: "a", name: "Vantage Point Consulting", primaryDomain: "vpc.example.com" },
      { _id: "b", name: "Vantage Point Consulting", primaryDomain: "vpc.example.com" },
      { _id: "c", name: "Vantage Point Consulting LLC", primaryDomain: "vpc.example.com" },
      { _id: "d", name: "Totally Unrelated Co", primaryDomain: "unrelated.example.com" },
    ];
    const clusters = findCandidateClusters("companies", records);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].records.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    expect(clusters[0].records.every((r) => r.type === "companies")).toBe(true);
  });

  it("produces no clusters when nothing matches", () => {
    const records = [
      { _id: "a", name: "Alpha Co", primaryDomain: "alpha.example.com" },
      { _id: "b", name: "Beta Co", primaryDomain: "beta.example.com" },
    ];
    expect(findCandidateClusters("companies", records)).toEqual([]);
  });

  it("excludes archived and already preview-merged records from scanning", () => {
    const records = [
      { _id: "a", name: "Same Name Co", primaryDomain: "same.example.com", archived: true },
      { _id: "b", name: "Same Name Co", primaryDomain: "same.example.com" },
      { _id: "c", name: "Same Name Co", primaryDomain: "same.example.com", previewMergedInto: "x" },
    ];
    expect(findCandidateClusters("companies", records)).toEqual([]);
  });
});

describe("duplicateMatching — mergeScanResultsIntoGroups", () => {
  const cluster = { records: [{ type: "companies", id: "a" }, { type: "companies", id: "b" }], matchingFields: ["name"], matchingRules: ["Exact Company name"], confidencePercent: 90, confidenceLabel: "High", evidence: [] };

  it("creates a new group when nothing existing overlaps", () => {
    const { groups, newGroupCount, updatedGroupCount } = mergeScanResultsIntoGroups([], "companies", [cluster], { idFactory: () => "new-1" });
    expect(newGroupCount).toBe(1);
    expect(updatedGroupCount).toBe(0);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("new-1");
    expect(groups[0].reviewStatus).toBe("New");
  });

  it("never duplicates a group whose record set exactly matches an existing group", () => {
    const existing = [{ id: "g1", recordType: "companies", records: cluster.records, reviewStatus: "Needs Review", matchingFields: [], matchingRules: [] }];
    const { groups, newGroupCount } = mergeScanResultsIntoGroups(existing, "companies", [cluster]);
    expect(newGroupCount).toBe(0);
    expect(groups).toHaveLength(1);
  });

  it("grows an existing NOT-resolved group that shares a record with the fresh cluster, instead of creating a new one", () => {
    const existing = [{ id: "g1", recordType: "companies", records: [{ type: "companies", id: "a" }, { type: "companies", id: "z" }], reviewStatus: "Needs Review", matchingFields: [], matchingRules: [] }];
    const { groups, newGroupCount, updatedGroupCount } = mergeScanResultsIntoGroups(existing, "companies", [cluster]);
    expect(newGroupCount).toBe(0);
    expect(updatedGroupCount).toBe(1);
    expect(groups[0].records.map(recordKey).sort()).toEqual(["companies:a", "companies:b", "companies:z"].sort());
  });

  it("never grows a resolved group (Not Duplicate / Preview Resolved) — creates a separate new group instead", () => {
    const existing = [{ id: "g1", recordType: "companies", records: [{ type: "companies", id: "a" }, { type: "companies", id: "z" }], reviewStatus: "Not Duplicate", matchingFields: [], matchingRules: [] }];
    const { groups, newGroupCount } = mergeScanResultsIntoGroups(existing, "companies", [cluster]);
    expect(newGroupCount).toBe(1);
    expect(groups).toHaveLength(2);
    expect(groups[0].reviewStatus).toBe("Not Duplicate"); // untouched
  });
});
