import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import * as XLSX from "xlsx";
import { RefreshCw, Download, Activity, X } from "lucide-react";
import { fetchOrganizations, fetchActivity, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner } from "./integrationsConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatDuration(ms) {
  if (!ms && ms !== 0) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const RESULT_COLORS = {
  Success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Partial: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Failed: "bg-red-500/15 text-red-300 border-red-500/30",
};

export default function IntegrationActivity() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, activity, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [organizationId, setOrganizationId] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [search, setSearch] = useState("");
  const [detailEvent, setDetailEvent] = useState(null);

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  const filters = useMemo(() => {
    const f = {};
    if (owner && organizationId) f.organizationId = organizationId;
    if (providerKey) f.providerKey = providerKey;
    if (eventFilter) f.event = eventFilter;
    return f;
  }, [owner, organizationId, providerKey, eventFilter]);
  const filtersKey = JSON.stringify(filters);

  useEffect(() => { dispatch(fetchActivity(filters)); }, [dispatch, filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleActivity = useMemo(() => {
    let results = activity;
    if (resultFilter) results = results.filter((e) => e.result === resultFilter);
    if (userFilter) results = results.filter((e) => (e.actor || "").toLowerCase().includes(userFilter.toLowerCase()));
    const term = search.trim().toLowerCase();
    if (term) {
      results = results.filter((e) =>
        (e.actor || "").toLowerCase().includes(term) ||
        (e.event || "").toLowerCase().includes(term) ||
        (findProvider(e.providerKey)?.name || "").toLowerCase().includes(term)
      );
    }
    return results;
  }, [activity, resultFilter, userFilter, search]);

  const eventTypes = useMemo(() => Array.from(new Set(activity.map((e) => e.event))).sort(), [activity]);
  const providers = useMemo(() => Array.from(new Set(activity.map((e) => e.providerKey).filter(Boolean))).map(findProvider).filter(Boolean), [activity]);

  const exportPreview = () => {
    const rows = visibleActivity.map((e) => ({
      Timestamp: formatDateTime(e.occurredAt), Provider: findProvider(e.providerKey)?.name || "—",
      Organization: organizations.find((o) => o.id === e.organizationId)?.name || e.organizationId,
      Connection: e.connectionId || "—", Event: e.event, "Initiated By": e.actor, Result: e.result,
      "Records Affected": e.recordsAffected ?? "—", "Duration": formatDuration(e.durationMs), "Correlation ID": e.correlationId,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Integration Activity Preview");
    XLSX.writeFile(workbook, "integration-activity-export-preview.xlsx");
  };

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span> <span>Integrations</span> <span>/</span> <span className="text-gray-300">Activity</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Integration Activity</h1>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">A read-only log of every preview connection action and preview synchronization across your integrations.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => dispatch(fetchActivity(filters))} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
            <RefreshCw size={15} /> Refresh
          </button>
          <button onClick={exportPreview} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
            <Download size={15} /> Export Preview
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-gray-900/40 border border-gray-800 rounded-xl p-3">
        {owner && (
          <div className="w-48">
            <label htmlFor="activity-org" className="block text-xs text-gray-400 mb-1">Organization</label>
            <select id="activity-org" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
        <div className="w-48">
          <label htmlFor="activity-provider" className="block text-xs text-gray-400 mb-1">Provider</label>
          <select id="activity-provider" value={providerKey} onChange={(e) => setProviderKey(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">All providers</option>
            {providers.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </div>
        <div className="w-40">
          <label htmlFor="activity-status" className="block text-xs text-gray-400 mb-1">Status</label>
          <select id="activity-status" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">All results</option>
            <option value="Success">Success</option>
            <option value="Partial">Partial</option>
            <option value="Failed">Failed</option>
          </select>
        </div>
        <div className="w-56">
          <label htmlFor="activity-event" className="block text-xs text-gray-400 mb-1">Event type</label>
          <select id="activity-event" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">All events</option>
            {eventTypes.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
          </select>
        </div>
        <div className="w-40">
          <label htmlFor="activity-user" className="block text-xs text-gray-400 mb-1">User</label>
          <input id="activity-user" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Priya Nair" />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label htmlFor="activity-search" className="block text-xs text-gray-400 mb-1">Search</label>
          <input id="activity-search" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="Search provider, actor or event" />
        </div>
      </div>

      {loading && <div className="text-center text-gray-400 py-12 text-sm">Loading integration activity…</div>}
      {error && (
        <div className="text-center py-12">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <button onClick={() => dispatch(fetchActivity(filters))} className="text-sm text-blue-400 hover:underline">Retry</button>
        </div>
      )}

      {!loading && !error && visibleActivity.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
          <Activity size={28} className="mx-auto text-gray-600 mb-2" />
          <p className="text-gray-300 text-sm">No integration activity matches this view</p>
        </div>
      )}

      {!loading && !error && visibleActivity.length > 0 && (
        <div className="overflow-x-auto border border-gray-800 rounded-xl">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
              <tr>
                <th scope="col" className="text-left px-4 py-3">Date &amp; Time</th>
                <th scope="col" className="text-left px-4 py-3">Provider</th>
                {owner && <th scope="col" className="text-left px-4 py-3">Organization</th>}
                <th scope="col" className="text-left px-4 py-3">Connection</th>
                <th scope="col" className="text-left px-4 py-3">Event</th>
                <th scope="col" className="text-left px-4 py-3">Initiated By</th>
                <th scope="col" className="text-left px-4 py-3">Result</th>
                <th scope="col" className="text-left px-4 py-3">Records Affected</th>
                <th scope="col" className="text-left px-4 py-3">Duration</th>
                <th scope="col" className="text-left px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleActivity.map((e) => {
                const provider = findProvider(e.providerKey);
                const org = organizations.find((o) => o.id === e.organizationId);
                return (
                  <tr key={e.id} className="border-t border-gray-800 hover:bg-gray-900/30">
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{formatDateTime(e.occurredAt)}</td>
                    <td className="px-4 py-3 text-gray-200">{provider?.name || "—"}</td>
                    {owner && <td className="px-4 py-3 text-gray-300">{org?.name || e.organizationId}</td>}
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{e.connectionId || "—"}</td>
                    <td className="px-4 py-3 text-gray-300">{e.event}</td>
                    <td className="px-4 py-3 text-gray-300">{e.actor}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${RESULT_COLORS[e.result] || ""}`}>{e.result}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{e.recordsAffected ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDuration(e.durationMs)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setDetailEvent(e)} className="text-blue-400 hover:underline text-sm">View</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Activity: ${detailEvent.event}`}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setDetailEvent(null)} />
          <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">{detailEvent.event}</h3>
              <button onClick={() => setDetailEvent(null)} aria-label="Close" className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
            </div>
            <dl className="space-y-2 text-sm">
              <DetailRow label="Timestamp" value={formatDateTime(detailEvent.occurredAt)} />
              <DetailRow label="Provider" value={findProvider(detailEvent.providerKey)?.name || "—"} />
              <DetailRow label="Trigger" value={detailEvent.details || detailEvent.event} />
              <DetailRow label="Initiated by" value={detailEvent.actor} />
              <DetailRow label="Result" value={detailEvent.result} />
              <DetailRow label="Records affected (included)" value={detailEvent.recordsAffected ?? "—"} />
              <DetailRow label="Duration" value={formatDuration(detailEvent.durationMs)} />
              <DetailRow label="Correlation ID" value={detailEvent.correlationId} />
              <DetailRow label="Retry eligible" value={detailEvent.retryEligible ? "Yes" : "No"} />
            </dl>
            <p className="text-xs text-gray-500 mt-4 border-t border-gray-800 pt-3">This entry is part of a frontend-only preview log. No secrets, API keys or credential metadata are ever shown here.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-gray-800/60 pb-2">
      <dt className="text-xs text-gray-400 shrink-0">{label}</dt>
      <dd className="text-sm text-white text-right">{value}</dd>
    </div>
  );
}
