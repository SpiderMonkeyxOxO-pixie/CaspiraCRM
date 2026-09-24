// /ai/monitoring — AI operations: volume, reliability, quality, safety and
// cost (safe aggregates only: no prompts, no record labels), SLOs with their
// measurement windows, alerts, safety events and privacy status.
import { useState } from "react";
import * as ai from "../../../Helpers/backendAiClient";
import { Badge, Panel, Table, ErrorBox, Loading } from "../../Admin/aiBackend/aiUi";
import { btn, input, fmtDate, fmtCost, useAiLoad } from "../../Admin/aiBackend/aiKit";
import { AdminPage, Stat, ReasonDialog, StatusNote } from "./AdminShell";

const SLO_TONE = { Met: "green", Missed: "red", "Insufficient data": "gray" };
const SEV_TONE = { Critical: "red", High: "red", Medium: "amber", Low: "blue", Informational: "gray" };

export default function MonitoringPage() {
  return (
    <AdminPage title="AI Monitoring" requires={[["ai_monitoring", "read"], ["ai_safety", "review"]]} description="Reliability, quality, safety and cost of AI features. Figures are aggregates over the selected window; evaluation traffic is excluded.">
      {(access) => <Monitoring access={access} />}
    </AdminPage>
  );
}

function Monitoring({ access }) {
  const [filters, setFilters] = useState({ hours: "24", providerKey: "", capabilityKey: "", severity: "" });
  const params = { from: new Date(Date.now() - Number(filters.hours) * 3_600_000).toISOString(), ...(filters.providerKey && { providerKey: filters.providerKey }), ...(filters.capabilityKey && { capabilityKey: filters.capabilityKey }), ...(filters.severity && { severity: filters.severity }) };
  const { data, error, loading, reload } = useAiLoad(() => ai.monitoringSummary(params), [JSON.stringify(filters)]);
  const alerts = useAiLoad(() => ai.listAlerts(), []);
  const events = useAiLoad(() => ai.listSafetyEvents(filters.severity ? { severity: filters.severity } : {}), [filters.severity]);
  const health = useAiLoad(() => ai.governanceHealth(), []);
  const [dialog, setDialog] = useState(null);
  const m = data?.metrics;
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => e.preventDefault()} aria-label="Monitoring filters">
        <label className="text-xs text-gray-400">Window<select className={`${input} w-32`} value={filters.hours} onChange={set("hours")}><option value="1">1 hour</option><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option></select></label>
        <label className="text-xs text-gray-400">Provider<input className={`${input} w-32`} value={filters.providerKey} onChange={set("providerKey")} placeholder="any" /></label>
        <label className="text-xs text-gray-400">Capability<input className={`${input} w-40`} value={filters.capabilityKey} onChange={set("capabilityKey")} placeholder="any" /></label>
        <label className="text-xs text-gray-400">Severity<select className={`${input} w-36`} value={filters.severity} onChange={set("severity")}><option value="">any</option>{["Critical", "High", "Medium", "Low", "Informational"].map((s) => <option key={s}>{s}</option>)}</select></label>
        <button type="button" className={btn} onClick={reload}>Refresh</button>
        {access.can("ai_governance", "manage") && <button type="button" className={btn} onClick={() => ai.measureSlos().then(reload)}>Measure SLOs now</button>}
      </form>
      {loading && <Loading />}
      <ErrorBox error={error} onRetry={reload} />
      {m && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Stat label="Requests" value={m.requests.total} hint={`${m.activeUsers} active users`} />
            <Stat label="Availability" value={m.availability === null ? "—" : `${m.availability}%`} hint={`n=${m.requests.total}`} />
            <Stat label="Error / refusal" value={`${m.errorRate ?? "—"}% / ${m.refusalRate ?? "—"}%`} />
            <Stat label="Latency p95" value={m.latency.p95Ms ? `${Math.round(m.latency.p95Ms / 100) / 10} s` : "—"} hint={`p50 ${m.latency.p50Ms ? `${Math.round(m.latency.p50Ms / 100) / 10} s` : "—"}`} />
            <Stat label="Safety events" value={m.safety.total} tone={m.safety.bySeverity.High || m.safety.bySeverity.Critical ? "text-red-300" : "text-white"} />
            <Stat label="Estimated cost" value={fmtCost(m.cost.estimated)} hint={m.cost.label} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Panel title="Quality">
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-gray-400">Validation failures</dt><dd>{m.validationFailureRate ?? "—"}%</dd>
                <dt className="text-gray-400">Structured-output validity</dt><dd>{m.structuredValidityRate ?? "—"}%</dd>
                <dt className="text-gray-400">Copilot answers</dt><dd>{m.copilot.answers} ({m.copilot.successRate ?? "—"}% ok)</dd>
                <dt className="text-gray-400">Answers with removed statements</dt><dd>{m.copilot.citationFailures}</dd>
                <dt className="text-gray-400">Low confidence</dt><dd>{m.copilot.lowConfidence}</dd>
                <dt className="text-gray-400">Tool calls (ok / denied / failed)</dt><dd>{m.tools.succeeded} / {m.tools.denied} / {m.tools.failed}</dd>
                <dt className="text-gray-400">Index lag</dt><dd>{m.retrieval.indexLagMinutes} min</dd>
                <dt className="text-gray-400">Proposals</dt><dd>{Object.entries(m.approvals).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}</dd>
              </dl>
            </Panel>
            <Panel title="Usage by provider and capability">
              <Table rowKey={(r) => r.key} rows={[...m.byProvider.map((r) => ({ ...r, key: `provider:${r.key}` })), ...m.byCapability.map((r) => ({ ...r, key: `capability:${r.key}` }))]} columns={[{ label: "Group", render: (r) => r.key }, { label: "Requests", render: (r) => r.requests }, { label: "Tokens in/out", render: (r) => `${r.inputTokens} / ${r.outputTokens}` }, { label: "Est. cost", render: (r) => fmtCost(r.estimatedCost) }]} />
            </Panel>
          </div>
          <Panel title="Service-level objectives">
            <Table rowKey={(s) => s.key} rows={data.slos} columns={[
              { label: "Objective", render: (s) => s.name }, { label: "Target", render: (s) => `${s.comparator === "gte" ? "≥" : "≤"} ${s.objective} ${s.unit}` }, { label: "Window", render: (s) => `${s.windowMinutes >= 1440 ? `${s.windowMinutes / 1440} d` : `${s.windowMinutes} min`}` },
              { label: "Latest", render: (s) => (s.latest ? <span><Badge tone={SLO_TONE[s.latest.status]}>{s.latest.status}</Badge> {s.latest.value ?? "—"} {s.unit} (n={s.latest.sampleSize})</span> : "Not measured yet") },
              { label: "Measured", render: (s) => fmtDate(s.latest?.windowEnd) },
            ]} />
            <StatusNote>An SLO is only reported as met with data in its measurement window.</StatusNote>
          </Panel>
          <Panel title="Privacy">
            <dl className="grid md:grid-cols-2 gap-y-1 text-sm">
              <dt className="text-gray-400">Provider storage</dt><dd>{data.privacy.providerStorageMode}</dd>
              <dt className="text-gray-400">Provider-hosted files / conversations</dt><dd>{data.privacy.providerHostedInventory.files} / {data.privacy.providerHostedInventory.conversations}</dd>
              <dt className="text-gray-400">Requests by provider (7 days)</dt><dd>{Object.entries(data.privacy.requestsByProvider7d).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}</dd>
              <dt className="text-gray-400">Redacted fields (7 days)</dt><dd>{data.privacy.redactedFields7d}</dd>
              <dt className="text-gray-400">Expired payloads awaiting deletion</dt><dd>{data.privacy.expiredPayloadsAwaitingDeletion}</dd>
              <dt className="text-gray-400">Production evaluation datasets</dt><dd>{data.privacy.productionEvaluationDatasets}</dd>
            </dl>
            <StatusNote>{data.privacy.providerHostedInventory.note}</StatusNote>
          </Panel>
        </>
      )}
      <Panel title="Alerts" actions={access.can("ai_governance", "manage") && <button type="button" className={btn} onClick={() => ai.evaluateAlerts().then(alerts.reload)}>Evaluate now</button>}>
        <ErrorBox error={alerts.error} />
        {alerts.data && <Table rows={alerts.data.alerts} empty="No open alerts." columns={[
          { label: "Alert", render: (a) => a.summary }, { label: "Severity", render: (a) => <Badge tone={SEV_TONE[a.severity]}>{a.severity}</Badge> }, { label: "Status", render: (a) => a.status }, { label: "Count", render: (a) => a.count }, { label: "Last", render: (a) => fmtDate(a.lastAt) },
          { label: "", render: (a) => <span className="flex gap-1">{a.status === "Open" && <button type="button" className={btn} onClick={() => setDialog({ a, action: "acknowledge" })}>Acknowledge</button>}<button type="button" className={btn} onClick={() => setDialog({ a, action: "resolve" })}>Resolve</button></span> },
        ]} />}
      </Panel>
      <Panel title="Safety events">
        <ErrorBox error={events.error} />
        {events.data && <Table rows={events.data.events} empty="No safety events in this window." columns={[
          { label: "When", render: (e) => fmtDate(e.createdAt) }, { label: "Severity", render: (e) => <Badge tone={SEV_TONE[e.severity]}>{e.severity}</Badge> }, { label: "Category", render: (e) => e.category.replace(/_/g, " ") },
          { label: "Summary", render: (e) => <span className="text-xs">{e.summary}</span> }, { label: "Action", render: (e) => e.actionTaken }, { label: "Review", render: (e) => e.reviewStatus },
          { label: "", render: (e) => access.can("ai_safety", "review") && e.reviewStatus === "Open" && <button type="button" className={btn} onClick={() => setDialog({ e })}>Review</button> },
        ]} />}
        <StatusNote>Safety events hold code-written summaries only: never credentials, sensitive values, user text or hidden reasoning.</StatusNote>
      </Panel>
      {health.data && (
        <Panel title="Service health">
          <ul className="flex flex-wrap gap-2 text-xs">{Object.entries(health.data).filter(([, v]) => v && typeof v === "object").map(([k, v]) => <li key={k}><Badge tone={v.status === "ok" ? "green" : v.status === "down" ? "red" : "amber"}>{k}: {v.status}</Badge></li>)}</ul>
        </Panel>
      )}
      {dialog?.a && <ReasonDialog title={`${dialog.action === "resolve" ? "Resolve" : "Acknowledge"} alert`} requireReason={false} confirmLabel="Save" fields={[{ name: "note", label: "Note", type: "textarea" }]} onSubmit={(v) => ai.alertAction(dialog.a.id, dialog.action, v.note || (dialog.action === "resolve" ? "" : undefined)).then(alerts.reload)} onClose={() => setDialog(null)} />}
      {dialog?.e && <ReasonDialog title="Review safety event" confirmLabel="Save" fields={[{ name: "reviewStatus", label: "Outcome", type: "select", options: ["Reviewed", "Dismissed", "Escalated"] }]} onSubmit={(v) => ai.reviewSafetyEvent(dialog.e.id, v.reviewStatus || "Reviewed", v.reason).then(events.reload)} onClose={() => setDialog(null)} />}
    </div>
  );
}
