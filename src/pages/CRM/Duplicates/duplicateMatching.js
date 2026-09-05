// Explainable, deterministic duplicate-matching engine — every match is a
// sum of named, weighted evidence rules with a human-readable detail string.
// There is no unexplained "AI score": whenever a confidence percentage is
// shown, the exact evidence list that produced it travels with it.
import { normalizeEmail, normalizePhone } from "../../../Helpers/mockCrmData";

// ---------------------------------------------------------------------------
// String similarity — a small, explainable Levenshtein-based ratio (not a
// black box): "similar" always means "differs by N characters out of M".
// ---------------------------------------------------------------------------
export function levenshteinDistance(a, b) {
  const s = a || "";
  const t = b || "";
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const prev = new Array(t.length + 1);
  const curr = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= t.length; j++) prev[j] = curr[j];
  }
  return prev[t.length];
}

// 1 = identical, 0 = completely different. Used only for "similar" evidence
// (never for exact matches, which compare normalized strings directly).
export function stringSimilarity(a, b) {
  const s = (a || "").trim().toLowerCase();
  const t = (b || "").trim().toLowerCase();
  if (!s && !t) return 0;
  const maxLen = Math.max(s.length, t.length);
  if (maxLen === 0) return 0;
  return 1 - levenshteinDistance(s, t) / maxLen;
}

export const CONFIDENCE_THRESHOLDS = { high: 65, medium: 35 };

export function confidenceFromScore(score) {
  const percent = Math.max(0, Math.min(98, Math.round(score)));
  const label = percent >= CONFIDENCE_THRESHOLDS.high ? "High" : percent >= CONFIDENCE_THRESHOLDS.medium ? "Medium" : "Low";
  return { percent, label };
}

// ---------------------------------------------------------------------------
// Per-record-type evidence rules. Each returns an array of
// { rule, label, weight, fields, detail } entries — only rules that actually
// fired are included, so "matching fields" and "matching rules" are always
// literally the evidence that produced the confidence score.
// ---------------------------------------------------------------------------
function personEvidence(a, b) {
  const evidence = [];
  const emailA = normalizeEmail(a.email);
  const emailB = normalizeEmail(b.email);
  if (emailA && emailA === emailB) {
    evidence.push({ rule: "exact_email", label: "Exact normalized email", weight: 70, fields: ["email"], detail: `Both records use "${emailA}"` });
  }
  const phoneA = normalizePhone(a.phone);
  const phoneB = normalizePhone(b.phone);
  if (phoneA && phoneA.length >= 7 && phoneA === phoneB) {
    evidence.push({ rule: "exact_phone", label: "Exact normalized phone", weight: 45, fields: ["phone"], detail: `Both records normalize to the same phone number (${a.phone})` });
  }
  const nameA = (a.name || "").trim().toLowerCase();
  const nameB = (b.name || "").trim().toLowerCase();
  if (nameA && nameB) {
    if (nameA === nameB) {
      evidence.push({ rule: "exact_name", label: "Exact full name match", weight: 25, fields: ["name"], detail: `Both records are named "${a.name}"` });
    } else {
      const sim = stringSimilarity(nameA, nameB);
      if (sim >= 0.8) evidence.push({ rule: "similar_name", label: "Similar full name", weight: 15, fields: ["name"], detail: `"${a.name}" and "${b.name}" are ${Math.round(sim * 100)}% similar` });
    }
  }
  const coA = (a.companyName || "").trim().toLowerCase();
  const coB = (b.companyName || "").trim().toLowerCase();
  if (coA && coA === coB) {
    evidence.push({ rule: "same_company", label: "Same Company", weight: 10, fields: ["companyName"], detail: `Both list "${a.companyName}" as their Company` });
  }
  if (a.source && b.source && a.source === b.source) {
    evidence.push({ rule: "same_source", label: "Same source information", weight: 5, fields: ["source"], detail: `Both were sourced from "${a.source}"` });
  }
  return evidence;
}

function companyEvidence(a, b) {
  const evidence = [];
  const domA = (a.primaryDomain || "").trim().toLowerCase();
  const domB = (b.primaryDomain || "").trim().toLowerCase();
  const stripScheme = (w) => (w || "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const webA = stripScheme(a.website);
  const webB = stripScheme(b.website);
  if (domA && domA === domB) {
    evidence.push({ rule: "exact_domain", label: "Exact domain", weight: 70, fields: ["primaryDomain"], detail: `Both use the domain "${domA}"` });
  } else if (webA && webA === webB) {
    evidence.push({ rule: "matching_website", label: "Matching website", weight: 65, fields: ["website"], detail: `Both resolve to "${webA}"` });
  }
  const nameA = (a.name || "").trim().toLowerCase();
  const nameB = (b.name || "").trim().toLowerCase();
  if (nameA && nameB) {
    if (nameA === nameB) {
      evidence.push({ rule: "exact_name", label: "Exact Company name", weight: 40, fields: ["name"], detail: `Both are named "${a.name}"` });
    } else {
      const sim = stringSimilarity(nameA, nameB);
      if (sim >= 0.75) evidence.push({ rule: "similar_name", label: "Similar normalized Company name", weight: 15, fields: ["name"], detail: `"${a.name}" and "${b.name}" are ${Math.round(sim * 100)}% similar` });
    }
  }
  const phoneA = normalizePhone(a.phone);
  const phoneB = normalizePhone(b.phone);
  if (phoneA && phoneA.length >= 7 && phoneA === phoneB) {
    evidence.push({ rule: "same_phone", label: "Same phone", weight: 20, fields: ["phone"], detail: `Both use the same phone number (${a.phone})` });
  }
  const addrA = (a.address || "").trim().toLowerCase();
  const addrB = (b.address || "").trim().toLowerCase();
  if (addrA && addrA === addrB) {
    evidence.push({ rule: "same_address", label: "Same address", weight: 20, fields: ["address"], detail: `Both list "${a.address}"` });
  }
  if (a.country && b.country && a.country === b.country && a.city && b.city && a.city === b.city) {
    evidence.push({ rule: "same_country_city", label: "Same country and city", weight: 8, fields: ["country", "city"], detail: `Both are in ${a.city}, ${a.country}` });
  }
  return evidence;
}

function dealEvidence(a, b) {
  const evidence = [];
  const nameA = (a.name || "").trim().toLowerCase();
  const nameB = (b.name || "").trim().toLowerCase();
  if (nameA && nameA === nameB) {
    evidence.push({ rule: "same_deal_name", label: "Same Deal name", weight: 35, fields: ["name"], detail: `Both are named "${a.name}"` });
  }
  if (a.companyId && b.companyId && a.companyId === b.companyId) {
    evidence.push({ rule: "same_company", label: "Same Company", weight: 30, fields: ["companyId"], detail: "Both are linked to the same Company" });
  }
  if (a.primaryContactId && b.primaryContactId && a.primaryContactId === b.primaryContactId) {
    evidence.push({ rule: "same_contact", label: "Same primary Contact", weight: 15, fields: ["primaryContactId"], detail: "Both share the same primary Contact" });
  }
  if (typeof a.value === "number" && typeof b.value === "number") {
    const diff = Math.abs(a.value - b.value);
    const base = Math.max(a.value, b.value, 1);
    if (diff / base <= 0.1) {
      evidence.push({ rule: "similar_value", label: "Similar value", weight: 10, fields: ["value"], detail: `$${a.value.toLocaleString()} vs $${b.value.toLocaleString()}` });
    }
  }
  if (a.expectedClosingDate && b.expectedClosingDate) {
    const da = new Date(a.expectedClosingDate);
    const db = new Date(b.expectedClosingDate);
    if (!Number.isNaN(da.getTime()) && !Number.isNaN(db.getTime()) && da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth()) {
      evidence.push({ rule: "similar_close_date", label: "Similar expected closing date", weight: 8, fields: ["expectedClosingDate"], detail: "Both are expected to close in the same month" });
    }
  }
  return evidence;
}

const EVIDENCE_FNS = { leads: personEvidence, contacts: personEvidence, companies: companyEvidence, deals: dealEvidence };

// Rules strong/specific enough to stand on their own as evidence of a
// duplicate. Everything else (same source, same country+city, same primary
// Contact, similar value/date, "same Company" for a person) is contributory
// only — real corroboration once something stronger has already matched,
// but never enough by itself. Without this, two people who merely share a
// lead source, or two Deals that merely close in the same month, would
// register as a "match" — and via transitive clustering, chain unrelated
// records together into one enormous false group.
const PRIMARY_RULES = {
  leads: new Set(["exact_email", "exact_phone", "exact_name", "similar_name"]),
  contacts: new Set(["exact_email", "exact_phone", "exact_name", "similar_name"]),
  companies: new Set(["exact_domain", "matching_website", "exact_name", "similar_name", "same_phone", "same_address"]),
  deals: new Set(["same_deal_name", "same_company"]),
};

// Evaluate exactly one pair of same-type records. Returns null when nothing
// matched, or when every rule that fired is contributory-only.
export function evaluateMatch(recordType, a, b) {
  const fn = EVIDENCE_FNS[recordType];
  if (!fn) return null;
  const evidence = fn(a, b);
  if (!evidence.length) return null;
  if (!evidence.some((e) => PRIMARY_RULES[recordType].has(e.rule))) return null;
  // Deals additionally require at least two corroborating signals even when
  // one is primary (e.g. same Company alone still isn't enough).
  if (recordType === "deals" && evidence.length < 2) return null;
  const score = evidence.reduce((sum, e) => sum + e.weight, 0);
  const { percent, label } = confidenceFromScore(score);
  const matchingFields = [...new Set(evidence.flatMap((e) => e.fields))];
  const matchingRules = evidence.map((e) => e.label);
  return { aId: a._id, bId: b._id, evidence, matchingFields, matchingRules, confidencePercent: percent, confidenceLabel: label };
}

// ---------------------------------------------------------------------------
// Clustering — union-find over every pairwise match so a three-record match
// (A~B, B~C) becomes one group of three, not two overlapping pairs.
// ---------------------------------------------------------------------------
function buildClusters(recordIds, pairwiseMatches) {
  const parent = new Map(recordIds.map((id) => [id, id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (x, y) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };
  for (const m of pairwiseMatches) union(m.aId, m.bId);

  const clusters = new Map();
  for (const id of recordIds) {
    const root = find(id);
    if (!clusters.has(root)) clusters.set(root, new Set());
    clusters.get(root).add(id);
  }
  return [...clusters.values()].map((set) => [...set]).filter((ids) => ids.length >= 2);
}

// Scans every active (not archived, not already preview-merged) record of
// one type against every other, producing candidate clusters with their
// full pairwise evidence attached. Every group's `records` list is the one
// canonical way to resolve its members — { type, id } pairs rather than a
// bare id array — so the exact same shape also covers the small number of
// cross-type groups (a Lead matching an existing Contact) that a same-type
// scan can never produce on its own; those are hand-authored as fixture
// seeds using this identical shape instead.
export function findCandidateClusters(recordType, records) {
  const active = records.filter((r) => !r.previewMergedInto && !r.archived);
  const pairwiseMatches = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const match = evaluateMatch(recordType, active[i], active[j]);
      if (match) pairwiseMatches.push(match);
    }
  }
  const recordIds = active.map((r) => r._id);
  const clusters = buildClusters(recordIds, pairwiseMatches);
  return clusters.map((ids) => {
    const idSet = new Set(ids);
    const matchesInCluster = pairwiseMatches.filter((m) => idSet.has(m.aId) && idSet.has(m.bId));
    const primaryMatch = matchesInCluster.reduce((best, m) => (!best || m.confidencePercent > best.confidencePercent ? m : best), null);
    const matchingFields = [...new Set(matchesInCluster.flatMap((m) => m.matchingFields))];
    const matchingRules = [...new Set(matchesInCluster.flatMap((m) => m.matchingRules))];
    return {
      records: ids.map((id) => ({ type: recordType, id })),
      pairwiseMatches: matchesInCluster,
      matchingFields,
      matchingRules,
      confidencePercent: primaryMatch?.confidencePercent ?? 0,
      confidenceLabel: primaryMatch?.confidenceLabel ?? "Low",
      evidence: primaryMatch?.evidence ?? [],
    };
  });
}

export function recordKey(r) {
  return `${r.type}:${r.id}`;
}

function sameRecordSet(recordsA, recordsB) {
  if (recordsA.length !== recordsB.length) return false;
  const setB = new Set(recordsB.map(recordKey));
  return recordsA.every((r) => setB.has(recordKey(r)));
}

// Merges freshly-scanned clusters into the existing group list for one
// record type: a cluster identical to an existing group's record set is
// left untouched (never duplicated); a cluster that shares at least one
// record with an existing NOT-YET-RESOLVED group grows that group instead
// of creating a new one; resolved groups (Not Duplicate / Preview Resolved)
// are never modified by a re-scan. Returns { groups, newGroupCount,
// updatedGroupCount } for the scan summary.
export function mergeScanResultsIntoGroups(existingGroups, recordType, freshClusters, { idFactory, detectedAt } = {}) {
  const groups = existingGroups.map((g) => ({ ...g }));
  const RESOLVED_STATUSES = ["Not Duplicate", "Preview Resolved", "Confirmed Duplicate"];
  let newGroupCount = 0;
  let updatedGroupCount = 0;

  for (const cluster of freshClusters) {
    const existingExact = groups.find((g) => g.recordType === recordType && sameRecordSet(g.records, cluster.records));
    if (existingExact) continue; // identical group already tracked — never duplicated

    const clusterKeys = new Set(cluster.records.map(recordKey));
    const overlapping = groups.find(
      (g) => g.recordType === recordType && !RESOLVED_STATUSES.includes(g.reviewStatus) && g.records.some((r) => clusterKeys.has(recordKey(r)))
    );
    if (overlapping) {
      overlapping.records = [...overlapping.records, ...cluster.records].filter((r, i, arr) => arr.findIndex((x) => recordKey(x) === recordKey(r)) === i);
      overlapping.matchingFields = [...new Set([...overlapping.matchingFields, ...cluster.matchingFields])];
      overlapping.matchingRules = [...new Set([...overlapping.matchingRules, ...cluster.matchingRules])];
      overlapping.confidencePercent = Math.max(overlapping.confidencePercent, cluster.confidencePercent);
      overlapping.confidenceLabel = confidenceFromScore(overlapping.confidencePercent).label;
      updatedGroupCount += 1;
      continue;
    }

    groups.push({
      id: idFactory ? idFactory() : `dup-${recordType}-${Math.random().toString(36).slice(2, 10)}`,
      recordType,
      mixedTypes: false,
      records: cluster.records,
      confidencePercent: cluster.confidencePercent,
      confidenceLabel: cluster.confidenceLabel,
      matchingFields: cluster.matchingFields,
      matchingRules: cluster.matchingRules,
      detectionSource: "Frontend Scan",
      detectedAt: detectedAt || new Date().toISOString(),
      reviewStatus: "New",
      assignedReviewer: null,
      reviewNotes: "",
    });
    newGroupCount += 1;
  }

  return { groups, newGroupCount, updatedGroupCount };
}
