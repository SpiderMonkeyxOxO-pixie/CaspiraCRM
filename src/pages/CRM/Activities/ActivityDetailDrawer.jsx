import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import {
  X, Pencil, CheckCircle2, CalendarClock, RefreshCcw, Copy, Ban, RotateCcw,
  Paperclip, AlertTriangle, ShieldAlert, ExternalLink, Clock,
} from "lucide-react";
import {
  completeActivity, rescheduleActivity, cancelActivity, reopenActivity, duplicateActivity,
  createFollowUpActivity, fetchActivityConflicts, CALL_OUTCOMES, MEETING_OUTCOMES,
  effectiveStatus, isDoNotContact, doNotContactReason,
} from "../../../redux/crm/activitiesSlice";
import { findActivity } from "../../../Helpers/mockActivitiesData";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";
import { CONTACT_TIMEZONES } from "../../../Helpers/mockCrmData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { TypeIcon, StatusBadge, PriorityBadge, ReminderIndicator } from "./ActivityBadges";
import { formatDateTime } from "./activityUtils";

const COMPLETED_ROUTE_TYPES = { Lead: "/crm/leads", Contact: "/crm/contacts", Company: "/crm/companies", Deal: "/crm/deals" };

export default function ActivityDetailDrawer({ activity, initialAction, onClose, onEdit, onOpenActivity }) {
  const dispatch = useDispatch();
  const [action, setAction] = useState(initialAction || null); // "complete" | "reschedule" | "cancel" | "followup"
  const conflicts = useSelector((s) => s.activities.conflicts);
  const containerRef = useFocusTrap(true, onClose);

  useEffect(() => {
    if (activity?._id) dispatch(fetchActivityConflicts(activity._id));
  }, [dispatch, activity?._id]);

  if (!activity) return null;
  const status = effectiveStatus(activity);
  const isTerminal = ["Completed", "Cancelled"].includes(activity.status);
  const dnc = isDoNotContact(activity);
  const relatedRoute = COMPLETED_ROUTE_TYPES[activity.relatedRecordType];
  const followUp = activity.followUpActivityId ? findActivity(activity.followUpActivityId) : null;
  const parent = activity.parentActivityId ? findActivity(activity.parentActivityId) : null;
  const activeConflicts = status === "Scheduled" ? conflicts : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={`${activity.type} details`}
        className="relative w-full sm:max-w-md h-full bg-gray-900 border-l border-gray-800 overflow-y-auto p-6 space-y-5 shadow-2xl">
        <div className="flex justify-between items-start">
          <div>
            <span className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide mb-1"><TypeIcon type={activity.type} size={13} /> {activity.type}</span>
            <h2 className="text-lg font-bold leading-snug">{activity.title}</h2>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <StatusBadge activity={activity} status={status} />
              <PriorityBadge priority={activity.priority} />
            </div>
          </div>
          <button onClick={onClose} aria-label="Close details"><X size={20} /></button>
        </div>

        {dnc && (
          <div className="bg-red-900/15 border border-red-800/40 rounded-xl p-3 text-sm text-red-200 flex items-start gap-2">
            <ShieldAlert size={16} className="shrink-0 mt-0.5" />
            <span><strong>Do Not Contact.</strong> {doNotContactReason(activity) || "Communication channels are restricted for this related contact."}</span>
          </div>
        )}

        {activeConflicts.length > 0 && (
          <div className="bg-amber-900/15 border border-amber-800/40 rounded-xl p-3 text-sm text-amber-200 space-y-2">
            <p className="flex items-center gap-2"><AlertTriangle size={15} /><strong>Schedule conflict detected</strong> (frontend preview check, not backend-confirmed)</p>
            {activeConflicts.map((c) => (
              <div key={c._id} className="flex items-center justify-between bg-gray-900/40 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-amber-100">{c.title}</p>
                  <p className="text-[11px] text-amber-300/80">{formatDateTime(c.startAt)}</p>
                </div>
                <button onClick={() => onOpenActivity(c)} className="text-xs text-amber-300 hover:underline">View</button>
              </div>
            ))}
            <button onClick={() => setAction("reschedule")} className="text-xs text-amber-300 hover:underline">Change this activity's time</button>
          </div>
        )}

        <Section title="Ownership">
          <Row label="Owner" value={activity.ownerName || "Unassigned"} />
          <Row label="Team" value={activity.assignedTeam || "—"} />
          {activity.participants?.length > 0 && <Row label="Participants" value={activity.participants.map((p) => p.name).join(", ")} />}
        </Section>

        <Section title="Related record">
          {activity.relatedRecordId ? (
            relatedRoute ? (
              <Link to={`${relatedRoute}/${activity.relatedRecordId}`} className="flex items-center gap-1.5 text-blue-400 hover:underline text-sm">
                {activity.relatedRecordLabel} <ExternalLink size={12} />
              </Link>
            ) : (
              <span className="text-sm text-gray-300">{activity.relatedRecordLabel} <span className="text-gray-500">({activity.relatedRecordType})</span></span>
            )
          ) : <span className="text-sm text-gray-500">None</span>}
        </Section>

        <Section title="Schedule">
          <Row label="Start" value={formatDateTime(activity.startAt)} />
          {activity.endAt && <Row label="End" value={formatDateTime(activity.endAt)} />}
          {activity.dueDate && <Row label="Due" value={formatDateTime(activity.dueDate)} />}
          <Row label="Time Zone" value={activity.timezone} />
          <Row label="Reminder" value={<ReminderIndicator reminder={activity.reminder} />} />
        </Section>

        {activity.description && (
          <Section title="Description"><p className="text-sm text-gray-300 whitespace-pre-wrap">{activity.description}</p></Section>
        )}

        {(activity.outcome || activity.completionNote) && (
          <Section title="Outcome">
            {activity.outcome && <Row label="Outcome" value={activity.outcome} />}
            {activity.completionNote && <p className="text-sm text-gray-300 mt-1">{activity.completionNote}</p>}
          </Section>
        )}

        {activity.cancelReason && (
          <Section title="Cancellation"><p className="text-sm text-red-300">{activity.cancelReason}</p></Section>
        )}

        {activity.attachments?.length > 0 && (
          <Section title="Attachments">
            <ul className="space-y-1">
              {activity.attachments.map((f) => (
                <li key={f._id} className="flex items-center gap-2 text-sm text-blue-300">
                  <Paperclip size={13} />
                  {f.dataUrl ? <a href={f.dataUrl} download={f.name} className="hover:underline">{f.name}</a> : <span>{f.name}</span>}
                  <span className="text-xs text-gray-500">({(f.size / 1024).toFixed(1)} KB)</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {(followUp || parent) && (
          <Section title="Related follow-up">
            {parent && (
              <button onClick={() => onOpenActivity(parent)} className="flex items-center gap-1.5 text-sm text-blue-400 hover:underline"><Clock size={13} /> Follow-up of: {parent.title}</button>
            )}
            {followUp && (
              <button onClick={() => onOpenActivity(followUp)} className="flex items-center gap-1.5 text-sm text-blue-400 hover:underline"><RefreshCcw size={13} /> Follow-up created: {followUp.title}</button>
            )}
          </Section>
        )}

        <Section title="Record information">
          <p className="text-xs text-gray-500">Created {new Date(activity.createdAt).toLocaleString()} by {activity.createdBy}</p>
          <p className="text-xs text-gray-500">Updated {new Date(activity.updatedAt).toLocaleString()} by {activity.updatedBy}</p>
        </Section>

        <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-800">
          {!isTerminal && <button onClick={onEdit} className="flex items-center gap-1.5 text-sm border border-gray-700 hover:bg-gray-800 px-3 py-1.5 rounded-lg"><Pencil size={13} /> Edit</button>}
          {!isTerminal && <button onClick={() => setAction("complete")} className="flex items-center gap-1.5 text-sm border border-emerald-700 text-emerald-400 hover:bg-emerald-900/30 px-3 py-1.5 rounded-lg"><CheckCircle2 size={13} /> Mark Complete</button>}
          {!isTerminal && <button onClick={() => setAction("reschedule")} className="flex items-center gap-1.5 text-sm border border-gray-700 hover:bg-gray-800 px-3 py-1.5 rounded-lg"><CalendarClock size={13} /> Reschedule</button>}
          <button onClick={() => setAction("followup")} className="flex items-center gap-1.5 text-sm border border-gray-700 hover:bg-gray-800 px-3 py-1.5 rounded-lg"><RefreshCcw size={13} /> Add Follow-up</button>
          <button onClick={() => dispatch(duplicateActivity(activity._id))} className="flex items-center gap-1.5 text-sm border border-gray-700 hover:bg-gray-800 px-3 py-1.5 rounded-lg"><Copy size={13} /> Duplicate</button>
          {!isTerminal ? (
            <button onClick={() => setAction("cancel")} className="flex items-center gap-1.5 text-sm border border-red-700 text-red-400 hover:bg-red-900/30 px-3 py-1.5 rounded-lg"><Ban size={13} /> Cancel</button>
          ) : (
            <button onClick={() => dispatch(reopenActivity(activity._id))} className="flex items-center gap-1.5 text-sm border border-amber-700 text-amber-400 hover:bg-amber-900/30 px-3 py-1.5 rounded-lg"><RotateCcw size={13} /> Reopen</button>
          )}
        </div>
      </div>

      {action === "complete" && <MarkCompleteModal activity={activity} onClose={() => setAction(null)} />}
      {action === "reschedule" && <RescheduleModal activity={activity} onClose={() => setAction(null)} />}
      {action === "cancel" && <CancelModal activity={activity} onClose={() => setAction(null)} />}
      {action === "followup" && <QuickFollowUpModal activity={activity} onClose={() => setAction(null)} />}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="border-t border-gray-800 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{title}</h3>
      {children}
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-sm py-0.5">
      <span className="text-gray-400">{label}</span>
      <span className="text-right">{value ?? "—"}</span>
    </div>
  );
}

function MarkCompleteModal({ activity, onClose }) {
  const dispatch = useDispatch();
  const outcomes = activity.type === "Call" ? CALL_OUTCOMES : activity.type === "Meeting" ? MEETING_OUTCOMES : [];
  const requiresOutcome = outcomes.length > 0;
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [needsFollowUp, setNeedsFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpOwner, setFollowUpOwner] = useState(activity.ownerId || "");
  const [error, setError] = useState("");
  const containerRef = useFocusTrap(true, onClose);

  const submit = (e) => {
    e.preventDefault();
    if (requiresOutcome && !outcome) { setError("Select an outcome to complete this activity."); return; }
    if (needsFollowUp && !followUpDate) { setError("Choose a follow-up date."); return; }
    dispatch(completeActivity({
      id: activity._id, outcome: outcome || undefined, completionNote: note,
      followUp: needsFollowUp ? { dueDate: new Date(followUpDate).toISOString(), ownerId: followUpOwner } : undefined,
    }));
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Mark Complete" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-bold">Mark Complete</h3>
        {requiresOutcome && (
          <div>
            <label htmlFor="complete-outcome" className="block text-sm mb-1 text-gray-300">Outcome</label>
            <select id="complete-outcome" autoFocus value={outcome} onChange={(e) => setOutcome(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">Select outcome...</option>
              {outcomes.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        )}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Completion note (optional)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={needsFollowUp} onChange={(e) => setNeedsFollowUp(e.target.checked)} /> Follow-up required
        </label>
        {needsFollowUp && (
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <select value={followUpOwner} onChange={(e) => setFollowUpOwner(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">Owner...</option>
              {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-sm font-medium">Complete{needsFollowUp ? " & Create Follow-up" : ""}</button>
        </div>
      </form>
    </div>
  );
}

function RescheduleModal({ activity, onClose }) {
  const dispatch = useDispatch();
  const toLocal = (iso) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
  const [when, setWhen] = useState(toLocal(activity.startAt));
  const [timezone, setTimezone] = useState(activity.timezone);
  const [reminderEnabled, setReminderEnabled] = useState(!!activity.reminder?.enabled);
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);

  const newStartAt = when ? new Date(when).toISOString() : null;
  const duration = activity.endAt ? new Date(activity.endAt) - new Date(activity.startAt) : 0;
  const newEndAt = newStartAt && duration ? new Date(new Date(newStartAt).getTime() + duration).toISOString() : activity.endAt;

  const submit = (e) => {
    e.preventDefault();
    if (!newStartAt) return;
    dispatch(rescheduleActivity({ id: activity._id, startAt: newStartAt, endAt: newEndAt, timezone, reminder: { enabled: reminderEnabled, minutesBefore: activity.reminder?.minutesBefore || 15 }, reason }));
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Reschedule" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-bold">Reschedule</h3>
        <p className="text-xs text-gray-500">Current: {formatDateTime(activity.startAt)}</p>
        <div>
          <label htmlFor="resched-when" className="block text-sm mb-1 text-gray-300">New Date &amp; Time</label>
          <input id="resched-when" autoFocus type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="resched-tz" className="block text-sm mb-1 text-gray-300">Time Zone</label>
          <select id="resched-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            {CONTACT_TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={reminderEnabled} onChange={(e) => setReminderEnabled(e.target.checked)} /> Keep reminder
        </label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Confirm Reschedule</button>
        </div>
      </form>
    </div>
  );
}

function CancelModal({ activity, onClose }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const submit = (e) => {
    e.preventDefault();
    if (!reason.trim()) return;
    dispatch(cancelActivity({ id: activity._id, reason }));
    onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Cancel Activity" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-bold">Cancel Activity</h3>
        <p className="text-sm text-gray-400">Cancelling <strong className="text-white">{activity.title}</strong> keeps it visible in filters and record timelines — it is not deleted.</p>
        <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Cancellation reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Keep Activity</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-sm font-medium">Confirm Cancel</button>
        </div>
      </form>
    </div>
  );
}

function QuickFollowUpModal({ activity, onClose }) {
  const dispatch = useDispatch();
  const [title, setTitle] = useState(`Follow-up: ${activity.title}`);
  const [dueDate, setDueDate] = useState("");
  const [ownerId, setOwnerId] = useState(activity.ownerId || "");
  const containerRef = useFocusTrap(true, onClose);
  const submit = (e) => {
    e.preventDefault();
    if (!title.trim() || !dueDate) return;
    dispatch(createFollowUpActivity({ id: activity._id, title, dueDate: new Date(dueDate).toISOString(), ownerId }));
    onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Add Follow-up" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-bold">Add Follow-up</h3>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow-up title" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          <option value="">Owner...</option>
          {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Create Follow-up</button>
        </div>
      </form>
    </div>
  );
}
