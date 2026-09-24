import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import {
  ArrowLeft, RefreshCw, PlayCircle, Pause, Play, XCircle, Undo2, Pencil,
  CheckCircle2, AlertTriangle, ShieldAlert,
} from "lucide-react";
import {
  fetchOrganizations, fetchConnection, fetchProvider, fetchActivity, pauseConnection, resumeConnection,
  disconnectConnection, undoDisconnectConnection, runPreviewSync, retryFailedSync,
  updateFieldMapping, updateConnectionConfig, testPreviewConnection, selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import {
  canUpdateConnections, canPauseConnections, canDisconnectConnections, canRunSync,
  canRetryErrors, canManageMappings, canManageConnectionForOrganization,
} from "./integrationsConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { BACKEND_ENABLED, isPausedStatus, isDisconnectedStatus, reauthorize } from "../../Helpers/integrationsBackend";
import DataMappingTable from "./DataMappingTable";
import ProviderLogo from "./ProviderLogo";
import IntegrationSyncPanel from "./IntegrationSyncPanel";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatDuration(ms) {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const STATUS_COLORS = {
  "Preview Connected": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Configuration Required": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Attention Required": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Preview Paused": "bg-gray-700/40 text-gray-300 border-gray-600/40",
  "Preview Disconnected": "bg-gray-800 text-gray-500 border-gray-700",
  // Backend mode (real connections)
  Connected: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Connected with Warnings": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Reauthorization Required": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Rate Limited": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Authorization Pending": "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Sync Paused": "bg-gray-700/40 text-gray-300 border-gray-600/40",
  Disconnected: "bg-gray-800 text-gray-500 border-gray-700",
  Revoked: "bg-gray-800 text-gray-500 border-gray-700",
};

// Button and message wording: "Preview" only for the frontend demo data.
const L = BACKEND_ENABLED
  ? { edit: "", test: "Test Connection", run: "Run Synchronization", pause: "Pause Synchronization", resume: "Resume", disconnect: "Disconnect", notFound: "This connection could not be found, or you don't have access to it.", disconnected: "", noJobs: "No synchronizations have run yet." }
  : { edit: "Edit Preview Configuration", test: "Test Preview Connection", run: "Run Preview Synchronization", pause: "Pause Preview", resume: "Resume Preview", disconnect: "Disconnect Preview", notFound: "This preview connection could not be found, or you don't have access to it.", disconnected: "This preview connection was just disconnected.", noJobs: "No preview synchronizations have run yet." };

export default function ConnectionDetail() {
  const { connectionId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, currentConnection, currentProvider, activity, lastDisconnectedId, loading, error } = useSelector(selectIntegrations);
  const [searchParams] = useSearchParams();
  const oauthOutcome = searchParams.get("oauth");
  const oauthReason = searchParams.get("reason");

  const [disconnectModal, setDisconnectModal] = useState(false);
  const [disconnectReason, setDisconnectReason] = useState("");
  const [editModal, setEditModal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  useEffect(() => {
    dispatch(fetchConnection(connectionId));
    dispatch(fetchActivity({ connectionId }));
  }, [dispatch, connectionId]);

  const connection = currentConnection?.id === connectionId ? currentConnection : null;
  const connectionProviderKey = connection?.providerKey;
  // Backend mode: the provider's real capabilities, not the demo catalog's.
  useEffect(() => {
    if (BACKEND_ENABLED && connectionProviderKey) dispatch(fetchProvider(connectionProviderKey));
  }, [dispatch, connectionProviderKey]);
  const provider = !connection ? null : BACKEND_ENABLED ? (currentProvider?.key === connection.providerKey ? currentProvider : null) : findProvider(connection.providerKey);
  const paused = connection ? isPausedStatus(connection.status) : false;
  const disconnected = connection ? isDisconnectedStatus(connection.status) : false;
  const orgName = useMemo(() => organizations.find((o) => o.id === connection?.organizationId)?.name || connection?.organizationId, [organizations, connection]);
  const actingOrganizationId = useMemo(() => (organizations.length === 1 ? organizations[0].id : connection?.organizationId), [organizations, connection]);
  const canManageThis = connection ? canManageConnectionForOrganization(role, connection.organizationId, actingOrganizationId) : false;

  if ((loading && !connection) || (BACKEND_ENABLED && connection && !provider && !error)) return <div className="p-4 md:p-6 text-gray-400 text-sm">Loading connection…</div>;
  if (error || !connection || !provider) {
    return (
      <div className="p-4 md:p-6 space-y-3">
        <p className="text-sm text-red-400">{error || L.notFound}</p>
        <button onClick={() => navigate("/admin/integrations/marketplace")} className="text-sm text-blue-400 hover:underline">Back to Marketplace</button>
      </div>
    );
  }

  const selectedCapabilities = provider.capabilities.filter((c) => connection.capabilities.includes(c.id));
  const canRunActions = canManageThis;

  const handleTest = async () => {
    setTesting(true);
    await dispatch(testPreviewConnection(connectionId));
    setTesting(false);
  };
  const handleRunSync = async () => {
    setSyncing(true);
    await dispatch(runPreviewSync({ connectionId, jobType: "Manual Sync" }));
    setSyncing(false);
  };
  const handleRetry = () => {
    const failedJob = connection.syncJobs.find((j) => j.status === "Failed");
    if (failedJob) dispatch(retryFailedSync({ connectionId, jobId: failedJob.id }));
  };
  const handlePauseResume = () => dispatch(paused ? resumeConnection(connectionId) : pauseConnection(connectionId));
  // Backend mode: sends the browser to the provider to grant access again.
  const handleReauthorize = async () => {
    try {
      const { authorizationUrl } = await reauthorize(connectionId, connection.capabilities);
      if (authorizationUrl) window.location.assign(authorizationUrl);
    } catch (e) {
      window.alert(e?.response?.data?.message || e?.message || "Couldn't start reauthorization.");
    }
  };
  const handleDisconnectConfirm = async () => {
    if (!disconnectReason.trim()) return;
    await dispatch(disconnectConnection({ id: connectionId, reason: disconnectReason }));
    setDisconnectModal(false);
    setDisconnectReason("");
  };
  const handleUndo = () => dispatch(undoDisconnectConnection(connectionId));
  const handleConflictRuleChange = (mappingId, conflictRule) => dispatch(updateFieldMapping({ connectionId, mappingId, changes: { conflictRule } }));

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1 flex-wrap">
        <Link to="/admin/integrations" className="hover:text-gray-300">Administration</Link> <span>/</span>
        <Link to="/admin/integrations" className="hover:text-gray-300">Integrations</Link> <span>/</span>
        <Link to={`/admin/integrations/${provider.key}`} className="hover:text-gray-300">{provider.name}</Link> <span>/</span>
        <span className="text-gray-300">Connection</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button onClick={() => navigate(`/admin/integrations/${provider.key}`)} aria-label="Back to provider" className="p-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-gray-400 mt-0.5">
            <ArrowLeft size={16} />
          </button>
          <ProviderLogo providerKey={provider.key} name={provider.name} size={40} />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-white">{provider.name}</h1>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_COLORS[connection.status] || ""}`}>{connection.status}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Organization: <span className="text-gray-300">{orgName}</span> · Connected by <span className="text-gray-300">{connection.connectedByName}</span> on <span className="text-gray-300">{formatDateTime(connection.createdDate)}</span>
            </p>
          </div>
        </div>
      </div>

      {connection.simulatorLabel && (
        <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-3 text-sm text-violet-200">{connection.simulatorLabel}</div>
      )}
      {BACKEND_ENABLED && oauthOutcome && (
        <div className={`rounded-xl p-3 text-sm border ${oauthOutcome === "connected" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200" : "bg-red-500/10 border-red-500/30 text-red-200"}`}>
          {oauthOutcome === "connected" ? "Connected. Access was granted at the provider." : `The provider sign-in didn't complete${oauthReason ? ` (${oauthReason.replace(/_/g, " ")})` : ""}.`}
        </div>
      )}
      {!BACKEND_ENABLED && lastDisconnectedId === connectionId && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center justify-between">
          <p className="text-sm text-amber-200">{L.disconnected}</p>
          <button onClick={handleUndo} className="flex items-center gap-1.5 text-sm text-amber-300 hover:underline"><Undo2 size={14} /> Undo</button>
        </div>
      )}

      {canRunActions && (
        <div className="flex flex-wrap gap-2">
          {!BACKEND_ENABLED && canUpdateConnections(role) && (
            <button onClick={() => setEditModal(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
              <Pencil size={14} /> {L.edit}
            </button>
          )}
          <button onClick={handleTest} disabled={testing} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300 disabled:opacity-50">
            <RefreshCw size={14} /> {L.test}
          </button>
          {BACKEND_ENABLED && connection.reauthorizationRequired && !disconnected && (
            <button onClick={handleReauthorize} className="flex items-center gap-2 border border-amber-700 text-amber-300 hover:bg-amber-500/10 px-3 py-2 rounded-lg text-sm">
              <ShieldAlert size={14} /> Reauthorize
            </button>
          )}
          {canRunSync(role) && !disconnected && (
            <button onClick={handleRunSync} disabled={syncing} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300 disabled:opacity-50">
              <PlayCircle size={14} /> {L.run}
            </button>
          )}
          {canPauseConnections(role) && !disconnected && (
            <button onClick={handlePauseResume} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
              {paused ? <><Play size={14} /> {L.resume}</> : <><Pause size={14} /> {L.pause}</>}
            </button>
          )}
          {canDisconnectConnections(role) && !disconnected && (
            <button onClick={() => setDisconnectModal(true)} className="flex items-center gap-2 border border-red-800 text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-lg text-sm">
              <XCircle size={14} /> {L.disconnect}
            </button>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Selected capabilities">
          <div className="flex flex-wrap gap-1.5">
            {selectedCapabilities.map((c) => <span key={c.id} className="text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-300">{c.name}</span>)}
          </div>
        </Panel>
        <Panel title="Data scope & synchronization">
          <dl className="text-sm text-gray-300 space-y-1">
            <div className="flex justify-between"><dt className="text-gray-500">Data scope</dt><dd>{connection.dataScope}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Sync direction</dt><dd>{connection.syncConfiguration.direction}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Schedule</dt><dd>{connection.syncConfiguration.scheduleFrequency}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Last synchronized</dt><dd>{formatDateTime(connection.lastSyncedAt)}</dd></div>
          </dl>
        </Panel>
        <Panel title="Notification preferences">
          <ul className="text-sm text-gray-300 space-y-1">
            <li>{connection.notificationPreferences.onFailure ? "✓" : "✗"} Notify on synchronization failure</li>
            <li>{connection.notificationPreferences.onSuccess ? "✓" : "✗"} Notify on synchronization success</li>
          </ul>
        </Panel>
        <Panel title="Health">
          <div className="flex items-center gap-2 mb-2">
            {connection.health.status === "Healthy" ? <CheckCircle2 size={16} className="text-emerald-400" /> : <AlertTriangle size={16} className="text-amber-400" />}
            <span className="text-sm text-gray-200">{connection.health.status}</span>
            <span className="text-[11px] text-gray-500">checked {formatDateTime(connection.health.lastCheckedAt)}</span>
          </div>
          {connection.health.issues.length > 0 && (
            <ul className="text-xs text-amber-300 space-y-1">
              {connection.health.issues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          )}
        </Panel>
      </div>

      {BACKEND_ENABLED ? (
        <IntegrationSyncPanel connection={connection} provider={provider} canConfigure={canManageThis && !disconnected} canRun={canRunSync(role) && !disconnected} />
      ) : (
        <section>
          <h2 className="text-sm font-semibold text-white mb-2">Data Mapping</h2>
          <DataMappingTable mappings={connection.fieldMappings} canManage={canManageMappings(role)} onChangeConflictRule={handleConflictRuleChange} />
        </section>
      )}

      {connection.recentErrors.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><ShieldAlert size={14} className="text-amber-400" /> Recent Errors</h2>
          <ul className="space-y-2">
            {connection.recentErrors.map((err) => (
              <li key={err.id} className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 flex items-center justify-between text-sm">
                <div>
                  <p className="text-gray-200">{err.message}</p>
                  <p className="text-[11px] text-gray-500">{formatDateTime(err.occurredAt)} · {err.code}</p>
                </div>
                {err.retryEligible && canRetryErrors(role) && (
                  <button onClick={handleRetry} className="text-xs text-blue-400 hover:underline shrink-0">Retry</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-white mb-2">Synchronization History</h2>
        {connection.syncJobs.length === 0 ? (
          <p className="text-sm text-gray-400">{L.noJobs}</p>
        ) : (
          <div className="overflow-x-auto border border-gray-800 rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
                <tr>
                  <th scope="col" className="text-left px-4 py-3">Type</th>
                  <th scope="col" className="text-left px-4 py-3">Examined</th>
                  <th scope="col" className="text-left px-4 py-3">Created</th>
                  <th scope="col" className="text-left px-4 py-3">Updated</th>
                  <th scope="col" className="text-left px-4 py-3">Skipped</th>
                  <th scope="col" className="text-left px-4 py-3">Conflicted</th>
                  <th scope="col" className="text-left px-4 py-3">Failed</th>
                  <th scope="col" className="text-left px-4 py-3">Duration</th>
                  <th scope="col" className="text-left px-4 py-3">Triggered By</th>
                  <th scope="col" className="text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {connection.syncJobs.map((job) => (
                  <tr key={job.id} className="border-t border-gray-800">
                    <td className="px-4 py-3 text-white">{job.label}<br /><span className="text-[11px] text-gray-500">{job.jobType}</span></td>
                    <td className="px-4 py-3 text-gray-300">{job.result?.recordsExamined ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{job.result?.created ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{job.result?.updated ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{job.result?.skipped ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{job.result?.conflicted ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{job.result?.failed ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDuration(job.result?.durationMs)}</td>
                    <td className="px-4 py-3 text-gray-400">{job.result?.triggeredBy}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${job.status === "Failed" ? "bg-red-500/15 text-red-300 border-red-500/30" : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"}`}>{job.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-white mb-2">Audit Events</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-gray-400">No audit events for this connection yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {activity.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-sm bg-gray-900/40 border border-gray-800 rounded-lg px-3 py-2">
                <span className="text-gray-200">{e.event}</span>
                <span className="text-[11px] text-gray-500">{e.actor} · {formatDateTime(e.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {disconnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={BACKEND_ENABLED ? `Disconnect ${provider.name}` : `Disconnect ${provider.name} preview`}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setDisconnectModal(false)} />
          <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-white mb-2">{BACKEND_ENABLED ? `Disconnect ${provider.name}` : `Disconnect ${provider.name} preview`}</h3>
            <p className="text-sm text-gray-400 mb-2">{BACKEND_ENABLED ? "This revokes access at the provider (where it supports that), deletes the stored credentials and stops all synchronization. Records already imported stay in the CRM. Affected capabilities:" : "This will stop all preview synchronization for this connection. Affected capabilities:"}</p>
            <ul className="text-xs text-gray-400 list-disc list-inside mb-3">
              {selectedCapabilities.map((c) => <li key={c.id}>{c.name}</li>)}
            </ul>
            <p className="text-xs text-gray-500 mb-3">{BACKEND_ENABLED ? "This can't be undone — connect again to restore access." : "You can undo this during the current session."}</p>
            <label htmlFor="disconnect-reason" className="block text-xs text-gray-400 mb-1">Reason</label>
            <textarea id="disconnect-reason" value={disconnectReason} onChange={(e) => setDisconnectReason(e.target.value)} rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white mb-4" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setDisconnectModal(false)} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
              <button onClick={handleDisconnectConfirm} disabled={!disconnectReason.trim()} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg">Disconnect</button>
            </div>
          </div>
        </div>
      )}

      {editModal && (
        <EditConfigModal
          connection={connection}
          provider={provider}
          onClose={() => setEditModal(false)}
          onSave={async (changes) => {
            await dispatch(updateConnectionConfig({ connectionId, changes }));
            setEditModal(false);
          }}
        />
      )}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-white mb-2">{title}</h2>
      {children}
    </div>
  );
}

function EditConfigModal({ connection, provider, onClose, onSave }) {
  const [capabilityIds, setCapabilityIds] = useState(connection.capabilities);
  const [dataScope, setDataScope] = useState(connection.dataScope);
  const toggle = (id) => setCapabilityIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Edit Preview Configuration">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-white mb-4">Edit Preview Configuration</h3>
        <div className="space-y-2 mb-4">
          {provider.capabilities.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm text-gray-200">
              <input type="checkbox" checked={capabilityIds.includes(c.id)} onChange={() => toggle(c.id)} /> {c.name}
            </label>
          ))}
        </div>
        <label htmlFor="edit-data-scope" className="block text-xs text-gray-400 mb-1">Data scope</label>
        <select id="edit-data-scope" value={dataScope} onChange={(e) => setDataScope(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white mb-4">
          {["Organization", "Selected Users", "Selected Teams"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
          <button onClick={() => onSave({ capabilities: capabilityIds, dataScope })} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Save</button>
        </div>
      </div>
    </div>
  );
}
