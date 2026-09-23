// Backend Phase 5 — time entries and work timers.
//
// Time entries (minutes): Draft → Submitted → Approved | Rejected.
//   - Your own time only; duration 1–1440 minutes, or a start/end range on
//     one work date. Overlapping ranges, and more than 24 h in a day, are
//     refused.
//   - Drafts (and rejected entries) can be edited; a submitted entry must
//     be withdrawn first; an approved entry is never edited — a correction
//     is a separate, linked entry with a reason that goes through approval.
//   - Approving/rejecting needs project_time:approve AND managing the
//     project; nobody approves their own time; rejection needs a reason.
//   - Approval creates no payroll, billing or accounting entries.
// Timers use the SERVER's clock only (client times are ignored), one
// active timer per member, and stopping one creates a Draft entry the
// member must confirm. Nothing else is collected — no screenshots,
// activity or application tracking.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { sanitizeText } from "../../services/support/supportCommon.js";
import { MAX_MINUTES_PER_ENTRY } from "../../services/projects/projectRulesService.js";
import { projectScopeWhere, managesProject, projectActivity } from "../../services/projects/projectAccess.js";
import { refreshLoggedHours } from "../../services/projects/taskService.js";

const DAY_MS = 86400000;
const who = (req) => req.membership?.id || null;
const text = (v, max) => (typeof v === "string" && v.trim() ? sanitizeText(v, { max }) : null);
const invalid = (res, message) => res.status(400).json({ code: "PROJECTS_VALIDATION_FAILED", message });
const notFound = (res, what) => res.status(404).json({ code: "PROJECTS_RECORD_NOT_FOUND", message: `${what} not found.` });
const forbidden = (res, message) => res.status(403).json({ code: "RBAC_FORBIDDEN", message });
const badTransition = (res, message) => res.status(400).json({ code: "PROJECTS_INVALID_TRANSITION", message });
const conflict = (res) => res.status(409).json({ code: "PROJECTS_VERSION_CONFLICT", message: "This time entry was updated by someone else. Refresh and try again." });

async function audit(req, action, entryId, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: who(req), organizationId: req.organizationId, action, targetType: "TimeEntry", targetId: entryId, result: "Success", ...extra });
}

const dayStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// Visibility: your own entries; everyone's in visible projects with view_team.
function entryScope(req) {
  const base = { organizationId: req.organizationId, archivedAt: null, project: projectScopeWhere(req) };
  if (req.isSystemOwnerOverride || hasGrant(req, "project_time", "view_team")) return base;
  return { ...base, authorMembershipId: who(req) };
}

async function loadEntry(req, res) {
  const entry = await prisma.taskTimeEntry.findFirst({ where: { id: req.params.entryId, ...entryScope(req) }, include: { project: { include: { members: true } } } });
  if (!entry) notFound(res, "Time entry");
  return entry;
}

// Validates the time fields; returns { data } or { error }.
function timeFields(body) {
  const out = {};
  const workDate = body.workDate ? new Date(body.workDate) : null;
  if (!workDate || Number.isNaN(workDate.getTime())) return { error: "workDate is required." };
  if (workDate.getTime() > Date.now() + DAY_MS) return { error: "Time can't be logged for a future date." };
  out.workDate = dayStart(workDate);
  if (body.startTime || body.endTime) {
    const start = new Date(body.startTime);
    const end = new Date(body.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { error: "startTime and endTime must both be valid times." };
    if (end <= start) return { error: "endTime must be after startTime." };
    out.startTime = start;
    out.endTime = end;
    out.durationMinutes = Math.round((end - start) / 60000);
  } else {
    out.durationMinutes = Number(body.durationMinutes ?? (body.hours !== undefined ? Math.round(Number(body.hours) * 60) : NaN));
  }
  if (!Number.isInteger(out.durationMinutes) || out.durationMinutes < 1 || out.durationMinutes > MAX_MINUTES_PER_ENTRY) return { error: `Duration must be 1 to ${MAX_MINUTES_PER_ENTRY} minutes.` };
  out.hours = out.durationMinutes / 60;
  if ("description" in body || "note" in body) out.note = text(body.description ?? body.note, 2000);
  if ("billable" in body) out.billable = Boolean(body.billable);
  return { data: out };
}

// Overlapping ranges and more than a day's minutes on one date are refused.
async function overlapError(organizationId, membershipId, data, excludeId = null) {
  const others = await prisma.taskTimeEntry.findMany({
    where: { organizationId, authorMembershipId: membershipId, workDate: data.workDate, archivedAt: null, status: { not: "Rejected" }, ...(excludeId && { id: { not: excludeId } }) },
    select: { id: true, startTime: true, endTime: true, durationMinutes: true },
  });
  if (data.startTime) {
    const hit = others.find((o) => o.startTime && o.endTime && o.startTime < data.endTime && o.endTime > data.startTime);
    if (hit) return `This overlaps another time entry (${hit.startTime.toISOString()}–${hit.endTime.toISOString()}).`;
  }
  const total = others.reduce((s, o) => s + Math.max(0, o.durationMinutes), 0) + data.durationMinutes;
  if (total > MAX_MINUTES_PER_ENTRY) return `That would record ${Math.round(total / 6) / 10} hours on one day.`;
  return null;
}

async function projectAndTask(req, projectId, taskId) {
  const project = projectId && (await prisma.project.findFirst({ where: { id: projectId, organizationId: req.organizationId, ...projectScopeWhere(req) }, include: { members: true } }));
  if (!project) return { error: "projectId must be a project you can see." };
  if (project.archivedAt || project.status === "Cancelled") return { error: "Time can't be logged on an archived or cancelled project." };
  if (taskId) {
    const task = await prisma.task.findFirst({ where: { id: taskId, projectId: project.id } });
    if (!task) return { error: "taskId must be a task of that project." };
  }
  return { project };
}

// ---------------------------------------------------------------- Entries

export async function listEntries(req, res) {
  const q = req.query;
  const where = entryScope(req);
  for (const f of ["projectId", "taskId", "status"]) if (q[f]) where[f] = q[f];
  if (q.membershipId) where.authorMembershipId = q.membershipId;
  if (q.from || q.to) where.workDate = { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lte: new Date(q.to) }) };
  const entries = await prisma.taskTimeEntry.findMany({ where, orderBy: [{ workDate: "desc" }, { createdAt: "desc" }], take: 500 });
  res.json({ entries: toApi(entries) });
}

export async function createEntry(req, res) {
  const { project, error: refError } = await projectAndTask(req, req.body.projectId, req.body.taskId);
  if (refError) return invalid(res, refError);
  const { data, error } = timeFields(req.body);
  if (error) return invalid(res, error);
  const overlap = await overlapError(req.organizationId, who(req), data);
  if (overlap) return invalid(res, overlap);
  const entry = await prisma.taskTimeEntry.create({
    data: { ...data, organizationId: req.organizationId, projectId: project.id, taskId: req.body.taskId || null, authorMembershipId: who(req), status: "Draft", source: "Manual" },
  });
  await audit(req, "projects.time.created", entry.id);
  res.status(201).json({ entry: toApi(entry) });
}

// Only your own Draft or Rejected entry; editing a rejected one returns it to Draft.
export async function updateEntry(req, res) {
  const entry = await loadEntry(req, res);
  if (!entry) return;
  if (entry.authorMembershipId !== who(req)) return forbidden(res, "You can only edit your own time.");
  if (entry.status === "Approved") return badTransition(res, "Approved time can't be edited — use a correction.");
  if (entry.status === "Submitted") return badTransition(res, "Withdraw the entry before changing it.");
  if (req.body.version !== undefined && Number(req.body.version) !== entry.version) return conflict(res);
  const { data, error } = timeFields({ workDate: entry.workDate, durationMinutes: entry.durationMinutes, ...(entry.startTime && { startTime: entry.startTime, endTime: entry.endTime }), ...req.body });
  if (error) return invalid(res, error);
  const overlap = await overlapError(req.organizationId, who(req), data, entry.id);
  if (overlap) return invalid(res, overlap);
  const updated = await prisma.taskTimeEntry.update({ where: { id: entry.id }, data: { ...data, status: "Draft", rejectionReason: null, version: { increment: 1 } } });
  await audit(req, "projects.time.updated", entry.id);
  res.json({ entry: toApi(updated) });
}

async function setStatus(req, res, entry, data, eventType, auditAction, extra = {}) {
  const changed = await prisma.$transaction(async (tx) => {
    // Version-checked: two simultaneous decisions can't both apply.
    const r = await tx.taskTimeEntry.updateMany({ where: { id: entry.id, version: entry.version, status: entry.status }, data: { ...data, version: { increment: 1 } } });
    if (!r.count) return false;
    await refreshLoggedHours(tx, entry.taskId);
    await projectActivity(tx, { organizationId: req.organizationId, projectId: entry.projectId, taskId: entry.taskId, eventType, actorMembershipId: who(req), fromValue: entry.status, toValue: data.status, reason: extra.reason, snapshot: { entryId: entry.id, minutes: entry.durationMinutes } });
    return true;
  });
  if (!changed) return conflict(res);
  await audit(req, auditAction, entry.id, extra);
  res.json({ entry: toApi(await prisma.taskTimeEntry.findUnique({ where: { id: entry.id } })) });
}

export async function submitEntry(req, res) {
  const entry = await loadEntry(req, res);
  if (!entry) return;
  if (entry.authorMembershipId !== who(req)) return forbidden(res, "You can only submit your own time.");
  if (entry.status !== "Draft") return badTransition(res, `A ${entry.status} entry can't be submitted.`);
  return setStatus(req, res, entry, { status: "Submitted", submittedAt: new Date() }, "Time Submitted", "projects.time.submitted");
}

export async function withdrawEntry(req, res) {
  const entry = await loadEntry(req, res);
  if (!entry) return;
  if (entry.authorMembershipId !== who(req)) return forbidden(res, "You can only withdraw your own time.");
  if (entry.status !== "Submitted") return badTransition(res, "Only a submitted entry can be withdrawn.");
  return setStatus(req, res, entry, { status: "Draft", submittedAt: null }, "Time Withdrawn", "projects.time.withdrawn");
}

function approverCheck(req, res, entry) {
  if (entry.status !== "Submitted") { badTransition(res, "Only a submitted entry can be approved or rejected."); return false; }
  if (entry.authorMembershipId === who(req)) { res.status(403).json({ code: "PROJECTS_SEPARATION_OF_DUTIES", message: "You can't approve or reject your own time." }); return false; }
  if (!managesProject(req, entry.project)) { forbidden(res, "Only the project's managers can decide on its time."); return false; }
  return true;
}

export async function approveEntry(req, res) {
  const entry = await loadEntry(req, res);
  if (!entry) return;
  if (req.body.version !== undefined && Number(req.body.version) !== entry.version) return conflict(res);
  if (!approverCheck(req, res, entry)) return;
  return setStatus(req, res, entry, { status: "Approved", approvedAt: new Date(), approvedByMembershipId: who(req) }, "Time Approved", "projects.time.approved");
}

export async function rejectEntry(req, res) {
  const reason = text(req.body.reason, 1000);
  if (!reason) return invalid(res, "A reason is required to reject time.");
  const entry = await loadEntry(req, res);
  if (!entry) return;
  if (req.body.version !== undefined && Number(req.body.version) !== entry.version) return conflict(res);
  if (!approverCheck(req, res, entry)) return;
  return setStatus(req, res, entry, { status: "Rejected", rejectedAt: new Date(), rejectedByMembershipId: who(req), rejectionReason: reason }, "Time Rejected", "projects.time.rejected", { reason });
}

// POST /correct { adjustmentMinutes, reason } — adjusts APPROVED time with a
// separate, linked entry (which itself goes through approval). The original
// stays unchanged.
export async function correctEntry(req, res) {
  const reason = text(req.body.reason, 1000);
  if (!reason) return invalid(res, "A reason is required for a correction.");
  const adjustment = Number(req.body.adjustmentMinutes);
  if (!Number.isInteger(adjustment) || adjustment === 0 || Math.abs(adjustment) > MAX_MINUTES_PER_ENTRY) return invalid(res, "adjustmentMinutes must be a non-zero whole number of minutes (negative to reduce).");
  const entry = await loadEntry(req, res);
  if (!entry) return;
  if (entry.status !== "Approved") return badTransition(res, "Only approved time is corrected — edit drafts directly.");
  if (entry.durationMinutes + adjustment < 0) return invalid(res, "A correction can't make the time negative.");
  if (entry.authorMembershipId !== who(req) && !managesProject(req, entry.project)) return forbidden(res, "Only the person or the project's managers can correct this time.");
  const correction = await prisma.$transaction(async (tx) => {
    const c = await tx.taskTimeEntry.create({
      data: {
        organizationId: req.organizationId, projectId: entry.projectId, taskId: entry.taskId, authorMembershipId: entry.authorMembershipId, workDate: entry.workDate,
        durationMinutes: adjustment, hours: adjustment / 60, note: `Correction: ${reason}`, status: "Submitted", submittedAt: new Date(), source: "Correction",
        correctsEntryId: entry.id, correctionReason: reason,
      },
    });
    await refreshLoggedHours(tx, entry.taskId);
    await projectActivity(tx, { organizationId: req.organizationId, projectId: entry.projectId, taskId: entry.taskId, eventType: "Time Corrected", actorMembershipId: who(req), reason, snapshot: { entryId: entry.id, adjustmentMinutes: adjustment } });
    return c;
  });
  await audit(req, "projects.time.corrected", entry.id, { reason, after: { correctionId: correction.id, adjustmentMinutes: adjustment } });
  res.status(201).json({ entry: toApi(correction) });
}

// ---------------------------------------------------------------- Timers

const ACTIVE = ["Running", "Paused"];
const elapsedSeconds = (timer, now = new Date()) => timer.accumulatedSeconds + (timer.state === "Running" && timer.lastResumedAt ? Math.floor((now - timer.lastResumedAt) / 1000) : 0);
const serializeTimer = (timer) => timer && { ...toApi(timer), elapsedSeconds: elapsedSeconds(timer) };

async function loadTimer(req, res) {
  const timer = await prisma.workTimer.findFirst({ where: { id: req.params.timerId, organizationId: req.organizationId, membershipId: who(req) } });
  if (!timer) notFound(res, "Timer");
  return timer;
}

export async function activeTimer(req, res) {
  const timer = await prisma.workTimer.findFirst({ where: { organizationId: req.organizationId, membershipId: who(req), state: { in: ACTIVE } } });
  res.json({ timer: serializeTimer(timer) });
}

// One active timer per member. Starting the same project/task again returns
// the running timer (idempotent); a different one is refused.
export async function startTimer(req, res) {
  const { project, error } = await projectAndTask(req, req.body.projectId, req.body.taskId);
  if (error) return invalid(res, error);
  const taskId = req.body.taskId || null;
  const active = await prisma.workTimer.findFirst({ where: { organizationId: req.organizationId, membershipId: who(req), state: { in: ACTIVE } } });
  if (active) {
    if (active.projectId === project.id && active.taskId === taskId) return res.json({ timer: serializeTimer(active) });
    return res.status(409).json({ code: "PROJECTS_TIMER_ACTIVE", message: "You already have a timer running — stop it first.", timer: serializeTimer(active) });
  }
  const now = new Date();
  const timer = await prisma.workTimer.create({ data: { organizationId: req.organizationId, membershipId: who(req), projectId: project.id, taskId, state: "Running", startedAt: now, lastResumedAt: now } });
  await audit(req, "projects.timer.started", timer.id);
  res.status(201).json({ timer: serializeTimer(timer) });
}

export async function pauseTimer(req, res) {
  const timer = await loadTimer(req, res);
  if (!timer) return;
  if (timer.state !== "Running") return badTransition(res, "Only a running timer can be paused.");
  const now = new Date();
  const updated = await prisma.workTimer.update({ where: { id: timer.id }, data: { state: "Paused", pausedAt: now, accumulatedSeconds: elapsedSeconds(timer, now), lastResumedAt: null } });
  await audit(req, "projects.timer.paused", timer.id);
  res.json({ timer: serializeTimer(updated) });
}

export async function resumeTimer(req, res) {
  const timer = await loadTimer(req, res);
  if (!timer) return;
  if (timer.state !== "Paused") return badTransition(res, "Only a paused timer can be resumed.");
  const updated = await prisma.workTimer.update({ where: { id: timer.id }, data: { state: "Running", pausedAt: null, lastResumedAt: new Date() } });
  await audit(req, "projects.timer.resumed", timer.id);
  res.json({ timer: serializeTimer(updated) });
}

// Stopping creates a DRAFT entry (the member reviews and submits it).
export async function stopTimer(req, res) {
  const timer = await loadTimer(req, res);
  if (!timer) return;
  if (!ACTIVE.includes(timer.state)) return badTransition(res, "This timer isn't running.");
  const now = new Date();
  const seconds = elapsedSeconds(timer, now);
  const minutes = Math.min(MAX_MINUTES_PER_ENTRY, Math.max(1, Math.ceil(seconds / 60)));
  const result = await prisma.$transaction(async (tx) => {
    const entry = await tx.taskTimeEntry.create({
      data: {
        organizationId: req.organizationId, projectId: timer.projectId, taskId: timer.taskId, authorMembershipId: who(req), workDate: dayStart(timer.startedAt),
        durationMinutes: minutes, hours: minutes / 60, status: "Draft", source: "Timer", note: text(req.body.description, 2000),
      },
    });
    const stopped = await tx.workTimer.update({ where: { id: timer.id }, data: { state: "Stopped", stoppedAt: now, accumulatedSeconds: seconds, lastResumedAt: null, timeEntryId: entry.id } });
    return { entry, stopped };
  });
  await audit(req, "projects.timer.stopped", timer.id, { after: { entryId: result.entry.id, minutes } });
  res.json({ timer: serializeTimer(result.stopped), entry: toApi(result.entry), note: seconds > MAX_MINUTES_PER_ENTRY * 60 ? "The timer ran longer than 24 hours; the draft is capped at 24 hours — adjust it before submitting." : "Review the draft entry and submit it." });
}

export async function discardTimer(req, res) {
  const timer = await loadTimer(req, res);
  if (!timer) return;
  if (!ACTIVE.includes(timer.state)) return badTransition(res, "This timer isn't running.");
  const updated = await prisma.workTimer.update({ where: { id: timer.id }, data: { state: "Discarded", stoppedAt: new Date(), lastResumedAt: null } });
  await audit(req, "projects.timer.discarded", timer.id);
  res.json({ timer: serializeTimer(updated) });
}
