import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requirePortalAccount } from "../../middleware/portal.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";
import * as support from "../../controllers/support/portalSupportController.js";
import * as projects from "../../controllers/projects/portalProjectsController.js";
import * as finance from "../../controllers/finance/portalFinanceController.js";

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

// Backend Phase 5 — the customer's projects (customer-visible only).
router.get("/projects", asyncHandler(projects.listProjects));
router.get("/projects/:projectId", asyncHandler(projects.getProject));
router.get("/projects/:projectId/milestones", asyncHandler(projects.listMilestones));
router.get("/projects/:projectId/deliverables", asyncHandler(projects.listDeliverables));
router.post("/projects/:projectId/deliverables/:deliverableId/accept", requireCsrf, requireIdempotencyKey("portal.deliverable.accept"), asyncHandler(projects.acceptDeliverable));
router.post("/projects/:projectId/deliverables/:deliverableId/request-changes", requireCsrf, requireIdempotencyKey("portal.deliverable.changes"), asyncHandler(projects.requestDeliverableChanges));
router.get("/projects/:projectId/comments", asyncHandler(projects.listComments));
router.post("/projects/:projectId/comments", requireCsrf, asyncHandler(projects.addComment));

// Backend Phase 6 — the customer's posted invoices, credit notes and
// recorded payments (read-only; no "Pay now").
router.get("/finance/invoices", asyncHandler(finance.listInvoices));
router.get("/finance/invoices/:invoiceId", asyncHandler(finance.getInvoice));
router.get("/finance/credit-notes", asyncHandler(finance.listCreditNotes));
router.get("/finance/payments", asyncHandler(finance.listPayments));

export default router;
