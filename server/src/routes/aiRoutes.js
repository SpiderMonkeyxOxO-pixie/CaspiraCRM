// Backend Phase 9 — /api/v1/ai. Session-cookie auth, CSRF on writes, RBAC
// per action (deny by default) and organizationId (query, body or
// X-Organization-Id) checked against a live membership. Portal logins have
// no membership and are refused. Replaces the early, unscoped AI gateway.
import { Router, json as jsonBody } from "express";
import { authenticateCookie } from "../controllers/auth2Controller.js";
import { requireCrmOrgPermission, authorizeOrgAccess } from "../middleware/rbac.js";
import { requireCsrf } from "../middleware/csrf.js";
import { asyncHandler } from "../utils/crudFactory.js";
import * as cfg from "../ai/api/configController.js";
import * as gen from "../ai/api/generationController.js";
import * as gov from "../ai/api/governanceController.js";
import * as cop from "../ai/copilot/api/copilotController.js";
import * as g from "../ai/governance/api/governanceController.js";
import { aiSimulatorSafe, SIMULATOR_LABEL } from "../ai/common/mode.js";
import { simulatorControls } from "../ai/adapters/simulatorAdapter.js";

const router = Router();
const can = (m, a) => requireCrmOrgPermission(m, a);
const write = (m, a) => [requireCsrf, can(m, a)];

// Simulator controls: local development and tests only (never production).
if (aiSimulatorSafe()) {
  const sim = Router();
  sim.use(jsonBody());
  sim.get("/", (_req, res) => res.json({ label: SIMULATOR_LABEL }));
  sim.post("/_control/fail", (req, res) => { simulatorControls.fail(...[].concat(req.body.kinds || "error")); res.json({ ok: true }); });
  sim.post("/_control/delay", (req, res) => { simulatorControls.setDelay(Math.min(60_000, Number(req.body.ms) || 0)); res.json({ ok: true }); });
  sim.post("/_control/reset", (_req, res) => { simulatorControls.reset(); res.json({ ok: true }); });
  router.use("/simulator", sim);
}

router.use(authenticateCookie);

// Providers and connections
router.get("/providers", can("ai_providers", "view"), cfg.listProviders);
router.get("/providers/:key", can("ai_providers", "view"), cfg.getProvider);
router.get("/connections", can("ai_providers", "view"), cfg.listConnections);
router.post("/connections", ...write("ai_providers", "configure"), cfg.createConnection);
router.get("/connections/:id", can("ai_providers", "view"), cfg.getConnection);
router.patch("/connections/:id", ...write("ai_providers", "configure"), cfg.updateConnection);
router.post("/connections/:id/verify", ...write("ai_providers", "configure"), cfg.verifyConnection);
router.post("/connections/:id/rotate-key", ...write("ai_providers", "rotate"), cfg.rotateKey);
router.post("/connections/:id/disable", ...write("ai_providers", "configure"), cfg.disableConnection);
router.post("/connections/:id/enable", ...write("ai_providers", "configure"), cfg.enableConnection);
router.delete("/connections/:id", ...write("ai_providers", "configure"), cfg.deleteConnection);

// Models, use cases and routing
router.get("/models", can("ai_models", "view"), cfg.listModels);
router.get("/model-aliases", can("ai_models", "view"), cfg.listModelAliases);
router.put("/model-aliases/:alias", ...write("ai_models", "configure"), cfg.setModelAlias);
router.get("/use-cases", can("ai_routing", "view"), cfg.listUseCasesHandler);
router.patch("/use-cases/:key", ...write("ai_routing", "configure"), cfg.updateUseCase);
router.get("/routing-policies", can("ai_routing", "view"), cfg.listRouting);
router.put("/routing-policies/:useCase", ...write("ai_routing", "configure"), cfg.setRouting);

// Policy and privacy
router.get("/policy", can("ai_policies", "view"), cfg.getPolicy);
router.patch("/policy", ...write("ai_policies", "configure"), cfg.updatePolicy);
router.get("/redaction-rules", can("ai_policies", "view"), cfg.getRedaction);
router.put("/redaction-rules", ...write("ai_policies", "configure"), cfg.putRedaction);
router.post("/context-preview", ...write("ai_policies", "view"), cfg.contextPreview);

// Generation
router.post("/narrative", ...write("ai_features", "use"), gen.narrative);
router.post("/explore", ...write("ai_features", "use"), gen.explore);
router.get("/requests/:id", can("ai_features", "use"), gen.getRequest);
router.get("/requests/:id/events", can("ai_features", "use"), asyncHandler(gen.requestEvents));
router.post("/requests/:id/cancel", ...write("ai_features", "use"), gen.cancelRequest);
router.post("/feedback", ...write("ai_features", "use"), gen.feedback);

// Usage, pricing and budgets
router.get("/usage", can("ai_usage", "view_own"), gov.listUsage);
router.get("/usage/summary", can("ai_usage", "view_own"), gov.usageSummary);
router.get("/price-tables", can("ai_usage", "view_own"), gov.listPriceTables);
router.put("/price-tables/:provider", ...write("ai_budgets", "configure"), gov.putPriceTable);
router.get("/budgets", can("ai_budgets", "view"), gov.listBudgets);
router.post("/budgets", ...write("ai_budgets", "configure"), gov.createBudget);
router.patch("/budgets/:id", ...write("ai_budgets", "configure"), gov.updateBudget);

// Governed actions
router.get("/actions", can("ai_actions", "view"), gov.listActions);
router.post("/actions/preview", ...write("ai_actions", "propose"), gov.previewActionHandler);
router.post("/actions/suggest", ...write("ai_actions", "propose"), gen.suggestAction);
router.get("/actions/:id", can("ai_actions", "view"), gov.getAction);
router.post("/actions/:id/confirm", ...write("ai_actions", "confirm"), gov.confirmAction);
router.post("/actions/:id/approve", ...write("ai_actions", "approve"), gov.approveAction);
router.post("/actions/:id/reject", ...write("ai_actions", "approve"), gov.rejectAction);
router.post("/actions/:id/cancel", ...write("ai_actions", "propose"), gov.cancelAction);
router.post("/actions/:id/undo", ...write("ai_actions", "confirm"), gov.undoAction);

// Evaluations and audit
router.get("/evaluations/scenarios", can("ai_evaluations", "view"), gov.listScenarios);
router.post("/evaluations/scenarios", ...write("ai_evaluations", "execute"), gov.createScenario);
// Phase 9 quick scenario checks (Phase 11's governed suite runs use /evaluations/runs).
router.get("/evaluations/scenario-runs", can("ai_evaluations", "view"), gov.listRuns);
router.post("/evaluations/scenario-runs", ...write("ai_evaluations", "execute"), gov.createRun);
router.get("/evaluations/scenario-runs/:id", can("ai_evaluations", "view"), gov.getRun);
router.get("/audit", can("ai_audit", "view"), gov.listAiAudit);

// AI Copilot (Backend Phase 10). Conversations belong to one member, so a
// System Owner without a membership in the organization can't use them.
const member = (req, res, next) => (req.membership?.id ? next() : res.status(403).json({ code: "COPILOT_MEMBERSHIP_REQUIRED", message: "AI Copilot needs a membership in this organization." }));
const canAny = (...pairs) => async (req, res, next) => {
  const organizationId = req.body?.organizationId || req.query.organizationId || req.headers["x-organization-id"];
  if (!organizationId) return res.status(400).json({ code: "MISSING_ORGANIZATION_ID", message: "organizationId is required (query param, body field, or X-Organization-Id header)." });
  let last;
  for (const [m, a] of pairs) {
    last = await authorizeOrgAccess(req.user, organizationId, m, a);
    if (last.ok) { req.organizationId = organizationId; req.membership = last.membership; req.isSystemOwnerOverride = last.isSystemOwnerOverride; return next(); }
  }
  return res.status(last.status).json({ code: last.code, message: last.message });
};
const use = [can("ai_copilot", "use"), member];
const useW = [requireCsrf, ...use];
const read = [canAny(["ai_copilot_conversations", "view_own"], ["ai_copilot_conversations", "view_audit_history"]), member];
router.get("/copilot", ...use, cop.copilotInfo);
router.get("/copilot/conversations", ...read, cop.listConversations);
router.post("/copilot/conversations", ...useW, cop.createConversation);
router.get("/copilot/conversations/:id", ...read, cop.getConversation);
router.patch("/copilot/conversations/:id", ...useW, cop.updateConversation);
router.post("/copilot/conversations/:id/archive", ...useW, cop.archiveConversation);
router.post("/copilot/conversations/:id/restore", ...useW, cop.restoreConversation);
router.delete("/copilot/conversations/:id", ...useW, cop.deleteConversation);
router.get("/copilot/conversations/:id/messages", ...read, cop.listMessages);
router.post("/copilot/conversations/:id/messages", ...useW, cop.sendMessage);
router.get("/copilot/conversations/:id/scope", ...read, cop.conversationScope);
router.post("/copilot/conversations/:id/context", ...useW, cop.addContext);
router.delete("/copilot/conversations/:id/context/:contextId", ...useW, cop.removeContext);
router.get("/copilot/context/search", ...use, cop.searchContext);
router.get("/copilot/messages/:id", ...read, cop.getMessage);
router.get("/copilot/messages/:id/events", ...read, asyncHandler(cop.messageEvents));
router.get("/copilot/messages/:id/citations", ...read, cop.messageCitations);
router.post("/copilot/messages/:id/cancel", ...useW, cop.cancelMessage);
router.post("/copilot/messages/:id/regenerate", ...useW, cop.regenerateMessage);
router.post("/copilot/messages/:id/feedback", ...useW, cop.messageFeedback);
router.post("/copilot/clarifications/:id/answer", ...useW, cop.answerClarification);
router.post("/copilot/tool-calls/:id/approve", ...useW, cop.approveToolCall);
router.get("/copilot/memory", can("ai_copilot_memory", "configure"), member, cop.getMemories);
router.post("/copilot/memory", ...write("ai_copilot_memory", "configure"), member, cop.createMemory);
router.patch("/copilot/memory/:id", ...write("ai_copilot_memory", "configure"), member, cop.patchMemory);
router.delete("/copilot/memory/:id", ...write("ai_copilot_memory", "configure"), member, cop.removeMemory);
router.post("/copilot/memory/:id/expire", ...write("ai_copilot_memory", "configure"), member, cop.expireMemoryHandler);
router.get("/copilot/workflows", can("ai_copilot_workflows", "execute"), member, cop.listWorkflows);
router.post("/copilot/workflows/:workflowId/run", ...write("ai_copilot_workflows", "execute"), member, cop.runWorkflowHandler);
router.get("/copilot/workflow-runs/:id", can("ai_copilot_workflows", "execute"), member, cop.getRun);
router.post("/copilot/workflow-runs/:id/cancel", ...write("ai_copilot_workflows", "execute"), member, cop.cancelRun);
router.post("/copilot/workflow-runs/:id/resume", ...write("ai_copilot_workflows", "execute"), member, cop.resumeRun);
router.post("/copilot/workflow-runs/:id/approve", ...write("ai_copilot_workflows", "execute"), member, cop.approveRun);
router.post("/copilot/workflow-runs/:id/reject", ...write("ai_copilot_workflows", "execute"), member, cop.rejectRun);
router.get("/copilot/index", can("ai_copilot_index", "configure"), cop.indexStatus);
router.post("/copilot/index/rebuild", ...write("ai_copilot_index", "configure"), cop.rebuildIndex);
router.post("/copilot/index/sources/:recordType/:recordId/reindex", ...write("ai_copilot_index", "configure"), cop.reindexSource);
router.delete("/copilot/index/sources/:recordType/:recordId", ...write("ai_copilot_index", "configure"), cop.removeIndexedSource);

// ---- Backend Phase 11: AI governance, evaluation, releases, monitoring, incidents ----
const both = (m1, a1, m2, a2) => canAny([m1, a1], [m2, a2]);
// Governance dashboard, capabilities and policies
router.get("/governance/access", g.myAiAccess);
router.get("/governance", can("ai_governance", "read"), g.dashboard);
router.get("/governance/capabilities", canAny(["ai_governance", "read"], ["ai_capabilities", "view"]), g.listCapabilities);
router.post("/governance/capabilities", ...write("ai_governance", "manage"), g.createCapability);
router.get("/governance/capabilities/:key", can("ai_governance", "read"), g.getCapability);
router.patch("/governance/capabilities/:key", ...write("ai_governance", "manage"), g.updateCapability);
router.get("/governance/capabilities/:key/readiness", can("ai_governance", "read"), g.readiness);
router.post("/governance/capabilities/:key/readiness/:item", ...write("ai_governance", "manage"), g.confirmReadiness);
router.get("/governance/policies", can("ai_governance", "read"), g.listPolicies);
router.post("/governance/policies", ...write("ai_gov_policies", "create"), g.createPolicy);
router.get("/governance/policies/:id", can("ai_governance", "read"), g.getPolicy);
router.post("/governance/policies/:id/versions", ...write("ai_gov_policies", "create"), g.addPolicyVersion);
router.post("/governance/policies/:id/submit", ...write("ai_gov_policies", "create"), g.submitPolicy);
router.post("/governance/policies/:id/approve", ...write("ai_gov_policies", "approve"), g.approvePolicy);
router.post("/governance/policies/:id/activate", ...write("ai_gov_policies", "approve"), g.activatePolicy);
router.post("/governance/policies/:id/reject", requireCsrf, both("ai_gov_policies", "review", "ai_gov_policies", "approve"), g.rejectPolicy);
router.post("/governance/policies/:id/pause", ...write("ai_gov_policies", "approve"), g.pausePolicy);
// Registry
router.get("/governance/providers", can("ai_governance", "read"), g.listProviders);
router.patch("/governance/providers/:key", ...write("ai_gov_providers", "manage"), g.updateProvider);
router.post("/governance/providers/:key/verify", ...write("ai_gov_providers", "manage"), g.verifyProvider);
router.post("/governance/providers/:key/status", ...write("ai_gov_providers", "manage"), g.setProviderStatus);
router.get("/governance/models", can("ai_governance", "read"), g.listModels);
router.patch("/governance/models/:id", ...write("ai_gov_models", "manage"), g.updateModel);
router.post("/governance/models/:id/approve", requireCsrf, both("ai_releases", "approve", "ai_safety", "review"), g.approveModel);
router.get("/governance/prompts", can("ai_governance", "read"), g.listPrompts);
router.get("/governance/prompts/:id", can("ai_governance", "read"), g.getPrompt);
router.post("/governance/prompts", ...write("ai_gov_prompts", "manage"), g.createPrompt);
router.post("/governance/prompts/:id/transition", requireCsrf, both("ai_gov_prompts", "manage", "ai_releases", "approve"), g.transitionPrompt);
router.get("/governance/tools", can("ai_governance", "read"), g.listTools);
router.post("/governance/tools/:id/transition", requireCsrf, both("ai_gov_tools", "manage", "ai_releases", "approve"), g.transitionTool);
router.get("/governance/workflows", can("ai_governance", "read"), g.listWorkflows);
router.post("/governance/workflows/register", ...write("ai_gov_workflows", "manage"), g.registerWorkflows);
router.post("/governance/workflows/:id/transition", requireCsrf, both("ai_gov_workflows", "manage", "ai_releases", "approve"), g.transitionWorkflow);
router.get("/governance/flags", can("ai_governance", "read"), g.listFlags);
router.put("/governance/flags", ...write("ai_governance", "manage"), g.setFlag);
router.get("/governance/exceptions", can("ai_governance", "read"), g.listExceptions);
router.post("/governance/exceptions", ...write("ai_emergency_exceptions", "request"), g.requestException);
router.post("/governance/exceptions/:id/decide", ...write("ai_emergency_exceptions", "approve"), g.decideException);
router.get("/governance/cost", can("ai_usage_governance", "read"), g.costReport);
router.post("/governance/cost/invoices", ...write("ai_budgets", "configure"), g.recordInvoice);
router.get("/governance/reports", can("ai_governance", "read"), g.reportTypes);
router.get("/governance/reports/:type", can("ai_governance", "read"), g.report);
router.get("/governance/health", can("ai_monitoring", "read"), g.governanceHealth);
// Evaluations (application-owned)
router.get("/evaluations/suites", can("ai_gov_evaluations", "read"), g.listSuites);
router.post("/evaluations/suites", ...write("ai_gov_evaluations", "manage"), g.createSuite);
router.get("/evaluations/datasets", can("ai_gov_evaluations", "read"), g.listDatasets);
router.post("/evaluations/datasets", ...write("ai_gov_evaluations", "manage"), g.createDatasetHandler);
router.get("/evaluations/datasets/versions/:versionId", can("ai_gov_evaluations", "read"), g.getDatasetVersion);
router.post("/evaluations/datasets/:id/versions", ...write("ai_gov_evaluations", "manage"), g.newDatasetVersionHandler);
router.delete("/evaluations/datasets/:id", ...write("ai_gov_evaluations", "manage"), g.deleteDatasetHandler);
router.get("/evaluations/runs", can("ai_gov_evaluations", "read"), g.listRuns);
router.post("/evaluations/runs", ...write("ai_gov_evaluations", "manage"), g.startRun);
router.get("/evaluations/runs/:id", can("ai_gov_evaluations", "read"), g.getRun);
router.post("/evaluations/runs/:id/cancel", ...write("ai_gov_evaluations", "manage"), g.cancelRun);
router.post("/evaluations/runs/:id/review", ...write("ai_gov_evaluations", "review"), g.reviewRun);
router.get("/evaluations/comparisons", can("ai_gov_evaluations", "read"), g.listComparisons);
router.post("/evaluations/comparisons", ...write("ai_gov_evaluations", "manage"), g.createComparison);
// Releases
router.get("/releases", can("ai_governance", "read"), g.listReleases);
router.post("/releases", ...write("ai_releases", "create"), g.createRelease);
router.get("/releases/:id", can("ai_governance", "read"), g.getRelease);
router.post("/releases/:id/submit", ...write("ai_releases", "create"), g.submitRelease);
router.post("/releases/:id/approve", ...write("ai_releases", "approve"), g.approveRelease);
router.post("/releases/:id/promote", ...write("ai_releases", "promote"), g.promoteRelease);
router.post("/releases/:id/pause", requireCsrf, both("ai_releases", "promote", "ai_releases", "rollback"), g.pauseRelease);
router.post("/releases/:id/rollback", ...write("ai_releases", "rollback"), g.rollbackRelease);
router.post("/releases/:id/retire", ...write("ai_releases", "promote"), g.retireRelease);
// Monitoring
router.get("/monitoring/summary", can("ai_monitoring", "read"), g.monitoringSummary);
router.get("/monitoring/metrics", can("ai_monitoring", "read"), g.monitoringMetrics);
router.post("/monitoring/slos/measure", ...write("ai_governance", "manage"), g.measureSlosNow);
router.get("/monitoring/safety-events", both("ai_monitoring", "read", "ai_safety", "review"), g.safetyEvents);
router.post("/monitoring/safety-events/:id/review", ...write("ai_safety", "review"), g.reviewSafetyEvent);
router.get("/monitoring/alerts", can("ai_monitoring", "read"), g.listAlerts);
router.post("/monitoring/alerts/evaluate", ...write("ai_governance", "manage"), g.evaluateAlertsNow);
router.post("/monitoring/alerts/:id/acknowledge", requireCsrf, both("ai_incidents", "manage", "ai_governance", "manage"), g.acknowledgeAlert);
router.post("/monitoring/alerts/:id/resolve", requireCsrf, both("ai_incidents", "manage", "ai_governance", "manage"), g.resolveAlert);
router.post("/monitoring/alert-rules/:key/suppress", ...write("ai_governance", "manage"), g.suppressAlert);
// Incidents
router.get("/incidents", can("ai_incidents", "view"), g.listIncidents);
router.post("/incidents", ...write("ai_incidents", "create"), g.createIncident);
router.get("/incidents/:id", can("ai_incidents", "view"), g.getIncident);
router.patch("/incidents/:id", ...write("ai_incidents", "manage"), g.updateIncident);
router.post("/incidents/:id/contain", ...write("ai_incidents", "manage"), g.containIncident);
router.post("/incidents/:id/resolve", ...write("ai_incidents", "manage"), g.resolveIncident);
router.post("/incidents/:id/close", ...write("ai_incidents", "manage"), g.closeIncident);
router.post("/incidents/:id/reopen", ...write("ai_incidents", "manage"), g.reopenIncident);
router.post("/incidents/:id/create-regression-case", ...write("ai_incidents", "manage"), g.createRegressionCase);
router.post("/incidents/:id/approve-restoration", requireCsrf, both("ai_safety", "review", "ai_releases", "approve"), g.approveRestoration);
router.post("/incidents/:id/evidence", ...write("ai_incidents", "manage"), g.addEvidence);
router.get("/incidents/:id/evidence", can("ai_incidents", "read_evidence"), g.readEvidence);
// Kill switches (the model can never reach these)
router.get("/kill-switches", both("ai_kill_switches", "activate", "ai_governance", "read"), g.listKillSwitches);
router.post("/kill-switches/:id/activate", ...write("ai_kill_switches", "activate"), g.activateKillSwitch);
router.post("/kill-switches/:id/deactivate", ...write("ai_kill_switches", "deactivate"), g.deactivateKillSwitch);
// Human review queue
router.get("/reviews", both("ai_safety", "review", "ai_gov_evaluations", "review"), g.listReviews);
router.get("/reviews/:id", both("ai_safety", "review", "ai_gov_evaluations", "review"), g.getReview);
router.post("/reviews/:id/approve", requireCsrf, both("ai_safety", "review", "ai_gov_evaluations", "review"), g.approveReview);
router.post("/reviews/:id/reject", requireCsrf, both("ai_safety", "review", "ai_gov_evaluations", "review"), g.rejectReview);
router.post("/reviews/:id/request-changes", requireCsrf, both("ai_safety", "review", "ai_gov_evaluations", "review"), g.requestChangesReview);
router.post("/reviews/:id/escalate", requireCsrf, both("ai_safety", "review", "ai_gov_evaluations", "review"), g.escalateReview);

export default router;
