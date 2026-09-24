// Small shared pieces for the backend-mode Finance screens.
import { Lock, PlugZap } from "lucide-react";
import { buttonClass } from "./financeFormat";

const STATUS_STYLES = {
  Draft: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Submitted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Under Review": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Approved: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Posted: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Sent: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Paid: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Reimbursed Record": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Partially Paid": "bg-teal-500/15 text-teal-300 border-teal-500/30",
  Open: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Reopened: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  "Soft Closed": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Closed: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Rejected: "bg-red-500/15 text-red-300 border-red-500/30",
  Reversed: "bg-red-500/15 text-red-300 border-red-500/30",
  Cancelled: "bg-red-500/15 text-red-300 border-red-500/30",
  Void: "bg-red-500/15 text-red-300 border-red-500/30",
  Overdue: "bg-red-500/15 text-red-300 border-red-500/30",
  "Legacy Recorded": "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

export function StatusBadge({ status }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${STATUS_STYLES[status] || "bg-gray-500/15 text-gray-300 border-gray-500/30"}`}>{status}</span>;
}

export function Panel({ title, subtitle, actions, children, className = "" }) {
  return (
    <section className={`bg-gray-900/40 border border-gray-800 rounded-xl ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-800">
          <div>
            {title && <h2 className="font-semibold">{title}</h2>}
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-gray-400 mt-1 max-w-3xl">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function NoAccess({ what }) {
  return (
    <div className="p-6 text-white">
      <div className="max-w-lg bg-gray-900/40 border border-gray-800 rounded-xl p-6 flex gap-3">
        <Lock className="text-gray-400 shrink-0" size={20} />
        <p className="text-sm text-gray-300">Your role doesn't include access to {what}. Ask an administrator if you need it.</p>
      </div>
    </div>
  );
}

// Shown in mock mode: these screens exist only against the real backend.
export function BackendOnly({ what }) {
  return (
    <div className="p-6 text-white">
      <div className="max-w-lg bg-gray-900/40 border border-gray-800 rounded-xl p-6 flex gap-3">
        <PlugZap className="text-gray-400 shrink-0" size={20} />
        <p className="text-sm text-gray-300">{what} works with the real backend (VITE_BACKEND_FINANCE_MODE=true). It isn't available in the demo data mode.</p>
      </div>
    </div>
  );
}

// A small modal asking for a reason (and optionally more fields).
export function PromptDialog({ title, description, confirmLabel = "Confirm", onCancel, onConfirm, busy, children }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <form
        onSubmit={(e) => { e.preventDefault(); onConfirm(); }}
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4 text-white"
      >
        <h2 className="text-lg font-bold">{title}</h2>
        {description && <p className="text-sm text-gray-400">{description}</p>}
        {children}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={buttonClass.ghost}>Cancel</button>
          <button type="submit" disabled={busy} className={buttonClass.primary}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
