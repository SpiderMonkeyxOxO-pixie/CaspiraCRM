import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as ctrl from "../../controllers/crm/notesController.js";

const router = Router();
router.use(authenticateCookie);

router.get("/", requireCrmOrgPermission("notes", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("notes", "create"), asyncHandler(ctrl.create));
router.patch("/:noteId", requireCsrf, requireCrmOrgPermission("notes", "edit"), asyncHandler(ctrl.update));
router.post("/:noteId/archive", requireCsrf, requireCrmOrgPermission("notes", "archive"), asyncHandler(ctrl.archive));

export default router;
