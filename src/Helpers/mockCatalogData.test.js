import { describe, it, expect } from "vitest";
import {
  catalogItems, findCatalogItem, activeDealsUsingItem, allDealsUsingItem,
  DEAL_LINKED_PRODUCT, STARTER_BUNDLE_PACKAGE, ACTIVE_ONE_TIME_PRODUCT, ACTIVE_RECURRING_SERVICE,
  CUSTOM_QUOTE_PRODUCT, USAGE_BASED_SERVICE, MISSING_PRICE_PRODUCT, UPCOMING_PRICE_CHANGE_PRODUCT,
  DRAFT_PRODUCT, ARCHIVED_PRODUCT, MULTI_CURRENCY_PRODUCT, TIERED_PRICING_PRODUCT,
  validateCatalogPayload, wouldCreateCircularPackage, computeMarginPreview, buildDuplicatePreview,
  needsAttentionReasons, isMissingPrice, isPricingExpired, isDraftOlderThanPreviewWindow,
  queryCatalogLocal, createCatalogItem, updateCatalogItem, archiveCatalogItem, restoreCatalogItem,
  bulkAssignOwner, bulkChangeCategory, bulkChangeStatus, bulkTag, bulkArchive,
  CATALOG_TYPES, CATALOG_STATUSES, BILLING_MODELS, BILLING_INTERVALS,
} from "./mockCatalogData";

describe("mockCatalogData — enumerations", () => {
  it("defines exactly the four record types from the spec", () => {
    expect(CATALOG_TYPES).toEqual(["Product", "Service", "Package", "Add-on"]);
  });
  it("defines exactly the four statuses, and never a Deleted status", () => {
    expect(CATALOG_STATUSES).toEqual(["Draft", "Active", "Inactive", "Archived"]);
    expect(CATALOG_STATUSES).not.toContain("Deleted");
  });
  it("defines the four billing models", () => {
    expect(BILLING_MODELS).toEqual(["One Time", "Recurring", "Usage Based", "Custom Quote"]);
  });
  it("defines all five recurring intervals plus a custom preview", () => {
    expect(BILLING_INTERVALS).toEqual(["Weekly", "Monthly", "Quarterly", "Semiannual", "Annual", "Custom"]);
  });
});

describe("mockCatalogData — curated fixtures cover every named scenario", () => {
  it("has a Package whose included items resolve to real catalog records", () => {
    expect(STARTER_BUNDLE_PACKAGE.type).toBe("Package");
    expect(STARTER_BUNDLE_PACKAGE.includedItems.length).toBeGreaterThan(1);
    for (const inc of STARTER_BUNDLE_PACKAGE.includedItems) expect(findCatalogItem(inc.itemId)).toBeTruthy();
  });
  it("has a Custom-Quote Product with no standard price", () => {
    expect(CUSTOM_QUOTE_PRODUCT.billingModel).toBe("Custom Quote");
    expect(CUSTOM_QUOTE_PRODUCT.standardPrice).toBeNull();
  });
  it("has a Usage-Based Service with billing unit, included usage and overage price", () => {
    expect(USAGE_BASED_SERVICE.usageConfig.billingUnit).toBeTruthy();
    expect(USAGE_BASED_SERVICE.usageConfig.includedUsage).toBeGreaterThan(0);
    expect(USAGE_BASED_SERVICE.usageConfig.overagePrice).toBeGreaterThan(0);
  });
  it("has a Product priced in multiple currencies", () => {
    expect(MULTI_CURRENCY_PRODUCT.alternativePrices.length).toBeGreaterThanOrEqual(2);
  });
  it("has a Product with a tiered pricing preview", () => {
    expect(TIERED_PRICING_PRODUCT.tieredPricing.length).toBeGreaterThanOrEqual(3);
  });
  it("has a Draft Product old enough to need attention", () => {
    expect(DRAFT_PRODUCT.status).toBe("Draft");
    expect(isDraftOlderThanPreviewWindow(DRAFT_PRODUCT)).toBe(true);
  });
  it("has an Archived Product that preserves its pre-archive status for restore", () => {
    expect(ARCHIVED_PRODUCT.status).toBe("Archived");
    expect(ARCHIVED_PRODUCT.statusBeforeArchive).toBeTruthy();
  });
  it("has a Product with missing pricing distinct from a Custom-Quote item", () => {
    expect(isMissingPrice(MISSING_PRICE_PRODUCT)).toBe(true);
    expect(isMissingPrice(CUSTOM_QUOTE_PRODUCT)).toBe(false); // missing price is expected/correct for Custom Quote
  });
  it("has a Product with a real upcoming price change", () => {
    expect(UPCOMING_PRICE_CHANGE_PRODUCT.upcomingPriceChange.newPrice).toBeGreaterThan(UPCOMING_PRICE_CHANGE_PRODUCT.standardPrice);
  });
  it("DEAL_LINKED_PRODUCT is genuinely referenced by a real, active Deal (not just a fixture claim)", () => {
    expect(activeDealsUsingItem(DEAL_LINKED_PRODUCT._id).length).toBeGreaterThan(0);
    expect(allDealsUsingItem(DEAL_LINKED_PRODUCT._id).length).toBeGreaterThanOrEqual(activeDealsUsingItem(DEAL_LINKED_PRODUCT._id).length);
  });
});

describe("mockCatalogData — needsAttentionReasons / isMissingPrice / isPricingExpired", () => {
  it("flags a missing price only when the billing model actually requires one", () => {
    expect(isMissingPrice({ billingModel: "One Time", standardPrice: null })).toBe(true);
    expect(isMissingPrice({ billingModel: "Custom Quote", standardPrice: null })).toBe(false);
    expect(isMissingPrice({ billingModel: "Usage Based", standardPrice: null })).toBe(false);
  });
  it("flags expired pricing based on the expiration date", () => {
    expect(isPricingExpired({ expirationDate: "2020-01-01" })).toBe(true);
    expect(isPricingExpired({ expirationDate: null })).toBe(false);
  });
  it("collects every applicable reason, not just the first", () => {
    const reasons = needsAttentionReasons({ status: "Active", billingModel: "One Time", standardPrice: null, category: "", expirationDate: "2020-01-01" });
    expect(reasons).toEqual(expect.arrayContaining(["Missing price", "Missing category", "Expired pricing"]));
  });
});

describe("mockCatalogData — computeMarginPreview", () => {
  it("computes margin amount and percent", () => {
    expect(computeMarginPreview(100, 60)).toEqual({ marginAmount: 40, marginPercent: 40 });
  });
  it("handles zero price safely instead of dividing by zero", () => {
    expect(computeMarginPreview(0, 0)).toEqual({ marginAmount: 0, marginPercent: 0 });
  });
  it("returns null when cost or price is unavailable, rather than a misleading number", () => {
    expect(computeMarginPreview(null, 10)).toBeNull();
    expect(computeMarginPreview(100, null)).toBeNull();
  });
});

describe("mockCatalogData — validateCatalogPayload", () => {
  it("requires a name", () => {
    expect(validateCatalogPayload({ type: "Product" }).errors.name).toBeTruthy();
  });
  it("requires a SKU for Products and Services but not Packages or Add-ons", () => {
    expect(validateCatalogPayload({ name: "X", type: "Product" }).errors.sku).toBeTruthy();
    expect(validateCatalogPayload({ name: "X", type: "Service" }).errors.sku).toBeTruthy();
    expect(validateCatalogPayload({ name: "X", type: "Package", includedItems: [{ itemId: "a" }] }).errors.sku).toBeUndefined();
    expect(validateCatalogPayload({ name: "X", type: "Add-on" }).errors.sku).toBeUndefined();
  });
  it("warns (does not error) on a duplicate SKU", () => {
    const { warnings, errors } = validateCatalogPayload({ name: "New Item", type: "Product", sku: DEAL_LINKED_PRODUCT.sku });
    expect(warnings.sku).toBeTruthy();
    expect(errors.sku).toBeUndefined();
  });
  it("rejects an invalid category or currency", () => {
    expect(validateCatalogPayload({ name: "X", type: "Product", sku: "S1", category: "Not A Real Category" }).errors.category).toBeTruthy();
    expect(validateCatalogPayload({ name: "X", type: "Product", sku: "S1", currency: "ZZZ" }).errors.currency).toBeTruthy();
  });
  it("rejects a negative price", () => {
    expect(validateCatalogPayload({ name: "X", type: "Product", sku: "S1", standardPrice: -5 }).errors.standardPrice).toBeTruthy();
  });
  it("rejects an invalid min/max quantity relationship", () => {
    expect(validateCatalogPayload({ name: "X", type: "Product", sku: "S1", minQuantity: 10, maxQuantity: 5 }).errors.maxQuantity).toBeTruthy();
    expect(validateCatalogPayload({ name: "X", type: "Product", sku: "S1", minQuantity: -1 }).errors.minQuantity).toBeTruthy();
  });
  it("requires the effective date to precede the expiration date", () => {
    const { errors } = validateCatalogPayload({ name: "X", type: "Product", sku: "S1", effectiveDate: "2026-06-01", expirationDate: "2026-01-01" });
    expect(errors.expirationDate).toBeTruthy();
  });
  it("requires a billing interval for recurring items", () => {
    expect(validateCatalogPayload({ name: "X", type: "Service", sku: "S1", billingModel: "Recurring" }).errors.billingInterval).toBeTruthy();
    expect(validateCatalogPayload({ name: "X", type: "Service", sku: "S1", billingModel: "Recurring", billingInterval: "Monthly" }).errors.billingInterval).toBeUndefined();
  });
  it("requires a billing unit for usage-based items", () => {
    expect(validateCatalogPayload({ name: "X", type: "Service", sku: "S1", billingModel: "Usage Based", usageConfig: {} }).errors.usageBillingUnit).toBeTruthy();
    expect(validateCatalogPayload({ name: "X", type: "Service", sku: "S1", billingModel: "Usage Based", usageConfig: { billingUnit: "API Call" } }).errors.usageBillingUnit).toBeUndefined();
  });
  it("requires a Package to contain at least one item", () => {
    expect(validateCatalogPayload({ name: "X", type: "Package", includedItems: [] }).errors.includedItems).toBeTruthy();
  });
  it("rejects a Package that includes itself", () => {
    const { errors } = validateCatalogPayload(
      { name: "X", type: "Package", includedItems: [{ itemId: "self-id" }] },
      { excludeId: "self-id" }
    );
    expect(errors.includedItems).toBeTruthy();
  });
});

describe("mockCatalogData — wouldCreateCircularPackage", () => {
  it("is false for a brand-new (not-yet-saved) package", () => {
    expect(wouldCreateCircularPackage(null, [ACTIVE_ONE_TIME_PRODUCT._id])).toBe(false);
  });
  it("is false when there is no cycle", () => {
    expect(wouldCreateCircularPackage(ACTIVE_RECURRING_SERVICE._id, [ACTIVE_ONE_TIME_PRODUCT._id], catalogItems)).toBe(false);
  });
  it("detects a real cycle: A includes B, and B is asked to include A", () => {
    const allItems = [
      { _id: "pkg-a", type: "Package", includedItems: [{ itemId: "pkg-b" }] },
      { _id: "pkg-b", type: "Package", includedItems: [] },
    ];
    expect(wouldCreateCircularPackage("pkg-b", ["pkg-a"], allItems)).toBe(true);
  });
  it("detects an indirect (multi-hop) cycle", () => {
    const allItems = [
      { _id: "pkg-a", type: "Package", includedItems: [{ itemId: "pkg-b" }] },
      { _id: "pkg-b", type: "Package", includedItems: [{ itemId: "pkg-c" }] },
      { _id: "pkg-c", type: "Package", includedItems: [] },
    ];
    expect(wouldCreateCircularPackage("pkg-c", ["pkg-a"], allItems)).toBe(true);
  });
});

describe("mockCatalogData — buildDuplicatePreview", () => {
  it("never mutates the live catalog", () => {
    const before = catalogItems.length;
    buildDuplicatePreview(DEAL_LINKED_PRODUCT._id);
    expect(catalogItems.length).toBe(before);
  });
  it("generates a clearly-editable new name and clears history/usage", () => {
    const preview = buildDuplicatePreview(DEAL_LINKED_PRODUCT._id);
    expect(preview.name).toBe(`${DEAL_LINKED_PRODUCT.name} (Copy)`);
    expect(preview.status).toBe("Draft");
    expect(preview.activity).toEqual([]);
    expect(preview.auditLog).toEqual([]);
  });
  it("suggests a non-conflicting SKU rather than duplicating the original", () => {
    const preview = buildDuplicatePreview(DEAL_LINKED_PRODUCT._id);
    expect(preview.sku).not.toBe(DEAL_LINKED_PRODUCT.sku);
    expect(catalogItems.some((c) => c.sku === preview.sku)).toBe(false);
  });
});

describe("mockCatalogData — CRUD + archive/restore", () => {
  it("createCatalogItem adds a new item to the front of the catalog", () => {
    const before = catalogItems.length;
    const item = createCatalogItem({ name: "Test Item", type: "Product", sku: "TEST-1", standardPrice: 10 }, "Tester");
    expect(catalogItems.length).toBe(before + 1);
    expect(catalogItems[0]._id).toBe(item._id);
  });

  it("updateCatalogItem logs a pricing_changed activity entry when the price changes", () => {
    const item = createCatalogItem({ name: "Priced Item", type: "Product", sku: "TEST-2", standardPrice: 10 }, "Tester");
    updateCatalogItem(item._id, { standardPrice: 20 }, "Tester");
    expect(item.activity.some((a) => a.type === "pricing_changed")).toBe(true);
  });

  it("archiveCatalogItem requires a reason to be recorded and preserves the pre-archive status for restore", () => {
    const item = createCatalogItem({ name: "Archivable Item", type: "Product", sku: "TEST-3", standardPrice: 10, status: "Inactive" }, "Tester");
    archiveCatalogItem(item._id, "No longer sold", "Tester");
    expect(item.status).toBe("Archived");
    expect(item.archived).toBe(true);
    expect(item.archiveReason).toBe("No longer sold");
    expect(item.statusBeforeArchive).toBe("Inactive");
  });

  it("restoreCatalogItem returns the item to its pre-archive status, not a hardcoded default", () => {
    const item = createCatalogItem({ name: "Restorable Item", type: "Product", sku: "TEST-4", standardPrice: 10, status: "Inactive" }, "Tester");
    archiveCatalogItem(item._id, "Temporary", "Tester");
    restoreCatalogItem(item._id, "Tester");
    expect(item.status).toBe("Inactive");
    expect(item.archived).toBe(false);
  });

  it("bulk helpers apply to every id given", () => {
    const a = createCatalogItem({ name: "Bulk A", type: "Product", sku: "BULK-A", standardPrice: 10 }, "Tester");
    const b = createCatalogItem({ name: "Bulk B", type: "Product", sku: "BULK-B", standardPrice: 10 }, "Tester");
    bulkAssignOwner([a._id, b._id], "u2", "Tester");
    expect(a.ownerId).toBe("u2");
    expect(b.ownerId).toBe("u2");
    bulkChangeCategory([a._id, b._id], "Hardware", "Tester");
    expect(a.category).toBe("Hardware");
    bulkChangeStatus([a._id, b._id], "Inactive", "Tester");
    expect(a.status).toBe("Inactive");
    bulkTag([a._id, b._id], "featured", "Tester");
    expect(a.tags).toContain("featured");
    bulkArchive([a._id, b._id], "Bulk cleanup", "Tester");
    expect(a.status).toBe("Archived");
    expect(b.status).toBe("Archived");
  });
});

describe("mockCatalogData — queryCatalogLocal", () => {
  it("filters by type", () => {
    const result = queryCatalogLocal(catalogItems, { type: "Package", pageSize: 100 });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((i) => i.type === "Package")).toBe(true);
  });
  it("filters to items missing a price", () => {
    const result = queryCatalogLocal(catalogItems, { missingPrice: "true", pageSize: 100 });
    expect(result.items.some((i) => i._id === MISSING_PRICE_PRODUCT._id)).toBe(true);
    expect(result.items.every((i) => isMissingPrice(i))).toBe(true);
  });
  it("filters to items used in active Deals", () => {
    const result = queryCatalogLocal(catalogItems, { usedInActiveDeals: "true", pageSize: 100 });
    expect(result.items.some((i) => i._id === DEAL_LINKED_PRODUCT._id)).toBe(true);
  });
  it("excludes archived items by default and includes them only when asked", () => {
    const defaultResult = queryCatalogLocal(catalogItems, { pageSize: 200 });
    expect(defaultResult.items.some((i) => i._id === ARCHIVED_PRODUCT._id)).toBe(false);
    const archivedResult = queryCatalogLocal(catalogItems, { archived: "true", pageSize: 200 });
    expect(archivedResult.items.some((i) => i._id === ARCHIVED_PRODUCT._id)).toBe(true);
  });
  it("computes a summary from the filtered set", () => {
    const result = queryCatalogLocal(catalogItems, { type: "Service", pageSize: 100 });
    expect(result.summary.total).toBe(result.items.length);
    expect(result.summary.services).toBe(result.items.length);
  });
  it("paginates correctly", () => {
    const page1 = queryCatalogLocal(catalogItems, { page: 1, pageSize: 5 });
    const page2 = queryCatalogLocal(catalogItems, { page: 2, pageSize: 5 });
    expect(page1.items).toHaveLength(5);
    expect(page2.items[0]._id).not.toBe(page1.items[0]._id);
  });
  it("searches across name, SKU, category and description", () => {
    const result = queryCatalogLocal(catalogItems, { search: DEAL_LINKED_PRODUCT.sku, pageSize: 100 });
    expect(result.items.some((i) => i._id === DEAL_LINKED_PRODUCT._id)).toBe(true);
  });
});
