import { useState } from "react";
import { Link } from "react-router-dom";
import * as ai from "../../../Helpers/backendAiClient";
import { AiPage, Panel, Badge, ErrorBox, Loading, Table, Modal } from "./aiUi";
import { useAiLoad, useAiAction, fmtDate, fmtCost, fmtInt, btn, btnPrimary, btnDanger, input } from "./aiKit";

// Backend-mode AI Providers overview: what is connected, what it costs
// (estimated), budgets, proposals waiting for approval and recent audit.
export default function AiOverviewBackend() {
  const { data, error, loading, reload } = useAiLoad(async () => {
    const [providers, summary, pending, audit] = await Promise.all([
      ai.listProviders(),
      ai.usageSummary().catch(() => null),
      ai.listActions({ status: "Awaiting Approval", pageSize: 20 }).catch(() => ({ actions: [] })),
      ai.listAudit({ pageSize: 6 }).catch(() => ({ auditEvents: [] })),
    ]);
    return { providers, summary, pending: pending.actions || [], audit: audit.auditEvents || [] };
  });
  const [decide, setDecide] = useState(null); // { action, kind: "approve" | "reject" }

  const connected = (data?.providers.providers || []).filter((p) => ["Connected", "Connected with Warnings"].includes(p.connectionStatus));
  const attention = (data?.providers.providers || []).filter((p) => ["Verification Failed", "Error", "Rate Limited", "Budget Exhausted", "Configuration Incomplete"].includes(p.connectionStatus));
  const s = data?.summary;
  const totals = (s?.byProvider || []).reduce((a, b) => ({ requests: a.requests + b.requests, cost: a.cost + (b.estimatedCost || 0) }), { requests: 0, cost: 0 });

  return (
    <AiPage title="AI Providers" description="Your organization's own AI provider accounts, how they are used, what they are estimated to cost, and the AI actions waiting for a person's decision." simulatorLabel={data?.providers.simulatorLabel}>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="Connected providers" value={connected.length} to="providers" />
            <Metric label="Need attention" value={attention.length} to="providers" tone={attention.length ? "text-amber-300" : undefined} />
            <Metric label={`Requests this month${s?.scope === "Own" ? " (yours)" : ""}`} value={fmtInt(totals.requests)} to="usage" />
            <Metric label="Estimated cost this month" value={fmtCost(totals.cost)} sub={s?.costLabel} to="usage" />
          </div>
          {s?.requestsWithUnknownCost > 0 && <p className="text-xs text-amber-300">{s.requestsWithUnknownCost} request(s) used models without a price — their cost is unknown, not zero.</p>}
          {s?.providerStorageEnabled && <p className="text-xs text-amber-300">Provider-side storage is enabled by policy.</p>}

          <div className="grid lg:grid-cols-2 gap-4">
            <Panel title="Providers">
              <ul className="space-y-1.5">
                {data.providers.providers.filter((p) => p.availability === "Adapter").map((p) => (
                  <li key={p.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-gray-200 truncate">{p.name}</span>
                    <span className="flex items-center gap-2">{!p.allowedByPolicy && <Badge tone="gray">Not allowed by policy</Badge>}<Badge>{p.connectionStatus}</Badge></span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Budgets this period">
              {!s?.budgets?.length ? <p className="text-sm text-gray-400">No active budgets. <Link className="text-blue-400 hover:underline" to="/admin/integrations/ai-providers/usage">Set one up</Link>.</p> : (
                <ul className="space-y-2">
                  {s.budgets.map((b) => (
                    <li key={b._id} className="text-sm">
                      <div className="flex justify-between gap-2"><span className="text-gray-200">{b.scope}{b.scopeRef ? `: ${b.scopeRef}` : ""} · {b.period}</span><span className={b.exhausted ? "text-red-300" : b.warning ? "text-amber-300" : "text-gray-300"}>{fmtCost(b.spent, b.currency)} of {b.hardLimit} {b.currency}</span></div>
                      <div className="h-1.5 bg-gray-800 rounded mt-1" aria-hidden="true"><div className={`h-1.5 rounded ${b.exhausted ? "bg-red-500" : b.warning ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (b.spent / (b.hardLimit || 1)) * 100)}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title="AI actions waiting for approval">
            <Table rows={data.pending} empty="Nothing is waiting for approval." columns={[
              { label: "Action", render: (a) => <span className="text-gray-200">{a.label}</span> },
              { label: "Record", render: (a) => `${a.targetType} ${a.targetId}` },
              { label: "Proposed", render: (a) => <code className="text-xs">{JSON.stringify(a.proposedValues)}</code> },
              { label: "Reason", key: "reason" },
              { label: "Expires", render: (a) => fmtDate(a.expiresAt) },
              { label: "", render: (a) => a.isMine ? <span className="text-xs text-gray-500">Yours — someone else approves</span> : (
                <span className="flex gap-2"><button type="button" className={btnPrimary} onClick={() => setDecide({ action: a, kind: "approve" })}>Approve</button><button type="button" className={btnDanger} onClick={() => setDecide({ action: a, kind: "reject" })}>Reject</button></span>
              ) },
            ]} />
          </Panel>

          <Panel title="Recent AI audit events" actions={<Link to="/admin/integrations/ai-providers/audit" className="text-xs text-blue-400 hover:underline">All events</Link>}>
            <Table rows={data.audit} empty="No AI events yet." columns={[
              { label: "When", render: (e) => fmtDate(e.createdAt) },
              { label: "Event", render: (e) => <code className="text-xs">{e.action}</code> },
              { label: "Result", render: (e) => <Badge>{e.result}</Badge> },
            ]} />
          </Panel>
        </>
      )}
      {decide && <DecisionDialog {...decide} onClose={() => setDecide(null)} onDone={() => { setDecide(null); reload(); }} />}
    </AiPage>
  );
}

function Metric({ label, value, sub, to, tone }) {
  return (
    <Link to={`/admin/integrations/ai-providers/${to}`} className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 hover:border-gray-700 block">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${tone || "text-white"}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </Link>
  );
}

function DecisionDialog({ action, kind, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [run, busy, error] = useAiAction();
  const submit = () => run(() => (kind === "approve" ? ai.approveAction(action._id, reason) : ai.rejectAction(action._id, reason)), onDone);
  return (
    <Modal title={kind === "approve" ? "Approve AI action" : "Reject AI action"} onClose={onClose} footer={<>
      <button type="button" className={btn} onClick={onClose}>Cancel</button>
      <button type="button" className={kind === "approve" ? btnPrimary : btnDanger} disabled={busy || (kind === "reject" && !reason.trim())} onClick={submit}>{kind === "approve" ? "Approve and run" : "Reject"}</button>
    </>}>
      <p className="text-sm text-gray-300">{action.label} on {action.targetType} <code className="text-xs">{action.targetId}</code></p>
      <p className="text-xs text-gray-400">{action.impact}</p>
      <dl className="text-xs text-gray-300 grid grid-cols-2 gap-2">
        <div><dt className="text-gray-500">Current</dt><dd><code>{JSON.stringify(action.currentValues)}</code></dd></div>
        <div><dt className="text-gray-500">Proposed</dt><dd><code>{JSON.stringify(action.proposedValues)}</code></dd></div>
      </dl>
      <label className="block text-xs text-gray-400" htmlFor="decision-reason">Reason{kind === "reject" ? " (required)" : ""}</label>
      <textarea id="decision-reason" className={input} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      {kind === "approve" && <p className="text-xs text-gray-500">Approving runs it through the CRM's own rules for that record. It fails safely if the record changed.</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </Modal>
  );
}
