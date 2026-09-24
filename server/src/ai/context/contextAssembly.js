// Backend Phase 9 — context assembly. Everything that reaches a provider
// passes through here:
//   - restricted and secret fields are removed (built-in list + policy);
//   - each field is classified; classifications the provider or use case
//     may not receive are removed; the rest follow the organization's
//     redaction rule (Allow, Mask, Pseudonymize, Remove);
//   - fields the requesting user can't see are removed;
//   - strings are stripped of HTML and scanned for prompt-injection text,
//     which stays inert data (flagged and logged, never obeyed);
//   - the result is size-limited;
//   - values are escaped so data can't close its <data> block.
// Only field NAMES are recorded as removed — never values.
import crypto from "node:crypto";
import { AiError, CATEGORIES } from "../common/errors.js";
import { classifyField, NEVER_SENT } from "../catalog.js";
import { restrictedFieldSet, allowedClassesFor } from "../policy/policyService.js";

const MAX_STRING = 4000;

export const INJECTION_PATTERNS = [
  ["ignore_instructions", /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|system|all)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?)\b/i],
  ["reveal_secrets", /\b(reveal|print|show|output|leak|send)\b[^.\n]{0,40}\b(system prompt|api[ _-]?key|secret|password|token|credentials?)\b/i],
  ["role_override", /\b(you are now|act as|new instructions|developer mode|jailbreak)\b/i],
  ["cross_tenant", /\b(another|other|all)\b[^.\n]{0,20}\b(organi[sz]ations?|tenants?|customers'? data)\b/i],
  ["destructive_command", /\b(delete|drop|truncate|wipe|archive|merge)\b[^.\n]{0,30}\b(this|all|the)\b[^.\n]{0,20}\b(records?|tables?|database|documents?|deals?|contacts?)\b/i],
  ["exfiltrate", /\b(send|email|forward|upload|post)\b[^.\n]{0,30}\b(this|the)\b[^.\n]{0,20}\b(document|file|data|records?)\b[^.\n]{0,20}\b(to|at)\b/i],
  ["execute", /\b(execute|run|eval)\b[^.\n]{0,20}\b(this|the following)?\s*\b(command|code|script|shell|sql)\b/i],
];

export function sanitizeText(value) {
  let s = String(value);
  s = s.replace(/<(script|style|iframe|object)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<\/?[a-z][^>]*>/gi, " ");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  s = s.replace(/[ \t]{2,}/g, " ").trim();
  return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}… [truncated]` : s;
}

export function detectInjection(text) {
  return INJECTION_PATTERNS.filter(([, re]) => re.test(text)).map(([id]) => id);
}

// Data can't break out of its block or forge one.
export const escapeData = (s) => String(s).replace(/<\s*\/?\s*data\s*>/gi, (m) => m.replace(/</g, "&lt;").replace(/>/g, "&gt;"));

function maskValue(key, value) {
  const s = String(value);
  if (/email/i.test(key) && s.includes("@")) { const [u, d] = s.split("@"); return `${u.slice(0, 1)}***@${d}`; }
  if (/phone|mobile/i.test(key)) return `***${s.replace(/\D/g, "").slice(-4)}`;
  if (/name/i.test(key)) return `${s.trim().slice(0, 1)}.`;
  return "[masked]";
}

const pseudonym = (salt, key, value) => `${key.replace(/[^a-z]/gi, "").slice(0, 8) || "value"}-${crypto.createHmac("sha256", salt).update(String(value)).digest("hex").slice(0, 8)}`;

// ctx: { policy, rules (from getRedactionRules), useCase, providerKey,
//        hiddenFields: [names], hiddenClassifications: [classes], salt }
export function redact(input, ctx) {
  const restricted = restrictedFieldSet(ctx.policy);
  const providerClasses = new Set(allowedClassesFor(ctx.policy, ctx.providerKey));
  const useCaseClasses = new Set(ctx.useCase.allowedClassifications || []);
  const rules = Object.fromEntries((ctx.rules || []).map((r) => [r.classification, r.action]));
  const hiddenFields = new Set((ctx.hiddenFields || []).map((f) => f.toLowerCase()));
  const hiddenClasses = new Set(ctx.hiddenClassifications || []);
  const removed = new Set();
  const masked = new Set();
  const injection = new Set();

  const walk = (value, key, path) => {
    if (Array.isArray(value)) return value.map((v, i) => walk(v, key, `${path}[${i}]`)).filter((v) => v !== undefined);
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        const p = path ? `${path}.${k}` : k;
        const decided = decide(k, v);
        if (decided.remove) { removed.add(p.replace(/\[\d+\]/g, "[]")); continue; }
        if (decided.transform) { out[k] = decided.transform; masked.add(p.replace(/\[\d+\]/g, "[]")); continue; }
        const next = walk(v, k, p);
        if (next !== undefined) out[k] = next;
      }
      return out;
    }
    if (typeof value === "string") {
      const clean = sanitizeText(value);
      for (const f of detectInjection(clean)) injection.add(`${path}:${f}`);
      return escapeData(clean);
    }
    return value;
  };

  const decide = (k, v) => {
    const lower = k.toLowerCase();
    if (restricted.has(lower) || hiddenFields.has(lower)) return { remove: true };
    const cls = classifyField(k);
    if (NEVER_SENT.includes(cls) || hiddenClasses.has(cls)) return { remove: true };
    if (v !== null && typeof v !== "object" && cls !== "Internal") {
      if (!providerClasses.has(cls) || !useCaseClasses.has(cls)) return { remove: true };
      let action = rules[cls] || "Allow";
      if (cls === "Personal") action = ctx.policy.personalData === "Exclude" ? "Remove" : ctx.policy.personalData === "Pseudonymize" ? "Pseudonymize" : action;
      if (action === "Remove") return { remove: true };
      if (action === "Mask") return { transform: maskValue(k, v) };
      if (action === "Pseudonymize") return { transform: pseudonym(ctx.salt || "ai", k, v) };
    }
    return {};
  };

  const value = walk(input, "", "");
  return { value, removedFields: [...removed].sort(), maskedFields: [...masked].sort(), injectionFlags: [...injection].sort() };
}

// Shrinks the largest arrays until the serialized size fits.
export function fitToSize(variables, maxChars) {
  let v = structuredClone(variables);
  let truncated = false;
  const size = () => JSON.stringify(v).length;
  for (let guard = 0; size() > maxChars && guard < 60; guard += 1) {
    let largest = null;
    const visit = (node, setter) => {
      if (Array.isArray(node)) {
        if (node.length > 1 && (!largest || node.length > largest.node.length)) largest = { node, setter };
        node.forEach((n, i) => visit(n, (x) => { node[i] = x; }));
      } else if (node && typeof node === "object") for (const [k, n] of Object.entries(node)) visit(n, (x) => { node[k] = x; });
    };
    visit(v, (x) => { v = x; });
    if (!largest) break;
    largest.setter(largest.node.slice(0, Math.max(1, Math.floor(largest.node.length / 2))));
    truncated = true;
  }
  const chars = size();
  if (chars > maxChars) throw new AiError(CATEGORIES.INVALID_REQUEST, `The request is too large for this use case (${chars} characters; the limit is ${maxChars}).`);
  return { variables: v, truncated, chars };
}

// {{name}} placeholders; objects are serialized as JSON.
export function renderTemplate(text, variables) {
  return String(text).replace(/\{\{(\w+)\}\}/g, (_m, name) => {
    const v = variables[name];
    if (v === undefined || v === null) return "";
    return typeof v === "string" ? v : JSON.stringify(v, null, 1);
  });
}
