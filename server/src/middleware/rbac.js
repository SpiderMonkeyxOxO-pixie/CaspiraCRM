import prisma from "../lib/prisma.js";

// Shared by both requireOrgPermission (path-based :organizationId, Backend
// Phase 1's /api/v1/organizations/* surface) and requireCrmOrgPermission
// (no :organizationId segment, Backend Phase 2's /api/v1/crm/* surface) —
// one real authorization decision, reused by two different ways of naming
// which organization the request is about. Never call this with an
// organizationId that hasn't itself been validated as non-empty first.
export async function authorizeOrgAccess(user, organizationId, moduleId, action) {
  // System Owner administers every organization by design (see Backend
  // Phase 1 spec's "System Owner" section) — this is the one legitimate
  // role-string check in the whole RBAC surface, and it's here, not
  // scattered through controllers.
  const membership = await prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId: user.id } },
    include: { roles: { include: { role: true } } },
  });

  // The override grants access, but when the System Owner is also a member
  // of this organization their membership is still attached, so records
  // they create are attributed to them (notes require an author membership).
  if (user.role === "Super-Admin") {
    return { ok: true, membership: membership && membership.status === "Active" ? membership : null, isSystemOwnerOverride: true };
  }

  // Deliberately 404s (not 403) when the caller has no membership in the
  // target organization at all — a 403 would confirm the organization
  // exists and merely isn't accessible; a 404 makes "not yours"
  // indistinguishable from "doesn't exist."
  if (!membership || membership.status === "Removed") {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found." };
  }
  if (membership.status === "Suspended") {
    return { ok: false, status: 403, code: "MEMBERSHIP_SUSPENDED", message: "Your access to this organization is suspended." };
  }

  const allowed = membership.roles.some((mr) => {
    const grants = Array.isArray(mr.role.permissionGrants) ? mr.role.permissionGrants : [];
    return grants.some((g) => g.moduleId === moduleId && Array.isArray(g.actions) && g.actions.includes(action));
  });
  if (!allowed) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "You do not have permission to perform this action." };
  }

  return { ok: true, membership, isSystemOwnerOverride: false };
}

// The ONE place org-scoped authorization happens for path-based routes. No
// controller should ever compare req.user.role to a role name directly —
// every mutation/query under /api/v1/organizations/:organizationId/* routes
// through here first.
export function requireOrgPermission(moduleId, action) {
  return async (req, res, next) => {
    const { organizationId } = req.params;
    if (!organizationId) return res.status(400).json({ code: "MISSING_ORGANIZATION_ID", message: "organizationId is required." });

    const result = await authorizeOrgAccess(req.user, organizationId, moduleId, action);
    if (!result.ok) return res.status(result.status).json({ code: result.code, message: result.message });

    req.membership = result.membership;
    req.isSystemOwnerOverride = result.isSystemOwnerOverride;
    next();
  };
}

// The CRM surface (/api/v1/crm/*) has no :organizationId path segment —
// this resolves it from the query string (GET) or request body (mutations)
// instead, but runs it through the EXACT SAME membership/grant check as the
// path-based version above. A client-supplied organizationId is NEVER
// trusted on its own; it only ever determines WHICH membership row gets
// looked up, and every subsequent query in the controller must still use
// req.organizationId, never re-read the raw request value.
export function requireCrmOrgPermission(moduleId, action) {
  return async (req, res, next) => {
    const organizationId = req.body?.organizationId || req.query.organizationId || req.headers["x-organization-id"];
    if (!organizationId) return res.status(400).json({ code: "MISSING_ORGANIZATION_ID", message: "organizationId is required (query param, body field, or X-Organization-Id header)." });

    const result = await authorizeOrgAccess(req.user, organizationId, moduleId, action);
    if (!result.ok) return res.status(result.status).json({ code: result.code, message: result.message });

    req.organizationId = organizationId;
    req.membership = result.membership;
    req.isSystemOwnerOverride = result.isSystemOwnerOverride;
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
