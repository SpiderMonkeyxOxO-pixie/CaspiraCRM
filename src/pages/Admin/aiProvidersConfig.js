// Frontend permission evaluator for the AI Provider and Intelligence
// Integrations package (Integration Center — Phase 7, final) — mirrors
// src/pages/Admin/documentsStorageConfig.js exactly: every function here is
// a thin, role-aware helper built strictly on top of mockRbacData's real
// hasPermission()/getTemplateForRealRole(), never a role-name string check.
//
// This governs only the new /admin/integrations/ai-providers/* routes. The
// existing, already-shipped /ai/overview and /ai/copilot pages have their
// own, separate, untouched access gate in src/pages/AI/aiConfig.js — no
// function here is a substitute for that file, and nothing here is
// imported by it.
import { hasPermission, getTemplateForRealRole, isSystemOwner, isOrganizationAdministrator } from "../../Helpers/mockRbacData";

export { isSystemOwner, isOrganizationAdministrator };

function actingHasPermission(realRole, moduleId, action) {
  const template = getTemplateForRealRole(realRole);
  return !!template && hasPermission(template.id, moduleId, action);
}

// ---------------------------------------------------------------------------
// ai_providers — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewAiProviders(realRole) {
  return actingHasPermission(realRole, "ai_providers", "view");
}
export function canManageAiProviders(realRole) {
  return actingHasPermission(realRole, "ai_providers", "manage");
}

// ---------------------------------------------------------------------------
// ai_provider_connections — [CREATE_PREVIEW, UPDATE_PREVIEW, PAUSE_PREVIEW] (no VIEW)
// ---------------------------------------------------------------------------
export function canCreateProviderConnectionPreview(realRole) {
  return actingHasPermission(realRole, "ai_provider_connections", "create_preview");
}
export function canUpdateProviderConnectionPreview(realRole) {
  return actingHasPermission(realRole, "ai_provider_connections", "update_preview");
}
export function canPauseProviderConnection(realRole) {
  return actingHasPermission(realRole, "ai_provider_connections", "pause_preview");
}

// ---------------------------------------------------------------------------
// ai_models — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewAiModels(realRole) {
  return actingHasPermission(realRole, "ai_models", "view");
}
export function canManageAiModels(realRole) {
  return actingHasPermission(realRole, "ai_models", "manage");
}

// ---------------------------------------------------------------------------
// ai_routing — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewAiRouting(realRole) {
  return actingHasPermission(realRole, "ai_routing", "view");
}
export function canManageAiRouting(realRole) {
  return actingHasPermission(realRole, "ai_routing", "manage");
}

// ---------------------------------------------------------------------------
// ai_policies — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewAiPolicies(realRole) {
  return actingHasPermission(realRole, "ai_policies", "view");
}
export function canManageAiPolicies(realRole) {
  return actingHasPermission(realRole, "ai_policies", "manage");
}

// ---------------------------------------------------------------------------
// ai_privacy — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewAiPrivacy(realRole) {
  return actingHasPermission(realRole, "ai_privacy", "view");
}
export function canManageAiPrivacy(realRole) {
  return actingHasPermission(realRole, "ai_privacy", "manage");
}

// ---------------------------------------------------------------------------
// ai_redaction — [VIEW] only (spec's "ai_redaction.preview")
// ---------------------------------------------------------------------------
export function canViewAiRedactionPreview(realRole) {
  return actingHasPermission(realRole, "ai_redaction", "view");
}

// ---------------------------------------------------------------------------
// ai_tools — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewAiTools(realRole) {
  return actingHasPermission(realRole, "ai_tools", "view");
}
export function canManageAiTools(realRole) {
  return actingHasPermission(realRole, "ai_tools", "manage");
}

// ---------------------------------------------------------------------------
// ai_usage — kind light [VIEW]
// ---------------------------------------------------------------------------
export function canViewAiUsage(realRole) {
  return actingHasPermission(realRole, "ai_usage", "view");
}

// ---------------------------------------------------------------------------
// ai_budgets — [MANAGE] only (no VIEW)
// ---------------------------------------------------------------------------
export function canManageAiBudgets(realRole) {
  return actingHasPermission(realRole, "ai_budgets", "manage");
}

// ---------------------------------------------------------------------------
// ai_evaluations — [VIEW, RUN_PREVIEW]
// ---------------------------------------------------------------------------
export function canViewAiEvaluations(realRole) {
  return actingHasPermission(realRole, "ai_evaluations", "view");
}
export function canRunAiEvaluationPreview(realRole) {
  return actingHasPermission(realRole, "ai_evaluations", "run_preview");
}

// ---------------------------------------------------------------------------
// ai_audit — kind light [VIEW]
// ---------------------------------------------------------------------------
export function canViewAiAudit(realRole) {
  return actingHasPermission(realRole, "ai_audit", "view");
}

// ---------------------------------------------------------------------------
// ai_sensitive_context — kind light [VIEW]
// ---------------------------------------------------------------------------
export function canViewAiSensitiveContext(realRole) {
  return actingHasPermission(realRole, "ai_sensitive_context", "view");
}

// ---------------------------------------------------------------------------
// ai_actions — [APPROVE_PREVIEW] only (no VIEW)
// ---------------------------------------------------------------------------
export function canApproveAiActionPreview(realRole) {
  return actingHasPermission(realRole, "ai_actions", "approve_preview");
}

// System-level, non-overridable security policies (e.g. the
// "Credentials and Secrets are always excluded" rule) can never be weakened
// by Organization Administrator, only by System Owner — implemented as a
// data-level gate layered on top of, not a replacement for, the module-
// grant RBAC system above, same pattern as Phase 6's classification gate.
export function canOverrideSystemSecurityPolicy(realRole) {
  return isSystemOwner(realRole);
}

// Used to gate sidebar visibility for the "AI Providers" nav entry.
export function hasAnyAiProvidersCapability(realRole) {
  return (
    canViewAiProviders(realRole) ||
    canViewAiModels(realRole) ||
    canViewAiRouting(realRole) ||
    canViewAiPolicies(realRole) ||
    canViewAiPrivacy(realRole) ||
    canViewAiRedactionPreview(realRole) ||
    canViewAiTools(realRole) ||
    canViewAiUsage(realRole) ||
    canViewAiEvaluations(realRole) ||
    canViewAiAudit(realRole) ||
    canViewAiSensitiveContext(realRole)
  );
}

// The organizationId(s) the acting role is authorized to see — mirrors
// documentsStorageConfig.js's getAuthorizedOrganizationIds exactly.
export function getAuthorizedOrganizationIds(realRole, actingOrganizationId) {
  if (isSystemOwner(realRole)) return null;
  return actingOrganizationId ? [actingOrganizationId] : [];
}
