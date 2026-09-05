import { Download } from "lucide-react";
import { RECORD_TYPES, RECORD_TYPE_ORDER } from "./importConfig";
import { downloadTemplate } from "./fileParser";

export default function StepRecordType({ recordType, onSelect }) {
  return (
    <div>
      <h2 className="text-base font-semibold mb-1">Choose what you're importing</h2>
      <p className="text-sm text-gray-400 mb-4">Pick a record type. If you arrived here from another page, it's already preselected — you can still change it.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {RECORD_TYPE_ORDER.map((key) => {
          const config = RECORD_TYPES[key];
          const selected = recordType === key;
          return (
            <div key={key} className={`border rounded-xl p-4 ${selected ? "border-blue-600 bg-blue-900/10" : "border-gray-800 bg-gray-900/40"}`}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="radio" name="record-type" checked={selected} onChange={() => onSelect(key)} className="mt-1" />
                <div className="min-w-0">
                  <p className="font-medium">{config.label}</p>
                  <p className="text-sm text-gray-400 mt-0.5">{config.description}</p>
                  <p className="text-xs text-gray-500 mt-2"><span className="text-gray-400">Required:</span> {config.requiredFieldLabels.join(", ")}</p>
                  <p className="text-xs text-gray-500 mt-1"><span className="text-gray-400">Example use:</span> {config.exampleUse}</p>
                </div>
              </label>
              <button
                onClick={() => downloadTemplate(config)}
                className="flex items-center gap-1.5 text-xs text-blue-400 hover:underline mt-3"
              >
                <Download size={12} /> Download {config.label} Template
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
