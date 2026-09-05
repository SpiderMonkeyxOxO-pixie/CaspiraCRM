// Pure formatting/display helpers for the RBAC preview module — reuses the
// Products & Services catalog's date formatter rather than re-implementing it.
export { formatDate, formatDateTime } from "../Sales/Products/catalogUtils";

export const ROLE_TYPE_COLORS = {
  "Built-in": "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Custom: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Capability: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  External: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
};

export const ROLE_STATUS_COLORS = {
  Active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Inactive: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Archived: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export const SCOPE_COLORS = {
  Own: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Assigned: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  Team: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Department: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Organization: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Customer Account": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "System-wide": "bg-red-500/15 text-red-300 border-red-500/30",
};

export const FIELD_STATE_COLORS = {
  hidden: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  masked: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  readOnly: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  editable: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

export const CONFLICT_SEVERITY_COLORS = {
  high: "bg-red-500/15 text-red-300 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low: "bg-gray-500/15 text-gray-300 border-gray-500/30",
};

export const VIEW_ACTIONS = ["view", "view_own", "view_team", "view_department", "view_organization"];

export function grantSummary(role) {
  const granted = role.permissionGrants.reduce((n, g) => n + g.actions.length, 0);
  const modules = role.permissionGrants.filter((g) => g.actions.length > 0).length;
  return { granted, modules };
}
