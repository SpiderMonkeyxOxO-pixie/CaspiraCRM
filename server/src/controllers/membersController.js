import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../services/auditService.js";
import { canGrantRole } from "../middleware/rbac.js";

function serializeMembership(m) {
  return {
    ...toApi(m),
    user: m.user ? toApi({ id: m.user.id, name: m.user.name, email: m.user.email, username: m.user.username, avatarUrl: m.user.avatarUrl }) : undefined,
    roles: m.roles?.map((mr) => toApi(mr.role)) || undefined,
  };
}

export async function listMembers(req, res) {
  const { organizationId } = req.params;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const where = { organizationId, status: { not: "Removed" } };

  const [members, total] = await Promise.all([
    prisma.organizationMembership.findMany({
      where, include: { user: true, roles: { include: { role: true } } },
      orderBy: { createdAt: "asc" }, skip: (page - 1) * pageSize, take: pageSize,
    }),
    prisma.organizationMembership.count({ where }),
  ]);

  res.json({ members: members.map(serializeMembership), pagination: { page, pageSize, total } });
}

export async function getMember(req, res) {
  const membership = await prisma.organizationMembership.findFirst({
    where: { id: req.params.memberId, organizationId: req.params.organizationId },
    include: { user: true, roles: { include: { role: true } } },
  });
  if (!membership || membership.status === "Removed") return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });
  res.json({ member: serializeMembership(membership) });
}

// Handles suspend/reactivate via a `status` field — role assignment has its
// own dedicated endpoints below since it carries its own authorization rule
// (canGrantRole) that a generic PATCH shouldn't silently bypass.
export async function updateMember(req, res) {
  const { status } = req.body;
  const membership = await prisma.organizationMembership.findFirst({ where: { id: req.params.memberId, organizationId: req.params.organizationId } });
  if (!membership || membership.status === "Removed") return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });

  const validTransitions = { Active: ["Suspended"], Suspended: ["Active"], Invited: ["Active", "Removed"] };
  if (!status || !(validTransitions[membership.status] || []).includes(status)) {
    return res.status(400).json({ code: "INVALID_STATUS_TRANSITION", message: `Cannot move a member from ${membership.status} to ${status}.` });
  }

  const data = { status };
  if (status === "Active" && !membership.joinedAt) data.joinedAt = new Date();
  if (status === "Suspended") data.suspendedAt = new Date();

  const updated = await prisma.organizationMembership.update({ where: { id: membership.id }, data });
  await recordAuditEvent({
    ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.params.organizationId,
    action: status === "Suspended" ? "member.suspended" : "member.reactivated", targetType: "OrganizationMembership", targetId: membership.id, result: "Success",
    before: { status: membership.status }, after: { status: updated.status },
  });
  res.json({ member: toApi(updated) });
}

export async function removeMember(req, res) {
  const membership = await prisma.organizationMembership.findFirst({ where: { id: req.params.memberId, organizationId: req.params.organizationId } });
  if (!membership || membership.status === "Removed") return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });

  await prisma.organizationMembership.update({ where: { id: membership.id }, data: { status: "Removed", removedAt: new Date() } });
  await recordAuditEvent({
    ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.params.organizationId,
    action: "member.removed", targetType: "OrganizationMembership", targetId: membership.id, result: "Success",
  });
  res.json({ message: "Member removed." });
}

export async function assignRole(req, res) {
  const { roleId } = req.body;
  if (!roleId) return res.status(400).json({ code: "VALIDATION_ERROR", message: "roleId is required." });

  const membership = await prisma.organizationMembership.findFirst({ where: { id: req.params.memberId, organizationId: req.params.organizationId } });
  if (!membership || membership.status === "Removed") return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) return res.status(404).json({ code: "ROLE_NOT_FOUND", message: "Role not found." });

  // The one place an ordinary invitation/assignment path is structurally
  // blocked from ever handing out System Owner or Organization
  // Administrator — checked here regardless of what the caller's own
  // Role.permissionGrants say, since those are grantable-permission
  // records, not a list of roles safe to hand to someone else.
  if (!canGrantRole(req.user.role, role.key)) {
    await recordAuditEvent({
      ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.params.organizationId,
      action: "member.role_assign_denied", targetType: "OrganizationMembership", targetId: membership.id, result: "Denied", reason: `non_grantable_role:${role.key}`,
    });
    return res.status(403).json({ code: "ROLE_NOT_GRANTABLE", message: "This role cannot be assigned through this action." });
  }

  await prisma.membershipRole.upsert({
    where: { membershipId_roleId: { membershipId: membership.id, roleId } },
    create: { membershipId: membership.id, roleId, assignedByUserId: req.user.id },
    update: {},
  });
  await recordAuditEvent({
    ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.params.organizationId,
    action: "member.role_assigned", targetType: "OrganizationMembership", targetId: membership.id, result: "Success", after: { roleId, roleKey: role.key },
  });
  res.json({ message: "Role assigned." });
}

export async function revokeRole(req, res) {
  const { roleId } = req.params;
  const membership = await prisma.organizationMembership.findFirst({ where: { id: req.params.memberId, organizationId: req.params.organizationId } });
  if (!membership || membership.status === "Removed") return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });

  await prisma.membershipRole.deleteMany({ where: { membershipId: membership.id, roleId } });
  await recordAuditEvent({
    ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.params.organizationId,
    action: "member.role_revoked", targetType: "OrganizationMembership", targetId: membership.id, result: "Success", after: { roleId },
  });
  res.json({ message: "Role revoked." });
}
