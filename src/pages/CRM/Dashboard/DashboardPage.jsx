import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useSearchParams, Link } from "react-router-dom";
import {
  RefreshCw, Plus, SlidersHorizontal, Settings2, AlertCircle, X, ChevronDown,
  UserPlus, Building2, Handshake, CalendarPlus,
} from "lucide-react";
import { fetchAllMatchingLeads } from "../../../redux/crm/leadsSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchDeals, PIPELINE_CONFIGS, findPipelineConfig } from "../../../redux/crm/dealsSlice";
import { fetchActivities } from "../../../redux/crm/activitiesSlice";
import { fetchTickets } from "../../../redux/support/ticketsSlice";
import { fetchInvoices } from "../../../redux/finance/invoicesSlice";
import { CRM_TEAM, CURRENT_MOCK_OWNER_ID } from "../../../Helpers/mockUsersData";
import KpiCard from "./KpiCard";
import { SalesFunnel, PipelineByStageChart } from "./PipelineCharts";
import LeadSourcePerformance from "./LeadSourcePerformance";
import ForecastSection from "./ForecastSection";
import ActivitiesPanel from "./ActivitiesPanel";
import { AtRiskDealsTable, CompaniesNeedingAttention } from "./AttentionTables";
import RecentActivityTimeline from "./RecentActivityTimeline";
import TeamPerformanceTable from "./TeamPerformanceTable";
import DashboardSettingsDrawer from "./DashboardSettingsDrawer";
import { DASHBOARD_VIEWS, defaultViewForRole, DEFAULT_DASHBOARD_SETTINGS } from "./dashboardConfig";
import {
  resolveDateRange, previousPeriod, compareToPrevious, DATE_PRESETS, LEAD_SOURCES,
  filterLeads, filterDeals, filterActivities,
  computeNewLeads, computeLeadConversion, computeLeadSourcePerformance,
  computeOpenPipeline, computeWeightedPipeline, computeWonDeals, computeAvgDealSize,
  computeAtRiskAndStaleDeals, computePipelineStageTotals, computeSalesFunnel, computeForecastBuckets,
  computeActivitiesDueToday, computeOverdueActivities, computeUpcomingActivities, computeRecentlyCompletedActivities,
  computeCompaniesNeedingAttention, computeTeamPerformance, computeRecentCrmTimeline,
} from "./dashboardSelectors";
import { formatByCurrency } from "../Deals/dealUtils";
import LeadFormModal from "../Leads/LeadFormModal";
import ContactFormModal from "../Contacts/ContactFormModal";
import CompanyFormModal from "../Companies/CompanyFormModal";
import DealFormModal from "../Deals/DealFormModal";
import ActivityFormModal from "../Activities/ActivityFormModal";

export default function DashboardPage() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const companies = useSelector((s) => s.companies.items);
  const contacts = useSelector((s) => s.contacts.items);
  const deals = useSelector((s) => s.deals.items);
  const activities = useSelector((s) => s.activities.items);
  const tickets = useSelector((s) => s.tickets.items);
  const invoices = useSelector((s) => s.invoices.items);

  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickCreateModal, setQuickCreateModal] = useState(null); // "lead" | "contact" | "company" | "deal" | "activity"
  const [settings, setSettings] = useState(DEFAULT_DASHBOARD_SETTINGS);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [leadsResult] = await Promise.all([
        dispatch(fetchAllMatchingLeads({})).unwrap(),
        dispatch(fetchContacts({ pageSize: 1000 })),
        dispatch(fetchCompanies()),
        dispatch(fetchDeals()),
        dispatch(fetchActivities()),
        dispatch(fetchTickets()),
        dispatch(fetchInvoices()),
      ]);
      setLeads(leadsResult || []);
      setLastRefreshed(new Date());
    } catch {
      setError("Couldn't load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Default view from role, applied once (URL/user choice always wins after).
  useEffect(() => {
    if (!searchParams.get("view")) {
      const next = new URLSearchParams(searchParams);
      next.set("view", defaultViewForRole(role));
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const viewId = searchParams.get("view") || defaultViewForRole(role);
  const view = DASHBOARD_VIEWS.find((v) => v.id === viewId) || DASHBOARD_VIEWS[0];

  const rangePreset = searchParams.get("range") || settings.defaultRange;
  const range = useMemo(() => resolveDateRange(rangePreset, searchParams.get("from"), searchParams.get("to")), [rangePreset, searchParams]);
  const prevRange = useMemo(() => previousPeriod(range), [range]);

  const pipelineId = searchParams.get("pipeline") || "";
  const pipelineConfig = pipelineId ? findPipelineConfig(pipelineId) : null;
  const ownerId = searchParams.get("owner") || (view.defaultScope === "mine" ? "me" : "");
  const team = searchParams.get("team") || "";
  const source = searchParams.get("source") || "";
  const companyId = searchParams.get("company") || "";
  const currencyFilter = searchParams.get("currency") || "";

  const globalFilters = useMemo(() => ({
    pipeline: pipelineConfig?.name, ownerId, team, source, companyId, currency: currencyFilter, currentOwnerId: CURRENT_MOCK_OWNER_ID,
  }), [pipelineConfig, ownerId, team, source, companyId, currencyFilter]);

  const companyById = useMemo(() => new Map(companies.map((c) => [c._id, c])), [companies]);

  const dealActivities = useMemo(() => {
    const map = new Map();
    for (const a of activities) {
      if (a.relatedRecordType !== "Deal" || !a.relatedRecordId) continue;
      if (!map.has(a.relatedRecordId)) map.set(a.relatedRecordId, []);
      map.get(a.relatedRecordId).push(a);
    }
    return map;
  }, [activities]);
  const companyActivityLog = useMemo(() => {
    const map = new Map();
    for (const c of companies) map.set(c._id, c.activity || []);
    return map;
  }, [companies]);
  const dealLastActivityAt = useCallback((dealId) => {
    const list = dealActivities.get(dealId) || [];
    const done = list.filter((a) => a.completedAt);
    if (!done.length) return null;
    return done.reduce((latest, a) => (new Date(a.completedAt) > new Date(latest) ? a.completedAt : latest), done[0].completedAt);
  }, [dealActivities]);
  const companyLastActivityAt = useCallback((companyId2) => {
    const log = companyActivityLog.get(companyId2) || [];
    if (!log.length) return null;
    return log.reduce((latest, e) => (new Date(e.at) > new Date(latest) ? e.at : latest), log[0].at);
  }, [companyActivityLog]);

  const filteredLeads = useMemo(() => filterLeads(leads, globalFilters), [leads, globalFilters]);
  const filteredDeals = useMemo(() => filterDeals(deals, globalFilters), [deals, globalFilters]);
  const filteredActivities = useMemo(() => filterActivities(activities, globalFilters), [activities, globalFilters]);

  // ---------------- KPIs ----------------
  const newLeadsCurrent = computeNewLeads(filteredLeads, range);
  const newLeadsPrev = computeNewLeads(filteredLeads, prevRange);
  const conversionCurrent = computeLeadConversion(filteredLeads, range);
  const conversionPrev = computeLeadConversion(filteredLeads, prevRange);
  const openPipeline = computeOpenPipeline(filteredDeals);
  const weightedPipeline = computeWeightedPipeline(filteredDeals);
  const wonCurrent = computeWonDeals(filteredDeals, range);
  const wonPrev = computeWonDeals(filteredDeals, prevRange);
  const overdueActivities = computeOverdueActivities(filteredActivities);
  const avgDealSize = computeAvgDealSize(filteredDeals);

  // ---------------- Charts / tables ----------------
  const funnelSteps = computeSalesFunnel(filteredLeads, filteredDeals, range);
  const stageTotals = computePipelineStageTotals(filteredDeals);
  const leadSources = computeLeadSourcePerformance(filteredLeads, filteredDeals);
  const forecastBuckets = computeForecastBuckets(filteredDeals);
  const atRiskItems = computeAtRiskAndStaleDeals(filteredDeals, dealLastActivityAt).map((x) => ({ ...x, company: companyById.get(x.deal.companyId) }));
  const companiesAttention = computeCompaniesNeedingAttention(companies, tickets, invoices, companyLastActivityAt);
  const teamPerformance = computeTeamPerformance(CRM_TEAM, filteredLeads, filteredDeals, filteredActivities, range);
  const recentTimeline = computeRecentCrmTimeline(filteredLeads, contacts, companies, filteredDeals, filteredActivities, 15);

  const activityBuckets = {
    dueToday: computeActivitiesDueToday(filteredActivities),
    overdue: overdueActivities,
    upcoming: computeUpcomingActivities(filteredActivities),
    completed: computeRecentlyCompletedActivities(filteredActivities),
  };

  // Display currency for single-currency visuals (chart) — the explicit
  // filter wins; otherwise fall back to the most common currency in view.
  const displayCurrency = useMemo(() => {
    if (currencyFilter) return currencyFilter;
    const counts = {};
    for (const d of filteredDeals) counts[d.currency] = (counts[d.currency] || 0) + 1;
    const entries = Object.entries(counts);
    return entries.length ? entries.sort((a, b) => b[1] - a[1])[0][0] : "USD";
  }, [currencyFilter, filteredDeals]);
  const currenciesInView = [...new Set(filteredDeals.map((d) => d.currency))];

  // ---------------- Filter helpers ----------------
  const updateParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === null || value === "") next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  };
  const clearFilters = () => {
    const next = new URLSearchParams();
    next.set("view", viewId);
    setSearchParams(next);
  };
  const activeFilterEntries = Array.from(searchParams.entries()).filter(([k]) => !["view", "range", "from", "to"].includes(k));
  const isFiltered = activeFilterEntries.length > 0;

  const dataExists = leads.length > 0 || deals.length > 0 || activities.length > 0;

  const FilterControls = (
    <>
      <div>
        <label htmlFor="dash-pipeline" className="block text-xs mb-1 text-gray-400">Pipeline</label>
        <select id="dash-pipeline" value={pipelineId} onChange={(e) => updateParam("pipeline", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All Pipelines</option>
          {PIPELINE_CONFIGS.filter((p) => p.visible).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="dash-owner" className="block text-xs mb-1 text-gray-400">Owner</label>
        <select id="dash-owner" value={ownerId} onChange={(e) => updateParam("owner", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All Owners</option>
          <option value="me">Me</option>
          <option value="unassigned">Unassigned</option>
          {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="dash-team" className="block text-xs mb-1 text-gray-400">Team</label>
        <select id="dash-team" value={team} onChange={(e) => updateParam("team", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All Teams</option>
          {["Sales", "Support", "Marketing"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="dash-source" className="block text-xs mb-1 text-gray-400">Lead Source</label>
        <select id="dash-source" value={source} onChange={(e) => updateParam("source", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All Sources</option>
          {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="dash-company" className="block text-xs mb-1 text-gray-400">Company</label>
        <select id="dash-company" value={companyId} onChange={(e) => updateParam("company", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All Companies</option>
          {companies.slice(0, 200).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="dash-currency" className="block text-xs mb-1 text-gray-400" title="Restricts totals to one currency instead of grouping by currency">Currency</label>
        <select id="dash-currency" value={currencyFilter} onChange={(e) => updateParam("currency", e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All Currencies (grouped)</option>
          {["USD", "EUR", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </>
  );

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <span className="text-gray-300">CRM</span> / <span className="text-gray-300">Dashboard</span>
      </nav>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold">CRM Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">Leads, Pipeline, Activities and account health at a glance — {range.label}.</p>
          <p className="text-[11px] text-gray-500 mt-1">
            {lastRefreshed ? `Frontend data refreshed ${lastRefreshed.toLocaleTimeString()}` : "Loading..."}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={loadAll} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><RefreshCw size={16} /> Refresh</button>
          <button onClick={() => setShowMobileFilters(true)} className="md:hidden flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><SlidersHorizontal size={16} /> Filters</button>
          <button data-tour="dash-customize" onClick={() => setShowSettings(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Settings2 size={16} /> Customize</button>
          <div className="relative">
            <button data-tour="dash-create" onClick={() => setShowQuickCreate((v) => !v)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium text-white">
              <Plus size={16} /> Quick Create <ChevronDown size={14} />
            </button>
            {showQuickCreate && (
              <div className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-30 w-48 shadow-xl">
                {[
                  { key: "lead", label: "Add Lead", icon: UserPlus },
                  { key: "contact", label: "Add Contact", icon: UserPlus },
                  { key: "company", label: "Add Company", icon: Building2 },
                  { key: "deal", label: "Add Deal", icon: Handshake },
                  { key: "activity", label: "Create Activity", icon: CalendarPlus },
                ].map((item) => (
                  <button key={item.key} onClick={() => { setQuickCreateModal(item.key); setShowQuickCreate(false); }} className="w-full flex items-center gap-2 text-left text-sm px-3 py-1.5 hover:bg-gray-800">
                    <item.icon size={14} /> {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* View selector + date range */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1" role="tablist" aria-label="Dashboard view" data-tour="dash-views">
          {DASHBOARD_VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={v.id === viewId} onClick={() => updateParam("view", v.id)} title={v.description}
              className={`px-3 py-1.5 rounded-lg text-sm border ${v.id === viewId ? "bg-blue-700 border-blue-600 text-white" : "border-gray-700 hover:bg-gray-800 text-gray-300"}`}>
              {v.label}
            </button>
          ))}
        </div>
        <label htmlFor="dash-range" className="sr-only">Date range</label>
        <select data-tour="dash-range" id="dash-range" value={rangePreset} onChange={(e) => updateParam("range", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm ml-auto">
          {DATE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {/* Desktop filters */}
      <div className="hidden md:grid grid-cols-3 lg:grid-cols-6 gap-2 mb-3">{FilterControls}</div>

      {isFiltered && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {activeFilterEntries.map(([key, value]) => (
            <span key={key} className="flex items-center gap-1.5 bg-gray-800/70 border border-gray-700 rounded-full pl-2.5 pr-1.5 py-1 text-xs text-gray-200">
              {key}: {value}
              <button onClick={() => updateParam(key, undefined)} aria-label={`Clear ${key} filter`} className="hover:text-white"><X size={12} /></button>
            </span>
          ))}
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white ml-1"><X size={12} /> Clear all filters</button>
        </div>
      )}

      {currencyFilter === "" && currenciesInView.length > 1 && (
        <p className="text-[11px] text-amber-300/80 mb-3">Deals span {currenciesInView.join(", ")} — totals below are grouped by currency, not combined. Use the Currency filter to see one currency only.</p>
      )}

      {loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <div className="p-10 text-center text-gray-400 bg-gray-900/40 border border-gray-800 rounded-xl">
          <AlertCircle className="mx-auto mb-2 text-red-400" size={28} />
          <p className="mb-1 text-gray-200">Couldn't load the dashboard</p>
          <p className="mb-3 text-sm">{error}</p>
          <button onClick={loadAll} className="text-blue-400 hover:underline text-sm">Retry</button>
        </div>
      ) : !dataExists ? (
        <div className="p-12 text-center text-gray-400 bg-gray-900/40 border border-gray-800 rounded-xl">
          <p className="mb-1 text-gray-200">CRM metrics appear once Leads, Deals and Activities exist.</p>
          <p className="text-sm text-gray-500 mb-4">Nothing has been created in this session yet.</p>
          <div className="flex justify-center gap-4">
            <button onClick={() => setQuickCreateModal("lead")} className="text-blue-400 hover:underline text-sm">Add Lead</button>
            <button onClick={() => setQuickCreateModal("deal")} className="text-blue-400 hover:underline text-sm">Add Deal</button>
            <button onClick={() => setQuickCreateModal("activity")} className="text-blue-400 hover:underline text-sm">Create Activity</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-tour="dash-kpis">
            <KpiCard label="New Leads" value={newLeadsCurrent.count} context={range.label} to="/crm/leads?status=New"
              tooltip="Leads created within the active date range." comparison={compareToPrevious(newLeadsCurrent.count, newLeadsPrev.count)} />
            <KpiCard label="Lead Conversion Rate" value={conversionCurrent.rate === null ? "—" : `${conversionCurrent.rate}%`} context={`${conversionCurrent.convertedCount} of ${conversionCurrent.eligibleCount} eligible`}
              to="/crm/leads?status=Converted" tooltip="Converted Leads ÷ Eligible Leads (created in range, excluding Duplicate/Spam) × 100."
              comparison={conversionPrev.rate === null || conversionCurrent.rate === null ? null : compareToPrevious(conversionCurrent.rate, conversionPrev.rate)} />
            <KpiCard label="Open Pipeline" value={formatByCurrency(openPipeline.valueByCurrency)} context={`${openPipeline.count} open deals`} to="/crm/deals?status=Open"
              tooltip="Total value of Deals in open stages — excludes Won, Lost, Cancelled and Archived." comparison={null} />
            <KpiCard label="Weighted Pipeline" value={formatByCurrency(weightedPipeline.valueByCurrency)} context="Value × stage probability" to="/crm/pipeline"
              tooltip="Sum of Deal value × stage probability across open Deals." comparison={null} />
            <KpiCard label="Deals Won" value={wonCurrent.count} context={`${formatByCurrency(wonCurrent.valueByCurrency)} · ${range.label}`} to="/crm/deals?status=Won"
              tooltip="Count and value of Deals marked Won within the active date range." comparison={compareToPrevious(wonCurrent.count, wonPrev.count)} valueClassName="text-emerald-400" />
            <KpiCard label="Overdue Activities" value={overdueActivities.length} context="Past their due date" to="/crm/activities?status=Overdue"
              tooltip="Open scheduled Activities whose due date is earlier than the current time." comparison={null} valueClassName={overdueActivities.length > 0 ? "text-red-400" : ""} />
          </div>

          {avgDealSize && Object.keys(avgDealSize).length > 0 && (
            <p className="text-xs text-gray-500">Average open deal size: {formatByCurrency(avgDealSize)}</p>
          )}

          {/* Funnel + Pipeline by stage */}
          <div className="grid lg:grid-cols-2 gap-4">
            <SalesFunnel steps={funnelSteps} />
            <PipelineByStageChart stageTotals={stageTotals} currency={displayCurrency} />
          </div>

          <div data-tour="dash-activities"><ActivitiesPanel buckets={activityBuckets} allActivities={activities} /></div>
          <AtRiskDealsTable items={atRiskItems} />

          {/* Optional widgets — user-orderable and hideable via Customize */}
          {settings.widgetOrder
            .filter((key) => key !== "teamPerformance" || view.showTeamPerformance)
            .filter((key) => !settings.hiddenWidgets.includes(key))
            .map((key) => {
              if (key === "leadSource") return <LeadSourcePerformance key={key} sources={leadSources} />;
              if (key === "forecast") return <ForecastSection key={key} buckets={forecastBuckets} />;
              if (key === "companiesAttention") return <CompaniesNeedingAttention key={key} items={companiesAttention} />;
              if (key === "recentActivity") return <RecentActivityTimeline key={key} events={recentTimeline} />;
              if (key === "teamPerformance") return <TeamPerformanceTable key={key} rows={teamPerformance} />;
              return null;
            })}
        </div>
      )}

      {/* Mobile filters drawer */}
      {showMobileFilters && (
        <div className="fixed inset-0 z-50 flex justify-end md:hidden" role="presentation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowMobileFilters(false)} />
          <div role="dialog" aria-modal="true" aria-label="Dashboard filters" className="relative w-full max-w-xs h-full bg-gray-900 border-l border-gray-800 overflow-y-auto p-5 space-y-3">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-base font-bold">Filters</h2>
              <button onClick={() => setShowMobileFilters(false)} aria-label="Close filters"><X size={20} /></button>
            </div>
            {FilterControls}
            <button onClick={() => setShowMobileFilters(false)} className="w-full mt-3 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Apply</button>
          </div>
        </div>
      )}

      {showSettings && <DashboardSettingsDrawer settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}

      {quickCreateModal === "lead" && <LeadFormModal onClose={() => setQuickCreateModal(null)} onSaved={loadAll} />}
      {quickCreateModal === "contact" && <ContactFormModal onClose={() => setQuickCreateModal(null)} onSaved={loadAll} />}
      {quickCreateModal === "company" && <CompanyFormModal onClose={() => setQuickCreateModal(null)} onSaved={loadAll} />}
      {quickCreateModal === "deal" && <DealFormModal onClose={() => setQuickCreateModal(null)} onSaved={loadAll} />}
      {quickCreateModal === "activity" && <ActivityFormModal onClose={() => setQuickCreateModal(null)} onSaved={loadAll} />}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 bg-gray-900/40 border border-gray-800 rounded-xl animate-pulse" />)}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="h-64 bg-gray-900/40 border border-gray-800 rounded-xl animate-pulse" />
        <div className="h-64 bg-gray-900/40 border border-gray-800 rounded-xl animate-pulse" />
      </div>
      <div className="h-48 bg-gray-900/40 border border-gray-800 rounded-xl animate-pulse" />
    </div>
  );
}
