// Backend Phase 4 — deterministic SLA sweep, run by the worker.
//
// - Breach: a running clock past its due time is marked Breached AT ITS DUE
//   TIME (not when the sweep noticed), so worker downtime never loses or
//   shifts a breach.
// - Warning: a running clock past its warning threshold (and not yet due)
//   gets a one-time warning.
// - Repair: a clock left paused while its ticket is no longer in a pausing
//   status is resumed.
// Every write is conditional (updateMany on the unchanged state) and every
// event carries a unique dedupeKey, so re-running creates no duplicates.
// The sweep never resolves tickets, changes priority or messages customers;
// it only records events, an audit entry and an internal notification.
import prisma from "../../lib/prisma.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { resumeClock, DEFAULT_PAUSE_STATUSES } from "../../services/support/slaService.js";

const BATCH = 500;

async function eventOnce(data) {
  try {
    await prisma.ticketEvent.create({ data });
    return true;
  } catch (err) {
    if (err?.code === "P2002") return false; // already recorded by an earlier run
    throw err;
  }
}

async function notify(aggregateId, eventType, payload) {
  const existing = await prisma.outboxEvent.findFirst({ where: { aggregateType: "Ticket", aggregateId, eventType, payload: { path: ["clockId"], equals: payload.clockId } } });
  if (existing) return;
  await prisma.outboxEvent.create({ data: { aggregateType: "Ticket", aggregateId, eventType, payload } });
}

export async function detectBreaches(now = new Date()) {
  let count = 0;
  const due = await prisma.slaClock.findMany({ where: { state: "Running", completedAt: null, breachedAt: null, dueAt: { lte: now } }, orderBy: { dueAt: "asc" }, take: BATCH });
  for (const clock of due) {
    const marked = await prisma.slaClock.updateMany({ where: { id: clock.id, state: "Running", breachedAt: null }, data: { state: "Breached", breachedAt: clock.dueAt, lastCalculatedAt: now } });
    if (marked.count !== 1) continue;
    count++;
    await eventOnce({
      organizationId: clock.organizationId, ticketId: clock.ticketId, eventType: "SLA Breached", actorType: "System",
      snapshot: { clockId: clock.id, targetType: clock.targetType, dueAt: clock.dueAt }, dedupeKey: `sla:${clock.id}:breached`,
    });
    await recordAuditEvent({ organizationId: clock.organizationId, action: "support.sla.breached", targetType: "Ticket", targetId: clock.ticketId, result: "Success", after: { clockId: clock.id, targetType: clock.targetType } });
    await notify(clock.ticketId, "support.sla.breached", { organizationId: clock.organizationId, clockId: clock.id, targetType: clock.targetType, dueAt: clock.dueAt, internalOnly: true });
  }
  return count;
}

export async function detectWarnings(now = new Date()) {
  let count = 0;
  const warn = await prisma.slaClock.findMany({ where: { state: "Running", completedAt: null, warnedAt: null, warnAt: { lte: now }, dueAt: { gt: now } }, take: BATCH });
  for (const clock of warn) {
    const marked = await prisma.slaClock.updateMany({ where: { id: clock.id, warnedAt: null, state: "Running" }, data: { warnedAt: now, lastCalculatedAt: now } });
    if (marked.count !== 1) continue;
    count++;
    await eventOnce({
      organizationId: clock.organizationId, ticketId: clock.ticketId, eventType: "SLA Warning", actorType: "System",
      snapshot: { clockId: clock.id, targetType: clock.targetType, dueAt: clock.dueAt }, dedupeKey: `sla:${clock.id}:warning:${clock.warnAt.toISOString()}`,
    });
    await recordAuditEvent({ organizationId: clock.organizationId, action: "support.sla.warning", targetType: "Ticket", targetId: clock.ticketId, result: "Success", after: { clockId: clock.id, targetType: clock.targetType } });
    await notify(clock.ticketId, "support.sla.warning", { organizationId: clock.organizationId, clockId: clock.id, targetType: clock.targetType, dueAt: clock.dueAt, internalOnly: true });
  }
  return count;
}

export async function repairPausedClocks(now = new Date()) {
  let count = 0;
  const paused = await prisma.slaClock.findMany({ where: { state: "Paused", completedAt: null }, include: { ticket: true }, take: BATCH });
  for (const clock of paused) {
    const version = clock.policyVersionId ? await prisma.slaPolicyVersion.findUnique({ where: { id: clock.policyVersionId } }) : null;
    const pausing = Array.isArray(version?.pauseStatuses) ? version.pauseStatuses : DEFAULT_PAUSE_STATUSES;
    if (pausing.includes(clock.ticket.status)) continue;
    await prisma.$transaction((tx) => resumeClock(tx, clock.ticket, clock, now));
    count++;
  }
  return count;
}

export async function runSlaSweep(now = new Date()) {
  const repaired = await repairPausedClocks(now);
  const breached = await detectBreaches(now);
  const warned = await detectWarnings(now);
  return { repaired, breached, warned };
}
