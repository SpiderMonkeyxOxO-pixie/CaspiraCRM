// Frontend permission evaluator for the Documents, Storage and Electronic
// Signature Integrations package (Integration Center — Phase 6) — mirrors
// src/pages/Admin/commerceFinanceConfig.js exactly: every function here is a
// thin, role-aware helper built strictly on top of mockRbacData's real
// hasPermission()/getTemplateForRealRole(), never a role-name string check.
//
// Unlike Phase 5, none of this phase's module ids collide with a real CRM
// module, so every permission string here matches the spec's own literal
// wording — no rename mapping table is needed.
import { hasPermission, getTemplateForRealRole, isSystemOwner, isOrganizationAdministrator } from "../../Helpers/mockRbacData";

export { isSystemOwner, isOrganizationAdministrator };

function actingHasPermission(realRole, moduleId, action) {
  const template = getTemplateForRealRole(realRole);
  return !!template && hasPermission(template.id, moduleId, action);
}

// ---------------------------------------------------------------------------
// document_integrations — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewDocumentIntegrations(realRole) {
  return actingHasPermission(realRole, "document_integrations", "view");
}
export function canManageDocumentIntegrations(realRole) {
  return actingHasPermission(realRole, "document_integrations", "manage");
}

// ---------------------------------------------------------------------------
// storage_connections — [MANAGE] only (no VIEW)
// ---------------------------------------------------------------------------
export function canManageStorageConnections(realRole) {
  return actingHasPermission(realRole, "storage_connections", "manage");
}

// ---------------------------------------------------------------------------
// external_files — [VIEW, LINK, UNLINK, UPLOAD_PREVIEW, DOWNLOAD, SHARE_PREVIEW, DELETE_PREVIEW]
// ---------------------------------------------------------------------------
export function canViewExternalFiles(realRole) {
  return actingHasPermission(realRole, "external_files", "view");
}
export function canLinkExternalFiles(realRole) {
  return actingHasPermission(realRole, "external_files", "link");
}
export function canUnlinkExternalFiles(realRole) {
  return actingHasPermission(realRole, "external_files", "unlink");
}
export function canUploadFilePreview(realRole) {
  return actingHasPermission(realRole, "external_files", "upload_preview");
}
export function canSeeDownloadAvailability(realRole) {
  return actingHasPermission(realRole, "external_files", "download");
}
export function canShareFilePreview(realRole) {
  return actingHasPermission(realRole, "external_files", "share_preview");
}
export function canDeleteFilePreview(realRole) {
  return actingHasPermission(realRole, "external_files", "delete_preview");
}

// ---------------------------------------------------------------------------
// folder_mappings — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewFolderMappings(realRole) {
  return actingHasPermission(realRole, "folder_mappings", "view");
}
export function canManageFolderMappings(realRole) {
  return actingHasPermission(realRole, "folder_mappings", "manage");
}

// ---------------------------------------------------------------------------
// file_permissions — [VIEW, MANAGE_PREVIEW]
// ---------------------------------------------------------------------------
export function canViewFilePermissions(realRole) {
  return actingHasPermission(realRole, "file_permissions", "view");
}
export function canManageFilePermissionsPreview(realRole) {
  return actingHasPermission(realRole, "file_permissions", "manage_preview");
}

// ---------------------------------------------------------------------------
// file_classification — [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewFileClassification(realRole) {
  return actingHasPermission(realRole, "file_classification", "view");
}
export function canManageFileClassification(realRole) {
  return actingHasPermission(realRole, "file_classification", "manage");
}

// ---------------------------------------------------------------------------
// file_versions — kind light [VIEW]
// ---------------------------------------------------------------------------
export function canViewFileVersions(realRole) {
  return actingHasPermission(realRole, "file_versions", "view");
}

// ---------------------------------------------------------------------------
// signature_integrations — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewSignatureIntegrations(realRole) {
  return actingHasPermission(realRole, "signature_integrations", "view");
}
export function canManageSignatureIntegrations(realRole) {
  return actingHasPermission(realRole, "signature_integrations", "manage");
}

// ---------------------------------------------------------------------------
// signature_workflows — [VIEW, CREATE_PREVIEW, SEND_PREVIEW, REMIND_PREVIEW, VOID_PREVIEW]
// ---------------------------------------------------------------------------
export function canViewSignatureWorkflows(realRole) {
  return actingHasPermission(realRole, "signature_workflows", "view");
}
export function canCreateSignatureWorkflowPreview(realRole) {
  return actingHasPermission(realRole, "signature_workflows", "create_preview");
}
export function canSendSignatureWorkflowPreview(realRole) {
  return actingHasPermission(realRole, "signature_workflows", "send_preview");
}
export function canRemindSignatureWorkflowPreview(realRole) {
  return actingHasPermission(realRole, "signature_workflows", "remind_preview");
}
export function canVoidSignatureWorkflowPreview(realRole) {
  return actingHasPermission(realRole, "signature_workflows", "void_preview");
}

// ---------------------------------------------------------------------------
// signature_templates — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewSignatureTemplates(realRole) {
  return actingHasPermission(realRole, "signature_templates", "view");
}
export function canManageSignatureTemplates(realRole) {
  return actingHasPermission(realRole, "signature_templates", "manage");
}

// ---------------------------------------------------------------------------
// signature_audit — kind light [VIEW]
// ---------------------------------------------------------------------------
export function canViewSignatureAudit(realRole) {
  return actingHasPermission(realRole, "signature_audit", "view");
}

// ---------------------------------------------------------------------------
// retention_policies — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewRetentionPolicies(realRole) {
  return actingHasPermission(realRole, "retention_policies", "view");
}
export function canManageRetentionPolicies(realRole) {
  return actingHasPermission(realRole, "retention_policies", "manage");
}

// ---------------------------------------------------------------------------
// legal_holds — [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewLegalHolds(realRole) {
  return actingHasPermission(realRole, "legal_holds", "view");
}
export function canManageLegalHolds(realRole) {
  return actingHasPermission(realRole, "legal_holds", "manage");
}

// ---------------------------------------------------------------------------
// document_access_review — kind light [VIEW]
// ---------------------------------------------------------------------------
export function canViewDocumentAccessReview(realRole) {
  return actingHasPermission(realRole, "document_access_review", "view");
}

// ---------------------------------------------------------------------------
// document_conflicts — [RESOLVE] only (no VIEW)
// ---------------------------------------------------------------------------
export function canResolveDocumentConflicts(realRole) {
  return actingHasPermission(realRole, "document_conflicts", "resolve");
}

// Classification-level gate — layered on top of, not a replacement for, the
// module-grant RBAC system above. Implements the spec's explicit
// Organization-Administrator carve-out: "does not automatically receive
// access to every Restricted, Financial, Legal or HR document." True for
// System Owner and the roles built specifically to own those document
// types; false for everyone else by default, including Organization
// Administrator.
const RESTRICTED_CLASSIFICATION_ROLES = new Set(["system_owner", "legal_manager", "finance_manager"]);
export function canViewRestrictedClassifications(realRole) {
  const template = getTemplateForRealRole(realRole);
  return !!template && RESTRICTED_CLASSIFICATION_ROLES.has(template.id);
}

// Used to gate sidebar visibility for the "Documents & Storage" nav entry.
export function hasAnyDocumentsStorageCapability(realRole) {
  return (
    canViewDocumentIntegrations(realRole) ||
    canViewExternalFiles(realRole) ||
    canViewFolderMappings(realRole) ||
    canViewFilePermissions(realRole) ||
    canViewFileClassification(realRole) ||
    canViewFileVersions(realRole) ||
    canViewSignatureIntegrations(realRole) ||
    canViewSignatureWorkflows(realRole) ||
    canViewSignatureTemplates(realRole) ||
    canViewSignatureAudit(realRole) ||
    canViewRetentionPolicies(realRole) ||
    canViewLegalHolds(realRole) ||
    canViewDocumentAccessReview(realRole)
  );
}

// The organizationId(s) the acting role is authorized to see — mirrors
// commerceFinanceConfig.js's getAuthorizedOrganizationIds exactly.
export function getAuthorizedOrganizationIds(realRole, actingOrganizationId) {
  if (isSystemOwner(realRole)) return null;
  return actingOrganizationId ? [actingOrganizationId] : [];
}
