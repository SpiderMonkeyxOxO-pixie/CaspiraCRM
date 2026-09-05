import { useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { X, ShieldAlert, Undo2 } from "lucide-react";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { updateDeal } from "../../../redux/crm/dealsSlice";
import { updateContract } from "../../../redux/sales/contractsSlice";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";
import { SENSITIVE_ACTION_TYPES } from "../aiTypes";

// Types the modal can apply directly with a single field change. Anything
// not in here (create_follow_up, schedule_meeting, create_deal_from_lead)
// hands off to a shared existing form instead — see onOpenForm.
const DIRECT_UPDATE_TYPES = ["assign_owner", "update_expected_closing_date", "add_next_action"];

export default function AiActionPreviewModal({ insight, action, canExecute, onClose, onApplied, onOpenForm }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const containerRef = useFocusTrap(!!action, onClose);
  const [fieldValue, setFieldValue] = useState(() => {
    if (action?.type === "assign_owner") return "";
    if (action?.type === "update_expected_closing_date") return "";
    if (action?.type === "add_next_action") return "";
    return "";
  });
  const [applied, setApplied] = useState(null); // { summary } once confirmed, for the "Undo" follow-up state

  if (!action) return null;

  const isSensitive = SENSITIVE_ACTION_TYPES.includes(action.type);
  const requiresForm = ["create_follow_up", "schedule_meeting", "create_deal_from_lead"].includes(action.type);
  const isNavigation = ["review_duplicate", "start_renewal_review", "open_affected_records"].includes(action.type);

  const handleConfirm = async () => {
    if (requiresForm) {
      onClose();
      if (action.type === "create_deal_from_lead") {
        onOpenForm("deal", { name: `${insight.title} — Deal`, ownerId: undefined });
      } else {
        onOpenForm("activity", {
          title: action.reason, type: action.type === "schedule_meeting" ? "Meeting" : "Follow-up",
          relatedRecordType: action.affectedRecordType, relatedRecordId: action.affectedRecordId,
        });
      }
      return;
    }

    if (isNavigation) {
      const routeByType = {
        review_duplicate: "/crm/duplicates",
        start_renewal_review: `/sales/contracts/${action.affectedRecordId}`,
        open_affected_records: `/crm/deals/${action.affectedRecordId}`,
      };
      onApplied({
        id: `${action.id}-${Date.now()}`, insightId: insight.id, actionType: action.type, label: action.label,
        summary: `Opened ${action.affectedRecordType} for review.`, appliedAt: new Date().toISOString(), undo: null,
      });
      onClose();
      navigate(routeByType[action.type]);
      return;
    }

    if (action.type === "request_missing_information") {
      onApplied({
        id: `${action.id}-${Date.now()}`, insightId: insight.id, actionType: action.type, label: action.label,
        summary: `Marked "${insight.title}" as information requested (session only — no notification was sent).`,
        appliedAt: new Date().toISOString(), undo: null,
      });
      setApplied({ summary: "Marked as information requested for this session." });
      return;
    }

    if (DIRECT_UPDATE_TYPES.includes(action.type)) {
      const previousValues = { ...action.currentValues };
      let changes = {};
      if (action.type === "assign_owner") changes = { ownerId: fieldValue };
      if (action.type === "update_expected_closing_date") changes = { expectedClosingDate: fieldValue ? new Date(fieldValue).toISOString() : null };
      if (action.type === "add_next_action") changes = { nextAction: fieldValue };

      const thunk = action.affectedRecordType === "Contract" ? updateContract : updateDeal;
      const result = await dispatch(thunk({ id: action.affectedRecordId, changes })).catch(() => null);
      if (!result || result.error) {
        setApplied({ summary: "Could not apply this change — it may have already been updated elsewhere.", failed: true });
        return;
      }
      onApplied({
        id: `${action.id}-${Date.now()}`, insightId: insight.id, actionType: action.type, label: action.label,
        summary: `${action.label} applied to ${action.affectedRecordType} ${action.affectedRecordId}.`,
        appliedAt: new Date().toISOString(),
        undo: { type: action.affectedRecordType === "Contract" ? "updateContract" : "updateDeal", recordId: action.affectedRecordId, previousValues },
      });
      setApplied({ summary: `${action.label} applied. You can undo this for the rest of this session.` });
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-preview-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-gray-800 bg-[#0b0f19] p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Suggested action preview</p>
            <h2 id="action-preview-title" className="text-lg font-bold text-white">{action.label}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        {!applied ? (
          <>
            <div className="space-y-3 text-sm mb-5">
              <p><span className="text-gray-500">Reason:</span> <span className="text-gray-200">{action.reason}</span></p>
              <p><span className="text-gray-500">Affected record:</span> <span className="text-gray-200">{action.affectedRecordType} — {action.affectedRecordId}</span></p>
              <p><span className="text-gray-500">Required approver:</span> <span className="text-gray-200">{action.requiredApprover}</span></p>
              {action.potentialImpact && <p><span className="text-gray-500">Potential impact:</span> <span className="text-gray-200">{action.potentialImpact}</span></p>}
            </div>

            {action.type === "assign_owner" && (
              <div className="mb-5">
                <label className="block text-xs text-gray-400 mb-1.5">Proposed owner</label>
                <select value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Select a team member...</option>
                  {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.role}</option>)}
                </select>
              </div>
            )}
            {action.type === "update_expected_closing_date" && (
              <div className="mb-5">
                <label className="block text-xs text-gray-400 mb-1.5">
                  Proposed expected closing date <span className="text-gray-600">(current: {action.currentValues.expectedClosingDate ? new Date(action.currentValues.expectedClosingDate).toLocaleDateString() : "not set"})</span>
                </label>
                <input type="date" value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            )}
            {action.type === "add_next_action" && (
              <div className="mb-5">
                <label className="block text-xs text-gray-400 mb-1.5">Proposed next action</label>
                <input type="text" value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} placeholder="e.g. Call to confirm budget" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            )}

            {(isSensitive || !canExecute) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300 mb-5">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {!canExecute
                    ? "Your role can review this suggestion but cannot confirm actions. An authorized teammate must complete this step."
                    : "This action requires human approval and will not be applied automatically."}
                </span>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-white/5">Cancel</button>
              <button
                onClick={handleConfirm}
                disabled={!canExecute || (DIRECT_UPDATE_TYPES.includes(action.type) && !fieldValue)}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 text-sm font-medium text-white hover:from-blue-500 hover:to-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirm
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-4">
            <p className={`text-sm mb-4 ${applied.failed ? "text-red-300" : "text-emerald-300"}`}>{applied.summary}</p>
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-white/5 inline-flex items-center gap-1.5">
              <Undo2 className="h-3.5 w-3.5" /> Close (Undo is available from Recent AI Actions)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
