// Backend Phase 5 — Customer Portal projects (/api/v1/portal/projects).
//
// A portal customer sees only projects of THEIR company that are marked
// customer-visible, through DEDICATED serializers: planned dates, status,
// the customer summary and progress; customer-visible milestones,
// deliverables and comments. Never: internal tasks, time, estimates,
// workload, budget or cost, internal comments, risks, issues, change
// requests, members, audit data. Deliverable acceptance here is a recorded
// decision — not an electronic signature.
import prisma from "../../lib/prisma.js";
import { sanitizeText } from "../../services/support/supportCommon.js";
import { computeProgress } from "../../services/projects/progressService.js";
import { projectActivity } from "../../services/projects/projectAccess.js";

const notFound = (res, what) => res.status(404).json({ code: "PROJECTS_RECORD_NOT_FOUND", message: `${what} not found.` });

export function portalProjectWhere(account) {
  if (!account.companyId) return { id: "__none__" };
  return { organizationId: account.organizationId, companyId: account.companyId, customerVisible: true, archivedAt: null };
}

export function serializePortalProject(p, tasks = [], milestones = []) {
  const progress = computeProgress(p, tasks, milestones);
  return {
    _id: p.id, projectNumber: p.projectNumber, name: p.name, status: p.status, summary: p.customerSummary,
    plannedStart: p.startDate, plannedEnd: p.dueDate, progress: { percent: progress.progress, basis: progress.basis },
  };
}

const portalMilestone = (m) => ({ _id: m.id, name: m.name, dueDate: m.dueDate, status: m.status, completedAt: m.completedAt });
const portalDeliverable = (d) => ({
  _id: d.id, deliverableNumber: d.deliverableNumber, name: d.name, description: d.description, dueDate: d.dueDate, acceptanceCriteria: d.acceptanceCriteria,
  status: d.status, awaitingYourReview: d.status === "Ready for Customer Review", acceptedAt: d.acceptedAt,
  // Only decisions shared with the customer — never internal review notes.
  decisions: (d.decisions || []).filter((x) => x.customerVisible).map((x) => ({ decision: x.decision, comment: x.comment, at: x.createdAt, byYou: x.actorType === "Customer" })),
});

async function loadPortalProject(req, res) {
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, ...portalProjectWhere(req.portal) } });
  if (!project) notFound(res, "Project");
  return project;
}

export async function listProjects(req, res) {
  const projects = await prisma.project.findMany({ where: portalProjectWhere(req.portal), orderBy: { updatedAt: "desc" }, take: 100 });
  const ids = projects.map((p) => p.id);
  const [tasks, milestones] = await Promise.all([
    prisma.task.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, statusCategory: true, weight: true, archivedAt: true } }),
    prisma.milestone.findMany({ where: { projectId: { in: ids }, archivedAt: null } }),
  ]);
  res.json({ projects: projects.map((p) => serializePortalProject(p, tasks.filter((t) => t.projectId === p.id), milestones.filter((m) => m.projectId === p.id))) });
}

export async function getProject(req, res) {
  const project = await loadPortalProject(req, res);
  if (!project) return;
  const [tasks, milestones] = await Promise.all([
    prisma.task.findMany({ where: { projectId: project.id }, select: { statusCategory: true, weight: true, archivedAt: true } }),
    prisma.milestone.findMany({ where: { projectId: project.id, archivedAt: null } }),
  ]);
  res.json({ project: serializePortalProject(project, tasks, milestones) });
}

export async function listMilestones(req, res) {
  const project = await loadPortalProject(req, res);
  if (!project) return;
  const milestones = await prisma.milestone.findMany({ where: { projectId: project.id, customerVisible: true, archivedAt: null }, orderBy: { dueDate: "asc" } });
  res.json({ milestones: milestones.map(portalMilestone) });
}

export async function listDeliverables(req, res) {
  const project = await loadPortalProject(req, res);
  if (!project) return;
  const deliverables = await prisma.deliverable.findMany({ where: { projectId: project.id, customerVisible: true, archivedAt: null, status: { notIn: ["Draft", "Cancelled"] } }, include: { decisions: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } });
  res.json({ deliverables: deliverables.map(portalDeliverable) });
}

async function customerDecision(req, res, { to, decision, commentRequired }) {
  const project = await loadPortalProject(req, res);
  if (!project) return;
  const d = await prisma.deliverable.findFirst({ where: { id: req.params.deliverableId, projectId: project.id, customerVisible: true, archivedAt: null } });
  if (!d) return notFound(res, "Deliverable");
  if (d.status !== "Ready for Customer Review") return res.status(400).json({ code: "PROJECTS_INVALID_TRANSITION", message: "This deliverable isn't waiting for your review." });
  const comment = sanitizeText(req.body.comment || "", { max: 2000 }) || null;
  if (commentRequired && !comment) return res.status(400).json({ code: "PROJECTS_VALIDATION_FAILED", message: "Please describe the changes you need." });
  const now = new Date();
  const changed = await prisma.$transaction(async (tx) => {
    const r = await tx.deliverable.updateMany({ where: { id: d.id, status: "Ready for Customer Review", version: d.version }, data: { status: to, reviewedAt: now, ...(to === "Accepted" && { acceptedAt: now }), version: { increment: 1 } } });
    if (!r.count) return false;
    await tx.deliverableDecision.create({ data: { organizationId: project.organizationId, deliverableId: d.id, versionNumber: d.currentVersionNumber, decision, comment, actorType: "Customer", actorPortalAccountId: req.portal.id, customerVisible: true } });
    await projectActivity(tx, { organizationId: project.organizationId, projectId: project.id, eventType: `Customer ${decision}`, actorType: "Customer", actorPortalAccountId: req.portal.id, fromValue: d.status, toValue: to, reason: comment, snapshot: { deliverableId: d.id, versionNumber: d.currentVersionNumber }, customerVisible: true });
    return true;
  });
  if (!changed) return res.status(409).json({ code: "PROJECTS_VERSION_CONFLICT", message: "This deliverable changed — refresh and try again." });
  const fresh = await prisma.deliverable.findUnique({ where: { id: d.id }, include: { decisions: { orderBy: { createdAt: "asc" } } } });
  res.json({ deliverable: portalDeliverable(fresh) });
}

export const acceptDeliverable = (req, res) => customerDecision(req, res, { to: "Accepted", decision: "Accepted", commentRequired: false });
export const requestDeliverableChanges = (req, res) => customerDecision(req, res, { to: "Changes Requested", decision: "Changes Requested", commentRequired: true });

export async function listComments(req, res) {
  const project = await loadPortalProject(req, res);
  if (!project) return;
  const comments = await prisma.taskComment.findMany({ where: { projectId: project.id, visibility: "Customer Visible", archivedAt: null }, orderBy: { createdAt: "asc" }, take: 500 });
  res.json({ comments: comments.map((c) => ({ _id: c.id, body: c.body, createdAt: c.createdAt, from: c.authorPortalAccountId ? (c.authorPortalAccountId === req.portal.id ? "You" : "Customer") : "Project team" })) });
}

export async function addComment(req, res) {
  const project = await loadPortalProject(req, res);
  if (!project) return;
  const body = sanitizeText(req.body.body || req.body.message || "", { max: 5000 });
  if (!body) return res.status(400).json({ code: "PROJECTS_VALIDATION_FAILED", message: "A comment can't be empty." });
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.taskComment.create({ data: { organizationId: project.organizationId, projectId: project.id, body, visibility: "Customer Visible", authorPortalAccountId: req.portal.id } });
    await projectActivity(tx, { organizationId: project.organizationId, projectId: project.id, eventType: "Customer Comment", actorType: "Customer", actorPortalAccountId: req.portal.id, customerVisible: true, snapshot: { commentId: c.id } });
    return c;
  });
  res.status(201).json({ comment: { _id: comment.id, body: comment.body, createdAt: comment.createdAt, from: "You" } });
}
