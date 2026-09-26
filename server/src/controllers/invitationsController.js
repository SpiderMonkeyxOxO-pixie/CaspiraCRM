import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";
import { generateRawToken, hashToken, isExpired } from "../utils/tokens.js";
import { hashPassword } from "../utils/password.js";
import { recordAuditEvent, requestContext } from "../services/auditService.js";
import { recordOutboxEvent } from "../services/outboxService.js";
import { canGrantRole } from "../middleware/rbac.js";
import { invitationEmail, newMembershipEmail } from "../emails/templates.js";
import { issueSessionCookies } from "./auth2SessionHelper.js";
import { passwordProblem } from "./accountController.js";

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const DEFAULT_INVITATION_TTL_DAYS = Number(process.env.INVITATION_TTL_DAYS) || 7;

// The accept link is emailed, and also returned once to the inviter so they
// can send it themselves when email isn't set up. It is no more exposed than
// an invite link's joinUrl, which the same admins already receive.
const acceptUrlFor = (rawToken) => `${CLIENT_ORIGIN}/invitations/${rawToken}/accept`;

function serializeInvitation(inv) {
  // The raw token NEVER appears here — only its presence/expiry/status.
  const { tokenHash, ...rest } = inv;
  return toApi(rest);
}

export async function createInvitation(req, res) {
  const { email, roleId, department, team, message, expiresInDays } = req.body;
  const { organizationId } = req.params;
  if (!email?.trim() || !roleId) return res.status(400).json({ code: "VALIDATION_ERROR", message: "email and roleId are required." });

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) return res.status(404).json({ code: "ROLE_NOT_FOUND", message: "Role not found." });
  if (!canGrantRole(req.user.role, role.key)) {
    return res.status(403).json({ code: "ROLE_NOT_GRANTABLE", message: "This role cannot be granted through an invitation." });
  }

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  const normalizedEmail = email.trim().toLowerCase();
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + (Number(expiresInDays) || DEFAULT_INVITATION_TTL_DAYS) * 24 * 60 * 60 * 1000);

  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.invitation.create({
      data: {
        organizationId, email: normalizedEmail, invitedByUserId: req.user.id, roleId,
        department: department || null, team: team || null, message: message || null,
        tokenHash: hashToken(rawToken), expiresAt,
      },
    });
    const { subject, html } = invitationEmail({
      organizationName: organization.name, inviterName: req.user.name, roleName: role.name,
      acceptUrl: acceptUrlFor(rawToken), expiresAt,
    });
    await recordOutboxEvent(tx, { aggregateType: "Invitation", aggregateId: created.id, eventType: "invitation_created", payload: { to: normalizedEmail, subject, html } });
    return created;
  });

  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId, action: "invitation.created", targetType: "Invitation", targetId: invitation.id, result: "Success" });
  res.status(201).json({ invitation: serializeInvitation(invitation), acceptUrl: acceptUrlFor(rawToken) });
}

export async function listInvitations(req, res) {
  const { organizationId } = req.params;
  const invitations = await prisma.invitation.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  res.json({ invitations: invitations.map(serializeInvitation) });
}

export async function resendInvitation(req, res) {
  const invitation = await prisma.invitation.findFirst({ where: { id: req.params.invitationId, organizationId: req.params.organizationId } });
  if (!invitation) return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });
  if (invitation.status !== "Pending") return res.status(400).json({ code: "INVALID_STATE", message: `Cannot resend a ${invitation.status.toLowerCase()} invitation.` });

  const [organization, role] = await Promise.all([
    prisma.organization.findUnique({ where: { id: invitation.organizationId } }),
    prisma.role.findUnique({ where: { id: invitation.roleId } }),
  ]);
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + DEFAULT_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const updated = await prisma.$transaction(async (tx) => {
    // Rotating the token invalidates the old one outright — a resend is not
    // "send another copy of the same link."
    const next = await tx.invitation.update({ where: { id: invitation.id }, data: { tokenHash: hashToken(rawToken), expiresAt } });
    const { subject, html } = invitationEmail({
      organizationName: organization.name, inviterName: req.user.name, roleName: role.name,
      acceptUrl: acceptUrlFor(rawToken), expiresAt,
    });
    await recordOutboxEvent(tx, { aggregateType: "Invitation", aggregateId: invitation.id, eventType: "invitation_resent", payload: { to: invitation.email, subject, html } });
    return next;
  });

  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.params.organizationId, action: "invitation.resent", targetType: "Invitation", targetId: invitation.id, result: "Success" });
  res.json({ invitation: serializeInvitation(updated), acceptUrl: acceptUrlFor(rawToken) });
}

export async function revokeInvitation(req, res) {
  const invitation = await prisma.invitation.findFirst({ where: { id: req.params.invitationId, organizationId: req.params.organizationId } });
  if (!invitation) return res.status(404).json({ code: "NOT_FOUND", message: "Not found." });
  if (invitation.status !== "Pending") return res.status(400).json({ code: "INVALID_STATE", message: `Cannot revoke a ${invitation.status.toLowerCase()} invitation.` });

  const updated = await prisma.invitation.update({ where: { id: invitation.id }, data: { status: "Revoked", revokedAt: new Date(), revokedByUserId: req.user.id } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.params.organizationId, action: "invitation.revoked", targetType: "Invitation", targetId: invitation.id, result: "Success" });
  res.json({ invitation: serializeInvitation(updated) });
}

// --- Public endpoints (no org-scoped auth — the invitee isn't a member yet) ---

export async function validateInvitationToken(req, res) {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(req.params.token) } });
  if (!invitation || invitation.status !== "Pending" || isExpired(invitation.expiresAt)) {
    return res.status(404).json({ code: "INVALID_INVITATION", message: "This invitation link is invalid or has expired." });
  }
  const [organization, role] = await Promise.all([
    prisma.organization.findUnique({ where: { id: invitation.organizationId } }),
    prisma.role.findUnique({ where: { id: invitation.roleId } }),
  ]);
  res.json({ organizationName: organization.name, roleName: role.name, email: invitation.email });
}

export async function acceptInvitation(req, res) {
  const { name, password } = req.body;
  const tokenHash = hashToken(req.params.token);

  // Check the new account's details before the transaction: an error
  // returned from inside it would still commit the claim and use up the
  // invitation.
  const pending = await prisma.invitation.findUnique({ where: { tokenHash } });
  if (pending && !(await prisma.user.findFirst({ where: { email: { equals: pending.email, mode: "insensitive" } } }))) {
    if (!name?.trim() || !password) return res.status(400).json({ code: "VALIDATION_ERROR", message: "name and password are required to create your account." });
    const weak = passwordProblem(password, { email: pending.email });
    if (weak) return res.status(400).json({ code: "WEAK_PASSWORD", message: weak });
  }

  const result = await prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({ where: { tokenHash } });
    if (!invitation || isExpired(invitation.expiresAt)) return { error: { status: 404, code: "INVALID_INVITATION", message: "This invitation link is invalid or has expired." } };

    // Atomic, concurrency-safe: only the FIRST request to reach here for a
    // still-Pending invitation succeeds; a simultaneous second acceptance
    // attempt updates zero rows and is rejected, so a token can never
    // create two memberships.
    const claim = await tx.invitation.updateMany({ where: { id: invitation.id, status: "Pending" }, data: { status: "Accepted", acceptedAt: new Date() } });
    if (claim.count === 0) return { error: { status: 409, code: "ALREADY_ACCEPTED", message: "This invitation has already been used." } };

    const organization = await tx.organization.findUnique({ where: { id: invitation.organizationId } });
    const role = await tx.role.findUnique({ where: { id: invitation.roleId } });

    let user = await tx.user.findFirst({ where: { email: { equals: invitation.email, mode: "insensitive" } } });
    if (user) {
      // An account already exists — require the caller to already be
      // authenticated as that exact user rather than accepting a password
      // in this request body as "proof," which would let this endpoint be
      // used to test passwords against arbitrary existing accounts.
      if (!req.user || req.user.id !== user.id) {
        return { error: { status: 409, code: "ACCOUNT_EXISTS", message: "An account already exists for this email. Please log in, then accept this invitation." } };
      }
    } else {
      if (!name?.trim() || !password) return { error: { status: 400, code: "VALIDATION_ERROR", message: "name and password are required to create your account." } };
      user = await tx.user.create({
        data: { name: name.trim(), fullName: name.trim(), username: invitation.email.split("@")[0] + "-" + invitation.id.slice(-6), email: invitation.email, passwordHash: await hashPassword(password), role: "User", emailVerifiedAt: new Date() },
      });
    }

    const membership = await tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: invitation.organizationId, userId: user.id } },
      create: { organizationId: invitation.organizationId, userId: user.id, status: "Active", invitedAt: invitation.createdAt, joinedAt: new Date() },
      update: { status: "Active", joinedAt: new Date() },
    });
    await tx.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: invitation.roleId } },
      create: { membershipId: membership.id, roleId: invitation.roleId, assignedByUserId: invitation.invitedByUserId },
      update: {},
    });
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedByUserId: user.id } });

    const { subject, html } = newMembershipEmail({ name: user.name, organizationName: organization.name, roleName: role.name });
    await recordOutboxEvent(tx, { aggregateType: "OrganizationMembership", aggregateId: membership.id, eventType: "new_membership", payload: { to: user.email, subject, html } });

    return { user, organizationId: invitation.organizationId, invitationId: invitation.id };
  });

  if (result.error) return res.status(result.error.status).json({ code: result.error.code, message: result.error.message });

  await recordAuditEvent({ ...requestContext(req), actorUserId: result.user.id, organizationId: result.organizationId, action: "invitation.accepted", targetType: "Invitation", targetId: result.invitationId, result: "Success" });

  // A brand-new user is logged straight in (smooth first-run experience);
  // an existing user was already authenticated to get past the check above.
  if (!req.user) await issueSessionCookies(res, result.user, requestContext(req));
  res.json({ message: "Invitation accepted.", organizationId: result.organizationId });
}
