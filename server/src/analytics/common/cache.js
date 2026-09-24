// Backend Phase 12 — scoped analytics result cache. Keys always include the
// organization, the caller's resolved scope and a per-organization data
// version; the worker bumps the version (in Redis) after every successful load,
// so API processes never serve results from before the latest load. Nothing
// here is shared across organizations or scopes.
import crypto from "node:crypto";
import redis from "../../lib/redis.js";

const TTL_MS = Number(process.env.ANALYTICS_CACHE_TTL_MS) || 5 * 60_000;
const MAX = 500;
const store = new Map();
const localVersion = new Map();

const verKey = (org) => `analytics:ver:${org}`;

export async function analyticsVersion(organizationId) {
  try {
    const v = await Promise.race([redis.get(verKey(organizationId)), new Promise((r) => setTimeout(() => r(null), 250))]);
    if (v !== null && v !== undefined) return String(v);
  } catch { /* fall back to the in-process version */ }
  return `l${localVersion.get(organizationId) || 0}`;
}

export async function bumpAnalyticsVersion(organizationId) {
  localVersion.set(organizationId, (localVersion.get(organizationId) || 0) + 1);
  try { await redis.incr(verKey(organizationId)); } catch { /* local bump still clears this process */ }
  for (const k of store.keys()) if (k.startsWith(`${organizationId}|`)) store.delete(k);
}

export function cacheKey(organizationId, version, parts) {
  return `${organizationId}|${version}|${crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) { store.delete(key); return null; }
  return hit.value;
}

export function cacheSet(key, value) {
  if (store.size >= MAX) store.delete(store.keys().next().value);
  store.set(key, { value, expires: Date.now() + TTL_MS });
}

export function clearAnalyticsCache() { store.clear(); }
