// Frontend permission evaluator for the Projects and Development
// Integrations package (Integration Center — Phase 4) — mirrors
// src/pages/Admin/salesMarketingConfig.js / supportCommunicationConfig.js:
// every function here is a thin, role-aware helper built strictly on top of
// mockRbacData's real hasPermission()/getTemplateForRealRole(), never a
// role-name string check. Components should call these, not ROLE === "Admin".
import { hasPermission, getTemplateForRealRole, isSystemOwner, isOrganizationAdministrator } from "../../Helpers/mockRbacData";

export { isSystemOwner, isOrganizationAdministrator };

function actingHasPermission(realRole, moduleId, action) {
  const template = getTemplateForRealRole(realRole);
  return !!template && hasPermission(template.id, moduleId, action);
}

// ---------------------------------------------------------------------------
// project_integrations — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewProjectIntegrations(realRole) {
  return actingHasPermission(realRole, "project_integrations", "view");
}
export function canManageProjectIntegrations(realRole) {
  return actingHasPermission(realRole, "project_integrations", "manage");
}

// ---------------------------------------------------------------------------
// project_connections — kind project_connections_management [MANAGE] (no VIEW)
// ---------------------------------------------------------------------------
export function canManageProjectConnections(realRole) {
  return actingHasPermission(realRole, "project_connections", "manage");
}

// ---------------------------------------------------------------------------
// project_mappings — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewProjectMappings(realRole) {
  return actingHasPermission(realRole, "project_mappings", "view");
}
export function canManageProjectMappings(realRole) {
  return actingHasPermission(realRole, "project_mappings", "manage");
}

// ---------------------------------------------------------------------------
// project_templates — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewProjectTemplates(realRole) {
  return actingHasPermission(realRole, "project_templates", "view");
}
export function canManageProjectTemplates(realRole) {
  return actingHasPermission(realRole, "project_templates", "manage");
}

// ---------------------------------------------------------------------------
// project_sync — kind project_sync_management [VIEW, RUN_SYNC, RETRY]
// ---------------------------------------------------------------------------
export function canViewProjectSync(realRole) {
  return actingHasPermission(realRole, "project_sync", "view");
}
export function canRunProjectSync(realRole) {
  return actingHasPermission(realRole, "project_sync", "run_sync");
}
export function canRetryProjectSync(realRole) {
  return actingHasPermission(realRole, "project_sync", "retry");
}

// ---------------------------------------------------------------------------
// project_conflicts — kind project_conflicts_management [RESOLVE] (no VIEW)
// ---------------------------------------------------------------------------
export function canResolveProjectConflicts(realRole) {
  return actingHasPermission(realRole, "project_conflicts", "resolve");
}

// ---------------------------------------------------------------------------
// external_projects — kind external_projects_management [VIEW, LINK, CREATE_PREVIEW, UNLINK]
// ---------------------------------------------------------------------------
export function canViewExternalProjects(realRole) {
  return actingHasPermission(realRole, "external_projects", "view");
}
export function canLinkExternalProjects(realRole) {
  return actingHasPermission(realRole, "external_projects", "link");
}
export function canCreateExternalProjectPreview(realRole) {
  return actingHasPermission(realRole, "external_projects", "create_preview");
}
export function canUnlinkExternalProjects(realRole) {
  return actingHasPermission(realRole, "external_projects", "unlink");
}

// ---------------------------------------------------------------------------
// external_tasks — kind external_tasks_management [VIEW, MANAGE_PREVIEW]
// ---------------------------------------------------------------------------
export function canViewExternalTasks(realRole) {
  return actingHasPermission(realRole, "external_tasks", "view");
}
export function canManageExternalTasksPreview(realRole) {
  return actingHasPermission(realRole, "external_tasks", "manage_preview");
}

// ---------------------------------------------------------------------------
// development_integrations — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewDevelopmentIntegrations(realRole) {
  return actingHasPermission(realRole, "development_integrations", "view");
}
export function canManageDevelopmentIntegrations(realRole) {
  return actingHasPermission(realRole, "development_integrations", "manage");
}

// ---------------------------------------------------------------------------
// repositories — kind light [VIEW]
// ---------------------------------------------------------------------------
export function canViewRepositories(realRole) {
  return actingHasPermission(realRole, "repositories", "view");
}

// ---------------------------------------------------------------------------
// development_issues — kind development_issues_management [VIEW, CREATE_PREVIEW]
// ---------------------------------------------------------------------------
export function canViewDevelopmentIssues(realRole) {
  return actingHasPermission(realRole, "development_issues", "view");
}
export function canCreateDevelopmentIssuePreview(realRole) {
  return actingHasPermission(realRole, "development_issues", "create_preview");
}

// ---------------------------------------------------------------------------
// code_reviews / pipelines / deployments / releases / delivery_health —
// kind light [VIEW] each
// ---------------------------------------------------------------------------
export function canViewCodeReviews(realRole) {
  return actingHasPermission(realRole, "code_reviews", "view");
}
export function canViewPipelines(realRole) {
  return actingHasPermission(realRole, "pipelines", "view");
}
export function canViewDeployments(realRole) {
  return actingHasPermission(realRole, "deployments", "view");
}
export function canViewReleases(realRole) {
  return actingHasPermission(realRole, "releases", "view");
}
export function canViewDeliveryHealth(realRole) {
  return actingHasPermission(realRole, "delivery_health", "view");
}

// Used to gate sidebar visibility for the "Projects & Development" nav entry.
export function hasAnyProjectsDevelopmentCapability(realRole) {
  return (
    canViewProjectIntegrations(realRole) ||
    canViewProjectMappings(realRole) ||
    canViewProjectTemplates(realRole) ||
    canViewProjectSync(realRole) ||
    canViewExternalProjects(realRole) ||
    canViewExternalTasks(realRole) ||
    canViewDevelopmentIntegrations(realRole) ||
    canViewRepositories(realRole) ||
    canViewDevelopmentIssues(realRole) ||
    canViewCodeReviews(realRole) ||
    canViewPipelines(realRole) ||
    canViewDeployments(realRole) ||
    canViewReleases(realRole) ||
    canViewDeliveryHealth(realRole)
  );
}

// The organizationId(s) the acting role is authorized to see — mirrors
// salesMarketingConfig.js's getAuthorizedOrganizationIds exactly. System
// Owner sees every organization (null = "no restriction"); everyone else is
// fixed to their own organization. Enforced again server-side in the mock
// API layer, never trusted from a hidden field or query string alone.
export function getAuthorizedOrganizationIds(realRole, actingOrganizationId) {
  if (isSystemOwner(realRole)) return null;
  return actingOrganizationId ? [actingOrganizationId] : [];
}
