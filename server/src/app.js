import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";

import authRoutes from "./routes/authRoutes.js";
import companyRoutes from "./routes/companyRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import leadRoutes from "./routes/leadRoutes.js";
import dealRoutes from "./routes/dealRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import priceBookRoutes from "./routes/priceBookRoutes.js";
import quoteRoutes from "./routes/quoteRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import contractRoutes from "./routes/contractRoutes.js";
import ticketRoutes from "./routes/ticketRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import taskRoutes from "./routes/taskRoutes.js";
import marketingRoutes from "./routes/marketingRoutes.js";
import financeRoutes from "./routes/financeRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import swaggerUi from "swagger-ui-express";
import { openapiSpec } from "./docs/openapi.js";
import auth2Routes from "./routes/auth2Routes.js";
import organizationRoutes from "./routes/organizationRoutes.js";
import publicInvitationRoutes from "./routes/invitationRoutes.js";
import publicJoinRoutes from "./routes/inviteLinkRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { correlationId } from "./middleware/correlationId.js";
import prisma from "./lib/prisma.js";
import redis from "./lib/redis.js";
import { verifyMailerConnection } from "./lib/mailer.js";

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173", credentials: true }));
// 2mb (default is 100kb) — the AI gateway's Explore mode POSTs a batch of
// RBAC-scoped records that can exceed the default limit.
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(correlationId);
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
app.use("/api/v1/crm/deals", dealRoutes);
app.use("/api/v1/crm/activities", activityRoutes);
app.use("/api/v1/sales/products", productRoutes);
app.use("/api/v1/sales/price-books", priceBookRoutes);
app.use("/api/v1/sales/quotes", quoteRoutes);
app.use("/api/v1/sales/orders", orderRoutes);
app.use("/api/v1/sales/contracts", contractRoutes);
app.use("/api/v1/support/tickets", ticketRoutes);
app.use("/api/v1/projects", projectRoutes);
app.use("/api/v1/tasks", taskRoutes);
app.use("/api/v1/marketing", marketingRoutes);
app.use("/api/v1/finance", financeRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/ai", aiRoutes); // AI gateway — Anthropic/OpenAI/OpenRouter, auth-only, no CRUD

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
