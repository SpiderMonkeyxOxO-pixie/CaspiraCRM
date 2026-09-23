import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as ctrl from "../../controllers/sales/catalogController.js";

const router = Router();
router.use(authenticateCookie);

// Declared before /:itemId (Express matches in order). Needs "edit"; the
// archive action additionally checks the "archive" grant in the controller.
router.post("/bulk", requireCsrf, requireCrmOrgPermission("products_services", "edit"), asyncHandler(ctrl.bulk));
router.get("/", requireCrmOrgPermission("products_services", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("products_services", "create"), asyncHandler(ctrl.create));
router.get("/:itemId", requireCrmOrgPermission("products_services", "view"), asyncHandler(ctrl.getOne));
router.patch("/:itemId", requireCsrf, requireCrmOrgPermission("products_services", "edit"), asyncHandler(ctrl.update));
router.post("/:itemId/archive", requireCsrf, requireCrmOrgPermission("products_services", "archive"), asyncHandler(ctrl.archive));
router.post("/:itemId/restore", requireCsrf, requireCrmOrgPermission("products_services", "restore"), asyncHandler(ctrl.restore));

export default router;
