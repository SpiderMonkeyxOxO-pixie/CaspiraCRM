import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Plus, Search, RefreshCw, Download, ChevronUp, ChevronDown, Columns3,
  X, AlertCircle, ChevronLeft, ChevronRight, Bookmark, MoreHorizontal, PackageSearch,
} from "lucide-react";
import {
  fetchOrders, archiveOrder, restoreOrder, bulkAssignOwner, bulkArchiveOrders,
  submitForReview, cancelOrder, ORDER_TYPES,
} from "../../../redux/sales/ordersSlice";
import { queryOrdersLocal, getEffectiveStatus, isOverdueRequestedDate, computeOrderTotals, computeOrderProgress, SETTABLE_STATUSES } from "../../../Helpers/mockOrderData";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { fetchQuotes } from "../../../redux/sales/quotesSlice";
import { findTeamMember } from "../../../Helpers/mockUsersData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import useFocusTrap from "../../../hooks/useFocusTrap";
import useDebounced from "../../../hooks/useDebounced";
import { formatMoney, formatDate, ORDER_STATUS_COLORS } from "./orderUtils";
import OrderBuilder from "./OrderBuilder";
import CreateFromQuoteDialog from "./CreateFromQuoteDialog";

const ALL_COLUMNS = [
  { key: "contact", label: "Contact", optional: false },
  { key: "orderType", label: "Order Type", optional: false },
  { key: "sourceQuote", label: "Source Quote", optional: false },
  { key: "total", label: "Total", optional: false },
  { key: "currency", label: "Currency", optional: false },
  { key: "status", label: "Status", optional: false },
  { key: "progress", label: "Fulfillment Progress", optional: false },
  { key: "requestedDate", label: "Requested Date", optional: false },
  { key: "owner", label: "Owner", optional: false },
  { key: "updatedAt", label: "Last Updated", optional: false },
  { key: "deal", label: "Deal", optional: true },
  { key: "oneTimeTotal", label: "One-Time Total", optional: true },
  { key: "recurringTotal", label: "Recurring Total", optional: true },
  { key: "billingSchedule", label: "Billing Schedule", optional: true },
  { key: "team", label: "Team", optional: true },
  { key: "customerReference", label: "Customer Reference", optional: true },
  { key: "createdAt", label: "Created Date", optional: true },
];
const DEFAULT_VISIBLE = ALL_COLUMNS.filter((c) => !c.optional).map((c) => c.key);
const COLUMN_PREF_KEY = "sales.orders.visibleColumns";
const SAVED_VIEWS_KEY = "sales.orders.savedViews";

function ownerName(id) {
  if (!id) return "Unassigned";
  return findTeamMember(id)?.name || id;
}

export default function OrdersList() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items, loading, error } = useSelector((s) => s.orders);
  const companies = useSelector((s) => s.companies.items);
  const allContacts = useSelector((s) => s.contacts.items);
  const deals = useSelector((s) => s.deals.items);
  const allQuotes = useSelector((s) => s.quotes.items);

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
  const [builderState, setBuilderState] = useState(null);
  const [showFromQuote, setShowFromQuote] = useState(null); // { preselectedQuoteId } | true

  const [visibleColumns, setVisibleColumns] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLUMN_PREF_KEY)) || DEFAULT_VISIBLE; } catch { return DEFAULT_VISIBLE; }
  });
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)) || []; } catch { return []; }
  });

  useEffect(() => {
    dispatch(fetchOrders()); dispatch(fetchCompanies()); dispatch(fetchContacts()); dispatch(fetchDeals()); dispatch(fetchQuotes());
  }, [dispatch]);

  // Cross-page integration: a Preview Accepted Quote's "Create Order" links here with ?fromQuote=<id>.
  useEffect(() => {
    const quoteId = searchParams.get("fromQuote");
    if (quoteId) {
      setShowFromQuote({ preselectedQuoteId: quoteId });
      const next = new URLSearchParams(searchParams);
      next.delete("fromQuote");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const companyNameById = useMemo(() => new Map(companies.map((c) => [c._id, c.name])), [companies]);
  const contactNameById = useMemo(() => new Map(allContacts.map((c) => [c._id, c.name])), [allContacts]);
  const dealNameById = useMemo(() => new Map(deals.map((d) => [d._id, d.name])), [deals]);
  const quoteById = useMemo(() => new Map(allQuotes.map((q) => [q._id, q])), [allQuotes]);

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

  const queryResult = useMemo(() => queryOrdersLocal(items, params), [items, params]);
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
    else setSelected(new Set(pageItems.map((o) => o._id)));
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
    const data = rows.map((o) => {
      const totals = computeOrderTotals(o);
      return {
        "Order Number": o.orderNumber, Company: companyNameById.get(o.companyId) || "", "Order Type": o.orderType,
        Total: totals.grandTotal, Currency: o.currency, Status: getEffectiveStatus(o), "Requested Date": o.requestedDate || "",
        Owner: ownerName(o.ownerId), Updated: o.updatedAt,
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    XLSX.writeFile(wb, filename);
  };
  const runExport = () => {
    setExporting(true);
    const all = queryOrdersLocal(items, { ...params, page: 1, pageSize: 100000 }).items;
    exportRows(all, `orders_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExporting(false);
  };
  const runExportSelected = () => exportRows(pageItems.filter((o) => selected.has(o._id)), `orders_selected_${new Date().toISOString().slice(0, 10)}.xlsx`);

  const submitBulk = async () => {
    const orderIds = Array.from(selected);
    if (bulkAction === "assign" && bulkValue) await dispatch(bulkAssignOwner({ orderIds, ownerId: bulkValue }));
    else if (bulkAction === "archive") {
      if (!bulkReason.trim()) return;
      await dispatch(bulkArchiveOrders({ orderIds, reason: bulkReason }));
    }
    setSelected(new Set());
    setBulkAction(null);
    setBulkValue("");
    setBulkReason("");
  };

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/sales/dashboard" className="hover:text-gray-300">Sales</Link> / <span className="text-gray-300">Orders</span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-sm text-gray-400 mt-1">
            Confirmed commercial commitments, connected to Quotes, Deals, Products and Price Books. {total} Order{total === 1 ? "" : "s"} visible.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => dispatch(fetchOrders())} title="Refresh" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><RefreshCw size={16} /> Refresh</button>
          <button onClick={runExport} disabled={exporting} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm disabled:opacity-50"><Download size={16} /> {exporting ? "Exporting..." : "Export"}</button>
          <div className="relative">
            <button data-tour="orders-add" onClick={() => setShowAddMenu((v) => !v)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium"><Plus size={16} /> Create Order</button>
            {showAddMenu && (
              <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-64 shadow-xl">
                <button role="menuitem" onClick={() => { setShowAddMenu(false); setShowFromQuote(true); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Create from Accepted Quote</button>
                <button role="menuitem" onClick={() => { setShowAddMenu(false); setBuilderState({ mode: "manual" }); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Create Manual Order</button>
                <p className="px-3 py-1.5 text-[10px] text-gray-500 border-t border-gray-800 mt-1">Frontend Quote acceptance is simulated this session.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div data-tour="orders-summary" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <button onClick={clearFilters} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left"><p className="text-xs text-gray-400 uppercase mb-1">Open Orders</p><p className="text-xl font-bold">{summary.open}</p></button>
        <button onClick={clearFilters} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left"><p className="text-xs text-gray-400 uppercase mb-1">Confirmed Value</p><p className="text-xl font-bold">{formatMoney(summary.confirmedValue, "USD")}</p></button>
        <button onClick={() => applyCardFilter("status", "Processing")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left"><p className="text-xs text-gray-400 uppercase mb-1">Processing</p><p className="text-xl font-bold">{summary.processing}</p></button>
        <button onClick={() => applyCardFilter("status", "Partially Fulfilled")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left"><p className="text-xs text-gray-400 uppercase mb-1">Partially Fulfilled</p><p className="text-xl font-bold">{summary.partiallyFulfilled}</p></button>
        <button onClick={() => applyCardFilter("status", "On Hold")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left"><p className="text-xs text-gray-400 uppercase mb-1">On Hold</p><p className="text-xl font-bold">{summary.onHold}</p></button>
        <button onClick={() => applyCardFilter("awaitingBilling", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left"><p className="text-xs text-gray-400 uppercase mb-1">Awaiting Billing Handoff</p><p className={`text-xl font-bold ${summary.awaitingBillingHandoff > 0 ? "text-amber-400" : ""}`}>{summary.awaitingBillingHandoff}</p></button>
      </div>

      <div data-tour="orders-filters" className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative flex-1 min-w-55 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search order number, company, reference..." aria-label="Search Orders" className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        </div>
        <div className="hidden lg:flex gap-2 flex-wrap"><FilterSelects params={params} updateParam={updateParam} companies={companies} deals={deals} /></div>
        <button onClick={() => setShowFiltersDrawer(true)} className="lg:hidden flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">Filters {isFiltered && `(${activeFilterEntries.length})`}</button>
        <div className="relative">
          <button onClick={() => setShowColumns((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Columns3 size={16} /> Columns</button>
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
          <button onClick={() => setShowViews((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Bookmark size={16} /> Views</button>
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
              {key}: {key === "ownerId" ? ownerName(value) : value === "true" ? "Yes" : value === "false" ? "No" : value}
              <button onClick={() => removeFilter(key)} aria-label={`Clear ${key} filter`} className="hover:text-white"><X size={12} /></button>
            </span>
          ))}
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white ml-1"><X size={12} /> Clear all filters</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-700/40 rounded-xl p-3 mb-4 flex-wrap">
          <span className="text-sm">{selected.size} selected</span>
          <button onClick={() => setBulkAction("assign")} className="text-sm text-blue-300 hover:underline">Assign Owner</button>
          <button onClick={() => setBulkAction("archive")} className="text-sm text-blue-300 hover:underline">Archive</button>
          <button onClick={runExportSelected} className="text-sm text-blue-300 hover:underline">Export Selected</button>
          <span className="text-xs text-gray-500">Bulk confirmation, cancellation or fulfillment isn&apos;t offered — each Order must be reviewed individually.</span>
          <button onClick={() => setSelected(new Set())} className="text-sm text-gray-400 hover:text-white ml-auto">Clear selection</button>
        </div>
      )}

      <div data-tour="orders-table" className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        {loading ? (
          <OrderTableSkeleton visibleColumns={visibleColumns} />
        ) : error ? (
          <div className="p-10 text-center text-gray-400">
            <AlertCircle className="mx-auto mb-2 text-red-400" size={28} />
            <p className="mb-1 text-gray-200">Couldn&apos;t load Orders</p>
            <p className="mb-3 text-sm">{error}</p>
            <button onClick={() => dispatch(fetchOrders())} className="text-blue-400 hover:underline text-sm">Retry</button>
          </div>
        ) : pageItems.length === 0 && !isFiltered ? (
          <div className="p-12 text-center text-gray-400">
            <PackageSearch className="mx-auto mb-2 text-gray-600" size={28} />
            <p className="mb-1">No Orders yet.</p>
            <p className="text-sm text-gray-500 mb-4">Orders represent confirmed commercial commitments — from an accepted Quote, or created manually.</p>
            <div className="flex justify-center gap-3 flex-wrap">
              <button onClick={() => setShowFromQuote(true)} className="text-blue-400 hover:underline text-sm">Create from Quote</button>
              <button onClick={() => setBuilderState({ mode: "manual" })} className="text-blue-400 hover:underline text-sm">Create Manual Order</button>
            </div>
          </div>
        ) : pageItems.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-1">No Orders match the current filters.</p>
            <p className="text-xs text-gray-500 mb-3">{activeFilterEntries.length} filter{activeFilterEntries.length === 1 ? "" : "s"} active</p>
            <button onClick={clearFilters} className="text-blue-400 hover:underline text-sm">Clear Filters</button>
          </div>
        ) : (
          <table className="w-full text-sm min-w-300">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 w-8"><input type="checkbox" checked={selected.size === pageItems.length && pageItems.length > 0} onChange={toggleSelectAll} aria-label="Select all Orders" /></th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("orderNumber")}>
                  <span className="flex items-center gap-1">Order # {params.sort === "orderNumber" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("company")}>Company</th>
                {visibleColumns.includes("contact") && <th scope="col" className="px-4 py-3 font-medium">Contact</th>}
                {visibleColumns.includes("orderType") && <th scope="col" className="px-4 py-3 font-medium">Order Type</th>}
                {visibleColumns.includes("sourceQuote") && <th scope="col" className="px-4 py-3 font-medium">Source Quote</th>}
                {visibleColumns.includes("total") && <th scope="col" className="px-4 py-3 font-medium text-right cursor-pointer select-none" onClick={() => toggleSort("total")}>Total</th>}
                {visibleColumns.includes("currency") && <th scope="col" className="px-4 py-3 font-medium">Currency</th>}
                {visibleColumns.includes("status") && <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("status")}>Status</th>}
                {visibleColumns.includes("progress") && <th scope="col" className="px-4 py-3 font-medium">Fulfillment Progress</th>}
                {visibleColumns.includes("requestedDate") && <th scope="col" className="px-4 py-3 font-medium">Requested Date</th>}
                {visibleColumns.includes("owner") && <th scope="col" className="px-4 py-3 font-medium">Owner</th>}
                {visibleColumns.includes("updatedAt") && <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("updatedAt")}>Last Updated</th>}
                {visibleColumns.includes("deal") && <th scope="col" className="px-4 py-3 font-medium">Deal</th>}
                {visibleColumns.includes("oneTimeTotal") && <th scope="col" className="px-4 py-3 font-medium text-right">One-Time Total</th>}
                {visibleColumns.includes("recurringTotal") && <th scope="col" className="px-4 py-3 font-medium text-right">Recurring Total</th>}
                {visibleColumns.includes("billingSchedule") && <th scope="col" className="px-4 py-3 font-medium">Billing Schedule</th>}
                {visibleColumns.includes("team") && <th scope="col" className="px-4 py-3 font-medium">Team</th>}
                {visibleColumns.includes("customerReference") && <th scope="col" className="px-4 py-3 font-medium">Customer Reference</th>}
                {visibleColumns.includes("createdAt") && <th scope="col" className="px-4 py-3 font-medium">Created Date</th>}
                <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((o) => {
                const effStatus = getEffectiveStatus(o);
                const totals = computeOrderTotals(o);
                const progress = computeOrderProgress(o);
                const sourceQuote = o.sourceQuoteId ? quoteById.get(o.sourceQuoteId) : null;
                return (
                  <tr key={o._id} className="border-t border-gray-800 hover:bg-gray-800/40">
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(o._id)} onChange={() => toggleSelectOne(o._id)} aria-label={`Select ${o.orderNumber}`} />
                    </td>
                    <td className="px-4 py-3 font-medium cursor-pointer" tabIndex={0} role="link" onClick={() => navigate(`/sales/orders/${o._id}`)} onKeyDown={(e) => { if (e.key === "Enter") navigate(`/sales/orders/${o._id}`); }}>
                      {o.orderNumber} {isOverdueRequestedDate(o) && <span title="Overdue requested date" className="ml-1 text-xs text-red-400">⚠</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{companyNameById.get(o.companyId) || "—"}</td>
                    {visibleColumns.includes("contact") && <td className="px-4 py-3 text-gray-300">{contactNameById.get(o.contactId) || "—"}</td>}
                    {visibleColumns.includes("orderType") && <td className="px-4 py-3 text-gray-300">{o.orderType}</td>}
                    {visibleColumns.includes("sourceQuote") && <td className="px-4 py-3 text-gray-300">{sourceQuote ? <Link to={`/sales/quotes/${sourceQuote._id}`} className="text-blue-400 hover:underline">{sourceQuote.quoteNumber}</Link> : "—"}</td>}
                    {visibleColumns.includes("total") && <td className="px-4 py-3 text-gray-300 text-right">{formatMoney(totals.grandTotal, o.currency)}</td>}
                    {visibleColumns.includes("currency") && <td className="px-4 py-3 text-gray-300">{o.currency}</td>}
                    {visibleColumns.includes("status") && <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs border ${ORDER_STATUS_COLORS[effStatus]}`}>{effStatus}</span></td>}
                    {visibleColumns.includes("progress") && <td className="px-4 py-3 text-gray-300">{progress.toFixed(0)}%</td>}
                    {visibleColumns.includes("requestedDate") && <td className="px-4 py-3 text-gray-300">{o.requestedDate ? formatDate(o.requestedDate) : "—"}</td>}
                    {visibleColumns.includes("owner") && <td className="px-4 py-3 text-gray-300">{ownerName(o.ownerId)}</td>}
                    {visibleColumns.includes("updatedAt") && <td className="px-4 py-3 text-gray-300">{formatDate(o.updatedAt)}</td>}
                    {visibleColumns.includes("deal") && <td className="px-4 py-3 text-gray-300">{dealNameById.get(o.dealId) || "—"}</td>}
                    {visibleColumns.includes("oneTimeTotal") && <td className="px-4 py-3 text-gray-300 text-right">{formatMoney(totals.oneTimeTotal, o.currency)}</td>}
                    {visibleColumns.includes("recurringTotal") && <td className="px-4 py-3 text-gray-300 text-right">{formatMoney(totals.recurringTotal, o.currency)}</td>}
                    {visibleColumns.includes("billingSchedule") && <td className="px-4 py-3 text-gray-300">{o.billingSchedule}</td>}
                    {visibleColumns.includes("team") && <td className="px-4 py-3 text-gray-300">{o.assignedTeam}</td>}
                    {visibleColumns.includes("customerReference") && <td className="px-4 py-3 text-gray-300">{o.customerReference || "—"}</td>}
                    {visibleColumns.includes("createdAt") && <td className="px-4 py-3 text-gray-300">{formatDate(o.createdAt)}</td>}
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        order={o} effStatus={effStatus}
                        open={openRowMenu === o._id} onToggle={() => setOpenRowMenu((v) => (v === o._id ? null : o._id))} onClose={() => setOpenRowMenu(null)}
                        onView={() => navigate(`/sales/orders/${o._id}`)}
                        onEdit={() => setBuilderState({ mode: "edit", order: o })}
                        onDuplicate={() => setBuilderState({ mode: "duplicate", order: o })}
                        onSubmitReview={() => dispatch(submitForReview(o._id))}
                        onConfirm={() => navigate(`/sales/orders/${o._id}?action=confirm`)}
                        onStartProcessing={() => navigate(`/sales/orders/${o._id}?action=startProcessing`)}
                        onUpdateFulfillment={() => navigate(`/sales/orders/${o._id}?tab=fulfillment`)}
                        onPutOnHold={() => navigate(`/sales/orders/${o._id}?action=hold`)}
                        onResume={() => navigate(`/sales/orders/${o._id}?action=resume`)}
                        onCancel={() => setRowAction({ type: "cancel", order: o })}
                        onArchive={() => setRowAction({ type: "archive", order: o })}
                        onRestore={() => dispatch(restoreOrder(o._id))}
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

      {showFiltersDrawer && <FiltersDrawer params={params} updateParam={updateParam} companies={companies} deals={deals} onClose={() => setShowFiltersDrawer(false)} />}
      {builderState && (
        <OrderBuilder mode={builderState.mode} order={builderState.order} sourceQuoteId={builderState.sourceQuoteId} onClose={() => setBuilderState(null)} onSaved={() => dispatch(fetchOrders())} />
      )}
      {showFromQuote && (
        <CreateFromQuoteDialog
          preselectedQuoteId={showFromQuote === true ? null : showFromQuote.preselectedQuoteId}
          onClose={() => setShowFromQuote(null)}
          onUseQuote={(quoteId) => { setShowFromQuote(null); setBuilderState({ mode: "fromQuote", sourceQuoteId: quoteId }); }}
        />
      )}
      {rowAction?.type === "archive" && <ArchiveDialog order={rowAction.order} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchOrders()); }} />}
      {rowAction?.type === "cancel" && <CancelDialog order={rowAction.order} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchOrders()); }} />}
      {bulkAction && <BulkActionDialog bulkAction={bulkAction} value={bulkValue} setValue={setBulkValue} reason={bulkReason} setReason={setBulkReason} count={selected.size} onClose={() => setBulkAction(null)} onSubmit={submitBulk} />}
    </div>
  );
}

function FilterSelects({ params, updateParam, companies, deals }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  return (
    <>
      <select value={params.status || ""} onChange={(e) => updateParam("status", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by status">
        <option value="">All Statuses</option>
        {SETTABLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={params.orderType || ""} onChange={(e) => updateParam("orderType", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by order type">
        <option value="">All Order Types</option>
        {ORDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={params.companyId || ""} onChange={(e) => updateParam("companyId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by company">
        <option value="">All Companies</option>
        {companies.slice(0, 200).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
      </select>
      <select value={params.dealId || ""} onChange={(e) => updateParam("dealId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by deal">
        <option value="">All Deals</option>
        {deals.slice(0, 200).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
      </select>
      <select value={params.ownerId || ""} onChange={(e) => updateParam("ownerId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by owner">
        <option value="">All Owners</option>
        {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select value={params.currency || ""} onChange={(e) => updateParam("currency", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by currency">
        <option value="">All Currencies</option>
        {["USD", "EUR", "GBP", "INR", "IDR"].map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.overdue === "true"} onChange={(e) => updateParam("overdue", e.target.checked ? "true" : undefined)} /> Overdue Requested Date
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.awaitingBilling === "true"} onChange={(e) => updateParam("awaitingBilling", e.target.checked ? "true" : undefined)} /> Awaiting Billing
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.hasRecurring === "true"} onChange={(e) => updateParam("hasRecurring", e.target.checked ? "true" : undefined)} /> Has Recurring Items
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.archived === "true"} onChange={(e) => updateParam("archived", e.target.checked ? "true" : "false")} /> Archived
      </label>
    </>
  );
}

function FiltersDrawer({ params, updateParam, companies, deals, onClose }) {
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/60 flex justify-end z-50" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Filters" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border-l border-gray-800 w-full max-w-xs h-full p-4 space-y-3 overflow-y-auto">
        <div className="flex justify-between items-center mb-2"><h2 className="font-bold">Filters</h2><button onClick={onClose} aria-label="Close filters"><X size={18} /></button></div>
        <div className="flex flex-col gap-2"><FilterSelects params={params} updateParam={updateParam} companies={companies} deals={deals} /></div>
      </div>
    </div>
  );
}

function OrderTableSkeleton({ visibleColumns }) {
  const colCount = 3 + visibleColumns.length;
  return (
    <div className="p-4">
      <div className="flex gap-4 px-4 py-3 border-b border-gray-800">{Array.from({ length: colCount }).map((_, i) => <div key={i} className="h-3 bg-gray-800/60 rounded flex-1 animate-pulse" />)}</div>
      {Array.from({ length: 6 }).map((_, row) => (<div key={row} className="flex gap-4 px-4 py-3 border-b border-gray-800/60">{Array.from({ length: colCount }).map((_, i) => <div key={i} className="h-4 bg-gray-800/40 rounded flex-1 animate-pulse" />)}</div>))}
    </div>
  );
}

function RowActionsMenu({ order, effStatus, open, onToggle, onClose, onView, onEdit, onDuplicate, onSubmitReview, onConfirm, onStartProcessing, onUpdateFulfillment, onPutOnHold, onResume, onCancel, onArchive, onRestore }) {
  const canEdit = effStatus === "Draft";
  const canSubmitReview = effStatus === "Draft";
  const canConfirm = effStatus === "Pending Review";
  const canStartProcessing = effStatus === "Confirmed";
  const canUpdateFulfillment = ["Processing", "Partially Fulfilled"].includes(effStatus);
  const canPutOnHold = ["Pending Review", "Confirmed", "Processing", "Partially Fulfilled"].includes(effStatus);
  const canResume = effStatus === "On Hold";
  const canCancel = !["Cancelled", "Completed", "Archived"].includes(effStatus);
  const items = [
    { label: "View", action: onView },
    canEdit && { label: "Edit Draft", action: onEdit },
    { label: "Duplicate", action: onDuplicate },
    canSubmitReview && { label: "Submit for Review", action: onSubmitReview },
    canConfirm && { label: "Confirm", action: onConfirm },
    canStartProcessing && { label: "Start Processing", action: onStartProcessing },
    canUpdateFulfillment && { label: "Update Fulfillment", action: onUpdateFulfillment },
    canPutOnHold && { label: "Put On Hold", action: onPutOnHold },
    canResume && { label: "Resume", action: onResume },
    canCancel && { label: "Cancel", action: onCancel },
    order.archived ? { label: "Restore", action: onRestore } : { label: "Archive", action: onArchive },
  ].filter(Boolean);
  return (
    <div className="relative inline-block">
      <button onClick={onToggle} aria-label={`Actions for ${order.orderNumber}`} aria-haspopup="menu" aria-expanded={open} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white"><MoreHorizontal size={16} /></button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-52 shadow-xl text-left" onMouseLeave={onClose}>
          {items.map((i) => <button key={i.label} role="menuitem" onClick={() => { i.action(); onClose(); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">{i.label}</button>)}
        </div>
      )}
    </div>
  );
}

function ArchiveDialog({ order, onClose, onDone }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => { e.preventDefault(); if (!reason.trim()) return; await dispatch(archiveOrder({ id: order._id, reason })); onDone(); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Archive Order" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4 text-white">
        <h2 className="text-lg font-bold">Archive &quot;{order.orderNumber}&quot;</h2>
        <p className="text-sm text-gray-400">Archived Orders remain visible in related Quote and Deal history. Archiving never removes the underlying shared Company, Contact, Deal or Quote records.</p>
        <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button><button type="submit" disabled={!reason.trim()} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-sm font-medium">Archive</button></div>
      </form>
    </div>
  );
}

function CancelDialog({ order, onClose, onDone }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => { e.preventDefault(); if (!reason.trim()) return; await dispatch(cancelOrder({ id: order._id, reason })); onDone(); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Cancel Order" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4 text-white">
        <h2 className="text-lg font-bold">Cancel &quot;{order.orderNumber}&quot;</h2>
        <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Cancellation reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Back</button><button type="submit" disabled={!reason.trim()} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-sm font-medium">Cancel Order</button></div>
      </form>
    </div>
  );
}

function BulkActionDialog({ bulkAction, value, setValue, reason, setReason, count, onClose, onSubmit }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const containerRef = useFocusTrap(true, onClose);
  const titles = { assign: "Bulk Assign Owner", archive: "Bulk Archive" };
  const canSubmit = bulkAction === "archive" ? reason.trim() : value;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={titles[bulkAction]} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4 text-white">
        <h2 className="text-lg font-bold">{titles[bulkAction]}</h2>
        <p className="text-sm text-gray-400">{count} Order{count === 1 ? "" : "s"} selected.</p>
        {bulkAction === "assign" && (
          <select value={value} onChange={(e) => setValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Select owner...</option>
            {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        {bulkAction === "archive" && <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />}
        <div className="flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button><button disabled={!canSubmit} onClick={onSubmit} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">Apply</button></div>
      </div>
    </div>
  );
}
