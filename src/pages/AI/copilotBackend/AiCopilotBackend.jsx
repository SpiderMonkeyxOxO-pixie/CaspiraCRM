// AI Copilot, backend mode (VITE_BACKEND_AI_MODE=true). Conversations,
// answers, citations, workflows and memory all live in the CRM backend
// (Backend Phase 10). The model only ever sees records the signed-in person
// can open, every statement links to its source record, and changes are
// prepared as proposals that a person confirms.
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Plus, Send, Paperclip, Workflow, Brain, Archive, Trash2, X, Search, Menu } from "lucide-react";
import * as ai from "../../../Helpers/backendAiClient";
import { Badge, ErrorBox, Loading, SimulatorBanner } from "../../Admin/aiBackend/aiUi";
import { btn, btnPrimary, input, fmtDate } from "../../Admin/aiBackend/aiKit";
import CopilotMessage from "./CopilotMessage";
import { RUNNING } from "./copilotKit";
import { EvidenceDrawer, ContextPicker, WorkflowsDialog, MemoryDialog } from "./CopilotPanels";

const PROGRESS = {
  accepted: "Starting", checking_permission: "Checking permissions", resolving_context: "Reading the conversation context", searching: "Searching authorized records",
  calculating: "Calculating with CRM data", preparing_answer: "Preparing the answer", validating_citations: "Checking every source",
};
const STARTERS = [
  { label: "Prepare my day", workflow: "daily_preparation" },
  { label: "Review my pipeline", workflow: "pipeline_review" },
  { label: "Summarize a Company", dialog: "workflows" },
  { label: "Prepare for a meeting", dialog: "workflows" },
  { label: "Review renewals", workflow: "renewal_review" },
  { label: "Find data-quality issues", workflow: "data_quality_review" },
  { label: "Ask about an authorized record", dialog: "context" },
];
const MODES = [["ask", "Ask"], ["briefing", "Briefing"], ["meeting", "Meeting prep"], ["pipeline", "Pipeline"], ["renewal", "Renewals"], ["data_quality", "Data quality"], ["daily", "My day"]];

export default function AiCopilotBackend() {
  const [info, setInfo] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [messages, setMessages] = useState([]);
  const [progress, setProgress] = useState({});
  const [loadingConv, setLoadingConv] = useState(false);
  const [error, setError] = useState(null);
  const [text, setText] = useState("");
  const [pendingContext, setPendingContext] = useState(null);
  const [mode, setMode] = useState("ask");
  const [dialog, setDialog] = useState(null);
  const [citation, setCitation] = useState(null);
  const [sending, setSending] = useState(false);
  const [showList, setShowList] = useState(false);
  const watchers = useRef(new Map());
  const scrollRef = useRef(null);
  const activeRef = useRef(null);
  activeRef.current = activeId;

  const loadConversations = useCallback(async (q = search) => {
    try { setConversations((await ai.listCopilotConversations(q ? { search: q } : undefined)).conversations); } catch (e) { setError(ai.aiErrorMessage(e)); }
  }, [search]);

  const loadMessages = useCallback(async (id = activeRef.current) => {
    if (!id) return;
    const [d, m] = await Promise.all([ai.getCopilotConversation(id), ai.listCopilotMessages(id)]);
    if (activeRef.current !== id) return;
    setDetail(d); setMessages(m.messages); setMode(d.conversation.mode);
    for (const msg of m.messages) if (msg.role === "assistant" && RUNNING.includes(msg.status)) watch(msg._id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Follows one answer: live progress over SSE when available, plus polling
  // (covers proxies that buffer streams) until it finishes.
  const watch = useCallback((messageId) => {
    if (watchers.current.has(messageId)) return;
    const w = { es: null, timer: null };
    watchers.current.set(messageId, w);
    const stop = () => {
      w.es?.close(); clearInterval(w.timer); watchers.current.delete(messageId);
      setProgress((p) => { const n = { ...p }; delete n[messageId]; return n; });
    };
    const finish = async () => { stop(); try { await loadMessages(); await loadConversations(); } catch { /* shown on next action */ } };
    if (typeof window !== "undefined" && typeof window.EventSource === "function") {
      try {
        w.es = new window.EventSource(ai.copilotEventsUrl(messageId), { withCredentials: true });
        for (const type of Object.keys(PROGRESS)) w.es.addEventListener(type, () => setProgress((p) => ({ ...p, [messageId]: PROGRESS[type] })));
        for (const type of ["completed", "failed", "cancelled", "waiting_confirmation"]) w.es.addEventListener(type, finish);
        w.es.onerror = () => { w.es?.close(); w.es = null; };
      } catch { w.es = null; }
    }
    w.timer = setInterval(async () => {
      try { const { message } = await ai.getCopilotMessage(messageId); if (!RUNNING.includes(message.status)) finish(); } catch { stop(); }
    }, 2500);
  }, [loadMessages, loadConversations]);

  useEffect(() => {
    ai.copilotInfo().then(setInfo).catch((e) => setError(ai.aiErrorMessage(e)));
    loadConversations("");
    const current = watchers.current;
    return () => { for (const w of current.values()) { w.es?.close(); clearInterval(w.timer); } current.clear(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const node = scrollRef.current;
    if (node && typeof node.scrollTo === "function") node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const open = async (id) => {
    setActiveId(id); activeRef.current = id; setShowList(false); setError(null); setLoadingConv(true);
    try { await loadMessages(id); } catch (e) { setError(ai.aiErrorMessage(e)); } finally { setLoadingConv(false); }
  };
  const newChat = () => { setActiveId(null); activeRef.current = null; setDetail(null); setMessages([]); setPendingContext(null); setMode("ask"); setShowList(false); };

  const send = async (value = text) => {
    const body = value.trim();
    if (!body || sending) return;
    setSending(true); setError(null);
    try {
      let id = activeId;
      if (!id) {
        const { conversation } = await ai.createCopilotConversation({ mode, ...(pendingContext && { context: { recordType: pendingContext.recordType, recordId: pendingContext.recordId } }) });
        id = conversation._id; setActiveId(id); activeRef.current = id; setPendingContext(null);
      }
      setText("");
      const out = await ai.sendCopilotMessage(id, body);
      setMessages((m) => [...m, out.userMessage, out.assistantMessage]);
      if (RUNNING.includes(out.assistantMessage.status)) watch(out.assistantMessage._id);
      await loadMessages(id);
      loadConversations();
    } catch (e) { setError(ai.aiErrorMessage(e)); setText(body); } finally { setSending(false); }
  };

  const startWorkflow = async (key) => {
    setError(null);
    try { onWorkflowStarted(await ai.runCopilotWorkflow(key, {}, activeId || undefined)); } catch (e) { setError(ai.aiErrorMessage(e)); }
  };
  const onWorkflowStarted = async (out) => {
    setDialog(null);
    const id = out.conversation._id;
    setActiveId(id); activeRef.current = id;
    await loadMessages(id); loadConversations();
    // The run writes its answer asynchronously; follow it until it pauses or finishes.
    const runId = out.workflowRun._id;
    const t = setInterval(async () => {
      try {
        const { workflowRun } = await ai.getCopilotWorkflowRun(runId);
        if (!["Ready", "Running"].includes(workflowRun.status)) { clearInterval(t); if (activeRef.current === id) await loadMessages(id); loadConversations(); }
        else if (activeRef.current === id) await loadMessages(id);
      } catch { clearInterval(t); }
    }, 2500);
  };

  const addContext = async (r) => {
    setDialog(null);
    if (!activeId) { setPendingContext(r); return; }
    try { await ai.addCopilotContext(activeId, r.recordType, r.recordId); await loadMessages(); } catch (e) { setError(ai.aiErrorMessage(e)); }
  };
  const removeContext = async (c) => {
    try { await ai.removeCopilotContext(activeId, c._id); await loadMessages(); } catch (e) { setError(ai.aiErrorMessage(e)); }
  };
  const changeMode = async (m) => {
    setMode(m);
    if (activeId && detail && !detail.readOnly) {
      try { await ai.updateCopilotConversation(activeId, { mode: m, version: detail.conversation.version }); await loadMessages(); } catch (e) { setError(ai.aiErrorMessage(e)); }
    }
  };
  const archive = async (id) => { try { await ai.archiveCopilotConversation(id); if (id === activeId) newChat(); loadConversations(); } catch (e) { setError(ai.aiErrorMessage(e)); } };
  const remove = async (id) => {
    if (!window.confirm("Delete this conversation? Its messages are removed. CRM records are not changed.")) return;
    try { await ai.deleteCopilotConversation(id); if (id === activeId) newChat(); loadConversations(); } catch (e) { setError(ai.aiErrorMessage(e)); }
  };
  const stop = async (messageId) => { try { await ai.cancelCopilotMessage(messageId); await loadMessages(); } catch (e) { setError(ai.aiErrorMessage(e)); } };
  const regenerate = async (messageId) => {
    try { const out = await ai.regenerateCopilotMessage(messageId); await loadMessages(); watch(out.assistantMessage._id); } catch (e) { setError(ai.aiErrorMessage(e)); }
  };

  const readOnly = !!detail?.readOnly;
  const busy = messages.some((m) => m.role === "assistant" && RUNNING.includes(m.status));
  const context = detail?.context || [];

  return (
    <div className="flex h-[calc(100vh-4rem)] text-white relative">
      {/* Conversations */}
      <aside aria-label="Conversations" className={`${showList ? "flex" : "hidden"} md:flex flex-col w-full md:w-72 shrink-0 border-r border-gray-800 bg-[#0d0f15] absolute md:static inset-0 z-30`}>
        <div className="p-3 space-y-2 border-b border-gray-800">
          <div className="flex gap-2">
            <button type="button" className={`${btnPrimary} flex-1 inline-flex items-center justify-center gap-1`} onClick={newChat}><Plus size={14} aria-hidden="true" /> New conversation</button>
            <button type="button" className={`${btn} md:hidden`} aria-label="Close conversations" onClick={() => setShowList(false)}><X size={14} /></button>
          </div>
          <form data-tour="copilot-history" role="search" onSubmit={(e) => { e.preventDefault(); loadConversations(search); }} className="relative">
            <label htmlFor="copilot-search" className="sr-only">Search conversations</label>
            <Search size={13} className="absolute left-2.5 top-2.5 text-gray-500" aria-hidden="true" />
            <input id="copilot-search" className={`${input} pl-8`} placeholder="Search conversations" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
        </div>
        <ul className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 && <li className="text-xs text-gray-500 px-2 py-3">No conversations yet.</li>}
          {conversations.map((c) => (
            <li key={c._id} className={`group rounded-lg ${c._id === activeId ? "bg-gray-800" : "hover:bg-gray-800/50"}`}>
              <div className="flex items-center">
                <button type="button" className="flex-1 text-left px-3 py-2 min-w-0" onClick={() => open(c._id)} aria-current={c._id === activeId ? "true" : undefined}>
                  <span className="block text-sm truncate">{c.title}</span>
                  <span className="block text-[11px] text-gray-500">{fmtDate(c.lastMessageAt || c.createdAt)}</span>
                </button>
                <button type="button" className="p-1.5 text-gray-500 hover:text-gray-200 opacity-100 md:opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Archive ${c.title}`} onClick={() => archive(c._id)}><Archive size={13} /></button>
                <button type="button" className="p-1.5 mr-1 text-gray-500 hover:text-red-300 opacity-100 md:opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${c.title}`} onClick={() => remove(c._id)}><Trash2 size={13} /></button>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {/* Conversation */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-center gap-2">
          <button type="button" className={`${btn} md:hidden`} aria-label="Show conversations" onClick={() => setShowList(true)}><Menu size={14} /></button>
          <h1 className="text-lg font-semibold flex items-center gap-2 mr-auto"><Sparkles size={18} className="text-violet-300" aria-hidden="true" /> AI Copilot</h1>
          <label htmlFor="copilot-mode" className="sr-only">Mode</label>
          <select data-tour="copilot-mode" id="copilot-mode" className={`${input} w-auto`} value={mode} disabled={readOnly} onChange={(e) => changeMode(e.target.value)}>
            {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {info?.permissions?.workflows && <button type="button" className={`${btn} inline-flex items-center gap-1`} onClick={() => setDialog("workflows")}><Workflow size={14} aria-hidden="true" /> Workflows</button>}
          {info?.permissions?.memory && <button type="button" className={`${btn} inline-flex items-center gap-1`} onClick={() => setDialog("memory")}><Brain size={14} aria-hidden="true" /> Memory</button>}
        </header>

        {info?.simulatorLabel && <div className="px-4 pt-3"><SimulatorBanner label={info.simulatorLabel} /></div>}
        {readOnly && <p role="note" className="mx-4 mt-3 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">You're reviewing someone else's conversation for audit. It's read-only, and this access is recorded.</p>}
        <div className="px-4 pt-3"><ErrorBox error={error} /></div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4" aria-live="polite" aria-busy={busy}>
          {loadingConv && <Loading what="Loading conversation…" />}
          {!loadingConv && messages.length === 0 && (
            <div className="max-w-2xl mx-auto text-center space-y-5 pt-6">
              <Sparkles size={32} className="mx-auto text-violet-300" aria-hidden="true" />
              <div>
                <h2 className="text-xl font-semibold">How can the Copilot help?</h2>
                <p className="text-sm text-gray-400 mt-1">It reads only records you can open, cites every statement, and never changes anything without your confirmation.</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.filter((s) => !s.workflow || info?.permissions?.workflows).map((s) => (
                  <button key={s.label} type="button" className={btn} onClick={() => (s.workflow ? startWorkflow(s.workflow) : setDialog(s.dialog))}>{s.label}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m._id} className="max-w-3xl mx-auto">
              <CopilotMessage message={m} progress={progress[m._id]} readOnly={readOnly} onCite={setCitation}
                onStop={() => stop(m._id)} onRegenerate={() => regenerate(m._id)} onChanged={() => loadMessages()} onError={setError} />
            </div>
          ))}
        </div>

        {!readOnly && (
          <div className="border-t border-gray-800 px-4 py-3">
            <div className="max-w-3xl mx-auto space-y-2">
              {(context.length > 0 || pendingContext) && (
                <ul className="flex flex-wrap gap-2" aria-label="Records in context">
                  {pendingContext && <li><Badge tone="blue">{pendingContext.label} · {pendingContext.recordType}</Badge> <button type="button" aria-label={`Remove ${pendingContext.label}`} onClick={() => setPendingContext(null)} className="text-gray-500"><X size={12} /></button></li>}
                  {context.map((c) => <li key={c._id} className="inline-flex items-center gap-1"><Badge tone="blue">{c.label} · {c.recordType}</Badge><button type="button" aria-label={`Remove ${c.label}`} onClick={() => removeContext(c)} className="text-gray-500 hover:text-gray-300"><X size={12} /></button></li>)}
                </ul>
              )}
              <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <button data-tour="copilot-attach" type="button" className={`${btn} shrink-0`} aria-label="Add a record to the conversation" title="Add a record" onClick={() => setDialog("context")}><Paperclip size={15} /></button>
                <label htmlFor="copilot-input" className="sr-only">Message the Copilot</label>
                <textarea data-tour="copilot-input" id="copilot-input" rows={1} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Ask about your pipeline, a company, renewals…" className={`${input} resize-none min-h-[2.5rem] max-h-40`} />
                <button type="submit" className={`${btnPrimary} shrink-0`} disabled={!text.trim() || sending || busy} aria-label="Send"><Send size={15} /></button>
              </form>
              <p className="text-[11px] text-gray-500 text-center">{info?.disclaimer || "AI Copilot uses authorized CRM data and may make mistakes. Verify important information and approve actions before they are applied."}</p>
            </div>
          </div>
        )}
      </main>

      <EvidenceDrawer citation={citation} onClose={() => setCitation(null)} />
      {dialog === "context" && <ContextPicker onClose={() => setDialog(null)} onPick={addContext} />}
      {dialog === "workflows" && <WorkflowsDialog onClose={() => setDialog(null)} onStarted={onWorkflowStarted} />}
      {dialog === "memory" && <MemoryDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
