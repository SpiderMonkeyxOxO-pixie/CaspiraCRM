// Finance page guides. Plain language for everyday staff; tour targets are
// data-tour="…" attributes (or a Panel's tour prop) on the pages.
const RECORDS_ONLY =
  "Finance records money; it never moves it. Payments are entries you make after the money has arrived or left, and nothing is sent to a bank or emailed to a customer.";

const finance = [
  {
    path: "/finance/dashboard",
    title: "Finance Dashboard",
    purpose: "What customers owe you, what has come in, and which invoices are late.",
    sections: [
      { heading: "Key figures", body: "Outstanding is what customers still owe. Overdue is the part past its due date. Revenue adds up paid invoices. Expenses Pending Review counts expenses waiting for approval. Click a card to open the list behind it." },
      { heading: "Invoices by Status", body: "How many invoices are Draft, Approved, Sent, Partially Paid, Paid or Overdue." },
      { heading: "Receivables Aging", body: "Unpaid money grouped by how late it is: not yet due, 1–30, 31–60, 61–90 and over 90 days. The further right, the harder it usually is to collect." },
      { heading: "Invoices Needing Attention", body: "Overdue invoices, largest balance first. Start chasing from the top." },
    ],
    tips: [RECORDS_ONLY],
    tour: [
      { target: "finance-kpis", title: "Money at a glance", body: "Outstanding and overdue money, revenue from paid invoices, and expenses waiting for review. Click a card to see the details." },
      { target: "finance-charts", title: "Status and age", body: "Invoices by status, and unpaid money by how many days late it is." },
    ],
  },
  {
    path: "/finance/invoices",
    title: "Invoices",
    purpose: "Every bill you send to customers, with what is still owed on each.",
    sections: [
      { heading: "Where invoices come from", body: "You don't type invoices here. They are created as drafts from an order (Request Invoice on the order's Billing tab) or from a recurring invoice (Generate Now)." },
      { heading: "How an invoice moves", body: "Draft → Approved → Posted to the ledger → Sent → Partially Paid → Paid. An unpaid invoice past its due date shows as Overdue. Void cancels an invoice with a reason." },
      { heading: "Search and filter", body: "Search by invoice number or company and filter by status. The total outstanding for the invoices shown is at the top." },
    ],
    tips: [RECORDS_ONLY],
    tour: [
      { target: "invoices-filters", title: "Find an invoice", body: "Search by number or company, and filter by status." },
      { target: "invoices-table", title: "Your invoices", body: "Total, amount still due, due date and status. Click one to open it." },
    ],
  },
  {
    path: "/finance/invoices/:id",
    title: "Invoice",
    purpose: "One invoice: its lines and totals, the payments against it, and the next step to take.",
    sections: [
      { heading: "Approve", body: "A draft must be approved before it can be sent. Invoices of 10,000 or more must be approved by someone other than the person who created them." },
      { heading: "Post and send", body: "Post to ledger & mark as sent records the invoice in the accounts. Nothing is emailed: use Download PDF and send the invoice to the customer yourself." },
      { heading: "Record Payment", body: "When the customer has paid, record the amount and method. The payment is a draft until someone approves and posts it in Approvals & Posting; only then does the amount due go down." },
      { heading: "Issue Credit Note", body: "Reduces what the customer owes, for example after a refund or a discount agreed later. It also needs approval before it counts." },
      { heading: "Void", body: "Cancels the invoice, with a reason. Use it for invoices made by mistake." },
    ],
    tips: ["The buttons you see depend on your Finance role. If a step is missing, ask your Finance Manager."],
    tour: [
      { target: "invoice-actions", title: "Next steps", body: "Approve, post and mark as sent, record a payment, issue a credit note or void. Only the steps your role allows are shown." },
      { target: "invoice-pdf", title: "Send it yourself", body: "Download the PDF and email it to the customer. The system doesn't send invoices." },
      { target: "invoice-lines", title: "Lines and totals", body: "What is being billed, tax, and what has been paid, credited and is still due." },
      { target: "invoice-payments", title: "Payments", body: "Payments applied to this invoice, and any still waiting for approval." },
    ],
  },
  {
    path: "/finance/payments",
    title: "Payments",
    purpose: "Every payment recorded against invoices and bills. " + RECORDS_ONLY,
    sections: [
      { heading: "Statuses", body: "Draft and Submitted payments are waiting. Approved ones still need posting. Posted payments have reduced what the invoice or bill owes. Reversed and Cancelled ones no longer count." },
      { heading: "Approvals & Posting", body: "The button at the top opens the queue where payments are approved and posted." },
    ],
    tour: [
      { target: "payments-filters", title: "Filter by status", body: "For example, show only payments still waiting to be posted." },
      { target: "payments-table", title: "Recorded payments", body: "Direction (money in or out), date, method, amount, and which invoice or bill it was applied to." },
    ],
  },
  {
    path: "/finance/credit-notes",
    title: "Credit Notes",
    purpose: "A credit note reduces what a customer owes on an invoice, for example after a refund or a late discount.",
    sections: [
      { heading: "Issuing one", body: "Open the invoice and use Issue Credit Note. It counts once someone else has approved it and it has been posted." },
      { heading: "The list", body: "Click a credit note number to open the invoice it belongs to." },
    ],
    tour: [{ target: "creditnotes-table", title: "Credit notes", body: "Amount, reason and date. Click a number to open its invoice." }],
  },
  {
    path: "/finance/expenses",
    title: "Expenses",
    purpose: "Money spent for the business, such as travel or software, submitted for approval so it can be recorded and, if needed, paid back.",
    sections: [
      { heading: "Submitting", body: "Submit Expense asks for a description, a category (Travel, Software, Office Supplies, Meals, Other) and the amount." },
      { heading: "Approving", body: "A Pending expense can be approved (tick) or rejected (cross) by someone allowed to review expenses. You can't approve your own." },
      { heading: "After approval", body: "Approved expenses are posted to the accounts and reimbursements are recorded in Approvals & Posting. Recording a reimbursement doesn't pay anyone; pay them yourself." },
    ],
    tour: [
      { target: "expenses-add", title: "Submit an expense", body: "Describe it, choose a category and enter the amount." },
      { target: "expenses-table", title: "Expenses", body: "Who submitted what, and its status. Reviewers approve or reject pending ones here." },
    ],
  },
  {
    path: "/finance/recurring-invoices",
    title: "Recurring Invoices",
    purpose: "Templates for invoices you send regularly, such as a monthly subscription.",
    sections: [
      { heading: "Creating one", body: "New Recurring Invoice asks for the company, the interval (Weekly, Monthly, Quarterly, Annually) and the lines to bill." },
      { heading: "Generate Now", body: "Invoices are not created automatically. When one is due, press Generate Now: it creates a draft invoice that then goes through the normal approval." },
      { heading: "Pausing", body: "Click Active to pause a template, and Paused to resume it. A paused template can't generate invoices." },
    ],
    tips: ["Put a reminder in your calendar for each recurring invoice, since nothing generates them for you."],
    tour: [
      { target: "recurring-add", title: "Set up a recurring invoice", body: "Choose the company, how often, and what to bill." },
      { target: "recurring-table", title: "Your templates", body: "How many invoices each has produced and when. Generate Now creates the next draft invoice." },
    ],
  },
  {
    path: "/finance/approvals",
    title: "Approvals & Posting",
    purpose: "Everything in Finance waiting for a person: invoices, payments, credit notes, vendor bills, expenses, journals, budgets and reconciliations.",
    sections: [
      { heading: "Why two people", body: "For control, the person who prepares an item usually can't approve or post it too. The system checks this on every step." },
      { heading: "Approve, post, reject", body: "Approve accepts an item. Post records it in the accounts, which is when it changes balances. Reject or Cancel stops it, with a reason." },
      { heading: "Your role", body: "You only see the steps your Finance role allows. Refresh reloads the queue." },
    ],
    tour: [{ target: "approvals-queue", title: "Waiting for you", body: "One section per kind of item. Each row shows the steps you're allowed to take." }],
  },
  {
    path: "/finance/reports",
    title: "Finance Reports",
    purpose: "Financial statements and operational reports, such as Profit & Loss, Balance Sheet, aging and expenses.",
    sections: [
      { heading: "Choosing a report", body: "Statements (Profit & Loss, Balance Sheet, Cash Flow, Trial Balance, General Ledger) are built only from posted entries. Document reports (invoices, bills, payments, aging) list the records themselves. Planning covers budget against actual." },
      { heading: "Dates and options", body: "Pick the period, and for some reports an account or a budget, then run the report." },
      { heading: "Good to know", body: "These reports are for running the business; they are not audited accounts. Tax Summary is an estimate. Amounts in different currencies are kept apart." },
    ],
    tour: [{ target: "reports-picker", title: "Pick a report", body: "Choose the report and its dates, then run it." }],
  },
  {
    path: "/finance/setup",
    title: "Finance Setup",
    purpose: "The groundwork Finance needs before anything can be posted: accounts, fiscal periods, controls and who may do what. Usually done once by a Finance Manager.",
    sections: [
      { heading: "Checklist", body: "What is set up and what is still missing." },
      { heading: "Chart of accounts", body: "The list of account codes. The starter chart adds a standard set; running it again adds nothing twice." },
      { heading: "Fiscal years and periods", body: "Monthly periods. A period is soft-closed and then closed by two different people; a closed period refuses new postings until it is reopened with a reason." },
      { heading: "Controls", body: "Settings such as the invoice approval limit. Every change is recorded in the audit log." },
      { heading: "Financial accounts", body: "Where money is recorded: bank, cash or card. Only the last 4 digits of an account number are stored." },
      { heading: "Finance roles", body: "Finance Manager approves, posts and closes periods. Accountant prepares and posts. Give these roles to the right people here." },
    ],
    tour: [
      { target: "setup-checklist", title: "What's left to do", body: "Work through the checklist from top to bottom." },
      { target: "setup-controls", title: "Controls", body: "Approval limits and other rules. Changes are audited." },
      { target: "setup-accounts", title: "Financial accounts", body: "Add the bank, cash and card accounts payments are recorded against." },
    ],
  },
];

export default finance;
