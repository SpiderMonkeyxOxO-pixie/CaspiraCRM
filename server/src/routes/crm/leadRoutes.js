import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import * as ctrl from "../../controllers/crm/leadsController.js";

const router = Router();
router.use(authenticateCookie);

// Static paths declared BEFORE the /:leadId param route — otherwise
// "/summary" would be swallowed by "/:leadId" and never reached (the same
// static-before-dynamic ordering Backend Phase 1 established).
router.get("/summary", requireCrmOrgPermission("leads", "view"), asyncHandler(ctrl.summary));
router.post("/bulk", requireCsrf, requireCrmOrgPermission("leads", "bulk_actions"), asyncHandler(ctrl.bulk));

router.get("/", requireCrmOrgPermission("leads", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("leads", "create"), asyncHandler(ctrl.create));
router.get("/:leadId", requireCrmOrgPermission("leads", "view"), asyncHandler(ctrl.getOne));
router.patch("/:leadId", requireCsrf, requireCrmOrgPermission("leads", "edit"), asyncHandler(ctrl.update));
router.post("/:leadId/archive", requireCsrf, requireCrmOrgPermission("leads", "archive"), asyncHandler(ctrl.archive));
router.post("/:leadId/restore", requireCsrf, requireCrmOrgPermission("leads", "restore"), asyncHandler(ctrl.restore));
router.post("/:leadId/assign", requireCsrf, requireCrmOrgPermission("leads", "assign"), asyncHandler(ctrl.assign));
router.get("/:leadId/duplicate-candidates", requireCrmOrgPermission("leads", "view"), asyncHandler(ctrl.duplicateCandidates));
router.post("/:leadId/convert", requireCsrf, requireCrmOrgPermission("leads", "convert"), requireIdempotencyKey("lead.convert"), asyncHandler(ctrl.convert));

export default router;
