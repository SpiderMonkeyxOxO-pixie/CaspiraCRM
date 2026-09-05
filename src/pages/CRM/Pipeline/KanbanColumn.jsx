import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { formatMoney } from "../Deals/dealUtils";
import { DEAL_STAGE_PROBABILITY, DEAL_STAGE_COLORS } from "../../../redux/crm/dealsSlice";

export default function KanbanColumn({
  stage, deals, currency, collapsed, onToggleCollapse, onAddDeal, wipLimit,
  onDragOver, onDrop, onDragLeave, isDropTarget, showWeighted, showTotals, renderBody,
}) {
  const totalValue = deals.reduce((s, d) => s + (d.value || 0), 0);
  const weightedValue = deals.reduce((s, d) => s + (d.weightedValue || 0), 0);
  const color = DEAL_STAGE_COLORS[stage];
  const overLimit = wipLimit && deals.length > wipLimit;

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        aria-label={`Expand ${stage} column (${deals.length} deals)`}
        className="shrink-0 w-11 bg-gray-900/40 border border-gray-800 hover:border-gray-700 rounded-xl flex flex-col items-center py-3 gap-2"
      >
        <ChevronRight size={14} className="text-gray-400" />
        <span className="w-2 h-2 rounded-full" style={{ background: color }} aria-hidden="true" />
        <span className="[writing-mode:vertical-rl] text-xs font-medium text-gray-300 whitespace-nowrap">{stage}</span>
        <span className="text-[10px] text-gray-500">{deals.length}</span>
      </button>
    );
  }

  return (
    <div
      className={`shrink-0 w-72 flex flex-col bg-gray-900/40 border rounded-xl transition-colors ${isDropTarget ? "border-blue-500 ring-2 ring-blue-500/30" : "border-gray-800"}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      role="region"
      aria-label={`${stage} column, ${deals.length} deal${deals.length === 1 ? "" : "s"}, ${DEAL_STAGE_PROBABILITY[stage]} percent probability`}
    >
      <div className="px-3 py-2.5 border-b border-gray-800">
        <div className="flex items-center justify-between mb-1 gap-1">
          <span className="flex items-center gap-1.5 font-medium text-sm min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} aria-hidden="true" />
            <span className="truncate">{stage}</span>
            <span className="text-xs text-gray-500 font-normal shrink-0">({deals.length}{wipLimit ? `/${wipLimit}` : ""})</span>
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={onAddDeal} aria-label={`Add deal to ${stage}`} title="Add Deal" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white">
              <Plus size={14} />
            </button>
            <button onClick={onToggleCollapse} aria-label={`Collapse ${stage} column`} title="Collapse" className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white">
              <ChevronLeft size={14} />
            </button>
          </div>
        </div>
        {showTotals && (
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span title="Total stage value">{formatMoney(totalValue, currency)}</span>
            {showWeighted && <span title="Weighted stage value">W: {formatMoney(weightedValue, currency)}</span>}
            <span title="Stage probability">{DEAL_STAGE_PROBABILITY[stage]}%</span>
          </div>
        )}
        {overLimit && <p className="text-[11px] text-amber-400 mt-1">Over the {wipLimit}-deal work-in-progress limit</p>}
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-30 max-h-[calc(100vh-320px)]">
        {deals.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-xs text-gray-600 mb-2">No deals in {stage}</p>
            <button onClick={onAddDeal} className="text-xs text-blue-400 hover:underline">+ Add Deal</button>
          </div>
        ) : renderBody(deals)}
      </div>
    </div>
  );
}
