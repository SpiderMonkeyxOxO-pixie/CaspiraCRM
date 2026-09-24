import "dotenv/config";
import app from "./app.js";
import prisma from "./lib/prisma.js";
import { assertVaultReady, integrationsMode } from "./integrations/credentials/vault.js";

// Backend Phase 8: the integration master key must be present (outside safe
// local simulator mode). Fail closed rather than start without it.
try {
  const ring = assertVaultReady();
  console.log(`Integrations: ${integrationsMode()} mode, key version ${ring.activeVersion}${ring.devKey ? " (simulator dev key — no live credentials)" : ""}`);
} catch (err) {
  console.error(`Integrations: ${err.message} Refusing to start.`);
  process.exit(1);
}

const port = process.env.PORT || 4000;

const server = app.listen(port, () => {
  console.log(`Caspira CRM API listening on port ${port}`);
});

// Graceful shutdown — Docker sends SIGTERM on `docker stop`/`compose down`;
// plain `node` (no shell wrapper) forwards it straight to this handler.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Don't hang forever waiting on in-flight requests.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
