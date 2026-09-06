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
];

export const SCOPES = ["Own", "Assigned", "Team", "Department", "Organization", "Customer Account", "System-wide"];

export const MODULE_GROUPS = [
  { id: "crm", label: "CRM", modules: ["leads", "contacts", "companies", "activities", "deals", "pipeline", "notes", "tags"] },
  { id: "sales", label: "Sales", modules: ["products_services", "price_books", "quotes", "orders", "contracts"] },
  { id: "marketing", label: "Marketing", modules: ["campaigns", "segments", "forms", "templates"] },
  { id: "support", label: "Support", modules: ["tickets"] },
  { id: "projects", label: "Projects", modules: ["projects", "tasks"] },
  { id: "finance", label: "Finance", modules: ["invoices", "payments", "expenses", "recurring_invoices"] },
  { id: "administration", label: "Administration", modules: ["users", "roles", "permissions"] },
  // Backend Phase 1 — organizations, membership, invitations and platform
  // security surfaces. Reuses the same generic ACTIONS vocabulary above
  // (view/create/edit/...) rather than inventing a second one.
  { id: "platform", label: "Platform", modules: ["organizations", "members", "invitations", "invite_links", "sessions", "audit_events"] },
];

export const APPROVAL_TYPES = ["quote", "discount", "expense", "leave", "invoice", "contract", "access_request"];
