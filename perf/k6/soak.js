// Soak test (staging only): expected traffic held for hours to expose slow
// leaks — memory, connections, file handles, queue build-up, disk and log
// growth, scheduler drift, latency creeping up.
//   TARGET_VUS=50 SOAK=4h k6 run perf/k6/soak.js
import { defineScenario, envInt } from "./lib/scenario.js";

if (!["staging", "isolated"].includes(__ENV.PERF_TARGET)) throw new Error("Soak tests run only with PERF_TARGET=staging or isolated.");
const target = envInt("TARGET_VUS", 50);
const s = defineScenario(`soak-${target}`, {
  executor: "ramping-vus", startVUs: 0,
  stages: [{ duration: "10m", target }, { duration: __ENV.SOAK || "4h", target }, { duration: "5m", target: 0 }],
  gracefulRampDown: "30s",
});
export const options = s.options;
export default s.run;
export const handleSummary = s.handleSummary;
