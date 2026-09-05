import { useNavigate } from "react-router-dom";
import { formatByCurrency } from "../Deals/dealUtils";

// Forecast is deliberately visually distinct from "Deals Won" — it previews
// what COULD close, never confirmed revenue.
export default function ForecastSection({ buckets }) {
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-sm">Forecast — Expected Close</h2>
        <span className="text-[11px] text-gray-500">Projected, not confirmed revenue</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2">
        {buckets.map((b) => <ForecastCard key={b.key} bucket={b} />)}
      </div>
    </div>
  );
}

function ForecastCard({ bucket }) {
  const navigate = useNavigate();
  const isOverdue = bucket.key === "overdue";
  const query = new URLSearchParams(bucket.linkParams).toString();
  return (
    <button
      onClick={() => navigate(`/crm/deals?${query}`)}
      className={`text-left rounded-lg border p-3 hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isOverdue ? "border-red-800/50 bg-red-900/10" : "border-gray-800 bg-gray-800/30"}`}
    >
      <p className={`text-xs uppercase mb-1 ${isOverdue ? "text-red-400" : "text-gray-400"}`}>{bucket.label}</p>
      <p className="text-lg font-bold">{bucket.count}</p>
      <p className="text-xs text-gray-400 truncate" title={formatByCurrency(bucket.valueByCurrency)}>{formatByCurrency(bucket.valueByCurrency)}</p>
      <p className="text-[11px] text-gray-500 truncate">Weighted {formatByCurrency(bucket.weightedByCurrency)}</p>
    </button>
  );
}
