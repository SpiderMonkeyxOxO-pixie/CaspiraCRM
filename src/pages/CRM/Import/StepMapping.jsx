import { useMemo } from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { FULL_NAME_VIRTUAL_KEY, IGNORE_KEY } from "./importValidation";
import { TRANSFORM_TYPES, applyTransform } from "./importTransforms";

function sampleValuesFor(rows, colIndex) {
  const values = [];
  for (const row of rows) {
    const v = (row[colIndex] ?? "").toString().trim();
    if (v && !values.includes(v)) values.push(v);
    if (values.length >= 3) break;
  }
  return values;
}

export default function StepMapping({ recordType, config, headers, sampleRows, mapping, autoConfidence, transforms, onChangeMapping, onChangeTransform, onApplyRecommended, onResetAuto, onClearAll }) {
  const supportsFullName = recordType === "leads" || recordType === "contacts";

  // A destination is "duplicated" when more than one source column maps to
  // it and it doesn't explicitly support multiple values.
  const mappingCounts = useMemo(() => {
    const counts = {};
    Object.values(mapping).forEach((destKey) => {
      if (!destKey || destKey === IGNORE_KEY) return;
      counts[destKey] = (counts[destKey] || 0) + 1;
    });
    return counts;
  }, [mapping]);

  const isDuplicated = (destKey) => {
    if (!destKey || destKey === IGNORE_KEY || destKey === FULL_NAME_VIRTUAL_KEY) return false;
    const field = config.destinationFields.find((f) => f.key === destKey);
    return !field?.multiValue && mappingCounts[destKey] > 1;
  };

  const mappedRequiredKeys = new Set(Object.values(mapping).filter(Boolean));
  const requiredStatus = config.destinationFields.filter((f) => f.required).map((f) => ({ field: f, mapped: mappedRequiredKeys.has(f.key) }));
  const hasDuplicateMapping = Object.keys(mappingCounts).some((k) => isDuplicated(k));

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div>
          <h2 className="text-base font-semibold">Map your columns</h2>
          <p className="text-sm text-gray-400">Match each column from your file to a {config.label.slice(0, -1)} field, or ignore it.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={onApplyRecommended} className="text-xs text-blue-400 hover:underline">Apply recommended mapping</button>
          <button onClick={onResetAuto} className="text-xs text-gray-400 hover:underline">Reset automatic mapping</button>
          <button onClick={onClearAll} className="text-xs text-gray-400 hover:underline">Clear all</button>
        </div>
      </div>
      <p className="text-[11px] text-gray-500 mb-3">Mapping presets are a frontend convenience for this session only — they are not saved permanently.</p>

      {requiredStatus.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {requiredStatus.map(({ field, mapped }) => (
            <span key={field.key} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${mapped ? "border-emerald-700 text-emerald-300" : "border-red-700 text-red-300"}`}>
              {mapped ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {field.label} {mapped ? "mapped" : "required — not mapped"}
            </span>
          ))}
        </div>
      )}
      {hasDuplicateMapping && (
        <div role="alert" className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-sm text-amber-200 flex items-start gap-2 mb-3">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> More than one column is mapped to the same field below — only the last mapped column's value will be used for a single-value field.
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {headers.map((header, colIndex) => {
          const destKey = mapping[colIndex] || "";
          const samples = sampleValuesFor(sampleRows, colIndex);
          const confidence = autoConfidence[colIndex];
          const duplicated = isDuplicated(destKey);
          const fieldDef = config.destinationFields.find((f) => f.key === destKey);
          const transformKey = transforms[colIndex] || "";
          const previewSample = samples[0];
          const transformedPreview = transformKey && previewSample !== undefined ? applyTransform(transformKey, previewSample) : null;

          return (
            <div key={colIndex} className={`border rounded-xl p-3 ${duplicated ? "border-amber-700/50 bg-amber-900/5" : "border-gray-800 bg-gray-900/40"}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-sm font-medium truncate" title={header}>{header}</p>
                {confidence && destKey && <span className="text-[10px] text-emerald-400 shrink-0">Auto-mapped ({confidence})</span>}
              </div>
              <p className="text-xs text-gray-500 truncate mb-2" title={samples.join(", ")}>
                {samples.length ? `Sample: ${samples.join(", ")}` : "No sample values in this column"}
              </p>

              <label htmlFor={`map-${colIndex}`} className="sr-only">Destination field for column {header}</label>
              <select
                id={`map-${colIndex}`}
                value={destKey}
                onChange={(e) => onChangeMapping(colIndex, e.target.value || null)}
                className={`w-full bg-gray-800/60 border rounded-lg px-2 py-1.5 text-sm mb-1.5 ${duplicated ? "border-amber-600" : "border-gray-700"}`}
              >
                <option value="">Ignore this column</option>
                {supportsFullName && <option value={FULL_NAME_VIRTUAL_KEY}>Full Name (auto-split into first/last)</option>}
                {config.destinationFields.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}{f.required ? " (required)" : ""}</option>
                ))}
              </select>

              {fieldDef?.description && <p className="text-[11px] text-gray-500 mb-1.5">{fieldDef.description}</p>}

              {destKey && destKey !== IGNORE_KEY && (
                <>
                  <label htmlFor={`transform-${colIndex}`} className="sr-only">Transformation for column {header}</label>
                  <select id={`transform-${colIndex}`} value={transformKey} onChange={(e) => onChangeTransform(colIndex, e.target.value || null)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-xs">
                    <option value="">No transformation</option>
                    {TRANSFORM_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  {transformKey && previewSample !== undefined && (
                    <p className="text-[11px] text-gray-500 mt-1">
                      <span className="text-gray-400">{previewSample}</span> → <span className="text-emerald-300">{transformedPreview}</span>
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
