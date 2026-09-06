// Adapted to this backend's actual Activity.status vocabulary (Scheduled |
// In Progress | Completed | Cancelled | Missed — "Overdue" is derived from
// scheduledEnd/dueDate vs now(), never stored, matching the frontend's own
// effectiveStatus() convention) rather than the spec's illustrative
// Planned/In Progress/Completed/Cancelled/Reopened names verbatim.
export const VALID_TRANSITIONS = {
  Scheduled: ["In Progress", "Completed", "Cancelled", "Missed"],
  "In Progress": ["Completed", "Cancelled", "Missed"],
  Completed: ["Scheduled"], // "reopened" lands back in Scheduled, a clean resumable state
  Cancelled: ["Scheduled"],
  Missed: ["Scheduled"],
};

export function canTransition(fromStatus, toStatus) {
  return (VALID_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

export function isOverdue(activity) {
  if (["Completed", "Cancelled"].includes(activity.status)) return false;
  const deadline = activity.dueDate || activity.scheduledEnd || activity.scheduledStart;
  return !!deadline && new Date(deadline).getTime() < Date.now();
}
