// Backend Phase 5 — project planning: phases, boards and workflow columns,
// and labels. Reordering is transactional; a phase or column that still
// holds active tasks can't be removed; workflow configuration is data only.
import prisma from "../../lib/prisma.js";
import { toApi } from "../../utils/serialize.js";
import { recordAuditEvent, requestContext } from "../../services/auditService.js";
import { sanitizeText, normalizeName } from "../../services/support/supportCommon.js";
import { COLUMN_CATEGORIES, PROJECT_ROLES } from "../../services/projects/projectRulesService.js";
import { projectScopeWhere, managesProject, projectActivity } from "../../services/projects/projectAccess.js";
import { ensureDefaultBoard } from "../../services/projects/boardService.js";

const who = (req) => req.membership?.id || null;
const text = (v, max) => (typeof v === "string" && v.trim() ? sanitizeText(v, { max }) : null);
const invalid = (res, message) => res.status(400).json({ code: "PROJECTS_VALIDATION_FAILED", message });
const notFound = (res, what) => res.status(404).json({ code: "PROJECTS_RECORD_NOT_FOUND", message: `${what} not found.` });
const forbidden = (res) => res.status(403).json({ code: "RBAC_FORBIDDEN", message: "Only the project's managers can change its plan." });
const conflict = (res, what) => res.status(409).json({ code: "PROJECTS_VERSION_CONFLICT", message: `This ${what} was updated by someone else. Refresh and try again.` });
const PHASE_STATUSES = ["Not Started", "In Progress", "Completed", "Cancelled"];
const COLOR_TOKENS = ["gray", "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "pink", "rose"];
const TASK_FIELDS_FOR_COLUMNS = ["estimatedMinutes", "assigneeMembershipId", "dueDate", "description"];

async function audit(req, action, projectId, extra = {}) {
  await recordAuditEvent({ ...requestContext(req), actorUserId: req.user.id, actorMembershipId: who(req), organizationId: req.organizationId, action, targetType: "Project", targetId: projectId, result: "Success", ...extra });
}

// Loads the project in scope; `manage` also requires managing it.
async function loadProject(req, res, { manage = false } = {}) {
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, organizationId: req.organizationId, ...projectScopeWhere(req) }, include: { members: true } });
  if (!project) { notFound(res, "Project"); return null; }
  if (manage && !managesProject(req, project)) { forbidden(res); return null; }
  return project;
}

function parseDates(body, names) {
  const out = {};
  for (const f of names) {
    if (f in body) {
      out[f] = body[f] ? new Date(body[f]) : null;
      if (out[f] && Number.isNaN(out[f].getTime())) return { error: `${f} must be a valid date.` };
    }
  }
  return { data: out };
}

// ---------------------------------------------------------------- Phases

export async function listPhases(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  const phases = await prisma.projectPhase.findMany({ where: { projectId: project.id, archivedAt: null }, orderBy: { displayOrder: "asc" } });
  res.json({ phases: toApi(phases) });
}

export async function createPhase(req, res) {
  const project = await loadProject(req, res, { manage: true });
  if (!project) return;
  const name = text(req.body.name, 120);
  if (!name) return invalid(res, "name is required.");
  const { data: dates, error } = parseDates(req.body, ["plannedStartDate", "plannedEndDate"]);
  if (error) return invalid(res, error);
  if (dates.plannedStartDate && dates.plannedEndDate && dates.plannedEndDate < dates.plannedStartDate) return invalid(res, "plannedEndDate can't be before plannedStartDate.");
  const count = await prisma.projectPhase.count({ where: { projectId: project.id, archivedAt: null } });
  const phase = await prisma.$transaction(async (tx) => {
    const p = await tx.projectPhase.create({ data: { organizationId: req.organizationId, projectId: project.id, name, description: text(req.body.description, 2000), displayOrder: count, ownerMembershipId: req.body.ownerMembershipId || null, ...dates } });
    await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Phase Added", actorMembershipId: who(req), toValue: name });
    return p;
  });
  await audit(req, "projects.phase.created", project.id, { after: { phaseId: phase.id } });
  res.status(201).json({ phase: toApi(phase) });
}

export async function updatePhase(req, res) {
  const project = await loadProject(req, res, { manage: true });
  if (!project) return;
  const phase = await prisma.projectPhase.findFirst({ where: { id: req.params.phaseId, projectId: project.id } });
  if (!phase) return notFound(res, "Phase");
  if (req.body.version !== undefined && Number(req.body.version) !== phase.version) return conflict(res, "phase");
  const { data, error } = parseDates(req.body, ["plannedStartDate", "plannedEndDate", "actualStartDate", "actualEndDate"]);
  if (error) return invalid(res, error);
  if ("name" in req.body) { data.name = text(req.body.name, 120); if (!data.name) return invalid(res, "name can't be empty."); }
  if ("description" in req.body) data.description = text(req.body.description, 2000);
  if ("status" in req.body) { if (!PHASE_STATUSES.includes(req.body.status)) return invalid(res, `status must be one of ${PHASE_STATUSES.join(", ")}.`); data.status = req.body.status; }
  if (req.body.archived === true) {
    const active = await prisma.task.count({ where: { phaseId: phase.id, archivedAt: null, statusCategory: { notIn: ["Completed", "Cancelled"] } } });
    if (active) return invalid(res, `This phase still has ${active} active task(s).`);
    data.archivedAt = new Date();
  }
  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.projectPhase.update({ where: { id: phase.id }, data: { ...data, version: { increment: 1 } } });
    if (data.status && data.status !== phase.status) await projectActivity(tx, { organizationId: req.organizationId, projectId: project.id, eventType: "Phase Status Changed", actorMembershipId: who(req), fromValue: phase.status, toValue: data.status, snapshot: { phaseId: phase.id, name: phase.name } });
    return p;
  });
  await audit(req, "projects.phase.updated", project.id, { after: { phaseId: phase.id } });
  res.json({ phase: toApi(updated) });
}

// POST /phases/reorder { phaseIds: [...] } — all of the project's phases, in order.
export async function reorderPhases(req, res) {
  const project = await loadProject(req, res, { manage: true });
  if (!project) return;
  const ids = req.body.phaseIds;
  const phases = await prisma.projectPhase.findMany({ where: { projectId: project.id, archivedAt: null } });
  if (!Array.isArray(ids) || ids.length !== phases.length || new Set(ids).size !== ids.length || ids.some((id) => !phases.find((p) => p.id === id))) {
    return invalid(res, "phaseIds must list every active phase of this project exactly once.");
  }
  await prisma.$transaction(ids.map((id, i) => prisma.projectPhase.update({ where: { id }, data: { displayOrder: i, version: { increment: 1 } } })));
  await audit(req, "projects.phase.reordered", project.id);
  res.json({ phases: toApi(await prisma.projectPhase.findMany({ where: { projectId: project.id, archivedAt: null }, orderBy: { displayOrder: "asc" } })) });
}

// ---------------------------------------------------------------- Boards and columns

const BOARD_INCLUDE = { columns: { where: { active: true }, orderBy: { displayOrder: "asc" } } };

export async function listBoards(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  await prisma.$transaction((tx) => ensureDefaultBoard(tx, project));
  const boards = await prisma.taskBoard.findMany({ where: { projectId: project.id, active: true }, include: BOARD_INCLUDE, orderBy: { createdAt: "asc" } });
  res.json({ boards: toApi(boards) });
}

function columnData(c, organizationId, order) {
  if (!text(c?.name, 60)) return { error: "Every column needs a name." };
  if (!COLUMN_CATEGORIES.includes(c.category)) return { error: `Column category must be one of ${COLUMN_CATEGORIES.join(", ")}.` };
  if (c.wipLimit !== undefined && c.wipLimit !== null && !(Number.isInteger(c.wipLimit) && c.wipLimit >= 1 && c.wipLimit <= 1000)) return { error: "wipLimit must be a whole number from 1 to 1000." };
  const required = c.requiredFields || [];
  if (!Array.isArray(required) || required.some((f) => !TASK_FIELDS_FOR_COLUMNS.includes(f))) return { error: `requiredFields may only list ${TASK_FIELDS_FOR_COLUMNS.join(", ")}.` };
  const roles = c.allowedRoles || [];
  if (!Array.isArray(roles) || roles.some((r) => !PROJECT_ROLES.includes(r))) return { error: `allowedRoles may only list ${PROJECT_ROLES.join(", ")}.` };
  return {
    data: {
      organizationId, name: text(c.name, 60), description: text(c.description, 500), category: c.category, displayOrder: order,
      wipLimit: c.wipLimit ?? null, isCompletion: c.category === "Completed", requiredFields: required, allowedRoles: roles, allowedFromColumnIds: [],
    },
  };
}

// POST /boards { name, columns: [{ name, category, wipLimit?, requiredFields?, allowedRoles? }] }
export async function createBoard(req, res) {
  const project = await loadProject(req, res, { manage: true });
  if (!project) return;
  const name = text(req.body.name, 120);
  if (!name) return invalid(res, "name is required.");
  const columns = req.body.columns || [];
  if (!Array.isArray(columns) || !columns.length || columns.length > 20) return invalid(res, "A board needs 1 to 20 columns.");
  if (!columns.some((c) => c.category === "Completed")) return invalid(res, "A board needs a Completed column.");
  const data = [];
  for (const [i, c] of columns.entries()) {
    const out = columnData(c, req.organizationId, i);
    if (out.error) return invalid(res, out.error);
    data.push(out.data);
  }
  const board = await prisma.taskBoard.create({ data: { organizationId: req.organizationId, projectId: project.id, name, description: text(req.body.description, 500), columns: { create: data } }, include: BOARD_INCLUDE });
  await audit(req, "projects.board.created", project.id, { after: { boardId: board.id } });
  res.status(201).json({ board: toApi(board) });
}

// PATCH /boards/:boardId { name?, active?, columns?: [{ id?, name, category, wipLimit?, requiredFields?, allowedRoles?, allowedFromColumnIds?, active? }] }
// Columns listed with an id are updated; without one they're added. A
// column holding active tasks can't be deactivated.
export async function updateBoard(req, res) {
  const project = await loadProject(req, res, { manage: true });
  if (!project) return;
  const board = await prisma.taskBoard.findFirst({ where: { id: req.params.boardId, projectId: project.id }, include: { columns: true } });
  if (!board) return notFound(res, "Board");
  if (req.body.version !== undefined && Number(req.body.version) !== board.version) return conflict(res, "board");
  const ops = [];
  if ("columns" in req.body) {
    const cols = req.body.columns;
    if (!Array.isArray(cols) || cols.length > 20) return invalid(res, "columns must list at most 20 columns.");
    const known = new Set(board.columns.map((c) => c.id));
    for (const [i, c] of cols.entries()) {
      const out = columnData(c, req.organizationId, i);
      if (out.error) return invalid(res, out.error);
      const from = c.allowedFromColumnIds || [];
      if (!Array.isArray(from) || from.some((id) => !known.has(id))) return invalid(res, "allowedFromColumnIds must list columns of this board.");
      if (c.id) {
        if (!known.has(c.id)) return invalid(res, `Column ${c.id} isn't on this board.`);
        if (c.active === false) {
          const active = await prisma.task.count({ where: { columnId: c.id, archivedAt: null } });
          if (active) return invalid(res, `Column "${c.name}" still holds ${active} task(s).`);
        }
        const { organizationId, ...rest } = out.data;
        ops.push(prisma.boardColumn.update({ where: { id: c.id }, data: { ...rest, allowedFromColumnIds: from, ...(c.active === false && { active: false }) } }));
      } else {
        ops.push(prisma.boardColumn.create({ data: { ...out.data, boardId: board.id, allowedFromColumnIds: from } }));
      }
    }
  }
  const boardData = {};
  if ("name" in req.body) { boardData.name = text(req.body.name, 120); if (!boardData.name) return invalid(res, "name can't be empty."); }
  if ("active" in req.body && !board.isDefault) boardData.active = Boolean(req.body.active);
  ops.push(prisma.taskBoard.update({ where: { id: board.id }, data: { ...boardData, version: { increment: 1 } } }));
  await prisma.$transaction(ops);
  const fresh = await prisma.taskBoard.findUnique({ where: { id: board.id }, include: BOARD_INCLUDE });
  if (!fresh.columns.some((c) => c.category === "Completed")) {
    return invalid(res, "The board no longer has a Completed column — add one back.");
  }
  await audit(req, "projects.board.updated", project.id, { after: { boardId: board.id } });
  res.json({ board: toApi(fresh) });
}

// POST /boards/:boardId/columns/reorder { columnIds: [...] }
export async function reorderColumns(req, res) {
  const project = await loadProject(req, res, { manage: true });
  if (!project) return;
  const board = await prisma.taskBoard.findFirst({ where: { id: req.params.boardId, projectId: project.id }, include: { columns: { where: { active: true } } } });
  if (!board) return notFound(res, "Board");
  const ids = req.body.columnIds;
  if (!Array.isArray(ids) || ids.length !== board.columns.length || new Set(ids).size !== ids.length || ids.some((id) => !board.columns.find((c) => c.id === id))) {
    return invalid(res, "columnIds must list every active column of this board exactly once.");
  }
  await prisma.$transaction([
    ...ids.map((id, i) => prisma.boardColumn.update({ where: { id }, data: { displayOrder: i } })),
    prisma.taskBoard.update({ where: { id: board.id }, data: { version: { increment: 1 } } }),
  ]);
  await audit(req, "projects.board.columns_reordered", project.id, { after: { boardId: board.id } });
  res.json({ board: toApi(await prisma.taskBoard.findUnique({ where: { id: board.id }, include: BOARD_INCLUDE })) });
}

// ---------------------------------------------------------------- Labels

export async function listLabels(req, res) {
  const project = await loadProject(req, res);
  if (!project) return;
  const labels = await prisma.projectLabel.findMany({ where: { organizationId: req.organizationId, archivedAt: null, OR: [{ projectId: null }, { projectId: project.id }] }, orderBy: { name: "asc" } });
  res.json({ labels: toApi(labels) });
}

// Colors are design tokens from a fixed list — never arbitrary CSS.
export async function createLabel(req, res) {
  const project = await loadProject(req, res, { manage: true });
  if (!project) return;
  const name = text(req.body.name, 60);
  if (!name) return invalid(res, "name is required.");
  const colorToken = req.body.colorToken || "gray";
  if (!COLOR_TOKENS.includes(colorToken)) return invalid(res, `colorToken must be one of ${COLOR_TOKENS.join(", ")}.`);
  const projectId = req.body.scope === "Organization" ? null : project.id;
  const normalized = normalizeName(name);
  if (await prisma.projectLabel.findFirst({ where: { organizationId: req.organizationId, projectId, normalizedName: normalized, archivedAt: null } })) return invalid(res, `A label named "${name}" already exists.`);
  const label = await prisma.projectLabel.create({ data: { organizationId: req.organizationId, projectId, name, normalizedName: normalized, colorToken, description: text(req.body.description, 300) } });
  await audit(req, "projects.label.created", project.id, { after: { labelId: label.id } });
  res.status(201).json({ label: toApi(label) });
}
