// Shared configuration for every k6 scenario. All inputs come from
// environment variables so a run is fully described by its command line:
//
//   PERF_TARGET        local | ci | staging | isolated   (required; never production)
//   BASE_URL           API base, e.g. http://127.0.0.1:4010/api/v1
//   PERF_USERS_FILE    load-user manifest written by generateData.js --users-out
//   PERF_USER_PASSWORD the synthetic users' password (never stored)
//   PERF_ENV_LABEL, PERF_HARDWARE, PERF_RELEASE, PERF_DATASET, PERF_DB_VERSION,
//   PERF_DOCKER_VERSION, PERF_OS, PERF_REPLICAS, PERF_LIMITS  — recorded with results
const TARGETS = ["local", "ci", "staging", "isolated"];
// Production hosts are refused outright, whatever PERF_TARGET says.
const FORBIDDEN_HOSTS = (__ENV.PERF_FORBIDDEN_HOSTS || "api.caspirasolutions.com,caspiracrm.caspirasolutions.com").split(",").map((h) => h.trim()).filter(Boolean);

export const thresholdsDoc = JSON.parse(open("../../thresholds.json"));
export const workload = JSON.parse(open("../../workload.json"));

export function hostOf(url) {
  const m = /^https?:\/\/([^/:]+)/i.exec(url || "");
  return m ? m[1].toLowerCase() : null;
}

export function assertTarget({ requireIsolated = false } = {}) {
  const target = __ENV.PERF_TARGET;
  if (!TARGETS.includes(target)) throw new Error(`PERF_TARGET must be one of ${TARGETS.join(", ")}. Load tests never run against production.`);
  if (requireIsolated && target !== "isolated") throw new Error("Breakpoint tests run only with PERF_TARGET=isolated.");
  const host = hostOf(__ENV.BASE_URL);
  if (!host) throw new Error("Set BASE_URL, e.g. http://127.0.0.1:4010/api/v1");
  if (FORBIDDEN_HOSTS.includes(host)) throw new Error(`${host} is a production host. Refusing to generate load against it.`);
  return { target, baseUrl: __ENV.BASE_URL.replace(/\/$/, "") };
}

export function loadUsers() {
  if (!__ENV.PERF_USERS_FILE) throw new Error("Set PERF_USERS_FILE to the manifest from generateData.js --users-out.");
  const { users, seed, profile } = JSON.parse(open(__ENV.PERF_USERS_FILE));
  if (!users?.length) throw new Error("The load-user manifest is empty.");
  return { users, seed, profile };
}

// k6 thresholds built from perf/thresholds.json — the single source of truth.
export function k6Thresholds({ abortOnFail = false } = {}) {
  const t = { http_req_failed: [`rate<${thresholdsDoc.errorRate.max}`], unauthorized_responses: [`count<=${thresholdsDoc.unauthorizedResponses.max}`] };
  for (const [group, { p95 }] of Object.entries(thresholdsDoc.latencyMs)) {
    t[`http_req_duration{group:${group}}`] = [{ threshold: `p(95)<${p95}`, abortOnFail, delayAbortEval: "1m" }];
  }
  return t;
}

// Recorded with every result so runs on different hardware are never
// compared as if they were equivalent.
export function runMetadata(scenario) {
  return {
    scenario,
    target: __ENV.PERF_TARGET,
    environment: __ENV.PERF_ENV_LABEL || __ENV.PERF_TARGET,
    hardware: __ENV.PERF_HARDWARE || "unrecorded",
    os: __ENV.PERF_OS || "unrecorded",
    dockerVersion: __ENV.PERF_DOCKER_VERSION || "unrecorded",
    release: __ENV.PERF_RELEASE || "unrecorded",
    databaseVersion: __ENV.PERF_DB_VERSION || "unrecorded",
    dataset: __ENV.PERF_DATASET || "unrecorded",
    replicas: __ENV.PERF_REPLICAS || "api=1,worker=1",
    resourceLimits: __ENV.PERF_LIMITS || "unrecorded",
    thresholdsVersion: thresholdsDoc.version,
    thresholdsStatus: thresholdsDoc.status,
    workloadVersion: workload.version,
  };
}
