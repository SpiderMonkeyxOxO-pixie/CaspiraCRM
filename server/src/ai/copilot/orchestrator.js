// Backend Phase 10 — the Copilot orchestrator: a bounded, backend-controlled
// state machine for one turn. It is not an autonomous agent loop.
//
//   Queued → Classifying (plan) → Retrieving (authorized tools, semantic
//   search) → Generating (answer from evidence) → Validating (citations,
//   numbers, action claims, proposals, memory) → Completed |
//   Completed with limitations | Awaiting tool | Refused | Cancelled | Failed
//
// The model may REQUEST tools; the backend decides (allowlist, schema, grant,
// sensitivity, confirmation, limits). Every read runs through the existing
// domain handlers with the user's own identity. Nothing is mutated: proposal
// tools create Phase 9 previews that a person must confirm. Draft text is
// never stored; only the validated answer is. No chain-of-thought is stored —
// only concise operational reasons.
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { runAi, cancelAiRequest } from "../gateway/gateway.js";
import { claimsAction } from "../gateway/outputSchemas.js";
import { detectInjection } from "../context/contextAssembly.js";
import { getAiPolicy, getUseCase } from "../policy/policyService.js";
import { previewAction, prohibitedExplanation, serializeProposal } from "../actions/actionService.js";
import { TOOLS, PROPOSAL_TOOLS, TOOL_REGISTRY_VERSION, authorizeToolCall, toolCatalogForModel, ToolDenied } from "./tools/registry.js";
import { EvidenceSet, RECORD_ROUTES } from "./evidence.js";
import { semanticSearch } from "./retrieval/semantic.js";
import { semanticEnabled } from "./retrieval/embeddings.js";
import { validateCitations, computeConfidence, LIMITATION } from "./citations.js";
import { activePreferences, proposeMemory, conversationContext, compactConversation } from "./memory.js";
import { checkCapability, checkTool, activeToolNames, semanticAllowed } from "../governance/runtime.js";
import { recordSafetyEvent, injectionFlags } from "../governance/safety.js";

export const LIMITS = { maxProviderCalls: 3, maxToolCalls: 10, maxRepeatedToolCalls: 1, maxRecords: 60, maxRuntimeMs: 120_000, maxCostUsd: 0.5 };
const TOOL_RESULT_RETENTION_DAYS = 30;

export const copilotEvents = new EventEmitter();
copilotEvents.setMaxListeners(200);
const active = new Map(); // assistant message id → { cancelled, gatewayRequestId }

const PROHIBITED_WORDS = [
  [/\b(delete|remove permanently)\b/i, "delete"], [/\barchive\b/i, "archive"], [/\bmerge\b/i, "merge"],
  [/\bsend (an? )?(email|e-mail|mail)\b|\bemail (the|this|them|him|her)\b/i, "send_email"], [/\b(send (an? )?)?(sms|text message)\b/i, "send_sms"],
  [/\bapprove (the |this )?(quote|discount)/i, "approve_quote"], [/\bconfirm (the |this )?order/i, "confirm_order"], [/\bactivate (the |this )?contract/i, "activate_contract"],
  [/\bpost (the |this )?invoice/i, "post_invoice"], [/\b(process|make) (a |the )?payment|\bpay (the|this|invoice)/i, "process_payment"], [/\brefund\b/i, "refund"],
  [/\b(change|grant|remove) (their |the |his |her )?(permission|role|access)/i, "change_permissions"], [/\bsign (the |this )?(document|contract)/i, "sign_document"],
  [/\bexport (all|everything|every)\b/i, "export_data"],
];
export function detectProhibited(text) {
  for (const [re, key] of PROHIBITED_WORDS) if (re.test(text)) return prohibitedExplanation(key);
  return null;
}

const emitFor = (messageId) => (type, data = {}) => copilotEvents.emit(messageId, { type, data, at: new Date().toISOString() });

// Progress updates never overwrite a message that was stopped meanwhile.
const RUNNING_STATUSES = ["Queued", "Classifying", "Retrieving", "Generating", "Validating"];
async function progressStatus(messageId, status) {
  return prisma.aiCopilotMessage.updateMany({ where: { id: messageId, status: { in: RUNNING_STATUSES } }, data: { status } });
}

async function setStatus(messageId, status, extra = {}) {
  return prisma.aiCopilotMessage.update({ where: { id: messageId }, data: { status, ...extra } });
}

export async function nextSeq(conversationId) {
  const last = await prisma.aiCopilotMessage.findFirst({ where: { conversationId }, orderBy: { seq: "desc" }, select: { seq: true } });
  return (last?.seq || 0) + 1;
}

// A turn's working state.
export function newTurn(req, conversation, userText, { messageId, workflowRunId = null } = {}) {
  return {
    req, conversation, userText, messageId, workflowRunId, started: Date.now(), evidence: new EvidenceSet(),
    toolCalls: 0, providerCalls: 0, costUsd: 0, seenCalls: new Map(), limitations: new Set(), requestIds: [], usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, costKnown: true },
    truncated: false, restricted: false, deterministic: false, semanticOnly: false, approvalsNeeded: [], provider: null, emit: emitFor(messageId), toolSeq: 0,
  };
}

function checkLimits(turn, stage) {
  if (active.get(turn.messageId)?.cancelled) throw Object.assign(new AiError(CATEGORIES.UNKNOWN, "Stopped by the user."), { cancelled: true });
  if (Date.now() - turn.started > LIMITS.maxRuntimeMs) throw new AiError(CATEGORIES.TIMEOUT, `The Copilot reached its time limit while ${stage}.`);
  if (turn.costUsd > LIMITS.maxCostUsd) throw new AiError(CATEGORIES.BUDGET, "The Copilot reached its cost limit for this request.");
}

async function callModel(turn, useCaseKey, vars) {
  checkLimits(turn, "preparing the answer");
  if (turn.providerCalls >= LIMITS.maxProviderCalls) throw new AiError(CATEGORIES.POLICY, "The Copilot reached its limit of AI calls for this request.");
  turn.providerCalls += 1;
  const outcome = await runAi({ req: turn.req, useCaseKey, accountingUseCaseKey: "copilot.chat", ...vars, onRequestId: (id) => { const a = active.get(turn.messageId); if (a) { a.gatewayRequestId = id; if (a.cancelled) cancelAiRequest(turn.req.organizationId, id).catch(() => {}); } } });
  turn.requestIds.push(outcome.request.id);
  turn.provider = outcome.provider || turn.provider;
  if (outcome.usage) { turn.usage.inputTokens += outcome.usage.inputTokens || 0; turn.usage.outputTokens += outcome.usage.outputTokens || 0; }
  if (outcome.estimatedCost === null || outcome.estimatedCost === undefined) turn.usage.costKnown = false;
  else { turn.usage.estimatedCost += Number(outcome.estimatedCost); turn.costUsd += Number(outcome.estimatedCost); }
  return outcome;
}

// ---- Tools ------------------------------------------------------------------------

async function recordToolCall(turn, name, input, data) {
  turn.toolSeq += 1;
  return prisma.aiCopilotToolCall.create({
    data: { organizationId: turn.req.organizationId, conversationId: turn.conversation?.id || null, messageId: turn.messageId, workflowRunId: turn.workflowRunId, seq: turn.toolSeq, toolName: String(name).slice(0, 60), toolVersion: TOOL_REGISTRY_VERSION, input: input || {}, ...data },
  });
}

async function wasApproved(turn, name, input) {
  if (!turn.conversation) return false;
  const approved = await prisma.aiCopilotToolCall.findFirst({ where: { conversationId: turn.conversation.id, toolName: name, status: "Approved", createdAt: { gte: new Date(Date.now() - 30 * 60_000) } }, orderBy: { createdAt: "desc" } });
  return !!approved && JSON.stringify(approved.input) === JSON.stringify(input);
}

// Runs requested read tools under policy; adds results to the evidence set.
export async function runTools(turn, requests) {
  for (const r of requests || []) {
    checkLimits(turn, "reading records");
    if (turn.toolCalls >= LIMITS.maxToolCalls) { turn.limitations.add(`Only ${LIMITS.maxToolCalls} data requests are made per answer.`); break; }
    const key = `${r.tool}:${JSON.stringify(r.arguments || {})}`;
    const repeats = turn.seenCalls.get(key) || 0;
    if (repeats >= LIMITS.maxRepeatedToolCalls) { await recordToolCall(turn, r.tool, r.arguments, { status: "Denied", decisionReason: "Repeated identical request" }); continue; }
    turn.seenCalls.set(key, repeats + 1);
    // Phase 11: an attempt to reach another organization is a safety event
    // (the identity fields are stripped below either way).
    const orgArg = Object.entries(r.arguments || {}).find(([k, v]) => /organi[sz]ation|tenant/i.test(k) && v && String(v) !== turn.req.organizationId);
    if (orgArg) await recordSafetyEvent(turn.req, { severity: "High", category: "cross_tenant_attempt", capabilityKey: "ai_copilot", conversationId: turn.conversation?.id, summary: `The model asked ${String(r.tool).slice(0, 60)} for another organization; the argument was removed.`, source: "copilot_tools", actionTaken: "Redact", correlationId: turn.messageId }).catch(() => {});
    const governed = TOOLS[r.tool] ? await checkTool(turn.req, r.tool, TOOL_REGISTRY_VERSION) : { ok: true };
    if (!governed.ok) {
      await recordToolCall(turn, r.tool, r.arguments, { status: "Denied", decisionReason: governed.message });
      turn.limitations.add(`${governed.message} That data wasn't read.`);
      continue;
    }
    let authorized;
    try {
      authorized = authorizeToolCall(turn.req, r.tool, r.arguments);
    } catch (err) {
      const denied = err instanceof ToolDenied ? err : new ToolDenied("Not allowed.");
      await recordToolCall(turn, r.tool, r.arguments, { status: "Denied", decisionReason: denied.message.slice(0, 300) });
      if (denied.reason === "no_module_grant" || denied.reason === "no_sensitive_grant") { turn.restricted = true; turn.limitations.add(LIMITATION.restricted); }
      if (denied.reason === "not_allowlisted") {
        await aiAudit(turn.req, "ai.copilot.tool_denied", "AiCopilotMessage", turn.messageId, { result: "Failure", reason: denied.message });
        await recordSafetyEvent(turn.req, { severity: "Medium", category: "unauthorized_tool_request", capabilityKey: "ai_copilot", conversationId: turn.conversation?.id, summary: `The model requested a tool that isn't allowlisted (${String(r.tool).slice(0, 60)}).`, source: "copilot_tools", actionTaken: "Refuse", correlationId: turn.messageId }).catch(() => {});
      }
      continue;
    }
    const { tool, input, confirmation } = authorized;
    if (tool.unavailable) { turn.limitations.add(LIMITATION.documents); await recordToolCall(turn, r.tool, input, { status: "Denied", decisionReason: tool.unavailable }); continue; }
    if (confirmation && !(await wasApproved(turn, r.tool, input))) {
      const call = await recordToolCall(turn, r.tool, input, { status: "Awaiting approval", requiresApproval: true, decisionReason: `${confirmation} needs your confirmation.` });
      turn.approvalsNeeded.push({ toolCallId: call.id, tool: r.tool, what: confirmation, reason: String(r.reason || "").slice(0, 200) });
      continue;
    }
    turn.toolCalls += 1;
    turn.emit(tool.deterministic ? "calculating" : "searching", { tool: r.tool });
    const t0 = Date.now();
    const reason = String(r.reason || "Requested by the planning step").slice(0, 300);
    try {
      const result = await tool.run(turn.req, input);
      if (tool.deterministic || result.deterministic) turn.deterministic = true;
      if (result.truncated) { turn.truncated = true; turn.limitations.add(LIMITATION.truncated); }
      const refs = [];
      for (const rec of result.records) {
        if (turn.evidence.size >= LIMITS.maxRecords) { turn.truncated = true; turn.limitations.add(LIMITATION.truncated); break; }
        if (rec.masked?.length) { turn.restricted = true; turn.limitations.add(LIMITATION.restricted); }
        const flags = injectionFlags(JSON.stringify(rec.fields || {}));
        if (flags.length) { turn.untrustedFlags = (turn.untrustedFlags || 0) + 1; rec.untrusted = true; }
        const e = turn.evidence.add(rec, tool.deterministic || result.deterministic ? "deterministic" : r.tool.startsWith("get_") ? "exact" : "structured");
        refs.push({ handle: e.handle, recordType: rec.recordType, recordId: rec.recordId });
      }
      const call = await recordToolCall(turn, r.tool, input, { status: "Succeeded", decisionReason: reason, durationMs: Date.now() - t0 });
      await prisma.aiCopilotToolResult.create({ data: { organizationId: turn.req.organizationId, toolCallId: call.id, result: { total: result.total, info: result.info || null, records: result.records.map((x) => ({ recordType: x.recordType, recordId: x.recordId, label: x.label, updatedAt: x.updatedAt })) }, recordRefs: refs, truncated: !!result.truncated, freshness: { retrievedAt: new Date().toISOString() }, expiresAt: new Date(Date.now() + TOOL_RESULT_RETENTION_DAYS * 86_400_000) } });
      if (input.query) await logRetrieval(turn, input.query, { tool: r.tool, ...input }, "structured", refs.map((x, i) => ({ ...x, rank: i + 1, score: 1 })), result.truncated, Date.now() - t0);
    } catch (err) {
      const msg = err instanceof ToolDenied ? err.message : "The data request failed.";
      await recordToolCall(turn, r.tool, input, { status: "Failed", decisionReason: msg.slice(0, 300), durationMs: Date.now() - t0 });
      turn.limitations.add(LIMITATION.partial);
    }
  }
}

async function logRetrieval(turn, queryText, filters, method, refs, truncated, durationMs) {
  const q = await prisma.aiRetrievalQuery.create({ data: { organizationId: turn.req.organizationId, membershipId: turn.req.membership?.id || null, conversationId: turn.conversation?.id || null, messageId: turn.messageId, workflowRunId: turn.workflowRunId, queryText: String(queryText).slice(0, 300), filters, method, resultCount: refs.length, truncated: !!truncated, durationMs } });
  if (refs.length) await prisma.aiRetrievalResult.createMany({ data: refs.slice(0, 50).map((x) => ({ organizationId: turn.req.organizationId, queryId: q.id, rank: x.rank, recordType: x.recordType, recordId: x.recordId, chunkId: x.chunkId || null, score: x.score ?? 0, method })) });
}

// Semantic search (tenant- and permission-filtered) added after structured results.
export async function runSemantic(turn, query, types) {
  if (!semanticEnabled()) { turn.limitations.add(LIMITATION.semanticDisabled); return; }
  if (!(await semanticAllowed(turn.req))) { turn.limitations.add("Text search is paused by an administrator; only structured records were searched."); return; }
  checkLimits(turn, "searching text");
  const t0 = Date.now();
  try {
    const { hits } = await semanticSearch(turn.req, query, { types, limit: 6 });
    const refs = [];
    for (const h of hits) {
      if (turn.evidence.size >= LIMITS.maxRecords) break;
      const e = turn.evidence.add(h, "semantic");
      refs.push({ handle: e.handle, recordType: h.recordType, recordId: h.recordId, chunkId: h.chunkId, score: h.score, rank: refs.length + 1 });
    }
    await logRetrieval(turn, query, { types: types || "all" }, "semantic", refs, false, Date.now() - t0);
  } catch {
    turn.limitations.add(LIMITATION.semanticDisabled);
  }
}

// Record context (exact lookups first: exact IDs outrank everything).
export async function addContextRecords(turn, links) {
  const byType = { Company: "get_company", Deal: "get_deal", Contact: "get_contact", Lead: "get_lead", Contract: "get_contract", Quote: "get_quote", Order: "get_order", Ticket: "get_support_ticket", Project: "get_project" };
  await runTools(turn, links.filter((l) => byType[l.recordType]).map((l) => ({ tool: byType[l.recordType], arguments: { id: l.recordId }, reason: "Record in context" })));
}

// ---- Answer ------------------------------------------------------------------------

// Model answer from evidence → validated message pieces.
export async function answerFromEvidence(turn, { mode, preferences, extraInstruction = "" }) {
  turn.emit("preparing_answer", { evidence: turn.evidence.size });
  const outcome = await callModel(turn, "copilot.answer", {
    moderateInput: false, // the planning step already moderated this message
    dataVariables: { preferences, limitations: [...turn.limitations], evidence: turn.evidence.forModel(LIMITS.maxRecords) },
    textVariables: { mode, today: new Date().toISOString().slice(0, 10), message: `${turn.userText}${extraInstruction ? ` (${extraInstruction})` : ""}` },
  });
  if (outcome.refused) return { refused: true };
  turn.emit("validating_citations", {});
  const out = outcome.output;
  const { findings, citations, removed, stale } = await validateCitations(turn.req, turn.evidence, out.findings);
  if (removed) {
    turn.limitations.add(LIMITATION.removed(removed));
    await recordSafetyEvent(turn.req, { severity: "Informational", category: "invalid_citation_blocked", capabilityKey: "ai_copilot", conversationId: turn.conversation?.id, summary: `${removed} unsupported or invalidly cited statement(s) removed before display.`, source: "citation_validation", actionTaken: "Redact", correlationId: turn.messageId }).catch(() => {});
  }
  if (stale) turn.limitations.add(LIMITATION.stale);
  // The summary sentence: no action claims, no unsupported numbers, no echoed instructions.
  let answer = String(out.answer || "").trim();
  const allValues = JSON.stringify(turn.evidence.items.map((i) => ({ ...i.fields, label: i.label, text: i.text || "" }))).replace(/,(?=\d{3})/g, "");
  const nums = (answer.match(/-?\d[\d,]*(\.\d+)?/g) || []).map((n) => n.replace(/,/g, "")).filter((n) => Number(n) > 10 && !/^(19|20)\d\d$/.test(n));
  if (claimsAction(answer)) { answer = "Here is what the authorized records show. Nothing was changed."; turn.limitations.add("The AI claimed to have taken an action; nothing was changed. Actions only happen after you confirm a proposal."); }
  else if (nums.some((n) => !allValues.includes(n))) { answer = "Here is what the authorized records show."; turn.limitations.add("A figure in the draft answer wasn't found in the records and was removed."); }
  if (detectInjection(answer).length) { answer = "Here is what the authorized records show."; turn.limitations.add("Part of the draft answer looked like an instruction and was removed."); }
  for (const m of out.missing || []) turn.limitations.add(String(m).slice(0, 200));
  return { answer, findings, citations, suggestedActions: out.suggestedActions || [], memoryProposal: out.memoryProposal || null, requestId: outcome.request.id, removed, stale };
}

// Proposal tools → Phase 9 previews (never executed here).
export async function createProposals(turn, suggestions, requestId) {
  const parts = [];
  if ((suggestions || []).length && !(await capabilityOn(turn.req, "suggested_actions"))) { turn.limitations.add("Suggested actions are paused by an administrator."); return parts; }
  for (const s of (suggestions || []).slice(0, 3)) {
    const def = PROPOSAL_TOOLS[s.tool];
    if (!def) { turn.limitations.add("A suggested action wasn't an allowed action and was dropped."); continue; }
    const parsed = def.schema.safeParse(Object.fromEntries(Object.entries(s.arguments || {}).filter(([k]) => !/organi[sz]ation|userId|tenant/i.test(k))));
    if (!parsed.success) { turn.limitations.add("A suggested action had invalid details and was dropped."); continue; }
    const a = parsed.data;
    if (s.tool === "propose_open_records") {
      const recs = a.records.map((x) => turn.evidence.items.find((i) => i.recordType === x.recordType && i.recordId === x.recordId)).filter(Boolean);
      if (recs.length) parts.push({ kind: "open_records", data: { records: recs.map((i) => ({ recordType: i.recordType, recordId: i.recordId, label: i.label, route: i.route })) } });
      continue;
    }
    // Targets must be records the user was shown in this answer.
    if (!turn.evidence.items.some((i) => i.recordType === a.targetType && i.recordId === a.targetId)) { turn.limitations.add("A suggested action pointed at a record outside the evidence and was dropped."); continue; }
    if (def.actionType === "merge") { const p = prohibitedExplanation("merge"); parts.push({ kind: "restricted_notice", data: { text: p.message, authorized: p.authorized } }); continue; }
    if (!hasGrant(turn.req, "ai_actions", "propose")) { turn.limitations.add("Your role can't prepare AI action proposals."); continue; }
    try {
      const { targetType, targetId, ...values } = a;
      const proposal = await previewAction(turn.req, {
        actionType: def.actionType, targetType, targetId, reason: s.reason || "Suggested by the AI Copilot", source: "Model", requestId,
        proposedValues: { ...values, ...(values.expectedCloseDate && { expectedCloseDate: values.expectedCloseDate }), ...(s.tool === "propose_start_renewal_review" && { subject: values.subject || "Renewal review" }) },
        evidence: (s.citations || []).map((h) => turn.evidence.get(h)).filter(Boolean).map((i) => ({ recordType: i.recordType, recordId: i.recordId, label: i.label })),
      });
      parts.push({ kind: "proposal", data: serializeProposal(proposal, turn.req) });
    } catch (err) {
      turn.limitations.add(`A suggested action couldn't be prepared: ${(err.message || "error").slice(0, 150)}`);
    }
  }
  return parts;
}

// Persists the finished assistant message.
export async function finishMessage(turn, { status, content, parts = [], citations = [], intent = null }) {
  if (active.get(turn.messageId)?.cancelled) throw Object.assign(new AiError(CATEGORIES.UNKNOWN, "Stopped by the user."), { cancelled: true });
  const cited = citations.filter((c) => c.status === "Valid" || c.status === "Stale");
  const times = cited.map((c) => c.recordTimestamp).filter(Boolean).map((d) => new Date(d).getTime());
  const freshness = { retrievedAt: new Date().toISOString(), oldestRecord: times.length ? new Date(Math.min(...times)).toISOString() : null, newestRecord: times.length ? new Date(Math.max(...times)).toISOString() : null };
  const limitations = [...turn.limitations];
  const confidence = status === "Refused" || status === "Awaiting tool" ? null : computeConfidence({
    evidenceCount: turn.evidence.size, findingsKept: parts.filter((p) => p.kind === "finding").length, removed: [...turn.limitations].some((l) => /removed because/.test(l)) ? 1 : 0,
    stale: cited.some((c) => c.status === "Stale"), truncated: turn.truncated, restricted: turn.restricted, deterministic: turn.deterministic,
    semanticOnly: turn.evidence.items.length > 0 && turn.evidence.items.every((i) => i.method === "semantic"), providerIssue: false,
  });
  const finalStatus = status === "Completed" && limitations.length ? "Completed with limitations" : status;
  await prisma.$transaction(async (tx) => {
    const all = [...parts, ...limitations.map((text) => ({ kind: "limitation", data: { text } }))];
    if (all.length) await tx.aiCopilotMessagePart.createMany({ data: all.map((p, i) => ({ organizationId: turn.req.organizationId, messageId: turn.messageId, seq: i + 1, kind: p.kind, data: p.data })) });
    if (cited.length) await tx.aiCopilotCitation.createMany({ data: cited.map((c) => ({ organizationId: turn.req.organizationId, messageId: turn.messageId, ...c })) });
    await tx.aiCopilotMessage.update({
      where: { id: turn.messageId },
      data: {
        status: finalStatus, content: content || "", intent, confidence, limitations, freshness, requestIds: turn.requestIds,
        providerKey: turn.provider?.id || null, modelId: turn.provider?.model || null, promptVersion: "copilot.plan@1,copilot.answer@1",
        usage: { ...turn.usage, estimatedCost: turn.usage.costKnown ? Math.round(turn.usage.estimatedCost * 1e6) / 1e6 : null, providerCalls: turn.providerCalls, toolCalls: turn.toolCalls, label: "Estimated — not a provider invoice" },
        completedAt: new Date(),
      },
    });
    if (turn.conversation) await tx.aiCopilotConversation.update({ where: { id: turn.conversation.id }, data: { lastMessageAt: new Date(), messageCount: { increment: 1 } } });
  }, { timeout: 30_000 });
  turn.emit(finalStatus === "Awaiting tool" ? "waiting_confirmation" : "completed", { status: finalStatus });
}

// ---- The turn ------------------------------------------------------------------------

export async function runTurn(req, conversation, userText, assistantMessage) {
  const turn = newTurn(req, conversation, userText, { messageId: assistantMessage.id });
  active.set(assistantMessage.id, { cancelled: false, gatewayRequestId: null });
  try {
    turn.emit("accepted", {});
    await progressStatus(assistantMessage.id, "Classifying");
    await checkCapability(req, "ai_copilot", { evaluation: !!req.aiEvaluation });
    turn.emit("checking_permission", {});
    const policy = await getAiPolicy(req.organizationId);
    const chat = await getUseCase(req.organizationId, "copilot.chat");
    if (!policy.enabled || !chat.enabled || ((policy.allowedUseCases || []).length && !policy.allowedUseCases.includes("copilot.chat"))) {
      throw new AiError(CATEGORIES.POLICY, "The AI Copilot is turned off by your organization's AI policy.");
    }
    // Prohibited requests are answered without any model call.
    const prohibited = detectProhibited(userText);
    if (prohibited) {
      await recordSafetyEvent(req, { severity: "Low", category: "prohibited_action_request", capabilityKey: "ai_copilot", conversationId: conversation.id, summary: `Prohibited request refused without a model call (${prohibited.what || "restricted action"}).`, source: "copilot", actionTaken: "Refuse", correlationId: assistantMessage.id }).catch(() => {});
      await aiAudit(req, "ai.copilot.prohibited_request", "AiCopilotMessage", assistantMessage.id, { result: "Failure", reason: prohibited.message });
      return finishMessage(turn, { status: "Refused", intent: "prohibited", content: `${prohibited.message} The Copilot can prepare related work, but ${prohibited.what.toLowerCase()} stays with the people and workflow above.`, parts: [{ kind: "restricted_notice", data: { text: prohibited.message, authorized: prohibited.authorized } }] });
    }
    if (detectInjection(userText).length) turn.limitations.add("Your message contained instruction-like text; the Copilot's rules and permissions still apply.");
    turn.emit("resolving_context", {});
    const { history, context } = await conversationContext(conversation);
    const preferences = await activePreferences(req);
    await addContextRecords(turn, context);
    // Plan
    const plan = await callModel(turn, "copilot.plan", {
      dataVariables: { preferences, history, context, tools: await governedCatalog(req) },
      textVariables: { mode: conversation.mode, today: new Date().toISOString().slice(0, 10), message: userText },
    });
    if (plan.refused) { turn.limitations.add(LIMITATION.providerRefused); return finishMessage(turn, { status: "Refused", content: "The AI model declined this request." }); }
    const p = plan.output;
    if (p.intent === "prohibited") {
      const exp = prohibitedExplanation("delete");
      return finishMessage(turn, { status: "Refused", intent: "prohibited", content: "That kind of change is never made through the Copilot. It can prepare a proposal for supported actions, which a person confirms.", parts: [{ kind: "restricted_notice", data: { text: exp.message, authorized: exp.authorized } }] });
    }
    if (p.clarification?.question && !p.toolRequests?.length) {
      const c = await prisma.aiClarificationRequest.create({ data: { organizationId: req.organizationId, conversationId: conversation.id, messageId: assistantMessage.id, question: p.clarification.question.slice(0, 300), reason: "ambiguous_scope", options: [] } });
      return finishMessage(turn, { status: "Completed", intent: p.intent, content: p.clarification.question, parts: [{ kind: "clarification", data: { clarificationId: c.id, question: c.question, options: [] } }] });
    }
    await progressStatus(assistantMessage.id, "Retrieving");
    await runTools(turn, p.toolRequests);
    // Duplicate names: ask instead of guessing (authorized records only).
    const namedCompanies = turn.evidence.items.filter((i) => i.recordType === "Company" && i.method === "structured");
    const nameQuery = p.toolRequests.find((r) => r.tool === "search_companies")?.arguments?.query;
    if (nameQuery && namedCompanies.length > 1 && !context.some((c) => c.recordType === "Company")) {
      const exact = namedCompanies.filter((i) => i.label.toLowerCase().includes(String(nameQuery).toLowerCase()));
      if (exact.length > 1) {
        const options = exact.slice(0, 8).map((i) => ({ recordType: "Company", recordId: i.recordId, label: i.label }));
        const c = await prisma.aiClarificationRequest.create({ data: { organizationId: req.organizationId, conversationId: conversation.id, messageId: assistantMessage.id, question: `More than one company matches "${nameQuery}". Which one do you mean?`, reason: "duplicate_names", options } });
        return finishMessage(turn, { status: "Completed", intent: p.intent, content: c.question, parts: [{ kind: "clarification", data: { clarificationId: c.id, question: c.question, options } }] });
      }
    }
    if (p.intent !== "smalltalk" && userText.length > 12) await runSemantic(turn, userText);
    if (turn.approvalsNeeded.length) {
      for (const a of turn.approvalsNeeded) turn.limitations.add(`${a.what} needs your confirmation before it is read.`);
      if (!turn.evidence.size) {
        return finishMessage(turn, { status: "Awaiting tool", intent: p.intent, content: "Some of the data this needs requires your confirmation first.", parts: turn.approvalsNeeded.map((a) => ({ kind: "tool_approval", data: a })) });
      }
    }
    // Answer
    await progressStatus(assistantMessage.id, "Generating");
    const ans = await answerFromEvidence(turn, { mode: conversation.mode, preferences });
    if (ans.refused) { turn.limitations.add(LIMITATION.providerRefused); return finishMessage(turn, { status: "Refused", content: "The AI model declined this request." }); }
    await progressStatus(assistantMessage.id, "Validating");
    const parts = ans.findings.map((f) => ({ kind: "finding", data: f }));
    parts.push(...(await createProposals(turn, ans.suggestedActions, ans.requestId)));
    parts.push(...turn.approvalsNeeded.map((a) => ({ kind: "tool_approval", data: a })));
    if (ans.memoryProposal) {
      const m = await capabilityOn(req, "user_memory") ? await proposeMemory(req, { ...ans.memoryProposal, messageId: assistantMessage.id }) : { rejected: "Memory is paused." };
      if (m.memory && !m.duplicate) parts.push({ kind: "memory_proposal", data: { memoryId: m.memory.id, key: m.memory.key, value: m.memory.value, reason: ans.memoryProposal.reason, source: "Copilot suggestion", sensitivity: m.memory.sensitivity, expiresAt: m.memory.expiresAt } });
      if (m.rejected) turn.limitations.add("A suggested preference wasn't offered because it contained information that is never remembered.");
    }
    if (turn.restricted) parts.push({ kind: "restricted_notice", data: { text: LIMITATION.restricted } });
    await finishMessage(turn, { status: "Completed", intent: p.intent, content: ans.answer, parts, citations: ans.citations });
    await compactConversation(await prisma.aiCopilotConversation.findUnique({ where: { id: conversation.id } }));
  } catch (err) {
    const cancelled = err.cancelled || active.get(assistantMessage.id)?.cancelled;
    // Unexpected (non-AI) errors go to the server log — message and stack only.
    if (!(err instanceof AiError) && !err.cancelled) console.error(`[copilot] turn ${assistantMessage.id} failed:`, err?.stack || err);
    const e = err instanceof AiError ? err : new AiError(CATEGORIES.UNKNOWN, "The Copilot couldn't finish this answer.");
    await setStatus(assistantMessage.id, cancelled ? "Cancelled" : "Failed", {
      errorCategory: cancelled ? null : e.category, safeError: cancelled ? "Stopped by the user." : e.message, requestIds: turn.requestIds, cancelledAt: cancelled ? new Date() : null, completedAt: new Date(),
      usage: { ...turn.usage, providerCalls: turn.providerCalls, toolCalls: turn.toolCalls, label: "Estimated — not a provider invoice" },
    }).catch(() => {});
    turn.emit(cancelled ? "cancelled" : "failed", cancelled ? {} : { category: e.category, message: e.message });
  } finally {
    active.delete(assistantMessage.id);
  }
}

// Stop generation: flags the turn and cancels the in-flight provider call.
export async function cancelTurn(organizationId, messageId) {
  const a = active.get(messageId);
  if (!a) return false;
  a.cancelled = true;
  // Shown as stopped at once; the turn stops at its next checkpoint.
  await prisma.aiCopilotMessage.updateMany({ where: { id: messageId, status: { in: RUNNING_STATUSES } }, data: { status: "Cancelled", safeError: "Stopped by the user.", cancelledAt: new Date(), completedAt: new Date() } });
  if (a.gatewayRequestId) {
    const running = await prisma.aiRequest.findFirst({ where: { organizationId, id: a.gatewayRequestId, status: { in: ["Queued", "Running"] } } });
    if (running) await cancelAiRequest(organizationId, running.id);
  }
  return true;
}

export const isActive = (messageId) => active.has(messageId);
export const newPublicId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
export { TOOLS, RECORD_ROUTES };

// Phase 11: the model only sees tools that are activated in governance.
async function governedCatalog(req) {
  const active = await activeToolNames(req, TOOL_REGISTRY_VERSION);
  const catalog = toolCatalogForModel(req);
  return { read: catalog.read.filter((t) => active.has(t.name)), propose: catalog.propose.filter((t) => active.has(t.name)) };
}
async function capabilityOn(req, key) {
  try { await checkCapability(req, key, { evaluation: !!req.aiEvaluation }); return true; } catch { return false; }
}
