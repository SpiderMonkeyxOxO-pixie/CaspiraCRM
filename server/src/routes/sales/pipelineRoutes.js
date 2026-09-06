import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as ctrl from "../../controllers/sales/pipelinesController.js";

const router = Router();
router.use(authenticateCookie);

router.get("/", requireCrmOrgPermission("pipeline", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("pipeline", "create"), asyncHandler(ctrl.create));
router.get("/:pipelineId", requireCrmOrgPermission("pipeline", "view"), asyncHandler(ctrl.getOne));
router.patch("/:pipelineId", requireCsrf, requireCrmOrgPermission("pipeline", "edit"), asyncHandler(ctrl.update));
router.post("/:pipelineId/archive", requireCsrf, requireCrmOrgPermission("pipeline", "archive"), asyncHandler(ctrl.archive));
router.post("/:pipelineId/restore", requireCsrf, requireCrmOrgPermission("pipeline", "restore"), asyncHandler(ctrl.restore));
router.post("/:pipelineId/stages", requireCsrf, requireCrmOrgPermission("pipeline", "edit"), asyncHandler(ctrl.createStage));
router.patch("/:pipelineId/stages/:stageId", requireCsrf, requireCrmOrgPermission("pipeline", "edit"), asyncHandler(ctrl.updateStage));
router.post("/:pipelineId/stages/reorder", requireCsrf, requireCrmOrgPermission("pipeline", "reorder"), asyncHandler(ctrl.reorderStages));

export default router;
