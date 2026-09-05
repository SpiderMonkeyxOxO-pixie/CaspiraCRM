import { useState } from "react";
import { Plus, Pin, Bookmark, Trash2, MessageSquare } from "lucide-react";

const TABS = [
  { id: "history", label: "History" },
  { id: "saved", label: "Saved" },
  { id: "pinned", label: "Pinned" },
];

const EMPTY_MESSAGE = {
  history: "No conversations yet.",
  saved: "No saved conversations yet.",
  pinned: "No pinned conversations yet.",
};

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AiCopilotSidebar({ conversations, activeId, onNewChat, onSelect, onDelete, onTogglePinned, onToggleSaved }) {
  const [tab, setTab] = useState("history");

  const filtered = conversations
    .filter((c) => (tab === "saved" ? c.saved : tab === "pinned" ? c.pinned : true))
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return (
    <nav aria-label="Conversations" className="flex w-64 shrink-0 flex-col border-r border-gray-800 bg-gray-950/40">
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 px-3 py-2 text-sm font-medium text-white hover:from-blue-500 hover:to-blue-400"
        >
          <Plus className="h-4 w-4" /> New Chat
        </button>
      </div>

      <div role="tablist" aria-label="Conversation filter" className="flex gap-1 border-b border-gray-800 px-3 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              tab === t.id ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <p className="p-3 text-center text-xs text-gray-500">{EMPTY_MESSAGE[tab]}</p>
        ) : (
          filtered.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1 ${
                c.id === activeId ? "border-blue-500/30 bg-blue-600/15" : "border-transparent hover:bg-gray-800/60"
              }`}
            >
              <button onClick={() => onSelect(c.id)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left">
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-gray-200">{c.title}</p>
                  <p className="text-[10px] text-gray-500">{timeAgo(c.updatedAt)}</p>
                </div>
              </button>
              <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                <button
                  onClick={(e) => { e.stopPropagation(); onTogglePinned(c.id); }}
                  aria-label={c.pinned ? "Unpin conversation" : "Pin conversation"}
                  title={c.pinned ? "Unpin" : "Pin"}
                  className={`rounded p-1 ${c.pinned ? "text-amber-400" : "text-gray-500 hover:text-gray-300"}`}
                >
                  <Pin className="h-3 w-3" fill={c.pinned ? "currentColor" : "none"} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleSaved(c.id); }}
                  aria-label={c.saved ? "Unsave conversation" : "Save conversation"}
                  title={c.saved ? "Unsave" : "Save"}
                  className={`rounded p-1 ${c.saved ? "text-blue-400" : "text-gray-500 hover:text-gray-300"}`}
                >
                  <Bookmark className="h-3 w-3" fill={c.saved ? "currentColor" : "none"} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                  aria-label="Delete conversation"
                  title="Delete"
                  className="rounded p-1 text-gray-500 hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </nav>
  );
}
