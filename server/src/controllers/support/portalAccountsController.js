// Backend Phase 4 — Customer Portal accounts, managed by staff.
// An administrator links a portal login to exactly one Contact (and that
// Contact's Company). The customer never chooses their own contact or
// company, and a portal account never grants organization-member access.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hashPassword } from "../../utils/password.js";
import { generateRawToken, hashToken } from "../../utils/tokens.js";
import { recordOutboxEvent } from "../../services/outboxService.js";
import { sanitizeText, invalid, notFound, versionConflict, staleVersion, audit } from "../../services/support/supportCommon.js";

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const INVITE_TTL_MS = (Number(process.env.INVITATION_TTL_DAYS) || 7) * 24 * 60 * 60 * 1000;
const who = (req) => req.membership?.id || null;

// Never returns the linked user's password or tokens.
const serialize = (account) => ({ ...toApi(account), user: account.user ? { _id: account.user.id, name: account.user.name, email: account.user.email } : undefined });
const INCLUDE = { user: { select: { id: true, name: true, email: true } } };

export async function list(req, res) {
  const where = { organizationId: req.organizationId };
  if (req.query.status) where.status = req.query.status;
  if (req.query.companyId) where.companyId = req.query.companyId;
  const accounts = await prisma.portalAccount.findMany({ where, include: INCLUDE, orderBy: { createdAt: "desc" } });
  res.json({ portalAccounts: accounts.map(serialize) });
}

// POST { contactId, email?, name?, companyWideAccess? } — creates (or reuses)
// the customer's login, links it, and emails a set-your-password link
// (Mailpit in development; nothing is delivered in production until a real
// provider is configured).
export async function create(req, res) {
  const contact = req.body.contactId && (await prisma.contact.findFirst({ where: { id: req.body.contactId, organizationId: req.organizationId } }));
  if (!contact) return invalid(res, "contactId must be a contact in this organization.");
  const email = String(req.body.email || contact.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid(res, "A valid email address is required (the contact has none).");
  if (await prisma.portalAccount.findFirst({ where: { organizationId: req.organizationId, contactId: contact.id } })) return invalid(res, "This contact already has portal access.");

  let user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (user) {
    // Staff of this organization can't also be its customers.
    const member = await prisma.organizationMembership.findFirst({ where: { organizationId: req.organizationId, userId: user.id } });
    if (member) return invalid(res, "That email belongs to a member of this organization — portal access is for customers only.");
    if (await prisma.portalAccount.findFirst({ where: { organizationId: req.organizationId, userId: user.id } })) return invalid(res, "That login already has portal access here.");
  }
  const name = sanitizeText(req.body.name || contact.name || email, { max: 120 });
  const rawToken = generateRawToken();

  const account = await prisma.$transaction(async (tx) => {
    if (!user) {
      user = await tx.user.create({
        data: {
          name, fullName: name, email, role: "Customer", status: "Active",
          username: `portal-${email.split("@")[0].replace(/[^a-z0-9]/gi, "").slice(0, 20)}-${crypto.randomBytes(3).toString("hex")}`,
          // Unusable until the customer sets their own password.
          passwordHash: await hashPassword(crypto.randomBytes(32).toString("hex")),
        },
      });
    }
    const created = await tx.portalAccount.create({
      data: {
        organizationId: req.organizationId, userId: user.id, contactId: contact.id, companyId: contact.companyId || null,
        companyWideAccess: Boolean(req.body.companyWideAccess), status: "Invited", createdByMembershipId: who(req),
      },
      include: INCLUDE,
    });
    await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
    await recordOutboxEvent(tx, {
      aggregateType: "PortalAccount", aggregateId: created.id, eventType: "portal_invitation",
      payload: {
        to: email, subject: "Your support portal access",
        html: `<p>Hello ${name},</p><p>You've been given access to our support portal. Set your password here: <a href="${CLIENT_ORIGIN}/reset-password?token=${rawToken}">set password</a></p>`,
      },
    });
    return created;
  });
  await audit(req, "support.portal_account.linked", "PortalAccount", account.id, { after: { contactId: contact.id, companyId: contact.companyId, companyWideAccess: account.companyWideAccess } });
  res.status(201).json({ portalAccount: serialize(account) });
}

export async function update(req, res) {
  const existing = await prisma.portalAccount.findFirst({ where: { id: req.params.accountId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Portal account");
  if (staleVersion(req.body, existing)) return versionConflict(res, "portal account");
  if (!("companyWideAccess" in req.body)) return invalid(res, "Only companyWideAccess can be changed here.");
  const account = await prisma.portalAccount.update({ where: { id: existing.id }, data: { companyWideAccess: Boolean(req.body.companyWideAccess), version: { increment: 1 } }, include: INCLUDE });
  await audit(req, "support.portal_account.updated", "PortalAccount", account.id, { before: { companyWideAccess: existing.companyWideAccess }, after: { companyWideAccess: account.companyWideAccess } });
  res.json({ portalAccount: serialize(account) });
}

// Suspension takes effect on the customer's very next request.
export async function suspend(req, res) {
  const reason = sanitizeText(req.body.reason || "", { max: 500 });
  if (!reason) return invalid(res, "A reason is required to suspend portal access.");
  const existing = await prisma.portalAccount.findFirst({ where: { id: req.params.accountId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Portal account");
  if (existing.status === "Suspended") return invalid(res, "This portal account is already suspended.");
  const account = await prisma.portalAccount.update({ where: { id: existing.id }, data: { status: "Suspended", suspendedAt: new Date(), suspensionReason: reason, version: { increment: 1 } }, include: INCLUDE });
  await audit(req, "support.portal_account.suspended", "PortalAccount", account.id, { reason });
  res.json({ portalAccount: serialize(account) });
}

export async function reactivate(req, res) {
  const existing = await prisma.portalAccount.findFirst({ where: { id: req.params.accountId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Portal account");
  if (existing.status !== "Suspended") return invalid(res, "Only a suspended portal account can be reactivated.");
  const account = await prisma.portalAccount.update({
    where: { id: existing.id },
    data: { status: existing.activatedAt ? "Active" : "Invited", suspendedAt: null, suspensionReason: null, version: { increment: 1 } },
    include: INCLUDE,
  });
  await audit(req, "support.portal_account.reactivated", "PortalAccount", account.id);
  res.json({ portalAccount: serialize(account) });
}
