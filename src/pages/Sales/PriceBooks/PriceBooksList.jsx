import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Plus, Search, RefreshCw, Download, ChevronUp, ChevronDown, Columns3,
  X, AlertCircle, ChevronLeft, ChevronRight, Bookmark, MoreHorizontal, BookOpen, Scale,
} from "lucide-react";
import {
  fetchPriceBooks, updatePriceBook, archivePriceBook, restorePriceBook,
  bulkAssignOwner, bulkChangeStatus, bulkArchivePriceBooks,
} from "../../../redux/sales/priceBooksSlice";
import {
  queryPriceBooksLocal, findConflicts, getEffectiveStatus, specificityRank, SPECIFICITY_LABELS,
  computeEntryFinalPrice, SETTABLE_STATUSES, PRICE_BOOK_CURRENCIES, MARKETS, CUSTOMER_SEGMENTS,
  SALES_CHANNELS,
} from "../../../Helpers/mockPriceBookData";
import { CATALOG_CATEGORIES, findCatalogItem } from "../../../Helpers/mockCatalogData";
import { findTeamMember } from "../../../Helpers/mockUsersData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import useFocusTrap from "../../../hooks/useFocusTrap";
import useDebounced from "../../../hooks/useDebounced";
import { formatMoney, formatDate, PB_STATUS_COLORS, scopeSummary } from "./priceBookUtils";
import PriceBookFormModal from "./PriceBookFormModal";
import CompareDrawer from "./CompareDrawer";

const ALL_COLUMNS = [
  { key: "currency", label: "Currency", optional: false },
  { key: "scope", label: "Scope", optional: false },
  { key: "priority", label: "Priority", optional: false },
  { key: "items", label: "Catalog Items", optional: false },
  { key: "effectiveDate", label: "Effective Date", optional: false },
  { key: "expirationDate", label: "Expiration Date", optional: false },
  { key: "status", label: "Status", optional: false },
  { key: "owner", label: "Owner", optional: false },
  { key: "updatedAt", label: "Last Updated", optional: false },
  { key: "market", label: "Market", optional: true },
  { key: "customerSegment", label: "Customer Segment", optional: true },
  { key: "salesChannel", label: "Sales Channel", optional: true },
  { key: "companies", label: "Specific Companies", optional: true },
  { key: "categories", label: "Product Categories", optional: true },
  { key: "conflicts", label: "Conflicts", optional: true },
  { key: "createdAt", label: "Created Date", optional: true },
];
const DEFAULT_VISIBLE = ALL_COLUMNS.filter((c) => !c.optional).map((c) => c.key);
const COLUMN_PREF_KEY = "sales.priceBooks.visibleColumns";
const SAVED_VIEWS_KEY = "sales.priceBooks.savedViews";

const FILTER_LABELS = {
  status: "Status", currency: "Currency", market: "Market", customerSegment: "Segment", companyId: "Company",
  salesChannel: "Channel", category: "Category", ownerId: "Owner", effectiveFrom: "Effective From",
  effectiveTo: "Effective To", expiringSoon: "Expiring Soon", hasConflicts: "Has Conflicts", archived: "Archived", search: "Search",
};

function ownerName(id) {
  if (!id) return "Unassigned";
  return findTeamMember(id)?.name || id;
}

export default function PriceBooksList() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items, loading, error } = useSelector((s) => s.priceBooks);
  const companies = useSelector((s) => s.companies.items);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const debouncedSearch = useDebounced(searchInput, 350);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [showFiltersDrawer, setShowFiltersDrawer] = useState(false);
  const [openRowMenu, setOpenRowMenu] = useState(null);
  const [rowAction, setRowAction] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [formState, setFormState] = useState(null); // { mode, template, priceBook }
  const [compareIds, setCompareIds] = useState(null);

  const [visibleColumns, setVisibleColumns] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLUMN_PREF_KEY)) || DEFAULT_VISIBLE; } catch { return DEFAULT_VISIBLE; }
  });
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)) || []; } catch { return []; }
  });

  useEffect(() => { dispatch(fetchPriceBooks()); dispatch(fetchCompanies()); }, [dispatch]);

  const companyNameById = useMemo(() => new Map(companies.map((c) => [c._id, c.name])), [companies]);

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

  const queryResult = useMemo(() => queryPriceBooksLocal(items, params), [items, params]);
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
    else setSelected(new Set(pageItems.map((p) => p._id)));
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
    const data = rows.map((pb) => ({
      Name: pb.name, Code: pb.code, Currency: pb.currency, Scope: scopeSummary(pb), Priority: pb.priority,
      "Catalog Items": (pb.items || []).length, "Effective Date": pb.effectiveDate, "Expiration Date": pb.expirationDate || "",
      Status: getEffectiveStatus(pb), Owner: ownerName(pb.ownerId), Updated: pb.updatedAt,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Price Books");
    XLSX.writeFile(wb, filename);
  };
  const runExport = () => {
    setExporting(true);
    const all = queryPriceBooksLocal(items, { ...params, page: 1, pageSize: 100000 }).items;
    exportRows(all, `price_books_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExporting(false);
  };
  const runExportSelected = () => exportRows(pageItems.filter((p) => selected.has(p._id)), `price_books_selected_${new Date().toISOString().slice(0, 10)}.xlsx`);

  const submitBulk = async () => {
    const priceBookIds = Array.from(selected);
    if (bulkAction === "assign" && bulkValue) await dispatch(bulkAssignOwner({ priceBookIds, ownerId: bulkValue }));
    else if (bulkAction === "status" && bulkValue) await dispatch(bulkChangeStatus({ priceBookIds, status: bulkValue }));
    else if (bulkAction === "archive") {
      if (!bulkReason.trim()) return;
      await dispatch(bulkArchivePriceBooks({ priceBookIds, reason: bulkReason }));
    }
    setSelected(new Set());
    setBulkAction(null);
    setBulkValue("");
    setBulkReason("");
  };

  const openAdd = (template) => { setShowAddMenu(false); setFormState({ mode: "add", template }); };
  const openEdit = (pb) => setFormState({ mode: "edit", priceBook: pb });
  const openDuplicate = (pb) => setFormState({ mode: "duplicate", priceBook: pb });

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/sales/dashboard" className="hover:text-gray-300">Sales</Link> / <span className="text-gray-300">Price Books</span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Price Books</h1>
          <p className="text-sm text-gray-400 mt-1">
            Define catalog-price overrides by currency, market, segment, company, channel and quantity — for this frontend session only. {total} Price Book{total === 1 ? "" : "s"} visible.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => dispatch(fetchPriceBooks())} title="Refresh" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <RefreshCw size={16} /> Refresh
          </button>
          <button onClick={() => selected.size >= 2 ? setCompareIds(Array.from(selected).slice(0, 3)) : window.alert("Select 2 or 3 Price Books to compare.")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <Scale size={16} /> Compare
          </button>
          <button onClick={runExport} disabled={exporting} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm disabled:opacity-50">
            <Download size={16} /> {exporting ? "Exporting..." : "Export"}
          </button>
          <div className="relative">
            <button onClick={() => setShowAddMenu((v) => !v)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium">
              <Plus size={16} /> Create Price Book
            </button>
            {showAddMenu && (
              <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-52 shadow-xl">
                <button role="menuitem" onClick={() => openAdd("standard")} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Standard Price Book</button>
                <button role="menuitem" onClick={() => openAdd("market")} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Market Price Book</button>
                <button role="menuitem" onClick={() => openAdd("blank")} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Blank Price Book</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <button onClick={() => applyCardFilter("status", "Active")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Active</p>
          <p className="text-xl font-bold">{summary.active}</p>
        </button>
        <button onClick={() => applyCardFilter("status", "Scheduled")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Scheduled</p>
          <p className="text-xl font-bold">{summary.scheduled}</p>
        </button>
        <button onClick={() => applyCardFilter("expiringSoon", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Expiring Soon</p>
          <p className={`text-xl font-bold ${summary.expiringSoon > 0 ? "text-amber-400" : ""}`}>{summary.expiringSoon}</p>
        </button>
        <button onClick={() => applyCardFilter("status", "Draft")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Draft</p>
          <p className="text-xl font-bold">{summary.draft}</p>
        </button>
        <button onClick={() => applyCardFilter("hasConflicts", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Pricing Conflicts</p>
          <p className={`text-xl font-bold ${summary.conflicts > 0 ? "text-red-400" : ""}`}>{summary.conflicts}</p>
        </button>
        <button onClick={clearFilters} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Items Missing Prices</p>
          <p className={`text-xl font-bold ${summary.missingPrices > 0 ? "text-amber-400" : ""}`}>{summary.missingPrices}</p>
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative flex-1 min-w-55 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search name or code..."
            aria-label="Search Price Books" className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        </div>

        <div className="hidden lg:flex gap-2 flex-wrap">
          <FilterSelects params={params} updateParam={updateParam} companies={companies} />
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
              {ALL_COLUMNS.map((c) => (
                <label key={c.key} className={`flex items-center gap-2 text-sm py-1 ${!c.optional ? "opacity-60" : ""}`}>
                  <input type="checkbox" checked={visibleColumns.includes(c.key)} disabled={!c.optional} onChange={() => toggleColumn(c.key)} />
                  {c.label}{!c.optional && <span className="text-[10px] text-gray-500">(required)</span>}
                </label>
              ))}
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
              {FILTER_LABELS[key] || key}: {key === "ownerId" ? ownerName(value) : key === "companyId" ? (companyNameById.get(value) || value) : value === "true" ? "Yes" : value === "false" ? "No" : value}
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
          <button onClick={() => setBulkAction("status")} className="text-sm text-blue-300 hover:underline">Change Status</button>
          <button onClick={() => setBulkAction("archive")} className="text-sm text-blue-300 hover:underline">Archive</button>
          <button onClick={runExportSelected} className="text-sm text-blue-300 hover:underline">Export Selected</button>
          <span className="text-xs text-gray-500">Bulk pricing changes aren&apos;t offered here — edit each Price Book&apos;s pricing individually.</span>
          <button onClick={() => setSelected(new Set())} className="text-sm text-gray-400 hover:text-white ml-auto">Clear selection</button>
        </div>
      )}

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        {loading ? (
          <PriceBookTableSkeleton visibleColumns={visibleColumns} />
        ) : error ? (
          <div className="p-10 text-center text-gray-400">
            <AlertCircle className="mx-auto mb-2 text-red-400" size={28} />
            <p className="mb-1 text-gray-200">Couldn&apos;t load Price Books</p>
            <p className="mb-3 text-sm">{error}</p>
            <button onClick={() => dispatch(fetchPriceBooks())} className="text-blue-400 hover:underline text-sm">Retry</button>
          </div>
        ) : pageItems.length === 0 && !isFiltered ? (
          <div className="p-12 text-center text-gray-400">
            <BookOpen className="mx-auto mb-2 text-gray-600" size={28} />
            <p className="mb-1">No Price Books yet.</p>
            <p className="text-sm text-gray-500 mb-4">Price Books define catalog-price overrides by currency, market, segment, company or channel — for this frontend session only.</p>
            <div className="flex justify-center gap-3 flex-wrap">
              <button onClick={() => openAdd("standard")} className="text-blue-400 hover:underline text-sm">Create Standard Price Book</button>
              <button onClick={() => openAdd("market")} className="text-blue-400 hover:underline text-sm">Create Market Price Book</button>
            </div>
          </div>
        ) : pageItems.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-1">No Price Books match the current filters.</p>
            <p className="text-xs text-gray-500 mb-3">{activeFilterEntries.length} filter{activeFilterEntries.length === 1 ? "" : "s"} active</p>
            <button onClick={clearFilters} className="text-blue-400 hover:underline text-sm">Clear Filters</button>
          </div>
        ) : (
          <table className="w-full text-sm min-w-300">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 w-8"><input type="checkbox" checked={selected.size === pageItems.length && pageItems.length > 0} onChange={toggleSelectAll} aria-label="Select all Price Books" /></th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("name")}>
                  <span className="flex items-center gap-1">Price Book {params.sort === "name" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">Code</th>
                {visibleColumns.includes("currency") && <th scope="col" className="px-4 py-3 font-medium">Currency</th>}
                {visibleColumns.includes("scope") && <th scope="col" className="px-4 py-3 font-medium">Scope</th>}
                {visibleColumns.includes("priority") && <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("priority")}>Priority</th>}
                {visibleColumns.includes("items") && <th scope="col" className="px-4 py-3 font-medium text-right cursor-pointer select-none" onClick={() => toggleSort("itemCount")}>Catalog Items</th>}
                {visibleColumns.includes("effectiveDate") && <th scope="col" className="px-4 py-3 font-medium">Effective Date</th>}
                {visibleColumns.includes("expirationDate") && <th scope="col" className="px-4 py-3 font-medium">Expiration Date</th>}
                {visibleColumns.includes("status") && <th scope="col" className="px-4 py-3 font-medium">Status</th>}
                {visibleColumns.includes("owner") && <th scope="col" className="px-4 py-3 font-medium">Owner</th>}
                {visibleColumns.includes("updatedAt") && <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("updatedAt")}>Last Updated</th>}
                {visibleColumns.includes("market") && <th scope="col" className="px-4 py-3 font-medium">Market</th>}
                {visibleColumns.includes("customerSegment") && <th scope="col" className="px-4 py-3 font-medium">Customer Segment</th>}
                {visibleColumns.includes("salesChannel") && <th scope="col" className="px-4 py-3 font-medium">Sales Channel</th>}
                {visibleColumns.includes("companies") && <th scope="col" className="px-4 py-3 font-medium">Specific Companies</th>}
                {visibleColumns.includes("categories") && <th scope="col" className="px-4 py-3 font-medium">Product Categories</th>}
                {visibleColumns.includes("conflicts") && <th scope="col" className="px-4 py-3 font-medium">Conflicts</th>}
                {visibleColumns.includes("createdAt") && <th scope="col" className="px-4 py-3 font-medium">Created Date</th>}
                <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((pb) => {
                const effStatus = getEffectiveStatus(pb);
                const conflicts = findConflicts(pb, items);
                const missing = (pb.items || []).some((entry) => {
                  const c = findCatalogItem(entry.catalogItemId);
                  if (!c) return true;
                  if (entry.adjustmentType === "Custom Quote") return false;
                  return computeEntryFinalPrice(entry, c, entry.minQuantity || 1)?.finalPrice == null;
                });
                return (
                  <tr key={pb._id} className="border-t border-gray-800 hover:bg-gray-800/40">
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(pb._id)} onChange={() => toggleSelectOne(pb._id)} aria-label={`Select ${pb.name}`} />
                    </td>
                    <td className="px-4 py-3 cursor-pointer" tabIndex={0} role="link" onClick={() => navigate(`/sales/price-books/${pb._id}`)} onKeyDown={(e) => { if (e.key === "Enter") navigate(`/sales/price-books/${pb._id}`); }}>
                      <span className="font-medium">{pb.name}</span>
                      {conflicts.length > 0 && <span title={`${conflicts.length} conflict(s)`} className="ml-2 text-xs text-red-400">⚠</span>}
                      {missing && <span title="Missing resolvable prices" className="ml-1 text-xs text-amber-400">$?</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{pb.code}</td>
                    {visibleColumns.includes("currency") && <td className="px-4 py-3 text-gray-300">{pb.currency}</td>}
                    {visibleColumns.includes("scope") && <td className="px-4 py-3 text-gray-300">{scopeSummary(pb)}</td>}
                    {visibleColumns.includes("priority") && <td className="px-4 py-3 text-gray-300">{pb.priority}</td>}
                    {visibleColumns.includes("items") && <td className="px-4 py-3 text-gray-300 text-right">{(pb.items || []).length}</td>}
                    {visibleColumns.includes("effectiveDate") && <td className="px-4 py-3 text-gray-300">{formatDate(pb.effectiveDate)}</td>}
                    {visibleColumns.includes("expirationDate") && <td className="px-4 py-3 text-gray-300">{formatDate(pb.expirationDate)}</td>}
                    {visibleColumns.includes("status") && <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs border ${PB_STATUS_COLORS[effStatus]}`}>{effStatus}</span></td>}
                    {visibleColumns.includes("owner") && <td className="px-4 py-3 text-gray-300">{ownerName(pb.ownerId)}</td>}
                    {visibleColumns.includes("updatedAt") && <td className="px-4 py-3 text-gray-300">{formatDate(pb.updatedAt)}</td>}
                    {visibleColumns.includes("market") && <td className="px-4 py-3 text-gray-300">{pb.market || "—"}</td>}
                    {visibleColumns.includes("customerSegment") && <td className="px-4 py-3 text-gray-300">{pb.customerSegment || "—"}</td>}
                    {visibleColumns.includes("salesChannel") && <td className="px-4 py-3 text-gray-300">{pb.salesChannel || "—"}</td>}
                    {visibleColumns.includes("companies") && <td className="px-4 py-3 text-gray-300">{(pb.companyIds || []).map((cid) => companyNameById.get(cid)).filter(Boolean).join(", ") || "—"}</td>}
                    {visibleColumns.includes("categories") && <td className="px-4 py-3 text-gray-300">{(pb.categories || []).join(", ") || "—"}</td>}
                    {visibleColumns.includes("conflicts") && <td className="px-4 py-3 text-gray-300">{conflicts.length || "—"}</td>}
                    {visibleColumns.includes("createdAt") && <td className="px-4 py-3 text-gray-300">{formatDate(pb.createdAt)}</td>}
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        priceBook={pb}
                        specificity={SPECIFICITY_LABELS[specificityRank(pb)]}
                        open={openRowMenu === pb._id}
                        onToggle={() => setOpenRowMenu((v) => (v === pb._id ? null : pb._id))}
                        onClose={() => setOpenRowMenu(null)}
                        onView={() => navigate(`/sales/price-books/${pb._id}`)}
                        onEdit={() => openEdit(pb)}
                        onDuplicate={() => openDuplicate(pb)}
                        onCompare={() => setCompareIds([pb._id])}
                        onPreview={() => setRowAction({ type: "preview", priceBook: pb })}
                        onChangeStatus={() => setRowAction({ type: "status", priceBook: pb })}
                        onArchive={() => setRowAction({ type: "archive", priceBook: pb })}
                        onRestore={() => dispatch(restorePriceBook(pb._id))}
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

      {showFiltersDrawer && <FiltersDrawer params={params} updateParam={updateParam} companies={companies} onClose={() => setShowFiltersDrawer(false)} />}
      {formState && (
        <PriceBookFormModal
          mode={formState.mode}
          template={formState.template}
          priceBook={formState.priceBook}
          onClose={() => setFormState(null)}
          onSaved={() => dispatch(fetchPriceBooks())}
        />
      )}
      {rowAction?.type === "archive" && <ArchiveDialog priceBook={rowAction.priceBook} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchPriceBooks()); }} />}
      {rowAction?.type === "status" && <ChangeStatusDialog priceBook={rowAction.priceBook} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchPriceBooks()); }} />}
      {rowAction?.type === "preview" && <PreviewPricesModal priceBook={rowAction.priceBook} onClose={() => setRowAction(null)} />}
      {bulkAction && <BulkActionDialog bulkAction={bulkAction} value={bulkValue} setValue={setBulkValue} reason={bulkReason} setReason={setBulkReason} count={selected.size} onClose={() => setBulkAction(null)} onSubmit={submitBulk} />}
      {compareIds && <CompareDrawer priceBookIds={compareIds} onClose={() => setCompareIds(null)} />}
    </div>
  );
}

function FilterSelects({ params, updateParam, companies }) {
  return (
    <>
      <select value={params.status || ""} onChange={(e) => updateParam("status", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by status">
        <option value="">All Statuses</option>
        {["Draft", "Scheduled", "Active", "Expired", "Inactive"].map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={params.currency || ""} onChange={(e) => updateParam("currency", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by currency">
        <option value="">All Currencies</option>
        {PRICE_BOOK_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={params.market || ""} onChange={(e) => updateParam("market", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by market">
        <option value="">All Markets</option>
        {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select value={params.customerSegment || ""} onChange={(e) => updateParam("customerSegment", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by customer segment">
        <option value="">All Segments</option>
        {CUSTOMER_SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={params.companyId || ""} onChange={(e) => updateParam("companyId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by company">
        <option value="">All Companies</option>
        {companies.slice(0, 200).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
      </select>
      <select value={params.salesChannel || ""} onChange={(e) => updateParam("salesChannel", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by sales channel">
        <option value="">All Channels</option>
        {SALES_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={params.category || ""} onChange={(e) => updateParam("category", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by product category">
        <option value="">All Categories</option>
        {CATALOG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.expiringSoon === "true"} onChange={(e) => updateParam("expiringSoon", e.target.checked ? "true" : undefined)} />
        Expiring Soon
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.hasConflicts === "true"} onChange={(e) => updateParam("hasConflicts", e.target.checked ? "true" : undefined)} />
        Has Pricing Conflicts
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.archived === "true"} onChange={(e) => updateParam("archived", e.target.checked ? "true" : "false")} />
        Archived
      </label>
    </>
  );
}

function FiltersDrawer({ params, updateParam, companies, onClose }) {
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/60 flex justify-end z-50" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Filters" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border-l border-gray-800 w-full max-w-xs h-full p-4 space-y-3 overflow-y-auto">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-bold">Filters</h2>
          <button onClick={onClose} aria-label="Close filters"><X size={18} /></button>
        </div>
        <div className="flex flex-col gap-2">
          <FilterSelects params={params} updateParam={updateParam} companies={companies} />
        </div>
      </div>
    </div>
  );
}

function PriceBookTableSkeleton({ visibleColumns }) {
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

function RowActionsMenu({ priceBook, specificity, open, onToggle, onClose, onView, onEdit, onDuplicate, onCompare, onPreview, onChangeStatus, onArchive, onRestore }) {
  const items = [
    { label: "View", action: onView },
    { label: "Edit", action: onEdit },
    { label: "Duplicate", action: onDuplicate },
    { label: "Compare", action: onCompare },
    { label: "Preview Prices", action: onPreview },
    { label: "Change Status", action: onChangeStatus },
    priceBook.status === "Archived" ? { label: "Restore", action: onRestore } : { label: "Archive", action: onArchive },
  ];
  return (
    <div className="relative inline-block">
      <button onClick={onToggle} aria-label={`Actions for ${priceBook.name}`} title={`${specificity} specificity`} aria-haspopup="menu" aria-expanded={open} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
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

function ArchiveDialog({ priceBook, onClose, onDone }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return;
    await dispatch(archivePriceBook({ id: priceBook._id, reason }));
    onDone();
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Archive Price Book" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Archive &quot;{priceBook.name}&quot;</h2>
        <p className="text-sm text-gray-400">Archived Price Books can&apos;t be selected for new Deal pricing, but remain visible in existing Deal previews and through the Archived filter.</p>
        <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={!reason.trim()} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-sm font-medium">Archive</button>
        </div>
      </form>
    </div>
  );
}

function ChangeStatusDialog({ priceBook, onClose, onDone }) {
  const dispatch = useDispatch();
  const [status, setStatus] = useState(priceBook.status === "Archived" ? "Draft" : priceBook.status);
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => {
    e.preventDefault();
    await dispatch(updatePriceBook({ id: priceBook._id, changes: { status } }));
    onDone();
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Change status" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Change Status — {priceBook.name}</h2>
        <select autoFocus value={status} onChange={(e) => setStatus(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          {SETTABLE_STATUSES.filter((s) => s !== "Archived").map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <p className="text-xs text-gray-500">Scheduled and Expired are derived automatically from the effective/expiration dates once Active. Use Archive from the row menu to archive — it requires a reason.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Save</button>
        </div>
      </form>
    </div>
  );
}

function BulkActionDialog({ bulkAction, value, setValue, reason, setReason, count, onClose, onSubmit }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const containerRef = useFocusTrap(true, onClose);
  const titles = { assign: "Bulk Assign Owner", status: "Bulk Change Status", archive: "Bulk Archive" };
  const canSubmit = bulkAction === "archive" ? reason.trim() : value;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={titles[bulkAction]} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">{titles[bulkAction]}</h2>
        <p className="text-sm text-gray-400">{count} Price Book{count === 1 ? "" : "s"} selected.</p>
        {bulkAction === "assign" && (
          <select value={value} onChange={(e) => setValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Select owner...</option>
            {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        {bulkAction === "status" && (
          <select value={value} onChange={(e) => setValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Select status...</option>
            {SETTABLE_STATUSES.filter((s) => s !== "Archived").map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {bulkAction === "archive" && <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button disabled={!canSubmit} onClick={onSubmit} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">Apply</button>
        </div>
      </div>
    </div>
  );
}

function PreviewPricesModal({ priceBook, onClose }) {
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={`Preview prices for ${priceBook.name}`} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">Preview Prices — {priceBook.name}</h2>
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
              <th className="px-4 py-3 font-medium">Item</th><th className="px-4 py-3 font-medium">Base Price</th>
              <th className="px-4 py-3 font-medium">Adjustment</th><th className="px-4 py-3 font-medium">Final Price</th><th className="px-4 py-3 font-medium">Difference</th>
            </tr></thead>
            <tbody>
              {(priceBook.items || []).map((entry) => {
                const c = findCatalogItem(entry.catalogItemId);
                if (!c) return null;
                const priced = computeEntryFinalPrice(entry, c, entry.minQuantity || 1);
                return (
                  <tr key={entry._id} className="border-t border-gray-800">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-gray-300">{priced.basePrice != null ? formatMoney(priced.basePrice, c.currency) : "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{entry.adjustmentType}{entry.adjustmentType !== "Custom Quote" && entry.adjustmentType !== "Quantity Tier" ? ` (${entry.adjustmentValue})` : ""}</td>
                    <td className="px-4 py-3 text-gray-300">{priced.finalPrice != null ? formatMoney(priced.finalPrice, entry.currency) : entry.adjustmentType === "Custom Quote" ? "Custom Quote" : "Not resolvable"}</td>
                    <td className="px-4 py-3 text-gray-300">{priced.sameCurrency && priced.difference != null ? formatMoney(priced.difference, entry.currency) : priced.sameCurrency ? "—" : "Different currency"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-500">This is a frontend rules preview of this Price Book's own entries — not a backend-confirmed Quote price.</p>
        <div className="flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}
