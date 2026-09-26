// Breakpoint test — ISOLATED ENVIRONMENT ONLY (PERF_TARGET=isolated): raises
// throughput until a limit is hit and stops there. The limit it finds is NOT
// safe production capacity; record the first resource that ran out.
//   MAX_RPS=150 k6 run perf/k6/breakpoint.js
import { defineScenario, envInt } from "./lib/scenario.js";

const s = defineScenario("breakpoint", {
  executor: "ramping-arrival-rate", startRate: 2, timeUnit: "1s",
  preAllocatedVUs: 50, maxVUs: envInt("MAX_VUS", 600),
  stages: [{ duration: __ENV.RAMP || "30m", target: envInt("MAX_RPS", 150) }],
}, {
  requireIsolated: true,
  abortOnFail: true,
  // Stop as soon as the service is clearly past its limit.
  extraThresholds: { http_req_failed: [{ threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "30s" }], http_req_duration: [{ threshold: "p(95)<3000", abortOnFail: true, delayAbortEval: "30s" }] },
});
export const options = s.options;
export default s.run;
export const handleSummary = s.handleSummary;
