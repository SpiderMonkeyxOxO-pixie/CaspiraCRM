import { Router } from "express";
import { asyncHandler } from "../utils/crudFactory.js";
import { authenticateCookie, optionalAuthenticateCookie } from "../controllers/auth2Controller.js";
import { requireOrgPermission } from "../middleware/rbac.js";
import { requireCsrf } from "../middleware/csrf.js";
import { invitationAcceptRateLimit } from "../middleware/rateLimit.js";
import * as ctrl from "../controllers/inviteLinksController.js";

// Org-scoped management — mounted under organizationRoutes.js's
// /:organizationId prefix.
/**
 * @openapi
 * /organizations/{organizationId}/invite-links:
 *   get:
 *     summary: List an organization's invite links
 *     tags: [Invite Links]
 *     responses: { 200: { description: OK } }
 *   post:
 *     summary: Create an invite link
 *     description: defaultRoleId can never be super_admin/admin — an invite link is inherently lower-trust than a named invitation.
 *     tags: [Invite Links]
 *     requestBody: { required: true, content: { application/json: { schema: { type: object, required: [defaultRoleId], properties: { defaultRoleId: { type: string }, expiresInDays: { type: integer }, maxUses: { type: integer }, allowedDomains: { type: array, items: { type: string } }, requiresApproval: { type: boolean } } } } } }
 *     responses: { 201: { description: Created — response includes the one-time joinUrl }, 403: { description: Role not grantable } }
 * /organizations/{organizationId}/invite-links/{linkId}/rotate:
 *   post:
 *     summary: Rotate an invite link's token
 *     description: Invalidates the previous link outright.
 *     tags: [Invite Links]
 *     responses: { 200: { description: Rotated — response includes the new joinUrl }, 404: { description: Not found } }
 * /organizations/{organizationId}/invite-links/{linkId}/revoke:
 *   post:
 *     summary: Revoke an invite link
 *     tags: [Invite Links]
 *     responses: { 200: { description: Revoked }, 404: { description: Not found } }
 */
export const orgInviteLinkRoutes = Router({ mergeParams: true });
orgInviteLinkRoutes.use(authenticateCookie);
orgInviteLinkRoutes.get("/", requireOrgPermission("invite_links", "view"), asyncHandler(ctrl.listInviteLinks));
orgInviteLinkRoutes.post("/", requireCsrf, requireOrgPermission("invite_links", "create"), asyncHandler(ctrl.createInviteLink));
orgInviteLinkRoutes.post("/:linkId/rotate", requireCsrf, requireOrgPermission("invite_links", "edit"), asyncHandler(ctrl.rotateInviteLink));
orgInviteLinkRoutes.post("/:linkId/revoke", requireCsrf, requireOrgPermission("invite_links", "edit"), asyncHandler(ctrl.revokeInviteLink));

// Public — mounted at /api/v1/join.
/**
 * @openapi
 * /join/{token}/validate:
 *   get:
 *     summary: Validate an invite link token before showing the join form
 *     tags: [Invite Links]
 *     security: []
 *     responses: { 200: { description: OK }, 404: { description: Invalid, expired, or exhausted } }
 * /join/{token}/accept:
 *   post:
 *     summary: Join an organization via an invite link
 *     description: Enforces allowed-domain and max-use limits atomically on the server (never trusts a client-side check). requiresApproval links create the membership as "Invited", not "Active".
 *     tags: [Invite Links]
 *     security: []
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { email: { type: string }, name: { type: string }, password: { type: string } } } } } }
 *     responses: { 200: { description: Joined (or submitted for approval) }, 403: { description: Domain not allowed }, 404: { description: Invalid or expired }, 409: { description: Use limit reached } }
 */
export const publicJoinRoutes = Router();
publicJoinRoutes.get("/:token/validate", invitationAcceptRateLimit, asyncHandler(ctrl.validateJoinToken));
publicJoinRoutes.post("/:token/accept", invitationAcceptRateLimit, optionalAuthenticateCookie, asyncHandler(ctrl.acceptJoinToken));

export default publicJoinRoutes;
