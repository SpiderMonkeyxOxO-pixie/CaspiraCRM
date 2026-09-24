// Backend Phase 11 — /api/v1/ai governance, evaluation, release, monitoring,
// incident, kill-switch, review, exception, flag, readiness, cost and report
// endpoints. Route-level permissions are in routes/aiRoutes.js; handlers add
// separation-of-duties and scope checks. Nothing here is callable by a model.
import prisma from "../../../lib/prisma.js";
import { hasGrant } from "../../../utils/grants.js";
import { guard } from "../../api/common.js";
import { AiError, CATEGORIES } from "../../common/errors.js";
import { aiAudit } from "../../common/audit.js";
import { aiMode, SIMULATOR_LABEL } from "../../common/mode.js";
import { RISK_RULES, PROHIBITED_AUTOMATIONS, CAPABILITY_STATUSES, KILL_SWITCH_KINDS, SEVERITIES, INCIDENT_SEVERITIES, INCIDENT_CATEGORIES, RELEASE_STAGES, ZERO_TOLERANCE, aiEnvironment } from "../catalog.js";
import { governanceSnapshot, activeSwitch, flagEnabled, releaseFor } from "../runtime.js";
import * as reg from "../registry.js";
import * as pol from "../policies.js";
import * as rel from "../releases.js";
import * as inc from "../incidents.js";
import * as ks from "../killSwitches.js";
import * as rv from "../reviews.js";
import * as mon from "../monitoring.js";
import { costGovernance, recordProviderInvoice } from "../cost.js";
import { readinessFor, confirmReadinessItem } from "../readiness.js";
import { buildReport, REPORTS } from "../reports.js";
import { createDataset, newDatasetVersion, deleteDataset, serializeDataset, DATASET_TYPES } from "../evaluation/datasets.js";
import { startEvaluationRun, executeEvaluationRun, cancelEvaluationRun, reviewResult, compareRuns, serializeRun } from "../evaluation/runner.js";
import { heartbeats } from "../jobs.js";

const bad = (m, status = 422) => Object.assign(new AiError(CATEGORIES.INVALID_REQUEST, m), { httpStatus: status });
const since = (q) => ({ from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined });

// ---- Governance dashboard and capabilities -----------------------------------------------

export const dashboard = guard(async (req, res) => {
  const org = req.organizationId;
  const snap = await governanceSnapshot();
  const [capabilities, providers, incidents, releases, reviews, runs, policies] = await Promise.all([
    prisma.aiCapability.findMany({ orderBy: { key: "asc" } }),
    prisma.aiProviderGovernance.findMany({ where: { scope: { in: ["platform", org] } } }),
    prisma.aiIncident.findMany({ where: { scope: { in: ["platform", org] }, status: { notIn: ["Closed"] } }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.aiRelease.findMany({ where: { scope: { in: ["platform", org] } }, orderBy: { updatedAt: "desc" }, take: 10 }),
    prisma.aiHumanReviewItem.count({ where: { scope: { in: ["platform", org] }, status: { in: ["Open", "Escalated"] } } }),
    prisma.aiEvalRun.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.aiGovernancePolicy.findMany({ where: { scope: { in: ["platform", org] } } }),
  ]);
  const provider = (k) => providers.find((p) => p.providerKey === k && p.scope === org) || providers.find((p) => p.providerKey === k && p.scope === "platform");
  res.json({
    environment: aiEnvironment(), aiMode: aiMode(), simulatorLabel: aiMode() === "simulator" ? SIMULATOR_LABEL : null,
    note: "Statuses are shown as recorded; there is no single overall safety score. Controls existing is not a compliance certification.",
    enablement: { globalKillSwitch: !!activeSwitch(snap, "global", "*", org), organizationKillSwitch: !!activeSwitch(snap, "organization", org, org), actionExecutionPaused: !!activeSwitch(snap, "action_execution", "*", org), semanticRetrievalPaused: !!activeSwitch(snap, "semantic_retrieval", "*", org) },
    capabilities: capabilities.map((c) => ({ key: c.key, name: c.name, riskLevel: c.riskLevel, status: c.status, enabledForOrganization: flagEnabled(snap, `capability.${c.key}`, req) || !!releaseFor(snap, c.key, req), killSwitch: !!activeSwitch(snap, "capability", c.key, org), nextReviewAt: c.nextReviewAt, currentReleaseId: c.currentReleaseId })),
    providers: [...new Set(providers.map((p) => p.providerKey))].map((k) => { const p = provider(k); return { providerKey: k, status: p.status, credentialStatus: p.credentialStatus, dpaStatus: p.dpaStatus, zdrEligibility: p.zdrEligibility, lastVerifiedAt: p.lastVerifiedAt }; }),
    models: { total: snap.models.length, approved: snap.models.filter((m) => m.releaseStatus === "Approved").length },
    prompts: { active: snap.prompts.filter((p) => p.status === "Active").length, pending: snap.prompts.filter((p) => ["Draft", "Internal testing", "Evaluation", "Under review", "Approved"].includes(p.status)).length },
    tools: { active: snap.tools.filter((t) => t.status === "Active").length, total: snap.tools.length }, workflows: { active: snap.workflows.filter((w) => w.status === "Active").length, total: snap.workflows.length },
    policies: policies.map((p) => ({ _id: p.publicId, name: p.name, status: p.status, riskLevel: p.riskLevel, capabilityKey: p.capabilityKey })),
    evaluations: runs.map(serializeRun), releases: releases.map((r) => rel.serializeRelease(r)), activeIncidents: incidents.map(inc.serializeIncident), openReviews: reviews,
    killSwitches: { active: snap.switches.filter((s) => s.scope === "platform" || s.scope === org).length },
    nextReviews: capabilities.filter((c) => c.nextReviewAt).sort((a, b) => a.nextReviewAt - b.nextReviewAt).slice(0, 5).map((c) => ({ key: c.key, name: c.name, nextReviewAt: c.nextReviewAt })),
    statuses: CAPABILITY_STATUSES, riskRules: RISK_RULES, prohibitedAutomations: PROHIBITED_AUTOMATIONS,
  });
});

export const listCapabilities = guard(async (req, res) => {
  const snap = await governanceSnapshot();
  const rows = await prisma.aiCapability.findMany({ orderBy: { key: "asc" } });
  // Ordinary members only see what is available to them (no governance internals).
  if (!hasGrant(req, "ai_governance", "read")) {
    return res.json({ capabilities: rows.filter((c) => { try { return (flagEnabled(snap, `capability.${c.key}`, req) || !!releaseFor(snap, c.key, req)) && !["Paused", "Blocked", "Retired", "Not configured"].includes(c.status); } catch { return false; } }).map((c) => ({ key: c.key, name: c.name, description: c.description, riskLevel: c.riskLevel, status: c.status })), limited: true });
  }
  res.json({ capabilities: rows.map((c) => reg.serializeCapability(c, { killSwitch: !!activeSwitch(snap, "capability", c.key, req.organizationId), enabledForOrganization: flagEnabled(snap, `capability.${c.key}`, req) })) });
});
export const getCapability = guard(async (req, res) => {
  const c = await prisma.aiCapability.findUnique({ where: { key: req.params.key } });
  if (!c) throw bad("Unknown capability.", 404);
  const versions = await prisma.aiCapabilityVersion.findMany({ where: { capabilityId: c.id }, orderBy: { version: "desc" }, take: 20 });
  res.json({ capability: reg.serializeCapability(c), versions: versions.map((v) => ({ version: v.version, changeSummary: v.changeSummary, createdByUserId: v.createdByUserId, createdAt: v.createdAt })), readiness: await readinessFor(req, c.key) });
});
export const createCapability = guard(async (req, res) => res.status(201).json({ capability: reg.serializeCapability(await reg.createCapability(req, req.body || {})) }));
export const updateCapability = guard(async (req, res) => res.json({ capability: reg.serializeCapability(await reg.updateCapability(req, req.params.key, req.body || {})) }));

// ---- Policies -------------------------------------------------------------------------------

const policyOut = async (p) => pol.serializePolicy(p, await prisma.aiGovernancePolicyVersion.findMany({ where: { policyId: p.id }, orderBy: { version: "desc" } }), await prisma.aiGovernanceApproval.findMany({ where: { subjectType: "Policy", subjectId: p.id }, orderBy: { createdAt: "desc" } }));
export const listPolicies = guard(async (req, res) => {
  const rows = await prisma.aiGovernancePolicy.findMany({ where: { scope: { in: ["platform", req.organizationId] } }, orderBy: { updatedAt: "desc" } });
  res.json({ policies: await Promise.all(rows.map(policyOut)) });
});
export const getPolicy = guard(async (req, res) => { const p = await pol.loadPolicy(req, req.params.id); res.json({ policy: await policyOut(p), blockers: await pol.activationBlockers(p, await prisma.aiGovernancePolicyVersion.findUnique({ where: { policyId_version: { policyId: p.id, version: p.latestVersion } } })) }); });
export const createPolicy = guard(async (req, res) => res.status(201).json({ policy: await policyOut(await pol.createPolicy(req, req.body || {})) }));
export const addPolicyVersion = guard(async (req, res) => { const p = await pol.loadPolicy(req, req.params.id); await pol.addPolicyVersion(req, p, req.body || {}); res.status(201).json({ policy: await policyOut(await pol.loadPolicy(req, req.params.id)) }); });
export const submitPolicy = guard(async (req, res) => { const p = await pol.loadPolicy(req, req.params.id); res.json({ policy: await policyOut(await pol.submitPolicy(req, p)) }); });
export const approvePolicy = guard(async (req, res) => { const p = await pol.loadPolicy(req, req.params.id); const out = await pol.approvePolicy(req, p, req.body || {}); res.json({ policy: await policyOut(out.policy), pending: out.pending || null, blockers: out.blockers || [] }); });
export const activatePolicy = guard(async (req, res) => { const p = await pol.loadPolicy(req, req.params.id); const out = await pol.activatePolicy(req, p); res.json({ policy: await policyOut(out.policy), blockers: out.blockers }); });
export const rejectPolicy = guard(async (req, res) => { const p = await pol.loadPolicy(req, req.params.id); res.json({ policy: await policyOut(await pol.rejectPolicy(req, p, req.body || {})) }); });
export const pausePolicy = guard(async (req, res) => { const p = await pol.loadPolicy(req, req.params.id); res.json({ policy: await policyOut(await pol.pausePolicy(req, p, req.body || {})) }); });

// ---- Registry: providers, models, prompts, tools, workflows, flags -------------------------------

export const listProviders = guard(async (req, res) => {
  const rows = await prisma.aiProviderGovernance.findMany({ where: { scope: { in: ["platform", req.organizationId] } }, orderBy: { providerKey: "asc" } });
  const keys = [...new Set(rows.map((r) => r.providerKey))];
  res.json({ providers: keys.map((k) => { const p = rows.find((r) => r.providerKey === k && r.scope === req.organizationId) || rows.find((r) => r.providerKey === k); const { organizationId, ...rest } = p; return { ...rest, scope: p.scope === "platform" ? "Platform default" : "Organization", note: "Contract, residency, retention and zero-retention fields are Unverified until an authorized administrator confirms them." }; }) });
});
export const updateProvider = guard(async (req, res) => res.json({ provider: await reg.updateProviderGovernance(req, req.params.key, req.body || {}) }));
export const verifyProvider = guard(async (req, res) => res.json({ provider: await reg.verifyProviderGovernance(req, req.params.key) }));
export const setProviderStatus = guard(async (req, res) => res.json({ provider: await reg.setProviderStatus(req, req.params.key, req.body || {}) }));
export const listModels = guard(async (_req, res) => res.json({ models: await prisma.aiModelGovernance.findMany({ orderBy: [{ providerKey: "asc" }, { modelId: "asc" }] }) }));
export const updateModel = guard(async (req, res) => res.json({ model: await reg.updateModelGovernance(req, req.params.id, req.body || {}) }));
export const approveModel = guard(async (req, res) => res.json({ model: await reg.approveModel(req, req.params.id, req.body || {}) }));
export const listPrompts = guard(async (_req, res) => res.json({ prompts: (await prisma.aiPromptGovernance.findMany({ orderBy: [{ promptKey: "asc" }, { version: "desc" }] })).map((p) => ({ ...p, checksum: p.checksum.slice(0, 16) })) }));
export const getPrompt = guard(async (req, res) => {
  const g = await prisma.aiPromptGovernance.findUnique({ where: { id: req.params.id } });
  if (!g) throw bad("Prompt version not found.", 404);
  const t = await prisma.aiPromptTemplate.findUnique({ where: { key: g.promptKey } });
  const v = await prisma.aiPromptTemplateVersion.findUnique({ where: { templateId_version: { templateId: t.id, version: g.version } } });
  // Prompt templates contain no CRM data (only placeholders), so reviewers may read them.
  res.json({ prompt: g, template: { system: v?.system, userTemplate: v?.userTemplate, outputSchema: v?.outputSchema, status: v?.status } });
});
export const createPrompt = guard(async (req, res) => res.status(201).json({ prompt: await reg.createPromptVersion(req, req.body || {}) }));
export const transitionPrompt = guard(async (req, res) => res.json({ prompt: await reg.transitionPrompt(req, req.params.id, req.body || {}) }));
export const listTools = guard(async (_req, res) => res.json({ tools: await prisma.aiToolGovernance.findMany({ orderBy: [{ kind: "asc" }, { toolName: "asc" }] }), note: "Tools are deny-by-default: only Active versions are offered to the model." }));
export const transitionTool = guard(async (req, res) => res.json({ tool: await reg.transitionTool(req, req.params.id, req.body || {}) }));
export const listWorkflows = guard(async (_req, res) => res.json({ workflows: await prisma.aiWorkflowGovernance.findMany({ orderBy: [{ workflowKey: "asc" }, { version: "desc" }] }) }));
export const registerWorkflows = guard(async (req, res) => res.json({ registered: await reg.registerWorkflowVersions(req) }));
export const transitionWorkflow = guard(async (req, res) => res.json({ workflow: await reg.transitionWorkflow(req, req.params.id, req.body || {}) }));
export const listFlags = guard(async (req, res) => res.json({ flags: await prisma.aiFeatureFlag.findMany({ where: { scope: { in: ["platform", req.organizationId] } }, orderBy: [{ key: "asc" }, { scope: "asc" }] }), environment: aiEnvironment(), note: "Flags are enforced on the server; the browser can't enable a capability." }));
export const setFlag = guard(async (req, res) => res.json({ flag: await reg.setFeatureFlag(req, req.body || {}) }));

// ---- Readiness, exceptions, cost, reports ---------------------------------------------------------

export const readiness = guard(async (req, res) => res.json({ readiness: await readinessFor(req, req.params.key) }));
export const confirmReadiness = guard(async (req, res) => res.json({ item: await confirmReadinessItem(req, req.params.key, req.params.item, req.body || {}), readiness: await readinessFor(req, req.params.key) }));
export const listExceptions = guard(async (req, res) => res.json({ exceptions: (await prisma.aiEmergencyException.findMany({ where: { scope: { in: ["platform", req.organizationId] } }, orderBy: { createdAt: "desc" } })).map(rv.serializeException), neverExcepted: ZERO_TOLERANCE }));
export const requestException = guard(async (req, res) => res.status(201).json({ exception: rv.serializeException(await rv.requestException(req, req.body || {})) }));
export const decideException = guard(async (req, res) => res.json({ exception: rv.serializeException(await rv.decideException(req, req.params.id, req.body || {})) }));
export const costReport = guard(async (req, res) => res.json({ cost: await costGovernance(req.organizationId, req.query) }));
export const recordInvoice = guard(async (req, res) => res.status(201).json({ invoice: await recordProviderInvoice(req, req.body || {}) }));
export const report = guard(async (req, res) => {
  const out = await buildReport(req, req.params.type, String(req.query.format || "json"));
  if (req.query.download === "true") { res.set("Content-Type", out.contentType); res.set("Content-Disposition", `attachment; filename="${out.filename}"`); return res.send(out.body); }
  res.json({ report: req.params.type, rows: out.rows, filename: out.filename });
});
export const reportTypes = guard(async (_req, res) => res.json({ reports: Object.keys(REPORTS), note: "Exports are audited and exclude secrets and prompt text. The secure Document service (Backend Phase 7) isn't built yet; exports download directly." }));

// ---- Evaluations -----------------------------------------------------------------------------------

export const listSuites = guard(async (_req, res) => res.json({ suites: await prisma.aiEvaluationSuite.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] }), graders: await prisma.aiEvaluationGrader.findMany({ orderBy: { key: "asc" } }) }));
export const createSuite = guard(async (req, res) => {
  const b = req.body || {};
  if (!b.key || !b.name || !(b.datasetVersionIds || []).length) throw bad("key, name and datasetVersionIds are required.");
  const graders = new Set((await prisma.aiEvaluationGrader.findMany()).map((g) => g.key));
  if ((b.graderKeys || []).some((g) => !graders.has(g))) throw bad("Unknown grader.");
  const last = await prisma.aiEvaluationSuite.findFirst({ where: { key: b.key }, orderBy: { version: "desc" } });
  const s = await prisma.aiEvaluationSuite.create({ data: { key: b.key, version: (last?.version || 0) + 1, name: String(b.name).slice(0, 120), capabilityKey: b.capabilityKey || null, datasetVersionIds: b.datasetVersionIds, graderKeys: b.graderKeys || ["code_exact", "authorization", "evidence"], qualityGates: b.qualityGates || [], createdByUserId: req.user?.id } });
  await aiAudit(req, "ai.evaluation.suite_created", "AiEvaluationSuite", s.id, { after: { key: s.key, version: s.version } });
  res.status(201).json({ suite: s });
});
export const listDatasets = guard(async (req, res) => {
  const rows = await prisma.aiEvaluationDataset.findMany({ where: { scope: { in: ["platform", req.organizationId] }, status: "Active" }, orderBy: { key: "asc" } });
  const versions = await prisma.aiEvaluationDatasetVersion.findMany({ where: { datasetId: { in: rows.map((d) => d.id) } }, orderBy: { version: "desc" } });
  res.json({ datasets: rows.map((d) => serializeDataset(d, versions.filter((v) => v.datasetId === d.id))), types: DATASET_TYPES });
});
export const getDatasetVersion = guard(async (req, res) => {
  const v = await prisma.aiEvaluationDatasetVersion.findUnique({ where: { id: req.params.versionId } });
  const d = v && await prisma.aiEvaluationDataset.findFirst({ where: { id: v.datasetId, scope: { in: ["platform", req.organizationId] } } });
  if (!d) throw bad("Dataset version not found.", 404);
  res.json({ dataset: serializeDataset(d, [v]), cases: await prisma.aiEvaluationCase.findMany({ where: { datasetVersionId: v.id }, orderBy: { key: "asc" } }) });
});
export const createDatasetHandler = guard(async (req, res) => { const out = await createDataset(req, req.body || {}); res.status(201).json({ dataset: serializeDataset(out.dataset, [out.version]) }); });
export const newDatasetVersionHandler = guard(async (req, res) => {
  const d = await prisma.aiEvaluationDataset.findFirst({ where: { id: req.params.id, scope: req.organizationId, status: "Active" } });
  if (!d) throw bad("Dataset not found (platform datasets change through incidents or seeding).", 404);
  const { version } = await newDatasetVersion(req, d, req.body || {});
  res.status(201).json({ version });
});
export const deleteDatasetHandler = guard(async (req, res) => {
  const d = await prisma.aiEvaluationDataset.findFirst({ where: { id: req.params.id, scope: req.organizationId } });
  if (!d) throw bad("Dataset not found.", 404);
  await deleteDataset(req, d, req.body?.reason);
  res.json({ ok: true });
});
export const listRuns = guard(async (req, res) => res.json({ runs: (await prisma.aiEvalRun.findMany({ where: { organizationId: req.organizationId }, orderBy: { createdAt: "desc" }, take: 100 })).map(serializeRun) }));
export const startRun = guard(async (req, res) => {
  const run = await startEvaluationRun(req, req.body || {});
  if (req.body?.wait === true) return res.json({ run: serializeRun(await executeEvaluationRun(run.id)) });
  res.status(202).json({ run: serializeRun(run), note: "Queued; the evaluation worker runs it." });
});
export const getRun = guard(async (req, res) => {
  const r = await prisma.aiEvalRun.findFirst({ where: { publicId: req.params.id, organizationId: req.organizationId } });
  if (!r) throw bad("Run not found.", 404);
  const results = await prisma.aiEvalResult.findMany({ where: { runId: r.id } });
  const cases = Object.fromEntries((await prisma.aiEvaluationCase.findMany({ where: { id: { in: results.map((x) => x.caseId) } } })).map((c) => [c.id, c]));
  const suite = await prisma.aiEvaluationSuite.findUnique({ where: { id: r.suiteId } });
  res.json({ run: serializeRun(r), suite: { key: suite.key, version: suite.version, name: suite.name }, results: results.map((x) => ({ _id: x.id, caseKey: cases[x.caseId]?.key, caseType: cases[x.caseId]?.type, zeroTolerance: cases[x.caseId]?.zeroTolerance || [], outcome: x.outcome, graderVerdicts: x.graderVerdicts, disagreement: x.disagreement, zeroToleranceCategory: x.zeroToleranceCategory, metrics: x.metrics, safeExcerpt: x.safeExcerpt })) });
});
export const cancelRun = guard(async (req, res) => { const r = await prisma.aiEvalRun.findFirst({ where: { publicId: req.params.id, organizationId: req.organizationId } }); if (!r) throw bad("Run not found.", 404); res.json({ run: serializeRun(await cancelEvaluationRun(req, r)) }); });
export const reviewRun = guard(async (req, res) => { const r = await prisma.aiEvalRun.findFirst({ where: { publicId: req.params.id, organizationId: req.organizationId } }); if (!r) throw bad("Run not found.", 404); res.json({ run: serializeRun(await reviewResult(req, r, req.body || {})) }); });
export const listComparisons = guard(async (req, res) => res.json({ comparisons: await prisma.aiEvaluationComparison.findMany({ where: { organizationId: req.organizationId }, orderBy: { createdAt: "desc" }, take: 50 }) }));
export const createComparison = guard(async (req, res) => res.status(201).json({ comparison: await compareRuns(req, req.body || {}) }));

// ---- Releases --------------------------------------------------------------------------------------

const releaseOut = async (r) => rel.serializeRelease(r, {
  gates: await prisma.aiReleaseGate.findMany({ where: { releaseId: r.id } }), cohorts: await prisma.aiRolloutCohort.findMany({ where: { releaseId: r.id }, orderBy: { createdAt: "desc" } }),
  approvals: (await prisma.aiGovernanceApproval.findMany({ where: { subjectType: "Release", subjectId: r.id }, orderBy: { createdAt: "asc" } })).map((a) => ({ decision: a.decision, reviewerUserId: a.reviewerUserId, role: a.role, reason: a.reason, at: a.createdAt })),
});
export const listReleases = guard(async (req, res) => res.json({ releases: await Promise.all((await prisma.aiRelease.findMany({ where: { scope: { in: ["platform", req.organizationId] }, ...(req.query.capabilityKey && { capabilityKey: String(req.query.capabilityKey) }) }, orderBy: { createdAt: "desc" }, take: 100 })).map(releaseOut)), stages: RELEASE_STAGES }));
export const getRelease = guard(async (req, res) => { const r = await rel.loadRelease(req, req.params.id); res.json({ release: await releaseOut(r), readiness: await readinessFor(req, r.capabilityKey, r) }); });
export const createRelease = guard(async (req, res) => res.status(201).json({ release: await releaseOut(await rel.createRelease(req, req.body || {})) }));
export const submitRelease = guard(async (req, res) => {
  const r = await rel.loadRelease(req, req.params.id);
  const out = await rel.submitRelease(req, r);
  if (req.body?.wait === true) await executeEvaluationRun(out.run.id);
  res.json({ release: await releaseOut(await rel.loadRelease(req, req.params.id)), run: serializeRun(await prisma.aiEvalRun.findUnique({ where: { id: out.run.id } })) });
});
export const approveRelease = guard(async (req, res) => { const r = await rel.loadRelease(req, req.params.id); await rel.approveRelease(req, r, req.body || {}); res.json({ release: await releaseOut(await rel.loadRelease(req, req.params.id)) }); });
export const promoteRelease = guard(async (req, res) => { const r = await rel.loadRelease(req, req.params.id); res.json({ release: await releaseOut(await rel.promoteRelease(req, r, req.body || {})) }); });
export const pauseRelease = guard(async (req, res) => { const r = await rel.loadRelease(req, req.params.id); res.json({ release: await releaseOut(await rel.pauseRelease(req, r, req.body || {})) }); });
export const rollbackRelease = guard(async (req, res) => { const r = await rel.loadRelease(req, req.params.id); const out = await rel.rollbackRelease(req, r, req.body || {}); res.json({ release: await releaseOut(out.release), restored: out.restored ? rel.serializeRelease(out.restored) : null }); });
export const retireRelease = guard(async (req, res) => { const r = await rel.loadRelease(req, req.params.id); res.json({ release: await releaseOut(await rel.retireRelease(req, r, req.body || {})) }); });

// ---- Monitoring ------------------------------------------------------------------------------------

const scopeOrg = (req) => (req.query.scope === "platform" && ks.isSystemOwner(req) ? null : req.organizationId);
export const monitoringSummary = guard(async (req, res) => {
  const m = await mon.computeMetrics(scopeOrg(req), { ...since(req.query), providerKey: req.query.providerKey, modelId: req.query.modelId, capabilityKey: req.query.capabilityKey, releaseId: req.query.releaseId, membershipId: req.query.membershipId, severity: req.query.severity });
  const slos = await prisma.aiSloDefinition.findMany({ where: { active: true } });
  const latest = await Promise.all(slos.map(async (d) => ({ key: d.key, name: d.name, objective: Number(d.objective), comparator: d.comparator, unit: d.unit, windowMinutes: d.windowMinutes, latest: await prisma.aiSloMeasurement.findFirst({ where: { sloId: d.id }, orderBy: { windowEnd: "desc" } }) })));
  res.json({ metrics: m, slos: latest.map((s) => ({ ...s, latest: s.latest ? { value: s.latest.value === null ? null : Number(s.latest.value), sampleSize: s.latest.sampleSize, status: s.latest.status, windowStart: s.latest.windowStart, windowEnd: s.latest.windowEnd } : null })), privacy: await mon.privacyStatus(req.organizationId), filters: { departmentTeam: "Not available: the backend has no department or team model yet." }, heartbeats });
});
export const monitoringMetrics = guard(async (req, res) => res.json({ metrics: await mon.computeMetrics(scopeOrg(req), { ...since(req.query), providerKey: req.query.providerKey, modelId: req.query.modelId, capabilityKey: req.query.capabilityKey, releaseId: req.query.releaseId, membershipId: req.query.membershipId }) }));
export const measureSlosNow = guard(async (req, res) => { await aiAudit(req, "ai.slo.measured", "AiSloDefinition", null); res.json({ slos: await mon.measureSlos() }); });
export const safetyEvents = guard(async (req, res) => {
  const q = req.query;
  const where = { OR: [{ organizationId: req.organizationId }, ...(ks.isSystemOwner(req) ? [{ organizationId: null }] : [])], ...(q.severity && { severity: String(q.severity) }), ...(q.category && { category: String(q.category) }), ...(q.capabilityKey && { capabilityKey: String(q.capabilityKey) }), ...(q.includeEvaluation !== "true" && { NOT: { source: { startsWith: "evaluation:" } } }), createdAt: { gte: q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86_400_000) } };
  res.json({ events: await prisma.aiSafetyEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }), severities: SEVERITIES });
});
export const reviewSafetyEvent = guard(async (req, res) => {
  const e = await prisma.aiSafetyEvent.findFirst({ where: { id: req.params.id, organizationId: req.organizationId } });
  if (!e) throw bad("Safety event not found.", 404);
  const status = { Reviewed: "Reviewed", Dismissed: "Dismissed", Escalated: "Escalated" }[req.body?.reviewStatus];
  if (!status) throw bad("reviewStatus: Reviewed, Dismissed or Escalated.");
  const u = await prisma.aiSafetyEvent.update({ where: { id: e.id }, data: { reviewStatus: status } });
  await aiAudit(req, "ai.safety_event.reviewed", "AiSafetyEvent", e.id, { reason: req.body?.reason, before: { reviewStatus: e.reviewStatus }, after: { reviewStatus: status } });
  res.json({ event: u });
});
export const listAlerts = guard(async (req, res) => res.json({ alerts: await prisma.aiAlertEvent.findMany({ where: { status: req.query.status ? String(req.query.status) : { in: ["Open", "Acknowledged"] } }, orderBy: { lastAt: "desc" }, take: 100 }), rules: await prisma.aiAlertRule.findMany({ orderBy: { key: "asc" } }) }));
export const acknowledgeAlert = guard(async (req, res) => res.json({ alert: await mon.acknowledgeAlert(req, req.params.id, req.body || {}) }));
export const resolveAlert = guard(async (req, res) => res.json({ alert: await mon.resolveAlert(req, req.params.id, req.body || {}) }));
export const suppressAlert = guard(async (req, res) => res.json({ rule: await mon.suppressAlertRule(req, req.params.key, req.body || {}) }));
export const evaluateAlertsNow = guard(async (req, res) => { await aiAudit(req, "ai.alerts.evaluated", "AiAlertRule", null); res.json({ result: await mon.evaluateAlerts() }); });

// ---- Incidents --------------------------------------------------------------------------------------

export const listIncidents = guard(async (req, res) => res.json({ incidents: (await prisma.aiIncident.findMany({ where: { scope: { in: ["platform", req.organizationId] }, ...(req.query.status && { status: String(req.query.status) }) }, orderBy: { createdAt: "desc" }, take: 100 })).map(inc.serializeIncident), severities: INCIDENT_SEVERITIES, categories: INCIDENT_CATEGORIES }));
export const getIncident = guard(async (req, res) => {
  const i = await inc.loadIncident(req, req.params.id);
  res.json({ incident: inc.serializeIncident(i), timeline: await prisma.aiIncidentEvent.findMany({ where: { incidentId: i.id }, orderBy: { createdAt: "asc" } }), evidenceCount: await prisma.aiIncidentEvidence.count({ where: { incidentId: i.id } }), canReadEvidence: hasGrant(req, "ai_incidents", "read_evidence") });
});
export const createIncident = guard(async (req, res) => {
  if (req.body?.platform && !ks.isSystemOwner(req)) throw bad("Platform incidents are created by a System Owner.", 403);
  res.status(201).json({ incident: inc.serializeIncident(await inc.createIncident(req, req.body || {})) });
});
export const updateIncident = guard(async (req, res) => res.json({ incident: inc.serializeIncident(await inc.updateIncident(req, await inc.loadIncident(req, req.params.id), req.body || {})) }));
export const containIncident = guard(async (req, res) => res.json({ incident: inc.serializeIncident(await inc.containIncident(req, await inc.loadIncident(req, req.params.id), req.body || {})) }));
export const resolveIncident = guard(async (req, res) => res.json({ incident: inc.serializeIncident(await inc.resolveIncident(req, await inc.loadIncident(req, req.params.id), req.body || {})) }));
export const closeIncident = guard(async (req, res) => res.json({ incident: inc.serializeIncident(await inc.closeIncident(req, await inc.loadIncident(req, req.params.id), req.body || {})) }));
export const reopenIncident = guard(async (req, res) => res.json({ incident: inc.serializeIncident(await inc.reopenIncident(req, await inc.loadIncident(req, req.params.id), req.body || {})) }));
export const createRegressionCase = guard(async (req, res) => { const out = await inc.createRegressionCase(req, await inc.loadIncident(req, req.params.id), req.body || {}); res.status(201).json({ incident: inc.serializeIncident(out.incident), caseId: out.caseId, datasetVersion: out.datasetVersion }); });
export const approveRestoration = guard(async (req, res) => res.json({ incident: inc.serializeIncident(await inc.approveRestoration(req, await inc.loadIncident(req, req.params.id), req.body || {})) }));
export const addEvidence = guard(async (req, res) => { const e = await inc.addEvidence(req, await inc.loadIncident(req, req.params.id), req.body || {}); res.status(201).json({ evidence: { _id: e.id, kind: e.kind, hash: e.hash, expiresAt: e.expiresAt } }); });
export const readEvidence = guard(async (req, res) => res.json({ evidence: await inc.readEvidence(req, await inc.loadIncident(req, req.params.id)) }));

// ---- Kill switches -----------------------------------------------------------------------------------

export const listKillSwitches = guard(async (req, res) => res.json({ killSwitches: (await ks.listKillSwitches(req)).map(ks.serializeSwitch), kinds: KILL_SWITCH_KINDS, organizationSwitch: ks.serializeSwitch(await ks.organizationSwitch(req)), systemOwner: ks.isSystemOwner(req) }));
export const activateKillSwitch = guard(async (req, res) => { const out = await ks.activateKillSwitch(req, req.params.id, req.body || {}); res.json({ killSwitch: ks.serializeSwitch(out.killSwitch), cancelled: out.cancelled, propagationMs: out.propagationMs ?? null, maxPropagationMs: out.maxPropagationMs ?? null, alreadyActive: !!out.alreadyActive }); });
export const deactivateKillSwitch = guard(async (req, res) => { const out = await ks.deactivateKillSwitch(req, req.params.id, req.body || {}); res.json({ killSwitch: ks.serializeSwitch(out.killSwitch), alreadyInactive: !!out.alreadyInactive }); });

// ---- Reviews -----------------------------------------------------------------------------------------

export const listReviews = guard(async (req, res) => res.json({ reviews: (await prisma.aiHumanReviewItem.findMany({ where: { scope: { in: ["platform", req.organizationId] }, status: req.query.status ? String(req.query.status) : { in: ["Open", "Escalated"] }, ...(req.query.queue && { queue: String(req.query.queue) }) }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }], take: 200 })).map(rv.serializeReview) }));
export const getReview = guard(async (req, res) => res.json({ review: rv.serializeReview(await rv.loadReview(req, req.params.id)) }));
const decide = (decision) => guard(async (req, res) => res.json({ review: rv.serializeReview(await rv.decideReview(req, await rv.loadReview(req, req.params.id), { ...(req.body || {}), decision })) }));
export const approveReview = decide("Approve");
export const rejectReview = decide("Reject");
export const requestChangesReview = decide("Request changes");
export const escalateReview = decide("Escalate");

// ---- Health (API, database, queue, worker, scheduler, evaluation worker, collector, simulator) -----------

export const governanceHealth = guard(async (_req, res) => {
  const check = async (fn) => { try { const t = Date.now(); await fn(); return { status: "ok", ms: Date.now() - t }; } catch (e) { return { status: "down", error: String(e.message).slice(0, 120) }; } };
  const { default: redis } = await import("../../../lib/redis.js");
  const beat = async (k) => { const v = await redis.get(`ai:heartbeat:${k}`).catch(() => null); return v ? { status: Date.now() - new Date(v) < 20 * 60_000 ? "ok" : "stale", lastBeat: v } : { status: "unknown", lastBeat: null }; };
  const { getAiAdapter } = await import("../../adapters/registry.js");
  res.json({
    api: { status: "ok" }, database: await check(() => prisma.$queryRaw`select 1`), queue: await check(() => redis.ping()),
    worker: await beat("governance"), scheduler: await beat("governance"), evaluationWorker: await beat("evaluation"), monitoringCollector: await beat("slo"),
    providerSimulator: await check(async () => { const a = getAiAdapter("simulator", "Simulator"); if (!a) throw new Error("no simulator adapter"); }),
    aiMode: aiMode(), environment: aiEnvironment(),
  });
});

// What the signed-in member may do in AI administration (drives the "AI
// Administration" navigation). Any active member may ask; portal logins have
// no membership and get 404. The backend still checks every request.
export const AI_ADMIN_MODULES = ["ai_capabilities", "ai_governance", "ai_gov_policies", "ai_gov_providers", "ai_gov_models", "ai_gov_prompts", "ai_gov_tools", "ai_gov_workflows", "ai_gov_evaluations", "ai_releases", "ai_monitoring", "ai_safety", "ai_incidents", "ai_kill_switches", "ai_emergency_exceptions", "ai_usage_governance", "ai_usage", "ai_budgets"];
export const myAiAccess = guard(async (req, res) => {
  const organizationId = req.query.organizationId;
  if (!organizationId) return res.status(400).json({ code: "MISSING_ORGANIZATION_ID", message: "organizationId is required." });
  const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: String(organizationId), userId: req.user.id } }, include: { roles: { include: { role: true } } } });
  const owner = req.user.role === "Super-Admin";
  if (!owner && (!membership || membership.status !== "Active")) return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });
  const access = {};
  for (const moduleId of AI_ADMIN_MODULES) {
    const actions = new Set();
    for (const mr of membership?.roles || []) for (const gr of mr.role.permissionGrants || []) if (gr.moduleId === moduleId) gr.actions.forEach((a) => actions.add(a));
    access[moduleId] = [...actions];
  }
  res.json({ access, systemOwner: owner, environment: aiEnvironment() });
});