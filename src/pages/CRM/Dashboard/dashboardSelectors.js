// Pure, framework-agnostic dashboard calculations. Every function here takes
// the already-loaded shared fixture arrays (leads/companies/deals/
// activities/tickets/invoices — the exact same arrays every other completed
// CRM route reads and writes) plus a resolved date range, and returns plain
// data for the widgets to render as-is. Kept out of the visual components on
// purpose ("keep calculations outside the visual components; do not repeat
// calculation logic across cards and charts") — every widget and every test
// calls into this one file instead of recomputing anything itself.
import { DEAL_STAGES } from "../../../redux/crm/dealsSlice";
import { computeDealRiskReasons, isStaleDeal } from "../Deals/dealUtils";
import { effectiveStatus } from "../../../redux/crm/activitiesSlice";
import { LEAD_SOURCES } from "../../../Helpers/mockCrmData";

export { LEAD_SOURCES };

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------
export const DATE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "thisQuarter", label: "This Quarter" },
  { value: "ytd", label: "Year to Date" },
  { value: "custom", label: "Custom Range" },
];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

export function resolveDateRange(preset, customFrom, customTo, now = new Date()) {
  switch (preset) {
    case "today": {
      const from = startOfDay(now);
      return { from, to: addDays(from, 1), label: "Today" };
    }
    case "last7": {
      const from = addDays(startOfDay(now), -6);
      return { from, to: addDays(startOfDay(now), 1), label: "Last 7 Days" };
    }
    case "lastMonth": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from, to, label: from.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
    }
    case "thisQuarter": {
      const q = Math.floor(now.getMonth() / 3);
      const from = new Date(now.getFullYear(), q * 3, 1);
      const to = new Date(now.getFullYear(), q * 3 + 3, 1);
      return { from, to, label: `Q${q + 1} ${now.getFullYear()}` };
    }
    case "ytd": {
      const from = new Date(now.getFullYear(), 0, 1);
      return { from, to: addDays(startOfDay(now), 1), label: `Year to Date (${now.getFullYear()})` };
    }
    case "custom": {
      const from = customFrom ? startOfDay(new Date(customFrom)) : new Date(0);
      const to = customTo ? addDays(startOfDay(new Date(customTo)), 1) : addDays(startOfDay(now), 1);
      return { from, to, label: `${from.toLocaleDateString()} – ${addDays(to, -1).toLocaleDateString()}` };
    }
    case "thisMonth":
    default: {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from, to, label: from.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
    }
  }
}

// The immediately-preceding, same-length window — used for "previous period"
// KPI comparisons. Works for every preset, including custom ranges.
export function previousPeriod(range) {
  const durationMs = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - durationMs), to: new Date(range.from.getTime()) };
}

function inRange(dateStr, range) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= range.from && d < range.to;
}

// A comparison is only shown when the previous period actually has data —
// otherwise a 0→N or 0→0 change reads as a fabricated "+100%"/"+0%".
export function compareToPrevious(current, previous) {
  if (previous === 0 || previous === null || previous === undefined) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Money — every summing function groups by currency instead of silently
// combining them into one unexplained total.
// ---------------------------------------------------------------------------
export function sumByCurrency(items, valueFn) {
  const map = {};
  for (const item of items) {
    const cur = item.currency || "USD";
    map[cur] = (map[cur] || 0) + (Number(valueFn(item)) || 0);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
const LEAD_NON_CONVERTED_TERMINAL = ["Unqualified", "Duplicate", "Spam"];

export function filterLeads(leads, filters = {}) {
  return leads.filter((l) => {
    if (l.archived) return false;
    if (filters.ownerId === "me" ? !filters.currentOwnerId || l.ownerId !== filters.currentOwnerId : filters.ownerId === "unassigned" ? l.ownerId : filters.ownerId && l.ownerId !== filters.ownerId) return false;
    if (filters.team && l.department !== filters.team) return false;
    if (filters.source && l.source !== filters.source) return false;
    return true;
  });
}

export function computeNewLeads(leads, range) {
  const inWindow = leads.filter((l) => inRange(l.createdAt, range));
  return { count: inWindow.length, leads: inWindow };
}

export function computeLeadConversion(leads, range) {
  const eligible = leads.filter((l) => inRange(l.createdAt, range) && !LEAD_NON_CONVERTED_TERMINAL.includes(l.status));
  const converted = eligible.filter((l) => l.status === "Converted");
  return {
    rate: eligible.length ? Math.round((converted.length / eligible.length) * 1000) / 10 : null,
    convertedCount: converted.length,
    eligibleCount: eligible.length,
  };
}

export function computeLeadSourcePerformance(leads, deals) {
  return LEAD_SOURCES.map((source) => {
    const sourceLeads = leads.filter((l) => l.source === source && !l.archived);
    const qualified = sourceLeads.filter((l) => ["Qualified", "Converted"].includes(l.status));
    const converted = sourceLeads.filter((l) => l.status === "Converted");
    const dealIds = converted.map((l) => l.convertedTo?.dealId).filter(Boolean);
    const relatedOpenDeals = deals.filter((d) => dealIds.includes(d._id) && d.status === "Open");
    return {
      source,
      leadCount: sourceLeads.length,
      qualifiedCount: qualified.length,
      convertedCount: converted.length,
      conversionRate: sourceLeads.length ? Math.round((converted.length / sourceLeads.length) * 1000) / 10 : 0,
      pipelineValueByCurrency: sumByCurrency(relatedOpenDeals, (d) => d.value),
    };
  }).filter((s) => s.leadCount > 0);
}

// ---------------------------------------------------------------------------
// Deals / Pipeline
// ---------------------------------------------------------------------------
export function filterDeals(deals, filters = {}) {
  return deals.filter((d) => {
    if (d.archived) return false;
    if (filters.pipeline && d.pipeline !== filters.pipeline) return false;
    if (filters.ownerId === "me" ? !filters.currentOwnerId || d.ownerId !== filters.currentOwnerId : filters.ownerId === "unassigned" ? d.ownerId : filters.ownerId && d.ownerId !== filters.ownerId) return false;
    if (filters.team && d.assignedTeam !== filters.team) return false;
    if (filters.companyId && d.companyId !== filters.companyId) return false;
    if (filters.currency && d.currency !== filters.currency) return false;
    return true;
  });
}

export function computeOpenPipeline(deals) {
  const open = deals.filter((d) => d.status === "Open");
  return { count: open.length, valueByCurrency: sumByCurrency(open, (d) => d.value), deals: open };
}

export function computeWeightedPipeline(deals) {
  const open = deals.filter((d) => d.status === "Open");
  return { valueByCurrency: sumByCurrency(open, (d) => d.weightedValue) };
}

export function computeWonDeals(deals, range) {
  const won = deals.filter((d) => d.status === "Won" && inRange(d.actualClosingDate, range));
  return { count: won.length, valueByCurrency: sumByCurrency(won, (d) => d.value), deals: won };
}

export function computeLostDeals(deals, range) {
  const lost = deals.filter((d) => d.status === "Lost" && inRange(d.actualClosingDate, range));
  return { count: lost.length, valueByCurrency: sumByCurrency(lost, (d) => d.value), deals: lost };
}

export function computeAvgDealSize(deals) {
  const open = deals.filter((d) => d.status === "Open");
  const totals = {};
  const counts = {};
  for (const d of open) {
    const cur = d.currency || "USD";
    totals[cur] = (totals[cur] || 0) + d.value;
    counts[cur] = (counts[cur] || 0) + 1;
  }
  const avg = {};
  for (const cur of Object.keys(totals)) avg[cur] = Math.round(totals[cur] / counts[cur]);
  return avg;
}

export function computeDealsClosingThisPeriod(deals, range) {
  const closing = deals.filter((d) => d.status === "Open" && inRange(d.expectedClosingDate, range));
  return { count: closing.length, valueByCurrency: sumByCurrency(closing, (d) => d.value), deals: closing };
}

export function computeAtRiskAndStaleDeals(deals, lastActivityAtFn) {
  return deals
    .filter((d) => d.status === "Open")
    .map((d) => {
      const lastActivityAt = lastActivityAtFn ? lastActivityAtFn(d._id) : null;
      return { deal: d, reasons: computeDealRiskReasons(d, { lastActivityAt }), stale: isStaleDeal(d, lastActivityAt) };
    })
    .filter((x) => x.reasons.length > 0);
}

export function computePipelineStageTotals(deals) {
  const openStages = DEAL_STAGES.filter((s) => s !== "Won");
  return openStages.map((stage) => {
    const stageDeals = deals.filter((d) => d.stage === stage && d.status === "Open");
    return {
      stage,
      count: stageDeals.length,
      valueByCurrency: sumByCurrency(stageDeals, (d) => d.value),
      weightedByCurrency: sumByCurrency(stageDeals, (d) => d.weightedValue),
    };
  });
}

const FUNNEL_STAGE_ORDER = ["Discovery", "Qualified", "Proposal", "Negotiation", "Approval"];

// Counts reflect deals CURRENTLY open at or beyond each stage, plus deals
// already Won (since being Won implies having passed every earlier stage) —
// a defensible current-snapshot funnel, not a historical cohort funnel.
export function computeSalesFunnel(leads, deals, range) {
  const leadsInRange = leads.filter((l) => !l.archived && inRange(l.createdAt, range));
  const newLeadsCount = leadsInRange.length;
  const qualifiedLeadsCount = leadsInRange.filter((l) => ["Qualified", "Converted"].includes(l.status)).length;

  const reachedOrWon = (stage) => {
    const idx = FUNNEL_STAGE_ORDER.indexOf(stage);
    return deals.filter((d) => d.status === "Won" || (d.status === "Open" && FUNNEL_STAGE_ORDER.indexOf(d.stage) >= idx)).length;
  };
  const openDealsCount = deals.filter((d) => d.status === "Open").length;
  const wonCount = deals.filter((d) => d.status === "Won").length;

  return [
    { key: "newLeads", label: "New Leads", count: newLeadsCount, to: "/crm/leads?status=New" },
    { key: "qualifiedLeads", label: "Qualified Leads", count: qualifiedLeadsCount, to: "/crm/leads?status=Qualified" },
    { key: "openDeals", label: "Open Deals", count: openDealsCount, to: "/crm/deals?status=Open" },
    { key: "proposal", label: "Proposal", count: reachedOrWon("Proposal"), to: "/crm/deals?stage=Proposal" },
    { key: "negotiation", label: "Negotiation", count: reachedOrWon("Negotiation"), to: "/crm/deals?stage=Negotiation" },
    { key: "approval", label: "Approval", count: reachedOrWon("Approval"), to: "/crm/deals?stage=Approval" },
    { key: "won", label: "Won", count: wonCount, to: "/crm/deals?status=Won" },
  ];
}

const FORECAST_BUCKET_ORDER = ["overdue", "thisWeek", "thisMonth", "nextMonth", "later"];
export const FORECAST_BUCKET_LABELS = {
  overdue: "Overdue", thisWeek: "This Week", thisMonth: "This Month", nextMonth: "Next Month", later: "Later",
};

export function computeForecastBuckets(deals, now = new Date()) {
  const today = startOfDay(now);
  const endOfWeek = addDays(today, 7);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  const buckets = { overdue: [], thisWeek: [], thisMonth: [], nextMonth: [], later: [] };
  for (const d of deals) {
    if (d.status !== "Open" || !d.expectedClosingDate) continue;
    const date = new Date(d.expectedClosingDate);
    if (date < today) buckets.overdue.push(d);
    else if (date < endOfWeek) buckets.thisWeek.push(d);
    else if (date < endOfMonth) buckets.thisMonth.push(d);
    else if (date < endOfNextMonth) buckets.nextMonth.push(d);
    else buckets.later.push(d);
  }
  // Boundaries double as the exact closingAfter/closingBefore query params
  // queryDealsLocal already supports, so each bucket's drill-down link uses
  // a real, working filter rather than an invented one-off flag.
  const bounds = {
    overdue: { closingBefore: today.toISOString(), closingOverdue: "true" },
    thisWeek: { closingAfter: today.toISOString(), closingBefore: endOfWeek.toISOString() },
    thisMonth: { closingAfter: today.toISOString(), closingBefore: endOfMonth.toISOString() },
    nextMonth: { closingAfter: endOfMonth.toISOString(), closingBefore: endOfNextMonth.toISOString() },
    later: { closingAfter: endOfNextMonth.toISOString() },
  };
  return FORECAST_BUCKET_ORDER.map((key) => ({
    key,
    label: FORECAST_BUCKET_LABELS[key],
    count: buckets[key].length,
    valueByCurrency: sumByCurrency(buckets[key], (d) => d.value),
    weightedByCurrency: sumByCurrency(buckets[key], (d) => d.weightedValue),
    deals: buckets[key],
    linkParams: bounds[key],
  }));
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------
export function filterActivities(activities, filters = {}) {
  return activities.filter((a) => {
    if (filters.ownerId === "me" ? !filters.currentOwnerId || a.ownerId !== filters.currentOwnerId : filters.ownerId === "unassigned" ? a.ownerId : filters.ownerId && a.ownerId !== filters.ownerId) return false;
    if (filters.team && a.assignedTeam !== filters.team) return false;
    return true;
  });
}

export function computeActivitiesDueToday(activities, now = new Date()) {
  const start = startOfDay(now);
  const end = addDays(start, 1);
  return activities.filter((a) => {
    const ref = a.dueDate || a.startAt;
    if (!ref || ["Completed", "Cancelled"].includes(a.status)) return false;
    const d = new Date(ref);
    return d >= start && d < end;
  });
}

export function computeOverdueActivities(activities) {
  return activities.filter((a) => effectiveStatus(a) === "Overdue");
}

export function computeUpcomingActivities(activities, days = 7, now = new Date()) {
  const end = addDays(startOfDay(now), days + 1);
  return activities.filter((a) => {
    const ref = a.dueDate || a.startAt;
    if (!ref || ["Completed", "Cancelled"].includes(a.status)) return false;
    const d = new Date(ref);
    return d >= addDays(startOfDay(now), 1) && d < end;
  });
}

export function computeRecentlyCompletedActivities(activities, days = 7, now = new Date()) {
  const start = addDays(now, -days);
  return activities
    .filter((a) => a.completedAt && new Date(a.completedAt) >= start)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------
export function computeCompaniesNeedingAttention(companies, tickets, invoices, lastActivityAtFn) {
  const results = [];
  const now = Date.now();
  for (const c of companies) {
    if (c.archived) continue;
    const reasons = [];
    if (c.accountHealth === "At Risk") reasons.push(c.healthReason ? `At-risk health: ${c.healthReason}` : "At-risk account health");
    if (c.nextFollowUp && new Date(c.nextFollowUp) < new Date()) reasons.push("Overdue follow-up");
    if (tickets.some((t) => t.companyId === c._id && t.priority === "Urgent" && !["Resolved", "Closed"].includes(t.status))) reasons.push("Open urgent support ticket");
    if (invoices.some((i) => i.companyId === c._id && i.amountDue > 0 && i.status !== "Paid")) reasons.push("Outstanding invoice");
    const lastActivity = lastActivityAtFn ? lastActivityAtFn(c._id) : null;
    if (!lastActivity || now - new Date(lastActivity).getTime() > 30 * 86400000) reasons.push("No recent activity");
    if (c.renewalDate) {
      const daysToRenewal = (new Date(c.renewalDate).getTime() - now) / 86400000;
      if (daysToRenewal > 0 && daysToRenewal <= 30) reasons.push("Upcoming renewal");
    }
    if (reasons.length) results.push({ company: c, reasons, lastActivity });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Team performance
// ---------------------------------------------------------------------------
export function computeTeamPerformance(team, leads, deals, activities, range) {
  return team.map((member) => {
    const memberLeads = leads.filter((l) => l.ownerId === member.id && !l.archived);
    const convertedLeads = memberLeads.filter((l) => l.status === "Converted");
    const memberDeals = deals.filter((d) => d.ownerId === member.id && !d.archived);
    const openDeals = memberDeals.filter((d) => d.status === "Open");
    const wonDeals = memberDeals.filter((d) => d.status === "Won" && inRange(d.actualClosingDate, range));
    const memberActivities = activities.filter((a) => a.ownerId === member.id);
    const completed = memberActivities.filter((a) => a.status === "Completed" && inRange(a.completedAt, range));
    const overdue = memberActivities.filter((a) => effectiveStatus(a) === "Overdue");
    return {
      owner: member,
      assignedLeads: memberLeads.length,
      convertedLeads: convertedLeads.length,
      openDealsCount: openDeals.length,
      pipelineValueByCurrency: sumByCurrency(openDeals, (d) => d.value),
      wonValueByCurrency: sumByCurrency(wonDeals, (d) => d.value),
      activitiesCompleted: completed.length,
      overdueActivities: overdue.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Recent CRM activity timeline
// ---------------------------------------------------------------------------
export function computeRecentCrmTimeline(leads, contacts, companies, deals, activities, limit = 15) {
  const events = [];
  for (const l of leads) {
    if (l.createdAt) events.push({ type: "lead_created", at: l.createdAt, label: `Lead created: ${l.name}`, to: `/crm/leads/${l._id}` });
    if (l.status === "Converted" && l.convertedTo) events.push({ type: "lead_converted", at: l.updatedAt, label: `Lead converted: ${l.name}`, to: `/crm/companies/${l.convertedTo.companyId}` });
  }
  for (const c of contacts) {
    if (c.createdAt) events.push({ type: "contact_added", at: c.createdAt, label: `Contact added: ${c.name}`, to: `/crm/contacts/${c._id}` });
  }
  for (const c of companies) {
    if (c.createdAt) events.push({ type: "company_created", at: c.createdAt, label: `Company created: ${c.name}`, to: `/crm/companies/${c._id}` });
  }
  for (const d of deals) {
    for (const h of d.stageHistory || []) {
      if (!h.from || !h.at) continue;
      const isOutcome = h.to === "Won" || h.to === "Lost";
      events.push({
        type: isOutcome ? (h.to === "Won" ? "deal_won" : "deal_lost") : "deal_stage_changed",
        at: h.at, label: `${d.name}: ${h.from} → ${h.to}`, to: `/crm/deals/${d._id}`,
      });
    }
  }
  for (const a of activities) {
    if (a.status === "Completed" && a.completedAt) events.push({ type: "activity_completed", at: a.completedAt, label: `${a.type} completed: ${a.title}`, to: null });
    if (a.type === "Follow-up" && a.createdAt) events.push({ type: "followup_scheduled", at: a.createdAt, label: `Follow-up scheduled: ${a.title}`, to: null });
  }
  return events.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
}
