import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import redis from "../lib/redis.js";

function redisRateLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Keyed by IP + attempted username/email where available, so one
    // attacker can't lock out every user sharing their IP (a NAT/office),
    // while still bounding a single account's own attempt rate. IPv6
    // addresses are normalized via ipKeyGenerator so a /64 can't be used to
    // cycle through addresses and dodge the limit.
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.email || req.body?.username || "").toLowerCase()}`,
    store: new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix: process.env.RATE_LIMIT_PREFIX || "rl:",
    }),
    handler: (_req, res) => {
      res.status(429).json({ code: "RATE_LIMITED", message: message || "Too many requests — please try again later." });
    },
  });
}

export const loginRateLimit = redisRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Please wait before trying again.",
});

export const passwordResetRateLimit = redisRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many password reset requests. Please wait before trying again.",
});

export const invitationAcceptRateLimit = redisRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many attempts. Please wait before trying again.",
});

// Backend Phase 13 — a general per-client API ceiling (credential stuffing,
// scraping, runaway clients). On in staging/production; set
// API_RATE_LIMIT_PER_MINUTE=0 to turn off, or a number to tune.
export function apiRateLimitEnabled(env = process.env) {
  if (env.API_RATE_LIMIT_PER_MINUTE === "0") return false;
  return ["staging", "production"].includes(env.APP_ENV) || !!env.API_RATE_LIMIT_PER_MINUTE;
}
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: () => Number(process.env.API_RATE_LIMIT_PER_MINUTE) || 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `api:${ipKeyGenerator(req.ip)}`,
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix: process.env.RATE_LIMIT_PREFIX || "rl:" }),
  // Health probes are exempt so an attack can't mark the service unhealthy.
  skip: (req) => ["/health", "/ready", "/api/v1/health"].includes(req.path),
  handler: (req, res) => res.status(429).json({ code: "RATE_LIMITED", message: "Too many requests — please try again later.", correlationId: req.correlationId }),
});
