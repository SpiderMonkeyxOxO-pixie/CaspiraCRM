import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Plus, Search, RefreshCw, Download, Upload, ChevronUp, ChevronDown, Columns3,
  X, AlertCircle, ChevronLeft, ChevronRight, Bookmark,
} from "lucide-react";
import {
  fetchLeads, fetchAllMatchingLeads, bulkAssignLeads, bulkStatusChangeLeads, bulkArchiveLeads,
  LEAD_STATUSES, REASON_REQUIRED_STATUSES,
} from "../../../redux/crm/leadsSlice";
import { CRM_DEPARTMENTS } from "../../../Helpers/mockUsersData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import LeadFormModal from "./LeadFormModal";

const LEAD_SOURCES = ["Website", "Referral", "Cold Call", "Trade Show", "Social Media", "Advertisement"];

const STATUS_COLORS = {
  New: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Attempted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Contacted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Qualified: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Converted: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  Unqualified: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Duplicate: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Spam: "bg-red-500/15 text-red-300 border-red-500/30",
};

const ALL_COLUMNS = [
  { key: "companyName", label: "Company", optional: true },
  { key: "email", label: "Email", optional: true },
  { key: "phone", label: "Phone", optional: true },
  { key: "source", label: "Source", optional: true },
  { key: "priority", label: "Priority", optional: true },
  { key: "score", label: "Score", optional: true },
  { key: "estimatedValue", label: "Est. Value", optional: true },
  { key: "ownerName", label: "Owner", optional: true },
  { key: "department", label: "Department", optional: true },
  { key: "nextFollowUp", label: "Next Follow-up", optional: true },
  { key: "lastActivity", label: "Last Activity", optional: false },
  { key: "createdAt", label: "Created", optional: true },
];
const DEFAULT_VISIBLE = ["companyName", "email", "source", "priority", "score", "ownerName", "nextFollowUp"];
const COLUMN_PREF_KEY = "crm.leads.visibleColumns";
const SAVED_VIEWS_KEY = "crm.leads.savedViews";

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function LeadsList() {
  const dispatch = useDispatch();
  const owners = useCrmOwnerOptions();
  const navigate = useNavigate();
  const currentUser = useSelector((s) => s.auth.data);
  const { items: leads, loading, error, total, page, pageSize, summary } = useSelector((s) => s.leads);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const debouncedSearch = useDebounced(searchInput, 350);

  const [showCreate, setShowCreate] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null); // "assign" | "status" | "archive"
  const [bulkValue, setBulkValue] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [exporting, setExporting] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(COLUMN_PREF_KEY)) || DEFAULT_VISIBLE;
    } catch {
      return DEFAULT_VISIBLE;
    }
  });
  const [savedViews, setSavedViews] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)) || [];
    } catch {
      return [];
    }
  });

  const params = useMemo(() => {
    const p = {};
    for (const [key, value] of searchParams.entries()) p[key] = value;
    if (debouncedSearch) p.search = debouncedSearch;
    else delete p.search;
    p.page = p.page || "1";
    p.pageSize = p.pageSize || "20";
    p.archived = p.archived || "false";
    p.sort = p.sort || "createdAt";
    p.order = p.order || "desc";
    return p;
  }, [searchParams, debouncedSearch]);

  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    dispatch(fetchLeads(params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, paramsKey]);

  // Push debounced search into the URL once it settles, resetting to page 1.
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

  const updateParam = useCallback((key, value, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === null || value === "") next.delete(key);
    else next.set(key, value);
    if (resetPage) next.set("page", "1");
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const clearFilters = () => {
    setSearchInput("");
    setSearchParams({});
  };

  const activeFilterCount = Array.from(searchParams.keys()).filter((k) => !["page", "pageSize", "sort", "order"].includes(k)).length;

  const toggleSort = (key) => {
    const currentSort = params.sort;
    const currentOrder = params.order;
    const next = new URLSearchParams(searchParams);
    if (currentSort === key) next.set("order", currentOrder === "asc" ? "desc" : "asc");
    else {
      next.set("sort", key);
      next.set("order", "asc");
    }
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
    if (selected.size === leads.length) setSelected(new Set());
    else setSelected(new Set(leads.map((l) => l._id)));
  };
  const toggleSelectOne = (id) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyCardFilter = (key, value) => updateParam(key, value);

  const saveCurrentView = () => {
    const name = window.prompt("Name this view:");
    if (!name?.trim()) return;
    const view = { name: name.trim(), params: Object.fromEntries(searchParams.entries()) };
    const next = [...savedViews.filter((v) => v.name !== view.name), view];
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
  };
  const applyView = (view) => {
    setSearchParams(view.params);
    setSearchInput(view.params.search || "");
    setShowViews(false);
  };
  const deleteView = (name) => {
    const next = savedViews.filter((v) => v.name !== name);
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
  };

  const runExport = async () => {
    setExporting(true);
    const result = await dispatch(fetchAllMatchingLeads(params)).unwrap().catch(() => []);
    const rows = result.map((l) => ({
      Name: l.name, Company: l.companyName, Email: l.email, Phone: l.phone, Source: l.source,
      Status: l.status, Priority: l.priority, Score: l.score, "Est. Value": l.estimatedValue,
      Owner: l.ownerName, Department: l.department, "Next Follow-up": l.nextFollowUp, Created: l.createdAt,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    XLSX.writeFile(wb, `leads_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExporting(false);
  };

  const submitBulk = async () => {
    const ids = Array.from(selected);
    if (bulkAction === "assign" && bulkValue) {
      await dispatch(bulkAssignLeads({ leadIds: ids, ownerId: bulkValue }));
    } else if (bulkAction === "status" && bulkValue) {
      if (REASON_REQUIRED_STATUSES.includes(bulkValue) && !bulkReason.trim()) return;
      await dispatch(bulkStatusChangeLeads({ leadIds: ids, status: bulkValue, reason: bulkReason }));
    } else if (bulkAction === "archive") {
      if (!bulkReason.trim()) return;
      await dispatch(bulkArchiveLeads({ leadIds: ids, reason: bulkReason }));
    }
    setSelected(new Set());
    setBulkAction(null);
    setBulkValue("");
    setBulkReason("");
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isFiltered = activeFilterCount > 0;

  return (
    <div className="p-6 text-white">
      {/* Breadcrumb + header */}
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/crm/dashboard" className="hover:text-gray-300">CRM</Link> / <span className="text-gray-300">Leads</span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-sm text-gray-400 mt-1">
            Track and qualify inbound leads before converting them to customers. {total} lead{total === 1 ? "" : "s"} accessible to you.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => dispatch(fetchLeads(params))} title="Refresh" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <RefreshCw size={16} /> Refresh
          </button>
          <button onClick={() => navigate("/crm/import?type=leads")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <Upload size={16} /> Import
          </button>
          <button onClick={runExport} disabled={exporting} title="Export the currently filtered results" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm disabled:opacity-50">
            <Download size={16} /> {exporting ? "Exporting..." : "Export"}
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium text-white">
            <Plus size={16} /> Add Lead
          </button>
        </div>
      </div>

      {/* Summary cards — reflect active filters, clickable to refine further */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <button onClick={clearFilters} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Total</p>
          <p className="text-xl font-bold">{summary.total}</p>
        </button>
        <button onClick={() => applyCardFilter("status", "New")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">New</p>
          <p className="text-xl font-bold">{summary.new}</p>
        </button>
        <button onClick={() => applyCardFilter("status", "Qualified")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Qualified</p>
          <p className="text-xl font-bold">{summary.qualified}</p>
        </button>
        <button onClick={() => applyCardFilter("followUpOverdue", undefined)} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Follow-ups Due</p>
          <p className="text-xl font-bold">{summary.followUpsDue}</p>
        </button>
        <button onClick={() => applyCardFilter("followUpOverdue", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Overdue</p>
          <p className={`text-xl font-bold ${summary.overdueFollowUps > 0 ? "text-red-400" : ""}`}>{summary.overdueFollowUps}</p>
        </button>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
          <p className="text-xs text-gray-400 uppercase mb-1">Conversion</p>
          <p className="text-xl font-bold">{summary.conversionRate}%</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, company, email, phone..."
            aria-label="Search leads"
            className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <select value={params.status || ""} onChange={(e) => updateParam("status", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by status">
          <option value="">All Statuses</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={params.source || ""} onChange={(e) => updateParam("source", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by source">
          <option value="">All Sources</option>
          {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={params.priority || ""} onChange={(e) => updateParam("priority", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by priority">
          <option value="">All Priorities</option>
          {["Low", "Medium", "High"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={params.ownerId || ""} onChange={(e) => updateParam("ownerId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by owner">
          <option value="">All Owners</option>
          {currentUser && <option value="me">Me</option>}
          {owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={params.department || ""} onChange={(e) => updateParam("department", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by department">
          <option value="">All Departments</option>
          {CRM_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
          <input type="checkbox" checked={params.archived === "true"} onChange={(e) => updateParam("archived", e.target.checked ? "true" : "false")} />
          Archived
        </label>

        <div className="relative">
          <button onClick={() => setShowColumns((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <Columns3 size={16} /> Columns
          </button>
          {showColumns && (
            <div className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg p-3 z-20 w-56 shadow-xl">
              {ALL_COLUMNS.filter((c) => c.optional).map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm py-1">
                  <input type="checkbox" checked={visibleColumns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                  {c.label}
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

        {isFiltered && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-sm text-gray-400 hover:text-white">
            <X size={14} /> Clear filters
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-700/40 rounded-xl p-3 mb-4 flex-wrap">
          <span className="text-sm">{selected.size} selected</span>
          <button onClick={() => setBulkAction("assign")} className="text-sm text-blue-300 hover:underline">Assign</button>
          <button onClick={() => setBulkAction("status")} className="text-sm text-blue-300 hover:underline">Change Status</button>
          <button onClick={() => setBulkAction("archive")} className="text-sm text-blue-300 hover:underline">Archive</button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-gray-400 hover:text-white ml-auto">Clear selection</button>
        </div>
      )}

      {bulkAction && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setBulkAction(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">
              {bulkAction === "assign" ? "Bulk Assign" : bulkAction === "status" ? "Bulk Change Status" : "Bulk Archive"}
            </h2>
            {bulkAction === "assign" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Select owner...</option>
                {owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            {bulkAction === "status" && (
              <>
                <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select status...</option>
                  {LEAD_STATUSES.filter((s) => s !== "Converted").map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {REASON_REQUIRED_STATUSES.includes(bulkValue) && (
                  <input value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                )}
              </>
            )}
            {bulkAction === "archive" && (
              <input value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setBulkAction(null)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button onClick={submitBulk} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-800/50 rounded animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="p-10 text-center text-gray-400">
            <AlertCircle className="mx-auto mb-2 text-red-400" size={28} />
            <p className="mb-3">{error}</p>
            <button onClick={() => dispatch(fetchLeads(params))} className="text-blue-400 hover:underline text-sm">Retry</button>
          </div>
        ) : leads.length === 0 && !isFiltered ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-3">No leads yet — create your first lead to start tracking your pipeline.</p>
            <button onClick={() => setShowCreate(true)} className="text-blue-400 hover:underline text-sm">Add Lead</button>
          </div>
        ) : leads.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-1">No leads match the current filters.</p>
            <p className="text-xs text-gray-500 mb-3">{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active</p>
            <button onClick={clearFilters} className="text-blue-400 hover:underline text-sm">Clear Filters</button>
          </div>
        ) : (
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={selected.size === leads.length && leads.length > 0} onChange={toggleSelectAll} aria-label="Select all leads" />
                </th>
                <th className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("name")}>
                  <span className="flex items-center gap-1">Name {params.sort === "name" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                {visibleColumns.includes("companyName") && <th className="px-4 py-3 font-medium">Company</th>}
                {visibleColumns.includes("email") && <th className="px-4 py-3 font-medium">Email</th>}
                {visibleColumns.includes("phone") && <th className="px-4 py-3 font-medium">Phone</th>}
                {visibleColumns.includes("source") && <th className="px-4 py-3 font-medium">Source</th>}
                <th className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("status")}>
                  <span className="flex items-center gap-1">Status {params.sort === "status" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                {visibleColumns.includes("priority") && <th className="px-4 py-3 font-medium">Priority</th>}
                {visibleColumns.includes("score") && (
                  <th className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("score")}>
                    <span className="flex items-center gap-1">Score {params.sort === "score" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                  </th>
                )}
                {visibleColumns.includes("estimatedValue") && <th className="px-4 py-3 font-medium">Est. Value</th>}
                {visibleColumns.includes("ownerName") && <th className="px-4 py-3 font-medium">Owner</th>}
                {visibleColumns.includes("department") && <th className="px-4 py-3 font-medium">Department</th>}
                {visibleColumns.includes("nextFollowUp") && (
                  <th className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("nextFollowUp")}>
                    <span className="flex items-center gap-1">Next Follow-up {params.sort === "nextFollowUp" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                  </th>
                )}
                {visibleColumns.includes("createdAt") && <th className="px-4 py-3 font-medium">Created</th>}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const overdue = lead.nextFollowUp && new Date(lead.nextFollowUp) < new Date() && lead.status !== "Converted";
                return (
                  <tr key={lead._id} className="border-t border-gray-800 hover:bg-gray-800/40">
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(lead._id)} onChange={() => toggleSelectOne(lead._id)} aria-label={`Select ${lead.name}`} />
                    </td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => navigate(`/crm/leads/${lead._id}`)}>
                      <div className="font-medium">{lead.name}</div>
                      {lead.archived && <span className="text-xs text-gray-500">Archived</span>}
                    </td>
                    {visibleColumns.includes("companyName") && <td className="px-4 py-3 text-gray-300">{lead.companyName}</td>}
                    {visibleColumns.includes("email") && <td className="px-4 py-3 text-gray-300">{lead.email}</td>}
                    {visibleColumns.includes("phone") && <td className="px-4 py-3 text-gray-300">{lead.phone}</td>}
                    {visibleColumns.includes("source") && <td className="px-4 py-3 text-gray-300">{lead.source}</td>}
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs border ${STATUS_COLORS[lead.status] || STATUS_COLORS.New}`}>{lead.status}</span>
                    </td>
                    {visibleColumns.includes("priority") && <td className="px-4 py-3 text-gray-300">{lead.priority}</td>}
                    {visibleColumns.includes("score") && <td className="px-4 py-3 text-gray-300">{lead.score}</td>}
                    {visibleColumns.includes("estimatedValue") && <td className="px-4 py-3 text-gray-300">${lead.estimatedValue?.toLocaleString()}</td>}
                    {visibleColumns.includes("ownerName") && <td className="px-4 py-3 text-gray-300">{lead.ownerName || "Unassigned"}</td>}
                    {visibleColumns.includes("department") && <td className="px-4 py-3 text-gray-300">{lead.department}</td>}
                    {visibleColumns.includes("nextFollowUp") && (
                      <td className={`px-4 py-3 ${overdue ? "text-red-400 font-medium" : "text-gray-300"}`}>
                        {lead.nextFollowUp ? new Date(lead.nextFollowUp).toLocaleDateString() : "—"} {overdue && "(Overdue)"}
                      </td>
                    )}
                    {visibleColumns.includes("createdAt") && <td className="px-4 py-3 text-gray-300">{new Date(lead.createdAt).toLocaleDateString()}</td>}
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
            <button disabled={page <= 1} onClick={() => updateParam("page", String(page - 1), false)} className="p-2 rounded-lg border border-gray-800 disabled:opacity-30" aria-label="Previous page">
              <ChevronLeft size={16} />
            </button>
            <button disabled={page >= totalPages} onClick={() => updateParam("page", String(page + 1), false)} className="p-2 rounded-lg border border-gray-800 disabled:opacity-30" aria-label="Next page">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {showCreate && <LeadFormModal onClose={() => setShowCreate(false)} onSaved={() => dispatch(fetchLeads(params))} />}
    </div>
  );
}
