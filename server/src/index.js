import "dotenv/config";
import "./config/load.js"; // Backend Phase 13 — secrets and fail-closed configuration, before any client is created
import app from "./app.js";
import prisma from "./lib/prisma.js";
import redis from "./lib/redis.js";
import { assertVaultReady, integrationsMode } from "./integrations/credentials/vault.js";
import { aiMode, assertAiModeSafe } from "./ai/common/mode.js";

// Backend Phase 8: the integration master key must be present (outside safe
// local simulator mode). Fail closed rather than start without it.
try {
  const ring = assertVaultReady();
  console.log(`Integrations: ${integrationsMode()} mode, key version ${ring.activeVersion}${ring.devKey ? " (simulator dev key — no live credentials)" : ""}`);
} catch (err) {
  console.error(`Integrations: ${err.message} Refusing to start.`);
  process.exit(1);
}

// Backend Phase 9: AI keys use the same vault; the AI simulator is refused in production.
try {
  assertAiModeSafe();
  console.log(`AI: ${aiMode()} mode${aiMode() === "simulator" ? " (AI Provider Simulator — no external AI provider is connected)" : ""}`);
} catch (err) {
  console.error(`AI: ${err.message} Refusing to start.`);
  process.exit(1);
}

const port = process.env.PORT || 4000;

const server = app.listen(port, () => {
  console.log(`Caspira CRM API listening on port ${port}`);
});
// Backend Phase 13 — slow-client protection: bounded time to send headers
// and the whole request; keep-alive shorter than the proxy's upstream timeout.
server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS) || 20_000;
server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS) || 300_000;
server.keepAliveTimeout = Number(process.env.HTTP_KEEPALIVE_TIMEOUT_MS) || 65_000;

// Graceful shutdown — Docker sends SIGTERM on `docker stop`/`compose down`;
// plain `node` (no shell wrapper) forwards it straight to this handler.
// In-flight requests finish (new connections are refused), idle keep-alive
// sockets close, then the database and Redis connections are released.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    await redis.quit().catch(() => {});
    process.exit(0);
  });
  server.closeIdleConnections?.();
  // Don't hang forever waiting on in-flight requests.
  setTimeout(() => process.exit(1), Number(process.env.SHUTDOWN_GRACE_MS) || 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Backend Phase 13 — watchdog: the API process evaluates the worker-heartbeat
// alert, so a dead worker is still detected (the worker can't report itself).
import("./platform/jobs.js").then(({ runPlatformJob }) => import("./platform/alerts.js").then(({ evaluateAlerts }) => {
  if (process.env.APP_ENV === "test" || process.env.PLATFORM_WATCHDOG === "false") return;
  setInterval(() => {
    runPlatformJob("alerts.watchdog", () => evaluateAlerts({ only: ["worker_heartbeat_age_seconds"] }), { timeoutMs: 30_000, retries: 0 }).catch(() => {});
  }, 60_000).unref();
})).catch(() => {});
