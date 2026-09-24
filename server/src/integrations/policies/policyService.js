// Backend Phase 8 — Integration Policies and data-egress controls.
//
// A policy decides which providers, ownership types, data categories and
// sync directions an organization allows, and which CRM fields may never
// leave. Without a stored policy the safe defaults apply: every adapter
// provider allowed, Import Only, manual conflicts, admin approval, and the
// built-in restricted-field list.
import prisma from "../../lib/prisma.js";
import { IntegrationError, KINDS } from "../common/errors.js";

// Never sent to a provider, whatever the policy says (the policy can add more).
export const ALWAYS_RESTRICTED = [
  "cost", "unitCost", "productCost", "margin", "marginPercent", "discountThreshold", "maxDiscount",
  "balance", "amountDue", "amountPaid", "creditLimit", "internalNotes", "privateNotes", "restrictedNotes",
  "salary", "hrNotes", "passwordHash", "twoFactorSecret", "resetToken", "auditMetadata", "signatureEvidence",
];

export const DEFAULT_POLICY = {
  allowedProviders: [], blockedProviders: [], allowedOwnershipTypes: ["User Connection", "Organization Connection"],
  allowedDataCategories: [], allowedDirections: ["Import Only"], restrictedFields: [], providerRestrictions: {},
  requireAdminApproval: true, defaultConflictPolicy: "Manual", maxSyncFrequencyMinutes: 15, rawPayloadRetentionDays: 7, enabled: true, version: 0,
};

export async function getPolicy(organizationId, db = prisma) {
  const row = await db.integrationPolicy.findUnique({ where: { organizationId } });
  return row ? { ...row, persisted: true } : { ...DEFAULT_POLICY, organizationId, persisted: false };
}

export function assertProviderAllowed(policy, provider, ownershipType) {
  if (!policy.enabled) throw new IntegrationError(KINDS.POLICY, "Integrations are disabled for this organization.");
  if (!provider.active) throw new IntegrationError(KINDS.POLICY, `${provider.name} has been made unavailable by the System Owner.`);
  if (provider.availability !== "Adapter") throw new IntegrationError(KINDS.POLICY, provider.availabilityReason || `${provider.name} can't be connected.`);
  if ((policy.blockedProviders || []).includes(provider.key)) throw new IntegrationError(KINDS.POLICY, `${provider.name} is blocked by your organization's integration policy.`);
  if ((policy.allowedProviders || []).length && !policy.allowedProviders.includes(provider.key)) throw new IntegrationError(KINDS.POLICY, `${provider.name} isn't on your organization's allowed provider list.`);
  if (ownershipType) {
    if (!(policy.allowedOwnershipTypes || []).includes(ownershipType)) throw new IntegrationError(KINDS.POLICY, `${ownershipType}s aren't allowed by your organization's integration policy.`);
    if (!(provider.ownershipTypes || []).includes(ownershipType)) throw new IntegrationError(KINDS.POLICY, `${provider.name} doesn't support a ${ownershipType}.`);
  }
}

export function assertDirectionAllowed(policy, direction) {
  if (!(policy.allowedDirections || ["Import Only"]).includes(direction)) throw new IntegrationError(KINDS.POLICY, `${direction} sync isn't allowed by your organization's integration policy.`);
}

export function restrictedFields(policy) {
  return [...new Set([...ALWAYS_RESTRICTED, ...(policy.restrictedFields || [])])];
}

// Data egress: removes restricted fields (at any depth) from an outbound
// payload and reports what was removed, for the preview and the audit.
export function filterOutbound(payload, policy, { providerKey = null } = {}) {
  const restricted = new Set(restrictedFields(policy).map((f) => f.toLowerCase()));
  const providerRules = (policy.providerRestrictions || {})[providerKey] || {};
  for (const f of providerRules.restrictedFields || []) restricted.add(String(f).toLowerCase());
  const removed = [];
  const walk = (value, path) => {
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}[${i}]`));
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (restricted.has(k.toLowerCase())) { removed.push(path ? `${path}.${k}` : k); continue; }
        out[k] = walk(v, path ? `${path}.${k}` : k);
      }
      return out;
    }
    return value;
  };
  return { payload: walk(payload, ""), removedFields: removed };
}

const LIST_FIELDS = ["allowedProviders", "blockedProviders", "allowedOwnershipTypes", "allowedDataCategories", "allowedDirections", "restrictedFields"];
const OWNERSHIP = ["User Connection", "Organization Connection", "Service Connection"];
const DIRECTIONS = ["Import Only", "Export Only", "Two Way"];

// Validates a policy patch → data for prisma.
export function policyChanges(body) {
  const data = {};
  for (const f of LIST_FIELDS) {
    if (!(f in body)) continue;
    if (!Array.isArray(body[f]) || body[f].some((v) => typeof v !== "string" || v.length > 80)) throw new IntegrationError(KINDS.PERMANENT, `${f} must be a list of names.`);
    data[f] = [...new Set(body[f])];
  }
  if (data.allowedOwnershipTypes && data.allowedOwnershipTypes.some((o) => !OWNERSHIP.includes(o))) throw new IntegrationError(KINDS.PERMANENT, `allowedOwnershipTypes: ${OWNERSHIP.join(", ")}.`);
  if (data.allowedDirections && data.allowedDirections.some((d) => !DIRECTIONS.includes(d))) throw new IntegrationError(KINDS.PERMANENT, `allowedDirections: ${DIRECTIONS.join(", ")}.`);
  if ("providerRestrictions" in body) {
    if (!body.providerRestrictions || typeof body.providerRestrictions !== "object" || Array.isArray(body.providerRestrictions)) throw new IntegrationError(KINDS.PERMANENT, "providerRestrictions must be an object keyed by provider.");
    data.providerRestrictions = body.providerRestrictions;
  }
  for (const f of ["requireAdminApproval", "enabled"]) if (f in body) data[f] = body[f] === true;
  if ("defaultConflictPolicy" in body) {
    if (!["Manual", "Keep CRM", "Keep Provider"].includes(body.defaultConflictPolicy)) throw new IntegrationError(KINDS.PERMANENT, "defaultConflictPolicy: Manual, Keep CRM or Keep Provider.");
    data.defaultConflictPolicy = body.defaultConflictPolicy;
  }
  for (const [f, min, max] of [["maxSyncFrequencyMinutes", 5, 1440], ["rawPayloadRetentionDays", 1, 90]]) {
    if (!(f in body)) continue;
    const n = Number(body[f]);
    if (!Number.isInteger(n) || n < min || n > max) throw new IntegrationError(KINDS.PERMANENT, `${f} must be ${min}–${max}.`);
    data[f] = n;
  }
  return data;
}
