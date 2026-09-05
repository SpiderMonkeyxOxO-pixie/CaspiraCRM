import { X, ShieldAlert } from "lucide-react";
import useFocusTrap from "../../hooks/useFocusTrap";

// Shared "sensitive action" confirmation dialog for the Integration Center.
// Every action that must never happen automatically (escalate a ticket,
// remove a suppression entry, merge a customer identity, close a ticket,
// reply to a review, etc.) routes through this ONE component rather than
// each page inventing its own confirmation UI — first built for Customer
// Support and Communication Integrations (Phase 3), reusable by any future
// Phase 2 UI work too.
//
// `details` is a flat array of { label, value } rows rendered in order —
// callers decide which of trigger/current-state/proposed-change/required
// permission/required approver/affected users/customer impact apply to
// their specific action, so this stays a plain contract rather than a rigid
// enumerated prop.
export default function ActionPreviewModal({
  title,
  actionLabel,
  details = [],
  requiresReason = false,
  reason,
  onReasonChange,
  reasonLabel = "Reason",
  confirmLabel = "Confirm",
  confirmDisabled = false,
  onConfirm,
  onCancel,
  previewNotice = "This action updates frontend preview state only. No provider was contacted.",
  children,
}) {
  const dialogRef = useFocusTrap(true, onCancel);
  const canConfirm = !confirmDisabled && (!requiresReason || !!reason?.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-preview-title"
        className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-amber-400" aria-hidden="true" />
            <h2 id="action-preview-title" className="text-lg font-semibold text-white">{title}</h2>
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-4">
          {actionLabel && (
            <p className="text-sm text-gray-300">
              Requested action: <span className="font-medium text-white">{actionLabel}</span>
            </p>
          )}

          {details.length > 0 && (
            <dl className="space-y-2 text-sm">
              {details.map((d) => (
                <div key={d.label} className="flex flex-col gap-0.5 border-b border-gray-800/60 pb-2 last:border-0">
                  <dt className="text-gray-500 text-xs uppercase tracking-wide">{d.label}</dt>
                  <dd className="text-gray-200">{d.value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          )}

          {children}

          {requiresReason && (
            <div>
              <label htmlFor="action-preview-reason" className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                {reasonLabel} <span className="text-red-400">(required)</span>
              </label>
              <textarea
                id="action-preview-reason"
                value={reason || ""}
                onChange={(e) => onReasonChange?.(e.target.value)}
                rows={3}
                className="w-full bg-gray-900/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                placeholder="Explain why this action is being taken..."
              />
            </div>
          )}

          <p className="text-xs text-gray-500 border-t border-gray-800 pt-3">{previewNotice}</p>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-800">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-lg text-sm text-gray-300 border border-gray-700 hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className="px-3 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
