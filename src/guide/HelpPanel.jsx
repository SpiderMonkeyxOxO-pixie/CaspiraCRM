// The Guide panel. "This page": what the current page is for, its parts and
// its tour. "User guide": how the system works as a whole (how the areas
// connect, integrations, AI, users, your account) and the welcome tour.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, ChevronRight, Compass, X } from "lucide-react";
import { useGuide } from "./GuideContext";
import { TOPICS, WELCOME } from "./content/topics";

const tabClass = (active) => `flex-1 px-3 py-2 text-sm font-medium border-b-2 ${active ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-white"}`;

function PageHelp({ g }) {
  const guide = g.guide;
  if (!guide) return <p className="text-gray-400">There's no guide for this page yet. The User guide tab explains the system as a whole.</p>;
  return (
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
  );
}

function UserGuide({ g, topicId, setTopicId }) {
  const navigate = useNavigate();
  const topic = TOPICS.find((t) => t.id === topicId);
  if (topic) {
    return (
      <>
        <button type="button" onClick={() => setTopicId(null)} className="flex items-center gap-1 text-blue-400 hover:underline"><ArrowLeft size={16} /> All topics</button>
        <h3 className="text-lg font-semibold text-white">{topic.title}</h3>
        {topic.body.map((p) => <p key={p} className="text-gray-300 leading-relaxed">{p}</p>)}
        {topic.links?.length > 0 && (
          <div className="pt-2 border-t border-gray-700">
            <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">Go to</p>
            <div className="flex flex-wrap gap-2">
              {topic.links.map(([label, to]) => (
                <button key={to} type="button" onClick={() => { g.closePanel(); navigate(to); }}
                  className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 text-sm">{label}</button>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }
  return (
    <>
      <button type="button" onClick={() => g.startTour(WELCOME)}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5">
        <Compass size={18} /> Replay the welcome tour
      </button>
      <ul className="space-y-2">
        {TOPICS.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setTopicId(t.id)}
              className="w-full text-left rounded-lg border border-gray-700 hover:bg-gray-800 p-3 flex items-center gap-3">
              <BookOpen size={18} className="text-blue-400 shrink-0" />
              <span className="flex-1">
                <span className="block font-medium text-white">{t.title}</span>
                <span className="block text-xs text-gray-400 mt-0.5">{t.summary}</span>
              </span>
              <ChevronRight size={16} className="text-gray-500" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function HelpPanel() {
  const g = useGuide();
  const ref = useRef(null);
  const [tab, setTab] = useState("page");
  const [topicId, setTopicId] = useState(null);

  useEffect(() => {
    if (!g?.panelOpen) return undefined;
    ref.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") g.closePanel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [g]);

  if (!g?.panelOpen) return null;
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/40" onClick={g.closePanel} />
      <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="help-title"
        className="absolute right-0 top-0 h-full w-full max-w-md bg-gray-900 border-l border-gray-700 text-white shadow-2xl flex flex-col outline-none">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Guide</p>
            <h2 id="help-title" className="text-xl font-semibold text-white mt-0.5">{tab === "page" ? g.guide?.title || "This page" : "User guide"}</h2>
          </div>
          <button type="button" onClick={g.closePanel} aria-label="Close guide" className="text-gray-400 hover:text-white p-1"><X size={20} /></button>
        </div>
        <div className="flex mt-3 px-5 border-b border-gray-700" role="tablist" aria-label="Guide sections">
          <button type="button" role="tab" aria-selected={tab === "page"} onClick={() => setTab("page")} className={tabClass(tab === "page")}>This page</button>
          <button type="button" role="tab" aria-selected={tab === "guide"} onClick={() => setTab("guide")} className={tabClass(tab === "guide")}>User guide</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
          {tab === "page" ? <PageHelp g={g} /> : <UserGuide g={g} topicId={topicId} setTopicId={setTopicId} />}
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
