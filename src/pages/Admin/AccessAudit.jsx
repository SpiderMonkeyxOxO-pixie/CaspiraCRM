import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import * as XLSX from "xlsx";
import { RefreshCw, Download, ShieldAlert, Activity, Users, X } from "lucide-react";
import { fetchAccessAudit, fetchOrganizations, selectAccessManagement } from "../../redux/admin/accessManagementSlice";
import { isSystemOwner } from "./accessManagementConfig";

const HIGH_RISK_EVENTS = [
  "Member role changed", "Member removed", "Member suspended",
  "Invitation revoked", "Invite link revoked", "Membership rejected",
];

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export default function AccessAudit() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, auditEvents, loading, error } = useSelector(selectAccessManagement);
  const owner = isSystemOwner(role);

  const [organizationId, setOrganizationId] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [search, setSearch] = useState("");
  const [detailEvent, setDetailEvent] = useState(null);

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  const filters = useMemo(() => {
    const f = {};
    if (owner && organizationId) f.organizationId = organizationId;
    if (eventFilter) f.event = eventFilter;
    return f;
  }, [owner, organizationId, eventFilter]);
  const filtersKey = JSON.stringify(filters);

  useEffect(() => { dispatch(fetchAccessAudit(filters)); }, [dispatch, filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return auditEvents;
    return auditEvents.filter((e) =>
      (e.actor || "").toLowerCase().includes(term) ||
      (e.targetLabel || "").toLowerCase().includes(term) ||
      (e.event || "").toLowerCase().includes(term)
    );
  }, [auditEvents, search]);

  const eventTypes = useMemo(() => Array.from(new Set(auditEvents.map((e) => e.event))).sort(), [auditEvents]);

  const metrics = useMemo(() => ({
    total: auditEvents.length,
    today: auditEvents.filter((e) => isToday(e.occurredAt)).length,
    highRisk: auditEvents.filter((e) => HIGH_RISK_EVENTS.includes(e.event)).length,
    actors: new Set(auditEvents.map((e) => e.actor)).size,
  }), [auditEvents]);

  const exportPreview = () => {
    const rows = visibleEvents.map((e) => ({
      Timestamp: formatDateTime(e.occurredAt), Actor: e.actor, Event: e.event, Target: e.targetLabel || "—",
      "Previous Value": e.previousValue || "—", "New Value": e.newValue || "—", Reason: e.reason || "—",
      Organization: organizations.find((o) => o.id === e.organizationId)?.name || e.organizationId,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Access Audit Preview");
    XLSX.writeFile(workbook, "access-audit-export-preview.xlsx");
  };

  return (
      <div className="p-4 md:p-6 space-y-5 text-white">
        <div className="text-xs text-gray-500 flex items-center gap-1">
          <span>Users &amp; Access</span> <span>/</span> <span className="text-gray-300">Access Audit</span>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Access Audit</h1>
            <p className="text-sm text-gray-400 mt-1 max-w-2xl">
              A read-only log of every member, invitation, and invite-link action taken in this preview. Nothing here can be edited or deleted.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => dispatch(fetchAccessAudit(filters))} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
              <RefreshCw size={15} /> Refresh
            </button>
            <button onClick={exportPreview} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
              <Download size={15} /> Export Preview
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Total Events" value={metrics.total} icon={<Activity size={14} className="text-blue-400" />} />
          <MetricCard label="Today" value={metrics.today} icon={<Activity size={14} />} />
          <MetricCard label="High-Risk Events" value={metrics.highRisk} icon={<ShieldAlert size={14} className="text-amber-400" />} />
          <MetricCard label="Distinct Actors" value={metrics.actors} icon={<Users size={14} />} />
        </div>

        <div className="flex flex-wrap items-end gap-3 bg-gray-900/40 border border-gray-800 rounded-xl p-3">
          {owner && (
            <div className="w-48">
              <label htmlFor="audit-org" className="block text-xs text-gray-400 mb-1">Organization</label>
              <select id="audit-org" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="">All organizations</option>
                {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <div className="w-56">
            <label htmlFor="audit-event" className="block text-xs text-gray-400 mb-1">Event type</label>
            <select id="audit-event" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All events</option>
              {eventTypes.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="audit-search" className="block text-xs text-gray-400 mb-1">Search actor or target</label>
            <input id="audit-search" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Priya Nair" />
          </div>
        </div>

        {loading && <div className="text-center text-gray-400 py-12 text-sm">Loading access audit…</div>}
        {error && (
          <div className="text-center py-12">
            <p className="text-red-400 text-sm mb-3">{error}</p>
            <button onClick={() => dispatch(fetchAccessAudit(filters))} className="text-sm text-blue-400 hover:underline">Retry</button>
          </div>
        )}

        {!loading && !error && visibleEvents.length === 0 && (
          <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
            <Activity size={28} className="mx-auto text-gray-600 mb-2" />
            <p className="text-gray-300 text-sm">No audit events match this view</p>
          </div>
        )}

        {!loading && !error && visibleEvents.length > 0 && (
          <div className="overflow-x-auto border border-gray-800 rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
                <tr>
                  <th scope="col" className="text-left px-4 py-3">Timestamp</th>
                  <th scope="col" className="text-left px-4 py-3">Actor</th>
                  <th scope="col" className="text-left px-4 py-3">Event</th>
                  <th scope="col" className="text-left px-4 py-3">Target</th>
                  {owner && <th scope="col" className="text-left px-4 py-3">Organization</th>}
                  <th scope="col" className="text-left px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map((e) => {
                  const org = organizations.find((o) => o.id === e.organizationId);
                  const highRisk = HIGH_RISK_EVENTS.includes(e.event);
                  return (
                    <tr key={e.id} className="border-t border-gray-800 hover:bg-gray-900/30">
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{formatDateTime(e.occurredAt)}</td>
                      <td className="px-4 py-3 text-gray-200">{e.actor}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] border ${highRisk ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-gray-700/40 text-gray-300 border-gray-600/40"}`}>
                          {e.event}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300">{e.targetLabel || "—"}</td>
                      {owner && <td className="px-4 py-3 text-gray-300">{org?.name || e.organizationId}</td>}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Audit event: ${detailEvent.event}`}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setDetailEvent(null)} />
            <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">{detailEvent.event}</h3>
                <button onClick={() => setDetailEvent(null)} aria-label="Close" className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
              </div>
              <dl className="space-y-2 text-sm">
                <DetailRow label="Timestamp" value={formatDateTime(detailEvent.occurredAt)} />
                <DetailRow label="Actor" value={detailEvent.actor} />
                <DetailRow label="Target" value={detailEvent.targetLabel || "—"} />
                {detailEvent.previousValue && <DetailRow label="Previous value" value={detailEvent.previousValue} />}
                {detailEvent.newValue && <DetailRow label="New value" value={detailEvent.newValue} />}
                {detailEvent.reason && <DetailRow label="Reason" value={detailEvent.reason} />}
                <DetailRow label="Source" value={detailEvent.source} />
                <DetailRow label="Status" value={detailEvent.status} />
              </dl>
              <p className="text-xs text-gray-500 mt-4 border-t border-gray-800 pt-3">This entry is part of a frontend-only preview log and cannot be edited or deleted.</p>
            </div>
          </div>
        )}
      </div>
  );
}

function MetricCard({ label, value, icon }) {
  return (
    <div className="text-left bg-gray-900/40 border border-gray-800 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase">{icon}{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
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
