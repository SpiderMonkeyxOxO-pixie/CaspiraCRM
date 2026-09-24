// Backend Phase 10 — /api/v1/ai/copilot. Conversations are private to their
// owner; people with ai_copilot_conversations:view_audit_history can read
// others' conversations (read-only, audited). The CRM is the system of
// record: provider-side conversation state is never used by default.
import prisma from "../../../lib/prisma.js";
import { hasGrant } from "../../../utils/grants.js";
import { guard, notFound, invalid, versionConflict, checkVersion } from "../../api/common.js";
import { aiAudit } from "../../common/audit.js";
import { SIMULATOR_LABEL, aiMode } from "../../common/mode.js";
import { runTurn, cancelTurn, copilotEvents, isActive, nextSeq, newPublicId, TOOLS } from "../orchestrator.js";
import { authorizeToolCall } from "../tools/registry.js";
import { listMemories, saveMemory, updateMemory, deleteMemory, expireMemory, serializeMemory, MEMORY_KEYS } from "../memory.js";
import { WORKFLOWS, startWorkflow, executeWorkflow, serializeRun } from "../workflows.js";
import { enqueueIndexJob, removeSource, INDEXED_TYPES } from "../retrieval/indexer.js";
import { embeddingConfig } from "../retrieval/embeddings.js";

const MODES = ["ask", "briefing", "meeting", "pipeline", "renewal", "data_quality", "daily"];
const TERMINAL = ["Completed", "Completed with limitations", "Cancelled", "Refused", "Failed", "Stale", "Awaiting tool"];
const CONTEXT_TOOL = { Company: "get_company", Deal: "get_deal", Contact: "get_contact", Lead: "get_lead", Contract: "get_contract", Quote: "get_quote", Order: "get_order", Ticket: "get_support_ticket", Project: "get_project" };

export const serializeConversation = (c) => ({
  _id: c.publicId, title: c.title, mode: c.mode, status: c.status, primaryContext: c.primaryContext, summary: c.summary, storageMode: c.storageMode,
  lastMessageAt: c.lastMessageAt, messageCount: c.messageCount, archivedAt: c.archivedAt, createdAt: c.createdAt, updatedAt: c.updatedAt, version: c.version,
});

async function loadConversation(req, id, { audit = false } = {}) {
  const c = await prisma.aiCopilotConversation.findFirst({ where: { organizationId: req.organizationId, publicId: String(id), status: { not: "Deleted" } } });
  if (!c) return null;
  if (c.membershipId === req.membership?.id) return c;
  if (audit && hasGrant(req, "ai_copilot_conversations", "view_audit_history")) {
    await aiAudit(req, "ai.copilot.conversation_reviewed", "AiCopilotConversation", c.id, { after: { owner: c.membershipId } });
    return { ...c, _auditView: true };
  }
  return null;
}

async function serializeMessages(messageIds) {
  const [parts, citations] = await Promise.all([
    prisma.aiCopilotMessagePart.findMany({ where: { messageId: { in: messageIds } }, orderBy: { seq: "asc" } }),
    prisma.aiCopilotCitation.findMany({ where: { messageId: { in: messageIds } }, orderBy: { citationKey: "asc" } }),
  ]);
  return (m) => ({
    _id: m.id, seq: m.seq, role: m.role, status: m.status, content: m.content, intent: m.intent, confidence: m.confidence, limitations: m.limitations, freshness: m.freshness,
    usage: m.usage, providerKey: m.providerKey, modelId: m.modelId, simulatorLabel: m.providerKey === "simulator" || aiMode() === "simulator" ? SIMULATOR_LABEL : null,
    errorCategory: m.errorCategory, safeError: m.safeError, parentMessageId: m.parentMessageId, workflowRunId: m.workflowRunId, createdAt: m.createdAt, completedAt: m.completedAt,
    parts: parts.filter((p) => p.messageId === m.id).map((p) => ({ kind: p.kind, data: p.data })),
    citations: citations.filter((c) => c.messageId === m.id).map((c) => ({ _id: c.id, key: c.citationKey, recordType: c.recordType, recordId: c.recordId, label: c.label, field: c.field, value: c.masked ? { masked: true } : c.value, masked: c.masked, recordTimestamp: c.recordTimestamp, sourceVersion: c.sourceVersion, route: c.status === "Valid" || c.status === "Stale" ? c.route : null, retrievalMethod: c.retrievalMethod, status: c.status })),
  });
}

// ---- Conversations ----------------------------------------------------------------

export const listConversations = guard(async (req, res) => {
  const q = req.query;
  const auditing = q.membershipId && q.membershipId !== req.membership?.id;
  if (auditing && !hasGrant(req, "ai_copilot_conversations", "view_audit_history")) return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "You can only see your own Copilot conversations." });
  const where = { organizationId: req.organizationId, membershipId: auditing ? String(q.membershipId) : req.membership.id, status: q.status ? String(q.status) : { in: ["Active", "Locked", "Restricted", "Provider unavailable"] } };
  if (q.search) where.OR = [{ title: { contains: String(q.search), mode: "insensitive" } }];
  if (q.mode) where.mode = String(q.mode);
  if (q.from || q.to) where.lastMessageAt = { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lte: new Date(q.to) }) };
  if (q.companyId) where.primaryContext = { path: ["recordId"], equals: String(q.companyId) };
  if (auditing) await aiAudit(req, "ai.copilot.conversations_reviewed", "OrganizationMembership", String(q.membershipId));
  const rows = await prisma.aiCopilotConversation.findMany({ where, orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }], take: 100 });
  res.json({ conversations: rows.map(serializeConversation), modes: MODES });
});

export const createConversation = guard(async (req, res) => {
  const mode = MODES.includes(req.body.mode) ? req.body.mode : "ask";
  let primaryContext = null;
  const ctx = req.body.context;
  if (ctx?.recordType && ctx?.recordId) {
    const verified = await verifyContextRecord(req, ctx.recordType, ctx.recordId);
    primaryContext = verified;
  }
  const c = await prisma.aiCopilotConversation.create({
    data: { publicId: newPublicId("acc"), organizationId: req.organizationId, userId: req.user?.id || null, membershipId: req.membership.id, title: String(req.body.title || (primaryContext ? `${primaryContext.label}` : "New conversation")).slice(0, 120), mode, primaryContext },
  });
  if (primaryContext) await prisma.aiCopilotContextLink.create({ data: { organizationId: req.organizationId, conversationId: c.id, ...primaryContext, addedByMembershipId: req.membership.id } });
  res.status(201).json({ conversation: serializeConversation(c) });
});

export const getConversation = guard(async (req, res) => {
  const c = await loadConversation(req, req.params.id, { audit: true });
  if (!c) return notFound(res, "Conversation");
  const links = await prisma.aiCopilotContextLink.findMany({ where: { conversationId: c.id, removedAt: null } });
  res.json({ conversation: serializeConversation(c), context: links.map((l) => ({ _id: l.id, recordType: l.recordType, recordId: l.recordId, label: l.label })), readOnly: !!c._auditView });
});

export const updateConversation = guard(async (req, res) => {
  const c = await loadConversation(req, req.params.id);
  if (!c) return notFound(res, "Conversation");
  if (!checkVersion(req.body, c)) return versionConflict(res, "conversation");
  const data = {};
  if ("title" in req.body) data.title = String(req.body.title || "Conversation").slice(0, 120);
  if ("mode" in req.body) { if (!MODES.includes(req.body.mode)) throw invalid(`mode: ${MODES.join(", ")}.`); data.mode = req.body.mode; }
  const u = await prisma.aiCopilotConversation.update({ where: { id: c.id }, data: { ...data, version: { increment: 1 } } });
  res.json({ conversation: serializeConversation(u) });
});

const setConversationStatus = (status) => guard(async (req, res) => {
  const c = await loadConversation(req, req.params.id);
  if (!c) return notFound(res, "Conversation");
  const u = await prisma.aiCopilotConversation.update({ where: { id: c.id }, data: { status, archivedAt: status === "Archived" ? new Date() : null, version: { increment: 1 } } });
  res.json({ conversation: serializeConversation(u) });
});
export const archiveConversation = setConversationStatus("Archived");
export const restoreConversation = setConversationStatus("Active");

// Deletion: content is removed (CRM records are never touched); audit metadata stays.
export const deleteConversation = guard(async (req, res) => {
  const c = await loadConversation(req, req.params.id);
  if (!c) return notFound(res, "Conversation");
  const messages = await prisma.aiCopilotMessage.findMany({ where: { conversationId: c.id }, select: { id: true } });
  const ids = messages.map((m) => m.id);
  const calls = await prisma.aiCopilotToolCall.findMany({ where: { conversationId: c.id }, select: { id: true } });
  await prisma.$transaction([
    prisma.aiCopilotToolResult.deleteMany({ where: { toolCallId: { in: calls.map((x) => x.id) } } }),
    prisma.aiCopilotToolCall.updateMany({ where: { conversationId: c.id }, data: { input: {} } }),
    prisma.aiCopilotMessagePart.deleteMany({ where: { messageId: { in: ids } } }),
    prisma.aiCopilotCitation.deleteMany({ where: { messageId: { in: ids } } }),
    prisma.aiCopilotMessage.updateMany({ where: { conversationId: c.id }, data: { content: "[deleted]", limitations: [], freshness: null } }),
    prisma.aiCopilotContextLink.deleteMany({ where: { conversationId: c.id } }),
    prisma.aiClarificationRequest.deleteMany({ where: { conversationId: c.id } }),
    prisma.aiRetrievalQuery.updateMany({ where: { conversationId: c.id }, data: { queryText: "[deleted]" } }),
    prisma.aiCopilotConversation.update({ where: { id: c.id }, data: { status: "Deleted", deletedAt: new Date(), title: "[deleted]", summary: null, primaryContext: null, providerConversationId: null } }),
  ]);
  await aiAudit(req, "ai.copilot.conversation_deleted", "AiCopilotConversation", c.id, { after: { messages: ids.length } });
  res.json({ ok: true, note: "Conversation content was deleted. CRM records were not changed. Audit metadata is kept." });
});

// ---- Messages ---------------------------------------------------------------------

export const listMessages = guard(async (req, res) => {
  const c = await loadConversation(req, req.params.id, { audit: true });
  if (!c) return notFound(res, "Conversation");
  const messages = await prisma.aiCopilotMessage.findMany({ where: { conversationId: c.id }, orderBy: { seq: "asc" }, take: 200 });
  const fmt = await serializeMessages(messages.map((m) => m.id));
  res.json({ messages: messages.map(fmt), readOnly: !!c._auditView });
});

async function startTurn(req, c, text, { parentMessageId = null } = {}) {
  const seq = await nextSeq(c.id);
  const assistant = await prisma.aiCopilotMessage.create({ data: { organizationId: req.organizationId, conversationId: c.id, seq, role: "assistant", status: "Queued", parentMessageId } });
  const done = runTurn(req, c, text, assistant);
  return { assistant, done };
}

export const sendMessage = guard(async (req, res) => {
  const c = await loadConversation(req, req.params.id);
  if (!c) return notFound(res, "Conversation");
  if (c.status !== "Active") throw invalid(`This conversation is ${c.status.toLowerCase()}.`);
  const text = String(req.body.text || "").trim();
  if (!text || text.length > 4000) throw invalid("Write a message (up to 4,000 characters).");
  const key = req.get("Idempotency-Key") || null;
  if (key) {
    const earlier = await prisma.aiCopilotMessage.findUnique({ where: { organizationId_idempotencyKey: { organizationId: req.organizationId, idempotencyKey: key } } });
    if (earlier) {
      const reply = await prisma.aiCopilotMessage.findFirst({ where: { conversationId: earlier.conversationId, seq: earlier.seq + 1 } });
      return res.status(200).json({ userMessage: { _id: earlier.id }, assistantMessage: reply ? { _id: reply.id, status: reply.status } : null, replayed: true });
    }
  }
  if (await prisma.aiCopilotMessage.findFirst({ where: { conversationId: c.id, role: "assistant", status: { in: ["Queued", "Classifying", "Retrieving", "Generating", "Validating"] } } })) throw invalid("The Copilot is still answering. Wait or stop it first.");
  const user = await prisma.aiCopilotMessage.create({ data: { organizationId: req.organizationId, conversationId: c.id, seq: await nextSeq(c.id), role: "user", status: "Completed", content: text, idempotencyKey: key, completedAt: new Date() } });
  if (c.messageCount === 0 && c.title === "New conversation") await prisma.aiCopilotConversation.update({ where: { id: c.id }, data: { title: text.slice(0, 80) } });
  await prisma.aiCopilotConversation.update({ where: { id: c.id }, data: { messageCount: { increment: 1 }, lastMessageAt: new Date() } });
  const { assistant, done } = await startTurn(req, c, text);
  if (req.body.wait === true || req.query.wait === "true") await done;
  else done.catch(() => {});
  const fresh = await prisma.aiCopilotMessage.findUnique({ where: { id: assistant.id } });
  const fmt = await serializeMessages([user.id, assistant.id]);
  res.status(req.body.wait ? 200 : 202).json({ userMessage: fmt(user), assistantMessage: fmt(fresh), eventsUrl: `/api/v1/ai/copilot/messages/${assistant.id}/events` });
});

async function loadOwnMessage(req, id) {
  const m = await prisma.aiCopilotMessage.findFirst({ where: { id: String(id), organizationId: req.organizationId } });
  if (!m) return null;
  const c = await loadConversation(req, (await prisma.aiCopilotConversation.findUnique({ where: { id: m.conversationId } }))?.publicId || "", { audit: true });
  return c ? { m, c } : null;
}

export const cancelMessage = guard(async (req, res) => {
  const found = await loadOwnMessage(req, req.params.id);
  if (!found || found.c._auditView) return notFound(res, "Message");
  const stopped = await cancelTurn(req.organizationId, found.m.id);
  if (!stopped && !TERMINAL.includes(found.m.status)) await prisma.aiCopilotMessage.update({ where: { id: found.m.id }, data: { status: "Cancelled", cancelledAt: new Date() } });
  for (let i = 0; i < 40 && isActive(found.m.id); i += 1) await new Promise((r) => { setTimeout(r, 50); });
  const m = await prisma.aiCopilotMessage.findUnique({ where: { id: found.m.id } });
  res.json({ message: { _id: m.id, status: m.status }, note: "Stopped. Usage already incurred is still recorded; earlier messages are kept." });
});

export const regenerateMessage = guard(async (req, res) => {
  const found = await loadOwnMessage(req, req.params.id);
  if (!found || found.c._auditView || found.m.role !== "assistant") return notFound(res, "Message");
  const user = await prisma.aiCopilotMessage.findFirst({ where: { conversationId: found.c.id, role: "user", seq: { lt: found.m.seq } }, orderBy: { seq: "desc" } });
  if (!user) throw invalid("There's no question to answer again.");
  const { assistant, done } = await startTurn(req, found.c, user.content, { parentMessageId: found.m.id });
  if (req.body.wait === true) await done; else done.catch(() => {});
  const fmt = await serializeMessages([assistant.id]);
  res.status(202).json({ assistantMessage: fmt(await prisma.aiCopilotMessage.findUnique({ where: { id: assistant.id } })), eventsUrl: `/api/v1/ai/copilot/messages/${assistant.id}/events` });
});

export const getMessage = guard(async (req, res) => {
  const found = await loadOwnMessage(req, req.params.id);
  if (!found) return notFound(res, "Message");
  const fmt = await serializeMessages([found.m.id]);
  res.json({ message: fmt(found.m) });
});

export const messageCitations = guard(async (req, res) => {
  const found = await loadOwnMessage(req, req.params.id);
  if (!found) return notFound(res, "Message");
  const fmt = await serializeMessages([found.m.id]);
  res.json({ citations: fmt(found.m).citations });
});

// SSE: current status, then live progress until the message finishes.
export async function messageEvents(req, res) {
  const found = await loadOwnMessage(req, req.params.id);
  if (!found) return res.status(404).json({ code: "AI_NOT_FOUND", message: "Message not found." });
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  send("status", { status: found.m.status });
  if (TERMINAL.includes(found.m.status)) { send("completed", { status: found.m.status }); return res.end(); }
  const onEvent = (e) => { send(e.type, e.data); if (["completed", "failed", "cancelled", "waiting_confirmation"].includes(e.type)) end(); };
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  const end = () => { clearInterval(ping); copilotEvents.off(found.m.id, onEvent); res.end(); };
  copilotEvents.on(found.m.id, onEvent);
  req.on("close", () => { clearInterval(ping); copilotEvents.off(found.m.id, onEvent); });
}

const RATINGS = ["Helpful", "Not Helpful", "Incorrect", "Unsafe", "Missing evidence", "Dismiss"];
const REASONS = ["Incorrect data", "Missing context", "Unauthorized information", "Recommendation not useful", "Citation does not support claim", "Already resolved", "Other"];
export const messageFeedback = guard(async (req, res) => {
  const found = await loadOwnMessage(req, req.params.id);
  if (!found || found.c._auditView || found.m.role !== "assistant") return notFound(res, "Message");
  const { rating, reason = null, comment = null } = req.body || {};
  if (!RATINGS.includes(rating)) throw invalid(`rating: ${RATINGS.join(", ")}.`);
  if (reason && !REASONS.includes(reason)) throw invalid(`reason: ${REASONS.join(", ")}.`);
  const requestIds = Array.isArray(found.m.requestIds) ? found.m.requestIds : [];
  const f = await prisma.aiFeedback.create({ data: { organizationId: req.organizationId, membershipId: req.membership.id, requestId: requestIds[requestIds.length - 1] || null, rating: rating === "Dismiss" ? "Not Helpful" : rating, reason, comment: [`copilotMessage:${found.m.id}`, comment].filter(Boolean).join(" · ").slice(0, 2000) } });
  if (rating === "Unsafe" || reason === "Unauthorized information") await aiAudit(req, "ai.copilot.feedback_flagged", "AiCopilotMessage", found.m.id, { after: { rating, reason } });
  res.status(201).json({ feedback: { _id: f.id, rating }, note: "Feedback is reviewed in evaluations. It never retrains a model." });
});

// ---- Clarifications and tool approvals --------------------------------------------

export const answerClarification = guard(async (req, res) => {
  const cq = await prisma.aiClarificationRequest.findFirst({ where: { id: req.params.id, organizationId: req.organizationId, status: "Open" } });
  if (!cq) return notFound(res, "Clarification");
  const conv = await prisma.aiCopilotConversation.findUnique({ where: { id: cq.conversationId } });
  const c = await loadConversation(req, conv?.publicId || "");
  if (!c) return notFound(res, "Clarification");
  const choice = (cq.options || []).find((o) => o.recordId === req.body.recordId);
  if ((cq.options || []).length && !choice) throw invalid("Choose one of the offered records.");
  await prisma.aiClarificationRequest.update({ where: { id: cq.id }, data: { status: "Answered", answer: choice || { text: String(req.body.text || "").slice(0, 300) }, answeredAt: new Date() } });
  if (choice) await prisma.aiCopilotContextLink.create({ data: { organizationId: req.organizationId, conversationId: c.id, recordType: choice.recordType, recordId: choice.recordId, label: choice.label, addedByMembershipId: req.membership.id } });
  if (cq.workflowRunId) {
    const run = await prisma.aiWorkflowRun.findUnique({ where: { id: cq.workflowRunId } });
    await prisma.aiWorkflowRun.update({ where: { id: run.id }, data: { input: { ...run.input, companyId: choice?.recordId, companyName: choice?.label }, status: "Ready" } });
    const done = executeWorkflow(req, run.id, c);
    if (req.body.wait === true) await done; else done.catch(() => {});
    return res.json({ workflowRun: serializeRun(await prisma.aiWorkflowRun.findUnique({ where: { id: run.id } })) });
  }
  const lastUser = await prisma.aiCopilotMessage.findFirst({ where: { conversationId: c.id, role: "user" }, orderBy: { seq: "desc" } });
  const { assistant, done } = await startTurn(req, c, lastUser?.content || String(req.body.text || ""));
  if (req.body.wait === true) await done; else done.catch(() => {});
  res.json({ assistantMessage: { _id: assistant.id } });
});

export const approveToolCall = guard(async (req, res) => {
  const call = await prisma.aiCopilotToolCall.findFirst({ where: { id: req.params.id, organizationId: req.organizationId, status: "Awaiting approval" } });
  if (!call) return notFound(res, "Pending data request");
  const conv = call.conversationId ? await prisma.aiCopilotConversation.findUnique({ where: { id: call.conversationId } }) : null;
  const c = conv && await loadConversation(req, conv.publicId);
  if (!c) return notFound(res, "Pending data request");
  authorizeToolCall(req, call.toolName, call.input); // the approver must still be allowed to read it
  await prisma.aiCopilotToolCall.update({ where: { id: call.id }, data: { status: "Approved", approvedByMembershipId: req.membership.id } });
  await aiAudit(req, "ai.copilot.tool_approved", "AiCopilotToolCall", call.id, { after: { tool: call.toolName } });
  if (call.workflowRunId) {
    await prisma.aiWorkflowRun.update({ where: { id: call.workflowRunId }, data: { status: "Ready" } });
    const done = executeWorkflow(req, call.workflowRunId, c);
    if (req.body.wait === true) await done; else done.catch(() => {});
    return res.json({ workflowRun: serializeRun(await prisma.aiWorkflowRun.findUnique({ where: { id: call.workflowRunId } })) });
  }
  const lastUser = await prisma.aiCopilotMessage.findFirst({ where: { conversationId: c.id, role: "user" }, orderBy: { seq: "desc" } });
  const { assistant, done } = await startTurn(req, c, lastUser.content);
  if (req.body.wait === true) await done; else done.catch(() => {});
  res.json({ assistantMessage: { _id: assistant.id } });
});

// ---- Context ----------------------------------------------------------------------

async function verifyContextRecord(req, recordType, recordId) {
  const tool = CONTEXT_TOOL[recordType];
  if (!tool) throw invalid(`Context records: ${Object.keys(CONTEXT_TOOL).join(", ")}.`);
  const { tool: t, input } = authorizeToolCall(req, tool, { id: String(recordId) });
  const out = await t.run(req, input);
  const r = out.records[0];
  return { recordType, recordId: r.recordId, label: r.label };
}

export const searchContext = guard(async (req, res) => {
  const q = String(req.query.q || "").slice(0, 80);
  const types = { Company: "search_companies", Contact: "search_contacts", Deal: "search_deals", Lead: "search_leads", Contract: "search_contracts", Ticket: "search_support_tickets", Project: "search_projects" };
  const wanted = req.query.type && types[req.query.type] ? { [req.query.type]: types[req.query.type] } : types;
  const results = [];
  for (const [recordType, name] of Object.entries(wanted)) {
    try {
      const { tool, input } = authorizeToolCall(req, name, { query: q || undefined, limit: 5 });
      const out = await tool.run(req, input);
      results.push(...out.records.map((r) => ({ recordType, recordId: r.recordId, label: r.label, updatedAt: r.updatedAt })));
    } catch { /* module not available to this user → not offered */ }
  }
  res.json({ results: results.slice(0, 30) });
});

export const addContext = guard(async (req, res) => {
  const c = await loadConversation(req, req.params.id);
  if (!c) return notFound(res, "Conversation");
  const rec = await verifyContextRecord(req, req.body.recordType, req.body.recordId);
  const link = await prisma.aiCopilotContextLink.create({ data: { organizationId: req.organizationId, conversationId: c.id, ...rec, addedByMembershipId: req.membership.id } });
  if (!c.primaryContext) await prisma.aiCopilotConversation.update({ where: { id: c.id }, data: { primaryContext: rec } });
  res.status(201).json({ context: { _id: link.id, ...rec } });
});

export const removeContext = guard(async (req, res) => {
  const c = await loadConversation(req, req.params.id);
  if (!c) return notFound(res, "Conversation");
  const link = await prisma.aiCopilotContextLink.findFirst({ where: { id: req.params.contextId, conversationId: c.id, removedAt: null } });
  if (!link) return notFound(res, "Context");
  await prisma.aiCopilotContextLink.update({ where: { id: link.id }, data: { removedAt: new Date() } });
  res.json({ ok: true });
});

export const conversationScope = guard(async (req, res) => {
  const c = await loadConversation(req, req.params.id, { audit: true });
  if (!c) return notFound(res, "Conversation");
  const scope = await TOOLS.get_current_user_scope.run(req);
  const links = await prisma.aiCopilotContextLink.findMany({ where: { conversationId: c.id, removedAt: null } });
  const policy = await prisma.aiPolicy.findUnique({ where: { organizationId: req.organizationId } });
  res.json({ scope: { ...scope.info, mode: c.mode, storageMode: c.storageMode, providerStorage: !!policy?.providerStorage, context: links.map((l) => ({ _id: l.id, recordType: l.recordType, recordId: l.recordId, label: l.label })), aiMode: aiMode(), simulatorLabel: aiMode() === "simulator" ? SIMULATOR_LABEL : null } });
});

// ---- Memory ------------------------------------------------------------------------

export const getMemories = guard(async (req, res) => {
  res.json({ memories: (await listMemories(req)).map(serializeMemory), keys: Object.entries(MEMORY_KEYS).map(([key, d]) => ({ key, label: d.label, values: d.values || null })) });
});
export const createMemory = guard(async (req, res) => { res.status(201).json({ memory: serializeMemory(await saveMemory(req, req.body || {})) }); });
export const patchMemory = guard(async (req, res) => { res.json({ memory: serializeMemory(await updateMemory(req, req.params.id, req.body || {})) }); });
export const removeMemory = guard(async (req, res) => { await deleteMemory(req, req.params.id); res.json({ ok: true }); });
export const expireMemoryHandler = guard(async (req, res) => { res.json({ memory: serializeMemory(await expireMemory(req, req.params.id)) }); });

// ---- Workflows ---------------------------------------------------------------------

export const listWorkflows = guard(async (req, res) => {
  const templates = await prisma.aiWorkflowTemplate.findMany({ orderBy: { name: "asc" } });
  const versions = await prisma.aiWorkflowVersion.findMany({ where: { templateId: { in: templates.map((t) => t.id) }, status: "Published" } });
  res.json({ workflows: templates.map((t) => ({ key: t.key, name: t.name, description: t.description, mode: t.mode, needs: WORKFLOWS[t.key]?.needs || null, version: Math.max(0, ...versions.filter((v) => v.templateId === t.id).map((v) => v.version)), steps: (WORKFLOWS[t.key]?.steps || []).map((s) => ({ type: s.type, tool: s.tool || null, reason: s.reason || s.type })) })) });
});

export const runWorkflowHandler = guard(async (req, res) => {
  const key = req.params.workflowId;
  if (!WORKFLOWS[key]) return notFound(res, "Workflow");
  let c = req.body.conversationId ? await loadConversation(req, req.body.conversationId) : null;
  if (!c) c = await prisma.aiCopilotConversation.create({ data: { publicId: newPublicId("acc"), organizationId: req.organizationId, userId: req.user?.id || null, membershipId: req.membership.id, title: WORKFLOWS[key].name, mode: WORKFLOWS[key].mode } });
  const input = {};
  for (const k of ["companyId", "companyName", "purpose", "scope", "withinDays", "dealId", "contactId", "contractId"]) if (req.body.input?.[k] !== undefined) input[k] = typeof req.body.input[k] === "string" ? req.body.input[k].slice(0, 200) : req.body.input[k];
  const { run, duplicate, replayed } = await startWorkflow(req, key, input, { conversation: c, idempotencyKey: req.get("Idempotency-Key") || undefined });
  if (!duplicate && !replayed) {
    await prisma.aiCopilotMessage.create({ data: { organizationId: req.organizationId, conversationId: c.id, seq: await nextSeq(c.id), role: "user", status: "Completed", content: `Run workflow: ${WORKFLOWS[key].name}${input.companyName ? ` — ${input.companyName}` : ""}`, completedAt: new Date() } });
    const done = executeWorkflow(req, run.id, c);
    if (req.body.wait === true) await done; else done.catch(() => {});
  }
  const fresh = await prisma.aiWorkflowRun.findUnique({ where: { id: run.id } });
  res.status(duplicate || replayed ? 200 : 202).json({ workflowRun: serializeRun(fresh), conversation: serializeConversation(c), duplicate: !!duplicate });
});

async function loadRun(req, id) {
  const r = await prisma.aiWorkflowRun.findFirst({ where: { organizationId: req.organizationId, publicId: String(id) } });
  if (!r) return null;
  if (r.membershipId !== req.membership?.id && !hasGrant(req, "ai_copilot_workflows", "approve")) return null;
  return r;
}

export const getRun = guard(async (req, res) => {
  const r = await loadRun(req, req.params.id);
  if (!r) return notFound(res, "Workflow run");
  const steps = await prisma.aiWorkflowStep.findMany({ where: { runId: r.id }, orderBy: { seq: "asc" } });
  res.json({ workflowRun: serializeRun(r, steps) });
});

export const cancelRun = guard(async (req, res) => {
  const r = await loadRun(req, req.params.id);
  if (!r) return notFound(res, "Workflow run");
  if (["Completed", "Completed with limitations", "Failed", "Cancelled", "Expired"].includes(r.status)) throw invalid(`This run is ${r.status.toLowerCase()}.`);
  const u = await prisma.aiWorkflowRun.update({ where: { id: r.id }, data: { status: "Cancelled", completedAt: new Date() } });
  if (r.messageId) await cancelTurn(req.organizationId, r.messageId);
  await aiAudit(req, "ai.copilot.workflow_cancelled", "AiWorkflowRun", r.id);
  res.json({ workflowRun: serializeRun(u) });
});

export const resumeRun = guard(async (req, res) => {
  const r = await loadRun(req, req.params.id);
  if (!r) return notFound(res, "Workflow run");
  if (!["Awaiting clarification", "Awaiting tool approval", "Ready"].includes(r.status)) throw invalid(`This run is ${r.status.toLowerCase()}.`);
  if (r.expiresAt && r.expiresAt < new Date()) { await prisma.aiWorkflowRun.update({ where: { id: r.id }, data: { status: "Expired" } }); throw invalid("This run expired."); }
  const conv = await prisma.aiCopilotConversation.findUnique({ where: { id: r.conversationId } });
  const done = executeWorkflow(req, r.id, conv);
  if (req.body.wait === true) await done; else done.catch(() => {});
  res.json({ workflowRun: serializeRun(await prisma.aiWorkflowRun.findUnique({ where: { id: r.id } })) });
});

// Approve / reject a run's pending data requests (sensitive or broad reads).
export const approveRun = guard(async (req, res) => {
  const r = await loadRun(req, req.params.id);
  if (!r) return notFound(res, "Workflow run");
  const pending = await prisma.aiCopilotToolCall.findMany({ where: { workflowRunId: r.id, status: "Awaiting approval" } });
  if (!pending.length) throw invalid("Nothing in this run is waiting for approval.");
  for (const p of pending) { authorizeToolCall(req, p.toolName, p.input); await prisma.aiCopilotToolCall.update({ where: { id: p.id }, data: { status: "Approved", approvedByMembershipId: req.membership.id } }); }
  await aiAudit(req, "ai.copilot.workflow_approved", "AiWorkflowRun", r.id, { after: { tools: pending.map((p) => p.toolName) } });
  const conv = await prisma.aiCopilotConversation.findUnique({ where: { id: r.conversationId } });
  await prisma.aiWorkflowRun.update({ where: { id: r.id }, data: { status: "Ready" } });
  const done = executeWorkflow(req, r.id, conv);
  if (req.body.wait === true) await done; else done.catch(() => {});
  res.json({ workflowRun: serializeRun(await prisma.aiWorkflowRun.findUnique({ where: { id: r.id } })) });
});

export const rejectRun = guard(async (req, res) => {
  const r = await loadRun(req, req.params.id);
  if (!r) return notFound(res, "Workflow run");
  await prisma.aiCopilotToolCall.updateMany({ where: { workflowRunId: r.id, status: "Awaiting approval" }, data: { status: "Denied", decisionReason: "Rejected by the user" } });
  const u = await prisma.aiWorkflowRun.update({ where: { id: r.id }, data: { status: "Cancelled", safeError: String(req.body.reason || "Rejected").slice(0, 300), completedAt: new Date() } });
  await aiAudit(req, "ai.copilot.workflow_rejected", "AiWorkflowRun", r.id, { reason: req.body.reason });
  res.json({ workflowRun: serializeRun(u) });
});

// ---- Index administration ------------------------------------------------------------

export const indexStatus = guard(async (req, res) => {
  const cfg = embeddingConfig();
  const [chunks, byType, jobs, failed] = await Promise.all([
    prisma.aiSourceChunk.count({ where: { organizationId: req.organizationId, status: "Indexed" } }),
    prisma.aiSourceChunk.groupBy({ by: ["recordType"], where: { organizationId: req.organizationId, status: "Indexed" }, _count: { _all: true } }),
    prisma.aiIndexingJob.groupBy({ by: ["status"], where: { organizationId: req.organizationId }, _count: { _all: true } }),
    prisma.aiIndexingJob.findMany({ where: { organizationId: req.organizationId, status: "Failed" }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const vectors = cfg.model ? await prisma.aiSourceEmbedding.count({ where: { organizationId: req.organizationId, embeddingModel: cfg.model, embeddingVersion: cfg.version } }) : 0;
  res.json({ index: { embedding: { provider: cfg.provider, model: cfg.model, version: cfg.version }, chunks, vectors, byType: byType.map((b) => ({ recordType: b.recordType, chunks: b._count._all })), jobs: Object.fromEntries(jobs.map((j) => [j.status, j._count._all])), recentFailures: failed.map((f) => ({ recordType: f.recordType, recordId: f.recordId, error: f.error, at: f.completedAt })), sources: INDEXED_TYPES, storage: "CRM PostgreSQL (exact cosine search, organization-filtered)", providerHostedRetrieval: "Off" } });
});

export const rebuildIndex = guard(async (req, res) => {
  const job = await prisma.aiIndexingJob.create({ data: { organizationId: req.organizationId, kind: "Rebuild", reason: `Rebuild requested (${embeddingConfig().model || "no embedding model"})` } });
  await aiAudit(req, "ai.copilot.index_rebuild", "AiIndexingJob", job.id);
  res.status(202).json({ job: { _id: job.id, status: job.status } });
});

export const reindexSource = guard(async (req, res) => {
  const { recordType, recordId } = req.params;
  if (!INDEXED_TYPES.includes(recordType)) throw invalid(`Indexed types: ${INDEXED_TYPES.join(", ")}.`);
  const job = await enqueueIndexJob({ organizationId: req.organizationId, recordType, recordId, reason: "Requested by an administrator" });
  res.status(202).json({ job: { _id: job.id, status: job.status } });
});

export const removeIndexedSource = guard(async (req, res) => {
  const { recordType, recordId } = req.params;
  const removed = await removeSource(req.organizationId, recordType, recordId);
  await aiAudit(req, "ai.copilot.index_source_removed", "AiSourceChunk", `${recordType}:${recordId}`, { after: { removed } });
  res.json({ removed });
});

export const copilotInfo = guard(async (req, res) => {
  res.json({ aiMode: aiMode(), simulatorLabel: aiMode() === "simulator" ? SIMULATOR_LABEL : null, disclaimer: "AI Copilot uses authorized CRM data and may make mistakes. Verify important information and approve actions before they are applied.", starters: ["Prepare my day", "Review my pipeline", "Summarize a Company", "Prepare for a meeting", "Review renewals", "Find data-quality issues", "Ask about an authorized record"], modes: MODES, permissions: { memory: hasGrant(req, "ai_copilot_memory", "configure"), workflows: hasGrant(req, "ai_copilot_workflows", "execute"), sensitive: hasGrant(req, "ai_copilot_tools", "view_sensitive_fields"), usage: hasGrant(req, "ai_usage", "view_own"), audit: hasGrant(req, "ai_copilot_conversations", "view_audit_history"), index: hasGrant(req, "ai_copilot_index", "configure"), propose: hasGrant(req, "ai_actions", "propose"), confirm: hasGrant(req, "ai_actions", "confirm") } });
});

