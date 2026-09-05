import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatMoney } from "../Deals/dealUtils";
import { DEAL_STAGE_COLORS } from "../../../redux/crm/dealsSlice";
import { useChartColors } from "../../../Context/ThemeContext";

// A stepped horizontal comparison rather than a decorative funnel shape —
// per spec, easier to compare values at a glance than a tapering funnel.
export function SalesFunnel({ steps }) {
  const navigate = useNavigate();
  const max = Math.max(1, ...steps.map((s) => s.count));

  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-sm">Sales Funnel</h2>
        <span title="Counts reflect deals currently open at or beyond each stage, plus deals already Won. Lead steps count leads created in the active date range." className="text-[11px] text-gray-500 cursor-help underline decoration-dotted">
          How this is counted
        </span>
      </div>
      <table className="sr-only">
        <caption>Sales funnel: record count and conversion from the previous stage</caption>
        <thead><tr><th>Stage</th><th>Count</th><th>Conversion from previous stage</th></tr></thead>
        <tbody>
          {steps.map((s, i) => (
            <tr key={s.key}><td>{s.label}</td><td>{s.count}</td><td>{i > 0 && steps[i - 1].count ? `${Math.round((s.count / steps[i - 1].count) * 1000) / 10}%` : "—"}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-2.5 mt-2" aria-hidden="true">
        {steps.map((step, i) => {
          const prev = steps[i - 1];
          const dropOff = prev ? prev.count - step.count : null;
          const convFromPrev = prev && prev.count ? Math.round((step.count / prev.count) * 1000) / 10 : null;
          const widthPct = Math.max(4, (step.count / max) * 100);
          return (
            <button key={step.key} onClick={() => navigate(step.to)}
              className="w-full text-left group rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-300 group-hover:text-white">{step.label}</span>
                <span className="text-gray-400">
                  {step.count}
                  {convFromPrev !== null && <span className="text-gray-600"> · {convFromPrev}% of {prev.label}</span>}
                </span>
              </div>
              <div className="h-6 bg-gray-800/60 rounded overflow-hidden">
                <div className="h-full bg-blue-600/70 group-hover:bg-blue-500 rounded transition-all" style={{ width: `${widthPct}%` }} />
              </div>
              {dropOff !== null && dropOff > 0 && <p className="text-[10px] text-gray-600 mt-0.5">-{dropOff} drop-off from {prev.label}</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const METRIC_OPTIONS = [
  { value: "value", label: "Total Value" },
  { value: "weighted", label: "Weighted Value" },
  { value: "count", label: "Deal Count" },
];

export function PipelineByStageChart({ stageTotals, currency }) {
  const navigate = useNavigate();
  const chartColors = useChartColors();
  const [metric, setMetric] = useState("value");
  const [showTable, setShowTable] = useState(false);

  const data = stageTotals.map((s) => ({
    stage: s.stage, value: s.valueByCurrency[currency] || 0, weighted: s.weightedByCurrency[currency] || 0, count: s.count,
  }));

  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold text-sm">Pipeline by Stage</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="pipeline-stage-metric" className="sr-only">Chart metric</label>
          <select id="pipeline-stage-metric" value={metric} onChange={(e) => setMetric(e.target.value)} className="bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1 text-xs">
            {METRIC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={() => setShowTable((v) => !v)} className="text-xs text-blue-400 hover:underline">{showTable ? "Show chart" : "Show data table"}</button>
        </div>
      </div>

      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Pipeline totals by stage — {currency}</caption>
            <thead className="text-gray-400 text-left"><tr>
              <th scope="col" className="py-1.5 pr-2">Stage</th><th scope="col" className="py-1.5 pr-2 text-right">Count</th>
              <th scope="col" className="py-1.5 pr-2 text-right">Value</th><th scope="col" className="py-1.5 text-right">Weighted</th>
            </tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.stage} className="border-t border-gray-800">
                  <td className="py-1.5 pr-2">
                    <button onClick={() => navigate(`/crm/deals?stage=${encodeURIComponent(d.stage)}`)} className="text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded">{d.stage}</button>
                  </td>
                  <td className="py-1.5 pr-2 text-right text-gray-300">{d.count}</td>
                  <td className="py-1.5 pr-2 text-right text-gray-300">{formatMoney(d.value, currency)}</td>
                  <td className="py-1.5 text-right text-gray-300">{formatMoney(d.weighted, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ width: "100%", height: 220 }} role="img" aria-label={`Bar chart of ${METRIC_OPTIONS.find((o) => o.value === metric)?.label} per pipeline stage. Use "Show data table" for an accessible breakdown.`}>
          <ResponsiveContainer>
            <BarChart data={data} onClick={(e) => { if (e?.activeLabel) navigate(`/crm/deals?stage=${encodeURIComponent(e.activeLabel)}`); }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
              <XAxis dataKey="stage" tick={{ fill: chartColors.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chartColors.tick, fontSize: 11 }} />
              <Tooltip formatter={(v) => (metric === "count" ? v : formatMoney(v, currency))} contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, fontSize: 12 }} />
              <Bar dataKey={metric} radius={[4, 4, 0, 0]} cursor="pointer">
                {data.map((d) => <Cell key={d.stage} fill={DEAL_STAGE_COLORS[d.stage]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
