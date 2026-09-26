// Dataset profiles for performance testing (Backend Phase 14). Volumes are
// per tenant tier so the data has large and small organizations and busy
// and quiet ones, like real multi-tenant use. Change volumes here, never
// inline in the generator, so every result can name the profile it used.

// Records per member of an organization, by activity level.
const PER_USER = {
  high: { leads: 22, contacts: 14, companies: 5, deals: 7, activities: 55, tickets: 6, projects: 0.25, tasksPerProject: 24, auditEvents: 90 },
  normal: { leads: 12, contacts: 8, companies: 3, deals: 4, activities: 25, tickets: 3, projects: 0.15, tasksPerProject: 16, auditEvents: 40 },
  low: { leads: 4, contacts: 3, companies: 1.2, deals: 1.2, activities: 6, tickets: 1, projects: 0.08, tasksPerProject: 8, auditEvents: 10 },
};

export const PROFILES = {
  // Docker Desktop / a laptop: functional checks only, never capacity claims.
  developer: {
    label: "Developer (functional validation only)",
    tiers: [
      { name: "large", count: 1, members: 60, activity: "high" },
      { name: "small", count: 2, members: 8, activity: "low" },
    ],
  },
  // The stated target: 1,000–10,000 accounts, under 100 concurrent users.
  "initial-production": {
    label: "Initial production (≈9,000 accounts across 40 organizations)",
    tiers: [
      { name: "large", count: 2, members: 1500, activity: "high" },
      { name: "medium", count: 8, members: 500, activity: "normal" },
      { name: "small", count: 30, members: 70, activity: "low" },
    ],
  },
  // Headroom: twice the records per member, more busy tenants.
  growth: {
    label: "Growth (≈12,000 accounts, twice the records per member)",
    tiers: [
      { name: "large", count: 3, members: 1500, activity: "high", recordFactor: 2 },
      { name: "medium", count: 10, members: 500, activity: "high", recordFactor: 2 },
      { name: "small", count: 40, members: 70, activity: "normal", recordFactor: 2 },
    ],
  },
};

export function getProfile(name) {
  const profile = PROFILES[name];
  if (!profile) throw new Error(`Unknown dataset profile "${name}". Use one of: ${Object.keys(PROFILES).join(", ")}.`);
  return profile;
}

// Expected row counts per organization of a tier (rounded).
export function tierVolumes(tier) {
  const per = PER_USER[tier.activity];
  const f = tier.recordFactor || 1;
  const n = (x) => Math.max(1, Math.round(x * tier.members * f));
  const projects = n(per.projects);
  return {
    members: tier.members,
    leads: n(per.leads),
    contacts: n(per.contacts),
    companies: n(per.companies),
    deals: n(per.deals),
    activities: n(per.activities),
    tickets: n(per.tickets),
    projects,
    tasks: Math.round(projects * per.tasksPerProject),
    auditEvents: n(per.auditEvents),
  };
}

export function profileTotals(name) {
  const totals = { organizations: 0 };
  for (const tier of getProfile(name).tiers) {
    totals.organizations += tier.count;
    for (const [k, v] of Object.entries(tierVolumes(tier))) totals[k] = (totals[k] || 0) + v * tier.count;
  }
  return totals;
}
