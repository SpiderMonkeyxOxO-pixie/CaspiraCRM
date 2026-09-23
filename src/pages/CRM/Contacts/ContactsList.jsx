import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Plus, Search, RefreshCw, Download, Upload, ChevronUp, ChevronDown, Columns3,
  X, AlertCircle, ChevronLeft, ChevronRight, Bookmark, MoreHorizontal, Rows3, Rows2,
} from "lucide-react";
import {
  fetchContacts, fetchAllMatchingContacts,
  bulkAssignContacts, bulkTagContacts, bulkLifecycleUpdateContacts, bulkArchiveContacts,
  addContactNote, logContactActivity, createContactTask, assignContact, archiveContact,
  CONTACT_RELATIONSHIP_TYPES, CONTACT_LIFECYCLE_STAGES, CONTACT_SOURCES,
} from "../../../redux/crm/contactsSlice";
import { contactCommunicationStatus } from "../../../Helpers/mockCrmData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import useFocusTrap from "../../../hooks/useFocusTrap";
import ContactFormModal from "./ContactFormModal";

const RELATIONSHIP_COLORS = {
  Customer: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Prospect: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Former Customer": "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Partner: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Vendor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};
const COMM_STATUS_COLORS = {
  Active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Restricted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Do Not Contact": "bg-red-500/15 text-red-300 border-red-500/30",
};

const ALL_COLUMNS = [
  { key: "companyName", label: "Company", optional: false },
  { key: "jobTitle", label: "Job Title", optional: false },
  { key: "email", label: "Email", optional: false },
  { key: "phone", label: "Phone", optional: false },
  { key: "relationshipType", label: "Relationship Type", optional: false },
  { key: "lifecycleStage", label: "Lifecycle Stage", optional: false },
  { key: "ownerName", label: "Owner", optional: false },
  { key: "lastActivity", label: "Last Activity", optional: false },
  { key: "nextActivity", label: "Next Activity", optional: false },
  { key: "communicationStatus", label: "Communication Status", optional: false },
  { key: "country", label: "Country", optional: true },
  { key: "preferredLanguage", label: "Language", optional: true },
  { key: "source", label: "Source", optional: true },
  { key: "tags", label: "Tags", optional: true },
  { key: "createdAt", label: "Created", optional: true },
  { key: "updatedAt", label: "Updated", optional: true },
];
const DEFAULT_VISIBLE = ALL_COLUMNS.filter((c) => !c.optional).map((c) => c.key);
const COLUMN_PREF_KEY = "crm.contacts.visibleColumns";
const SAVED_VIEWS_KEY = "crm.contacts.savedViews";
const DENSITY_KEY = "crm.contacts.density";

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function lastActivityAt(contact) {
  const events = contact.activity || [];
  if (!events.length) return null;
  return events.reduce((latest, e) => (new Date(e.at) > new Date(latest) ? e.at : latest), events[0].at);
}
function nextActivityAt(contact) {
  const upcoming = (contact.tasks || []).filter((t) => !t.completed && t.dueDate);
  if (!upcoming.length) return contact.nextFollowUp || null;
  const soonest = upcoming.reduce((min, t) => (new Date(t.dueDate) < new Date(min) ? t.dueDate : min), upcoming[0].dueDate);
  return contact.nextFollowUp && new Date(contact.nextFollowUp) < new Date(soonest) ? contact.nextFollowUp : soonest;
}

const FILTER_LABELS = {
  relationshipType: "Relationship",
  lifecycleStage: "Lifecycle",
  ownerId: "Owner",
  source: "Source",
  country: "Country",
  tag: "Tag",
  communicationStatus: "Comm. Status",
  followUpOverdue: "Overdue Follow-up",
  archived: "Archived",
  search: "Search",
};

export default function ContactsList() {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items: contacts, loading, error, total, page, pageSize, summary } = useSelector((s) => s.contacts);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const debouncedSearch = useDebounced(searchInput, 350);

  const [showCreate, setShowCreate] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [openRowMenu, setOpenRowMenu] = useState(null);
  const [rowAction, setRowAction] = useState(null); // { type, contact }
  const [selected, setSelected] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [density, setDensity] = useState(() => localStorage.getItem(DENSITY_KEY) || "comfortable");

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
    dispatch(fetchContacts(params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, paramsKey]);

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
  const removeFilter = (key) => updateParam(key, undefined);

  const activeFilterEntries = Array.from(searchParams.entries()).filter(([k]) => !["page", "pageSize", "sort", "order"].includes(k) && !(k === "archived" && searchParams.get(k) === "false"));
  const activeFilterCount = activeFilterEntries.length;
  const isFiltered = activeFilterCount > 0;

  const toggleSort = (key) => {
    const next = new URLSearchParams(searchParams);
    if (params.sort === key) next.set("order", params.order === "asc" ? "desc" : "asc");
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
  const toggleDensity = () => {
    setDensity((d) => {
      const next = d === "comfortable" ? "compact" : "comfortable";
      localStorage.setItem(DENSITY_KEY, next);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === contacts.length) setSelected(new Set());
    else setSelected(new Set(contacts.map((c) => c._id)));
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
    const result = await dispatch(fetchAllMatchingContacts(params)).unwrap().catch(() => []);
    const rows = result.map((c) => ({
      Name: c.name, Company: c.companyName, "Job Title": c.jobTitle, Email: c.email, Phone: c.phone,
      "Relationship Type": c.relationshipType, "Lifecycle Stage": c.lifecycleStage, Owner: c.ownerName,
      "Communication Status": contactCommunicationStatus(c), Country: c.country, Source: c.source,
      Tags: (c.tags || []).join(", "), Created: c.createdAt,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contacts");
    XLSX.writeFile(wb, `contacts_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExporting(false);
  };

  const submitBulk = async () => {
    const ids = Array.from(selected);
    if (bulkAction === "assign" && bulkValue) {
      await dispatch(bulkAssignContacts({ contactIds: ids, ownerId: bulkValue }));
    } else if (bulkAction === "tag" && bulkValue.trim()) {
      await dispatch(bulkTagContacts({ contactIds: ids, tag: bulkValue.trim() }));
    } else if (bulkAction === "lifecycle" && bulkValue) {
      await dispatch(bulkLifecycleUpdateContacts({ contactIds: ids, lifecycleStage: bulkValue }));
    } else if (bulkAction === "archive") {
      if (!bulkReason.trim()) return;
      await dispatch(bulkArchiveContacts({ contactIds: ids, reason: bulkReason }));
    }
    setSelected(new Set());
    setBulkAction(null);
    setBulkValue("");
    setBulkReason("");
  };

  const runExportSelected = async () => {
    const rows = contacts.filter((c) => selected.has(c._id)).map((c) => ({
      Name: c.name, Company: c.companyName, Email: c.email, Phone: c.phone, Relationship: c.relationshipType,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Selected Contacts");
    XLSX.writeFile(wb, `contacts_selected_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rowPad = density === "compact" ? "py-1.5" : "py-3";

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/crm/dashboard" className="hover:text-gray-300">CRM</Link> / <span className="text-gray-300">Contacts</span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Contacts</h1>
          <p className="text-sm text-gray-400 mt-1">
            External people — customers, prospects, partners and vendors. {total} contact{total === 1 ? "" : "s"} visible.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => dispatch(fetchContacts(params))} title="Refresh" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <RefreshCw size={16} /> Refresh
          </button>
          <button onClick={() => navigate("/crm/import?type=contacts")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <Upload size={16} /> Import
          </button>
          <button onClick={runExport} disabled={exporting} title="Export the currently filtered results" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm disabled:opacity-50">
            <Download size={16} /> {exporting ? "Exporting..." : "Export"}
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium text-white">
            <Plus size={16} /> Add Contact
          </button>
        </div>
      </div>

      {/* Compact overview metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <button onClick={clearFilters} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Total</p>
          <p className="text-xl font-bold">{summary.total}</p>
        </button>
        <button onClick={() => applyCardFilter("relationshipType", "Prospect")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Prospects</p>
          <p className="text-xl font-bold">{summary.prospects}</p>
        </button>
        <button
          onClick={() => { updateParam("relationshipType", "Customer"); updateParam("lifecycleStage", "Active", false); }}
          className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left"
        >
          <p className="text-xs text-gray-400 uppercase mb-1">Active Customers</p>
          <p className="text-xl font-bold">{summary.activeCustomers}</p>
        </button>
        <button onClick={() => applyCardFilter("followUpOverdue", undefined)} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Follow-ups Due</p>
          <p className="text-xl font-bold">{summary.followUpsDue}</p>
        </button>
        <button onClick={() => applyCardFilter("followUpOverdue", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Overdue</p>
          <p className={`text-xl font-bold ${summary.overdueFollowUps > 0 ? "text-red-400" : ""}`}>{summary.overdueFollowUps}</p>
        </button>
        <button onClick={() => applyCardFilter("communicationStatus", "Do Not Contact")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Do Not Contact</p>
          <p className={`text-xl font-bold ${summary.doNotContact > 0 ? "text-red-400" : ""}`}>{summary.doNotContact}</p>
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative flex-1 min-w-55 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, company, email, phone..."
            aria-label="Search contacts"
            className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <select value={params.relationshipType || ""} onChange={(e) => updateParam("relationshipType", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by relationship type">
          <option value="">All Relationship Types</option>
          {CONTACT_RELATIONSHIP_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={params.lifecycleStage || ""} onChange={(e) => updateParam("lifecycleStage", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by lifecycle stage">
          <option value="">All Lifecycle Stages</option>
          {CONTACT_LIFECYCLE_STAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={params.ownerId || ""} onChange={(e) => updateParam("ownerId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by owner">
          <option value="">All Owners</option>
          {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={params.source || ""} onChange={(e) => updateParam("source", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by source">
          <option value="">All Sources</option>
          {CONTACT_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={params.communicationStatus || ""} onChange={(e) => updateParam("communicationStatus", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by communication status">
          <option value="">All Communication Statuses</option>
          <option value="Active">Active</option>
          <option value="Restricted">Restricted</option>
          <option value="Do Not Contact">Do Not Contact</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
          <input type="checkbox" checked={params.archived === "true"} onChange={(e) => updateParam("archived", e.target.checked ? "true" : "false")} />
          Archived
        </label>

        <button onClick={toggleDensity} title="Toggle row density" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
          {density === "compact" ? <Rows3 size={16} /> : <Rows2 size={16} />} {density === "compact" ? "Compact" : "Comfortable"}
        </button>

        <div className="relative">
          <button onClick={() => setShowColumns((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <Columns3 size={16} /> Columns
          </button>
          {showColumns && (
            <div className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg p-3 z-20 w-56 shadow-xl max-h-72 overflow-y-auto">
              {ALL_COLUMNS.map((c) => (
                <label key={c.key} className={`flex items-center gap-2 text-sm py-1 ${c.optional ? "" : "opacity-60"}`}>
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

      {/* Active filter tokens */}
      {isFiltered && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-gray-500">{total} result{total === 1 ? "" : "s"}</span>
          {activeFilterEntries.map(([key, value]) => (
            <span key={key} className="flex items-center gap-1.5 bg-gray-800/70 border border-gray-700 rounded-full pl-2.5 pr-1.5 py-1 text-xs text-gray-200">
              {FILTER_LABELS[key] || key}: {value === "true" ? "Yes" : value}
              <button onClick={() => removeFilter(key)} aria-label={`Clear ${FILTER_LABELS[key] || key} filter`} className="hover:text-white">
                <X size={12} />
              </button>
            </span>
          ))}
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white ml-1">
            <X size={12} /> Clear all filters
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-700/40 rounded-xl p-3 mb-4 flex-wrap">
          <span className="text-sm">{selected.size} selected</span>
          <button onClick={() => setBulkAction("assign")} className="text-sm text-blue-300 hover:underline">Assign</button>
          <button onClick={() => setBulkAction("tag")} className="text-sm text-blue-300 hover:underline">Add Tag</button>
          <button onClick={() => setBulkAction("lifecycle")} className="text-sm text-blue-300 hover:underline">Change Lifecycle</button>
          <button onClick={() => setBulkAction("archive")} className="text-sm text-blue-300 hover:underline">Archive</button>
          <button onClick={runExportSelected} className="text-sm text-blue-300 hover:underline">Export Selected</button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-gray-400 hover:text-white ml-auto">Clear selection</button>
        </div>
      )}

      {bulkAction && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setBulkAction(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">
              {{ assign: "Bulk Assign", tag: "Bulk Add Tag", lifecycle: "Bulk Change Lifecycle", archive: "Bulk Archive" }[bulkAction]}
            </h2>
            {bulkAction === "assign" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Select owner...</option>
                {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            {bulkAction === "tag" && (
              <input value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} placeholder="Tag name" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            )}
            {bulkAction === "lifecycle" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Select lifecycle stage...</option>
                {CONTACT_LIFECYCLE_STAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
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
          <ContactsTableSkeleton visibleColumns={visibleColumns} />
        ) : error ? (
          <div className="p-10 text-center text-gray-400">
            <AlertCircle className="mx-auto mb-2 text-red-400" size={28} />
            <p className="mb-1 text-gray-200">Couldn't load contacts</p>
            <p className="mb-3 text-sm">{error}</p>
            <button onClick={() => dispatch(fetchContacts(params))} className="text-blue-400 hover:underline text-sm">Retry</button>
          </div>
        ) : contacts.length === 0 && !isFiltered ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-4">No contacts yet — add your first contact or import a list to start building your directory.</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setShowCreate(true)} className="text-blue-400 hover:underline text-sm">Add Contact</button>
              <button onClick={() => navigate("/crm/import?type=contacts")} className="text-blue-400 hover:underline text-sm">Import Contacts</button>
            </div>
          </div>
        ) : contacts.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-1">No contacts match the current filters.</p>
            <p className="text-xs text-gray-500 mb-3">{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active</p>
            <button onClick={clearFilters} className="text-blue-400 hover:underline text-sm">Clear Filters</button>
          </div>
        ) : (
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={selected.size === contacts.length && contacts.length > 0} onChange={toggleSelectAll} aria-label="Select all contacts" />
                </th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("name")}>
                  <span className="flex items-center gap-1">Name {params.sort === "name" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                {visibleColumns.includes("companyName") && <th scope="col" className="px-4 py-3 font-medium">Company</th>}
                {visibleColumns.includes("jobTitle") && <th scope="col" className="px-4 py-3 font-medium">Job Title</th>}
                {visibleColumns.includes("email") && <th scope="col" className="px-4 py-3 font-medium">Email</th>}
                {visibleColumns.includes("phone") && <th scope="col" className="px-4 py-3 font-medium">Phone</th>}
                {visibleColumns.includes("relationshipType") && (
                  <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("relationshipType")}>
                    <span className="flex items-center gap-1">Relationship {params.sort === "relationshipType" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                  </th>
                )}
                {visibleColumns.includes("lifecycleStage") && <th scope="col" className="px-4 py-3 font-medium">Lifecycle</th>}
                {visibleColumns.includes("ownerName") && <th scope="col" className="px-4 py-3 font-medium">Owner</th>}
                {visibleColumns.includes("lastActivity") && <th scope="col" className="px-4 py-3 font-medium">Last Activity</th>}
                {visibleColumns.includes("nextActivity") && <th scope="col" className="px-4 py-3 font-medium">Next Activity</th>}
                {visibleColumns.includes("communicationStatus") && <th scope="col" className="px-4 py-3 font-medium">Comm. Status</th>}
                {visibleColumns.includes("country") && <th scope="col" className="px-4 py-3 font-medium">Country</th>}
                {visibleColumns.includes("preferredLanguage") && <th scope="col" className="px-4 py-3 font-medium">Language</th>}
                {visibleColumns.includes("source") && <th scope="col" className="px-4 py-3 font-medium">Source</th>}
                {visibleColumns.includes("tags") && <th scope="col" className="px-4 py-3 font-medium">Tags</th>}
                {visibleColumns.includes("createdAt") && <th scope="col" className="px-4 py-3 font-medium">Created</th>}
                {visibleColumns.includes("updatedAt") && <th scope="col" className="px-4 py-3 font-medium">Updated</th>}
                <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const commStatus = contactCommunicationStatus(contact);
                const last = lastActivityAt(contact);
                const next = nextActivityAt(contact);
                const overdue = next && new Date(next) < new Date();
                return (
                  <tr key={contact._id} className="border-t border-gray-800 hover:bg-gray-800/40">
                    <td className={`px-4 ${rowPad}`} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(contact._id)} onChange={() => toggleSelectOne(contact._id)} aria-label={`Select ${contact.name}`} />
                    </td>
                    <td className={`px-4 ${rowPad} cursor-pointer`} tabIndex={0} role="link"
                      onClick={() => navigate(`/crm/contacts/${contact._id}`)}
                      onKeyDown={(e) => { if (e.key === "Enter") navigate(`/crm/contacts/${contact._id}`); }}>
                      <div className="font-medium">{contact.name}</div>
                      {contact.archived && <span className="text-xs text-gray-500">Archived</span>}
                      {contact.doNotContact && !contact.archived && <span className="text-xs text-red-400">Do Not Contact</span>}
                    </td>
                    {visibleColumns.includes("companyName") && <td className={`px-4 ${rowPad} text-gray-300`}>{contact.companyId ? contact.companyName : <span className="text-gray-500">—</span>}</td>}
                    {visibleColumns.includes("jobTitle") && <td className={`px-4 ${rowPad} text-gray-300`}>{contact.jobTitle}</td>}
                    {visibleColumns.includes("email") && <td className={`px-4 ${rowPad} text-gray-300`}>{contact.email}</td>}
                    {visibleColumns.includes("phone") && <td className={`px-4 ${rowPad} text-gray-300`}>{contact.phone}</td>}
                    {visibleColumns.includes("relationshipType") && (
                      <td className={`px-4 ${rowPad}`}>
                        <span className={`px-2 py-1 rounded-full text-xs border ${RELATIONSHIP_COLORS[contact.relationshipType] || RELATIONSHIP_COLORS.Prospect}`}>{contact.relationshipType}</span>
                      </td>
                    )}
                    {visibleColumns.includes("lifecycleStage") && <td className={`px-4 ${rowPad} text-gray-300`}>{contact.lifecycleStage}</td>}
                    {visibleColumns.includes("ownerName") && <td className={`px-4 ${rowPad} text-gray-300`}>{contact.ownerName || "Unassigned"}</td>}
                    {visibleColumns.includes("lastActivity") && <td className={`px-4 ${rowPad} text-gray-300`}>{last ? new Date(last).toLocaleDateString() : "—"}</td>}
                    {visibleColumns.includes("nextActivity") && (
                      <td className={`px-4 ${rowPad} ${overdue ? "text-red-400 font-medium" : "text-gray-300"}`}>
                        {next ? new Date(next).toLocaleDateString() : "—"} {overdue && "(Overdue)"}
                      </td>
                    )}
                    {visibleColumns.includes("communicationStatus") && (
                      <td className={`px-4 ${rowPad}`}>
                        <span className={`px-2 py-1 rounded-full text-xs border ${COMM_STATUS_COLORS[commStatus]}`}>{commStatus}</span>
                      </td>
                    )}
                    {visibleColumns.includes("country") && <td className={`px-4 ${rowPad} text-gray-300`}>{contact.country}</td>}
                    {visibleColumns.includes("preferredLanguage") && <td className={`px-4 ${rowPad} text-gray-300`}>{contact.preferredLanguage}</td>}
                    {visibleColumns.includes("source") && <td className={`px-4 ${rowPad} text-gray-300`}>{contact.source}</td>}
                    {visibleColumns.includes("tags") && <td className={`px-4 ${rowPad} text-gray-300`}>{(contact.tags || []).join(", ") || "—"}</td>}
                    {visibleColumns.includes("createdAt") && <td className={`px-4 ${rowPad} text-gray-300`}>{new Date(contact.createdAt).toLocaleDateString()}</td>}
                    {visibleColumns.includes("updatedAt") && <td className={`px-4 ${rowPad} text-gray-300`}>{new Date(contact.updatedAt).toLocaleDateString()}</td>}
                    <td className={`px-4 ${rowPad} text-right`} onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        contact={contact}
                        open={openRowMenu === contact._id}
                        onToggle={() => setOpenRowMenu((v) => (v === contact._id ? null : contact._id))}
                        onClose={() => setOpenRowMenu(null)}
                        onView={() => navigate(`/crm/contacts/${contact._id}`)}
                        onEdit={() => setRowAction({ type: "edit", contact })}
                        onNote={() => setRowAction({ type: "note", contact })}
                        onTask={() => setRowAction({ type: "task", contact })}
                        onActivity={() => setRowAction({ type: "activity", contact })}
                        onOwner={() => setRowAction({ type: "owner", contact })}
                        onArchive={() => setRowAction({ type: "archive", contact })}
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
            <button disabled={page <= 1} onClick={() => updateParam("page", String(page - 1), false)} className="p-2 rounded-lg border border-gray-800 disabled:opacity-30" aria-label="Previous page">
              <ChevronLeft size={16} />
            </button>
            <button disabled={page >= totalPages} onClick={() => updateParam("page", String(page + 1), false)} className="p-2 rounded-lg border border-gray-800 disabled:opacity-30" aria-label="Next page">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {showCreate && <ContactFormModal onClose={() => setShowCreate(false)} onSaved={() => dispatch(fetchContacts(params))} />}
      {rowAction?.type === "edit" && <ContactFormModal contact={rowAction.contact} onClose={() => setRowAction(null)} onSaved={() => dispatch(fetchContacts(params))} />}
      {rowAction && rowAction.type !== "edit" && (
        <RowQuickActionModal action={rowAction} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchContacts(params)); }} />
      )}
    </div>
  );
}

function ContactsTableSkeleton({ visibleColumns }) {
  const colCount = 3 + visibleColumns.length;
  return (
    <div className="p-4">
      <div className="flex gap-4 px-4 py-3 border-b border-gray-800">
        {Array.from({ length: colCount }).map((_, i) => (
          <div key={i} className="h-3 bg-gray-800/60 rounded flex-1 animate-pulse" />
        ))}
      </div>
      {Array.from({ length: 6 }).map((_, row) => (
        <div key={row} className="flex gap-4 px-4 py-3 border-b border-gray-800/60">
          {Array.from({ length: colCount }).map((_, i) => (
            <div key={i} className="h-4 bg-gray-800/40 rounded flex-1 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

function RowActionsMenu({ contact, open, onToggle, onClose, onView, onEdit, onNote, onTask, onActivity, onOwner, onArchive }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, onClose]);

  const items = [
    { label: "View", action: onView },
    { label: "Edit", action: onEdit },
    { label: "Add Note", action: onNote },
    { label: "Create Task", action: onTask },
    { label: "Log Activity", action: onActivity },
    { label: "Change Owner", action: onOwner },
    { label: contact.archived ? null : "Archive", action: onArchive },
  ].filter((i) => i.label);

  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={onToggle} aria-label={`Actions for ${contact.name}`} aria-haspopup="menu" aria-expanded={open} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-40 shadow-xl text-left">
          {items.map((item) => (
            <button key={item.label} role="menuitem" onClick={() => { item.action(); onClose(); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RowQuickActionModal({ action, onClose, onDone }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const dispatch = useDispatch();
  const { type, contact } = action;
  const [text, setText] = useState("");
  const [activityType, setActivityType] = useState("call");
  const [dueDate, setDueDate] = useState("");
  const [ownerId, setOwnerId] = useState(contact.ownerId || "");
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);

  const titles = { note: "Add Note", task: "Create Task", activity: "Log Activity", owner: "Change Owner", archive: "Archive Contact" };

  const submit = async (e) => {
    e.preventDefault();
    if (type === "note") {
      if (!text.trim()) return;
      await dispatch(addContactNote({ id: contact._id, message: text }));
    } else if (type === "task") {
      if (!text.trim() || !dueDate) return;
      await dispatch(createContactTask({ id: contact._id, task: { title: text, dueDate, priority: "Medium" } }));
    } else if (type === "activity") {
      if (!text.trim()) return;
      await dispatch(logContactActivity({ id: contact._id, type: activityType, description: text }));
    } else if (type === "owner") {
      if (!ownerId) return;
      await dispatch(assignContact({ id: contact._id, ownerId }));
    } else if (type === "archive") {
      if (!reason.trim()) return;
      await dispatch(archiveContact({ id: contact._id, reason }));
    }
    onDone();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label={titles[type]} onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">{titles[type]} — {contact.name}</h2>
        {type === "note" && (
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Note" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        )}
        {type === "task" && (
          <>
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Task title" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </>
        )}
        {type === "activity" && (
          <>
            <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              {["call", "email", "meeting"].map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
            <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="What happened?" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
          </>
        )}
        {type === "owner" && (
          <select autoFocus value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Select owner...</option>
            {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
        )}
        {type === "archive" && (
          <>
            <p className="text-sm text-gray-400">Archiving <strong className="text-white">{contact.name}</strong> moves them out of the active directory for this session.</p>
            <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Save</button>
        </div>
      </form>
    </div>
  );
}

