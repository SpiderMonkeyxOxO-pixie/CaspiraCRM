import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Clock, AlertTriangle, ShieldCheck, RefreshCw, Zap } from "lucide-react";
import {
  fetchOrganizations, fetchSupportTicketPreviews, fetchSupportSlaConfigurations,
  fetchSupportEscalationRules, previewSupportEscalation,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewSupportSla, canManageSupportEscalations } from "./supportCommunicationConfig";
import ActionPreviewModal from "./ActionPreviewModal";

const SLA_STATES = ["Breached", "At Risk", "On Track", "Paused", "Completed", "Not Applicable", "Insufficient Data"];
const SLA_COLORS = {
  Breached: "text-red-400", "At Risk": "text-amber-400", "On Track": "text-emerald-400",
  Paused: "text-gray-400", Completed: "text-gray-400", "Not Applicable": "text-gray-500", "Insufficient Data": "text-gray-500",
};
const SLA_CARD_STYLE = {
  Breached: "border-red-500/30 bg-red-500/10 text-red-300",
  "At Risk": "border-amber-500/30 bg-amber-500/10 text-amber-300",
  "On Track": "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
};

export default function SupportSLA() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const role = useSelector((s) => s.auth.role);
  const {
    organizations, supportTicketPreviews, supportSlaConfigurations, supportEscalationRules,
    currentEscalationPreview, loading, error,
  } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [escalationRule, setEscalationRule] = useState(null);
  const [escalationTicketId, setEscalationTicketId] = useState("");

  const stateFilter = searchParams.get("status") || "";

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  const refresh = () => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchSupportTicketPreviews(filters));
    dispatch(fetchSupportSlaConfigurations(filters));
    dispatch(fetchSupportEscalationRules(filters));
  };

  useEffect(refresh, [dispatch, owner, selectedOrgId]);

  const canView = canViewSupportSla(role);

  const counts = useMemo(() => {
    const groups = Object.fromEntries(SLA_STATES.map((s) => [s, 0]));
    supportTicketPreviews.forEach((t) => { if (groups[t.slaState] !== undefined) groups[t.slaState] += 1; });
    return groups;
  }, [supportTicketPreviews]);

  const filteredTickets = useMemo(
    () => (stateFilter ? supportTicketPreviews.filter((t) => t.slaState === stateFilter) : supportTicketPreviews.filter((t) => ["Breached", "At Risk"].includes(t.slaState))),
    [supportTicketPreviews, stateFilter]
  );

  const eligibleTicketsForEscalation = useMemo(() => supportTicketPreviews.filter((t) => ["Breached", "At Risk"].includes(t.slaState)), [supportTicketPreviews]);

  const openEscalationPreview = (rule) => {
    setEscalationRule(rule);
    setEscalationTicketId(eligibleTicketsForEscalation[0]?.linkedTicketId || "");
  };

  useEffect(() => {
    if (escalationRule && escalationTicketId) {
      dispatch(previewSupportEscalation({ ruleId: escalationRule.id, ticketId: escalationTicketId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escalationRule, escalationTicketId]);

  if (!canView) {
    return <div className="p-4 md:p-6"><p className="text-sm text-red-400">You do not have permission to view SLA.</p></div>;
  }

  const previewDetails = currentEscalationPreview ? [
    { label: "Trigger", value: currentEscalationPreview.trigger },
    { label: "Current Ticket State", value: `${currentEscalationPreview.currentTicketState?.status || "—"} · ${currentEscalationPreview.currentTicketState?.priority || "—"}` },
    { label: "Proposed Change", value: currentEscalationPreview.proposedChange },
    { label: "Required Permission", value: currentEscalationPreview.requiredPermission },
    { label: "Required Approver", value: currentEscalationPreview.requiredApprover || "None" },
    { label: "Affected Users", value: currentEscalationPreview.affectedUsers?.length ? currentEscalationPreview.affectedUsers.join(", ") : "None" },
    { label: "Potential Customer Impact", value: currentEscalationPreview.potentialCustomerImpact },
  ] : [];

  return (
    <div className="p-4 md:p-6 space-y-4 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <button onClick={() => navigate("/admin/integrations/support-communication")} className="hover:text-gray-300">Administration</button>
        <span>/</span>
        <button onClick={() => navigate("/admin/integrations/support-communication")} className="hover:text-gray-300">Support &amp; Communication</button>
        <span>/</span>
        <span className="text-gray-300">SLA</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">SLA &amp; Escalations</h1>
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
      {loading && supportTicketPreviews.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">Loading SLA data…</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {["Breached", "At Risk", "On Track", "Paused"].map((state) => (
          <button
            key={state}
            onClick={() => setSearchParams(state === stateFilter ? {} : { status: state })}
            className={`text-left rounded-xl border p-3 transition-colors ${stateFilter === state ? SLA_CARD_STYLE[state] || "border-gray-700 bg-gray-800/40" : "border-gray-800 bg-gray-900/40 hover:border-gray-700"}`}
          >
            <p className="text-[11px] uppercase text-gray-500 mb-1">{state}</p>
            <p className={`text-xl font-bold ${SLA_COLORS[state]}`}>{counts[state]}</p>
          </button>
        ))}
      </div>

      <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-1.5 mb-3"><ShieldCheck size={14} className="text-blue-400" /> SLA Configuration</h2>
        {supportSlaConfigurations.length === 0 ? (
          <p className="text-xs text-gray-500">No SLA configuration for this scope.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {supportSlaConfigurations.map((cfg) => (
              <div key={cfg.id} className="border border-gray-800 rounded-lg p-3 text-xs text-gray-300 space-y-1">
                <p className="text-sm text-white font-medium">{cfg.name}</p>
                <p>Business hours: {cfg.businessHours} ({cfg.businessDays.join(", ")})</p>
                <p>Escalation threshold: {cfg.escalationThresholdPercent}% of target elapsed</p>
                <p>Pause conditions: {cfg.pauseConditions.join(", ") || "None"}</p>
                <div className="pt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
                  {Object.entries(cfg.targetHours).map(([tier, targets]) => (
                    <span key={tier}>{tier}: {targets.firstResponse}h / {targets.resolution}h</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-white flex items-center gap-1.5"><AlertTriangle size={14} className="text-amber-400" /> {stateFilter || "Breached / At Risk"} Tickets</h2>
          {stateFilter && <button onClick={() => setSearchParams({})} className="text-[11px] text-gray-400 hover:text-white">Clear filter</button>}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-800">
              <th className="p-3">Ticket</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Priority</th>
              <th className="p-3">SLA State</th>
              <th className="p-3">Queue</th>
              <th className="p-3">Assignee</th>
            </tr>
          </thead>
          <tbody>
            {filteredTickets.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-xs text-gray-500">No tickets in this state.</td></tr>
            ) : (
              filteredTickets.map((t) => (
                <tr key={t.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                  <td className="p-3">
                    <button onClick={() => navigate(`/admin/integrations/support-communication/tickets`)} className="text-blue-300 hover:underline">{t.ticketNumber}</button>
                    <span className="block text-[11px] text-gray-500 max-w-[200px] truncate">{t.subject}</span>
                  </td>
                  <td className="p-3 text-gray-300">{t.customerName}</td>
                  <td className="p-3 text-gray-300">{t.canonicalPriority}</td>
                  <td className={`p-3 font-medium ${SLA_COLORS[t.slaState] || "text-gray-400"}`}>{t.slaState}</td>
                  <td className="p-3 text-gray-400">{t.queueName}</td>
                  <td className="p-3 text-gray-400">{t.assigneeName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-1.5 mb-3"><Zap size={14} className="text-amber-400" /> Escalation Rules</h2>
        {supportEscalationRules.length === 0 ? (
          <p className="text-xs text-gray-500">No escalation rules configured for this scope.</p>
        ) : (
          <ul className="space-y-2">
            {supportEscalationRules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3 border border-gray-800 rounded-lg px-3 py-2">
                <div className="text-xs text-gray-300">
                  <p className="text-sm text-white">{rule.name}</p>
                  <p className="text-gray-500">Trigger: {rule.trigger} → {rule.action}</p>
                </div>
                {canManageSupportEscalations(role) ? (
                  <button
                    onClick={() => openEscalationPreview(rule)}
                    disabled={eligibleTicketsForEscalation.length === 0}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-30 whitespace-nowrap"
                  >
                    Preview Escalation
                  </button>
                ) : (
                  <span className="text-[11px] text-gray-500">View only</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-gray-500 pt-3 mt-2 border-t border-gray-800 flex items-center gap-1.5"><Clock size={11} /> Escalation previews only — no external notification is ever sent in this phase.</p>
      </section>

      {escalationRule && (
        <ActionPreviewModal
          title={`Preview: ${escalationRule.name}`}
          actionLabel={escalationRule.action}
          details={[
            { label: "Ticket", value: (
              <select value={escalationTicketId} onChange={(e) => setEscalationTicketId(e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white">
                {eligibleTicketsForEscalation.map((t) => <option key={t.linkedTicketId} value={t.linkedTicketId}>{t.ticketNumber} — {t.slaState}</option>)}
              </select>
            ) },
            ...previewDetails,
          ]}
          confirmLabel="Acknowledge Preview"
          confirmDisabled={!currentEscalationPreview}
          onConfirm={() => setEscalationRule(null)}
          onCancel={() => setEscalationRule(null)}
          previewNotice="This is a read-only preview of what the escalation rule would do. No notification is sent and no ticket state changes."
        />
      )}
    </div>
  );
}
