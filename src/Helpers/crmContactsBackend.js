// Backend-mode data source for the Contacts pages
// (VITE_BACKEND_CRM_SALES_MODE=true). Same approach as crmLeadsBackend.js:
// translate between the Contacts UI's mock-era field names and /crm/contacts.
import * as crm from "./backendCrmClient";
import { orgId, ownersMap, ownerFields, ownerAndPagingParams, activityTimeline, listNotesFor, addNoteTo, listAll } from "./crmBackendCommon";

export const BACKEND_ENABLED = crm.BACKEND_CRM_SALES_MODE_ENABLED;

// UI name → API name, for fields that exist on both sides under different
// names. Applied in reverse when reading.
const RENAMED = {
  ownerId: "ownerMembershipId",
  nextFollowUp: "nextActionDate",
  timezone: "timeZone",
  emailAllowed: "emailOptIn",
  phoneAllowed: "phoneOptIn",
  smsAllowed: "smsOptIn",
  marketingAllowed: "marketingOptIn",
};

export function toUiContact(contact, ownersById = new Map(), notes = []) {
  if (!contact) return contact;
  const ui = { ...contact };
  for (const [uiName, apiName] of Object.entries(RENAMED)) ui[uiName] = contact[apiName] ?? (uiName === "ownerId" ? null : contact[apiName]);
  return {
    ...ui,
    ...ownerFields(contact, ownersById),
    companyId: contact.companyId || null,
    companyName: contact.company?.name || "",
    notes: contact.description || "",
    tags: [],
    consentHistory: [],
    tasks: Array.isArray(contact.tasks) ? contact.tasks : [],
    files: Array.isArray(contact.files) ? contact.files : [],
    auditLog: [],
    activity: activityTimeline(contact, notes, ownersById, "Contact created"),
  };
}

export function toApiContact(payload = {}) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "notes") {
      if (typeof value === "string") out.description = value;
    } else if (key === "companyName" || key === "tags") {
      // derived / not stored on the contact
    } else {
      out[RENAMED[key] || key] = key === "ownerId" ? value || null : value;
    }
  }
  return out;
}

async function toApiParams(params = {}) {
  const out = await ownerAndPagingParams(params);
  if (out.sort === "nextFollowUp") out.sort = "nextActionDate";
  return out;
}

export async function listContacts(params) {
  const organizationId = orgId();
  const apiParams = await toApiParams(params);
  const [list, summary, owners] = await Promise.all([
    crm.listContacts(organizationId, apiParams),
    crm.getContactSummary(organizationId, apiParams),
    ownersMap(),
  ]);
  return {
    contacts: (list.contacts || []).map((c) => toUiContact(c, owners)),
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
    summary: {
      total: summary.total,
      prospects: summary.prospects,
      activeCustomers: summary.activeCustomers,
      followUpsDue: summary.followUpsDue,
      overdueFollowUps: summary.overdueFollowUps,
      doNotContact: summary.doNotContactCount,
    },
  };
}

export function listAllMatchingContacts(params) {
  return listAll(async (page, pageSize) => {
    const { contacts, total } = await listContacts({ ...params, page, pageSize });
    return { items: contacts, total };
  });
}

export async function getContact(contactId) {
  const [{ contact }, notes, owners] = await Promise.all([crm.getContact(orgId(), contactId), listNotesFor({ contactId }), ownersMap()]);
  return toUiContact(contact, owners, notes);
}

export async function createContact(payload) {
  const { contact } = await crm.createContact(orgId(), toApiContact(payload));
  return getContact(contact._id);
}

export async function updateContact(contactId, changes) {
  await crm.updateContact(orgId(), contactId, toApiContact(changes));
  return getContact(contactId);
}

export async function assignContact(contactId, ownerId) {
  if (!ownerId) return updateContact(contactId, { ownerId: null });
  await crm.assignContact(orgId(), contactId, ownerId);
  return getContact(contactId);
}

export async function addContactNote(contactId, body) {
  await addNoteTo({ contactId }, body);
  return getContact(contactId);
}

export async function archiveContact(contactId, reason) {
  // A contact that is some company's primary contact needs explicit
  // confirmation server-side; archiving from the Contacts page implies it.
  await crm.archiveContact(orgId(), contactId, reason, true);
  return getContact(contactId);
}

export async function restoreContact(contactId) {
  await crm.restoreContact(orgId(), contactId);
  return getContact(contactId);
}

async function bulk(payload) {
  await crm.bulkContacts(orgId(), payload);
  return Promise.all(payload.ids.map((id) => getContact(id).catch(() => null))).then((list) => list.filter(Boolean));
}

export const bulkAssignContacts = (ids, ownerId) => bulk({ action: "assign", ids, ownerMembershipId: ownerId });
export const bulkLifecycleContacts = (ids, lifecycleStage) => bulk({ action: "lifecycle", ids, lifecycleStage });
export const bulkArchiveContacts = (ids, reason) => bulk({ action: "archive", ids, reason });
