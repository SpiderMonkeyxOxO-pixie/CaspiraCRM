import { verifyToken } from "../utils/jwt.js";
import prisma from "../lib/prisma.js";
import { ACCESS_COOKIE } from "../utils/cookies.js";

// Matches the frontend's existing axiosInstance interceptor, which already
// sends `Authorization: Bearer <token>` (see src/Helpers/axiosInstance.js) —
// no frontend change needed to satisfy this.
//
// Backend Phase 13: also accepts the session access cookie (so cookie-mode
// clients can use these routes), rejects purpose-limited tokens (a
// "2fa-pending" token is not a login) and refresh-type tokens, and refuses
// suspended or disabled accounts immediately.
export async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.cookies?.[ACCESS_COOKIE] || null;
  if (!token) return res.status(401).json({ message: "Authentication required" });

  try {
    const payload = verifyToken(token);
    if (payload.purpose || (payload.type && payload.type !== "access")) return res.status(401).json({ message: "Invalid session" });
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || (user.status && user.status !== "Active")) return res.status(401).json({ message: "Invalid session" });
    req.user = user;
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired session" });
  }
}

// Mirrors the frontend's RequireAuth allowedRoles gate — same five role
// identifiers (Super-Admin, Admin, Team-Leader, Checker, User), so nothing
// about the frontend's role model needs to change to satisfy this.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Authentication required" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have permission to perform this action" });
    }
    next();
  };
}
