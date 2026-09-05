import { useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate, Link } from "react-router-dom";
import { X, ExternalLink, Pencil, PhoneCall, CalendarClock, Trophy, XCircle, PauseCircle } from "lucide-react";
import { fetchActivities } from "../../../redux/crm/activitiesSlice";
import useFocusTrap from "../../../hooks/useFocusTrap";
import DealFormModal from "../Deals/DealFormModal";
import StageProgress from "../Deals/StageProgress";
import { DealPriorityBadge, DealHealthBadge } from "../Deals/DealBadges";
import { MarkWonModal, MarkLostModal, PutOnHoldModal } from "../Deals/DealOutcomeModals";
import { formatMoney, formatDate } from "../Deals/dealUtils";
import ActivityFormModal from "../Activities/ActivityFormModal";
import { TypeIcon, StatusBadge } from "../Activities/ActivityBadges";

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{title}</p>
      {children}
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3 min-w-0 text-sm py-0.5">
      <dt className="text-gray-400 shrink-0">{label}</dt>
      <dd className="truncate text-right" title={typeof value === "string" ? value : undefined}>{value ?? "—"}</dd>
    </div>
  );
}

// The compact "at a glance + act" surface opened from a Kanban card — a
// deliberately smaller sibling of the full /crm/deals/[dealId] page, reusing
// the same underlying modals/actions rather than re-implementing them.
export default function DealPreviewDrawer({ deal, company, primaryContact, activities, onClose, onChanged }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const containerRef = useFocusTrap(true, onClose);
  const [action, setAction] = useState(null); // "edit" | "logActivity" | "followUp" | "won" | "lost" | "hold"
  const isOpen = deal.status === "Open";

  const recentActivities = [...activities].sort((a, b) => new Date(b.startAt || b.createdAt) - new Date(a.startAt || a.createdAt)).slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={`${deal.name} preview`}
        className="relative w-full sm:max-w-md h-full bg-gray-900 border-l border-gray-800 overflow-y-auto p-6 space-y-5 shadow-2xl">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-snug truncate" title={deal.name}>{deal.name}</h2>
            <p className="text-sm text-gray-400 truncate">
              {company ? <Link to={`/crm/companies/${company._id}`} className="hover:underline">{company.name}</Link> : "No company"}
              {primaryContact && <> · <Link to={`/crm/contacts/${primaryContact._id}`} className="hover:underline">{primaryContact.name}</Link></>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close preview"><X size={20} /></button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <DealHealthBadge health={deal.dealHealth} reason={deal.healthReason} showReason />
          <DealPriorityBadge priority={deal.priority} />
        </div>

        <Section title="Stage">
          <StageProgress deal={deal} onChanged={onChanged} />
        </Section>

        <Section title="Deal Summary">
          <dl className="space-y-0.5">
            <Row label="Value" value={formatMoney(deal.value, deal.currency)} />
            <Row label="Probability" value={`${deal.probability}%`} />
            <Row label="Weighted Value" value={formatMoney(deal.weightedValue, deal.currency)} />
            <Row label="Expected Close" value={formatDate(deal.expectedClosingDate)} />
            <Row label="Owner" value={deal.ownerName || "Unassigned"} />
          </dl>
        </Section>

        <Section title="Next Action">
          <p className="text-sm">{deal.nextAction || <span className="text-amber-400">No next action set</span>}</p>
        </Section>

        {deal.lineItems?.length > 0 && (
          <Section title="Products / Services">
            <ul className="space-y-1 text-sm">
              {deal.lineItems.map((li) => (
                <li key={li._id} className="flex justify-between text-gray-300">
                  <span className="truncate">{li.name} × {li.quantity}</span>
                  <span className="shrink-0">{formatMoney(li.lineTotal, deal.currency)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Recent Activities">
          {recentActivities.length === 0 ? (
            <p className="text-sm text-gray-500">No activities logged yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {recentActivities.map((a) => (
                <li key={a._id} className="flex items-center justify-between gap-2 bg-gray-800/40 rounded-lg px-2.5 py-1.5 text-sm">
                  <span className="flex items-center gap-1.5 min-w-0"><TypeIcon type={a.type} size={13} /> <span className="truncate">{a.title}</span></span>
                  <StatusBadge activity={a} status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Actions">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => navigate(`/crm/deals/${deal._id}`)} className="flex items-center justify-center gap-1.5 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
              <ExternalLink size={14} /> Open Full Deal
            </button>
            <button onClick={() => setAction("edit")} className="flex items-center justify-center gap-1.5 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
              <Pencil size={14} /> Edit
            </button>
            <button onClick={() => setAction("logActivity")} className="flex items-center justify-center gap-1.5 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
              <PhoneCall size={14} /> Log Activity
            </button>
            <button onClick={() => setAction("followUp")} className="flex items-center justify-center gap-1.5 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm">
              <CalendarClock size={14} /> Follow-up
            </button>
            {isOpen && (
              <>
                <button onClick={() => setAction("won")} className="flex items-center justify-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 px-3 py-2 rounded-lg text-sm">
                  <Trophy size={14} /> Mark Won
                </button>
                <button onClick={() => setAction("lost")} className="flex items-center justify-center gap-1.5 border border-red-700 text-red-400 hover:bg-red-900/30 px-3 py-2 rounded-lg text-sm">
                  <XCircle size={14} /> Mark Lost
                </button>
                <button onClick={() => setAction("hold")} className="col-span-2 flex items-center justify-center gap-1.5 border border-orange-700 text-orange-400 hover:bg-orange-900/30 px-3 py-2 rounded-lg text-sm">
                  <PauseCircle size={14} /> Put On Hold
                </button>
              </>
            )}
          </div>
        </Section>

        {action === "edit" && <DealFormModal deal={deal} onClose={() => setAction(null)} onSaved={onChanged} />}
        {(action === "logActivity" || action === "followUp") && (
          <ActivityFormModal
            prefill={{ relatedRecordType: "Deal", relatedRecordId: deal._id, ownerId: deal.ownerId }}
            onClose={() => setAction(null)}
            onSaved={() => { setAction(null); dispatch(fetchActivities()); }}
          />
        )}
        {action === "won" && <MarkWonModal deal={deal} primaryContact={primaryContact} onClose={() => setAction(null)} onDone={onChanged} />}
        {action === "lost" && <MarkLostModal deal={deal} onClose={() => setAction(null)} onDone={onChanged} />}
        {action === "hold" && <PutOnHoldModal deal={deal} onClose={() => setAction(null)} onDone={onChanged} />}
      </div>
    </div>
  );
}
