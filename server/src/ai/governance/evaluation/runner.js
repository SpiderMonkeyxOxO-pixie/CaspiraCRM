// Backend Phase 11 — evaluation runs (application-owned, provider-neutral).
// A run executes every case of a suite against a candidate configuration
// (provider, model, prompt/tool/workflow versions), grades it, computes
// metrics with sample sizes, and evaluates the zero-tolerance and quality
// gates. An incomplete run never passes. Copilot cases run as a real member of
// the run's organization (fixture data in development); production data is
// only used through an authorized, redacted dataset.
import crypto from "node:crypto";
import prisma from "../../../lib/prisma.js";
import { AiError, CATEGORIES } from "../../common/errors.js";
import { aiAudit } from "../../common/audit.js";
import { recordOutboxEvent } from "../../../services/outboxService.js";
import { runAi } from "../../gateway/gateway.js";
import { claimsAction } from "../../gateway/outputSchemas.js";
import { authorizeToolCall, ToolDenied } from "../../copilot/tools/registry.js";
import { shapeRecord } from "../../copilot/evidence.js";
import { validateMemoryValue } from "../../copilot/memory.js";
import { runTurn, detectProhibited, nextSeq, newPublicId } from "../../copilot/orchestrator.js";
import { checkCapability } from "../runtime.js";
import { moderate, scanOutput, injectionFlags, digest } from "../safety.js";
import { aiEnvironment } from "../catalog.js";
import { codeGrader, schemaGrader, authorizationGrader, evidenceGrader, citationGrader, humanGrader, llmGrader, caseOutcome, disagreement, citationMetrics } from "./graders.js";

const bad = (m, status = 422) => Object.assign(new AiError(CATEGORIES.INVALID_REQUEST, m), { httpStatus: status });
const TERMINAL = ["Passed", "Passed with warnings", "Failed", "Cancelled", "Invalid", "Superseded"];
const cancelled = new Set();

export const serializeRun = (r) => ({
  _id: r.publicId, suiteId: r.suiteId, candidate: r.candidate, releaseId: r.releaseId, trigger: r.trigger, status: r.status, sampleSize: r.sampleSize, completedCases: r.completedCases,
  passed: r.passed, failed: r.failed, errored: r.errored, needsReview: r.needsReview, zeroToleranceFailures: r.zeroToleranceFailures, metrics: r.metrics, gateResults: r.gateResults,
  estimatedCost: r.estimatedCost === null ? null : Number(r.estimatedCost), costLabel: "Estimated — not a provider invoice", usage: r.usage,
  reviewDecision: r.reviewDecision, startedAt: r.startedAt, completedAt: r.completedAt, cancelledAt: r.cancelledAt, createdAt: r.createdAt,
});

async function suiteCases(suite) {
  const out = [];
  for (const vid of suite.datasetVersionIds || []) {
    const v = await prisma.aiEvaluationDatasetVersion.findUnique({ where: { id: vid } });
    if (!v || v.status === "Deleted") continue;
    const ds = await prisma.aiEvaluationDataset.findUnique({ where: { id: v.datasetId } });
    // Incident-derived datasets always run their latest version.
    const use = ds?.type === "incident_derived" ? await prisma.aiEvaluationDatasetVersion.findFirst({ where: { datasetId: ds.id, status: { not: "Deleted" } }, orderBy: { version: "desc" } }) : v;
    const cases = await prisma.aiEvaluationCase.findMany({ where: { datasetVersionId: use.id }, orderBy: { key: "asc" } });
    out.push(...cases.map((c) => ({ ...c, datasetKey: ds.key, datasetVersion: use.version, datasetSource: ds.source })));
  }
  return out;
}

export async function startEvaluationRun(req, { suiteKey, suiteVersion = null, candidate = {}, releaseId = null, trigger = "manual" }) {
  const suite = suiteVersion ? await prisma.aiEvaluationSuite.findUnique({ where: { key_version: { key: suiteKey, version: Number(suiteVersion) } } }) : await prisma.aiEvaluationSuite.findFirst({ where: { key: suiteKey, status: "Active" }, orderBy: { version: "desc" } });
  if (!suite) throw bad("Unknown evaluation suite.", 404);
  const cases = await suiteCases(suite);
  if (!cases.length) throw bad("This suite has no cases.");
  const cand = {
    providerKey: candidate.providerKey || "simulator", modelId: candidate.modelId || null, alias: candidate.alias || null,
    promptVersions: candidate.promptVersions || {}, toolVersions: candidate.toolVersions || {}, workflowVersions: candidate.workflowVersions || {}, retrieval: candidate.retrieval || null,
  };
  const run = await prisma.aiEvalRun.create({ data: { publicId: `aer_${crypto.randomBytes(8).toString("base64url")}`, organizationId: req.organizationId, suiteId: suite.id, candidate: cand, releaseId, trigger, sampleSize: cases.length, createdByUserId: req.user?.id || null } });
  await aiAudit(req, "ai.evaluation.run_started", "AiEvalRun", run.id, { after: { suite: `${suite.key}@${suite.version}`, candidate: cand, trigger, sampleSize: cases.length } });
  return run;
}

// The evaluating member for a role, in the run's organization.
async function memberReq(run, roleKey, cache) {
  if (cache[roleKey]) return cache[roleKey];
  const m = await prisma.organizationMembership.findFirst({ where: { organizationId: run.organizationId, status: "Active", roles: { some: { role: { key: roleKey } } } }, include: { roles: { include: { role: true } }, user: true } });
  if (!m) throw new Error(`No active member with the ${roleKey} role in this organization to evaluate as.`);
  const req = { organizationId: run.organizationId, membership: m, user: { id: m.userId, role: m.user.role }, isSystemOwnerOverride: false, headers: {}, ip: "evaluation", correlationId: `eval-${run.publicId}`, get: () => undefined, aiEvaluation: { runId: run.id, candidate: run.candidate } };
  cache[roleKey] = req;
  return req;
}

const grantsReq = (grants, organizationId) => ({ organizationId, membership: { id: "eval-synthetic", roles: [{ role: { key: "synthetic", permissionGrants: Object.entries(grants || {}).map(([moduleId, actions]) => ({ moduleId, actions })) } }] }, user: { id: "eval-synthetic" } });

async function runDeterministic(c, run) {
  const a = c.input.args || {};
  switch (c.input.check) {
    case "tool_authorization":
      try { const r = authorizeToolCall(grantsReq(a.grants, run.organizationId), a.tool, a.input); return { outcome: "allow", details: { input: r.input } }; }
      catch (e) { return { outcome: "deny", reason: e instanceof ToolDenied ? e.reason : "error", details: { message: e.message } }; }
    case "gate_without_identity":
      try { await checkCapability({ organizationId: run.organizationId }, "ai_copilot"); return { outcome: "allow" }; } catch (e) { return { outcome: "deny", details: { message: e.message } }; }
    case "record_shaping": { const r = shapeRecord(a.recordType, a.record); return { outcome: "shaped", details: { fields: r.fields, masked: r.masked } }; }
    case "prohibited_detection": { const hits = (a.texts || []).map((t) => !!detectProhibited(t)); return { outcome: hits.every(Boolean) ? "deny" : "allow", details: { missed: (a.texts || []).filter((t, i) => !hits[i]).length } }; }
    case "claims_action": { const hits = (a.texts || []).map((t) => claimsAction(t)); return { outcome: hits.every(Boolean) ? "deny" : "allow", details: { missed: hits.filter((h) => !h).length } }; }
    case "output_scan": { const r = scanOutput(a.text); return { outcome: r.findings.length ? "deny" : "allow", details: { findings: r.findings } }; }
    case "injection_detection": { const hits = (a.texts || []).map((t) => injectionFlags(t).length > 0); return { outcome: hits.every(Boolean) ? "flagged" : "missed", details: { missed: hits.filter((h) => !h).length } }; }
    case "tool_result_screening": return { outcome: injectionFlags(a.text).length ? "flagged" : "missed" };
    case "moderation": { const m = await moderate(a.text); return { outcome: m.decision === "Allow" ? "allow" : "flagged", details: { decision: m.decision, categories: m.categories } }; }
    case "memory_validation": { const denied = (a.values || []).map(([k, v]) => { try { validateMemoryValue(k, v); return false; } catch { return true; } }); return { outcome: denied.every(Boolean) ? "deny" : "allow", details: { accepted: denied.filter((d) => !d).length } }; }
    default: throw new Error(`Unknown deterministic check ${c.input.check}.`);
  }
}

async function runGateway(c, req) {
  try {
    const out = await runAi({ req, useCaseKey: c.input.useCaseKey, dataVariables: c.input.dataVariables, textVariables: c.input.textVariables, numericFacts: c.input.numericFacts, skipPermission: true });
    const request = await prisma.aiRequest.findUnique({ where: { id: out.request.id } });
    return { output: out.output, validation: out.validation, request, cost: out.estimatedCost ?? null, question: Object.values(c.input.textVariables || {}).join(" ") };
  } catch (e) {
    const request = e.requestId ? await prisma.aiRequest.findUnique({ where: { id: e.requestId } }) : null;
    return { output: null, error: e.message, request, cost: null };
  }
}

async function runCopilot(c, req) {
  const conversation = await prisma.aiCopilotConversation.create({ data: { publicId: newPublicId("acc"), organizationId: req.organizationId, userId: req.user.id, membershipId: req.membership.id, title: `[evaluation] ${c.key}`, mode: "ask", status: "Evaluation" } });
  const startedAt = new Date();
  await prisma.aiCopilotMessage.create({ data: { organizationId: req.organizationId, conversationId: conversation.id, seq: await nextSeq(conversation.id), role: "user", status: "Completed", content: c.input.text, completedAt: new Date() } });
  const assistant = await prisma.aiCopilotMessage.create({ data: { organizationId: req.organizationId, conversationId: conversation.id, seq: await nextSeq(conversation.id), role: "assistant", status: "Queued" } });
  await runTurn(req, conversation, c.input.text, assistant);
  const [message, parts, citations, toolCalls] = await Promise.all([
    prisma.aiCopilotMessage.findUnique({ where: { id: assistant.id } }), prisma.aiCopilotMessagePart.findMany({ where: { messageId: assistant.id }, orderBy: { seq: "asc" } }),
    prisma.aiCopilotCitation.findMany({ where: { messageId: assistant.id } }), prisma.aiCopilotToolCall.findMany({ where: { messageId: assistant.id } }),
  ]);
  const requestIds = Array.isArray(message.requestIds) ? message.requestIds : [];
  const proposals = await prisma.aiActionProposal.findMany({ where: { organizationId: req.organizationId, OR: [{ requestId: { in: requestIds } }, { proposedByMembershipId: req.membership.id, createdAt: { gte: startedAt }, source: "Model" }] } });
  const executions = proposals.length ? await prisma.aiActionExecution.findMany({ where: { proposalId: { in: proposals.map((p) => p.id) } } }) : [];
  const memories = await prisma.aiCopilotMemory.findMany({ where: { sourceMessageId: assistant.id } });
  const usage = await prisma.aiUsageRecord.aggregate({ where: { requestId: { in: requestIds } }, _sum: { estimatedCost: true } });
  return {
    message: { ...message, parts: parts.map((p) => ({ kind: p.kind, data: p.data })), citations: citations.map((x) => ({ key: x.citationKey, recordType: x.recordType, recordId: x.recordId, status: x.status })) },
    toolCalls: toolCalls.map((t) => ({ toolName: t.toolName, status: t.status, input: t.input })), proposals, executions, memories, requestIds, question: c.input.text,
    cost: usage._sum.estimatedCost === null ? null : Number(usage._sum.estimatedCost),
  };
}

const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

// Executes a queued run to completion (worker, or inline when asked).
export async function executeEvaluationRun(runId) {
  const claimed = await prisma.aiEvalRun.updateMany({ where: { id: runId, status: "Queued" }, data: { status: "Running", startedAt: new Date() } });
  if (claimed.count !== 1) return prisma.aiEvalRun.findUnique({ where: { id: runId } });
  const run = await prisma.aiEvalRun.findUnique({ where: { id: runId } });
  const suite = await prisma.aiEvaluationSuite.findUnique({ where: { id: run.suiteId } });
  const cases = await suiteCases(suite);
  const graders = Object.fromEntries((await prisma.aiEvaluationGrader.findMany()).map((g) => [g.key, g]));
  const use = new Set(suite.graderKeys || []);
  const members = {};
  let totalCost = 0; let costKnown = true; let completed = 0;
  for (const c of cases) {
    if (cancelled.has(run.id) || (await prisma.aiEvalRun.findUnique({ where: { id: run.id }, select: { status: true } })).status === "Cancelled") { cancelled.delete(run.id); break; }
    const t0 = Date.now();
    let obs; let error = null;
    try {
      if (c.input.kind === "deterministic") obs = { kind: "deterministic", ...(await runDeterministic(c, run)) };
      else {
        if (aiEnvironment() === "production" && c.datasetSource !== "Production") throw new Error("Copilot and gateway cases run against CRM data; in production they need an authorized, redacted production dataset.");
        const req = await memberReq(run, c.input.asRole || "admin", members);
        obs = c.input.kind === "gateway" ? { kind: "gateway", ...(await runGateway(c, req)) } : { kind: "copilot", ...(await runCopilot(c, req)) };
      }
    } catch (e) { error = String(e.message || e).slice(0, 300); }
    const latencyMs = Date.now() - t0;
    let verdicts = []; let outcome = "Error"; let cm = null;
    if (!error) {
      const exp = c.expectations || {};
      const gReq = obs.kind === "copilot" || obs.kind === "gateway" ? await memberReq(run, c.input.asRole || "admin", members) : null;
      verdicts = [
        use.has("code_exact") ? codeGrader(exp.code, obs) : null, use.has("schema") ? schemaGrader(exp.schema, obs) : null,
        use.has("authorization") ? await authorizationGrader(exp.authorization, obs, gReq) : null, use.has("evidence") ? evidenceGrader(exp.evidence, obs) : null,
        use.has("citation") ? citationGrader(exp.citation, obs) : null, exp.human ? humanGrader(exp.human) : null,
        use.has("llm_quality") && exp.llm ? await llmGrader(exp.llm, obs, { grader: graders.llm_quality, runAiFn: runAi, graderReq: gReq, candidate: run.candidate }) : null,
      ].filter(Boolean);
      outcome = caseOutcome(verdicts);
      if (obs.kind === "copilot") cm = citationMetrics(obs);
      if (obs.cost !== null && obs.cost !== undefined) totalCost += obs.cost; else if (obs.kind !== "deterministic") costKnown = false;
      for (const v of verdicts) if (v.kind === "llm" && typeof v.cost === "number") totalCost += v.cost;
    }
    const zt = outcome === "Fail" && (c.zeroTolerance || []).length ? c.zeroTolerance[0] : null;
    const excerpt = obs?.kind === "copilot" ? obs.message?.content : obs?.kind === "gateway" ? JSON.stringify(obs.output || obs.error || "") : JSON.stringify(obs?.details || {});
    await prisma.aiEvalResult.create({
      data: {
        runId: run.id, organizationId: run.organizationId, caseId: c.id, outcome, graderVerdicts: error ? [{ grader: "runner", kind: "runner", verdict: "Error", reasons: [error] }] : verdicts,
        disagreement: disagreement(verdicts, outcome), zeroToleranceCategory: zt, requestIds: obs?.requestIds || (obs?.request ? [obs.request.id] : []),
        metrics: { latencyMs, kind: c.input.kind, dataset: `${c.datasetKey}@${c.datasetVersion}`, citation: cm, cost: obs?.cost ?? null, llmScore: verdicts.find((v) => v.kind === "llm")?.score ?? null },
        outputDigest: excerpt ? digest(excerpt) : null, safeExcerpt: excerpt ? scanOutput(String(excerpt)).text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]").slice(0, 400) : null,
      },
    });
    completed += 1;
    await prisma.aiEvalRun.update({ where: { id: run.id }, data: { completedCases: completed } });
  }
  return finalizeRun(run.id, { totalCost, costKnown });
}

// Metrics, gates and status from stored results (re-run after human reviews).
export async function finalizeRun(runId, { totalCost = null, costKnown = true } = {}) {
  const run = await prisma.aiEvalRun.findUnique({ where: { id: runId } });
  const suite = await prisma.aiEvaluationSuite.findUnique({ where: { id: run.suiteId } });
  const results = await prisma.aiEvalResult.findMany({ where: { runId } });
  const cases = Object.fromEntries((await prisma.aiEvaluationCase.findMany({ where: { id: { in: results.map((r) => r.caseId) } } })).map((c) => [c.id, c]));
  const count = (o) => results.filter((r) => r.outcome === o).length;
  const det = results.filter((r) => r.metrics?.kind === "deterministic");
  const cop = results.filter((r) => r.metrics?.kind === "copilot");
  const precisions = cop.map((r) => r.metrics?.citation?.precision).filter((v) => v !== null && v !== undefined);
  const coverages = cop.map((r) => r.metrics?.citation?.coverage).filter((v) => v !== null && v !== undefined);
  const evidenceFails = cop.filter((r) => (r.graderVerdicts || []).some((v) => v.kind === "evidence" && v.verdict === "Fail")).length;
  const llmScores = results.map((r) => r.metrics?.llmScore).filter((v) => typeof v === "number");
  const cost = totalCost ?? Number(run.estimatedCost || 0);
  const passed = count("Pass");
  const metrics = {
    deterministic_accuracy: det.length ? det.filter((r) => r.outcome === "Pass").length / det.length : null, deterministic_sample: det.length,
    citation_precision: mean(precisions), citation_coverage: mean(coverages), citation_sample: precisions.length,
    unsupported_claim_rate: cop.length ? evidenceFails / cop.length : null, copilot_sample: cop.length,
    p95_latency_ms: pct(results.map((r) => r.metrics?.latencyMs || 0), 95), cost_per_success_usd: passed ? Math.round((cost / passed) * 1e6) / 1e6 : null,
    llm_quality_mean: mean(llmScores), llm_quality_sample: llmScores.length, grader_disagreements: results.filter((r) => r.disagreement).length,
    zero_tolerance_categories_failed: [...new Set(results.map((r) => r.zeroToleranceCategory).filter(Boolean))],
  };
  const datasetVersions = [...new Set(results.map((r) => r.metrics?.dataset).filter(Boolean))];
  const zeroFails = results.filter((r) => r.zeroToleranceCategory).length;
  const zeroCases = results.filter((r) => (cases[r.caseId]?.zeroTolerance || []).length);
  const gateResults = [{
    key: "zero_tolerance", kind: "zero_tolerance", level: "block", status: zeroFails ? "Failed" : zeroCases.some((r) => r.outcome === "Error") ? "Invalid" : "Passed",
    value: zeroFails, threshold: 0, sampleSize: zeroCases.length, datasetVersions, method: "Any failure in a zero-tolerance case blocks the release; no exception can waive it.", failures: metrics.zero_tolerance_categories_failed,
  }];
  for (const g of suite.qualityGates || []) {
    const value = metrics[g.metric];
    const sample = g.metric.startsWith("citation") ? metrics.citation_sample : g.metric === "deterministic_accuracy" ? metrics.deterministic_sample : g.metric === "unsupported_claim_rate" ? metrics.copilot_sample : results.length;
    const ok = value === null || value === undefined ? null : g.comparator === "gte" ? value >= g.threshold : value <= g.threshold;
    gateResults.push({ key: g.key, kind: "quality", level: g.level || "block", metric: g.metric, comparator: g.comparator, threshold: g.threshold, value, sampleSize: sample, datasetVersions, method: g.method, status: ok === null ? "Insufficient data" : ok ? "Passed" : g.level === "warn" ? "Warning" : "Failed" });
  }
  const errored = count("Error"); const needsReview = count("Needs review");
  let status;
  if (run.status === "Cancelled" || run.cancelledAt) status = "Cancelled";
  else if (results.length < run.sampleSize || errored) status = "Invalid";
  else if (zeroFails || gateResults.some((g) => g.level === "block" && ["Failed", "Insufficient data", "Invalid"].includes(g.status))) status = "Failed";
  else if (needsReview) status = "Awaiting human review";
  else status = gateResults.some((g) => g.status === "Warning") ? "Passed with warnings" : "Passed";
  const updated = await prisma.aiEvalRun.update({
    where: { id: runId },
    data: { status, passed, failed: count("Fail"), errored, needsReview, zeroToleranceFailures: zeroFails, metrics, gateResults, estimatedCost: costKnown ? cost : null, completedAt: TERMINAL.includes(status) ? new Date() : null, completedCases: results.length },
  });
  await aiAudit({ user: null, organizationId: run.organizationId }, "ai.evaluation.run_completed", "AiEvalRun", run.id, { organizationId: run.organizationId, after: { status, passed, failed: updated.failed, zeroToleranceFailures: zeroFails } });
  if (status === "Failed" || status === "Invalid") {
    await prisma.aiHumanReviewItem.create({ data: { organizationId: run.organizationId, scope: run.organizationId, queue: "failed_evaluation", subjectType: "EvaluationRun", subjectId: run.id, priority: zeroFails ? "High" : "Normal", summary: `${suite.name} ${status.toLowerCase()} (${updated.failed} failed, ${zeroFails} zero-tolerance).`, context: { runId: run.publicId, suite: `${suite.key}@${suite.version}`, gates: gateResults.map((g) => ({ key: g.key, status: g.status })) }, recommendedDecision: "Reject" } }).catch(() => {});
    await recordOutboxEvent(prisma, { aggregateType: "AiEvalRun", aggregateId: run.id, eventType: "ai.evaluation.failed", payload: { organizationId: run.organizationId, suite: suite.key, status, notifyRoleKeys: ["admin", "ai_governance_admin", "ai_safety_reviewer"] } }).catch(() => {});
  }
  if (needsReview && status === "Awaiting human review") {
    for (const r of results.filter((x) => x.outcome === "Needs review")) {
      const exists = await prisma.aiHumanReviewItem.findFirst({ where: { subjectType: "EvaluationResult", subjectId: r.id } });
      if (!exists) await prisma.aiHumanReviewItem.create({ data: { organizationId: run.organizationId, scope: run.organizationId, queue: "failed_evaluation", subjectType: "EvaluationResult", subjectId: r.id, summary: `Human review for ${cases[r.caseId]?.key}`, context: { runId: run.publicId, caseKey: cases[r.caseId]?.key, excerpt: r.safeExcerpt, verdicts: r.graderVerdicts }, createdByUserId: run.createdByUserId } });
    }
  }
  if (run.releaseId) { const { onEvaluationFinished } = await import("../releases.js"); await onEvaluationFinished(run.releaseId, updated).catch(() => {}); }
  return updated;
}

export async function cancelEvaluationRun(req, run) {
  if (TERMINAL.includes(run.status)) throw bad(`This run is ${run.status.toLowerCase()}.`);
  cancelled.add(run.id);
  const u = await prisma.aiEvalRun.update({ where: { id: run.id }, data: { status: "Cancelled", cancelledAt: new Date(), completedAt: new Date() } });
  await aiAudit(req, "ai.evaluation.run_cancelled", "AiEvalRun", run.id);
  return u;
}

// A person decides a "Needs review" result; the prompt author of a candidate
// prompt can't be the sole evaluator.
export async function reviewResult(req, run, { resultId, decision, reason }) {
  if (!["Pass", "Fail"].includes(decision)) throw bad("decision: Pass or Fail.");
  const r = await prisma.aiEvalResult.findFirst({ where: { id: String(resultId), runId: run.id } });
  if (!r) throw bad("Result not found.", 404);
  const promptAuthors = await promptAuthorsFor(run.candidate);
  if (promptAuthors.includes(req.user?.id)) throw bad("The author of a candidate prompt can't be the evaluator of this run.", 403);
  const verdicts = (r.graderVerdicts || []).map((v) => (v.kind === "human" ? { ...v, verdict: decision, reasons: [String(reason || "").slice(0, 300)], reviewerUserId: req.user?.id } : v));
  const outcome = caseOutcome(verdicts);
  const c = await prisma.aiEvaluationCase.findUnique({ where: { id: r.caseId } });
  await prisma.aiEvalResult.update({ where: { id: r.id }, data: { graderVerdicts: verdicts, outcome, zeroToleranceCategory: outcome === "Fail" && (c?.zeroTolerance || []).length ? c.zeroTolerance[0] : null } });
  await prisma.aiHumanReviewItem.updateMany({ where: { subjectType: "EvaluationResult", subjectId: r.id, status: "Open" }, data: { status: decision === "Pass" ? "Approved" : "Rejected", decision: decision === "Pass" ? "Approve" : "Reject", decidedByUserId: req.user?.id, reason, decidedAt: new Date() } });
  await prisma.aiGovernanceApproval.create({ data: { organizationId: run.organizationId, subjectType: "EvaluationRun", subjectId: run.id, reviewerUserId: req.user.id, decision: decision === "Pass" ? "Approve" : "Reject", reason: reason ? String(reason).slice(0, 500) : null } });
  await aiAudit(req, "ai.evaluation.result_reviewed", "AiEvalRun", run.id, { reason, after: { resultId: r.id, decision } });
  return finalizeRun(run.id, { totalCost: Number(run.estimatedCost || 0), costKnown: run.estimatedCost !== null });
}

export async function promptAuthorsFor(candidate) {
  const pairs = Object.entries(candidate?.promptVersions || {});
  if (!pairs.length) return [];
  const rows = await prisma.aiPromptGovernance.findMany({ where: { OR: pairs.map(([k, v]) => ({ promptKey: k, version: Number(v) })) }, select: { authorUserId: true } });
  return rows.map((r) => r.authorUserId).filter(Boolean);
}

// Side-by-side comparison of two runs of the same suite. Never recommends on cost alone.
export async function compareRuns(req, { baselineRunId, candidateRunId, dimension = "model", name = null }) {
  const [a, b] = await Promise.all([prisma.aiEvalRun.findFirst({ where: { publicId: baselineRunId, organizationId: req.organizationId } }), prisma.aiEvalRun.findFirst({ where: { publicId: candidateRunId, organizationId: req.organizationId } })]);
  if (!a || !b) throw bad("Both runs must exist in this organization.", 404);
  if (a.suiteId !== b.suiteId) throw bad("Compare runs of the same suite version.");
  if (![a, b].every((r) => ["Passed", "Passed with warnings", "Failed"].includes(r.status))) throw bad("Only completed runs can be compared.");
  const keys = ["deterministic_accuracy", "citation_precision", "citation_coverage", "unsupported_claim_rate", "p95_latency_ms", "cost_per_success_usd", "llm_quality_mean", "grader_disagreements"];
  const rows = keys.map((k) => ({ metric: k, baseline: a.metrics?.[k] ?? null, candidate: b.metrics?.[k] ?? null, delta: a.metrics?.[k] !== null && a.metrics?.[k] !== undefined && b.metrics?.[k] !== null && b.metrics?.[k] !== undefined ? b.metrics[k] - a.metrics[k] : null }));
  const safetyWorse = b.zeroToleranceFailures > a.zeroToleranceFailures || (b.metrics?.unsupported_claim_rate ?? 0) > (a.metrics?.unsupported_claim_rate ?? 0);
  const qualityWorse = ["deterministic_accuracy", "citation_precision", "citation_coverage"].some((k) => (b.metrics?.[k] ?? 0) < (a.metrics?.[k] ?? 0));
  const cheaper = (b.metrics?.cost_per_success_usd ?? Infinity) < (a.metrics?.cost_per_success_usd ?? Infinity);
  const summary = {
    rows, baseline: { run: a.publicId, candidate: a.candidate, status: a.status, sampleSize: a.sampleSize }, candidate: { run: b.publicId, candidate: b.candidate, status: b.status, sampleSize: b.sampleSize },
    safety: { baselineZeroTolerance: a.zeroToleranceFailures, candidateZeroTolerance: b.zeroToleranceFailures, candidateWorse: safetyWorse },
    note: safetyWorse || qualityWorse ? "The candidate is worse on safety or accuracy; cost alone never justifies it." : cheaper ? "No safety or accuracy regression and lower cost — still needs human review and release approval." : "No safety or accuracy regression. Selection needs human review and release approval.",
  };
  const row = await prisma.aiEvaluationComparison.create({ data: { organizationId: req.organizationId, name: name || `${dimension}: ${a.publicId} vs ${b.publicId}`, dimension, baselineRunId: a.id, candidateRunId: b.id, summary, createdByUserId: req.user?.id || null } });
  await aiAudit(req, "ai.evaluation.comparison_created", "AiEvaluationComparison", row.id, { after: { dimension, baseline: a.publicId, candidate: b.publicId } });
  return row;
}

// Worker: queued runs, one at a time.
export async function runQueuedEvaluations({ max = 1 } = {}) {
  let n = 0;
  for (; n < max; n += 1) {
    const next = await prisma.aiEvalRun.findFirst({ where: { status: "Queued" }, orderBy: { createdAt: "asc" } });
    if (!next) break;
    await executeEvaluationRun(next.id);
  }
  return n;
}
