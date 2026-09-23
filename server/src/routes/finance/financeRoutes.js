import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as invoices from "../../controllers/finance/invoicesController.js";
import * as expenses from "../../controllers/finance/expensesController.js";
import * as recurring from "../../controllers/finance/recurringInvoicesController.js";

// Backend Phase 6 — organization-scoped Finance. Session-cookie
// authenticated, CSRF-protected, RBAC-gated per action on the "invoices",
// "payments", "expenses" and "recurring_invoices" modules, organizationId
// resolved from query/body and checked against a live membership.
const router = Router();
router.use(authenticateCookie);

const can = (moduleId, action) => requireCrmOrgPermission(moduleId, action);
const write = (moduleId, action) => [requireCsrf, can(moduleId, action)];

// Invoices
router.get("/invoices", can("invoices", "view"), asyncHandler(invoices.list));
router.post("/invoices", ...write("invoices", "create"), asyncHandler(invoices.create));
router.get("/invoices/:invoiceId", can("invoices", "view"), asyncHandler(invoices.getOne));
router.patch("/invoices/:invoiceId", ...write("invoices", "edit"), asyncHandler(invoices.update));
router.post("/invoices/:invoiceId/approve", ...write("invoices", "approve"), asyncHandler(invoices.approve));
router.post("/invoices/:invoiceId/send", ...write("invoices", "issue"), asyncHandler(invoices.send));
router.post("/invoices/:invoiceId/void", ...write("invoices", "cancel"), asyncHandler(invoices.voidInvoice));
router.post("/invoices/:invoiceId/payments", ...write("payments", "create"), asyncHandler(invoices.recordPayment));

// Credit notes (belong to invoices)
router.get("/credit-notes", can("invoices", "view"), asyncHandler(invoices.listCreditNotes));
router.post("/credit-notes", ...write("invoices", "credit"), asyncHandler(invoices.issueCreditNote));

// Expenses — approve/reject is checked inside (it depends on the decision)
router.get("/expenses", can("expenses", "view"), asyncHandler(expenses.list));
router.post("/expenses", ...write("expenses", "create"), asyncHandler(expenses.create));
router.post("/expenses/:expenseId/review", ...write("expenses", "view"), asyncHandler(expenses.review));

// Recurring invoices — generating one creates an invoice, so it needs
// invoices:create as well as access to the template.
router.get("/recurring-invoices", can("recurring_invoices", "view"), asyncHandler(recurring.list));
router.post("/recurring-invoices", ...write("recurring_invoices", "create"), asyncHandler(recurring.create));
router.patch("/recurring-invoices/:recurringId", ...write("recurring_invoices", "edit"), asyncHandler(recurring.update));
router.post("/recurring-invoices/:recurringId/generate", requireCsrf, can("recurring_invoices", "view"), can("invoices", "create"), asyncHandler(recurring.generate));

export default router;
