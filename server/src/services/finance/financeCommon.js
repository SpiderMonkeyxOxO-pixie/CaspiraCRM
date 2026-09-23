// Backend Phase 6 (full spec) — shared Finance helpers: errors, money and
// date parsing, settings, separation of duties with the audited emergency
// override, and audit.
//
// Finance RECORDS transactions. Nothing here moves money, talks to a bank
// or payment provider, or claims IFRS/GAAP/tax compliance.
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { recordAuditEvent, requestContext } from "../auditService.js";
import { hasGrant } from "../../utils/grants.js";
import { minorUnitDecimals } from "../sales/moneyService.js";

const { Decimal } = Prisma;

export const PAYMENT_LABEL = "Recorded payment — no bank or payment-provider transfer was performed.";

export const invalid = (res, message, details) => res.status(400).json({ code: "FINANCE_VALIDATION_FAILED", message, ...(details && { details }) });
export const notFound = (res, what) => res.status(404).json({ code: "FINANCE_RECORD_NOT_FOUND", message: `${what} not found.` });
export const badTransition = (res, message) => res.status(400).json({ code: "FINANCE_INVALID_TRANSITION", message });
export const versionConflict = (res, what) =>
  res.status(409).json({ code: "FINANCE_VERSION_CONFLICT", message: `This ${what} was updated by someone else. Refresh and try again.` });
// A version mismatch only when the client sent one — optimistic concurrency.
export const staleVersion = (body, record) => body?.version !== undefined && Number(body.version) !== record.version;

export async function audit(req, action, targetType, targetId, extra = {}) {
  await recordAuditEvent({
    ...requestContext(req), actorUserId: req.user?.id || null, actorMembershipId: req.membership?.id || null,
    organizationId: req.organizationId, action, targetType, targetId, result: "Success", ...extra,
  });
}

// ISO 4217, from the runtime's own list (no network).
const CURRENCIES = new Set(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : ["USD", "EUR", "GBP", "INR", "IDR", "PHP"]);
export const isCurrency = (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value) && CURRENCIES.has(value);

const MAX_AMOUNT = new Decimal("999999999999.99");

// Parses a client amount into a Decimal, never through a float: numbers and
// numeric strings only, no more decimals than the currency's minor unit.
// Throws RangeError with a message fit for the client.
export function parseAmount(value, { field = "amount", currency = "USD", allowZero = false, allowNegative = false } = {}) {
  if (value === null || value === undefined || value === "") throw new RangeError(`${field} is required.`);
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "x") : String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new RangeError(`${field} must be a plain number.`);
  const amount = new Decimal(text);
  const decimals = minorUnitDecimals(currency);
  if (amount.decimalPlaces() > decimals) throw new RangeError(`${field} can have at most ${decimals} decimal places in ${currency}.`);
  if (!allowNegative && amount.isNegative()) throw new RangeError(`${field} can't be negative.`);
  if (!allowZero && amount.isZero()) throw new RangeError(`${field} must be more than 0.`);
  if (amount.abs().greaterThan(MAX_AMOUNT)) throw new RangeError(`${field} is too large.`);
  return amount;
}

// Same, for quantities and unit prices (up to 4 decimals).
export function parseQuantity(value, { field = "quantity", allowZero = false } = {}) {
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "x") : String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new RangeError(`${field} must be a positive number.`);
  const q = new Decimal(text);
  if (q.decimalPlaces() > 4) throw new RangeError(`${field} can have at most 4 decimal places.`);
  if (!allowZero && q.isZero()) throw new RangeError(`${field} must be more than 0.`);
  if (q.greaterThan(MAX_AMOUNT)) throw new RangeError(`${field} is too large.`);
  return q;
}

// Dates are business dates: "2026-09-24" (or an ISO timestamp) → UTC midnight.
export function parseDay(value, field = "date", { required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new RangeError(`${field} is required.`);
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError(`${field} must be a valid date.`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export const text = (value, max = 2000) => (typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "");

const DEFAULT_SETTINGS = {
  baseCurrency: "USD", separationOfDuties: true, journalApprovalRequired: true,
  invoiceApprovalThreshold: new Decimal(10000), expensePolicyLimit: null,
};

export async function getSettings(db, organizationId) {
  const row = await db.financeSettings.findUnique({ where: { organizationId } });
  return row || { ...DEFAULT_SETTINGS, organizationId, version: 0, persisted: false };
}

// Separation of duties. `sameActor` is true when the person acting also did
// the earlier step (created, submitted, prepared, approved…). Returns true
// when the action may proceed; otherwise it has already answered 403.
//
// An emergency override needs finance_overrides:override_controls AND an
// overrideReason; it's written to FinanceOverride (listed for auditors) and
// the audit log. Separation can also be switched off per organization in
// Finance settings — that change is itself audited.
export async function checkSeparation(req, res, { settings, sameActor, rule, action, targetType, targetId }) {
  if (!sameActor) return true;
  if (settings && settings.separationOfDuties === false) return true;
  const reason = text(req.body?.overrideReason, 500);
  const canOverride = hasGrant(req, "finance_overrides", "override_controls");
  if (reason && canOverride) {
    await prisma.financeOverride.create({ data: { organizationId: req.organizationId, action, targetType, targetId, rule, reason, actorMembershipId: req.membership?.id || null } });
    await audit(req, "finance.override.used", targetType, targetId, { reason: `${rule} — ${reason}` });
    return true;
  }
  await audit(req, "finance.separation_of_duties.denied", targetType, targetId, { result: "Denied", reason: rule });
  res.status(403).json({
    code: "FINANCE_SEPARATION_OF_DUTIES",
    message: `${rule}${canOverride ? " An emergency override needs an overrideReason." : ""}`,
  });
  return false;
}

// Records a refused attempt (unauthorized or rule-breaking) for auditors.
export const auditDenied = (req, action, targetType, targetId, reason) => audit(req, action, targetType, targetId, { result: "Denied", reason });

export const decimalToApi = (value) => (value === null || value === undefined ? null : Number(value));
