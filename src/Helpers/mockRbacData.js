// Centralized, typed RBAC fixtures + business logic for the frontend-only
// Role-Based Access Control preview (/admin/roles, /admin/roles/:id,
// /admin/permissions). This models roles, scopes, a permission catalog,
// sensitive-field visibility and separation-of-duties rules entirely in the
// frontend mock layer — it previews what a future backend authorization
// system would enforce, it does not itself enforce anything server-side.
import { faker } from "@faker-js/faker";
import { ROLE_LABELS, ROLE_TO_TEMPLATE_ID } from "../utils/roleLabels";

faker.seed(4242);

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------
export const SCOPES = [
  "Own",
  "Assigned",
  "Team",
  "Department",
  "Organization",
  "Customer Account",
  "System-wide",
];

export const SCOPE_DESCRIPTIONS = {
  Own: "Records created by, owned by or personally assigned to the user.",
  Assigned: "Records where the user is explicitly assigned as a participant, reviewer or responsible person.",
  Team: "Records owned by members of the user's team.",
  Department: "Records belonging to the user's department.",
  Organization: "All permitted records within one organization.",
  "Customer Account": "Only records belonging to one external Company.",
  "System-wide": "All organizations and system configuration. Reserved for System Owner.",
};

// ---------------------------------------------------------------------------
// Permission action catalog
// ---------------------------------------------------------------------------
export const ACTIONS = {
  VIEW: "view",
  VIEW_OWN: "view_own",
  VIEW_TEAM: "view_team",
  VIEW_DEPARTMENT: "view_department",
  VIEW_ORGANIZATION: "view_organization",
  CREATE: "create",
  EDIT: "edit",
  ASSIGN: "assign",
  CHANGE_OWNER: "change_owner",
  CHANGE_STATUS: "change_status",
  ARCHIVE: "archive",
  RESTORE: "restore",
  DELETE_PERMANENTLY: "delete_permanently",
  IMPORT: "import",
  EXPORT: "export",
  BULK_ACTIONS: "bulk_actions",
  APPROVE: "approve",
  REJECT: "reject",
  REQUEST_CHANGES: "request_changes",
  CONFIGURE: "configure",
  VIEW_SENSITIVE_FIELDS: "view_sensitive_fields",
  VIEW_FINANCIAL_FIELDS: "view_financial_fields",
  VIEW_HR_FIELDS: "view_hr_fields",
  VIEW_AUDIT_HISTORY: "view_audit_history",
  MANAGE_FILES: "manage_files",
  MANAGE_COMMENTS: "manage_comments",
  MANAGE_AUTOMATIONS: "manage_automations",
  // Access Management (Members / Invitations / Invite Links) — added
  // alongside the generic CRUD verbs above rather than overloading them,
  // since "inviting" a member or "rotating" a link has no equivalent among
  // the existing 27 actions.
  INVITE: "invite",
  RESEND: "resend",
  REVOKE: "revoke",
  ASSIGN_ROLE: "assign_role",
  CHANGE_ROLE: "change_role",
  ASSIGN_DEPARTMENT: "assign_department",
  ASSIGN_TEAM: "assign_team",
  SUSPEND: "suspend",
  REACTIVATE: "reactivate",
  REMOVE: "remove",
  ROTATE: "rotate",
  CONFIGURE_DOMAIN: "configure_domain",
  CONFIGURE_ROLE: "configure_role",
  CONFIGURE_APPROVAL: "configure_approval",
  VIEW_USAGE: "view_usage",
  COPY_LINK: "copy_link",
  // Integration Center — one new module (integration_center) covering
  // marketplace/connections/mappings/sync/webhooks/activity/policies as
  // views/sub-resources of one connection-centric feature, not separate
  // record kinds, so these are additional verbs rather than a new set of
  // record-kind action lists.
  VIEW_MARKETPLACE: "view_marketplace",
  PAUSE: "pause",
  DISCONNECT: "disconnect",
  MANAGE_CAPABILITIES: "manage_capabilities",
  VIEW_MAPPINGS: "view_mappings",
  MANAGE_MAPPINGS: "manage_mappings",
  VIEW_SYNC: "view_sync",
  RUN_SYNC: "run_sync",
  RETRY: "retry",
  VIEW_WEBHOOKS: "view_webhooks",
  MANAGE_WEBHOOKS: "manage_webhooks",
  VIEW_ACTIVITY: "view_activity",
  MANAGE_POLICIES: "manage_policies",
  // Sales & Marketing Integrations (Phase 2) — ten distinct resources, each
  // independently routed with its own object model (Lead Capture, Audience
  // Sync, Suppression, Email Delivery, Attribution, Forms Integrations),
  // unlike Phase 1's single connection-centric integration_management kind.
  // Reuses VIEW/REJECT/CONFIGURE/REMOVE/RETRY above; MANAGE and PROCESS are
  // new since no generic "manage a resource" or "process an inbound record"
  // verb existed yet.
  MANAGE: "manage",
  PROCESS: "process",
  PREVIEW: "preview",
  // Customer Support and Communication Integrations (Phase 3) — reuses
  // VIEW/MANAGE/PROCESS/ASSIGN/RETRY above; these seven are new since no
  // existing verb captures "preview a public reply", "preview an internal
  // note", "close a ticket with a required reason", "link/create/merge a
  // customer identity" or "resolve a synchronization conflict".
  REPLY_PREVIEW: "reply_preview",
  INTERNAL_NOTE: "internal_note",
  CLOSE: "close",
  LINK: "link",
  CREATE_CONTACT: "create_contact",
  MERGE: "merge",
  RESOLVE: "resolve",
  // Projects and Development Integrations (Phase 4) — reuses VIEW/MANAGE/
  // LINK/RETRY/RESOLVE/RUN_SYNC above; these three are new since no
  // existing verb captures "unlink an external Project with a required
  // reason" (distinct from Phase 1's DISCONNECT, which detaches a whole
  // provider connection, not one linked record), "create a preview-only
  // external record" (an external Project or development issue — distinct
  // from Phase 2's PROCESS, which acts on an inbound record rather than
  // creating a new outbound one), or "manage a work item's own preview
  // state" (distinct from the org-wide MANAGE already used for mappings).
  UNLINK: "unlink",
  CREATE_PREVIEW: "create_preview",
  MANAGE_PREVIEW: "manage_preview",
  // Commerce and Finance Integrations (Phase 5) — reuses VIEW/MANAGE/LINK/
  // RESOLVE above; these six are new since no existing verb captures
  // "preview-synchronize an Order" (distinct from Phase 4's RUN_SYNC, which
  // is scoped to that phase's own project_sync module), "map a Product or
  // Customer to a provider record" (distinct from Phase 4's LINK, which
  // links one external Project to one CRM Project — mapping here is a
  // row-level table action, repeatable per record), "request a financial
  // action for someone else to approve" and "approve one" as two distinct
  // separation-of-duties steps (neither existing APPROVE/REJECT nor
  // CREATE_PREVIEW capture the two-step requester/approver split), "process
  // a reconciliation match" (distinct from RUN_SYNC/RETRY, which apply to a
  // whole connection rather than one bank-transaction match), or "override
  // a financial mapping/reconciliation decision" (a stronger, audited action
  // than plain MANAGE — never granted without APPROVE_PREVIEW-equivalent
  // trust).
  SYNC_PREVIEW: "sync_preview",
  MAP: "map",
  REQUEST_PREVIEW: "request_preview",
  APPROVE_PREVIEW: "approve_preview",
  PROCESS_PREVIEW: "process_preview",
  OVERRIDE: "override",
  // Documents, Storage and Electronic Signature Integrations (Phase 6) —
  // reuses VIEW/MANAGE/LINK/UNLINK/CREATE_PREVIEW/MANAGE_PREVIEW/RESOLVE
  // above; these seven are new since no existing verb captures "upload a
  // file preview" (a one-way creation distinct from CREATE_PREVIEW's
  // external-record semantics in Phase 4), "download availability" (a
  // classification-gated indicator, never a real download, distinct from
  // plain VIEW), "create a preview sharing link" (distinct from Phase 5's
  // SHARE-adjacent verbs, none of which exist — sharing here is storage-
  // specific), "delete a file preview" (distinct from Phase 1's DISCONNECT
  // and every prior UNLINK, since this removes the file reference itself,
  // not a connection or association), or the three-step signature send/
  // remind/void lifecycle (each a distinct, separately-audited action no
  // combination of APPROVE_PREVIEW/REQUEST_PREVIEW/RUN_SYNC captures).
  UPLOAD_PREVIEW: "upload_preview",
  DOWNLOAD: "download",
  SHARE_PREVIEW: "share_preview",
  DELETE_PREVIEW: "delete_preview",
  SEND_PREVIEW: "send_preview",
  REMIND_PREVIEW: "remind_preview",
  VOID_PREVIEW: "void_preview",
  // AI Provider and Intelligence Integrations (Phase 7, final) — reuses
  // VIEW/MANAGE/CREATE_PREVIEW/RESOLVE/APPROVE_PREVIEW above; these three
  // are new since no existing verb captures "update an already-configured
  // preview connection's permitted capabilities/modules" (distinct from
  // CREATE_PREVIEW, which only covers first-time creation), "pause a
  // provider preview connection" (distinct from Phase 6's file-level
  // UNLINK/DELETE_PREVIEW — pausing a connection is reversible and doesn't
  // remove anything), or "run a fixture evaluation scenario" (distinct from
  // Phase 4's RUN_SYNC, which is a data-synchronization action, not a
  // deterministic-fixture test run).
  UPDATE_PREVIEW: "update_preview",
  PAUSE_PREVIEW: "pause_preview",
  RUN_PREVIEW: "run_preview",
};

export const ACTION_LABELS = {
  view: "View",
  view_own: "View Own",
  view_team: "View Team",
  view_department: "View Department",
  view_organization: "View Organization",
  create: "Create",
  edit: "Edit",
  assign: "Assign",
  change_owner: "Change Owner",
  change_status: "Change Status",
  archive: "Archive",
  restore: "Restore",
  delete_permanently: "Delete Permanently",
  import: "Import",
  export: "Export",
  bulk_actions: "Bulk Actions",
  approve: "Approve",
  reject: "Reject",
  request_changes: "Request Changes",
  configure: "Configure",
  view_sensitive_fields: "View Sensitive Fields",
  view_financial_fields: "View Financial Fields",
  view_hr_fields: "View HR Fields",
  view_audit_history: "View Audit History",
  manage_files: "Manage Files",
  manage_comments: "Manage Comments",
  manage_automations: "Manage Automations",
  invite: "Invite",
  resend: "Resend",
  revoke: "Revoke",
  assign_role: "Assign Role",
  change_role: "Change Role",
  assign_department: "Assign Department",
  assign_team: "Assign Team",
  suspend: "Suspend",
  reactivate: "Reactivate",
  remove: "Remove",
  rotate: "Rotate",
  configure_domain: "Configure Domain Restriction",
  configure_role: "Configure Default Role",
  configure_approval: "Configure Approval Requirement",
  view_usage: "View Usage",
  copy_link: "Copy Link",
  view_marketplace: "View Marketplace",
  pause: "Pause",
  disconnect: "Disconnect",
  manage_capabilities: "Manage Capabilities",
  view_mappings: "View Data Mappings",
  manage_mappings: "Manage Data Mappings",
  view_sync: "View Synchronization",
  run_sync: "Run Synchronization",
  retry: "Retry",
  view_webhooks: "View Webhooks",
  manage_webhooks: "Manage Webhooks",
  view_activity: "View Activity",
  manage_policies: "Manage Integration Policies",
  manage: "Manage",
  process: "Process",
  preview: "Preview",
  reply_preview: "Reply Preview",
  internal_note: "Internal Note",
  close: "Close",
  link: "Link",
  create_contact: "Create Contact",
  merge: "Merge",
  resolve: "Resolve",
  unlink: "Unlink",
  create_preview: "Create Preview",
  manage_preview: "Manage Preview",
  sync_preview: "Sync Preview",
  map: "Map",
  request_preview: "Request Preview",
  approve_preview: "Approve Preview",
  process_preview: "Process Preview",
  override: "Override",
  upload_preview: "Upload Preview",
  download: "Download",
  share_preview: "Share Preview",
  delete_preview: "Delete Preview",
  send_preview: "Send Preview",
  remind_preview: "Remind Preview",
  void_preview: "Void Preview",
  update_preview: "Update Preview",
  pause_preview: "Pause Preview",
  run_preview: "Run Preview",
};

// Actions that are disabled by default for ordinary (non-System-Owner) roles
// unless a template explicitly grants them.
export const DANGEROUS_ACTIONS = [ACTIONS.DELETE_PERMANENTLY];

const A = ACTIONS;
const BASE_RECORD = [
  A.VIEW, A.VIEW_OWN, A.VIEW_TEAM, A.VIEW_DEPARTMENT, A.VIEW_ORGANIZATION,
  A.CREATE, A.EDIT, A.ASSIGN, A.CHANGE_OWNER, A.CHANGE_STATUS,
  A.ARCHIVE, A.RESTORE, A.DELETE_PERMANENTLY, A.IMPORT, A.EXPORT, A.BULK_ACTIONS,
];

// Module "kinds" describe which actions are even applicable, so the Role
// Builder never shows a checkbox for something a module can't do (e.g.
// "Approve" on Calendar, or "Import" on Audit Logs).
const ACTIONS_BY_KIND = {
  light: [A.VIEW],
  light_config: [A.VIEW, A.CONFIGURE],
  record: BASE_RECORD,
  record_approval: [...BASE_RECORD, A.APPROVE, A.REJECT, A.REQUEST_CHANGES],
  record_financial: [...BASE_RECORD, A.VIEW_FINANCIAL_FIELDS],
  record_financial_approval: [...BASE_RECORD, A.APPROVE, A.REJECT, A.REQUEST_CHANGES, A.VIEW_FINANCIAL_FIELDS],
  record_hr: [...BASE_RECORD, A.VIEW_HR_FIELDS, A.VIEW_SENSITIVE_FIELDS],
  record_hr_approval: [...BASE_RECORD, A.APPROVE, A.REJECT, A.REQUEST_CHANGES, A.VIEW_HR_FIELDS, A.VIEW_SENSITIVE_FIELDS],
  record_sensitive: [...BASE_RECORD, A.VIEW_SENSITIVE_FIELDS],
  record_files: [...BASE_RECORD, A.MANAGE_FILES],
  record_comments: [...BASE_RECORD, A.MANAGE_COMMENTS, A.MANAGE_FILES],
  automation: [A.VIEW, A.CREATE, A.EDIT, A.ARCHIVE, A.EXPORT, A.MANAGE_AUTOMATIONS, A.CONFIGURE],
  report: [A.VIEW, A.VIEW_OWN, A.VIEW_TEAM, A.VIEW_DEPARTMENT, A.VIEW_ORGANIZATION, A.EXPORT],
  report_financial: [A.VIEW, A.VIEW_OWN, A.VIEW_TEAM, A.VIEW_DEPARTMENT, A.VIEW_ORGANIZATION, A.EXPORT, A.VIEW_FINANCIAL_FIELDS],
  report_hr: [A.VIEW, A.VIEW_OWN, A.VIEW_TEAM, A.VIEW_DEPARTMENT, A.VIEW_ORGANIZATION, A.EXPORT, A.VIEW_HR_FIELDS],
  log: [A.VIEW, A.EXPORT, A.VIEW_AUDIT_HISTORY],
  config: [A.VIEW, A.CONFIGURE, A.VIEW_AUDIT_HISTORY],
  // Access Management kinds — deliberately their own action lists rather
  // than reusing BASE_RECORD, since "invite/suspend/remove a member" and
  // "rotate/revoke a link" aren't meaningfully "create/edit/archive".
  record_membership: [
    A.VIEW, A.VIEW_ORGANIZATION, A.CREATE, A.INVITE, A.RESEND, A.REVOKE,
    A.ASSIGN_ROLE, A.CHANGE_ROLE, A.ASSIGN_DEPARTMENT, A.ASSIGN_TEAM,
    A.SUSPEND, A.REACTIVATE, A.REMOVE, A.EXPORT, A.VIEW_AUDIT_HISTORY,
  ],
  invitation_management: [A.VIEW, A.CREATE, A.RESEND, A.REVOKE, A.COPY_LINK, A.VIEW_AUDIT_HISTORY, A.EXPORT],
  link_management: [
    A.VIEW, A.CREATE, A.ROTATE, A.REVOKE,
    A.CONFIGURE_DOMAIN, A.CONFIGURE_ROLE, A.CONFIGURE_APPROVAL, A.VIEW_USAGE, A.EXPORT,
  ],
  // Integration Center — one module, one kind. Marketplace/connections/
  // mappings/sync/webhooks/activity/policies are views and sub-resources of
  // one connection-centric feature (not independently-listed entities the
  // way Members/Invitations/Invite Links are), so a single action set lets
  // one role-template grant express the whole capability profile cleanly
  // (e.g. Auditor: view everything, manage nothing).
  integration_management: [
    A.VIEW, A.VIEW_MARKETPLACE, A.CREATE, A.EDIT, A.PAUSE, A.DISCONNECT,
    A.MANAGE_CAPABILITIES, A.VIEW_MAPPINGS, A.MANAGE_MAPPINGS, A.VIEW_SYNC,
    A.RUN_SYNC, A.RETRY, A.VIEW_WEBHOOKS, A.MANAGE_WEBHOOKS, A.VIEW_ACTIVITY,
    A.MANAGE_POLICIES,
  ],
  // Sales & Marketing Integrations (Phase 2) — one kind per distinct
  // resource/route, mirroring the Access Management split (Members/
  // Invitations/Invite Links/Access Audit) rather than Phase 1's single
  // connection-centric kind, since each of these has its own page and
  // object model.
  view_manage: [A.VIEW, A.MANAGE],
  lead_capture_management: [A.VIEW, A.PROCESS, A.REJECT],
  lead_routing_management: [A.MANAGE],
  audience_sync_management: [A.VIEW, A.MANAGE, A.PREVIEW],
  suppression_management: [A.VIEW, A.REMOVE],
  email_delivery_management: [A.VIEW, A.RETRY],
  attribution_management: [A.VIEW, A.CONFIGURE],
  conversion_mapping_management: [A.MANAGE],
  // Customer Support and Communication Integrations (Phase 3) — one kind per
  // distinct resource/route, same rationale as Phase 2. Reuses "view_manage"
  // (support_integrations/support_channels/support_sla/support_calls) and
  // "light" (support_recordings/support_transcripts — single VIEW action,
  // same as dashboard/my_work) where the shape already matches.
  support_inbox_management: [A.VIEW, A.REPLY_PREVIEW, A.INTERNAL_NOTE],
  support_tickets_management: [A.VIEW, A.PROCESS, A.ASSIGN, A.CLOSE],
  support_identity_management: [A.VIEW, A.LINK, A.CREATE_CONTACT, A.MERGE],
  support_queues_management: [A.MANAGE],
  support_agent_mappings_management: [A.MANAGE],
  support_escalations_management: [A.MANAGE],
  support_reviews_management: [A.VIEW, A.REPLY_PREVIEW],
  support_sync_management: [A.RETRY],
  support_conflicts_management: [A.RESOLVE],
  // Projects and Development Integrations (Phase 4) — one kind per distinct
  // resource/route, same rationale as Phase 2/3. Reuses "view_manage"
  // (project_integrations/project_mappings/project_templates/
  // development_integrations) and "light" (repositories/code_reviews/
  // pipelines/deployments/releases/delivery_health — single VIEW action).
  project_connections_management: [A.MANAGE],
  project_sync_management: [A.VIEW, A.RUN_SYNC, A.RETRY],
  project_conflicts_management: [A.RESOLVE],
  external_projects_management: [A.VIEW, A.LINK, A.CREATE_PREVIEW, A.UNLINK],
  external_tasks_management: [A.VIEW, A.MANAGE_PREVIEW],
  development_issues_management: [A.VIEW, A.CREATE_PREVIEW],
  // Commerce and Finance Integrations (Phase 5) — reuses "view_manage" and
  // "light" (single VIEW). commerce_stores/accounting_mappings are
  // manage-only (no separate VIEW), same shape as Phase 4's
  // project_connections; commerce_products/commerce_customers are map-only
  // (a repeatable row-level action, no separate VIEW); refunds and
  // reconciliation each need their own multi-action kind for the
  // separation-of-duties request/approve and process/override split.
  commerce_stores_management: [A.MANAGE],
  commerce_products_management: [A.MAP],
  commerce_customers_management: [A.MAP],
  commerce_orders_management: [A.VIEW, A.SYNC_PREVIEW],
  accounting_mappings_management: [A.MANAGE],
  accounting_invoice_sync_management: [A.SYNC_PREVIEW],
  subscriptions_management: [A.VIEW, A.MANAGE_PREVIEW],
  refunds_management: [A.VIEW, A.REQUEST_PREVIEW, A.APPROVE_PREVIEW],
  reconciliation_management: [A.VIEW, A.PROCESS_PREVIEW, A.OVERRIDE],
  financial_conflicts_management: [A.RESOLVE],
  // Documents, Storage and Electronic Signature Integrations (Phase 6) —
  // reuses "view_manage" and "light" (single VIEW). storage_connections is
  // manage-only (no separate VIEW), same shape as Phase 4's
  // project_connections / Phase 5's commerce_stores. external_files needs
  // its own multi-action kind for the full file lifecycle; file_permissions
  // and signature_workflows each need their own kind for the same reason
  // Phase 5's refunds/reconciliation did.
  storage_connections_management: [A.MANAGE],
  external_files_management: [A.VIEW, A.LINK, A.UNLINK, A.UPLOAD_PREVIEW, A.DOWNLOAD, A.SHARE_PREVIEW, A.DELETE_PREVIEW],
  file_permissions_management: [A.VIEW, A.MANAGE_PREVIEW],
  file_classification_management: [A.VIEW, A.MANAGE],
  signature_workflows_management: [A.VIEW, A.CREATE_PREVIEW, A.SEND_PREVIEW, A.REMIND_PREVIEW, A.VOID_PREVIEW],
  legal_holds_management: [A.VIEW, A.MANAGE],
  document_conflicts_management: [A.RESOLVE],
  // AI Provider and Intelligence Integrations (Phase 7, final) — reuses
  // "view_manage" and "light" (single VIEW). ai_provider_connections is
  // action-only (no separate VIEW — the spec lists only create_preview/
  // update_preview/pause), same shape as every prior phase's connection-
  // management module; ai_budgets and ai_actions are similarly action-only
  // per the spec's own literal permission-string list.
  ai_provider_connections_management: [A.CREATE_PREVIEW, A.UPDATE_PREVIEW, A.PAUSE_PREVIEW],
  ai_redaction_management: [A.VIEW],
  ai_evaluations_management: [A.VIEW, A.RUN_PREVIEW],
  ai_budgets_management: [A.MANAGE],
  ai_actions_management: [A.APPROVE_PREVIEW],
};

export function getApplicableActions(moduleOrKind) {
  const kind = typeof moduleOrKind === "string" ? moduleOrKind : moduleOrKind.kind;
  return ACTIONS_BY_KIND[kind] || [A.VIEW];
}

// ---------------------------------------------------------------------------
// Module catalog (grouped)
// ---------------------------------------------------------------------------
export const MODULE_GROUPS = [
  {
    id: "core", label: "Core", navSection: null,
    modules: [
      { id: "dashboard", label: "Dashboard", kind: "light" },
      { id: "my_work", label: "My Work", kind: "light" },
      { id: "tasks_core", label: "Tasks", kind: "record" },
      { id: "calendar", label: "Calendar", kind: "light_config" },
      { id: "notifications", label: "Notifications", kind: "light" },
      { id: "search", label: "Search", kind: "light" },
    ],
  },
  {
    id: "crm", label: "CRM", navSection: { label: "CRM", path: "/crm/dashboard" },
    modules: [
      { id: "crm_dashboard", label: "CRM Dashboard", kind: "light" },
      { id: "leads", label: "Leads", kind: "record_sensitive" },
      { id: "contacts", label: "Contacts", kind: "record_sensitive" },
      { id: "companies", label: "Companies", kind: "record_sensitive" },
      { id: "activities", label: "Activities", kind: "record_comments" },
      { id: "deals", label: "Deals", kind: "record_financial_approval" },
      { id: "pipeline", label: "Pipeline", kind: "record" },
      { id: "crm_import", label: "CRM Import", kind: "light_config" },
      { id: "duplicate_management", label: "Duplicate Management", kind: "config" },
    ],
  },
  {
    id: "sales", label: "Sales", navSection: { label: "Sales", path: "/sales/dashboard" },
    modules: [
      { id: "products_services", label: "Products and Services", kind: "record_financial" },
      { id: "price_books", label: "Price Books", kind: "record_financial" },
      { id: "quotes", label: "Quotes", kind: "record_financial_approval" },
      { id: "orders", label: "Orders", kind: "record_financial_approval" },
      { id: "contracts", label: "Contracts", kind: "record_financial_approval" },
      { id: "subscriptions", label: "Subscriptions", kind: "record_financial" },
      { id: "forecasts", label: "Forecasts", kind: "report_financial" },
      { id: "commissions", label: "Commissions", kind: "report_financial" },
    ],
  },
  {
    id: "marketing", label: "Marketing", navSection: { label: "Marketing", path: "/marketing/dashboard" },
    modules: [
      { id: "campaigns", label: "Campaigns", kind: "record" },
      { id: "segments", label: "Segments", kind: "record" },
      { id: "lists", label: "Lists", kind: "record_sensitive" },
      { id: "forms", label: "Forms", kind: "record" },
      { id: "marketing_templates", label: "Templates", kind: "record" },
      { id: "marketing_automation", label: "Marketing Automation", kind: "automation" },
      { id: "marketing_analytics", label: "Marketing Analytics", kind: "report" },
    ],
  },
  {
    id: "support", label: "Support", navSection: { label: "Support", path: "/support/dashboard" },
    modules: [
      { id: "tickets", label: "Tickets", kind: "record_comments" },
      { id: "inbox", label: "Inbox", kind: "record" },
      { id: "queues", label: "Queues", kind: "config" },
      { id: "sla", label: "SLA", kind: "config" },
      { id: "escalations", label: "Escalations", kind: "record_approval" },
      { id: "knowledge_base", label: "Knowledge Base", kind: "record" },
      { id: "feedback", label: "Feedback", kind: "report" },
      { id: "support_reports", label: "Support Reports", kind: "report" },
    ],
  },
  {
    id: "projects", label: "Projects", navSection: { label: "Projects", path: "/projects" },
    modules: [
      { id: "projects", label: "Projects", kind: "record" },
      { id: "project_tasks", label: "Tasks", kind: "record_comments" },
      { id: "milestones", label: "Milestones", kind: "record_approval" },
      { id: "project_files", label: "Files", kind: "record_files" },
      { id: "time_tracking", label: "Time Tracking", kind: "record" },
      { id: "workload", label: "Workload", kind: "report" },
      { id: "project_reports", label: "Project Reports", kind: "report" },
    ],
  },
  {
    id: "finance", label: "Finance", navSection: { label: "Finance", path: "/finance/dashboard" },
    modules: [
      { id: "invoices", label: "Invoices", kind: "record_financial_approval" },
      { id: "payments", label: "Payments", kind: "record_financial_approval" },
      { id: "expenses", label: "Expenses", kind: "record_financial_approval" },
      { id: "credit_notes", label: "Credit Notes", kind: "record_financial_approval" },
      { id: "recurring_invoices", label: "Recurring Invoices", kind: "record_financial" },
      { id: "taxes", label: "Taxes", kind: "config" },
      { id: "currencies", label: "Currencies", kind: "config" },
      { id: "financial_reports", label: "Financial Reports", kind: "report_financial" },
    ],
  },
  {
    id: "people", label: "People", navSection: null,
    modules: [
      { id: "employee_directory", label: "Employee Directory", kind: "record_hr" },
      { id: "departments", label: "Departments", kind: "record" },
      { id: "attendance", label: "Attendance", kind: "record_hr" },
      { id: "punch_records", label: "Punch Records", kind: "record_hr" },
      { id: "shifts", label: "Shifts", kind: "record" },
      { id: "leave", label: "Leave", kind: "record_hr_approval" },
      { id: "performance", label: "Performance", kind: "record_hr" },
      { id: "quotas", label: "Quotas", kind: "config" },
      { id: "recognition", label: "Recognition", kind: "record" },
      { id: "hr_reports", label: "HR Reports", kind: "report_hr" },
    ],
  },
  {
    id: "communications", label: "Communications", navSection: null,
    modules: [
      { id: "announcements", label: "Announcements", kind: "record" },
      { id: "internal_mail", label: "Internal Mail", kind: "record" },
      { id: "comms_templates", label: "Templates", kind: "record" },
    ],
  },
  {
    id: "documents", label: "Documents", navSection: null,
    modules: [
      { id: "storage", label: "Storage", kind: "record_files" },
      { id: "shared_documents", label: "Shared Documents", kind: "record_files" },
      { id: "doc_templates", label: "Templates", kind: "record_files" },
      { id: "doc_archive", label: "Archive", kind: "light" },
      { id: "trash", label: "Trash", kind: "light" },
      { id: "office_integration", label: "Office Integration", kind: "light_config" },
    ],
  },
  {
    id: "administration", label: "Administration", navSection: { label: "Settings", path: "/settings" },
    modules: [
      { id: "org_settings", label: "Organization Settings", kind: "config" },
      { id: "users", label: "Users", kind: "record_sensitive" },
      // Access Management — distinct from the generic "Users" module above,
      // which predates any concept of organizations/invitations.
      { id: "members", label: "Members", kind: "record_membership" },
      { id: "invitations", label: "Invitations", kind: "invitation_management" },
      { id: "invite_links", label: "Invite Links", kind: "link_management" },
      { id: "access_audit", label: "Access Audit", kind: "log" },
      { id: "roles", label: "Roles", kind: "config" },
      { id: "permissions", label: "Permissions", kind: "config" },
      { id: "admin_teams", label: "Teams", kind: "config" },
      { id: "admin_departments", label: "Departments", kind: "config" },
      { id: "pipeline_config", label: "Pipelines", kind: "config" },
      { id: "custom_fields", label: "Custom Fields", kind: "config" },
      { id: "statuses", label: "Statuses", kind: "config" },
      { id: "tags", label: "Tags", kind: "config" },
      // Legacy placeholder — superseded by "integration_center" below;
      // kept for backward compatibility, do not repurpose.
      { id: "integrations", label: "Integrations", kind: "config" },
      // Integration Center — /admin/integrations/* (marketplace, preview
      // connections, data mapping, synchronization, activity, webhooks).
      { id: "integration_center", label: "Integration Center", kind: "integration_management" },
      // Sales & Marketing Integrations (Phase 2) — /admin/integrations/
      // sales-marketing/* (lead capture, audiences, consent & suppression,
      // email delivery, attribution, forms). Ten distinct modules, one per
      // independently-routed resource; see the "view_manage" family of
      // kinds above for the rationale.
      { id: "marketing_integrations", label: "Sales & Marketing Integrations", kind: "view_manage" },
      { id: "lead_capture", label: "Lead Capture", kind: "lead_capture_management" },
      { id: "lead_routing", label: "Lead Routing", kind: "lead_routing_management" },
      { id: "audience_sync", label: "Audience Synchronization", kind: "audience_sync_management" },
      { id: "marketing_consent", label: "Marketing Consent", kind: "view_manage" },
      { id: "suppression", label: "Suppression Management", kind: "suppression_management" },
      { id: "email_delivery", label: "Email Delivery", kind: "email_delivery_management" },
      { id: "attribution", label: "Attribution", kind: "attribution_management" },
      { id: "forms_integrations", label: "Forms Integrations", kind: "view_manage" },
      { id: "conversion_mapping", label: "Conversion Mapping", kind: "conversion_mapping_management" },
      // Customer Support and Communication Integrations (Phase 3) —
      // /admin/integrations/support-communication/* (omnichannel inbox,
      // ticket synchronization preview, telephony, SLA). Fifteen distinct
      // modules, one per independently-routed resource. Distinct from the
      // pre-existing "support" MODULE_GROUP below (tickets/inbox/queues/sla/
      // escalations/knowledge_base/feedback/support_reports) — that group is
      // the internal helpdesk's own RBAC scope, unrelated to this
      // integration-preview layer, and none of these ids collide with it.
      { id: "support_integrations", label: "Support & Communication Integrations", kind: "view_manage" },
      { id: "support_channels", label: "Support Channels", kind: "view_manage" },
      { id: "support_inbox", label: "Support Inbox (Integration Preview)", kind: "support_inbox_management" },
      { id: "support_tickets", label: "Support Tickets (Integration Preview)", kind: "support_tickets_management" },
      { id: "support_identity", label: "Support Identity Matching", kind: "support_identity_management" },
      { id: "support_queues", label: "Support Queue Mapping", kind: "support_queues_management" },
      { id: "support_agent_mappings", label: "Support Agent Mapping", kind: "support_agent_mappings_management" },
      { id: "support_sla", label: "Support SLA Configuration", kind: "view_manage" },
      { id: "support_escalations", label: "Support Escalation Rules", kind: "support_escalations_management" },
      { id: "support_calls", label: "Support Telephony", kind: "view_manage" },
      { id: "support_recordings", label: "Support Call Recordings", kind: "light" },
      { id: "support_transcripts", label: "Support Call Transcripts", kind: "light" },
      { id: "support_reviews", label: "Support Reviews", kind: "support_reviews_management" },
      { id: "support_sync", label: "Support Synchronization", kind: "support_sync_management" },
      { id: "support_conflicts", label: "Support Sync Conflicts", kind: "support_conflicts_management" },
      // Projects and Development Integrations (Phase 4) — /admin/
      // integrations/projects-development/* (linked Projects, work items,
      // repositories/issues/code reviews/pipelines/deployments/releases,
      // mappings, delivery health). Sixteen distinct modules, one per
      // independently-routed resource, same rationale as Phase 2/3. Distinct
      // from the pre-existing "projects"/"my_work" MODULE_GROUPs below (the
      // real Projects module's own RBAC scope) — this integration-preview
      // layer never touches those ids.
      { id: "project_integrations", label: "Projects & Development Integrations", kind: "view_manage" },
      { id: "project_connections", label: "Project Provider Connections", kind: "project_connections_management" },
      { id: "project_mappings", label: "Project Mappings", kind: "view_manage" },
      { id: "project_templates", label: "Project Templates", kind: "view_manage" },
      { id: "project_sync", label: "Project Synchronization", kind: "project_sync_management" },
      { id: "project_conflicts", label: "Project Sync Conflicts", kind: "project_conflicts_management" },
      { id: "external_projects", label: "External Projects", kind: "external_projects_management" },
      { id: "external_tasks", label: "External Work Items", kind: "external_tasks_management" },
      { id: "development_integrations", label: "Development Integrations", kind: "view_manage" },
      { id: "repositories", label: "Repositories", kind: "light" },
      { id: "development_issues", label: "Development Issues", kind: "development_issues_management" },
      { id: "code_reviews", label: "Code Reviews", kind: "light" },
      { id: "pipelines", label: "Pipelines", kind: "light" },
      { id: "deployments", label: "Deployments", kind: "light" },
      { id: "releases", label: "Releases", kind: "light" },
      { id: "delivery_health", label: "Delivery Health", kind: "light" },
      // Commerce and Finance Integrations (Phase 5) — /admin/integrations/
      // commerce-finance/* (stores, product/customer mapping, orders,
      // payments, accounting mappings, subscriptions, banking,
      // reconciliation). Twenty distinct modules, one per independently-
      // routed resource or gated action, same rationale as Phase 2/3/4.
      // Three ids deliberately avoid colliding with the real Finance
      // module's own RBAC modules (payments/invoices/credit_notes, which
      // use a different, richer action vocabulary already granted to
      // finance_manager/finance_staff) — see commerceFinanceConfig.js's own
      // header comment for the full mapping table.
      { id: "commerce_integrations", label: "Commerce Integrations", kind: "view_manage" },
      { id: "commerce_stores", label: "Commerce Store Connections", kind: "commerce_stores_management" },
      { id: "commerce_products", label: "Commerce Product Mapping", kind: "commerce_products_management" },
      { id: "commerce_customers", label: "Commerce Customer Mapping", kind: "commerce_customers_management" },
      { id: "commerce_orders", label: "Commerce Orders", kind: "commerce_orders_management" },
      { id: "commerce_inventory", label: "Commerce Inventory", kind: "light" },
      { id: "payments_integrations", label: "Payments Integrations", kind: "view_manage" },
      { id: "payment_transactions", label: "Payment Transactions", kind: "light" },
      { id: "payment_fees", label: "Payment Fees", kind: "light" },
      { id: "refunds", label: "Refunds", kind: "refunds_management" },
      { id: "disputes", label: "Disputes", kind: "light" },
      { id: "payouts", label: "Payouts", kind: "light" },
      { id: "accounting_integrations", label: "Accounting Integrations", kind: "view_manage" },
      { id: "accounting_mappings", label: "Accounting Mappings", kind: "accounting_mappings_management" },
      { id: "accounting_invoice_sync", label: "Accounting Invoice Synchronization", kind: "accounting_invoice_sync_management" },
      { id: "accounting_credit_notes", label: "Accounting Credit Notes", kind: "light" },
      { id: "subscription_integrations", label: "Subscription Integrations", kind: "subscriptions_management" },
      { id: "banking_integrations", label: "Banking Integrations", kind: "view_manage" },
      { id: "bank_transactions", label: "Bank Transactions", kind: "light" },
      { id: "reconciliation", label: "Reconciliation", kind: "reconciliation_management" },
      { id: "financial_conflicts", label: "Financial Sync Conflicts", kind: "financial_conflicts_management" },
      // Documents, Storage and Electronic Signature Integrations (Phase 6)
      // — /admin/integrations/documents-storage/* (external files, folder
      // mappings, signature workflows/templates, retention, legal holds,
      // access review). Fifteen distinct modules, one per independently-
      // routed resource or gated action, same rationale as every prior
      // phase. Distinct from the pre-existing "data_retention" system-
      // config module above — that governs platform-wide data-retention
      // settings, unrelated to this phase's own per-classification
      // document retention policies.
      { id: "document_integrations", label: "Documents & Storage Integrations", kind: "view_manage" },
      { id: "storage_connections", label: "Storage Provider Connections", kind: "storage_connections_management" },
      { id: "external_files", label: "External Files", kind: "external_files_management" },
      { id: "folder_mappings", label: "Folder Mappings", kind: "view_manage" },
      { id: "file_permissions", label: "File Permissions", kind: "file_permissions_management" },
      { id: "file_classification", label: "File Classification", kind: "file_classification_management" },
      { id: "file_versions", label: "File Versions", kind: "light" },
      { id: "signature_integrations", label: "Signature Integrations", kind: "view_manage" },
      { id: "signature_workflows", label: "Signature Workflows", kind: "signature_workflows_management" },
      { id: "signature_templates", label: "Signature Templates", kind: "view_manage" },
      { id: "signature_audit", label: "Signature Audit", kind: "light" },
      { id: "retention_policies", label: "Document Retention Policies", kind: "view_manage" },
      { id: "legal_holds", label: "Legal Holds", kind: "legal_holds_management" },
      { id: "document_access_review", label: "Document Access Review", kind: "light" },
      { id: "document_conflicts", label: "Document Sync Conflicts", kind: "document_conflicts_management" },
      // AI Provider and Intelligence Integrations (Phase 7, final) —
      // /admin/integrations/ai-providers/* (provider previews, model
      // catalog, routing, policies, privacy/redaction, usage/budget,
      // evaluations, audit). Fourteen distinct modules, one per
      // independently-routed resource or gated action, same rationale as
      // every prior phase. Entirely separate from the real, already-shipped
      // /ai/overview and /ai/copilot features (gated by the existing
      // src/pages/AI/aiConfig.js, untouched by this phase) — no id here
      // collides with anything in that file's own scope.
      { id: "ai_providers", label: "AI Providers", kind: "view_manage" },
      { id: "ai_provider_connections", label: "AI Provider Connections", kind: "ai_provider_connections_management" },
      { id: "ai_models", label: "AI Model Catalog", kind: "view_manage" },
      { id: "ai_routing", label: "AI Routing Policies", kind: "view_manage" },
      { id: "ai_policies", label: "AI Policies", kind: "view_manage" },
      { id: "ai_privacy", label: "AI Privacy Controls", kind: "view_manage" },
      { id: "ai_redaction", label: "AI Redaction Preview", kind: "ai_redaction_management" },
      { id: "ai_tools", label: "AI Tool Permissions", kind: "view_manage" },
      { id: "ai_usage", label: "AI Usage Estimates", kind: "light" },
      { id: "ai_budgets", label: "AI Budget Policies", kind: "ai_budgets_management" },
      { id: "ai_evaluations", label: "AI Evaluations", kind: "ai_evaluations_management" },
      { id: "ai_audit", label: "AI Audit", kind: "light" },
      { id: "ai_sensitive_context", label: "AI Sensitive Context", kind: "light" },
      { id: "ai_actions", label: "AI Action Approval", kind: "ai_actions_management" },
      { id: "import_export", label: "Import and Export", kind: "light_config" },
      { id: "activity_logs", label: "Activity Logs", kind: "log" },
      { id: "audit_logs", label: "Audit Logs", kind: "log" },
      { id: "security", label: "Security", kind: "config" },
      { id: "data_retention", label: "Data Retention", kind: "config" },
      { id: "system_settings", label: "System Settings", kind: "config" },
    ],
  },
];

export function findModule(moduleId) {
  for (const group of MODULE_GROUPS) {
    const found = group.modules.find((m) => m.id === moduleId);
    if (found) return { ...found, groupId: group.id, groupLabel: group.label };
  }
  return null;
}

export function allModules() {
  return MODULE_GROUPS.flatMap((g) => g.modules.map((m) => ({ ...m, groupId: g.id, groupLabel: g.label })));
}

// Permissions considered high-risk regardless of which role grants them.
export const HIGH_RISK_PERMISSIONS = [
  { moduleId: "system_settings", action: A.CONFIGURE, label: "System configuration" },
  { moduleId: "roles", action: A.CONFIGURE, label: "Role management" },
  { moduleId: "permissions", action: A.CONFIGURE, label: "Permission management" },
  { moduleId: "users", action: A.CHANGE_STATUS, label: "User suspension" },
  { moduleId: "*", action: A.DELETE_PERMANENTLY, label: "Permanent deletion" },
  { moduleId: "*", action: A.EXPORT, label: "Organization-wide export", scopeQualifier: "Organization" },
  { moduleId: "invoices", action: A.APPROVE, label: "Financial approval" },
  { moduleId: "expenses", action: A.APPROVE, label: "Financial approval" },
  { moduleId: "employee_directory", action: A.VIEW_HR_FIELDS, label: "HR-sensitive data" },
  { moduleId: "audit_logs", action: A.EXPORT, label: "Audit-log export" },
  { moduleId: "security", action: A.CONFIGURE, label: "Security settings" },
  { moduleId: "integrations", action: A.CONFIGURE, label: "Integration credentials" },
  { moduleId: "data_retention", action: A.CONFIGURE, label: "Data-retention configuration" },
  { moduleId: "members", action: A.ASSIGN_ROLE, label: "Assign a member's role" },
  { moduleId: "members", action: A.REMOVE, label: "Remove a member from the organization" },
  { moduleId: "invite_links", action: A.CONFIGURE_DOMAIN, label: "Disable a link's domain restriction" },
  { moduleId: "invite_links", action: A.CONFIGURE_APPROVAL, label: "Disable a link's approval requirement" },
  { moduleId: "access_audit", action: A.VIEW_AUDIT_HISTORY, label: "View full access-audit records" },
  { moduleId: "integration_center", action: A.DISCONNECT, label: "Disconnect a preview integration connection" },
  { moduleId: "integration_center", action: A.MANAGE_POLICIES, label: "Manage organization integration policies" },
  { moduleId: "integration_center", action: A.MANAGE_CAPABILITIES, label: "Manage integration capability configuration" },
  { moduleId: "marketing_consent", action: A.MANAGE, label: "Change a marketing consent state" },
  { moduleId: "suppression", action: A.REMOVE, label: "Remove a marketing suppression entry" },
  { moduleId: "support_identity", action: A.MERGE, label: "Merge customer identities" },
  { moduleId: "support_identity", action: A.CREATE_CONTACT, label: "Create a Contact from a support identity" },
  { moduleId: "support_tickets", action: A.CLOSE, label: "Close a support ticket" },
  { moduleId: "support_recordings", action: A.VIEW, label: "View call recording availability" },
  { moduleId: "support_transcripts", action: A.VIEW, label: "View call transcript availability" },
  { moduleId: "external_projects", action: A.UNLINK, label: "Unlink an external Project" },
  { moduleId: "development_issues", action: A.CREATE_PREVIEW, label: "Create a development issue preview from a Support Ticket" },
  { moduleId: "refunds", action: A.APPROVE_PREVIEW, label: "Approve a refund preview" },
  { moduleId: "reconciliation", action: A.OVERRIDE, label: "Override a reconciliation or ledger-mapping decision" },
  { moduleId: "external_files", action: A.DELETE_PREVIEW, label: "Delete a file preview" },
  { moduleId: "external_files", action: A.SHARE_PREVIEW, label: "Create a preview sharing link" },
  { moduleId: "signature_workflows", action: A.VOID_PREVIEW, label: "Void a signature workflow" },
  { moduleId: "legal_holds", action: A.MANAGE, label: "Remove a legal hold" },
  { moduleId: "ai_actions", action: A.APPROVE_PREVIEW, label: "Approve an AI-suggested sensitive action" },
  { moduleId: "ai_budgets", action: A.MANAGE, label: "Change an AI budget hard-stop threshold" },
];

export function isHighRiskGrant(moduleId, action, scope) {
  return HIGH_RISK_PERMISSIONS.some((hr) => {
    const moduleMatches = hr.moduleId === "*" || hr.moduleId === moduleId;
    const actionMatches = hr.action === action;
    const scopeMatches = !hr.scopeQualifier || hr.scopeQualifier === scope;
    return moduleMatches && actionMatches && scopeMatches;
  });
}

// ---------------------------------------------------------------------------
// Sensitive fields
// ---------------------------------------------------------------------------
export const FIELD_STATES = ["hidden", "masked", "readOnly", "editable"];
export const FIELD_STATE_LABELS = {
  hidden: "Hidden",
  masked: "Masked",
  readOnly: "Read only",
  editable: "Editable",
};

export const SENSITIVE_FIELD_GROUPS = [
  {
    id: "personal", label: "Personal data",
    fields: [
      { id: "personal_email", label: "Personal email" },
      { id: "phone", label: "Phone" },
      { id: "address", label: "Address" },
      { id: "identification_details", label: "Identification details" },
      { id: "communication_consent", label: "Communication consent" },
    ],
  },
  {
    id: "sales", label: "Sales-sensitive data",
    fields: [
      { id: "product_cost", label: "Product cost" },
      { id: "margin", label: "Margin" },
      { id: "discount_limit", label: "Discount limit" },
      { id: "forecast_details", label: "Forecast details" },
      { id: "commission", label: "Commission" },
    ],
  },
  {
    id: "finance", label: "Finance-sensitive data",
    fields: [
      { id: "bank_information", label: "Bank information" },
      { id: "payment_details", label: "Payment details" },
      { id: "expense_evidence", label: "Expense evidence" },
      { id: "internal_financial_notes", label: "Internal financial notes" },
      { id: "tax_information", label: "Tax information" },
    ],
  },
  {
    id: "hr", label: "HR-sensitive data",
    fields: [
      { id: "salary", label: "Salary" },
      { id: "attendance_corrections", label: "Attendance corrections" },
      { id: "leave_details", label: "Leave details" },
      { id: "performance_reviews", label: "Performance reviews" },
      { id: "disciplinary_information", label: "Disciplinary information" },
      { id: "private_hr_documents", label: "Private HR documents" },
    ],
  },
];

export function allSensitiveFields() {
  return SENSITIVE_FIELD_GROUPS.flatMap((g) => g.fields.map((f) => ({ ...f, groupId: g.id, groupLabel: g.label })));
}

// ---------------------------------------------------------------------------
// Approval types + separation-of-duties
// ---------------------------------------------------------------------------
export const APPROVAL_TYPES = [
  { id: "quote", label: "Quote approval" },
  { id: "discount", label: "Discount approval" },
  { id: "expense", label: "Expense approval" },
  { id: "leave", label: "Leave approval" },
  { id: "invoice", label: "Invoice approval" },
  { id: "contract", label: "Contract approval" },
  { id: "access_request", label: "Access-request approval" },
];

// Each rule states: this approval type can never be granted to the same
// person who submitted/owns the record being approved.
export const SEPARATION_OF_DUTIES_RULES = [
  { approvalType: "quote", message: "Requester cannot approve their own Quote." },
  { approvalType: "discount", message: "Requester cannot approve their own discount." },
  { approvalType: "invoice", message: "Requester cannot approve their own Invoice." },
  { approvalType: "expense", message: "Requester cannot approve their own Expense." },
  { approvalType: "leave", message: "Requester cannot approve their own Leave request." },
  { approvalType: "access_request", message: "Requester cannot approve their own access request." },
];

// context: { approvalType, isOwnRecord, actorTemplateId, recordModuleId }
export function checkSeparationOfDuties(context) {
  const { approvalType, isOwnRecord, actorTemplateId, recordModuleId } = context;
  const violations = [];

  if (isOwnRecord) {
    const rule = SEPARATION_OF_DUTIES_RULES.find((r) => r.approvalType === approvalType);
    if (rule) violations.push(rule.message);
  }

  if (actorTemplateId === "auditor_checker" && (recordModuleId || context.isAuditedRecord)) {
    violations.push("Auditor cannot edit the record being audited.");
  }

  if (actorTemplateId === "customer_portal_user" && context.isInternalNote) {
    violations.push("Customer Portal User cannot see internal notes.");
  }

  return { allowed: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Role templates
// ---------------------------------------------------------------------------
// Each `permissionGrants` entry lists the actions actually granted for one
// module. Any module not listed is fully denied for that role (deny-by-
// default — there is no single "canManage" escape hatch).
function grant(moduleId, actions) {
  return { moduleId, actions };
}

export const ROLE_TEMPLATES = [
  {
    id: "system_owner",
    key: "super_admin",
    name: "System Owner",
    type: "Built-in",
    isBuiltIn: true,
    department: null,
    status: "Active",
    purpose: "Highest system-level authority.",
    description: "Full system-wide access, including recovery and emergency administration. Every sensitive action remains visible in the audit preview and still requires confirmation.",
    recommendedScope: "System-wide",
    defaultScope: "System-wide",
    allowedScopes: SCOPES,
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    // System Owner: everything, every module, every action.
    permissionGrants: allModules().map((m) => grant(m.id, getApplicableActions(m))),
    sensitiveFields: Object.fromEntries(allSensitiveFields().map((f) => [f.id, "editable"])),
    approvalRules: Object.fromEntries(APPROVAL_TYPES.map((a) => [a.id, true])),
    notes: [
      "Every sensitive action remains visible in the audit preview.",
      "System Owner actions must not bypass confirmation interfaces.",
      "System Owner should not be presented as the ordinary owner of every business record.",
    ],
  },
  {
    id: "organization_administrator",
    key: "admin",
    name: "Organization Administrator",
    type: "Built-in",
    isBuiltIn: true,
    department: null,
    status: "Active",
    purpose: "Manages one organization and its business configuration.",
    description: "Full operational control within a single organization: users, teams, departments, role assignment and every business module permitted within that organization.",
    recommendedScope: "Organization",
    defaultScope: "Organization",
    allowedScopes: ["Own", "Assigned", "Team", "Department", "Organization"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      ...allModules()
        // Commerce and Finance Integrations (Phase 5) is the first phase
        // whose spec explicitly says Organization Administrator "should not
        // automatically receive unrestricted access to every sensitive
        // financial field" — payment_fees/payouts/bank_transactions join
        // the existing security/system_settings-style denylist rather than
        // being auto-inherited like every other Phase 1-4 module.
        .filter((m) => !["security", "data_retention", "system_settings", "integrations", "integration_center", "payment_fees", "payouts", "bank_transactions"].includes(m.id))
        .map((m) => grant(m.id, getApplicableActions(m).filter((a) => a !== A.DELETE_PERMANENTLY))),
      grant("users", [A.VIEW, A.CREATE, A.EDIT, A.ASSIGN, A.ARCHIVE, A.EXPORT]),
      // Organization Administrator manages integration previews within their
      // own organization, but organization-wide integration POLICY is
      // reserved for System Owner (mirrors the security/data_retention/
      // system_settings denylist above).
      grant("integration_center", ACTIONS_BY_KIND.integration_management.filter((a) => a !== A.MANAGE_POLICIES)),
    ],
    sensitiveFields: Object.fromEntries(allSensitiveFields().map((f) => [f.id, "editable"])),
    approvalRules: Object.fromEntries(APPROVAL_TYPES.map((a) => [a.id, true])),
    notes: [
      "No access to other organizations.",
      "No system-wide security configuration.",
      "No platform recovery controls.",
    ],
  },
  {
    id: "crm_administrator",
    key: null,
    name: "CRM Administrator",
    type: "Built-in",
    isBuiltIn: true,
    department: "Sales",
    status: "Active",
    purpose: "Configures CRM functionality without becoming a system administrator.",
    description: "Owns pipeline, stage, source, tag, custom-field and CRM-form configuration. Does not receive HR-sensitive data, financial approvals or system-security settings by default.",
    recommendedScope: "Organization",
    defaultScope: "Organization",
    allowedScopes: ["Team", "Department", "Organization"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("crm_dashboard", [A.VIEW]),
      grant("leads", [A.VIEW_ORGANIZATION, A.CONFIGURE, A.EXPORT]),
      grant("pipeline", [A.VIEW_ORGANIZATION, A.CONFIGURE]),
      grant("pipeline_config", [A.VIEW, A.CONFIGURE]),
      grant("statuses", [A.VIEW, A.CONFIGURE]),
      grant("tags", [A.VIEW, A.CONFIGURE]),
      grant("custom_fields", [A.VIEW, A.CONFIGURE]),
      grant("crm_import", [A.VIEW, A.CONFIGURE, A.IMPORT]),
      grant("duplicate_management", [A.VIEW, A.CONFIGURE]),
      grant("marketing_templates", [A.VIEW]),
    ],
    sensitiveFields: {},
    approvalRules: {},
    notes: [
      "No HR-sensitive data by default.",
      "No financial approvals by default.",
      "No system-security settings.",
    ],
  },
  {
    id: "executive",
    key: null,
    name: "Executive / Business Owner",
    type: "Built-in",
    isBuiltIn: true,
    department: null,
    status: "Active",
    purpose: "Views organization-wide performance and business outcomes.",
    description: "Broad read access to executive dashboards, CRM/forecast/company/support/project performance and financial summaries. Primarily view and report access.",
    recommendedScope: "Organization",
    defaultScope: "Organization",
    allowedScopes: ["Organization"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("dashboard", [A.VIEW]),
      grant("crm_dashboard", [A.VIEW]),
      grant("deals", [A.VIEW_ORGANIZATION, A.VIEW_FINANCIAL_FIELDS, A.EXPORT]),
      grant("pipeline", [A.VIEW_ORGANIZATION]),
      grant("forecasts", [A.VIEW_ORGANIZATION, A.VIEW_FINANCIAL_FIELDS, A.EXPORT]),
      grant("support_reports", [A.VIEW_ORGANIZATION, A.EXPORT]),
      grant("project_reports", [A.VIEW_ORGANIZATION, A.EXPORT]),
      grant("financial_reports", [A.VIEW_ORGANIZATION, A.VIEW_FINANCIAL_FIELDS, A.EXPORT]),
      grant("hr_reports", [A.VIEW_ORGANIZATION, A.EXPORT]),
      grant("marketing_analytics", [A.VIEW_ORGANIZATION, A.EXPORT]),
    ],
    sensitiveFields: { forecast_details: "readOnly", margin: "readOnly" },
    approvalRules: {},
    notes: [
      "No routine record editing unless separately assigned.",
      "No role or security configuration.",
    ],
  },
  {
    id: "department_manager",
    key: "team_leader",
    name: "Department Manager",
    type: "Built-in",
    isBuiltIn: true,
    department: null,
    status: "Active",
    purpose: "Manages employees and records within one department.",
    description: "Oversees the department dashboard, employees, assignments, performance and attendance summaries for one department, with approvals when authorized.",
    recommendedScope: "Department",
    defaultScope: "Department",
    allowedScopes: ["Own", "Assigned", "Team", "Department"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("dashboard", [A.VIEW]),
      grant("crm_dashboard", [A.VIEW]),
      grant("leads", [A.VIEW_DEPARTMENT, A.CREATE, A.EDIT, A.ASSIGN]),
      grant("deals", [A.VIEW_DEPARTMENT, A.CREATE, A.EDIT, A.ASSIGN]),
      grant("pipeline", [A.VIEW_DEPARTMENT]),
      grant("quotes", [A.VIEW_DEPARTMENT]),
      grant("orders", [A.VIEW_DEPARTMENT]),
      grant("tickets", [A.VIEW_DEPARTMENT, A.ASSIGN]),
      grant("projects", [A.VIEW_DEPARTMENT, A.ASSIGN]),
      grant("employee_directory", [A.VIEW_DEPARTMENT]),
      grant("attendance", [A.VIEW_DEPARTMENT]),
      grant("performance", [A.VIEW_DEPARTMENT, A.EDIT]),
      grant("leave", [A.VIEW_DEPARTMENT, A.APPROVE, A.REJECT]),
      grant("hr_reports", [A.VIEW_DEPARTMENT, A.EXPORT]),
      grant("support_reports", [A.VIEW_DEPARTMENT]),
      grant("project_reports", [A.VIEW_DEPARTMENT]),
      // AI Provider and Intelligence Integrations (Phase 7, final): "may
      // view department use cases and usage estimates but cannot change
      // organization-wide provider security" — view-only, no
      // ai_providers.manage grant.
      grant("ai_usage", [A.VIEW]),
    ],
    sensitiveFields: { leave_details: "readOnly" },
    approvalRules: { leave: true },
    notes: [
      "No access to other departments without additional scope.",
      "No organization-wide configuration.",
    ],
  },
  {
    id: "sales_manager",
    key: null,
    name: "Sales Manager",
    type: "Built-in",
    isBuiltIn: true,
    department: "Sales",
    status: "Active",
    purpose: "Manages the sales team and commercial pipeline.",
    description: "Full commercial pipeline access for the team: leads through contracts, reassignment, discount approval and team performance reporting.",
    recommendedScope: "Team",
    defaultScope: "Team",
    allowedScopes: ["Own", "Team", "Department"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("leads", [A.VIEW_TEAM, A.CREATE, A.EDIT, A.ASSIGN, A.CHANGE_OWNER, A.CHANGE_STATUS, A.EXPORT, A.BULK_ACTIONS]),
      grant("contacts", [A.VIEW_TEAM, A.CREATE, A.EDIT, A.ASSIGN, A.EXPORT]),
      grant("companies", [A.VIEW_TEAM, A.CREATE, A.EDIT, A.ASSIGN, A.EXPORT]),
      grant("activities", [A.VIEW_TEAM, A.CREATE, A.EDIT, A.MANAGE_COMMENTS]),
      grant("deals", [A.VIEW_TEAM, A.CREATE, A.EDIT, A.ASSIGN, A.CHANGE_OWNER, A.CHANGE_STATUS, A.VIEW_FINANCIAL_FIELDS, A.APPROVE, A.EXPORT, A.BULK_ACTIONS]),
      grant("pipeline", [A.VIEW_TEAM, A.EDIT]),
      grant("products_services", [A.VIEW_ORGANIZATION]),
      grant("price_books", [A.VIEW_ORGANIZATION]),
      grant("quotes", [A.VIEW_TEAM, A.CREATE, A.EDIT, A.APPROVE, A.REJECT, A.EXPORT]),
      grant("orders", [A.VIEW_TEAM, A.CREATE, A.EDIT, A.EXPORT]),
      grant("contracts", [A.VIEW_TEAM, A.CREATE, A.EDIT]),
      grant("forecasts", [A.VIEW_TEAM, A.VIEW_FINANCIAL_FIELDS, A.EXPORT]),
      grant("commissions", [A.VIEW_TEAM]),
      // Sales & Marketing Integrations (Phase 2): may view imported Leads,
      // routing outcomes and permitted attribution. Routing-outcome
      // visibility comes from the Routing Rule / Assigned Owner columns on
      // the Lead Capture table itself (see mockSalesMarketingData.js) —
      // there is no separate lead_routing view action, since that module
      // only exposes MANAGE.
      grant("lead_capture", [A.VIEW]),
      grant("attribution", [A.VIEW]),
      // Customer Support and Communication Integrations (Phase 3): may view
      // limited support summaries linked to CRM records, not private
      // message contents.
      grant("support_tickets", [A.VIEW]),
      // Projects and Development Integrations (Phase 4): may view delivery
      // summaries linked to permitted Deals, never restricted repository/
      // development detail — no repositories/development_issues/
      // code_reviews/pipelines/deployments grant.
      grant("project_integrations", [A.VIEW]),
      // Commerce and Finance Integrations (Phase 5): "may view payment and
      // invoice status linked to permitted Deals and Orders but not full
      // banking, fee or payout data by default" — no payment_fees/payouts/
      // banking_integrations/bank_transactions grant.
      grant("commerce_integrations", [A.VIEW]),
      grant("payment_transactions", [A.VIEW]),
      // Documents, Storage and Electronic Signature Integrations (Phase 6):
      // "may create permitted Quote, Order and Contract signature previews
      // but cannot bypass approval requirements" — CREATE_PREVIEW granted,
      // approval enforcement happens in the workflow validator itself
      // (markSignatureWorkflowReady), not by withholding this grant.
      grant("document_integrations", [A.VIEW]),
      grant("external_files", [A.VIEW, A.LINK]),
      grant("signature_workflows", [A.VIEW, A.CREATE_PREVIEW]),
      grant("signature_templates", [A.VIEW]),
    ],
    sensitiveFields: { discount_limit: "editable", margin: "readOnly", product_cost: "readOnly" },
    approvalRules: { quote: true, discount: true },
    notes: [
      "Cannot change system configuration.",
      "Cannot approve their own requests when separation of duties applies.",
    ],
  },
  {
    id: "sales_representative",
    key: null,
    name: "Sales Representative",
    type: "Built-in",
    isBuiltIn: true,
    department: "Sales",
    status: "Active",
    purpose: "Manages assigned prospects, customers and opportunities.",
    description: "Works assigned Leads, Contacts, Companies and Deals through to draft Quotes and related Orders/Contracts, with personal sales reporting.",
    recommendedScope: "Own",
    defaultScope: "Own",
    allowedScopes: ["Own", "Assigned"],
    isOrdinaryRecordOwner: true,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("leads", [A.VIEW_OWN, A.CREATE, A.EDIT]),
      grant("contacts", [A.VIEW_OWN, A.CREATE, A.EDIT]),
      grant("companies", [A.VIEW_OWN, A.CREATE, A.EDIT]),
      grant("activities", [A.VIEW_OWN, A.CREATE, A.EDIT]),
      grant("deals", [A.VIEW_OWN, A.CREATE, A.EDIT]),
      grant("products_services", [A.VIEW_ORGANIZATION]),
      grant("price_books", [A.VIEW_ORGANIZATION]),
      grant("quotes", [A.VIEW_OWN, A.CREATE, A.EDIT]),
      grant("orders", [A.VIEW_OWN]),
      grant("contracts", [A.VIEW_OWN]),
      grant("forecasts", [A.VIEW_OWN]),
      // Sales & Marketing Integrations (Phase 2): may see integration-source
      // information only for Leads and Deals they can already access — the
      // existing VIEW_OWN scoping on leads/deals above does that work, this
      // just exposes the Lead Capture module's own read view.
      grant("lead_capture", [A.VIEW]),
      // Customer Support and Communication Integrations (Phase 3): may view
      // limited support summaries linked to CRM records, not private
      // message contents.
      grant("support_tickets", [A.VIEW]),
    ],
    sensitiveFields: { discount_limit: "hidden", margin: "hidden", product_cost: "hidden" },
    approvalRules: {},
    notes: [
      "Cannot edit Price Books.",
      "Cannot approve their own discounts.",
      "Cannot view unrelated team records unless shared.",
      "Cannot access HR or confidential Finance data.",
      "Cannot export all organization records by default.",
    ],
  },
  {
    id: "marketing_manager",
    key: null,
    name: "Marketing Manager",
    type: "Built-in",
    isBuiltIn: true,
    department: "Marketing",
    status: "Active",
    purpose: "Manages marketing strategy, campaigns and Lead generation.",
    description: "Owns campaigns, segments, contact lists, forms, sources, templates, automation and analytics for the team.",
    recommendedScope: "Team",
    defaultScope: "Team",
    allowedScopes: ["Own", "Team", "Department"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("campaigns", [A.VIEW_TEAM, A.CREATE, A.EDIT, A.ARCHIVE, A.EXPORT]),
      grant("segments", [A.VIEW_TEAM, A.CREATE, A.EDIT]),
      grant("lists", [A.VIEW_TEAM, A.CREATE, A.EDIT, A.EXPORT]),
      grant("forms", [A.VIEW_TEAM, A.CREATE, A.EDIT]),
      grant("marketing_templates", [A.VIEW_TEAM, A.CREATE, A.EDIT]),
      grant("marketing_automation", [A.VIEW, A.CREATE, A.EDIT, A.MANAGE_AUTOMATIONS]),
      grant("marketing_analytics", [A.VIEW_TEAM, A.EXPORT]),
      // Sales & Marketing Integrations (Phase 2): may configure authorized
      // Lead capture, audiences, forms and attribution. Consent stays
      // view-only here, consistent with this role's existing
      // communication_consent: "readOnly" stance below — suppression,
      // email delivery and conversion mapping are intentionally withheld.
      grant("marketing_integrations", [A.VIEW, A.MANAGE]),
      grant("lead_capture", [A.VIEW, A.PROCESS, A.REJECT]),
      grant("lead_routing", [A.MANAGE]),
      grant("audience_sync", [A.VIEW, A.MANAGE, A.PREVIEW]),
      grant("forms_integrations", [A.VIEW, A.MANAGE]),
      grant("attribution", [A.VIEW, A.CONFIGURE]),
      grant("marketing_consent", [A.VIEW]),
    ],
    sensitiveFields: { communication_consent: "readOnly" },
    approvalRules: {},
    notes: [
      "Must respect Do-Not-Contact records.",
      "Cannot access unrelated financial or HR information.",
      "Cannot override consent restrictions without explicit permission.",
    ],
  },
  {
    id: "marketing_specialist",
    key: null,
    name: "Marketing Specialist",
    type: "Built-in",
    isBuiltIn: true,
    department: "Marketing",
    status: "Active",
    purpose: "Creates and operates assigned marketing work.",
    description: "Executes assigned campaigns and approved segments using shared templates, with source-level reporting.",
    recommendedScope: "Own",
    defaultScope: "Own",
    allowedScopes: ["Own", "Team"],
    isOrdinaryRecordOwner: true,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("campaigns", [A.VIEW_OWN, A.EDIT]),
      grant("segments", [A.VIEW_TEAM]),
      grant("marketing_templates", [A.VIEW_TEAM, A.CREATE, A.EDIT]),
      grant("forms", [A.VIEW_OWN, A.EDIT]),
      grant("lists", [A.VIEW_OWN]),
      grant("marketing_analytics", [A.VIEW_OWN]),
      // Sales & Marketing Integrations (Phase 2): may process assigned
      // Lead-capture records and view permitted campaign information, but
      // cannot change organization-wide connection security — no manage-
      // level grant on any of these modules.
      grant("marketing_integrations", [A.VIEW]),
      grant("lead_capture", [A.VIEW, A.PROCESS, A.REJECT]),
      grant("audience_sync", [A.VIEW]),
      grant("forms_integrations", [A.VIEW]),
      grant("attribution", [A.VIEW]),
    ],
    sensitiveFields: { communication_consent: "readOnly" },
    approvalRules: {},
    notes: [
      "No role configuration.",
      "No full customer export by default.",
      "No consent override.",
      "No organization-wide deletion.",
    ],
  },
  {
    id: "support_manager",
    key: null,
    name: "Support Manager",
    type: "Built-in",
    isBuiltIn: true,
    department: "Support",
    status: "Active",
    purpose: "Manages customer-support teams and service performance.",
    description: "Owns the support dashboard, tickets, shared inbox, queues, SLA, escalations, knowledge base and agent assignment.",
    recommendedScope: "Team",
    defaultScope: "Team",
    allowedScopes: ["Own", "Team", "Department"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("tickets", [A.VIEW_TEAM, A.CREATE, A.EDIT, A.ASSIGN, A.CHANGE_STATUS, A.BULK_ACTIONS, A.MANAGE_COMMENTS]),
      grant("inbox", [A.VIEW_TEAM, A.EDIT]),
      grant("queues", [A.VIEW, A.CONFIGURE]),
      grant("sla", [A.VIEW, A.CONFIGURE]),
      grant("escalations", [A.VIEW_TEAM, A.APPROVE, A.REJECT]),
      grant("knowledge_base", [A.VIEW_TEAM, A.CREATE, A.EDIT]),
      grant("feedback", [A.VIEW_TEAM, A.EXPORT]),
      grant("support_reports", [A.VIEW_TEAM, A.EXPORT]),
      // Customer Support and Communication Integrations (Phase 3): may
      // configure authorized channels, queues, mappings, SLA rules and
      // escalations. support_identity.merge is withheld — reserved to
      // System Owner/Organization Administrator only, mirroring how
      // Marketing Manager was denied marketing_consent.manage in Phase 2.
      grant("support_integrations", [A.VIEW, A.MANAGE]),
      grant("support_channels", [A.VIEW, A.MANAGE]),
      grant("support_inbox", [A.VIEW, A.REPLY_PREVIEW, A.INTERNAL_NOTE]),
      grant("support_tickets", [A.VIEW, A.PROCESS, A.ASSIGN, A.CLOSE]),
      grant("support_identity", [A.VIEW, A.LINK, A.CREATE_CONTACT]),
      grant("support_queues", [A.MANAGE]),
      grant("support_agent_mappings", [A.MANAGE]),
      grant("support_sla", [A.VIEW, A.MANAGE]),
      grant("support_escalations", [A.MANAGE]),
      grant("support_calls", [A.VIEW, A.MANAGE]),
      grant("support_recordings", [A.VIEW]),
      grant("support_transcripts", [A.VIEW]),
      grant("support_reviews", [A.VIEW, A.REPLY_PREVIEW]),
      grant("support_sync", [A.RETRY]),
      grant("support_conflicts", [A.RESOLVE]),
      // Projects and Development Integrations (Phase 4): may preview
      // creating a development issue from a permitted Support Ticket.
      grant("development_issues", [A.VIEW, A.CREATE_PREVIEW]),
      // Documents, Storage and Electronic Signature Integrations (Phase 6):
      // "may link authorized Support evidence but cannot access unrelated
      // documents" — view/link only, no upload/share/delete/signature
      // grant.
      grant("document_integrations", [A.VIEW]),
      grant("external_files", [A.VIEW, A.LINK]),
    ],
    sensitiveFields: {},
    approvalRules: { access_request: false },
    notes: [
      "Financial data limited to what is necessary for support.",
      "No confidential HR access.",
      "No sales-pricing configuration.",
      "Cannot merge customer identities — reserved to System Owner/Organization Administrator.",
    ],
  },
  {
    id: "support_agent",
    key: null,
    name: "Support Agent",
    type: "Built-in",
    isBuiltIn: true,
    department: "Support",
    status: "Active",
    purpose: "Handles assigned customer-support work.",
    description: "Works assigned Tickets, related Contacts/Companies, internal notes and customer replies against the knowledge base, with personal performance reporting.",
    recommendedScope: "Own",
    defaultScope: "Own",
    allowedScopes: ["Own", "Team"],
    isOrdinaryRecordOwner: true,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("tickets", [A.VIEW_OWN, A.EDIT, A.CHANGE_STATUS, A.MANAGE_COMMENTS]),
      grant("contacts", [A.VIEW_OWN]),
      grant("companies", [A.VIEW_OWN]),
      grant("knowledge_base", [A.VIEW]),
      grant("support_reports", [A.VIEW_OWN]),
      // Customer Support and Communication Integrations (Phase 3): may
      // process assigned ticket and conversation previews but cannot change
      // organization-wide integrations or SLA policies — no queue/mapping/
      // SLA/escalation/sync/conflict config, no recordings/transcripts
      // access (reserved to Support Manager and above).
      grant("support_inbox", [A.VIEW, A.REPLY_PREVIEW, A.INTERNAL_NOTE]),
      grant("support_tickets", [A.VIEW, A.PROCESS, A.ASSIGN, A.CLOSE]),
      grant("support_identity", [A.VIEW, A.LINK]),
      grant("support_calls", [A.VIEW]),
      grant("support_reviews", [A.VIEW]),
      grant("support_channels", [A.VIEW]),
    ],
    sensitiveFields: { bank_information: "hidden", salary: "hidden" },
    approvalRules: {},
    notes: [
      "Cannot view unrelated Tickets.",
      "Cannot export the complete customer directory.",
      "Cannot change organization-wide integrations or SLA policies.",
      "Cannot access call recordings or transcripts.",
      "Cannot view sensitive Finance or HR fields.",
      "Cannot edit customer commercial terms.",
    ],
  },
  {
    id: "project_manager",
    key: null,
    name: "Project Manager",
    type: "Built-in",
    isBuiltIn: true,
    department: null,
    status: "Active",
    purpose: "Manages Projects, milestones, delivery and project members.",
    description: "Assigns project members, changes project status, manages milestones and approves project work when authorized.",
    recommendedScope: "Assigned",
    defaultScope: "Assigned",
    allowedScopes: ["Own", "Assigned", "Department"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("projects", [A.VIEW_DEPARTMENT, A.CREATE, A.EDIT, A.ASSIGN, A.CHANGE_STATUS]),
      grant("project_tasks", [A.VIEW_DEPARTMENT, A.CREATE, A.EDIT, A.ASSIGN, A.MANAGE_COMMENTS]),
      grant("milestones", [A.VIEW_DEPARTMENT, A.CREATE, A.EDIT, A.APPROVE, A.REJECT]),
      grant("project_files", [A.VIEW_DEPARTMENT, A.MANAGE_FILES]),
      grant("time_tracking", [A.VIEW_DEPARTMENT, A.EDIT]),
      grant("workload", [A.VIEW_DEPARTMENT]),
      grant("project_reports", [A.VIEW_DEPARTMENT, A.EXPORT]),
      // Projects and Development Integrations (Phase 4) — matches the spec's
      // "may manage authorized Project mappings, templates, synchronization
      // previews, Tasks and delivery-health issues" grant.
      grant("project_integrations", [A.VIEW, A.MANAGE]),
      grant("project_mappings", [A.VIEW, A.MANAGE]),
      grant("project_templates", [A.VIEW, A.MANAGE]),
      grant("project_sync", ACTIONS_BY_KIND.project_sync_management),
      grant("project_conflicts", [A.RESOLVE]),
      grant("external_projects", ACTIONS_BY_KIND.external_projects_management),
      grant("external_tasks", ACTIONS_BY_KIND.external_tasks_management),
      grant("delivery_health", [A.VIEW]),
      // Documents, Storage and Electronic Signature Integrations (Phase 6):
      // "may link and review authorized Project files" — view/link only.
      grant("document_integrations", [A.VIEW]),
      grant("external_files", [A.VIEW, A.LINK]),
    ],
    sensitiveFields: {},
    approvalRules: {},
    notes: [
      "No unrelated sales or HR data.",
      "No organization-wide financial approvals.",
    ],
  },
  {
    id: "project_member",
    key: null,
    name: "Project Member",
    type: "Built-in",
    isBuiltIn: true,
    department: null,
    status: "Active",
    purpose: "Completes assigned Project work.",
    description: "Works assigned Projects and Tasks, logs time and comments, and tracks personal workload.",
    recommendedScope: "Assigned",
    defaultScope: "Assigned",
    allowedScopes: ["Own", "Assigned"],
    isOrdinaryRecordOwner: true,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("projects", [A.VIEW_OWN]),
      grant("project_tasks", [A.VIEW_OWN, A.EDIT, A.MANAGE_COMMENTS]),
      grant("project_files", [A.VIEW_OWN, A.MANAGE_FILES]),
      grant("time_tracking", [A.VIEW_OWN, A.CREATE, A.EDIT]),
      grant("workload", [A.VIEW_OWN]),
      // Projects and Development Integrations (Phase 4) — matches the spec's
      // "may view linked Projects and assigned work items but cannot change
      // organization-wide mappings or connections". No project_mappings/
      // project_templates/project_connections/project_sync grant.
      grant("project_integrations", [A.VIEW]),
      grant("external_tasks", [A.VIEW]),
    ],
    sensitiveFields: {},
    approvalRules: {},
    notes: [
      "Cannot manage Project permissions.",
      "Cannot view unrelated Projects.",
      "Cannot approve their own work when review is required.",
      "Cannot change organization-wide Project integration mappings or connections.",
    ],
  },
  // Projects and Development Integrations (Phase 4) introduces this role —
  // no prior phase needed a template scoped to source-control/CI-CD
  // visibility. Read-only by design: the spec is explicit that a developer
  // may only ever *view* permitted repositories, issues, code-review
  // metadata, pipelines and deployment status in this preview — never
  // trigger, merge, approve, deploy or roll back anything.
  {
    id: "developer",
    key: null,
    name: "Developer",
    type: "Built-in",
    isBuiltIn: true,
    department: "Engineering",
    status: "Active",
    purpose: "Views permitted development activity linked to delivery Projects.",
    description: "Read-only visibility into repositories, development issues, code-review metadata, pipeline runs and deployment status for Projects they're linked to. Never a real source-control or CI/CD action.",
    recommendedScope: "Assigned",
    defaultScope: "Assigned",
    allowedScopes: ["Own", "Assigned"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("project_integrations", [A.VIEW]),
      grant("external_tasks", [A.VIEW]),
      grant("development_integrations", [A.VIEW]),
      grant("repositories", [A.VIEW]),
      grant("development_issues", [A.VIEW]),
      grant("code_reviews", [A.VIEW]),
      grant("pipelines", [A.VIEW]),
      grant("deployments", [A.VIEW]),
      grant("releases", [A.VIEW]),
    ],
    sensitiveFields: {},
    approvalRules: {},
    notes: [
      "Cannot trigger a build, cancel a pipeline, start or roll back a deployment.",
      "Cannot merge a pull/merge request or approve a code review.",
      "Cannot change organization-wide Project integration mappings or connections.",
      "No source code, diff, or repository credential is ever exposed to this role or any other.",
    ],
  },
  // Commerce and Finance Integrations (Phase 5) introduces this role — the
  // spec names it conditionally ("when this role exists, may manage
  // authorized store, Product, Customer and Order mappings"), so it's added
  // new, exactly like Phase 4 added "developer". Manages its own commerce
  // domain only — no payments/accounting/banking/reconciliation access,
  // which stays with Finance Manager.
  {
    id: "commerce_manager",
    key: null,
    name: "Commerce Manager",
    type: "Built-in",
    isBuiltIn: true,
    department: "Sales",
    status: "Active",
    purpose: "Manages storefront and commerce-provider mappings.",
    description: "Manages authorized store connections, Product/Customer mapping and Order synchronization previews. No payments, accounting, banking or reconciliation access.",
    recommendedScope: "Organization",
    defaultScope: "Organization",
    allowedScopes: ["Department", "Organization"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("commerce_integrations", [A.VIEW, A.MANAGE]),
      grant("commerce_stores", [A.MANAGE]),
      grant("commerce_products", [A.MAP]),
      grant("commerce_customers", [A.MAP]),
      grant("commerce_orders", [A.VIEW, A.SYNC_PREVIEW]),
      grant("commerce_inventory", [A.VIEW]),
    ],
    sensitiveFields: {},
    approvalRules: {},
    notes: [
      "No access to payments, accounting, banking or reconciliation previews.",
      "Cannot approve a refund or override a financial decision.",
    ],
  },
  // AI Provider and Intelligence Integrations (Phase 7, final) introduces
  // these two roles — both named conditionally in the spec ("when
  // assigned, may manage..."), so both are added new, exactly like every
  // prior phase's newly-introduced conditional role.
  {
    id: "ai_administrator",
    key: null,
    name: "AI Administrator",
    type: "Built-in",
    isBuiltIn: true,
    department: null,
    status: "Active",
    purpose: "Manages AI provider previews, model aliases, routing and evaluations within granted scope.",
    description: "Manages authorized AI provider connection previews, the model-alias catalog, routing/fallback policies and evaluation scenarios. Does not own privacy/redaction policy — that stays with the Privacy or Compliance Manager.",
    recommendedScope: "Organization",
    defaultScope: "Organization",
    allowedScopes: ["Department", "Organization"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("ai_providers", [A.VIEW, A.MANAGE]),
      grant("ai_provider_connections", ACTIONS_BY_KIND.ai_provider_connections_management),
      grant("ai_models", [A.VIEW, A.MANAGE]),
      grant("ai_routing", [A.VIEW, A.MANAGE]),
      grant("ai_tools", [A.VIEW, A.MANAGE]),
      grant("ai_usage", [A.VIEW]),
      grant("ai_evaluations", ACTIONS_BY_KIND.ai_evaluations_management),
      grant("ai_audit", [A.VIEW]),
    ],
    sensitiveFields: {},
    approvalRules: {},
    notes: [
      "No access to privacy, redaction or budget policy — reserved to Privacy/Compliance Manager and Finance/System Owner respectively.",
      "Cannot weaken non-overridable system security policies.",
    ],
  },
  {
    id: "privacy_compliance_manager",
    key: null,
    name: "Privacy or Compliance Manager",
    type: "Built-in",
    isBuiltIn: true,
    department: "Legal",
    status: "Active",
    purpose: "Manages AI data classification, retention and redaction policy.",
    description: "Manages AI privacy controls, redaction rules and retention-kind AI policies. Does not manage provider connections, routing or the model catalog.",
    recommendedScope: "Organization",
    defaultScope: "Organization",
    allowedScopes: ["Department", "Organization"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("ai_privacy", [A.VIEW, A.MANAGE]),
      grant("ai_redaction", [A.VIEW]),
      grant("ai_policies", [A.VIEW, A.MANAGE]),
      grant("ai_sensitive_context", [A.VIEW]),
      grant("ai_audit", [A.VIEW]),
    ],
    sensitiveFields: {},
    approvalRules: {},
    notes: [
      "No access to provider connections, routing or model-catalog management.",
      "Cannot approve AI-suggested sensitive actions on behalf of another module.",
    ],
  },
  // Documents, Storage and Electronic Signature Integrations (Phase 6)
  // introduces this role — the spec names it conditionally ("when assigned,
  // may manage permitted Contract signature workflows, templates, reviews
  // and legal holds"), so it's added new, exactly like Phase 4's
  // "developer" and Phase 5's "commerce_manager".
  {
    id: "legal_manager",
    key: null,
    name: "Contract / Legal Manager",
    type: "Built-in",
    isBuiltIn: true,
    department: "Legal",
    status: "Active",
    purpose: "Manages Contract signature workflows, templates, reviews and legal holds.",
    description: "Manages authorized Contract signature workflows and templates, reviews Legal/Restricted document access, and manages legal holds. Does not receive unrelated HR or Financial document access.",
    recommendedScope: "Organization",
    defaultScope: "Organization",
    allowedScopes: ["Department", "Organization"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("document_integrations", [A.VIEW, A.MANAGE]),
      grant("external_files", [A.VIEW, A.LINK, A.UNLINK]),
      grant("file_classification", [A.VIEW, A.MANAGE]),
      grant("signature_integrations", [A.VIEW, A.MANAGE]),
      grant("signature_workflows", [A.VIEW, A.CREATE_PREVIEW, A.SEND_PREVIEW, A.REMIND_PREVIEW, A.VOID_PREVIEW]),
      grant("signature_templates", [A.VIEW, A.MANAGE]),
      grant("signature_audit", [A.VIEW]),
      grant("retention_policies", [A.VIEW, A.MANAGE]),
      grant("legal_holds", [A.VIEW, A.MANAGE]),
      grant("document_conflicts", [A.RESOLVE]),
    ],
    sensitiveFields: { legal_documents: "editable" },
    approvalRules: { legal_hold_removal: true },
    notes: [
      "Cannot approve their own legal-hold removal when separation of duties applies.",
      "No access to unrelated HR or Financial documents by default.",
    ],
  },
  {
    id: "finance_manager",
    key: null,
    name: "Finance Manager",
    type: "Built-in",
    isBuiltIn: true,
    department: "Finance",
    status: "Active",
    purpose: "Controls financial operations and financial approvals.",
    description: "Approves invoices and expenses, records payments, reviews discounts and views cost/margin data across Quotes through Financial Reports.",
    recommendedScope: "Organization",
    defaultScope: "Department",
    allowedScopes: ["Department", "Organization"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("quotes", [A.VIEW_ORGANIZATION, A.VIEW_FINANCIAL_FIELDS, A.APPROVE, A.REJECT]),
      grant("orders", [A.VIEW_ORGANIZATION, A.VIEW_FINANCIAL_FIELDS]),
      grant("contracts", [A.VIEW_ORGANIZATION, A.VIEW_FINANCIAL_FIELDS]),
      grant("invoices", [A.VIEW_ORGANIZATION, A.CREATE, A.EDIT, A.APPROVE, A.REJECT, A.VIEW_FINANCIAL_FIELDS, A.EXPORT]),
      grant("payments", [A.VIEW_ORGANIZATION, A.CREATE, A.EDIT, A.VIEW_FINANCIAL_FIELDS]),
      grant("expenses", [A.VIEW_ORGANIZATION, A.APPROVE, A.REJECT, A.VIEW_FINANCIAL_FIELDS]),
      grant("credit_notes", [A.VIEW_ORGANIZATION, A.CREATE, A.EDIT, A.APPROVE]),
      grant("taxes", [A.VIEW, A.CONFIGURE]),
      grant("currencies", [A.VIEW, A.CONFIGURE]),
      grant("financial_reports", [A.VIEW_ORGANIZATION, A.VIEW_FINANCIAL_FIELDS, A.EXPORT]),
      // Commerce and Finance Integrations (Phase 5) — Finance Manager is the
      // confirmed primary owner of every new module per the spec's own
      // default-behavior table: full manage/approve/override access, the
      // only role trusted with APPROVE_PREVIEW and OVERRIDE.
      grant("commerce_integrations", [A.VIEW, A.MANAGE]),
      grant("commerce_stores", [A.MANAGE]),
      grant("commerce_products", [A.MAP]),
      grant("commerce_customers", [A.MAP]),
      grant("commerce_orders", [A.VIEW, A.SYNC_PREVIEW]),
      grant("commerce_inventory", [A.VIEW]),
      grant("payments_integrations", [A.VIEW, A.MANAGE]),
      grant("payment_transactions", [A.VIEW]),
      grant("payment_fees", [A.VIEW]),
      grant("refunds", [A.VIEW, A.REQUEST_PREVIEW, A.APPROVE_PREVIEW]),
      grant("disputes", [A.VIEW]),
      grant("payouts", [A.VIEW]),
      grant("accounting_integrations", [A.VIEW, A.MANAGE]),
      grant("accounting_mappings", [A.MANAGE]),
      grant("accounting_invoice_sync", [A.SYNC_PREVIEW]),
      grant("accounting_credit_notes", [A.VIEW]),
      grant("subscription_integrations", [A.VIEW, A.MANAGE_PREVIEW]),
      grant("banking_integrations", [A.VIEW, A.MANAGE]),
      grant("bank_transactions", [A.VIEW]),
      grant("reconciliation", [A.VIEW, A.PROCESS_PREVIEW, A.OVERRIDE]),
      grant("financial_conflicts", [A.RESOLVE]),
      // Documents, Storage and Electronic Signature Integrations (Phase 6)
      // — "may access permitted Finance documents and signature workflows
      // but not unrelated HR or legal records": view-level document access
      // plus the ability to create/send Finance signature previews, no
      // legal_holds/document_conflicts.resolve grant.
      grant("document_integrations", [A.VIEW]),
      grant("external_files", [A.VIEW, A.LINK]),
      grant("file_classification", [A.VIEW]),
      grant("signature_integrations", [A.VIEW]),
      grant("signature_workflows", [A.VIEW, A.CREATE_PREVIEW, A.SEND_PREVIEW, A.REMIND_PREVIEW]),
      grant("signature_templates", [A.VIEW]),
      grant("signature_audit", [A.VIEW]),
    ],
    sensitiveFields: {
      bank_information: "editable", payment_details: "editable", expense_evidence: "editable",
      internal_financial_notes: "editable", tax_information: "editable", margin: "editable", product_cost: "editable",
    },
    approvalRules: { invoice: true, expense: true, discount: true, quote: true },
    notes: [
      "Must not approve their own submitted records where separation of duties applies.",
    ],
  },
  {
    id: "finance_staff",
    key: null,
    name: "Finance Staff",
    type: "Built-in",
    isBuiltIn: true,
    department: "Finance",
    status: "Active",
    purpose: "Prepares and processes financial records.",
    description: "Prepares draft Invoices, payments, expenses and credit notes for review; cannot approve their own submissions or reach System Owner functions.",
    recommendedScope: "Department",
    defaultScope: "Own",
    allowedScopes: ["Own", "Department"],
    isOrdinaryRecordOwner: true,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("invoices", [A.VIEW_OWN, A.CREATE, A.EDIT]),
      grant("payments", [A.VIEW_OWN, A.CREATE]),
      grant("expenses", [A.VIEW_OWN, A.CREATE, A.EDIT]),
      grant("credit_notes", [A.VIEW_OWN, A.CREATE]),
      // Commerce and Finance Integrations (Phase 5) — "may prepare mappings
      // and reconciliation previews but cannot approve their own restricted
      // actions": every VIEW/MAP/SYNC_PREVIEW/REQUEST_PREVIEW/
      // PROCESS_PREVIEW grant a preparer needs, and deliberately never
      // APPROVE_PREVIEW or OVERRIDE — the same separation-of-duties line
      // this role's own description already draws for Invoices/Expenses.
      grant("commerce_products", [A.MAP]),
      grant("commerce_customers", [A.MAP]),
      grant("commerce_orders", [A.VIEW, A.SYNC_PREVIEW]),
      grant("accounting_mappings", [A.MANAGE]),
      grant("accounting_invoice_sync", [A.SYNC_PREVIEW]),
      grant("refunds", [A.VIEW, A.REQUEST_PREVIEW]),
      grant("subscription_integrations", [A.VIEW]),
      grant("reconciliation", [A.VIEW, A.PROCESS_PREVIEW]),
    ],
    sensitiveFields: { bank_information: "masked", payment_details: "masked", expense_evidence: "editable" },
    approvalRules: {},
    notes: [
      "Cannot approve their own submissions.",
      "Cannot approve a refund preview or override a reconciliation/ledger-mapping decision.",
      "Cannot change Finance configuration.",
      "Cannot view unrelated confidential employee data.",
      "Cannot access System Owner functions.",
    ],
  },
  {
    id: "hr_manager",
    key: null,
    name: "HR Manager",
    type: "Built-in",
    isBuiltIn: true,
    department: "HR",
    status: "Active",
    purpose: "Manages employees and workforce operations.",
    description: "Owns the employee directory, attendance, shifts, leave, performance and recognition, with sensitive HR fields when authorized.",
    recommendedScope: "Organization",
    defaultScope: "Department",
    allowedScopes: ["Department", "Organization"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("employee_directory", [A.VIEW_ORGANIZATION, A.CREATE, A.EDIT, A.VIEW_HR_FIELDS, A.VIEW_SENSITIVE_FIELDS, A.EXPORT]),
      grant("attendance", [A.VIEW_ORGANIZATION, A.EDIT, A.VIEW_HR_FIELDS]),
      grant("punch_records", [A.VIEW_ORGANIZATION, A.VIEW_HR_FIELDS]),
      grant("shifts", [A.VIEW_ORGANIZATION, A.CREATE, A.EDIT]),
      grant("leave", [A.VIEW_ORGANIZATION, A.APPROVE, A.REJECT, A.VIEW_HR_FIELDS]),
      grant("performance", [A.VIEW_ORGANIZATION, A.EDIT, A.VIEW_HR_FIELDS]),
      grant("recognition", [A.VIEW_ORGANIZATION, A.CREATE, A.EDIT]),
      grant("hr_reports", [A.VIEW_ORGANIZATION, A.VIEW_HR_FIELDS, A.EXPORT]),
    ],
    sensitiveFields: {
      salary: "editable", attendance_corrections: "editable", leave_details: "editable",
      performance_reviews: "editable", disciplinary_information: "editable", private_hr_documents: "editable",
    },
    approvalRules: { leave: true },
    notes: [
      "No customer financial access by default.",
      "No CRM pricing configuration.",
      "Sensitive fields must use field-level permissions.",
    ],
  },
  {
    id: "hr_staff",
    key: null,
    name: "HR Staff",
    type: "Built-in",
    isBuiltIn: true,
    department: "HR",
    status: "Active",
    purpose: "Processes assigned HR operations.",
    description: "Handles attendance, punch records, leave processing and shift administration for assigned work, without unrestricted salary or disciplinary access.",
    recommendedScope: "Department",
    defaultScope: "Own",
    allowedScopes: ["Own", "Department"],
    isOrdinaryRecordOwner: true,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("employee_directory", [A.VIEW_DEPARTMENT]),
      grant("attendance", [A.VIEW_DEPARTMENT, A.EDIT]),
      grant("punch_records", [A.VIEW_DEPARTMENT, A.EDIT]),
      grant("leave", [A.VIEW_DEPARTMENT, A.EDIT]),
      grant("shifts", [A.VIEW_DEPARTMENT, A.EDIT]),
    ],
    sensitiveFields: {
      salary: "hidden", disciplinary_information: "hidden", private_hr_documents: "hidden",
      attendance_corrections: "editable", leave_details: "readOnly",
    },
    approvalRules: {},
    notes: [
      "No unrestricted salary, disciplinary or confidential-document access.",
      "Cannot approve their own requests.",
      "Cannot change HR permission configuration.",
    ],
  },
  {
    id: "approver",
    key: null,
    name: "Approver",
    type: "Capability",
    isBuiltIn: true,
    department: null,
    status: "Active",
    purpose: "Reviews designated business requests.",
    description: "A capability role, assignable together with a manager role. The requester must never approve their own request; an Approver sees only the information required for the decision.",
    recommendedScope: "Assigned",
    defaultScope: "Assigned",
    allowedScopes: ["Assigned"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("quotes", [A.VIEW_ORGANIZATION, A.APPROVE, A.REJECT, A.REQUEST_CHANGES]),
      grant("invoices", [A.VIEW_ORGANIZATION, A.APPROVE, A.REJECT, A.REQUEST_CHANGES]),
      grant("expenses", [A.VIEW_ORGANIZATION, A.APPROVE, A.REJECT, A.REQUEST_CHANGES]),
      grant("leave", [A.VIEW_ORGANIZATION, A.APPROVE, A.REJECT]),
      grant("contracts", [A.VIEW_ORGANIZATION, A.APPROVE, A.REJECT]),
    ],
    sensitiveFields: {},
    approvalRules: { quote: true, discount: true, expense: true, leave: true, invoice: true, contract: true, access_request: true },
    notes: [
      "Approver is a capability role, not a standalone job.",
      "The requester must not approve their own request.",
      "Approvers see only the information required for the decision.",
    ],
  },
  {
    id: "auditor_checker",
    key: "checker",
    name: "Auditor / Checker",
    type: "Built-in",
    isBuiltIn: true,
    department: null,
    status: "Active",
    purpose: "Performs independent review and compliance checking.",
    description: "Read-only access to business records, activity logs and audit logs for compliance review. Cannot edit, delete, archive or approve audited records, and cannot modify permissions.",
    recommendedScope: "Organization",
    defaultScope: "Department",
    allowedScopes: ["Assigned", "Department", "Organization"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("financial_reports", [A.VIEW_ORGANIZATION]),
      grant("invoices", [A.VIEW_ORGANIZATION]),
      grant("expenses", [A.VIEW_ORGANIZATION]),
      grant("deals", [A.VIEW_ORGANIZATION]),
      grant("activity_logs", [A.VIEW, A.VIEW_AUDIT_HISTORY]),
      grant("audit_logs", [A.VIEW, A.VIEW_AUDIT_HISTORY]),
      // Integration Center: may review configuration, activity and evidence
      // — never connect, reconfigure, retry, pause or disconnect.
      grant("integration_center", [A.VIEW, A.VIEW_MARKETPLACE, A.VIEW_MAPPINGS, A.VIEW_SYNC, A.VIEW_WEBHOOKS, A.VIEW_ACTIVITY]),
      // Sales & Marketing Integrations (Phase 2): may view mappings, consent
      // evidence, delivery activity and history, but cannot execute actions
      // by default. lead_routing and conversion_mapping are intentionally
      // omitted — those modules expose only MANAGE, no VIEW action exists.
      grant("marketing_integrations", [A.VIEW]),
      grant("lead_capture", [A.VIEW]),
      grant("audience_sync", [A.VIEW]),
      grant("marketing_consent", [A.VIEW]),
      grant("suppression", [A.VIEW]),
      grant("email_delivery", [A.VIEW]),
      grant("attribution", [A.VIEW]),
      grant("forms_integrations", [A.VIEW]),
      // Customer Support and Communication Integrations (Phase 3): may view
      // configuration, evidence, messages, synchronization activity and
      // audit history but cannot execute actions by default.
      // support_queues/support_agent_mappings/support_escalations/
      // support_sync/support_conflicts are intentionally omitted — those
      // modules expose only MANAGE/RETRY/RESOLVE, no VIEW action exists.
      grant("support_integrations", [A.VIEW]),
      grant("support_channels", [A.VIEW]),
      grant("support_inbox", [A.VIEW]),
      grant("support_tickets", [A.VIEW]),
      grant("support_identity", [A.VIEW]),
      grant("support_sla", [A.VIEW]),
      grant("support_calls", [A.VIEW]),
      grant("support_recordings", [A.VIEW]),
      grant("support_transcripts", [A.VIEW]),
      grant("support_reviews", [A.VIEW]),
      // Projects and Development Integrations (Phase 4): may view
      // configuration, mappings, evidence and synchronization history but
      // cannot execute actions by default. project_connections and
      // project_conflicts are intentionally omitted — those modules expose
      // only MANAGE/RESOLVE, no VIEW action exists.
      grant("project_integrations", [A.VIEW]),
      grant("project_mappings", [A.VIEW]),
      grant("project_templates", [A.VIEW]),
      grant("project_sync", [A.VIEW]),
      grant("external_projects", [A.VIEW]),
      grant("external_tasks", [A.VIEW]),
      grant("development_integrations", [A.VIEW]),
      grant("repositories", [A.VIEW]),
      grant("development_issues", [A.VIEW]),
      grant("code_reviews", [A.VIEW]),
      grant("pipelines", [A.VIEW]),
      grant("deployments", [A.VIEW]),
      grant("releases", [A.VIEW]),
      grant("delivery_health", [A.VIEW]),
      // Commerce and Finance Integrations (Phase 5): may view configuration,
      // mappings, evidence and synchronization history but cannot execute
      // actions by default. commerce_stores/commerce_products/
      // commerce_customers/accounting_mappings/accounting_invoice_sync/
      // financial_conflicts are intentionally omitted — those modules
      // expose only MANAGE/MAP/SYNC_PREVIEW/RESOLVE, no VIEW action exists.
      grant("commerce_integrations", [A.VIEW]),
      grant("commerce_orders", [A.VIEW]),
      grant("commerce_inventory", [A.VIEW]),
      grant("payments_integrations", [A.VIEW]),
      grant("payment_transactions", [A.VIEW]),
      grant("payment_fees", [A.VIEW]),
      grant("refunds", [A.VIEW]),
      grant("disputes", [A.VIEW]),
      grant("payouts", [A.VIEW]),
      grant("accounting_integrations", [A.VIEW]),
      grant("accounting_credit_notes", [A.VIEW]),
      grant("subscription_integrations", [A.VIEW]),
      grant("banking_integrations", [A.VIEW]),
      grant("bank_transactions", [A.VIEW]),
      grant("reconciliation", [A.VIEW]),
      // Documents, Storage and Electronic Signature Integrations (Phase 6):
      // may view configuration, metadata, signature history and audit
      // evidence but cannot execute actions by default. storage_connections
      // and document_conflicts are intentionally omitted — those modules
      // expose only MANAGE/RESOLVE, no VIEW action exists.
      grant("document_integrations", [A.VIEW]),
      grant("external_files", [A.VIEW]),
      grant("folder_mappings", [A.VIEW]),
      grant("file_permissions", [A.VIEW]),
      grant("file_classification", [A.VIEW]),
      grant("file_versions", [A.VIEW]),
      grant("signature_integrations", [A.VIEW]),
      grant("signature_workflows", [A.VIEW]),
      grant("signature_templates", [A.VIEW]),
      grant("signature_audit", [A.VIEW]),
      grant("retention_policies", [A.VIEW]),
      grant("legal_holds", [A.VIEW]),
      grant("document_access_review", [A.VIEW]),
      // AI Provider and Intelligence Integrations (Phase 7, final): may
      // review configuration, evaluation evidence and audit history but
      // cannot modify policies or approve actions by default.
      // ai_provider_connections/ai_budgets/ai_actions are intentionally
      // omitted — those modules expose only action verbs, no VIEW action
      // exists.
      grant("ai_providers", [A.VIEW]),
      grant("ai_models", [A.VIEW]),
      grant("ai_routing", [A.VIEW]),
      grant("ai_policies", [A.VIEW]),
      grant("ai_privacy", [A.VIEW]),
      grant("ai_redaction", [A.VIEW]),
      grant("ai_tools", [A.VIEW]),
      grant("ai_usage", [A.VIEW]),
      grant("ai_evaluations", [A.VIEW]),
      grant("ai_audit", [A.VIEW]),
      grant("ai_sensitive_context", [A.VIEW]),
    ],
    sensitiveFields: {},
    approvalRules: {},
    notes: [
      "Cannot edit audited business records.",
      "Cannot delete or archive audited records.",
      "Cannot modify permissions.",
      "Cannot approve records if independence requires separation.",
      "Checker and Approver must remain separate permissions.",
      "May view integration configuration, activity and evidence but cannot connect, reconfigure, retry, pause or disconnect.",
    ],
  },
  {
    id: "standard_employee",
    key: "user",
    name: "Standard Employee",
    type: "Built-in",
    isBuiltIn: true,
    department: null,
    status: "Active",
    purpose: "Provides ordinary employee self-service.",
    description: "Personal dashboard, profile, tasks, calendar, announcements, internal mail, attendance, punch records, leave requests and assigned records only.",
    recommendedScope: "Own",
    defaultScope: "Own",
    allowedScopes: ["Own"],
    isOrdinaryRecordOwner: true,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("dashboard", [A.VIEW]),
      grant("my_work", [A.VIEW]),
      grant("tasks_core", [A.VIEW_OWN, A.CREATE, A.EDIT]),
      grant("calendar", [A.VIEW]),
      grant("announcements", [A.VIEW]),
      grant("internal_mail", [A.VIEW_OWN, A.CREATE]),
      grant("attendance", [A.VIEW_OWN]),
      grant("punch_records", [A.VIEW_OWN]),
      grant("leave", [A.VIEW_OWN, A.CREATE]),
      grant("crm_dashboard", [A.VIEW]),
      grant("leads", [A.VIEW_OWN]),
      grant("deals", [A.VIEW_OWN]),
      grant("quotes", [A.VIEW_OWN]),
      grant("tickets", [A.VIEW_OWN]),
    ],
    sensitiveFields: { salary: "hidden", performance_reviews: "hidden" },
    approvalRules: {},
    notes: [
      "Cannot access administrative configuration.",
      "Cannot view other employees' private data.",
      "Cannot view unrelated customer records.",
      "Assigned Projects or customer records may be granted separately per organization; this default keeps parity with today's Standard access.",
    ],
  },
  {
    id: "read_only_viewer",
    key: null,
    name: "Read-Only Viewer",
    type: "Built-in",
    isBuiltIn: true,
    department: null,
    status: "Active",
    purpose: "Allows authorized viewing without operational actions.",
    description: "Configurable view of selected modules and reports with no create, edit, archive, restore, import, export or approval capability.",
    recommendedScope: "Organization",
    defaultScope: "Organization",
    allowedScopes: SCOPES.filter((s) => s !== "System-wide"),
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("crm_dashboard", [A.VIEW]),
      grant("leads", [A.VIEW_ORGANIZATION]),
      grant("deals", [A.VIEW_ORGANIZATION]),
      grant("pipeline", [A.VIEW_ORGANIZATION]),
      grant("support_reports", [A.VIEW_ORGANIZATION]),
      grant("project_reports", [A.VIEW_ORGANIZATION]),
      grant("financial_reports", [A.VIEW_ORGANIZATION]),
    ],
    sensitiveFields: {},
    approvalRules: {},
    notes: [
      "No create.", "No edit.", "No archive.", "No restore.", "No import.", "No export by default.", "No approval.", "No configuration.",
    ],
  },
  {
    id: "customer_portal_user",
    key: null,
    name: "Customer Portal User",
    type: "External",
    isBuiltIn: true,
    department: null,
    status: "Active",
    purpose: "Allows an external customer to access their own Company's records.",
    description: "Scoped entirely to one external Company account: their profile, contacts, quotes, orders, contracts, projects, tickets, invoices and documents.",
    recommendedScope: "Customer Account",
    defaultScope: "Customer Account",
    allowedScopes: ["Customer Account"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: true,
    permissionGrants: [
      grant("companies", [A.VIEW_OWN]),
      grant("contacts", [A.VIEW_OWN]),
      grant("quotes", [A.VIEW_OWN]),
      grant("orders", [A.VIEW_OWN]),
      grant("contracts", [A.VIEW_OWN]),
      grant("projects", [A.VIEW_OWN]),
      grant("tickets", [A.VIEW_OWN, A.CREATE]),
      grant("invoices", [A.VIEW_OWN]),
      grant("shared_documents", [A.VIEW_OWN]),
    ],
    sensitiveFields: {
      product_cost: "hidden", margin: "hidden", commission: "hidden",
      internal_financial_notes: "hidden", salary: "hidden",
    },
    approvalRules: {},
    notes: [
      "Cannot view another customer.",
      "Cannot access internal notes.",
      "Cannot access employee information.",
      "Cannot access internal audit logs.",
      "Cannot access cost, margin or internal approval information.",
      "Cannot change internal ownership.",
    ],
  },
];

export function findRoleTemplate(idOrKey) {
  return ROLE_TEMPLATES.find((r) => r.id === idOrKey || r.key === idOrKey) || null;
}

export function getTemplateForRealRole(realRole) {
  const templateId = ROLE_TO_TEMPLATE_ID[realRole];
  return templateId ? findRoleTemplate(templateId) : null;
}

// Canonical home for these two role-identity checks — every feature-specific
// config file (accessManagementConfig.js, integrationsConfig.js, ...) should
// import them from here rather than re-deriving or duplicating this logic.
export function isSystemOwner(realRole) {
  return getTemplateForRealRole(realRole)?.id === "system_owner";
}
export function isOrganizationAdministrator(realRole) {
  return getTemplateForRealRole(realRole)?.id === "organization_administrator";
}

// ---------------------------------------------------------------------------
// Custom roles (frontend session state — never persisted to a backend)
// ---------------------------------------------------------------------------
let customRoleSeq = 1;
export const CUSTOM_ROLES = [
  {
    id: "custom_regional_sales_lead",
    key: null,
    name: "Regional Sales Lead",
    type: "Custom",
    isBuiltIn: false,
    department: "Sales",
    status: "Active",
    purpose: "A Sales Manager scoped to one region, duplicated from the built-in template for a pilot team.",
    description: "Duplicated from Sales Manager with export disabled pending a security review.",
    recommendedScope: "Team",
    defaultScope: "Team",
    allowedScopes: ["Own", "Team"],
    isOrdinaryRecordOwner: false,
    customerAccountRestricted: false,
    permissionGrants: [
      grant("leads", [A.VIEW_TEAM, A.CREATE, A.EDIT, A.ASSIGN]),
      grant("deals", [A.VIEW_TEAM, A.CREATE, A.EDIT, A.VIEW_FINANCIAL_FIELDS]),
      grant("quotes", [A.VIEW_TEAM, A.CREATE, A.EDIT]),
    ],
    sensitiveFields: { margin: "readOnly" },
    approvalRules: { quote: true },
    notes: ["Export disabled pending a security review.", "Duplicated from Sales Manager on 2026-07-02."],
    createdAt: "2026-07-02T09:00:00.000Z",
    updatedAt: "2026-07-02T09:00:00.000Z",
    duplicatedFrom: "sales_manager",
  },
];

export function allRoles() {
  return [...ROLE_TEMPLATES, ...CUSTOM_ROLES];
}

export function findRole(idOrKey) {
  return allRoles().find((r) => r.id === idOrKey || r.key === idOrKey) || null;
}

export function nextCustomRoleId() {
  return `custom_role_${customRoleSeq++}_${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Permission evaluation
// ---------------------------------------------------------------------------
export function hasPermission(roleIdOrKey, moduleId, action) {
  const role = findRole(roleIdOrKey);
  if (!role) return false;
  const grantEntry = role.permissionGrants.find((g) => g.moduleId === moduleId);
  return !!grantEntry && grantEntry.actions.includes(action);
}

export function hasAnyView(role, moduleId) {
  const viewActions = [A.VIEW, A.VIEW_OWN, A.VIEW_TEAM, A.VIEW_DEPARTMENT, A.VIEW_ORGANIZATION];
  const grantEntry = role.permissionGrants.find((g) => g.moduleId === moduleId);
  return !!grantEntry && grantEntry.actions.some((a) => viewActions.includes(a));
}

export function getFieldState(roleIdOrKey, fieldId) {
  const role = findRole(roleIdOrKey);
  if (!role) return "hidden";
  return role.sensitiveFields[fieldId] || "hidden";
}

export function canApprove(roleIdOrKey, approvalType) {
  const role = findRole(roleIdOrKey);
  return !!role && !!role.approvalRules[approvalType];
}

export function countGrantedActions(role) {
  return role.permissionGrants.reduce((sum, g) => sum + g.actions.length, 0);
}

export function countHighRiskGrants(role) {
  const found = [];
  role.permissionGrants.forEach((g) => {
    g.actions.forEach((action) => {
      if (isHighRiskGrant(g.moduleId, action)) found.push({ moduleId: g.moduleId, action });
    });
  });
  return found;
}

export function isHighPrivilegeRole(role) {
  return countHighRiskGrants(role).length >= 2 || role.defaultScope === "System-wide";
}

// ---------------------------------------------------------------------------
// Navigation derived from permissions
// ---------------------------------------------------------------------------
// Real production nav (Helper.js) stays byte-identical to before this
// package — it now simply asks "does this role's mapped template have View
// on any module in this nav section?" instead of hardcoding the answer.
export function getVisibleNavForRole(roleIdOrKey) {
  const role = findRole(roleIdOrKey);
  if (!role) return [];
  const sections = [];
  const seen = new Set();
  for (const group of MODULE_GROUPS) {
    if (!group.navSection || seen.has(group.navSection.label)) continue;
    const visible = group.modules.some((m) => hasAnyView(role, m.id));
    if (visible) {
      sections.push(group.navSection);
      seen.add(group.navSection.label);
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------
export function detectRoleConflicts(role) {
  const conflicts = [];

  const highRisk = countHighRiskGrants(role);
  if (highRisk.length >= 3 && role.id !== "system_owner") {
    conflicts.push({
      type: "Excessive privilege",
      severity: "high",
      message: `This role holds ${highRisk.length} high-risk permissions (${highRisk.map((h) => h.moduleId).join(", ")}). Review whether all are required.`,
    });
  }

  // Separation-of-duties: a role scoped to "Own" that can both create and
  // approve the same financial workflow would, by definition, only ever be
  // approving records it created itself. A manager scoped to Team/
  // Department/Organization approving alongside a Create grant is normal
  // (they approve OTHER people's records) — the actual "not your own
  // record" constraint is enforced per-instance by checkSeparationOfDuties.
  if (role.defaultScope === "Own") {
    const approvalModules = ["quotes", "invoices", "expenses", "contracts"];
    approvalModules.forEach((moduleId) => {
      const grantEntry = role.permissionGrants.find((g) => g.moduleId === moduleId);
      if (grantEntry && grantEntry.actions.includes(A.CREATE) && grantEntry.actions.includes(A.APPROVE)) {
        conflicts.push({
          type: "Separation-of-duties conflict",
          severity: "high",
          message: `This role is scoped to "Own" but can both create and approve ${findModule(moduleId)?.label || moduleId} records — it would only ever approve its own submissions.`,
        });
      }
    });
  }

  if (role.approvalRules?.access_request && role.type !== "Capability" && role.id !== "system_owner") {
    conflicts.push({
      type: "Missing required permission",
      severity: "medium",
      message: "Access-request approval is granted without the underlying Users/Permissions view — approvers need enough context to review the request.",
    });
  }

  if (role.defaultScope && role.allowedScopes && !role.allowedScopes.includes(role.defaultScope)) {
    conflicts.push({
      type: "Inconsistent scope",
      severity: "medium",
      message: `Default scope "${role.defaultScope}" is not included in this role's allowed scopes.`,
    });
  }

  const exposedSensitive = Object.entries(role.sensitiveFields || {}).filter(([, state]) => state === "editable");
  if (exposedSensitive.length > 0 && ["support_agent", "sales_representative", "standard_employee", "customer_portal_user"].includes(role.id)) {
    conflicts.push({
      type: "Sensitive-field exposure",
      severity: "high",
      message: `This role can edit sensitive fields (${exposedSensitive.map(([f]) => f).join(", ")}) that are normally restricted for its purpose.`,
    });
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Assigned users (fixture preview only — never a real assignment record)
// ---------------------------------------------------------------------------
const FIRST_NAMES = ["Dominic", "Priya", "Marcus", "Fatima", "Liam", "Grace", "Noah", "Ava", "Ethan", "Maya"];
const LAST_NAMES = ["Wuckert", "Nair", "Chen", "Al-Sayed", "O'Connor", "Kim", "Rossi", "Dubois", "Silva", "Ibrahim"];

export const RBAC_USERS = allRoles().flatMap((role, roleIdx) => {
  const count = role.id === "system_owner" ? 1 : role.id === "customer_portal_user" ? 3 : 2 + (roleIdx % 3);
  return Array.from({ length: count }, (_, i) => {
    const first = FIRST_NAMES[(roleIdx * 3 + i) % FIRST_NAMES.length];
    const last = LAST_NAMES[(roleIdx * 5 + i) % LAST_NAMES.length];
    return {
      id: `rbacuser_${role.id}_${i}`,
      name: `${first} ${last}`,
      email: `${first}.${last}`.toLowerCase() + "@caspira.example",
      roleId: role.id,
      department: role.department || "General",
      status: i === 0 ? "Active" : "Active",
    };
  });
});

export function usersForRole(roleId) {
  return RBAC_USERS.filter((u) => u.roleId === roleId);
}

// ---------------------------------------------------------------------------
// Change history / audit preview (fixture only)
// ---------------------------------------------------------------------------
export const ROLE_CHANGE_HISTORY = {
  custom_regional_sales_lead: [
    {
      actor: "Priya Nair",
      action: "Duplicated Sales Manager into a new Custom Role",
      time: "2026-07-02T09:00:00.000Z",
      previousValue: "—",
      newValue: "Regional Sales Lead created",
      reason: "Pilot for the EMEA region sales team",
    },
    {
      actor: "Priya Nair",
      action: "Removed Export permission on Quotes",
      time: "2026-07-05T14:20:00.000Z",
      previousValue: "Export: granted",
      newValue: "Export: denied",
      reason: "Pending a security review",
    },
  ],
};

export function changeHistoryForRole(roleId) {
  return ROLE_CHANGE_HISTORY[roleId] || [];
}

export const ROLE_AUDIT_PREVIEW = {
  system_owner: [
    { actor: "System Owner", action: "Viewed Security settings", time: "2026-08-20T11:00:00.000Z", previousValue: "—", newValue: "—", reason: "Quarterly access review" },
  ],
  custom_regional_sales_lead: [
    { actor: "Priya Nair", action: "Updated permission grants", time: "2026-07-05T14:20:00.000Z", previousValue: "Export: granted", newValue: "Export: denied", reason: "Pending a security review" },
  ],
};

export function auditPreviewForRole(roleId) {
  return ROLE_AUDIT_PREVIEW[roleId] || [];
}

// ---------------------------------------------------------------------------
// Directory query + CRUD (frontend session state only)
// ---------------------------------------------------------------------------
export function queryRolesLocal(filters = {}) {
  let list = allRoles();

  if (filters.search) {
    const q = filters.search.toLowerCase();
    list = list.filter((r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  }
  if (filters.type) list = list.filter((r) => r.type === filters.type);
  if (filters.scope) list = list.filter((r) => r.defaultScope === filters.scope);
  if (filters.department) list = list.filter((r) => r.department === filters.department);
  if (filters.hasAssignedUsers === "yes") list = list.filter((r) => usersForRole(r.id).length > 0);
  if (filters.hasAssignedUsers === "no") list = list.filter((r) => usersForRole(r.id).length === 0);
  if (filters.highPrivilege === "yes") list = list.filter((r) => isHighPrivilegeRole(r));
  if (filters.highPrivilege === "no") list = list.filter((r) => !isHighPrivilegeRole(r));
  if (filters.status) list = list.filter((r) => r.status === filters.status);
  if (filters.builtin === "builtin") list = list.filter((r) => r.isBuiltIn);
  if (filters.builtin === "custom") list = list.filter((r) => !r.isBuiltIn);

  return list;
}

export function createCustomRole(payload) {
  const errors = validateRolePayload(payload);
  if (Object.keys(errors).length > 0) return { error: "Validation failed", fieldErrors: errors };

  const now = new Date().toISOString();
  const role = {
    id: nextCustomRoleId(),
    key: null,
    name: payload.name.trim(),
    type: "Custom",
    isBuiltIn: false,
    department: payload.department || null,
    status: payload.status || "Active",
    purpose: payload.purpose || "",
    description: payload.description || "",
    recommendedScope: payload.defaultScope,
    defaultScope: payload.defaultScope,
    allowedScopes: payload.allowedScopes || [payload.defaultScope],
    isOrdinaryRecordOwner: !!payload.isOrdinaryRecordOwner,
    customerAccountRestricted: !!payload.customerAccountRestricted,
    permissionGrants: payload.permissionGrants || [],
    sensitiveFields: payload.sensitiveFields || {},
    approvalRules: payload.approvalRules || {},
    notes: payload.notes || [],
    createdAt: now,
    updatedAt: now,
    duplicatedFrom: payload.duplicatedFrom || null,
  };
  CUSTOM_ROLES.push(role);
  return { role };
}

export function updateCustomRole(roleId, changes) {
  const role = CUSTOM_ROLES.find((r) => r.id === roleId);
  if (!role) return { error: "Only Custom Roles can be edited directly." };
  Object.assign(role, changes, { updatedAt: new Date().toISOString() });
  return { role };
}

export function duplicateRoleAsCustom(sourceRoleId, newName) {
  const source = findRole(sourceRoleId);
  if (!source) return { error: "Source role not found" };
  return createCustomRole({
    name: newName || `${source.name} (Copy)`,
    department: source.department,
    status: "Active",
    purpose: source.purpose,
    description: `Duplicated from ${source.name}.`,
    defaultScope: source.defaultScope,
    allowedScopes: source.allowedScopes,
    isOrdinaryRecordOwner: source.isOrdinaryRecordOwner,
    customerAccountRestricted: source.customerAccountRestricted,
    permissionGrants: source.permissionGrants.map((g) => ({ moduleId: g.moduleId, actions: [...g.actions] })),
    sensitiveFields: { ...source.sensitiveFields },
    approvalRules: { ...source.approvalRules },
    duplicatedFrom: sourceRoleId,
  });
}

export function archiveCustomRole(roleId, reason) {
  const role = CUSTOM_ROLES.find((r) => r.id === roleId);
  if (!role) return { error: "Only Custom Roles can be archived." };
  if (!reason || !reason.trim()) return { error: "An archive reason is required." };
  role.status = "Archived";
  role.archivedReason = reason;
  role.updatedAt = new Date().toISOString();
  return { role };
}

export function restoreCustomRole(roleId) {
  const role = CUSTOM_ROLES.find((r) => r.id === roleId);
  if (!role) return { error: "Only Custom Roles can be restored." };
  role.status = "Active";
  role.archivedReason = null;
  role.updatedAt = new Date().toISOString();
  return { role };
}

export function disableCustomRole(roleId) {
  const role = CUSTOM_ROLES.find((r) => r.id === roleId);
  if (!role) return { error: "Only Custom Roles can be disabled." };
  role.status = "Inactive";
  role.updatedAt = new Date().toISOString();
  return { role };
}

export function enableCustomRole(roleId) {
  const role = CUSTOM_ROLES.find((r) => r.id === roleId);
  if (!role) return { error: "Only Custom Roles can be enabled." };
  role.status = "Active";
  role.updatedAt = new Date().toISOString();
  return { role };
}

export function validateRolePayload(payload) {
  const errors = {};
  if (!payload.name || !payload.name.trim()) errors.name = "Role name is required";
  if (!payload.defaultScope) errors.defaultScope = "A default scope is required";
  if (payload.defaultScope && payload.allowedScopes && !payload.allowedScopes.includes(payload.defaultScope)) {
    errors.defaultScope = "Default scope must be one of the allowed scopes";
  }
  if (!payload.permissionGrants || payload.permissionGrants.every((g) => g.actions.length === 0)) {
    errors.permissionGrants = "Grant at least one permission before saving";
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Role comparison
// ---------------------------------------------------------------------------
export function compareRoles(roleIds) {
  const roles = roleIds.map((id) => findRole(id)).filter(Boolean);
  const moduleIds = Array.from(new Set(roles.flatMap((r) => r.permissionGrants.map((g) => g.moduleId))));
  const rows = moduleIds.map((moduleId) => ({
    moduleId,
    moduleLabel: findModule(moduleId)?.label || moduleId,
    perRole: roles.map((r) => {
      const g = r.permissionGrants.find((gr) => gr.moduleId === moduleId);
      return { roleId: r.id, actions: g ? g.actions : [] };
    }),
  }));
  return { roles, rows };
}
