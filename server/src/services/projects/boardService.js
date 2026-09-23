// Backend Phase 5 — boards and workflow columns. Moving a task between
// columns (Kanban drag-and-drop or a status change) always goes through
// checkColumnMove, so the board's rules are enforced on the server.
// Workflow configuration is data only — nothing in it is executed.
import { DEFAULT_COLUMNS, STARTED_CATEGORIES } from "./projectRulesService.js";

// Every project gets a default board with the frontend's four statuses as
// columns; created on demand for projects that predate boards.
export async function ensureDefaultBoard(tx, project) {
  const existing = await tx.taskBoard.findFirst({ where: { projectId: project.id, isDefault: true }, include: { columns: { orderBy: { displayOrder: "asc" } } } });
  if (existing) return existing;
  return tx.taskBoard.create({
    data: {
      organizationId: project.organizationId, projectId: project.id, name: "Main board", isDefault: true,
      columns: { create: DEFAULT_COLUMNS.map((c) => ({ organizationId: project.organizationId, name: c.name, category: c.category, displayOrder: c.displayOrder, isCompletion: !!c.isCompletion })) },
    },
    include: { columns: { orderBy: { displayOrder: "asc" } } },
  });
}

// Finds the column a status name refers to on the task's board (the
// frontend's status values are column names).
export function columnForStatus(board, status) {
  return board.columns.find((c) => c.active && c.name === status) || null;
}

const FIELD_LABELS = { estimatedMinutes: "an estimate", assigneeMembershipId: "an assignee", dueDate: "a due date", description: "a description" };

// Returns an error message, or null when the move is allowed.
//   context: { projectRole, wipCount (tasks already in `to`), openSubtasks,
//              blockingDependencies: [{ type, predecessorTitle, predecessorCategory }] }
export function checkColumnMove(task, from, to, context = {}) {
  if (!to || !to.active) return "That column doesn't exist on this board.";
  if (from && from.id === to.id) return null;
  const allowedFrom = Array.isArray(to.allowedFromColumnIds) ? to.allowedFromColumnIds : [];
  if (allowedFrom.length && from && !allowedFrom.includes(from.id)) return `Tasks can't move to "${to.name}" from "${from.name}".`;
  const allowedRoles = Array.isArray(to.allowedRoles) ? to.allowedRoles : [];
  if (allowedRoles.length && !allowedRoles.includes(context.projectRole)) return `Only ${allowedRoles.join(", ")} can move tasks to "${to.name}".`;
  if (to.wipLimit && (context.wipCount ?? 0) >= to.wipLimit) return `"${to.name}" is at its work-in-progress limit of ${to.wipLimit}.`;
  const required = Array.isArray(to.requiredFields) ? to.requiredFields : [];
  const missing = required.filter((f) => task[f] === null || task[f] === undefined || task[f] === "");
  if (missing.length) return `A task needs ${missing.map((f) => FIELD_LABELS[f] || f).join(" and ")} before it can move to "${to.name}".`;
  if (to.category === "Blocked" && !task.blockedReason) return "A blocked task needs a reason.";
  // A parent can't be completed while any of its subtasks is still open.
  if (to.category === "Completed" && context.openSubtasks > 0) return `This task has ${context.openSubtasks} open subtask(s) — complete them first.`;
  // Dependencies block (the project's policy is to block, not warn):
  //   Finish to Start  — successor can't start until the predecessor is completed
  //   Start to Start   — successor can't start until the predecessor has started
  //   Finish to Finish — successor can't complete until the predecessor is completed
  //   Start to Finish  — successor can't complete until the predecessor has started
  for (const dep of context.blockingDependencies || []) {
    const predDone = dep.predecessorCategory === "Completed";
    const predStarted = STARTED_CATEGORIES.includes(dep.predecessorCategory);
    const starting = STARTED_CATEGORIES.includes(to.category);
    const completing = to.category === "Completed";
    if (dep.type === "Finish to Start" && starting && !predDone) return `Waits for "${dep.predecessorTitle}" to finish (Finish to Start).`;
    if (dep.type === "Start to Start" && starting && !predStarted) return `Waits for "${dep.predecessorTitle}" to start (Start to Start).`;
    if (dep.type === "Finish to Finish" && completing && !predDone) return `Can't finish before "${dep.predecessorTitle}" (Finish to Finish).`;
    if (dep.type === "Start to Finish" && completing && !predStarted) return `Can't finish before "${dep.predecessorTitle}" starts (Start to Finish).`;
  }
  return null;
}
