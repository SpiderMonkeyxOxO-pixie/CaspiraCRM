// Centralized, typed configuration for the Import wizard — one definition
// per record type, reusing the exact field names, enums and required-field
// rules already used by the Leads/Contacts/Companies/Deals forms. Nothing
// here invents a different field name or validation rule.
import { LEAD_STATUSES } from "../../../redux/crm/leadsSlice";
import {
  LEAD_SOURCES, CONTACT_RELATIONSHIP_TYPES, CONTACT_LIFECYCLE_STAGES, CONTACT_SOURCES, CONTACT_LANGUAGES,
  COMPANY_ACCOUNT_TYPES, COMPANY_LIFECYCLE_STAGES, COMPANY_ACCOUNT_TIERS, COMPANY_SOURCES, COMPANY_SIZES,
} from "../../../Helpers/mockCrmData";
import { DEAL_PIPELINES, DEAL_STAGES, DEAL_SOURCES, DEAL_PRIORITIES, DEAL_CURRENCIES } from "../../../redux/crm/dealsSlice";

export const CURRENCIES = DEAL_CURRENCIES;

// "fname" and "first_name" and "First Name" all normalize the same way, so
// one alias entry covers every reasonable spelling of a header.
export function normalizeHeader(h) {
  return (h || "").toString().trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

const WIZARD_STEPS = ["Record Type", "Upload", "Mapping", "Validation", "Duplicates", "Review", "Results"];
export { WIZARD_STEPS };

function field(key, label, opts = {}) {
  return { key, label, required: false, type: "text", ...opts };
}

export const RECORD_TYPES = {
  leads: {
    id: "leads", label: "Leads",
    description: "For prospective customers who have not yet been qualified.",
    exampleUse: "A list exported from a trade-show scanner or a marketing form.",
    requiredFieldLabels: ["First or last name (or company name)", "Email or phone"],
    destinationFields: [
      field("firstName", "First Name"),
      field("lastName", "Last Name"),
      field("companyName", "Company Name"),
      field("email", "Email", { type: "email" }),
      field("phone", "Phone", { type: "phone" }),
      field("source", "Source", { type: "enum", enumValues: LEAD_SOURCES }),
      field("status", "Status", { type: "enum", enumValues: LEAD_STATUSES }),
      field("priority", "Priority", { type: "enum", enumValues: ["Low", "Medium", "High"] }),
      field("estimatedValue", "Estimated Value", { type: "number" }),
      field("currency", "Currency", { type: "enum", enumValues: CURRENCIES }),
      field("ownerId", "Owner", { type: "owner" }),
      field("nextFollowUp", "Next Follow-up", { type: "date" }),
      field("tags", "Tags", { type: "tags", multiValue: true }),
    ],
    templateColumns: [
      { key: "first_name", example: "Priya" }, { key: "last_name", example: "Anand" },
      { key: "company_name", example: "Brightloop Retail" }, { key: "email", example: "priya.anand@brightloop.example" },
      { key: "phone", example: "+1-555-0134" }, { key: "source", example: "Website" }, { key: "status", example: "New" },
      { key: "priority", example: "Medium" }, { key: "estimated_value", example: "5000" }, { key: "currency", example: "USD" },
      { key: "owner", example: "Priya Nair" }, { key: "next_follow_up", example: "2026-09-15" }, { key: "tags", example: "trade-show, warm" },
    ],
    headerAliases: {
      first_name: "firstName", fname: "firstName", given_name: "firstName",
      last_name: "lastName", surname: "lastName", family_name: "lastName",
      company_name: "companyName", company: "companyName", organization: "companyName",
      email: "email", email_address: "email",
      phone: "phone", mobile: "phone", phone_number: "phone",
      source: "source", lead_source: "source",
      status: "status", lead_status: "status",
      priority: "priority",
      estimated_value: "estimatedValue", deal_amount: "estimatedValue", value: "estimatedValue",
      currency: "currency",
      owner: "ownerId", assigned_to: "ownerId", owner_name: "ownerId",
      next_follow_up: "nextFollowUp", follow_up_date: "nextFollowUp", close_date: "nextFollowUp",
      tags: "tags",
    },
  },
  contacts: {
    id: "contacts", label: "Contacts",
    description: "For external customer or business contacts.",
    exampleUse: "A contact list exported from a partner's CRM or a spreadsheet of stakeholders.",
    requiredFieldLabels: ["First or last name", "Email or phone"],
    destinationFields: [
      field("firstName", "First Name"),
      field("lastName", "Last Name"),
      field("companyName", "Company", { description: "Matched against an existing Company by name, or left unlinked if not found." }),
      field("jobTitle", "Job Title"),
      field("email", "Email", { type: "email" }),
      field("phone", "Phone", { type: "phone" }),
      field("country", "Country"),
      field("preferredLanguage", "Language", { type: "enum", enumValues: CONTACT_LANGUAGES }),
      field("relationshipType", "Relationship Type", { type: "enum", enumValues: CONTACT_RELATIONSHIP_TYPES }),
      field("lifecycleStage", "Lifecycle Stage", { type: "enum", enumValues: CONTACT_LIFECYCLE_STAGES }),
      field("ownerId", "Owner", { type: "owner" }),
      field("source", "Source", { type: "enum", enumValues: CONTACT_SOURCES }),
      field("tags", "Tags", { type: "tags", multiValue: true }),
    ],
    templateColumns: [
      { key: "first_name", example: "Elena" }, { key: "last_name", example: "Marsh" }, { key: "company", example: "Brightloop Retail" },
      { key: "job_title", example: "VP of Operations" }, { key: "email", example: "elena.marsh@brightloop.example" },
      { key: "phone", example: "+1-555-0142" }, { key: "country", example: "United States" }, { key: "language", example: "English" },
      { key: "relationship_type", example: "Customer" }, { key: "lifecycle_stage", example: "Active" },
      { key: "owner", example: "Dominic Wuckert" }, { key: "source", example: "Referral" }, { key: "tags", example: "key-account" },
    ],
    headerAliases: {
      first_name: "firstName", fname: "firstName", last_name: "lastName", surname: "lastName",
      company: "companyName", company_name: "companyName", organization: "companyName",
      job_title: "jobTitle", title: "jobTitle", position: "jobTitle",
      email: "email", phone: "phone", mobile: "phone",
      country: "country", language: "preferredLanguage",
      relationship_type: "relationshipType", relationship: "relationshipType",
      lifecycle_stage: "lifecycleStage", stage: "lifecycleStage",
      owner: "ownerId", assigned_to: "ownerId",
      source: "source", tags: "tags",
    },
  },
  companies: {
    id: "companies", label: "Companies",
    description: "For customer, prospect, partner or vendor organizations.",
    exampleUse: "An account list exported from a spreadsheet of target accounts.",
    requiredFieldLabels: ["Company name"],
    destinationFields: [
      field("name", "Company Name", { required: true }),
      field("primaryDomain", "Domain"),
      field("website", "Website"),
      field("industry", "Industry"),
      field("companySize", "Company Size", { type: "enum", enumValues: COMPANY_SIZES }),
      field("accountType", "Account Type", { type: "enum", enumValues: COMPANY_ACCOUNT_TYPES }),
      field("lifecycleStage", "Lifecycle Stage", { type: "enum", enumValues: COMPANY_LIFECYCLE_STAGES }),
      field("accountTier", "Account Tier", { type: "enum", enumValues: COMPANY_ACCOUNT_TIERS }),
      field("ownerId", "Owner", { type: "owner" }),
      field("email", "Email", { type: "email" }),
      field("phone", "Phone", { type: "phone" }),
      field("country", "Country"),
      field("city", "City"),
      field("estimatedAnnualValue", "Est. Annual Value", { type: "number" }),
      field("currency", "Currency", { type: "enum", enumValues: CURRENCIES }),
      field("tags", "Tags", { type: "tags", multiValue: true }),
    ],
    templateColumns: [
      { key: "company_name", example: "Northline Prospecting Co" }, { key: "domain", example: "northline.example.com" },
      { key: "website", example: "https://www.northline.example.com" }, { key: "industry", example: "Technology" },
      { key: "company_size", example: "51-200" }, { key: "account_type", example: "Prospect" },
      { key: "lifecycle_stage", example: "New" }, { key: "account_tier", example: "Standard" },
      { key: "owner", example: "Marcus Chen" }, { key: "email", example: "info@northline.example.com" },
      { key: "phone", example: "+1-555-0110" }, { key: "country", example: "United States" }, { key: "city", example: "Austin" },
      { key: "estimated_annual_value", example: "48000" }, { key: "currency", example: "USD" }, { key: "tags", example: "strategic" },
    ],
    headerAliases: {
      company_name: "name", company: "name", organization: "name", name: "name",
      domain: "primaryDomain", primary_domain: "primaryDomain",
      website: "website", url: "website",
      industry: "industry", company_size: "companySize", size: "companySize",
      account_type: "accountType", type: "accountType",
      lifecycle_stage: "lifecycleStage", account_tier: "accountTier", tier: "accountTier",
      owner: "ownerId", assigned_to: "ownerId",
      email: "email", phone: "phone", country: "country", city: "city",
      estimated_annual_value: "estimatedAnnualValue", annual_value: "estimatedAnnualValue",
      currency: "currency", tags: "tags",
    },
  },
  deals: {
    id: "deals", label: "Deals",
    description: "For sales opportunities connected to Companies and Contacts.",
    exampleUse: "An opportunity export from a spreadsheet-based pipeline tracker.",
    requiredFieldLabels: ["Deal name", "Company (matched by name)"],
    destinationFields: [
      field("name", "Deal Name", { required: true }),
      field("companyName", "Company", { required: true, description: "Matched against an existing Company by name. The row is invalid if no match is found." }),
      field("primaryContactEmail", "Primary Contact Email", { type: "email", description: "Matched against an existing Contact by email, within the matched Company when possible." }),
      field("pipeline", "Pipeline", { type: "enum", enumValues: DEAL_PIPELINES }),
      field("stage", "Stage", { type: "enum", enumValues: DEAL_STAGES.filter((s) => s !== "Won") }),
      field("value", "Deal Value", { type: "number" }),
      field("currency", "Currency", { type: "enum", enumValues: CURRENCIES, required: true }),
      field("probability", "Probability", { type: "percent" }),
      field("expectedClosingDate", "Expected Closing Date", { type: "date" }),
      field("ownerId", "Owner", { type: "owner" }),
      field("source", "Source", { type: "enum", enumValues: DEAL_SOURCES }),
      field("priority", "Priority", { type: "enum", enumValues: DEAL_PRIORITIES }),
      field("nextAction", "Next Action"),
      field("tags", "Tags", { type: "tags", multiValue: true }),
    ],
    templateColumns: [
      { key: "deal_name", example: "Northline Prospecting Co — Initial Discovery" }, { key: "company", example: "Northline Prospecting Co" },
      { key: "primary_contact_email", example: "priya.anand@brightloop.example" }, { key: "pipeline", example: "New Business" },
      { key: "stage", example: "Discovery" }, { key: "value", example: "8000" }, { key: "currency", example: "USD" },
      { key: "probability", example: "10" }, { key: "expected_close_date", example: "2026-10-15" },
      { key: "owner", example: "Priya Nair" }, { key: "source", example: "Website" }, { key: "priority", example: "Medium" },
      { key: "next_action", example: "Schedule discovery call" }, { key: "tags", example: "inbound" },
    ],
    headerAliases: {
      deal_name: "name", name: "name", opportunity: "name",
      company: "companyName", company_name: "companyName", account: "companyName",
      primary_contact_email: "primaryContactEmail", contact_email: "primaryContactEmail", email: "primaryContactEmail",
      pipeline: "pipeline", stage: "stage",
      value: "value", deal_amount: "value", amount: "value",
      currency: "currency", probability: "probability", win_probability: "probability",
      expected_close_date: "expectedClosingDate", close_date: "expectedClosingDate", expected_closing_date: "expectedClosingDate",
      owner: "ownerId", assigned_to: "ownerId",
      source: "source", priority: "priority", next_action: "nextAction", tags: "tags",
    },
  },
};

export const RECORD_TYPE_ORDER = ["leads", "contacts", "companies", "deals"];

export function getRecordTypeConfig(type) {
  return RECORD_TYPES[type] || null;
}

// Automatic mapping based on normalized header names — the same alias table
// backs both this first-pass suggestion and the "Apply recommended mapping"
// action, so there's exactly one source of truth for what counts as a match.
export function autoMapHeaders(headers, config) {
  const mapping = {};
  const confidence = {};
  headers.forEach((h, i) => {
    const norm = normalizeHeader(h);
    if (config.headerAliases[norm]) {
      mapping[i] = config.headerAliases[norm];
      confidence[i] = "high";
    }
  });
  return { mapping, confidence };
}

// Frontend preview limits — communicated in the Upload step, not enforced
// as a real backend upload constraint.
export const IMPORT_LIMITS = {
  maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
  maxPreviewRows: 500,
  supportedExtensions: [".csv", ".xlsx", ".xls"],
};
