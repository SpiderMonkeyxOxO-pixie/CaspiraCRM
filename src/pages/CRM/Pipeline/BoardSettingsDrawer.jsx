import { X } from "lucide-react";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { SORT_OPTIONS } from "./pipelineUtils";

const FIELD_LABELS = {
  primaryContact: "Primary contact", quoteAvailable: "Quote available", productsCount: "Products count",
  priority: "Priority", tags: "Tags",
};

// A frontend-only, per-viewer UI preference drawer — stored in this
// browser's localStorage, same as the column-visibility/saved-view
// preferences already established on the Deals/Companies lists. This is
// display preference, not a claim of backend/administrative persistence;
// per spec, admin pipeline configuration is a later phase.
export default function BoardSettingsDrawer({ settings, onChange, onClose }) {
  const containerRef = useFocusTrap(true, onClose);

  const set = (patch) => onChange({ ...settings, ...patch });
  const setField = (key, value) => set({ visibleFields: { ...settings.visibleFields, [key]: value } });

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Board settings"
        className="relative w-full sm:max-w-sm h-full bg-gray-900 border-l border-gray-800 overflow-y-auto p-6 space-y-6 shadow-2xl">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">Board Settings</h2>
          <button onClick={onClose} aria-label="Close board settings"><X size={20} /></button>
        </div>
        <p className="text-xs text-gray-500">
          Preview-only display preferences, saved to this browser. Administrative pipeline configuration will be handled in a later phase.
        </p>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Visible Card Fields</p>
          <div className="space-y-1.5">
            {Object.keys(settings.visibleFields).map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={settings.visibleFields[key]} onChange={(e) => setField(key, e.target.checked)} />
                {FIELD_LABELS[key] || key}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Card Density</p>
          <div className="flex gap-2">
            {["comfortable", "compact"].map((d) => (
              <button key={d} onClick={() => set({ density: d })}
                className={`px-3 py-1.5 rounded-lg text-sm border capitalize ${settings.density === d ? "bg-blue-700 border-blue-600" : "border-gray-700 hover:bg-gray-800"}`}>
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center justify-between text-sm">
            Show weighted value
            <input type="checkbox" checked={settings.showWeighted} onChange={(e) => set({ showWeighted: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-sm">
            Show stage totals
            <input type="checkbox" checked={settings.showTotals} onChange={(e) => set({ showTotals: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-sm">
            Hide collapsed stages entirely
            <input type="checkbox" checked={settings.hideCollapsedStages} onChange={(e) => set({ hideCollapsedStages: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between text-sm">
            Show warning indicators
            <input type="checkbox" checked={settings.warningIndicators} onChange={(e) => set({ warningIndicators: e.target.checked })} />
          </label>
        </div>

        <div>
          <label htmlFor="board-default-sort" className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Default Sorting</label>
          <select id="board-default-sort" value={settings.defaultSort} onChange={(e) => set({ defaultSort: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="flex justify-end pt-2 border-t border-gray-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Done</button>
        </div>
      </div>
    </div>
  );
}
