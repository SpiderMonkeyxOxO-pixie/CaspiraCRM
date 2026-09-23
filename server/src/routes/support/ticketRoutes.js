import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as ctrl from "../../controllers/support/ticketsController.js";

// Backend Phase 4 — organization-scoped Support tickets. Session-cookie
// authenticated, CSRF-protected, RBAC-gated per action on the "tickets"
// module, organizationId resolved from query/body and checked against a
// live membership (requireCrmOrgPermission).
const router = Router();
router.use(authenticateCookie);

router.get("/", requireCrmOrgPermission("tickets", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("tickets", "create"), asyncHandler(ctrl.create));
router.get("/:ticketId", requireCrmOrgPermission("tickets", "view"), asyncHandler(ctrl.getOne));
router.patch("/:ticketId", requireCsrf, requireCrmOrgPermission("tickets", "edit"), asyncHandler(ctrl.update));
router.post("/:ticketId/advance", requireCsrf, requireCrmOrgPermission("tickets", "edit"), asyncHandler(ctrl.advance));
router.post("/:ticketId/assign", requireCsrf, requireCrmOrgPermission("tickets", "assign"), asyncHandler(ctrl.assign));
router.post("/:ticketId/replies", requireCsrf, requireCrmOrgPermission("tickets", "reply"), asyncHandler(ctrl.reply));
router.post("/:ticketId/notes", requireCsrf, requireCrmOrgPermission("tickets", "edit"), asyncHandler(ctrl.addNote));
router.post("/:ticketId/escalate", requireCsrf, requireCrmOrgPermission("tickets", "escalate"), asyncHandler(ctrl.escalate));
router.post("/:ticketId/resolve", requireCsrf, requireCrmOrgPermission("tickets", "resolve"), asyncHandler(ctrl.resolve));
router.post("/:ticketId/close", requireCsrf, requireCrmOrgPermission("tickets", "close"), asyncHandler(ctrl.close));
router.post("/:ticketId/reopen", requireCsrf, requireCrmOrgPermission("tickets", "reopen"), asyncHandler(ctrl.reopen));

export default router;
