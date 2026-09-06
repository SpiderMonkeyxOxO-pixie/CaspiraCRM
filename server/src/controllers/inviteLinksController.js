import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";
import { generateRawToken, hashToken, isExpired } from "../utils/tokens.js";
import { hashPassword } from "../utils/password.js";
import { recordAuditEvent, requestContext } from "../services/auditService.js";
import { recordOutboxEvent } from "../services/outboxService.js";
import { canGrantRole } from "../middleware/rbac.js";
import { inviteLinkAcceptedEmail, newMembershipEmail } from "../emails/templates.js";
import { issueSessionCookies } from "./auth2SessionHelper.js";

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

function serializeLink(link) {
  const { tokenHash, ...rest } = link;
  return toApi(rest);
}

export async function createInviteLink(req, res) {
  const { defaultRoleId, expiresInDays, maxUses, allowedDomains, requiresApproval } = req.body;
  const { organizationId } = req.params;
  if (!defaultRoleId) return res.status(400).json({ code: "VALIDATION_ERROR", message: "defaultRoleId is required." });

  const role = await prisma.role.findUnique({ where: { id: defaultRoleId } });
  if (!role) return res.status(404).json({ code: "ROLE_NOT_FOUND", message: "Role not found." });
  // Invite links are inherently lower-trust than a named invitation (anyone
  // with the URL can use them) — never permit them to hand out a
  // capability boundary role, same rule as an ordinary invitation.
  if (!canGrantRole(req.user.role, role.key)) {
    return res.status(403).json({ code: "ROLE_NOT_GRANTABLE", message: "This role cannot be used as an invite link's default role." });
  }

  const rawToken = generateRawToken();
  const link = await prisma.organizationInviteLink.create({
    data: {
      organizationId, tokenHash: hashToken(rawToken), defaultRoleId,
      expiresAt: expiresInDays ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000) : null,
      maxUses: maxUses ? Number(maxUses) : null,
      allowedDomains: Array.isArray(allowedDomains) ? allowedDomains.map((d) => d.toLowerCase()) : [],
      requiresApproval: !!requiresApproval,
      createdByUserId: req.user.id,
    },
  });

  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId, action: "invite_link.created", targetType: "OrganizationInviteLink", targetId: link.id, result: "Success" });
  res.status(201).json({ inviteLink: serializeLink(link), joinUrl: `${CLIENT_ORIGIN}/join/${rawToken}` });
}

export async function listInviteLinks(req, res) {
  const links = await prisma.organizationInviteLink.findMany({ where: { organizationId: req.params.organizationId }, orderBy: { createdAt: "desc" } });
  res.json({ inviteLinks: links.map(serializeLink) });
}

export async function rotateInviteLink(req, res) {
  const link = await prisma.organizationInviteLink.findFirst({ where: { id: req.params.linkId, organizationId: req.params.organizationId } });
  if (!link) return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });

  const rawToken = generateRawToken();
  const updated = await prisma.organizationInviteLink.update({ where: { id: link.id }, data: { tokenHash: hashToken(rawToken) } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.params.organizationId, action: "invite_link.rotated", targetType: "OrganizationInviteLink", targetId: link.id, result: "Success" });
  res.json({ inviteLink: serializeLink(updated), joinUrl: `${CLIENT_ORIGIN}/join/${rawToken}` });
}

export async function revokeInviteLink(req, res) {
  const link = await prisma.organizationInviteLink.findFirst({ where: { id: req.params.linkId, organizationId: req.params.organizationId } });
  if (!link) return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });

  const updated = await prisma.organizationInviteLink.update({ where: { id: link.id }, data: { status: "Revoked", revokedAt: new Date(), revokedByUserId: req.user.id } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.params.organizationId, action: "invite_link.revoked", targetType: "OrganizationInviteLink", targetId: link.id, result: "Success" });
  res.json({ inviteLink: serializeLink(updated) });
}

// --- Public endpoints ---

export async function validateJoinToken(req, res) {
  const link = await prisma.organizationInviteLink.findUnique({ where: { tokenHash: hashToken(req.params.token) } });
  if (!link || link.status !== "Active" || (link.expiresAt && isExpired(link.expiresAt)) || (link.maxUses && link.useCount >= link.maxUses)) {
    return res.status(404).json({ code: "INVALID_LINK", message: "This invite link is invalid, expired, or has reached its use limit." });
  }
  const [organization, role] = await Promise.all([
    prisma.organization.findUnique({ where: { id: link.organizationId } }),
    prisma.role.findUnique({ where: { id: link.defaultRoleId } }),
  ]);
  res.json({ organizationName: organization.name, roleName: role.name, allowedDomains: link.allowedDomains });
}

export async function acceptJoinToken(req, res) {
  const { email, name, password } = req.body;
  const tokenHash = hashToken(req.params.token);

  const result = await prisma.$transaction(async (tx) => {
    const link = await tx.organizationInviteLink.findUnique({ where: { tokenHash } });
    if (!link || link.status !== "Active" || (link.expiresAt && isExpired(link.expiresAt))) {
      return { error: { status: 404, code: "INVALID_LINK", message: "This invite link is invalid or has expired." } };
    }

    const effectiveEmail = (req.user?.email || email || "").trim().toLowerCase();
    if (!effectiveEmail) return { error: { status: 400, code: "VALIDATION_ERROR", message: "email is required." } };

    if (link.allowedDomains?.length) {
      const domain = effectiveEmail.split("@")[1];
      if (!link.allowedDomains.includes(domain)) {
        await recordAuditEvent({ tx, ...requestContext(req), organizationId: link.organizationId, action: "invite_link.rejected", targetType: "OrganizationInviteLink", targetId: link.id, result: "Denied", reason: "domain_not_allowed" });
        return { error: { status: 403, code: "DOMAIN_NOT_ALLOWED", message: "This email domain is not permitted to join via this link." } };
      }
    }

    // Atomically enforce max-uses: only succeeds while useCount is still
    // below the limit (or unlimited), so two simultaneous acceptances can
    // never both slip through a "1 use left" link.
    const claim = await tx.organizationInviteLink.updateMany({
      where: { id: link.id, status: "Active", ...(link.maxUses ? { useCount: { lt: link.maxUses } } : {}) },
      data: { useCount: { increment: 1 } },
    });
    if (claim.count === 0) return { error: { status: 409, code: "LINK_EXHAUSTED", message: "This invite link has reached its use limit." } };

    const organization = await tx.organization.findUnique({ where: { id: link.organizationId } });
    const role = await tx.role.findUnique({ where: { id: link.defaultRoleId } });

    let user = req.user;
    if (!user) {
      user = await tx.user.findFirst({ where: { email: { equals: effectiveEmail, mode: "insensitive" } } });
      if (!user) {
        if (!name?.trim() || !password) return { error: { status: 400, code: "VALIDATION_ERROR", message: "name and password are required to create your account." } };
        user = await tx.user.create({
          data: { name: name.trim(), fullName: name.trim(), username: effectiveEmail.split("@")[0] + "-" + link.id.slice(-6), email: effectiveEmail, passwordHash: await hashPassword(password), role: "User", emailVerifiedAt: new Date() },
        });
      }
    }

    const membershipStatus = link.requiresApproval ? "Invited" : "Active";
    const membership = await tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: link.organizationId, userId: user.id } },
      create: { organizationId: link.organizationId, userId: user.id, status: membershipStatus, joinedAt: link.requiresApproval ? null : new Date() },
      update: {},
    });
    await tx.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: link.defaultRoleId } },
      create: { membershipId: membership.id, roleId: link.defaultRoleId, assignedByUserId: link.createdByUserId },
      update: {},
    });

    const notifyRecipient = organization.createdByUserId ? await tx.user.findUnique({ where: { id: organization.createdByUserId } }) : null;
    if (notifyRecipient) {
      const { subject: notifySubject, html: notifyHtml } = inviteLinkAcceptedEmail({ organizationName: organization.name, memberEmail: user.email, memberName: user.name });
      await recordOutboxEvent(tx, { aggregateType: "OrganizationInviteLink", aggregateId: link.id, eventType: "invite_link_accepted", payload: { to: notifyRecipient.email, subject: notifySubject, html: notifyHtml } });
    }

    if (!link.requiresApproval) {
      const { subject, html } = newMembershipEmail({ name: user.name, organizationName: organization.name, roleName: role.name });
      await recordOutboxEvent(tx, { aggregateType: "OrganizationMembership", aggregateId: membership.id, eventType: "new_membership", payload: { to: user.email, subject, html } });
    }

    return { user, wasAlreadyLoggedIn: !!req.user, organizationId: link.organizationId, linkId: link.id, pendingApproval: link.requiresApproval };
  });

  if (result.error) return res.status(result.error.status).json({ code: result.error.code, message: result.error.message });

  await recordAuditEvent({ ...requestContext(req), actorUserId: result.user.id, organizationId: result.organizationId, action: "invite_link.accepted", targetType: "OrganizationInviteLink", targetId: result.linkId, result: "Success" });

  if (!result.wasAlreadyLoggedIn) await issueSessionCookies(res, result.user, requestContext(req));
  res.json({ message: result.pendingApproval ? "Request to join submitted — awaiting administrator approval." : "Joined organization.", organizationId: result.organizationId });
}
