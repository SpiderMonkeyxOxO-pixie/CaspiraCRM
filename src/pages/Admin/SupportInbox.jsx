import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, Send, StickyNote, Undo2, ArrowUpRight, Paperclip, AtSign, Fingerprint,
  Building2, Ticket as TicketIcon, Clock, Eye, EyeOff, MessageSquareOff,
} from "lucide-react";
import {
  fetchOrganizations, fetchSupportConversations, fetchSupportIdentityMatch,
  sendMessagePreview, undoConversationMessage, escalateConversationToTicket,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import {
  isSystemOwner, canViewSupportInbox, canReplyPreviewSupportInbox, canInternalNoteSupportInbox,
  canViewSupportIdentity, canLinkSupportIdentity, canCreateContactFromSupportIdentity,
} from "./supportCommunicationConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { SupportChannelType, SupportTicketStatus } from "../../Helpers/mockSupportCommunicationData";
import { CRM_TEAM } from "../../Helpers/mockUsersData";

const REPLY_TEMPLATES = [
  { id: "ack", label: "Acknowledge", text: "Thanks for reaching out — we're looking into this now and will follow up shortly." },
  { id: "info", label: "Request info", text: "Could you share a bit more detail so we can investigate this properly?" },
  { id: "resolved", label: "Mark resolved", text: "This should now be resolved on our end — please let us know if you're still seeing the issue." },
];

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function maskEmail(email) {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!domain) return "•••";
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

function maskPhone(phone) {
  if (!phone) return null;
  return phone.replace(/\d(?=\d{3})/g, "•");
}

const IDENTITY_STATE_COLORS = {
  Matched: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Possible Match": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Multiple Matches": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Conflict: "bg-red-500/15 text-red-300 border-red-500/30",
  "Restricted Match": "bg-red-500/15 text-red-300 border-red-500/30",
  "No Match": "bg-gray-700/40 text-gray-300 border-gray-600/40",
  Ignored: "bg-gray-800 text-gray-500 border-gray-700",
};

export default function SupportInbox() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = useSelector((s) => s.auth.role);
  const { organizations, supportConversations, currentIdentityMatch, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [unreadOnly, setUnreadOnly] = useState(searchParams.get("unread") === "true");
  const [selectedId, setSelectedId] = useState(null);
  const [composerMode, setComposerMode] = useState("Public");
  const [composerText, setComposerText] = useState("");
  const [composerAttachment, setComposerAttachment] = useState("");
  const [composerMention, setComposerMention] = useState("");
  const [revealContactInfo, setRevealContactInfo] = useState(false);
  const [lastSentMessageId, setLastSentMessageId] = useState(null);

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchSupportConversations(filters));
  }, [dispatch, owner, selectedOrgId]);

  const canViewInbox = canViewSupportInbox(role);

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return supportConversations.filter((c) => {
      if (providerFilter && c.providerKey !== providerFilter) return false;
      if (channelFilter && c.channelType !== channelFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (unreadOnly && !c.unread) return false;
      if (term) {
        const haystack = `${c.customer?.name || ""} ${c.customer?.email || ""} ${c.tags?.join(" ") || ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  }, [supportConversations, providerFilter, channelFilter, statusFilter, unreadOnly, search]);

  useEffect(() => {
    if (!selectedId && filteredConversations.length > 0) setSelectedId(filteredConversations[0].id);
  }, [filteredConversations, selectedId]);

  const selectedConversation = useMemo(
    () => supportConversations.find((c) => c.id === selectedId) || null,
    [supportConversations, selectedId]
  );

  useEffect(() => {
    if (selectedConversation && canViewSupportIdentity(role) && !selectedConversation.linkedTicketId) {
      dispatch(fetchSupportIdentityMatch(selectedConversation.id));
    }
  }, [dispatch, selectedConversation, role]);

  const providerOptions = useMemo(() => {
    const keys = new Set(supportConversations.map((c) => c.providerKey));
    return [...keys].map(findProvider).filter(Boolean);
  }, [supportConversations]);

  const handleSelect = (id) => {
    setSelectedId(id);
    setComposerText("");
    setComposerAttachment("");
    setComposerMention("");
    setLastSentMessageId(null);
  };

  const handleConfirm = async () => {
    if (!selectedConversation || !composerText.trim()) return;
    let body = composerText.trim();
    if (composerMode === "Internal" && composerMention) body = `@${composerMention} ${body}`;
    if (composerAttachment.trim()) body = `${body} [Attachment: ${composerAttachment.trim()}]`;
    const result = await dispatch(sendMessagePreview({ conversationId: selectedConversation.id, visibility: composerMode, body }));
    if (result.meta.requestStatus === "fulfilled") {
      setLastSentMessageId(result.payload?.message?.id || null);
      setComposerText("");
      setComposerAttachment("");
      setComposerMention("");
    }
  };

  const handleUndo = () => {
    if (!selectedConversation) return;
    dispatch(undoConversationMessage(selectedConversation.id));
    setLastSentMessageId(null);
  };

  const handleEscalate = () => {
    if (!selectedConversation) return;
    dispatch(escalateConversationToTicket({ conversationId: selectedConversation.id, overrides: {} }));
  };

  const canReply = canReplyPreviewSupportInbox(role);
  const canNote = canInternalNoteSupportInbox(role);
  const canComposerMode = composerMode === "Public" ? canReply : canNote;

  if (!canViewInbox) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-sm text-red-400">You do not have permission to view the Support Inbox.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 text-white h-full flex flex-col">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <button onClick={() => navigate("/admin/integrations/support-communication")} className="hover:text-gray-300">Administration</button>
        <span>/</span>
        <button onClick={() => navigate("/admin/integrations/support-communication")} className="hover:text-gray-300">Support & Communication</button>
        <span>/</span>
        <span className="text-gray-300">Inbox</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Omnichannel Inbox</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        {owner && (
          <div>
            <label htmlFor="inbox-org" className="sr-only">Organization</label>
            <select id="inbox-org" value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && supportConversations.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">Loading conversations…</div>}

      <div className="flex-1 grid md:grid-cols-[360px_1fr] gap-4 min-h-0">
        {/* Conversation list */}
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl flex flex-col min-h-0">
          <div className="p-3 border-b border-gray-800 space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-gray-500" aria-hidden="true" />
              <label htmlFor="inbox-search" className="sr-only">Search conversations</label>
              <input id="inbox-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, tag…"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-2 py-1.5 text-xs text-white" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <label htmlFor="inbox-provider" className="sr-only">Provider</label>
              <select id="inbox-provider" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-[11px] text-white">
                <option value="">All providers</option>
                {providerOptions.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
              <label htmlFor="inbox-channel" className="sr-only">Channel</label>
              <select id="inbox-channel" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-[11px] text-white">
                <option value="">All channels</option>
                {SupportChannelType.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <label htmlFor="inbox-status" className="sr-only">Status</label>
              <select id="inbox-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-[11px] text-white">
                <option value="">All statuses</option>
                {SupportTicketStatus.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <label className="flex items-center gap-1 text-[11px] text-gray-400">
                <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only
              </label>
            </div>
          </div>

          <ul className="overflow-y-auto flex-1" aria-label="Conversations">
            {filteredConversations.length === 0 ? (
              <li className="p-4 text-xs text-gray-500">No conversations match the current filters.</li>
            ) : (
              filteredConversations.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => handleSelect(c.id)}
                    aria-current={selectedId === c.id ? "true" : undefined}
                    className={`w-full text-left px-3 py-2.5 border-b border-gray-800/60 transition ${selectedId === c.id ? "bg-blue-500/10 border-l-2 border-l-blue-500" : "hover:bg-gray-800/40"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white truncate flex items-center gap-1.5">
                        {c.unread && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" aria-hidden="true" />}
                        {c.customer?.name || "Unknown customer"}
                      </span>
                      <span className="text-[10px] text-gray-500 shrink-0">{formatDateTime(c.lastMessageAt)}</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{c.messages[c.messages.length - 1]?.body || "No messages yet"}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] text-gray-500">{findProvider(c.providerKey)?.name || c.providerKey} · {c.channelType}</span>
                      <span className="text-[10px] text-gray-400">{c.status}</span>
                    </div>
                    {c.unread && <span className="sr-only">Unread</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Conversation detail */}
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl flex flex-col min-h-0">
          {!selectedConversation ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-500">Select a conversation to view its history.</div>
          ) : (
            <>
              <div className="p-4 border-b border-gray-800 flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-base font-semibold text-white">{selectedConversation.customer?.name || "Unknown customer"}</h2>
                  <div className="text-xs text-gray-400 mt-1 flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1">
                      {revealContactInfo ? (selectedConversation.customer?.email || selectedConversation.customer?.phone || "No contact info") : (maskEmail(selectedConversation.customer?.email) || maskPhone(selectedConversation.customer?.phone) || "No contact info")}
                    </span>
                    <button onClick={() => setRevealContactInfo((v) => !v)} className="flex items-center gap-1 text-blue-400 hover:underline">
                      {revealContactInfo ? <EyeOff size={12} /> : <Eye size={12} />} {revealContactInfo ? "Hide" : "Reveal"}
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">Data freshness: {formatDateTime(selectedConversation.dataFreshness)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedConversation.linkedTicketId ? (
                    <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                      <TicketIcon size={12} /> Linked to Ticket
                    </span>
                  ) : (
                    <button onClick={handleEscalate} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800">
                      <ArrowUpRight size={12} /> Escalate to Ticket
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Provider reference + linked records */}
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="px-2 py-1 rounded-lg bg-gray-800/60 text-gray-300">Provider: {findProvider(selectedConversation.providerKey)?.name || selectedConversation.providerKey}</span>
                  <span className="px-2 py-1 rounded-lg bg-gray-800/60 text-gray-300">Reference: {selectedConversation.externalReference}</span>
                  <span className="px-2 py-1 rounded-lg bg-gray-800/60 text-gray-300">Channel: {selectedConversation.channelType}</span>
                  {selectedConversation.linkedCompanyId && (
                    <span className="px-2 py-1 rounded-lg bg-gray-800/60 text-gray-300 flex items-center gap-1"><Building2 size={11} /> Linked Company</span>
                  )}
                </div>

                {/* Identity match panel */}
                {canViewSupportIdentity(role) && !selectedConversation.linkedTicketId && (
                  <div className="border border-gray-800 rounded-lg p-3">
                    <h3 className="text-xs font-semibold text-white mb-2 flex items-center gap-1.5"><Fingerprint size={13} /> Customer Identity Match</h3>
                    {!currentIdentityMatch ? (
                      <p className="text-xs text-gray-500">Checking for a matching Contact…</p>
                    ) : (
                      <div className="space-y-2">
                        <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${IDENTITY_STATE_COLORS[currentIdentityMatch.state] || IDENTITY_STATE_COLORS["No Match"]}`}>
                          {currentIdentityMatch.state}
                        </span>
                        {currentIdentityMatch.privacyWarning && <p className="text-[11px] text-amber-300">{currentIdentityMatch.privacyWarning}</p>}
                        {currentIdentityMatch.candidateRecords.length > 0 && (
                          <ul className="text-xs text-gray-300 space-y-1">
                            {currentIdentityMatch.candidateRecords.map((cand) => (
                              <li key={cand.contactId} className="flex items-center justify-between">
                                <span>{cand.name} {cand.companyName ? `— ${cand.companyName}` : ""}</span>
                                <span className="text-[10px] text-gray-500">{cand.confidenceLabel} ({cand.confidencePercent}%)</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="text-[11px] text-gray-500">Suggested action: {currentIdentityMatch.suggestedAction}</p>
                        <div className="flex gap-2">
                          {canLinkSupportIdentity(role) && currentIdentityMatch.candidateRecords.length > 0 && (
                            <button className="text-[11px] px-2 py-1 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800">Link to Contact</button>
                          )}
                          {canCreateContactFromSupportIdentity(role) && currentIdentityMatch.state === "No Match" && (
                            <button className="text-[11px] px-2 py-1 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800">Create Contact (requires confirmation)</button>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500">Never automatically merged — every link/create action requires explicit confirmation via the shared Contact form.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Status/assignment/SLA history — honest disclosure since this
                    preview conversation entity doesn't track a change log yet. */}
                <div className="border border-gray-800 rounded-lg p-3">
                  <h3 className="text-xs font-semibold text-white mb-1 flex items-center gap-1.5"><Clock size={13} /> Status, Assignment and SLA Timeline</h3>
                  <p className="text-[11px] text-gray-500">
                    Current status: {selectedConversation.status} · Priority: {selectedConversation.priority} · Assignee: {CRM_TEAM.find((m) => m.id === selectedConversation.assigneeId)?.name || "Unassigned"}.
                    No status/assignment change history has been recorded for this preview conversation yet.
                  </p>
                </div>

                {/* Conversation history */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-white">Conversation History</h3>
                  {selectedConversation.messages.length === 0 ? (
                    <p className="text-xs text-gray-500">No messages yet.</p>
                  ) : (
                    selectedConversation.messages.map((m) => (
                      <div key={m.id} className={`rounded-lg p-2.5 text-sm ${m.visibility === "Internal" ? "bg-amber-500/10 border border-amber-500/20" : "bg-gray-800/50"}`}>
                        <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1">
                          <span className="flex items-center gap-1.5 font-medium">
                            {m.visibility === "Internal" ? <StickyNote size={11} className="text-amber-400" /> : <MessageSquareOff size={11} className="text-blue-400" />}
                            {m.author} · {m.direction} · {m.visibility === "Internal" ? "Internal Note" : "Public"}
                          </span>
                          <span>{formatDateTime(m.sentAt)}</span>
                        </div>
                        <p className="text-gray-200">{m.body}</p>
                        {m.attachments?.length > 0 && (
                          <div className="flex items-center gap-1 mt-1 text-[11px] text-gray-500"><Paperclip size={10} /> {m.attachments.length} attachment(s)</div>
                        )}
                        {m.previewLabel && <span className="block text-[10px] text-gray-500 mt-1">{m.previewLabel}</span>}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Composer */}
              <div className="border-t border-gray-800 p-3 space-y-2">
                <div className="flex items-center gap-2" role="tablist" aria-label="Message composer mode">
                  <button
                    role="tab" aria-selected={composerMode === "Public"}
                    onClick={() => setComposerMode("Public")}
                    disabled={!canReply}
                    className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border ${composerMode === "Public" ? "bg-blue-500/15 text-blue-300 border-blue-500/30" : "border-gray-700 text-gray-400"} disabled:opacity-40`}
                  >
                    <Send size={12} /> Public Reply Preview
                  </button>
                  <button
                    role="tab" aria-selected={composerMode === "Internal"}
                    onClick={() => setComposerMode("Internal")}
                    disabled={!canNote}
                    className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border ${composerMode === "Internal" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "border-gray-700 text-gray-400"} disabled:opacity-40`}
                  >
                    <StickyNote size={12} /> Internal Note Preview
                  </button>
                  {lastSentMessageId && (
                    <button onClick={handleUndo} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 ml-auto">
                      <Undo2 size={12} /> Undo
                    </button>
                  )}
                </div>

                {canComposerMode ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {REPLY_TEMPLATES.map((t) => (
                        <button key={t.id} onClick={() => setComposerText(t.text)} className="text-[10px] px-2 py-1 rounded-full border border-gray-700 text-gray-400 hover:bg-gray-800">{t.label}</button>
                      ))}
                    </div>
                    <label htmlFor="composer-text" className="sr-only">{composerMode === "Public" ? "Public reply preview text" : "Internal note preview text"}</label>
                    <textarea
                      id="composer-text" value={composerText} onChange={(e) => setComposerText(e.target.value)} rows={3}
                      placeholder={composerMode === "Public" ? "Write a reply preview…" : "Write an internal note preview…"}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Paperclip size={12} className="text-gray-500" />
                        <label htmlFor="composer-attachment" className="sr-only">Attachment metadata (filename only)</label>
                        <input id="composer-attachment" value={composerAttachment} onChange={(e) => setComposerAttachment(e.target.value)} placeholder="Attachment filename (metadata only)" className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white w-56" />
                      </div>
                      {composerMode === "Internal" && (
                        <div className="flex items-center gap-1">
                          <AtSign size={12} className="text-gray-500" />
                          <label htmlFor="composer-mention" className="sr-only">Mention an internal user</label>
                          <select id="composer-mention" value={composerMention} onChange={(e) => setComposerMention(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white">
                            <option value="">Mention teammate…</option>
                            {CRM_TEAM.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                          </select>
                        </div>
                      )}
                      <div className="flex items-center gap-2 ml-auto">
                        <button onClick={() => setComposerText("")} className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800">Discard</button>
                        <button
                          onClick={handleConfirm}
                          disabled={!composerText.trim()}
                          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {composerMode === "Public" ? "Confirm Reply Preview" : "Confirm Internal Note Preview"}
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-500">No provider message was sent — this action updates frontend preview state only.</p>
                  </>
                ) : (
                  <p className="text-xs text-gray-500">You do not have permission to {composerMode === "Public" ? "send reply previews" : "add internal note previews"} on this conversation.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
