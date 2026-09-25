-- AlterTable
ALTER TABLE "refresh_sessions" ADD COLUMN     "absoluteExpiresAt" TIMESTAMP(3),
ADD COLUMN     "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reauthenticatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "platform_role_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "grantedByUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "platform_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_automation_tokens" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "environment" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_automation_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_security_baseline_checks" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "control" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Unknown',
    "evidence" TEXT,
    "checkedBy" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_security_baseline_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_security_findings" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'platform',
    "category" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "component" TEXT,
    "installedVersion" TEXT,
    "fixedVersion" TEXT,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "disposition" TEXT,
    "dispositionNote" TEXT,
    "dispositionByUserId" TEXT,
    "releaseId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_security_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_security_exceptions" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Requested',
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_security_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_secret_inventory" (
    "id" TEXT NOT NULL,
    "secretKey" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "owningService" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "createdOn" TIMESTAMP(3) NOT NULL,
    "lastRotatedAt" TIMESTAMP(3),
    "nextRotationDue" TIMESTAMP(3),
    "rotationIntervalDays" INTEGER NOT NULL DEFAULT 180,
    "rotationMethod" TEXT NOT NULL,
    "dependentServices" JSONB NOT NULL DEFAULT '[]',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "supportsOverlap" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_secret_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_secret_rotation_events" (
    "id" TEXT NOT NULL,
    "secretItemId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "fromVersion" INTEGER,
    "toVersion" INTEGER,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_secret_rotation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_backup_policies" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL,
    "fullIntervalHours" INTEGER NOT NULL DEFAULT 168,
    "diffIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "incrIntervalHours" INTEGER NOT NULL DEFAULT 1,
    "logicalExportIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "retentionFull" INTEGER NOT NULL DEFAULT 4,
    "retentionDiff" INTEGER NOT NULL DEFAULT 14,
    "walArchiveMaxLagMinutes" INTEGER NOT NULL DEFAULT 15,
    "verifyIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "restoreTestIntervalDays" INTEGER NOT NULL DEFAULT 30,
    "rpoTargetMinutes" INTEGER NOT NULL DEFAULT 15,
    "rtoTargetMinutes" INTEGER NOT NULL DEFAULT 240,
    "targetsApproved" BOOLEAN NOT NULL DEFAULT false,
    "targetsApprovedByUserId" TEXT,
    "targetsApprovedAt" TIMESTAMP(3),
    "repositories" JSONB NOT NULL DEFAULT '[]',
    "encryptionRequired" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_backup_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_backup_jobs" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "policyId" TEXT,
    "dataSource" TEXT NOT NULL,
    "backupType" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "requestedByUserId" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureSummary" TEXT,
    "artifactId" TEXT,
    "toolExitCode" INTEGER,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_backup_artifacts" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL,
    "backupType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "toolVersion" TEXT,
    "databaseVersion" TEXT,
    "walStart" TEXT,
    "walStop" TEXT,
    "recoverableFrom" TIMESTAMP(3),
    "recoverableTo" TIMESTAMP(3),
    "locationId" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL,
    "encryptionKeyVersion" TEXT,
    "sizeBytes" BIGINT,
    "checksum" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'Unverified',
    "lastVerifiedAt" TIMESTAMP(3),
    "retentionExpiresAt" TIMESTAMP(3),
    "failureSummary" TEXT,
    "jobId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_backup_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_backup_verifications" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "check" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "restoreDrillId" TEXT,
    "triggeredByUserId" TEXT,
    "correlationId" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_backup_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_restore_plans" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT 'isolated',
    "recoveryType" TEXT NOT NULL,
    "recoveryTarget" TIMESTAMP(3),
    "sourceArtifactId" TEXT NOT NULL,
    "walCoverageValidated" BOOLEAN NOT NULL DEFAULT false,
    "walCoverage" JSONB NOT NULL DEFAULT '{}',
    "incidentRef" TEXT,
    "changeRef" TEXT,
    "impactAssessment" TEXT,
    "currentStateBackupRef" TEXT,
    "maintenancePlan" TEXT,
    "communicationPlan" TEXT,
    "rollForwardPlan" TEXT,
    "rollbackPlan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Awaiting approval',
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "separationException" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_restore_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_restore_executions" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "targetLabel" TEXT NOT NULL,
    "jobId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "recoveredTo" TIMESTAMP(3),
    "validation" JSONB NOT NULL DEFAULT '{}',
    "failureSummary" TEXT,
    "executedByUserId" TEXT,
    "cleanedUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_restore_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_restore_drills" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "selectedBackupRef" TEXT,
    "requestedRecoveryPoint" TIMESTAMP(3),
    "actualRecoveredPoint" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "measuredRpoSeconds" INTEGER,
    "measuredRtoSeconds" INTEGER,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "missingArtifacts" JSONB NOT NULL DEFAULT '[]',
    "tool" TEXT,
    "targetDescription" TEXT,
    "operatorUserId" TEXT,
    "approverUserId" TEXT,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "remediation" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'Scheduled',
    "scheduledFor" TIMESTAMP(3),
    "evidenceRef" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_restore_drills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_dr_plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "incidentOwnerRole" TEXT NOT NULL,
    "participants" JSONB NOT NULL DEFAULT '[]',
    "detection" TEXT NOT NULL,
    "containment" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "recoverySteps" JSONB NOT NULL DEFAULT '[]',
    "backupRequirements" TEXT NOT NULL,
    "communication" TEXT NOT NULL,
    "rpoTargetMinutes" INTEGER NOT NULL,
    "rtoTargetMinutes" INTEGER NOT NULL,
    "validation" TEXT NOT NULL,
    "returnToService" TEXT NOT NULL,
    "postIncidentReview" TEXT NOT NULL,
    "singleHostNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lastDrillAt" TIMESTAMP(3),
    "drillIntervalDays" INTEGER NOT NULL DEFAULT 180,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_dr_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_dr_drills" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Drill Scheduled',
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "restoreDrillId" TEXT,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "remediation" JSONB NOT NULL DEFAULT '[]',
    "operatorUserId" TEXT,
    "approverUserId" TEXT,
    "notes" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_dr_drills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_dr_incidents" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "planId" TEXT,
    "environment" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Incident Declared',
    "declaredByUserId" TEXT NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerUserId" TEXT,
    "summary" TEXT,
    "reviewNotes" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_dr_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_dr_incident_actions" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_dr_incident_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_release_artifacts" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "gitCommit" TEXT NOT NULL,
    "images" JSONB NOT NULL,
    "primaryImageDigest" TEXT NOT NULL,
    "buildTimestamp" TIMESTAMP(3) NOT NULL,
    "migrationVersion" TEXT NOT NULL,
    "sbomRef" TEXT,
    "scanRef" TEXT,
    "testResultRef" TEXT,
    "testSummary" JSONB NOT NULL DEFAULT '{}',
    "configSchemaVersion" INTEGER NOT NULL,
    "releaseNotes" TEXT,
    "rollbackCompatibleWith" JSONB NOT NULL DEFAULT '[]',
    "destructiveMigration" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Registered',
    "createdByUserId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_release_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_release_approvals" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_release_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_sbom_references" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "specVersion" TEXT,
    "componentCount" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "generator" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_sbom_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_scan_reports" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT,
    "scanner" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "reportSha256" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_scan_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_deployment_plans" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "previousReleaseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Awaiting Approval',
    "maintenanceRequired" BOOLEAN NOT NULL DEFAULT false,
    "communicationNote" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "separationException" TEXT,
    "lockHolder" TEXT,
    "preflightAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "rollbackOfId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_deployment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_deployment_gates" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "exceptionId" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_deployment_gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_deployment_events" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT,
    "message" TEXT,
    "actorUserId" TEXT,
    "automationTokenId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_deployment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_rollback_plans" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "targetReleaseId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "schemaCompatible" BOOLEAN NOT NULL,
    "compatibilityReason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Requested',
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_rollback_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_health_snapshots" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "overall" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "capacity" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_alert_policies" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "comparator" TEXT NOT NULL DEFAULT 'gt',
    "threshold" DOUBLE PRECISION NOT NULL,
    "windowMinutes" INTEGER NOT NULL,
    "destination" TEXT NOT NULL DEFAULT 'in_app',
    "dedupeKey" TEXT NOT NULL,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "runbook" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_alert_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_alert_events" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Firing',
    "severity" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "message" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstFiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastNotifiedAt" TIMESTAMP(3),
    "acknowledgedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "platform_alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_retention_policies" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "organizationId" TEXT,
    "retentionDays" INTEGER NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'delete',
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "legalHoldReason" TEXT,
    "approvedByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_retention_runs" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "eligible" INTEGER NOT NULL DEFAULT 0,
    "purged" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "failureSummary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "platform_retention_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_job_leases" (
    "jobKey" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_job_leases_pkey" PRIMARY KEY ("jobKey")
);

-- CreateTable
CREATE TABLE "platform_job_runs" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "error" TEXT,
    "result" JSONB,

    CONSTRAINT "platform_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_role_assignments_userId_roleKey_key" ON "platform_role_assignments"("userId", "roleKey");

-- CreateIndex
CREATE UNIQUE INDEX "platform_automation_tokens_publicId_key" ON "platform_automation_tokens"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_automation_tokens_tokenHash_key" ON "platform_automation_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "platform_security_baseline_checks_environment_area_control_key" ON "platform_security_baseline_checks"("environment", "area", "control");

-- CreateIndex
CREATE UNIQUE INDEX "platform_security_findings_publicId_key" ON "platform_security_findings"("publicId");

-- CreateIndex
CREATE INDEX "platform_security_findings_environment_status_severity_idx" ON "platform_security_findings"("environment", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "platform_security_findings_environment_fingerprint_key" ON "platform_security_findings"("environment", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "platform_security_exceptions_publicId_key" ON "platform_security_exceptions"("publicId");

-- CreateIndex
CREATE INDEX "platform_security_exceptions_findingId_idx" ON "platform_security_exceptions"("findingId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_secret_inventory_secretKey_environment_key" ON "platform_secret_inventory"("secretKey", "environment");

-- CreateIndex
CREATE INDEX "platform_secret_rotation_events_secretItemId_createdAt_idx" ON "platform_secret_rotation_events"("secretItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_backup_policies_publicId_key" ON "platform_backup_policies"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_backup_policies_environment_name_key" ON "platform_backup_policies"("environment", "name");

-- CreateIndex
CREATE UNIQUE INDEX "platform_backup_jobs_publicId_key" ON "platform_backup_jobs"("publicId");

-- CreateIndex
CREATE INDEX "platform_backup_jobs_environment_status_createdAt_idx" ON "platform_backup_jobs"("environment", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_backup_artifacts_publicId_key" ON "platform_backup_artifacts"("publicId");

-- CreateIndex
CREATE INDEX "platform_backup_artifacts_environment_completedAt_idx" ON "platform_backup_artifacts"("environment", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_backup_artifacts_environment_dataSource_label_key" ON "platform_backup_artifacts"("environment", "dataSource", "label");

-- CreateIndex
CREATE INDEX "platform_backup_verifications_artifactId_verifiedAt_idx" ON "platform_backup_verifications"("artifactId", "verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_restore_plans_publicId_key" ON "platform_restore_plans"("publicId");

-- CreateIndex
CREATE INDEX "platform_restore_plans_environment_status_idx" ON "platform_restore_plans"("environment", "status");

-- CreateIndex
CREATE INDEX "platform_restore_executions_planId_idx" ON "platform_restore_executions"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_restore_drills_publicId_key" ON "platform_restore_drills"("publicId");

-- CreateIndex
CREATE INDEX "platform_restore_drills_environment_status_completedAt_idx" ON "platform_restore_drills"("environment", "status", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_dr_plans_key_environment_key" ON "platform_dr_plans"("key", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "platform_dr_drills_publicId_key" ON "platform_dr_drills"("publicId");

-- CreateIndex
CREATE INDEX "platform_dr_drills_planId_idx" ON "platform_dr_drills"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_dr_incidents_publicId_key" ON "platform_dr_incidents"("publicId");

-- CreateIndex
CREATE INDEX "platform_dr_incidents_environment_status_idx" ON "platform_dr_incidents"("environment", "status");

-- CreateIndex
CREATE INDEX "platform_dr_incident_actions_incidentId_createdAt_idx" ON "platform_dr_incident_actions"("incidentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_release_artifacts_releaseId_key" ON "platform_release_artifacts"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_release_approvals_releaseId_environment_approverUs_key" ON "platform_release_approvals"("releaseId", "environment", "approverUserId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_sbom_references_releaseId_component_key" ON "platform_sbom_references"("releaseId", "component");

-- CreateIndex
CREATE INDEX "platform_scan_reports_releaseId_idx" ON "platform_scan_reports"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_deployment_plans_publicId_key" ON "platform_deployment_plans"("publicId");

-- CreateIndex
CREATE INDEX "platform_deployment_plans_environment_status_idx" ON "platform_deployment_plans"("environment", "status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_deployment_gates_deploymentId_key_key" ON "platform_deployment_gates"("deploymentId", "key");

-- CreateIndex
CREATE INDEX "platform_deployment_events_deploymentId_createdAt_idx" ON "platform_deployment_events"("deploymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_rollback_plans_publicId_key" ON "platform_rollback_plans"("publicId");

-- CreateIndex
CREATE INDEX "platform_health_snapshots_environment_createdAt_idx" ON "platform_health_snapshots"("environment", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_alert_policies_key_environment_key" ON "platform_alert_policies"("key", "environment");

-- CreateIndex
CREATE INDEX "platform_alert_events_environment_status_idx" ON "platform_alert_events"("environment", "status");

-- CreateIndex
CREATE INDEX "platform_alert_events_policyId_dedupeKey_idx" ON "platform_alert_events"("policyId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "platform_retention_policies_category_environment_organizati_key" ON "platform_retention_policies"("category", "environment", "organizationId");

-- CreateIndex
CREATE INDEX "platform_retention_runs_category_startedAt_idx" ON "platform_retention_runs"("category", "startedAt");

-- CreateIndex
CREATE INDEX "platform_job_runs_jobKey_startedAt_idx" ON "platform_job_runs"("jobKey", "startedAt");
