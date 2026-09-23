import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import * as ctrl from "../../controllers/projects/projectsController.js";
import * as setup from "../../controllers/projects/projectSetupController.js";

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


export default router;
