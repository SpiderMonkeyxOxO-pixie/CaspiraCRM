// Backend Phase 10 — Copilot memory.
//
//   Turn context          built per request, gone when it completes.
//   Conversation memory   recent turns, selected records, open questions and a
//                         deterministic summary — scoped to one conversation.
//   Durable user memory   preferences ONLY (five keys), visible, editable,
//                         deletable, organization-bound, source-attributed,
//                         time-stamped and expirable. Never saved because a
//                         model asked: a suggestion becomes a PROPOSED memory
//                         the user saves, edits or rejects.
// Personal data, financial values, credentials, HR/health information and
// model conclusions are refused as memory values.
import prisma from "../../lib/prisma.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { COPILOT_MEMORY_KEYS } from "../catalog.js";

export const MEMORY_KEYS = {
  summary_length: { label: "Preferred summary length", values: ["short", "medium", "detailed"] },
  currency_display: { label: "Currency display", pattern: /^[A-Z]{3}( symbol| code)?$/ },
  report_style: { label: "Report style", values: ["bullets", "narrative", "table"] },
  default_scope: { label: "Default analysis scope", values: ["mine", "team", "department", "organization"] },
  preferred_mode: { label: "Preferred Copilot mode", values: ["ask", "briefing", "meeting", "pipeline", "renewal", "data_quality", "daily"] },
};
const DEFAULT_TTL_DAYS = 180;

// Sensitive content that must never become memory.
const SENSITIVE = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/, "an email address"], [/\+?\d[\d\s().-]{7,}\d/, "a phone number"],
  [/[$€£¥₱]\s?\d|\b\d{1,3}(,\d{3})+(\.\d+)?\b|\b\d+(\.\d+)?\s?(usd|eur|php|gbp)\b/i, "a financial value"],
  [/password|passcode|token|api[_ -]?key|secret|credential/i, "authentication information"],
  [/salary|disciplin|diagnos|medical|health|pregnan|religio/i, "HR or health information"],
];

export function validateMemoryValue(key, rawValue) {
  const def = MEMORY_KEYS[key];
  if (!def || !COPILOT_MEMORY_KEYS.includes(key)) throw new AiError(CATEGORIES.INVALID_REQUEST, `Only these preferences can be remembered: ${Object.values(MEMORY_KEYS).map((d) => d.label).join(", ")}.`);
  const value = String(rawValue ?? "").trim();
  for (const [re, what] of SENSITIVE) if (re.test(value)) throw new AiError(CATEGORIES.INVALID_REQUEST, `This can't be remembered: it looks like ${what}. Business facts stay on their records.`);
  if (def.values && !def.values.includes(value.toLowerCase())) throw new AiError(CATEGORIES.INVALID_REQUEST, `${def.label} must be one of: ${def.values.join(", ")}.`);
  if (def.pattern && !def.pattern.test(value)) throw new AiError(CATEGORIES.INVALID_REQUEST, `${def.label} must look like "USD" or "USD symbol".`);
  return def.values ? value.toLowerCase() : value;
}

const event = (m, ev, membershipId, before, after) => prisma.aiCopilotMemoryEvent.create({ data: { organizationId: m.organizationId, memoryId: m.id, membershipId, event: ev, before, after } });

export function serializeMemory(m) {
  return { _id: m.id, key: m.key, label: MEMORY_KEYS[m.key]?.label || m.key, value: m.value, sensitivity: m.sensitivity, source: m.source, sourceMessageId: m.sourceMessageId, status: m.status, expiresAt: m.expiresAt, createdAt: m.createdAt, updatedAt: m.updatedAt, version: m.version };
}

export async function listMemories(req) {
  await expireMemories(req.organizationId);
  return prisma.aiCopilotMemory.findMany({ where: { organizationId: req.organizationId, membershipId: req.membership.id, status: { in: ["Active", "Proposed"] } }, orderBy: { createdAt: "desc" } });
}

// A preference the user saves directly (source: User).
export async function saveMemory(req, { key, value, expiresInDays }) {
  const clean = validateMemoryValue(key, value);
  const days = Math.min(730, Math.max(1, Number(expiresInDays) || DEFAULT_TTL_DAYS));
  await retireActive(req, key, "Replaced by a newer preference");
  const m = await prisma.aiCopilotMemory.create({ data: { organizationId: req.organizationId, membershipId: req.membership.id, key, value: clean, source: "User", status: "Active", expiresAt: new Date(Date.now() + days * 86_400_000) } });
  await event(m, "saved", req.membership.id, null, { key, value: clean });
  return m;
}

async function retireActive(req, key, why) {
  const active = await prisma.aiCopilotMemory.findMany({ where: { organizationId: req.organizationId, membershipId: req.membership.id, key, status: "Active" } });
  for (const a of active) { await prisma.aiCopilotMemory.update({ where: { id: a.id }, data: { status: "Expired" } }); await event(a, "expired", req.membership.id, { value: a.value }, { reason: why }); }
}

// A model's suggestion → Proposed (never Active). Invalid/sensitive → null.
export async function proposeMemory(req, { key, value, reason, messageId }) {
  let clean;
  try { clean = validateMemoryValue(key, value); } catch (err) { return { rejected: err.message }; }
  const existing = await prisma.aiCopilotMemory.findFirst({ where: { organizationId: req.organizationId, membershipId: req.membership.id, key, value: clean, status: { in: ["Active", "Proposed"] } } });
  if (existing) return { memory: existing, duplicate: true };
  const m = await prisma.aiCopilotMemory.create({ data: { organizationId: req.organizationId, membershipId: req.membership.id, key, value: clean, source: "Copilot suggestion", sourceMessageId: messageId || null, status: "Proposed", expiresAt: new Date(Date.now() + DEFAULT_TTL_DAYS * 86_400_000) } });
  await event(m, "proposed", req.membership.id, null, { key, value: clean, reason: String(reason || "").slice(0, 200) });
  return { memory: m };
}

async function loadOwn(req, id) {
  const m = await prisma.aiCopilotMemory.findFirst({ where: { id, organizationId: req.organizationId, membershipId: req.membership.id } });
  if (!m) throw new AiError(CATEGORIES.INVALID_REQUEST, "Memory not found.");
  return m;
}

// Save / edit (a proposal becomes Active only here, by the user).
export async function updateMemory(req, id, { value, status, version }) {
  const m = await loadOwn(req, id);
  if (version !== undefined && Number(version) !== m.version) throw new AiError(CATEGORIES.INVALID_REQUEST, "This memory changed. Refresh and try again.");
  const data = {};
  if (value !== undefined) data.value = validateMemoryValue(m.key, value);
  if (status === "Active") { if (!["Proposed", "Active"].includes(m.status)) throw new AiError(CATEGORIES.INVALID_REQUEST, `This memory is ${m.status.toLowerCase()}.`); await retireActive(req, m.key, "Replaced by a newer preference"); data.status = "Active"; }
  if (status === "Rejected") { if (m.status !== "Proposed") throw new AiError(CATEGORIES.INVALID_REQUEST, "Only a proposed memory can be rejected."); data.status = "Rejected"; }
  const updated = await prisma.aiCopilotMemory.update({ where: { id: m.id }, data: { ...data, version: { increment: 1 } } });
  await event(m, status === "Rejected" ? "rejected" : status === "Active" && m.status === "Proposed" ? "saved" : "edited", req.membership.id, { value: m.value, status: m.status }, { value: updated.value, status: updated.status });
  return updated;
}

export async function deleteMemory(req, id) {
  const m = await loadOwn(req, id);
  await prisma.aiCopilotMemory.update({ where: { id: m.id }, data: { status: "Deleted", value: "[deleted]" } });
  await event(m, "deleted", req.membership.id, { key: m.key }, null);
}

export async function expireMemory(req, id) {
  const m = await loadOwn(req, id);
  const updated = await prisma.aiCopilotMemory.update({ where: { id: m.id }, data: { status: "Expired", expiresAt: new Date() } });
  await event(m, "expired", req.membership.id, { value: m.value }, { reason: "Expired by the user" });
  return updated;
}

export async function expireMemories(organizationId = undefined, now = new Date()) {
  return (await prisma.aiCopilotMemory.updateMany({ where: { ...(organizationId && { organizationId }), status: { in: ["Active", "Proposed"] }, expiresAt: { lt: now } }, data: { status: "Expired" } })).count;
}

// Preferences handed to the model (active only; keys and values, nothing else).
export async function activePreferences(req) {
  const rows = await prisma.aiCopilotMemory.findMany({ where: { organizationId: req.organizationId, membershipId: req.membership.id, status: "Active", expiresAt: { gt: new Date() } } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ---- Conversation memory and compaction -------------------------------------------

export const COMPACT_AFTER = 12; // messages beyond the summary
export const RECENT_TURNS = 6;

// Deterministic compaction: keeps goals, decisions, selected records,
// citations, pending proposals, limitations and open questions; drops
// tool outputs, duplicates and drafts. The originals stay in history.
export async function compactConversation(conversation) {
  const messages = await prisma.aiCopilotMessage.findMany({ where: { conversationId: conversation.id, seq: { gt: 0 } }, orderBy: { seq: "asc" } });
  if (messages.length - (conversation.summaryThroughSeq || 0) <= COMPACT_AFTER) return conversation;
  const through = messages[messages.length - RECENT_TURNS - 1]?.seq ?? 0;
  const older = messages.filter((m) => m.seq <= through);
  const ids = older.map((m) => m.id);
  const [citations, parts, links, openQuestions] = await Promise.all([
    prisma.aiCopilotCitation.findMany({ where: { messageId: { in: ids }, status: "Valid" }, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.aiCopilotMessagePart.findMany({ where: { messageId: { in: ids }, kind: { in: ["proposal", "limitation"] } } }),
    prisma.aiCopilotContextLink.findMany({ where: { conversationId: conversation.id, removedAt: null } }),
    prisma.aiClarificationRequest.findMany({ where: { conversationId: conversation.id, status: "Open" } }),
  ]);
  const userGoals = [...new Set(older.filter((m) => m.role === "user").map((m) => m.content.slice(0, 200)))];
  const seenRecords = new Map();
  for (const c of citations) if (!seenRecords.has(`${c.recordType}:${c.recordId}`)) seenRecords.set(`${c.recordType}:${c.recordId}`, { recordType: c.recordType, recordId: c.recordId, label: c.label });
  const proposals = parts.filter((p) => p.kind === "proposal").map((p) => ({ actionType: p.data.actionType, status: p.data.status, target: `${p.data.targetType} ${p.data.targetId}` }));
  const summary = {
    label: "Conversation summary (generated from earlier messages — not a CRM record)",
    goals: userGoals.slice(0, 1).concat(userGoals.slice(-3)).filter((v, i, a) => a.indexOf(v) === i),
    decisions: proposals.filter((p) => ["Executed", "Awaiting Approval"].includes(p.status)),
    pendingProposals: proposals.filter((p) => p.status === "Awaiting Confirmation"),
    selectedRecords: links.map((l) => ({ recordType: l.recordType, recordId: l.recordId, label: l.label })),
    citedRecords: [...seenRecords.values()].slice(0, 15),
    limitations: [...new Set(parts.filter((p) => p.kind === "limitation").map((p) => p.data.text))].slice(0, 6),
    openQuestions: openQuestions.map((q) => q.question),
    compactedThroughSeq: through,
  };
  return prisma.aiCopilotConversation.update({ where: { id: conversation.id }, data: { summary, summaryThroughSeq: through } });
}

// Turn input: summary + recent turns + context links + open clarifications.
export async function conversationContext(conversation) {
  const [recent, links, open] = await Promise.all([
    prisma.aiCopilotMessage.findMany({ where: { conversationId: conversation.id, seq: { gt: conversation.summaryThroughSeq || 0 }, status: { in: ["Completed", "Completed with limitations", "Refused"] } }, orderBy: { seq: "desc" }, take: RECENT_TURNS }),
    prisma.aiCopilotContextLink.findMany({ where: { conversationId: conversation.id, removedAt: null } }),
    prisma.aiClarificationRequest.findMany({ where: { conversationId: conversation.id, status: "Open" } }),
  ]);
  return {
    history: { summary: conversation.summary || null, recent: recent.reverse().map((m) => ({ role: m.role, text: m.content.slice(0, 1200) })), openQuestions: open.map((o) => o.question) },
    context: links.map((l) => ({ recordType: l.recordType, recordId: l.recordId, label: l.label })),
  };
}
