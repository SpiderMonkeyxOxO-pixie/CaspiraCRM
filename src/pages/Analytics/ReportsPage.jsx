// Backend Phase 12 — saved reports: the list of reports the member can open,
// and the report viewer. A report always runs with the VIEWER's access, so a
// shared report never shows more than the viewer could query directly.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../../Helpers/backendAnalyticsClient";
import { pageRequires, useAnalyticsAccess } from "../../Helpers/analyticsAccess";
import { AnalyticsPage, Panel, ErrorBox, Loading, Empty, Modal, Badge, Table, ChangeText, FreshnessBadge, DefinitionNote, RangeControls, ContextLine } from "./AnalyticsUi";
import { btn, btnPrimary, btnDanger, input, useLoad, useAction, formatValue, rangeParams, DEFAULT_RANGE, fmtDateTime, useAllowed } from "./analyticsKit";
import { TrendChart, BarList, DataTable } from "./Charts";

const VIS_TONE = { Private: "gray", Shared: "blue", Team: "blue", Department: "blue", Organization: "green", Executive: "violet", Template: "amber" };

function ShareDialog({ report, onClose, onDone }) {
  const [kind, setKind] = useState("Role");
  const [target, setTarget] = useState("");
  const [run, busy, error] = useAction();
  const submit = (e) => { e.preventDefault(); if (!target.trim()) return; run(() => api.shareReport(report._id, { targets: [{ targetType: kind, targetId: target.trim() }] }), (out) => { onDone(out); onClose(); }); };
  return (
    <Modal title={`Share · ${report.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-gray-300">People you share with see the report's layout; the figures they see are limited to their own access.</p>
        <label className="block text-xs text-gray-400">Share with
          <select className={`${input} mt-1`} value={kind} onChange={(e) => setKind(e.target.value)}><option value="Role">A role (key, e.g. team_leader)</option><option value="Membership">A member (membership ID)</option></select>
        </label>
        <label className="block text-xs text-gray-400">{kind === "Role" ? "Role key" : "Membership ID"}<input className={`${input} mt-1`} value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        {report.shares?.length > 0 && <p className="text-xs text-gray-500">Currently shared with: {report.shares.map((s) => `${s.targetType === "Role" ? "role" : "member"} ${s.targetId}`).join(", ")}</p>}
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="submit" className={btnPrimary} disabled={busy}>Share</button></div>
      </form>
    </Modal>
  );
}

function ReportResult({ result }) {
  if (!result.metrics?.length) return <Empty>{result.note || "No metrics to show."}</Empty>;
  if (result.groupBy) {
    return (
      <div className="space-y-3">
        {result.metrics.map((m) => (
          result.visualization === "bar"
            ? <Panel key={m.key}><BarList title={`${m.name} by ${result.groupBy.replace(/_/g, " ")}`} groups={m.groups || []} unit={m.unit} currency={m.currency} /></Panel>
            : <Panel key={m.key} title={m.name}><DataTable caption={m.name} head={[result.groupBy.replace(/_/g, " "), m.name]} rows={(m.groups || []).map((g) => [g.label, formatValue(g.value, m.unit, g.currency || m.currency)])} /></Panel>
        ))}
      </div>
    );
  }
  if (result.grain) return <div className="space-y-3">{result.metrics.map((m) => <Panel key={m.key}><TrendChart title={m.name} points={m.series || []} unit={m.unit} currency={m.currency} grain={result.grain} /></Panel>)}</div>;
  return (
    <section aria-label="Report figures" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {result.metrics.map((m) => (
        <div key={m.key} className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 space-y-1">
          <p className="text-xs text-gray-400 flex items-center gap-1">{m.name} <DefinitionNote metric={m} /></p>
          <p className="text-2xl font-semibold tabular-nums">{formatValue(m.value, m.unit, m.currency)}</p>
          {m.note && <p className="text-[11px] text-amber-300">{m.note}</p>}
          <ChangeText metric={m} />
          <FreshnessBadge freshness={m.freshness} />
        </div>
      ))}
    </section>
  );
}

function ReportViewer({ id }) {
  const navigate = useNavigate();
  const access = useAnalyticsAccess();
  const [range, setRange] = useState({ ...DEFAULT_RANGE, preset: "report" });
  const [share, setShare] = useState(false);
  const allowed = useAllowed(pageRequires("/reports"));
  const report = useLoad(() => api.getReport(id), [id], allowed);
  const params = range.preset === "report" ? { comparison: range.comparison, currencyMode: range.currencyMode } : { ...rangeParams(range), comparison: range.comparison, currencyMode: range.currencyMode };
  const result = useLoad(() => api.runReport(id, params), [id, range.preset, range.from, range.to, range.comparison, range.currencyMode], allowed);
  const [run, busy, error] = useAction();
  const r = report.data;
  return (
    <AnalyticsPage section="Reports" title={r?.name || "Report"} description={r?.description} requires={pageRequires("/reports")}
      actions={r && (
        <>
          {access.can("analytics_exports", "basic") && <Link className={btn} to={`/reports/exports?report=${r._id}`}>Export…</Link>}
          {access.can("analytics_reports", "schedule") && <Link className={btn} to={`/reports/schedules?report=${r._id}`}>Schedule…</Link>}
          {access.can("analytics_reports", "create") && <button type="button" className={btn} disabled={busy} onClick={() => run(() => api.cloneReport(r._id), (c) => navigate(`/reports/builder/${c._id}`))}>Clone</button>}
          {r.canEdit && <Link className={btn} to={`/reports/builder/${r._id}`}>Edit</Link>}
          {r.canEdit && access.can("analytics_reports", "share") && <button type="button" className={btn} onClick={() => setShare(true)}>Share</button>}
          {r.canEdit && <button type="button" className={btnDanger} disabled={busy} onClick={() => run(() => api.archiveReport(r._id, !r.archived), report.reload)}>{r.archived ? "Restore" : "Archive"}</button>}
        </>
      )}>
      <ErrorBox error={report.error || error} />
      {r && <p className="text-xs text-gray-500 flex flex-wrap gap-2 items-center"><Badge tone={VIS_TONE[r.visibility]}>{r.visibility}</Badge> Version {r.version} · updated {fmtDateTime(r.updatedAt)}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-400">Period
          <select className={`${input} mt-1 w-48`} value={range.preset === "report" ? "report" : "override"} onChange={(e) => setRange((v) => ({ ...v, preset: e.target.value === "report" ? "report" : "last_30_days" }))}>
            <option value="report">Report's saved period</option><option value="override">Choose a period…</option>
          </select>
        </label>
        {range.preset !== "report" && <RangeControls value={range} onChange={setRange} />}
      </div>
      <ErrorBox error={result.error} onRetry={result.reload} />
      {result.loading && !result.data ? <Loading what="Running report…" /> : result.data && (
        <>
          <ContextLine result={result.data} />
          {result.data.hiddenMetrics > 0 && <p className="text-xs text-gray-500" role="note">{result.data.hiddenMetrics} metric(s) in this report are hidden because your role doesn't include them.</p>}
          <ReportResult result={result.data} />
          {result.data.disclaimer && <p className="text-[11px] text-gray-500">{result.data.disclaimer}</p>}
        </>
      )}
      {share && r && <ShareDialog report={r} onClose={() => setShare(false)} onDone={report.reload} />}
    </AnalyticsPage>
  );
}

function ReportList() {
  const access = useAnalyticsAccess();
  const [archived, setArchived] = useState(false);
  const allowed = useAllowed(pageRequires("/reports"));
  const { data, error, loading, reload } = useLoad(() => api.listReports(archived ? { archived: "true" } : {}), [archived], allowed);
  return (
    <AnalyticsPage section="Reports" title="Reports" description="Saved reports you can open. Figures always reflect your own access." requires={pageRequires("/reports")}
      actions={access.can("analytics_reports", "create") && <Link className={btnPrimary} to="/reports/builder">New report</Link>}>
      <label className="text-xs text-gray-400 flex items-center gap-2"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Include archived</label>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <Table rows={data?.reports || []} empty="No reports yet." columns={[
          { label: "Report", render: (r) => <Link className="text-blue-300 underline" to={`/reports/${r._id}`}>{r.name}</Link> },
          { label: "Visibility", render: (r) => <Badge tone={VIS_TONE[r.visibility]}>{r.visibility}</Badge> },
          { label: "Metrics", render: (r) => (r.definition?.metrics || []).length },
          { label: "Version", render: (r) => r.version },
          { label: "Updated", render: (r) => fmtDateTime(r.updatedAt) },
          { label: "Status", render: (r) => (r.archived ? <Badge tone="gray">Archived</Badge> : r.canEdit ? <Badge tone="blue">Yours</Badge> : "—") },
        ]} />
      )}
    </AnalyticsPage>
  );
}

export default function ReportsPage() {
  const { id } = useParams();
  return id ? <ReportViewer id={id} /> : <ReportList />;
}
