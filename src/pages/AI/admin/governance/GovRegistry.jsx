// Governance → Registry: providers (unverified until confirmed), models
// (pinned versions, evidence-based approval), prompts (immutable versions;
// the author can't approve or publish), tools and workflows (deny by default).
import { useState } from "react";
import * as ai from "../../../../Helpers/backendAiClient";
import { Badge, Table, ErrorBox, Loading, Modal } from "../../../Admin/aiBackend/aiUi";
import { btn, fmtDate, useAiLoad } from "../../../Admin/aiBackend/aiKit";
import { Tabs, ReasonDialog, StatusNote } from "../AdminShell";

const NEXT = {
  prompt: { Draft: ["Internal testing"], "Internal testing": ["Evaluation", "Draft"], Evaluation: ["Under review", "Draft"], "Under review": ["Approved", "Draft"], Approved: ["Active", "Retired"], Active: ["Retired"], Superseded: ["Retired"] },
  tool: { Draft: ["Under review"], "Under review": ["Approved", "Draft"], Approved: ["Active", "Retired"], Active: ["Paused", "Retired"], Paused: ["Active", "Retired"] },
};

export function GovRegistry({ access }) {
  const [tab, setTab] = useState("providers");
  return (
    <div className="space-y-3">
      <Tabs label="Registry" value={tab} onChange={setTab} tabs={[["providers", "Providers"], ["models", "Models"], ["prompts", "Prompts"], ["tools", "Tools"], ["workflows", "Workflows"]]} />
      {tab === "providers" && <Providers access={access} />}
      {tab === "models" && <Models access={access} />}
      {tab === "prompts" && <Prompts access={access} />}
      {tab === "tools" && <Transitions kind="tool" access={access} />}
      {tab === "workflows" && <Transitions kind="workflow" access={access} />}
    </div>
  );
}

function Providers({ access }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listProviderGovernance(), []);
  const [dialog, setDialog] = useState(null);
  const can = access.can("ai_gov_providers", "manage");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <Table rowKey={(r) => r.providerKey} rows={data.providers} columns={[
        { label: "Provider", render: (p) => p.providerKey }, { label: "Status", render: (p) => <Badge>{p.status}</Badge> }, { label: "Credentials", render: (p) => p.credentialStatus },
        { label: "DPA", render: (p) => p.dpaStatus }, { label: "Residency", render: (p) => p.residencyStatus }, { label: "Retention", render: (p) => p.retentionMode }, { label: "Zero retention", render: (p) => p.zdrEligibility },
        { label: "Verified", render: (p) => fmtDate(p.lastVerifiedAt) },
        { label: "", render: (p) => can && <span className="flex gap-1"><button type="button" className={btn} onClick={() => ai.verifyProviderGovernance(p.providerKey).then(reload)}>Verify</button><button type="button" className={btn} onClick={() => setDialog(p)}>Record review</button></span> },
      ]} />
      <StatusNote>{data.providers[0]?.note}</StatusNote>
      {dialog && (
        <ReasonDialog title={`Record governance review: ${dialog.providerKey}`} confirmLabel="Save" requireReason={false}
          fields={[
            { name: "dpaStatus", label: "Data-processing agreement", type: "select", options: ["Unverified", "Confirmed", "Not applicable"], defaultValue: dialog.dpaStatus },
            { name: "residencyStatus", label: "Data residency", type: "select", options: ["Unverified", "Confirmed", "Not applicable"], defaultValue: dialog.residencyStatus },
            { name: "zdrEligibility", label: "Zero data retention", type: "select", options: ["Unverified", "Eligible (verified for this account, model and feature)", "Not eligible"], defaultValue: dialog.zdrEligibility },
            { name: "contractOwner", label: "Contract owner", defaultValue: dialog.contractOwner || "" }, { name: "incidentContact", label: "Incident contact", defaultValue: dialog.incidentContact || "" },
            { name: "confirmationNote", label: "What was reviewed (required to confirm)", type: "textarea" },
          ]}
          onSubmit={(v) => ai.updateProviderGovernance(dialog.providerKey, { ...v, securityReviewed: true }).then(reload)} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

function Models({ access }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listModelGovernance(), []);
  const [dialog, setDialog] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const canApprove = access.can("ai_releases", "approve") || access.can("ai_safety", "review");
  return (
    <>
      <Table rows={data.models} rowKey={(m) => m.id} columns={[
        { label: "Model", render: (m) => <span>{m.displayName} <span className="text-gray-500 text-xs">{m.providerKey}:{m.modelId}</span></span> },
        { label: "Pinned", render: (m) => (m.pinned ? "Yes" : <Badge tone="amber">Moving alias</Badge>) }, { label: "Evaluation", render: (m) => m.evaluationStatus },
        { label: "Release", render: (m) => <Badge>{m.releaseStatus}</Badge> }, { label: "Deprecation", render: (m) => fmtDate(m.deprecationAt) },
        { label: "", render: (m) => <span className="flex gap-1">{access.can("ai_gov_models", "manage") && <button type="button" className={btn} onClick={() => setDialog({ kind: "status", m })}>Change</button>}{canApprove && m.releaseStatus !== "Approved" && <button type="button" className={btn} onClick={() => setDialog({ kind: "approve", m })}>Approve</button>}</span> },
      ]} />
      <StatusNote>A model change needs a passing evaluation with the model as candidate, a comparison (evaluation, cost, latency), someone other than its configurer, a release and a canary. Nothing migrates automatically.</StatusNote>
      {dialog?.kind === "status" && <ReasonDialog title={`Change ${dialog.m.modelId}`} confirmLabel="Save" fields={[{ name: "releaseStatus", label: "Release status", type: "select", options: ["Draft", "Blocked", "Retired"], defaultValue: dialog.m.releaseStatus === "Approved" ? "Draft" : dialog.m.releaseStatus }, { name: "deprecationAt", label: "Deprecation date (YYYY-MM-DD, optional)", defaultValue: dialog.m.deprecationAt?.slice(0, 10) || "" }]} onSubmit={(v) => ai.updateModelGovernance(dialog.m.id, { releaseStatus: v.releaseStatus, deprecationAt: v.deprecationAt || null, reason: v.reason }).then(reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "approve" && <ReasonDialog title={`Approve ${dialog.m.modelId}`} confirmLabel="Approve" fields={[{ name: "runId", label: "Passing evaluation run id (this model as candidate)" }, { name: "comparisonId", label: "Comparison id" }]} onSubmit={(v) => ai.approveModelGovernance(dialog.m.id, v).then(reload)} onClose={() => setDialog(null)} />}
    </>
  );
}

function Prompts({ access }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listPromptGovernance(), []);
  const [dialog, setDialog] = useState(null);
  const [view, setView] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const canManage = access.can("ai_gov_prompts", "manage");
  const canMove = canManage || access.can("ai_releases", "approve");
  return (
    <>
      {canManage && <button type="button" className={btn} onClick={() => setDialog({ kind: "create" })}>New prompt version</button>}
      <Table rows={data.prompts} rowKey={(p) => p.id} columns={[
        { label: "Prompt", render: (p) => <button type="button" className="text-blue-300 underline" onClick={() => setView(p.id)}>{p.promptKey} v{p.version}</button> },
        { label: "Status", render: (p) => <Badge>{p.status}</Badge> }, { label: "Capability", render: (p) => p.capabilityKey }, { label: "Checksum", render: (p) => p.checksum },
        { label: "Change", render: (p) => <span className="text-xs text-gray-400">{p.changeSummary}</span> },
        { label: "", render: (p) => canMove && (NEXT.prompt[p.status] || []).length > 0 && <button type="button" className={btn} onClick={() => setDialog({ kind: "move", p })}>Move…</button> },
      ]} />
      <StatusNote>Published prompts are immutable and never edited in place. System instructions can't contain placeholders, so CRM values never reach them. The author can't approve or publish their own version.</StatusNote>
      {dialog?.kind === "create" && <ReasonDialog title="New prompt version" confirmLabel="Create draft" requireReason={false} fields={[{ name: "promptKey", label: "Prompt", type: "select", options: [...new Set(data.prompts.map((p) => p.promptKey))] }, { name: "system", label: "System instructions (no placeholders)", type: "textarea" }, { name: "userTemplate", label: "User template (CRM data only inside <data>…</data>)", type: "textarea" }, { name: "changeSummary", label: "Change summary" }]} onSubmit={(v) => ai.createPromptVersion({ ...v, promptKey: v.promptKey || data.prompts[0]?.promptKey }).then(reload)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "move" && <ReasonDialog title={`Move ${dialog.p.promptKey} v${dialog.p.version}`} confirmLabel="Move" fields={[{ name: "to", label: "To", type: "select", options: NEXT.prompt[dialog.p.status] }, { name: "runId", label: "Evaluation run id (needed for review/approval)" }]} onSubmit={(v) => ai.transitionPrompt(dialog.p.id, v.to || NEXT.prompt[dialog.p.status][0], v.reason, v.runId || null).then(reload)} onClose={() => setDialog(null)} />}
      {view && <PromptView id={view} onClose={() => setView(null)} />}
    </>
  );
}

function PromptView({ id, onClose }) {
  const { data, error, loading } = useAiLoad(() => ai.getPromptGovernance(id), [id]);
  return (
    <Modal title="Prompt version" onClose={onClose}>
      {loading && <Loading />}
      <ErrorBox error={error} />
      {data && (
        <div className="space-y-2 text-xs">
          <p><b>{data.prompt.promptKey} v{data.prompt.version}</b> <Badge>{data.prompt.status}</Badge></p>
          <p className="text-gray-500">Templates hold placeholders only — no CRM data.</p>
          <h4 className="font-semibold text-gray-300">System</h4><pre className="whitespace-pre-wrap text-gray-400">{data.template.system}</pre>
          <h4 className="font-semibold text-gray-300">User template</h4><pre className="whitespace-pre-wrap text-gray-400">{data.template.userTemplate}</pre>
        </div>
      )}
    </Modal>
  );
}

function Transitions({ kind, access }) {
  const load = kind === "tool" ? ai.listToolGovernance : ai.listWorkflowGovernance;
  const { data, error, loading, reload } = useAiLoad(() => load(), [kind]);
  const [dialog, setDialog] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const rows = kind === "tool" ? data.tools : data.workflows;
  const canMove = access.can(kind === "tool" ? "ai_gov_tools" : "ai_gov_workflows", "manage") || access.can("ai_releases", "approve");
  const move = kind === "tool" ? ai.transitionTool : ai.transitionWorkflow;
  return (
    <>
      {kind === "workflow" && access.can("ai_gov_workflows", "manage") && <button type="button" className={btn} onClick={() => ai.registerWorkflowVersions().then(reload)}>Register changed workflow code as new versions</button>}
      <Table rows={rows} rowKey={(r) => r.id} columns={kind === "tool" ? [
        { label: "Tool", render: (t) => `${t.toolName}@${t.version}` }, { label: "Kind", render: (t) => t.kind }, { label: "Risk", render: (t) => t.riskLevel }, { label: "Permission", render: (t) => t.requiredPermission || "—" },
        { label: "Status", render: (t) => <Badge tone={t.status === "Active" ? "green" : "gray"}>{t.status}</Badge> },
        { label: "", render: (t) => canMove && (NEXT.tool[t.status] || []).length > 0 && <button type="button" className={btn} onClick={() => setDialog(t)}>Move…</button> },
      ] : [
        { label: "Workflow", render: (w) => `${w.workflowKey} v${w.version}` }, { label: "Steps", render: (w) => (w.steps || []).length }, { label: "Limits", render: (w) => `${w.maxToolCalls} tools · ${Math.round(w.maxRuntimeMs / 1000)} s · $${Number(w.maxCostUsd)}` },
        { label: "Status", render: (w) => <Badge tone={w.status === "Active" ? "green" : "gray"}>{w.status}</Badge> },
        { label: "", render: (w) => canMove && (NEXT.tool[w.status] || []).length > 0 && <button type="button" className={btn} onClick={() => setDialog(w)}>Move…</button> },
      ]} />
      <StatusNote>{kind === "tool" ? data.note : "Only the Active version whose steps match the code runs; the model can't add steps."}</StatusNote>
      {dialog && <ReasonDialog title={`Move ${dialog.toolName || dialog.workflowKey}`} confirmLabel="Move" fields={[{ name: "to", label: "To", type: "select", options: NEXT.tool[dialog.status] }, { name: "runId", label: "Evaluation run id (optional: the latest passing suite is used)" }]} onSubmit={(v) => move(dialog.id, v.to || NEXT.tool[dialog.status][0], v.reason, v.runId || null).then(reload)} onClose={() => setDialog(null)} />}
    </>
  );
}
