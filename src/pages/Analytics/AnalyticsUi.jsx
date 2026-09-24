// Shared components for Analytics & Reports (Backend Phase 12,
// VITE_BACKEND_ANALYTICS_MODE=true): page shell with an access gate,
// comparison and freshness labels, definition notes and range controls.
import { useId, useState } from "react";
import { ShieldAlert, Info, Clock } from "lucide-react";
import { BACKEND_ANALYTICS_MODE_ENABLED } from "../../Helpers/backendAnalyticsClient";
import { useAnalyticsAccess } from "../../Helpers/analyticsAccess";
import { Loading, Badge } from "../Admin/aiBackend/aiUi";
import { input, formatValue, fmtDateTime, RANGE_PRESETS } from "./analyticsKit";

export { Panel, Badge, ErrorBox, Loading, Empty, Modal, Table } from "../Admin/aiBackend/aiUi";

// requires: [[module, action], …] — any one opens the page.
export function AnalyticsPage({ title, description, requires = [], actions, children, section = "Analytics" }) {
  const access = useAnalyticsAccess();
  if (!BACKEND_ANALYTICS_MODE_ENABLED) {
    return <div className="p-6 text-gray-300"><h1 className="text-xl font-semibold text-white">{title}</h1><p className="mt-2 text-sm">Analytics & Reports needs the backend analytics mode (VITE_BACKEND_ANALYTICS_MODE=true).</p></div>;
  }
  if (access.loading) return <Loading what="Checking your access…" />;
  const allowed = requires.length === 0 || requires.some(([m, a]) => access.can(m, a));
  if (!allowed) {
    return (
      <div className="p-6">
        <div role="alert" className="max-w-xl bg-gray-900/60 border border-gray-800 rounded-xl p-5 text-gray-300 flex gap-3">
          <ShieldAlert className="text-amber-300 shrink-0" aria-hidden="true" />
          <div><h1 className="text-lg font-semibold text-white">{title}</h1><p className="text-sm mt-1">Your role doesn't include access to this page. Ask an Organization Administrator if you need it.</p></div>
        </div>
      </div>
    );
  }
  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <nav aria-label="Breadcrumb" className="text-xs text-gray-500 flex items-center gap-1"><span>{section}</span><span>/</span><span className="text-gray-300">{title}</span></nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && <p className="text-sm text-gray-400 mt-1 max-w-3xl">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {typeof children === "function" ? children(access) : children}
    </div>
  );
}

export function ChangeText({ metric }) {
  const c = metric.comparison;
  if (!c) return null;
  if (c.change === null || c.change === undefined) return <p className="text-[11px] text-gray-500">{c.note || c.label}</p>;
  const up = c.change > 0; const flat = c.change === 0;
  const tone = flat ? "text-gray-400" : up ? "text-emerald-300" : "text-amber-300";
  const pct = c.changePercent === null || c.changePercent === undefined ? "" : ` (${c.changePercent > 0 ? "+" : ""}${c.changePercent}%)`;
  return <p className={`text-[11px] ${tone}`}><span className="sr-only">Change versus comparison period: </span>{flat ? "No change" : `${up ? "▲ +" : "▼ "}${formatValue(c.change, metric.unit, metric.currency)}${pct}`} <span className="text-gray-500">vs {c.label}</span>{c.note ? <span className="text-gray-500"> · {c.note}</span> : null}</p>;
}

export function FreshnessBadge({ freshness }) {
  if (!freshness) return null;
  if (!freshness.lastLoadedAt) return <Badge tone="amber">Not loaded yet</Badge>;
  return freshness.stale
    ? <Badge tone="amber">Stale · loaded {fmtDateTime(freshness.lastLoadedAt)}</Badge>
    : <span className="inline-flex items-center gap-1 text-[11px] text-gray-500"><Clock size={11} aria-hidden="true" />Loaded {fmtDateTime(freshness.lastLoadedAt)}</span>;
}

// A metric's governed definition, shown on demand.
export function DefinitionNote({ metric }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-block">
      <button type="button" className="text-gray-500 hover:text-gray-300 align-middle" aria-expanded={open} aria-controls={id} aria-label={`Definition of ${metric.name}`} onClick={() => setOpen((o) => !o)}><Info size={13} /></button>
      {open && (
        <span id={id} role="note" className="absolute z-20 left-0 top-5 w-72 bg-[#12141c] border border-gray-700 rounded-lg p-3 text-xs text-gray-300 shadow-xl">
          <span className="block font-semibold text-white mb-1">{metric.name} · v{metric.version ?? "—"}</span>
          {metric.definition}
          <span className="block mt-1 text-gray-500">{metric.additivity === "semi-additive" ? "Point-in-time value (not summed across dates)." : metric.additivity === "non-additive" ? "Ratio or average — not added across groups." : "Additive across dates and groups."}</span>
        </span>
      )}
    </span>
  );
}

// value: { preset, from, to, comparison, currencyMode }
export function RangeControls({ value, onChange, showCurrency = true, showComparison = true }) {
  const id = useId();
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Report period">
      <label className="text-xs text-gray-400" htmlFor={`${id}-p`}>Period
        <select id={`${id}-p`} className={`${input} mt-1 w-44`} value={value.preset} onChange={(e) => set({ preset: e.target.value })}>
          {RANGE_PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {value.preset === "custom" && (
        <>
          <label className="text-xs text-gray-400" htmlFor={`${id}-f`}>From<input id={`${id}-f`} type="date" className={`${input} mt-1 w-40`} value={value.from || ""} onChange={(e) => set({ from: e.target.value })} /></label>
          <label className="text-xs text-gray-400" htmlFor={`${id}-t`}>To<input id={`${id}-t`} type="date" className={`${input} mt-1 w-40`} value={value.to || ""} onChange={(e) => set({ to: e.target.value })} /></label>
        </>
      )}
      {showComparison && (
        <label className="text-xs text-gray-400" htmlFor={`${id}-c`}>Compare with
          <select id={`${id}-c`} className={`${input} mt-1 w-44`} value={value.comparison} onChange={(e) => set({ comparison: e.target.value })}>
            <option value="previous_period">Previous period</option><option value="previous_year">Same period last year</option><option value="none">No comparison</option>
          </select>
        </label>
      )}
      {showCurrency && (
        <label className="text-xs text-gray-400" htmlFor={`${id}-m`}>Currency
          <select id={`${id}-m`} className={`${input} mt-1 w-44`} value={value.currencyMode} onChange={(e) => set({ currencyMode: e.target.value })}>
            <option value="base">Base currency</option><option value="original">Original currencies</option>
          </select>
        </label>
      )}
    </div>
  );
}

// Organization context shown on every analytics page.
export function ContextLine({ result }) {
  if (!result?.range) return null;
  return (
    <p className="text-xs text-gray-500">
      {result.range.from} – {result.range.to} · Time zone {result.timeZone} · Base currency {result.baseCurrency}
      {result.comparisonRange ? ` · Compared with ${result.comparisonRange.from} – ${result.comparisonRange.to}` : ""}
    </p>
  );
}
