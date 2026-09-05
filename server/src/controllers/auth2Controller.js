// Session-based auth for the new /api/v1/auth/* surface — httpOnly cookies,
// rotating refresh sessions, reuse detection. Entirely separate from
// authController.js's Bearer-JWT /api/v1/user/* flow, which is untouched
// and keeps working for every existing CRM/Sales/Support/AI route.
import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { signToken, verifyToken } from "../utils/jwt.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { generateRawToken, hashToken, isExpired } from "../utils/tokens.js";
import { toApi } from "../utils/serialize.js";
import {
  ACCESS_COOKIE, REFRESH_COOKIE, setAccessCookie, setRefreshCookie, setCsrfCookie, clearAuthCookies,
  ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS,
} from "../utils/cookies.js";
import { recordAuditEvent, requestContext } from "../services/auditService.js";
import { recordOutboxEvent } from "../services/outboxService.js";

function publicUser(user) {
  const { passwordHash, twoFactorSecret, resetToken, resetTokenExpires, ...rest } = user;
  return toApi(rest);
}

async function issueSession(res, user, { familyId = crypto.randomUUID(), ipAddress, userAgent } = {}) {
  const accessToken = signToken({ sub: user.id, role: user.role, type: "access" }, `${Math.floor(ACCESS_TOKEN_TTL_MS / 1000)}s`);
  const rawRefresh = generateRawToken();
  await prisma.refreshSession.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawRefresh),
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      ipAddress,
      userAgent,
    },
  });
  setAccessCookie(res, accessToken);
  setRefreshCookie(res, rawRefresh);
  setCsrfCookie(res);
}

export async function login(req, res) {
  const { email, password } = req.body;
  const ctx = requestContext(req);
  const genericFailure = () => res.status(401).json({ code: "INVALID_CREDENTIALS", message: "Invalid email or password." });

  if (!email || !password) return res.status(400).json({ code: "VALIDATION_ERROR", message: "Email and password are required." });

  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findFirst({ where: { email: { equals: normalizedEmail, mode: "insensitive" } } });

  if (!user || user.status !== "Active") {
    await recordAuditEvent({ ...ctx, action: "auth.login", result: "Failure", reason: "invalid_credentials" });
    return genericFailure();
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    await recordAuditEvent({ ...ctx, actorUserId: user.id, action: "auth.login", result: "Failure", reason: "invalid_credentials" });
    return genericFailure();
  }

  await issueSession(res, user, ctx);
  await recordAuditEvent({ ...ctx, actorUserId: user.id, action: "auth.login", result: "Success" });
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
    await prisma.refreshSession.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "reuse_detected" },
    });
    await recordAuditEvent({ ...ctx, actorUserId: session.userId, action: "auth.refresh_reuse_detected", result: "Denied", reason: "revoked_token_reused" });
    clearAuthCookies(res);
    return res.status(401).json({ code: "SESSION_REVOKED", message: "Session has been revoked. Please log in again." });
  }

  if (isExpired(session.expiresAt)) {
    return res.status(401).json({ code: "SESSION_EXPIRED", message: "Session has expired. Please log in again." });
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== "Active") {
    return res.status(401).json({ code: "INVALID_SESSION", message: "Session not found." });
  }

  const rawNewRefresh = generateRawToken();
  const newSession = await prisma.refreshSession.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawNewRefresh),
      familyId: session.familyId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  });
  await prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: "rotated", replacedById: newSession.id } });

  const accessToken = signToken({ sub: user.id, role: user.role, type: "access" }, `${Math.floor(ACCESS_TOKEN_TTL_MS / 1000)}s`);
  setAccessCookie(res, accessToken);
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
    await recordOutboxEvent(tx, {
      aggregateType: "User", aggregateId: user.id, eventType: "password_reset_requested",
      payload: { to: user.email, name: user.name, rawToken },
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
    await recordOutboxEvent(tx, { aggregateType: "User", aggregateId: record.userId, eventType: "password_changed", payload: { to: user.email, name: user.name } });
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
    where: { userId: req.user.id, revokedAt: null },
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
    next();
  } catch {
    return res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Session expired or invalid." });
  }
}
