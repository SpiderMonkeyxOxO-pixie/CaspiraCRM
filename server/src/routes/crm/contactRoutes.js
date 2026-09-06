import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import * as ctrl from "../../controllers/crm/contactsController.js";

const router = Router();
router.use(authenticateCookie);

router.get("/summary", requireCrmOrgPermission("contacts", "view"), asyncHandler(ctrl.summary));
router.post("/bulk", requireCsrf, requireCrmOrgPermission("contacts", "bulk_actions"), asyncHandler(ctrl.bulk));

router.get("/", requireCrmOrgPermission("contacts", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("contacts", "create"), asyncHandler(ctrl.create));
router.get("/:contactId", requireCrmOrgPermission("contacts", "view"), asyncHandler(ctrl.getOne));
router.patch("/:contactId", requireCsrf, requireCrmOrgPermission("contacts", "edit"), asyncHandler(ctrl.update));
router.post("/:contactId/archive", requireCsrf, requireCrmOrgPermission("contacts", "archive"), asyncHandler(ctrl.archive));
router.post("/:contactId/restore", requireCsrf, requireCrmOrgPermission("contacts", "restore"), asyncHandler(ctrl.restore));
router.post("/:contactId/assign", requireCsrf, requireCrmOrgPermission("contacts", "assign"), asyncHandler(ctrl.assign));
router.get("/:contactId/duplicate-candidates", requireCrmOrgPermission("contacts", "view"), asyncHandler(ctrl.duplicateCandidates));
router.post("/:contactId/merge-preview", requireCrmOrgPermission("contacts", "merge"), asyncHandler(ctrl.mergePreviewHandler));
router.post("/:contactId/merge", requireCsrf, requireCrmOrgPermission("contacts", "merge"), requireIdempotencyKey("contact.merge"), asyncHandler(ctrl.mergeHandler));

export default router;
