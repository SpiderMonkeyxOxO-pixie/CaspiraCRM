// Creates/refreshes the five built-in roles and nothing else — no sample
// users, organizations or records. This is the production counterpart of
// prisma/seed.js (whose dev accounts share a public password and must never
// reach production). Safe to re-run: after a deploy that adds permission
// grants, running it again brings the built-in roles up to date.
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { BUILT_IN_ROLES, upsertBuiltInRoles } from "../prisma/builtInRoles.js";

try {
  await upsertBuiltInRoles(prisma);
  console.log(`Built-in roles up to date: ${BUILT_IN_ROLES.map((r) => r.name).join(", ")}.`);
} catch (err) {
  console.error("Seeding roles failed:", err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
