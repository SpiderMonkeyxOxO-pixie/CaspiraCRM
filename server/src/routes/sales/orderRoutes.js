import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import * as ctrl from "../../controllers/sales/ordersController.js";
import * as contractCtrl from "../../controllers/sales/contractsController.js";

const router = Router();
router.use(authenticateCookie);

router.get("/", requireCrmOrgPermission("orders", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("orders", "create"), asyncHandler(ctrl.create));
router.get("/:orderId", requireCrmOrgPermission("orders", "view"), asyncHandler(ctrl.getOne));
router.patch("/:orderId", requireCsrf, requireCrmOrgPermission("orders", "edit"), asyncHandler(ctrl.update));
router.post("/:orderId/submit", requireCsrf, requireCrmOrgPermission("orders", "edit"), asyncHandler(ctrl.submit));
router.post("/:orderId/confirm", requireCsrf, requireCrmOrgPermission("orders", "confirm"), requireIdempotencyKey("order.confirm"), asyncHandler(ctrl.confirm));
router.post("/:orderId/cancel", requireCsrf, requireCrmOrgPermission("orders", "cancel"), asyncHandler(ctrl.cancel));
router.post("/:orderId/mark-in-progress", requireCsrf, requireCrmOrgPermission("orders", "edit"), asyncHandler(ctrl.markInProgress));
router.post("/:orderId/mark-fulfilled", requireCsrf, requireCrmOrgPermission("orders", "fulfill"), asyncHandler(ctrl.markFulfilled));
router.post("/:orderId/archive", requireCsrf, requireCrmOrgPermission("orders", "archive"), asyncHandler(ctrl.archive));
router.post("/:orderId/restore", requireCsrf, requireCrmOrgPermission("orders", "restore"), asyncHandler(ctrl.restore));
router.post("/:orderId/contract-preview", requireCrmOrgPermission("contracts", "create"), asyncHandler(contractCtrl.contractPreview));
router.post("/:orderId/convert-to-contract", requireCsrf, requireCrmOrgPermission("contracts", "create"), requireIdempotencyKey("order.convert-to-contract"), asyncHandler(contractCtrl.convertToContract));

export default router;
