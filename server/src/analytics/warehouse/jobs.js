// Backend Phase 12 — warehouse job runner. One active job per organization
// and source (claimed with a conditional update), incremental extraction from
// a checkpoint watermark with a late-arrival overlap, idempotent batch loads,
// dimension maintenance, reconciliation and data-quality checks, retries with
// a dead-letter state, daily snapshots, backfill and a guarded full rebuild.
// Jobs never read or write request data and never log record contents.
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { SOURCES, SOURCE_KEYS } from "./sources.js";
import { batchUpsert } from "./upsert.js";
import { dimensionEntriesFor, upsertDimensions } from "./dimensions.js";
import { calendarFor, localYmd, toDateValue } from "../common/calendar.js";
import { syncRates, converterFor } from "../common/currency.js";
import { reconcileSource, recordStaleSources } from "./reconcile.js";
import { bumpAnalyticsVersion } from "../common/cache.js";

export const SNAPSHOT_SOURCES = ["deal_snapshots", "snapshots", "budgets"];
export const ALL_SOURCES = [...SOURCE_KEYS, ...SNAPSHOT_SOURCES];
export const ACTIVE_STATES = ["Queued", "Extracting", "Transforming", "Loading", "Validating", "Reconciling"];
export const JOB_TYPES = ["incremental", "hourly", "daily_snapshot", "monthly_snapshot", "manual", "backfill", "rebuild", "reconcile"];
const RUNNING_STATES = ACTIVE_STATES.filter((s) => s !== "Queued");
const MAX_ATTEMPTS = 3;
const BATCH = Number(process.env.ANALYTICS_BATCH_SIZE) || 500;
const OVERLAP_MS = Number(process.env.ANALYTICS_LATE_ARRIVAL_MS) || 5 * 60_000;
const STALE_JOB_MS = 30 * 60_000;
const EPOCH = new Date("2000-01-01T00:00:00Z");

export const heartbeats = { warehouse: null };
export const rebuildAllowed = () => process.env.NODE_ENV !== "production" || process.env.ANALYTICS_ALLOW_REBUILD === "true";

class WarehouseError extends Error {
  constructor(category, message) { super(message); this.category = category; }
}

// Queue a job unless the organization already has one active for the source
// (the existing job is returned instead — no duplicate concurrent loads).
export async function enqueueWarehouseJob(organizationId, source, jobType = "incremental", { requestedByUserId = null, watermarkFrom = null, correlationId = null } = {}) {
  if (!ALL_SOURCES.includes(source)) throw new WarehouseError("validation", `Unknown warehouse source ${source}`);
  if (!JOB_TYPES.includes(jobType)) throw new WarehouseError("validation", `Unknown job type ${jobType}`);
  const active = await prisma.analyticsWarehouseJob.findFirst({ where: { organizationId, source, status: { in: ACTIVE_STATES } } });
  if (active) return { job: active, existing: true };
  const job = await prisma.analyticsWarehouseJob.create({
    data: {
      publicId: `awj_${crypto.randomBytes(8).toString("base64url")}`, organizationId, source, jobType, watermarkFrom,
      correlationId: correlationId || crypto.randomUUID(), requestedByUserId,
    },
  });
  return { job, existing: false };
}

async function setState(job, status, extra = {}) {
  return prisma.analyticsWarehouseJob.update({ where: { id: job.id }, data: { status, ...extra } });
}

// Claims the oldest queued job whose organization/source has nothing running.
export async function claimNextJob() {
  const queued = await prisma.analyticsWarehouseJob.findMany({ where: { status: "Queued" }, orderBy: { createdAt: "asc" }, take: 20 });
  for (const job of queued) {
    const running = await prisma.analyticsWarehouseJob.count({ where: { organizationId: job.organizationId, source: job.source, status: { in: RUNNING_STATES } } });
    if (running) continue;
    const { count } = await prisma.analyticsWarehouseJob.updateMany({ where: { id: job.id, status: "Queued" }, data: { status: "Extracting", startedAt: new Date(), attempts: { increment: 1 } } });
    if (count === 1) return prisma.analyticsWarehouseJob.findUnique({ where: { id: job.id } });
  }
  return null;
}

async function contextFor(organizationId, jobId, now = new Date()) {
  const cal = await calendarFor(organizationId);
  await syncRates(organizationId);
  const convert = await converterFor(organizationId, cal.baseCurrency);
  return { tz: cal.timeZone, base: cal.baseCurrency, convert, jobId, now, cal };
}

// Extracts one page after the (watermark, id) cursor for a model-backed source.
async function extractPage(src, organizationId, cursor) {
  const wm = src.watermark;
  const where = { organizationId, OR: [{ [wm]: { gt: cursor.at } }, { [wm]: cursor.at, id: { gt: cursor.id || "" } }] };
  return prisma[src.model].findMany({ where, orderBy: [{ [wm]: "asc" }, { id: "asc" }], take: BATCH });
}

// Removes a source's facts for the organization (rebuild only).
async function clearFacts(src, organizationId) {
  const table = Prisma.raw(`"${src.table}"`);
  return prisma.$executeRaw`DELETE FROM ${table} WHERE "organizationId" = ${organizationId}`;
}

async function loadSource(job, ctx) {
  const src = SOURCES[job.source];
  const checkpoint = await prisma.analyticsJobCheckpoint.findUnique({ where: { organizationId_source: { organizationId: job.organizationId, source: job.source } } });
  const full = ["backfill", "rebuild"].includes(job.jobType) || !checkpoint;
  const startAt = job.watermarkFrom || (full ? EPOCH : new Date(checkpoint.watermark.getTime() - OVERLAP_MS));
  let cursor = { at: startAt, id: null };
  if (job.jobType === "rebuild") {
    if (!rebuildAllowed()) throw new WarehouseError("forbidden", "Full rebuild is disabled in this environment.");
    const removed = await clearFacts(src, job.organizationId);
    await prisma.analyticsJobCheckpoint.deleteMany({ where: { organizationId: job.organizationId, source: job.source } });
    job.rowsDeleted = removed;
  }
  const totals = { rowsRead: 0, rowsInserted: 0, rowsUpdated: 0, rowsRejected: 0, rowsDeleted: job.rowsDeleted || 0 };
  let last = checkpoint && job.jobType !== "rebuild" ? { at: checkpoint.watermark, id: checkpoint.lastSourceId } : { at: startAt, id: null };
  for (let page = 0; page < 10_000; page += 1) {
    await setState(job, "Extracting");
    const rows = src.custom ? await src.extract(job.organizationId, cursor.at, BATCH) : await extractPage(src, job.organizationId, cursor);
    if (!rows.length) break;
    totals.rowsRead += rows.length;
    await setState(job, "Transforming");
    const pre = src.prefetch ? await src.prefetch(rows) : {};
    const facts = [];
    for (const r of rows) {
      try {
        const f = src.map(r, ctx, pre);
        if (!f || !f.sourceId || !f.organizationId) { totals.rowsRejected += 1; continue; }
        facts.push(f);
      } catch { totals.rowsRejected += 1; }
    }
    await setState(job, "Loading");
    const res = await batchUpsert(src.table, normalizeKeys(facts), src.conflict || ["organizationId", "sourceId"]);
    totals.rowsInserted += res.inserted; totals.rowsUpdated += res.updated;
    await upsertDimensions(job.organizationId, await dimensionEntriesFor(job.organizationId, facts));
    const tail = rows[rows.length - 1];
    const tailAt = src.custom ? src.watermarkOf(tail) : tail[src.watermark];
    const tailId = src.custom ? null : tail.id;
    if (!last.at || tailAt >= last.at) last = { at: tailAt, id: tailId };
    await prisma.analyticsJobCheckpoint.upsert({
      where: { organizationId_source: { organizationId: job.organizationId, source: job.source } },
      update: { watermark: last.at, lastSourceId: last.id, lastJobId: job.id },
      create: { organizationId: job.organizationId, source: job.source, watermark: last.at, lastSourceId: last.id, lastJobId: job.id },
    });
    await prisma.analyticsWarehouseJob.update({ where: { id: job.id }, data: totals });
    if (rows.length < BATCH) break;
    // Custom sources page by timestamp only; stop if a page did not advance.
    if (src.custom && tailAt <= cursor.at) break;
    cursor = { at: tailAt, id: tailId };
  }
  return { ...totals, watermarkFrom: startAt, watermarkTo: last.at };
}

// batchUpsert needs identical keys on every row.
function normalizeKeys(rows) {
  if (!rows.length) return rows;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] === undefined ? null : r[k]])));
}

const dec = (v) => new Prisma.Decimal(v ?? 0);
const s2 = (v) => (v === null || v === undefined ? null : new Prisma.Decimal(v).toDecimalPlaces(2).toString());

// Daily pipeline snapshot: open deals plus deals closed in the last 400 days.
async function snapshotDeals(job, ctx) {
  const today = localYmd(ctx.now, ctx.tz);
  const snapshotDate = toDateValue(today);
  const since = new Date(ctx.now.getTime() - 400 * 86_400_000);
  const deals = await prisma.deal.findMany({
    where: { organizationId: job.organizationId, archived: false, archivedAt: null, OR: [{ status: { in: ["Open", "On Hold", "OnHold"] } }, { updatedAt: { gte: since } }] },
    select: { id: true, ownerMembershipId: true, assignedTeam: true, pipelineId: true, stage: true, status: true, companyId: true, currency: true, value: true, probability: true, expectedClosingDate: true, actualClosingDate: true, createdAt: true, nextAction: true, pipelineStageId: true },
  });
  if (!deals.length) return { rowsRead: 0, rowsInserted: 0, rowsUpdated: 0 };
  const ids = deals.map((d) => d.id);
  const stageIds = [...new Set(deals.map((d) => d.pipelineStageId).filter(Boolean))];
  const [stages, lastStage, lastActivity, products] = await Promise.all([
    stageIds.length ? prisma.pipelineStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, classification: true } }) : [],
    prisma.dealStageHistory.groupBy({ by: ["dealId"], where: { dealId: { in: ids } }, _max: { changedAt: true } }),
    prisma.activity.groupBy({ by: ["dealId"], where: { dealId: { in: ids }, archivedAt: null }, _max: { createdAt: true, completedAt: true } }),
    prisma.dealLineItem.groupBy({ by: ["dealId"], where: { dealId: { in: ids } }, _count: { _all: true } }),
  ]);
  const cls = Object.fromEntries(stages.map((s) => [s.id, s.classification]));
  const entered = Object.fromEntries(lastStage.map((x) => [x.dealId, x._max.changedAt]));
  const act = Object.fromEntries(lastActivity.map((x) => [x.dealId, [x._max.createdAt, x._max.completedAt].filter(Boolean).sort((a, b) => b - a)[0] || null]));
  const prod = Object.fromEntries(products.map((x) => [x.dealId, x._count._all]));
  const rows = deals.map((d) => {
    const classification = cls[d.pipelineStageId] || (d.status === "Won" || d.status === "Lost" ? d.status : "Open");
    const amount = dec(d.value);
    const weighted = amount.mul(d.probability ?? 0).div(100).toDecimalPlaces(2);
    const c = ctx.convert(amount, d.currency, snapshotDate);
    const w = ctx.convert(weighted, d.currency, snapshotDate);
    return {
      organizationId: job.organizationId, snapshotDate, dealId: d.id, ownerMembershipId: d.ownerMembershipId, department: null, team: d.assignedTeam,
      pipelineId: d.pipelineId, stage: d.stage, stageClassification: classification, status: d.status, isOpen: ["Open", "OnHold"].includes(classification),
      companyId: d.companyId, currency: d.currency, amount: s2(amount), probability: d.probability, weightedAmount: s2(weighted), baseCurrency: ctx.base,
      baseAmount: s2(c.baseAmount), baseWeightedAmount: s2(w.baseAmount), rateDate: c.rateDate, rateVersion: c.rateVersion, conversionStatus: c.conversionStatus,
      expectedClosingDate: d.expectedClosingDate ? toDateValue(localYmd(d.expectedClosingDate, ctx.tz)) : null,
      actualClosingDate: d.actualClosingDate ? toDateValue(localYmd(d.actualClosingDate, ctx.tz)) : null,
      createdDate: toDateValue(localYmd(d.createdAt, ctx.tz)), stageEnteredAt: entered[d.id] || d.createdAt, lastActivityAt: act[d.id] || null,
      hasNextAction: !!(d.nextAction && String(d.nextAction).trim()), hasOwner: !!d.ownerMembershipId, hasProducts: (prod[d.id] || 0) > 0, jobId: job.id,
    };
  });
  const res = await batchUpsert("analytics_fact_deal_snapshots", rows, ["organizationId", "dealId", "snapshotDate"]);
  return { rowsRead: deals.length, rowsInserted: res.inserted, rowsUpdated: res.updated };
}

// Aggregated daily snapshots (AR aging, ticket backlog, renewal exposure,
// project health, AI budget). Keys include the owner so scoped reads work.
async function snapshotAggregates(job, ctx) {
  const org = job.organizationId;
  const today = localYmd(ctx.now, ctx.tz);
  const snapshotDate = toDateValue(today);
  const out = new Map();
  const add = (kind, key, { owner = null, department = null, team = null, currency = null, value = null, attributes = {} } = {}) => {
    const k = `${kind}|${key}`;
    const cur = out.get(k) || { organizationId: org, snapshotDate, kind, key, ownerMembershipId: owner, department, team, currency, value: currency ? dec(0) : null, count: 0, attributes, jobId: job.id };
    cur.count += 1;
    if (value !== null && value !== undefined) cur.value = dec(cur.value).add(dec(value));
    out.set(k, cur);
  };
  const [invoices, tickets, contracts, projects, budgets] = await Promise.all([
    prisma.invoice.findMany({ where: { organizationId: org, archivedAt: null, status: { in: ["Approved", "Sent", "Partially Paid", "Overdue", "Posted", "Disputed"] } }, select: { dueDate: true, currency: true, amountDue: true, createdByMembershipId: true } }),
    prisma.ticket.findMany({ where: { organizationId: org, archivedAt: null, status: { notIn: ["Resolved", "Closed", "Cancelled"] } }, select: { priority: true, ownerMembershipId: true, department: true, team: true, createdAt: true } }),
    prisma.contract.findMany({ where: { organizationId: org, archived: false, status: { in: ["Active", "Signed", "Expiring"] }, endDate: { gte: ctx.now, lte: new Date(ctx.now.getTime() + 90 * 86_400_000) } }, select: { currency: true, contractValue: true, ownerMembershipId: true, assignedTeam: true } }),
    prisma.project.findMany({ where: { organizationId: org, archivedAt: null, status: { notIn: ["Completed", "Cancelled"] } }, select: { healthState: true, ownerMembershipId: true, department: true, team: true } }),
    prisma.aiBudget.findMany({ where: { organizationId: org, active: true } }),
  ]);
  for (const i of invoices) {
    if (dec(i.amountDue).lte(0)) continue;
    const days = i.dueDate ? Math.floor((new Date(`${today}T00:00:00Z`) - new Date(`${localYmd(i.dueDate, ctx.tz)}T00:00:00Z`)) / 86_400_000) : 0;
    const bucket = days <= 0 ? "current" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
    add("ar_aging", `${i.currency}:${bucket}:${i.createdByMembershipId || "none"}`, { owner: i.createdByMembershipId, currency: i.currency, value: i.amountDue, attributes: { bucket } });
  }
  for (const t of tickets) {
    const ageDays = Math.floor((ctx.now - t.createdAt) / 86_400_000);
    add("ticket_backlog", `${t.priority || "None"}:${t.ownerMembershipId || "none"}:${t.team || ""}:${t.department || ""}`, { owner: t.ownerMembershipId, team: t.team, department: t.department, attributes: { priority: t.priority || "None", oldestAgeDays: ageDays } });
    const k = out.get(`ticket_backlog|${t.priority || "None"}:${t.ownerMembershipId || "none"}:${t.team || ""}:${t.department || ""}`);
    k.attributes = { ...k.attributes, oldestAgeDays: Math.max(k.attributes.oldestAgeDays || 0, ageDays) };
  }
  for (const c of contracts) add("renewal_exposure", `${c.currency}:${c.ownerMembershipId || "none"}`, { owner: c.ownerMembershipId, team: c.assignedTeam, currency: c.currency, value: c.contractValue ?? 0 });
  for (const p of projects) add("project_health", `${p.healthState || "Unknown"}:${p.ownerMembershipId || "none"}:${p.team || ""}:${p.department || ""}`, { owner: p.ownerMembershipId, team: p.team, department: p.department, attributes: { healthState: p.healthState || "Unknown" } });
  if (budgets.length) {
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    const spent = await prisma.aiUsageRecord.aggregate({ where: { organizationId: org, createdAt: { gte: monthStart } }, _sum: { estimatedCost: true } });
    for (const b of budgets.filter((x) => x.scope === "Organization")) {
      add("ai_budget", `${b.id}`, { currency: b.currency, value: spent._sum.estimatedCost ?? 0, attributes: { period: b.period, softLimit: String(b.softLimit), hardLimit: String(b.hardLimit) } });
    }
  }
  const rows = [...out.values()].map((r) => ({ ...r, value: r.value === null ? null : s2(r.value), attributes: JSON.stringify(r.attributes) }));
  // Replace today's snapshot so vanished groups do not linger.
  await prisma.analyticsFactSnapshot.deleteMany({ where: { organizationId: org, snapshotDate } });
  const res = rows.length ? await batchUpsert("analytics_fact_snapshots", rows, ["organizationId", "kind", "key", "snapshotDate"]) : { inserted: 0, updated: 0 };
  return { rowsRead: invoices.length + tickets.length + contracts.length + projects.length + budgets.length, rowsInserted: res.inserted, rowsUpdated: res.updated };
}

// Budget vs actual: planned from the active budget version, actual from posted
// journal lines on the budgeted accounts within the fiscal year (base amounts).
async function snapshotBudgets(job, ctx) {
  const org = job.organizationId;
  const snapshotDate = toDateValue(localYmd(ctx.now, ctx.tz));
  const budgets = await prisma.budget.findMany({ where: { organizationId: org, archivedAt: null, activeVersionId: { not: null } }, include: { fiscalYear: { select: { startDate: true, endDate: true } } } });
  const rows = [];
  for (const b of budgets) {
    const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: b.activeVersionId }, select: { accountId: true, plannedAmount: true } });
    const planned = lines.reduce((s, l) => s.add(dec(l.plannedAmount)), dec(0));
    const accounts = [...new Set(lines.map((l) => l.accountId))];
    const actual = accounts.length ? await prisma.journalLine.aggregate({
      where: { organizationId: org, accountId: { in: accounts }, journalEntry: { status: "Posted", entryDate: { gte: b.fiscalYear.startDate, lte: b.fiscalYear.endDate } } },
      _sum: { baseDebit: true, baseCredit: true },
    }) : { _sum: {} };
    const net = dec(actual._sum.baseDebit).sub(dec(actual._sum.baseCredit)).abs();
    rows.push({ organizationId: org, snapshotDate, budgetId: b.id, budgetName: b.name, department: b.department, fiscalYearId: b.fiscalYearId, currency: b.currency, planned: s2(planned), actual: s2(net), jobId: job.id });
  }
  const res = rows.length ? await batchUpsert("analytics_fact_budgets", rows, ["organizationId", "budgetId", "snapshotDate"]) : { inserted: 0, updated: 0 };
  return { rowsRead: budgets.length, rowsInserted: res.inserted, rowsUpdated: res.updated };
}

// Refreshes materialized views without blocking readers.
export async function refreshMaterializedViews() {
  const views = ["mv_pipeline_daily", "mv_invoice_monthly", "mv_activity_daily"];
  const results = {};
  for (const v of views) {
    try { await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.${v}`); results[v] = "ok"; }
    catch (err) {
      // CONCURRENTLY fails on a never-populated view; fall back once.
      try { await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW analytics.${v}`); results[v] = "ok"; }
      catch { results[v] = "failed"; console.error(`[analytics] refresh ${v} failed:`, err.code || "error"); }
    }
  }
  return results;
}

const categorize = (err) => {
  if (err instanceof WarehouseError) return err.category;
  if (err?.code && String(err.code).startsWith("P1")) return "source_unavailable";
  if (err?.code && String(err.code).startsWith("P2")) return "data_error";
  return "internal";
};

// Runs one claimed job through its states.
export async function runJob(job) {
  const ctx = await contextFor(job.organizationId, job.id);
  try {
    let totals;
    if (job.jobType === "reconcile") totals = { rowsRead: 0, rowsInserted: 0, rowsUpdated: 0 };
    else if (job.source === "deal_snapshots") totals = await snapshotDeals(job, ctx);
    else if (job.source === "snapshots") totals = await snapshotAggregates(job, ctx);
    else if (job.source === "budgets") totals = await snapshotBudgets(job, ctx);
    else totals = await loadSource(job, ctx);
    await setState(job, "Validating", { ...totals });
    let reconciliation = null;
    if (SOURCES[job.source]) {
      await setState(job, "Reconciling");
      reconciliation = await reconcileSource(job.organizationId, job.source, job.id);
    }
    const warn = (totals.rowsRejected || 0) > 0 || reconciliation?.status === "Failed";
    const done = await setState(job, warn ? "Completed with warnings" : "Completed", { completedAt: new Date(), reconciliation: reconciliation || undefined, failureCategory: null, safeError: null });
    await bumpAnalyticsVersion(job.organizationId);
    return done;
  } catch (err) {
    const category = categorize(err);
    const retry = category !== "forbidden" && category !== "validation" && job.attempts < MAX_ATTEMPTS;
    console.error(`[analytics] job ${job.publicId} (${job.source}) failed: ${category} ${err?.code || ""} correlation=${job.correlationId}`);
    if (process.env.ANALYTICS_DEBUG === "true") console.error(err);
    return setState(job, retry ? "Queued" : category === "forbidden" || category === "validation" ? "Failed" : "Dead letter", {
      failureCategory: category, safeError: err instanceof WarehouseError ? err.message : "The warehouse job failed. See worker logs by correlation ID.",
      completedAt: retry ? null : new Date(),
    });
  }
}

// Marks jobs stuck in a running state (worker died) for retry.
export async function recoverStaleJobs(now = new Date()) {
  const stuck = await prisma.analyticsWarehouseJob.findMany({ where: { status: { in: RUNNING_STATES }, startedAt: { lt: new Date(now.getTime() - STALE_JOB_MS) } } });
  for (const j of stuck) {
    await setState(j, j.attempts < MAX_ATTEMPTS ? "Queued" : "Dead letter", { failureCategory: "timeout", safeError: "The job did not finish in time." });
  }
  return stuck.length;
}

// Scheduler: incremental loads every interval per source, daily snapshots
// once per organization-local day (after 01:00 local).
const INCREMENTAL_MS = Number(process.env.ANALYTICS_INCREMENTAL_INTERVAL_MS) || 15 * 60_000;
export async function scheduleJobs(now = new Date()) {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let queued = 0;
  for (const { id } of orgs) {
    const cal = await calendarFor(id);
    const recent = await prisma.analyticsWarehouseJob.findMany({ where: { organizationId: id, createdAt: { gte: new Date(now.getTime() - 26 * 3_600_000) } }, select: { source: true, jobType: true, createdAt: true, status: true } });
    for (const source of SOURCE_KEYS) {
      const last = recent.filter((j) => j.source === source).sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!last || now - last.createdAt >= INCREMENTAL_MS) { const r = await enqueueWarehouseJob(id, source, "incremental"); if (!r.existing) queued += 1; }
    }
    const today = localYmd(now, cal.timeZone);
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: cal.timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
    if (hour >= 1) {
      for (const source of SNAPSHOT_SOURCES) {
        const done = recent.some((j) => j.source === source && localYmd(j.createdAt, cal.timeZone) === today && j.status !== "Failed" && j.status !== "Dead letter");
        if (!done) { const r = await enqueueWarehouseJob(id, source, "daily_snapshot"); if (!r.existing) queued += 1; }
      }
    }
  }
  return queued;
}

// Worker cycle: recover, schedule, then run queued jobs until the time budget.
let lastSchedule = 0;
export async function runWarehouseCycle({ budgetMs = 50_000, now = new Date() } = {}) {
  const started = Date.now();
  await recoverStaleJobs(now);
  if (Date.now() - lastSchedule > 60_000) { lastSchedule = Date.now(); await scheduleJobs(now); }
  let ran = 0; let loaded = false;
  while (Date.now() - started < budgetMs) {
    const job = await claimNextJob();
    if (!job) break;
    const done = await runJob(job);
    ran += 1;
    if (done.status.startsWith("Completed")) loaded = true;
  }
  if (loaded) await refreshMaterializedViews();
  if (ran) await recordStaleSources(now);
  heartbeats.warehouse = new Date();
  return ran;
}

// Freshness per source for an organization (last successful load).
export async function freshness(organizationId) {
  const jobs = await prisma.analyticsWarehouseJob.findMany({
    where: { organizationId, status: { in: ["Completed", "Completed with warnings"] } }, orderBy: { completedAt: "desc" }, take: 200,
    select: { source: true, completedAt: true, status: true },
  });
  const out = {};
  for (const j of jobs) if (!out[j.source]) out[j.source] = { lastLoadedAt: j.completedAt, status: j.status };
  return out;
}

export { WarehouseError };
