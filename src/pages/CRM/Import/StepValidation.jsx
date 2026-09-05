import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Download, X } from "lucide-react";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { downloadReport } from "./fileParser";

const FILTERS = ["All", "Valid", "Warning", "Invalid", "Duplicate", "Included", "Excluded"];

const STATUS_CONFIG = {
  valid: { color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: CheckCircle2 },
  warning: { color: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: AlertTriangle },
  invalid: { color: "bg-red-500/15 text-red-300 border-red-500/30", icon: XCircle },
};

function StatusBadge({ status }) {
  const c = STATUS_CONFIG[status];
  const Icon = c.icon;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${c.color}`}><Icon size={11} /> {status}</span>;
}

export default function StepValidation({ recordType, config, rows, onUpdateRowValue, onToggleIncluded, onResetRow }) {
  const [filter, setFilter] = useState("All");
  const [detailRow, setDetailRow] = useState(null);

  const summary = useMemo(() => ({
    total: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    warning: rows.filter((r) => r.status === "warning").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
    duplicate: rows.filter((r) => r.isDuplicateInFile).length,
  }), [rows]);

  const filtered = rows.filter((r) => {
    if (filter === "All") return true;
    if (filter === "Duplicate") return r.isDuplicateInFile;
    if (filter === "Included") return r.included;
    if (filter === "Excluded") return !r.included;
    return r.status === filter.toLowerCase();
  });

  const downloadErrors = () => {
    const problemRows = rows.filter((r) => r.status !== "valid");
    const lines = [];
    for (const r of problemRows) {
      for (const [field, message] of Object.entries({ ...r.errors, ...r.warnings })) {
        lines.push({
          rowNumber: r.rowIndex + 1, identifier: r.identifier, field,
          original: r.originalValues?.[field] ?? "", error: message,
          suggestion: /email/i.test(field) ? "Check for typos and confirm the domain" : /date/i.test(field) ? "Use YYYY-MM-DD format" : "Review and correct manually",
        });
      }
    }
    downloadReport(`${recordType}_import_errors.xlsx`, lines, [
      { key: "rowNumber", label: "Original Row" }, { key: "identifier", label: "Record" }, { key: "field", label: "Field" },
      { key: "original", label: "Original Value" }, { key: "error", label: "Error" }, { key: "suggestion", label: "Suggested Correction" },
    ]);
  };

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-base font-semibold">Validate your rows</h2>
        <button onClick={downloadErrors} disabled={summary.invalid + summary.warning === 0} className="flex items-center gap-1.5 text-xs text-blue-400 hover:underline disabled:opacity-40 disabled:no-underline">
          <Download size={12} /> Download Error Report
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {[
          ["Total Rows", summary.total, ""], ["Valid", summary.valid, "text-emerald-400"], ["Warnings", summary.warning, "text-amber-400"],
          ["Invalid", summary.invalid, "text-red-400"], ["Possible Duplicates", summary.duplicate, "text-amber-400"],
        ].map(([label, value, color]) => (
          <div key={label} className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
            <p className="text-xs text-gray-400 uppercase">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1 mb-3 overflow-x-auto" role="tablist" aria-label="Filter validation rows">
        {FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap border ${filter === f ? "bg-blue-700 border-blue-600" : "border-gray-700 text-gray-300 hover:bg-gray-800"}`}>
            {f}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto border border-gray-800 rounded-xl">
        <table className="w-full text-xs">
          <caption className="sr-only">Validation results per row, with error/warning counts and inclusion state</caption>
          <thead className="bg-gray-900/60 text-gray-400 text-left">
            <tr>
              <th scope="col" className="px-3 py-2">Row</th><th scope="col" className="px-3 py-2">Record</th><th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2 text-right">Errors</th><th scope="col" className="px-3 py-2 text-right">Warnings</th>
              <th scope="col" className="px-3 py-2">Problem Fields</th><th scope="col" className="px-3 py-2">Included</th><th scope="col" className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">No rows match this filter.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.rowIndex} className="border-t border-gray-800">
                <td className="px-3 py-2 text-gray-300">{r.rowIndex + 1}</td>
                <td className="px-3 py-2 text-gray-300 max-w-40 truncate" title={r.identifier}>{r.identifier}{r.isDuplicateInFile && <span className="text-amber-400"> (dup)</span>}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-2 text-right text-red-300">{Object.keys(r.errors).length}</td>
                <td className="px-3 py-2 text-right text-amber-300">{Object.keys(r.warnings).length}</td>
                <td className="px-3 py-2 text-gray-400 max-w-40 truncate" title={[...Object.keys(r.errors), ...Object.keys(r.warnings)].join(", ")}>
                  {[...Object.keys(r.errors), ...Object.keys(r.warnings)].join(", ") || "—"}
                </td>
                <td className="px-3 py-2">
                  <label className="sr-only">Include row {r.rowIndex + 1}</label>
                  <input type="checkbox" checked={r.included} onChange={() => onToggleIncluded(r.rowIndex)} aria-label={`Include row ${r.rowIndex + 1} in the import`} />
                </td>
                <td className="px-3 py-2"><button onClick={() => setDetailRow(r)} className="text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded">View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detailRow && (
        <RowDetailDrawer
          row={rows.find((r) => r.rowIndex === detailRow.rowIndex) || detailRow}
          config={config}
          onClose={() => setDetailRow(null)}
          onUpdateRowValue={onUpdateRowValue}
          onResetRow={onResetRow}
        />
      )}
    </div>
  );
}

function RowDetailDrawer({ row, config, onClose, onUpdateRowValue, onResetRow }) {
  const containerRef = useFocusTrap(true, onClose);
  const fieldKeys = Object.keys({ ...row.values, ...row.originalValues });

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label={`Row ${row.rowIndex + 1} details`}
        className="relative w-full sm:max-w-md h-full bg-gray-900 border-l border-gray-800 overflow-y-auto p-6 space-y-4 shadow-2xl">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-bold">Row {row.rowIndex + 1}</h2>
            <p className="text-sm text-gray-400">{row.identifier}</p>
          </div>
          <button onClick={onClose} aria-label="Close row details"><X size={20} /></button>
        </div>
        <StatusBadge status={row.status} />

        <div className="space-y-3">
          {fieldKeys.map((key) => {
            const fieldDef = config.destinationFields.find((f) => f.key === key);
            const label = fieldDef?.label || key;
            const error = row.errors[key];
            const warning = row.warnings[key];
            const original = row.originalValues?.[key];
            const current = row.values[key];
            const wasCorrected = original !== undefined && JSON.stringify(original) !== JSON.stringify(current);
            const displayValue = Array.isArray(current) ? current.join(", ") : current ?? "";
            return (
              <div key={key} className={`rounded-lg p-2.5 ${error ? "bg-red-900/10 border border-red-800/30" : warning ? "bg-amber-900/10 border border-amber-800/30" : "bg-gray-800/30"}`}>
                <label htmlFor={`field-${key}`} className="block text-xs text-gray-400 mb-1">{label}</label>
                <input
                  id={`field-${key}`}
                  value={displayValue}
                  onChange={(e) => onUpdateRowValue(row.rowIndex, key, fieldDef?.multiValue ? e.target.value.split(",").map((t) => t.trim()).filter(Boolean) : e.target.value)}
                  className={`w-full bg-gray-900 border rounded-lg px-2 py-1.5 text-sm ${error ? "border-red-600" : warning ? "border-amber-600" : "border-gray-700"}`}
                />
                {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
                {warning && !error && <p className="text-xs text-amber-400 mt-1">{warning}</p>}
                {wasCorrected && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    Original: <span className="text-gray-400">{Array.isArray(original) ? original.join(", ") || "(empty)" : original || "(empty)"}</span>
                    {" · "}<button onClick={() => onResetRow(row.rowIndex, key)} className="text-blue-400 hover:underline">Reset to original</button>
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-500">Corrections apply to this session's parsed data only — the uploaded file itself is never modified.</p>
      </div>
    </div>
  );
}
