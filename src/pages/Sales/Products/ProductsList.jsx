import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Plus, Search, RefreshCw, Download, Upload, ChevronUp, ChevronDown, Columns3,
  X, AlertCircle, ChevronLeft, ChevronRight, Bookmark, MoreHorizontal, PackageSearch,
} from "lucide-react";
import {
  fetchProducts, updateProduct, archiveProduct, restoreProduct, bulkAssignOwner, bulkChangeCategory,
  bulkChangeStatus, bulkTagProducts, bulkArchiveProducts,
} from "../../../redux/sales/productsSlice";
import {
  queryCatalogLocal, needsAttentionReasons, activeDealsUsingItem, CATALOG_TYPES, CATALOG_STATUSES,
  BILLING_MODELS, BILLING_INTERVALS, CATALOG_CURRENCIES, CATALOG_CATEGORIES, TAX_CATEGORIES,
} from "../../../Helpers/mockCatalogData";
import { CRM_TEAM, findTeamMember } from "../../../Helpers/mockUsersData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import useDebounced from "../../../hooks/useDebounced";
import { formatMoney, formatPricingLabel, formatDate, TYPE_COLORS, STATUS_COLORS } from "./catalogUtils";
import ProductFormModal from "./ProductFormModal";
import AddToDealModal from "./AddToDealModal";

const ALL_COLUMNS = [
  { key: "type", label: "Type", optional: false },
  { key: "category", label: "Category", optional: false },
  { key: "billingModel", label: "Billing Model", optional: false },
  { key: "price", label: "Standard Price", optional: false },
  { key: "currency", label: "Currency", optional: false },
  { key: "billingInterval", label: "Billing Interval", optional: false },
  { key: "status", label: "Status", optional: false },
  { key: "activeDeals", label: "Active Deals", optional: false },
  { key: "updatedAt", label: "Last Updated", optional: false },
  { key: "taxCategory", label: "Tax Category", optional: true },
  { key: "unit", label: "Unit", optional: true },
  { key: "cost", label: "Cost", optional: true },
  { key: "margin", label: "Margin Preview", optional: true },
  { key: "effectiveDate", label: "Effective Date", optional: true },
  { key: "expirationDate", label: "Expiration Date", optional: true },
  { key: "owner", label: "Owner", optional: true },
  { key: "tags", label: "Tags", optional: true },
];
const DEFAULT_VISIBLE = ALL_COLUMNS.filter((c) => !c.optional).map((c) => c.key);
const COLUMN_PREF_KEY = "sales.products.visibleColumns";
const SAVED_VIEWS_KEY = "sales.products.savedViews";

const FILTER_LABELS = {
  type: "Type", category: "Category", status: "Status", billingModel: "Billing Model", billingInterval: "Billing Interval",
  currency: "Currency", priceMin: "Min Price", priceMax: "Max Price", discountEligible: "Discount Eligible",
  taxCategory: "Tax Category", ownerId: "Owner", tag: "Tag", usedInActiveDeals: "Used in Active Deals",
  missingPrice: "Missing Price", expiredPricing: "Expired Pricing", archived: "Archived", search: "Search",
};

function ownerName(id) {
  if (!id) return "Unassigned";
  return findTeamMember(id)?.name || id;
}

export default function ProductsList() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const { items, loading, error } = useSelector((s) => s.products);
  const canViewCost = role === "Super-Admin" || role === "Admin";

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const debouncedSearch = useDebounced(searchInput, 350);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [showFiltersDrawer, setShowFiltersDrawer] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [openRowMenu, setOpenRowMenu] = useState(null);
  const [rowAction, setRowAction] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [formState, setFormState] = useState(null); // { mode: "add"|"edit"|"duplicate", type, item }

  const [visibleColumns, setVisibleColumns] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLUMN_PREF_KEY)) || DEFAULT_VISIBLE; } catch { return DEFAULT_VISIBLE; }
  });
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)) || []; } catch { return []; }
  });

  useEffect(() => { dispatch(fetchProducts()); }, [dispatch]);

  const params = useMemo(() => {
    const p = {};
    for (const [key, value] of searchParams.entries()) p[key] = value;
    if (debouncedSearch) p.search = debouncedSearch;
    else delete p.search;
    p.page = p.page || "1";
    p.pageSize = p.pageSize || "20";
    p.archived = p.archived || "false";
    p.sort = p.sort || "updatedAt";
    p.order = p.order || "desc";
    return p;
  }, [searchParams, debouncedSearch]);

  const queryResult = useMemo(() => queryCatalogLocal(items, params), [items, params]);
  const { items: pageItems, total, page, pageSize, summary } = queryResult;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const updateParam = (key, value, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === null || value === "") next.delete(key);
    else next.set(key, value);
    if (resetPage) next.set("page", "1");
    setSearchParams(next);
  };
  const clearFilters = () => { setSearchInput(""); setSearchParams({}); };
  const removeFilter = (key) => updateParam(key, undefined);

  useEffect(() => {
    const current = searchParams.get("search") || "";
    if (debouncedSearch === current) return;
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch) next.set("search", debouncedSearch);
    else next.delete("search");
    next.set("page", "1");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const activeFilterEntries = Array.from(searchParams.entries()).filter(([k]) => !["page", "pageSize", "sort", "order"].includes(k) && !(k === "archived" && searchParams.get(k) === "false"));
  const isFiltered = activeFilterEntries.length > 0;

  const toggleSort = (key) => {
    const next = new URLSearchParams(searchParams);
    if (params.sort === key) next.set("order", params.order === "asc" ? "desc" : "asc");
    else { next.set("sort", key); next.set("order", "asc"); }
    setSearchParams(next);
  };
  const toggleColumn = (key) => {
    setVisibleColumns((cols) => {
      const next = cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key];
      localStorage.setItem(COLUMN_PREF_KEY, JSON.stringify(next));
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selected.size === pageItems.length) setSelected(new Set());
    else setSelected(new Set(pageItems.map((c) => c._id)));
  };
  const toggleSelectOne = (id) => setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const applyCardFilter = (key, value) => updateParam(key, value);

  const saveCurrentView = () => {
    const name = window.prompt("Name this view:");
    if (!name?.trim()) return;
    const view = { name: name.trim(), params: Object.fromEntries(searchParams.entries()) };
    const next = [...savedViews.filter((v) => v.name !== view.name), view];
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
  };
  const applyView = (view) => { setSearchParams(view.params); setSearchInput(view.params.search || ""); setShowViews(false); };
  const deleteView = (name) => {
    const next = savedViews.filter((v) => v.name !== name);
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
  };

  const exportRows = (rows, filename) => {
    const data = rows.map((c) => ({
      Name: c.name, SKU: c.sku, Type: c.type, Category: c.category, "Billing Model": c.billingModel,
      "Standard Price": c.standardPrice, Currency: c.currency, "Billing Interval": c.billingInterval || "",
      Status: c.status, Owner: ownerName(c.ownerId), Updated: c.updatedAt,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Catalog");
    XLSX.writeFile(wb, filename);
  };
  const runExport = () => {
    setExporting(true);
    const all = queryCatalogLocal(items, { ...params, page: 1, pageSize: 100000 }).items;
    exportRows(all, `products_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExporting(false);
  };
  const runExportSelected = () => exportRows(pageItems.filter((c) => selected.has(c._id)), `products_selected_${new Date().toISOString().slice(0, 10)}.xlsx`);

  const submitBulk = async () => {
    const itemIds = Array.from(selected);
    if (bulkAction === "assign" && bulkValue) await dispatch(bulkAssignOwner({ itemIds, ownerId: bulkValue }));
    else if (bulkAction === "category" && bulkValue) await dispatch(bulkChangeCategory({ itemIds, category: bulkValue }));
    else if (bulkAction === "status" && bulkValue) await dispatch(bulkChangeStatus({ itemIds, status: bulkValue }));
    else if (bulkAction === "tag" && bulkValue.trim()) await dispatch(bulkTagProducts({ itemIds, tag: bulkValue.trim() }));
    else if (bulkAction === "archive") {
      if (!bulkReason.trim()) return;
      await dispatch(bulkArchiveProducts({ itemIds, reason: bulkReason }));
    }
    setSelected(new Set());
    setBulkAction(null);
    setBulkValue("");
    setBulkReason("");
  };

  const openAdd = (type) => { setShowAddMenu(false); setFormState({ mode: "add", type }); };
  const openEdit = (item) => setFormState({ mode: "edit", item });
  const openDuplicate = (item) => setFormState({ mode: "duplicate", item });

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/sales/dashboard" className="hover:text-gray-300">Sales</Link> / <span className="text-gray-300">Products & Services</span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Products & Services</h1>
          <p className="text-sm text-gray-400 mt-1">
            One shared catalog of Products, Services, Packages and Add-ons used across Deals and future Price Books, Quotes, Orders, Contracts and Invoices. {total} item{total === 1 ? "" : "s"} visible.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => dispatch(fetchProducts())} title="Refresh" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <RefreshCw size={16} /> Refresh
          </button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <Upload size={16} /> Import
          </button>
          <button onClick={runExport} disabled={exporting} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm disabled:opacity-50">
            <Download size={16} /> {exporting ? "Exporting..." : "Export"}
          </button>
          <div className="relative">
            <button onClick={() => setShowAddMenu((v) => !v)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium">
              <Plus size={16} /> Add Item
            </button>
            {showAddMenu && (
              <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-44 shadow-xl">
                {CATALOG_TYPES.map((t) => (
                  <button key={t} role="menuitem" onClick={() => openAdd(t)} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">{t}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <button onClick={clearFilters} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Total Active</p>
          <p className="text-xl font-bold">{summary.activeItems}</p>
        </button>
        <button onClick={() => applyCardFilter("type", "Product")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Products</p>
          <p className="text-xl font-bold">{summary.products}</p>
        </button>
        <button onClick={() => applyCardFilter("type", "Service")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Services</p>
          <p className="text-xl font-bold">{summary.services}</p>
        </button>
        <button onClick={() => applyCardFilter("billingModel", "Recurring")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Recurring</p>
          <p className="text-xl font-bold">{summary.recurringItems}</p>
        </button>
        <button onClick={() => applyCardFilter("billingModel", "Custom Quote")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Custom Quote</p>
          <p className="text-xl font-bold">{summary.customQuoteItems}</p>
        </button>
        <button onClick={() => applyCardFilter("needsAttention", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Needs Attention</p>
          <p className={`text-xl font-bold ${summary.needsAttention > 0 ? "text-amber-400" : ""}`}>{summary.needsAttention}</p>
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative flex-1 min-w-55 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search name, SKU, category..."
            aria-label="Search catalog" className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        </div>

        <div className="hidden lg:flex gap-2 flex-wrap">
          <FilterSelects params={params} updateParam={updateParam} />
        </div>
        <button onClick={() => setShowFiltersDrawer(true)} className="lg:hidden flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
          Filters {isFiltered && `(${activeFilterEntries.length})`}
        </button>

        <div className="relative">
          <button onClick={() => setShowColumns((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <Columns3 size={16} /> Columns
          </button>
          {showColumns && (
            <div className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg p-3 z-20 w-56 shadow-xl max-h-72 overflow-y-auto">
              {ALL_COLUMNS.map((c) => {
                const restricted = (c.key === "cost" || c.key === "margin") && !canViewCost;
                return (
                  <label key={c.key} className={`flex items-center gap-2 text-sm py-1 ${!c.optional || restricted ? "opacity-60" : ""}`}>
                    <input type="checkbox" checked={visibleColumns.includes(c.key)} disabled={!c.optional || restricted} onChange={() => toggleColumn(c.key)} />
                    {c.label}{!c.optional && <span className="text-[10px] text-gray-500">(required)</span>}{restricted && <span className="text-[10px] text-gray-500">(restricted)</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="relative">
          <button onClick={() => setShowViews((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <Bookmark size={16} /> Views
          </button>
          {showViews && (
            <div className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg p-2 z-20 w-56 shadow-xl">
              <button onClick={saveCurrentView} className="w-full text-left text-sm px-2 py-1.5 hover:bg-gray-800 rounded">+ Save current filters as view</button>
              {savedViews.length > 0 && <div className="border-t border-gray-800 my-1" />}
              {savedViews.map((v) => (
                <div key={v.name} className="flex items-center justify-between px-2 py-1.5 hover:bg-gray-800 rounded text-sm">
                  <button onClick={() => applyView(v)} className="text-left flex-1">{v.name}</button>
                  <button onClick={() => deleteView(v.name)} aria-label={`Delete view ${v.name}`}><X size={14} className="text-gray-500 hover:text-red-400" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isFiltered && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-gray-500">{total} result{total === 1 ? "" : "s"}</span>
          {activeFilterEntries.map(([key, value]) => (
            <span key={key} className="flex items-center gap-1.5 bg-gray-800/70 border border-gray-700 rounded-full pl-2.5 pr-1.5 py-1 text-xs text-gray-200">
              {FILTER_LABELS[key] || key}: {key === "ownerId" ? ownerName(value) : value === "true" ? "Yes" : value === "false" ? "No" : value}
              <button onClick={() => removeFilter(key)} aria-label={`Clear ${FILTER_LABELS[key] || key} filter`} className="hover:text-white"><X size={12} /></button>
            </span>
          ))}
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white ml-1"><X size={12} /> Clear all filters</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-700/40 rounded-xl p-3 mb-4 flex-wrap">
          <span className="text-sm">{selected.size} selected</span>
          <button onClick={() => setBulkAction("assign")} className="text-sm text-blue-300 hover:underline">Assign Owner</button>
          <button onClick={() => setBulkAction("category")} className="text-sm text-blue-300 hover:underline">Change Category</button>
          <button onClick={() => setBulkAction("status")} className="text-sm text-blue-300 hover:underline">Change Status</button>
          <button onClick={() => setBulkAction("tag")} className="text-sm text-blue-300 hover:underline">Add Tag</button>
          <button onClick={() => setBulkAction("archive")} className="text-sm text-blue-300 hover:underline">Archive</button>
          <button onClick={runExportSelected} className="text-sm text-blue-300 hover:underline">Export Selected</button>
          <span className="text-xs text-gray-500">Bulk price editing isn&apos;t offered here.</span>
          <button onClick={() => setSelected(new Set())} className="text-sm text-gray-400 hover:text-white ml-auto">Clear selection</button>
        </div>
      )}

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        {loading ? (
          <CatalogTableSkeleton visibleColumns={visibleColumns} />
        ) : error ? (
          <div className="p-10 text-center text-gray-400">
            <AlertCircle className="mx-auto mb-2 text-red-400" size={28} />
            <p className="mb-1 text-gray-200">Couldn&apos;t load the catalog</p>
            <p className="mb-3 text-sm">{error}</p>
            <button onClick={() => dispatch(fetchProducts())} className="text-blue-400 hover:underline text-sm">Retry</button>
          </div>
        ) : pageItems.length === 0 && !isFiltered ? (
          <div className="p-12 text-center text-gray-400">
            <PackageSearch className="mx-auto mb-2 text-gray-600" size={28} />
            <p className="mb-1">The catalog is empty.</p>
            <p className="text-sm text-gray-500 mb-4">Products, Services, Packages and Add-ons all live in this one shared catalog — used by Deals today, and by Price Books, Quotes, Orders, Contracts and Invoices later.</p>
            <div className="flex justify-center gap-3 flex-wrap">
              <button onClick={() => openAdd("Product")} className="text-blue-400 hover:underline text-sm">Add Product</button>
              <button onClick={() => openAdd("Service")} className="text-blue-400 hover:underline text-sm">Add Service</button>
              <button onClick={() => openAdd("Package")} className="text-blue-400 hover:underline text-sm">Add Package</button>
              <button onClick={() => setShowImport(true)} className="text-blue-400 hover:underline text-sm">Import Preview</button>
            </div>
          </div>
        ) : pageItems.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-1">No catalog items match the current filters.</p>
            <p className="text-xs text-gray-500 mb-3">{activeFilterEntries.length} filter{activeFilterEntries.length === 1 ? "" : "s"} active</p>
            <button onClick={clearFilters} className="text-blue-400 hover:underline text-sm">Clear Filters</button>
          </div>
        ) : (
          <table className="w-full text-sm min-w-300">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 w-8"><input type="checkbox" checked={selected.size === pageItems.length && pageItems.length > 0} onChange={toggleSelectAll} aria-label="Select all catalog items" /></th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("name")}>
                  <span className="flex items-center gap-1">Item {params.sort === "name" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">SKU / Code</th>
                {visibleColumns.includes("type") && <th scope="col" className="px-4 py-3 font-medium">Type</th>}
                {visibleColumns.includes("category") && <th scope="col" className="px-4 py-3 font-medium">Category</th>}
                {visibleColumns.includes("billingModel") && <th scope="col" className="px-4 py-3 font-medium">Billing Model</th>}
                {visibleColumns.includes("price") && <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("standardPrice")}>Standard Price</th>}
                {visibleColumns.includes("currency") && <th scope="col" className="px-4 py-3 font-medium">Currency</th>}
                {visibleColumns.includes("billingInterval") && <th scope="col" className="px-4 py-3 font-medium">Billing Interval</th>}
                {visibleColumns.includes("status") && <th scope="col" className="px-4 py-3 font-medium">Status</th>}
                {visibleColumns.includes("activeDeals") && <th scope="col" className="px-4 py-3 font-medium text-right cursor-pointer select-none" onClick={() => toggleSort("activeDeals")}>Active Deals</th>}
                {visibleColumns.includes("updatedAt") && <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("updatedAt")}>Last Updated</th>}
                {visibleColumns.includes("taxCategory") && <th scope="col" className="px-4 py-3 font-medium">Tax Category</th>}
                {visibleColumns.includes("unit") && <th scope="col" className="px-4 py-3 font-medium">Unit</th>}
                {visibleColumns.includes("cost") && canViewCost && <th scope="col" className="px-4 py-3 font-medium text-right">Cost</th>}
                {visibleColumns.includes("margin") && canViewCost && <th scope="col" className="px-4 py-3 font-medium text-right">Margin</th>}
                {visibleColumns.includes("effectiveDate") && <th scope="col" className="px-4 py-3 font-medium">Effective Date</th>}
                {visibleColumns.includes("expirationDate") && <th scope="col" className="px-4 py-3 font-medium">Expiration Date</th>}
                {visibleColumns.includes("owner") && <th scope="col" className="px-4 py-3 font-medium">Owner</th>}
                {visibleColumns.includes("tags") && <th scope="col" className="px-4 py-3 font-medium">Tags</th>}
                <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((item) => {
                const attention = needsAttentionReasons(item);
                const activeDeals = activeDealsUsingItem(item._id).length;
                const margin = canViewCost && item.costPreview != null && item.standardPrice != null
                  ? item.standardPrice - item.costPreview : null;
                return (
                  <tr key={item._id} className="border-t border-gray-800 hover:bg-gray-800/40">
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(item._id)} onChange={() => toggleSelectOne(item._id)} aria-label={`Select ${item.name}`} />
                    </td>
                    <td className="px-4 py-3 cursor-pointer" tabIndex={0} role="link" onClick={() => navigate(`/sales/products/${item._id}`)} onKeyDown={(e) => { if (e.key === "Enter") navigate(`/sales/products/${item._id}`); }}>
                      <span className="font-medium">{item.name}</span>
                      {attention.length > 0 && <span title={attention.join(", ")} className="ml-2 text-xs text-amber-400">⚠</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{item.sku || "—"}</td>
                    {visibleColumns.includes("type") && <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs border ${TYPE_COLORS[item.type]}`}>{item.type}</span></td>}
                    {visibleColumns.includes("category") && <td className="px-4 py-3 text-gray-300">{item.category || "—"}</td>}
                    {visibleColumns.includes("billingModel") && <td className="px-4 py-3 text-gray-300">{item.billingModel}</td>}
                    {visibleColumns.includes("price") && <td className="px-4 py-3 text-gray-300">{formatPricingLabel(item)}</td>}
                    {visibleColumns.includes("currency") && <td className="px-4 py-3 text-gray-300">{item.currency}</td>}
                    {visibleColumns.includes("billingInterval") && <td className="px-4 py-3 text-gray-300">{item.billingInterval || "—"}</td>}
                    {visibleColumns.includes("status") && <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs border ${STATUS_COLORS[item.status]}`}>{item.status}</span></td>}
                    {visibleColumns.includes("activeDeals") && <td className="px-4 py-3 text-gray-300 text-right">{activeDeals}</td>}
                    {visibleColumns.includes("updatedAt") && <td className="px-4 py-3 text-gray-300">{formatDate(item.updatedAt)}</td>}
                    {visibleColumns.includes("taxCategory") && <td className="px-4 py-3 text-gray-300">{item.taxCategory}</td>}
                    {visibleColumns.includes("unit") && <td className="px-4 py-3 text-gray-300">{item.unit}</td>}
                    {visibleColumns.includes("cost") && canViewCost && <td className="px-4 py-3 text-gray-300 text-right">{item.costPreview != null ? formatMoney(item.costPreview, item.currency) : "—"}</td>}
                    {visibleColumns.includes("margin") && canViewCost && <td className="px-4 py-3 text-gray-300 text-right">{margin != null ? formatMoney(margin, item.currency) : "—"}</td>}
                    {visibleColumns.includes("effectiveDate") && <td className="px-4 py-3 text-gray-300">{formatDate(item.effectiveDate)}</td>}
                    {visibleColumns.includes("expirationDate") && <td className="px-4 py-3 text-gray-300">{formatDate(item.expirationDate)}</td>}
                    {visibleColumns.includes("owner") && <td className="px-4 py-3 text-gray-300">{ownerName(item.ownerId)}</td>}
                    {visibleColumns.includes("tags") && <td className="px-4 py-3 text-gray-300">{(item.tags || []).join(", ") || "—"}</td>}
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        item={item}
                        open={openRowMenu === item._id}
                        onToggle={() => setOpenRowMenu((v) => (v === item._id ? null : item._id))}
                        onClose={() => setOpenRowMenu(null)}
                        onView={() => navigate(`/sales/products/${item._id}`)}
                        onEdit={() => openEdit(item)}
                        onDuplicate={() => openDuplicate(item)}
                        onChangeStatus={() => setRowAction({ type: "status", item })}
                        onAddToDeal={() => setRowAction({ type: "addToDeal", item })}
                        onArchive={() => setRowAction({ type: "archive", item })}
                        onRestore={() => dispatch(restoreProduct(item._id))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !error && total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>Page {page} of {totalPages} · {total} total</span>
          <div className="flex items-center gap-2">
            <select value={pageSize} onChange={(e) => updateParam("pageSize", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-2 py-1.5 text-sm">
              {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
            <button disabled={page <= 1} onClick={() => updateParam("page", String(page - 1), false)} className="p-2 rounded-lg border border-gray-800 disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={16} /></button>
            <button disabled={page >= totalPages} onClick={() => updateParam("page", String(page + 1), false)} className="p-2 rounded-lg border border-gray-800 disabled:opacity-30" aria-label="Next page"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {showFiltersDrawer && <FiltersDrawer params={params} updateParam={updateParam} onClose={() => setShowFiltersDrawer(false)} />}
      {showImport && <ImportPreviewDialog onClose={() => setShowImport(false)} />}
      {formState && (
        <ProductFormModal
          mode={formState.mode}
          type={formState.type}
          item={formState.item}
          onClose={() => setFormState(null)}
          onSaved={() => dispatch(fetchProducts())}
        />
      )}
      {rowAction?.type === "archive" && <ArchiveDialog item={rowAction.item} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchProducts()); }} />}
      {rowAction?.type === "status" && <ChangeStatusDialog item={rowAction.item} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchProducts()); }} />}
      {rowAction?.type === "addToDeal" && <AddToDealModal item={rowAction.item} onClose={() => setRowAction(null)} />}
      {bulkAction && <BulkActionDialog bulkAction={bulkAction} value={bulkValue} setValue={setBulkValue} reason={bulkReason} setReason={setBulkReason} count={selected.size} onClose={() => setBulkAction(null)} onSubmit={submitBulk} />}
    </div>
  );
}

function FilterSelects({ params, updateParam }) {
  return (
    <>
      <select value={params.type || ""} onChange={(e) => updateParam("type", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by type">
        <option value="">All Types</option>
        {CATALOG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={params.status || ""} onChange={(e) => updateParam("status", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by status">
        <option value="">All Statuses</option>
        {CATALOG_STATUSES.filter((s) => s !== "Archived").map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={params.category || ""} onChange={(e) => updateParam("category", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by category">
        <option value="">All Categories</option>
        {CATALOG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={params.billingModel || ""} onChange={(e) => updateParam("billingModel", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by billing model">
        <option value="">All Billing Models</option>
        {BILLING_MODELS.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select value={params.billingInterval || ""} onChange={(e) => updateParam("billingInterval", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by billing interval">
        <option value="">All Intervals</option>
        {BILLING_INTERVALS.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select value={params.currency || ""} onChange={(e) => updateParam("currency", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by currency">
        <option value="">All Currencies</option>
        {CATALOG_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={params.taxCategory || ""} onChange={(e) => updateParam("taxCategory", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by tax category">
        <option value="">All Tax Categories</option>
        {TAX_CATEGORIES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={params.ownerId || ""} onChange={(e) => updateParam("ownerId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by owner">
        <option value="">All Owners</option>
        {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.discountEligible === "true"} onChange={(e) => updateParam("discountEligible", e.target.checked ? "true" : undefined)} />
        Discount Eligible
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.usedInActiveDeals === "true"} onChange={(e) => updateParam("usedInActiveDeals", e.target.checked ? "true" : undefined)} />
        Used in Active Deals
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.missingPrice === "true"} onChange={(e) => updateParam("missingPrice", e.target.checked ? "true" : undefined)} />
        Missing Price
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.expiredPricing === "true"} onChange={(e) => updateParam("expiredPricing", e.target.checked ? "true" : undefined)} />
        Expired Pricing
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.archived === "true"} onChange={(e) => updateParam("archived", e.target.checked ? "true" : "false")} />
        Archived
      </label>
    </>
  );
}

function FiltersDrawer({ params, updateParam, onClose }) {
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/60 flex justify-end z-50" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Filters" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border-l border-gray-800 w-full max-w-xs h-full p-4 space-y-3 overflow-y-auto">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-bold">Filters</h2>
          <button onClick={onClose} aria-label="Close filters"><X size={18} /></button>
        </div>
        <div className="flex flex-col gap-2">
          <FilterSelects params={params} updateParam={updateParam} />
        </div>
      </div>
    </div>
  );
}

function CatalogTableSkeleton({ visibleColumns }) {
  const colCount = 3 + visibleColumns.length;
  return (
    <div className="p-4">
      <div className="flex gap-4 px-4 py-3 border-b border-gray-800">
        {Array.from({ length: colCount }).map((_, i) => <div key={i} className="h-3 bg-gray-800/60 rounded flex-1 animate-pulse" />)}
      </div>
      {Array.from({ length: 6 }).map((_, row) => (
        <div key={row} className="flex gap-4 px-4 py-3 border-b border-gray-800/60">
          {Array.from({ length: colCount }).map((_, i) => <div key={i} className="h-4 bg-gray-800/40 rounded flex-1 animate-pulse" />)}
        </div>
      ))}
    </div>
  );
}

function RowActionsMenu({ item, open, onToggle, onClose, onView, onEdit, onDuplicate, onChangeStatus, onAddToDeal, onArchive, onRestore }) {
  const items = [
    { label: "View", action: onView },
    { label: "Edit", action: onEdit },
    { label: "Duplicate", action: onDuplicate },
    { label: "Change Status", action: onChangeStatus },
    { label: "Add to Deal", action: onAddToDeal },
    item.status === "Archived" ? { label: "Restore", action: onRestore } : { label: "Archive", action: onArchive },
  ];
  return (
    <div className="relative inline-block">
      <button onClick={onToggle} aria-label={`Actions for ${item.name}`} aria-haspopup="menu" aria-expanded={open} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-48 shadow-xl text-left" onMouseLeave={onClose}>
          {items.map((i) => (
            <button key={i.label} role="menuitem" onClick={() => { i.action(); onClose(); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">{i.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function ArchiveDialog({ item, onClose, onDone }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const activeDeals = activeDealsUsingItem(item._id);
  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return;
    await dispatch(archiveProduct({ id: item._id, reason }));
    onDone();
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Archive catalog item" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Archive &quot;{item.name}&quot;</h2>
        <p className="text-sm text-gray-400">Archiving moves this item to the Archived view and prevents it from being selected in new Deal line items. Existing Deal line items keep it visible, and historical relationships are preserved.</p>
        {activeDeals.length > 0 && (
          <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200">
            {activeDeals.length} active Deal{activeDeals.length === 1 ? "" : "s"} currently use this item and will keep it in their line-item history.
          </div>
        )}
        <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={!reason.trim()} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-sm font-medium">Archive</button>
        </div>
      </form>
    </div>
  );
}

function ChangeStatusDialog({ item, onClose, onDone }) {
  const dispatch = useDispatch();
  const [status, setStatus] = useState(item.status === "Archived" ? "Active" : item.status);
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => {
    e.preventDefault();
    await dispatch(updateProduct({ id: item._id, changes: { status } }));
    onDone();
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Change status" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Change Status — {item.name}</h2>
        <select autoFocus value={status} onChange={(e) => setStatus(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          {CATALOG_STATUSES.filter((s) => s !== "Archived").map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <p className="text-xs text-gray-500">Use Archive from the row menu to archive this item — it requires a reason.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Save</button>
        </div>
      </form>
    </div>
  );
}

function BulkActionDialog({ bulkAction, value, setValue, reason, setReason, count, onClose, onSubmit }) {
  const containerRef = useFocusTrap(true, onClose);
  const titles = { assign: "Bulk Assign Owner", category: "Bulk Change Category", status: "Bulk Change Status", tag: "Bulk Add Tag", archive: "Bulk Archive" };
  const canSubmit = bulkAction === "archive" ? reason.trim() : value;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={titles[bulkAction]} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">{titles[bulkAction]}</h2>
        <p className="text-sm text-gray-400">{count} item{count === 1 ? "" : "s"} selected.</p>
        {bulkAction === "assign" && (
          <select value={value} onChange={(e) => setValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Select owner...</option>
            {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        {bulkAction === "category" && (
          <select value={value} onChange={(e) => setValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Select category...</option>
            {CATALOG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {bulkAction === "status" && (
          <select value={value} onChange={(e) => setValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Select status...</option>
            {CATALOG_STATUSES.filter((s) => s !== "Archived").map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {bulkAction === "tag" && <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Tag name" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />}
        {bulkAction === "archive" && <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button disabled={!canSubmit} onClick={onSubmit} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">Apply</button>
        </div>
      </div>
    </div>
  );
}

function ImportPreviewDialog({ onClose }) {
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Import catalog items" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-bold">Import Preview</h2>
        <p className="text-sm text-gray-400">Importing catalog items is a frontend preview in this phase. No production records are imported — this demonstrates the intended experience only.</p>
        <div className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center text-gray-500 text-sm">Drag and drop a file here, or browse (preview only)</div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}
