// Accessible charts for Analytics: every chart carries a text summary and a
// data-table alternative, and never relies on color alone.
import { useId, useState } from "react";
import { formatValue } from "./analyticsKit";

function summarizeSeries(points, unit, currency) {
  const vals = points.filter((p) => p.value !== null && p.value !== undefined).map((p) => Number(p.value));
  if (!vals.length) return "No data in this period.";
  const max = Math.max(...vals); const min = Math.min(...vals);
  const first = vals[0]; const last = vals[vals.length - 1];
  const hi = points.find((p) => Number(p.value) === max);
  return `${points.length} periods. Highest ${formatValue(max, unit, currency)} (${hi.period}); lowest ${formatValue(min, unit, currency)}. ${last > first ? "Up" : last < first ? "Down" : "Flat"} from ${formatValue(first, unit, currency)} to ${formatValue(last, unit, currency)}.`;
}

export function TrendChart({ title, points = [], unit, currency, grain }) {
  const [table, setTable] = useState(false);
  const id = useId();
  const W = 640; const H = 180; const P = 28;
  const vals = points.map((p) => (p.value === null || p.value === undefined ? null : Number(p.value)));
  const max = Math.max(1, ...vals.filter((v) => v !== null));
  const x = (i) => P + (points.length <= 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (points.length - 1));
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const path = vals.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
  const summary = summarizeSeries(points, unit, currency);
  return (
    <figure className="space-y-2" aria-labelledby={`${id}-cap`}>
      <div className="flex items-center justify-between gap-2">
        <figcaption id={`${id}-cap`} className="text-sm font-semibold">{title}{grain ? <span className="text-xs text-gray-500 font-normal"> · by {grain}</span> : null}</figcaption>
        <button type="button" className="text-xs text-blue-300 underline" aria-expanded={table} onClick={() => setTable((t) => !t)}>{table ? "Show chart" : "Show data table"}</button>
      </div>
      <p className="text-xs text-gray-400" id={`${id}-sum`}>{summary}</p>
      {table || !points.length ? (
        <DataTable caption={title} rows={points.map((p) => [p.period, formatValue(p.value, unit, currency)])} head={["Period", "Value"]} />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" role="img" aria-labelledby={`${id}-cap ${id}-sum`}>
          <line x1={P} y1={H - P} x2={W - P} y2={H - P} className="stroke-gray-700" />
          <polyline points={path} fill="none" className="stroke-blue-400" strokeWidth="2" />
          {vals.map((v, i) => (v === null ? null : <circle key={points[i].period} cx={x(i)} cy={y(v)} r="3" className="fill-blue-300"><title>{`${points[i].period}: ${formatValue(v, unit, currency)}`}</title></circle>))}
          {points.length > 0 && <text x={P} y={H - 8} className="fill-gray-500 text-[10px]">{points[0].period}</text>}
          {points.length > 1 && <text x={W - P} y={H - 8} textAnchor="end" className="fill-gray-500 text-[10px]">{points[points.length - 1].period}</text>}
          <text x={P} y={P - 10} className="fill-gray-500 text-[10px]">{formatValue(max, unit, currency)}</text>
        </svg>
      )}
    </figure>
  );
}

export function BarList({ title, groups = [], unit, currency, onSelect }) {
  const [table, setTable] = useState(false);
  const id = useId();
  const vals = groups.map((g) => Number(g.value) || 0);
  const max = Math.max(1, ...vals.map(Math.abs));
  const top = groups[0];
  const summary = groups.length ? `${groups.length} groups. Largest: ${top.label} (${formatValue(top.value, unit, currency)}).` : "No data in this period.";
  return (
    <figure className="space-y-2" aria-labelledby={`${id}-cap`}>
      <div className="flex items-center justify-between gap-2">
        <figcaption id={`${id}-cap`} className="text-sm font-semibold">{title}</figcaption>
        <button type="button" className="text-xs text-blue-300 underline" aria-expanded={table} onClick={() => setTable((t) => !t)}>{table ? "Show chart" : "Show data table"}</button>
      </div>
      <p className="text-xs text-gray-400">{summary}</p>
      {table || !groups.length ? (
        <DataTable caption={title} rows={groups.map((g) => [g.label, formatValue(g.value, unit, currency)])} head={["Group", "Value"]} />
      ) : (
        <ul className="space-y-1.5">
          {groups.map((g) => (
            <li key={g.key ?? "none"}>
              <button type="button" disabled={!onSelect} onClick={() => onSelect?.(g)} className="w-full text-left group disabled:cursor-default" aria-label={`${g.label}: ${formatValue(g.value, unit, currency)}${onSelect ? " — show records" : ""}`}>
                <div className="flex justify-between text-xs text-gray-300"><span className="truncate">{g.label}</span><span className="tabular-nums">{formatValue(g.value, unit, currency)}</span></div>
                <div className="h-2 bg-gray-800 rounded"><div className="h-2 rounded bg-blue-500/70 group-hover:bg-blue-400" style={{ width: `${Math.max(2, (Math.abs(Number(g.value) || 0) / max) * 100)}%` }} /></div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

export function DataTable({ caption, head, rows }) {
  if (!rows.length) return <p className="text-sm text-gray-400">No data in this period.</p>;
  return (
    <div className="overflow-x-auto border border-gray-800 rounded-lg">
      <table className="min-w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase"><tr>{head.map((h) => <th key={h} scope="col" className="text-left px-3 py-2">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={`${r[0]}-${i}`} className="border-t border-gray-800">{r.map((c, j) => (j === 0 ? <th key={j} scope="row" className="text-left px-3 py-1.5 font-normal text-gray-300">{c}</th> : <td key={j} className="px-3 py-1.5 text-gray-300 tabular-nums">{c}</td>))}</tr>)}</tbody>
      </table>
    </div>
  );
}
