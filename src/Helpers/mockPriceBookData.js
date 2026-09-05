// In-memory mock Price Books module — a controlled pricing workspace layered
// on top of the shared Products & Services catalog (mockCatalogData.js).
// Same pattern as every other mock*Data.js module: plain mutable arrays and
// business-logic functions instead of a real backend, reset on full reload.
// A Price Book never stores a copy of a catalog item — every pricing entry
// only keeps a catalogItemId and looks the record up live.
import { faker } from "@faker-js/faker";
import { CRM_TEAM, findTeamMember } from "./mockUsersData";
import {
  catalogItems, findCatalogItem, BILLING_INTERVALS,
  ACTIVE_ONE_TIME_PRODUCT, ACTIVE_RECURRING_SERVICE, MONTHLY_MANAGED_SERVICE,
  TIERED_PRICING_PRODUCT, PROMOTIONAL_PRICE_PRODUCT,
} from "./mockCatalogData";
import { companies, deals, DEAL_TYPES } from "./mockCrmData";

const id = () => faker.database.mongodbObjectId();
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------
// "Scheduled" and "Expired" are always DERIVED from dates (see
// getEffectiveStatus) — a user can only ever choose one of SETTABLE_STATUSES.
export const PRICE_BOOK_STATUSES = ["Draft", "Scheduled", "Active", "Expired", "Inactive", "Archived"];
export const SETTABLE_STATUSES = ["Draft", "Active", "Inactive", "Archived"];
// A superset of the catalog's own currencies — Price Books need
// country-specific currencies (INR, IDR) that individual catalog items
// aren't necessarily priced in directly.
export const PRICE_BOOK_CURRENCIES = ["USD", "EUR", "GBP", "INR", "IDR"];
export const MARKETS = ["Global", "India", "Indonesia", "United States", "United Kingdom", "Germany", "Australia", "Canada"];
export const CUSTOMER_SEGMENTS = ["Enterprise", "Mid-Market", "Small Business", "Startup", "Partner"];
export const SALES_CHANNELS = ["Direct", "Partner", "Online", "Reseller"];
export const CONTRACT_TYPES = ["Standard", "Custom", "Framework Agreement", "Government"];
export const PRICE_BOOK_DEAL_TYPES = DEAL_TYPES;
export const ADJUSTMENT_TYPES = [
  "Fixed Price", "Percentage Increase", "Percentage Decrease", "Fixed Increase", "Fixed Decrease", "Quantity Tier", "Custom Quote",
];
export const MIN_PRIORITY = 0;
export const MAX_PRIORITY = 100;
export const EXPIRING_SOON_DAYS = 30;

// Priority resolution order when multiple Price Books could apply to the
// same context — displayed verbatim in the UI so the rule is never a secret.
export const PRIORITY_RESOLUTION_ORDER = [
  "Company-specific", "Contract-specific", "Customer-segment-specific", "Market-specific", "Channel-specific", "Standard",
];
export const SPECIFICITY_LABELS = {
  6: "Company-specific", 5: "Contract-specific", 4: "Customer-segment-specific", 3: "Market-specific", 2: "Channel-specific", 1: "Standard",
};

function pbActivityEntry(type, actor, description, meta = {}) {
  return { _id: id(), type, actor: actor || "System", at: new Date().toISOString(), description, meta };
}
function pbAuditEntry(action, actor, { field, before, after, reason } = {}) {
  return { _id: id(), action, actor: actor || "System", at: new Date().toISOString(), field: field || null, before: before ?? null, after: after ?? null, reason: reason || null };
}

function makePricingEntry(overrides = {}) {
  return {
    _id: id(),
    catalogItemId: overrides.catalogItemId,
    currency: overrides.currency || "USD",
    adjustmentType: overrides.adjustmentType || "Fixed Price",
    adjustmentValue: overrides.adjustmentValue ?? null,
    tiers: overrides.tiers || [],
    minQuantity: overrides.minQuantity ?? 1,
    maxQuantity: overrides.maxQuantity ?? null,
    billingInterval: overrides.billingInterval ?? null,
    effectiveDate: overrides.effectiveDate ?? null,
    expirationDate: overrides.expirationDate ?? null,
    notes: overrides.notes || "",
    enabled: overrides.enabled ?? true,
    ...overrides,
  };
}

function makePriceBook(overrides = {}) {
  const owner = overrides.ownerId === null ? null : findTeamMember(overrides.ownerId) || faker.helpers.arrayElement(CRM_TEAM);
  const createdAt = overrides.createdAt || faker.date.past({ years: 1 }).toISOString();
  const base = {
    _id: id(),
    name: `${faker.commerce.productAdjective()} Price Book`,
    code: `PB-${faker.string.alphanumeric(6).toUpperCase()}`,
    description: "",
    status: "Active",
    priority: 10,
    currency: "USD",
    market: "Global",
    customerSegment: null,
    companyIds: [],
    salesChannel: null,
    categories: [],
    dealTypes: [],
    contractTypes: [],
    effectiveDate: daysAgo(30),
    expirationDate: null,
    ownerId: owner?.id || null,
    ownerName: owner?.name || null,
    tags: [],
    items: [],
    archived: false,
    archiveReason: null,
    archivedAt: null,
    statusBeforeArchive: null,
    activity: [],
    auditLog: [],
    createdBy: "System",
    updatedBy: "System",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
  base.items = (overrides.items || []).map((i) => (i._id ? i : makePricingEntry(i)));
  base.activity = overrides.activity || [pbActivityEntry("created", base.createdBy, "Price Book created")];
  return base;
}

// ---------------------------------------------------------------------------
// Curated fixtures — one real, findable Price Book for every scenario named
// in the /sales/price-books spec.
// ---------------------------------------------------------------------------

// 1. Standard Price Book — broad, lowest priority, the fallback baseline.
export const STANDARD_PRICE_BOOK = makePriceBook({
  name: "Standard Price Book", code: "PB-STANDARD",
  description: "Default list pricing applied globally whenever no more specific Price Book matches.",
  status: "Active", priority: 0, currency: "USD", market: "Global",
  effectiveDate: daysAgo(180), tags: ["default"],
  items: [
    makePricingEntry({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: ACTIVE_ONE_TIME_PRODUCT.standardPrice }),
    makePricingEntry({ catalogItemId: ACTIVE_RECURRING_SERVICE._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: ACTIVE_RECURRING_SERVICE.standardPrice, billingInterval: "Monthly" }),
    makePricingEntry({ catalogItemId: MONTHLY_MANAGED_SERVICE._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: MONTHLY_MANAGED_SERVICE.standardPrice, billingInterval: "Monthly" }),
  ],
});

// 2. India Price Book — market + currency specific, own INR list prices
// (never derived from the USD base — this tool doesn't convert currencies).
export const INDIA_PRICE_BOOK = makePriceBook({
  name: "India Price Book", code: "PB-INDIA",
  description: "Market-specific INR list pricing for customers based in India.",
  status: "Active", priority: 20, currency: "INR", market: "India",
  effectiveDate: daysAgo(90), tags: ["india", "market"],
  items: [
    makePricingEntry({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "INR", adjustmentType: "Fixed Price", adjustmentValue: 29900 }),
    makePricingEntry({ catalogItemId: ACTIVE_RECURRING_SERVICE._id, currency: "INR", adjustmentType: "Fixed Price", adjustmentValue: 14900, billingInterval: "Monthly" }),
  ],
});

// 3. Indonesia Price Book
export const INDONESIA_PRICE_BOOK = makePriceBook({
  name: "Indonesia Price Book", code: "PB-INDONESIA",
  description: "Market-specific IDR list pricing for customers based in Indonesia.",
  status: "Active", priority: 20, currency: "IDR", market: "Indonesia",
  effectiveDate: daysAgo(75), tags: ["indonesia", "market"],
  items: [
    makePricingEntry({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "IDR", adjustmentType: "Fixed Price", adjustmentValue: 7900000 }),
    makePricingEntry({ catalogItemId: ACTIVE_RECURRING_SERVICE._id, currency: "IDR", adjustmentType: "Fixed Price", adjustmentValue: 3900000, billingInterval: "Monthly" }),
  ],
});

// 4. USD International Price Book — same broad scope as Standard but a
// distinct, higher priority so the two demonstrate priority-based
// resolution when specificity ties (as opposed to fixture #16 below, which
// deliberately leaves NO tiebreaker at all).
export const USD_INTERNATIONAL_PRICE_BOOK = makePriceBook({
  name: "USD International Price Book", code: "PB-USD-INTL",
  description: "USD pricing with an international-support surcharge for customers outside domestic markets.",
  status: "Active", priority: 5, currency: "USD", market: "Global",
  effectiveDate: daysAgo(120), tags: ["international"],
  items: [
    makePricingEntry({ catalogItemId: ACTIVE_RECURRING_SERVICE._id, currency: "USD", adjustmentType: "Percentage Increase", adjustmentValue: 10, billingInterval: "Monthly" }),
  ],
});

// 5. Enterprise Customer Price Book — customer-segment specific.
export const ENTERPRISE_CUSTOMER_PRICE_BOOK = makePriceBook({
  name: "Enterprise Customer Price Book", code: "PB-ENTERPRISE",
  description: "Volume-favorable pricing for Enterprise-segment customers.",
  status: "Active", priority: 30, currency: "USD", customerSegment: "Enterprise", market: "Global",
  effectiveDate: daysAgo(60), tags: ["enterprise"],
  items: [
    makePricingEntry({ catalogItemId: TIERED_PRICING_PRODUCT._id, currency: "USD", adjustmentType: "Percentage Decrease", adjustmentValue: 15 }),
    makePricingEntry({ catalogItemId: MONTHLY_MANAGED_SERVICE._id, currency: "USD", adjustmentType: "Percentage Decrease", adjustmentValue: 10, billingInterval: "Monthly" }),
  ],
});

// 6. Small Business Price Book
export const SMALL_BUSINESS_PRICE_BOOK = makePriceBook({
  name: "Small Business Price Book", code: "PB-SMB",
  description: "A modest discount for Small Business-segment customers.",
  status: "Active", priority: 15, currency: "USD", customerSegment: "Small Business", market: "Global",
  effectiveDate: daysAgo(45), tags: ["smb"],
  items: [
    makePricingEntry({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Decrease", adjustmentValue: 50 }),
  ],
});

// 7. Partner Price Book — sales-channel specific.
export const PARTNER_PRICE_BOOK = makePriceBook({
  name: "Partner Price Book", code: "PB-PARTNER",
  description: "Reseller and Partner-channel wholesale pricing.",
  status: "Active", priority: 25, currency: "USD", salesChannel: "Partner", market: "Global",
  effectiveDate: daysAgo(50), tags: ["partner", "channel"],
  items: [
    makePricingEntry({ catalogItemId: ACTIVE_RECURRING_SERVICE._id, currency: "USD", adjustmentType: "Percentage Decrease", adjustmentValue: 20, billingInterval: "Monthly" }),
  ],
});

// 8. Company-specific Price Book — the narrowest, highest-specificity scope.
const COMPANY_SPECIFIC_TARGET = companies.find((c) => c.accountType === "Customer") || companies[0];
export const COMPANY_SPECIFIC_PRICE_BOOK = makePriceBook({
  name: `${COMPANY_SPECIFIC_TARGET.name} Price Book`, code: "PB-COMPANY-001",
  description: `A negotiated Price Book specific to ${COMPANY_SPECIFIC_TARGET.name}.`,
  status: "Active", priority: 40, currency: "USD", companyIds: [COMPANY_SPECIFIC_TARGET._id], market: "Global",
  effectiveDate: daysAgo(30), tags: ["negotiated"],
  items: [
    makePricingEntry({ catalogItemId: ACTIVE_RECURRING_SERVICE._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: 199, billingInterval: "Monthly" }),
  ],
});

// 9. Promotional Price Book — time-limited window.
export const PROMOTIONAL_PRICE_BOOK = makePriceBook({
  name: "Promotional Price Book", code: "PB-PROMO-Q3",
  description: "A limited-time promotional discount, expiring soon.",
  status: "Active", priority: 35, currency: "USD", market: "Global",
  effectiveDate: daysAgo(5), expirationDate: daysFromNow(14), tags: ["promotional"],
  items: [
    makePricingEntry({ catalogItemId: PROMOTIONAL_PRICE_PRODUCT._id, currency: "USD", adjustmentType: "Percentage Decrease", adjustmentValue: 25 }),
  ],
});

// 10. Quantity-tier Price Book
export const QUANTITY_TIER_PRICE_BOOK = makePriceBook({
  name: "Volume Tier Price Book", code: "PB-VOLUME",
  description: "Quantity-tiered pricing for volume seat purchases.",
  status: "Active", priority: 10, currency: "USD", market: "Global",
  effectiveDate: daysAgo(40), tags: ["volume"],
  items: [
    makePricingEntry({
      catalogItemId: TIERED_PRICING_PRODUCT._id, currency: "USD", adjustmentType: "Quantity Tier",
      tiers: [{ minQty: 1, maxQty: 24, unitPrice: 38 }, { minQty: 25, maxQty: 99, unitPrice: 30 }, { minQty: 100, maxQty: null, unitPrice: 22 }],
    }),
  ],
});

// 11. Upcoming Price Book — effective in the future, derives to "Scheduled".
export const UPCOMING_PRICE_BOOK = makePriceBook({
  name: "Upcoming Regional Price Book", code: "PB-UPCOMING",
  description: "Scheduled to take effect next month.",
  status: "Active", priority: 10, currency: "USD", market: "Global",
  effectiveDate: daysFromNow(30), tags: ["upcoming"],
  items: [makePricingEntry({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Percentage Decrease", adjustmentValue: 5 })],
});

// 12. Expired Price Book — derives to "Expired".
export const EXPIRED_PRICE_BOOK = makePriceBook({
  name: "Expired Legacy Price Book", code: "PB-EXPIRED",
  description: "A previous pricing agreement that has since expired.",
  status: "Active", priority: 10, currency: "USD", market: "Global",
  effectiveDate: daysAgo(200), expirationDate: daysAgo(10), tags: ["legacy"],
  items: [makePricingEntry({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Decrease", adjustmentValue: 25 })],
});

// 13. Draft Price Book
export const DRAFT_PRICE_BOOK = makePriceBook({
  name: "Draft Regional Price Book", code: "PB-DRAFT",
  description: "Still being scoped — not yet activated.",
  status: "Draft", priority: 10, currency: "EUR", market: "Germany", tags: [],
  items: [makePricingEntry({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "EUR", adjustmentType: "Fixed Price", adjustmentValue: 450 })],
});

// 14. Inactive Price Book
export const INACTIVE_PRICE_BOOK = makePriceBook({
  name: "Inactive Trial Price Book", code: "PB-INACTIVE",
  description: "Was used for a pilot program; deliberately turned off.",
  status: "Inactive", priority: 10, currency: "USD", market: "Global", tags: ["pilot"],
  items: [makePricingEntry({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: 399 })],
});

// 15. Archived Price Book
export const ARCHIVED_PRICE_BOOK = makePriceBook({
  name: "Archived 2024 Price Book", code: "PB-ARCHIVED-2024",
  description: "Superseded by the current Standard Price Book.",
  status: "Archived", archived: true, archiveReason: "Superseded by a newer Price Book", archivedAt: daysAgo(60),
  statusBeforeArchive: "Inactive", priority: 10, currency: "USD", market: "Global", tags: ["superseded"],
  items: [makePricingEntry({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: 479 })],
});

// 16. Price Book with conflicting applicability — deliberately overlaps with
// the Standard Price Book at EQUAL specificity (both broad/"Standard") and
// EQUAL priority (0), sharing a currency and a catalog item, so a real,
// guaranteed, findable unresolved conflict always exists — not merely a
// fixture-level claim.
export const CONFLICTING_SCOPE_PRICE_BOOK = makePriceBook({
  name: "Regional Overlap Price Book", code: "PB-OVERLAP",
  description: "Deliberately overlaps the Standard Price Book at equal specificity and priority, to demonstrate unresolved conflict detection.",
  status: "Active", priority: 0, currency: "USD", market: "Global",
  effectiveDate: daysAgo(60), tags: ["conflict-demo"],
  items: [makePricingEntry({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: ACTIVE_ONE_TIME_PRODUCT.standardPrice - 50 })],
});

const CURATED_PRICE_BOOKS = [
  STANDARD_PRICE_BOOK, INDIA_PRICE_BOOK, INDONESIA_PRICE_BOOK, USD_INTERNATIONAL_PRICE_BOOK,
  ENTERPRISE_CUSTOMER_PRICE_BOOK, SMALL_BUSINESS_PRICE_BOOK, PARTNER_PRICE_BOOK, COMPANY_SPECIFIC_PRICE_BOOK,
  PROMOTIONAL_PRICE_BOOK, QUANTITY_TIER_PRICE_BOOK, UPCOMING_PRICE_BOOK, EXPIRED_PRICE_BOOK,
  DRAFT_PRICE_BOOK, INACTIVE_PRICE_BOOK, ARCHIVED_PRICE_BOOK, CONFLICTING_SCOPE_PRICE_BOOK,
];

const RANDOM_PRICE_BOOKS = faker.helpers.multiple(() => {
  const sampleItems = faker.helpers.arrayElements(catalogItems.filter((c) => c.standardPrice != null), { min: 1, max: 3 });
  return makePriceBook({
    items: sampleItems.map((c) => makePricingEntry({ catalogItemId: c._id, currency: c.currency, adjustmentType: "Fixed Price", adjustmentValue: c.standardPrice })),
  });
}, { count: 6 });

export const priceBooks = [...CURATED_PRICE_BOOKS, ...RANDOM_PRICE_BOOKS];

// ---------------------------------------------------------------------------
// Finders / status derivation
// ---------------------------------------------------------------------------
export function findPriceBook(priceBookId) {
  return priceBooks.find((p) => p._id === priceBookId);
}

// "Do not rely only on manually selected status values" — Draft/Inactive/
// Archived are user-controlled and pass through unchanged; only an
// "Active" record ever resolves further, into Scheduled/Active/Expired
// based on its own effective/expiration dates.
export function getEffectiveStatus(pb, atDate = new Date()) {
  if (pb.status !== "Active") return pb.status;
  const now = atDate instanceof Date ? atDate : new Date(atDate);
  if (pb.effectiveDate && now < new Date(pb.effectiveDate)) return "Scheduled";
  if (pb.expirationDate && now > new Date(pb.expirationDate)) return "Expired";
  return "Active";
}

export function isExpiringSoon(pb, days = EXPIRING_SOON_DAYS) {
  if (getEffectiveStatus(pb) !== "Active" || !pb.expirationDate) return false;
  const msLeft = new Date(pb.expirationDate).getTime() - Date.now();
  return msLeft > 0 && msLeft <= days * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Priority / specificity resolution order (displayed verbatim in the UI):
// Company-specific > Contract-specific > Customer-segment-specific >
// Market-specific > Channel-specific > Standard. Equal specificity falls
// back to configured priority; equal specificity AND priority is always
// shown as an unresolved conflict — never resolved silently.
// ---------------------------------------------------------------------------
export function specificityRank(pb) {
  if ((pb.companyIds || []).length > 0) return 6;
  if ((pb.contractTypes || []).length > 0) return 5;
  if (pb.customerSegment) return 4;
  if (pb.market && pb.market !== "Global") return 3;
  if (pb.salesChannel) return 2;
  return 1;
}

export function describeApplicability(pb) {
  const clauses = [];
  clauses.push(pb.customerSegment ? `${pb.customerSegment} customers` : "All customers");
  if (pb.market && pb.market !== "Global") clauses.push(`in ${pb.market}`);
  if ((pb.companyIds || []).length > 0) {
    const names = pb.companyIds.map((cid) => companies.find((c) => c._id === cid)?.name).filter(Boolean);
    if (names.length) clauses.push(`at ${names.join(", ")}`);
  }
  clauses.push(`using ${pb.currency}`);
  if ((pb.dealTypes || []).length > 0) clauses.push(`for ${pb.dealTypes.join("/")} Deals`);
  if ((pb.contractTypes || []).length > 0) clauses.push(`under ${pb.contractTypes.join("/")} contracts`);
  if (pb.salesChannel) clauses.push(`via the ${pb.salesChannel} channel`);
  if ((pb.categories || []).length > 0) clauses.push(`limited to ${pb.categories.join(", ")}`);
  return `Applies to ${clauses.join(" ")}.`;
}

// ---------------------------------------------------------------------------
// Pricing math — never converts currencies. Percentage/Fixed adjustment
// types are only meaningful against a base price in the SAME currency;
// cross-currency entries must specify an absolute value (Fixed Price,
// Quantity Tier or Custom Quote).
// ---------------------------------------------------------------------------
export function computeEntryFinalPrice(entry, catalogItem, quantity) {
  if (!entry || !catalogItem) return null;
  const qty = quantity ?? entry.minQuantity ?? 1;
  const base = catalogItem.standardPrice;
  const sameCurrency = entry.currency === catalogItem.currency;

  if (entry.adjustmentType === "Custom Quote") {
    return { finalPrice: null, difference: null, percentDifference: null, sameCurrency, basePrice: base };
  }
  if (entry.adjustmentType === "Quantity Tier") {
    const tier = (entry.tiers || []).find((t) => qty >= t.minQty && (t.maxQty == null || qty <= t.maxQty));
    const finalPrice = tier ? tier.unitPrice : null;
    const difference = sameCurrency && base != null && finalPrice != null ? finalPrice - base : null;
    const percentDifference = sameCurrency && base ? (difference / base) * 100 : null;
    return { finalPrice, difference, percentDifference, sameCurrency, basePrice: base, tier: tier || null };
  }
  if (entry.adjustmentType === "Fixed Price") {
    const finalPrice = entry.adjustmentValue === null || entry.adjustmentValue === undefined ? null : Number(entry.adjustmentValue);
    const difference = sameCurrency && base != null && finalPrice != null ? finalPrice - base : null;
    const percentDifference = sameCurrency && base ? (difference / base) * 100 : null;
    return { finalPrice, difference, percentDifference, sameCurrency, basePrice: base };
  }
  // Percentage/Fixed Increase/Decrease all require a same-currency base.
  if (!sameCurrency || base == null || entry.adjustmentValue == null) {
    return { finalPrice: null, difference: null, percentDifference: null, sameCurrency, basePrice: base, unresolvable: true };
  }
  const value = Number(entry.adjustmentValue);
  let finalPrice = base;
  if (entry.adjustmentType === "Percentage Increase") finalPrice = base * (1 + value / 100);
  if (entry.adjustmentType === "Percentage Decrease") finalPrice = base * (1 - value / 100);
  if (entry.adjustmentType === "Fixed Increase") finalPrice = base + value;
  if (entry.adjustmentType === "Fixed Decrease") finalPrice = base - value;
  finalPrice = Math.round(finalPrice * 100) / 100;
  const difference = Math.round((finalPrice - base) * 100) / 100;
  const percentDifference = base ? Math.round((difference / base) * 10000) / 100 : 0;
  return { finalPrice, difference, percentDifference, sameCurrency, basePrice: base };
}

export function validateQuantityTiers(tiers, { requireContinuous = false } = {}) {
  const errors = [];
  const sorted = [...(tiers || [])].sort((a, b) => a.minQty - b.minQty);
  for (const t of sorted) {
    if (t.minQty < 0) errors.push("Minimum quantity cannot be negative");
    if (t.maxQty != null && t.maxQty < t.minQty) errors.push(`Maximum quantity (${t.maxQty}) is below minimum (${t.minQty})`);
    if (t.unitPrice < 0) errors.push("Unit price cannot be negative");
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]; const b = sorted[i + 1];
    if (a.maxQty == null || a.maxQty >= b.minQty) {
      errors.push(`Tiers overlap between ${a.minQty}–${a.maxQty ?? "∞"} and ${b.minQty}–${b.maxQty ?? "∞"}`);
    } else if (requireContinuous && a.maxQty + 1 !== b.minQty) {
      errors.push(`Gap between ${a.minQty}–${a.maxQty} and ${b.minQty}–${b.maxQty ?? "∞"}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export function validatePriceBookPayload(payload, { excludeId, allPriceBooks = priceBooks } = {}) {
  const errors = {};
  const warnings = {};

  if (!payload.name?.trim()) errors.name = "Name is required";
  if (!payload.code?.trim()) errors.code = "A unique code is required";
  else {
    const dup = allPriceBooks.find((p) => p._id !== excludeId && p.code.trim().toLowerCase() === payload.code.trim().toLowerCase());
    if (dup) errors.code = `"${payload.code}" is already used by "${dup.name}" — codes must be unique.`;
  }
  if (!payload.currency || !PRICE_BOOK_CURRENCIES.includes(payload.currency)) errors.currency = "Select a valid currency";

  const priority = Number(payload.priority);
  if (payload.priority === "" || payload.priority === null || payload.priority === undefined || Number.isNaN(priority) || priority < MIN_PRIORITY || priority > MAX_PRIORITY) {
    errors.priority = `Priority must be a number between ${MIN_PRIORITY} and ${MAX_PRIORITY}`;
  }

  if (payload.effectiveDate && payload.expirationDate && new Date(payload.effectiveDate) >= new Date(payload.expirationDate)) {
    errors.expirationDate = "Expiration date must be after the effective date";
  }

  const hasApplicability = !!payload.market || !!payload.customerSegment || (payload.companyIds || []).length > 0
    || !!payload.salesChannel || (payload.categories || []).length > 0 || (payload.dealTypes || []).length > 0 || (payload.contractTypes || []).length > 0;
  if (!hasApplicability) errors.applicability = "Select at least one applicability rule (Market defaults to Global for a broad scope)";

  if (!(payload.items || []).length) errors.items = "Add at least one catalog item";

  (payload.items || []).forEach((entry, idx) => {
    const catalogItem = findCatalogItem(entry.catalogItemId);
    if (!catalogItem) { errors[`item_${idx}`] = "Catalog item not found"; return; }
    if (entry.currency !== payload.currency) {
      errors[`item_${idx}_currency`] = `"${catalogItem.name}" entry currency (${entry.currency}) must match the Price Book's currency (${payload.currency})`;
    }
    const crossCurrency = entry.currency !== catalogItem.currency;
    if (crossCurrency && ["Percentage Increase", "Percentage Decrease", "Fixed Increase", "Fixed Decrease"].includes(entry.adjustmentType)) {
      errors[`item_${idx}_adjustment`] = `"${catalogItem.name}" is priced in ${catalogItem.currency} — cross-currency entries must use Fixed Price, Quantity Tier or Custom Quote (this tool does not convert currencies)`;
    }
    if (entry.adjustmentType === "Quantity Tier") {
      if (!entry.tiers?.length) errors[`item_${idx}_tiers`] = `"${catalogItem.name}" needs at least one quantity tier`;
      else {
        const tierErrors = validateQuantityTiers(entry.tiers);
        if (tierErrors.length) errors[`item_${idx}_tiers`] = tierErrors.join("; ");
      }
    } else if (entry.adjustmentType !== "Custom Quote") {
      if (entry.adjustmentValue === null || entry.adjustmentValue === undefined || entry.adjustmentValue === "" || Number.isNaN(Number(entry.adjustmentValue))) {
        errors[`item_${idx}_value`] = `"${catalogItem.name}" needs a numeric adjustment value`;
      }
    }
    const min = entry.minQuantity ?? 1;
    const max = entry.maxQuantity;
    if (min < 0) errors[`item_${idx}_qty`] = "Minimum quantity cannot be negative";
    if (max != null && max < min) errors[`item_${idx}_qty`] = "Maximum quantity must be at least the minimum quantity";
    if (entry.billingInterval && !BILLING_INTERVALS.includes(entry.billingInterval)) errors[`item_${idx}_interval`] = "Select a valid billing interval";

    if (!crossCurrency && !errors[`item_${idx}_value`] && !errors[`item_${idx}_tiers`]) {
      const resolved = computeEntryFinalPrice(entry, catalogItem, min);
      if (resolved?.finalPrice != null && resolved.finalPrice < 0) errors[`item_${idx}_final`] = `"${catalogItem.name}" resolves to a negative final price`;
    }
  });

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Conflict detection — never resolved silently.
// ---------------------------------------------------------------------------
function applicabilityOverlaps(a, b) {
  if (a.currency !== b.currency) return false;
  if (!(a.market === "Global" || b.market === "Global" || a.market === b.market)) return false;
  if (!(!a.customerSegment || !b.customerSegment || a.customerSegment === b.customerSegment)) return false;
  if (!(!a.salesChannel || !b.salesChannel || a.salesChannel === b.salesChannel)) return false;
  const aCompanies = a.companyIds || []; const bCompanies = b.companyIds || [];
  if (!(aCompanies.length === 0 || bCompanies.length === 0 || aCompanies.some((cid) => bCompanies.includes(cid)))) return false;
  const aCats = a.categories || []; const bCats = b.categories || [];
  if (!(aCats.length === 0 || bCats.length === 0 || aCats.some((c) => bCats.includes(c)))) return false;
  return true;
}
function datesOverlap(a, b) {
  const MIN_D = new Date(-8640000000000000); const MAX_D = new Date(8640000000000000);
  const aStart = a.effectiveDate ? new Date(a.effectiveDate) : MIN_D;
  const aEnd = a.expirationDate ? new Date(a.expirationDate) : MAX_D;
  const bStart = b.effectiveDate ? new Date(b.effectiveDate) : MIN_D;
  const bEnd = b.expirationDate ? new Date(b.expirationDate) : MAX_D;
  return aStart <= bEnd && bStart <= aEnd;
}
function sharedEnabledItemIds(a, b) {
  const aIds = new Set((a.items || []).filter((i) => i.enabled !== false).map((i) => i.catalogItemId));
  return (b.items || []).filter((i) => i.enabled !== false && aIds.has(i.catalogItemId)).map((i) => i.catalogItemId);
}

export function findConflicts(pb, allPriceBooks = priceBooks) {
  const status = getEffectiveStatus(pb);
  if (!["Active", "Scheduled"].includes(status)) return [];
  const conflicts = [];
  for (const other of allPriceBooks) {
    if (other._id === pb._id) continue;
    if (!["Active", "Scheduled"].includes(getEffectiveStatus(other))) continue;
    if (!applicabilityOverlaps(pb, other)) continue;
    if (!datesOverlap(pb, other)) continue;
    const shared = sharedEnabledItemIds(pb, other);
    if (shared.length === 0) continue;

    const rankA = specificityRank(pb); const rankB = specificityRank(other);
    let resolution; let unresolved = false;
    if (rankA !== rankB) {
      resolution = rankA > rankB
        ? `"${pb.name}" wins — more specific (${SPECIFICITY_LABELS[rankA]} beats ${SPECIFICITY_LABELS[rankB]}).`
        : `"${other.name}" wins — more specific (${SPECIFICITY_LABELS[rankB]} beats ${SPECIFICITY_LABELS[rankA]}).`;
    } else if (pb.priority !== other.priority) {
      resolution = pb.priority > other.priority
        ? `"${pb.name}" wins — higher priority (${pb.priority} vs ${other.priority}).`
        : `"${other.name}" wins — higher priority (${other.priority} vs ${pb.priority}).`;
    } else {
      resolution = "Unresolved — equal specificity and equal priority. Resolve by changing priority, narrowing applicability, adjusting dates, removing the shared item, or deactivating one Price Book.";
      unresolved = true;
    }
    conflicts.push({
      priceBookId: other._id, priceBookName: other.name, sharedItemIds: shared,
      priority: other.priority, specificity: SPECIFICITY_LABELS[rankB], resolution, unresolved,
    });
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// Price resolution engine — the Price Preview tool's core. A frontend rules
// preview only; never claims to be a backend-confirmed Quote price.
// ---------------------------------------------------------------------------
export function resolvePrice(context, { allPriceBooks = priceBooks, allCatalogItems = catalogItems } = {}) {
  const {
    date = new Date().toISOString(), companyId, customerSegment, market, currency, salesChannel,
    dealType, catalogItemId, quantity = 1, billingInterval,
  } = context;

  const catalogItem = allCatalogItems.find((c) => c._id === catalogItemId);
  if (!catalogItem) return { matches: [], winner: null, tied: false, reason: "Select a catalog item to preview a price." };

  // Strict matching: when a Price Book restricts a dimension, the context
  // must explicitly supply a matching value — an omitted input never
  // "passes through" a restriction (that would silently over-apply a
  // segment/market/channel-specific Price Book to an unknown context).
  const matches = allPriceBooks.filter((pb) => {
    if (getEffectiveStatus(pb, new Date(date)) !== "Active") return false;
    if (pb.currency !== currency) return false;
    if (pb.market && pb.market !== "Global" && pb.market !== market) return false;
    if (pb.customerSegment && pb.customerSegment !== customerSegment) return false;
    if ((pb.companyIds || []).length > 0 && !pb.companyIds.includes(companyId)) return false;
    if (pb.salesChannel && pb.salesChannel !== salesChannel) return false;
    if ((pb.dealTypes || []).length > 0 && !pb.dealTypes.includes(dealType)) return false;
    if ((pb.categories || []).length > 0 && !pb.categories.includes(catalogItem.category)) return false;
    const entry = (pb.items || []).find((i) => i.catalogItemId === catalogItemId && i.enabled !== false);
    if (!entry) return false;
    if (entry.billingInterval && billingInterval && entry.billingInterval !== billingInterval) return false;
    return true;
  }).map((pb) => {
    const entry = pb.items.find((i) => i.catalogItemId === catalogItemId && i.enabled !== false);
    const priced = computeEntryFinalPrice(entry, catalogItem, quantity);
    const rank = specificityRank(pb);
    return { priceBook: pb, entry, ...priced, specificity: SPECIFICITY_LABELS[rank], specificityRank: rank };
  });

  if (matches.length === 0) {
    return {
      matches: [], winner: null, tied: false,
      fallback: { finalPrice: catalogItem.standardPrice, currency: catalogItem.currency },
      reason: "No Price Book applies to this context — using the standard catalog price.",
    };
  }

  const sorted = [...matches].sort((a, b) => b.specificityRank - a.specificityRank || b.priceBook.priority - a.priceBook.priority);
  const winner = sorted[0];
  const runnerUp = sorted[1];
  const tied = !!runnerUp && runnerUp.specificityRank === winner.specificityRank && runnerUp.priceBook.priority === winner.priceBook.priority;

  return {
    matches: sorted, winner, tied,
    reason: tied
      ? `Multiple Price Books match with equal specificity (${winner.specificity}) and equal priority (${winner.priceBook.priority}) — this is an unresolved conflict.`
      : `"${winner.priceBook.name}" applied — ${winner.specificity}${sorted.length > 1 ? `, priority ${winner.priceBook.priority}` : ""}.`,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export function createPriceBook(payload, actor = "System") {
  const pb = makePriceBook({ ...payload, createdBy: actor, updatedBy: actor, createdAt: new Date().toISOString() });
  priceBooks.unshift(pb);
  return pb;
}

const AUDIT_TRACKED_FIELDS = ["status", "priority", "currency", "market", "customerSegment", "salesChannel"];

export function updatePriceBook(priceBookId, changes, actor = "System") {
  const pb = findPriceBook(priceBookId);
  if (!pb) return null;

  if (changes.ownerId !== undefined && changes.ownerId !== pb.ownerId) {
    const newOwner = findTeamMember(changes.ownerId);
    changes.ownerName = newOwner?.name || null;
  }
  if (changes.status && changes.status !== pb.status) {
    pb.activity.push(pbActivityEntry("status_changed", actor, `Status changed from ${pb.status} to ${changes.status}`));
  }
  if (changes.market !== undefined && changes.market !== pb.market) pb.activity.push(pbActivityEntry("applicability_changed", actor, `Market changed to ${changes.market || "—"}`));
  if (changes.customerSegment !== undefined && changes.customerSegment !== pb.customerSegment) pb.activity.push(pbActivityEntry("applicability_changed", actor, `Customer segment changed to ${changes.customerSegment || "—"}`));
  if (changes.companyIds !== undefined && JSON.stringify(changes.companyIds) !== JSON.stringify(pb.companyIds)) pb.activity.push(pbActivityEntry("applicability_changed", actor, "Specific Companies scope changed"));

  if (changes.items) {
    const beforeIds = new Set((pb.items || []).map((i) => i.catalogItemId));
    const afterIds = new Set(changes.items.map((i) => i.catalogItemId));
    for (const entry of changes.items) {
      if (!beforeIds.has(entry.catalogItemId)) {
        const c = findCatalogItem(entry.catalogItemId);
        pb.activity.push(pbActivityEntry("item_added", actor, `Added "${c?.name || entry.catalogItemId}" to the Price Book`));
      }
    }
    for (const entry of pb.items) {
      if (!afterIds.has(entry.catalogItemId)) {
        const c = findCatalogItem(entry.catalogItemId);
        pb.activity.push(pbActivityEntry("item_removed", actor, `Removed "${c?.name || entry.catalogItemId}" from the Price Book`));
      }
    }
    for (const cid of [...beforeIds].filter((x) => afterIds.has(x))) {
      const before = pb.items.find((i) => i.catalogItemId === cid);
      const after = changes.items.find((i) => i.catalogItemId === cid);
      if (before.adjustmentValue !== after.adjustmentValue || before.adjustmentType !== after.adjustmentType || JSON.stringify(before.tiers) !== JSON.stringify(after.tiers)) {
        const c = findCatalogItem(cid);
        pb.activity.push(pbActivityEntry("price_changed", actor, `Price changed for "${c?.name || cid}"`));
      }
    }
    changes.items = changes.items.map((i) => (i._id ? i : makePricingEntry(i)));
  }

  for (const field of AUDIT_TRACKED_FIELDS) {
    if (field in changes && changes[field] !== pb[field]) {
      pb.auditLog.push(pbAuditEntry("update", actor, { field, before: pb[field] ?? null, after: changes[field] ?? null, reason: changes.reason || null }));
    }
  }

  Object.assign(pb, changes);
  pb.updatedAt = new Date().toISOString();
  pb.updatedBy = actor;
  return pb;
}

export function archivePriceBook(priceBookId, reason, actor = "System") {
  const pb = findPriceBook(priceBookId);
  if (!pb) return null;
  pb.statusBeforeArchive = pb.status;
  pb.status = "Archived";
  pb.archived = true;
  pb.archiveReason = reason;
  pb.archivedAt = new Date().toISOString();
  pb.activity.push(pbActivityEntry("archived", actor, `Archived: ${reason}`));
  pb.auditLog.push(pbAuditEntry("archive", actor, { field: "status", before: pb.statusBeforeArchive, after: "Archived", reason }));
  pb.updatedAt = new Date().toISOString();
  pb.updatedBy = actor;
  return pb;
}

export function restorePriceBook(priceBookId, actor = "System") {
  const pb = findPriceBook(priceBookId);
  if (!pb) return null;
  const restored = pb.statusBeforeArchive || "Draft";
  pb.status = restored;
  pb.archived = false;
  pb.archiveReason = null;
  pb.archivedAt = null;
  pb.statusBeforeArchive = null;
  pb.activity.push(pbActivityEntry("restored", actor, `Restored to ${restored}`));
  pb.auditLog.push(pbAuditEntry("restore", actor, { field: "status", before: "Archived", after: restored }));
  pb.updatedAt = new Date().toISOString();
  pb.updatedBy = actor;
  return pb;
}

// A pure preview — never touches priceBooks until the caller explicitly
// saves it, matching "open the form for review" / never instant-duplicate.
export function buildPriceBookDuplicatePreview(priceBookId) {
  const source = findPriceBook(priceBookId);
  if (!source) return null;
  return {
    ...source,
    _id: undefined,
    name: `${source.name} (Copy)`,
    code: "", // A duplicate must be given a brand-new code — never auto-suggested.
    status: "Draft",
    archived: false,
    archiveReason: null,
    archivedAt: null,
    statusBeforeArchive: null,
    activity: [],
    auditLog: [],
    createdAt: undefined,
    updatedAt: undefined,
    items: source.items.map((i) => ({ ...i, _id: undefined })),
  };
}

export function bulkAssignOwner(priceBookIds, ownerId, actor = "System") {
  return priceBookIds.map((pid) => updatePriceBook(pid, { ownerId }, actor)).filter(Boolean);
}
export function bulkChangeStatus(priceBookIds, status, actor = "System") {
  return priceBookIds.map((pid) => updatePriceBook(pid, { status }, actor)).filter(Boolean);
}
export function bulkArchive(priceBookIds, reason, actor = "System") {
  return priceBookIds.map((pid) => archivePriceBook(pid, reason, actor)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Activation / status-change warnings — surfaced, never silently swallowed.
// ---------------------------------------------------------------------------
export function computeActivationWarnings(pb, { allPriceBooks = priceBooks, allCatalogItems = catalogItems } = {}) {
  const warnings = [];
  if (!(pb.items || []).length) warnings.push("No catalog items are configured");
  const hasApplicability = !!pb.market || !!pb.customerSegment || (pb.companyIds || []).length > 0 || !!pb.salesChannel || (pb.categories || []).length > 0;
  if (!hasApplicability) warnings.push("No applicability rules are set");
  if (pb.effectiveDate && pb.expirationDate && new Date(pb.effectiveDate) >= new Date(pb.expirationDate)) warnings.push("Expiration date is not after the effective date");

  const missing = (pb.items || []).filter((entry) => {
    const c = allCatalogItems.find((x) => x._id === entry.catalogItemId);
    if (!c) return true;
    if (entry.adjustmentType === "Custom Quote") return false;
    const priced = computeEntryFinalPrice(entry, c, entry.minQuantity || 1);
    return priced?.finalPrice == null;
  });
  if (missing.length) warnings.push(`${missing.length} item(s) are missing a resolvable price`);

  const conflicts = findConflicts({ ...pb, status: "Active" }, allPriceBooks.filter((p) => p._id !== pb._id));
  if (conflicts.length) warnings.push(`${conflicts.length} potential conflict(s) with other Price Books`);

  return warnings;
}

export function dealsUsingPriceBook(priceBookId) {
  return deals.filter((d) => (d.lineItems || []).some((li) => li.priceBookId === priceBookId));
}

// ---------------------------------------------------------------------------
// Query — filter/sort/paginate client-side over the full set, same pattern
// as queryCatalogLocal / queryCompaniesLocal.
// ---------------------------------------------------------------------------
export function queryPriceBooksLocal(list, params = {}) {
  const {
    search = "", status, currency, market, customerSegment, companyId, salesChannel, category, ownerId,
    effectiveFrom, effectiveTo, expiringSoon, hasConflicts, archived = "false",
    sort = "updatedAt", order = "desc", page = 1, pageSize = 20,
  } = params;

  const effectiveArchived = status === "Archived" ? "true" : archived;

  let result = list.filter((pb) => {
    if (effectiveArchived === "true" && !pb.archived) return false;
    if (effectiveArchived !== "true" && pb.archived) return false;
    const effStatus = getEffectiveStatus(pb);
    if (status && effStatus !== status) return false;
    if (currency && pb.currency !== currency) return false;
    if (market && pb.market !== market) return false;
    if (customerSegment && pb.customerSegment !== customerSegment) return false;
    if (companyId && !(pb.companyIds || []).includes(companyId)) return false;
    if (salesChannel && pb.salesChannel !== salesChannel) return false;
    if (category && !(pb.categories || []).includes(category)) return false;
    if (ownerId && pb.ownerId !== ownerId) return false;
    if (effectiveFrom && (!pb.effectiveDate || new Date(pb.effectiveDate) < new Date(effectiveFrom))) return false;
    if (effectiveTo && (!pb.effectiveDate || new Date(pb.effectiveDate) > new Date(effectiveTo))) return false;
    if (expiringSoon === "true" && !isExpiringSoon(pb)) return false;
    if (hasConflicts === "true" && findConflicts(pb, list).length === 0) return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = `${pb.name} ${pb.code} ${pb.description}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const summary = {
    total: result.length,
    active: result.filter((pb) => getEffectiveStatus(pb) === "Active").length,
    scheduled: result.filter((pb) => getEffectiveStatus(pb) === "Scheduled").length,
    expiringSoon: result.filter((pb) => isExpiringSoon(pb)).length,
    draft: result.filter((pb) => pb.status === "Draft").length,
    conflicts: result.filter((pb) => findConflicts(pb, list).length > 0).length,
    missingPrices: result.filter((pb) => (pb.items || []).some((entry) => {
      const c = findCatalogItem(entry.catalogItemId);
      if (!c) return true;
      if (entry.adjustmentType === "Custom Quote") return false;
      const priced = computeEntryFinalPrice(entry, c, entry.minQuantity || 1);
      return priced?.finalPrice == null;
    })).length,
  };

  result = [...result].sort((a, b) => {
    const dir = order === "asc" ? 1 : -1;
    let av = a[sort]; let bv = b[sort];
    if (sort === "itemCount") { av = (a.items || []).length; bv = (b.items || []).length; }
    if (sort === "status") { av = getEffectiveStatus(a); bv = getEffectiveStatus(b); }
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
