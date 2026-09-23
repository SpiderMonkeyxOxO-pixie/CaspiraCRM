import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { BUILT_IN_ROLES } from "./builtInRoles.js";

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
    // Backend Phase 6: Finance roles, so separation of duties can be exercised.
    prisma.user.upsert({
      where: { username: "finance" },
      update: {},
      create: { name: "Farah Finance", fullName: "Farah Finance", username: "finance", email: "finance@caspira.example", passwordHash: password, role: "User", department: "Finance" },
    }),
    prisma.user.upsert({
      where: { username: "accountant" },
      update: {},
      create: { name: "Arun Accountant", fullName: "Arun Accountant", username: "accountant", email: "accountant@caspira.example", passwordHash: password, role: "User", department: "Finance" },
    }),
  ]);
  const [owner, admin, teamlead, checker, salesUser, financeManager, accountant] = users;
  console.log(`Seeded ${users.length} users (password for all: Caspira123!)`);

  // Built-in role definitions live in ./builtInRoles.js.
  const roleDefs = BUILT_IN_ROLES;
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
  const membershipRoleFor = [[owner, "super_admin"], [admin, "admin"], [teamlead, "team_leader"], [checker, "checker"], [salesUser, "user"], [financeManager, "finance_manager"], [accountant, "accountant"]];
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
