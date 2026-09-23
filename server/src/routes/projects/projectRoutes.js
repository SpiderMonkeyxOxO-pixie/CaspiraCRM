import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as ctrl from "../../controllers/projects/projectsController.js";

// Backend Phase 5 — organization-scoped Projects. Session-cookie
// authenticated, CSRF-protected, RBAC-gated per action on the "projects"
// module, organizationId resolved from query/body and checked against a
// live membership (requireCrmOrgPermission).
const router = Router();
router.use(authenticateCookie);

router.get("/", requireCrmOrgPermission("projects", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("projects", "create"), asyncHandler(ctrl.create));
router.get("/:projectId", requireCrmOrgPermission("projects", "view"), asyncHandler(ctrl.getOne));
router.patch("/:projectId", requireCsrf, requireCrmOrgPermission("projects", "edit"), asyncHandler(ctrl.update));
router.post("/:projectId/milestones", requireCsrf, requireCrmOrgPermission("projects", "edit"), asyncHandler(ctrl.addMilestone));
router.post("/:projectId/milestones/:milestoneId/toggle", requireCsrf, requireCrmOrgPermission("projects", "edit"), asyncHandler(ctrl.toggleMilestone));

export default router;
