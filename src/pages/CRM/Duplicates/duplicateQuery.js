// Pure filter/sort helpers over the duplicate-group list — kept separate
// from the page component so search/filter/sort behavior is directly
// unit-testable without rendering React.
import { countConflictingFields } from "./duplicateFieldConfig";

export function resolveGroupRecords(group, lookups) {
  return group.records
    .map((r) => ({ type: r.type, id: r.id, record: lookups[r.type]?.get(r.id) }))
    .filter((x) => !!x.record);
}

// A mixed-type group (Lead matching an existing Contact) is compared using
// the Contact field set — the richer "target" identity — so conflict
// counting and display both need a single concrete type to compare against.
export function compareTypeFor(group) {
  return group.mixedTypes ? "contacts" : group.recordType;
}

export function computeGroupDerived(group, lookups) {
  const resolved = resolveGroupRecords(group, lookups);
  const records = resolved.map((r) => r.record);
  const conflictCount = records.length >= 2 ? countConflictingFields(compareTypeFor(group), records) : 0;
  const hasImportedRecord = records.some((r) => r.source === "Import");
  const primary = records[0];
  const identifier = primary ? (primary.name || primary.email || "(unnamed)") : "(missing record)";
  const secondaryIdentifiers = records.slice(1).map((r) => r.name || r.email || "(unnamed)");
  return { resolved, records, conflictCount, hasImportedRecord, identifier, secondaryIdentifiers };
}

function matchesSearch(group, derived, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystack = [derived.identifier, ...derived.secondaryIdentifiers, ...group.matchingRules, group.recordType]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function filterGroups(groups, params, lookups) {
  const {
    type, confidence, rule, source, status, reviewer, detectedFrom, detectedTo,
    imported, hasConflicts, recordCount, search,
  } = params;

  return groups
    .map((g) => ({ group: g, derived: computeGroupDerived(g, lookups) }))
    .filter(({ group, derived }) => {
      if (type && group.recordType !== type) return false;
      if (confidence && group.confidenceLabel !== confidence) return false;
      if (rule && !group.matchingRules.includes(rule)) return false;
      if (source && group.detectionSource !== source) return false;
      if (status && group.reviewStatus !== status) return false;
      if (reviewer === "unassigned" ? group.assignedReviewer : reviewer && group.assignedReviewer !== reviewer) return false;
      if (detectedFrom && new Date(group.detectedAt) < new Date(detectedFrom)) return false;
      if (detectedTo && new Date(group.detectedAt) > new Date(detectedTo)) return false;
      if (imported === "true" && !derived.hasImportedRecord) return false;
      if (hasConflicts === "true" && derived.conflictCount === 0) return false;
      if (recordCount === "two" && group.records.length !== 2) return false;
      if (recordCount === "multi" && group.records.length < 3) return false;
      if (!matchesSearch(group, derived, search)) return false;
      return true;
    });
}

const SORTERS = {
  confidence: (row) => row.group.confidencePercent,
  detectedAt: (row) => new Date(row.group.detectedAt).getTime(),
  recordType: (row) => row.group.recordType,
  recordCount: (row) => row.group.records.length,
  conflictCount: (row) => row.derived.conflictCount,
  reviewStatus: (row) => row.group.reviewStatus,
};

export function sortGroups(rows, sort = "detectedAt", order = "desc") {
  const getKey = SORTERS[sort] || SORTERS.detectedAt;
  const dir = order === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = getKey(a);
    const bv = getKey(b);
    if (av === bv) return 0;
    return av > bv ? dir : -dir;
  });
}

export function computeMetrics(groups) {
  return {
    total: groups.length,
    highConfidence: groups.filter((g) => g.confidenceLabel === "High").length,
    needsReview: groups.filter((g) => g.reviewStatus === "Needs Review").length,
    confirmedDuplicate: groups.filter((g) => g.reviewStatus === "Confirmed Duplicate").length,
    notDuplicate: groups.filter((g) => g.reviewStatus === "Not Duplicate").length,
    previewResolved: groups.filter((g) => g.reviewStatus === "Preview Resolved").length,
  };
}
