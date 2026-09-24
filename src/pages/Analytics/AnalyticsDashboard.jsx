// Backend Phase 12 — warehouse-backed dashboards (overview, sales, activities,
// support, projects, finance, AI). Every figure comes from a governed metric
// with its definition, version, freshness and currency; charts have text
// summaries and table alternatives; drill-down and AI explanations respect
// the viewer's access.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, ListTree } from "lucide-react";
import * as api from "../../Helpers/backendAnalyticsClient";
import { pageRequires, useAnalyticsAccess } from "../../Helpers/analyticsAccess";
import { AnalyticsPage, Panel, ErrorBox, Loading, Empty, Modal, Badge, ChangeText, FreshnessBadge, DefinitionNote, RangeControls, ContextLine } from "./AnalyticsUi";
import { btn, useLoad, formatValue, rangeParams, rangeBody, DEFAULT_RANGE, fmtDateTime, useAllowed } from "./analyticsKit";
import { TrendChart, BarList } from "./Charts";

const TITLES = {
  overview: ["Executive Overview", "Key figures across sales, delivery, support, finance and AI — each one a governed metric you can trace to its definition."],
  sales: ["Sales Analytics", "Leads, pipeline, win rate, quotes, orders and renewals."],
  activities: ["Activity Analytics", "Activity volume, completion and overdue follow-ups."],
  support: ["Support Analytics", "Ticket volume, response and resolution times, SLA performance and backlog."],
  projects: ["Project Analytics", "Active projects, health, task delivery and logged time."],
  finance: ["Finance Analytics", "Invoicing, collections, receivables, expenses and budgets. Operational reporting — not audited financial statements."],
  ai: ["AI Analytics", "AI usage, reliability, estimated cost, governed actions and feedback."],
};

function MetricCard({ m, onDrill, onExplain, canExplain }) {
  const multi = (m.byCurrency || []).length > 1;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 min-w-0 flex flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-gray-400 flex items-center gap-1">{m.name} <DefinitionNote metric={m} /></p>
        {m.sensitivity === "sensitive" && <Badge tone="violet">Financial</Badge>}
      </div>
      <p className="text-2xl font-semibold tabular-nums truncate" title={String(m.value ?? "")}>{m.value === null && multi ? "See currencies" : formatValue(m.value, m.unit, m.currency)}</p>
      {multi && (
        <ul className="text-[11px] text-gray-400" aria-label={`${m.name} by currency`}>
          {m.byCurrency.map((c) => <li key={c.currency}>{formatValue(c.value, "currency", c.currency)}</li>)}
        </ul>
      )}
      {m.note && <p className="text-[11px] text-amber-300">{m.note}</p>}
      {m.asOf && <p className="text-[11px] text-gray-500">Current value as of {m.asOf}</p>}
      {m.snapshotDate && <p className="text-[11px] text-gray-500">Snapshot of {m.snapshotDate}</p>}
      <ChangeText metric={m} />
      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <FreshnessBadge freshness={m.freshness} />
        <div className="flex gap-1">
          {m.unit !== "percent" && <button type="button" className="text-gray-400 hover:text-white p-1" aria-label={`Show records behind ${m.name}`} onClick={() => onDrill(m)}><ListTree size={14} /></button>}
          {canExplain && <button type="button" className="text-violet-300 hover:text-violet-200 p-1" aria-label={`Explain ${m.name} with AI`} onClick={() => onExplain(m)}><Sparkles size={14} /></button>}
        </div>
      </div>
    </div>
  );
}

function DrillModal({ target, range, onClose }) {
  const { data, error, loading } = useLoad(() => api.drilldown({ metric: target.metric.key, range: rangeBody(range), ...(target.group ? { groupBy: target.groupBy, group: target.group.key } : {}) }), [target]);
  return (
    <Modal title={`Records · ${target.metric.name}${target.group ? ` · ${target.group.label}` : ""}`} onClose={onClose}>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : !data.rows.length ? <Empty>No records you can access match this figure.</Empty> : (
        <>
          <p className="text-xs text-gray-400">{data.rows.length}{data.truncated ? "+ (first 200 shown)" : ""} records within your access, {data.range.from} – {data.range.to}.</p>
          <ul className="divide-y divide-gray-800 text-sm">
            {data.rows.map((r) => (
              <li key={r.id} className="py-1.5 flex justify-between gap-2">
                <Link className="text-blue-300 underline truncate" to={data.path.includes(":id") ? data.path.replace(":id", encodeURIComponent(r.id)) : data.path}>{r.id}</Link>
                <span className="text-gray-400 text-xs whitespace-nowrap">{[r.date, r.status, r.amount ? formatValue(r.amount, "currency", r.currency) : null, r.owner].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

function ExplainModal({ metric, range, onClose }) {
  const { data, error, loading } = useLoad(() => api.explainMetric({ metric: metric.key, range: rangeBody(range), comparison: range.comparison }), [metric]);
  return (
    <Modal title={`Explain · ${metric.name}`} onClose={onClose}>
      {loading ? <Loading what="Asking AI to explain the governed figure…" /> : error ? <ErrorBox error={error} /> : (
        <div className="space-y-3">
          <p className="text-sm text-gray-200 whitespace-pre-line">{data.explanation}</p>
          <div className="flex flex-wrap gap-2">
            {data.numbersVerified ? <Badge tone="green">Numbers verified against the metric</Badge> : <Badge tone="amber">Showing the deterministic summary</Badge>}
            {data.provider?.label && <Badge tone="violet">{data.provider.label}</Badge>}
          </div>
          <dl className="text-xs text-gray-400 grid grid-cols-2 gap-x-3 gap-y-1">
            <dt>Metric</dt><dd>{data.reference.metric} v{data.reference.version}</dd>
            <dt>Value</dt><dd>{formatValue(data.reference.value, metric.unit, data.reference.currency)}</dd>
            <dt>Period</dt><dd>{data.reference.range.from} – {data.reference.range.to}</dd>
            <dt>Data loaded</dt><dd>{fmtDateTime(data.reference.freshness?.lastLoadedAt)}</dd>
          </dl>
          <p className="text-[11px] text-gray-500">{data.disclaimer}</p>
        </div>
      )}
    </Modal>
  );
}

export default function AnalyticsDashboard({ name }) {
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [drill, setDrill] = useState(null);
  const [explain, setExplain] = useState(null);
  const access = useAnalyticsAccess();
  const allowed = useAllowed(pageRequires(`/analytics/${name}`));
  const { data, error, loading, reload } = useLoad(() => api.dashboard(name, { ...rangeParams(range), comparison: range.comparison, currencyMode: range.currencyMode }), [name, range.preset, range.from, range.to, range.comparison, range.currencyMode], allowed);
  const [title, description] = TITLES[name];
  const byKey = Object.fromEntries((data?.metrics || []).map((m) => [m.key, m]));
  const trendMetric = data?.trend && byKey[data.trend.metric];
  const breakdownMetric = data?.breakdown && byKey[data.breakdown.metric];
  return (
    <AnalyticsPage title={title} description={description} requires={pageRequires(`/analytics/${name}`)}
      actions={<button type="button" className={btn} onClick={reload} disabled={loading}>Refresh</button>}>
      <RangeControls value={range} onChange={setRange} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading what="Loading governed metrics…" /> : data && (
        <>
          <ContextLine result={data} />
          {data.hiddenMetrics > 0 && <p className="text-xs text-gray-500" role="note">{data.hiddenMetrics} metric{data.hiddenMetrics > 1 ? "s are" : " is"} not shown for your role. Additional restricted information is available to authorized roles.</p>}
          {!data.metrics.length ? <Empty>No metrics on this dashboard are available to your role.</Empty> : (
            <section aria-label="Key metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {data.metrics.map((m) => <MetricCard key={m.key} m={m} onDrill={(metric) => setDrill({ metric })} onExplain={setExplain} canExplain={!!access.data?.aiFeatures} />)}
            </section>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {trendMetric && <Panel><TrendChart title={`${trendMetric.name} over time`} points={data.trend.series} unit={trendMetric.unit} currency={trendMetric.currency} grain={data.trend.grain} /></Panel>}
            {breakdownMetric && <Panel><BarList title={`${breakdownMetric.name} by ${data.breakdown.dimension.replace(/_/g, " ")}`} groups={data.breakdown.groups} unit={breakdownMetric.unit} currency={breakdownMetric.currency}
              onSelect={breakdownMetric.unit === "percent" ? undefined : (group) => setDrill({ metric: breakdownMetric, group, groupBy: data.breakdown.dimension })} /></Panel>}
          </div>
          {data.disclaimer && <p className="text-[11px] text-gray-500">{data.disclaimer}</p>}
        </>
      )}
      {drill && <DrillModal target={drill} range={range} onClose={() => setDrill(null)} />}
      {explain && <ExplainModal metric={explain} range={range} onClose={() => setExplain(null)} />}
    </AnalyticsPage>
  );
}
