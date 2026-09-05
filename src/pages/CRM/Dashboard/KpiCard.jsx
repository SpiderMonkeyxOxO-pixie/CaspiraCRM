import { HelpCircle, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Link } from "react-router-dom";

// One shared KPI card shape for the whole dashboard — every card gets a
// name, value, filter context, tooltip and (when real) a comparison, so no
// card fabricates a trend or repeats another card's number.
export default function KpiCard({ label, value, context, comparison, tooltip, to, valueClassName }) {
  const comparisonNode = comparison === null || comparison === undefined ? (
    <span className="text-gray-600">No comparison data</span>
  ) : (
    <span className={`flex items-center gap-1 ${comparison > 0 ? "text-emerald-400" : comparison < 0 ? "text-red-400" : "text-gray-400"}`}>
      {comparison > 0 ? <ArrowUp size={11} /> : comparison < 0 ? <ArrowDown size={11} /> : <Minus size={11} />}
      {Math.abs(comparison)}% vs previous period
    </span>
  );

  const content = (
    <div className={`bg-gray-900/40 border border-gray-800 rounded-xl p-4 h-full transition-colors ${to ? "hover:border-gray-700" : ""}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-xs text-gray-400 uppercase tracking-wide truncate">{label}</p>
        {tooltip && (
          <span title={tooltip} tabIndex={0} aria-label={`About ${label}: ${tooltip}`} className="text-gray-500 hover:text-gray-300 cursor-help shrink-0">
            <HelpCircle size={13} />
          </span>
        )}
      </div>
      <p className={`text-2xl font-bold ${valueClassName || ""}`}>{value}</p>
      {context && <p className="text-xs text-gray-500 mt-1 truncate" title={context}>{context}</p>}
      <p className="text-xs mt-1.5">{comparisonNode}</p>
    </div>
  );

  return to ? (
    <Link to={to} className="block h-full rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" aria-label={`${label}: ${value}. Open filtered view.`}>
      {content}
    </Link>
  ) : content;
}
