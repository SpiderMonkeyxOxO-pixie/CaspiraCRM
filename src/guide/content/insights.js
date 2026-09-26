// AI, Analytics and Reports page guides. Plain language for everyday staff;
// the administration pages get a short written guide without a tour.
const ADMIN_ONLY = "Only people given AI administration access see this page.";

const insights = [
  // ── AI ──────────────────────────────────────────────────────────────
  {
    path: "/ai/overview",
    title: "AI Intelligence Overview",
    purpose: "A quick check of your sales, activities, contracts and data quality that points out risks and opportunities, with the evidence behind each one. It uses built-in rules in your browser; nothing is sent to an AI provider.",
    sections: [
      { heading: "Generating an analysis", body: "Choose the view, the date range and the owner at the top, then press Generate Analysis. Change the filters later and press Regenerate to refresh it." },
      { heading: "Insight cards", body: "Each card explains a finding, how confident it is and why. Evidence opens the records and the calculation behind it. Mark cards helpful or dismiss them." },
      { heading: "Suggested actions", body: "Some cards suggest a step, such as scheduling a follow-up. Nothing changes until you open the suggestion and confirm it, and only if your role allows." },
      { heading: "What it covers", body: "Sales, activities, data quality and contracts. Support, projects and finance are not included yet." },
      { heading: "Download PDF", body: "Saves the current analysis as a report you can share." },
    ],
    tips: ["This page never changes a record by itself: every suggestion waits for a person to confirm it."],
    tour: [
      { target: "ai-source", title: "How it works", body: "Built-in rules over the records you can see. Nothing is sent to an AI provider." },
      { target: "ai-generate", title: "Run the analysis", body: "Set the view and dates above, then generate. Findings appear as cards with their evidence." },
    ],
  },
  {
    path: "/ai/copilot",
    title: "AI Copilot",
    purpose: "Ask questions about your customers, pipeline and renewals in plain language. The Copilot only reads records you are allowed to open, shows its sources, and never changes anything without your confirmation.",
    sections: [
      { heading: "Asking", body: "Type a question such as \"Which deals are at risk this month?\" and press Enter. Each statement in the answer links to the record it came from." },
      { heading: "Modes", body: "Ask is a normal conversation. Briefing, Meeting prep, Pipeline, Renewals, Data quality and My day give answers shaped for that job." },
      { heading: "Adding a record", body: "The paper clip adds a specific company, deal or other record to the conversation, so the answer is about exactly that one." },
      { heading: "Workflows and memory", body: "Workflows run a ready-made task, such as preparing for a meeting. Memory holds a few preferences, like how you like answers written. Customer details and amounts are never remembered." },
      { heading: "Changes", body: "If the Copilot suggests a change, it shows a proposal with Confirm and Cancel. Nothing happens until you confirm." },
      { heading: "If a simulator banner shows", body: "\"AI Provider Simulator\" means no real AI provider is connected, so answers are placeholders. An administrator connects one under Integrations → AI providers." },
    ],
    tips: ["The Copilot can be wrong. Open the linked sources before you act on an answer."],
    tour: [
      { target: "copilot-history", title: "Your conversations", body: "Earlier conversations are listed here. Search to find one." },
      { target: "copilot-mode", title: "Choose a mode", body: "Pick the kind of help you want: a normal chat, a briefing, meeting prep, pipeline, renewals, data quality or your day." },
      { target: "copilot-attach", title: "Add a record", body: "Point the Copilot at a specific company, deal or other record." },
      { target: "copilot-input", title: "Ask a question", body: "Type your question and press Enter. Answers link to their sources." },
    ],
  },
  {
    path: "/ai/governance",
    title: "AI Governance",
    purpose: "The rules for how AI is used in your organization: policies, the registry of AI features and models, and the controls that switch them on or off. " + ADMIN_ONLY,
    sections: [
      { heading: "Policies", body: "What AI may and may not do, and which data it may read." },
      { heading: "Registry", body: "Every AI feature and model in use, with its owner and status." },
      { heading: "Controls", body: "Switches to pause or limit an AI feature. Changes ask for a reason and are recorded." },
    ],
  },
  {
    path: "/ai/evaluations",
    title: "AI Evaluations",
    purpose: "Tests that check AI answers are correct and safe before and after changes. " + ADMIN_ONLY,
    sections: [
      { heading: "Runs", body: "Start a run to test a suite of questions against the current setup. Review results and cancel a run that is no longer needed." },
      { heading: "Comparisons", body: "Compare two runs of the same suite to see what got better or worse." },
    ],
  },
  {
    path: "/ai/monitoring",
    title: "AI Monitoring",
    purpose: "How AI is performing right now: quality, usage, service levels, privacy, alerts and safety events. " + ADMIN_ONLY,
    sections: [
      { heading: "Alerts and safety events", body: "Acknowledge an alert when you are looking into it and resolve it when it is fixed. Review each safety event, for example a blocked request." },
      { heading: "Service levels", body: "Measure SLOs now checks response times and error rates against their targets." },
    ],
  },
  {
    path: "/ai/incidents",
    title: "AI Incidents",
    purpose: "Problems with AI, such as a wrong or unsafe answer, from report to resolution. " + ADMIN_ONLY,
    sections: [
      { heading: "Handling an incident", body: "Report it, contain it, add evidence, create a regression case so it is tested in future, then resolve or close it. Reopen it if it comes back." },
    ],
  },
  {
    path: "/ai/releases",
    title: "AI Releases",
    purpose: "Changes to AI prompts, models or settings, released safely: candidate, evaluation, review, then promotion. " + ADMIN_ONLY,
    sections: [
      { heading: "Releasing", body: "Create a release candidate, submit it for evaluation, review the results, then promote it. Pause, roll back or retire a release if something goes wrong." },
    ],
  },
  {
    path: "/ai/usage",
    title: "AI Usage & Cost",
    purpose: "How much AI is used, what it is estimated to cost, and how that cost is split inside the organization. " + ADMIN_ONLY,
    sections: [
      { heading: "Usage and allocation", body: "Use by feature and team, with estimated cost." },
      { heading: "Provider invoices", body: "Record the AI provider's real invoice to compare it with the estimate." },
    ],
  },

  // ── Analytics ───────────────────────────────────────────────────────
  ...[
    ["overview", "Executive Overview", "Key figures across sales, delivery, support, finance and AI."],
    ["sales", "Sales Analytics", "Leads, pipeline, win rate, quotes, orders and renewals."],
    ["activities", "Activity Analytics", "How many calls, emails and meetings happen, how many are completed, and which follow-ups are overdue."],
    ["support", "Support Analytics", "Ticket volume, response and resolution times, SLA performance and backlog."],
    ["projects", "Project Analytics", "Active projects, their health, task delivery and logged time."],
    ["finance", "Finance Analytics", "Invoicing, collections, receivables, expenses and budgets. Operational reporting, not audited accounts."],
    ["ai", "AI Analytics", "AI usage, reliability, estimated cost, governed actions and feedback."],
  ].map(([name, title, purpose]) => ({
    path: `/analytics/${name}`,
    title,
    purpose,
    sections: [
      { heading: "Period and comparison", body: "Choose the period at the top and, if you like, a period to compare with. Figures in several currencies are shown per currency unless you choose otherwise." },
      { heading: "Figure cards", body: "Each card shows the value, the change against the comparison period, and when the data was last loaded. The info mark explains exactly how the figure is calculated." },
      { heading: "Behind a number", body: "The list icon shows the records behind a figure. The sparkle icon, where shown, asks AI to explain the figure." },
      { heading: "What you see", body: "Only figures your role may see are shown. Figures are refreshed from the live data regularly, so the newest changes can take a little while to appear." },
    ],
    tour: [
      { target: "analytics-range", title: "Pick the period", body: "Choose the dates, a comparison period and how currencies are shown." },
      { target: "analytics-metrics", title: "The figures", body: "Each card shows the value, the change and how fresh it is. Open the records behind it with the list icon." },
    ],
  })),
  {
    path: "/analytics/metrics",
    title: "Metric Definitions",
    purpose: "The official meaning of every figure used in dashboards and reports, so everyone counts the same way.",
    sections: [
      { heading: "Definitions", body: "Each metric has an area, a plain-language definition, whether it can be added up across groups, a version and a status." },
      { heading: "Changing a definition", body: "Owners can draft a new version of the description and publish it. The formula itself only changes with a software release." },
    ],
  },
  {
    path: "/analytics/warehouse",
    title: "Data Warehouse",
    purpose: "Where dashboard figures come from: copies of your live data, loaded regularly and checked for problems. Mostly for administrators.",
    sections: [
      { heading: "Sources", body: "When each kind of data was last loaded and whether it matches the live data. Load reloads one source now; Load all sources now reloads everything." },
      { heading: "Data quality and jobs", body: "Problems found in the data, and recent load jobs. Retry re-runs a failed job." },
      { heading: "Rebuild", body: "Deletes a source's copy and reloads it from scratch. Dashboards show partial figures until it finishes, so do it outside busy hours." },
    ],
  },

  // ── Reports ─────────────────────────────────────────────────────────
  {
    path: "/reports",
    title: "Reports",
    purpose: "Saved reports you or your colleagues have built from the official metrics. Open one to see it, or build your own.",
    sections: [
      { heading: "The list", body: "Each report shows who can see it, the metrics it uses, its version and when it was last updated." },
      { heading: "Clone and share", body: "Clone makes your own copy to change. Share gives colleagues the report; each person still only sees the figures their own access allows." },
      { heading: "New report", body: "Opens the report builder." },
    ],
  },
  ...["/reports/builder", "/reports/builder/:id"].map((path) => ({
    path,
    title: "Report builder",
    purpose: "Build a report from the official metrics: choose the figures, how to group them and the period.",
    sections: [
      { heading: "Details", body: "Name the report and describe what it is for." },
      { heading: "Layout", body: "Pick the metrics, how to group and filter them, and the period." },
      { heading: "Preview", body: "Shows the report as you would see it, with your access. Save when it looks right." },
    ],
  })),
  {
    path: "/reports/schedules",
    title: "Scheduled Reports",
    purpose: "Have a report prepared automatically, for example every Monday at 8:00, for yourself or colleagues.",
    sections: [
      { heading: "New schedule", body: "Choose the report, how often and when, the recipients (members of your organization only) and the delivery." },
      { heading: "Delivery", body: "In-app puts the report in each recipient's Exports list and always works. Email delivery sends a sign-in link, not the file, and only works once your administrator has connected an email service." },
      { heading: "Managing", body: "History shows past runs. Run now prepares it immediately. Delete stops the schedule." },
    ],
    tips: ["Times follow each schedule's own time zone, including daylight-saving changes."],
  },
  {
    path: "/reports/exports",
    title: "Exports",
    purpose: "Report data downloaded as files. Exports can hold sensitive figures, so they are tracked, may need approval and expire.",
    sections: [
      { heading: "Requesting", body: "Request export prepares a file of a report. Sensitive exports wait for someone to approve them." },
      { heading: "Downloading", body: "Download when it is ready. Each export shows its classification, size, how often it was downloaded and when it expires." },
      { heading: "Approve, reject, revoke", body: "Approvers approve or reject waiting exports. Revoke stops an export from being downloaded again." },
    ],
  },
  {
    path: "/reports/:id",
    title: "Report",
    purpose: "One saved report, calculated with your access.",
    sections: [{ heading: "Clone and share", body: "Clone makes your own copy to change. Share gives colleagues the report; each person sees only the figures their own access allows." }],
  },
];

export default insights;
