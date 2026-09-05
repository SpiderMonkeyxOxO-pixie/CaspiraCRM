import { useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { X, ChevronRight, ChevronLeft, Search, AlertTriangle, Check } from "lucide-react";
import { createCustomRole as createCustomRoleThunk, updateCustomRole as updateCustomRoleThunk } from "../../redux/admin/rolesSlice";
import {
  MODULE_GROUPS, ACTIONS, ACTION_LABELS, getApplicableActions, SCOPES, SCOPE_DESCRIPTIONS,
  SENSITIVE_FIELD_GROUPS, FIELD_STATES, FIELD_STATE_LABELS, APPROVAL_TYPES,
  isHighRiskGrant, validateRolePayload, detectRoleConflicts, checkSeparationOfDuties,
} from "../../Helpers/mockRbacData";
import { FIELD_STATE_COLORS } from "./rbacUtils";
import useFocusTrap from "../../hooks/useFocusTrap";

const STEPS = ["Role Information", "Scope", "Module Permissions", "Sensitive Fields", "Approval Rules", "Review"];

const PRESETS = {
  read_only: (moduleId) => getApplicableActions(MODULE_GROUPS.flatMap((g) => g.modules).find((m) => m.id === moduleId) || {}).filter((a) =>
    ["view", "view_own", "view_team", "view_department", "view_organization"].includes(a)
  ),
  standard_editor: (moduleId) => {
    const mod = MODULE_GROUPS.flatMap((g) => g.modules).find((m) => m.id === moduleId);
    const all = getApplicableActions(mod || {});
    return all.filter((a) => !["delete_permanently", "configure"].includes(a));
  },
  manager: (moduleId) => {
    const mod = MODULE_GROUPS.flatMap((g) => g.modules).find((m) => m.id === moduleId);
    return getApplicableActions(mod || {}).filter((a) => a !== "delete_permanently");
  },
};

function emptyForm() {
  return {
    name: "",
    description: "",
    purpose: "",
    type: "Custom",
    department: "",
    status: "Active",
    defaultScope: "Own",
    allowedScopes: ["Own"],
    isOrdinaryRecordOwner: true,
    customerAccountRestricted: false,
    permissionGrants: [],
    sensitiveFields: {},
    approvalRules: {},
    duplicatedFrom: null,
  };
}

function formFromRole(role, { asDuplicate } = {}) {
  return {
    name: asDuplicate ? `${role.name} (Copy)` : role.name,
    description: role.description,
    purpose: role.purpose,
    type: "Custom",
    department: role.department || "",
    status: role.status,
    defaultScope: role.defaultScope,
    allowedScopes: [...role.allowedScopes],
    isOrdinaryRecordOwner: !!role.isOrdinaryRecordOwner,
    customerAccountRestricted: !!role.customerAccountRestricted,
    permissionGrants: role.permissionGrants.map((g) => ({ moduleId: g.moduleId, actions: [...g.actions] })),
    sensitiveFields: { ...role.sensitiveFields },
    approvalRules: { ...role.approvalRules },
    duplicatedFrom: asDuplicate ? role.id : role.duplicatedFrom || null,
  };
}

export default function RoleBuilder({ mode, role, onClose, onSaved }) {
  const dispatch = useDispatch();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(() => {
    if (mode === "edit" && role) return formFromRole(role);
    if (mode === "duplicate" && role) return formFromRole(role, { asDuplicate: true });
    return emptyForm();
  });
  const [moduleSearch, setModuleSearch] = useState("");
  const [selectAllAck, setSelectAllAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const dialogRef = useFocusTrap(true, onClose);

  const title = mode === "edit" ? "Edit Custom Role" : mode === "duplicate" ? "Duplicate Into Custom Role" : "Create Custom Role";

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const grantFor = (moduleId) => form.permissionGrants.find((g) => g.moduleId === moduleId);

  const toggleAction = (moduleId, action) => {
    setForm((f) => {
      const grants = [...f.permissionGrants];
      const idx = grants.findIndex((g) => g.moduleId === moduleId);
      if (idx === -1) {
        grants.push({ moduleId, actions: [action] });
      } else {
        const actions = grants[idx].actions.includes(action)
          ? grants[idx].actions.filter((a) => a !== action)
          : [...grants[idx].actions, action];
        grants[idx] = { ...grants[idx], actions };
      }
      return { ...f, permissionGrants: grants.filter((g) => g.actions.length > 0) };
    });
  };

  const applyPreset = (moduleId, presetKey) => {
    const actions = PRESETS[presetKey](moduleId);
    setForm((f) => {
      const grants = f.permissionGrants.filter((g) => g.moduleId !== moduleId);
      if (actions.length > 0) grants.push({ moduleId, actions });
      return { ...f, permissionGrants: grants };
    });
  };

  const clearModule = (moduleId) => {
    setForm((f) => ({ ...f, permissionGrants: f.permissionGrants.filter((g) => g.moduleId !== moduleId) }));
  };

  const selectAllEverything = () => {
    const grants = MODULE_GROUPS.flatMap((g) => g.modules).map((m) => ({ moduleId: m.id, actions: getApplicableActions(m) }));
    setForm((f) => ({ ...f, permissionGrants: grants }));
    setSelectAllAck(false);
  };

  const setFieldState = (fieldId, state) => {
    setForm((f) => ({ ...f, sensitiveFields: { ...f.sensitiveFields, [fieldId]: state } }));
  };

  const toggleApproval = (approvalId) => {
    setForm((f) => ({ ...f, approvalRules: { ...f.approvalRules, [approvalId]: !f.approvalRules[approvalId] } }));
  };

  const toggleScope = (scope) => {
    setForm((f) => {
      const has = f.allowedScopes.includes(scope);
      const allowedScopes = has ? f.allowedScopes.filter((s) => s !== scope) : [...f.allowedScopes, scope];
      return { ...f, allowedScopes, defaultScope: allowedScopes.includes(f.defaultScope) ? f.defaultScope : (allowedScopes[0] || f.defaultScope) };
    });
  };

  const highRiskGrants = useMemo(() => {
    const found = [];
    form.permissionGrants.forEach((g) => g.actions.forEach((a) => {
      if (isHighRiskGrant(g.moduleId, a)) found.push({ moduleId: g.moduleId, action: a });
    }));
    return found;
  }, [form.permissionGrants]);

  const conflicts = useMemo(() => detectRoleConflicts({ ...form, id: role?.id || "draft", isBuiltIn: false }), [form, role]);

  const sodWarnings = useMemo(() => {
    const warnings = [];
    APPROVAL_TYPES.forEach((a) => {
      if (form.approvalRules[a.id] && form.defaultScope === "Own") {
        const check = checkSeparationOfDuties({ approvalType: a.id, isOwnRecord: true });
        if (!check.allowed) warnings.push(`${a.label}: ${check.violations[0]}`);
      }
    });
    return warnings;
  }, [form.approvalRules, form.defaultScope]);

  const goNext = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const canProceedStep0 = form.name.trim().length > 0;
  const canProceedStep1 = form.defaultScope && form.allowedScopes.length > 0;

  const handleSubmit = async () => {
    const errors = validateRolePayload(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setStep(2);
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "edit" && role) {
        const res = await dispatch(updateCustomRoleThunk({ id: role.id, changes: form }));
        if (res.payload?.role) onSaved(res.payload.role);
      } else {
        const res = await dispatch(createCustomRoleThunk(form));
        if (res.payload?.role) onSaved(res.payload.role);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const filteredGroups = useMemo(() => {
    if (!moduleSearch.trim()) return MODULE_GROUPS;
    const q = moduleSearch.toLowerCase();
    return MODULE_GROUPS.map((g) => ({ ...g, modules: g.modules.filter((m) => m.label.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)) }))
      .filter((g) => g.modules.length > 0);
  }, [moduleSearch]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title}
        className="relative bg-[#0d0f16] border border-gray-800 rounded-2xl w-full max-w-6xl h-[92vh] flex flex-col md:flex-row overflow-hidden">

        <nav aria-label="Role builder steps" className="md:w-56 shrink-0 bg-gray-900/40 border-b md:border-b-0 md:border-r border-gray-800 p-4 flex flex-col gap-1 max-h-40 md:max-h-none overflow-y-auto">
          {STEPS.map((label, i) => (
            <button key={label} onClick={() => setStep(i)}
              aria-current={step === i ? "step" : undefined}
              className={`text-left px-3 py-2 rounded-lg text-sm whitespace-nowrap shrink-0 ${
                step === i ? "bg-blue-500/20 text-blue-300" : i < step ? "text-gray-300 hover:bg-gray-800" : "text-gray-500 hover:bg-gray-800"
              }`}>
              {i + 1} {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <button onClick={onClose} aria-label="Close"><X size={20} className="text-gray-400 hover:text-white" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {step === 0 && (
              <div className="space-y-4 max-w-xl">
                <Field label="Role name" required>
                  <input value={form.name} onChange={(e) => update("name", e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </Field>
                <Field label="Description">
                  <textarea value={form.description} onChange={(e) => update("description", e.target.value)} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </Field>
                <Field label="Purpose">
                  <input value={form.purpose} onChange={(e) => update("purpose", e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </Field>
                <Field label="Role type">
                  <input value="Custom" disabled className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-500" />
                </Field>
                <Field label="Department">
                  <select value={form.department} onChange={(e) => update("department", e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option value="">Not department-specific</option>
                    {["Sales", "Support", "Marketing", "Finance", "HR"].map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={form.status} onChange={(e) => update("status", e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </Field>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5 max-w-2xl">
                <div>
                  <h3 className="text-sm font-semibold text-white mb-2">Allowed scopes</h3>
                  <div className="space-y-2">
                    {SCOPES.map((s) => (
                      <label key={s} className="flex items-start gap-3 bg-gray-900/40 border border-gray-800 rounded-lg p-3 cursor-pointer">
                        <input type="checkbox" checked={form.allowedScopes.includes(s)} onChange={() => toggleScope(s)} className="mt-1" />
                        <div>
                          <p className="text-sm text-white">{s}</p>
                          <p className="text-xs text-gray-500">{SCOPE_DESCRIPTIONS[s]}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <Field label="Default scope" required>
                  <select value={form.defaultScope} onChange={(e) => update("defaultScope", e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                    {form.allowedScopes.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={form.isOrdinaryRecordOwner} onChange={(e) => update("isOrdinaryRecordOwner", e.target.checked)} />
                  Users with this role are the ordinary owner of records they create
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={form.customerAccountRestricted} onChange={(e) => update("customerAccountRestricted", e.target.checked)} />
                  Restrict this role to a single external Customer Account
                </label>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input value={moduleSearch} onChange={(e) => setModuleSearch(e.target.value)} placeholder="Search modules..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white" />
                </div>

                <div className="bg-amber-900/10 border border-amber-800/30 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-amber-200 font-medium">Select every permission for every module</p>
                    <p className="text-[11px] text-amber-200/70">This is a broad grant — confirm you intend to select everything before continuing.</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-1 text-[11px] text-amber-200">
                      <input type="checkbox" checked={selectAllAck} onChange={(e) => setSelectAllAck(e.target.checked)} /> I understand
                    </label>
                    <button disabled={!selectAllAck} onClick={selectAllEverything} className="px-3 py-1.5 rounded-lg text-xs bg-amber-600 disabled:opacity-30 text-white">Select All</button>
                  </div>
                </div>

                {fieldErrors.permissionGrants && <p className="text-xs text-red-400">{fieldErrors.permissionGrants}</p>}

                <div className="space-y-4 max-h-[52vh] overflow-y-auto pr-1">
                  {filteredGroups.map((group) => (
                    <div key={group.id}>
                      <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">{group.label}</h4>
                      <div className="space-y-2">
                        {group.modules.map((m) => {
                          const applicable = getApplicableActions(m);
                          const grant = grantFor(m.id);
                          return (
                            <div key={m.id} className="bg-gray-900/40 border border-gray-800 rounded-lg p-3">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-sm text-white">{m.label}</p>
                                <div className="flex items-center gap-2">
                                  <select onChange={(e) => e.target.value && applyPreset(m.id, e.target.value)} value="" className="bg-gray-800 border border-gray-700 rounded text-[11px] text-gray-300 px-2 py-1">
                                    <option value="">Apply preset…</option>
                                    <option value="read_only">Read Only</option>
                                    <option value="standard_editor">Standard Editor</option>
                                    <option value="manager">Manager</option>
                                  </select>
                                  {grant && <button onClick={() => clearModule(m.id)} className="text-[11px] text-gray-500 hover:text-red-400">Clear</button>}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {applicable.map((action) => {
                                  const checked = grant?.actions.includes(action) || false;
                                  const risky = isHighRiskGrant(m.id, action);
                                  return (
                                    <label key={action} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border cursor-pointer ${
                                      checked ? (risky ? "bg-red-500/15 border-red-500/40 text-red-300" : "bg-blue-500/15 border-blue-500/40 text-blue-300") : "bg-gray-800 border-gray-700 text-gray-400"
                                    }`}>
                                      <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleAction(m.id, action)} />
                                      {checked && <Check size={11} />} {ACTION_LABELS[action]}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                {SENSITIVE_FIELD_GROUPS.map((group) => (
                  <div key={group.id}>
                    <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">{group.label}</h4>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {group.fields.map((f) => {
                        const state = form.sensitiveFields[f.id] || "hidden";
                        return (
                          <div key={f.id} className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 flex items-center justify-between gap-2">
                            <span className="text-sm text-gray-200">{f.label}</span>
                            <select value={state} onChange={(e) => setFieldState(f.id, e.target.value)}
                              className={`text-xs rounded-md px-2 py-1 border ${FIELD_STATE_COLORS[state]}`}>
                              {FIELD_STATES.map((s) => <option key={s} value={s}>{FIELD_STATE_LABELS[s]}</option>)}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-2 max-w-xl">
                <p className="text-sm text-gray-400 mb-3">A requester can never approve their own submission — this is enforced regardless of these settings.</p>
                {APPROVAL_TYPES.map((a) => (
                  <label key={a.id} className="flex items-center justify-between bg-gray-900/40 border border-gray-800 rounded-lg p-3 cursor-pointer">
                    <span className="text-sm text-gray-200">{a.label}</span>
                    <input type="checkbox" checked={!!form.approvalRules[a.id]} onChange={() => toggleApproval(a.id)} />
                  </label>
                ))}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-5 max-w-2xl">
                <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-white mb-2">Role summary</h3>
                  <dl className="grid grid-cols-2 gap-y-2 text-sm">
                    <dt className="text-gray-500">Name</dt><dd className="text-gray-200">{form.name || "—"}</dd>
                    <dt className="text-gray-500">Default scope</dt><dd className="text-gray-200">{form.defaultScope}</dd>
                    <dt className="text-gray-500">Allowed scopes</dt><dd className="text-gray-200">{form.allowedScopes.join(", ")}</dd>
                    <dt className="text-gray-500">Granted permissions</dt><dd className="text-gray-200">{form.permissionGrants.reduce((n, g) => n + g.actions.length, 0)} across {form.permissionGrants.length} modules</dd>
                    <dt className="text-gray-500">Sensitive fields configured</dt><dd className="text-gray-200">{Object.keys(form.sensitiveFields).length}</dd>
                    <dt className="text-gray-500">Approval capabilities</dt><dd className="text-gray-200">{Object.values(form.approvalRules).filter(Boolean).length}</dd>
                  </dl>
                </div>

                {highRiskGrants.length > 0 && (
                  <div className="bg-red-900/10 border border-red-800/30 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-red-300 mb-2 flex items-center gap-2"><AlertTriangle size={15} /> High-risk permissions ({highRiskGrants.length})</h3>
                    {highRiskGrants.length >= 2 && <p className="text-xs text-red-200/80 mb-2">This Custom Role holds multiple high-risk permissions. Review carefully before saving.</p>}
                    <ul className="text-xs text-red-200/90 space-y-1">
                      {highRiskGrants.map((h, i) => <li key={i}>{h.moduleId} — {ACTION_LABELS[h.action]}</li>)}
                    </ul>
                  </div>
                )}

                {(conflicts.length > 0 || sodWarnings.length > 0) && (
                  <div className="bg-amber-900/10 border border-amber-800/30 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-amber-300 mb-2 flex items-center gap-2"><AlertTriangle size={15} /> Conflicts and separation-of-duties warnings</h3>
                    <ul className="text-xs text-amber-200/90 space-y-1 list-disc list-inside">
                      {conflicts.map((c, i) => <li key={`c-${i}`}>{c.message}</li>)}
                      {sodWarnings.map((w, i) => <li key={`s-${i}`}>{w}</li>)}
                    </ul>
                  </div>
                )}

                <p className="text-[11px] text-gray-500">Saving updates frontend session state only — this preview does not replace future backend authorization.</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
            <button onClick={goBack} disabled={step === 0} className="flex items-center gap-1 text-sm text-gray-400 disabled:opacity-30 hover:text-white">
              <ChevronLeft size={16} /> Back
            </button>
            {step < STEPS.length - 1 ? (
              <button onClick={goNext} disabled={(step === 0 && !canProceedStep0) || (step === 1 && !canProceedStep1)}
                className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm">
                Next <ChevronRight size={16} />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {submitting ? "Saving…" : mode === "edit" ? "Save Changes" : "Create Custom Role"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}{required && <span className="text-red-400"> *</span>}</label>
      {children}
    </div>
  );
}
