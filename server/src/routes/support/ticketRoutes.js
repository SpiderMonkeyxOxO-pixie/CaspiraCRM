import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import * as ctrl from "../../controllers/support/ticketsController.js";

// Backend Phase 4 (full spec) — organization-scoped tickets under
// /api/v1/support/tickets. Session-cookie auth, CSRF on writes, deny-by-
// default RBAC per action, and an Idempotency-Key on the operations the
// spec requires (create, public reply, resolve, close, reopen, merge).
const router = Router();
router.use(authenticateCookie);

const can = (action) => requireCrmOrgPermission("tickets", action);
const write = (action) => [requireCsrf, can(action)];
const once = (scope) => requireIdempotencyKey(`support.ticket.${scope}`);

router.get("/", can("view"), asyncHandler(ctrl.list));
router.post("/", ...write("create"), once("create"), asyncHandler(ctrl.create));
router.post("/bulk", ...write("bulk_actions"), asyncHandler(ctrl.bulk));
router.get("/:ticketId", can("view"), asyncHandler(ctrl.getOne));
router.patch("/:ticketId", ...write("edit"), asyncHandler(ctrl.update));
router.get("/:ticketId/events", can("view"), asyncHandler(ctrl.listEvents));
router.get("/:ticketId/messages", can("view"), asyncHandler(ctrl.listMessages));
router.get("/:ticketId/related", can("view"), asyncHandler(ctrl.related));

router.post("/:ticketId/transition", ...write("transition"), asyncHandler(ctrl.transition));
router.post("/:ticketId/advance", ...write("transition"), asyncHandler(ctrl.advance)); // pre-full-spec alias
router.post("/:ticketId/resolve", ...write("resolve"), once("resolve"), asyncHandler(ctrl.resolve));
router.post("/:ticketId/close", ...write("close"), once("close"), asyncHandler(ctrl.close));
router.post("/:ticketId/reopen", ...write("reopen"), once("reopen"), asyncHandler(ctrl.reopen));
router.post("/:ticketId/escalate", ...write("escalate"), asyncHandler(ctrl.escalate));
router.post("/:ticketId/assign", ...write("assign"), asyncHandler(ctrl.assign));
router.post("/:ticketId/followers", ...write("view"), asyncHandler(ctrl.addFollower));
router.delete("/:ticketId/followers/:membershipId", ...write("view"), asyncHandler(ctrl.removeFollower));

router.post("/:ticketId/replies", ...write("reply"), once("reply"), asyncHandler(ctrl.reply));
router.post("/:ticketId/internal-notes", ...write("add_internal_notes"), asyncHandler(ctrl.addInternalNote));
router.post("/:ticketId/notes", ...write("add_internal_notes"), asyncHandler(ctrl.addNote)); // pre-full-spec alias

router.post("/:ticketId/archive", ...write("archive"), asyncHandler(ctrl.archive));
router.post("/:ticketId/restore", ...write("restore"), asyncHandler(ctrl.restore));
router.post("/:ticketId/merge-preview", ...write("merge"), asyncHandler(ctrl.mergePreview));
router.post("/:ticketId/merge", ...write("merge"), once("merge"), asyncHandler(ctrl.merge));

export default router;
