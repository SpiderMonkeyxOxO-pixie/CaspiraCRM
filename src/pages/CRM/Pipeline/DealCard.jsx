import { useEffect, useRef, useState } from "react";
import { GripVertical, MoreVertical, Building2, User, AlertTriangle, FileText, Package, Tag } from "lucide-react";
import { DealPriorityBadge, DealHealthBadge } from "../Deals/DealBadges";
import { formatMoney, formatDate } from "../Deals/dealUtils";
import { formatAgo } from "./pipelineUtils";
import { DEAL_STAGES } from "../../../redux/crm/dealsSlice";

function initials(name) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

const OPEN_STAGES = DEAL_STAGES.filter((s) => s !== "Won");

// The card's own "⋮" menu is the required keyboard/touch alternative to
// drag-and-drop — every stage move (and Won/Lost/Hold) it offers is reached
// through the same confirmation flow as a drag-and-drop move.
function MoveMenu({ deal, onMoveStage, onQuickOutcome }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Move ${deal.name} to a different stage`}
        aria-haspopup="menu" aria-expanded={open}
        className="p-0.5 rounded text-gray-500 hover:text-white hover:bg-gray-700 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-30 w-44 shadow-xl text-left">
          <p className="px-3 py-1 text-[10px] uppercase text-gray-500">Move to stage</p>
          {OPEN_STAGES.filter((s) => s !== deal.stage).map((s) => (
            <button key={s} role="menuitem" onClick={() => { onMoveStage(s); setOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">{s}</button>
          ))}
          <div className="border-t border-gray-800 my-1" />
          <button role="menuitem" onClick={() => { onQuickOutcome("won"); setOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 text-emerald-400">Mark Won</button>
          <button role="menuitem" onClick={() => { onQuickOutcome("lost"); setOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 text-red-400">Mark Lost</button>
          <button role="menuitem" onClick={() => { onQuickOutcome("hold"); setOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 text-orange-400">Put On Hold</button>
        </div>
      )}
    </div>
  );
}

// Deliberately doesn't put every field on the card — optional indicators are
// icon-only with a tooltip, and full detail lives in the preview drawer.
export default function DealCard({
  deal, company, primaryContact, lastActivityAt, riskReasons, density, visibleFields,
  draggable, onOpenPreview, onDragStart, onDragEnd, onKeyMove, onMoveStage, onQuickOutcome, isDragging,
}) {
  const overdueClose = deal.status === "Open" && deal.expectedClosingDate && new Date(deal.expectedClosingDate) < new Date();
  const compact = density === "compact";
  const warningCount = riskReasons?.length || 0;

  const label = `${deal.name}, ${company?.name || "no company"}, stage ${deal.stage}, ${formatMoney(deal.value, deal.currency)}` +
    (overdueClose ? ", closing date overdue" : "") + (warningCount ? `, ${warningCount} warning${warningCount === 1 ? "" : "s"}` : "");

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpenPreview(deal)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenPreview(deal); }
        else if (onKeyMove && e.key === "ArrowRight") { e.preventDefault(); onKeyMove(1); }
        else if (onKeyMove && e.key === "ArrowLeft") { e.preventDefault(); onKeyMove(-1); }
      }}
      className={`group bg-gray-800/60 border rounded-lg ${compact ? "p-2" : "p-3"} text-sm cursor-pointer select-none
        hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500
        ${isDragging ? "opacity-40" : ""} ${warningCount > 0 ? "border-amber-700/50" : "border-gray-700"}`}
    >
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <p className="font-medium leading-snug truncate" title={deal.name}>{deal.name}</p>
        <div className="flex items-center gap-0.5 shrink-0">
          {draggable && <GripVertical size={14} className="text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />}
          {(onMoveStage || onQuickOutcome) && <MoveMenu deal={deal} onMoveStage={onMoveStage} onQuickOutcome={onQuickOutcome} />}
        </div>
      </div>
      {company && <p className="text-xs text-gray-400 truncate flex items-center gap-1 mb-1.5"><Building2 size={11} aria-hidden="true" /> {company.name}</p>}
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold">{formatMoney(deal.value, deal.currency)}</span>
        <span className="text-xs text-gray-400">{deal.probability}%</span>
      </div>
      {!compact && (
        <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
          <span className={overdueClose ? "text-red-400 font-medium" : ""}>{formatDate(deal.expectedClosingDate)}{overdueClose ? " (overdue)" : ""}</span>
          <span title={`Owner: ${deal.ownerName || "Unassigned"}`} className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-[10px] font-semibold shrink-0">
            {deal.ownerName ? initials(deal.ownerName) : "—"}
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap mb-1">
        <DealHealthBadge health={deal.dealHealth} reason={deal.healthReason} />
        {warningCount > 0 && (
          <span title={riskReasons.join(" · ")} className="inline-flex items-center gap-1 text-[11px] text-amber-300">
            <AlertTriangle size={11} aria-hidden="true" /> {warningCount}
          </span>
        )}
      </div>
      {!compact && (deal.nextAction ? (
        <p className="text-xs text-gray-400 truncate" title={deal.nextAction}>→ {deal.nextAction}</p>
      ) : (
        <p className="text-xs text-amber-400">No next action set</p>
      ))}
      {!compact && <p className="text-[11px] text-gray-500 mt-1">Last activity: {formatAgo(lastActivityAt)}</p>}
      {!compact && (visibleFields?.primaryContact || visibleFields?.quoteAvailable || visibleFields?.productsCount || visibleFields?.priority || visibleFields?.tags) && (
        <div className="flex items-center gap-2 flex-wrap mt-1.5 pt-1.5 border-t border-gray-700/60">
          {visibleFields?.primaryContact && primaryContact && (
            <span title={`Primary contact: ${primaryContact.name}`} className="text-gray-500"><User size={12} aria-hidden="true" /></span>
          )}
          {visibleFields?.quoteAvailable && deal.quotes?.length > 0 && (
            <span title="A quote is available" className="text-gray-500"><FileText size={12} aria-hidden="true" /></span>
          )}
          {visibleFields?.productsCount && deal.lineItems?.length > 0 && (
            <span title={`${deal.lineItems.length} product/service line(s)`} className="flex items-center gap-0.5 text-gray-500 text-[10px]"><Package size={11} aria-hidden="true" /> {deal.lineItems.length}</span>
          )}
          {visibleFields?.priority && <DealPriorityBadge priority={deal.priority} />}
          {visibleFields?.tags && deal.tags?.length > 0 && (
            <span title={deal.tags.join(", ")} className="text-gray-500"><Tag size={12} aria-hidden="true" /></span>
          )}
        </div>
      )}
    </div>
  );
}
