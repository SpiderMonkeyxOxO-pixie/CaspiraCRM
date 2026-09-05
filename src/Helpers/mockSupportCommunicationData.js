// Centralized, provider-neutral frontend fixtures for Customer Support and
// Communication Integrations (/admin/integrations/support-communication/*)
// — Phase 3 preview, extending (never forking) the Phase 1/2 Integration
// Center architecture.
//
// STRICT BOUNDARY: nothing here contacts a real provider, exchanges a real
// OAuth token, sends a real message, initiates a real phone call, plays a
// real recording, or publishes a real review reply. Every connection/sync
// keeps the "Frontend Connection Preview" / "Preview Synchronization"
// labels established in Phase 1; every message action is labelled
// "Message Preview".
//
// NO IMPORT FROM mockIntegrationsData.js HERE — DELIBERATELY, same reason
// documented in mockSalesMarketingData.js's header: that file imports
// PHASE3_PROVIDERS from this one, so a back-import would form a genuine
// circular dependency that breaks depending on which file loads first.
// Provider-factory functions come from the dependency-free
// mockIntegrationsContracts.js. `createIntegrationHealth` lives in
// mockIntegrationsData.js itself (not the contracts file), so this file
// defines its own trivial local `health()` helper with the identical shape
// rather than importing it — cheaper and safer than growing the shared
// contracts surface for a 3-field factory. Audit-event recording for Phase 3
// actions is done by mockApi.js (which already imports both fixture
// modules), never by this file calling back into mockIntegrationsData.js.
import {
  createIntegrationProvider,
  createIntegrationCapability,
  createIntegrationPlanRequirement,
} from "./mockIntegrationsContracts";
import { ORGANIZATIONS, DEFAULT_ORGANIZATION_ID, TEAMS, MEMBERS } from "./mockAccessData";
import { CRM_TEAM } from "./mockUsersData";
import { contacts, companies } from "./mockCrmData";
import { evaluateMatch } from "../pages/CRM/Duplicates/duplicateMatching";
import {
  tickets, findTicket, createTicketRecord, updateTicketRecord, addPublicReplyRecord, addPrivateNoteRecord, escalateTicketRecord,
} from "./mockSupportData";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const SupportChannelType = [
  "Email", "Web Chat", "Support Ticket", "WhatsApp", "SMS", "Facebook Messenger",
  "Instagram Messaging", "Telegram", "Voice", "Customer Review", "Internal Escalation",
];

// Canonical, provider-neutral statuses — the real Ticket record's own
// `status` field (New/Open/In Progress/Waiting for Customer/Resolved/
// Closed) is left untouched (existing pages/tests depend on it); this is
// the vocabulary the integration-preview mapping layer displays/maps to.
// "Mapping Review Required" is the required landing state for any unknown
// provider status — never silently mapped.
export const SupportTicketStatus = [
  "New", "Open", "Waiting on Customer", "Waiting on Internal Team", "On Hold", "Resolved", "Closed",
  "Mapping Review Required",
];

// Canonical, provider-neutral priorities — the real Ticket record's own
// `priority` field uses "Medium" instead of "Normal"; this is the
// vocabulary the integration-preview mapping layer displays/maps to.
export const SupportTicketPriority = ["Urgent", "High", "Normal", "Low"];

export const SupportMessageDirection = ["Inbound", "Outbound"];
export const SupportMessageVisibility = ["Public", "Internal"];

export const SupportIdentityMatchStates = [
  "Matched", "Possible Match", "Multiple Matches", "No Match", "Restricted Match", "Conflict", "Ignored",
];

export const SupportSyncConflictTypes = [
  "Status mismatch", "Priority mismatch", "Assignee mismatch", "Customer mismatch", "Duplicate ticket",
  "Missing provider record", "Missing CRM record", "Concurrent update", "Unsupported attachment",
  "Restricted field", "Unknown status", "Unknown agent",
];

export const SupportSyncConflictResolutions = [
  "Keep CRM value", "Keep provider value", "Use newest permitted value", "Map manually",
  "Ignore this event", "Retry preview", "Escalate for review",
];

export const SupportSLAStatus = [
  "On Track", "At Risk", "Breached", "Paused", "Completed", "Not Applicable", "Insufficient Data",
];

export const SupportEscalationActions = [
  "Assign to senior agent", "Notify Support Manager", "Notify Slack channel", "Notify Microsoft Teams channel",
  "Create internal Activity", "Increase priority", "Move to specialist queue", "Request customer information",
];

export const SupportCallDirection = ["Inbound", "Outbound"];

export const SupportCallDisposition = [
  "Resolved", "Follow-up Required", "Sales Opportunity", "Support Escalation",
  "Wrong Number", "No Answer", "Voicemail", "Disconnected", "Other",
];

// Shared by recording AND transcript availability — never a URL, storage
// key or external token, only a state.
export const SupportRecordingAvailability = [
  "Available", "Unavailable", "Processing Preview", "Restricted", "Retention Expired", "Consent Required",
];

// SLA target hours by canonical priority — taken directly from the real
// SLA_HOURS map already driving Ticket.slaResponseDeadline/
// slaResolutionDeadline in mockSupportData.js (Urgent 1h/4h, High 4h/24h,
// Medium(->Normal) 8h/48h, Low 24h/72h), never invented independently.
const DEFAULT_SLA_TARGET_HOURS = {
  Urgent: { firstResponse: 1, nextResponse: 2, resolution: 4 },
  High: { firstResponse: 4, nextResponse: 8, resolution: 24 },
  Normal: { firstResponse: 8, nextResponse: 16, resolution: 48 },
  Low: { firstResponse: 24, nextResponse: 48, resolution: 72 },
};

// ---------------------------------------------------------------------------
// Date helpers — same convention as mockIntegrationsData.js.
// ---------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}
function hoursAgo(n) {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}
function minutesAgo(n) {
  return new Date(Date.now() - n * 60 * 1000).toISOString();
}

// Local stand-in for mockIntegrationsData.js's createIntegrationHealth — see
// header comment for why this is duplicated rather than imported.
function health({ status = "Healthy", lastCheckedAt = new Date().toISOString(), issues = [] } = {}) {
  return { status, lastCheckedAt, issues };
}

const ORG_HQ = ORGANIZATIONS[0]?.id || DEFAULT_ORGANIZATION_ID;
const ORG_NIMBUS = ORGANIZATIONS[1]?.id || ORG_HQ;
const ORG_SOLSTICE = ORGANIZATIONS[2]?.id || ORG_HQ;

// ---------------------------------------------------------------------------
// PHASE3_PROVIDERS — 9 Support & Communication providers.
// ---------------------------------------------------------------------------
export const PHASE3_PROVIDERS = [
  createIntegrationProvider({
    key: "zendesk",
    name: "Zendesk",
    category: "Support",
    icon: "LifeBuoy",
    shortDescription: "Ticket, agent and SLA-reference preview for Zendesk.",
    longDescription: "Zendesk previews tickets, ticket comments, users, organizations, groups, agents, statuses, priorities, tags, attachments, SLA references and webhook-event previews. Supports bidirectional configuration previews without performing synchronization.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Subscription Required",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Subscription Required", notes: "Requires an active Zendesk subscription with API access." }),
    supportedModules: ["Tickets", "Contacts", "Companies"],
    capabilities: [
      createIntegrationCapability({ id: "zd_tickets", name: "Tickets", crmModule: "Tickets", direction: "both", requiredPermission: "support_tickets.view", sensitiveData: true }),
      createIntegrationCapability({ id: "zd_ticket_comments", name: "Ticket comments (public/internal)", crmModule: "Tickets", direction: "both", requiredPermission: "support_inbox.view", sensitiveData: true }),
      createIntegrationCapability({ id: "zd_users_orgs_groups", name: "Users, organizations and groups", crmModule: "Contacts", direction: "read", requiredPermission: "support_identity.view" }),
      createIntegrationCapability({ id: "zd_agents", name: "Agents", crmModule: "Tickets", direction: "read", requiredPermission: "support_agent_mappings.manage" }),
      createIntegrationCapability({ id: "zd_statuses", name: "Ticket statuses", crmModule: "Tickets", direction: "read", requiredPermission: "support_tickets.view" }),
      createIntegrationCapability({ id: "zd_priorities", name: "Priorities", crmModule: "Tickets", direction: "read", requiredPermission: "support_tickets.view" }),
      createIntegrationCapability({ id: "zd_tags", name: "Tags", crmModule: "Tickets", direction: "read", requiredPermission: "support_tickets.view" }),
      createIntegrationCapability({ id: "zd_attachments", name: "Attachment metadata", crmModule: "Tickets", direction: "read", requiredPermission: "support_tickets.view", sensitiveData: true, description: "Metadata only — never a real file download." }),
      createIntegrationCapability({ id: "zd_sla_reference", name: "SLA references", crmModule: "Tickets", direction: "read", requiredPermission: "support_sla.view" }),
      createIntegrationCapability({ id: "zd_webhook_events", name: "Webhook-event previews", crmModule: "Tickets", direction: "read", requiredPermission: "support_sync.retry" }),
    ],
    dataLeavingCrm: ["Reply/note preview text for tickets explicitly linked to a Zendesk ticket"],
    dataEnteringCrm: ["Ticket, comment, status, priority and tag previews", "Attachment metadata only"],
    knownLimitations: ["Supports bidirectional configuration previews without performing real synchronization.", "Never downloads real attachment content."],
    securityNotes: ["Every reply/note preview requires human confirmation before being marked complete."],
  }),
  createIntegrationProvider({
    key: "freshdesk",
    name: "Freshdesk",
    category: "Support",
    icon: "LifeBuoy",
    shortDescription: "Ticket, contact and conversation preview for Freshdesk.",
    longDescription: "Freshdesk previews tickets, contacts, companies, agents, groups, conversations, notes, priorities, statuses, SLA references and attachments.",
    authMethod: "API Key",
    pricingClassification: "Provider Subscription Required",
    credentialFieldInfo: { label: "Freshdesk API Key", disabledPlaceholder: "Credentials will be configured securely during backend integration." },
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Subscription Required", notes: "Requires an active Freshdesk subscription with API access." }),
    supportedModules: ["Tickets", "Contacts", "Companies"],
    capabilities: [
      createIntegrationCapability({ id: "fd_tickets", name: "Tickets", crmModule: "Tickets", direction: "both", requiredPermission: "support_tickets.view", sensitiveData: true }),
      createIntegrationCapability({ id: "fd_contacts_companies", name: "Contacts and companies", crmModule: "Contacts", direction: "read", requiredPermission: "support_identity.view" }),
      createIntegrationCapability({ id: "fd_agents_groups", name: "Agents and groups", crmModule: "Tickets", direction: "read", requiredPermission: "support_agent_mappings.manage" }),
      createIntegrationCapability({ id: "fd_conversations_notes", name: "Conversations and notes", crmModule: "Tickets", direction: "both", requiredPermission: "support_inbox.view", sensitiveData: true }),
      createIntegrationCapability({ id: "fd_priorities_statuses", name: "Priorities and statuses", crmModule: "Tickets", direction: "read", requiredPermission: "support_tickets.view" }),
      createIntegrationCapability({ id: "fd_sla_reference", name: "SLA references", crmModule: "Tickets", direction: "read", requiredPermission: "support_sla.view" }),
      createIntegrationCapability({ id: "fd_attachments", name: "Attachment metadata", crmModule: "Tickets", direction: "read", requiredPermission: "support_tickets.view", sensitiveData: true, description: "Metadata only — never a real file download." }),
    ],
    dataLeavingCrm: ["Reply/note preview text for tickets explicitly linked to a Freshdesk ticket"],
    dataEnteringCrm: ["Ticket, conversation, status and priority previews", "Attachment metadata only"],
    knownLimitations: ["Never downloads real attachment content."],
    securityNotes: ["Every reply/note preview requires human confirmation before being marked complete."],
  }),
  createIntegrationProvider({
    key: "intercom",
    name: "Intercom",
    category: "Support",
    icon: "LifeBuoy",
    shortDescription: "Conversation, ticket and Messenger-identity preview for Intercom.",
    longDescription: "Intercom previews contacts, companies, conversations, tickets, teammates, teams, tags, notes, inbox routing and Messenger identity. Does not add a real Intercom Messenger script to the application.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Subscription Required",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Subscription Required", notes: "Requires an active Intercom subscription with API access." }),
    supportedModules: ["Tickets", "Contacts", "Companies"],
    capabilities: [
      createIntegrationCapability({ id: "ic_conversations", name: "Conversations", crmModule: "Tickets", direction: "both", requiredPermission: "support_inbox.view", sensitiveData: true }),
      createIntegrationCapability({ id: "ic_contacts", name: "Contacts and companies", crmModule: "Contacts", direction: "read", requiredPermission: "support_identity.view" }),
      createIntegrationCapability({ id: "ic_tickets", name: "Tickets", crmModule: "Tickets", direction: "both", requiredPermission: "support_tickets.view" }),
      createIntegrationCapability({ id: "ic_teammates", name: "Teammates and teams", crmModule: "Tickets", direction: "read", requiredPermission: "support_agent_mappings.manage" }),
      createIntegrationCapability({ id: "ic_tags_notes", name: "Tags and notes", crmModule: "Tickets", direction: "read", requiredPermission: "support_inbox.view" }),
      createIntegrationCapability({ id: "ic_inbox_routing", name: "Inbox routing", crmModule: "Tickets", direction: "read", requiredPermission: "support_channels.view" }),
      createIntegrationCapability({ id: "ic_messenger_identity", name: "Messenger identity", crmModule: "Contacts", direction: "read", requiredPermission: "support_identity.view", description: "Identity reference only — no real Intercom Messenger script is ever added to the application." }),
    ],
    dataLeavingCrm: ["Reply/note preview text for conversations explicitly linked to a Ticket"],
    dataEnteringCrm: ["Conversation, ticket, tag and note previews"],
    knownLimitations: ["Does not add a real Intercom Messenger script to the application."],
    securityNotes: ["Every reply/note preview requires human confirmation before being marked complete."],
  }),
  createIntegrationProvider({
    key: "facebook_messenger",
    name: "Facebook Messenger",
    category: "Customer Messaging",
    icon: "MessageCircle",
    shortDescription: "Business Page conversation preview for Facebook Messenger.",
    longDescription: "Facebook Messenger previews the connected Business Page, customer conversations, incoming messages, outgoing reply previews, delivery state, attachment metadata, contact matching and escalation to a support ticket. Does not access personal Facebook profiles.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Contact Provider",
    planRequirement: createIntegrationPlanRequirement({ classification: "Contact Provider", notes: "Managed entirely through the organization's own Meta Business Page." }),
    supportedModules: ["Tickets", "Contacts"],
    capabilities: [
      createIntegrationCapability({ id: "fbm_business_page", name: "Business Page reference", crmModule: "Contacts", direction: "read", requiredPermission: "support_channels.view" }),
      createIntegrationCapability({ id: "fbm_conversations", name: "Customer conversation preview", crmModule: "Tickets", direction: "both", requiredPermission: "support_inbox.view", sensitiveData: true }),
      createIntegrationCapability({ id: "fbm_delivery_state", name: "Delivery state", crmModule: "Tickets", direction: "read", requiredPermission: "support_inbox.view" }),
      createIntegrationCapability({ id: "fbm_attachment_metadata", name: "Attachment metadata", crmModule: "Tickets", direction: "read", requiredPermission: "support_inbox.view", sensitiveData: true }),
      createIntegrationCapability({ id: "fbm_contact_matching", name: "Contact matching", crmModule: "Contacts", direction: "read", requiredPermission: "support_identity.view" }),
      createIntegrationCapability({ id: "fbm_ticket_escalation", name: "Escalation to a support ticket", crmModule: "Tickets", direction: "write", requiredPermission: "support_tickets.process", requiresHumanApproval: true }),
    ],
    dataLeavingCrm: ["Outgoing reply preview text only — never actually sent"],
    dataEnteringCrm: ["Incoming message previews", "Delivery-state previews", "Attachment metadata only"],
    knownLimitations: ["Never accesses personal Facebook profiles — Business Page conversations only."],
    securityNotes: ["Every reply preview requires human confirmation before being marked complete; no real message is ever sent."],
  }),
  createIntegrationProvider({
    key: "instagram_messaging",
    name: "Instagram Messaging",
    category: "Customer Messaging",
    icon: "MessageCircle",
    shortDescription: "Professional-account direct-message preview for Instagram.",
    longDescription: "Instagram Messaging previews the connected professional-account reference, direct-message conversations, customer handle, incoming messages, outgoing reply previews, attachment metadata, contact matching and escalation to a support ticket. Does not claim support for personal Instagram accounts.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Contact Provider",
    planRequirement: createIntegrationPlanRequirement({ classification: "Contact Provider", notes: "Requires an Instagram professional account linked to a Meta Business Page." }),
    supportedModules: ["Tickets", "Contacts"],
    capabilities: [
      createIntegrationCapability({ id: "ig_professional_account", name: "Professional-account reference", crmModule: "Contacts", direction: "read", requiredPermission: "support_channels.view" }),
      createIntegrationCapability({ id: "ig_dm_conversations", name: "Direct-message conversation preview", crmModule: "Tickets", direction: "both", requiredPermission: "support_inbox.view", sensitiveData: true }),
      createIntegrationCapability({ id: "ig_attachment_metadata", name: "Attachment metadata", crmModule: "Tickets", direction: "read", requiredPermission: "support_inbox.view", sensitiveData: true }),
      createIntegrationCapability({ id: "ig_contact_matching", name: "Contact matching", crmModule: "Contacts", direction: "read", requiredPermission: "support_identity.view" }),
      createIntegrationCapability({ id: "ig_ticket_escalation", name: "Escalation to a support ticket", crmModule: "Tickets", direction: "write", requiredPermission: "support_tickets.process", requiresHumanApproval: true }),
    ],
    dataLeavingCrm: ["Outgoing reply preview text only — never actually sent"],
    dataEnteringCrm: ["Incoming direct-message previews", "Attachment metadata only"],
    knownLimitations: ["Does not claim support for personal Instagram accounts — professional accounts only."],
    securityNotes: ["Every reply preview requires human confirmation before being marked complete; no real message is ever sent."],
  }),
  createIntegrationProvider({
    key: "telegram_bot_api",
    name: "Telegram Bot API",
    category: "Customer Messaging",
    icon: "MessageCircle",
    shortDescription: "Bot-chat conversation preview for Telegram.",
    longDescription: "Telegram Bot API previews the bot reference, chat reference, incoming messages, reply previews, command previews, attachment metadata, contact matching and support-ticket creation previews. Does not expose a bot token anywhere in the frontend.",
    authMethod: "Webhook Secret",
    pricingClassification: "Provider Free Tier Available",
    credentialFieldInfo: null,
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Free Tier Available", notes: "The Telegram Bot API itself is free." }),
    supportedModules: ["Tickets", "Contacts"],
    capabilities: [
      createIntegrationCapability({ id: "tg_bot_reference", name: "Bot reference", crmModule: "Contacts", direction: "read", requiredPermission: "support_channels.view" }),
      createIntegrationCapability({ id: "tg_chat_conversations", name: "Chat conversation preview", crmModule: "Tickets", direction: "both", requiredPermission: "support_inbox.view", sensitiveData: true }),
      createIntegrationCapability({ id: "tg_command_preview", name: "Command preview", crmModule: "Tickets", direction: "read", requiredPermission: "support_inbox.view" }),
      createIntegrationCapability({ id: "tg_attachment_metadata", name: "Attachment metadata", crmModule: "Tickets", direction: "read", requiredPermission: "support_inbox.view", sensitiveData: true }),
      createIntegrationCapability({ id: "tg_contact_matching", name: "Contact matching", crmModule: "Contacts", direction: "read", requiredPermission: "support_identity.view" }),
      createIntegrationCapability({ id: "tg_ticket_creation", name: "Support-ticket creation preview", crmModule: "Tickets", direction: "write", requiredPermission: "support_tickets.process", requiresHumanApproval: true }),
    ],
    dataLeavingCrm: ["Reply preview text only — never actually sent"],
    dataEnteringCrm: ["Incoming chat message previews", "Command previews", "Attachment metadata only"],
    knownLimitations: ["No bot token is ever exposed anywhere in the frontend."],
    securityNotes: ["Every reply preview requires human confirmation before being marked complete; no real message is ever sent."],
  }),
  createIntegrationProvider({
    key: "aircall",
    name: "Aircall",
    category: "Business Telephony",
    icon: "PhoneCall",
    shortDescription: "Business-phone call and disposition preview for Aircall.",
    longDescription: "Aircall previews phone numbers, inbound/outbound/missed calls, voicemail metadata, call duration, agent, contact match, call disposition, recording availability and follow-up Activity previews.",
    authMethod: "API Key",
    pricingClassification: "Usage-Based Provider",
    credentialFieldInfo: { label: "Aircall API Key", disabledPlaceholder: "Credentials will be configured securely during backend integration." },
    planRequirement: createIntegrationPlanRequirement({ classification: "Usage-Based Provider", notes: "Aircall bills per line/minute directly to the organization's Aircall account." }),
    supportedModules: ["Tickets", "Contacts", "Activities"],
    capabilities: [
      createIntegrationCapability({ id: "aircall_phone_numbers", name: "Phone numbers", crmModule: "Activities", direction: "read", requiredPermission: "support_calls.view" }),
      createIntegrationCapability({ id: "aircall_inbound", name: "Inbound call preview", crmModule: "Activities", direction: "read", requiredPermission: "support_calls.view", sensitiveData: true }),
      createIntegrationCapability({ id: "aircall_outbound", name: "Outbound call preview", crmModule: "Activities", direction: "read", requiredPermission: "support_calls.view", sensitiveData: true, description: "Never initiates a real outbound call — preview of call activity only." }),
      createIntegrationCapability({ id: "aircall_missed_voicemail", name: "Missed call and voicemail metadata", crmModule: "Activities", direction: "read", requiredPermission: "support_calls.view" }),
      createIntegrationCapability({ id: "aircall_disposition", name: "Call disposition", crmModule: "Activities", direction: "read", requiredPermission: "support_calls.manage" }),
      createIntegrationCapability({ id: "aircall_recording_availability", name: "Recording availability", crmModule: "Activities", direction: "read", requiredPermission: "support_recordings.view", sensitiveData: true, description: "Availability state only — never real audio content." }),
      createIntegrationCapability({ id: "aircall_followup_activity", name: "Follow-up Activity preview", crmModule: "Activities", direction: "write", requiredPermission: "support_calls.manage", requiresHumanApproval: true }),
    ],
    dataLeavingCrm: ["Nothing — Aircall is import-only in this preview"],
    dataEnteringCrm: ["Call metadata previews (direction, duration, disposition)", "Recording availability state only"],
    knownLimitations: ["Never creates or answers a real phone call.", "No recording audio or storage key is ever exposed."],
    securityNotes: ["Recording/transcript access requires an explicit permission, separate from general call viewing."],
  }),
  createIntegrationProvider({
    key: "ringcentral",
    name: "RingCentral",
    category: "Business Telephony",
    icon: "PhoneCall",
    shortDescription: "Business-phone call, SMS and disposition preview for RingCentral.",
    longDescription: "RingCentral previews business phone numbers, inbound/outbound calls, SMS capability, voicemail, call duration, agent, contact match, call disposition, recording availability and follow-up Activity previews.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Usage-Based Provider",
    planRequirement: createIntegrationPlanRequirement({ classification: "Usage-Based Provider", notes: "RingCentral bills per line/minute directly to the organization's RingCentral account." }),
    supportedModules: ["Tickets", "Contacts", "Activities"],
    capabilities: [
      createIntegrationCapability({ id: "rc_phone_numbers", name: "Business phone numbers", crmModule: "Activities", direction: "read", requiredPermission: "support_calls.view" }),
      createIntegrationCapability({ id: "rc_calls", name: "Inbound and outbound call preview", crmModule: "Activities", direction: "read", requiredPermission: "support_calls.view", sensitiveData: true, description: "Never initiates a real call — preview of call activity only." }),
      createIntegrationCapability({ id: "rc_sms", name: "SMS capability preview", crmModule: "Activities", direction: "read", requiredPermission: "support_calls.view", sensitiveData: true, description: "Never sends a real SMS — capability reference only." }),
      createIntegrationCapability({ id: "rc_voicemail", name: "Voicemail metadata", crmModule: "Activities", direction: "read", requiredPermission: "support_calls.view" }),
      createIntegrationCapability({ id: "rc_disposition", name: "Call disposition", crmModule: "Activities", direction: "read", requiredPermission: "support_calls.manage" }),
      createIntegrationCapability({ id: "rc_recording_availability", name: "Recording availability", crmModule: "Activities", direction: "read", requiredPermission: "support_recordings.view", sensitiveData: true, description: "Availability state only — never real audio content." }),
      createIntegrationCapability({ id: "rc_followup_activity", name: "Follow-up Activity preview", crmModule: "Activities", direction: "write", requiredPermission: "support_calls.manage", requiresHumanApproval: true }),
    ],
    dataLeavingCrm: ["Nothing — RingCentral is import-only in this preview"],
    dataEnteringCrm: ["Call/SMS metadata previews (direction, duration, disposition)", "Recording availability state only"],
    knownLimitations: ["Never creates or answers a real phone call or sends a real SMS.", "No recording audio or storage key is ever exposed."],
    securityNotes: ["Recording/transcript access requires an explicit permission, separate from general call viewing."],
  }),
  createIntegrationProvider({
    key: "google_business_profile",
    name: "Google Business Profile",
    category: "Customer Reviews",
    icon: "Star",
    shortDescription: "Customer-review preview for Google Business Profile.",
    longDescription: "Google Business Profile previews the business location, customer reviews, star ratings, review dates, reply status and reply previews. Contact association is shown only when reliably available, never claiming every reviewer can be matched to a CRM Contact. Does not implement discontinued Google Business Messages behavior.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Free Tier Available",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Free Tier Available", notes: "Google Business Profile itself is free; no paid tier exists." }),
    supportedModules: ["Contacts"],
    capabilities: [
      createIntegrationCapability({ id: "gbp_location", name: "Business location reference", crmModule: "Contacts", direction: "read", requiredPermission: "support_reviews.view" }),
      createIntegrationCapability({ id: "gbp_reviews", name: "Customer review preview", crmModule: "Contacts", direction: "read", requiredPermission: "support_reviews.view", sensitiveData: true }),
      createIntegrationCapability({ id: "gbp_reply_preview", name: "Reply preview", crmModule: "Contacts", direction: "write", requiredPermission: "support_reviews.reply_preview", requiresHumanApproval: true, description: "Draft only — never automatically posted." }),
      createIntegrationCapability({ id: "gbp_contact_association", name: "Contact association (when reliably available)", crmModule: "Contacts", direction: "read", requiredPermission: "support_identity.view", description: "Never claims every reviewer can be matched to a CRM Contact." }),
    ],
    dataLeavingCrm: ["Nothing — reply drafts are never automatically posted"],
    dataEnteringCrm: ["Review previews (rating, text, date, reply status)"],
    knownLimitations: ["Does not implement discontinued Google Business Messages behavior.", "Not every reviewer can be matched to a CRM Contact."],
    securityNotes: ["Every reply preview requires human confirmation before being marked complete; no reply is ever automatically posted."],
  }),
];

// ---------------------------------------------------------------------------
// Support Channels — configured/connected channel instances powering the
// Channels route. Routing conditions are display/reference only in this
// phase (no AI-based routing).
// ---------------------------------------------------------------------------
export function createSupportChannel({
  id, providerKey, organizationId, channelType, connectedAccountLabel,
  queueId = null, assignedTeamId = null, defaultPriority = "Normal",
  businessHours = "9:00 AM - 6:00 PM, Mon-Fri", autoResponseEnabled = false,
  consentRequired = false, status = "Preview Connected", lastPreviewEventAt = null,
  routing = {},
}) {
  return {
    id, providerKey, organizationId, channelType, connectedAccountLabel,
    queueId, assignedTeamId, defaultPriority, businessHours, autoResponseEnabled,
    consentRequired, status, lastPreviewEventAt, routing,
    health: health({}),
    previewLabel: "Frontend Connection Preview",
  };
}

export const SUPPORT_CHANNELS = [
  createSupportChannel({ id: "chan_1", providerKey: "zendesk", organizationId: ORG_HQ, channelType: "Support Ticket", connectedAccountLabel: "caspira.zendesk.com", queueId: "queue_1", assignedTeamId: "team_support_core", defaultPriority: "Normal", lastPreviewEventAt: hoursAgo(1) }),
  createSupportChannel({ id: "chan_2", providerKey: "google_workspace", organizationId: ORG_HQ, channelType: "Email", connectedAccountLabel: "support@caspira.example", queueId: "queue_1", defaultPriority: "Normal", lastPreviewEventAt: hoursAgo(2) }),
  createSupportChannel({ id: "chan_3", providerKey: "whatsapp_business", organizationId: ORG_HQ, channelType: "WhatsApp", connectedAccountLabel: "+1-555-0100", consentRequired: true, defaultPriority: "High", lastPreviewEventAt: hoursAgo(5) }),
  createSupportChannel({ id: "chan_4", providerKey: "facebook_messenger", organizationId: ORG_NIMBUS, channelType: "Facebook Messenger", connectedAccountLabel: "Nimbus Retail Group", defaultPriority: "Normal", lastPreviewEventAt: hoursAgo(2) }),
  createSupportChannel({ id: "chan_5", providerKey: "telegram_bot_api", organizationId: ORG_HQ, channelType: "Telegram", connectedAccountLabel: "@caspira_support_bot", status: "Attention Required", defaultPriority: "Low" }),
  createSupportChannel({ id: "chan_6", providerKey: "aircall", organizationId: ORG_HQ, channelType: "Voice", connectedAccountLabel: "+1-555-0142", defaultPriority: "High", lastPreviewEventAt: hoursAgo(4) }),
  createSupportChannel({ id: "chan_7", providerKey: "google_business_profile", organizationId: ORG_SOLSTICE, channelType: "Customer Review", connectedAccountLabel: "Solstice Partners — Downtown", status: "Configuration Required" }),
  createSupportChannel({ id: "chan_8", providerKey: "slack", organizationId: ORG_HQ, channelType: "Internal Escalation", connectedAccountLabel: "#support-escalations", defaultPriority: "Urgent" }),
];

export function findSupportChannel(id) {
  return SUPPORT_CHANNELS.find((c) => c.id === id) || null;
}

export function querySupportChannelsLocal(filters = {}) {
  let results = SUPPORT_CHANNELS.slice();
  if (filters.organizationId) results = results.filter((c) => c.organizationId === filters.organizationId);
  if (filters.providerKey) results = results.filter((c) => c.providerKey === filters.providerKey);
  if (filters.channelType) results = results.filter((c) => c.channelType === filters.channelType);
  return results;
}

// ---------------------------------------------------------------------------
// Queue mapping — org/team scoping via mockAccessData (TEAMS), actual
// assignment resolved against CRM_TEAM, exactly like Phase 2's
// LEAD_ROUTING_RULES precedent.
// ---------------------------------------------------------------------------
export function createSupportQueueMapping({
  id, providerKey, providerQueueId, providerQueueName, organizationId,
  teamId = null, department = null, active = true,
}) {
  return { id, providerKey, providerQueueId, providerQueueName, organizationId, teamId, department, active };
}

export const SUPPORT_QUEUE_MAPPINGS = [
  createSupportQueueMapping({ id: "queue_1", providerKey: "zendesk", providerQueueId: "zd_grp_101", providerQueueName: "Tier 1 Support", organizationId: ORG_HQ, teamId: "team_support_core", department: "Support" }),
  createSupportQueueMapping({ id: "queue_2", providerKey: "freshdesk", providerQueueId: "fd_grp_44", providerQueueName: "Billing Queue", organizationId: ORG_HQ, department: "Support" }),
  createSupportQueueMapping({ id: "queue_3", providerKey: "intercom", providerQueueId: "ic_team_9", providerQueueName: "Nimbus Front Line", organizationId: ORG_NIMBUS, department: "Support" }),
];

export function queryRoutableTeamsLocal(organizationId) {
  return TEAMS.filter((t) => t.organizationId === organizationId);
}

export function querySupportQueueMappingsLocal(filters = {}) {
  let results = SUPPORT_QUEUE_MAPPINGS.slice();
  if (filters.organizationId) results = results.filter((q) => q.organizationId === filters.organizationId);
  return results;
}

// ---------------------------------------------------------------------------
// Agent mapping — matches a provider agent's fixture email against
// mockAccessData.MEMBERS' verified email (CRM_TEAM has no email field of its
// own), then resolves to the corresponding CRM_TEAM id via shared name.
// Unknown agents remain unmapped — never matched on display name alone.
// ---------------------------------------------------------------------------
function resolveCrmTeamIdByMemberEmail(email) {
  const member = MEMBERS.find((m) => m.email === email);
  if (!member) return null;
  const teamMember = CRM_TEAM.find((t) => t.name === member.name);
  return teamMember?.id || null;
}

export function createSupportAssigneeMapping({
  id, providerKey, providerAgentId, providerAgentName, providerAgentEmail,
  organizationId,
}) {
  const crmUserId = resolveCrmTeamIdByMemberEmail(providerAgentEmail);
  const crmUser = crmUserId ? CRM_TEAM.find((t) => t.id === crmUserId) : null;
  return {
    id, providerKey, providerAgentId, providerAgentName, providerAgentEmail,
    organizationId,
    crmUserId,
    department: crmUser?.department || null,
    active: !!crmUserId,
    permissionStatus: crmUserId ? "Verified" : "Unmapped",
    mappingHealth: crmUserId ? "Healthy" : "Unknown agent — mapping review required",
  };
}

export const SUPPORT_AGENT_MAPPINGS = [
  createSupportAssigneeMapping({ id: "amap_1", providerKey: "zendesk", providerAgentId: "zd_agent_9", providerAgentName: "Liam O'Connor", providerAgentEmail: "liam.oconnor@caspira.example", organizationId: ORG_HQ }),
  createSupportAssigneeMapping({ id: "amap_2", providerKey: "zendesk", providerAgentId: "zd_agent_14", providerAgentName: "Grace Kim", providerAgentEmail: "grace.kim@caspira.example", organizationId: ORG_HQ }),
  createSupportAssigneeMapping({ id: "amap_3", providerKey: "intercom", providerAgentId: "ic_teammate_7", providerAgentName: "Unknown Contractor", providerAgentEmail: "contractor@unmapped.example", organizationId: ORG_NIMBUS }),
];

export function querySupportAgentMappingsLocal(filters = {}) {
  let results = SUPPORT_AGENT_MAPPINGS.slice();
  if (filters.organizationId) results = results.filter((a) => a.organizationId === filters.organizationId);
  return results;
}

// ---------------------------------------------------------------------------
// Customer identity matching — reuses the real duplicateMatching.js engine
// exactly as Phase 2 did (never a second implementation). Never auto-merges.
// ---------------------------------------------------------------------------
function projectIdentityDraft({ name, email, phone, companyName }) {
  return { _id: "identity_draft", name, email, phone, companyName, source: null, archived: false };
}

export function matchSupportIdentity({ name, email, phone, companyName }) {
  const draft = projectIdentityDraft({ name, email, phone, companyName });
  const matches = contacts
    .filter((c) => !c.archived)
    .map((existing) => evaluateMatch("contacts", draft, existing))
    .filter(Boolean)
    .sort((a, b) => b.confidencePercent - a.confidencePercent);

  let state;
  if (matches.length === 0) state = "No Match";
  else if (matches.length > 1 && matches[0].confidencePercent - (matches[1]?.confidencePercent || 0) < 15) state = "Multiple Matches";
  else if (matches[0].confidenceLabel === "High") state = "Matched";
  else state = "Possible Match";

  const candidateRecords = matches.slice(0, 5).map((m) => {
    const contact = contacts.find((c) => c._id === m.bId);
    return { contactId: m.bId, name: contact?.name, companyName: contact?.companyName, confidencePercent: m.confidencePercent, confidenceLabel: m.confidenceLabel };
  });

  return {
    state,
    matchBasis: matches[0]?.matchingFields || [],
    candidateRecords,
    confidencePercent: matches[0]?.confidencePercent || 0,
    confidenceLabel: matches[0]?.confidenceLabel || "Low",
    supportingFields: matches[0]?.matchingFields || [],
    conflictingFields: [],
    privacyWarning: candidateRecords.length > 0 ? "Candidate records may contain restricted personal data — verify access before sharing." : null,
    suggestedAction: state === "Matched" ? "Link to this Contact" : state === "No Match" ? "Create a Contact (requires confirmation)" : "Review candidates before linking",
  };
}

// ---------------------------------------------------------------------------
// Omnichannel conversations — a genuinely new layer (Ticket's own
// publicReplies/privateNotes are simple, provider-neutral arrays with no
// channel/direction/attachment metadata). OPTIONALLY links to a real
// Ticket via linkedTicketId, mirroring CampaignReference.linkedCampaignId.
// ---------------------------------------------------------------------------
export function createSupportMessagePreview({
  id, conversationId, direction, visibility, author, body,
  attachments = [], sentAt = new Date().toISOString(),
}) {
  return {
    id, conversationId, direction, visibility, author, body, attachments, sentAt,
    isPreview: true, previewLabel: "Message Preview",
  };
}

export function createSupportConversationPreview({
  id, orgId, providerKey, channelType, externalReference,
  customer, linkedTicketId = null, linkedCompanyId = null,
  status = "New", priority = "Normal", assigneeId = null, queueId = null,
  unread = true, messages = [], tags = [], lastMessageAt = new Date().toISOString(),
}) {
  return {
    id, orgId, providerKey, channelType, externalReference, customer,
    linkedTicketId, linkedCompanyId, status, priority, assigneeId, queueId,
    unread, messages, tags, lastMessageAt,
    dataFreshness: new Date().toISOString(),
  };
}

export const SUPPORT_CONVERSATIONS = [
  createSupportConversationPreview({
    id: "conv_1", orgId: ORG_HQ, providerKey: "zendesk", channelType: "Support Ticket", externalReference: "zd_ticket_5521",
    customer: { name: "Noah Brennan", email: "noah.brennan@brightfield.example", phone: "+1-555-0142" },
    linkedTicketId: tickets[0]?._id || null, status: "Open", priority: "High", assigneeId: "u5", queueId: "queue_1", unread: true,
    messages: [
      createSupportMessagePreview({ id: "msg_1", conversationId: "conv_1", direction: "Inbound", visibility: "Public", author: "Noah Brennan", body: "Our nightly export keeps failing.", sentAt: hoursAgo(3) }),
      createSupportMessagePreview({ id: "msg_2", conversationId: "conv_1", direction: "Outbound", visibility: "Internal", author: "Liam O'Connor", body: "Checking sync logs before replying.", sentAt: hoursAgo(2) }),
    ],
    lastMessageAt: hoursAgo(2),
  }),
  createSupportConversationPreview({
    id: "conv_2", orgId: ORG_HQ, providerKey: "whatsapp_business", channelType: "WhatsApp", externalReference: "wa_thread_881",
    customer: { name: "Elena Torres", phone: "+1-555-0198" },
    status: "Waiting on Customer", priority: "Normal", assigneeId: "u5", unread: false,
    messages: [
      createSupportMessagePreview({ id: "msg_3", conversationId: "conv_2", direction: "Outbound", visibility: "Public", author: "Liam O'Connor", body: "Could you share your account email?", sentAt: minutesAgo(40) }),
    ],
    lastMessageAt: minutesAgo(40),
  }),
  createSupportConversationPreview({
    id: "conv_3", orgId: ORG_NIMBUS, providerKey: "facebook_messenger", channelType: "Facebook Messenger", externalReference: "fbm_thread_220",
    customer: { name: "Sofia Ricci", handle: "sofia.ricci" },
    status: "New", priority: "Normal", unread: true,
    messages: [
      createSupportMessagePreview({ id: "msg_4", conversationId: "conv_3", direction: "Inbound", visibility: "Public", author: "Sofia Ricci", body: "Is there a student discount?", sentAt: hoursAgo(1) }),
    ],
    lastMessageAt: hoursAgo(1),
  }),
  createSupportConversationPreview({
    id: "conv_4", orgId: ORG_HQ, providerKey: "intercom", channelType: "Web Chat", externalReference: "ic_conv_9012",
    customer: { name: "Unmapped Visitor", email: "visitor@unlisted.example" },
    status: "Needs Review", priority: "Low", unread: true,
    messages: [
      createSupportMessagePreview({ id: "msg_5", conversationId: "conv_4", direction: "Inbound", visibility: "Public", author: "Unmapped Visitor", body: "Do you support SSO?", sentAt: hoursAgo(6) }),
    ],
    lastMessageAt: hoursAgo(6),
  }),
];

export function findSupportConversation(id) {
  return SUPPORT_CONVERSATIONS.find((c) => c.id === id) || null;
}

export function querySupportConversationsLocal(filters = {}) {
  let results = SUPPORT_CONVERSATIONS.slice();
  if (filters.orgId) results = results.filter((c) => c.orgId === filters.orgId);
  if (filters.providerKey) results = results.filter((c) => c.providerKey === filters.providerKey);
  if (filters.channelType) results = results.filter((c) => c.channelType === filters.channelType);
  if (filters.status) results = results.filter((c) => c.status === filters.status);
  if (filters.unread !== undefined) results = results.filter((c) => c.unread === filters.unread);
  return results.slice().sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
}

// "Confirm Reply Preview" / "Confirm Internal Note Preview" — when the
// conversation IS linked to a real Ticket, calls the real
// addPublicReplyRecord/addPrivateNoteRecord (never a duplicate write path);
// otherwise only appends to the conversation's own preview message list.
let lastConversationMessageUndo = null;
export function sendMessagePreview(conversationId, { visibility, body, author = "Preview User" }) {
  const conversation = findSupportConversation(conversationId);
  if (!conversation) return { error: "Conversation not found." };
  if (!body?.trim()) return { error: "A message body is required." };

  const message = createSupportMessagePreview({
    id: `msg_${Date.now().toString(36)}`, conversationId, direction: "Outbound", visibility, author, body,
  });
  conversation.messages.push(message);
  conversation.lastMessageAt = message.sentAt;
  lastConversationMessageUndo = { conversationId, messageId: message.id };

  if (conversation.linkedTicketId) {
    if (visibility === "Public") addPublicReplyRecord(conversation.linkedTicketId, body, author);
    else addPrivateNoteRecord(conversation.linkedTicketId, body, author);
  }

  return { conversation, message, providerMessageSent: false };
}

export function undoLastConversationMessage(conversationId) {
  if (!lastConversationMessageUndo || lastConversationMessageUndo.conversationId !== conversationId) {
    return { error: "Nothing to undo for this conversation in the current session." };
  }
  const conversation = findSupportConversation(conversationId);
  if (!conversation) return { error: "Conversation not found." };
  conversation.messages = conversation.messages.filter((m) => m.id !== lastConversationMessageUndo.messageId);
  lastConversationMessageUndo = null;
  return { conversation };
}

// "Escalate to Ticket" — calls the real createTicketRecord, never a
// duplicate ticket entity.
export function escalateConversationToTicket(conversationId, overrides = {}) {
  const conversation = findSupportConversation(conversationId);
  if (!conversation) return { error: "Conversation not found." };
  if (conversation.linkedTicketId) return { error: "This conversation is already linked to a Ticket." };
  const ticket = createTicketRecord({
    contactName: conversation.customer.name,
    subject: overrides.subject || `${conversation.channelType} conversation escalated to Ticket`,
    description: conversation.messages.map((m) => `${m.author}: ${m.body}`).join("\n"),
    source: conversation.channelType,
    priority: conversation.priority === "Normal" ? "Medium" : conversation.priority,
    sourceProviderKey: conversation.providerKey,
    sourceExternalReference: conversation.externalReference,
    ...overrides,
  });
  conversation.linkedTicketId = ticket._id;
  return { conversation, ticket };
}

// ---------------------------------------------------------------------------
// Ticket-preview status/priority mapping — never silently maps an unknown
// provider status; it lands in "Mapping Review Required" instead.
// ---------------------------------------------------------------------------
export function createSupportStatusMapping({
  id, providerKey, providerStatus, canonicalStatus, direction = "Import Only",
}) {
  const validationResult = SupportTicketStatus.includes(canonicalStatus) ? "Valid" : "Mapping Review Required";
  return { id, providerKey, providerStatus, canonicalStatus, direction, validationResult };
}

export function createSupportPriorityMapping({ id, providerKey, providerPriority, canonicalPriority }) {
  const validationResult = SupportTicketPriority.includes(canonicalPriority) ? "Valid" : "Mapping Review Required";
  return { id, providerKey, providerPriority, canonicalPriority, validationResult };
}

export const SUPPORT_STATUS_MAPPINGS = [
  createSupportStatusMapping({ id: "smap_1", providerKey: "zendesk", providerStatus: "new", canonicalStatus: "New" }),
  createSupportStatusMapping({ id: "smap_2", providerKey: "zendesk", providerStatus: "open", canonicalStatus: "Open" }),
  createSupportStatusMapping({ id: "smap_3", providerKey: "zendesk", providerStatus: "pending", canonicalStatus: "Waiting on Customer" }),
  createSupportStatusMapping({ id: "smap_4", providerKey: "zendesk", providerStatus: "hold", canonicalStatus: "On Hold" }),
  createSupportStatusMapping({ id: "smap_5", providerKey: "zendesk", providerStatus: "solved", canonicalStatus: "Resolved" }),
  createSupportStatusMapping({ id: "smap_6", providerKey: "zendesk", providerStatus: "closed", canonicalStatus: "Closed" }),
  createSupportStatusMapping({ id: "smap_7", providerKey: "freshdesk", providerStatus: "waiting_on_third_party", canonicalStatus: "Waiting on Internal Team" }),
  createSupportStatusMapping({ id: "smap_8", providerKey: "intercom", providerStatus: "snoozed_unknown", canonicalStatus: "Unmapped Provider Status" }),
];

export const SUPPORT_PRIORITY_MAPPINGS = [
  createSupportPriorityMapping({ id: "pmap_1", providerKey: "zendesk", providerPriority: "urgent", canonicalPriority: "Urgent" }),
  createSupportPriorityMapping({ id: "pmap_2", providerKey: "zendesk", providerPriority: "high", canonicalPriority: "High" }),
  createSupportPriorityMapping({ id: "pmap_3", providerKey: "zendesk", providerPriority: "normal", canonicalPriority: "Normal" }),
  createSupportPriorityMapping({ id: "pmap_4", providerKey: "zendesk", providerPriority: "low", canonicalPriority: "Low" }),
];

export function queryStatusMappingsLocal(filters = {}) {
  let results = SUPPORT_STATUS_MAPPINGS.slice();
  if (filters.providerKey) results = results.filter((m) => m.providerKey === filters.providerKey);
  return results;
}

export function queryPriorityMappingsLocal(filters = {}) {
  let results = SUPPORT_PRIORITY_MAPPINGS.slice();
  if (filters.providerKey) results = results.filter((m) => m.providerKey === filters.providerKey);
  return results;
}

// ---------------------------------------------------------------------------
// Ticket-preview list — provider-reference metadata OPTIONALLY linking to a
// real Ticket, plus synchronization conflicts.
// ---------------------------------------------------------------------------
export function createSupportTicketPreview({
  id, providerKey, providerTicketId, linkedTicketId, organizationId,
  canonicalStatus, canonicalPriority, syncState = "Synced",
}) {
  return { id, providerKey, providerTicketId, linkedTicketId, organizationId, canonicalStatus, canonicalPriority, syncState };
}

// Canonical <-> real-Ticket vocabulary mapping. The real Ticket's own status/
// priority fields (mockSupportData.js) stay untouched — this is a display/
// write-back translation layer only. Anything not explicitly mapped lands in
// "Mapping Review Required" rather than being silently guessed.
const INTERNAL_TO_CANONICAL_STATUS = {
  New: "New", Open: "Open", "In Progress": "Waiting on Internal Team",
  "Waiting for Customer": "Waiting on Customer", Resolved: "Resolved", Closed: "Closed",
};
const CANONICAL_TO_INTERNAL_STATUS = {
  New: "New", Open: "Open", "Waiting on Customer": "Waiting for Customer",
  "Waiting on Internal Team": "In Progress", "On Hold": "In Progress",
  Resolved: "Resolved", Closed: "Closed",
};
const INTERNAL_TO_CANONICAL_PRIORITY = { Low: "Low", Medium: "Normal", High: "High", Urgent: "Urgent" };
const CANONICAL_TO_INTERNAL_PRIORITY = { Low: "Low", Normal: "Medium", High: "High", Urgent: "Urgent" };

function toCanonicalStatus(internalStatus) {
  return INTERNAL_TO_CANONICAL_STATUS[internalStatus] || "Mapping Review Required";
}
function toCanonicalPriority(internalPriority) {
  return INTERNAL_TO_CANONICAL_PRIORITY[internalPriority] || "Normal";
}

export function querySupportTicketPreviewsLocal(filters = {}) {
  let results = tickets
    .filter((t) => t.sourceProviderKey)
    .map((t) => createSupportTicketPreview({
      id: `stp_${t._id}`, providerKey: t.sourceProviderKey, providerTicketId: t.sourceExternalReference,
      linkedTicketId: t._id, organizationId: filters.organizationId || ORG_HQ,
      canonicalStatus: toCanonicalStatus(t.status), canonicalPriority: toCanonicalPriority(t.priority),
    }));
  if (filters.providerKey) results = results.filter((p) => p.providerKey === filters.providerKey);
  if (filters.canonicalStatus) results = results.filter((p) => p.canonicalStatus === filters.canonicalStatus);
  return results;
}

// Enriched rows for the Tickets integration route's table/board — joins the
// ticket-preview reference back to the real Ticket, the queue/agent mapping
// tables, and the deterministic SLA selector. Never a stored duplicate.
export function queryEnrichedTicketPreviewsLocal(filters = {}) {
  const previews = querySupportTicketPreviewsLocal(filters);
  const slaConfig = SUPPORT_SLA_CONFIGURATIONS[0];
  return previews
    .map((preview) => {
      const ticket = findTicket(preview.linkedTicketId);
      if (!ticket) return null;
      const queueMapping = SUPPORT_QUEUE_MAPPINGS.find((q) => q.providerKey === preview.providerKey);
      const agent = ticket.assignedAgentId ? CRM_TEAM.find((m) => m.id === ticket.assignedAgentId) : null;
      const hasOpenConflict = SUPPORT_SYNC_CONFLICTS.some((c) => c.ticketId === ticket._id && c.resolutionState === "Open");
      return {
        ...preview,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        customerName: ticket.contactName,
        companyName: ticket.companyName,
        contactId: ticket.contactId,
        channel: { Email: "Email", Phone: "Voice", Chat: "Web Chat", Portal: "Support Ticket" }[ticket.source] || ticket.source,
        queueName: queueMapping?.providerQueueName || "Unassigned Queue",
        assigneeId: ticket.assignedAgentId,
        assigneeName: agent?.name || "Unassigned",
        slaState: computeSlaState(ticket, slaConfig),
        updatedAt: ticket.resolution?.resolvedAt || ticket.firstRespondedAt || ticket.createdAt,
        syncState: hasOpenConflict ? "Conflict" : preview.syncState,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// "Assign Preview" — assigns against the real Ticket's new assignedAgentId
// FK (see mockSupportData.js), never a duplicate assignment record.
export function assignTicketPreview(ticketId, agentId, actorName = "Preview User") {
  const agent = CRM_TEAM.find((m) => m.id === agentId);
  if (!agent) return { error: "Unknown agent." };
  const ticket = updateTicketRecord(ticketId, { assignedAgentId: agentId, assignedAgent: agent.name });
  if (!ticket) return { error: "Ticket not found." };
  ticket.privateNotes.push({ message: `Assigned to ${agent.name} via integration preview.`, author: actorName, at: new Date().toISOString() });
  return { ticket };
}

// "Change Status Preview" — maps the chosen canonical status to the nearest
// real Ticket status before writing back; "Mapping Review Required" can
// never be written back (nothing to map to).
export function changeTicketStatusPreview(ticketId, canonicalStatus, actorName = "Preview User") {
  const internalStatus = CANONICAL_TO_INTERNAL_STATUS[canonicalStatus];
  if (!internalStatus) return { error: "This canonical status cannot be written back — resolve the mapping first." };
  const ticket = updateTicketRecord(ticketId, { status: internalStatus });
  if (!ticket) return { error: "Ticket not found." };
  ticket.privateNotes.push({ message: `Status changed to "${canonicalStatus}" (${internalStatus}) via integration preview.`, author: actorName, at: new Date().toISOString() });
  return { ticket };
}

// High-risk: closing always requires a written reason (mockRbacData.js flags
// support_tickets/CLOSE as high-risk) and always records an audit event.
export function closeTicketPreview(ticketId, reason, actorName = "Preview User") {
  if (!reason?.trim()) return { error: "A written reason is required to close a ticket." };
  const ticket = updateTicketRecord(ticketId, { status: "Closed" });
  if (!ticket) return { error: "Ticket not found." };
  ticket.privateNotes.push({ message: `Closed via integration preview: ${reason}`, author: actorName, at: new Date().toISOString() });
  return { ticket };
}

export function addInternalNotePreviewToTicket(ticketId, message, actorName = "Preview User") {
  if (!message?.trim()) return { error: "A note message is required." };
  const ticket = addPrivateNoteRecord(ticketId, message, actorName);
  if (!ticket) return { error: "Ticket not found." };
  return { ticket };
}

// "Retry Preview Sync" — never claims a real synchronization ran; simply
// re-validates the mapping and clears any resolved conflicts' stale state.
export function retryTicketSyncPreview(ticketId, actorName = "Preview User") {
  const ticket = findTicket(ticketId);
  if (!ticket) return { error: "Ticket not found." };
  const openConflict = SUPPORT_SYNC_CONFLICTS.find((c) => c.ticketId === ticketId && c.resolutionState === "Open");
  if (openConflict) return { error: "Resolve the open synchronization conflict before retrying." };
  ticket.privateNotes.push({ message: "Synchronization retried via integration preview.", author: actorName, at: new Date().toISOString() });
  return { ticket, retried: true };
}

// "Link Customer" — never automatically merged; the caller must have
// already reviewed a matchSupportIdentity() candidate before calling this.
export function linkCustomerToTicket(ticketId, contactId, contactName, actorName = "Preview User") {
  const contact = contacts.find((c) => c._id === contactId);
  if (!contact) return { error: "Contact not found." };
  const ticket = updateTicketRecord(ticketId, { contactId, contactName: contactName || contact.name });
  if (!ticket) return { error: "Ticket not found." };
  ticket.privateNotes.push({ message: `Linked to Contact ${contact.name} via integration preview.`, author: actorName, at: new Date().toISOString() });
  return { ticket };
}

export function createSupportSyncConflict({
  id, ticketId, conflictType, providerValue, crmValue, detectedAt = new Date().toISOString(),
  resolutionState = "Open", resolutionNote = null,
}) {
  return { id, ticketId, conflictType, providerValue, crmValue, detectedAt, resolutionState, resolutionNote };
}

export const SUPPORT_SYNC_CONFLICTS = [
  createSupportSyncConflict({ id: "conflict_1", ticketId: tickets[0]?._id || null, conflictType: "Status mismatch", providerValue: "pending", crmValue: "Open" }),
  createSupportSyncConflict({ id: "conflict_2", ticketId: tickets[1]?._id || null, conflictType: "Assignee mismatch", providerValue: "Unassigned Agent", crmValue: "Liam O'Connor" }),
];

// Seed a handful of realistic ticket previews (real Tickets tagged with a
// provider source) so the Tickets integration route isn't empty by default.
// Placed after SUPPORT_SYNC_CONFLICTS (not before) since the first seeded
// ticket adopts conflict_1/conflict_2's placeholder ticketId — referencing
// SUPPORT_SYNC_CONFLICTS at module-load time before its own `const`
// declaration runs would throw a temporal-dead-zone ReferenceError.
[
  { providerKey: "zendesk", externalReference: "zd_ticket_9021", subject: "Recurring sync failures on nightly export", priority: "Urgent", status: "Open", assignedAgentId: "u5", companyName: "Opentickets Support Holdings" },
  { providerKey: "zendesk", externalReference: "zd_ticket_9032", subject: "Unable to access account after password reset", priority: "High", status: "New" },
  { providerKey: "freshdesk", externalReference: "fd_ticket_5510", subject: "Invoice discrepancy on latest statement", priority: "Medium", status: "Waiting for Customer" },
  { providerKey: "intercom", externalReference: "ic_ticket_7788", subject: "Feature request: export to CSV", priority: "Low", status: "In Progress", assignedAgentId: "u5" },
].forEach((seed, idx) => {
  const ticket = createTicketRecord({
    subject: seed.subject, priority: seed.priority,
    sourceProviderKey: seed.providerKey, sourceExternalReference: seed.externalReference,
    assignedAgentId: seed.assignedAgentId || null,
    ...(seed.companyName ? { companyName: seed.companyName } : {}),
  });
  // createTicketRecord() always sets a freshly-created ticket's status to
  // "New" itself, ignoring any `status` in its payload — apply the seed's
  // intended status as a real update afterward instead.
  updateTicketRecord(ticket._id, { status: seed.status });
  if (idx === 0) {
    // Point both seeded sync conflicts at this ticket unconditionally — the
    // pre-existing `tickets[0]` fallback used when SUPPORT_SYNC_CONFLICTS
    // was first constructed is always truthy (mockSupportData.js seeds 18
    // tickets before this file even runs), so a "backfill only if empty"
    // guard here would never fire.
    SUPPORT_SYNC_CONFLICTS.forEach((c) => { c.ticketId = ticket._id; });
  }
});

export function querySupportSyncConflictsLocal(filters = {}) {
  let results = SUPPORT_SYNC_CONFLICTS.slice();
  if (filters.resolutionState) results = results.filter((c) => c.resolutionState === filters.resolutionState);
  return results;
}

export function resolveSyncConflict(conflictId, resolution, note, actorName = "Preview User") {
  if (!SupportSyncConflictResolutions.includes(resolution)) return { error: "Unknown resolution option." };
  const conflict = SUPPORT_SYNC_CONFLICTS.find((c) => c.id === conflictId);
  if (!conflict) return { error: "Synchronization conflict not found." };
  conflict.resolutionState = "Resolved";
  conflict.resolutionNote = `${resolution} — ${note || ""} (by ${actorName})`.trim();
  return { conflict };
}

// ---------------------------------------------------------------------------
// SLA configuration and deterministic selectors — target hours come from
// the real SLA_HOURS map already driving Ticket deadlines, never invented.
// ---------------------------------------------------------------------------
export function createSupportSLAConfiguration({
  id, organizationId, name, targetHours = DEFAULT_SLA_TARGET_HOURS,
  businessHours = "9:00 AM - 6:00 PM", businessDays = ["Mon", "Tue", "Wed", "Thu", "Fri"],
  holidays = [], tierTargets = {}, contractTargets = {}, pauseConditions = ["Waiting on Customer"],
  escalationThresholdPercent = 80,
}) {
  return { id, organizationId, name, targetHours, businessHours, businessDays, holidays, tierTargets, contractTargets, pauseConditions, escalationThresholdPercent };
}

export const SUPPORT_SLA_CONFIGURATIONS = [
  createSupportSLAConfiguration({ id: "slacfg_1", organizationId: ORG_HQ, name: "HQ Default SLA" }),
  createSupportSLAConfiguration({ id: "slacfg_2", organizationId: ORG_NIMBUS, name: "Nimbus Default SLA" }),
];

export function findSupportSLAConfiguration(organizationId) {
  return SUPPORT_SLA_CONFIGURATIONS.find((c) => c.organizationId === organizationId) || null;
}

function isWithinBusinessHours() {
  // Deterministic, business-hours-aware approximation: treat weekends as
  // paused time. A full calendar-aware implementation is a later-phase
  // enhancement; this keeps "business-hours-aware" honest without
  // fabricating a richer calendar than the fixtures actually model.
  const day = new Date().getDay();
  return day !== 0 && day !== 6;
}

// Pure, deterministic — never a hardcoded metric-card value.
export function computeSlaState(ticket, slaConfig) {
  if (!ticket) return "Not Applicable";
  if (["Resolved", "Closed"].includes(ticket.status)) return "Completed";
  if (ticket.status === "Waiting for Customer" && (slaConfig?.pauseConditions || []).some((p) => p.toLowerCase().includes("waiting on customer"))) return "Paused";
  if (!ticket.slaResolutionDeadline) return "Insufficient Data";
  const remainingMs = new Date(ticket.slaResolutionDeadline).getTime() - Date.now();
  if (remainingMs < 0) return "Breached";
  const targetMs = slaConfig ? (slaConfig.targetHours[ticket.priority === "Medium" ? "Normal" : ticket.priority]?.resolution || 24) * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const thresholdMs = targetMs * (1 - (slaConfig?.escalationThresholdPercent || 80) / 100);
  if (remainingMs < thresholdMs) return "At Risk";
  return "On Track";
}

export function computeSlaRemainingTime(ticket) {
  if (!ticket?.slaResolutionDeadline) return null;
  return Math.max(0, new Date(ticket.slaResolutionDeadline).getTime() - Date.now());
}

export function computeSlaBreachDuration(ticket) {
  if (!ticket?.slaResolutionDeadline) return 0;
  return Math.max(0, Date.now() - new Date(ticket.slaResolutionDeadline).getTime());
}

export function computeFirstResponseDueTime(ticket) {
  return ticket?.slaResponseDeadline || null;
}

export function computeResolutionDueTime(ticket) {
  return ticket?.slaResolutionDeadline || null;
}

export { isWithinBusinessHours };

// ---------------------------------------------------------------------------
// Escalation rules — action previews only, never a real external
// notification in this phase.
// ---------------------------------------------------------------------------
export function createSupportEscalationRule({
  id, organizationId, name, trigger, action, requiredPermission, requiredApprover = null, active = true,
}) {
  return { id, organizationId, name, trigger, action, requiredPermission, requiredApprover, active };
}

export const SUPPORT_ESCALATION_RULES = [
  createSupportEscalationRule({ id: "esc_1", organizationId: ORG_HQ, name: "Urgent breach — notify manager", trigger: "SLA breached on Urgent ticket", action: "Notify Support Manager", requiredPermission: "support_escalations.manage" }),
  createSupportEscalationRule({ id: "esc_2", organizationId: ORG_HQ, name: "Repeated contact — internal escalation", trigger: "3+ inbound messages with no response", action: "Notify Slack channel", requiredPermission: "support_escalations.manage" }),
];

export function queryEscalationRulesLocal(filters = {}) {
  let results = SUPPORT_ESCALATION_RULES.slice();
  if (filters.organizationId) results = results.filter((r) => r.organizationId === filters.organizationId);
  return results;
}

export function previewEscalation(ruleId, ticket) {
  const rule = SUPPORT_ESCALATION_RULES.find((r) => r.id === ruleId);
  if (!rule) return { error: "Escalation rule not found." };
  return {
    trigger: rule.trigger,
    currentTicketState: { status: ticket?.status, priority: ticket?.priority },
    proposedChange: rule.action,
    requiredPermission: rule.requiredPermission,
    requiredApprover: rule.requiredApprover,
    affectedUsers: ticket?.assignedAgentId ? [ticket.assignedAgentId] : [],
    potentialCustomerImpact: "None — internal escalation only, no customer-facing message is sent.",
    isPreview: true,
  };
}

// ---------------------------------------------------------------------------
// Telephony — calls, dispositions, recording/transcript access states.
// ---------------------------------------------------------------------------
export function createSupportCallPreview({
  id, orgId, providerKey, direction, phoneNumberMasked, matchedContactId = null,
  matchedCompanyId = null, agentId = null, startedAt, answeredAt = null, endedAt = null,
  durationSeconds = 0, result = "Answered", disposition = "Other",
  recordingAvailability = "Unavailable", transcriptAvailability = "Unavailable", followUpStatus = "None",
}) {
  return {
    id, orgId, providerKey, direction, phoneNumberMasked, matchedContactId, matchedCompanyId,
    agentId, startedAt, answeredAt, endedAt, durationSeconds, result, disposition,
    recordingAvailability, transcriptAvailability, followUpStatus,
  };
}

function maskPhone(phone) {
  if (!phone) return "•••• hidden";
  return phone.replace(/\d(?=\d{4})/g, "•");
}

export const SUPPORT_CALLS = [
  createSupportCallPreview({ id: "call_1", orgId: ORG_HQ, providerKey: "aircall", direction: "Inbound", phoneNumberMasked: maskPhone("+15550142"), matchedContactId: contacts[0]?._id || null, agentId: "u5", startedAt: hoursAgo(4), answeredAt: hoursAgo(4), endedAt: hoursAgo(4), durationSeconds: 340, result: "Answered", disposition: "Resolved", recordingAvailability: "Available", transcriptAvailability: "Processing Preview" }),
  createSupportCallPreview({ id: "call_2", orgId: ORG_HQ, providerKey: "aircall", direction: "Inbound", phoneNumberMasked: maskPhone("+15550198"), agentId: null, startedAt: hoursAgo(6), result: "Missed", disposition: "No Answer", recordingAvailability: "Unavailable", transcriptAvailability: "Unavailable" }),
  createSupportCallPreview({ id: "call_3", orgId: ORG_NIMBUS, providerKey: "ringcentral", direction: "Outbound", phoneNumberMasked: maskPhone("+15550233"), agentId: "u3", startedAt: hoursAgo(2), answeredAt: hoursAgo(2), endedAt: hoursAgo(2), durationSeconds: 120, result: "Answered", disposition: "Follow-up Required", recordingAvailability: "Consent Required", transcriptAvailability: "Restricted", followUpStatus: "Pending" }),
  createSupportCallPreview({ id: "call_4", orgId: ORG_HQ, providerKey: "aircall", direction: "Inbound", phoneNumberMasked: maskPhone("+15550261"), agentId: null, startedAt: hoursAgo(10), result: "Voicemail", disposition: "Voicemail", recordingAvailability: "Retention Expired", transcriptAvailability: "Retention Expired" }),
];

export function queryCallsLocal(filters = {}) {
  let results = SUPPORT_CALLS.slice();
  if (filters.orgId) results = results.filter((c) => c.orgId === filters.orgId);
  if (filters.disposition) results = results.filter((c) => c.disposition === filters.disposition);
  if (filters.result) results = results.filter((c) => c.result === filters.result);
  return results.slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

// "Create a shared CRM Activity preview after confirmation" — no separate
// Activity fixture module exists to import from here; mockApi.js performs
// the actual write against mockCrmData's real Activities on confirmation.
export function markCallFollowUpCreated(callId) {
  const call = SUPPORT_CALLS.find((c) => c.id === callId);
  if (!call) return { error: "Call not found." };
  call.followUpStatus = "Activity Created";
  return { call };
}

// ---------------------------------------------------------------------------
// Review management — Google Business Profile previews only; no automatic
// posting, no automatic Urgent escalation from rating alone.
// ---------------------------------------------------------------------------
export function createSupportReviewPreview({
  id, orgId, providerKey, locationName, reviewerDisplayName = null, rating,
  reviewText, reviewDate, replyStatus = "Not Replied", replyDraft = null,
  relatedIssueId = null, assignedResponderId = null, escalationState = "None",
  matchedContactId = null,
}) {
  return {
    id, orgId, providerKey, locationName, reviewerDisplayName, rating, reviewText, reviewDate,
    replyStatus, replyDraft, relatedIssueId, assignedResponderId, escalationState, matchedContactId,
  };
}

export const SUPPORT_REVIEWS = [
  createSupportReviewPreview({ id: "rev_1", orgId: ORG_SOLSTICE, providerKey: "google_business_profile", locationName: "Solstice Partners — Downtown", reviewerDisplayName: "A. Patel", rating: 2, reviewText: "Support took too long to respond.", reviewDate: daysAgo(4) }),
  createSupportReviewPreview({ id: "rev_2", orgId: ORG_SOLSTICE, providerKey: "google_business_profile", locationName: "Solstice Partners — Downtown", reviewerDisplayName: "J. Okoro", rating: 5, reviewText: "Great onboarding experience!", reviewDate: daysAgo(10), replyStatus: "Replied" }),
];

export function queryReviewsLocal(filters = {}) {
  let results = SUPPORT_REVIEWS.slice();
  if (filters.orgId) results = results.filter((r) => r.orgId === filters.orgId);
  return results;
}

// Draft only — never automatically posted, and a low rating never
// automatically becomes Urgent without an explicit organization rule
// (none is configured by default in this preview).
export function draftReviewReply(reviewId, draftText, actorName = "Preview User") {
  const review = SUPPORT_REVIEWS.find((r) => r.id === reviewId);
  if (!review) return { error: "Review not found." };
  review.replyDraft = draftText;
  review.replyStatus = "Draft Prepared";
  review.assignedResponderId = actorName;
  return { review };
}

// ---------------------------------------------------------------------------
// Communication consent — a pure projection of Contact's real consent
// fields, never a second stored source of truth.
// ---------------------------------------------------------------------------
export function deriveSupportCommunicationConsent(contact) {
  if (!contact) return null;
  return {
    recordId: contact._id,
    recordType: "Contact",
    emailAllowed: contact.emailAllowed !== false,
    phoneAllowed: contact.phoneAllowed !== false,
    smsAllowed: contact.smsAllowed !== false,
    messagingAllowed: contact.marketingAllowed !== false,
    doNotContact: !!contact.doNotContact,
  };
}

// ---------------------------------------------------------------------------
// Overview metrics — pure, deterministic, never a hardcoded card value.
// Mirrors mockIntegrationsData.js's computeIntegrationMetrics for Phase 1.
// ---------------------------------------------------------------------------
const PHASE3_PROVIDER_KEYS = new Set(PHASE3_PROVIDERS.map((p) => p.key));
const OPEN_CANONICAL_STATUSES = new Set(["New", "Open", "Waiting on Internal Team"]);

export function computeSupportOverviewMetrics({ organizationId, connections = [] } = {}) {
  const orgConversations = organizationId ? SUPPORT_CONVERSATIONS.filter((c) => c.orgId === organizationId) : SUPPORT_CONVERSATIONS;
  const orgCalls = organizationId ? SUPPORT_CALLS.filter((c) => c.orgId === organizationId) : SUPPORT_CALLS;
  const ticketPreviews = querySupportTicketPreviewsLocal(organizationId ? { organizationId } : {});
  const slaConfig = organizationId ? findSupportSLAConfiguration(organizationId) : SUPPORT_SLA_CONFIGURATIONS[0];

  const previewConnectedSupportProviders = connections.filter(
    (c) => PHASE3_PROVIDER_KEYS.has(c.providerKey) && c.status === "Preview Connected" && (!organizationId || c.organizationId === organizationId)
  ).length;

  const openSyncedTicketPreviews = ticketPreviews.filter((p) => OPEN_CANONICAL_STATUSES.has(p.canonicalStatus) || p.canonicalStatus === "Open").length;

  const unassignedTickets = tickets.filter(
    (t) => !t.assignedAgentId && !t.assignedAgent && !["Resolved", "Closed"].includes(t.status)
  ).length;

  const unreadConversations = orgConversations.filter((c) => c.unread).length;
  // Ticket records have no organizationId field of their own (confirmed in
  // mockSupportData.js), so the Ticket-derived half of this count is
  // necessarily org-wide; only the conversation half is org-scoped.
  const waitingOnCustomerTickets = orgConversations.filter((c) => c.status === "Waiting on Customer").length
    + tickets.filter((t) => t.status === "Waiting for Customer").length;

  let slaAtRisk = 0;
  let slaBreached = 0;
  tickets.forEach((t) => {
    const state = computeSlaState(t, slaConfig);
    if (state === "At Risk") slaAtRisk += 1;
    if (state === "Breached") slaBreached += 1;
  });

  const missedCalls = orgCalls.filter((c) => c.result === "Missed").length;

  const identityMatchesRequiringReview = orgConversations.filter((c) => {
    if (c.linkedTicketId) return false;
    const match = matchSupportIdentity(c.customer || {});
    return ["Possible Match", "Multiple Matches", "Conflict", "Restricted Match"].includes(match.state);
  }).length;

  const synchronizationErrors = SUPPORT_SYNC_CONFLICTS.filter((c) => c.resolutionState === "Open").length;

  return {
    previewConnectedSupportProviders,
    openSyncedTicketPreviews,
    unassignedTickets,
    unreadConversations,
    waitingOnCustomerTickets,
    slaAtRisk,
    slaBreached,
    missedCalls,
    identityMatchesRequiringReview,
    synchronizationErrors,
  };
}

// Referenced by findTicket/escalateTicketRecord/companies where a
// consumer needs the real record, not a copy — re-exported for
// convenience so pages needn't import mockSupportData.js/mockCrmData.js
// separately just to resolve a ticket/company by id from a Phase 3 record.
export { findTicket, escalateTicketRecord, companies };
