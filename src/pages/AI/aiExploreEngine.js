// Shaping helpers for AI Explore Mode — the "free exploration" gateway mode
// where a real model reasons directly over raw (already RBAC-scoped)
// records instead of the deterministic engine. This file does no
// calculation of its own: it only (1) trims what leaves the browser before
// a request goes out, and (2) adapts what comes back into the same
// AIInsight shape (see aiTypes.js) the rest of the AI Intelligence Center
// already knows how to render, so AiEvidenceDrawer/AiActionPreviewModal
// need no changes to support it.
import { createInsight, createConfidence, createSuggestedAction, createEvidenceReference } from "./aiTypes";
import { evidence } from "./aiInsightEngine";

// Mirrors the backend's own MAX_RECORDS_PER_TYPE (server/src/services/ai/
// guardrails.js) — capping here too keeps the request small and means the
// user sees the same "truncated" outcome the server would enforce anyway.
const MAX_RECORDS_PER_TYPE = 40;

function cap(list) {
  return (list || []).slice(0, MAX_RECORDS_PER_TYPE);
}

function pick(record, fields) {
  const out = {};
  for (const field of fields) {
    if (record[field] !== undefined) out[field] = record[field];
  }
  return out;
}

// A field only needs to be here if it's plausibly useful for the model to
// reason about or cite — internal logs, attachments and free-text notes are
// deliberately left out to keep the payload small and reduce what a
// third-party provider ever sees.
const DEAL_FIELDS = ["_id", "name", "stage", "value", "expectedClosingDate", "ownerId", "companyId", "nextAction", "dealHealth", "priority", "createdAt", "updatedAt"];
const LEAD_FIELDS = ["_id", "name", "status", "email", "phone", "estimatedValue", "ownerId", "createdAt", "updatedAt"];
const COMPANY_FIELDS = ["_id", "name", "industry", "ownerId", "primaryContactId", "customerStatus", "createdAt", "updatedAt"];
const CONTACT_FIELDS = ["_id", "name", "email", "phone", "companyId", "createdAt", "updatedAt"];
const ACTIVITY_FIELDS = ["_id", "title", "type", "status", "dueDate", "completedAt", "relatedRecordType", "relatedRecordId", "ownerId"];
const QUOTE_FIELDS = ["_id", "title", "quoteNumber", "amount", "status", "validUntilDate", "dealId", "companyId", "createdAt"];
const ORDER_FIELDS = ["_id", "orderNumber", "status", "companyId", "createdAt"];
const CONTRACT_FIELDS = ["_id", "contractType", "status", "startDate", "endDate", "renewalNoticeDays", "ownerId", "companyId"];

// Belt-and-suspenders: the Checker role already has its CRM/Sales arrays
// scoped to empty by the time they reach here (see the Checker-degradation
// fix in aiSlice.js), but if that ever changes, a real monetary value must
// still never leave the browser for a role that can't see it anywhere else
// in the app — matching the existing moneyFor() masking rule.
function maskMoneyField(record, field, role) {
  if (role !== "Checker" || record[field] === undefined) return record;
  return { ...record, [field]: null };
}

export function buildExploreRecordsPayload(scoped, role) {
  return {
    deals: cap(scoped.deals).map((d) => maskMoneyField(pick(d, DEAL_FIELDS), "value", role)),
    leads: cap(scoped.leads).map((l) => pick(l, LEAD_FIELDS)),
    companies: cap(scoped.companies).map((c) => pick(c, COMPANY_FIELDS)),
    contacts: cap(scoped.contacts).map((c) => pick(c, CONTACT_FIELDS)),
    activities: cap(scoped.activities).map((a) => pick(a, ACTIVITY_FIELDS)),
    quotes: cap(scoped.quotes).map((q) => maskMoneyField(pick(q, QUOTE_FIELDS), "amount", role)),
    orders: cap(scoped.orders).map((o) => pick(o, ORDER_FIELDS)),
    contracts: cap(scoped.contracts).map((c) => pick(c, CONTRACT_FIELDS)),
  };
}

const RECORD_TYPE_LOOKUP = [
  { key: "deals", recordType: "Deal", label: (r) => r.name },
  { key: "leads", recordType: "Lead", label: (r) => r.name },
  { key: "companies", recordType: "Company", label: (r) => r.name },
  { key: "contacts", recordType: "Contact", label: (r) => r.name },
  { key: "activities", recordType: "Activity", label: (r) => r.title || r.type },
  { key: "quotes", recordType: "Quote", label: (r) => r.title || r.quoteNumber },
  { key: "orders", recordType: "Order", label: (r) => r.orderNumber },
  { key: "contracts", recordType: "Contract", label: (r) => r.contractType },
];

// evidence() (aiInsightEngine.js) only knows how to resolve a route for the
// seven record types that have a real detail page — Activity has none, so
// it's handled separately below with route always null.
const EVIDENCE_ROUTE_TYPES = new Set(["Deal", "Lead", "Company", "Contact", "Quote", "Order", "Contract"]);

function resolveRecordById(scoped, id) {
  for (const { key, recordType, label } of RECORD_TYPE_LOOKUP) {
    const record = (scoped[key] || []).find((r) => r._id === id);
    if (record) return { recordType, record, label: label(record) || record._id };
  }
  return null;
}

function buildFindingEvidence(citedRecordIds, scoped, role) {
  const refs = [];
  for (const id of citedRecordIds || []) {
    const resolved = resolveRecordById(scoped, id);
    if (!resolved) continue; // already filtered server-side, but never trust it twice
    const { recordType, record, label } = resolved;
    if (EVIDENCE_ROUTE_TYPES.has(recordType)) {
      refs.push(evidence({
        recordType, record, label, field: "Cited by AI", value: "Referenced in this finding",
        explanation: "Cited by the AI model while exploring your current records.", role,
      }));
    } else {
      refs.push(createEvidenceReference({
        recordType, recordId: record._id, recordLabel: label,
        supportingField: "Cited by AI", supportingValue: "Referenced in this finding",
        explanation: "Cited by the AI model while exploring your current records.", route: null,
      }));
    }
  }
  return refs;
}

let pseudoInsightCounter = 0;

// Adapts one gateway "finding" into a real AIInsight — title prefixed
// "Unverified:" and confidence pinned to "Insufficient Data" so it can
// never be visually confused with a deterministic, verified insight even
// if it ends up reused somewhere the two lists could appear side by side.
export function findingToPseudoInsight(finding, scoped, role) {
  pseudoInsightCounter += 1;
  const localId = `explore-${pseudoInsightCounter}`;
  const evidenceRefs = buildFindingEvidence(finding.citedRecordIds, scoped, role);

  const suggestedActions = [];
  if (finding.suggestedAction) {
    const resolved = resolveRecordById(scoped, finding.suggestedAction.affectedRecordId);
    suggestedActions.push(createSuggestedAction({
      id: `${localId}-action`,
      type: finding.suggestedAction.type,
      label: finding.suggestedAction.label,
      reason: finding.suggestedAction.reason,
      affectedRecordId: finding.suggestedAction.affectedRecordId,
      affectedRecordType: resolved?.recordType || finding.suggestedAction.affectedRecordType,
    }));
  }

  return createInsight({
    id: localId,
    type: "ai_exploration_finding",
    module: "sales",
    title: `Unverified: ${finding.title}`,
    summary: finding.observation,
    explanation: "Generated by a real AI model reasoning directly over your current records — not verified by the deterministic engine. Confirm any figures or conclusions before acting.",
    priority: "Informational",
    confidence: createConfidence("Insufficient Data", "This finding was written by an AI model, not calculated — it has not been checked against the deterministic engine and may be inaccurate."),
    affectedRecordIds: evidenceRefs.map((e) => e.recordId),
    evidence: evidenceRefs,
    suggestedActions,
    dataRange: null,
    createdAt: new Date().toISOString(),
  });
}
