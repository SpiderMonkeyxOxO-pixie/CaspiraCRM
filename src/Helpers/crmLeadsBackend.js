// Backend-mode data source for the Leads pages (VITE_BACKEND_CRM_MODE=true).
// Translates between the shape the Leads UI was built against (the mock
// layer's — ownerId/nextFollowUp/notes-as-text/activity timeline) and the
// real /crm/leads API (ownerMembershipId/nextActionDate/description/
// CrmNote rows), so leadsSlice.js can switch data sources without the
// pages changing. Everything is scoped to the active organization picked
// at login (backendSession.js).
import * as crm from "./backendCrmClient";
import { listMembers } from "./backendAuthClient";
import { getActiveOrganizationId } from "./backendSession";

export const BACKEND_CRM_MODE_ENABLED = crm.BACKEND_CRM_MODE_ENABLED;

const MAX_PAGE_SIZE = 100; // server cap — larger requests are paged through

export class BackendNotSupportedError extends Error {}

export function notSupported(what) {
  return new BackendNotSupportedError(`${what} isn't available with the real backend yet.`);
}

function orgId() {
  const id = getActiveOrganizationId();
  if (!id) throw new Error("No active organization — log out and back in.");
  return id;
}

// --- Owners (organization members) ---

let ownersPromise = null;

// [{ id: membershipId, userId, name, role }] — the Leads owner pickers use
// these ids as `ownerId`, so they round-trip to ownerMembershipId directly.
// A role without members:view gets a 404/403 here; that degrades to an
// empty list ("Unassigned" only) rather than breaking the page.
export function fetchCrmOwners() {
  ownersPromise ||= listMembers(orgId(), { pageSize: 100 })
    .then(({ members }) =>
      (members || [])
        .filter((m) => m.status === "Active")
        .map((m) => ({ id: m._id, userId: m.userId, name: m.user?.name || m.user?.username || "Member", role: m.roles?.[0]?.name || "" }))
    )
    .catch(() => []);
  return ownersPromise;
}

export function resetCrmOwnersCache() {
  ownersPromise = null;
}

// --- Shape translation ---

function noteToActivity(note, ownersById) {
  return {
    _id: note._id,
    type: "note",
    actor: ownersById.get(note.authorMembershipId)?.name || "Member",
    at: note.createdAt,
    description: note.body,
    meta: {},
  };
}

export function toUiLead(lead, ownersById = new Map(), notes = []) {
  if (!lead) return lead;
  const converted = lead.convertedContactId || lead.convertedCompanyId || lead.convertedDealId;
  return {
    ...lead,
    ownerId: lead.ownerMembershipId || null,
    ownerName: ownersById.get(lead.ownerMembershipId)?.name || (lead.ownerMembershipId ? "Member" : null),
    nextFollowUp: lead.nextActionDate || null,
    notes: lead.description || "",
    tags: [],
    tasks: Array.isArray(lead.tasks) ? lead.tasks : [],
    files: Array.isArray(lead.files) ? lead.files : [],
    auditLog: [],
    convertedTo: converted ? { companyId: lead.convertedCompanyId, contactId: lead.convertedContactId, dealId: lead.convertedDealId } : null,
    activity: [
      { _id: `${lead._id}-created`, type: "created", actor: "System", at: lead.createdAt, description: "Lead created", meta: {} },
      ...notes.map((n) => noteToActivity(n, ownersById)),
    ].sort((a, b) => new Date(a.at) - new Date(b.at)),
  };
}

// UI form/changes payload → API fields. Unknown UI-only fields are left for
// the server to drop; only the renamed ones are translated here.
export function toApiLead(payload = {}) {
  const { ownerId, nextFollowUp, notes, ...rest } = payload;
  const out = { ...rest };
  if ("ownerId" in payload) out.ownerMembershipId = ownerId || null;
  if ("nextFollowUp" in payload) out.nextActionDate = nextFollowUp || null;
  if ("notes" in payload && typeof notes === "string") out.description = notes;
  return out;
}

async function currentMembershipId(owners) {
  let me = null;
  try {
    me = JSON.parse(localStorage.getItem("data") || "null");
  } catch {
    me = null;
  }
  return owners.find((o) => o.userId === me?._id)?.id || null;
}

async function toApiParams(params = {}) {
  const { ownerId, sort, pageSize, ...rest } = params;
  const out = { ...rest };
  if (ownerId === "me") out.ownerMembershipId = (await currentMembershipId(await fetchCrmOwners())) || "none";
  else if (ownerId) out.ownerMembershipId = ownerId;
  if (sort) out.sort = sort === "nextFollowUp" ? "nextActionDate" : sort;
  out.pageSize = Math.min(MAX_PAGE_SIZE, Number(pageSize) || 20);
  return out;
}

async function ownersMap() {
  return new Map((await fetchCrmOwners()).map((o) => [o.id, o]));
}

// --- Operations the leads slice calls ---

export async function listLeads(params) {
  const organizationId = orgId();
  const apiParams = await toApiParams(params);
  // The summary takes the same filters as the list (it ignores paging).
  const [list, summary, owners] = await Promise.all([
    crm.listLeads(organizationId, apiParams),
    crm.getLeadSummary(organizationId, apiParams),
    ownersMap(),
  ]);
  return {
    leads: (list.leads || []).map((l) => toUiLead(l, owners)),
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
    summary: {
      total: summary.total,
      open: summary.open,
      new: summary.new,
      qualified: summary.qualified,
      followUpsDue: summary.followUpsDue,
      overdueFollowUps: summary.overdueFollowUps,
      conversionRate: Math.round((summary.conversionRate || 0) * 100),
    },
  };
}

export async function listAllMatchingLeads(params) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const { leads, total } = await listLeads({ ...params, page, pageSize: MAX_PAGE_SIZE });
    all.push(...leads);
    if (all.length >= total || leads.length === 0) return all;
  }
}

export async function getLead(leadId) {
  const organizationId = orgId();
  const [{ lead }, { notes }, owners] = await Promise.all([
    crm.getLead(organizationId, leadId),
    crm.listNotes(organizationId, { leadId }).catch(() => ({ notes: [] })),
    ownersMap(),
  ]);
  return toUiLead(lead, owners, notes || []);
}

export async function createLead(payload) {
  const { lead } = await crm.createLead(orgId(), toApiLead(payload));
  return toUiLead(lead, await ownersMap());
}

export async function updateLead(leadId, changes) {
  await crm.updateLead(orgId(), leadId, toApiLead(changes));
  return getLead(leadId);
}

export async function assignLead(leadId, ownerId) {
  if (!ownerId) return updateLead(leadId, { ownerId: null });
  await crm.assignLead(orgId(), leadId, ownerId);
  return getLead(leadId);
}

export async function addLeadNote(leadId, body) {
  await crm.createNote(orgId(), { leadId, body });
  return getLead(leadId);
}

export async function archiveLead(leadId, reason) {
  await crm.archiveLead(orgId(), leadId, reason);
  return getLead(leadId);
}

export async function restoreLead(leadId) {
  await crm.restoreLead(orgId(), leadId);
  return getLead(leadId);
}

export async function convertLead(leadId) {
  const idempotencyKey = globalThis.crypto?.randomUUID?.() || `${leadId}-${Date.now()}`;
  const result = await crm.convertLead(orgId(), leadId, {}, idempotencyKey);
  return { ...result, lead: await getLead(leadId) };
}

// Bulk endpoints return counts, not records — re-read the affected leads so
// the list updates in place exactly as it does in mock mode.
async function bulk(payload) {
  await crm.bulkLeads(orgId(), payload);
  return Promise.all(payload.ids.map((id) => getLead(id).catch(() => null))).then((leads) => leads.filter(Boolean));
}

export const bulkAssignLeads = (ids, ownerId) => bulk({ action: "assign", ids, ownerMembershipId: ownerId });
export const bulkStatusLeads = (ids, status, reason) => bulk({ action: "status", ids, status, reason });
export const bulkArchiveLeads = (ids, reason) => bulk({ action: "archive", ids, reason });
