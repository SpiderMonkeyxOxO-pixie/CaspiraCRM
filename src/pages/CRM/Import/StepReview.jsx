import { useState } from "react";
import { ChevronDown, ChevronUp, PlayCircle } from "lucide-react";

function ExpandableSample({ title, items, count, tone }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between text-sm">
        <span>{title} <span className={`font-bold ${tone || ""}`}>{count}</span></span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        items.length === 0 ? <p className="text-xs text-gray-500 mt-2">None.</p> : (
          <ul className="text-xs text-gray-400 mt-2 space-y-1 max-h-32 overflow-y-auto">
            {items.slice(0, 10).map((r) => <li key={r.rowIndex}>Row {r.rowIndex + 1} — {r.identifier}</li>)}
            {items.length > 10 && <li className="text-gray-600">+{items.length - 10} more</li>}
          </ul>
        )
      )}
    </div>
  );
}

export default function StepReview({ config, file, activeSheetName, rows, onRunPreview, running }) {
  const toCreate = rows.filter((r) => r.included && r.status !== "invalid" && (!r.duplicateMatches?.length || r.duplicateDecision === "createNew"));
  const toUpdate = rows.filter((r) => r.included && r.status !== "invalid" && r.duplicateDecision === "previewUpdate");
  const toSkip = rows.filter((r) => !r.included || r.duplicateDecision === "skip");
  const invalid = rows.filter((r) => r.status === "invalid");
  const duplicatesFlagged = rows.filter((r) => r.duplicateMatches?.length > 0);
  const excluded = rows.filter((r) => !r.included);

  const owners = [...new Set(rows.map((r) => r.values.ownerId).filter(Boolean))];
  const tags = [...new Set(rows.flatMap((r) => r.values.tags || []))];

  return (
    <div>
      <h2 className="text-base font-semibold mb-1">Review before running the preview</h2>
      <p className="text-sm text-gray-400 mb-4">{config.label} · {file.name}{activeSheetName ? ` (${activeSheetName})` : ""} · {rows.length} total rows</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        {[
          ["Ready to Create", toCreate.length, ""], ["Preview Updates", toUpdate.length, "text-blue-400"],
          ["Skipped", toSkip.length, ""], ["Invalid", invalid.length, "text-red-400"],
          ["Duplicates Flagged", duplicatesFlagged.length, "text-amber-400"], ["Excluded", excluded.length, ""],
        ].map(([label, value, color]) => (
          <div key={label} className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
            <p className="text-xs text-gray-400 uppercase">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <ExpandableSample title="Records to create" items={toCreate} count={toCreate.length} />
        <ExpandableSample title="Existing records to update" items={toUpdate} count={toUpdate.length} tone="text-blue-400" />
        <ExpandableSample title="Records to skip" items={toSkip} count={toSkip.length} />
        <ExpandableSample title="Invalid records" items={invalid} count={invalid.length} tone="text-red-400" />
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 mb-4 text-xs text-gray-400 space-y-1">
        <p><span className="text-gray-300">Assigned owners:</span> {owners.length ? `${owners.length} distinct owner(s) resolved` : "None specified — records will be unassigned"}</p>
        <p><span className="text-gray-300">Tags:</span> {tags.length ? tags.join(", ") : "None"}</p>
        <p><span className="text-gray-300">Transformations:</span> applied per column mapping in the previous step, already reflected in the values above</p>
      </div>

      <div className="bg-blue-900/15 border border-blue-800/40 rounded-xl p-4 mb-4 text-sm text-blue-100">
        This preview updates only the current frontend session. No production records will be created or changed.
      </div>

      <button
        onClick={onRunPreview}
        disabled={running || toCreate.length + toUpdate.length === 0}
        className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm font-medium"
      >
        <PlayCircle size={16} /> {running ? "Running preview..." : "Run Frontend Import Preview"}
      </button>
    </div>
  );
}
