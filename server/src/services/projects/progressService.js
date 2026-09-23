// Backend Phase 5 — transparent project progress. Every result says which
// mode was used and what it counted; there is no unexplained health score.
//
// Included tasks: not archived and not in a Cancelled column. Subtasks are
// counted like any other task.
//   Task Count — completed tasks ÷ included tasks × 100
//   Weighted   — Σ weight of completed tasks ÷ Σ weight of included tasks × 100
//   Milestones — achieved milestones ÷ milestones that aren't cancelled × 100
//   Manual     — the value a permitted person set, with their reason
// With nothing to count, progress is 0 and `basis` says so.
export function isCompletedTask(task) {
  return task.statusCategory === "Completed";
}

const included = (tasks) => tasks.filter((t) => !t.archivedAt && t.statusCategory !== "Cancelled");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function computeProgress(project, tasks = [], milestones = []) {
  const mode = project.progressMode || "Task Count";
  if (mode === "Manual") {
    return { mode, progress: project.manualProgress ?? 0, basis: project.manualProgressReason ? `Set manually: ${project.manualProgressReason}` : "Set manually" };
  }
  if (mode === "Milestones") {
    const counted = milestones.filter((m) => m.status !== "Cancelled" && !m.archivedAt);
    const achieved = counted.filter((m) => m.status === "Achieved").length;
    return { mode, progress: pct(achieved, counted.length), completed: achieved, total: counted.length, basis: counted.length ? `${achieved} of ${counted.length} milestones achieved` : "No milestones yet" };
  }
  const list = included(tasks);
  if (mode === "Weighted") {
    const total = list.reduce((s, t) => s + (t.weight || 0), 0);
    const done = list.filter(isCompletedTask).reduce((s, t) => s + (t.weight || 0), 0);
    return { mode, progress: pct(done, total), completed: done, total, basis: total ? `${done} of ${total} weight completed` : "No weighted tasks yet" };
  }
  const done = list.filter(isCompletedTask).length;
  return { mode: "Task Count", progress: pct(done, list.length), completed: done, total: list.length, basis: list.length ? `${done} of ${list.length} tasks completed` : "No tasks yet" };
}
