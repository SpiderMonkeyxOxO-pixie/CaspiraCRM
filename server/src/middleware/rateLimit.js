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
      prefix: "rl:",
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
