import { useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { X, Trophy, XCircle, PauseCircle, RefreshCcw, Archive as ArchiveIcon } from "lucide-react";
import {
  markDealWon, markDealLost, cancelDeal, putDealOnHold, reopenDeal, archiveDeal,
  DEAL_LOSS_REASONS, DEAL_STAGES,
} from "../../../redux/crm/dealsSlice";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney } from "./dealUtils";

// Shared across DealsList (row actions) and DealDetail (primary/contextual
// actions) — reused rather than rebuilt in both places.

export function MarkWonModal({ deal, primaryContact, onClose, onDone }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [finalValue, setFinalValue] = useState(deal.value);
  const [actualClosingDate, setActualClosingDate] = useState(new Date().toISOString().slice(0, 10));
  const [winReason, setWinReason] = useState("");
  const [handoffOwnerId, setHandoffOwnerId] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [includedItems, setIncludedItems] = useState(() => new Set(deal.lineItems.map((li) => li._id)));
  const [step, setStep] = useState("form");
  const [saving, setSaving] = useState(false);
  const containerRef = useFocusTrap(true, onClose);

  const toggleItem = (itemId) => setIncludedItems((s) => {
    const next = new Set(s);
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
    return next;
  });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const result = await dispatch(markDealWon({
      id: deal._id, actualClosingDate: new Date(actualClosingDate).toISOString(),
      winReason: winReason.trim(), handoffOwnerId: handoffOwnerId || undefined,
      value: Number(finalValue), note: internalNote.trim() || undefined,
    }));
    setSaving(false);
    if (markDealWon.fulfilled.match(result)) setStep("handoff");
  };

  const finish = () => { onDone(); onClose(); };

  if (step === "handoff") {
    const handoffOwner = CRM_TEAM.find((u) => u.id === handoffOwnerId);
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={finish}>
        <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Deal Won" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
          <div className="flex items-center gap-2 text-emerald-400"><Trophy size={20} /><h2 className="text-lg font-bold text-white">Deal marked Won</h2></div>
          <p className="text-sm text-gray-400">{deal.name} — {formatMoney(Number(finalValue), deal.currency)}{handoffOwner ? `. Handed off to ${handoffOwner.name}.` : "."}</p>
          <div className="bg-gray-800/40 rounded-lg p-4">
            <p className="text-xs font-semibold uppercase text-gray-400 mb-2">Suggested next steps (frontend previews only)</p>
            <ul className="space-y-2 text-sm text-gray-300">
              {["Create order", "Prepare contract", "Create project", "Request invoice", "Start onboarding"].map((label) =>
                label === "Prepare contract" ? (
                  <li key={label} className="flex items-center justify-between bg-gray-900/50 rounded-lg px-3 py-2">
                    <span>{label}</span>
                    <button onClick={() => { finish(); navigate(`/sales/contracts?fromDeal=${deal._id}`); }} className="text-[11px] text-blue-400 hover:underline">Prepare Contract</button>
                  </li>
                ) : (
                  <li key={label} className="flex items-center justify-between bg-gray-900/50 rounded-lg px-3 py-2">
                    <span>{label}</span>
                    <span className="text-[10px] text-gray-500 border border-gray-700 rounded-full px-2 py-0.5">Preview only</span>
                  </li>
                )
              )}
            </ul>
            <p className="text-[11px] text-gray-500 mt-3">No backend records were created. Prepare Contract navigates to a real frontend Contract draft; the other steps are future integration points, not completed actions.</p>
          </div>
          <div className="flex justify-end">
            <button onClick={finish} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Mark Deal Won" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2"><Trophy size={18} className="text-emerald-400" /> Mark Deal Won</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div>
          <label htmlFor="won-value" className="block text-sm mb-1 text-gray-300">Final Deal Value</label>
          <input id="won-value" type="number" min="0" required value={finalValue} onChange={(e) => setFinalValue(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="won-date" className="block text-sm mb-1 text-gray-300">Actual Closing Date</label>
          <input id="won-date" type="date" required value={actualClosingDate} onChange={(e) => setActualClosingDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="won-reason" className="block text-sm mb-1 text-gray-300">Win Reason</label>
          <textarea id="won-reason" required value={winReason} onChange={(e) => setWinReason(e.target.value)} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        </div>
        {deal.lineItems.length > 0 && (
          <div>
            <p className="text-sm mb-1 text-gray-300">Selected Products / Services</p>
            <div className="space-y-1 max-h-32 overflow-y-auto border border-gray-800 rounded-lg p-2">
              {deal.lineItems.map((li) => (
                <label key={li._id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={includedItems.has(li._id)} onChange={() => toggleItem(li._id)} />
                  {li.name} · {formatMoney(li.lineTotal, deal.currency)}
                </label>
              ))}
            </div>
          </div>
        )}
        <div>
          <label htmlFor="won-primary" className="block text-sm mb-1 text-gray-300">Primary Contact</label>
          <input id="won-primary" disabled value={primaryContact?.name || "—"} className="w-full bg-gray-800/30 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400" />
        </div>
        <div>
          <label htmlFor="won-handoff" className="block text-sm mb-1 text-gray-300">Handoff Owner</label>
          <select id="won-handoff" value={handoffOwnerId} onChange={(e) => setHandoffOwnerId(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">No handoff</option>
            {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="won-note" className="block text-sm mb-1 text-gray-300">Internal Note (optional)</label>
          <textarea id="won-note" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-sm font-medium">{saving ? "Saving..." : "Confirm Won"}</button>
        </div>
      </form>
    </div>
  );
}

export function MarkLostModal({ deal, onClose, onDone }) {
  const dispatch = useDispatch();
  const [lossReason, setLossReason] = useState(DEAL_LOSS_REASONS[0]);
  const [lossCompetitor, setLossCompetitor] = useState("");
  const [actualClosingDate, setActualClosingDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const containerRef = useFocusTrap(true, onClose);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const result = await dispatch(markDealLost({
      id: deal._id, lossReason, lossCompetitor: lossCompetitor.trim() || undefined,
      actualClosingDate: new Date(actualClosingDate).toISOString(), note: note.trim() || undefined,
    }));
    setSaving(false);
    if (markDealLost.fulfilled.match(result)) { onDone(); onClose(); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Mark Deal Lost" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2"><XCircle size={18} className="text-red-400" /> Mark Deal Lost</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div>
          <label htmlFor="lost-reason" className="block text-sm mb-1 text-gray-300">Lost Reason *</label>
          <select id="lost-reason" value={lossReason} onChange={(e) => setLossReason(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            {DEAL_LOSS_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {lossReason === "Chose competitor" && (
          <div>
            <label htmlFor="lost-competitor" className="block text-sm mb-1 text-gray-300">Competitor</label>
            <input id="lost-competitor" value={lossCompetitor} onChange={(e) => setLossCompetitor(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
        )}
        <div>
          <label htmlFor="lost-date" className="block text-sm mb-1 text-gray-300">Closing Date</label>
          <input id="lost-date" type="date" required value={actualClosingDate} onChange={(e) => setActualClosingDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="lost-note" className="block text-sm mb-1 text-gray-300">Internal Note</label>
          <textarea id="lost-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Follow-up eligibility, context for later..." className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-sm font-medium">{saving ? "Saving..." : "Confirm Lost"}</button>
        </div>
      </form>
    </div>
  );
}

export function CancelDealModal({ deal, onClose, onDone }) {
  const dispatch = useDispatch();
  const [cancellationReason, setCancellationReason] = useState("");
  const [saving, setSaving] = useState(false);
  const containerRef = useFocusTrap(true, onClose);

  const submit = async (e) => {
    e.preventDefault();
    if (!cancellationReason.trim()) return;
    setSaving(true);
    const result = await dispatch(cancelDeal({ id: deal._id, cancellationReason: cancellationReason.trim() }));
    setSaving(false);
    if (cancelDeal.fulfilled.match(result)) { onDone(); onClose(); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Cancel Deal" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Cancel Deal</h2>
        <p className="text-sm text-gray-400">{deal.name} will move to the Cancelled outcome view.</p>
        <textarea autoFocus required value={cancellationReason} onChange={(e) => setCancellationReason(e.target.value)} rows={3} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Keep Deal</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-sm font-medium">{saving ? "Cancelling..." : "Confirm Cancel"}</button>
        </div>
      </form>
    </div>
  );
}

export function PutOnHoldModal({ deal, onClose, onDone }) {
  const dispatch = useDispatch();
  const [onHoldReason, setOnHoldReason] = useState("");
  const [onHoldReviewDate, setOnHoldReviewDate] = useState("");
  const [ownerId, setOwnerId] = useState(deal.ownerId || "");
  const [saving, setSaving] = useState(false);
  const containerRef = useFocusTrap(true, onClose);

  const submit = async (e) => {
    e.preventDefault();
    if (!onHoldReason.trim() || !onHoldReviewDate) return;
    setSaving(true);
    const result = await dispatch(putDealOnHold({
      id: deal._id, onHoldReason: onHoldReason.trim(),
      onHoldReviewDate: new Date(onHoldReviewDate).toISOString(), ownerId: ownerId || null,
    }));
    setSaving(false);
    if (putDealOnHold.fulfilled.match(result)) { onDone(); onClose(); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Put Deal On Hold" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold flex items-center gap-2"><PauseCircle size={18} className="text-orange-400" /> Put Deal On Hold</h2>
        <div>
          <label htmlFor="hold-reason" className="block text-sm mb-1 text-gray-300">Reason *</label>
          <textarea id="hold-reason" autoFocus required value={onHoldReason} onChange={(e) => setOnHoldReason(e.target.value)} rows={2} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        </div>
        <div>
          <label htmlFor="hold-review" className="block text-sm mb-1 text-gray-300">Review Date *</label>
          <input id="hold-review" type="date" required value={onHoldReviewDate} onChange={(e) => setOnHoldReviewDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="hold-owner" className="block text-sm mb-1 text-gray-300">Owner</label>
          <select id="hold-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Unassigned</option>
            {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-sm font-medium">{saving ? "Saving..." : "Put On Hold"}</button>
        </div>
      </form>
    </div>
  );
}

export function ReopenDealModal({ deal, onClose, onDone }) {
  const dispatch = useDispatch();
  const [stage, setStage] = useState("Qualified");
  const [expectedClosingDate, setExpectedClosingDate] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [saving, setSaving] = useState(false);
  const containerRef = useFocusTrap(true, onClose);
  const openStages = DEAL_STAGES.filter((s) => s !== "Won");

  const submit = async (e) => {
    e.preventDefault();
    if (!expectedClosingDate || !nextAction.trim()) return;
    setSaving(true);
    const result = await dispatch(reopenDeal({
      id: deal._id, stage, expectedClosingDate: new Date(expectedClosingDate).toISOString(), nextAction: nextAction.trim(),
    }));
    setSaving(false);
    if (reopenDeal.fulfilled.match(result)) { onDone(); onClose(); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Reopen Deal" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold flex items-center gap-2"><RefreshCcw size={18} className="text-amber-400" /> Reopen Deal</h2>
        <p className="text-xs text-gray-500">Reopening returns this deal to an open, active stage.</p>
        <div>
          <label htmlFor="reopen-stage" className="block text-sm mb-1 text-gray-300">Target Stage *</label>
          <select id="reopen-stage" value={stage} onChange={(e) => setStage(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            {openStages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="reopen-close" className="block text-sm mb-1 text-gray-300">Updated Expected Close *</label>
          <input id="reopen-close" type="date" required value={expectedClosingDate} onChange={(e) => setExpectedClosingDate(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="reopen-next" className="block text-sm mb-1 text-gray-300">Next Action *</label>
          <input id="reopen-next" required value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-sm font-medium">{saving ? "Reopening..." : "Reopen"}</button>
        </div>
      </form>
    </div>
  );
}

export function ArchiveDealModal({ deal, onClose, onDone }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const containerRef = useFocusTrap(true, onClose);

  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    const result = await dispatch(archiveDeal({ id: deal._id, reason: reason.trim() }));
    setSaving(false);
    if (archiveDeal.fulfilled.match(result)) { onDone(); onClose(); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Archive Deal" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold flex items-center gap-2"><ArchiveIcon size={18} /> Archive Deal</h2>
        <p className="text-sm text-gray-400">Archiving <strong className="text-white">{deal.name}</strong> moves it out of active views. It can be restored later.</p>
        <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-sm font-medium">{saving ? "Archiving..." : "Archive"}</button>
        </div>
      </form>
    </div>
  );
}
