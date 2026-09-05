import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck, Store, Activity, Webhook, Sparkles, AlertTriangle, CheckCircle2,
  Clock, XCircle, PlugZap,
} from "lucide-react";
import { fetchOrganizations, fetchProviders, fetchConnections, fetchActivity, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewMarketplace, canViewActivity, canViewWebhooks } from "./integrationsConfig";
import { findProvider, FRONTEND_CONNECTION_PREVIEW_LABEL } from "../../Helpers/mockIntegrationsData";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const HEALTH_ICONS = {
  Healthy: <CheckCircle2 size={14} className="text-emerald-400" />,
  "Attention Required": <AlertTriangle size={14} className="text-amber-400" />,
  "Configuration Required": <Clock size={14} className="text-amber-400" />,
  Paused: <Clock size={14} className="text-gray-400" />,
  Disconnected: <XCircle size={14} className="text-gray-500" />,
};

export default function IntegrationsOverview() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const { organizations, connections, connectionCounts, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);
  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => {
    dispatch(fetchOrganizations());
    dispatch(fetchProviders());
  }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchConnections(filters));
    dispatch(fetchActivity(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => {
    if (owner) return null;
    return organizations[0]?.name || "Your organization";
  }, [owner, organizations]);

  const recentlyUsed = useMemo(
    () => connections.filter((c) => c.lastSyncedAt).slice().sort((a, b) => new Date(b.lastSyncedAt) - new Date(a.lastSyncedAt)).slice(0, 4),
    [connections]
  );
  const attentionRequired = useMemo(() => connections.filter((c) => c.status === "Attention Required" || c.status === "Configuration Required"), [connections]);
  const recentActivity = useMemo(
    () => connections.flatMap((c) => (c.syncJobs || []).map((j) => ({ ...j, providerKey: c.providerKey, connectionId: c.id })))
      .sort((a, b) => new Date(b.result?.completedDate || 0) - new Date(a.result?.completedDate || 0)).slice(0, 5),
    [connections]
  );
  const recommended = useMemo(() => {
    const connectedKeys = new Set(connections.map((c) => c.providerKey));
    return ["slack", "google_workspace", "docusign", "stripe", "zapier"].filter((k) => !connectedKeys.has(k)).map(findProvider).filter(Boolean).slice(0, 3);
  }, [connections]);

  const healthCounts = useMemo(() => {
    const counts = { Healthy: 0, "Attention Required": 0, "Configuration Required": 0, Paused: 0, Disconnected: 0 };
    connections.forEach((c) => {
      const status = c.health?.status;
      if (status && counts[status] !== undefined) counts[status] += 1;
    });
    return counts;
  }, [connections]);

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span> <span className="text-gray-300">Integrations</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Integration Center</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Discover, preview and manage integrations with the tools your organization already uses. Every connection here is a{" "}
            <span className="text-gray-300 font-medium">{FRONTEND_CONNECTION_PREVIEW_LABEL}</span> — no real provider account, credential or
            customer information is accessed in this phase.
          </p>
          {!owner && orgLabel && <p className="text-xs text-gray-500 mt-1">Organization: <span className="text-gray-300">{orgLabel}</span></p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {owner && (
            <div>
              <label htmlFor="integrations-org" className="sr-only">Organization</label>
              <select id="integrations-org" value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="">All organizations</option>
                {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <button onClick={() => navigate("/admin/integrations/marketplace")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
            <Store size={15} /> Marketplace
          </button>
          {canViewActivity(role) && (
            <button onClick={() => navigate("/admin/integrations/activity")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
              <Activity size={15} /> Recent Activity
            </button>
          )}
          {canViewWebhooks(role) && (
            <button onClick={() => navigate("/admin/integrations/webhooks")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
              <Webhook size={15} /> Webhooks
            </button>
          )}
        </div>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading Integration Center…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <MetricCard label="Available Providers" value={connectionCounts?.availableProviders ?? "—"} icon={<PlugZap size={14} className="text-blue-400" />} onClick={() => navigate("/admin/integrations/marketplace")} />
            <MetricCard label="Preview Connections" value={connectionCounts?.previewConnections ?? "—"} icon={<CheckCircle2 size={14} className="text-emerald-400" />} onClick={() => navigate("/admin/integrations/marketplace?status=Preview Connected")} />
            <MetricCard label="Attention Required" value={connectionCounts?.attentionRequired ?? "—"} icon={<AlertTriangle size={14} className="text-amber-400" />} onClick={() => navigate("/admin/integrations/marketplace?status=Attention Required")} />
            <MetricCard label="Syncs Today" value={connectionCounts?.syncsToday ?? "—"} icon={<Activity size={14} />} onClick={() => navigate("/admin/integrations/activity")} />
            <MetricCard label="Failed Syncs" value={connectionCounts?.failedSyncsToday ?? "—"} icon={<XCircle size={14} className="text-red-400" />} onClick={() => navigate("/admin/integrations/activity?status=Failed")} />
            <MetricCard label="Not Configured" value={connectionCounts?.providersNotConfigured ?? "—"} icon={<Clock size={14} />} onClick={() => navigate("/admin/integrations/marketplace?status=Preview Available")} />
          </div>

          <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Connection Health</h2>
            {connections.length === 0 ? (
              <p className="text-xs text-gray-500">No preview connections yet.</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {Object.entries(healthCounts).filter(([, count]) => count > 0).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-1.5 text-sm text-gray-300">
                    {HEALTH_ICONS[status]} {count} {status}
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Recently Used Integrations</h2>
              {recentlyUsed.length === 0 ? (
                <p className="text-xs text-gray-500">No synchronization activity yet.</p>
              ) : (
                <ul className="space-y-2">
                  {recentlyUsed.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => navigate(`/admin/integrations/connections/${c.id}`)} className="w-full flex items-center justify-between text-left text-sm text-gray-300 hover:text-white">
                        <span>{findProvider(c.providerKey)?.name || c.providerKey}</span>
                        <span className="text-xs text-gray-500">{formatDateTime(c.lastSyncedAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-amber-400" /> Attention Required
              </h2>
              {attentionRequired.length === 0 ? (
                <p className="text-xs text-gray-500">Nothing needs attention right now.</p>
              ) : (
                <ul className="space-y-2">
                  {attentionRequired.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => navigate(`/admin/integrations/connections/${c.id}`)} className="w-full flex items-center justify-between text-left text-sm text-gray-300 hover:text-white">
                        <span>{findProvider(c.providerKey)?.name || c.providerKey}</span>
                        <span className="text-[11px] text-amber-300">{c.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Recent Synchronization Activity</h2>
              {recentActivity.length === 0 ? (
                <p className="text-xs text-gray-500">No preview synchronizations have run yet.</p>
              ) : (
                <ul className="space-y-2">
                  {recentActivity.map((job) => (
                    <li key={job.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-300">{findProvider(job.providerKey)?.name || job.providerKey} — {job.jobType}</span>
                      <span className={`text-[11px] ${job.status === "Failed" ? "text-red-400" : "text-emerald-400"}`}>{job.status}</span>
                    </li>
                  ))}
                </ul>
              )}
              {canViewActivity(role) && (
                <button onClick={() => navigate("/admin/integrations/activity")} className="text-xs text-blue-400 hover:underline mt-3">View all activity</button>
              )}
            </section>

            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><Sparkles size={14} className="text-blue-400" /> Recommended Integrations</h2>
              {recommended.length === 0 ? (
                <p className="text-xs text-gray-500">Every recommended provider is already previewed.</p>
              ) : (
                <ul className="space-y-2">
                  {recommended.map((p) => (
                    <li key={p.key}>
                      {canViewMarketplace(role) ? (
                        <button onClick={() => navigate(`/admin/integrations/${p.key}`)} className="w-full flex items-center justify-between text-left text-sm text-gray-300 hover:text-white">
                          <span>{p.name}</span>
                          <span className="text-[11px] text-gray-500">{p.category}</span>
                        </button>
                      ) : (
                        <div className="flex items-center justify-between text-sm text-gray-300">
                          <span>{p.name}</span>
                          <span className="text-[11px] text-gray-500">{p.category}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><ShieldCheck size={14} className="text-blue-400" /> Security and Access Summary</h2>
            <ul className="text-xs text-gray-400 space-y-1.5">
              <li>Each organization connects its own provider account — subscriptions and usage charges are paid directly to the provider, never through this CRM.</li>
              <li>System Owner and Organization Administrator control organization connections; other roles follow granted integration permissions.</li>
              <li>Credentials are never stored in the browser. They will eventually be encrypted and stored on the backend.</li>
              <li>Provider terms and pricing must be verified directly with the provider before any production activation.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, icon, onClick }) {
  return (
    <button onClick={onClick} className="text-left bg-gray-900/40 border border-gray-800 rounded-xl p-3 hover:border-gray-700 transition">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase">{icon}{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
    </button>
  );
}
