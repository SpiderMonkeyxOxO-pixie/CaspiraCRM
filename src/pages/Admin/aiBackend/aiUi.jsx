// Shared building blocks for the backend-mode AI Provider screens
// (VITE_BACKEND_AI_MODE=true). Same look as the rest of Administration.
import { NavLink } from "react-router-dom";
import { X } from "lucide-react";
import useFocusTrap from "../../../hooks/useFocusTrap";

const TABS = [
  ["", "Overview"], ["providers", "Providers"], ["models", "Models"], ["routing", "Routing"], ["policies", "Policies"],
  ["privacy", "Privacy"], ["usage", "Usage & Budgets"], ["evaluations", "Evaluations"], ["audit", "Audit"],
];

export function AiPage({ title, description, actions, simulatorLabel, children }) {
  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <nav aria-label="Breadcrumb" className="text-xs text-gray-500 flex items-center gap-1 flex-wrap">
        <span>Administration</span> <span>/</span> <span>Integrations</span> <span>/</span> <span>AI Providers</span>
        {title !== "AI Providers" && <><span>/</span> <span className="text-gray-300">{title}</span></>}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          {description && <p className="text-sm text-gray-400 mt-1 max-w-3xl">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      <nav aria-label="AI Providers sections" className="flex gap-1 overflow-x-auto border-b border-gray-800">
        {TABS.map(([path, label]) => (
          <NavLink key={path} end to={`/admin/integrations/ai-providers${path ? `/${path}` : ""}`}
            className={({ isActive }) => `px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${isActive ? "border-blue-500 text-white" : "border-transparent text-gray-400 hover:text-gray-200"}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      {simulatorLabel && <SimulatorBanner label={simulatorLabel} />}
      {children}
    </div>
  );
}

export const SimulatorBanner = ({ label }) => (
  <div role="note" className="bg-violet-500/10 border border-violet-500/30 rounded-xl px-3 py-2 text-sm text-violet-200">{label}</div>
);

export function Panel({ title, actions, children, className = "" }) {
  return (
    <section className={`bg-gray-900/40 border border-gray-800 rounded-xl p-4 ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 mb-3">
          {title && <h2 className="text-sm font-semibold text-white">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const BADGE = {
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  red: "bg-red-500/15 text-red-300 border-red-500/30",
  blue: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  gray: "bg-gray-800 text-gray-400 border-gray-700",
  violet: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};
const STATUS_TONE = {
  Connected: "green", "Connected with Warnings": "amber", "Ready to Verify": "blue", "Configuration Incomplete": "amber", "Verification Failed": "red",
  "Rate Limited": "amber", "Budget Exhausted": "red", "Suspended by Policy": "red", Disabled: "gray", Revoked: "gray", Error: "red", "Not Configured": "gray", Unavailable: "gray",
  Completed: "green", "Completed with Warnings": "amber", Failed: "red", Cancelled: "gray", Refused: "amber", Running: "blue", Queued: "blue",
  "Awaiting Confirmation": "blue", "Awaiting Approval": "amber", Executed: "green", Rejected: "gray", Expired: "gray", Undone: "gray",
  Pass: "green", Fail: "red", Succeeded: "green", Success: "green", Failure: "red",
};
export const Badge = ({ children, tone }) => (
  <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${BADGE[tone || STATUS_TONE[children] || "gray"]}`}>{children}</span>
);

export const ErrorBox = ({ error, onRetry }) => (error ? (
  <div role="alert" className="bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-sm text-red-300 flex items-center justify-between gap-3">
    <span>{error}</span>
    {onRetry && <button type="button" onClick={onRetry} className="text-xs underline">Retry</button>}
  </div>
) : null);

export const Loading = ({ what = "Loading…" }) => <p role="status" className="text-sm text-gray-400 py-6 text-center">{what}</p>;
export const Empty = ({ children }) => <p className="text-sm text-gray-400 py-4">{children}</p>;

export function Modal({ title, onClose, children, footer }) {
  const ref = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-200 p-1"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Table({ columns, rows, empty = "Nothing to show yet.", rowKey = (r) => r._id || r.id }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto border border-gray-800 rounded-xl">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
          <tr>{columns.map((c) => <th key={c.label} scope="col" className="text-left px-3 py-2 whitespace-nowrap">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-t border-gray-800 align-top">
              {columns.map((c) => <td key={c.label} className="px-3 py-2 text-gray-300">{c.render ? c.render(r) : r[c.key] ?? "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
