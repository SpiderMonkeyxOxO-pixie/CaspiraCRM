// In-memory mock CRM "database" for the frontend-only dev/preview build.
// Persists for the life of the browser tab (not across reloads) so CRUD
// through the UI behaves like a real backend during a session.
import { faker } from "@faker-js/faker";
import { CRM_TEAM, findTeamMember, CURRENT_MOCK_OWNER_ID } from "./mockUsersData";

export const normalizeEmail = (email) => (email || "").trim().toLowerCase();
export const normalizePhone = (phone) => (phone || "").replace(/[^\d]/g, "");

export const LEAD_SOURCES = ["Website", "Referral", "Cold Call", "Trade Show", "Social Media", "Advertisement"];
const DEPARTMENTS = ["Sales", "Support", "Marketing"];
const INDUSTRIES = ["Technology", "Finance", "Retail", "Healthcare", "Manufacturing", "Logistics"];

// Contacts are external people (customers, prospects, partners, vendors) —
// distinct from the internal CRM_TEAM roster and from the Employee
// Directory elsewhere in the app.
export const CONTACT_RELATIONSHIP_TYPES = ["Customer", "Prospect", "Former Customer", "Partner", "Vendor"];
export const CONTACT_LIFECYCLE_STAGES = ["New", "Engaged", "Active", "At Risk", "Churned"];
export const CONTACT_SOURCES = ["Website", "Referral", "Trade Show", "Cold Outreach", "Partner Referral", "Import", "Converted Lead"];
export const CONTACT_CHANNELS = ["Email", "Phone", "SMS"];
export const CONTACT_LANGUAGES = ["English", "Spanish", "French", "German", "Mandarin", "Arabic"];
export const CONTACT_DECISION_ROLES = ["Decision Maker", "Influencer", "Champion", "End User", "Gatekeeper", "Budget Holder"];
export const CONTACT_BUSINESS_DEPARTMENTS = ["Executive", "Operations", "Finance", "IT", "Sales", "Marketing", "Procurement", "HR"];
export const CONTACT_TIMEZONES = ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Singapore", "Asia/Dubai", "Australia/Sydney"];
// Reason required to flip a contact into a terminal/restricted state, same
// idea as Leads' REASON_REQUIRED_STATUSES.
export const CONTACT_REASON_REQUIRED_LIFECYCLE = ["Churned"];

// Companies are external organizations — one record per organization, with
// three distinct axes (account type / lifecycle stage / customer status)
// rather than separate Company/Account/Customer entities.
export const COMPANY_ACCOUNT_TYPES = ["Prospect", "Customer", "Partner", "Vendor", "Former Customer"];
export const COMPANY_LIFECYCLE_STAGES = ["New", "Qualified", "Onboarding", "Active", "Renewal Due", "Churned"];
export const COMPANY_CUSTOMER_STATUSES = ["Active", "Inactive"];
export const COMPANY_ACCOUNT_TIERS = ["Standard", "Silver", "Gold", "Platinum"];
export const COMPANY_ACCOUNT_HEALTH = ["Healthy", "Needs Attention", "At Risk", "Inactive"];
export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
export const COMPANY_SOURCES = ["Website", "Referral", "Trade Show", "Cold Outreach", "Partner Referral", "Converted Lead", "Import"];
export const COMPANY_REGIONS = ["North America", "EMEA", "APAC", "LATAM"];
export const COMPANY_TEAMS = ["Sales", "Support", "Marketing"];
export const COMPANY_REASON_REQUIRED_LIFECYCLE = ["Churned"];

// Deals are sales opportunities — one record per opportunity, referencing
// its Company and Contacts by ID only (never duplicating their name/fields
// on the deal itself; resolve those by ID at render time).
export const DEAL_STAGES = ["Discovery", "Qualified", "Proposal", "Negotiation", "Approval", "Won"];
// Alternative outcomes — not part of the ordinary open-stage sequence.
export const DEAL_OUTCOME_STAGES = ["Lost", "Cancelled", "On Hold"];
// Stage probabilities live in exactly one place so no component hard-codes
// them — configurable here rather than scattered across the UI.
export const DEAL_STAGE_PROBABILITY = { Discovery: 10, Qualified: 25, Proposal: 50, Negotiation: 70, Approval: 90, Won: 100 };
// Stage colors likewise live in one place — both the Deals table's stage
// badge and the Pipeline board's columns/cards read the same map, rather
// than each hard-coding its own palette.
export const DEAL_STAGE_COLORS = {
  Discovery: "#6b7280", Qualified: "#3b82f6", Proposal: "#6366f1", Negotiation: "#f59e0b",
  Approval: "#8b5cf6", Won: "#10b981", Lost: "#ef4444", Cancelled: "#6b7280", "On Hold": "#f97316",
};
export const DEAL_STATUSES = ["Open", "Won", "Lost", "Cancelled", "On Hold"];
// A pipeline is a named, configured sales process — Deals and Pipeline both
// read this single source of truth (id/name/description/currency/stages/
// order/probability/color/visibility) rather than hard-coding their own
// copies. All pipelines currently share the same stage set; a pipeline may
// still add its own optional per-stage WIP limits or warning rules.
export const PIPELINE_CONFIGS = [
  {
    id: "new-business", name: "New Business",
    description: "Net-new logos moving through the standard sales process.",
    currency: "USD", visible: true, warningRules: ["stale-activity", "no-next-action", "closing-overdue"],
  },
  {
    id: "renewals", name: "Renewals",
    description: "Existing customers renewing or expanding their contract.",
    currency: "USD", visible: true, warningRules: ["closing-overdue", "no-next-action"],
  },
  {
    id: "partnerships", name: "Partnerships",
    description: "Deals sourced through or involving a partner.",
    currency: "USD", visible: true, wipLimits: { Negotiation: 6 }, warningRules: ["stale-activity"],
  },
];
export const DEAL_PIPELINES = PIPELINE_CONFIGS.map((p) => p.name);
export function findPipelineConfig(idOrName) {
  return PIPELINE_CONFIGS.find((p) => p.id === idOrName || p.name === idOrName) || PIPELINE_CONFIGS[0];
}
export const DEAL_TYPES = ["New Business", "Renewal", "Upsell", "Cross-sell", "Expansion"];
export const DEAL_SOURCES = ["Website", "Referral", "Cold Outreach", "Trade Show", "Partner Referral", "Converted Lead", "Existing Customer", "Import"];
export const DEAL_CURRENCIES = ["USD", "EUR", "GBP"];
export const DEAL_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
export const DEAL_HEALTH_STATES = ["Healthy", "Needs Attention", "At Risk", "Stalled"];
export const DEAL_BILLING_FREQUENCIES = ["One-time", "Monthly", "Quarterly", "Annually"];
export const DEAL_LOSS_REASONS = ["Price", "Chose competitor", "No budget", "No decision", "Timing", "Requirements changed", "No response", "Duplicate opportunity", "Other"];
// A contact's role/influence/relationship *on this specific deal* — distinct
// from the Contact record's own company-level relationshipType/lifecycle.
export const DEAL_CONTACT_ROLES = CONTACT_DECISION_ROLES;
export const DEAL_CONTACT_INFLUENCE_LEVELS = ["Low", "Medium", "High"];
export const DEAL_CONTACT_RELATIONSHIPS = ["Champion", "Neutral", "Blocker", "Coach"];
// Fields recommended (never enforced) when moving into each stage — shown
// as frontend-only warnings. No backend stage enforcement in this phase.
export const DEAL_STAGE_RECOMMENDATIONS = {
  Qualified: ["Company", "Primary contact", "Estimated value", "Owner"],
  Proposal: ["At least one product or service", "Expected closing date", "Next action"],
  Negotiation: ["Proposal sent to the contact", "Decision-maker identified", "Known concerns documented"],
  Approval: ["Final value confirmed", "Commercial summary prepared", "Approver identified"],
};
export const DEAL_REASON_REQUIRED_STAGES = ["Lost", "Cancelled", "On Hold"];

const id = () => faker.database.mongodbObjectId();

function companyAuditEntry(action, actor, { field, before, after, reason } = {}) {
  return { _id: id(), action, actor: actor || "System", at: new Date().toISOString(), field: field || null, before: before ?? null, after: after ?? null, reason: reason || null };
}
function companyActivityEntry(type, actor, description, meta = {}) {
  return { _id: id(), type, actor: actor || "System", at: new Date().toISOString(), description, outcome: meta.outcome || null, relatedRecord: meta.relatedRecord || null, meta };
}

function deriveCompanyDomain(website) {
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function makeCompany(overrides = {}) {
  const name = overrides.name || faker.company.name();
  const website = overrides.website || `https://www.${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example.com`;
  const owner = findTeamMember(overrides.ownerId) || (overrides.ownerId === null ? null : faker.helpers.arrayElement(CRM_TEAM));
  const accountType = overrides.accountType || faker.helpers.arrayElement(COMPANY_ACCOUNT_TYPES);
  const createdAt = overrides.createdAt || faker.date.past({ years: 1 }).toISOString();

  return {
    _id: id(),
    name,
    website,
    primaryDomain: overrides.primaryDomain || deriveCompanyDomain(website),
    industry: overrides.industry || faker.helpers.arrayElement(INDUSTRIES),
    companySize: overrides.companySize || faker.helpers.arrayElement(COMPANY_SIZES),
    accountType,
    lifecycleStage: overrides.lifecycleStage || faker.helpers.arrayElement(COMPANY_LIFECYCLE_STAGES),
    customerStatus: overrides.customerStatus || (accountType === "Former Customer" ? "Inactive" : "Active"),
    accountTier: overrides.accountTier || faker.helpers.arrayElement(COMPANY_ACCOUNT_TIERS),
    accountHealth: overrides.accountHealth || faker.helpers.arrayElement(COMPANY_ACCOUNT_HEALTH),
    healthReason: overrides.healthReason || null,
    primaryContactId: overrides.primaryContactId || null,
    ownerId: owner?.id || null,
    ownerName: owner?.name || null,
    assignedTeam: overrides.assignedTeam || faker.helpers.arrayElement(COMPANY_TEAMS),
    email: overrides.email || `info@${overrides.primaryDomain || deriveCompanyDomain(website) || "example.com"}`,
    phone: overrides.phone || faker.phone.number(),
    country: overrides.country || faker.location.country(),
    region: overrides.region || faker.helpers.arrayElement(COMPANY_REGIONS),
    city: overrides.city || faker.location.city(),
    address: overrides.address || faker.location.streetAddress(),
    timezone: overrides.timezone || faker.helpers.arrayElement(CONTACT_TIMEZONES),
    preferredLanguage: overrides.preferredLanguage || "English",
    source: overrides.source || faker.helpers.arrayElement(COMPANY_SOURCES),
    tags: overrides.tags || [],
    estimatedAnnualValue: overrides.estimatedAnnualValue ?? faker.number.int({ min: 5000, max: 250000 }),
    currency: overrides.currency || "USD",
    renewalDate: overrides.renewalDate !== undefined ? overrides.renewalDate : null,
    nextFollowUp: overrides.nextFollowUp !== undefined ? overrides.nextFollowUp : null,
    notes: overrides.notes || "",
    activity: overrides.activity || [companyActivityEntry("created", overrides.createdBy || "System", "Company created")],
    tasks: overrides.tasks || [],
    files: overrides.files || [],
    auditLog: overrides.auditLog || [],
    archived: overrides.archived ?? false,
    archiveReason: overrides.archiveReason || null,
    archivedAt: overrides.archivedAt || null,
    createdAt,
    updatedAt: overrides.updatedAt || createdAt,
    createdBy: overrides.createdBy || "System",
    updatedBy: overrides.updatedBy || "System",
    ...overrides,
  };
}

function makeContact(companyId, companyName, rawOverrides = {}) {
  // Accept a plain { name } shape (used by the lead-conversion cascade)
  // alongside the richer { firstName, lastName } shape from the Contact form.
  const overrides = { ...rawOverrides };
  if (overrides.name && !overrides.firstName && !overrides.lastName) {
    const [first, ...rest] = overrides.name.trim().split(" ");
    overrides.firstName = first;
    overrides.lastName = rest.join(" ");
  }

  const firstName = overrides.firstName || faker.person.firstName();
  const lastName = overrides.lastName || faker.person.lastName();
  const name = `${firstName} ${lastName}`.trim();
  const owner = findTeamMember(overrides.ownerId) || faker.helpers.arrayElement(CRM_TEAM);
  const doNotContact = overrides.doNotContact ?? false;
  const createdAt = overrides.createdAt || faker.date.past({ years: 1 }).toISOString();

  return {
    _id: id(),
    firstName,
    lastName,
    name,
    jobTitle: overrides.jobTitle || faker.person.jobTitle(),
    businessDepartment: overrides.businessDepartment || faker.helpers.arrayElement(CONTACT_BUSINESS_DEPARTMENTS),
    decisionMakingRole: overrides.decisionMakingRole || faker.helpers.arrayElement(CONTACT_DECISION_ROLES),
    email: overrides.email || faker.internet.email({ firstName }),
    phone: overrides.phone || faker.phone.number(),
    companyId,
    companyName: companyName || "",
    country: overrides.country || faker.location.country(),
    timezone: overrides.timezone || faker.helpers.arrayElement(CONTACT_TIMEZONES),
    preferredLanguage: overrides.preferredLanguage || "English",
    preferredChannel: overrides.preferredChannel || faker.helpers.arrayElement(CONTACT_CHANNELS),
    relationshipType: overrides.relationshipType || faker.helpers.arrayElement(CONTACT_RELATIONSHIP_TYPES),
    lifecycleStage: overrides.lifecycleStage || faker.helpers.arrayElement(CONTACT_LIFECYCLE_STAGES),
    ownerId: owner.id,
    ownerName: owner.name,
    source: overrides.source || faker.helpers.arrayElement(CONTACT_SOURCES),
    tags: overrides.tags || [],
    nextFollowUp: overrides.nextFollowUp !== undefined ? overrides.nextFollowUp : null,
    emailAllowed: doNotContact ? false : overrides.emailAllowed ?? true,
    phoneAllowed: doNotContact ? false : overrides.phoneAllowed ?? true,
    smsAllowed: doNotContact ? false : overrides.smsAllowed ?? false,
    marketingAllowed: doNotContact ? false : overrides.marketingAllowed ?? true,
    doNotContact,
    doNotContactReason: overrides.doNotContactReason || null,
    // Legacy field the existing consent UI reads/writes — kept as an alias
    // of marketingAllowed so older code paths (mockApi's /consent endpoint)
    // keep working unmodified.
    marketingOptIn: overrides.marketingOptIn ?? (doNotContact ? false : overrides.marketingAllowed ?? true),
    consentHistory: overrides.consentHistory || [],
    notes: overrides.notes || "",
    activity: overrides.activity || [contactActivityEntry("created", overrides.createdBy || "System", "Contact created")],
    tasks: overrides.tasks || [],
    files: overrides.files || [],
    auditLog: overrides.auditLog || [],
    archived: overrides.archived ?? false,
    archiveReason: overrides.archiveReason || null,
    archivedAt: overrides.archivedAt || null,
    createdAt,
    updatedAt: overrides.updatedAt || createdAt,
    createdBy: overrides.createdBy || "System",
    updatedBy: overrides.updatedBy || "System",
    ...overrides,
  };
}

// Field-level audit entry — deliberately stores only primitive before/after
// values (never a live reference to the contact itself), which is what the
// Leads audit log got wrong initially: a shallow `{ ...lead }` snapshot kept
// a live reference to the lead's own auditLog array, and pushing the entry
// back into that array created a circular structure that only surfaced when
// something tried to serialize it. Field-level entries can't repeat that.
function contactAuditEntry(action, actor, { field, before, after, reason } = {}) {
  return { _id: id(), action, actor: actor || "System", at: new Date().toISOString(), field: field || null, before: before ?? null, after: after ?? null, reason: reason || null };
}

function contactActivityEntry(type, actor, description, meta = {}) {
  return { _id: id(), type, actor: actor || "System", at: new Date().toISOString(), description, outcome: meta.outcome || null, relatedRecord: meta.relatedRecord || null, meta };
}

function dealAuditEntry(action, actor, { field, before, after, reason } = {}) {
  return { _id: id(), action, actor: actor || "System", at: new Date().toISOString(), field: field || null, before: before ?? null, after: after ?? null, reason: reason || null };
}

// A deal's status is a coarse, filterable category derived from its stage —
// kept as its own stored field (rather than computed on every read) because
// Won/Lost/Cancelled/On Hold each carry their own reasons/dates that must
// persist regardless of how "stage" is labeled.
function deriveDealStatus(stage) {
  if (stage === "Won") return "Won";
  if (DEAL_OUTCOME_STAGES.includes(stage)) return stage;
  return "Open";
}

// Line items are the frontend-only "products and services" selector inside
// a deal — never a real Products backend. Totals are always recomputed from
// the line items, never hand-set, so they can't drift out of sync.
export function computeLineItemTotals(lineItems = []) {
  let subtotal = 0;
  let discountTotal = 0;
  let recurringValue = 0;
  for (const item of lineItems) {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;
    const discountPct = Number(item.discountPercent) || 0;
    const gross = qty * price;
    const discount = gross * (discountPct / 100);
    const lineTotal = gross - discount;
    subtotal += gross;
    discountTotal += discount;
    if (item.billingFrequency && item.billingFrequency !== "One-time") recurringValue += lineTotal;
  }
  return { subtotal, discountTotal, estimatedTotal: subtotal - discountTotal, recurringValue };
}

function computeLineItemLineTotal(item) {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.unitPrice) || 0;
  const discountPct = Number(item.discountPercent) || 0;
  const gross = qty * price;
  return gross - gross * (discountPct / 100);
}

function normalizeLineItems(lineItems = []) {
  return lineItems.map((item) => ({
    _id: item._id || id(),
    productId: item.productId || null,
    name: item.name || "",
    description: item.description || "",
    quantity: Number(item.quantity) || 1,
    unitPrice: Number(item.unitPrice) || 0,
    discountPercent: Number(item.discountPercent) || 0,
    billingFrequency: item.billingFrequency || "One-time",
    priceBookId: item.priceBookId || null,
    lineTotal: computeLineItemLineTotal(item),
  }));
}

// Weighted value is always Deal value × probability, computed here so it
// can never be hand-set out of sync with the two inputs it depends on.
function computeWeightedValue(value, probability) {
  return Math.round((Number(value) || 0) * ((Number(probability) || 0) / 100));
}

function makeDeal(rawOverrides = {}) {
  const overrides = { ...rawOverrides };
  const stage = overrides.stage || "Discovery";
  const status = overrides.status || deriveDealStatus(stage);
  const probability = overrides.probability ?? DEAL_STAGE_PROBABILITY[stage] ?? 10;
  const value = overrides.value ?? faker.number.int({ min: 1000, max: 120000 });
  const owner = overrides.ownerId === null ? null : (findTeamMember(overrides.ownerId) || faker.helpers.arrayElement(CRM_TEAM));
  const lineItems = normalizeLineItems(overrides.lineItems || []);
  const createdAt = overrides.createdAt || faker.date.past({ years: 1 }).toISOString();

  return {
    _id: id(),
    name: overrides.name || `${faker.commerce.productName()} Opportunity`,
    pipeline: overrides.pipeline || faker.helpers.arrayElement(DEAL_PIPELINES),
    stage,
    status,
    dealType: overrides.dealType || faker.helpers.arrayElement(DEAL_TYPES),
    source: overrides.source || faker.helpers.arrayElement(DEAL_SOURCES),
    companyId: overrides.companyId || null,
    primaryContactId: overrides.primaryContactId || null,
    additionalContactIds: overrides.additionalContactIds || [],
    contactRoles: overrides.contactRoles || [],
    ownerId: owner?.id || null,
    ownerName: owner?.name || null,
    assignedTeam: overrides.assignedTeam || owner?.department || null,
    currency: overrides.currency || "USD",
    value,
    probability,
    expectedClosingDate: overrides.expectedClosingDate !== undefined ? overrides.expectedClosingDate : faker.date.soon({ days: 60 }).toISOString(),
    actualClosingDate: overrides.actualClosingDate || null,
    billingFrequency: overrides.billingFrequency || "One-time",
    priority: overrides.priority || faker.helpers.arrayElement(DEAL_PRIORITIES),
    dealHealth: overrides.dealHealth || "Healthy",
    healthReason: overrides.healthReason || null,
    nextAction: overrides.nextAction || null,
    competitors: overrides.competitors || [],
    description: overrides.description || "",
    tags: overrides.tags || [],
    internalNote: overrides.internalNote || "",
    winReason: overrides.winReason || null,
    lossReason: overrides.lossReason || null,
    lossCompetitor: overrides.lossCompetitor || null,
    cancellationReason: overrides.cancellationReason || null,
    onHoldReason: overrides.onHoldReason || null,
    onHoldReviewDate: overrides.onHoldReviewDate || null,
    handoffOwnerId: overrides.handoffOwnerId || null,
    handoffOwnerName: overrides.handoffOwnerName || null,
    quotes: overrides.quotes || [],
    files: overrides.files || [],
    stageHistory: overrides.stageHistory || [{ _id: id(), from: null, to: stage, changedBy: overrides.createdBy || "System", at: createdAt, note: "Deal created" }],
    auditLog: overrides.auditLog || [],
    archived: overrides.archived ?? false,
    archiveReason: overrides.archiveReason || null,
    archivedAt: overrides.archivedAt || null,
    createdAt,
    updatedAt: overrides.updatedAt || createdAt,
    createdBy: overrides.createdBy || "System",
    updatedBy: overrides.updatedBy || "System",
    ...overrides,
    // Re-assert computed fields last so a stray overrides.weightedValue (or
    // stale lineItems) can never win against the values derived above.
    lineItems,
    weightedValue: computeWeightedValue(value, probability),
    expectedRecurringValue: computeLineItemTotals(lineItems).recurringValue,
  };
}


const activityEntry = (type, actor, description, meta = {}) => ({
  _id: id(),
  type,
  actor: actor || "System",
  at: new Date().toISOString(),
  description,
  meta,
});

const auditEntry = (action, actor, { before, after, reason } = {}) => ({
  _id: id(),
  action,
  actor: actor || "System",
  at: new Date().toISOString(),
  before,
  after,
  reason: reason || null,
});

function makeLead(rawOverrides = {}) {
  // Accept the legacy { name, company } shape (still used by the Marketing
  // lead-capture form) alongside the newer { firstName, lastName, companyName }.
  const overrides = { ...rawOverrides };
  if (overrides.name && !overrides.firstName && !overrides.lastName) {
    const [first, ...rest] = overrides.name.trim().split(" ");
    overrides.firstName = first;
    overrides.lastName = rest.join(" ");
  }
  if (overrides.company && !overrides.companyName) {
    overrides.companyName = overrides.company;
  }

  const firstName = overrides.firstName || faker.person.firstName();
  const lastName = overrides.lastName || faker.person.lastName();
  const name = `${firstName} ${lastName}`.trim();
  const owner = faker.helpers.arrayElement(CRM_TEAM);
  const createdAt = faker.date.past({ years: 1 }).toISOString();
  return {
    _id: id(),
    firstName,
    lastName,
    name,
    jobTitle: faker.person.jobTitle(),
    email: faker.internet.email({ firstName }),
    phone: faker.phone.number(),
    companyName: faker.company.name(),
    country: faker.location.country(),
    preferredContactChannel: faker.helpers.arrayElement(["Email", "Phone", "SMS"]),
    source: faker.helpers.arrayElement(LEAD_SOURCES),
    // Sales & Marketing Integrations (Phase 2): records the original
    // provider source on the Lead itself, using this shared source model —
    // null for organically-created Leads, populated only when a Lead
    // originates from a Lead Capture preview event (see
    // mockSalesMarketingData.js's createLeadFromCapture).
    sourceProviderKey: overrides.sourceProviderKey || null,
    sourceExternalReference: overrides.sourceExternalReference || null,
    interestedProduct: faker.commerce.department(),
    department: owner.department,
    ownerId: owner.id,
    ownerName: owner.name,
    priority: faker.helpers.arrayElement(["Low", "Medium", "High"]),
    score: faker.number.int({ min: 0, max: 100 }),
    estimatedValue: faker.number.int({ min: 500, max: 50000 }),
    currency: "USD",
    tags: [],
    consent: true,
    nextFollowUp: faker.date.soon({ days: 14 }).toISOString(),
    status: faker.helpers.arrayElement(["New", "Attempted", "Contacted", "Qualified"]),
    notes: "",
    disqualifyReason: null,
    archived: false,
    archiveReason: null,
    archivedAt: null,
    convertedTo: null,
    activity: [activityEntry("created", "System", "Lead created")],
    tasks: [],
    files: [],
    auditLog: [],
    createdBy: "System",
    createdAt,
    updatedAt: createdAt,
    updatedBy: "System",
    ...overrides,
  };
}

const daysAgoC = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const daysFromNowC = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

// Curated, named company scenarios the Companies UI is designed and tested
// against — every state the interface needs to demonstrate gets a real,
// findable record instead of hoping a random faker roll produces one.
const COMPANY_FIXTURES = [
  () => makeCompany({
    name: "Northline Prospecting Co", accountType: "Prospect", lifecycleStage: "New",
    accountHealth: "Healthy", source: "Website",
  }),
  () => makeCompany({
    name: "Fenwick Qualified Partners", accountType: "Prospect", lifecycleStage: "Qualified",
    accountHealth: "Healthy", source: "Referral",
  }),
  () => makeCompany({
    name: "Ebertline Active Customer Inc", accountType: "Customer", lifecycleStage: "Active",
    customerStatus: "Active", accountHealth: "Healthy", accountTier: "Silver",
  }),
  () => makeCompany({
    name: "Meridian High-Value Holdings", accountType: "Customer", lifecycleStage: "Active",
    customerStatus: "Active", accountHealth: "Healthy", accountTier: "Platinum",
    estimatedAnnualValue: 480000, tags: ["strategic"],
  }),
  () => makeCompany({
    name: "Castborne At-Risk Group", accountType: "Customer", lifecycleStage: "Active",
    customerStatus: "Active", accountHealth: "At Risk", healthReason: "Multiple overdue support tickets",
  }),
  () => makeCompany({
    name: "Alliance Partner Network", accountType: "Partner", lifecycleStage: "Active",
    customerStatus: "Active", accountHealth: "Healthy",
  }),
  () => makeCompany({
    name: "Vendorsupply Systems Ltd", accountType: "Vendor", lifecycleStage: "Active",
    customerStatus: "Active", accountHealth: "Healthy",
  }),
  () => makeCompany({
    name: "Halloway Former Customer LLC", accountType: "Former Customer", lifecycleStage: "Churned",
    customerStatus: "Inactive", accountHealth: "Inactive", healthReason: "No activity for 90+ days",
  }),
  () => makeCompany({
    name: "Draymore Overdue Followup Co", accountType: "Customer", lifecycleStage: "Active",
    customerStatus: "Active", accountHealth: "Needs Attention", healthReason: "Renewal approaching",
    nextFollowUp: daysAgoC(5), renewalDate: daysFromNowC(20),
  }),
  () => makeCompany({
    name: "Unassigned Accounts Trading", accountType: "Prospect", lifecycleStage: "New",
    ownerId: null, accountHealth: "Needs Attention", healthReason: "No activity for 30 days",
  }),
  () => makeCompany({
    name: "Several Contacts Manufacturing", accountType: "Customer", lifecycleStage: "Active",
    customerStatus: "Active", accountHealth: "Healthy",
  }),
  () => makeCompany({
    name: "Activedeal Ventures Group", accountType: "Customer", lifecycleStage: "Active",
    customerStatus: "Active", accountHealth: "Healthy",
  }),
  () => makeCompany({
    name: "Opentickets Support Holdings", accountType: "Customer", lifecycleStage: "Active",
    customerStatus: "Active", accountHealth: "At Risk", healthReason: "Multiple overdue tickets",
  }),
  () => makeCompany({
    name: "Unpaid Invoices Retail Co", accountType: "Customer", lifecycleStage: "Active",
    customerStatus: "Active", accountHealth: "At Risk", healthReason: "Outstanding invoice",
  }),
  () => makeCompany({
    name: "Retired Systems Archive Corp", accountType: "Former Customer", lifecycleStage: "Churned",
    customerStatus: "Inactive", accountHealth: "Inactive",
    archived: true, archiveReason: "Contract ended, no renewal", archivedAt: daysAgoC(45),
  }),
];

export const companies = [
  ...COMPANY_FIXTURES.map((build) => build()),
  ...faker.helpers.multiple(() => makeCompany(), { count: 8 }),
];

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

// Curated, named scenarios the Contacts UI is designed and tested against —
// every state the interface needs to demonstrate gets a real, findable
// record instead of hoping a random faker roll produces one.
const CONTACT_FIXTURES = [
  (c) => makeContact(c._id, c.name, {
    firstName: "Elena", lastName: "Marsh", email: "elena.marsh@brightloop.example",
    relationshipType: "Customer", lifecycleStage: "Active", jobTitle: "VP of Operations",
    tags: ["key-account"],
  }),
  (c) => makeContact(c._id, c.name, {
    firstName: "Tomas", lastName: "Reyes", email: "tomas.reyes@fernwood.example",
    relationshipType: "Prospect", lifecycleStage: "Engaged", jobTitle: "Procurement Lead",
  }),
  (c) => makeContact(c._id, c.name, {
    firstName: "Naomi", lastName: "Ueda", email: "naomi.ueda@former.example",
    relationshipType: "Former Customer", lifecycleStage: "Churned", jobTitle: "Former IT Director",
    archiveReason: null,
  }),
  (c) => makeContact(c._id, c.name, {
    firstName: "Baxter", lastName: "Odom", email: "baxter.odom@alliancepartners.example",
    relationshipType: "Partner", lifecycleStage: "Active", jobTitle: "Partnerships Director",
    decisionMakingRole: "Champion",
  }),
  (c) => makeContact(c._id, c.name, {
    firstName: "Priya", lastName: "Chandra", email: "priya.chandra@vendorsupply.example",
    relationshipType: "Vendor", lifecycleStage: "Active", jobTitle: "Account Manager",
  }),
  (c) => makeContact(c._id, c.name, {
    firstName: "Marcus", lastName: "Feld", email: "marcus.feld@overdue.example",
    relationshipType: "Customer", lifecycleStage: "At Risk", jobTitle: "Operations Manager",
    nextFollowUp: daysAgo(6),
  }),
  (c) => makeContact(c._id, c.name, {
    firstName: "Ingrid", lastName: "Solberg", email: "ingrid.solberg@donotcontact.example",
    relationshipType: "Prospect", lifecycleStage: "At Risk", jobTitle: "Compliance Officer",
    doNotContact: true, doNotContactReason: "Requested no further contact on 2026-06-01",
  }),
  (c) => makeContact(c._id, c.name, {
    firstName: "Devon", lastName: "Lachance", email: "devon.lachance@independent.example",
    relationshipType: "Prospect", lifecycleStage: "New", jobTitle: "Independent Consultant",
  }),
  (c) => makeContact(c._id, c.name, {
    firstName: "Renata", lastName: "Silva", email: "renata.silva@activehistory.example",
    relationshipType: "Customer", lifecycleStage: "Active", jobTitle: "Head of Product",
    tags: ["key-account", "renewal-2026"],
    nextFollowUp: daysFromNow(4),
    activity: [
      contactActivityEntry("created", "System", "Contact created"),
      contactActivityEntry("call", "Priya Nair", "Discovery call to scope Q3 renewal", { outcome: "Positive", relatedRecord: null }),
      contactActivityEntry("email", "Priya Nair", "Sent renewal proposal follow-up", { outcome: "Awaiting reply" }),
      contactActivityEntry("meeting", "Dominic Wuckert", "Quarterly business review", { outcome: "Completed" }),
      contactActivityEntry("lifecycle_changed", "System", "Lifecycle changed from Engaged to Active", { from: "Engaged", to: "Active" }),
      contactActivityEntry("note", "Priya Nair", "Prefers async updates over calls when possible"),
    ],
  }),
  (c) => makeContact(c._id, c.name, {
    firstName: "Walter", lastName: "Higgins", email: "walter.higgins@archived.example",
    relationshipType: "Former Customer", lifecycleStage: "Churned", jobTitle: "Former Ops Lead",
    archived: true, archiveReason: "Account closed after contract non-renewal", archivedAt: daysAgo(30),
  }),
];

export const contacts = [
  // "Contact without a company" — the one fixture with no company link.
  makeContact(null, "", {
    firstName: "Sasha", lastName: "Quinn", email: "sasha.quinn@independent.example",
    relationshipType: "Vendor", lifecycleStage: "New", jobTitle: "Freelance Consultant",
  }),
  ...CONTACT_FIXTURES.map((build, i) => build(companies[i % companies.length])),
  ...companies.flatMap((c) =>
    faker.helpers.multiple(() => makeContact(c._id, c.name), { count: faker.number.int({ min: 1, max: 2 }) })
  ),
];

// Guarantee the "several contacts" company fixture actually has several,
// and that a handful of named companies have a resolvable primary contact —
// both properties the UI needs to demonstrate but that plain per-company
// random counts (1-2) can't reliably provide.
{
  const severalContactsCo = companies.find((c) => c.name === "Several Contacts Manufacturing");
  if (severalContactsCo) {
    const extra = faker.helpers.multiple(() => makeContact(severalContactsCo._id, severalContactsCo.name), { count: 4 });
    contacts.push(...extra);
  }
  for (const co of companies) {
    if (co.primaryContactId) continue;
    const first = contacts.find((ct) => ct.companyId === co._id);
    if (first) co.primaryContactId = first._id;
  }
}

const daysAgoD = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const daysFromNowD = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
function thisMonthDate(day) {
  const d = new Date();
  d.setDate(Math.min(day, 27));
  return d.toISOString();
}
function companyByName(name) {
  return companies.find((c) => c.name === name) || companies[0];
}
function contactsForCompany(companyId) {
  return contacts.filter((c) => c.companyId === companyId);
}
function firstContactFor(companyId) {
  return contactsForCompany(companyId)[0] || contacts[0];
}

// Curated, named deal scenarios the Deals UI is designed and tested
// against — every stage/outcome/health state the interface needs to
// demonstrate gets a real, findable record instead of hoping a random
// faker roll produces one. Every deal resolves its Company/Contact by ID
// only — no duplicated name/company data lives on the deal itself.
const DEAL_FIXTURES = [
  // 1. New discovery deal
  () => {
    const co = companyByName("Northline Prospecting Co");
    return makeDeal({
      name: `${co.name} — Initial Discovery`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "New Business", stage: "Discovery", dealType: "New Business", source: "Website",
      value: 8000, ownerId: "u2", priority: "Medium", dealHealth: "Healthy",
      nextAction: "Schedule discovery call", description: "Early-stage opportunity surfaced from an inbound website form.",
    });
  },
  // 2. Qualified opportunity
  () => {
    const co = companyByName("Fenwick Qualified Partners");
    return makeDeal({
      name: `${co.name} — Platform Rollout`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "New Business", stage: "Qualified", dealType: "New Business", source: "Referral",
      value: 24000, ownerId: "u3", priority: "Medium", dealHealth: "Healthy",
      nextAction: "Send capability deck", description: "Confirmed budget and timeline in the qualification call.",
    });
  },
  // 3. Proposal sent
  () => {
    const co = companyByName("Ebertline Active Customer Inc");
    return makeDeal({
      name: `${co.name} — Expansion Proposal`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "Renewals", stage: "Proposal", dealType: "Expansion", source: "Existing Customer",
      value: 36000, ownerId: "u1", priority: "High", dealHealth: "Healthy",
      lineItems: [{ name: "Professional Plan — 50 seats", quantity: 50, unitPrice: 60, billingFrequency: "Annually" }],
      nextAction: "Follow up on proposal", description: "Proposal sent for a 50-seat expansion.",
    });
  },
  // 4. Negotiation
  () => {
    const co = companyByName("Alliance Partner Network");
    return makeDeal({
      name: `${co.name} — Partner Agreement`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "Partnerships", stage: "Negotiation", dealType: "New Business", source: "Partner Referral",
      value: 58000, ownerId: "u1", priority: "High", dealHealth: "Needs Attention",
      healthReason: "Contract terms are under legal review",
      nextAction: "Review redlined contract", description: "Final terms under negotiation with procurement.",
    });
  },
  // 5. Waiting for approval
  () => {
    const co = companyByName("Vendorsupply Systems Ltd");
    return makeDeal({
      name: `${co.name} — Annual Renewal Upsell`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "Renewals", stage: "Approval", dealType: "Upsell", source: "Existing Customer",
      value: 41000, ownerId: "u4", priority: "High", dealHealth: "Healthy",
      nextAction: "Confirm internal sign-off", description: "Awaiting the customer's internal budget approval.",
    });
  },
  // 6. High-value opportunity
  () => {
    const co = companyByName("Meridian High-Value Holdings");
    return makeDeal({
      name: `${co.name} — Enterprise Platform Deal`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "New Business", stage: "Negotiation", dealType: "New Business", source: "Referral",
      value: 450000, ownerId: "u1", priority: "Urgent", dealHealth: "Healthy", tags: ["strategic"],
      lineItems: [
        { name: "Enterprise Platform License", quantity: 1, unitPrice: 360000, billingFrequency: "Annually" },
        { name: "Implementation Services", quantity: 1, unitPrice: 90000, billingFrequency: "One-time" },
      ],
      nextAction: "Executive alignment call", description: "Strategic, high-value enterprise opportunity.",
    });
  },
  // 7. At-risk opportunity
  () => {
    const co = companyByName("Castborne At-Risk Group");
    return makeDeal({
      name: `${co.name} — Support Escalation Deal`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "Renewals", stage: "Proposal", dealType: "Expansion", source: "Existing Customer",
      value: 22000, ownerId: "u3", priority: "High", dealHealth: "At Risk",
      healthReason: "Multiple open support tickets are stalling the buying committee",
      nextAction: "Resolve open tickets before resuming", description: "At risk due to unresolved support issues.",
    });
  },
  // 8. Stale opportunity
  () => {
    const co = companyByName("Draymore Overdue Followup Co");
    return makeDeal({
      name: `${co.name} — Stalled Pilot Deal`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "New Business", stage: "Proposal", dealType: "New Business", source: "Trade Show",
      value: 15000, ownerId: "u2", priority: "Low", dealHealth: "Stalled",
      healthReason: "No activity logged in over 45 days", createdAt: daysAgoD(90),
      nextAction: null, description: "Pilot proposal sent, but the deal has gone quiet.",
    });
  },
  // 9. Closing this month
  () => {
    const co = companyByName("Opentickets Support Holdings");
    return makeDeal({
      name: `${co.name} — Q3 Close`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "New Business", stage: "Negotiation", dealType: "New Business", source: "Website",
      value: 30000, ownerId: "u4", priority: "High", dealHealth: "Healthy",
      expectedClosingDate: thisMonthDate(25),
      nextAction: "Finalize signature", description: "On track to close before month end.",
    });
  },
  // 10. Won deal
  () => {
    const co = companyByName("Ebertline Active Customer Inc");
    return makeDeal({
      name: `${co.name} — Won Renewal`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "Renewals", stage: "Won", status: "Won", dealType: "Renewal", source: "Existing Customer",
      value: 28000, probability: 100, ownerId: "u1", priority: "Medium", dealHealth: "Healthy",
      winReason: "Strong product fit and executive sponsorship", actualClosingDate: daysAgoD(10),
      handoffOwnerId: "u5", handoffOwnerName: findTeamMember("u5")?.name || null,
      nextAction: null, description: "Closed-won renewal, handed off to Support for onboarding.",
    });
  },
  // 11. Lost deal
  () => {
    const co = companyByName("Halloway Former Customer LLC");
    return makeDeal({
      name: `${co.name} — Lost to Competitor`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "New Business", stage: "Lost", status: "Lost", dealType: "New Business", source: "Cold Outreach",
      value: 19000, probability: 0, ownerId: "u3", priority: "Medium", dealHealth: "Healthy",
      lossReason: "Chose competitor", lossCompetitor: "Northwind Suite", actualClosingDate: daysAgoD(20),
      nextAction: null, description: "Lost after a competing vendor offered a bundled discount.",
    });
  },
  // 12. Cancelled deal
  () => {
    const co = companyByName("Retired Systems Archive Corp");
    return makeDeal({
      name: `${co.name} — Cancelled Migration`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "New Business", stage: "Cancelled", status: "Cancelled", dealType: "New Business", source: "Referral",
      value: 12000, probability: 0, ownerId: "u4", priority: "Low", dealHealth: "Healthy",
      cancellationReason: "Customer paused all vendor evaluations for the fiscal year", actualClosingDate: daysAgoD(35),
      nextAction: null, description: "Cancelled before a decision was reached.",
    });
  },
  // 13. On-hold deal
  () => {
    const co = companyByName("Unassigned Accounts Trading");
    return makeDeal({
      name: `${co.name} — On Hold Pending Budget`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "New Business", stage: "On Hold", status: "On Hold", dealType: "New Business", source: "Website",
      value: 17000, ownerId: "u2", priority: "Medium", dealHealth: "Needs Attention",
      onHoldReason: "Customer's budget was frozen until the new fiscal year", onHoldReviewDate: daysFromNowD(45),
      healthReason: "On hold pending customer budget approval",
      nextAction: "Check back after fiscal year starts", description: "Paused at the customer's request.",
    });
  },
  // 14. Unassigned deal
  () => {
    const co = companyByName("Vendorsupply Systems Ltd");
    return makeDeal({
      name: `${co.name} — Unassigned Lead-in`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "New Business", stage: "Discovery", dealType: "New Business", source: "Website",
      value: 9000, ownerId: null, priority: "Low", dealHealth: "Needs Attention",
      healthReason: "No owner assigned", nextAction: "Assign an owner", description: "Awaiting assignment to a rep.",
    });
  },
  // 15. Deal with multiple contacts
  () => {
    const co = companyByName("Several Contacts Manufacturing");
    const coContacts = contactsForCompany(co._id);
    const [primary, ...rest] = coContacts;
    const additional = rest.slice(0, 2);
    const roster = [primary, ...additional].filter(Boolean);
    return makeDeal({
      name: `${co.name} — Multi-Stakeholder Deal`, companyId: co._id, primaryContactId: primary?._id || null,
      additionalContactIds: additional.map((c) => c._id),
      contactRoles: roster.map((c, i) => ({
        contactId: c._id, role: i === 0 ? "Decision Maker" : i === 1 ? "Influencer" : "End User",
        influenceLevel: i === 0 ? "High" : "Medium", relationship: i === 0 ? "Champion" : "Neutral",
      })),
      pipeline: "New Business", stage: "Proposal", dealType: "New Business", source: "Referral",
      value: 33000, ownerId: "u1", priority: "Medium", dealHealth: "Healthy",
      nextAction: "Align stakeholders on rollout plan", description: "Buying committee spans multiple departments.",
    });
  },
  // 16. Deal with products or services
  () => {
    const co = companyByName("Alliance Partner Network");
    return makeDeal({
      name: `${co.name} — Bundled Services Deal`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "Partnerships", stage: "Proposal", dealType: "New Business", source: "Partner Referral",
      value: 27600, ownerId: "u2", priority: "Medium", dealHealth: "Healthy",
      lineItems: [
        { name: "Core Platform License", quantity: 20, unitPrice: 90, discountPercent: 10, billingFrequency: "Monthly" },
        { name: "Onboarding Package", quantity: 1, unitPrice: 4800, billingFrequency: "One-time" },
        { name: "Premium Support", quantity: 1, unitPrice: 3600, billingFrequency: "Annually" },
      ],
      nextAction: "Review itemized pricing with buyer", description: "Multi-line proposal covering platform, onboarding and support.",
    });
  },
  // 17. Deal with activities — findable by name from mockActivitiesData.js,
  // which attaches a handful of calls/meetings/tasks to it.
  () => {
    const co = companyByName("Several Contacts Manufacturing");
    return makeDeal({
      name: "Several Contacts Manufacturing — Activity-Rich Expansion", companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "Renewals", stage: "Negotiation", dealType: "Expansion", source: "Existing Customer",
      value: 52000, ownerId: "u2", priority: "High", dealHealth: "Healthy",
      nextAction: "Review call notes before next call", description: "Actively worked deal with a full activity history.",
    });
  },
  // 18. Deal with a draft quote (a lightweight fixture preview — not a real
  // linked record in the separate, not-yet-finalized Quotes system).
  () => {
    const co = companyByName("Meridian High-Value Holdings");
    return makeDeal({
      name: `${co.name} — Renewal With Draft Quote`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "Renewals", stage: "Proposal", dealType: "Renewal", source: "Existing Customer",
      value: 61000, ownerId: "u1", priority: "High", dealHealth: "Healthy",
      quotes: [{ _id: id(), quoteNumber: "Q-DRAFT-1001", version: 1, amount: 61000, status: "Draft", createdAt: daysAgoD(3), expirationDate: daysFromNowD(27) }],
      nextAction: "Finalize quote before sending", description: "Renewal quote drafted, not yet sent.",
    });
  },
  // 19. Deal without a next action
  () => {
    const co = companyByName("Unpaid Invoices Retail Co");
    return makeDeal({
      name: `${co.name} — Needs a Next Step`, companyId: co._id, primaryContactId: firstContactFor(co._id)?._id || null,
      pipeline: "New Business", stage: "Qualified", dealType: "New Business", source: "Website",
      value: 14000, ownerId: "u3", priority: "Medium", dealHealth: "Needs Attention",
      healthReason: "No next action has been set", nextAction: null, description: "Qualified but nobody has set what happens next.",
    });
  },
];

export const deals = [
  ...DEAL_FIXTURES.map((build) => build()),
  ...faker.helpers.multiple(() => {
    const co = faker.helpers.arrayElement(companies);
    const contact = firstContactFor(co._id);
    return makeDeal({ companyId: co._id, primaryContactId: contact?._id || null });
  }, { count: 10 }),
];

// Guarantee the "active deals" company fixture keeps at least one deal —
// several other pages (Companies list, CRM dashboard) demonstrate their
// "open deals" state against this specific company.
{
  const dealCo = companies.find((c) => c.name === "Activedeal Ventures Group");
  const dealCoContact = dealCo && firstContactFor(dealCo._id);
  if (dealCo && dealCoContact) {
    deals.unshift(makeDeal({
      name: `${dealCo.name} — Expansion Deal`, companyId: dealCo._id, primaryContactId: dealCoContact._id,
      stage: "Proposal", value: 68000, ownerId: "u3",
    }));
  }
}

export const leads = faker.helpers.multiple(() => makeLead(), { count: 15 });

// ---------------------------------------------------------------------------
// Duplicate-management fixtures — curated, intentionally duplicate-shaped
// records APPENDED onto the arrays above (never inserted/reordered, so
// nothing above this point is disturbed). /crm/duplicates scans and
// compares against these exact same shared arrays — never a separate,
// duplicates-only dataset. Every scenario named in the /crm/duplicates spec
// gets one real, findable pair/group here.
// ---------------------------------------------------------------------------

// 1. Two Leads with the same email (High confidence: exact email match).
const DUPLICATE_LEAD_EMAIL = "jordan.baxter@meridiansupply.example";
export const DUPLICATE_LEAD_A = makeLead({
  firstName: "Jordan", lastName: "Baxter", companyName: "Meridian Supply Co",
  email: DUPLICATE_LEAD_EMAIL, phone: "+1-555-0188", source: "Website", status: "New",
});
export const DUPLICATE_LEAD_B = makeLead({
  firstName: "Jordan", lastName: "Baxter", companyName: "Meridian Supply Co.",
  email: DUPLICATE_LEAD_EMAIL.toUpperCase(), phone: "+1-555-0189", source: "Trade Show", status: "Contacted",
});
leads.push(DUPLICATE_LEAD_A, DUPLICATE_LEAD_B);

// 2. A Lead matching an existing Contact (Elena Marsh, a named Contact
// fixture above) by email — the "should this become a Contact?" scenario.
export const DUPLICATE_LEAD_MATCHING_CONTACT = makeLead({
  firstName: "Elena", lastName: "Marsh", companyName: "Northline Prospecting Co",
  email: "elena.marsh@brightloop.example", phone: "+1-555-0142", source: "Referral", status: "Qualified",
});
leads.push(DUPLICATE_LEAD_MATCHING_CONTACT);

// 3. A previously-Converted Lead whose conversion target Contact/Company/
// Deal ALSO independently look like a duplicate — the "don't treat a
// converted Lead as two ordinary Contacts" safety rule needs a Lead that is
// already resolved this way, with `convertedTo` pointing at real fixtures.
export const CONVERTED_LEAD_TARGET_COMPANY = makeCompany({
  name: "Fernridge Analytics Group", accountType: "Customer", lifecycleStage: "Active", customerStatus: "Active",
});
companies.push(CONVERTED_LEAD_TARGET_COMPANY);
export const CONVERTED_LEAD_TARGET_CONTACT = makeContact(CONVERTED_LEAD_TARGET_COMPANY._id, CONVERTED_LEAD_TARGET_COMPANY.name, {
  firstName: "Priyanka", lastName: "Desai", email: "priyanka.desai@fernridge.example", phone: "+1-555-0177",
  relationshipType: "Customer", lifecycleStage: "Active",
});
contacts.push(CONVERTED_LEAD_TARGET_CONTACT);
export const CONVERTED_LEAD_TARGET_DEAL = makeDeal({
  name: `${CONVERTED_LEAD_TARGET_COMPANY.name} — Converted Opportunity`, companyId: CONVERTED_LEAD_TARGET_COMPANY._id,
  primaryContactId: CONVERTED_LEAD_TARGET_CONTACT._id, stage: "Discovery",
});
deals.push(CONVERTED_LEAD_TARGET_DEAL);
export const CONVERTED_DUPLICATE_LEAD = makeLead({
  firstName: "Priyanka", lastName: "Desai", companyName: CONVERTED_LEAD_TARGET_COMPANY.name,
  email: "priyanka.desai@fernridge.example", phone: "+1-555-0177", status: "Converted",
  convertedTo: { companyId: CONVERTED_LEAD_TARGET_COMPANY._id, contactId: CONVERTED_LEAD_TARGET_CONTACT._id, dealId: CONVERTED_LEAD_TARGET_DEAL._id },
});
leads.push(CONVERTED_DUPLICATE_LEAD);

// 4. A "newly imported" record matching an existing fixture — same domain
// as the real "Northline Prospecting Co", tagged as though it arrived
// through the Import wizard.
export const IMPORTED_DUPLICATE_COMPANY = makeCompany({
  name: "Northline Prospecting Company", accountType: "Prospect", lifecycleStage: "New", source: "Import",
  primaryDomain: companyByName("Northline Prospecting Co").primaryDomain,
  website: companyByName("Northline Prospecting Co").website,
  country: companyByName("Northline Prospecting Co").country,
});
companies.push(IMPORTED_DUPLICATE_COMPANY);

// 5. Two Contacts with the same phone — deliberately DIFFERENT people at
// different companies, so phone is the only signal (Medium confidence,
// distinct from the "same person" shape of the email-match scenarios).
const DUPLICATE_CONTACT_PHONE = "+1-555-0199";
export const DUPLICATE_CONTACT_PHONE_A = makeContact(null, "", {
  firstName: "Casey", lastName: "Nolan", email: "casey.nolan@driftwood.example", phone: DUPLICATE_CONTACT_PHONE,
  relationshipType: "Prospect", lifecycleStage: "New",
});
export const DUPLICATE_CONTACT_PHONE_B = makeContact(null, "", {
  firstName: "Drew", lastName: "Sato", email: "drew.sato@harborline.example", phone: DUPLICATE_CONTACT_PHONE,
  relationshipType: "Prospect", lifecycleStage: "New",
});
contacts.push(DUPLICATE_CONTACT_PHONE_A, DUPLICATE_CONTACT_PHONE_B);

// 6. Contacts with similar (not identical) names at the same Company —
// Medium confidence: name similarity + same employer, no exact identifier match.
const SIMILAR_NAME_CONTACT_CO = companyByName("Several Contacts Manufacturing");
export const DUPLICATE_CONTACT_SIMILAR_A = makeContact(SIMILAR_NAME_CONTACT_CO._id, SIMILAR_NAME_CONTACT_CO.name, {
  firstName: "Jon", lastName: "Whitfield", email: "jon.whitfield@severalcontacts.example", jobTitle: "Procurement Manager",
});
export const DUPLICATE_CONTACT_SIMILAR_B = makeContact(SIMILAR_NAME_CONTACT_CO._id, SIMILAR_NAME_CONTACT_CO.name, {
  firstName: "John", lastName: "Whitfield", email: "john.w@severalcontacts.example", jobTitle: "Procurement Lead",
});
contacts.push(DUPLICATE_CONTACT_SIMILAR_A, DUPLICATE_CONTACT_SIMILAR_B);

// 7. Companies using the same domain (High confidence).
export const DUPLICATE_COMPANY_DOMAIN_A = makeCompany({
  name: "Cascade Ridge Logistics", website: "https://www.cascaderidgelogistics.example.com", primaryDomain: "cascaderidgelogistics.example.com",
  accountType: "Prospect",
});
export const DUPLICATE_COMPANY_DOMAIN_B = makeCompany({
  name: "Cascade Ridge Logistics LLC", website: "https://cascaderidgelogistics.example.com", primaryDomain: "cascaderidgelogistics.example.com",
  accountType: "Prospect",
});
companies.push(DUPLICATE_COMPANY_DOMAIN_A, DUPLICATE_COMPANY_DOMAIN_B);

// 8. Companies with similar names but different countries — the canonical
// false-positive example (Low/Medium confidence: name similarity only).
export const SIMILAR_NAME_DIFFERENT_COUNTRY_A = makeCompany({
  name: "Summit Retail Group", country: "United States", primaryDomain: "summitretailgroup-us.example.com", website: "https://www.summitretailgroup-us.example.com",
});
export const SIMILAR_NAME_DIFFERENT_COUNTRY_B = makeCompany({
  name: "Summit Retail Group Inc", country: "Australia", primaryDomain: "summitretailgroup-au.example.com", website: "https://www.summitretailgroup-au.example.com",
});
companies.push(SIMILAR_NAME_DIFFERENT_COUNTRY_A, SIMILAR_NAME_DIFFERENT_COUNTRY_B);

// 9. A second false-positive shape: two unrelated Companies sharing a
// generic phone number (a switchboard/directory number, not a real signal).
export const FALSE_POSITIVE_SHARED_PHONE_A = makeCompany({ name: "Bright Harbor Consulting", phone: "+1-555-0100" });
export const FALSE_POSITIVE_SHARED_PHONE_B = makeCompany({ name: "Coastal Ventures Partners", phone: "+1-555-0100" });
companies.push(FALSE_POSITIVE_SHARED_PHONE_A, FALSE_POSITIVE_SHARED_PHONE_B);

// 10. A three-record duplicate group (multi-record comparison workspace).
const TRIPLE_DUP_DOMAIN = "vantagepointconsulting.example.com";
export const TRIPLE_DUP_A = makeCompany({ name: "Vantage Point Consulting", primaryDomain: TRIPLE_DUP_DOMAIN, website: `https://${TRIPLE_DUP_DOMAIN}` });
export const TRIPLE_DUP_B = makeCompany({ name: "Vantage Point Consulting", primaryDomain: TRIPLE_DUP_DOMAIN, website: `https://${TRIPLE_DUP_DOMAIN}` });
export const TRIPLE_DUP_C = makeCompany({ name: "Vantage Point Consulting LLC", primaryDomain: TRIPLE_DUP_DOMAIN, website: `https://${TRIPLE_DUP_DOMAIN}` });
companies.push(TRIPLE_DUP_A, TRIPLE_DUP_B, TRIPLE_DUP_C);

// 11. Deals with the same name and Company (High confidence).
const DUPLICATE_DEAL_CO = companyByName("Northline Prospecting Co");
export const DUPLICATE_DEAL_A = makeDeal({ name: `${DUPLICATE_DEAL_CO.name} — Q4 Renewal`, companyId: DUPLICATE_DEAL_CO._id, stage: "Discovery", value: 12000 });
export const DUPLICATE_DEAL_B = makeDeal({ name: `${DUPLICATE_DEAL_CO.name} — Q4 Renewal`, companyId: DUPLICATE_DEAL_CO._id, stage: "Proposal", value: 12500 });
deals.push(DUPLICATE_DEAL_A, DUPLICATE_DEAL_B);

// 12. A group already resolved via a frontend preview merge BEFORE this
// session started — seeds the "Preview Resolved" filter and the Undo path
// without requiring the user to run a live merge first.
export const PREVIOUSLY_MERGED_MASTER = makeContact(null, "", {
  firstName: "Reid", lastName: "Okafor", email: "reid.okafor@brightpath.example", phone: "+1-555-0166",
  relationshipType: "Prospect", lifecycleStage: "New",
});
contacts.push(PREVIOUSLY_MERGED_MASTER);
export const PREVIOUSLY_MERGED_ABSORBED = makeContact(null, "", {
  firstName: "Reid", lastName: "Okafor", email: "reid.okafor@brightpath.example", phone: "+1-555-0166",
  relationshipType: "Prospect", lifecycleStage: "New",
  previewMergedInto: PREVIOUSLY_MERGED_MASTER._id, previewMergedAt: daysAgoC(2),
});
contacts.push(PREVIOUSLY_MERGED_ABSORBED);

export function findLead(leadId) {
  return leads.find((l) => l._id === leadId);
}

// Stands in for a real backend query: filtering, sorting and pagination all
// happen here, over the full dataset, and only the requested page is ever
// returned to the frontend — the redux store never holds more than one
// page's worth of leads at a time.
export function queryLeads(params = {}) {
  const {
    search = "",
    status,
    source,
    priority,
    ownerId,
    department,
    scoreMin,
    scoreMax,
    createdFrom,
    createdTo,
    followUpFrom,
    followUpTo,
    followUpOverdue,
    converted,
    archived = "false",
    sort = "createdAt",
    order = "desc",
    page = 1,
    pageSize = 20,
  } = params;

  let result = leads.filter((l) => {
    // A record absorbed by a frontend duplicate-merge preview is never shown
    // in an ordinary view again (until Undo) — regardless of archived state.
    if (l.previewMergedInto) return false;
    if (archived === "true" && !l.archived) return false;
    if (archived !== "true" && l.archived) return false;
    if (status && l.status !== status) return false;
    if (source && l.source !== source) return false;
    if (priority && l.priority !== priority) return false;
    if (ownerId && l.ownerId !== ownerId) return false;
    if (department && l.department !== department) return false;
    if (scoreMin !== undefined && l.score < Number(scoreMin)) return false;
    if (scoreMax !== undefined && l.score > Number(scoreMax)) return false;
    if (createdFrom && new Date(l.createdAt) < new Date(createdFrom)) return false;
    if (createdTo && new Date(l.createdAt) > new Date(createdTo)) return false;
    if (followUpFrom && (!l.nextFollowUp || new Date(l.nextFollowUp) < new Date(followUpFrom))) return false;
    if (followUpTo && (!l.nextFollowUp || new Date(l.nextFollowUp) > new Date(followUpTo))) return false;
    if (followUpOverdue === "true" && (!l.nextFollowUp || new Date(l.nextFollowUp) >= new Date() || l.status === "Converted")) return false;
    if (converted === "true" && l.status !== "Converted") return false;
    if (converted === "false" && l.status === "Converted") return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = `${l.name} ${l.companyName} ${l.email} ${l.phone}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Summary is computed from the filtered-but-not-yet-paginated set, so
  // cards reflect the active filters per the spec.
  const now = new Date();
  const TERMINAL_STATUSES = ["Converted", "Unqualified", "Duplicate", "Spam"];
  const summary = {
    total: result.length,
    open: result.filter((l) => !TERMINAL_STATUSES.includes(l.status)).length,
    new: result.filter((l) => l.status === "New").length,
    qualified: result.filter((l) => l.status === "Qualified").length,
    followUpsDue: result.filter((l) => l.nextFollowUp && new Date(l.nextFollowUp) >= now && l.status !== "Converted").length,
    overdueFollowUps: result.filter((l) => l.nextFollowUp && new Date(l.nextFollowUp) < now && l.status !== "Converted").length,
    conversionRate: result.length ? Math.round((result.filter((l) => l.status === "Converted").length / result.length) * 100) : 0,
  };

  result.sort((a, b) => {
    const dir = order === "asc" ? 1 : -1;
    const av = a[sort];
    const bv = b[sort];
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    return av > bv ? dir : -dir;
  });

  const total = result.length;
  const pageNum = Math.max(1, Number(page));
  const size = Math.max(1, Number(pageSize));
  const start = (pageNum - 1) * size;
  const pageItems = result.slice(start, start + size);

  return { leads: pageItems, total, page: pageNum, pageSize: size, summary };
}

// Matches the spec's normalized-identifier duplicate check: email, phone, or
// a company+person-name combination. Archived and already-converted leads
// are still checked — a duplicate is a duplicate regardless of its status.
export function findDuplicateLeads({ email, phone, companyName, firstName, lastName }, excludeId = null) {
  const normEmail = normalizeEmail(email);
  const normPhone = normalizePhone(phone);
  const normCompanyName = (companyName || "").trim().toLowerCase();
  const normFullName = `${firstName || ""} ${lastName || ""}`.trim().toLowerCase();

  return leads
    .filter((l) => l._id !== excludeId)
    .map((l) => {
      const reasons = [];
      if (normEmail && normalizeEmail(l.email) === normEmail) reasons.push("Same email address");
      if (normPhone && normPhone.length >= 7 && normalizePhone(l.phone) === normPhone) reasons.push("Same phone number");
      if (
        normCompanyName &&
        normFullName &&
        (l.companyName || "").trim().toLowerCase() === normCompanyName &&
        l.name.trim().toLowerCase() === normFullName
      ) {
        reasons.push("Same company and person name");
      }
      return { lead: l, reasons };
    })
    .filter((match) => match.reasons.length > 0);
}

export function createLeadRecord(payload, actor = "System") {
  // A genuinely new record must be created "now" — without this, makeLead's
  // fixture-seeding fallback (a random date up to a year in the past) wins,
  // so newly created leads sort out of view under createdAt-desc and read
  // as though they were created long ago.
  const lead = makeLead({ ...payload, status: payload.status || "New", createdAt: new Date().toISOString() });
  lead.createdBy = actor;
  lead.updatedBy = actor;
  leads.unshift(lead);
  return lead;
}

// Status transitions that must record a reason — the API layer enforces
// this before calling into the model, but it's exported from here so both
// layers read from one source of truth.
export const REASON_REQUIRED_STATUSES = ["Unqualified", "Duplicate", "Spam"];

// Audit before/after snapshots must exclude the lead's own history arrays —
// a shallow-copied lead keeps a live reference to `auditLog`, and pushing the
// resulting entry back into that same array creates a circular structure
// that throws the moment anything (e.g. the mock adapter) tries to
// serialize it.
function snapshotLead(lead) {
  const { auditLog: _auditLog, activity: _activity, tasks: _tasks, files: _files, ...rest } = lead;
  return rest;
}

export function updateLeadRecord(leadId, changes, actor = "System") {
  const lead = findLead(leadId);
  if (!lead) return null;

  const before = snapshotLead(lead);

  if (changes.status && changes.status !== lead.status) {
    lead.activity.push(
      activityEntry("status_change", actor, `Status changed from ${lead.status} to ${changes.status}`, {
        from: lead.status,
        to: changes.status,
        reason: changes.disqualifyReason || changes.reopenReason || null,
      })
    );
    lead.auditLog.push(
      auditEntry("status_change", actor, {
        before: lead.status,
        after: changes.status,
        reason: changes.disqualifyReason || changes.reopenReason || null,
      })
    );
  }

  if (changes.ownerId && changes.ownerId !== lead.ownerId) {
    const newOwner = findTeamMember(changes.ownerId);
    lead.activity.push(
      activityEntry("assignment_change", actor, `Reassigned from ${lead.ownerName} to ${newOwner?.name || changes.ownerId}`, {
        from: lead.ownerId,
        to: changes.ownerId,
      })
    );
    lead.auditLog.push(auditEntry("assignment_change", actor, { before: lead.ownerName, after: newOwner?.name }));
    changes.ownerName = newOwner?.name;
    changes.department = newOwner?.department || lead.department;
  }

  Object.assign(lead, changes);
  lead.updatedAt = new Date().toISOString();
  lead.updatedBy = actor;
  lead.auditLog.push(auditEntry("update", actor, { before, after: snapshotLead(lead) }));
  return lead;
}

export function addLeadNote(leadId, message, actor) {
  const lead = findLead(leadId);
  if (!lead) return null;
  lead.activity.push(activityEntry("note", actor, message));
  lead.updatedAt = new Date().toISOString();
  return lead;
}

export function logLeadActivity(leadId, type, description, actor, meta) {
  const lead = findLead(leadId);
  if (!lead) return null;
  lead.activity.push(activityEntry(type, actor, description, meta));
  lead.updatedAt = new Date().toISOString();
  return lead;
}

export function createLeadTask(leadId, task, actor) {
  const lead = findLead(leadId);
  if (!lead) return null;
  const newTask = {
    _id: id(),
    title: task.title,
    dueDate: task.dueDate,
    priority: task.priority || "Medium",
    assignee: task.assignee || lead.ownerName,
    reminder: task.reminder || null,
    completed: false,
    completedAt: null,
    createdBy: actor,
    createdAt: new Date().toISOString(),
  };
  lead.tasks.push(newTask);
  lead.activity.push(activityEntry("follow_up_scheduled", actor, `Follow-up scheduled: ${task.title}`, { taskId: newTask._id, dueDate: task.dueDate }));
  return lead;
}

export function updateLeadTask(leadId, taskId, changes, actor) {
  const lead = findLead(leadId);
  if (!lead) return null;
  const task = lead.tasks.find((t) => t._id === taskId);
  if (!task) return null;
  Object.assign(task, changes);
  if (changes.completed) {
    task.completedAt = new Date().toISOString();
    lead.activity.push(activityEntry("follow_up_completed", actor, `Follow-up completed: ${task.title}`, { taskId }));
  }
  return lead;
}

export function addLeadFile(leadId, file, actor) {
  const lead = findLead(leadId);
  if (!lead) return null;
  const newFile = {
    _id: id(),
    name: file.name,
    size: file.size,
    type: file.type,
    dataUrl: file.dataUrl,
    uploadedBy: actor,
    uploadedAt: new Date().toISOString(),
  };
  lead.files.push(newFile);
  lead.activity.push(activityEntry("file_upload", actor, `Uploaded file: ${file.name}`, { fileId: newFile._id }));
  return lead;
}

export function deleteLeadFile(leadId, fileId) {
  const lead = findLead(leadId);
  if (!lead) return null;
  lead.files = lead.files.filter((f) => f._id !== fileId);
  return lead;
}

export function archiveLeadRecord(leadId, reason, actor) {
  const lead = findLead(leadId);
  if (!lead) return null;
  lead.archived = true;
  lead.archiveReason = reason;
  lead.archivedAt = new Date().toISOString();
  lead.activity.push(activityEntry("archived", actor, `Lead archived: ${reason}`));
  lead.auditLog.push(auditEntry("archive", actor, { reason }));
  return lead;
}

export function restoreLeadRecord(leadId, actor) {
  const lead = findLead(leadId);
  if (!lead) return null;
  lead.archived = false;
  lead.restoredAt = new Date().toISOString();
  lead.activity.push(activityEntry("restored", actor, "Lead restored from archive"));
  lead.auditLog.push(auditEntry("restore", actor, {}));
  return lead;
}

export function reopenLeadRecord(leadId, reason, actor) {
  const lead = findLead(leadId);
  if (!lead) return null;
  const before = lead.status;
  lead.status = "Qualified";
  lead.convertedTo = null;
  lead.activity.push(activityEntry("status_change", actor, `Reopened from Converted to Qualified: ${reason}`, { from: before, to: "Qualified", reason }));
  lead.auditLog.push(auditEntry("reopen", actor, { before, after: "Qualified", reason }));
  return lead;
}

// Bulk operations reuse the single-record functions so activity/audit
// logging stays consistent regardless of entry point.
export function bulkAssignLeads(leadIds, ownerId, actor) {
  return leadIds.map((leadId) => updateLeadRecord(leadId, { ownerId }, actor)).filter(Boolean);
}

export function bulkStatusChangeLeads(leadIds, status, actor) {
  return leadIds.map((leadId) => updateLeadRecord(leadId, { status }, actor)).filter(Boolean);
}

export function bulkArchiveLeads(leadIds, reason, actor) {
  return leadIds.map((leadId) => archiveLeadRecord(leadId, reason, actor)).filter(Boolean);
}

// Conversion is written to look and behave like a single transaction: every
// precondition is checked and every object is prepared before anything is
// committed to the in-memory "database", and any failure throws before any
// mutation happens — so callers can roll back cleanly by doing nothing.
export function convertLeadRecord(leadId, actor = "System") {
  const lead = findLead(leadId);
  if (!lead) throw new Error("Lead not found");
  if (lead.status === "Converted") throw new Error("Lead is already converted");
  if (lead.archived) throw new Error("Cannot convert an archived lead");

  const normEmail = normalizeEmail(lead.email);
  const normCompanyName = (lead.companyName || "").trim().toLowerCase();

  // Reuse an existing company/contact if normalized identifiers match,
  // rather than blindly creating duplicates.
  let company = companies.find((c) => c.name.trim().toLowerCase() === normCompanyName);
  let contact = normEmail ? contacts.find((c) => normalizeEmail(c.email) === normEmail) : null;

  const isNewCompany = !company;
  const isNewContact = !contact;

  if (!company) {
    company = makeCompany({ name: lead.companyName || `${lead.name}'s Company`, lifecycleStatus: "Prospect" });
  }
  if (!contact) {
    contact = makeContact(company._id, company.name, { name: lead.name, email: lead.email, phone: lead.phone });
  }
  const deal = makeDeal({
    name: `${company.name} — Initial Deal`,
    companyId: company._id,
    primaryContactId: contact._id,
    value: lead.estimatedValue || 5000,
    stage: "Discovery",
    source: "Converted Lead",
    ownerId: lead.ownerId,
    createdBy: actor,
  });
  const followUpTask = {
    _id: id(),
    title: `Follow up with ${lead.name} after conversion`,
    dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    priority: "High",
    assignee: lead.ownerName,
    reminder: null,
    completed: false,
    completedAt: null,
    createdBy: actor,
    createdAt: new Date().toISOString(),
  };

  // Commit — from here nothing should be able to fail.
  if (isNewCompany) companies.unshift(company);
  if (isNewContact) contacts.unshift(contact);
  deals.unshift(deal);

  lead.status = "Converted";
  lead.convertedTo = { companyId: company._id, contactId: contact._id, dealId: deal._id };
  lead.tasks.push(followUpTask);
  lead.activity.push(
    activityEntry("converted", actor, `Converted to company "${company.name}", contact "${contact.name}" and a new deal`, {
      companyId: company._id,
      contactId: contact._id,
      dealId: deal._id,
      reusedExistingCompany: !isNewCompany,
      reusedExistingContact: !isNewContact,
    })
  );
  lead.auditLog.push(auditEntry("convert", actor, { after: lead.convertedTo }));

  return { lead, company, contact, deal, task: followUpTask };
}

export function findCompany(companyId) {
  return companies.find((c) => c._id === companyId);
}

// Pure, reusable query function over an explicit list — the Companies list
// page runs this client-side over the full fixture set (unlike Leads/
// Contacts' server-shaped pagination) since several other, unrelated pages
// (Support, Finance, Projects, Marketing Segments, the CRM dashboard) also
// consume the full unpaginated `fetchCompanies()` result and would break if
// that shape changed. Centralizing the query logic here, rather than in
// each component, still satisfies "one reusable source of truth."
export function queryCompaniesLocal(list, params = {}) {
  const {
    search = "",
    industry, companySize, accountType, lifecycleStage, customerStatus, accountTier, accountHealth,
    ownerId, team, country, source, tag, followUpOverdue, hasOpenDeals, hasOpenTickets, hasActiveProjects,
    hasOutstandingBalance, assigned, archived = "false",
    sort = "createdAt", order = "desc", page = 1, pageSize = 20,
    // Cross-referenced sets, computed by the caller (who has access to the
    // deals/tickets/projects/invoices slices) and passed in as arrays of
    // companyIds — this function stays a pure function over plain fields.
    openDealCompanyIds, openTicketCompanyIds, activeProjectCompanyIds, outstandingBalanceCompanyIds,
  } = params;

  let result = list.filter((c) => {
    // A record absorbed by a frontend duplicate-merge preview is never shown
    // in an ordinary view again (until Undo) — regardless of archived state.
    if (c.previewMergedInto) return false;
    if (archived === "true" && !c.archived) return false;
    if (archived !== "true" && c.archived) return false;
    if (industry && c.industry !== industry) return false;
    if (companySize && c.companySize !== companySize) return false;
    if (accountType && c.accountType !== accountType) return false;
    if (lifecycleStage && c.lifecycleStage !== lifecycleStage) return false;
    if (customerStatus && c.customerStatus !== customerStatus) return false;
    if (accountTier && c.accountTier !== accountTier) return false;
    if (accountHealth && c.accountHealth !== accountHealth) return false;
    if (ownerId && c.ownerId !== ownerId) return false;
    if (team && c.assignedTeam !== team) return false;
    if (country && c.country !== country) return false;
    if (source && c.source !== source) return false;
    if (tag && !(c.tags || []).includes(tag)) return false;
    if (assigned === "true" && !c.ownerId) return false;
    if (assigned === "false" && c.ownerId) return false;
    if (followUpOverdue === "true" && (!c.nextFollowUp || new Date(c.nextFollowUp) >= new Date())) return false;
    if (hasOpenDeals === "true" && !openDealCompanyIds?.includes(c._id)) return false;
    if (hasOpenTickets === "true" && !openTicketCompanyIds?.includes(c._id)) return false;
    if (hasActiveProjects === "true" && !activeProjectCompanyIds?.includes(c._id)) return false;
    if (hasOutstandingBalance === "true" && !outstandingBalanceCompanyIds?.includes(c._id)) return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = `${c.name} ${c.primaryDomain} ${c.website} ${c.email} ${c.phone}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const now = new Date();
  const summary = {
    total: result.length,
    prospects: result.filter((c) => c.accountType === "Prospect").length,
    activeCustomers: result.filter((c) => c.accountType === "Customer" && c.customerStatus === "Active").length,
    atRisk: result.filter((c) => c.accountHealth === "At Risk").length,
    followUpsDue: result.filter((c) => c.nextFollowUp && new Date(c.nextFollowUp) >= now).length,
    unassigned: result.filter((c) => !c.ownerId).length,
  };

  result = [...result].sort((a, b) => {
    const dir = order === "asc" ? 1 : -1;
    const av = a[sort];
    const bv = b[sort];
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    return av > bv ? dir : -dir;
  });

  const total = result.length;
  const pageNum = Math.max(1, Number(page));
  const size = Math.max(1, Number(pageSize));
  const start = (pageNum - 1) * size;
  const pageItems = result.slice(start, start + size);

  return { companies: pageItems, total, page: pageNum, pageSize: size, summary };
}

// Matches the spec's normalized-identifier duplicate check: name, primary
// domain/website domain, phone, or a name+country combination.
export function findDuplicateCompanies({ name, website, primaryDomain, phone, country }, excludeId = null) {
  const normName = (name || "").trim().toLowerCase();
  const normDomain = (primaryDomain || deriveCompanyDomain(website || "")).trim().toLowerCase();
  const normPhone = normalizePhone(phone);
  const normCountry = (country || "").trim().toLowerCase();

  return companies
    .filter((c) => c._id !== excludeId)
    .map((c) => {
      const reasons = [];
      if (normName && c.name.trim().toLowerCase() === normName) reasons.push("Same company name");
      if (normDomain && c.primaryDomain && c.primaryDomain.trim().toLowerCase() === normDomain) reasons.push("Same domain");
      if (normPhone && normPhone.length >= 7 && normalizePhone(c.phone) === normPhone) reasons.push("Same phone number");
      if (normCountry && normName && c.country.trim().toLowerCase() === normCountry && c.name.trim().toLowerCase() === normName) {
        reasons.push("Same name and country");
      }
      return { company: c, reasons };
    })
    .filter((match) => match.reasons.length > 0);
}

export function createCompanyRecord(payload, actor = "System") {
  // See createLeadRecord's note: without an explicit "now" timestamp,
  // makeCompany's fixture-seeding fallback assigns a random past date,
  // and the new company sorts out of view under createdAt-desc.
  const company = makeCompany({ ...payload, createdBy: actor, updatedBy: actor, createdAt: new Date().toISOString() });
  companies.unshift(company);
  return company;
}

const COMPANY_AUDIT_TRACKED_FIELDS = [
  "name", "website", "primaryDomain", "industry", "companySize", "accountType", "lifecycleStage",
  "customerStatus", "accountTier", "accountHealth", "ownerId", "ownerName", "assignedTeam",
  "email", "phone", "country", "region", "city", "nextFollowUp",
];

export function updateCompanyRecord(companyId, changes, actor = "System") {
  const company = findCompany(companyId);
  if (!company) return null;

  if (changes.ownerId !== undefined && changes.ownerId !== company.ownerId) {
    const newOwner = findTeamMember(changes.ownerId);
    company.activity.push(companyActivityEntry("owner_changed", actor, `Reassigned from ${company.ownerName || "Unassigned"} to ${newOwner?.name || "Unassigned"}`));
    changes.ownerName = newOwner?.name || null;
  }
  if (changes.lifecycleStage && changes.lifecycleStage !== company.lifecycleStage) {
    company.activity.push(companyActivityEntry("lifecycle_changed", actor, `Lifecycle changed from ${company.lifecycleStage} to ${changes.lifecycleStage}`, {
      from: company.lifecycleStage, to: changes.lifecycleStage, reason: changes.lifecycleChangeReason || null,
    }));
  }
  if (changes.accountHealth && changes.accountHealth !== company.accountHealth) {
    company.activity.push(companyActivityEntry("health_changed", actor, `Health changed from ${company.accountHealth} to ${changes.accountHealth}${changes.healthReason ? `: ${changes.healthReason}` : ""}`, {
      from: company.accountHealth, to: changes.accountHealth,
    }));
  }

  for (const field of COMPANY_AUDIT_TRACKED_FIELDS) {
    if (field in changes && changes[field] !== company[field]) {
      company.auditLog.push(companyAuditEntry("update", actor, { field, before: company[field] ?? null, after: changes[field] ?? null, reason: changes.reason || null }));
    }
  }

  Object.assign(company, changes);
  company.updatedAt = new Date().toISOString();
  company.updatedBy = actor;
  return company;
}

export function addCompanyNote(companyId, message, actor) {
  const company = findCompany(companyId);
  if (!company) return null;
  company.activity.push(companyActivityEntry("note", actor, message));
  company.updatedAt = new Date().toISOString();
  return company;
}

export function logCompanyActivity(companyId, type, description, actor, meta) {
  const company = findCompany(companyId);
  if (!company) return null;
  company.activity.push(companyActivityEntry(type, actor, description, meta));
  company.updatedAt = new Date().toISOString();
  return company;
}

export function createCompanyTask(companyId, task, actor) {
  const company = findCompany(companyId);
  if (!company) return null;
  company.tasks.push({
    _id: id(), title: task.title, dueDate: task.dueDate, priority: task.priority || "Medium",
    assignee: task.assignee || company.ownerName, completed: false, completedAt: null,
    createdBy: actor, createdAt: new Date().toISOString(),
  });
  company.activity.push(companyActivityEntry("task", actor, `Task created: ${task.title}`));
  return company;
}

export function updateCompanyTask(companyId, taskId, changes, actor) {
  const company = findCompany(companyId);
  if (!company) return null;
  const task = company.tasks.find((t) => t._id === taskId);
  if (!task) return null;
  Object.assign(task, changes);
  if (changes.completed === true) task.completedAt = new Date().toISOString();
  if (changes.completed === false) task.completedAt = null;
  company.activity.push(companyActivityEntry("task", actor, `Task "${task.title}" ${changes.completed === false ? "reopened" : changes.completed ? "completed" : "updated"}`));
  return company;
}

export function addCompanyFile(companyId, file, actor) {
  const company = findCompany(companyId);
  if (!company) return null;
  company.files.push({ _id: id(), name: file.name, size: file.size, type: file.type, dataUrl: file.dataUrl, uploadedBy: actor, uploadedAt: new Date().toISOString(), version: 1 });
  company.activity.push(companyActivityEntry("file_uploaded", actor, `Uploaded file: ${file.name}`));
  return company;
}

export function deleteCompanyFile(companyId, fileId) {
  const company = findCompany(companyId);
  if (!company) return null;
  company.files = company.files.filter((f) => f._id !== fileId);
  return company;
}

export function archiveCompanyRecord(companyId, reason, actor) {
  const company = findCompany(companyId);
  if (!company) return null;
  company.archived = true;
  company.archiveReason = reason;
  company.archivedAt = new Date().toISOString();
  company.activity.push(companyActivityEntry("archived", actor, `Archived: ${reason}`));
  company.auditLog.push(companyAuditEntry("archive", actor, { field: "archived", before: false, after: true, reason }));
  return company;
}

export function restoreCompanyRecord(companyId, actor) {
  const company = findCompany(companyId);
  if (!company) return null;
  company.archived = false;
  company.archiveReason = null;
  company.archivedAt = null;
  company.activity.push(companyActivityEntry("restored", actor, "Restored from archive"));
  company.auditLog.push(companyAuditEntry("restore", actor, { field: "archived", before: true, after: false }));
  return company;
}

function applyToCompanies(companyIds, fn) {
  return companyIds.map((cid) => findCompany(cid)).filter(Boolean).map(fn);
}

export function bulkAssignCompanies(companyIds, ownerId, actor) {
  return applyToCompanies(companyIds, (c) => updateCompanyRecord(c._id, { ownerId }, actor));
}
export function bulkTagCompanies(companyIds, tag, actor) {
  return applyToCompanies(companyIds, (c) => {
    if (!c.tags.includes(tag)) c.tags = [...c.tags, tag];
    c.activity.push(companyActivityEntry("note", actor, `Tag added: ${tag}`));
    return c;
  });
}
export function bulkLifecycleUpdateCompanies(companyIds, lifecycleStage, actor) {
  return applyToCompanies(companyIds, (c) => updateCompanyRecord(c._id, { lifecycleStage }, actor));
}
export function bulkArchiveCompanies(companyIds, reason, actor) {
  return applyToCompanies(companyIds, (c) => archiveCompanyRecord(c._id, reason, actor));
}

// ---- Company <-> Contact relationship management ----
export function linkContactToCompany(companyId, contactId, actor) {
  const company = findCompany(companyId);
  const contact = findContact(contactId);
  if (!company || !contact) return null;
  contact.companyId = company._id;
  contact.companyName = company.name;
  company.activity.push(companyActivityEntry("contact_added", actor, `${contact.name} linked as a contact`, { relatedRecord: contact.name }));
  return company;
}

export function unlinkContactFromCompany(companyId, contactId, actor) {
  const company = findCompany(companyId);
  const contact = findContact(contactId);
  if (!company || !contact) return null;
  contact.companyId = null;
  contact.companyName = "";
  if (company.primaryContactId === contactId) company.primaryContactId = null;
  company.activity.push(companyActivityEntry("note", actor, `${contact.name} removed as a contact`));
  return company;
}

export function setPrimaryContact(companyId, contactId, actor) {
  const company = findCompany(companyId);
  if (!company) return null;
  company.primaryContactId = contactId;
  const contact = contactId ? findContact(contactId) : null;
  company.activity.push(companyActivityEntry("note", actor, contact ? `${contact.name} marked as primary contact` : "Primary contact cleared"));
  return company;
}

export function findContact(contactId) {
  return contacts.find((c) => c._id === contactId);
}

// Stands in for a real backend query: filtering, sorting and pagination all
// happen here, over the full dataset, and only the requested page is ever
// returned to the frontend — mirrors queryLeads for the same reason.
export function queryContacts(params = {}) {
  const {
    search = "",
    companyId,
    relationshipType,
    lifecycleStage,
    ownerId,
    source,
    country,
    tag,
    communicationStatus,
    followUpOverdue,
    archived = "false",
    sort = "createdAt",
    order = "desc",
    page = 1,
    pageSize = 20,
  } = params;

  let result = contacts.filter((c) => {
    // A record absorbed by a frontend duplicate-merge preview is never shown
    // in an ordinary view again (until Undo) — regardless of archived state.
    if (c.previewMergedInto) return false;
    if (archived === "true" && !c.archived) return false;
    if (archived !== "true" && c.archived) return false;
    if (companyId && c.companyId !== companyId) return false;
    if (relationshipType && c.relationshipType !== relationshipType) return false;
    if (lifecycleStage && c.lifecycleStage !== lifecycleStage) return false;
    if (ownerId && c.ownerId !== ownerId) return false;
    if (source && c.source !== source) return false;
    if (country && c.country !== country) return false;
    if (tag && !(c.tags || []).includes(tag)) return false;
    if (communicationStatus) {
      const status = contactCommunicationStatus(c);
      if (status !== communicationStatus) return false;
    }
    if (followUpOverdue === "true" && (!c.nextFollowUp || new Date(c.nextFollowUp) >= new Date())) return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = `${c.name} ${c.companyName} ${c.email} ${c.phone}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const now = new Date();
  const summary = {
    total: result.length,
    prospects: result.filter((c) => c.relationshipType === "Prospect").length,
    activeCustomers: result.filter((c) => c.relationshipType === "Customer" && c.lifecycleStage === "Active").length,
    followUpsDue: result.filter((c) => c.nextFollowUp && new Date(c.nextFollowUp) >= now).length,
    overdueFollowUps: result.filter((c) => c.nextFollowUp && new Date(c.nextFollowUp) < now).length,
    doNotContact: result.filter((c) => c.doNotContact).length,
  };

  result.sort((a, b) => {
    const dir = order === "asc" ? 1 : -1;
    const av = a[sort];
    const bv = b[sort];
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    return av > bv ? dir : -dir;
  });

  const total = result.length;
  const pageNum = Math.max(1, Number(page));
  const size = Math.max(1, Number(pageSize));
  const start = (pageNum - 1) * size;
  const pageItems = result.slice(start, start + size);

  return { contacts: pageItems, total, page: pageNum, pageSize: size, summary };
}

export function contactCommunicationStatus(contact) {
  if (contact.doNotContact) return "Do Not Contact";
  if (!contact.emailAllowed && !contact.phoneAllowed && !contact.smsAllowed) return "Restricted";
  return "Active";
}

// Matches the spec's normalized-identifier duplicate check: email, phone, or
// a full-name + company combination.
export function findDuplicateContacts({ email, phone, companyName, firstName, lastName }, excludeId = null) {
  const normEmail = normalizeEmail(email);
  const normPhone = normalizePhone(phone);
  const normCompanyName = (companyName || "").trim().toLowerCase();
  const normFullName = `${firstName || ""} ${lastName || ""}`.trim().toLowerCase();

  return contacts
    .filter((c) => c._id !== excludeId)
    .map((c) => {
      const reasons = [];
      if (normEmail && normalizeEmail(c.email) === normEmail) reasons.push("Same email address");
      if (normPhone && normPhone.length >= 7 && normalizePhone(c.phone) === normPhone) reasons.push("Same phone number");
      if (normCompanyName && normFullName && (c.companyName || "").trim().toLowerCase() === normCompanyName && c.name.trim().toLowerCase() === normFullName) {
        reasons.push("Same company and person name");
      }
      return { contact: c, reasons };
    })
    .filter((match) => match.reasons.length > 0);
}

export function createContactRecord(payload, actor = "System") {
  // See createLeadRecord's note: without an explicit "now" timestamp,
  // makeContact's fixture-seeding fallback assigns a random past date,
  // and the new contact sorts out of view under createdAt-desc.
  const company = findCompany(payload.companyId);
  const contact = makeContact(payload.companyId || null, company?.name || "", { ...payload, createdBy: actor, updatedBy: actor, createdAt: new Date().toISOString() });
  contacts.unshift(contact);
  return contact;
}

// Field-level diff so the audit log records exactly what changed, without
// ever holding a live reference back into the contact's own history arrays
// (see contactAuditEntry's note on why that matters).
const AUDIT_TRACKED_FIELDS = [
  "firstName", "lastName", "jobTitle", "businessDepartment", "decisionMakingRole", "email", "phone",
  "country", "timezone", "preferredLanguage", "preferredChannel", "companyId", "companyName",
  "relationshipType", "lifecycleStage", "ownerId", "ownerName", "source", "nextFollowUp",
  "emailAllowed", "phoneAllowed", "smsAllowed", "marketingAllowed", "doNotContact",
];

export function updateContactRecord(contactId, changes, actor = "System") {
  const contact = findContact(contactId);
  if (!contact) return null;

  if (changes.ownerId && changes.ownerId !== contact.ownerId) {
    const newOwner = findTeamMember(changes.ownerId);
    contact.activity.push(contactActivityEntry("owner_changed", actor, `Reassigned from ${contact.ownerName} to ${newOwner?.name || changes.ownerId}`));
    changes.ownerName = newOwner?.name;
  }
  if (changes.lifecycleStage && changes.lifecycleStage !== contact.lifecycleStage) {
    contact.activity.push(contactActivityEntry("lifecycle_changed", actor, `Lifecycle changed from ${contact.lifecycleStage} to ${changes.lifecycleStage}`, {
      from: contact.lifecycleStage, to: changes.lifecycleStage, reason: changes.lifecycleChangeReason || null,
    }));
  }
  if (changes.doNotContact === true && !contact.doNotContact) {
    changes.emailAllowed = false;
    changes.phoneAllowed = false;
    changes.smsAllowed = false;
    changes.marketingAllowed = false;
    contact.activity.push(contactActivityEntry("note", actor, `Marked as Do Not Contact${changes.doNotContactReason ? `: ${changes.doNotContactReason}` : ""}`));
  }

  for (const field of AUDIT_TRACKED_FIELDS) {
    if (field in changes && changes[field] !== contact[field]) {
      contact.auditLog.push(contactAuditEntry("update", actor, { field, before: contact[field] ?? null, after: changes[field] ?? null, reason: changes.reason || null }));
    }
  }

  Object.assign(contact, changes);
  contact.updatedAt = new Date().toISOString();
  contact.updatedBy = actor;
  return contact;
}

export function updateContactConsent(contactId, optedIn, reason) {
  const contact = findContact(contactId);
  if (!contact) return null;
  contact.marketingOptIn = optedIn;
  contact.marketingAllowed = optedIn;
  contact.consentHistory = [
    ...(contact.consentHistory || []),
    { optedIn, reason: reason || (optedIn ? "Resubscribed" : "Unsubscribed"), at: new Date().toISOString() },
  ];
  return contact;
}

export function addContactNote(contactId, message, actor) {
  const contact = findContact(contactId);
  if (!contact) return null;
  contact.activity.push(contactActivityEntry("note", actor, message));
  contact.updatedAt = new Date().toISOString();
  return contact;
}

export function logContactActivity(contactId, type, description, actor, meta) {
  const contact = findContact(contactId);
  if (!contact) return null;
  contact.activity.push(contactActivityEntry(type, actor, description, meta));
  contact.updatedAt = new Date().toISOString();
  return contact;
}

export function createContactTask(contactId, task, actor) {
  const contact = findContact(contactId);
  if (!contact) return null;
  contact.tasks.push({
    _id: id(), title: task.title, dueDate: task.dueDate, priority: task.priority || "Medium",
    assignee: task.assignee || contact.ownerName, completed: false, completedAt: null,
    createdBy: actor, createdAt: new Date().toISOString(),
  });
  contact.activity.push(contactActivityEntry("task", actor, `Task created: ${task.title}`));
  return contact;
}

export function updateContactTask(contactId, taskId, changes, actor) {
  const contact = findContact(contactId);
  if (!contact) return null;
  const task = contact.tasks.find((t) => t._id === taskId);
  if (!task) return null;
  Object.assign(task, changes);
  if (changes.completed === true) task.completedAt = new Date().toISOString();
  if (changes.completed === false) task.completedAt = null;
  contact.activity.push(contactActivityEntry("task", actor, `Task "${task.title}" ${changes.completed === false ? "reopened" : changes.completed ? "completed" : "updated"}`));
  return contact;
}

export function addContactFile(contactId, file, actor) {
  const contact = findContact(contactId);
  if (!contact) return null;
  contact.files.push({ _id: id(), name: file.name, size: file.size, type: file.type, dataUrl: file.dataUrl, uploadedBy: actor, uploadedAt: new Date().toISOString() });
  contact.activity.push(contactActivityEntry("file_uploaded", actor, `Uploaded file: ${file.name}`));
  return contact;
}

export function deleteContactFile(contactId, fileId) {
  const contact = findContact(contactId);
  if (!contact) return null;
  contact.files = contact.files.filter((f) => f._id !== fileId);
  return contact;
}

export function archiveContactRecord(contactId, reason, actor) {
  const contact = findContact(contactId);
  if (!contact) return null;
  contact.archived = true;
  contact.archiveReason = reason;
  contact.archivedAt = new Date().toISOString();
  contact.activity.push(contactActivityEntry("archived", actor, `Archived: ${reason}`));
  contact.auditLog.push(contactAuditEntry("archive", actor, { field: "archived", before: false, after: true, reason }));
  return contact;
}

export function restoreContactRecord(contactId, actor) {
  const contact = findContact(contactId);
  if (!contact) return null;
  contact.archived = false;
  contact.archiveReason = null;
  contact.archivedAt = null;
  contact.activity.push(contactActivityEntry("restored", actor, "Restored from archive"));
  contact.auditLog.push(contactAuditEntry("restore", actor, { field: "archived", before: true, after: false }));
  return contact;
}

function applyToContacts(contactIds, fn) {
  return contactIds.map((cid) => findContact(cid)).filter(Boolean).map(fn);
}

export function bulkAssignContacts(contactIds, ownerId, actor) {
  return applyToContacts(contactIds, (c) => updateContactRecord(c._id, { ownerId }, actor));
}

export function bulkTagContacts(contactIds, tag, actor) {
  return applyToContacts(contactIds, (c) => {
    if (!c.tags.includes(tag)) c.tags = [...c.tags, tag];
    c.activity.push(contactActivityEntry("note", actor, `Tag added: ${tag}`));
    return c;
  });
}

export function bulkLifecycleUpdateContacts(contactIds, lifecycleStage, actor) {
  return applyToContacts(contactIds, (c) => updateContactRecord(c._id, { lifecycleStage }, actor));
}

export function bulkArchiveContacts(contactIds, reason, actor) {
  return applyToContacts(contactIds, (c) => archiveContactRecord(c._id, reason, actor));
}

export function findDeal(dealId) {
  return deals.find((d) => d._id === dealId);
}

// Pure, reusable query function over an explicit list — same rationale as
// queryCompaniesLocal: several deal metrics need cross-referencing against
// the (separately-sliced) Activities data, which the caller resolves into
// plain id arrays so this function stays pure over plain fields.
export function queryDealsLocal(list, params = {}) {
  const {
    search = "", companyId, contactId, pipeline, stage, status, ownerId, team, source, dealType,
    priority, dealHealth, minValue, maxValue, minProbability, maxProbability,
    closingBefore, closingAfter, closingThisMonth, closingOverdue, hasNextActivity, noNextAction, staleActivity,
    hasProducts, tag,
    archived = "false", sort = "createdAt", order = "desc", page = 1, pageSize = 20,
    nextActivityDealIds, staleDealIds,
  } = params;
  // "owner=me" resolves to the same fixed mock-session id used across Leads/
  // Deals/Pipeline — see CURRENT_MOCK_OWNER_ID's own comment.
  const resolvedOwnerId = ownerId === "me" ? CURRENT_MOCK_OWNER_ID : ownerId;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  let result = list.filter((d) => {
    // A record absorbed by a frontend duplicate-merge preview is never shown
    // in an ordinary view again (until Undo) — regardless of archived state.
    if (d.previewMergedInto) return false;
    if (archived === "true" && !d.archived) return false;
    if (archived !== "true" && d.archived) return false;
    if (companyId && d.companyId !== companyId) return false;
    if (contactId && d.primaryContactId !== contactId && !(d.additionalContactIds || []).includes(contactId)) return false;
    if (pipeline && d.pipeline !== pipeline) return false;
    if (stage && d.stage !== stage) return false;
    if (status && d.status !== status) return false;
    if (resolvedOwnerId === "unassigned" ? d.ownerId : resolvedOwnerId && d.ownerId !== resolvedOwnerId) return false;
    if (team && d.assignedTeam !== team) return false;
    if (source && d.source !== source) return false;
    if (dealType && d.dealType !== dealType) return false;
    if (priority && d.priority !== priority) return false;
    if (dealHealth && d.dealHealth !== dealHealth) return false;
    if (minValue !== undefined && minValue !== "" && d.value < Number(minValue)) return false;
    if (maxValue !== undefined && maxValue !== "" && d.value > Number(maxValue)) return false;
    if (minProbability !== undefined && minProbability !== "" && d.probability < Number(minProbability)) return false;
    if (maxProbability !== undefined && maxProbability !== "" && d.probability > Number(maxProbability)) return false;
    if (closingBefore && (!d.expectedClosingDate || new Date(d.expectedClosingDate) > new Date(closingBefore))) return false;
    if (closingAfter && (!d.expectedClosingDate || new Date(d.expectedClosingDate) < new Date(closingAfter))) return false;
    if (closingThisMonth === "true" && (!d.expectedClosingDate || new Date(d.expectedClosingDate) < monthStart || new Date(d.expectedClosingDate) >= monthEnd)) return false;
    if (closingOverdue === "true" && (d.status !== "Open" || !d.expectedClosingDate || new Date(d.expectedClosingDate) >= now)) return false;
    if (hasNextActivity === "true" && !nextActivityDealIds?.includes(d._id)) return false;
    if (hasNextActivity === "false" && nextActivityDealIds?.includes(d._id)) return false;
    if (noNextAction === "true" && d.nextAction) return false;
    if (staleActivity === "true" && !staleDealIds?.includes(d._id)) return false;
    if (hasProducts === "true" && !(d.lineItems || []).length) return false;
    if (tag && !(d.tags || []).includes(tag)) return false;
    if (search) {
      const q = search.toLowerCase();
      const company = d.companyId ? companies.find((c) => c._id === d.companyId) : null;
      const contact = d.primaryContactId ? contacts.find((c) => c._id === d.primaryContactId) : null;
      const haystack = `${d.name} ${d.description} ${company?.name || ""} ${contact?.name || ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const isOpen = (d) => d.status === "Open";
  const valueByCurrency = (arr) => arr.reduce((acc, d) => { acc[d.currency] = (acc[d.currency] || 0) + d.value; return acc; }, {});
  const weightedByCurrency = (arr) => arr.reduce((acc, d) => { acc[d.currency] = (acc[d.currency] || 0) + d.weightedValue; return acc; }, {});

  const openDeals = result.filter(isOpen);
  const closingThisMonthDeals = openDeals.filter((d) => d.expectedClosingDate && new Date(d.expectedClosingDate) >= monthStart && new Date(d.expectedClosingDate) < monthEnd);
  const atRiskDeals = openDeals.filter((d) => ["At Risk", "Stalled"].includes(d.dealHealth));
  const wonThisPeriod = result.filter((d) => d.status === "Won" && d.actualClosingDate && new Date(d.actualClosingDate) >= monthStart && new Date(d.actualClosingDate) < monthEnd);
  const lostThisPeriod = result.filter((d) => d.status === "Lost" && d.actualClosingDate && new Date(d.actualClosingDate) >= monthStart && new Date(d.actualClosingDate) < monthEnd);

  const summary = {
    total: result.length,
    openCount: openDeals.length,
    openValueByCurrency: valueByCurrency(openDeals),
    weightedValueByCurrency: weightedByCurrency(openDeals),
    closingThisMonthCount: closingThisMonthDeals.length,
    closingThisMonthValueByCurrency: valueByCurrency(closingThisMonthDeals),
    atRiskCount: atRiskDeals.length,
    wonThisPeriodCount: wonThisPeriod.length,
    wonThisPeriodValueByCurrency: valueByCurrency(wonThisPeriod),
    lostThisPeriodCount: lostThisPeriod.length,
    lostThisPeriodValueByCurrency: valueByCurrency(lostThisPeriod),
  };

  result = [...result].sort((a, b) => {
    const dir = order === "asc" ? 1 : -1;
    const av = a[sort];
    const bv = b[sort];
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    return av > bv ? dir : -dir;
  });

  const total = result.length;
  const pageNum = Math.max(1, Number(page));
  const size = Math.max(1, Number(pageSize));
  const start = (pageNum - 1) * size;
  const pageItems = result.slice(start, start + size);

  return { deals: pageItems, total, page: pageNum, pageSize: size, summary };
}

export function createDealRecord(payload, actor = "System") {
  // Same "now" stamping fix as Leads/Contacts/Companies: without an
  // explicit createdAt, makeDeal's fixture-seeding fallback assigns a
  // random past date and the new deal sorts out of view under createdAt-desc.
  const deal = makeDeal({ ...payload, createdBy: actor, updatedBy: actor, createdAt: new Date().toISOString() });
  deals.unshift(deal);
  return deal;
}

const DEAL_AUDIT_TRACKED_FIELDS = [
  "name", "pipeline", "dealType", "source", "companyId", "primaryContactId", "ownerId", "ownerName",
  "assignedTeam", "currency", "value", "probability", "expectedClosingDate", "priority", "dealHealth", "nextAction",
];

export function updateDealRecord(dealId, changes, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;

  if (changes.ownerId !== undefined && changes.ownerId !== deal.ownerId) {
    const newOwner = findTeamMember(changes.ownerId);
    changes.ownerName = newOwner?.name || null;
  }

  for (const field of DEAL_AUDIT_TRACKED_FIELDS) {
    if (field in changes && changes[field] !== deal[field]) {
      deal.auditLog.push(dealAuditEntry("update", actor, { field, before: deal[field] ?? null, after: changes[field] ?? null, reason: changes.reason || null }));
    }
  }

  if (changes.lineItems) changes.lineItems = normalizeLineItems(changes.lineItems);

  Object.assign(deal, changes);

  // value/probability can change independently — always recompute the
  // derived weighted value together so it can never drift out of sync.
  deal.weightedValue = computeWeightedValue(deal.value, deal.probability);
  if (changes.lineItems) deal.expectedRecurringValue = computeLineItemTotals(deal.lineItems).recurringValue;

  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

function pushStageHistory(deal, to, actor, note) {
  const lastEntry = deal.stageHistory[deal.stageHistory.length - 1];
  const timeInStagePriorMs = lastEntry ? Date.now() - new Date(lastEntry.at).getTime() : null;
  deal.stageHistory = [...deal.stageHistory, { _id: id(), from: deal.stage, to, changedBy: actor, at: new Date().toISOString(), note: note || null, timeInStagePriorMs }];
}

// Ordinary open-funnel stage move (Discovery..Approval, or into Won). Outcome
// transitions (Lost/Cancelled/On Hold/Reopen) go through their own dedicated
// functions below since each carries required fields the others don't.
export function changeDealStage(dealId, { stage, note } = {}, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal || deal.stage === stage) return deal || null;
  const from = deal.stage;
  pushStageHistory(deal, stage, actor, note);
  deal.stage = stage;
  deal.status = deriveDealStatus(stage);
  if (DEAL_STAGE_PROBABILITY[stage] !== undefined) deal.probability = DEAL_STAGE_PROBABILITY[stage];
  deal.weightedValue = computeWeightedValue(deal.value, deal.probability);
  if (stage === "Won") {
    deal.actualClosingDate = deal.actualClosingDate || new Date().toISOString();
    deal.nextAction = null;
  }
  deal.auditLog.push(dealAuditEntry("stage_change", actor, { field: "stage", before: from, after: stage, reason: note || null }));
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

export function markDealWon(dealId, { actualClosingDate, winReason, handoffOwnerId, note, value } = {}, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  const from = deal.stage;
  const handoffOwner = handoffOwnerId ? findTeamMember(handoffOwnerId) : null;
  pushStageHistory(deal, "Won", actor, note || "Marked Won");
  if (value !== undefined && value !== null && !Number.isNaN(Number(value))) deal.value = Number(value);
  deal.stage = "Won";
  deal.status = "Won";
  deal.probability = 100;
  deal.weightedValue = computeWeightedValue(deal.value, 100);
  deal.actualClosingDate = actualClosingDate || new Date().toISOString();
  deal.winReason = winReason || null;
  deal.handoffOwnerId = handoffOwner?.id || null;
  deal.handoffOwnerName = handoffOwner?.name || null;
  deal.nextAction = null;
  deal.auditLog.push(dealAuditEntry("won", actor, { field: "stage", before: from, after: "Won", reason: winReason }));
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

export function markDealLost(dealId, { lossReason, lossCompetitor, actualClosingDate, note } = {}, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  const from = deal.stage;
  pushStageHistory(deal, "Lost", actor, note || "Marked Lost");
  deal.stage = "Lost";
  deal.status = "Lost";
  deal.probability = 0;
  deal.weightedValue = 0;
  deal.actualClosingDate = actualClosingDate || new Date().toISOString();
  deal.lossReason = lossReason || null;
  deal.lossCompetitor = lossCompetitor || null;
  deal.auditLog.push(dealAuditEntry("lost", actor, { field: "stage", before: from, after: "Lost", reason: lossReason }));
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

export function cancelDealRecord(dealId, { cancellationReason, note } = {}, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  const from = deal.stage;
  pushStageHistory(deal, "Cancelled", actor, note || "Cancelled");
  deal.stage = "Cancelled";
  deal.status = "Cancelled";
  deal.probability = 0;
  deal.weightedValue = 0;
  deal.actualClosingDate = new Date().toISOString();
  deal.cancellationReason = cancellationReason || null;
  deal.auditLog.push(dealAuditEntry("cancelled", actor, { field: "stage", before: from, after: "Cancelled", reason: cancellationReason }));
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

export function putDealOnHold(dealId, { onHoldReason, onHoldReviewDate, ownerId } = {}, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  const from = deal.stage;
  pushStageHistory(deal, "On Hold", actor, onHoldReason || "Put on hold");
  deal.stage = "On Hold";
  deal.status = "On Hold";
  deal.onHoldReason = onHoldReason || null;
  deal.onHoldReviewDate = onHoldReviewDate || null;
  if (ownerId !== undefined && ownerId !== deal.ownerId) {
    const newOwner = findTeamMember(ownerId);
    deal.ownerId = newOwner?.id || null;
    deal.ownerName = newOwner?.name || null;
  }
  deal.auditLog.push(dealAuditEntry("on_hold", actor, { field: "stage", before: from, after: "On Hold", reason: onHoldReason }));
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

export function reopenDealRecord(dealId, { stage, expectedClosingDate, nextAction } = {}, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  const from = deal.stage;
  const targetStage = stage || "Qualified";
  pushStageHistory(deal, targetStage, actor, "Reopened");
  deal.stage = targetStage;
  deal.status = "Open";
  deal.probability = DEAL_STAGE_PROBABILITY[targetStage] ?? 10;
  deal.weightedValue = computeWeightedValue(deal.value, deal.probability);
  deal.actualClosingDate = null;
  deal.winReason = null;
  deal.lossReason = null;
  deal.lossCompetitor = null;
  deal.cancellationReason = null;
  deal.onHoldReason = null;
  deal.onHoldReviewDate = null;
  if (expectedClosingDate) deal.expectedClosingDate = expectedClosingDate;
  if (nextAction !== undefined) deal.nextAction = nextAction;
  deal.auditLog.push(dealAuditEntry("reopen", actor, { field: "stage", before: from, after: targetStage }));
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

export function archiveDealRecord(dealId, reason, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  deal.archived = true;
  deal.archiveReason = reason;
  deal.archivedAt = new Date().toISOString();
  deal.auditLog.push(dealAuditEntry("archive", actor, { field: "archived", before: false, after: true, reason }));
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

export function restoreDealRecord(dealId, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  deal.archived = false;
  deal.archiveReason = null;
  deal.archivedAt = null;
  deal.auditLog.push(dealAuditEntry("restore", actor, { field: "archived", before: true, after: false }));
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

// ---- Contact relationships on a deal (per-deal role/influence/relationship,
// distinct from the Contact record's own company-level fields) ----
export function addDealContact(dealId, { contactId, role, influenceLevel, relationship } = {}, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal || !contactId) return null;
  if (!deal.additionalContactIds.includes(contactId) && deal.primaryContactId !== contactId) {
    deal.additionalContactIds = [...deal.additionalContactIds, contactId];
  }
  deal.contactRoles = [...deal.contactRoles.filter((r) => r.contactId !== contactId), { contactId, role: role || null, influenceLevel: influenceLevel || null, relationship: relationship || null }];
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

export function updateDealContactRole(dealId, contactId, changes, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  deal.contactRoles = deal.contactRoles.map((r) => (r.contactId === contactId ? { ...r, ...changes } : r));
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

export function removeDealContact(dealId, contactId, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  deal.additionalContactIds = deal.additionalContactIds.filter((cid) => cid !== contactId);
  deal.contactRoles = deal.contactRoles.filter((r) => r.contactId !== contactId);
  if (deal.primaryContactId === contactId) deal.primaryContactId = deal.additionalContactIds[0] || null;
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

export function setDealPrimaryContact(dealId, contactId, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  const prevPrimary = deal.primaryContactId;
  if (prevPrimary && prevPrimary !== contactId && !deal.additionalContactIds.includes(prevPrimary)) {
    deal.additionalContactIds = [...deal.additionalContactIds, prevPrimary];
  }
  deal.additionalContactIds = deal.additionalContactIds.filter((cid) => cid !== contactId);
  deal.primaryContactId = contactId;
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

// ---- Products / line items ----
export function setDealLineItems(dealId, lineItems, actor = "System") {
  return updateDealRecord(dealId, { lineItems }, actor);
}

// ---- Quotes: lightweight fixture previews only. This intentionally does
// NOT touch the separate, not-yet-finalized Quotes system in mockSalesData —
// per spec, the Deals Quotes tab shows preview data and must not link to or
// create real records in that unfinished route.
export function addDealQuotePreview(dealId, quote = {}, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  const nextVersion = (deal.quotes[deal.quotes.length - 1]?.version || 0) + 1;
  deal.quotes = [...deal.quotes, {
    _id: id(), quoteNumber: quote.quoteNumber || `Q-PREVIEW-${1000 + deal.quotes.length + 1}`,
    version: nextVersion, amount: Number(quote.amount) || deal.value, status: quote.status || "Draft",
    createdAt: new Date().toISOString(), expirationDate: quote.expirationDate || null,
  }];
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

// ---- Files ----
export function addDealFile(dealId, file, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  deal.files.push({ _id: id(), name: file.name, size: file.size, type: file.type, dataUrl: file.dataUrl || null, relatedActivityId: file.relatedActivityId || null, uploadedBy: actor, uploadedAt: new Date().toISOString() });
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

export function deleteDealFile(dealId, fileId, actor = "System") {
  const deal = findDeal(dealId);
  if (!deal) return null;
  deal.files = deal.files.filter((f) => f._id !== fileId);
  deal.updatedAt = new Date().toISOString();
  deal.updatedBy = actor;
  return deal;
}

function applyToDeals(dealIds, fn) {
  return dealIds.map((did) => findDeal(did)).filter(Boolean).map(fn);
}
export function bulkAssignDeals(dealIds, ownerId, actor) {
  return applyToDeals(dealIds, (d) => updateDealRecord(d._id, { ownerId }, actor));
}
export function bulkStageChangeDeals(dealIds, stage, actor) {
  return applyToDeals(dealIds, (d) => changeDealStage(d._id, { stage }, actor));
}
export function bulkTagDeals(dealIds, tag, actor) {
  return applyToDeals(dealIds, (d) => {
    if (!d.tags.includes(tag)) d.tags = [...d.tags, tag];
    d.updatedAt = new Date().toISOString();
    d.updatedBy = actor;
    return d;
  });
}
export function bulkArchiveDeals(dealIds, reason, actor) {
  return applyToDeals(dealIds, (d) => archiveDealRecord(d._id, reason, actor));
}
