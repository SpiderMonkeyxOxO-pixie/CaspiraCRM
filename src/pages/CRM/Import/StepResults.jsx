import { useNavigate } from "react-router-dom";
import { CheckCircle2, Download, RotateCcw, LayoutDashboard, List } from "lucide-react";
import { downloadReport } from "./fileParser";

const VIEW_ROUTES = {
  leads: "/crm/leads?sort=createdAt&order=desc",
  contacts: "/crm/contacts?source=Import&sort=createdAt&order=desc",
  companies: "/crm/companies?source=Import&sort=createdAt&order=desc",
  deals: "/crm/deals?source=Import&sort=createdAt&order=desc",
};

export default function StepResults({ recordType, config, session, results, onStartAnother }) {
  const navigate = useNavigate();

  const downloadResultReport = () => {
    const rows = [
      ...results.created.map((r) => ({ rowNumber: r.rowIndex + 1, identifier: r.identifier, outcome: "Created" })),
      ...results.updated.map((r) => ({ rowNumber: r.rowIndex + 1, identifier: r.identifier, outcome: "Updated (preview)" })),
      ...results.skipped.map((r) => ({ rowNumber: r.rowIndex + 1, identifier: r.identifier, outcome: "Skipped" })),
      ...results.invalid.map((r) => ({ rowNumber: r.rowIndex + 1, identifier: r.identifier, outcome: `Invalid: ${Object.values(r.errors).join("; ")}` })),
    ];
    downloadReport(`${recordType}_import_results.xlsx`, rows, [
      { key: "rowNumber", label: "Row" }, { key: "identifier", label: "Record" }, { key: "outcome", label: "Outcome" },
    ]);
  };

  const duration = session.completedAt && session.startedAt ? Math.round((session.completedAt - session.startedAt) / 1000) : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <CheckCircle2 size={20} className="text-emerald-400" />
        <h2 className="text-base font-semibold">Frontend import preview complete</h2>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Eligible records were added to this session's in-memory {config.label} state{duration !== null ? ` in about ${duration}s` : ""}. Nothing was sent to a server or database.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {[
          ["Created", results.created.length, "text-emerald-400"], ["Updated (Preview)", results.updated.length, "text-blue-400"],
          ["Skipped", results.skipped.length, ""], ["Invalid", results.invalid.length, "text-red-400"],
        ].map(([label, value, color]) => (
          <div key={label} className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
            <p className="text-xs text-gray-400 uppercase">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {results.warnings?.length > 0 && (
        <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200 mb-4">
          <p className="font-medium mb-1">Warnings</p>
          <ul className="list-disc list-inside space-y-0.5">{results.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      {/* Current session history */}
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 mb-4">
        <p className="text-xs font-semibold uppercase text-gray-400 mb-2">Current Session <span className="normal-case font-normal text-gray-500">(this browser session only)</span></p>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-300">
          <div><dt className="text-gray-500">Record Type</dt><dd>{config.label}</dd></div>
          <div><dt className="text-gray-500">File</dt><dd className="truncate" title={session.file?.name}>{session.file?.name}</dd></div>
          <div><dt className="text-gray-500">Started</dt><dd>{session.startedAt ? new Date(session.startedAt).toLocaleTimeString() : "—"}</dd></div>
          <div><dt className="text-gray-500">Completed</dt><dd>{session.completedAt ? new Date(session.completedAt).toLocaleTimeString() : "—"}</dd></div>
        </dl>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => navigate(VIEW_ROUTES[recordType])} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium">
          <List size={15} /> View Imported Records
        </button>
        <button onClick={downloadResultReport} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-4 py-2 rounded-lg text-sm">
          <Download size={15} /> Download Result Report
        </button>
        <button onClick={onStartAnother} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-4 py-2 rounded-lg text-sm">
          <RotateCcw size={15} /> Start Another Import
        </button>
        <button onClick={() => navigate("/crm/dashboard")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-4 py-2 rounded-lg text-sm">
          <LayoutDashboard size={15} /> Return to CRM Dashboard
        </button>
      </div>
    </div>
  );
}
