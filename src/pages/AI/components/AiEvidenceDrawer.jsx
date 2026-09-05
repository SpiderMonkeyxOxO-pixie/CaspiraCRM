import { Link } from "react-router-dom";
import { X, ExternalLink } from "lucide-react";
import useFocusTrap from "../../../hooks/useFocusTrap";

// The AI equivalent of "show your work": every number in the insight
// summary traces back to the calculation named here, the evidence records
// listed below, and the freshness/limitations of the data used.
export default function AiEvidenceDrawer({ insight, dataFreshness, onClose }) {
  const containerRef = useFocusTrap(!!insight, onClose);
  if (!insight) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/60" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-drawer-title"
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full sm:max-w-lg bg-[#0b0f19] border-l border-gray-800 overflow-y-auto"
      >
        <div className="sticky top-0 bg-[#0b0f19] border-b border-gray-800 p-5 flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Evidence</p>
            <h2 id="evidence-drawer-title" className="text-lg font-bold text-white">{insight.title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close evidence drawer" className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Insight summary</h3>
            <p className="text-sm text-gray-300">{insight.summary}</p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Calculation used</h3>
            <p className="text-sm text-gray-300">{insight.explanation}</p>
            <p className="text-xs text-gray-500 mt-1">Data range: {insight.dataRange || "Current records"}</p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Confidence explanation</h3>
            <p className="text-sm text-gray-300">
              <span className="font-medium">{insight.confidence.level}</span> — {insight.confidence.explanation}
            </p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Included / excluded records</h3>
            <p className="text-sm text-gray-300">
              {insight.affectedRecordIds.length} record{insight.affectedRecordIds.length === 1 ? "" : "s"} matched this calculation within your currently authorized scope.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Records outside your current role, view and filters were excluded before this calculation ran — they are never counted or shown here.
            </p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Supporting evidence</h3>
            {insight.evidence.length === 0 ? (
              <p className="text-sm text-gray-500">No individual records back this insight beyond the calculation above.</p>
            ) : (
              <ul className="space-y-3">
                {insight.evidence.map((e, i) => (
                  <li key={`${e.recordType}-${e.recordId}-${i}`} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs text-gray-500">{e.recordType}</p>
                        <p className="text-sm font-medium text-white">{e.recordLabel}</p>
                      </div>
                      {e.route ? (
                        <Link to={e.route} className="flex items-center gap-1 text-xs text-blue-400 hover:underline shrink-0">
                          Open <ExternalLink className="h-3 w-3" />
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-600 shrink-0" title="Your role does not have access to this record's route">Restricted view</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">
                      <span className="text-gray-500">{e.supportingField}:</span> {e.supportingValue}
                      {e.date && <span className="text-gray-600"> · {new Date(e.date).toLocaleDateString()}</span>}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{e.explanation}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Missing information</h3>
            <p className="text-sm text-gray-300">
              {insight.confidence.level === "High Confidence"
                ? "No missing information affects this calculation."
                : "Part of this calculation relies on a proxy signal (see the confidence explanation above) rather than a directly recorded field."}
            </p>
          </section>

          {dataFreshness && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Data freshness</h3>
              <p className="text-sm text-gray-300">
                Analysis generated {new Date(dataFreshness.generatedAt).toLocaleString()} from {dataFreshness.recordCount} records.
                {dataFreshness.latestRecordUpdatedAt && ` Most recent record change: ${new Date(dataFreshness.latestRecordUpdatedAt).toLocaleString()}.`}
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
