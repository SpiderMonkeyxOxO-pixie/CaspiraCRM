// Backend-mode data source for the Leads pages (VITE_BACKEND_CRM_MODE=true).
// Translates between the shape the Leads UI was built against (the mock
// layer's — ownerId/nextFollowUp/notes-as-text/activity timeline) and the
// real /crm/leads API (ownerMembershipId/nextActionDate/description/
// CrmNote rows), so leadsSlice.js can switch data sources without the
// pages changing. Everything is scoped to the active organization picked
// at login (backendSession.js).
import * as crm from "./backendCrmClient";
import {
  orgId, ownersMap, ownerFields, ownerAndPagingParams, activityTimeline, listNotesFor, addNoteTo, listAll, newIdempotencyKey,
} from "./crmBackendCommon";

// Leads switched to the backend first, under their own flag; the other
// CRM/Sales modules share VITE_BACKEND_CRM_SALES_MODE.
export const BACKEND_CRM_MODE_ENABLED = crm.BACKEND_CRM_MODE_ENABLED;
export { notSupported, BackendNotSupportedError, fetchCrmOwners, resetCrmOwnersCache } from "./crmBackendCommon";

// --- Shape translation ---

export function toUiLead(lead, ownersById = new Map(), notes = []) {
  if (!lead) return lead;
  const converted = lead.convertedContactId || lead.convertedCompanyId || lead.convertedDealId;
  return {
    ...lead,
    ...ownerFields(lead, ownersById),
    nextFollowUp: lead.nextActionDate || null,
    notes: lead.description || "",
    tags: [],
    tasks: Array.isArray(lead.tasks) ? lead.tasks : [],
    files: Array.isArray(lead.files) ? lead.files : [],
    auditLog: [],
    convertedTo: converted ? { companyId: lead.convertedCompanyId, contactId: lead.convertedContactId, dealId: lead.convertedDealId } : null,
    activity: activityTimeline(lead, notes, ownersById, "Lead created"),
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

async function toApiParams(params = {}) {
  const out = await ownerAndPagingParams(params);
  if (out.sort === "nextFollowUp") out.sort = "nextActionDate";
  return out;
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

export function listAllMatchingLeads(params) {
  return listAll(async (page, pageSize) => {
    const { leads, total } = await listLeads({ ...params, page, pageSize });
    return { items: leads, total };
  });
}

export async function getLead(leadId) {
  const [{ lead }, notes, owners] = await Promise.all([crm.getLead(orgId(), leadId), listNotesFor({ leadId }), ownersMap()]);
  return toUiLead(lead, owners, notes);
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
  await addNoteTo({ leadId }, body);
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
  const result = await crm.convertLead(orgId(), leadId, {}, newIdempotencyKey(leadId));
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
