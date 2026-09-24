// Backend Phase 12 — scheduled report delivery. Occurrences are computed in
// the schedule's own time zone (DST-safe wall-clock times), claimed once via a
// unique occurrence key, and delivered as governed exports generated with
// EACH RECIPIENT's current access — recipients who lost access are skipped.
// Deliveries are in-app (the recipient's export inbox) or an email containing
// only a sign-in link; files are never attached and links are never public.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { QueryError, hasGrant } from "../query/queryService.js";
import { METRIC_BY_KEY } from "../metrics/definitions.js";
import { canRead } from "./reportService.js";
import { requestExport, contextForMembership } from "../exports/exportService.js";
import { FORMATS } from "../exports/formats.js";
import { calendarFor, localYmd, addDays } from "../common/calendar.js";
import { freshness } from "../warehouse/jobs.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { recordOutboxEvent } from "../../services/outboxService.js";

const FREQUENCIES = ["once", "daily", "weekly", "monthly", "quarterly"];
const DELIVERY = ["in_app", "secure_link", "email_link"];
const STALE = ["deliver", "skip", "deliver_with_warning"];
const FAILURE = ["skip", "retry", "notify_owner"];
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_RECIPIENTS = 50;

// Minutes the zone is ahead of UTC at an instant.
function offsetMinutes(instant, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(instant).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((asUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
}

// The UTC instant of a local wall-clock time. A time skipped by a DST jump
// moves forward to the first valid minute; a repeated time uses the first.
export function zonedTimeToUtc(ymd, hhmm, timeZone) {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = new Date(wall - offsetMinutes(new Date(wall), timeZone) * 60000);
  guess = new Date(wall - offsetMinutes(guess, timeZone) * 60000);
  const back = offsetMinutes(guess, timeZone);
  const wallBack = guess.getTime() + back * 60000;
  if (wallBack !== wall) guess = new Date(guess.getTime() + (wall - wallBack)); // skipped hour
  // Prefer the earlier of two matching instants (fall-back repeat).
  const earlier = new Date(guess.getTime() - 3_600_000);
  if (earlier.getTime() + offsetMinutes(earlier, timeZone) * 60000 === wall) return earlier;
  return guess;
}

const dow = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const dom = (ymd) => Number(ymd.slice(8, 10));

// Next occurrence strictly after `after`.
export function nextRunAfter(s, after = new Date()) {
  const tz = s.timeZone;
  if (s.frequency === "once") {
    if (!s.startDate) return null;
    const at = zonedTimeToUtc(new Date(s.startDate).toISOString().slice(0, 10), s.runAt, tz);
    return at > after ? at : null;
  }
  let day = localYmd(after, tz);
  const start = s.startDate ? new Date(s.startDate).toISOString().slice(0, 10) : null;
  for (let i = 0; i < 400; i += 1, day = addDays(day, 1)) {
    if (start && day < start) continue;
    const month = Number(day.slice(5, 7));
    const match = s.frequency === "daily"
      || (s.frequency === "weekly" && dow(day) === (s.dayOfWeek ?? 1))
      || (s.frequency === "monthly" && dom(day) === (s.dayOfMonth ?? 1))
      || (s.frequency === "quarterly" && dom(day) === (s.dayOfMonth ?? 1) && [1, 4, 7, 10].includes(month));
    if (!match) continue;
    const at = zonedTimeToUtc(day, s.runAt, tz);
    if (at > after) return at;
  }
  return null;
}

const serialize = (s, report) => ({
  _id: s.publicId, reportId: report?.publicId || null, reportName: report?.name || null, frequency: s.frequency, runAt: s.runAt, timeZone: s.timeZone, dayOfWeek: s.dayOfWeek, dayOfMonth: s.dayOfMonth,
  startDate: s.startDate, nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt, recipients: s.recipients, deliveryMethod: s.deliveryMethod, format: s.format, expiresAt: s.expiresAt,
  failurePolicy: s.failurePolicy, stalePolicy: s.stalePolicy, active: s.active, pausedReason: s.pausedReason, version: s.version, ownerMembershipId: s.ownerMembershipId,
});

async function validate(req, body, existing = null) {
  const out = {};
  const pick = (k) => (body[k] !== undefined ? body[k] : existing?.[k]);
  const frequency = pick("frequency") || "weekly";
  if (!FREQUENCIES.includes(frequency)) throw new QueryError(422, "INVALID_SCHEDULE", `frequency must be one of ${FREQUENCIES.join(", ")} (custom cron expressions are not supported).`);
  out.frequency = frequency;
  const runAt = pick("runAt") || "08:00";
  if (!HHMM.test(runAt)) throw new QueryError(422, "INVALID_SCHEDULE", "runAt must be HH:MM (24-hour).");
  out.runAt = runAt;
  const cal = await calendarFor(req.organizationId);
  const tz = pick("timeZone") || cal.timeZone;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { throw new QueryError(422, "INVALID_SCHEDULE", "timeZone must be an IANA time zone such as Europe/London."); }
  out.timeZone = tz;
  const dw = pick("dayOfWeek"); const dm = pick("dayOfMonth");
  if (frequency === "weekly") { if (dw === undefined || dw === null || !Number.isInteger(Number(dw)) || dw < 0 || dw > 6) throw new QueryError(422, "INVALID_SCHEDULE", "dayOfWeek (0 = Sunday … 6 = Saturday) is required for weekly schedules."); out.dayOfWeek = Number(dw); } else out.dayOfWeek = null;
  if (["monthly", "quarterly"].includes(frequency)) { if (!Number.isInteger(Number(dm)) || dm < 1 || dm > 28) throw new QueryError(422, "INVALID_SCHEDULE", "dayOfMonth must be 1–28 so every month has it."); out.dayOfMonth = Number(dm); } else out.dayOfMonth = null;
  const startDate = pick("startDate");
  if (startDate) { if (!/^\d{4}-\d{2}-\d{2}/.test(String(startDate instanceof Date ? startDate.toISOString() : startDate))) throw new QueryError(422, "INVALID_SCHEDULE", "startDate must be YYYY-MM-DD."); out.startDate = new Date(`${String(startDate instanceof Date ? startDate.toISOString() : startDate).slice(0, 10)}T00:00:00Z`); } else out.startDate = null;
  if (frequency === "once" && !out.startDate) throw new QueryError(422, "INVALID_SCHEDULE", "A one-time schedule needs startDate.");
  const deliveryMethod = pick("deliveryMethod") || "in_app";
  if (deliveryMethod === "attachment") throw new QueryError(422, "ATTACHMENTS_DISABLED", "Report files are never emailed as attachments; use in-app or an email sign-in link.");
  if (!DELIVERY.includes(deliveryMethod)) throw new QueryError(422, "INVALID_SCHEDULE", `deliveryMethod must be one of ${DELIVERY.join(", ")}.`);
  out.deliveryMethod = deliveryMethod;
  const format = pick("format") || "csv";
  if (!FORMATS[format]) throw new QueryError(422, "INVALID_FORMAT", `format must be one of ${Object.keys(FORMATS).join(", ")}.`);
  out.format = format;
  out.stalePolicy = pick("stalePolicy") || "skip";
  if (!STALE.includes(out.stalePolicy)) throw new QueryError(422, "INVALID_SCHEDULE", `stalePolicy must be one of ${STALE.join(", ")}.`);
  out.failurePolicy = pick("failurePolicy") || "notify_owner";
  if (!FAILURE.includes(out.failurePolicy)) throw new QueryError(422, "INVALID_SCHEDULE", `failurePolicy must be one of ${FAILURE.join(", ")}.`);
  const expiresAt = pick("expiresAt");
  out.expiresAt = expiresAt ? new Date(expiresAt) : null;
  if (out.expiresAt && Number.isNaN(out.expiresAt.getTime())) throw new QueryError(422, "INVALID_SCHEDULE", "expiresAt must be a date.");
  const recipients = [].concat(pick("recipients") || []);
  if (!recipients.length) throw new QueryError(422, "INVALID_RECIPIENTS", "At least one recipient is required.");
  if (recipients.length > MAX_RECIPIENTS) throw new QueryError(422, "INVALID_RECIPIENTS", `At most ${MAX_RECIPIENTS} recipients.`);
  const clean = [];
  for (const r of recipients) {
    if (r?.type === "External" || r?.email) throw new QueryError(422, "EXTERNAL_RECIPIENTS_DISABLED", "Only members of this organization can receive scheduled reports.");
    if (r?.type === "Membership") {
      const m = await prisma.organizationMembership.findFirst({ where: { id: String(r.id), organizationId: req.organizationId, status: "Active" } });
      if (!m) throw new QueryError(422, "INVALID_RECIPIENTS", "Recipients must be active members of this organization.");
      clean.push({ type: "Membership", id: m.id });
    } else if (r?.type === "Role") {
      const role = await prisma.role.findFirst({ where: { key: String(r.id), status: "Active" } });
      if (!role) throw new QueryError(422, "INVALID_RECIPIENTS", "Unknown role.");
      clean.push({ type: "Role", id: role.key });
    } else throw new QueryError(422, "INVALID_RECIPIENTS", "Recipients are { type: Membership|Role, id }.");
  }
  out.recipients = clean;
  return out;
}

async function loadReportFor(req, publicId) {
  const report = await prisma.analyticsReport.findFirst({ where: { publicId: String(publicId), organizationId: req.organizationId } });
  const shares = report ? await prisma.analyticsReportShare.findMany({ where: { reportId: report.id } }) : [];
  if (!report || !canRead(req, report, shares)) throw new QueryError(404, "NOT_FOUND", "Report not found.");
  if (report.archivedAt) throw new QueryError(409, "ARCHIVED", "Archived reports cannot be scheduled.");
  return report;
}

const audit = (req, action, targetId, extra = {}) => recordAuditEvent({ ...requestContext(req), actorUserId: req.user?.id || null, actorMembershipId: req.membership?.id || null, organizationId: req.organizationId, action, targetType: "AnalyticsReportSchedule", targetId, result: "Success", ...extra }).catch(() => {});

export async function createSchedule(req, body = {}) {
  if (!req.membership?.id) throw new QueryError(403, "MEMBERSHIP_REQUIRED", "Schedules need a membership in this organization.");
  const report = await loadReportFor(req, body.reportId);
  const data = await validate(req, body);
  const s = await prisma.analyticsReportSchedule.create({ data: { publicId: `sch_${crypto.randomBytes(8).toString("base64url")}`, organizationId: req.organizationId, reportId: report.id, ownerMembershipId: req.membership.id, ...data } });
  const withNext = await prisma.analyticsReportSchedule.update({ where: { id: s.id }, data: { nextRunAt: nextRunAfter(s) } });
  await audit(req, "analytics.schedule.created", s.publicId, { after: { report: report.publicId, frequency: data.frequency, recipients: data.recipients.length, deliveryMethod: data.deliveryMethod } });
  return serialize(withNext, report);
}

async function loadSchedule(req, id) {
  const s = await prisma.analyticsReportSchedule.findFirst({ where: { publicId: String(id), organizationId: req.organizationId } });
  if (!s) throw new QueryError(404, "NOT_FOUND", "Schedule not found.");
  const mine = s.ownerMembershipId === req.membership?.id;
  if (!mine && !req.isSystemOwnerOverride && !hasGrant(req, "analytics_reports", "read_organization")) throw new QueryError(404, "NOT_FOUND", "Schedule not found.");
  return { s, mine };
}

export async function listSchedules(req) {
  const all = req.isSystemOwnerOverride || hasGrant(req, "analytics_reports", "read_organization");
  const rows = await prisma.analyticsReportSchedule.findMany({ where: { organizationId: req.organizationId, ...(all ? {} : { ownerMembershipId: req.membership?.id || "none" }) }, orderBy: { createdAt: "desc" }, take: 200 });
  const reports = rows.length ? await prisma.analyticsReport.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.reportId))] } }, select: { id: true, publicId: true, name: true } }) : [];
  const rBy = Object.fromEntries(reports.map((r) => [r.id, r]));
  return rows.map((s) => serialize(s, rBy[s.reportId]));
}

export async function getSchedule(req, id) {
  const { s } = await loadSchedule(req, id);
  const report = await prisma.analyticsReport.findUnique({ where: { id: s.reportId }, select: { publicId: true, name: true } });
  const runs = await prisma.analyticsScheduleRun.findMany({ where: { scheduleId: s.id }, orderBy: { scheduledFor: "desc" }, take: 20 });
  return { ...serialize(s, report), runs: runs.map((r) => ({ scheduledFor: r.scheduledFor, status: r.status, deliveries: r.deliveries, safeError: r.safeError, completedAt: r.completedAt })) };
}

export async function updateSchedule(req, id, body = {}) {
  const { s, mine } = await loadSchedule(req, id);
  if (!mine && !req.isSystemOwnerOverride) throw new QueryError(403, "FORBIDDEN", "Only the schedule owner can change it.");
  if (body.version !== undefined && Number(body.version) !== s.version) throw new QueryError(409, "VERSION_CONFLICT", "The schedule was changed by someone else. Refresh and try again.");
  const data = await validate(req, body, s);
  const active = body.active !== undefined ? !!body.active : s.active;
  const merged = { ...s, ...data };
  const updated = await prisma.analyticsReportSchedule.update({ where: { id: s.id }, data: { ...data, active, pausedReason: active ? null : String(body.pausedReason || "Paused by owner").slice(0, 200), nextRunAt: active ? nextRunAfter(merged) : null, version: { increment: 1 } } });
  await audit(req, active ? "analytics.schedule.updated" : "analytics.schedule.paused", s.publicId);
  const report = await prisma.analyticsReport.findUnique({ where: { id: s.reportId }, select: { publicId: true, name: true } });
  return serialize(updated, report);
}

export async function deleteSchedule(req, id) {
  const { s, mine } = await loadSchedule(req, id);
  if (!mine && !req.isSystemOwnerOverride) throw new QueryError(403, "FORBIDDEN", "Only the schedule owner can delete it.");
  await prisma.analyticsReportSchedule.update({ where: { id: s.id }, data: { active: false, pausedReason: "Deleted", nextRunAt: null } });
  await audit(req, "analytics.schedule.deleted", s.publicId);
  return { ok: true };
}

// Memberships behind the schedule's recipients (roles expand to active members).
async function recipientMemberships(s) {
  const ids = new Set(s.recipients.filter((r) => r.type === "Membership").map((r) => r.id));
  const roleKeys = s.recipients.filter((r) => r.type === "Role").map((r) => r.id);
  if (roleKeys.length) {
    const ms = await prisma.organizationMembership.findMany({ where: { organizationId: s.organizationId, status: "Active", roles: { some: { role: { key: { in: roleKeys } } } } }, select: { id: true }, take: 200 });
    for (const m of ms) ids.add(m.id);
  }
  return [...ids].slice(0, 200);
}

async function notifyOwner(s, eventType, extra) {
  await recordOutboxEvent(prisma, { aggregateType: "AnalyticsReportSchedule", aggregateId: s.id, eventType, payload: { organizationId: s.organizationId, scheduleId: s.publicId, notifyMembershipIds: [s.ownerMembershipId], ...extra } }).catch(() => {});
}

// Runs one due occurrence. Idempotent per occurrence key.
export async function runOccurrence(s, now = new Date()) {
  const scheduledFor = s.nextRunAt;
  const occurrenceKey = `${s.id}:${scheduledFor.toISOString()}`;
  let run;
  try { run = await prisma.analyticsScheduleRun.create({ data: { scheduleId: s.id, organizationId: s.organizationId, occurrenceKey, scheduledFor, status: "Running" } }); }
  catch (err) { if (err?.code === "P2002") return null; throw err; }
  const advance = async () => {
    const next = s.frequency === "once" ? null : nextRunAfter(s, new Date(Math.max(now.getTime(), scheduledFor.getTime())));
    const expired = s.expiresAt && next && next > s.expiresAt;
    await prisma.analyticsReportSchedule.update({ where: { id: s.id }, data: { lastRunAt: now, nextRunAt: expired ? null : next, ...(next === null || expired ? { active: false, pausedReason: s.frequency === "once" ? "Completed" : "Expired" } : {}) } });
  };
  const finish = async (status, deliveries = [], safeError = null) => {
    await prisma.analyticsScheduleRun.update({ where: { id: run.id }, data: { status, deliveries, safeError, completedAt: new Date() } });
    await advance();
    return status;
  };
  try {
    const report = await prisma.analyticsReport.findUnique({ where: { id: s.reportId } });
    const owner = await contextForMembership(s.ownerMembershipId);
    if (!report || report.archivedAt) { await prisma.analyticsReportSchedule.update({ where: { id: s.id }, data: { active: false, pausedReason: "Report archived or removed" } }); return finish("Skipped", [], "The report is archived or no longer exists."); }
    if (!owner || !hasGrant(owner, "analytics_reports", "schedule")) {
      await prisma.analyticsReportSchedule.update({ where: { id: s.id }, data: { active: false, pausedReason: "Owner lost scheduling access" } });
      return finish("Skipped", [], "The schedule owner no longer has permission to schedule reports.");
    }
    // Freshness policy.
    const v = await prisma.analyticsReportVersion.findUnique({ where: { reportId_version: { reportId: report.id, version: report.latestVersion } } });
    const sources = [...new Set(v.definition.metrics.flatMap((k) => METRIC_BY_KEY[k]?.sources || []))];
    const fresh = await freshness(s.organizationId);
    const stale = sources.filter((src) => !fresh[src] || now - new Date(fresh[src].lastLoadedAt) > 26 * 3_600_000);
    if (stale.length && s.stalePolicy === "skip") { await notifyOwner(s, "analytics.schedule.skipped_stale", { stale }); return finish("Skipped", [], `Data is stale for: ${stale.join(", ")}.`); }
    const deliveries = [];
    for (const membershipId of await recipientMemberships(s)) {
      const ctx = await contextForMembership(membershipId);
      if (!ctx || ctx.organizationId !== s.organizationId) { deliveries.push({ membershipId, status: "Skipped", reason: "Not an active member" }); continue; }
      const shares = await prisma.analyticsReportShare.findMany({ where: { reportId: report.id } });
      if (!canRead(ctx, report, shares)) { deliveries.push({ membershipId, status: "Skipped", reason: "No longer has access to the report" }); continue; }
      try {
        const job = await requestExport(ctx, { reportId: report.publicId, format: s.format, purpose: `Scheduled delivery ${s.publicId}` }, { scheduleRunId: run.id });
        deliveries.push({ membershipId, status: "Queued", exportId: job.publicId });
        if (s.deliveryMethod === "email_link" && ctx.user?.email) {
          const base = (process.env.APP_URL || process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
          await recordOutboxEvent(prisma, { aggregateType: "AnalyticsExport", aggregateId: job.id, eventType: "analytics.schedule.delivered", payload: {
            to: ctx.user.email, subject: `Report ready: ${report.name}`,
            text: `Your scheduled report "${report.name}" is ready. Sign in to download it (the link expires and requires your account): ${base}/reports/exports?export=${job.publicId}`,
            html: `<p>Your scheduled report <strong>${report.name.replace(/[<>&]/g, "")}</strong> is ready.</p><p><a href="${base}/reports/exports?export=${job.publicId}">Sign in to download it</a>. The link requires your account and expires.</p>`,
          } }).catch(() => {});
        }
      } catch (err) {
        deliveries.push({ membershipId, status: "Skipped", reason: err instanceof QueryError ? err.message : "Could not create the export" });
      }
    }
    const delivered = deliveries.filter((d) => d.status === "Queued").length;
    const status = !delivered ? "Failed" : delivered < deliveries.length || stale.length ? "Delivered with warnings" : "Delivered";
    if (status !== "Delivered" && s.failurePolicy === "notify_owner") await notifyOwner(s, "analytics.schedule.partial", { delivered, total: deliveries.length, stale });
    return finish(status, deliveries, !delivered ? "No recipient could receive this report." : stale.length ? `Delivered with stale data for: ${stale.join(", ")}.` : null);
  } catch (err) {
    console.error(`[analytics] schedule ${s.publicId} failed:`, err?.code || err?.name || "error");
    if (s.failurePolicy === "notify_owner") await notifyOwner(s, "analytics.schedule.failed", {});
    if (s.failurePolicy === "retry") {
      await prisma.analyticsScheduleRun.update({ where: { id: run.id }, data: { status: "Failed", safeError: "Will retry", completedAt: new Date() } });
      await prisma.analyticsScheduleRun.update({ where: { id: run.id }, data: { occurrenceKey: `${occurrenceKey}:failed:${run.id}` } });
      return "Failed";
    }
    return finish("Failed", [], "The scheduled delivery failed.");
  }
}

export async function runDueSchedules(now = new Date()) {
  const due = await prisma.analyticsReportSchedule.findMany({ where: { active: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: 20 });
  let ran = 0;
  for (const s of due) { if (await runOccurrence(s, now)) ran += 1; }
  return ran;
}

// Queues the next occurrence immediately (the worker delivers it within a
// minute). The occurrence key keeps it from running twice.
export async function runScheduleNow(req, id) {
  const { s, mine } = await loadSchedule(req, id);
  if (!mine && !req.isSystemOwnerOverride) throw new QueryError(403, "FORBIDDEN", "Only the schedule owner can run it now.");
  if (!s.active) throw new QueryError(409, "INACTIVE", "Resume the schedule before running it.");
  const updated = await prisma.analyticsReportSchedule.update({ where: { id: s.id }, data: { nextRunAt: new Date() } });
  await audit(req, "analytics.schedule.run_now", s.publicId);
  return { queued: true, nextRunAt: updated.nextRunAt };
}
