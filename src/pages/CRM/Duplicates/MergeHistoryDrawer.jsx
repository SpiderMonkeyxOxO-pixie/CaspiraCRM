import { useDispatch, useSelector } from "react-redux";
import { X, RotateCcw, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { undoMergePreview } from "../../../redux/crm/duplicatesSlice";
import { RECORD_TYPE_LABELS } from "./duplicateDisplayConfig";

export default function MergeHistoryDrawer({ onClose }) {
  const dispatch = useDispatch();
  const containerRef = useFocusTrap(true, onClose);
  const mergeHistory = useSelector((s) => s.duplicates.mergeHistory);

  const handleUndo = async (entry) => {
    const action = await dispatch(undoMergePreview(entry.id));
    if (undoMergePreview.fulfilled.match(action)) toast.success("Merge undone for this session");
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Merge history" className="relative w-full sm:max-w-lg h-full bg-gray-950 border-l border-gray-800 overflow-y-auto p-6 space-y-4 shadow-2xl">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-bold">Merge History</h2>
            <p className="text-xs text-gray-500">Current browser session only — nothing here is persisted or sent to a server.</p>
          </div>
          <button onClick={onClose} aria-label="Close merge history"><X size={20} /></button>
        </div>

        {mergeHistory.length === 0 ? (
          <p className="text-sm text-gray-500">No merges have been applied yet this session.</p>
        ) : (
          <ul className="space-y-3">
            {mergeHistory.map((entry) => (
              <li key={entry.id} className={`border rounded-xl p-3 ${entry.undone ? "border-gray-800 bg-gray-900/20 opacity-60" : "border-gray-800 bg-gray-900/40"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs px-2 py-0.5 rounded-full border border-gray-700 text-gray-300">{RECORD_TYPE_LABELS[entry.masterType] || entry.masterType}</span>
                  {entry.undone ? (
                    <span className="text-xs text-gray-500 flex items-center gap-1"><RotateCcw size={12} /> Undone</span>
                  ) : (
                    <span className="text-xs text-emerald-300 flex items-center gap-1"><CheckCircle2 size={12} /> Applied</span>
                  )}
                </div>
                <p className="text-sm">Merged {entry.absorbedIds.length} record{entry.absorbedIds.length === 1 ? "" : "s"} into <strong>{entry.masterBefore?.name || entry.masterBefore?.email}</strong></p>
                <p className="text-xs text-gray-500 mt-1">{entry.reason}</p>
                <p className="text-[11px] text-gray-600 mt-1">{new Date(entry.mergedAt).toLocaleString()} · {entry.mergedBy}</p>
                {!entry.undone && (
                  <button onClick={() => handleUndo(entry)} className="text-xs text-amber-300 hover:underline mt-2">Undo (this session only)</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
