import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requirePortalAccount } from "../../middleware/portal.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import * as support from "../../controllers/support/portalSupportController.js";

// Customer Portal API (/api/v1/portal). A separate surface from the staff
// API: portal logins pass requirePortalAccount (an admin-linked,
// non-suspended PortalAccount) and get customer-only serializers. Staff
// routes stay closed to them because those require an organization
// membership.
const router = Router();
router.use(authenticateCookie, requirePortalAccount);

router.get("/support/tickets", asyncHandler(support.listTickets));
router.post("/support/tickets", requireCsrf, requireIdempotencyKey("portal.ticket.create"), asyncHandler(support.createTicket));
router.get("/support/tickets/:ticketId", asyncHandler(support.getTicket));
router.post("/support/tickets/:ticketId/replies", requireCsrf, requireIdempotencyKey("portal.ticket.reply"), asyncHandler(support.reply));
router.post("/support/tickets/:ticketId/satisfaction", requireCsrf, requireIdempotencyKey("portal.ticket.csat"), asyncHandler(support.submitSatisfaction));

router.get("/knowledge-base/categories", asyncHandler(support.listKbCategories));
router.get("/knowledge-base/articles", asyncHandler(support.listKbArticles));
router.get("/knowledge-base/articles/:slug", asyncHandler(support.getKbArticle));

export default router;
