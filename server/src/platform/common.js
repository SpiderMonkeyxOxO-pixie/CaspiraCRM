// Backend Phase 13 — shared helpers for platform operations: the current
// environment, safe errors, public IDs, audit events and optimistic locks.
import crypto from "node:crypto";
import prisma from "../lib/prisma.js";
import { recordAuditEvent } from "../services/auditService.js";

export const currentEnvironment = () => process.env.APP_ENV || (process.env.NODE_ENV === "production" ? "production" : "development");
export const isStrictEnvironment = (env = currentEnvironment()) => ["staging", "production"].includes(env);

export class PlatformError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

export const publicId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString("base64url")}`;

// Every platform action is audited with its correlation ID (the audit reference).
export async function platformAudit(req, action, targetType, targetId, { result = "Success", reason = null, before = null, after = null } = {}) {
  return recordAuditEvent({
    correlationId: req?.correlationId || crypto.randomUUID(), actorUserId: req?.user?.id || null, organizationId: null,
    action: `platform.${action}`, targetType, targetId: targetId ? String(targetId) : null, result, reason,
    before, after, ipAddress: req?.ip || null, userAgent: req?.headers?.["user-agent"] || null,
  }).catch(() => null);
}

// A system actor (worker job) for audit events.
export const systemActor = (correlationId = crypto.randomUUID()) => ({ correlationId, user: null, ip: null, headers: {} });

// Optimistic lock: update only if `version` still matches.
export async function lockedUpdate(model, id, expectedVersion, data) {
  if (expectedVersion === undefined || expectedVersion === null) return prisma[model].update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  const { count } = await prisma[model].updateMany({ where: { id, version: Number(expectedVersion) }, data: { ...data, version: { increment: 1 } } });
  if (!count) throw new PlatformError(409, "VERSION_CONFLICT", "This record was changed by someone else. Refresh and try again.");
  return prisma[model].findUnique({ where: { id } });
}

export const guard = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (err) {
    if (err instanceof PlatformError) return res.status(err.status).json({ code: err.code, message: err.message, details: err.details, correlationId: req.correlationId });
    return next(err);
  }
};

export const toJson = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x)));
