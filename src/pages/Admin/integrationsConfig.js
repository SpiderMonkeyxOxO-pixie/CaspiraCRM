// Frontend permission evaluator for the Integration Center package — mirrors
// src/pages/Admin/accessManagementConfig.js: every function here is a thin,
// role-aware helper built strictly on top of mockRbacData's real
// hasPermission()/getTemplateForRealRole(), never a role-name string check.
// Components should call these, not ROLE === "Admin".
import { hasPermission, getTemplateForRealRole, isSystemOwner, isOrganizationAdministrator } from "../../Helpers/mockRbacData";

export { isSystemOwner, isOrganizationAdministrator };

const MODULE_ID = "integration_center";

function actingHasPermission(realRole, action) {
  const template = getTemplateForRealRole(realRole);
  return !!template && hasPermission(template.id, MODULE_ID, action);
}

export function canViewIntegrations(realRole) {
  return actingHasPermission(realRole, "view");
}
export function canViewMarketplace(realRole) {
  return actingHasPermission(realRole, "view_marketplace");
}
export function canCreateConnections(realRole) {
  return actingHasPermission(realRole, "create");
}
export function canUpdateConnections(realRole) {
  return actingHasPermission(realRole, "edit");
}
export function canPauseConnections(realRole) {
  return actingHasPermission(realRole, "pause");
}
export function canDisconnectConnections(realRole) {
  return actingHasPermission(realRole, "disconnect");
}
export function canManageCapabilities(realRole) {
  return actingHasPermission(realRole, "manage_capabilities");
}
export function canViewMappings(realRole) {
  return actingHasPermission(realRole, "view_mappings");
}
export function canManageMappings(realRole) {
  return actingHasPermission(realRole, "manage_mappings");
}
export function canViewSync(realRole) {
  return actingHasPermission(realRole, "view_sync");
}
export function canRunSync(realRole) {
  return actingHasPermission(realRole, "run_sync");
}
export function canRetryErrors(realRole) {
  return actingHasPermission(realRole, "retry");
}
export function canViewWebhooks(realRole) {
  return actingHasPermission(realRole, "view_webhooks");
}
export function canManageWebhooks(realRole) {
  return actingHasPermission(realRole, "manage_webhooks");
}
export function canViewActivity(realRole) {
  return actingHasPermission(realRole, "view_activity");
}
export function canManagePolicies(realRole) {
  return actingHasPermission(realRole, "manage_policies");
}

// Used to gate sidebar visibility for the "Integrations" nav entry.
export function hasAnyIntegrationsCapability(realRole) {
  return canViewIntegrations(realRole) || canViewMarketplace(realRole) || canViewActivity(realRole) || canViewWebhooks(realRole);
}

// The organizationId(s) the acting role is authorized to see — mirrors
// accessManagementConfig.js's getAuthorizedOrganizationIds exactly. System
// Owner sees every organization (null = "no restriction"); everyone else is
// fixed to their own organization. Enforced again server-side in the mock
// API layer, never trusted from a hidden field or query string alone.
export function getAuthorizedOrganizationIds(realRole, actingOrganizationId) {
  if (isSystemOwner(realRole)) return null;
  return actingOrganizationId ? [actingOrganizationId] : [];
}

// Whether the acting role may modify a given connection's organization at
// all — Organization Administrator may only touch connections inside their
// own organization; System Owner may touch any.
export function canManageConnectionForOrganization(realRole, connectionOrganizationId, actingOrganizationId) {
  if (isSystemOwner(realRole)) return true;
  if (!isOrganizationAdministrator(realRole)) return false;
  return connectionOrganizationId === actingOrganizationId;
}
