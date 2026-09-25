// Backend Phase 13 — operational and security alerting.
//
// Signals are computed from the database, Redis request counters, the audit
// trail, backup-agent status and TLS certificates. Policies compare a signal
// to a threshold over a window; events are deduplicated by key, re-notified
// only after the cooldown, and resolved when the signal clears. Messages
// carry counts and component names only — never record contents or tenant
// data. External destinations (email/webhook) are used only when configured.
import tls from "node:tls";
import prisma from "../lib/prisma.js";
import redis from "../lib/redis.js";
import { currentEnvironment, toJson } from "./common.js";
import { httpWindow } from "./httpMetrics.js";
import { backupStatus } from "./backups.js";
import { databaseCapacity, diskUsage, HEARTBEAT_KEYS } from "./health.js";
import { recordOutboxEvent } from "../services/outboxService.js";

const P = (key, title, signal, severity, comparator, threshold, windowMinutes, runbook, owner = "Platform operations", cooldownMinutes = 60) => ({ key, title, signal, severity, comparator, threshold, windowMinutes, runbook, owner, cooldownMinutes, dedupeKey: `${key}` });
export const DEFAULT_ALERT_POLICIES = [
  P("api_unavailable", "Production API unavailable", "api_unavailable", "Critical", "gte", 1, 5, "docs/runbooks/21-return-to-service.md", "Platform operations", 15),
  P("error_rate", "Elevated server error rate", "error_rate", "High", "gt", 0.05, 5, "docs/runbooks/18-disk-and-resource-exhaustion.md"),
  P("database_unavailable", "Database unavailable", "database_unavailable", "Critical", "gte", 1, 5, "docs/runbooks/05-restore-and-pitr.md", "Platform operations", 15),
  P("pool_exhaustion", "Database connection pool near exhaustion", "db_connection_use_percent", "High", "gt", 90, 5, "docs/runbooks/18-disk-and-resource-exhaustion.md"),
  P("disk_nearly_full", "Disk nearly full", "disk_used_percent", "High", "gt", 85, 15, "docs/runbooks/18-disk-and-resource-exhaustion.md"),
  P("worker_heartbeat_missing", "Worker heartbeat missing", "worker_heartbeat_age_seconds", "High", "gt", 180, 5, "docs/runbooks/21-return-to-service.md", "Platform operations", 30),
  P("queue_delay", "Queue delay excessive", "outbox_oldest_pending_minutes", "Medium", "gt", 15, 15, "docs/runbooks/21-return-to-service.md"),
  P("backup_missed", "Scheduled backup missed", "backup_age_hours", "High", "gt", 26, 60, "docs/runbooks/19-backup-failure.md", "Backup operator"),
  P("backup_failed", "Backup failed", "backup_failures", "High", "gte", 1, 1440, "docs/runbooks/19-backup-failure.md", "Backup operator"),
  P("wal_archive_lag", "WAL archive lag", "wal_archive_lag_minutes", "High", "gt", 15, 15, "docs/runbooks/19-backup-failure.md", "Backup operator", 30),
  P("restore_verification_overdue", "Restore verification overdue", "days_since_restore_drill", "Medium", "gt", 30, 1440, "docs/runbooks/13-verify-a-backup.md", "Backup operator", 1440),
  P("certificate_expiry", "TLS certificate expiry approaching", "certificate_days_left", "High", "lt", 21, 1440, "docs/runbooks/04-tls-certificates.md", "Platform operations", 1440),
  P("critical_security_finding", "Critical security finding open", "open_critical_findings", "Critical", "gte", 1, 60, "docs/runbooks/17-compromised-credentials.md", "Security administrator", 240),
  P("privileged_login_failures", "Repeated privileged-login failures", "privileged_login_failures", "High", "gte", 5, 15, "docs/runbooks/17-compromised-credentials.md", "Security administrator", 30),
  // Security signals
  P("login_failures", "Repeated login failures", "login_failures", "Medium", "gte", 50, 15, "docs/runbooks/17-compromised-credentials.md", "Security administrator", 30),
  P("password_spraying", "Password-spraying pattern (many accounts from one address)", "password_spraying_max_accounts_per_ip", "High", "gte", 10, 15, "docs/runbooks/17-compromised-credentials.md", "Security administrator", 30),
  P("refresh_token_reuse", "Suspicious token reuse", "refresh_token_reuse", "High", "gte", 1, 60, "docs/runbooks/17-compromised-credentials.md", "Security administrator", 60),
  P("permission_changes", "Burst of role or permission changes", "permission_changes", "Medium", "gte", 20, 60, "docs/runbooks/17-compromised-credentials.md", "Security administrator"),
  P("platform_role_changes", "Platform role granted or revoked", "platform_role_changes", "Informational", "gte", 1, 60, "docs/PRODUCTION_OPERATIONS.md", "Security administrator", 60),
  P("secret_rotation", "Secret rotation or emergency revocation", "secret_events", "Informational", "gte", 1, 60, "docs/runbooks/15-rotate-signing-keys.md", "Security administrator", 60),
  P("failed_secret_access", "Failed automation-token or secret access", "failed_secret_access", "High", "gte", 3, 15, "docs/runbooks/17-compromised-credentials.md", "Security administrator", 30),
  P("unusual_exports", "Unusual number of data exports", "exports_requested", "Medium", "gte", 25, 60, "docs/runbooks/22-incident-evidence.md", "Security administrator"),
  P("large_downloads", "Unusual number of export downloads", "exports_downloaded", "Medium", "gte", 50, 60, "docs/runbooks/22-incident-evidence.md", "Security administrator"),
  P("high_volume_api", "High-volume API access (rate limiting active)", "rate_limited_requests", "Medium", "gte", 200, 15, "docs/runbooks/18-disk-and-resource-exhaustion.md", "Security administrator", 30),
  P("authorization_failures", "Repeated authorization failures", "authorization_failures", "Medium", "gte", 100, 15, "docs/runbooks/22-incident-evidence.md", "Security administrator", 30),
  P("webhook_signature_failures", "Webhook signature failures", "webhook_rejections", "Medium", "gte", 10, 60, "docs/runbooks/17-compromised-credentials.md", "Integration administrator"),
  P("oauth_state_failures", "OAuth callback/state failures", "oauth_failures", "Medium", "gte", 5, 60, "docs/runbooks/17-compromised-credentials.md", "Integration administrator"),
  P("restore_requests", "Restore requested or executed", "restore_events", "Informational", "gte", 1, 60, "docs/runbooks/05-restore-and-pitr.md", "Backup operator", 60),
  P("disaster_declared", "Disaster declared", "disaster_declarations", "Critical", "gte", 1, 60, "docs/runbooks/20-declare-and-close-a-disaster.md", "Incident owner", 60),
  P("production_deployment", "Production deployment activity", "deployment_events", "Informational", "gte", 1, 60, "docs/runbooks/06-controlled-deployment.md", "Deployment operator", 60),
];

export async function seedAlertPolicies(environment = currentEnvironment()) {
  let created = 0;
  for (const p of DEFAULT_ALERT_POLICIES) {
    const exists = await prisma.platformAlertPolicy.findUnique({ where: { key_environment: { key: p.key, environment } } });
    if (exists) continue;
    await prisma.platformAlertPolicy.create({ data: { ...p, environment, destination: "in_app" } });
    created += 1;
  }
  return created;
}

export function compare(value, comparator, threshold) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return false;
  const v = Number(value);
  return { gt: v > threshold, gte: v >= threshold, lt: v < threshold, lte: v <= threshold, eq: v === threshold }[comparator] ?? false;
}

const since = (minutes, now) => new Date(now.getTime() - minutes * 60_000);
const auditCount = (where, minutes, now) => prisma.auditEvent.count({ where: { ...where, createdAt: { gte: since(minutes, now) } } });

export async function certificateDaysLeft(url = process.env.PUBLIC_API_URL) {
  if (!url || !url.startsWith("https://")) return null;
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port: Number(port) || 443, servername: hostname, timeout: 5000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert?.valid_to ? Math.floor((new Date(cert.valid_to) - Date.now()) / 86_400_000) : null);
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => { socket.destroy(); resolve(null); });
  });
}

// Computes the signals the enabled policies need (each at most once).
export async function computeSignals(policies, now = new Date()) {
  const needed = new Set(policies.map((p) => p.signal));
  const win = (key) => policies.find((p) => p.signal === key)?.windowMinutes || 15;
  const s = {};
  const want = (k) => needed.has(k);
  if (["error_rate", "rate_limited_requests", "authorization_failures"].some(want)) {
    const w = await httpWindow(Math.max(win("error_rate"), 5), now).catch(() => null);
    if (w) { s.error_rate = w.requests >= 20 ? w.errorRate : 0; s.rate_limited_requests = w.status_429 || 0; s.authorization_failures = w.status_403 || 0; }
  }
  if (want("api_unavailable") && process.env.API_INTERNAL_URL) {
    s.api_unavailable = await fetch(`${process.env.API_INTERNAL_URL.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? 0 : 1)).catch(() => 1);
  }
  if (["database_unavailable", "db_connection_use_percent"].some(want)) {
    try { const cap = await databaseCapacity(); s.database_unavailable = 0; s.db_connection_use_percent = cap.connectionUsePercent; } catch { s.database_unavailable = 1; }
  }
  if (want("disk_used_percent")) { const d = diskUsage(); s.disk_used_percent = d?.usedPercent ?? null; }
  if (want("worker_heartbeat_age_seconds")) {
    const v = await redis.get(`hb:${currentEnvironment()}:${HEARTBEAT_KEYS.worker}`).catch(() => null);
    s.worker_heartbeat_age_seconds = v ? Math.round((now - new Date(v)) / 1000) : 99_999;
  }
  if (want("outbox_oldest_pending_minutes")) {
    const oldest = await prisma.outboxEvent.findFirst({ where: { status: { in: ["Pending", "Processing"] } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    s.outbox_oldest_pending_minutes = oldest ? Math.round((now - oldest.createdAt) / 60000) : 0;
  }
  if (["backup_age_hours", "wal_archive_lag_minutes", "days_since_restore_drill"].some(want)) {
    const b = await backupStatus(now);
    // Without a configured backup agent (development), backup signals are not evaluated.
    if (b.agentConfigured) {
      s.backup_age_hours = b.lastBackupAgeHours ?? 99_999;
      s.wal_archive_lag_minutes = b.walArchive?.lagMinutes ?? 99_999;
    }
    s.days_since_restore_drill = b.lastSuccessfulRestoreDrillAt ? Math.floor((now - new Date(b.lastSuccessfulRestoreDrillAt)) / 86_400_000) : (b.agentConfigured ? 99_999 : null);
  }
  if (want("backup_failures")) s.backup_failures = await prisma.backupJob.count({ where: { environment: currentEnvironment(), status: { in: ["Failed", "Timed out"] }, updatedAt: { gte: since(win("backup_failures"), now) } } });
  if (want("certificate_days_left")) s.certificate_days_left = await certificateDaysLeft();
  if (want("open_critical_findings")) s.open_critical_findings = await prisma.securityFinding.count({ where: { environment: currentEnvironment(), severity: "Critical", status: "Open" } });
  if (want("privileged_login_failures")) {
    const privileged = await prisma.user.findMany({ where: { role: { in: ["Super-Admin", "Admin"] } }, select: { id: true } });
    const platformUsers = await prisma.platformRoleAssignment.findMany({ where: { revokedAt: null }, select: { userId: true } });
    const ids = [...new Set([...privileged.map((u) => u.id), ...platformUsers.map((u) => u.userId)])];
    s.privileged_login_failures = ids.length ? await auditCount({ action: { in: ["auth.login", "auth.reauthenticate", "auth.mfa"] }, result: "Failure", actorUserId: { in: ids } }, win("privileged_login_failures"), now) : 0;
  }
  if (want("login_failures")) s.login_failures = await auditCount({ action: "auth.login", result: "Failure" }, win("login_failures"), now);
  if (want("password_spraying_max_accounts_per_ip")) {
    const rows = await prisma.auditEvent.groupBy({ by: ["ipAddress", "actorUserId"], where: { action: "auth.login", result: "Failure", createdAt: { gte: since(win("password_spraying_max_accounts_per_ip"), now) }, ipAddress: { not: null } } });
    const perIp = {};
    for (const r of rows) perIp[r.ipAddress] = (perIp[r.ipAddress] || 0) + 1;
    s.password_spraying_max_accounts_per_ip = Math.max(0, ...Object.values(perIp));
  }
  if (want("refresh_token_reuse")) s.refresh_token_reuse = await auditCount({ action: "auth.refresh_reuse_detected" }, win("refresh_token_reuse"), now);
  if (want("permission_changes")) s.permission_changes = await auditCount({ OR: [{ action: { startsWith: "member.role_" } }, { action: { startsWith: "role." } }] }, win("permission_changes"), now);
  if (want("platform_role_changes")) s.platform_role_changes = await auditCount({ action: { in: ["platform.role_granted", "platform.role_revoked"] } }, win("platform_role_changes"), now);
  if (want("secret_events")) s.secret_events = await auditCount({ action: { startsWith: "platform.secret." } }, win("secret_events"), now);
  if (want("failed_secret_access")) s.failed_secret_access = await auditCount({ action: "platform.automation_token.denied" }, win("failed_secret_access"), now);
  if (want("exports_requested")) s.exports_requested = await auditCount({ action: "analytics.export.requested" }, win("exports_requested"), now);
  if (want("exports_downloaded")) s.exports_downloaded = await auditCount({ action: "analytics.export.downloaded" }, win("exports_downloaded"), now);
  if (want("webhook_rejections")) s.webhook_rejections = await auditCount({ action: "integrations.webhook.rejected" }, win("webhook_rejections"), now);
  if (want("oauth_failures")) s.oauth_failures = await auditCount({ action: "integrations.oauth.callback_failed" }, win("oauth_failures"), now);
  if (want("restore_events")) s.restore_events = await auditCount({ action: { startsWith: "platform.restore." } }, win("restore_events"), now);
  if (want("disaster_declarations")) s.disaster_declarations = await auditCount({ action: "platform.dr.disaster_declared" }, win("disaster_declarations"), now);
  if (want("deployment_events")) s.deployment_events = await auditCount({ action: { in: ["platform.deployment.executing", "platform.deployment.rollback_approved"] } }, win("deployment_events"), now);
  return s;
}

async function notify(policy, event, isNew) {
  const payload = { platformAlert: policy.key, severity: policy.severity, title: policy.title, environment: policy.environment, value: event.value, count: event.count, runbook: policy.runbook, isNew };
  // In-app: recorded in the outbox (no external delivery).
  await recordOutboxEvent(null, { aggregateType: "PlatformAlert", aggregateId: event.id, eventType: `platform.alert.${isNew ? "fired" : "repeated"}`, payload }).catch(() => {});
  // Email only when a destination is explicitly configured and authorized.
  if (policy.destination === "email" && process.env.ALERT_EMAIL_TO && process.env.ALERT_EMAIL_ENABLED === "true") {
    await recordOutboxEvent(null, { aggregateType: "PlatformAlert", aggregateId: event.id, eventType: "platform.alert.email", payload: { to: process.env.ALERT_EMAIL_TO, subject: `[${policy.environment}] ${policy.severity}: ${policy.title}`, text: `${policy.title}\nValue: ${event.value}\nOccurrences: ${event.count}\nRunbook: ${policy.runbook}` } }).catch(() => {});
  }
}

// Deduplicate + cooldown + resolve.
export async function applyPolicy(policy, value, now = new Date()) {
  const firing = compare(value, policy.comparator, policy.threshold);
  const open = await prisma.platformAlertEvent.findFirst({ where: { policyId: policy.id, dedupeKey: policy.dedupeKey, status: { in: ["Firing", "Acknowledged"] } } });
  if (!firing) {
    if (open) await prisma.platformAlertEvent.update({ where: { id: open.id }, data: { status: "Resolved", resolvedAt: now } });
    return { firing: false, resolved: !!open };
  }
  const message = `${policy.title}: ${policy.signal} = ${value} (${policy.comparator} ${policy.threshold} over ${policy.windowMinutes} min).`;
  if (!open) {
    const event = await prisma.platformAlertEvent.create({ data: { policyId: policy.id, environment: policy.environment, dedupeKey: policy.dedupeKey, severity: policy.severity, value: Number(value), message, lastNotifiedAt: now } });
    await notify(policy, event, true);
    return { firing: true, created: true, notified: true };
  }
  const cooled = !open.lastNotifiedAt || now - open.lastNotifiedAt >= policy.cooldownMinutes * 60_000;
  const event = await prisma.platformAlertEvent.update({ where: { id: open.id }, data: { count: { increment: 1 }, lastFiredAt: now, value: Number(value), message, ...(cooled && open.status === "Firing" ? { lastNotifiedAt: now } : {}) } });
  if (cooled && open.status === "Firing") await notify(policy, event, false);
  return { firing: true, created: false, notified: cooled && open.status === "Firing" };
}

export async function evaluateAlerts({ now = new Date(), only = null } = {}) {
  const policies = await prisma.platformAlertPolicy.findMany({ where: { environment: currentEnvironment(), enabled: true, ...(only ? { signal: { in: only } } : {}) } });
  const signals = await computeSignals(policies, now);
  const results = {};
  for (const p of policies) {
    if (!(p.signal in signals)) continue; // not evaluable here (e.g. no backup agent)
    results[p.key] = { value: signals[p.signal], ...(await applyPolicy(p, signals[p.signal], now)) };
  }
  return toJson(results);
}

export async function updatePolicy(req, key, body) {
  const p = await prisma.platformAlertPolicy.findUnique({ where: { key_environment: { key: String(key), environment: currentEnvironment() } } });
  if (!p) return null;
  const data = {};
  if (body.enabled !== undefined) data.enabled = !!body.enabled;
  if (body.threshold !== undefined) { const n = Number(body.threshold); if (!Number.isFinite(n)) throw new Error("threshold"); data.threshold = n; }
  if (body.windowMinutes !== undefined) { const n = Number(body.windowMinutes); if (!Number.isInteger(n) || n < 1 || n > 10_080) throw new Error("windowMinutes"); data.windowMinutes = n; }
  if (body.cooldownMinutes !== undefined) { const n = Number(body.cooldownMinutes); if (!Number.isInteger(n) || n < 1 || n > 10_080) throw new Error("cooldownMinutes"); data.cooldownMinutes = n; }
  if (body.destination !== undefined) { if (!["in_app", "email"].includes(body.destination)) throw new Error("destination"); data.destination = body.destination; }
  return prisma.platformAlertPolicy.update({ where: { id: p.id }, data: { ...data, version: { increment: 1 } } });
}
