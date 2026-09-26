import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  RefreshCw, Search, Bookmark, X, ChevronUp, ChevronDown, AlertCircle, ScanSearch, History,
  ChevronLeft, ChevronRight, MoreHorizontal, CheckCircle2,
} from "lucide-react";
import {
  runFrontendScan, markNotDuplicate, bulkMarkNotDuplicate, deferReview, bulkDefer,
  assignReviewer, bulkAssignReviewer, bulkMarkForReview,
} from "../../../redux/crm/duplicatesSlice";
import { leads, contacts, companies, deals } from "../../../Helpers/mockCrmData";
import { CRM_TEAM, findTeamMember } from "../../../Helpers/mockUsersData";
import { filterGroups, sortGroups, computeMetrics } from "./duplicateQuery";
import { MARK_NOT_DUPLICATE_REASONS } from "./duplicateFieldConfig";
import { RECORD_TYPE_LABELS, RECORD_TYPE_COLORS, CONFIDENCE_COLORS, STATUS_COLORS } from "./duplicateDisplayConfig";
import useFocusTrap from "../../../hooks/useFocusTrap";
import ComparisonWorkspace from "./ComparisonWorkspace";
import MergeHistoryDrawer from "./MergeHistoryDrawer";

const STATUS_OPTIONS = ["New", "Needs Review", "Confirmed Duplicate", "Not Duplicate", "Deferred", "Preview Resolved"];
const FILTER_LABELS = {
  type: "Type", confidence: "Confidence", rule: "Matching rule", source: "Detection source", status: "Status",
  reviewer: "Reviewer", imported: "Imported records", hasConflicts: "Has conflicts", recordCount: "Group size", search: "Search",
};
const SAVED_VIEWS_KEY = "crm.duplicates.savedViews";

function ownerName(id) {
  if (!id) return "Unassigned";
  return findTeamMember(id)?.name || id;
}

export default function DuplicatesPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { groups, scan, mergeHistory } = useSelector((s) => s.duplicates);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => new Date());
  const [selected, setSelected] = useState(new Set());
  const [openGroupId, setOpenGroupId] = useState(null);
  const [openStep, setOpenStep] = useState("compare");
  const [showHistory, setShowHistory] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [showFiltersDrawer, setShowFiltersDrawer] = useState(false);
  const [rowAction, setRowAction] = useState(null);
  const [bulkAction, setBulkAction] = useState(null);
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY)) || []; } catch { return []; }
  });

  const params = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);

  // Rebuilt on every render (not memoized): leads/contacts/companies/deals
  // are plain shared-fixture arrays mutated in place by scans/merges/undo,
  // so there's no stable dependency to memoize against — these lookups must
  // always reflect the current in-memory state, and rebuilding a few dozen
  // Map entries is cheap enough not to bother.
  const lookups = {
    leads: new Map(leads.map((r) => [r._id, r])),
    contacts: new Map(contacts.map((r) => [r._id, r])),
    companies: new Map(companies.map((r) => [r._id, r])),
    deals: new Map(deals.map((r) => [r._id, r])),
  };

  const metrics = useMemo(() => computeMetrics(groups), [groups]);

  // Not memoized, for the same reason as `lookups` above: recomputed fresh
  // every render so it can never show stale data after a scan/merge/undo.
  const filteredRows = sortGroups(filterGroups(groups, { ...params, search: searchInput }, lookups), params.sort, params.order);

  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.max(1, Number(params.pageSize) || 10);
  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = filteredRows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  const updateParam = (key, value, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === null || value === "") next.delete(key);
    else next.set(key, value);
    if (resetPage) next.set("page", "1");
    setSearchParams(next);
  };
  const clearFilters = () => { setSearchInput(""); setSearchParams({}); };
  const removeFilter = (key) => updateParam(key, undefined);
  const activeFilterEntries = Array.from(searchParams.entries()).filter(([k]) => !["page", "pageSize", "sort", "order"].includes(k));
  const isFiltered = activeFilterEntries.length > 0;

  useEffect(() => {
    const current = searchParams.get("search") || "";
    if (searchInput === current) return;
    const t = setTimeout(() => updateParam("search", searchInput || undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const toggleSort = (key) => {
    const next = new URLSearchParams(searchParams);
    if (params.sort === key) next.set("order", params.order === "asc" ? "desc" : "asc");
    else { next.set("sort", key); next.set("order", "desc"); }
    setSearchParams(next);
  };

  const toggleSelectAll = () => {
    if (selected.size === pageRows.length) setSelected(new Set());
    else setSelected(new Set(pageRows.map((r) => r.group.id)));
  };
  const toggleSelectOne = (id) => setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const applyMetricFilter = (key, value) => { setSelected(new Set()); if (key) updateParam(key, value); else clearFilters(); };

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

  const openWorkspace = (group, step = "compare") => { setOpenGroupId(group.id); setOpenStep(step); };
  const closeWorkspace = () => { setOpenGroupId(null); setLastRefreshedAt(new Date()); };
  const openGroup = groups.find((g) => g.id === openGroupId) || null;

  const submitBulk = () => {
    const ids = Array.from(selected);
    if (bulkAction?.type === "assign" && bulkAction.reviewerId) dispatch(bulkAssignReviewer({ groupIds: ids, reviewerId: bulkAction.reviewerId }));
    else if (bulkAction?.type === "review") dispatch(bulkMarkForReview({ groupIds: ids }));
    else if (bulkAction?.type === "defer") dispatch(bulkDefer({ groupIds: ids, reviewer: bulkAction.reviewer, reviewDate: bulkAction.reviewDate, note: bulkAction.note }));
    else if (bulkAction?.type === "notDuplicate" && bulkAction.reason) dispatch(bulkMarkNotDuplicate({ groupIds: ids, reason: bulkAction.reason }));
    setSelected(new Set());
    setBulkAction(null);
  };

  const scanRunning = scan.status === "running";

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/crm/dashboard" className="hover:text-gray-300">CRM</Link> / <span className="text-gray-300">Duplicates</span>
      </nav>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold">Duplicate Management</h1>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Find, compare and safely resolve possible duplicate Leads, Contacts, Companies and Deals across the shared CRM data.
            Every merge here is a frontend preview for this session only — nothing is ever merged or deleted automatically.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setLastRefreshedAt(new Date())} title={`Last refreshed ${lastRefreshedAt.toLocaleTimeString()}`} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <RefreshCw size={16} /> Refresh
          </button>
          <button data-tour="duplicates-history" onClick={() => setShowHistory(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <History size={16} /> Merge History {mergeHistory.filter((h) => !h.undone).length > 0 && `(${mergeHistory.filter((h) => !h.undone).length})`}
          </button>
          <button
            onClick={() => dispatch(runFrontendScan())}
            disabled={scanRunning}
            className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
          >
            <ScanSearch size={16} className={scanRunning ? "animate-spin" : ""} /> {scanRunning ? "Scanning..." : "Run Frontend Scan"}
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 mb-4">
        Run Frontend Scan only scans this session&apos;s shared frontend fixtures — it never scans or represents production data.
      </p>

      {scan.status === "done" && scan.summary && (
        <div className="bg-emerald-900/10 border border-emerald-800/30 rounded-xl p-3 mb-4 text-xs text-emerald-200 flex flex-wrap gap-x-6 gap-y-1">
          <span><CheckCircle2 size={13} className="inline mr-1" />Scan complete</span>
          <span>{scan.summary.recordsScanned} records scanned</span>
          <span>{scan.summary.newGroupCount} new group{scan.summary.newGroupCount === 1 ? "" : "s"}</span>
          <span>{scan.summary.existingGroupsRetained} existing group{scan.summary.existingGroupsRetained === 1 ? "" : "s"} retained</span>
          <span>{scan.summary.highConfidenceGroups} high-confidence</span>
          <span>{scan.summary.possibleFalsePositives} possible false positive{scan.summary.possibleFalsePositives === 1 ? "" : "s"}</span>
          <span>{(scan.summary.durationMs / 1000).toFixed(1)}s</span>
        </div>
      )}
      {scan.status === "error" && (
        <div role="alert" className="bg-red-900/10 border border-red-800/30 rounded-xl p-3 mb-4 text-sm text-red-200 flex items-center justify-between">
          <span><AlertCircle size={14} className="inline mr-1" /> {scan.error}</span>
          <button onClick={() => dispatch(runFrontendScan())} className="text-blue-300 hover:underline text-xs">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6" data-tour="duplicates-summary">
        <button onClick={() => applyMetricFilter(null)} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Duplicate groups</p>
          <p className="text-xl font-bold">{metrics.total}</p>
        </button>
        <button onClick={() => applyMetricFilter("confidence", "High")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">High confidence</p>
          <p className="text-xl font-bold text-red-300">{metrics.highConfidence}</p>
        </button>
        <button onClick={() => applyMetricFilter("status", "Needs Review")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Needs review</p>
          <p className="text-xl font-bold text-amber-300">{metrics.needsReview}</p>
        </button>
        <button onClick={() => applyMetricFilter("status", "Confirmed Duplicate")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Confirmed duplicates</p>
          <p className="text-xl font-bold">{metrics.confirmedDuplicate}</p>
        </button>
        <button onClick={() => applyMetricFilter("status", "Not Duplicate")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Marked not duplicate</p>
          <p className="text-xl font-bold">{metrics.notDuplicate}</p>
        </button>
        <button onClick={() => applyMetricFilter("status", "Preview Resolved")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Preview-resolved</p>
          <p className="text-xl font-bold text-emerald-300">{metrics.previewResolved}</p>
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center" data-tour="duplicates-filters">
        <div className="relative flex-1 min-w-55 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search name, email, matching rule..."
            aria-label="Search duplicate groups" className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        </div>

        <div className="hidden md:flex gap-2 flex-wrap">
          <FilterSelects params={params} updateParam={updateParam} />
        </div>
        <button onClick={() => setShowFiltersDrawer(true)} className="md:hidden flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
          Filters {isFiltered && `(${activeFilterEntries.length})`}
        </button>

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
              {FILTER_LABELS[key] || key}: {key === "reviewer" ? ownerName(value === "unassigned" ? null : value) : value}
              <button onClick={() => removeFilter(key)} aria-label={`Clear ${FILTER_LABELS[key] || key} filter`} className="hover:text-white"><X size={12} /></button>
            </span>
          ))}
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white ml-1"><X size={12} /> Clear all filters</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-700/40 rounded-xl p-3 mb-4 flex-wrap">
          <span className="text-sm">{selected.size} selected</span>
          <button onClick={() => setBulkAction({ type: "assign" })} className="text-sm text-blue-300 hover:underline">Assign reviewer</button>
          <button onClick={() => setBulkAction({ type: "review" })} className="text-sm text-blue-300 hover:underline">Mark for review</button>
          <button onClick={() => setBulkAction({ type: "defer" })} className="text-sm text-blue-300 hover:underline">Defer</button>
          <button onClick={() => setBulkAction({ type: "notDuplicate" })} className="text-sm text-blue-300 hover:underline">Mark Not Duplicate</button>
          <span className="text-xs text-gray-500">Bulk merge isn&apos;t offered — every merge is reviewed one group at a time.</span>
          <button onClick={() => setSelected(new Set())} className="text-sm text-gray-400 hover:text-white ml-auto">Clear selection</button>
        </div>
      )}

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto" data-tour="duplicates-table">
        {scanRunning && groups.length === 0 ? (
          <TableSkeleton />
        ) : scan.status === "error" && groups.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <AlertCircle className="mx-auto mb-2 text-red-400" size={28} />
            <p className="mb-1 text-gray-200">The frontend scan failed</p>
            <p className="mb-3 text-sm">{scan.error}</p>
            <button onClick={() => dispatch(runFrontendScan())} className="text-blue-400 hover:underline text-sm">Retry</button>
          </div>
        ) : groups.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <CheckCircle2 className="mx-auto mb-2 text-emerald-400" size={26} />
            <p className="mb-1">No duplicate groups yet.</p>
            <p className="text-sm text-gray-500 mb-4">Run a frontend scan to look for possible duplicates across the shared Leads, Contacts, Companies and Deals fixtures.</p>
            <button onClick={() => dispatch(runFrontendScan())} className="text-blue-400 hover:underline text-sm">Run Frontend Scan</button>
          </div>
        ) : pageRows.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="mb-1">No duplicate groups match the current filters.</p>
            <p className="text-xs text-gray-500 mb-3">{activeFilterEntries.length} filter{activeFilterEntries.length === 1 ? "" : "s"} active</p>
            <button onClick={clearFilters} className="text-blue-400 hover:underline text-sm">Clear Filters</button>
          </div>
        ) : (
          <table className="w-full text-sm min-w-300">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 w-8"><input type="checkbox" checked={selected.size === pageRows.length && pageRows.length > 0} onChange={toggleSelectAll} aria-label="Select all duplicate groups" /></th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("recordType")}>
                  <span className="flex items-center gap-1">Type {params.sort === "recordType" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">Records</th>
                <th scope="col" className="px-4 py-3 font-medium">Primary match</th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("confidence")}>
                  <span className="flex items-center gap-1">Confidence {params.sort === "confidence" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("conflictCount")}>
                  <span className="flex items-center gap-1">Conflicts {params.sort === "conflictCount" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">Detection source</th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("detectedAt")}>
                  <span className="flex items-center gap-1">Detected {params.sort === "detectedAt" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("reviewStatus")}>
                  <span className="flex items-center gap-1">Review status {params.sort === "reviewStatus" && (params.order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">Reviewer</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ group, derived }) => (
                <tr key={group.id} className="border-t border-gray-800 hover:bg-gray-800/40">
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(group.id)} onChange={() => toggleSelectOne(group.id)} aria-label={`Select group ${derived.identifier}`} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs border ${RECORD_TYPE_COLORS[group.recordType]}`}>{RECORD_TYPE_LABELS[group.recordType]}</span>
                    {group.mixedTypes && <span className="block text-[10px] text-gray-500 mt-1">Lead ↔ Contact</span>}
                  </td>
                  <td className="px-4 py-3 cursor-pointer" onClick={() => openWorkspace(group)}>
                    <p className="font-medium">{derived.identifier}</p>
                    {derived.secondaryIdentifiers.length > 0 && <p className="text-xs text-gray-500">+ {derived.secondaryIdentifiers.join(", ")}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-xs max-w-50">{group.matchingRules[0]}{group.matchingRules.length > 1 && ` +${group.matchingRules.length - 1} more`}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs border ${CONFIDENCE_COLORS[group.confidenceLabel]}`} title={group.matchingRules.join(", ")}>
                      {group.confidenceLabel} · {group.confidencePercent}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{derived.conflictCount > 0 ? <span className="text-amber-300">{derived.conflictCount}</span> : "0"}</td>
                  <td className="px-4 py-3 text-gray-300">{group.detectionSource}</td>
                  <td className="px-4 py-3 text-gray-300">{new Date(group.detectedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs border ${STATUS_COLORS[group.reviewStatus]}`}>{group.reviewStatus}</span></td>
                  <td className="px-4 py-3 text-gray-300">{ownerName(group.assignedReviewer)}</td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <RowActionsMenu
                      group={group}
                      onReview={() => openWorkspace(group, "compare")}
                      onCompare={() => openWorkspace(group, "compare")}
                      onAssign={() => setRowAction({ type: "assign", group })}
                      onNotDuplicate={() => setRowAction({ type: "notDuplicate", group })}
                      onDefer={() => setRowAction({ type: "defer", group })}
                      onPreviewMerge={() => openWorkspace(group, "master")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!scanRunning && total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>Page {page} of {totalPages} · {total} total</span>
          <div className="flex items-center gap-2">
            <select value={pageSize} onChange={(e) => updateParam("pageSize", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-2 py-1.5 text-sm">
              {[10, 20, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
            <button disabled={page <= 1} onClick={() => updateParam("page", String(page - 1), false)} className="p-2 rounded-lg border border-gray-800 disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={16} /></button>
            <button disabled={page >= totalPages} onClick={() => updateParam("page", String(page + 1), false)} className="p-2 rounded-lg border border-gray-800 disabled:opacity-30" aria-label="Next page"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {showFiltersDrawer && <FiltersDrawer params={params} updateParam={updateParam} onClose={() => setShowFiltersDrawer(false)} />}
      {openGroup && (
        <ComparisonWorkspace
          group={openGroup}
          initialStep={openStep}
          lookups={lookups}
          onClose={closeWorkspace}
          navigate={navigate}
        />
      )}
      {showHistory && <MergeHistoryDrawer onClose={() => { setShowHistory(false); setLastRefreshedAt(new Date()); }} />}
      {rowAction?.type === "assign" && <AssignReviewerDialog group={rowAction.group} onClose={() => setRowAction(null)} onSave={(reviewerId) => { dispatch(assignReviewer({ groupId: rowAction.group.id, reviewerId })); setRowAction(null); }} />}
      {rowAction?.type === "notDuplicate" && <MarkNotDuplicateDialog onClose={() => setRowAction(null)} onSave={(reason) => { dispatch(markNotDuplicate({ groupId: rowAction.group.id, reason })); setRowAction(null); }} />}
      {rowAction?.type === "defer" && <DeferDialog group={rowAction.group} onClose={() => setRowAction(null)} onSave={(payload) => { dispatch(deferReview({ groupId: rowAction.group.id, ...payload })); setRowAction(null); }} />}
      {bulkAction && (
        <BulkActionDialog
          bulkAction={bulkAction}
          count={selected.size}
          onChange={setBulkAction}
          onClose={() => setBulkAction(null)}
          onSubmit={submitBulk}
        />
      )}
    </div>
  );
}

function FilterSelects({ params, updateParam }) {
  return (
    <>
      <select value={params.type || ""} onChange={(e) => updateParam("type", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by record type">
        <option value="">All Types</option>
        {Object.entries(RECORD_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <select value={params.confidence || ""} onChange={(e) => updateParam("confidence", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by confidence">
        <option value="">All Confidence</option>
        {["High", "Medium", "Low"].map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={params.status || ""} onChange={(e) => updateParam("status", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by review status">
        <option value="">All Statuses</option>
        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={params.reviewer || ""} onChange={(e) => updateParam("reviewer", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by assigned reviewer">
        <option value="">All Reviewers</option>
        <option value="unassigned">Unassigned</option>
        {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select value={params.recordCount || ""} onChange={(e) => updateParam("recordCount", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by group size">
        <option value="">Any Size</option>
        <option value="two">Two-record groups</option>
        <option value="multi">Multi-record groups</option>
      </select>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.imported === "true"} onChange={(e) => updateParam("imported", e.target.checked ? "true" : undefined)} />
        Imported records
      </label>
      <label className="flex items-center gap-1.5 text-sm text-gray-300 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2">
        <input type="checkbox" checked={params.hasConflicts === "true"} onChange={(e) => updateParam("hasConflicts", e.target.checked ? "true" : undefined)} />
        Has field conflicts
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

function TableSkeleton() {
  return (
    <div className="p-4">
      <div className="flex gap-4 px-4 py-3 border-b border-gray-800">
        {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-3 bg-gray-800/60 rounded flex-1 animate-pulse" />)}
      </div>
      {Array.from({ length: 5 }).map((_, row) => (
        <div key={row} className="flex gap-4 px-4 py-3 border-b border-gray-800/60">
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-4 bg-gray-800/40 rounded flex-1 animate-pulse" />)}
        </div>
      ))}
      <p className="text-center text-xs text-gray-500 py-3">Scanning shared fixtures for possible duplicates...</p>
    </div>
  );
}

function RowActionsMenu({ group, onReview, onCompare, onAssign, onNotDuplicate, onDefer, onPreviewMerge }) {
  const [open, setOpen] = useState(false);
  const items = [
    { label: "Review", action: onReview },
    { label: "Compare", action: onCompare },
    { label: "Assign reviewer", action: onAssign },
    { label: group.reviewStatus === "Not Duplicate" ? null : "Mark Not Duplicate", action: onNotDuplicate },
    { label: group.reviewStatus === "Deferred" ? null : "Defer", action: onDefer },
    { label: group.reviewStatus === "Preview Resolved" ? null : "Preview Merge", action: onPreviewMerge },
  ].filter((i) => i.label);
  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen((v) => !v)} aria-label={`Actions for group ${group.id}`} aria-haspopup="menu" aria-expanded={open} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-48 shadow-xl text-left" onMouseLeave={() => setOpen(false)}>
          {items.map((item) => (
            <button key={item.label} role="menuitem" onClick={() => { item.action(); setOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function AssignReviewerDialog({ group, onClose, onSave }) {
  const [reviewerId, setReviewerId] = useState(group.assignedReviewer || "");
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Assign reviewer" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Assign Reviewer</h2>
        <select autoFocus value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          <option value="">Unassigned</option>
          {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
        </select>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button onClick={() => onSave(reviewerId || null)} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Save</button>
        </div>
      </div>
    </div>
  );
}

function MarkNotDuplicateDialog({ onClose, onSave }) {
  const [reason, setReason] = useState(MARK_NOT_DUPLICATE_REASONS[0]);
  const [otherText, setOtherText] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const finalReason = reason === "Other" ? otherText.trim() : reason;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Mark Not Duplicate" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Mark Not Duplicate</h2>
        <p className="text-sm text-gray-400">This moves the group out of Needs Review and preserves it under Not Duplicate. It can be reopened later.</p>
        <label className="block text-xs text-gray-400 mb-1">Reason (required)</label>
        <select autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          {MARK_NOT_DUPLICATE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reason === "Other" && <textarea value={otherText} onChange={(e) => setOtherText(e.target.value)} rows={2} placeholder="Describe why these aren't duplicates" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button disabled={!finalReason} onClick={() => onSave(finalReason)} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">Confirm</button>
        </div>
      </div>
    </div>
  );
}

function DeferDialog({ group, onClose, onSave }) {
  const [reviewer, setReviewer] = useState(group.assignedReviewer || "");
  const [reviewDate, setReviewDate] = useState("");
  const [note, setNote] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Defer review" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-3">
        <h2 className="text-lg font-bold">Defer Review</h2>
        <p className="text-sm text-gray-400">Deferred groups are kept separate from resolved ones — deferring is not the same as resolving.</p>
        <label className="block text-xs text-gray-400">Assign reviewer</label>
        <select autoFocus value={reviewer} onChange={(e) => setReviewer(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          <option value="">Unassigned</option>
          {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <label className="block text-xs text-gray-400">Review date</label>
        <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <label className="block text-xs text-gray-400">Reason / note</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button onClick={() => onSave({ reviewer: reviewer || null, reviewDate: reviewDate || null, note })} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Defer</button>
        </div>
      </div>
    </div>
  );
}

function BulkActionDialog({ bulkAction, count, onChange, onClose, onSubmit }) {
  const containerRef = useFocusTrap(true, onClose);
  const titles = { assign: "Bulk Assign Reviewer", review: "Bulk Mark for Review", defer: "Bulk Defer", notDuplicate: "Bulk Mark Not Duplicate" };
  const canSubmit = bulkAction.type === "review" || (bulkAction.type === "assign" && bulkAction.reviewerId) || bulkAction.type === "defer" || (bulkAction.type === "notDuplicate" && bulkAction.reason);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={titles[bulkAction.type]} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">{titles[bulkAction.type]}</h2>
        <p className="text-sm text-gray-400">{count} group{count === 1 ? "" : "s"} selected. Bulk merge is never offered — merges are always reviewed one group at a time.</p>
        {bulkAction.type === "assign" && (
          <select autoFocus value={bulkAction.reviewerId || ""} onChange={(e) => onChange({ ...bulkAction, reviewerId: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Select reviewer...</option>
            {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        {bulkAction.type === "notDuplicate" && (
          <select autoFocus value={bulkAction.reason || ""} onChange={(e) => onChange({ ...bulkAction, reason: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Select a reason (required)...</option>
            {MARK_NOT_DUPLICATE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        {bulkAction.type === "defer" && (
          <>
            <select value={bulkAction.reviewer || ""} onChange={(e) => onChange({ ...bulkAction, reviewer: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">Unassigned</option>
              {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <input type="date" value={bulkAction.reviewDate || ""} onChange={(e) => onChange({ ...bulkAction, reviewDate: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button disabled={!canSubmit} onClick={onSubmit} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">Apply</button>
        </div>
      </div>
    </div>
  );
}
