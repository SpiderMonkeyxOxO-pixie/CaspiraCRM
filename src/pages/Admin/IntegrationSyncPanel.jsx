import { useState } from "react";
import { useDispatch } from "react-redux";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { confirmSyncPreview, saveSyncConfiguration, cancelSyncRun } from "../../redux/admin/integrationsSlice";

// Backend mode only (VITE_BACKEND_INTEGRATIONS_MODE): synchronization setup
// per capability, previews waiting for confirmation, and queued runs. A
// first sync always goes through a preview — nothing is written until the
// person confirms it.
const SYNCABLE = ["calendar_event", "issue", "financial_transaction"];

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function IntegrationSyncPanel({ connection, provider, canConfigure, canRun }) {
  const dispatch = useDispatch();
  const syncable = (provider?.capabilities || []).filter((c) => SYNCABLE.includes(c.entityType) && !c.unavailableReason);
  const configured = new Set(connection.syncConfigurations.map((k) => k.capability));
  const choices = syncable.filter((c) => !configured.has(c.id));
  const [capability, setCapability] = useState("");
  const [projectId, setProjectId] = useState("");
  const [repository, setRepository] = useState("");
  const [financialAccountId, setFinancialAccountId] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const chosen = syncable.find((c) => c.id === capability);

  const previews = connection.syncJobs.filter((j) => j.kind === "Preview" && j.status === "Awaiting Confirmation");
  const queued = connection.syncJobs.filter((j) => j.kind === "Sync" && ["Queued", "Running", "Rate Limited"].includes(j.status));

  const save = async () => {
    if (!chosen) return;
    const filters = {};
    if (chosen.entityType === "issue") {
      filters.projectId = projectId.trim();
      if (repository.trim()) filters.repositories = [repository.trim()];
    }
    if (chosen.entityType === "financial_transaction") filters.financialAccountId = financialAccountId.trim();
    if (chosen.entityType === "calendar_event" && calendarId.trim()) filters.calendarIds = [calendarId.trim()];
    const action = await dispatch(saveSyncConfiguration({ connectionId: connection.id, body: { capability: chosen.id, direction: "Import Only", filters } }));
    if (saveSyncConfiguration.fulfilled.match(action)) setCapability("");
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-white">Synchronization setup</h2>
      {connection.syncConfigurations.length === 0 ? (
        <p className="text-sm text-gray-400">No capability is set up to synchronize yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {connection.syncConfigurations.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 text-sm bg-gray-900/40 border border-gray-800 rounded-lg px-3 py-2">
              <span className="text-gray-200">{syncable.find((c) => c.id === k.capability)?.name || k.capability}</span>
              <span className="text-[11px] text-gray-500">
                {k.direction} · conflicts {k.conflictPolicy} · {k.deletionPolicy}
                {k.initialSyncCompletedAt ? ` · first sync done ${formatDateTime(k.initialSyncCompletedAt)}` : " · first sync needs a confirmed preview"}
                {k.checkpoint?.expired ? " · change token expired — run a new preview" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canConfigure && choices.length > 0 && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 space-y-2">
          <label htmlFor="sync-capability" className="block text-xs text-gray-400">Add a capability (Import Only — nothing is sent to the provider)</label>
          <select id="sync-capability" value={capability} onChange={(e) => setCapability(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">Choose…</option>
            {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {chosen?.entityType === "issue" && (
            <>
              <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="CRM project ID the imported items go into" aria-label="CRM project ID" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              {connection.providerKey === "github" && (
                <input value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="Repository (owner/name)" aria-label="Repository" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              )}
            </>
          )}
          {chosen?.entityType === "financial_transaction" && (
            <input value={financialAccountId} onChange={(e) => setFinancialAccountId(e.target.value)} placeholder="Financial account ID (Finance → Setup)" aria-label="Financial account ID" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          )}
          {chosen?.entityType === "calendar_event" && (
            <input value={calendarId} onChange={(e) => setCalendarId(e.target.value)} placeholder="Calendar (optional — your primary calendar by default)" aria-label="Calendar" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
          )}
          <button onClick={save} disabled={!chosen} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-sm">Save setup</button>
        </div>
      )}

      {previews.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-300 uppercase">Waiting for your confirmation</h3>
          {previews.map((p) => (
            <div key={p.id} className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 text-sm">
              <p className="text-blue-100">
                {p.capability}: would create {p.preview?.counts?.create ?? 0}, update {p.preview?.counts?.update ?? 0}, skip {p.preview?.counts?.skip ?? 0}
                {p.preview?.counts?.conflict ? `, ${p.preview.counts.conflict} conflict(s) for you to decide` : ""}
                {p.preview?.counts?.tombstone ? `, ${p.preview.counts.tombstone} deleted at the provider (CRM records kept)` : ""}
                {` — from a sample of ${p.preview?.sampled ?? 0}.`}
              </p>
              <p className="text-[11px] text-blue-200/80 mt-1 flex items-center gap-1"><Clock size={11} /> Nothing has been written. Expires {formatDateTime(p.previewExpiresAt)}.</p>
              {canRun && (
                <button onClick={() => dispatch(confirmSyncPreview({ connectionId: connection.id, previewRunId: p.id }))} className="mt-2 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs">
                  <CheckCircle2 size={13} /> Confirm and synchronize
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {queued.length > 0 && (
        <ul className="space-y-1.5">
          {queued.map((j) => (
            <li key={j.id} className="flex items-center justify-between text-sm bg-gray-900/40 border border-gray-800 rounded-lg px-3 py-2">
              <span className="text-gray-300">{j.capability} — {j.status}</span>
              {canRun && (
                <button onClick={() => dispatch(cancelSyncRun({ connectionId: connection.id, runId: j.id }))} className="flex items-center gap-1 text-xs text-red-400 hover:underline"><XCircle size={12} /> Cancel</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
