// Backend Phase 11 — layered safety: a provider-neutral moderation adapter,
// output scanning, encoded-instruction detection and normalized safety
// events. Moderation never replaces authorization. Nothing here stores a copy
// of the user's input, a credential, a sensitive value or hidden reasoning.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { aiAudit } from "../common/audit.js";
import { aiMode } from "../common/mode.js";
import { detectInjection } from "../context/contextAssembly.js";
import { recordOutboxEvent } from "../../services/outboxService.js";

export const SAFETY_POLICY_VERSION = "2026-09.1";

// ---- Detection ------------------------------------------------------------------

// Base64 or hex blobs that decode to an instruction.
export function detectEncodedInstructions(text) {
  const flags = [];
  for (const blob of String(text || "").match(/[A-Za-z0-9+/]{16,}={0,2}/g) || []) {
    try {
      const decoded = Buffer.from(blob, "base64").toString("utf8");
      if (/^[\x20-\x7E\s]+$/.test(decoded) && detectInjection(decoded).length) flags.push("encoded_instruction");
    } catch { /* not base64 */ }
  }
  if (/\b(decode|base64|rot13)\b[^.\n]{0,30}\b(follow|execute|obey|run)\b/i.test(text)) flags.push("encoded_instruction");
  return [...new Set(flags)];
}
export const injectionFlags = (text) => [...new Set([...detectInjection(String(text || "")), ...detectEncodedInstructions(text)])];

const CREDENTIAL_PATTERNS = [
  ["api_key", /\b(sk|pk|rk)-(live|test|proj|ant)?[-_]?[A-Za-z0-9]{16,}\b/g], ["aws_key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["bearer_token", /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g], ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["password_disclosure", /\b(password|passcode|passwd)\s*(is|:|=)\s*\S+/gi], ["card_number", /\b(?:\d[ -]?){13,19}\b/g],
];
const luhn = (s) => { const d = s.replace(/\D/g, ""); if (d.length < 13) return false; let sum = 0; for (let i = 0; i < d.length; i += 1) { let n = Number(d[d.length - 1 - i]); if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; } return sum % 10 === 0; };

// Output scanning → { findings: [category], text (redacted) }.
export function scanOutput(text) {
  let out = String(text || "");
  const findings = [];
  for (const [category, re] of CREDENTIAL_PATTERNS) {
    out = out.replace(re, (m) => {
      if (category === "card_number" && !luhn(m)) return m;
      findings.push(category);
      return "[redacted]";
    });
  }
  return { findings: [...new Set(findings)], text: out };
}

// ---- Moderation adapter ------------------------------------------------------------

const LOCAL_RULES = [
  ["credential_extraction", /\b(api[ _-]?keys?|passwords?|secrets?|tokens?|credentials?|private keys?)\b[^.\n]{0,60}\b(for|of|every|all|the)\b/i, "Refuse", "High"],
  ["credential_extraction", /\b(give|tell|show|reveal|send|list)\b[^.\n]{0,40}\b(api[ _-]?keys?|passwords?|secrets?|tokens?|credentials?)\b/i, "Refuse", "High"],
  ["cross_tenant", /\b(another|other|all|every)\b[^.\n]{0,20}\b(organi[sz]ations?|tenants?|companies'? (accounts|data))\b/i, "Refuse", "Medium"],
  ["mass_export", /\b(export|dump|download)\b[^.\n]{0,20}\b(all|every|entire)\b/i, "Require human review", "Medium"],
  ["threat_or_harassment", /\b(kill|hurt|threaten|harass|stalk)\b[^.\n]{0,20}\b(you|him|her|them|customer|employee)\b/i, "Require human review", "Medium"],
];

// → { decision, categories, confidence, provider, model, policyVersion, at }
export async function moderate(text, { direction = "input" } = {}) {
  const provider = (process.env.AI_MODERATION_PROVIDER || "local").toLowerCase();
  const at = new Date().toISOString();
  if (provider === "disabled") return { decision: "Allow", categories: [], confidence: "Not assessed", provider: "disabled", model: null, policyVersion: SAFETY_POLICY_VERSION, at, direction };
  // External moderation (e.g. OpenAI) is only used when configured AND not in
  // simulator mode; default tests never make an external request.
  if (provider === "openai" && aiMode() !== "simulator" && process.env.AI_MODERATION_OPENAI_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/moderations", { method: "POST", headers: { Authorization: `Bearer ${process.env.AI_MODERATION_OPENAI_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "omni-moderation-latest", input: String(text).slice(0, 8000) }), signal: AbortSignal.timeout(5000) });
      const body = await res.json();
      const r = body.results?.[0];
      if (r) {
        const categories = Object.entries(r.categories || {}).filter(([, v]) => v).map(([k]) => k);
        const local = localModeration(text);
        return { decision: r.flagged ? "Refuse" : local.decision, categories: [...new Set([...categories, ...local.categories])], confidence: r.flagged ? "High" : local.confidence, provider: "openai", model: body.model || "omni-moderation-latest", policyVersion: SAFETY_POLICY_VERSION, at, direction };
      }
    } catch { /* fall through to local rules */ }
  }
  return { ...localModeration(text), provider: provider === "openai" ? "local (external unavailable)" : "local", model: "local-rules-v1", policyVersion: SAFETY_POLICY_VERSION, at, direction };
}

function localModeration(text) {
  const hits = LOCAL_RULES.filter(([, re]) => re.test(String(text || "")));
  const flags = injectionFlags(text);
  if (!hits.length && !flags.length) return { decision: "Allow", categories: [], confidence: "High" };
  const order = ["Allow", "Allow with warning", "Require human review", "Refuse"];
  let decision = flags.length ? "Allow with warning" : "Allow";
  for (const [, , d] of hits) if (order.indexOf(d) > order.indexOf(decision)) decision = d;
  return { decision, categories: [...new Set([...hits.map(([c]) => c), ...flags.map((f) => `injection:${f}`)])], confidence: hits.some(([, , , c]) => c === "High") ? "High" : "Medium" };
}

// ---- Safety events ------------------------------------------------------------------

const SUMMARY_LIMIT = 240;
// Summaries are written by code, never copied from user input.
export async function recordSafetyEvent(req, ev) {
  const organizationId = ev.organizationId ?? req?.organizationId ?? null;
  // Evaluation runs produce synthetic events: labelled, never escalated or notified,
  // and excluded from misuse counts and monitoring.
  const synthetic = !!req?.aiEvaluation;
  if (synthetic) ev = { ...ev, source: `evaluation:${ev.source}` };
  const row = await prisma.aiSafetyEvent.create({
    data: {
      organizationId, membershipId: ev.membershipId ?? req?.membership?.id ?? null, conversationId: ev.conversationId || null, requestId: ev.requestId || null,
      capabilityKey: ev.capabilityKey || null, severity: ev.severity, category: ev.category, policyVersion: SAFETY_POLICY_VERSION, providerKey: ev.providerKey || null,
      modelId: ev.modelId || null, summary: String(ev.summary).slice(0, SUMMARY_LIMIT), source: ev.source, actionTaken: ev.actionTaken, correlationId: ev.correlationId || null,
    },
  });
  await aiAudit(req, "ai.safety_event.recorded", "AiSafetyEvent", row.id, { organizationId, after: { category: row.category, severity: row.severity, actionTaken: row.actionTaken } }).catch(() => {});
  if (synthetic) return row;
  if (["High", "Critical"].includes(row.severity)) {
    await recordOutboxEvent(prisma, { aggregateType: "AiSafetyEvent", aggregateId: row.id, eventType: "ai.safety_event.high", payload: { organizationId, category: row.category, severity: row.severity, notifyRoleKeys: ["admin", "ai_safety_reviewer"] } }).catch(() => {});
  }
  if (row.severity === "Critical") {
    const { escalateCriticalEvent } = await import("./incidents.js");
    await escalateCriticalEvent(req, row).catch(() => {});
  }
  return row;
}

// Repeated misuse (Medium or worse in the last hour) → rate limit.
export async function recentMisuse(req, windowMinutes = 60) {
  if (!req?.membership?.id) return 0;
  return prisma.aiSafetyEvent.count({ where: { organizationId: req.organizationId, membershipId: req.membership.id, severity: { in: ["Medium", "High", "Critical"] }, NOT: { source: { startsWith: "evaluation:" } }, createdAt: { gte: new Date(Date.now() - windowMinutes * 60_000) } } });
}
export const MISUSE_LIMIT = Number(process.env.AI_MISUSE_LIMIT) || 5;

export const digest = (v) => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
