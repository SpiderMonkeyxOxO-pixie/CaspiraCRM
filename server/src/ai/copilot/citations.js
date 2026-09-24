// Backend Phase 10 — citation validation, confidence and limitations.
//
// Before an answer is stored every cited handle is resolved to its evidence
// record, which is re-read through its domain handler (organization,
// authorization, existence, version). A citation to a missing, hidden or
// unknown record is removed; a changed record is marked Stale. A statement
// with numbers must find those numbers in a cited record; a material
// statement left without a valid citation is removed. Confidence is
// computed from these facts — never a model's own score.
import { callHandler } from "../actions/actionTypes.js";
import * as leads from "../../controllers/crm/leadsController.js";
import * as contacts from "../../controllers/crm/contactsController.js";
import * as companies from "../../controllers/crm/companiesController.js";
import * as activities from "../../controllers/crm/activitiesController.js";
import * as deals from "../../controllers/sales/dealsController.js";
import * as quotes from "../../controllers/sales/quotesController.js";
import * as orders from "../../controllers/sales/ordersController.js";
import * as contracts from "../../controllers/sales/contractsController.js";
import * as tickets from "../../controllers/support/ticketsController.js";
import * as kb from "../../controllers/support/knowledgeBaseController.js";
import * as projects from "../../controllers/projects/projectsController.js";

const REREAD = {
  Lead: [leads.getOne, "leadId", "lead"], Contact: [contacts.getOne, "contactId", "contact"], Company: [companies.getOne, "companyId", "company"],
  Activity: [activities.getOne, "activityId", "activity"], Deal: [deals.getOne, "dealId", "deal"], Quote: [quotes.getOne, "quoteId", "quote"],
  Order: [orders.getOne, "orderId", "order"], Contract: [contracts.getOne, "contractId", "contract"], Ticket: [tickets.getOne, "ticketId", "ticket"],
  KnowledgeArticle: [kb.getArticle, "articleId", "article"], Project: [projects.getOne, "projectId", "project"],
};
const MAX_REREADS = 20;

async function reread(req, item) {
  const spec = REREAD[item.recordType];
  if (!spec) return { ok: true, unchanged: true }; // computed (PipelineMetrics) or verified at retrieval (Task, Invoice, Note)
  const out = await callHandler(spec[0], req, { params: { [spec[1]]: item.recordId } });
  if (out.status !== 200) return { ok: false };
  const r = out.body[spec[2]];
  const version = r?.version !== undefined && r?.version !== null ? String(r.version) : r?.updatedAt ? new Date(r.updatedAt).toISOString() : null;
  return { ok: true, unchanged: !item.sourceVersion || !version || version === item.sourceVersion };
}

const numbersIn = (s) => (String(s).match(/-?\d[\d,]*(\.\d+)?/g) || []).map((n) => n.replace(/,/g, "")).filter((n) => n.length && !/^(19|20)\d\d$/.test(n) && Number(n) > 10);
const valuesOf = (item) => JSON.stringify({ ...item.fields, label: item.label, text: item.text || "" }).replace(/,(?=\d{3})/g, "");

// → { findings, citations, removed, stale, restricted }
export async function validateCitations(req, evidence, rawFindings) {
  // Re-read every cited record once (bounded, a few at a time).
  const checked = new Map();
  const handles = [...new Set((rawFindings || []).flatMap((f) => f.citations || []))].filter((h) => evidence.get(h));
  for (const h of handles.slice(MAX_REREADS)) checked.set(h, { ok: true, unchanged: true, unchecked: true });
  const toCheck = handles.slice(0, MAX_REREADS);
  for (let i = 0; i < toCheck.length; i += 5) {
    const batch = toCheck.slice(i, i + 5);
    const states = await Promise.all(batch.map((h) => reread(req, evidence.get(h)).catch(() => ({ ok: false }))));
    batch.forEach((h, n) => checked.set(h, states[n]));
  }
  const findings = [];
  const citations = [];
  let removed = 0;
  let stale = 0;
  for (const f of rawFindings || []) {
    const valid = [];
    for (const handle of [...new Set(f.citations || [])]) {
      const item = evidence.get(handle);
      if (!item) continue; // unknown handle (e.g. invented)
      const state = checked.get(handle);
      if (!state.ok) continue; // deleted or no longer authorized
      valid.push({ handle, item, stale: !state.unchanged });
    }
    // Numbers in the statement must appear in a cited record.
    const nums = numbersIn(f.text);
    const supported = !nums.length || nums.every((n) => valid.some((v) => valuesOf(v.item).includes(n)));
    if (!valid.length || !supported) { removed += 1; continue; }
    if (valid.some((v) => v.stale)) stale += 1;
    findings.push({ text: f.text, citations: valid.map((v) => v.handle) });
    for (const v of valid) if (!citations.some((c) => c.citationKey === v.handle)) citations.push(toCitation(v.handle, v.item, v.stale ? "Stale" : "Valid"));
  }
  return { findings, citations, removed, stale };
}

export function toCitation(handle, item, status = "Valid") {
  return {
    citationKey: handle, recordType: item.recordType, recordId: item.recordId, label: item.label, field: item.section || null,
    value: item.text ? { excerpt: String(item.text).slice(0, 300) } : null, masked: (item.masked || []).length > 0,
    recordTimestamp: item.updatedAt ? new Date(item.updatedAt) : null, sourceVersion: item.sourceVersion || null, route: item.route || null,
    retrievalMethod: item.method || "structured", status,
  };
}

// High / Medium / Low / Insufficient Data, from facts.
export function computeConfidence({ evidenceCount, findingsKept, removed, stale, truncated, restricted, deterministic, semanticOnly, providerIssue }) {
  if (!evidenceCount || !findingsKept) return "Insufficient Data";
  let score = 3;
  if (removed) score -= removed > 1 ? 2 : 1;
  if (stale) score -= 1;
  if (truncated) score -= 1;
  if (restricted) score -= 1;
  if (semanticOnly) score -= 1;
  if (providerIssue) score -= 1;
  if (deterministic && score < 3 && !removed) score += 1;
  if (evidenceCount < 2 && !deterministic) score = Math.min(score, 2);
  return score >= 3 ? "High Confidence" : score === 2 ? "Medium Confidence" : "Low Confidence";
}

export const LIMITATION = {
  truncated: "Retrieval was limited — more records match than were read.",
  restricted: "Additional restricted information is available to authorized roles.",
  removed: (n) => `${n} statement${n === 1 ? " was" : "s were"} removed because no authorized record supported ${n === 1 ? "it" : "them"}.`,
  stale: "Some cited records changed after they were read; check the latest values.",
  semanticDisabled: "Text search across notes and articles is turned off; only structured records were searched.",
  documents: "Documents aren't available yet (Backend Phase 7 isn't implemented).",
  currencies: "Amounts are in more than one currency and were not combined.",
  providerRefused: "The AI model declined to answer.",
  partial: "Part of the work couldn't be completed.",
};
