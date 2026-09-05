import { X, ChevronUp, ChevronDown } from "lucide-react";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { DATE_PRESETS } from "./dashboardSelectors";
import { DASHBOARD_VIEWS } from "./dashboardConfig";

const WIDGET_LABELS = {
  leadSource: "Lead Source Performance", forecast: "Forecast — Expected Close",
  companiesAttention: "Companies Needing Attention", recentActivity: "Recent CRM Activity",
  teamPerformance: "Team Performance",
};

// Session-only preferences — kept in plain component state by the caller,
// never written to localStorage or claimed as saved permanently, per spec.
export default function DashboardSettingsDrawer({ settings, onChange, onClose }) {
  const containerRef = useFocusTrap(true, onClose);
  const set = (patch) => onChange({ ...settings, ...patch });
  const toggleWidget = (key) => set({ hiddenWidgets: settings.hiddenWidgets.includes(key) ? settings.hiddenWidgets.filter((w) => w !== key) : [...settings.hiddenWidgets, key] });

  const moveWidget = (key, dir) => {
    const order = [...settings.widgetOrder];
    const idx = order.indexOf(key);
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= order.length) return;
    [order[idx], order[swapWith]] = [order[swapWith], order[idx]];
    set({ widgetOrder: order });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Dashboard settings"
        className="relative w-full sm:max-w-sm h-full bg-gray-900 border-l border-gray-800 overflow-y-auto p-6 space-y-6 shadow-2xl">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">Dashboard Settings</h2>
          <button onClick={onClose} aria-label="Close dashboard settings"><X size={20} /></button>
        </div>
        <p className="text-xs text-gray-500">Applies to this browser session only — these choices are not saved permanently.</p>

        <div>
          <label htmlFor="dash-default-view" className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Default View</label>
          <select id="dash-default-view" value={settings.defaultView} onChange={(e) => set({ defaultView: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            {DASHBOARD_VIEWS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="dash-default-range" className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Default Date Range</label>
          <select id="dash-default-range" value={settings.defaultRange} onChange={(e) => set({ defaultRange: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            {DATE_PRESETS.filter((p) => p.value !== "custom").map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Density</p>
          <div className="flex gap-2">
            {["comfortable", "compact"].map((d) => (
              <button key={d} onClick={() => set({ density: d })}
                className={`px-3 py-1.5 rounded-lg text-sm border capitalize ${settings.density === d ? "bg-blue-700 border-blue-600" : "border-gray-700 hover:bg-gray-800"}`}>
                {d}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Optional Widgets</p>
          <div className="space-y-1.5">
            {Object.keys(WIDGET_LABELS).map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!settings.hiddenWidgets.includes(key)} onChange={() => toggleWidget(key)} />
                {WIDGET_LABELS[key]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Widget Order</p>
          <ul className="space-y-1">
            {settings.widgetOrder.filter((k) => WIDGET_LABELS[k]).map((key, i, arr) => (
              <li key={key} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-2.5 py-1.5 text-sm">
                {WIDGET_LABELS[key]}
                <span className="flex gap-1">
                  <button onClick={() => moveWidget(key, -1)} disabled={i === 0} aria-label={`Move ${WIDGET_LABELS[key]} up`} className="p-1 rounded hover:bg-gray-700 disabled:opacity-30"><ChevronUp size={14} /></button>
                  <button onClick={() => moveWidget(key, 1)} disabled={i === arr.length - 1} aria-label={`Move ${WIDGET_LABELS[key]} down`} className="p-1 rounded hover:bg-gray-700 disabled:opacity-30"><ChevronDown size={14} /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end pt-2 border-t border-gray-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Done</button>
        </div>
      </div>
    </div>
  );
}
