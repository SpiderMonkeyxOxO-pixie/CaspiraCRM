// Average-load test: the expected number of users, ramped up gradually,
// held, then ramped down. Run once per level: TARGET_VUS=25, 50 and 100.
//   TARGET_VUS=50 k6 run perf/k6/average.js
import { defineScenario, envInt } from "./lib/scenario.js";

const target = envInt("TARGET_VUS", 25);
const s = defineScenario(`average-${target}`, {
  executor: "ramping-vus", startVUs: 0,
  stages: [
    { duration: __ENV.RAMP || "5m", target },
    { duration: __ENV.HOLD || "15m", target },
    { duration: "2m", target: 0 },
  ],
  gracefulRampDown: "30s",
});
export const options = s.options;
export default s.run;
export const handleSummary = s.handleSummary;
