// Weighted user journeys (perf/workload.json). Each request is tagged with
// its threshold group (read, search, write, dashboard, enqueue, auth) and
// a journey name, so results break down per journey. Writes only touch
// records the signed-in user can see (taken from their own list results).
import { check, sleep } from "k6";
import { call, json } from "./session.js";
import { workload } from "./config.js";

const SEARCH_TERMS = ["north", "chen", "logistics", "summit", "priya", "harbor", "analytics", "vertex", "ortega", "labs"];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const ok = (res, name) => check(res, { [`${name} 2xx`]: (r) => r.status >= 200 && r.status < 300 });

// Per-VU memory of ids seen in list responses, used for detail and write journeys.
const seen = { leads: [], contacts: [], companies: [], deals: [], tickets: [], stages: [] };
const remember = (key, rows) => {
  if (Array.isArray(rows) && rows.length) seen[key] = rows.slice(0, 25).map((r) => r._id || r.id);
};

const list = (path, key, name, group = "read") => {
  const res = call("GET", path, { group, name });
  ok(res, name);
  const body = json(res);
  if (body && key) remember(key, body[key]);
  return body;
};

const J = {
  "leads.list": () => list("/crm/leads?page=1&pageSize=25", "leads", "leads.list"),
  "leads.filter": () => list(`/crm/leads?page=${1 + Math.floor(Math.random() * 4)}&pageSize=25&status=${pick(["New", "Contacted", "Qualified"])}`, "leads", "leads.filter"),
  "leads.detail": () => { if (!seen.leads.length) J["leads.list"](); if (seen.leads.length) ok(call("GET", `/crm/leads/${pick(seen.leads)}`, { group: "read", name: "leads.detail" }), "leads.detail"); },
  "contacts.list": () => list("/crm/contacts?page=1&pageSize=25", "contacts", "contacts.list"),
  "contacts.detail": () => { if (!seen.contacts.length) J["contacts.list"](); if (seen.contacts.length) ok(call("GET", `/crm/contacts/${pick(seen.contacts)}`, { group: "read", name: "contacts.detail" }), "contacts.detail"); },
  "companies.detail": () => {
    if (!seen.companies.length) list("/crm/companies?page=1&pageSize=25", "companies", "companies.list");
    if (seen.companies.length) ok(call("GET", `/crm/companies/${pick(seen.companies)}`, { group: "read", name: "companies.detail" }), "companies.detail");
  },
  "deals.list": () => list("/sales/deals?page=1&pageSize=25", "deals", "deals.list"),
  "tickets.list": () => list("/support/tickets?page=1&pageSize=25", "tickets", "tickets.list"),
  "tickets.detail": () => { if (!seen.tickets.length) J["tickets.list"](); if (seen.tickets.length) ok(call("GET", `/support/tickets/${pick(seen.tickets)}`, { group: "read", name: "tickets.detail" }), "tickets.detail"); },
  "projects.list": () => list("/projects?page=1&pageSize=25", null, "projects.list"),
  "quotes.list": () => list("/sales/quotes?page=1&pageSize=25", null, "quotes.list"),
  "orders.list": () => list("/sales/orders?page=1&pageSize=25", null, "orders.list"),
  "contracts.list": () => list("/sales/contracts?page=1&pageSize=25", null, "contracts.list"),
  "search.leads": () => list(`/crm/leads?page=1&pageSize=25&search=${pick(SEARCH_TERMS)}`, "leads", "search.leads", "search"),
  "search.contacts": () => list(`/crm/contacts?page=1&pageSize=25&search=${pick(SEARCH_TERMS)}`, "contacts", "search.contacts", "search"),
  "audit.list": (s) => list(`/organizations/${s.orgId}/audit-events?page=1&pageSize=25`, null, "audit.list"),
  "integrations.status": () => list("/integrations/connections", null, "integrations.status"),

  "dashboard.leadSummary": () => list("/crm/leads/summary", null, "dashboard.leadSummary", "dashboard"),
  "dashboard.activitySummary": () => list("/crm/activities/summary", null, "dashboard.activitySummary", "dashboard"),
  "dashboard.dealPipeline": () => {
    const body = list("/sales/pipelines", null, "dashboard.dealPipeline", "dashboard");
    const stages = body?.pipelines?.[0]?.stages || [];
    seen.stages = stages.filter((st) => st.classification === "Open").map((st) => st._id || st.id);
  },
  "dashboard.analyticsSales": () => list("/analytics/sales", null, "dashboard.analyticsSales", "dashboard"),
  "dashboard.analyticsOverview": () => list("/analytics/overview", null, "dashboard.analyticsOverview", "dashboard"),

  "leads.update": () => {
    if (!seen.leads.length) J["leads.list"]();
    if (!seen.leads.length) return;
    const res = call("PATCH", `/crm/leads/${pick(seen.leads)}`, { body: { nextActionText: `Follow up (load test ${Date.now()})` }, group: "write", name: "leads.update" });
    ok(res, "leads.update");
  },
  "deals.move": () => {
    if (!seen.deals.length) J["deals.list"]();
    if (!seen.stages.length) J["dashboard.dealPipeline"]();
    if (!seen.deals.length || !seen.stages.length) return;
    const res = call("POST", `/sales/deals/${pick(seen.deals)}/transition`, { body: { pipelineStageId: pick(seen.stages) }, group: "write", name: "deals.move" });
    // A closed deal can't move: 400 is a correct refusal, not a load failure.
    check(res, { "deals.move handled": (r) => r.status < 300 || r.status === 400 });
  },
  "tickets.reply": () => {
    if (!seen.tickets.length) J["tickets.list"]();
    if (!seen.tickets.length) return;
    const res = call("POST", `/support/tickets/${pick(seen.tickets)}/reply`, { body: { message: "Thanks, we're looking into it. (load test)" }, group: "write", name: "tickets.reply" });
    check(res, { "tickets.reply handled": (r) => r.status < 300 || r.status === 400 });
  },
  "activities.create": () => {
    if (!seen.leads.length) J["leads.list"]();
    const body = { title: "Call back (load test)", type: "Call", scheduledStart: new Date(Date.now() + 86400000).toISOString(), ...(seen.leads.length ? { leadId: pick(seen.leads) } : {}) };
    ok(call("POST", "/crm/activities", { body, group: "write", name: "activities.create" }), "activities.create");
  },
  "activities.calendar": () => {
    const from = new Date().toISOString(), to = new Date(Date.now() + 7 * 86400000).toISOString();
    list(`/crm/activities?dueFrom=${encodeURIComponent(from)}&dueTo=${encodeURIComponent(to)}&pageSize=50`, null, "activities.calendar");
  },
  "tasks.list": () => list("/tasks?page=1&pageSize=25", null, "tasks.list"),
  "tickets.transition": () => {
    const body = list("/support/tickets?page=1&pageSize=25&status=Open", null, "tickets.listOpen");
    const t = body?.tickets?.[0];
    if (!t) return;
    const res = call("POST", `/support/tickets/${t._id || t.id}/transition`, { body: { status: "In Progress", version: t.version }, group: "enqueue", name: "tickets.transition" });
    check(res, { "tickets.transition handled": (r) => r.status < 300 || r.status === 400 || r.status === 409 });
  },
  "reports.list": () => list("/reports", null, "reports.list"),
  "exports.list": () => list("/reports/exports", null, "exports.list"),
  "auth.me": () => ok(call("GET", "/auth/me", { group: "auth", name: "auth.me" }), "auth.me"),
  "auth.refresh": () => ok(call("POST", "/auth/refresh", { group: "auth", name: "auth.refresh" }), "auth.refresh"),
};

// Journeys a role may run; anything else would be a correct 403, not a result.
function allowedFor(role, name) {
  const adminOnly = ["audit.list", "dashboard.analyticsOverview"];
  if (adminOnly.includes(name)) return role === "admin";
  return true;
}

function weightedGroup() {
  const entries = Object.entries(workload.mix);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [group, w] of entries) {
    r -= w;
    if (r < 0) return group;
  }
  return entries[0][0];
}

export function runJourney(session) {
  const group = weightedGroup();
  // Non-admins read the sales dashboard where an admin would read the overview.
  const names = workload.journeys[group]
    .map((n) => (n === "dashboard.analyticsOverview" && session.user.role !== "admin" ? "dashboard.analyticsSales" : n))
    .filter((n) => allowedFor(session.user.role, n));
  if (!names.length) return;
  const name = pick(names);
  J[name](session);
  const { min, max } = workload.thinkTimeSeconds;
  sleep(min + Math.random() * (max - min));
}

export const JOURNEY_NAMES = Object.keys(J);
