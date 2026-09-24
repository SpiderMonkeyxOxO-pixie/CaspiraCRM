// Shared building blocks for the AI Administration pages (Backend Phase 11,
// VITE_BACKEND_AI_MODE=true): page shell with an access gate, tabs, stat
// cards and the reason dialog every consequential action uses.
import { useId, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { BACKEND_AI_MODE_ENABLED } from "../../../Helpers/backendAiClient";
import { useAiAdminAccess } from "../../../Helpers/aiAdminAccess";
import { Modal, ErrorBox, Loading } from "../../Admin/aiBackend/aiUi";
import { btn, btnPrimary, btnDanger, input } from "../../Admin/aiBackend/aiKit";

// requires: [[module, action], …] — any one opens the page.
export function AdminPage({ title, description, requires = [], actions, children }) {
  const access = useAiAdminAccess();
  if (!BACKEND_AI_MODE_ENABLED) {
    return <div className="p-6 text-gray-300"><h1 className="text-xl font-semibold text-white">{title}</h1><p className="mt-2 text-sm">AI Administration needs the backend AI mode (VITE_BACKEND_AI_MODE=true).</p></div>;
  }
  if (access.loading) return <Loading what="Checking your access…" />;
  const allowed = requires.length === 0 || requires.some(([m, a]) => access.can(m, a));
  if (!allowed) {
    return (
      <div className="p-6">
        <div role="alert" className="max-w-xl bg-gray-900/60 border border-gray-800 rounded-xl p-5 text-gray-300 flex gap-3">
          <ShieldAlert className="text-amber-300 shrink-0" aria-hidden="true" />
          <div><h1 className="text-lg font-semibold text-white">{title}</h1><p className="text-sm mt-1">Your role doesn't include access to this AI administration page. Ask an Organization Administrator if you need it.</p></div>
        </div>
      </div>
    );
  }
  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <nav aria-label="Breadcrumb" className="text-xs text-gray-500 flex items-center gap-1"><span>AI Administration</span><span>/</span><span className="text-gray-300">{title}</span></nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && <p className="text-sm text-gray-400 mt-1 max-w-3xl">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {typeof children === "function" ? children(access) : children}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label = "Sections" }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-gray-800">
      {tabs.map(([key, text]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} tabIndex={value === key ? 0 : -1} onClick={() => onChange(key)}
          onKeyDown={(e) => {
            const i = tabs.findIndex(([k]) => k === value);
            if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length][0]);
            if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length][0]);
          }}
          className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${value === key ? "border-blue-500 text-white" : "border-transparent text-gray-400 hover:text-gray-200"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

export const Stat = ({ label, value, hint, tone = "text-white" }) => (
  <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 min-w-0">
    <p className="text-xs text-gray-500">{label}</p>
    <p className={`text-xl font-semibold mt-0.5 truncate ${tone}`}>{value ?? "—"}</p>
    {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
  </div>
);

// Asks for a written reason (and optional extra fields) before an action.
// fields: [{ name, label, type: "text"|"select"|"textarea"|"checkbox", options, placeholder }]
export function ReasonDialog({ title, description, confirmLabel = "Confirm", danger = false, fields = [], requireReason = true, onSubmit, onClose }) {
  const id = useId();
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? (f.type === "checkbox" ? false : "")])));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (requireReason && reason.trim().length < 5) { setError("Write a reason (at least 5 characters)."); return; }
    setBusy(true); setError(null);
    try { await onSubmit({ ...values, reason: reason.trim() }); onClose(); } catch (err) { setError(err?.response?.data?.message || err.message || "Failed."); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {description && <p className="text-sm text-gray-300">{description}</p>}
        {fields.map((f) => (
          <label key={f.name} className={`block ${f.type === "checkbox" ? "flex items-center gap-2" : ""}`}>
            {f.type === "checkbox" ? (
              <><input type="checkbox" checked={!!values[f.name]} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))} /><span className="text-sm text-gray-300">{f.label}</span></>
            ) : (
              <>
                <span className="text-xs text-gray-400">{f.label}</span>
                {f.type === "select" ? (
                  <select className={input} value={values[f.name]} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
                    {(f.options || []).map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea className={`${input} min-h-[5rem]`} value={values[f.name]} placeholder={f.placeholder} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
                ) : (
                  <input className={input} value={values[f.name]} placeholder={f.placeholder} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
                )}
              </>
            )}
          </label>
        ))}
        {requireReason && (
          <label className="block" htmlFor={`${id}-reason`}>
            <span className="text-xs text-gray-400">Reason (recorded in the audit trail)</span>
            <textarea id={`${id}-reason`} className={`${input} min-h-[4rem]`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        )}
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="submit" className={danger ? btnDanger : btnPrimary} disabled={busy}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export const StatusNote = ({ children }) => <p className="text-[11px] text-gray-500">{children}</p>;
