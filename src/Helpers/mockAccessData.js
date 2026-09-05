// Centralized, typed fixtures + business logic for the Access Management
// frontend preview (Members, Invitations, Invite Links, Access Audit —
// /admin/users, /admin/invitations, /admin/invite-links, /admin/access-audit,
// /invite/:token, /join/:token).
//
// This is a frontend-only preview, same rule as mockRbacData.js: it models
// what a future backend (real Gmail delivery, real token generation, real
// membership persistence) would do, and never claims to have done any of
// that itself. No email is ever sent, no account is ever created, and every
// "token" here is a plain preview string, not a cryptographically secure one.
//
// Deliberately hand-written (not faker-looped) so tests can reference exact
// ids/tokens/statuses — this is fixture *and* the shared source of truth the
// rest of the package reads and writes through, matching the "one shared
// frontend store, never separate conflicting fixture arrays" requirement.
import { getRoleLabel } from "../utils/roleLabels";
import { findRoleTemplate } from "./mockRbacData";

// ---------------------------------------------------------------------------
// Organizations — greenfield: nothing in this codebase modeled multi-tenancy
// before this package. "Company" already means "external customer account"
// elsewhere, so organizations are a distinct, new concept.
// ---------------------------------------------------------------------------
export const ORGANIZATIONS = [
  { id: "org_caspira_hq", name: "Caspira HQ", domain: "caspira.example", status: "Active" },
  { id: "org_nimbus_retail", name: "Nimbus Retail Group", domain: "nimbusretail.example", status: "Active" },
  { id: "org_solstice_partners", name: "Solstice Partners", domain: "solsticepartners.example", status: "Active" },
];
export const DEFAULT_ORGANIZATION_ID = "org_caspira_hq";

export function findOrganization(organizationId) {
  return ORGANIZATIONS.find((o) => o.id === organizationId) || null;
}

// Departments reuse the RBAC package's existing 5 — already the superset
// used by RolesList.jsx's own local CRM_DEPARTMENTS copy.
export const DEPARTMENTS = ["Sales", "Support", "Marketing", "Finance", "HR"];

// Teams — no canonical, id-based team fixture existed anywhere in the app
// before this (CRM_TEAMS/COMPANY_TEAMS are plain, mismatched string arrays).
export const TEAMS = [
  { id: "team_sales_west", name: "Sales — West", organizationId: "org_caspira_hq", department: "Sales" },
  { id: "team_sales_east", name: "Sales — East", organizationId: "org_caspira_hq", department: "Sales" },
  { id: "team_support_core", name: "Support — Core", organizationId: "org_caspira_hq", department: "Support" },
  { id: "team_marketing_growth", name: "Marketing — Growth", organizationId: "org_caspira_hq", department: "Marketing" },
  { id: "team_nimbus_sales", name: "Nimbus Sales", organizationId: "org_nimbus_retail", department: "Sales" },
  { id: "team_nimbus_support", name: "Nimbus Support", organizationId: "org_nimbus_retail", department: "Support" },
  { id: "team_solstice_ops", name: "Solstice Operations", organizationId: "org_solstice_partners", department: "Support" },
];

export function findTeam(teamId) {
  return TEAMS.find((t) => t.id === teamId) || null;
}

export function teamsForOrganization(organizationId) {
  return TEAMS.filter((t) => t.organizationId === organizationId);
}

// ---------------------------------------------------------------------------
// Status enums (spec's final, authoritative list)
// ---------------------------------------------------------------------------
export const MEMBERSHIP_STATUSES = ["Invited", "Approval Pending", "Active", "Suspended", "Deactivated", "Removed"];

export const INVITATION_STATUSES = [
  "Draft", "Pending", "Email Preview Generated", "Opened Preview", "Approval Required",
  "Accepted Preview", "Declined Preview", "Expired", "Revoked", "Failed Preview",
];

export const INVITE_LINK_STATUSES = ["Draft", "Active Preview", "Expiring Soon", "Usage Limit Reached", "Expired", "Revoked"];

// ---------------------------------------------------------------------------
// High-privilege role rules — the roles a reusable link may never grant, and
// that Organization Administrator may never assign to anyone. Kept here
// (not only in accessManagementConfig.js) since fixtures below validate
// against it directly (e.g. every seeded invite link's defaultRole).
// ---------------------------------------------------------------------------
export const HIGH_PRIVILEGE_ROLE_IDS = [
  "system_owner", "organization_administrator", "crm_administrator",
  "finance_manager", "hr_manager", "auditor_checker", "approver",
];
export const LINK_SAFE_ROLE_IDS = [
  "standard_employee", "sales_representative", "marketing_specialist",
  "support_agent", "project_member", "read_only_viewer",
];

export function isHighPrivilegeRoleId(roleTemplateId) {
  return HIGH_PRIVILEGE_ROLE_IDS.includes(roleTemplateId);
}
export function isRoleAssignableViaLink(roleTemplateId) {
  return LINK_SAFE_ROLE_IDS.includes(roleTemplateId);
}

function roleLabel(roleTemplateId) {
  return findRoleTemplate(roleTemplateId)?.name || roleTemplateId;
}

// ---------------------------------------------------------------------------
// Typed factories — "provider-ready frontend contracts". Every field the
// spec lists is present, defaulted to null/false/[] rather than omitted, so
// every consumer can rely on the shape without optional-chaining everywhere.
// ---------------------------------------------------------------------------
export function createOrganizationMember({
  id, userId = id, name, email, avatarUrl = null, organizationId, roleIds = [],
  departmentId = null, teamId = null, managerId = null, status = "Active",
  invitationSource = "Direct", joinedDate = null, lastActive = null, invitedBy = null,
  twoFactorStatus = "Not Enabled", accessScope = "Organization",
  createdAt = new Date().toISOString(), updatedAt = new Date().toISOString(),
}) {
  return {
    id, userId, name, email, avatarUrl, organizationId, roleIds, departmentId, teamId, managerId,
    status, invitationSource, joinedDate, lastActive, invitedBy, twoFactorStatus, accessScope,
    createdAt, updatedAt,
  };
}

export function createMemberInvitation({
  id, email, organizationId, intendedRoleId, department = null, team = null, manager = null,
  invitedBy, personalMessage = "", deliveryMethod = "Email", createdDate = new Date().toISOString(),
  sentDate = null, openedDate = null, expirationDate, acceptedDate = null, revokedDate = null,
  status = "Draft", frontendToken = null, resendCount = 0, failureReason = null, approvalRequired = false,
}) {
  return {
    id, email, organizationId, intendedRoleId, department, team, manager, invitedBy, personalMessage,
    deliveryMethod, createdDate, sentDate, openedDate, expirationDate, acceptedDate, revokedDate,
    status, frontendToken, resendCount, failureReason, approvalRequired,
  };
}

export function createOrganizationInviteLink({
  id, name, organizationId, secureTokenPreview, defaultRoleId, department = null, team = null,
  manager = null, allowedEmailDomains = [], approvalRequired = true, expirationDate,
  maxUses = 25, currentUses = 0, createdBy, createdDate = new Date().toISOString(),
  lastUsed = null, rotatedDate = null, revokedDate = null, status = "Active Preview",
  revocationReason = null,
}) {
  return {
    id, name, organizationId, secureTokenPreview, defaultRoleId, department, team, manager,
    allowedEmailDomains, approvalRequired, expirationDate, maxUses, currentUses, createdBy,
    createdDate, lastUsed, rotatedDate, revokedDate, status, revocationReason,
  };
}

export function createAccessAuditEvent({
  id, occurredAt = new Date().toISOString(), actor, organizationId, event, targetLabel = null,
  previousValue = null, newValue = null, reason = null, source = "Access Management", status = "Success",
}) {
  return { id, occurredAt, actor, organizationId, event, targetLabel, previousValue, newValue, reason, source, status };
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
// Expiration/usage logic below compares against the real system clock, so
// every date that needs to still read as "live" (or deliberately "expired")
// is computed relative to whenever the app actually runs, never a fixed
// literal that would quietly go stale.
const DAY_MS = 24 * 60 * 60 * 1000;
function daysFromNow(n) {
  return new Date(Date.now() + n * DAY_MS).toISOString();
}
function daysAgo(n) {
  return daysFromNow(-n);
}

let auditSeq = 1;
export const ACCESS_AUDIT_EVENTS = [];

function seedAudit(fields) {
  const event = createAccessAuditEvent({ id: `audit_${auditSeq++}`, ...fields });
  ACCESS_AUDIT_EVENTS.push(event);
  return event;
}

export const MEMBERS = [
  createOrganizationMember({
    id: "member_1", name: "Amara Okafor", email: "amara.okafor@caspira.example",
    organizationId: "org_caspira_hq", roleIds: ["system_owner"], departmentId: null, teamId: null,
    status: "Active", invitationSource: "Direct", joinedDate: "2024-01-10T09:00:00.000Z",
    lastActive: "2026-09-02T08:15:00.000Z", invitedBy: null, twoFactorStatus: "Enabled", accessScope: "System-wide",
  }),
  createOrganizationMember({
    id: "member_2", name: "Priya Nair", email: "priya.nair@caspira.example",
    organizationId: "org_caspira_hq", roleIds: ["organization_administrator"], departmentId: "Sales", teamId: "team_sales_west",
    managerId: "member_1", status: "Active", invitationSource: "Direct", joinedDate: "2024-02-14T09:00:00.000Z",
    lastActive: "2026-09-01T17:40:00.000Z", invitedBy: "member_1", twoFactorStatus: "Enabled", accessScope: "Organization",
  }),
  createOrganizationMember({
    id: "member_3", name: "Marcus Chen", email: "marcus.chen@caspira.example",
    organizationId: "org_caspira_hq", roleIds: ["sales_representative"], departmentId: "Sales", teamId: "team_sales_west",
    managerId: "member_2", status: "Active", invitationSource: "Email Invitation", joinedDate: "2024-05-02T09:00:00.000Z",
    lastActive: "2026-08-30T12:05:00.000Z", invitedBy: "member_2", twoFactorStatus: "Enabled", accessScope: "Team",
  }),
  createOrganizationMember({
    id: "member_4", name: "Fatima Al-Sayed", email: "fatima.alsayed@caspira.example",
    organizationId: "org_caspira_hq", roleIds: ["sales_representative"], departmentId: "Sales", teamId: "team_sales_east",
    managerId: "member_2", status: "Active", invitationSource: "Invite Link", joinedDate: "2025-01-20T09:00:00.000Z",
    lastActive: "2026-08-28T09:20:00.000Z", invitedBy: "member_2", twoFactorStatus: "Not Enabled", accessScope: "Team",
  }),
  createOrganizationMember({
    id: "member_5", name: "Liam O'Connor", email: "liam.oconnor@caspira.example",
    organizationId: "org_caspira_hq", roleIds: ["support_agent"], departmentId: "Support", teamId: "team_support_core",
    managerId: "member_2", status: "Active", invitationSource: "Email Invitation", joinedDate: "2025-03-11T09:00:00.000Z",
    lastActive: "2026-09-01T14:00:00.000Z", invitedBy: "member_2", twoFactorStatus: "Enabled", accessScope: "Team",
  }),
  createOrganizationMember({
    id: "member_6", name: "Grace Kim", email: "grace.kim@caspira.example",
    organizationId: "org_caspira_hq", roleIds: ["marketing_specialist"], departmentId: "Marketing", teamId: "team_marketing_growth",
    managerId: "member_2", status: "Active", invitationSource: "Invite Link", joinedDate: "2025-06-09T09:00:00.000Z",
    lastActive: "2026-07-15T10:00:00.000Z", invitedBy: "member_2", twoFactorStatus: "Not Enabled", accessScope: "Team",
  }),
  createOrganizationMember({
    id: "member_7", name: "Dominic Wuckert", email: "dominic.wuckert@caspira.example",
    organizationId: "org_caspira_hq", roleIds: ["finance_manager"], departmentId: "Finance", teamId: null,
    managerId: "member_2", status: "Active", invitationSource: "Direct", joinedDate: "2024-03-01T09:00:00.000Z",
    lastActive: "2026-08-20T11:30:00.000Z", invitedBy: "member_1", twoFactorStatus: "Enabled", accessScope: "Organization",
  }),
  createOrganizationMember({
    id: "member_8", name: "Noor Haddad", email: "noor.haddad@caspira.example",
    organizationId: "org_caspira_hq", roleIds: ["auditor_checker"], departmentId: null, teamId: null,
    managerId: "member_1", status: "Active", invitationSource: "Direct", joinedDate: "2024-04-18T09:00:00.000Z",
    lastActive: "2026-08-25T08:00:00.000Z", invitedBy: "member_1", twoFactorStatus: "Enabled", accessScope: "System-wide",
  }),
  createOrganizationMember({
    id: "member_9", name: "Tobias Reyes", email: "tobias.reyes@caspira.example",
    organizationId: "org_caspira_hq", roleIds: ["standard_employee"], departmentId: "Support", teamId: "team_support_core",
    managerId: "member_5", status: "Suspended", invitationSource: "Email Invitation", joinedDate: "2025-08-04T09:00:00.000Z",
    lastActive: "2026-06-10T09:00:00.000Z", invitedBy: "member_5", twoFactorStatus: "Not Enabled", accessScope: "Own",
  }),
  createOrganizationMember({
    id: "member_10", name: "Elena Petrova", email: "elena.petrova@caspira.example",
    organizationId: "org_caspira_hq", roleIds: ["standard_employee"], departmentId: null, teamId: null,
    managerId: "member_2", status: "Active", invitationSource: "Invite Link", joinedDate: "2026-08-01T09:00:00.000Z",
    lastActive: "2026-08-30T09:00:00.000Z", invitedBy: "member_2", twoFactorStatus: "Not Enabled", accessScope: "Own",
  }),
  createOrganizationMember({
    id: "member_11", name: "Jonah Fields", email: "jonah.fields@nimbusretail.example",
    organizationId: "org_nimbus_retail", roleIds: ["organization_administrator"], departmentId: "Sales", teamId: "team_nimbus_sales",
    managerId: "member_1", status: "Active", invitationSource: "Direct", joinedDate: "2024-06-15T09:00:00.000Z",
    lastActive: "2026-09-01T09:00:00.000Z", invitedBy: "member_1", twoFactorStatus: "Enabled", accessScope: "Organization",
  }),
  createOrganizationMember({
    id: "member_12", name: "Sofia Marchetti", email: "sofia.marchetti@nimbusretail.example",
    organizationId: "org_nimbus_retail", roleIds: ["sales_representative"], departmentId: "Sales", teamId: "team_nimbus_sales",
    managerId: "member_11", status: "Active", invitationSource: "Email Invitation", joinedDate: "2025-02-01T09:00:00.000Z",
    lastActive: "2026-08-29T09:00:00.000Z", invitedBy: "member_11", twoFactorStatus: "Enabled", accessScope: "Team",
  }),
  createOrganizationMember({
    id: "member_13", name: "Ravi Subramaniam", email: "ravi.subramaniam@nimbusretail.example",
    organizationId: "org_nimbus_retail", roleIds: ["support_agent"], departmentId: "Support", teamId: "team_nimbus_support",
    managerId: "member_11", status: "Deactivated", invitationSource: "Invite Link", joinedDate: "2025-05-19T09:00:00.000Z",
    lastActive: "2026-04-02T09:00:00.000Z", invitedBy: "member_11", twoFactorStatus: "Not Enabled", accessScope: "Team",
  }),
  createOrganizationMember({
    id: "member_14", name: "Helena Backstrom", email: "helena.backstrom@solsticepartners.example",
    organizationId: "org_solstice_partners", roleIds: ["organization_administrator"], departmentId: null, teamId: null,
    managerId: "member_1", status: "Active", invitationSource: "Direct", joinedDate: "2024-09-09T09:00:00.000Z",
    lastActive: "2026-08-31T09:00:00.000Z", invitedBy: "member_1", twoFactorStatus: "Enabled", accessScope: "Organization",
  }),
  createOrganizationMember({
    id: "member_15", name: "Yusuf Demir", email: "yusuf.demir@solsticepartners.example",
    organizationId: "org_solstice_partners", roleIds: ["read_only_viewer"], departmentId: "Support", teamId: "team_solstice_ops",
    managerId: "member_14", status: "Active", invitationSource: "Invite Link", joinedDate: "2026-07-20T09:00:00.000Z",
    lastActive: "2026-08-27T09:00:00.000Z", invitedBy: "member_14", twoFactorStatus: "Not Enabled", accessScope: "Own",
  }),
];

export const INVITATIONS = [
  createMemberInvitation({
    id: "invite_1", email: "new.hire@caspira.example", organizationId: "org_caspira_hq",
    intendedRoleId: "sales_representative", department: "Sales", team: "team_sales_west", manager: "member_2",
    invitedBy: "member_2", personalMessage: "Welcome aboard — excited to have you on the West team!",
    createdDate: daysAgo(2), sentDate: daysAgo(2),
    expirationDate: daysFromNow(5), status: "Pending",
    frontendToken: "preview_tok_inv1", resendCount: 0, approvalRequired: false,
  }),
  createMemberInvitation({
    id: "invite_2", email: "opened.preview@caspira.example", organizationId: "org_caspira_hq",
    intendedRoleId: "support_agent", department: "Support", team: "team_support_core", manager: "member_5",
    invitedBy: "member_5", personalMessage: "", createdDate: daysAgo(4),
    sentDate: daysAgo(4), openedDate: daysAgo(3),
    expirationDate: daysFromNow(3), status: "Opened Preview",
    frontendToken: "preview_tok_inv2", resendCount: 0, approvalRequired: false,
  }),
  createMemberInvitation({
    id: "invite_3", email: "pending.approval@caspira.example", organizationId: "org_caspira_hq",
    intendedRoleId: "marketing_specialist", department: "Marketing", team: "team_marketing_growth", manager: "member_2",
    invitedBy: "member_2", personalMessage: "", createdDate: daysAgo(3),
    sentDate: daysAgo(3), openedDate: daysAgo(3),
    expirationDate: daysFromNow(4), status: "Approval Required",
    frontendToken: "preview_tok_inv3", resendCount: 0, approvalRequired: true,
  }),
  createMemberInvitation({
    id: "invite_4", email: "accepted.preview@caspira.example", organizationId: "org_caspira_hq",
    intendedRoleId: "standard_employee", department: null, team: null, manager: "member_2",
    invitedBy: "member_2", personalMessage: "", createdDate: daysAgo(20),
    sentDate: daysAgo(20), openedDate: daysAgo(19),
    acceptedDate: daysAgo(19), expirationDate: daysAgo(13),
    status: "Accepted Preview", frontendToken: "preview_tok_inv4", resendCount: 0, approvalRequired: false,
  }),
  createMemberInvitation({
    id: "invite_5", email: "declined.preview@caspira.example", organizationId: "org_caspira_hq",
    intendedRoleId: "standard_employee", department: null, team: null, manager: "member_2",
    invitedBy: "member_2", personalMessage: "", createdDate: daysAgo(30),
    sentDate: daysAgo(30), openedDate: daysAgo(29),
    expirationDate: daysAgo(23), status: "Declined Preview",
    frontendToken: "preview_tok_inv5", resendCount: 0, approvalRequired: false,
  }),
  createMemberInvitation({
    id: "invite_6", email: "expired.person@caspira.example", organizationId: "org_caspira_hq",
    intendedRoleId: "support_agent", department: "Support", team: "team_support_core", manager: "member_5",
    invitedBy: "member_5", personalMessage: "", createdDate: daysAgo(60),
    sentDate: daysAgo(60), expirationDate: daysAgo(53),
    status: "Expired", frontendToken: "preview_tok_inv6", resendCount: 1, approvalRequired: false,
  }),
  createMemberInvitation({
    id: "invite_7", email: "revoked.person@caspira.example", organizationId: "org_caspira_hq",
    intendedRoleId: "sales_representative", department: "Sales", team: "team_sales_east", manager: "member_2",
    invitedBy: "member_2", personalMessage: "", createdDate: daysAgo(45),
    sentDate: daysAgo(45), revokedDate: daysAgo(42),
    expirationDate: daysAgo(38), status: "Revoked",
    frontendToken: "preview_tok_inv7", resendCount: 0, approvalRequired: false,
  }),
  createMemberInvitation({
    id: "invite_8", email: "delivery.failed@caspira.example", organizationId: "org_caspira_hq",
    intendedRoleId: "standard_employee", department: null, team: null, manager: "member_2",
    invitedBy: "member_2", personalMessage: "", createdDate: daysAgo(3),
    expirationDate: daysFromNow(4), status: "Failed Preview",
    frontendToken: "preview_tok_inv8", resendCount: 0, approvalRequired: false,
    failureReason: "Preview delivery simulation: invalid mailbox format detected.",
  }),
  createMemberInvitation({
    id: "invite_9", email: "expiring.soon@caspira.example", organizationId: "org_caspira_hq",
    intendedRoleId: "sales_representative", department: "Sales", team: "team_sales_west", manager: "member_2",
    invitedBy: "member_2", personalMessage: "", createdDate: daysAgo(1),
    sentDate: daysAgo(1), expirationDate: daysFromNow(1),
    status: "Pending", frontendToken: "preview_tok_inv9", resendCount: 0, approvalRequired: false,
  }),
  createMemberInvitation({
    id: "invite_10", email: "new.admin.candidate@nimbusretail.example", organizationId: "org_nimbus_retail",
    intendedRoleId: "organization_administrator", department: null, team: null, manager: null,
    invitedBy: "member_1", personalMessage: "Direct invitation reviewed and approved by System Owner.",
    createdDate: daysAgo(5), sentDate: daysAgo(5),
    expirationDate: daysFromNow(2), status: "Pending",
    frontendToken: "preview_tok_inv10", resendCount: 0, approvalRequired: false,
  }),
];

export const INVITE_LINKS = [
  createOrganizationInviteLink({
    id: "link_1", name: "Sales onboarding", organizationId: "org_caspira_hq",
    secureTokenPreview: "preview_link_sales_west", defaultRoleId: "sales_representative",
    department: "Sales", team: "team_sales_west", manager: "member_2",
    allowedEmailDomains: ["caspira.example"], approvalRequired: true,
    expirationDate: daysFromNow(90), maxUses: 25, currentUses: 6,
    createdBy: "member_2", createdDate: daysAgo(60),
    lastUsed: daysAgo(3), status: "Active Preview",
  }),
  createOrganizationInviteLink({
    id: "link_2", name: "Support agent onboarding", organizationId: "org_caspira_hq",
    secureTokenPreview: "preview_link_support_core", defaultRoleId: "support_agent",
    department: "Support", team: "team_support_core", manager: "member_5",
    allowedEmailDomains: ["caspira.example"], approvalRequired: false,
    expirationDate: daysFromNow(2), maxUses: 15, currentUses: 12,
    createdBy: "member_5", createdDate: daysAgo(45),
    lastUsed: daysAgo(2), status: "Expiring Soon",
  }),
  createOrganizationInviteLink({
    id: "link_3", name: "General standard employee", organizationId: "org_caspira_hq",
    secureTokenPreview: "preview_link_general", defaultRoleId: "standard_employee",
    department: null, team: null, manager: "member_2",
    allowedEmailDomains: [], approvalRequired: true,
    expirationDate: daysFromNow(120), maxUses: 10, currentUses: 10,
    createdBy: "member_2", createdDate: daysAgo(90),
    lastUsed: daysAgo(10), status: "Usage Limit Reached",
  }),
  createOrganizationInviteLink({
    id: "link_4", name: "Marketing contractors (retired)", organizationId: "org_caspira_hq",
    secureTokenPreview: "preview_link_marketing_old", defaultRoleId: "marketing_specialist",
    department: "Marketing", team: "team_marketing_growth", manager: "member_2",
    allowedEmailDomains: ["caspira.example"], approvalRequired: true,
    expirationDate: daysAgo(50), maxUses: 5, currentUses: 3,
    createdBy: "member_2", createdDate: daysAgo(150),
    lastUsed: daysAgo(60), revokedDate: daysAgo(55),
    status: "Revoked", revocationReason: "Campaign ended; replaced by link_1 scope expansion.",
  }),
  createOrganizationInviteLink({
    id: "link_5", name: "Nimbus sales onboarding", organizationId: "org_nimbus_retail",
    secureTokenPreview: "preview_link_nimbus_sales", defaultRoleId: "sales_representative",
    department: "Sales", team: "team_nimbus_sales", manager: "member_11",
    allowedEmailDomains: ["nimbusretail.example"], approvalRequired: true,
    expirationDate: daysFromNow(60), maxUses: 20, currentUses: 4,
    createdBy: "member_11", createdDate: "2026-06-15T09:00:00.000Z",
    lastUsed: "2026-08-20T09:00:00.000Z", status: "Active Preview",
  }),
];

// Seed the audit trail from the seeded invitations/links above so the
// timeline reads coherently rather than as disconnected filler.
seedAudit({ occurredAt: "2026-08-25T10:00:00.000Z", actor: "Priya Nair", organizationId: "org_caspira_hq", event: "Invitation created", targetLabel: "new.hire@caspira.example", newValue: roleLabel("sales_representative") });
seedAudit({ occurredAt: "2026-08-25T10:00:05.000Z", actor: "Priya Nair", organizationId: "org_caspira_hq", event: "Email preview generated", targetLabel: "new.hire@caspira.example" });
seedAudit({ occurredAt: "2026-08-20T10:00:00.000Z", actor: "Liam O'Connor", organizationId: "org_caspira_hq", event: "Invitation created", targetLabel: "opened.preview@caspira.example", newValue: roleLabel("support_agent") });
seedAudit({ occurredAt: "2026-08-21T08:12:00.000Z", actor: "opened.preview@caspira.example", organizationId: "org_caspira_hq", event: "Invitation preview opened", targetLabel: "opened.preview@caspira.example" });
seedAudit({ occurredAt: "2026-08-22T15:00:00.000Z", actor: "pending.approval@caspira.example", organizationId: "org_caspira_hq", event: "Approval requested", targetLabel: "pending.approval@caspira.example" });
seedAudit({ occurredAt: "2026-07-29T09:05:00.000Z", actor: "accepted.preview@caspira.example", organizationId: "org_caspira_hq", event: "Membership accepted (preview)", targetLabel: "accepted.preview@caspira.example", newValue: roleLabel("standard_employee") });
seedAudit({ occurredAt: "2026-05-18T10:00:00.000Z", actor: "Priya Nair", organizationId: "org_caspira_hq", event: "Invitation revoked", targetLabel: "revoked.person@caspira.example", reason: "Role need was cancelled." });
seedAudit({ occurredAt: "2026-06-01T09:00:00.000Z", actor: "Priya Nair", organizationId: "org_caspira_hq", event: "Invite link created", targetLabel: "Sales onboarding" });
seedAudit({ occurredAt: "2026-08-28T09:00:00.000Z", actor: "fatima.alsayed@caspira.example", organizationId: "org_caspira_hq", event: "Invite link used", targetLabel: "Sales onboarding" });
seedAudit({ occurredAt: "2026-06-20T09:00:00.000Z", actor: "Priya Nair", organizationId: "org_caspira_hq", event: "Invite link revoked", targetLabel: "Marketing contractors (retired)", reason: "Campaign ended; replaced by link_1 scope expansion." });
seedAudit({ occurredAt: "2026-06-10T08:00:00.000Z", actor: "Priya Nair", organizationId: "org_caspira_hq", event: "Member suspended", targetLabel: "Tobias Reyes", previousValue: "Active", newValue: "Suspended", reason: "Repeated policy violations under review." });
seedAudit({ occurredAt: "2024-01-10T09:00:00.000Z", actor: "System", organizationId: "org_caspira_hq", event: "Member role changed", targetLabel: "Amara Okafor", previousValue: null, newValue: roleLabel("system_owner") });
seedAudit({ occurredAt: "2026-08-15T10:00:00.000Z", actor: "Amara Okafor", organizationId: "org_nimbus_retail", event: "Invitation created", targetLabel: "new.admin.candidate@nimbusretail.example", newValue: roleLabel("organization_administrator"), status: "High-Privilege" });
seedAudit({ occurredAt: "2026-04-02T09:00:00.000Z", actor: "Jonah Fields", organizationId: "org_nimbus_retail", event: "Member removed", targetLabel: "Ravi Subramaniam", reason: "Left the organization." });
seedAudit({ occurredAt: "2026-06-15T09:00:00.000Z", actor: "Jonah Fields", organizationId: "org_nimbus_retail", event: "Invite link created", targetLabel: "Nimbus sales onboarding" });

// ---------------------------------------------------------------------------
// Query / mutate helpers — the "local" layer mockApi.js handlers call into,
// same convention as mockRbacData.js's queryRolesLocal/createCustomRole/etc.
// ---------------------------------------------------------------------------
function nowIso() {
  return new Date().toISOString();
}

function nextId(prefix, list) {
  return `${prefix}_${list.length + 1}_${Date.now().toString(36)}`;
}

export function findMember(memberId) {
  return MEMBERS.find((m) => m.id === memberId) || null;
}

export function membersForOrganization(organizationId) {
  return MEMBERS.filter((m) => m.organizationId === organizationId);
}

export function queryMembersLocal(filters = {}) {
  return MEMBERS.filter((m) => {
    if (filters.organizationId && m.organizationId !== filters.organizationId) return false;
    if (filters.roleId && !m.roleIds.includes(filters.roleId)) return false;
    if (filters.department && m.departmentId !== filters.department) return false;
    if (filters.team && m.teamId !== filters.team) return false;
    if (filters.manager && m.managerId !== filters.manager) return false;
    if (filters.status && m.status !== filters.status) return false;
    if (filters.twoFactorStatus && m.twoFactorStatus !== filters.twoFactorStatus) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!m.name.toLowerCase().includes(q) && !m.email.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

export function queryInvitationsLocal(filters = {}) {
  return INVITATIONS.filter((i) => {
    if (filters.organizationId && i.organizationId !== filters.organizationId) return false;
    if (filters.intendedRoleId && i.intendedRoleId !== filters.intendedRoleId) return false;
    if (filters.status && i.status !== filters.status) return false;
    if (filters.invitedBy && i.invitedBy !== filters.invitedBy) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!i.email.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

export function queryInviteLinksLocal(filters = {}) {
  return INVITE_LINKS.filter((l) => {
    if (filters.organizationId && l.organizationId !== filters.organizationId) return false;
    if (filters.status && l.status !== filters.status) return false;
    return true;
  });
}

export function queryAccessAuditLocal(filters = {}) {
  return ACCESS_AUDIT_EVENTS.filter((e) => {
    if (filters.organizationId && e.organizationId !== filters.organizationId) return false;
    if (filters.event && e.event !== filters.event) return false;
    return true;
  }).slice().sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
}

export function recordAuditEvent(fields) {
  return seedAudit(fields);
}

function findExistingMemberByEmail(email, organizationId) {
  return MEMBERS.find((m) => m.email.toLowerCase() === email.toLowerCase() && m.organizationId === organizationId) || null;
}

function findActiveInvitationByEmail(email, organizationId) {
  return INVITATIONS.find(
    (i) => i.email.toLowerCase() === email.toLowerCase() && i.organizationId === organizationId &&
      ["Draft", "Pending", "Email Preview Generated", "Opened Preview", "Approval Required"].includes(i.status)
  ) || null;
}

// Validates a candidate recipient before an invitation is ever created —
// mirrors the "do not allow the user to proceed silently" requirement.
export function validateInvitationRecipient(email, organizationId) {
  const existingMember = findExistingMemberByEmail(email, organizationId);
  if (existingMember) return { valid: false, reason: "already_member", message: "This email already belongs to an active member of this organization." };
  const existingInvitation = findActiveInvitationByEmail(email, organizationId);
  if (existingInvitation) return { valid: false, reason: "pending_invitation", message: "This email already has a pending invitation to this organization." };
  const revoked = INVITATIONS.find((i) => i.email.toLowerCase() === email.toLowerCase() && i.organizationId === organizationId && i.status === "Revoked");
  if (revoked) return { valid: true, warning: "previously_revoked", message: "A previous invitation to this email was revoked. A new invitation can still be sent." };
  return { valid: true };
}

export function createInvitation(payload) {
  const invitation = createMemberInvitation({
    id: nextId("invite", INVITATIONS),
    frontendToken: `preview_tok_${nextId("gen", INVITATIONS)}`,
    createdDate: nowIso(),
    sentDate: nowIso(),
    status: payload.approvalRequired ? "Approval Required" : "Pending",
    ...payload,
  });
  INVITATIONS.push(invitation);
  recordAuditEvent({
    actor: payload.invitedByName || payload.invitedBy, organizationId: invitation.organizationId,
    event: "Invitation created", targetLabel: invitation.email, newValue: roleLabel(invitation.intendedRoleId),
  });
  recordAuditEvent({
    actor: payload.invitedByName || payload.invitedBy, organizationId: invitation.organizationId,
    event: "Email preview generated", targetLabel: invitation.email,
  });
  return invitation;
}

export function resendInvitation(invitationId, actorName) {
  const invitation = INVITATIONS.find((i) => i.id === invitationId);
  if (!invitation) return { error: "Invitation not found" };
  if (["Accepted Preview", "Declined Preview", "Revoked"].includes(invitation.status)) {
    return { error: `Cannot resend an invitation in "${invitation.status}" status.` };
  }
  const previousToken = invitation.frontendToken;
  invitation.frontendToken = `preview_tok_${nextId("resend", INVITATIONS)}`;
  invitation.resendCount += 1;
  invitation.sentDate = nowIso();
  invitation.status = invitation.approvalRequired ? "Approval Required" : "Pending";
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7);
  invitation.expirationDate = expiry.toISOString();
  recordAuditEvent({
    actor: actorName, organizationId: invitation.organizationId, event: "Invitation resent",
    targetLabel: invitation.email, previousValue: previousToken, newValue: invitation.frontendToken,
  });
  return { invitation, previousToken };
}

export function revokeInvitation(invitationId, reason, actorName) {
  if (!reason?.trim()) return { error: "A reason is required to revoke an invitation." };
  const invitation = INVITATIONS.find((i) => i.id === invitationId);
  if (!invitation) return { error: "Invitation not found" };
  invitation.status = "Revoked";
  invitation.revokedDate = nowIso();
  recordAuditEvent({ actor: actorName, organizationId: invitation.organizationId, event: "Invitation revoked", targetLabel: invitation.email, reason });
  return { invitation };
}

export function findInvitationByToken(token) {
  return INVITATIONS.find((i) => i.frontendToken === token) || null;
}

export function findInviteLinkByToken(token) {
  return INVITE_LINKS.find((l) => l.secureTokenPreview === token) || null;
}

export function createInviteLink(payload) {
  if (isHighPrivilegeRoleId(payload.defaultRoleId)) {
    return { error: "High-privilege roles cannot be assigned through a reusable invite link." };
  }
  const link = createOrganizationInviteLink({
    id: nextId("link", INVITE_LINKS),
    secureTokenPreview: `preview_link_${nextId("gen", INVITE_LINKS)}`,
    createdDate: nowIso(),
    status: "Active Preview",
    ...payload,
  });
  INVITE_LINKS.push(link);
  recordAuditEvent({ actor: payload.createdByName || payload.createdBy, organizationId: link.organizationId, event: "Invite link created", targetLabel: link.name });
  return { link };
}

export function rotateInviteLink(linkId, actorName) {
  const link = INVITE_LINKS.find((l) => l.id === linkId);
  if (!link) return { error: "Invite link not found" };
  const previousToken = link.secureTokenPreview;
  link.secureTokenPreview = `preview_link_${nextId("rot", INVITE_LINKS)}`;
  link.rotatedDate = nowIso();
  link.currentUses = 0;
  if (link.status !== "Revoked") link.status = "Active Preview";
  recordAuditEvent({
    actor: actorName, organizationId: link.organizationId, event: "Invite link rotated",
    targetLabel: link.name, previousValue: previousToken, newValue: link.secureTokenPreview,
  });
  return { link, previousToken };
}

export function revokeInviteLink(linkId, reason, actorName) {
  if (!reason?.trim()) return { error: "A reason is required to revoke an invite link." };
  const link = INVITE_LINKS.find((l) => l.id === linkId);
  if (!link) return { error: "Invite link not found" };
  link.status = "Revoked";
  link.revokedDate = nowIso();
  link.revocationReason = reason;
  recordAuditEvent({ actor: actorName, organizationId: link.organizationId, event: "Invite link revoked", targetLabel: link.name, reason });
  return { link };
}

// Accepting either kind of invitation is still a *preview* — it updates the
// shared fixture state (so the Members directory reflects it immediately,
// per "shared frontend state" requirement) but never claims a real backend
// account or membership was created.
function finalizeInvitationAcceptance(invitation, name) {
  invitation.status = "Accepted Preview";
  invitation.acceptedDate = nowIso();
  const member = createOrganizationMember({
    id: nextId("member", MEMBERS), name: name || invitation.email.split("@")[0], email: invitation.email,
    organizationId: invitation.organizationId, roleIds: [invitation.intendedRoleId],
    departmentId: invitation.department, teamId: invitation.team, managerId: invitation.manager,
    status: "Active", invitationSource: "Email Invitation", joinedDate: nowIso(), lastActive: nowIso(),
    invitedBy: invitation.invitedBy,
  });
  MEMBERS.push(member);
  recordAuditEvent({
    actor: invitation.email, organizationId: invitation.organizationId, event: "Membership accepted (preview)",
    targetLabel: invitation.email, newValue: roleLabel(invitation.intendedRoleId),
  });
  return { member, invitation };
}

export function acceptEmailInvitationPreview(token, { name }) {
  const invitation = findInvitationByToken(token);
  if (!invitation) return { error: "invalid_token" };
  if (invitation.status === "Revoked") return { error: "revoked" };
  if (invitation.status === "Expired" || new Date(invitation.expirationDate) < new Date()) return { error: "expired" };
  if (invitation.status === "Accepted Preview") return { error: "already_accepted" };
  // Approval-required invitations never create a member directly from the
  // invitee's own acceptance — only approveJoinRequest() (an admin action)
  // does that. Accepting here just (re-)confirms the request is pending.
  if (invitation.approvalRequired) {
    invitation.status = "Approval Required";
    recordAuditEvent({ actor: invitation.email, organizationId: invitation.organizationId, event: "Approval requested", targetLabel: invitation.email });
    return { pendingApproval: true, invitation };
  }
  return finalizeInvitationAcceptance(invitation, name);
}

export function acceptInviteLinkPreview(token, { name, email }) {
  const link = findInviteLinkByToken(token);
  if (!link) return { error: "invalid_token" };
  if (link.status === "Revoked") return { error: "revoked" };
  if (link.status === "Expired" || new Date(link.expirationDate) < new Date()) return { error: "expired" };
  if (link.currentUses >= link.maxUses) return { error: "usage_limit_reached" };
  if (link.allowedEmailDomains.length > 0) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!link.allowedEmailDomains.includes(domain)) return { error: "domain_not_allowed" };
  }
  if (findExistingMemberByEmail(email, link.organizationId)) return { error: "already_member" };

  link.currentUses += 1;
  link.lastUsed = nowIso();
  recordAuditEvent({ actor: email, organizationId: link.organizationId, event: "Invite link used", targetLabel: link.name });

  if (link.approvalRequired) {
    recordAuditEvent({ actor: email, organizationId: link.organizationId, event: "Approval requested", targetLabel: email });
    return { pendingApproval: true, link };
  }
  const member = createOrganizationMember({
    id: nextId("member", MEMBERS), name, email, organizationId: link.organizationId,
    roleIds: [link.defaultRoleId], departmentId: link.department, teamId: link.team, managerId: link.manager,
    status: "Active", invitationSource: "Invite Link", joinedDate: nowIso(), lastActive: nowIso(), invitedBy: link.createdBy,
  });
  MEMBERS.push(member);
  recordAuditEvent({ actor: email, organizationId: link.organizationId, event: "Membership accepted (preview)", targetLabel: email, newValue: roleLabel(link.defaultRoleId) });
  return { member, link };
}

export function changeMemberRole(memberId, newRoleId, reason, actorName) {
  if (!reason?.trim()) return { error: "A reason is required to change a member's role." };
  const member = findMember(memberId);
  if (!member) return { error: "Member not found" };
  const previousRoleIds = [...member.roleIds];
  member.roleIds = [newRoleId];
  member.updatedAt = nowIso();
  recordAuditEvent({
    actor: actorName, organizationId: member.organizationId, event: "Member role changed", targetLabel: member.name,
    previousValue: previousRoleIds.map(roleLabel).join(", "), newValue: roleLabel(newRoleId), reason,
  });
  return { member };
}

export function setMemberStatus(memberId, status, reason, actorName, eventLabel) {
  if (!reason?.trim()) return { error: "A written reason is required for this action." };
  const member = findMember(memberId);
  if (!member) return { error: "Member not found" };
  const previousStatus = member.status;
  member.status = status;
  member.updatedAt = nowIso();
  recordAuditEvent({
    actor: actorName, organizationId: member.organizationId, event: eventLabel, targetLabel: member.name,
    previousValue: previousStatus, newValue: status, reason,
  });
  return { member };
}

export function suspendMember(memberId, reason, actorName) {
  return setMemberStatus(memberId, "Suspended", reason, actorName, "Member suspended");
}
export function reactivateMember(memberId, reason, actorName) {
  return setMemberStatus(memberId, "Active", reason, actorName, "Member reactivated");
}
export function removeMember(memberId, reason, actorName) {
  return setMemberStatus(memberId, "Removed", reason, actorName, "Member removed");
}

export function assignMemberDepartmentTeam(memberId, { department, team, manager }, actorName) {
  const member = findMember(memberId);
  if (!member) return { error: "Member not found" };
  if (department !== undefined) member.departmentId = department;
  if (team !== undefined) member.teamId = team;
  if (manager !== undefined) member.managerId = manager;
  member.updatedAt = nowIso();
  recordAuditEvent({ actor: actorName, organizationId: member.organizationId, event: "Member department/team updated", targetLabel: member.name });
  return { member };
}

export function approveJoinRequest(invitationOrLinkId, kind, actorName) {
  if (kind === "invitation") {
    const invitation = INVITATIONS.find((i) => i.id === invitationOrLinkId);
    if (!invitation) return { error: "Invitation not found" };
    if (invitation.status !== "Approval Required") return { error: `Invitation is not awaiting approval (status: ${invitation.status}).` };
    const result = finalizeInvitationAcceptance(invitation, invitation.email.split("@")[0]);
    recordAuditEvent({ actor: actorName, organizationId: invitation.organizationId, event: "Membership approved", targetLabel: invitation.email });
    return result;
  }
  return { error: "Unsupported approval kind" };
}

export function rejectJoinRequest(invitationId, reason, actorName) {
  if (!reason?.trim()) return { error: "A reason is required to reject a membership request." };
  const invitation = INVITATIONS.find((i) => i.id === invitationId);
  if (!invitation) return { error: "Invitation not found" };
  invitation.status = "Declined Preview";
  recordAuditEvent({ actor: actorName, organizationId: invitation.organizationId, event: "Membership rejected", targetLabel: invitation.email, reason });
  return { invitation };
}

// ---------------------------------------------------------------------------
// Compact metrics — used by every list page's metric-card row.
// ---------------------------------------------------------------------------
export function computeMemberMetrics(members) {
  return {
    active: members.filter((m) => m.status === "Active").length,
    pendingInvitations: INVITATIONS.filter((i) => ["Pending", "Approval Required"].includes(i.status) && members.some((m) => m.organizationId === i.organizationId)).length,
    suspended: members.filter((m) => m.status === "Suspended").length,
    administrators: members.filter((m) => m.roleIds.some((r) => ["organization_administrator", "system_owner"].includes(r))).length,
    teams: new Set(members.map((m) => m.teamId).filter(Boolean)).size,
    accessIssues: members.filter((m) => m.twoFactorStatus === "Not Enabled" && m.roleIds.some(isHighPrivilegeRoleId)).length,
  };
}

export function computeInvitationMetrics(invitations) {
  const now = Date.now();
  const soon = now + 3 * 24 * 60 * 60 * 1000;
  return {
    pending: invitations.filter((i) => i.status === "Pending").length,
    emailPreviews: invitations.filter((i) => ["Email Preview Generated", "Opened Preview"].includes(i.status)).length,
    approvalRequired: invitations.filter((i) => i.status === "Approval Required").length,
    expiringSoon: invitations.filter((i) => ["Pending", "Approval Required"].includes(i.status) && new Date(i.expirationDate).getTime() <= soon).length,
    expired: invitations.filter((i) => i.status === "Expired").length,
    revoked: invitations.filter((i) => i.status === "Revoked").length,
  };
}

export function computeInviteLinkMetrics(links) {
  return {
    activePreview: links.filter((l) => l.status === "Active Preview").length,
    expiringSoon: links.filter((l) => l.status === "Expiring Soon").length,
    totalUses: links.reduce((sum, l) => sum + l.currentUses, 0),
    approvalRequired: links.filter((l) => l.approvalRequired).length,
    domainRestricted: links.filter((l) => l.allowedEmailDomains.length > 0).length,
    revoked: links.filter((l) => l.status === "Revoked").length,
  };
}

export { getRoleLabel };
