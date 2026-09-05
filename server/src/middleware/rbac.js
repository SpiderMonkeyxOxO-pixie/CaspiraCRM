import prisma from "../lib/prisma.js";

// The ONE place org-scoped authorization happens. No controller should ever
// compare req.user.role to a role name directly — every mutation/query
// under /api/v1/organizations/:organizationId/* routes through here first.
//
// Deliberately 404s (not 403) when the caller has no membership in the
// target organization at all — a 403 would confirm the organization exists
// and merely isn't accessible; a 404 makes "not yours" indistinguishable
// from "doesn't exist" (see Backend Phase 1's multi-tenant security spec).
export function requireOrgPermission(moduleId, action) {
  return async (req, res, next) => {
    const { organizationId } = req.params;
    if (!organizationId) return res.status(400).json({ code: "MISSING_ORGANIZATION_ID", message: "organizationId is required." });

    // System Owner administers every organization by design (see Backend
    // Phase 1 spec's "System Owner" section) — this is the one legitimate
    // role-string check in the whole RBAC surface, and it's here, not
    // scattered through controllers.
    if (req.user.role === "Super-Admin") {
      req.membership = null;
      req.isSystemOwnerOverride = true;
      return next();
    }

    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId: req.user.id } },
      include: { roles: { include: { role: true } } },
    });

    if (!membership || membership.status === "Removed") {
      return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });
    }
    if (membership.status === "Suspended") {
      return res.status(403).json({ code: "MEMBERSHIP_SUSPENDED", message: "Your access to this organization is suspended." });
    }

    const allowed = membership.roles.some((mr) => {
      const grants = Array.isArray(mr.role.permissionGrants) ? mr.role.permissionGrants : [];
      return grants.some((g) => g.moduleId === moduleId && Array.isArray(g.actions) && g.actions.includes(action));
    });

    if (!allowed) {
      return res.status(403).json({ code: "FORBIDDEN", message: "You do not have permission to perform this action." });
    }

    req.membership = membership;
    req.isSystemOwnerOverride = false;
    next();
  };
}

// A handful of actions (granting the Organization Administrator role,
// creating a System Owner) must never be reachable through the generic
// permission check above, no matter what a Role's permissionGrants say —
// they're capability boundaries, not grantable permissions. Keys match
// prisma/seed.js's actual built-in Role.key values ("admin" is the
// Organization Administrator role — the frontend's RBAC-preview template id
// for the same role, "organization_administrator", is a display-layer
// concept and is never what's stored in Role.key).
export const NON_GRANTABLE_ROLE_KEYS = new Set(["super_admin", "admin"]);

export function canGrantRole(actingRole, targetRoleKey) {
  if (actingRole === "Super-Admin") return true;
  return !NON_GRANTABLE_ROLE_KEYS.has(targetRoleKey);
}
