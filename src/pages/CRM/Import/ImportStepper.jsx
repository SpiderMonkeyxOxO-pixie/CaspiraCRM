import { Check } from "lucide-react";
import { WIZARD_STEPS } from "./importConfig";

// Desktop: horizontal stepper. Mobile: compact vertical list with the
// current step announced for screen readers via aria-current.
export default function ImportStepper({ current, furthestReached, onNavigate }) {
  return (
    <nav aria-label="Import wizard progress">
      <ol className="hidden md:flex items-center gap-1 mb-4" role="list">
        {WIZARD_STEPS.map((label, i) => {
          const done = i < current;
          const isCurrent = i === current;
          const reachable = i <= furthestReached;
          return (
            <li key={label} className="flex items-center">
              <button
                onClick={() => reachable && onNavigate(i)}
                disabled={!reachable}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap
                  ${isCurrent ? "bg-blue-700 text-white" : done ? "text-emerald-300 hover:bg-gray-800" : reachable ? "text-gray-300 hover:bg-gray-800" : "text-gray-600 cursor-not-allowed"}`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 ${isCurrent ? "bg-white text-blue-700" : done ? "bg-emerald-500/20 text-emerald-300" : "bg-gray-800 text-gray-400"}`}>
                  {done ? <Check size={11} /> : i + 1}
                </span>
                {label}
              </button>
              {i < WIZARD_STEPS.length - 1 && <span className="text-gray-700 mx-0.5">→</span>}
            </li>
          );
        })}
      </ol>

      <ol className="md:hidden flex gap-2 overflow-x-auto pb-2 mb-3" role="list">
        {WIZARD_STEPS.map((label, i) => {
          const done = i < current;
          const isCurrent = i === current;
          const reachable = i <= furthestReached;
          return (
            <li key={label} className="shrink-0">
              <button
                onClick={() => reachable && onNavigate(i)}
                disabled={!reachable}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs border whitespace-nowrap
                  ${isCurrent ? "bg-blue-700 border-blue-600 text-white" : done ? "border-emerald-700 text-emerald-300" : "border-gray-700 text-gray-400"}`}
              >
                <span className="w-4 h-4 rounded-full bg-black/20 flex items-center justify-center text-[9px]">{done ? <Check size={9} /> : i + 1}</span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
