import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ShieldAlert } from "lucide-react";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";
import * as ai from "../../../Helpers/backendAiClient";

// Backend mode (VITE_BACKEND_AI_MODE): an AI suggestion becomes a governed
// action proposal. Nothing changes until the person confirms; some actions
// also need a different approver; the CRM's own rules then apply it, and the
// result is reported only after they confirm it.
const GOVERNED = {
  create_follow_up: "create_follow_up", schedule_meeting: "schedule_meeting", request_missing_information: "request_missing_information",
  assign_owner: "assign_owner", update_expected_closing_date: "update_expected_close_date", add_next_action: "add_next_action",
  create_deal_from_lead: "create_deal",
};
const NAVIGATE = { start_renewal_review: (id) => `/sales/contracts/${id}`, open_affected_records: (id) => `/crm/deals/${id}` };
const TARGETS = ["Deal", "Lead", "Contact", "Company"];

export default function GovernedActionDialog({ insight, action, canExecute, onClose, onApplied }) {
  const navigate = useNavigate();
  const containerRef = useFocusTrap(!!action, onClose);
  const [value, setValue] = useState("");
  const [proposal, setProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!action) return null;

  const governedType = GOVERNED[action.type];
  const targetType = TARGETS.includes(action.affectedRecordType) ? action.affectedRecordType : null;
  const needsValue = ["assign_owner", "update_expected_closing_date", "add_next_action"].includes(action.type);
  const unsupported = action.type === "review_duplicate"
    ? "Merging duplicates is never done through AI. Open Duplicates review to decide it yourself."
    : !governedType && !NAVIGATE[action.type] ? "This suggestion can't be turned into an action."
      : governedType && !targetType ? `AI actions on a ${action.affectedRecordType} aren't available yet — open the record to act on it.` : null;

  const step = async (fn) => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(ai.aiErrorMessage(e)); return null; } finally { setBusy(false); }
  };
  const prepare = () => step(async () => {
    const proposedValues = {
      ...(action.type === "assign_owner" && { ownerMembershipId: value }),
      ...(action.type === "update_expected_closing_date" && { expectedCloseDate: value }),
      ...(action.type === "add_next_action" && { nextAction: value }),
      ...(["create_follow_up", "schedule_meeting", "request_missing_information"].includes(action.type) && { subject: action.label }),
    };
    const out = await ai.previewAction({ actionType: governedType, targetType, targetId: action.affectedRecordId, proposedValues, reason: action.reason || insight?.title, source: "Model", evidence: (insight?.evidence || []).slice(0, 10) });
    setProposal(out.action);
  });
  const confirm = () => step(async () => {
    const out = await ai.confirmAction(proposal._id);
    setProposal(out.action);
    if (out.action.status === "Executed") onApplied?.({ id: out.action._id, insightId: insight?.id, actionType: action.type, label: action.label, summary: `${out.action.label} applied to ${targetType} ${action.affectedRecordId}.`, appliedAt: new Date().toISOString(), undo: null });
  });
  const undo = () => step(async () => setProposal((await ai.undoAction(proposal._id)).action));

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-labelledby="governed-action-title" onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-gray-800 bg-[#0b0f19] p-6 shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">AI suggestion — needs your confirmation</p>
            <h2 id="governed-action-title" className="text-lg font-bold text-white">{action.label}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-300"><X size={18} /></button>
        </div>

        {unsupported ? (
          <p className="text-sm text-amber-300">{unsupported}</p>
        ) : NAVIGATE[action.type] && !governedType ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-300">This suggestion opens the record for you to review — nothing is changed.</p>
            <button onClick={() => { onClose(); navigate(NAVIGATE[action.type](action.affectedRecordId)); }} className="px-4 py-2 rounded-lg bg-blue-600 text-sm text-white">Open record</button>
          </div>
        ) : !proposal ? (
          <div className="space-y-3 text-sm">
            <p><span className="text-gray-500">Reason:</span> <span className="text-gray-200">{action.reason}</span></p>
            <p><span className="text-gray-500">Record:</span> <span className="text-gray-200">{targetType} — {action.affectedRecordId}</span></p>
            {action.type === "assign_owner" && (
              <label className="block text-xs text-gray-400">New owner
                <select value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Select a team member…</option>{CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role ? ` — ${m.role}` : ""}</option>)}
                </select>
              </label>
            )}
            {action.type === "update_expected_closing_date" && <label className="block text-xs text-gray-400">New expected close date<input type="date" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" /></label>}
            {action.type === "add_next_action" && <label className="block text-xs text-gray-400">Next action<input type="text" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" /></label>}
            {!canExecute && <p className="flex items-start gap-2 text-xs text-amber-300"><ShieldAlert className="h-4 w-4 shrink-0" /> Your role can review this suggestion but can't confirm actions.</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300">Cancel</button>
              <button onClick={prepare} disabled={busy || !canExecute || (needsValue && !value)} className="px-4 py-2 rounded-lg bg-blue-600 text-sm text-white disabled:opacity-40">Prepare action</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm" aria-live="polite">
            <p className="text-gray-300">{proposal.impact}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><p className="text-gray-500">Now</p><code className="text-gray-300 break-all">{JSON.stringify(proposal.currentValues)}</code></div>
              <div><p className="text-gray-500">Proposed</p><code className="text-gray-300 break-all">{JSON.stringify(proposal.proposedValues)}</code></div>
            </div>
            <p className="text-xs text-gray-500">Needs {proposal.requiredPermission}{proposal.requiredApprover ? ` · then ${proposal.requiredApprover}` : ""} · expires {new Date(proposal.expiresAt).toLocaleString()}</p>
            <p className="text-sm">Status: <span className="text-white">{proposal.status}</span></p>
            {proposal.status === "Awaiting Approval" && <p className="text-xs text-amber-300">Sent for approval. It runs only after someone else approves it.</p>}
            {proposal.status === "Failed" && <p className="text-xs text-red-300">{proposal.errorMessage}</p>}
            <div className="flex justify-end gap-2">
              {proposal.status === "Awaiting Confirmation" && <button onClick={() => step(async () => setProposal((await ai.cancelAction(proposal._id)).action))} disabled={busy} className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300">Cancel proposal</button>}
              {proposal.status === "Awaiting Confirmation" && <button onClick={confirm} disabled={busy} className="px-4 py-2 rounded-lg bg-blue-600 text-sm text-white disabled:opacity-40">Confirm</button>}
              {proposal.undoAvailable && <button onClick={undo} disabled={busy} className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300">Undo</button>}
              {!["Awaiting Confirmation"].includes(proposal.status) && <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300">Close</button>}
            </div>
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
