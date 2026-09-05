// Local, frontend-only mock of the backend API. Intercepts every call made
// through `axiosInstance` so the UI can be reviewed without a real server.
// Toggle off by setting VITE_USE_MOCK_API=false in a local .env file.
import MockAdapter from "axios-mock-adapter";
import { faker } from "@faker-js/faker";
import * as crm from "./mockCrmData";
import * as activitiesData from "./mockActivitiesData";
import * as catalog from "./mockCatalogData";
import * as priceBookData from "./mockPriceBookData";
import * as quoteData from "./mockQuoteData";
import * as orderData from "./mockOrderData";
import * as contractData from "./mockContractData";
import * as support from "./mockSupportData";
import * as projects from "./mockProjectsData";
import * as marketing from "./mockMarketingData";
import * as finance from "./mockFinanceData";
import { isValidOwner, isValidDepartment, CURRENT_MOCK_OWNER_ID } from "./mockUsersData";
import { getRoleLabel } from "../utils/roleLabels";
import * as rbac from "./mockRbacData";
import * as access from "./mockAccessData";
import * as integrations from "./mockIntegrationsData";
import * as salesMarketing from "./mockSalesMarketingData";
import * as supportComm from "./mockSupportCommunicationData";
import * as projectsDev from "./mockProjectsDevelopmentData";
import * as commerceFinance from "./mockCommerceFinanceData";
import * as documentsStorage from "./mockDocumentsStorageData";
import * as aiProviders from "./mockAiProvidersData";

const ROLES = ["Super-Admin", "Admin", "Team-Leader", "Checker", "User"];

// Stands in for auth middleware: every mock handler that enforces a
// permission reads the same session state a real backend would read off a
// verified token, rather than trusting anything the frontend claims.
const getCurrentRole = () => localStorage.getItem("role");
const getCurrentActor = () => {
  try {
    const data = JSON.parse(localStorage.getItem("data") || "null");
    return data?.name || data?.username || "Unknown";
  } catch {
    return "Unknown";
  }
};
const CRM_ROLES = ["Super-Admin", "Admin", "Team-Leader", "User"];
const isCrmUser = () => CRM_ROLES.includes(getCurrentRole());
const isSuperAdmin = () => getCurrentRole() === "Super-Admin";
const forbidden = (message) => [403, { message: message || "You do not have permission to perform this action" }];

const roleFromUsername = (username = "") => {
  const value = username.toLowerCase();
  if (value.includes("super")) return "Super-Admin";
  if (value.includes("admin")) return "Admin";
  if (value.includes("team") || value.includes("lead")) return "Team-Leader";
  if (value.includes("check")) return "Checker";
  return "User";
};

const makeUser = (overrides = {}) => ({
  _id: faker.database.mongodbObjectId(),
  name: faker.person.fullName(),
  username: faker.internet.username(),
  email: faker.internet.email(),
  role: faker.helpers.arrayElement(ROLES),
  department: faker.commerce.department(),
  avatar: faker.image.avatarGitHub(),
  fcmToken: null,
  ...overrides,
});

export function setupMock(axiosInstance) {
  const mock = new MockAdapter(axiosInstance, { delayResponse: 300 });

  // A real, specific System Owner login for demos — checked before the
  // generic username-substring role derivation below (which never checks a
  // password, unlike this one).
  const SYSTEM_OWNER_CREDENTIALS = { username: "caspirasolutionsowner@gmail.com", password: "Caspira2026" };

  mock.onPost(/\/user\/login$/).reply((config) => {
    const { username, password } = JSON.parse(config.data || "{}");

    if ((username || "").trim().toLowerCase() === SYSTEM_OWNER_CREDENTIALS.username) {
      if (password !== SYSTEM_OWNER_CREDENTIALS.password) {
        return [401, { message: "Invalid username or password" }];
      }
      const user = makeUser({ username, name: "System Owner", email: SYSTEM_OWNER_CREDENTIALS.username, role: "Super-Admin" });
      return [200, { token: "mock-jwt-token", user, require2FA: false }];
    }

    const role = roleFromUsername(username);
    const user = makeUser({ username, role });
    return [200, { token: "mock-jwt-token", user, require2FA: false }];
  });

  mock.onPost(/\/user\/verify-2fa$/).reply(() => {
    const user = makeUser({ role: "User" });
    return [200, { success: true, token: "mock-jwt-token", user }];
  });

  mock.onGet(/\/user\/me$/).reply(() => {
    const stored = JSON.parse(localStorage.getItem("data") || "null");
    // Never fabricate a random identity here — this endpoint is dispatched
    // unconditionally on every sidebar mount (see SubMenus.jsx). Fabricating
    // a user with a random role whenever "data" happens to be missing (e.g.
    // wiped by an unrelated 401 elsewhere) silently swaps the logged-in
    // user's whole identity/role out from under them instead of surfacing a
    // real "you're not logged in" failure.
    if (!stored) return [401, { message: "Not authenticated" }];
    return [200, { user: stored }];
  });

  mock.onPost(/\/user\/updateFCM$/).reply(() => {
    return [200, { success: true, user: { fcmToken: "mock-fcm-token" } }];
  });

  mock.onPost(/\/user\/logout$/).reply(200, { message: "Logged out" });

  mock.onGet(/\/user\/(all|departmentwise)$/).reply(() => {
    const users = faker.helpers.multiple(() => makeUser(), { count: 25 });
    return [200, { users }];
  });

  mock.onGet(/\/notification\//).reply(200, { notifications: [] });

  // ---- CRM: Leads ----
  // Field-level validation — the same rules the spec asks for, enforced here
  // (the "backend" stand-in) rather than only in the create-lead form.
  function validateLeadPayload(payload) {
    const errors = {};
    const hasPersonName = (payload.firstName || payload.lastName || payload.name || "").trim().length > 0;
    const hasCompanyName = (payload.companyName || payload.company || "").trim().length > 0;
    if (!hasPersonName && !hasCompanyName) {
      errors.name = "Provide a person name or a company name";
    }
    const hasEmail = (payload.email || "").trim().length > 0;
    const hasPhone = (payload.phone || "").trim().length > 0;
    if (!hasEmail && !hasPhone) {
      errors.email = "Provide at least one contact method (email or phone)";
      errors.phone = "Provide at least one contact method (email or phone)";
    }
    if (hasEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())) {
      errors.email = "Enter a valid email address";
    }
    if (payload.estimatedValue !== undefined && payload.estimatedValue !== "" && Number(payload.estimatedValue) < 0) {
      errors.estimatedValue = "Estimated value cannot be negative";
    }
    if (payload.nextFollowUp && Number.isNaN(new Date(payload.nextFollowUp).getTime())) {
      errors.nextFollowUp = "Enter a valid date";
    }
    if (payload.ownerId && !isValidOwner(payload.ownerId)) {
      errors.ownerId = "Select a valid owner";
    }
    if (payload.department && !isValidDepartment(payload.department)) {
      errors.department = "Select a valid department";
    }
    return errors;
  }

  mock.onPost(/\/crm\/leads\/[^/]+\/convert$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const leadId = config.url.match(/\/crm\/leads\/([^/]+)\/convert$/)[1];
    try {
      const result = crm.convertLeadRecord(leadId, getCurrentActor());
      return [200, result];
    } catch (err) {
      return [409, { message: err.message }];
    }
  });

  mock.onPost(/\/crm\/leads\/[^/]+\/archive$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const leadId = config.url.match(/\/crm\/leads\/([^/]+)\/archive$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive a lead" }];
    const lead = crm.archiveLeadRecord(leadId, reason, getCurrentActor());
    return lead ? [200, { lead }] : [404, { message: "Lead not found" }];
  });

  mock.onPost(/\/crm\/leads\/[^/]+\/restore$/).reply((config) => {
    if (!isSuperAdmin()) return forbidden(`Only a ${getRoleLabel("Super-Admin")} can restore an archived lead`);
    const leadId = config.url.match(/\/crm\/leads\/([^/]+)\/restore$/)[1];
    const lead = crm.restoreLeadRecord(leadId, getCurrentActor());
    return lead ? [200, { lead }] : [404, { message: "Lead not found" }];
  });

  mock.onPost(/\/crm\/leads\/[^/]+\/reopen$/).reply((config) => {
    if (!isSuperAdmin()) return forbidden(`Only a ${getRoleLabel("Super-Admin")} can reopen a converted lead`);
    const leadId = config.url.match(/\/crm\/leads\/([^/]+)\/reopen$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to reopen a converted lead" }];
    const lead = crm.reopenLeadRecord(leadId, reason, getCurrentActor());
    return lead ? [200, { lead }] : [404, { message: "Lead not found" }];
  });

  mock.onPost(/\/crm\/leads\/[^/]+\/notes$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const leadId = config.url.match(/\/crm\/leads\/([^/]+)\/notes$/)[1];
    const { message } = JSON.parse(config.data || "{}");
    if (!message?.trim()) return [400, { message: "Note cannot be empty" }];
    const lead = crm.addLeadNote(leadId, message, getCurrentActor());
    return lead ? [200, { lead }] : [404, { message: "Lead not found" }];
  });

  mock.onPost(/\/crm\/leads\/[^/]+\/activity$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const leadId = config.url.match(/\/crm\/leads\/([^/]+)\/activity$/)[1];
    const { type, description } = JSON.parse(config.data || "{}");
    if (!description?.trim()) return [400, { message: "Description is required" }];
    const lead = crm.logLeadActivity(leadId, type || "note", description, getCurrentActor());
    return lead ? [200, { lead }] : [404, { message: "Lead not found" }];
  });

  mock.onPost(/\/crm\/leads\/[^/]+\/tasks$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const leadId = config.url.match(/\/crm\/leads\/([^/]+)\/tasks$/)[1];
    const task = JSON.parse(config.data || "{}");
    if (!task.title?.trim() || !task.dueDate) return [400, { message: "Task title and due date are required" }];
    const lead = crm.createLeadTask(leadId, task, getCurrentActor());
    return lead ? [200, { lead }] : [404, { message: "Lead not found" }];
  });

  mock.onPut(/\/crm\/leads\/[^/]+\/tasks\/[^/]+$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const [, leadId, taskId] = config.url.match(/\/crm\/leads\/([^/]+)\/tasks\/([^/]+)$/);
    const lead = crm.updateLeadTask(leadId, taskId, JSON.parse(config.data || "{}"), getCurrentActor());
    return lead ? [200, { lead }] : [404, { message: "Lead or task not found" }];
  });

  mock.onPost(/\/crm\/leads\/[^/]+\/files$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const leadId = config.url.match(/\/crm\/leads\/([^/]+)\/files$/)[1];
    const lead = crm.addLeadFile(leadId, JSON.parse(config.data || "{}"), getCurrentActor());
    return lead ? [200, { lead }] : [404, { message: "Lead not found" }];
  });

  mock.onDelete(/\/crm\/leads\/[^/]+\/files\/[^/]+$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const [, leadId, fileId] = config.url.match(/\/crm\/leads\/([^/]+)\/files\/([^/]+)$/);
    const lead = crm.deleteLeadFile(leadId, fileId);
    return lead ? [200, { lead }] : [404, { message: "Lead or file not found" }];
  });

  mock.onPost(/\/crm\/leads\/bulk\/assign$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const { leadIds, ownerId } = JSON.parse(config.data || "{}");
    if (!isValidOwner(ownerId)) return [400, { message: "Select a valid owner" }];
    const updated = crm.bulkAssignLeads(leadIds || [], ownerId, getCurrentActor());
    return [200, { leads: updated }];
  });

  mock.onPost(/\/crm\/leads\/bulk\/status$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const { leadIds, status, reason } = JSON.parse(config.data || "{}");
    if (crm.REASON_REQUIRED_STATUSES.includes(status) && !reason?.trim()) {
      return [400, { message: `A reason is required to set status to ${status}` }];
    }
    const updated = crm.bulkStatusChangeLeads(leadIds || [], status, getCurrentActor());
    return [200, { leads: updated }];
  });

  mock.onPost(/\/crm\/leads\/bulk\/archive$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const { leadIds, reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive leads" }];
    const updated = crm.bulkArchiveLeads(leadIds || [], reason, getCurrentActor());
    return [200, { leads: updated }];
  });

  mock.onGet(/\/crm\/leads\/[^/]+\/audit$/).reply((config) => {
    if (!isSuperAdmin()) return forbidden(`Only a ${getRoleLabel("Super-Admin")} can view audit history`);
    const leadId = config.url.match(/\/crm\/leads\/([^/]+)\/audit$/)[1];
    const lead = crm.findLead(leadId);
    return lead ? [200, { auditLog: lead.auditLog }] : [404, { message: "Lead not found" }];
  });

  mock.onGet(/\/crm\/leads$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const params = { ...(config.params || {}) };
    // The mock session user isn't itself a CRM_TEAM roster member (there's no
    // real per-user identity model here), so "owner=me" is resolved to a
    // fixed roster id for the life of this mock — documented in the Leads
    // report rather than silently ignored.
    if (params.ownerId === "me") params.ownerId = CURRENT_MOCK_OWNER_ID;
    const result = crm.queryLeads(params);
    return [200, result];
  });

  mock.onGet(/\/crm\/leads\/[^/]+$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const leadId = config.url.match(/\/crm\/leads\/([^/]+)$/)[1];
    const lead = crm.findLead(leadId);
    return lead ? [200, { lead }] : [404, { message: "Lead not found" }];
  });

  mock.onPost(/\/crm\/leads$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const payload = JSON.parse(config.data || "{}");

    const errors = validateLeadPayload(payload);
    if (Object.keys(errors).length > 0) {
      return [400, { message: "Validation failed", errors }];
    }

    if (!payload.duplicateOverride) {
      const duplicates = crm.findDuplicateLeads(payload);
      if (duplicates.length > 0) {
        return [409, {
          message: "A possible duplicate lead already exists",
          duplicates: duplicates.map((d) => ({ lead: d.lead, reasons: d.reasons })),
        }];
      }
    } else if (!payload.overrideReason?.trim()) {
      return [400, { message: "Validation failed", errors: { overrideReason: "Explain why this is not a duplicate" } }];
    }

    const lead = crm.createLeadRecord(payload, getCurrentActor());
    return [201, { lead }];
  });

  mock.onPut(/\/crm\/leads\/[^/]+$/).reply((config) => {
    if (!isCrmUser()) return forbidden();
    const leadId = config.url.match(/\/crm\/leads\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");

    const errors = validateLeadPayload({ ...crm.findLead(leadId), ...changes });
    if (Object.keys(errors).length > 0) {
      return [400, { message: "Validation failed", errors }];
    }
    if (changes.status && crm.REASON_REQUIRED_STATUSES.includes(changes.status) && !changes.disqualifyReason?.trim()) {
      return [400, { message: "Validation failed", errors: { status: `A reason is required to set status to ${changes.status}` } }];
    }

    const lead = crm.updateLeadRecord(leadId, changes, getCurrentActor());
    return lead ? [200, { lead }] : [404, { message: "Lead not found" }];
  });

  // ---- CRM: Companies ----
  // Frontend-first phase, same as Contacts: no permission gating, no
  // server-shaped pagination (several unrelated pages — Support, Finance,
  // Projects, Marketing Segments, the CRM dashboard — already consume the
  // full unpaginated list; Companies filtering/sorting/paging happens
  // client-side in CompaniesList.jsx via queryCompaniesLocal).
  function validateCompanyPayload(payload) {
    const errors = {};
    if (!(payload.name || "").trim()) errors.name = "Company name is required";
    if (payload.website && payload.website.trim() && !/^https?:\/\/.+\..+/.test(payload.website.trim())) {
      errors.website = "Enter a valid website URL (including https://)";
    }
    if (payload.email && payload.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())) {
      errors.email = "Enter a valid email address";
    }
    if (payload.estimatedAnnualValue !== undefined && payload.estimatedAnnualValue !== "" && Number(payload.estimatedAnnualValue) < 0) {
      errors.estimatedAnnualValue = "Estimated annual value cannot be negative";
    }
    if (payload.renewalDate && Number.isNaN(new Date(payload.renewalDate).getTime())) {
      errors.renewalDate = "Enter a valid date";
    }
    if (payload.ownerId && !isValidOwner(payload.ownerId)) {
      errors.ownerId = "Select a valid owner";
    }
    return errors;
  }

  mock.onGet(/\/crm\/companies$/).reply(200, { companies: crm.companies });

  mock.onGet(/\/crm\/companies\/[^/]+\/duplicates$/).reply((config) => {
    const companyId = config.url.match(/\/crm\/companies\/([^/]+)\/duplicates$/)[1];
    return [200, { duplicates: crm.findDuplicateCompanies(config.params || {}, companyId) }];
  });

  mock.onGet(/\/crm\/companies\/[^/]+$/).reply((config) => {
    const companyId = config.url.match(/\/crm\/companies\/([^/]+)$/)[1];
    const company = crm.findCompany(companyId);
    return company ? [200, { company }] : [404, { message: "Company not found" }];
  });

  mock.onPost(/\/crm\/companies$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const errors = validateCompanyPayload(payload);
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors }];

    if (!payload.duplicateOverride) {
      const duplicates = crm.findDuplicateCompanies(payload);
      if (duplicates.length > 0) {
        return [409, { message: "A possible duplicate company already exists", duplicates: duplicates.map((d) => ({ company: d.company, reasons: d.reasons })) }];
      }
    } else if (!payload.overrideReason?.trim()) {
      return [400, { message: "Validation failed", errors: { overrideReason: "Explain why this is not a duplicate" } }];
    }

    const company = crm.createCompanyRecord(payload, getCurrentActor());
    if (payload.primaryContactId) {
      crm.linkContactToCompany(company._id, payload.primaryContactId, getCurrentActor());
      crm.setPrimaryContact(company._id, payload.primaryContactId, getCurrentActor());
    }
    return [201, { company }];
  });

  mock.onPut(/\/crm\/companies\/[^/]+$/).reply((config) => {
    const companyId = config.url.match(/\/crm\/companies\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");
    const errors = validateCompanyPayload({ ...crm.findCompany(companyId), ...changes });
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors }];
    const company = crm.updateCompanyRecord(companyId, changes, getCurrentActor());
    if (company && changes.primaryContactId) {
      crm.linkContactToCompany(companyId, changes.primaryContactId, getCurrentActor());
      crm.setPrimaryContact(companyId, changes.primaryContactId, getCurrentActor());
    }
    return company ? [200, { company }] : [404, { message: "Company not found" }];
  });

  mock.onPost(/\/crm\/companies\/[^/]+\/notes$/).reply((config) => {
    const companyId = config.url.match(/\/crm\/companies\/([^/]+)\/notes$/)[1];
    const { message } = JSON.parse(config.data || "{}");
    if (!message?.trim()) return [400, { message: "Note cannot be empty" }];
    const company = crm.addCompanyNote(companyId, message, getCurrentActor());
    return company ? [200, { company }] : [404, { message: "Company not found" }];
  });

  mock.onPost(/\/crm\/companies\/[^/]+\/activity$/).reply((config) => {
    const companyId = config.url.match(/\/crm\/companies\/([^/]+)\/activity$/)[1];
    const { type, description } = JSON.parse(config.data || "{}");
    if (!description?.trim()) return [400, { message: "Description is required" }];
    const company = crm.logCompanyActivity(companyId, type || "note", description, getCurrentActor());
    return company ? [200, { company }] : [404, { message: "Company not found" }];
  });

  mock.onPost(/\/crm\/companies\/[^/]+\/tasks$/).reply((config) => {
    const companyId = config.url.match(/\/crm\/companies\/([^/]+)\/tasks$/)[1];
    const task = JSON.parse(config.data || "{}");
    if (!task.title?.trim() || !task.dueDate) return [400, { message: "Task title and due date are required" }];
    const company = crm.createCompanyTask(companyId, task, getCurrentActor());
    return company ? [200, { company }] : [404, { message: "Company not found" }];
  });

  mock.onPut(/\/crm\/companies\/[^/]+\/tasks\/[^/]+$/).reply((config) => {
    const [, companyId, taskId] = config.url.match(/\/crm\/companies\/([^/]+)\/tasks\/([^/]+)$/);
    const company = crm.updateCompanyTask(companyId, taskId, JSON.parse(config.data || "{}"), getCurrentActor());
    return company ? [200, { company }] : [404, { message: "Company or task not found" }];
  });

  mock.onPost(/\/crm\/companies\/[^/]+\/files$/).reply((config) => {
    const companyId = config.url.match(/\/crm\/companies\/([^/]+)\/files$/)[1];
    const company = crm.addCompanyFile(companyId, JSON.parse(config.data || "{}"), getCurrentActor());
    return company ? [200, { company }] : [404, { message: "Company not found" }];
  });

  mock.onDelete(/\/crm\/companies\/[^/]+\/files\/[^/]+$/).reply((config) => {
    const [, companyId, fileId] = config.url.match(/\/crm\/companies\/([^/]+)\/files\/([^/]+)$/);
    const company = crm.deleteCompanyFile(companyId, fileId);
    return company ? [200, { company }] : [404, { message: "Company or file not found" }];
  });

  mock.onPost(/\/crm\/companies\/[^/]+\/archive$/).reply((config) => {
    const companyId = config.url.match(/\/crm\/companies\/([^/]+)\/archive$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive a company" }];
    const company = crm.archiveCompanyRecord(companyId, reason, getCurrentActor());
    return company ? [200, { company }] : [404, { message: "Company not found" }];
  });

  mock.onPost(/\/crm\/companies\/[^/]+\/restore$/).reply((config) => {
    const companyId = config.url.match(/\/crm\/companies\/([^/]+)\/restore$/)[1];
    const company = crm.restoreCompanyRecord(companyId, getCurrentActor());
    return company ? [200, { company }] : [404, { message: "Company not found" }];
  });

  mock.onPost(/\/crm\/companies\/[^/]+\/contacts\/[^/]+\/primary$/).reply((config) => {
    const [, companyId, contactId] = config.url.match(/\/crm\/companies\/([^/]+)\/contacts\/([^/]+)\/primary$/);
    const company = crm.setPrimaryContact(companyId, contactId, getCurrentActor());
    return company ? [200, { company }] : [404, { message: "Company not found" }];
  });

  mock.onPost(/\/crm\/companies\/[^/]+\/contacts$/).reply((config) => {
    const companyId = config.url.match(/\/crm\/companies\/([^/]+)\/contacts$/)[1];
    const { contactId } = JSON.parse(config.data || "{}");
    const company = crm.linkContactToCompany(companyId, contactId, getCurrentActor());
    return company ? [200, { company }] : [404, { message: "Company or contact not found" }];
  });

  mock.onDelete(/\/crm\/companies\/[^/]+\/contacts\/[^/]+$/).reply((config) => {
    const [, companyId, contactId] = config.url.match(/\/crm\/companies\/([^/]+)\/contacts\/([^/]+)$/);
    const company = crm.unlinkContactFromCompany(companyId, contactId, getCurrentActor());
    return company ? [200, { company }] : [404, { message: "Company or contact not found" }];
  });

  mock.onPost(/\/crm\/companies\/bulk\/assign$/).reply((config) => {
    const { companyIds, ownerId } = JSON.parse(config.data || "{}");
    if (!isValidOwner(ownerId)) return [400, { message: "Select a valid owner" }];
    return [200, { companies: crm.bulkAssignCompanies(companyIds || [], ownerId, getCurrentActor()) }];
  });

  mock.onPost(/\/crm\/companies\/bulk\/tag$/).reply((config) => {
    const { companyIds, tag } = JSON.parse(config.data || "{}");
    if (!tag?.trim()) return [400, { message: "A tag is required" }];
    return [200, { companies: crm.bulkTagCompanies(companyIds || [], tag.trim(), getCurrentActor()) }];
  });

  mock.onPost(/\/crm\/companies\/bulk\/lifecycle$/).reply((config) => {
    const { companyIds, lifecycleStage } = JSON.parse(config.data || "{}");
    return [200, { companies: crm.bulkLifecycleUpdateCompanies(companyIds || [], lifecycleStage, getCurrentActor()) }];
  });

  mock.onPost(/\/crm\/companies\/bulk\/archive$/).reply((config) => {
    const { companyIds, reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive" }];
    return [200, { companies: crm.bulkArchiveCompanies(companyIds || [], reason, getCurrentActor()) }];
  });

  // ---- CRM: Contacts ----
  // Frontend-first phase: no permission gating here (unlike Leads) — that is
  // explicitly deferred to the backend-integration phase. This layer only
  // validates shape/required fields so the UI has something real to react to.
  function validateContactPayload(payload) {
    const errors = {};
    const hasPersonName = (payload.firstName || payload.lastName || payload.name || "").trim().length > 0;
    if (!hasPersonName) errors.name = "Provide a first or last name";
    const hasEmail = (payload.email || "").trim().length > 0;
    const hasPhone = (payload.phone || "").trim().length > 0;
    if (!hasEmail && !hasPhone) {
      errors.email = "Provide at least one contact method (email or phone)";
      errors.phone = "Provide at least one contact method (email or phone)";
    }
    if (hasEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())) {
      errors.email = "Enter a valid email address";
    }
    if (payload.nextFollowUp && Number.isNaN(new Date(payload.nextFollowUp).getTime())) {
      errors.nextFollowUp = "Enter a valid date";
    }
    if (payload.ownerId && !isValidOwner(payload.ownerId)) {
      errors.ownerId = "Select a valid owner";
    }
    // Do Not Contact vs. channel-allowed conflicts are deliberately not
    // validated here: updateContactRecord/makeContact always force the
    // channel flags off the moment doNotContact is set, so the conflict can
    // never actually persist. Rejecting a partial PUT (e.g. the "Mark Do Not
    // Contact" quick action, which only sends { doNotContact, reason } and
    // relies on that auto-clear) against the *existing* record's stale
    // channel flags would reject a perfectly valid update. The form itself
    // still warns the user client-side before submitting.
    return errors;
  }

  mock.onGet(/\/crm\/contacts$/).reply((config) => {
    const params = config.params || {};
    return [200, crm.queryContacts(params)];
  });
  mock.onGet(/\/crm\/contacts\/export$/).reply((config) => {
    const params = config.params || {};
    return [200, { contacts: crm.queryContacts({ ...params, page: 1, pageSize: 100000 }).contacts }];
  });
  mock.onGet(/\/crm\/contacts\/[^/]+\/duplicates$/).reply((config) => {
    const contactId = config.url.match(/\/crm\/contacts\/([^/]+)\/duplicates$/)[1];
    return [200, { duplicates: crm.findDuplicateContacts(config.params || {}, contactId) }];
  });
  mock.onGet(/\/crm\/contacts\/[^/]+$/).reply((config) => {
    const contactId = config.url.match(/\/crm\/contacts\/([^/]+)$/)[1];
    const contact = crm.findContact(contactId);
    return contact ? [200, { contact }] : [404, { message: "Contact not found" }];
  });

  mock.onPost(/\/crm\/contacts$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const errors = validateContactPayload(payload);
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors }];

    if (!payload.duplicateOverride) {
      const duplicates = crm.findDuplicateContacts(payload);
      if (duplicates.length > 0) {
        return [409, { message: "A possible duplicate contact already exists", duplicates: duplicates.map((d) => ({ contact: d.contact, reasons: d.reasons })) }];
      }
    } else if (!payload.overrideReason?.trim()) {
      return [400, { message: "Validation failed", errors: { overrideReason: "Explain why this is not a duplicate" } }];
    }

    const contact = crm.createContactRecord(payload, getCurrentActor());
    return [201, { contact }];
  });

  mock.onPut(/\/crm\/contacts\/[^/]+$/).reply((config) => {
    const contactId = config.url.match(/\/crm\/contacts\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");
    const errors = validateContactPayload({ ...crm.findContact(contactId), ...changes });
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors }];
    const contact = crm.updateContactRecord(contactId, changes, getCurrentActor());
    return contact ? [200, { contact }] : [404, { message: "Contact not found" }];
  });

  mock.onPost(/\/crm\/contacts\/[^/]+\/consent$/).reply((config) => {
    const contactId = config.url.match(/\/crm\/contacts\/([^/]+)\/consent$/)[1];
    const { optedIn, reason } = JSON.parse(config.data || "{}");
    const contact = crm.updateContactConsent(contactId, optedIn, reason);
    return contact ? [200, { contact }] : [404, { message: "Contact not found" }];
  });

  mock.onPost(/\/crm\/contacts\/[^/]+\/notes$/).reply((config) => {
    const contactId = config.url.match(/\/crm\/contacts\/([^/]+)\/notes$/)[1];
    const { message } = JSON.parse(config.data || "{}");
    if (!message?.trim()) return [400, { message: "Note cannot be empty" }];
    const contact = crm.addContactNote(contactId, message, getCurrentActor());
    return contact ? [200, { contact }] : [404, { message: "Contact not found" }];
  });

  mock.onPost(/\/crm\/contacts\/[^/]+\/activity$/).reply((config) => {
    const contactId = config.url.match(/\/crm\/contacts\/([^/]+)\/activity$/)[1];
    const { type, description } = JSON.parse(config.data || "{}");
    if (!description?.trim()) return [400, { message: "Description is required" }];
    const contact = crm.logContactActivity(contactId, type || "note", description, getCurrentActor());
    return contact ? [200, { contact }] : [404, { message: "Contact not found" }];
  });

  mock.onPost(/\/crm\/contacts\/[^/]+\/tasks$/).reply((config) => {
    const contactId = config.url.match(/\/crm\/contacts\/([^/]+)\/tasks$/)[1];
    const task = JSON.parse(config.data || "{}");
    if (!task.title?.trim() || !task.dueDate) return [400, { message: "Task title and due date are required" }];
    const contact = crm.createContactTask(contactId, task, getCurrentActor());
    return contact ? [200, { contact }] : [404, { message: "Contact not found" }];
  });

  mock.onPut(/\/crm\/contacts\/[^/]+\/tasks\/[^/]+$/).reply((config) => {
    const [, contactId, taskId] = config.url.match(/\/crm\/contacts\/([^/]+)\/tasks\/([^/]+)$/);
    const contact = crm.updateContactTask(contactId, taskId, JSON.parse(config.data || "{}"), getCurrentActor());
    return contact ? [200, { contact }] : [404, { message: "Contact or task not found" }];
  });

  mock.onPost(/\/crm\/contacts\/[^/]+\/files$/).reply((config) => {
    const contactId = config.url.match(/\/crm\/contacts\/([^/]+)\/files$/)[1];
    const contact = crm.addContactFile(contactId, JSON.parse(config.data || "{}"), getCurrentActor());
    return contact ? [200, { contact }] : [404, { message: "Contact not found" }];
  });

  mock.onDelete(/\/crm\/contacts\/[^/]+\/files\/[^/]+$/).reply((config) => {
    const [, contactId, fileId] = config.url.match(/\/crm\/contacts\/([^/]+)\/files\/([^/]+)$/);
    const contact = crm.deleteContactFile(contactId, fileId);
    return contact ? [200, { contact }] : [404, { message: "Contact or file not found" }];
  });

  mock.onPost(/\/crm\/contacts\/[^/]+\/archive$/).reply((config) => {
    const contactId = config.url.match(/\/crm\/contacts\/([^/]+)\/archive$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive a contact" }];
    const contact = crm.archiveContactRecord(contactId, reason, getCurrentActor());
    return contact ? [200, { contact }] : [404, { message: "Contact not found" }];
  });

  mock.onPost(/\/crm\/contacts\/[^/]+\/restore$/).reply((config) => {
    const contactId = config.url.match(/\/crm\/contacts\/([^/]+)\/restore$/)[1];
    const contact = crm.restoreContactRecord(contactId, getCurrentActor());
    return contact ? [200, { contact }] : [404, { message: "Contact not found" }];
  });

  mock.onPost(/\/crm\/contacts\/bulk\/assign$/).reply((config) => {
    const { contactIds, ownerId } = JSON.parse(config.data || "{}");
    if (!isValidOwner(ownerId)) return [400, { message: "Select a valid owner" }];
    return [200, { contacts: crm.bulkAssignContacts(contactIds || [], ownerId, getCurrentActor()) }];
  });

  mock.onPost(/\/crm\/contacts\/bulk\/tag$/).reply((config) => {
    const { contactIds, tag } = JSON.parse(config.data || "{}");
    if (!tag?.trim()) return [400, { message: "A tag is required" }];
    return [200, { contacts: crm.bulkTagContacts(contactIds || [], tag.trim(), getCurrentActor()) }];
  });

  mock.onPost(/\/crm\/contacts\/bulk\/lifecycle$/).reply((config) => {
    const { contactIds, lifecycleStage } = JSON.parse(config.data || "{}");
    return [200, { contacts: crm.bulkLifecycleUpdateContacts(contactIds || [], lifecycleStage, getCurrentActor()) }];
  });

  mock.onPost(/\/crm\/contacts\/bulk\/archive$/).reply((config) => {
    const { contactIds, reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive" }];
    return [200, { contacts: crm.bulkArchiveContacts(contactIds || [], reason, getCurrentActor()) }];
  });

  // ---- CRM: Deals ----
  // Frontend-first phase, same as Contacts/Companies/Activities: no
  // permission gating here — route-level access to all of /crm/* is already
  // enforced by RequireAuth in App.jsx. Deliberately NOT server-shaped
  // pagination: CompaniesList and the CRM dashboard already consume the
  // full unpaginated deals list, and DealsList filters/sorts/paginates
  // client-side via queryDealsLocal, same pattern as Companies/Activities.
  // Marking a deal Won/Lost/Cancelled never touches Sales/Projects/Finance
  // mock data — per spec this phase does not start those backend workflows;
  // "next step" actions are frontend previews only, shown in the UI.
  function validateDealPayload(payload) {
    const errors = {};
    if (!(payload.name || "").trim()) errors.name = "Deal name is required";
    if (!payload.companyId) errors.companyId = "Company is required";
    if (payload.companyId && payload.primaryContactId) {
      const contact = crm.findContact(payload.primaryContactId);
      if (!contact || contact.companyId !== payload.companyId) {
        errors.primaryContactId = "Primary contact must belong to the selected company";
      }
    }
    if (payload.value !== undefined && payload.value !== "" && (Number.isNaN(Number(payload.value)) || Number(payload.value) < 0)) {
      errors.value = "Enter a valid, non-negative deal value";
    }
    if (!payload.currency) errors.currency = "Currency is required";
    if (payload.probability !== undefined && payload.probability !== "" && (Number(payload.probability) < 0 || Number(payload.probability) > 100)) {
      errors.probability = "Probability must be between 0 and 100";
    }
    if (payload.ownerId && !isValidOwner(payload.ownerId)) errors.ownerId = "Select a valid owner";
    if (Array.isArray(payload.lineItems)) {
      for (const item of payload.lineItems) {
        if (Number(item.quantity) <= 0) { errors.lineItems = "Line item quantities must be greater than zero"; break; }
        if (Number(item.discountPercent || 0) < 0 || Number(item.discountPercent || 0) > 100) { errors.lineItems = "Line item discounts must be between 0 and 100%"; break; }
      }
    }
    return errors;
  }

  // Gives the Deal's Activities tab ("reuse the shared CRM activity
  // interface") real entries for stage/outcome changes, alongside calls,
  // emails, etc. logged directly against the deal.
  function logDealStatusActivity(deal, description, actor) {
    if (!deal) return;
    activitiesData.createActivityRecord({
      type: "Status Update", title: description, description,
      relatedRecordType: "Deal", relatedRecordId: deal._id, ownerId: deal.ownerId, status: "Completed",
    }, actor);
  }

  mock.onGet(/\/crm\/deals$/).reply(200, { deals: crm.deals });

  mock.onGet(/\/crm\/deals\/[^/]+$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)$/)[1];
    const deal = crm.findDeal(dealId);
    return deal ? [200, { deal }] : [404, { message: "Deal not found" }];
  });

  mock.onPost(/\/crm\/deals$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const errors = validateDealPayload(payload);
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors }];
    const deal = crm.createDealRecord(payload, getCurrentActor());
    return [201, { deal }];
  });

  mock.onPut(/\/crm\/deals\/[^/]+$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");
    const errors = validateDealPayload({ ...crm.findDeal(dealId), ...changes });
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors }];
    const deal = crm.updateDealRecord(dealId, changes, getCurrentActor());
    return deal ? [200, { deal }] : [404, { message: "Deal not found" }];
  });

  mock.onPost(/\/crm\/deals\/[^/]+\/stage$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)\/stage$/)[1];
    const { stage, note } = JSON.parse(config.data || "{}");
    if (!crm.DEAL_STAGES.includes(stage)) return [400, { message: "Select a valid stage" }];
    const deal = crm.changeDealStage(dealId, { stage, note }, getCurrentActor());
    if (!deal) return [404, { message: "Deal not found" }];
    logDealStatusActivity(deal, `Stage changed to ${stage}`, getCurrentActor());
    return [200, { deal }];
  });

  mock.onPost(/\/crm\/deals\/[^/]+\/win$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)\/win$/)[1];
    const deal = crm.markDealWon(dealId, JSON.parse(config.data || "{}"), getCurrentActor());
    if (!deal) return [404, { message: "Deal not found" }];
    logDealStatusActivity(deal, "Deal marked Won", getCurrentActor());
    return [200, { deal }];
  });

  mock.onPost(/\/crm\/deals\/[^/]+\/lost$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)\/lost$/)[1];
    const payload = JSON.parse(config.data || "{}");
    if (!payload.lossReason?.trim()) return [400, { message: "A loss reason is required" }];
    const deal = crm.markDealLost(dealId, payload, getCurrentActor());
    if (!deal) return [404, { message: "Deal not found" }];
    logDealStatusActivity(deal, "Deal marked Lost", getCurrentActor());
    return [200, { deal }];
  });

  mock.onPost(/\/crm\/deals\/[^/]+\/cancel$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)\/cancel$/)[1];
    const payload = JSON.parse(config.data || "{}");
    if (!payload.cancellationReason?.trim()) return [400, { message: "A cancellation reason is required" }];
    const deal = crm.cancelDealRecord(dealId, payload, getCurrentActor());
    if (!deal) return [404, { message: "Deal not found" }];
    logDealStatusActivity(deal, "Deal cancelled", getCurrentActor());
    return [200, { deal }];
  });

  mock.onPost(/\/crm\/deals\/[^/]+\/hold$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)\/hold$/)[1];
    const payload = JSON.parse(config.data || "{}");
    if (!payload.onHoldReason?.trim() || !payload.onHoldReviewDate) return [400, { message: "A reason and review date are required" }];
    const deal = crm.putDealOnHold(dealId, payload, getCurrentActor());
    if (!deal) return [404, { message: "Deal not found" }];
    logDealStatusActivity(deal, "Deal put on hold", getCurrentActor());
    return [200, { deal }];
  });

  mock.onPost(/\/crm\/deals\/[^/]+\/reopen$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)\/reopen$/)[1];
    const deal = crm.reopenDealRecord(dealId, JSON.parse(config.data || "{}"), getCurrentActor());
    if (!deal) return [404, { message: "Deal not found" }];
    logDealStatusActivity(deal, "Deal reopened", getCurrentActor());
    return [200, { deal }];
  });

  mock.onPost(/\/crm\/deals\/[^/]+\/archive$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)\/archive$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive a deal" }];
    const deal = crm.archiveDealRecord(dealId, reason, getCurrentActor());
    return deal ? [200, { deal }] : [404, { message: "Deal not found" }];
  });

  mock.onPost(/\/crm\/deals\/[^/]+\/restore$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)\/restore$/)[1];
    const deal = crm.restoreDealRecord(dealId, getCurrentActor());
    return deal ? [200, { deal }] : [404, { message: "Deal not found" }];
  });

  mock.onPost(/\/crm\/deals\/[^/]+\/contacts$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)\/contacts$/)[1];
    const deal = crm.addDealContact(dealId, JSON.parse(config.data || "{}"), getCurrentActor());
    return deal ? [200, { deal }] : [404, { message: "Deal not found" }];
  });

  mock.onPut(/\/crm\/deals\/[^/]+\/contacts\/[^/]+$/).reply((config) => {
    const [, dealId, contactId] = config.url.match(/\/crm\/deals\/([^/]+)\/contacts\/([^/]+)$/);
    const deal = crm.updateDealContactRole(dealId, contactId, JSON.parse(config.data || "{}"), getCurrentActor());
    return deal ? [200, { deal }] : [404, { message: "Deal not found" }];
  });

  mock.onPost(/\/crm\/deals\/[^/]+\/contacts\/[^/]+\/primary$/).reply((config) => {
    const [, dealId, contactId] = config.url.match(/\/crm\/deals\/([^/]+)\/contacts\/([^/]+)\/primary$/);
    const deal = crm.setDealPrimaryContact(dealId, contactId, getCurrentActor());
    return deal ? [200, { deal }] : [404, { message: "Deal not found" }];
  });

  mock.onDelete(/\/crm\/deals\/[^/]+\/contacts\/[^/]+$/).reply((config) => {
    const [, dealId, contactId] = config.url.match(/\/crm\/deals\/([^/]+)\/contacts\/([^/]+)$/);
    const deal = crm.removeDealContact(dealId, contactId, getCurrentActor());
    return deal ? [200, { deal }] : [404, { message: "Deal not found" }];
  });

  mock.onPut(/\/crm\/deals\/[^/]+\/line-items$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)\/line-items$/)[1];
    const { lineItems } = JSON.parse(config.data || "{}");
    const errors = validateDealPayload({ ...crm.findDeal(dealId), lineItems: lineItems || [] });
    if (errors.lineItems) return [400, { message: "Validation failed", errors }];
    const deal = crm.setDealLineItems(dealId, lineItems || [], getCurrentActor());
    return deal ? [200, { deal }] : [404, { message: "Deal not found" }];
  });

  mock.onPost(/\/crm\/deals\/[^/]+\/quotes$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)\/quotes$/)[1];
    const deal = crm.addDealQuotePreview(dealId, JSON.parse(config.data || "{}"), getCurrentActor());
    return deal ? [200, { deal }] : [404, { message: "Deal not found" }];
  });

  mock.onPost(/\/crm\/deals\/[^/]+\/files$/).reply((config) => {
    const dealId = config.url.match(/\/crm\/deals\/([^/]+)\/files$/)[1];
    const deal = crm.addDealFile(dealId, JSON.parse(config.data || "{}"), getCurrentActor());
    return deal ? [200, { deal }] : [404, { message: "Deal not found" }];
  });

  mock.onDelete(/\/crm\/deals\/[^/]+\/files\/[^/]+$/).reply((config) => {
    const [, dealId, fileId] = config.url.match(/\/crm\/deals\/([^/]+)\/files\/([^/]+)$/);
    const deal = crm.deleteDealFile(dealId, fileId, getCurrentActor());
    return deal ? [200, { deal }] : [404, { message: "Deal or file not found" }];
  });

  mock.onPost(/\/crm\/deals\/bulk\/assign$/).reply((config) => {
    const { dealIds, ownerId } = JSON.parse(config.data || "{}");
    if (!isValidOwner(ownerId)) return [400, { message: "Select a valid owner" }];
    return [200, { deals: crm.bulkAssignDeals(dealIds || [], ownerId, getCurrentActor()) }];
  });

  mock.onPost(/\/crm\/deals\/bulk\/stage$/).reply((config) => {
    const { dealIds, stage } = JSON.parse(config.data || "{}");
    if (!crm.DEAL_STAGES.includes(stage)) return [400, { message: "Select a valid stage" }];
    return [200, { deals: crm.bulkStageChangeDeals(dealIds || [], stage, getCurrentActor()) }];
  });

  mock.onPost(/\/crm\/deals\/bulk\/tag$/).reply((config) => {
    const { dealIds, tag } = JSON.parse(config.data || "{}");
    if (!tag?.trim()) return [400, { message: "A tag is required" }];
    return [200, { deals: crm.bulkTagDeals(dealIds || [], tag.trim(), getCurrentActor()) }];
  });

  mock.onPost(/\/crm\/deals\/bulk\/archive$/).reply((config) => {
    const { dealIds, reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive" }];
    return [200, { deals: crm.bulkArchiveDeals(dealIds || [], reason, getCurrentActor()) }];
  });

  // ---- Sales: Products & Services catalog ----
  // Deliberately NOT server-shaped/paginated, same as Companies: the whole
  // catalog is small enough that ProductsList filters/sorts/paginates
  // client-side over the full array via queryCatalogLocal().
  mock.onGet(/\/sales\/products$/).reply(200, { products: catalog.catalogItems });

  mock.onGet(/\/sales\/products\/[^/]+$/).reply((config) => {
    const productId = config.url.match(/\/sales\/products\/([^/]+)$/)[1];
    const product = catalog.findCatalogItem(productId);
    return product ? [200, { product }] : [404, { message: "Catalog item not found" }];
  });

  mock.onPost(/\/sales\/products$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const { errors, warnings } = catalog.validateCatalogPayload(payload);
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors, warnings }];
    const product = catalog.createCatalogItem(payload, getCurrentActor());
    return [201, { product, warnings }];
  });

  mock.onPut(/\/sales\/products\/[^/]+$/).reply((config) => {
    const productId = config.url.match(/\/sales\/products\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");
    const existing = catalog.findCatalogItem(productId);
    if (!existing) return [404, { message: "Catalog item not found" }];
    const { errors, warnings } = catalog.validateCatalogPayload({ ...existing, ...changes }, { excludeId: productId });
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors, warnings }];
    const product = catalog.updateCatalogItem(productId, changes, getCurrentActor());
    return product ? [200, { product, warnings }] : [404, { message: "Catalog item not found" }];
  });

  mock.onPost(/\/sales\/products\/[^/]+\/archive$/).reply((config) => {
    const productId = config.url.match(/\/sales\/products\/([^/]+)\/archive$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive a catalog item" }];
    const product = catalog.archiveCatalogItem(productId, reason, getCurrentActor());
    return product ? [200, { product }] : [404, { message: "Catalog item not found" }];
  });

  mock.onPost(/\/sales\/products\/[^/]+\/restore$/).reply((config) => {
    const productId = config.url.match(/\/sales\/products\/([^/]+)\/restore$/)[1];
    const product = catalog.restoreCatalogItem(productId, getCurrentActor());
    return product ? [200, { product }] : [404, { message: "Catalog item not found" }];
  });

  mock.onPost(/\/sales\/products\/bulk\/assign$/).reply((config) => {
    const { itemIds, ownerId } = JSON.parse(config.data || "{}");
    if (!isValidOwner(ownerId)) return [400, { message: "Select a valid owner" }];
    return [200, { products: catalog.bulkAssignOwner(itemIds || [], ownerId, getCurrentActor()) }];
  });

  mock.onPost(/\/sales\/products\/bulk\/category$/).reply((config) => {
    const { itemIds, category } = JSON.parse(config.data || "{}");
    if (!catalog.CATALOG_CATEGORIES.includes(category)) return [400, { message: "Select a valid category" }];
    return [200, { products: catalog.bulkChangeCategory(itemIds || [], category, getCurrentActor()) }];
  });

  mock.onPost(/\/sales\/products\/bulk\/status$/).reply((config) => {
    const { itemIds, status } = JSON.parse(config.data || "{}");
    if (!catalog.CATALOG_STATUSES.includes(status) || status === "Archived") {
      return [400, { message: "Select a valid status (use Archive for archiving)" }];
    }
    return [200, { products: catalog.bulkChangeStatus(itemIds || [], status, getCurrentActor()) }];
  });

  mock.onPost(/\/sales\/products\/bulk\/tag$/).reply((config) => {
    const { itemIds, tag } = JSON.parse(config.data || "{}");
    if (!tag?.trim()) return [400, { message: "A tag is required" }];
    return [200, { products: catalog.bulkTag(itemIds || [], tag.trim(), getCurrentActor()) }];
  });

  mock.onPost(/\/sales\/products\/bulk\/archive$/).reply((config) => {
    const { itemIds, reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive" }];
    return [200, { products: catalog.bulkArchive(itemIds || [], reason, getCurrentActor()) }];
  });

  // ---- Sales: Price Books ----
  // Deliberately NOT server-shaped/paginated — same pattern as the catalog:
  // the whole set is fetched once and PriceBooksList filters/sorts/
  // paginates client-side via queryPriceBooksLocal().
  mock.onGet(/\/sales\/price-books$/).reply(200, { priceBooks: priceBookData.priceBooks });

  mock.onGet(/\/sales\/price-books\/[^/]+$/).reply((config) => {
    const priceBookId = config.url.match(/\/sales\/price-books\/([^/]+)$/)[1];
    const priceBook = priceBookData.findPriceBook(priceBookId);
    return priceBook ? [200, { priceBook }] : [404, { message: "Price Book not found" }];
  });

  mock.onPost(/\/sales\/price-books$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const { errors, warnings } = priceBookData.validatePriceBookPayload(payload);
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors, warnings }];
    const priceBook = priceBookData.createPriceBook(payload, getCurrentActor());
    return [201, { priceBook, warnings }];
  });

  mock.onPut(/\/sales\/price-books\/[^/]+$/).reply((config) => {
    const priceBookId = config.url.match(/\/sales\/price-books\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");
    const existing = priceBookData.findPriceBook(priceBookId);
    if (!existing) return [404, { message: "Price Book not found" }];
    const { errors, warnings } = priceBookData.validatePriceBookPayload({ ...existing, ...changes }, { excludeId: priceBookId });
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors, warnings }];
    const priceBook = priceBookData.updatePriceBook(priceBookId, changes, getCurrentActor());
    return priceBook ? [200, { priceBook, warnings }] : [404, { message: "Price Book not found" }];
  });

  mock.onPost(/\/sales\/price-books\/[^/]+\/archive$/).reply((config) => {
    const priceBookId = config.url.match(/\/sales\/price-books\/([^/]+)\/archive$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive a Price Book" }];
    const priceBook = priceBookData.archivePriceBook(priceBookId, reason, getCurrentActor());
    return priceBook ? [200, { priceBook }] : [404, { message: "Price Book not found" }];
  });

  mock.onPost(/\/sales\/price-books\/[^/]+\/restore$/).reply((config) => {
    const priceBookId = config.url.match(/\/sales\/price-books\/([^/]+)\/restore$/)[1];
    const priceBook = priceBookData.restorePriceBook(priceBookId, getCurrentActor());
    return priceBook ? [200, { priceBook }] : [404, { message: "Price Book not found" }];
  });

  mock.onPost(/\/sales\/price-books\/bulk\/assign$/).reply((config) => {
    const { priceBookIds, ownerId } = JSON.parse(config.data || "{}");
    if (!isValidOwner(ownerId)) return [400, { message: "Select a valid owner" }];
    return [200, { priceBooks: priceBookData.bulkAssignOwner(priceBookIds || [], ownerId, getCurrentActor()) }];
  });

  mock.onPost(/\/sales\/price-books\/bulk\/status$/).reply((config) => {
    const { priceBookIds, status } = JSON.parse(config.data || "{}");
    if (!priceBookData.SETTABLE_STATUSES.includes(status)) {
      return [400, { message: "Select a valid status (use Archive for archiving)" }];
    }
    return [200, { priceBooks: priceBookData.bulkChangeStatus(priceBookIds || [], status, getCurrentActor()) }];
  });

  mock.onPost(/\/sales\/price-books\/bulk\/archive$/).reply((config) => {
    const { priceBookIds, reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive" }];
    return [200, { priceBooks: priceBookData.bulkArchive(priceBookIds || [], reason, getCurrentActor()) }];
  });

  // ---- Sales: Quotes ----
  // Deliberately NOT server-shaped/paginated — same pattern as the catalog
  // and Price Books: the whole set is fetched once and QuotesList filters/
  // sorts/paginates client-side via queryQuotesLocal().
  mock.onGet(/\/sales\/quotes$/).reply(200, { quotes: quoteData.quotes });
  mock.onGet(/\/sales\/quotes\/[^/]+$/).reply((config) => {
    const quoteId = config.url.match(/\/sales\/quotes\/([^/]+)$/)[1];
    const quote = quoteData.findQuoteRecord(quoteId);
    return quote ? [200, { quote }] : [404, { message: "Quote not found" }];
  });
  mock.onPost(/\/sales\/quotes$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const { errors, warnings } = quoteData.validateQuotePayload(payload);
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors, warnings }];
    const quote = quoteData.createQuote(payload, getCurrentActor());
    return [201, { quote, warnings }];
  });
  mock.onPut(/\/sales\/quotes\/[^/]+$/).reply((config) => {
    const quoteId = config.url.match(/\/sales\/quotes\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");
    const existing = quoteData.findQuoteRecord(quoteId);
    if (!existing) return [404, { message: "Quote not found" }];
    const { errors, warnings } = quoteData.validateQuotePayload({ ...existing, ...changes });
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors, warnings }];
    const quote = quoteData.updateQuote(quoteId, changes, getCurrentActor());
    return quote ? [200, { quote, warnings }] : [404, { message: "Quote not found" }];
  });
  mock.onPost(/\/sales\/quotes\/[^/]+\/archive$/).reply((config) => {
    const quoteId = config.url.match(/\/sales\/quotes\/([^/]+)\/archive$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive a Quote" }];
    const quote = quoteData.archiveQuote(quoteId, reason, getCurrentActor());
    return quote ? [200, { quote }] : [404, { message: "Quote not found" }];
  });
  mock.onPost(/\/sales\/quotes\/[^/]+\/restore$/).reply((config) => {
    const quoteId = config.url.match(/\/sales\/quotes\/([^/]+)\/restore$/)[1];
    const quote = quoteData.restoreQuote(quoteId, getCurrentActor());
    return quote ? [200, { quote }] : [404, { message: "Quote not found" }];
  });
  mock.onPost(/\/sales\/quotes\/bulk\/assign$/).reply((config) => {
    const { quoteIds, ownerId } = JSON.parse(config.data || "{}");
    if (!isValidOwner(ownerId)) return [400, { message: "Select a valid owner" }];
    return [200, { quotes: quoteData.bulkAssignOwner(quoteIds || [], ownerId, getCurrentActor()) }];
  });
  mock.onPost(/\/sales\/quotes\/bulk\/archive$/).reply((config) => {
    const { quoteIds, reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive" }];
    return [200, { quotes: quoteData.bulkArchive(quoteIds || [], reason, getCurrentActor()) }];
  });
  mock.onPost(/\/sales\/quotes\/[^/]+\/submit-review$/).reply((config) => {
    const quoteId = config.url.match(/\/sales\/quotes\/([^/]+)\/submit-review$/)[1];
    const quote = quoteData.submitForReview(quoteId, getCurrentActor());
    return quote ? [200, { quote }] : [404, { message: "Quote not found" }];
  });
  mock.onPost(/\/sales\/quotes\/[^/]+\/approve$/).reply((config) => {
    const quoteId = config.url.match(/\/sales\/quotes\/([^/]+)\/approve$/)[1];
    const { comment } = JSON.parse(config.data || "{}");
    const quote = quoteData.approveReview(quoteId, getCurrentActor(), comment);
    return quote ? [200, { quote }] : [404, { message: "Quote not found" }];
  });
  mock.onPost(/\/sales\/quotes\/[^/]+\/reject$/).reply((config) => {
    const quoteId = config.url.match(/\/sales\/quotes\/([^/]+)\/reject$/)[1];
    const { comment } = JSON.parse(config.data || "{}");
    if (!comment?.trim()) return [400, { message: "A comment is required to reject" }];
    const quote = quoteData.rejectReview(quoteId, getCurrentActor(), comment);
    return quote ? [200, { quote }] : [404, { message: "Quote not found" }];
  });
  mock.onPost(/\/sales\/quotes\/[^/]+\/request-changes$/).reply((config) => {
    const quoteId = config.url.match(/\/sales\/quotes\/([^/]+)\/request-changes$/)[1];
    const { comment } = JSON.parse(config.data || "{}");
    if (!comment?.trim()) return [400, { message: "A comment is required to request changes" }];
    const quote = quoteData.requestReviewChanges(quoteId, getCurrentActor(), comment);
    return quote ? [200, { quote }] : [404, { message: "Quote not found" }];
  });
  mock.onPost(/\/sales\/quotes\/[^/]+\/cancel$/).reply((config) => {
    const quoteId = config.url.match(/\/sales\/quotes\/([^/]+)\/cancel$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const quote = quoteData.cancelQuote(quoteId, getCurrentActor(), reason);
    return quote ? [200, { quote }] : [404, { message: "Quote not found" }];
  });
  mock.onPost(/\/sales\/quotes\/[^/]+\/preview-send$/).reply((config) => {
    const quoteId = config.url.match(/\/sales\/quotes\/([^/]+)\/preview-send$/)[1];
    const body = JSON.parse(config.data || "{}");
    if (!body.recipientEmail?.trim()) return [400, { message: "A recipient is required" }];
    const quote = quoteData.previewSend(quoteId, body, getCurrentActor());
    return quote ? [200, { quote }] : [404, { message: "Quote not found" }];
  });
  mock.onPost(/\/sales\/quotes\/[^/]+\/customer-response$/).reply((config) => {
    const quoteId = config.url.match(/\/sales\/quotes\/([^/]+)\/customer-response$/)[1];
    const { type, details } = JSON.parse(config.data || "{}");
    if (!quoteData.CUSTOMER_RESPONSE_TYPES.includes(type)) return [400, { message: "Select a valid response type" }];
    const quote = quoteData.simulateCustomerResponse(quoteId, type, details || {}, getCurrentActor());
    return quote ? [200, { quote }] : [400, { message: "A reason is required for this response type" }];
  });
  mock.onPost(/\/sales\/quotes\/[^/]+\/new-version$/).reply((config) => {
    const quoteId = config.url.match(/\/sales\/quotes\/([^/]+)\/new-version$/)[1];
    const payload = JSON.parse(config.data || "{}");
    if (!payload.changeSummary?.trim()) return [400, { message: "A change summary is required" }];
    const { errors, warnings } = quoteData.validateQuotePayload(payload);
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors, warnings }];
    const result = quoteData.confirmNewVersion(quoteId, payload, getCurrentActor());
    return [201, { quote: result.newQuote, previous: result.previous, warnings }];
  });

  // ---- Sales: Orders ----
  // Deliberately NOT server-shaped/paginated — same pattern as Quotes and
  // Price Books: the whole set is fetched once and OrdersList filters/
  // sorts/paginates client-side via queryOrdersLocal().
  mock.onGet(/\/sales\/orders$/).reply(200, { orders: orderData.orders });
  mock.onGet(/\/sales\/orders\/[^/]+$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)$/)[1];
    const order = orderData.findOrderRecord(orderId);
    return order ? [200, { order }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const { errors, warnings } = orderData.validateOrderPayload(payload);
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors, warnings }];
    const order = orderData.createOrder(payload, getCurrentActor());
    return [201, { order, warnings }];
  });
  mock.onPut(/\/sales\/orders\/[^/]+$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");
    const existing = orderData.findOrderRecord(orderId);
    if (!existing) return [404, { message: "Order not found" }];
    const { errors, warnings } = orderData.validateOrderPayload({ ...existing, ...changes });
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors, warnings }];
    const order = orderData.updateOrder(orderId, changes, getCurrentActor());
    return order ? [200, { order, warnings }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders\/[^/]+\/archive$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)\/archive$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive an Order" }];
    const order = orderData.archiveOrder(orderId, reason, getCurrentActor());
    return order ? [200, { order }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders\/[^/]+\/restore$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)\/restore$/)[1];
    const order = orderData.restoreOrder(orderId, getCurrentActor());
    return order ? [200, { order }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders\/bulk\/assign$/).reply((config) => {
    const { orderIds, ownerId } = JSON.parse(config.data || "{}");
    if (!isValidOwner(ownerId)) return [400, { message: "Select a valid owner" }];
    return [200, { orders: orderData.bulkAssignOwner(orderIds || [], ownerId, getCurrentActor()) }];
  });
  mock.onPost(/\/sales\/orders\/bulk\/archive$/).reply((config) => {
    const { orderIds, reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive" }];
    return [200, { orders: orderData.bulkArchive(orderIds || [], reason, getCurrentActor()) }];
  });
  mock.onPost(/\/sales\/orders\/[^/]+\/submit-review$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)\/submit-review$/)[1];
    const order = orderData.submitForReview(orderId, getCurrentActor());
    return order ? [200, { order }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders\/[^/]+\/confirm$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)\/confirm$/)[1];
    const order = orderData.confirmOrder(orderId, JSON.parse(config.data || "{}"), getCurrentActor());
    return order ? [200, { order }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders\/[^/]+\/start-processing$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)\/start-processing$/)[1];
    const order = orderData.startProcessing(orderId, JSON.parse(config.data || "{}"), getCurrentActor());
    return order ? [200, { order }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders\/[^/]+\/hold$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)\/hold$/)[1];
    const body = JSON.parse(config.data || "{}");
    if (!body.reason?.trim()) return [400, { message: "A reason is required to put an Order on hold" }];
    const order = orderData.putOnHold(orderId, body, getCurrentActor());
    return order ? [200, { order }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders\/[^/]+\/resume$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)\/resume$/)[1];
    const order = orderData.resumeOrder(orderId, JSON.parse(config.data || "{}"), getCurrentActor());
    return order ? [200, { order }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders\/[^/]+\/cancel$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)\/cancel$/)[1];
    const body = JSON.parse(config.data || "{}");
    if (!body.reason?.trim()) return [400, { message: "A cancellation reason is required" }];
    const order = orderData.cancelOrder(orderId, body, getCurrentActor());
    return order ? [200, { order }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders\/[^/]+\/fulfilled$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)\/fulfilled$/)[1];
    const order = orderData.markFulfilled(orderId, getCurrentActor());
    return order ? [200, { order }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders\/[^/]+\/complete$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)\/complete$/)[1];
    const order = orderData.markCompleted(orderId, JSON.parse(config.data || "{}"), getCurrentActor());
    return order ? [200, { order }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders\/[^/]+\/request-invoice-preview$/).reply((config) => {
    const orderId = config.url.match(/\/sales\/orders\/([^/]+)\/request-invoice-preview$/)[1];
    const order = orderData.requestInvoicePreview(orderId, getCurrentActor());
    return order ? [200, { order }] : [404, { message: "Order not found" }];
  });
  mock.onPost(/\/sales\/orders\/[^/]+\/lines\/[^/]+\/fulfillment$/).reply((config) => {
    const match = config.url.match(/\/sales\/orders\/([^/]+)\/lines\/([^/]+)\/fulfillment$/);
    const [, orderId, lineId] = match;
    const result = orderData.updateLineFulfillment(orderId, lineId, JSON.parse(config.data || "{}"), getCurrentActor());
    if (result.error) return [400, { message: result.error }];
    return [200, { order: result.order }];
  });

  // ---- Sales: Contracts ----
  // Deliberately NOT server-shaped/paginated — same pattern as Quotes/
  // Orders: the whole set is fetched once and ContractsList filters/sorts/
  // paginates client-side via queryContractsLocal().
  mock.onGet(/\/sales\/contracts$/).reply(200, { contracts: contractData.contracts });
  mock.onGet(/\/sales\/contracts\/[^/]+$/).reply((config) => {
    const contractId = config.url.match(/\/sales\/contracts\/([^/]+)$/)[1];
    const contract = contractData.findContractRecord(contractId);
    return contract ? [200, { contract }] : [404, { message: "Contract not found" }];
  });
  mock.onPost(/\/sales\/contracts$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const { errors, warnings } = contractData.validateContractPayload(payload);
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors, warnings }];
    const contract = contractData.createContract(payload, getCurrentActor());
    return [201, { contract, warnings }];
  });
  mock.onPut(/\/sales\/contracts\/[^/]+$/).reply((config) => {
    const contractId = config.url.match(/\/sales\/contracts\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");
    const existing = contractData.findContractRecord(contractId);
    if (!existing) return [404, { message: "Contract not found" }];
    const { errors, warnings } = contractData.validateContractPayload({ ...existing, ...changes });
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors, warnings }];
    const contract = contractData.updateContract(contractId, changes, getCurrentActor());
    return contract ? [200, { contract, warnings }] : [404, { message: "Contract not found" }];
  });
  mock.onPost(/\/sales\/contracts\/[^/]+\/archive$/).reply((config) => {
    const contractId = config.url.match(/\/sales\/contracts\/([^/]+)\/archive$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive a Contract" }];
    const contract = contractData.archiveContract(contractId, reason, getCurrentActor());
    return contract ? [200, { contract }] : [404, { message: "Contract not found" }];
  });
  mock.onPost(/\/sales\/contracts\/[^/]+\/restore$/).reply((config) => {
    const contractId = config.url.match(/\/sales\/contracts\/([^/]+)\/restore$/)[1];
    const contract = contractData.restoreContract(contractId, getCurrentActor());
    return contract ? [200, { contract }] : [404, { message: "Contract not found" }];
  });
  mock.onPost(/\/sales\/contracts\/bulk\/assign$/).reply((config) => {
    const { contractIds, ownerId } = JSON.parse(config.data || "{}");
    if (!isValidOwner(ownerId)) return [400, { message: "Select a valid owner" }];
    return [200, { contracts: contractData.bulkAssignOwner(contractIds || [], ownerId, getCurrentActor()) }];
  });
  mock.onPost(/\/sales\/contracts\/bulk\/archive$/).reply((config) => {
    const { contractIds, reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A reason is required to archive" }];
    return [200, { contracts: contractData.bulkArchive(contractIds || [], reason, getCurrentActor()) }];
  });
  mock.onPost(/\/sales\/contracts\/[^/]+\/submit-review$/).reply((config) => {
    const contractId = config.url.match(/\/sales\/contracts\/([^/]+)\/submit-review$/)[1];
    const contract = contractData.submitForInternalReview(contractId, getCurrentActor());
    return contract ? [200, { contract }] : [404, { message: "Contract not found" }];
  });
  mock.onPost(/\/sales\/contracts\/[^/]+\/send-for-signature$/).reply((config) => {
    const contractId = config.url.match(/\/sales\/contracts\/([^/]+)\/send-for-signature$/)[1];
    const contract = contractData.sendForSignature(contractId, JSON.parse(config.data || "{}"), getCurrentActor());
    return contract ? [200, { contract }] : [404, { message: "Contract not found" }];
  });
  mock.onPost(/\/sales\/contracts\/[^/]+\/record-signature$/).reply((config) => {
    const contractId = config.url.match(/\/sales\/contracts\/([^/]+)\/record-signature$/)[1];
    const contract = contractData.recordSignature(contractId, JSON.parse(config.data || "{}"), getCurrentActor());
    return contract ? [200, { contract }] : [400, { message: "A signatory name is required" }];
  });
  mock.onPost(/\/sales\/contracts\/[^/]+\/renew$/).reply((config) => {
    const contractId = config.url.match(/\/sales\/contracts\/([^/]+)\/renew$/)[1];
    const body = JSON.parse(config.data || "{}");
    if (!body.newEndDate) return [400, { message: "A new end date is required to renew" }];
    const contract = contractData.renewContract(contractId, body, getCurrentActor());
    return contract ? [200, { contract }] : [404, { message: "Contract not found, or it isn't Signed yet" }];
  });
  mock.onPost(/\/sales\/contracts\/[^/]+\/terminate$/).reply((config) => {
    const contractId = config.url.match(/\/sales\/contracts\/([^/]+)\/terminate$/)[1];
    const body = JSON.parse(config.data || "{}");
    if (!body.reason?.trim()) return [400, { message: "A termination reason is required" }];
    const contract = contractData.terminateContract(contractId, body, getCurrentActor());
    return contract ? [200, { contract }] : [404, { message: "Contract not found" }];
  });
  mock.onPost(/\/sales\/contracts\/[^/]+\/cancel$/).reply((config) => {
    const contractId = config.url.match(/\/sales\/contracts\/([^/]+)\/cancel$/)[1];
    const body = JSON.parse(config.data || "{}");
    if (!body.reason?.trim()) return [400, { message: "A cancellation reason is required" }];
    const contract = contractData.cancelContract(contractId, body, getCurrentActor());
    return contract ? [200, { contract }] : [400, { message: "Only a Draft, Pending Internal Review or Sent for Signature Contract can be cancelled" }];
  });
  mock.onPost(/\/sales\/contracts\/[^/]+\/expire$/).reply((config) => {
    const contractId = config.url.match(/\/sales\/contracts\/([^/]+)\/expire$/)[1];
    const contract = contractData.expireContract(contractId, getCurrentActor());
    return contract ? [200, { contract }] : [404, { message: "Contract not found" }];
  });

  // ---- Support: Tickets ----
  mock.onPost(/\/support\/tickets\/[^/]+\/replies$/).reply((config) => {
    const ticketId = config.url.match(/\/support\/tickets\/([^/]+)\/replies$/)[1];
    const { message, author } = JSON.parse(config.data || "{}");
    const ticket = support.addPublicReplyRecord(ticketId, message, author);
    return ticket ? [200, { ticket }] : [404, { message: "Ticket not found" }];
  });
  mock.onPost(/\/support\/tickets\/[^/]+\/notes$/).reply((config) => {
    const ticketId = config.url.match(/\/support\/tickets\/([^/]+)\/notes$/)[1];
    const { message, author } = JSON.parse(config.data || "{}");
    const ticket = support.addPrivateNoteRecord(ticketId, message, author);
    return ticket ? [200, { ticket }] : [404, { message: "Ticket not found" }];
  });
  mock.onPost(/\/support\/tickets\/[^/]+\/escalate$/).reply((config) => {
    const ticketId = config.url.match(/\/support\/tickets\/([^/]+)\/escalate$/)[1];
    const { to, reason } = JSON.parse(config.data || "{}");
    const ticket = support.escalateTicketRecord(ticketId, to, reason);
    return ticket ? [200, { ticket }] : [404, { message: "Ticket not found" }];
  });
  mock.onPost(/\/support\/tickets\/[^/]+\/resolve$/).reply((config) => {
    const ticketId = config.url.match(/\/support\/tickets\/([^/]+)\/resolve$/)[1];
    const { summary } = JSON.parse(config.data || "{}");
    const ticket = support.resolveTicketRecord(ticketId, summary);
    return ticket ? [200, { ticket }] : [404, { message: "Ticket not found" }];
  });
  mock.onGet(/\/support\/tickets$/).reply(200, { tickets: support.tickets });
  mock.onGet(/\/support\/tickets\/[^/]+$/).reply((config) => {
    const ticketId = config.url.match(/\/support\/tickets\/([^/]+)$/)[1];
    const ticket = support.findTicket(ticketId);
    return ticket ? [200, { ticket }] : [404, { message: "Ticket not found" }];
  });
  mock.onPost(/\/support\/tickets$/).reply((config) => {
    const ticket = support.createTicketRecord(JSON.parse(config.data || "{}"));
    return [201, { ticket }];
  });
  mock.onPut(/\/support\/tickets\/[^/]+$/).reply((config) => {
    const ticketId = config.url.match(/\/support\/tickets\/([^/]+)$/)[1];
    const ticket = support.updateTicketRecord(ticketId, JSON.parse(config.data || "{}"));
    return ticket ? [200, { ticket }] : [404, { message: "Ticket not found" }];
  });

  // ---- Projects ----
  mock.onGet(/\/projects$/).reply(200, { projects: projects.projects });
  mock.onGet(/\/projects\/[^/]+$/).reply((config) => {
    const projectId = config.url.match(/\/projects\/([^/]+)$/)[1];
    const project = projects.findProject(projectId);
    return project ? [200, { project }] : [404, { message: "Project not found" }];
  });
  mock.onPost(/\/projects$/).reply((config) => {
    const project = projects.createProjectRecord(JSON.parse(config.data || "{}"));
    return [201, { project }];
  });
  mock.onPut(/\/projects\/[^/]+$/).reply((config) => {
    const projectId = config.url.match(/\/projects\/([^/]+)$/)[1];
    const project = projects.updateProjectRecord(projectId, JSON.parse(config.data || "{}"));
    return project ? [200, { project }] : [404, { message: "Project not found" }];
  });
  mock.onPost(/\/projects\/[^/]+\/milestones$/).reply((config) => {
    const projectId = config.url.match(/\/projects\/([^/]+)\/milestones$/)[1];
    const { name, dueDate } = JSON.parse(config.data || "{}");
    const project = projects.addMilestoneRecord(projectId, name, dueDate);
    return project ? [200, { project }] : [404, { message: "Project not found" }];
  });
  mock.onPut(/\/projects\/[^/]+\/milestones\/[^/]+$/).reply((config) => {
    const [, projectId, milestoneId] = config.url.match(/\/projects\/([^/]+)\/milestones\/([^/]+)$/);
    const project = projects.toggleMilestoneRecord(projectId, milestoneId);
    return project ? [200, { project }] : [404, { message: "Project not found" }];
  });

  // ---- Tasks ----
  mock.onGet(/\/tasks$/).reply(200, { tasks: projects.tasks });
  mock.onPost(/\/tasks\/[^/]+\/comments$/).reply((config) => {
    const taskId = config.url.match(/\/tasks\/([^/]+)\/comments$/)[1];
    const { message, author } = JSON.parse(config.data || "{}");
    const task = projects.addTaskCommentRecord(taskId, message, author);
    return task ? [200, { task }] : [404, { message: "Task not found" }];
  });
  mock.onPost(/\/tasks\/[^/]+\/time$/).reply((config) => {
    const taskId = config.url.match(/\/tasks\/([^/]+)\/time$/)[1];
    const { hours, note, author } = JSON.parse(config.data || "{}");
    const task = projects.logTaskTimeRecord(taskId, hours, note, author);
    return task ? [200, { task }] : [404, { message: "Task not found" }];
  });
  mock.onPost(/\/tasks$/).reply((config) => {
    const task = projects.createTaskRecord(JSON.parse(config.data || "{}"));
    return [201, { task }];
  });
  mock.onPut(/\/tasks\/[^/]+$/).reply((config) => {
    const taskId = config.url.match(/\/tasks\/([^/]+)$/)[1];
    const task = projects.updateTaskRecord(taskId, JSON.parse(config.data || "{}"));
    return task ? [200, { task }] : [404, { message: "Task not found" }];
  });

  // ---- Marketing: Campaigns ----
  mock.onGet(/\/marketing\/campaigns$/).reply(200, {
    campaigns: marketing.campaigns.map((c) => ({ ...c, ...marketing.campaignStats(c._id) })),
  });
  mock.onGet(/\/marketing\/campaigns\/[^/]+$/).reply((config) => {
    const campaignId = config.url.match(/\/marketing\/campaigns\/([^/]+)$/)[1];
    const campaign = marketing.findCampaign(campaignId);
    return campaign ? [200, { campaign: { ...campaign, ...marketing.campaignStats(campaignId) } }] : [404, { message: "Campaign not found" }];
  });
  mock.onPost(/\/marketing\/campaigns$/).reply((config) => {
    const campaign = marketing.createCampaignRecord(JSON.parse(config.data || "{}"));
    return [201, { campaign }];
  });
  mock.onPut(/\/marketing\/campaigns\/[^/]+$/).reply((config) => {
    const campaignId = config.url.match(/\/marketing\/campaigns\/([^/]+)$/)[1];
    const campaign = marketing.updateCampaignRecord(campaignId, JSON.parse(config.data || "{}"));
    return campaign ? [200, { campaign }] : [404, { message: "Campaign not found" }];
  });

  // ---- Marketing: Segments ----
  mock.onGet(/\/marketing\/segments$/).reply(200, { segments: marketing.segmentsWithCounts() });
  mock.onPost(/\/marketing\/segments$/).reply((config) => {
    const segment = marketing.createSegmentRecord(JSON.parse(config.data || "{}"));
    return [201, { segment }];
  });
  mock.onDelete(/\/marketing\/segments\/[^/]+$/).reply((config) => {
    const segmentId = config.url.match(/\/marketing\/segments\/([^/]+)$/)[1];
    marketing.deleteSegmentRecord(segmentId);
    return [200, { success: true }];
  });

  // ---- Marketing: Forms ----
  mock.onPost(/\/marketing\/forms\/[^/]+\/submit$/).reply((config) => {
    const formId = config.url.match(/\/marketing\/forms\/([^/]+)\/submit$/)[1];
    const result = marketing.submitFormLeadRecord(formId, JSON.parse(config.data || "{}"));
    return result ? [200, result] : [404, { message: "Form not found" }];
  });
  mock.onGet(/\/marketing\/forms$/).reply(200, { forms: marketing.forms });
  mock.onPost(/\/marketing\/forms$/).reply((config) => {
    const form = marketing.createFormRecord(JSON.parse(config.data || "{}"));
    return [201, { form }];
  });

  // ---- Marketing: Templates ----
  mock.onGet(/\/marketing\/templates$/).reply(200, { templates: marketing.templates });
  mock.onPost(/\/marketing\/templates$/).reply((config) => {
    const template = marketing.createTemplateRecord(JSON.parse(config.data || "{}"));
    return [201, { template }];
  });

  // ---- Finance: Invoices ----
  mock.onPost(/\/finance\/invoices\/[^/]+\/payments$/).reply((config) => {
    const invoiceId = config.url.match(/\/finance\/invoices\/([^/]+)\/payments$/)[1];
    const { amount, method } = JSON.parse(config.data || "{}");
    const invoice = finance.recordPaymentRecord(invoiceId, amount, method);
    return invoice ? [200, { invoice }] : [404, { message: "Invoice not found" }];
  });
  mock.onGet(/\/finance\/invoices$/).reply(200, { invoices: finance.refreshOverdueStatuses() });
  mock.onGet(/\/finance\/invoices\/[^/]+$/).reply((config) => {
    const invoiceId = config.url.match(/\/finance\/invoices\/([^/]+)$/)[1];
    const invoice = finance.findInvoice(invoiceId);
    return invoice ? [200, { invoice }] : [404, { message: "Invoice not found" }];
  });
  mock.onPost(/\/finance\/invoices$/).reply((config) => {
    const invoice = finance.createInvoiceRecord(JSON.parse(config.data || "{}"));
    return [201, { invoice }];
  });
  mock.onPut(/\/finance\/invoices\/[^/]+$/).reply((config) => {
    const invoiceId = config.url.match(/\/finance\/invoices\/([^/]+)$/)[1];
    const invoice = finance.updateInvoiceRecord(invoiceId, JSON.parse(config.data || "{}"));
    return invoice ? [200, { invoice }] : [404, { message: "Invoice not found" }];
  });

  // ---- Finance: Credit Notes ----
  mock.onGet(/\/finance\/credit-notes$/).reply(200, { creditNotes: finance.creditNotes });
  mock.onPost(/\/finance\/credit-notes$/).reply((config) => {
    const result = finance.createCreditNoteRecord(JSON.parse(config.data || "{}"));
    return result ? [201, result] : [404, { message: "Invoice not found" }];
  });

  // ---- Finance: Expenses ----
  mock.onGet(/\/finance\/expenses$/).reply(200, { expenses: finance.expenses });
  mock.onPost(/\/finance\/expenses$/).reply((config) => {
    const expense = finance.createExpenseRecord(JSON.parse(config.data || "{}"));
    return [201, { expense }];
  });
  mock.onPut(/\/finance\/expenses\/[^/]+$/).reply((config) => {
    const expenseId = config.url.match(/\/finance\/expenses\/([^/]+)$/)[1];
    const expense = finance.updateExpenseRecord(expenseId, JSON.parse(config.data || "{}"));
    return expense ? [200, { expense }] : [404, { message: "Expense not found" }];
  });

  // ---- Finance: Recurring Invoices ----
  mock.onPost(/\/finance\/recurring-invoices\/[^/]+\/generate$/).reply((config) => {
    const recurringId = config.url.match(/\/finance\/recurring-invoices\/([^/]+)\/generate$/)[1];
    const result = finance.generateInvoiceFromRecurring(recurringId);
    return result ? [200, result] : [404, { message: "Recurring invoice not found" }];
  });
  mock.onGet(/\/finance\/recurring-invoices$/).reply(200, { recurringInvoices: finance.recurringInvoices });
  mock.onPost(/\/finance\/recurring-invoices$/).reply((config) => {
    const recurringInvoice = finance.createRecurringInvoiceRecord(JSON.parse(config.data || "{}"));
    return [201, { recurringInvoice }];
  });
  mock.onPut(/\/finance\/recurring-invoices\/[^/]+$/).reply((config) => {
    const recurringId = config.url.match(/\/finance\/recurring-invoices\/([^/]+)$/)[1];
    const recurringInvoice = finance.updateRecurringInvoiceRecord(recurringId, JSON.parse(config.data || "{}"));
    return recurringInvoice ? [200, { recurringInvoice }] : [404, { message: "Recurring invoice not found" }];
  });

  // ---- CRM: Activities ----
  // Frontend-first phase, same as Contacts/Companies: no permission gating,
  // no server-shaped pagination in the fetch-all endpoint (the full,
  // filtered-but-unpaginated set is needed by Agenda/Calendar views too;
  // pagination for the Table view happens client-side via
  // queryActivitiesLocal, same pattern as Companies).
  function validateActivityPayload(payload) {
    const errors = {};
    if (!(payload.title || "").trim()) errors.title = "Title is required";
    if (!payload.type) errors.type = "Activity type is required";
    if (payload.ownerId && !isValidOwner(payload.ownerId)) errors.ownerId = "Select a valid owner";
    if (payload.startAt && Number.isNaN(new Date(payload.startAt).getTime())) errors.startAt = "Enter a valid date";
    if (payload.dueDate && Number.isNaN(new Date(payload.dueDate).getTime())) errors.dueDate = "Enter a valid date";
    if (payload.endAt && payload.startAt && new Date(payload.endAt) < new Date(payload.startAt)) errors.endAt = "End time must be after the start time";
    return errors;
  }

  mock.onGet(/\/crm\/activities$/).reply((config) => {
    const params = config.params || {};
    return [200, activitiesData.queryActivitiesLocal(activitiesData.activities, { ...params, page: 1, pageSize: 100000 })];
  });

  mock.onGet(/\/crm\/activities\/[^/]+\/conflicts$/).reply((config) => {
    const activityId = config.url.match(/\/crm\/activities\/([^/]+)\/conflicts$/)[1];
    const activity = activitiesData.findActivity(activityId) || JSON.parse(config.data || "{}");
    return [200, { conflicts: activitiesData.findConflicts(activity) }];
  });

  mock.onGet(/\/crm\/activities\/[^/]+$/).reply((config) => {
    const activityId = config.url.match(/\/crm\/activities\/([^/]+)$/)[1];
    const activity = activitiesData.findActivity(activityId);
    return activity ? [200, { activity }] : [404, { message: "Activity not found" }];
  });

  mock.onPost(/\/crm\/activities$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const errors = validateActivityPayload(payload);
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors }];
    const activity = activitiesData.createActivityRecord(payload, getCurrentActor());
    return [201, { activity, conflicts: activitiesData.findConflicts(activity) }];
  });

  mock.onPut(/\/crm\/activities\/[^/]+$/).reply((config) => {
    const activityId = config.url.match(/\/crm\/activities\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");
    const errors = validateActivityPayload({ ...activitiesData.findActivity(activityId), ...changes });
    if (Object.keys(errors).length > 0) return [400, { message: "Validation failed", errors }];
    const activity = activitiesData.updateActivityRecord(activityId, changes, getCurrentActor());
    return activity ? [200, { activity, conflicts: activitiesData.findConflicts(activity) }] : [404, { message: "Activity not found" }];
  });

  mock.onPost(/\/crm\/activities\/[^/]+\/complete$/).reply((config) => {
    const activityId = config.url.match(/\/crm\/activities\/([^/]+)\/complete$/)[1];
    const body = JSON.parse(config.data || "{}");
    const result = activitiesData.completeActivityRecord(activityId, body, getCurrentActor());
    return result ? [200, result] : [404, { message: "Activity not found" }];
  });

  mock.onPost(/\/crm\/activities\/[^/]+\/followup$/).reply((config) => {
    const activityId = config.url.match(/\/crm\/activities\/([^/]+)\/followup$/)[1];
    const body = JSON.parse(config.data || "{}");
    if (!body.dueDate) return [400, { message: "A follow-up date is required" }];
    const result = activitiesData.createFollowUpForActivity(activityId, body, getCurrentActor());
    return result ? [201, result] : [404, { message: "Activity not found" }];
  });

  mock.onPost(/\/crm\/activities\/[^/]+\/reschedule$/).reply((config) => {
    const activityId = config.url.match(/\/crm\/activities\/([^/]+)\/reschedule$/)[1];
    const body = JSON.parse(config.data || "{}");
    if (!body.startAt) return [400, { message: "A new date/time is required" }];
    const activity = activitiesData.rescheduleActivityRecord(activityId, body, getCurrentActor());
    return activity ? [200, { activity, conflicts: activitiesData.findConflicts(activity) }] : [404, { message: "Activity not found" }];
  });

  mock.onPost(/\/crm\/activities\/[^/]+\/cancel$/).reply((config) => {
    const activityId = config.url.match(/\/crm\/activities\/([^/]+)\/cancel$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A cancellation reason is required" }];
    const activity = activitiesData.cancelActivityRecord(activityId, reason, getCurrentActor());
    return activity ? [200, { activity }] : [404, { message: "Activity not found" }];
  });

  mock.onPost(/\/crm\/activities\/[^/]+\/reopen$/).reply((config) => {
    const activityId = config.url.match(/\/crm\/activities\/([^/]+)\/reopen$/)[1];
    const activity = activitiesData.reopenActivityRecord(activityId, getCurrentActor());
    return activity ? [200, { activity }] : [404, { message: "Activity not found" }];
  });

  mock.onPost(/\/crm\/activities\/[^/]+\/duplicate$/).reply((config) => {
    const activityId = config.url.match(/\/crm\/activities\/([^/]+)\/duplicate$/)[1];
    const activity = activitiesData.duplicateActivityRecord(activityId, getCurrentActor());
    return activity ? [201, { activity }] : [404, { message: "Activity not found" }];
  });

  mock.onPost(/\/crm\/activities\/[^/]+\/attachments$/).reply((config) => {
    const activityId = config.url.match(/\/crm\/activities\/([^/]+)\/attachments$/)[1];
    const activity = activitiesData.addActivityAttachment(activityId, JSON.parse(config.data || "{}"), getCurrentActor());
    return activity ? [200, { activity }] : [404, { message: "Activity not found" }];
  });

  mock.onPost(/\/crm\/activities\/bulk\/assign$/).reply((config) => {
    const { activityIds, ownerId } = JSON.parse(config.data || "{}");
    if (!isValidOwner(ownerId)) return [400, { message: "Select a valid owner" }];
    return [200, { activities: activitiesData.bulkAssignActivities(activityIds || [], ownerId, getCurrentActor()) }];
  });

  mock.onPost(/\/crm\/activities\/bulk\/reschedule$/).reply((config) => {
    const { activityIds, startAt } = JSON.parse(config.data || "{}");
    if (!startAt) return [400, { message: "A new date/time is required" }];
    return [200, { activities: activitiesData.bulkRescheduleActivities(activityIds || [], startAt, getCurrentActor()) }];
  });

  mock.onPost(/\/crm\/activities\/bulk\/complete$/).reply((config) => {
    const { activityIds } = JSON.parse(config.data || "{}");
    return [200, { activities: activitiesData.bulkCompleteActivities(activityIds || [], getCurrentActor()) }];
  });

  mock.onPost(/\/crm\/activities\/bulk\/cancel$/).reply((config) => {
    const { activityIds, reason } = JSON.parse(config.data || "{}");
    if (!reason?.trim()) return [400, { message: "A cancellation reason is required" }];
    return [200, { activities: activitiesData.bulkCancelActivities(activityIds || [], reason, getCurrentActor()) }];
  });

  // ---- Administration: Roles & Permissions (frontend-only RBAC preview) ----
  // Every mutation here touches only the in-memory CUSTOM_ROLES array from
  // mockRbacData.js — nothing here persists, calls a real backend, or
  // changes production user/role assignments. See mockRbacData.js's header
  // comment for the full scope statement.
  mock.onGet(/\/admin\/roles$/).reply((config) => {
    const params = config.params || {};
    const roles = rbac.queryRolesLocal(params);
    return [200, {
      roles,
      counts: {
        builtin: rbac.allRoles().filter((r) => r.isBuiltIn).length,
        custom: rbac.allRoles().filter((r) => !r.isBuiltIn).length,
        highPrivilege: rbac.allRoles().filter((r) => rbac.isHighPrivilegeRole(r)).length,
        withUsers: rbac.allRoles().filter((r) => rbac.usersForRole(r.id).length > 0).length,
        needingReview: rbac.allRoles().filter((r) => rbac.detectRoleConflicts(r).length > 0).length,
      },
    }];
  });

  mock.onGet(/\/admin\/roles\/[^/]+$/).reply((config) => {
    const roleId = config.url.match(/\/admin\/roles\/([^/]+)$/)[1];
    const role = rbac.findRole(roleId);
    if (!role) return [404, { message: "Role not found" }];
    return [200, {
      role,
      assignedUsers: rbac.usersForRole(role.id),
      conflicts: rbac.detectRoleConflicts(role),
      changeHistory: rbac.changeHistoryForRole(role.id),
      auditPreview: rbac.auditPreviewForRole(role.id),
      highRiskGrants: rbac.countHighRiskGrants(role),
      visibleNav: rbac.getVisibleNavForRole(role.id),
    }];
  });

  mock.onPost(/\/admin\/roles$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const result = rbac.createCustomRole(payload);
    if (result.error) return [400, result];
    return [201, { role: result.role, conflicts: rbac.detectRoleConflicts(result.role) }];
  });

  mock.onPut(/\/admin\/roles\/[^/]+$/).reply((config) => {
    const roleId = config.url.match(/\/admin\/roles\/([^/]+)$/)[1];
    const result = rbac.updateCustomRole(roleId, JSON.parse(config.data || "{}"));
    if (result.error) return [400, result];
    return [200, { role: result.role, conflicts: rbac.detectRoleConflicts(result.role) }];
  });

  mock.onPost(/\/admin\/roles\/[^/]+\/duplicate$/).reply((config) => {
    const roleId = config.url.match(/\/admin\/roles\/([^/]+)\/duplicate$/)[1];
    const { name } = JSON.parse(config.data || "{}");
    const result = rbac.duplicateRoleAsCustom(roleId, name);
    if (result.error) return [400, result];
    return [201, { role: result.role }];
  });

  mock.onPost(/\/admin\/roles\/[^/]+\/archive$/).reply((config) => {
    const roleId = config.url.match(/\/admin\/roles\/([^/]+)\/archive$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const result = rbac.archiveCustomRole(roleId, reason);
    if (result.error) return [400, result];
    return [200, { role: result.role }];
  });

  mock.onPost(/\/admin\/roles\/[^/]+\/restore$/).reply((config) => {
    const roleId = config.url.match(/\/admin\/roles\/([^/]+)\/restore$/)[1];
    const result = rbac.restoreCustomRole(roleId);
    if (result.error) return [400, result];
    return [200, { role: result.role }];
  });

  mock.onPost(/\/admin\/roles\/[^/]+\/disable$/).reply((config) => {
    const roleId = config.url.match(/\/admin\/roles\/([^/]+)\/disable$/)[1];
    const result = rbac.disableCustomRole(roleId);
    if (result.error) return [400, result];
    return [200, { role: result.role }];
  });

  mock.onPost(/\/admin\/roles\/[^/]+\/enable$/).reply((config) => {
    const roleId = config.url.match(/\/admin\/roles\/([^/]+)\/enable$/)[1];
    const result = rbac.enableCustomRole(roleId);
    if (result.error) return [400, result];
    return [200, { role: result.role }];
  });

  mock.onPost(/\/admin\/roles\/compare$/).reply((config) => {
    const { roleIds } = JSON.parse(config.data || "{}");
    return [200, rbac.compareRoles(roleIds || [])];
  });

  mock.onGet(/\/admin\/permissions\/catalog$/).reply(() => {
    return [200, {
      moduleGroups: rbac.MODULE_GROUPS,
      actions: rbac.ACTIONS,
      actionLabels: rbac.ACTION_LABELS,
      scopes: rbac.SCOPES,
      scopeDescriptions: rbac.SCOPE_DESCRIPTIONS,
      sensitiveFieldGroups: rbac.SENSITIVE_FIELD_GROUPS,
      approvalTypes: rbac.APPROVAL_TYPES,
      highRiskPermissions: rbac.HIGH_RISK_PERMISSIONS,
      roles: rbac.allRoles(),
    }];
  });

  mock.onPost(/\/admin\/permissions\/access-preview$/).reply((config) => {
    const input = JSON.parse(config.data || "{}");
    const role = rbac.findRole(input.roleId);
    if (!role) return [400, { message: "Select a role to preview" }];

    const visibleNav = rbac.getVisibleNavForRole(role.id);
    const modulesWithView = rbac.allModules().filter((m) => rbac.hasAnyView(role, m.id));
    const deniedModules = rbac.allModules().filter((m) => !rbac.hasAnyView(role, m.id) && rbac.getApplicableActions(m).length > 0);
    const maskedFields = rbac.allSensitiveFields().filter((f) => rbac.getFieldState(role.id, f.id) !== "editable");
    const approvals = rbac.APPROVAL_TYPES.filter((a) => rbac.canApprove(role.id, a.id));

    const explanations = [];
    if (input.exampleRecordDepartment && input.department && input.exampleRecordDepartment !== input.department && !["Organization", "System-wide"].includes(role.defaultScope)) {
      explanations.push("Denied because this record belongs to another department.");
    }
    if (input.exampleRecordTeam && input.team && input.exampleRecordTeam !== input.team && role.defaultScope === "Team") {
      explanations.push("Denied because this record belongs to another team.");
    }
    if (!rbac.hasPermission(role.id, "leads", rbac.ACTIONS.EXPORT) && !rbac.hasPermission(role.id, "deals", rbac.ACTIONS.EXPORT)) {
      explanations.push("Export permission is not included in this role.");
    }
    if (input.isOwnRecordForApproval) {
      explanations.push("You cannot approve a request you submitted.");
    }
    if (maskedFields.length > 0) {
      explanations.push("Financial fields are restricted for this role.");
    }
    if (role.customerAccountRestricted) {
      explanations.push("Customer Portal users can access only their own Company.");
    }

    return [200, {
      role,
      visibleNav,
      accessibleModules: modulesWithView.map((m) => m.id),
      hiddenModules: deniedModules.map((m) => m.id),
      maskedFields: maskedFields.map((f) => f.id),
      approvalCapability: approvals.map((a) => a.id),
      explanations,
    }];
  });

  // ---- Administration: Access Management (frontend-only invitation preview) ----
  // Everything here reads/writes only mockAccessData.js's in-memory fixture
  // arrays — no real Gmail is ever sent, no real token is generated, no real
  // account or organization membership is created. /admin/users,
  // /admin/invitations, /admin/invite-links and /admin/access-audit are
  // already behind the existing /admin RequireAuth (Super-Admin + Admin);
  // /invite/:token and /join/:token are intentionally public routes (an
  // invitee isn't logged in yet), so neither needs its own role check here —
  // matching the /admin/roles block's existing convention of leaving the
  // role gate to the router. What DOES need enforcing here, since it can't
  // be trusted from a hidden field or query string, is organization scoping:
  // Organization Administrator's requests are always forced onto their own
  // organization, never whatever the client happened to send.
  function actingRoleTemplateId() {
    return rbac.getTemplateForRealRole(getCurrentRole())?.id || null;
  }
  function isAccessSystemOwner() {
    return actingRoleTemplateId() === "system_owner";
  }
  // Preview convention: any "Admin"-role session previews as the
  // Organization Administrator seeded on the default organization (Priya
  // Nair / org_caspira_hq) — there is no real per-user membership record
  // tying a logged-in preview session to one specific seeded member.
  function actingOrganizationId() {
    return access.DEFAULT_ORGANIZATION_ID;
  }
  function resolveOrganizationFilter(requestedOrgId) {
    return isAccessSystemOwner() ? requestedOrgId || undefined : actingOrganizationId();
  }
  function actingActorName() {
    return getCurrentActor();
  }

  mock.onGet(/\/admin\/organizations$/).reply(() => {
    if (isAccessSystemOwner()) return [200, { organizations: access.ORGANIZATIONS }];
    const own = access.findOrganization(actingOrganizationId());
    return [200, { organizations: own ? [own] : [] }];
  });

  mock.onGet(/\/admin\/members$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const members = access.queryMembersLocal({ ...params, organizationId });
    return [200, { members, counts: access.computeMemberMetrics(members), teams: access.TEAMS, departments: access.DEPARTMENTS }];
  });

  mock.onGet(/\/admin\/members\/[^/]+$/).reply((config) => {
    const memberId = config.url.match(/\/admin\/members\/([^/]+)$/)[1];
    const member = access.findMember(memberId);
    if (!member) return [404, { message: "Member not found" }];
    if (!isAccessSystemOwner() && member.organizationId !== actingOrganizationId()) return forbidden("You cannot view a member outside your organization.");
    return [200, { member }];
  });

  mock.onPost(/\/admin\/members\/[^/]+\/role$/).reply((config) => {
    const memberId = config.url.match(/\/admin\/members\/([^/]+)\/role$/)[1];
    const { newRoleId, reason } = JSON.parse(config.data || "{}");
    const member = access.findMember(memberId);
    if (!member) return [404, { message: "Member not found" }];
    if (!isAccessSystemOwner()) {
      if (member.organizationId !== actingOrganizationId()) return forbidden("You cannot modify a member outside your organization.");
      if (member.roleIds.some(access.isHighPrivilegeRoleId)) return forbidden("You cannot modify a member with equal or higher administrative authority.");
      if (access.isHighPrivilegeRoleId(newRoleId)) return forbidden("You cannot assign a high-privilege role.");
    }
    const result = access.changeMemberRole(memberId, newRoleId, reason, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/members\/[^/]+\/suspend$/).reply((config) => {
    const memberId = config.url.match(/\/admin\/members\/([^/]+)\/suspend$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const member = access.findMember(memberId);
    if (!member) return [404, { message: "Member not found" }];
    if (!isAccessSystemOwner() && (member.organizationId !== actingOrganizationId() || member.roleIds.some(access.isHighPrivilegeRoleId))) {
      return forbidden("You cannot suspend this member.");
    }
    const result = access.suspendMember(memberId, reason, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/members\/[^/]+\/reactivate$/).reply((config) => {
    const memberId = config.url.match(/\/admin\/members\/([^/]+)\/reactivate$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const member = access.findMember(memberId);
    if (!member) return [404, { message: "Member not found" }];
    if (!isAccessSystemOwner() && member.organizationId !== actingOrganizationId()) return forbidden("You cannot reactivate this member.");
    const result = access.reactivateMember(memberId, reason, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/members\/[^/]+\/remove$/).reply((config) => {
    const memberId = config.url.match(/\/admin\/members\/([^/]+)\/remove$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const member = access.findMember(memberId);
    if (!member) return [404, { message: "Member not found" }];
    if (!isAccessSystemOwner() && (member.organizationId !== actingOrganizationId() || member.roleIds.some(access.isHighPrivilegeRoleId))) {
      return forbidden("You cannot remove this member.");
    }
    const result = access.removeMember(memberId, reason, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/members\/[^/]+\/assign$/).reply((config) => {
    const memberId = config.url.match(/\/admin\/members\/([^/]+)\/assign$/)[1];
    const payload = JSON.parse(config.data || "{}");
    const member = access.findMember(memberId);
    if (!member) return [404, { message: "Member not found" }];
    if (!isAccessSystemOwner() && member.organizationId !== actingOrganizationId()) return forbidden("You cannot modify this member.");
    const result = access.assignMemberDepartmentTeam(memberId, payload, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/invitations\/validate-recipient$/).reply((config) => {
    const { email, organizationId } = config.params || {};
    if (!email || !organizationId) return [400, { message: "email and organizationId are required" }];
    return [200, access.validateInvitationRecipient(email, resolveOrganizationFilter(organizationId))];
  });

  mock.onGet(/\/admin\/invitations$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const invitations = access.queryInvitationsLocal({ ...params, organizationId });
    return [200, { invitations, counts: access.computeInvitationMetrics(invitations) }];
  });

  mock.onPost(/\/admin\/invitations$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const organizationId = resolveOrganizationFilter(payload.organizationId);
    if (!isAccessSystemOwner() && payload.organizationId && payload.organizationId !== organizationId) {
      return forbidden("You cannot invite a member to another organization.");
    }
    if (!isAccessSystemOwner() && access.isHighPrivilegeRoleId(payload.intendedRoleId)) {
      return forbidden("You cannot invite a member into a high-privilege role.");
    }
    if (isAccessSystemOwner() && payload.intendedRoleId === "system_owner") {
      return forbidden("System Owner cannot be assigned through the ordinary invitation form.");
    }
    const validation = access.validateInvitationRecipient(payload.email, organizationId);
    if (!validation.valid) return [400, { message: validation.message, reason: validation.reason }];
    const invitation = access.createInvitation({ ...payload, organizationId, invitedByName: actingActorName() });
    return [201, { invitation, warning: validation.warning }];
  });

  mock.onPost(/\/admin\/invitations\/[^/]+\/resend$/).reply((config) => {
    const invitationId = config.url.match(/\/admin\/invitations\/([^/]+)\/resend$/)[1];
    const result = access.resendInvitation(invitationId, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/invitations\/[^/]+\/revoke$/).reply((config) => {
    const invitationId = config.url.match(/\/admin\/invitations\/([^/]+)\/revoke$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const result = access.revokeInvitation(invitationId, reason, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/invitations\/[^/]+\/approve$/).reply((config) => {
    const invitationId = config.url.match(/\/admin\/invitations\/([^/]+)\/approve$/)[1];
    const result = access.approveJoinRequest(invitationId, "invitation", actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/invitations\/[^/]+\/reject$/).reply((config) => {
    const invitationId = config.url.match(/\/admin\/invitations\/([^/]+)\/reject$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const result = access.rejectJoinRequest(invitationId, reason, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/invite-links$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const inviteLinks = access.queryInviteLinksLocal({ ...params, organizationId });
    return [200, { inviteLinks, counts: access.computeInviteLinkMetrics(inviteLinks) }];
  });

  mock.onPost(/\/admin\/invite-links$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const organizationId = resolveOrganizationFilter(payload.organizationId);
    if (!isAccessSystemOwner() && payload.organizationId && payload.organizationId !== organizationId) {
      return forbidden("You cannot create an invite link for another organization.");
    }
    const result = access.createInviteLink({ ...payload, organizationId, createdBy: payload.createdBy, createdByName: actingActorName() });
    if (result.error) return [400, result];
    return [201, result];
  });

  mock.onPost(/\/admin\/invite-links\/[^/]+\/rotate$/).reply((config) => {
    const linkId = config.url.match(/\/admin\/invite-links\/([^/]+)\/rotate$/)[1];
    const result = access.rotateInviteLink(linkId, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/invite-links\/[^/]+\/revoke$/).reply((config) => {
    const linkId = config.url.match(/\/admin\/invite-links\/([^/]+)\/revoke$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const result = access.revokeInviteLink(linkId, reason, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/access-audit$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const events = access.queryAccessAuditLocal({ ...params, organizationId });
    return [200, { events }];
  });

  // ---- Public invitation/link acceptance preview (no RequireAuth) ----
  mock.onGet(/\/invite\/[^/]+$/).reply((config) => {
    const token = config.url.match(/\/invite\/([^/]+)$/)[1];
    const invitation = access.findInvitationByToken(token);
    if (!invitation) return [200, { state: "invalid_token" }];
    const organization = access.findOrganization(invitation.organizationId);
    return [200, { invitation, organization }];
  });

  mock.onPost(/\/invite\/[^/]+\/accept$/).reply((config) => {
    const token = config.url.match(/\/invite\/([^/]+)\/accept$/)[1];
    const payload = JSON.parse(config.data || "{}");
    const result = access.acceptEmailInvitationPreview(token, payload);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/invite\/[^/]+\/decline$/).reply((config) => {
    const token = config.url.match(/\/invite\/([^/]+)\/decline$/)[1];
    const invitation = access.findInvitationByToken(token);
    if (!invitation) return [400, { error: "invalid_token" }];
    const result = access.rejectJoinRequest(invitation.id, "Declined by invitee.", invitation.email);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/join\/[^/]+$/).reply((config) => {
    const token = config.url.match(/\/join\/([^/]+)$/)[1];
    const link = access.findInviteLinkByToken(token);
    if (!link) return [200, { state: "invalid_token" }];
    const organization = access.findOrganization(link.organizationId);
    return [200, { link, organization }];
  });

  mock.onPost(/\/join\/[^/]+\/accept$/).reply((config) => {
    const token = config.url.match(/\/join\/([^/]+)\/accept$/)[1];
    const payload = JSON.parse(config.data || "{}");
    const result = access.acceptInviteLinkPreview(token, payload);
    if (result.error) return [400, result];
    return [200, result];
  });

  // ---- Administration: Integration Center (frontend-only preview) ----
  // Everything here reads/writes only mockIntegrationsData.js's in-memory
  // fixture arrays — no real provider is ever contacted, no real OAuth token
  // is exchanged, no real webhook is registered, no real credential is ever
  // stored. Every connection is a "Frontend Connection Preview." Providers
  // are a global catalog (not org-scoped); connections are org-scoped and
  // use the same resolveOrganizationFilter enforcement Access Management
  // established (a non-owner's requested org is always forced to their own).
  mock.onGet(/\/admin\/integrations\/providers$/).reply((config) => {
    // Accept-and-ignore organizationId for shape-consistency with every
    // sibling list endpoint — the catalog itself has no org scope.
    const params = config.params || {};
    const providers = integrations.queryProvidersLocal(params);
    return [200, { providers, counts: { total: providers.length } }];
  });

  mock.onGet(/\/admin\/integrations\/providers\/[^/]+$/).reply((config) => {
    const providerKey = config.url.match(/\/admin\/integrations\/providers\/([^/]+)$/)[1];
    const provider = integrations.findProvider(providerKey);
    if (!provider) return [404, { message: "Provider not found" }];
    return [200, { provider }];
  });

  mock.onGet(/\/admin\/integrations\/connections$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const connections = integrations.queryConnectionsLocal({ ...params, organizationId });
    return [200, { connections, counts: integrations.computeIntegrationMetrics(connections) }];
  });

  mock.onGet(/\/admin\/integrations\/connections\/[^/]+$/).reply((config) => {
    const connectionId = config.url.match(/\/admin\/integrations\/connections\/([^/]+)$/)[1];
    const connection = integrations.findConnection(connectionId);
    if (!connection) return [404, { message: "Connection not found" }];
    if (!isAccessSystemOwner() && connection.organizationId !== actingOrganizationId()) {
      return forbidden("You cannot view a connection outside your organization.");
    }
    return [200, { connection }];
  });

  mock.onPost(/\/admin\/integrations\/connections$/).reply((config) => {
    const payload = JSON.parse(config.data || "{}");
    const organizationId = resolveOrganizationFilter(payload.organizationId);
    if (!isAccessSystemOwner() && payload.organizationId && payload.organizationId !== organizationId) {
      return forbidden("You cannot create a preview connection for another organization.");
    }
    const result = integrations.createConnectionPreview({ ...payload, organizationId, connectedByName: actingActorName() });
    if (result.error) return [400, result];
    return [201, result];
  });

  function requireOwnedConnection(connectionId) {
    const connection = integrations.findConnection(connectionId);
    if (!connection) return { error: [404, { message: "Connection not found" }] };
    if (!isAccessSystemOwner() && connection.organizationId !== actingOrganizationId()) {
      return { error: forbidden("You cannot modify a connection outside your organization.") };
    }
    return { connection };
  }

  mock.onPost(/\/admin\/integrations\/connections\/[^/]+\/pause$/).reply((config) => {
    const connectionId = config.url.match(/\/admin\/integrations\/connections\/([^/]+)\/pause$/)[1];
    const owned = requireOwnedConnection(connectionId);
    if (owned.error) return owned.error;
    const result = integrations.pauseConnection(connectionId, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/connections\/[^/]+\/resume$/).reply((config) => {
    const connectionId = config.url.match(/\/admin\/integrations\/connections\/([^/]+)\/resume$/)[1];
    const owned = requireOwnedConnection(connectionId);
    if (owned.error) return owned.error;
    const result = integrations.resumeConnection(connectionId, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/connections\/[^/]+\/disconnect$/).reply((config) => {
    const connectionId = config.url.match(/\/admin\/integrations\/connections\/([^/]+)\/disconnect$/)[1];
    const owned = requireOwnedConnection(connectionId);
    if (owned.error) return owned.error;
    const { reason } = JSON.parse(config.data || "{}");
    const result = integrations.disconnectConnection(connectionId, reason, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/connections\/[^/]+\/undo-disconnect$/).reply((config) => {
    const connectionId = config.url.match(/\/admin\/integrations\/connections\/([^/]+)\/undo-disconnect$/)[1];
    const owned = requireOwnedConnection(connectionId);
    if (owned.error) return owned.error;
    const result = integrations.undoDisconnectConnection(connectionId, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/connections\/[^/]+\/sync$/).reply((config) => {
    const connectionId = config.url.match(/\/admin\/integrations\/connections\/([^/]+)\/sync$/)[1];
    const owned = requireOwnedConnection(connectionId);
    if (owned.error) return owned.error;
    const { jobType } = JSON.parse(config.data || "{}");
    const result = integrations.runPreviewSync(connectionId, jobType || "Manual Sync", actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/connections\/[^/]+\/sync\/[^/]+\/retry$/).reply((config) => {
    const match = config.url.match(/\/admin\/integrations\/connections\/([^/]+)\/sync\/([^/]+)\/retry$/);
    const [, connectionId, jobId] = match;
    const owned = requireOwnedConnection(connectionId);
    if (owned.error) return owned.error;
    const result = integrations.retryFailedSync(connectionId, jobId, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/connections\/[^/]+\/mappings\/[^/]+$/).reply((config) => {
    const match = config.url.match(/\/admin\/integrations\/connections\/([^/]+)\/mappings\/([^/]+)$/);
    const [, connectionId, mappingId] = match;
    const owned = requireOwnedConnection(connectionId);
    if (owned.error) return owned.error;
    const changes = JSON.parse(config.data || "{}");
    const result = integrations.updateFieldMapping(connectionId, mappingId, changes);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/connections\/[^/]+\/config$/).reply((config) => {
    const connectionId = config.url.match(/\/admin\/integrations\/connections\/([^/]+)\/config$/)[1];
    const owned = requireOwnedConnection(connectionId);
    if (owned.error) return owned.error;
    const changes = JSON.parse(config.data || "{}");
    const result = integrations.updateConnectionConfig(connectionId, changes, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/connections\/[^/]+\/test$/).reply((config) => {
    const connectionId = config.url.match(/\/admin\/integrations\/connections\/([^/]+)\/test$/)[1];
    const owned = requireOwnedConnection(connectionId);
    if (owned.error) return owned.error;
    const result = integrations.testPreviewConnection(connectionId, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/activity$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const events = integrations.queryActivityLocal({ ...params, organizationId });
    return [200, { events }];
  });

  mock.onGet(/\/admin\/integrations\/webhooks$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const webhooks = integrations.queryWebhooksLocal({ ...params, organizationId });
    return [200, { webhooks }];
  });

  // ---- Administration: Sales & Marketing Integrations (Phase 2, frontend-only preview) ----
  // Same frontend-only boundary as the Integration Center block above — no
  // real provider is ever contacted. Lead Capture/Audiences/Suppression/
  // Email Delivery/Forms are org-scoped via the same resolveOrganizationFilter
  // enforcement; Attribution/Campaign references read live against real
  // shared CRM records (see mockSalesMarketingData.js).
  mock.onGet(/\/admin\/integrations\/sales-marketing\/lead-capture$/).reply((config) => {
    const params = config.params || {};
    const orgId = resolveOrganizationFilter(params.organizationId);
    const events = salesMarketing.queryLeadCaptureEventsLocal({ ...params, orgId });
    return [200, { events }];
  });

  function requireOwnedCaptureEvent(eventId) {
    const event = salesMarketing.findLeadCaptureEvent(eventId);
    if (!event) return { error: [404, { message: "Lead capture event not found" }] };
    if (!isAccessSystemOwner() && event.orgId !== actingOrganizationId()) {
      return { error: forbidden("You cannot modify a lead capture event outside your organization.") };
    }
    return { event };
  }

  mock.onPost(/\/admin\/integrations\/sales-marketing\/lead-capture\/[^/]+\/create-lead$/).reply((config) => {
    const eventId = config.url.match(/\/lead-capture\/([^/]+)\/create-lead$/)[1];
    const owned = requireOwnedCaptureEvent(eventId);
    if (owned.error) return owned.error;
    const overrides = JSON.parse(config.data || "{}");
    const result = salesMarketing.createLeadFromCapture(eventId, overrides, actingActorName());
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: result.event.orgId, providerKey: result.event.providerKey, event: "Lead created from capture preview", recordsAffected: 1 });
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/sales-marketing\/lead-capture\/[^/]+\/reject$/).reply((config) => {
    const eventId = config.url.match(/\/lead-capture\/([^/]+)\/reject$/)[1];
    const owned = requireOwnedCaptureEvent(eventId);
    if (owned.error) return owned.error;
    const { reason } = JSON.parse(config.data || "{}");
    const result = salesMarketing.rejectLeadCapture(eventId, reason, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/sales-marketing\/lead-capture\/[^/]+\/retry$/).reply((config) => {
    const eventId = config.url.match(/\/lead-capture\/([^/]+)\/retry$/)[1];
    const owned = requireOwnedCaptureEvent(eventId);
    if (owned.error) return owned.error;
    const result = salesMarketing.retryLeadCaptureProcessing(eventId, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/sales-marketing\/audiences$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const audiences = salesMarketing.queryAudiencesLocal({ ...params, organizationId });
    return [200, { audiences }];
  });

  mock.onGet(/\/admin\/integrations\/sales-marketing\/audiences\/[^/]+\/eligibility$/).reply((config) => {
    const audienceId = config.url.match(/\/audiences\/([^/]+)\/eligibility$/)[1];
    const result = salesMarketing.computeAudienceEligibility(audienceId);
    if (result.error) return [404, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/sales-marketing\/suppression$/).reply((config) => {
    const params = config.params || {};
    const entries = salesMarketing.querySuppressionEntriesLocal(params);
    return [200, { entries }];
  });

  mock.onPost(/\/admin\/integrations\/sales-marketing\/suppression\/[^/]+\/remove$/).reply((config) => {
    const entryId = config.url.match(/\/suppression\/([^/]+)\/remove$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const result = salesMarketing.removeSuppressionEntry(entryId, reason, actingActorName());
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Marketing suppression removed", details: reason, recordsAffected: 1 });
    return [200, { entryId, removed: result.removed }];
  });

  mock.onGet(/\/admin\/integrations\/sales-marketing\/email-delivery$/).reply((config) => {
    const params = config.params || {};
    const orgId = resolveOrganizationFilter(params.organizationId);
    const events = salesMarketing.queryEmailDeliveryEventsLocal({ ...params, orgId });
    return [200, { events, metrics: salesMarketing.computeEmailDeliveryMetrics(events) }];
  });

  mock.onPost(/\/admin\/integrations\/sales-marketing\/email-delivery\/[^/]+\/retry$/).reply((config) => {
    const eventId = config.url.match(/\/email-delivery\/([^/]+)\/retry$/)[1];
    const result = salesMarketing.retryEmailDelivery(eventId, actingActorName());
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: result.event.orgId, providerKey: result.event.providerKey, event: "Email delivery preview retried", recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/sales-marketing\/attribution$/).reply((config) => {
    const params = config.params || {};
    const summary = salesMarketing.computeAttributionSummary(params);
    return [200, { summary }];
  });

  mock.onGet(/\/admin\/integrations\/sales-marketing\/forms$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const forms = salesMarketing.queryFormConnectionsLocal({ ...params, organizationId });
    return [200, { forms }];
  });

  mock.onPost(/\/admin\/integrations\/sales-marketing\/forms\/[^/]+\/mappings\/[^/]+$/).reply((config) => {
    const match = config.url.match(/\/forms\/([^/]+)\/mappings\/([^/]+)$/);
    const [, formConnectionId, mappingId] = match;
    const changes = JSON.parse(config.data || "{}");
    const result = salesMarketing.updateFormFieldMapping(formConnectionId, mappingId, changes);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/sales-marketing\/forms\/[^/]+\/enable$/).reply((config) => {
    const formConnectionId = config.url.match(/\/forms\/([^/]+)\/enable$/)[1];
    const result = salesMarketing.enableFormConnection(formConnectionId);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/sales-marketing\/overview-metrics$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const connections = integrations.queryConnectionsLocal(organizationId ? { organizationId } : {});
    const metrics = salesMarketing.computeSalesMarketingOverviewMetrics({ organizationId, connections });
    return [200, { metrics }];
  });

  mock.onGet(/\/admin\/integrations\/sales-marketing\/consent-summary$/).reply(() => {
    const summary = salesMarketing.deriveMarketingConsentSummary();
    return [200, { summary }];
  });

  mock.onPost(/\/admin\/integrations\/sales-marketing\/lead-capture\/[^/]+\/check-duplicates$/).reply((config) => {
    const eventId = config.url.match(/\/lead-capture\/([^/]+)\/check-duplicates$/)[1];
    const owned = requireOwnedCaptureEvent(eventId);
    if (owned.error) return owned.error;
    const result = salesMarketing.detectLeadCaptureDuplicates(eventId);
    if (result.error) return [400, result];
    return [200, result];
  });

  // ---- Administration: Customer Support and Communication Integrations
  // (Phase 3, frontend-only preview) ----
  // Same frontend-only boundary as the two blocks above — no real provider
  // is ever contacted, no real message/call/reply is ever sent. Channels/
  // conversations/tickets/calls/reviews are org-scoped via the same
  // resolveOrganizationFilter enforcement; SLA/escalation config is
  // org-scoped the same way. Specific sub-paths (e.g. "/channels/queue-
  // mappings") are registered with an exact `$` anchor before this block's
  // more general routes so axios-mock-adapter never lets a general pattern
  // swallow a more specific one.
  mock.onGet(/\/admin\/integrations\/support-communication\/channels\/queue-mappings$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const mappings = supportComm.querySupportQueueMappingsLocal({ ...params, organizationId });
    return [200, { mappings }];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/channels\/agent-mappings$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const mappings = supportComm.querySupportAgentMappingsLocal({ ...params, organizationId });
    return [200, { mappings }];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/channels\/reviews$/).reply((config) => {
    const params = config.params || {};
    const orgId = resolveOrganizationFilter(params.organizationId);
    const reviews = supportComm.queryReviewsLocal({ ...params, orgId });
    return [200, { reviews }];
  });

  mock.onPost(/\/admin\/integrations\/support-communication\/channels\/reviews\/[^/]+\/draft-reply$/).reply((config) => {
    const reviewId = config.url.match(/\/reviews\/([^/]+)\/draft-reply$/)[1];
    const { draftText } = JSON.parse(config.data || "{}");
    const result = supportComm.draftReviewReply(reviewId, draftText, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/overview-metrics$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const connections = integrations.queryConnectionsLocal(organizationId ? { organizationId } : {});
    const metrics = supportComm.computeSupportOverviewMetrics({ organizationId, connections });
    return [200, { metrics }];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/channels$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const channels = supportComm.querySupportChannelsLocal({ ...params, organizationId });
    return [200, { channels }];
  });

  function requireOwnedConversation(conversationId) {
    const conversation = supportComm.findSupportConversation(conversationId);
    if (!conversation) return { error: [404, { message: "Conversation not found" }] };
    if (!isAccessSystemOwner() && conversation.orgId !== actingOrganizationId()) {
      return { error: forbidden("You cannot access a conversation outside your organization.") };
    }
    return { conversation };
  }

  mock.onGet(/\/admin\/integrations\/support-communication\/inbox$/).reply((config) => {
    const params = config.params || {};
    const orgId = resolveOrganizationFilter(params.organizationId);
    const conversations = supportComm.querySupportConversationsLocal({ ...params, orgId });
    return [200, { conversations }];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/inbox\/[^/]+\/identity-match$/).reply((config) => {
    const conversationId = config.url.match(/\/inbox\/([^/]+)\/identity-match$/)[1];
    const owned = requireOwnedConversation(conversationId);
    if (owned.error) return owned.error;
    const match = supportComm.matchSupportIdentity(owned.conversation.customer || {});
    return [200, { match }];
  });

  mock.onPost(/\/admin\/integrations\/support-communication\/inbox\/[^/]+\/messages$/).reply((config) => {
    const conversationId = config.url.match(/\/inbox\/([^/]+)\/messages$/)[1];
    const owned = requireOwnedConversation(conversationId);
    if (owned.error) return owned.error;
    const { visibility, body } = JSON.parse(config.data || "{}");
    const result = supportComm.sendMessagePreview(conversationId, { visibility, body, author: actingActorName() });
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/support-communication\/inbox\/[^/]+\/undo$/).reply((config) => {
    const conversationId = config.url.match(/\/inbox\/([^/]+)\/undo$/)[1];
    const owned = requireOwnedConversation(conversationId);
    if (owned.error) return owned.error;
    const result = supportComm.undoLastConversationMessage(conversationId);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/support-communication\/inbox\/[^/]+\/escalate$/).reply((config) => {
    const conversationId = config.url.match(/\/inbox\/([^/]+)\/escalate$/)[1];
    const owned = requireOwnedConversation(conversationId);
    if (owned.error) return owned.error;
    const overrides = JSON.parse(config.data || "{}");
    const result = supportComm.escalateConversationToTicket(conversationId, overrides);
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: owned.conversation.orgId, providerKey: owned.conversation.providerKey, event: "Conversation escalated to Ticket preview", recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/inbox\/[^/]+$/).reply((config) => {
    const conversationId = config.url.match(/\/inbox\/([^/]+)$/)[1];
    const owned = requireOwnedConversation(conversationId);
    if (owned.error) return owned.error;
    return [200, { conversation: owned.conversation }];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/tickets\/conflicts$/).reply((config) => {
    const params = config.params || {};
    const conflicts = supportComm.querySupportSyncConflictsLocal(params);
    return [200, { conflicts }];
  });

  mock.onPost(/\/admin\/integrations\/support-communication\/tickets\/conflicts\/[^/]+\/resolve$/).reply((config) => {
    const conflictId = config.url.match(/\/conflicts\/([^/]+)\/resolve$/)[1];
    const { resolution, note } = JSON.parse(config.data || "{}");
    const result = supportComm.resolveSyncConflict(conflictId, resolution, note, actingActorName());
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Synchronization conflict resolved", details: resolution, recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/tickets$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const previews = supportComm.queryEnrichedTicketPreviewsLocal({ ...params, organizationId });
    return [200, { previews }];
  });

  mock.onPost(/\/admin\/integrations\/support-communication\/tickets\/[^/]+\/assign$/).reply((config) => {
    const ticketId = config.url.match(/\/tickets\/([^/]+)\/assign$/)[1];
    const { agentId } = JSON.parse(config.data || "{}");
    const result = supportComm.assignTicketPreview(ticketId, agentId, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/support-communication\/tickets\/[^/]+\/status$/).reply((config) => {
    const ticketId = config.url.match(/\/tickets\/([^/]+)\/status$/)[1];
    const { canonicalStatus } = JSON.parse(config.data || "{}");
    const result = supportComm.changeTicketStatusPreview(ticketId, canonicalStatus, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/support-communication\/tickets\/[^/]+\/close$/).reply((config) => {
    const ticketId = config.url.match(/\/tickets\/([^/]+)\/close$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const result = supportComm.closeTicketPreview(ticketId, reason, actingActorName());
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Ticket closed via integration preview", details: reason, recordsAffected: 1 });
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/support-communication\/tickets\/[^/]+\/note$/).reply((config) => {
    const ticketId = config.url.match(/\/tickets\/([^/]+)\/note$/)[1];
    const { message } = JSON.parse(config.data || "{}");
    const result = supportComm.addInternalNotePreviewToTicket(ticketId, message, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/support-communication\/tickets\/[^/]+\/retry-sync$/).reply((config) => {
    const ticketId = config.url.match(/\/tickets\/([^/]+)\/retry-sync$/)[1];
    const result = supportComm.retryTicketSyncPreview(ticketId, actingActorName());
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Ticket synchronization retried", recordsAffected: 1 });
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/support-communication\/tickets\/[^/]+\/link-customer$/).reply((config) => {
    const ticketId = config.url.match(/\/tickets\/([^/]+)\/link-customer$/)[1];
    const { contactId, contactName } = JSON.parse(config.data || "{}");
    const result = supportComm.linkCustomerToTicket(ticketId, contactId, contactName, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/tickets\/[^/]+\/identity-match$/).reply((config) => {
    const ticketId = config.url.match(/\/tickets\/([^/]+)\/identity-match$/)[1];
    const ticket = supportComm.findTicket(ticketId);
    if (!ticket) return [404, { message: "Ticket not found" }];
    const match = supportComm.matchSupportIdentity({ name: ticket.contactName, companyName: ticket.companyName });
    return [200, { match }];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/sla\/escalations\/[^/]+\/preview$/).reply((config) => {
    const ruleId = config.url.match(/\/escalations\/([^/]+)\/preview$/)[1];
    const params = config.params || {};
    const ticket = params.ticketId ? supportComm.findTicket(params.ticketId) : null;
    const preview = supportComm.previewEscalation(ruleId, ticket);
    if (preview.error) return [404, preview];
    return [200, { preview }];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/sla\/escalations$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const rules = supportComm.queryEscalationRulesLocal({ ...params, organizationId });
    return [200, { rules }];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/sla$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const configurations = organizationId
      ? supportComm.SUPPORT_SLA_CONFIGURATIONS.filter((c) => c.organizationId === organizationId)
      : supportComm.SUPPORT_SLA_CONFIGURATIONS;
    return [200, { configurations }];
  });

  mock.onPost(/\/admin\/integrations\/support-communication\/telephony\/[^/]+\/follow-up$/).reply((config) => {
    const callId = config.url.match(/\/telephony\/([^/]+)\/follow-up$/)[1];
    const result = supportComm.markCallFollowUpCreated(callId);
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Follow-up Activity preview created from call", recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/support-communication\/telephony$/).reply((config) => {
    const params = config.params || {};
    const orgId = resolveOrganizationFilter(params.organizationId);
    const calls = supportComm.queryCallsLocal({ ...params, orgId });
    return [200, { calls }];
  });

  // ---- Administration: Projects and Development Integrations (Phase 4,
  // frontend-only preview) ----
  // Same frontend-only boundary as the three blocks above — no real
  // provider is ever contacted, no external Project/issue/repository/PR is
  // ever created, no build/pipeline is triggered, no deployment is started
  // or rolled back. Won-Deal/Project/Task/mapping/development/conflict
  // endpoints are org-scoped via the same resolveOrganizationFilter
  // enforcement as every prior phase. Specific sub-paths (e.g.
  // "/projects/won-deals") are registered with an exact `$` anchor before
  // this block's more general routes (e.g. "/projects$") so
  // axios-mock-adapter never lets a general pattern swallow a more
  // specific one — the same discipline Phase 3's block documented.
  mock.onGet(/\/admin\/integrations\/projects-development\/overview-metrics$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const connections = integrations.queryConnectionsLocal(organizationId ? { organizationId } : {});
    const metrics = projectsDev.computeProjectsDevelopmentOverviewMetrics({ organizationId, connections });
    return [200, { metrics }];
  });

  mock.onGet(/\/admin\/integrations\/projects-development\/won-deals$/).reply(() => {
    const deals = projectsDev.queryWonDealsReadyForProject();
    return [200, { deals }];
  });

  mock.onGet(/\/admin\/integrations\/projects-development\/won-deals\/[^/]+\/preview$/).reply((config) => {
    const dealId = config.url.match(/\/won-deals\/([^/]+)\/preview$/)[1];
    const params = config.params || {};
    const preview = projectsDev.previewProjectFromWonDeal(dealId, params);
    if (preview.error) return [404, preview];
    return [200, { preview }];
  });

  mock.onPost(/\/admin\/integrations\/projects-development\/won-deals\/[^/]+\/create$/).reply((config) => {
    const dealId = config.url.match(/\/won-deals\/([^/]+)\/create$/)[1];
    const body = JSON.parse(config.data || "{}");
    const result = projectsDev.confirmProjectFromWonDeal(dealId, body, actingActorName());
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Project preview created from Won Deal", recordsAffected: 1 + result.tasks.length });
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/projects-development\/won-deals\/undo$/).reply(() => {
    const result = projectsDev.undoLastWonDealProject();
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/projects-development\/project-links\/[^/]+\/unlink$/).reply((config) => {
    const linkId = config.url.match(/\/project-links\/([^/]+)\/unlink$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const result = projectsDev.unlinkExternalProject(linkId, reason);
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "External Project unlinked", details: reason, recordsAffected: 1 });
    return [200, { linkId, removed: result.removed }];
  });

  mock.onPost(/\/admin\/integrations\/projects-development\/project-links\/[^/]+\/pause$/).reply((config) => {
    const linkId = config.url.match(/\/project-links\/([^/]+)\/pause$/)[1];
    const { paused } = JSON.parse(config.data || "{}");
    const result = projectsDev.pauseExternalProjectLink(linkId, paused);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/projects-development\/project-links\/[^/]+\/sync$/).reply((config) => {
    const linkId = config.url.match(/\/project-links\/([^/]+)\/sync$/)[1];
    const result = projectsDev.previewProjectSync(linkId);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/projects-development\/project-links$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const links = projectsDev.queryExternalProjectLinksLocal({ ...params, organizationId });
    return [200, { links }];
  });

  mock.onPost(/\/admin\/integrations\/projects-development\/work-items\/[^/]+\/retry$/).reply((config) => {
    const workItemId = config.url.match(/\/work-items\/([^/]+)\/retry$/)[1];
    const result = projectsDev.retryWorkItemSync(workItemId);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/projects-development\/work-items$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const items = projectsDev.queryWorkItemPreviewsLocal({ ...params, organizationId });
    return [200, { items }];
  });

  mock.onGet(/\/admin\/integrations\/projects-development\/mappings$/).reply((config) => {
    const params = config.params || {};
    return [200, {
      projectStatus: projectsDev.queryStatusMappingsLocal("project", params),
      taskStatus: projectsDev.queryStatusMappingsLocal("task", params),
      priority: projectsDev.queryStatusMappingsLocal("priority", params),
      workItemType: projectsDev.queryStatusMappingsLocal("workItemType", params),
      users: projectsDev.queryUserMappingsLocal(params),
      teams: projectsDev.queryTeamMappingsLocal(params),
    }];
  });

  // Repository/issue/code-review/pipeline/deployment/release fixtures carry
  // no clone URL, credential, diff or source content by construction (see
  // mockProjectsDevelopmentData.js) — there is nothing here to strip for an
  // unauthorized viewer beyond the org-scoping every other endpoint already
  // enforces.
  mock.onGet(/\/admin\/integrations\/projects-development\/development\/repositories$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const repositories = projectsDev.queryRepositoriesLocal({ ...params, organizationId });
    return [200, { repositories }];
  });

  mock.onPost(/\/admin\/integrations\/projects-development\/development\/issues\/from-ticket\/[^/]+$/).reply((config) => {
    const ticketId = config.url.match(/\/from-ticket\/([^/]+)$/)[1];
    const body = JSON.parse(config.data || "{}");
    const result = projectsDev.createDevelopmentIssueFromTicket(ticketId, body, actingActorName());
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), providerKey: body.providerKey, event: "Development issue preview created from Support Ticket", recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/projects-development\/development\/issues$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const issues = projectsDev.queryDevelopmentIssuesLocal({ ...params, organizationId });
    return [200, { issues }];
  });

  mock.onGet(/\/admin\/integrations\/projects-development\/development\/code-reviews$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const reviews = projectsDev.queryCodeReviewsLocal({ ...params, organizationId });
    return [200, { reviews }];
  });

  mock.onGet(/\/admin\/integrations\/projects-development\/development\/pipelines$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const runs = projectsDev.queryPipelineRunsLocal({ ...params, organizationId });
    return [200, { runs }];
  });

  mock.onGet(/\/admin\/integrations\/projects-development\/development\/deployments$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const deployments = projectsDev.queryDeploymentsLocal({ ...params, organizationId });
    return [200, { deployments }];
  });

  mock.onGet(/\/admin\/integrations\/projects-development\/development\/releases$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const releases = projectsDev.queryReleasesLocal({ ...params, organizationId });
    return [200, { releases }];
  });

  mock.onGet(/\/admin\/integrations\/projects-development\/delivery-health$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const indicators = projectsDev.computeDeliveryHealthIndicators(organizationId);
    return [200, { indicators }];
  });

  mock.onPost(/\/admin\/integrations\/projects-development\/conflicts\/[^/]+\/resolve$/).reply((config) => {
    const conflictId = config.url.match(/\/conflicts\/([^/]+)\/resolve$/)[1];
    const { resolution } = JSON.parse(config.data || "{}");
    const result = projectsDev.resolveSyncConflict(conflictId, resolution, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/projects-development\/conflicts$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const conflicts = projectsDev.querySyncConflictsLocal({ ...params, organizationId });
    return [200, { conflicts }];
  });

  // ---- Administration: Commerce and Finance Integrations (Phase 5,
  // frontend-only preview) ----
  // Same frontend-only boundary as the four blocks above — no real provider
  // is ever contacted, no payment is captured/refunded, no payout/transfer
  // is created, no accounting entry is posted, no subscription is modified.
  // Every Phase 5 URL carries the full "/admin/integrations/commerce-
  // finance/..." prefix, checked against every real Orders/Products/
  // Customers/Invoices/Payments route already registered earlier in this
  // file — none of those use a bare, unanchored resource-name regex the way
  // the real Projects/Tasks module's "/projects$"/"/tasks$" handlers did
  // (the exact collision Phase 4 had to work around), so no rename dance is
  // needed here.
  mock.onGet(/\/admin\/integrations\/commerce-finance\/overview-metrics$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const connections = integrations.queryConnectionsLocal(organizationId ? { organizationId } : {});
    const metrics = commerceFinance.computeCommerceFinanceOverviewMetrics({ organizationId, connections });
    return [200, { metrics }];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/stores$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const stores = commerceFinance.queryCommerceStoresLocal({ ...params, organizationId });
    return [200, { stores }];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/stores\/[^/]+\/pause$/).reply((config) => {
    const storeId = config.url.match(/\/stores\/([^/]+)\/pause$/)[1];
    const { paused } = JSON.parse(config.data || "{}");
    const result = commerceFinance.pauseCommerceStore(storeId, paused);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/stores\/[^/]+\/sync$/).reply((config) => {
    const storeId = config.url.match(/\/stores\/([^/]+)\/sync$/)[1];
    const result = commerceFinance.previewCommerceStoreSync(storeId);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/customer-mappings$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const mappings = commerceFinance.queryCommerceCustomerMappingsLocal({ ...params, organizationId });
    return [200, { mappings }];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/product-mappings$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const mappings = commerceFinance.queryCommerceProductMappingsLocal({ ...params, organizationId });
    return [200, { mappings }];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/orders\/[^/]+\/sync$/).reply((config) => {
    const orderId = config.url.match(/\/orders\/([^/]+)\/sync$/)[1];
    const result = commerceFinance.previewCommerceOrderSync(orderId);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/orders$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const orders = commerceFinance.queryCommerceOrdersLocal({ ...params, organizationId });
    return [200, { orders }];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/returns$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const returns = commerceFinance.queryCommerceReturnsLocal({ ...params, organizationId });
    return [200, { returns }];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/payment-transactions$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const transactions = commerceFinance.queryPaymentTransactionsLocal({ ...params, organizationId });
    return [200, { transactions }];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/refunds\/[^/]+\/approve$/).reply((config) => {
    const refundId = config.url.match(/\/refunds\/([^/]+)\/approve$/)[1];
    const { approverName } = JSON.parse(config.data || "{}");
    const result = commerceFinance.approveRefundPreview(refundId, approverName || actingActorName());
    if (result.error) return [403, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Refund preview approved", recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/refunds$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const refunds = commerceFinance.queryRefundPreviewsLocal({ ...params, organizationId });
    return [200, { refunds }];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/disputes$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const disputes = commerceFinance.queryDisputePreviewsLocal({ ...params, organizationId });
    return [200, { disputes }];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/payouts$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const payouts = commerceFinance.queryPayoutReferencesLocal({ ...params, organizationId });
    return [200, { payouts }];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/accounting-mappings\/ledger\/[^/]+\/override$/).reply((config) => {
    const mappingId = config.url.match(/\/ledger\/([^/]+)\/override$/)[1];
    const { newLedgerAccount, requesterName, approverName } = JSON.parse(config.data || "{}");
    const result = commerceFinance.overrideLedgerMapping(mappingId, newLedgerAccount, requesterName, approverName || actingActorName());
    if (result.error) return [403, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Ledger mapping overridden", recordsAffected: 1 });
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/accounting-mappings\/credit-notes\/[^/]+\/approve$/).reply((config) => {
    const creditNoteId = config.url.match(/\/credit-notes\/([^/]+)\/approve$/)[1];
    const { approverName, requestedBy } = JSON.parse(config.data || "{}");
    const result = commerceFinance.approveCreditNotePreview(creditNoteId, approverName || actingActorName(), requestedBy);
    if (result.error) return [403, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Credit note preview approved", recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/accounting-mappings$/).reply((config) => {
    const params = config.params || {};
    return [200, {
      customer: commerceFinance.queryAccountingMappingsLocal("customer", params),
      product: commerceFinance.queryAccountingMappingsLocal("product", params),
      invoice: commerceFinance.queryAccountingMappingsLocal("invoice", params),
      payment: commerceFinance.queryAccountingMappingsLocal("payment", params),
      tax: commerceFinance.queryAccountingMappingsLocal("tax", params),
      ledger: commerceFinance.queryLedgerMappingsLocal(params),
      creditNotes: commerceFinance.queryCreditNoteReferencesLocal(params),
    }];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/conflicts\/[^/]+\/resolve$/).reply((config) => {
    const conflictId = config.url.match(/\/conflicts\/([^/]+)\/resolve$/)[1];
    const { resolution } = JSON.parse(config.data || "{}");
    const result = commerceFinance.resolveFinancialSyncConflict(conflictId, resolution, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/conflicts$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const conflicts = commerceFinance.queryFinancialSyncConflictsLocal({ ...params, organizationId });
    return [200, { conflicts }];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/subscriptions\/[^/]+\/pause$/).reply((config) => {
    const subscriptionId = config.url.match(/\/subscriptions\/([^/]+)\/pause$/)[1];
    const result = commerceFinance.pauseSubscriptionPreview(subscriptionId);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/subscriptions\/[^/]+\/cancel$/).reply((config) => {
    const subscriptionId = config.url.match(/\/subscriptions\/([^/]+)\/cancel$/)[1];
    const { requesterName, approverName } = JSON.parse(config.data || "{}");
    const result = commerceFinance.cancelSubscriptionPreview(subscriptionId, requesterName, approverName || actingActorName());
    if (result.error) return [403, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Subscription preview cancelled", recordsAffected: 1 });
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/subscriptions\/[^/]+\/link-contract$/).reply((config) => {
    const subscriptionId = config.url.match(/\/subscriptions\/([^/]+)\/link-contract$/)[1];
    const { contractId } = JSON.parse(config.data || "{}");
    const result = commerceFinance.linkSubscriptionContract(subscriptionId, contractId);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/subscriptions$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const subscriptions = commerceFinance.querySubscriptionPreviewsLocal({ ...params, organizationId });
    return [200, { subscriptions }];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/bank-accounts$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const accounts = commerceFinance.queryBankAccountsLocal({ ...params, organizationId });
    return [200, { accounts }];
  });

  mock.onGet(/\/admin\/integrations\/commerce-finance\/bank-transactions$/).reply((config) => {
    const params = config.params || {};
    const transactions = commerceFinance.queryBankTransactionsLocal(params);
    return [200, { transactions }];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/reconciliation\/[^/]+\/confirm$/).reply((config) => {
    const bankTransactionId = config.url.match(/\/reconciliation\/([^/]+)\/confirm$/)[1];
    const result = commerceFinance.confirmReconciliationMatch(bankTransactionId, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/reconciliation\/[^/]+\/reject$/).reply((config) => {
    const bankTransactionId = config.url.match(/\/reconciliation\/([^/]+)\/reject$/)[1];
    const result = commerceFinance.rejectReconciliationSuggestion(bankTransactionId);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/reconciliation\/[^/]+\/review-required$/).reply((config) => {
    const bankTransactionId = config.url.match(/\/reconciliation\/([^/]+)\/review-required$/)[1];
    const result = commerceFinance.markReconciliationReviewRequired(bankTransactionId);
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/commerce-finance\/reconciliation\/undo$/).reply(() => {
    const result = commerceFinance.undoLastReconciliationMatch();
    if (result.error) return [400, result];
    return [200, result];
  });

  // ---- Administration: Documents, Storage and Electronic Signature
  // Integrations (Phase 6, frontend-only preview) ----
  // Same frontend-only boundary as the five blocks above — no real provider
  // is ever contacted, no file is uploaded/downloaded/deleted, no real
  // folder or public sharing link is created, no signature request is sent,
  // no signature is applied. Restricted/Financial/Legal/Personal Data/HR
  // Restricted files are excluded from every list/metric for a role that
  // cannot view those classifications — enforced here, mirroring
  // documentsStorageConfig.js's canViewRestrictedClassifications() (small
  // enough, and layered enough differently, that duplicating the one-line
  // check here is clearer than importing a page-layer config file into the
  // mock API layer).
  function canViewRestrictedClassifications() {
    const templateId = actingRoleTemplateId();
    return templateId === "system_owner" || templateId === "legal_manager" || templateId === "finance_manager";
  }
  function scopeFilesForRole(files) {
    return canViewRestrictedClassifications() ? files : files.filter((f) => !documentsStorage.RESTRICTED_CLASSIFICATIONS.includes(f.classification));
  }

  mock.onGet(/\/admin\/integrations\/documents-storage\/overview-metrics$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const connections = integrations.queryConnectionsLocal(organizationId ? { organizationId } : {});
    const metrics = documentsStorage.computeDocumentsStorageOverviewMetrics({ organizationId, connections });
    return [200, { metrics }];
  });

  mock.onGet(/\/admin\/integrations\/documents-storage\/folders$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const folders = documentsStorage.queryExternalFoldersLocal({ ...params, organizationId });
    return [200, { folders }];
  });

  mock.onPost(/\/admin\/integrations\/documents-storage\/files\/[^/]+\/unlink$/).reply((config) => {
    const fileId = config.url.match(/\/files\/([^/]+)\/unlink$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const result = documentsStorage.unlinkExternalFile(fileId, reason);
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "File preview unlinked", details: reason, recordsAffected: 1 });
    return [200, { fileId, removed: result.removed }];
  });

  mock.onGet(/\/admin\/integrations\/documents-storage\/files\/[^/]+\/associations$/).reply((config) => {
    const fileId = config.url.match(/\/files\/([^/]+)\/associations$/)[1];
    const associations = documentsStorage.queryFileAssociationsLocal({ fileId });
    return [200, { associations }];
  });

  mock.onPost(/\/admin\/integrations\/documents-storage\/files\/associations\/undo$/).reply(() => {
    const result = documentsStorage.undoLastAssociation();
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/documents-storage\/files\/[^/]+\/associate$/).reply((config) => {
    const body = JSON.parse(config.data || "{}");
    const result = documentsStorage.associateFilePreview(body, actingActorName());
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "File preview associated to CRM record", recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/documents-storage\/files$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const files = scopeFilesForRole(documentsStorage.queryExternalFilesLocal({ ...params, organizationId }));
    return [200, { files }];
  });

  mock.onGet(/\/admin\/integrations\/documents-storage\/folder-mappings$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const mappings = documentsStorage.queryFolderMappingsLocal({ ...params, organizationId });
    return [200, { mappings }];
  });

  mock.onPost(/\/admin\/integrations\/documents-storage\/conflicts\/[^/]+\/resolve$/).reply((config) => {
    const conflictId = config.url.match(/\/conflicts\/([^/]+)\/resolve$/)[1];
    const { resolution } = JSON.parse(config.data || "{}");
    const result = documentsStorage.resolveDocumentSyncConflict(conflictId, resolution, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/documents-storage\/conflicts$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const conflicts = documentsStorage.queryDocumentSyncConflictsLocal({ ...params, organizationId });
    return [200, { conflicts }];
  });

  mock.onGet(/\/admin\/integrations\/documents-storage\/access-review$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const files = scopeFilesForRole(documentsStorage.queryExternalFilesLocal(organizationId ? { organizationId } : {}));
    const findings = documentsStorage.computeAccessReviewFindings(files);
    return [200, { findings }];
  });

  mock.onGet(/\/admin\/integrations\/documents-storage\/retention-policies$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const policies = documentsStorage.queryRetentionPoliciesLocal({ ...params, organizationId });
    return [200, { policies }];
  });

  mock.onPost(/\/admin\/integrations\/documents-storage\/legal-holds\/[^/]+\/remove$/).reply((config) => {
    const holdId = config.url.match(/\/legal-holds\/([^/]+)\/remove$/)[1];
    const { reason, requesterName, approverName } = JSON.parse(config.data || "{}");
    const result = documentsStorage.removeLegalHold(holdId, { reason, requesterName, approverName: approverName || actingActorName() });
    if (result.error) return [403, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Legal hold removed", details: reason, recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/documents-storage\/legal-holds$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const holds = documentsStorage.queryLegalHoldsLocal({ ...params, organizationId });
    return [200, { holds }];
  });

  mock.onGet(/\/admin\/integrations\/documents-storage\/signature-templates$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const templates = documentsStorage.querySignatureTemplatesLocal({ ...params, organizationId });
    return [200, { templates }];
  });

  mock.onPost(/\/admin\/integrations\/documents-storage\/signatures\/[^/]+\/ready$/).reply((config) => {
    const envelopeId = config.url.match(/\/signatures\/([^/]+)\/ready$/)[1];
    const result = documentsStorage.markSignatureWorkflowReady(envelopeId);
    if (result.error) return [403, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/documents-storage\/signatures\/[^/]+\/send$/).reply((config) => {
    const envelopeId = config.url.match(/\/signatures\/([^/]+)\/send$/)[1];
    const result = documentsStorage.sendSignatureWorkflowPreview(envelopeId, actingActorName());
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Signature Send Preview confirmed", recordsAffected: 1 });
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/documents-storage\/signatures\/[^/]+\/remind$/).reply((config) => {
    const envelopeId = config.url.match(/\/signatures\/([^/]+)\/remind$/)[1];
    const result = documentsStorage.remindSignatureWorkflowPreview(envelopeId, actingActorName());
    if (result.error) return [400, result];
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/documents-storage\/signatures\/[^/]+\/void$/).reply((config) => {
    const envelopeId = config.url.match(/\/signatures\/([^/]+)\/void$/)[1];
    const { reason } = JSON.parse(config.data || "{}");
    const result = documentsStorage.voidSignatureWorkflowPreview(envelopeId, reason, actingActorName());
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Signature workflow voided", details: reason, recordsAffected: 1 });
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/documents-storage\/signatures$/).reply((config) => {
    const body = JSON.parse(config.data || "{}");
    const result = documentsStorage.createSignatureWorkflowPreview(body, actingActorName());
    if (result.error) return [400, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Signature workflow preview created", recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/documents-storage\/signatures$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const envelopes = documentsStorage.querySignatureEnvelopesLocal({ ...params, organizationId });
    return [200, { envelopes }];
  });

  // AI Provider and Intelligence Integrations (Phase 7, final — frontend-
  // only preview). Every URL carries the full "/admin/integrations/ai-
  // providers/..." prefix, distinct from the real "/ai/..." gateway routes
  // below, so neither block can ever intercept the other.
  mock.onGet(/\/admin\/integrations\/ai-providers\/overview-metrics$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const connections = aiProviders.queryProviderConnectionsLocal(organizationId ? { organizationId } : {});
    const metrics = aiProviders.computeAiProviderOverviewMetrics({ organizationId, connections });
    return [200, { metrics }];
  });

  mock.onGet(/\/admin\/integrations\/ai-providers\/connections$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const connections = aiProviders.queryProviderConnectionsLocal({ ...params, organizationId });
    return [200, { connections }];
  });

  mock.onPost(/\/admin\/integrations\/ai-providers\/connections\/[^/]+\/pause$/).reply((config) => {
    const connectionId = config.url.match(/\/connections\/([^/]+)\/pause$/)[1];
    const { paused } = JSON.parse(config.data || "{}");
    const result = aiProviders.pauseProviderConnection(connectionId, paused);
    if (result.error) return [404, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: paused ? "AI provider connection preview paused" : "AI provider connection preview resumed", recordsAffected: 1 });
    return [200, result];
  });

  mock.onPost(/\/admin\/integrations\/ai-providers\/connections$/).reply((config) => {
    const draft = JSON.parse(config.data || "{}");
    const result = aiProviders.createProviderConnectionFromWizard(draft, actingActorName());
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "AI provider connection preview configured", recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/ai-providers\/models$/).reply((config) => {
    const params = config.params || {};
    const models = aiProviders.queryModelAliasesLocal(params);
    return [200, { models }];
  });

  mock.onGet(/\/admin\/integrations\/ai-providers\/use-cases$/).reply((config) => {
    const params = config.params || {};
    const useCases = aiProviders.queryAiUseCasesLocal(params);
    return [200, { useCases }];
  });

  mock.onPost(/\/admin\/integrations\/ai-providers\/routing\/[^/]+$/).reply((config) => {
    const policyId = config.url.match(/\/routing\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");
    const policy = aiProviders.findRoutingPolicy(policyId);
    if (!policy) return [404, { error: "Routing policy not found." }];
    Object.assign(policy, changes);
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "Routing policy preview updated", recordsAffected: 1 });
    return [200, { policy }];
  });

  mock.onGet(/\/admin\/integrations\/ai-providers\/routing$/).reply((config) => {
    const params = config.params || {};
    const policies = aiProviders.queryRoutingPoliciesLocal(params);
    return [200, { policies }];
  });

  mock.onPost(/\/admin\/integrations\/ai-providers\/policies\/[^/]+$/).reply((config) => {
    const policyId = config.url.match(/\/policies\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");
    const result = aiProviders.updateAiPolicy(policyId, changes, actingActorName());
    if (result.error) return [404, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "AI policy preview updated", recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/ai-providers\/policies$/).reply((config) => {
    const params = config.params || {};
    const policies = aiProviders.queryAiPoliciesLocal(params.kind, params);
    return [200, { policies }];
  });

  mock.onGet(/\/admin\/integrations\/ai-providers\/privacy\/redaction$/).reply(() => {
    return [200, { rules: aiProviders.REDACTION_RULES, examples: aiProviders.REDACTION_EXAMPLES }];
  });

  mock.onGet(/\/admin\/integrations\/ai-providers\/privacy\/context-preview$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const preview = aiProviders.buildContextAssemblyPreview(params.useCaseId, organizationId);
    return [200, { preview }];
  });

  mock.onGet(/\/admin\/integrations\/ai-providers\/usage\/budgets$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const budgets = aiProviders.queryBudgetPoliciesLocal({ ...params, organizationId });
    return [200, { budgets }];
  });

  mock.onPost(/\/admin\/integrations\/ai-providers\/usage\/budgets\/[^/]+$/).reply((config) => {
    const budgetId = config.url.match(/\/budgets\/([^/]+)$/)[1];
    const changes = JSON.parse(config.data || "{}");
    const budget = aiProviders.BUDGET_POLICIES.find((b) => b.id === budgetId);
    if (!budget) return [404, { error: "Budget policy not found." }];
    Object.assign(budget, changes);
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "AI budget policy preview updated", recordsAffected: 1 });
    return [200, { budget }];
  });

  mock.onGet(/\/admin\/integrations\/ai-providers\/usage$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const estimates = aiProviders.queryUsageEstimatesLocal({ ...params, organizationId });
    return [200, { estimates }];
  });

  mock.onPost(/\/admin\/integrations\/ai-providers\/evaluations\/[^/]+\/run$/).reply((config) => {
    const scenarioId = config.url.match(/\/evaluations\/([^/]+)\/run$/)[1];
    const result = aiProviders.runEvaluationScenario(scenarioId, actingActorName());
    if (result.error) return [404, result];
    integrations.recordIntegrationAuditEvent({ actor: actingActorName(), organizationId: actingOrganizationId(), event: "AI evaluation scenario preview run", recordsAffected: 1 });
    return [200, result];
  });

  mock.onGet(/\/admin\/integrations\/ai-providers\/evaluations$/).reply((config) => {
    const params = config.params || {};
    const scenarios = aiProviders.queryEvaluationScenariosLocal(params);
    return [200, { scenarios }];
  });

  mock.onGet(/\/admin\/integrations\/ai-providers\/audit$/).reply((config) => {
    const params = config.params || {};
    const organizationId = resolveOrganizationFilter(params.organizationId);
    const events = aiProviders.queryAiAuditEventsLocal({ ...params, organizationId });
    return [200, { events }];
  });

  // AI gateway routes are the one deliberate exception to "everything is
  // mocked": they proxy straight through to the real Express backend (see
  // server/src/routes/aiRoutes.js) since they need a real provider key that
  // only exists server-side. Registration order matters for
  // axios-mock-adapter — this must come before the catch-all below.
  mock.onAny(/\/ai\/(providers|narrative|explore)$/).passThrough();

  // Fallback: anything not explicitly mocked yet gets a harmless empty
  // response instead of a network error, so pages render (usually empty).
  mock.onAny().reply((config) => {
    console.warn(`[mockApi] no handler for ${config.method?.toUpperCase()} ${config.url}`);
    return [200, { success: true, data: [], users: [], message: "Mocked: no handler yet" }];
  });
}
