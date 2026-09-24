// Backend Phase 8 — the Provider Simulator as its own service:
//
//   npm run simulator            (port INTEGRATIONS_SIMULATOR_PORT, default 4600)
//
// Point the API at it with INTEGRATIONS_SIMULATOR_URL=http://localhost:4600/simulator.
// Without that variable the API serves the same simulator in-process at
// /api/v1/integrations/simulator (simulator mode, outside production only).
// It never contacts a real provider. Refuses to start in production.
import express from "express";
import simulatorRouter from "../src/integrations/simulators/simulatorRouter.js";
import { SIMULATOR_LABEL } from "../src/integrations/simulators/simulatorCore.js";

if (process.env.NODE_ENV === "production") {
  console.error("The provider simulator doesn't run in production.");
  process.exit(1);
}

const port = Number(process.env.INTEGRATIONS_SIMULATOR_PORT) || 4600;
const host = process.env.INTEGRATIONS_SIMULATOR_HOST || "127.0.0.1";
const app = express();
app.disable("x-powered-by");
app.get("/health", (_req, res) => res.json({ ok: true, label: SIMULATOR_LABEL }));
app.use("/simulator", simulatorRouter);
app.listen(port, host, () => console.log(`${SIMULATOR_LABEL}\nListening on http://${host}:${port}/simulator`));
