// Backend Phase 12 — governed metric definitions: formula, sources,
// additivity, currency behavior, freshness target and version history.
// Administrators can draft and publish new definition versions; a published
// version never changes.
import { useState } from "react";
import * as api from "../../Helpers/backendAnalyticsClient";
import { pageRequires, useAnalyticsAccess } from "../../Helpers/analyticsAccess";
import { AnalyticsPage, ErrorBox, Loading, Modal, Badge, Table } from "./AnalyticsUi";
import { btn, btnPrimary, input, useLoad, useAction, fmtDateTime, useAllowed } from "./analyticsKit";

function MetricDetail({ metricKey, canManage, onClose }) {
  const { data, error, loading, reload } = useLoad(() => api.getMetric(metricKey), [metricKey]);
  const [draft, setDraft] = useState({ definition: "", owner: "", reviewer: "", freshnessTargetMinutes: "" });
  const [run, busy, actionError] = useAction();
  const latest = data?.versions?.[0];
  const submitDraft = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(draft).filter(([, v]) => String(v).trim() !== "").map(([k, v]) => [k, k === "freshnessTargetMinutes" ? Number(v) : v]));
    run(() => api.draftMetric(metricKey, body), () => { setDraft({ definition: "", owner: "", reviewer: "", freshnessTargetMinutes: "" }); reload(); });
  };
  return (
    <Modal title={data ? `${data.name} (${data.key})` : "Metric"} onClose={onClose}>
      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : (
        <div className="space-y-3 text-sm">
          <p className="text-gray-300">{latest?.definition?.definition}</p>
          <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
            {[["Formula", latest?.definition?.formula], ["Implementation", latest?.definition?.implementation], ["Sources", (latest?.definition?.sources || []).join(", ")], ["Grain", latest?.definition?.grain],
              ["Additivity", latest?.definition?.additivity], ["Currency", latest?.definition?.currencyBehavior], ["Dimensions", (latest?.definition?.dimensions || []).join(", ") || "—"], ["Empty result", latest?.definition?.nullBehavior],
              ["Owner", latest?.definition?.owner], ["Reviewer", latest?.definition?.reviewer], ["Freshness target", latest?.definition?.freshnessTargetMinutes ? `${latest.definition.freshnessTargetMinutes} min` : "—"], ["Sensitivity", latest?.definition?.sensitivity]]
              .map(([k, v]) => <div key={k} className="contents"><dt className="text-gray-500">{k}</dt><dd className="col-span-2 text-gray-300 break-words">{v || "—"}</dd></div>)}
          </dl>
          <h3 className="text-xs font-semibold text-white pt-2">Versions</h3>
          <ul className="space-y-1">
            {data.versions.map((v) => (
              <li key={v.version} className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-300">v{v.version}</span>
                <Badge tone={v.status === "Published" ? "green" : v.status === "Draft" ? "blue" : "gray"}>{v.status}</Badge>
                <span className="text-xs text-gray-500">{v.effectiveDate ? `effective ${fmtDateTime(v.effectiveDate)}` : `created ${fmtDateTime(v.createdAt)}`}{v.deprecatedDate ? ` · deprecated ${fmtDateTime(v.deprecatedDate)}` : ""}</span>
                {canManage && v.status === "Draft" && <button type="button" className={btnPrimary} disabled={busy} onClick={() => run(() => api.publishMetric(metricKey, v.version), reload)}>Publish</button>}
              </li>
            ))}
          </ul>
          {canManage && data.status !== "Retired" && (
            <form onSubmit={submitDraft} className="space-y-2 border-t border-gray-800 pt-3">
              <p className="text-xs text-gray-400">Draft a new version of the description and ownership. The formula and sources are defined in code and change only with a release.</p>
              <textarea className={`${input} min-h-[4rem]`} placeholder="Definition text" value={draft.definition} onChange={(e) => setDraft({ ...draft, definition: e.target.value })} aria-label="Definition text" />
              <div className="grid grid-cols-3 gap-2">
                <input className={input} placeholder="Owner" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} aria-label="Owner" />
                <input className={input} placeholder="Reviewer" value={draft.reviewer} onChange={(e) => setDraft({ ...draft, reviewer: e.target.value })} aria-label="Reviewer" />
                <input className={input} type="number" min="5" max="10080" placeholder="Freshness (min)" value={draft.freshnessTargetMinutes} onChange={(e) => setDraft({ ...draft, freshnessTargetMinutes: e.target.value })} aria-label="Freshness target in minutes" />
              </div>
              <ErrorBox error={actionError} />
              <div className="flex justify-end"><button type="submit" className={btn} disabled={busy}>Save draft</button></div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function MetricsPage() {
  const access = useAnalyticsAccess();
  const allowed = useAllowed(pageRequires("/analytics/metrics"));
  const { data, error, loading, reload } = useLoad(() => api.listMetrics(), [], allowed);
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("");
  const rows = (data?.metrics || []).filter((m) => !filter || `${m.name} ${m.key} ${m.module}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <AnalyticsPage title="Metric Definitions" description="Every figure in Analytics & Reports comes from one of these governed metrics." requires={pageRequires("/analytics/metrics")}>
      <input className={`${input} max-w-sm`} placeholder="Search metrics" aria-label="Search metrics" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <Table rows={rows} rowKey={(m) => m.key} columns={[
          { label: "Metric", render: (m) => <button type="button" className="text-blue-300 underline text-left" onClick={() => setOpen(m.key)}>{m.name}</button> },
          { label: "Area", render: (m) => m.module.replace("analytics_", "") },
          { label: "Definition", render: (m) => <span className="text-xs">{m.definition?.definition}</span> },
          { label: "Additivity", render: (m) => m.definition?.additivity },
          { label: "Version", render: (m) => (m.version ? `v${m.version}` : "—") },
          { label: "Status", render: (m) => <Badge tone={m.status === "Published" ? "green" : "gray"}>{m.status}</Badge> },
        ]} />
      )}
      {open && <MetricDetail metricKey={open} canManage={access.can("analytics_metrics", "manage")} onClose={() => { setOpen(null); reload(); }} />}
    </AnalyticsPage>
  );
}
