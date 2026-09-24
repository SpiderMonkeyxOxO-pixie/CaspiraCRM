// Governance → Policies: immutable versions, submit, approve (separation of
// duties), reject, pause/resume; activation blockers are shown as returned.
import { useState } from "react";
import * as ai from "../../../../Helpers/backendAiClient";
import { Badge, Table, ErrorBox, Loading, Modal } from "../../../Admin/aiBackend/aiUi";
import { btn, btnPrimary, fmtDate, useAiLoad } from "../../../Admin/aiBackend/aiKit";
import { ReasonDialog, StatusNote } from "../AdminShell";

const parseBody = (text) => { try { return JSON.parse(text || "{}"); } catch { throw new Error("The policy body must be valid JSON."); } };
const EXAMPLE = JSON.stringify({ allowedProviders: ["simulator"], allowedModels: [], permittedData: ["Internal", "Confidential"], prohibitedData: ["Restricted", "Secret"], humanApprovals: ["Every proposal"], retention: { requestPayloadDays: 7 }, budget: { monthlyUsd: 50 }, rollbackTarget: "previous approved release" }, null, 2);

export function GovPolicies({ access }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.listPolicies(), []);
  const [dialog, setDialog] = useState(null);
  const [open, setOpen] = useState(null);
  const canCreate = access.can("ai_gov_policies", "create");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      {canCreate && <button type="button" className={btnPrimary} onClick={() => setDialog("create")}>New policy</button>}
      <Table rows={data.policies} empty="No governance policies yet." columns={[
        { label: "Policy", render: (p) => <button type="button" className="text-blue-300 underline" onClick={() => setOpen(p._id)}>{p.name}</button> },
        { label: "Capability", render: (p) => p.capabilityKey || "—" }, { label: "Risk", render: (p) => p.riskLevel }, { label: "Status", render: (p) => <Badge>{p.status}</Badge> },
        { label: "Versions", render: (p) => p.latestVersion }, { label: "Updated", render: (p) => fmtDate(p.updatedAt) },
      ]} />
      <StatusNote>Every change is a new immutable version. For moderate and high risk the author can never be the only approver, and a version only becomes active when evaluation, provider verification, retention, budget, monitoring and rollback prerequisites are met.</StatusNote>
      {dialog === "create" && (
        <ReasonDialog title="New governance policy" confirmLabel="Create draft" requireReason={false}
          fields={[{ name: "name", label: "Name" }, { name: "capabilityKey", label: "Capability key (e.g. ai_copilot)" }, { name: "body", label: "Policy body (JSON)", type: "textarea", defaultValue: EXAMPLE }]}
          onSubmit={(v) => ai.createPolicy({ name: v.name, capabilityKey: v.capabilityKey || null, body: parseBody(v.body) }).then(reload)} onClose={() => setDialog(null)} />
      )}
      {open && <PolicyDetail id={open} access={access} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function PolicyDetail({ id, access, onClose }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.getGovernancePolicy(id), [id]);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const p = data?.policy;
  const act = (action, extra = {}) => ai.policyAction(id, action, extra).then((out) => { setNotice(out.pending ? `Approval recorded: ${out.pending}.` : out.blockers?.length ? `Approved but not active yet: ${out.blockers.join(" ")}` : null); return reload(); });
  return (
    <Modal title={p?.name || "Policy"} onClose={onClose}>
      {loading && <Loading />}
      <ErrorBox error={error} />
      {notice && <p role="status" className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">{notice}</p>}
      {p && (
        <div className="space-y-3 text-sm">
          <p><Badge>{p.status}</Badge> <span className="text-gray-400">risk {p.riskLevel} · capability {p.capabilityKey || "—"}</span></p>
          {data.blockers?.length > 0 && <div className="text-xs text-amber-200"><p className="font-medium">Activation prerequisites not met:</p><ul className="list-disc pl-4">{data.blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>}
          <div className="flex flex-wrap gap-2">
            {access.can("ai_gov_policies", "create") && <button type="button" className={btn} onClick={() => setDialog("version")}>New version</button>}
            {access.can("ai_gov_policies", "create") && <button type="button" className={btn} onClick={() => act("submit")}>Submit latest</button>}
            {access.can("ai_gov_policies", "approve") && <button type="button" className={btnPrimary} onClick={() => setDialog("approve")}>Approve</button>}
            {(access.can("ai_gov_policies", "review") || access.can("ai_gov_policies", "approve")) && <button type="button" className={btn} onClick={() => setDialog("reject")}>Request changes</button>}
            {access.can("ai_gov_policies", "approve") && p.status !== "Paused" && <button type="button" className={btn} onClick={() => setDialog("pause")}>Pause</button>}
            {access.can("ai_gov_policies", "approve") && ["Paused", "Approved"].includes(p.status) && <button type="button" className={btn} onClick={() => act("activate")}>{p.status === "Paused" ? "Resume" : "Activate"}</button>}
          </div>
          <h3 className="font-semibold">Versions</h3>
          <ul className="space-y-2">
            {p.versions.map((v) => (
              <li key={v._id} className="border border-gray-800 rounded-lg p-2">
                <p className="text-xs"><b>v{v.version}</b> <Badge>{v.status}</Badge> <span className="text-gray-500">{v.changeSummary} · {fmtDate(v.createdAt)} · checksum {v.checksum.slice(0, 10)}</span></p>
                <pre className="text-[11px] text-gray-400 whitespace-pre-wrap mt-1">{JSON.stringify(v.body, null, 2)}</pre>
              </li>
            ))}
          </ul>
          <h3 className="font-semibold">Reviews</h3>
          <ul className="text-xs space-y-1">{p.approvals.map((a, i) => <li key={i}>{a.decision} v{a.version} ({a.role || "reviewer"}) — {a.reason} · {fmtDate(a.at)}</li>)}{!p.approvals.length && <li className="text-gray-500">None yet.</li>}</ul>
        </div>
      )}
      {dialog === "version" && <ReasonDialog title="New policy version" confirmLabel="Save version" requireReason={false} fields={[{ name: "body", label: "Policy body (JSON)", type: "textarea", defaultValue: JSON.stringify(p.versions[0]?.body || {}, null, 2) }, { name: "changeSummary", label: "Change summary" }]} onSubmit={(v) => ai.addPolicyVersion(id, parseBody(v.body), v.changeSummary).then(reload)} onClose={() => setDialog(null)} />}
      {dialog === "approve" && <ReasonDialog title="Approve the latest version" confirmLabel="Approve" onSubmit={(v) => act("approve", { reason: v.reason })} onClose={() => setDialog(null)} />}
      {dialog === "reject" && <ReasonDialog title="Request changes" confirmLabel="Request changes" onSubmit={(v) => act("reject", { reason: v.reason })} onClose={() => setDialog(null)} />}
      {dialog === "pause" && <ReasonDialog title="Pause this policy" description="Pausing a capability's policy stops that capability for this organization until it is resumed." danger confirmLabel="Pause" onSubmit={(v) => act("pause", { reason: v.reason })} onClose={() => setDialog(null)} />}
    </Modal>
  );
}
