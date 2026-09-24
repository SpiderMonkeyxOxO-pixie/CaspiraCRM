// Backend Phase 8 — inbound normalization and CRM mapping.
//
// Provider records become a small, provider-neutral shape per entity type
// (normalize), and that shape is what's compared (checksums) and applied to
// CRM records (applyToCrm). Provider response objects never go further.
//
// Entity types and CRM targets:
//   calendar_event        → CRM Activity (type Meeting). Time zone kept; attendees
//                           recorded as participants — never invited.
//   issue                 → project Task in the configured project.
//   financial_transaction → a Statement line on the configured financial account
//                           (Unmatched, for reconciliation preview — no journal,
//                           no payment).
import crypto from "node:crypto";
import { canonical } from "../providers/catalogSeed.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { ensureDefaultBoard, columnForStatus } from "../../services/projects/boardService.js";
import { IntegrationError, KINDS } from "../common/errors.js";

export const SYNCABLE_ENTITY_TYPES = ["calendar_event", "issue", "financial_transaction"];
export const checksum = (fields) => crypto.createHash("sha256").update(canonical(fields)).digest("hex");
const iso = (v) => (v ? new Date(v).toISOString() : null);
const str = (v, max = 500) => (v === null || v === undefined ? null : String(v).slice(0, max));

// ---- Normalizers per provider shape → { externalId, externalVersion, deleted, fields }
const calendar = {
  simulator: (r) => ({ externalId: r.id, externalVersion: r.etag, deleted: !!r.deleted, fields: { title: str(r.summary, 200), startAt: iso(r.start?.dateTime), endAt: iso(r.end?.dateTime), timeZone: r.start?.timeZone || null, location: str(r.location, 200), attendees: (r.attendees || []).map((a) => a.email).sort() } }),
  google_workspace: (r) => ({ externalId: r.id, externalVersion: r.etag, deleted: r.status === "cancelled", fields: { title: str(r.summary, 200), startAt: iso(r.start?.dateTime || r.start?.date), endAt: iso(r.end?.dateTime || r.end?.date), timeZone: r.start?.timeZone || null, location: str(r.location, 200), attendees: (r.attendees || []).map((a) => a.email).filter(Boolean).sort() } }),
  microsoft_365: (r) => ({ externalId: r.id, externalVersion: r["@odata.etag"] || r.changeKey, deleted: !!r["@removed"], fields: { title: str(r.subject, 200), startAt: r.start?.dateTime ? iso(`${r.start.dateTime}${/Z|[+-]\d\d:?\d\d$/.test(r.start.dateTime) || r.start.timeZone !== "UTC" ? "" : "Z"}`) : null, endAt: r.end?.dateTime ? iso(`${r.end.dateTime}${r.end.timeZone === "UTC" && !/Z$/.test(r.end.dateTime) ? "Z" : ""}`) : null, timeZone: r.start?.timeZone || null, location: str(r.location?.displayName, 200), attendees: (r.attendees || []).map((a) => a.emailAddress?.address).filter(Boolean).sort() } }),
};
const issues = {
  simulator: (r) => ({ externalId: r.id, externalVersion: r.etag, deleted: !!r.deleted, fields: { title: str(r.title, 200), description: str(r.body, 5000), state: r.state === "closed" ? "closed" : "open" } }),
  github: (r) => ({ externalId: String(r.id), externalVersion: r.updated_at, deleted: false, skip: !!r.pull_request, fields: { title: str(r.title, 200), description: str(r.body, 5000), state: r.state === "closed" ? "closed" : "open" } }),
  jira: (r) => ({ externalId: String(r.id), externalVersion: r.fields?.updated, deleted: false, fields: { title: str(`${r.key} ${r.fields?.summary || ""}`, 200), description: null, state: r.fields?.status?.statusCategory?.key === "done" ? "closed" : "open" } }),
  asana: (r) => ({ externalId: r.gid, externalVersion: r.modified_at, deleted: false, fields: { title: str(r.name, 200), description: str(r.notes, 5000), state: r.completed ? "closed" : "open" } }),
  trello: (r) => ({ externalId: r.id, externalVersion: r.dateLastActivity, deleted: false, fields: { title: str(r.name, 200), description: str(r.desc, 5000), state: r.closed ? "closed" : "open" } }),
  clickup: (r) => ({ externalId: r.id, externalVersion: r.date_updated, deleted: false, fields: { title: str(r.name, 200), description: str(r.description, 5000), state: r.status?.type === "closed" || r.status?.type === "done" ? "closed" : "open" } }),
};
const transactions = {
  simulator: (r) => ({ externalId: r.id, externalVersion: r.etag, deleted: !!r.deleted, fields: { transactionDate: r.date, description: str(r.description, 300), reference: str(r.reference, 120), direction: r.direction, amount: String(r.amount), currency: r.currency } }),
  // Stripe amounts are in the currency's minor unit.
  stripe: (r) => ({ externalId: r.id, externalVersion: String(r.created), deleted: false, fields: { transactionDate: new Date(r.created * 1000).toISOString().slice(0, 10), description: str(r.description || r.type, 300), reference: r.id, direction: r.amount < 0 ? "Debit" : "Credit", amount: (Math.abs(r.amount) / 100).toFixed(2), currency: String(r.currency).toUpperCase() } }),
  xero: (r) => ({ externalId: r.BankTransactionID, externalVersion: r.UpdatedDateUTC, deleted: r.Status === "DELETED", fields: { transactionDate: r.DateString?.slice(0, 10) || null, description: str(r.Reference || r.Type, 300), reference: str(r.Reference, 120), direction: /SPEND/.test(r.Type) ? "Debit" : "Credit", amount: Number(r.Total).toFixed(2), currency: r.CurrencyCode } }),
};

const NORMALIZERS = { calendar_event: calendar, issue: issues, financial_transaction: transactions };

export function normalize(providerKey, mode, entityType, raw) {
  const table = NORMALIZERS[entityType];
  if (!table) throw new IntegrationError(KINDS.UNSUPPORTED, `Sync of ${entityType} isn't supported.`);
  const fn = mode === "Simulator" ? table.simulator : table[providerKey];
  if (!fn) throw new IntegrationError(KINDS.UNSUPPORTED, `${providerKey} ${entityType} records can't be read yet.`);
  const out = fn(raw);
  return { ...out, checksum: checksum(out.fields) };
}

// The same field set, read back from the CRM record (to detect CRM-side edits).
export function crmFields(entityType, record) {
  if (!record) return null;
  if (entityType === "calendar_event") return { title: record.title, startAt: iso(record.scheduledStart), endAt: iso(record.scheduledEnd), timeZone: record.timeZone || null, location: record.location || null, attendees: (record.participants || []).map((p) => p.email).filter(Boolean).sort() };
  if (entityType === "issue") return { title: record.title, description: record.description || null, state: record.statusCategory === "Completed" ? "closed" : "open" };
  if (entityType === "financial_transaction") return { transactionDate: record.transactionDate.toISOString().slice(0, 10), description: record.description, reference: record.reference, direction: record.direction, amount: Number(record.amount).toFixed(2), currency: record.currency };
  return null;
}

export async function loadCrmRecord(db, entityType, id) {
  if (!id) return null;
  if (entityType === "calendar_event") return db.activity.findUnique({ where: { id } });
  if (entityType === "issue") return db.task.findUnique({ where: { id } });
  if (entityType === "financial_transaction") return db.statementLine.findUnique({ where: { id } });
  return null;
}

// Creates or updates the CRM record for a normalized provider record.
// Only the mapped fields are written — restricted CRM fields are never part
// of the mapped set, so a provider can't overwrite them.
export async function applyToCrm(db, { entityType, connection, config, run, normalized, existingId = null, providerKey }) {
  const f = normalized.fields;
  const org = connection.organizationId;
  if (entityType === "calendar_event") {
    const data = {
      title: f.title || "(untitled event)", type: "Meeting", scheduledStart: f.startAt ? new Date(f.startAt) : null, scheduledEnd: f.endAt ? new Date(f.endAt) : null,
      startAt: f.startAt ? new Date(f.startAt) : null, endAt: f.endAt ? new Date(f.endAt) : null, timeZone: f.timeZone, location: f.location,
      // Attendees are recorded, never invited.
      participants: (f.attendees || []).map((email) => ({ email, external: true, invited: false })),
    };
    if (existingId) return db.activity.update({ where: { id: existingId }, data });
    return db.activity.create({ data: { ...data, organizationId: org, status: "Scheduled", source: `Integration: ${providerKey}`, ownerMembershipId: connection.connectedMembershipId || run.initiatedByMembershipId || null, createdByMembershipId: run.initiatedByMembershipId || null } });
  }
  if (entityType === "issue") {
    const projectId = config.filters?.projectId;
    const project = projectId ? await db.project.findFirst({ where: { id: projectId, organizationId: org } }) : null;
    if (!project) throw new IntegrationError(KINDS.PERMANENT, "Choose the CRM project that imported issues go into (filters.projectId).");
    const board = await ensureDefaultBoard(db, project);
    const column = columnForStatus(board, f.state === "closed" ? "Done" : "To Do") || board.columns[0];
    const data = { title: f.title || "(untitled)", description: f.description, columnId: column.id, status: column.name, statusCategory: column.category, completedAt: column.category === "Completed" ? new Date() : null };
    if (existingId) return db.task.update({ where: { id: existingId }, data });
    const taskNumber = await nextDocumentNumber(db, org, "Task");
    return db.task.create({ data: { ...data, organizationId: org, projectId: project.id, boardId: board.id, taskNumber, createdByMembershipId: run.initiatedByMembershipId || null, reporterMembershipId: run.initiatedByMembershipId || null } });
  }
  if (entityType === "financial_transaction") {
    const accountId = config.filters?.financialAccountId;
    const account = accountId ? await db.financialAccount.findFirst({ where: { id: accountId, organizationId: org } }) : null;
    if (!account) throw new IntegrationError(KINDS.PERMANENT, "Choose the financial account that imported transactions go into (filters.financialAccountId).");
    if (f.currency !== account.currency) throw new IntegrationError(KINDS.PERMANENT, `A ${f.currency} transaction can't go into a ${account.currency} account.`);
    // Imported for reconciliation preview only — never matched, posted or paid here.
    if (existingId) return db.statementLine.update({ where: { id: existingId }, data: { description: f.description || "(no description)", reference: f.reference, amount: f.amount, direction: f.direction, transactionDate: new Date(f.transactionDate) } });
    const importId = await importFor(db, run, account);
    return db.statementLine.create({
      data: {
        organizationId: org, importId, financialAccountId: account.id, rowNumber: 0, transactionDate: new Date(f.transactionDate), description: f.description || "(no description)",
        reference: f.reference, direction: f.direction, amount: f.amount, currency: f.currency, fingerprint: checksum({ provider: providerKey, externalId: normalized.externalId }),
      },
    });
  }
  throw new IntegrationError(KINDS.UNSUPPORTED, `Sync of ${entityType} isn't supported.`);
}

// One statement import record per sync run and account.
async function importFor(db, run, account) {
  const checksumKey = `integration-run:${run.id}`;
  const existing = await db.statementImport.findFirst({ where: { financialAccountId: account.id, checksum: checksumKey } });
  if (existing) return existing.id;
  const created = await db.statementImport.create({ data: { organizationId: account.organizationId, financialAccountId: account.id, checksum: checksumKey, fileName: `Provider import (${run.capability})`, importedByMembershipId: run.initiatedByMembershipId || null, lineCount: 0 } });
  return created.id;
}
