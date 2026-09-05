import { ThumbsUp, ThumbsDown, EyeOff, RotateCcw, FileSearch, ChevronRight } from "lucide-react";
import { INSIGHT_PRIORITY_META, CONFIDENCE_META } from "../aiConfig";
import { INSIGHT_PRIORITIES } from "../aiTypes";

const MODULE_LABELS = { sales: "Sales", activities: "Activities", "data-quality": "Data Quality", contracts: "Contracts" };

// A read-only triage board: priority is a calculated value, so cards are
// never draggable between columns — this groups the same insights the List
// view shows for fast visual scanning, it doesn't let anyone reassign
// priority by hand.
function KanbanCard({ insight, dismissed, feedback, canExecuteActions, onOpenEvidence, onOpenAction, onFeedback, onDismiss, onRestore }) {
  return (
    <article
      aria-labelledby={`kanban-title-${insight.id}`}
      className={`rounded-xl border border-gray-800 bg-gray-900/60 p-3.5 ${dismissed ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-[10px] text-gray-500">{MODULE_LABELS[insight.module] || insight.module}</span>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] border ${CONFIDENCE_META[insight.confidence.level] || CONFIDENCE_META["Insufficient Data"]}`}
          title={insight.confidence.explanation}
        >
          {insight.confidence.level.replace(" Confidence", "")}
        </span>
      </div>

      <h4 id={`kanban-title-${insight.id}`} className="text-sm font-semibold text-white mb-1 leading-snug">{insight.title}</h4>
      <p className="text-xs text-gray-400 mb-2.5 leading-snug line-clamp-3">{insight.summary}</p>

      <button onClick={() => onOpenEvidence(insight)} className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline mb-2.5">
        <FileSearch className="h-3 w-3" /> {insight.affectedRecordIds.length} record{insight.affectedRecordIds.length === 1 ? "" : "s"} · evidence
      </button>

      {insight.suggestedActions.length > 0 && (
        <button
          onClick={() => onOpenAction(insight, insight.suggestedActions[0])}
          title={!canExecuteActions ? "Your role can view this suggestion but cannot confirm actions." : undefined}
          className={`w-full flex items-center justify-between gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium mb-2.5 transition-colors ${
            canExecuteActions
              ? "border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
              : "border-gray-700 bg-gray-800/40 text-gray-400 hover:bg-gray-800"
          }`}
        >
          <span className="truncate">{insight.suggestedActions[0].label}</span>
          <ChevronRight className="h-3 w-3 shrink-0" />
        </button>
      )}

      <div className="flex items-center gap-1 pt-2 border-t border-gray-800">
        <button
          onClick={() => onFeedback(insight.id, { state: "helpful", reason: null })}
          aria-pressed={feedback?.state === "helpful"}
          aria-label="Helpful"
          title="Helpful"
          className={`p-1 rounded ${feedback?.state === "helpful" ? "bg-emerald-500/15 text-emerald-300" : "text-gray-500 hover:bg-gray-800"}`}
        >
          <ThumbsUp className="h-3 w-3" />
        </button>
        <button
          onClick={() => onFeedback(insight.id, { state: "not_helpful", reason: null })}
          aria-pressed={feedback?.state === "not_helpful"}
          aria-label="Not Helpful"
          title="Not Helpful"
          className={`p-1 rounded ${feedback?.state === "not_helpful" ? "bg-amber-500/15 text-amber-300" : "text-gray-500 hover:bg-gray-800"}`}
        >
          <ThumbsDown className="h-3 w-3" />
        </button>
        <span className="flex-1" />
        {dismissed ? (
          <button onClick={() => onRestore(insight.id)} aria-label="Restore" title="Restore" className="p-1 rounded text-gray-500 hover:bg-gray-800">
            <RotateCcw className="h-3 w-3" />
          </button>
        ) : (
          <button onClick={() => onDismiss(insight.id)} aria-label="Dismiss" title="Dismiss" className="p-1 rounded text-gray-500 hover:bg-gray-800">
            <EyeOff className="h-3 w-3" />
          </button>
        )}
      </div>
    </article>
  );
}

export default function AiKanbanBoard({ insights, dismissedIds, feedbackByInsightId, canExecuteActions, onOpenEvidence, onOpenAction, onFeedback, onDismiss, onRestore }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-3 -mx-1 px-1" role="group" aria-label="Insights by priority">
      {INSIGHT_PRIORITIES.map((priority) => {
        const meta = INSIGHT_PRIORITY_META[priority];
        const columnInsights = insights.filter((i) => i.priority === priority);
        return (
          <div key={priority} className="w-72 shrink-0 flex flex-col">
            <div className={`flex items-center justify-between mb-3 px-3 py-2 rounded-lg border ${meta.className}`}>
              <span className="text-xs font-semibold">{priority}</span>
              <span className="text-xs font-normal opacity-80">{columnInsights.length}</span>
            </div>
            <div className="flex flex-col gap-3 min-h-[60px]">
              {columnInsights.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-6 border border-dashed border-gray-800 rounded-lg">No insights</p>
              ) : (
                columnInsights.map((insight) => (
                  <KanbanCard
                    key={insight.id}
                    insight={insight}
                    dismissed={dismissedIds.includes(insight.id)}
                    feedback={feedbackByInsightId[insight.id]}
                    canExecuteActions={canExecuteActions}
                    onOpenEvidence={onOpenEvidence}
                    onOpenAction={onOpenAction}
                    onFeedback={onFeedback}
                    onDismiss={onDismiss}
                    onRestore={onRestore}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
