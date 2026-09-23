// Backend-mode data source for Products & Services and Price Books
// (VITE_BACKEND_CRM_SALES_MODE=true). Both UIs keep the whole list in the
// store and filter client-side, so lists load every record (archived too).
// Field names already match the backend's apart from ownerId and a price
// book's entries (`items` in the UI).
import * as sales from "./backendSalesClient";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "./backendCrmClient";
import { orgId, ownersMap, ownerFields, listAll } from "./crmBackendCommon";

export const BACKEND_ENABLED = BACKEND_CRM_SALES_MODE_ENABLED;

const withoutUiOnly = (payload, extra = []) => {
  const out = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (["ownerName", "activity", "auditLog", "files", "createdBy", "updatedBy", "archived", "archiveReason", "archivedAt", "statusBeforeArchive", ...extra].includes(key)) continue;
    if (key === "ownerId") out.ownerMembershipId = value || null;
    else out[key] = value;
  }
  return out;
};

async function loadAll(listPage, key) {
  const organizationId = orgId();
  const fetchAll = (archived) =>
    listAll(async (page, pageSize) => {
      const data = await listPage(organizationId, { page, pageSize, archived });
      return { items: data[key] || [], total: data.total };
    });
  const [active, archived] = await Promise.all([fetchAll("false"), fetchAll("true")]);
  return [...active, ...archived];
}

// --- Products & Services ---

export function toUiProduct(item, ownersById = new Map()) {
  if (!item) return item;
  return {
    ...item,
    ...ownerFields(item, ownersById),
    standardPrice: Number(item.standardPrice) || 0,
    costPreview: item.costPreview == null ? item.costPreview : Number(item.costPreview),
    promotionalPrice: item.promotionalPrice == null ? null : Number(item.promotionalPrice),
    tags: Array.isArray(item.tags) ? item.tags : [],
    files: Array.isArray(item.files) ? item.files : [],
    auditLog: [],
  };
}

export const toApiProduct = (payload) => withoutUiOnly(payload);

export async function listProducts() {
  const [items, owners] = await Promise.all([loadAll(sales.listCatalogItems, "products"), ownersMap()]);
  return items.map((i) => toUiProduct(i, owners));
}

export async function getProduct(id) {
  const [{ product }, owners] = await Promise.all([sales.getCatalogItem(orgId(), id), ownersMap()]);
  return toUiProduct(product, owners);
}

export async function createProduct(payload) {
  const { product } = await sales.createCatalogItem(orgId(), toApiProduct(payload));
  return getProduct(product._id);
}

export async function updateProduct(id, changes) {
  await sales.updateCatalogItem(orgId(), id, toApiProduct(changes));
  return getProduct(id);
}

export async function archiveProduct(id, reason) {
  await sales.archiveCatalogItem(orgId(), id, reason);
  return getProduct(id);
}

export async function restoreProduct(id) {
  await sales.restoreCatalogItem(orgId(), id);
  return getProduct(id);
}

async function bulkProducts(payload) {
  await sales.bulkCatalogItems(orgId(), payload);
  return Promise.all(payload.ids.map((id) => getProduct(id).catch(() => null))).then((list) => list.filter(Boolean));
}

export const bulkAssignProducts = (ids, ownerId) => bulkProducts({ action: "assign", ids, ownerMembershipId: ownerId });
export const bulkCategoryProducts = (ids, category) => bulkProducts({ action: "category", ids, category });
export const bulkStatusProducts = (ids, status) => bulkProducts({ action: "status", ids, status });
export const bulkArchiveProducts = (ids, reason) => bulkProducts({ action: "archive", ids, reason });

// --- Price Books ---

function toUiEntry(entry) {
  return {
    ...entry,
    adjustmentValue: Number(entry.adjustmentValue) || 0,
    tiers: Array.isArray(entry.tiers) ? entry.tiers : [],
  };
}

export function toUiPriceBook(priceBook, ownersById = new Map()) {
  if (!priceBook) return priceBook;
  const { entries, ...rest } = priceBook;
  return {
    ...rest,
    ...ownerFields(priceBook, ownersById),
    items: (entries || []).map(toUiEntry),
    companyIds: Array.isArray(priceBook.companyIds) ? priceBook.companyIds : [],
    categories: Array.isArray(priceBook.categories) ? priceBook.categories : [],
    dealTypes: Array.isArray(priceBook.dealTypes) ? priceBook.dealTypes : [],
    contractTypes: Array.isArray(priceBook.contractTypes) ? priceBook.contractTypes : [],
    tags: Array.isArray(priceBook.tags) ? priceBook.tags : [],
    activity: [],
    auditLog: [],
  };
}

export const toApiPriceBook = (payload) => withoutUiOnly(payload, ["items", "entries", "activity"]);

const ENTRY_FIELDS = ["currency", "adjustmentType", "adjustmentValue", "tiers", "minQuantity", "maxQuantity", "billingInterval", "effectiveDate", "expirationDate", "notes", "enabled"];
const pickEntry = (entry) => Object.fromEntries(ENTRY_FIELDS.filter((f) => f in entry).map((f) => [f, entry[f]]));

// The UI edits a price book's items as one list; the backend stores entries
// separately. Sync: update entries that exist, create new ones, delete ones
// the list dropped.
async function syncEntries(priceBookId, items) {
  const organizationId = orgId();
  const { priceBook } = await sales.getPriceBook(organizationId, priceBookId);
  const existing = new Map((priceBook.entries || []).map((e) => [e._id, e]));
  const kept = new Set();
  for (const item of items) {
    if (item._id && existing.has(item._id)) {
      kept.add(item._id);
      await sales.updatePriceBookEntry(organizationId, priceBookId, item._id, pickEntry(item));
    } else {
      await sales.createPriceBookEntry(organizationId, priceBookId, { catalogItemId: item.catalogItemId, ...pickEntry(item) });
    }
  }
  for (const id of existing.keys()) {
    if (!kept.has(id)) await sales.deletePriceBookEntry(organizationId, priceBookId, id);
  }
}

export async function listPriceBooks() {
  const [priceBooks, owners] = await Promise.all([loadAll(sales.listPriceBooks, "priceBooks"), ownersMap()]);
  return priceBooks.map((pb) => toUiPriceBook(pb, owners));
}

export async function getPriceBook(id) {
  const [{ priceBook }, owners] = await Promise.all([sales.getPriceBook(orgId(), id), ownersMap()]);
  return toUiPriceBook(priceBook, owners);
}

export async function createPriceBook(payload) {
  const { priceBook } = await sales.createPriceBook(orgId(), toApiPriceBook(payload));
  if (payload.items?.length) await syncEntries(priceBook._id, payload.items);
  return getPriceBook(priceBook._id);
}

export async function updatePriceBook(id, changes) {
  const apiChanges = toApiPriceBook(changes);
  if (Object.keys(apiChanges).length) await sales.updatePriceBook(orgId(), id, apiChanges);
  if (changes.items) await syncEntries(id, changes.items);
  return getPriceBook(id);
}

export async function archivePriceBook(id, reason) {
  await sales.archivePriceBook(orgId(), id, reason);
  return getPriceBook(id);
}

export async function restorePriceBook(id) {
  await sales.restorePriceBook(orgId(), id);
  return getPriceBook(id);
}

async function bulkPriceBooks(payload) {
  await sales.bulkPriceBooks(orgId(), payload);
  return Promise.all(payload.ids.map((id) => getPriceBook(id).catch(() => null))).then((list) => list.filter(Boolean));
}

export const bulkAssignPriceBooks = (ids, ownerId) => bulkPriceBooks({ action: "assign", ids, ownerMembershipId: ownerId });
export const bulkStatusPriceBooks = (ids, status) => bulkPriceBooks({ action: "status", ids, status });
export const bulkArchivePriceBooksById = (ids, reason) => bulkPriceBooks({ action: "archive", ids, reason });
