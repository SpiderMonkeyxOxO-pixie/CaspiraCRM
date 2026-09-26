// Tabs of the Platform Operations page (Backend Phase 13). Every action
// button appears only with the matching platform permission; the API
// enforces the same checks, separation of duties and recent authentication.
import { useState } from "react";
import * as api from "../../../Helpers/backendPlatformClient";
import { Badge, Table, ErrorBox, Loading, Panel, Modal } from "../aiBackend/aiUi";
import { btn, btnPrimary, btnDanger, fmtDate, useAiLoad, useAiAction } from "../aiBackend/aiKit";
import { Stat, ReasonDialog, StatusNote } from "../../AI/admin/AdminShell";
import AutomationTokens from "./AutomationTokens";

const TONE = {
  ok: "green", configured: "green", degraded: "amber", unavailable: "red", failed: "red", stale: "amber", missing: "amber", not_configured: "gray",
  Critical: "red", High: "red", Medium: "amber", Low: "blue", Informational: "gray",
  Open: "red", Excepted: "amber", Fixed: "green", Resolved: "green", "False positive": "gray", "Accepted risk": "amber",
  Firing: "red", Acknowledged: "amber", Verified: "green", Unverified: "amber", Passed: "green", Waived: "amber",
  Approved: "green", Draft: "gray", "Ready for Review": "blue", "Manual Recovery Required": "red", Deploying: "blue", Planned: "gray",
  "Rotation due": "amber", Compromised: "red", Active: "green", Current: "green",
};
const tone = (s) => TONE[s] || undefined;
// Approving your own request is refused unless the server allows a single
// operator; then the reason is recorded as an audited staffing exception.
const SELF_APPROVAL_NOTE = "Normally someone other than the requester approves. If you requested this yourself and the platform allows a single operator, your reason (at least 10 characters) is recorded as an audited exception.";
const fmtSeconds = (s) => (s === null || s === undefined ? "—" : s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const fmtBytes = (b) => (b === null || b === undefined ? "—" : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(1)} MB`);

function Section({ load, children }) {
  if (load.loading) return <Loading />;
  if (load.error) return <ErrorBox error={load.error} onRetry={load.reload} />;
  return children(load.data);
}

// ─── Health ─────────────────────────────────────────────────────────────────
export function OverviewTab({ can }) {
  const health = useAiLoad(() => api.systemHealth(), []);
  const backups = useAiLoad(() => (can("platform.backup.read") ? api.backupStatus() : Promise.resolve(null)), []);
  const security = useAiLoad(() => (can("platform.security.read") ? api.securityOverview() : Promise.resolve(null)), []);
  return (
    <div className="space-y-4">
      <Section load={health}>{(h) => (
        <Panel title={<>Overall: <Badge tone={h.overall === "healthy" ? "green" : h.overall === "degraded" ? "amber" : "red"}>{h.overall}</Badge> <span className="text-xs text-gray-500 font-normal">checked {fmtDate(h.checkedAt)}</span></>} actions={<button type="button" className={btn} onClick={health.reload}>Refresh</button>}>
          <Table rows={Object.entries(h.checks).map(([k, v]) => ({ id: k, k, ...v }))} columns={[
            { label: "Component", render: (r) => r.k.replace(/([A-Z])/g, " $1").toLowerCase() },
            { label: "Status", render: (r) => <Badge tone={tone(r.status)}>{r.status}</Badge> },
            { label: "Detail", render: (r) => <span className="text-xs text-gray-400">{Object.entries(r).filter(([key]) => !["id", "k", "status"].includes(key)).map(([key, v]) => `${key}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") || "—"}</span> },
          ]} />
          {h.capacity?.disk && <p className="text-xs text-gray-400 mt-2">Disk {h.capacity.disk.usedPercent}% used · database connections {h.capacity.database?.connectionUsePercent ?? "—"}%</p>}
        </Panel>
      )}</Section>
      {backups.data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Last backup" value={backups.data.lastBackupAgeHours === null ? "none" : `${backups.data.lastBackupAgeHours} h ago`} tone={backups.data.lastBackupAgeHours === null || backups.data.lastBackupAgeHours > 26 ? "text-red-300" : "text-white"} />
          <Stat label="WAL archive lag" value={backups.data.walArchive?.lagMinutes === null || !backups.data.walArchive ? "unknown" : `${backups.data.walArchive.lagMinutes} min`} />
          <Stat label="Last passed restore drill" value={backups.data.lastSuccessfulRestoreDrillAt ? fmtDate(backups.data.lastSuccessfulRestoreDrillAt) : "none"} tone={backups.data.lastSuccessfulRestoreDrillAt ? "text-white" : "text-red-300"} />
          <Stat label="Backup agent" value={backups.data.agentConfigured ? (backups.data.agentHeartbeatAgeSeconds === null ? "no heartbeat" : `heartbeat ${fmtSeconds(backups.data.agentHeartbeatAgeSeconds)} ago`) : "not configured"} />
        </div>
      )}
      {security.data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Open findings" value={security.data.openFindings} hint={Object.entries(security.data.findingsBySeverity || {}).map(([s, n]) => `${s} ${n}`).join(" · ")} />
          <Stat label="Blocking critical findings" value={security.data.blockingCriticalFindings} tone={security.data.blockingCriticalFindings ? "text-red-300" : "text-white"} />
          <Stat label="Secrets needing attention" value={security.data.secretsNeedingAttention} />
          <Stat label="Alerts firing" value={security.data.alertsFiring} />
        </div>
      )}
      <StatusNote>Evidence for review, not a compliance certification. RPO and RTO are planning targets until measured by a restore drill.</StatusNote>
    </div>
  );
}

// ─── Alerts and jobs ────────────────────────────────────────────────────────
export function AlertsTab({ can }) {
  const alerts = useAiLoad(() => api.listAlerts(), []);
  const jobs = useAiLoad(() => api.listJobRuns(), []);
  const [run, busy, error] = useAiAction();
  const manage = can("platform.alerts.manage");
  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      <Section load={alerts}>{(d) => (
        <Panel title="Alert events" actions={manage && <button type="button" className={btn} disabled={busy} onClick={() => run(() => api.evaluateAlerts(), alerts.reload)}>Evaluate now</button>}>
          <Table rows={d.events} empty="No alerts." columns={[
            { label: "Alert", render: (e) => <span>{e.message}</span> },
            { label: "Severity", render: (e) => <Badge tone={tone(e.severity)}>{e.severity}</Badge> },
            { label: "Status", render: (e) => <Badge tone={tone(e.status)}>{e.status}</Badge> },
            { label: "Count", key: "count" },
            { label: "Last fired", render: (e) => fmtDate(e.lastFiredAt) },
            { label: "", render: (e) => manage && e.status === "Firing" && <button type="button" className={btn} onClick={() => run(() => api.acknowledgeAlert(e.id), alerts.reload)}>Acknowledge</button> },
          ]} />
          <details className="mt-3"><summary className="text-xs text-gray-400 cursor-pointer">{d.policies.length} alert policies</summary>
            <Table rows={d.policies} columns={[
              { label: "Policy", render: (p) => p.title }, { label: "Signal", render: (p) => <code className="text-xs">{p.signal} {p.comparator} {p.threshold}</code> },
              { label: "Severity", render: (p) => <Badge tone={tone(p.severity)}>{p.severity}</Badge> }, { label: "Runbook", render: (p) => <span className="text-xs">{p.runbook}</span> },
              { label: "Enabled", render: (p) => (manage ? <button type="button" className={btn} onClick={() => run(() => api.updateAlertPolicy(p.key, { enabled: !p.enabled }), alerts.reload)}>{p.enabled ? "On" : "Off"}</button> : p.enabled ? "On" : "Off") },
            ]} />
          </details>
        </Panel>
      )}</Section>
      <Section load={jobs}>{(d) => (
        <Panel title="Platform jobs (latest runs)">
          <Table rows={d.runs.slice(0, 40)} columns={[
            { label: "Job", render: (r) => <code className="text-xs">{r.jobKey}</code> }, { label: "Status", render: (r) => <Badge tone={r.status === "Succeeded" ? "green" : r.status === "Running" ? "blue" : "red"}>{r.status}</Badge> },
            { label: "Attempt", key: "attempt" }, { label: "Started", render: (r) => fmtDate(r.startedAt) }, { label: "Duration", render: (r) => (r.durationMs === null ? "—" : `${r.durationMs} ms`) },
            { label: "Error", render: (r) => <span className="text-xs text-red-300">{r.error || ""}</span> },
          ]} />
        </Panel>
      )}</Section>
    </div>
  );
}

// ─── Security and secrets ───────────────────────────────────────────────────
export function SecurityTab({ can }) {
  const findings = useAiLoad(() => (can("platform.security.read") || can("platform.vulnerability.read") ? api.listFindings() : Promise.resolve({ findings: [] })), []);
  const secrets = useAiLoad(() => (can("platform.secrets.read_metadata") ? api.listSecrets() : Promise.resolve({ secrets: [] })), []);
  const [dialog, setDialog] = useState(null);
  const [run, , error] = useAiAction();
  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      <Section load={findings}>{(d) => (
        <Panel title="Security findings">
          <Table rows={d.findings} empty="No findings recorded." columns={[
            { label: "Finding", render: (f) => <span>{f.title}<span className="block text-[11px] text-gray-500">{f.source} · {f.component || "—"}{f.fixedVersion ? ` · fix: ${f.fixedVersion}` : ""}</span></span> },
            { label: "Severity", render: (f) => <Badge tone={tone(f.severity)}>{f.severity}</Badge> },
            { label: "Status", render: (f) => <Badge tone={tone(f.status)}>{f.status}</Badge> },
            { label: "Exceptions", render: (f) => (f.exceptions || []).map((e) => <span key={e.id} className="block text-[11px]">{e.status} · {e.scope} · until {fmtDate(e.expiresAt)}{can("platform.security.exception_approve") && e.status === "Requested" && <button type="button" className="ml-1 underline text-blue-300" onClick={() => setDialog({ kind: "decide", id: e.id })}>decide</button>}</span>) },
            { label: "", render: (f) => (can("platform.vulnerability.manage") || can("platform.security.manage")) && f.status !== "Resolved" && (
              <span className="flex gap-1 flex-wrap">
                <button type="button" className={btn} onClick={() => setDialog({ kind: "disposition", finding: f })}>Disposition…</button>
                {can("platform.security.exception") && <button type="button" className={btn} onClick={() => setDialog({ kind: "exception", finding: f })}>Request exception…</button>}
              </span>
            ) },
          ]} />
        </Panel>
      )}</Section>
      <Section load={secrets}>{(d) => (
        <Panel title="Secret inventory (metadata only — values are never shown)">
          <Table rows={d.secrets} columns={[
            { label: "Secret", render: (s) => <span><code className="text-xs">{s.secretKey}</code><span className="block text-[11px] text-gray-500">{s.purpose}</span></span> },
            { label: "Status", render: (s) => <Badge tone={tone(s.status)}>{s.status}</Badge> },
            { label: "Version", key: "currentVersion" }, { label: "Last rotated", render: (s) => fmtDate(s.lastRotatedAt) }, { label: "Next due", render: (s) => fmtDate(s.nextRotationDue) },
            { label: "", render: (s) => can("platform.secrets.rotate") && (
              <span className="flex gap-1 flex-wrap">
                <button type="button" className={btn} onClick={() => setDialog({ kind: "rotate", secret: s })}>Record rotation step…</button>
                <button type="button" className={btnDanger} onClick={() => setDialog({ kind: "revoke", secret: s })}>Emergency revoke…</button>
              </span>
            ) },
          ]} />
          <StatusNote>Rotation follows the runbook steps in order: create, accept both, (re-encrypt), verify, revoke old, complete.</StatusNote>
        </Panel>
      )}</Section>
      {(can("platform.roles.manage") || can("platform.security.manage")) && <AutomationTokens />}
      {dialog?.kind === "disposition" && <ReasonDialog title={`Disposition: ${dialog.finding.title}`} fields={[{ name: "disposition", label: "Disposition", type: "select", options: [["fixed", "Fixed"], ["false_positive", "False positive"], ["accepted_risk", "Accepted risk (not for Critical)"], ["reopen", "Reopen"]] }]}
        onSubmit={(v) => api.setDisposition(dialog.finding.id, { disposition: v.disposition || "fixed", note: v.reason, version: dialog.finding.version }).then(findings.reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "exception" && <ReasonDialog title="Request a time-limited exception" description="Critical findings allow at most 30 days and need an approver other than you. Scope a deployment gate as gate:<key>." fields={[{ name: "scope", label: "Scope", placeholder: "gate:dependency_scan" }, { name: "days", label: "Days", placeholder: "14" }]}
        onSubmit={(v) => api.requestException(dialog.finding.id, { scope: v.scope, days: Number(v.days) || 14, reason: v.reason }).then(findings.reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "decide" && <ReasonDialog title="Decide the exception" fields={[{ name: "approve", label: "Approve (unchecked rejects)", type: "checkbox" }]}
        onSubmit={(v) => api.decideException(dialog.id, { approve: !!v.approve, note: v.reason, separationException: v.reason }).then(findings.reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "rotate" && <ReasonDialog title={`Rotation step: ${dialog.secret.secretKey}`} fields={[{ name: "step", label: "Step completed", type: "select", options: ["Started", "New version created", "Consumers accept new version", "Re-encrypted", "Verified", "Old version revoked", "Completed"] }]}
        onSubmit={(v) => api.advanceRotation(dialog.secret.id, { step: v.step || "Started", reason: v.reason, version: dialog.secret.version }).then(secrets.reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "revoke" && <ReasonDialog danger title={`Emergency revoke ${dialog.secret.secretKey}`} description="Records the secret as compromised and opens a Critical finding that blocks deployments until resolved. Replace the value on the host with runbook 17." confirmLabel="Record revocation"
        onSubmit={(v) => run(() => api.emergencyRevoke(dialog.secret.id, v.reason), secrets.reload)} onClose={() => setDialog(null)} />}
    </div>
  );
}

// ─── Backups ────────────────────────────────────────────────────────────────
export function BackupsTab({ can }) {
  const artifacts = useAiLoad(() => api.listArtifacts(), []);
  const jobs = useAiLoad(() => api.listBackupJobs(), []);
  const [type, setType] = useState("full");
  const [run, busy, error] = useAiAction();
  const reload = () => { artifacts.reload(); jobs.reload(); };
  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      {can("platform.backup.run") && (
        <Panel title="Run a backup">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-gray-300">Type{" "}
              <select className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="full">Full</option><option value="diff">Differential</option><option value="incr">Incremental</option><option value="logical">Logical export</option><option value="configuration">Configuration</option>
              </select>
            </label>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => run(() => api.runBackup(type), reload)}>Run backup</button>
          </div>
          <StatusNote>A succeeded job is not a verified backup: verification and a restore drill are recorded separately.</StatusNote>
        </Panel>
      )}
      <Section load={artifacts}>{(d) => (
        <Panel title="Backup artifacts">
          <Table rows={d.artifacts} empty="No backups recorded in this environment yet." columns={[
            { label: "Backup", render: (a) => <span><code className="text-xs">{a.label}</code><span className="block text-[11px] text-gray-500">{a.backupType} · {a.tool} {a.toolVersion || ""} · {a.locationId}</span></span> },
            { label: "Status", render: (a) => <Badge tone={a.status === "Succeeded" ? "green" : "red"}>{a.status}</Badge> },
            { label: "Verification", render: (a) => <span><Badge tone={tone(a.verificationStatus)}>{a.verificationStatus}</Badge><span className="block text-[11px] text-gray-500">{(a.verifications || []).map((v) => `${v.check}:${v.status}`).join(" ")}</span></span> },
            { label: "Completed", render: (a) => fmtDate(a.completedAt) }, { label: "Size", render: (a) => fmtBytes(a.sizeBytes) },
            { label: "Encrypted", render: (a) => (a.encrypted ? "Yes" : <Badge tone="red">No</Badge>) },
            { label: "", render: (a) => can("platform.backup.verify") && <button type="button" className={btn} onClick={() => run(() => api.verifyArtifact(a.id), reload)}>Verify now</button> },
          ]} />
        </Panel>
      )}</Section>
      <Section load={jobs}>{(d) => (
        <Panel title="Backup jobs">
          <Table rows={d.jobs} empty="No jobs yet." columns={[
            { label: "Job", render: (j) => <code className="text-xs">{j.publicId}</code> }, { label: "Type", render: (j) => `${j.backupType} (${j.trigger})` },
            { label: "Status", render: (j) => <Badge tone={j.status === "Succeeded" ? "green" : ["Queued", "Dispatched", "Running"].includes(j.status) ? "blue" : "red"}>{j.status}</Badge> },
            { label: "Created", render: (j) => fmtDate(j.createdAt) }, { label: "Failure", render: (j) => <span className="text-xs text-red-300">{j.failureSummary || ""}</span> },
          ]} />
        </Panel>
      )}</Section>
    </div>
  );
}

// ─── Restores and drills ────────────────────────────────────────────────────
export function RestoresTab({ can }) {
  const restores = useAiLoad(() => api.listRestores(), []);
  const drills = useAiLoad(() => api.listRestoreDrills(), []);
  const artifacts = useAiLoad(() => (can("platform.restore.plan") ? api.listArtifacts() : Promise.resolve({ artifacts: [] })), []);
  const [dialog, setDialog] = useState(null);
  const [run, busy, error] = useAiAction();
  const good = (artifacts.data?.artifacts || []).filter((a) => a.status === "Succeeded");
  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      <div className="flex flex-wrap gap-2">
        {can("platform.restore.plan") && <button type="button" className={btnPrimary} disabled={!good.length} onClick={() => setDialog({ kind: "plan" })}>Plan a restore…</button>}
        {can("platform.restore.execute") && <>
          <button type="button" className={btn} disabled={busy} onClick={() => run(() => api.startRestoreDrill({ copy: "local" }), drills.reload)}>Start a restore drill</button>
          <button type="button" className={btn} disabled={busy} title="Restores the newest off-site backup; takes about 15–20 minutes over the network" onClick={() => run(() => api.startRestoreDrill({ copy: "offsite" }), drills.reload)}>Drill from the off-site copy</button>
        </>}
      </div>
      <Section load={restores}>{(d) => (
        <Panel title="Restore plans">
          <Table rows={d.plans} empty="No restores planned." columns={[
            { label: "Plan", render: (p) => <span><code className="text-xs">{p.id}</code><span className="block text-[11px] text-gray-500">{p.target} · {p.recoveryType}{p.recoveryTarget ? ` to ${fmtDate(p.recoveryTarget)}` : ""}</span></span> },
            { label: "Status", render: (p) => <Badge tone={tone(p.status)}>{p.status}</Badge> },
            { label: "WAL coverage", render: (p) => (p.walCoverageValidated ? "Validated" : <Badge tone="amber">Not validated</Badge>) },
            { label: "Executions", render: (p) => p.executions.map((e) => <span key={e.id} className="block text-[11px]">{e.status}{e.failureSummary ? ` — ${e.failureSummary}` : ""}</span>) },
            { label: "", render: (p) => (
              <span className="flex gap-1 flex-wrap">
                {can("platform.restore.approve") && p.status === "Awaiting approval" && <><button type="button" className={btnPrimary} onClick={() => setDialog({ kind: "approve", plan: p })}>Approve…</button><button type="button" className={btn} onClick={() => setDialog({ kind: "reject", plan: p })}>Reject…</button></>}
                {can("platform.restore.execute") && p.status === "Approved" && <button type="button" className={btnDanger} onClick={() => run(() => api.executeRestore(p.id), restores.reload)}>{p.target === "production" ? "Execute (manual runbook)" : "Execute into isolated target"}</button>}
              </span>
            ) },
          ]} />
        </Panel>
      )}</Section>
      <Section load={drills}>{(d) => (
        <Panel title="Restore drills (never against production)">
          <Table rows={d.drills} empty="No restore drills recorded — backups are unproven until one passes." columns={[
            { label: "Drill", render: (r) => <span>{r.scenario}<span className="block text-[11px] text-gray-500">{r.tool} · {r.target}</span></span> },
            { label: "Status", render: (r) => <Badge tone={tone(r.status)}>{r.status}</Badge> },
            { label: "Measured RTO", render: (r) => fmtSeconds(r.measuredRtoSeconds) }, { label: "Measured RPO", render: (r) => fmtSeconds(r.measuredRpoSeconds) },
            { label: "Completed", render: (r) => fmtDate(r.completedAt) }, { label: "Evidence", render: (r) => <span className="text-[11px] break-all">{r.evidence || "—"}</span> },
          ]} />
        </Panel>
      )}</Section>
      {dialog?.kind === "plan" && <ReasonDialog title="Plan a restore" requireReason={false}
        description="Isolated restores go to a new, separate instance and never touch the live database. A production target needs the full plan and is executed manually with runbook 05."
        fields={[
          { name: "sourceArtifactId", label: "Backup", type: "select", options: good.map((a) => [a.id, `${a.label} · ${fmtDate(a.completedAt)}`]) },
          { name: "recoveryType", label: "Recovery point", type: "select", options: [["latest", "Latest archived point"], ["time", "A specific time (UTC)"], ["full", "End of the backup"]] },
          { name: "recoveryTarget", label: "Time (ISO, for a specific time)", placeholder: "2026-09-25T09:30:00Z" },
          { name: "target", label: "Target", type: "select", options: [["isolated", "Isolated (new instance)"], ["production", "Production (manual, fully planned)"]] },
          { name: "incidentRef", label: "Incident or change reference" },
          { name: "impactAssessment", label: "Impact assessment (production)", type: "textarea" },
          { name: "maintenancePlan", label: "Maintenance plan (production)" }, { name: "communicationPlan", label: "Communication plan (production)" },
          { name: "rollForwardPlan", label: "Roll-forward plan (production)" }, { name: "rollbackPlan", label: "Rollback plan (production)" },
        ]}
        onSubmit={(v) => api.planRestore({ ...v, sourceArtifactId: v.sourceArtifactId || good[0]?.id, recoveryType: v.recoveryType || "latest", target: v.target || "isolated", recoveryTarget: v.recoveryTarget || undefined }).then(restores.reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "approve" && <ReasonDialog title="Approve the restore" description="You must be a different person from the requester. Check the recovery point and WAL coverage first."
        onSubmit={(v) => api.approveRestore(dialog.plan.id, { note: v.reason, separationException: v.reason }).then(restores.reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "reject" && <ReasonDialog title="Reject the restore" danger onSubmit={(v) => api.rejectRestore(dialog.plan.id, v.reason).then(restores.reload)} onClose={() => setDialog(null)} />}
    </div>
  );
}

// ─── Disaster recovery ──────────────────────────────────────────────────────
const INCIDENT_NEXT = { "Incident Declared": ["Containment"], Containment: ["Recovery"], Recovery: ["Validation", "Containment"], Validation: ["Service Restored", "Recovery"], "Service Restored": ["Post-Incident Review"], "Post-Incident Review": ["Closed"] };
const PLAN_NEXT = { Draft: ["Ready for Review"], "Ready for Review": ["Approved", "Draft"], Approved: ["Draft"] };

export function DisasterRecoveryTab({ can }) {
  const plans = useAiLoad(() => api.listDrPlans(), []);
  const incidents = useAiLoad(() => api.listIncidents(), []);
  const [dialog, setDialog] = useState(null);
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-4">
      {can("platform.dr.declare") && <button type="button" className={btnDanger} onClick={() => setDialog({ kind: "declare" })}>Declare a disaster…</button>}
      <Section load={incidents}>{(d) => (
        <Panel title="Incidents">
          <Table rows={d.incidents} empty="No disaster-recovery incidents." columns={[
            { label: "Incident", render: (i) => i.title }, { label: "Severity", render: (i) => <Badge tone={i.severity === "SEV-3" ? "amber" : "red"}>{i.severity}</Badge> },
            { label: "Status", render: (i) => <Badge>{i.status}</Badge> }, { label: "Declared", render: (i) => fmtDate(i.declaredAt) },
            { label: "", render: (i) => can("platform.dr.manage") && (INCIDENT_NEXT[i.status] || []).map((to) => <button key={to} type="button" className={`${btn} mr-1`} onClick={() => setDialog({ kind: "incident", incident: i, to })}>{to}</button>) },
          ]} />
        </Panel>
      )}</Section>
      <Section load={plans}>{(d) => (
        <Panel title={`Recovery plans (${d.plans.length})`}>
          <Table rows={d.plans} rowKey={(p) => p.key} columns={[
            { label: "Scenario", render: (p) => <button type="button" className="text-blue-300 underline text-left" onClick={() => setOpen(p)}>{p.title}</button> },
            { label: "Severity", key: "severity" }, { label: "Owner", key: "incidentOwnerRole" },
            { label: "RPO / RTO target", render: (p) => `${p.rpoTargetMinutes} min / ${p.rtoTargetMinutes} min` },
            { label: "State", render: (p) => <Badge tone={tone(p.status)}>{p.status}</Badge> },
            { label: "", render: (p) => can("platform.dr.manage") && (PLAN_NEXT[p.status] || []).map((to) => <button key={to} type="button" className={`${btn} mr-1`} onClick={() => setDialog({ kind: "plan", plan: p, to })}>{to}</button>) },
          ]} />
        </Panel>
      )}</Section>
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)}>
          <div className="text-sm space-y-2 text-gray-300">
            <p><b>Detection:</b> {open.detection}</p><p><b>Containment:</b> {open.containment}</p><p><b>Evidence:</b> {open.evidence}</p>
            <ol className="list-decimal ml-5 space-y-1">{(open.recoverySteps || []).map((s) => <li key={s}>{s}</li>)}</ol>
            <p><b>Backups needed:</b> {open.backupRequirements}</p><p><b>Communication:</b> {open.communication}</p>
            {open.singleHostNotes && <p className="text-amber-200 text-xs">{open.singleHostNotes}</p>}
          </div>
        </Modal>
      )}
      {dialog?.kind === "declare" && <ReasonDialog danger title="Declare a disaster" requireReason={false} confirmLabel="Declare"
        fields={[{ name: "planKey", label: "Plan", type: "select", options: (plans.data?.plans || []).map((p) => [p.key, p.title]) }, { name: "title", label: "Title" }, { name: "severity", label: "Severity", type: "select", options: ["SEV-1", "SEV-0", "SEV-2", "SEV-3"] }, { name: "summary", label: "Summary (no secrets or customer data)", type: "textarea" }]}
        onSubmit={(v) => api.declareIncident({ ...v, planKey: v.planKey || plans.data?.plans?.[0]?.key, severity: v.severity || "SEV-1" }).then(incidents.reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "incident" && <ReasonDialog title={`Move incident to ${dialog.to}`} description={dialog.to === "Closed" ? "Closing needs the post-incident review summary (timeline, root cause, actions, measured RPO/RTO)." : undefined}
        onSubmit={(v) => api.transitionIncident(dialog.incident.id, { to: dialog.to, note: v.reason, version: dialog.incident.version }).then(incidents.reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "plan" && <ReasonDialog title={`Move plan to ${dialog.to}`}
        onSubmit={(v) => api.transitionDrPlan(dialog.plan.key, { to: dialog.to, note: v.reason, version: dialog.plan.version }).then(plans.reload)} onClose={() => setDialog(null)} />}
    </div>
  );
}

// ─── Releases and deployments ───────────────────────────────────────────────
export function DeploymentsTab({ can }) {
  const releases = useAiLoad(() => api.listReleases(), []);
  const deployments = useAiLoad(() => api.listDeployments(), []);
  const [dialog, setDialog] = useState(null);
  const [open, setOpen] = useState(null);
  const approved = (releases.data?.releases || []).filter((r) => r.status === "Approved");
  return (
    <div className="space-y-4">
      {can("platform.deployment.plan") && <button type="button" className={btnPrimary} disabled={!approved.length} onClick={() => setDialog({ kind: "plan" })}>Plan a deployment…</button>}
      <Section load={releases}>{(d) => (
        <Panel title="Releases (immutable, pinned by digest)">
          <Table rows={d.releases} rowKey={(r) => r.releaseId} empty="No releases registered. Build one with deploy/production/scripts/build-release.sh." columns={[
            { label: "Release", render: (r) => <span><code className="text-xs">{r.releaseId}</code><span className="block text-[11px] text-gray-500">v{r.version} · {String(r.gitCommit).slice(0, 10)} · {r.migrationVersion}</span></span> },
            { label: "Status", render: (r) => <Badge tone={tone(r.status)}>{r.status}</Badge> },
            { label: "Migrations", render: (r) => (r.destructiveMigration ? <Badge tone="red">destructive</Badge> : "expand-only") },
            { label: "Built", render: (r) => fmtDate(r.buildTimestamp) },
            { label: "", render: (r) => can("platform.deployment.approve") && r.status !== "Approved" && <button type="button" className={btn} onClick={() => setDialog({ kind: "approveRelease", release: r })}>Approve…</button> },
          ]} />
        </Panel>
      )}</Section>
      <Section load={deployments}>{(d) => (
        <Panel title="Deployments">
          <Table rows={d.deployments} empty="No deployments planned." columns={[
            { label: "Deployment", render: (x) => <button type="button" className="text-blue-300 underline text-left" onClick={() => setOpen(x.id)}>{x.id}</button> },
            { label: "Release", render: (x) => <code className="text-xs">{x.releaseId}</code> },
            { label: "Status", render: (x) => <Badge tone={tone(x.status)}>{x.status}</Badge> },
            { label: "Created", render: (x) => fmtDate(x.createdAt) },
            { label: "Reason", render: (x) => <span className="text-xs text-red-300">{x.failureReason || ""}</span> },
          ]} />
        </Panel>
      )}</Section>
      {open && <DeploymentDetail id={open} can={can} releases={releases.data?.releases || []} onClose={() => { setOpen(null); deployments.reload(); }} />}
      {dialog?.kind === "plan" && <ReasonDialog title="Plan a deployment" requireReason={false}
        fields={[{ name: "releaseId", label: "Approved release", type: "select", options: approved.map((r) => [r.releaseId, `${r.releaseId} (v${r.version})`]) }, { name: "maintenanceRequired", label: "Maintenance window required", type: "checkbox" }, { name: "communicationNote", label: "Communication note", type: "textarea" }]}
        onSubmit={(v) => api.planDeployment({ ...v, releaseId: v.releaseId || approved[0]?.releaseId }).then(deployments.reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "approveRelease" && <ReasonDialog title={`Approve release ${dialog.release.releaseId}`} description="The person who registered the release can't approve it."
        onSubmit={(v) => api.approveRelease(dialog.release.releaseId, { decision: "approve", note: v.reason }).then(releases.reload)} onClose={() => setDialog(null)} />}
    </div>
  );
}

function DeploymentDetail({ id, can, releases, onClose }) {
  const d = useAiLoad(() => api.getDeployment(id), [id]);
  const [dialog, setDialog] = useState(null);
  const [run, busy, error] = useAiAction();
  const x = d.data;
  return (
    <Modal title={`Deployment ${id}`} onClose={onClose}>
      {d.loading && <Loading />}
      <ErrorBox error={d.error || error} />
      {x && (
        <div className="space-y-3 text-sm">
          <p><Badge tone={tone(x.status)}>{x.status}</Badge> <code className="text-xs">{x.releaseId}</code> {x.maintenanceRequired && <Badge tone="amber">maintenance</Badge>}</p>
          {x.failureReason && <p className="text-red-300 text-xs">{x.failureReason}</p>}
          <div className="flex flex-wrap gap-2">
            {can("platform.deployment.approve") && x.status === "Awaiting Approval" && <button type="button" className={btnPrimary} onClick={() => setDialog("approve")}>Approve…</button>}
            {can("platform.deployment.execute") && x.status === "Approved" && <button type="button" className={btnPrimary} disabled={busy} onClick={() => run(() => api.executeDeployment(id), d.reload)}>Run preflight gates</button>}
            {can("platform.deployment.rollback") && ["Completed", "Failed", "Verifying"].includes(x.status) && <button type="button" className={btnDanger} onClick={() => setDialog("rollback")}>Request rollback…</button>}
            {!["Completed", "Cancelled", "Rolled Back"].includes(x.status) && (can("platform.deployment.plan") || can("platform.deployment.approve")) && <button type="button" className={btn} onClick={() => setDialog("cancel")}>Cancel…</button>}
          </div>
          {x.status === "Deploying" && <StatusNote>Gates passed. On the host run: ./scripts/deploy.sh {id} {x.environment} (runbook 06).</StatusNote>}
          {x.status === "Rolling Back" && x.rollbackOfId && <StatusNote>Rollback approved. On the host run: ./scripts/rollback.sh {id} {x.environment} (runbook 08).</StatusNote>}
          {(x.rollbacks || []).length > 0 && (
            <>
              <h3 className="font-semibold">Rollbacks</h3>
              <Table rows={x.rollbacks} columns={[
                { label: "To release", render: (r) => <code className="text-xs">{r.targetReleaseId}</code> },
                { label: "Status", render: (r) => <Badge tone={tone(r.status)}>{r.status}</Badge> },
                { label: "Schema", render: (r) => <span className="text-[11px] text-gray-400">{r.schemaCompatible ? "compatible" : "not compatible"} — {r.reason}</span> },
                { label: "", render: (r) => can("platform.deployment.approve") && r.status === "Requested" && <button type="button" className={btnPrimary} onClick={() => setDialog({ kind: "approveRollback", rollback: r })}>Approve…</button> },
              ]} />
            </>
          )}
          <h3 className="font-semibold">Gates</h3>
          <Table rows={(x.gates || []).map((g) => ({ ...g, id: g.key }))} empty="Gates are evaluated when the deployment runs." columns={[
            { label: "Gate", render: (g) => g.key.replace(/_/g, " ") }, { label: "Result", render: (g) => <Badge tone={tone(g.status)}>{g.status}</Badge> },
            { label: "Detail", render: (g) => <span className="text-[11px] text-gray-400 break-all">{JSON.stringify(g.detail)}</span> },
          ]} />
          <h3 className="font-semibold">Events</h3>
          <ol className="text-xs space-y-1">{(x.events || []).map((e, i) => <li key={`${e.at}-${i}`}><span className="text-gray-500">{fmtDate(e.at)}</span> {e.type}{e.status ? ` → ${e.status}` : ""}{e.message ? ` — ${e.message}` : ""}{e.byAutomation ? " (host script)" : ""}</li>)}</ol>
        </div>
      )}
      {dialog === "approve" && <ReasonDialog title="Approve the deployment" description={SELF_APPROVAL_NOTE} onSubmit={(v) => api.approveDeployment(id, { note: v.reason, separationException: v.reason, version: x.version }).then(d.reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "approveRollback" && <ReasonDialog danger title={`Approve the rollback to ${dialog.rollback.targetReleaseId}`} description={`Starts a new deployment of ${dialog.rollback.targetReleaseId} with status Rolling Back; then run rollback.sh on the host. ${SELF_APPROVAL_NOTE}`}
        onSubmit={(v) => api.approveRollback(dialog.rollback.id, { separationException: v.reason }).then(onClose)} onClose={() => setDialog(null)} />}
      {dialog === "cancel" && <ReasonDialog danger title="Cancel the deployment" onSubmit={(v) => api.cancelDeployment(id, v.reason).then(d.reload)} onClose={() => setDialog(null)} />}
      {dialog === "rollback" && <ReasonDialog danger title="Request a rollback" requireReason={false} description="Schema compatibility is checked. If the schema moved past the target release, the rollback becomes Manual Recovery Required (forward fix or approved PITR)."
        fields={[{ name: "targetReleaseId", label: "Roll back to", type: "select", options: releases.filter((r) => r.releaseId !== x.releaseId).map((r) => [r.releaseId, `${r.releaseId} (v${r.version})`]) }]}
        onSubmit={(v) => api.requestRollback(id, { targetReleaseId: v.targetReleaseId || x.previousReleaseId || releases.find((r) => r.releaseId !== x.releaseId)?.releaseId, mode: "image" }).then(d.reload)} onClose={() => setDialog(null)} />}
    </Modal>
  );
}
