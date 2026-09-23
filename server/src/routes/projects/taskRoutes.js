import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import * as ctrl from "../../controllers/projects/tasksController.js";

// /api/v1/tasks — the routes the Projects frontend already calls (all tasks
// across projects, plus task updates by id). Same rules as the spec routes
// under /api/v1/projects/:projectId/tasks.
const router = Router();
router.use(authenticateCookie);

const can = (action) => requireCrmOrgPermission("tasks", action);
const write = (action) => [requireCsrf, can(action)];

router.get("/", can("view"), asyncHandler(ctrl.list));
router.post("/", ...write("create"), requireIdempotencyKey("projects.task.create"), asyncHandler(ctrl.create));
router.get("/:taskId", can("view"), asyncHandler(ctrl.getOne));
router.patch("/:taskId", ...write("edit"), asyncHandler(ctrl.update));
router.post("/:taskId/comments", ...write("view"), asyncHandler(ctrl.addComment));
router.post("/:taskId/time", ...write("view"), asyncHandler(ctrl.logTime));

export default router;
