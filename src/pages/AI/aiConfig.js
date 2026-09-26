// Frontend view/scope presets and role defaults for the AI Intelligence
// Center — same pattern as the CRM Dashboard's dashboardConfig.js (view
// presets change the default filter scope, not the underlying data).

export const AI_VIEWS = [
  { id: "my", label: "My Intelligence", description: "Records owned by or assigned to you.", defaultScope: "mine" },
  { id: "team", label: "Team Intelligence", description: "Your team's pipeline, activity and risk.", defaultScope: "team" },
  { id: "department", label: "Department Intelligence", description: "Every team within your permitted department.", defaultScope: "department" },
  { id: "executive", label: "Executive Intelligence", description: "Organization-wide authorized information.", defaultScope: "all" },
  { id: "dataQuality", label: "Data Quality", description: "Missing, invalid, incomplete and duplicate records.", defaultScope: "all" },
];

// Department Manager (Team-Leader) defaults to Department Intelligence since
// that's their real internal role label; Auditor/Checker defaults to Data
// Quality since they review evidence rather than pipeline risk by default.
export function defaultViewForRole(role) {
  if (role === "Super-Admin" || role === "Admin") return "executive";
  if (role === "Team-Leader") return "department";
  if (role === "Checker") return "dataQuality";
  return "my";
}

// System Owner / Organization Administrator see organization-wide data;
// everyone else is scoped down before any calculation runs (see
// aiInsightEngine.scopeSharedData). This mirrors RequireAuth's role model —
// it is a frontend display/analysis scope, not a new permission system.
export function defaultScopeForRole(role) {
  const view = AI_VIEWS.find((v) => v.id === defaultViewForRole(role));
  return view?.defaultScope || "mine";
}

// Auditor/Checker may view evidence and history but cannot execute
// suggested actions by default — every other real role can confirm an
// action preview (still requiring explicit confirmation either way).
export function canExecuteActions(role) {
  return role !== "Checker";
}

// Every real role in this app currently has defined AI-preview behavior —
// this exists so the Restricted page state is implemented and testable
// rather than assumed unreachable, in case a future role is added without
// AI-analysis permission.
const AI_OVERVIEW_ALLOWED_ROLES = ["Super-Admin", "Admin", "Team-Leader", "User", "Checker"];
export function canAccessAiOverview(role) {
  return AI_OVERVIEW_ALLOWED_ROLES.includes(role);
}

// Mirrors the exact allowedRoles arrays each module's <RequireAuth> uses in
// App.jsx. Evidence links must never point at a route the viewer cannot
// actually open — kept here, next to the rest of the AI-specific role
// logic, and manually kept in sync with App.jsx's route guards.
export const MODULE_ROUTE_ROLES = {
  crm: ["Super-Admin", "Admin", "Team-Leader", "User"],
  sales: ["Super-Admin", "Admin", "Team-Leader", "User"],
};

export function canOpenModuleRoute(role, module) {
  return (MODULE_ROUTE_ROLES[module] || []).includes(role);
}

export const INSIGHT_PRIORITY_META = {
  Critical: { order: 0, description: "Immediate material risk", className: "bg-red-500/15 text-red-300 border-red-500/30" },
  High: { order: 1, description: "Important action required", className: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  Medium: { order: 2, description: "Should be reviewed", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  Low: { order: 3, description: "Improvement opportunity", className: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  Informational: { order: 4, description: "Context or observation", className: "bg-gray-500/15 text-gray-300 border-gray-500/30" },
};

export const CONFIDENCE_META = {
  "High Confidence": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Medium Confidence": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Low Confidence": "bg-orange-500/15 text-orange-300 border-orange-500/30",
  "Insufficient Data": "bg-gray-500/15 text-gray-300 border-gray-500/30",
};

export const DATE_RANGE_PRESETS = [
  { value: "last7", label: "Last 7 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "thisQuarter", label: "This Quarter" },
];

export const STANDARD_LIMITATIONS = [
  "This analysis is worked out by built-in rules from the records you can see — nothing is sent to an AI provider.",
  "Some business modules (Support, Projects, Finance, HR) are not yet included in this analysis.",
  "Every recommendation requires human review before any record is changed.",
  "No action shown here has been executed automatically.",
];
