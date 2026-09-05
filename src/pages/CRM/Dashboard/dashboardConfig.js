// Frontend view presets — each changes the default filter scope (and, for
// "My Dashboard", hides the team-comparison table that doesn't make sense
// for a single person) rather than swapping in different data. These are
// display presets only, not backend permission rules.
export const DASHBOARD_VIEWS = [
  {
    id: "my", label: "My Dashboard",
    description: "Your Leads, Deals, Activities and follow-ups.",
    defaultScope: "mine", showTeamPerformance: false,
  },
  {
    id: "team", label: "Team Dashboard",
    description: "Team pipeline, lead ownership, team activities and at-risk deals.",
    defaultScope: "team", showTeamPerformance: true,
  },
  {
    id: "management", label: "Management Overview",
    description: "Total pipeline, weighted forecast, conversion, won/lost and team comparison.",
    defaultScope: "all", showTeamPerformance: true,
  },
];

export function defaultViewForRole(role) {
  if (role === "Super-Admin") return "management";
  if (role === "Admin") return "team";
  return "my";
}

// Every widget key the settings drawer/reorder list knows about. Core
// widgets are always shown; only these are individually hideable.
export const OPTIONAL_WIDGET_KEYS = ["leadSource", "forecast", "companiesAttention", "recentActivity", "teamPerformance"];

export const DEFAULT_DASHBOARD_SETTINGS = {
  defaultView: "management",
  defaultRange: "thisMonth",
  density: "comfortable",
  hiddenWidgets: [],
  widgetOrder: [...OPTIONAL_WIDGET_KEYS],
};
