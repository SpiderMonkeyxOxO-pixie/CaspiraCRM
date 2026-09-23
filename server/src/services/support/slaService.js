// SLA clocks (Backend Phase 4, full spec). Called by the ticket workflow
// inside its transactions; every function takes the transaction client.
//
// Which policy applies (deterministic, in this order):
//   1. the company's active Support Entitlement (valid dates; if it's tied
//      to a contract, the contract must be Signed and not expired),
//      earliest-starting-latest first, then oldest record;
//   2. the ticket queue's default SLA policy (its current version);
//   3. otherwise the built-in windows (SLA_HOURS), counted 24/7.
//
// Targets are minutes. A policy version with businessHours counts only
// working time in its frozen calendar snapshot (see businessHours.js).
//
// Clock rules:
//   First Response — met by the first customer-visible AGENT reply. Internal
//     notes and system events never count; the server's clock sets the time.
//   Next Response  — starts when the customer writes after that; met by the
//     next agent reply (only if the policy defines nextResponseMinutes).
//   Resolution     — met by resolving. Paused while the ticket is in one of
//     the policy's pauseStatuses (default: "Waiting for Customer"); "Waiting
//     for Internal Team" keeps it running. Reopening starts a new
//     Resolution clock; closing, cancelling, archiving or merging cancels
//     whatever is still open.
// A breach is recorded at the moment the due time passed (not when it was
// noticed), and a priority change only reschedules clocks that haven't
// already breached — history is never rewritten.
import { addBusinessMinutes, businessMinutesBetween } from "./businessHours.js";
import { SLA_HOURS } from "./ticketLifecycleService.js";
import { ticketEvent } from "./supportCommon.js";

export const DEFAULT_PAUSE_STATUSES = ["Waiting for Customer"];
export const DEFAULT_WARNING_PERCENT = 80;
const OPEN_STATES = ["Running", "Paused"];

export function defaultTargets(priority) {
  const h = SLA_HOURS[priority] || SLA_HOURS.Medium;
  return { firstResponseMinutes: h.response * 60, resolutionMinutes: h.resolution * 60 };
}

export function targetsFor(version, priority) {
  if (!version) return defaultTargets(priority);
  const t = version.targets?.[priority] || version.targets?.Medium;
  return t || defaultTargets(priority);
}

const calendarOf = (version) => (version?.businessHours ? version.calendarSnapshot : null);
const warningPercent = (version) => version?.warningPercent ?? DEFAULT_WARNING_PERCENT;
const pauseStatuses = (version) => (Array.isArray(version?.pauseStatuses) ? version.pauseStatuses : DEFAULT_PAUSE_STATUSES);

export function schedule({ startedAt, targetMinutes, pausedMinutes = 0, calendar, warnPct }) {
  return {
    dueAt: addBusinessMinutes(startedAt, targetMinutes + pausedMinutes, calendar),
    warnAt: addBusinessMinutes(startedAt, Math.floor((targetMinutes * warnPct) / 100) + pausedMinutes, calendar),
  };
}

// An entitlement grants support only while it and its contract are valid.
export async function findEntitlement(tx, organizationId, companyId, at = new Date()) {
  if (!companyId) return null;
  const candidates = await tx.supportEntitlement.findMany({
    where: { organizationId, companyId, active: true, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "asc" }],
  });
  for (const e of candidates) {
    if (!e.contractId) return e;
    const contract = await tx.contract.findFirst({ where: { id: e.contractId, organizationId } });
    if (contract && contractGrantsSupport(contract, at)) return e;
  }
  return null;
}

export function contractGrantsSupport(contract, at = new Date()) {
  if (contract.status !== "Signed") return false;
  if (contract.effectiveDate && new Date(contract.effectiveDate) > at) return false;
  if (contract.endDate && new Date(contract.endDate) < at) return false;
  return true;
}

async function resolvePolicy(tx, ticket) {
  let entitlement = null;
  if (ticket.entitlementId) entitlement = await tx.supportEntitlement.findFirst({ where: { id: ticket.entitlementId, organizationId: ticket.organizationId } });
  else entitlement = await findEntitlement(tx, ticket.organizationId, ticket.companyId, ticket.createdAt || new Date());
  if (entitlement?.slaPolicyVersionId) {
    const version = await tx.slaPolicyVersion.findUnique({ where: { id: entitlement.slaPolicyVersionId } });
    if (version) return { version, entitlement };
  }
  if (ticket.queueId) {
    const queue = await tx.supportQueue.findUnique({ where: { id: ticket.queueId } });
    if (queue?.defaultSlaPolicyId) {
      const policy = await tx.slaPolicy.findFirst({ where: { id: queue.defaultSlaPolicyId, active: true, archivedAt: null } });
      if (policy?.currentVersionId) {
        const version = await tx.slaPolicyVersion.findUnique({ where: { id: policy.currentVersionId } });
        if (version) return { version, entitlement };
      }
    }
  }
  return { version: null, entitlement };
}

async function versionOf(tx, ticket) {
  return ticket.slaPolicyVersionId ? tx.slaPolicyVersion.findUnique({ where: { id: ticket.slaPolicyVersionId } }) : null;
}

async function createClock(tx, ticket, version, targetType, targetMinutes, startedAt) {
  const calendar = calendarOf(version);
  const { dueAt, warnAt } = schedule({ startedAt, targetMinutes, calendar, warnPct: warningPercent(version) });
  return tx.slaClock.create({
    data: {
      organizationId: ticket.organizationId, ticketId: ticket.id, policyVersionId: version?.id || null, targetType, targetMinutes,
      businessHours: !!calendar, calendarSnapshot: calendar, startedAt, dueAt, warnAt, state: "Running",
    },
  });
}

// Mirrors the open clocks onto the ticket's legacy deadline fields, which
// the frontend's SLA badges read.
async function syncTicketDeadlines(tx, ticketId) {
  const clocks = await tx.slaClock.findMany({ where: { ticketId, targetType: { in: ["First Response", "Resolution"] } }, orderBy: { createdAt: "desc" } });
  const latest = (type) => clocks.find((c) => c.targetType === type);
  const fr = latest("First Response");
  const res = latest("Resolution");
  await tx.ticket.update({ where: { id: ticketId }, data: { slaResponseDeadline: fr?.dueAt ?? null, slaResolutionDeadline: res?.dueAt ?? null } });
}

export async function startClocks(tx, ticket) {
  const { version, entitlement } = await resolvePolicy(tx, ticket);
  const targets = targetsFor(version, ticket.priority);
  const startedAt = ticket.createdAt || new Date();
  if (targets.firstResponseMinutes) await createClock(tx, ticket, version, "First Response", targets.firstResponseMinutes, startedAt);
  if (targets.resolutionMinutes) await createClock(tx, ticket, version, "Resolution", targets.resolutionMinutes, startedAt);
  await tx.ticket.update({ where: { id: ticket.id }, data: { slaPolicyVersionId: version?.id || null, entitlementId: entitlement?.id || ticket.entitlementId || null } });
  await syncTicketDeadlines(tx, ticket.id);
  await ticketEvent(tx, {
    organizationId: ticket.organizationId, ticketId: ticket.id, eventType: "SLA Applied", actorType: "System",
    snapshot: {
      policyVersionId: version?.id || null, versionNumber: version?.versionNumber || null, source: version ? (entitlement?.slaPolicyVersionId === version.id ? "Entitlement" : "Queue") : "Built-in windows",
      entitlementId: entitlement?.id || null, targets, businessHours: !!calendarOf(version), timeZone: version?.timeZone || "UTC",
    },
  });
}

async function completeClocks(tx, ticket, types, at, { cancel = false } = {}) {
  const clocks = await tx.slaClock.findMany({ where: { ticketId: ticket.id, targetType: { in: types }, completedAt: null, state: { in: [...OPEN_STATES, "Breached"] } } });
  for (const c of clocks) {
    if (cancel && c.state !== "Breached") {
      await tx.slaClock.update({ where: { id: c.id }, data: { state: "Cancelled", completedAt: at, lastCalculatedAt: at } });
      continue;
    }
    const late = c.state !== "Paused" && c.dueAt < at;
    const breachedAt = c.breachedAt || (late ? c.dueAt : null);
    await tx.slaClock.update({ where: { id: c.id }, data: { completedAt: at, breachedAt, state: breachedAt ? "Breached" : "Met", lastCalculatedAt: at } });
    await ticketEvent(tx, {
      organizationId: ticket.organizationId, ticketId: ticket.id, eventType: breachedAt ? "SLA Completed Late" : "SLA Met", actorType: "System",
      snapshot: { clockId: c.id, targetType: c.targetType, dueAt: c.dueAt }, dedupeKey: `sla:${c.id}:completed`,
    });
  }
}

export async function onPublicAgentReply(tx, ticket, at = new Date()) {
  await completeClocks(tx, ticket, ["First Response", "Next Response"], at);
}

// The customer wrote again after being answered: the next agent reply is due.
export async function onCustomerMessage(tx, ticket, at = new Date()) {
  const version = await versionOf(tx, ticket);
  const minutes = targetsFor(version, ticket.priority).nextResponseMinutes;
  if (!minutes || !ticket.firstRespondedAt) return;
  const open = await tx.slaClock.findFirst({ where: { ticketId: ticket.id, targetType: "Next Response", completedAt: null } });
  if (open) return;
  await createClock(tx, ticket, version, "Next Response", minutes, at);
}

export async function onStatusChange(tx, ticket, fromStatus, at = new Date()) {
  const version = await versionOf(tx, ticket);
  const pausing = pauseStatuses(version);
  const clock = await tx.slaClock.findFirst({ where: { ticketId: ticket.id, targetType: "Resolution", completedAt: null, state: { in: OPEN_STATES } }, orderBy: { createdAt: "desc" } });
  if (!clock) return;
  if (pausing.includes(ticket.status) && clock.state === "Running") {
    await tx.slaClock.update({ where: { id: clock.id }, data: { state: "Paused", pausedAt: at, lastCalculatedAt: at } });
    await ticketEvent(tx, { organizationId: ticket.organizationId, ticketId: ticket.id, eventType: "SLA Paused", actorType: "System", reason: `Status "${ticket.status}"`, snapshot: { clockId: clock.id } });
  } else if (!pausing.includes(ticket.status) && clock.state === "Paused") {
    await resumeClock(tx, ticket, clock, at);
  }
}

export async function resumeClock(tx, ticket, clock, at = new Date()) {
  const calendar = clock.calendarSnapshot || null;
  const pausedMinutes = clock.pausedMinutes + businessMinutesBetween(clock.pausedAt, at, calendar);
  const version = clock.policyVersionId ? await tx.slaPolicyVersion.findUnique({ where: { id: clock.policyVersionId } }) : null;
  const { dueAt, warnAt } = schedule({ startedAt: clock.startedAt, targetMinutes: clock.targetMinutes, pausedMinutes, calendar, warnPct: warningPercent(version) });
  await tx.slaClock.update({ where: { id: clock.id }, data: { state: "Running", pausedAt: null, pausedMinutes, dueAt, warnAt, lastCalculatedAt: at } });
  await ticketEvent(tx, { organizationId: ticket.organizationId, ticketId: ticket.id, eventType: "SLA Resumed", actorType: "System", snapshot: { clockId: clock.id, pausedMinutes, dueAt } });
  await syncTicketDeadlines(tx, ticket.id);
}

// Reschedules future deadlines only — a clock that already breached keeps
// its breach.
export async function onPriorityChange(tx, ticket, oldPriority) {
  const version = await versionOf(tx, ticket);
  const targets = targetsFor(version, ticket.priority);
  const keyFor = { "First Response": "firstResponseMinutes", "Next Response": "nextResponseMinutes", Resolution: "resolutionMinutes" };
  const clocks = await tx.slaClock.findMany({ where: { ticketId: ticket.id, completedAt: null, breachedAt: null, state: { in: OPEN_STATES } } });
  for (const c of clocks) {
    const targetMinutes = targets[keyFor[c.targetType]];
    if (!targetMinutes) continue;
    const { dueAt, warnAt } = schedule({ startedAt: c.startedAt, targetMinutes, pausedMinutes: c.pausedMinutes, calendar: c.calendarSnapshot || null, warnPct: warningPercent(version) });
    await tx.slaClock.update({ where: { id: c.id }, data: { targetMinutes, dueAt, warnAt, warnedAt: warnAt > new Date() ? null : c.warnedAt, lastCalculatedAt: new Date() } });
  }
  if (clocks.length) {
    await ticketEvent(tx, { organizationId: ticket.organizationId, ticketId: ticket.id, eventType: "SLA Recalculated", actorType: "System", fromValue: oldPriority, toValue: ticket.priority });
    await syncTicketDeadlines(tx, ticket.id);
  }
}

export async function onResolved(tx, ticket, at = new Date()) {
  await completeClocks(tx, ticket, ["Resolution"], at);
  // Resolved without ever replying publicly: first/next response weren't met — cancelled, not "Met".
  await completeClocks(tx, ticket, ["First Response", "Next Response"], at, { cancel: true });
}

export async function onReopened(tx, ticket, at = new Date()) {
  const version = await versionOf(tx, ticket);
  const minutes = targetsFor(version, ticket.priority).resolutionMinutes;
  if (minutes) await createClock(tx, { ...ticket, organizationId: ticket.organizationId }, version, "Resolution", minutes, at);
  await syncTicketDeadlines(tx, ticket.id);
}

export async function onFinished(tx, ticket, at = new Date()) {
  const clocks = await tx.slaClock.findMany({ where: { ticketId: ticket.id, completedAt: null, state: { in: OPEN_STATES } } });
  for (const c of clocks) await tx.slaClock.update({ where: { id: c.id }, data: { state: "Cancelled", completedAt: at, lastCalculatedAt: at } });
}
