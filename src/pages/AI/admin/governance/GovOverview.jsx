// Governance → Overview and Capabilities (with the readiness checklist).
import { useState } from "react";
import * as ai from "../../../../Helpers/backendAiClient";
import { Badge, Panel, Table, ErrorBox, Loading, SimulatorBanner, Modal } from "../../../Admin/aiBackend/aiUi";
import { btn, fmtDate, useAiLoad, useAiAction } from "../../../Admin/aiBackend/aiKit";
import { Stat, ReasonDialog, StatusNote } from "../AdminShell";

const RISK_TONE = { Low: "green", Moderate: "amber", High: "red", Prohibited: "red" };
const STATUS_TONE = { Approved: "blue", "Ready for pilot": "blue", Pilot: "violet", Canary: "violet", "Generally available": "green", Paused: "amber", Blocked: "red", "Rolled back": "amber", Retired: "gray", "Evaluation failed": "red", Draft: "gray", "Not configured": "gray" };

export function GovOverview() {
  const { data, error, loading, reload } = useAiLoad(() => ai.governanceDashboard(), []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data;
  return (
    <div className="space-y-4">
      {d.simulatorLabel && <SimulatorBanner label={d.simulatorLabel} />}
      <p className="text-xs text-gray-400">{d.note} Environment: <b>{d.environment}</b>.</p>
      {(d.enablement.globalKillSwitch || d.enablement.organizationKillSwitch) && <p role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{d.enablement.globalKillSwitch ? "The global AI kill switch is active: all AI is paused." : "AI is paused for this organization."}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Stat label="Capabilities enabled here" value={`${d.capabilities.filter((c) => c.enabledForOrganization).length} / ${d.capabilities.length}`} />
        <Stat label="Active prompts" value={d.prompts.active} hint={`${d.prompts.pending} pending`} />
        <Stat label="Active tools" value={`${d.tools.active} / ${d.tools.total}`} hint="deny by default" />
        <Stat label="Active workflows" value={`${d.workflows.active} / ${d.workflows.total}`} />
        <Stat label="Open reviews" value={d.openReviews} />
        <Stat label="Active incidents" value={d.activeIncidents.length} tone={d.activeIncidents.length ? "text-amber-300" : "text-white"} />
      </div>
      <Panel title="Capabilities">
        <Table rowKey={(r) => r.key} rows={d.capabilities} columns={[
          { label: "Capability", render: (c) => c.name }, { label: "Risk", render: (c) => <Badge tone={RISK_TONE[c.riskLevel]}>{c.riskLevel}</Badge> },
          { label: "Status", render: (c) => <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge> }, { label: "Here", render: (c) => (c.enabledForOrganization ? "Enabled" : "Off") },
          { label: "Kill switch", render: (c) => (c.killSwitch ? <Badge tone="red">Active</Badge> : "—") }, { label: "Next review", render: (c) => fmtDate(c.nextReviewAt) },
        ]} />
      </Panel>
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Providers">
          <Table rowKey={(r) => r.providerKey} rows={d.providers} columns={[{ label: "Provider", render: (p) => p.providerKey }, { label: "Status", render: (p) => <Badge>{p.status}</Badge> }, { label: "DPA", render: (p) => p.dpaStatus }, { label: "Zero retention", render: (p) => p.zdrEligibility }, { label: "Verified", render: (p) => fmtDate(p.lastVerifiedAt) }]} />
          <StatusNote>Contract, residency and retention fields stay Unverified until an authorized administrator confirms them.</StatusNote>
        </Panel>
        <Panel title="Recent releases and evaluations">
          <ul className="text-sm space-y-1">
            {d.releases.map((r) => <li key={r._id} className="flex gap-2 items-center"><Badge>{r.status}</Badge><span className="truncate">{r.capabilityKey} v{r.version} · {r.stage}</span></li>)}
            {d.evaluations.map((r) => <li key={r._id} className="flex gap-2 items-center"><Badge>{r.status}</Badge><span className="truncate">Run {r._id} · {r.passed}/{r.sampleSize} passed</span></li>)}
            {!d.releases.length && !d.evaluations.length && <li className="text-gray-500">Nothing yet.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

export function GovCapabilities({ canManage }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listCapabilities(), []);
  const [open, setOpen] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <Table rowKey={(r) => r.key} rows={data.capabilities} columns={[
        { label: "Capability", render: (c) => <button type="button" className="text-blue-300 underline text-left" onClick={() => setOpen(c.key)}>{c.name}</button> },
        { label: "Risk", render: (c) => <Badge tone={RISK_TONE[c.riskLevel]}>{c.riskLevel}</Badge> }, { label: "Status", render: (c) => <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge> },
        { label: "Owners", render: (c) => <span className="text-xs text-gray-400">{Object.values(c.owners || {}).join(" · ")}</span> },
        { label: "Suite", render: (c) => c.evaluationSuiteKey || "—" }, { label: "Sunset", render: (c) => fmtDate(c.sunsetAt) },
      ]} />
      {open && <CapabilityDetail capabilityKey={open} canManage={canManage} onClose={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function CapabilityDetail({ capabilityKey, canManage, onClose }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.getCapability(capabilityKey), [capabilityKey]);
  const [confirming, setConfirming] = useState(null);
  const [, , actionError] = useAiAction();
  return (
    <Modal title={data?.capability?.name || "Capability"} onClose={onClose}>
      {loading && <Loading />}
      <ErrorBox error={error || actionError} />
      {data && (
        <div className="space-y-3 text-sm">
          <p className="text-gray-300">{data.capability.purpose}</p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-gray-500">Roles</dt><dd>{(data.capability.roles || []).join(", ")}</dd>
            <dt className="text-gray-500">Modules</dt><dd>{(data.capability.modules || []).join(", ") || "—"}</dd>
            <dt className="text-gray-500">Permitted data</dt><dd>{(data.capability.dataClassifications?.permitted || []).join(", ")}</dd>
            <dt className="text-gray-500">Prohibited data</dt><dd>{(data.capability.dataClassifications?.prohibited || []).join(", ")}</dd>
            <dt className="text-gray-500">Providers</dt><dd>{(data.capability.providers || []).join(", ") || "—"}</dd>
            <dt className="text-gray-500">Prompts / tools / workflows</dt><dd>{[...(data.capability.promptVersions || []), ...(data.capability.toolVersions || []), ...(data.capability.workflowVersions || [])].join(", ") || "—"}</dd>
          </dl>
          <h3 className="font-semibold text-white">Production readiness {data.readiness.complete ? <Badge tone="green">Complete</Badge> : <Badge tone="amber">Incomplete</Badge>}</h3>
          <ul className="space-y-1">
            {data.readiness.items.map((i) => (
              <li key={i.key} className="flex items-center gap-2 text-xs">
                <Badge tone={i.status === "Complete" ? "green" : "gray"}>{i.status}</Badge>
                <span className="flex-1">{i.label} <span className="text-gray-500">({i.source})</span></span>
                {i.source === "manual" && canManage && <button type="button" className={btn} onClick={() => setConfirming(i)}>Record</button>}
              </li>
            ))}
          </ul>
          <StatusNote>{data.readiness.note}</StatusNote>
        </div>
      )}
      {confirming && (
        <ReasonDialog title={`Record: ${confirming.label}`} confirmLabel="Save" requireReason={false}
          fields={[{ name: "status", label: "Status", type: "select", options: ["Complete", "Incomplete"] }, { name: "evidence", label: "Evidence (what was checked, where, by whom)", type: "textarea" }]}
          onSubmit={(v) => ai.confirmReadiness(capabilityKey, confirming.key, v.status, v.evidence).then(reload)} onClose={() => setConfirming(null)} />
      )}
    </Modal>
  );
}
