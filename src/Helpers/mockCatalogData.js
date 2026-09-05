// In-memory mock Products & Services catalog — the single shared frontend
// source of truth for Products, Services, Packages and Add-ons. Same
// pattern as mockCrmData.js / mockActivitiesData.js: plain mutable arrays,
// business-logic functions instead of a real backend, everything reset on
// a full page reload.
import { faker } from "@faker-js/faker";
import { CRM_TEAM, findTeamMember } from "./mockUsersData";
import { deals } from "./mockCrmData";

const id = () => faker.database.mongodbObjectId();
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// Enumerations — the single source of truth the form, table filters and
// pricing display all read from.
// ---------------------------------------------------------------------------
export const CATALOG_TYPES = ["Product", "Service", "Package", "Add-on"];
export const CATALOG_STATUSES = ["Draft", "Active", "Inactive", "Archived"];
export const BILLING_MODELS = ["One Time", "Recurring", "Usage Based", "Custom Quote"];
export const BILLING_INTERVALS = ["Weekly", "Monthly", "Quarterly", "Semiannual", "Annual", "Custom"];
// Kept identical to Deals' own currency list (DEAL_CURRENCIES in
// dealsSlice.js) so a catalog price and a Deal line item never disagree on
// what currencies are even possible.
export const CATALOG_CURRENCIES = ["USD", "EUR", "GBP"];
export const CATALOG_CATEGORIES = [
  "Software Licenses", "Hardware", "Professional Services", "Managed Services", "Support & Maintenance",
  "Training", "Consulting", "Cloud Hosting", "Compliance", "Implementation",
];
export const TAX_CATEGORIES = ["Standard", "Reduced", "Zero-Rated", "Exempt", "Digital Services"];
export const USAGE_BILLING_UNITS = ["API Call", "GB Transferred", "Seat", "Transaction", "Minute", "Request"];
export const CATALOG_UNITS = ["Each", "Seat", "User", "License", "Hour", "GB", "Request", "Month"];
export const PRICE_TREATMENTS = ["Included in package price", "Priced separately", "Discounted when bundled"];
export const RENEWAL_BEHAVIORS = ["Auto-renews", "Requires manual renewal", "Converts to month-to-month"];
// Preview-only threshold for the "Draft older than N days" attention metric.
export const DRAFT_ATTENTION_DAYS = 30;

function catalogActivityEntry(type, actor, description, meta = {}) {
  return { _id: id(), type, actor: actor || "System", at: new Date().toISOString(), description, meta };
}
function catalogAuditEntry(action, actor, { field, before, after, reason } = {}) {
  return { _id: id(), action, actor: actor || "System", at: new Date().toISOString(), field: field || null, before: before ?? null, after: after ?? null, reason: reason || null };
}

function makeCatalogItem(overrides = {}) {
  const type = overrides.type || "Product";
  const billingModel = overrides.billingModel || "One Time";
  const owner = overrides.ownerId === null ? null : findTeamMember(overrides.ownerId) || faker.helpers.arrayElement(CRM_TEAM);
  const createdAt = overrides.createdAt || faker.date.past({ years: 1 }).toISOString();
  const base = {
    _id: id(),
    name: faker.commerce.productName(),
    sku: `SKU-${faker.string.alphanumeric(6).toUpperCase()}`,
    type,
    category: faker.helpers.arrayElement(CATALOG_CATEGORIES),
    shortDescription: faker.commerce.productDescription().slice(0, 80),
    description: faker.commerce.productDescription(),
    status: "Active",
    billingModel,
    billingInterval: billingModel === "Recurring" ? "Monthly" : null,
    unit: "Each",
    standardPrice: Number(faker.commerce.price({ min: 50, max: 5000 })),
    currency: "USD",
    alternativePrices: [],
    costPreview: null,
    taxCategory: "Standard",
    discountEligible: true,
    minQuantity: 1,
    maxQuantity: null,
    effectiveDate: daysAgo(30),
    expirationDate: null,
    ownerId: owner?.id || null,
    ownerName: owner?.name || null,
    tags: [],
    includedItems: [],
    optionalAddOnIds: [],
    compatibleParentIds: [],
    termsSummary: "",
    internalNotes: "",
    customerFacingDescription: "",
    usageConfig: null,
    recurringConfig: null,
    tieredPricing: [],
    promotionalPrice: null,
    promotionalUntil: null,
    upcomingPriceChange: null,
    archived: false,
    archiveReason: null,
    archivedAt: null,
    statusBeforeArchive: null,
    files: [],
    auditLog: [],
    createdBy: "System",
    updatedBy: "System",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
  base.activity = overrides.activity || [catalogActivityEntry("created", base.createdBy, "Catalog item created")];
  return base;
}

// ---------------------------------------------------------------------------
// Curated fixtures — one real, findable record for every scenario named in
// the /sales/products spec, rather than hoping a random faker roll produces
// one.
// ---------------------------------------------------------------------------

// 1. Active one-time Product
export const ACTIVE_ONE_TIME_PRODUCT = makeCatalogItem({
  name: "Onboarding Starter Kit", sku: "PRD-ONB-100", type: "Product", category: "Implementation",
  shortDescription: "One-time onboarding hardware and setup bundle.",
  description: "A physical starter kit shipped to new customers, including a configured access device and printed setup guide.",
  billingModel: "One Time", unit: "Each", standardPrice: 499, currency: "USD", tags: ["onboarding", "hardware"],
});

// 2. Active recurring Service
export const ACTIVE_RECURRING_SERVICE = makeCatalogItem({
  name: "Priority Support Plan", sku: "SVC-SUP-200", type: "Service", category: "Support & Maintenance",
  shortDescription: "Recurring priority support coverage with a 4-hour response SLA.",
  description: "Ongoing priority support with a dedicated queue and a guaranteed 4-hour first-response time during business hours.",
  billingModel: "Recurring", billingInterval: "Monthly", unit: "Month", standardPrice: 250, currency: "USD",
  recurringConfig: { setupFee: 0, minimumCommitmentMonths: 3, renewalBehavior: "Auto-renews" }, tags: ["support"],
});

// 3. Monthly managed Service
export const MONTHLY_MANAGED_SERVICE = makeCatalogItem({
  name: "Managed Cloud Operations", sku: "SVC-MCO-210", type: "Service", category: "Managed Services",
  shortDescription: "Fully managed monthly infrastructure operations service.",
  description: "A dedicated operations team monitors, patches and tunes the customer's cloud environment on an ongoing monthly basis.",
  billingModel: "Recurring", billingInterval: "Monthly", unit: "Month", standardPrice: 1800, currency: "USD",
  recurringConfig: { setupFee: 500, minimumCommitmentMonths: 6, renewalBehavior: "Auto-renews" }, tags: ["managed", "cloud"],
});

// 4. Annual subscription Service
export const ANNUAL_SUBSCRIPTION_SERVICE = makeCatalogItem({
  name: "Enterprise Platform Subscription", sku: "SVC-EPS-220", type: "Service", category: "Software Licenses",
  shortDescription: "Annual platform access subscription for enterprise accounts.",
  description: "Full platform access billed annually, including quarterly business reviews and a named customer success contact.",
  billingModel: "Recurring", billingInterval: "Annual", unit: "Year", standardPrice: 36000, currency: "USD",
  recurringConfig: { setupFee: 2500, minimumCommitmentMonths: 12, renewalBehavior: "Auto-renews" }, tags: ["subscription", "enterprise"],
});

// 5. Usage-based Service
export const USAGE_BASED_SERVICE = makeCatalogItem({
  name: "API Processing Service", sku: "SVC-API-230", type: "Service", category: "Cloud Hosting",
  shortDescription: "Usage-based API request processing.",
  description: "Billed by API request volume, with a base allotment included before overage charges apply.",
  billingModel: "Usage Based", billingInterval: null, unit: "Request", standardPrice: null, currency: "USD",
  usageConfig: { billingUnit: "API Call", includedUsage: 100000, unitPrice: 0.001, overagePrice: 0.0015, minimumUsage: 0 },
  tags: ["api", "usage"],
});

// 6. Package containing multiple items (built after items 1-5 exist so it
// can reference their real ids)
export const STARTER_BUNDLE_PACKAGE = makeCatalogItem({
  name: "Starter Success Bundle", sku: "PKG-SSB-300", type: "Package", category: "Implementation",
  shortDescription: "Onboarding kit plus a year of priority support, bundled.",
  description: "Bundles the onboarding starter kit with a discounted first year of priority support for new customers.",
  billingModel: "One Time", unit: "Each", standardPrice: 2400, currency: "USD",
  includedItems: [
    { itemId: ACTIVE_ONE_TIME_PRODUCT._id, quantity: 1, included: true, priceTreatment: "Included in package price", order: 1 },
    { itemId: ACTIVE_RECURRING_SERVICE._id, quantity: 12, included: true, priceTreatment: "Discounted when bundled", order: 2 },
  ],
  tags: ["bundle"],
});

// 7. Optional Add-on (compatible with the recurring support plan)
export const PRIORITY_ESCALATION_ADDON = makeCatalogItem({
  name: "Priority Escalation Line", sku: "ADD-PEL-400", type: "Add-on", category: "Support & Maintenance",
  shortDescription: "Optional 1-hour escalation SLA add-on for support plans.",
  description: "Adds a dedicated 1-hour escalation SLA on top of an existing support plan for critical incidents.",
  billingModel: "Recurring", billingInterval: "Monthly", unit: "Month", standardPrice: 99, currency: "USD",
  compatibleParentIds: [ACTIVE_RECURRING_SERVICE._id, MONTHLY_MANAGED_SERVICE._id], tags: ["add-on", "support"],
});

// 8. Product with multiple currencies
export const MULTI_CURRENCY_PRODUCT = makeCatalogItem({
  name: "Global License Pack", sku: "PRD-GLP-500", type: "Product", category: "Software Licenses",
  shortDescription: "License pack priced separately for each major region.",
  description: "A software license pack sold with region-specific list pricing across USD, EUR and GBP.",
  billingModel: "One Time", unit: "License", standardPrice: 1200, currency: "USD",
  alternativePrices: [{ currency: "EUR", price: 1100 }, { currency: "GBP", price: 950 }], tags: ["licensing"],
});

// 9. Product with tiered pricing preview
export const TIERED_PRICING_PRODUCT = makeCatalogItem({
  name: "Volume Seat License", sku: "PRD-VSL-510", type: "Product", category: "Software Licenses",
  shortDescription: "Per-seat license with volume pricing tiers.",
  description: "Per-seat licensing with a standard list price and discounted pricing at higher seat-count tiers.",
  billingModel: "One Time", unit: "Seat", standardPrice: 40, currency: "USD",
  tieredPricing: [
    { minQty: 1, maxQty: 24, price: 40 },
    { minQty: 25, maxQty: 99, price: 32 },
    { minQty: 100, maxQty: null, price: 25 },
  ],
  minQuantity: 1, tags: ["seats", "volume"],
});

// 10. Product requiring a custom Quote
export const CUSTOM_QUOTE_PRODUCT = makeCatalogItem({
  name: "Enterprise Custom Integration", sku: "PRD-ECI-520", type: "Product", category: "Consulting",
  shortDescription: "Bespoke integration work — pricing depends on scope.",
  description: "A fully custom integration engagement scoped per customer; pricing is always quoted individually.",
  billingModel: "Custom Quote", unit: "Each", standardPrice: null, currency: "USD",
  termsSummary: "Requires a scoping call before a Quote can be issued.", tags: ["custom", "integration"],
});

// 11. Product with a promotional price
export const PROMOTIONAL_PRICE_PRODUCT = makeCatalogItem({
  name: "Analytics Add-on Pack", sku: "PRD-AAP-530", type: "Product", category: "Software Licenses",
  shortDescription: "Analytics module, currently on a limited-time promotional price.",
  description: "Adds the advanced analytics module to an existing platform subscription.",
  billingModel: "One Time", unit: "Each", standardPrice: 800, currency: "USD",
  promotionalPrice: 599, promotionalUntil: daysFromNow(14), tags: ["promo", "analytics"],
});

// 12. Draft Product (deliberately older than DRAFT_ATTENTION_DAYS, so it
// shows up under "Items needing attention")
export const DRAFT_PRODUCT = makeCatalogItem({
  name: "Field Service Mobile Kit", sku: "PRD-FSM-540", type: "Product", category: "Hardware",
  shortDescription: "Not yet finalized — pricing and description still in review.",
  description: "", status: "Draft", billingModel: "One Time", unit: "Each", standardPrice: null, currency: "USD",
  createdAt: daysAgo(DRAFT_ATTENTION_DAYS + 10), updatedAt: daysAgo(DRAFT_ATTENTION_DAYS + 10), tags: [],
});

// 13. Inactive Product
export const INACTIVE_PRODUCT = makeCatalogItem({
  name: "Legacy Reporting Module", sku: "PRD-LRM-550", type: "Product", category: "Software Licenses",
  shortDescription: "Superseded by the current analytics module — no longer sold.",
  description: "The previous-generation reporting module, kept inactive for existing reference only.",
  status: "Inactive", billingModel: "One Time", unit: "Each", standardPrice: 300, currency: "USD", tags: ["legacy"],
});

// 14. Archived Product
export const ARCHIVED_PRODUCT = makeCatalogItem({
  name: "Discontinued Hardware Dongle", sku: "PRD-DHD-560", type: "Product", category: "Hardware",
  shortDescription: "Discontinued — archived from the active catalog.",
  description: "A hardware security dongle discontinued after being replaced by software-based licensing.",
  status: "Archived", archived: true, archiveReason: "Discontinued by the manufacturer", archivedAt: daysAgo(60),
  statusBeforeArchive: "Inactive", billingModel: "One Time", unit: "Each", standardPrice: 150, currency: "USD", tags: ["discontinued"],
});

// 15. Product currently used by Deals — the real productId gets wired onto
// live Deal line items in the post-wire step below.
export const DEAL_LINKED_PRODUCT = makeCatalogItem({
  name: "Professional Plan — 50 Seats", sku: "PRD-PRO-570", type: "Product", category: "Software Licenses",
  shortDescription: "Professional-tier platform license, 50-seat block.",
  description: "The Professional plan, sold in blocks of 50 seats, already referenced by existing Deal line items.",
  billingModel: "Recurring", billingInterval: "Annual", unit: "Seat", standardPrice: 60, currency: "USD", tags: ["seats"],
});

// 16. Product with missing pricing
export const MISSING_PRICE_PRODUCT = makeCatalogItem({
  name: "Partner Referral Bundle", sku: "PRD-PRB-580", type: "Product", category: "Consulting",
  shortDescription: "Pricing not yet configured for this partner-only bundle.",
  description: "Reserved for a partner program still being finalized — no price has been set yet.",
  billingModel: "One Time", unit: "Each", standardPrice: null, currency: "USD", tags: ["partner"],
});

// 17. Product with an upcoming price change
export const UPCOMING_PRICE_CHANGE_PRODUCT = makeCatalogItem({
  name: "Standard Support Plan", sku: "SVC-SSP-590", type: "Service", category: "Support & Maintenance",
  shortDescription: "Standard support coverage — a list price increase is scheduled.",
  description: "Baseline support coverage with next-business-day response.",
  billingModel: "Recurring", billingInterval: "Monthly", unit: "Month", standardPrice: 120, currency: "USD",
  upcomingPriceChange: { newPrice: 140, effectiveDate: daysFromNow(30) },
  recurringConfig: { setupFee: 0, minimumCommitmentMonths: 1, renewalBehavior: "Auto-renews" }, tags: ["support"],
});

const CURATED_ITEMS = [
  ACTIVE_ONE_TIME_PRODUCT, ACTIVE_RECURRING_SERVICE, MONTHLY_MANAGED_SERVICE, ANNUAL_SUBSCRIPTION_SERVICE,
  USAGE_BASED_SERVICE, STARTER_BUNDLE_PACKAGE, PRIORITY_ESCALATION_ADDON, MULTI_CURRENCY_PRODUCT,
  TIERED_PRICING_PRODUCT, CUSTOM_QUOTE_PRODUCT, PROMOTIONAL_PRICE_PRODUCT, DRAFT_PRODUCT, INACTIVE_PRODUCT,
  ARCHIVED_PRODUCT, DEAL_LINKED_PRODUCT, MISSING_PRICE_PRODUCT, UPCOMING_PRICE_CHANGE_PRODUCT,
];

// A modest set of additional random items so the catalog reads as a real
// directory rather than exactly 17 rows.
const RANDOM_ITEMS = faker.helpers.multiple(
  () => makeCatalogItem({ type: faker.helpers.arrayElement(["Product", "Service"]) }),
  { count: 9 }
);

export const catalogItems = [...CURATED_ITEMS, ...RANDOM_ITEMS];

// ---------------------------------------------------------------------------
// Consolidation step — the Deals frontend already had hard-coded line-item
// fixtures (named products with no real catalog behind them). Rather than
// touching mockCrmData.js's deal fixtures directly, retroactively link any
// existing Deal line item whose name matches a real catalog item's name —
// this is the actual "consolidate those fixtures into the shared catalog"
// step: no separate hard-coded product collection survives inside Deals.
// ---------------------------------------------------------------------------
{
  const byName = new Map(catalogItems.map((c) => [c.name.trim().toLowerCase(), c]));
  for (const deal of deals) {
    for (const item of deal.lineItems || []) {
      if (item.productId) continue;
      const match = byName.get((item.name || "").trim().toLowerCase());
      if (match) item.productId = match._id;
    }
  }
  // Guarantee the "Product currently used by Deals" fixture actually has at
  // least one real linked Deal, rather than hoping a name coincidentally matched.
  const alreadyLinked = deals.some((d) => (d.lineItems || []).some((li) => li.productId === DEAL_LINKED_PRODUCT._id));
  if (!alreadyLinked) {
    const openDeal = deals.find((d) => d.status === "Open" && (d.lineItems || []).length > 0) || deals.find((d) => d.status === "Open");
    if (openDeal) {
      openDeal.lineItems = openDeal.lineItems || [];
      openDeal.lineItems.push({
        _id: id(), productId: DEAL_LINKED_PRODUCT._id, name: DEAL_LINKED_PRODUCT.name, description: DEAL_LINKED_PRODUCT.shortDescription,
        quantity: 1, unitPrice: DEAL_LINKED_PRODUCT.standardPrice, discountPercent: 0, billingFrequency: "Annually",
        lineTotal: DEAL_LINKED_PRODUCT.standardPrice,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Finders / mutators
// ---------------------------------------------------------------------------
export function findCatalogItem(itemId) {
  return catalogItems.find((c) => c._id === itemId);
}

export function activeDealsUsingItem(itemId) {
  return deals.filter((d) => d.status === "Open" && (d.lineItems || []).some((li) => li.productId === itemId));
}

export function allDealsUsingItem(itemId) {
  return deals.filter((d) => (d.lineItems || []).some((li) => li.productId === itemId));
}

export function isDraftOlderThanPreviewWindow(item) {
  if (item.status !== "Draft") return false;
  return Date.now() - new Date(item.createdAt).getTime() > DRAFT_ATTENTION_DAYS * 24 * 60 * 60 * 1000;
}

export function isPricingExpired(item) {
  return !!item.expirationDate && new Date(item.expirationDate) < new Date();
}

export function isMissingPrice(item) {
  if (item.billingModel === "Custom Quote" || item.billingModel === "Usage Based") return false;
  return item.standardPrice === null || item.standardPrice === undefined;
}

export function needsAttentionReasons(item) {
  const reasons = [];
  if (isMissingPrice(item)) reasons.push("Missing price");
  if (!item.category) reasons.push("Missing category");
  if (isPricingExpired(item)) reasons.push("Expired pricing");
  if (isDraftOlderThanPreviewWindow(item)) reasons.push(`Draft for over ${DRAFT_ATTENTION_DAYS} days`);
  return reasons;
}

export function computeMarginPreview(price, cost) {
  if (price === null || price === undefined || cost === null || cost === undefined) return null;
  const marginAmount = price - cost;
  const marginPercent = price > 0 ? (marginAmount / price) * 100 : 0;
  return { marginAmount, marginPercent };
}

// ---------------------------------------------------------------------------
// Validation — mirrors the exact rules named in the spec. Returns
// { errors, warnings } — a duplicate SKU is a warning, never a blocking error.
// ---------------------------------------------------------------------------
export function wouldCreateCircularPackage(itemId, includedItemIds, allItems = catalogItems) {
  if (!itemId) return false; // a brand-new (not-yet-saved) item can't yet be referenced by anything else
  const visited = new Set();
  const stack = [...includedItemIds];
  while (stack.length) {
    const currentId = stack.pop();
    if (currentId === itemId) return true;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const current = allItems.find((c) => c._id === currentId);
    if (current?.type === "Package") {
      for (const included of current.includedItems || []) stack.push(included.itemId);
    }
  }
  return false;
}

export function validateCatalogPayload(payload, { excludeId, allItems = catalogItems } = {}) {
  const errors = {};
  const warnings = {};

  if (!payload.name?.trim()) errors.name = "Name is required";
  if (!CATALOG_TYPES.includes(payload.type)) errors.type = "Select a valid item type";

  const needsSku = payload.type === "Product" || payload.type === "Service";
  if (needsSku && !payload.sku?.trim()) errors.sku = "SKU or service code is required";
  if (payload.sku?.trim()) {
    const dup = allItems.find((c) => c._id !== excludeId && c.sku && c.sku.trim().toLowerCase() === payload.sku.trim().toLowerCase());
    if (dup) warnings.sku = `"${payload.sku}" is already used by "${dup.name}" — SKUs are usually unique.`;
  }

  if (payload.category && !CATALOG_CATEGORIES.includes(payload.category)) errors.category = "Select a valid category";
  if (payload.currency && !CATALOG_CURRENCIES.includes(payload.currency)) errors.currency = "Select a valid currency";

  if (payload.standardPrice !== null && payload.standardPrice !== undefined && payload.standardPrice !== "") {
    if (Number.isNaN(Number(payload.standardPrice)) || Number(payload.standardPrice) < 0) errors.standardPrice = "Price must be a non-negative number";
  }

  const min = payload.minQuantity === "" || payload.minQuantity === undefined ? null : Number(payload.minQuantity);
  const max = payload.maxQuantity === "" || payload.maxQuantity === undefined || payload.maxQuantity === null ? null : Number(payload.maxQuantity);
  if (min !== null && (Number.isNaN(min) || min < 0)) errors.minQuantity = "Minimum quantity must be a non-negative number";
  if (max !== null && (Number.isNaN(max) || max < 0)) errors.maxQuantity = "Maximum quantity must be a non-negative number";
  if (min !== null && max !== null && min > max) errors.maxQuantity = "Maximum quantity must be at least the minimum quantity";

  if (payload.effectiveDate && payload.expirationDate && new Date(payload.effectiveDate) >= new Date(payload.expirationDate)) {
    errors.expirationDate = "Expiration date must be after the effective date";
  }

  if (payload.billingModel === "Recurring" && !payload.billingInterval) errors.billingInterval = "Billing interval is required for recurring items";
  if (payload.billingModel === "Usage Based" && !payload.usageConfig?.billingUnit) errors.usageBillingUnit = "Billing unit is required for usage-based items";

  if (payload.type === "Package") {
    const included = payload.includedItems || [];
    if (included.length === 0) errors.includedItems = "A Package must contain at least one item";
    if (excludeId && included.some((i) => i.itemId === excludeId)) errors.includedItems = "A Package cannot include itself";
    else if (excludeId && wouldCreateCircularPackage(excludeId, included.map((i) => i.itemId), allItems)) {
      errors.includedItems = "This would create a circular Package relationship";
    }
  }

  if (payload.type === "Add-on") {
    const parents = payload.compatibleParentIds || [];
    const invalidParent = parents.some((pid) => pid === excludeId || !allItems.find((c) => c._id === pid));
    if (invalidParent) errors.compatibleParentIds = "Select valid parent Products, Services or Packages";
  }

  return { errors, warnings };
}

export function createCatalogItem(payload, actor = "System") {
  const item = makeCatalogItem({ ...payload, createdBy: actor, updatedBy: actor, createdAt: new Date().toISOString() });
  catalogItems.unshift(item);
  return item;
}

const AUDIT_TRACKED_FIELDS = ["status", "standardPrice", "currency", "billingModel", "billingInterval", "category", "ownerId"];

export function updateCatalogItem(itemId, changes, actor = "System") {
  const item = findCatalogItem(itemId);
  if (!item) return null;

  if (changes.ownerId !== undefined && changes.ownerId !== item.ownerId) {
    const newOwner = findTeamMember(changes.ownerId);
    changes.ownerName = newOwner?.name || null;
  }
  if (changes.status && changes.status !== item.status) {
    item.activity.push(catalogActivityEntry("status_changed", actor, `Status changed from ${item.status} to ${changes.status}`));
  }
  if (changes.standardPrice !== undefined && Number(changes.standardPrice) !== item.standardPrice) {
    item.activity.push(catalogActivityEntry("pricing_changed", actor, `Standard price changed from ${item.standardPrice ?? "unset"} to ${changes.standardPrice ?? "unset"}`));
  }
  if (changes.includedItems && JSON.stringify(changes.includedItems) !== JSON.stringify(item.includedItems)) {
    item.activity.push(catalogActivityEntry("package_changed", actor, "Package contents changed"));
  }
  for (const field of AUDIT_TRACKED_FIELDS) {
    if (field in changes && changes[field] !== item[field]) {
      item.auditLog.push(catalogAuditEntry("update", actor, { field, before: item[field] ?? null, after: changes[field] ?? null, reason: changes.reason || null }));
    }
  }

  Object.assign(item, changes);
  item.updatedAt = new Date().toISOString();
  item.updatedBy = actor;
  return item;
}

export function archiveCatalogItem(itemId, reason, actor = "System") {
  const item = findCatalogItem(itemId);
  if (!item) return null;
  item.statusBeforeArchive = item.status;
  item.status = "Archived";
  item.archived = true;
  item.archiveReason = reason;
  item.archivedAt = new Date().toISOString();
  item.activity.push(catalogActivityEntry("archived", actor, `Archived: ${reason}`));
  item.auditLog.push(catalogAuditEntry("archive", actor, { field: "status", before: item.statusBeforeArchive, after: "Archived", reason }));
  item.updatedAt = new Date().toISOString();
  item.updatedBy = actor;
  return item;
}

export function restoreCatalogItem(itemId, actor = "System") {
  const item = findCatalogItem(itemId);
  if (!item) return null;
  const restoredStatus = item.statusBeforeArchive || "Active";
  item.status = restoredStatus;
  item.archived = false;
  item.archiveReason = null;
  item.archivedAt = null;
  item.statusBeforeArchive = null;
  item.activity.push(catalogActivityEntry("restored", actor, `Restored to ${restoredStatus}`));
  item.auditLog.push(catalogAuditEntry("restore", actor, { field: "status", before: "Archived", after: restoredStatus }));
  item.updatedAt = new Date().toISOString();
  item.updatedBy = actor;
  return item;
}

// A pure preview — never touches catalogItems until the caller explicitly
// saves it via createCatalogItem, matching "open the new-item form before
// confirmation" / "do not instantly duplicate without review".
export function buildDuplicatePreview(itemId) {
  const source = findCatalogItem(itemId);
  if (!source) return null;
  let suggestedSku = `${source.sku || "SKU"}-COPY`;
  let n = 2;
  const skus = new Set(catalogItems.map((c) => c.sku));
  while (skus.has(suggestedSku)) { suggestedSku = `${source.sku || "SKU"}-COPY-${n}`; n += 1; }
  return {
    ...source,
    _id: undefined,
    name: `${source.name} (Copy)`,
    sku: suggestedSku,
    status: "Draft",
    archived: false,
    archiveReason: null,
    archivedAt: null,
    statusBeforeArchive: null,
    activity: [],
    auditLog: [],
    files: [],
    createdAt: undefined,
    updatedAt: undefined,
  };
}

export function bulkAssignOwner(itemIds, ownerId, actor = "System") {
  return itemIds.map((id_) => updateCatalogItem(id_, { ownerId }, actor)).filter(Boolean);
}
export function bulkChangeCategory(itemIds, category, actor = "System") {
  return itemIds.map((id_) => updateCatalogItem(id_, { category }, actor)).filter(Boolean);
}
export function bulkChangeStatus(itemIds, status, actor = "System") {
  return itemIds.map((id_) => updateCatalogItem(id_, { status }, actor)).filter(Boolean);
}
export function bulkTag(itemIds, tag, actor = "System") {
  return itemIds.map((id_) => {
    const item = findCatalogItem(id_);
    if (!item) return null;
    return updateCatalogItem(id_, { tags: [...new Set([...(item.tags || []), tag])] }, actor);
  }).filter(Boolean);
}
export function bulkArchive(itemIds, reason, actor = "System") {
  return itemIds.map((id_) => archiveCatalogItem(id_, reason, actor)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Query — filter/sort/paginate client-side over the full catalog, same
// pattern as queryCompaniesLocal in mockCrmData.js.
// ---------------------------------------------------------------------------
export function queryCatalogLocal(list, params = {}) {
  const {
    search = "", type, category, status, billingModel, billingInterval, currency,
    priceMin, priceMax, discountEligible, taxCategory, ownerId, tag,
    usedInActiveDeals, missingPrice, expiredPricing, needsAttention, archived = "false",
    sort = "updatedAt", order = "desc", page = 1, pageSize = 20,
  } = params;

  // A bookmarked/shared "?status=Archived" link should still work sensibly
  // (rather than silently returning nothing) even though the ordinary
  // Status filter no longer offers "Archived" as a choice — that's the
  // dedicated Archived toggle's job.
  const effectiveArchived = status === "Archived" ? "true" : archived;

  let result = list.filter((c) => {
    if (effectiveArchived === "true" && !c.archived) return false;
    if (effectiveArchived !== "true" && c.archived) return false;
    if (type && c.type !== type) return false;
    if (category && c.category !== category) return false;
    if (status && c.status !== status) return false;
    if (billingModel && c.billingModel !== billingModel) return false;
    if (billingInterval && c.billingInterval !== billingInterval) return false;
    if (currency && c.currency !== currency) return false;
    if (priceMin !== undefined && priceMin !== "" && (c.standardPrice === null || c.standardPrice < Number(priceMin))) return false;
    if (priceMax !== undefined && priceMax !== "" && (c.standardPrice === null || c.standardPrice > Number(priceMax))) return false;
    if (discountEligible === "true" && !c.discountEligible) return false;
    if (discountEligible === "false" && c.discountEligible) return false;
    if (taxCategory && c.taxCategory !== taxCategory) return false;
    if (ownerId && c.ownerId !== ownerId) return false;
    if (tag && !(c.tags || []).includes(tag)) return false;
    if (usedInActiveDeals === "true" && activeDealsUsingItem(c._id).length === 0) return false;
    if (missingPrice === "true" && !isMissingPrice(c)) return false;
    if (expiredPricing === "true" && !isPricingExpired(c)) return false;
    if (needsAttention === "true" && needsAttentionReasons(c).length === 0) return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = `${c.name} ${c.sku} ${c.category} ${c.shortDescription}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const summary = {
    total: result.length,
    activeItems: result.filter((c) => c.status === "Active").length,
    products: result.filter((c) => c.type === "Product").length,
    services: result.filter((c) => c.type === "Service").length,
    recurringItems: result.filter((c) => c.billingModel === "Recurring").length,
    customQuoteItems: result.filter((c) => c.billingModel === "Custom Quote").length,
    needsAttention: result.filter((c) => needsAttentionReasons(c).length > 0).length,
  };

  result = [...result].sort((a, b) => {
    const dir = order === "asc" ? 1 : -1;
    let av = a[sort];
    let bv = b[sort];
    if (sort === "activeDeals") { av = activeDealsUsingItem(a._id).length; bv = activeDealsUsingItem(b._id).length; }
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

  return { items: pageItems, total, page: pageNum, pageSize: size, summary };
}
