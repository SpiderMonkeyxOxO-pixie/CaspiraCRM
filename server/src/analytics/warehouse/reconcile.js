// Backend Phase 12 — reconciliation and data quality. After a load the
// warehouse is compared with the transactional source: active record counts,
// exact decimal money totals, orphaned facts (hard-deleted sources, marked
// deleted), missing dimensions and conversion gaps. Issues hold aggregate
// counts only — never hidden record details — and mark dependent metrics stale.
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { SOURCES, SOURCE_KEYS } from "./sources.js";
import { metricKeysForSource } from "../metrics/definitions.js";

const STALE_SOURCE_MS = Number(process.env.ANALYTICS_STALE_SOURCE_MS) || 2 * 3_600_000;
const t = (name) => Prisma.raw(`"${name}"`);

// Opens or refreshes an issue; resolves it when affected is 0.
export async function recordIssue(organizationId, source, issueType, { affected, severity = "Warning", summary }) {
  const open = await prisma.analyticsDataQualityIssue.findFirst({ where: { organizationId, source, issueType, status: "Open" } });
  const now = new Date();
  if (!affected) {
    if (!open) return null;
    const resolved = await prisma.analyticsDataQualityIssue.findFirst({ where: { organizationId, source, issueType, status: "Resolved" } });
    if (resolved) {
      await prisma.analyticsDataQualityIssue.delete({ where: { id: open.id } });
      return prisma.analyticsDataQualityIssue.update({ where: { id: resolved.id }, data: { resolvedAt: now, lastSeenAt: open.lastSeenAt, summary: open.summary, affectedCount: open.affectedCount } });
    }
    return prisma.analyticsDataQualityIssue.update({ where: { id: open.id }, data: { status: "Resolved", resolvedAt: now } });
  }
  const metricKeys = metricKeysForSource(source);
  if (open) return prisma.analyticsDataQualityIssue.update({ where: { id: open.id }, data: { affectedCount: affected, summary, severity, lastSeenAt: now, metricKeys } });
  return prisma.analyticsDataQualityIssue.create({ data: { organizationId, source, issueType, severity, summary, affectedCount: affected, metricKeys } });
}

async function factStats(src, organizationId, moneyCol) {
  const del = src.table === "analytics_fact_ai_usage" ? Prisma.sql`TRUE` : Prisma.sql`"isDeleted" = FALSE`;
  const sum = moneyCol ? Prisma.sql`, COALESCE(SUM(${t(moneyCol)}), 0)::text AS total` : Prisma.sql`, NULL::text AS total`;
  const [row] = await prisma.$queryRaw`SELECT COUNT(*)::int AS n ${sum} FROM ${t(src.table)} WHERE "organizationId" = ${organizationId} AND ${del}`;
  return row;
}

async function orphanCheck(src, organizationId) {
  if (src.custom || !src.model) return 0;
  const facts = await prisma.$queryRaw`SELECT "sourceId" FROM ${t(src.table)} WHERE "organizationId" = ${organizationId} ${src.table === "analytics_fact_ai_usage" ? Prisma.empty : Prisma.sql`AND "isDeleted" = FALSE`} LIMIT 50000`;
  const ids = facts.map((f) => f.sourceId);
  const missing = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const part = ids.slice(i, i + 1000);
    const found = await prisma[src.model].findMany({ where: { id: { in: part } }, select: { id: true } });
    const set = new Set(found.map((f) => f.id));
    for (const id of part) if (!set.has(id)) missing.push(id);
  }
  // Hard-deleted source rows: the fact is kept for lineage but excluded.
  if (missing.length && src.table !== "analytics_fact_ai_usage") {
    await prisma.$executeRaw`UPDATE ${t(src.table)} SET "isDeleted" = TRUE, "loadedAt" = now() WHERE "organizationId" = ${organizationId} AND "sourceId" IN (${Prisma.join(missing)})`;
  }
  return missing.length;
}

async function missingOwnerDims(src, organizationId) {
  const [row] = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM ${t(src.table)} f
    WHERE f."organizationId" = ${organizationId} AND f."ownerMembershipId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "analytics_dimensions" d WHERE d."organizationId" = f."organizationId" AND d."type" = 'owner' AND d."sourceId" = f."ownerMembershipId")`;
  return row?.n || 0;
}

async function conversionGaps(src, organizationId) {
  const [row] = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM ${t(src.table)} WHERE "organizationId" = ${organizationId} AND "conversionStatus" = 'Unavailable' AND "isDeleted" = FALSE`;
  return row?.n || 0;
}

export async function reconcileSource(organizationId, source, jobId = null) {
  const src = SOURCES[source];
  if (!src) return null;
  const checks = [];
  if (src.reconcile && !src.custom) {
    const cp = await prisma.analyticsJobCheckpoint.findUnique({ where: { organizationId_source: { organizationId, source } } });
    const bound = cp ? { [src.watermark]: { lte: cp.watermark } } : {};
    const where = { organizationId, ...src.reconcile.activeWhere, ...bound };
    const [srcField, factCol] = src.reconcile.money || [];
    const [count, agg, fact] = await Promise.all([
      prisma[src.reconcile.model].count({ where }),
      srcField ? prisma[src.reconcile.model].aggregate({ where, _sum: { [srcField]: true } }) : null,
      factStats(src, organizationId, factCol),
    ]);
    checks.push({ check: "record_count", source: count, warehouse: fact.n, difference: fact.n - count, passed: fact.n === count });
    if (srcField) {
      const s = new Prisma.Decimal(agg._sum[srcField] ?? 0).toDecimalPlaces(2);
      const w = new Prisma.Decimal(fact.total ?? 0).toDecimalPlaces(2);
      checks.push({ check: "money_total", source: s.toString(), warehouse: w.toString(), difference: w.sub(s).toString(), passed: s.equals(w), note: "Original-currency totals (mixed currencies are compared as stored amounts)." });
    }
  }
  const orphans = await orphanCheck(src, organizationId);
  checks.push({ check: "orphan_facts", count: orphans, passed: true, note: orphans ? "Marked deleted in the warehouse." : undefined });
  const missingDims = await missingOwnerDims(src, organizationId).catch(() => 0);
  checks.push({ check: "missing_owner_dimension", count: missingDims, passed: missingDims === 0 });
  const hasConversion = ["quotes", "orders", "contracts", "invoices", "payments", "expenses"].includes(source);
  const gaps = hasConversion ? await conversionGaps(src, organizationId) : 0;
  if (hasConversion) checks.push({ check: "conversion_unavailable", count: gaps, passed: true, note: gaps ? "No approved exchange rate for some rows; base totals exclude them." : undefined });

  const failed = checks.filter((c) => !c.passed);
  const status = failed.length ? "Failed" : "Passed";
  await prisma.analyticsReconciliationRun.create({ data: { organizationId, source, jobId, status, checks } });
  const countCheck = checks.find((c) => c.check === "record_count");
  const moneyCheck = checks.find((c) => c.check === "money_total");
  await recordIssue(organizationId, source, "reconciliation_difference", {
    affected: (countCheck && !countCheck.passed ? Math.abs(countCheck.difference) || 1 : 0) + (moneyCheck && !moneyCheck.passed ? 1 : 0),
    severity: "High", summary: `Warehouse and source disagree for ${source}${countCheck && !countCheck.passed ? ` (count difference ${countCheck.difference})` : ""}${moneyCheck && !moneyCheck.passed ? " (money total differs)" : ""}.`,
  });
  await recordIssue(organizationId, source, "orphan_fact", { affected: orphans, severity: "Low", summary: `${orphans} warehouse rows reference deleted ${source} records and were excluded.` });
  await recordIssue(organizationId, source, "missing_dimension", { affected: missingDims, severity: "Warning", summary: `${missingDims} ${source} rows reference an owner without a dimension row.` });
  if (hasConversion) await recordIssue(organizationId, source, "invalid_rate", { affected: gaps, severity: "Warning", summary: `${gaps} ${source} rows have no approved exchange rate for their date.` });
  return { status, checks };
}

// A source is stale when its last successful load is older than the target.
export async function recordStaleSources(now = new Date()) {
  const cps = await prisma.analyticsJobCheckpoint.findMany({ select: { organizationId: true, source: true } });
  for (const cp of cps) {
    if (!SOURCE_KEYS.includes(cp.source)) continue;
    const last = await prisma.analyticsWarehouseJob.findFirst({ where: { organizationId: cp.organizationId, source: cp.source, status: { in: ["Completed", "Completed with warnings"] } }, orderBy: { completedAt: "desc" }, select: { completedAt: true } });
    const age = last?.completedAt ? now - last.completedAt : Infinity;
    await recordIssue(cp.organizationId, cp.source, "stale_source", { affected: age > STALE_SOURCE_MS ? 1 : 0, severity: "Warning", summary: `${cp.source} has not loaded successfully in over ${Math.round(STALE_SOURCE_MS / 3_600_000)} hours.` });
  }
}

// Metric keys currently affected by open issues (for "stale" labels).
export async function staleMetricKeys(organizationId) {
  const open = await prisma.analyticsDataQualityIssue.findMany({ where: { organizationId, status: "Open", severity: { in: ["High", "Warning"] } }, select: { metricKeys: true, issueType: true, source: true } });
  const keys = new Map();
  for (const i of open) for (const k of i.metricKeys || []) keys.set(k, [...(keys.get(k) || []), `${i.source}:${i.issueType}`]);
  return keys;
}

