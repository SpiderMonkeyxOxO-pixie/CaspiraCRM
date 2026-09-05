// Configurable comparison system shared by every record type's comparison
// workspace — one config per type instead of a bespoke comparison component
// for each. `ctx` carries whatever lookups a field needs (owner names,
// company/contact name resolution) so this module never imports Redux state
// directly and stays trivially unit-testable.
import { findTeamMember } from "../../../Helpers/mockUsersData";

function ownerLabel(record) {
  return record.ownerName || (record.ownerId ? findTeamMember(record.ownerId)?.name : null) || "Unassigned";
}
function tagsLabel(record) {
  return (record.tags || []).join(", ") || "—";
}
function moneyLabel(value, currency) {
  if (value === undefined || value === null || value === "") return "—";
  const amount = Number(value).toLocaleString();
  return currency ? `${currency} ${amount}` : `$${amount}`;
}
function dateLabel(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Field definitions per the spec's exact compare lists.
// ---------------------------------------------------------------------------
export const COMPARE_FIELDS = {
  leads: [
    { key: "name", label: "Name", getValue: (r) => r.name },
    { key: "companyName", label: "Company", getValue: (r) => r.companyName },
    { key: "email", label: "Email", getValue: (r) => r.email },
    { key: "phone", label: "Phone", getValue: (r) => r.phone },
    { key: "source", label: "Source", getValue: (r) => r.source },
    { key: "status", label: "Status", getValue: (r) => r.status },
    { key: "priority", label: "Priority", getValue: (r) => r.priority },
    { key: "ownerId", label: "Owner", getValue: (r) => r.ownerId, format: (_v, r) => ownerLabel(r) },
    { key: "estimatedValue", label: "Estimated value", getValue: (r) => r.estimatedValue, format: (v, r) => moneyLabel(v, r.currency) },
    { key: "nextFollowUp", label: "Next follow-up", getValue: (r) => r.nextFollowUp, format: dateLabel },
    { key: "tags", label: "Tags", getValue: (r) => (r.tags || []).slice().sort().join(","), format: (_v, r) => tagsLabel(r) },
  ],
  contacts: [
    { key: "name", label: "Name", getValue: (r) => r.name },
    { key: "companyName", label: "Company", getValue: (r) => r.companyName },
    { key: "jobTitle", label: "Job title", getValue: (r) => r.jobTitle },
    { key: "email", label: "Email", getValue: (r) => r.email },
    { key: "phone", label: "Phone", getValue: (r) => r.phone },
    { key: "country", label: "Country", getValue: (r) => r.country },
    { key: "preferredLanguage", label: "Language", getValue: (r) => r.preferredLanguage },
    { key: "lifecycleStage", label: "Lifecycle", getValue: (r) => r.lifecycleStage },
    { key: "ownerId", label: "Owner", getValue: (r) => r.ownerId, format: (_v, r) => ownerLabel(r) },
    {
      key: "communicationPrefs", label: "Communication preferences",
      getValue: (r) => ["emailAllowed", "phoneAllowed", "smsAllowed", "marketingAllowed"].map((k) => `${k}:${!!r[k]}`).join("|"),
      format: (_v, r) => ["Email", "Phone", "SMS", "Marketing"].filter((_, i) => r[["emailAllowed", "phoneAllowed", "smsAllowed", "marketingAllowed"][i]]).join(", ") || "None allowed",
    },
    { key: "doNotContact", label: "Do-not-contact", getValue: (r) => !!r.doNotContact, format: (v) => (v ? "Yes" : "No") },
    { key: "tags", label: "Tags", getValue: (r) => (r.tags || []).slice().sort().join(","), format: (_v, r) => tagsLabel(r) },
  ],
  companies: [
    { key: "name", label: "Company name", getValue: (r) => r.name },
    { key: "primaryDomain", label: "Domain", getValue: (r) => r.primaryDomain },
    { key: "website", label: "Website", getValue: (r) => r.website },
    { key: "industry", label: "Industry", getValue: (r) => r.industry },
    { key: "companySize", label: "Size", getValue: (r) => r.companySize },
    { key: "accountType", label: "Account type", getValue: (r) => r.accountType },
    { key: "lifecycleStage", label: "Lifecycle", getValue: (r) => r.lifecycleStage },
    { key: "accountTier", label: "Account tier", getValue: (r) => r.accountTier },
    { key: "accountHealth", label: "Account health", getValue: (r) => r.accountHealth },
    { key: "ownerId", label: "Owner", getValue: (r) => r.ownerId, format: (_v, r) => ownerLabel(r) },
    { key: "address", label: "Address", getValue: (r) => `${r.address || ""}, ${r.city || ""}, ${r.country || ""}`, format: (_v, r) => [r.address, r.city, r.country].filter(Boolean).join(", ") || "—" },
    { key: "estimatedAnnualValue", label: "Estimated annual value", getValue: (r) => r.estimatedAnnualValue, format: (v, r) => moneyLabel(v, r.currency) },
    { key: "tags", label: "Tags", getValue: (r) => (r.tags || []).slice().sort().join(","), format: (_v, r) => tagsLabel(r) },
  ],
  deals: [
    { key: "name", label: "Deal name", getValue: (r) => r.name },
    { key: "companyId", label: "Company", getValue: (r) => r.companyId, format: (_v, r, ctx) => ctx?.companiesById?.get(r.companyId)?.name || "—" },
    { key: "primaryContactId", label: "Primary Contact", getValue: (r) => r.primaryContactId, format: (_v, r, ctx) => ctx?.contactsById?.get(r.primaryContactId)?.name || "—" },
    { key: "stage", label: "Stage", getValue: (r) => r.stage },
    { key: "value", label: "Value", getValue: (r) => r.value, format: (v, r) => moneyLabel(v, r.currency) },
    { key: "currency", label: "Currency", getValue: (r) => r.currency },
    { key: "probability", label: "Probability", getValue: (r) => r.probability, format: (v) => (v === undefined || v === null ? "—" : `${v}%`) },
    { key: "expectedClosingDate", label: "Expected close", getValue: (r) => r.expectedClosingDate, format: dateLabel },
    { key: "ownerId", label: "Owner", getValue: (r) => r.ownerId, format: (_v, r) => ownerLabel(r) },
    { key: "lineItems", label: "Products", getValue: (r) => (r.lineItems || []).map((li) => li.name).sort().join(","), format: (_v, r) => (r.lineItems || []).map((li) => li.name).join(", ") || "—" },
    { key: "nextAction", label: "Next action", getValue: (r) => r.nextAction || "—" },
    { key: "tags", label: "Tags", getValue: (r) => (r.tags || []).slice().sort().join(","), format: (_v, r) => tagsLabel(r) },
  ],
};

export function getCompareFields(recordType) {
  return COMPARE_FIELDS[recordType] || [];
}

// ---------------------------------------------------------------------------
// Field-comparison table: for every field, the value from each record plus
// matching/conflict/blank flags — the same shape whether 2 or N records.
// ---------------------------------------------------------------------------
export function compareRecords(recordType, records, ctx = {}) {
  const fields = getCompareFields(recordType);
  return fields.map((field) => {
    const entries = records.map((r) => ({
      recordId: r._id,
      rawValue: field.getValue(r),
      display: field.format ? field.format(field.getValue(r), r, ctx) : (field.getValue(r) ?? "—"),
    }));
    const nonBlank = entries.filter((e) => e.rawValue !== undefined && e.rawValue !== null && e.rawValue !== "" && e.rawValue !== false);
    const distinctValues = new Set(nonBlank.map((e) => JSON.stringify(e.rawValue)));
    const hasBlank = entries.length !== nonBlank.length;
    const hasConflict = distinctValues.size > 1;
    const allMatch = !hasConflict && !hasBlank && entries.length > 0;
    return { key: field.key, label: field.label, entries, hasBlank, hasConflict, allMatch };
  });
}

export function countConflictingFields(recordType, records, ctx = {}) {
  return compareRecords(recordType, records, ctx).filter((f) => f.hasConflict).length;
}

// ---------------------------------------------------------------------------
// Translates "use this record's value for this field" into a real update
// payload. Most fields copy straight across (field.key already matches the
// record's own property); composite fields (owner, tags, communication
// preferences, address, Deal Company/Contact/Products) copy every real
// property they represent so nothing needed for that field is left behind.
// ---------------------------------------------------------------------------
const COMPOSITE_APPLY = {
  ownerId: (r, changes) => { changes.ownerId = r.ownerId || null; changes.ownerName = r.ownerName || null; },
  tags: (r, changes) => { changes.tags = r.tags || []; },
  communicationPrefs: (r, changes) => {
    changes.emailAllowed = !!r.emailAllowed;
    changes.phoneAllowed = !!r.phoneAllowed;
    changes.smsAllowed = !!r.smsAllowed;
    changes.marketingAllowed = !!r.marketingAllowed;
  },
  doNotContact: (r, changes) => { changes.doNotContact = !!r.doNotContact; },
  address: (r, changes) => { changes.address = r.address; changes.city = r.city; changes.country = r.country; },
  companyId: (r, changes) => { changes.companyId = r.companyId || null; },
  primaryContactId: (r, changes) => { changes.primaryContactId = r.primaryContactId || null; },
  lineItems: (r, changes) => { changes.lineItems = r.lineItems || []; },
};

export function applyFieldValue(fieldKey, chosenRecord, changes) {
  const composite = COMPOSITE_APPLY[fieldKey];
  if (composite) composite(chosenRecord, changes);
  else changes[fieldKey] = chosenRecord[fieldKey];
}

// selections: { [fieldKey]: recordId } — fields with no explicit selection
// default to the master's own value (i.e. no change for that field).
export function buildFinalValues(recordType, records, selections, masterId) {
  const byId = new Map(records.map((r) => [r._id, r]));
  const changes = {};
  for (const field of getCompareFields(recordType)) {
    const chosenId = selections[field.key] || masterId;
    if (chosenId === masterId) continue; // master's own value — nothing to change
    const chosenRecord = byId.get(chosenId);
    if (chosenRecord) applyFieldValue(field.key, chosenRecord, changes);
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Identity metadata shown at the top of each record's column — not part of
// the field-comparison table, just context to help the reviewer decide.
// ---------------------------------------------------------------------------
export function getIdentityMeta(recordType, record, ctx = {}) {
  const activityCount = (ctx.activities || []).filter(
    (a) => a.relatedRecordType === ctx.relatedTypeLabel?.[recordType] && a.relatedRecordId === record._id
  ).length;
  const fields = getCompareFields(recordType);
  const filled = fields.filter((f) => {
    const v = f.getValue(record);
    return v !== undefined && v !== null && v !== "" && v !== false;
  }).length;
  const relatedCount =
    recordType === "companies"
      ? (ctx.contacts || []).filter((c) => c.companyId === record._id).length + (ctx.deals || []).filter((d) => d.companyId === record._id).length
      : recordType === "deals"
        ? (record.primaryContactId ? 1 : 0) + (record.companyId ? 1 : 0)
        : 0;
  return {
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    owner: ownerLabel(record),
    source: record.source || "—",
    activityCount,
    relatedCount,
    completenessPercent: Math.round((filled / fields.length) * 100),
    archived: !!record.archived,
  };
}

// ---------------------------------------------------------------------------
// Master-record recommendation — explainable rules only, never automatic.
// ---------------------------------------------------------------------------
export function recommendMaster(recordType, records, ctx = {}) {
  if (records.length === 0) return null;
  const scored = records.map((r) => {
    const meta = getIdentityMeta(recordType, r, ctx);
    const reasons = [];
    let score = 0;
    if (r.accountType === "Customer" || r.relationshipType === "Customer" || r.lifecycleStage === "Active") {
      score += 40;
      reasons.push("Active Customer record");
    }
    score += meta.completenessPercent * 0.3;
    if (meta.completenessPercent >= 70) reasons.push("Most complete record");
    score += Math.min(meta.relatedCount, 5) * 5;
    if (meta.relatedCount > 0) reasons.push("Has related records");
    score += Math.min(meta.activityCount, 10) * 2;
    if (meta.activityCount > 0) reasons.push("Has recent activity");
    const ageMs = Date.now() - new Date(r.createdAt).getTime();
    score += Math.min(ageMs / (1000 * 60 * 60 * 24 * 365), 3) * 5;
    return { record: r, score, reasons, meta };
  });
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  if (!winner.reasons.length) winner.reasons.push("Oldest record");
  return { recordId: winner.record._id, reasons: [...new Set(winner.reasons)], scored };
}

// ---------------------------------------------------------------------------
// Safety conflicts — the special rules the spec calls out by name.
// ---------------------------------------------------------------------------
export function detectSafetyConflicts(recordType, records) {
  const conflicts = {};

  if (recordType === "contacts") {
    const dncValues = records.map((r) => !!r.doNotContact);
    if (new Set(dncValues).size > 1) {
      conflicts.consent = {
        message: "One record is marked Do Not Contact and another is not — the more restrictive setting is recommended.",
        recommendedValue: true,
      };
    }
  }

  if (recordType === "contacts" || recordType === "companies") {
    const stages = records.map((r) => r.lifecycleStage).filter(Boolean);
    const hasCustomer = stages.some((s) => s === "Active" || s === "Customer");
    const hasProspect = stages.includes("Prospect") || stages.includes("New");
    if (hasCustomer && hasProspect && new Set(stages).size > 1) {
      conflicts.lifecycle = {
        message: "One record is a Customer and another is a Prospect — preserving Customer status is recommended.",
        recommendedValue: stages.find((s) => s === "Active" || s === "Customer"),
      };
    }
  }

  const ownerIds = [...new Set(records.map((r) => r.ownerId).filter(Boolean))];
  if (ownerIds.length > 1) {
    conflicts.owner = {
      message: "These records have different owners — the final owner must be chosen explicitly.",
      ownerIds,
    };
  }

  if (recordType === "deals") {
    const currencies = [...new Set(records.map((r) => r.currency).filter(Boolean))];
    if (currencies.length > 1) {
      conflicts.currency = {
        message: "These Deals use different currencies — values cannot be combined without an explicit decision.",
        currencies,
      };
    }
  }

  if (recordType === "leads") {
    const convertedLead = records.find((r) => r.status === "Converted" && r.convertedTo);
    if (convertedLead) {
      conflicts.convertedLead = {
        message: "One of these Leads has already been converted — this is a Lead-to-Contact relationship, not two separate Contacts.",
        leadId: convertedLead._id,
        convertedTo: convertedLead.convertedTo,
      };
    }
  }

  return conflicts;
}

export const MARK_NOT_DUPLICATE_REASONS = [
  "Different people",
  "Different Companies",
  "Shared phone number",
  "Shared domain",
  "Similar name only",
  "Separate Deals",
  "Other",
];
