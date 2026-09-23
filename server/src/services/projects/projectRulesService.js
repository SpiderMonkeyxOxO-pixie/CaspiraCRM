// Backend Phase 5 — the Projects/Tasks vocabulary (matches the frontend's
// PROJECT_STATUSES / TASK_STATUSES / TASK_PRIORITIES) and the task
// dependency rules.
export const PROJECT_STATUSES = ["Planning", "Active", "On Hold", "Completed"];
export const TASK_STATUSES = ["To Do", "In Progress", "Review", "Done"];
export const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"];

// Largest single time entry — a typo guard (e.g. 80 for 8.0), not a policy.
export const MAX_HOURS_PER_ENTRY = 24;

// Walks the dependsOn chain from `dependsOnId` and reports whether it leads
// back to `taskId` — i.e. whether making `taskId` depend on `dependsOnId`
// would create a cycle. `findTask(id)` returns { id, dependsOnId } or null.
export async function createsDependencyCycle(taskId, dependsOnId, findTask) {
  const seen = new Set();
  let current = dependsOnId;
  while (current) {
    if (current === taskId) return true;
    if (seen.has(current)) return false; // a pre-existing loop not involving this task
    seen.add(current);
    const next = await findTask(current);
    current = next?.dependsOnId || null;
  }
  return false;
}

// Whether the caller holds `action` on `moduleId` — for a second permission
// inside a request whose route already checked the first one (e.g. changing
// an owner during an edit also needs "assign").
export function hasGrant(req, moduleId, action) {
  if (req.isSystemOwnerOverride) return true;
  return (req.membership?.roles || []).some((mr) => (mr.role.permissionGrants || []).some((g) => g.moduleId === moduleId && g.actions.includes(action)));
}
