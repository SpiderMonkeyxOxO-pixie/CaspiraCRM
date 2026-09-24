// Backend Phase 10 — evidence records. Every record the Copilot sees comes
// from a domain handler called with the user's own identity (so scope,
// organization and field masking are already applied) and is reduced to a
// small, safe shape here: primitives only, bounded strings, internal and
// heavy fields dropped. Each gets a stable handle (E1, E2, …) that answers
// must cite.

export const RECORD_ROUTES = {
  Lead: (id) => `/crm/leads/${id}`, Contact: (id) => `/crm/contacts/${id}`, Company: (id) => `/crm/companies/${id}`,
  Deal: (id) => `/crm/deals/${id}`, Activity: () => "/crm/activities", Quote: (id) => `/sales/quotes/${id}`,
  Order: (id) => `/sales/orders/${id}`, Contract: (id) => `/sales/contracts/${id}`, Ticket: (id) => `/support/tickets/${id}`,
  Project: (id) => `/projects/${id}`, Task: () => "/projects/tasks", Invoice: (id) => `/finance/invoices/${id}`,
  KnowledgeArticle: () => "/support/knowledge-base", PipelineMetrics: () => "/sales/reports",
};

const DROP = /^(auditLog|activityLog|notes|files|attachments|lineItems|contactRoles|additionalContactIds|competitors|tags|internalNote|internalNotes|privateNotes|restrictedNotes|metadata|customFields|settings|payload|history|body|html|signatureEvidence|passwordHash|createdByMembershipId|updatedByMembershipId|organizationId)$/i;
const LABEL_KEYS = ["name", "title", "subject", "quoteNumber", "orderNumber", "contractNumber", "invoiceNumber", "ticketNumber", "dealNumber", "taskNumber"];
const MAX_FIELDS = 30;
const MAX_STRING = 500;

export const labelOf = (r, fallback = "Record") => {
  for (const k of LABEL_KEYS) if (r?.[k]) return String(r[k]).slice(0, 120);
  return fallback;
};

// Reduces a handler record to primitives (and small name objects).
export function shapeRecord(recordType, raw) {
  const id = String(raw._id || raw.id);
  const fields = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw || {})) {
    if (n >= MAX_FIELDS) break;
    if (k === "_id" || k === "id" || DROP.test(k)) continue;
    if (v === null || v === undefined) { fields[k] = null; n += 1; continue; }
    if (typeof v === "string") { fields[k] = v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v; n += 1; }
    else if (typeof v === "number" || typeof v === "boolean") { fields[k] = v; n += 1; }
    else if (v instanceof Date) { fields[k] = v.toISOString(); n += 1; }
    else if (typeof v === "object" && !Array.isArray(v) && (v.name || v.title)) { fields[k] = { id: v._id || v.id || null, name: v.name || v.title }; n += 1; }
  }
  const updatedAt = raw.updatedAt ? new Date(raw.updatedAt).toISOString() : null;
  return {
    recordType, recordId: id, label: labelOf(raw, recordType), route: RECORD_ROUTES[recordType]?.(id) || null,
    updatedAt, sourceVersion: raw.version !== undefined && raw.version !== null ? String(raw.version) : updatedAt, fields,
    masked: Object.entries(raw || {}).filter(([k, v]) => v === null && /value|amount|total|price|cost|margin|revenue/i.test(k)).map(([k]) => k),
  };
}

// Collects evidence for one turn and hands out stable handles.
export class EvidenceSet {
  constructor() { this.items = []; this.byKey = new Map(); }
  add(item, method) {
    const key = `${item.recordType}:${item.recordId}${item.chunkId ? `:${item.chunkId}` : ""}`;
    if (this.byKey.has(key)) return this.byKey.get(key);
    const handle = `E${this.items.length + 1}`;
    const entry = { handle, method, ...item };
    this.items.push(entry);
    this.byKey.set(key, entry);
    return entry;
  }
  get(handle) { return this.items.find((i) => i.handle === handle) || null; }
  get size() { return this.items.length; }
  // What the model sees: handles, types, labels, fields — no routes or internals.
  forModel(limit = 60) {
    return this.items.slice(0, limit).map((i) => ({ handle: i.handle, type: i.recordType, id: i.recordId, label: i.label, updatedAt: i.updatedAt, ...(i.section && { section: i.section }), ...(i.text && { excerpt: i.text }), fields: i.fields || {} }));
  }
}
