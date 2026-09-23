// Backend-mode data source for the Companies pages
// (VITE_BACKEND_CRM_SALES_MODE=true). The Companies UI keeps the full list in
// the store and filters/pages client-side (other modules read that same
// list), so this loads every company in the organization, archived included.
import * as crm from "./backendCrmClient";
import { orgId, ownersMap, ownerFields, activityTimeline, listNotesFor, addNoteTo, listAll } from "./crmBackendCommon";

export const BACKEND_ENABLED = crm.BACKEND_CRM_SALES_MODE_ENABLED;

// UI name → API name for fields both sides have under different names.
const RENAMED = {
  ownerId: "ownerMembershipId",
  companySize: "size",
  accountType: "companyType",
  assignedTeam: "team",
  address: "addressLine1",
  timezone: "timeZone",
  nextFollowUp: "nextActionDate",
};

export function toUiCompany(company, ownersById = new Map(), notes = []) {
  if (!company) return company;
  const ui = { ...company };
  for (const [uiName, apiName] of Object.entries(RENAMED)) ui[uiName] = company[apiName] ?? null;
  return {
    ...ui,
    ...ownerFields(company, ownersById),
    primaryDomain: company.normalizedDomain || null,
    primaryContactId: company.contactRelationships?.[0]?.contactId || null,
    notes: company.description || "",
    tags: [],
    tasks: Array.isArray(company.tasks) ? company.tasks : [],
    files: Array.isArray(company.files) ? company.files : [],
    auditLog: [],
    activity: activityTimeline(company, notes, ownersById, "Company created"),
  };
}

export function toApiCompany(payload = {}) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "notes") {
      if (typeof value === "string") out.description = value;
    } else if (["primaryDomain", "primaryContactId", "tags", "ownerName"].includes(key)) {
      // derived server-side, or managed through the contact-link endpoints
    } else {
      out[RENAMED[key] || key] = key === "ownerId" ? value || null : value;
    }
  }
  return out;
}

export async function listCompanies() {
  const organizationId = orgId();
  const owners = await ownersMap();
  const fetchAll = (archived) =>
    listAll(async (page, pageSize) => {
      const { companies, total } = await crm.listCompanies(organizationId, { page, pageSize, archived });
      return { items: companies || [], total };
    });
  const [active, archived] = await Promise.all([fetchAll("false"), fetchAll("true")]);
  return [...active, ...archived].map((c) => toUiCompany(c, owners));
}

export async function getCompany(companyId) {
  const [{ company }, notes, owners] = await Promise.all([crm.getCompany(orgId(), companyId), listNotesFor({ companyId }), ownersMap()]);
  return toUiCompany(company, owners, notes);
}

export async function createCompany(payload) {
  const { company } = await crm.createCompany(orgId(), toApiCompany(payload));
  return getCompany(company._id);
}

export async function updateCompany(companyId, changes) {
  await crm.updateCompany(orgId(), companyId, toApiCompany(changes));
  return getCompany(companyId);
}

export async function assignCompany(companyId, ownerId) {
  if (!ownerId) return updateCompany(companyId, { ownerId: null });
  await crm.assignCompany(orgId(), companyId, ownerId);
  return getCompany(companyId);
}

export async function addCompanyNote(companyId, body) {
  await addNoteTo({ companyId }, body);
  return getCompany(companyId);
}

export async function archiveCompany(companyId, reason) {
  await crm.archiveCompany(orgId(), companyId, reason);
  return getCompany(companyId);
}

export async function restoreCompany(companyId) {
  await crm.restoreCompany(orgId(), companyId);
  return getCompany(companyId);
}

export async function linkContact(companyId, contactId) {
  await crm.linkCompanyContact(orgId(), companyId, { contactId });
  return getCompany(companyId);
}

export async function unlinkContact(companyId, contactId) {
  await crm.unlinkCompanyContact(orgId(), companyId, contactId);
  return getCompany(companyId);
}

// Marking a primary contact links the contact first if it isn't linked yet
// (linking is idempotent server-side), then flags the link as primary.
export async function setPrimaryContact(companyId, contactId) {
  await crm.linkCompanyContact(orgId(), companyId, { contactId, isPrimaryContact: true });
  return getCompany(companyId);
}

async function bulk(payload) {
  await crm.bulkCompanies(orgId(), payload);
  return Promise.all(payload.ids.map((id) => getCompany(id).catch(() => null))).then((list) => list.filter(Boolean));
}

export const bulkAssignCompanies = (ids, ownerId) => bulk({ action: "assign", ids, ownerMembershipId: ownerId });
export const bulkLifecycleCompanies = (ids, lifecycleStage) => bulk({ action: "lifecycle", ids, lifecycleStage });
export const bulkArchiveCompanies = (ids, reason) => bulk({ action: "archive", ids, reason });
