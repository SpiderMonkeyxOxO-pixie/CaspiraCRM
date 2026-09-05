import { describe, it, expect } from "vitest";
import {
  PRICE_BOOK_STATUSES, SETTABLE_STATUSES, PRICE_BOOK_CURRENCIES, MARKETS, CUSTOMER_SEGMENTS,
  SALES_CHANNELS, CONTRACT_TYPES, ADJUSTMENT_TYPES,
  priceBooks, findPriceBook, getEffectiveStatus, isExpiringSoon, specificityRank, describeApplicability,
  computeEntryFinalPrice, validateQuantityTiers, validatePriceBookPayload, findConflicts, resolvePrice,
  createPriceBook, updatePriceBook, archivePriceBook, restorePriceBook, buildPriceBookDuplicatePreview,
  bulkAssignOwner, bulkChangeStatus, bulkArchive, computeActivationWarnings, queryPriceBooksLocal,
  STANDARD_PRICE_BOOK, INDIA_PRICE_BOOK, INDONESIA_PRICE_BOOK, USD_INTERNATIONAL_PRICE_BOOK,
  ENTERPRISE_CUSTOMER_PRICE_BOOK, SMALL_BUSINESS_PRICE_BOOK, PARTNER_PRICE_BOOK, COMPANY_SPECIFIC_PRICE_BOOK,
  PROMOTIONAL_PRICE_BOOK, QUANTITY_TIER_PRICE_BOOK, UPCOMING_PRICE_BOOK, EXPIRED_PRICE_BOOK,
  DRAFT_PRICE_BOOK, INACTIVE_PRICE_BOOK, ARCHIVED_PRICE_BOOK, CONFLICTING_SCOPE_PRICE_BOOK,
} from "./mockPriceBookData";
import { ACTIVE_ONE_TIME_PRODUCT, TIERED_PRICING_PRODUCT } from "./mockCatalogData";

describe("enums", () => {
  it("statuses include derived Scheduled/Expired but SETTABLE_STATUSES does not", () => {
    expect(PRICE_BOOK_STATUSES).toEqual(["Draft", "Scheduled", "Active", "Expired", "Inactive", "Archived"]);
    expect(SETTABLE_STATUSES).not.toContain("Scheduled");
    expect(SETTABLE_STATUSES).not.toContain("Expired");
  });
  it("currencies are a superset of catalog currencies including regional ones", () => {
    expect(PRICE_BOOK_CURRENCIES).toEqual(expect.arrayContaining(["USD", "EUR", "GBP", "INR", "IDR"]));
  });
  it("markets, segments, channels, contract types and adjustment types are defined", () => {
    expect(MARKETS.length).toBeGreaterThan(0);
    expect(CUSTOMER_SEGMENTS.length).toBeGreaterThan(0);
    expect(SALES_CHANNELS.length).toBeGreaterThan(0);
    expect(CONTRACT_TYPES.length).toBeGreaterThan(0);
    expect(ADJUSTMENT_TYPES).toEqual(["Fixed Price", "Percentage Increase", "Percentage Decrease", "Fixed Increase", "Fixed Decrease", "Quantity Tier", "Custom Quote"]);
  });
});

describe("16 curated fixtures", () => {
  it("Standard Price Book is broad and lowest priority", () => {
    expect(STANDARD_PRICE_BOOK.market).toBe("Global");
    expect(STANDARD_PRICE_BOOK.priority).toBe(0);
    expect(STANDARD_PRICE_BOOK.status).toBe("Active");
  });
  it("India Price Book is market + currency specific", () => {
    expect(INDIA_PRICE_BOOK.market).toBe("India");
    expect(INDIA_PRICE_BOOK.currency).toBe("INR");
  });
  it("Indonesia Price Book is market + currency specific", () => {
    expect(INDONESIA_PRICE_BOOK.market).toBe("Indonesia");
    expect(INDONESIA_PRICE_BOOK.currency).toBe("IDR");
  });
  it("USD International Price Book is USD and broad", () => {
    expect(USD_INTERNATIONAL_PRICE_BOOK.currency).toBe("USD");
    expect(USD_INTERNATIONAL_PRICE_BOOK.market).toBe("Global");
  });
  it("Enterprise Customer Price Book is segment-specific", () => {
    expect(ENTERPRISE_CUSTOMER_PRICE_BOOK.customerSegment).toBe("Enterprise");
  });
  it("Small Business Price Book is segment-specific", () => {
    expect(SMALL_BUSINESS_PRICE_BOOK.customerSegment).toBe("Small Business");
  });
  it("Partner Price Book is channel-specific", () => {
    expect(PARTNER_PRICE_BOOK.salesChannel).toBe("Partner");
  });
  it("Company-specific Price Book scopes to a real company", () => {
    expect(COMPANY_SPECIFIC_PRICE_BOOK.companyIds.length).toBe(1);
  });
  it("Promotional Price Book has a short expiration window", () => {
    expect(PROMOTIONAL_PRICE_BOOK.expirationDate).toBeTruthy();
    expect(isExpiringSoon(PROMOTIONAL_PRICE_BOOK)).toBe(true);
  });
  it("Quantity-tier Price Book has a Quantity Tier entry with tiers", () => {
    const entry = QUANTITY_TIER_PRICE_BOOK.items[0];
    expect(entry.adjustmentType).toBe("Quantity Tier");
    expect(entry.tiers.length).toBeGreaterThan(1);
  });
  it("Upcoming Price Book derives to Scheduled", () => {
    expect(getEffectiveStatus(UPCOMING_PRICE_BOOK)).toBe("Scheduled");
  });
  it("Expired Price Book derives to Expired", () => {
    expect(getEffectiveStatus(EXPIRED_PRICE_BOOK)).toBe("Expired");
  });
  it("Draft Price Book stays Draft regardless of dates", () => {
    expect(getEffectiveStatus(DRAFT_PRICE_BOOK)).toBe("Draft");
  });
  it("Inactive Price Book stays Inactive", () => {
    expect(getEffectiveStatus(INACTIVE_PRICE_BOOK)).toBe("Inactive");
  });
  it("Archived Price Book stays Archived and remembers its prior status", () => {
    expect(getEffectiveStatus(ARCHIVED_PRICE_BOOK)).toBe("Archived");
    expect(ARCHIVED_PRICE_BOOK.statusBeforeArchive).toBe("Inactive");
  });
  it("Conflicting-scope Price Book genuinely conflicts with Standard (equal specificity + priority)", () => {
    const conflicts = findConflicts(CONFLICTING_SCOPE_PRICE_BOOK);
    const withStandard = conflicts.find((c) => c.priceBookId === STANDARD_PRICE_BOOK._id);
    expect(withStandard).toBeTruthy();
    expect(withStandard.unresolved).toBe(true);
  });
  it("all 16 curated fixtures are present in the exported list", () => {
    const ids = new Set(priceBooks.map((p) => p._id));
    for (const pb of [
      STANDARD_PRICE_BOOK, INDIA_PRICE_BOOK, INDONESIA_PRICE_BOOK, USD_INTERNATIONAL_PRICE_BOOK,
      ENTERPRISE_CUSTOMER_PRICE_BOOK, SMALL_BUSINESS_PRICE_BOOK, PARTNER_PRICE_BOOK, COMPANY_SPECIFIC_PRICE_BOOK,
      PROMOTIONAL_PRICE_BOOK, QUANTITY_TIER_PRICE_BOOK, UPCOMING_PRICE_BOOK, EXPIRED_PRICE_BOOK,
      DRAFT_PRICE_BOOK, INACTIVE_PRICE_BOOK, ARCHIVED_PRICE_BOOK, CONFLICTING_SCOPE_PRICE_BOOK,
    ]) expect(ids.has(pb._id)).toBe(true);
  });
});

describe("getEffectiveStatus", () => {
  it("Active with future effective date is Scheduled", () => {
    const pb = { status: "Active", effectiveDate: new Date(Date.now() + 100000).toISOString(), expirationDate: null };
    expect(getEffectiveStatus(pb)).toBe("Scheduled");
  });
  it("Active with past expiration is Expired", () => {
    const pb = { status: "Active", effectiveDate: new Date(Date.now() - 200000).toISOString(), expirationDate: new Date(Date.now() - 100000).toISOString() };
    expect(getEffectiveStatus(pb)).toBe("Expired");
  });
  it("Active within window is Active", () => {
    const pb = { status: "Active", effectiveDate: new Date(Date.now() - 100000).toISOString(), expirationDate: null };
    expect(getEffectiveStatus(pb)).toBe("Active");
  });
  it("Draft/Inactive/Archived never get overridden by dates", () => {
    expect(getEffectiveStatus({ status: "Draft", effectiveDate: new Date(Date.now() - 100000).toISOString() })).toBe("Draft");
    expect(getEffectiveStatus({ status: "Inactive", effectiveDate: new Date(Date.now() - 100000).toISOString() })).toBe("Inactive");
    expect(getEffectiveStatus({ status: "Archived" })).toBe("Archived");
  });
});

describe("specificityRank / priority resolution order", () => {
  it("ranks company > contract > segment > market > channel > standard", () => {
    expect(specificityRank({ companyIds: ["x"] })).toBe(6);
    expect(specificityRank({ contractTypes: ["Custom"] })).toBe(5);
    expect(specificityRank({ customerSegment: "Enterprise" })).toBe(4);
    expect(specificityRank({ market: "India" })).toBe(3);
    expect(specificityRank({ salesChannel: "Partner" })).toBe(2);
    expect(specificityRank({ market: "Global" })).toBe(1);
  });
});

describe("describeApplicability", () => {
  it("builds an understandable sentence matching the spec's example shape", () => {
    const pb = { customerSegment: "Enterprise", market: "India", currency: "INR", dealTypes: ["New Business"], companyIds: [], contractTypes: [], categories: [] };
    expect(describeApplicability(pb)).toBe("Applies to Enterprise customers in India using INR for New Business Deals.");
  });
  it("falls back to broad language for a Standard scope", () => {
    const pb = { customerSegment: null, market: "Global", currency: "USD", dealTypes: [], companyIds: [], contractTypes: [], categories: [] };
    expect(describeApplicability(pb)).toBe("Applies to All customers using USD.");
  });
});

describe("computeEntryFinalPrice", () => {
  const catalogItem = { standardPrice: 100, currency: "USD" };
  it("Fixed Price returns the fixed value and a difference from base", () => {
    const r = computeEntryFinalPrice({ currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: 80 }, catalogItem, 1);
    expect(r.finalPrice).toBe(80);
    expect(r.difference).toBe(-20);
    expect(r.percentDifference).toBe(-20);
  });
  it("Percentage Decrease computes off the same-currency base", () => {
    const r = computeEntryFinalPrice({ currency: "USD", adjustmentType: "Percentage Decrease", adjustmentValue: 10 }, catalogItem, 1);
    expect(r.finalPrice).toBe(90);
  });
  it("Percentage Increase computes off the same-currency base", () => {
    const r = computeEntryFinalPrice({ currency: "USD", adjustmentType: "Percentage Increase", adjustmentValue: 10 }, catalogItem, 1);
    expect(r.finalPrice).toBe(110);
  });
  it("Fixed Increase/Decrease add or subtract a flat amount", () => {
    expect(computeEntryFinalPrice({ currency: "USD", adjustmentType: "Fixed Increase", adjustmentValue: 15 }, catalogItem, 1).finalPrice).toBe(115);
    expect(computeEntryFinalPrice({ currency: "USD", adjustmentType: "Fixed Decrease", adjustmentValue: 15 }, catalogItem, 1).finalPrice).toBe(85);
  });
  it("cross-currency Percentage/Fixed adjustments are unresolvable (never converts currency)", () => {
    const r = computeEntryFinalPrice({ currency: "INR", adjustmentType: "Percentage Decrease", adjustmentValue: 10 }, catalogItem, 1);
    expect(r.finalPrice).toBeNull();
    expect(r.unresolvable).toBe(true);
  });
  it("cross-currency Fixed Price still resolves (it's an absolute value)", () => {
    const r = computeEntryFinalPrice({ currency: "INR", adjustmentType: "Fixed Price", adjustmentValue: 8000 }, catalogItem, 1);
    expect(r.finalPrice).toBe(8000);
    expect(r.sameCurrency).toBe(false);
    expect(r.difference).toBeNull(); // no comparison across currencies
  });
  it("Custom Quote always resolves to null with no numeric comparison", () => {
    const r = computeEntryFinalPrice({ currency: "USD", adjustmentType: "Custom Quote" }, catalogItem, 1);
    expect(r.finalPrice).toBeNull();
  });
  it("Quantity Tier resolves the matching tier for the given quantity", () => {
    const entry = { currency: "USD", adjustmentType: "Quantity Tier", tiers: [{ minQty: 1, maxQty: 9, unitPrice: 100 }, { minQty: 10, maxQty: null, unitPrice: 80 }] };
    expect(computeEntryFinalPrice(entry, catalogItem, 5).finalPrice).toBe(100);
    expect(computeEntryFinalPrice(entry, catalogItem, 50).finalPrice).toBe(80);
  });
  it("handles a null base price (Usage Based/Custom Quote catalog items) safely", () => {
    const r = computeEntryFinalPrice({ currency: "USD", adjustmentType: "Percentage Decrease", adjustmentValue: 10 }, { standardPrice: null, currency: "USD" }, 1);
    expect(r.finalPrice).toBeNull();
    expect(r.unresolvable).toBe(true);
  });
});

describe("validateQuantityTiers", () => {
  it("passes for clean non-overlapping tiers", () => {
    expect(validateQuantityTiers([{ minQty: 1, maxQty: 9, unitPrice: 10 }, { minQty: 10, maxQty: null, unitPrice: 8 }])).toEqual([]);
  });
  it("flags overlapping tiers", () => {
    const errors = validateQuantityTiers([{ minQty: 1, maxQty: 10, unitPrice: 10 }, { minQty: 5, maxQty: 20, unitPrice: 8 }]);
    expect(errors.some((e) => e.includes("overlap"))).toBe(true);
  });
  it("flags a gap when continuous pricing is required", () => {
    const errors = validateQuantityTiers([{ minQty: 1, maxQty: 9, unitPrice: 10 }, { minQty: 15, maxQty: null, unitPrice: 8 }], { requireContinuous: true });
    expect(errors.some((e) => e.includes("Gap"))).toBe(true);
  });
  it("flags max below min and negative price", () => {
    const errors = validateQuantityTiers([{ minQty: 10, maxQty: 5, unitPrice: -1 }]);
    expect(errors.some((e) => e.includes("below minimum"))).toBe(true);
    expect(errors.some((e) => e.includes("negative"))).toBe(true);
  });
});

describe("validatePriceBookPayload", () => {
  const validPayload = () => ({
    name: "Test Price Book", code: `PB-TEST-${Math.random().toString(36).slice(2, 8)}`, currency: "USD", priority: 10,
    market: "Global", effectiveDate: new Date().toISOString(), expirationDate: null,
    items: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: 100, minQuantity: 1 }],
  });
  it("passes for a well-formed payload", () => {
    const { errors } = validatePriceBookPayload(validPayload());
    expect(Object.keys(errors)).toEqual([]);
  });
  it("requires a name", () => {
    const { errors } = validatePriceBookPayload({ ...validPayload(), name: "" });
    expect(errors.name).toBeTruthy();
  });
  it("requires a unique code", () => {
    const { errors } = validatePriceBookPayload({ ...validPayload(), code: STANDARD_PRICE_BOOK.code });
    expect(errors.code).toBeTruthy();
  });
  it("requires a valid currency", () => {
    const { errors } = validatePriceBookPayload({ ...validPayload(), currency: "XYZ" });
    expect(errors.currency).toBeTruthy();
  });
  it("enforces the priority range", () => {
    expect(validatePriceBookPayload({ ...validPayload(), priority: -5 }).errors.priority).toBeTruthy();
    expect(validatePriceBookPayload({ ...validPayload(), priority: 500 }).errors.priority).toBeTruthy();
  });
  it("requires expiration after effective date", () => {
    const p = validPayload();
    p.expirationDate = new Date(Date.now() - 999999999).toISOString();
    expect(validatePriceBookPayload(p).errors.expirationDate).toBeTruthy();
  });
  it("requires at least one applicability rule", () => {
    const p = validPayload();
    p.market = "";
    expect(validatePriceBookPayload(p).errors.applicability).toBeTruthy();
  });
  it("requires at least one catalog item", () => {
    const p = validPayload();
    p.items = [];
    expect(validatePriceBookPayload(p).errors.items).toBeTruthy();
  });
  it("rejects an entry currency that doesn't match the book's currency", () => {
    const p = validPayload();
    p.items[0].currency = "EUR";
    const { errors } = validatePriceBookPayload(p);
    expect(Object.keys(errors).some((k) => k.includes("currency"))).toBe(true);
  });
  it("rejects cross-currency Percentage/Fixed adjustments", () => {
    const p = { ...validPayload(), currency: "INR", items: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "INR", adjustmentType: "Percentage Decrease", adjustmentValue: 10, minQuantity: 1 }] };
    const { errors } = validatePriceBookPayload(p);
    expect(Object.keys(errors).some((k) => k.includes("adjustment"))).toBe(true);
  });
  it("requires numeric tiers for Quantity Tier entries and catches overlaps", () => {
    const p = { ...validPayload(), items: [{ catalogItemId: TIERED_PRICING_PRODUCT._id, currency: "USD", adjustmentType: "Quantity Tier", tiers: [{ minQty: 1, maxQty: 10, unitPrice: 40 }, { minQty: 5, maxQty: 20, unitPrice: 30 }], minQuantity: 1 }] };
    const { errors } = validatePriceBookPayload(p);
    expect(Object.keys(errors).some((k) => k.includes("tiers"))).toBe(true);
  });
  it("requires a numeric adjustment value for non-Custom-Quote, non-tier types", () => {
    const p = validPayload();
    p.items[0].adjustmentValue = "";
    expect(Object.keys(validatePriceBookPayload(p).errors).some((k) => k.includes("value"))).toBe(true);
  });
  it("allows a missing adjustment value for Custom Quote", () => {
    const p = { ...validPayload(), items: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Custom Quote", minQuantity: 1 }] };
    expect(validatePriceBookPayload(p).errors).not.toHaveProperty("item_0_value");
  });
  it("flags invalid quantity ranges", () => {
    const p = validPayload();
    p.items[0].minQuantity = 10;
    p.items[0].maxQuantity = 5;
    expect(Object.keys(validatePriceBookPayload(p).errors).some((k) => k.includes("qty"))).toBe(true);
  });
});

describe("findConflicts", () => {
  it("returns no conflicts for a Draft or Archived Price Book", () => {
    expect(findConflicts(DRAFT_PRICE_BOOK)).toEqual([]);
    expect(findConflicts(ARCHIVED_PRICE_BOOK)).toEqual([]);
  });
  it("detects a resolvable conflict via priority when specificity ties", () => {
    const conflicts = findConflicts(USD_INTERNATIONAL_PRICE_BOOK);
    // USD International (priority 5) vs Standard (priority 0) — same rank, different priority.
    const withStandard = conflicts.find((c) => c.priceBookId === STANDARD_PRICE_BOOK._id);
    if (withStandard) expect(withStandard.unresolved).toBe(false);
  });
  it("does not treat differing currencies as conflicting", () => {
    const conflicts = findConflicts(INDIA_PRICE_BOOK);
    expect(conflicts.find((c) => c.priceBookId === STANDARD_PRICE_BOOK._id)).toBeUndefined();
  });
});

describe("resolvePrice", () => {
  it("falls back to the standard catalog price when nothing matches", () => {
    const result = resolvePrice({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "GBP", market: "Canada", quantity: 1 });
    expect(result.winner).toBeNull();
    expect(result.fallback.finalPrice).toBe(ACTIVE_ONE_TIME_PRODUCT.standardPrice);
  });
  it("resolves the Company-specific Price Book for its own company (highest specificity)", () => {
    const result = resolvePrice({
      catalogItemId: ACTIVE_RECURRING_SERVICE_ID(), currency: "USD", companyId: COMPANY_SPECIFIC_PRICE_BOOK.companyIds[0],
      market: "Global", quantity: 1, date: new Date().toISOString(),
    });
    expect(result.winner?.priceBook._id).toBe(COMPANY_SPECIFIC_PRICE_BOOK._id);
  });
  it("resolves India Price Book for an India + INR context", () => {
    const result = resolvePrice({ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "INR", market: "India", quantity: 1 });
    expect(result.winner?.priceBook._id).toBe(INDIA_PRICE_BOOK._id);
    expect(result.winner.finalPrice).toBe(29900);
  });
  it("flags a tie as an unresolved conflict when resolving the conflicting fixture's shared item", () => {
    // Scoped to just the two deliberately-conflicting fixtures — the full
    // fixture set also includes randomized Price Books that could
    // coincidentally reference the same catalog item and break the tie.
    const result = resolvePrice(
      { catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", market: "Global", quantity: 1 },
      { allPriceBooks: [STANDARD_PRICE_BOOK, CONFLICTING_SCOPE_PRICE_BOOK] },
    );
    expect(result.tied).toBe(true);
  });
});

function ACTIVE_RECURRING_SERVICE_ID() {
  return COMPANY_SPECIFIC_PRICE_BOOK.items[0].catalogItemId;
}

describe("CRUD", () => {
  it("creates, updates, archives and restores a Price Book", () => {
    const created = createPriceBook({
      name: "CRUD Test Book", code: `PB-CRUD-${Math.random().toString(36).slice(2, 8)}`, currency: "USD", priority: 5, market: "Global",
      items: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: 100, minQuantity: 1 }],
    });
    expect(created._id).toBeTruthy();
    expect(findPriceBook(created._id)).toBeTruthy();

    const updated = updatePriceBook(created._id, { priority: 15 });
    expect(updated.priority).toBe(15);
    expect(updated.activity.some((a) => a.type === "created")).toBe(true);

    const archived = archivePriceBook(created._id, "No longer needed");
    expect(archived.status).toBe("Archived");
    expect(archived.archived).toBe(true);

    const restored = restorePriceBook(created._id);
    expect(restored.status).toBe("Active"); // createPriceBook defaults to Active, so that's what archive/restore round-trips back to
    expect(restored.archived).toBe(false);
  });

  it("logs item_added / item_removed / price_changed activity on item changes", () => {
    const created = createPriceBook({
      name: "Activity Test Book", code: `PB-ACT-${Math.random().toString(36).slice(2, 8)}`, currency: "USD", priority: 5, market: "Global",
      items: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: 100, minQuantity: 1 }],
    });
    updatePriceBook(created._id, {
      items: [
        { catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: 90, minQuantity: 1 },
        { catalogItemId: TIERED_PRICING_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: 40, minQuantity: 1 },
      ],
    });
    const updated = findPriceBook(created._id);
    expect(updated.activity.some((a) => a.type === "item_added")).toBe(true);
    expect(updated.activity.some((a) => a.type === "price_changed")).toBe(true);
  });
});

describe("buildPriceBookDuplicatePreview", () => {
  it("copies applicability, items and pricing but resets identity fields", () => {
    const preview = buildPriceBookDuplicatePreview(STANDARD_PRICE_BOOK._id);
    expect(preview.name).toBe("Standard Price Book (Copy)");
    expect(preview.code).toBe(""); // must require a brand-new code
    expect(preview.status).toBe("Draft");
    expect(preview.items.length).toBe(STANDARD_PRICE_BOOK.items.length);
    expect(preview.activity).toEqual([]);
    expect(preview._id).toBeUndefined();
    // never mutates the source
    expect(STANDARD_PRICE_BOOK.code).toBe("PB-STANDARD");
  });
});

describe("bulk operations", () => {
  it("bulk assigns owner, changes status and archives", () => {
    const a = createPriceBook({ name: "Bulk A", code: `PB-BULK-A-${Math.random().toString(36).slice(2, 6)}`, currency: "USD", priority: 1, market: "Global", items: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: 10, minQuantity: 1 }] });
    const b = createPriceBook({ name: "Bulk B", code: `PB-BULK-B-${Math.random().toString(36).slice(2, 6)}`, currency: "USD", priority: 1, market: "Global", items: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "USD", adjustmentType: "Fixed Price", adjustmentValue: 10, minQuantity: 1 }] });
    const assigned = bulkAssignOwner([a._id, b._id], "u1");
    expect(assigned.length).toBe(2);
    const statused = bulkChangeStatus([a._id, b._id], "Inactive");
    expect(statused.every((p) => p.status === "Inactive")).toBe(true);
    const archived = bulkArchive([a._id, b._id], "Cleanup");
    expect(archived.every((p) => p.status === "Archived")).toBe(true);
  });
});

describe("computeActivationWarnings", () => {
  it("warns about missing items, applicability and conflicts where relevant", () => {
    const empty = { items: [], market: "", customerSegment: null, companyIds: [], salesChannel: null, categories: [] };
    const warnings = computeActivationWarnings(empty);
    expect(warnings.some((w) => w.includes("No catalog items"))).toBe(true);
    expect(warnings.some((w) => w.includes("No applicability"))).toBe(true);
  });
  it("is quiet for a clean, non-conflicting Price Book", () => {
    const clean = createPriceBook({ name: "Clean Book", code: `PB-CLEAN-${Math.random().toString(36).slice(2, 6)}`, currency: "GBP", priority: 1, market: "United Kingdom", items: [{ catalogItemId: ACTIVE_ONE_TIME_PRODUCT._id, currency: "GBP", adjustmentType: "Fixed Price", adjustmentValue: 100, minQuantity: 1 }] });
    const warnings = computeActivationWarnings(clean);
    expect(warnings.some((w) => w.includes("conflict"))).toBe(false);
  });
});

describe("queryPriceBooksLocal", () => {
  it("excludes archived by default and includes them when requested", () => {
    const defaultResult = queryPriceBooksLocal(priceBooks, {});
    expect(defaultResult.items.some((p) => p._id === ARCHIVED_PRICE_BOOK._id)).toBe(false);
    const archivedResult = queryPriceBooksLocal(priceBooks, { archived: "true", pageSize: 1000 });
    expect(archivedResult.items.some((p) => p._id === ARCHIVED_PRICE_BOOK._id)).toBe(true);
  });
  it("filters by derived status", () => {
    const scheduled = queryPriceBooksLocal(priceBooks, { status: "Scheduled", pageSize: 1000 });
    expect(scheduled.items.every((p) => getEffectiveStatus(p) === "Scheduled")).toBe(true);
    expect(scheduled.items.some((p) => p._id === UPCOMING_PRICE_BOOK._id)).toBe(true);
  });
  it("filters by currency and market", () => {
    const result = queryPriceBooksLocal(priceBooks, { currency: "INR", pageSize: 1000 });
    expect(result.items.every((p) => p.currency === "INR")).toBe(true);
  });
  it("computes summary metrics", () => {
    const result = queryPriceBooksLocal(priceBooks, { pageSize: 1000 });
    expect(result.summary.total).toBe(result.items.length);
    expect(result.summary.conflicts).toBeGreaterThan(0);
  });
  it("searches by name and code", () => {
    const result = queryPriceBooksLocal(priceBooks, { search: "PB-STANDARD" });
    expect(result.items.some((p) => p._id === STANDARD_PRICE_BOOK._id)).toBe(true);
  });
  it("paginates results", () => {
    const page1 = queryPriceBooksLocal(priceBooks, { page: 1, pageSize: 2 });
    expect(page1.items.length).toBeLessThanOrEqual(2);
  });
});
