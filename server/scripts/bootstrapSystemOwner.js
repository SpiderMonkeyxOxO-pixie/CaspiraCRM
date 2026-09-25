// One-time System Owner bootstrap — deliberately separate from
// prisma/seed.js's dev-convenience seed data (which hardcodes a fixed
// "Caspira123!" password for 5 sample accounts and is meant for local
// development only, never production).
//
// Requirements this satisfies (Backend Phase 1 spec):
// - Runs only when no System Owner (User.role === "Super-Admin") exists yet.
// - Must be explicitly enabled: ALLOW_SYSTEM_OWNER_BOOTSTRAP=true.
// - No known default password — BOOTSTRAP_OWNER_PASSWORD must be set by
//   whoever runs this; there is no fallback value anywhere in this file.
// - Idempotent — running it again after a System Owner already exists is a
//   safe no-op, not an error and not a second owner.
// - Ordinary invitation/invite-link acceptance can NEVER create a second
//   System Owner (enforced separately in middleware/rbac.js's
//   canGrantRole() — this script is the only place a Super-Admin row is
//   ever created outside of prisma/seed.js's dev fixtures).
import "dotenv/config";
import "../src/config/applyEnv.js";
import { pathToFileURL } from "node:url";
import prisma from "../src/lib/prisma.js";
import { hashPassword } from "../src/utils/password.js";

export async function main() {
  // Every guard below `return`s immediately after `process.exit(...)` —
  // deliberately, not just for style. A test (or any caller) that mocks/
  // stubs process.exit to observe the exit code must not also fall through
  // into the next guard as if the first one never fired.
  if (process.env.ALLOW_SYSTEM_OWNER_BOOTSTRAP !== "true") {
    console.log("ALLOW_SYSTEM_OWNER_BOOTSTRAP is not \"true\" — refusing to run. This is intentional outside a deliberate one-time bootstrap.");
    process.exit(1);
    return;
  }

  const existingOwner = await prisma.user.findFirst({ where: { role: "Super-Admin" } });
  if (existingOwner) {
    console.log(`A System Owner already exists (${existingOwner.email}) — bootstrap is a no-op. Re-running this script never creates a second one.`);
    process.exit(0);
    return;
  }

  const email = process.env.BOOTSTRAP_OWNER_EMAIL;
  const username = process.env.BOOTSTRAP_OWNER_USERNAME;
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
  const name = process.env.BOOTSTRAP_OWNER_NAME || "System Owner";

  if (!email || !username || !password) {
    console.error("BOOTSTRAP_OWNER_EMAIL, BOOTSTRAP_OWNER_USERNAME and BOOTSTRAP_OWNER_PASSWORD are all required — no default credentials exist for this step.");
    process.exit(1);
    return;
  }
  if (process.env.NODE_ENV === "production" && password.length < 12) {
    console.error("BOOTSTRAP_OWNER_PASSWORD is too short for a production bootstrap (minimum 12 characters).");
    process.exit(1);
    return;
  }

  const passwordHash = await hashPassword(password);
  const owner = await prisma.user.create({
    data: { name, fullName: name, username, email: email.toLowerCase(), passwordHash, role: "Super-Admin", status: "Active", emailVerifiedAt: new Date() },
  });

  console.log(`System Owner created: ${owner.email} (${owner.username}). Store the password you set somewhere safe — it is never printed or logged.`);
  process.exit(0);
}

// Only self-invoke when run as a script (`node scripts/bootstrapSystemOwner.js`)
// — a test importing this module for main() should be able to await it
// directly rather than racing an un-awaited top-level self-invocation.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Bootstrap failed:", err.message);
    process.exit(1);
  });
}
