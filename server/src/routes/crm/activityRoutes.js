import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as ctrl from "../../controllers/crm/activitiesController.js";

const router = Router();
router.use(authenticateCookie);

// Static paths declared BEFORE the /:activityId param route — same
// ordering discipline as leadRoutes.js/contactRoutes.js/companyRoutes.js.
router.get("/summary", requireCrmOrgPermission("activities", "view"), asyncHandler(ctrl.summary));
router.post("/bulk", requireCsrf, requireCrmOrgPermission("activities", "bulk_actions"), asyncHandler(ctrl.bulk));

router.get("/", requireCrmOrgPermission("activities", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("activities", "create"), asyncHandler(ctrl.create));
router.get("/:activityId", requireCrmOrgPermission("activities", "view"), asyncHandler(ctrl.getOne));
router.patch("/:activityId", requireCsrf, requireCrmOrgPermission("activities", "edit"), asyncHandler(ctrl.update));
router.post("/:activityId/complete", requireCsrf, requireCrmOrgPermission("activities", "edit"), asyncHandler(ctrl.complete));
router.post("/:activityId/cancel", requireCsrf, requireCrmOrgPermission("activities", "edit"), asyncHandler(ctrl.cancel));
router.post("/:activityId/reopen", requireCsrf, requireCrmOrgPermission("activities", "edit"), asyncHandler(ctrl.reopen));
router.post("/:activityId/archive", requireCsrf, requireCrmOrgPermission("activities", "archive"), asyncHandler(ctrl.archive));
router.post("/:activityId/restore", requireCsrf, requireCrmOrgPermission("activities", "restore"), asyncHandler(ctrl.restore));
router.post("/:activityId/assign", requireCsrf, requireCrmOrgPermission("activities", "assign"), asyncHandler(ctrl.assign));

export default router;
