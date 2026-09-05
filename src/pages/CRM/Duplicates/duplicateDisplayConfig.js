// Shared display constants (labels/colors) used by both DuplicatesPage and
// ComparisonWorkspace — kept in their own module (not exported alongside a
// component) so Fast Refresh stays happy.
export const RECORD_TYPE_LABELS = { leads: "Leads", contacts: "Contacts", companies: "Companies", deals: "Deals" };

export const RECORD_TYPE_COLORS = {
  leads: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  contacts: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  companies: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  deals: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

export const CONFIDENCE_COLORS = { High: "text-red-300 border-red-700", Medium: "text-amber-300 border-amber-700", Low: "text-gray-300 border-gray-700" };

export const STATUS_COLORS = {
  New: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Needs Review": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Confirmed Duplicate": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "Not Duplicate": "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Deferred: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  "Preview Resolved": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

export const DETAIL_ROUTES = { leads: "/crm/leads", contacts: "/crm/contacts", companies: "/crm/companies", deals: "/crm/deals" };

export const ACTIVITY_TYPE_FOR = { leads: "Lead", contacts: "Contact", companies: "Company", deals: "Deal" };
