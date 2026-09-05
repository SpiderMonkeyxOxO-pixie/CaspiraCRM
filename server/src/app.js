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
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173", credentials: true }));
// 2mb (default is 100kb) — the AI gateway's Explore mode POSTs a batch of
// RBAC-scoped records that can exceed the default limit.
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(morgan("dev"));

app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));

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

app.use((req, res) => res.status(404).json({ message: `No route for ${req.method} ${req.originalUrl}` }));
app.use(errorHandler);

export default app;
