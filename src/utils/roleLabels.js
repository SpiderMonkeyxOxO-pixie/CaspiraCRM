// Centralized mapping from the app's real internal role identifiers
// (unchanged — still what RequireAuth, mockApi, and localStorage use) to the
// user-facing labels shown in the UI. Renaming a role's display name is a
// one-line change here, never a find/replace across components.
//
// "Super-Admin" keeps its internal identifier (routes, permission checks,
// fixtures) — only what users SEE has changed, to "System Owner".
export const ROLE_LABELS = {
  "Super-Admin": "System Owner",
  Admin: "Organization Administrator",
  "Team-Leader": "Department Manager",
  User: "Standard Employee",
  Checker: "Auditor / Checker",
};

export function getRoleLabel(role) {
  return ROLE_LABELS[role] || role;
}

// The role-template id (see mockRbacData.js) each real internal role maps to
// by default, so the live app's permission-derived navigation and the RBAC
// preview module describe the same role under the hood.
export const ROLE_TO_TEMPLATE_ID = {
  "Super-Admin": "system_owner",
  Admin: "organization_administrator",
  "Team-Leader": "department_manager",
  User: "standard_employee",
  Checker: "auditor_checker",
};

export function getDefaultTemplateIdForRole(role) {
  return ROLE_TO_TEMPLATE_ID[role] || null;
}
