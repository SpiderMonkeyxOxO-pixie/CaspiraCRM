import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { Coins, AlertTriangle } from "lucide-react";
import { fetchOrganizations, fetchAiUsageEstimates, fetchAiBudgetPolicies, updateAiBudgetPolicyPreview, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canManageAiBudgets } from "./aiProvidersConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import ActionPreviewModal from "./ActionPreviewModal";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function AiUsageDashboard() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, aiUsageEstimates, aiBudgetPolicies, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [editTarget, setEditTarget] = useState(null);
  const [draft, setDraft] = useState(null);

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);
  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchAiUsageEstimates(filters));
    dispatch(fetchAiBudgetPolicies(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const totals = useMemo(() => ({
    requests: aiUsageEstimates.reduce((s, u) => s + u.requests, 0),
    inputUnits: aiUsageEstimates.reduce((s, u) => s + u.inputUnits, 0),
    outputUnits: aiUsageEstimates.reduce((s, u) => s + u.outputUnits, 0),
  }), [aiUsageEstimates]);

  const startEdit = (budget) => { setEditTarget(budget); setDraft({ ...budget }); };
  const confirmEdit = async () => {
    if (!editTarget || !draft) return;
    await dispatch(updateAiBudgetPolicyPreview({ budgetId: editTarget.id, changes: { monthlyLimit: draft.monthlyLimit, warningThreshold: draft.warningThreshold, hardStopThreshold: draft.hardStopThreshold, approvalAboveThreshold: draft.approvalAboveThreshold } }));
    setEditTarget(null);
    setDraft(null);
  };

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/ai-providers" className="hover:text-gray-300">AI Providers</Link>{" "}
        <span>/</span> <span className="text-gray-300">Usage</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Usage and Budget</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            These are frontend usage estimates, <span className="text-gray-300 font-medium">not provider billing records</span>.
            Real invoicing always comes from the provider's own billing console.
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

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading usage estimates…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
              <p className="text-[11px] text-gray-500 uppercase">Estimated Requests</p>
              <p className="text-xl font-bold text-white mt-1">{totals.requests}</p>
            </div>
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
              <p className="text-[11px] text-gray-500 uppercase">Estimated Input Units</p>
              <p className="text-xl font-bold text-white mt-1">{totals.inputUnits}</p>
            </div>
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
              <p className="text-[11px] text-gray-500 uppercase">Estimated Output Units</p>
              <p className="text-xl font-bold text-white mt-1">{totals.outputUnits}</p>
            </div>
          </div>

          <section>
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><Coins size={14} className="text-blue-400" /> Usage Estimates</h2>
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">Alias</th>
                    <th className="px-4 py-3">Department</th>
                    <th className="px-4 py-3">Requests</th>
                    <th className="px-4 py-3">Input / Output Units</th>
                    <th className="px-4 py-3">Outcome</th>
                    <th className="px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {aiUsageEstimates.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500 text-xs">No usage estimates to preview yet.</td></tr>
                  ) : aiUsageEstimates.map((u) => (
                    <tr key={u.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{findProvider(u.providerKey)?.name || u.providerKey}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{u.alias}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{u.department || "—"}</td>
                      <td className="px-4 py-3 text-xs text-gray-300">{u.requests}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{u.inputUnits} / {u.outputUnits}</td>
                      <td className="px-4 py-3 text-[11px]">
                        <span className={u.outcome === "Success" ? "text-emerald-400" : u.outcome === "Fallback" ? "text-amber-300" : "text-red-400"}>{u.outcome}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(u.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><AlertTriangle size={14} className="text-amber-400" /> Budget Policies</h2>
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3">Scope</th>
                    <th className="px-4 py-3">Monthly Limit</th>
                    <th className="px-4 py-3">Warning Threshold</th>
                    <th className="px-4 py-3">Hard-Stop Threshold</th>
                    <th className="px-4 py-3">Approval Above</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {aiBudgetPolicies.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 text-xs">No budget policies configured yet.</td></tr>
                  ) : aiBudgetPolicies.map((b) => (
                    <tr key={b.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{b.scope}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{b.monthlyLimit}</td>
                      <td className="px-4 py-3 text-xs text-amber-300">{b.warningThreshold}</td>
                      <td className="px-4 py-3 text-xs text-red-400">{b.hardStopThreshold}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{b.approvalAboveThreshold ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        {canManageAiBudgets(role) && (
                          <button onClick={() => startEdit(b)} className="text-xs text-gray-300 hover:text-white">Edit Thresholds</button>
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

      {editTarget && draft && (
        <ActionPreviewModal
          title="Edit Budget Policy Preview"
          actionLabel={`Update thresholds for ${editTarget.scope} budget`}
          details={[]}
          confirmLabel="Update Budget Preview"
          onConfirm={confirmEdit}
          onCancel={() => { setEditTarget(null); setDraft(null); }}
          previewNotice="This updates the frontend budget preview only. No provider account is billed or capped."
        >
          <div className="grid sm:grid-cols-2 gap-2 mb-3">
            <div>
              <label htmlFor="budget-monthly" className="block text-[11px] text-gray-500 uppercase mb-1">Monthly Limit</label>
              <input id="budget-monthly" type="number" value={draft.monthlyLimit} onChange={(e) => setDraft((d) => ({ ...d, monthlyLimit: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white" />
            </div>
            <div>
              <label htmlFor="budget-warning" className="block text-[11px] text-gray-500 uppercase mb-1">Warning Threshold</label>
              <input id="budget-warning" type="number" value={draft.warningThreshold} onChange={(e) => setDraft((d) => ({ ...d, warningThreshold: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white" />
            </div>
            <div>
              <label htmlFor="budget-hardstop" className="block text-[11px] text-gray-500 uppercase mb-1">Hard-Stop Threshold</label>
              <input id="budget-hardstop" type="number" value={draft.hardStopThreshold} onChange={(e) => setDraft((d) => ({ ...d, hardStopThreshold: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white" />
            </div>
            <div>
              <label htmlFor="budget-approval" className="block text-[11px] text-gray-500 uppercase mb-1">Approval Above</label>
              <input id="budget-approval" type="number" value={draft.approvalAboveThreshold ?? ""} onChange={(e) => setDraft((d) => ({ ...d, approvalAboveThreshold: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white" />
            </div>
          </div>
        </ActionPreviewModal>
      )}
    </div>
  );
}
