// Spike test (staging or isolated only): normal traffic, then a sudden
// jump (shift start / mass sign-in: every new user logs in at once), then
// back to normal to confirm recovery without errors or corrupted data.
//   SPIKE_VUS=150 k6 run perf/k6/spike.js
import { defineScenario, envInt } from "./lib/scenario.js";

if (!["staging", "isolated"].includes(__ENV.PERF_TARGET)) throw new Error("Spike tests run only with PERF_TARGET=staging or isolated.");
const base = envInt("BASE_VUS", 25), spike = envInt("SPIKE_VUS", 150);
const s = defineScenario("spike", {
  executor: "ramping-vus", startVUs: 0,
  stages: [
    { duration: "2m", target: base }, { duration: "3m", target: base },
    { duration: "30s", target: spike }, { duration: "3m", target: spike },
    { duration: "30s", target: base }, { duration: "6m", target: base },
    { duration: "1m", target: 0 },
  ],
  gracefulRampDown: "30s",
});
export const options = s.options;
export default s.run;
export const handleSummary = s.handleSummary;
