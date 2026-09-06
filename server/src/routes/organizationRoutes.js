import { Router } from "express";
import { asyncHandler } from "../utils/crudFactory.js";
import { authenticateCookie } from "../controllers/auth2Controller.js";
import { requireOrgPermission } from "../middleware/rbac.js";
import { requireCsrf } from "../middleware/csrf.js";
import * as orgCtrl from "../controllers/organizationsController.js";
import * as memberCtrl from "../controllers/membersController.js";
import * as roleCtrl from "../controllers/orgRolesController.js";
import { orgInvitationRoutes } from "./invitationRoutes.js";
import { orgInviteLinkRoutes } from "./inviteLinkRoutes.js";

const router = Router();

router.use(authenticateCookie);

/**
 * @openapi
 * /organizations:
 *   get:
 *     summary: List organizations the caller belongs to (or all, for System Owner)
 *     tags: [Organizations]
 *     responses: { 200: { description: OK } }
 *   post:
 *     summary: Create an organization (caller becomes its Organization Administrator)
 *     tags: [Organizations]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [name], properties: { name: { type: string } } } } } }
 *     responses: { 201: { description: Created }, 400: { description: Validation error } }
 */
router.get("/", asyncHandler(orgCtrl.listOrganizations));
router.post("/", requireCsrf, asyncHandler(orgCtrl.createOrganization));

/**
 * @openapi
 * /organizations/{organizationId}:
 *   get:
 *     summary: Get an organization
 *     tags: [Organizations]
 *     parameters: [{ name: organizationId, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: OK, content: { application/json: { schema: { type: object, properties: { organization: { $ref: "#/components/schemas/Organization" } } } } } }, 404: { description: "Not found (no membership — an unauthorized org's existence is never confirmed)" } }
 *   patch:
 *     summary: Update an organization
 *     description: Changing `status` (suspend/archive) requires System Owner even for that org's own Administrator.
 *     tags: [Organizations]
 *     parameters: [{ name: organizationId, in: path, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Updated }, 403: { description: Forbidden }, 404: { description: Not found } }
 */
router.get("/:organizationId", requireOrgPermission("organizations", "view"), asyncHandler(orgCtrl.getOrganization));
router.patch("/:organizationId", requireCsrf, requireOrgPermission("organizations", "edit"), asyncHandler(orgCtrl.updateOrganization));

/**
 * @openapi
 * /organizations/{organizationId}/members:
 *   get:
 *     summary: List an organization's members (paginated)
 *     tags: [Members]
 *     parameters: [{ name: organizationId, in: path, required: true, schema: { type: string } }, { name: page, in: query, schema: { type: integer } }, { name: pageSize, in: query, schema: { type: integer } }]
 *     responses: { 200: { description: OK }, 404: { description: Not found } }
 * /organizations/{organizationId}/members/{memberId}:
 *   get:
 *     summary: Get a member
 *     tags: [Members]
 *     responses: { 200: { description: OK }, 404: { description: Not found } }
 *   patch:
 *     summary: Suspend or reactivate a member
 *     tags: [Members]
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { status: { type: string, enum: [Active, Suspended] } } } } } }
 *     responses: { 200: { description: Updated }, 400: { description: Invalid status transition }, 404: { description: Not found } }
 *   delete:
 *     summary: Remove a member from the organization
 *     tags: [Members]
 *     responses: { 200: { description: Removed }, 404: { description: Not found } }
 */
router.get("/:organizationId/members", requireOrgPermission("members", "view"), asyncHandler(memberCtrl.listMembers));
router.get("/:organizationId/members/:memberId", requireOrgPermission("members", "view"), asyncHandler(memberCtrl.getMember));
router.patch("/:organizationId/members/:memberId", requireCsrf, requireOrgPermission("members", "edit"), asyncHandler(memberCtrl.updateMember));
router.delete("/:organizationId/members/:memberId", requireCsrf, requireOrgPermission("members", "delete_permanently"), asyncHandler(memberCtrl.removeMember));

/**
 * @openapi
 * /organizations/{organizationId}/members/{memberId}/roles:
 *   post:
 *     summary: Assign a role to a member
 *     description: Rejects super_admin/admin (Organization Administrator) with 403 ROLE_NOT_GRANTABLE regardless of caller permissions — a structural boundary, not a grantable permission.
 *     tags: [Members]
 *     requestBody: { required: true, content: { application/json: { schema: { type: object, required: [roleId], properties: { roleId: { type: string } } } } } }
 *     responses: { 200: { description: Assigned }, 403: { description: Role not grantable }, 404: { description: Not found } }
 * /organizations/{organizationId}/members/{memberId}/roles/{roleId}:
 *   delete:
 *     summary: Revoke a role from a member
 *     tags: [Members]
 *     responses: { 200: { description: Revoked }, 404: { description: Not found } }
 */
router.post("/:organizationId/members/:memberId/roles", requireCsrf, requireOrgPermission("members", "assign"), asyncHandler(memberCtrl.assignRole));
router.delete("/:organizationId/members/:memberId/roles/:roleId", requireCsrf, requireOrgPermission("members", "assign"), asyncHandler(memberCtrl.revokeRole));

/**
 * @openapi
 * /organizations/{organizationId}/roles:
 *   get:
 *     summary: List roles assignable within this organization
 *     tags: [Roles]
 *     responses: { 200: { description: OK } }
 * /organizations/{organizationId}/permissions:
 *   get:
 *     summary: Get the permission catalog (module groups, actions, scopes)
 *     tags: [Roles]
 *     responses: { 200: { description: OK } }
 * /organizations/{organizationId}/audit-events:
 *   get:
 *     summary: List this organization's audit events (paginated, append-only)
 *     tags: [Audit]
 *     parameters: [{ name: organizationId, in: path, required: true, schema: { type: string } }, { name: page, in: query, schema: { type: integer } }, { name: action, in: query, schema: { type: string } }]
 *     responses: { 200: { description: OK }, 404: { description: Not found } }
 */
router.get("/:organizationId/roles", requireOrgPermission("organizations", "view"), asyncHandler(roleCtrl.listOrgRoles));
router.get("/:organizationId/permissions", requireOrgPermission("organizations", "view"), asyncHandler(roleCtrl.listOrgPermissions));
router.get("/:organizationId/audit-events", requireOrgPermission("audit_events", "view"), asyncHandler(roleCtrl.listAuditEvents));

router.use("/:organizationId/invitations", orgInvitationRoutes);
router.use("/:organizationId/invite-links", orgInviteLinkRoutes);

export default router;
