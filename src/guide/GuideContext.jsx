// Page guidance: the help panel ("?"), guided tours and the first-visit
// prompt. Mounted once in Layout, so every signed-in page gets it.
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import { guideFor } from "./registry";

const GuideContext = createContext(null);
const PREFS_KEY = "crm.guide";

function readPrefs(userId) {
  try { return JSON.parse(localStorage.getItem(`${PREFS_KEY}.${userId || "anon"}`)) || {}; } catch { return {}; }
}
function writePrefs(userId, prefs) {
  try { localStorage.setItem(`${PREFS_KEY}.${userId || "anon"}`, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

export function GuideProvider({ children, guides }) {
  const { pathname } = useLocation();
  const userId = useSelector((s) => s?.auth?.data?._id || s?.auth?.data?.id);
  const guide = useMemo(() => guideFor(pathname, guides), [pathname, guides]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tour, setTour] = useState(null); // the guide whose tour is running
  // Preferences per user (the signed-in user can load after the first render).
  const [byUser, setByUser] = useState({});
  const prefs = byUser[userId] ?? readPrefs(userId);

  const update = useCallback((change) => setByUser((all) => {
    const current = all[userId] ?? readPrefs(userId);
    const next = { ...current, ...change(current) };
    writePrefs(userId, next);
    return { ...all, [userId]: next };
  }), [userId]);
  const markSeen = useCallback((path) => update((p) => ({ seen: { ...(p.seen || {}), [path]: new Date().toISOString() } })), [update]);

  const value = useMemo(() => ({
    guide,
    panelOpen,
    openPanel: () => setPanelOpen(true),
    closePanel: () => setPanelOpen(false),
    tour,
    startTour: (g = guide) => { if (g?.tour?.length) { setPanelOpen(false); setTour(g); markSeen(g.path); } },
    endTour: () => setTour(null),
    // First-visit prompt: page has a tour, the user hasn't seen or dismissed it, prompts are on.
    shouldOffer: !!guide?.tour?.length && !tour && !prefs.promptsOff && !(prefs.seen || {})[guide.path],
    dismissOffer: () => guide && markSeen(guide.path),
    promptsOff: !!prefs.promptsOff,
    setPromptsOff: (off) => update(() => ({ promptsOff: !!off })),
    resetTours: () => update(() => ({ seen: {} })),
  }), [guide, panelOpen, tour, prefs, markSeen, update]);

  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its provider
export const useGuide = () => useContext(GuideContext);
