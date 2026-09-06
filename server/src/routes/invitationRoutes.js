import { Router } from "express";
import { asyncHandler } from "../utils/crudFactory.js";
import { authenticateCookie, optionalAuthenticateCookie } from "../controllers/auth2Controller.js";
import { requireOrgPermission } from "../middleware/rbac.js";
import { requireCsrf } from "../middleware/csrf.js";
import { invitationAcceptRateLimit } from "../middleware/rateLimit.js";
import * as ctrl from "../controllers/invitationsController.js";

// Org-scoped invitation management — mounted under organizationRoutes.js's
// /:organizationId prefix (see organizationRoutes.js).
/**
 * @openapi
 * /organizations/{organizationId}/invitations:
 *   get:
 *     summary: List an organization's invitations
 *     tags: [Invitations]
 *     responses: { 200: { description: OK } }
 *   post:
 *     summary: Invite someone to the organization
 *     description: The token is emailed to the invitee — the raw value never appears in any API response or log.
 *     tags: [Invitations]
 *     requestBody: { required: true, content: { application/json: { schema: { type: object, required: [email, roleId], properties: { email: { type: string }, roleId: { type: string }, department: { type: string }, team: { type: string }, message: { type: string }, expiresInDays: { type: integer } } } } } }
 *     responses: { 201: { description: Created }, 403: { description: Role not grantable } }
 * /organizations/{organizationId}/invitations/{invitationId}/resend:
 *   post:
 *     summary: Resend an invitation
 *     description: Rotates the token — the previous link stops working.
 *     tags: [Invitations]
 *     responses: { 200: { description: Resent }, 400: { description: Not in a resendable state } }
 * /organizations/{organizationId}/invitations/{invitationId}/revoke:
 *   post:
 *     summary: Revoke a pending invitation
 *     tags: [Invitations]
 *     responses: { 200: { description: Revoked }, 400: { description: Not in a revocable state } }
 */
export const orgInvitationRoutes = Router({ mergeParams: true });
orgInvitationRoutes.use(authenticateCookie);
orgInvitationRoutes.get("/", requireOrgPermission("invitations", "view"), asyncHandler(ctrl.listInvitations));
orgInvitationRoutes.post("/", requireCsrf, requireOrgPermission("invitations", "create"), asyncHandler(ctrl.createInvitation));
orgInvitationRoutes.post("/:invitationId/resend", requireCsrf, requireOrgPermission("invitations", "edit"), asyncHandler(ctrl.resendInvitation));
orgInvitationRoutes.post("/:invitationId/revoke", requireCsrf, requireOrgPermission("invitations", "edit"), asyncHandler(ctrl.revokeInvitation));

// Public — mounted at /api/v1/invitations. The invitee isn't a member (or
// even a user) yet, so these carry no org-scoped auth requirement.
/**
 * @openapi
 * /invitations/{token}/validate:
 *   get:
 *     summary: Validate an invitation token before showing the accept form
 *     tags: [Invitations]
 *     security: []
 *     responses: { 200: { description: OK }, 404: { description: Invalid or expired } }
 * /invitations/{token}/accept:
 *   post:
 *     summary: Accept an invitation
 *     description: An existing account must already be logged in as that exact user (never accepts a password here as proof); a new account is created and logged in automatically. Concurrency-safe — a token can never create two memberships.
 *     tags: [Invitations]
 *     security: []
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { name: { type: string }, password: { type: string } } } } } }
 *     responses: { 200: { description: Accepted }, 400: { description: Validation error }, 404: { description: Invalid or expired }, 409: { description: Already accepted, or an account exists and the caller isn't logged in as it } }
 */
export const publicInvitationRoutes = Router();
publicInvitationRoutes.get("/:token/validate", invitationAcceptRateLimit, asyncHandler(ctrl.validateInvitationToken));
publicInvitationRoutes.post("/:token/accept", invitationAcceptRateLimit, optionalAuthenticateCookie, asyncHandler(ctrl.acceptInvitation));

export default publicInvitationRoutes;
