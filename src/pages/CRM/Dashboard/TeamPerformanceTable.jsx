import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronUp, ChevronDown, HelpCircle } from "lucide-react";
import { formatByCurrency } from "../Deals/dealUtils";

const COLUMNS = [
  { key: "assignedLeads", label: "Assigned Leads" },
  { key: "convertedLeads", label: "Converted Leads" },
  { key: "openDealsCount", label: "Open Deals" },
  { key: "pipelineValueByCurrency", label: "Pipeline Value", isMoney: true },
  { key: "wonValueByCurrency", label: "Won Value", isMoney: true },
  { key: "activitiesCompleted", label: "Activities Completed" },
  { key: "overdueActivities", label: "Overdue Activities" },
];

// Deliberately shows raw counts side by side rather than combining them into
// a single "score" — activity quantity is not a stand-in for quality.
export default function TeamPerformanceTable({ rows }) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState("pipelineValueByCurrency");
  const [order, setOrder] = useState("desc");

  const sortValue = (row) => {
    const v = row[sortKey];
    if (typeof v === "object") return Object.values(v).reduce((s, n) => s + n, 0);
    return v;
  };
  const sorted = [...rows].sort((a, b) => (order === "asc" ? sortValue(a) - sortValue(b) : sortValue(b) - sortValue(a)));

  const toggleSort = (key) => {
    if (sortKey === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setOrder("desc"); }
  };

  if (rows.length === 0) {
    return (
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <h2 className="font-semibold text-sm mb-2">Team Performance</h2>
        <p className="text-sm text-gray-500">No team members match the active filters.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <h2 className="font-semibold text-sm mb-3">Team Performance</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Per-owner leads, deals, pipeline value and activity counts</caption>
          <thead className="text-gray-400 text-left"><tr>
            <th scope="col" className="py-1.5 pr-2">Owner</th>
            {COLUMNS.map((c) => (
              <th key={c.key} scope="col" className="py-1.5 pr-2 text-right cursor-pointer select-none" onClick={() => toggleSort(c.key)}>
                <span className="inline-flex items-center gap-1 justify-end w-full" title={`Sort by ${c.label}`}>
                  {c.label}
                  {sortKey === c.key && (order === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                </span>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.owner.id} className="border-t border-gray-800">
                <td className="py-1.5 pr-2">
                  <button onClick={() => navigate(`/crm/deals?owner=${row.owner.id}`)} className="text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded">{row.owner.name}</button>
                </td>
                <td className="py-1.5 pr-2 text-right text-gray-300">{row.assignedLeads}</td>
                <td className="py-1.5 pr-2 text-right text-gray-300">{row.convertedLeads}</td>
                <td className="py-1.5 pr-2 text-right text-gray-300">{row.openDealsCount}</td>
                <td className="py-1.5 pr-2 text-right text-gray-300">{formatByCurrency(row.pipelineValueByCurrency)}</td>
                <td className="py-1.5 pr-2 text-right text-gray-300">{formatByCurrency(row.wonValueByCurrency)}</td>
                <td className="py-1.5 pr-2 text-right text-gray-300">{row.activitiesCompleted}</td>
                <td className={`py-1.5 text-right ${row.overdueActivities > 0 ? "text-amber-400" : "text-gray-300"}`}>{row.overdueActivities}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-500 mt-2 flex items-center gap-1"><HelpCircle size={11} /> Counts describe workload and pipeline, not a performance score — read them alongside context you already have about each rep.</p>
    </div>
  );
}
