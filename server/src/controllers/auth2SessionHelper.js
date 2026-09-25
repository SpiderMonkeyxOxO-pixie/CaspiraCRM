import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { signToken } from "../utils/jwt.js";
import { generateRawToken, hashToken } from "../utils/tokens.js";
import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS, SESSION_ABSOLUTE_TTL_MS, setAccessCookie, setRefreshCookie, setCsrfCookie } from "../utils/cookies.js";

// Shared by auth2Controller.login() and invitationsController.acceptInvitation()
// (a brand-new user is logged straight in after accepting) — one place
// issues a fresh access+refresh+csrf cookie set, so both call sites stay in
// sync on cookie shape, TTLs and refresh-family bookkeeping.
//
// Backend Phase 13: every session has an absolute lifetime from the password
// login (refresh rotation can't extend it) and an idle lifetime (the refresh
// TTL, renewed on use but capped by the absolute limit). The access token
// carries the session id (`sid`) and the time of the last password check
// (`auth_time`) for revocation checks and recent-authentication gates.
export function accessTokenFor(user, session, authTime) {
  return signToken({ sub: user.id, role: user.role, type: "access", sid: session.id, auth_time: Math.floor(new Date(authTime).getTime() / 1000) }, `${Math.floor(ACCESS_TOKEN_TTL_MS / 1000)}s`);
}

export const idleExpiry = (absoluteExpiresAt, now = Date.now()) => new Date(Math.min(now + REFRESH_TOKEN_TTL_MS, new Date(absoluteExpiresAt).getTime()));

export async function issueSessionCookies(res, user, { ipAddress, userAgent, familyId = crypto.randomUUID() } = {}) {
  const now = new Date();
  const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS);
  const rawRefresh = generateRawToken();
  const session = await prisma.refreshSession.create({
    data: { userId: user.id, tokenHash: hashToken(rawRefresh), familyId, expiresAt: idleExpiry(absoluteExpiresAt, now.getTime()), authenticatedAt: now, absoluteExpiresAt, ipAddress, userAgent },
  });
  setAccessCookie(res, accessTokenFor(user, session, now));
  setRefreshCookie(res, rawRefresh);
  setCsrfCookie(res);
  return session;
}
