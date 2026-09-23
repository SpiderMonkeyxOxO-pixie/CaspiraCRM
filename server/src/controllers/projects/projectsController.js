import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { broadestScope } from "../../services/crm/scopeService.js";
import { pickWritable } from "../../utils/pickWritable.js";
import { PROJECT_STATUSES, hasGrant } from "../../services/projects/projectRulesService.js";

const MAX_PAGE_SIZE = 100;

// The only fields a client may write (see pickWritable). Everything else —
// organization, audit membership ids, completedAt, version — is
// server-controlled.
const WRITABLE_FIELDS = ["name", "companyId", "dealId", "status", "ownerMembershipId", "startDate", "dueDate", "description", "customerVisible"];
const DATE_FIELDS = ["startDate", "dueDate"];

// Projects have no department/team of their own, so anything narrower than
// the whole organization means projects the member owns or created, or has
// a task assigned in.
export function projectScopeWhere(req) {
  if (req.isSystemOwnerOverride) return {};
  const scope = broadestScope(req.membership, "projects");
  if (scope === "Organization" || scope === "System-wide") return {};
  const me = req.membership.id;
  return { OR: [{ ownerMembershipId: me }, { createdByMembershipId: me }, { tasks: { some: { assigneeMembershipId: me } } }] };
}

const INCLUDE = {
  company: { select: { id: true, name: true } },
  deal: { select: { id: true, name: true, companyId: true } },
  milestones: { orderBy: { createdAt: "asc" } },
};

const invalid = (res, message) => res.status(400).json({ code: "PROJECTS_VALIDATION_FAILED", message });
const badRef = (res, field) => res.status(400).json({ code: "PROJECTS_REFERENCE_INVALID", message: `${field} must reference a record in this organization.` });

async function validateRefs(organizationId, { companyId, dealId, ownerMembershipId }) {
  if (companyId && !(await prisma.company.findFirst({ where: { id: companyId, organizationId } }))) return "companyId";
  if (dealId) {
    const deal = await prisma.deal.findFirst({ where: { id: dealId, organizationId } });
    if (!deal) return "dealId";
    if (companyId && deal.companyId && deal.companyId !== companyId) return "dealId (belongs to a different company)";
  }
  if (ownerMembershipId && !(await prisma.organizationMembership.findFirst({ where: { id: ownerMembershipId, organizationId, status: "Active" } }))) return "ownerMembershipId";
  return null;
}

function validateFields(fields) {
  if ("name" in fields && !fields.name?.trim()) return "name is required.";
  if ("status" in fields && !PROJECT_STATUSES.includes(fields.status)) return `status must be one of ${PROJECT_STATUSES.join(", ")}.`;
  for (const f of DATE_FIELDS) if (fields[f] && Number.isNaN(fields[f].getTime())) return `${f} must be a valid date.`;
  if (fields.startDate && fields.dueDate && fields.dueDate < fields.startDate) return "dueDate can't be before startDate.";
  if ("customerVisible" in fields) fields.customerVisible = Boolean(fields.customerVisible);
  return null;
}

async function loadProject(req, res) {
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, organizationId: req.organizationId, ...projectScopeWhere(req) }, include: INCLUDE });
  if (!project) res.status(404).json({ code: "PROJECTS_RECORD_NOT_FOUND", message: "Project not found." });
  return project;
}

async function audit(req, action, projectId, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: req.membership?.id, organizationId: req.organizationId, action, targetType: "Project", targetId: projectId, result: "Success", ...extra });
}

async function saved(res, projectId, status = 200) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: INCLUDE });
  res.status(status).json({ project: toApi(project) });
}

export async function list(req, res) {
  const q = req.query;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.pageSize) || 25));
  const where = { organizationId: req.organizationId, ...projectScopeWhere(req) };
  if (q.status) where.status = q.status;
  if (q.companyId) where.companyId = q.companyId;
  if (q.ownerMembershipId) where.ownerMembershipId = q.ownerMembershipId;
  if (q.search) where.AND = [{ name: { contains: q.search, mode: "insensitive" } }];
  const [projects, total] = await Promise.all([
    prisma.project.findMany({ where, include: INCLUDE, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.project.count({ where }),
  ]);
  res.json({ projects: toApi(projects), total, page, pageSize });
}

export async function getOne(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  res.json({ project: toApi(project) });
}

export async function create(req, res) {
  const fields = pickWritable(req.body, WRITABLE_FIELDS, { dates: DATE_FIELDS });
  if (!fields.name?.trim()) return invalid(res, "name is required.");
  const error = validateFields(fields);
  if (error) return invalid(res, error);
  // The creator owns the project unless someone else is named.
  if (!fields.ownerMembershipId) fields.ownerMembershipId = req.membership?.id || null;
  const refError = await validateRefs(req.organizationId, fields);
  if (refError) return badRef(res, refError);

  const status = fields.status || "Planning";
  const project = await prisma.project.create({
    data: {
      ...fields, status, organizationId: req.organizationId, completedAt: status === "Completed" ? new Date() : null,
      createdByMembershipId: req.membership?.id || null, updatedByMembershipId: req.membership?.id || null,
    },
  });
  await audit(req, "projects.project.created", project.id);
  await saved(res, project.id, 201);
}

export async function update(req, res) {
  const existing = await loadProject(req, res);
  if (!existing) return;
  if (req.body.version !== undefined && Number(req.body.version) !== existing.version) {
    return res.status(409).json({ code: "PROJECTS_VERSION_CONFLICT", message: "This project was updated by someone else. Refresh and try again." });
  }
  const fields = pickWritable(req.body, WRITABLE_FIELDS, { dates: DATE_FIELDS });
  const error = validateFields({ startDate: existing.startDate, dueDate: existing.dueDate, ...fields });
  if (error) return invalid(res, error);
  if ("customerVisible" in fields) fields.customerVisible = Boolean(fields.customerVisible);
  // Changing the owner is a reassignment — it needs the "assign" grant, not
  // just "edit" (requireCrmOrgPermission already checked "edit").
  if ("ownerMembershipId" in fields && fields.ownerMembershipId !== existing.ownerMembershipId && !hasGrant(req, "projects", "assign")) {
    return res.status(403).json({ code: "RBAC_FORBIDDEN", message: "You don't have permission to change the project owner." });
  }
  const refError = await validateRefs(req.organizationId, {
    companyId: fields.companyId !== undefined ? fields.companyId : existing.companyId,
    dealId: fields.dealId !== undefined ? fields.dealId : existing.dealId,
    ownerMembershipId: fields.ownerMembershipId,
  });
  if (refError) return badRef(res, refError);

  const statusChanged = fields.status && fields.status !== existing.status;
  const completedAt = statusChanged ? (fields.status === "Completed" ? new Date() : null) : undefined;
  await prisma.project.update({
    where: { id: existing.id },
    data: { ...fields, ...(completedAt !== undefined && { completedAt }), updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } },
  });
  await audit(req, statusChanged ? "projects.project.status_changed" : "projects.project.updated", existing.id, {
    before: { status: existing.status, ownerMembershipId: existing.ownerMembershipId },
    after: { status: fields.status ?? existing.status, ownerMembershipId: fields.ownerMembershipId !== undefined ? fields.ownerMembershipId : existing.ownerMembershipId },
  });
  await saved(res, existing.id);
}

export async function addMilestone(req, res) {
  const name = req.body.name?.trim();
  if (!name) return invalid(res, "A milestone name is required.");
  const dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) return invalid(res, "dueDate must be a valid date.");
  const existing = await loadProject(req, res);
  if (!existing) return;
  await prisma.$transaction([
    prisma.milestone.create({ data: { projectId: existing.id, name, dueDate } }),
    prisma.project.update({ where: { id: existing.id }, data: { updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } }),
  ]);
  await audit(req, "projects.milestone.added", existing.id, { after: { name } });
  await saved(res, existing.id, 201);
}

// Flips a milestone between done and not done (or sets it, if `completed`
// is given) and returns the whole project, as the milestone list expects.
export async function toggleMilestone(req, res) {
  const existing = await loadProject(req, res);
  if (!existing) return;
  const milestone = existing.milestones.find((m) => m.id === req.params.milestoneId);
  if (!milestone) return res.status(404).json({ code: "PROJECTS_RECORD_NOT_FOUND", message: "Milestone not found." });
  const completed = typeof req.body?.completed === "boolean" ? req.body.completed : !milestone.completed;
  await prisma.$transaction([
    prisma.milestone.update({
      where: { id: milestone.id },
      data: { completed, completedAt: completed ? new Date() : null, completedByMembershipId: completed ? req.membership?.id || null : null },
    }),
    prisma.project.update({ where: { id: existing.id }, data: { updatedByMembershipId: req.membership?.id || null, version: { increment: 1 } } }),
  ]);
  await audit(req, completed ? "projects.milestone.completed" : "projects.milestone.reopened", existing.id, { after: { milestoneId: milestone.id } });
  await saved(res, existing.id);
}
