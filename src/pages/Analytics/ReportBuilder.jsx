// Backend Phase 12 — report builder. Reports are assembled from governed
// metrics, the dimensions those metrics allow, a period, comparison, currency
// and visualization — never SQL. Preview runs the same governed query with the
// author's access; saving creates a new report version.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "../../Helpers/backendAnalyticsClient";
import { pageRequires, useAnalyticsAccess } from "../../Helpers/analyticsAccess";
import { AnalyticsPage, Panel, ErrorBox, Loading, Empty, ContextLine } from "./AnalyticsUi";
import { btn, btnPrimary, input, useLoad, useAction, formatValue, RANGE_PRESETS, useAllowed } from "./analyticsKit";
import { DataTable } from "./Charts";

const MODULE_LABEL = { analytics_sales: "Sales", analytics_activities: "Activities", analytics_support: "Support", analytics_projects: "Projects", analytics_finance: "Finance", analytics_ai: "AI" };
const VISIBILITY = [["Private", "Private — only me"], ["Team", "My team"], ["Department", "My department"], ["Organization", "Everyone with organization report access"], ["Executive", "Executive"], ["Template", "Template for report authors"]];
const EMPTY = { name: "", description: "", visibility: "Private", metrics: [], groupBy: "", grain: "", preset: "last_30_days", from: "", to: "", comparison: "previous_period", currencyMode: "base", visualization: "table" };

function toDefinition(f) {
  return {
    metrics: f.metrics, groupBy: f.groupBy || null, grain: f.grain || null,
    range: f.preset === "custom" ? { from: f.from, to: f.to } : f.preset, comparison: f.comparison, currencyMode: f.currencyMode, visualization: f.visualization,
  };
}

export default function ReportBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const access = useAnalyticsAccess();
  const allowed = useAllowed(pageRequires("/reports/builder"));
  const catalog = useLoad(() => api.listMetrics(), [], allowed);
  const existing = useLoad(() => (id ? api.getReport(id) : Promise.resolve(null)), [id], allowed);
  const [form, setForm] = useState(EMPTY);
  const [preview, setPreview] = useState(null);
  const [run, busy, error, setError] = useAction();

  useEffect(() => {
    const r = existing.data;
    if (!r) return;
    const d = r.definition || {};
    const custom = d.range && typeof d.range === "object";
    setForm({ name: r.name, description: r.description || "", visibility: r.visibility, metrics: d.metrics || [], groupBy: d.groupBy || "", grain: d.grain || "", preset: custom ? "custom" : d.range || "last_30_days", from: custom ? d.range.from : "", to: custom ? d.range.to : "", comparison: d.comparison || "previous_period", currencyMode: d.currencyMode || "base", visualization: d.visualization || "table" });
  }, [existing.data]);

  const metrics = useMemo(() => (catalog.data?.metrics || []).filter((m) => m.accessible && m.status === "Published"), [catalog.data]);
  const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));
  // Dimensions every selected metric supports.
  const dims = useMemo(() => {
    const sel = form.metrics.map((k) => byKey[k]).filter(Boolean);
    if (!sel.length) return [];
    return sel.reduce((acc, m) => acc.filter((d) => (m.dimensions || []).includes(d)), sel[0].dimensions || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.metrics, catalog.data]);
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setPreview(null); };
  const toggleMetric = (k) => set({ metrics: form.metrics.includes(k) ? form.metrics.filter((x) => x !== k) : [...form.metrics, k].slice(0, 20) });
  useEffect(() => { if (form.groupBy && !dims.includes(form.groupBy)) setForm((f) => ({ ...f, groupBy: "" })); }, [dims, form.groupBy]);

  const doPreview = () => {
    if (!form.metrics.length) { setError("Choose at least one metric."); return; }
    const d = toDefinition(form);
    run(() => api.query({ metrics: d.metrics, groupBy: d.groupBy, grain: d.grain, range: d.range, comparison: d.comparison, currencyMode: d.currencyMode, limit: 50 }), setPreview);
  };
  const save = (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("Give the report a name."); return; }
    if (!form.metrics.length) { setError("Choose at least one metric."); return; }
    const body = { name: form.name.trim(), description: form.description, visibility: form.visibility, definition: toDefinition(form) };
    run(() => (id ? api.updateReport(id, { ...body, version: existing.data?.version }) : api.createReport(body)), (r) => navigate(`/reports/${r._id}`));
  };
  const grouped = Object.entries(metrics.reduce((acc, m) => { (acc[m.module] ||= []).push(m); return acc; }, {}));
  const canShare = access.can("analytics_reports", "share");

  return (
    <AnalyticsPage section="Reports" title={id ? "Edit report" : "New report"} description="Build a report from governed metrics. Figures are always limited to each viewer's own access." requires={pageRequires("/reports/builder")}>
      {catalog.loading || existing.loading ? <Loading /> : (
        <form onSubmit={save} className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-1 space-y-4">
            <Panel title="Details">
              <div className="space-y-3">
                <label className="block text-xs text-gray-400">Name<input className={`${input} mt-1`} value={form.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} required /></label>
                <label className="block text-xs text-gray-400">Description<textarea className={`${input} mt-1 min-h-[4rem]`} value={form.description} onChange={(e) => set({ description: e.target.value })} /></label>
                <label className="block text-xs text-gray-400">Who can open it
                  <select className={`${input} mt-1`} value={form.visibility} onChange={(e) => set({ visibility: e.target.value })}>
                    {VISIBILITY.filter(([v]) => v === "Private" || canShare).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                {!canShare && <p className="text-[11px] text-gray-500">Your role can save private reports only.</p>}
              </div>
            </Panel>
            <Panel title="Layout">
              <div className="space-y-3">
                <label className="block text-xs text-gray-400">Group by
                  <select className={`${input} mt-1`} value={form.groupBy} onChange={(e) => set({ groupBy: e.target.value, grain: e.target.value ? "" : form.grain })} disabled={!dims.length}>
                    <option value="">No grouping</option>{dims.map((d) => <option key={d} value={d}>{d.replace(/_/g, " ")}</option>)}
                  </select>
                </label>
                <label className="block text-xs text-gray-400">Over time
                  <select className={`${input} mt-1`} value={form.grain} onChange={(e) => set({ grain: e.target.value, groupBy: e.target.value ? "" : form.groupBy })}>
                    <option value="">Totals only</option><option value="day">By day</option><option value="week">By week</option><option value="month">By month</option><option value="quarter">By quarter</option><option value="year">By year</option>
                  </select>
                </label>
                <label className="block text-xs text-gray-400">Period
                  <select className={`${input} mt-1`} value={form.preset} onChange={(e) => set({ preset: e.target.value })}>{RANGE_PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </label>
                {form.preset === "custom" && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-gray-400">From<input type="date" className={`${input} mt-1`} value={form.from} onChange={(e) => set({ from: e.target.value })} /></label>
                    <label className="text-xs text-gray-400">To<input type="date" className={`${input} mt-1`} value={form.to} onChange={(e) => set({ to: e.target.value })} /></label>
                  </div>
                )}
                <label className="block text-xs text-gray-400">Compare with
                  <select className={`${input} mt-1`} value={form.comparison} onChange={(e) => set({ comparison: e.target.value })}><option value="previous_period">Previous period</option><option value="previous_year">Same period last year</option><option value="none">No comparison</option></select>
                </label>
                <label className="block text-xs text-gray-400">Currency
                  <select className={`${input} mt-1`} value={form.currencyMode} onChange={(e) => set({ currencyMode: e.target.value })}><option value="base">Base currency</option><option value="original">Original currencies</option></select>
                </label>
                <label className="block text-xs text-gray-400">Show as
                  <select className={`${input} mt-1`} value={form.visualization} onChange={(e) => set({ visualization: e.target.value })}><option value="table">Table</option><option value="bar">Bar chart</option><option value="line">Line chart</option><option value="kpi">Key figures</option></select>
                </label>
              </div>
            </Panel>
          </div>
          <div className="xl:col-span-2 space-y-4">
            <Panel title={`Metrics (${form.metrics.length} selected)`}>
              {!grouped.length ? <Empty>No published metrics are available to your role.</Empty> : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {grouped.map(([module, list]) => (
                    <fieldset key={module} className="space-y-1">
                      <legend className="text-xs font-semibold text-gray-300 mb-1">{MODULE_LABEL[module] || module}</legend>
                      {list.map((m) => (
                        <label key={m.key} className="flex items-start gap-2 text-sm text-gray-300">
                          <input type="checkbox" className="mt-1" checked={form.metrics.includes(m.key)} onChange={() => toggleMetric(m.key)} />
                          <span>{m.name}<span className="block text-[11px] text-gray-500">{m.definition?.definition}</span></span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                </div>
              )}
            </Panel>
            <ErrorBox error={error || existing.error || catalog.error} />
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" className={btn} onClick={doPreview} disabled={busy}>Preview</button>
              <button type="submit" className={btnPrimary} disabled={busy}>{id ? "Save new version" : "Save report"}</button>
            </div>
            {preview && (
              <Panel title="Preview (your access)">
                <ContextLine result={preview} />
                <div className="space-y-3 mt-2">
                  {preview.metrics.map((m) => (
                    <DataTable key={m.key} caption={m.name}
                      head={preview.groupBy ? [preview.groupBy.replace(/_/g, " "), m.name] : preview.grain ? ["Period", m.name] : ["Metric", "Value"]}
                      rows={preview.groupBy ? (m.groups || []).map((g) => [g.label, formatValue(g.value, m.unit, g.currency || m.currency)]) : preview.grain ? (m.series || []).map((p) => [p.period, formatValue(p.value, m.unit, p.currency || m.currency)]) : [[m.name, formatValue(m.value, m.unit, m.currency)]]} />
                  ))}
                </div>
              </Panel>
            )}
          </div>
        </form>
      )}
    </AnalyticsPage>
  );
}
