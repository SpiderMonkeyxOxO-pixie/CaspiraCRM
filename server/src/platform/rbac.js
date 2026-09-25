// Backend Phase 13 — platform RBAC and separation of duties.
//
// Platform permissions are granted through platform roles assigned to USERS
// (not organization memberships). The System Owner (user role Super-Admin)
// holds every platform permission; an Organization Administrator holds none
// unless explicitly assigned a platform role. Ordinary CRM users never get
// infrastructure operations.
import prisma from "../lib/prisma.js";
import { PlatformError, currentEnvironment, isStrictEnvironment, platformAudit } from "./common.js";

export const PLATFORM_PERMISSIONS = [
  "platform.security.read", "platform.security.manage", "platform.security.exception", "platform.security.exception_approve",
  "platform.secrets.read_metadata", "platform.secrets.rotate",
  "platform.backup.read", "platform.backup.run", "platform.backup.verify",
  "platform.restore.plan", "platform.restore.approve", "platform.restore.execute",
  "platform.dr.read", "platform.dr.manage", "platform.dr.declare",
  "platform.release.read", "platform.release.create",
  "platform.deployment.plan", "platform.deployment.approve", "platform.deployment.execute", "platform.deployment.rollback",
  "platform.health.read", "platform.vulnerability.read", "platform.vulnerability.manage",
  "platform.roles.manage", "platform.retention.manage", "platform.alerts.manage",
];

const READ = ["platform.security.read", "platform.secrets.read_metadata", "platform.backup.read", "platform.dr.read", "platform.release.read", "platform.health.read", "platform.vulnerability.read"];

export const PLATFORM_ROLES = {
  platform_security_admin: { name: "Security Administrator", permissions: [...READ, "platform.security.manage", "platform.security.exception", "platform.security.exception_approve", "platform.secrets.rotate", "platform.vulnerability.manage", "platform.dr.declare", "platform.alerts.manage"] },
  deployment_operator: { name: "Deployment Operator", permissions: ["platform.release.read", "platform.release.create", "platform.deployment.plan", "platform.deployment.execute", "platform.deployment.rollback", "platform.health.read", "platform.backup.read"] },
  change_approver: { name: "Change Approver", permissions: [...READ, "platform.deployment.approve", "platform.restore.approve", "platform.security.exception_approve"] },
  backup_operator: { name: "Backup Operator", permissions: ["platform.backup.read", "platform.backup.run", "platform.backup.verify", "platform.restore.plan", "platform.health.read"] },
  restore_operator: { name: "Restore Operator", permissions: ["platform.backup.read", "platform.restore.plan", "platform.restore.execute", "platform.dr.read", "platform.health.read"] },
  dr_coordinator: { name: "Disaster Recovery Coordinator", permissions: ["platform.dr.read", "platform.dr.manage", "platform.dr.declare", "platform.backup.read", "platform.health.read"] },
  platform_auditor: { name: "Platform Auditor", permissions: [...READ] },
};

export const isSystemOwner = (user) => user?.role === "Super-Admin";

export async function platformPermissionsFor(user) {
  if (!user) return new Set();
  if (isSystemOwner(user)) return new Set(PLATFORM_PERMISSIONS);
  const rows = await prisma.platformRoleAssignment.findMany({ where: { userId: user.id, revokedAt: null } });
  return new Set(rows.flatMap((r) => PLATFORM_ROLES[r.roleKey]?.permissions || []));
}

// Middleware: any one of the listed permissions opens the route. Denials are
// audited (repeated authorization failures are a security signal).
export function requirePlatform(...permissions) {
  return async (req, res, next) => {
    const perms = await platformPermissionsFor(req.user);
    req.platformPermissions = perms;
    if (permissions.some((p) => perms.has(p))) return next();
    await platformAudit(req, "access_denied", "PlatformRoute", req.originalUrl.split("?")[0], { result: "Denied", reason: permissions.join("|") });
    return res.status(403).json({ code: "PLATFORM_FORBIDDEN", message: "Your account doesn't have this platform permission.", correlationId: req.correlationId });
  };
}

export const has = (req, permission) => !!req.platformPermissions?.has(permission);

// Requester and approver must be different people. When staffing makes that
// impossible, an explicit, recorded exception is required (and allowed only
// when PLATFORM_ALLOW_SINGLE_OPERATOR=true).
export async function assertSeparation(req, requesterUserId, what, exceptionReason) {
  if (requesterUserId !== req.user.id) return null;
  const allowed = process.env.PLATFORM_ALLOW_SINGLE_OPERATOR === "true";
  const reason = String(exceptionReason || "").trim();
  if (!allowed || reason.length < 10) {
    throw new PlatformError(403, "SEPARATION_OF_DUTIES", `The person who requested this ${what} can't approve it. Another authorized approver is required${allowed ? " (or record a staffing exception of at least 10 characters)" : ""}.`);
  }
  await platformAudit(req, "separation_exception", what, null, { result: "Success", reason, after: { environment: currentEnvironment(), strict: isStrictEnvironment() } });
  return reason;
}

export async function grantPlatformRole(req, userId, roleKey, reason) {
  if (!PLATFORM_ROLES[roleKey]) throw new PlatformError(422, "UNKNOWN_ROLE", `Unknown platform role. Use one of: ${Object.keys(PLATFORM_ROLES).join(", ")}.`);
  const user = await prisma.user.findUnique({ where: { id: String(userId) } });
  if (!user) throw new PlatformError(404, "NOT_FOUND", "User not found.");
  const row = await prisma.platformRoleAssignment.upsert({
    where: { userId_roleKey: { userId: user.id, roleKey } },
    update: { revokedAt: null, grantedByUserId: req.user.id, reason: String(reason || "").slice(0, 300) },
    create: { userId: user.id, roleKey, grantedByUserId: req.user.id, reason: String(reason || "").slice(0, 300) },
  });
  await platformAudit(req, "role_granted", "PlatformRoleAssignment", row.id, { after: { userId: user.id, roleKey } });
  return row;
}

export async function revokePlatformRole(req, userId, roleKey) {
  const row = await prisma.platformRoleAssignment.findUnique({ where: { userId_roleKey: { userId: String(userId), roleKey } } });
  if (!row || row.revokedAt) throw new PlatformError(404, "NOT_FOUND", "Role assignment not found.");
  await prisma.platformRoleAssignment.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  await platformAudit(req, "role_revoked", "PlatformRoleAssignment", row.id, { after: { userId, roleKey } });
  return { ok: true };
}
