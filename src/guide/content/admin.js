// Administration, Platform and Settings guides. Written guides only (no
// tours): these pages are used by a few administrators. Order matters:
// exact paths are matched first-come, so the fixed integration pages come
// before "/admin/integrations/:providerKey".
const PREVIEW = (what) =>
  `${what} is a preview: it shows sample data and isn't connected to the server yet, so nothing you do here is saved or reaches real people or systems.`;

const USERS_PREVIEW = PREVIEW("Users & Access") + " To add, change or remove a real colleague for now, ask your system administrator.";
const ROLES_PREVIEW = PREVIEW("Roles & Permissions") + " Real roles are given by your system administrator; Finance roles can be given under Finance → Setup.";

const area = (slug, title, what, pages) => [
  {
    path: `/admin/integrations/${slug}`,
    title,
    purpose: `${what} ${PREVIEW(title)}`,
    sections: [{ heading: "Pages in this area", body: pages }],
  },
  {
    path: `/admin/integrations/${slug}/*`,
    title,
    purpose: `Part of ${title}. ${PREVIEW(title)}`,
    sections: [{ heading: "Pages in this area", body: pages }],
  },
];

const aiProviders = [
  ["", "AI Providers", "Your organization's own AI provider accounts at a glance: which are connected, budgets for this period, AI actions waiting for approval and recent AI audit events."],
  ["/providers", "AI providers: Providers", "Connect your organization's own AI account, for example OpenAI or Anthropic Claude, by entering its API key. A provider shows Connected only after the server has checked the key with the provider. Verify re-checks it, Rotate key replaces it, Disable pauses it and Remove revokes it."],
  ["/models", "AI providers: Models", "Features never name a model directly. They ask for an alias (such as \"fast\" or \"best\"), and here you point each alias at a model your key can use."],
  ["/routing", "AI providers: Routing", "Which provider and model alias each AI feature uses, with an optional fallback when the main one is unavailable, plus usage limits."],
  ["/policies", "AI providers: Policies", "What AI may do. Every AI action needs a person's confirmation; ticked actions also need a second person with approval rights. By default providers may not keep your data. Restricted and secret data is never sent, whatever the policy says."],
  ["/privacy", "AI providers: Privacy", "How each kind of data is treated before a request leaves the CRM, for example masked or removed. Context preview shows what a feature would send for sample data, without sending anything."],
  ["/usage", "AI providers: Usage & Budgets", "Usage reported by the provider with an estimated cost, and budgets that stop AI use when reached. Your organization pays the provider directly; these figures are estimates, not an invoice. Set your prices keeps the estimates accurate."],
  ["/evaluations", "AI providers: Evaluations", "Try a provider on known scenarios before relying on it. Runs follow the same policy, privacy rules and budgets as normal use."],
  ["/audit", "AI providers: Audit", "Every AI governance event: connections, keys, policy and budget changes, refused requests, prompt-injection detections and AI actions. Keys, tokens and prompts are never recorded."],
].map(([suffix, title, purpose]) => ({ path: `/admin/integrations/ai-providers${suffix}`, title, purpose }));

const admin = [
  // ── Users & Access, Roles (previews) ────────────────────────────────
  { path: "/admin/users", title: "Members", purpose: "Everyone in your organization, with their role and status. " + USERS_PREVIEW },
  { path: "/admin/invitations", title: "Invitations", purpose: "Email invitations to join your organization. " + USERS_PREVIEW },
  { path: "/admin/invite-links", title: "Invite Links", purpose: "Shareable links that let a team join. " + USERS_PREVIEW },
  { path: "/admin/access-audit", title: "Access Audit", purpose: "A log of changes to users and permissions. " + USERS_PREVIEW },
  { path: "/admin/roles", title: "Roles & Permissions", purpose: "The roles people can have and what each may see and do. " + ROLES_PREVIEW },
  { path: "/admin/roles/:roleId", title: "Role", purpose: "What one role may see and do. " + ROLES_PREVIEW },
  { path: "/admin/permissions", title: "Permissions Matrix", purpose: "Every role against every permission, in one table. " + ROLES_PREVIEW },

  // ── Integration Center (live) ───────────────────────────────────────
  {
    path: "/admin/integrations",
    title: "Integration Center",
    purpose: "Where your organization connects the CRM to other tools such as Google Workspace, Microsoft 365, Slack, Stripe or QuickBooks.",
    sections: [
      { heading: "At a glance", body: "How many tools are connected, any that need attention, recent synchronizations and suggested tools. Click a card to open the matching list." },
      { heading: "What can be connected", body: "16 tools can really be connected today, among them Google Workspace, Microsoft 365, Slack, GitHub, Jira, Asana, Trello, ClickUp, Dropbox, Box, DocuSign, Dropbox Sign, Stripe, PayPal, QuickBooks Online and Xero. Others are listed for information only." },
    ],
  },
  {
    path: "/admin/integrations/marketplace",
    title: "Integration Marketplace",
    purpose: "Every tool the CRM knows about. Filter by category or status, then open a tool to connect it.",
    sections: [
      { heading: "Statuses", body: "Ready to Connect can be connected now. Not Configured means your system owner must first register the CRM with that tool (its app credentials are missing on the server). Catalog Only tools can't be connected yet." },
      { heading: "Connecting", body: "Open the tool and press Connect. Most tools send you to their own sign-in page to approve access; you never type their password into the CRM. Tokens are kept encrypted on the server." },
    ],
  },
  {
    path: "/admin/integrations/activity",
    title: "Integration Activity",
    purpose: "Every synchronization and event from connected tools, with errors. Retry re-runs a failed one; View shows the details.",
  },
  {
    path: "/admin/integrations/webhooks",
    title: "Webhooks",
    purpose: "Messages other systems send to tell the CRM something changed. Each one is signed and checked before it is accepted. Retry re-processes a failed delivery.",
  },
  {
    path: "/admin/integrations/connections/:connectionId",
    title: "Connection",
    purpose: "One connected tool: its health, what it may do, what data is synchronized and in which direction, and who is notified of problems.",
    sections: [
      { heading: "Data scope & synchronization", body: "Choose which records are shared and the direction. When the CRM and the tool disagree, the conflict is shown to a person to decide." },
      { heading: "Disconnect", body: "Stops the connection and revokes its access. You can undo it for a short while afterwards." },
    ],
  },
  ...aiProviders,
  ...area("sales-marketing", "Sales & Marketing integrations", "Connections for lead capture, audiences, email suppression, email delivery, attribution and web forms.", "Lead Capture, Audience Sync, Suppression, Email Delivery, Attribution and Forms."),
  ...area("support-communication", "Support & Communication integrations", "Connections for a shared inbox, ticket systems, chat channels, telephony and SLAs.", "Inbox, Tickets, Channels, Telephony and SLA."),
  ...area("projects-development", "Projects & Development integrations", "Connections to project and developer tools, with mappings and delivery health.", "Projects, Tasks, Mappings, Development and Delivery Health."),
  ...area("commerce-finance", "Commerce & Finance integrations", "Connections for online stores, payments, accounting, subscriptions, banking and reconciliation.", "Commerce, Payments, Accounting mappings, Subscriptions, Banking and Reconciliation."),
  ...area("documents-storage", "Documents & Signatures integrations", "Connections for file storage, document mappings, access reviews, e-signatures and retention.", "Files, Mappings, Access Review, Signatures, Signature Templates and Retention."),
  {
    path: "/admin/integrations/:providerKey",
    title: "Integration",
    purpose: "One tool: what it does, which CRM areas it supports, how it signs in, and whether it is connected.",
    sections: [
      { heading: "Tabs", body: "Overview describes the tool. Capabilities lists what it can do. Setup connects it. Data Mapping, Synchronization, Health and Activity open once it is connected. Access shows who may manage it." },
      { heading: "Connect", body: "Available when the tool shows Ready to Connect. You approve access on the tool's own sign-in page." },
    ],
  },

  // ── Platform and Settings ───────────────────────────────────────────
  {
    path: "/platform",
    title: "Platform Operations",
    purpose: "The health and safety of the system itself: alerts, security, backups, restores, disaster recovery and software releases. For the system owner and people they delegate to.",
    sections: [
      { heading: "Tabs", body: "Health shows whether each service is up. Alerts & jobs lists problems and background jobs. Security & secrets covers keys, vulnerabilities and automation tokens. Backups and Restores & drills protect the data. Disaster recovery shows recovery targets. Releases & deployments rolls out new versions." },
      { heading: "Approvals", body: "Risky steps, such as a deployment or a restore, need a reason and an approval, and may ask you to sign in again. Everything is recorded." },
    ],
    tips: ["You only see the tabs your platform role allows."],
  },
  {
    path: "/settings",
    title: "Settings",
    purpose: "Your own account: profile, password, two-factor authentication and where you are signed in.",
    sections: [
      { heading: "Profile", body: "Your name and phone number, and changing your password. Changing the password signs you out on your other devices." },
      { heading: "Security", body: "Turn on two-factor authentication with an authenticator app. You get ten one-time recovery codes; keep them somewhere safe in case you lose your phone. Where you're signed in lists every device using your account; sign out any you don't recognise." },
    ],
  },
];

export default admin;
