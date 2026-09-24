// Backend Phase 12 — warehouse source definitions. Each maps transactional
// rows to fact rows (IDs and approved reporting attributes only — no full
// sensitive payloads). Business dates use the organization's time zone;
// amounts keep the original currency plus a base-currency conversion at the
// rate effective on the business date.
import prisma from "../../lib/prisma.js";
import { businessDate, localYmd, toDateValue } from "../common/calendar.js";

const d2 = (v) => (v === null || v === undefined ? null : String(v));
const ymdDate = (instant, tz) => (instant ? businessDate(instant, tz) : null);
const pickScope = (row, { team = "team", department = "department", owner = "ownerMembershipId" } = {}) => ({
  ownerMembershipId: row[owner] || null, department: department ? row[department] || null : null, team: team ? row[team] || null : null,
});
const money = (ctx, amount, currency, date, prefix = "") => {
  const c = ctx.convert(amount, currency, date);
  return { [`${prefix}baseAmount`]: c.baseAmount === null ? null : String(c.baseAmount), rateDate: c.rateDate, rateVersion: c.rateVersion, conversionStatus: c.conversionStatus, baseCurrency: ctx.base };
};

export const SOURCES = {
  leads: {
    module: "leads", table: "analytics_fact_leads", model: "lead", watermark: "updatedAt",
    reconcile: { model: "lead", activeWhere: { archived: false, archivedAt: null } },
    map: (r, ctx) => ({
      organizationId: r.organizationId, sourceId: r.id, ...pickScope(r), businessDate: ymdDate(r.createdAt, ctx.tz), createdAt: r.createdAt,
      status: r.status, lifecycleStage: r.lifecycleStage, qualificationStatus: r.qualificationStatus, source: r.source, country: r.country,
      hasContactInfo: !!(r.email || r.phone), qualified: r.qualificationStatus === "Qualified" || ["Qualified", "Converted"].includes(r.status),
      converted: !!r.convertedAt || r.status === "Converted", convertedAt: r.convertedAt, convertedDate: ymdDate(r.convertedAt, ctx.tz), convertedDealId: r.convertedDealId,
      currency: r.currency, estimatedValue: r.estimatedValue === null || r.estimatedValue === undefined ? null : String(r.estimatedValue),
      isDeleted: !!(r.archived || r.archivedAt), sourceUpdatedAt: r.updatedAt, jobId: ctx.jobId,
    }),
  },
  activities: {
    module: "activities", table: "analytics_fact_activities", model: "activity", watermark: "updatedAt",
    reconcile: { model: "activity", activeWhere: { archivedAt: null } },
    map: (r, ctx) => {
      const due = r.dueDate || r.scheduledStart || null;
      return {
        organizationId: r.organizationId, sourceId: r.id, ownerMembershipId: r.ownerMembershipId, assignedMembershipId: r.assignedMembershipId, department: null, team: r.team,
        businessDate: ymdDate(r.createdAt, ctx.tz), createdAt: r.createdAt, type: r.type, status: r.status, dueAt: due, dueDate: ymdDate(due, ctx.tz),
        completedAt: r.completedAt, completedDate: ymdDate(r.completedAt, ctx.tz), companyId: r.companyId, dealId: r.dealId, leadId: r.leadId,
        followUpRequired: !!r.followUpRequired, followUpDate: r.followUpDate, followUpActivityId: r.followUpActivityId,
        isDeleted: !!r.archivedAt, sourceUpdatedAt: r.updatedAt, jobId: ctx.jobId,
      };
    },
  },
  // Stage history (events) + deal creation events; won/lost from the stage classification.
  deal_events: {
    module: "deals", table: "analytics_fact_deal_events", custom: true, watermark: "changedAt",
    async extract(org, since, take) {
      const history = await prisma.dealStageHistory.findMany({ where: { organizationId: org, changedAt: { gt: since } }, orderBy: { changedAt: "asc" }, take });
      const created = await prisma.deal.findMany({ where: { organizationId: org, createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, take, select: { id: true, organizationId: true, createdAt: true, ownerMembershipId: true, assignedTeam: true, stage: true, probability: true } });
      const stageIds = [...new Set(history.map((h) => h.toStageId).filter(Boolean))];
      const stages = stageIds.length ? await prisma.pipelineStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, classification: true } }) : [];
      const dealIds = [...new Set(history.map((h) => h.dealId))];
      const deals = dealIds.length ? await prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, ownerMembershipId: true, assignedTeam: true } }) : [];
      const cls = Object.fromEntries(stages.map((s) => [s.id, s.classification]));
      const dealBy = Object.fromEntries(deals.map((d) => [d.id, d]));
      const rows = [
        ...history.map((h) => ({ kind: "history", at: h.changedAt, h, cls: cls[h.toStageId], deal: dealBy[h.dealId] })),
        ...created.map((dl) => ({ kind: "created", at: dl.createdAt, dl })),
      ].sort((a, b) => a.at - b.at).slice(0, take);
      return rows;
    },
    watermarkOf: (x) => x.at,
    map: (x, ctx) => (x.kind === "created"
      ? { organizationId: x.dl.organizationId, sourceId: `created:${x.dl.id}`, dealId: x.dl.id, eventType: "created", ownerMembershipId: x.dl.ownerMembershipId, department: null, team: x.dl.assignedTeam, businessDate: ymdDate(x.at, ctx.tz), occurredAt: x.at, fromStage: null, toStage: x.dl.stage, toProbability: x.dl.probability, secondsInPrevious: null, jobId: ctx.jobId }
      : { organizationId: x.h.organizationId, sourceId: x.h.id, dealId: x.h.dealId, eventType: x.cls === "Won" ? "won" : x.cls === "Lost" ? "lost" : "stage_change", ownerMembershipId: x.deal?.ownerMembershipId || null, department: null, team: x.deal?.assignedTeam || null, businessDate: ymdDate(x.at, ctx.tz), occurredAt: x.at, fromStage: x.h.fromStageName, toStage: x.h.toStageName, toProbability: x.h.toProbability, secondsInPrevious: x.h.timeInPreviousStageSeconds, jobId: ctx.jobId }),
  },
  quotes: {
    module: "quotes", table: "analytics_fact_quotes", model: "quote", watermark: "updatedAt",
    reconcile: { model: "quote", activeWhere: { archived: false, archivedAt: null }, money: ["grandTotal", "amount"] },
    map: (r, ctx) => {
      const bd = ymdDate(r.issueDate || r.createdAt, ctx.tz);
      return { organizationId: r.organizationId, sourceId: r.id, ownerMembershipId: r.ownerMembershipId, department: null, team: r.assignedTeam, businessDate: bd, status: r.status, approvalStatus: r.approvalStatus, dealId: r.dealId, companyId: r.companyId, currency: r.currency, amount: d2(r.grandTotal ?? 0), ...money(ctx, r.grandTotal ?? 0, r.currency, bd), validUntilDate: ymdDate(r.validUntilDate, ctx.tz), acceptedAt: r.acceptedAt, approvedAt: r.approvedAt, isDeleted: !!(r.archived || r.archivedAt), sourceUpdatedAt: r.updatedAt, jobId: ctx.jobId };
    },
  },
  orders: {
    module: "orders", table: "analytics_fact_orders", model: "order", watermark: "updatedAt",
    reconcile: { model: "order", activeWhere: { archived: false, archivedAt: null }, money: ["grandTotal", "amount"] },
    map: (r, ctx) => {
      const bd = ymdDate(r.orderDate || r.createdAt, ctx.tz);
      return { organizationId: r.organizationId, sourceId: r.id, ownerMembershipId: r.ownerMembershipId, department: null, team: r.assignedTeam, businessDate: bd, status: r.status, orderType: r.orderType, dealId: r.dealId, companyId: r.companyId, currency: r.currency, amount: d2(r.grandTotal ?? 0), ...money(ctx, r.grandTotal ?? 0, r.currency, bd), confirmedAt: r.confirmedDate, isDeleted: !!(r.archived || r.archivedAt), sourceUpdatedAt: r.updatedAt, jobId: ctx.jobId };
    },
  },
  contracts: {
    module: "contracts", table: "analytics_fact_contracts", model: "contract", watermark: "updatedAt",
    reconcile: { model: "contract", activeWhere: { archived: false, archivedAt: null } },
    map: (r, ctx) => {
      const bd = ymdDate(r.effectiveDate || r.createdAt, ctx.tz);
      const end = ymdDate(r.endDate, ctx.tz);
      const notice = end && r.renewalNoticeDays !== null ? toDateValue(new Date(end.getTime() - r.renewalNoticeDays * 86_400_000).toISOString().slice(0, 10)) : null;
      return { organizationId: r.organizationId, sourceId: r.id, ownerMembershipId: r.ownerMembershipId, renewalOwnerMembershipId: r.renewalOwnerMembershipId, department: null, team: r.assignedTeam, businessDate: bd, status: r.status, contractType: r.contractType, renewalType: r.renewalType, companyId: r.companyId, currency: r.currency, amount: d2(r.contractValue), ...money(ctx, r.contractValue, r.currency, bd), effectiveDate: ymdDate(r.effectiveDate, ctx.tz), endDate: end, renewalNoticeDate: notice, isDeleted: !!(r.archived || r.archivedAt), sourceUpdatedAt: r.updatedAt, jobId: ctx.jobId };
    },
  },
  support: {
    module: "tickets", table: "analytics_fact_support", model: "ticket", watermark: "updatedAt",
    reconcile: { model: "ticket", activeWhere: { archivedAt: null } },
    async prefetch(rows) {
      const ids = rows.map((r) => r.id);
      const reopens = ids.length ? await prisma.ticketEvent.groupBy({ by: ["ticketId"], where: { ticketId: { in: ids }, eventType: "Reopened" }, _count: { _all: true } }) : [];
      return { reopens: Object.fromEntries(reopens.map((x) => [x.ticketId, x._count._all])) };
    },
    map: (r, ctx, pre) => {
      const open = !["Resolved", "Closed", "Cancelled"].includes(r.status);
      const mins = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null);
      const now = ctx.now;
      return {
        organizationId: r.organizationId, sourceId: r.id, ownerMembershipId: r.ownerMembershipId, assignedMembershipId: r.assignedMembershipId, department: r.department, team: r.team,
        businessDate: ymdDate(r.createdAt, ctx.tz), createdAt: r.createdAt, status: r.status, priority: r.priority, queueId: r.queueId, companyId: r.companyId,
        firstRespondedAt: r.firstRespondedAt, resolvedAt: r.resolvedAt, resolvedDate: ymdDate(r.resolvedAt, ctx.tz), closedAt: r.closedAt,
        firstResponseMinutes: mins(r.createdAt, r.firstRespondedAt), resolutionMinutes: mins(r.createdAt, r.resolvedAt), responseDue: r.slaResponseDeadline, resolutionDue: r.slaResolutionDeadline,
        responseBreached: r.slaResponseDeadline ? (r.firstRespondedAt ? r.firstRespondedAt > r.slaResponseDeadline : now > r.slaResponseDeadline) : null,
        resolutionBreached: r.slaResolutionDeadline ? (r.resolvedAt ? r.resolvedAt > r.slaResolutionDeadline : open && now > r.slaResolutionDeadline) : null,
        reopenCount: pre.reopens[r.id] || 0, isOpen: open, isDeleted: !!r.archivedAt, sourceUpdatedAt: r.updatedAt, jobId: ctx.jobId,
      };
    },
  },
  projects: {
    module: "projects", table: "analytics_fact_projects", model: "project", watermark: "updatedAt",
    reconcile: { model: "project", activeWhere: { archivedAt: null } },
    map: (r, ctx) => ({ organizationId: r.organizationId, sourceId: r.id, ownerMembershipId: r.ownerMembershipId, department: r.department, team: r.team, businessDate: ymdDate(r.startDate || r.createdAt, ctx.tz), status: r.status, healthState: r.healthState, priority: r.priority, companyId: r.companyId, startDate: ymdDate(r.startDate, ctx.tz), dueDate: ymdDate(r.dueDate, ctx.tz), completedAt: r.completedAt, completedDate: ymdDate(r.completedAt, ctx.tz), plannedEffortMinutes: r.plannedEffortMinutes, currency: r.currency, plannedBudget: d2(r.plannedBudget), isDeleted: !!r.archivedAt, sourceUpdatedAt: r.updatedAt, jobId: ctx.jobId }),
  },
  tasks: {
    module: "projects", table: "analytics_fact_tasks", model: "task", watermark: "updatedAt",
    reconcile: { model: "task", activeWhere: { archivedAt: null } },
    map: (r, ctx) => ({ organizationId: r.organizationId, sourceId: r.id, projectId: r.projectId, ownerMembershipId: r.ownerMembershipId || r.assigneeMembershipId, assigneeMembershipId: r.assigneeMembershipId, department: null, team: null, businessDate: ymdDate(r.createdAt, ctx.tz), status: r.status, statusCategory: r.statusCategory, blocked: !!r.blocked, isMilestone: r.taskType === "Milestone", dueDate: ymdDate(r.dueDate, ctx.tz), completedAt: r.completedAt, completedDate: ymdDate(r.completedAt, ctx.tz), estimatedMinutes: r.estimatedMinutes ?? (r.estimateHours ? Math.round(r.estimateHours * 60) : null), isDeleted: !!r.archivedAt, sourceUpdatedAt: r.updatedAt, jobId: ctx.jobId }),
  },
  time: {
    module: "projects", table: "analytics_fact_time", model: "taskTimeEntry", watermark: "updatedAt",
    reconcile: { model: "taskTimeEntry", activeWhere: { archivedAt: null } },
    map: (r, ctx) => ({ organizationId: r.organizationId, sourceId: r.id, projectId: r.projectId, taskId: r.taskId, ownerMembershipId: r.authorMembershipId, department: null, team: null, businessDate: toDateValue(r.workDate ? r.workDate.toISOString().slice(0, 10) : localYmd(r.createdAt, ctx.tz)), durationMinutes: r.durationMinutes || Math.round((r.hours || 0) * 60), billable: !!r.billable, status: r.status, isDeleted: !!r.archivedAt, sourceUpdatedAt: r.updatedAt, jobId: ctx.jobId }),
  },
  invoices: {
    module: "invoices", table: "analytics_fact_invoices", model: "invoice", watermark: "updatedAt",
    reconcile: { model: "invoice", activeWhere: { archivedAt: null, status: { not: "Void" } }, money: ["total", "amount"] },
    map: (r, ctx) => {
      const bd = ymdDate(r.issueDate, ctx.tz);
      const conv = ctx.convert(r.total, r.currency, bd);
      const due = ctx.convert(r.amountDue, r.currency, bd);
      return { organizationId: r.organizationId, sourceId: r.id, ownerMembershipId: r.createdByMembershipId, department: null, team: null, businessDate: bd, status: r.status, companyId: r.companyId, projectId: r.projectId, currency: r.currency, amount: d2(r.total), amountPaid: d2(r.amountPaid), amountDue: d2(r.amountDue), baseCurrency: ctx.base, baseAmount: conv.baseAmount === null ? null : String(conv.baseAmount), baseAmountDue: due.baseAmount === null ? null : String(due.baseAmount), rateDate: conv.rateDate, rateVersion: conv.rateVersion, conversionStatus: conv.conversionStatus, dueDate: ymdDate(r.dueDate, ctx.tz), paidAt: r.paidAt, paidDate: ymdDate(r.paidAt, ctx.tz), isDeleted: !!r.archivedAt || r.status === "Void", sourceUpdatedAt: r.updatedAt, jobId: ctx.jobId };
    },
  },
  payments: {
    module: "payments", table: "analytics_fact_payments", model: "payment", watermark: "updatedAt",
    reconcile: { model: "payment", activeWhere: { status: { notIn: ["Cancelled", "Reversed"] } }, money: ["amount", "amount"] },
    map: (r, ctx) => {
      const bd = ymdDate(r.date, ctx.tz);
      return { organizationId: r.organizationId, sourceId: r.id, ownerMembershipId: r.recordedByMembershipId || r.createdByMembershipId, department: null, team: null, businessDate: bd, direction: r.direction, status: r.status, method: r.method, invoiceId: r.invoiceId, companyId: r.companyId, currency: r.currency, amount: d2(r.amount), ...money(ctx, r.amount, r.currency, bd), isDeleted: ["Cancelled", "Reversed"].includes(r.status), sourceUpdatedAt: r.updatedAt, jobId: ctx.jobId };
    },
  },
  expenses: {
    module: "expenses", table: "analytics_fact_expenses", model: "expense", watermark: "updatedAt",
    reconcile: { model: "expense", activeWhere: { archivedAt: null }, money: ["amount", "amount"] },
    map: (r, ctx) => {
      const bd = ymdDate(r.date, ctx.tz);
      return { organizationId: r.organizationId, sourceId: r.id, ownerMembershipId: r.submittedByMembershipId, department: null, team: null, businessDate: bd, status: r.status, category: r.category, projectId: r.projectId, billable: !!r.billable, currency: r.currency, amount: d2(r.amount), ...money(ctx, r.amount, r.currency, bd), isDeleted: !!r.archivedAt, sourceUpdatedAt: r.updatedAt, jobId: ctx.jobId };
    },
  },
  // Append-only usage ledger (no updatedAt): the watermark is createdAt.
  ai_usage: {
    module: "ai_usage", table: "analytics_fact_ai_usage", model: "aiUsageRecord", watermark: "createdAt",
    reconcile: { model: "aiUsageRecord", activeWhere: {} },
    map: (r, ctx) => ({ organizationId: r.organizationId, sourceId: r.id, ownerMembershipId: r.membershipId, businessDate: ymdDate(r.createdAt, ctx.tz), occurredAt: r.createdAt, useCaseKey: r.useCaseKey, capabilityKey: r.capabilityKey, providerKey: r.providerKey, modelId: r.modelId, outcome: r.outcome, billingSource: r.billingSource, releaseId: r.releaseId, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedTokens: r.cachedTokens, estimatedCost: d2(r.estimatedCost), costKnown: r.costKnown, durationMs: r.durationMs, jobId: ctx.jobId }),
  },
  ai_events: {
    module: "ai_usage", table: "analytics_fact_ai_events", custom: true, watermark: "at", conflict: ["organizationId", "kind", "sourceId"],
    async extract(org, since, take) {
      const [proposals, safety, feedback, answers] = await Promise.all([
        prisma.aiActionProposal.findMany({ where: { organizationId: org, updatedAt: { gt: since } }, orderBy: { updatedAt: "asc" }, take, select: { id: true, organizationId: true, updatedAt: true, createdAt: true, status: true, actionType: true, proposedByMembershipId: true } }),
        prisma.aiSafetyEvent.findMany({ where: { organizationId: org, createdAt: { gt: since }, NOT: { source: { startsWith: "evaluation:" } } }, orderBy: { createdAt: "asc" }, take, select: { id: true, organizationId: true, createdAt: true, category: true, severity: true, capabilityKey: true, membershipId: true, reviewStatus: true } }),
        prisma.aiFeedback.findMany({ where: { organizationId: org, createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, take, select: { id: true, organizationId: true, createdAt: true, rating: true, membershipId: true } }),
        prisma.aiCopilotMessage.findMany({ where: { organizationId: org, role: "assistant", completedAt: { gt: since } }, orderBy: { completedAt: "asc" }, take, select: { id: true, organizationId: true, completedAt: true, status: true, confidence: true } }),
      ]);
      return [
        ...proposals.map((p) => ({ at: p.updatedAt, kind: "proposal", row: p })), ...safety.map((s) => ({ at: s.createdAt, kind: "safety", row: s })),
        ...feedback.map((f) => ({ at: f.createdAt, kind: "feedback", row: f })), ...answers.map((a) => ({ at: a.completedAt, kind: "copilot_answer", row: a })),
      ].sort((a, b) => a.at - b.at).slice(0, take);
    },
    watermarkOf: (x) => x.at,
    map: (x, ctx) => {
      const r = x.row;
      const base = { organizationId: r.organizationId, sourceId: r.id, kind: x.kind, businessDate: ymdDate(x.kind === "proposal" ? r.createdAt : x.at, ctx.tz), occurredAt: x.kind === "proposal" ? r.createdAt : x.at, jobId: ctx.jobId };
      if (x.kind === "proposal") return { ...base, ownerMembershipId: r.proposedByMembershipId, status: r.status, category: r.actionType, severity: null, capabilityKey: "suggested_actions" };
      if (x.kind === "safety") return { ...base, ownerMembershipId: r.membershipId, status: r.reviewStatus, category: r.category, severity: r.severity, capabilityKey: r.capabilityKey };
      if (x.kind === "feedback") return { ...base, ownerMembershipId: r.membershipId, status: r.rating, category: null, severity: null, capabilityKey: null };
      return { ...base, ownerMembershipId: null, status: r.status, category: r.confidence, severity: null, capabilityKey: "ai_copilot" };
    },
  },
};

export const SOURCE_KEYS = Object.keys(SOURCES);
