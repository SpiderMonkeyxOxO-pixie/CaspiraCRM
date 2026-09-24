import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie, optionalAuthenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as c from "../../integrations/api/connectionsController.js";
import * as s from "../../integrations/api/syncController.js";
import * as w from "../../integrations/api/webhooksController.js";
import * as a from "../../integrations/api/actionsController.js";

// Backend Phase 8 — /api/v1/integrations. Session-cookie auth, CSRF on
// writes, RBAC per action (deny by default), organizationId from query or
// body checked against a live membership. Portal logins have no
// membership, so every route here refuses them.
const router = Router();
const can = (m, a) => requireCrmOrgPermission(m, a);
const write = (m, a) => [requireCsrf, can(m, a)];

// The OAuth callback is a browser redirect from the provider: the state
// record carries the organization; the session (if any) must be the
// initiating user. Always answers with a redirect.
router.get("/oauth/:providerKey/callback", optionalAuthenticateCookie, asyncHandler(c.oauthCallback));

router.use(authenticateCookie);

router.get("/providers", can("integration_catalog", "view"), c.listProviders);
router.get("/providers/:providerKey", can("integration_catalog", "view"), c.getProvider);
router.patch("/providers/:providerKey", ...write("integration_catalog", "configure"), c.updateProvider);
router.get("/providers/:providerKey/app", can("integration_catalog", "view"), c.getProviderApp);
router.put("/providers/:providerKey/app", ...write("integration_catalog", "view"), c.saveProviderApp);

router.post("/oauth/:providerKey/start", ...write("integration_catalog", "view"), c.oauthStart);

router.get("/connections", can("integration_connections", "view"), c.listConnections);
router.post("/connections", ...write("integration_catalog", "view"), c.createConnection);
router.get("/connections/:connectionId", can("integration_connections", "view"), c.getConnection);
router.patch("/connections/:connectionId", ...write("integration_connections", "view"), c.updateConnection);
router.get("/connections/:connectionId/scopes", can("integration_scopes", "view"), c.getScopes);
router.post("/connections/:connectionId/test", ...write("integration_connections", "view"), c.testConnection);
router.post("/connections/:connectionId/reauthorize", ...write("integration_connections", "reauthorize"), c.reauthorizeConnection);
router.post("/connections/:connectionId/disconnect", ...write("integration_connections", "disconnect"), c.disconnectConnection);
router.post("/connections/:connectionId/pause", ...write("integration_connections", "view"), c.pauseConnection);
router.post("/connections/:connectionId/resume", ...write("integration_connections", "view"), c.resumeConnection);
router.post("/connections/:connectionId/rotate-credentials", ...write("integration_connections", "view"), c.rotateConnectionCredentials);

router.get("/connections/:connectionId/sync-configurations", can("integration_sync", "view"), s.listConfigurations);
router.post("/connections/:connectionId/sync-configurations", ...write("integration_sync", "configure"), s.saveConfiguration);
router.post("/connections/:connectionId/sync-preview", ...write("integration_sync", "preview"), s.createSyncPreview);
// Explicit actions (notify, draft, link email): preview, then confirm.
router.get("/connections/:connectionId/actions", can("integration_sync", "view"), a.listActions);
router.post("/connections/:connectionId/actions/preview", ...write("integration_sync", "preview"), a.previewActionHandler);
router.post("/connections/:connectionId/actions/execute", ...write("integration_sync", "execute"), a.executeActionHandler);
router.post("/connections/:connectionId/sync", ...write("integration_sync", "execute"), s.runSync);
router.get("/connections/:connectionId/mappings", can("integration_sync", "view"), s.listMappings);
router.get("/sync-runs", can("integration_sync", "view"), s.listRuns);
router.get("/sync-runs/:runId", can("integration_sync", "view"), s.getRun);
router.post("/sync-runs/:runId/cancel", ...write("integration_sync", "cancel"), s.cancelRun);
router.get("/conflicts", can("integration_conflicts", "view"), s.listConflicts);
// Owner of the (personal) connection, or integration_conflicts:resolve — checked in the handler.
router.post("/conflicts/:conflictId/resolve", ...write("integration_conflicts", "view"), s.resolveConflictHandler);
router.get("/logs", can("integration_logs", "view"), s.listLogs);
router.get("/usage", can("integration_logs", "view"), s.usage);
router.get("/audit", can("integration_audit", "view"), s.listAudit);
router.get("/dead-letters", can("integration_logs", "view"), s.listDeadLetters);
router.post("/dead-letters/:taskId/retry", ...write("integration_sync", "execute"), s.retryDeadLetterHandler);

router.get("/webhooks", can("integration_webhooks", "view"), w.listWebhooks);
router.post("/connections/:connectionId/webhook-subscriptions", ...write("integration_webhooks", "view"), w.createSubscriptionHandler);
router.post("/webhook-subscriptions/:subscriptionId/rotate-secret", ...write("integration_webhooks", "configure"), w.rotateSubscriptionHandler);
router.delete("/webhook-subscriptions/:subscriptionId", ...write("integration_webhooks", "configure"), w.deleteSubscriptionHandler);

router.get("/outbound-webhooks", can("integration_outbound_webhooks", "view"), w.listOutbound);
router.post("/outbound-webhooks", ...write("integration_outbound_webhooks", "configure"), w.createOutbound);
router.patch("/outbound-webhooks/:endpointId", ...write("integration_outbound_webhooks", "configure"), w.updateOutbound);
router.post("/outbound-webhooks/:endpointId/rotate-secret", ...write("integration_outbound_webhooks", "configure"), w.rotateOutboundSecret);
router.post("/outbound-webhooks/:endpointId/test", ...write("integration_outbound_webhooks", "configure"), w.testOutbound);
router.delete("/outbound-webhooks/:endpointId", ...write("integration_outbound_webhooks", "configure"), w.deleteOutbound);

router.get("/policies", can("integration_policies", "view"), c.getPolicyHandler);
router.patch("/policies", ...write("integration_policies", "configure"), c.updatePolicyHandler);

export default router;
