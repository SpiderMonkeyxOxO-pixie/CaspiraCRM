import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Plus, Search, RefreshCw, Download, ChevronUp, ChevronDown, Columns3,
  X, AlertCircle, ChevronLeft, ChevronRight, Bookmark, MoreHorizontal, FileText,
} from "lucide-react";
import {
  fetchQuotes, archiveQuote, restoreQuote, bulkAssignOwner, bulkArchiveQuotes,
  submitForReview, cancelQuote, previewSend, simulateCustomerResponse,
  APPROVAL_STATUSES, CUSTOMER_RESPONSE_TYPES,
} from "../../../redux/sales/quotesSlice";
import {
  queryQuotesLocal, getEffectiveStatus, isExpiringSoon, computeQuoteTotals, QUOTE_STATUSES,
} from "../../../Helpers/mockQuoteData";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { fetchPriceBooks } from "../../../redux/sales/priceBooksSlice";
import { findTeamMember } from "../../../Helpers/mockUsersData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import useFocusTrap from "../../../hooks/useFocusTrap";
import useDebounced from "../../../hooks/useDebounced";
import { formatMoney, formatDate, QUOTE_STATUS_COLORS, APPROVAL_STATUS_COLORS, LOCKED_FOR_EDIT_STATUSES } from "./quoteUtils";
import QuoteBuilder from "./QuoteBuilder";

const ALL_COLUMNS = [
  { key: "version", label: "Version", optional: false },
  { key: "company", label: "Company", optional: false },
  { key: "contact", label: "Primary Contact", optional: false },
  { key: "deal", label: "Deal", optional: false },
  { key: "total", label: "Total", optional: false },
  { key: "currency", label: "Currency", optional: false },
  { key: "status", label: "Status", optional: false },
  { key: "validUntil", label: "Valid Until", optional: false },
  { key: "owner", label: "Owner", optional: false },
  { key: "updatedAt", label: "Last Updated", optional: false },
  { key: "priceBook", label: "Price Book", optional: true },
  { key: "oneTimeTotal", label: "One-Time Total", optional: true },
  { key: "recurringTotal", label: "Recurring Total", optional: true },
  { key: "approvalState", label: "Approval State", optional: true },
  { key: "issueDate", label: "Issue Date", optional: true },
  { key: "team", label: "Team", optional: true },
  { key: "createdAt", label: "Created Date", optional: true },
];
const DEFAULT_VISIBLE = ALL_COLUMNS.filter((c) => !c.optional).map((c) => c.key);
const COLUMN_PREF_KEY = "sales.quotes.visibleColumns";
const SAVED_VIEWS_KEY = "sales.quotes.savedViews";

function ownerName(id) {
  if (!id) return "Unassigned";
  return findTeamMember(id)?.name || id;
}

export default function QuotesList() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items, loading, error } = useSelector((s) => s.quotes);
  const companies = useSelector((s) => s.companies.items);
  const allContacts = useSelector((s) => s.contacts.items);
  const deals = useSelector((s) => s.deals.items);
  const priceBooksList = useSelector((s) => s.priceBooks.items);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const debouncedSearch = useDebounced(searchInput, 350);

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
  const [builderState, setBuilderState] = useState(null); // { mode, quote, prefillDealId }

  const [visibleColumns, setVisibleColumns] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLUMN_PREF_KEY)) || DEFAULT_VISIBLE; } catch { return DEFAULT_VISIBLE; }
  });
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)) || []; } catch { return []; }
  });

  useEffect(() => {
    dispatch(fetchQuotes()); dispatch(fetchCompanies()); dispatch(fetchContacts()); dispatch(fetchDeals()); dispatch(fetchPriceBooks());
  }, [dispatch]);

  // Cross-page integration: a Deal's Quotes tab links here with ?newForDeal=<id>.
  useEffect(() => {
    const dealId = searchParams.get("newForDeal");
    if (dealId) {
      setBuilderState({ mode: "create", prefillDealId: dealId });
      const next = new URLSearchParams(searchParams);
      next.delete("newForDeal");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const companyNameById = useMemo(() => new Map(companies.map((c) => [c._id, c.name])), [companies]);
  const contactNameById = useMemo(() => new Map(allContacts.map((c) => [c._id, c.name])), [allContacts]);
  const dealNameById = useMemo(() => new Map(deals.map((d) => [d._id, d.name])), [deals]);
  const priceBookNameById = useMemo(() => new Map(priceBooksList.map((p) => [p._id, p.name])), [priceBooksList]);

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

  const queryResult = useMemo(() => queryQuotesLocal(items, params), [items, params]);
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
    else setSelected(new Set(pageItems.map((q) => q._id)));
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
    const data = rows.map((q) => {
      const totals = computeQuoteTotals(q);
      return {
        "Quote Number": q.quoteNumber, Version: q.version, Title: q.title, Company: companyNameById.get(q.companyId) || "",
        Total: totals.grandTotal, Currency: q.currency, Status: getEffectiveStatus(q), "Valid Until": q.validUntilDate || "",
        Owner: ownerName(q.ownerId), Updated: q.updatedAt,
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Quotes");
    XLSX.writeFile(wb, filename);
  };
  const runExport = () => {
    setExporting(true);
    const all = queryQuotesLocal(items, { ...params, page: 1, pageSize: 100000 }).items;
    exportRows(all, `quotes_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExporting(false);
  };
  const runExportSelected = () => exportRows(pageItems.filter((q) => selected.has(q._id)), `quotes_selected_${new Date().toISOString().slice(0, 10)}.xlsx`);

  const submitBulk = async () => {
    const quoteIds = Array.from(selected);
    if (bulkAction === "assign" && bulkValue) await dispatch(bulkAssignOwner({ quoteIds, ownerId: bulkValue }));
    else if (bulkAction === "archive") {
      if (!bulkReason.trim()) return;
      await dispatch(bulkArchiveQuotes({ quoteIds, reason: bulkReason }));
    }
    setSelected(new Set());
    setBulkAction(null);
    setBulkValue("");
    setBulkReason("");
  };

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/sales/dashboard" className="hover:text-gray-300">Sales</Link> / <span className="text-gray-300">Quotes</span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Quotes</h1>
          <p className="text-sm text-gray-400 mt-1">
            Build, review and preview-send Quotes using the shared catalog and Price Books — for this frontend session only. {total} Quote{total === 1 ? "" : "s"} visible.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => dispatch(fetchQuotes())} title="Refresh" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <RefreshCw size={16} /> Refresh
          </button>
          <button onClick={runExport} disabled={exporting} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm disabled:opacity-50">
            <Download size={16} /> {exporting ? "Exporting..." : "Export"}
          </button>
          <button onClick={() => setBuilderState({ mode: "create" })} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium">
            <Plus size={16} /> Create Quote
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <button onClick={() => applyCardFilter("status", "Draft")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Draft</p><p className="text-xl font-bold">{summary.draft}</p>
        </button>
        <button onClick={() => applyCardFilter("status", "Approval Pending")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Approval Pending</p><p className="text-xl font-bold">{summary.approvalPending}</p>
        </button>
        <button onClick={() => applyCardFilter("status", "Approved")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Approved</p><p className="text-xl font-bold">{summary.approved}</p>
        </button>
        <button onClick={() => applyCardFilter("status", "Preview Sent")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Preview Sent</p><p className="text-xl font-bold">{summary.previewSent}</p>
        </button>
        <button onClick={() => applyCardFilter("expiringSoon", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Expiring Soon</p><p className={`text-xl font-bold ${summary.expiringSoon > 0 ? "text-amber-400" : ""}`}>{summary.expiringSoon}</p>
        </button>
        <button onClick={() => applyCardFilter("status", "Preview Accepted")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Preview Accepted Value</p>
          <p className="text-xl font-bold text-emerald-400">{formatMoney(summary.previewAcceptedValue, "USD")}</p>
        </button>
      </div>
      <p className="text-[11px] text-gray-500 -mt-4 mb-4">&quot;Preview Accepted Value&quot; totals frontend-preview statuses only — it is not a confirmed booked-revenue figure.</p>

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative flex-1 min-w-55 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search quote number, title, company..."
            aria-label="Search Quotes" className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        </div>
        <div className="hidden lg:flex gap-2 flex-wrap">
          <FilterSelects params={params} updateParam={updateParam} companies={companies} deals={deals} priceBooksList={priceBooksList} />
        </div>
        <button onClick={() => setShowFiltersDrawer(true)} className="lg:hidden flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
          Filters {isFiltered && `(${activeFilterEntries.length})`}
        </button>
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
          <span className="text-xs text-gray-500">Bulk approval, acceptance or rejection isn&apos;t offered — each Quote must be reviewed individually.</span>
          <button onClick={() => setSelected(new Set())} className="text-sm text-gray-400 hover:text-white ml-auto">Clear selection</button>
        </div>
      )}

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        {loading ? (
          <QuoteTableSkeleton visibleColumns={visibleColumns} />
        ) : error ? (
          <div className="p-10 text-center text-gray-400">
            <AlertCircle className="mx-auto mb-2 text-red-400" size={28} />
            <p className="mb-1 text-gray-200">Couldn&apos;t load Quotes</p>
            <p className="mb-3 text-sm">{error}</p>
            <button onClick={() => dispatch(fetchQuotes())} className="text-blue-400 hover:underline text-sm">Retry</button>
          </div>
        ) : pageItems.length === 0 && !isFiltered ? (
          <div className="p-12 text-center text-gray-400">
            <FileText className="mx-auto mb-2 text-gray-600" size={28} />
            <p className="mb-1">No Quotes yet.</p>
            <p className="text-sm text-gray-500 mb-4">Quotes connect Companies, Contacts, Deals, Products and Price Books into a document preview — for this frontend session only.</p>
            <button onClick={() => setBuilderState({ mode: "create" })} className="text-blue-400 hover:underline text-sm">Create Quote</button>
          </div>
        ) : pageItems.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-1">No Quotes match the current filters.</p>
            <p className="text-xs text-gray-500 mb-3">{activeFilterEntries.length} filter{activeFilterEntries.length === 1 ? "" : "s"} active</p>
            <button onClick={clearFilters} className="text-blue-400 hover:underline text-sm">Clear Filters</button>
          </div>
        ) : (
          <table className="w-full text-sm min-w-300">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 w-8"><input type="checkbox" checked={selected.size === pageItems.length && pageItems.length > 0} onChange={toggleSelectAll} aria-label="Select all Quotes" /></th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("quoteNumber")}>
                  <span className="flex items-center gap-1">Quote # {params.sort === "quoteNumber" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">Title</th>
                {visibleColumns.includes("version") && <th scope="col" className="px-4 py-3 font-medium">Version</th>}
                {visibleColumns.includes("company") && <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("company")}>Company</th>}
                {visibleColumns.includes("contact") && <th scope="col" className="px-4 py-3 font-medium">Primary Contact</th>}
                {visibleColumns.includes("deal") && <th scope="col" className="px-4 py-3 font-medium">Deal</th>}
                {visibleColumns.includes("total") && <th scope="col" className="px-4 py-3 font-medium text-right cursor-pointer select-none" onClick={() => toggleSort("total")}>Total</th>}
                {visibleColumns.includes("currency") && <th scope="col" className="px-4 py-3 font-medium">Currency</th>}
                {visibleColumns.includes("status") && <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("status")}>Status</th>}
                {visibleColumns.includes("validUntil") && <th scope="col" className="px-4 py-3 font-medium">Valid Until</th>}
                {visibleColumns.includes("owner") && <th scope="col" className="px-4 py-3 font-medium">Owner</th>}
                {visibleColumns.includes("updatedAt") && <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("updatedAt")}>Last Updated</th>}
                {visibleColumns.includes("priceBook") && <th scope="col" className="px-4 py-3 font-medium">Price Book</th>}
                {visibleColumns.includes("oneTimeTotal") && <th scope="col" className="px-4 py-3 font-medium text-right">One-Time Total</th>}
                {visibleColumns.includes("recurringTotal") && <th scope="col" className="px-4 py-3 font-medium text-right">Recurring Total</th>}
                {visibleColumns.includes("approvalState") && <th scope="col" className="px-4 py-3 font-medium">Approval State</th>}
                {visibleColumns.includes("issueDate") && <th scope="col" className="px-4 py-3 font-medium">Issue Date</th>}
                {visibleColumns.includes("team") && <th scope="col" className="px-4 py-3 font-medium">Team</th>}
                {visibleColumns.includes("createdAt") && <th scope="col" className="px-4 py-3 font-medium">Created Date</th>}
                <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((q) => {
                const effStatus = getEffectiveStatus(q);
                const totals = computeQuoteTotals(q);
                const recurringTotal = totals.monthlyRecurringTotal + totals.annualRecurringTotal + totals.otherRecurringTotal;
                return (
                  <tr key={q._id} className="border-t border-gray-800 hover:bg-gray-800/40">
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(q._id)} onChange={() => toggleSelectOne(q._id)} aria-label={`Select ${q.quoteNumber}`} />
                    </td>
                    <td className="px-4 py-3 font-medium cursor-pointer" tabIndex={0} role="link" onClick={() => navigate(`/sales/quotes/${q._id}`)} onKeyDown={(e) => { if (e.key === "Enter") navigate(`/sales/quotes/${q._id}`); }}>
                      {q.quoteNumber} {isExpiringSoon(q) && <span title="Expiring soon" className="ml-1 text-xs text-amber-400">⚠</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{q.title}</td>
                    {visibleColumns.includes("version") && <td className="px-4 py-3 text-gray-300">v{q.version}</td>}
                    {visibleColumns.includes("company") && <td className="px-4 py-3 text-gray-300">{companyNameById.get(q.companyId) || "—"}</td>}
                    {visibleColumns.includes("contact") && <td className="px-4 py-3 text-gray-300">{contactNameById.get(q.primaryContactId) || "—"}</td>}
                    {visibleColumns.includes("deal") && <td className="px-4 py-3 text-gray-300">{dealNameById.get(q.dealId) || "—"}</td>}
                    {visibleColumns.includes("total") && <td className="px-4 py-3 text-gray-300 text-right">{formatMoney(totals.grandTotal, q.currency)}</td>}
                    {visibleColumns.includes("currency") && <td className="px-4 py-3 text-gray-300">{q.currency}</td>}
                    {visibleColumns.includes("status") && <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs border ${QUOTE_STATUS_COLORS[effStatus]}`}>{effStatus}</span></td>}
                    {visibleColumns.includes("validUntil") && <td className="px-4 py-3 text-gray-300">{q.validUntilDate ? formatDate(q.validUntilDate) : "—"}</td>}
                    {visibleColumns.includes("owner") && <td className="px-4 py-3 text-gray-300">{ownerName(q.ownerId)}</td>}
                    {visibleColumns.includes("updatedAt") && <td className="px-4 py-3 text-gray-300">{formatDate(q.updatedAt)}</td>}
                    {visibleColumns.includes("priceBook") && <td className="px-4 py-3 text-gray-300">{priceBookNameById.get(q.priceBookId) || "—"}</td>}
                    {visibleColumns.includes("oneTimeTotal") && <td className="px-4 py-3 text-gray-300 text-right">{formatMoney(totals.oneTimeTotal, q.currency)}</td>}
                    {visibleColumns.includes("recurringTotal") && <td className="px-4 py-3 text-gray-300 text-right">{formatMoney(recurringTotal, q.currency)}</td>}
                    {visibleColumns.includes("approvalState") && <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs border ${APPROVAL_STATUS_COLORS[q.approval?.status] || APPROVAL_STATUS_COLORS["Not Required"]}`}>{q.approval?.status || "Not Required"}</span></td>}
                    {visibleColumns.includes("issueDate") && <td className="px-4 py-3 text-gray-300">{formatDate(q.issueDate)}</td>}
                    {visibleColumns.includes("team") && <td className="px-4 py-3 text-gray-300">{q.assignedTeam}</td>}
                    {visibleColumns.includes("createdAt") && <td className="px-4 py-3 text-gray-300">{formatDate(q.createdAt)}</td>}
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        quote={q} effStatus={effStatus}
                        open={openRowMenu === q._id} onToggle={() => setOpenRowMenu((v) => (v === q._id ? null : q._id))} onClose={() => setOpenRowMenu(null)}
                        onView={() => navigate(`/sales/quotes/${q._id}`)}
                        onEdit={() => setBuilderState({ mode: "edit", quote: q })}
                        onDuplicate={() => setBuilderState({ mode: "duplicate", quote: q })}
                        onNewVersion={() => setBuilderState({ mode: "newVersion", quote: q })}
                        onSubmitReview={() => dispatch(submitForReview(q._id))}
                        onPreviewSend={() => setRowAction({ type: "send", quote: q })}
                        onCustomerResponse={() => setRowAction({ type: "response", quote: q })}
                        onCancel={() => setRowAction({ type: "cancel", quote: q })}
                        onArchive={() => setRowAction({ type: "archive", quote: q })}
                        onRestore={() => dispatch(restoreQuote(q._id))}
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

      {showFiltersDrawer && <FiltersDrawer params={params} updateParam={updateParam} companies={companies} deals={deals} priceBooksList={priceBooksList} onClose={() => setShowFiltersDrawer(false)} />}
      {builderState && (
        <QuoteBuilder
          mode={builderState.mode} quote={builderState.quote} prefillDealId={builderState.prefillDealId}
          onClose={() => setBuilderState(null)} onSaved={() => dispatch(fetchQuotes())}
        />
      )}
      {rowAction?.type === "archive" && <ArchiveDialog quote={rowAction.quote} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchQuotes()); }} />}
      {rowAction?.type === "cancel" && <CancelDialog quote={rowAction.quote} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchQuotes()); }} />}
      {rowAction?.type === "send" && <PreviewSendDialog quote={rowAction.quote} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchQuotes()); }} />}
      {rowAction?.type === "response" && <CustomerResponseDialog quote={rowAction.quote} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchQuotes()); }} />}
      {bulkAction && <BulkActionDialog bulkAction={bulkAction} value={bulkValue} setValue={setBulkValue} reason={bulkReason} setReason={setBulkReason} count={selected.size} onClose={() => setBulkAction(null)} onSubmit={submitBulk} />}
    </div>
  );
}

function FilterSelects({ params, updateParam, companies, deals, priceBooksList }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  return (
    <>
      <select value={params.status || ""} onChange={(e) => updateParam("status", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by status">
        <option value="">All Statuses</option>
        {QUOTE_STATUSES.filter((s) => s !== "Expired").map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={params.approvalStatus || ""} onChange={(e) => updateParam("approvalStatus", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by approval state">
        <option value="">All Approval States</option>
        {APPROVAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
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
      <select value={params.priceBookId || ""} onChange={(e) => updateParam("priceBookId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by price book">
        <option value="">All Price Books</option>
        {priceBooksList.map((pb) => <option key={pb._id} value={pb._id}>{pb.name}</option>)}
      </select>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.expiringSoon === "true"} onChange={(e) => updateParam("expiringSoon", e.target.checked ? "true" : undefined)} /> Expiring Soon
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.hasRecurring === "true"} onChange={(e) => updateParam("hasRecurring", e.target.checked ? "true" : undefined)} /> Has Recurring Items
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.hasDiscounts === "true"} onChange={(e) => updateParam("hasDiscounts", e.target.checked ? "true" : undefined)} /> Has Discounts
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.archived === "true"} onChange={(e) => updateParam("archived", e.target.checked ? "true" : "false")} /> Archived
      </label>
    </>
  );
}

function FiltersDrawer({ params, updateParam, companies, deals, priceBooksList, onClose }) {
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/60 flex justify-end z-50" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Filters" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border-l border-gray-800 w-full max-w-xs h-full p-4 space-y-3 overflow-y-auto">
        <div className="flex justify-between items-center mb-2"><h2 className="font-bold">Filters</h2><button onClick={onClose} aria-label="Close filters"><X size={18} /></button></div>
        <div className="flex flex-col gap-2"><FilterSelects params={params} updateParam={updateParam} companies={companies} deals={deals} priceBooksList={priceBooksList} /></div>
      </div>
    </div>
  );
}

function QuoteTableSkeleton({ visibleColumns }) {
  const colCount = 3 + visibleColumns.length;
  return (
    <div className="p-4">
      <div className="flex gap-4 px-4 py-3 border-b border-gray-800">{Array.from({ length: colCount }).map((_, i) => <div key={i} className="h-3 bg-gray-800/60 rounded flex-1 animate-pulse" />)}</div>
      {Array.from({ length: 6 }).map((_, row) => (<div key={row} className="flex gap-4 px-4 py-3 border-b border-gray-800/60">{Array.from({ length: colCount }).map((_, i) => <div key={i} className="h-4 bg-gray-800/40 rounded flex-1 animate-pulse" />)}</div>))}
    </div>
  );
}

function RowActionsMenu({ quote, effStatus, open, onToggle, onClose, onView, onEdit, onDuplicate, onNewVersion, onSubmitReview, onPreviewSend, onCustomerResponse, onCancel, onArchive, onRestore }) {
  const canEdit = !LOCKED_FOR_EDIT_STATUSES.includes(effStatus);
  const canSubmit = effStatus === "Draft";
  const canSend = ["Approved", "Draft", "Internal Review"].includes(effStatus);
  const canRespond = ["Preview Sent", "Preview Viewed"].includes(effStatus);
  const canCancel = !["Cancelled", "Superseded", "Preview Accepted"].includes(effStatus);
  const items = [
    { label: "View", action: onView },
    canEdit && { label: "Edit", action: onEdit },
    { label: "Duplicate", action: onDuplicate },
    { label: "Create New Version", action: onNewVersion },
    canSubmit && { label: "Submit for Review", action: onSubmitReview },
    canSend && { label: "Preview Send", action: onPreviewSend },
    canRespond && { label: "Preview Customer Response", action: onCustomerResponse },
    canCancel && { label: "Cancel", action: onCancel },
    quote.archived ? { label: "Restore", action: onRestore } : { label: "Archive", action: onArchive },
  ].filter(Boolean);
  return (
    <div className="relative inline-block">
      <button onClick={onToggle} aria-label={`Actions for ${quote.quoteNumber}`} aria-haspopup="menu" aria-expanded={open} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white"><MoreHorizontal size={16} /></button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-52 shadow-xl text-left" onMouseLeave={onClose}>
          {items.map((i) => <button key={i.label} role="menuitem" onClick={() => { i.action(); onClose(); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">{i.label}</button>)}
        </div>
      )}
    </div>
  );
}

function ArchiveDialog({ quote, onClose, onDone }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => { e.preventDefault(); if (!reason.trim()) return; await dispatch(archiveQuote({ id: quote._id, reason })); onDone(); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Archive Quote" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Archive &quot;{quote.quoteNumber}&quot;</h2>
        <p className="text-sm text-gray-400">Archived Quotes remain visible through filters and the related Deal&apos;s Quote history.</p>
        <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button><button type="submit" disabled={!reason.trim()} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-sm font-medium">Archive</button></div>
      </form>
    </div>
  );
}

function CancelDialog({ quote, onClose, onDone }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => { e.preventDefault(); await dispatch(cancelQuote({ id: quote._id, reason })); onDone(); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Cancel Quote" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Cancel &quot;{quote.quoteNumber}&quot;</h2>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (optional)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Back</button><button type="submit" className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-sm font-medium">Cancel Quote</button></div>
      </form>
    </div>
  );
}

function PreviewSendDialog({ quote, onClose, onDone }) {
  const dispatch = useDispatch();
  const [form, setForm] = useState({ recipientEmail: "", cc: "", subject: `Your Quote ${quote.quoteNumber}`, message: "Please find your quote for review." });
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => { e.preventDefault(); if (!form.recipientEmail.trim()) return; await dispatch(previewSend({ id: quote._id, ...form })); onDone(); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Preview Send" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-3">
        <h2 className="text-lg font-bold">Preview Send</h2>
        <p className="text-xs text-amber-300">No email will be sent during this frontend phase. Confirming may move this Quote to Preview Sent status.</p>
        <input required value={form.recipientEmail} onChange={(e) => setForm((f) => ({ ...f, recipientEmail: e.target.value }))} placeholder="Recipient email" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input value={form.cc} onChange={(e) => setForm((f) => ({ ...f, cc: e.target.value }))} placeholder="CC (preview)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Subject" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} rows={3} placeholder="Message" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button><button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Simulate Send</button></div>
      </form>
    </div>
  );
}

function CustomerResponseDialog({ quote, onClose, onDone }) {
  const dispatch = useDispatch();
  const [type, setType] = useState("Viewed");
  const [details, setDetails] = useState({ customerName: "", jobTitle: "", typedNamePreview: "", reason: "", accepted: false });
  const containerRef = useFocusTrap(true, onClose);
  const needsReason = type === "Rejected" || type === "Changes Requested";
  const canSubmit = !needsReason || details.reason.trim();
  const submit = async (e) => { e.preventDefault(); if (!canSubmit) return; await dispatch(simulateCustomerResponse({ id: quote._id, type, details })); onDone(); };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Preview Customer Response" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-3">
        <h2 className="text-lg font-bold">Preview Customer Response</h2>
        <p className="text-xs text-gray-500">A controlled frontend simulation only — this does not represent a real customer action or a legally binding signature.</p>
        <select value={type} onChange={(e) => setType(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          {CUSTOMER_RESPONSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {type === "Accepted" && (
          <>
            <input value={details.customerName} onChange={(e) => setDetails((d) => ({ ...d, customerName: e.target.value }))} placeholder="Customer name" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <input value={details.jobTitle} onChange={(e) => setDetails((d) => ({ ...d, jobTitle: e.target.value }))} placeholder="Job title" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={details.accepted} onChange={(e) => setDetails((d) => ({ ...d, accepted: e.target.checked }))} /> I confirm acceptance of this Quote (preview only)</label>
            <input value={details.typedNamePreview} onChange={(e) => setDetails((d) => ({ ...d, typedNamePreview: e.target.value }))} placeholder="Typed name (preview — not a legal signature)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </>
        )}
        {needsReason && (
          <textarea required value={details.reason} onChange={(e) => setDetails((d) => ({ ...d, reason: e.target.value }))} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        )}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button><button type="submit" disabled={!canSubmit} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">Simulate Response</button></div>
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
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={titles[bulkAction]} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">{titles[bulkAction]}</h2>
        <p className="text-sm text-gray-400">{count} Quote{count === 1 ? "" : "s"} selected.</p>
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
