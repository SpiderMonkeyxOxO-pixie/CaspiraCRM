// Backend Phase 4 — deterministic Support reports. Every figure is computed
// from records the caller is allowed to see (the ticket scope is applied
// to the query BEFORE anything is counted), per organization, with the
// definition and — for rates — the numerator and denominator. A rate is
// only reported with at least MIN_SAMPLE records; below that it's
// "Insufficient data". Nothing here is a prediction or AI output.
import prisma from "../../lib/prisma.js";
import { ACTIVE_STATUSES } from "./ticketLifecycleService.js";

export const MIN_SAMPLE = 5;
const DAY = 86400000;
const AGE_BUCKETS = [
  { label: "Under 1 day", max: 1 },
  { label: "1–3 days", max: 3 },
  { label: "3–7 days", max: 7 },
  { label: "7–30 days", max: 30 },
  { label: "Over 30 days", max: Infinity },
];

export function rate(numerator, denominator) {
  if (denominator < MIN_SAMPLE) return { numerator, denominator, rate: null, note: `Insufficient data (fewer than ${MIN_SAMPLE})` };
  return { numerator, denominator, rate: Math.round((numerator / denominator) * 1000) / 10 };
}

export function ageBucket(createdAt, now) {
  const days = (now - new Date(createdAt)) / DAY;
  return AGE_BUCKETS.find((b) => days < b.max).label;
}

const avgMinutes = (pairs) => {
  if (!pairs.length) return null;
  return Math.round(pairs.reduce((s, [a, b]) => s + (new Date(b) - new Date(a)) / 60000, 0) / pairs.length);
};

const countBy = (rows, key) => rows.reduce((acc, r) => {
  const k = typeof key === "function" ? key(r) : r[key] ?? "None";
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

// scopeWhere: the caller's ticket scope (ticketService.ticketScopeWhere).
// Period filters tickets by creation date; backlog/open figures are "now".
export async function supportSummary({ organizationId, scopeWhere, from, to, now = new Date() }) {
  const base = { organizationId, archivedAt: null, ...scopeWhere };
  const period = { ...base, createdAt: { gte: from, lte: to } };

  const [open, periodTickets, clocks, csat, articles] = await Promise.all([
    prisma.ticket.findMany({ where: { ...base, status: { in: ACTIVE_STATUSES } }, select: { status: true, priority: true, queueId: true, assignedMembershipId: true, createdAt: true, companyId: true } }),
    prisma.ticket.findMany({ where: period, select: { id: true, status: true, createdAt: true, firstRespondedAt: true, resolvedAt: true, reopenedAt: true, companyId: true, relatedContractId: true } }),
    prisma.slaClock.findMany({ where: { organizationId, ticket: base }, select: { targetType: true, state: true, completedAt: true, breachedAt: true, dueAt: true, startedAt: true } }),
    prisma.ticketSatisfaction.findMany({ where: { organizationId, status: "Valid", ticket: period }, select: { rating: true } }),
    prisma.kbArticle.findMany({ where: { organizationId, status: "Published" }, select: { id: true, title: true, viewCount: true }, orderBy: { viewCount: "desc" }, take: 5 }),
  ]);

  const completedIn = (type) => clocks.filter((c) => c.targetType === type && c.completedAt && c.completedAt >= from && c.completedAt <= to);
  const compliance = (type) => {
    const done = completedIn(type);
    return rate(done.filter((c) => !c.breachedAt).length, done.length);
  };
  const soon = new Date(now.getTime() + 4 * 3600000);

  return {
    period: { from, to },
    definitions: {
      open: "Tickets in New, Open, In Progress or a Waiting status, now.",
      firstResponseMinutes: "Average minutes from creation to the first public agent reply, for tickets created in the period that have one.",
      resolutionMinutes: "Average minutes from creation to resolution, for tickets created in the period that are resolved.",
      slaCompliance: "Of SLA clocks completed in the period, the share completed without breaching. Internal notes never count as responses.",
      backlogAging: "Open tickets by time since creation.",
    },
    open: open.length,
    new: open.filter((t) => t.status === "New").length,
    unassigned: open.filter((t) => !t.assignedMembershipId).length,
    waitingForCustomer: open.filter((t) => t.status === "Waiting for Customer").length,
    waitingForInternalTeam: open.filter((t) => t.status === "Waiting for Internal Team").length,
    byStatus: countBy(open, "status"),
    byPriority: countBy(open, "priority"),
    byQueue: countBy(open, (t) => t.queueId || "No queue"),
    byAgent: countBy(open, (t) => t.assignedMembershipId || "Unassigned"),
    backlogAging: countBy(open, (t) => ageBucket(t.createdAt, now)),
    createdInPeriod: periodTickets.length,
    reopenedInPeriod: periodTickets.filter((t) => t.reopenedAt).length,
    averageFirstResponseMinutes: avgMinutes(periodTickets.filter((t) => t.firstRespondedAt).map((t) => [t.createdAt, t.firstRespondedAt])),
    averageResolutionMinutes: avgMinutes(periodTickets.filter((t) => t.resolvedAt).map((t) => [t.createdAt, t.resolvedAt])),
    firstResponseSla: compliance("First Response"),
    resolutionSla: compliance("Resolution"),
    activeBreaches: clocks.filter((c) => c.state === "Breached" && !c.completedAt).length,
    upcomingBreaches: clocks.filter((c) => c.state === "Running" && c.dueAt > now && c.dueAt <= soon).length,
    companyVolume: Object.entries(countBy(periodTickets.filter((t) => t.companyId), "companyId")).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([companyId, count]) => ({ companyId, count })),
    contractRelatedTickets: periodTickets.filter((t) => t.relatedContractId).length,
    satisfaction: csat.length >= MIN_SAMPLE
      ? { responses: csat.length, average: Math.round((csat.reduce((s, r) => s + r.rating, 0) / csat.length) * 10) / 10, scale: "1–5" }
      : { responses: csat.length, average: null, scale: "1–5", note: `Insufficient data (fewer than ${MIN_SAMPLE})` },
    topArticles: articles.map((a) => ({ articleId: a.id, title: a.title, views: a.viewCount })),
  };
}
