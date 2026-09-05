// Frontend permission evaluator for the Sales & Marketing Integrations
// package (Integration Center — Phase 2) — mirrors
// src/pages/Admin/integrationsConfig.js: every function here is a thin,
// role-aware helper built strictly on top of mockRbacData's real
// hasPermission()/getTemplateForRealRole(), never a role-name string check.
// Components should call these, not ROLE === "Admin".
import { hasPermission, getTemplateForRealRole, isSystemOwner, isOrganizationAdministrator } from "../../Helpers/mockRbacData";

export { isSystemOwner, isOrganizationAdministrator };

function actingHasPermission(realRole, moduleId, action) {
  const template = getTemplateForRealRole(realRole);
  return !!template && hasPermission(template.id, moduleId, action);
}

// ---------------------------------------------------------------------------
// marketing_integrations — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewMarketingIntegrations(realRole) {
  return actingHasPermission(realRole, "marketing_integrations", "view");
}
export function canManageMarketingIntegrations(realRole) {
  return actingHasPermission(realRole, "marketing_integrations", "manage");
}

// ---------------------------------------------------------------------------
// lead_capture — kind lead_capture_management [VIEW, PROCESS, REJECT]
// ---------------------------------------------------------------------------
export function canViewLeadCapture(realRole) {
  return actingHasPermission(realRole, "lead_capture", "view");
}
export function canProcessLeadCapture(realRole) {
  return actingHasPermission(realRole, "lead_capture", "process");
}
export function canRejectLeadCapture(realRole) {
  return actingHasPermission(realRole, "lead_capture", "reject");
}

// ---------------------------------------------------------------------------
// lead_routing — kind lead_routing_management [MANAGE] (no VIEW action)
// ---------------------------------------------------------------------------
export function canManageLeadRouting(realRole) {
  return actingHasPermission(realRole, "lead_routing", "manage");
}

// ---------------------------------------------------------------------------
// audience_sync — kind audience_sync_management [VIEW, MANAGE, PREVIEW]
// ---------------------------------------------------------------------------
export function canViewAudienceSync(realRole) {
  return actingHasPermission(realRole, "audience_sync", "view");
}
export function canManageAudienceSync(realRole) {
  return actingHasPermission(realRole, "audience_sync", "manage");
}
export function canPreviewAudienceSync(realRole) {
  return actingHasPermission(realRole, "audience_sync", "preview");
}

// ---------------------------------------------------------------------------
// marketing_consent — kind view_manage [VIEW, MANAGE] (high-risk MANAGE)
// ---------------------------------------------------------------------------
export function canViewMarketingConsent(realRole) {
  return actingHasPermission(realRole, "marketing_consent", "view");
}
export function canManageMarketingConsent(realRole) {
  return actingHasPermission(realRole, "marketing_consent", "manage");
}

// ---------------------------------------------------------------------------
// suppression — kind suppression_management [VIEW, REMOVE] (high-risk REMOVE)
// ---------------------------------------------------------------------------
export function canViewSuppression(realRole) {
  return actingHasPermission(realRole, "suppression", "view");
}
export function canRemoveSuppression(realRole) {
  return actingHasPermission(realRole, "suppression", "remove");
}

// ---------------------------------------------------------------------------
// email_delivery — kind email_delivery_management [VIEW, RETRY]
// ---------------------------------------------------------------------------
export function canViewEmailDelivery(realRole) {
  return actingHasPermission(realRole, "email_delivery", "view");
}
export function canRetryEmailDelivery(realRole) {
  return actingHasPermission(realRole, "email_delivery", "retry");
}

// ---------------------------------------------------------------------------
// attribution — kind attribution_management [VIEW, CONFIGURE]
// ---------------------------------------------------------------------------
export function canViewAttribution(realRole) {
  return actingHasPermission(realRole, "attribution", "view");
}
export function canConfigureAttribution(realRole) {
  return actingHasPermission(realRole, "attribution", "configure");
}

// ---------------------------------------------------------------------------
// forms_integrations — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewFormsIntegrations(realRole) {
  return actingHasPermission(realRole, "forms_integrations", "view");
}
export function canManageFormsIntegrations(realRole) {
  return actingHasPermission(realRole, "forms_integrations", "manage");
}

// ---------------------------------------------------------------------------
// conversion_mapping — kind conversion_mapping_management [MANAGE] (no VIEW)
// ---------------------------------------------------------------------------
export function canManageConversionMapping(realRole) {
  return actingHasPermission(realRole, "conversion_mapping", "manage");
}

// Used to gate sidebar visibility for the "Sales & Marketing" nav entry.
export function hasAnySalesMarketingCapability(realRole) {
  return (
    canViewMarketingIntegrations(realRole) ||
    canViewLeadCapture(realRole) ||
    canViewAudienceSync(realRole) ||
    canViewMarketingConsent(realRole) ||
    canViewSuppression(realRole) ||
    canViewEmailDelivery(realRole) ||
    canViewAttribution(realRole) ||
    canViewFormsIntegrations(realRole)
  );
}

// The organizationId(s) the acting role is authorized to see — mirrors
// integrationsConfig.js's getAuthorizedOrganizationIds exactly. System Owner
// sees every organization (null = "no restriction"); everyone else is fixed
// to their own organization. Enforced again server-side in the mock API
// layer, never trusted from a hidden field or query string alone.
export function getAuthorizedOrganizationIds(realRole, actingOrganizationId) {
  if (isSystemOwner(realRole)) return null;
  return actingOrganizationId ? [actingOrganizationId] : [];
}
