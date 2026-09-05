import Redis from "ioredis";

// Single shared ioredis connection, reused by BullMQ, rate limiting and any
// short-lived coordination. BullMQ requires `maxRetriesPerRequest: null` on
// connections it's handed.
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

redis.on("error", (err) => {
  console.error("[redis] connection error:", err.message);
});

export default redis;
