import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as ctrl from "../../controllers/sales/dealsController.js";

const router = Router();
router.use(authenticateCookie);

// Static paths before /:dealId — same ordering discipline as every other
// Phase 2/3 router.
router.post("/bulk", requireCsrf, requireCrmOrgPermission("deals", "bulk_actions"), asyncHandler(ctrl.bulk));

router.get("/", requireCrmOrgPermission("deals", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("deals", "create"), asyncHandler(ctrl.create));
router.get("/:dealId", requireCrmOrgPermission("deals", "view"), asyncHandler(ctrl.getOne));
router.patch("/:dealId", requireCsrf, requireCrmOrgPermission("deals", "edit"), asyncHandler(ctrl.update));
router.post("/:dealId/assign", requireCsrf, requireCrmOrgPermission("deals", "assign"), asyncHandler(ctrl.assign));
router.post("/:dealId/transition", requireCsrf, requireCrmOrgPermission("deals", "transition"), asyncHandler(ctrl.transition));
router.post("/:dealId/mark-won", requireCsrf, requireCrmOrgPermission("deals", "close"), asyncHandler(ctrl.markWon));
router.post("/:dealId/mark-lost", requireCsrf, requireCrmOrgPermission("deals", "close"), asyncHandler(ctrl.markLost));
router.post("/:dealId/reopen", requireCsrf, requireCrmOrgPermission("deals", "reopen"), asyncHandler(ctrl.reopen));
router.post("/:dealId/archive", requireCsrf, requireCrmOrgPermission("deals", "archive"), asyncHandler(ctrl.archive));
router.post("/:dealId/restore", requireCsrf, requireCrmOrgPermission("deals", "restore"), asyncHandler(ctrl.restore));
router.get("/:dealId/stage-history", requireCrmOrgPermission("deals", "view"), asyncHandler(ctrl.stageHistory));
router.get("/:dealId/risk-flags", requireCrmOrgPermission("deals", "view"), asyncHandler(ctrl.riskFlags));
router.get("/:dealId/line-items", requireCrmOrgPermission("deals", "view"), asyncHandler(ctrl.listLineItems));
router.post("/:dealId/line-items", requireCsrf, requireCrmOrgPermission("deals", "edit"), asyncHandler(ctrl.createLineItem));
router.patch("/:dealId/line-items/:lineItemId", requireCsrf, requireCrmOrgPermission("deals", "edit"), asyncHandler(ctrl.updateLineItem));
router.delete("/:dealId/line-items/:lineItemId", requireCsrf, requireCrmOrgPermission("deals", "edit"), asyncHandler(ctrl.deleteLineItem));

export default router;
