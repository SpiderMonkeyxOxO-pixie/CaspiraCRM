import { useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { X, AlertTriangle } from "lucide-react";
import { createContact, updateContact, clearContactDuplicates } from "../../../redux/crm/contactsSlice";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";
import {
  CONTACT_RELATIONSHIP_TYPES,
  CONTACT_LIFECYCLE_STAGES,
  CONTACT_SOURCES,
} from "../../../Helpers/mockCrmData";
import useFocusTrap from "../../../hooks/useFocusTrap";

const CONTACT_CHANNELS = ["Email", "Phone", "SMS"];
const CONTACT_LANGUAGES = ["English", "Spanish", "French", "German", "Mandarin", "Arabic"];
const CONTACT_DECISION_ROLES = ["Decision Maker", "Influencer", "Champion", "End User", "Gatekeeper", "Budget Holder"];
const CONTACT_BUSINESS_DEPARTMENTS = ["Executive", "Operations", "Finance", "IT", "Sales", "Marketing", "Procurement", "HR"];

const emptyForm = {
  firstName: "",
  lastName: "",
  companyName: "",
  jobTitle: "",
  businessDepartment: "",
  decisionMakingRole: "",
  email: "",
  phone: "",
  country: "",
  timezone: "",
  preferredLanguage: "English",
  preferredChannel: "Email",
  relationshipType: "Prospect",
  lifecycleStage: "New",
  ownerId: "",
  source: "Website",
  tags: "",
  nextFollowUp: "",
  emailAllowed: true,
  phoneAllowed: true,
  smsAllowed: false,
  marketingAllowed: true,
  doNotContact: false,
  notes: "",
};

function formFromContact(contact) {
  return {
    firstName: contact.firstName || "",
    lastName: contact.lastName || "",
    companyName: contact.companyName || "",
    jobTitle: contact.jobTitle || "",
    businessDepartment: contact.businessDepartment || "",
    decisionMakingRole: contact.decisionMakingRole || "",
    email: contact.email || "",
    phone: contact.phone || "",
    country: contact.country || "",
    timezone: contact.timezone || "",
    preferredLanguage: contact.preferredLanguage || "English",
    preferredChannel: contact.preferredChannel || "Email",
    relationshipType: contact.relationshipType || "Prospect",
    lifecycleStage: contact.lifecycleStage || "New",
    ownerId: contact.ownerId || "",
    source: contact.source || "Website",
    tags: (contact.tags || []).join(", "),
    nextFollowUp: contact.nextFollowUp ? contact.nextFollowUp.slice(0, 10) : "",
    emailAllowed: contact.emailAllowed !== false,
    phoneAllowed: contact.phoneAllowed !== false,
    smsAllowed: !!contact.smsAllowed,
    marketingAllowed: contact.marketingAllowed !== false,
    doNotContact: !!contact.doNotContact,
    notes: "",
  };
}

// Shared by "Add Contact" (ContactsList) and "Edit" (ContactDetail) so both
// entry points use identical fields and validation.
export default function ContactFormModal({ contact, onClose, onSaved }) {
  const dispatch = useDispatch();
  const duplicates = useSelector((s) => s.contacts.duplicates);
  const isEdit = !!contact;

  const [form, setForm] = useState(() => (isEdit ? formFromContact(contact) : emptyForm));
  const initialFormRef = useRef(form);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialFormRef.current);

  const requestClose = () => {
    if (isDirty) setConfirmClose(true);
    else onClose();
  };

  const containerRef = useFocusTrap(true, requestClose);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const setBool = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.checked }));

  const doNotContactConflict = form.doNotContact && (form.emailAllowed || form.phoneAllowed || form.smsAllowed || form.marketingAllowed);

  const buildPayload = (withOverride = false) => ({
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    companyName: form.companyName.trim(),
    jobTitle: form.jobTitle.trim(),
    businessDepartment: form.businessDepartment || undefined,
    decisionMakingRole: form.decisionMakingRole || undefined,
    email: form.email.trim().toLowerCase(),
    phone: form.phone.trim(),
    country: form.country.trim(),
    timezone: form.timezone || undefined,
    preferredLanguage: form.preferredLanguage,
    preferredChannel: form.preferredChannel,
    relationshipType: form.relationshipType,
    lifecycleStage: form.lifecycleStage,
    ownerId: form.ownerId || undefined,
    source: form.source,
    tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    nextFollowUp: form.nextFollowUp ? new Date(form.nextFollowUp).toISOString() : null,
    // Do Not Contact always wins over individually-checked channels — the
    // backend layer would reject the conflict anyway, so resolve it here too
    // rather than making the user untangle a 400 after submitting.
    emailAllowed: form.doNotContact ? false : form.emailAllowed,
    phoneAllowed: form.doNotContact ? false : form.phoneAllowed,
    smsAllowed: form.doNotContact ? false : form.smsAllowed,
    marketingAllowed: form.doNotContact ? false : form.marketingAllowed,
    doNotContact: form.doNotContact,
    notes: form.notes,
    ...(withOverride ? { duplicateOverride: true, overrideReason } : {}),
  });

  const submit = async (e, withOverride = false) => {
    e?.preventDefault();
    setSaving(true);
    setErrors({});
    const payload = buildPayload(withOverride);

    if (isEdit) {
      const result = await dispatch(updateContact({ id: contact._id, changes: payload }));
      setSaving(false);
      if (updateContact.fulfilled.match(result)) {
        setSavedMessage("Contact updated in preview");
        initialFormRef.current = form;
        onSaved?.(result.payload);
        setTimeout(() => onClose(), 1100);
      } else {
        setErrors(result.payload?.errors || {});
      }
      return;
    }

    const result = await dispatch(createContact(payload));
    setSaving(false);
    if (createContact.fulfilled.match(result)) {
      onSaved?.(result.payload);
      onClose();
    } else if (result.payload?.errors) {
      setErrors(result.payload.errors);
    }
    // 409 duplicates are surfaced via state.contacts.duplicates and rendered
    // below — the form intentionally stays open so nothing is lost.
  };

  const cancelDuplicateFlow = () => {
    dispatch(clearContactDuplicates());
    setOverrideReason("");
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={requestClose}>
      <form
        ref={containerRef}
        onSubmit={(e) => submit(e, false)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit Contact" : "New Contact"}
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">{isEdit ? "Edit Contact" : "New Contact"}</h2>
          <button type="button" onClick={requestClose} aria-label="Close"><X size={20} /></button>
        </div>

        {savedMessage && (
          <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg px-3 py-2 text-sm text-emerald-300">
            {savedMessage} — this update is stored in the frontend preview session and will be replaced by the backend service adapter later.
          </div>
        )}

        {duplicates.length > 0 && (
          <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-200">This looks like it might already exist</p>
                <p className="text-xs text-amber-300/80">Review the match below before creating a new record.</p>
              </div>
            </div>
            <ul className="space-y-2">
              {duplicates.map(({ contact: dup, reasons }) => (
                <li key={dup._id} className="bg-gray-800/60 rounded-lg p-3 text-sm flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{dup.name} {dup.companyName ? `· ${dup.companyName}` : ""}</p>
                    <p className="text-xs text-gray-400">Matched on: {reasons.join(", ")} · Lifecycle: {dup.lifecycleStage}</p>
                  </div>
                  <a href={`/crm/contacts/${dup._id}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline text-xs whitespace-nowrap">
                    View Existing Contact →
                  </a>
                </li>
              ))}
            </ul>
            <div>
              <label className="block text-xs mb-1 text-amber-200">Reason to continue anyway *</label>
              <input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Explain why this is a genuinely different contact"
                className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancelDuplicateFlow} className="px-3 py-1.5 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button
                type="button"
                disabled={!overrideReason.trim()}
                onClick={(e) => submit(e, true)}
                className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-40 text-sm font-medium"
              >
                Continue Anyway
              </button>
            </div>
          </div>
        )}

        {/* Basic information */}
        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Basic information</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="contact-first-name" className="block text-sm mb-1 text-gray-300">First Name</label>
              <input id="contact-first-name" value={form.firstName} onChange={set("firstName")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="contact-last-name" className="block text-sm mb-1 text-gray-300">Last Name</label>
              <input id="contact-last-name" value={form.lastName} onChange={set("lastName")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          {errors.name && <p className="text-xs text-red-400">{errors.name}</p>}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="contact-company" className="block text-sm mb-1 text-gray-300">Company</label>
              <input id="contact-company" value={form.companyName} onChange={set("companyName")} placeholder="Leave blank if no company" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="contact-title" className="block text-sm mb-1 text-gray-300">Job Title</label>
              <input id="contact-title" value={form.jobTitle} onChange={set("jobTitle")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="contact-department" className="block text-sm mb-1 text-gray-300">Business Department</label>
              <select id="contact-department" value={form.businessDepartment} onChange={set("businessDepartment")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">—</option>
                {CONTACT_BUSINESS_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="contact-decision-role" className="block text-sm mb-1 text-gray-300">Decision-Making Role</label>
              <select id="contact-decision-role" value={form.decisionMakingRole} onChange={set("decisionMakingRole")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">—</option>
                {CONTACT_DECISION_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        </fieldset>

        {/* Contact information */}
        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Contact information</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="contact-email" className="block text-sm mb-1 text-gray-300">Email</label>
              <input id="contact-email" type="email" value={form.email} onChange={set("email")}
                aria-invalid={!!errors.email} aria-describedby={errors.email ? "contact-email-error" : undefined}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.email ? "border-red-600" : "border-gray-700"}`} />
              {errors.email && <p id="contact-email-error" className="text-xs text-red-400 mt-1">{errors.email}</p>}
            </div>
            <div>
              <label htmlFor="contact-phone" className="block text-sm mb-1 text-gray-300">Phone</label>
              <input id="contact-phone" value={form.phone} onChange={set("phone")}
                aria-invalid={!!errors.phone}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.phone ? "border-red-600" : "border-gray-700"}`} />
              {errors.phone && <p className="text-xs text-red-400 mt-1">{errors.phone}</p>}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="contact-country" className="block text-sm mb-1 text-gray-300">Country</label>
              <input id="contact-country" value={form.country} onChange={set("country")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="contact-timezone" className="block text-sm mb-1 text-gray-300">Time Zone</label>
              <input id="contact-timezone" value={form.timezone} onChange={set("timezone")} placeholder="e.g. America/New_York" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="contact-language" className="block text-sm mb-1 text-gray-300">Preferred Language</label>
              <select id="contact-language" value={form.preferredLanguage} onChange={set("preferredLanguage")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {CONTACT_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="contact-channel" className="block text-sm mb-1 text-gray-300">Preferred Contact Channel</label>
              <select id="contact-channel" value={form.preferredChannel} onChange={set("preferredChannel")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {CONTACT_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </fieldset>

        {/* CRM information */}
        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">CRM information</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="contact-relationship" className="block text-sm mb-1 text-gray-300">Relationship Type</label>
              <select id="contact-relationship" value={form.relationshipType} onChange={set("relationshipType")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {CONTACT_RELATIONSHIP_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="contact-lifecycle" className="block text-sm mb-1 text-gray-300">Lifecycle Stage</label>
              <select id="contact-lifecycle" value={form.lifecycleStage} onChange={set("lifecycleStage")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {CONTACT_LIFECYCLE_STAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="contact-owner" className="block text-sm mb-1 text-gray-300">Contact Owner</label>
              <select id="contact-owner" value={form.ownerId} onChange={set("ownerId")}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.ownerId ? "border-red-600" : "border-gray-700"}`}>
                <option value="">Unassigned</option>
                {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select>
              {errors.ownerId && <p className="text-xs text-red-400 mt-1">{errors.ownerId}</p>}
            </div>
            <div>
              <label htmlFor="contact-source" className="block text-sm mb-1 text-gray-300">Source</label>
              <select id="contact-source" value={form.source} onChange={set("source")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {CONTACT_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="contact-followup" className="block text-sm mb-1 text-gray-300">Next Follow-up</label>
              <input id="contact-followup" type="date" value={form.nextFollowUp} onChange={set("nextFollowUp")}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.nextFollowUp ? "border-red-600" : "border-gray-700"}`} />
              {errors.nextFollowUp && <p className="text-xs text-red-400 mt-1">{errors.nextFollowUp}</p>}
            </div>
          </div>
          <div>
            <label htmlFor="contact-tags" className="block text-sm mb-1 text-gray-300">Tags (comma separated)</label>
            <input id="contact-tags" value={form.tags} onChange={set("tags")} placeholder="e.g. key-account, renewal-2026" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
        </fieldset>

        {/* Communication preferences */}
        <fieldset className="space-y-3 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Communication preferences</legend>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={form.emailAllowed} disabled={form.doNotContact} onChange={setBool("emailAllowed")} className="rounded" />
              Email allowed
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={form.phoneAllowed} disabled={form.doNotContact} onChange={setBool("phoneAllowed")} className="rounded" />
              Phone allowed
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={form.smsAllowed} disabled={form.doNotContact} onChange={setBool("smsAllowed")} className="rounded" />
              SMS allowed
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={form.marketingAllowed} disabled={form.doNotContact} onChange={setBool("marketingAllowed")} className="rounded" />
              Marketing allowed
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-red-300 pt-2 border-t border-gray-800">
            <input type="checkbox" checked={form.doNotContact} onChange={setBool("doNotContact")} className="rounded" />
            Do Not Contact
          </label>
          {doNotContactConflict && (
            <p className="text-xs text-amber-300 flex items-center gap-1.5">
              <AlertTriangle size={13} /> Do Not Contact will automatically turn off all channels above when saved.
            </p>
          )}
        </fieldset>

        {/* Notes */}
        <fieldset className="pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Notes</legend>
          <label htmlFor="contact-notes" className="sr-only">Initial note</label>
          <textarea id="contact-notes" value={form.notes} onChange={set("notes")} rows={2} placeholder="Initial note (optional)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        </fieldset>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <button type="button" onClick={requestClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Contact"}
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
            <p className="text-sm text-gray-400">You have unsaved changes to this contact. Closing now will discard them.</p>
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
