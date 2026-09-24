import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";

import authRoutes from "./routes/authRoutes.js";
import companyRoutes from "./routes/crm/companyRoutes.js"; // Backend Phase 2 — replaces the pre-Phase-2, non-org-scoped placeholder
import contactRoutes from "./routes/crm/contactRoutes.js"; // Backend Phase 2 — replaces the pre-Phase-2, non-org-scoped placeholder
import leadRoutes from "./routes/crm/leadRoutes.js"; // Backend Phase 2 — replaces the pre-Phase-2, non-org-scoped placeholder
import dealRoutes from "./routes/sales/dealRoutes.js"; // Backend Phase 3 — replaces the pre-Phase-3, non-org-scoped placeholder
import activityRoutes from "./routes/crm/activityRoutes.js"; // Backend Phase 2 — replaces the pre-Phase-2, non-org-scoped placeholder
import noteRoutes from "./routes/crm/noteRoutes.js"; // Backend Phase 2 — new
import tagRoutes from "./routes/crm/tagRoutes.js"; // Backend Phase 2 — new
import pipelineRoutes from "./routes/sales/pipelineRoutes.js"; // Backend Phase 3 — new
import reportRoutes from "./routes/sales/reportRoutes.js"; // Backend Phase 3 — new
import productRoutes from "./routes/sales/catalogRoutes.js"; // Backend Phase 3 — replaces the pre-Phase-3, non-org-scoped placeholder
import priceBookRoutes from "./routes/sales/priceBookRoutes.js"; // Backend Phase 3 — replaces the pre-Phase-3, non-org-scoped placeholder
import quoteRoutes from "./routes/sales/quoteRoutes.js"; // Backend Phase 3 — replaces the pre-Phase-3, non-org-scoped placeholder
import orderRoutes from "./routes/sales/orderRoutes.js"; // Backend Phase 3 — replaces the pre-Phase-3, non-org-scoped placeholder
import contractRoutes from "./routes/sales/contractRoutes.js"; // Backend Phase 3 — replaces the pre-Phase-3, non-org-scoped placeholder
import ticketRoutes from "./routes/support/ticketRoutes.js"; // Backend Phase 4 — replaces the pre-Phase-4, non-org-scoped placeholder
import portalRoutes from "./routes/portal/portalRoutes.js"; // Backend Phase 4 — Customer Portal (customer-only surface)
import supportSettingsRoutes from "./routes/support/supportSettingsRoutes.js"; // Backend Phase 4 (full spec) — inboxes, queues, categories, canned responses
import projectRoutes from "./routes/projects/projectRoutes.js"; // Backend Phase 5 — replaces the pre-Phase-5, non-org-scoped placeholders
import taskRoutes from "./routes/projects/taskRoutes.js";
import marketingRoutes from "./routes/marketingRoutes.js";
import financeRoutes from "./routes/finance/financeRoutes.js"; // Backend Phase 6 — replaces the pre-Phase-6, non-org-scoped placeholder
import adminRoutes from "./routes/adminRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import swaggerUi from "swagger-ui-express";
import { openapiSpec } from "./docs/openapi.js";
import auth2Routes from "./routes/auth2Routes.js";
import organizationRoutes from "./routes/organizationRoutes.js";
import publicInvitationRoutes from "./routes/invitationRoutes.js";
import publicJoinRoutes from "./routes/inviteLinkRoutes.js";
import integrationRoutes from "./routes/integrations/integrationRoutes.js"; // Backend Phase 8
import simulatorRouter from "./integrations/simulators/simulatorRouter.js";
import { simulatorSafe } from "./integrations/credentials/vault.js";
import { inboundWebhookHandler } from "./integrations/api/webhooksController.js";
import { onAuditEvent } from "./services/auditService.js";
import { emitFromAudit } from "./integrations/outbound-webhooks/outboundService.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { correlationId } from "./middleware/correlationId.js";
import prisma from "./lib/prisma.js";
import redis from "./lib/redis.js";
import { verifyMailerConnection } from "./lib/mailer.js";

const app = express();

// Behind a reverse proxy (nginx in production), req.ip would otherwise be
// the proxy's own address for every visitor — sharing one login rate-limit
// bucket between all users and hiding real client IPs from audit events.
// TRUST_PROXY is the number of proxy hops in front of the api (1 for a
// single nginx); unset in local development.
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173", credentials: true }));
// Backend Phase 8 — inbound provider webhooks need the RAW body (signatures
// are computed over the exact bytes), so this route is mounted before the
// JSON parser, with its own size limit. No session auth: the unguessable
// callback id plus the provider signature are the authentication.
app.post("/api/v1/integrations/webhooks/:providerKey/:callbackId", express.raw({ type: () => true, limit: "256kb" }), inboundWebhookHandler);
// Outbound CRM webhooks are fed by the audit trail.
onAuditEvent(emitFromAudit);

// 2mb (default is 100kb) — the AI gateway's Explore mode POSTs a batch of
// RBAC-scoped records that can exceed the default limit.
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(correlationId);
// Integration URLs carry OAuth codes and state in the query string: the
// request log never records them (Backend Phase 8).
morgan.token("url", (req) => (req.originalUrl.startsWith("/api/v1/integrations/") ? req.originalUrl.split("?")[0] : req.originalUrl));
app.use(morgan("dev"));

// Plain liveness — Docker's HEALTHCHECK target (src/healthcheck.js). Only
// confirms the process is up and serving; no dependency checks here, so a
// slow/degraded Postgres or Redis never causes Docker to restart a
// perfectly-alive api container.
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));

// Readiness — checks every real dependency. Used by orchestration/monitoring
// to decide whether to route traffic here, not by Docker's own HEALTHCHECK.
app.get("/ready", async (_req, res) => {
  const checks = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (err) {
    checks.database = `error: ${err.message}`;
  }
  try {
    await redis.ping();
    checks.redis = "ok";
  } catch (err) {
    checks.redis = `error: ${err.message}`;
  }
  try {
    await verifyMailerConnection();
    checks.mailer = "ok";
  } catch (err) {
    checks.mailer = `error: ${err.message}`;
  }
  const ready = Object.values(checks).every((v) => v === "ok");
  res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", checks });
});

// Route paths mirror the frontend's existing mock endpoint paths exactly
// (see mockApi.js) so the already-built Redux thunks need zero changes.
app.use("/api/v1/user", authRoutes);
app.use("/api/v1/crm/companies", companyRoutes);
app.use("/api/v1/crm/contacts", contactRoutes);
app.use("/api/v1/crm/leads", leadRoutes);
app.use("/api/v1/sales/deals", dealRoutes);
app.use("/api/v1/crm/activities", activityRoutes);
app.use("/api/v1/crm/notes", noteRoutes);
app.use("/api/v1/crm/tags", tagRoutes);
app.use("/api/v1/sales/pipelines", pipelineRoutes);
app.use("/api/v1/sales/reports", reportRoutes);
app.use("/api/v1/sales/catalog", productRoutes);
app.use("/api/v1/sales/price-books", priceBookRoutes);
app.use("/api/v1/sales/quotes", quoteRoutes);
app.use("/api/v1/sales/orders", orderRoutes);
app.use("/api/v1/sales/contracts", contractRoutes);
app.use("/api/v1/support/tickets", ticketRoutes);
app.use("/api/v1/support", supportSettingsRoutes);
app.use("/api/v1/portal", portalRoutes);
app.use("/api/v1/projects", projectRoutes);
app.use("/api/v1/tasks", taskRoutes);
app.use("/api/v1/marketing", marketingRoutes);
app.use("/api/v1/finance", financeRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/ai", aiRoutes); // Backend Phase 9 — AI gateway, governance, usage, budgets, governed actions
// Backend Phase 8 — integrations gateway. The provider simulator is mounted
// only in local simulator mode, never in production.
if (simulatorSafe()) app.use("/api/v1/integrations/simulator", simulatorRouter);
app.use("/api/v1/integrations", integrationRoutes);

// Backend Phase 1 — session-based auth (httpOnly cookies, refresh
// rotation), organizations, RBAC, invitations. A new surface alongside the
// legacy /api/v1/user/* Bearer-JWT flow above, not a replacement for it.
app.use("/api/v1/auth", auth2Routes);
app.use("/api/v1/organizations", organizationRoutes);
app.use("/api/v1/invitations", publicInvitationRoutes);
app.use("/api/v1/join", publicJoinRoutes);

// OpenAPI docs for the Backend Phase 1 surface only (see docs/openapi.js's
// header comment for why the pre-existing legacy routes aren't included).
app.get("/api/v1/openapi.json", (_req, res) => res.json(openapiSpec));
app.use("/api/v1/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

app.use((req, res) => res.status(404).json({ message: `No route for ${req.method} ${req.originalUrl}` }));
app.use(errorHandler);

export default app;
