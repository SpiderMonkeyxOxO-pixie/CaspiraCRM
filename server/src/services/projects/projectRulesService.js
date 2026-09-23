// Backend Phase 5 (full spec) — Projects vocabulary and rules. The frontend's
// statuses are kept (PROJECT_STATUSES / TASK_STATUSES in the slices) and
// extended with what the spec requires.

// Project lifecycle: the frontend's Planning / Active / On Hold / Completed,
// plus At Risk and Cancelled. Archiving is a flag (archivedAt), not a status.
export const PROJECT_STATUSES = ["Planning", "Active", "On Hold", "At Risk", "Completed", "Cancelled"];
export const PROJECT_TRANSITIONS = {
  Planning: ["Active", "Cancelled"],
  Active: ["On Hold", "At Risk", "Completed", "Cancelled"],
  "On Hold": ["Active", "Cancelled"],
  "At Risk": ["Active", "Completed", "Cancelled"],
  // Reopening a completed project needs its own permission and a reason.
  Completed: ["Active"],
  Cancelled: [],
};
export const canTransitionProject = (from, to) => (PROJECT_TRANSITIONS[from] || []).includes(to);
export const ARCHIVABLE_PROJECT_STATUSES = ["Completed", "Cancelled"];

export const PROJECT_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
export const HEALTH_STATES = ["On Track", "At Risk", "Off Track"];
export const PROGRESS_MODES = ["Task Count", "Weighted", "Milestones", "Manual"];
export const PROJECT_ROLES = ["Project Sponsor", "Project Manager", "Team Lead", "Contributor", "Reviewer", "Observer"];
// Roles that may manage the project's work (tasks, members, planning).
export const MANAGING_ROLES = ["Project Sponsor", "Project Manager", "Team Lead"];

// Tasks: the frontend's four statuses are the default board's columns.
export const TASK_STATUSES = ["To Do", "In Progress", "Review", "Done"];
export const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
export const COLUMN_CATEGORIES = ["Backlog", "Ready", "In Progress", "Review", "Blocked", "Completed", "Cancelled"];
export const DEFAULT_COLUMNS = [
  { name: "To Do", category: "Ready", displayOrder: 0 },
  { name: "In Progress", category: "In Progress", displayOrder: 1 },
  { name: "Review", category: "Review", displayOrder: 2 },
  { name: "Done", category: "Completed", displayOrder: 3, isCompletion: true },
];
export const STARTED_CATEGORIES = ["In Progress", "Review", "Blocked", "Completed"];
export const DEPENDENCY_TYPES = ["Finish to Start", "Start to Start", "Finish to Finish", "Start to Finish"];
export const MILESTONE_STATUSES = ["Planned", "In Progress", "At Risk", "Achieved", "Missed", "Cancelled"];

// Largest single time entry — a typo guard (e.g. 80 for 8.0), not a policy.
export const MAX_HOURS_PER_ENTRY = 24;
export const MAX_MINUTES_PER_ENTRY = 24 * 60;

// Walks the dependency graph from `startId` along `nextIds(id)` and reports
// whether it reaches `targetId` — used to reject a new dependency that would
// close a loop (direct or indirect).
export async function reaches(startId, targetId, nextIds) {
  const seen = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of await nextIds(id)) stack.push(n);
  }
  return false;
}

// Kept for the pre-full-spec single-dependency path and its tests.
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

// Moved to utils/grants.js (shared with Support and Finance).
export { hasGrant } from "../../utils/grants.js";
