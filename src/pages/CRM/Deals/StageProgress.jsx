import { useState } from "react";
import { useDispatch } from "react-redux";
import { Check, Clock } from "lucide-react";
import { changeDealStage, DEAL_STAGES, DEAL_STAGE_PROBABILITY, DEAL_STAGE_RECOMMENDATIONS } from "../../../redux/crm/dealsSlice";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney, formatDuration, timeInCurrentStage } from "./dealUtils";
import { StageBadge } from "./DealBadges";

// Discovery → Qualified → Proposal → Negotiation → Approval → Won. Outcome
// stages (Lost/Cancelled/On Hold) are shown as a plain badge instead, since
// they're not part of the ordinary open-stage sequence.
export default function StageProgress({ deal, onChanged }) {
  const dispatch = useDispatch();
  const [target, setTarget] = useState(null);
  const currentIndex = DEAL_STAGES.indexOf(deal.stage);
  const isOutcome = currentIndex === -1;
  const lastEntry = deal.stageHistory[deal.stageHistory.length - 1];
  const canChange = deal.status === "Open";

  return (
    <div>
      <div className="hidden sm:flex items-center gap-1 flex-wrap" role="list" aria-label="Deal stage progress">
        {DEAL_STAGES.map((stage, i) => {
          const completed = !isOutcome && i < currentIndex;
          const current = !isOutcome && i === currentIndex;
          const clickable = canChange && stage !== deal.stage;
          return (
            <div key={stage} className="flex items-center gap-1" role="listitem">
              <button
                type="button"
                onClick={() => clickable && setTarget(stage)}
                disabled={!clickable}
                title={`${stage} — ${DEAL_STAGE_PROBABILITY[stage]}% probability`}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition
                  ${current ? "bg-blue-600/20 text-blue-300 border-blue-500/50" : completed ? "bg-emerald-600/15 text-emerald-300 border-emerald-500/30" : "bg-gray-800/60 text-gray-500 border-gray-700"}
                  ${clickable ? "hover:border-gray-500 cursor-pointer" : "cursor-default"}`}
              >
                {completed && <Check size={12} />}
                {stage}
                <span className="opacity-70">{DEAL_STAGE_PROBABILITY[stage]}%</span>
              </button>
              {i < DEAL_STAGES.length - 1 && <span className="text-gray-700">→</span>}
            </div>
          );
        })}
        {isOutcome && <StageBadge stage={deal.stage} />}
      </div>

      <div className="sm:hidden">
        <label htmlFor="stage-select-mobile" className="sr-only">Deal stage</label>
        <select
          id="stage-select-mobile"
          value={deal.stage}
          disabled={!canChange}
          onChange={(e) => setTarget(e.target.value)}
          className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm disabled:opacity-60"
        >
          {[...DEAL_STAGES, ...(isOutcome ? [deal.stage] : [])].map((s) => (
            <option key={s} value={s}>{s} — {DEAL_STAGE_PROBABILITY[s] ?? 0}%</option>
          ))}
        </select>
      </div>

      <p className="text-xs text-gray-500 mt-2 flex items-center gap-1.5 flex-wrap">
        <Clock size={12} /> {formatDuration(timeInCurrentStage(deal))} in {deal.stage}
        {lastEntry && <span>· Last changed {new Date(lastEntry.at).toLocaleDateString()} by {lastEntry.changedBy}</span>}
      </p>

      {target && (
        <StageChangeModal
          deal={deal}
          targetStage={target}
          onClose={() => setTarget(null)}
          onConfirm={async (note) => {
            const result = await dispatch(changeDealStage({ id: deal._id, stage: target, note }));
            setTarget(null);
            if (changeDealStage.fulfilled.match(result)) onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function missingForStage(deal, targetStage) {
  const missing = [];
  if (targetStage === "Qualified") {
    if (!deal.companyId) missing.push("Company");
    if (!deal.primaryContactId) missing.push("Primary contact");
    if (!deal.value) missing.push("Estimated value");
    if (!deal.ownerId) missing.push("Owner");
  } else if (targetStage === "Proposal") {
    if (!deal.lineItems?.length) missing.push("At least one product or service");
    if (!deal.expectedClosingDate) missing.push("Expected closing date");
    if (!deal.nextAction) missing.push("Next action");
  } else if (targetStage === "Negotiation") {
    if (!deal.quotes?.length) missing.push("Proposal information (e.g. a quote)");
    if (!deal.contactRoles?.some((r) => r.role === "Decision Maker")) missing.push("Decision-maker identified");
    if (!deal.description) missing.push("Known concerns documented");
  } else if (targetStage === "Approval") {
    if (!deal.value) missing.push("Final value confirmed");
    if (!deal.description) missing.push("Commercial summary");
    if (!deal.contactRoles?.length) missing.push("Approver identified");
  }
  return missing;
}

// Exported so other routes (e.g. Pipeline's drag-and-drop) can reuse the
// exact same stage-change confirmation instead of building a second one.
export function StageChangeModal({ deal, companyName, targetStage, onClose, onConfirm }) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const containerRef = useFocusTrap(true, onClose);
  const newProbability = DEAL_STAGE_PROBABILITY[targetStage] ?? deal.probability;
  const newWeighted = Math.round((deal.value || 0) * (newProbability / 100));
  const recommendations = DEAL_STAGE_RECOMMENDATIONS[targetStage] || [];
  const missing = missingForStage(deal, targetStage);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    await onConfirm(note.trim() || undefined);
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Change Deal Stage" onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-bold">Change Stage</h2>
        <p className="text-sm text-gray-400 -mt-2 truncate" title={deal.name}>
          {deal.name}{companyName ? ` · ${companyName}` : ""}
        </p>
        <div className="flex items-center justify-between bg-gray-800/40 rounded-lg p-3 text-sm">
          <div><p className="text-xs text-gray-500">Current</p><p className="font-medium">{deal.stage}</p></div>
          <span className="text-gray-600">→</span>
          <div className="text-right"><p className="text-xs text-gray-500">Proposed</p><p className="font-medium text-blue-300">{targetStage}</p></div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-gray-800/40 rounded-lg p-3"><p className="text-xs text-gray-500">Updated Probability</p><p className="font-semibold">{newProbability}%</p></div>
          <div className="bg-gray-800/40 rounded-lg p-3"><p className="text-xs text-gray-500">Updated Weighted Value</p><p className="font-semibold">{formatMoney(newWeighted, deal.currency)}</p></div>
        </div>
        {recommendations.length > 0 && (
          <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200">
            <p className="font-medium mb-1">Recommended before moving to {targetStage}:</p>
            <ul className="list-disc list-inside space-y-0.5">{recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
            {missing.length > 0 && <p className="mt-2 text-amber-300">Currently missing: {missing.join(", ")}</p>}
          </div>
        )}
        <div>
          <label htmlFor="stage-note" className="block text-sm mb-1 text-gray-300">Note (optional)</label>
          <textarea id="stage-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        </div>
        <p className="text-[11px] text-gray-500">Frontend preview only — no backend stage enforcement occurs.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">
            {submitting ? "Updating..." : `Confirm Move to ${targetStage}`}
          </button>
        </div>
      </form>
    </div>
  );
}
