import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Pencil, UserCog, CheckCircle2, XCircle, StickyNote, PhoneCall,
  CalendarClock, ArrowRightCircle, Archive, RotateCcw, Paperclip, Shield, RefreshCcw,
} from "lucide-react";
import {
  fetchLead, fetchLeadAudit, assignLead, disqualifyLead, addLeadNote, logLeadActivity,
  createLeadTask, updateLeadTask, uploadLeadFile, deleteLeadFile, archiveLead, restoreLead,
  reopenLead, convertLead, updateLead,
} from "../../../redux/crm/leadsSlice";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import LeadFormModal from "./LeadFormModal";

const WORKFLOW = ["New", "Attempted", "Contacted", "Qualified", "Converted"];
const ACTIVITY_ICONS = {
  created: StickyNote, status_change: ArrowRightCircle, note: StickyNote, call: PhoneCall,
  email: StickyNote, meeting: CalendarClock, follow_up_scheduled: CalendarClock,
  follow_up_completed: CheckCircle2, assignment_change: UserCog, file_upload: Paperclip,
  converted: CheckCircle2, archived: Archive, restored: RotateCcw,
};

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function LeadDetail() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const owners = useCrmOwnerOptions(BACKEND_CRM_MODE_ENABLED);
  const navigate = useNavigate();
  const lead = useSelector((s) => s.leads.current);
  const notFound = useSelector((s) => s.leads.currentNotFound);
  const auditLog = useSelector((s) => s.leads.currentAudit);
  const role = useSelector((s) => s.auth.role);

  const [tab, setTab] = useState("overview");
  const [showEdit, setShowEdit] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [showDisqualify, setShowDisqualify] = useState(false);
  const [disqualifyStatus, setDisqualifyStatus] = useState("Unqualified");
  const [disqualifyReason, setDisqualifyReason] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [showReopen, setShowReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [noteText, setNoteText] = useState("");
  const [showLogActivity, setShowLogActivity] = useState(false);
  const [activityType, setActivityType] = useState("call");
  const [activityDescription, setActivityDescription] = useState("");
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpForm, setFollowUpForm] = useState({ title: "", dueDate: "", priority: "Medium" });

  const isSuperAdmin = role === "Super-Admin";
  const canManage = role === "Super-Admin" || role === "Admin";

  useEffect(() => {
    dispatch(fetchLead(id));
  }, [dispatch, id]);

  useEffect(() => {
    if (tab === "audit" && isSuperAdmin) dispatch(fetchLeadAudit(id));
  }, [dispatch, id, tab, isSuperAdmin]);

  if (notFound) {
    return (
      <div className="p-6 text-white max-w-lg">
        <p className="text-lg font-semibold mb-1">Lead not found</p>
        <p className="text-sm text-gray-400 mb-4">
          This lead doesn't exist or is no longer available. Since this environment persists data in memory only,
          a full page reload clears anything created during the session.
        </p>
        <Link to="/crm/leads" className="text-blue-400 hover:underline text-sm">Back to Leads</Link>
      </div>
    );
  }
  if (!lead) return <div className="p-6 text-gray-400">Loading lead...</div>;

  const currentStepIndex = WORKFLOW.indexOf(lead.status);
  const isTerminal = ["Converted", "Unqualified", "Duplicate", "Spam"].includes(lead.status);

  const advanceStatus = () => {
    const next = WORKFLOW[currentStepIndex + 1];
    if (next && next !== "Converted") dispatch(updateLead({ id: lead._id, changes: { status: next } }));
  };

  const submitAssign = (e) => {
    e.preventDefault();
    if (!assignTo) return;
    dispatch(assignLead({ id: lead._id, ownerId: assignTo }));
    setShowAssign(false);
  };

  const submitDisqualify = (e) => {
    e.preventDefault();
    if (!disqualifyReason.trim()) return;
    dispatch(disqualifyLead({ id: lead._id, status: disqualifyStatus, reason: disqualifyReason }));
    setShowDisqualify(false);
    setDisqualifyReason("");
  };

  const submitArchive = (e) => {
    e.preventDefault();
    if (!archiveReason.trim()) return;
    dispatch(archiveLead({ id: lead._id, reason: archiveReason }));
    setShowArchive(false);
    setArchiveReason("");
  };

  const submitReopen = (e) => {
    e.preventDefault();
    if (!reopenReason.trim()) return;
    dispatch(reopenLead({ id: lead._id, reason: reopenReason }));
    setShowReopen(false);
    setReopenReason("");
  };

  const submitNote = (e) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    dispatch(addLeadNote({ id: lead._id, message: noteText }));
    setNoteText("");
  };

  const submitActivity = (e) => {
    e.preventDefault();
    if (!activityDescription.trim()) return;
    dispatch(logLeadActivity({ id: lead._id, type: activityType, description: activityDescription }));
    setShowLogActivity(false);
    setActivityDescription("");
  };

  const submitFollowUp = (e) => {
    e.preventDefault();
    if (!followUpForm.title.trim() || !followUpForm.dueDate) return;
    dispatch(createLeadTask({ id: lead._id, task: { ...followUpForm, assignee: lead.ownerName } }));
    setShowFollowUp(false);
    setFollowUpForm({ title: "", dueDate: "", priority: "Medium" });
  };

  const toggleTask = (taskId, completed) => {
    dispatch(updateLeadTask({ id: lead._id, taskId, changes: { completed: !completed } }));
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    dispatch(uploadLeadFile({ id: lead._id, file: { name: file.name, size: file.size, type: file.type, dataUrl } }));
    e.target.value = "";
  };

  const handleConvert = async () => {
    const result = await dispatch(convertLead(lead._id)).unwrap().catch(() => null);
    if (result?.company?._id) navigate(`/crm/companies/${result.company._id}`);
  };

  const sortedActivity = [...(lead.activity || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
  const overdueTasks = (lead.tasks || []).filter((t) => !t.completed && new Date(t.dueDate) < new Date());

  return (
    <div className="p-6 text-white max-w-5xl">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/crm/dashboard" className="hover:text-gray-300">CRM</Link> /{" "}
        <Link to="/crm/leads" className="hover:text-gray-300">Leads</Link> / <span className="text-gray-300">{lead.name}</span>
      </nav>

      <Link to="/crm/leads" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4 w-fit">
        <ArrowLeft size={16} /> Back to Leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold">{lead.name}{lead.archived && <span className="ml-2 text-sm text-gray-500 font-normal">(Archived)</span>}</h1>
          <p className="text-sm text-gray-400">{lead.companyName} · {lead.email} · {lead.phone}</p>
        </div>
        {canManage && !lead.archived && (
          <div className="flex gap-2 flex-wrap" data-tour="lead-actions">
            <button onClick={() => setShowEdit(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Pencil size={14} /> Edit</button>
            <button onClick={() => setShowAssign(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><UserCog size={14} /> Assign</button>
            {!isTerminal && currentStepIndex < WORKFLOW.length - 2 && (
              <button onClick={advanceStatus} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm"><ArrowRightCircle size={14} /> Move to {WORKFLOW[currentStepIndex + 1]}</button>
            )}
            {lead.status === "Qualified" && (
              <button onClick={handleConvert} className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 px-3 py-2 rounded-lg text-sm"><CheckCircle2 size={14} /> Convert</button>
            )}
            {!isTerminal && (
              <button onClick={() => setShowDisqualify(true)} className="flex items-center gap-2 border border-red-700 text-red-400 hover:bg-red-900/30 px-3 py-2 rounded-lg text-sm"><XCircle size={14} /> Disqualify</button>
            )}
            <button onClick={() => setShowArchive(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Archive size={14} /> Archive</button>
            {lead.status === "Converted" && isSuperAdmin && (
              <button onClick={() => setShowReopen(true)} className="flex items-center gap-2 border border-amber-700 text-amber-400 hover:bg-amber-900/30 px-3 py-2 rounded-lg text-sm"><RefreshCcw size={14} /> Reopen</button>
            )}
          </div>
        )}
        {lead.archived && isSuperAdmin && (
          <button onClick={() => dispatch(restoreLead(lead._id))} className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 px-3 py-2 rounded-lg text-sm"><RotateCcw size={14} /> Restore</button>
        )}
      </div>

      {lead.archiveReason && lead.archived && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 mb-4 text-sm text-gray-300">
          <strong>Archived:</strong> {lead.archiveReason}
        </div>
      )}

      <div className="flex items-center gap-2 mb-6 flex-wrap" data-tour="lead-workflow">
        {WORKFLOW.map((step, i) => (
          <div key={step} className="flex items-center gap-2">
            <span className={`px-3 py-1.5 rounded-full text-xs font-medium border ${i <= currentStepIndex || lead.status === "Converted" && step === "Converted" ? "bg-blue-600/20 text-blue-300 border-blue-500/40" : "bg-gray-800/60 text-gray-500 border-gray-700"}`}>{step}</span>
            {i < WORKFLOW.length - 1 && <span className="text-gray-700">→</span>}
          </div>
        ))}
        {isTerminal && lead.status !== "Converted" && (
          <span className="px-3 py-1.5 rounded-full text-xs font-medium border bg-red-600/20 text-red-300 border-red-500/40 ml-2">{lead.status}</span>
        )}
      </div>

      {lead.convertedTo && (
        <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-4 mb-6 text-sm">
          Converted — <Link className="text-emerald-300 underline" to={`/crm/companies/${lead.convertedTo.companyId}`}>view company</Link>
          {" · "}<Link className="text-emerald-300 underline" to={`/crm/deals/${lead.convertedTo.dealId}`}>view deal</Link>
        </div>
      )}
      {lead.disqualifyReason && !lead.convertedTo && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-4 mb-6 text-sm text-red-200">
          <strong>Reason:</strong> {lead.disqualifyReason}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800 mb-4 overflow-x-auto" data-tour="lead-tabs">
        {["overview", "activity", "tasks", "files", ...(isSuperAdmin ? ["audit"] : [])].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm capitalize whitespace-nowrap ${tab === t ? "text-blue-400 border-b-2 border-blue-400 font-medium" : "text-gray-400 hover:text-gray-200"}`}>
            {t === "audit" ? <span className="flex items-center gap-1"><Shield size={14} /> Audit</span> : t}
            {t === "tasks" && overdueTasks.length > 0 && <span className="ml-1 text-red-400">({overdueTasks.length})</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
            <h2 className="font-semibold mb-3">Overview</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-gray-400">Job Title</dt><dd>{lead.jobTitle || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Country</dt><dd>{lead.country || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Preferred Contact</dt><dd>{lead.preferredContactChannel}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Source</dt><dd>{lead.source}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Interested In</dt><dd>{lead.interestedProduct || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Priority</dt><dd>{lead.priority}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Lead Score</dt><dd>{lead.score}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Est. Value</dt><dd>{lead.currency} {lead.estimatedValue?.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Owner</dt><dd>{lead.ownerName || "Unassigned"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Department</dt><dd>{lead.department || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Next Follow-up</dt><dd>{lead.nextFollowUp ? new Date(lead.nextFollowUp).toLocaleDateString() : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Consent</dt><dd className={lead.consent ? "text-emerald-400" : "text-gray-500"}>{lead.consent ? "Given" : "Not given"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Created</dt><dd>{new Date(lead.createdAt).toLocaleString()} by {lead.createdBy}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-400">Updated</dt><dd>{new Date(lead.updatedAt).toLocaleString()} by {lead.updatedBy}</dd></div>
            </dl>
            {lead.tags?.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mt-3 pt-3 border-t border-gray-800">
                {lead.tags.map((t) => <span key={t} className="px-2 py-1 rounded-full text-xs bg-gray-800 text-gray-300">{t}</span>)}
              </div>
            )}
          </div>

          <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
            <h2 className="font-semibold mb-3">Add Note</h2>
            <form onSubmit={submitNote} className="space-y-2 mb-4">
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} placeholder="Add a note about this lead..." className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
              <button type="submit" className="bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm">Add Note</button>
            </form>
            <div className="flex gap-2 pt-3 border-t border-gray-800" data-tour="lead-log">
              <button onClick={() => setShowLogActivity(true)} className="flex items-center gap-2 text-sm border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg"><PhoneCall size={14} /> Log Activity</button>
              <button onClick={() => setShowFollowUp(true)} className="flex items-center gap-2 text-sm border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg"><CalendarClock size={14} /> Schedule Follow-up</button>
            </div>
          </div>
        </div>
      )}

      {tab === "activity" && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
          <h2 className="font-semibold mb-4">Activity Timeline</h2>
          {sortedActivity.length === 0 ? (
            <p className="text-sm text-gray-500">No activity yet.</p>
          ) : (
            <ul className="space-y-4">
              {sortedActivity.map((event) => {
                const Icon = ACTIVITY_ICONS[event.type] || StickyNote;
                return (
                  <li key={event._id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center shrink-0"><Icon size={14} className="text-blue-400" /></div>
                    <div>
                      <p className="text-sm">{event.description}</p>
                      <p className="text-xs text-gray-500">{event.actor} · {new Date(event.at).toLocaleString()}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === "tasks" && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold">Tasks &amp; Follow-ups</h2>
            <button onClick={() => setShowFollowUp(true)} className="text-sm text-blue-400 hover:underline">+ New Task</button>
          </div>
          {(lead.tasks || []).length === 0 ? (
            <p className="text-sm text-gray-500">No tasks yet.</p>
          ) : (
            <ul className="space-y-2">
              {lead.tasks.map((task) => {
                const overdue = !task.completed && new Date(task.dueDate) < new Date();
                return (
                  <li key={task._id} className="flex items-center justify-between bg-gray-800/40 rounded-lg p-3 text-sm">
                    <label className="flex items-center gap-3">
                      <input type="checkbox" checked={task.completed} onChange={() => toggleTask(task._id, task.completed)} />
                      <span className={task.completed ? "line-through text-gray-500" : ""}>{task.title}</span>
                    </label>
                    <span className={`text-xs ${overdue ? "text-red-400 font-medium" : "text-gray-400"}`}>
                      {task.assignee} · Due {new Date(task.dueDate).toLocaleDateString()} {overdue && "(Overdue)"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === "files" && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold">Files</h2>
            <label className="text-sm text-blue-400 hover:underline cursor-pointer">
              + Upload File
              <input type="file" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
          {(lead.files || []).length === 0 ? (
            <p className="text-sm text-gray-500">No files uploaded yet.</p>
          ) : (
            <ul className="space-y-2">
              {lead.files.map((file) => (
                <li key={file._id} className="flex items-center justify-between bg-gray-800/40 rounded-lg p-3 text-sm">
                  <div>
                    <a href={file.dataUrl} download={file.name} className="text-blue-300 hover:underline">{file.name}</a>
                    <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB · uploaded by {file.uploadedBy} on {new Date(file.uploadedAt).toLocaleDateString()}</p>
                  </div>
                  <button onClick={() => dispatch(deleteLeadFile({ id: lead._id, fileId: file._id }))} className="text-gray-500 hover:text-red-400 text-xs">Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "audit" && isSuperAdmin && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><Shield size={16} /> Audit History</h2>
          {auditLog.length === 0 ? (
            <p className="text-sm text-gray-500">No audit events yet.</p>
          ) : (
            <ul className="space-y-3">
              {[...auditLog].reverse().map((e) => (
                <li key={e._id} className="text-sm border-b border-gray-800 pb-3">
                  <p><span className="font-medium capitalize">{e.action.replace("_", " ")}</span> by {e.actor}</p>
                  {e.reason && <p className="text-xs text-amber-300">Reason: {e.reason}</p>}
                  <p className="text-xs text-gray-500">{new Date(e.at).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showEdit && <LeadFormModal lead={lead} onClose={() => setShowEdit(false)} />}

      {showAssign && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowAssign(false)}>
          <form onSubmit={submitAssign} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">Assign Lead</h2>
            <select required value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">Select owner...</option>
              {owners.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAssign(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Assign</button>
            </div>
          </form>
        </div>
      )}

      {showDisqualify && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowDisqualify(false)}>
          <form onSubmit={submitDisqualify} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">Disqualify Lead</h2>
            <select value={disqualifyStatus} onChange={(e) => setDisqualifyStatus(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              {["Unqualified", "Duplicate", "Spam"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <textarea required value={disqualifyReason} onChange={(e) => setDisqualifyReason(e.target.value)} rows={3} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowDisqualify(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-sm font-medium">Confirm</button>
            </div>
          </form>
        </div>
      )}

      {showArchive && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowArchive(false)}>
          <form onSubmit={submitArchive} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">Archive Lead</h2>
            <textarea required value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} rows={3} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowArchive(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-sm font-medium">Archive</button>
            </div>
          </form>
        </div>
      )}

      {showReopen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowReopen(false)}>
          <form onSubmit={submitReopen} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">Reopen Converted Lead</h2>
            <p className="text-xs text-gray-500">This sets the lead back to Qualified and unlinks the conversion record from this lead (the created company/contact/deal are not deleted).</p>
            <textarea required value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={3} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowReopen(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-sm font-medium">Reopen</button>
            </div>
          </form>
        </div>
      )}

      {showLogActivity && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowLogActivity(false)}>
          <form onSubmit={submitActivity} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">Log Activity</h2>
            <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              {["call", "email", "meeting"].map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
            <textarea required value={activityDescription} onChange={(e) => setActivityDescription(e.target.value)} rows={3} placeholder="What happened?" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowLogActivity(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Log Activity</button>
            </div>
          </form>
        </div>
      )}

      {showFollowUp && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowFollowUp(false)}>
          <form onSubmit={submitFollowUp} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold">Schedule Follow-up</h2>
            <input required value={followUpForm.title} onChange={(e) => setFollowUpForm((f) => ({ ...f, title: e.target.value }))} placeholder="Task title" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <input required type="date" value={followUpForm.dueDate} onChange={(e) => setFollowUpForm((f) => ({ ...f, dueDate: e.target.value }))} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              <select value={followUpForm.priority} onChange={(e) => setFollowUpForm((f) => ({ ...f, priority: e.target.value }))} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {["Low", "Medium", "High"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowFollowUp(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Schedule</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
