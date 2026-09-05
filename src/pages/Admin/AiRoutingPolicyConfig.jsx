import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, GitBranch } from "lucide-react";
import { fetchOrganizations, fetchAiRoutingPolicies, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canManageAiRouting } from "./aiProvidersConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { evaluateFallbackEligibility, AI_USE_CASES } from "../../Helpers/mockAiProvidersData";

function getUseCaseLabel(id) {
  return AI_USE_CASES.find((u) => u.id === id)?.label || id;
}

export default function AiRoutingPolicyConfig() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, aiRoutingPolicies, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [checklistTarget, setChecklistTarget] = useState(null);

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);
  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchAiRoutingPolicies(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const checklist = checklistTarget ? evaluateFallbackEligibility(checklistTarget) : null;

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/ai-providers" className="hover:text-gray-300">AI Providers</Link>{" "}
        <span>/</span> <span className="text-gray-300">Routing</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Routing and Fallback Policies</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Each use case routes to a primary provider-neutral model alias, with an explicit fallback behavior. A
            fallback to a secondary provider is only ever eligible after every check on the pre-fallback checklist passes.
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

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading routing policies…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Use Case</th>
                <th className="px-4 py-3">Primary</th>
                <th className="px-4 py-3">Fallback Behavior</th>
                <th className="px-4 py-3">Restricted-Data Behavior</th>
                <th className="px-4 py-3">Approval</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {aiRoutingPolicies.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500 text-xs">No routing policies to preview yet.</td></tr>
              ) : aiRoutingPolicies.map((p) => (
                <tr key={p.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-200">{getUseCaseLabel(p.useCaseId)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{findProvider(p.primaryProviderKey)?.name || p.primaryProviderKey} · {p.primaryAlias}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{p.fallbackBehavior}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{p.restrictedDataBehavior}</td>
                  <td className="px-4 py-3 text-[11px]">{p.requiresApproval ? <span className="text-amber-300">Required</span> : <span className="text-gray-500">Not required</span>}</td>
                  <td className="px-4 py-3 text-[11px] text-gray-300">{p.status}</td>
                  <td className="px-4 py-3 text-right">
                    {canManageAiRouting(role) && (
                      <button onClick={() => setChecklistTarget(p)} className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white ml-auto">
                        <GitBranch size={13} /> Check Fallback Eligibility
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {checklistTarget && checklist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setChecklistTarget(null)} />
          <div role="dialog" aria-modal="true" aria-labelledby="fallback-checklist-title" className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-3">
            <h2 id="fallback-checklist-title" className="text-lg font-semibold text-white">Fallback Eligibility Checklist</h2>
            <p className="text-xs text-gray-500">{getUseCaseLabel(checklistTarget.useCaseId)}</p>
            <ul className="space-y-1.5">
              {checklist.checks.map((c) => (
                <li key={c.label} className="flex items-center gap-1.5 text-sm">
                  {c.passed ? <CheckCircle2 size={14} className="text-emerald-400" /> : <XCircle size={14} className="text-red-400" />}
                  <span className={c.passed ? "text-gray-300" : "text-red-300"}>{c.label}</span>
                </li>
              ))}
            </ul>
            <p className={`text-sm font-medium ${checklist.eligible ? "text-emerald-400" : "text-red-400"}`}>
              {checklist.eligible ? "Fallback is eligible." : "Fallback is not eligible."}
            </p>
            <div className="flex justify-end">
              <button onClick={() => setChecklistTarget(null)} className="px-3 py-2 rounded-lg text-sm text-gray-300 border border-gray-700 hover:bg-gray-800">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
