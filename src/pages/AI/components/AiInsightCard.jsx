import { useState } from "react";
import {
  ThumbsUp, ThumbsDown, AlertOctagon, EyeOff, RotateCcw, ChevronRight, FileSearch,
} from "lucide-react";
import { INSIGHT_PRIORITY_META, CONFIDENCE_META } from "../aiConfig";
import { FEEDBACK_REASONS } from "../aiTypes";

const MODULE_LABELS = { sales: "Sales", activities: "Activities", "data-quality": "Data Quality", contracts: "Contracts" };

function PriorityBadge({ priority }) {
  const meta = INSIGHT_PRIORITY_META[priority] || INSIGHT_PRIORITY_META.Informational;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${meta.className}`}>
      <span className="font-semibold">{priority}</span>
      <span className="text-[10px] opacity-80">· {meta.description}</span>
    </span>
  );
}

function ConfidenceBadge({ confidence }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-full text-xs border ${CONFIDENCE_META[confidence.level] || CONFIDENCE_META["Insufficient Data"]}`}
      title={confidence.explanation}
    >
      {confidence.level}
    </span>
  );
}

export default function AiInsightCard({
  insight, dismissed, feedback, canExecuteActions, onOpenEvidence, onOpenAction, onFeedback, onDismiss, onRestore,
}) {
  const [showReasonFor, setShowReasonFor] = useState(null); // "not_helpful" | "incorrect" | null

  const submitNegativeFeedback = (state, reason) => {
    onFeedback(insight.id, { state, reason: reason || null });
    setShowReasonFor(null);
  };

  return (
    <article
      aria-labelledby={`insight-title-${insight.id}`}
      className={`bg-gray-900/40 border border-gray-800 rounded-2xl p-5 ${dismissed ? "opacity-50" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <PriorityBadge priority={insight.priority} />
        <span className="text-xs text-gray-500">{MODULE_LABELS[insight.module] || insight.module}</span>
        <ConfidenceBadge confidence={insight.confidence} />
        {insight.dataRange && <span className="text-xs text-gray-600">· {insight.dataRange}</span>}
      </div>

      <h3 id={`insight-title-${insight.id}`} className="font-semibold text-white mb-1">{insight.title}</h3>
      <p className="text-sm text-gray-300 mb-2">{insight.summary}</p>

      <details className="mb-3 group">
        <summary className="text-xs text-blue-400 hover:underline cursor-pointer select-none">Why this matters</summary>
        <p className="text-xs text-gray-400 mt-1.5">{insight.explanation}</p>
        <p className="text-xs text-gray-500 mt-1">
          Confidence: <span className="font-medium text-gray-300">{insight.confidence.level}</span> — {insight.confidence.explanation}
        </p>
      </details>

      <div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-gray-500">
        <span>{insight.affectedRecordIds.length} affected record{insight.affectedRecordIds.length === 1 ? "" : "s"}</span>
        <button onClick={() => onOpenEvidence(insight)} className="inline-flex items-center gap-1 text-blue-400 hover:underline">
          <FileSearch className="h-3.5 w-3.5" /> {insight.evidence.length > 0 ? `View evidence (${insight.evidence.length})` : "View calculation"}
        </button>
      </div>

      {insight.suggestedActions.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {insight.suggestedActions.map((action) => (
            // Always clickable — a role that can't execute (Auditor/Checker)
            // can still open the preview to see what would be suggested; the
            // Confirm button inside the preview is what's actually gated.
            <button
              key={action.id}
              onClick={() => onOpenAction(insight, action)}
              title={!canExecuteActions ? "Your role can view this suggestion but cannot confirm actions." : undefined}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                canExecuteActions
                  ? "border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
                  : "border-gray-700 bg-gray-800/40 text-gray-400 hover:bg-gray-800"
              }`}
            >
              {action.label} <ChevronRight className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-800">
        <span className="text-xs text-gray-500 mr-1">Feedback:</span>
        <button
          onClick={() => submitNegativeFeedback("helpful")}
          aria-pressed={feedback?.state === "helpful"}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs ${feedback?.state === "helpful" ? "bg-emerald-500/15 text-emerald-300" : "text-gray-400 hover:bg-gray-800"}`}
        >
          <ThumbsUp className="h-3.5 w-3.5" /> Helpful
        </button>
        <button
          onClick={() => setShowReasonFor(showReasonFor === "not_helpful" ? null : "not_helpful")}
          aria-pressed={feedback?.state === "not_helpful"}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs ${feedback?.state === "not_helpful" ? "bg-amber-500/15 text-amber-300" : "text-gray-400 hover:bg-gray-800"}`}
        >
          <ThumbsDown className="h-3.5 w-3.5" /> Not Helpful
        </button>
        <button
          onClick={() => setShowReasonFor(showReasonFor === "incorrect" ? null : "incorrect")}
          aria-pressed={feedback?.state === "incorrect"}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs ${feedback?.state === "incorrect" ? "bg-red-500/15 text-red-300" : "text-gray-400 hover:bg-gray-800"}`}
        >
          <AlertOctagon className="h-3.5 w-3.5" /> Incorrect
        </button>
        <span className="flex-1" />
        {dismissed ? (
          <button onClick={() => onRestore(insight.id)} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-400 hover:bg-gray-800">
            <RotateCcw className="h-3.5 w-3.5" /> Restore
          </button>
        ) : (
          <button onClick={() => onDismiss(insight.id)} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-400 hover:bg-gray-800">
            <EyeOff className="h-3.5 w-3.5" /> Dismiss
          </button>
        )}
      </div>

      {showReasonFor && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/60 p-3">
          <span className="text-xs text-gray-400">Reason (optional):</span>
          {FEEDBACK_REASONS.map((reason) => (
            <button
              key={reason}
              onClick={() => submitNegativeFeedback(showReasonFor, reason)}
              className="px-2 py-1 rounded-md text-xs border border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              {reason}
            </button>
          ))}
          <button onClick={() => submitNegativeFeedback(showReasonFor)} className="px-2 py-1 rounded-md text-xs text-gray-500 hover:underline">
            Skip
          </button>
        </div>
      )}
    </article>
  );
}
