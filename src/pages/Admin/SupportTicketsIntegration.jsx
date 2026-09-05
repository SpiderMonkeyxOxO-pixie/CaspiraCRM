import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Link } from "react-router-dom";
import {
  Search, LayoutGrid, Table as TableIcon, RefreshCw, UserPlus, StickyNote,
  ArrowUpRight, AlertTriangle, ExternalLink, X,
} from "lucide-react";
import {
  fetchOrganizations, fetchSupportTicketPreviews, fetchSupportSyncConflicts, resolveSupportSyncConflict,
  assignTicketPreview, changeTicketStatusPreview, closeTicketPreview, addInternalNotePreviewToTicket,
  retryTicketSyncPreview, linkCustomerToTicket, fetchTicketIdentityMatch,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import {
  isSystemOwner, canViewSupportTickets, canProcessSupportTickets, canAssignSupportTickets,
  canCloseSupportTickets, canViewSupportIdentity, canLinkSupportIdentity, canRetrySupportSync,
  canResolveSupportConflicts,
} from "./supportCommunicationConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { SupportTicketStatus, SupportSyncConflictResolutions } from "../../Helpers/mockSupportCommunicationData";
import { CRM_TEAM } from "../../Helpers/mockUsersData";
import ActionPreviewModal from "./ActionPreviewModal";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const SLA_COLORS = {
  "On Track": "text-emerald-400", "At Risk": "text-amber-400", Breached: "text-red-400",
  Paused: "text-gray-400", Completed: "text-gray-400", "Not Applicable": "text-gray-500", "Insufficient Data": "text-gray-500",
};
const PRIORITY_COLORS = { Urgent: "text-red-400", High: "text-amber-400", Normal: "text-blue-400", Low: "text-gray-400" };

const PAGE_SIZE = 10;

export default function SupportTicketsIntegration() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const {
    organizations, supportTicketPreviews, supportSyncConflicts, currentIdentityMatch, loading, error,
  } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [view, setView] = useState("table");
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [slaFilter, setSlaFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [drawerTicketId, setDrawerTicketId] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [bulkCloseModal, setBulkCloseModal] = useState(false);
  const [bulkCloseReason, setBulkCloseReason] = useState("");
  const [showConflicts, setShowConflicts] = useState(false);

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  const refresh = () => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchSupportTicketPreviews(filters));
    dispatch(fetchSupportSyncConflicts({}));
  };

  useEffect(refresh, [dispatch, owner, selectedOrgId]);

  const canView = canViewSupportTickets(role);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return supportTicketPreviews.filter((t) => {
      if (providerFilter && t.providerKey !== providerFilter) return false;
      if (statusFilter && t.canonicalStatus !== statusFilter) return false;
      if (priorityFilter && t.canonicalPriority !== priorityFilter) return false;
      if (assigneeFilter === "unassigned" && t.assigneeId) return false;
      if (assigneeFilter && assigneeFilter !== "unassigned" && t.assigneeId !== assigneeFilter) return false;
      if (slaFilter && t.slaState !== slaFilter) return false;
      if (term) {
        const haystack = `${t.ticketNumber} ${t.subject} ${t.customerName} ${t.companyName}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [supportTicketPreviews, providerFilter, statusFilter, priorityFilter, assigneeFilter, slaFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const providerOptions = useMemo(() => {
    const keys = new Set(supportTicketPreviews.map((t) => t.providerKey));
    return [...keys].map(findProvider).filter(Boolean);
  }, [supportTicketPreviews]);

  const byStatus = useMemo(() => {
    const groups = {};
    SupportTicketStatus.forEach((s) => { groups[s] = []; });
    filtered.forEach((t) => { (groups[t.canonicalStatus] || (groups[t.canonicalStatus] = [])).push(t); });
    return groups;
  }, [filtered]);

  const drawerTicket = useMemo(() => supportTicketPreviews.find((t) => t.linkedTicketId === drawerTicketId) || null, [supportTicketPreviews, drawerTicketId]);
  const openConflictsForDrawer = useMemo(
    () => (drawerTicket ? supportSyncConflicts.filter((c) => c.ticketId === drawerTicket.linkedTicketId && c.resolutionState === "Open") : []),
    [drawerTicket, supportSyncConflicts]
  );

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openDrawer = (ticket) => {
    setDrawerTicketId(ticket.linkedTicketId);
    setNoteText("");
    if (canViewSupportIdentity(role) && !ticket.contactId) dispatch(fetchTicketIdentityMatch(ticket.linkedTicketId));
  };

  const handleAssign = async (ticket, agentId) => {
    await dispatch(assignTicketPreview({ ticketId: ticket.linkedTicketId, agentId }));
    refresh();
  };

  const handleStatusChange = async (ticket, canonicalStatus) => {
    await dispatch(changeTicketStatusPreview({ ticketId: ticket.linkedTicketId, canonicalStatus }));
    refresh();
  };

  const handleRetrySync = async (ticket) => {
    await dispatch(retryTicketSyncPreview(ticket.linkedTicketId));
    refresh();
  };

  const handleAddNote = async () => {
    if (!drawerTicket || !noteText.trim()) return;
    await dispatch(addInternalNotePreviewToTicket({ ticketId: drawerTicket.linkedTicketId, message: noteText.trim() }));
    setNoteText("");
    refresh();
  };

  const handleLinkCandidate = async (candidate) => {
    if (!drawerTicket) return;
    await dispatch(linkCustomerToTicket({ ticketId: drawerTicket.linkedTicketId, contactId: candidate.contactId, contactName: candidate.name }));
    refresh();
  };

  const handleResolveConflict = async (conflictId, resolution) => {
    await dispatch(resolveSupportSyncConflict({ conflictId, resolution, note: "Reviewed via Tickets integration route." }));
    refresh();
  };

  const handleBulkClose = async () => {
    if (!bulkCloseReason.trim()) return;
    for (const id of selectedIds) {
      const ticket = supportTicketPreviews.find((t) => t.linkedTicketId === id);
      if (ticket) await dispatch(closeTicketPreview({ ticketId: ticket.linkedTicketId, reason: bulkCloseReason.trim() }));
    }
    setBulkCloseModal(false);
    setBulkCloseReason("");
    setSelectedIds(new Set());
    refresh();
  };

  if (!canView) {
    return <div className="p-4 md:p-6"><p className="text-sm text-red-400">You do not have permission to view Support Tickets.</p></div>;
  }

  const openConflictCount = supportSyncConflicts.filter((c) => c.resolutionState === "Open").length;

  return (
    <div className="p-4 md:p-6 space-y-4 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <button onClick={() => navigate("/admin/integrations/support-communication")} className="hover:text-gray-300">Administration</button>
        <span>/</span>
        <button onClick={() => navigate("/admin/integrations/support-communication")} className="hover:text-gray-300">Support &amp; Communication</button>
        <span>/</span>
        <span className="text-gray-300">Tickets</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Support Tickets</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <div className="flex items-center gap-2">
          {owner && (
            <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <button
            onClick={() => setShowConflicts((v) => !v)}
            className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border ${openConflictCount > 0 ? "border-amber-500/40 text-amber-300 bg-amber-500/10" : "border-gray-700 text-gray-300"}`}
          >
            <AlertTriangle size={14} /> Sync Conflicts {openConflictCount > 0 ? `(${openConflictCount})` : ""}
          </button>
          <div className="flex items-center border border-gray-700 rounded-lg overflow-hidden">
            <button onClick={() => setView("table")} aria-pressed={view === "table"} className={`p-2 ${view === "table" ? "bg-blue-500/20 text-blue-300" : "text-gray-400"}`} aria-label="Table view"><TableIcon size={16} /></button>
            <button onClick={() => setView("board")} aria-pressed={view === "board"} className={`p-2 ${view === "board" ? "bg-blue-500/20 text-blue-300" : "text-gray-400"}`} aria-label="Board view"><LayoutGrid size={16} /></button>
          </div>
        </div>
      </div>

      {showConflicts && (
        <section className="bg-gray-900/40 border border-amber-500/20 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Synchronization Conflicts</h2>
          {supportSyncConflicts.length === 0 ? (
            <p className="text-xs text-gray-500">No synchronization conflicts.</p>
          ) : (
            <ul className="space-y-2">
              {supportSyncConflicts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 text-sm bg-gray-800/40 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-gray-200">{c.conflictType}</span>
                    <span className="block text-[11px] text-gray-500">Provider: {c.providerValue} · CRM: {c.crmValue}</span>
                  </div>
                  {c.resolutionState === "Open" && canResolveSupportConflicts(role) ? (
                    <div className="flex items-center gap-1.5">
                      {SupportSyncConflictResolutions.slice(0, 3).map((r) => (
                        <button key={r} onClick={() => handleResolveConflict(c.id, r)} className="text-[11px] px-2 py-1 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800">{r}</button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-emerald-300">{c.resolutionState}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-500" aria-hidden="true" />
          <label htmlFor="tickets-search" className="sr-only">Search tickets</label>
          <input id="tickets-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ticket, customer, company…" className="bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-2 py-2 text-sm text-white w-64" />
        </div>
        <label htmlFor="tickets-provider" className="sr-only">Provider</label>
        <select id="tickets-provider" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white">
          <option value="">All providers</option>
          {providerOptions.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
        <label htmlFor="tickets-status" className="sr-only">Status</label>
        <select id="tickets-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white">
          <option value="">All statuses</option>
          {SupportTicketStatus.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label htmlFor="tickets-priority" className="sr-only">Priority</label>
        <select id="tickets-priority" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white">
          <option value="">All priorities</option>
          {Object.keys(PRIORITY_COLORS).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label htmlFor="tickets-assignee" className="sr-only">Assignee</label>
        <select id="tickets-assignee" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white">
          <option value="">All assignees</option>
          <option value="unassigned">Unassigned</option>
          {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <label htmlFor="tickets-sla" className="sr-only">SLA state</label>
        <select id="tickets-sla" value={slaFilter} onChange={(e) => setSlaFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white">
          <option value="">All SLA states</option>
          {Object.keys(SLA_COLORS).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && supportTicketPreviews.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">Loading ticket previews…</div>}

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 text-sm">
          <span className="text-blue-200">{selectedIds.size} selected</span>
          {canCloseSupportTickets(role) && (
            <button onClick={() => setBulkCloseModal(true)} className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10">Bulk Close</button>
          )}
          <button onClick={() => setSelectedIds(new Set())} className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800">Clear</button>
        </div>
      )}

      {view === "table" ? (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-800">
                <th className="p-3"><span className="sr-only">Select</span></th>
                <th className="p-3">Ticket</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Company</th>
                <th className="p-3">Provider</th>
                <th className="p-3">Channel</th>
                <th className="p-3">Status</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Queue</th>
                <th className="p-3">Assignee</th>
                <th className="p-3">SLA</th>
                <th className="p-3">Updated</th>
                <th className="p-3">Sync</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={14} className="p-6 text-center text-xs text-gray-500">No tickets match the current filters.</td></tr>
              ) : (
                pageRows.map((t) => (
                  <tr key={t.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                    <td className="p-3"><input type="checkbox" checked={selectedIds.has(t.linkedTicketId)} onChange={() => toggleSelect(t.linkedTicketId)} aria-label={`Select ${t.ticketNumber}`} /></td>
                    <td className="p-3">
                      <button onClick={() => openDrawer(t)} className="text-left text-blue-300 hover:underline">{t.ticketNumber}</button>
                      <span className="block text-[11px] text-gray-500 max-w-[160px] truncate">{t.subject}</span>
                    </td>
                    <td className="p-3 text-gray-300">{t.customerName}</td>
                    <td className="p-3 text-gray-300">{t.companyName}</td>
                    <td className="p-3 text-gray-300">{findProvider(t.providerKey)?.name || t.providerKey}</td>
                    <td className="p-3 text-gray-400">{t.channel}</td>
                    <td className="p-3">
                      {canProcessSupportTickets(role) ? (
                        <select value={t.canonicalStatus} onChange={(e) => handleStatusChange(t, e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-[11px] text-white">
                          {SupportTicketStatus.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : <span className="text-gray-300">{t.canonicalStatus}</span>}
                    </td>
                    <td className={`p-3 ${PRIORITY_COLORS[t.canonicalPriority] || "text-gray-300"}`}>{t.canonicalPriority}</td>
                    <td className="p-3 text-gray-400">{t.queueName}</td>
                    <td className="p-3">
                      {canAssignSupportTickets(role) ? (
                        <select value={t.assigneeId || ""} onChange={(e) => handleAssign(t, e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-[11px] text-white">
                          <option value="">Unassigned</option>
                          {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      ) : <span className="text-gray-300">{t.assigneeName}</span>}
                    </td>
                    <td className={`p-3 font-medium ${SLA_COLORS[t.slaState] || "text-gray-400"}`}>{t.slaState}</td>
                    <td className="p-3 text-gray-500 text-[11px]">{formatDateTime(t.updatedAt)}</td>
                    <td className="p-3">
                      <span className={`text-[11px] ${t.syncState === "Conflict" ? "text-amber-300" : "text-emerald-300"}`}>{t.syncState}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        {t.syncState === "Conflict" ? (
                          <button onClick={() => setShowConflicts(true)} title="Review Sync Conflict" className="p-1.5 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10"><AlertTriangle size={13} /></button>
                        ) : canRetrySupportSync(role) && (
                          <button onClick={() => handleRetrySync(t)} title="Retry Preview Sync" className="p-1.5 rounded border border-gray-700 text-gray-300 hover:bg-gray-800"><RefreshCw size={13} /></button>
                        )}
                        <Link to={`/support/tickets/${t.linkedTicketId}`} title="Open Authorized CRM Record" className="p-1.5 rounded border border-gray-700 text-gray-300 hover:bg-gray-800"><ExternalLink size={13} /></Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-3 py-2 text-xs text-gray-500 border-t border-gray-800">
            <span>{filtered.length} ticket(s)</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded border border-gray-700 disabled:opacity-30">Previous</button>
              <span>Page {page} of {pageCount}</span>
              <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page === pageCount} className="px-2 py-1 rounded border border-gray-700 disabled:opacity-30">Next</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${SupportTicketStatus.length}, minmax(200px, 1fr))`, overflowX: "auto" }}>
          {SupportTicketStatus.map((status) => (
            <div key={status} className="bg-gray-900/40 border border-gray-800 rounded-xl p-2 min-w-[200px]">
              <h3 className="text-xs font-semibold text-gray-300 mb-2 px-1">{status} <span className="text-gray-500">({(byStatus[status] || []).length})</span></h3>
              <div className="space-y-2">
                {(byStatus[status] || []).map((t) => (
                  <button key={t.id} onClick={() => openDrawer(t)} className="w-full text-left bg-gray-800/50 border border-gray-800 rounded-lg p-2 hover:border-gray-700">
                    <div className="text-xs font-medium text-white truncate">{t.ticketNumber}</div>
                    <div className="text-[11px] text-gray-400 truncate">{t.customerName}</div>
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-[10px] ${PRIORITY_COLORS[t.canonicalPriority]}`}>{t.canonicalPriority}</span>
                      <span className={`text-[10px] ${SLA_COLORS[t.slaState]}`}>{t.slaState}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {drawerTicket && (
        <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerTicketId(null)} />
          <div role="dialog" aria-modal="true" aria-label="Ticket detail" className="relative bg-[#12141c] border-l border-gray-800 w-full max-w-md h-full overflow-y-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">{drawerTicket.ticketNumber}</h2>
              <button onClick={() => setDrawerTicketId(null)} aria-label="Close"><X size={18} className="text-gray-400 hover:text-white" /></button>
            </div>
            <p className="text-sm text-gray-300">{drawerTicket.subject}</p>
            <div className="text-xs text-gray-400 space-y-1">
              <p>Customer: {drawerTicket.customerName} {drawerTicket.companyName ? `— ${drawerTicket.companyName}` : ""}</p>
              <p>Provider: {findProvider(drawerTicket.providerKey)?.name || drawerTicket.providerKey} · Reference: {drawerTicket.providerTicketId}</p>
              <p>Queue: {drawerTicket.queueName} · Assignee: {drawerTicket.assigneeName}</p>
              <p className={SLA_COLORS[drawerTicket.slaState]}>SLA: {drawerTicket.slaState}</p>
            </div>

            {openConflictsForDrawer.length > 0 && (
              <div className="border border-amber-500/30 rounded-lg p-2 text-xs text-amber-300">
                {openConflictsForDrawer.length} open synchronization conflict(s) — <button onClick={() => setShowConflicts(true)} className="underline">review</button>
              </div>
            )}

            {canViewSupportIdentity(role) && !drawerTicket.contactId && (
              <div className="border border-gray-800 rounded-lg p-3">
                <h3 className="text-xs font-semibold text-white mb-2">Customer Identity Match</h3>
                {!currentIdentityMatch ? (
                  <p className="text-xs text-gray-500">Checking for a matching Contact…</p>
                ) : (
                  <div className="space-y-2">
                    <span className="inline-block text-[11px] px-2 py-0.5 rounded-full border bg-gray-800 text-gray-300 border-gray-700">{currentIdentityMatch.state}</span>
                    {currentIdentityMatch.candidateRecords.map((cand) => (
                      <div key={cand.contactId} className="flex items-center justify-between text-xs text-gray-300">
                        <span>{cand.name}</span>
                        {canLinkSupportIdentity(role) && (
                          <button onClick={() => handleLinkCandidate(cand)} className="text-[11px] px-2 py-1 rounded border border-gray-700 hover:bg-gray-800">Link Customer</button>
                        )}
                      </div>
                    ))}
                    <p className="text-[11px] text-gray-500">Never automatically merged.</p>
                  </div>
                )}
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-white mb-1 flex items-center gap-1.5"><StickyNote size={12} /> Add Internal Note Preview</h3>
              {canProcessSupportTickets(role) ? (
                <>
                  <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white" placeholder="Internal note preview…" />
                  <button onClick={handleAddNote} disabled={!noteText.trim()} className="mt-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white">Add Internal Note Preview</button>
                </>
              ) : <p className="text-xs text-gray-500">You do not have permission to add notes.</p>}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-gray-800">
              {canAssignSupportTickets(role) && (
                <button onClick={() => handleAssign(drawerTicket, drawerTicket.assigneeId ? "" : CRM_TEAM[0].id)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800"><UserPlus size={12} /> Assign Preview</button>
              )}
              <Link to={`/support/tickets/${drawerTicket.linkedTicketId}`} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 ml-auto"><ArrowUpRight size={12} /> Open Authorized CRM Record</Link>
            </div>
          </div>
        </div>
      )}

      {bulkCloseModal && (
        <ActionPreviewModal
          title="Bulk Close Tickets"
          actionLabel={`Close ${selectedIds.size} ticket(s)`}
          details={[{ label: "Tickets affected", value: String(selectedIds.size) }]}
          requiresReason
          reason={bulkCloseReason}
          onReasonChange={setBulkCloseReason}
          reasonLabel="Reason for bulk closing"
          confirmLabel="Confirm Bulk Close"
          onConfirm={handleBulkClose}
          onCancel={() => setBulkCloseModal(false)}
        />
      )}
    </div>
  );
}
