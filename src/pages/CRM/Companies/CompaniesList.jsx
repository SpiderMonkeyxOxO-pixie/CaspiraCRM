import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Plus, Search, RefreshCw, Download, Upload, ChevronUp, ChevronDown, Columns3,
  X, AlertCircle, ChevronLeft, ChevronRight, Bookmark, MoreHorizontal,
} from "lucide-react";
import {
  fetchCompanies,
  bulkAssignCompanies, bulkTagCompanies, bulkLifecycleUpdateCompanies, bulkArchiveCompanies,
  addCompanyNote, logCompanyActivity, createCompanyTask, assignCompanyOwner, changeCompanyHealth,
  archiveCompany, linkContact,
  COMPANY_ACCOUNT_TYPES, COMPANY_LIFECYCLE_STAGES, COMPANY_ACCOUNT_TIERS, COMPANY_ACCOUNT_HEALTH, COMPANY_TEAMS,
} from "../../../redux/crm/companiesSlice";
import { createContact } from "../../../redux/crm/contactsSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { fetchTickets } from "../../../redux/support/ticketsSlice";
import { fetchProjects } from "../../../redux/projects/projectsSlice";
import { fetchInvoices } from "../../../redux/finance/invoicesSlice";
import { queryCompaniesLocal } from "../../../Helpers/mockCrmData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import useFocusTrap from "../../../hooks/useFocusTrap";
import useDebounced from "../../../hooks/useDebounced";
import CompanyFormModal from "./CompanyFormModal";
import HealthBadge from "./HealthBadge";

const ACCOUNT_TYPE_COLORS = {
  Customer: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Prospect: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Former Customer": "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Partner: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Vendor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

const ALL_COLUMNS = [
  { key: "industry", label: "Industry", optional: false },
  { key: "accountType", label: "Account Type", optional: false },
  { key: "lifecycleStage", label: "Lifecycle Stage", optional: false },
  { key: "accountTier", label: "Account Tier", optional: false },
  { key: "accountHealth", label: "Account Health", optional: false },
  { key: "primaryContact", label: "Primary Contact", optional: false },
  { key: "ownerName", label: "Account Owner", optional: false },
  { key: "openDeals", label: "Open Deals", optional: false },
  { key: "activeProjects", label: "Active Projects", optional: false },
  { key: "openTickets", label: "Open Tickets", optional: false },
  { key: "outstandingBalance", label: "Outstanding Balance", optional: false },
  { key: "lastActivity", label: "Last Activity", optional: false },
  { key: "nextActivity", label: "Next Activity", optional: false },
  { key: "country", label: "Country", optional: true },
  { key: "companySize", label: "Company Size", optional: true },
  { key: "source", label: "Source", optional: true },
  { key: "estimatedAnnualValue", label: "Est. Annual Value", optional: true },
  { key: "tags", label: "Tags", optional: true },
  { key: "createdAt", label: "Created", optional: true },
  { key: "updatedAt", label: "Updated", optional: true },
];
const DEFAULT_VISIBLE = ALL_COLUMNS.filter((c) => !c.optional).map((c) => c.key);
const COLUMN_PREF_KEY = "crm.companies.visibleColumns";
const SAVED_VIEWS_KEY = "crm.companies.savedViews";

const FILTER_LABELS = {
  industry: "Industry", accountType: "Account Type", lifecycleStage: "Lifecycle", customerStatus: "Status",
  accountTier: "Tier", accountHealth: "Health", ownerId: "Owner", team: "Team", country: "Country", source: "Source",
  followUpOverdue: "Overdue Follow-up", hasOpenDeals: "Has Open Deals", hasOpenTickets: "Has Open Tickets",
  hasActiveProjects: "Has Active Projects", hasOutstandingBalance: "Has Balance Due", assigned: "Assigned",
  archived: "Archived", search: "Search",
};

function lastActivityAt(company) {
  const events = company.activity || [];
  if (!events.length) return null;
  return events.reduce((latest, e) => (new Date(e.at) > new Date(latest) ? e.at : latest), events[0].at);
}
function nextActivityAt(company) {
  const upcoming = (company.tasks || []).filter((t) => !t.completed && t.dueDate);
  if (!upcoming.length) return company.nextFollowUp || null;
  const soonest = upcoming.reduce((min, t) => (new Date(t.dueDate) < new Date(min) ? t.dueDate : min), upcoming[0].dueDate);
  return company.nextFollowUp && new Date(company.nextFollowUp) < new Date(soonest) ? company.nextFollowUp : soonest;
}

export default function CompaniesList() {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items: companies, loading, error } = useSelector((s) => s.companies);
  const contacts = useSelector((s) => s.contacts.items);
  const deals = useSelector((s) => s.deals.items);
  const tickets = useSelector((s) => s.tickets.items);
  const projects = useSelector((s) => s.projects.items);
  const invoices = useSelector((s) => s.invoices.items);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const debouncedSearch = useDebounced(searchInput, 350);

  const [showCreate, setShowCreate] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [openRowMenu, setOpenRowMenu] = useState(null);
  const [rowAction, setRowAction] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [exporting, setExporting] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLUMN_PREF_KEY)) || DEFAULT_VISIBLE; } catch { return DEFAULT_VISIBLE; }
  });
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)) || []; } catch { return []; }
  });

  useEffect(() => {
    dispatch(fetchCompanies());
    dispatch(fetchDeals());
    dispatch(fetchTickets());
    dispatch(fetchProjects());
    dispatch(fetchInvoices());
  }, [dispatch]);

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

  const contactById = useMemo(() => new Map(contacts.map((c) => [c._id, c])), [contacts]);
  const dealsByCompany = useMemo(() => {
    const map = new Map();
    for (const d of deals) {
      if (d.stage === "Won") continue;
      map.set(d.companyId, (map.get(d.companyId) || 0) + 1);
    }
    return map;
  }, [deals]);
  const ticketsByCompany = useMemo(() => {
    const map = new Map();
    const OPEN = ["New", "Open", "In Progress", "Waiting for Customer"];
    for (const t of tickets) {
      if (!OPEN.includes(t.status)) continue;
      map.set(t.companyId, (map.get(t.companyId) || 0) + 1);
    }
    return map;
  }, [tickets]);
  const projectsByCompany = useMemo(() => {
    const map = new Map();
    for (const p of projects) {
      if (p.status !== "Active") continue;
      map.set(p.companyId, (map.get(p.companyId) || 0) + 1);
    }
    return map;
  }, [projects]);
  const balanceByCompany = useMemo(() => {
    const map = new Map();
    for (const inv of invoices) {
      if (!inv.amountDue) continue;
      map.set(inv.companyId, (map.get(inv.companyId) || 0) + inv.amountDue);
    }
    return map;
  }, [invoices]);

  const queryResult = useMemo(() => queryCompaniesLocal(companies, {
    ...params,
    openDealCompanyIds: [...dealsByCompany.keys()],
    openTicketCompanyIds: [...ticketsByCompany.keys()],
    activeProjectCompanyIds: [...projectsByCompany.keys()],
    outstandingBalanceCompanyIds: [...balanceByCompany.keys()],
  }), [companies, params, dealsByCompany, ticketsByCompany, projectsByCompany, balanceByCompany]);

  const { companies: pageItems, total, page, pageSize, summary } = queryResult;
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
  const toggleSelectOne = (id) => {
    setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
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
  const applyView = (view) => { setSearchParams(view.params); setSearchInput(view.params.search || ""); setShowViews(false); };
  const deleteView = (name) => {
    const next = savedViews.filter((v) => v.name !== name);
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
  };

  const runExport = () => {
    setExporting(true);
    const rows = queryCompaniesLocal(companies, { ...params, page: 1, pageSize: 100000 }).companies.map((c) => ({
      Name: c.name, Industry: c.industry, "Account Type": c.accountType, Lifecycle: c.lifecycleStage,
      Tier: c.accountTier, Health: c.accountHealth, Owner: c.ownerName, Country: c.country,
      "Est. Annual Value": c.estimatedAnnualValue, Created: c.createdAt,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Companies");
    XLSX.writeFile(wb, `companies_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExporting(false);
  };
  const runExportSelected = () => {
    const rows = pageItems.filter((c) => selected.has(c._id)).map((c) => ({ Name: c.name, Industry: c.industry, "Account Type": c.accountType }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Selected Companies");
    XLSX.writeFile(wb, `companies_selected_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const submitBulk = async () => {
    const ids = Array.from(selected);
    if (bulkAction === "assign" && bulkValue) await dispatch(bulkAssignCompanies({ companyIds: ids, ownerId: bulkValue }));
    else if (bulkAction === "tag" && bulkValue.trim()) await dispatch(bulkTagCompanies({ companyIds: ids, tag: bulkValue.trim() }));
    else if (bulkAction === "lifecycle" && bulkValue) await dispatch(bulkLifecycleUpdateCompanies({ companyIds: ids, lifecycleStage: bulkValue }));
    else if (bulkAction === "archive") {
      if (!bulkReason.trim()) return;
      await dispatch(bulkArchiveCompanies({ companyIds: ids, reason: bulkReason }));
    }
    setSelected(new Set());
    setBulkAction(null);
    setBulkValue("");
    setBulkReason("");
  };

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/crm/dashboard" className="hover:text-gray-300">CRM</Link> / <span className="text-gray-300">Companies</span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Companies</h1>
          <p className="text-sm text-gray-400 mt-1">
            External organizations — prospects, customers, partners and vendors. {total} compan{total === 1 ? "y" : "ies"} visible.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => dispatch(fetchCompanies())} title="Refresh" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <RefreshCw size={16} /> Refresh
          </button>
          <button onClick={() => navigate("/crm/import?type=companies")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <Upload size={16} /> Import
          </button>
          <button onClick={runExport} disabled={exporting} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm disabled:opacity-50">
            <Download size={16} /> {exporting ? "Exporting..." : "Export"}
          </button>
          <button data-tour="companies-add" onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium text-white">
            <Plus size={16} /> Add Company
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6" data-tour="companies-summary">
        <button onClick={clearFilters} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Total</p>
          <p className="text-xl font-bold">{summary.total}</p>
        </button>
        <button onClick={() => applyCardFilter("accountType", "Prospect")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Prospects</p>
          <p className="text-xl font-bold">{summary.prospects}</p>
        </button>
        <button onClick={() => { updateParam("accountType", "Customer"); updateParam("customerStatus", "Active", false); }} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Active Customers</p>
          <p className="text-xl font-bold">{summary.activeCustomers}</p>
        </button>
        <button onClick={() => applyCardFilter("accountHealth", "At Risk")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">At-Risk</p>
          <p className={`text-xl font-bold ${summary.atRisk > 0 ? "text-red-400" : ""}`}>{summary.atRisk}</p>
        </button>
        <button onClick={() => applyCardFilter("followUpOverdue", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Follow-ups Due</p>
          <p className="text-xl font-bold">{summary.followUpsDue}</p>
        </button>
        <button onClick={() => applyCardFilter("assigned", "false")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Unassigned</p>
          <p className="text-xl font-bold">{summary.unassigned}</p>
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center" data-tour="companies-filters">
        <div className="relative flex-1 min-w-55 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search name, domain, email, phone..."
            aria-label="Search companies" className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        </div>
        <select value={params.accountType || ""} onChange={(e) => updateParam("accountType", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by account type">
          <option value="">All Account Types</option>
          {COMPANY_ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={params.lifecycleStage || ""} onChange={(e) => updateParam("lifecycleStage", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by lifecycle stage">
          <option value="">All Lifecycle Stages</option>
          {COMPANY_LIFECYCLE_STAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={params.accountTier || ""} onChange={(e) => updateParam("accountTier", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by account tier">
          <option value="">All Tiers</option>
          {COMPANY_ACCOUNT_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={params.accountHealth || ""} onChange={(e) => updateParam("accountHealth", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by account health">
          <option value="">All Health States</option>
          {COMPANY_ACCOUNT_HEALTH.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <select value={params.ownerId || ""} onChange={(e) => updateParam("ownerId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by owner">
          <option value="">All Owners</option>
          {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={params.team || ""} onChange={(e) => updateParam("team", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by team">
          <option value="">All Teams</option>
          {COMPANY_TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
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
          <button data-tour="companies-views" onClick={() => setShowViews((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
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
              {FILTER_LABELS[key] || key}: {value === "true" ? "Yes" : value === "false" ? "No" : value}
              <button onClick={() => removeFilter(key)} aria-label={`Clear ${FILTER_LABELS[key] || key} filter`} className="hover:text-white"><X size={12} /></button>
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
            <h2 className="text-lg font-bold">{{ assign: "Bulk Assign", tag: "Bulk Add Tag", lifecycle: "Bulk Change Lifecycle", archive: "Bulk Archive" }[bulkAction]}</h2>
            {bulkAction === "assign" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Select owner...</option>
                {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            {bulkAction === "tag" && <input value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} placeholder="Tag name" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />}
            {bulkAction === "lifecycle" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Select lifecycle stage...</option>
                {COMPANY_LIFECYCLE_STAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            )}
            {bulkAction === "archive" && <input value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />}
            <div className="flex justify-end gap-2">
              <button onClick={() => setBulkAction(null)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button onClick={submitBulk} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Apply</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto" data-tour="companies-table">
        {loading ? (
          <CompaniesTableSkeleton visibleColumns={visibleColumns} />
        ) : error ? (
          <div className="p-10 text-center text-gray-400">
            <AlertCircle className="mx-auto mb-2 text-red-400" size={28} />
            <p className="mb-1 text-gray-200">Couldn't load companies</p>
            <p className="mb-3 text-sm">{error}</p>
            <button onClick={() => dispatch(fetchCompanies())} className="text-blue-400 hover:underline text-sm">Retry</button>
          </div>
        ) : pageItems.length === 0 && !isFiltered ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-1">No companies yet.</p>
            <p className="text-sm text-gray-500 mb-4">Companies represent external organizations — prospects, customers, partners and vendors — that connect your contacts, deals, tickets and finances into one workspace.</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setShowCreate(true)} className="text-blue-400 hover:underline text-sm">Add Company</button>
              <button onClick={() => navigate("/crm/import?type=companies")} className="text-blue-400 hover:underline text-sm">Import Companies</button>
            </div>
          </div>
        ) : pageItems.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-1">No companies match the current filters.</p>
            <p className="text-xs text-gray-500 mb-3">{activeFilterEntries.length} filter{activeFilterEntries.length === 1 ? "" : "s"} active</p>
            <div className="flex justify-center gap-3">
              <button onClick={clearFilters} className="text-blue-400 hover:underline text-sm">Clear Filters</button>
              <button onClick={() => setShowColumns(false)} className="text-blue-400 hover:underline text-sm">Adjust Filters</button>
            </div>
          </div>
        ) : (
          <table className="w-full text-sm min-w-300">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 w-8"><input type="checkbox" checked={selected.size === pageItems.length && pageItems.length > 0} onChange={toggleSelectAll} aria-label="Select all companies" /></th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("name")}>
                  <span className="flex items-center gap-1">Company {params.sort === "name" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                {visibleColumns.includes("industry") && <th scope="col" className="px-4 py-3 font-medium">Industry</th>}
                {visibleColumns.includes("accountType") && <th scope="col" className="px-4 py-3 font-medium">Account Type</th>}
                {visibleColumns.includes("lifecycleStage") && <th scope="col" className="px-4 py-3 font-medium">Lifecycle</th>}
                {visibleColumns.includes("accountTier") && <th scope="col" className="px-4 py-3 font-medium">Tier</th>}
                {visibleColumns.includes("accountHealth") && <th scope="col" className="px-4 py-3 font-medium">Health</th>}
                {visibleColumns.includes("primaryContact") && <th scope="col" className="px-4 py-3 font-medium">Primary Contact</th>}
                {visibleColumns.includes("ownerName") && <th scope="col" className="px-4 py-3 font-medium">Owner</th>}
                {visibleColumns.includes("openDeals") && <th scope="col" className="px-4 py-3 font-medium text-right" title="Deals not yet won or lost">Open Deals</th>}
                {visibleColumns.includes("activeProjects") && <th scope="col" className="px-4 py-3 font-medium text-right">Active Projects</th>}
                {visibleColumns.includes("openTickets") && <th scope="col" className="px-4 py-3 font-medium text-right">Open Tickets</th>}
                {visibleColumns.includes("outstandingBalance") && <th scope="col" className="px-4 py-3 font-medium text-right" title="Sum of unpaid invoice amounts">Outstanding Balance</th>}
                {visibleColumns.includes("lastActivity") && <th scope="col" className="px-4 py-3 font-medium">Last Activity</th>}
                {visibleColumns.includes("nextActivity") && <th scope="col" className="px-4 py-3 font-medium">Next Activity</th>}
                {visibleColumns.includes("country") && <th scope="col" className="px-4 py-3 font-medium">Country</th>}
                {visibleColumns.includes("companySize") && <th scope="col" className="px-4 py-3 font-medium">Size</th>}
                {visibleColumns.includes("source") && <th scope="col" className="px-4 py-3 font-medium">Source</th>}
                {visibleColumns.includes("estimatedAnnualValue") && <th scope="col" className="px-4 py-3 font-medium text-right">Est. Annual Value</th>}
                {visibleColumns.includes("tags") && <th scope="col" className="px-4 py-3 font-medium">Tags</th>}
                {visibleColumns.includes("createdAt") && <th scope="col" className="px-4 py-3 font-medium">Created</th>}
                {visibleColumns.includes("updatedAt") && <th scope="col" className="px-4 py-3 font-medium">Updated</th>}
                <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((company) => {
                const last = lastActivityAt(company);
                const next = nextActivityAt(company);
                const overdue = next && new Date(next) < new Date();
                const primaryContact = company.primaryContactId ? contactById.get(company.primaryContactId) : null;
                return (
                  <tr key={company._id} className="border-t border-gray-800 hover:bg-gray-800/40">
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(company._id)} onChange={() => toggleSelectOne(company._id)} aria-label={`Select ${company.name}`} />
                    </td>
                    <td className="px-4 py-3 cursor-pointer" tabIndex={0} role="link" onClick={() => navigate(`/crm/companies/${company._id}`)} onKeyDown={(e) => { if (e.key === "Enter") navigate(`/crm/companies/${company._id}`); }}>
                      <div className="w-6 h-6 rounded bg-gray-800 border border-gray-700 inline-flex items-center justify-center text-[10px] font-semibold text-gray-300 mr-2 align-middle">
                        {company.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="font-medium">{company.name}</span>
                      {company.archived && <span className="ml-2 text-xs text-gray-500">Archived</span>}
                    </td>
                    {visibleColumns.includes("industry") && <td className="px-4 py-3 text-gray-300">{company.industry}</td>}
                    {visibleColumns.includes("accountType") && (
                      <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs border ${ACCOUNT_TYPE_COLORS[company.accountType] || ACCOUNT_TYPE_COLORS.Prospect}`}>{company.accountType}</span></td>
                    )}
                    {visibleColumns.includes("lifecycleStage") && <td className="px-4 py-3 text-gray-300">{company.lifecycleStage}</td>}
                    {visibleColumns.includes("accountTier") && <td className="px-4 py-3 text-gray-300">{company.accountTier}</td>}
                    {visibleColumns.includes("accountHealth") && <td className="px-4 py-3"><HealthBadge health={company.accountHealth} reason={company.healthReason} /></td>}
                    {visibleColumns.includes("primaryContact") && <td className="px-4 py-3 text-gray-300">{primaryContact?.name || "—"}</td>}
                    {visibleColumns.includes("ownerName") && <td className="px-4 py-3 text-gray-300">{company.ownerName || "Unassigned"}</td>}
                    {visibleColumns.includes("openDeals") && <td className="px-4 py-3 text-gray-300 text-right">{dealsByCompany.get(company._id) || 0}</td>}
                    {visibleColumns.includes("activeProjects") && <td className="px-4 py-3 text-gray-300 text-right">{projectsByCompany.get(company._id) || 0}</td>}
                    {visibleColumns.includes("openTickets") && <td className="px-4 py-3 text-gray-300 text-right">{ticketsByCompany.get(company._id) || 0}</td>}
                    {visibleColumns.includes("outstandingBalance") && (
                      <td className={`px-4 py-3 text-right ${balanceByCompany.get(company._id) ? "text-amber-300 font-medium" : "text-gray-300"}`}>
                        ${(balanceByCompany.get(company._id) || 0).toLocaleString()}
                      </td>
                    )}
                    {visibleColumns.includes("lastActivity") && <td className="px-4 py-3 text-gray-300">{last ? new Date(last).toLocaleDateString() : "—"}</td>}
                    {visibleColumns.includes("nextActivity") && (
                      <td className={`px-4 py-3 ${overdue ? "text-red-400 font-medium" : "text-gray-300"}`}>{next ? new Date(next).toLocaleDateString() : "—"} {overdue && "(Overdue)"}</td>
                    )}
                    {visibleColumns.includes("country") && <td className="px-4 py-3 text-gray-300">{company.country}</td>}
                    {visibleColumns.includes("companySize") && <td className="px-4 py-3 text-gray-300">{company.companySize}</td>}
                    {visibleColumns.includes("source") && <td className="px-4 py-3 text-gray-300">{company.source}</td>}
                    {visibleColumns.includes("estimatedAnnualValue") && <td className="px-4 py-3 text-gray-300 text-right">${company.estimatedAnnualValue?.toLocaleString()}</td>}
                    {visibleColumns.includes("tags") && <td className="px-4 py-3 text-gray-300">{(company.tags || []).join(", ") || "—"}</td>}
                    {visibleColumns.includes("createdAt") && <td className="px-4 py-3 text-gray-300">{new Date(company.createdAt).toLocaleDateString()}</td>}
                    {visibleColumns.includes("updatedAt") && <td className="px-4 py-3 text-gray-300">{new Date(company.updatedAt).toLocaleDateString()}</td>}
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        company={company}
                        open={openRowMenu === company._id}
                        onToggle={() => setOpenRowMenu((v) => (v === company._id ? null : company._id))}
                        onClose={() => setOpenRowMenu(null)}
                        onView={() => navigate(`/crm/companies/${company._id}`)}
                        onEdit={() => setRowAction({ type: "edit", company })}
                        onAddContact={() => setRowAction({ type: "addContact", company })}
                        onNote={() => setRowAction({ type: "note", company })}
                        onActivity={() => setRowAction({ type: "activity", company })}
                        onTask={() => setRowAction({ type: "task", company })}
                        onOwner={() => setRowAction({ type: "owner", company })}
                        onHealth={() => setRowAction({ type: "health", company })}
                        onArchive={() => setRowAction({ type: "archive", company })}
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

      {showCreate && <CompanyFormModal onClose={() => setShowCreate(false)} onSaved={() => dispatch(fetchCompanies())} />}
      {rowAction?.type === "edit" && <CompanyFormModal company={rowAction.company} onClose={() => setRowAction(null)} onSaved={() => dispatch(fetchCompanies())} />}
      {rowAction && rowAction.type !== "edit" && (
        <RowQuickActionModal action={rowAction} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchCompanies()); }} />
      )}
    </div>
  );
}

function CompaniesTableSkeleton({ visibleColumns }) {
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

function RowActionsMenu({ company, open, onToggle, onClose, onView, onEdit, onAddContact, onNote, onActivity, onTask, onOwner, onHealth, onArchive }) {
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
    { label: "Add Contact", action: onAddContact },
    { label: "Add Note", action: onNote },
    { label: "Log Activity", action: onActivity },
    { label: "Create Task", action: onTask },
    { label: "Change Owner", action: onOwner },
    { label: "Change Account Health", action: onHealth },
    { label: company.archived ? null : "Archive", action: onArchive },
  ].filter((i) => i.label);

  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={onToggle} aria-label={`Actions for ${company.name}`} aria-haspopup="menu" aria-expanded={open} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-48 shadow-xl text-left">
          {items.map((item) => (
            <button key={item.label} role="menuitem" onClick={() => { item.action(); onClose(); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function RowQuickActionModal({ action, onClose, onDone }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const dispatch = useDispatch();
  const { type, company } = action;
  const [text, setText] = useState("");
  const [activityType, setActivityType] = useState("call");
  const [dueDate, setDueDate] = useState("");
  const [ownerId, setOwnerId] = useState(company.ownerId || "");
  const [health, setHealth] = useState(company.accountHealth);
  const [healthReason, setHealthReason] = useState("");
  const [reason, setReason] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const containerRef = useFocusTrap(true, onClose);

  const titles = { note: "Add Note", task: "Create Task", activity: "Log Activity", owner: "Change Owner", health: "Change Account Health", archive: "Archive Company", addContact: "Add Contact" };

  const submit = async (e) => {
    e.preventDefault();
    if (type === "note") {
      if (!text.trim()) return;
      await dispatch(addCompanyNote({ id: company._id, message: text }));
    } else if (type === "task") {
      if (!text.trim() || !dueDate) return;
      await dispatch(createCompanyTask({ id: company._id, task: { title: text, dueDate, priority: "Medium" } }));
    } else if (type === "activity") {
      if (!text.trim()) return;
      await dispatch(logCompanyActivity({ id: company._id, type: activityType, description: text }));
    } else if (type === "owner") {
      if (!ownerId) return;
      await dispatch(assignCompanyOwner({ id: company._id, ownerId }));
    } else if (type === "health") {
      await dispatch(changeCompanyHealth({ id: company._id, accountHealth: health, healthReason }));
    } else if (type === "archive") {
      if (!reason.trim()) return;
      await dispatch(archiveCompany({ id: company._id, reason }));
    } else if (type === "addContact") {
      if (!contactName.trim()) return;
      const [firstName, ...rest] = contactName.trim().split(" ");
      const result = await dispatch(createContact({ firstName, lastName: rest.join(" "), email: contactEmail.trim(), relationshipType: "Prospect", lifecycleStage: "New", source: "Website" }));
      if (createContact.fulfilled.match(result)) {
        await dispatch(linkContact({ id: company._id, contactId: result.payload._id }));
      }
    }
    onDone();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label={titles[type]} onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">{titles[type]} — {company.name}</h2>
        {type === "note" && <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Note" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />}
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
        {type === "health" && (
          <>
            <select autoFocus value={health} onChange={(e) => setHealth(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              {COMPANY_ACCOUNT_HEALTH.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            <input value={healthReason} onChange={(e) => setHealthReason(e.target.value)} placeholder="Reason (optional)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </>
        )}
        {type === "archive" && (
          <>
            <p className="text-sm text-gray-400">Archiving <strong className="text-white">{company.name}</strong> moves it out of the active directory. Associated contacts and records remain available.</p>
            <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
          </>
        )}
        {type === "addContact" && (
          <>
            <input autoFocus value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Full name" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Email" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
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

