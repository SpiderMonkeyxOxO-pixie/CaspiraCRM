import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  Sparkles, Info, Send, Trash2, ShieldOff, AlertTriangle, FlaskConical,
} from "lucide-react";
import {
  sendCopilotMessage, clearConversation, startNewChat, selectConversation, deleteConversation,
  togglePinned, toggleSaved, selectActiveConversation, selectConversations,
} from "../../redux/ai/aiCopilotSlice";
import { dismissInsight, restoreInsight, setFeedback, recordActionApplied, fetchAiProviderStatus } from "../../redux/ai/aiSlice";
import { runExploration, clearExploration } from "../../redux/ai/aiExploreSlice";
import { AI_PROVIDER_STATUS } from "./aiTypes";
import { canExecuteActions, canAccessAiOverview } from "./aiConfig";
import { SUGGESTED_PROMPTS } from "./aiCopilotEngine";
import AiEvidenceDrawer from "./components/AiEvidenceDrawer";
import AiActionPreviewModal from "./components/AiActionPreviewModal";
import ChatInsightAttachment from "./components/ChatInsightAttachment";
import AiExploreResultCard from "./components/AiExploreResultCard";
import AiCopilotSidebar from "./components/AiCopilotSidebar";
import ActivityFormModal from "../CRM/Activities/ActivityFormModal";
import DealFormModal from "../CRM/Deals/DealFormModal";

export default function AiCopilot() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const copilot = useSelector((s) => s.aiCopilot);
  const activeConversation = useSelector(selectActiveConversation);
  const conversations = useSelector(selectConversations);
  const explore = useSelector((s) => s.aiExplore);
  const providers = useSelector((s) => s.ai.providers);
  const dismissedIds = useSelector((s) => s.ai.dismissedIds);
  const feedbackByInsightId = useSelector((s) => s.ai.feedbackByInsightId);

  const [input, setInput] = useState("");
  const [exploreMode, setExploreMode] = useState(false);
  const [evidenceInsight, setEvidenceInsight] = useState(null);
  const [actionModal, setActionModal] = useState(null);
  const [formModal, setFormModal] = useState(null);
  const scrollRef = useRef(null);

  const allowed = canAccessAiOverview(role);
  const canExecute = canExecuteActions(role);
  const hasConfiguredProvider = providers.list.some((p) => p.configured);
  const isBusy = copilot.status === "thinking" || explore.status === "loading";

  useEffect(() => {
    dispatch(fetchAiProviderStatus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasConfiguredProvider) setExploreMode(false);
  }, [hasConfiguredProvider]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node && typeof node.scrollTo === "function") node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [activeConversation.messages, copilot.status, explore.findings]);

  const handleSend = (text) => {
    const value = (text ?? input).trim();
    if (!value || isBusy) return;
    if (exploreMode) {
      dispatch(runExploration({ question: value }));
    } else {
      dispatch(sendCopilotMessage(value));
    }
    setInput("");
  };

  const handleClear = () => {
    if (exploreMode) dispatch(clearExploration());
    else dispatch(clearConversation());
  };

  const handleApplyAction = (entry) => dispatch(recordActionApplied(entry));

  if (!allowed) {
    return (
      <div className="p-8 text-white">
        <div className="max-w-lg mx-auto text-center py-16">
          <ShieldOff className="h-10 w-10 text-gray-600 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">AI Intelligence is restricted</h1>
          <p className="text-sm text-gray-400">Your current role does not have permission to use the AI Copilot. Contact your administrator if you believe this is incorrect.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 text-white min-h-[calc(100vh-49px)] flex flex-col">
      <nav aria-label="Breadcrumb" className="text-xs text-gray-500 mb-2">AI Intelligence / Copilot</nav>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold">AI Copilot</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={exploreMode}
            disabled={!hasConfiguredProvider}
            onClick={() => setExploreMode((v) => !v)}
            title={!hasConfiguredProvider ? "No AI provider is configured on the server yet — ask an administrator to add one." : "Ask a real AI model to reason directly over your current records. Unverified — always confirm before acting."}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              exploreMode ? "border-purple-500/40 bg-purple-500/15 text-purple-300" : "border-gray-700 bg-gray-900/60 text-gray-400 hover:bg-gray-800"
            }`}
          >
            <FlaskConical className="h-3.5 w-3.5" /> Explore Mode (Experimental)
          </button>
          <span
            className="flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300 cursor-help"
            title="Answers are generated from the current frontend fixture data using fixed keyword matching. No information is being sent to an external AI provider."
          >
            <Sparkles className="h-3.5 w-3.5" /> {AI_PROVIDER_STATUS} <Info className="h-3 w-3" />
          </span>
        </div>
      </div>
      <p className="text-sm text-gray-400 mb-6">
        {exploreMode
          ? "Explore Mode sends your current records to a real AI provider and shows whatever it finds — unverified, and clearly labeled below. Every recommendation still requires human review."
          : "Ask about your current CRM and Sales data. Answers are calculated, not generated by a language model — every recommendation still requires human review."}
      </p>

      <div className="flex-1 flex rounded-2xl border border-gray-800 bg-gray-900/40 overflow-hidden min-h-[420px]">
        <AiCopilotSidebar
          conversations={conversations}
          activeId={activeConversation.id}
          onNewChat={() => dispatch(startNewChat())}
          onSelect={(id) => dispatch(selectConversation(id))}
          onDelete={(id) => dispatch(deleteConversation(id))}
          onTogglePinned={(id) => dispatch(togglePinned(id))}
          onToggleSaved={(id) => dispatch(toggleSaved(id))}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
        <div ref={scrollRef} role="log" aria-label="Conversation" className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeConversation.messages.length === 0 && (
            <div className="text-center py-10">
              <Sparkles className="h-8 w-8 text-blue-400 mx-auto mb-3" />
              <p className="text-sm text-gray-400 mb-4">Ask a question about your CRM and Sales data, or try one of these:</p>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button key={prompt} onClick={() => handleSend(prompt)} className="px-3 py-1.5 rounded-full border border-gray-700 text-xs text-gray-300 hover:bg-gray-800 hover:border-gray-600">
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeConversation.messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-md rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2.5 text-sm text-white">{message.text}</div>
              </div>
            ) : (
              <div key={message.id} className="flex justify-start">
                <div className="max-w-md">
                  <div className="rounded-2xl rounded-tl-sm bg-gray-800/80 px-4 py-2.5 text-sm text-gray-100 whitespace-pre-line">{message.text}</div>
                  {message.insight && (
                    <ChatInsightAttachment
                      insight={message.insight}
                      dismissed={dismissedIds.includes(message.insight.id)}
                      feedback={feedbackByInsightId[message.insight.id]}
                      canExecute={canExecute}
                      onOpenEvidence={setEvidenceInsight}
                      onOpenAction={(i, a) => setActionModal({ insight: i, action: a })}
                      onFeedback={(id, feedback) => dispatch(setFeedback({ insightId: id, feedback }))}
                      onDismiss={(id) => dispatch(dismissInsight(id))}
                      onRestore={(id) => dispatch(restoreInsight(id))}
                    />
                  )}
                </div>
              </div>
            )
          )}

          {copilot.status === "thinking" && (
            <div className="flex justify-start" role="status" aria-live="polite">
              <div className="rounded-2xl rounded-tl-sm bg-gray-800/80 px-4 py-2.5 text-sm text-gray-400 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-gray-500 animate-pulse" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-500 animate-pulse [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-500 animate-pulse [animation-delay:300ms]" />
                <span className="sr-only">Copilot is preparing an answer</span>
              </div>
            </div>
          )}

          {copilot.status === "error" && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {copilot.error}
            </div>
          )}

          {explore.status === "loading" && (
            <div className="flex justify-start" role="status" aria-live="polite">
              <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 px-4 py-2.5 text-sm text-purple-300 flex items-center gap-1.5">
                <FlaskConical className="h-3.5 w-3.5 animate-pulse" /> Exploring your current records…
              </div>
            </div>
          )}

          {explore.status === "error" && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {explore.error}
            </div>
          )}

          {explore.findings.map((run) => (
            <AiExploreResultCard
              key={run.id}
              run={run}
              dismissedIds={dismissedIds}
              feedbackByInsightId={feedbackByInsightId}
              canExecute={canExecute}
              onOpenEvidence={setEvidenceInsight}
              onOpenAction={(i, a) => setActionModal({ insight: i, action: a })}
              onFeedback={(id, feedback) => dispatch(setFeedback({ insightId: id, feedback }))}
              onDismiss={(id) => dispatch(dismissInsight(id))}
              onRestore={(id) => dispatch(restoreInsight(id))}
            />
          ))}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex items-center gap-2 border-t border-gray-800 p-3"
        >
          <button type="button" onClick={handleClear} title={exploreMode ? "Clear exploration results" : "Clear conversation"} aria-label={exploreMode ? "Clear exploration results" : "Clear conversation"}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-800 hover:text-gray-300 shrink-0">
            <Trash2 className="h-4 w-4" />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={exploreMode ? "Ask the AI model anything about your current records..." : "Ask about at-risk deals, pipeline value, data quality..."}
            className="flex-1 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || isBusy}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${
              exploreMode ? "bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400" : "bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400"
            }`}
          >
            <Send className="h-4 w-4" /> Send
          </button>
        </form>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-3">
        {exploreMode
          ? "Explore Mode — findings are written directly by a real AI provider reasoning over your current records. They are not verified by the deterministic engine and may be inaccurate; always confirm before acting."
          : "Frontend Analysis Preview — Copilot matches your question against a fixed set of supported topics (at-risk deals, pipeline value, data quality, overdue items, opportunities, contracts, lead conversion) and calculates the answer from current records. It does not understand open-ended questions the way a real AI assistant would."}
      </p>

      <AiEvidenceDrawer insight={evidenceInsight} onClose={() => setEvidenceInsight(null)} />
      {actionModal && (
        <AiActionPreviewModal
          insight={actionModal.insight}
          action={actionModal.action}
          canExecute={canExecute}
          onClose={() => setActionModal(null)}
          onApplied={handleApplyAction}
          onOpenForm={(type, prefill) => setFormModal({ type, prefill })}
        />
      )}
      {formModal?.type === "activity" && (
        <ActivityFormModal prefill={formModal.prefill} onClose={() => setFormModal(null)} onSaved={() => setFormModal(null)} />
      )}
      {formModal?.type === "deal" && (
        <DealFormModal prefill={formModal.prefill} onClose={() => setFormModal(null)} onSaved={() => setFormModal(null)} />
      )}
    </div>
  );
}
