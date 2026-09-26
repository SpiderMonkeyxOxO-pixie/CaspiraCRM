import { useEffect, useMemo, useState, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useSearchParams, Link } from "react-router-dom";
import {
  Sparkles, Info, RefreshCw, XCircle, AlertTriangle, ChevronDown, ChevronUp,
  ShieldOff, Undo2, History, LayoutList, Columns3, FileDown,
} from "lucide-react";
import {
  generateAnalysis, cancelGeneration, dismissInsight, restoreInsight, setFeedback,
  recordActionApplied, markActionUndone, selectIsAnalysisStale, GENERATION_STAGES,
  fetchAiProviderStatus, enhanceNarrative,
} from "../../redux/ai/aiSlice";
import { updateDeal } from "../../redux/crm/dealsSlice";
import { updateContract } from "../../redux/sales/contractsSlice";
import { computeCompactMetrics } from "./aiInsightEngine";
import { downloadOverviewPdf } from "./aiPdfExport";
import { createAnalysisRequest, AI_PROVIDER_STATUS } from "./aiTypes";
import { AI_VIEWS, defaultViewForRole, canExecuteActions, canAccessAiOverview } from "./aiConfig";
import { hasAnyAiProvidersCapability } from "../Admin/aiProvidersConfig";
import AiFilterBar from "./components/AiFilterBar";
import AiInsightCard from "./components/AiInsightCard";
import AiKanbanBoard from "./components/AiKanbanBoard";
import AiEvidenceDrawer from "./components/AiEvidenceDrawer";
import AiActionPreviewModal from "./components/AiActionPreviewModal";
import ActivityFormModal from "../CRM/Activities/ActivityFormModal";
import DealFormModal from "../CRM/Deals/DealFormModal";

const SECTIONS = [
  { id: "risks", title: "Critical Risks", filter: (i) => ["sales", "contracts"].includes(i.module) && ["Critical", "High"].includes(i.priority) },
  { id: "opportunities", title: "Opportunities", filter: (i) => i.type.includes("opp") || ["renewal_eligible", "repeat_win_companies", "dormant_company_prior_revenue", "qualified_leads_without_deals", "active_companies_without_deals", "lead_pipeline_overview"].includes(i.type) },
  { id: "actions", title: "Recommended Actions", isActionsSection: true },
  { id: "dataQuality", title: "Data Quality", filter: (i) => i.module === "data-quality" },
  { id: "other", title: "Other Findings", filter: (i) => !["sales", "contracts", "data-quality"].includes(i.module) || (i.module === "sales" && !["Critical", "High"].includes(i.priority) && !i.type.includes("opp")) },
];

function buildRequest(role, params) {
  const view = params.get("view") || defaultViewForRole(role);
  const viewConfig = AI_VIEWS.find((v) => v.id === view) || AI_VIEWS[0];
  return {
    key: `${role}|${view}|${params.get("range") || "thisMonth"}|${params.get("owner") || ""}`,
    request: createAnalysisRequest({
      userId: "u1", role, scope: params.get("owner") ? "mine" : viewConfig.defaultScope,
      team: params.get("owner") || null,
      dateRange: { preset: params.get("range") || "thisMonth" },
    }),
    view,
  };
}

export default function AiOverview() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const ai = useSelector((s) => s.ai);
  const isStale = useSelector(selectIsAnalysisStale);
  const [params, setParams] = useSearchParams();

  const [evidenceInsight, setEvidenceInsight] = useState(null);
  const [actionModal, setActionModal] = useState(null); // { insight, action }
  const [formModal, setFormModal] = useState(null); // { type: "activity"|"deal", prefill }
  const [collapsed, setCollapsed] = useState({});
  const previousIdsRef = useRef(null);
  const [recentChanges, setRecentChanges] = useState([]);

  useEffect(() => {
    if (!params.get("view")) {
      const next = new URLSearchParams(params);
      next.set("view", defaultViewForRole(role));
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => {
    dispatch(fetchAiProviderStatus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key); else next.set(key, value);
    setParams(next);
  };

  const { key: requestKey, request, view } = useMemo(() => buildRequest(role, params), [role, params]);
  const lastRequestKey = ai.request ? `${ai.request.role}|${params.get("view")}|${ai.request.dateRange.preset}|${ai.request.team || ""}` : null;
  const filtersChangedSinceGeneration = ai.response && requestKey !== lastRequestKey;

  const allowed = canAccessAiOverview(role);
  const canExecute = canExecuteActions(role);

  const handleGenerate = () => {
    dispatch(generateAnalysis(request));
  };

  useEffect(() => {
    if (ai.response) {
      const newIds = new Set(ai.response.insights.map((i) => i.id));
      if (previousIdsRef.current) {
        const resolved = [...previousIdsRef.current].filter((id) => !newIds.has(id));
        const added = [...newIds].filter((id) => !previousIdsRef.current.has(id));
        if (resolved.length || added.length) {
          setRecentChanges([
            ...resolved.map((id) => ({ id: `resolved-${id}`, text: `An insight was resolved since the last analysis (no longer detected).` })),
            ...added.map((id) => ({ id: `added-${id}`, text: `A new insight was detected: ${ai.response.insights.find((i) => i.id === id)?.title || id}.` })),
          ]);
        }
      }
      previousIdsRef.current = newIds;
    }
  }, [ai.response]);

  const filteredInsights = useMemo(() => {
    if (!ai.response) return [];
    const status = params.get("status") || "active";
    const severity = params.get("severity") || "all";
    const confidence = params.get("confidence") || "all";
    const module = params.get("module") || "all";
    return ai.response.insights.filter((i) => {
      const dismissed = ai.dismissedIds.includes(i.id);
      if (status === "active" && dismissed) return false;
      if (status === "dismissed" && !dismissed) return false;
      if (severity !== "all" && i.priority !== severity) return false;
      if (confidence !== "all" && i.confidence.level !== confidence) return false;
      if (module !== "all" && i.module !== module) return false;
      return true;
    });
  }, [ai.response, ai.dismissedIds, params]);

  const metrics = ai.response ? computeCompactMetrics(ai.response) : null;
  const displayMode = params.get("display") === "kanban" ? "kanban" : "list";

  const toggleSection = (id) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleDownloadPdf = () => {
    if (!ai.response) return;
    downloadOverviewPdf({
      response: ai.response,
      metrics,
      insights: filteredInsights,
      viewLabel: AI_VIEWS.find((v) => v.id === view)?.label || view,
      role,
    });
  };

  const hasConfiguredProvider = ai.providers.list.some((p) => p.configured);
  const handleEnhanceNarrative = () => dispatch(enhanceNarrative());

  const handleApplyAction = (entry) => {
    dispatch(recordActionApplied(entry));
  };

  const handleUndo = (entry) => {
    if (entry.undo?.type === "updateDeal") {
      dispatch(updateDeal({ id: entry.undo.recordId, changes: entry.undo.previousValues }));
    } else if (entry.undo?.type === "updateContract") {
      dispatch(updateContract({ id: entry.undo.recordId, changes: entry.undo.previousValues }));
    }
    dispatch(markActionUndone(entry.id));
  };

  if (!allowed) {
    return (
      <div className="p-8 text-white">
        <div className="max-w-lg mx-auto text-center py-16">
          <ShieldOff className="h-10 w-10 text-gray-600 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">AI Intelligence is restricted</h1>
          <p className="text-sm text-gray-400">Your current role does not have permission to preview AI analysis. Contact your administrator if you believe this is incorrect.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 text-white min-h-[calc(100vh-49px)]">
      <nav aria-label="Breadcrumb" className="text-xs text-gray-500 mb-2">AI Intelligence / Overview</nav>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold">AI Intelligence Overview</h1>
        <div className="flex items-center gap-2">
          {ai.status === "ready" && ai.response && (
            <button
              onClick={handleDownloadPdf}
              title="Download this analysis as a print-ready PDF"
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-1 text-xs font-medium text-gray-300 hover:bg-gray-800"
            >
              <FileDown className="h-3.5 w-3.5" /> Download PDF
            </button>
          )}
          <span data-tour="ai-source"
            className="flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300 cursor-help"
            title="Insights are worked out in your browser by built-in rules from the CRM and Sales records you can see. Nothing is sent to an AI provider."
          >
            <Sparkles className="h-3.5 w-3.5" /> {AI_PROVIDER_STATUS} <Info className="h-3 w-3" />
          </span>
        </div>
      </div>
      <p className="text-sm text-gray-400 mb-6">
        Advisory, evidence-based analysis over your current CRM and Sales data. Every recommendation requires human review before anything changes.
      </p>

      {hasAnyAiProvidersCapability(role) && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3 text-sm text-gray-300 mb-6">
          <Sparkles className="h-4 w-4 shrink-0 text-blue-400" />
          <span className="flex-1">
            The AI Provider Control Center manages provider connections, model routing, privacy and evaluation
            policy. It doesn't affect this page, which uses built-in rules.
          </span>
          <Link to="/admin/integrations/ai-providers" className="underline font-medium text-blue-300">Open Control Center</Link>
        </div>
      )}

      <AiFilterBar params={Object.fromEntries(params)} updateParam={updateParam} />

      {isStale && ai.status === "ready" && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300 mb-6">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">Shared CRM/Sales data changed since this analysis was generated.</span>
          <button onClick={handleGenerate} className="underline font-medium">Regenerate</button>
        </div>
      )}
      {filtersChangedSinceGeneration && !isStale && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-300 mb-6">
          <Info className="h-4 w-4 shrink-0" />
          <span className="flex-1">View, date range or owner changed — regenerate to apply the new scope.</span>
          <button onClick={handleGenerate} className="underline font-medium">Regenerate</button>
        </div>
      )}

      {ai.status === "idle" && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-10 text-center">
          <Sparkles className="h-8 w-8 text-blue-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold mb-1">No analysis generated yet</h2>
          <p className="text-sm text-gray-400 mb-1">Scope: {AI_VIEWS.find((v) => v.id === view)?.label}</p>
          <p className="text-xs text-gray-500 mb-6">Available modules: Sales, Activities, Data Quality, Contracts. Support, Projects and Finance are not yet included.</p>
          <button data-tour="ai-generate" onClick={handleGenerate} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-2.5 text-sm font-medium text-white hover:from-blue-500 hover:to-blue-400">
            <Sparkles className="h-4 w-4" /> Generate Analysis
          </button>
        </div>
      )}

      {ai.status === "generating" && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-10 text-center" role="status" aria-live="polite">
          <ul className="max-w-xs mx-auto text-left space-y-2 mb-6">
            {GENERATION_STAGES.map((stage) => {
              const stageIndex = GENERATION_STAGES.findIndex((s) => s.id === stage.id);
              const currentIndex = GENERATION_STAGES.findIndex((s) => s.id === ai.stage);
              const done = currentIndex > stageIndex || (currentIndex === -1 && ai.status === "generating" && stageIndex < 0);
              const active = ai.stage === stage.id;
              return (
                <li key={stage.id} className={`text-sm flex items-center gap-2 ${active ? "text-white font-medium" : done ? "text-emerald-400" : "text-gray-600"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-blue-400 animate-pulse" : done ? "bg-emerald-400" : "bg-gray-700"}`} />
                  {stage.label}
                </li>
              );
            })}
          </ul>
          <button onClick={() => dispatch(cancelGeneration())} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-white/5">
            <XCircle className="h-4 w-4" /> Cancel
          </button>
        </div>
      )}

      {ai.status === "error" && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-300 mb-4">{ai.error}</p>
          <button onClick={handleGenerate} className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-200 hover:bg-red-500/10">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      )}

      {ai.status === "ready" && ai.response && (
        <>
          {ai.response.dataDate.recordCount === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-10 text-center">
              <h2 className="text-lg font-semibold mb-1">No authorized records match this scope</h2>
              <p className="text-sm text-gray-400">Try Executive Intelligence, a wider date range, or check with an administrator about your access.</p>
            </div>
          ) : (
            <>
              <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 mb-6">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Executive Summary</h2>
                <p className="text-sm text-gray-200 leading-relaxed">
                  {ai.narrative.status === "ready" ? ai.narrative.text : ai.response.executiveSummary}
                </p>
                {ai.narrative.status === "ready" && (
                  <p className="text-xs text-indigo-300/80 mt-2">
                    Narrative written by {ai.narrative.provider.label} ({ai.narrative.provider.model}) — all figures above are unchanged from the deterministic analysis.
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-3">
                  Data as of {new Date(ai.response.dataDate.generatedAt).toLocaleString()} · {ai.response.dataDate.recordCount} records considered
                </p>

                {hasConfiguredProvider && ai.narrative.status !== "ready" && (
                  <div className="mt-3">
                    {ai.narrative.status === "loading" ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                        <Sparkles className="h-3.5 w-3.5 animate-pulse" /> Writing a live narrative…
                      </span>
                    ) : (
                      <button
                        onClick={handleEnhanceNarrative}
                        title="Ask a real AI provider to rewrite this summary as better prose — every figure is verified against the analysis above before it's shown; if verification fails, this summary stays as-is."
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-500/20"
                      >
                        <Sparkles className="h-3.5 w-3.5" /> Enhance with Live AI
                      </button>
                    )}
                    {ai.narrative.status === "error" && (
                      <p className="text-xs text-amber-300 mt-2">{ai.narrative.error}</p>
                    )}
                  </div>
                )}
              </section>

              {metrics && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                  {[
                    { label: "Critical Risks", value: metrics.criticalRisks, onClick: () => updateParam("severity", "Critical") },
                    { label: "Opportunities", value: metrics.opportunities, onClick: () => updateParam("severity", "all") },
                    { label: "Suggested Actions", value: metrics.suggestedActions, onClick: () => {} },
                    { label: "Records Needing Attention", value: metrics.recordsNeedingAttention, onClick: () => {} },
                    { label: "Data Quality Issues", value: metrics.dataQualityIssues, onClick: () => updateParam("module", "data-quality") },
                    { label: "High Confidence", value: metrics.highConfidenceShare !== null ? `${metrics.highConfidenceShare}%` : "—", onClick: () => updateParam("confidence", "High Confidence") },
                  ].map((m) => (
                    <button key={m.label} onClick={m.onClick} className="text-left bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl p-3 transition-colors">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{m.label}</p>
                      <p className="text-xl font-bold">{m.value}</p>
                    </button>
                  ))}
                </div>
              )}

              {recentChanges.length > 0 && (
                <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 mb-6">
                  <h2 className="flex items-center gap-2 text-sm font-semibold mb-2"><History className="h-4 w-4 text-gray-400" /> Recent Changes</h2>
                  <ul className="text-xs text-gray-400 space-y-1">
                    {recentChanges.map((c) => <li key={c.id}>{c.text}</li>)}
                  </ul>
                </section>
              )}

              {ai.actionHistory.filter((a) => !a.undone && a.undo).length > 0 && (
                <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 mb-6">
                  <h2 className="text-sm font-semibold mb-2">Recent AI Actions (this session)</h2>
                  <ul className="space-y-2">
                    {ai.actionHistory.filter((a) => a.undo).slice(0, 5).map((a) => (
                      <li key={a.id} className="flex items-center justify-between text-xs text-gray-400">
                        <span className={a.undone ? "line-through text-gray-600" : ""}>{a.summary}</span>
                        {!a.undone && (
                          <button onClick={() => handleUndo(a)} className="flex items-center gap-1 text-blue-400 hover:underline shrink-0 ml-3">
                            <Undo2 className="h-3 w-3" /> Undo
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-300">Insights</h2>
                <div role="tablist" aria-label="Insight display" className="flex gap-1 bg-gray-900/60 border border-gray-800 rounded-lg p-1">
                  <button
                    role="tab"
                    aria-selected={displayMode === "list"}
                    onClick={() => updateParam("display", null)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${displayMode === "list" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200"}`}
                  >
                    <LayoutList className="h-3.5 w-3.5" /> List
                  </button>
                  <button
                    role="tab"
                    aria-selected={displayMode === "kanban"}
                    onClick={() => updateParam("display", "kanban")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${displayMode === "kanban" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200"}`}
                  >
                    <Columns3 className="h-3.5 w-3.5" /> Kanban
                  </button>
                </div>
              </div>

              {filteredInsights.length === 0 ? (
                <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-10 text-center mb-6">
                  <h2 className="text-lg font-semibold mb-1">No issues detected in this view</h2>
                  <p className="text-sm text-gray-400">This reflects the records you can see and the filters above — it is not a guarantee that everything is fine.</p>
                </div>
              ) : displayMode === "kanban" ? (
                <div className="mb-6">
                  <AiKanbanBoard
                    insights={filteredInsights}
                    dismissedIds={ai.dismissedIds}
                    feedbackByInsightId={ai.feedbackByInsightId}
                    canExecuteActions={canExecute}
                    onOpenEvidence={setEvidenceInsight}
                    onOpenAction={(i, a) => setActionModal({ insight: i, action: a })}
                    onFeedback={(id, feedback) => dispatch(setFeedback({ insightId: id, feedback }))}
                    onDismiss={(id) => dispatch(dismissInsight(id))}
                    onRestore={(id) => dispatch(restoreInsight(id))}
                  />
                </div>
              ) : (
                SECTIONS.map((section) => {
                  if (section.isActionsSection) {
                    const actions = filteredInsights.flatMap((i) => i.suggestedActions.map((a) => ({ insight: i, action: a })));
                    if (actions.length === 0) return null;
                    const isCollapsed = collapsed[section.id];
                    return (
                      <section key={section.id} className="mb-6">
                        <button onClick={() => toggleSection(section.id)} className="flex items-center gap-2 mb-3 text-sm font-semibold w-full text-left">
                          {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                          {section.title} <span className="text-gray-500 font-normal">({actions.length})</span>
                        </button>
                        {!isCollapsed && (
                          <div className="grid sm:grid-cols-2 gap-3">
                            {actions.map(({ insight, action }) => (
                              <button
                                key={action.id}
                                onClick={() => setActionModal({ insight, action })}
                                className="text-left rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 hover:bg-blue-500/10 transition-colors"
                              >
                                <p className="text-sm font-medium text-white mb-1">{action.label}</p>
                                <p className="text-xs text-gray-400">{action.reason}</p>
                              </button>
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  }
                  const sectionInsights = filteredInsights.filter(section.filter);
                  if (sectionInsights.length === 0) return null;
                  const isCollapsed = collapsed[section.id];
                  return (
                    <section key={section.id} className="mb-6">
                      <button onClick={() => toggleSection(section.id)} className="flex items-center gap-2 mb-3 text-sm font-semibold w-full text-left">
                        {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                        {section.title} <span className="text-gray-500 font-normal">({sectionInsights.length})</span>
                      </button>
                      {!isCollapsed && (
                        <div className="grid gap-4">
                          {sectionInsights.map((insight) => (
                            <AiInsightCard
                              key={insight.id}
                              insight={insight}
                              dismissed={ai.dismissedIds.includes(insight.id)}
                              feedback={ai.feedbackByInsightId[insight.id]}
                              canExecuteActions={canExecute}
                              onOpenEvidence={setEvidenceInsight}
                              onOpenAction={(i, a) => setActionModal({ insight: i, action: a })}
                              onFeedback={(id, feedback) => dispatch(setFeedback({ insightId: id, feedback }))}
                              onDismiss={(id) => dispatch(dismissInsight(id))}
                              onRestore={(id) => dispatch(restoreInsight(id))}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })
              )}

              <section className="rounded-2xl border border-gray-800 bg-gray-900/20 p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Analysis Limitations</h2>
                <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
                  {ai.response.limitations.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </section>
            </>
          )}
        </>
      )}

      <AiEvidenceDrawer insight={evidenceInsight} dataFreshness={ai.response?.dataDate} onClose={() => setEvidenceInsight(null)} />
      {actionModal && (
        <AiActionPreviewModal
          insight={actionModal.insight}
          action={actionModal.action}
          canExecute={canExecute}
          onClose={() => setActionModal(null)}
          onApplied={handleApplyAction}
          onOpenForm={(type, prefill) => setFormModal({ type, prefill })}
        />
      )}
      {formModal?.type === "activity" && (
        <ActivityFormModal prefill={formModal.prefill} onClose={() => setFormModal(null)} onSaved={() => setFormModal(null)} />
      )}
      {formModal?.type === "deal" && (
        <DealFormModal prefill={formModal.prefill} onClose={() => setFormModal(null)} onSaved={() => setFormModal(null)} />
      )}

      {ai.status === "ready" && (
        <div className="fixed bottom-6 right-6 flex gap-2">
          <Link to="/crm/dashboard" className="hidden" aria-hidden="true" />
          <button onClick={handleGenerate} className="flex items-center gap-2 rounded-full bg-gray-900 border border-gray-700 px-4 py-2.5 text-sm shadow-lg hover:bg-gray-800">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      )}
    </div>
  );
}
