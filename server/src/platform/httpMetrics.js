// Backend Phase 13 — request telemetry for alerting: per-minute counters in
// Redis (requests, 4xx, 401, 403, 429, 5xx, slow requests, total latency and
// per-route slow counts). Fire-and-forget: telemetry never delays or fails a
// response. No paths with IDs, bodies or user data are recorded — routes
// are normalized to their pattern.
import redis from "../lib/redis.js";

const env = () => process.env.APP_ENV || "development";
const minute = (d = new Date()) => Math.floor(d.getTime() / 60000);
const SLOW_MS = () => Number(process.env.SLOW_REQUEST_MS) || 2000;

// /api/v1/crm/leads/abc123 → /api/v1/crm/leads/:id
export function normalizeRoute(path) {
  return String(path || "").split("?")[0].split("/").map((seg) => (/^[a-z]+_[A-Za-z0-9_-]{6,}$|^c[a-z0-9]{20,}$|^[0-9a-f-]{16,}$|^\d+$/.test(seg) ? ":id" : seg)).join("/").slice(0, 120);
}

export function httpMetrics(req, res, next) {
  if (process.env.APP_ENV === "test" || process.env.HTTP_METRICS === "false") return next();
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const m = minute();
    const k = `m:${env()}:${m}`;
    const s = res.statusCode;
    try {
      const p = redis.pipeline();
      p.hincrby(k, "requests", 1);
      p.hincrby(k, "latency_ms", Math.round(ms));
      if (s >= 500) p.hincrby(k, "status_5xx", 1);
      else if (s >= 400) p.hincrby(k, "status_4xx", 1);
      if (s === 401) p.hincrby(k, "status_401", 1);
      if (s === 403) p.hincrby(k, "status_403", 1);
      if (s === 429) p.hincrby(k, "status_429", 1);
      if (ms > SLOW_MS()) { p.hincrby(k, "slow", 1); p.zincrby(`m:${env()}:slow:${m}`, 1, `${req.method} ${normalizeRoute(req.baseUrl + req.path)}`); p.expire(`m:${env()}:slow:${m}`, 7200); }
      p.expire(k, 7200);
      p.exec().catch(() => {});
    } catch { /* telemetry is best-effort */ }
  });
  next();
}

// Sums the last `minutes` buckets → { requests, latency_ms, status_5xx, … }.
export async function httpWindow(minutes = 5, now = new Date()) {
  const end = minute(now);
  const p = redis.pipeline();
  for (let i = 0; i < minutes; i += 1) p.hgetall(`m:${env()}:${end - i}`);
  const rows = (await p.exec()).map(([, v]) => v || {});
  const sum = {};
  for (const r of rows) for (const [key, v] of Object.entries(r)) sum[key] = (sum[key] || 0) + Number(v);
  sum.errorRate = sum.requests ? sum.status_5xx / sum.requests : 0;
  sum.avgLatencyMs = sum.requests ? Math.round(sum.latency_ms / sum.requests) : 0;
  return sum;
}

export async function slowEndpoints(minutes = 60, now = new Date()) {
  const end = minute(now);
  const totals = {};
  for (let i = 0; i < minutes; i += 1) {
    const rows = await redis.zrange(`m:${env()}:slow:${end - i}`, 0, -1, "WITHSCORES");
    for (let j = 0; j < rows.length; j += 2) totals[rows[j]] = (totals[rows[j]] || 0) + Number(rows[j + 1]);
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([route, count]) => ({ route, count }));
}
