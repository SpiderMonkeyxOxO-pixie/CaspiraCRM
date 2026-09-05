// Frontend permission evaluator for the Access Management package (Members,
// Invitations, Invite Links, Access Audit) — mirrors src/pages/AI/aiConfig.js:
// every function here is a thin, role-aware helper built strictly on top of
// mockRbacData's real hasPermission()/getTemplateForRealRole(), never a
// role-name string check. Components should call these, not ROLE === "Admin".
import { hasPermission, getTemplateForRealRole, ROLE_TEMPLATES, isSystemOwner, isOrganizationAdministrator } from "../../Helpers/mockRbacData";
import { HIGH_PRIVILEGE_ROLE_IDS, LINK_SAFE_ROLE_IDS, isHighPrivilegeRoleId, isRoleAssignableViaLink } from "../../Helpers/mockAccessData";

// isSystemOwner/isOrganizationAdministrator now live in mockRbacData.js (the
// canonical, feature-neutral home for role-identity checks) — re-exported
// here unchanged so every existing import of these two names keeps working.
export { HIGH_PRIVILEGE_ROLE_IDS, LINK_SAFE_ROLE_IDS, isHighPrivilegeRoleId, isRoleAssignableViaLink, isSystemOwner, isOrganizationAdministrator };

function actingTemplate(realRole) {
  return getTemplateForRealRole(realRole);
}

export function actingTemplateId(realRole) {
  return actingTemplate(realRole)?.id || null;
}

function actingHasPermission(realRole, moduleId, action) {
  const template = actingTemplate(realRole);
  return !!template && hasPermission(template.id, moduleId, action);
}

export function canViewMembers(realRole) {
  return actingHasPermission(realRole, "members", "view");
}
export function canInviteMembers(realRole) {
  return actingHasPermission(realRole, "members", "invite");
}
export function canChangeMemberRole(realRole) {
  return actingHasPermission(realRole, "members", "assign_role");
}
export function canSuspendMembers(realRole) {
  return actingHasPermission(realRole, "members", "suspend");
}
export function canReactivateMembers(realRole) {
  return actingHasPermission(realRole, "members", "reactivate");
}
export function canRemoveMembers(realRole) {
  return actingHasPermission(realRole, "members", "remove");
}
export function canViewInvitations(realRole) {
  return actingHasPermission(realRole, "invitations", "view");
}
export function canResendInvitations(realRole) {
  return actingHasPermission(realRole, "invitations", "resend");
}
export function canRevokeInvitations(realRole) {
  return actingHasPermission(realRole, "invitations", "revoke");
}
export function canManageInviteLinks(realRole) {
  return actingHasPermission(realRole, "invite_links", "create");
}
export function canRotateInviteLinks(realRole) {
  return actingHasPermission(realRole, "invite_links", "rotate");
}
export function canRevokeInviteLinks(realRole) {
  return actingHasPermission(realRole, "invite_links", "revoke");
}
export function canViewAccessAudit(realRole) {
  return actingHasPermission(realRole, "access_audit", "view");
}

// Every real role currently in the app that has ANY Access Management
// capability at all — used to gate sidebar visibility ("hide invitation
// navigation and actions when the role lacks permission").
export function hasAnyAccessManagementCapability(realRole) {
  return canViewMembers(realRole) || canViewInvitations(realRole) || canManageInviteLinks(realRole) || canViewAccessAudit(realRole);
}

// The organizationId(s) the acting role is authorized to see. System Owner
// sees every organization (returns null, meaning "no restriction" — the
// caller resolves that against the full organizations list); everyone else
// is fixed to the single organization their own membership record belongs
// to. This is enforced again server-side (in the mock API layer), never
// trusted from a hidden field or query string alone.
export function getAuthorizedOrganizationIds(realRole, actingMember) {
  if (isSystemOwner(realRole)) return null;
  return actingMember?.organizationId ? [actingMember.organizationId] : [];
}

// The role templates the acting role may invite/assign someone into.
// - System Owner may invite anyone except another System Owner through the
//   ordinary workflow (creating/transferring System Owner access is a
//   separate, not-yet-built ownership-transfer process).
// - Organization Administrator may never assign System Owner, another
//   Organization Administrator, or any other high-privilege role.
// - Every other role gets an empty list (no invitation permission at all).
export function getInvitableRoleTemplates(realRole) {
  if (isSystemOwner(realRole)) {
    return ROLE_TEMPLATES.filter((r) => r.id !== "system_owner" && r.status === "Active");
  }
  if (isOrganizationAdministrator(realRole)) {
    return ROLE_TEMPLATES.filter((r) => r.status === "Active" && !HIGH_PRIVILEGE_ROLE_IDS.includes(r.id));
  }
  return [];
}

// True only for System Owner inviting an Organization Administrator — the
// one case the spec calls out as needing a direct email invitation with an
// explicit high-privilege warning and confirmation, never a reusable link
// and never available to Organization Administrator.
export function requiresHighPrivilegeConfirmation(realRole, targetRoleTemplateId) {
  return isSystemOwner(realRole) && HIGH_PRIVILEGE_ROLE_IDS.includes(targetRoleTemplateId);
}

// Whether the acting role may modify a given target member at all —
// Organization Administrator must not modify a member with equal or higher
// administrative authority (another Organization Administrator or a System
// Owner), even within their own organization.
export function canModifyMember(realRole, targetMember) {
  if (isSystemOwner(realRole)) return true;
  if (!isOrganizationAdministrator(realRole)) return false;
  return !targetMember.roleIds.some(isHighPrivilegeRoleId);
}

export const INVITATION_EXPIRATION_PRESETS = [
  { value: "24h", label: "24 hours", hours: 24 },
  { value: "3d", label: "3 days", hours: 72 },
  { value: "7d", label: "7 days", hours: 168 },
  { value: "14d", label: "14 days", hours: 336 },
  { value: "custom", label: "Custom", hours: null },
];
export const DEFAULT_EXPIRATION_PRESET = "7d";
