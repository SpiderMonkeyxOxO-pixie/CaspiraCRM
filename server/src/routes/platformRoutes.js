// Backend Phase 13 — /api/v1/admin platform operations (security, secrets,
// backups, restores, drills, disaster recovery, releases, deployments,
// health, alerts, retention). Mounted BEFORE the legacy /api/v1/admin router.
//
// Every route: session cookie → live (unrevoked) session → platform
// permission. Mutations add CSRF; sensitive actions add a recent password
// check. Host automation uses scoped tokens on /automation/* instead.
import { Router } from "express";
import { authenticateCookie, requireLiveSession, requireRecentAuth } from "../controllers/auth2Controller.js";
import { requireCsrf } from "../middleware/csrf.js";
import { requirePlatform as can } from "../platform/rbac.js";
import { requireAutomationScope } from "../platform/automationTokens.js";
import * as c from "../platform/api/platformController.js";

const router = Router();
const user = [authenticateCookie, requireLiveSession];
const write = (...perms) => [...user, requireCsrf, can(...perms)];
const sensitive = (...perms) => [...write(...perms), requireRecentAuth()];

// Host automation (Bearer cpat_… tokens; no cookies, no CSRF).
router.get("/automation/deployments/:id", requireAutomationScope("deployment:read"), c.automationGetDeployment);
router.post("/automation/deployments/:id/events", requireAutomationScope("deployment:report"), c.automationReport);
router.post("/automation/releases", requireAutomationScope("release:register"), c.registerRelease);
router.post("/automation/restore-drills", requireAutomationScope("drill:record"), c.automationRecordDrill);

router.get("/platform/access", ...user, c.myAccess);

// Security, findings, exceptions, baseline, secrets, roles, tokens
router.get("/security/overview", ...user, can("platform.security.read"), c.securityOverview);
router.get("/security/findings", ...user, can("platform.security.read", "platform.vulnerability.read"), c.listFindings);
router.post("/security/findings/:id/disposition", ...write("platform.vulnerability.manage", "platform.security.manage"), c.setDisposition);
router.post("/security/findings/:id/exceptions", ...write("platform.security.exception"), c.requestException);
router.post("/security/exceptions/:id/decision", ...sensitive("platform.security.exception_approve"), c.decideException);
router.post("/security/scan-reports", ...write("platform.vulnerability.manage"), c.ingestScan);
router.get("/security/baseline", ...user, can("platform.security.read"), c.listBaseline);
router.put("/security/baseline", ...write("platform.security.manage"), c.recordBaseline);
router.get("/security/secrets", ...user, can("platform.secrets.read_metadata"), c.listSecrets);
router.post("/security/secrets/:id/rotate", ...sensitive("platform.secrets.rotate"), c.rotateSecret);
router.post("/security/secrets/:id/revoke", ...sensitive("platform.secrets.rotate"), c.revokeSecret);
router.get("/security/platform-roles", ...user, can("platform.roles.manage", "platform.security.read"), c.listPlatformRoles);
router.post("/security/platform-roles/grant", ...sensitive("platform.roles.manage"), c.grantRole);
router.post("/security/platform-roles/revoke", ...sensitive("platform.roles.manage"), c.revokeRole);
router.get("/security/automation-tokens", ...user, can("platform.roles.manage", "platform.security.manage"), c.listTokens);
router.post("/security/automation-tokens", ...sensitive("platform.roles.manage", "platform.security.manage"), c.createToken);
router.delete("/security/automation-tokens/:id", ...write("platform.roles.manage", "platform.security.manage"), c.revokeToken);

// Backups
router.get("/backups/policies", ...user, can("platform.backup.read"), c.listPolicies);
router.post("/backups/policies", ...write("platform.backup.run"), c.savePolicy);
router.post("/backups/policies/:id/approve-targets", ...sensitive("platform.restore.approve"), c.approveTargets);
router.get("/backups/status", ...user, can("platform.backup.read"), c.backupStatus);
router.get("/backups/jobs", ...user, can("platform.backup.read"), c.listJobs);
router.post("/backups/run", ...write("platform.backup.run"), c.runBackup);
router.get("/backups/artifacts", ...user, can("platform.backup.read"), c.listArtifacts);
router.post("/backups/artifacts/:id/verify", ...write("platform.backup.verify"), c.verifyArtifact);

// Restores (isolated by default) and restore drills
router.get("/restores", ...user, can("platform.backup.read", "platform.restore.plan"), c.listRestores);
router.post("/restores/plan", ...write("platform.restore.plan"), c.planRestore);
router.post("/restores/:id/approve", ...sensitive("platform.restore.approve"), c.approveRestore);
router.post("/restores/:id/reject", ...write("platform.restore.approve"), c.rejectRestore);
router.post("/restores/:id/execute", ...sensitive("platform.restore.execute"), c.executeRestore);
router.post("/restores/:id/cancel", ...write("platform.restore.plan", "platform.restore.execute"), c.cancelRestore);
router.get("/restore-drills", ...user, can("platform.backup.read", "platform.dr.read"), c.listDrills);
router.post("/restore-drills", ...write("platform.backup.verify", "platform.restore.execute"), c.createDrill);

// Disaster recovery
router.get("/disaster-recovery/plans", ...user, can("platform.dr.read"), c.listDrPlans);
router.post("/disaster-recovery/plans/:key/transition", ...write("platform.dr.manage"), c.transitionDrPlan);
router.get("/disaster-recovery/drills", ...user, can("platform.dr.read"), c.listDrDrills);
router.post("/disaster-recovery/drills", ...write("platform.dr.manage"), c.scheduleDrDrill);
router.post("/disaster-recovery/drills/:id/transition", ...write("platform.dr.manage"), c.transitionDrDrill);
router.get("/disaster-recovery/incidents", ...user, can("platform.dr.read"), c.listIncidents);
router.post("/disaster-recovery/incidents", ...sensitive("platform.dr.declare"), c.declareIncident);
router.post("/disaster-recovery/incidents/:id/transition", ...write("platform.dr.manage", "platform.dr.declare"), c.transitionIncident);

// Releases and deployments
router.get("/releases", ...user, can("platform.release.read"), c.listReleases);
router.post("/releases", ...write("platform.release.create"), c.registerRelease);
router.post("/releases/:id/approve", ...sensitive("platform.deployment.approve"), c.approveRelease);
router.get("/deployments", ...user, can("platform.release.read", "platform.deployment.plan"), c.listDeployments);
router.get("/deployments/:id", ...user, can("platform.release.read", "platform.deployment.plan"), c.getDeployment);
router.post("/deployments/plan", ...write("platform.deployment.plan"), c.planDeployment);
router.post("/deployments/:id/approve", ...sensitive("platform.deployment.approve"), c.approveDeployment);
router.post("/deployments/:id/execute", ...sensitive("platform.deployment.execute"), c.executeDeployment);
router.post("/deployments/:id/rollback", ...write("platform.deployment.rollback"), c.rollbackDeployment);
router.post("/deployments/rollbacks/:id/approve", ...sensitive("platform.deployment.approve"), c.approveRollback);
router.post("/deployments/:id/cancel", ...write("platform.deployment.plan", "platform.deployment.approve"), c.cancelDeployment);

// System health, capacity, alerts, jobs
router.get("/system/health", ...user, can("platform.health.read"), c.systemHealth);
router.get("/system/capacity", ...user, can("platform.health.read"), c.systemCapacity);
router.get("/system/alerts", ...user, can("platform.health.read"), c.listAlerts);
router.patch("/system/alerts/policies/:key", ...write("platform.alerts.manage"), c.updateAlertPolicy);
router.post("/system/alerts/:id/acknowledge", ...write("platform.health.read"), c.acknowledgeAlert);
router.post("/system/alerts/evaluate", ...write("platform.alerts.manage"), c.evaluateAlertsNow);
router.get("/system/jobs", ...user, can("platform.health.read"), c.listJobRuns);

// Retention
router.get("/retention", ...user, can("platform.security.read"), c.listRetention);
router.put("/retention", ...sensitive("platform.retention.manage"), c.setRetention);
router.post("/retention/run", ...write("platform.retention.manage"), c.runRetention);

export default router;
