// The "?" side panel: what the current page is for and what its parts do.
import { useEffect, useRef } from "react";
import { Compass, X } from "lucide-react";
import { useGuide } from "./GuideContext";

export default function HelpPanel() {
  const g = useGuide();
  const ref = useRef(null);

  useEffect(() => {
    if (!g?.panelOpen) return undefined;
    ref.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") g.closePanel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [g]);

  if (!g?.panelOpen) return null;
  const guide = g.guide;
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/40" onClick={g.closePanel} />
      <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="help-title"
        className="absolute right-0 top-0 h-full w-full max-w-md bg-gray-900 border-l border-gray-700 text-white shadow-2xl flex flex-col outline-none">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-700">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Help for this page</p>
            <h2 id="help-title" className="text-xl font-semibold text-white mt-0.5">{guide?.title || "This page"}</h2>
          </div>
          <button type="button" onClick={g.closePanel} aria-label="Close help" className="text-gray-400 hover:text-white p-1"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
          {guide ? (
            <>
              <p className="text-gray-300 leading-relaxed">{guide.purpose}</p>
              {guide.tour?.length > 0 && (
                <button type="button" onClick={() => g.startTour(guide)}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5">
                  <Compass size={18} /> Take the tour ({guide.tour.length} steps)
                </button>
              )}
              {(guide.sections || []).map((s) => (
                <section key={s.heading}>
                  <h3 className="font-semibold text-white">{s.heading}</h3>
                  <p className="text-gray-300 mt-1 leading-relaxed">{s.body}</p>
                </section>
              ))}
              {guide.tips?.length > 0 && (
                <section className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
                  <h3 className="font-semibold text-blue-300">Tips</h3>
                  <ul className="mt-2 space-y-1.5 text-gray-300 list-disc pl-5">{guide.tips.map((t) => <li key={t}>{t}</li>)}</ul>
                </section>
              )}
            </>
          ) : (
            <p className="text-gray-400">There's no guide for this page yet.</p>
          )}
        </div>
        <div className="border-t border-gray-700 p-4 flex items-center justify-between gap-3 text-xs text-gray-400">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!g.promptsOff} onChange={(e) => g.setPromptsOff(!e.target.checked)} />
            Offer tours on pages I haven't visited
          </label>
          <button type="button" onClick={g.resetTours} className="text-blue-400 hover:underline">Show all tours again</button>
        </div>
      </aside>
    </div>
  );
}
