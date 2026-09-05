import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RefreshCw, Webhook, ShieldCheck, AlertTriangle } from "lucide-react";
import { fetchOrganizations, fetchWebhooks, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner } from "./integrationsConfig";
import { findProvider, WEBHOOK_BACKEND_NOTICE } from "../../Helpers/mockIntegrationsData";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_COLORS = {
  "Active Preview": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Preview Available": "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Attention Required": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Preview Paused": "bg-gray-700/40 text-gray-300 border-gray-600/40",
  "Preview Disconnected": "bg-gray-800 text-gray-500 border-gray-700",
};

export default function IntegrationWebhooks() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, webhooks, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);
  const [organizationId, setOrganizationId] = useState("");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  useEffect(() => {
    const filters = owner && organizationId ? { organizationId } : {};
    dispatch(fetchWebhooks(filters));
  }, [dispatch, owner, organizationId]);

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span> <span>Integrations</span> <span>/</span> <span className="text-gray-300">Webhooks</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Webhook Preview</h1>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            An educational frontend preview of the webhook events each provider could send — not a real webhook-management service. {WEBHOOK_BACKEND_NOTICE}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {owner && (
            <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} aria-label="Organization"
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <button onClick={() => dispatch(fetchWebhooks(owner && organizationId ? { organizationId } : {}))} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {loading && <div className="text-center text-gray-400 py-12 text-sm">Loading webhook previews…</div>}
      {error && (
        <div className="text-center py-12">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <button onClick={() => dispatch(fetchWebhooks())} className="text-sm text-blue-400 hover:underline">Retry</button>
        </div>
      )}

      {!loading && !error && webhooks.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
          <Webhook size={28} className="mx-auto text-gray-600 mb-2" />
          <p className="text-gray-300 text-sm">No webhook previews yet — connect a provider to see simulated events here.</p>
        </div>
      )}

      {!loading && !error && webhooks.length > 0 && (
        <div className="overflow-x-auto border border-gray-800 rounded-xl">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
              <tr>
                <th scope="col" className="text-left px-4 py-3">Provider</th>
                <th scope="col" className="text-left px-4 py-3">Preview Event</th>
                <th scope="col" className="text-left px-4 py-3">Preview Endpoint</th>
                <th scope="col" className="text-left px-4 py-3">Status</th>
                <th scope="col" className="text-left px-4 py-3">Last Event</th>
                <th scope="col" className="text-left px-4 py-3">Signature Verification</th>
                <th scope="col" className="text-left px-4 py-3">Retry Policy</th>
                <th scope="col" className="text-left px-4 py-3">Failures</th>
                {owner && <th scope="col" className="text-left px-4 py-3">Organization</th>}
              </tr>
            </thead>
            <tbody>
              {webhooks.map((w) => {
                const provider = findProvider(w.providerKey);
                const org = organizations.find((o) => o.id === w.organizationId);
                return (
                  <tr key={w.id} className="border-t border-gray-800">
                    <td className="px-4 py-3 text-white">{provider?.name || w.providerKey}</td>
                    <td className="px-4 py-3 text-gray-300">{w.eventName}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{w.endpointLabel}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_COLORS[w.status] || ""}`}>{w.status}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatDateTime(w.lastEventAt)}</td>
                    <td className="px-4 py-3 text-gray-300">
                      {w.signatureVerificationRequired ? <span className="flex items-center gap-1 text-emerald-300"><ShieldCheck size={13} /> Required</span> : "Not required"}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{w.retryPolicy}</td>
                    <td className="px-4 py-3">
                      {w.failureCount > 0 ? (
                        <span className="flex items-center gap-1 text-amber-300"><AlertTriangle size={13} /> {w.failureCount}</span>
                      ) : "0"}
                    </td>
                    {owner && <td className="px-4 py-3 text-gray-300">{org?.name || w.organizationId}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
