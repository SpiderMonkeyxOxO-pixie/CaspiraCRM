// Loads the synthetic benchmark dataset into a NON-production database.
//
//   PERF_TARGET=staging PERF_DATABASE_CONFIRM=<database name> \
//   PERF_USER_PASSWORD=<password for the synthetic users> \
//   node scripts/perf/generateData.js --profile initial-production --seed 20260926 [--reset] [--out dataset.json] [--users-out load-users.json]
//
// Idempotent: rows have deterministic ids and are inserted with
// skipDuplicates, so a rerun only fills in what's missing. --reset first
// deletes this seed's organizations and users. The password is never
// written anywhere; every synthetic user shares one hash of it.
import "dotenv/config";
import fs from "node:fs";
import prisma from "../../src/lib/prisma.js";
import { hashPassword } from "../../src/utils/password.js";
import { passwordProblem } from "../../src/controllers/accountController.js";
import { assertPerfTarget } from "./guard.js";
import { getProfile, profileTotals } from "./profiles.js";
import { buildOrganization, organizationsFor, perfOrgSlug, PERF_EMAIL_DOMAIN } from "./plan.js";

// Insert order respects foreign keys; deletes run in reverse.
export const TABLE_ORDER = ["organization", "user", "organizationMembership", "membershipRole", "pipeline", "pipelineStage", "company", "contact", "lead", "deal", "activity", "ticket", "project", "task", "auditEvent"];
const BATCH = 1000;

function args(argv) {
  const out = { profile: "developer", seed: "20260926", reset: false, out: null, usersOut: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--profile") out.profile = argv[++i];
    else if (argv[i] === "--seed") out.seed = argv[++i];
    else if (argv[i] === "--reset") out.reset = true;
    else if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--users-out") out.usersOut = argv[++i];
  }
  if (!/^[a-z0-9]{1,20}$/.test(out.seed)) throw new Error("--seed must be 1–20 lowercase letters or digits.");
  return out;
}

async function reset(seed) {
  const orgs = await prisma.organization.findMany({ where: { slug: { startsWith: `perf-${seed}-o` } }, select: { id: true } });
  const orgIds = orgs.map((o) => o.id);
  for (const table of [...TABLE_ORDER].reverse()) {
    if (table === "organization" || table === "user" || table === "membershipRole") continue;
    await prisma[table].deleteMany({ where: { organizationId: { in: orgIds } } });
  }
  await prisma.membershipRole.deleteMany({ where: { membership: { organizationId: { in: orgIds } } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  const users = await prisma.user.deleteMany({ where: { username: { startsWith: `perf-${seed}-o` }, email: { endsWith: `.${PERF_EMAIL_DOMAIN}` } } });
  console.log(`Reset: removed ${orgIds.length} organizations and ${users.count} users for seed ${seed}.`);
}

async function main() {
  const { target, database } = assertPerfTarget();
  const opts = args(process.argv.slice(2));
  const profile = getProfile(opts.profile);
  const password = process.env.PERF_USER_PASSWORD || "";
  const weak = passwordProblem(password, null);
  if (weak) throw new Error(`PERF_USER_PASSWORD: ${weak}`);

  console.log(`Target ${target}, database ${database}. Profile ${opts.profile} (${profile.label}), seed ${opts.seed}.`);
  console.log("Planned totals:", JSON.stringify(profileTotals(opts.profile)));
  if (opts.reset) await reset(opts.seed);

  const roles = await prisma.role.findMany({ select: { id: true, key: true } });
  const roleIds = Object.fromEntries(roles.filter((r) => r.key).map((r) => [r.key, r.id]));
  if (!roleIds.admin) throw new Error("Built-in roles are missing — run scripts/seedRoles.js first.");
  const passwordHash = await hashPassword(password);

  const started = Date.now();
  const inserted = {};
  const loadUsers = [];
  for (const { index } of organizationsFor(profile)) {
    const { rows, tier, loadUsers: orgUsers } = buildOrganization({ seed: opts.seed, profile, index, roleIds, passwordHash });
    loadUsers.push(...orgUsers);
    for (const table of TABLE_ORDER) {
      const list = rows[table];
      for (let i = 0; i < list.length; i += BATCH) {
        const { count } = await prisma[table].createMany({ data: list.slice(i, i + BATCH), skipDuplicates: true });
        inserted[table] = (inserted[table] || 0) + count;
      }
    }
    console.log(`  ${perfOrgSlug(opts.seed, index)} (${tier}) done after ${Math.round((Date.now() - started) / 1000)} s`);
  }

  const manifest = {
    kind: "caspira-perf-dataset", profile: opts.profile, seed: opts.seed, target, database,
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000),
    planned: profileTotals(opts.profile), inserted,
  };
  console.log("Inserted (new rows only):", JSON.stringify(inserted));
  if (opts.out) fs.writeFileSync(opts.out, `${JSON.stringify(manifest, null, 2)}\n`);
  // For k6: who to sign in as (usernames and roles only — never the password).
  if (opts.usersOut) fs.writeFileSync(opts.usersOut, `${JSON.stringify({ seed: opts.seed, profile: opts.profile, users: loadUsers })}\n`);
}

if (process.argv[1]?.endsWith("generateData.js")) {
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
