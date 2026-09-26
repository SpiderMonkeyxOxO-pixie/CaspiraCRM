// Common body of every scenario: sign in once per virtual user, then run
// weighted journeys with think time. Scenario files only set the traffic
// shape; the journeys, thresholds and recorded metadata are shared.
import { sleep } from "k6";
import { assertTarget, k6Thresholds, loadUsers } from "./config.js";
import { currentSession } from "./session.js";
import { runJourney } from "./journeys.js";
import { summaryOutputs } from "./summary.js";

export function defineScenario(name, executorConfig, { requireIsolated = false, abortOnFail = false, extraThresholds = {} } = {}) {
  const { baseUrl } = assertTarget({ requireIsolated });
  const { users } = loadUsers();
  return {
    options: {
      scenarios: { [name]: executorConfig },
      thresholds: { ...k6Thresholds({ abortOnFail }), ...extraThresholds },
      summaryTrendStats: ["med", "p(50)", "p(90)", "p(95)", "p(99)", "max"],
      // Never follow a redirect off the target, never reuse another VU's cookies.
      maxRedirects: 0,
      noCookiesReset: false,
      tags: { scenario: name, target: __ENV.PERF_TARGET },
    },
    run() {
      const session = currentSession(baseUrl, users);
      if (!session) {
        sleep(5); // sign-in failed; counted in login_failures
        return;
      }
      runJourney(session);
    },
    handleSummary(data) {
      return summaryOutputs(data, name);
    },
  };
}

export const envInt = (name, fallback) => {
  const v = Number(__ENV[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
