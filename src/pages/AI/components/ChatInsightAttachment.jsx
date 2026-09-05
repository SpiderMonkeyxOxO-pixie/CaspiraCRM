import { ThumbsUp, ThumbsDown, EyeOff, RotateCcw, FileSearch, ChevronRight } from "lucide-react";
import { INSIGHT_PRIORITY_META, CONFIDENCE_META } from "../aiConfig";

const MODULE_LABELS = { sales: "Sales", activities: "Activities", "data-quality": "Data Quality", contracts: "Contracts" };

// Shared by AiCopilot.jsx (a deterministic answer's attached insight) and
// AiExploreResultCard.jsx (a real AI model's finding, adapted into the same
// AIInsight shape by aiExploreEngine.js's findingToPseudoInsight) — both are
// just AIInsight objects by the time they reach here, so one compact card
// renders either.
export default function ChatInsightAttachment({ insight, dismissed, feedback, canExecute, onOpenEvidence, onOpenAction, onFeedback, onDismiss, onRestore }) {
  const meta = INSIGHT_PRIORITY_META[insight.priority] || INSIGHT_PRIORITY_META.Informational;
  return (
    <div className={`mt-2 max-w-md rounded-xl border border-gray-800 bg-gray-900/60 p-3.5 ${dismissed ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] border font-medium ${meta.className}`}>{insight.priority}</span>
        <span className="text-[10px] text-gray-500">{MODULE_LABELS[insight.module] || insight.module}</span>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] border ${CONFIDENCE_META[insight.confidence.level] || CONFIDENCE_META["Insufficient Data"]}`}
          title={insight.confidence.explanation}
        >
          {insight.confidence.level}
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-2">{insight.affectedRecordIds.length} affected record{insight.affectedRecordIds.length === 1 ? "" : "s"}</p>

      <button onClick={() => onOpenEvidence(insight)} className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline mb-2">
        <FileSearch className="h-3 w-3" /> {insight.evidence.length > 0 ? `View evidence (${insight.evidence.length})` : "View calculation"}
      </button>

      {insight.suggestedActions.length > 0 && (
        <button
          onClick={() => onOpenAction(insight, insight.suggestedActions[0])}
          title={!canExecute ? "Your role can view this suggestion but cannot confirm actions." : undefined}
          className={`w-full flex items-center justify-between gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium mb-2.5 transition-colors ${
            canExecute ? "border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20" : "border-gray-700 bg-gray-800/40 text-gray-400 hover:bg-gray-800"
          }`}
        >
          <span className="truncate">{insight.suggestedActions[0].label}</span>
          <ChevronRight className="h-3 w-3 shrink-0" />
        </button>
      )}

      <div className="flex items-center gap-1 pt-2 border-t border-gray-800">
        <button onClick={() => onFeedback(insight.id, { state: "helpful", reason: null })} aria-pressed={feedback?.state === "helpful"} aria-label="Helpful" title="Helpful"
          className={`p-1 rounded ${feedback?.state === "helpful" ? "bg-emerald-500/15 text-emerald-300" : "text-gray-500 hover:bg-gray-800"}`}>
          <ThumbsUp className="h-3 w-3" />
        </button>
        <button onClick={() => onFeedback(insight.id, { state: "not_helpful", reason: null })} aria-pressed={feedback?.state === "not_helpful"} aria-label="Not Helpful" title="Not Helpful"
          className={`p-1 rounded ${feedback?.state === "not_helpful" ? "bg-amber-500/15 text-amber-300" : "text-gray-500 hover:bg-gray-800"}`}>
          <ThumbsDown className="h-3 w-3" />
        </button>
        <span className="flex-1" />
        {dismissed ? (
          <button onClick={() => onRestore(insight.id)} aria-label="Restore" title="Restore" className="p-1 rounded text-gray-500 hover:bg-gray-800"><RotateCcw className="h-3 w-3" /></button>
        ) : (
          <button onClick={() => onDismiss(insight.id)} aria-label="Dismiss" title="Dismiss" className="p-1 rounded text-gray-500 hover:bg-gray-800"><EyeOff className="h-3 w-3" /></button>
        )}
      </div>
    </div>
  );
}
