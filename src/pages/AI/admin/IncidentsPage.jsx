// /ai/incidents — AI incident management: severity, containment (kill
// switches), timeline, redacted evidence, regression cases and a
// restoration gate (a passing regression run and a different approver).
import { useState } from "react";
import * as ai from "../../../Helpers/backendAiClient";
import { Badge, Table, ErrorBox, Loading, Modal } from "../../Admin/aiBackend/aiUi";
import { btn, btnPrimary, btnDanger, fmtDate, useAiLoad } from "../../Admin/aiBackend/aiKit";
import { AdminPage, ReasonDialog, StatusNote } from "./AdminShell";

const SEV_TONE = { "SEV-0": "red", "SEV-1": "red", "SEV-2": "amber", "SEV-3": "blue", "SEV-4": "gray" };
const NEXT = { Detected: ["Triage", "Investigating"], Triage: ["Investigating"], Contained: ["Investigating", "Remediating"], Investigating: ["Remediating"], Remediating: ["Monitoring"], Monitoring: ["Remediating"], Reopened: ["Triage", "Investigating"] };

export default function IncidentsPage() {
  return (
    <AdminPage title="AI Incidents" requires={[["ai_incidents", "view"]]} description="Detect, contain, investigate, remediate and restore. A contained capability comes back only after its regression suite passes and someone other than the incident owner approves.">
      {(access) => <Incidents access={access} />}
    </AdminPage>
  );
}

function Incidents({ access }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listIncidents(), []);
  const [dialog, setDialog] = useState(false);
  const [open, setOpen] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      {access.can("ai_incidents", "create") && <button type="button" className={btnPrimary} onClick={() => setDialog(true)}>Report an incident</button>}
      <Table rows={data.incidents} empty="No AI incidents." columns={[
        { label: "Incident", render: (i) => <button type="button" className="text-blue-300 underline text-left" onClick={() => setOpen(i._id)}>{i.title}</button> },
        { label: "Severity", render: (i) => <Badge tone={SEV_TONE[i.severity]}>{i.severity}</Badge> }, { label: "Category", render: (i) => i.category.replace(/_/g, " ") },
        { label: "Status", render: (i) => <Badge>{i.status}</Badge> }, { label: "Capability", render: (i) => i.capabilityKey || "—" }, { label: "Detected", render: (i) => fmtDate(i.createdAt) },
      ]} />
      {dialog && <ReasonDialog title="Report an AI incident" confirmLabel="Create incident" requireReason={false}
        fields={[{ name: "title", label: "Title" }, { name: "severity", label: "Severity", type: "select", options: data.severities }, { name: "category", label: "Category", type: "select", options: data.categories }, { name: "capabilityKey", label: "Capability key (optional)" }, { name: "summary", label: "What happened (no secrets or customer data)", type: "textarea" }]}
        onSubmit={(v) => ai.createIncident({ ...v, severity: v.severity || "SEV-3", category: v.category || data.categories[0], capabilityKey: v.capabilityKey || null }).then(reload)} onClose={() => setDialog(false)} />}
      {open && <IncidentDetail id={open} access={access} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function IncidentDetail({ id, access, onClose }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.getIncident(id), [id]);
  const switches = useAiLoad(() => ai.listKillSwitches().catch(() => ({ killSwitches: [] })), []);
  const [dialog, setDialog] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const i = data?.incident;
  const manage = access.can("ai_incidents", "manage");
  const run = (fn) => fn().then(reload);
  return (
    <Modal title={i?.title || "Incident"} onClose={onClose}>
      {loading && <Loading />}
      <ErrorBox error={error} />
      {i && (
        <div className="space-y-3 text-sm">
          <p><Badge tone={SEV_TONE[i.severity]}>{i.severity}</Badge> <Badge>{i.status}</Badge> <span className="text-gray-400">{i.category.replace(/_/g, " ")} · {i.capabilityKey || "no capability"}</span></p>
          <p className="text-gray-300">{i.summary}</p>
          {i.rootCause && <p className="text-xs"><b>Root cause:</b> {i.rootCause}</p>}
          {i.containment.length > 0 && <p className="text-xs text-amber-200">Contained by: {i.containment.map((c) => `${c.kind || c.type} ${c.target || c.releaseId || ""}`).join(", ")}{i.restorationApproved ? " · restoration approved" : " · restoration not approved"}</p>}
          {manage && (
            <div className="flex flex-wrap gap-2">
              {(NEXT[i.status] || []).map((s) => <button key={s} type="button" className={btn} onClick={() => run(() => ai.updateIncident(id, { status: s }))}>Move to {s}</button>)}
              {!["Resolved", "Closed"].includes(i.status) && <button type="button" className={btnDanger} onClick={() => setDialog("contain")}>Contain…</button>}
              {!["Resolved", "Closed"].includes(i.status) && <button type="button" className={btn} onClick={() => setDialog("regression")}>Create regression case</button>}
              {!["Resolved", "Closed"].includes(i.status) && <button type="button" className={btn} onClick={() => setDialog("evidence")}>Add evidence</button>}
              {!["Resolved", "Closed"].includes(i.status) && <button type="button" className={btnPrimary} onClick={() => setDialog("resolve")}>Resolve…</button>}
              {i.status === "Resolved" && <button type="button" className={btn} onClick={() => run(() => ai.incidentAction(id, "close"))}>Close</button>}
              {["Resolved", "Closed"].includes(i.status) && <button type="button" className={btn} onClick={() => setDialog("reopen")}>Reopen</button>}
            </div>
          )}
          {(access.can("ai_safety", "review") || access.can("ai_releases", "approve")) && i.containment.length > 0 && !i.restorationApproved && <button type="button" className={btnPrimary} onClick={() => setDialog("restore")}>Approve restoration…</button>}
          {data.canReadEvidence && <button type="button" className={btn} onClick={() => ai.readIncidentEvidence(id).then((r) => setEvidence(r.evidence))}>View evidence ({data.evidenceCount})</button>}
          {evidence && <ul className="text-[11px] space-y-1">{evidence.map((e) => <li key={e._id} className="border border-gray-800 rounded p-2"><b>{e.kind}</b> · {e.hash.slice(0, 12)} · expires {fmtDate(e.expiresAt)}<pre className="whitespace-pre-wrap text-gray-400">{JSON.stringify(e.data, null, 1)}</pre></li>)}</ul>}
          <h3 className="font-semibold">Timeline</h3>
          <ol className="text-xs space-y-1">{data.timeline.map((t) => <li key={t.id}><span className="text-gray-500">{fmtDate(t.createdAt)}</span> {t.type.replace(/_/g, " ")}{t.toStatus ? ` → ${t.toStatus}` : ""}{t.note ? ` — ${t.note}` : ""}</li>)}</ol>
          <StatusNote>Evidence is redacted metadata, hashed and time-limited; reading it is audited.</StatusNote>
        </div>
      )}
      {dialog === "contain" && <ReasonDialog title="Contain this incident" danger confirmLabel="Contain" description="Activates the selected kill switch for this organization; queued work is cancelled."
        fields={[{ name: "killSwitchId", label: "Kill switch", type: "select", options: (switches.data?.killSwitches || []).filter((s) => ["capability", "tool", "workflow", "provider", "model", "semantic_retrieval", "action_execution"].includes(s.kind) && !s.active).map((s) => [s._id, `${s.kind.replace(/_/g, " ")} · ${s.target}`]) }]}
        onSubmit={(v) => ai.incidentAction(id, "contain", { killSwitchIds: [v.killSwitchId || switches.data?.killSwitches.find((s) => s.kind === "capability")?._id].filter(Boolean), reason: v.reason }).then(reload)} onClose={() => setDialog(null)} />}
      {dialog === "regression" && <ReasonDialog title="Create a regression case" requireReason={false} confirmLabel="Add to regression suite" description="The case is added to the incident dataset (new version); restoration needs a passing run that includes it."
        fields={[{ name: "kind", label: "Kind", type: "select", options: [["deterministic", "Deterministic check"], ["copilot", "Copilot answer"]] }, { name: "text", label: "Input text (e.g. the injection or request that failed)", type: "textarea" }, { name: "expected", label: "Expected outcome", type: "select", options: [["flagged", "Flagged as injection"], ["deny", "Refused"]] }]}
        onSubmit={(v) => ai.incidentAction(id, "create-regression-case", (v.kind || "deterministic") === "copilot" ? { input: { kind: "copilot", asRole: "user", text: v.text }, expectations: { code: { statusIn: ["Refused", "Completed", "Completed with limitations"] }, evidence: { noActionClaims: true } } } : { input: { kind: "deterministic", check: (v.expected || "flagged") === "flagged" ? "injection_detection" : "prohibited_detection", args: { texts: [v.text] } }, expectations: { code: { outcome: v.expected || "flagged" } } }).then(reload)} onClose={() => setDialog(null)} />}
      {dialog === "evidence" && <ReasonDialog title="Add evidence" requireReason={false} confirmLabel="Add" description="Keys, tokens and credential-like values are removed before storing." fields={[{ name: "kind", label: "Kind", defaultValue: "note" }, { name: "text", label: "Evidence (redacted metadata, IDs, correlation IDs)", type: "textarea" }]} onSubmit={(v) => ai.incidentAction(id, "evidence", { kind: v.kind, data: { note: v.text } }).then(reload)} onClose={() => setDialog(null)} />}
      {dialog === "restore" && <ReasonDialog title="Approve restoration" confirmLabel="Approve" fields={[{ name: "runId", label: "Passing evaluation run id (must include every regression case)" }]} onSubmit={(v) => ai.incidentAction(id, "approve-restoration", { runId: v.runId, reason: v.reason }).then(reload)} onClose={() => setDialog(null)} />}
      {dialog === "resolve" && <ReasonDialog title="Resolve" requireReason={false} confirmLabel="Resolve" fields={[{ name: "rootCause", label: "Root cause", type: "textarea" }, { name: "remediation", label: "Remediation", type: "textarea" }]} onSubmit={(v) => ai.incidentAction(id, "resolve", v).then(reload)} onClose={() => setDialog(null)} />}
      {dialog === "reopen" && <ReasonDialog title="Reopen" confirmLabel="Reopen" onSubmit={(v) => ai.incidentAction(id, "reopen", { reason: v.reason }).then(reload)} onClose={() => setDialog(null)} />}
    </Modal>
  );
}
