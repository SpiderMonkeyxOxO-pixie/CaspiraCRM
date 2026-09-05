import { Router } from "express";
import { asyncHandler } from "../utils/crudFactory.js";
import { authenticateCookie } from "../controllers/auth2Controller.js";
import { requireOrgPermission } from "../middleware/rbac.js";
import { requireCsrf } from "../middleware/csrf.js";
import * as orgCtrl from "../controllers/organizationsController.js";
import * as memberCtrl from "../controllers/membersController.js";
import * as roleCtrl from "../controllers/orgRolesController.js";

const router = Router();

router.use(authenticateCookie);

router.get("/", asyncHandler(orgCtrl.listOrganizations));
router.post("/", requireCsrf, asyncHandler(orgCtrl.createOrganization));
router.get("/:organizationId", requireOrgPermission("organizations", "view"), asyncHandler(orgCtrl.getOrganization));
router.patch("/:organizationId", requireCsrf, requireOrgPermission("organizations", "edit"), asyncHandler(orgCtrl.updateOrganization));

router.get("/:organizationId/members", requireOrgPermission("members", "view"), asyncHandler(memberCtrl.listMembers));
router.get("/:organizationId/members/:memberId", requireOrgPermission("members", "view"), asyncHandler(memberCtrl.getMember));
router.patch("/:organizationId/members/:memberId", requireCsrf, requireOrgPermission("members", "edit"), asyncHandler(memberCtrl.updateMember));
router.delete("/:organizationId/members/:memberId", requireCsrf, requireOrgPermission("members", "delete_permanently"), asyncHandler(memberCtrl.removeMember));
router.post("/:organizationId/members/:memberId/roles", requireCsrf, requireOrgPermission("members", "assign"), asyncHandler(memberCtrl.assignRole));
router.delete("/:organizationId/members/:memberId/roles/:roleId", requireCsrf, requireOrgPermission("members", "assign"), asyncHandler(memberCtrl.revokeRole));

router.get("/:organizationId/roles", requireOrgPermission("organizations", "view"), asyncHandler(roleCtrl.listOrgRoles));
router.get("/:organizationId/permissions", requireOrgPermission("organizations", "view"), asyncHandler(roleCtrl.listOrgPermissions));
router.get("/:organizationId/audit-events", requireOrgPermission("audit_events", "view"), asyncHandler(roleCtrl.listAuditEvents));

export default router;
