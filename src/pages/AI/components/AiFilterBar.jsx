import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { AI_VIEWS, INSIGHT_PRIORITY_META, DATE_RANGE_PRESETS } from "../aiConfig";
import { CONFIDENCE_LEVELS } from "../aiTypes";
import { CRM_TEAM } from "../../../Helpers/mockUsersData";

const MODULES = [
  { value: "all", label: "All Modules" },
  { value: "sales", label: "Sales" },
  { value: "activities", label: "Activities" },
  { value: "data-quality", label: "Data Quality" },
  { value: "contracts", label: "Contracts" },
];

function Controls({ params, updateParam }) {
  return (
    <>
      <select value={params.range || "thisMonth"} onChange={(e) => updateParam("range", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm">
        {DATE_RANGE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      <select value={params.module || "all"} onChange={(e) => updateParam("module", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm">
        {MODULES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
      <select value={params.severity || "all"} onChange={(e) => updateParam("severity", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm">
        <option value="all">All Priorities</option>
        {Object.keys(INSIGHT_PRIORITY_META).map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <select value={params.confidence || "all"} onChange={(e) => updateParam("confidence", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm">
        <option value="all">All Confidence Levels</option>
        {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={params.owner || ""} onChange={(e) => updateParam("owner", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm">
        <option value="">Any Owner</option>
        {CRM_TEAM.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <select value={params.status || "active"} onChange={(e) => updateParam("status", e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm">
        <option value="active">Active insights</option>
        <option value="dismissed">Dismissed insights</option>
        <option value="all">All insights</option>
      </select>
    </>
  );
}

export default function AiFilterBar({ params, updateParam }) {
  const [showDrawer, setShowDrawer] = useState(false);

  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-1 mb-3" role="tablist" aria-label="AI Intelligence view">
        {AI_VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={params.view === v.id}
            onClick={() => updateParam("view", v.id)}
            title={v.description}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              params.view === v.id ? "bg-blue-600 text-white" : "bg-gray-900/60 text-gray-400 hover:text-gray-200 border border-gray-800"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="hidden lg:flex flex-wrap gap-2">
        <Controls params={params} updateParam={updateParam} />
      </div>

      <button
        onClick={() => setShowDrawer(true)}
        className="lg:hidden flex items-center gap-2 bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm"
      >
        <SlidersHorizontal size={16} /> Filters
      </button>

      {showDrawer && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60" onClick={() => setShowDrawer(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md bg-[#0b0f19] border border-gray-800 rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Filters</h2>
              <button onClick={() => setShowDrawer(false)} aria-label="Close filters"><X size={20} /></button>
            </div>
            <div className="flex flex-col gap-3">
              <Controls params={params} updateParam={updateParam} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
