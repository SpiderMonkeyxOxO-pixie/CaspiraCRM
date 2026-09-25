// Backend Phase 13 — scoped automation tokens for host scripts (deploy.sh,
// backup reporting). Shown once at creation; stored only as an HMAC with a
// server-side pepper; scope-checked on every use; expire and can be revoked.
import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { PlatformError, currentEnvironment, publicId, platformAudit } from "./common.js";

export const TOKEN_SCOPES = ["deployment:read", "deployment:report", "release:register", "drill:record"];

const pepper = () => process.env.PLATFORM_AUTOMATION_TOKEN_PEPPER || (["staging", "production"].includes(process.env.APP_ENV) ? null : "development-only-pepper");
export const hashAutomationToken = (token) => {
  const p = pepper();
  if (!p) throw new PlatformError(503, "NOT_CONFIGURED", "Automation tokens are not configured.");
  return crypto.createHmac("sha256", p).update(String(token)).digest("hex");
};

export async function createAutomationToken(req, { name, scopes, days = 30 }) {
  const list = [].concat(scopes || []);
  if (!list.length || list.some((s) => !TOKEN_SCOPES.includes(s))) throw new PlatformError(422, "INVALID_SCOPES", `scopes must be from: ${TOKEN_SCOPES.join(", ")}.`);
  const d = Number(days);
  if (!Number.isInteger(d) || d < 1 || d > 90) throw new PlatformError(422, "INVALID_EXPIRY", "Tokens last 1–90 days.");
  const id = publicId("pat");
  const raw = `cpat_${id}.${crypto.randomBytes(32).toString("base64url")}`;
  await prisma.platformAutomationToken.create({ data: { publicId: id, name: String(name || "automation").slice(0, 80), tokenHash: hashAutomationToken(raw), scopes: list, environment: currentEnvironment(), createdByUserId: req.user.id, expiresAt: new Date(Date.now() + d * 86_400_000) } });
  await platformAudit(req, "automation_token.created", "PlatformAutomationToken", id, { after: { scopes: list, days: d } });
  return { id, token: raw, note: "Store this token in the host's secret store now; it is not shown again." };
}

export async function revokeAutomationToken(req, id) {
  const t = await prisma.platformAutomationToken.findUnique({ where: { publicId: String(id) } });
  if (!t) throw new PlatformError(404, "NOT_FOUND", "Token not found.");
  await prisma.platformAutomationToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
  await platformAudit(req, "automation_token.revoked", "PlatformAutomationToken", t.publicId, {});
  return { ok: true };
}

// Middleware for automation endpoints: Authorization: Bearer cpat_...
export function requireAutomationScope(scope) {
  return async (req, res, next) => {
    const header = String(req.headers.authorization || "");
    const raw = header.startsWith("Bearer cpat_") ? header.slice(7) : null;
    if (!raw) return res.status(401).json({ code: "AUTOMATION_TOKEN_REQUIRED", message: "An automation token is required.", correlationId: req.correlationId });
    let t = null;
    try { t = await prisma.platformAutomationToken.findUnique({ where: { tokenHash: hashAutomationToken(raw) } }); } catch { t = null; }
    const valid = t && !t.revokedAt && t.expiresAt > new Date() && t.environment === currentEnvironment();
    if (!valid || !(t.scopes || []).includes(scope)) {
      await platformAudit(req, "automation_token.denied", "PlatformAutomationToken", t?.publicId || null, { result: "Denied", reason: scope });
      return res.status(403).json({ code: "AUTOMATION_TOKEN_INVALID", message: "The automation token is invalid, expired or lacks this scope.", correlationId: req.correlationId });
    }
    await prisma.platformAutomationToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } });
    req.automationToken = t;
    next();
  };
}
