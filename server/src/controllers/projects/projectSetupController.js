// Backend Phase 5 — portfolios, project templates (versioned; projects are
// created from them explicitly, with a preview and an idempotency key) and
// project members.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { hasGrant } from "../../utils/grants.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { nextDocumentNumber } from "../../services/sales/documentNumberService.js";
import { sanitizeText } from "../../services/support/supportCommon.js";
import { PROJECT_ROLES } from "../../services/projects/projectRulesService.js";
import { projectScopeWhere, managesProject, projectActivity } from "../../services/projects/projectAccess.js";
import { ensureDefaultBoard } from "../../services/projects/boardService.js";
import { validateTemplateContent, templatePreview, offsetDate } from "../../services/projects/templateService.js";
import { computeProgress } from "../../services/projects/progressService.js";

const who = (req) => req.membership?.id || null;
const text = (v, max) => (typeof v === "string" && v.trim() ? sanitizeText(v, { max }) : null);
const invalid = (res, message) => res.status(400).json({ code: "PROJECTS_VALIDATION_FAILED", message });
const notFound = (res, what) => res.status(404).json({ code: "PROJECTS_RECORD_NOT_FOUND", message: `${what} not found.` });
const forbidden = (res, message) => res.status(403).json({ code: "RBAC_FORBIDDEN", message });
const conflict = (res, what) => res.status(409).json({ code: "PROJECTS_VERSION_CONFLICT", message: `This ${what} was updated by someone else. Refresh and try again.` });

async function audit(req, action, targetType, targetId, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: who(req), organizationId: req.organizationId, action, targetType, targetId, result: "Success", ...extra });
}

// ---------------------------------------------------------------- Portfolios

// Totals only count projects the caller can see.
async function portfolioWithProjects(req, portfolio) {
  const projects = await prisma.project.findMany({
    where: { organizationId: req.organizationId, portfolioId: portfolio.id, archivedAt: null, ...projectScopeWhere(req) },
    select: { id: true, name: true, projectNumber: true, status: true, dueDate: true, progressMode: true, manualProgress: true, manualProgressReason: true },
  });
  const tasks = await prisma.task.findMany({ where: { projectId: { in: projects.map((p) => p.id) } }, select: { projectId: true, statusCategory: true, weight: true, archivedAt: true } });
  return {
    ...toApi(portfolio),
    projects: projects.map((p) => ({ ...toApi(p), progress: computeProgress(p, tasks.filter((t) => t.projectId === p.id)) })),
    totals: { projects: projects.length, byStatus: projects.reduce((a, p) => ({ ...a, [p.status]: (a[p.status] || 0) + 1 }), {}) },
  };
}

export async function listPortfolios(req, res) {
  const portfolios = await prisma.projectPortfolio.findMany({ where: { organizationId: req.organizationId, ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }) }, orderBy: { name: "asc" } });
  res.json({ portfolios: await Promise.all(portfolios.map((p) => portfolioWithProjects(req, p))) });
}

export async function getPortfolio(req, res) {
  const portfolio = await prisma.projectPortfolio.findFirst({ where: { id: req.params.portfolioId, organizationId: req.organizationId } });
  if (!portfolio) return notFound(res, "Portfolio");
  res.json({ portfolio: await portfolioWithProjects(req, portfolio) });
}

async function portfolioFields(req, existing) {
  const b = req.body;
  const out = {};
  if (!existing || "name" in b) { out.name = text(b.name, 120); if (!out.name) return { error: "name is required." }; }
  if ("description" in b) out.description = text(b.description, 2000);
  if ("department" in b) out.department = text(b.department, 120);
  if ("status" in b) { if (!["Active", "On Hold", "Closed"].includes(b.status)) return { error: "status must be Active, On Hold or Closed." }; out.status = b.status; }
  if ("visibility" in b) { if (!["Organization", "Restricted"].includes(b.visibility)) return { error: "visibility must be Organization or Restricted." }; out.visibility = b.visibility; }
  if ("ownerMembershipId" in b) {
    if (b.ownerMembershipId && !(await prisma.organizationMembership.findFirst({ where: { id: b.ownerMembershipId, organizationId: req.organizationId, status: "Active" } }))) return { error: "ownerMembershipId must be an active member of this organization." };
    out.ownerMembershipId = b.ownerMembershipId || null;
  }
  if (out.name) {
    const clash = await prisma.projectPortfolio.findFirst({ where: { organizationId: req.organizationId, name: out.name, ...(existing && { id: { not: existing.id } }) } });
    if (clash) return { error: `A portfolio named "${out.name}" already exists.` };
  }
  return { data: out };
}

export async function createPortfolio(req, res) {
  const { data, error } = await portfolioFields(req, null);
  if (error) return invalid(res, error);
  const portfolio = await prisma.projectPortfolio.create({ data: { ...data, organizationId: req.organizationId, ownerMembershipId: data.ownerMembershipId ?? who(req), createdByMembershipId: who(req), updatedByMembershipId: who(req) } });
  await audit(req, "projects.portfolio.created", "ProjectPortfolio", portfolio.id);
  res.status(201).json({ portfolio: await portfolioWithProjects(req, portfolio) });
}

export async function updatePortfolio(req, res) {
  const existing = await prisma.projectPortfolio.findFirst({ where: { id: req.params.portfolioId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Portfolio");
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) return conflict(res, "portfolio");
  const { data, error } = await portfolioFields(req, existing);
  if (error) return invalid(res, error);
  if (req.body.archived === true) data.archivedAt = new Date();
  const portfolio = await prisma.projectPortfolio.update({ where: { id: existing.id }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } } });
  await audit(req, "projects.portfolio.updated", "ProjectPortfolio", portfolio.id);
  res.json({ portfolio: await portfolioWithProjects(req, portfolio) });
}

// ---------------------------------------------------------------- Templates

const TEMPLATE_INCLUDE = { versions: { orderBy: { versionNumber: "desc" } } };

export async function listTemplates(req, res) {
  const templates = await prisma.projectTemplate.findMany({ where: { organizationId: req.organizationId, ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }) }, include: TEMPLATE_INCLUDE, orderBy: { name: "asc" } });
  res.json({ templates: toApi(templates) });
}

export async function getTemplate(req, res) {
  const template = await prisma.projectTemplate.findFirst({ where: { id: req.params.templateId, organizationId: req.organizationId }, include: TEMPLATE_INCLUDE });
  if (!template) return notFound(res, "Template");
  res.json({ template: toApi(template) });
}

export async function createTemplate(req, res) {
  const name = text(req.body.name, 120);
  if (!name) return invalid(res, "name is required.");
  const error = validateTemplateContent(req.body.content);
  if (error) return invalid(res, error);
  if (await prisma.projectTemplate.findFirst({ where: { organizationId: req.organizationId, name } })) return invalid(res, `A template named "${name}" already exists.`);
  const template = await prisma.$transaction(async (tx) => {
    const t = await tx.projectTemplate.create({ data: { organizationId: req.organizationId, name, description: text(req.body.description, 2000), projectType: text(req.body.projectType, 60) || "Delivery", createdByMembershipId: who(req), updatedByMembershipId: who(req) } });
    const v = await tx.projectTemplateVersion.create({ data: { organizationId: req.organizationId, templateId: t.id, versionNumber: 1, content: req.body.content, changeNote: text(req.body.changeNote, 500), createdByMembershipId: who(req) } });
    return tx.projectTemplate.update({ where: { id: t.id }, data: { currentVersionId: v.id }, include: TEMPLATE_INCLUDE });
  });
  await audit(req, "projects.template.created", "ProjectTemplate", template.id);
  res.status(201).json({ template: toApi(template) });
}

// Only name/description/active change in place; content changes through a
// new version (published versions are immutable).
export async function updateTemplate(req, res) {
  const existing = await prisma.projectTemplate.findFirst({ where: { id: req.params.templateId, organizationId: req.organizationId } });
  if (!existing) return notFound(res, "Template");
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) return conflict(res, "template");
  if ("content" in req.body) return invalid(res, "Template content changes through a new version (POST /new-version).");
  const data = {};
  if ("name" in req.body) { data.name = text(req.body.name, 120); if (!data.name) return invalid(res, "name can't be empty."); }
  if ("description" in req.body) data.description = text(req.body.description, 2000);
  if ("active" in req.body) data.active = Boolean(req.body.active);
  if (req.body.archived === true) Object.assign(data, { archivedAt: new Date(), active: false });
  const template = await prisma.projectTemplate.update({ where: { id: existing.id }, data: { ...data, updatedByMembershipId: who(req), version: { increment: 1 } }, include: TEMPLATE_INCLUDE });
  await audit(req, "projects.template.updated", "ProjectTemplate", template.id);
  res.json({ template: toApi(template) });
}

export async function newTemplateVersion(req, res) {
  const existing = await prisma.projectTemplate.findFirst({ where: { id: req.params.templateId, organizationId: req.organizationId }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!existing) return notFound(res, "Template");
  const error = validateTemplateContent(req.body.content);
  if (error) return invalid(res, error);
  const versionNumber = (existing.versions[0]?.versionNumber || 0) + 1;
  const template = await prisma.$transaction(async (tx) => {
    const v = await tx.projectTemplateVersion.create({ data: { organizationId: req.organizationId, templateId: existing.id, versionNumber, content: req.body.content, changeNote: text(req.body.changeNote, 500), createdByMembershipId: who(req) } });
    return tx.projectTemplate.update({ where: { id: existing.id }, data: { currentVersionId: v.id, updatedByMembershipId: who(req), version: { increment: 1 } }, include: TEMPLATE_INCLUDE });
  });
  await audit(req, "projects.template.versioned", "ProjectTemplate", template.id, { after: { versionNumber } });
  res.status(201).json({ template: toApi(template) });
}

// POST /projects/from-template { templateId, versionNumber?, name, startDate,
// companyId?, preview?: true } — `preview: true` only shows what would be
// created; otherwise (with an Idempotency-Key) creates it.
export async function createFromTemplate(req, res) {
  const b = req.body;
  const template = b.templateId && (await prisma.projectTemplate.findFirst({ where: { id: b.templateId, organizationId: req.organizationId, active: true, archivedAt: null } }));
  if (!template) return invalid(res, "templateId must be an active template in this organization.");
  const version = b.versionNumber
    ? await prisma.projectTemplateVersion.findFirst({ where: { templateId: template.id, versionNumber: Number(b.versionNumber) } })
    : await prisma.projectTemplateVersion.findUnique({ where: { id: template.currentVersionId } });
  if (!version) return invalid(res, "That template version doesn't exist.");
  const name = text(b.name, 200);
  if (!name) return invalid(res, "name is required.");
  const startDate = b.startDate ? new Date(b.startDate) : null;
  if (startDate && Number.isNaN(startDate.getTime())) return invalid(res, "startDate must be a valid date.");
  if (b.companyId && !(await prisma.company.findFirst({ where: { id: b.companyId, organizationId: req.organizationId } }))) return invalid(res, "companyId must be a company in this organization.");
  const content = version.content;
  if (b.preview) return res.json({ preview: { template: template.name, versionNumber: version.versionNumber, name, startDate, ...templatePreview(content, startDate) } });
  if (!req.idempotency) return res.status(400).json({ code: "IDEMPOTENCY_KEY_REQUIRED", message: "An Idempotency-Key header is required to create a project from a template." });

  const project = await prisma.$transaction(async (tx) => {
    const projectNumber = await nextDocumentNumber(tx, req.organizationId, "Project");
    const p = await tx.project.create({
      data: {
        organizationId: req.organizationId, projectNumber, name, status: "Planning", projectType: template.projectType, companyId: b.companyId || null,
        startDate, ownerMembershipId: who(req), templateId: template.id, templateVersionNumber: version.versionNumber, description: template.description,
        createdByMembershipId: who(req), updatedByMembershipId: who(req),
      },
    });
    if (who(req)) await tx.projectMember.create({ data: { organizationId: req.organizationId, projectId: p.id, membershipId: who(req), role: "Project Manager" } });
    const phaseIds = {};
    for (const [i, ph] of (content.phases || []).entries()) {
      phaseIds[ph.name] = (await tx.projectPhase.create({ data: { organizationId: req.organizationId, projectId: p.id, name: ph.name, displayOrder: i } })).id;
    }
    let board;
    if ((content.columns || []).length) {
      board = await tx.taskBoard.create({
        data: {
          organizationId: req.organizationId, projectId: p.id, name: "Main board", isDefault: true,
          columns: { create: content.columns.map((c, i) => ({ organizationId: req.organizationId, name: c.name, category: c.category, displayOrder: i, wipLimit: c.wipLimit || null, isCompletion: c.category === "Completed" || !!c.isCompletion })) },
        },
        include: { columns: { orderBy: { displayOrder: "asc" } } },
      });
    } else board = await ensureDefaultBoard(tx, p);
    const firstColumn = board.columns[0];
    const milestoneIds = {};
    for (const m of content.milestones || []) {
      milestoneIds[m.name] = (await tx.milestone.create({ data: { organizationId: req.organizationId, projectId: p.id, name: m.name, dueDate: offsetDate(startDate, m.offsetDays ?? 0), phaseId: m.phase ? phaseIds[m.phase] : null, acceptanceRequired: !!m.acceptanceRequired, customerVisible: !!m.customerVisible } })).id;
    }
    const taskIds = {};
    for (const t of content.tasks || []) {
      const taskNumber = await nextDocumentNumber(tx, req.organizationId, "Task");
      const task = await tx.task.create({
        data: {
          organizationId: req.organizationId, projectId: p.id, taskNumber, title: t.title, priority: t.priority || "Medium",
          boardId: board.id, columnId: firstColumn.id, status: firstColumn.name, statusCategory: firstColumn.category,
          phaseId: t.phase ? phaseIds[t.phase] : null, milestoneId: t.milestone ? milestoneIds[t.milestone] : null, dueDate: offsetDate(startDate, t.offsetDays),
          estimatedMinutes: t.estimateMinutes ?? null, estimateHours: t.estimateMinutes ? t.estimateMinutes / 60 : null,
          createdByMembershipId: who(req), updatedByMembershipId: who(req), reporterMembershipId: who(req),
        },
      });
      taskIds[t.key] = task.id;
      for (const [i, title] of (t.checklist || []).entries()) await tx.taskChecklistItem.create({ data: { organizationId: req.organizationId, taskId: task.id, title, displayOrder: i } });
    }
    for (const d of content.dependencies || []) {
      await tx.taskDependency.create({ data: { organizationId: req.organizationId, projectId: p.id, predecessorId: taskIds[d.from], successorId: taskIds[d.to], type: d.type || "Finish to Start", createdByMembershipId: who(req) } });
    }
    await projectActivity(tx, { organizationId: req.organizationId, projectId: p.id, eventType: "Created From Template", actorMembershipId: who(req), snapshot: { templateId: template.id, templateName: template.name, versionNumber: version.versionNumber } });
    return p;
  });
  await audit(req, "projects.project.created_from_template", "Project", project.id, { after: { templateId: template.id, versionNumber: version.versionNumber } });
  res.status(201).json({ project: toApi(await prisma.project.findUnique({ where: { id: project.id } })) });
}

// ---------------------------------------------------------------- Members

async function loadManagedProject(req, res) {
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, organizationId: req.organizationId, ...projectScopeWhere(req) }, include: { members: true } });
  if (!project) { notFound(res, "Project"); return null; }
  return project;
}

export async function listMembers(req, res) {
  const project = await loadManagedProject(req, res);
  if (!project) return;
  res.json({ members: toApi(project.members.filter((m) => req.query.includeInactive === "true" || m.active)) });
}

function memberFields(body) {
  const out = {};
  if ("role" in body) { if (!PROJECT_ROLES.includes(body.role)) return { error: `role must be one of ${PROJECT_ROLES.join(", ")}.` }; out.role = body.role; }
  if ("accessLevel" in body) { if (!["Edit", "View"].includes(body.accessLevel)) return { error: "accessLevel must be Edit or View." }; out.accessLevel = body.accessLevel; }
  if ("allocationPercent" in body) {
    const a = body.allocationPercent === null || body.allocationPercent === "" ? null : Number(body.allocationPercent);
    if (a !== null && !(Number.isInteger(a) && a >= 0 && a <= 100)) return { error: "allocationPercent must be a whole number from 0 to 100." };
    out.allocationPercent = a;
  }
  for (const f of ["startDate", "endDate"]) {
    if (f in body) { out[f] = body[f] ? new Date(body[f]) : null; if (out[f] && Number.isNaN(out[f].getTime())) return { error: `${f} must be a valid date.` }; }
  }
  if (out.startDate && out.endDate && out.endDate < out.startDate) return { error: "endDate can't be before startDate." };
  return { data: out };
}

// Members must be ACTIVE members of the same organization. Membership in a
// project grants no access to unrelated CRM or financial records.
export async function addMember(req, res) {
  const project = await loadManagedProject(req, res);
  if (!project) return;
  if (!hasGrant(req, "projects", "manage_members") || !managesProject(req, project)) return forbidden(res, "Only the project's managers can change its members.");
  const membership = req.body.membershipId && (await prisma.organizationMembership.findFirst({ where: { id: req.body.membershipId, organizationId: req.organizationId, status: "Active" } }));
  if (!membership) return invalid(res, "membershipId must be an active member of this organization.");
  const { data, error } = memberFields({ role: "Contributor", accessLevel: "Edit", ...req.body });
  if (error) return invalid(res, error);
  const member = await prisma.$transaction(async (tx) => {
    const m = await tx.projectMember.upsert({
      where: { projectId_membershipId: { projectId: project.id, membershipId: membership.id } },
      update: { ...data, active: true },
      create: { ...data, organizationId: req.organizationId, projectId: project.id, membershipId: membership.id },
    });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Member Added", actorMembershipId: who(req), toValue: membership.id, snapshot: { role: m.role } });
    return m;
  });
  await audit(req, "projects.member.added", "Project", project.id, { after: { membershipId: membership.id, role: member.role } });
  res.status(201).json({ member: toApi(member) });
}

export async function updateMember(req, res) {
  const project = await loadManagedProject(req, res);
  if (!project) return;
  if (!hasGrant(req, "projects", "manage_members") || !managesProject(req, project)) return forbidden(res, "Only the project's managers can change its members.");
  const existing = project.members.find((m) => m.membershipId === req.params.membershipId);
  if (!existing) return notFound(res, "Project member");
  const { data, error } = memberFields(req.body);
  if (error) return invalid(res, error);
  const member = await prisma.$transaction(async (tx) => {
    const m = await tx.projectMember.update({ where: { id: existing.id }, data });
    if (data.role && data.role !== existing.role) await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Member Role Changed", actorMembershipId: who(req), fromValue: existing.role, toValue: data.role, snapshot: { membershipId: existing.membershipId } });
    return m;
  });
  await audit(req, "projects.member.updated", "Project", project.id, { before: { role: existing.role }, after: { role: member.role } });
  res.json({ member: toApi(member) });
}

// Removing a member deactivates them and takes them off the project's open
// task assignments (they can't stay an assignee).
export async function removeMember(req, res) {
  const project = await loadManagedProject(req, res);
  if (!project) return;
  if (!hasGrant(req, "projects", "manage_members") || !managesProject(req, project)) return forbidden(res, "Only the project's managers can change its members.");
  const existing = project.members.find((m) => m.membershipId === req.params.membershipId && m.active);
  if (!existing) return notFound(res, "Project member");
  if (existing.membershipId === project.ownerMembershipId) return invalid(res, "Change the project manager before removing them.");
  await prisma.$transaction(async (tx) => {
    await tx.projectMember.update({ where: { id: existing.id }, data: { active: false } });
    await tx.taskAssignee.updateMany({ where: { membershipId: existing.membershipId, removedAt: null, task: { projectId: project.id } }, data: { removedAt: new Date() } });
    await tx.task.updateMany({ where: { projectId: project.id, assigneeMembershipId: existing.membershipId, statusCategory: { not: "Completed" } }, data: { assigneeMembershipId: null } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Member Removed", actorMembershipId: who(req), fromValue: existing.membershipId });
  });
  await audit(req, "projects.member.removed", "Project", project.id, { before: { membershipId: existing.membershipId } });
  res.json({ removed: true });
}
