import { Queue } from "bullmq";
import redis from "../lib/redis.js";

// One queue, "email" — every OutboxEvent becomes a job here. BullMQ handles
// retry/backoff/concurrency; the `outbox_events` table stays the durable
// source of truth (see services/outboxService.js), so a lost Redis job can
// always be re-enqueued from a `Pending` row without losing anything.
export const EMAIL_QUEUE_NAME = "email";

export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 60 * 60 * 24, count: 1000 },
    removeOnFail: false, // keep failed jobs around for inspection
  },
});
