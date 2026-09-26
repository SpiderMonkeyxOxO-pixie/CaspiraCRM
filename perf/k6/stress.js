// Stress test (staging or isolated only): steps beyond expected traffic —
// 125, 150, 200 users — then drops back to 25 to confirm recovery.
// Watch the monitoring snapshot for the first saturated resource.
//   k6 run perf/k6/stress.js
import { defineScenario } from "./lib/scenario.js";

if (!["staging", "isolated"].includes(__ENV.PERF_TARGET)) throw new Error("Stress tests run only with PERF_TARGET=staging or isolated.");
const hold = __ENV.HOLD || "8m";
const s = defineScenario("stress", {
  executor: "ramping-vus", startVUs: 0,
  stages: [
    { duration: "5m", target: 100 }, { duration: hold, target: 100 },
    { duration: "2m", target: 125 }, { duration: hold, target: 125 },
    { duration: "2m", target: 150 }, { duration: hold, target: 150 },
    { duration: "3m", target: 200 }, { duration: hold, target: 200 },
    { duration: "2m", target: 25 }, { duration: "8m", target: 25 }, // recovery: latency must return to baseline
    { duration: "1m", target: 0 },
  ],
  gracefulRampDown: "30s",
});
export const options = s.options;
export default s.run;
export const handleSummary = s.handleSummary;
