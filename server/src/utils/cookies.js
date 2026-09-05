import { generateRawToken } from "./tokens.js";

// Cookie names for the new session-based auth surface (/api/v1/auth/*,
// /api/v1/organizations/*, ...) — entirely separate from the legacy
// Bearer-JWT-in-localStorage flow at /api/v1/user/*, which is untouched.
export const ACCESS_COOKIE = "csrm_access";
export const REFRESH_COOKIE = "csrm_refresh";
export const CSRF_COOKIE = "csrm_csrf";

const isProd = process.env.NODE_ENV === "production";

const ACCESS_TOKEN_TTL_MS = (Number(process.env.ACCESS_TOKEN_TTL_MINUTES) || 15) * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = (Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000;

const baseCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax",
  path: "/api/v1",
};

export function setAccessCookie(res, token) {
  res.cookie(ACCESS_COOKIE, token, { ...baseCookieOptions, maxAge: ACCESS_TOKEN_TTL_MS });
}

export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, { ...baseCookieOptions, path: "/api/v1/auth", maxAge: REFRESH_TOKEN_TTL_MS });
}

// Readable (NOT httpOnly) by design — the double-submit CSRF pattern needs
// client JS to read this value back and echo it in the X-CSRF-Token header;
// its security comes from same-origin JS being the only thing that can read
// it, not from being hidden from the browser.
export function setCsrfCookie(res) {
  const token = generateRawToken(24);
  res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure: isProd, sameSite: "lax", path: "/api/v1", maxAge: REFRESH_TOKEN_TTL_MS });
  return token;
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { path: "/api/v1" });
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
  res.clearCookie(CSRF_COOKIE, { path: "/api/v1" });
}

export { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS };
