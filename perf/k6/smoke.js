// Smoke test: proves the scripts, sign-in, dataset and thresholds work.
// Minimal traffic; safe for CI and for a quick check after setup.
//   k6 run perf/k6/smoke.js
import { defineScenario, envInt } from "./lib/scenario.js";

const s = defineScenario("smoke", { executor: "constant-vus", vus: envInt("VUS", 2), duration: __ENV.DURATION || "1m" });
export const options = s.options;
export default s.run;
export const handleSummary = s.handleSummary;
