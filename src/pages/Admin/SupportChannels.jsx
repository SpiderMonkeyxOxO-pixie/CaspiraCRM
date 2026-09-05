import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  PlugZap, Users, MessageSquareText, Star, X, RefreshCw,
} from "lucide-react";
import {
  fetchOrganizations, fetchSupportChannels, fetchSupportQueueMappings, fetchSupportAgentMappings,
  fetchSupportReviews, draftSupportReviewReply,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import {
  isSystemOwner, canViewSupportChannels, canManageSupportQueues, canManageSupportAgentMappings,
  canViewSupportReviews, canReplyPreviewSupportReviews,
} from "./supportCommunicationConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { TEAMS } from "../../Helpers/mockAccessData";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_COLORS = {
  "Preview Connected": "text-emerald-400", "Attention Required": "text-amber-400",
  "Configuration Required": "text-amber-400", Disconnected: "text-gray-500",
};

export default function SupportChannels() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const {
    organizations, supportChannels, supportQueueMappings, supportAgentMappings, supportReviews, loading, error,
  } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [reviewsProviderKey, setReviewsProviderKey] = useState(null);
  const [draftText, setDraftText] = useState("");

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  const refresh = () => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchSupportChannels(filters));
    dispatch(fetchSupportQueueMappings(filters));
    dispatch(fetchSupportAgentMappings(filters));
    dispatch(fetchSupportReviews(filters));
  };

  useEffect(refresh, [dispatch, owner, selectedOrgId]);

  const canView = canViewSupportChannels(role);

  const queueById = useMemo(() => Object.fromEntries(supportQueueMappings.map((q) => [q.id, q])), [supportQueueMappings]);
  const teamById = useMemo(() => Object.fromEntries(TEAMS.map((t) => [t.id, t])), []);

  const reviewsForDrawer = useMemo(
    () => (reviewsProviderKey ? supportReviews.filter((r) => r.providerKey === reviewsProviderKey) : []),
    [supportReviews, reviewsProviderKey]
  );

  const handleSaveDraft = async (reviewId) => {
    if (!draftText.trim()) return;
    await dispatch(draftSupportReviewReply({ reviewId, draftText: draftText.trim() }));
    setDraftText("");
    refresh();
  };

  if (!canView) {
    return <div className="p-4 md:p-6"><p className="text-sm text-red-400">You do not have permission to view Support Channels.</p></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <button onClick={() => navigate("/admin/integrations/support-communication")} className="hover:text-gray-300">Administration</button>
        <span>/</span>
        <button onClick={() => navigate("/admin/integrations/support-communication")} className="hover:text-gray-300">Support &amp; Communication</button>
        <span>/</span>
        <span className="text-gray-300">Channels</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Support Channels</h1>
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
      {loading && supportChannels.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">Loading channels…</div>}

      <section className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-x-auto">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
          <PlugZap size={14} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-white">Connected Channels</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-800">
              <th className="p-3">Provider</th>
              <th className="p-3">Channel Type</th>
              <th className="p-3">Account</th>
              <th className="p-3">Queue</th>
              <th className="p-3">Team</th>
              <th className="p-3">Default Priority</th>
              <th className="p-3">Business Hours</th>
              <th className="p-3">Consent</th>
              <th className="p-3">Status</th>
              <th className="p-3">Last Preview Event</th>
            </tr>
          </thead>
          <tbody>
            {supportChannels.length === 0 ? (
              <tr><td colSpan={10} className="p-6 text-center text-xs text-gray-500">No channels connected for this scope.</td></tr>
            ) : (
              supportChannels.map((c) => {
                const provider = findProvider(c.providerKey);
                const queue = c.queueId ? queueById[c.queueId] : null;
                const team = c.assignedTeamId ? teamById[c.assignedTeamId] : null;
                return (
                  <tr key={c.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                    <td className="p-3 text-gray-200">{provider?.name || c.providerKey}</td>
                    <td className="p-3 text-gray-300">
                      {c.channelType === "Customer Review" ? (
                        <button onClick={() => setReviewsProviderKey(c.providerKey)} className="flex items-center gap-1 text-blue-300 hover:underline">
                          <Star size={12} /> {c.channelType}
                        </button>
                      ) : c.channelType}
                    </td>
                    <td className="p-3 text-gray-400">{c.connectedAccountLabel}</td>
                    <td className="p-3 text-gray-400">{queue ? queue.providerQueueName : "—"}</td>
                    <td className="p-3 text-gray-400">{team ? team.name : "—"}</td>
                    <td className="p-3 text-gray-300">{c.defaultPriority}</td>
                    <td className="p-3 text-gray-500 text-[11px]">{c.businessHours}</td>
                    <td className="p-3 text-[11px]">{c.consentRequired ? <span className="text-amber-300">Required</span> : <span className="text-gray-500">Not required</span>}</td>
                    <td className={`p-3 font-medium ${STATUS_COLORS[c.status] || "text-gray-400"}`}>{c.status}</td>
                    <td className="p-3 text-gray-500 text-[11px]">{formatDateTime(c.lastPreviewEventAt)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-x-auto">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
            <MessageSquareText size={14} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Queue Mapping</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-800">
                <th className="p-3">Provider Queue</th>
                <th className="p-3">Team</th>
                <th className="p-3">Department</th>
                <th className="p-3">Active</th>
              </tr>
            </thead>
            <tbody>
              {supportQueueMappings.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-xs text-gray-500">No queue mappings for this scope.</td></tr>
              ) : (
                supportQueueMappings.map((q) => (
                  <tr key={q.id} className="border-b border-gray-800/60">
                    <td className="p-3 text-gray-200">{q.providerQueueName}</td>
                    <td className="p-3 text-gray-400">{q.teamId ? teamById[q.teamId]?.name || "—" : "—"}</td>
                    <td className="p-3 text-gray-400">{q.department || "—"}</td>
                    <td className="p-3 text-[11px]">{q.active ? <span className="text-emerald-300">Active</span> : <span className="text-gray-500">Inactive</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {!canManageSupportQueues(role) && supportQueueMappings.length > 0 && (
            <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">Read-only — you do not have permission to manage queue mapping.</p>
          )}
        </section>

        <section className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-x-auto">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
            <Users size={14} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Agent Mapping</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-800">
                <th className="p-3">Provider Agent</th>
                <th className="p-3">Matched CRM User</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {supportAgentMappings.length === 0 ? (
                <tr><td colSpan={3} className="p-6 text-center text-xs text-gray-500">No agent mappings for this scope.</td></tr>
              ) : (
                supportAgentMappings.map((a) => (
                  <tr key={a.id} className="border-b border-gray-800/60">
                    <td className="p-3 text-gray-200">
                      {a.providerAgentName}
                      <span className="block text-[11px] text-gray-500">{a.providerAgentEmail}</span>
                    </td>
                    <td className="p-3 text-gray-400">{a.crmUserId ? a.department : "Unmapped"}</td>
                    <td className={`p-3 text-[11px] font-medium ${a.permissionStatus === "Verified" ? "text-emerald-300" : "text-amber-300"}`}>
                      {a.permissionStatus}
                      <span className="block text-gray-500 font-normal">{a.mappingHealth}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {!canManageSupportAgentMappings(role) && supportAgentMappings.length > 0 && (
            <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">Read-only — you do not have permission to manage agent mapping.</p>
          )}
        </section>
      </div>

      {reviewsProviderKey && (
        <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setReviewsProviderKey(null)} />
          <div role="dialog" aria-modal="true" aria-label="Customer reviews" className="relative bg-[#12141c] border-l border-gray-800 w-full max-w-md h-full overflow-y-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-1.5"><Star size={16} className="text-amber-400" /> Customer Reviews</h2>
              <button onClick={() => setReviewsProviderKey(null)} aria-label="Close"><X size={18} className="text-gray-400 hover:text-white" /></button>
            </div>
            {!canViewSupportReviews(role) ? (
              <p className="text-xs text-red-400">You do not have permission to view reviews.</p>
            ) : reviewsForDrawer.length === 0 ? (
              <p className="text-xs text-gray-500">No reviews for this location yet.</p>
            ) : (
              reviewsForDrawer.map((r) => (
                <div key={r.id} className="border border-gray-800 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white">{r.reviewerDisplayName || "Anonymous"}</span>
                    <span className="text-amber-400 text-xs">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                  </div>
                  <p className="text-xs text-gray-400">{r.reviewText}</p>
                  <p className="text-[11px] text-gray-500">{formatDateTime(r.reviewDate)} · {r.replyStatus}</p>
                  {r.replyDraft && (
                    <p className="text-[11px] text-gray-300 bg-gray-800/50 rounded p-2">Draft: {r.replyDraft}</p>
                  )}
                  {canReplyPreviewSupportReviews(role) ? (
                    <div>
                      <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={2} placeholder="Draft a reply (never posted automatically)…" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white" />
                      <button onClick={() => handleSaveDraft(r.id)} disabled={!draftText.trim()} className="mt-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white">Save Reply Draft</button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-500">You do not have permission to draft replies.</p>
                  )}
                </div>
              ))
            )}
            <p className="text-[11px] text-gray-500 border-t border-gray-800 pt-3">Reply drafts are saved as preview state only — nothing is ever posted to the live provider.</p>
          </div>
        </div>
      )}
    </div>
  );
}
