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
        { moduleId: "activities", actions: ["view", "create", "edit", "assign", "archive", "bulk_actions"] },
        { moduleId: "notes", actions: ["view", "create", "edit", "archive"] },
        { moduleId: "tags", actions: ["view", "edit"] },
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
        { moduleId: "activities", actions: ["view", "create", "edit", "assign", "archive", "bulk_actions"] },
        { moduleId: "notes", actions: ["view", "create", "edit", "archive"] },
        { moduleId: "tags", actions: ["view", "edit"] },
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
        { moduleId: "activities", actions: ["view", "create", "edit", "assign", "archive"] },
        { moduleId: "notes", actions: ["view", "create", "edit"] },
        { moduleId: "tags", actions: ["view"] },
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
        { moduleId: "tags", actions: ["view"] },
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
