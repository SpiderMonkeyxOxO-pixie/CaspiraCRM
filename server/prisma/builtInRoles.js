// The built-in roles and their permission grants, shared by prisma/seed.js
// (dev data) and scripts/seedRoles.js (roles only — safe for production).
//
// Built-in roles matching the frontend's RBAC preview role templates —
// `key` links each row to the real auth role identifier it maps to.
// permissionGrants: [{moduleId, actions:[]}] against constants/
// permissionCatalog.js's "platform" module group (organizations, members,
// invitations, invite_links, sessions, audit_events) — Backend Phase 1's
// org-scoped RBAC surface. Auditor/Checker is read-only by design: no
// grant here ever includes an edit/create/assign/delete_permanently
// action. Standard Employee gets nothing (deny by default).
export const BUILT_IN_ROLES = [
  {
    key: "super_admin", name: "System Owner", defaultScope: "System-wide", purpose: "Highest system-level authority.",
    permissionGrants: [
      { moduleId: "organizations", actions: ["view", "edit"] },
      { moduleId: "members", actions: ["view", "edit", "assign", "delete_permanently"] },
      { moduleId: "invitations", actions: ["view", "create", "edit"] },
      { moduleId: "invite_links", actions: ["view", "create", "edit"] },
      { moduleId: "sessions", actions: ["view"] },
      { moduleId: "audit_events", actions: ["view"] },
      // Backend Phase 2 — CRM Core Data Persistence
      { moduleId: "leads", actions: ["view", "create", "edit", "assign", "archive", "restore", "convert", "bulk_actions", "export"] },
      { moduleId: "contacts", actions: ["view", "create", "edit", "assign", "archive", "restore", "merge", "bulk_actions", "export", "view_sensitive_fields"] },
      { moduleId: "companies", actions: ["view", "create", "edit", "assign", "archive", "restore", "merge", "bulk_actions", "export", "view_financial_fields"] },
      { moduleId: "activities", actions: ["view", "create", "edit", "assign", "archive", "restore", "bulk_actions"] },
      { moduleId: "notes", actions: ["view", "create", "edit", "archive"] },
      { moduleId: "tags", actions: ["view", "create", "edit", "archive"] },
      // Backend Phase 3 — Sales Pipeline, Deals, Catalog, Quotes, Orders, Contracts
      { moduleId: "pipeline", actions: ["view", "create", "edit", "archive", "restore", "reorder"] },
      { moduleId: "deals", actions: ["view", "create", "edit", "assign", "transition", "close", "reopen", "archive", "restore", "bulk_actions", "view_financial_fields"] },
      { moduleId: "products_services", actions: ["view", "create", "edit", "archive", "restore", "view_financial_fields"] },
      { moduleId: "price_books", actions: ["view", "create", "edit", "archive", "restore"] },
      { moduleId: "quotes", actions: ["view", "create", "edit", "submit", "approve", "reject", "issue", "accept", "cancel", "archive", "restore", "bulk_actions", "override_pricing", "view_financial_fields"] },
      { moduleId: "orders", actions: ["view", "create", "edit", "confirm", "cancel", "fulfill", "archive", "restore", "bulk_actions"] },
      { moduleId: "contracts", actions: ["view", "create", "edit", "approve", "activate", "renew", "terminate", "manage_obligations", "archive", "restore", "bulk_actions"] },
      { moduleId: "sales_reports", actions: ["view", "view_forecast"] },
      // Backend Phase 4 — Support (full spec)
      { moduleId: "tickets", actions: ["view", "create", "edit", "assign", "transition", "resolve", "close", "reopen", "archive", "restore", "merge", "bulk_actions", "reply", "escalate", "view_internal_notes", "add_internal_notes", "view_restricted_notes", "view_audit_history"] },
      { moduleId: "support_inboxes", actions: ["view", "configure"] },
      { moduleId: "support_queues", actions: ["view", "configure"] },
      { moduleId: "support_sla", actions: ["view", "configure"] },
      { moduleId: "support_entitlements", actions: ["view", "configure"] },
      { moduleId: "knowledge_base", actions: ["view", "create", "review", "publish", "archive"] },
      { moduleId: "canned_responses", actions: ["view", "configure"] },
      { moduleId: "support_csat", actions: ["view"] },
      { moduleId: "support_reports", actions: ["view"] },
      { moduleId: "support_portal", actions: ["view", "configure"] },
      // Backend Phase 5 — Projects
      { moduleId: "projects", actions: ["view", "create", "edit", "assign"] },
      { moduleId: "tasks", actions: ["view", "create", "edit", "assign"] },
      // Backend Phase 6 — Finance
      { moduleId: "invoices", actions: ["view", "create", "edit", "approve", "issue", "cancel", "credit"] },
      { moduleId: "payments", actions: ["view", "create"] },
      { moduleId: "expenses", actions: ["view", "create", "approve", "reject"] },
      { moduleId: "recurring_invoices", actions: ["view", "create", "edit"] },
    ],
  },
  {
    key: "admin", name: "Organization Administrator", defaultScope: "Organization", purpose: "Manages one organization and its business configuration.",
    permissionGrants: [
      { moduleId: "organizations", actions: ["view", "edit"] },
      { moduleId: "members", actions: ["view", "edit", "assign", "delete_permanently"] },
      { moduleId: "invitations", actions: ["view", "create", "edit"] },
      { moduleId: "invite_links", actions: ["view", "create", "edit"] },
      { moduleId: "sessions", actions: ["view"] },
      { moduleId: "audit_events", actions: ["view"] },
      { moduleId: "leads", actions: ["view", "create", "edit", "assign", "archive", "restore", "convert", "bulk_actions", "export"] },
      { moduleId: "contacts", actions: ["view", "create", "edit", "assign", "archive", "restore", "merge", "bulk_actions", "export", "view_sensitive_fields"] },
      { moduleId: "companies", actions: ["view", "create", "edit", "assign", "archive", "restore", "merge", "bulk_actions", "export", "view_financial_fields"] },
      { moduleId: "activities", actions: ["view", "create", "edit", "assign", "archive", "restore", "bulk_actions"] },
      { moduleId: "notes", actions: ["view", "create", "edit", "archive"] },
      { moduleId: "tags", actions: ["view", "create", "edit", "archive"] },
      { moduleId: "pipeline", actions: ["view", "create", "edit", "archive", "restore", "reorder"] },
      { moduleId: "deals", actions: ["view", "create", "edit", "assign", "transition", "close", "reopen", "archive", "restore", "bulk_actions", "view_financial_fields"] },
      { moduleId: "products_services", actions: ["view", "create", "edit", "archive", "restore", "view_financial_fields"] },
      { moduleId: "price_books", actions: ["view", "create", "edit", "archive", "restore"] },
      { moduleId: "quotes", actions: ["view", "create", "edit", "submit", "approve", "reject", "issue", "accept", "cancel", "archive", "restore", "bulk_actions", "override_pricing", "view_financial_fields"] },
      { moduleId: "orders", actions: ["view", "create", "edit", "confirm", "cancel", "fulfill", "archive", "restore", "bulk_actions"] },
      { moduleId: "contracts", actions: ["view", "create", "edit", "approve", "activate", "renew", "terminate", "manage_obligations", "archive", "restore", "bulk_actions"] },
      { moduleId: "sales_reports", actions: ["view", "view_forecast"] },
      // Backend Phase 4 — Support (full spec)
      { moduleId: "tickets", actions: ["view", "create", "edit", "assign", "transition", "resolve", "close", "reopen", "archive", "restore", "merge", "bulk_actions", "reply", "escalate", "view_internal_notes", "add_internal_notes", "view_restricted_notes", "view_audit_history"] },
      { moduleId: "support_inboxes", actions: ["view", "configure"] },
      { moduleId: "support_queues", actions: ["view", "configure"] },
      { moduleId: "support_sla", actions: ["view", "configure"] },
      { moduleId: "support_entitlements", actions: ["view", "configure"] },
      { moduleId: "knowledge_base", actions: ["view", "create", "review", "publish", "archive"] },
      { moduleId: "canned_responses", actions: ["view", "configure"] },
      { moduleId: "support_csat", actions: ["view"] },
      { moduleId: "support_reports", actions: ["view"] },
      { moduleId: "support_portal", actions: ["view", "configure"] },
      { moduleId: "projects", actions: ["view", "create", "edit", "assign"] },
      { moduleId: "tasks", actions: ["view", "create", "edit", "assign"] },
      // Backend Phase 6 — Finance
      { moduleId: "invoices", actions: ["view", "create", "edit", "approve", "issue", "cancel", "credit"] },
      { moduleId: "payments", actions: ["view", "create"] },
      { moduleId: "expenses", actions: ["view", "create", "approve", "reject"] },
      { moduleId: "recurring_invoices", actions: ["view", "create", "edit"] },
    ],
  },
  {
    key: "team_leader", name: "Department Manager", defaultScope: "Department", purpose: "Manages employees and records within one department.",
    permissionGrants: [
      { moduleId: "members", actions: ["view"] },
      // Department-scoped — the actual department filter is applied by
      // the controller using this role's defaultScope, not by the grant
      // itself (permissionGrants only ever says WHICH actions, never
      // WHICH records; scope is a separate dimension on the Role).
      { moduleId: "leads", actions: ["view", "create", "edit", "assign", "archive"] },
      { moduleId: "contacts", actions: ["view", "create", "edit", "assign", "archive"] },
      { moduleId: "companies", actions: ["view", "create", "edit", "assign", "archive"] },
      { moduleId: "activities", actions: ["view", "create", "edit", "assign", "archive", "restore"] },
      { moduleId: "notes", actions: ["view", "create", "edit"] },
      { moduleId: "tags", actions: ["view", "edit"] },
      // Sales Manager-equivalent: full deal lifecycle within their
      // department, no override_pricing/approve (separation of duties
      // keeps Quote approval with Organization Administrator+), no
      // Pipeline structural changes (create/archive) or Contract
      // activation/termination.
      { moduleId: "pipeline", actions: ["view", "edit", "reorder"] },
      { moduleId: "deals", actions: ["view", "create", "edit", "assign", "transition", "close", "reopen", "archive"] },
      { moduleId: "products_services", actions: ["view"] },
      { moduleId: "price_books", actions: ["view"] },
      { moduleId: "quotes", actions: ["view", "create", "edit", "submit", "accept", "cancel"] },
      { moduleId: "orders", actions: ["view", "create", "edit", "confirm", "cancel"] },
      { moduleId: "contracts", actions: ["view", "create", "edit"] },
      { moduleId: "sales_reports", actions: ["view"] },
      // Support manager-equivalent: runs queues, reviews and publishes KB articles.
      { moduleId: "tickets", actions: ["view", "create", "edit", "assign", "transition", "resolve", "close", "reopen", "archive", "restore", "merge", "bulk_actions", "reply", "escalate", "view_internal_notes", "add_internal_notes", "view_restricted_notes"] },
      { moduleId: "support_inboxes", actions: ["view"] },
      { moduleId: "support_queues", actions: ["view", "configure"] },
      { moduleId: "support_sla", actions: ["view"] },
      { moduleId: "support_entitlements", actions: ["view"] },
      { moduleId: "knowledge_base", actions: ["view", "create", "review", "publish"] },
      { moduleId: "canned_responses", actions: ["view", "configure"] },
      { moduleId: "support_csat", actions: ["view"] },
      { moduleId: "support_reports", actions: ["view"] },
      { moduleId: "support_portal", actions: ["view"] },
      // Project manager-equivalent: runs projects and hands out tasks.
      { moduleId: "projects", actions: ["view", "create", "edit", "assign"] },
      { moduleId: "tasks", actions: ["view", "create", "edit", "assign"] },
      // Finance: prepares draft invoices and reviews the department's
      // expenses; approving, sending and crediting invoices stays with admins.
      { moduleId: "invoices", actions: ["view", "create", "edit"] },
      { moduleId: "payments", actions: ["view"] },
      { moduleId: "expenses", actions: ["view", "create", "approve", "reject"] },
      { moduleId: "recurring_invoices", actions: ["view"] },
    ],
  },
  {
    key: "checker", name: "Auditor / Checker", defaultScope: "Organization", purpose: "Performs independent review and compliance checking.",
    permissionGrants: [
      { moduleId: "organizations", actions: ["view"] },
      { moduleId: "members", actions: ["view"] },
      { moduleId: "invitations", actions: ["view"] },
      { moduleId: "invite_links", actions: ["view"] },
      { moduleId: "sessions", actions: ["view"] },
      { moduleId: "audit_events", actions: ["view"] },
      // Read-only by design — no grant below ever includes create/edit/
      // assign/archive/restore/convert/merge/bulk_actions.
      { moduleId: "leads", actions: ["view", "view_audit_history"] },
      { moduleId: "contacts", actions: ["view", "view_audit_history"] },
      { moduleId: "companies", actions: ["view", "view_audit_history"] },
      { moduleId: "activities", actions: ["view", "view_audit_history"] },
      { moduleId: "notes", actions: ["view"] },
      { moduleId: "tags", actions: ["view"] },
      { moduleId: "pipeline", actions: ["view", "view_audit_history"] },
      { moduleId: "deals", actions: ["view", "view_audit_history"] },
      { moduleId: "products_services", actions: ["view"] },
      { moduleId: "price_books", actions: ["view"] },
      { moduleId: "quotes", actions: ["view", "view_audit_history"] },
      { moduleId: "orders", actions: ["view", "view_audit_history"] },
      { moduleId: "contracts", actions: ["view", "view_audit_history"] },
      { moduleId: "sales_reports", actions: ["view", "view_forecast"] },
      { moduleId: "tickets", actions: ["view", "view_internal_notes", "view_restricted_notes", "view_audit_history"] },
      { moduleId: "support_inboxes", actions: ["view"] },
      { moduleId: "support_queues", actions: ["view"] },
      { moduleId: "support_sla", actions: ["view"] },
      { moduleId: "support_entitlements", actions: ["view"] },
      { moduleId: "knowledge_base", actions: ["view"] },
      { moduleId: "canned_responses", actions: ["view"] },
      { moduleId: "support_csat", actions: ["view"] },
      { moduleId: "support_reports", actions: ["view"] },
      { moduleId: "support_portal", actions: ["view"] },
      { moduleId: "projects", actions: ["view", "view_audit_history"] },
      { moduleId: "tasks", actions: ["view", "view_audit_history"] },
      { moduleId: "invoices", actions: ["view", "view_audit_history"] },
      { moduleId: "payments", actions: ["view"] },
      { moduleId: "expenses", actions: ["view", "view_audit_history"] },
      { moduleId: "recurring_invoices", actions: ["view"] },
    ],
  },
  {
    key: "user", name: "Standard Employee", defaultScope: "Own", purpose: "Provides ordinary employee self-service.",
    permissionGrants: [
      // Own/Assigned-scoped (see defaultScope above) — a Sales
      // Representative sees and edits only records they own, are
      // assigned to, or are explicitly shared with, per the spec.
      { moduleId: "leads", actions: ["view", "create", "edit"] },
      { moduleId: "contacts", actions: ["view", "create", "edit"] },
      { moduleId: "companies", actions: ["view", "create", "edit"] },
      { moduleId: "activities", actions: ["view", "create", "edit"] },
      { moduleId: "notes", actions: ["view", "create", "edit"] },
      { moduleId: "tags", actions: ["view", "edit"] },
      // Sales Representative-equivalent: may create/edit/submit their own
      // Deals and Quotes, but must not approve a Quote (separation of
      // duties is enforced in code regardless, but this role also never
      // gets the "approve" grant at all) and must not confirm Orders or
      // activate/terminate Contracts.
      { moduleId: "pipeline", actions: ["view"] },
      { moduleId: "deals", actions: ["view", "create", "edit", "transition", "close", "reopen"] },
      { moduleId: "products_services", actions: ["view"] },
      { moduleId: "price_books", actions: ["view"] },
      { moduleId: "quotes", actions: ["view", "create", "edit", "submit", "accept", "cancel"] },
      { moduleId: "orders", actions: ["view", "create", "edit"] },
      { moduleId: "contracts", actions: ["view"] },
      { moduleId: "sales_reports", actions: ["view"] },
      // Agent-equivalent: works tickets they created, are assigned, follow or see through a queue.
      { moduleId: "tickets", actions: ["view", "create", "edit", "transition", "resolve", "close", "reply", "escalate", "view_internal_notes", "add_internal_notes"] },
      { moduleId: "support_inboxes", actions: ["view"] },
      { moduleId: "support_queues", actions: ["view"] },
      { moduleId: "knowledge_base", actions: ["view", "create"] },
      { moduleId: "canned_responses", actions: ["view"] },
      // Team member-equivalent: sees projects they're part of, works their
      // own tasks (status, comments, time) and can add tasks there; can't
      // start projects or reassign work.
      { moduleId: "projects", actions: ["view"] },
      { moduleId: "tasks", actions: ["view", "create", "edit"] },
      // Submits and tracks their own expenses; no access to invoices.
      { moduleId: "expenses", actions: ["view", "create"] },
    ],
  },
];

// Creates any missing built-in role and refreshes the grants of existing
// ones (matched by key). Never touches custom roles or role assignments.
export async function upsertBuiltInRoles(prisma) {
  const roles = {};
  for (const def of BUILT_IN_ROLES) {
    roles[def.key] = await prisma.role.upsert({
      where: { key: def.key },
      update: { permissionGrants: def.permissionGrants },
      create: { ...def, type: "Built-in", isBuiltIn: true, allowedScopes: [def.defaultScope], status: "Active" },
    });
  }
  return roles;
}
