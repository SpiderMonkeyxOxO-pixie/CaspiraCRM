import prisma from "../lib/prisma.js";
import { emailQueue } from "../queues/emailQueue.js";

// Transactional outbox: call this INSIDE the same Prisma `$transaction` as
// the business mutation it accompanies (e.g. creating an Invitation), never
// as a separate write and never by calling sendMail() directly inside a
// transaction. `tx` is the transaction client passed into the callback.
export async function recordOutboxEvent(tx, { aggregateType, aggregateId, eventType, payload }) {
  return (tx || prisma).outboxEvent.create({
    data: { aggregateType, aggregateId, eventType, payload, status: "Pending" },
  });
}

// Picks up any `Pending` outbox rows not yet enqueued (first attempt, or a
// worker restart that lost in-memory BullMQ state) and pushes them onto the
// queue. Job data carries `outboxEventId` so the worker can mark the row
// `Sent`/`Failed` once BullMQ's own retries are exhausted. Marking `status:
// "Processing"` here (rather than leaving it `Pending`) makes re-polling
// while jobs are in flight a no-op instead of a duplicate enqueue.
export async function drainOutbox(limit = 25) {
  const pending = await prisma.outboxEvent.findMany({
    where: { status: "Pending", availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (const event of pending) {
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { status: "Processing", attempts: { increment: 1 } },
    });
    const payload = event.payload || {};
    await emailQueue.add(event.eventType, { ...payload, outboxEventId: event.id });
  }
  return pending.length;
}
