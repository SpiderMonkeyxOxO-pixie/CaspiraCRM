// Backend Phase 9 — organization AI settings: the AI policy, redaction
// rules, use-case settings, routing and model aliases. Nothing is stored
// until an administrator changes it; until then the safe defaults apply.
import prisma from "../../lib/prisma.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { USE_CASES, CLASSIFICATIONS, NEVER_SENT, DEFAULT_REDACTION, DEFAULT_ALIASES, ALIASES } from "../catalog.js";
import { aiMode } from "../common/mode.js";

// Always removed before any provider call, in addition to classification rules.
export const ALWAYS_RESTRICTED_FIELDS = [
  "cost", "unitCost", "productCost", "margin", "marginPercent", "discountThreshold", "maxDiscount", "discountLimit",
  "salary", "hrNotes", "internalNotes", "privateNotes", "restrictedNotes", "passwordHash", "password", "twoFactorSecret",
  "resetToken", "token", "accessToken", "refreshToken", "apiKey", "secret", "clientSecret", "auditMetadata",
  "bankAccount", "iban", "accountNumber", "routingNumber", "cardNumber", "signatureEvidence",
];

const SAFE_DEFAULT_CLASSES = ["Public", "Internal", "Confidential", "Personal", "Financial"];

export const DEFAULT_AI_POLICY = {
  enabled: true, allowedProviders: [], allowedUseCases: [], providerClassifications: {},
  restrictedFields: [], personalData: "Mask", providerStorage: false, providerMemory: false,
  maxRequestsPerUserPerHour: 60, actionApprovals: {}, version: 0,
  retention: { requestPayloadDays: 7, draftHours: 24, evaluationDays: 180, feedbackDays: 365, providerMetadataDays: 90, usageDetailDays: 400, copilotConversationDays: 365, copilotToolResultDays: 30, retrievalLogDays: 90 },
};

export async function getAiPolicy(organizationId, db = prisma) {
  const row = await db.aiPolicy.findUnique({ where: { organizationId } });
  if (!row) return { ...DEFAULT_AI_POLICY, organizationId, persisted: false };
  return { ...row, retention: { ...DEFAULT_AI_POLICY.retention, ...(row.retention || {}) }, persisted: true };
}

export const allowedClassesFor = (policy, providerKey) => {
  const set = (policy.providerClassifications || {})[providerKey];
  return (Array.isArray(set) && set.length ? set : SAFE_DEFAULT_CLASSES).filter((c) => !NEVER_SENT.includes(c));
};

export function restrictedFieldSet(policy) {
  return new Set([...ALWAYS_RESTRICTED_FIELDS, ...(policy.restrictedFields || [])].map((f) => f.toLowerCase()));
}

export function assertAiEnabled(policy) {
  if (!policy.enabled) throw new AiError(CATEGORIES.POLICY, "AI features are turned off for this organization.");
}

export function assertProviderAllowedByPolicy(policy, provider) {
  if (!provider || !provider.active) throw new AiError(CATEGORIES.POLICY, "This AI provider has been made unavailable by the System Owner.");
  if (provider.availability !== "Adapter") throw new AiError(CATEGORIES.POLICY, provider.availabilityReason || `${provider.name} can't be connected.`);
  if (provider.key === "simulator" && aiMode() !== "simulator") throw new AiError(CATEGORIES.POLICY, "The AI Provider Simulator isn't available here.");
  const allowed = policy.allowedProviders || [];
  if (allowed.length ? !allowed.includes(provider.key) : !provider.enabledByDefault) {
    throw new AiError(CATEGORIES.POLICY, `${provider.name} isn't allowed by your organization's AI policy.`);
  }
}

// Validates a policy patch → data for prisma.
export function aiPolicyChanges(body = {}) {
  const data = {};
  const list = (k, allowed) => {
    if (!(k in body)) return;
    if (!Array.isArray(body[k])) throw new AiError(CATEGORIES.INVALID_REQUEST, `${k} must be a list.`);
    const v = [...new Set(body[k].map(String))];
    if (allowed) { const bad = v.filter((x) => !allowed.includes(x)); if (bad.length) throw new AiError(CATEGORIES.INVALID_REQUEST, `${k}: unknown values ${bad.join(", ")}.`); }
    data[k] = v;
  };
  if ("enabled" in body) data.enabled = body.enabled === true;
  list("allowedProviders");
  list("allowedUseCases", Object.keys(USE_CASES));
  list("restrictedFields");
  if ("providerClassifications" in body) {
    const pc = body.providerClassifications;
    if (!pc || typeof pc !== "object" || Array.isArray(pc)) throw new AiError(CATEGORIES.INVALID_REQUEST, "providerClassifications must map provider → classifications.");
    const out = {};
    for (const [k, v] of Object.entries(pc)) {
      const arr = [...new Set((v || []).map(String))];
      const bad = arr.filter((c) => !CLASSIFICATIONS.includes(c));
      if (bad.length) throw new AiError(CATEGORIES.INVALID_REQUEST, `Unknown classifications: ${bad.join(", ")}.`);
      const never = arr.filter((c) => NEVER_SENT.includes(c));
      if (never.length) throw new AiError(CATEGORIES.POLICY, `${never.join(" and ")} data is never sent to an AI provider.`);
      out[k] = arr;
    }
    data.providerClassifications = out;
  }
  if ("personalData" in body) {
    if (!["Mask", "Pseudonymize", "Exclude"].includes(body.personalData)) throw new AiError(CATEGORIES.INVALID_REQUEST, "personalData: Mask, Pseudonymize or Exclude.");
    data.personalData = body.personalData;
  }
  for (const k of ["providerStorage", "providerMemory"]) {
    if (k in body) {
      if (body[k] === true && body.confirmProviderRetention !== true) throw new AiError(CATEGORIES.INVALID_REQUEST, `Turning on ${k} lets the provider keep CRM data. Send confirmProviderRetention: true to confirm.`, { details: { confirmationRequired: k } });
      data[k] = body[k] === true;
    }
  }
  if ("maxRequestsPerUserPerHour" in body) {
    const n = Number(body.maxRequestsPerUserPerHour);
    if (!Number.isInteger(n) || n < 1 || n > 10_000) throw new AiError(CATEGORIES.INVALID_REQUEST, "maxRequestsPerUserPerHour must be 1–10000.");
    data.maxRequestsPerUserPerHour = n;
  }
  if ("actionApprovals" in body) {
    if (!body.actionApprovals || typeof body.actionApprovals !== "object") throw new AiError(CATEGORIES.INVALID_REQUEST, "actionApprovals must map action type → true/false.");
    data.actionApprovals = Object.fromEntries(Object.entries(body.actionApprovals).map(([k, v]) => [k, v === true]));
  }
  if ("retention" in body) {
    const r = body.retention || {};
    const out = {};
    for (const k of Object.keys(DEFAULT_AI_POLICY.retention)) {
      if (k in r) {
        const n = Number(r[k]);
        if (!Number.isInteger(n) || n < 1 || n > 3650) throw new AiError(CATEGORIES.INVALID_REQUEST, `retention.${k} must be a whole number of days/hours (1–3650).`);
        out[k] = n;
      }
    }
    data.retention = out;
  }
  return data;
}

// ---- Redaction rules ----------------------------------------------------------------

export async function getRedactionRules(organizationId, db = prisma) {
  const rows = await db.aiRedactionRule.findMany({ where: { organizationId } });
  const byClass = Object.fromEntries(rows.map((r) => [r.classification, r]));
  return CLASSIFICATIONS.map((c) => {
    const locked = NEVER_SENT.includes(c);
    const row = byClass[c];
    return { classification: c, action: locked ? "Remove" : row?.action || DEFAULT_REDACTION[c], reason: row?.reason || null, locked, version: row?.version || 0, persisted: !!row };
  });
}

export const REDACTION_ACTIONS = ["Allow", "Mask", "Pseudonymize", "Remove"];

// ---- Use cases -------------------------------------------------------------------------

export async function getUseCase(organizationId, key, db = prisma) {
  const def = USE_CASES[key];
  if (!def) throw new AiError(CATEGORIES.INVALID_REQUEST, "Unknown AI use case.");
  const row = await db.aiUseCase.findUnique({ where: { organizationId_key: { organizationId, key } } });
  const merged = {
    key, ...def,
    enabled: def.reserved ? false : row ? row.enabled : true,
    allowedAliases: row?.allowedAliases?.length ? row.allowedAliases : def.allowedAliases,
    maxInputChars: row?.maxInputChars || def.maxInputChars,
    maxOutputTokens: row?.maxOutputTokens || def.maxOutputTokens,
    allowedClassifications: row?.allowedClassifications?.length ? row.allowedClassifications : def.allowedClassifications,
    toolsAllowed: row ? row.toolsAllowed : def.toolsAllowed,
    streamingAllowed: row ? row.streamingAllowed : def.streamingAllowed,
    version: row?.version || 0, persisted: !!row,
  };
  if (!merged.allowedAliases.includes(merged.defaultAlias)) merged.defaultAlias = merged.allowedAliases[0];
  return merged;
}

export async function listUseCases(organizationId, db = prisma) {
  return Promise.all(Object.keys(USE_CASES).filter((k) => !USE_CASES[k].internal).map((k) => getUseCase(organizationId, k, db)));
}

export function useCaseChanges(def, body = {}) {
  const data = {};
  if ("enabled" in body) {
    if (def.reserved && body.enabled) throw new AiError(CATEGORIES.POLICY, "This use case is reserved for Phase 10.");
    data.enabled = body.enabled === true;
  }
  if ("allowedAliases" in body) {
    const v = [...new Set((body.allowedAliases || []).map(String))];
    if (!v.length || v.some((a) => !ALIASES.includes(a))) throw new AiError(CATEGORIES.INVALID_REQUEST, `allowedAliases must be chosen from ${ALIASES.join(", ")}.`);
    data.allowedAliases = v;
  }
  for (const [k, max] of [["maxInputChars", 400_000], ["maxOutputTokens", 32_000]]) {
    if (k in body) {
      const n = Number(body[k]);
      if (!Number.isInteger(n) || n < 100 || n > max) throw new AiError(CATEGORIES.INVALID_REQUEST, `${k} must be 100–${max}.`);
      data[k] = n;
    }
  }
  if ("allowedClassifications" in body) {
    const v = [...new Set((body.allowedClassifications || []).map(String))];
    if (v.some((c) => !CLASSIFICATIONS.includes(c) || NEVER_SENT.includes(c))) throw new AiError(CATEGORIES.INVALID_REQUEST, "allowedClassifications contains an unknown or never-sent classification.");
    data.allowedClassifications = v;
  }
  if ("toolsAllowed" in body) data.toolsAllowed = body.toolsAllowed === true;
  if ("streamingAllowed" in body) data.streamingAllowed = body.streamingAllowed === true;
  return data;
}

// ---- Aliases and routing ------------------------------------------------------------------

export async function resolveAliasModel(organizationId, providerKey, alias, db = prisma) {
  const row = await db.aiModelAlias.findUnique({ where: { organizationId_alias_providerKey: { organizationId, alias, providerKey } } });
  return row?.modelId || DEFAULT_ALIASES[providerKey]?.[alias] || null;
}

export async function listAliases(organizationId, db = prisma) {
  const rows = await db.aiModelAlias.findMany({ where: { organizationId } });
  const out = [];
  for (const [providerKey, map] of Object.entries(DEFAULT_ALIASES)) {
    for (const alias of ALIASES) {
      const row = rows.find((r) => r.providerKey === providerKey && r.alias === alias);
      const modelId = row?.modelId || map[alias] || null;
      if (modelId) out.push({ alias, providerKey, modelId, version: row?.version || 0, persisted: !!row });
    }
  }
  return out;
}

const PROVIDER_PREFERENCE = ["anthropic", "openai", "openrouter"];

// The routing for a use case: the stored policy, or the first usable
// connection (the simulator in simulator mode).
export async function getRouting(organizationId, useCaseKey, db = prisma) {
  const row = await db.aiRoutingPolicy.findUnique({ where: { organizationId_useCaseKey: { organizationId, useCaseKey } } });
  if (row) return { ...row, persisted: true };
  const uc = USE_CASES[useCaseKey];
  if (aiMode() === "simulator") return { useCaseKey, primaryProviderKey: "simulator", primaryAlias: uc?.defaultAlias || "balanced", fallbackProviderKey: null, fallbackAlias: null, persisted: false, version: 0 };
  const conns = await db.aiProviderConnection.findMany({ where: { organizationId, mode: "Live", status: { in: ["Connected", "Connected with Warnings"] } } });
  const primary = PROVIDER_PREFERENCE.find((k) => conns.some((c) => c.providerKey === k)) || null;
  return { useCaseKey, primaryProviderKey: primary, primaryAlias: uc?.defaultAlias || "balanced", fallbackProviderKey: null, fallbackAlias: null, persisted: false, version: 0 };
}
