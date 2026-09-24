// /ai/releases — pinned release manifests, gates, separation-of-duties
// approvals, staged rollout (shadow → pilot → canary → general availability)
// and rollback. A successful deploy is never an approval.
import { useState } from "react";
import * as ai from "../../../Helpers/backendAiClient";
import { Badge, Table, ErrorBox, Loading, Modal } from "../../Admin/aiBackend/aiUi";
import { btn, btnPrimary, btnDanger, fmtDate, useAiLoad } from "../../Admin/aiBackend/aiKit";
import { AdminPage, ReasonDialog, StatusNote } from "./AdminShell";

const TONE = { Draft: "gray", Testing: "blue", "Evaluation failed": "red", "Awaiting approval": "amber", Approved: "blue", Shadow: "violet", Pilot: "violet", Canary: "violet", "Generally available": "green", Paused: "amber", "Rolled back": "red", Retired: "gray" };
const STAGES = [["shadow", "Shadow (no output shown)"], ["internal_pilot", "Internal pilot"], ["organization_pilot", "Organization pilot"], ["canary", "Canary"], ["generally_available", "Generally available"]];

export default function ReleasesPage() {
  return (
    <AdminPage title="AI Releases" requires={[["ai_governance", "read"]]} description="Each release pins its provider, model, prompts, tools, workflows, evaluation suite, budget and retention. Moderate- and high-risk releases need independent approval; general availability needs every readiness item and a production approval.">
      {(access) => <Releases access={access} />}
    </AdminPage>
  );
}

function Releases({ access }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listReleases(), []);
  const [dialog, setDialog] = useState(false);
  const [open, setOpen] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      {access.can("ai_releases", "create") && <button type="button" className={btnPrimary} onClick={() => setDialog(true)}>New release candidate</button>}
      <Table rows={data.releases} empty="No releases yet." columns={[
        { label: "Release", render: (r) => <button type="button" className="text-blue-300 underline" onClick={() => setOpen(r._id)}>{r.capabilityKey} v{r.version}</button> },
        { label: "Status", render: (r) => <Badge tone={TONE[r.status]}>{r.status}</Badge> }, { label: "Stage", render: (r) => r.stage.replace(/_/g, " ") }, { label: "Risk", render: (r) => r.riskLevel },
        { label: "Model", render: (r) => `${r.manifest?.providerKey}:${r.manifest?.modelId}` }, { label: "Gates", render: (r) => <span className="text-xs">{r.gates.map((g) => `${g.gateKey.replace(/_/g, " ")}: ${g.status}`).join(" · ")}</span> },
        { label: "Updated", render: (r) => fmtDate(r.updatedAt) },
      ]} />
      {dialog && (
        <ReasonDialog title="New release candidate" confirmLabel="Create" requireReason={false}
          fields={[{ name: "capabilityKey", label: "Capability key", defaultValue: "ai_copilot" }, { name: "providerKey", label: "Provider", defaultValue: "simulator" }, { name: "modelId", label: "Pinned model id", defaultValue: "sim-balanced" }, { name: "promptVersions", label: "Prompt versions (JSON)", defaultValue: '{"copilot.plan": 1, "copilot.answer": 1}' }, { name: "suite", label: "Evaluation suite key", defaultValue: "ai_copilot_release" }, { name: "notes", label: "Notes", type: "textarea" }]}
          onSubmit={(v) => ai.createRelease({ capabilityKey: v.capabilityKey, notes: v.notes, manifest: { providerKey: v.providerKey, modelId: v.modelId, promptVersions: v.promptVersions ? JSON.parse(v.promptVersions) : {}, evaluationSuite: { key: v.suite } } }).then(reload)} onClose={() => setDialog(false)} />
      )}
      {open && <ReleaseDetail id={open} access={access} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function ReleaseDetail({ id, access, onClose }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.getRelease(id), [id]);
  const [dialog, setDialog] = useState(null);
  const r = data?.release;
  const act = (action, body) => ai.releaseAction(id, action, body).then(reload);
  const live = r && ["Shadow", "Pilot", "Canary", "Generally available"].includes(r.status);
  return (
    <Modal title={r ? `${r.capabilityKey} v${r.version}` : "Release"} onClose={onClose}>
      {loading && <Loading />}
      <ErrorBox error={error} />
      {r && (
        <div className="space-y-3 text-sm">
          <p><Badge tone={TONE[r.status]}>{r.status}</Badge> <span className="text-gray-400">stage {r.stage.replace(/_/g, " ")} · risk {r.riskLevel} · {r.environment}</span></p>
          {r.promotionBlocked && <p role="alert" className="text-xs text-red-300">Promotion blocked: {r.promotionBlockReason}</p>}
          <div className="flex flex-wrap gap-2">
            {access.can("ai_releases", "create") && ["Draft", "Evaluation failed"].includes(r.status) && <button type="button" className={btn} onClick={() => act("submit")}>Submit for evaluation</button>}
            {access.can("ai_releases", "approve") && r.status === "Awaiting approval" && <button type="button" className={btnPrimary} onClick={() => setDialog("approve")}>Review…</button>}
            {access.can("ai_releases", "promote") && ["Approved", "Shadow", "Pilot", "Canary"].includes(r.status) && <button type="button" className={btnPrimary} onClick={() => setDialog("promote")}>Promote…</button>}
            {(access.can("ai_releases", "promote") || access.can("ai_releases", "rollback")) && live && <button type="button" className={btn} onClick={() => setDialog("pause")}>Pause</button>}
            {access.can("ai_releases", "rollback") && (live || r.status === "Paused" || r.status === "Approved") && <button type="button" className={btnDanger} onClick={() => setDialog("rollback")}>Roll back…</button>}
            {access.can("ai_releases", "promote") && r.status !== "Retired" && <button type="button" className={btn} onClick={() => setDialog("retire")}>Retire</button>}
          </div>
          <h3 className="font-semibold">Manifest <span className="text-xs text-gray-500">checksum {r.manifestChecksum.slice(0, 12)}</span></h3>
          <pre className="text-[11px] text-gray-400 whitespace-pre-wrap bg-gray-900/60 border border-gray-800 rounded-lg p-2">{JSON.stringify(r.manifest, null, 2)}</pre>
          <h3 className="font-semibold">Gates</h3>
          <ul className="text-xs space-y-1">{r.gates.map((g) => <li key={g.id}><Badge tone={g.status === "Passed" ? "green" : g.status === "Failed" ? "red" : "gray"}>{g.status}</Badge> {g.gateKey.replace(/_/g, " ")}{g.sampleSize ? ` · n=${g.sampleSize}` : ""}{g.datasetVersion ? ` · ${g.datasetVersion}` : ""}</li>)}</ul>
          <h3 className="font-semibold">Approvals</h3>
          <ul className="text-xs space-y-1">{r.approvals.map((a, i) => <li key={i}>{a.decision} ({a.role || "reviewer"}) — {a.reason} · {fmtDate(a.at)}</li>)}{!r.approvals.length && <li className="text-gray-500">None yet.</li>}</ul>
          <h3 className="font-semibold">Cohorts</h3>
          <ul className="text-xs space-y-1">{r.cohorts.map((c) => <li key={c.id}>{c.stage.replace(/_/g, " ")} · {c.status} · {JSON.stringify(c.rules)} · stop {JSON.stringify(c.stopConditions)}</li>)}{!r.cohorts.length && <li className="text-gray-500">None.</li>}</ul>
          <h3 className="font-semibold">Production readiness {data.readiness.complete ? <Badge tone="green">Complete</Badge> : <Badge tone="amber">{data.readiness.incomplete.length} open</Badge>}</h3>
          <p className="text-xs text-gray-400">{data.readiness.items.filter((i) => i.status !== "Complete").map((i) => i.label).join(" · ") || "All mandatory items are complete."}</p>
          <StatusNote>A successful deployment never approves general availability. Rolled-back releases can't be promoted again without review.</StatusNote>
        </div>
      )}
      {dialog === "approve" && <ReasonDialog title="Review this release" confirmLabel="Record" description="The author (and the authors of its prompts) can't approve it." fields={[{ name: "decision", label: "Decision", type: "select", options: ["Approve", "Reject", "Request changes", "Escalate"] }]} onSubmit={(v) => act("approve", { decision: v.decision || "Approve", reason: v.reason })} onClose={() => setDialog(null)} />}
      {dialog === "promote" && <ReasonDialog title="Promote" confirmLabel="Promote"
        fields={[{ name: "stage", label: "Stage", type: "select", options: STAGES }, { name: "roleKeys", label: "Cohort role keys (comma-separated)", defaultValue: "admin" }, { name: "percentage", label: "Cohort percentage (canary)", defaultValue: "10" }, { name: "stop", label: "Canary stop conditions (JSON)", defaultValue: '{"validationFailureRate": 10, "providerErrorRate": 10, "p95LatencyMs": 60000}' }, { name: "dataPolicyApproved", label: "Data-policy approval recorded (shadow)", type: "checkbox" }, { name: "budgetAuthorized", label: "Budget authorized (shadow)", type: "checkbox" }, { name: "productionApproval", label: "Record production approval (general availability)", type: "checkbox" }]}
        onSubmit={(v) => { const stage = v.stage || "shadow"; const cohort = ["internal_pilot", "organization_pilot", "canary"].includes(stage) ? { rules: { roleKeys: v.roleKeys ? v.roleKeys.split(",").map((s) => s.trim()).filter(Boolean) : [], ...(stage === "canary" && { percentage: Number(v.percentage) || 10 }) }, stopConditions: stage === "canary" ? JSON.parse(v.stop || "{}") : {} } : undefined; return act("promote", { stage, reason: v.reason, cohort, dataPolicyApproved: v.dataPolicyApproved, budgetAuthorized: v.budgetAuthorized, productionApproval: v.productionApproval }); }}
        onClose={() => setDialog(null)} />}
      {dialog === "pause" && <ReasonDialog title="Pause release" confirmLabel="Pause" onSubmit={(v) => act("pause", { reason: v.reason })} onClose={() => setDialog(null)} />}
      {dialog === "rollback" && <ReasonDialog title="Roll back" danger confirmLabel="Roll back" description="Restores the last approved release for this capability, keeps conversations and audit history, and blocks this release from being promoted again without review." onSubmit={(v) => act("rollback", { reason: v.reason })} onClose={() => setDialog(null)} />}
      {dialog === "retire" && <ReasonDialog title="Retire release" confirmLabel="Retire" onSubmit={(v) => act("retire", { reason: v.reason })} onClose={() => setDialog(null)} />}
    </Modal>
  );
}
