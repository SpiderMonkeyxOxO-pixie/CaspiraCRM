// Session-based auth for the new /api/v1/auth/* surface — httpOnly cookies,
// rotating refresh sessions, reuse detection. Entirely separate from
// authController.js's Bearer-JWT /api/v1/user/* flow, which is untouched
// and keeps working for every existing CRM/Sales/Support/AI route.
import speakeasy from "speakeasy";
import prisma from "../lib/prisma.js";
import { verifyToken } from "../utils/jwt.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { generateRawToken, hashToken, isExpired } from "../utils/tokens.js";
import { toApi } from "../utils/serialize.js";
import {
  ACCESS_COOKIE, REFRESH_COOKIE, setAccessCookie, setRefreshCookie, setCsrfCookie, clearAuthCookies,
  REFRESH_TOKEN_TTL_MS,
} from "../utils/cookies.js";
import { recordAuditEvent, requestContext } from "../services/auditService.js";
import { recordOutboxEvent } from "../services/outboxService.js";
import { passwordResetEmail, passwordChangedEmail, suspiciousRefreshReuseEmail } from "../emails/templates.js";
import { issueSessionCookies, accessTokenFor, idleExpiry } from "./auth2SessionHelper.js";

// Backend Phase 13 — a failed login costs the same whether or not the
// account exists (a real password hash is always verified), so response
// timing can't enumerate accounts.
let dummyHash = null;
const equalizeCost = async (password) => { dummyHash ||= await hashPassword("caspira-timing-equalizer-not-a-password"); await verifyPassword(dummyHash, password || "x"); };

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

function publicUser(user) {
  const { passwordHash, twoFactorSecret, resetToken, resetTokenExpires, ...rest } = user;
  return toApi(rest);
}

export async function login(req, res) {
  // `username` is accepted as an alternative identifier so the existing
  // Login page (which has always asked for a username) works unchanged in
  // backend-auth mode. Same generic failure either way — never reveals
  // which identifiers exist.
  const { email, username, password } = req.body;
  const identifier = (email || username || "").trim();
  const ctx = requestContext(req);
  const genericFailure = () => res.status(401).json({ code: "INVALID_CREDENTIALS", message: "Invalid email or password." });

  if (!identifier || !password) return res.status(400).json({ code: "VALIDATION_ERROR", message: "Email and password are required." });

  const user = await prisma.user.findFirst({
    where: identifier.includes("@")
      ? { email: { equals: identifier.toLowerCase(), mode: "insensitive" } }
      : { username: { equals: identifier, mode: "insensitive" } },
  });

  if (!user || user.status !== "Active") {
    await equalizeCost(password);
    await recordAuditEvent({ ...ctx, action: "auth.login", result: "Failure", reason: "invalid_credentials" });
    return genericFailure();
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    await recordAuditEvent({ ...ctx, actorUserId: user.id, action: "auth.login", result: "Failure", reason: "invalid_credentials" });
    return genericFailure();
  }

  // Backend Phase 13: accounts with two-factor authentication must present a
  // valid TOTP code here too (previously only the legacy login checked it).
  if (user.twoFactorEnabled) {
    const otp = String(req.body.otp || "").trim();
    if (!otp) return res.status(401).json({ code: "MFA_REQUIRED", message: "Enter the code from your authenticator app." });
    const ok = !!user.twoFactorSecret && speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: "base32", token: otp, window: 1 });
    if (!ok) {
      await recordAuditEvent({ ...ctx, actorUserId: user.id, action: "auth.mfa", result: "Failure", reason: "invalid_otp" });
      return res.status(401).json({ code: "MFA_INVALID", message: "That verification code is not correct." });
    }
  }

  await issueSessionCookies(res, user, ctx);
  await recordAuditEvent({ ...ctx, actorUserId: user.id, action: "auth.login", result: "Success", after: user.twoFactorEnabled ? { mfa: true } : null });
  res.json({ user: publicUser(user) });
}

export async function logout(req, res) {
  const rawRefresh = req.cookies?.[REFRESH_COOKIE];
  if (rawRefresh) {
    const tokenHash = hashToken(rawRefresh);
    const session = await prisma.refreshSession.findUnique({ where: { tokenHash } });
    if (session && !session.revokedAt) {
      await prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: "logout" } });
      await recordAuditEvent({ ...requestContext(req), actorUserId: session.userId, action: "auth.logout", result: "Success" });
    }
  }
  clearAuthCookies(res);
  res.json({ message: "Logged out" });
}

export async function refresh(req, res) {
  const ctx = requestContext(req);
  const rawRefresh = req.cookies?.[REFRESH_COOKIE];
  if (!rawRefresh) return res.status(401).json({ code: "NO_SESSION", message: "No active session." });

  const tokenHash = hashToken(rawRefresh);
  const session = await prisma.refreshSession.findUnique({ where: { tokenHash } });

  if (!session) return res.status(401).json({ code: "INVALID_SESSION", message: "Session not found." });

  // Reuse of an already-rotated (or already-revoked) token is a strong
  // signal the refresh token was stolen and used by someone else after the
  // legitimate client already rotated past it — revoke the WHOLE family,
  // not just this token, and force a fresh login everywhere.
  if (session.revokedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.refreshSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "reuse_detected" },
      });
      const user = await tx.user.findUnique({ where: { id: session.userId } });
      if (user) {
        const { subject, html } = suspiciousRefreshReuseEmail({ name: user.name });
        await recordOutboxEvent(tx, { aggregateType: "User", aggregateId: user.id, eventType: "suspicious_refresh_reuse", payload: { to: user.email, subject, html } });
      }
    });
    await recordAuditEvent({ ...ctx, actorUserId: session.userId, action: "auth.refresh_reuse_detected", result: "Denied", reason: "revoked_token_reused" });
    clearAuthCookies(res);
    return res.status(401).json({ code: "SESSION_REVOKED", message: "Session has been revoked. Please log in again." });
  }

  // Idle expiry, and (Backend Phase 13) the absolute session lifetime.
  if (isExpired(session.expiresAt) || (session.absoluteExpiresAt && isExpired(session.absoluteExpiresAt))) {
    await Promise.resolve().then(() => prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: "expired" } })).catch(() => {});
    clearAuthCookies(res);
    return res.status(401).json({ code: "SESSION_EXPIRED", message: "Session has expired. Please log in again." });
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== "Active") {
    return res.status(401).json({ code: "INVALID_SESSION", message: "Session not found." });
  }

  const rawNewRefresh = generateRawToken();
  // Rotation keeps the original login time and absolute limit (sessions
  // created before Phase 13 get a 30-day absolute limit from now).
  const absoluteExpiresAt = session.absoluteExpiresAt || new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  const newSession = await prisma.refreshSession.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawNewRefresh),
      familyId: session.familyId,
      expiresAt: idleExpiry(absoluteExpiresAt),
      authenticatedAt: session.authenticatedAt || session.createdAt,
      reauthenticatedAt: session.reauthenticatedAt,
      absoluteExpiresAt,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  });
  await prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: "rotated", replacedById: newSession.id } });

  setAccessCookie(res, accessTokenFor(user, newSession, newSession.reauthenticatedAt || newSession.authenticatedAt));
  setRefreshCookie(res, rawNewRefresh);
  setCsrfCookie(res);

  await recordAuditEvent({ ...ctx, actorUserId: user.id, action: "auth.refresh_rotated", result: "Success" });
  res.json({ user: publicUser(user) });
}

export async function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

export async function forgotPassword(req, res) {
  const { email } = req.body;
  // Always the same response, whether or not the account exists — never
  // let this endpoint reveal which emails are registered.
  const genericResponse = () => res.json({ message: "If that email is registered, a password reset link has been sent." });
  if (!email) return genericResponse();

  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findFirst({ where: { email: { equals: normalizedEmail, mode: "insensitive" } } });
  if (!user) return genericResponse();

  const rawToken = generateRawToken();
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + (Number(process.env.PASSWORD_RESET_TTL_MINUTES) || 60) * 60 * 1000) },
    });
    const { subject, html } = passwordResetEmail({ name: user.name, resetUrl: `${CLIENT_ORIGIN}/reset-password?token=${rawToken}` });
    await recordOutboxEvent(tx, {
      aggregateType: "User", aggregateId: user.id, eventType: "password_reset_requested",
      payload: { to: user.email, subject, html },
    });
  });

  await recordAuditEvent({ ...requestContext(req), actorUserId: user.id, action: "auth.password_reset_requested", result: "Success" });
  genericResponse();
}

export async function resetPassword(req, res) {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ code: "VALIDATION_ERROR", message: "Token and new password are required." });

  const tokenHash = hashToken(token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.consumedAt || isExpired(record.expiresAt)) {
    return res.status(400).json({ code: "INVALID_TOKEN", message: "This password reset link is invalid or has expired." });
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    // Password reset invalidates every existing session — a stolen
    // password shouldn't leave old sessions usable after the owner resets it.
    await tx.refreshSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "password_reset" } });
    const user = await tx.user.findUnique({ where: { id: record.userId } });
    const { subject, html } = passwordChangedEmail({ name: user.name });
    await recordOutboxEvent(tx, { aggregateType: "User", aggregateId: record.userId, eventType: "password_changed", payload: { to: user.email, subject, html } });
  });

  clearAuthCookies(res);
  await recordAuditEvent({ ...requestContext(req), actorUserId: record.userId, action: "auth.password_reset_completed", result: "Success" });
  res.json({ message: "Password has been reset. Please log in with your new password." });
}

export async function verifyEmail(req, res) {
  const { token } = req.body;
  if (!token) return res.status(400).json({ code: "VALIDATION_ERROR", message: "Token is required." });

  const tokenHash = hashToken(token);
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
  if (!record || record.consumedAt || isExpired(record.expiresAt)) {
    return res.status(400).json({ code: "INVALID_TOKEN", message: "This verification link is invalid or has expired." });
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
  ]);

  await recordAuditEvent({ ...requestContext(req), actorUserId: record.userId, action: "auth.email_verified", result: "Success" });
  res.json({ message: "Email verified." });
}

export async function listSessions(req, res) {
  const currentHash = req.cookies?.[REFRESH_COOKIE] ? hashToken(req.cookies[REFRESH_COOKIE]) : null;
  const sessions = await prisma.refreshSession.findMany({
    where: { userId: req.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    sessions: sessions.map((s) => ({
      _id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: s.tokenHash === currentHash,
    })),
  });
}

export async function revokeSession(req, res) {
  const { sessionId } = req.params;
  const session = await prisma.refreshSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== req.user.id) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Session not found." });
  }
  await prisma.refreshSession.update({ where: { id: sessionId }, data: { revokedAt: new Date(), revokedReason: "user_revoked" } });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, action: "auth.session_revoked", targetType: "RefreshSession", targetId: sessionId, result: "Success" });
  res.json({ message: "Session revoked." });
}

export async function revokeOtherSessions(req, res) {
  const currentHash = req.cookies?.[REFRESH_COOKIE] ? hashToken(req.cookies[REFRESH_COOKIE]) : null;
  await prisma.refreshSession.updateMany({
    where: { userId: req.user.id, revokedAt: null, ...(currentHash ? { tokenHash: { not: currentHash } } : {}) },
    data: { revokedAt: new Date(), revokedReason: "user_revoked_others" },
  });
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, action: "auth.sessions_revoked_others", result: "Success" });
  res.json({ message: "All other sessions revoked." });
}

// authenticateCookie middleware — verifies the access-token cookie.
export async function authenticateCookie(req, res, next) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Authentication required." });
  try {
    const payload = verifyToken(token);
    if (payload.type !== "access") throw new Error("wrong token type");
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== "Active") return res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Authentication required." });
    req.user = user;
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Session expired or invalid." });
  }
}

// ─── Backend Phase 13 — live sessions and recent authentication ────────────
// Access tokens live for minutes; privileged operations additionally require
// that the session behind the token hasn't been revoked or expired.
export async function requireLiveSession(req, res, next) {
  const sid = req.auth?.sid;
  if (!sid) return res.status(401).json({ code: "SESSION_REQUIRED", message: "Sign in again to continue.", correlationId: req.correlationId });
  const session = await prisma.refreshSession.findUnique({ where: { id: sid } });
  // A rotated session was replaced by its successor, which is still live.
  const live = session && session.userId === req.user.id && (!session.revokedAt || session.revokedReason === "rotated")
    && (!session.absoluteExpiresAt || !isExpired(session.absoluteExpiresAt));
  if (!live) return res.status(401).json({ code: "SESSION_REVOKED", message: "This session has ended. Sign in again.", correlationId: req.correlationId });
  if (session.revokedReason === "rotated") {
    // Follow the rotation chain to its current head and check it too.
    let head = session; let hops = 0;
    while (head?.replacedById && hops < 50) { head = await prisma.refreshSession.findUnique({ where: { id: head.replacedById } }); hops += 1; }
    if (!head || (head.revokedAt && head.revokedReason !== "rotated")) return res.status(401).json({ code: "SESSION_REVOKED", message: "This session has ended. Sign in again.", correlationId: req.correlationId });
  }
  next();
}

// Sensitive actions (secret rotation, restores, disaster declaration,
// deployment approval, permission changes, exports, key rotation) need a
// password check within the last few minutes.
export const RECENT_AUTH_MINUTES = () => Number(process.env.RECENT_AUTH_MINUTES) || 10;
export function requireRecentAuth(maxMinutes = RECENT_AUTH_MINUTES()) {
  return (req, res, next) => {
    const at = Number(req.auth?.auth_time || 0) * 1000;
    if (!at || Date.now() - at > maxMinutes * 60_000) {
      return res.status(401).json({ code: "REAUTHENTICATION_REQUIRED", message: `Confirm your password to continue (required within ${maxMinutes} minutes for this action).`, correlationId: req.correlationId });
    }
    next();
  };
}

// POST /api/v1/auth/reauthenticate { password } → a fresh access token with
// a new auth_time for the current session.
export async function reauthenticate(req, res) {
  const ctx = requestContext(req);
  const sid = req.auth?.sid;
  const session = sid ? await prisma.refreshSession.findUnique({ where: { id: sid } }) : null;
  if (!session || session.userId !== req.user.id) return res.status(401).json({ code: "SESSION_REQUIRED", message: "Sign in again to continue." });
  const valid = await verifyPassword(req.user.passwordHash, String(req.body?.password || ""));
  if (!valid) {
    await recordAuditEvent({ ...ctx, actorUserId: req.user.id, action: "auth.reauthenticate", result: "Failure", reason: "invalid_credentials" });
    return res.status(401).json({ code: "INVALID_CREDENTIALS", message: "That password is not correct." });
  }
  const now = new Date();
  // Stamp the current head of the rotation chain so later refreshes keep it.
  let head = session; let hops = 0;
  while (head?.replacedById && hops < 50) { head = await prisma.refreshSession.findUnique({ where: { id: head.replacedById } }); hops += 1; }
  await prisma.refreshSession.update({ where: { id: head.id }, data: { reauthenticatedAt: now } });
  setAccessCookie(res, accessTokenFor(req.user, head, now));
  await recordAuditEvent({ ...ctx, actorUserId: req.user.id, action: "auth.reauthenticate", result: "Success" });
  res.json({ reauthenticatedAt: now.toISOString(), validForMinutes: RECENT_AUTH_MINUTES() });
}

// Used by public invitation/invite-link acceptance — populates req.user
// when a valid access cookie is present (an existing user accepting while
// already logged in), but never rejects the request when it's absent (a
// brand-new invitee isn't logged in yet, and that's the normal case).
export async function optionalAuthenticateCookie(req, _res, next) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    if (payload.type !== "access") return next();
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (user && user.status === "Active") req.user = user;
  } catch {
    // no-op — an invalid/expired cookie just means "not logged in" here
  }
  next();
}
