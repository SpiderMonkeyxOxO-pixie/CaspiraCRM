import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as ctrl from "../../controllers/crm/tagsController.js";

const router = Router();
router.use(authenticateCookie);

router.get("/for-record", requireCrmOrgPermission("tags", "view"), asyncHandler(ctrl.listForRecord));
router.post("/assign", requireCsrf, requireCrmOrgPermission("tags", "edit"), asyncHandler(ctrl.assign));

router.get("/", requireCrmOrgPermission("tags", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("tags", "create"), asyncHandler(ctrl.create));
router.patch("/:tagId", requireCsrf, requireCrmOrgPermission("tags", "edit"), asyncHandler(ctrl.update));
router.post("/:tagId/archive", requireCsrf, requireCrmOrgPermission("tags", "archive"), asyncHandler(ctrl.archive));
router.delete("/:tagId/assignment", requireCsrf, requireCrmOrgPermission("tags", "edit"), asyncHandler(ctrl.unassign));

export default router;
