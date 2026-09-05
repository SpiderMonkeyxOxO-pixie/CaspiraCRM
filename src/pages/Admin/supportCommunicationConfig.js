// Frontend permission evaluator for the Customer Support and Communication
// Integrations package (Integration Center — Phase 3) — mirrors
// src/pages/Admin/salesMarketingConfig.js: every function here is a thin,
// role-aware helper built strictly on top of mockRbacData's real
// hasPermission()/getTemplateForRealRole(), never a role-name string check.
import { hasPermission, getTemplateForRealRole, isSystemOwner, isOrganizationAdministrator } from "../../Helpers/mockRbacData";

export { isSystemOwner, isOrganizationAdministrator };

function actingHasPermission(realRole, moduleId, action) {
  const template = getTemplateForRealRole(realRole);
  return !!template && hasPermission(template.id, moduleId, action);
}

// ---------------------------------------------------------------------------
// support_integrations — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewSupportIntegrations(realRole) {
  return actingHasPermission(realRole, "support_integrations", "view");
}
export function canManageSupportIntegrations(realRole) {
  return actingHasPermission(realRole, "support_integrations", "manage");
}

// ---------------------------------------------------------------------------
// support_channels — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewSupportChannels(realRole) {
  return actingHasPermission(realRole, "support_channels", "view");
}
export function canManageSupportChannels(realRole) {
  return actingHasPermission(realRole, "support_channels", "manage");
}

// ---------------------------------------------------------------------------
// support_inbox — kind support_inbox_management [VIEW, REPLY_PREVIEW, INTERNAL_NOTE]
// ---------------------------------------------------------------------------
export function canViewSupportInbox(realRole) {
  return actingHasPermission(realRole, "support_inbox", "view");
}
export function canReplyPreviewSupportInbox(realRole) {
  return actingHasPermission(realRole, "support_inbox", "reply_preview");
}
export function canInternalNoteSupportInbox(realRole) {
  return actingHasPermission(realRole, "support_inbox", "internal_note");
}

// ---------------------------------------------------------------------------
// support_tickets — kind support_tickets_management [VIEW, PROCESS, ASSIGN, CLOSE]
// ---------------------------------------------------------------------------
export function canViewSupportTickets(realRole) {
  return actingHasPermission(realRole, "support_tickets", "view");
}
export function canProcessSupportTickets(realRole) {
  return actingHasPermission(realRole, "support_tickets", "process");
}
export function canAssignSupportTickets(realRole) {
  return actingHasPermission(realRole, "support_tickets", "assign");
}
export function canCloseSupportTickets(realRole) {
  return actingHasPermission(realRole, "support_tickets", "close");
}

// ---------------------------------------------------------------------------
// support_identity — kind support_identity_management [VIEW, LINK, CREATE_CONTACT, MERGE]
// ---------------------------------------------------------------------------
export function canViewSupportIdentity(realRole) {
  return actingHasPermission(realRole, "support_identity", "view");
}
export function canLinkSupportIdentity(realRole) {
  return actingHasPermission(realRole, "support_identity", "link");
}
export function canCreateContactFromSupportIdentity(realRole) {
  return actingHasPermission(realRole, "support_identity", "create_contact");
}
export function canMergeSupportIdentity(realRole) {
  return actingHasPermission(realRole, "support_identity", "merge");
}

// ---------------------------------------------------------------------------
// support_queues — kind support_queues_management [MANAGE] (no VIEW action)
// ---------------------------------------------------------------------------
export function canManageSupportQueues(realRole) {
  return actingHasPermission(realRole, "support_queues", "manage");
}

// ---------------------------------------------------------------------------
// support_agent_mappings — kind support_agent_mappings_management [MANAGE] (no VIEW action)
// ---------------------------------------------------------------------------
export function canManageSupportAgentMappings(realRole) {
  return actingHasPermission(realRole, "support_agent_mappings", "manage");
}

// ---------------------------------------------------------------------------
// support_sla — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewSupportSla(realRole) {
  return actingHasPermission(realRole, "support_sla", "view");
}
export function canManageSupportSla(realRole) {
  return actingHasPermission(realRole, "support_sla", "manage");
}

// ---------------------------------------------------------------------------
// support_escalations — kind support_escalations_management [MANAGE] (no VIEW action)
// ---------------------------------------------------------------------------
export function canManageSupportEscalations(realRole) {
  return actingHasPermission(realRole, "support_escalations", "manage");
}

// ---------------------------------------------------------------------------
// support_calls — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewSupportCalls(realRole) {
  return actingHasPermission(realRole, "support_calls", "view");
}
export function canManageSupportCalls(realRole) {
  return actingHasPermission(realRole, "support_calls", "manage");
}

// ---------------------------------------------------------------------------
// support_recordings / support_transcripts — kind light [VIEW]
// ---------------------------------------------------------------------------
export function canViewSupportRecordings(realRole) {
  return actingHasPermission(realRole, "support_recordings", "view");
}
export function canViewSupportTranscripts(realRole) {
  return actingHasPermission(realRole, "support_transcripts", "view");
}

// ---------------------------------------------------------------------------
// support_reviews — kind support_reviews_management [VIEW, REPLY_PREVIEW]
// ---------------------------------------------------------------------------
export function canViewSupportReviews(realRole) {
  return actingHasPermission(realRole, "support_reviews", "view");
}
export function canReplyPreviewSupportReviews(realRole) {
  return actingHasPermission(realRole, "support_reviews", "reply_preview");
}

// ---------------------------------------------------------------------------
// support_sync — kind support_sync_management [RETRY] (no VIEW action)
// ---------------------------------------------------------------------------
export function canRetrySupportSync(realRole) {
  return actingHasPermission(realRole, "support_sync", "retry");
}

// ---------------------------------------------------------------------------
// support_conflicts — kind support_conflicts_management [RESOLVE] (no VIEW action)
// ---------------------------------------------------------------------------
export function canResolveSupportConflicts(realRole) {
  return actingHasPermission(realRole, "support_conflicts", "resolve");
}

// Used to gate sidebar visibility for the "Support & Communication" nav entry.
export function hasAnySupportCommunicationCapability(realRole) {
  return (
    canViewSupportIntegrations(realRole) ||
    canViewSupportChannels(realRole) ||
    canViewSupportInbox(realRole) ||
    canViewSupportTickets(realRole) ||
    canViewSupportIdentity(realRole) ||
    canViewSupportSla(realRole) ||
    canViewSupportCalls(realRole) ||
    canViewSupportReviews(realRole)
  );
}

// The organizationId(s) the acting role is authorized to see — mirrors
// integrationsConfig.js's/salesMarketingConfig.js's getAuthorizedOrganizationIds
// exactly. System Owner sees every organization (null = "no restriction");
// everyone else is fixed to their own organization. Enforced again
// server-side in the mock API layer, never trusted from a hidden field or
// query string alone.
export function getAuthorizedOrganizationIds(realRole, actingOrganizationId) {
  if (isSystemOwner(realRole)) return null;
  return actingOrganizationId ? [actingOrganizationId] : [];
}
