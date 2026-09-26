// A small card offering the tour the first time someone opens a page that
// has one. "Not now" remembers the page; the help panel can switch prompts off.
import { Compass, X } from "lucide-react";
import { useGuide } from "./GuideContext";

export default function TourPrompt() {
  const g = useGuide();
  if (!g?.shouldOffer || g.panelOpen) return null;
  return (
    <div role="status" className="fixed bottom-5 right-5 z-[55] w-80 rounded-xl border border-gray-700 bg-gray-900 text-white shadow-2xl p-4">
      <div className="flex items-start gap-3">
        <Compass className="text-blue-400 shrink-0 mt-0.5" size={20} />
        <div className="flex-1">
          <p className="font-semibold text-white">New to {g.guide.title}?</p>
          <p className="text-sm text-gray-300 mt-0.5">Take a short tour of this page ({g.guide.tour.length} steps).</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => g.startTour()} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm">Start the tour</button>
            <button type="button" onClick={g.dismissOffer} className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 text-sm">Not now</button>
          </div>
        </div>
        <button type="button" onClick={g.dismissOffer} aria-label="Dismiss" className="text-gray-400 hover:text-white"><X size={16} /></button>
      </div>
    </div>
  );
}
