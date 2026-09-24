// Governance → Kill switches, Flags, Exceptions, Reviews and Reports.
import { useState } from "react";
import * as ai from "../../../../Helpers/backendAiClient";
import { Badge, Table, ErrorBox, Loading } from "../../../Admin/aiBackend/aiUi";
import { btn, btnDanger, fmtDate, useAiLoad } from "../../../Admin/aiBackend/aiKit";
import { ReasonDialog, StatusNote } from "../AdminShell";

export function KillSwitches({ access }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listKillSwitches(), []);
  const [dialog, setDialog] = useState(null);
  const [filter, setFilter] = useState("global");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const canOn = access.can("ai_kill_switches", "activate");
  const canOff = access.can("ai_kill_switches", "deactivate");
  const rows = [data.organizationSwitch, ...data.killSwitches.filter((s) => s._id !== data.organizationSwitch._id)].filter((s) => filter === "all" || s.kind === filter || (filter === "global" && ["global", "organization", "semantic_retrieval", "provider_storage", "action_execution"].includes(s.kind)) || s.active);
  return (
    <div className="space-y-3">
      <label className="text-xs text-gray-400">Show <select className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm ml-1" value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="global">Global and organization</option>{data.kinds.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}<option value="all">All</option>
      </select></label>
      <Table rows={rows} columns={[
        { label: "Switch", render: (s) => <span>{s.kind.replace(/_/g, " ")}{s.target !== "*" && <span className="text-gray-500"> · {s.target}</span>}</span> }, { label: "Scope", render: (s) => s.scope },
        { label: "State", render: (s) => (s.active ? <Badge tone="red">Active</Badge> : <Badge tone="gray">Off</Badge>) }, { label: "Reason", render: (s) => <span className="text-xs text-gray-400">{s.active ? s.reason : "—"}</span> },
        { label: "Since", render: (s) => (s.active ? fmtDate(s.activatedAt) : "—") },
        { label: "", render: (s) => (s.active ? canOff && (s.scope === "Organization" || data.systemOwner) && <button type="button" className={btn} onClick={() => setDialog({ s, on: false })}>Deactivate</button>
          : canOn && (s.kind !== "global" || data.systemOwner) && <button type="button" className={btnDanger} onClick={() => setDialog({ s, on: true })}>Activate</button>) },
      ]} />
      <StatusNote>Kill switches are checked on the server for every AI request and take effect without a redeploy (other processes within a few seconds). They need a written reason, are audited and notify administrators. Platform switches are operated by a System Owner; activating one here applies it to this organization only. The AI can never operate them.</StatusNote>
      {dialog && (
        <ReasonDialog title={`${dialog.on ? "Activate" : "Deactivate"}: ${dialog.s.kind.replace(/_/g, " ")}${dialog.s.target !== "*" ? ` · ${dialog.s.target}` : ""}`} danger={dialog.on} confirmLabel={dialog.on ? "Activate" : "Deactivate"}
          description={dialog.on ? "New work stops now and queued work is cancelled. Read-only history stays available." : "Switches used to contain an incident stay on until restoration is approved."}
          fields={dialog.on ? [{ name: "activeWorkPolicy", label: "Work already running", type: "select", options: [["cancel_queued", "Let it finish; cancel queued work"], ["cancel_active", "Cancel it too"], ["stop_new", "Only stop new work"]] }] : []}
          onSubmit={(v) => (dialog.on ? ai.activateKillSwitch(dialog.s._id, { reason: v.reason, activeWorkPolicy: v.activeWorkPolicy || "cancel_queued", organizationScope: dialog.s.scope === "Platform" && !data.systemOwner }) : ai.deactivateKillSwitch(dialog.s._id, v.reason)).then(reload)}
          onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

export function Flags({ access }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listFlags(), []);
  const [dialog, setDialog] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const can = access.can("ai_governance", "manage");
  return (
    <div className="space-y-3">
      {can && <button type="button" className={btn} onClick={() => setDialog({})}>Set a flag for this organization</button>}
      <Table rows={data.flags} columns={[
        { label: "Flag", render: (f) => f.key }, { label: "Scope", render: (f) => (f.scope === "platform" ? "Platform" : "Organization") }, { label: "Environment", render: (f) => f.environment },
        { label: "Enabled", render: (f) => (f.enabled ? <Badge tone="green">On</Badge> : <Badge tone="gray">Off</Badge>) }, { label: "Targeting", render: (f) => <span className="text-xs text-gray-400">{Object.entries(f.targeting || {}).filter(([, v]) => (v || []).length).map(([k, v]) => `${k}: ${v.join(",")}`).join("; ") || "Everyone"}</span> },
        { label: "", render: (f) => can && f.scope !== "platform" && <button type="button" className={btn} onClick={() => setDialog(f)}>Change</button> },
      ]} />
      <StatusNote>{data.note} Current environment: {data.environment}. In production a capability is enabled through an approved release.</StatusNote>
      {dialog && <ReasonDialog title="Set feature flag" confirmLabel="Save" fields={[{ name: "key", label: "Flag key", defaultValue: dialog.key || "capability.ai_copilot" }, { name: "enabled", label: "Enabled", type: "checkbox", defaultValue: dialog.enabled ?? true }, { name: "roleKeys", label: "Only these role keys (comma-separated, optional)", defaultValue: (dialog.targeting?.roleKeys || []).join(",") }]}
        onSubmit={(v) => ai.setFlag({ key: v.key, enabled: !!v.enabled, environment: data.environment, targeting: v.roleKeys ? { roleKeys: v.roleKeys.split(",").map((s) => s.trim()).filter(Boolean) } : {}, reason: v.reason }).then(reload)} onClose={() => setDialog(null)} />}
    </div>
  );
}

export function Exceptions({ access }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listExceptions(), []);
  const [dialog, setDialog] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      {access.can("ai_emergency_exceptions", "request") && <button type="button" className={btn} onClick={() => setDialog({ kind: "request" })}>Request an exception</button>}
      <Table rows={data.exceptions} empty="No emergency exceptions." columns={[
        { label: "Exception", render: (e) => e._id }, { label: "Controls", render: (e) => (e.target?.controls || []).join(", ") }, { label: "Status", render: (e) => <Badge>{e.status}</Badge> },
        { label: "System Owner review", render: (e) => (e.systemOwnerReviewed ? "Done" : "Pending") }, { label: "Expires", render: (e) => fmtDate(e.expiresAt) },
        { label: "", render: (e) => access.can("ai_emergency_exceptions", "approve") && ["Requested", "Approved"].includes(e.status) && <button type="button" className={btn} onClick={() => setDialog({ kind: "decide", e })}>Decide</button> },
      ]} />
      <StatusNote>Exceptions expire automatically, need a separate approver and a System Owner review, and can never waive: {data.neverExcepted.join(", ").replace(/_/g, " ")}, credential exposure, authentication or permission bypass.</StatusNote>
      {dialog?.kind === "request" && <ReasonDialog title="Request an emergency exception" confirmLabel="Request" fields={[{ name: "control", label: "Control", type: "select", options: ["quality", "latency", "cost", "review_date", "readiness_manual_item"] }, { name: "releaseId", label: "Release id (optional)" }, { name: "compensatingControls", label: "Compensating controls", type: "textarea" }, { name: "expiresInDays", label: "Expires in days (max 14)", defaultValue: "3" }]}
        onSubmit={(v) => ai.requestException({ reason: v.reason, compensatingControls: v.compensatingControls, expiresInDays: Number(v.expiresInDays) || 3, target: { controls: [v.control || "quality"], ...(v.releaseId && { releaseId: v.releaseId }) } }).then(reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "decide" && <ReasonDialog title={`Decide ${dialog.e._id}`} confirmLabel="Record decision" fields={[{ name: "decision", label: "Decision", type: "select", options: ["Approve", "Reject", "Revoke"] }]} onSubmit={(v) => ai.decideException(dialog.e._id, v.decision || "Approve", v.reason).then(reload)} onClose={() => setDialog(null)} />}
    </div>
  );
}

export function Reviews() {
  const { data, error, loading, reload } = useAiLoad(() => ai.listReviews(), []);
  const [dialog, setDialog] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      <Table rows={data.reviews} empty="The review queue is empty." columns={[
        { label: "Queue", render: (r) => r.queue.replace(/_/g, " ") }, { label: "Item", render: (r) => <span className="text-sm">{r.summary}</span> }, { label: "Priority", render: (r) => <Badge tone={r.priority === "High" ? "red" : "gray"}>{r.priority}</Badge> },
        { label: "Status", render: (r) => <Badge>{r.status}</Badge> }, { label: "Raised", render: (r) => fmtDate(r.createdAt) },
        { label: "", render: (r) => <button type="button" className={btn} onClick={() => setDialog(r)}>Review</button> },
      ]} />
      <StatusNote>Reviewers see only the safe context stored with each item and can't decide items they raised.</StatusNote>
      {dialog && (
        <ReasonDialog title={dialog.summary} confirmLabel="Record decision" description={dialog.recommendedDecision ? `Suggested: ${dialog.recommendedDecision}` : undefined}
          fields={[{ name: "decision", label: "Decision", type: "select", options: [["approve", "Approve"], ["reject", "Reject"], ["request-changes", "Request changes"], ["escalate", "Escalate"]] }, { name: "runId", label: "Evaluation run id (restoration only)" }]}
          onSubmit={(v) => ai.decideReview(dialog._id, v.decision || "approve", { reason: v.reason, runId: v.runId || null }).then(reload)} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

export function Reports() {
  const { data, error, loading } = useAiLoad(() => ai.listReportTypes(), []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="space-y-3">
      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {data.reports.map((r) => (
          <li key={r} className="border border-gray-800 rounded-lg p-3 flex items-center justify-between gap-2">
            <span className="text-sm">{r.replace(/_/g, " ")}</span>
            <span className="flex gap-1"><a className={btn} href={ai.reportDownloadUrl(r, "csv")}>CSV</a><a className={btn} href={ai.reportDownloadUrl(r, "json")}>JSON</a></span>
          </li>
        ))}
      </ul>
      <StatusNote>{data.note}</StatusNote>
    </div>
  );
}
