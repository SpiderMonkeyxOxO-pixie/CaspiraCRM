-- CreateTable
CREATE TABLE "integration_providers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "apiVersion" TEXT,
    "authType" TEXT NOT NULL,
    "ownershipTypes" JSONB NOT NULL DEFAULT '[]',
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "requiredScopes" JSONB NOT NULL DEFAULT '[]',
    "optionalScopes" JSONB NOT NULL DEFAULT '[]',
    "webhookSupport" BOOLEAN NOT NULL DEFAULT false,
    "incrementalSync" BOOLEAN NOT NULL DEFAULT false,
    "sandboxSupport" BOOLEAN NOT NULL DEFAULT false,
    "docsUrl" TEXT,
    "statusPageUrl" TEXT,
    "dataCategories" JSONB NOT NULL DEFAULT '[]',
    "sensitiveWarning" TEXT,
    "availability" TEXT NOT NULL DEFAULT 'Catalog Only',
    "availabilityReason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "adapterVersion" TEXT,
    "protocol" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_provider_apps" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "providerKey" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretCredentialId" TEXT,
    "webhookSecretCredentialId" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'Sandbox',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_provider_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownershipType" TEXT NOT NULL,
    "connectedUserId" TEXT,
    "connectedMembershipId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'Live',
    "externalAccountId" TEXT,
    "externalAccountLabel" TEXT,
    "externalTenantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Ready to Connect',
    "grantedScopes" JSONB NOT NULL DEFAULT '[]',
    "requestedScopes" JSONB NOT NULL DEFAULT '[]',
    "capabilityState" JSONB NOT NULL DEFAULT '{}',
    "credentialRef" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "lastScopeCheckAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastFailedSyncAt" TIMESTAMP(3),
    "reauthorizationRequiredAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "rateLimitedUntil" TIMESTAMP(3),
    "circuitOpenUntil" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdByMembershipId" TEXT,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_credentials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "connectionId" TEXT,
    "providerAppId" TEXT,
    "credentialType" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Active',
    "rotatedAt" TIMESTAMP(3),
    "rotatedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_oauth_states" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT,
    "providerKey" TEXT NOT NULL,
    "connectionId" TEXT,
    "ownershipType" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "requestedScopes" JSONB NOT NULL DEFAULT '[]',
    "verifierCiphertext" TEXT NOT NULL,
    "verifierNonce" TEXT NOT NULL,
    "verifierTag" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "nonceHash" TEXT,
    "redirectTarget" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "allowedProviders" JSONB NOT NULL DEFAULT '[]',
    "blockedProviders" JSONB NOT NULL DEFAULT '[]',
    "allowedOwnershipTypes" JSONB NOT NULL DEFAULT '["User Connection","Organization Connection"]',
    "allowedDataCategories" JSONB NOT NULL DEFAULT '[]',
    "allowedDirections" JSONB NOT NULL DEFAULT '["Import Only"]',
    "restrictedFields" JSONB NOT NULL DEFAULT '[]',
    "providerRestrictions" JSONB NOT NULL DEFAULT '{}',
    "requireAdminApproval" BOOLEAN NOT NULL DEFAULT true,
    "defaultConflictPolicy" TEXT NOT NULL DEFAULT 'Manual',
    "maxSyncFrequencyMinutes" INTEGER NOT NULL DEFAULT 15,
    "rawPayloadRetentionDays" INTEGER NOT NULL DEFAULT 7,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_configurations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'Import Only',
    "sourceOfTruth" TEXT NOT NULL DEFAULT 'CRM',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "fieldMapping" JSONB NOT NULL DEFAULT '{}',
    "conflictPolicy" TEXT NOT NULL DEFAULT 'Manual',
    "deletionPolicy" TEXT NOT NULL DEFAULT 'No Deletions',
    "scheduleMinutes" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "twoWayConfirmedAt" TIMESTAMP(3),
    "twoWayConfirmedByMembershipId" TEXT,
    "initialSyncCompletedAt" TIMESTAMP(3),
    "createdByMembershipId" TEXT,
    "updatedByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_sync_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_checkpoints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "syncConfigurationId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "cursor" TEXT,
    "watermark" TEXT,
    "lastProcessedEventId" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "checkpointVersion" INTEGER NOT NULL DEFAULT 0,
    "expiredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_sync_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "syncConfigurationId" TEXT,
    "capability" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'Sync',
    "trigger" TEXT NOT NULL DEFAULT 'Manual',
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "discovered" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "apiCalls" INTEGER NOT NULL DEFAULT 0,
    "rateLimitState" JSONB,
    "checkpointBefore" TEXT,
    "checkpointAfter" TEXT,
    "preview" JSONB,
    "previewExpiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedByMembershipId" TEXT,
    "initiatedByMembershipId" TEXT,
    "correlationId" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_record_mappings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerEntityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalVersion" TEXT,
    "crmEntityType" TEXT NOT NULL,
    "crmRecordId" TEXT,
    "lastInboundChecksum" TEXT,
    "lastOutboundChecksum" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "syncState" TEXT NOT NULL DEFAULT 'Active',
    "lastWriteOrigin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_record_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_conflicts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "crmRecordId" TEXT,
    "externalId" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "crmValues" JSONB NOT NULL DEFAULT '{}',
    "providerValues" JSONB NOT NULL DEFAULT '{}',
    "restrictedFields" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "resolution" TEXT,
    "selectedFields" JSONB,
    "resolvedByMembershipId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionReason" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotExpiresAt" TIMESTAMP(3),

    CONSTRAINT "integration_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "providerSubscriptionId" TEXT,
    "capability" TEXT NOT NULL,
    "callbackId" TEXT NOT NULL,
    "secretCredentialId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "renewAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_webhook_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerTimestamp" TIMESTAMP(3),
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB,
    "processingStatus" TEXT NOT NULL DEFAULT 'Queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "safeErrorCode" TEXT,
    "payloadExpiresAt" TIMESTAMP(3),

    CONSTRAINT "integration_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_outbound_endpoints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventTypes" JSONB NOT NULL DEFAULT '[]',
    "secretCredentialId" TEXT,
    "timeoutMs" INTEGER NOT NULL DEFAULT 5000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByMembershipId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_outbound_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_outbound_deliveries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "durationMs" INTEGER,
    "result" TEXT NOT NULL DEFAULT 'Pending',
    "nextRetryAt" TIMESTAMP(3),
    "safeError" TEXT,
    "payload" JSONB,
    "payloadExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_outbound_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_usage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "apiCalls" INTEGER NOT NULL DEFAULT 0,
    "rateLimitHits" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "recordsIn" INTEGER NOT NULL DEFAULT 0,
    "recordsOut" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "integration_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_providers_key_key" ON "integration_providers"("key");

-- CreateIndex
CREATE UNIQUE INDEX "integration_provider_apps_organizationId_providerKey_key" ON "integration_provider_apps"("organizationId", "providerKey");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_publicId_key" ON "integration_connections"("publicId");

-- CreateIndex
CREATE INDEX "integration_connections_organizationId_providerKey_idx" ON "integration_connections"("organizationId", "providerKey");

-- CreateIndex
CREATE INDEX "integration_connections_organizationId_status_idx" ON "integration_connections"("organizationId", "status");

-- CreateIndex
CREATE INDEX "integration_credentials_connectionId_credentialType_status_idx" ON "integration_credentials"("connectionId", "credentialType", "status");

-- CreateIndex
CREATE INDEX "integration_credentials_providerAppId_credentialType_status_idx" ON "integration_credentials"("providerAppId", "credentialType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_oauth_states_stateHash_key" ON "integration_oauth_states"("stateHash");

-- CreateIndex
CREATE INDEX "integration_oauth_states_expiresAt_idx" ON "integration_oauth_states"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_policies_organizationId_key" ON "integration_policies"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sync_configurations_connectionId_capability_ent_key" ON "integration_sync_configurations"("connectionId", "capability", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sync_checkpoints_syncConfigurationId_key" ON "integration_sync_checkpoints"("syncConfigurationId");

-- CreateIndex
CREATE INDEX "integration_sync_runs_organizationId_connectionId_createdAt_idx" ON "integration_sync_runs"("organizationId", "connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "integration_record_mappings_organizationId_crmEntityType_cr_idx" ON "integration_record_mappings"("organizationId", "crmEntityType", "crmRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_record_mappings_connectionId_providerEntityType_key" ON "integration_record_mappings"("connectionId", "providerEntityType", "externalId");

-- CreateIndex
CREATE INDEX "integration_conflicts_organizationId_status_idx" ON "integration_conflicts"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_webhook_subscriptions_callbackId_key" ON "integration_webhook_subscriptions"("callbackId");

-- CreateIndex
CREATE INDEX "integration_webhook_events_organizationId_processingStatus_idx" ON "integration_webhook_events"("organizationId", "processingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "integration_webhook_events_subscriptionId_providerEventId_key" ON "integration_webhook_events"("subscriptionId", "providerEventId");

-- CreateIndex
CREATE INDEX "integration_outbound_endpoints_organizationId_idx" ON "integration_outbound_endpoints"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_outbound_deliveries_deliveryId_key" ON "integration_outbound_deliveries"("deliveryId");

-- CreateIndex
CREATE INDEX "integration_outbound_deliveries_result_nextRetryAt_idx" ON "integration_outbound_deliveries"("result", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_outbound_deliveries_endpointId_eventId_key" ON "integration_outbound_deliveries"("endpointId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_tasks_dedupeKey_key" ON "integration_tasks"("dedupeKey");

-- CreateIndex
CREATE INDEX "integration_tasks_status_runAfter_idx" ON "integration_tasks"("status", "runAfter");

-- CreateIndex
CREATE INDEX "integration_tasks_organizationId_status_idx" ON "integration_tasks"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_usage_connectionId_day_key" ON "integration_usage"("connectionId", "day");

-- CreateIndex
CREATE INDEX "integration_logs_organizationId_createdAt_idx" ON "integration_logs"("organizationId", "createdAt");

