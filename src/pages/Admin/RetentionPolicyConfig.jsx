import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { AlertTriangle, Lock } from "lucide-react";
import { fetchOrganizations, fetchRetentionPolicies, fetchLegalHolds, removeLegalHold, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canManageLegalHolds } from "./documentsStorageConfig";
import { CRM_TEAM } from "../../Helpers/mockUsersData";
import ActionPreviewModal from "./ActionPreviewModal";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
const STATE_COLOR = {
  Active: "text-emerald-400", "Review Due": "text-amber-300", "Archive Due": "text-amber-300",
  "Deletion Review Due": "text-red-400", "On Hold": "text-amber-300", "Legal Hold": "text-red-400",
  Expired: "text-gray-500", "Policy Missing": "text-red-400", Restricted: "text-red-400",
};

export default function RetentionPolicyConfig() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, retentionPolicies, legalHolds, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);
  const [reason, setReason] = useState("");
  const [requesterId, setRequesterId] = useState("");
  const [approverId, setApproverId] = useState("");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);
  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchRetentionPolicies(filters));
    dispatch(fetchLegalHolds(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);

  const startRemove = (hold) => { setRemoveTarget(hold); setReason(""); setRequesterId(""); setApproverId(""); };
  const confirmRemove = async () => {
    if (!removeTarget || !requesterId || !approverId) return;
    const requesterName = CRM_TEAM.find((m) => m.id === requesterId)?.name;
    const approverName = CRM_TEAM.find((m) => m.id === approverId)?.name;
    await dispatch(removeLegalHold({ holdId: removeTarget.id, reason, requesterName, approverName }));
    setRemoveTarget(null);
  };
  const selfBlocked = requesterId && approverId && requesterId === approverId;

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/documents-storage" className="hover:text-gray-300">Documents & Storage</Link>{" "}
        <span>/</span> <span className="text-gray-300">Retention</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Document Retention & Legal Holds</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            No real document is ever deleted or archived here. A legal hold blocks deletion, prohibited archiving, retention expiration and
            unlinking that would remove required evidence.
          </p>
          {!owner && orgLabel && <p className="text-xs text-gray-500 mt-1">Organization: <span className="text-gray-300">{orgLabel}</span></p>}
        </div>
        {owner && (
          <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" aria-label="Organization">
            <option value="">All organizations</option>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <>
          <section>
            <h2 className="text-sm font-semibold text-white mb-3">Retention Policies</h2>
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3">Scope</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Archive Behavior</th>
                    <th className="px-4 py-3">Review Date</th>
                    <th className="px-4 py-3">Deletion Approval</th>
                    <th className="px-4 py-3">State</th>
                  </tr>
                </thead>
                <tbody>
                  {retentionPolicies.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 text-xs">No retention policies configured yet.</td></tr>
                  ) : retentionPolicies.map((p) => (
                    <tr key={p.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{p.classification || p.recordType || "Organization-wide"}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{p.durationDays ? `${p.durationDays} days` : "Not set"}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{p.archiveBehavior}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(p.reviewDate)}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{p.deletionApprovalRequired ? "Required" : "Not required"}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[11px] flex items-center gap-1 ${STATE_COLOR[p.state] || "text-gray-300"}`}>
                          {(p.state === "Policy Missing" || p.state === "Deletion Review Due") && <AlertTriangle size={12} />} {p.state}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><Lock size={14} className="text-red-400" /> Legal Holds</h2>
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Requested By</th>
                    <th className="px-4 py-3">Effective Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {legalHolds.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 text-xs">No legal holds are active.</td></tr>
                  ) : legalHolds.map((h) => (
                    <tr key={h.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{h.reason}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{h.requestedBy}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(h.effectiveDate)}</td>
                      <td className="px-4 py-3 text-[11px] text-red-400">{h.status}</td>
                      <td className="px-4 py-3 text-right">
                        {h.status === "Active" && canManageLegalHolds(role) && (
                          <button onClick={() => startRemove(h)} className="text-sm text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">
                            Remove Hold
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {removeTarget && (
        <ActionPreviewModal
          title="Remove Legal Hold"
          actionLabel={`Remove hold: ${removeTarget.reason}`}
          details={[{ label: "Required Approver", value: removeTarget.requiredApprover }]}
          requiresReason
          reason={reason}
          onReasonChange={setReason}
          confirmLabel="Remove Hold"
          confirmDisabled={!requesterId || !approverId || selfBlocked}
          onConfirm={confirmRemove}
          onCancel={() => setRemoveTarget(null)}
          previewNotice="This updates a frontend preview only. No real document is deleted or unlocked at the provider."
        >
          <div className="grid sm:grid-cols-2 gap-2 mb-3">
            <div>
              <label htmlFor="hold-requester" className="block text-[11px] text-gray-500 uppercase mb-1">Requester</label>
              <select id="hold-requester" value={requesterId} onChange={(e) => setRequesterId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="">Select…</option>
                {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="hold-approver" className="block text-[11px] text-gray-500 uppercase mb-1">Approver</label>
              <select id="hold-approver" value={approverId} onChange={(e) => setApproverId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="">Select…</option>
                {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          {selfBlocked && <p className="text-xs text-red-400">The requester cannot approve their own legal-hold removal — organization policy requires separation of duties.</p>}
        </ActionPreviewModal>
      )}
    </div>
  );
}
