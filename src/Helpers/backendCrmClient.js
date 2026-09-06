// Typed adapter for Backend Phase 2's CRM persistence surface
// (/api/v1/crm/{leads,contacts,companies,activities,notes,tags}). Same
// conventions as backendAuthClient.js: httpOnly session cookies, no token
// in localStorage, double-submit CSRF, one-shot refresh-on-401. Deliberately
// NOT wired into the live CRM pages/redux slices this phase — see
// docs/BACKEND_PHASE2.md's "Frontend adoption" section. The mock CRM layer
// (mockCrmData.js, redux/crm/*Slice.js) stays the active data source until
// that switch is made; this file and the mock layer are never mixed in the
// same request.
import axios from "axios";

const BASE_URL = import.meta.env.VITE_BACKEND_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1";

// Separate from VITE_BACKEND_AUTH_MODE (Phase 1) and VITE_USE_MOCK_API
// (legacy mock gate) — never silently mixed with either. A caller who
// enables CRM backend mode without also enabling backend auth mode gets
// a client that will simply 401 on every request, by design: CRM data
// requires a real session, and this file draws no conclusions about
// which auth mode is active.
export const BACKEND_CRM_MODE_ENABLED = import.meta.env.VITE_BACKEND_CRM_MODE === "true";

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const client = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

client.interceptors.request.use((config) => {
  if (!["get", "head", "options"].includes((config.method || "get").toLowerCase())) {
    const csrfToken = readCookie("csrm_csrf");
    if (csrfToken) config.headers["X-CSRF-Token"] = csrfToken;
  }
  return config;
});

let refreshInFlight = null;
client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original?._retried && !original?.url?.includes("/auth/refresh") && !original?.url?.includes("/auth/login")) {
      original._retried = true;
      try {
        refreshInFlight ||= client.post("/auth/refresh");
        await refreshInFlight;
        refreshInFlight = null;
        return client(original);
      } catch (refreshError) {
        refreshInFlight = null;
        throw refreshError;
      }
    }
    throw error;
  }
);

// Every write that touches an object with a `version` returns a machine-
// readable CRM_VERSION_CONFLICT (409) on a stale write — callers should
// catch this specifically (e.g. `err.response?.data?.code === "CRM_VERSION_CONFLICT"`)
// and re-fetch rather than blindly retrying the same payload.
function withOrg(organizationId, params = {}) {
  return { ...params, organizationId };
}

// --- Leads ---
export const listLeads = (organizationId, params) => client.get("/crm/leads", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getLead = (organizationId, leadId) => client.get(`/crm/leads/${leadId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createLead = (organizationId, payload) => client.post("/crm/leads", { ...payload, organizationId }).then((r) => r.data);
export const updateLead = (organizationId, leadId, changes) => client.patch(`/crm/leads/${leadId}`, { ...changes, organizationId }).then((r) => r.data);
export const archiveLead = (organizationId, leadId, reason) => client.post(`/crm/leads/${leadId}/archive`, { organizationId, reason }).then((r) => r.data);
export const restoreLead = (organizationId, leadId) => client.post(`/crm/leads/${leadId}/restore`, { organizationId }).then((r) => r.data);
export const assignLead = (organizationId, leadId, ownerMembershipId) => client.post(`/crm/leads/${leadId}/assign`, { organizationId, ownerMembershipId }).then((r) => r.data);
export const getLeadDuplicateCandidates = (organizationId, leadId) => client.get(`/crm/leads/${leadId}/duplicate-candidates`, { params: withOrg(organizationId) }).then((r) => r.data);
export const convertLead = (organizationId, leadId, payload, idempotencyKey) =>
  client.post(`/crm/leads/${leadId}/convert`, { ...payload, organizationId }, { headers: { "Idempotency-Key": idempotencyKey } }).then((r) => r.data);
export const getLeadSummary = (organizationId, extraParams) => client.get("/crm/leads/summary", { params: withOrg(organizationId, extraParams) }).then((r) => r.data);
export const bulkLeads = (organizationId, payload) => client.post("/crm/leads/bulk", { ...payload, organizationId }).then((r) => r.data);

// --- Contacts ---
export const listContacts = (organizationId, params) => client.get("/crm/contacts", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getContact = (organizationId, contactId) => client.get(`/crm/contacts/${contactId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createContact = (organizationId, payload) => client.post("/crm/contacts", { ...payload, organizationId }).then((r) => r.data);
export const updateContact = (organizationId, contactId, changes) => client.patch(`/crm/contacts/${contactId}`, { ...changes, organizationId }).then((r) => r.data);
export const archiveContact = (organizationId, contactId, reason, confirmPrimaryReassignment) =>
  client.post(`/crm/contacts/${contactId}/archive`, { organizationId, reason }, { params: confirmPrimaryReassignment ? { confirmPrimaryReassignment: "true" } : undefined }).then((r) => r.data);
export const restoreContact = (organizationId, contactId) => client.post(`/crm/contacts/${contactId}/restore`, { organizationId }).then((r) => r.data);
export const assignContact = (organizationId, contactId, ownerMembershipId) => client.post(`/crm/contacts/${contactId}/assign`, { organizationId, ownerMembershipId }).then((r) => r.data);
export const getContactDuplicateCandidates = (organizationId, contactId) => client.get(`/crm/contacts/${contactId}/duplicate-candidates`, { params: withOrg(organizationId) }).then((r) => r.data);
export const previewContactMerge = (organizationId, contactId, destinationId) => client.get(`/crm/contacts/${contactId}/merge-preview`, { params: withOrg(organizationId, { destinationId }) }).then((r) => r.data);
export const mergeContacts = (organizationId, contactId, payload, idempotencyKey) =>
  client.post(`/crm/contacts/${contactId}/merge`, { ...payload, organizationId }, { headers: { "Idempotency-Key": idempotencyKey } }).then((r) => r.data);
export const getContactSummary = (organizationId, extraParams) => client.get("/crm/contacts/summary", { params: withOrg(organizationId, extraParams) }).then((r) => r.data);
export const bulkContacts = (organizationId, payload) => client.post("/crm/contacts/bulk", { ...payload, organizationId }).then((r) => r.data);

// --- Companies ---
export const listCompanies = (organizationId, params) => client.get("/crm/companies", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getCompany = (organizationId, companyId) => client.get(`/crm/companies/${companyId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createCompany = (organizationId, payload) => client.post("/crm/companies", { ...payload, organizationId }).then((r) => r.data);
export const updateCompany = (organizationId, companyId, changes) => client.patch(`/crm/companies/${companyId}`, { ...changes, organizationId }).then((r) => r.data);
export const archiveCompany = (organizationId, companyId, reason) => client.post(`/crm/companies/${companyId}/archive`, { organizationId, reason }).then((r) => r.data);
export const restoreCompany = (organizationId, companyId) => client.post(`/crm/companies/${companyId}/restore`, { organizationId }).then((r) => r.data);
export const assignCompany = (organizationId, companyId, ownerMembershipId) => client.post(`/crm/companies/${companyId}/assign`, { organizationId, ownerMembershipId }).then((r) => r.data);
export const getCompanyDuplicateCandidates = (organizationId, companyId) => client.get(`/crm/companies/${companyId}/duplicate-candidates`, { params: withOrg(organizationId) }).then((r) => r.data);
export const previewCompanyMerge = (organizationId, companyId, destinationId) => client.get(`/crm/companies/${companyId}/merge-preview`, { params: withOrg(organizationId, { destinationId }) }).then((r) => r.data);
export const mergeCompanies = (organizationId, companyId, payload, idempotencyKey) =>
  client.post(`/crm/companies/${companyId}/merge`, { ...payload, organizationId }, { headers: { "Idempotency-Key": idempotencyKey } }).then((r) => r.data);
export const listCompanyContacts = (organizationId, companyId) => client.get(`/crm/companies/${companyId}/contacts`, { params: withOrg(organizationId) }).then((r) => r.data);
export const linkCompanyContact = (organizationId, companyId, payload) => client.post(`/crm/companies/${companyId}/contacts`, { ...payload, organizationId }).then((r) => r.data);
export const updateCompanyContact = (organizationId, companyId, contactId, changes, confirmArchivedPrimary) =>
  client.patch(`/crm/companies/${companyId}/contacts/${contactId}`, { ...changes, organizationId }, { params: confirmArchivedPrimary ? { confirmArchivedPrimary: "true" } : undefined }).then((r) => r.data);
export const unlinkCompanyContact = (organizationId, companyId, contactId) => client.delete(`/crm/companies/${companyId}/contacts/${contactId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const getCompanySummary = (organizationId, extraParams) => client.get("/crm/companies/summary", { params: withOrg(organizationId, extraParams) }).then((r) => r.data);
export const bulkCompanies = (organizationId, payload) => client.post("/crm/companies/bulk", { ...payload, organizationId }).then((r) => r.data);

// --- Activities ---
export const listActivities = (organizationId, params) => client.get("/crm/activities", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const getActivity = (organizationId, activityId) => client.get(`/crm/activities/${activityId}`, { params: withOrg(organizationId) }).then((r) => r.data);
export const createActivity = (organizationId, payload) => client.post("/crm/activities", { ...payload, organizationId }).then((r) => r.data);
export const updateActivity = (organizationId, activityId, changes) => client.patch(`/crm/activities/${activityId}`, { ...changes, organizationId }).then((r) => r.data);
export const completeActivity = (organizationId, activityId, payload) => client.post(`/crm/activities/${activityId}/complete`, { ...payload, organizationId }).then((r) => r.data);
export const cancelActivity = (organizationId, activityId, reason) => client.post(`/crm/activities/${activityId}/cancel`, { organizationId, reason }).then((r) => r.data);
export const reopenActivity = (organizationId, activityId) => client.post(`/crm/activities/${activityId}/reopen`, { organizationId }).then((r) => r.data);
export const archiveActivity = (organizationId, activityId, reason) => client.post(`/crm/activities/${activityId}/archive`, { organizationId, reason }).then((r) => r.data);
export const restoreActivity = (organizationId, activityId) => client.post(`/crm/activities/${activityId}/restore`, { organizationId }).then((r) => r.data);
export const assignActivity = (organizationId, activityId, assignedMembershipId) => client.post(`/crm/activities/${activityId}/assign`, { organizationId, assignedMembershipId }).then((r) => r.data);
export const getActivitySummary = (organizationId, extraParams) => client.get("/crm/activities/summary", { params: withOrg(organizationId, extraParams) }).then((r) => r.data);
export const bulkActivities = (organizationId, payload) => client.post("/crm/activities/bulk", { ...payload, organizationId }).then((r) => r.data);

// --- Notes (exactly one of leadId/contactId/companyId/activityId) ---
export const listNotes = (organizationId, recordRef) => client.get("/crm/notes", { params: withOrg(organizationId, recordRef) }).then((r) => r.data);
export const createNote = (organizationId, payload) => client.post("/crm/notes", { ...payload, organizationId }).then((r) => r.data);
export const updateNote = (organizationId, noteId, changes) => client.patch(`/crm/notes/${noteId}`, { ...changes, organizationId }).then((r) => r.data);
export const archiveNote = (organizationId, noteId) => client.post(`/crm/notes/${noteId}/archive`, { organizationId }).then((r) => r.data);

// --- Tags ---
export const listTags = (organizationId, params) => client.get("/crm/tags", { params: withOrg(organizationId, params) }).then((r) => r.data);
export const createTag = (organizationId, payload) => client.post("/crm/tags", { ...payload, organizationId }).then((r) => r.data);
export const updateTag = (organizationId, tagId, changes) => client.patch(`/crm/tags/${tagId}`, { ...changes, organizationId }).then((r) => r.data);
export const archiveTag = (organizationId, tagId) => client.post(`/crm/tags/${tagId}/archive`, { organizationId }).then((r) => r.data);
export const assignTag = (organizationId, tagId, recordRef) => client.post("/crm/tags/assign", { organizationId, tagId, ...recordRef }).then((r) => r.data);
export const unassignTag = (organizationId, tagId, recordRef) => client.delete(`/crm/tags/${tagId}/assignment`, { params: withOrg(organizationId, recordRef) }).then((r) => r.data);
export const listTagsForRecord = (organizationId, recordRef) => client.get("/crm/tags/for-record", { params: withOrg(organizationId, recordRef) }).then((r) => r.data);

export default client;
