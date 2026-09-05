import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Ban } from "lucide-react";
import { fetchSuppressionEntries, removeSuppressionEntry, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { canViewSuppression, canRemoveSuppression } from "./salesMarketingConfig";
import { contacts, leads } from "../../Helpers/mockCrmData";
import { SUPPRESSION_REASONS } from "../../Helpers/mockSalesMarketingData";
import ActionPreviewModal from "./ActionPreviewModal";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function resolveRecordName(entry) {
  if (entry.contactId) return contacts.find((c) => c._id === entry.contactId)?.name || "Unknown Contact";
  if (entry.leadId) return leads.find((l) => l._id === entry.leadId)?.name || "Unknown Lead";
  return "—";
}

export default function SalesSuppression() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const { suppressionEntries, loading, error } = useSelector(selectIntegrations);

  const [reasonFilter, setReasonFilter] = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeReason, setRemoveReason] = useState("");

  const refresh = () => {
    dispatch(fetchSuppressionEntries(reasonFilter ? { reason: reasonFilter } : {}));
  };

  useEffect(refresh, [dispatch, reasonFilter]);

  const canView = canViewSuppression(role);

  const submitRemove = async () => {
    if (!removeReason.trim() || !removeTarget) return;
    await dispatch(removeSuppressionEntry({ entryId: removeTarget.id, reason: removeReason.trim() }));
    setRemoveTarget(null);
    setRemoveReason("");
    refresh();
  };

  if (!canView) {
    return <div className="p-4 md:p-6"><p className="text-sm text-red-400">You do not have permission to view Suppression.</p></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <button onClick={() => navigate("/admin/integrations/sales-marketing")} className="hover:text-gray-300">Administration</button>
        <span>/</span>
        <button onClick={() => navigate("/admin/integrations/sales-marketing")} className="hover:text-gray-300">Sales &amp; Marketing</button>
        <span>/</span>
        <span className="text-gray-300">Suppression</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Suppression Management</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <button onClick={refresh} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800"><RefreshCw size={14} /> Refresh</button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && suppressionEntries.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">Loading suppression entries…</div>}

      <div className="flex items-center gap-2">
        <label htmlFor="sup-reason" className="sr-only">Reason</label>
        <select id="sup-reason" value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white">
          <option value="">All reasons</option>
          {SUPPRESSION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <p className="text-[11px] text-gray-500 flex items-center gap-1.5"><Ban size={12} /> This is a real removal ledger, not a flag flip — every removal requires a written reason and is high-risk.</p>

      <section className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-800">
              <th className="p-3">Record</th>
              <th className="p-3">Reason</th>
              <th className="p-3">Source</th>
              <th className="p-3">Added By</th>
              <th className="p-3">Added At</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {suppressionEntries.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-xs text-gray-500">No suppression entries match the current filter.</td></tr>
            ) : (
              suppressionEntries.map((s) => (
                <tr key={s.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                  <td className="p-3 text-gray-200">{resolveRecordName(s)}</td>
                  <td className="p-3 text-gray-300">{s.reason}</td>
                  <td className="p-3 text-gray-400">{s.source}</td>
                  <td className="p-3 text-gray-400">{s.addedBy}</td>
                  <td className="p-3 text-gray-500 text-[11px]">{formatDateTime(s.addedAt)}</td>
                  <td className="p-3">
                    {canRemoveSuppression(role) && (
                      <button onClick={() => setRemoveTarget(s)} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10">Remove</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {removeTarget && (
        <ActionPreviewModal
          title="Remove Suppression Entry"
          actionLabel={`Remove suppression for ${resolveRecordName(removeTarget)}`}
          details={[
            { label: "Reason for suppression", value: removeTarget.reason },
            { label: "Source", value: removeTarget.source },
            { label: "Added By", value: removeTarget.addedBy },
          ]}
          requiresReason
          reason={removeReason}
          onReasonChange={setRemoveReason}
          reasonLabel="Reason for removing this suppression entry"
          confirmLabel="Confirm Remove"
          onConfirm={submitRemove}
          onCancel={() => { setRemoveTarget(null); setRemoveReason(""); }}
        />
      )}
    </div>
  );
}
