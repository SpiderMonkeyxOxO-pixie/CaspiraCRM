// Backend Phase 9 — evaluations. A run sends each scenario through the
// normal gateway (so policy, redaction, budgets and usage all apply; usage
// is attributed to "evaluation.run") and checks the answer against the
// scenario's expectations. Nothing here trains or tunes any model.
import prisma from "../../lib/prisma.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { runAi } from "../gateway/gateway.js";
import { USE_CASES } from "../catalog.js";

export function scenarioCall(scenario) {
  const i = scenario.input || {};
  if (scenario.useCaseKey === "overview.narrative") return { dataVariables: { executiveSummary: i.executiveSummary, facts: i.facts || {} }, numericFacts: i.facts || {} };
  if (scenario.useCaseKey === "overview.explore") return { dataVariables: { records: i.records || {} }, textVariables: { role: i.role || "User", scopeLabel: i.scopeLabel || "Evaluation", questionLine: i.question ? `The user specifically asked: "${i.question}"` : "The user asked for a general review of this data." } };
  if (scenario.useCaseKey === "action.proposal") return { dataVariables: { record: i.record || {} }, textVariables: { recordType: i.recordType || "Record", goal: i.goal || "Suggest the next step" } };
  throw new AiError(CATEGORIES.INVALID_REQUEST, `Scenarios for ${scenario.useCaseKey} can't be evaluated.`);
}

const idsIn = (value) => {
  const ids = new Set();
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { if (v._id) ids.add(String(v._id)); Object.values(v).forEach(walk); } };
  walk(value);
  return ids;
};

// Returns the list of failed expectations (empty = pass).
export function checkExpectations(scenario, outcome) {
  const e = scenario.expectations || {};
  const reasons = [];
  if (e.expectRefusal) {
    if (!outcome.refused) reasons.push("Expected the model to refuse, but it answered.");
    return reasons;
  }
  if (outcome.refused) { reasons.push("The model refused unexpectedly."); return reasons; }
  const output = outcome.output || {};
  const text = typeof output.text === "string" ? output.text : JSON.stringify(output);
  for (const f of e.requiredFields || []) if (output[f] === undefined) reasons.push(`Missing required field "${f}".`);
  for (const p of e.forbiddenPatterns || []) if (new RegExp(p, "i").test(text)) reasons.push(`Output matched a forbidden pattern (${p}).`);
  if (e.numericFidelity && outcome.validation?.warnings?.includes("new_numbers")) reasons.push(`Output introduced numbers not in the facts (${(outcome.validation.unverifiedNumbers || []).join(", ")}).`);
  if (outcome.validation?.warnings?.includes("action_claim")) reasons.push("Output claimed to have carried out an action.");
  if (e.expectCitations) {
    const known = idsIn(scenario.input);
    const cited = (output.findings || []).flatMap((f) => f.citedRecordIds || []);
    if (!cited.length) reasons.push("No finding cited a record.");
    const invented = cited.filter((id) => !known.has(id));
    if (invented.length) reasons.push(`Cited records that weren't supplied: ${invented.join(", ")}.`);
  }
  if (e.allowedActionTypes && output.actionType && !e.allowedActionTypes.includes(output.actionType)) reasons.push(`Proposed a disallowed action (${output.actionType}).`);
  return reasons;
}

export async function startEvaluationRun(req, { providerKey = null, alias = null, scenarioIds = [] }) {
  const scenarios = await prisma.aiEvaluationScenario.findMany({ where: { id: { in: scenarioIds }, active: true, OR: [{ organizationId: null }, { organizationId: req.organizationId }] } });
  if (!scenarios.length) throw new AiError(CATEGORIES.INVALID_REQUEST, "Choose at least one scenario.");
  if (scenarios.length > 25) throw new AiError(CATEGORIES.INVALID_REQUEST, "At most 25 scenarios per run.");
  const run = await prisma.aiEvaluationRun.create({
    data: { organizationId: req.organizationId, providerKey: providerKey || "routing", alias: alias || "default", mode: "pending", scenarioIds: scenarios.map((s) => s.id), createdByMembershipId: req.membership?.id || null },
  });
  setImmediate(() => { executeEvaluationRun(req, run.id, scenarios, { providerKey, alias }).catch(() => {}); });
  return run;
}

export async function executeEvaluationRun(req, runId, scenarios, { providerKey, alias }) {
  await prisma.aiEvaluationRun.update({ where: { id: runId }, data: { status: "Running", startedAt: new Date() } });
  let passed = 0; let failed = 0; let errored = 0; let cost = 0; let mode = null; let provider = providerKey;
  for (const scenario of scenarios) {
    try {
      const call = scenarioCall(scenario);
      const outcome = await runAi({
        req, useCaseKey: scenario.useCaseKey, accountingUseCaseKey: "evaluation.run", skipPermission: true,
        providerKey: providerKey || undefined, alias: alias && USE_CASES[scenario.useCaseKey]?.allowedAliases.includes(alias) ? alias : undefined, ...call,
      });
      mode = outcome.provider?.mode || mode; provider = outcome.provider?.id || provider;
      cost += Number(outcome.estimatedCost || 0);
      const reasons = checkExpectations(scenario, outcome);
      if (reasons.length) failed += 1; else passed += 1;
      await prisma.aiEvaluationResult.create({ data: { organizationId: req.organizationId, runId, scenarioId: scenario.id, outcome: reasons.length ? "Fail" : "Pass", reasons, requestId: outcome.request?.id || null } });
    } catch (err) {
      // A refusal the scenario expected is a pass; validation failures are fails.
      const e = err instanceof AiError ? err : new AiError(CATEGORIES.UNKNOWN, "Evaluation error.");
      const isFail = e.category === CATEGORIES.CONTENT_REFUSED;
      if (isFail) failed += 1; else errored += 1;
      await prisma.aiEvaluationResult.create({ data: { organizationId: req.organizationId, runId, scenarioId: scenario.id, outcome: isFail ? "Fail" : "Error", reasons: [e.message, ...(e.details?.issues || [])].slice(0, 6), requestId: e.requestId || null } });
      if (e.category === CATEGORIES.BUDGET || e.category === CATEGORIES.POLICY) break; // don't keep spending into a refusal
    }
  }
  await prisma.aiEvaluationRun.update({ where: { id: runId }, data: { status: "Completed", passed, failed, errored, estimatedCost: cost, providerKey: provider || "routing", mode: mode || "unknown", completedAt: new Date() } });
}
