import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";
import { ACTIONS, SCOPES, MODULE_GROUPS, APPROVAL_TYPES } from "../constants/permissionCatalog.js";
import { NON_GRANTABLE_ROLE_KEYS } from "../middleware/rbac.js";

// Roles assignable within an organization. System Owner sees every role
// (including the non-grantable ones, for visibility); everyone else only
// ever sees roles they could actually hand out — the same rule
// membersController.assignRole enforces on write is reflected here on read,
// so the UI never offers a choice the backend would reject.
export async function listOrgRoles(req, res) {
  const roles = await prisma.role.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } });
  const visible = req.isSystemOwnerOverride ? roles : roles.filter((r) => !NON_GRANTABLE_ROLE_KEYS.has(r.key));
  res.json({ roles: toApi(visible) });
}

// Permissions are not organization-specific data — this just exposes the
// same catalog constants/permissionCatalog.js already defines (and
// adminRoutes.js already serves at /admin/permissions/catalog) under the
// org-scoped path the Backend Phase 1 spec calls for.
export async function listOrgPermissions(_req, res) {
  res.json({ moduleGroups: MODULE_GROUPS, actions: ACTIONS, scopes: SCOPES, approvalTypes: APPROVAL_TYPES });
}

export async function listAuditEvents(req, res) {
  const { organizationId } = req.params;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const where = { organizationId, ...(req.query.action ? { action: req.query.action } : {}) };

  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.auditEvent.count({ where }),
  ]);
  res.json({ auditEvents: toApi(events), pagination: { page, pageSize, total } });
}
