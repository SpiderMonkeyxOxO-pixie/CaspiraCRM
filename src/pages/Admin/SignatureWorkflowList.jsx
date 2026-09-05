import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, Plus, Send, Bell, Ban } from "lucide-react";
import {
  fetchOrganizations, fetchSignatureEnvelopes, fetchSignatureTemplates, createSignatureWorkflowPreview,
  markSignatureWorkflowReady, sendSignatureWorkflowPreview, remindSignatureWorkflowPreview, voidSignatureWorkflowPreview,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import {
  isSystemOwner, canCreateSignatureWorkflowPreview, canSendSignatureWorkflowPreview,
  canRemindSignatureWorkflowPreview, canVoidSignatureWorkflowPreview,
} from "./documentsStorageConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { SignatureEnvelopeStateCanonical, RecipientRole, AuthenticationMethod, resolveCrmRecordLabel } from "../../Helpers/mockDocumentsStorageData";
import ActionPreviewModal from "./ActionPreviewModal";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
const SOURCE_MODULES = ["Quote", "Order", "Contract"];
const PROVIDERS = ["docusign", "dropbox_sign", "adobe_acrobat_sign"];

function emptyRecipient(order) {
  return { name: "", email: "", role: "Signer", routingOrder: order, authMethod: "Email access" };
}

export default function SignatureWorkflowList() {
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const role = useSelector((s) => s.auth.role);
  const { organizations, signatureEnvelopes, signatureTemplates, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [viewMode, setViewMode] = useState("table");
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [validation, setValidation] = useState(null);

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);
  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchSignatureEnvelopes({ ...filters, status: statusFilter }));
    dispatch(fetchSignatureTemplates(filters));
  }, [dispatch, owner, selectedOrgId, statusFilter]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const byStatus = useMemo(() => {
    const map = {};
    SignatureEnvelopeStateCanonical.forEach((s) => { map[s] = []; });
    signatureEnvelopes.forEach((e) => { (map[e.status] ||= []).push(e); });
    return map;
  }, [signatureEnvelopes]);

  const startCreate = () => {
    setDraft({ providerKey: "docusign", sourceModule: "Quote", sourceRecordId: "", templateId: "", documents: [{ id: "doc_new", name: "Document.pdf" }], recipients: [emptyRecipient(1)], hasApproval: false, reminderConfig: { enabled: true, initialDelayDays: 2, frequencyDays: 3, maxReminders: 3 }, expirationConfig: { expirationDate: "", warningDays: 5 } });
    setValidation(null);
    setCreateOpen(true);
  };
  const updateRecipient = (idx, patch) => {
    setDraft((d) => ({ ...d, recipients: d.recipients.map((r, i) => (i === idx ? { ...r, ...patch } : r)) }));
  };
  const addRecipient = () => setDraft((d) => ({ ...d, recipients: [...d.recipients, emptyRecipient(d.recipients.length + 1)] }));

  const confirmCreate = async () => {
    const result = await dispatch(createSignatureWorkflowPreview(draft));
    if (createSignatureWorkflowPreview.fulfilled.match(result)) {
      setCreateOpen(false);
      setDraft(null);
      const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
      dispatch(fetchSignatureEnvelopes(filters));
    } else {
      setValidation(result.payload);
    }
  };

  const readyThenSend = async (envelope) => {
    const ready = await dispatch(markSignatureWorkflowReady(envelope.id));
    if (markSignatureWorkflowReady.fulfilled.match(ready)) {
      await dispatch(sendSignatureWorkflowPreview(envelope.id));
    }
  };
  const remind = (envelope) => dispatch(remindSignatureWorkflowPreview(envelope.id));
  const startVoid = (envelope) => { setVoidTarget(envelope); setVoidReason(""); };
  const confirmVoid = async () => {
    if (!voidTarget) return;
    await dispatch(voidSignatureWorkflowPreview({ envelopeId: voidTarget.id, reason: voidReason }));
    setVoidTarget(null);
    setVoidReason("");
  };

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/documents-storage" className="hover:text-gray-300">Documents & Storage</Link>{" "}
        <span>/</span> <span className="text-gray-300">Signatures</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Electronic Signature Workflows</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Every status below always carries its "Preview" qualifier. No signature request is ever sent and no signature is ever applied.
          </p>
          {!owner && orgLabel && <p className="text-xs text-gray-500 mt-1">Organization: <span className="text-gray-300">{orgLabel}</span></p>}
        </div>
        <div className="flex items-center gap-2">
          {owner && (
            <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" aria-label="Organization">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          {canCreateSignatureWorkflowPreview(role) && (
            <button onClick={startCreate} className="flex items-center gap-1.5 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-2">
              <Plus size={14} /> Create Signature Workflow Preview
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setViewMode("table")} className={`px-3 py-1.5 text-xs rounded-lg border ${viewMode === "table" ? "bg-gray-700 border-gray-600 text-white" : "border-gray-700 text-gray-400"}`}>Table</button>
        <button onClick={() => setViewMode("board")} className={`px-3 py-1.5 text-xs rounded-lg border ${viewMode === "board" ? "bg-gray-700 border-gray-600 text-white" : "border-gray-700 text-gray-400"}`}>Status Board</button>
        <label htmlFor="status-filter" className="sr-only">Status</label>
        <select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
          <option value="">All statuses</option>
          {SignatureEnvelopeStateCanonical.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && viewMode === "table" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Related Record</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Recipients</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Approval</th>
                <th className="px-4 py-3">Expiration</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {signatureEnvelopes.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500 text-xs">No signature workflows to preview yet.</td></tr>
              ) : signatureEnvelopes.map((e) => {
                const recordLabel = e.sourceRecordId ? resolveCrmRecordLabel(e.sourceModule, e.sourceRecordId) : { available: false, label: "Unlinked" };
                return (
                  <tr key={e.id} className="border-b border-gray-800/60 last:border-0">
                    <td className="px-4 py-3 text-gray-300">{findProvider(e.providerKey)?.name || e.providerKey}</td>
                    <td className="px-4 py-3 text-gray-300">{e.sourceModule}: {recordLabel.label}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{e.requestedBy}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{e.recipients.length}</td>
                    <td className="px-4 py-3 text-[11px] text-gray-300">{e.status}</td>
                    <td className="px-4 py-3">
                      <span className={e.approvalStatus === "Approved" ? "text-emerald-400 text-[11px]" : "text-amber-300 text-[11px]"}>{e.approvalStatus}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(e.expirationConfig?.expirationDate)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {e.status === "Approval Required" && e.approvalStatus === "Approved" && canSendSignatureWorkflowPreview(role) && (
                          <button onClick={() => readyThenSend(e)} title="Send Preview" className="text-gray-400 hover:text-white"><Send size={15} /></button>
                        )}
                        {e.status === "Sent Preview" && canRemindSignatureWorkflowPreview(role) && (
                          <button onClick={() => remind(e)} title="Send Reminder Preview" className="text-gray-400 hover:text-white"><Bell size={15} /></button>
                        )}
                        {!["Signed Preview", "Declined Preview", "Voided Preview", "Expired Preview"].includes(e.status) && canVoidSignatureWorkflowPreview(role) && (
                          <button onClick={() => startVoid(e)} title="Void Preview" className="text-gray-400 hover:text-red-400"><Ban size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && viewMode === "board" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {SignatureEnvelopeStateCanonical.map((s) => (
            <div key={s} className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
              <p className="text-[11px] text-gray-500 uppercase mb-2">{s} ({byStatus[s]?.length || 0})</p>
              <ul className="space-y-1">
                {(byStatus[s] || []).map((e) => (
                  <li key={e.id} className="text-xs text-gray-300 truncate">{findProvider(e.providerKey)?.name}: {e.sourceModule}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {voidTarget && (
        <ActionPreviewModal
          title="Void Signature Workflow"
          actionLabel={`Void workflow for ${voidTarget.sourceModule}`}
          details={[{ label: "Provider", value: findProvider(voidTarget.providerKey)?.name }, { label: "Current Status", value: voidTarget.status }]}
          requiresReason
          reason={voidReason}
          onReasonChange={setVoidReason}
          confirmLabel="Void Workflow"
          onConfirm={confirmVoid}
          onCancel={() => { setVoidTarget(null); setVoidReason(""); }}
          previewNotice="Voiding updates the preview only. No real signature request is cancelled at the provider."
        />
      )}

      {createOpen && draft && (
        <ActionPreviewModal
          title="Create Signature Workflow Preview"
          actionLabel="Signature workflow preview created. No request was sent to the provider or recipient."
          details={[]}
          confirmLabel="Confirm Preview"
          onConfirm={confirmCreate}
          onCancel={() => { setCreateOpen(false); setDraft(null); }}
          previewNotice="This creates a frontend preview only. No document is sent, no signature is applied."
        >
          <div className="space-y-3 mb-3">
            <div className="grid sm:grid-cols-3 gap-2">
              <div>
                <label htmlFor="draft-provider" className="block text-[11px] text-gray-500 uppercase mb-1">Provider</label>
                <select id="draft-provider" value={draft.providerKey} onChange={(e) => setDraft((d) => ({ ...d, providerKey: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                  {PROVIDERS.map((p) => <option key={p} value={p}>{findProvider(p)?.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="draft-source-module" className="block text-[11px] text-gray-500 uppercase mb-1">Source Record Type</label>
                <select id="draft-source-module" value={draft.sourceModule} onChange={(e) => setDraft((d) => ({ ...d, sourceModule: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                  {SOURCE_MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="draft-source-id" className="block text-[11px] text-gray-500 uppercase mb-1">Source Record ID</label>
                <input id="draft-source-id" value={draft.sourceRecordId} onChange={(e) => setDraft((d) => ({ ...d, sourceRecordId: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white" />
              </div>
            </div>
            <div>
              <label htmlFor="draft-template" className="block text-[11px] text-gray-500 uppercase mb-1">Template</label>
              <select id="draft-template" value={draft.templateId} onChange={(e) => setDraft((d) => ({ ...d, templateId: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="">Select a template…</option>
                {signatureTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[11px] text-gray-500 uppercase mb-1">Recipients</p>
              {draft.recipients.map((r, idx) => (
                <div key={idx} className="grid sm:grid-cols-4 gap-1.5 mb-1.5">
                  <input placeholder="Name" value={r.name} onChange={(e) => updateRecipient(idx, { name: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white" />
                  <input placeholder="Email" value={r.email} onChange={(e) => updateRecipient(idx, { email: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white" />
                  <select value={r.role} onChange={(e) => updateRecipient(idx, { role: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white">
                    {RecipientRole.map((role2) => <option key={role2} value={role2}>{role2}</option>)}
                  </select>
                  <select value={r.authMethod} onChange={(e) => updateRecipient(idx, { authMethod: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white">
                    {AuthenticationMethod.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              ))}
              <button onClick={addRecipient} type="button" className="text-[11px] text-blue-400 hover:underline">+ Add recipient</button>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input type="checkbox" checked={draft.hasApproval} onChange={(e) => setDraft((d) => ({ ...d, hasApproval: e.target.checked }))} />
              Required internal approval has been granted
            </label>
            {validation?.checks && (
              <div className="bg-gray-800/40 rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-2">Validation checks</p>
                <ul className="space-y-1">
                  {validation.checks.map((c) => (
                    <li key={c.label} className="flex items-center gap-1.5 text-xs">
                      {c.passed ? <CheckCircle2 size={13} className="text-emerald-400" /> : <XCircle size={13} className="text-red-400" />}
                      <span className={c.passed ? "text-gray-300" : "text-red-300"}>{c.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </ActionPreviewModal>
      )}
    </div>
  );
}
