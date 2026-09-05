import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { fetchOrganizations, fetchAiAuditEvents, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner } from "./aiProvidersConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { AI_USE_CASES } from "../../Helpers/mockAiProvidersData";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function getUseCaseLabel(id) {
  return AI_USE_CASES.find((u) => u.id === id)?.label || id;
}

export default function AiAuditLog() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, aiAuditEvents, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [detailTarget, setDetailTarget] = useState(null);

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);
  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchAiAuditEvents(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/ai-providers" className="hover:text-gray-300">AI Providers</Link>{" "}
        <span>/</span> <span className="text-gray-300">Audit</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">AI Audit Log</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Every preview request that reached the routing or context-assembly layer is recorded here. The detail
            drawer never shows a model's internal reasoning or chain-of-thought — only the record scope, redaction
            counts and outcome.
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

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading audit events…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Use Case</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3">Correlation ID</th>
              </tr>
            </thead>
            <tbody>
              {aiAuditEvents.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 text-xs">No AI audit events to preview yet.</td></tr>
              ) : aiAuditEvents.map((a) => (
                <tr key={a.id} className="border-b border-gray-800/60 last:border-0 cursor-pointer hover:bg-gray-800/30" onClick={() => setDetailTarget(a)}>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(a.timestamp)}</td>
                  <td className="px-4 py-3 text-gray-200">{getUseCaseLabel(a.useCaseId)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{a.providerKey ? findProvider(a.providerKey)?.name || a.providerKey : "—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{a.role}</td>
                  <td className="px-4 py-3 text-[11px]">
                    <span className={a.result === "Completed" ? "text-emerald-400" : a.result === "Failed" ? "text-red-400" : "text-gray-400"}>{a.result}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{a.correlationId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailTarget && (
        <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDetailTarget(null)} />
          <div role="dialog" aria-modal="true" aria-labelledby="audit-detail-title" className="relative bg-[#12141c] border-l border-gray-800 w-full max-w-sm h-full p-6 space-y-3 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 id="audit-detail-title" className="text-lg font-semibold text-white">Audit Event Detail</h2>
              <button onClick={() => setDetailTarget(null)} aria-label="Close"><X size={18} className="text-gray-400 hover:text-white" /></button>
            </div>
            <dl className="space-y-2 text-sm">
              {[
                ["Use Case", getUseCaseLabel(detailTarget.useCaseId)],
                ["Provider", detailTarget.providerKey ? findProvider(detailTarget.providerKey)?.name : "—"],
                ["Model Alias", detailTarget.alias || "—"],
                ["Role", detailTarget.role],
                ["Record Scope", detailTarget.recordScope],
                ["Included Records", detailTarget.includedCount],
                ["Redacted Records", detailTarget.redactedCount],
                ["Excluded Records", detailTarget.excludedCount],
                ["Approval State", detailTarget.approvalState],
                ["Result", detailTarget.result],
                ["Correlation ID", detailTarget.correlationId],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5 border-b border-gray-800/60 pb-2 last:border-0">
                  <dt className="text-gray-500 text-xs uppercase tracking-wide">{label}</dt>
                  <dd className="text-gray-200">{value ?? "—"}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-gray-500 border-t border-gray-800 pt-3">No internal reasoning or chain-of-thought is ever stored or shown here.</p>
          </div>
        </div>
      )}
    </div>
  );
}
