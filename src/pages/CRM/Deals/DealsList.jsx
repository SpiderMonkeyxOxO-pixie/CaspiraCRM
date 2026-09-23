import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Plus, Search, RefreshCw, Download, Upload, ChevronUp, ChevronDown, Columns3,
  X, AlertCircle, ChevronLeft, ChevronRight, Bookmark, MoreHorizontal, KanbanSquare, SlidersHorizontal,
} from "lucide-react";
import {
  fetchDeals, updateDeal, bulkAssignDeals, bulkStageChangeDeals, bulkTagDeals, bulkArchiveDeals,
  DEAL_PIPELINES, DEAL_STAGES, DEAL_STATUSES, DEAL_TYPES, DEAL_SOURCES, DEAL_PRIORITIES, DEAL_HEALTH_STATES,
} from "../../../redux/crm/dealsSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchActivities } from "../../../redux/crm/activitiesSlice";
import { queryDealsLocal } from "../../../Helpers/mockCrmData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import useFocusTrap from "../../../hooks/useFocusTrap";
import useDebounced from "../../../hooks/useDebounced";
import DealFormModal from "./DealFormModal";
import StageProgress from "./StageProgress";
import { StageBadge, DealPriorityBadge, DealHealthBadge } from "./DealBadges";
import { MarkWonModal, MarkLostModal, PutOnHoldModal, ReopenDealModal, ArchiveDealModal } from "./DealOutcomeModals";
import { formatMoney, formatByCurrency, formatDate, isStaleDeal } from "./dealUtils";
import ActivityFormModal from "../Activities/ActivityFormModal";

const ALL_COLUMNS = [
  { key: "companyName", label: "Company", optional: false },
  { key: "primaryContact", label: "Primary Contact", optional: false },
  { key: "stage", label: "Stage", optional: false },
  { key: "value", label: "Value", optional: false },
  { key: "probability", label: "Probability", optional: false },
  { key: "weightedValue", label: "Weighted Value", optional: false },
  { key: "ownerName", label: "Owner", optional: false },
  { key: "dealHealth", label: "Deal Health", optional: false },
  { key: "nextAction", label: "Next Action", optional: false },
  { key: "expectedClosingDate", label: "Expected Close", optional: false },
  { key: "lastActivity", label: "Last Activity", optional: false },
  { key: "pipeline", label: "Pipeline", optional: true },
  { key: "source", label: "Source", optional: true },
  { key: "assignedTeam", label: "Team", optional: true },
  { key: "dealType", label: "Deal Type", optional: true },
  { key: "priority", label: "Priority", optional: true },
  { key: "products", label: "Products", optional: true },
  { key: "recurringValue", label: "Recurring Value", optional: true },
  { key: "createdAt", label: "Created", optional: true },
  { key: "updatedAt", label: "Updated", optional: true },
];
const DEFAULT_VISIBLE = ALL_COLUMNS.filter((c) => !c.optional).map((c) => c.key);
const COLUMN_PREF_KEY = "crm.deals.visibleColumns";
const SAVED_VIEWS_KEY = "crm.deals.savedViews";

const FILTER_LABELS = {
  pipeline: "Pipeline", stage: "Stage", status: "Outcome", ownerId: "Owner", team: "Team", source: "Source",
  dealType: "Deal Type", priority: "Priority", dealHealth: "Health", minValue: "Min Value", maxValue: "Max Value",
  minProbability: "Min Probability", maxProbability: "Max Probability", closingThisMonth: "Closing This Month",
  closingAfter: "Closing After", closingBefore: "Closing Before", companyId: "Company", contactId: "Contact",
  hasNextActivity: "Has Next Activity", noNextAction: "No Next Action", staleActivity: "Stale Activity",
  archived: "Archived", search: "Search",
};

export default function DealsList() {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items: deals, loading, error } = useSelector((s) => s.deals);
  const companies = useSelector((s) => s.companies.items);
  const contacts = useSelector((s) => s.contacts.items);
  const activities = useSelector((s) => s.activities.items);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const debouncedSearch = useDebounced(searchInput, 350);

  const [showCreate, setShowCreate] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
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
    dispatch(fetchDeals());
    dispatch(fetchCompanies());
    dispatch(fetchContacts({ pageSize: 1000 }));
    dispatch(fetchActivities());
  }, [dispatch]);

  const companyById = useMemo(() => new Map(companies.map((c) => [c._id, c])), [companies]);
  const contactById = useMemo(() => new Map(contacts.map((c) => [c._id, c])), [contacts]);

  const dealActivities = useMemo(() => {
    const map = new Map();
    for (const a of activities) {
      if (a.relatedRecordType !== "Deal" || !a.relatedRecordId) continue;
      if (!map.has(a.relatedRecordId)) map.set(a.relatedRecordId, []);
      map.get(a.relatedRecordId).push(a);
    }
    return map;
  }, [activities]);

  const lastActivityAt = (dealId) => {
    const list = dealActivities.get(dealId) || [];
    const done = list.filter((a) => a.completedAt);
    if (!done.length) return null;
    return done.reduce((latest, a) => (new Date(a.completedAt) > new Date(latest) ? a.completedAt : latest), done[0].completedAt);
  };
  const nextActivityAt = (dealId) => {
    const list = dealActivities.get(dealId) || [];
    const upcoming = list.filter((a) => !["Completed", "Cancelled"].includes(a.status) && (a.dueDate || a.startAt));
    if (!upcoming.length) return null;
    return upcoming.reduce((min, a) => { const r = a.dueDate || a.startAt; return new Date(r) < new Date(min) ? r : min; }, upcoming[0].dueDate || upcoming[0].startAt);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nextActivityDealIds = useMemo(() => deals.filter((d) => nextActivityAt(d._id)).map((d) => d._id), [deals, dealActivities]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const staleDealIds = useMemo(() => deals.filter((d) => isStaleDeal(d, lastActivityAt(d._id))).map((d) => d._id), [deals, dealActivities]);

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

  const queryResult = useMemo(() => queryDealsLocal(deals, { ...params, nextActivityDealIds, staleDealIds }), [deals, params, nextActivityDealIds, staleDealIds]);
  const { deals: pageItems, total, page, pageSize, summary } = queryResult;
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
    else setSelected(new Set(pageItems.map((d) => d._id)));
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

  const exportRows = (list) => list.map((d) => ({
    Deal: d.name, Company: companyById.get(d.companyId)?.name || "", Stage: d.stage, Status: d.status,
    Value: d.value, Currency: d.currency, Probability: d.probability, "Weighted Value": d.weightedValue,
    Owner: d.ownerName, "Expected Close": d.expectedClosingDate, Created: d.createdAt,
  }));
  const runExport = () => {
    setExporting(true);
    const rows = exportRows(queryDealsLocal(deals, { ...params, page: 1, pageSize: 100000 }).deals);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Deals");
    XLSX.writeFile(wb, `deals_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExporting(false);
  };
  const runExportSelected = () => {
    const rows = exportRows(pageItems.filter((d) => selected.has(d._id)));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Selected Deals");
    XLSX.writeFile(wb, `deals_selected_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const submitBulk = async () => {
    const ids = Array.from(selected);
    if (bulkAction === "assign" && bulkValue) await dispatch(bulkAssignDeals({ dealIds: ids, ownerId: bulkValue }));
    else if (bulkAction === "stage" && bulkValue) await dispatch(bulkStageChangeDeals({ dealIds: ids, stage: bulkValue }));
    else if (bulkAction === "tag" && bulkValue.trim()) await dispatch(bulkTagDeals({ dealIds: ids, tag: bulkValue.trim() }));
    else if (bulkAction === "archive") {
      if (!bulkReason.trim()) return;
      await dispatch(bulkArchiveDeals({ dealIds: ids, reason: bulkReason }));
    }
    setSelected(new Set());
    setBulkAction(null);
    setBulkValue("");
    setBulkReason("");
  };

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/crm/dashboard" className="hover:text-gray-300">CRM</Link> / <span className="text-gray-300">Deals</span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Deals</h1>
          <p className="text-sm text-gray-400 mt-1">
            Sales opportunities connected to your Leads, Contacts, Companies and Activities. {total} deal{total === 1 ? "" : "s"} visible.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link to="/crm/pipeline" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <KanbanSquare size={16} /> Pipeline
          </Link>
          <button onClick={() => dispatch(fetchDeals())} title="Refresh" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <RefreshCw size={16} /> Refresh
          </button>
          <button onClick={() => navigate("/crm/import?type=deals")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <Upload size={16} /> Import
          </button>
          <button onClick={runExport} disabled={exporting} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm disabled:opacity-50">
            <Download size={16} /> {exporting ? "Exporting..." : "Export"}
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium text-white">
            <Plus size={16} /> Add Deal
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <button onClick={() => applyCardFilter("status", "Open")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Open Pipeline</p>
          <p className="text-lg font-bold truncate" title={formatByCurrency(summary.openValueByCurrency)}>{formatByCurrency(summary.openValueByCurrency)}</p>
        </button>
        <button onClick={() => applyCardFilter("status", "Open")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Weighted Pipeline</p>
          <p className="text-lg font-bold truncate" title={formatByCurrency(summary.weightedValueByCurrency)}>{formatByCurrency(summary.weightedValueByCurrency)}</p>
        </button>
        <button onClick={() => applyCardFilter("closingThisMonth", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Closing This Month</p>
          <p className="text-xl font-bold">{summary.closingThisMonthCount}</p>
        </button>
        <button onClick={() => applyCardFilter("dealHealth", "At Risk")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">At-Risk Deals</p>
          <p className={`text-xl font-bold ${summary.atRiskCount > 0 ? "text-red-400" : ""}`}>{summary.atRiskCount}</p>
        </button>
        <button onClick={() => applyCardFilter("status", "Won")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Won This Period</p>
          <p className="text-xl font-bold text-emerald-400">{summary.wonThisPeriodCount}</p>
        </button>
        <button onClick={() => applyCardFilter("status", "Lost")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Lost This Period</p>
          <p className="text-xl font-bold text-red-400">{summary.lostThisPeriodCount}</p>
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative flex-1 min-w-55 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search deal name, description..."
            aria-label="Search deals" className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        </div>
        <select value={params.pipeline || ""} onChange={(e) => updateParam("pipeline", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by pipeline">
          <option value="">All Pipelines</option>
          {DEAL_PIPELINES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={params.stage || ""} onChange={(e) => updateParam("stage", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by stage">
          <option value="">All Stages</option>
          {DEAL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={params.status || ""} onChange={(e) => updateParam("status", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by outcome">
          <option value="">All Outcomes</option>
          {DEAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={params.ownerId || ""} onChange={(e) => updateParam("ownerId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by owner">
          <option value="">All Owners</option>
          <option value="me">Me</option>
          <option value="unassigned">Unassigned</option>
          {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={params.dealHealth || ""} onChange={(e) => updateParam("dealHealth", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by deal health">
          <option value="">All Health States</option>
          {DEAL_HEALTH_STATES.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <select value={params.priority || ""} onChange={(e) => updateParam("priority", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by priority">
          <option value="">All Priorities</option>
          {DEAL_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={params.dealType || ""} onChange={(e) => updateParam("dealType", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by deal type">
          <option value="">All Deal Types</option>
          {DEAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={params.source || ""} onChange={(e) => updateParam("source", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by source">
          <option value="">All Sources</option>
          {DEAL_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
          <input type="checkbox" checked={params.noNextAction === "true"} onChange={(e) => updateParam("noNextAction", e.target.checked ? "true" : "")} />
          No Next Action
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
          <input type="checkbox" checked={params.staleActivity === "true"} onChange={(e) => updateParam("staleActivity", e.target.checked ? "true" : "")} />
          Stale Activity
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
          <input type="checkbox" checked={params.archived === "true"} onChange={(e) => updateParam("archived", e.target.checked ? "true" : "false")} />
          Archived
        </label>

        <div className="relative">
          <button onClick={() => setShowMoreFilters((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <SlidersHorizontal size={16} /> More Filters
          </button>
          {showMoreFilters && (
            <div className="absolute right-0 sm:left-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg p-3 z-20 w-72 shadow-xl space-y-3">
              <div>
                <label htmlFor="deal-filter-company" className="block text-xs mb-1 text-gray-400">Company</label>
                <select id="deal-filter-company" value={params.companyId || ""} onChange={(e) => updateParam("companyId", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">All Companies</option>
                  {companies.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="deal-filter-contact" className="block text-xs mb-1 text-gray-400">Contact</label>
                <select id="deal-filter-contact" value={params.contactId || ""} onChange={(e) => updateParam("contactId", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">All Contacts</option>
                  {(params.companyId ? contacts.filter((c) => c.companyId === params.companyId) : contacts).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="deal-filter-team" className="block text-xs mb-1 text-gray-400">Team</label>
                <select id="deal-filter-team" value={params.team || ""} onChange={(e) => updateParam("team", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">All Teams</option>
                  {["Sales", "Support", "Marketing"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="deal-filter-minvalue" className="block text-xs mb-1 text-gray-400">Min Value</label>
                  <input id="deal-filter-minvalue" type="number" min="0" value={params.minValue || ""} onChange={(e) => updateParam("minValue", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label htmlFor="deal-filter-maxvalue" className="block text-xs mb-1 text-gray-400">Max Value</label>
                  <input id="deal-filter-maxvalue" type="number" min="0" value={params.maxValue || ""} onChange={(e) => updateParam("maxValue", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="deal-filter-minprob" className="block text-xs mb-1 text-gray-400">Min Probability %</label>
                  <input id="deal-filter-minprob" type="number" min="0" max="100" value={params.minProbability || ""} onChange={(e) => updateParam("minProbability", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label htmlFor="deal-filter-maxprob" className="block text-xs mb-1 text-gray-400">Max Probability %</label>
                  <input id="deal-filter-maxprob" type="number" min="0" max="100" value={params.maxProbability || ""} onChange={(e) => updateParam("maxProbability", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="deal-filter-closeafter" className="block text-xs mb-1 text-gray-400">Closing After</label>
                  <input id="deal-filter-closeafter" type="date" value={params.closingAfter || ""} onChange={(e) => updateParam("closingAfter", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label htmlFor="deal-filter-closebefore" className="block text-xs mb-1 text-gray-400">Closing Before</label>
                  <input id="deal-filter-closebefore" type="date" value={params.closingBefore || ""} onChange={(e) => updateParam("closingBefore", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={params.closingThisMonth === "true"} onChange={(e) => updateParam("closingThisMonth", e.target.checked ? "true" : "")} />
                Closing this month
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={params.hasNextActivity === "true"} onChange={(e) => updateParam("hasNextActivity", e.target.checked ? "true" : "")} />
                Has a next activity scheduled
              </label>
            </div>
          )}
        </div>

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
          <button onClick={() => setBulkAction("assign")} className="text-sm text-blue-300 hover:underline">Assign Owner</button>
          <button onClick={() => setBulkAction("stage")} className="text-sm text-blue-300 hover:underline">Change Stage</button>
          <button onClick={() => setBulkAction("tag")} className="text-sm text-blue-300 hover:underline">Add Tag</button>
          <button onClick={() => setBulkAction("archive")} className="text-sm text-blue-300 hover:underline">Archive</button>
          <button onClick={runExportSelected} className="text-sm text-blue-300 hover:underline">Export Selected</button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-gray-400 hover:text-white ml-auto">Clear selection</button>
        </div>
      )}

      {bulkAction && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setBulkAction(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">{{ assign: "Bulk Assign Owner", stage: "Bulk Change Stage", tag: "Bulk Add Tag", archive: "Bulk Archive" }[bulkAction]}</h2>
            {bulkAction === "assign" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Select owner...</option>
                {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            {bulkAction === "stage" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Select stage...</option>
                {DEAL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {bulkAction === "tag" && <input value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} placeholder="Tag name" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />}
            {bulkAction === "archive" && <input value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />}
            <p className="text-[11px] text-gray-500">This will visibly update the table below — a preview change to frontend state only.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setBulkAction(null)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button onClick={submitBulk} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Apply</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        {loading ? (
          <DealsTableSkeleton visibleColumns={visibleColumns} />
        ) : error ? (
          <div className="p-10 text-center text-gray-400">
            <AlertCircle className="mx-auto mb-2 text-red-400" size={28} />
            <p className="mb-1 text-gray-200">Couldn't load deals</p>
            <p className="mb-3 text-sm">{error}</p>
            <button onClick={() => dispatch(fetchDeals())} className="text-blue-400 hover:underline text-sm">Retry</button>
          </div>
        ) : pageItems.length === 0 && !isFiltered ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-1">No deals yet.</p>
            <p className="text-sm text-gray-500 mb-4">Deals track sales opportunities tied to your Companies and Contacts, from first discovery through to Won or Lost.</p>
            <button onClick={() => setShowCreate(true)} className="text-blue-400 hover:underline text-sm">Add Deal</button>
          </div>
        ) : pageItems.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-1">No deals match the current filters.</p>
            <p className="text-xs text-gray-500 mb-3">{activeFilterEntries.length} filter{activeFilterEntries.length === 1 ? "" : "s"} active</p>
            <button onClick={clearFilters} className="text-blue-400 hover:underline text-sm">Clear Filters</button>
          </div>
        ) : (
          <table className="w-full text-sm min-w-300">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 w-8"><input type="checkbox" checked={selected.size === pageItems.length && pageItems.length > 0} onChange={toggleSelectAll} aria-label="Select all deals" /></th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("name")}>
                  <span className="flex items-center gap-1">Deal {params.sort === "name" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                {visibleColumns.includes("companyName") && <th scope="col" className="px-4 py-3 font-medium">Company</th>}
                {visibleColumns.includes("primaryContact") && <th scope="col" className="px-4 py-3 font-medium">Primary Contact</th>}
                {visibleColumns.includes("stage") && <th scope="col" className="px-4 py-3 font-medium">Stage</th>}
                {visibleColumns.includes("value") && <th scope="col" className="px-4 py-3 font-medium text-right cursor-pointer" onClick={() => toggleSort("value")}>Value</th>}
                {visibleColumns.includes("probability") && <th scope="col" className="px-4 py-3 font-medium text-right">Probability</th>}
                {visibleColumns.includes("weightedValue") && <th scope="col" className="px-4 py-3 font-medium text-right cursor-pointer" onClick={() => toggleSort("weightedValue")}>Weighted Value</th>}
                {visibleColumns.includes("ownerName") && <th scope="col" className="px-4 py-3 font-medium">Owner</th>}
                {visibleColumns.includes("dealHealth") && <th scope="col" className="px-4 py-3 font-medium">Deal Health</th>}
                {visibleColumns.includes("nextAction") && <th scope="col" className="px-4 py-3 font-medium">Next Action</th>}
                {visibleColumns.includes("expectedClosingDate") && <th scope="col" className="px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort("expectedClosingDate")}>Expected Close</th>}
                {visibleColumns.includes("lastActivity") && <th scope="col" className="px-4 py-3 font-medium">Last Activity</th>}
                {visibleColumns.includes("pipeline") && <th scope="col" className="px-4 py-3 font-medium">Pipeline</th>}
                {visibleColumns.includes("source") && <th scope="col" className="px-4 py-3 font-medium">Source</th>}
                {visibleColumns.includes("assignedTeam") && <th scope="col" className="px-4 py-3 font-medium">Team</th>}
                {visibleColumns.includes("dealType") && <th scope="col" className="px-4 py-3 font-medium">Deal Type</th>}
                {visibleColumns.includes("priority") && <th scope="col" className="px-4 py-3 font-medium">Priority</th>}
                {visibleColumns.includes("products") && <th scope="col" className="px-4 py-3 font-medium text-right">Products</th>}
                {visibleColumns.includes("recurringValue") && <th scope="col" className="px-4 py-3 font-medium text-right">Recurring Value</th>}
                {visibleColumns.includes("createdAt") && <th scope="col" className="px-4 py-3 font-medium">Created</th>}
                {visibleColumns.includes("updatedAt") && <th scope="col" className="px-4 py-3 font-medium">Updated</th>}
                <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((deal) => {
                const company = companyById.get(deal.companyId);
                const primaryContact = deal.primaryContactId ? contactById.get(deal.primaryContactId) : null;
                const last = lastActivityAt(deal._id);
                return (
                  <tr key={deal._id} className="border-t border-gray-800 hover:bg-gray-800/40">
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(deal._id)} onChange={() => toggleSelectOne(deal._id)} aria-label={`Select ${deal.name}`} />
                    </td>
                    <td className="px-4 py-3 cursor-pointer" tabIndex={0} role="link" onClick={() => navigate(`/crm/deals/${deal._id}`)} onKeyDown={(e) => { if (e.key === "Enter") navigate(`/crm/deals/${deal._id}`); }}>
                      <span className="font-medium">{deal.name}</span>
                      {deal.archived && <span className="ml-2 text-xs text-gray-500">Archived</span>}
                    </td>
                    {visibleColumns.includes("companyName") && (
                      <td className="px-4 py-3 text-gray-300">
                        {company ? <Link to={`/crm/companies/${company._id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{company.name}</Link> : "—"}
                      </td>
                    )}
                    {visibleColumns.includes("primaryContact") && (
                      <td className="px-4 py-3 text-gray-300">
                        {primaryContact ? <Link to={`/crm/contacts/${primaryContact._id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{primaryContact.name}</Link> : "—"}
                      </td>
                    )}
                    {visibleColumns.includes("stage") && <td className="px-4 py-3"><StageBadge stage={deal.status === "Open" ? deal.stage : deal.status} /></td>}
                    {visibleColumns.includes("value") && <td className="px-4 py-3 text-gray-300 text-right">{formatMoney(deal.value, deal.currency)}</td>}
                    {visibleColumns.includes("probability") && <td className="px-4 py-3 text-gray-300 text-right">{deal.probability}%</td>}
                    {visibleColumns.includes("weightedValue") && <td className="px-4 py-3 text-gray-300 text-right">{formatMoney(deal.weightedValue, deal.currency)}</td>}
                    {visibleColumns.includes("ownerName") && <td className="px-4 py-3 text-gray-300">{deal.ownerName || "Unassigned"}</td>}
                    {visibleColumns.includes("dealHealth") && <td className="px-4 py-3"><DealHealthBadge health={deal.dealHealth} reason={deal.healthReason} /></td>}
                    {visibleColumns.includes("nextAction") && <td className="px-4 py-3 text-gray-300 max-w-40 truncate" title={deal.nextAction || ""}>{deal.nextAction || "—"}</td>}
                    {visibleColumns.includes("expectedClosingDate") && <td className="px-4 py-3 text-gray-300">{formatDate(deal.expectedClosingDate)}</td>}
                    {visibleColumns.includes("lastActivity") && <td className="px-4 py-3 text-gray-300">{formatDate(last)}</td>}
                    {visibleColumns.includes("pipeline") && <td className="px-4 py-3 text-gray-300">{deal.pipeline}</td>}
                    {visibleColumns.includes("source") && <td className="px-4 py-3 text-gray-300">{deal.source}</td>}
                    {visibleColumns.includes("assignedTeam") && <td className="px-4 py-3 text-gray-300">{deal.assignedTeam || "—"}</td>}
                    {visibleColumns.includes("dealType") && <td className="px-4 py-3 text-gray-300">{deal.dealType}</td>}
                    {visibleColumns.includes("priority") && <td className="px-4 py-3"><DealPriorityBadge priority={deal.priority} /></td>}
                    {visibleColumns.includes("products") && <td className="px-4 py-3 text-gray-300 text-right">{deal.lineItems.length}</td>}
                    {visibleColumns.includes("recurringValue") && <td className="px-4 py-3 text-gray-300 text-right">{deal.expectedRecurringValue ? formatMoney(deal.expectedRecurringValue, deal.currency) : "—"}</td>}
                    {visibleColumns.includes("createdAt") && <td className="px-4 py-3 text-gray-300">{formatDate(deal.createdAt)}</td>}
                    {visibleColumns.includes("updatedAt") && <td className="px-4 py-3 text-gray-300">{formatDate(deal.updatedAt)}</td>}
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        deal={deal}
                        open={openRowMenu === deal._id}
                        onToggle={() => setOpenRowMenu((v) => (v === deal._id ? null : deal._id))}
                        onClose={() => setOpenRowMenu(null)}
                        onView={() => navigate(`/crm/deals/${deal._id}`)}
                        onEdit={() => setRowAction({ type: "edit", deal })}
                        onLogActivity={() => setRowAction({ type: "logActivity", deal })}
                        onFollowUp={() => setRowAction({ type: "followUp", deal })}
                        onOwner={() => setRowAction({ type: "owner", deal })}
                        onChangeStage={() => setRowAction({ type: "changeStage", deal })}
                        onWon={() => setRowAction({ type: "won", deal })}
                        onLost={() => setRowAction({ type: "lost", deal })}
                        onHold={() => setRowAction({ type: "hold", deal })}
                        onReopen={() => setRowAction({ type: "reopen", deal })}
                        onArchive={() => setRowAction({ type: "archive", deal })}
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

      {showCreate && <DealFormModal onClose={() => setShowCreate(false)} onSaved={() => dispatch(fetchDeals())} />}

      {rowAction?.type === "edit" && <DealFormModal deal={rowAction.deal} onClose={() => setRowAction(null)} onSaved={() => dispatch(fetchDeals())} />}
      {(rowAction?.type === "logActivity" || rowAction?.type === "followUp") && (
        <ActivityFormModal
          prefill={{ relatedRecordType: "Deal", relatedRecordId: rowAction.deal._id, ownerId: rowAction.deal.ownerId }}
          onClose={() => setRowAction(null)}
          onSaved={() => setRowAction(null)}
        />
      )}
      {rowAction?.type === "owner" && (
        <QuickOwnerModal deal={rowAction.deal} onClose={() => setRowAction(null)} onDone={() => { setRowAction(null); dispatch(fetchDeals()); }} />
      )}
      {rowAction?.type === "changeStage" && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setRowAction(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">Change Stage — {rowAction.deal.name}</h2>
              <button onClick={() => setRowAction(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <StageProgress deal={rowAction.deal} onChanged={() => { setRowAction(null); dispatch(fetchDeals()); }} />
          </div>
        </div>
      )}
      {rowAction?.type === "won" && <MarkWonModal deal={rowAction.deal} primaryContact={contactById.get(rowAction.deal.primaryContactId)} onClose={() => setRowAction(null)} onDone={() => dispatch(fetchDeals())} />}
      {rowAction?.type === "lost" && <MarkLostModal deal={rowAction.deal} onClose={() => setRowAction(null)} onDone={() => dispatch(fetchDeals())} />}
      {rowAction?.type === "hold" && <PutOnHoldModal deal={rowAction.deal} onClose={() => setRowAction(null)} onDone={() => dispatch(fetchDeals())} />}
      {rowAction?.type === "reopen" && <ReopenDealModal deal={rowAction.deal} onClose={() => setRowAction(null)} onDone={() => dispatch(fetchDeals())} />}
      {rowAction?.type === "archive" && <ArchiveDealModal deal={rowAction.deal} onClose={() => setRowAction(null)} onDone={() => dispatch(fetchDeals())} />}
    </div>
  );
}

function DealsTableSkeleton({ visibleColumns }) {
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

function RowActionsMenu({ deal, open, onToggle, onClose, onView, onEdit, onLogActivity, onFollowUp, onOwner, onChangeStage, onWon, onLost, onHold, onReopen, onArchive }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, onClose]);

  const isOpen = deal.status === "Open";
  const items = [
    { label: "View", action: onView },
    { label: "Edit", action: onEdit },
    { label: "Log Activity", action: onLogActivity },
    { label: "Create Follow-up", action: onFollowUp },
    { label: "Change Owner", action: onOwner },
    isOpen ? { label: "Change Stage", action: onChangeStage } : null,
    isOpen ? { label: "Mark Won", action: onWon } : null,
    isOpen ? { label: "Mark Lost", action: onLost } : null,
    isOpen ? { label: "Put On Hold", action: onHold } : null,
    !isOpen ? { label: "Reopen", action: onReopen } : null,
    !deal.archived ? { label: "Archive", action: onArchive } : null,
  ].filter(Boolean);

  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={onToggle} aria-label={`Actions for ${deal.name}`} aria-haspopup="menu" aria-expanded={open} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
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

function QuickOwnerModal({ deal, onClose, onDone }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const dispatch = useDispatch();
  const [ownerId, setOwnerId] = useState(deal.ownerId || "");
  const containerRef = useFocusTrap(true, onClose);

  const submit = async (e) => {
    e.preventDefault();
    await dispatch(updateDeal({ id: deal._id, changes: { ownerId: ownerId || null } }));
    onDone();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Change Owner" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Change Owner — {deal.name}</h2>
        <select autoFocus value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          <option value="">Unassigned</option>
          {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
        </select>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Save</button>
        </div>
      </form>
    </div>
  );
}

