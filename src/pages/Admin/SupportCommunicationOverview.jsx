import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  Inbox, Ticket as TicketIcon, UserX, MailWarning, Clock, AlertTriangle, XCircle,
  PhoneMissed, Fingerprint, RefreshCw, ShieldAlert, PlugZap, CheckCircle2,
} from "lucide-react";
import {
  fetchOrganizations, fetchConnections, fetchSupportOverviewMetrics,
  fetchSupportChannels, fetchSupportConversations, fetchSupportSyncConflicts, fetchSupportCalls,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewSupportChannels, canManageSupportEscalations } from "./supportCommunicationConfig";
import { findProvider, FRONTEND_CONNECTION_PREVIEW_LABEL } from "../../Helpers/mockIntegrationsData";
import { SupportChannelType, SupportTicketStatus, SupportSLAStatus, SUPPORT_ESCALATION_RULES } from "../../Helpers/mockSupportCommunicationData";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function SupportCommunicationOverview() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const {
    organizations, connections, supportOverviewMetrics, supportChannels,
    supportConversations, supportSyncConflicts, supportCalls, loading, error,
  } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [slaStatusFilter, setSlaStatusFilter] = useState("");

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchSupportOverviewMetrics(filters));
    dispatch(fetchConnections(filters));
    dispatch(fetchSupportChannels(filters));
    dispatch(fetchSupportConversations(filters));
    dispatch(fetchSupportCalls(filters));
    dispatch(fetchSupportSyncConflicts({}));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => {
    if (owner) return null;
    return organizations[0]?.name || "Your organization";
  }, [owner, organizations]);

  const withinDateRange = (iso) => {
    if (!iso) return true;
    const t = new Date(iso).getTime();
    if (dateFrom && t < new Date(dateFrom).getTime()) return false;
    if (dateTo && t > new Date(dateTo).getTime() + 24 * 60 * 60 * 1000) return false;
    return true;
  };

  const filteredConversations = useMemo(
    () => supportConversations.filter((c) =>
      (!providerFilter || c.providerKey === providerFilter) &&
      (!channelFilter || c.channelType === channelFilter) &&
      (!statusFilter || c.status === statusFilter) &&
      withinDateRange(c.lastMessageAt)
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supportConversations, providerFilter, channelFilter, statusFilter, dateFrom, dateTo]
  );

  const filteredCalls = useMemo(
    () => supportCalls.filter((c) => (!providerFilter || c.providerKey === providerFilter) && withinDateRange(c.startedAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supportCalls, providerFilter, dateFrom, dateTo]
  );

  const supportProviderConnections = useMemo(() => {
    const supportKeys = new Set(supportChannels.map((c) => c.providerKey));
    return connections.filter((c) => supportKeys.has(c.providerKey));
  }, [connections, supportChannels]);

  const healthCounts = useMemo(() => {
    const counts = {};
    supportProviderConnections.forEach((c) => {
      const status = c.health?.status;
      if (!status) return;
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, [supportProviderConnections]);

  const workloadByChannel = useMemo(() => {
    const counts = {};
    filteredConversations.forEach((c) => {
      counts[c.channelType] = (counts[c.channelType] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filteredConversations]);

  const recentConversations = useMemo(
    () => filteredConversations.slice().sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt)).slice(0, 5),
    [filteredConversations]
  );
  const recentCalls = useMemo(
    () => filteredCalls.slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, 5),
    [filteredCalls]
  );
  const openConflicts = useMemo(() => supportSyncConflicts.filter((c) => c.resolutionState === "Open"), [supportSyncConflicts]);
  const activeEscalationRules = useMemo(
    () => SUPPORT_ESCALATION_RULES.filter((r) => r.active && (!selectedOrgId || r.organizationId === selectedOrgId)),
    [selectedOrgId]
  );

  const providerOptions = useMemo(() => {
    const keys = new Set(supportChannels.map((c) => c.providerKey));
    return [...keys].map(findProvider).filter(Boolean);
  }, [supportChannels]);

  const metrics = [
    { label: "Preview-Connected Providers", value: supportOverviewMetrics?.previewConnectedSupportProviders, icon: <PlugZap size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/support-communication/channels") },
    { label: "Open Ticket Previews", value: supportOverviewMetrics?.openSyncedTicketPreviews, icon: <TicketIcon size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/support-communication/tickets?status=Open") },
    { label: "Unassigned Tickets", value: supportOverviewMetrics?.unassignedTickets, icon: <UserX size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/support-communication/tickets?assignee=unassigned") },
    { label: "Unread Conversations", value: supportOverviewMetrics?.unreadConversations, icon: <Inbox size={14} className="text-blue-400" />, onClick: () => navigate("/admin/integrations/support-communication/inbox?unread=true") },
    { label: "Waiting on Customer", value: supportOverviewMetrics?.waitingOnCustomerTickets, icon: <MailWarning size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/support-communication/tickets?status=Waiting on Customer") },
    { label: "SLA At Risk", value: supportOverviewMetrics?.slaAtRisk, icon: <Clock size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/support-communication/sla?status=At Risk") },
    { label: "SLA Breached", value: supportOverviewMetrics?.slaBreached, icon: <AlertTriangle size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/support-communication/sla?status=Breached") },
    { label: "Missed Calls", value: supportOverviewMetrics?.missedCalls, icon: <PhoneMissed size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/support-communication/telephony?result=Missed") },
    { label: "Identity Matches to Review", value: supportOverviewMetrics?.identityMatchesRequiringReview, icon: <Fingerprint size={14} className="text-amber-400" />, onClick: () => navigate("/admin/integrations/support-communication/inbox?identity=review") },
    { label: "Synchronization Errors", value: supportOverviewMetrics?.synchronizationErrors, icon: <XCircle size={14} className="text-red-400" />, onClick: () => navigate("/admin/integrations/support-communication/tickets?tab=conflicts") },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span> <span>Integrations</span> <span>/</span> <span className="text-gray-300">Support & Communication</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Support and Communication Integrations</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Preview omnichannel support conversations, ticket synchronization, telephony and SLA monitoring across connected providers. Every
            connection here is a <span className="text-gray-300 font-medium">{FRONTEND_CONNECTION_PREVIEW_LABEL}</span> — no real ticket,
            message or phone call is accessed in this phase.
          </p>
          {!owner && orgLabel && <p className="text-xs text-gray-500 mt-1">Organization: <span className="text-gray-300">{orgLabel}</span></p>}
        </div>
        {owner && (
          <div>
            <label htmlFor="support-comm-org" className="sr-only">Organization</label>
            <select id="support-comm-org" value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <div>
          <label htmlFor="filter-date-from" className="sr-only">From date</label>
          <input id="filter-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white" />
        </div>
        <div>
          <label htmlFor="filter-date-to" className="sr-only">To date</label>
          <input id="filter-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white" />
        </div>
        <div>
          <label htmlFor="filter-provider" className="sr-only">Provider</label>
          <select id="filter-provider" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
            <option value="">All providers</option>
            {providerOptions.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="filter-channel" className="sr-only">Channel</label>
          <select id="filter-channel" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
            <option value="">All channels</option>
            {SupportChannelType.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="filter-status" className="sr-only">Ticket status</label>
          <select id="filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
            <option value="">All statuses</option>
            {SupportTicketStatus.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="filter-sla-status" className="sr-only">SLA status</label>
          <select id="filter-sla-status" value={slaStatusFilter} onChange={(e) => setSlaStatusFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
            <option value="">All SLA states</option>
            {SupportSLAStatus.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <p className="text-[11px] text-gray-500 ml-1">Queue, team and assignee filters are available on the Tickets and Telephony routes.</p>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading Support & Communication Integrations…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {metrics.map((m) => (
              <MetricCard key={m.label} label={m.label} value={m.value ?? "—"} icon={m.icon} onClick={m.onClick} />
            ))}
          </div>

          <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><ShieldAlert size={14} className="text-blue-400" /> Support Health</h2>
            {supportProviderConnections.length === 0 ? (
              <p className="text-xs text-gray-500">No support/communication providers are connected yet.</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {Object.entries(healthCounts).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-1.5 text-sm text-gray-300">
                    {status === "Healthy" ? <CheckCircle2 size={14} className="text-emerald-400" /> : <AlertTriangle size={14} className="text-amber-400" />}
                    {count} {status}
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Omnichannel Workload</h2>
              {workloadByChannel.length === 0 ? (
                <p className="text-xs text-gray-500">No conversations match the current filters.</p>
              ) : (
                <ul className="space-y-2">
                  {workloadByChannel.map(([channel, count]) => (
                    <li key={channel} className="flex items-center justify-between text-sm text-gray-300">
                      <span>{channel}</span>
                      <span className="text-xs text-gray-500">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><Clock size={14} className="text-amber-400" /> SLA Risks</h2>
              <p className="text-sm text-gray-300">{supportOverviewMetrics?.slaAtRisk ?? 0} tickets at risk, {supportOverviewMetrics?.slaBreached ?? 0} breached.</p>
              <p className="text-xs text-gray-500 mt-1">Calculated from each Ticket's real SLA deadline against its organization's SLA configuration — never a hardcoded figure. Detailed review is available on the SLA route.</p>
            </section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><UserX size={14} className="text-amber-400" /> Unassigned Work</h2>
              <p className="text-sm text-gray-300">{supportOverviewMetrics?.unassignedTickets ?? 0} open tickets have no assigned agent.</p>
              <p className="text-xs text-gray-500 mt-1">Assignment review is available on the Tickets route.</p>
            </section>

            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Recent Conversations</h2>
              {recentConversations.length === 0 ? (
                <p className="text-xs text-gray-500">No conversations match the current filters.</p>
              ) : (
                <ul className="space-y-2">
                  {recentConversations.map((c) => (
                    <li key={c.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-300 truncate max-w-[60%]">{c.customer?.name || "Unknown customer"} — {c.channelType}</span>
                      <span className="text-xs text-gray-500">{formatDateTime(c.lastMessageAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><PhoneMissed size={14} className="text-red-400" /> Recent Calls</h2>
              {recentCalls.length === 0 ? (
                <p className="text-xs text-gray-500">No call activity matches the current filters.</p>
              ) : (
                <ul className="space-y-2">
                  {recentCalls.map((c) => (
                    <li key={c.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-300">{findProvider(c.providerKey)?.name || c.providerKey} — {c.direction}</span>
                      <span className={`text-[11px] ${c.result === "Missed" ? "text-red-400" : "text-emerald-400"}`}>{c.result}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><Fingerprint size={14} className="text-amber-400" /> Identity-Matching Issues</h2>
              <p className="text-sm text-gray-300">{supportOverviewMetrics?.identityMatchesRequiringReview ?? 0} conversations need identity-match review.</p>
              <p className="text-xs text-gray-500 mt-1">Matches are never merged automatically — review each candidate on the Inbox route.</p>
            </section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><RefreshCw size={14} className="text-red-400" /> Synchronization Errors</h2>
              {openConflicts.length === 0 ? (
                <p className="text-xs text-gray-500">No open synchronization conflicts.</p>
              ) : (
                <ul className="space-y-2">
                  {openConflicts.map((c) => (
                    <li key={c.id} className="flex items-center justify-between text-sm text-gray-300">
                      <span>{c.conflictType}</span>
                      <span className="text-[11px] text-amber-300">{c.resolutionState}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Internal Escalations</h2>
              {activeEscalationRules.length === 0 ? (
                <p className="text-xs text-gray-500">No escalation rules are configured for this organization.</p>
              ) : (
                <ul className="space-y-2">
                  {activeEscalationRules.map((r) => (
                    <li key={r.id} className="text-sm text-gray-300">
                      <span className="font-medium">{r.name}</span>
                      <span className="block text-xs text-gray-500">{r.trigger} → {r.action}</span>
                    </li>
                  ))}
                </ul>
              )}
              {canManageSupportEscalations(role) && (
                <p className="text-[11px] text-gray-500 mt-2">Escalations never send a real external notification in this phase — every trigger opens an action preview requiring confirmation.</p>
              )}
            </section>
          </div>

          {canViewSupportChannels(role) && (
            <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Connected Channels</h2>
              {supportChannels.length === 0 ? (
                <p className="text-xs text-gray-500">No channels are configured yet.</p>
              ) : (
                <ul className="grid sm:grid-cols-2 gap-2">
                  {supportChannels.map((c) => (
                    <li key={c.id} className="flex items-center justify-between text-sm text-gray-300 bg-gray-800/40 rounded-lg px-3 py-2">
                      <span>{findProvider(c.providerKey)?.name || c.providerKey} — {c.channelType}</span>
                      <span className="text-[11px] text-gray-500">{c.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
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
