import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as ctrl from "../../controllers/support/supportSettingsController.js";
import * as tickets from "../../controllers/support/ticketsController.js";
import * as sla from "../../controllers/support/supportSlaController.js";

// Backend Phase 4 — Support configuration under /api/v1/support.
// Session-cookie auth, CSRF on writes, deny-by-default RBAC per module.
const router = Router();
router.use(authenticateCookie);

const can = (moduleId, action) => requireCrmOrgPermission(moduleId, action);
const write = (moduleId, action) => [requireCsrf, can(moduleId, action)];

router.get("/inboxes", can("support_inboxes", "view"), asyncHandler(ctrl.listInboxes));
router.post("/inboxes", ...write("support_inboxes", "configure"), asyncHandler(ctrl.createInbox));
router.get("/inboxes/:inboxId", can("support_inboxes", "view"), asyncHandler(ctrl.getInbox));
router.patch("/inboxes/:inboxId", ...write("support_inboxes", "configure"), asyncHandler(ctrl.updateInbox));
router.post("/inboxes/:inboxId/archive", ...write("support_inboxes", "configure"), asyncHandler(ctrl.archiveInbox));

router.get("/queues", can("support_queues", "view"), asyncHandler(ctrl.listQueues));
router.post("/queues", ...write("support_queues", "configure"), asyncHandler(ctrl.createQueue));
router.get("/queues/:queueId", can("support_queues", "view"), asyncHandler(ctrl.getQueue));
router.patch("/queues/:queueId", ...write("support_queues", "configure"), asyncHandler(ctrl.updateQueue));
router.post("/queues/:queueId/archive", ...write("support_queues", "configure"), asyncHandler(ctrl.archiveQueue));
router.get("/queues/:queueId/members", can("support_queues", "view"), asyncHandler(ctrl.listQueueMembers));
router.post("/queues/:queueId/members", ...write("support_queues", "configure"), asyncHandler(ctrl.addQueueMember));
router.delete("/queues/:queueId/members/:membershipId", ...write("support_queues", "configure"), asyncHandler(ctrl.removeQueueMember));

router.get("/categories", can("tickets", "view"), asyncHandler(ctrl.listCategories));
router.post("/categories", ...write("support_queues", "configure"), asyncHandler(ctrl.createCategory));
router.patch("/categories/:categoryId", ...write("support_queues", "configure"), asyncHandler(ctrl.updateCategory));
router.post("/categories/:categoryId/archive", ...write("support_queues", "configure"), asyncHandler(ctrl.archiveCategory));

router.get("/canned-responses", can("canned_responses", "view"), asyncHandler(ctrl.listCannedResponses));
router.post("/canned-responses", ...write("canned_responses", "configure"), asyncHandler(ctrl.createCannedResponse));
router.patch("/canned-responses/:responseId", ...write("canned_responses", "configure"), asyncHandler(ctrl.updateCannedResponse));
router.post("/canned-responses/:responseId/archive", ...write("canned_responses", "configure"), asyncHandler(ctrl.archiveCannedResponse));

// Messages are addressed directly for edits and archiving; the ticket they
// belong to must still be in the caller's scope.
router.patch("/messages/:messageId", ...write("tickets", "reply"), asyncHandler(tickets.editMessage));
router.post("/messages/:messageId/archive", ...write("tickets", "edit"), asyncHandler(tickets.archiveMessage));

// SLA: business hours, versioned policies, entitlements
router.get("/business-hours", can("support_sla", "view"), asyncHandler(sla.listCalendars));
router.post("/business-hours", ...write("support_sla", "configure"), asyncHandler(sla.createCalendar));
router.patch("/business-hours/:calendarId", ...write("support_sla", "configure"), asyncHandler(sla.updateCalendar));

router.get("/sla-policies", can("support_sla", "view"), asyncHandler(sla.listPolicies));
router.post("/sla-policies", ...write("support_sla", "configure"), asyncHandler(sla.createPolicy));
router.get("/sla-policies/:policyId", can("support_sla", "view"), asyncHandler(sla.getPolicy));
router.patch("/sla-policies/:policyId", ...write("support_sla", "configure"), asyncHandler(sla.updatePolicy));
router.post("/sla-policies/:policyId/new-version", ...write("support_sla", "configure"), asyncHandler(sla.newPolicyVersion));
router.post("/sla-policies/:policyId/archive", ...write("support_sla", "configure"), asyncHandler(sla.archivePolicy));

router.get("/entitlements", can("support_entitlements", "view"), asyncHandler(sla.listEntitlements));
router.post("/entitlements", ...write("support_entitlements", "configure"), asyncHandler(sla.createEntitlement));
router.get("/entitlements/:entitlementId", can("support_entitlements", "view"), asyncHandler(sla.getEntitlement));
router.patch("/entitlements/:entitlementId", ...write("support_entitlements", "configure"), asyncHandler(sla.updateEntitlement));
router.post("/tickets/:ticketId/entitlement", ...write("support_entitlements", "configure"), asyncHandler(sla.overrideTicketEntitlement));

export default router;
