import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, HelpCircle, Undo2, ScanSearch } from "lucide-react";
import {
  fetchBankTransactions, confirmReconciliationMatch, rejectReconciliationSuggestion,
  markReconciliationReviewRequired, undoLastReconciliationMatch, selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { canProcessReconciliationPreview } from "./commerceFinanceConfig";

const QUEUES = [
  { key: "Unmatched", label: "Unmatched" },
  { key: "Suggested Match", label: "Suggested Matches" },
  { key: "Partial Match", label: "Partial Matches" },
  { key: "Conflict", label: "Conflicts" },
  { key: "Matched", label: "Completed Preview Reconciliations" },
];

function formatMoney(minor, currency) {
  if (minor == null) return "—";
  const sign = minor < 0 ? "-" : "";
  return `${sign}${(Math.abs(minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function ReconciliationWorkbench() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { bankTransactions, loading, error } = useSelector(selectIntegrations);
  const [lastAction, setLastAction] = useState(null);

  useEffect(() => { dispatch(fetchBankTransactions({})); }, [dispatch]);

  const grouped = useMemo(() => {
    const map = {};
    QUEUES.forEach((q) => { map[q.key] = []; });
    bankTransactions.forEach((t) => { (map[t.reconciliationStatus] ||= []).push(t); });
    return map;
  }, [bankTransactions]);

  const confirm = async (tx) => {
    await dispatch(confirmReconciliationMatch(tx.id));
    setLastAction("confirm");
    dispatch(fetchBankTransactions({}));
  };
  const reject = async (tx) => {
    await dispatch(rejectReconciliationSuggestion(tx.id));
    dispatch(fetchBankTransactions({}));
  };
  const markReview = async (tx) => {
    await dispatch(markReconciliationReviewRequired(tx.id));
    dispatch(fetchBankTransactions({}));
  };
  const undo = async () => {
    await dispatch(undoLastReconciliationMatch());
    setLastAction(null);
    dispatch(fetchBankTransactions({}));
  };

  const canAct = canProcessReconciliationPreview(role);
  const totalOpen = (grouped.Unmatched?.length || 0) + (grouped["Suggested Match"]?.length || 0) + (grouped["Partial Match"]?.length || 0) + (grouped.Conflict?.length || 0);

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/commerce-finance" className="hover:text-gray-300">Commerce & Finance</Link>{" "}
        <span>/</span> <span className="text-gray-300">Reconciliation</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Reconciliation</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            {totalOpen} bank transaction{totalOpen === 1 ? "" : "s"} need review. Every suggested match explains its own evidence — never an
            unexplained confidence percentage.
          </p>
        </div>
        {lastAction && (
          <button onClick={undo} className="flex items-center gap-1.5 text-sm text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">
            <Undo2 size={14} /> Undo Last Match
          </button>
        )}
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <div className="space-y-4">
          {QUEUES.map((q) => (
            <section key={q.key} className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-white mb-3">{q.label} ({grouped[q.key]?.length || 0})</h2>
              {(grouped[q.key] || []).length === 0 ? (
                <p className="text-xs text-gray-500">Nothing in this queue.</p>
              ) : (
                <ul className="space-y-2">
                  {grouped[q.key].map((t) => (
                    <li key={t.id} className="bg-gray-800/40 rounded-lg p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm text-gray-200">{t.description}</p>
                          <p className={`text-xs mt-0.5 ${t.direction === "Credit" ? "text-emerald-400" : "text-red-400"}`}>{formatMoney(t.amountMinor, t.currency)}</p>
                        </div>
                        {canAct && (q.key === "Suggested Match" || q.key === "Partial Match") && (
                          <div className="flex items-center gap-2">
                            <button onClick={() => confirm(t)} className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"><CheckCircle2 size={13} /> Confirm</button>
                            <button onClick={() => reject(t)} className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300"><XCircle size={13} /> Reject</button>
                            <button onClick={() => markReview(t)} className="flex items-center gap-1 text-[11px] text-amber-300 hover:text-amber-200"><HelpCircle size={13} /> Review Required</button>
                          </div>
                        )}
                        {canAct && q.key === "Unmatched" && (
                          <button onClick={() => markReview(t)} className="flex items-center gap-1 text-[11px] text-amber-300 hover:text-amber-200"><HelpCircle size={13} /> Mark for Review</button>
                        )}
                      </div>
                      {t.suggestedMatch && (
                        <p className="text-[11px] text-gray-400 mt-2 flex items-start gap-1.5">
                          <ScanSearch size={12} className="mt-0.5 shrink-0" />
                          Suggested match: {t.suggestedMatch.type} {t.suggestedMatch.id}
                          {t.confidenceExplanation && <span className="text-gray-500"> — {t.confidenceExplanation}</span>}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
