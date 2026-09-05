import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Eye, X, ShieldCheck } from "lucide-react";
import {
  fetchOrganizations, fetchAudiences, fetchAudienceEligibility, fetchMarketingConsentSummary,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewAudienceSync, canPreviewAudienceSync, canViewMarketingConsent } from "./salesMarketingConfig";

export default function SalesAudienceSync() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const {
    organizations, audiences, currentAudienceEligibility, marketingConsentSummary, loading, error,
  } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [eligibilityAudienceId, setEligibilityAudienceId] = useState(null);

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  const refresh = () => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchAudiences(filters));
    if (canViewMarketingConsent(role)) dispatch(fetchMarketingConsentSummary());
  };

  useEffect(refresh, [dispatch, owner, selectedOrgId, role]);

  const canView = canViewAudienceSync(role);

  const openEligibility = (audienceId) => {
    setEligibilityAudienceId(audienceId);
    dispatch(fetchAudienceEligibility(audienceId));
  };

  if (!canView) {
    return <div className="p-4 md:p-6"><p className="text-sm text-red-400">You do not have permission to view Audience Sync.</p></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <button onClick={() => navigate("/admin/integrations/sales-marketing")} className="hover:text-gray-300">Administration</button>
        <span>/</span>
        <button onClick={() => navigate("/admin/integrations/sales-marketing")} className="hover:text-gray-300">Sales &amp; Marketing</button>
        <span>/</span>
        <span className="text-gray-300">Audience Sync</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Audience Synchronization</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <div className="flex items-center gap-2">
          {owner && (
            <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <button onClick={refresh} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && audiences.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">Loading audiences…</div>}

      {canViewMarketingConsent(role) && marketingConsentSummary && (
        <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><ShieldCheck size={14} className="text-blue-400" /> Marketing Consent Summary</h2>
          <p className="text-[11px] text-gray-500 mb-3">A live projection of each Contact/Lead's real consent fields — not a separate consent record store.</p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-gray-800/40 rounded-lg p-3"><p className="text-emerald-400 text-xl font-bold">{marketingConsentSummary.consented}</p><p className="text-[11px] text-gray-500">Consented</p></div>
            <div className="bg-gray-800/40 rounded-lg p-3"><p className="text-amber-400 text-xl font-bold">{marketingConsentSummary.notConsented}</p><p className="text-[11px] text-gray-500">No Consent Recorded</p></div>
            <div className="bg-gray-800/40 rounded-lg p-3"><p className="text-red-400 text-xl font-bold">{marketingConsentSummary.doNotContact}</p><p className="text-[11px] text-gray-500">Do Not Contact</p></div>
          </div>
        </section>
      )}

      <section className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-800">
              <th className="p-3">Name</th>
              <th className="p-3">Channel</th>
              <th className="p-3">Requires Consent</th>
              <th className="p-3">Excludes Suppressed</th>
              <th className="p-3">Source Filter</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {audiences.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-xs text-gray-500">No audiences defined for this scope.</td></tr>
            ) : (
              audiences.map((a) => (
                <tr key={a.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                  <td className="p-3 text-gray-200">{a.name}</td>
                  <td className="p-3 text-gray-400">{a.channel}</td>
                  <td className="p-3 text-[11px]">{a.requireConsent ? <span className="text-emerald-300">Required</span> : <span className="text-gray-500">Not required</span>}</td>
                  <td className="p-3 text-[11px]">{a.excludeSuppressed ? <span className="text-emerald-300">Yes</span> : <span className="text-gray-500">No</span>}</td>
                  <td className="p-3 text-gray-400 text-[11px]">{a.sourceFilter || "—"}</td>
                  <td className="p-3">
                    {canPreviewAudienceSync(role) && (
                      <button onClick={() => openEligibility(a.id)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800"><Eye size={12} /> Preview Eligibility</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {eligibilityAudienceId && (
        <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setEligibilityAudienceId(null)} />
          <div role="dialog" aria-modal="true" aria-label="Audience eligibility preview" className="relative bg-[#12141c] border-l border-gray-800 w-full max-w-md h-full overflow-y-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{currentAudienceEligibility?.audience?.name || "Audience Eligibility"}</h2>
              <button onClick={() => setEligibilityAudienceId(null)} aria-label="Close"><X size={18} className="text-gray-400 hover:text-white" /></button>
            </div>
            {!currentAudienceEligibility ? (
              <p className="text-xs text-gray-500">Calculating eligibility live against Contacts and Leads…</p>
            ) : (
              <>
                <p className="text-sm text-gray-300">{currentAudienceEligibility.eligible.length} of {currentAudienceEligibility.totalConsidered} records are eligible.</p>
                <div>
                  <h3 className="text-xs font-semibold text-white mb-2">Excluded ({currentAudienceEligibility.excluded.length})</h3>
                  {currentAudienceEligibility.excluded.length === 0 ? (
                    <p className="text-xs text-gray-500">No records excluded.</p>
                  ) : (
                    <ul className="space-y-1">
                      {Object.entries(
                        currentAudienceEligibility.excluded.reduce((acc, ex) => { acc[ex.reason] = (acc[ex.reason] || 0) + 1; return acc; }, {})
                      ).map(([reason, count]) => (
                        <li key={reason} className="flex items-center justify-between text-xs text-gray-300 bg-gray-800/40 rounded-lg px-3 py-1.5">
                          <span>{reason}</span><span className="text-gray-500">{count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 border-t border-gray-800 pt-3">Computed live against real Contacts/Leads — never a stored duplicate membership list.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
