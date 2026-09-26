// Builds the synthetic benchmark rows for one organization at a time, from
// a seed alone — no database access, so the output is testable and exactly
// reproducible. Everything is invented: people and companies come from
// small word lists, every email ends in ".perf.invalid" (a reserved,
// undeliverable domain) and phone numbers use the fictional 555-01xx range.
import { createRng, hashSeed } from "./rng.js";
import { tierVolumes } from "./profiles.js";

const FIRST = ["Ava", "Liam", "Maya", "Noah", "Zara", "Omar", "Iris", "Leo", "Nina", "Ravi", "Elena", "Marcus", "Priya", "Tom", "Sofia", "Kenji", "Amara", "Lucas", "Hana", "Diego", "Fatima", "Jonas", "Chloe", "Samuel", "Aisha", "Mateo", "Grace", "Yusuf", "Mila", "Arjun"];
const LAST = ["Chen", "Vasquez", "Okafor", "Reilly", "Desai", "Novak", "Haddad", "Larsen", "Moreau", "Tanaka", "Silva", "Kowalski", "Mensah", "Ibrahim", "Park", "Rossi", "Fischer", "Nguyen", "Adeyemi", "Bauer", "Costa", "Walsh", "Singh", "Duarte", "Lindqvist", "Petrov", "Abara", "Ortega", "Keller", "Sato"];
const CO_A = ["Northwind", "Bluepeak", "Harbor", "Summit", "Ironwood", "Crescent", "Maple", "Atlas", "Cobalt", "Evergreen", "Granite", "Lumen", "Orchid", "Pioneer", "Quartz", "Riverside", "Silverline", "Tidewater", "Vertex", "Willow"];
const CO_B = ["Logistics", "Analytics", "Health", "Foods", "Systems", "Energy", "Retail", "Labs", "Capital", "Motors", "Media", "Builders", "Pharma", "Textiles", "Networks", "Studios"];
const CO_SUFFIX = ["Inc.", "LLC", "Ltd.", "Group", "Co.", "GmbH", "S.A."];
const INDUSTRIES = ["Technology", "Healthcare", "Manufacturing", "Retail", "Logistics", "Finance", "Education", "Energy", "Hospitality", "Construction"];
const COUNTRIES = [["United States", 40], ["United Kingdom", 12], ["Germany", 10], ["India", 10], ["Armenia", 6], ["Brazil", 6], ["Australia", 6], ["Japan", 5], ["Nigeria", 5]];
const SUBJECTS = ["Cannot sign in", "Invoice amount looks wrong", "Export is slow", "How do I add a user?", "Report shows no data", "Password reset email missing", "Integration stopped syncing", "Request for a refund", "Feature question", "Page loads slowly"];

const LEAD_STATUS = { New: 30, Attempted: 14, Contacted: 18, Qualified: 14, Converted: 12, Unqualified: 8, Duplicate: 2, Spam: 2 };
const LEAD_SOURCES = ["Website", "Referral", "Cold Call", "Trade Show", "Social Media", "Advertisement"];
const OPEN_STAGES = [["Discovery", 10], ["Qualified", 25], ["Proposal", 50], ["Negotiation", 70], ["Approval", 90]];
const STAGES = [...OPEN_STAGES.map(([n, p]) => [n, p, "Open"]), ["Won", 100, "Won"], ["Lost", 0, "Lost"], ["Cancelled", 0, "Cancelled"], ["On Hold", 0, "OnHold"]];
const DEAL_STAGE_WEIGHT = { Discovery: 22, Qualified: 16, Proposal: 14, Negotiation: 9, Approval: 5, Won: 17, Lost: 12, Cancelled: 3, "On Hold": 2 };
const ACTIVITY_TYPES = { Call: 30, Email: 25, Meeting: 15, "Follow-up": 12, Task: 12, "Customer Visit": 3, Note: 3 };
const TICKET_STATUS = { New: 10, Open: 15, "In Progress": 15, "Waiting for Customer": 8, "Waiting for Internal Team": 4, Resolved: 23, Closed: 23, Cancelled: 2 };
const PROJECT_STATUS = { Planning: 12, Active: 40, "On Hold": 6, "At Risk": 7, Completed: 30, Cancelled: 5 };
const TASK_STATUS = [["To Do", "Ready", 30], ["In Progress", "In Progress", 22], ["Review", "Review", 10], ["Done", "Completed", 38]];
const ROLE_MIX = { user: 76, team_leader: 8, admin: 2, checker: 2, executive: 2, finance_manager: 2, accountant: 3, ai_governance_admin: 1 };
const AUDIT_ACTIONS = ["crm.lead.created", "crm.lead.updated", "crm.contact.updated", "sales.deal.stage_changed", "sales.quote.created", "support.ticket.replied", "auth.login", "auth.login_failed", "member.role_assigned", "projects.task.updated"];

export const PERF_EMAIL_DOMAIN = "perf.invalid";
// Roles the load tests sign in as; see perf/workload.json "roles".
export const LOAD_ROLES = ["user", "team_leader", "admin"];
export const perfOrgSlug = (seed, index) => `perf-${seed}-o${index}`;
export const perfUsername = (seed, orgIndex, memberIndex) => `perf-${seed}-o${orgIndex}-u${memberIndex}`;

const pad = (n, w = 6) => String(n).padStart(w, "0");
const phone = (rng) => `+1-202-555-01${pad(rng.int(0, 99), 2)}`;
const lower = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

// The list of organizations in a profile, in a stable order.
export function organizationsFor(profile) {
  const out = [];
  for (const tier of profile.tiers) for (let i = 0; i < tier.count; i++) out.push({ tier, index: out.length });
  return out;
}

// All rows for organization `index` of the profile. `roleIds` maps role key
// → Role.id; `passwordHash` is one shared hash for every synthetic user.
export function buildOrganization({ seed, profile, index, roleIds = {}, passwordHash = "x", now = new Date("2026-09-01T00:00:00Z") }) {
  const { tier } = organizationsFor(profile)[index];
  const vol = tierVolumes(tier);
  const rng = createRng(hashSeed(seed, index, tier.name));
  const slug = perfOrgSlug(seed, index);
  const id = (type, n) => `${slug}-${type}-${n}`;
  const orgId = id("org", 0);
  const rows = { organization: [], user: [], organizationMembership: [], membershipRole: [], pipeline: [], pipelineStage: [], company: [], contact: [], lead: [], deal: [], activity: [], ticket: [], project: [], task: [], auditEvent: [] };
  const orgCreated = rng.pastDate(now, 1100, 400, 1);
  rows.organization.push({ id: orgId, name: `${rng.pick(CO_A)} ${rng.pick(CO_B)} (${tier.name} benchmark ${index})`, slug, status: "Active", createdAt: orgCreated });

  // Members: one user each, with a realistic mix of roles.
  const members = [];
  const loadUsers = [];
  for (let n = 0; n < vol.members; n++) {
    const first = rng.pick(FIRST), last = rng.pick(LAST);
    const roleKey = n === 0 ? "admin" : rng.weighted(ROLE_MIX);
    const userId = id("user", n), membershipId = id("mem", n);
    rows.user.push({
      id: userId, name: `${first} ${last}`, fullName: `${first} ${last}`, username: perfUsername(seed, index, n),
      email: `${lower(first)}.${lower(last)}.${n}@${slug}.${PERF_EMAIL_DOMAIN}`, passwordHash, role: roleKey === "admin" ? "Admin" : "User",
      status: "Active", emailVerifiedAt: orgCreated, createdAt: rng.pastDate(now, 1000, 1),
    });
    const suspended = n > 0 && rng.chance(0.02);
    rows.organizationMembership.push({ id: membershipId, organizationId: orgId, userId, status: suspended ? "Suspended" : "Active", joinedAt: orgCreated });
    if (roleIds[roleKey]) rows.membershipRole.push({ membershipId, roleId: roleIds[roleKey] });
    members.push({ membershipId, roleKey });
    // Active staff whose journeys the load tests can run (no passwords here).
    if (!suspended && LOAD_ROLES.includes(roleKey)) loadUsers.push({ username: perfUsername(seed, index, n), organizationId: orgId, role: roleKey, tier: tier.name });
  }
  // Sales and support owners: ordinary employees and managers; a few own most records.
  const owners = members.filter((m) => m.roleKey === "user" || m.roleKey === "team_leader");
  const owner = () => (owners.length ? owners[rng.skewedIndex(owners.length)] : members[0]).membershipId;

  // One default pipeline with the standard stages.
  const pipelineId = id("pipe", 0);
  rows.pipeline.push({ id: pipelineId, organizationId: orgId, name: "New Business", isDefault: true, currencyPolicy: "USD" });
  const stageIds = {};
  STAGES.forEach(([name, probability, classification], displayOrder) => {
    stageIds[name] = id("stage", displayOrder);
    rows.pipelineStage.push({ id: stageIds[name], organizationId: orgId, pipelineId, name, displayOrder, probability, classification });
  });

  const common = (created) => {
    const archived = rng.chance(0.07);
    const updatedAt = new Date(Math.min(now.getTime(), created.getTime() + rng.next() * 200 * 86400000));
    return { organizationId: orgId, createdAt: created, updatedAt, archived, ...(archived ? { archivedAt: updatedAt, archiveReason: "No longer relevant" } : {}) };
  };

  for (let n = 0; n < vol.companies; n++) {
    const name = `${rng.pick(CO_A)} ${rng.pick(CO_B)} ${n % 7 === 0 ? rng.pick(CO_SUFFIX) : ""}`.trim();
    const domain = `${lower(name)}${n}.${PERF_EMAIL_DOMAIN}`;
    const ownerId = owner();
    rows.company.push({
      id: id("co", n), name, normalizedName: name.toLowerCase(), website: domain, normalizedDomain: domain, industry: rng.pick(INDUSTRIES),
      country: rng.weighted(COUNTRIES), companyType: rng.weighted({ Prospect: 45, Customer: 40, Partner: 8, Vendor: 4, "Former Customer": 3 }),
      lifecycleStage: rng.pick(["New", "Qualified", "Onboarding", "Active", "Renewal Due", "Churned"]), accountStatus: "Active", currency: "USD",
      ownerMembershipId: ownerId, createdByMembershipId: ownerId, updatedByMembershipId: ownerId, ...common(rng.pastDate(now, 1000)),
    });
  }

  for (let n = 0; n < vol.contacts; n++) {
    // About 3% are likely duplicates of an earlier contact (same email, name variant).
    const dupOf = n > 10 && rng.chance(0.03) ? rows.contact[rng.int(0, n - 1)] : null;
    const first = dupOf ? dupOf.firstName : rng.pick(FIRST), last = dupOf ? dupOf.lastName : rng.pick(LAST);
    const email = dupOf ? dupOf.email : `${lower(first)}.${lower(last)}.${n}@contact.${slug}.${PERF_EMAIL_DOMAIN}`;
    const ownerId = owner();
    rows.contact.push({
      id: id("ct", n), firstName: first, lastName: last, name: dupOf ? `${first.toUpperCase()} ${last}` : `${first} ${last}`, displayName: `${first} ${last}`,
      email, normalizedEmail: email.toLowerCase(), phone: phone(rng), jobTitle: rng.pick(["Buyer", "Operations Manager", "CTO", "Finance Director", "Office Manager", "VP Sales"]),
      companyId: vol.companies && rng.chance(0.85) ? id("co", rng.skewedIndex(vol.companies, 1.3)) : null,
      lifecycleStage: rng.pick(["New", "Engaged", "Active", "At Risk", "Churned"]), country: rng.weighted(COUNTRIES),
      ownerMembershipId: ownerId, createdByMembershipId: ownerId, updatedByMembershipId: ownerId, ...common(rng.pastDate(now, 1000)),
    });
  }

  for (let n = 0; n < vol.leads; n++) {
    const first = rng.pick(FIRST), last = rng.pick(LAST), status = rng.weighted(LEAD_STATUS);
    const email = `${lower(first)}.${lower(last)}.${n}@lead.${slug}.${PERF_EMAIL_DOMAIN}`;
    const created = rng.pastDate(now, 720);
    const ownerId = owner();
    rows.lead.push({
      id: id("ld", n), firstName: first, lastName: last, name: `${first} ${last}`, displayName: `${first} ${last}`,
      companyName: `${rng.pick(CO_A)} ${rng.pick(CO_B)}`, email, normalizedEmail: email, phone: phone(rng), source: rng.pick(LEAD_SOURCES), status,
      priority: rng.weighted({ Low: 25, Medium: 50, High: 20, Urgent: 5 }), score: rng.int(0, 100), estimatedValue: rng.money(500, 80000), currency: "USD",
      nextActionDate: ["New", "Attempted", "Contacted", "Qualified"].includes(status) && rng.chance(0.7) ? rng.futureDate(now, -20, 30) : null,
      ownerMembershipId: ownerId, createdByMembershipId: ownerId, updatedByMembershipId: ownerId, ...common(created),
    });
  }

  for (let n = 0; n < vol.deals; n++) {
    const stage = rng.weighted(DEAL_STAGE_WEIGHT);
    const [, probability, classification] = STAGES.find(([s]) => s === stage);
    const status = { Won: "Won", Lost: "Lost", Cancelled: "Cancelled", OnHold: "On Hold" }[classification] || "Open";
    const created = rng.pastDate(now, 600);
    const ownerId = owner();
    rows.deal.push({
      id: id("dl", n), dealNumber: `DL-${pad(n + 1)}`, name: `${rng.pick(CO_A)} ${rng.pick(["rollout", "renewal", "expansion", "pilot", "upgrade"])} ${n}`,
      stage, status, pipelineId, pipelineStageId: stageIds[stage], probability, value: rng.money(1000, 250000), currency: rng.weighted({ USD: 80, EUR: 12, GBP: 8 }),
      companyId: vol.companies ? id("co", rng.skewedIndex(vol.companies, 1.3)) : null, primaryContactId: vol.contacts ? id("ct", rng.int(0, vol.contacts - 1)) : null,
      expectedClosingDate: status === "Open" ? rng.futureDate(now, -15, 120) : null, actualClosingDate: status === "Open" ? null : rng.pastDate(now, 400),
      ownerMembershipId: ownerId, createdByMembershipId: ownerId, updatedByMembershipId: ownerId, ...common(created),
    });
  }

  for (let n = 0; n < vol.activities; n++) {
    const type = rng.weighted(ACTIVITY_TYPES);
    const future = rng.chance(0.25);
    const when = future ? rng.futureDate(now, 0, 45) : rng.pastDate(now, 500);
    const status = future ? "Scheduled" : rng.weighted({ Completed: 72, Scheduled: 10, Cancelled: 6, Missed: 7, "In Progress": 5 });
    const link = rng.weighted({ lead: 35, deal: 30, contact: 25, company: 10 });
    const ownerId = owner();
    // Activities have no archived flag; an archived one just has archivedAt.
    const { archived, archivedAt, archiveReason: _reason, ...base } = common(future ? rng.pastDate(now, 20) : when);
    rows.activity.push({
      id: id("ac", n), title: `${type} — ${rng.pick(FIRST)} ${rng.pick(LAST)}`, type, status, priority: rng.weighted({ Low: 20, Medium: 60, High: 17, Urgent: 3 }),
      scheduledStart: when, dueDate: when, completedAt: status === "Completed" ? when : null,
      leadId: link === "lead" && vol.leads ? id("ld", rng.int(0, vol.leads - 1)) : null,
      dealId: link === "deal" && vol.deals ? id("dl", rng.int(0, vol.deals - 1)) : null,
      contactId: link === "contact" && vol.contacts ? id("ct", rng.int(0, vol.contacts - 1)) : null,
      companyId: link === "company" && vol.companies ? id("co", rng.int(0, vol.companies - 1)) : null,
      ownerMembershipId: ownerId, assignedMembershipId: ownerId, createdByMembershipId: ownerId, updatedByMembershipId: ownerId,
      ...base, ...(archived ? { archivedAt } : {}),
    });
  }

  for (let n = 0; n < vol.tickets; n++) {
    const status = rng.weighted(TICKET_STATUS), subject = `${rng.pick(SUBJECTS)} (#${n})`;
    const created = rng.pastDate(now, 500);
    const priority = rng.weighted({ Low: 25, Medium: 50, High: 20, Urgent: 5 });
    const done = ["Resolved", "Closed"].includes(status);
    rows.ticket.push({
      id: id("tk", n), organizationId: orgId, ticketNumber: `TKT-${pad(n + 1)}`, subject, normalizedSubject: subject.toLowerCase(), status, priority,
      source: rng.pick(["Email", "Phone", "Chat", "Portal"]), category: rng.pick(["Billing", "Technical", "Account", "General"]), department: "Support",
      contactId: vol.contacts ? id("ct", rng.int(0, vol.contacts - 1)) : null, assignedMembershipId: status === "New" ? null : owner(),
      firstRespondedAt: status === "New" ? null : new Date(created.getTime() + rng.int(5, 600) * 60000),
      resolvedAt: done ? new Date(created.getTime() + rng.int(1, 96) * 3600000) : null, closedAt: status === "Closed" ? new Date(created.getTime() + rng.int(24, 200) * 3600000) : null,
      createdAt: created, updatedAt: created,
    });
  }

  let taskN = 0;
  for (let n = 0; n < vol.projects; n++) {
    const status = rng.weighted(PROJECT_STATUS), start = rng.pastDate(now, 500, 10);
    const ownerId = owner();
    rows.project.push({
      id: id("pj", n), organizationId: orgId, projectNumber: `PRJ-${pad(n + 1, 4)}`, name: `${rng.pick(CO_A)} ${rng.pick(["onboarding", "implementation", "migration", "rollout"])} ${n}`,
      status, priority: rng.weighted({ Low: 20, Medium: 55, High: 20, Urgent: 5 }), startDate: start, dueDate: new Date(start.getTime() + rng.int(20, 180) * 86400000),
      companyId: vol.companies ? id("co", rng.int(0, vol.companies - 1)) : null, ownerMembershipId: ownerId, createdByMembershipId: ownerId, createdAt: start, updatedAt: start,
    });
    const perProject = Math.max(1, Math.round((vol.tasks / vol.projects) * (0.5 + rng.next())));
    for (let t = 0; t < perProject; t++, taskN++) {
      const [tStatus, category] = rng.weighted(TASK_STATUS.map(([s, c, w]) => [[s, c], w]));
      const assignee = owner();
      rows.task.push({
        id: id("ts", taskN), organizationId: orgId, projectId: id("pj", n), taskNumber: `T-${pad(taskN + 1)}`, title: `${rng.pick(["Configure", "Review", "Import", "Train", "Test", "Document"])} ${rng.pick(["accounts", "pricing", "users", "reports", "workflow", "data"])} ${t}`,
        status: tStatus, statusCategory: category, priority: rng.weighted({ Low: 25, Medium: 55, High: 17, Urgent: 3 }),
        dueDate: new Date(start.getTime() + rng.int(3, 150) * 86400000), estimatedMinutes: rng.int(1, 16) * 30,
        completedAt: tStatus === "Done" ? rng.pastDate(now, 300) : null, assigneeMembershipId: assignee, ownerMembershipId: assignee, createdByMembershipId: ownerId,
        createdAt: start, updatedAt: start,
      });
    }
  }

  for (let n = 0; n < vol.auditEvents; n++) {
    const actor = members[rng.skewedIndex(members.length, 1.2)];
    const action = rng.pick(AUDIT_ACTIONS);
    rows.auditEvent.push({
      id: id("au", n), organizationId: orgId, actorUserId: id("user", members.indexOf(actor)), actorMembershipId: actor.membershipId, action,
      targetType: action.split(".")[1], targetId: `${slug}-target-${rng.int(0, 5000)}`, result: action === "auth.login_failed" ? "Failure" : "Success", createdAt: rng.pastDate(now, 400),
    });
  }

  return { organizationId: orgId, tier: tier.name, rows, loadUsers };
}
