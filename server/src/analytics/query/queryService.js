// Backend Phase 12 — semantic query service. Requests name governed metrics,
// whitelisted dimensions and filters, a date range and a comparison — never
// SQL, tables or columns. Every query is organization-bound, applies the
// caller's source-record scope BEFORE aggregation, enforces range and result
// limits, keeps money per currency (plus base currency at the business-date
// rate, with an "unavailable" note) and uses a scope-keyed cache.
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { METRIC_BY_KEY, TABLES, DASHBOARDS } from "../metrics/definitions.js";
import { registry } from "../metrics/registry.js";
import { calendarFor, localYmd, periodRange, comparisonRange, toDateValue } from "../common/calendar.js";
import { UNAVAILABLE_NOTE } from "../common/currency.js";
import { broadestScope } from "../../services/crm/scopeService.js";
import { authorizeOrgAccess } from "../../middleware/rbac.js";
import { hasGrant } from "../../utils/grants.js";
import { analyticsVersion, cacheKey, cacheGet, cacheSet } from "../common/cache.js";
import { freshness } from "../warehouse/jobs.js";
import { staleMetricKeys } from "../warehouse/reconcile.js";

export class QueryError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const MAX_RANGE_DAYS = 1096;
const MAX_DAILY_POINTS = 400;
const MAX_GROUPS = 500;
const MAX_METRICS = 20;
const GRAINS = ["day", "week", "month", "quarter", "year"];
const PRESETS = ["month", "last_month", "quarter", "fiscal_quarter", "year", "fiscal_year", "last_30_days", "last_90_days"];
const ALLOWED_KEYS = ["metrics", "range", "comparison", "groupBy", "grain", "filters", "currencyMode", "limit", "organizationId"];
const FILTER_OPS = ["eq", "neq", "in"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const q = (c) => Prisma.raw(`"${c}"`);
const D = (v) => new Prisma.Decimal(v ?? 0);

// ─── Access helpers ──────────────────────────────────────────────────────────
export { hasGrant };

// A metric is readable with its domain grant. The executive overview grant
// also exposes the overview's non-sensitive metrics (still limited to the
// viewer's record scope); financial metrics always need the finance grant.
export function canReadMetric(req, key, via = null) {
  const m = METRIC_BY_KEY[key];
  if (!m) return false;
  if (hasGrant(req, m.module, "read")) return true;
  return via === "overview" && m.sensitivity !== "sensitive" && DASHBOARDS.overview.metrics.includes(key) && hasGrant(req, "analytics_overview", "read");
}

// Resolved scope for a fact table (mirrors the CRM source-record scope).
export function scopeFor(req, table) {
  const t = TABLES[table];
  if (req.isSystemOwnerOverride) return { level: "Organization" };
  const level = t.sourceModule ? broadestScope(req.membership, t.sourceModule) : "Own";
  return { level, membershipId: req.membership?.id, team: req.user?.team || null, department: req.user?.department || null, orgOnly: !!t.orgOnly };
}

export function scopeSql(scope, table) {
  const t = TABLES[table];
  if (["Organization", "System-wide"].includes(scope.level)) return Prisma.sql`TRUE`;
  // Aggregate-only tables with no owner column need organization scope.
  if (scope.orgOnly || !("owner" in t.dims) && !t.dims.team) return Prisma.sql`FALSE`;
  const own = t.assignedColumn
    ? Prisma.sql`("ownerMembershipId" = ${scope.membershipId} OR ${q(t.assignedColumn)} = ${scope.membershipId})`
    : Prisma.sql`"ownerMembershipId" = ${scope.membershipId}`;
  if (scope.level === "Department" && scope.department && t.dims.department) return Prisma.sql`"department" = ${scope.department}`;
  if (scope.level === "Team" && scope.team && t.dims.team) return Prisma.sql`"team" = ${scope.team}`;
  return own;
}

const scopeSignature = (scope) => [scope.level, scope.membershipId, scope.team, scope.department].join(":");

// ─── Validation ──────────────────────────────────────────────────────────────
export function resolveRange(range, cal, now = new Date()) {
  const today = localYmd(now, cal.timeZone);
  let r;
  if (!range || typeof range === "string") {
    const preset = range || "last_30_days";
    if (!PRESETS.includes(preset)) throw new QueryError(422, "INVALID_RANGE", `Unknown range preset. Use one of: ${PRESETS.join(", ")}.`);
    r = { ...periodRange(preset, today, cal), preset };
  } else {
    if (range.preset) return resolveRange(range.preset, cal, now);
    if (!YMD.test(String(range.from)) || !YMD.test(String(range.to))) throw new QueryError(422, "INVALID_RANGE", "range.from and range.to must be YYYY-MM-DD dates.");
    r = { from: range.from, to: range.to, preset: null };
  }
  if (r.from > r.to) throw new QueryError(422, "INVALID_RANGE", "The range starts after it ends.");
  const days = Math.round((new Date(`${r.to}T00:00:00Z`) - new Date(`${r.from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) throw new QueryError(422, "RANGE_TOO_LARGE", `Ranges are limited to ${MAX_RANGE_DAYS} days.`);
  return { ...r, days, today };
}

export function validateRequest(body) {
  if (!body || typeof body !== "object") throw new QueryError(422, "INVALID_QUERY", "A query object is required.");
  const unknown = Object.keys(body).filter((k) => !ALLOWED_KEYS.includes(k));
  if (unknown.length) throw new QueryError(422, "UNKNOWN_FIELDS", `Unsupported query fields: ${unknown.join(", ")}. Queries use governed metrics, not SQL.`);
  const metrics = [].concat(body.metrics || []);
  if (!metrics.length) throw new QueryError(422, "INVALID_QUERY", "At least one metric is required.");
  if (metrics.length > MAX_METRICS) throw new QueryError(422, "TOO_MANY_METRICS", `At most ${MAX_METRICS} metrics per query.`);
  for (const k of metrics) if (typeof k !== "string" || !METRIC_BY_KEY[k]) throw new QueryError(422, "UNKNOWN_METRIC", `Unknown metric ${String(k).slice(0, 60)}.`);
  if (body.grain !== undefined && body.grain !== null && !GRAINS.includes(body.grain)) throw new QueryError(422, "INVALID_GRAIN", `grain must be one of ${GRAINS.join(", ")}.`);
  if (body.comparison !== undefined && body.comparison !== null && !["none", "previous_period", "previous_year"].includes(body.comparison)) throw new QueryError(422, "INVALID_COMPARISON", "comparison must be none, previous_period or previous_year.");
  if (body.currencyMode !== undefined && !["base", "original"].includes(body.currencyMode)) throw new QueryError(422, "INVALID_CURRENCY_MODE", "currencyMode must be base or original.");
  const filters = [].concat(body.filters || []);
  if (filters.length > 10) throw new QueryError(422, "TOO_MANY_FILTERS", "At most 10 filters.");
  for (const f of filters) {
    if (!f || typeof f !== "object" || typeof f.field !== "string" || !FILTER_OPS.includes(f.op || "eq")) throw new QueryError(422, "INVALID_FILTER", "Filters are { field, op: eq|neq|in, value }.");
    const vals = [].concat(f.value);
    if (!vals.length || vals.length > 50 || vals.some((v) => !["string", "number", "boolean"].includes(typeof v) || String(v).length > 200)) throw new QueryError(422, "INVALID_FILTER", "Filter values must be up to 50 short strings, numbers or booleans.");
  }
  const limit = Math.min(MAX_GROUPS, Math.max(1, Number(body.limit) || 50));
  return { metrics: [...new Set(metrics)], filters, limit, grain: body.grain || null, comparison: body.comparison || "none", groupBy: body.groupBy || null, currencyMode: body.currencyMode || "base" };
}

// Component (non-ratio) metrics a request needs.
const componentsOf = (key) => { const m = METRIC_BY_KEY[key]; return m.agg === "ratio" ? [...componentsOf(m.numerator), ...componentsOf(m.denominator)] : [key]; };

function dimColumn(m, dim) {
  const t = TABLES[m.table];
  const col = t.dims[dim];
  if (!col) throw new QueryError(422, "UNSUPPORTED_DIMENSION", `Metric ${m.key} cannot be grouped by ${String(dim).slice(0, 40)}. Allowed: ${Object.keys(t.dims).join(", ")}.`);
  return col;
}

// ─── SQL building ────────────────────────────────────────────────────────────
function condSql([col, op, value], today) {
  const v = value === "$today" ? toDateValue(today) : value;
  switch (op) {
    case "=": return Prisma.sql`${q(col)} = ${v}`;
    case "!=": return Prisma.sql`(${q(col)} IS NULL OR ${q(col)} <> ${v})`;
    case "in": return Prisma.sql`${q(col)} IN (${Prisma.join(v)})`;
    case "notin": return Prisma.sql`(${q(col)} IS NULL OR ${q(col)} NOT IN (${Prisma.join(v)}))`;
    case "null": return Prisma.sql`${q(col)} IS NULL`;
    case "notnull": return Prisma.sql`${q(col)} IS NOT NULL`;
    case "<": return Prisma.sql`${q(col)} < ${v}`;
    case "<=": return Prisma.sql`${q(col)} <= ${v}`;
    case ">": return Prisma.sql`${q(col)} > ${v}`;
    case ">=": return Prisma.sql`${q(col)} >= ${v}`;
    default: throw new Error(`bad op ${op}`);
  }
}

function filterSql(m, f) {
  const col = dimColumn(m, f.field);
  const vals = [].concat(f.value).map((x) => (col === "billable" ? x === true || x === "true" : String(x)));
  if ((f.op || "eq") === "in") return Prisma.sql`${q(col)} IN (${Prisma.join(vals)})`;
  if (f.op === "neq") return Prisma.sql`(${q(col)} IS NULL OR ${q(col)} <> ${vals[0]})`;
  return Prisma.sql`${q(col)} = ${vals[0]}`;
}

function aggSql(m) {
  const scale = m.scale ? Prisma.raw(` * ${Number(m.scale)}`) : Prisma.empty;
  if (m.agg === "count") return Prisma.sql`COUNT(*)::numeric`;
  if (m.agg === "count_distinct") return Prisma.sql`COUNT(DISTINCT ${q(m.column)})::numeric`;
  if (m.agg === "sum") return Prisma.sql`COALESCE(SUM(${q(m.column)}), 0)::numeric${scale}`;
  if (m.agg === "avg") return Prisma.sql`AVG(${q(m.column)})::numeric${scale}`;
  if (m.agg === "sum_expr") return Prisma.sql`COALESCE(SUM(${Prisma.join(m.columns.map((c) => Prisma.sql`COALESCE(${q(c)}, 0)`), " + ")}), 0)::numeric`;
  throw new Error(`bad agg ${m.agg}`);
}

// grain is validated against GRAINS, so it is inlined (a bound parameter would
// make the SELECT and GROUP BY expressions differ).
const bucketSql = (grain, dateCol) => { if (!GRAINS.includes(grain)) throw new Error("bad grain"); return Prisma.sql`date_trunc('${Prisma.raw(grain)}', ${q(dateCol)})::date`; };

// Runs one component metric: → rows [{ period?, dim?, currency?, value, base?, unavailable?, n }]
async function runComponent(organizationId, m, { from, to, today }, { scope, filters, groupBy, grain }) {
  const t = TABLES[m.table];
  const dateCol = m.dateColumn || t.date;
  const where = [Prisma.sql`"organizationId" = ${organizationId}`, scopeSql(scope, m.table)];
  if (t.deleted) where.push(Prisma.sql`"isDeleted" = FALSE`);
  for (const c of m.where || []) where.push(condSql(c, today));
  for (const f of filters) where.push(filterSql(m, f));
  let snapshotDate = null;
  if (m.snapshot) {
    if (grain) {
      where.push(Prisma.sql`${q(dateCol)} BETWEEN ${toDateValue(from)} AND ${toDateValue(to)}`);
    } else {
      // Semi-additive: the value on the last snapshot date in the period.
      const [row] = await prisma.$queryRaw`SELECT MAX(${q(dateCol)}) AS d FROM ${q(m.table)} WHERE "organizationId" = ${organizationId} AND ${q(dateCol)} BETWEEN ${toDateValue(from)} AND ${toDateValue(to)}`;
      if (!row?.d) return { rows: [], snapshotDate: null };
      snapshotDate = row.d;
      where.push(Prisma.sql`${q(dateCol)} = ${row.d}`);
    }
  } else if (!m.current) {
    where.push(Prisma.sql`${q(dateCol)} BETWEEN ${toDateValue(from)} AND ${toDateValue(to)}`);
  }
  const sel = []; const grp = [];
  if (grain && !m.current) {
    // Snapshots group by day and are reduced to the last day of each bucket below.
    const exp = m.snapshot ? Prisma.sql`${q(dateCol)}` : bucketSql(grain, dateCol);
    sel.push(Prisma.sql`${exp} AS period`); grp.push(exp);
  }
  if (groupBy) { const col = dimColumn(m, groupBy); sel.push(Prisma.sql`${q(col)}::text AS dim`); grp.push(q(col)); }
  const moneyCur = m.money ? "currency" : m.currencyColumn || null;
  if (moneyCur) { sel.push(Prisma.sql`${q(moneyCur)} AS currency`); grp.push(q(moneyCur)); }
  sel.push(Prisma.sql`(${aggSql(m)})::text AS value`);
  if (m.money) {
    const baseCol = m.baseColumn || "baseAmount";
    sel.push(Prisma.sql`COALESCE(SUM(${q(baseCol)}), 0)::text AS base`);
    sel.push(Prisma.sql`COUNT(*) FILTER (WHERE ${q(baseCol)} IS NULL)::int AS unavailable`);
  }
  sel.push(Prisma.sql`COUNT(*)::int AS n`);
  const sql = Prisma.sql`SELECT ${Prisma.join(sel)} FROM ${q(m.table)} WHERE ${Prisma.join(where, " AND ")}${grp.length ? Prisma.sql` GROUP BY ${Prisma.join(grp)}` : Prisma.empty} LIMIT 5000`;
  const rows = await prisma.$queryRaw(sql);
  return { rows, snapshotDate };
}

// ─── Result shaping ──────────────────────────────────────────────────────────
function bucketOf(ymd, grain) {
  if (grain === "day") return ymd;
  const d = new Date(`${ymd}T00:00:00Z`);
  if (grain === "week") { const w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10); }
  if (grain === "month") return `${ymd.slice(0, 7)}-01`;
  if (grain === "quarter") { const m = Math.floor(d.getUTCMonth() / 3) * 3 + 1; return `${ymd.slice(0, 4)}-${String(m).padStart(2, "0")}-01`; }
  return `${ymd.slice(0, 4)}-01-01`;
}
const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// For snapshot metrics grouped by grain: keep only the last day in each bucket.
function reduceSnapshots(rows, grain) {
  const last = new Map();
  for (const r of rows) { const b = bucketOf(ymd(r.period), grain); const d = ymd(r.period); if (!last.has(b) || last.get(b) < d) last.set(b, d); }
  return rows.filter((r) => last.get(bucketOf(ymd(r.period), grain)) === ymd(r.period)).map((r) => ({ ...r, period: bucketOf(ymd(r.period), grain) }));
}

// Collapses rows sharing a key: money → per currency + base; others → value.
function combine(m, rows, baseCurrency, currencyMode) {
  const money = !!(m.money || m.currencyColumn);
  if (!money) {
    // Averages cannot be re-aggregated from grouped averages; callers only
    // combine rows of the same group here, so a single row is expected.
    const total = rows.reduce((s, r) => (r.value === null ? s : s.add(D(r.value))), D(0));
    const hasValue = rows.some((r) => r.value !== null);
    const n = rows.reduce((s, r) => s + r.n, 0);
    const value = !hasValue ? null : m.agg === "avg" && rows.length > 1 ? null : total;
    return { value: value === null ? null : Number(value.toDecimalPlaces(m.unit === "hours" ? 2 : 4)), n, ...(m.fixedCurrency ? { currency: m.fixedCurrency } : {}) };
  }
  const byCurrency = new Map();
  let base = D(0); let unavailable = 0; let n = 0;
  for (const r of rows) {
    byCurrency.set(r.currency, D(byCurrency.get(r.currency)).add(D(r.value)));
    if (m.money) { base = base.add(D(r.base)); unavailable += r.unavailable || 0; }
    n += r.n;
  }
  const list = [...byCurrency.entries()].map(([currency, v]) => ({ currency, value: v.toFixed(2) })).sort((a, b) => a.currency.localeCompare(b.currency));
  if (!m.money) {
    // Budget currency: one currency → a value; several → per currency only.
    return { value: list.length === 1 ? list[0].value : null, currency: list.length === 1 ? list[0].currency : null, byCurrency: list, n, note: list.length > 1 ? "Budgets in different currencies are shown separately." : undefined };
  }
  if (currencyMode === "original") return { value: list.length === 1 ? list[0].value : null, currency: list.length === 1 ? list[0].currency : null, byCurrency: list, n, note: list.length > 1 ? "Multiple currencies are shown separately and not added together." : undefined };
  return { value: base.toFixed(2), currency: baseCurrency, byCurrency: list, unavailableCount: unavailable, n, note: unavailable ? UNAVAILABLE_NOTE : undefined };
}

function groupRows(rows, keyFn) {
  const out = new Map();
  for (const r of rows) { const k = keyFn(r); if (!out.has(k)) out.set(k, []); out.get(k).push(r); }
  return out;
}

async function dimLabels(organizationId, dim, keys) {
  const type = { owner: "owner", project: "project" }[dim];
  if (!type || !keys.length) return {};
  const dims = await prisma.analyticsDimension.findMany({ where: { organizationId, type, sourceId: { in: keys } }, select: { sourceId: true, label: true } });
  return Object.fromEntries(dims.map((d) => [d.sourceId, d.label]));
}

async function computeMetric(organizationId, key, range, opts, ctx) {
  const m = METRIC_BY_KEY[key];
  if (m.agg === "ratio") {
    const [num, den] = await Promise.all([computeMetric(organizationId, m.numerator, range, opts, ctx), computeMetric(organizationId, m.denominator, range, opts, ctx)]);
    const ratio = (a, b) => (a === null || b === null || Number(b) === 0 ? null : Number((Number(a) / Number(b) * 100).toFixed(2)));
    const out = { value: ratio(num.value, den.value), numerator: num.value, denominator: den.value, note: den.value === 0 || den.value === null ? "No denominator in this period." : undefined };
    if (num.series && den.series) {
      const dBy = Object.fromEntries(den.series.map((p) => [p.period, p.value]));
      out.series = num.series.map((p) => ({ period: p.period, value: ratio(p.value, dBy[p.period] ?? 0) }));
    }
    if (num.groups && den.groups) {
      const dBy = Object.fromEntries(den.groups.map((g) => [g.key, g.value]));
      out.groups = den.groups.map((g) => ({ key: g.key, label: g.label, value: ratio(num.groups.find((x) => x.key === g.key)?.value ?? 0, dBy[g.key]) }));
    }
    return out;
  }
  const scope = scopeFor(ctx.req, m.table);
  const res = await runComponent(organizationId, m, range, { scope, filters: opts.filters, groupBy: opts.groupBy, grain: opts.grain });
  let rows = res.rows;
  if (opts.grain && m.snapshot) rows = reduceSnapshots(rows, opts.grain);
  const out = { ...combine(m, rows, ctx.base, opts.currencyMode), ...(res.snapshotDate ? { snapshotDate: ymd(res.snapshotDate) } : {}) };
  if (m.agg === "avg" && (opts.grain || opts.groupBy)) {
    // The headline average must be computed over all rows, not from buckets.
    const whole = await runComponent(organizationId, m, range, { scope, filters: opts.filters, groupBy: null, grain: null });
    Object.assign(out, combine(m, whole.rows, ctx.base, opts.currencyMode));
  } else if (opts.grain || opts.groupBy) {
    Object.assign(out, combine(m, rows, ctx.base, opts.currencyMode));
  }
  if (opts.grain && !m.current) {
    const byPeriod = groupRows(rows, (r) => ymd(r.period));
    out.series = [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, rs]) => ({ period, ...pick(combine(m, rs, ctx.base, opts.currencyMode)) }));
  }
  if (opts.groupBy) {
    const byDim = groupRows(rows, (r) => r.dim ?? "");
    const labels = await dimLabels(organizationId, opts.groupBy, [...byDim.keys()].filter(Boolean));
    out.groups = [...byDim.entries()].map(([k, rs]) => ({ key: k || null, label: k ? labels[k] || k : "Not set", ...pick(combine(m, rs, ctx.base, opts.currencyMode)) }))
      .sort((a, b) => Number(b.value ?? -Infinity) - Number(a.value ?? -Infinity)).slice(0, opts.limit);
    out.groupsTruncated = byDim.size > opts.limit;
  }
  if (m.current) out.asOf = range.today;
  return out;
}
const pick = ({ value, currency, byCurrency, unavailableCount, n }) => ({ value, ...(currency ? { currency } : {}), ...(byCurrency ? { byCurrency } : {}), ...(unavailableCount ? { unavailableCount } : {}), n });

export function comparisonOf(m, cur, prev, label) {
  // Current-value metrics have no historical comparison.
  if (m.current) return { label: "Comparison unavailable", value: null, change: null, changePercent: null, note: "Comparison unavailable — this is a current value." };
  const a = cur.value === null ? null : Number(cur.value); const b = prev.value === null ? null : Number(prev.value);
  if (b === null) return { label, value: null, change: null, changePercent: null, note: "No prior-period value." };
  if (a === null) return { label, value: prev.value, change: null, changePercent: null, note: "Comparison unavailable." };
  // A percentage change from zero is undefined, never shown as infinite.
  return { label, value: prev.value, change: Number((a - b).toFixed(2)), changePercent: b === 0 ? null : Number(((a - b) / Math.abs(b) * 100).toFixed(1)), note: b === 0 ? (a === 0 ? "No change (both zero)." : "New from zero.") : undefined };
}

// ─── Public API ──────────────────────────────────────────────────────────────
export async function runQuery(req, body, { now = new Date(), skipCache = false, via = null } = {}) {
  const organizationId = req.organizationId;
  const opts = validateRequest(body);
  const reg = await registry();
  for (const k of opts.metrics) {
    const m = METRIC_BY_KEY[k];
    const r = reg[k];
    if (!r || r.status !== "Published") throw new QueryError(422, "METRIC_NOT_PUBLISHED", `Metric ${k} is not published.`);
    if (!canReadMetric(req, k, via)) throw new QueryError(403, "METRIC_FORBIDDEN", `You do not have access to ${m.name}.`);
    for (const c of componentsOf(k)) {
      const cm = METRIC_BY_KEY[c];
      if (opts.groupBy) dimColumn(cm, opts.groupBy);
      for (const f of opts.filters) dimColumn(cm, f.field);
    }
  }
  const cal = await calendarFor(organizationId);
  const range = resolveRange(body.range, cal, now);
  if (opts.grain === "day" && range.days > MAX_DAILY_POINTS) throw new QueryError(422, "RANGE_TOO_LARGE", `Daily series are limited to ${MAX_DAILY_POINTS} days; use a week or month grain.`);
  const scopes = [...new Set(opts.metrics.flatMap(componentsOf).map((k) => METRIC_BY_KEY[k].table))].map((t) => scopeSignature(scopeFor(req, t)));
  const version = await analyticsVersion(organizationId);
  const key = cacheKey(organizationId, version, { opts, via, range: [range.from, range.to, range.today], scopes, tz: cal.timeZone, base: cal.baseCurrency });
  const hit = skipCache ? null : cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const ctx = { req, base: cal.baseCurrency };
  const cmpRange = opts.comparison !== "none" ? { ...comparisonRange(range, opts.comparison), today: range.today } : null;
  const [fresh, stale] = await Promise.all([freshness(organizationId), staleMetricKeys(organizationId)]);
  const results = [];
  for (const k of opts.metrics) {
    const m = METRIC_BY_KEY[k];
    const cur = await computeMetric(organizationId, k, range, opts, ctx);
    let comparison = null;
    if (cmpRange) {
      const prev = await computeMetric(organizationId, k, cmpRange, { ...opts, grain: null, groupBy: null }, ctx);
      comparison = comparisonOf(m, cur, prev, opts.comparison === "previous_year" ? `${cmpRange.from} – ${cmpRange.to} (previous year)` : `${cmpRange.from} – ${cmpRange.to} (previous period)`);
    }
    const loads = (m.sources || []).map((s) => fresh[s]?.lastLoadedAt || null);
    const lastLoadedAt = loads.includes(null) ? null : loads.sort((a, b) => a - b)[0] || null;
    const ageMin = lastLoadedAt ? (now - new Date(lastLoadedAt)) / 60000 : null;
    results.push({
      key: k, name: m.name, version: reg[k].version, unit: m.unit, additivity: m.additivity, definition: m.definition, sensitivity: m.sensitivity,
      ...cur, comparison,
      freshness: { lastLoadedAt, stale: lastLoadedAt === null || ageMin > m.freshnessTargetMinutes * 2 || stale.has(k), issues: stale.get(k) || [], targetMinutes: m.freshnessTargetMinutes },
    });
  }
  const out = {
    range: { from: range.from, to: range.to, preset: range.preset, days: range.days }, comparisonRange: cmpRange ? { from: cmpRange.from, to: cmpRange.to } : null,
    timeZone: cal.timeZone, baseCurrency: cal.baseCurrency, fiscalYearStartMonth: cal.fiscalYearStartMonth, grain: opts.grain, groupBy: opts.groupBy,
    generatedAt: now.toISOString(), metrics: results,
    disclaimer: "Operational analytics from the reporting warehouse — not audited financial statements.",
  };
  cacheSet(key, out);
  return out;
}

export async function dashboard(req, name, { range, comparison = "previous_period", currencyMode = "base" } = {}) {
  const d = DASHBOARDS[name];
  if (!d) throw new QueryError(404, "NOT_FOUND", "Unknown dashboard.");
  const visible = d.metrics.filter((k) => canReadMetric(req, k, name));
  const hidden = d.metrics.length - visible.length;
  const out = visible.length ? await runQuery(req, { metrics: visible, range, comparison, currencyMode }, { via: name }) : { metrics: [] };
  if (d.trend && visible.includes(d.trend)) {
    const t = await runQuery(req, { metrics: [d.trend], range, grain: pickGrain(out.range?.days || 30), currencyMode }, { via: name });
    out.trend = { metric: d.trend, grain: t.grain, series: t.metrics[0].series || [] };
  }
  if (d.breakdown && visible.includes(d.breakdown.metric)) {
    const b = await runQuery(req, { metrics: [d.breakdown.metric], range, groupBy: d.breakdown.dimension, limit: 12, currencyMode }, { via: name });
    out.breakdown = { metric: d.breakdown.metric, dimension: d.breakdown.dimension, groups: b.metrics[0].groups || [] };
  }
  return { dashboard: name, hiddenMetrics: hidden, ...out };
}
const pickGrain = (days) => (days <= 45 ? "day" : days <= 200 ? "week" : "month");

// Drill-down: the fact rows behind a metric (IDs and reporting attributes
// only), scoped, capped, and only when the caller can open the source records.
export async function drilldown(req, body, { now = new Date() } = {}) {
  const { metric, range, filters = [], group = null, groupBy = null } = body || {};
  const m = METRIC_BY_KEY[metric];
  if (!m) throw new QueryError(422, "UNKNOWN_METRIC", "Unknown metric.");
  if (m.agg === "ratio") throw new QueryError(422, "NOT_DRILLABLE", "Drill into the numerator or denominator metric instead.");
  if (!hasGrant(req, m.module, "read")) throw new QueryError(403, "METRIC_FORBIDDEN", `You do not have access to ${m.name}.`);
  const t = TABLES[m.table];
  if (!t.drill) throw new QueryError(422, "NOT_DRILLABLE", "This metric has no record-level drill-down.");
  if (!req.isSystemOwnerOverride) {
    const access = await authorizeOrgAccess(req.user, req.organizationId, t.drill.module, "view");
    if (!access.ok) throw new QueryError(403, "SOURCE_FORBIDDEN", "You can see this total but not the underlying records.");
  }
  const opts = validateRequest({ metrics: [metric], filters: [...filters, ...(groupBy ? [{ field: groupBy, op: "eq", value: group ?? "" }] : [])] });
  const cal = await calendarFor(req.organizationId);
  const r = resolveRange(range, cal, now);
  const scope = scopeFor(req, m.table);
  const dateCol = m.dateColumn || t.date;
  const where = [Prisma.sql`"organizationId" = ${req.organizationId}`, scopeSql(scope, m.table)];
  if (t.deleted) where.push(Prisma.sql`"isDeleted" = FALSE`);
  for (const c of m.where || []) where.push(condSql(c, r.today));
  for (const f of opts.filters) where.push(filterSql(m, f));
  if (m.snapshot) {
    const [row] = await prisma.$queryRaw`SELECT MAX(${q(dateCol)}) AS d FROM ${q(m.table)} WHERE "organizationId" = ${req.organizationId} AND ${q(dateCol)} BETWEEN ${toDateValue(r.from)} AND ${toDateValue(r.to)}`;
    where.push(row?.d ? Prisma.sql`${q(dateCol)} = ${row.d}` : Prisma.sql`FALSE`);
  } else if (!m.current) where.push(Prisma.sql`${q(dateCol)} BETWEEN ${toDateValue(r.from)} AND ${toDateValue(r.to)}`);
  const idCol = t.drill.idColumn || "sourceId";
  const cols = [q(idCol), q(dateCol), ...["status", "currency", "amount", "ownerMembershipId"].filter((c) => columnExists(m.table, c)).map(q)];
  const rows = await prisma.$queryRaw`SELECT ${Prisma.join(cols)} FROM ${q(m.table)} WHERE ${Prisma.join(where, " AND ")} ORDER BY ${q(dateCol)} DESC NULLS LAST LIMIT 201`;
  const owners = await dimLabels(req.organizationId, "owner", [...new Set(rows.map((x) => x.ownerMembershipId).filter(Boolean))]);
  return {
    metric, range: { from: r.from, to: r.to }, truncated: rows.length > 200, path: t.drill.path,
    rows: rows.slice(0, 200).map((x) => ({ id: x[idCol], date: x[dateCol] ? ymd(x[dateCol]) : null, status: x.status ?? null, currency: x.currency ?? null, amount: x.amount === undefined || x.amount === null ? null : D(x.amount).toFixed(2), owner: x.ownerMembershipId ? owners[x.ownerMembershipId] || null : null })),
  };
}

const COLUMNS = {
  analytics_fact_leads: ["status", "currency", "ownerMembershipId"], analytics_fact_activities: ["status", "ownerMembershipId"], analytics_fact_deal_events: ["ownerMembershipId"],
  analytics_fact_deal_snapshots: ["status", "currency", "amount", "ownerMembershipId"], analytics_fact_quotes: ["status", "currency", "amount", "ownerMembershipId"], analytics_fact_orders: ["status", "currency", "amount", "ownerMembershipId"],
  analytics_fact_contracts: ["status", "currency", "amount", "ownerMembershipId"], analytics_fact_support: ["status", "ownerMembershipId"], analytics_fact_projects: ["status", "currency", "ownerMembershipId"],
  analytics_fact_tasks: ["status", "ownerMembershipId"], analytics_fact_invoices: ["status", "currency", "amount", "ownerMembershipId"], analytics_fact_payments: ["status", "currency", "amount", "ownerMembershipId"],
  analytics_fact_expenses: ["status", "currency", "amount", "ownerMembershipId"],
};
const columnExists = (table, col) => (COLUMNS[table] || []).includes(col);
