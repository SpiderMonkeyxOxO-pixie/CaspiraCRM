// Turns k6's end-of-test summary into the structured result record the
// Backend Phase 14 result model asks for, written next to k6's own summary.
// Latency is always reported as percentiles, never as an average alone.
import { runMetadata, thresholdsDoc } from "./config.js";

const GROUPS = Object.keys(thresholdsDoc.latencyMs);

function trend(metric) {
  if (!metric) return null;
  const v = metric.values;
  return { p50: v["p(50)"] ?? v.med, p90: v["p(90)"], p95: v["p(95)"], p99: v["p(99)"], max: v.max };
}

export function buildResult(data, scenario) {
  const m = data.metrics;
  const reqs = m.http_reqs?.values.count || 0;
  const failedRate = m.http_req_failed?.values.rate || 0;
  const perGroup = {};
  for (const g of GROUPS) {
    const t = trend(m[`http_req_duration{group:${g}}`]);
    if (t) perGroup[g] = { ...t, thresholdP95: thresholdsDoc.latencyMs[g].p95, passed: t.p95 === undefined ? null : t.p95 < thresholdsDoc.latencyMs[g].p95 };
  }
  const thresholdResults = Object.fromEntries(Object.entries(m).filter(([, v]) => v.thresholds).map(([k, v]) => [k, Object.fromEntries(Object.entries(v.thresholds).map(([expr, r]) => [expr, !r.ok ? "failed" : "passed"]))]));
  return {
    kind: "caspira-perf-result",
    runId: __ENV.PERF_RUN_ID || `${scenario}-${new Date(data.state.testRunDurationMs ? Date.now() - data.state.testRunDurationMs : Date.now()).toISOString()}`,
    ...runMetadata(scenario),
    startedAt: new Date(Date.now() - (data.state.testRunDurationMs || 0)).toISOString(),
    endedAt: new Date().toISOString(),
    durationSeconds: Math.round((data.state.testRunDurationMs || 0) / 1000),
    maxVus: m.vus_max?.values.max || null,
    requests: { total: reqs, failed: Math.round(reqs * failedRate), successful: Math.round(reqs * (1 - failedRate)), ratePerSecond: m.http_reqs?.values.rate || 0 },
    errorRate: failedRate,
    unauthorizedResponses: m.unauthorized_responses?.values.count || 0,
    loginFailures: m.login_failures?.values.count || 0,
    latencyMs: { all: trend(m.http_req_duration), ...perGroup },
    dataReceivedBytes: m.data_received?.values.count || 0,
    dataSentBytes: m.data_sent?.values.count || 0,
    thresholdResults,
    // Server-side figures (database CPU, connections, cache hit rate, queue
    // depth, container restarts…) are added by perf/record-run.mjs from the
    // monitoring snapshot taken during the run.
    serverMetrics: null,
    bottlenecks: [],
    notes: __ENV.PERF_NOTES || "",
  };
}

export function summaryOutputs(data, scenario) {
  const result = buildResult(data, scenario);
  const dir = __ENV.PERF_RESULTS_DIR || "perf/results";
  return {
    [`${dir}/${result.runId}.json`]: JSON.stringify(result, null, 2),
    stdout: `\n${scenario}: ${result.requests.total} requests, error rate ${(result.errorRate * 100).toFixed(2)}%, p95 ${Math.round(result.latencyMs.all?.p95 || 0)} ms, p99 ${Math.round(result.latencyMs.all?.p99 || 0)} ms, unauthorized ${result.unauthorizedResponses}\n`,
  };
}
