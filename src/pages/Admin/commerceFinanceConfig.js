// Frontend permission evaluator for the Commerce and Finance Integrations
// package (Integration Center — Phase 5) — mirrors
// src/pages/Admin/projectsDevelopmentConfig.js exactly: every function here
// is a thin, role-aware helper built strictly on top of mockRbacData's real
// hasPermission()/getTemplateForRealRole(), never a role-name string check.
//
// Three module ids deliberately avoid the spec's own literal permission
// strings, to avoid colliding with the real Finance module's own,
// differently-shaped RBAC modules (payments/invoices/credit_notes, already
// granted to finance_manager/finance_staff with a richer VIEW_ORGANIZATION-
// style vocabulary):
//   spec's "payments.view"          -> "payment_transactions.view"
//   spec's "invoices.sync_preview"  -> "accounting_invoice_sync.sync_preview"
//   spec's "credit_notes.view"      -> "accounting_credit_notes.view"
// A fourth id was renamed after discovering mid-build that a real
// "subscriptions" module id already exists in the Sales module group (its
// own, unrelated real-CRM RBAC scope): spec's "subscriptions.*" ->
// "subscription_integrations.*".
import { hasPermission, getTemplateForRealRole, isSystemOwner, isOrganizationAdministrator } from "../../Helpers/mockRbacData";

export { isSystemOwner, isOrganizationAdministrator };

function actingHasPermission(realRole, moduleId, action) {
  const template = getTemplateForRealRole(realRole);
  return !!template && hasPermission(template.id, moduleId, action);
}

// ---------------------------------------------------------------------------
// commerce_integrations — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewCommerceIntegrations(realRole) {
  return actingHasPermission(realRole, "commerce_integrations", "view");
}
export function canManageCommerceIntegrations(realRole) {
  return actingHasPermission(realRole, "commerce_integrations", "manage");
}

// ---------------------------------------------------------------------------
// commerce_stores — kind commerce_stores_management [MANAGE] (no VIEW)
// ---------------------------------------------------------------------------
export function canManageCommerceStores(realRole) {
  return actingHasPermission(realRole, "commerce_stores", "manage");
}

// ---------------------------------------------------------------------------
// commerce_products / commerce_customers — [MAP] only (no VIEW)
// ---------------------------------------------------------------------------
export function canMapCommerceProducts(realRole) {
  return actingHasPermission(realRole, "commerce_products", "map");
}
export function canMapCommerceCustomers(realRole) {
  return actingHasPermission(realRole, "commerce_customers", "map");
}

// ---------------------------------------------------------------------------
// commerce_orders — [VIEW, SYNC_PREVIEW]
// ---------------------------------------------------------------------------
export function canViewCommerceOrders(realRole) {
  return actingHasPermission(realRole, "commerce_orders", "view");
}
export function canSyncCommerceOrders(realRole) {
  return actingHasPermission(realRole, "commerce_orders", "sync_preview");
}

// ---------------------------------------------------------------------------
// commerce_inventory — kind light [VIEW]
// ---------------------------------------------------------------------------
export function canViewCommerceInventory(realRole) {
  return actingHasPermission(realRole, "commerce_inventory", "view");
}

// ---------------------------------------------------------------------------
// payments_integrations — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewPaymentsIntegrations(realRole) {
  return actingHasPermission(realRole, "payments_integrations", "view");
}
export function canManagePaymentsIntegrations(realRole) {
  return actingHasPermission(realRole, "payments_integrations", "manage");
}

// ---------------------------------------------------------------------------
// payment_transactions / payment_fees / disputes / payouts — kind light [VIEW]
// ---------------------------------------------------------------------------
export function canViewPaymentTransactions(realRole) {
  return actingHasPermission(realRole, "payment_transactions", "view");
}
export function canViewPaymentFees(realRole) {
  return actingHasPermission(realRole, "payment_fees", "view");
}
export function canViewDisputes(realRole) {
  return actingHasPermission(realRole, "disputes", "view");
}
export function canViewPayouts(realRole) {
  return actingHasPermission(realRole, "payouts", "view");
}

// ---------------------------------------------------------------------------
// refunds — [VIEW, REQUEST_PREVIEW, APPROVE_PREVIEW]
// ---------------------------------------------------------------------------
export function canViewRefunds(realRole) {
  return actingHasPermission(realRole, "refunds", "view");
}
export function canRequestRefundPreview(realRole) {
  return actingHasPermission(realRole, "refunds", "request_preview");
}
export function canApproveRefundPreview(realRole) {
  return actingHasPermission(realRole, "refunds", "approve_preview");
}

// ---------------------------------------------------------------------------
// accounting_integrations — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewAccountingIntegrations(realRole) {
  return actingHasPermission(realRole, "accounting_integrations", "view");
}
export function canManageAccountingIntegrations(realRole) {
  return actingHasPermission(realRole, "accounting_integrations", "manage");
}

// ---------------------------------------------------------------------------
// accounting_mappings — [MANAGE] only (no VIEW)
// ---------------------------------------------------------------------------
export function canManageAccountingMappings(realRole) {
  return actingHasPermission(realRole, "accounting_mappings", "manage");
}

// ---------------------------------------------------------------------------
// accounting_invoice_sync — [SYNC_PREVIEW] only (spec's "invoices.sync_preview")
// ---------------------------------------------------------------------------
export function canSyncAccountingInvoices(realRole) {
  return actingHasPermission(realRole, "accounting_invoice_sync", "sync_preview");
}

// ---------------------------------------------------------------------------
// accounting_credit_notes — kind light [VIEW] (spec's "credit_notes.view")
// ---------------------------------------------------------------------------
export function canViewCreditNotes(realRole) {
  return actingHasPermission(realRole, "accounting_credit_notes", "view");
}

// ---------------------------------------------------------------------------
// subscription_integrations — [VIEW, MANAGE_PREVIEW] (spec's "subscriptions.*")
// ---------------------------------------------------------------------------
export function canViewSubscriptions(realRole) {
  return actingHasPermission(realRole, "subscription_integrations", "view");
}
export function canManageSubscriptionsPreview(realRole) {
  return actingHasPermission(realRole, "subscription_integrations", "manage_preview");
}

// ---------------------------------------------------------------------------
// banking_integrations — kind view_manage [VIEW, MANAGE]
// ---------------------------------------------------------------------------
export function canViewBankingIntegrations(realRole) {
  return actingHasPermission(realRole, "banking_integrations", "view");
}
export function canManageBankingIntegrations(realRole) {
  return actingHasPermission(realRole, "banking_integrations", "manage");
}

// ---------------------------------------------------------------------------
// bank_transactions — kind light [VIEW]
// ---------------------------------------------------------------------------
export function canViewBankTransactions(realRole) {
  return actingHasPermission(realRole, "bank_transactions", "view");
}

// ---------------------------------------------------------------------------
// reconciliation — [VIEW, PROCESS_PREVIEW, OVERRIDE]
// ---------------------------------------------------------------------------
export function canViewReconciliation(realRole) {
  return actingHasPermission(realRole, "reconciliation", "view");
}
export function canProcessReconciliationPreview(realRole) {
  return actingHasPermission(realRole, "reconciliation", "process_preview");
}
export function canOverrideReconciliation(realRole) {
  return actingHasPermission(realRole, "reconciliation", "override");
}

// ---------------------------------------------------------------------------
// financial_conflicts — [RESOLVE] only (no VIEW)
// ---------------------------------------------------------------------------
export function canResolveFinancialConflicts(realRole) {
  return actingHasPermission(realRole, "financial_conflicts", "resolve");
}

// Used to gate sidebar visibility for the "Commerce & Finance" nav entry.
export function hasAnyCommerceFinanceCapability(realRole) {
  return (
    canViewCommerceIntegrations(realRole) ||
    canViewCommerceOrders(realRole) ||
    canViewCommerceInventory(realRole) ||
    canViewPaymentsIntegrations(realRole) ||
    canViewPaymentTransactions(realRole) ||
    canViewPaymentFees(realRole) ||
    canViewRefunds(realRole) ||
    canViewDisputes(realRole) ||
    canViewPayouts(realRole) ||
    canViewAccountingIntegrations(realRole) ||
    canViewCreditNotes(realRole) ||
    canViewSubscriptions(realRole) ||
    canViewBankingIntegrations(realRole) ||
    canViewBankTransactions(realRole) ||
    canViewReconciliation(realRole)
  );
}

// The organizationId(s) the acting role is authorized to see — mirrors
// projectsDevelopmentConfig.js's getAuthorizedOrganizationIds exactly.
// System Owner sees every organization (null = "no restriction"); everyone
// else is fixed to their own organization. Enforced again server-side in
// the mock API layer, never trusted from a hidden field or query string
// alone.
export function getAuthorizedOrganizationIds(realRole, actingOrganizationId) {
  if (isSystemOwner(realRole)) return null;
  return actingOrganizationId ? [actingOrganizationId] : [];
}
