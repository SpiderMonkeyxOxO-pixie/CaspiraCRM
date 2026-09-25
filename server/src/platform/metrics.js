// Backend Phase 13 — platform gauges for Prometheus (aggregates only; no
// tenant data, secrets, hostnames or record contents).
import prisma from "../lib/prisma.js";
import redis from "../lib/redis.js";
import { currentEnvironment } from "./common.js";
import { httpWindow } from "./httpMetrics.js";
import { backupStatus } from "./backups.js";
import { databaseCapacity, diskUsage } from "./health.js";

export async function platformMetricLines(line) {
  const env = currentEnvironment();
  const [http, backups, db, alerts, jobs, hb] = await Promise.all([
    httpWindow(5).catch(() => ({})), backupStatus().catch(() => null), databaseCapacity().catch(() => null),
    prisma.platformAlertEvent.groupBy({ by: ["severity"], where: { environment: env, status: "Firing" }, _count: { _all: true } }),
    prisma.platformJobRun.groupBy({ by: ["status"], where: { environment: env, startedAt: { gte: new Date(Date.now() - 3_600_000) } }, _count: { _all: true } }),
    redis.get(`hb:${env}:worker`).catch(() => null),
  ]);
  const disk = diskUsage();
  const L = { environment: env };
  return [
    line("caspira_http_requests_5m", "HTTP requests in the last 5 minutes", "gauge", [[L, http.requests || 0]]),
    line("caspira_http_error_rate_5m", "Share of 5xx responses (5 min)", "gauge", [[L, http.errorRate || 0]]),
    line("caspira_http_avg_latency_ms_5m", "Average response time (5 min)", "gauge", [[L, http.avgLatencyMs || 0]]),
    line("caspira_http_slow_requests_5m", "Slow requests (5 min)", "gauge", [[L, http.slow || 0]]),
    line("caspira_http_status_5m", "Responses by status class (5 min)", "gauge", [[{ ...L, status: "401" }, http.status_401 || 0], [{ ...L, status: "403" }, http.status_403 || 0], [{ ...L, status: "429" }, http.status_429 || 0], [{ ...L, status: "5xx" }, http.status_5xx || 0]]),
    line("caspira_db_connections_used_percent", "Database connections in use", "gauge", [[L, db?.connectionUsePercent ?? -1]]),
    line("caspira_db_waiting_locks", "Ungranted database locks", "gauge", [[L, db?.waitingLocks ?? -1]]),
    line("caspira_db_long_running_queries", "Queries active for over 30 s", "gauge", [[L, db?.longRunningQueries ?? -1]]),
    line("caspira_disk_used_percent", "Application volume disk usage", "gauge", [[L, disk?.usedPercent ?? -1]]),
    line("caspira_backup_age_hours", "Hours since the last successful database backup (-1 unknown)", "gauge", [[L, backups?.lastBackupAgeHours ?? -1]]),
    line("caspira_wal_archive_lag_minutes", "Minutes since the last archived WAL segment (-1 unknown)", "gauge", [[L, backups?.walArchive?.lagMinutes ?? -1]]),
    line("caspira_restore_drill_age_days", "Days since the last passed restore drill (-1 never)", "gauge", [[L, backups?.lastSuccessfulRestoreDrillAt ? Math.floor((Date.now() - new Date(backups.lastSuccessfulRestoreDrillAt)) / 86_400_000) : -1]]),
    line("caspira_worker_heartbeat_age_seconds", "Seconds since the worker heartbeat (-1 missing)", "gauge", [[L, hb ? Math.round((Date.now() - new Date(hb)) / 1000) : -1]]),
    line("caspira_platform_alerts_firing", "Firing platform alerts by severity", "gauge", alerts.map((a) => [{ ...L, severity: a.severity }, a._count._all])),
    line("caspira_platform_job_runs_1h", "Platform job runs in the last hour by status", "gauge", jobs.map((j) => [{ ...L, status: j.status }, j._count._all])),
    line("caspira_process_memory_rss_bytes", "API process resident memory", "gauge", [[L, process.memoryUsage().rss]]),
  ].join("\n") + "\n";
}
