import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { X, AlertTriangle, Paperclip } from "lucide-react";
import {
  createActivity, updateActivity,
  ACTIVITY_PRIORITIES, RELATED_RECORD_TYPES, CALL_DIRECTIONS, EMAIL_DIRECTIONS, NOTE_VISIBILITIES,
} from "../../../redux/crm/activitiesSlice";
import { fetchLeads } from "../../../redux/crm/leadsSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { CRM_DEPARTMENTS } from "../../../Helpers/mockUsersData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";
import { BACKEND_CRM_SALES_MODE_ENABLED } from "../../../Helpers/backendCrmClient";
import { CONTACT_TIMEZONES } from "../../../Helpers/mockCrmData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { TypeIcon } from "./ActivityBadges";

const CREATABLE_TYPES = ["Call", "Email", "Meeting", "Follow-up", "Task", "Note", "Customer Visit"];
const TYPE_DESCRIPTIONS = {
  Call: "Schedule or log a phone call",
  Email: "Log an email that was sent or received",
  Meeting: "Schedule or log a meeting",
  "Follow-up": "Create a follow-up reminder",
  Task: "Create a task",
  Note: "Log an internal note",
  "Customer Visit": "Schedule or log an on-site visit",
};

function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInputValue(value) {
  return value ? new Date(value).toISOString() : null;
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function emptyForm(type, rawPrefill) {
  // Default params only kick in for `undefined`, not `null` — and callers
  // pass `null` explicitly (e.g. the plain "Create Activity" button, which
  // has no prefill), so normalize here rather than trusting every call site.
  const prefill = rawPrefill || {};
  return {
    type: type || "",
    title: prefill.title || "",
    description: "",
    priority: "Medium",
    ownerId: prefill.ownerId || "",
    assignedTeam: "",
    participantIds: [],
    relatedRecordType: prefill.relatedRecordType || "",
    relatedRecordId: prefill.relatedRecordId || "",
    date: prefill.date || "",
    startTime: prefill.startTime || "",
    endTime: "",
    dueDate: prefill.date || "",
    timezone: "America/New_York",
    reminderEnabled: false,
    reminderMinutes: 15,
    // call
    phone: "", callDirection: "Outbound", expectedDurationMinutes: 15, callPurpose: "",
    // email
    emailDirection: "Outgoing", subject: "",
    // meeting / visit
    location: "", agenda: "",
    // note
    visibility: "Team",
  };
}

function formFromActivity(activity) {
  const start = activity.startAt ? new Date(activity.startAt) : null;
  return {
    type: activity.type,
    title: activity.title || "",
    description: activity.description || "",
    priority: activity.priority || "Medium",
    ownerId: activity.ownerId || "",
    assignedTeam: activity.assignedTeam || "",
    participantIds: (activity.participants || []).map((p) => p.id),
    relatedRecordType: activity.relatedRecordType || "",
    relatedRecordId: activity.relatedRecordId || "",
    date: start ? start.toISOString().slice(0, 10) : "",
    startTime: start ? toLocalInputValue(activity.startAt).slice(11) : "",
    endTime: activity.endAt ? toLocalInputValue(activity.endAt).slice(11) : "",
    dueDate: activity.dueDate ? activity.dueDate.slice(0, 10) : "",
    timezone: activity.timezone || "America/New_York",
    reminderEnabled: !!activity.reminder?.enabled,
    reminderMinutes: activity.reminder?.minutesBefore || 15,
    phone: activity.phone || "", callDirection: activity.callDirection || "Outbound",
    expectedDurationMinutes: activity.expectedDurationMinutes || 15, callPurpose: activity.callPurpose || "",
    emailDirection: activity.emailDirection || "Outgoing", subject: activity.subject || "",
    location: activity.location || "", agenda: activity.agenda || "",
    visibility: activity.visibility || "Team",
  };
}

export default function ActivityFormModal({ activity, prefill, onClose, onSaved }) {
  const crmTeam = useCrmOwnerOptions(BACKEND_CRM_SALES_MODE_ENABLED);
  const dispatch = useDispatch();
  const isEdit = !!activity;
  const [step, setStep] = useState(isEdit || prefill?.type ? "form" : "pickType");
  const [form, setForm] = useState(() => (isEdit ? formFromActivity(activity) : emptyForm(prefill?.type, prefill)));
  const initialFormRef = useRef(form);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [dncOverride, setDncOverride] = useState(false);

  const leads = useSelector((s) => s.leads.items);
  const contacts = useSelector((s) => s.contacts.items);
  const companies = useSelector((s) => s.companies.items);
  const deals = useSelector((s) => s.deals.items);

  useEffect(() => {
    dispatch(fetchLeads({ pageSize: 1000 }));
    dispatch(fetchContacts({ pageSize: 1000 }));
    dispatch(fetchCompanies());
    dispatch(fetchDeals());
  }, [dispatch]);

  const isDirty = step === "form" && JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
  const requestClose = () => (isDirty ? setConfirmClose(true) : onClose());
  const containerRef = useFocusTrap(true, requestClose);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const setBool = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.checked }));

  const relatedOptions = useMemo(() => {
    if (form.relatedRecordType === "Lead") return leads.map((l) => ({ value: l._id, label: l.name }));
    if (form.relatedRecordType === "Contact") return contacts.map((c) => ({ value: c._id, label: c.name }));
    if (form.relatedRecordType === "Company") return companies.map((c) => ({ value: c._id, label: c.name }));
    if (form.relatedRecordType === "Deal") return deals.map((d) => ({ value: d._id, label: d.name }));
    return [];
  }, [form.relatedRecordType, leads, contacts, companies, deals]);

  const relatedContact = form.relatedRecordType === "Contact" ? contacts.find((c) => c._id === form.relatedRecordId) : null;
  const isCommunicationType = ["Call", "Email", "Meeting", "Customer Visit"].includes(form.type);
  const dncBlocked = relatedContact?.doNotContact && isCommunicationType && !dncOverride;

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    const withDataUrls = await Promise.all(files.map(async (f) => ({ name: f.name, size: f.size, type: f.type, dataUrl: await fileToDataUrl(f) })));
    setAttachments((prev) => [...prev, ...withDataUrls]);
  };

  const buildPayload = () => {
    const startAt = form.date ? fromLocalInputValue(`${form.date}T${form.startTime || "09:00"}`) : (form.dueDate ? new Date(form.dueDate).toISOString() : null);
    const endAt = form.date && form.endTime ? fromLocalInputValue(`${form.date}T${form.endTime}`) : null;
    const owner = crmTeam.find((u) => u.id === form.ownerId);
    return {
      type: form.type,
      title: form.title.trim(),
      description: form.description.trim(),
      priority: form.priority,
      ownerId: form.ownerId || null,
      ownerName: owner?.name || null,
      assignedTeam: form.assignedTeam || owner?.department || null,
      participants: form.participantIds.map((pid) => {
        const member = crmTeam.find((u) => u.id === pid);
        return member ? { type: "internal", id: member.id, name: member.name } : null;
      }).filter(Boolean),
      relatedRecordType: form.relatedRecordType || null,
      relatedRecordId: form.relatedRecordId || null,
      startAt,
      endAt,
      dueDate: ["Follow-up", "Task"].includes(form.type) && form.dueDate ? new Date(form.dueDate).toISOString() : (form.type === "Note" ? null : startAt),
      timezone: form.timezone,
      reminder: { enabled: form.reminderEnabled, minutesBefore: Number(form.reminderMinutes) || 15 },
      attachments,
      phone: form.type === "Call" ? form.phone.trim() : undefined,
      callDirection: form.type === "Call" ? form.callDirection : undefined,
      expectedDurationMinutes: form.type === "Call" ? Number(form.expectedDurationMinutes) : undefined,
      callPurpose: form.type === "Call" ? form.callPurpose.trim() : undefined,
      emailDirection: form.type === "Email" ? form.emailDirection : undefined,
      subject: form.type === "Email" ? form.subject.trim() : undefined,
      location: ["Meeting", "Customer Visit"].includes(form.type) ? form.location.trim() : undefined,
      agenda: ["Meeting", "Customer Visit"].includes(form.type) ? form.agenda.trim() : undefined,
      visibility: form.type === "Note" ? form.visibility : undefined,
      status: form.type === "Note" ? "Completed" : (isEdit ? undefined : "Scheduled"),
    };
  };

  const submit = async (e) => {
    e.preventDefault();
    if (dncBlocked) return;
    setSaving(true);
    setErrors({});
    const payload = buildPayload();

    if (isEdit) {
      const result = await dispatch(updateActivity({ id: activity._id, changes: payload }));
      setSaving(false);
      if (updateActivity.fulfilled.match(result)) {
        onSaved?.(result.payload.activity);
        onClose();
      } else {
        setErrors(result.payload?.errors || {});
      }
      return;
    }

    const result = await dispatch(createActivity(payload));
    setSaving(false);
    if (createActivity.fulfilled.match(result)) {
      onSaved?.(result.payload);
      onClose();
    } else if (result.payload?.errors) {
      setErrors(result.payload.errors);
    }
  };

  const submitLabel = isEdit
    ? "Save Changes"
    : form.type === "Call"
      ? (form.date && new Date(`${form.date}T${form.startTime || "00:00"}`) < new Date() ? "Log Call" : "Schedule Call")
      : form.type === "Email" ? "Log Email"
        : form.type === "Note" ? "Log Note"
          : `Create ${form.type || "Activity"}`;

  if (step === "pickType") {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div role="dialog" aria-modal="true" aria-label="Choose activity type" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold">Create Activity</h2>
            <button onClick={onClose} aria-label="Close"><X size={20} /></button>
          </div>
          <p className="text-sm text-gray-400">Choose what you'd like to log or schedule.</p>
          <div className="grid grid-cols-2 gap-3">
            {CREATABLE_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => { setForm(emptyForm(t, prefill)); setStep("form"); }}
                className="flex flex-col items-start gap-1 p-3 rounded-xl border border-gray-800 hover:border-gray-600 hover:bg-gray-800/40 text-left"
              >
                <span className="flex items-center gap-2 font-medium"><TypeIcon type={t} size={16} /> {t}</span>
                <span className="text-xs text-gray-500">{TYPE_DESCRIPTIONS[t]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={requestClose}>
      <form ref={containerRef} onSubmit={submit} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        aria-label={isEdit ? `Edit ${activity.type}` : `New ${form.type}`}
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2"><TypeIcon type={form.type} size={18} /> {isEdit ? `Edit ${activity.type}` : `New ${form.type}`}</h2>
          <button type="button" onClick={requestClose} aria-label="Close"><X size={20} /></button>
        </div>

        {relatedContact?.doNotContact && isCommunicationType && (
          <div className="bg-red-900/15 border border-red-800/40 rounded-xl p-3 text-sm text-red-200 flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              <p><strong>{relatedContact.name} is marked Do Not Contact.</strong> {relatedContact.doNotContactReason || "Outbound communication is restricted for this contact."}</p>
              <label className="flex items-center gap-2 mt-2 text-xs">
                <input type="checkbox" checked={dncOverride} onChange={(e) => setDncOverride(e.target.checked)} />
                I understand and want to proceed anyway (frontend override only)
              </label>
            </div>
          </div>
        )}

        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Details</legend>
          <div>
            <label htmlFor="act-title" className="block text-sm mb-1 text-gray-300">Title</label>
            <input id="act-title" value={form.title} onChange={set("title")} aria-invalid={!!errors.title}
              className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.title ? "border-red-600" : "border-gray-700"}`} />
            {errors.title && <p className="text-xs text-red-400 mt-1">{errors.title}</p>}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="act-related-type" className="block text-sm mb-1 text-gray-300">Related Record Type</label>
              <select id="act-related-type" value={form.relatedRecordType} onChange={(e) => setForm((f) => ({ ...f, relatedRecordType: e.target.value, relatedRecordId: "" }))} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">None</option>
                {RELATED_RECORD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="act-related-id" className="block text-sm mb-1 text-gray-300">Related Record</label>
              <select id="act-related-id" value={form.relatedRecordId} onChange={set("relatedRecordId")} disabled={!form.relatedRecordType} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm disabled:opacity-50">
                <option value="">Select...</option>
                {relatedOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="act-owner" className="block text-sm mb-1 text-gray-300">Owner</label>
              <select id="act-owner" value={form.ownerId} onChange={set("ownerId")} aria-invalid={!!errors.ownerId} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Unassigned</option>
                {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select>
              {errors.ownerId && <p className="text-xs text-red-400 mt-1">{errors.ownerId}</p>}
            </div>
            <div>
              <label htmlFor="act-team" className="block text-sm mb-1 text-gray-300">Team</label>
              <select id="act-team" value={form.assignedTeam} onChange={set("assignedTeam")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">—</option>
                {CRM_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="act-priority" className="block text-sm mb-1 text-gray-300">Priority</label>
              <select id="act-priority" value={form.priority} onChange={set("priority")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {ACTIVITY_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="act-participants" className="block text-sm mb-1 text-gray-300">Participants (internal)</label>
            <select id="act-participants" multiple value={form.participantIds} onChange={(e) => setForm((f) => ({ ...f, participantIds: Array.from(e.target.selectedOptions, (o) => o.value) }))}
              className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm h-24">
              {crmTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </fieldset>

        {["Follow-up", "Task"].includes(form.type) ? (
          <fieldset className="space-y-4 pt-4 border-t border-gray-800">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Schedule</legend>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="act-due" className="block text-sm mb-1 text-gray-300">Due Date</label>
                <input id="act-due" type="date" value={form.dueDate} onChange={set("dueDate")} aria-invalid={!!errors.dueDate} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                {errors.dueDate && <p className="text-xs text-red-400 mt-1">{errors.dueDate}</p>}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-300 mt-6">
                <input type="checkbox" checked={form.reminderEnabled} onChange={setBool("reminderEnabled")} /> Set reminder
              </label>
            </div>
          </fieldset>
        ) : form.type !== "Note" ? (
          <fieldset className="space-y-4 pt-4 border-t border-gray-800">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Schedule</legend>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="act-date" className="block text-sm mb-1 text-gray-300">Date</label>
                <input id="act-date" type="date" value={form.date} onChange={set("date")} aria-invalid={!!errors.startAt} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                {errors.startAt && <p className="text-xs text-red-400 mt-1">{errors.startAt}</p>}
              </div>
              <div>
                <label htmlFor="act-start" className="block text-sm mb-1 text-gray-300">Start Time</label>
                <input id="act-start" type="time" value={form.startTime} onChange={set("startTime")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="act-end" className="block text-sm mb-1 text-gray-300">End Time</label>
                <input id="act-end" type="time" value={form.endTime} onChange={set("endTime")} aria-invalid={!!errors.endAt} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
                {errors.endAt && <p className="text-xs text-red-400 mt-1">{errors.endAt}</p>}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="act-timezone" className="block text-sm mb-1 text-gray-300">Time Zone</label>
                <select id="act-timezone" value={form.timezone} onChange={set("timezone")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {CONTACT_TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={form.reminderEnabled} onChange={setBool("reminderEnabled")} /> Reminder
                </label>
                {form.reminderEnabled && (
                  <select value={form.reminderMinutes} onChange={set("reminderMinutes")} className="bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-2 text-sm">
                    {[5, 15, 30, 60].map((m) => <option key={m} value={m}>{m} min before</option>)}
                  </select>
                )}
              </div>
            </div>
          </fieldset>
        ) : null}

        {form.type === "Call" && (
          <fieldset className="space-y-4 pt-4 border-t border-gray-800">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Call details</legend>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="act-phone" className="block text-sm mb-1 text-gray-300">Phone Number</label>
                <input id="act-phone" value={form.phone} onChange={set("phone")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="act-call-direction" className="block text-sm mb-1 text-gray-300">Call Direction</label>
                <select id="act-call-direction" value={form.callDirection} onChange={set("callDirection")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {CALL_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="act-call-duration" className="block text-sm mb-1 text-gray-300">Expected Duration (min)</label>
                <input id="act-call-duration" type="number" min="1" value={form.expectedDurationMinutes} onChange={set("expectedDurationMinutes")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="act-call-purpose" className="block text-sm mb-1 text-gray-300">Call Purpose</label>
                <input id="act-call-purpose" value={form.callPurpose} onChange={set("callPurpose")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <p className="text-[11px] text-gray-500">This logs or schedules a call record — no telephony integration is connected, so no call is actually placed.</p>
          </fieldset>
        )}

        {form.type === "Email" && (
          <fieldset className="space-y-4 pt-4 border-t border-gray-800">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Email details</legend>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="act-email-direction" className="block text-sm mb-1 text-gray-300">Direction</label>
                <select id="act-email-direction" value={form.emailDirection} onChange={set("emailDirection")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {EMAIL_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="act-subject" className="block text-sm mb-1 text-gray-300">Subject</label>
                <input id="act-subject" value={form.subject} onChange={set("subject")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <p className="text-[11px] text-gray-500">This logs an email as a CRM activity — no email is actually sent.</p>
          </fieldset>
        )}

        {["Meeting", "Customer Visit"].includes(form.type) && (
          <fieldset className="space-y-4 pt-4 border-t border-gray-800">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">{form.type === "Meeting" ? "Meeting details" : "Visit details"}</legend>
            <div>
              <label htmlFor="act-location" className="block text-sm mb-1 text-gray-300">{form.type === "Meeting" ? "Location or Meeting Link" : "Location"}</label>
              <input id="act-location" value={form.location} onChange={set("location")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="act-agenda" className="block text-sm mb-1 text-gray-300">Agenda</label>
              <textarea id="act-agenda" value={form.agenda} onChange={set("agenda")} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
            {form.type === "Meeting" && <p className="text-[11px] text-gray-500">No external calendar is connected — this schedule exists only in this CRM preview.</p>}
          </fieldset>
        )}

        {form.type === "Note" && (
          <fieldset className="space-y-4 pt-4 border-t border-gray-800">
            <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Note</legend>
            <div>
              <label htmlFor="act-visibility" className="block text-sm mb-1 text-gray-300">Visibility</label>
              <select id="act-visibility" value={form.visibility} onChange={set("visibility")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {NOTE_VISIBILITIES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <p className="text-[11px] text-gray-500">Notes are logged immediately as completed activity records.</p>
          </fieldset>
        )}

        <fieldset className="space-y-2 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Description</legend>
          <label htmlFor="act-description" className="sr-only">Description</label>
          <textarea id="act-description" value={form.description} onChange={set("description")} rows={form.type === "Note" ? 4 : 2} placeholder={form.type === "Note" ? "Note content" : "Description (optional)"} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        </fieldset>

        {!BACKEND_CRM_SALES_MODE_ENABLED && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Attachments</legend>
          <label className="flex items-center gap-2 text-sm text-blue-400 hover:underline cursor-pointer w-fit">
            <Paperclip size={14} /> Add files
            <input type="file" multiple className="hidden" onChange={handleFiles} />
          </label>
          {attachments.length > 0 && (
            <ul className="text-xs text-gray-400 space-y-1">
              {attachments.map((f, i) => <li key={i}>{f.name} · {(f.size / 1024).toFixed(1)} KB</li>)}
            </ul>
          )}
        </fieldset>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <button type="button" onClick={requestClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={saving || dncBlocked} title={dncBlocked ? "This contact is marked Do Not Contact" : undefined} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">
            {saving ? "Saving..." : submitLabel}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 -mt-2">
          Preview only — saved to this session's in-memory frontend state. Persistence will be replaced by the backend service adapter in a later phase.
        </p>
      </form>

      {confirmClose && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold">Discard unsaved changes?</h3>
            <p className="text-sm text-gray-400">You have unsaved changes to this activity. Closing now will discard them.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmClose(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Keep Editing</button>
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-sm font-medium">Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
