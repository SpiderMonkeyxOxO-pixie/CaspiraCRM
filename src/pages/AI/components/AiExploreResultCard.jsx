import { FlaskConical, AlertTriangle } from "lucide-react";
import ChatInsightAttachment from "./ChatInsightAttachment";

// Deliberately NOT a chat bubble — Explore Mode findings are a real AI
// model's unverified reasoning over raw records, and must stay visually and
// structurally distinct from both a deterministic Copilot answer and a
// verified Overview insight so they can never be mistaken for either. The
// backend's disclaimer is always shown, never summarized away.
export default function AiExploreResultCard({ run, dismissedIds, feedbackByInsightId, canExecute, onOpenEvidence, onOpenAction, onFeedback, onDismiss, onRestore }) {
  return (
    <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <FlaskConical className="h-4 w-4 text-purple-300 shrink-0" />
        <p className="text-xs font-semibold text-purple-300 uppercase tracking-wide">AI Exploration — Unverified</p>
        {run.provider && <span className="text-[10px] text-gray-500">{run.provider.label} ({run.provider.model})</span>}
      </div>
      {run.question && <p className="text-sm text-gray-300 mb-2">Q: {run.question}</p>}
      <p className="text-xs text-gray-400 mb-3">{run.disclaimer}</p>
      {run.truncated && (
        <div className="flex items-start gap-1.5 text-xs text-amber-300 mb-3">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>Some records were left out of this exploration to stay within size limits — results may be incomplete.</span>
        </div>
      )}
      {run.insights.length === 0 ? (
        <p className="text-sm text-gray-500">No findings were returned for this exploration.</p>
      ) : (
        <div className="space-y-2">
          {run.insights.map((insight) => (
            <ChatInsightAttachment
              key={insight.id}
              insight={insight}
              dismissed={dismissedIds.includes(insight.id)}
              feedback={feedbackByInsightId[insight.id]}
              canExecute={canExecute}
              onOpenEvidence={onOpenEvidence}
              onOpenAction={onOpenAction}
              onFeedback={onFeedback}
              onDismiss={onDismiss}
              onRestore={onRestore}
            />
          ))}
        </div>
      )}
    </div>
  );
}
