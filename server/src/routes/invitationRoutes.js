import { Router } from "express";
import { asyncHandler } from "../utils/crudFactory.js";
import { authenticateCookie, optionalAuthenticateCookie } from "../controllers/auth2Controller.js";
import { requireOrgPermission } from "../middleware/rbac.js";
import { requireCsrf } from "../middleware/csrf.js";
import { invitationAcceptRateLimit } from "../middleware/rateLimit.js";
import * as ctrl from "../controllers/invitationsController.js";

// Org-scoped invitation management — mounted under organizationRoutes.js's
// /:organizationId prefix (see organizationRoutes.js).
export const orgInvitationRoutes = Router({ mergeParams: true });
orgInvitationRoutes.use(authenticateCookie);
orgInvitationRoutes.get("/", requireOrgPermission("invitations", "view"), asyncHandler(ctrl.listInvitations));
orgInvitationRoutes.post("/", requireCsrf, requireOrgPermission("invitations", "create"), asyncHandler(ctrl.createInvitation));
orgInvitationRoutes.post("/:invitationId/resend", requireCsrf, requireOrgPermission("invitations", "edit"), asyncHandler(ctrl.resendInvitation));
orgInvitationRoutes.post("/:invitationId/revoke", requireCsrf, requireOrgPermission("invitations", "edit"), asyncHandler(ctrl.revokeInvitation));

// Public — mounted at /api/v1/invitations. The invitee isn't a member (or
// even a user) yet, so these carry no org-scoped auth requirement.
export const publicInvitationRoutes = Router();
publicInvitationRoutes.get("/:token/validate", invitationAcceptRateLimit, asyncHandler(ctrl.validateInvitationToken));
publicInvitationRoutes.post("/:token/accept", invitationAcceptRateLimit, optionalAuthenticateCookie, asyncHandler(ctrl.acceptInvitation));

export default publicInvitationRoutes;
