import { Link } from "react-router-dom";
import { DUPLICATE_DECISIONS } from "./importDuplicates";

const RECORD_TYPE_ROUTES = { leads: "/crm/leads", contacts: "/crm/contacts", companies: "/crm/companies", deals: "/crm/deals" };

const CONFIDENCE_COLOR = { High: "text-red-300 border-red-700", Medium: "text-amber-300 border-amber-700", Low: "text-gray-300 border-gray-700" };

export default function StepDuplicates({ recordType, rows, onSetDecision }) {
  const flagged = rows.filter((r) => r.included && r.duplicateMatches?.length > 0);
  const route = RECORD_TYPE_ROUTES[recordType];

  if (flagged.length === 0) {
    return (
      <div>
        <h2 className="text-base font-semibold mb-2">Duplicate review</h2>
        <p className="text-sm text-gray-500">No possible duplicates found against the uploaded file, or against existing Leads, Contacts, Companies or Deals fixtures. Every included row will be created as new.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-base font-semibold mb-1">Duplicate review</h2>
      <p className="text-sm text-gray-400 mb-4">{flagged.length} row{flagged.length === 1 ? "" : "s"} look like they might already exist. Nothing is merged or updated automatically — choose how each should be handled.</p>

      <div className="space-y-3">
        {flagged.map((r) => {
          const topMatch = r.duplicateMatches[0];
          const decision = r.duplicateDecision || "reviewManually";
          return (
            <div key={r.rowIndex} className="border border-amber-800/30 bg-amber-900/5 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <p className="text-sm font-medium">Row {r.rowIndex + 1} — {r.identifier}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${CONFIDENCE_COLOR[topMatch.confidence]}`}>{topMatch.confidence} confidence</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 text-xs mb-2">
                <div className="bg-gray-900/50 rounded-lg p-2.5">
                  <p className="text-gray-500 mb-1">Imported record</p>
                  <p className="text-gray-200">{r.identifier}</p>
                  {r.values.email && <p className="text-gray-400">{r.values.email}</p>}
                  {r.values.phone && <p className="text-gray-400">{r.values.phone}</p>}
                </div>
                <div className="bg-gray-900/50 rounded-lg p-2.5">
                  <p className="text-gray-500 mb-1 flex items-center justify-between">
                    Existing fixture record
                    {route && <Link to={`${route}/${topMatch.existing._id}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">View →</Link>}
                  </p>
                  <p className="text-gray-200">{topMatch.existing.name}</p>
                  {topMatch.existing.email && <p className="text-gray-400">{topMatch.existing.email}</p>}
                  {topMatch.existing.phone && <p className="text-gray-400">{topMatch.existing.phone}</p>}
                </div>
              </div>
              <p className="text-[11px] text-gray-500 mb-1">Matched on: {topMatch.matchingFields.join(", ")}</p>
              {topMatch.differences.length > 0 && (
                <ul className="text-[11px] text-gray-500 mb-2 list-disc list-inside">
                  {topMatch.differences.map((d) => <li key={d.field}>{d.field}: "{d.imported}" vs existing "{d.existing}"</li>)}
                </ul>
              )}
              {r.duplicateMatches.length > 1 && <p className="text-[11px] text-gray-500 mb-2">+{r.duplicateMatches.length - 1} other possible match(es).</p>}

              <div className="flex flex-wrap gap-1.5">
                {DUPLICATE_DECISIONS.map((d) => (
                  <button key={d.key} onClick={() => onSetDecision(r.rowIndex, d.key)}
                    className={`px-2.5 py-1 rounded-full text-xs border ${decision === d.key ? "bg-blue-700 border-blue-600 text-white" : "border-gray-700 text-gray-300 hover:bg-gray-800"}`}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
