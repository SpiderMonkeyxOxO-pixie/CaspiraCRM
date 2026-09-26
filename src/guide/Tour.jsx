// Guided tour: dims the page, highlights one part at a time and explains it.
// Steps point at data-tour="…" elements; a missing element shows the step in
// the middle of the page instead, so a tour never gets stuck.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useGuide } from "./GuideContext";

const PAD = 8;
const CARD_W = 340;

function findTarget(step) {
  if (!step?.target) return null;
  const el = document.querySelector(`[data-tour="${step.target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width || r.height ? el : null;
}

function cardPosition(rect) {
  const vw = window.innerWidth; const vh = window.innerHeight;
  if (!rect) return { left: Math.max(16, (vw - CARD_W) / 2), top: Math.max(16, vh / 2 - 120) };
  const left = Math.min(Math.max(16, rect.left), vw - CARD_W - 16);
  const below = rect.bottom + PAD + 12;
  // Below the highlight when it fits, otherwise above it, otherwise in view.
  if (below + 200 < vh) return { left, top: below };
  const above = rect.top - PAD - 12 - 200;
  return { left, top: above > 16 ? above : Math.max(16, vh - 240) };
}

export default function Tour() {
  const g = useGuide();
  const steps = g?.tour?.tour || [];
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const cardRef = useRef(null);
  const step = steps[index];

  const measure = useCallback(() => {
    const el = findTarget(step);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    const el = findTarget(step);
    if (el) el.scrollIntoView({ block: "center", behavior: "instant" });
    measure();
  }, [step, measure]);

  useEffect(() => {
    if (!g?.tour) return undefined;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [g?.tour, measure]);

  const close = useCallback(() => { setIndex(0); g?.endTour(); }, [g]);
  const next = useCallback(() => (index + 1 < steps.length ? setIndex(index + 1) : close()), [index, steps.length, close]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!g?.tour) return undefined;
    cardRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [g?.tour, index, close, next, back]);

  if (!g?.tour || !step) return null;
  const pos = cardPosition(rect);
  return (
    <div className="fixed inset-0 z-[70]" aria-live="polite">
      {/* Click-blocker; the dimming comes from the highlight's shadow (or plain when centered). */}
      <div className={`absolute inset-0 ${rect ? "" : "bg-black/55"}`} onClick={close} />
      {rect && (
        <div className="absolute rounded-lg ring-2 ring-blue-400 pointer-events-none transition-all duration-200"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }} />
      )}
      <div ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tour-title"
        className="absolute bg-gray-900 border border-gray-700 text-white rounded-xl shadow-2xl p-4 outline-none"
        style={{ left: pos.left, top: pos.top, width: CARD_W }}>
        <p className="text-xs text-gray-400">{g.tour.title} · step {index + 1} of {steps.length}</p>
        <h3 id="tour-title" className="text-base font-semibold text-white mt-1">{step.title}</h3>
        <p className="text-sm text-gray-300 mt-1.5 leading-relaxed">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={close} className="text-sm text-gray-400 hover:text-white">Skip tour</button>
          <div className="flex gap-2">
            {index > 0 && <button type="button" onClick={back} className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 text-sm">Back</button>}
            <button type="button" onClick={next} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm">{index + 1 < steps.length ? "Next" : "Done"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
