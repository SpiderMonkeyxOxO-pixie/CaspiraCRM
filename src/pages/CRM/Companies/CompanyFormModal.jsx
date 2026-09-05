import { useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { X, AlertTriangle } from "lucide-react";
import { createCompany, updateCompany, clearCompanyDuplicates } from "../../../redux/crm/companiesSlice";
import { createContact } from "../../../redux/crm/contactsSlice";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";
import {
  COMPANY_ACCOUNT_TYPES, COMPANY_LIFECYCLE_STAGES, COMPANY_CUSTOMER_STATUSES,
  COMPANY_ACCOUNT_TIERS, COMPANY_ACCOUNT_HEALTH, COMPANY_SIZES, COMPANY_SOURCES,
  COMPANY_REGIONS, COMPANY_TEAMS, CONTACT_LANGUAGES, CONTACT_TIMEZONES,
} from "../../../Helpers/mockCrmData";
import useFocusTrap from "../../../hooks/useFocusTrap";

const emptyForm = {
  name: "", website: "", primaryDomain: "", industry: "", companySize: "", accountType: "Prospect",
  lifecycleStage: "New", customerStatus: "Active", accountTier: "Standard", accountHealth: "Healthy",
  source: "Website", tags: "",
  ownerId: "", assignedTeam: "", nextFollowUp: "",
  email: "", phone: "", country: "", region: "", city: "", address: "", timezone: "", preferredLanguage: "English",
  estimatedAnnualValue: "", currency: "USD", renewalDate: "",
  primaryContactId: "", notes: "",
};

function formFromCompany(company) {
  return {
    name: company.name || "", website: company.website || "", primaryDomain: company.primaryDomain || "",
    industry: company.industry || "", companySize: company.companySize || "", accountType: company.accountType || "Prospect",
    lifecycleStage: company.lifecycleStage || "New", customerStatus: company.customerStatus || "Active",
    accountTier: company.accountTier || "Standard", accountHealth: company.accountHealth || "Healthy",
    source: company.source || "Website", tags: (company.tags || []).join(", "),
    ownerId: company.ownerId || "", assignedTeam: company.assignedTeam || "",
    nextFollowUp: company.nextFollowUp ? company.nextFollowUp.slice(0, 10) : "",
    email: company.email || "", phone: company.phone || "", country: company.country || "", region: company.region || "",
    city: company.city || "", address: company.address || "", timezone: company.timezone || "",
    preferredLanguage: company.preferredLanguage || "English",
    estimatedAnnualValue: company.estimatedAnnualValue ?? "", currency: company.currency || "USD",
    renewalDate: company.renewalDate ? company.renewalDate.slice(0, 10) : "",
    primaryContactId: company.primaryContactId || "", notes: "",
  };
}

// Shared by "Add Company" (CompaniesList) and "Edit" (CompanyDetail).
export default function CompanyFormModal({ company, onClose, onSaved }) {
  const dispatch = useDispatch();
  const duplicates = useSelector((s) => s.companies.duplicates);
  const allContacts = useSelector((s) => s.contacts.items);
  const isEdit = !!company;

  const [form, setForm] = useState(() => (isEdit ? formFromCompany(company) : emptyForm));
  const initialFormRef = useRef(form);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [showNewContact, setShowNewContact] = useState(false);

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
  const requestClose = () => (isDirty ? setConfirmClose(true) : onClose());
  const containerRef = useFocusTrap(true, requestClose);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const buildPayload = (withOverride = false) => ({
    name: form.name.trim(),
    website: form.website.trim(),
    primaryDomain: form.primaryDomain.trim() || undefined,
    industry: form.industry || undefined,
    companySize: form.companySize || undefined,
    accountType: form.accountType,
    lifecycleStage: form.lifecycleStage,
    customerStatus: form.customerStatus,
    accountTier: form.accountTier,
    accountHealth: form.accountHealth,
    source: form.source,
    tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    ownerId: form.ownerId || undefined,
    assignedTeam: form.assignedTeam || undefined,
    nextFollowUp: form.nextFollowUp ? new Date(form.nextFollowUp).toISOString() : null,
    email: form.email.trim(),
    phone: form.phone.trim(),
    country: form.country.trim(),
    region: form.region || undefined,
    city: form.city.trim(),
    address: form.address.trim(),
    timezone: form.timezone || undefined,
    preferredLanguage: form.preferredLanguage,
    estimatedAnnualValue: form.estimatedAnnualValue === "" ? 0 : Number(form.estimatedAnnualValue),
    currency: form.currency,
    renewalDate: form.renewalDate ? new Date(form.renewalDate).toISOString() : null,
    primaryContactId: form.primaryContactId || null,
    notes: form.notes,
    ...(withOverride ? { duplicateOverride: true, overrideReason } : {}),
  });

  const submit = async (e, withOverride = false) => {
    e?.preventDefault();
    setSaving(true);
    setErrors({});
    const payload = buildPayload(withOverride);

    if (isEdit) {
      const result = await dispatch(updateCompany({ id: company._id, changes: payload }));
      setSaving(false);
      if (updateCompany.fulfilled.match(result)) {
        setSavedMessage("Company updated in preview");
        initialFormRef.current = form;
        onSaved?.(result.payload);
        setTimeout(() => onClose(), 1100);
      } else {
        setErrors(result.payload?.errors || {});
      }
      return;
    }

    const result = await dispatch(createCompany(payload));
    setSaving(false);
    if (createCompany.fulfilled.match(result)) {
      onSaved?.(result.payload);
      onClose();
    } else if (result.payload?.errors) {
      setErrors(result.payload.errors);
    }
  };

  const cancelDuplicateFlow = () => {
    dispatch(clearCompanyDuplicates());
    setOverrideReason("");
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={requestClose}>
      <form
        ref={containerRef}
        onSubmit={(e) => submit(e, false)}
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={isEdit ? "Edit Company" : "New Company"}
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">{isEdit ? "Edit Company" : "New Company"}</h2>
          <button type="button" onClick={requestClose} aria-label="Close"><X size={20} /></button>
        </div>

        {savedMessage && (
          <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg px-3 py-2 text-sm text-emerald-300">
            {savedMessage} — stored in this session's frontend preview and will be replaced by the backend service adapter later.
          </div>
        )}

        {duplicates.length > 0 && (
          <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-200">This looks like it might already exist</p>
                <p className="text-xs text-amber-300/80">Review the match below before creating a new record. Full merging happens later in /crm/duplicates.</p>
              </div>
            </div>
            <ul className="space-y-2">
              {duplicates.map(({ company: dup, reasons }) => (
                <li key={dup._id} className="bg-gray-800/60 rounded-lg p-3 text-sm flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{dup.name}</p>
                    <p className="text-xs text-gray-400">Matched on: {reasons.join(", ")} · Lifecycle: {dup.lifecycleStage} · Owner: {dup.ownerName || "Unassigned"}</p>
                  </div>
                  <a href={`/crm/companies/${dup._id}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline text-xs whitespace-nowrap">
                    View Existing Company →
                  </a>
                </li>
              ))}
            </ul>
            <div>
              <label className="block text-xs mb-1 text-amber-200">Reason to continue anyway *</label>
              <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Explain why this is a genuinely different company"
                className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancelDuplicateFlow} className="px-3 py-1.5 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="button" disabled={!overrideReason.trim()} onClick={(e) => submit(e, true)}
                className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-40 text-sm font-medium">
                Continue Anyway
              </button>
            </div>
          </div>
        )}

        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Basic information</legend>
          <div>
            <label htmlFor="company-name" className="block text-sm mb-1 text-gray-300">Company Name</label>
            <input id="company-name" value={form.name} onChange={set("name")}
              aria-invalid={!!errors.name} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.name ? "border-red-600" : "border-gray-700"}`} />
            {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="company-website" className="block text-sm mb-1 text-gray-300">Website</label>
              <input id="company-website" value={form.website} onChange={set("website")} placeholder="https://example.com"
                aria-invalid={!!errors.website} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.website ? "border-red-600" : "border-gray-700"}`} />
              {errors.website && <p className="text-xs text-red-400 mt-1">{errors.website}</p>}
            </div>
            <div>
              <label htmlFor="company-domain" className="block text-sm mb-1 text-gray-300">Primary Domain</label>
              <input id="company-domain" value={form.primaryDomain} onChange={set("primaryDomain")} placeholder="example.com" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="company-industry" className="block text-sm mb-1 text-gray-300">Industry</label>
              <input id="company-industry" value={form.industry} onChange={set("industry")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="company-size" className="block text-sm mb-1 text-gray-300">Company Size</label>
              <select id="company-size" value={form.companySize} onChange={set("companySize")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">—</option>
                {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="company-account-type" className="block text-sm mb-1 text-gray-300">Account Type</label>
              <select id="company-account-type" value={form.accountType} onChange={set("accountType")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {COMPANY_ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">CRM classification</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="company-lifecycle" className="block text-sm mb-1 text-gray-300">Lifecycle Stage</label>
              <select id="company-lifecycle" value={form.lifecycleStage} onChange={set("lifecycleStage")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {COMPANY_LIFECYCLE_STAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="company-customer-status" className="block text-sm mb-1 text-gray-300">Customer Status</label>
              <select id="company-customer-status" value={form.customerStatus} onChange={set("customerStatus")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {COMPANY_CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="company-tier" className="block text-sm mb-1 text-gray-300">Account Tier</label>
              <select id="company-tier" value={form.accountTier} onChange={set("accountTier")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {COMPANY_ACCOUNT_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="company-health" className="block text-sm mb-1 text-gray-300">Account Health</label>
              <select id="company-health" value={form.accountHealth} onChange={set("accountHealth")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {COMPANY_ACCOUNT_HEALTH.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="company-source" className="block text-sm mb-1 text-gray-300">Lead Source</label>
              <select id="company-source" value={form.source} onChange={set("source")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {COMPANY_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="company-tags" className="block text-sm mb-1 text-gray-300">Tags (comma separated)</label>
            <input id="company-tags" value={form.tags} onChange={set("tags")} placeholder="e.g. strategic, renewal-2026" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
        </fieldset>

        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Ownership</legend>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="company-owner" className="block text-sm mb-1 text-gray-300">Account Owner</label>
              <select id="company-owner" value={form.ownerId} onChange={set("ownerId")}
                className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.ownerId ? "border-red-600" : "border-gray-700"}`}>
                <option value="">Unassigned</option>
                {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select>
              {errors.ownerId && <p className="text-xs text-red-400 mt-1">{errors.ownerId}</p>}
            </div>
            <div>
              <label htmlFor="company-team" className="block text-sm mb-1 text-gray-300">Assigned Team</label>
              <select id="company-team" value={form.assignedTeam} onChange={set("assignedTeam")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">—</option>
                {COMPANY_TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="company-followup" className="block text-sm mb-1 text-gray-300">Next Follow-up</label>
              <input id="company-followup" type="date" value={form.nextFollowUp} onChange={set("nextFollowUp")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Contact information</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="company-email" className="block text-sm mb-1 text-gray-300">Primary Email</label>
              <input id="company-email" type="email" value={form.email} onChange={set("email")}
                aria-invalid={!!errors.email} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.email ? "border-red-600" : "border-gray-700"}`} />
              {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email}</p>}
            </div>
            <div>
              <label htmlFor="company-phone" className="block text-sm mb-1 text-gray-300">Phone</label>
              <input id="company-phone" value={form.phone} onChange={set("phone")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="company-country" className="block text-sm mb-1 text-gray-300">Country</label>
              <input id="company-country" value={form.country} onChange={set("country")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="company-region" className="block text-sm mb-1 text-gray-300">Region</label>
              <select id="company-region" value={form.region} onChange={set("region")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">—</option>
                {COMPANY_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="company-city" className="block text-sm mb-1 text-gray-300">City</label>
              <input id="company-city" value={form.city} onChange={set("city")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label htmlFor="company-address" className="block text-sm mb-1 text-gray-300">Address</label>
            <input id="company-address" value={form.address} onChange={set("address")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="company-timezone" className="block text-sm mb-1 text-gray-300">Time Zone</label>
              <select id="company-timezone" value={form.timezone} onChange={set("timezone")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">—</option>
                {CONTACT_TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="company-language" className="block text-sm mb-1 text-gray-300">Preferred Language</label>
              <select id="company-language" value={form.preferredLanguage} onChange={set("preferredLanguage")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {CONTACT_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Commercial information</legend>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="company-value" className="block text-sm mb-1 text-gray-300">Est. Annual Value</label>
              <input id="company-value" type="number" min="0" value={form.estimatedAnnualValue} onChange={set("estimatedAnnualValue")}
                aria-invalid={!!errors.estimatedAnnualValue} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.estimatedAnnualValue ? "border-red-600" : "border-gray-700"}`} />
              {errors.estimatedAnnualValue && <p className="text-xs text-red-400 mt-1">{errors.estimatedAnnualValue}</p>}
            </div>
            <div>
              <label htmlFor="company-currency" className="block text-sm mb-1 text-gray-300">Currency</label>
              <select id="company-currency" value={form.currency} onChange={set("currency")} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {["USD", "EUR", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="company-renewal" className="block text-sm mb-1 text-gray-300">Renewal Date</label>
              <input id="company-renewal" type="date" value={form.renewalDate} onChange={set("renewalDate")}
                aria-invalid={!!errors.renewalDate} className={`w-full bg-gray-800/60 border rounded-lg px-3 py-2 text-sm ${errors.renewalDate ? "border-red-600" : "border-gray-700"}`} />
              {errors.renewalDate && <p className="text-xs text-red-400 mt-1">{errors.renewalDate}</p>}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3 pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Primary contact</legend>
          <div className="flex gap-2">
            <select value={form.primaryContactId} onChange={set("primaryContactId")} className="flex-1 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
              <option value="">Unset</option>
              {allContacts.map((c) => <option key={c._id} value={c._id}>{c.name}{c.email ? ` · ${c.email}` : ""}</option>)}
            </select>
            <button type="button" onClick={() => setShowNewContact(true)} className="px-3 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm whitespace-nowrap">
              + New Contact
            </button>
          </div>
        </fieldset>

        <fieldset className="pt-4 border-t border-gray-800">
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Notes</legend>
          <label htmlFor="company-notes" className="sr-only">Initial internal note</label>
          <textarea id="company-notes" value={form.notes} onChange={set("notes")} rows={2} placeholder="Initial internal note (optional)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        </fieldset>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <button type="button" onClick={requestClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Company"}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 -mt-2">
          Preview only — saved to this session's in-memory frontend state. Persistence will be replaced by the backend service adapter in a later phase.
        </p>
      </form>

      {showNewContact && (
        <NewContactQuickModal
          onClose={() => setShowNewContact(false)}
          onCreated={(contact) => { setForm((f) => ({ ...f, primaryContactId: contact._id })); setShowNewContact(false); }}
        />
      )}

      {confirmClose && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold">Discard unsaved changes?</h3>
            <p className="text-sm text-gray-400">You have unsaved changes to this company. Closing now will discard them.</p>
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

// A lightweight nested contact-create interaction — deliberately not the
// full /crm/contacts form (per spec: "do not duplicate the full Contacts
// route form unnecessarily").
function NewContactQuickModal({ onClose, onCreated }) {
  const dispatch = useDispatch();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const containerRef = useFocusTrap(true, onClose);

  const submit = async (e) => {
    e.preventDefault();
    const [firstName, ...rest] = name.trim().split(" ");
    if (!firstName) { setError("Enter a name"); return; }
    if (!email.trim() && !phone.trim()) { setError("Provide an email or phone number"); return; }
    const result = await dispatch(createContact({ firstName, lastName: rest.join(" "), email: email.trim(), phone: phone.trim(), relationshipType: "Prospect", lifecycleStage: "New", source: "Website" }));
    if (createContact.fulfilled.match(result)) onCreated(result.payload);
    else setError("Could not create contact — try the full Contacts form instead");
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Quick New Contact" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-bold">New Contact</h3>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Create</button>
        </div>
      </form>
    </div>
  );
}
