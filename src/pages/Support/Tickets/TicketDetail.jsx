import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ArrowUpCircle, CheckCircle2, Send, Lock } from "lucide-react";
import {
  fetchTicket,
  updateTicketStatus,
  assignTicket,
  addPublicReply,
  addPrivateNote,
  escalateTicket,
  resolveTicket,
  submitCsat,
  TICKET_STATUSES,
} from "../../../redux/support/ticketsSlice";
import { getSlaStatus, SLA_LABELS, SLA_COLORS } from "../slaUtils";

const DEPARTMENTS = ["Support", "Billing", "Technical"];

export default function TicketDetail() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const ticket = useSelector((s) => s.tickets.current);
  const currentUser = useSelector((s) => s.auth.data);

  const [tab, setTab] = useState("replies"); // "replies" | "notes"
  const [message, setMessage] = useState("");
  const [showAssign, setShowAssign] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [department, setDepartment] = useState("Support");
  const [showEscalate, setShowEscalate] = useState(false);
  const [escalateTo, setEscalateTo] = useState("Technical");
  const [escalateReason, setEscalateReason] = useState("");
  const [showResolve, setShowResolve] = useState(false);
  const [resolutionSummary, setResolutionSummary] = useState("");

  useEffect(() => {
    dispatch(fetchTicket(id));
  }, [dispatch, id]);

  if (!ticket) return <div className="p-6 text-gray-400">Loading ticket...</div>;

  const isResolved = ["Resolved", "Closed"].includes(ticket.status);
  const responseSla = getSlaStatus(ticket.slaResponseDeadline, !!ticket.firstRespondedAt);
  const resolutionSla = getSlaStatus(ticket.slaResolutionDeadline, isResolved);

  const submitMessage = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    const author = currentUser?.name || currentUser?.username || "Agent";
    if (tab === "replies") await dispatch(addPublicReply({ id: ticket._id, message, author }));
    else await dispatch(addPrivateNote({ id: ticket._id, message, author }));
    setMessage("");
  };

  const submitAssign = (e) => {
    e.preventDefault();
    dispatch(assignTicket({ id: ticket._id, assignedAgent: agentName, department }));
    setShowAssign(false);
  };

  const submitEscalate = (e) => {
    e.preventDefault();
    if (!escalateReason.trim()) return;
    dispatch(escalateTicket({ id: ticket._id, to: escalateTo, reason: escalateReason }));
    setShowEscalate(false);
    setEscalateReason("");
  };

  const submitResolve = (e) => {
    e.preventDefault();
    if (!resolutionSummary.trim()) return;
    dispatch(resolveTicket({ id: ticket._id, summary: resolutionSummary }));
    setShowResolve(false);
  };

  const nextStatus = ticket.status === "Waiting for Customer"
    ? "In Progress"
    : TICKET_STATUSES[TICKET_STATUSES.indexOf(ticket.status) + 1];

  const advanceStatus = () => {
    if (nextStatus && nextStatus !== "Resolved") dispatch(updateTicketStatus({ id: ticket._id, status: nextStatus }));
  };

  return (
    <div className="p-6 text-white max-w-4xl">
      <Link to="/support/tickets" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4 w-fit">
        <ArrowLeft size={16} /> Back to Tickets
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold">{ticket.ticketNumber} · {ticket.subject}</h1>
          <p className="text-sm text-gray-400 mt-1">{ticket.companyName} · {ticket.contactName}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!isResolved && nextStatus && nextStatus !== "Resolved" && (
            <button onClick={advanceStatus} className="bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm">
              Move to {nextStatus}
            </button>
          )}
          {!isResolved && (
            <>
              <button onClick={() => setShowAssign(true)} className="border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">Assign</button>
              <button onClick={() => setShowEscalate(true)} className="flex items-center gap-1 border border-amber-700 text-amber-400 hover:bg-amber-900/30 px-3 py-2 rounded-lg text-sm">
                <ArrowUpCircle size={16} /> Escalate
              </button>
              <button onClick={() => setShowResolve(true)} className="flex items-center gap-1 bg-emerald-700 hover:bg-emerald-800 px-3 py-2 rounded-lg text-sm">
                <CheckCircle2 size={16} /> Resolve
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap mb-6">
        <span className="px-3 py-1.5 rounded-full text-xs font-medium border bg-blue-500/15 text-blue-300 border-blue-500/30">{ticket.status}</span>
        <span className={`px-3 py-1.5 rounded-full text-xs font-medium border ${SLA_COLORS[responseSla]}`}>Response: {SLA_LABELS[responseSla]}</span>
        <span className={`px-3 py-1.5 rounded-full text-xs font-medium border ${SLA_COLORS[resolutionSla]}`}>Resolution: {SLA_LABELS[resolutionSla]}</span>
      </div>

      {ticket.resolution && (
        <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-4 mb-6 text-sm">
          <strong>Resolution:</strong> {ticket.resolution.summary}
        </div>
      )}

      {ticket.status === "Resolved" && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 mb-6 flex items-center justify-between">
          <span className="text-sm text-gray-300">How did we do? (customer satisfaction)</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => dispatch(submitCsat({ id: ticket._id, score: n }))} className="text-lg hover:scale-110 transition-transform">
                {n <= (ticket.csatScore || 0) ? "★" : "☆"}
              </button>
            ))}
          </div>
        </div>
      )}
      {ticket.status === "Closed" && ticket.csatScore && (
        <p className="text-sm text-gray-400 mb-6">Customer satisfaction: {ticket.csatScore}/5 ★</p>
      )}

      <div className="grid md:grid-cols-3 gap-6 mb-6">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5 md:col-span-1">
          <h2 className="font-semibold mb-3">Details</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-gray-400">Priority</dt><dd>{ticket.priority}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-400">Category</dt><dd>{ticket.category}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-400">Source</dt><dd>{ticket.source}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-400">Department</dt><dd>{ticket.department}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-400">Agent</dt><dd>{ticket.assignedAgent || "Unassigned"}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-400">Company</dt><dd><Link className="text-blue-400 hover:underline" to={`/crm/companies/${ticket.companyId}`}>{ticket.companyName}</Link></dd></div>
          </dl>
          {ticket.escalations?.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-800">
              <h3 className="text-xs uppercase text-gray-400 mb-2">Escalation History</h3>
              <ul className="space-y-1 text-xs text-gray-300">
                {ticket.escalations.map((e, i) => (
                  <li key={i}>{e.from} → {e.to}: {e.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="md:col-span-2 bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex border-b border-gray-800">
            <button onClick={() => setTab("replies")} className={`flex-1 px-4 py-3 text-sm flex items-center justify-center gap-2 ${tab === "replies" ? "text-blue-400 border-b-2 border-blue-400" : "text-gray-400"}`}>
              <Send size={14} /> Public Replies ({ticket.publicReplies?.length || 0})
            </button>
            <button onClick={() => setTab("notes")} className={`flex-1 px-4 py-3 text-sm flex items-center justify-center gap-2 ${tab === "notes" ? "text-blue-400 border-b-2 border-blue-400" : "text-gray-400"}`}>
              <Lock size={14} /> Private Notes ({ticket.privateNotes?.length || 0})
            </button>
          </div>
          <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
            {(tab === "replies" ? ticket.publicReplies : ticket.privateNotes)?.length === 0 ? (
              <p className="text-sm text-gray-500">No {tab === "replies" ? "replies" : "notes"} yet.</p>
            ) : (
              (tab === "replies" ? ticket.publicReplies : ticket.privateNotes).map((m, i) => (
                <div key={i} className={`rounded-lg p-3 text-sm ${tab === "notes" ? "bg-amber-900/10 border border-amber-800/30" : "bg-gray-800/50"}`}>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>{m.author}</span>
                    <span>{new Date(m.at).toLocaleString()}</span>
                  </div>
                  <p>{m.message}</p>
                </div>
              ))
            )}
          </div>
          {!isResolved && (
            <form onSubmit={submitMessage} className="p-4 border-t border-gray-800 flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={tab === "replies" ? "Reply to customer..." : "Add an internal note..."}
                className="flex-1 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm"
              />
              <button type="submit" className="bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm">Send</button>
            </form>
          )}
        </div>
      </div>

      {showAssign && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowAssign(false)}>
          <form onSubmit={submitAssign} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">Assign Ticket</h2>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Agent Name</label>
              <input required value={agentName} onChange={(e) => setAgentName(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Department</label>
              <select value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAssign(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Assign</button>
            </div>
          </form>
        </div>
      )}

      {showEscalate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowEscalate(false)}>
          <form onSubmit={submitEscalate} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">Escalate Ticket</h2>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Escalate To</label>
              <select value={escalateTo} onChange={(e) => setEscalateTo(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Reason *</label>
              <textarea required value={escalateReason} onChange={(e) => setEscalateReason(e.target.value)} rows={3} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowEscalate(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-sm font-medium">Escalate</button>
            </div>
          </form>
        </div>
      )}

      {showResolve && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowResolve(false)}>
          <form onSubmit={submitResolve} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">Resolve Ticket</h2>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Resolution Summary *</label>
              <textarea required value={resolutionSummary} onChange={(e) => setResolutionSummary(e.target.value)} rows={3} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowResolve(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-sm font-medium">Resolve</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
