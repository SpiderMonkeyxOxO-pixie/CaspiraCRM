import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { signToken } from "../utils/jwt.js";
import { generateRawToken, hashToken } from "../utils/tokens.js";
import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS, setAccessCookie, setRefreshCookie, setCsrfCookie } from "../utils/cookies.js";

// Shared by auth2Controller.login() and invitationsController.acceptInvitation()
// (a brand-new user is logged straight in after accepting) — one place
// issues a fresh access+refresh+csrf cookie set, so both call sites stay in
// sync on cookie shape, TTLs and refresh-family bookkeeping.
export async function issueSessionCookies(res, user, { ipAddress, userAgent, familyId = crypto.randomUUID() } = {}) {
  const accessToken = signToken({ sub: user.id, role: user.role, type: "access" }, `${Math.floor(ACCESS_TOKEN_TTL_MS / 1000)}s`);
  const rawRefresh = generateRawToken();
  await prisma.refreshSession.create({
    data: { userId: user.id, tokenHash: hashToken(rawRefresh), familyId, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS), ipAddress, userAgent },
  });
  setAccessCookie(res, accessToken);
  setRefreshCookie(res, rawRefresh);
  setCsrfCookie(res);
}
