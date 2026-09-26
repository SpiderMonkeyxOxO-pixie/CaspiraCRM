// The signed-in user's own account on the /api/v1/auth surface: profile,
// password and two-factor authentication. Replaces the legacy
// /api/v1/user/{update,change-password,2fa/*} routes, which staging and
// production switch off (legacyUserApiEnabled()).
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import prisma from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { hashToken } from "../utils/tokens.js";
import { toApi } from "../utils/serialize.js";
import { REFRESH_COOKIE } from "../utils/cookies.js";
import { recordAuditEvent, requestContext } from "../services/auditService.js";
import { recordOutboxEvent } from "../services/outboxService.js";
import { passwordChangedEmail, twoFactorChangedEmail } from "../emails/templates.js";

const publicUser = ({ passwordHash, twoFactorSecret, resetToken, resetTokenExpires, ...rest }) => toApi(rest);
const bad = (res, code, message, status = 400) => res.status(status).json({ code, message });

export const PASSWORD_MIN = 10;
// Length does most of the work; a letter and a digit rule out the most common weak choices.
export function passwordProblem(password, user) {
  const p = String(password || "");
  if (p.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (p.length > 128) return "Use at most 128 characters.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Use at least one letter and one number.";
  const lower = p.toLowerCase();
  if (user && [user.username, user.email?.split("@")[0]].some((v) => v && v.length >= 3 && lower.includes(v.toLowerCase()))) return "Don't include your username or email.";
  return null;
}

const totpOk = (secret, otp) => !!secret && /^\d{6}$/.test(String(otp || "").trim())
  && speakeasy.totp.verify({ secret, encoding: "base32", token: String(otp).trim(), window: 1 });

// PATCH /auth/me { fullName?, phone? }
export async function updateMe(req, res) {
  const data = {};
  if (req.body?.fullName !== undefined) {
    const fullName = String(req.body.fullName || "").trim().replace(/\s+/g, " ");
    if (fullName.length < 2 || fullName.length > 100) return bad(res, "VALIDATION_ERROR", "Full name must be 2–100 characters.");
    Object.assign(data, { fullName, name: fullName });
  }
  if (req.body?.phone !== undefined) {
    const phone = String(req.body.phone || "").trim();
    if (phone && !/^\+?[0-9 ()-]{5,25}$/.test(phone)) return bad(res, "VALIDATION_ERROR", "Enter a valid phone number (digits, spaces, +, - and brackets).");
    data.phone = phone || null;
  }
  if (!Object.keys(data).length) return bad(res, "VALIDATION_ERROR", "Nothing to update.");
  const user = await prisma.user.update({ where: { id: req.user.id }, data });
  await recordAuditEvent({ ...requestContext(req), actorUserId: user.id, action: "account.profile_updated", targetType: "User", targetId: user.id, result: "Success", after: { fields: Object.keys(data).filter((k) => k !== "name") } });
  res.json({ user: publicUser(user) });
}

// POST /auth/password { currentPassword, newPassword } — ends every other session.
export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body || {};
  const ctx = requestContext(req);
  if (!(await verifyPassword(req.user.passwordHash, String(currentPassword || "")))) {
    await recordAuditEvent({ ...ctx, actorUserId: req.user.id, action: "account.password_change", result: "Failure", reason: "invalid_current_password" });
    return bad(res, "INVALID_CREDENTIALS", "Your current password is not correct.", 401);
  }
  const problem = passwordProblem(newPassword, req.user);
  if (problem) return bad(res, "WEAK_PASSWORD", problem);
  if (await verifyPassword(req.user.passwordHash, String(newPassword))) return bad(res, "WEAK_PASSWORD", "Choose a password you haven't just used.");
  const passwordHash = await hashPassword(String(newPassword));
  const currentHash = req.cookies?.[REFRESH_COOKIE] ? hashToken(req.cookies[REFRESH_COOKIE]) : null;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: req.user.id }, data: { passwordHash } });
    await tx.refreshSession.updateMany({ where: { userId: req.user.id, revokedAt: null, ...(currentHash ? { tokenHash: { not: currentHash } } : {}) }, data: { revokedAt: new Date(), revokedReason: "password_changed" } });
    const { subject, html } = passwordChangedEmail({ name: req.user.name });
    await recordOutboxEvent(tx, { aggregateType: "User", aggregateId: req.user.id, eventType: "password_changed", payload: { to: req.user.email, subject, html } });
  });
  await recordAuditEvent({ ...ctx, actorUserId: req.user.id, action: "account.password_change", result: "Success" });
  res.json({ message: "Password changed. Your other sessions were signed out." });
}

// POST /auth/mfa/setup — a new secret, stored but not active until confirmed.
// Refused while 2FA is on: replacing an active secret needs disable first.
export async function mfaSetup(req, res) {
  if (req.user.twoFactorEnabled) return bad(res, "MFA_ALREADY_ENABLED", "Two-factor authentication is already on. Turn it off first to connect a new app.", 409);
  const secret = speakeasy.generateSecret({ name: `Caspira CRM (${req.user.email})`, length: 20 });
  await prisma.user.update({ where: { id: req.user.id }, data: { twoFactorSecret: secret.base32 } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, action: "account.mfa_setup_started", result: "Success" });
  res.json({ qrCode: await QRCode.toDataURL(secret.otpauth_url), secret: secret.base32 });
}

// POST /auth/mfa/enable { otp }
export async function mfaEnable(req, res) {
  const ctx = requestContext(req);
  if (req.user.twoFactorEnabled) return bad(res, "MFA_ALREADY_ENABLED", "Two-factor authentication is already on.", 409);
  if (!req.user.twoFactorSecret) return bad(res, "MFA_SETUP_REQUIRED", "Start the setup first.");
  if (!totpOk(req.user.twoFactorSecret, req.body?.otp)) {
    await recordAuditEvent({ ...ctx, actorUserId: req.user.id, action: "account.mfa_enable", result: "Failure", reason: "invalid_otp" });
    return bad(res, "MFA_INVALID", "That code is not correct. Check the time on your phone and try the newest code.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: req.user.id }, data: { twoFactorEnabled: true } });
    const { subject, html } = twoFactorChangedEmail({ name: req.user.name, enabled: true });
    await recordOutboxEvent(tx, { aggregateType: "User", aggregateId: req.user.id, eventType: "mfa_enabled", payload: { to: req.user.email, subject, html } });
  });
  await recordAuditEvent({ ...ctx, actorUserId: req.user.id, action: "account.mfa_enable", result: "Success" });
  res.json({ twoFactorEnabled: true });
}

// POST /auth/mfa/disable { otp } — needs a current code as well as a recent password check.
export async function mfaDisable(req, res) {
  const ctx = requestContext(req);
  if (!req.user.twoFactorEnabled) return bad(res, "MFA_NOT_ENABLED", "Two-factor authentication is not on.", 409);
  if (!totpOk(req.user.twoFactorSecret, req.body?.otp)) {
    await recordAuditEvent({ ...ctx, actorUserId: req.user.id, action: "account.mfa_disable", result: "Failure", reason: "invalid_otp" });
    return bad(res, "MFA_INVALID", "That code is not correct.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: req.user.id }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
    const { subject, html } = twoFactorChangedEmail({ name: req.user.name, enabled: false });
    await recordOutboxEvent(tx, { aggregateType: "User", aggregateId: req.user.id, eventType: "mfa_disabled", payload: { to: req.user.email, subject, html } });
  });
  await recordAuditEvent({ ...ctx, actorUserId: req.user.id, action: "account.mfa_disable", result: "Success" });
  res.json({ twoFactorEnabled: false });
}
