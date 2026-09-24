// Backend Phase 11 — Prometheus text metrics for the optional observability
// profile (docker compose --profile observability). Aggregates only: no
// prompts, record labels, user names or organization names. Protected by
// METRICS_TOKEN when set; otherwise only reachable from loopback/private
// networks (the Docker network or the host).
import prisma from "../../lib/prisma.js";
import { computeMetrics } from "./monitoring.js";

let cached = { at: 0, body: "" };
const TTL_MS = 30_000;
const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:127\.|::ffff:10\.|::ffff:192\.168\.|::ffff:172\.)/;

const line = (name, help, type, samples) => [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...samples.map(([labels, v]) => `${name}${labels ? `{${Object.entries(labels).map(([k, x]) => `${k}="${String(x).replace(/"/g, "")}"`).join(",")}}` : ""} ${Number.isFinite(v) ? v : 0}`)].join("\n");

async function build() {
  const m = await computeMetrics(null, { from: new Date(Date.now() - 15 * 60_000) });
  const [switches, incidents, alerts, runs, slos] = await Promise.all([
    prisma.aiKillSwitch.groupBy({ by: ["kind"], where: { active: true }, _count: { _all: true } }),
    prisma.aiIncident.groupBy({ by: ["severity"], where: { status: { notIn: ["Resolved", "Closed"] } }, _count: { _all: true } }),
    prisma.aiAlertEvent.groupBy({ by: ["severity"], where: { status: { in: ["Open", "Acknowledged"] } }, _count: { _all: true } }),
    prisma.aiEvalRun.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.aiSloDefinition.findMany({ where: { active: true } }),
  ]);
  const sloRows = await Promise.all(slos.map(async (d) => [d.key, await prisma.aiSloMeasurement.findFirst({ where: { sloId: d.id }, orderBy: { windowEnd: "desc" } })]));
  return [
    line("caspira_ai_requests_15m", "AI requests in the last 15 minutes", "gauge", [[{ outcome: "total" }, m.requests.total], [{ outcome: "completed" }, m.requests.completed], [{ outcome: "failed" }, m.requests.failed], [{ outcome: "refused" }, m.requests.refused]]),
    line("caspira_ai_availability_percent", "Gateway availability (15 min)", "gauge", [[null, m.availability ?? 100]]),
    line("caspira_ai_provider_error_rate_percent", "Provider error rate (15 min)", "gauge", [[null, m.providerErrorRate ?? 0]]),
    line("caspira_ai_latency_p95_ms", "p95 request latency (15 min)", "gauge", [[null, m.latency.p95Ms ?? 0]]),
    line("caspira_ai_estimated_cost_usd_15m", "Estimated provider cost (not an invoice), 15 min", "gauge", [[null, m.cost.estimated]]),
    line("caspira_ai_tokens_15m", "Provider-reported tokens (15 min)", "gauge", [[{ direction: "input" }, m.tokens.input], [{ direction: "output" }, m.tokens.output]]),
    line("caspira_ai_safety_events_15m", "Safety events by severity (15 min, excluding evaluations)", "gauge", Object.entries(m.safety.bySeverity).map(([k, v]) => [{ severity: k }, v])),
    line("caspira_ai_kill_switches_active", "Active kill switches by kind", "gauge", switches.map((s) => [{ kind: s.kind }, s._count._all])),
    line("caspira_ai_incidents_open", "Open AI incidents by severity", "gauge", incidents.map((i) => [{ severity: i.severity }, i._count._all])),
    line("caspira_ai_alerts_open", "Open AI alerts by severity", "gauge", alerts.map((a) => [{ severity: a.severity }, a._count._all])),
    line("caspira_ai_evaluation_runs", "Evaluation runs by status", "gauge", runs.map((r) => [{ status: r.status }, r._count._all])),
    line("caspira_ai_slo_met", "Latest SLO status (1 met, 0 missed, -1 insufficient data)", "gauge", sloRows.map(([k, s]) => [{ slo: k }, !s ? -1 : s.status === "Met" ? 1 : s.status === "Missed" ? 0 : -1])),
  ].join("\n") + "\n";
}

export async function metricsHandler(req, res) {
  const token = process.env.METRICS_TOKEN;
  if (token) { if (req.get("authorization") !== `Bearer ${token}`) return res.status(401).end(); }
  else if (!PRIVATE.test(req.ip || req.socket?.remoteAddress || "")) return res.status(403).end();
  try {
    if (Date.now() - cached.at > TTL_MS) cached = { at: Date.now(), body: await build() };
    res.set("Content-Type", "text/plain; version=0.0.4").send(cached.body);
  } catch {
    res.status(503).send("# metrics unavailable\n");
  }
}
