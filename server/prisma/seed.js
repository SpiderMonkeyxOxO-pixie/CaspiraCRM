import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding Caspira CRM database...");

  const password = await bcrypt.hash("Caspira123!", 10);

  const users = await Promise.all([
    prisma.user.upsert({
      where: { username: "owner" },
      update: {},
      create: { name: "System Owner", fullName: "System Owner", username: "owner", email: "owner@caspira.example", passwordHash: password, role: "Super-Admin", department: "Executive" },
    }),
    prisma.user.upsert({
      where: { username: "admin" },
      update: {},
      create: { name: "Org Admin", fullName: "Org Admin", username: "admin", email: "admin@caspira.example", passwordHash: password, role: "Admin", department: "Operations" },
    }),
    prisma.user.upsert({
      where: { username: "teamlead" },
      update: {},
      create: { name: "Priya Nair", fullName: "Priya Nair", username: "teamlead", email: "teamlead@caspira.example", passwordHash: password, role: "Team-Leader", department: "Sales" },
    }),
    prisma.user.upsert({
      where: { username: "checker" },
      update: {},
      create: { name: "Auditor Chen", fullName: "Auditor Chen", username: "checker", email: "checker@caspira.example", passwordHash: password, role: "Checker", department: "Finance" },
    }),
    prisma.user.upsert({
      where: { username: "user" },
      update: {},
      create: { name: "Sam Rep", fullName: "Sam Rep", username: "user", email: "user@caspira.example", passwordHash: password, role: "User", department: "Sales" },
    }),
  ]);
  const [owner, admin, teamlead, checker, salesUser] = users;
  console.log(`Seeded ${users.length} users (password for all: Caspira123!)`);

  // Built-in roles matching the frontend's RBAC preview role templates —
  // `key` links each row to the real auth role identifier it maps to.
  // permissionGrants: [{moduleId, actions:[]}] against constants/
  // permissionCatalog.js's "platform" module group (organizations, members,
  // invitations, invite_links, sessions, audit_events) — Backend Phase 1's
  // org-scoped RBAC surface. Auditor/Checker is read-only by design: no
  // grant here ever includes an edit/create/assign/delete_permanently
  // action. Standard Employee gets nothing (deny by default).
  const roleDefs = [
    {
      key: "super_admin", name: "System Owner", defaultScope: "System-wide", purpose: "Highest system-level authority.",
      permissionGrants: [
        { moduleId: "organizations", actions: ["view", "edit"] },
        { moduleId: "members", actions: ["view", "edit", "assign", "delete_permanently"] },
        { moduleId: "invitations", actions: ["view", "create", "edit"] },
        { moduleId: "invite_links", actions: ["view", "create", "edit"] },
        { moduleId: "sessions", actions: ["view"] },
        { moduleId: "audit_events", actions: ["view"] },
        // Backend Phase 2 — CRM Core Data Persistence
        { moduleId: "leads", actions: ["view", "create", "edit", "assign", "archive", "restore", "convert", "bulk_actions", "export"] },
        { moduleId: "contacts", actions: ["view", "create", "edit", "assign", "archive", "restore", "merge", "bulk_actions", "export", "view_sensitive_fields"] },
        { moduleId: "companies", actions: ["view", "create", "edit", "assign", "archive", "restore", "merge", "bulk_actions", "export", "view_financial_fields"] },
        { moduleId: "activities", actions: ["view", "create", "edit", "assign", "archive", "restore", "bulk_actions"] },
        { moduleId: "notes", actions: ["view", "create", "edit", "archive"] },
        { moduleId: "tags", actions: ["view", "create", "edit", "archive"] },
        // Backend Phase 3 — Sales Pipeline, Deals, Catalog, Quotes, Orders, Contracts
        { moduleId: "pipeline", actions: ["view", "create", "edit", "archive", "restore", "reorder"] },
        { moduleId: "deals", actions: ["view", "create", "edit", "assign", "transition", "close", "reopen", "archive", "restore", "bulk_actions", "view_financial_fields"] },
        { moduleId: "products_services", actions: ["view", "create", "edit", "archive", "restore", "view_financial_fields"] },
        { moduleId: "price_books", actions: ["view", "create", "edit", "archive", "restore"] },
        { moduleId: "quotes", actions: ["view", "create", "edit", "submit", "approve", "reject", "issue", "accept", "cancel", "archive", "restore", "bulk_actions", "override_pricing", "view_financial_fields"] },
        { moduleId: "orders", actions: ["view", "create", "edit", "confirm", "cancel", "fulfill", "archive", "restore", "bulk_actions"] },
        { moduleId: "contracts", actions: ["view", "create", "edit", "approve", "activate", "renew", "terminate", "manage_obligations", "archive", "restore", "bulk_actions"] },
        { moduleId: "sales_reports", actions: ["view", "view_forecast"] },
        // Backend Phase 4 — Support
        { moduleId: "tickets", actions: ["view", "create", "edit", "assign", "reply", "escalate", "resolve", "close", "reopen"] },
        // Backend Phase 5 — Projects
        { moduleId: "projects", actions: ["view", "create", "edit", "assign"] },
        { moduleId: "tasks", actions: ["view", "create", "edit", "assign"] },
      ],
    },
    {
      key: "admin", name: "Organization Administrator", defaultScope: "Organization", purpose: "Manages one organization and its business configuration.",
      permissionGrants: [
        { moduleId: "organizations", actions: ["view", "edit"] },
        { moduleId: "members", actions: ["view", "edit", "assign", "delete_permanently"] },
        { moduleId: "invitations", actions: ["view", "create", "edit"] },
        { moduleId: "invite_links", actions: ["view", "create", "edit"] },
        { moduleId: "sessions", actions: ["view"] },
        { moduleId: "audit_events", actions: ["view"] },
        { moduleId: "leads", actions: ["view", "create", "edit", "assign", "archive", "restore", "convert", "bulk_actions", "export"] },
        { moduleId: "contacts", actions: ["view", "create", "edit", "assign", "archive", "restore", "merge", "bulk_actions", "export", "view_sensitive_fields"] },
        { moduleId: "companies", actions: ["view", "create", "edit", "assign", "archive", "restore", "merge", "bulk_actions", "export", "view_financial_fields"] },
        { moduleId: "activities", actions: ["view", "create", "edit", "assign", "archive", "restore", "bulk_actions"] },
        { moduleId: "notes", actions: ["view", "create", "edit", "archive"] },
        { moduleId: "tags", actions: ["view", "create", "edit", "archive"] },
        { moduleId: "pipeline", actions: ["view", "create", "edit", "archive", "restore", "reorder"] },
        { moduleId: "deals", actions: ["view", "create", "edit", "assign", "transition", "close", "reopen", "archive", "restore", "bulk_actions", "view_financial_fields"] },
        { moduleId: "products_services", actions: ["view", "create", "edit", "archive", "restore", "view_financial_fields"] },
        { moduleId: "price_books", actions: ["view", "create", "edit", "archive", "restore"] },
        { moduleId: "quotes", actions: ["view", "create", "edit", "submit", "approve", "reject", "issue", "accept", "cancel", "archive", "restore", "bulk_actions", "override_pricing", "view_financial_fields"] },
        { moduleId: "orders", actions: ["view", "create", "edit", "confirm", "cancel", "fulfill", "archive", "restore", "bulk_actions"] },
        { moduleId: "contracts", actions: ["view", "create", "edit", "approve", "activate", "renew", "terminate", "manage_obligations", "archive", "restore", "bulk_actions"] },
        { moduleId: "sales_reports", actions: ["view", "view_forecast"] },
        { moduleId: "tickets", actions: ["view", "create", "edit", "assign", "reply", "escalate", "resolve", "close", "reopen"] },
        { moduleId: "projects", actions: ["view", "create", "edit", "assign"] },
        { moduleId: "tasks", actions: ["view", "create", "edit", "assign"] },
      ],
    },
    {
      key: "team_leader", name: "Department Manager", defaultScope: "Department", purpose: "Manages employees and records within one department.",
      permissionGrants: [
        { moduleId: "members", actions: ["view"] },
        // Department-scoped — the actual department filter is applied by
        // the controller using this role's defaultScope, not by the grant
        // itself (permissionGrants only ever says WHICH actions, never
        // WHICH records; scope is a separate dimension on the Role).
        { moduleId: "leads", actions: ["view", "create", "edit", "assign", "archive"] },
        { moduleId: "contacts", actions: ["view", "create", "edit", "assign", "archive"] },
        { moduleId: "companies", actions: ["view", "create", "edit", "assign", "archive"] },
        { moduleId: "activities", actions: ["view", "create", "edit", "assign", "archive", "restore"] },
        { moduleId: "notes", actions: ["view", "create", "edit"] },
        { moduleId: "tags", actions: ["view", "edit"] },
        // Sales Manager-equivalent: full deal lifecycle within their
        // department, no override_pricing/approve (separation of duties
        // keeps Quote approval with Organization Administrator+), no
        // Pipeline structural changes (create/archive) or Contract
        // activation/termination.
        { moduleId: "pipeline", actions: ["view", "edit", "reorder"] },
        { moduleId: "deals", actions: ["view", "create", "edit", "assign", "transition", "close", "reopen", "archive"] },
        { moduleId: "products_services", actions: ["view"] },
        { moduleId: "price_books", actions: ["view"] },
        { moduleId: "quotes", actions: ["view", "create", "edit", "submit", "accept", "cancel"] },
        { moduleId: "orders", actions: ["view", "create", "edit", "confirm", "cancel"] },
        { moduleId: "contracts", actions: ["view", "create", "edit"] },
        { moduleId: "sales_reports", actions: ["view"] },
        // Support supervisor-equivalent: works and routes tickets, can reopen.
        { moduleId: "tickets", actions: ["view", "create", "edit", "assign", "reply", "escalate", "resolve", "close", "reopen"] },
        // Project manager-equivalent: runs projects and hands out tasks.
        { moduleId: "projects", actions: ["view", "create", "edit", "assign"] },
        { moduleId: "tasks", actions: ["view", "create", "edit", "assign"] },
      ],
    },
    {
      key: "checker", name: "Auditor / Checker", defaultScope: "Organization", purpose: "Performs independent review and compliance checking.",
      permissionGrants: [
        { moduleId: "organizations", actions: ["view"] },
        { moduleId: "members", actions: ["view"] },
        { moduleId: "invitations", actions: ["view"] },
        { moduleId: "invite_links", actions: ["view"] },
        { moduleId: "sessions", actions: ["view"] },
        { moduleId: "audit_events", actions: ["view"] },
        // Read-only by design — no grant below ever includes create/edit/
        // assign/archive/restore/convert/merge/bulk_actions.
        { moduleId: "leads", actions: ["view", "view_audit_history"] },
        { moduleId: "contacts", actions: ["view", "view_audit_history"] },
        { moduleId: "companies", actions: ["view", "view_audit_history"] },
        { moduleId: "activities", actions: ["view", "view_audit_history"] },
        { moduleId: "notes", actions: ["view"] },
        { moduleId: "tags", actions: ["view"] },
        { moduleId: "pipeline", actions: ["view", "view_audit_history"] },
        { moduleId: "deals", actions: ["view", "view_audit_history"] },
        { moduleId: "products_services", actions: ["view"] },
        { moduleId: "price_books", actions: ["view"] },
        { moduleId: "quotes", actions: ["view", "view_audit_history"] },
        { moduleId: "orders", actions: ["view", "view_audit_history"] },
        { moduleId: "contracts", actions: ["view", "view_audit_history"] },
        { moduleId: "sales_reports", actions: ["view", "view_forecast"] },
        { moduleId: "tickets", actions: ["view", "view_audit_history"] },
        { moduleId: "projects", actions: ["view", "view_audit_history"] },
        { moduleId: "tasks", actions: ["view", "view_audit_history"] },
      ],
    },
    {
      key: "user", name: "Standard Employee", defaultScope: "Own", purpose: "Provides ordinary employee self-service.",
      permissionGrants: [
        // Own/Assigned-scoped (see defaultScope above) — a Sales
        // Representative sees and edits only records they own, are
        // assigned to, or are explicitly shared with, per the spec.
        { moduleId: "leads", actions: ["view", "create", "edit"] },
        { moduleId: "contacts", actions: ["view", "create", "edit"] },
        { moduleId: "companies", actions: ["view", "create", "edit"] },
        { moduleId: "activities", actions: ["view", "create", "edit"] },
        { moduleId: "notes", actions: ["view", "create", "edit"] },
        { moduleId: "tags", actions: ["view", "edit"] },
        // Sales Representative-equivalent: may create/edit/submit their own
        // Deals and Quotes, but must not approve a Quote (separation of
        // duties is enforced in code regardless, but this role also never
        // gets the "approve" grant at all) and must not confirm Orders or
        // activate/terminate Contracts.
        { moduleId: "pipeline", actions: ["view"] },
        { moduleId: "deals", actions: ["view", "create", "edit", "transition", "close", "reopen"] },
        { moduleId: "products_services", actions: ["view"] },
        { moduleId: "price_books", actions: ["view"] },
        { moduleId: "quotes", actions: ["view", "create", "edit", "submit", "accept", "cancel"] },
        { moduleId: "orders", actions: ["view", "create", "edit"] },
        { moduleId: "contracts", actions: ["view"] },
        { moduleId: "sales_reports", actions: ["view"] },
        // Agent-equivalent: works tickets they created or are assigned (Own scope).
        { moduleId: "tickets", actions: ["view", "create", "edit", "reply", "escalate", "resolve", "close"] },
        // Team member-equivalent: sees projects they're part of, works their
        // own tasks (status, comments, time) and can add tasks there; can't
        // start projects or reassign work.
        { moduleId: "projects", actions: ["view"] },
        { moduleId: "tasks", actions: ["view", "create", "edit"] },
      ],
    },
  ];
  for (const def of roleDefs) {
    const role = await prisma.role.upsert({
      where: { key: def.key },
      update: { permissionGrants: def.permissionGrants },
      create: { ...def, type: "Built-in", isBuiltIn: true, allowedScopes: [def.defaultScope], status: "Active" },
    });
    const userForRole = { super_admin: owner, admin, team_leader: teamlead, checker, user: salesUser }[def.key];
    if (userForRole) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: userForRole.id, roleId: role.id } },
        update: {},
        create: { userId: userForRole.id, roleId: role.id },
      });
    }
  }
  console.log(`Seeded ${roleDefs.length} built-in roles`);

  // One dev organization with every seeded user as an Active member holding
  // their matching built-in role — every /crm/* and /sales/* route requires
  // an organizationId backed by a live membership, so without this the
  // frontend's backend mode would have nothing to scope its requests to.
  const devOrg = await prisma.organization.upsert({
    where: { slug: "caspira-dev" },
    update: {},
    create: { name: "Caspira Dev", slug: "caspira-dev", createdByUserId: owner.id },
  });
  const rolesByKey = Object.fromEntries((await prisma.role.findMany({ where: { key: { in: roleDefs.map((d) => d.key) } } })).map((r) => [r.key, r]));
  const membershipRoleFor = [[owner, "super_admin"], [admin, "admin"], [teamlead, "team_leader"], [checker, "checker"], [salesUser, "user"]];
  for (const [user, roleKey] of membershipRoleFor) {
    const membership = await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: devOrg.id, userId: user.id } },
      update: {},
      create: { organizationId: devOrg.id, userId: user.id, status: "Active", joinedAt: new Date() },
    });
    await prisma.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: rolesByKey[roleKey].id } },
      update: {},
      create: { membershipId: membership.id, roleId: rolesByKey[roleKey].id, assignedByUserId: owner.id },
    });
  }
  console.log(`Seeded organization "${devOrg.name}" (${devOrg.id}) with ${membershipRoleFor.length} members`);

  // A small amount of sample CRM/Sales data so the backend is testable
  // end-to-end without hand-creating everything through the UI first.
  const company = await prisma.company.upsert({
    where: { id: "seed-company-1" },
    update: {},
    create: { id: "seed-company-1", name: "Bednar and Sons", industry: "Manufacturing", website: "https://bednarsons.example", ownerId: teamlead.id },
  });
  const contact = await prisma.contact.upsert({
    where: { id: "seed-contact-1" },
    update: {},
    create: { id: "seed-contact-1", name: "Florian Gleason", email: "florian@bednarsons.example", companyId: company.id, isPrimary: true, ownerId: teamlead.id },
  });
  const deal = await prisma.deal.upsert({
    where: { id: "seed-deal-1" },
    update: {},
    create: { id: "seed-deal-1", name: "Bednar and Sons — Platform Rollout", stage: "Proposal", companyId: company.id, primaryContactId: contact.id, ownerId: teamlead.id, value: 48000 },
  });
  const product = await prisma.catalogItem.upsert({
    where: { id: "seed-product-1" },
    update: {},
    create: { id: "seed-product-1", name: "Platform Subscription", type: "Service", status: "Active", billingModel: "Recurring", billingInterval: "Monthly", standardPrice: 2500, ownerId: admin.id },
  });

  console.log("Seeded sample Company, Contact, Deal, and Product:", { company: company.name, contact: contact.name, deal: deal.name, product: product.name });
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
