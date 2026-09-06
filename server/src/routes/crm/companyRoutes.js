import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import * as ctrl from "../../controllers/crm/companiesController.js";

const router = Router();
router.use(authenticateCookie);

router.get("/summary", requireCrmOrgPermission("companies", "view"), asyncHandler(ctrl.summary));
router.post("/bulk", requireCsrf, requireCrmOrgPermission("companies", "bulk_actions"), asyncHandler(ctrl.bulk));

router.get("/", requireCrmOrgPermission("companies", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("companies", "create"), asyncHandler(ctrl.create));
router.get("/:companyId", requireCrmOrgPermission("companies", "view"), asyncHandler(ctrl.getOne));
router.patch("/:companyId", requireCsrf, requireCrmOrgPermission("companies", "edit"), asyncHandler(ctrl.update));
router.post("/:companyId/archive", requireCsrf, requireCrmOrgPermission("companies", "archive"), asyncHandler(ctrl.archive));
router.post("/:companyId/restore", requireCsrf, requireCrmOrgPermission("companies", "restore"), asyncHandler(ctrl.restore));
router.post("/:companyId/assign", requireCsrf, requireCrmOrgPermission("companies", "assign"), asyncHandler(ctrl.assign));
router.get("/:companyId/duplicate-candidates", requireCrmOrgPermission("companies", "view"), asyncHandler(ctrl.duplicateCandidates));
router.post("/:companyId/merge-preview", requireCrmOrgPermission("companies", "merge"), asyncHandler(ctrl.mergePreviewHandler));
router.post("/:companyId/merge", requireCsrf, requireCrmOrgPermission("companies", "merge"), requireIdempotencyKey("company.merge"), asyncHandler(ctrl.mergeHandler));

router.get("/:companyId/contacts", requireCrmOrgPermission("companies", "view"), asyncHandler(ctrl.listContacts));
router.post("/:companyId/contacts", requireCsrf, requireCrmOrgPermission("companies", "edit"), asyncHandler(ctrl.linkContact));
router.patch("/:companyId/contacts/:contactId", requireCsrf, requireCrmOrgPermission("companies", "edit"), asyncHandler(ctrl.updateContactRelationship));
router.delete("/:companyId/contacts/:contactId", requireCsrf, requireCrmOrgPermission("companies", "edit"), asyncHandler(ctrl.unlinkContact));

export default router;
