// Backend Phase 12 — data warehouse monitoring: per-source watermarks and
// freshness, reconciliation results, data-quality issues (aggregate counts
// only) and load jobs, with manual refresh, retry and a guarded rebuild.
import { useState } from "react";
import * as api from "../../Helpers/backendAnalyticsClient";
import { pageRequires, useAnalyticsAccess } from "../../Helpers/analyticsAccess";
import { AnalyticsPage, Panel, ErrorBox, Loading, Modal, Badge, Table } from "./AnalyticsUi";
import { btn, btnPrimary, btnDanger, input, useLoad, useAction, fmtDateTime, useAllowed } from "./analyticsKit";

const JOB_TONE = { Completed: "green", "Completed with warnings": "amber", Failed: "red", "Dead letter": "red", Queued: "blue", Extracting: "blue", Transforming: "blue", Loading: "blue", Validating: "blue", Reconciling: "blue", Cancelled: "gray" };
const SEV_TONE = { High: "red", Warning: "amber", Low: "gray" };

function RebuildDialog({ sources, onClose, onDone }) {
  const [source, setSource] = useState(sources[0]);
  const [confirm, setConfirm] = useState("");
  const [run, busy, error] = useAction();
  return (
    <Modal title="Rebuild a warehouse source" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); run(() => api.startWarehouseJob({ source, jobType: "rebuild", confirm }), () => { onDone(); onClose(); }); }} className="space-y-3">
        <p className="text-sm text-amber-300">A rebuild deletes this source's warehouse rows and reloads them. Dashboards show partial data until it finishes.</p>
        <label className="block text-xs text-gray-400">Source<select className={`${input} mt-1`} value={source} onChange={(e) => setSource(e.target.value)}>{sources.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="block text-xs text-gray-400">Type <code>REBUILD {source}</code> to confirm<input className={`${input} mt-1`} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="submit" className={btnDanger} disabled={busy || confirm !== `REBUILD ${source}`}>Rebuild</button></div>
      </form>
    </Modal>
  );
}

export default function WarehousePage() {
  const access = useAnalyticsAccess();
  const allowed = useAllowed(pageRequires("/analytics/warehouse"));
  const { data, error, loading, reload } = useLoad(() => api.warehouseStatus(), [], allowed);
  const [run, busy, actionError] = useAction();
  const [rebuild, setRebuild] = useState(false);
  const canRefresh = access.can("analytics_warehouse", "refresh");
  const canRebuild = access.can("analytics_warehouse", "rebuild") && data?.rebuildAllowed;
  const start = (source, jobType) => run(() => api.startWarehouseJob({ source, jobType }), reload);
  return (
    <AnalyticsPage title="Data Warehouse" description="Load status, reconciliation and data quality for the reporting warehouse. Analytics refresh on a schedule — they are not real-time."
      requires={pageRequires("/analytics/warehouse")}
      actions={(
        <>
          <button type="button" className={btn} onClick={reload} disabled={loading}>Refresh</button>
          {canRefresh && <button type="button" className={btnPrimary} disabled={busy} onClick={() => start("all", "incremental")}>Load all sources now</button>}
          {canRefresh && <button type="button" className={btn} disabled={busy} onClick={() => run(() => api.refreshViews(), reload)}>Refresh views</button>}
          {canRebuild && <button type="button" className={btnDanger} onClick={() => setRebuild(true)}>Rebuild…</button>}
        </>
      )}>
      <ErrorBox error={error || actionError} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Panel title="Sources">
            <Table rows={data.sources} rowKey={(s) => s.source} columns={[
              { label: "Source", render: (s) => <>{s.source}{s.snapshot && <span className="text-[11px] text-gray-500"> · daily snapshot</span>}</> },
              { label: "Last loaded", render: (s) => fmtDateTime(s.lastLoadedAt) },
              { label: "Watermark", render: (s) => fmtDateTime(s.watermark) },
              { label: "Last job", render: (s) => (s.lastStatus ? <Badge tone={JOB_TONE[s.lastStatus]}>{s.lastStatus}</Badge> : "—") },
              { label: "Reconciliation", render: (s) => (s.reconciliation ? <Badge tone={s.reconciliation.status === "Passed" ? "green" : "red"}>{s.reconciliation.status}</Badge> : "—") },
              { label: "", render: (s) => canRefresh && <button type="button" className={btn} disabled={busy} onClick={() => start(s.source, s.snapshot ? "manual" : "incremental")}>Load</button> },
            ]} />
          </Panel>
          <Panel title="Data quality">
            <Table rows={data.issues} empty="No data-quality issues recorded." columns={[
              { label: "Issue", render: (i) => <>{i.summary}<span className="block text-[11px] text-gray-500">{i.source} · {i.issueType.replace(/_/g, " ")}</span></> },
              { label: "Severity", render: (i) => <Badge tone={SEV_TONE[i.severity]}>{i.severity}</Badge> },
              { label: "Affected", render: (i) => i.affectedCount },
              { label: "Status", render: (i) => <Badge tone={i.status === "Open" ? "amber" : "green"}>{i.status}</Badge> },
              { label: "Last seen", render: (i) => fmtDateTime(i.lastSeenAt) },
            ]} />
          </Panel>
          <Panel title="Recent jobs">
            <Table rows={data.jobs} columns={[
              { label: "Job", render: (j) => <>{j.source}<span className="block text-[11px] text-gray-500">{j.jobType} · {j._id}</span></> },
              { label: "Status", render: (j) => <><Badge tone={JOB_TONE[j.status]}>{j.status}</Badge>{j.safeError && <span className="block text-[11px] text-gray-500">{j.safeError}</span>}</> },
              { label: "Rows", render: (j) => `${j.rowsRead} read · ${j.rowsInserted} new · ${j.rowsUpdated} updated${j.rowsRejected ? ` · ${j.rowsRejected} rejected` : ""}` },
              { label: "Attempts", render: (j) => j.attempts },
              { label: "Finished", render: (j) => fmtDateTime(j.completedAt) },
              { label: "", render: (j) => canRefresh && ["Failed", "Dead letter", "Cancelled"].includes(j.status) && <button type="button" className={btn} disabled={busy} onClick={() => run(() => api.retryWarehouseJob(j._id), reload)}>Retry</button> },
            ]} />
          </Panel>
        </>
      )}
      {rebuild && <RebuildDialog sources={data.sources.filter((s) => !s.snapshot).map((s) => s.source)} onClose={() => setRebuild(false)} onDone={reload} />}
    </AnalyticsPage>
  );
}
