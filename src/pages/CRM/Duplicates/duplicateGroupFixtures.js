// Realistic, named duplicate-group seeds — every scenario called out by the
// /crm/duplicates spec, grounded in real records from the SAME shared
// mockCrmData fixtures every other CRM route reads (never a separate
// duplicates-only dataset). Confidence/evidence for every seed is computed
// by the same matching engine "Run Frontend Scan" uses live, so a seed
// group and a freshly-scanned one are never described inconsistently.
import {
  leads, contacts, companies, deals,
  DUPLICATE_LEAD_A, DUPLICATE_LEAD_B, DUPLICATE_LEAD_MATCHING_CONTACT,
  CONVERTED_DUPLICATE_LEAD, CONVERTED_LEAD_TARGET_CONTACT,
  IMPORTED_DUPLICATE_COMPANY,
  DUPLICATE_CONTACT_PHONE_A, DUPLICATE_CONTACT_PHONE_B,
  DUPLICATE_CONTACT_SIMILAR_A, DUPLICATE_CONTACT_SIMILAR_B,
  DUPLICATE_COMPANY_DOMAIN_A, DUPLICATE_COMPANY_DOMAIN_B,
  SIMILAR_NAME_DIFFERENT_COUNTRY_A, SIMILAR_NAME_DIFFERENT_COUNTRY_B,
  FALSE_POSITIVE_SHARED_PHONE_A, FALSE_POSITIVE_SHARED_PHONE_B,
  TRIPLE_DUP_A, TRIPLE_DUP_B, TRIPLE_DUP_C,
  DUPLICATE_DEAL_A, DUPLICATE_DEAL_B,
  PREVIOUSLY_MERGED_MASTER, PREVIOUSLY_MERGED_ABSORBED,
} from "../../../Helpers/mockCrmData";
import { evaluateMatch } from "./duplicateMatching";

const ELENA_MARSH = contacts.find((c) => c.email === "elena.marsh@brightloop.example");
const NORTHLINE = companies.find((c) => c.name === "Northline Prospecting Co");

function evidenceFor(recordType, a, b) {
  return evaluateMatch(recordType, a, b) || { matchingFields: [], matchingRules: [], confidencePercent: 0, confidenceLabel: "Low", evidence: [] };
}

function daysAgoIso(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function rec(type, id) {
  return { type, id };
}

function baseGroup(overrides) {
  return {
    detectionSource: "Frontend Scan",
    detectedAt: daysAgoIso(3),
    reviewStatus: "New",
    assignedReviewer: null,
    reviewNotes: "",
    mixedTypes: false,
    ...overrides,
  };
}

// 1. Two Leads, same email — High confidence.
const leadEmailMatch = evidenceFor("leads", DUPLICATE_LEAD_A, DUPLICATE_LEAD_B);
const GROUP_LEAD_EMAIL = baseGroup({
  id: "dup-seed-leads-email",
  recordType: "leads",
  records: [rec("leads", DUPLICATE_LEAD_A._id), rec("leads", DUPLICATE_LEAD_B._id)],
  ...leadEmailMatch,
  detectedAt: daysAgoIso(1),
  reviewStatus: "Needs Review",
});

// 2. A Lead matching an existing Contact (cross-type) — High confidence.
const leadContactMatch = ELENA_MARSH ? evidenceFor("contacts", DUPLICATE_LEAD_MATCHING_CONTACT, ELENA_MARSH) : null;
const GROUP_LEAD_MATCHES_CONTACT = ELENA_MARSH
  ? baseGroup({
      id: "dup-seed-lead-matches-contact",
      recordType: "leads",
      mixedTypes: true,
      records: [rec("leads", DUPLICATE_LEAD_MATCHING_CONTACT._id), rec("contacts", ELENA_MARSH._id)],
      ...leadContactMatch,
      detectedAt: daysAgoIso(2),
      reviewStatus: "Needs Review",
      reviewNotes: "This Lead looks like it should be linked to (or converted into) the existing Contact rather than treated separately.",
    })
  : null;

// 3. A previously-Converted Lead whose conversion target Contact still
// looks like a match — the "preserve conversion history" safety scenario.
const convertedMatch = evidenceFor("contacts", CONVERTED_DUPLICATE_LEAD, CONVERTED_LEAD_TARGET_CONTACT);
const GROUP_CONVERTED_LEAD = baseGroup({
  id: "dup-seed-converted-lead",
  recordType: "leads",
  mixedTypes: true,
  records: [rec("leads", CONVERTED_DUPLICATE_LEAD._id), rec("contacts", CONVERTED_LEAD_TARGET_CONTACT._id)],
  ...convertedMatch,
  detectedAt: daysAgoIso(5),
  reviewStatus: "Needs Review",
  reviewNotes: "This Lead has already been converted — review as a Lead-to-Contact relationship, not two ordinary Contacts.",
});

// 4. A "newly imported" Company matching an existing fixture by domain.
const importedMatch = NORTHLINE ? evidenceFor("companies", IMPORTED_DUPLICATE_COMPANY, NORTHLINE) : null;
const GROUP_IMPORTED_MATCH = NORTHLINE
  ? baseGroup({
      id: "dup-seed-imported-company",
      recordType: "companies",
      records: [rec("companies", IMPORTED_DUPLICATE_COMPANY._id), rec("companies", NORTHLINE._id)],
      ...importedMatch,
      detectionSource: "Frontend Scan",
      detectedAt: daysAgoIso(1),
      reviewStatus: "New",
      reviewNotes: "One of these records arrived through the Import wizard this session.",
    })
  : null;

// 5. Two Contacts, same phone (weaker, contributory-only signal).
const contactPhoneMatch = evidenceFor("contacts", DUPLICATE_CONTACT_PHONE_A, DUPLICATE_CONTACT_PHONE_B);
const GROUP_CONTACT_PHONE = baseGroup({
  id: "dup-seed-contacts-phone",
  recordType: "contacts",
  records: [rec("contacts", DUPLICATE_CONTACT_PHONE_A._id), rec("contacts", DUPLICATE_CONTACT_PHONE_B._id)],
  ...contactPhoneMatch,
  detectedAt: daysAgoIso(4),
  reviewStatus: "New",
});

// 6. Contacts with similar (not identical) names at the same Company —
// Medium confidence.
const similarNameMatch = evidenceFor("contacts", DUPLICATE_CONTACT_SIMILAR_A, DUPLICATE_CONTACT_SIMILAR_B);
const GROUP_CONTACT_SIMILAR_NAME = baseGroup({
  id: "dup-seed-contacts-similar-name",
  recordType: "contacts",
  records: [rec("contacts", DUPLICATE_CONTACT_SIMILAR_A._id), rec("contacts", DUPLICATE_CONTACT_SIMILAR_B._id)],
  ...similarNameMatch,
  detectedAt: daysAgoIso(6),
  reviewStatus: "Needs Review",
});

// 7. Companies using the same domain — High confidence.
const companyDomainMatch = evidenceFor("companies", DUPLICATE_COMPANY_DOMAIN_A, DUPLICATE_COMPANY_DOMAIN_B);
const GROUP_COMPANY_DOMAIN = baseGroup({
  id: "dup-seed-companies-domain",
  recordType: "companies",
  records: [rec("companies", DUPLICATE_COMPANY_DOMAIN_A._id), rec("companies", DUPLICATE_COMPANY_DOMAIN_B._id)],
  ...companyDomainMatch,
  detectedAt: daysAgoIso(2),
  reviewStatus: "Needs Review",
});

// 8. Companies with similar names but different countries — the canonical
// false-positive shape. Seeded as an already-dismissed ("Not Duplicate")
// group so the workspace has a real "previously dismissed" example.
const similarCountryMatch = evidenceFor("companies", SIMILAR_NAME_DIFFERENT_COUNTRY_A, SIMILAR_NAME_DIFFERENT_COUNTRY_B);
const GROUP_SIMILAR_NAME_DIFFERENT_COUNTRY = baseGroup({
  id: "dup-seed-companies-similar-country",
  recordType: "companies",
  records: [rec("companies", SIMILAR_NAME_DIFFERENT_COUNTRY_A._id), rec("companies", SIMILAR_NAME_DIFFERENT_COUNTRY_B._id)],
  ...similarCountryMatch,
  detectedAt: daysAgoIso(10),
  reviewStatus: "Not Duplicate",
  assignedReviewer: "u3",
  reviewNotes: "Same name pattern, but genuinely separate regional entities (US vs Australia). Not a duplicate.",
});

// 9. A second false-positive shape: unrelated Companies sharing a generic
// switchboard phone number.
const sharedPhoneMatch = evidenceFor("companies", FALSE_POSITIVE_SHARED_PHONE_A, FALSE_POSITIVE_SHARED_PHONE_B);
const GROUP_FALSE_POSITIVE_PHONE = baseGroup({
  id: "dup-seed-companies-shared-phone",
  recordType: "companies",
  records: [rec("companies", FALSE_POSITIVE_SHARED_PHONE_A._id), rec("companies", FALSE_POSITIVE_SHARED_PHONE_B._id)],
  ...sharedPhoneMatch,
  detectedAt: daysAgoIso(7),
  reviewStatus: "New",
});

// 10. A three-record duplicate group (multi-record comparison workspace).
const tripleAB = evidenceFor("companies", TRIPLE_DUP_A, TRIPLE_DUP_B);
const tripleAC = evidenceFor("companies", TRIPLE_DUP_A, TRIPLE_DUP_C);
const tripleBC = evidenceFor("companies", TRIPLE_DUP_B, TRIPLE_DUP_C);
const bestTriple = [tripleAB, tripleAC, tripleBC].reduce((best, m) => (m.confidencePercent > (best?.confidencePercent ?? -1) ? m : best), null);
const GROUP_TRIPLE = baseGroup({
  id: "dup-seed-companies-triple",
  recordType: "companies",
  records: [rec("companies", TRIPLE_DUP_A._id), rec("companies", TRIPLE_DUP_B._id), rec("companies", TRIPLE_DUP_C._id)],
  confidencePercent: bestTriple.confidencePercent,
  confidenceLabel: bestTriple.confidenceLabel,
  matchingFields: [...new Set([...tripleAB.matchingFields, ...tripleAC.matchingFields, ...tripleBC.matchingFields])],
  matchingRules: [...new Set([...tripleAB.matchingRules, ...tripleAC.matchingRules, ...tripleBC.matchingRules])],
  evidence: bestTriple.evidence,
  detectedAt: daysAgoIso(3),
  reviewStatus: "Needs Review",
});

// 11. Deals with the same name and Company — High confidence.
const dealMatch = evidenceFor("deals", DUPLICATE_DEAL_A, DUPLICATE_DEAL_B);
const GROUP_DEALS = baseGroup({
  id: "dup-seed-deals-name-company",
  recordType: "deals",
  records: [rec("deals", DUPLICATE_DEAL_A._id), rec("deals", DUPLICATE_DEAL_B._id)],
  ...dealMatch,
  detectedAt: daysAgoIso(1),
  reviewStatus: "Needs Review",
});

// 12. A group already resolved via a frontend preview merge BEFORE this
// session started — seeds the "Preview Resolved" filter and Undo path.
const previouslyMergedMatch = evidenceFor("contacts", PREVIOUSLY_MERGED_MASTER, PREVIOUSLY_MERGED_ABSORBED);
const GROUP_PREVIOUSLY_MERGED = baseGroup({
  id: "dup-seed-contacts-previously-merged",
  recordType: "contacts",
  records: [rec("contacts", PREVIOUSLY_MERGED_MASTER._id), rec("contacts", PREVIOUSLY_MERGED_ABSORBED._id)],
  ...previouslyMergedMatch,
  detectionSource: "Frontend Scan",
  detectedAt: daysAgoIso(2),
  reviewStatus: "Preview Resolved",
  assignedReviewer: "u2",
  reviewNotes: "Resolved in an earlier session: same person, same phone and email. Merged with no field conflicts.",
});

export const SEED_DUPLICATE_GROUPS = [
  GROUP_LEAD_EMAIL,
  GROUP_LEAD_MATCHES_CONTACT,
  GROUP_CONVERTED_LEAD,
  GROUP_IMPORTED_MATCH,
  GROUP_CONTACT_PHONE,
  GROUP_CONTACT_SIMILAR_NAME,
  GROUP_COMPANY_DOMAIN,
  GROUP_SIMILAR_NAME_DIFFERENT_COUNTRY,
  GROUP_FALSE_POSITIVE_PHONE,
  GROUP_TRIPLE,
  GROUP_DEALS,
  GROUP_PREVIOUSLY_MERGED,
].filter(Boolean);

// A merge-history entry for the one group seeded as already-resolved, so
// the Merge History drawer and Undo path both work from a cold start —
// not only after a merge performed live in this session.
export const SEED_MERGE_HISTORY = [
  {
    id: "merge-seed-contacts-previously-merged",
    groupId: "dup-seed-contacts-previously-merged",
    masterType: "contacts",
    masterId: PREVIOUSLY_MERGED_MASTER._id,
    absorbedIds: [PREVIOUSLY_MERGED_ABSORBED._id],
    masterBefore: { ...PREVIOUSLY_MERGED_MASTER },
    absorbedBefore: { [PREVIOUSLY_MERGED_ABSORBED._id]: { type: "contacts", snapshot: { ...PREVIOUSLY_MERGED_ABSORBED, previewMergedInto: null, previewMergedAt: null } } },
    mergedAt: daysAgoIso(2),
    mergedBy: "Priya Nair",
    reason: "Confirmed duplicate — same person, same contact details, no conflicting fields.",
    undone: false,
  },
];

// Re-exported so tests and the slice can seed real fixture data without a
// second import from mockCrmData.
export { leads, contacts, companies, deals };
