# Performance testing (Backend Phase 14)

Load tests and benchmark data for **non-production** environments only. The
tools refuse production: the data generator checks the database name and a
confirmation variable, and k6 refuses the production API hosts whatever
`PERF_TARGET` says. Stress, spike and soak runs need `PERF_TARGET=staging` or
`isolated`; breakpoint runs need `isolated`.

| Piece | Where |
|---|---|
| Dataset profiles (developer, initial-production, growth) | `server/scripts/perf/profiles.js` |
| Deterministic synthetic data generator | `server/scripts/perf/generateData.js` |
| Thresholds (provisional until approved) | `perf/thresholds.json` |
| Workload mix and journeys | `perf/workload.json`, `perf/k6/lib/journeys.js` |
| Scenarios | `perf/k6/{smoke,average,stress,spike,soak,breakpoint}.js` |
| Results (not committed) | `perf/results/` |

## 1. Load the benchmark data (on the staging server)

```bash
PERF_TARGET=staging PERF_DATABASE_CONFIRM=caspira_staging PERF_USER_PASSWORD='<choose one>' \
node scripts/perf/generateData.js --profile initial-production --seed 20260926 \
  --out /tmp/perf-dataset.json --users-out /tmp/perf-users.json
```

Everything is synthetic: emails end in `.perf.invalid`, phones are 555-01xx,
and the same seed always rebuilds the same data. `--reset` removes that seed's
data first.

## 2. Run a scenario

```bash
k6 run -e PERF_TARGET=staging -e BASE_URL=http://127.0.0.1:4010/api/v1 \
  -e PERF_USERS_FILE=/tmp/perf-users.json -e PERF_USER_PASSWORD='<same password>' \
  -e PERF_ENV_LABEL=staging-vps -e PERF_HARDWARE='4 vCPU / 8 GB / NVMe' -e PERF_RELEASE=<commit> \
  -e PERF_DATASET=initial-production@20260926 -e PERF_RESULTS_DIR=perf/results \
  perf/k6/smoke.js
```

Use `k6 run -e …` flags: k6 doesn't read the shell's environment variables.
`PERF_USERS_FILE` should be an absolute path.

| Scenario | Shape | Where |
|---|---|---|
| `smoke.js` | 2 users, 1 minute | CI, local, staging |
| `average.js` | ramp → hold `TARGET_VUS` (25, 50, 100) → ramp down | staging |
| `stress.js` | 100 → 125 → 150 → 200, then back to 25 to check recovery | staging, isolated |
| `spike.js` | 25 → 150 in 30 s (mass sign-in) → back to 25 | staging, isolated |
| `soak.js` | `TARGET_VUS` for `SOAK` (default 4 h) | staging |
| `breakpoint.js` | arrival rate up to `MAX_RPS` until a limit | isolated only |

Every run writes `perf/results/<run id>.json`:
- p50, p90, p95, p99 and maximum latency, overall and per group (auth, read, write, search, dashboard, enqueue);
- the error rate;
- the number of 401/403 responses;
- the threshold results;
- the environment, hardware, release and dataset labels.

Results from different hardware or environments are never comparable as-is.
Always compare runs with the same labels.
