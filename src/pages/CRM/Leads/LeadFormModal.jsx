import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { X, AlertTriangle } from "lucide-react";
import { createLead, updateLead, clearLeadDuplicates } from "../../../redux/crm/leadsSlice";
import { CRM_DEPARTMENTS } from "../../../Helpers/mockUsersData";
import useCrmOwnerOptions from "../../../hooks/useCrmOwnerOptions";

const LEAD_SOURCES = ["Website", "Referral", "Cold Call", "Trade Show", "Social Media", "Advertisement"];
const CONTACT_CHANNELS = ["Email", "Phone", "SMS"];
const CURRENCIES = ["USD", "EUR", "GBP"];

const emptyForm = {
  firstName: "",
  lastName: "",
  companyName: "",
  jobTitle: "",
  email: "",
  phone: "",
  country: "",
  preferredContactChannel: "Email",
  source: "Website",
  interestedProduct: "",
  estimatedValue: "",
  currency: "USD",
  priority: "Medium",
  score: 0,
  ownerId: "",
  department: "",
  nextFollowUp: "",
  notes: "",
  tags: "",
  consent: true,
};

// Shared by "Add Lead" (LeadsList) and "Edit" (LeadDetail) so both routes use
// identical fields and validation, per the spec's editing requirements.
export default function LeadFormModal({ lead, onClose, onSaved }) {
  const dispatch = useDispatch();
  const owners = useCrmOwnerOptions();
  const duplicates = useSelector((s) => s.leads.duplicates);
  const isEdit = !!lead;

  const [form, setForm] = useState(() =>
    isEdit
      ? {
          firstName: lead.firstName || "",
          lastName: lead.lastName || "",
          companyName: lead.companyName || "",
          jobTitle: lead.jobTitle || "",
          email: lead.email || "",
          phone: lead.phone || "",
          country: lead.country || "",
          preferredContactChannel: lead.preferredContactChannel || "Email",
          source: lead.source || "Website",
          interestedProduct: lead.interestedProduct || "",
          estimatedValue: lead.estimatedValue ?? "",
          currency: lead.currency || "USD",
          priority: lead.priority || "Medium",
          score: lead.score ?? 0,
          ownerId: lead.ownerId || "",
          department: lead.department || "",
          nextFollowUp: lead.nextFollowUp ? lead.nextFollowUp.slice(0, 10) : "",
          notes: lead.notes || "",
          tags: (lead.tags || []).join(", "),
          consent: lead.consent !== false,
        }
      : emptyForm
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const buildPayload = (withOverride = false) => ({
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    companyName: form.companyName.trim(),
    jobTitle: form.jobTitle.trim(),
    email: form.email.trim().toLowerCase(),
    phone: form.phone.trim(),
    country: form.country.trim(),
    preferredContactChannel: form.preferredContactChannel,
    source: form.source,
    interestedProduct: form.interestedProduct.trim(),
    estimatedValue: form.estimatedValue === "" ? 0 : Number(form.estimatedValue),
    currency: form.currency,
    priority: form.priority,
    score: Number(form.score) || 0,
    ownerId: form.ownerId || undefined,
    department: form.department || undefined,
    nextFollowUp: form.nextFollowUp ? new Date(form.nextFollowUp).toISOString() : null,
    notes: form.notes,
    tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    consent: form.consent,
    ...(withOverride ? { duplicateOverride: true, overrideReason } : {}),
  });

  const submit = async (e, withOverride = false) => {
    e?.preventDefault();
    setSaving(true);
    setErrors({});
    const payload = buildPayload(withOverride);

    if (isEdit) {
      const result = await dispatch(updateLead({ id: lead._id, changes: payload }));
      setSaving(false);
      if (updateLead.fulfilled.match(result)) {
        onSaved?.(result.payload);
        onClose();
      } else {
        setErrors(result.payload?.errors || {});
      }
      return;
    }

    const result = await dispatch(createLead(payload));
    setSaving(false);
    if (createLead.fulfilled.match(result)) {
      onSaved?.(result.payload);
      onClose();
    } else if (result.payload?.errors) {
      setErrors(result.payload.errors);
    }
    // 409 duplicates are surfaced via state.leads.duplicates and rendered below —
    // the form intentionally stays open so nothing is lost on a failed request.
  };

  const cancelDuplicateFlow = () => {
    dispatch(clearLeadDuplicates());
    setOverrideReason("");
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form
        onSubmit={(e) => submit(e, false)}
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">{isEdit ? "Edit Lead" : "New Lead"}</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

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
              {duplicates.map(({ lead: dup, reasons }) => (
                <li key={dup._id} className="bg-gray-800/60 rounded-lg p-3 text-sm flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{dup.name} {dup.companyName ? `· ${dup.companyName}` : ""}</p>
                    <p className="text-xs text-gray-400">{reasons.join(", ")}</p>
                  </div>
                  <a href={`/crm/leads/${dup._id}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline text-xs whitespace-nowrap">
                    Open existing →
                  </a>
                </li>
              ))}
            </ul>
            <div>
              <label className="block text-xs mb-1 text-amber-200">Reason to create anyway *</label>
              <input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Explain why this is a genuinely different lead"
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
                Create Anyway
              </button>
            </div>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="lead-first-name" className="block text-sm mb-1 text-gray-300">First Name</label>
            <input id="lead-first-name" value={form.firstName} onChange={set("firstName")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="lead-last-name" className="block text-sm mb-1 text-gray-300">Last Name</label>
            <input id="lead-last-name" value={form.lastName} onChange={set("lastName")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        {errors.name && <p className="text-xs text-red-400 -mt-2">{errors.name}</p>}

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="lead-company" className="block text-sm mb-1 text-gray-300">Company Name</label>
            <input id="lead-company" value={form.companyName} onChange={set("companyName")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="lead-title" className="block text-sm mb-1 text-gray-300">Job Title</label>
            <input id="lead-title" value={form.jobTitle} onChange={set("jobTitle")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="lead-email" className="block text-sm mb-1 text-gray-300">Email</label>
            <input id="lead-email" type="email" value={form.email} onChange={set("email")}
              aria-invalid={!!errors.email} aria-describedby={errors.email ? "lead-email-error" : undefined}
              className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.email ? "border-red-600" : "border-gray-700"}`} />
            {errors.email && <p id="lead-email-error" className="text-xs text-red-400 mt-1">{errors.email}</p>}
          </div>
          <div>
            <label htmlFor="lead-phone" className="block text-sm mb-1 text-gray-300">Phone</label>
            <input id="lead-phone" value={form.phone} onChange={set("phone")}
              aria-invalid={!!errors.phone}
              className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.phone ? "border-red-600" : "border-gray-700"}`} />
            {errors.phone && <p className="text-xs text-red-400 mt-1">{errors.phone}</p>}
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="lead-country" className="block text-sm mb-1 text-gray-300">Country</label>
            <input id="lead-country" value={form.country} onChange={set("country")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="lead-channel" className="block text-sm mb-1 text-gray-300">Preferred Contact</label>
            <select id="lead-channel" value={form.preferredContactChannel} onChange={set("preferredContactChannel")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              {CONTACT_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="lead-source" className="block text-sm mb-1 text-gray-300">Source</label>
            <select id="lead-source" value={form.source} onChange={set("source")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="lead-interest" className="block text-sm mb-1 text-gray-300">Interested Product / Service</label>
          <input id="lead-interest" value={form.interestedProduct} onChange={set("interestedProduct")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        </div>

        <div className="grid sm:grid-cols-4 gap-4">
          <div>
            <label htmlFor="lead-value" className="block text-sm mb-1 text-gray-300">Est. Value</label>
            <input id="lead-value" type="number" min="0" value={form.estimatedValue} onChange={set("estimatedValue")}
              className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.estimatedValue ? "border-red-600" : "border-gray-700"}`} />
            {errors.estimatedValue && <p className="text-xs text-red-400 mt-1">{errors.estimatedValue}</p>}
          </div>
          <div>
            <label htmlFor="lead-currency" className="block text-sm mb-1 text-gray-300">Currency</label>
            <select id="lead-currency" value={form.currency} onChange={set("currency")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="lead-priority" className="block text-sm mb-1 text-gray-300">Priority</label>
            <select id="lead-priority" value={form.priority} onChange={set("priority")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              {["Low", "Medium", "High"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="lead-score" className="block text-sm mb-1 text-gray-300">Lead Score</label>
            <input id="lead-score" type="number" min="0" max="100" value={form.score} onChange={set("score")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="lead-owner" className="block text-sm mb-1 text-gray-300">Owner</label>
            <select id="lead-owner" value={form.ownerId} onChange={set("ownerId")}
              className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.ownerId ? "border-red-600" : "border-gray-700"}`}>
              <option value="">Unassigned</option>
              {owners.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
            {errors.ownerId && <p className="text-xs text-red-400 mt-1">{errors.ownerId}</p>}
          </div>
          <div>
            <label htmlFor="lead-department" className="block text-sm mb-1 text-gray-300">Department</label>
            <select id="lead-department" value={form.department} onChange={set("department")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">—</option>
              {CRM_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="lead-followup" className="block text-sm mb-1 text-gray-300">Next Follow-up</label>
            <input id="lead-followup" type="date" value={form.nextFollowUp} onChange={set("nextFollowUp")}
              className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.nextFollowUp ? "border-red-600" : "border-gray-700"}`} />
            {errors.nextFollowUp && <p className="text-xs text-red-400 mt-1">{errors.nextFollowUp}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="lead-tags" className="block text-sm mb-1 text-gray-300">Tags (comma separated)</label>
          <input id="lead-tags" value={form.tags} onChange={set("tags")} placeholder="e.g. enterprise, urgent" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        </div>

        <div>
          <label htmlFor="lead-notes" className="block text-sm mb-1 text-gray-300">Initial Note</label>
          <textarea id="lead-notes" value={form.notes} onChange={set("notes")} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={form.consent} onChange={(e) => setForm((f) => ({ ...f, consent: e.target.checked }))} className="rounded" />
          Consented to marketing communication
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
