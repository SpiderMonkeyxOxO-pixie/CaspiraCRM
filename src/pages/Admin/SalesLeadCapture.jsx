import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  RefreshCw, UserPlus, X, SearchCheck, Route as RouteIcon,
} from "lucide-react";
import {
  fetchOrganizations, fetchLeadCaptureEvents, createLeadFromCapture, rejectLeadCapture,
  retryLeadCaptureProcessing, checkLeadCaptureDuplicates,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewLeadCapture, canProcessLeadCapture, canRejectLeadCapture, canManageLeadRouting } from "./salesMarketingConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import {
  LEAD_CAPTURE_STATUSES, findCampaignReference, LEAD_ROUTING_RULES,
  resolveRoutingRuleForLead, previewLeadRouting,
} from "../../Helpers/mockSalesMarketingData";
import ActionPreviewModal from "./ActionPreviewModal";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_COLORS = {
  "Needs Review": "text-amber-400", "Duplicate Detected": "text-amber-400", Failed: "text-red-400",
  Rejected: "text-red-400", "Ready to Create": "text-emerald-400", "Created in Preview": "text-emerald-400",
};

export default function SalesLeadCapture() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = useSelector((s) => s.auth.role);
  const { organizations, leadCaptureEvents, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRoutingRules, setShowRoutingRules] = useState(false);

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  const refresh = () => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    if (statusFilter) filters.status = statusFilter;
    dispatch(fetchLeadCaptureEvents(filters));
  };

  useEffect(refresh, [dispatch, owner, selectedOrgId, statusFilter]);

  const canView = canViewLeadCapture(role);

  const providerOptions = useMemo(() => {
    const keys = new Set(leadCaptureEvents.map((e) => e.providerKey));
    return [...keys].map(findProvider).filter(Boolean);
  }, [leadCaptureEvents]);

  const routingPreviewFor = (event) => {
    const rule = resolveRoutingRuleForLead(event.orgId, event.capturedFields);
    return previewLeadRouting(rule, event.capturedFields);
  };

  const handleCreateLead = async (event) => {
    await dispatch(createLeadFromCapture({ eventId: event.id }));
    refresh();
  };

  const handleRetry = async (event) => {
    await dispatch(retryLeadCaptureProcessing(event.id));
    refresh();
  };

  const handleCheckDuplicates = async (event) => {
    await dispatch(checkLeadCaptureDuplicates(event.id));
    refresh();
  };

  const submitReject = async () => {
    if (!rejectReason.trim() || !rejectTarget) return;
    await dispatch(rejectLeadCapture({ eventId: rejectTarget.id, reason: rejectReason.trim() }));
    setRejectTarget(null);
    setRejectReason("");
    refresh();
  };

  if (!canView) {
    return <div className="p-4 md:p-6"><p className="text-sm text-red-400">You do not have permission to view Lead Capture.</p></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <button onClick={() => navigate("/admin/integrations/sales-marketing")} className="hover:text-gray-300">Administration</button>
        <span>/</span>
        <button onClick={() => navigate("/admin/integrations/sales-marketing")} className="hover:text-gray-300">Sales &amp; Marketing</button>
        <span>/</span>
        <span className="text-gray-300">Lead Capture</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Lead Capture</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <div className="flex items-center gap-2">
          {owner && (
            <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          {canManageLeadRouting(role) && (
            <button onClick={() => setShowRoutingRules((v) => !v)} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800"><RouteIcon size={14} /> Routing Rules</button>
          )}
          <button onClick={refresh} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="lc-status" className="sr-only">Status</label>
        <select id="lc-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white">
          <option value="">All statuses</option>
          {LEAD_CAPTURE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {providerOptions.length > 0 && (
          <span className="text-[11px] text-gray-500">Providers: {providerOptions.map((p) => p.name).join(", ")}</span>
        )}
      </div>

      {showRoutingRules && (
        <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-2">Lead Routing Rules (reference only)</h2>
          <p className="text-[11px] text-gray-500 mb-3">Read-only — routing rule editing is not available in this preview. The Lead Capture table's Routing Preview column already reflects these rules live.</p>
          <ul className="space-y-1.5">
            {LEAD_ROUTING_RULES.map((r) => (
              <li key={r.id} className="text-xs text-gray-300 flex items-center justify-between bg-gray-800/40 rounded-lg px-3 py-1.5">
                <span>{r.name}</span>
                <span className="text-gray-500">{r.assignmentType}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && leadCaptureEvents.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">Loading lead capture events…</div>}

      <section className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-800">
              <th className="p-3">Provider</th>
              <th className="p-3">Captured Contact</th>
              <th className="p-3">Company</th>
              <th className="p-3">Campaign</th>
              <th className="p-3">Routing Preview</th>
              <th className="p-3">Status</th>
              <th className="p-3">Captured At</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leadCaptureEvents.length === 0 ? (
              <tr><td colSpan={8} className="p-6 text-center text-xs text-gray-500">No lead capture events match the current filters.</td></tr>
            ) : (
              leadCaptureEvents.map((e) => {
                const campaign = e.campaignReference ? findCampaignReference(e.campaignReference) : null;
                const routing = routingPreviewFor(e);
                return (
                  <tr key={e.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                    <td className="p-3 text-gray-200">{findProvider(e.providerKey)?.name || e.providerKey}</td>
                    <td className="p-3">
                      <span className="text-gray-200">{e.capturedFields.firstName} {e.capturedFields.lastName}</span>
                      <span className="block text-[11px] text-gray-500">{e.capturedFields.email}</span>
                    </td>
                    <td className="p-3 text-gray-400">{e.capturedFields.companyName}</td>
                    <td className="p-3 text-gray-400 text-[11px]">{campaign?.name || "—"}</td>
                    <td className="p-3 text-gray-400 text-[11px]">
                      {routing.assignedOwnerName ? `${routing.assignedOwnerName} (${routing.ruleName})` : `${routing.assignmentType}`}
                      {e.duplicateMatches?.length > 0 && <span className="block text-amber-300">{e.duplicateMatches.length} possible duplicate(s)</span>}
                    </td>
                    <td className={`p-3 font-medium ${STATUS_COLORS[e.status] || "text-gray-300"}`}>{e.status}</td>
                    <td className="p-3 text-gray-500 text-[11px]">{formatDateTime(e.capturedAt)}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(e.status === "Duplicate Detected" || e.status === "Needs Review") && (
                          <button onClick={() => handleCheckDuplicates(e)} title="Check Duplicates" className="p-1.5 rounded border border-gray-700 text-gray-300 hover:bg-gray-800"><SearchCheck size={13} /></button>
                        )}
                        {canProcessLeadCapture(role) && !e.createdLeadId && e.status !== "Rejected" && e.status !== "Failed" && (
                          <button onClick={() => handleCreateLead(e)} title="Create Lead Preview" className="p-1.5 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"><UserPlus size={13} /></button>
                        )}
                        {canProcessLeadCapture(role) && e.status === "Failed" && (
                          <button onClick={() => handleRetry(e)} title="Retry" className="p-1.5 rounded border border-gray-700 text-gray-300 hover:bg-gray-800"><RefreshCw size={13} /></button>
                        )}
                        {canRejectLeadCapture(role) && e.status !== "Rejected" && !e.createdLeadId && (
                          <button onClick={() => setRejectTarget(e)} title="Reject" className="p-1.5 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10"><X size={13} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {rejectTarget && (
        <ActionPreviewModal
          title="Reject Captured Lead"
          actionLabel={`Reject ${rejectTarget.capturedFields.firstName} ${rejectTarget.capturedFields.lastName}`}
          details={[
            { label: "Provider", value: findProvider(rejectTarget.providerKey)?.name || rejectTarget.providerKey },
            { label: "Email", value: rejectTarget.capturedFields.email },
          ]}
          requiresReason
          reason={rejectReason}
          onReasonChange={setRejectReason}
          reasonLabel="Reason for rejecting this captured lead"
          confirmLabel="Confirm Reject"
          onConfirm={submitReject}
          onCancel={() => { setRejectTarget(null); setRejectReason(""); }}
        />
      )}
    </div>
  );
}
