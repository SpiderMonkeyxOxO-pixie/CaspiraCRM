import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as ctrl from "../../controllers/projects/tasksController.js";

// Backend Phase 5 — organization-scoped Tasks, same conventions as
// projectRoutes.js on the "tasks" module.
const router = Router();
router.use(authenticateCookie);

router.get("/", requireCrmOrgPermission("tasks", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("tasks", "create"), asyncHandler(ctrl.create));
router.get("/:taskId", requireCrmOrgPermission("tasks", "view"), asyncHandler(ctrl.getOne));
router.patch("/:taskId", requireCsrf, requireCrmOrgPermission("tasks", "edit"), asyncHandler(ctrl.update));
router.post("/:taskId/comments", requireCsrf, requireCrmOrgPermission("tasks", "edit"), asyncHandler(ctrl.addComment));
router.post("/:taskId/time", requireCsrf, requireCrmOrgPermission("tasks", "edit"), asyncHandler(ctrl.logTime));

export default router;
