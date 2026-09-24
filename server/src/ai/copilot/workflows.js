// Backend Phase 10 — governed Copilot workflows. Versioned templates whose
// steps the BACKEND runs in order (resolve → read tools → deterministic
// rules → compose → propose), within step, tool, time and cost limits. The
// model only writes the final evidence-cited text. Runs pause for
// clarification (ambiguous records — authorized options only), for tool
// approval (sensitive or broad reads) and for action confirmation
// (proposals). Step records hold concise operational reasons only.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { canonical } from "../../integrations/providers/catalogSeed.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { previewAction, serializeProposal } from "../actions/actionService.js";
import { newTurn, runTools, runSemantic, answerFromEvidence, createProposals, finishMessage, nextSeq, LIMITS } from "./orchestrator.js";
import { activePreferences } from "./memory.js";
import { LIMITATION } from "./citations.js";

export const WORKFLOW_LIMITS = { maxSteps: 14, maxToolCalls: 12, maxRuntimeMs: 150_000, maxCostUsd: 0.75, expiresHours: 24 };

// Declarative steps ($vars resolve from the run's input/scope).
export const WORKFLOWS = {
  company_briefing: {
    name: "Company briefing", mode: "briefing", description: "An evidence-backed briefing on one Company.", needs: "company",
    steps: [
      { type: "resolve", target: "company", reason: "Resolve the Company and verify access." },
      { type: "tool", tool: "get_company", args: { id: "$companyId" }, reason: "Company record." },
      { type: "tool", tool: "search_contacts", args: { companyId: "$companyId" }, reason: "Primary Contacts." },
      { type: "tool", tool: "search_activities", args: { companyId: "$companyId" }, reason: "Recent Activities and follow-ups." },
      { type: "tool", tool: "search_deals", args: { companyId: "$companyId", status: "Open" }, reason: "Open Deals." },
      { type: "tool", tool: "search_quotes", args: { companyId: "$companyId" }, reason: "Quotes." },
      { type: "tool", tool: "search_orders", args: { companyId: "$companyId" }, reason: "Orders." },
      { type: "tool", tool: "search_contracts", args: { companyId: "$companyId" }, reason: "Contracts." },
      { type: "tool", tool: "search_projects", args: { query: "$companyName" }, reason: "Current Projects." },
      { type: "documents", reason: "Relevant Documents (requires Phase 7)." },
      { type: "semantic", query: "$companyName", types: ["Ticket", "Activity", "CrmNote", "Project"], reason: "Support issues and notes mentioning the Company." },
      { type: "compose", instruction: "Write a Company briefing: summary, primary contacts, open deals, recent activities, outstanding follow-ups, quotes and orders, active contracts, support tickets, current projects, identified risks, missing information, and suggested preparation actions." },
      { type: "propose", reason: "Offer follow-up proposals." },
    ],
  },
  meeting_preparation: {
    name: "Meeting preparation", mode: "meeting", description: "A briefing and suggested agenda for a meeting with a Company.", needs: "company",
    steps: [
      { type: "resolve", target: "company", reason: "Resolve the meeting's Company." },
      { type: "tool", tool: "get_company", args: { id: "$companyId" }, reason: "Company record." },
      { type: "tool", tool: "search_contacts", args: { companyId: "$companyId" }, reason: "Authorized attendees." },
      { type: "tool", tool: "search_activities", args: { companyId: "$companyId" }, reason: "Recent interactions and commitments." },
      { type: "tool", tool: "search_deals", args: { companyId: "$companyId", status: "Open" }, reason: "Related Deals." },
      { type: "tool", tool: "search_contracts", args: { companyId: "$companyId" }, reason: "Contract and renewal dates." },
      { type: "semantic", query: "$companyName", types: ["Ticket", "Activity", "CrmNote"], reason: "Unresolved support issues and notes." },
      { type: "compose", instruction: "Prepare for a meeting. Meeting purpose: $purpose. Give context, attendees, recent interactions, open commitments, risks and a suggested agenda — label agenda items not supported by evidence as suggestions." },
      { type: "propose", reason: "Offer follow-up proposals." },
    ],
  },
  pipeline_review: {
    name: "Pipeline review", mode: "pipeline", description: "Deterministic pipeline figures with risks and priorities.", needs: null,
    steps: [
      { type: "tool", tool: "get_pipeline_metrics", args: { scope: "$scope" }, reason: "Deterministic pipeline totals." },
      { type: "tool", tool: "search_deals", args: { passedExpectedClose: true, mine: "$mine" }, reason: "Deals past their expected close date." },
      { type: "tool", tool: "search_deals", args: { noNextAction: true, mine: "$mine" }, reason: "Deals without a next action." },
      { type: "tool", tool: "search_deals", args: { status: "Open", mine: "$mine" }, reason: "Open Deals." },
      { type: "compose", instruction: "Review the pipeline: stage distribution, weighted pipeline, stale and past-due deals, deals without next actions, high-value deals needing attention, concentration, owner workload and data-quality limits. Use only the deterministic figures for totals." },
      { type: "propose", reason: "Offer follow-up proposals." },
    ],
  },
  renewal_review: {
    name: "Renewal review", mode: "renewal", description: "Contracts expiring soon and what to check.", needs: null,
    steps: [
      { type: "tool", tool: "search_contracts", args: { expiringWithinDays: "$withinDays" }, reason: "Contracts expiring soon (deterministic end dates)." },
      { type: "semantic", query: "renewal contract", types: ["Contract", "Ticket", "Activity"], reason: "Renewal-related notes and open issues." },
      { type: "compose", instruction: "Review renewals: contracts expiring, notice deadlines, renewal owners, source orders, values, open support issues, customer activity, missing renewal information and suggested review steps." },
      { type: "propose", reason: "Offer renewal-review proposals." },
    ],
  },
  data_quality_review: {
    name: "Data-quality review", mode: "data_quality", description: "Deterministic data-quality rules with correction proposals.", needs: null,
    steps: [
      { type: "tool", tool: "search_leads", args: { mine: "$mine" }, reason: "Leads to check." },
      { type: "tool", tool: "search_contacts", args: { mine: "$mine" }, reason: "Contacts to check." },
      { type: "tool", tool: "search_companies", args: { mine: "$mine" }, reason: "Companies to check." },
      { type: "tool", tool: "search_deals", args: { status: "Open", mine: "$mine" }, reason: "Open Deals to check." },
      { type: "tool", tool: "search_quotes", args: { status: "Expired" }, reason: "Expired Quotes." },
      { type: "rules", rules: "data_quality", reason: "Run deterministic quality rules and group issues." },
      { type: "compose", instruction: "Explain the data-quality issues found by the deterministic rules, their impact, and which corrections to make first. Corrections are only proposals." },
      { type: "propose_corrections", reason: "Offer correction previews (request missing information)." },
    ],
  },
  daily_preparation: {
    name: "Daily work preparation", mode: "daily", description: "A ranked, cited plan for today.", needs: null,
    steps: [
      { type: "tool", tool: "get_overdue_activities", args: { mine: true }, reason: "Overdue Activities." },
      { type: "tool", tool: "search_activities", args: { upcoming: true, mine: true, dueTo: "$tomorrow" }, reason: "Activities due today." },
      { type: "tool", tool: "search_deals", args: { noNextAction: true, mine: true }, reason: "Your Deals without next actions." },
      { type: "tool", tool: "search_deals", args: { passedExpectedClose: true, mine: true }, reason: "Your Deals past close date." },
      { type: "tool", tool: "search_support_tickets", args: { assignedToMe: true, open: true }, reason: "Your open Tickets." },
      { type: "tool", tool: "search_tasks", args: { assignedToMe: true }, reason: "Your Tasks." },
      { type: "rules", rules: "urgency", reason: "Rank by deterministic urgency." },
      { type: "compose", instruction: "Write a work plan for today in the ranked order given by the deterministic urgency list, citing each item." },
      { type: "propose", reason: "Offer follow-up proposals." },
    ],
  },
};

export const workflowChecksum = (w) => crypto.createHash("sha256").update(canonical({ steps: w.steps, limits: WORKFLOW_LIMITS })).digest("hex");

// Seeds templates and version 1 (immutable once published).
export async function seedWorkflowTemplates(db = prisma) {
  const out = { created: 0, unchanged: 0, conflicts: [] };
  for (const [key, w] of Object.entries(WORKFLOWS)) {
    const t = await db.aiWorkflowTemplate.upsert({ where: { key }, update: { name: w.name, description: w.description, mode: w.mode }, create: { key, name: w.name, description: w.description, mode: w.mode } });
    const checksum = workflowChecksum(w);
    const v = await db.aiWorkflowVersion.findUnique({ where: { templateId_version: { templateId: t.id, version: 1 } } });
    if (!v) { await db.aiWorkflowVersion.create({ data: { templateId: t.id, version: 1, steps: w.steps, limits: WORKFLOW_LIMITS, checksum, publishedAt: new Date() } }); out.created += 1; }
    else if (v.checksum !== checksum) out.conflicts.push(key);
    else out.unchanged += 1;
  }
  return out;
}

const resolveVars = (args, vars) => Object.fromEntries(Object.entries(args || {}).map(([k, v]) => [k, typeof v === "string" && v.startsWith("$") ? vars[v.slice(1)] : v]).filter(([, v]) => v !== undefined && v !== null && v !== ""));

// Deterministic rules over evidence (never the model).
function dataQualityRules(turn) {
  const items = turn.evidence.items;
  const f = (i) => i.fields || {};
  const openDealIds = new Set(items.filter((i) => i.recordType === "Deal").map((i) => i.recordId));
  const issues = {
    "Missing owner": items.filter((i) => ["Lead", "Contact", "Company", "Deal"].includes(i.recordType) && "ownerMembershipId" in f(i) && !f(i).ownerMembershipId),
    "Contact without email or phone": items.filter((i) => i.recordType === "Contact" && !f(i).email && !f(i).phone),
    "Contact without a Company": items.filter((i) => i.recordType === "Contact" && !f(i).companyId && !f(i).company),
    "Deal missing expected close date": items.filter((i) => i.recordType === "Deal" && !f(i).expectedClosingDate),
    "Deal missing currency": items.filter((i) => i.recordType === "Deal" && !f(i).currency),
    "Expired Quote on an open Deal": items.filter((i) => i.recordType === "Quote" && openDealIds.has(String(f(i).dealId || ""))),
  };
  const groups = Object.entries(issues).filter(([, list]) => list.length).map(([rule, list]) => ({ rule, count: list.length, records: list.slice(0, 10).map((i) => ({ handle: i.handle, recordType: i.recordType, recordId: i.recordId, label: i.label })) }));
  const summary = { recordType: "DataQualitySummary", recordId: `dq:${Date.now()}`, label: "Data-quality rules (deterministic)", route: null, updatedAt: new Date().toISOString(), sourceVersion: "computed", fields: { rulesRun: Object.keys(issues).length, issueGroups: JSON.stringify(groups.map((g) => ({ rule: g.rule, count: g.count, records: g.records.map((r) => r.handle) }))).slice(0, 3000) }, masked: [] };
  turn.evidence.add(summary, "deterministic");
  turn.deterministic = true;
  return groups;
}

function urgencyRules(turn) {
  const now = Date.now();
  const f = (i) => i.fields || {};
  const due = (i) => new Date(f(i).dueDate || f(i).expectedClosingDate || f(i).scheduledStart || 8.64e15).getTime();
  const score = (i) => {
    if (i.recordType === "Activity" && due(i) < now) return 100 + Math.min(50, Math.floor((now - due(i)) / 86_400_000));
    if (i.recordType === "Ticket") return /urgent|critical|high/i.test(String(f(i).priority)) ? 90 : 60;
    if (i.recordType === "Deal" && due(i) < now) return 80;
    if (i.recordType === "Activity") return 70;
    if (i.recordType === "Deal") return 50;
    if (i.recordType === "Task") return 40;
    return 10;
  };
  const ranked = turn.evidence.items.filter((i) => ["Activity", "Ticket", "Deal", "Task"].includes(i.recordType)).map((i) => ({ handle: i.handle, label: i.label, recordType: i.recordType, score: score(i) })).sort((a, b) => b.score - a.score).slice(0, 20);
  turn.evidence.add({ recordType: "WorkPlanRanking", recordId: `rank:${Date.now()}`, label: "Urgency ranking (deterministic)", route: null, updatedAt: new Date().toISOString(), sourceVersion: "computed", fields: { order: ranked.map((r, n) => `${n + 1}. ${r.handle} ${r.recordType} ${r.label}`).join(" | ").slice(0, 3000) }, masked: [] }, "deterministic");
  turn.deterministic = true;
  return ranked;
}

export const serializeRun = (r, steps = []) => ({
  _id: r.publicId, templateKey: r.templateKey, status: r.status, input: r.input, scope: r.scope, counters: r.counters, result: r.result,
  errorCategory: r.errorCategory, safeError: r.safeError, conversationId: r.conversationId, messageId: r.messageId, expiresAt: r.expiresAt,
  startedAt: r.startedAt, completedAt: r.completedAt, createdAt: r.createdAt, version: r.version,
  steps: steps.map((s) => ({ seq: s.seq, stepType: s.stepType, toolName: s.toolName, reason: s.reason, status: s.status, errorCategory: s.errorCategory, approvalState: s.approvalState, startedAt: s.startedAt, completedAt: s.completedAt })),
});

// Starts (or returns the identical running) workflow run.
export async function startWorkflow(req, templateKey, input, { conversation, idempotencyKey } = {}) {
  const w = WORKFLOWS[templateKey];
  if (!w) throw new AiError(CATEGORIES.INVALID_REQUEST, "Unknown workflow.");
  const template = await prisma.aiWorkflowTemplate.findUnique({ where: { key: templateKey } });
  const version = template && await prisma.aiWorkflowVersion.findFirst({ where: { templateId: template.id, status: "Published" }, orderBy: { version: "desc" } });
  if (!version) throw new AiError(CATEGORIES.INVALID_REQUEST, "Workflow templates aren't seeded. Run npm run db:seed:ai.");
  if (idempotencyKey) {
    const earlier = await prisma.aiWorkflowRun.findUnique({ where: { organizationId_idempotencyKey: { organizationId: req.organizationId, idempotencyKey } } });
    if (earlier) return { run: earlier, replayed: true };
  }
  // Duplicate prevention: the same person, template and input already running.
  const dup = await prisma.aiWorkflowRun.findFirst({ where: { organizationId: req.organizationId, membershipId: req.membership.id, templateKey, status: { in: ["Ready", "Running"] }, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
  if (dup && canonical(dup.input) === canonical(input || {})) return { run: dup, duplicate: true };
  const run = await prisma.aiWorkflowRun.create({
    data: {
      publicId: `awr_${crypto.randomBytes(9).toString("base64url")}`, organizationId: req.organizationId, membershipId: req.membership.id, conversationId: conversation?.id || null,
      templateKey, versionId: version.id, status: "Ready", input: input || {}, limits: WORKFLOW_LIMITS, idempotencyKey: idempotencyKey || null,
      expiresAt: new Date(Date.now() + WORKFLOW_LIMITS.expiresHours * 3_600_000),
    },
  });
  await aiAudit(req, "ai.copilot.workflow_started", "AiWorkflowRun", run.id, { after: { templateKey } });
  return { run };
}

async function step(run, seq, data) {
  return prisma.aiWorkflowStep.upsert({ where: { runId_seq: { runId: run.id, seq } }, update: data, create: { organizationId: run.organizationId, runId: run.id, seq, stepType: data.stepType || "step", reason: data.reason || "", status: data.status || "Running", ...data } });
}

// Executes (or resumes) a run to completion or the next pause.
export async function executeWorkflow(req, runId, conversation) {
  let run = await prisma.aiWorkflowRun.findUnique({ where: { id: runId } });
  const w = WORKFLOWS[run.templateKey];
  const version = await prisma.aiWorkflowVersion.findUnique({ where: { id: run.versionId } });
  const steps = version.steps;
  const seq = await nextSeq(conversation.id);
  const message = await prisma.aiCopilotMessage.create({ data: { organizationId: req.organizationId, conversationId: conversation.id, seq, role: "assistant", status: "Retrieving", workflowRunId: run.id } });
  run = await prisma.aiWorkflowRun.update({ where: { id: run.id }, data: { status: "Running", startedAt: run.startedAt || new Date(), messageId: message.id, conversationId: conversation.id, version: { increment: 1 } } });
  const turn = newTurn(req, conversation, `${w.name}${run.input.companyName ? ` — ${run.input.companyName}` : ""}${run.input.purpose ? ` (${run.input.purpose})` : ""}`, { messageId: message.id, workflowRunId: run.id });
  const vars = {
    ...run.input, ...(run.scope || {}), mine: run.input.scope === "organization" ? undefined : true, scope: run.input.scope === "organization" ? "organization" : undefined,
    withinDays: Number(run.input.withinDays) || 90, purpose: run.input.purpose || "not stated", tomorrow: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  };
  let n = 0;
  const finishRun = async (status, extra = {}) => prisma.aiWorkflowRun.update({ where: { id: run.id }, data: { status, completedAt: ["Completed", "Completed with limitations", "Failed", "Cancelled"].includes(status) ? new Date() : null, counters: { providerCalls: turn.providerCalls, toolCalls: turn.toolCalls, records: turn.evidence.size, costUsd: turn.costUsd }, ...extra } });
  try {
    for (const s of steps) {
      n += 1;
      if (n > WORKFLOW_LIMITS.maxSteps) throw new AiError(CATEGORIES.POLICY, "The workflow reached its step limit.");
      if (Date.now() - turn.started > WORKFLOW_LIMITS.maxRuntimeMs) throw new AiError(CATEGORIES.TIMEOUT, "The workflow reached its time limit.");
      const current = await prisma.aiWorkflowRun.findUnique({ where: { id: run.id }, select: { status: true } });
      if (current.status === "Cancelled") throw Object.assign(new AiError(CATEGORIES.UNKNOWN, "Cancelled."), { cancelled: true });
      await step(run, n, { stepType: s.type, toolName: s.tool || null, reason: s.reason || s.type, input: resolveVars(s.args, vars), status: "Running", startedAt: new Date() });
      if (s.type === "resolve") {
        if (vars.companyId) {
          await runTools(turn, [{ tool: "get_company", arguments: { id: vars.companyId }, reason: "Verify access" }]);
          const c = turn.evidence.items.find((i) => i.recordType === "Company" && i.recordId === vars.companyId);
          if (!c) throw new AiError(CATEGORIES.PERMISSION, "That Company wasn't found, or you can't open it.");
          vars.companyName = c.label;
        } else if (vars.companyName) {
          await runTools(turn, [{ tool: "search_companies", arguments: { query: String(vars.companyName).slice(0, 120) }, reason: "Resolve by name" }]);
          const matches = turn.evidence.items.filter((i) => i.recordType === "Company" && i.label.toLowerCase().includes(String(vars.companyName).toLowerCase()));
          if (!matches.length) throw new AiError(CATEGORIES.INVALID_REQUEST, `No Company you can see matches "${vars.companyName}".`);
          if (matches.length > 1) {
            const options = matches.slice(0, 8).map((i) => ({ recordType: "Company", recordId: i.recordId, label: i.label }));
            const c = await prisma.aiClarificationRequest.create({ data: { organizationId: req.organizationId, conversationId: conversation.id, messageId: message.id, workflowRunId: run.id, question: `More than one company matches "${vars.companyName}". Which one?`, reason: "duplicate_names", options } });
            await step(run, n, { status: "Awaiting clarification", completedAt: new Date() });
            await finishMessage(turn, { status: "Completed", intent: w.mode, content: c.question, parts: [{ kind: "clarification", data: { clarificationId: c.id, question: c.question, options, workflowRunId: run.publicId } }] });
            return finishRun("Awaiting clarification");
          }
          vars.companyId = matches[0].recordId; vars.companyName = matches[0].label;
        } else throw new AiError(CATEGORIES.INVALID_REQUEST, "Choose the Company for this workflow.");
        await prisma.aiWorkflowRun.update({ where: { id: run.id }, data: { scope: { companyId: vars.companyId, companyName: vars.companyName } } });
      } else if (s.type === "tool") {
        await runTools(turn, [{ tool: s.tool, arguments: resolveVars(s.args, vars), reason: s.reason }]);
        if (turn.toolCalls > WORKFLOW_LIMITS.maxToolCalls) throw new AiError(CATEGORIES.POLICY, "The workflow reached its data-request limit.");
      } else if (s.type === "semantic") {
        await runSemantic(turn, String(resolveVars({ q: s.query }, vars).q || s.query), s.types);
      } else if (s.type === "documents") {
        turn.limitations.add(LIMITATION.documents);
      } else if (s.type === "rules") {
        const out = s.rules === "data_quality" ? dataQualityRules(turn) : urgencyRules(turn);
        vars.ruleOutput = out;
      } else if (s.type === "compose") {
        if (turn.approvalsNeeded.length) {
          await step(run, n, { status: "Awaiting tool approval", approvalState: "Pending", completedAt: new Date() });
          await finishMessage(turn, { status: "Awaiting tool", intent: w.mode, content: "Part of this workflow needs your confirmation before those records are read.", parts: turn.approvalsNeeded.map((a) => ({ kind: "tool_approval", data: { ...a, workflowRunId: run.publicId } })) });
          return finishRun("Awaiting tool approval");
        }
        const instruction = s.instruction.replace("$purpose", vars.purpose);
        const ans = await answerFromEvidence(turn, { mode: w.mode, preferences: await activePreferences(req), extraInstruction: instruction });
        if (ans.refused) throw new AiError(CATEGORIES.CONTENT_REFUSED, "The AI model declined to write this workflow's summary.");
        vars.answer = ans;
      } else if (s.type === "propose" && vars.answer) {
        vars.proposalParts = await createProposals(turn, vars.answer.suggestedActions, vars.answer.requestId);
      } else if (s.type === "propose_corrections" && vars.ruleOutput?.length && hasGrant(req, "ai_actions", "propose")) {
        vars.proposalParts = [];
        for (const g of vars.ruleOutput.slice(0, 3)) {
          const r = g.records.find((x) => ["Deal", "Lead", "Contact", "Company"].includes(x.recordType));
          if (!r) continue;
          try {
            const p = await previewAction(req, { actionType: "request_missing_information", targetType: r.recordType, targetId: r.recordId, proposedValues: { subject: `${g.rule}: ${r.label}` }, reason: `Data-quality rule: ${g.rule}.`, source: "Model", evidence: [{ recordType: r.recordType, recordId: r.recordId, label: r.label }] });
            vars.proposalParts.push({ kind: "proposal", data: serializeProposal(p, req) });
          } catch { /* not allowed for this record */ }
        }
      }
      await step(run, n, { status: "Completed", completedAt: new Date(), outputRef: { evidence: turn.evidence.size } });
    }
    const ans = vars.answer;
    const parts = [...(ans?.findings || []).map((f) => ({ kind: "finding", data: f })), ...(vars.proposalParts || []), ...(turn.restricted ? [{ kind: "restricted_notice", data: { text: LIMITATION.restricted } }] : [])];
    await finishMessage(turn, { status: "Completed", intent: w.mode, content: ans?.answer || "The workflow completed.", parts, citations: ans?.citations || [] });
    const pendingProposals = (vars.proposalParts || []).some((p) => p.kind === "proposal" && p.data.status === "Awaiting Confirmation");
    return finishRun(pendingProposals ? "Awaiting action confirmation" : turn.limitations.size ? "Completed with limitations" : "Completed", { result: { messageId: message.id, findings: parts.filter((p) => p.kind === "finding").length } });
  } catch (err) {
    const cancelled = !!err.cancelled;
    const e = err instanceof AiError ? err : new AiError(CATEGORIES.UNKNOWN, "The workflow failed.");
    await step(run, n || 1, { status: cancelled ? "Cancelled" : "Failed", errorCategory: e.category, completedAt: new Date() }).catch(() => {});
    await prisma.aiCopilotMessage.update({ where: { id: message.id }, data: { status: cancelled ? "Cancelled" : "Failed", safeError: e.message, errorCategory: e.category, completedAt: new Date() } });
    return finishRun(cancelled ? "Cancelled" : "Failed", { errorCategory: cancelled ? null : e.category, safeError: e.message });
  }
}

export async function expireWorkflowRuns(now = new Date()) {
  return (await prisma.aiWorkflowRun.updateMany({ where: { status: { in: ["Ready", "Awaiting clarification", "Awaiting tool approval", "Awaiting action confirmation", "Awaiting approver"] }, expiresAt: { lt: now } }, data: { status: "Expired" } })).count;
}

export { LIMITS };
