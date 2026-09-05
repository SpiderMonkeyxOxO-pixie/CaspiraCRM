// Centralized, provider-neutral frontend fixtures for the Integration Center
// (/admin/integrations/*) — Phase 1 preview only.
//
// STRICT BOUNDARY: nothing in this file (or anything that reads from it)
// ever contacts a real provider, exchanges a real OAuth token, stores a real
// credential, registers a real webhook, or moves real customer data. Every
// "connection" here is simulated using frontend fixture data. No provider
// account, credential, or customer information is being accessed. Statuses
// are never shown as bare "Connected" — always "Preview Connected" or an
// equivalent preview-qualified state.
//
// Structure mirrors mockAccessData.js: enums, typed factory functions (this
// codebase has no TypeScript — factories are the "typed contract" pattern),
// a seeded catalog/fixture set, and query/mutate functions mockApi.js calls
// into (queryProvidersLocal, queryConnectionsLocal, createConnectionPreview,
// pauseConnection, resumeConnection, disconnectConnection, runPreviewSync,
// etc.).
import { ORGANIZATIONS, findOrganization, DEFAULT_ORGANIZATION_ID } from "./mockAccessData";
// Sales & Marketing Integrations (Phase 2) / Customer Support and
// Communication Integrations (Phase 3) — raw provider arrays only. Neither
// file imports anything back from THIS module at its own top level (they
// import shared factories from the dependency-free mockIntegrationsContracts.js
// instead) — this module stays the sole owner of PROVIDERS construction,
// avoiding the circular-import deadlock a two-way top-level const cycle
// would otherwise create (see mockSalesMarketingData.js's header comment for
// the full history: a real "PHASE2_PROVIDERS is not iterable" bug was found
// and fixed this way).
import { PHASE2_PROVIDERS } from "./mockSalesMarketingData";
import { PHASE3_PROVIDERS } from "./mockSupportCommunicationData";
import { PHASE4_PROVIDERS } from "./mockProjectsDevelopmentData";
import { PHASE5_PROVIDERS } from "./mockCommerceFinanceData";
import { PHASE6_PROVIDERS } from "./mockDocumentsStorageData";
import { PHASE7_PROVIDERS } from "./mockAiProvidersData";

export const FRONTEND_CONNECTION_PREVIEW_LABEL = "Frontend Connection Preview";
export const FRONTEND_CONNECTION_PREVIEW_EXPLANATION =
  "This connection is simulated using frontend fixture data. No provider account, credential or customer information is being accessed.";
export const CREDENTIAL_PLACEHOLDER_TEXT = "Credentials will be configured securely during backend integration.";
export const WEBHOOK_BACKEND_NOTICE = "Backend endpoint will be generated during production integration.";
export const PREVIEW_CONNECTION_COMPLETE_MESSAGE = "Preview connection created. No external provider was contacted.";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const CONNECTION_STATUSES = [
  "Available",
  "Preview Available",
  "Preview Connected",
  "Configuration Required",
  "Attention Required",
  "Preview Paused",
  "Preview Disconnected",
  "Unavailable",
  "Coming Soon",
];

export const AUTH_METHODS = [
  "OAuth 2.0",
  "OAuth 2.0 with PKCE",
  "API Key",
  "Signing Secret",
  "Service Account",
  "Webhook Secret",
  "Provider-Managed Authorization",
];

export const PRICING_CLASSIFICATIONS = [
  "Provider Free Tier Available",
  "Provider Subscription Required",
  "Usage-Based Provider",
  "Transaction-Based Provider",
  "Provider Plan Dependent",
  "Contact Provider",
  "No Provider Integration Fee Known",
];

export const SYNC_DIRECTIONS = ["Import Only", "Export Only", "Bidirectional"];

export const CONFLICT_RULES = [
  "CRM Wins",
  "Provider Wins",
  "Most Recently Updated Wins",
  "Manual Review",
  "Do Not Overwrite",
];

export const SYNC_JOB_TYPES = [
  "Initial Import",
  "Initial Export",
  "Incremental Sync",
  "Manual Sync",
  "Scheduled Sync",
  "Webhook-Triggered Sync",
  "Retry",
];

export const CATEGORIES = [
  "Productivity",
  "Email",
  "Calendar",
  "Meetings",
  "Internal Communication",
  "Customer Messaging",
  "Payments",
  "Accounting",
  "Electronic Signature",
  "Automation",
  "Documents",
  "Marketing",
  "Support",
  "Project Management",
  "Commerce",
  "AI",
  // Sales & Marketing Integrations (Phase 2) — mirror the new
  // INTEGRATION_CHANNELS values from mockSalesMarketingData.js one-to-one,
  // so every Phase 2 provider's `category` still satisfies "category is
  // always one of CATEGORIES" without inventing a second, parallel taxonomy.
  "Email Marketing",
  "Transactional Email",
  "Advertising & Lead Generation",
  "Analytics & Attribution",
  "Forms",
  // Customer Support and Communication Integrations (Phase 3) — Zendesk/
  // Freshdesk/Intercom use the existing "Support" category above;
  // Messenger/Instagram/Telegram use the existing "Customer Messaging"
  // category (same as WhatsApp/Twilio). Only these two are genuinely new.
  "Business Telephony",
  "Customer Reviews",
  // Projects and Development Integrations (Phase 4) — Jira/Asana/ClickUp/
  // Trello/Monday.com reuse the existing "Project Management" category
  // above (unused until now); GitHub/GitLab/Bitbucket need this one new
  // category, since no prior phase represented source-control/CI-CD tools.
  "Developer Tools",
  // Commerce and Finance Integrations (Phase 5) — Shopify/WooCommerce reuse
  // the existing "Commerce" category above (unused until now); PayPal/
  // Razorpay/Square reuse the existing "Payments" category; Wise Business/
  // Plaid need "Banking" (new); Chargebee/Paddle need "Subscriptions" (new)
  // — no prior phase represented either.
  "Banking",
  "Subscriptions",
];

// The shared CRM entities data mapping may reference — never fake
// independent copies, always these same names used elsewhere in the app.
export const MAPPABLE_CRM_ENTITIES = [
  "Leads", "Contacts", "Companies", "Activities", "Deals",
  "Products and Services", "Quotes", "Orders", "Contracts",
  // Sales & Marketing Integrations (Phase 2) — Campaign/Form reference
  // mapping targets for the Attribution/Forms field-mapping UIs.
  "Campaigns", "Forms",
  // Customer Support and Communication Integrations (Phase 3) — ticket
  // status/priority/queue/agent mapping targets.
  "Tickets",
];

const PROVIDER_ORGANIZATION_POLICY_DEFAULTS = {
  requireApprovalForConnect: false,
  maxConnectionsPerProvider: null,
  allowedCategories: null, // null = no restriction
};

// ---------------------------------------------------------------------------
// Typed factory functions ("contracts") — every field defaulted, never
// omitted, so every consumer can rely on the shape without optional-chaining
// everywhere. Mirrors createOrganizationMember/createMemberInvitation in
// mockAccessData.js.
//
// createIntegrationPlanRequirement/Capability/AuthMethod/Provider live in
// mockIntegrationsContracts.js (not here) and are re-exported below purely
// to avoid a circular import with mockSalesMarketingData.js — see that
// file's header comment for why. Every existing `import { createIntegration
// Provider } from "./mockIntegrationsData"` elsewhere in the app keeps
// working unchanged.
// ---------------------------------------------------------------------------
import {
  createIntegrationPlanRequirement,
  createIntegrationCapability,
  createIntegrationAuthMethod,
  createIntegrationProvider,
} from "./mockIntegrationsContracts";
export { createIntegrationPlanRequirement, createIntegrationCapability, createIntegrationAuthMethod, createIntegrationProvider };

export function createIntegrationFieldMapping({
  id, crmEntity, crmField, providerEntity, providerField,
  direction = "Bidirectional", required = false, transformation = "None",
  conflictRule = "Most Recently Updated Wins", validationStatus = "Valid", sensitive = false,
}) {
  return { id, crmEntity, crmField, providerEntity, providerField, direction, required, transformation, conflictRule, validationStatus, sensitive };
}

export function createIntegrationEntityMapping({ crmEntity, providerEntity, fieldMappings = [] }) {
  return { crmEntity, providerEntity, fieldMappings };
}

export function createIntegrationSyncConfiguration({
  direction = "Bidirectional", entityMappings = [], scheduleFrequency = "Manual",
  selectedUserIds = [], selectedTeamIds = [], notifyOnFailure = true, notifyOnSuccess = false,
}) {
  return { direction, entityMappings, scheduleFrequency, selectedUserIds, selectedTeamIds, notifyOnFailure, notifyOnSuccess };
}

export function createIntegrationSyncResult({
  id, jobType = "Manual Sync", recordsExamined = 0, created = 0, updated = 0, skipped = 0,
  conflicted = 0, failed = 0, startedDate, completedDate = null, triggeredBy = "System",
}) {
  const duration = completedDate ? Math.max(0, new Date(completedDate) - new Date(startedDate)) : null;
  return {
    id, jobType, recordsExamined, created, updated, skipped, conflicted, failed,
    startedDate, completedDate, durationMs: duration, triggeredBy,
    label: "Preview Synchronization",
  };
}

export function createIntegrationSyncJob({
  id, connectionId, jobType = "Manual Sync", status = "Completed", result = null,
}) {
  return { id, connectionId, jobType, status, result, label: "Preview Synchronization" };
}

export function createIntegrationError({
  id, occurredAt, code, message, retryEligible = true, resolved = false,
}) {
  return { id, occurredAt, code, message, retryEligible, resolved };
}

export function createIntegrationHealth({
  status = "Healthy", lastCheckedAt = new Date().toISOString(), issues = [],
}) {
  return { status, lastCheckedAt, issues };
}

export function createIntegrationConnection({
  id, providerKey, organizationId, status = "Preview Connected",
  connectedByName = "Preview User", createdDate = new Date().toISOString(),
  capabilities = [], dataScope = "Organization", syncConfiguration = null,
  fieldMappings = [], notificationPreferences = { onFailure: true, onSuccess: false },
  lastSyncedAt = null, health = null, recentErrors = [], syncJobs = [],
  pausedDate = null, disconnectedDate = null, disconnectReason = null,
}) {
  return {
    id, providerKey, organizationId, status,
    connectedByName, createdDate,
    capabilities, dataScope,
    syncConfiguration: syncConfiguration || createIntegrationSyncConfiguration({}),
    fieldMappings, notificationPreferences,
    lastSyncedAt, health: health || createIntegrationHealth({}),
    recentErrors, syncJobs,
    pausedDate, disconnectedDate, disconnectReason,
    isPreview: true,
    previewLabel: FRONTEND_CONNECTION_PREVIEW_LABEL,
    previewExplanation: FRONTEND_CONNECTION_PREVIEW_EXPLANATION,
  };
}

export function createIntegrationWebhookPreview({
  id, providerKey, connectionId = null, organizationId, eventName,
  status = "Active Preview", lastEventAt = null, retryPolicy = "Exponential backoff, 5 attempts",
  failureCount = 0, signatureVerificationRequired = true,
}) {
  return {
    id, providerKey, connectionId, organizationId, eventName, status,
    endpointLabel: "preview-endpoint.local (simulated)", lastEventAt, retryPolicy,
    failureCount, signatureVerificationRequired, backendNotice: WEBHOOK_BACKEND_NOTICE,
  };
}

export function createIntegrationAuditEvent({
  id, occurredAt = new Date().toISOString(), actor, organizationId, providerKey = null,
  connectionId = null, event, details = null, source = "Integration Center",
  result = "Success", recordsAffected = null, durationMs = null, correlationId = null,
  retryEligible = false,
}) {
  return {
    id, occurredAt, actor, organizationId, providerKey, connectionId, event, details, source,
    result, recordsAffected, durationMs, correlationId: correlationId || id, retryEligible,
  };
}

export function createIntegrationOrganizationPolicy({
  organizationId, allowedCategories = null, requireApprovalForConnect = false,
  maxConnectionsPerProvider = null, updatedBy = null, updatedAt = null,
}) {
  return { organizationId, allowedCategories, requireApprovalForConnect, maxConnectionsPerProvider, updatedBy, updatedAt };
}

// ---------------------------------------------------------------------------
// Date helpers — relative to "now" so seeded expirations/timestamps never go
// stale the way a hardcoded literal would (same lesson learned in
// mockAccessData.js).
// ---------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}
function hoursAgo(n) {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Provider catalog — the 13 essential providers. Global, not org-scoped.
// PHASE2_PROVIDERS (Sales & Marketing Integrations) is imported below and
// concatenated onto this base set — this file stays the sole owner of
// PROVIDERS construction (never mutated via push from elsewhere), per the
// Phase 2 plan's decision on avoiding load-order/circular-import risk.
// ---------------------------------------------------------------------------
export const BASE_PROVIDERS = [
  createIntegrationProvider({
    key: "google_workspace",
    name: "Google Workspace",
    category: "Productivity",
    icon: "Mail",
    shortDescription: "Gmail, Calendar, Meet, Contacts and Drive for one organization's Google account.",
    longDescription:
      "Google Workspace connects Gmail, Google Calendar, Google Meet, Google Contacts and Google Drive to the CRM. Google Meet is part of the Calendar workflow, not a separate integration — meeting links are generated as part of creating a calendar activity.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Plan Dependent",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Plan Dependent", notes: "Requires a Google Workspace plan with API access enabled for the organization's admin." }),
    supportedModules: ["Leads", "Contacts", "Companies", "Activities", "Deals"],
    capabilities: [
      createIntegrationCapability({ id: "gws_gmail_activity", name: "Associate email previews with CRM records", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view", sensitiveData: true, description: "Preview of Gmail messages linked to a Lead, Contact or Deal — headers and preview text only." }),
      createIntegrationCapability({ id: "gws_calendar_activity", name: "Create calendar activities", crmModule: "Activities", direction: "write", requiredPermission: "integrations.sync.run" }),
      createIntegrationCapability({ id: "gws_meet_link", name: "Generate meeting-link previews (Google Meet)", crmModule: "Activities", direction: "write", requiredPermission: "integrations.sync.run", description: "Part of the Calendar workflow — not a standalone integration." }),
      createIntegrationCapability({ id: "gws_drive_files", name: "Attach Drive-file references", crmModule: "Deals", direction: "read", requiredPermission: "integrations.mappings.view" }),
      // Documents, Storage and Electronic Signature Integrations (Phase 6)
      // extension — broadens the existing single Drive capability above to
      // shared drives, folders, sharing/permissions and version metadata
      // across the CRM records the spec lists, not just Deals.
      createIntegrationCapability({ id: "gws_drive_folders", name: "Drives, Shared drives and Folders", crmModule: "Organization", direction: "read", requiredPermission: "folder_mappings.view" }),
      createIntegrationCapability({ id: "gws_drive_sharing_permissions", name: "Permissions and Sharing state", crmModule: "Organization", direction: "read", requiredPermission: "file_permissions.view", sensitiveData: true }),
      createIntegrationCapability({ id: "gws_drive_versions", name: "Version metadata", crmModule: "Organization", direction: "read", requiredPermission: "file_versions.view" }),
      createIntegrationCapability({ id: "gws_invite_preview", name: "Preview invitation-email delivery", crmModule: "Contacts", direction: "write", requiredPermission: "integrations.sync.run", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "gws_contacts_sync", name: "Synchronize permitted contacts", crmModule: "Contacts", direction: "both", requiredPermission: "integrations.mappings.manage", sensitiveData: true }),
      // Customer Support and Communication Integrations (Phase 3)
      createIntegrationCapability({ id: "gws_support_email_channel", name: "Gmail as a support-email channel", crmModule: "Activities", direction: "read", requiredPermission: "support_channels.view", sensitiveData: true, description: "Preview of support-inbox email threads routed into the omnichannel inbox. Reply/note previews only — no real email is sent." }),
    ],
    dataLeavingCrm: ["Contact names and emails for permitted CRM contacts", "Activity subject lines for calendar event creation"],
    dataEnteringCrm: ["Gmail message previews (subject, snippet, timestamp)", "Calendar event confirmations", "Google Meet links", "Drive file references (name and link only)"],
    knownLimitations: ["Full email body content is never imported, only previews.", "Shared/team Drive files require the organization's own sharing permissions."],
    securityNotes: ["Least-privilege scopes only (no full-mailbox access requested).", "Organization Administrator controls which users are included in contact sync."],
  }),
  createIntegrationProvider({
    key: "microsoft_365",
    name: "Microsoft 365",
    category: "Productivity",
    icon: "Mail",
    shortDescription: "Outlook Mail, Outlook Calendar, Microsoft Teams, Contacts and OneDrive.",
    longDescription: "Microsoft 365 connects Outlook Mail, Outlook Calendar, Microsoft Teams meeting links, Microsoft Contacts and OneDrive file references to the CRM.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Plan Dependent",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Plan Dependent", notes: "Requires a Microsoft 365 plan with Graph API access enabled." }),
    supportedModules: ["Leads", "Contacts", "Companies", "Activities", "Deals"],
    capabilities: [
      createIntegrationCapability({ id: "m365_email_activity", name: "Email activity", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view", sensitiveData: true }),
      createIntegrationCapability({ id: "m365_calendar_sync", name: "Calendar synchronization", crmModule: "Activities", direction: "both", requiredPermission: "integrations.sync.run" }),
      createIntegrationCapability({ id: "m365_teams_link", name: "Teams meeting-link preview", crmModule: "Activities", direction: "write", requiredPermission: "integrations.sync.run" }),
      createIntegrationCapability({ id: "m365_contacts_sync", name: "Contact synchronization", crmModule: "Contacts", direction: "both", requiredPermission: "integrations.mappings.manage", sensitiveData: true }),
      createIntegrationCapability({ id: "m365_onedrive_files", name: "File references (OneDrive)", crmModule: "Deals", direction: "read", requiredPermission: "integrations.mappings.view" }),
      // Documents, Storage and Electronic Signature Integrations (Phase 6)
      // extension — broadens the existing single OneDrive capability above
      // to drives/sites, folders, sharing/permissions and version metadata.
      createIntegrationCapability({ id: "m365_onedrive_folders", name: "Drives, Sites and Folders", crmModule: "Organization", direction: "read", requiredPermission: "folder_mappings.view" }),
      createIntegrationCapability({ id: "m365_onedrive_sharing_permissions", name: "Permissions and Sharing state", crmModule: "Organization", direction: "read", requiredPermission: "file_permissions.view", sensitiveData: true }),
      createIntegrationCapability({ id: "m365_onedrive_versions", name: "Version metadata", crmModule: "Organization", direction: "read", requiredPermission: "file_versions.view" }),
      // Customer Support and Communication Integrations (Phase 3)
      createIntegrationCapability({ id: "m365_support_email_channel", name: "Outlook as a support-email channel", crmModule: "Activities", direction: "read", requiredPermission: "support_channels.view", sensitiveData: true, description: "Preview of support-inbox email threads routed into the omnichannel inbox. Reply/note previews only — no real email is sent." }),
      createIntegrationCapability({ id: "m365_teams_escalation", name: "Microsoft Teams as an internal-escalation channel", crmModule: "Activities", direction: "write", requiredPermission: "support_escalations.manage", description: "Escalation-notification preview only — no real Teams message is posted in this phase." }),
      // Projects and Development Integrations (Phase 4) — Microsoft Teams
      // already lives as capabilities on this provider (m365_teams_link/
      // m365_teams_escalation above); no standalone Teams provider card is
      // created. Preview only — no real Teams message is ever posted.
      createIntegrationCapability({ id: "m365_teams_project_notifications", name: "Microsoft Teams project and deployment notifications", crmModule: "Activities", direction: "write", requiredPermission: "project_integrations.view", description: "Notification preview only (Project created/at risk, milestone approaching/overdue, critical issue, task blocked, PR awaiting review, build/deployment failed, release completed, sync error) — no real Teams message is posted in this phase." }),
    ],
    dataLeavingCrm: ["Contact names and emails for permitted CRM contacts", "Activity subject lines for calendar event creation"],
    dataEnteringCrm: ["Outlook message previews", "Calendar event confirmations", "Teams meeting links", "OneDrive file references"],
    knownLimitations: ["Full email body content is never imported, only previews.", "Requires tenant admin consent for organization-wide scopes."],
    securityNotes: ["Least-privilege Graph API scopes only.", "Organization Administrator controls which users are included."],
  }),
  createIntegrationProvider({
    key: "slack",
    name: "Slack",
    category: "Internal Communication",
    icon: "MessageSquare",
    shortDescription: "Send CRM notifications into a Slack workspace channel.",
    longDescription: "Slack connects one workspace and one or more channels to receive CRM notifications — assignment alerts, approval alerts, deal updates, contract-expiration alerts and AI Intelligence alerts. This does not preview importing entire Slack conversations into the CRM.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Free Tier Available",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Free Tier Available", notes: "Works on Slack's free tier; message history limits may apply on the Slack side." }),
    supportedModules: ["Deals", "Activities", "Contracts"],
    capabilities: [
      createIntegrationCapability({ id: "slack_workspace", name: "Workspace connection", crmModule: "Activities", direction: "write", requiredPermission: "integrations.connections.create" }),
      createIntegrationCapability({ id: "slack_channel_select", name: "Channel selection", crmModule: "Activities", direction: "write", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "slack_assignment_alerts", name: "Assignment alerts", crmModule: "Deals", direction: "write", requiredPermission: "integrations.sync.run" }),
      createIntegrationCapability({ id: "slack_approval_alerts", name: "Approval alerts", crmModule: "Deals", direction: "write", requiredPermission: "integrations.sync.run" }),
      createIntegrationCapability({ id: "slack_deal_updates", name: "Deal updates", crmModule: "Deals", direction: "write", requiredPermission: "integrations.sync.run" }),
      createIntegrationCapability({ id: "slack_contract_expiration", name: "Contract-expiration alerts", crmModule: "Contracts", direction: "write", requiredPermission: "integrations.sync.run" }),
      createIntegrationCapability({ id: "slack_ai_alerts", name: "AI Intelligence alerts", crmModule: "Activities", direction: "write", requiredPermission: "integrations.sync.run" }),
      // Customer Support and Communication Integrations (Phase 3)
      createIntegrationCapability({ id: "slack_support_escalation", name: "Internal-escalation channel", crmModule: "Activities", direction: "write", requiredPermission: "support_escalations.manage", description: "Escalation-notification preview only — no real Slack message is posted in this phase." }),
      // Projects and Development Integrations (Phase 4)
      createIntegrationCapability({ id: "slack_project_deployment_notifications", name: "Project and deployment notifications", crmModule: "Deals", direction: "write", requiredPermission: "project_integrations.view", description: "Notification preview only (Project created/at risk, milestone approaching/overdue, critical issue, task blocked, PR awaiting review, build/deployment failed, release completed, sync error) — no real Slack message is posted in this phase." }),
    ],
    dataLeavingCrm: ["Notification text only (deal name, assignee, contract expiration date)"],
    dataEnteringCrm: ["Nothing — Slack is notification-only in this phase"],
    knownLimitations: ["Does not import Slack conversations or channel history into the CRM."],
    securityNotes: ["Bot scoped to posting into explicitly selected channels only."],
  }),
  createIntegrationProvider({
    key: "whatsapp_business",
    name: "WhatsApp Business",
    category: "Customer Messaging",
    icon: "MessageCircle",
    shortDescription: "Approved-template customer messaging via WhatsApp Business.",
    longDescription: "WhatsApp Business previews approved-template customer messaging, incoming replies, delivery and read status. Production templates and Meta business verification will be required before any real message can be sent.",
    authMethod: "API Key",
    pricingClassification: "Usage-Based Provider",
    planRequirement: createIntegrationPlanRequirement({ classification: "Usage-Based Provider", notes: "WhatsApp Business API pricing is conversation-based and set by Meta/the provider, not this CRM." }),
    credentialFieldInfo: { label: "WhatsApp Business API Key", disabledPlaceholder: CREDENTIAL_PLACEHOLDER_TEXT },
    supportedModules: ["Contacts", "Deals", "Activities"],
    capabilities: [
      createIntegrationCapability({ id: "wa_customer_messaging", name: "Customer messaging", crmModule: "Contacts", direction: "write", requiredPermission: "integrations.sync.run", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "wa_approved_templates", name: "Approved templates", crmModule: "Contacts", direction: "write", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "wa_incoming_replies", name: "Incoming replies", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view", sensitiveData: true }),
      createIntegrationCapability({ id: "wa_delivery_status", name: "Delivery status", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "wa_read_status", name: "Read status", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "wa_consent", name: "Consent requirement", crmModule: "Contacts", direction: "write", requiredPermission: "integrations.mappings.manage", requiresHumanApproval: true, description: "Recipient consent must be recorded before messaging." }),
      createIntegrationCapability({ id: "wa_opt_out", name: "Opt-out behavior", crmModule: "Contacts", direction: "write", requiredPermission: "integrations.mappings.manage" }),
      // Customer Support and Communication Integrations (Phase 3)
      createIntegrationCapability({ id: "wa_support_messaging_channel", name: "Customer-messaging support channel", crmModule: "Activities", direction: "both", requiredPermission: "support_channels.view", sensitiveData: true, description: "Preview of WhatsApp conversations routed into the omnichannel inbox." }),
    ],
    dataLeavingCrm: ["Approved template content and recipient phone number"],
    dataEnteringCrm: ["Reply text previews", "Delivery/read receipts"],
    knownLimitations: ["Production message templates and WhatsApp Business verification are required before real sending — not available in this frontend phase.", "Only pre-approved templates may be used in production."],
    securityNotes: ["Consent and opt-out state must be recorded per contact before any real message could be sent."],
  }),
  createIntegrationProvider({
    key: "twilio",
    name: "Twilio",
    category: "Customer Messaging",
    icon: "PhoneCall",
    shortDescription: "SMS, WhatsApp and Voice messaging via Twilio.",
    longDescription: "Twilio previews SMS, WhatsApp and Voice communication, sender/number selection, delivery status and failed-message reporting. Twilio is a usage-based provider — costs are billed directly by Twilio.",
    authMethod: "API Key",
    pricingClassification: "Usage-Based Provider",
    planRequirement: createIntegrationPlanRequirement({ classification: "Usage-Based Provider", notes: "Twilio bills per message/call/minute directly to the organization's Twilio account." }),
    credentialFieldInfo: { label: "Twilio Auth Token", disabledPlaceholder: CREDENTIAL_PLACEHOLDER_TEXT },
    supportedModules: ["Contacts", "Deals", "Activities"],
    capabilities: [
      createIntegrationCapability({ id: "twilio_sms", name: "SMS", crmModule: "Activities", direction: "write", requiredPermission: "integrations.sync.run", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "twilio_whatsapp", name: "WhatsApp", crmModule: "Activities", direction: "write", requiredPermission: "integrations.sync.run", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "twilio_voice", name: "Voice", crmModule: "Activities", direction: "write", requiredPermission: "integrations.sync.run", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "twilio_sender_select", name: "Sender or number selection", crmModule: "Activities", direction: "write", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "twilio_delivery_status", name: "Delivery status", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "twilio_failed_reporting", name: "Failed-message reporting", crmModule: "Activities", direction: "read", requiredPermission: "integrations.errors.retry" }),
      // Customer Support and Communication Integrations (Phase 3)
      createIntegrationCapability({ id: "twilio_support_messaging_channel", name: "Customer-messaging support channel", crmModule: "Activities", direction: "both", requiredPermission: "support_channels.view", sensitiveData: true, description: "Preview of SMS/voice conversations routed into the omnichannel inbox." }),
    ],
    dataLeavingCrm: ["Message content and recipient number for outbound SMS/WhatsApp/Voice"],
    dataEnteringCrm: ["Delivery status", "Failure reason codes"],
    knownLimitations: ["Usage-based provider costs are billed directly by Twilio and are not shown as exact figures here."],
    securityNotes: ["Sender/number selection is restricted to numbers already verified on the organization's own Twilio account."],
  }),
  createIntegrationProvider({
    key: "calendly",
    name: "Calendly",
    category: "Calendar",
    icon: "CalendarClock",
    shortDescription: "Booking links and scheduled-event previews for Calendly.",
    longDescription: "Calendly previews booking links, scheduled/rescheduled/cancelled events, contact matching against existing CRM contacts, and CRM Activity creation.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Free Tier Available",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Free Tier Available", notes: "Some booking-link features require a paid Calendly plan." }),
    supportedModules: ["Contacts", "Activities", "Deals"],
    capabilities: [
      createIntegrationCapability({ id: "cal_booking_links", name: "Booking links", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "cal_scheduled_events", name: "Scheduled events", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "cal_rescheduled_events", name: "Rescheduled events", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "cal_cancelled_events", name: "Cancelled events", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "cal_contact_matching", name: "Contact matching", crmModule: "Contacts", direction: "read", requiredPermission: "integrations.mappings.view" }),
      createIntegrationCapability({ id: "cal_activity_creation", name: "CRM Activity creation preview", crmModule: "Activities", direction: "write", requiredPermission: "integrations.sync.run" }),
    ],
    dataLeavingCrm: ["Nothing required to leave the CRM for booking-link display"],
    dataEnteringCrm: ["Scheduled/rescheduled/cancelled event details", "Invitee contact details"],
    knownLimitations: ["Contact matching is best-effort by email address only."],
    securityNotes: ["Only invitee details for meetings the organization booked are imported."],
  }),
  createIntegrationProvider({
    key: "zoom",
    name: "Zoom",
    category: "Meetings",
    icon: "Video",
    shortDescription: "Meeting creation, links, attendance and recording availability previews.",
    longDescription: "Zoom previews meeting creation, meeting links, attendance, and whether a recording or transcript is available. Recording and transcript CONTENT is never shown in this phase.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Plan Dependent",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Plan Dependent", notes: "Cloud recording and transcript availability depend on the organization's Zoom plan." }),
    supportedModules: ["Activities", "Deals", "Contacts"],
    capabilities: [
      createIntegrationCapability({ id: "zoom_meeting_creation", name: "Meeting creation", crmModule: "Activities", direction: "write", requiredPermission: "integrations.sync.run" }),
      createIntegrationCapability({ id: "zoom_meeting_links", name: "Meeting links", crmModule: "Activities", direction: "write", requiredPermission: "integrations.sync.run" }),
      createIntegrationCapability({ id: "zoom_attendance", name: "Attendance", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "zoom_recording_availability", name: "Recording availability", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view", sensitiveData: true, description: "Availability flag only — recording content is never shown in this phase." }),
      createIntegrationCapability({ id: "zoom_transcript_availability", name: "Transcript availability", crmModule: "Activities", direction: "read", requiredPermission: "integrations.sync.view", sensitiveData: true, description: "Availability flag only — transcript content is never shown in this phase." }),
    ],
    dataLeavingCrm: ["Meeting topic and invitee list for meeting creation"],
    dataEnteringCrm: ["Meeting link", "Attendance list", "Recording/transcript availability flags only"],
    knownLimitations: ["Recording and transcript content are never displayed in this phase.", "Requires host-level Zoom permissions on the organization's account."],
    securityNotes: ["Consent and data-retention requirements for recordings/transcripts must be handled per the organization's own Zoom account policy."],
  }),
  createIntegrationProvider({
    key: "stripe",
    name: "Stripe",
    category: "Payments",
    icon: "CreditCard",
    shortDescription: "Customers, payment links, payments, invoices, refunds and subscriptions.",
    longDescription: "Stripe previews customers, payment links, payments, invoices, refunds, subscriptions and payment status. Full card details are never processed or simulated — only masked payment fixture values are ever shown.",
    authMethod: "API Key",
    pricingClassification: "Transaction-Based Provider",
    planRequirement: createIntegrationPlanRequirement({ classification: "Transaction-Based Provider", notes: "Stripe charges a per-transaction processing fee, billed directly by Stripe." }),
    credentialFieldInfo: { label: "Stripe Secret Key", disabledPlaceholder: CREDENTIAL_PLACEHOLDER_TEXT },
    supportedModules: ["Deals", "Quotes", "Orders", "Contracts"],
    capabilities: [
      createIntegrationCapability({ id: "stripe_customers", name: "Customers", crmModule: "Companies", direction: "both", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "stripe_payment_links", name: "Payment links", crmModule: "Quotes", direction: "write", requiredPermission: "integrations.sync.run" }),
      createIntegrationCapability({ id: "stripe_payments", name: "Payments", crmModule: "Orders", direction: "read", requiredPermission: "integrations.sync.view", sensitiveData: true }),
      createIntegrationCapability({ id: "stripe_invoices", name: "Invoices", crmModule: "Orders", direction: "both", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "stripe_refunds", name: "Refunds", crmModule: "Orders", direction: "write", requiredPermission: "integrations.sync.run", requiresHumanApproval: true, sensitiveData: true }),
      createIntegrationCapability({ id: "stripe_subscriptions", name: "Subscriptions", crmModule: "Contracts", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "stripe_payment_status", name: "Payment status", crmModule: "Orders", direction: "read", requiredPermission: "integrations.sync.view" }),
      // Commerce and Finance Integrations (Phase 5) extension.
      createIntegrationCapability({ id: "stripe_fees", name: "Fees", crmModule: "Orders", direction: "read", requiredPermission: "integrations.sync.view", sensitiveData: true }),
      createIntegrationCapability({ id: "stripe_payouts", name: "Payout references", crmModule: "Orders", direction: "read", requiredPermission: "integrations.sync.view", sensitiveData: true }),
    ],
    dataLeavingCrm: ["Customer name, email and order amount for payment-link creation"],
    dataEnteringCrm: ["Masked payment fixture values only (e.g. •••• 4242)", "Invoice and subscription status"],
    knownLimitations: ["Full card numbers, CVCs and full account numbers are never processed or displayed — masked values only."],
    securityNotes: ["Refunds always require human approval before any preview action is marked complete."],
  }),
  createIntegrationProvider({
    key: "quickbooks_online",
    name: "QuickBooks Online",
    category: "Accounting",
    icon: "Calculator",
    shortDescription: "Customers, products/services, invoices, payments, taxes and credit notes.",
    longDescription: "QuickBooks Online previews customers, products and services, invoices, payments, taxes, credit notes and outstanding balances. QuickBooks remains the financial ledger of record; the CRM remains the sales source of truth.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Subscription Required",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Subscription Required", notes: "Requires an active QuickBooks Online subscription with API access." }),
    supportedModules: ["Companies", "Products and Services", "Orders", "Contracts"],
    capabilities: [
      createIntegrationCapability({ id: "qbo_customers", name: "Customers", crmModule: "Companies", direction: "both", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "qbo_products", name: "Products and Services", crmModule: "Products and Services", direction: "both", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "qbo_invoices", name: "Invoices", crmModule: "Orders", direction: "both", requiredPermission: "integrations.mappings.manage", sensitiveData: true }),
      createIntegrationCapability({ id: "qbo_payments", name: "Payments", crmModule: "Orders", direction: "read", requiredPermission: "integrations.sync.view", sensitiveData: true }),
      createIntegrationCapability({ id: "qbo_taxes", name: "Taxes", crmModule: "Orders", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "qbo_credit_notes", name: "Credit notes", crmModule: "Orders", direction: "both", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "qbo_outstanding_balances", name: "Outstanding balances", crmModule: "Companies", direction: "read", requiredPermission: "integrations.sync.view", sensitiveData: true }),
      // Commerce and Finance Integrations (Phase 5) extension.
      createIntegrationCapability({ id: "qbo_ledger_mapping", name: "Ledger-account mapping", crmModule: "Orders", direction: "both", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "qbo_reconciliation_reference", name: "Reconciliation references", crmModule: "Orders", direction: "read", requiredPermission: "integrations.sync.view" }),
    ],
    dataLeavingCrm: ["Customer and order details for invoice creation"],
    dataEnteringCrm: ["Invoice, payment and balance status only — QuickBooks remains the ledger of record"],
    knownLimitations: ["This CRM does not replace QuickBooks as the financial system of record."],
    securityNotes: ["Financial figures visible here are read-only previews, never editable from the CRM."],
  }),
  createIntegrationProvider({
    key: "xero",
    name: "Xero",
    category: "Accounting",
    icon: "Calculator",
    shortDescription: "Customers, products/services, invoices, payments, taxes and credit notes.",
    longDescription: "Xero previews customers, products and services, invoices, payments, taxes, credit notes and outstanding balances. Xero remains the financial ledger of record; the CRM remains the sales source of truth.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Subscription Required",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Subscription Required", notes: "Requires an active Xero subscription with API access." }),
    supportedModules: ["Companies", "Products and Services", "Orders", "Contracts"],
    capabilities: [
      createIntegrationCapability({ id: "xero_customers", name: "Customers", crmModule: "Companies", direction: "both", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "xero_products", name: "Products and Services", crmModule: "Products and Services", direction: "both", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "xero_invoices", name: "Invoices", crmModule: "Orders", direction: "both", requiredPermission: "integrations.mappings.manage", sensitiveData: true }),
      createIntegrationCapability({ id: "xero_payments", name: "Payments", crmModule: "Orders", direction: "read", requiredPermission: "integrations.sync.view", sensitiveData: true }),
      createIntegrationCapability({ id: "xero_taxes", name: "Taxes", crmModule: "Orders", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "xero_credit_notes", name: "Credit notes", crmModule: "Orders", direction: "both", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "xero_outstanding_balances", name: "Outstanding balances", crmModule: "Companies", direction: "read", requiredPermission: "integrations.sync.view", sensitiveData: true }),
      // Commerce and Finance Integrations (Phase 5) extension.
      createIntegrationCapability({ id: "xero_ledger_mapping", name: "Ledger-account mapping", crmModule: "Orders", direction: "both", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "xero_reconciliation_reference", name: "Reconciliation references", crmModule: "Orders", direction: "read", requiredPermission: "integrations.sync.view" }),
    ],
    dataLeavingCrm: ["Customer and order details for invoice creation"],
    dataEnteringCrm: ["Invoice, payment and balance status only — Xero remains the ledger of record"],
    knownLimitations: ["This CRM does not replace Xero as the financial system of record."],
    securityNotes: ["Financial figures visible here are read-only previews, never editable from the CRM."],
  }),
  createIntegrationProvider({
    key: "docusign",
    name: "DocuSign",
    category: "Electronic Signature",
    icon: "PenTool",
    shortDescription: "Quote, proposal, order, contract and renewal signing previews.",
    longDescription: "DocuSign previews quote, proposal, order, contract and renewal signing workflows and envelope status (Draft, Sent, Viewed, Signed, Declined, Expired, Voided).",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Subscription Required",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Subscription Required", notes: "Requires an active DocuSign subscription with API/envelope access." }),
    supportedModules: ["Quotes", "Orders", "Contracts"],
    capabilities: [
      createIntegrationCapability({ id: "ds_quote_signing", name: "Quote signing", crmModule: "Quotes", direction: "write", requiredPermission: "integrations.sync.run", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "ds_proposal_signing", name: "Proposal signing", crmModule: "Quotes", direction: "write", requiredPermission: "integrations.sync.run", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "ds_order_signing", name: "Order signing", crmModule: "Orders", direction: "write", requiredPermission: "integrations.sync.run", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "ds_contract_signing", name: "Contract signing", crmModule: "Contracts", direction: "write", requiredPermission: "integrations.sync.run", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "ds_renewal_signing", name: "Renewal signing", crmModule: "Contracts", direction: "write", requiredPermission: "integrations.sync.run", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "ds_envelope_status", name: "Envelope status", crmModule: "Contracts", direction: "read", requiredPermission: "integrations.sync.view" }),
      // Documents, Storage and Electronic Signature Integrations (Phase 6)
      // extension.
      createIntegrationCapability({ id: "ds_templates", name: "Templates", crmModule: "Contracts", direction: "read", requiredPermission: "signature_templates.view" }),
      createIntegrationCapability({ id: "ds_recipients_routing", name: "Recipients and Signing order", crmModule: "Contracts", direction: "read", requiredPermission: "signature_workflows.view" }),
      createIntegrationCapability({ id: "ds_reminders_expiration", name: "Reminders and Expiration", crmModule: "Contracts", direction: "read", requiredPermission: "signature_workflows.remind_preview" }),
      createIntegrationCapability({ id: "ds_certificate_metadata", name: "Certificate metadata", crmModule: "Contracts", direction: "read", requiredPermission: "signature_audit.view", sensitiveData: true }),
    ],
    dataLeavingCrm: ["Document metadata and signer details for envelope creation"],
    dataEnteringCrm: ["Envelope status only (Draft/Sent/Viewed/Signed/Declined/Expired/Voided) — document content is not previewed"],
    knownLimitations: ["Documents are never actually sent or signed in this phase — envelope status is simulated."],
    securityNotes: ["Every signing action requires human approval before a preview envelope is marked as sent."],
  }),
  createIntegrationProvider({
    key: "zapier",
    name: "Zapier",
    category: "Automation",
    icon: "Zap",
    shortDescription: "Workflow triggers and actions via Zapier's automation platform.",
    longDescription: "Zapier previews workflow triggers, workflow actions, event history and webhook-based external automation. Not every third-party application available on Zapier is automatically supported by this CRM.",
    authMethod: "Webhook Secret",
    pricingClassification: "Provider Plan Dependent",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Plan Dependent", notes: "Zapier's own plan limits the number of active Zaps and task volume." }),
    credentialFieldInfo: { label: "Zapier Webhook Signing Secret", disabledPlaceholder: CREDENTIAL_PLACEHOLDER_TEXT },
    supportedModules: ["Leads", "Contacts", "Deals", "Activities"],
    capabilities: [
      createIntegrationCapability({ id: "zapier_triggers", name: "Workflow triggers", crmModule: "Deals", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "zapier_actions", name: "Workflow actions", crmModule: "Leads", direction: "write", requiredPermission: "integrations.sync.run" }),
      createIntegrationCapability({ id: "zapier_event_history", name: "Event history", crmModule: "Activities", direction: "read", requiredPermission: "integrations.activity.view" }),
      createIntegrationCapability({ id: "zapier_external_automation", name: "External automation", crmModule: "Deals", direction: "both", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "zapier_webhooks", name: "Webhook-based workflows", crmModule: "Activities", direction: "both", requiredPermission: "integrations.webhooks.manage" }),
      createIntegrationCapability({ id: "zapier_failed_automation", name: "Failed automation reporting", crmModule: "Activities", direction: "read", requiredPermission: "integrations.errors.retry" }),
    ],
    dataLeavingCrm: ["Fields explicitly mapped in a given Zap's trigger/action configuration"],
    dataEnteringCrm: ["Records created/updated by an incoming Zap action, per configured field mappings"],
    knownLimitations: ["Not every third-party app available on Zapier is automatically supported — only explicitly mapped triggers/actions are previewed."],
    securityNotes: ["Webhook payloads are verified against a signing secret before being treated as trusted in production."],
  }),
  createIntegrationProvider({
    key: "make",
    name: "Make",
    category: "Automation",
    icon: "Workflow",
    shortDescription: "Workflow triggers and actions via Make's automation platform.",
    longDescription: "Make (formerly Integromat) previews workflow triggers, workflow actions, event history and webhook-based external automation. Not every third-party application available on Make is automatically supported by this CRM.",
    authMethod: "Webhook Secret",
    pricingClassification: "Provider Plan Dependent",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Plan Dependent", notes: "Make's own plan limits operations and active scenarios." }),
    credentialFieldInfo: { label: "Make Webhook Signing Secret", disabledPlaceholder: CREDENTIAL_PLACEHOLDER_TEXT },
    supportedModules: ["Leads", "Contacts", "Deals", "Activities"],
    capabilities: [
      createIntegrationCapability({ id: "make_triggers", name: "Workflow triggers", crmModule: "Deals", direction: "read", requiredPermission: "integrations.sync.view" }),
      createIntegrationCapability({ id: "make_actions", name: "Workflow actions", crmModule: "Leads", direction: "write", requiredPermission: "integrations.sync.run" }),
      createIntegrationCapability({ id: "make_event_history", name: "Event history", crmModule: "Activities", direction: "read", requiredPermission: "integrations.activity.view" }),
      createIntegrationCapability({ id: "make_external_automation", name: "External automation", crmModule: "Deals", direction: "both", requiredPermission: "integrations.mappings.manage" }),
      createIntegrationCapability({ id: "make_webhooks", name: "Webhook-based workflows", crmModule: "Activities", direction: "both", requiredPermission: "integrations.webhooks.manage" }),
      createIntegrationCapability({ id: "make_failed_automation", name: "Failed automation reporting", crmModule: "Activities", direction: "read", requiredPermission: "integrations.errors.retry" }),
    ],
    dataLeavingCrm: ["Fields explicitly mapped in a given scenario's trigger/action configuration"],
    dataEnteringCrm: ["Records created/updated by an incoming Make action, per configured field mappings"],
    knownLimitations: ["Not every third-party app available on Make is automatically supported — only explicitly mapped triggers/actions are previewed."],
    securityNotes: ["Webhook payloads are verified against a signing secret before being treated as trusted in production."],
  }),
];

export const PROVIDERS = [...BASE_PROVIDERS, ...PHASE2_PROVIDERS, ...PHASE3_PROVIDERS, ...PHASE4_PROVIDERS, ...PHASE5_PROVIDERS, ...PHASE6_PROVIDERS, ...PHASE7_PROVIDERS];

export function findProvider(providerKey) {
  return PROVIDERS.find((p) => p.key === providerKey) || null;
}

export function queryProvidersLocal(filters = {}) {
  let results = PROVIDERS.slice();
  const search = (filters.search || "").trim().toLowerCase();
  if (search) {
    results = results.filter((p) => p.name.toLowerCase().includes(search) || p.shortDescription.toLowerCase().includes(search));
  }
  if (filters.category) results = results.filter((p) => p.category === filters.category);
  if (filters.authMethod) results = results.filter((p) => p.authMethod === filters.authMethod);
  if (filters.pricingClassification) results = results.filter((p) => p.pricingClassification === filters.pricingClassification);
  if (filters.module) results = results.filter((p) => p.supportedModules.includes(filters.module));
  if (filters.sort === "name_desc") results.sort((a, b) => b.name.localeCompare(a.name));
  else results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

// ---------------------------------------------------------------------------
// Seeded connections — org-scoped. IDs are stable strings, not generated, so
// tests/fixtures can reference them directly (same convention as
// mockAccessData.js's invite_1..invite_10).
// ---------------------------------------------------------------------------
const ORG_HQ = ORGANIZATIONS[0]?.id || DEFAULT_ORGANIZATION_ID;
const ORG_NIMBUS = ORGANIZATIONS[1]?.id || ORG_HQ;
const ORG_SOLSTICE = ORGANIZATIONS[2]?.id || ORG_HQ;

let seedSyncJobSeq = 0;
function seedSyncJob({ connectionId, jobType = "Scheduled Sync", examined, created = 0, updated = 0, skipped = 0, conflicted = 0, failed = 0, hoursAgoStarted = 3, triggeredBy = "System" }) {
  seedSyncJobSeq += 1;
  const startedDate = hoursAgo(hoursAgoStarted);
  const completedDate = hoursAgo(hoursAgoStarted - 0.02);
  const result = createIntegrationSyncResult({
    id: `seed_sync_result_${seedSyncJobSeq}`, jobType, recordsExamined: examined, created, updated, skipped, conflicted, failed, startedDate, completedDate, triggeredBy,
  });
  return createIntegrationSyncJob({ id: `seed_sync_job_${seedSyncJobSeq}`, connectionId, jobType, status: failed > 0 ? "Failed" : "Completed", result });
}

export const CONNECTIONS = [
  createIntegrationConnection({
    id: "conn_1", providerKey: "slack", organizationId: ORG_HQ, status: "Preview Connected",
    connectedByName: "Priya Nair", createdDate: daysAgo(40),
    capabilities: ["slack_workspace", "slack_channel_select", "slack_deal_updates", "slack_assignment_alerts"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Export Only", scheduleFrequency: "Real-time (webhook-triggered)", notifyOnFailure: true }),
    lastSyncedAt: hoursAgo(2),
    health: createIntegrationHealth({ status: "Healthy", lastCheckedAt: hoursAgo(2) }),
    syncJobs: [seedSyncJob({ connectionId: "conn_1", jobType: "Webhook-Triggered Sync", examined: 6, created: 6, hoursAgoStarted: 2, triggeredBy: "Webhook" })],
    fieldMappings: [
      createIntegrationFieldMapping({ id: "map_conn1_1", crmEntity: "Deals", crmField: "name", providerEntity: "Message", providerField: "deal_name", direction: "Export Only", required: true, conflictRule: "CRM Wins" }),
      createIntegrationFieldMapping({ id: "map_conn1_2", crmEntity: "Deals", crmField: "stage", providerEntity: "Message", providerField: "stage_label", direction: "Export Only", conflictRule: "CRM Wins" }),
    ],
  }),
  createIntegrationConnection({
    id: "conn_2", providerKey: "google_workspace", organizationId: ORG_HQ, status: "Attention Required",
    connectedByName: "Priya Nair", createdDate: daysAgo(70),
    capabilities: ["gws_gmail_activity", "gws_calendar_activity", "gws_meet_link", "gws_contacts_sync"],
    dataScope: "Selected Users",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Bidirectional", scheduleFrequency: "Every 15 minutes" }),
    lastSyncedAt: hoursAgo(26),
    health: createIntegrationHealth({
      status: "Attention Required", lastCheckedAt: hoursAgo(1),
      issues: ["Contact sync permission preview expired — a member must review and re-confirm requested permissions."],
    }),
    recentErrors: [
      createIntegrationError({ id: "err_1", occurredAt: hoursAgo(26), code: "permission_preview_expired", message: "Contact sync permission preview expired.", retryEligible: true }),
    ],
    fieldMappings: [
      createIntegrationFieldMapping({ id: "map_conn2_1", crmEntity: "Contacts", crmField: "email", providerEntity: "Contact", providerField: "emailAddress", direction: "Bidirectional", required: true, conflictRule: "Most Recently Updated Wins" }),
      createIntegrationFieldMapping({ id: "map_conn2_2", crmEntity: "Contacts", crmField: "fullName", providerEntity: "Contact", providerField: "displayName", direction: "Bidirectional", conflictRule: "Most Recently Updated Wins" }),
      createIntegrationFieldMapping({ id: "map_conn2_3", crmEntity: "Contacts", crmField: "phone", providerEntity: "Contact", providerField: "phoneNumber", direction: "Import Only", conflictRule: "Provider Wins", sensitive: true }),
    ],
  }),
  createIntegrationConnection({
    id: "conn_3", providerKey: "stripe", organizationId: ORG_HQ, status: "Configuration Required",
    connectedByName: "Priya Nair", createdDate: daysAgo(3),
    capabilities: ["stripe_customers", "stripe_payment_links"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Import Only", scheduleFrequency: "Manual" }),
    lastSyncedAt: null,
    health: createIntegrationHealth({ status: "Configuration Required", issues: ["Field mapping for Invoices has not been completed yet."] }),
    fieldMappings: [
      createIntegrationFieldMapping({ id: "map_conn3_1", crmEntity: "Companies", crmField: "name", providerEntity: "Customer", providerField: "name", direction: "Export Only", required: true, conflictRule: "CRM Wins" }),
      createIntegrationFieldMapping({ id: "map_conn3_2", crmEntity: "Companies", crmField: "billingEmail", providerEntity: "Customer", providerField: "email", direction: "Export Only", required: true, conflictRule: "CRM Wins", sensitive: true }),
      createIntegrationFieldMapping({ id: "map_conn3_3", crmEntity: "Orders", crmField: "totalAmount", providerEntity: "Invoice", providerField: "amount_due", direction: "Import Only", conflictRule: "Provider Wins", validationStatus: "Needs Review" }),
    ],
  }),
  createIntegrationConnection({
    id: "conn_4", providerKey: "docusign", organizationId: ORG_HQ, status: "Preview Paused",
    connectedByName: "Amara Okafor", createdDate: daysAgo(90),
    capabilities: ["ds_contract_signing", "ds_envelope_status"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Bidirectional", scheduleFrequency: "Manual" }),
    lastSyncedAt: daysAgo(20),
    pausedDate: daysAgo(15),
    health: createIntegrationHealth({ status: "Paused", lastCheckedAt: daysAgo(15) }),
  }),
  createIntegrationConnection({
    id: "conn_5", providerKey: "quickbooks_online", organizationId: ORG_HQ, status: "Preview Disconnected",
    connectedByName: "Amara Okafor", createdDate: daysAgo(180),
    capabilities: ["qbo_customers", "qbo_invoices"],
    dataScope: "Organization",
    lastSyncedAt: daysAgo(60),
    disconnectedDate: daysAgo(55),
    disconnectReason: "Organization switched primary accounting provider to Xero.",
    health: createIntegrationHealth({ status: "Disconnected", lastCheckedAt: daysAgo(55) }),
  }),
  createIntegrationConnection({
    id: "conn_6", providerKey: "microsoft_365", organizationId: ORG_NIMBUS, status: "Preview Connected",
    connectedByName: "Marcus Chen", createdDate: daysAgo(25),
    capabilities: ["m365_email_activity", "m365_calendar_sync", "m365_teams_link"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Bidirectional", scheduleFrequency: "Every 15 minutes" }),
    lastSyncedAt: hoursAgo(1),
    health: createIntegrationHealth({ status: "Healthy", lastCheckedAt: hoursAgo(1) }),
    syncJobs: [seedSyncJob({ connectionId: "conn_6", jobType: "Incremental Sync", examined: 34, created: 4, updated: 28, skipped: 2, hoursAgoStarted: 1, triggeredBy: "Scheduler" })],
  }),
  createIntegrationConnection({
    id: "conn_7", providerKey: "whatsapp_business", organizationId: ORG_NIMBUS, status: "Attention Required",
    connectedByName: "Marcus Chen", createdDate: daysAgo(10),
    capabilities: ["wa_customer_messaging", "wa_approved_templates"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Bidirectional", scheduleFrequency: "Real-time (webhook-triggered)" }),
    lastSyncedAt: hoursAgo(5),
    health: createIntegrationHealth({ status: "Attention Required", issues: ["Message template preview was rejected — a new template must be prepared before production use."] }),
    recentErrors: [
      createIntegrationError({ id: "err_2", occurredAt: hoursAgo(5), code: "template_rejected", message: "Approved-template preview was rejected by the provider's review guidelines simulation.", retryEligible: false }),
    ],
  }),
  createIntegrationConnection({
    id: "conn_8", providerKey: "zoom", organizationId: ORG_SOLSTICE, status: "Preview Connected",
    connectedByName: "Elena Popescu", createdDate: daysAgo(15),
    capabilities: ["zoom_meeting_creation", "zoom_meeting_links", "zoom_attendance"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Bidirectional", scheduleFrequency: "Manual" }),
    lastSyncedAt: hoursAgo(8),
    health: createIntegrationHealth({ status: "Healthy", lastCheckedAt: hoursAgo(8) }),
    syncJobs: [seedSyncJob({ connectionId: "conn_8", jobType: "Manual Sync", examined: 12, created: 3, updated: 8, failed: 1, hoursAgoStarted: 8, triggeredBy: "Elena Popescu" })],
  }),
  // Sales & Marketing Integrations (Phase 2) — same CONNECTIONS array, same
  // org scoping, spanning several new providers/statuses/orgs.
  createIntegrationConnection({
    id: "conn_9", providerKey: "mailchimp", organizationId: ORG_HQ, status: "Preview Connected",
    connectedByName: "Grace Kim", createdDate: daysAgo(35),
    capabilities: ["mc_audience_sync", "mc_campaign_reference"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Export Only", scheduleFrequency: "Every 15 minutes" }),
    lastSyncedAt: hoursAgo(4),
    health: createIntegrationHealth({ status: "Healthy", lastCheckedAt: hoursAgo(4) }),
    syncJobs: [seedSyncJob({ connectionId: "conn_9", jobType: "Incremental Sync", examined: 18, created: 2, updated: 16, hoursAgoStarted: 4, triggeredBy: "Scheduler" })],
  }),
  createIntegrationConnection({
    id: "conn_10", providerKey: "sendgrid", organizationId: ORG_HQ, status: "Preview Connected",
    connectedByName: "Priya Nair", createdDate: daysAgo(20),
    capabilities: ["sg_transactional_send", "sg_delivery_status"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Export Only", scheduleFrequency: "Real-time (webhook-triggered)" }),
    lastSyncedAt: hoursAgo(1),
    health: createIntegrationHealth({ status: "Healthy", lastCheckedAt: hoursAgo(1) }),
  }),
  createIntegrationConnection({
    id: "conn_11", providerKey: "meta_lead_ads", organizationId: ORG_NIMBUS, status: "Attention Required",
    connectedByName: "Marcus Chen", createdDate: daysAgo(12),
    capabilities: ["mla_lead_form_preview", "mla_campaign_reference"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Import Only", scheduleFrequency: "Every 15 minutes" }),
    lastSyncedAt: hoursAgo(6),
    health: createIntegrationHealth({ status: "Attention Required", issues: ["Lead-form field mapping preview needs review before new submissions are processed."] }),
  }),
  createIntegrationConnection({
    id: "conn_12", providerKey: "google_analytics_4", organizationId: ORG_SOLSTICE, status: "Preview Connected",
    connectedByName: "Elena Popescu", createdDate: daysAgo(18),
    capabilities: ["ga4_conversion_mapping", "ga4_utm_tracking"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Import Only", scheduleFrequency: "Manual" }),
    lastSyncedAt: hoursAgo(10),
    health: createIntegrationHealth({ status: "Healthy", lastCheckedAt: hoursAgo(10) }),
  }),
  createIntegrationConnection({
    id: "conn_13", providerKey: "typeform", organizationId: ORG_HQ, status: "Configuration Required",
    connectedByName: "Grace Kim", createdDate: daysAgo(5),
    capabilities: ["tf_form_connection"],
    dataScope: "Organization",
    lastSyncedAt: null,
    health: createIntegrationHealth({ status: "Configuration Required", issues: ["Required CRM fields are not yet mapped for this form."] }),
  }),
  // Customer Support and Communication Integrations (Phase 3) — same
  // CONNECTIONS array, same org scoping, spanning several new providers.
  createIntegrationConnection({
    id: "conn_14", providerKey: "zendesk", organizationId: ORG_HQ, status: "Preview Connected",
    connectedByName: "Liam O'Connor", createdDate: daysAgo(50),
    capabilities: ["zd_tickets", "zd_ticket_comments", "zd_agents", "zd_statuses", "zd_priorities"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Bidirectional", scheduleFrequency: "Every 15 minutes" }),
    lastSyncedAt: hoursAgo(1),
    health: createIntegrationHealth({ status: "Healthy", lastCheckedAt: hoursAgo(1) }),
    syncJobs: [seedSyncJob({ connectionId: "conn_14", jobType: "Incremental Sync", examined: 22, created: 3, updated: 17, skipped: 2, hoursAgoStarted: 1, triggeredBy: "Scheduler" })],
  }),
  createIntegrationConnection({
    id: "conn_15", providerKey: "intercom", organizationId: ORG_HQ, status: "Attention Required",
    connectedByName: "Liam O'Connor", createdDate: daysAgo(14),
    capabilities: ["ic_conversations", "ic_contacts", "ic_teammates"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Bidirectional", scheduleFrequency: "Real-time (webhook-triggered)" }),
    lastSyncedAt: hoursAgo(3),
    health: createIntegrationHealth({ status: "Attention Required", issues: ["Identity-match review required for 2 conversations before they can be linked to Tickets."] }),
  }),
  createIntegrationConnection({
    id: "conn_16", providerKey: "facebook_messenger", organizationId: ORG_NIMBUS, status: "Preview Connected",
    connectedByName: "Marcus Chen", createdDate: daysAgo(9),
    capabilities: ["fbm_conversations", "fbm_contact_matching"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Import Only", scheduleFrequency: "Real-time (webhook-triggered)" }),
    lastSyncedAt: hoursAgo(2),
    health: createIntegrationHealth({ status: "Healthy", lastCheckedAt: hoursAgo(2) }),
  }),
  createIntegrationConnection({
    id: "conn_17", providerKey: "aircall", organizationId: ORG_HQ, status: "Preview Connected",
    connectedByName: "Liam O'Connor", createdDate: daysAgo(30),
    capabilities: ["aircall_inbound", "aircall_outbound", "aircall_disposition"],
    dataScope: "Organization",
    syncConfiguration: createIntegrationSyncConfiguration({ direction: "Import Only", scheduleFrequency: "Real-time (webhook-triggered)" }),
    lastSyncedAt: hoursAgo(4),
    health: createIntegrationHealth({ status: "Healthy", lastCheckedAt: hoursAgo(4) }),
  }),
  createIntegrationConnection({
    id: "conn_18", providerKey: "google_business_profile", organizationId: ORG_SOLSTICE, status: "Configuration Required",
    connectedByName: "Elena Popescu", createdDate: daysAgo(6),
    capabilities: ["gbp_reviews"],
    dataScope: "Organization",
    lastSyncedAt: null,
    health: createIntegrationHealth({ status: "Configuration Required", issues: ["No responder has been assigned to draft review replies yet."] }),
  }),
];

export function findConnection(connectionId) {
  return CONNECTIONS.find((c) => c.id === connectionId) || null;
}

export function queryConnectionsLocal(filters = {}) {
  let results = CONNECTIONS.slice();
  if (filters.organizationId) results = results.filter((c) => c.organizationId === filters.organizationId);
  if (filters.providerKey) results = results.filter((c) => c.providerKey === filters.providerKey);
  if (filters.status) results = results.filter((c) => c.status === filters.status);
  return results.slice().sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function computeIntegrationMetrics(connections) {
  const todaysJobs = connections.flatMap((c) => c.syncJobs || []).filter((j) => isToday(j.result?.completedDate || j.result?.startedDate));
  return {
    availableProviders: PROVIDERS.length,
    previewConnections: connections.filter((c) => c.status === "Preview Connected").length,
    attentionRequired: connections.filter((c) => c.status === "Attention Required").length,
    syncsToday: todaysJobs.length,
    failedSyncsToday: todaysJobs.filter((j) => j.status === "Failed").length,
    providersNotConfigured: PROVIDERS.length - new Set(connections.map((c) => c.providerKey)).size,
  };
}

// ---------------------------------------------------------------------------
// Preview mutate functions
// ---------------------------------------------------------------------------
let connectionSeq = CONNECTIONS.length;
function nextConnectionId() {
  connectionSeq += 1;
  return `conn_${connectionSeq}_${Date.now().toString(36)}`;
}

export function createConnectionPreview({
  providerKey, organizationId, capabilities = [], dataScope = "Organization",
  syncConfiguration = null, fieldMappings = [], notificationPreferences = null,
  connectedByName = "Preview User",
}) {
  const provider = findProvider(providerKey);
  if (!provider) return { error: "Unknown provider." };
  const existing = CONNECTIONS.find((c) => c.providerKey === providerKey && c.organizationId === organizationId && c.status !== "Preview Disconnected");
  if (existing) return { error: "A preview connection already exists for this provider in this organization." };
  const connection = createIntegrationConnection({
    id: nextConnectionId(), providerKey, organizationId, status: "Preview Connected",
    connectedByName, capabilities, dataScope,
    syncConfiguration: syncConfiguration || createIntegrationSyncConfiguration({}),
    fieldMappings,
    notificationPreferences: notificationPreferences || { onFailure: true, onSuccess: false },
    health: createIntegrationHealth({ status: "Healthy" }),
  });
  CONNECTIONS.unshift(connection);
  recordIntegrationAuditEvent({ actor: connectedByName, organizationId, providerKey, connectionId: connection.id, event: "Preview connection created" });
  return { connection, message: PREVIEW_CONNECTION_COMPLETE_MESSAGE };
}

export function pauseConnection(connectionId, actorName) {
  const connection = findConnection(connectionId);
  if (!connection) return { error: "Connection not found." };
  connection.status = "Preview Paused";
  connection.pausedDate = new Date().toISOString();
  recordIntegrationAuditEvent({ actor: actorName, organizationId: connection.organizationId, providerKey: connection.providerKey, connectionId, event: "Preview connection paused" });
  return { connection };
}

export function resumeConnection(connectionId, actorName) {
  const connection = findConnection(connectionId);
  if (!connection) return { error: "Connection not found." };
  connection.status = "Preview Connected";
  connection.pausedDate = null;
  recordIntegrationAuditEvent({ actor: actorName, organizationId: connection.organizationId, providerKey: connection.providerKey, connectionId, event: "Preview connection resumed" });
  return { connection };
}

let lastDisconnected = null;
export function disconnectConnection(connectionId, reason, actorName) {
  if (!reason?.trim()) return { error: "A reason is required to disconnect a preview connection." };
  const connection = findConnection(connectionId);
  if (!connection) return { error: "Connection not found." };
  lastDisconnected = { snapshot: { ...connection }, disconnectedAt: Date.now() };
  connection.status = "Preview Disconnected";
  connection.disconnectedDate = new Date().toISOString();
  connection.disconnectReason = reason;
  recordIntegrationAuditEvent({ actor: actorName, organizationId: connection.organizationId, providerKey: connection.providerKey, connectionId, event: "Preview connection disconnected", details: reason });
  return { connection };
}

export function undoDisconnectConnection(connectionId, actorName) {
  if (!lastDisconnected || lastDisconnected.snapshot.id !== connectionId) {
    return { error: "Nothing to undo for this connection in the current session." };
  }
  const connection = findConnection(connectionId);
  if (!connection) return { error: "Connection not found." };
  Object.assign(connection, lastDisconnected.snapshot, { status: lastDisconnected.snapshot.status === "Preview Disconnected" ? "Preview Connected" : lastDisconnected.snapshot.status });
  connection.disconnectedDate = null;
  connection.disconnectReason = null;
  lastDisconnected = null;
  recordIntegrationAuditEvent({ actor: actorName, organizationId: connection.organizationId, providerKey: connection.providerKey, connectionId, event: "Preview disconnect undone" });
  return { connection };
}

let syncJobSeq = 0;
export function runPreviewSync(connectionId, jobType = "Manual Sync", actorName = "Preview User") {
  const connection = findConnection(connectionId);
  if (!connection) return { error: "Connection not found." };
  syncJobSeq += 1;
  const examined = 20 + (syncJobSeq * 7) % 60;
  const failed = syncJobSeq % 5 === 0 ? Math.max(1, examined % 4) : 0;
  const conflicted = syncJobSeq % 4 === 0 ? Math.max(1, examined % 3) : 0;
  const skipped = Math.max(0, examined % 5);
  const created = Math.max(0, Math.floor((examined - failed - conflicted - skipped) * 0.4));
  const updated = Math.max(0, examined - failed - conflicted - skipped - created);
  const startedDate = new Date().toISOString();
  const completedDate = new Date(Date.now() + 4000).toISOString();
  const result = createIntegrationSyncResult({
    id: `sync_result_${syncJobSeq}`, jobType, recordsExamined: examined, created, updated, skipped, conflicted, failed,
    startedDate, completedDate, triggeredBy: actorName,
  });
  const job = createIntegrationSyncJob({ id: `sync_job_${syncJobSeq}`, connectionId, jobType, status: failed > 0 ? "Failed" : "Completed", result });
  connection.syncJobs.unshift(job);
  connection.lastSyncedAt = completedDate;
  connection.health = createIntegrationHealth({
    status: failed > 0 ? "Attention Required" : "Healthy",
    lastCheckedAt: completedDate,
    issues: failed > 0 ? [`${failed} record(s) failed during the last preview synchronization.`] : [],
  });
  if (failed > 0) {
    connection.recentErrors.unshift(createIntegrationError({
      id: `err_sync_${syncJobSeq}`, occurredAt: completedDate, code: "sync_partial_failure",
      message: `${failed} record(s) failed during preview synchronization.`, retryEligible: true,
    }));
  }
  recordIntegrationAuditEvent({
    actor: actorName, organizationId: connection.organizationId, providerKey: connection.providerKey, connectionId,
    event: "Preview synchronization run", details: jobType, occurredAt: completedDate,
    result: failed > 0 ? "Partial" : "Success", recordsAffected: created + updated, durationMs: result.durationMs,
    correlationId: job.id, retryEligible: failed > 0,
  });
  return { job, connection };
}

export function retryFailedSync(connectionId, jobId, actorName = "Preview User") {
  const connection = findConnection(connectionId);
  if (!connection) return { error: "Connection not found." };
  const job = connection.syncJobs.find((j) => j.id === jobId);
  if (!job) return { error: "Synchronization job not found." };
  return runPreviewSync(connectionId, "Retry", actorName);
}

export function updateFieldMapping(connectionId, mappingId, changes) {
  const connection = findConnection(connectionId);
  if (!connection) return { error: "Connection not found." };
  const idx = connection.fieldMappings.findIndex((m) => m.id === mappingId);
  if (idx === -1) return { error: "Field mapping not found." };
  connection.fieldMappings[idx] = { ...connection.fieldMappings[idx], ...changes };
  return { fieldMapping: connection.fieldMappings[idx] };
}

// "Edit Preview Configuration" — lets an authorized user change which
// capabilities/data scope/sync direction a preview connection uses, without
// going through the full setup wizard again.
export function updateConnectionConfig(connectionId, changes, actorName) {
  const connection = findConnection(connectionId);
  if (!connection) return { error: "Connection not found." };
  const { capabilities, dataScope, syncConfiguration, notificationPreferences } = changes;
  if (capabilities) connection.capabilities = capabilities;
  if (dataScope) connection.dataScope = dataScope;
  if (syncConfiguration) connection.syncConfiguration = { ...connection.syncConfiguration, ...syncConfiguration };
  if (notificationPreferences) connection.notificationPreferences = { ...connection.notificationPreferences, ...notificationPreferences };
  recordIntegrationAuditEvent({ actor: actorName, organizationId: connection.organizationId, providerKey: connection.providerKey, connectionId, event: "Preview configuration updated" });
  return { connection };
}

// "Test Preview Connection" — a lightweight, non-destructive connectivity
// check preview. Never contacts a real provider; just re-evaluates and
// timestamps the connection's current simulated health.
export function testPreviewConnection(connectionId, actorName) {
  const connection = findConnection(connectionId);
  if (!connection) return { error: "Connection not found." };
  const now = new Date().toISOString();
  connection.health = createIntegrationHealth({
    status: connection.health?.status === "Attention Required" ? "Attention Required" : "Healthy",
    lastCheckedAt: now,
    issues: connection.health?.issues || [],
  });
  recordIntegrationAuditEvent({ actor: actorName, organizationId: connection.organizationId, providerKey: connection.providerKey, connectionId, event: "Preview connection tested" });
  return { connection };
}

// ---------------------------------------------------------------------------
// Webhook previews — educational only, never a real endpoint/secret.
// ---------------------------------------------------------------------------
export const WEBHOOK_PREVIEWS = [
  createIntegrationWebhookPreview({ id: "wh_1", providerKey: "google_workspace", connectionId: "conn_2", organizationId: ORG_HQ, eventName: "Email received", lastEventAt: hoursAgo(3) }),
  createIntegrationWebhookPreview({ id: "wh_2", providerKey: "google_workspace", connectionId: "conn_2", organizationId: ORG_HQ, eventName: "Calendar event updated", lastEventAt: hoursAgo(5) }),
  createIntegrationWebhookPreview({ id: "wh_3", providerKey: "slack", connectionId: "conn_1", organizationId: ORG_HQ, eventName: "Slack notification requested", lastEventAt: hoursAgo(2) }),
  createIntegrationWebhookPreview({ id: "wh_4", providerKey: "whatsapp_business", connectionId: "conn_7", organizationId: ORG_NIMBUS, eventName: "WhatsApp message delivered", status: "Attention Required", failureCount: 3, lastEventAt: hoursAgo(5) }),
  createIntegrationWebhookPreview({ id: "wh_5", providerKey: "stripe", connectionId: "conn_3", organizationId: ORG_HQ, eventName: "Payment succeeded", status: "Preview Available", lastEventAt: null }),
  createIntegrationWebhookPreview({ id: "wh_6", providerKey: "stripe", connectionId: "conn_3", organizationId: ORG_HQ, eventName: "Payment failed", status: "Preview Available", lastEventAt: null }),
  createIntegrationWebhookPreview({ id: "wh_7", providerKey: "stripe", connectionId: "conn_3", organizationId: ORG_HQ, eventName: "Subscription updated", status: "Preview Available", lastEventAt: null }),
  createIntegrationWebhookPreview({ id: "wh_8", providerKey: "quickbooks_online", connectionId: "conn_5", organizationId: ORG_HQ, eventName: "Invoice paid", status: "Preview Disconnected", lastEventAt: daysAgo(60) }),
  createIntegrationWebhookPreview({ id: "wh_9", providerKey: "docusign", connectionId: "conn_4", organizationId: ORG_HQ, eventName: "Document signed", status: "Preview Paused", lastEventAt: daysAgo(20) }),
  createIntegrationWebhookPreview({ id: "wh_10", providerKey: "zoom", connectionId: "conn_8", organizationId: ORG_SOLSTICE, eventName: "Meeting scheduled", lastEventAt: hoursAgo(8) }),
  createIntegrationWebhookPreview({ id: "wh_11", providerKey: "zoom", connectionId: "conn_8", organizationId: ORG_SOLSTICE, eventName: "Meeting cancelled", lastEventAt: daysAgo(4) }),
  createIntegrationWebhookPreview({ id: "wh_12", providerKey: "microsoft_365", connectionId: "conn_6", organizationId: ORG_NIMBUS, eventName: "Calendar event updated", lastEventAt: hoursAgo(1) }),
];

export function queryWebhooksLocal(filters = {}) {
  let results = WEBHOOK_PREVIEWS.slice();
  if (filters.organizationId) results = results.filter((w) => w.organizationId === filters.organizationId);
  if (filters.providerKey) results = results.filter((w) => w.providerKey === filters.providerKey);
  return results;
}

// ---------------------------------------------------------------------------
// Integration-specific audit trail — a separate concern from the unrelated
// Access Audit feature (members/invitations/invite-links), own trail here.
// ---------------------------------------------------------------------------
let auditSeq = 0;
export const AUDIT_EVENTS = [];
function seedIntegrationAudit(fields) {
  auditSeq += 1;
  const event = createIntegrationAuditEvent({ id: `int_audit_${auditSeq}`, ...fields });
  AUDIT_EVENTS.push(event);
  return event;
}
export function recordIntegrationAuditEvent(fields) {
  return seedIntegrationAudit(fields);
}

seedIntegrationAudit({ occurredAt: daysAgo(40), actor: "Priya Nair", organizationId: ORG_HQ, providerKey: "slack", connectionId: "conn_1", event: "Preview connection created" });
seedIntegrationAudit({ occurredAt: daysAgo(70), actor: "Priya Nair", organizationId: ORG_HQ, providerKey: "google_workspace", connectionId: "conn_2", event: "Preview connection created" });
seedIntegrationAudit({ occurredAt: hoursAgo(26), actor: "System", organizationId: ORG_HQ, providerKey: "google_workspace", connectionId: "conn_2", event: "Attention required — permission preview expired" });
seedIntegrationAudit({ occurredAt: daysAgo(3), actor: "Priya Nair", organizationId: ORG_HQ, providerKey: "stripe", connectionId: "conn_3", event: "Preview connection created" });
seedIntegrationAudit({ occurredAt: daysAgo(90), actor: "Amara Okafor", organizationId: ORG_HQ, providerKey: "docusign", connectionId: "conn_4", event: "Preview connection created" });
seedIntegrationAudit({ occurredAt: daysAgo(15), actor: "Amara Okafor", organizationId: ORG_HQ, providerKey: "docusign", connectionId: "conn_4", event: "Preview connection paused" });
seedIntegrationAudit({ occurredAt: daysAgo(180), actor: "Amara Okafor", organizationId: ORG_HQ, providerKey: "quickbooks_online", connectionId: "conn_5", event: "Preview connection created" });
seedIntegrationAudit({ occurredAt: daysAgo(55), actor: "Amara Okafor", organizationId: ORG_HQ, providerKey: "quickbooks_online", connectionId: "conn_5", event: "Preview connection disconnected", details: "Organization switched primary accounting provider to Xero." });
seedIntegrationAudit({ occurredAt: daysAgo(25), actor: "Marcus Chen", organizationId: ORG_NIMBUS, providerKey: "microsoft_365", connectionId: "conn_6", event: "Preview connection created" });
seedIntegrationAudit({ occurredAt: daysAgo(10), actor: "Marcus Chen", organizationId: ORG_NIMBUS, providerKey: "whatsapp_business", connectionId: "conn_7", event: "Preview connection created" });
seedIntegrationAudit({ occurredAt: hoursAgo(5), actor: "System", organizationId: ORG_NIMBUS, providerKey: "whatsapp_business", connectionId: "conn_7", event: "Attention required — template rejected" });
seedIntegrationAudit({ occurredAt: daysAgo(15), actor: "Elena Popescu", organizationId: ORG_SOLSTICE, providerKey: "zoom", connectionId: "conn_8", event: "Preview connection created" });

export function queryActivityLocal(filters = {}) {
  let results = AUDIT_EVENTS.slice();
  if (filters.organizationId) results = results.filter((e) => e.organizationId === filters.organizationId);
  if (filters.providerKey) results = results.filter((e) => e.providerKey === filters.providerKey);
  if (filters.connectionId) results = results.filter((e) => e.connectionId === filters.connectionId);
  if (filters.event) results = results.filter((e) => e.event === filters.event);
  return results.slice().sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
}

// ---------------------------------------------------------------------------
// Organization integration policy (read summary + System-Owner-only manage)
// ---------------------------------------------------------------------------
export const ORGANIZATION_POLICIES = ORGANIZATIONS.map((org) =>
  createIntegrationOrganizationPolicy({ organizationId: org.id, ...PROVIDER_ORGANIZATION_POLICY_DEFAULTS })
);

export function findOrganizationPolicy(organizationId) {
  return ORGANIZATION_POLICIES.find((p) => p.organizationId === organizationId) || findOrganization(organizationId) && createIntegrationOrganizationPolicy({ organizationId, ...PROVIDER_ORGANIZATION_POLICY_DEFAULTS });
}

export function updateOrganizationPolicy(organizationId, changes, actorName) {
  const policy = ORGANIZATION_POLICIES.find((p) => p.organizationId === organizationId);
  if (!policy) return { error: "Organization not found." };
  Object.assign(policy, changes, { updatedBy: actorName, updatedAt: new Date().toISOString() });
  recordIntegrationAuditEvent({ actor: actorName, organizationId, event: "Integration policy updated" });
  return { policy };
}
