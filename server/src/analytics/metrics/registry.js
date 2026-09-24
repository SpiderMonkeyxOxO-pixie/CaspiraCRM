// Backend Phase 12 — metric registry. Code holds each metric's
// implementation; the database holds its governed, versioned definition. A
// published version is immutable: any change (from code or an administrator)
// creates a new version, and publishing it retires the previous one with a
// deprecation date. Retired metrics cannot be queried.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { METRICS, METRIC_BY_KEY, definitionPayload } from "./definitions.js";

const checksum = (d) => crypto.createHash("sha256").update(JSON.stringify(d)).digest("hex");
let cache = null; let cachedAt = 0;
const TTL = 30_000;

export function invalidateRegistry() { cache = null; }

// Creates or versions every code metric. Idempotent.
export async function seedMetrics({ userId = null } = {}) {
  let created = 0; let versioned = 0;
  for (const m of METRICS) {
    const payload = definitionPayload(m);
    const sum = checksum(payload);
    let metric = await prisma.analyticsMetric.findUnique({ where: { key: m.key } });
    if (!metric) {
      metric = await prisma.analyticsMetric.create({ data: { key: m.key, name: m.name, module: m.module, status: "Published", publishedVersion: 1, latestVersion: 1, createdByUserId: userId } });
      await prisma.analyticsMetricVersion.create({ data: { metricId: metric.id, version: 1, definition: payload, checksum: sum, status: "Published", effectiveDate: new Date(), createdByUserId: userId, publishedByUserId: userId } });
      created += 1;
      continue;
    }
    if (metric.status === "Retired") continue;
    const current = metric.publishedVersion ? await prisma.analyticsMetricVersion.findUnique({ where: { metricId_version: { metricId: metric.id, version: metric.publishedVersion } } }) : null;
    if (current && current.checksum === sum) continue;
    // The code implementation changed: record it as a new published version.
    await createVersion(metric, payload, { userId, publish: true });
    versioned += 1;
  }
  invalidateRegistry();
  return { created, versioned };
}

async function createVersion(metric, payload, { userId, publish }) {
  const version = metric.latestVersion + 1;
  const v = await prisma.analyticsMetricVersion.create({ data: { metricId: metric.id, version, definition: payload, checksum: checksum(payload), status: publish ? "Published" : "Draft", effectiveDate: publish ? new Date() : null, createdByUserId: userId, publishedByUserId: publish ? userId : null } });
  if (publish && metric.publishedVersion) await prisma.analyticsMetricVersion.update({ where: { metricId_version: { metricId: metric.id, version: metric.publishedVersion } }, data: { status: "Retired", deprecatedDate: new Date() } });
  await prisma.analyticsMetric.update({ where: { id: metric.id }, data: { latestVersion: version, ...(publish ? { publishedVersion: version, status: "Published" } : {}) } });
  invalidateRegistry();
  return v;
}

// { key → { status, version, definition } } for published metrics.
export async function registry() {
  if (cache && Date.now() - cachedAt < TTL) return cache;
  let rows = await prisma.analyticsMetric.findMany();
  if (!rows.length) { await seedMetrics(); rows = await prisma.analyticsMetric.findMany(); }
  const versions = await prisma.analyticsMetricVersion.findMany({ where: { status: "Published" } });
  const vBy = Object.fromEntries(versions.map((v) => [v.metricId, v]));
  cache = Object.fromEntries(rows.map((r) => [r.key, { id: r.id, status: r.status, version: r.publishedVersion, definition: vBy[r.id]?.definition || null, name: r.name, module: r.module }]));
  cachedAt = Date.now();
  return cache;
}

const editable = ["definition", "owner", "reviewer", "freshnessTargetMinutes", "dataQuality"];

// Administrator edits create a Draft version of the definition metadata; the
// implementation (formula, sources, filters) stays code-owned.
export async function draftVersion(key, changes, userId) {
  const metric = await prisma.analyticsMetric.findUnique({ where: { key } });
  if (!metric || !METRIC_BY_KEY[key]) return { error: 404, message: "Metric not found." };
  if (metric.status === "Retired") return { error: 409, message: "Retired metrics cannot be changed." };
  const unknown = Object.keys(changes || {}).filter((k) => !editable.includes(k));
  if (unknown.length) return { error: 422, message: `These fields cannot be edited: ${unknown.join(", ")}. The formula and sources are defined in code.` };
  const base = await prisma.analyticsMetricVersion.findUnique({ where: { metricId_version: { metricId: metric.id, version: metric.latestVersion } } });
  const payload = { ...(base?.definition || definitionPayload(METRIC_BY_KEY[key])) };
  if (changes.definition !== undefined) payload.definition = String(changes.definition).slice(0, 2000);
  if (changes.owner !== undefined) payload.owner = String(changes.owner).slice(0, 120);
  if (changes.reviewer !== undefined) payload.reviewer = String(changes.reviewer).slice(0, 120);
  if (changes.dataQuality !== undefined) payload.dataQuality = String(changes.dataQuality).slice(0, 500);
  if (changes.freshnessTargetMinutes !== undefined) {
    const n = Number(changes.freshnessTargetMinutes);
    if (!Number.isInteger(n) || n < 5 || n > 10_080) return { error: 422, message: "freshnessTargetMinutes must be between 5 and 10080." };
    payload.freshnessTargetMinutes = n;
  }
  if (base && base.status === "Draft") {
    // Drafts may be edited in place; published versions never are.
    const v = await prisma.analyticsMetricVersion.update({ where: { id: base.id }, data: { definition: payload, checksum: checksum(payload) } });
    invalidateRegistry();
    return { version: v };
  }
  return { version: await createVersion(metric, payload, { userId, publish: false }) };
}

export async function publishVersion(key, version, userId) {
  const metric = await prisma.analyticsMetric.findUnique({ where: { key } });
  if (!metric) return { error: 404, message: "Metric not found." };
  const v = await prisma.analyticsMetricVersion.findUnique({ where: { metricId_version: { metricId: metric.id, version: Number(version) } } });
  if (!v) return { error: 404, message: "Version not found." };
  if (v.status !== "Draft") return { error: 409, message: `Version ${v.version} is ${v.status}; only drafts can be published.` };
  if (metric.publishedVersion) await prisma.analyticsMetricVersion.update({ where: { metricId_version: { metricId: metric.id, version: metric.publishedVersion } }, data: { status: "Retired", deprecatedDate: new Date() } });
  const out = await prisma.analyticsMetricVersion.update({ where: { id: v.id }, data: { status: "Published", effectiveDate: new Date(), publishedByUserId: userId } });
  await prisma.analyticsMetric.update({ where: { id: metric.id }, data: { publishedVersion: v.version, status: "Published" } });
  invalidateRegistry();
  return { version: out };
}

export async function retireMetric(key) {
  const metric = await prisma.analyticsMetric.findUnique({ where: { key } });
  if (!metric) return { error: 404, message: "Metric not found." };
  await prisma.analyticsMetric.update({ where: { id: metric.id }, data: { status: "Retired" } });
  if (metric.publishedVersion) await prisma.analyticsMetricVersion.update({ where: { metricId_version: { metricId: metric.id, version: metric.publishedVersion } }, data: { deprecatedDate: new Date() } });
  invalidateRegistry();
  return { ok: true };
}
