import { useNavigate } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { AlertTriangle } from "lucide-react";
import { formatByCurrency } from "../Deals/dealUtils";
import { useChartColors } from "../../../Context/ThemeContext";

export default function LeadSourcePerformance({ sources }) {
  const navigate = useNavigate();
  const chartColors = useChartColors();
  const sorted = [...sources].sort((a, b) => b.leadCount - a.leadCount);
  const avgConversion = sorted.length ? sorted.reduce((s, x) => s + x.conversionRate, 0) / sorted.length : 0;

  if (sorted.length === 0) {
    return (
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <h2 className="font-semibold text-sm mb-2">Lead Source Performance</h2>
        <p className="text-sm text-gray-500">No leads in the active filters yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <h2 className="font-semibold text-sm mb-3">Lead Source Performance</h2>
      <div style={{ width: "100%", height: 180 }} role="img" aria-label="Bar chart of lead count per source. See the table below for full figures.">
        <ResponsiveContainer>
          <BarChart data={sorted} layout="vertical" margin={{ left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
            <XAxis type="number" tick={{ fill: chartColors.tick, fontSize: 11 }} />
            <YAxis dataKey="source" type="category" width={90} tick={{ fill: chartColors.tick, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, fontSize: 12 }} />
            <Bar dataKey="leadCount" name="Leads" fill="#3b82f6" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => navigate(`/crm/leads?source=${encodeURIComponent(d.source)}`)} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-xs">
          <caption className="sr-only">Lead source performance: count, qualification, conversion and pipeline value</caption>
          <thead className="text-gray-400 text-left"><tr>
            <th scope="col" className="py-1.5 pr-2">Source</th><th scope="col" className="py-1.5 pr-2 text-right">Leads</th>
            <th scope="col" className="py-1.5 pr-2 text-right">Qualified</th><th scope="col" className="py-1.5 pr-2 text-right">Converted</th>
            <th scope="col" className="py-1.5 pr-2 text-right">Conv. Rate</th><th scope="col" className="py-1.5 text-right">Pipeline Value</th>
          </tr></thead>
          <tbody>
            {sorted.map((s) => {
              const highVolumeLowConversion = s.leadCount >= 5 && s.conversionRate < avgConversion * 0.5;
              return (
                <tr key={s.source} className="border-t border-gray-800">
                  <td className="py-1.5 pr-2">
                    <button onClick={() => navigate(`/crm/leads?source=${encodeURIComponent(s.source)}`)} className="text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded">{s.source}</button>
                  </td>
                  <td className="py-1.5 pr-2 text-right text-gray-300">{s.leadCount}</td>
                  <td className="py-1.5 pr-2 text-right text-gray-300">{s.qualifiedCount}</td>
                  <td className="py-1.5 pr-2 text-right text-gray-300">{s.convertedCount}</td>
                  <td className="py-1.5 pr-2 text-right">
                    <span className="flex items-center justify-end gap-1 text-gray-300">
                      {highVolumeLowConversion && <AlertTriangle size={11} className="text-amber-400" aria-hidden="true" />}
                      {s.conversionRate}%
                    </span>
                    {highVolumeLowConversion && <span className="sr-only">High volume, low conversion relative to other sources</span>}
                  </td>
                  <td className="py-1.5 text-right text-gray-300">{formatByCurrency(s.pipelineValueByCurrency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-500 mt-2">Sources highlighted with a warning icon have noticeably higher lead volume than conversion rate — this reflects fixture data only, not a causal explanation.</p>
    </div>
  );
}
