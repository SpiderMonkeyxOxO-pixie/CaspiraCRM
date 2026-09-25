// Backend Phase 13 — centralized data retention.
//
// One registry of categories, each with a default period, the table and
// timestamp it applies to, and whether rows are deleted or anonymized.
// Authorized tenant overrides and legal holds are honored; every run
// (including dry runs and failures) is recorded and audited. Categories that
// an earlier phase already governs (AI request payloads, integration raw
// payloads, export files) are listed with their owning policy so the
// retention view is complete without purging twice.
//
// Data removed from the live system can remain in protected backups until
// those backups expire under the backup policy; backups are never edited to
// delete individual records.
import prisma from "../lib/prisma.js";
import { PlatformError, currentEnvironment, platformAudit } from "./common.js";

const days = (n) => n;
export const RETENTION_CATEGORIES = {
  audit_events: { label: "Audit events", defaultDays: () => Number(process.env.AUDIT_LOG_RETENTION_DAYS) || 730, model: "auditEvent", dateField: "createdAt", where: {}, action: "delete", minDays: 90 },
  authentication_events: { label: "Authentication events", defaultDays: () => days(365), model: "auditEvent", dateField: "createdAt", where: { action: { startsWith: "auth." } }, action: "delete", minDays: 30 },
  notifications: { label: "Delivered notifications (outbox)", defaultDays: () => days(90), model: "outboxEvent", dateField: "createdAt", where: { status: { in: ["Sent", "Internal"] } }, action: "delete", minDays: 7 },
  webhook_deliveries: { label: "Outbound webhook deliveries", defaultDays: () => days(90), model: "integrationOutboundDelivery", dateField: "createdAt", where: {}, action: "delete", minDays: 7 },
  inbound_webhooks: { label: "Inbound webhook events", defaultDays: () => days(90), model: "integrationWebhookEvent", dateField: "receivedAt", where: {}, action: "delete", minDays: 7 },
  integration_logs: { label: "Integration logs", defaultDays: () => days(90), model: "integrationLog", dateField: "createdAt", where: {}, action: "delete", minDays: 7 },
  workflow_runs: { label: "AI workflow runs", defaultDays: () => days(365), model: "aiWorkflowRun", dateField: "createdAt", where: { status: { in: ["Completed", "Failed", "Cancelled", "Expired"] } }, action: "delete", minDays: 30 },
  ai_request_metadata: { label: "AI request metadata", managedBy: "AI policy (Administration → AI Providers → Privacy): payloads and provider metadata" },
  generated_reports: { label: "Generated export files", managedBy: "Analytics exports expire after ANALYTICS_EXPORT_EXPIRY_DAYS and their encrypted bytes are erased" },
  export_records: { label: "Export records (metadata)", defaultDays: () => days(365), model: "analyticsExportJob", dateField: "createdAt", where: { status: { in: ["Expired", "Revoked", "Cancelled", "Failed"] } }, action: "delete", minDays: 30 },
  refresh_sessions: { label: "Ended sessions", defaultDays: () => days(90), model: "refreshSession", dateField: "createdAt", where: (now) => ({ OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: now } }] }), action: "delete", minDays: 1 },
  temporary_uploads: { label: "Temporary uploads", managedBy: "No temporary-upload store exists yet (the Documents service is not built)" },
  malware_quarantine: { label: "Malware-quarantined files", managedBy: "No file scanning exists yet (the Documents service is not built)" },
  backup_artifacts: { label: "Backup artifacts", managedBy: "Backup policy retention (pgBackRest repo retention and off-host lifecycle)" },
  restore_test_environments: { label: "Restore-test environments", managedBy: "Isolated restore targets are removed by the backup agent after validation (RESTORE_TARGET_TTL_HOURS)" },
  platform_job_runs: { label: "Platform job history", defaultDays: () => days(30), model: "platformJobRun", dateField: "startedAt", where: {}, action: "delete", minDays: 7 },
};

export async function policiesFor(environment = currentEnvironment()) {
  const rows = await prisma.retentionPolicy.findMany({ where: { environment } });
  return Object.entries(RETENTION_CATEGORIES).map(([category, c]) => {
    const own = rows.filter((r) => r.category === category);
    const platform = own.find((r) => !r.organizationId);
    return {
      category, label: c.label, managedBy: c.managedBy || null, action: c.action || null,
      retentionDays: platform?.retentionDays ?? (c.defaultDays ? c.defaultDays() : null), legalHold: !!platform?.legalHold, legalHoldReason: platform?.legalHoldReason || null,
      tenantOverrides: own.filter((r) => r.organizationId).map((r) => ({ organizationId: r.organizationId, retentionDays: r.retentionDays, legalHold: r.legalHold })),
    };
  });
}

export async function setPolicy(req, { category, retentionDays, legalHold, legalHoldReason, organizationId = null }) {
  const c = RETENTION_CATEGORIES[category];
  if (!c || c.managedBy) throw new PlatformError(422, "INVALID_CATEGORY", "This category isn't configurable here.");
  const d = Number(retentionDays);
  if (!Number.isInteger(d) || d < c.minDays || d > 3650) throw new PlatformError(422, "INVALID_RETENTION", `retentionDays must be ${c.minDays}–3650.`);
  if (legalHold && String(legalHoldReason || "").trim().length < 10) throw new PlatformError(422, "REASON_REQUIRED", "A legal hold needs a reason (at least 10 characters).");
  const environment = currentEnvironment();
  const existing = await prisma.retentionPolicy.findFirst({ where: { category, environment, organizationId } });
  const data = { retentionDays: d, legalHold: !!legalHold, legalHoldReason: legalHold ? String(legalHoldReason).slice(0, 500) : null, approvedByUserId: req.user.id, action: c.action };
  const row = existing ? await prisma.retentionPolicy.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } }) : await prisma.retentionPolicy.create({ data: { category, environment, organizationId, ...data } });
  await platformAudit(req, "retention.policy_set", "RetentionPolicy", row.id, { after: { category, retentionDays: d, legalHold: !!legalHold, organizationId } });
  return row;
}

export function cutoffFor(retentionDays, now = new Date()) { return new Date(now.getTime() - retentionDays * 86_400_000); }

// Runs one category. Tenant-scoped categories skip organizations under a
// legal hold and apply their overrides. Batched to bound lock time.
export async function runRetention(category, { dryRun = false, now = new Date(), batch = 1000 } = {}) {
  const c = RETENTION_CATEGORIES[category];
  if (!c || c.managedBy) return null;
  const environment = currentEnvironment();
  const rows = await prisma.retentionPolicy.findMany({ where: { environment, category } });
  const platform = rows.find((r) => !r.organizationId);
  const run = await prisma.retentionRun.create({ data: { category, environment, dryRun, status: "Running" } });
  if (platform?.legalHold) {
    await prisma.retentionRun.update({ where: { id: run.id }, data: { status: "Skipped (legal hold)", completedAt: new Date() } });
    return { category, skipped: "legal hold" };
  }
  const retention = platform?.retentionDays ?? c.defaultDays();
  const held = rows.filter((r) => r.organizationId && r.legalHold).map((r) => r.organizationId);
  const overrides = rows.filter((r) => r.organizationId && !r.legalHold);
  const fields = prisma[c.model].fields;
  const extra = typeof c.where === "function" ? c.where(now) : c.where;
  const hasOrg = !!fields?.organizationId;
  const baseWhere = { ...extra, [c.dateField]: { lt: cutoffFor(retention, now) }, ...(hasOrg && (held.length || overrides.length) ? { AND: [{ OR: [{ organizationId: null }, { organizationId: { notIn: [...held, ...overrides.map((o) => o.organizationId)] } }] }] } : {}) };
  let eligible = 0; let purged = 0; let failed = 0; const failures = [];
  const purgeWhere = async (where) => {
    const n = await prisma[c.model].count({ where });
    eligible += n;
    if (dryRun || !n) return;
    for (;;) {
      const ids = (await prisma[c.model].findMany({ where, select: { id: true }, take: batch })).map((r) => r.id);
      if (!ids.length) break;
      try { const r = await prisma[c.model].deleteMany({ where: { id: { in: ids } } }); purged += r.count; }
      catch (err) { failed += ids.length; failures.push(err?.code || "error"); break; }
    }
  };
  await purgeWhere(baseWhere);
  for (const o of overrides) if (hasOrg) await purgeWhere({ ...extra, organizationId: o.organizationId, [c.dateField]: { lt: cutoffFor(o.retentionDays, now) } });
  const status = failed ? (purged ? "Partially failed" : "Failed") : "Succeeded";
  await prisma.retentionRun.update({ where: { id: run.id }, data: { status, eligible, purged, failed, failureSummary: failures.length ? [...new Set(failures)].join(", ") : null, completedAt: new Date() } });
  // The purge itself is audited (counts only).
  await platformAudit({ correlationId: run.id }, "retention.purged", "RetentionRun", run.id, { result: failed ? "Failure" : "Success", after: { category, dryRun, eligible, purged, failed, retentionDays: retention } });
  return { category, dryRun, eligible, purged, failed, status };
}

export async function runAllRetention(opts = {}) {
  const out = [];
  for (const [category, c] of Object.entries(RETENTION_CATEGORIES)) if (!c.managedBy) out.push(await runRetention(category, opts));
  return out;
}
