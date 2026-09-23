import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useSearchParams, Link } from "react-router-dom";
import {
  Plus, Search, RefreshCw, ChevronDown, Bookmark, X, AlertCircle,
  CalendarDays, Table2, CalendarRange, Clock, AlertTriangle, CheckCircle2, UserX,
} from "lucide-react";
import {
  fetchActivities, bulkAssignActivities, bulkRescheduleActivities, bulkCompleteActivities, bulkCancelActivities,
  ACTIVITY_TYPES, ACTIVITY_STATUSES, ACTIVITY_PRIORITIES, RELATED_RECORD_TYPES,
} from "../../../redux/crm/activitiesSlice";
import { fetchLeads } from "../../../redux/crm/leadsSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { queryActivitiesLocal } from "../../../Helpers/mockActivitiesData";
import { CRM_DEPARTMENTS } from "../../../Helpers/mockUsersData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import useDebounced from "../../../hooks/useDebounced";
import AgendaView from "./AgendaView";
import TableView from "./TableView";
import CalendarView from "./CalendarView";
import ActivityFormModal from "./ActivityFormModal";
import ActivityDetailDrawer from "./ActivityDetailDrawer";

const VIEWS = [
  { key: "agenda", label: "Agenda", icon: CalendarDays },
  { key: "table", label: "Table", icon: Table2 },
  { key: "calendar", label: "Calendar", icon: CalendarRange },
];
const SAVED_VIEWS_KEY = "crm.activities.savedViews";
const FILTER_LABELS = {
  type: "Type", status: "Status", priority: "Priority", ownerId: "Owner", team: "Team",
  relatedRecordType: "Related Type", relatedRecordId: "Related Record", dateFrom: "From", dateTo: "To",
  overdue: "Overdue", upcoming: "Upcoming", completed: "Completed", hasReminder: "Has Reminder",
  hasOutcome: "Has Outcome", createdBy: "Created By", search: "Search",
};

export default function ActivitiesPage() {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const dispatch = useDispatch();
  const { items: activities, loading, error } = useSelector((s) => s.activities);
  const leads = useSelector((s) => s.leads.items);
  const contacts = useSelector((s) => s.contacts.items);
  const companies = useSelector((s) => s.companies.items);
  const deals = useSelector((s) => s.deals.items);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const debouncedSearch = useDebounced(searchInput, 350);

  const [showCreate, setShowCreate] = useState(false);
  const [createPrefill, setCreatePrefill] = useState(null);
  const [showViews, setShowViews] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [drawerState, setDrawerState] = useState(null); // { activity, initialAction }
  const [editActivity, setEditActivity] = useState(null);
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)) || []; } catch { return []; }
  });

  useEffect(() => {
    dispatch(fetchActivities());
    dispatch(fetchLeads({ pageSize: 1000 }));
    dispatch(fetchContacts({ pageSize: 1000 }));
    dispatch(fetchCompanies());
    dispatch(fetchDeals());
  }, [dispatch]);

  const view = searchParams.get("view") || "agenda";
  const params = useMemo(() => {
    const p = {};
    for (const [key, value] of searchParams.entries()) p[key] = value;
    if (debouncedSearch) p.search = debouncedSearch;
    else delete p.search;
    return p;
  }, [searchParams, debouncedSearch]);

  useEffect(() => {
    const current = searchParams.get("search") || "";
    if (debouncedSearch === current) return;
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch) next.set("search", debouncedSearch);
    else next.delete("search");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const updateParam = (key, value, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === null || value === "") next.delete(key);
    else next.set(key, value);
    if (resetPage && key !== "page") next.delete("page");
    setSearchParams(next);
  };
  const setView = (v) => updateParam("view", v, false);
  const clearFilters = () => { setSearchInput(""); setSearchParams(view === "agenda" ? {} : { view }); };
  const removeFilter = (key) => updateParam(key, undefined);

  // The full filtered (but not yet paginated) set — shared by all three
  // views so switching views never re-derives a different result set.
  const filteredResult = useMemo(() => queryActivitiesLocal(activities, { ...params, page: 1, pageSize: 100000 }), [activities, params]);
  const { activities: filteredActivities, total, summary } = filteredResult;

  const activeFilterEntries = Array.from(searchParams.entries()).filter(([k]) => !["view", "page", "pageSize", "sort", "order"].includes(k));
  const isFiltered = activeFilterEntries.length > 0;

  const relatedOptions = useMemo(() => {
    const type = params.relatedRecordType;
    if (type === "Lead") return leads.map((l) => ({ value: l._id, label: l.name }));
    if (type === "Contact") return contacts.map((c) => ({ value: c._id, label: c.name }));
    if (type === "Company") return companies.map((c) => ({ value: c._id, label: c.name }));
    if (type === "Deal") return deals.map((d) => ({ value: d._id, label: d.name }));
    return [];
  }, [params.relatedRecordType, leads, contacts, companies, deals]);

  const applyCardFilter = (key, value) => updateParam(key, value);
  const saveCurrentView = () => {
    const name = window.prompt("Name this view:");
    if (!name?.trim()) return;
    const v = { name: name.trim(), params: Object.fromEntries(searchParams.entries()) };
    const next = [...savedViews.filter((sv) => sv.name !== v.name), v];
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
  };
  const applySavedView = (v) => { setSearchParams(v.params); setSearchInput(v.params.search || ""); setShowViews(false); };
  const deleteSavedView = (name) => {
    const next = savedViews.filter((sv) => sv.name !== name);
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
  };

  const toggleSelect = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleSelectAll = (pageItems) => {
    if (selected.size === pageItems.length) setSelected(new Set());
    else setSelected(new Set(pageItems.map((a) => a._id)));
  };

  const openDetail = (activity) => setDrawerState({ activity, initialAction: null });
  const handleQuickAction = (activity, action) => {
    if (action === "edit") setEditActivity(activity);
    else setDrawerState({ activity, initialAction: action });
  };
  const handleCreateAt = (date) => {
    const pad = (n) => String(n).padStart(2, "0");
    setCreatePrefill({ date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, startTime: `${pad(date.getHours())}:${pad(date.getMinutes())}` });
    setShowCreate(true);
  };

  const submitBulk = async () => {
    const ids = Array.from(selected);
    if (bulkAction === "assign" && bulkValue) await dispatch(bulkAssignActivities({ activityIds: ids, ownerId: bulkValue }));
    else if (bulkAction === "reschedule" && bulkValue) await dispatch(bulkRescheduleActivities({ activityIds: ids, startAt: new Date(bulkValue).toISOString() }));
    else if (bulkAction === "complete") await dispatch(bulkCompleteActivities({ activityIds: ids }));
    else if (bulkAction === "cancel") {
      if (!bulkReason.trim()) return;
      await dispatch(bulkCancelActivities({ activityIds: ids, reason: bulkReason }));
    }
    setSelected(new Set());
    setBulkAction(null);
    setBulkValue("");
    setBulkReason("");
  };

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/crm/dashboard" className="hover:text-gray-300">CRM</Link> / <span className="text-gray-300">Activities</span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Activities</h1>
          <p className="text-sm text-gray-400 mt-1">
            Calls, emails, meetings, follow-ups, tasks, notes and visits across your Leads, Contacts and Companies. {total} activit{total === 1 ? "y" : "ies"} visible.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => dispatch(fetchActivities())} title="Refresh" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <RefreshCw size={16} /> Refresh
          </button>
          <div className="relative">
            <button onClick={() => setShowViews((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
              <Bookmark size={16} /> Views <ChevronDown size={14} />
            </button>
            {showViews && (
              <div className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg p-2 z-20 w-56 shadow-xl">
                <button onClick={saveCurrentView} className="w-full text-left text-sm px-2 py-1.5 hover:bg-gray-800 rounded">+ Save current filters as view</button>
                {savedViews.length > 0 && <div className="border-t border-gray-800 my-1" />}
                {savedViews.map((v) => (
                  <div key={v.name} className="flex items-center justify-between px-2 py-1.5 hover:bg-gray-800 rounded text-sm">
                    <button onClick={() => applySavedView(v)} className="text-left flex-1">{v.name}</button>
                    <button onClick={() => deleteSavedView(v.name)} aria-label={`Delete view ${v.name}`}><X size={14} className="text-gray-500 hover:text-red-400" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => { setCreatePrefill(null); setShowCreate(true); }} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium text-white">
            <Plus size={16} /> Create Activity
          </button>
        </div>
      </div>

      {/* Compact metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <button onClick={() => updateParam("status", "")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1 flex items-center gap-1"><Clock size={11} /> Due Today</p>
          <p className="text-xl font-bold">{summary.dueToday}</p>
        </button>
        <button onClick={() => applyCardFilter("overdue", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1 flex items-center gap-1"><AlertTriangle size={11} /> Overdue</p>
          <p className={`text-xl font-bold ${summary.overdue > 0 ? "text-red-400" : ""}`}>{summary.overdue}</p>
        </button>
        <button onClick={() => applyCardFilter("upcoming", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Upcoming</p>
          <p className="text-xl font-bold">{summary.upcoming}</p>
        </button>
        <button onClick={() => applyCardFilter("completed", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1 flex items-center gap-1"><CheckCircle2 size={11} /> Completed (7d)</p>
          <p className="text-xl font-bold">{summary.completedThisWeek}</p>
        </button>
        <button onClick={() => applyCardFilter("ownerId", "unassigned")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1 flex items-center gap-1"><UserX size={11} /> Unassigned</p>
          <p className="text-xl font-bold">{summary.unassigned}</p>
        </button>
      </div>

      {/* View switcher */}
      <div className="flex gap-1 bg-gray-900/60 border border-gray-800 rounded-lg p-1 w-fit mb-4">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          return (
            <button key={v.key} onClick={() => setView(v.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm ${view === v.key ? "bg-blue-700 text-white" : "text-gray-400 hover:text-gray-200"}`}>
              <Icon size={14} /> {v.label}
            </button>
          );
        })}
      </div>

      {/* Toolbar / filters */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative flex-1 min-w-55 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search activities..." aria-label="Search activities"
            className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        </div>
        <select value={params.type || ""} onChange={(e) => updateParam("type", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by activity type">
          <option value="">All Types</option>
          {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={params.status || ""} onChange={(e) => updateParam("status", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by status">
          <option value="">All Statuses</option>
          {[...ACTIVITY_STATUSES, "Overdue"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={params.priority || ""} onChange={(e) => updateParam("priority", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by priority">
          <option value="">All Priorities</option>
          {ACTIVITY_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={params.ownerId || ""} onChange={(e) => updateParam("ownerId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by owner">
          <option value="">All Owners</option>
          <option value="unassigned">Unassigned</option>
          {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={params.team || ""} onChange={(e) => updateParam("team", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by team">
          <option value="">All Teams</option>
          {CRM_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={params.relatedRecordType || ""} onChange={(e) => { updateParam("relatedRecordType", e.target.value); updateParam("relatedRecordId", ""); }} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by related record type">
          <option value="">All Related Types</option>
          {RELATED_RECORD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {params.relatedRecordType && (
          <select value={params.relatedRecordId || ""} onChange={(e) => updateParam("relatedRecordId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by specific related record">
            <option value="">Any {params.relatedRecordType}</option>
            {relatedOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
          <input type="checkbox" checked={params.hasReminder === "true"} onChange={(e) => updateParam("hasReminder", e.target.checked ? "true" : "")} /> Has Reminder
        </label>
      </div>

      {isFiltered && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-gray-500">{total} result{total === 1 ? "" : "s"}</span>
          {activeFilterEntries.map(([key, value]) => (
            <span key={key} className="flex items-center gap-1.5 bg-gray-800/70 border border-gray-700 rounded-full pl-2.5 pr-1.5 py-1 text-xs text-gray-200">
              {FILTER_LABELS[key] || key}: {value === "true" ? "Yes" : value}
              <button onClick={() => removeFilter(key)} aria-label={`Clear ${FILTER_LABELS[key] || key} filter`} className="hover:text-white"><X size={12} /></button>
            </span>
          ))}
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white ml-1"><X size={12} /> Clear all filters</button>
        </div>
      )}

      {loading ? (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 bg-gray-800/50 rounded animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-10 text-center text-gray-400">
          <AlertCircle className="mx-auto mb-2 text-red-400" size={28} />
          <p className="mb-1 text-gray-200">Couldn't load activities</p>
          <p className="mb-3 text-sm">{error}</p>
          <button onClick={() => dispatch(fetchActivities())} className="text-blue-400 hover:underline text-sm">Retry</button>
        </div>
      ) : filteredActivities.length === 0 && !isFiltered ? (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-12 text-center text-gray-400">
          <p className="mb-3">No activities yet — create your first call, meeting, task or note to start tracking engagement.</p>
          <button onClick={() => setShowCreate(true)} className="text-blue-400 hover:underline text-sm">Create Activity</button>
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-12 text-center text-gray-400">
          <p className="mb-1">No activities match the current filters.</p>
          <p className="text-xs text-gray-500 mb-3">{activeFilterEntries.length} filter{activeFilterEntries.length === 1 ? "" : "s"} active</p>
          <button onClick={clearFilters} className="text-blue-400 hover:underline text-sm">Clear Filters</button>
        </div>
      ) : view === "agenda" ? (
        <AgendaView activities={filteredActivities} onOpen={openDetail} onQuickAction={handleQuickAction} onCreateActivity={() => setShowCreate(true)} />
      ) : view === "table" ? (
        <TableView
          activities={filteredActivities} params={params} updateParam={updateParam}
          selected={selected} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll}
          onOpen={openDetail} onQuickAction={handleQuickAction} onBulkAction={setBulkAction}
        />
      ) : (
        <CalendarView activities={filteredActivities} onOpen={openDetail} onCreateAt={handleCreateAt} />
      )}

      {bulkAction && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setBulkAction(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">{{ assign: "Bulk Assign", reschedule: "Bulk Reschedule", complete: "Bulk Complete", cancel: "Bulk Cancel" }[bulkAction]}</h2>
            {bulkAction === "assign" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Select owner...</option>
                {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            {bulkAction === "reschedule" && <input type="datetime-local" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />}
            {bulkAction === "complete" && <p className="text-sm text-gray-400">{selected.size} activit{selected.size === 1 ? "y" : "ies"} will be marked complete without an outcome. Open individual activities to record outcomes.</p>}
            {bulkAction === "cancel" && <input value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />}
            <div className="flex justify-end gap-2">
              <button onClick={() => setBulkAction(null)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button onClick={submitBulk} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Apply</button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <ActivityFormModal prefill={createPrefill} onClose={() => setShowCreate(false)} onSaved={() => dispatch(fetchActivities())} />
      )}
      {editActivity && (
        <ActivityFormModal activity={editActivity} onClose={() => setEditActivity(null)} onSaved={() => dispatch(fetchActivities())} />
      )}
      {drawerState && (
        <ActivityDetailDrawer
          activity={activities.find((a) => a._id === drawerState.activity._id) || drawerState.activity}
          initialAction={drawerState.initialAction}
          onClose={() => setDrawerState(null)}
          onEdit={() => { setEditActivity(drawerState.activity); setDrawerState(null); }}
          onOpenActivity={(activity) => setDrawerState({ activity, initialAction: null })}
        />
      )}
    </div>
  );
}
