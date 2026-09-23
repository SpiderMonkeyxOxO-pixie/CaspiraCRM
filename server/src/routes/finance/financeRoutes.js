import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as invoices from "../../controllers/finance/invoicesController.js";
import * as expenses from "../../controllers/finance/expensesController.js";
import * as recurring from "../../controllers/finance/recurringInvoicesController.js";
import * as setup from "../../controllers/finance/ledgerSetupController.js";
import * as journals from "../../controllers/finance/journalsController.js";
import * as reports from "../../controllers/finance/expenseReportsController.js";
import * as bills from "../../controllers/finance/billsController.js";
import { requireIdempotencyKey } from "../../middleware/idempotency.js";

// Backend Phase 6 — organization-scoped Finance. Session-cookie
// authenticated, CSRF-protected, RBAC-gated per action on the "invoices",
// "payments", "expenses" and "recurring_invoices" modules, organizationId
// resolved from query/body and checked against a live membership.
const router = Router();
router.use(authenticateCookie);

const can = (moduleId, action) => requireCrmOrgPermission(moduleId, action);
const write = (moduleId, action) => [requireCsrf, can(moduleId, action)];
const once = (scope) => requireIdempotencyKey(scope);

// ---- Backend Phase 6 (full spec): configuration and the general ledger ----
router.get("/settings", can("finance_configuration", "view"), asyncHandler(setup.getFinanceSettings));
router.patch("/settings", ...write("finance_configuration", "configure"), asyncHandler(setup.updateFinanceSettings));
router.post("/setup/chart-of-accounts", ...write("finance_configuration", "configure"), asyncHandler(setup.initializeChart));
router.get("/overrides", can("finance_overrides", "view"), asyncHandler(setup.listOverrides));

router.get("/fiscal-years", can("fiscal_periods", "view"), asyncHandler(setup.listFiscalYears));
router.post("/fiscal-years", ...write("fiscal_periods", "configure"), asyncHandler(setup.createFiscalYear));
router.post("/periods/:periodId/soft-close", ...write("fiscal_periods", "close"), asyncHandler(setup.softClosePeriod));
router.post("/periods/:periodId/close", ...write("fiscal_periods", "close"), asyncHandler(setup.closePeriod));
router.post("/periods/:periodId/reopen", ...write("fiscal_periods", "reopen"), asyncHandler(setup.reopenPeriod));

router.get("/accounts", can("ledger_accounts", "view"), asyncHandler(setup.listAccounts));
router.post("/accounts", ...write("ledger_accounts", "configure"), asyncHandler(setup.createAccount));
router.patch("/accounts/:accountId", ...write("ledger_accounts", "configure"), asyncHandler(setup.updateAccount));
router.post("/accounts/:accountId/archive", ...write("ledger_accounts", "configure"), asyncHandler(setup.archiveAccount));

router.get("/cost-centers", can("finance_configuration", "view"), asyncHandler(setup.listCostCenters));
router.post("/cost-centers", ...write("finance_configuration", "configure"), asyncHandler(setup.createCostCenter));
router.patch("/cost-centers/:costCenterId", ...write("finance_configuration", "configure"), asyncHandler(setup.updateCostCenter));
router.post("/cost-centers/:costCenterId/archive", ...write("finance_configuration", "configure"), asyncHandler(setup.archiveCostCenter));

router.get("/tax-rates", can("finance_configuration", "view"), asyncHandler(setup.listTaxRates));
router.post("/tax-rates", ...write("finance_configuration", "configure"), asyncHandler(setup.createTaxRate));
router.patch("/tax-rates/:taxRateId", ...write("finance_configuration", "configure"), asyncHandler(setup.updateTaxRate));

router.get("/exchange-rates", can("finance_configuration", "view"), asyncHandler(setup.listExchangeRates));
router.post("/exchange-rates", ...write("finance_configuration", "configure"), asyncHandler(setup.createExchangeRate));
router.post("/exchange-rates/:rateId/approve", ...write("finance_configuration", "approve"), asyncHandler(setup.approveExchangeRate));

router.get("/journals", can("journals", "view"), asyncHandler(journals.listJournals));
router.post("/journals", ...write("journals", "create"), asyncHandler(journals.createJournalEntry));
router.get("/journals/:journalId", can("journals", "view"), asyncHandler(journals.getJournal));
router.patch("/journals/:journalId", ...write("journals", "create"), asyncHandler(journals.updateJournalEntry));
router.post("/journals/:journalId/submit", ...write("journals", "create"), asyncHandler(journals.submitJournal));
router.post("/journals/:journalId/approve", ...write("journals", "approve"), asyncHandler(journals.approveJournal));
router.post("/journals/:journalId/post", ...write("journals", "post"), once("finance.journal.post"), asyncHandler(journals.postJournalEntry));
router.post("/journals/:journalId/reverse", ...write("journals", "reverse"), once("finance.journal.reverse"), asyncHandler(journals.reverseJournalEntry));
router.post("/journals/:journalId/cancel", ...write("journals", "create"), asyncHandler(journals.cancelJournal));

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
router.get("/expenses/:expenseId", can("expenses", "view"), asyncHandler(expenses.getOne));
router.patch("/expenses/:expenseId", ...write("expenses", "create"), asyncHandler(expenses.update));
router.post("/expenses/:expenseId/submit", ...write("expenses", "submit"), asyncHandler(expenses.submit));
router.post("/expenses/:expenseId/review", ...write("expenses", "view"), asyncHandler(expenses.review));
router.post("/expenses/:expenseId/post", ...write("expenses", "post"), once("finance.expense.post"), asyncHandler(expenses.post));
router.post("/expenses/:expenseId/reimburse", ...write("expenses", "reimburse"), once("finance.expense.reimburse"), asyncHandler(expenses.reimburse));
router.post("/expenses/:expenseId/cancel", ...write("expenses", "view"), asyncHandler(expenses.cancel));

// Expense reports
router.get("/expense-reports", can("expenses", "view"), asyncHandler(reports.listReports));
router.post("/expense-reports", ...write("expenses", "create"), asyncHandler(reports.createReport));
router.get("/expense-reports/:reportId", can("expenses", "view"), asyncHandler(reports.getReport));
router.put("/expense-reports/:reportId/expenses", ...write("expenses", "create"), asyncHandler(reports.setReportExpenses));
router.post("/expense-reports/:reportId/submit", ...write("expenses", "submit"), asyncHandler(reports.submitReport));
router.post("/expense-reports/:reportId/start-review", ...write("expenses", "approve"), asyncHandler(reports.startReview));
router.post("/expense-reports/:reportId/approve", ...write("expenses", "approve"), asyncHandler(reports.approveReport));
router.post("/expense-reports/:reportId/reject", ...write("expenses", "reject"), asyncHandler(reports.rejectReport));
router.post("/expense-reports/:reportId/post", ...write("expenses", "post"), once("finance.expense_report.post"), asyncHandler(reports.postReport));
router.post("/expense-reports/:reportId/reimburse", ...write("expenses", "reimburse"), once("finance.expense_report.reimburse"), asyncHandler(reports.reimburseReport));
router.post("/expense-reports/:reportId/cancel", ...write("expenses", "create"), asyncHandler(reports.cancelReport));

// Vendors and bills
router.get("/vendors", can("vendors", "view"), asyncHandler(bills.listVendors));
router.post("/vendors", ...write("vendors", "configure"), asyncHandler(bills.createVendor));
router.patch("/vendors/:vendorId", ...write("vendors", "configure"), asyncHandler(bills.updateVendor));
router.get("/bills", can("bills", "view"), asyncHandler(bills.listBills));
router.post("/bills", ...write("bills", "create"), asyncHandler(bills.createBill));
router.get("/bills/:billId", can("bills", "view"), asyncHandler(bills.getBill));
router.patch("/bills/:billId", ...write("bills", "edit"), asyncHandler(bills.updateBill));
router.post("/bills/:billId/submit", ...write("bills", "submit"), asyncHandler(bills.submitBill));
router.post("/bills/:billId/approve", ...write("bills", "approve"), asyncHandler(bills.approveBill));
router.post("/bills/:billId/post", ...write("bills", "post"), once("finance.bill.post"), asyncHandler(bills.postBill));
router.post("/bills/:billId/dispute", ...write("bills", "edit"), asyncHandler(bills.disputeBill));
router.post("/bills/:billId/resolve-dispute", ...write("bills", "approve"), asyncHandler(bills.resolveDispute));
router.post("/bills/:billId/void", ...write("bills", "cancel"), asyncHandler(bills.voidBill));

// Recurring invoices — generating one creates an invoice, so it needs
// invoices:create as well as access to the template.
router.get("/recurring-invoices", can("recurring_invoices", "view"), asyncHandler(recurring.list));
router.post("/recurring-invoices", ...write("recurring_invoices", "create"), asyncHandler(recurring.create));
router.patch("/recurring-invoices/:recurringId", ...write("recurring_invoices", "edit"), asyncHandler(recurring.update));
router.post("/recurring-invoices/:recurringId/generate", requireCsrf, can("recurring_invoices", "view"), can("invoices", "create"), asyncHandler(recurring.generate));

export default router;
