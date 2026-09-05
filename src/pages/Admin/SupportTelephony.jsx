import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  Phone, PhoneMissed, PhoneOutgoing, PhoneIncoming, RefreshCw, Lock, FileAudio, FileText,
} from "lucide-react";
import {
  fetchOrganizations, fetchSupportCalls, createCallFollowUpActivity,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewSupportCalls, canManageSupportCalls, canViewSupportRecordings, canViewSupportTranscripts } from "./supportCommunicationConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { CRM_TEAM } from "../../Helpers/mockUsersData";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatDuration(seconds) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const RESULT_COLORS = { Answered: "text-emerald-400", Missed: "text-red-400", Voicemail: "text-amber-400", "No Answer": "text-red-400" };
const ACCESS_LABEL = {
  Available: { text: "text-emerald-400", label: "Available" },
  "Consent Required": { text: "text-amber-400", label: "Consent Required" },
  "Retention Expired": { text: "text-gray-500", label: "Retention Expired" },
  Unavailable: { text: "text-gray-500", label: "Unavailable" },
  "Processing Preview": { text: "text-blue-400", label: "Processing…" },
  Restricted: { text: "text-amber-400", label: "Restricted" },
};

function AccessIndicator({ state, icon: Icon, canView }) {
  const cfg = ACCESS_LABEL[state] || ACCESS_LABEL.Unavailable;
  if (state === "Available" && !canView) {
    return <span className="flex items-center gap-1 text-[11px] text-gray-500"><Lock size={11} /> Permission required</span>;
  }
  return <span className={`flex items-center gap-1 text-[11px] ${cfg.text}`}><Icon size={11} /> {cfg.label}</span>;
}

export default function SupportTelephony() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const { organizations, supportCalls, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [missedOnly, setMissedOnly] = useState(false);

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  const refresh = () => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchSupportCalls(filters));
  };

  useEffect(refresh, [dispatch, owner, selectedOrgId]);

  const canView = canViewSupportCalls(role);

  const filtered = useMemo(() => {
    return supportCalls.filter((c) => {
      if (missedOnly && c.result !== "Missed" && c.result !== "No Answer") return false;
      if (resultFilter && c.result !== resultFilter) return false;
      return true;
    });
  }, [supportCalls, missedOnly, resultFilter]);

  const missedQueue = useMemo(() => supportCalls.filter((c) => (c.result === "Missed" || c.result === "No Answer") && c.followUpStatus !== "Activity Created"), [supportCalls]);

  const dispositionSummary = useMemo(() => {
    const groups = {};
    supportCalls.forEach((c) => { groups[c.disposition] = (groups[c.disposition] || 0) + 1; });
    return Object.entries(groups).sort((a, b) => b[1] - a[1]);
  }, [supportCalls]);

  const handleCreateFollowUp = async (callId) => {
    await dispatch(createCallFollowUpActivity(callId));
    refresh();
  };

  if (!canView) {
    return <div className="p-4 md:p-6"><p className="text-sm text-red-400">You do not have permission to view Telephony.</p></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <button onClick={() => navigate("/admin/integrations/support-communication")} className="hover:text-gray-300">Administration</button>
        <span>/</span>
        <button onClick={() => navigate("/admin/integrations/support-communication")} className="hover:text-gray-300">Support &amp; Communication</button>
        <span>/</span>
        <span className="text-gray-300">Telephony</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Telephony</h1>
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
      {loading && supportCalls.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">Loading calls…</div>}

      <div className="grid md:grid-cols-3 gap-4">
        {missedQueue.length > 0 && (
          <section className="md:col-span-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-amber-300 flex items-center gap-1.5 mb-2"><PhoneMissed size={14} /> Missed Call Queue ({missedQueue.length})</h2>
            <ul className="space-y-1.5">
              {missedQueue.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-xs text-amber-100/90 bg-amber-500/5 rounded-lg px-3 py-1.5">
                  <span>{findProvider(c.providerKey)?.name || c.providerKey} · {c.phoneNumberMasked} · {formatDateTime(c.startedAt)}</span>
                  {canManageSupportCalls(role) && (
                    <button onClick={() => handleCreateFollowUp(c.id)} className="text-[11px] px-2 py-1 rounded border border-amber-500/40 hover:bg-amber-500/20">Create Follow-up Preview</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Disposition Summary</h2>
          {dispositionSummary.length === 0 ? (
            <p className="text-xs text-gray-500">No calls in this scope.</p>
          ) : (
            <ul className="space-y-1.5">
              {dispositionSummary.map(([disposition, count]) => (
                <li key={disposition} className="flex items-center justify-between text-xs text-gray-300">
                  <span>{disposition}</span>
                  <span className="text-gray-500">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="md:col-span-2 bg-gray-900/40 border border-gray-800 rounded-xl p-4 flex items-center gap-3 flex-wrap">
          <label htmlFor="tel-result" className="sr-only">Result</label>
          <select id="tel-result" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white">
            <option value="">All results</option>
            {Object.keys(RESULT_COLORS).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-300">
            <input type="checkbox" checked={missedOnly} onChange={(e) => setMissedOnly(e.target.checked)} /> Missed only
          </label>
        </section>
      </div>

      <section className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-800">
              <th className="p-3">Direction</th>
              <th className="p-3">Provider</th>
              <th className="p-3">Number</th>
              <th className="p-3">Agent</th>
              <th className="p-3">Started</th>
              <th className="p-3">Duration</th>
              <th className="p-3">Result</th>
              <th className="p-3">Disposition</th>
              <th className="p-3">Recording</th>
              <th className="p-3">Transcript</th>
              <th className="p-3">Follow-up</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="p-6 text-center text-xs text-gray-500">No calls match the current filters.</td></tr>
            ) : (
              filtered.map((c) => {
                const agent = c.agentId ? CRM_TEAM.find((m) => m.id === c.agentId) : null;
                return (
                  <tr key={c.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                    <td className="p-3">
                      {c.direction === "Inbound" ? <PhoneIncoming size={14} className="text-blue-400" /> : <PhoneOutgoing size={14} className="text-gray-400" />}
                    </td>
                    <td className="p-3 text-gray-300">{findProvider(c.providerKey)?.name || c.providerKey}</td>
                    <td className="p-3 text-gray-400">{c.phoneNumberMasked}</td>
                    <td className="p-3 text-gray-400">{agent ? agent.name : "Unassigned"}</td>
                    <td className="p-3 text-gray-500 text-[11px]">{formatDateTime(c.startedAt)}</td>
                    <td className="p-3 text-gray-400">{formatDuration(c.durationSeconds)}</td>
                    <td className={`p-3 font-medium ${RESULT_COLORS[c.result] || "text-gray-300"}`}>{c.result}</td>
                    <td className="p-3 text-gray-400">{c.disposition}</td>
                    <td className="p-3"><AccessIndicator state={c.recordingAvailability} icon={FileAudio} canView={canViewSupportRecordings(role)} /></td>
                    <td className="p-3"><AccessIndicator state={c.transcriptAvailability} icon={FileText} canView={canViewSupportTranscripts(role)} /></td>
                    <td className="p-3">
                      {c.followUpStatus === "Activity Created" ? (
                        <span className="text-[11px] text-emerald-300">Activity Created</span>
                      ) : (c.result === "Missed" || c.result === "No Answer" || c.followUpStatus === "Pending") && canManageSupportCalls(role) ? (
                        <button onClick={() => handleCreateFollowUp(c.id)} className="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800">Create Follow-up</button>
                      ) : (
                        <span className="text-[11px] text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <p className="text-[11px] text-gray-500 flex items-center gap-1.5"><Phone size={11} /> Recordings and transcripts are shown as access-state indicators only — no audio, URL, or token is ever exposed in this preview.</p>
    </div>
  );
}
