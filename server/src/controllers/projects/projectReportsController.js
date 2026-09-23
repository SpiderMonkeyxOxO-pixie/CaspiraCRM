// Backend Phase 5 — deterministic Project reports, workload and the
// calendar feed. The caller's project scope is applied in the query BEFORE
// anything is counted; rates show numerator and denominator and say
// "Insufficient data" below MIN_SAMPLE; time figures need
// project_time:view_team; missing capacity is reported, never invented.
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { projectScopeWhere } from "../../services/projects/projectAccess.js";
import { scopeIsOrganizationWide } from "../../services/projects/taskService.js";

export const MIN_SAMPLE = 5;
const DAY = 86400000;
const OPEN_TASK = { notIn: ["Completed", "Cancelled"] };
const FINISHED_PROJECT = ["Completed", "Cancelled"];

export function rate(numerator, denominator) {
  if (denominator < MIN_SAMPLE) return { numerator, denominator, rate: null, note: `Insufficient data (fewer than ${MIN_SAMPLE})` };
  return { numerator, denominator, rate: Math.round((numerator / denominator) * 1000) / 10 };
}
const countBy = (rows, key) => rows.reduce((acc, r) => { const k = (typeof key === "function" ? key(r) : r[key]) ?? "None"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});

// Schedule variance in days: current planned end minus the latest
// baseline's planned end (positive = later than baselined).
export function scheduleVariance(project, baseline) {
  const baselineEnd = baseline?.snapshot?.project?.dueDate;
  if (!baselineEnd || !project.dueDate) return null;
  return { baselineNumber: baseline.baselineNumber, days: Math.round((new Date(project.dueDate) - new Date(baselineEnd)) / DAY) };
}

export async function summary(req, res) {
  const now = new Date();
  const projectWhere = { organizationId: req.organizationId, archivedAt: null, ...projectScopeWhere(req) };
  const projects = await prisma.project.findMany({ where: projectWhere, select: { id: true, name: true, projectNumber: true, status: true, ownerMembershipId: true, team: true, dueDate: true, actualEndDate: true } });
  const ids = projects.map((p) => p.id);
  const inProjects = { projectId: { in: ids } };
  const [tasks, milestones, risks, issues, changes, deliverables, baselines] = await Promise.all([
    prisma.task.findMany({ where: { ...inProjects, archivedAt: null }, select: { statusCategory: true, status: true, dueDate: true, blocked: true, assigneeMembershipId: true, estimatedMinutes: true } }),
    prisma.milestone.findMany({ where: { ...inProjects, archivedAt: null }, select: { status: true, dueDate: true } }),
    prisma.projectRisk.findMany({ where: inProjects, select: { status: true, impactLevel: true } }),
    prisma.projectIssue.findMany({ where: inProjects, select: { status: true, targetResolutionDate: true } }),
    prisma.changeRequest.findMany({ where: inProjects, select: { status: true } }),
    prisma.deliverable.findMany({ where: { ...inProjects, archivedAt: null }, select: { status: true } }),
    prisma.projectBaseline.findMany({ where: inProjects, orderBy: { baselineNumber: "desc" } }),
  ]);
  const counted = tasks.filter((t) => t.statusCategory !== "Cancelled");
  const scheduled = milestones.filter((m) => m.status !== "Cancelled" && m.dueDate && m.dueDate <= now);

  // Time figures only for callers allowed to see the team's time.
  let effort = { restricted: true, note: "Needs project_time:view_team" };
  if (req.isSystemOwnerOverride || hasGrant(req, "project_time", "view_team")) {
    const time = await prisma.taskTimeEntry.groupBy({ by: ["status"], where: { ...inProjects, archivedAt: null }, _sum: { durationMinutes: true } });
    const sum = (s) => time.find((t) => t.status === s)?._sum.durationMinutes || 0;
    effort = {
      estimatedMinutes: counted.reduce((s, t) => s + (t.estimatedMinutes || 0), 0),
      loggedMinutes: sum("Submitted") + sum("Approved"),
      submittedMinutes: sum("Submitted"), approvedMinutes: sum("Approved"), draftMinutes: sum("Draft"), rejectedMinutes: sum("Rejected"),
    };
  }

  const latestBaseline = (projectId) => baselines.find((b) => b.projectId === projectId);
  res.json({
    summary: {
      asOf: now,
      definitions: {
        overdue: "Past its due date and not completed/achieved/cancelled.",
        taskCompletionRate: "Completed ÷ tasks that aren't cancelled (archived excluded).",
        milestoneAchievementRate: "Achieved ÷ milestones due by now that aren't cancelled.",
        scheduleVariance: "Current planned end minus the latest baseline's planned end, in days.",
      },
      activeProjects: projects.filter((p) => !FINISHED_PROJECT.includes(p.status)).length,
      projectsByStatus: countBy(projects, "status"),
      projectsByManager: countBy(projects, (p) => p.ownerMembershipId || "No manager"),
      projectsByTeam: countBy(projects, (p) => p.team || "No team"),
      overdueProjects: projects.filter((p) => !FINISHED_PROJECT.includes(p.status) && p.dueDate && p.dueDate < now).length,
      overdueMilestones: milestones.filter((m) => !["Achieved", "Cancelled"].includes(m.status) && m.dueDate && m.dueDate < now).length,
      overdueTasks: tasks.filter((t) => !["Completed", "Cancelled"].includes(t.statusCategory) && t.dueDate && t.dueDate < now).length,
      blockedTasks: tasks.filter((t) => t.blocked || t.statusCategory === "Blocked").length,
      unassignedTasks: tasks.filter((t) => !t.assigneeMembershipId && !["Completed", "Cancelled"].includes(t.statusCategory)).length,
      tasksByStatus: countBy(tasks, "status"),
      taskCompletionRate: rate(counted.filter((t) => t.statusCategory === "Completed").length, counted.length),
      milestoneAchievementRate: rate(scheduled.filter((m) => m.status === "Achieved").length, scheduled.length),
      effort,
      openRisks: risks.filter((r) => !["Closed", "Accepted"].includes(r.status)).length,
      highImpactRisks: risks.filter((r) => !["Closed", "Accepted"].includes(r.status) && ["High", "Very High"].includes(r.impactLevel)).length,
      openIssues: issues.filter((i) => !["Resolved", "Closed"].includes(i.status)).length,
      overdueIssues: issues.filter((i) => !["Resolved", "Closed"].includes(i.status) && i.targetResolutionDate && i.targetResolutionDate < now).length,
      pendingChangeRequests: changes.filter((c) => ["Submitted", "Under Review"].includes(c.status)).length,
      pendingDeliverableReviews: deliverables.filter((d) => ["Ready for Review", "Ready for Customer Review"].includes(d.status)).length,
      scheduleVariance: projects.map((p) => ({ projectId: p.id, projectNumber: p.projectNumber, variance: scheduleVariance(p, latestBaseline(p.id)) })).filter((v) => v.variance),
    },
  });
}

// Workload per member across visible projects: allocation and open work.
// There's no capacity model yet, so utilization is not calculated — it's
// reported as "Capacity not configured". Others' workload only for
// organization-wide viewers; everyone else sees their own line.
export async function workload(req, res) {
  const projectWhere = { organizationId: req.organizationId, archivedAt: null, status: { notIn: FINISHED_PROJECT }, ...projectScopeWhere(req) };
  const projects = await prisma.project.findMany({ where: projectWhere, select: { id: true } });
  const ids = projects.map((p) => p.id);
  const seeAll = scopeIsOrganizationWide(req, "projects") && hasGrant(req, "project_reports", "view");
  const memberFilter = seeAll ? {} : { membershipId: req.membership?.id || "__none__" };
  const [members, openTasks] = await Promise.all([
    prisma.projectMember.findMany({ where: { projectId: { in: ids }, active: true, ...memberFilter } }),
    prisma.taskAssignee.findMany({ where: { removedAt: null, task: { projectId: { in: ids }, archivedAt: null, statusCategory: OPEN_TASK }, ...memberFilter }, include: { task: { select: { estimatedMinutes: true, remainingMinutes: true } } } }),
  ]);
  const byMember = new Map();
  const line = (id) => byMember.get(id) || byMember.set(id, { membershipId: id, projects: 0, allocationPercent: 0, openTasks: 0, remainingMinutes: 0 }).get(id);
  for (const m of members) { const l = line(m.membershipId); l.projects += 1; l.allocationPercent += m.allocationPercent || 0; }
  for (const a of openTasks) { const l = line(a.membershipId); l.openTasks += 1; l.remainingMinutes += a.task.remainingMinutes ?? a.task.estimatedMinutes ?? 0; }
  res.json({
    workload: [...byMember.values()].map((l) => ({ ...l, capacity: "Capacity not configured", utilization: null })),
    note: "Utilization isn't calculated because no working-capacity data is configured.",
  });
}

// Calendar feed: authorized project, phase, milestone, task and deliverable
// dates, each pointing at its source record (no copies; edits go through
// the project/task APIs). No external calendar is connected.
export async function calendar(req, res) {
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * DAY);
  const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 90 * DAY);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return res.status(400).json({ code: "PROJECTS_VALIDATION_FAILED", message: "from and to must be valid dates, from before to." });
  const inRange = { gte: from, lte: to };
  const projects = await prisma.project.findMany({ where: { organizationId: req.organizationId, archivedAt: null, ...projectScopeWhere(req) }, select: { id: true, name: true, startDate: true, dueDate: true } });
  const ids = projects.map((p) => p.id);
  const [phases, milestones, tasks, deliverables] = await Promise.all([
    prisma.projectPhase.findMany({ where: { projectId: { in: ids }, archivedAt: null, OR: [{ plannedStartDate: inRange }, { plannedEndDate: inRange }] } }),
    prisma.milestone.findMany({ where: { projectId: { in: ids }, archivedAt: null, dueDate: inRange } }),
    prisma.task.findMany({ where: { projectId: { in: ids }, archivedAt: null, dueDate: inRange }, select: { id: true, projectId: true, title: true, taskNumber: true, dueDate: true, statusCategory: true } }),
    prisma.deliverable.findMany({ where: { projectId: { in: ids }, archivedAt: null, dueDate: inRange }, select: { id: true, projectId: true, name: true, dueDate: true, status: true } }),
  ]);
  const within = (d) => d && d >= from && d <= to;
  const items = [
    ...projects.flatMap((p) => [within(p.startDate) && { sourceType: "Project", sourceId: p.id, projectId: p.id, title: `${p.name} starts`, date: p.startDate }, within(p.dueDate) && { sourceType: "Project", sourceId: p.id, projectId: p.id, title: `${p.name} due`, date: p.dueDate }].filter(Boolean)),
    ...phases.flatMap((ph) => [within(ph.plannedStartDate) && { sourceType: "Phase", sourceId: ph.id, projectId: ph.projectId, title: `${ph.name} starts`, date: ph.plannedStartDate }, within(ph.plannedEndDate) && { sourceType: "Phase", sourceId: ph.id, projectId: ph.projectId, title: `${ph.name} ends`, date: ph.plannedEndDate }].filter(Boolean)),
    ...milestones.map((m) => ({ sourceType: "Milestone", sourceId: m.id, projectId: m.projectId, title: m.name, date: m.dueDate, status: m.status })),
    ...tasks.map((t) => ({ sourceType: "Task", sourceId: t.id, projectId: t.projectId, title: `${t.taskNumber || ""} ${t.title}`.trim(), date: t.dueDate, status: t.statusCategory })),
    ...deliverables.map((d) => ({ sourceType: "Deliverable", sourceId: d.id, projectId: d.projectId, title: d.name, date: d.dueDate, status: d.status })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));
  res.json({ from, to, items });
}
