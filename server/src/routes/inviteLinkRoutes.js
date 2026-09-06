import { Router } from "express";
import { asyncHandler } from "../utils/crudFactory.js";
import { authenticateCookie, optionalAuthenticateCookie } from "../controllers/auth2Controller.js";
import { requireOrgPermission } from "../middleware/rbac.js";
import { requireCsrf } from "../middleware/csrf.js";
import { invitationAcceptRateLimit } from "../middleware/rateLimit.js";
import * as ctrl from "../controllers/inviteLinksController.js";

// Org-scoped management — mounted under organizationRoutes.js's
// /:organizationId prefix.
export const orgInviteLinkRoutes = Router({ mergeParams: true });
orgInviteLinkRoutes.use(authenticateCookie);
orgInviteLinkRoutes.get("/", requireOrgPermission("invite_links", "view"), asyncHandler(ctrl.listInviteLinks));
orgInviteLinkRoutes.post("/", requireCsrf, requireOrgPermission("invite_links", "create"), asyncHandler(ctrl.createInviteLink));
orgInviteLinkRoutes.post("/:linkId/rotate", requireCsrf, requireOrgPermission("invite_links", "edit"), asyncHandler(ctrl.rotateInviteLink));
orgInviteLinkRoutes.post("/:linkId/revoke", requireCsrf, requireOrgPermission("invite_links", "edit"), asyncHandler(ctrl.revokeInviteLink));

// Public — mounted at /api/v1/join.
export const publicJoinRoutes = Router();
publicJoinRoutes.get("/:token/validate", invitationAcceptRateLimit, asyncHandler(ctrl.validateJoinToken));
publicJoinRoutes.post("/:token/accept", invitationAcceptRateLimit, optionalAuthenticateCookie, asyncHandler(ctrl.acceptJoinToken));

export default publicJoinRoutes;
