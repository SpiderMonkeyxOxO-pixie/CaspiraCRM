import { CSRF_COOKIE } from "../utils/cookies.js";

// Double-submit cookie CSRF check for the cookie-authenticated session
// surface. Only applies to mutating methods — a cross-site page can trigger
// a browser to SEND the csrf cookie automatically, but it cannot READ it
// (different origin) to also put it in the required header, so a forged
// cross-site request always fails this check.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers["x-csrf-token"];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ code: "CSRF_VALIDATION_FAILED", message: "Missing or invalid CSRF token." });
  }
  next();
}
