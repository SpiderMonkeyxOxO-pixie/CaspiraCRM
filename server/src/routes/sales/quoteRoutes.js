import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import * as ctrl from "../../controllers/sales/quotesController.js";
import * as orderCtrl from "../../controllers/sales/ordersController.js";

const router = Router();
router.use(authenticateCookie);

router.post("/bulk", requireCsrf, requireCrmOrgPermission("quotes", "bulk_actions"), asyncHandler(ctrl.bulk));

router.get("/", requireCrmOrgPermission("quotes", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("quotes", "create"), asyncHandler(ctrl.create));
router.get("/:quoteId", requireCrmOrgPermission("quotes", "view"), asyncHandler(ctrl.getOne));
router.patch("/:quoteId", requireCsrf, requireCrmOrgPermission("quotes", "edit"), asyncHandler(ctrl.update));
router.post("/:quoteId/submit", requireCsrf, requireCrmOrgPermission("quotes", "submit"), requireIdempotencyKey("quote.submit"), asyncHandler(ctrl.submit));
router.post("/:quoteId/approve", requireCsrf, requireCrmOrgPermission("quotes", "approve"), requireIdempotencyKey("quote.approve"), asyncHandler(ctrl.approve));
router.post("/:quoteId/reject", requireCsrf, requireCrmOrgPermission("quotes", "approve"), asyncHandler(ctrl.reject));
router.post("/:quoteId/issue", requireCsrf, requireCrmOrgPermission("quotes", "issue"), asyncHandler(ctrl.issue));
router.post("/:quoteId/accept", requireCsrf, requireCrmOrgPermission("quotes", "accept"), asyncHandler(ctrl.accept));
router.post("/:quoteId/reject-by-customer", requireCsrf, requireCrmOrgPermission("quotes", "accept"), asyncHandler(ctrl.rejectByCustomer));
router.post("/:quoteId/cancel", requireCsrf, requireCrmOrgPermission("quotes", "cancel"), asyncHandler(ctrl.cancel));
router.post("/:quoteId/new-version", requireCsrf, requireCrmOrgPermission("quotes", "edit"), asyncHandler(ctrl.newVersion));
router.post("/:quoteId/archive", requireCsrf, requireCrmOrgPermission("quotes", "cancel"), asyncHandler(ctrl.archive));
router.post("/:quoteId/restore", requireCsrf, requireCrmOrgPermission("quotes", "edit"), asyncHandler(ctrl.restore));
router.post("/:quoteId/order-preview", requireCrmOrgPermission("orders", "create"), asyncHandler(orderCtrl.orderPreview));
router.post("/:quoteId/convert-to-order", requireCsrf, requireCrmOrgPermission("orders", "create"), requireIdempotencyKey("quote.convert-to-order"), asyncHandler(orderCtrl.convertToOrder));

export default router;
