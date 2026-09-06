import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import * as ctrl from "../../controllers/sales/contractsController.js";

const router = Router();
router.use(authenticateCookie);

router.get("/", requireCrmOrgPermission("contracts", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("contracts", "create"), asyncHandler(ctrl.create));
router.get("/:contractId", requireCrmOrgPermission("contracts", "view"), asyncHandler(ctrl.getOne));
router.patch("/:contractId", requireCsrf, requireCrmOrgPermission("contracts", "edit"), asyncHandler(ctrl.update));
router.post("/:contractId/submit", requireCsrf, requireCrmOrgPermission("contracts", "edit"), asyncHandler(ctrl.submit));
router.post("/:contractId/approve", requireCsrf, requireCrmOrgPermission("contracts", "approve"), asyncHandler(ctrl.approve));
router.post("/:contractId/record-signature", requireCsrf, requireCrmOrgPermission("contracts", "edit"), asyncHandler(ctrl.recordSignature));
router.post("/:contractId/activate", requireCsrf, requireCrmOrgPermission("contracts", "activate"), requireIdempotencyKey("contract.activate"), asyncHandler(ctrl.activate));
router.post("/:contractId/start-renewal-review", requireCsrf, requireCrmOrgPermission("contracts", "renew"), asyncHandler(ctrl.startRenewalReview));
router.post("/:contractId/renewal-reviews/:reviewId/decide", requireCsrf, requireCrmOrgPermission("contracts", "renew"), asyncHandler(ctrl.decideRenewal));
router.post("/:contractId/expire", requireCsrf, requireCrmOrgPermission("contracts", "edit"), asyncHandler(ctrl.expire));
router.post("/:contractId/terminate", requireCsrf, requireCrmOrgPermission("contracts", "terminate"), asyncHandler(ctrl.terminate));
router.post("/:contractId/cancel", requireCsrf, requireCrmOrgPermission("contracts", "edit"), asyncHandler(ctrl.cancel));
router.post("/:contractId/archive", requireCsrf, requireCrmOrgPermission("contracts", "archive"), asyncHandler(ctrl.archive));
router.post("/:contractId/restore", requireCsrf, requireCrmOrgPermission("contracts", "restore"), asyncHandler(ctrl.restore));
router.get("/:contractId/obligations", requireCrmOrgPermission("contracts", "view"), asyncHandler(ctrl.listObligations));
router.post("/:contractId/obligations", requireCsrf, requireCrmOrgPermission("contracts", "manage_obligations"), asyncHandler(ctrl.createObligation));
router.patch("/:contractId/obligations/:obligationId", requireCsrf, requireCrmOrgPermission("contracts", "manage_obligations"), asyncHandler(ctrl.updateObligation));
router.post("/:contractId/obligations/:obligationId/complete", requireCsrf, requireCrmOrgPermission("contracts", "manage_obligations"), asyncHandler(ctrl.completeObligation));
router.post("/:contractId/obligations/:obligationId/waive", requireCsrf, requireCrmOrgPermission("contracts", "manage_obligations"), asyncHandler(ctrl.waiveObligation));

export default router;
