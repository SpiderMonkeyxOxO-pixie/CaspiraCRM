import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useSearchParams, Link } from "react-router-dom";
import {
  Plus, RefreshCw, Bookmark, Settings2, X, AlertCircle, Search, Trophy, XCircle, PauseCircle,
  ChevronDown, ChevronUp, SlidersHorizontal,
} from "lucide-react";
import {
  fetchDeals, changeDealStage,
  DEAL_STAGES, DEAL_STAGE_PROBABILITY, DEAL_PRIORITIES, DEAL_HEALTH_STATES, DEAL_SOURCES,
  PIPELINE_CONFIGS, findPipelineConfig,
} from "../../../redux/crm/dealsSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchActivities } from "../../../redux/crm/activitiesSlice";
import { queryDealsLocal } from "../../../Helpers/mockCrmData";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";
import useDebounced from "../../../hooks/useDebounced";
import DealFormModal from "../Deals/DealFormModal";
import { StageChangeModal } from "../Deals/StageProgress";
import { MarkWonModal, MarkLostModal, PutOnHoldModal } from "../Deals/DealOutcomeModals";
import { formatMoney, formatByCurrency, isStaleDeal, computeDealRiskReasons } from "../Deals/dealUtils";
import KanbanColumn from "./KanbanColumn";
import DealCard from "./DealCard";
import DealPreviewDrawer from "./DealPreviewDrawer";
import BoardSettingsDrawer from "./BoardSettingsDrawer";
import { SORT_OPTIONS, GROUP_OPTIONS, sortDeals, groupDeals, DEFAULT_BOARD_SETTINGS } from "./pipelineUtils";

const OPEN_STAGES = DEAL_STAGES.filter((s) => s !== "Won");
const SETTINGS_KEY = "crm.pipeline.boardSettings";
const COLLAPSED_KEY = "crm.pipeline.collapsedStages";
const SAVED_VIEWS_KEY = "crm.pipeline.savedViews";
const MANUAL_ORDER_PREFIX = "crm.pipeline.manualOrder.";

// Frontend saved-view examples per spec — seeded once; the user can still
// save/delete their own on top of these, same mechanic as Deals/Companies.
const BUILTIN_SAVED_VIEWS = [
  { name: "My Open Deals", params: { ownerId: "me" } },
  { name: "Closing This Month", params: { closingThisMonth: "true" } },
  { name: "At Risk", params: { dealHealth: "At Risk" } },
  { name: "No Next Action", params: { noNextAction: "true" } },
  { name: "High Value", params: { minValue: "50000" } },
  { name: "Team Pipeline", params: { team: "Sales" } },
];

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export default function PipelineBoard() {
  const dispatch = useDispatch();
  const { items: deals, loading, error } = useSelector((s) => s.deals);
  const companies = useSelector((s) => s.companies.items);
  const contacts = useSelector((s) => s.contacts.items);
  const activities = useSelector((s) => s.activities.items);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const debouncedSearch = useDebounced(searchInput, 350);

  const [settings, setSettings] = useState(() => ({ ...DEFAULT_BOARD_SETTINGS, ...loadJSON(SETTINGS_KEY, {}) }));
  const [collapsedStages, setCollapsedStages] = useState(() => new Set(loadJSON(COLLAPSED_KEY, [])));
  const [savedViews, setSavedViews] = useState(() => loadJSON(SAVED_VIEWS_KEY, BUILTIN_SAVED_VIEWS));
  const [showSettings, setShowSettings] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showForecast, setShowForecast] = useState(true);
  const [previewDealId, setPreviewDealId] = useState(null);
  const [addDealStage, setAddDealStage] = useState(null);
  const [pendingStageChange, setPendingStageChange] = useState(null);
  const [outcomeAction, setOutcomeAction] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [mobileStage, setMobileStage] = useState(OPEN_STAGES[0]);

  useEffect(() => {
    dispatch(fetchDeals());
    dispatch(fetchCompanies());
    dispatch(fetchContacts({ pageSize: 1000 }));
    dispatch(fetchActivities());
  }, [dispatch]);
  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedStages])); }, [collapsedStages]);

  const pipelineId = searchParams.get("pipeline") || PIPELINE_CONFIGS[0].id;
  const pipelineConfig = findPipelineConfig(pipelineId);
  const [manualOrder, setManualOrder] = useState(() => new Map(loadJSON(MANUAL_ORDER_PREFIX + pipelineConfig.id, [])));
  useEffect(() => {
    setManualOrder(new Map(loadJSON(MANUAL_ORDER_PREFIX + pipelineConfig.id, [])));
  }, [pipelineConfig.id]);
  const persistManualOrder = (nextMap) => {
    setManualOrder(nextMap);
    localStorage.setItem(MANUAL_ORDER_PREFIX + pipelineConfig.id, JSON.stringify([...nextMap.entries()]));
  };

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
  const lastActivityAt = useCallback((dealId) => {
    const list = dealActivities.get(dealId) || [];
    const done = list.filter((a) => a.completedAt);
    if (!done.length) return null;
    return done.reduce((latest, a) => (new Date(a.completedAt) > new Date(latest) ? a.completedAt : latest), done[0].completedAt);
  }, [dealActivities]);
  const nextActivityAt = useCallback((dealId) => {
    const list = dealActivities.get(dealId) || [];
    const upcoming = list.filter((a) => !["Completed", "Cancelled"].includes(a.status) && (a.dueDate || a.startAt));
    if (!upcoming.length) return null;
    return upcoming.reduce((min, a) => { const r = a.dueDate || a.startAt; return new Date(r) < new Date(min) ? r : min; }, upcoming[0].dueDate || upcoming[0].startAt);
  }, [dealActivities]);

  const nextActivityDealIds = useMemo(() => deals.filter((d) => nextActivityAt(d._id)).map((d) => d._id), [deals, nextActivityAt]);
  const staleDealIds = useMemo(() => deals.filter((d) => isStaleDeal(d, lastActivityAt(d._id))).map((d) => d._id), [deals, lastActivityAt]);

  const params = useMemo(() => {
    const p = {};
    for (const [key, value] of searchParams.entries()) p[key] = value;
    if (debouncedSearch) p.search = debouncedSearch;
    else delete p.search;
    return p;
  }, [searchParams, debouncedSearch]);

  const queryResult = useMemo(() => queryDealsLocal(deals, {
    ...params, pipeline: pipelineConfig.name, page: 1, pageSize: 100000, nextActivityDealIds, staleDealIds,
  }), [deals, params, pipelineConfig.name, nextActivityDealIds, staleDealIds]);

  const { deals: filteredDeals, total, summary } = queryResult;
  const openDeals = useMemo(() => filteredDeals.filter((d) => d.status === "Open"), [filteredDeals]);
  const activeFilterEntries = Array.from(searchParams.entries()).filter(([k]) => !["pipeline", "sort", "group"].includes(k));
  const isFiltered = activeFilterEntries.length > 0;

  const staleOpenCount = openDeals.filter((d) => staleDealIds.includes(d._id)).length;
  const avgDealSize = openDeals.length ? Math.round(openDeals.reduce((s, d) => s + (d.value || 0), 0) / openDeals.length) : 0;
  const currenciesInView = [...new Set(openDeals.map((d) => d.currency))];
  const avgCurrency = currenciesInView.length === 1 ? currenciesInView[0] : pipelineConfig.currency;

  const sortKey = searchParams.get("sort") || settings.defaultSort;
  const groupKey = searchParams.get("group") || "";

  const stageColumns = useMemo(() => OPEN_STAGES.map((stage) => {
    const stageDeals = openDeals.filter((d) => d.stage === stage);
    const sorted = sortDeals(stageDeals, sortKey, {
      manualOrder, companyById: (id) => companyById.get(id), lastActivityById: lastActivityAt,
    });
    return { stage, deals: sorted };
  }), [openDeals, sortKey, manualOrder, companyById, lastActivityAt]);

  // ---------- URL param helpers ----------
  const updateParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === null || value === "") next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  };
  const clearFilters = () => {
    setSearchInput("");
    const next = new URLSearchParams();
    next.set("pipeline", pipelineId);
    if (searchParams.get("sort")) next.set("sort", searchParams.get("sort"));
    if (searchParams.get("group")) next.set("group", searchParams.get("group"));
    setSearchParams(next);
  };
  const resetView = () => {
    setSearchInput("");
    setSearchParams({ pipeline: pipelineId });
    setSettings(DEFAULT_BOARD_SETTINGS);
    setCollapsedStages(new Set());
  };
  const removeFilter = (key) => updateParam(key, undefined);

  useEffect(() => {
    const current = searchParams.get("search") || "";
    if (debouncedSearch === current) return;
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch) next.set("search", debouncedSearch);
    else next.delete("search");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const changePipeline = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set("pipeline", id);
    setSearchParams(next);
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
    setSearchInput(view.params.search || "");
    setSearchParams({ ...view.params, pipeline: view.params.pipeline || pipelineId });
    setShowViews(false);
  };
  const deleteView = (name) => {
    const next = savedViews.filter((v) => v.name !== name);
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
  };

  const toggleCollapse = (stage) => setCollapsedStages((s) => {
    const next = new Set(s);
    if (next.has(stage)) next.delete(stage); else next.add(stage);
    return next;
  });

  // ---------- Stage change / outcome ----------
  const requestStageChange = (deal, targetStage) => setPendingStageChange({ deal, targetStage });
  const confirmStageChange = async (note) => {
    const { deal, targetStage } = pendingStageChange;
    const result = await dispatch(changeDealStage({ id: deal._id, stage: targetStage, note }));
    setPendingStageChange(null);
    if (changeDealStage.fulfilled.match(result)) dispatch(fetchActivities());
  };
  const requestOutcome = (deal, type) => setOutcomeAction({ deal, type });

  // ---------- Drag and drop ----------
  const onCardDragStart = (deal) => (e) => {
    e.dataTransfer.setData("text/plain", deal._id);
    e.dataTransfer.effectAllowed = "move";
    document.body.style.userSelect = "none";
    setDragging({ dealId: deal._id, fromStage: deal.stage });
  };
  const onCardDragEnd = () => {
    document.body.style.userSelect = "";
    setDragging(null);
    setDropTarget(null);
  };
  const handleDrop = (targetStage, dealIdFromEvent) => {
    const dealId = dealIdFromEvent || dragging?.dealId;
    setDropTarget(null);
    const deal = deals.find((d) => d._id === dealId);
    if (!deal || deal.status !== "Open") return;
    if (deal.stage === targetStage) {
      const stageDeals = openDeals.filter((d) => d.stage === targetStage && d._id !== dealId);
      const nextMap = new Map(manualOrder);
      stageDeals.forEach((d, i) => nextMap.set(d._id, i));
      nextMap.set(dealId, stageDeals.length);
      persistManualOrder(nextMap);
      return;
    }
    requestStageChange(deal, targetStage);
  };
  const onColumnDragOver = (stage) => (e) => { e.preventDefault(); setDropTarget(stage); };
  const onColumnDragLeave = () => setDropTarget(null);
  const onColumnDrop = (stage) => (e) => {
    e.preventDefault();
    handleDrop(stage, e.dataTransfer.getData("text/plain"));
  };
  const onOutcomeZoneDrop = (type) => (e) => {
    e.preventDefault();
    const dealId = e.dataTransfer.getData("text/plain") || dragging?.dealId;
    const deal = deals.find((d) => d._id === dealId);
    setDropTarget(null);
    if (deal && deal.status === "Open") requestOutcome(deal, type);
  };

  // ---------- Keyboard move ----------
  const moveByKeyboard = (deal, direction) => {
    const idx = OPEN_STAGES.indexOf(deal.stage);
    const target = OPEN_STAGES[idx + direction];
    if (target) requestStageChange(deal, target);
  };

  const refresh = () => { dispatch(fetchDeals()); dispatch(fetchActivities()); };

  const previewDeal = previewDealId ? deals.find((d) => d._id === previewDealId) : null;

  // ---------- Add Deal ----------
  const handleAddDealSaved = () => { dispatch(fetchDeals()); setAddDealStage(null); };

  const renderCard = (deal) => (
    <DealCard
      key={deal._id}
      deal={deal}
      company={companyById.get(deal.companyId)}
      primaryContact={contactById.get(deal.primaryContactId)}
      lastActivityAt={lastActivityAt(deal._id)}
      riskReasons={settings.warningIndicators ? computeDealRiskReasons(deal, { lastActivityAt: lastActivityAt(deal._id) }) : []}
      density={settings.density}
      visibleFields={settings.visibleFields}
      draggable
      isDragging={dragging?.dealId === deal._id}
      onDragStart={onCardDragStart(deal)}
      onDragEnd={onCardDragEnd}
      onOpenPreview={(d) => setPreviewDealId(d._id)}
      onKeyMove={(dir) => moveByKeyboard(deal, dir)}
      onMoveStage={(stage) => requestStageChange(deal, stage)}
      onQuickOutcome={(type) => requestOutcome(deal, type)}
    />
  );

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/crm/dashboard" className="hover:text-gray-300">CRM</Link> / <span className="text-gray-300">Pipeline</span>
      </nav>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold">Sales Pipeline</h1>
          <p className="text-sm text-gray-400 mt-1">
            {total} deal{total === 1 ? "" : "s"} visible · Open {formatByCurrency(summary.openValueByCurrency)} · Weighted {formatByCurrency(summary.weightedValueByCurrency)}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={refresh} title="Refresh" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><RefreshCw size={16} /> Refresh</button>
          <div className="relative">
            <button onClick={() => setShowViews((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Bookmark size={16} /> Views</button>
            {showViews && (
              <div className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg p-2 z-30 w-56 shadow-xl">
                <button onClick={saveCurrentView} className="w-full text-left text-sm px-2 py-1.5 hover:bg-gray-800 rounded">+ Save current filters as view</button>
                <div className="border-t border-gray-800 my-1" />
                {savedViews.map((v) => (
                  <div key={v.name} className="flex items-center justify-between px-2 py-1.5 hover:bg-gray-800 rounded text-sm">
                    <button onClick={() => applyView(v)} className="text-left flex-1">{v.name}</button>
                    <button onClick={() => deleteView(v.name)} aria-label={`Delete view ${v.name}`}><X size={14} className="text-gray-500 hover:text-red-400" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setShowSettings(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Settings2 size={16} /> Board Settings</button>
          <button onClick={() => setAddDealStage(OPEN_STAGES[0])} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium text-white"><Plus size={16} /> Add Deal</button>
        </div>
      </div>

      {/* Pipeline selector */}
      <div className="flex items-center gap-1 mb-4 flex-wrap" role="tablist" aria-label="Pipeline selector">
        {PIPELINE_CONFIGS.filter((p) => p.visible).map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === pipelineConfig.id} onClick={() => changePipeline(p.id)}
            title={p.description}
            className={`px-3 py-1.5 rounded-lg text-sm border ${p.id === pipelineConfig.id ? "bg-blue-700 border-blue-600" : "border-gray-700 hover:bg-gray-800 text-gray-300"}`}>
            {p.name}
          </button>
        ))}
      </div>

      {/* Compact metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <button onClick={clearFilters} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Open Pipeline</p>
          <p className="text-lg font-bold truncate" title={formatByCurrency(summary.openValueByCurrency)}>{formatByCurrency(summary.openValueByCurrency)}</p>
        </button>
        <button onClick={clearFilters} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
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
        <button onClick={() => applyCardFilter("staleActivity", "true")} className="bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 text-left">
          <p className="text-xs text-gray-400 uppercase mb-1">Stale Deals</p>
          <p className={`text-xl font-bold ${staleOpenCount > 0 ? "text-amber-400" : ""}`}>{staleOpenCount}</p>
        </button>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
          <p className="text-xs text-gray-400 uppercase mb-1">Avg Deal Size</p>
          <p className="text-lg font-bold truncate">{openDeals.length ? formatMoney(avgDealSize, avgCurrency) : "—"}</p>
        </div>
      </div>

      {/* Toolbar / filters */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative flex-1 min-w-55 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search deal, company or contact..."
            aria-label="Search pipeline deals" className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
        </div>
        <select value={searchParams.get("ownerId") || ""} onChange={(e) => updateParam("ownerId", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by owner">
          <option value="">All Owners</option>
          <option value="me">Me</option>
          <option value="unassigned">Unassigned</option>
          {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={searchParams.get("team") || ""} onChange={(e) => updateParam("team", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by team">
          <option value="">All Teams</option>
          {["Sales", "Support", "Marketing"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={searchParams.get("dealHealth") || ""} onChange={(e) => updateParam("dealHealth", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by deal health">
          <option value="">All Health States</option>
          {DEAL_HEALTH_STATES.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <select value={searchParams.get("priority") || ""} onChange={(e) => updateParam("priority", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Filter by priority">
          <option value="">All Priorities</option>
          {DEAL_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={sortKey} onChange={(e) => updateParam("sort", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Sort deals within each stage">
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
        </select>
        <select value={groupKey} onChange={(e) => updateParam("group", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm" aria-label="Group deals within each stage">
          {GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value ? `Group: ${o.label}` : o.label}</option>)}
        </select>

        <div className="relative">
          <button onClick={() => setShowMoreFilters((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
            <SlidersHorizontal size={16} /> More Filters
          </button>
          {showMoreFilters && (
            <div className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg p-3 z-30 w-72 shadow-xl space-y-3">
              <div>
                <label htmlFor="pl-source" className="block text-xs mb-1 text-gray-400">Source</label>
                <select id="pl-source" value={searchParams.get("source") || ""} onChange={(e) => updateParam("source", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">All Sources</option>
                  {DEAL_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="pl-minvalue" className="block text-xs mb-1 text-gray-400">Min Value</label>
                  <input id="pl-minvalue" type="number" min="0" value={searchParams.get("minValue") || ""} onChange={(e) => updateParam("minValue", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label htmlFor="pl-maxvalue" className="block text-xs mb-1 text-gray-400">Max Value</label>
                  <input id="pl-maxvalue" type="number" min="0" value={searchParams.get("maxValue") || ""} onChange={(e) => updateParam("maxValue", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="pl-closeafter" className="block text-xs mb-1 text-gray-400">Closing After</label>
                  <input id="pl-closeafter" type="date" value={searchParams.get("closingAfter") || ""} onChange={(e) => updateParam("closingAfter", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label htmlFor="pl-closebefore" className="block text-xs mb-1 text-gray-400">Closing Before</label>
                  <input id="pl-closebefore" type="date" value={searchParams.get("closingBefore") || ""} onChange={(e) => updateParam("closingBefore", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={searchParams.get("closingOverdue") === "true"} onChange={(e) => updateParam("closingOverdue", e.target.checked ? "true" : "")} />
                Overdue closing
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={searchParams.get("noNextAction") === "true"} onChange={(e) => updateParam("noNextAction", e.target.checked ? "true" : "")} />
                No next action
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={searchParams.get("staleActivity") === "true"} onChange={(e) => updateParam("staleActivity", e.target.checked ? "true" : "")} />
                Stale activity
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={searchParams.get("hasProducts") === "true"} onChange={(e) => updateParam("hasProducts", e.target.checked ? "true" : "")} />
                Has product or service
              </label>
              <div>
                <label htmlFor="pl-tag" className="block text-xs mb-1 text-gray-400">Tag</label>
                <input id="pl-tag" value={searchParams.get("tag") || ""} onChange={(e) => updateParam("tag", e.target.value)} placeholder="e.g. strategic" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
              </div>
            </div>
          )}
        </div>
        <button onClick={resetView} className="text-xs text-gray-400 hover:text-white underline decoration-dotted">Reset view</button>
      </div>

      {isFiltered && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-gray-500">{total} result{total === 1 ? "" : "s"}</span>
          {activeFilterEntries.map(([key, value]) => (
            <span key={key} className="flex items-center gap-1.5 bg-gray-800/70 border border-gray-700 rounded-full pl-2.5 pr-1.5 py-1 text-xs text-gray-200">
              {key}: {value === "true" ? "Yes" : value}
              <button onClick={() => removeFilter(key)} aria-label={`Clear ${key} filter`} className="hover:text-white"><X size={12} /></button>
            </span>
          ))}
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white ml-1"><X size={12} /> Clear all filters</button>
        </div>
      )}

      {/* Won / Lost / On Hold outcome zones — deliberately not ordinary columns */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div onDragOver={(e) => { e.preventDefault(); setDropTarget("won-zone"); }} onDragLeave={() => setDropTarget(null)} onDrop={onOutcomeZoneDrop("won")}
          className={`rounded-xl border p-3 flex items-center justify-between ${dropTarget === "won-zone" ? "border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-900/10" : "border-gray-800 bg-gray-900/40"}`}>
          <span className="flex items-center gap-2 text-sm font-medium text-emerald-300"><Trophy size={16} /> Won</span>
          <span className="text-xs text-gray-500">Drop or use a card's menu</span>
        </div>
        <div onDragOver={(e) => { e.preventDefault(); setDropTarget("lost-zone"); }} onDragLeave={() => setDropTarget(null)} onDrop={onOutcomeZoneDrop("lost")}
          className={`rounded-xl border p-3 flex items-center justify-between ${dropTarget === "lost-zone" ? "border-red-500 ring-2 ring-red-500/30 bg-red-900/10" : "border-gray-800 bg-gray-900/40"}`}>
          <span className="flex items-center gap-2 text-sm font-medium text-red-300"><XCircle size={16} /> Lost</span>
          <span className="text-xs text-gray-500">Drop or use a card's menu</span>
        </div>
        <div onDragOver={(e) => { e.preventDefault(); setDropTarget("hold-zone"); }} onDragLeave={() => setDropTarget(null)} onDrop={onOutcomeZoneDrop("hold")}
          className={`rounded-xl border p-3 flex items-center justify-between ${dropTarget === "hold-zone" ? "border-orange-500 ring-2 ring-orange-500/30 bg-orange-900/10" : "border-gray-800 bg-gray-900/40"}`}>
          <span className="flex items-center gap-2 text-sm font-medium text-orange-300"><PauseCircle size={16} /> On Hold</span>
          <span className="text-xs text-gray-500">Drop or use a card's menu</span>
        </div>
      </div>

      {/* Board */}
      {loading ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {OPEN_STAGES.map((s) => (
            <div key={s} className="shrink-0 w-72 h-64 bg-gray-900/40 border border-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-10 text-center text-gray-400 bg-gray-900/40 border border-gray-800 rounded-xl">
          <AlertCircle className="mx-auto mb-2 text-red-400" size={28} />
          <p className="mb-1 text-gray-200">Couldn't load the pipeline</p>
          <p className="mb-3 text-sm">{error}</p>
          <button onClick={refresh} className="text-blue-400 hover:underline text-sm">Retry</button>
        </div>
      ) : total === 0 && !isFiltered ? (
        <div className="p-12 text-center text-gray-400 bg-gray-900/40 border border-gray-800 rounded-xl">
          <p className="mb-1">No deals in this pipeline yet.</p>
          <button onClick={() => setAddDealStage(OPEN_STAGES[0])} className="text-blue-400 hover:underline text-sm">Add Deal</button>
        </div>
      ) : openDeals.length === 0 && isFiltered ? (
        <div className="p-12 text-center text-gray-400 bg-gray-900/40 border border-gray-800 rounded-xl">
          <p className="mb-1">No deals match the current filters.</p>
          <button onClick={clearFilters} className="text-blue-400 hover:underline text-sm">Clear Filters</button>
        </div>
      ) : (
        <>
          {/* Desktop/tablet Kanban */}
          <div className="hidden md:flex gap-3 overflow-x-auto pb-2">
            {stageColumns.filter(({ stage }) => !(settings.hideCollapsedStages && collapsedStages.has(stage))).map(({ stage, deals: stageDeals }) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                deals={stageDeals}
                currency={pipelineConfig.currency}
                collapsed={collapsedStages.has(stage)}
                onToggleCollapse={() => toggleCollapse(stage)}
                onAddDeal={() => setAddDealStage(stage)}
                wipLimit={pipelineConfig.wipLimits?.[stage]}
                onDragOver={onColumnDragOver(stage)}
                onDragLeave={onColumnDragLeave}
                onDrop={onColumnDrop(stage)}
                isDropTarget={dropTarget === stage}
                showWeighted={settings.showWeighted}
                showTotals={settings.showTotals}
                renderBody={(bodyDeals) => {
                  const groups = groupKey ? groupDeals(bodyDeals, groupKey) : [{ key: null, label: null, deals: bodyDeals }];
                  return groups.map((g) => (
                    <div key={g.key || "all"}>
                      {g.label && <p className="text-[10px] uppercase text-gray-500 px-1 pt-1 pb-0.5">{g.label} ({g.deals.length})</p>}
                      <div className="space-y-2">{g.deals.map((d) => renderCard(d))}</div>
                    </div>
                  ));
                }}
              />
            ))}
          </div>

          {/* Mobile: stage tabs + single list + Move Stage action (via card menu) */}
          <div className="md:hidden">
            <div className="flex gap-1 overflow-x-auto pb-2 mb-2" role="tablist" aria-label="Stage tabs">
              {OPEN_STAGES.map((stage) => {
                const count = stageColumns.find((c) => c.stage === stage)?.deals.length || 0;
                return (
                  <button key={stage} role="tab" aria-selected={mobileStage === stage} onClick={() => setMobileStage(stage)}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-sm border whitespace-nowrap ${mobileStage === stage ? "bg-blue-700 border-blue-600 text-white" : "border-gray-700 text-gray-300"}`}>
                    {stage} ({count})
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-400">{DEAL_STAGE_PROBABILITY[mobileStage]}% probability</p>
              <button onClick={() => setAddDealStage(mobileStage)} className="text-xs text-blue-400 hover:underline">+ Add Deal</button>
            </div>
            <div className="space-y-2">
              {(stageColumns.find((c) => c.stage === mobileStage)?.deals || []).length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">No deals in {mobileStage}</p>
              ) : (
                stageColumns.find((c) => c.stage === mobileStage).deals.map((d) => (
                  <DealCard
                    key={d._id} deal={d} company={companyById.get(d.companyId)} primaryContact={contactById.get(d.primaryContactId)}
                    lastActivityAt={lastActivityAt(d._id)}
                    riskReasons={settings.warningIndicators ? computeDealRiskReasons(d, { lastActivityAt: lastActivityAt(d._id) }) : []}
                    density={settings.density} visibleFields={settings.visibleFields}
                    draggable={false}
                    onOpenPreview={(deal) => setPreviewDealId(deal._id)}
                    onMoveStage={(stage) => requestStageChange(d, stage)}
                    onQuickOutcome={(type) => requestOutcome(d, type)}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Forecast summary */}
      <div className="mt-5 bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
        <button onClick={() => setShowForecast((v) => !v)} className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium">
          Forecast Summary
          {showForecast ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showForecast && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-left border-t border-gray-800"><tr>
                <th className="px-4 py-2 font-medium">Stage</th><th className="px-4 py-2 font-medium text-right">Deals</th>
                <th className="px-4 py-2 font-medium text-right">Total Value</th><th className="px-4 py-2 font-medium text-right">Weighted Value</th>
                <th className="px-4 py-2 font-medium text-right">Expected Close (30d)</th>
              </tr></thead>
              <tbody>
                {stageColumns.map(({ stage, deals: stageDeals }) => {
                  const totalValue = stageDeals.reduce((s, d) => s + (d.value || 0), 0);
                  const weightedValue = stageDeals.reduce((s, d) => s + (d.weightedValue || 0), 0);
                  const soon = new Date(Date.now() + 30 * 86400000);
                  const closingSoon = stageDeals.filter((d) => d.expectedClosingDate && new Date(d.expectedClosingDate) <= soon).reduce((s, d) => s + (d.value || 0), 0);
                  return (
                    <tr key={stage} className="border-t border-gray-800">
                      <td className="px-4 py-2">{stage}</td>
                      <td className="px-4 py-2 text-right text-gray-300">{stageDeals.length}</td>
                      <td className="px-4 py-2 text-right text-gray-300">{formatMoney(totalValue, pipelineConfig.currency)}</td>
                      <td className="px-4 py-2 text-right text-gray-300">{formatMoney(weightedValue, pipelineConfig.currency)}</td>
                      <td className="px-4 py-2 text-right text-gray-300">{formatMoney(closingSoon, pipelineConfig.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals / drawers */}
      {addDealStage && (
        <DealFormModal
          prefill={{ pipeline: pipelineConfig.name, stage: addDealStage }}
          onClose={() => setAddDealStage(null)}
          onSaved={handleAddDealSaved}
        />
      )}
      {pendingStageChange && (
        <StageChangeModal
          deal={pendingStageChange.deal}
          companyName={companyById.get(pendingStageChange.deal.companyId)?.name}
          targetStage={pendingStageChange.targetStage}
          onClose={() => setPendingStageChange(null)}
          onConfirm={confirmStageChange}
        />
      )}
      {outcomeAction?.type === "won" && (
        <MarkWonModal deal={outcomeAction.deal} primaryContact={contactById.get(outcomeAction.deal.primaryContactId)} onClose={() => setOutcomeAction(null)} onDone={refresh} />
      )}
      {outcomeAction?.type === "lost" && <MarkLostModal deal={outcomeAction.deal} onClose={() => setOutcomeAction(null)} onDone={refresh} />}
      {outcomeAction?.type === "hold" && <PutOnHoldModal deal={outcomeAction.deal} onClose={() => setOutcomeAction(null)} onDone={refresh} />}
      {previewDeal && (
        <DealPreviewDrawer
          deal={previewDeal}
          company={companyById.get(previewDeal.companyId)}
          primaryContact={contactById.get(previewDeal.primaryContactId)}
          activities={dealActivities.get(previewDeal._id) || []}
          onClose={() => setPreviewDealId(null)}
          onChanged={refresh}
        />
      )}
      {showSettings && <BoardSettingsDrawer settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
