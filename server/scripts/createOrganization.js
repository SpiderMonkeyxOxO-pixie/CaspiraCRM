// Creates an organization and makes an existing user its Organization
// Administrator — the same records POST /organizations creates for its
// caller. There's no page for this yet, so it's how the first production
// organization gets made (in development, prisma/seed.js creates
// "Caspira Dev").
//
//   node scripts/createOrganization.js "<Organization name>" <username or email>
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { uniqueSlug } from "../src/controllers/organizationsController.js";
import { recordAuditEvent } from "../src/services/auditService.js";

const [name, login] = process.argv.slice(2);

try {
  if (!name?.trim() || !login) throw new Error('Usage: node scripts/createOrganization.js "<Organization name>" <username or email>');
  const user = await prisma.user.findFirst({ where: { OR: [{ username: login }, { email: login.toLowerCase() }] } });
  if (!user) throw new Error(`No user "${login}" — run scripts/bootstrapSystemOwner.js first.`);
  const adminRole = await prisma.role.findUnique({ where: { key: "admin" } });
  if (!adminRole) throw new Error("Built-in roles are missing — run scripts/seedRoles.js first.");
  if (await prisma.organization.findFirst({ where: { name: name.trim() } })) throw new Error(`An organization named "${name.trim()}" already exists.`);

  const slug = await uniqueSlug(name);
  const organization = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: name.trim(), slug, createdByUserId: user.id } });
    const membership = await tx.organizationMembership.create({ data: { organizationId: org.id, userId: user.id, status: "Active", joinedAt: new Date() } });
    await tx.membershipRole.create({ data: { membershipId: membership.id, roleId: adminRole.id, assignedByUserId: user.id } });
    return org;
  });
  await recordAuditEvent({ actorUserId: user.id, organizationId: organization.id, action: "organization.created", targetType: "Organization", targetId: organization.id, result: "Success" });
  console.log(`Created "${organization.name}" (${organization.id}); ${user.username} is its Organization Administrator.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
