import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import * as ctrl from "../../controllers/projects/projectsController.js";
import * as setup from "../../controllers/projects/projectSetupController.js";
import * as planning from "../../controllers/projects/projectPlanningController.js";
import * as tasks from "../../controllers/projects/tasksController.js";
import * as time from "../../controllers/projects/timeController.js";
import * as gov from "../../controllers/projects/governanceController.js";
import * as reports from "../../controllers/projects/projectReportsController.js";

// Backend Phase 5 (full spec) — /api/v1/projects. Session-cookie auth, CSRF
// on writes, deny-by-default RBAC per module, organizationId checked
// against a live membership. Static paths are registered before /:projectId.
const router = Router();
router.use(authenticateCookie);

const can = (moduleId, action) => requireCrmOrgPermission(moduleId, action);
const write = (moduleId, action) => [requireCsrf, can(moduleId, action)];
// A preview needs no key; creating does.
const keyUnlessPreview = (scope) => (req, res, next) => (req.body?.preview ? next() : requireIdempotencyKey(scope)(req, res, next));

// Portfolios
router.get("/portfolios", can("project_portfolios", "view"), asyncHandler(setup.listPortfolios));
router.post("/portfolios", ...write("project_portfolios", "configure"), asyncHandler(setup.createPortfolio));
router.get("/portfolios/:portfolioId", can("project_portfolios", "view"), asyncHandler(setup.getPortfolio));
router.patch("/portfolios/:portfolioId", ...write("project_portfolios", "configure"), asyncHandler(setup.updatePortfolio));

// Templates
router.get("/templates", can("project_templates", "view"), asyncHandler(setup.listTemplates));
router.post("/templates", ...write("project_templates", "configure"), asyncHandler(setup.createTemplate));
router.get("/templates/:templateId", can("project_templates", "view"), asyncHandler(setup.getTemplate));
router.patch("/templates/:templateId", ...write("project_templates", "configure"), asyncHandler(setup.updateTemplate));
router.post("/templates/:templateId/new-version", ...write("project_templates", "configure"), asyncHandler(setup.newTemplateVersion));
router.post("/from-template", ...write("projects", "create"), keyUnlessPreview("projects.from_template"), asyncHandler(setup.createFromTemplate));

// Reports, workload and calendar (static paths — before /:projectId)
router.get("/summary", can("project_reports", "view"), asyncHandler(reports.summary));
router.get("/workload", can("project_reports", "view"), asyncHandler(reports.workload));
router.get("/calendar", can("projects", "view"), asyncHandler(reports.calendar));

// Time entries and timers (static paths — before /:projectId)
router.get("/time-entries", can("project_time", "view_own"), asyncHandler(time.listEntries));
router.post("/time-entries", ...write("project_time", "create"), asyncHandler(time.createEntry));
router.patch("/time-entries/:entryId", ...write("project_time", "create"), asyncHandler(time.updateEntry));
router.post("/time-entries/:entryId/submit", ...write("project_time", "submit"), requireIdempotencyKey("projects.time.submit"), asyncHandler(time.submitEntry));
router.post("/time-entries/:entryId/withdraw", ...write("project_time", "submit"), asyncHandler(time.withdrawEntry));
router.post("/time-entries/:entryId/approve", ...write("project_time", "approve"), asyncHandler(time.approveEntry));
router.post("/time-entries/:entryId/reject", ...write("project_time", "approve"), asyncHandler(time.rejectEntry));
router.post("/time-entries/:entryId/correct", ...write("project_time", "correct"), asyncHandler(time.correctEntry));
router.get("/timers/active", can("project_time", "create"), asyncHandler(time.activeTimer));
router.post("/timers/start", ...write("project_time", "create"), requireIdempotencyKey("projects.timer.start"), asyncHandler(time.startTimer));
router.post("/timers/:timerId/pause", ...write("project_time", "create"), asyncHandler(time.pauseTimer));
router.post("/timers/:timerId/resume", ...write("project_time", "create"), asyncHandler(time.resumeTimer));
router.post("/timers/:timerId/stop", ...write("project_time", "create"), requireIdempotencyKey("projects.timer.stop"), asyncHandler(time.stopTimer));
router.post("/timers/:timerId/discard", ...write("project_time", "create"), asyncHandler(time.discardTimer));

// Projects
router.get("/", can("projects", "view"), asyncHandler(ctrl.list));
router.post("/", ...write("projects", "create"), requireIdempotencyKey("projects.create"), asyncHandler(ctrl.create));
router.get("/:projectId", can("projects", "view"), asyncHandler(ctrl.getOne));
router.patch("/:projectId", ...write("projects", "edit"), asyncHandler(ctrl.update));
router.post("/:projectId/transition", ...write("projects", "transition"), asyncHandler(ctrl.transitionRoute));
router.post("/:projectId/archive", ...write("projects", "archive"), asyncHandler(ctrl.archive));
router.post("/:projectId/restore", ...write("projects", "restore"), asyncHandler(ctrl.restore));
router.post("/:projectId/progress", ...write("projects", "override_progress"), asyncHandler(ctrl.setManualProgress));
router.get("/:projectId/history", can("projects", "view"), asyncHandler(ctrl.history));

// Members
router.get("/:projectId/members", can("projects", "view"), asyncHandler(setup.listMembers));
router.post("/:projectId/members", ...write("projects", "manage_members"), asyncHandler(setup.addMember));
router.patch("/:projectId/members/:membershipId", ...write("projects", "manage_members"), asyncHandler(setup.updateMember));
router.delete("/:projectId/members/:membershipId", ...write("projects", "manage_members"), asyncHandler(setup.removeMember));

// Milestones
router.post("/:projectId/milestones", ...write("project_planning", "configure"), asyncHandler(ctrl.addMilestone));
router.patch("/:projectId/milestones/:milestoneId", ...write("project_planning", "configure"), asyncHandler(ctrl.updateMilestone));
router.post("/:projectId/milestones/:milestoneId/achieve", ...write("project_planning", "configure"), asyncHandler(ctrl.achieveMilestone));
router.post("/:projectId/milestones/:milestoneId/toggle", ...write("project_planning", "configure"), asyncHandler(ctrl.toggleMilestone)); // frontend's toggle

// Phases, boards, labels
router.get("/:projectId/phases", can("projects", "view"), asyncHandler(planning.listPhases));
router.post("/:projectId/phases", ...write("project_planning", "configure"), asyncHandler(planning.createPhase));
router.post("/:projectId/phases/reorder", ...write("project_planning", "configure"), asyncHandler(planning.reorderPhases));
router.patch("/:projectId/phases/:phaseId", ...write("project_planning", "configure"), asyncHandler(planning.updatePhase));
router.get("/:projectId/boards", can("projects", "view"), asyncHandler(planning.listBoards));
router.post("/:projectId/boards", ...write("project_planning", "configure"), asyncHandler(planning.createBoard));
router.patch("/:projectId/boards/:boardId", ...write("project_planning", "configure"), asyncHandler(planning.updateBoard));
router.post("/:projectId/boards/:boardId/columns/reorder", ...write("project_planning", "configure"), asyncHandler(planning.reorderColumns));
router.get("/:projectId/labels", can("projects", "view"), asyncHandler(planning.listLabels));
router.post("/:projectId/labels", ...write("project_planning", "configure"), asyncHandler(planning.createLabel));

// Tasks (spec routes)
router.get("/:projectId/tasks", can("tasks", "view"), asyncHandler(tasks.list));
router.post("/:projectId/tasks", ...write("tasks", "create"), requireIdempotencyKey("projects.task.create"), asyncHandler(tasks.create));
router.post("/:projectId/tasks/bulk", ...write("tasks", "bulk_actions"), asyncHandler(tasks.bulk));
router.get("/:projectId/tasks/:taskId", can("tasks", "view"), asyncHandler(tasks.getOne));
router.patch("/:projectId/tasks/:taskId", ...write("tasks", "edit"), asyncHandler(tasks.update));
router.post("/:projectId/tasks/:taskId/assign", ...write("tasks", "edit"), asyncHandler(tasks.assignRoute));
router.post("/:projectId/tasks/:taskId/transition", ...write("tasks", "transition"), asyncHandler(tasks.transitionRoute));
router.post("/:projectId/tasks/:taskId/archive", ...write("tasks", "archive"), asyncHandler(tasks.archive));
router.post("/:projectId/tasks/:taskId/restore", ...write("tasks", "restore"), asyncHandler(tasks.restore));
router.post("/:projectId/tasks/:taskId/dependencies", ...write("tasks", "edit"), asyncHandler(tasks.addDependency));
router.delete("/:projectId/tasks/:taskId/dependencies/:dependencyId", ...write("tasks", "edit"), asyncHandler(tasks.removeDependency));
router.post("/:projectId/tasks/:taskId/checklist", ...write("tasks", "edit"), asyncHandler(tasks.addChecklistItem));
router.post("/:projectId/tasks/:taskId/checklist/reorder", ...write("tasks", "edit"), asyncHandler(tasks.reorderChecklist));
router.patch("/:projectId/tasks/:taskId/checklist/:itemId", ...write("tasks", "edit"), asyncHandler(tasks.updateChecklistItem));

// Deliverables (internal review; customer review happens in the portal)
router.get("/:projectId/deliverables", can("deliverables", "view"), asyncHandler(gov.listDeliverables));
router.post("/:projectId/deliverables", ...write("deliverables", "edit"), asyncHandler(gov.createDeliverable));
router.patch("/:projectId/deliverables/:deliverableId", ...write("deliverables", "edit"), asyncHandler(gov.updateDeliverable));
router.post("/:projectId/deliverables/:deliverableId/submit", ...write("deliverables", "edit"), requireIdempotencyKey("projects.deliverable.submit"), asyncHandler(gov.submitDeliverable));
router.post("/:projectId/deliverables/:deliverableId/approve", ...write("deliverables", "review"), asyncHandler(gov.approveDeliverable));
router.post("/:projectId/deliverables/:deliverableId/request-changes", ...write("deliverables", "review"), asyncHandler(gov.requestDeliverableChanges));
router.post("/:projectId/deliverables/:deliverableId/accept", ...write("deliverables", "accept"), requireIdempotencyKey("projects.deliverable.accept"), asyncHandler(gov.acceptDeliverable));
router.post("/:projectId/deliverables/:deliverableId/reject", ...write("deliverables", "review"), asyncHandler(gov.rejectDeliverable));

// Risks and issues
router.get("/:projectId/risks", can("project_risks", "view"), asyncHandler(gov.listRisks));
router.post("/:projectId/risks", ...write("project_risks", "edit"), asyncHandler(gov.createRisk));
router.patch("/:projectId/risks/:riskId", ...write("project_risks", "edit"), asyncHandler(gov.updateRisk));
router.post("/:projectId/risks/:riskId/accept", ...write("project_risks", "accept"), asyncHandler(gov.acceptRisk));
router.post("/:projectId/risks/:riskId/close", ...write("project_risks", "edit"), asyncHandler(gov.closeRisk));
router.get("/:projectId/issues", can("project_issues", "view"), asyncHandler(gov.listIssues));
router.post("/:projectId/issues", ...write("project_issues", "edit"), asyncHandler(gov.createIssue));
router.patch("/:projectId/issues/:issueId", ...write("project_issues", "edit"), asyncHandler(gov.updateIssue));
router.post("/:projectId/issues/:issueId/resolve", ...write("project_issues", "edit"), asyncHandler(gov.resolveIssue));

// Change requests
router.get("/:projectId/change-requests", can("change_requests", "view"), asyncHandler(gov.listChanges));
router.post("/:projectId/change-requests", ...write("change_requests", "create"), asyncHandler(gov.createChange));
router.patch("/:projectId/change-requests/:changeId", ...write("change_requests", "create"), asyncHandler(gov.updateChange));
router.post("/:projectId/change-requests/:changeId/submit", ...write("change_requests", "create"), asyncHandler(gov.submitChange));
router.post("/:projectId/change-requests/:changeId/approve", ...write("change_requests", "review"), requireIdempotencyKey("projects.change.approve"), asyncHandler(gov.approveChange));
router.post("/:projectId/change-requests/:changeId/reject", ...write("change_requests", "review"), asyncHandler(gov.rejectChange));
router.post("/:projectId/change-requests/:changeId/cancel", ...write("change_requests", "create"), asyncHandler(gov.cancelChange));
router.post("/:projectId/change-requests/:changeId/apply-preview", ...write("change_requests", "apply"), asyncHandler(gov.applyPreview));
router.post("/:projectId/change-requests/:changeId/apply", ...write("change_requests", "apply"), requireIdempotencyKey("projects.change.apply"), asyncHandler(gov.applyChange));

// Baselines (immutable — no update/delete)
router.get("/:projectId/baselines", can("project_baselines", "view"), asyncHandler(gov.listBaselines));
router.post("/:projectId/baselines", ...write("project_baselines", "create"), requireIdempotencyKey("projects.baseline.create"), asyncHandler(gov.createBaseline));

// Comments (project-level, or a task's with ?taskId= / body.taskId)
router.get("/:projectId/comments", can("projects", "view"), asyncHandler(tasks.listComments));
router.post("/:projectId/comments", ...write("projects", "view"), asyncHandler(tasks.addComment));
router.patch("/:projectId/comments/:commentId", ...write("projects", "view"), asyncHandler(tasks.editComment));
router.post("/:projectId/comments/:commentId/archive", ...write("projects", "view"), asyncHandler(tasks.archiveComment));


export default router;
