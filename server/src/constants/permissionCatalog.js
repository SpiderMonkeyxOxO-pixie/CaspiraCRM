// Mirrors the shape of the frontend's src/Helpers/mockRbacData.js catalog so
// the real /admin/permissions/catalog endpoint can eventually replace the
// mock one without the frontend changing how it reads the response.
export const ACTIONS = [
  "view", "view_own", "view_team", "view_department", "view_organization",
  "create", "edit", "assign", "change_owner", "change_status", "archive", "restore",
  "delete_permanently", "import", "export", "bulk_actions", "approve", "reject",
  "request_changes", "configure", "view_sensitive_fields", "view_financial_fields",
  "view_hr_fields", "view_audit_history", "manage_files", "manage_comments", "manage_automations",
  // Backend Phase 2 — CRM Core Data Persistence. Two genuinely new verbs
  // the generic list above doesn't cover: converting a Lead and merging
  // duplicate Contacts/Companies are distinct, higher-trust capabilities
  // from ordinary "edit."
  "convert", "merge",
  // Backend Phase 3 — Sales Pipeline, Deals, Catalog, Quotes, Orders,
  // Contracts. Each is a distinct lifecycle action with its own
  // authorization/audit meaning, not covered by the generic CRUD verbs
  // above (e.g. "transition" moves a Deal between Stages under strict
  // rules; plain "edit" never changes Stage).
  "transition", "close", "reopen", "submit", "issue", "accept", "cancel",
  "override_pricing", "activate", "renew", "terminate", "manage_obligations",
  "reorder", "view_forecast", "confirm", "fulfill",
  // Backend Phase 6 — Finance. Issuing a credit note reduces what a
  // customer owes, so it's its own grant rather than part of "edit".
  "credit",
  // Backend Phase 4 (full spec) — Support. Public replies, internal and
  // restricted notes are separate grants so note visibility is enforced by
  // permission, not by the UI; KB review/publish enable separation of duties.
  "reply", "resolve", "escalate", "view_internal_notes", "add_internal_notes", "view_restricted_notes",
  "review", "publish",
  // Backend Phase 5 (full spec) — Projects.
  "manage_members", "override_progress", "correct", "apply",
  // Backend Phase 6 (full spec) — Finance. Posting to the ledger, reversing,
  // allocating payments and recording reimbursements are separate,
  // higher-trust steps; override_controls is the audited emergency
  // override of separation of duties.
  "post", "reverse", "allocate", "reimburse", "override_controls", "approve_exception",
  // Backend Phase 8 — Integrations. A personal (user) connection and an
  // organization-wide one are different grants; running or previewing a
  // sync and rotating credentials are separate, higher-trust steps.
  "create_user", "create_organization", "reauthorize", "disconnect", "preview", "execute", "rotate",
  // Backend Phase 9 — AI. Using AI features and proposing an AI action are
  // their own grants; confirming and approving reuse "confirm"/"approve".
  "use", "propose",
];

export const SCOPES = ["Own", "Assigned", "Team", "Department", "Organization", "Customer Account", "System-wide"];

export const MODULE_GROUPS = [
  { id: "crm", label: "CRM", modules: ["leads", "contacts", "companies", "activities", "deals", "pipeline", "notes", "tags"] },
  { id: "sales", label: "Sales", modules: ["products_services", "price_books", "quotes", "orders", "contracts", "sales_reports"] },
  { id: "marketing", label: "Marketing", modules: ["campaigns", "segments", "forms", "templates"] },
  {
    id: "support", label: "Support",
    modules: ["tickets", "support_inboxes", "support_queues", "support_sla", "support_entitlements", "knowledge_base", "canned_responses", "support_csat", "support_reports", "support_portal"],
  },
  {
    id: "projects", label: "Projects",
    modules: ["projects", "tasks", "project_portfolios", "project_templates", "project_planning", "project_time", "deliverables", "project_risks", "project_issues", "change_requests", "project_baselines", "project_reports"],
  },
  {
    id: "finance", label: "Finance",
    modules: ["invoices", "payments", "expenses", "recurring_invoices", "credit_notes", "finance_configuration", "fiscal_periods", "ledger_accounts", "journals", "vendors", "bills", "financial_accounts", "reconciliation", "budgets", "finance_reports", "finance_overrides"],
  },
  {
    id: "integrations", label: "Integrations",
    modules: ["integration_catalog", "integration_connections", "integration_scopes", "integration_policies", "integration_sync", "integration_conflicts", "integration_webhooks", "integration_outbound_webhooks", "integration_logs", "integration_credentials", "integration_audit"],
  },
  {
    id: "ai", label: "AI",
    modules: ["ai_providers", "ai_models", "ai_routing", "ai_policies", "ai_usage", "ai_budgets", "ai_features", "ai_actions", "ai_evaluations", "ai_audit"],
  },
  { id: "administration", label: "Administration", modules: ["users", "roles", "permissions"] },
  // Backend Phase 1 — organizations, membership, invitations and platform
  // security surfaces. Reuses the same generic ACTIONS vocabulary above
  // (view/create/edit/...) rather than inventing a second one.
  { id: "platform", label: "Platform", modules: ["organizations", "members", "invitations", "invite_links", "sessions", "audit_events"] },
];

export const APPROVAL_TYPES = ["quote", "discount", "expense", "leave", "invoice", "contract", "access_request"];
