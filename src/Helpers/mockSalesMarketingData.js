// Centralized, provider-neutral frontend fixtures for Sales & Marketing
// Integrations (/admin/integrations/sales-marketing/*) — Phase 2 preview,
// extending (never forking) the Phase 1 Integration Center architecture in
// mockIntegrationsData.js.
//
// STRICT BOUNDARY: nothing here contacts a real provider, exchanges a real
// OAuth token, stores a real credential, sends a real email, uploads a real
// ad conversion, or moves real customer data. Every connection/sync keeps
// the same "Frontend Connection Preview" / "Preview Synchronization" labels
// established in Phase 1. Duplicate detection reuses the real engine in
// duplicateMatching.js rather than reimplementing it; audiences/attribution
// are always computed live against the real shared CRM records, never a
// stored duplicate copy.
//
// NO IMPORT FROM mockIntegrationsData.js HERE — DELIBERATELY. That file
// imports PHASE2_PROVIDERS from this one to build its PROVIDERS array; if
// this file imported anything back from mockIntegrationsData.js, the two
// would form a genuine circular dependency, and whichever one happened to
// load first (e.g. a test importing this file directly) would evaluate the
// other's top-level `const` exports before they exist, throwing
// "PHASE2_PROVIDERS is not iterable". The provider-factory functions instead
// live in the dependency-free mockIntegrationsContracts.js, imported by both
// files, and integration-audit recording for Phase 2 actions is done by
// mockApi.js's handlers (which already import both fixture modules) rather
// than by this file calling back into mockIntegrationsData.js.
import {
  createIntegrationProvider,
  createIntegrationCapability,
  createIntegrationPlanRequirement,
} from "./mockIntegrationsContracts";
import { ORGANIZATIONS, DEFAULT_ORGANIZATION_ID, TEAMS } from "./mockAccessData";
import { CRM_TEAM } from "./mockUsersData";
import { leads, contacts, deals, createLeadRecord } from "./mockCrmData";
import { evaluateMatch } from "../pages/CRM/Duplicates/duplicateMatching";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const LEAD_CAPTURE_STATUSES = [
  "Received", "Validating", "Mapped", "Duplicate Detected", "Needs Review",
  "Ready to Create", "Created in Preview", "Rejected", "Failed",
];

export const SUPPRESSION_REASONS = [
  "Unsubscribed", "Do-Not-Contact", "Hard Bounce", "Spam Complaint",
  "Invalid Address", "Manual Suppression", "Missing Consent", "Restricted Record",
];

export const EMAIL_DELIVERY_STATUSES = [
  "Draft Preview", "Queued Preview", "Sent Preview", "Delivered", "Deferred",
  "Bounced", "Blocked", "Complained", "Suppressed", "Failed", "Opened", "Clicked", "Unsubscribed",
];

export const EMAIL_PURPOSES = ["transactional", "marketing"];

export const TRANSACTIONAL_EMAIL_TYPES = [
  "Organization Invitation", "Password Reset", "Account Security Notice",
  "Quote Notification", "Contract Reminder", "Payment Notification",
];

export const MARKETING_EMAIL_TYPES = [
  "Newsletter", "Product Announcement", "Lead-Nurture Campaign", "Promotional Campaign",
];

export const ATTRIBUTION_MODELS = [
  "First Touch", "Last Touch", "Linear Multi-Touch Preview", "Position-Based Preview",
];

export const ROUTING_ASSIGNMENT_TYPES = ["Round-robin Preview", "Named Owner", "Default Queue"];

export const INTEGRATION_CHANNELS = [
  "Email Marketing", "Transactional Email", "Advertising & Lead Generation", "Analytics & Attribution", "Forms",
];

export const ROI_UNAVAILABLE_MESSAGE = "ROI unavailable — verified campaign cost data is not available in the frontend preview.";

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

const ORG_HQ = ORGANIZATIONS[0]?.id || DEFAULT_ORGANIZATION_ID;
const ORG_NIMBUS = ORGANIZATIONS[1]?.id || ORG_HQ;
const ORG_SOLSTICE = ORGANIZATIONS[2]?.id || ORG_HQ;

// ---------------------------------------------------------------------------
// PHASE2_PROVIDERS — 13 Sales & Marketing providers, same factory shape as
// Phase 1's BASE_PROVIDERS in mockIntegrationsData.js. None of these ship a
// real logo file; ProviderLogo.jsx already falls back to a colored-letter
// badge automatically for any providerKey it doesn't recognize.
// ---------------------------------------------------------------------------
export const PHASE2_PROVIDERS = [
  createIntegrationProvider({
    key: "mailchimp",
    name: "Mailchimp",
    category: "Marketing",
    channel: "Email Marketing",
    icon: "Mail",
    shortDescription: "Audience synchronization preview and campaign references for Mailchimp.",
    longDescription: "Mailchimp previews audience/list synchronization, tag and segment mapping, and campaign references against authorized Contacts. No real Mailchimp audience is contacted, and no real campaign is ever sent from this CRM.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Free Tier Available",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Free Tier Available", notes: "Some audience-size and automation features require a paid Mailchimp plan." }),
    supportedModules: ["Contacts", "Companies"],
    capabilities: [
      createIntegrationCapability({ id: "mc_audience_sync", name: "Audience synchronization preview", crmModule: "Contacts", direction: "both", requiredPermission: "audience_sync.manage", sensitiveData: true }),
      createIntegrationCapability({ id: "mc_campaign_reference", name: "Campaign reference", crmModule: "Contacts", direction: "read", requiredPermission: "marketing_integrations.view", description: "A clearly labelled integration-preview campaign reference, never a canonical CRM record." }),
      createIntegrationCapability({ id: "mc_tag_segment_mapping", name: "Tag and segment mapping", crmModule: "Contacts", direction: "both", requiredPermission: "audience_sync.manage" }),
    ],
    dataLeavingCrm: ["Names and emails of Contacts explicitly included in a synced audience preview"],
    dataEnteringCrm: ["Audience membership status previews", "Campaign reference metadata"],
    knownLimitations: ["No real campaign is ever sent from this CRM.", "Audience membership always excludes suppressed/non-consented Contacts before counting."],
    securityNotes: ["Marketing consent is re-checked live on every audience preview, never cached."],
  }),
  createIntegrationProvider({
    key: "brevo",
    name: "Brevo",
    category: "Marketing",
    channel: "Email Marketing",
    icon: "Mail",
    shortDescription: "Combined marketing-audience and transactional-email preview for Brevo.",
    longDescription: "Brevo previews contact-list synchronization and campaign references (marketing) as well as transactional message previews for CRM system notifications. Marketing and transactional capabilities remain strictly separated — a transactional send never subscribes a recipient to a marketing list.",
    authMethod: "API Key",
    pricingClassification: "Provider Free Tier Available",
    credentialFieldInfo: { label: "Brevo API Key", disabledPlaceholder: "Credentials will be configured securely during backend integration." },
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Free Tier Available", notes: "Higher sending volumes require a paid Brevo plan." }),
    supportedModules: ["Contacts", "Leads"],
    capabilities: [
      createIntegrationCapability({ id: "brevo_audience_sync", name: "Contact-list synchronization preview", crmModule: "Contacts", direction: "both", requiredPermission: "audience_sync.manage", sensitiveData: true }),
      createIntegrationCapability({ id: "brevo_transactional_preview", name: "Transactional message preview", crmModule: "Contacts", direction: "write", requiredPermission: "email_delivery.view", description: "CRM system notifications only — never subscribes a recipient to a marketing list." }),
      createIntegrationCapability({ id: "brevo_campaign_reference", name: "Campaign reference", crmModule: "Contacts", direction: "read", requiredPermission: "marketing_integrations.view" }),
    ],
    dataLeavingCrm: ["Names and emails of Contacts explicitly included in a synced audience preview", "Transactional message content for CRM system notifications"],
    dataEnteringCrm: ["Audience membership status previews", "Transactional delivery status previews"],
    knownLimitations: ["No real email of any kind is ever sent."],
    securityNotes: ["Transactional and marketing capabilities are enforced as strictly separate — never combined into one send."],
  }),
  createIntegrationProvider({
    key: "sendgrid",
    name: "SendGrid",
    category: "Marketing",
    channel: "Transactional Email",
    icon: "Send",
    shortDescription: "Transactional-email delivery preview for CRM system notifications.",
    longDescription: "SendGrid previews transactional-only delivery for CRM system emails: organization invitations, password resets, quote notifications, contract reminders, activity reminders and system notifications. Do not send any real email — every send is a frontend preview only.",
    authMethod: "API Key",
    pricingClassification: "Usage-Based Provider",
    credentialFieldInfo: { label: "SendGrid API Key", disabledPlaceholder: "Credentials will be configured securely during backend integration." },
    planRequirement: createIntegrationPlanRequirement({ classification: "Usage-Based Provider", notes: "SendGrid bills per email sent, directly to the organization's SendGrid account." }),
    supportedModules: ["Contacts", "Deals", "Quotes", "Contracts"],
    capabilities: [
      createIntegrationCapability({ id: "sg_transactional_send", name: "Transactional send preview", crmModule: "Contacts", direction: "write", requiredPermission: "email_delivery.retry", requiresHumanApproval: true, description: "Organization invitations, password resets, quote notifications, contract reminders, activity reminders, system notifications." }),
      createIntegrationCapability({ id: "sg_delivery_status", name: "Delivery status preview", crmModule: "Contacts", direction: "read", requiredPermission: "email_delivery.view" }),
    ],
    dataLeavingCrm: ["Recipient email and message content for CRM system notifications only"],
    dataEnteringCrm: ["Delivery/bounce/complaint status previews"],
    knownLimitations: ["Transactional-only — never used for marketing sends.", "Do not send any real email in this frontend phase."],
    securityNotes: ["Every transactional send preview requires human approval before being marked complete."],
  }),
  createIntegrationProvider({
    key: "amazon_ses",
    name: "Amazon SES",
    category: "Marketing",
    channel: "Transactional Email",
    icon: "Send",
    shortDescription: "Transactional-email delivery preview via Amazon Simple Email Service.",
    longDescription: "Amazon SES previews transactional CRM system-email delivery. Sender/domain verification is shown as a future backend and DNS requirement — no domain is actually verified from this frontend phase.",
    authMethod: "Service Account",
    pricingClassification: "Usage-Based Provider",
    planRequirement: createIntegrationPlanRequirement({ classification: "Usage-Based Provider", notes: "Amazon SES bills per email sent, directly through the organization's AWS account." }),
    supportedModules: ["Contacts", "Deals", "Quotes", "Contracts"],
    capabilities: [
      createIntegrationCapability({ id: "ses_transactional_send", name: "Transactional send preview", crmModule: "Contacts", direction: "write", requiredPermission: "email_delivery.retry", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "ses_sender_verification", name: "Sender verification (future requirement)", crmModule: "Contacts", direction: "read", requiredPermission: "email_delivery.view", description: "Shown as a future backend and DNS requirement — no real domain is verified here." }),
      createIntegrationCapability({ id: "ses_delivery_status", name: "Delivery status preview", crmModule: "Contacts", direction: "read", requiredPermission: "email_delivery.view" }),
    ],
    dataLeavingCrm: ["Recipient email and message content for CRM system notifications only"],
    dataEnteringCrm: ["Delivery/bounce/complaint status previews"],
    knownLimitations: ["No sending domain is actually verified — DNS/verification is a future backend requirement."],
    securityNotes: ["Every transactional send preview requires human approval before being marked complete."],
  }),
  createIntegrationProvider({
    key: "resend",
    name: "Resend",
    category: "Marketing",
    channel: "Transactional Email",
    icon: "Send",
    shortDescription: "Transactional-email delivery preview via Resend.",
    longDescription: "Resend previews transactional CRM system-email delivery. Do not request or display an API key for this provider in the frontend preview — credential entry is deferred entirely to backend integration.",
    authMethod: "API Key",
    pricingClassification: "Provider Free Tier Available",
    credentialFieldInfo: null,
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Free Tier Available", notes: "Higher sending volumes require a paid Resend plan." }),
    supportedModules: ["Contacts", "Deals", "Quotes", "Contracts"],
    capabilities: [
      createIntegrationCapability({ id: "resend_transactional_send", name: "Transactional send preview", crmModule: "Contacts", direction: "write", requiredPermission: "email_delivery.retry", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "resend_delivery_status", name: "Delivery status preview", crmModule: "Contacts", direction: "read", requiredPermission: "email_delivery.view" }),
    ],
    dataLeavingCrm: ["Recipient email and message content for CRM system notifications only"],
    dataEnteringCrm: ["Delivery/bounce/complaint status previews"],
    knownLimitations: ["No API key is requested or displayed anywhere in this frontend preview."],
    securityNotes: ["Every transactional send preview requires human approval before being marked complete."],
  }),
  createIntegrationProvider({
    key: "meta_lead_ads",
    name: "Meta Lead Ads",
    category: "Marketing",
    channel: "Advertising & Lead Generation",
    icon: "Megaphone",
    shortDescription: "Lead-ad form submission and campaign-reference preview for Meta.",
    longDescription: "Meta Lead Ads previews instant-form lead capture and campaign references. Never display a real Facebook or Instagram account — every account/page/campaign reference shown here is frontend fixture data only.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Contact Provider",
    planRequirement: createIntegrationPlanRequirement({ classification: "Contact Provider", notes: "Ad spend and account access are managed entirely on Meta's own platform." }),
    supportedModules: ["Leads"],
    capabilities: [
      createIntegrationCapability({ id: "mla_lead_form_preview", name: "Instant-form lead capture preview", crmModule: "Leads", direction: "read", requiredPermission: "lead_capture.view", sensitiveData: true }),
      createIntegrationCapability({ id: "mla_campaign_reference", name: "Campaign reference", crmModule: "Leads", direction: "read", requiredPermission: "marketing_integrations.view" }),
    ],
    dataLeavingCrm: ["Nothing — Meta Lead Ads is import-only in this preview"],
    dataEnteringCrm: ["Instant-form submission previews (name, email, phone, product interest)", "Campaign reference metadata"],
    knownLimitations: ["Never displays a real Facebook or Instagram account, page or ad account."],
    securityNotes: ["Every captured submission is reviewed for duplicates before a real Lead is ever created."],
  }),
  createIntegrationProvider({
    key: "google_ads",
    name: "Google Ads",
    category: "Marketing",
    channel: "Advertising & Lead Generation",
    icon: "Megaphone",
    shortDescription: "Lead-form-extension capture and conversion-mapping preview for Google Ads.",
    longDescription: "Google Ads previews lead-form-extension capture, campaign references and conversion mapping back to Google Ads. Do not simulate campaign-management actions such as changing bids or budgets — this integration never manages the Google Ads account itself.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Contact Provider",
    planRequirement: createIntegrationPlanRequirement({ classification: "Contact Provider", notes: "Ad spend and budget management remain entirely on Google's own platform." }),
    supportedModules: ["Leads", "Deals"],
    capabilities: [
      createIntegrationCapability({ id: "ga_lead_form_preview", name: "Lead-form-extension capture preview", crmModule: "Leads", direction: "read", requiredPermission: "lead_capture.view", sensitiveData: true }),
      createIntegrationCapability({ id: "ga_conversion_mapping", name: "Conversion mapping preview", crmModule: "Deals", direction: "write", requiredPermission: "conversion_mapping.manage", requiresHumanApproval: true }),
      createIntegrationCapability({ id: "ga_campaign_reference", name: "Campaign reference", crmModule: "Leads", direction: "read", requiredPermission: "marketing_integrations.view" }),
    ],
    dataLeavingCrm: ["Conversion event references for Deals explicitly mapped to a Google Ads campaign"],
    dataEnteringCrm: ["Lead-form submission previews", "Campaign reference metadata"],
    knownLimitations: ["Never changes bids, budgets or other campaign-management settings — read/reference only."],
    securityNotes: ["Conversion uploads always require human approval before being marked complete."],
  }),
  createIntegrationProvider({
    key: "linkedin_lead_gen",
    name: "LinkedIn Lead Gen Forms",
    category: "Marketing",
    channel: "Advertising & Lead Generation",
    icon: "Megaphone",
    shortDescription: "Lead Gen Forms submission preview for LinkedIn.",
    longDescription: "LinkedIn Lead Gen Forms previews form submissions and campaign references. No real LinkedIn Company Page or ad account is ever displayed.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Contact Provider",
    planRequirement: createIntegrationPlanRequirement({ classification: "Contact Provider", notes: "Ad spend and account access are managed entirely on LinkedIn's own platform." }),
    supportedModules: ["Leads"],
    capabilities: [
      createIntegrationCapability({ id: "li_lead_form_preview", name: "Lead Gen Form submission preview", crmModule: "Leads", direction: "read", requiredPermission: "lead_capture.view", sensitiveData: true }),
      createIntegrationCapability({ id: "li_campaign_reference", name: "Campaign reference", crmModule: "Leads", direction: "read", requiredPermission: "marketing_integrations.view" }),
    ],
    dataLeavingCrm: ["Nothing — LinkedIn Lead Gen Forms is import-only in this preview"],
    dataEnteringCrm: ["Lead Gen Form submission previews", "Campaign reference metadata"],
    knownLimitations: ["No real LinkedIn Company Page or ad account is ever displayed."],
    securityNotes: ["Every captured submission is reviewed for duplicates before a real Lead is ever created."],
  }),
  createIntegrationProvider({
    key: "tiktok_lead_gen",
    name: "TikTok Lead Generation",
    category: "Marketing",
    channel: "Advertising & Lead Generation",
    icon: "Megaphone",
    shortDescription: "Lead Generation form submission preview for TikTok.",
    longDescription: "TikTok Lead Generation previews instant-form submissions and campaign references. No real TikTok Business account is ever displayed.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Contact Provider",
    planRequirement: createIntegrationPlanRequirement({ classification: "Contact Provider", notes: "Ad spend and account access are managed entirely on TikTok's own platform." }),
    supportedModules: ["Leads"],
    capabilities: [
      createIntegrationCapability({ id: "tt_lead_form_preview", name: "Lead Generation form submission preview", crmModule: "Leads", direction: "read", requiredPermission: "lead_capture.view", sensitiveData: true }),
      createIntegrationCapability({ id: "tt_campaign_reference", name: "Campaign reference", crmModule: "Leads", direction: "read", requiredPermission: "marketing_integrations.view" }),
    ],
    dataLeavingCrm: ["Nothing — TikTok Lead Generation is import-only in this preview"],
    dataEnteringCrm: ["Lead Generation form submission previews", "Campaign reference metadata"],
    knownLimitations: ["No real TikTok Business account is ever displayed."],
    securityNotes: ["Every captured submission is reviewed for duplicates before a real Lead is ever created."],
  }),
  createIntegrationProvider({
    key: "google_analytics_4",
    name: "Google Analytics 4",
    category: "Marketing",
    channel: "Analytics & Attribution",
    icon: "BarChart2",
    shortDescription: "Conversion-event mapping and UTM-attribution preview for GA4.",
    longDescription: "Google Analytics 4 previews conversion-event mapping and UTM-based attribution touchpoints. Attribution never invents revenue — a Deal is only attributed when a traceable, permitted Lead/Contact/Company relationship exists.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Free Tier Available",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Free Tier Available", notes: "Some advanced reporting features require Google Analytics 360." }),
    supportedModules: ["Leads", "Deals"],
    capabilities: [
      createIntegrationCapability({ id: "ga4_conversion_mapping", name: "Conversion-event mapping preview", crmModule: "Deals", direction: "read", requiredPermission: "attribution.configure" }),
      createIntegrationCapability({ id: "ga4_utm_tracking", name: "UTM-attribution preview", crmModule: "Leads", direction: "read", requiredPermission: "attribution.view" }),
    ],
    dataLeavingCrm: ["Nothing — GA4 attribution is read/reference-only in this preview"],
    dataEnteringCrm: ["Conversion-event references", "UTM parameter previews"],
    knownLimitations: ["ROI is never calculated without verified provider spend data — shown as unavailable instead."],
    securityNotes: ["Attribution is only shown when a traceable, permitted CRM relationship exists."],
  }),
  createIntegrationProvider({
    key: "microsoft_clarity",
    name: "Microsoft Clarity",
    category: "Marketing",
    channel: "Analytics & Attribution",
    icon: "BarChart2",
    shortDescription: "Aggregate behavioral-metric preview for Microsoft Clarity.",
    longDescription: "Microsoft Clarity previews aggregate behavioral metrics only. Do not display or recreate real session recordings. Do not expose typed input, passwords or sensitive page content — this integration has no session-replay concept at all.",
    authMethod: "API Key",
    pricingClassification: "Provider Free Tier Available",
    credentialFieldInfo: { label: "Microsoft Clarity Project API Key", disabledPlaceholder: "Credentials will be configured securely during backend integration." },
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Free Tier Available", notes: "Microsoft Clarity is free; no paid tier exists." }),
    supportedModules: ["Leads"],
    capabilities: [
      createIntegrationCapability({ id: "clarity_aggregate_metrics", name: "Aggregate behavioral metrics", crmModule: "Leads", direction: "read", requiredPermission: "attribution.view", description: "Aggregate metrics only — never a session recording, typed input or page content." }),
    ],
    dataLeavingCrm: ["Nothing — Microsoft Clarity is read/reference-only in this preview"],
    dataEnteringCrm: ["Aggregate behavioral metric previews only"],
    knownLimitations: ["No session recording, replay, or page-content capability exists in this integration at all."],
    securityNotes: ["Never exposes typed input, passwords or sensitive page content, by design — not just by omission."],
  }),
  createIntegrationProvider({
    key: "typeform",
    name: "Typeform",
    category: "Marketing",
    channel: "Forms",
    icon: "FileText",
    shortDescription: "Form connection and field-mapping preview for Typeform.",
    longDescription: "Typeform previews form connections, response mapping to CRM fields, and enablement gating when required CRM fields are unmapped.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Free Tier Available",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Free Tier Available", notes: "Response-volume limits apply on Typeform's free tier." }),
    supportedModules: ["Leads"],
    capabilities: [
      createIntegrationCapability({ id: "tf_form_connection", name: "Form connection preview", crmModule: "Leads", direction: "read", requiredPermission: "forms_integrations.view" }),
      createIntegrationCapability({ id: "tf_field_mapping", name: "Field mapping", crmModule: "Leads", direction: "both", requiredPermission: "forms_integrations.manage" }),
    ],
    dataLeavingCrm: ["Nothing — Typeform is import-only in this preview"],
    dataEnteringCrm: ["Form response previews mapped to configured CRM fields"],
    knownLimitations: ["A form cannot be enabled while required CRM fields remain unmapped.", "No arbitrary script execution is permitted in a transformation field."],
    securityNotes: ["Form responses are masked by default in every table/detail/export-preview surface."],
  }),
  createIntegrationProvider({
    key: "google_forms",
    name: "Google Forms",
    category: "Marketing",
    channel: "Forms",
    icon: "FileText",
    shortDescription: "Form connection and field-mapping preview for Google Forms.",
    longDescription: "Google Forms previews form connections, response mapping to CRM fields, and enablement gating when required CRM fields are unmapped.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Free Tier Available",
    planRequirement: createIntegrationPlanRequirement({ classification: "Provider Free Tier Available", notes: "Requires a Google account with Forms API access enabled." }),
    supportedModules: ["Leads"],
    capabilities: [
      createIntegrationCapability({ id: "gf_form_connection", name: "Form connection preview", crmModule: "Leads", direction: "read", requiredPermission: "forms_integrations.view" }),
      createIntegrationCapability({ id: "gf_field_mapping", name: "Field mapping", crmModule: "Leads", direction: "both", requiredPermission: "forms_integrations.manage" }),
    ],
    dataLeavingCrm: ["Nothing — Google Forms is import-only in this preview"],
    dataEnteringCrm: ["Form response previews mapped to configured CRM fields"],
    knownLimitations: ["A form cannot be enabled while required CRM fields remain unmapped.", "No arbitrary script execution is permitted in a transformation field."],
    securityNotes: ["Form responses are masked by default in every table/detail/export-preview surface."],
  }),
];

// ---------------------------------------------------------------------------
// Campaign references / Form connections — provider-side metadata that may
// OPTIONALLY link to a real mockMarketingData.js Campaign/Form, never a fork
// of one. mockMarketingData.js itself is never imported/modified here.
// ---------------------------------------------------------------------------
export function createCampaignReference({
  id, providerKey, name, providerCampaignId, utm = {}, status = "Active Preview",
  linkedCampaignId = null,
}) {
  return {
    id, providerKey, name, providerCampaignId, utm, status, linkedCampaignId,
    isPreviewReference: true,
    previewLabel: linkedCampaignId ? null : "Integration Preview Campaign Reference — not a CRM record",
  };
}

export const CAMPAIGN_REFERENCES = [
  createCampaignReference({ id: "campref_1", providerKey: "mailchimp", name: "Q3 Newsletter Preview", providerCampaignId: "mc_campaign_9182", utm: { source: "mailchimp", medium: "email", campaign: "q3_newsletter" } }),
  createCampaignReference({ id: "campref_2", providerKey: "meta_lead_ads", name: "HQ Demo Request Preview", providerCampaignId: "meta_camp_5521", utm: { source: "facebook", medium: "paid_social", campaign: "demo_request" } }),
  createCampaignReference({ id: "campref_3", providerKey: "google_ads", name: "Search — CRM Software Preview", providerCampaignId: "gads_camp_7743", utm: { source: "google", medium: "cpc", campaign: "crm_software" } }),
  createCampaignReference({ id: "campref_4", providerKey: "linkedin_lead_gen", name: "Enterprise Buyers Preview", providerCampaignId: "li_camp_3321", utm: { source: "linkedin", medium: "paid_social", campaign: "enterprise_buyers" } }),
  createCampaignReference({ id: "campref_5", providerKey: "tiktok_lead_gen", name: "Brand Awareness Preview", providerCampaignId: "tt_camp_2210", utm: {} }),
];

export function findCampaignReference(id) {
  return CAMPAIGN_REFERENCES.find((c) => c.id === id) || null;
}

export function queryCampaignReferencesLocal(filters = {}) {
  let results = CAMPAIGN_REFERENCES.slice();
  if (filters.providerKey) results = results.filter((c) => c.providerKey === filters.providerKey);
  return results;
}

export function createFormConnection({
  id, providerKey, organizationId, formName, status = "Preview Available",
  fieldMappings = [], requiredCrmFields = ["email"], enabled = false,
}) {
  return { id, providerKey, organizationId, formName, status, fieldMappings, requiredCrmFields, enabled };
}

export function createFormFieldMapping({
  id, providerField, crmField, transformation = "None", required = false,
}) {
  return { id, providerField, crmField, transformation, required };
}

export const FORM_CONNECTIONS = [
  createFormConnection({
    id: "form_1", providerKey: "typeform", organizationId: ORG_HQ, formName: "Contact Sales", status: "Preview Connected", enabled: true,
    requiredCrmFields: ["email", "companyName"],
    fieldMappings: [
      createFormFieldMapping({ id: "ffm_1", providerField: "work_email", crmField: "email", required: true }),
      createFormFieldMapping({ id: "ffm_2", providerField: "company", crmField: "companyName", required: true }),
      createFormFieldMapping({ id: "ffm_3", providerField: "full_name", crmField: "name", transformation: "Split into first/last name" }),
    ],
  }),
  createFormConnection({
    id: "form_2", providerKey: "typeform", organizationId: ORG_HQ, formName: "Event Registration", status: "Configuration Required", enabled: false,
    requiredCrmFields: ["email", "companyName"],
    fieldMappings: [
      createFormFieldMapping({ id: "ffm_4", providerField: "work_email", crmField: "email", required: true }),
    ],
  }),
  createFormConnection({
    id: "form_3", providerKey: "google_forms", organizationId: ORG_NIMBUS, formName: "Product Demo Request", status: "Preview Connected", enabled: true,
    requiredCrmFields: ["email"],
    fieldMappings: [
      createFormFieldMapping({ id: "ffm_5", providerField: "Email address", crmField: "email", required: true }),
      createFormFieldMapping({ id: "ffm_6", providerField: "Phone number", crmField: "phone", transformation: "Normalize phone format" }),
    ],
  }),
];

export function findFormConnection(id) {
  return FORM_CONNECTIONS.find((f) => f.id === id) || null;
}

export function queryFormConnectionsLocal(filters = {}) {
  let results = FORM_CONNECTIONS.slice();
  if (filters.organizationId) results = results.filter((f) => f.organizationId === filters.organizationId);
  if (filters.providerKey) results = results.filter((f) => f.providerKey === filters.providerKey);
  return results;
}

export function updateFormFieldMapping(formConnectionId, mappingId, changes) {
  const form = findFormConnection(formConnectionId);
  if (!form) return { error: "Form connection not found." };
  const idx = form.fieldMappings.findIndex((m) => m.id === mappingId);
  if (idx === -1) return { error: "Field mapping not found." };
  form.fieldMappings[idx] = { ...form.fieldMappings[idx], ...changes };
  return { fieldMapping: form.fieldMappings[idx] };
}

// "Publish/enable a form" is one of the ten named sensitive preview actions
// — never allowed while a required CRM field remains unmapped.
export function enableFormConnection(formConnectionId) {
  const form = findFormConnection(formConnectionId);
  if (!form) return { error: "Form connection not found." };
  const mappedCrmFields = new Set(form.fieldMappings.map((m) => m.crmField));
  const unmapped = form.requiredCrmFields.filter((f) => !mappedCrmFields.has(f));
  if (unmapped.length > 0) {
    return { error: `Cannot enable this form — required CRM field(s) not yet mapped: ${unmapped.join(", ")}.` };
  }
  form.enabled = true;
  form.status = "Preview Connected";
  return { form };
}

// ---------------------------------------------------------------------------
// Lead routing — new, deterministic, and honest about its limits. "Team" is
// a cosmetic condition backed by the org-scoped mockAccessData.js TEAMS,
// used only for the rule-condition dropdown, never for actual assignment.
// "Availability" is deliberately NOT implemented as a condition: CRM_TEAM
// has no capacity/status field anywhere in this codebase, and fabricating
// one would invent data rather than preview an action (unlike Phase 1's
// "preview action" language, which never claims a real field that isn't
// there).
// ---------------------------------------------------------------------------
export function createLeadRoutingRule({
  id, organizationId, name, conditions = {}, assignmentType = "Default Queue",
  namedOwnerId = null, ownerPoolDepartment = null, active = true,
}) {
  return { id, organizationId, name, conditions, assignmentType, namedOwnerId, ownerPoolDepartment, active };
}

export const LEAD_ROUTING_RULES = [
  createLeadRoutingRule({
    id: "route_1", organizationId: ORG_HQ, name: "HQ Sales — Round Robin",
    conditions: { department: "Sales" }, assignmentType: "Round-robin Preview", ownerPoolDepartment: "Sales",
  }),
  createLeadRoutingRule({
    id: "route_2", organizationId: ORG_HQ, name: "Marketing Leads to Grace",
    conditions: { source: "Advertisement" }, assignmentType: "Named Owner", namedOwnerId: "u6",
  }),
  createLeadRoutingRule({
    id: "route_3", organizationId: ORG_NIMBUS, name: "Nimbus Default Queue",
    conditions: {}, assignmentType: "Default Queue",
  }),
];

export function findLeadRoutingRule(id) {
  return LEAD_ROUTING_RULES.find((r) => r.id === id) || null;
}

export function queryLeadRoutingRulesLocal(filters = {}) {
  let results = LEAD_ROUTING_RULES.slice();
  if (filters.organizationId) results = results.filter((r) => r.organizationId === filters.organizationId);
  return results;
}

let roundRobinIndex = 0;
// Pure, session-deterministic — never claims real round-robin infrastructure
// ran. Sales Manager's RBAC grant (mockRbacData.js: lead_capture[VIEW] only,
// no separate lead_routing view action) relies on the Lead Capture table
// itself surfacing `routingPreview.assignedOwnerName`/`rule.name` as plain
// columns — do not drop those columns from the Lead Capture UI in a later
// phase, or Sales Manager loses its only channel for routing visibility.
export function previewLeadRouting(rule, _leadDraft) {
  if (!rule) return { assignmentType: "Default Queue", assignedOwnerId: null, assignedOwnerName: null, ruleId: null, ruleName: null, isPreview: true };
  const pool = rule.ownerPoolDepartment
    ? CRM_TEAM.filter((m) => m.department === rule.ownerPoolDepartment)
    : CRM_TEAM;

  if (rule.assignmentType === "Named Owner") {
    const owner = CRM_TEAM.find((m) => m.id === rule.namedOwnerId) || null;
    return { assignmentType: rule.assignmentType, assignedOwnerId: owner?.id || null, assignedOwnerName: owner?.name || null, ruleId: rule.id, ruleName: rule.name, isPreview: true };
  }
  if (rule.assignmentType === "Round-robin Preview" && pool.length > 0) {
    const owner = pool[roundRobinIndex % pool.length];
    roundRobinIndex += 1;
    return { assignmentType: rule.assignmentType, assignedOwnerId: owner.id, assignedOwnerName: owner.name, ruleId: rule.id, ruleName: rule.name, isPreview: true };
  }
  return { assignmentType: "Default Queue", assignedOwnerId: null, assignedOwnerName: null, ruleId: rule.id, ruleName: rule.name, isPreview: true };
}

// Cosmetic "Team" dropdown values for a routing rule's condition editor —
// display/reference only, never used to compute an actual assignment.
export function queryRoutableTeamsLocal(organizationId) {
  return TEAMS.filter((t) => t.organizationId === organizationId);
}

function matchesRoutingConditions(rule, leadDraft) {
  const { conditions } = rule;
  if (conditions.department && leadDraft.department !== conditions.department) return false;
  if (conditions.source && leadDraft.source !== conditions.source) return false;
  if (conditions.country && leadDraft.country !== conditions.country) return false;
  if (conditions.interestedProduct && leadDraft.interestedProduct !== conditions.interestedProduct) return false;
  if (conditions.campaignReference && leadDraft.campaignReference !== conditions.campaignReference) return false;
  if (conditions.formReference && leadDraft.formReference !== conditions.formReference) return false;
  return true;
}

export function resolveRoutingRuleForLead(organizationId, leadDraft) {
  const candidates = queryLeadRoutingRulesLocal({ organizationId }).filter((r) => r.active);
  const matched = candidates.find((r) => matchesRoutingConditions(r, leadDraft));
  return matched || candidates.find((r) => r.assignmentType === "Default Queue") || null;
}

// ---------------------------------------------------------------------------
// Lead Capture — a pre-Lead staging record, never a duplicate Lead. Creating
// a real Lead always goes through the same createLeadRecord() path
// mockMarketingData.js's submitFormLeadRecord already uses.
// ---------------------------------------------------------------------------
export function createLeadCaptureEvent({
  id, orgId, providerKey, externalReference,
  capturedFields = {}, campaignReference = null, formReference = null,
  status = "Received", duplicateMatches = [], routingPreview = null,
  createdLeadId = null, capturedAt = new Date().toISOString(), auditTrail = [],
}) {
  return {
    id, orgId, providerKey, externalReference, capturedFields,
    campaignReference, formReference, status, duplicateMatches, routingPreview,
    createdLeadId, capturedAt, auditTrail,
  };
}

export const LEAD_CAPTURE_EVENTS = [
  createLeadCaptureEvent({
    id: "lce_1", orgId: ORG_HQ, providerKey: "meta_lead_ads", externalReference: "meta_lead_88213",
    capturedFields: { firstName: "Noah", lastName: "Brennan", email: "noah.brennan@brightfield.example", phone: "+1-555-0142", companyName: "Brightfield Logistics", country: "United States", interestedProduct: "Enterprise Plan" },
    campaignReference: "campref_2", status: "Needs Review", capturedAt: hoursAgo(2),
  }),
  createLeadCaptureEvent({
    id: "lce_2", orgId: ORG_HQ, providerKey: "google_ads", externalReference: "gads_lead_44127",
    capturedFields: { firstName: "Elena", lastName: "Torres", email: "elena.torres@vantapoint.example", phone: "+1-555-0198", companyName: "Vantapoint Consulting", country: "United States", interestedProduct: "Growth Plan" },
    campaignReference: "campref_3", status: "Ready to Create", capturedAt: hoursAgo(5),
  }),
  createLeadCaptureEvent({
    id: "lce_3", orgId: ORG_HQ, providerKey: "typeform", formReference: "form_1", externalReference: "tf_resp_99213",
    capturedFields: { firstName: "Marcus", lastName: "Adeyemi", email: "marcus.adeyemi@harborline.example", phone: "+1-555-0177", companyName: "Harborline Freight", country: "United States", interestedProduct: "Starter Plan" },
    status: "Created in Preview", createdLeadId: null, capturedAt: daysAgo(2),
  }),
  createLeadCaptureEvent({
    id: "lce_4", orgId: ORG_NIMBUS, providerKey: "linkedin_lead_gen", externalReference: "li_lead_22019",
    capturedFields: { firstName: "Sofia", lastName: "Ricci", email: "sofia.ricci@nimbusretail.example", phone: "+1-555-0233", companyName: "Nimbus Retail Group", country: "United States", interestedProduct: "Enterprise Plan" },
    campaignReference: "campref_4", status: "Duplicate Detected", capturedAt: hoursAgo(8),
  }),
  createLeadCaptureEvent({
    id: "lce_5", orgId: ORG_NIMBUS, providerKey: "tiktok_lead_gen", externalReference: "tt_lead_11029",
    capturedFields: { firstName: "Jonah", lastName: "Whitfield", email: "jonah.whitfield@driftco.example", phone: "+1-555-0261", companyName: "Driftco", country: "United States", interestedProduct: "Growth Plan" },
    campaignReference: "campref_5", status: "Rejected", capturedAt: daysAgo(1),
    auditTrail: [{ action: "reject", actor: "Marcus Chen", reason: "Not a qualified fit — student inquiry.", at: daysAgo(1) }],
  }),
  createLeadCaptureEvent({
    id: "lce_6", orgId: ORG_SOLSTICE, providerKey: "google_forms", formReference: "form_3", externalReference: "gf_resp_55210",
    capturedFields: { firstName: "Anika", lastName: "Petrov", email: "anika.petrov@solsticeworks.example", phone: "+1-555-0304", companyName: "Solstice Works", country: "United States", interestedProduct: "Starter Plan" },
    status: "Failed", capturedAt: hoursAgo(12),
  }),
];

export function findLeadCaptureEvent(id) {
  return LEAD_CAPTURE_EVENTS.find((e) => e.id === id) || null;
}

export function queryLeadCaptureEventsLocal(filters = {}) {
  let results = LEAD_CAPTURE_EVENTS.slice();
  if (filters.orgId) results = results.filter((e) => e.orgId === filters.orgId);
  if (filters.providerKey) results = results.filter((e) => e.providerKey === filters.providerKey);
  if (filters.status) results = results.filter((e) => e.status === filters.status);
  return results.slice().sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
}

// Projects a LeadCaptureEvent's captured fields into the Lead-shaped record
// duplicateMatching.js's "leads" evidence rules expect, then reuses the
// real engine as-is — never a second matching implementation.
function projectCaptureAsLead(event) {
  const f = event.capturedFields;
  return {
    _id: `capture_draft_${event.id}`,
    name: `${f.firstName || ""} ${f.lastName || ""}`.trim(),
    email: f.email, phone: f.phone, companyName: f.companyName, source: "Advertisement",
    archived: false,
  };
}

export function detectLeadCaptureDuplicates(eventId) {
  const event = findLeadCaptureEvent(eventId);
  if (!event) return { error: "Lead capture event not found." };
  const draft = projectCaptureAsLead(event);
  const matches = leads
    .filter((l) => !l.archived)
    .map((existing) => evaluateMatch("leads", draft, existing))
    .filter(Boolean)
    .sort((a, b) => b.confidencePercent - a.confidencePercent);
  event.duplicateMatches = matches;
  if (matches.length > 0 && event.status !== "Created in Preview" && event.status !== "Rejected") {
    event.status = "Duplicate Detected";
  }
  return { event, matches };
}

// "Create Lead Preview" — the same real createLeadRecord() path
// mockMarketingData.js's submitFormLeadRecord already uses, tagging the
// resulting real Lead with its provider source on the shared Lead schema.
export function createLeadFromCapture(eventId, overrides = {}, actorName = "Preview User") {
  const event = findLeadCaptureEvent(eventId);
  if (!event) return { error: "Lead capture event not found." };
  if (event.createdLeadId) return { error: "A Lead has already been created from this capture event." };
  const f = event.capturedFields;
  const lead = createLeadRecord(
    {
      firstName: f.firstName, lastName: f.lastName, email: f.email, phone: f.phone,
      companyName: f.companyName, country: f.country, interestedProduct: f.interestedProduct,
      source: "Advertisement",
      sourceProviderKey: event.providerKey,
      sourceExternalReference: event.externalReference,
      ...overrides,
    },
    actorName
  );
  event.createdLeadId = lead._id;
  event.status = "Created in Preview";
  event.auditTrail.push({ action: "create_lead", actor: actorName, leadId: lead._id, at: new Date().toISOString() });
  return { event, lead };
}

export function rejectLeadCapture(eventId, reason, actorName = "Preview User") {
  if (!reason?.trim()) return { error: "A reason is required to reject a captured lead." };
  const event = findLeadCaptureEvent(eventId);
  if (!event) return { error: "Lead capture event not found." };
  event.status = "Rejected";
  event.auditTrail.push({ action: "reject", actor: actorName, reason, at: new Date().toISOString() });
  return { event };
}

export function retryLeadCaptureProcessing(eventId, actorName = "Preview User") {
  const event = findLeadCaptureEvent(eventId);
  if (!event) return { error: "Lead capture event not found." };
  if (event.status !== "Failed") return { error: "Only a Failed capture event can be retried." };
  event.status = "Received";
  event.auditTrail.push({ action: "retry", actor: actorName, at: new Date().toISOString() });
  return { event };
}

// ---------------------------------------------------------------------------
// Suppression — a real ledger, not a flag flip. Removal requires a reason
// and always appends an audit event.
// ---------------------------------------------------------------------------
export function createSuppressionEntry({
  id, contactId = null, leadId = null, reason, source = "Manual Suppression",
  addedBy = "System", addedAt = new Date().toISOString(),
}) {
  return { id, contactId, leadId, reason, source, addedBy, addedAt };
}

export const SUPPRESSION_ENTRIES = [
  createSuppressionEntry({ id: "sup_1", contactId: contacts[0]?._id || null, reason: "Unsubscribed", source: "Mailchimp", addedBy: "System", addedAt: daysAgo(30) }),
  createSuppressionEntry({ id: "sup_2", contactId: contacts[1]?._id || null, reason: "Hard Bounce", source: "SendGrid", addedBy: "System", addedAt: daysAgo(10) }),
  createSuppressionEntry({ id: "sup_3", leadId: leads[0]?._id || null, reason: "Missing Consent", source: "Manual Suppression", addedBy: "Grace Kim", addedAt: daysAgo(5) }),
];

export function findSuppressionEntry(id) {
  return SUPPRESSION_ENTRIES.find((s) => s.id === id) || null;
}

export function querySuppressionEntriesLocal(filters = {}) {
  let results = SUPPRESSION_ENTRIES.slice();
  if (filters.reason) results = results.filter((s) => s.reason === filters.reason);
  return results;
}

export function isSuppressed(recordId) {
  return SUPPRESSION_ENTRIES.some((s) => s.contactId === recordId || s.leadId === recordId);
}

let suppressionSeq = SUPPRESSION_ENTRIES.length;
export function addSuppressionEntry(fields, actorName = "Preview User") {
  suppressionSeq += 1;
  const entry = createSuppressionEntry({ id: `sup_${suppressionSeq}`, addedBy: actorName, ...fields });
  SUPPRESSION_ENTRIES.unshift(entry);
  return { entry };
}

// High-risk: removal requires a non-empty reason. The caller (mockApi.js)
// is responsible for recording the resulting audit event, since this file
// must not import back from mockIntegrationsData.js (see header note).
export function removeSuppressionEntry(entryId, reason, actorName = "Preview User") {
  if (!reason?.trim()) return { error: "A written reason is required to remove a marketing suppression entry." };
  const idx = SUPPRESSION_ENTRIES.findIndex((s) => s.id === entryId);
  if (idx === -1) return { error: "Suppression entry not found." };
  const [removed] = SUPPRESSION_ENTRIES.splice(idx, 1);
  return { removed, actorName, reason };
}

// ---------------------------------------------------------------------------
// Audiences — eligibility rules only; membership is always computed live
// against real Contacts/Leads, never stored as a duplicate list.
// ---------------------------------------------------------------------------
export function createAudienceDefinition({
  id, organizationId, name, channel = "Email Marketing",
  requireConsent = true, excludeSuppressed = true,
  sourceFilter = null, campaignReference = null, linkedSegmentId = null,
}) {
  return { id, organizationId, name, channel, requireConsent, excludeSuppressed, sourceFilter, campaignReference, linkedSegmentId };
}

export const AUDIENCES = [
  createAudienceDefinition({ id: "aud_1", organizationId: ORG_HQ, name: "HQ Newsletter Subscribers", channel: "Email Marketing" }),
  createAudienceDefinition({ id: "aud_2", organizationId: ORG_HQ, name: "Advertisement-Sourced Leads", channel: "Advertising & Lead Generation", sourceFilter: "Advertisement" }),
  createAudienceDefinition({ id: "aud_3", organizationId: ORG_NIMBUS, name: "Nimbus Retail Prospects", channel: "Email Marketing" }),
];

export function findAudience(id) {
  return AUDIENCES.find((a) => a.id === id) || null;
}

export function queryAudiencesLocal(filters = {}) {
  let results = AUDIENCES.slice();
  if (filters.organizationId) results = results.filter((a) => a.organizationId === filters.organizationId);
  return results;
}

// Pure selector: filters real Contacts/Leads live, excludes suppressed and
// non-consented records BEFORE counting. Never returns a hardcoded count.
export function computeAudienceEligibility(audienceId) {
  const audience = findAudience(audienceId);
  if (!audience) return { error: "Audience not found." };
  const pool = [...contacts, ...leads].filter((r) => !r.archived);
  const eligible = [];
  const excluded = [];
  for (const record of pool) {
    if (audience.sourceFilter && record.source !== audience.sourceFilter) continue;
    if (audience.excludeSuppressed && isSuppressed(record._id)) {
      excluded.push({ recordId: record._id, reason: "Suppressed" });
      continue;
    }
    const hasConsent = record.marketingAllowed !== false && record.consent !== false && !record.doNotContact;
    if (audience.requireConsent && !hasConsent) {
      excluded.push({ recordId: record._id, reason: "Missing marketing consent" });
      continue;
    }
    eligible.push(record._id);
  }
  return { audience, eligible, excluded, totalConsidered: pool.length };
}

// ---------------------------------------------------------------------------
// Email Delivery — strict transactional-vs-marketing separation.
// ---------------------------------------------------------------------------
export function createEmailDeliveryEvent({
  id, orgId, providerKey, purpose, emailType, relatedRecordId = null,
  relatedRecordType = null, campaignReference = null,
  status = "Sent Preview", occurredAt = new Date().toISOString(),
}) {
  return { id, orgId, providerKey, purpose, emailType, relatedRecordId, relatedRecordType, campaignReference, status, occurredAt };
}

export const EMAIL_DELIVERY_EVENTS = [
  createEmailDeliveryEvent({ id: "eml_1", orgId: ORG_HQ, providerKey: "sendgrid", purpose: "transactional", emailType: "Organization Invitation", status: "Delivered", occurredAt: daysAgo(2) }),
  createEmailDeliveryEvent({ id: "eml_2", orgId: ORG_HQ, providerKey: "sendgrid", purpose: "transactional", emailType: "Quote Notification", relatedRecordType: "Quote", status: "Opened", occurredAt: daysAgo(1) }),
  createEmailDeliveryEvent({ id: "eml_3", orgId: ORG_HQ, providerKey: "mailchimp", purpose: "marketing", emailType: "Newsletter", campaignReference: "campref_1", status: "Delivered", occurredAt: daysAgo(4) }),
  createEmailDeliveryEvent({ id: "eml_4", orgId: ORG_HQ, providerKey: "mailchimp", purpose: "marketing", emailType: "Newsletter", campaignReference: "campref_1", status: "Bounced", occurredAt: daysAgo(4) }),
  createEmailDeliveryEvent({ id: "eml_5", orgId: ORG_NIMBUS, providerKey: "amazon_ses", purpose: "transactional", emailType: "Password Reset", status: "Failed", occurredAt: hoursAgo(6) }),
  createEmailDeliveryEvent({ id: "eml_6", orgId: ORG_NIMBUS, providerKey: "brevo", purpose: "marketing", emailType: "Promotional Campaign", status: "Suppressed", occurredAt: daysAgo(3) }),
];

export function findEmailDeliveryEvent(id) {
  return EMAIL_DELIVERY_EVENTS.find((e) => e.id === id) || null;
}

export function queryEmailDeliveryEventsLocal(filters = {}) {
  let results = EMAIL_DELIVERY_EVENTS.slice();
  if (filters.orgId) results = results.filter((e) => e.orgId === filters.orgId);
  if (filters.purpose) results = results.filter((e) => e.purpose === filters.purpose);
  if (filters.status) results = results.filter((e) => e.status === filters.status);
  return results.slice().sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
}

export function retryEmailDelivery(eventId, _actorName = "Preview User") {
  const event = findEmailDeliveryEvent(eventId);
  if (!event) return { error: "Email delivery event not found." };
  if (!["Failed", "Deferred", "Bounced"].includes(event.status)) return { error: "Only a Failed, Deferred or Bounced delivery preview can be retried." };
  event.status = "Sent Preview";
  event.occurredAt = new Date().toISOString();
  return { event };
}

// Pure, calculated — never a hardcoded total.
export function computeEmailDeliveryMetrics(events) {
  const total = events.length;
  const delivered = events.filter((e) => ["Delivered", "Opened", "Clicked"].includes(e.status)).length;
  const bounced = events.filter((e) => e.status === "Bounced").length;
  const failed = events.filter((e) => e.status === "Failed").length;
  const suppressed = events.filter((e) => e.status === "Suppressed").length;
  const transactional = events.filter((e) => e.purpose === "transactional").length;
  const marketing = events.filter((e) => e.purpose === "marketing").length;
  return {
    total, delivered, bounced, failed, suppressed, transactional, marketing,
    deliveryRate: total ? Math.round((delivered / total) * 100) : 0,
    bounceRate: total ? Math.round((bounced / total) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// Attribution — never invents revenue. Walks real Lead -> Deal relationships
// already in mockCrmData.js (Lead.convertedTo = {companyId, contactId,
// dealId}); ROI renders as an explicit "unavailable" string rather than a
// computed number whenever no verified spend fixture exists.
// ---------------------------------------------------------------------------
export function createAttributionTouchpoint({
  id, leadId, campaignReference, model = "Last Touch", utm = {}, occurredAt = new Date().toISOString(),
}) {
  return { id, leadId, campaignReference, model, utm, occurredAt };
}

export const ATTRIBUTION_TOUCHPOINTS = [
  createAttributionTouchpoint({ id: "attr_1", leadId: leads[0]?._id || null, campaignReference: "campref_2", model: "Last Touch", utm: { source: "facebook", medium: "paid_social", campaign: "demo_request" } }),
  createAttributionTouchpoint({ id: "attr_2", leadId: leads[1]?._id || null, campaignReference: "campref_3", model: "Last Touch", utm: { source: "google", medium: "cpc" } }),
];

export function queryAttributionLocal(filters = {}) {
  let results = ATTRIBUTION_TOUCHPOINTS.slice();
  if (filters.campaignReference) results = results.filter((t) => t.campaignReference === filters.campaignReference);
  return results;
}

// A campaign reference is only considered to have verified spend if this
// fixture map says so — deliberately sparse, so most campaigns correctly
// render "ROI unavailable" rather than a fabricated figure.
const VERIFIED_CAMPAIGN_SPEND = {
  campref_3: 4200,
};

export function computeAttributionSummary(filters = {}) {
  const touchpoints = queryAttributionLocal(filters);
  let attributedPipelineValue = 0;
  let attributedWonValue = 0;
  const attributedDeals = [];
  for (const touchpoint of touchpoints) {
    const lead = leads.find((l) => l._id === touchpoint.leadId);
    if (!lead?.convertedTo?.dealId) continue;
    const deal = deals.find((d) => d._id === lead.convertedTo.dealId);
    if (!deal) continue;
    attributedDeals.push(deal._id);
    attributedPipelineValue += deal.value || 0;
    if (deal.status === "Won") attributedWonValue += deal.value || 0;
  }
  const spend = filters.campaignReference ? VERIFIED_CAMPAIGN_SPEND[filters.campaignReference] : null;
  const roi = spend ? Math.round(((attributedWonValue - spend) / spend) * 100) : null;
  return {
    touchpoints, attributedDeals, attributedPipelineValue, attributedWonValue,
    roi: roi !== null ? `${roi}%` : ROI_UNAVAILABLE_MESSAGE,
    unmappedUtmCount: touchpoints.filter((t) => !t.utm?.source).length,
  };
}

// ---------------------------------------------------------------------------
// Overview metrics — Phase 4 addition. Same shape as Phase 3's
// computeSupportOverviewMetrics: receives `connections` as data (never
// imports mockIntegrationsData.js — see the file-header note on the
// circular-import hazard), computes everything live off the fixtures above,
// never a hardcoded count.
// ---------------------------------------------------------------------------
const PHASE2_PROVIDER_KEYS = new Set(PHASE2_PROVIDERS.map((p) => p.key));

export function computeSalesMarketingOverviewMetrics({ organizationId, connections = [] } = {}) {
  const orgCaptureEvents = organizationId ? LEAD_CAPTURE_EVENTS.filter((e) => e.orgId === organizationId) : LEAD_CAPTURE_EVENTS;
  const orgEmailEvents = organizationId ? EMAIL_DELIVERY_EVENTS.filter((e) => e.orgId === organizationId) : EMAIL_DELIVERY_EVENTS;
  const orgForms = organizationId ? FORM_CONNECTIONS.filter((f) => f.organizationId === organizationId) : FORM_CONNECTIONS;

  const previewConnectedMarketingProviders = connections.filter(
    (c) => PHASE2_PROVIDER_KEYS.has(c.providerKey) && c.status === "Preview Connected" && (!organizationId || c.organizationId === organizationId)
  ).length;

  const leadsNeedingReview = orgCaptureEvents.filter((e) => e.status === "Needs Review").length;
  const leadsReadyToCreate = orgCaptureEvents.filter((e) => e.status === "Ready to Create").length;
  // Suppression entries have no organizationId of their own (a suppressed
  // contact/lead is suppressed everywhere, not per-org), so this count is
  // deliberately org-wide regardless of the selected organization.
  const activeSuppressions = SUPPRESSION_ENTRIES.length;
  const failedOrBouncedDeliveries = orgEmailEvents.filter((e) => ["Failed", "Bounced"].includes(e.status)).length;
  const formsRequiringMapping = orgForms.filter((f) => {
    const mappedCrmFields = new Set(f.fieldMappings.map((m) => m.crmField));
    return !f.enabled && f.requiredCrmFields.some((field) => !mappedCrmFields.has(field));
  }).length;
  const attributedPipelineValue = computeAttributionSummary({}).attributedPipelineValue;

  return {
    previewConnectedMarketingProviders, leadsNeedingReview, leadsReadyToCreate,
    activeSuppressions, failedOrBouncedDeliveries, formsRequiringMapping, attributedPipelineValue,
  };
}

// ---------------------------------------------------------------------------
// Marketing consent — Phase 4 addition. A pure projection of the same
// consent-ish fields computeAudienceEligibility() already reads off real
// Contacts/Leads (marketingAllowed/consent/doNotContact) — never a second
// stored source of truth, exactly like Phase 3's
// deriveSupportCommunicationConsent().
// ---------------------------------------------------------------------------
// No organizationId parameter — Contacts/Leads aren't org-scoped fields in
// this fixture model (computeAudienceEligibility has the same shape), so a
// filter argument that did nothing would be misleading rather than helpful.
export function deriveMarketingConsentSummary() {
  const pool = [...contacts, ...leads].filter((r) => !r.archived);
  let consented = 0;
  let notConsented = 0;
  let doNotContact = 0;
  for (const record of pool) {
    if (record.doNotContact) { doNotContact += 1; continue; }
    const hasConsent = record.marketingAllowed !== false && record.consent !== false;
    if (hasConsent) consented += 1;
    else notConsented += 1;
  }
  return { totalConsidered: pool.length, consented, notConsented, doNotContact };
}
