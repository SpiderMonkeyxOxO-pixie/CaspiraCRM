// The User guide: how the system works as a whole. Each topic is a short
// article; `links` open the pages it talks about.

// The welcome tour: shown automatically the first time someone signs in,
// and any time from the User guide. Steps point at the menu and top bar.
export const WELCOME = {
  path: "__welcome",
  title: "Welcome to Caspira CRM",
  tour: [
    { title: "Welcome!", body: "This short tour shows you around. It takes about a minute, and you can replay it any time from the Guide button." },
    { target: "nav-menu", title: "The menu", body: "Every area of the system is here: CRM, Sales, Support, Projects, Marketing, Finance, AI and more. Click an area to open its pages. You only see the areas your role gives you." },
    { target: "nav-guide", title: "The Guide", body: "Stuck? Click Guide. It explains the page you're on, offers a tour of it, and has a User guide on how everything fits together, including integrations and AI." },
    { target: "nav-notifications", title: "Notifications", body: "The bell is where notifications will appear. They aren't switched on yet, so for now check your dashboards and Activities for what needs you." },
    { target: "nav-theme", title: "Light or dark", body: "Switch between light and dark mode. Your choice is remembered." },
    { target: "nav-profile", title: "Your account", body: "Your profile, text size, two-factor authentication, settings and sign out." },
    { title: "Page tours", body: "The first time you open a page, a small card offers a tour of it. Take it, or choose Not now; it's always in the Guide. Enjoy!" },
  ],
};

export const TOPICS = [
  {
    id: "getting-started",
    title: "Getting started",
    summary: "Finding your way around and setting up your account.",
    body: [
      "The menu on the left lists the areas you can use. Your role decides which ones appear: a salesperson sees CRM and Sales, a finance user sees Finance, an administrator also sees Users & Access and Integrations.",
      "Most pages follow the same pattern: summary cards at the top (click one to filter the list), search and filters, then the list itself. Click a row to open the record.",
      "Across the top bar: the Guide, light or dark mode, notifications, and your account menu.",
      "First things to do: check your name in Settings, and turn on two-factor authentication to protect your account.",
    ],
    links: [["Open Settings", "/settings"], ["Turn on two-factor authentication", "/settings?tab=security"], ["CRM Dashboard", "/crm/dashboard"]],
  },
  {
    id: "how-it-connects",
    title: "How everything connects",
    summary: "From the first enquiry to the paid invoice, and where support, projects and reports fit in.",
    body: [
      "1. A new enquiry starts as a lead (CRM → Leads). You call, email and follow up until it is Qualified.",
      "2. Converting a qualified lead creates the company, the contact and a deal in one go (CRM → Companies, Contacts, Deals).",
      "3. The deal moves through the pipeline stages: Discovery, Qualified, Proposal, Negotiation, Approval. CRM → Pipeline shows them as a board.",
      "4. In Sales you prepare a quote for the deal from your products and price books. An accepted quote becomes an order, and long-running agreements are kept as contracts.",
      "5. Finance invoices the order, records the customer's payment, and handles credit notes, expenses and reports.",
      "6. After the sale, Support handles the customer's questions as tickets, and Projects organises delivery work. Both show up on the company's page.",
      "7. Marketing brings in new leads through campaigns and forms, which feeds step 1.",
      "8. Analytics & Reports shows figures from all of these areas. AI can summarise and prepare work across them, but a person always confirms any change.",
      "Everything about a customer comes together on their company page, in the Contacts, Deals, Support, Projects and Finance tabs.",
    ],
    links: [["Leads", "/crm/leads"], ["Pipeline", "/crm/pipeline"], ["Quotes", "/sales/quotes"], ["Invoices", "/finance/invoices"], ["Support tickets", "/support/tickets"], ["Projects", "/projects"]],
  },
  {
    id: "integrations",
    title: "Connecting integrations",
    summary: "Linking other tools (email, accounting, payments, storage and more) to the CRM. For administrators.",
    body: [
      "Integrations connect the CRM to tools your company already uses, so data moves between them automatically. You need an administrator role to connect them.",
      "1. Open Integrations → Marketplace and find the tool. Its status shows whether it's ready to connect.",
      "2. Click Connect. Most tools send you to their own sign-in page to approve the connection; you never type their password into the CRM.",
      "3. After connecting, choose what is synchronised and in which direction. When the CRM and the other tool disagree, the conflict is shown to a person to decide.",
      "4. Integrations → Activity shows every sync and any errors; Webhooks lets other systems notify the CRM of changes. Both are signed and checked.",
      "The area pages (Sales & Marketing, Support & Communication, Projects & Development, Commerce & Finance, Documents & Storage) group the integrations for each part of the business.",
    ],
    links: [["Integrations overview", "/admin/integrations"], ["Marketplace", "/admin/integrations/marketplace"], ["Integration activity", "/admin/integrations/activity"]],
  },
  {
    id: "ai",
    title: "Using AI",
    summary: "What the AI can do, how to switch it on, and how your data is protected.",
    body: [
      "Switching it on (administrators): go to Integrations → AI Providers → Providers, click Connect on a provider (for example OpenAI or Anthropic Claude) and enter your organisation's API key. The key is stored encrypted and never shown again. Models, Routing and Policies decide which AI is used for what; Usage & Budgets sets spending limits.",
      "Everyday use: AI → Copilot answers questions about your records and prepares briefings (for example before a meeting or a renewal). Every statement links to the record it came from, and statements that can't be backed by your data are removed.",
      "The AI never changes anything on its own. It can propose a change, such as a next step on a deal; you preview it and confirm it, and you can undo it.",
      "Privacy: the AI sees only records you are allowed to see. Personal and restricted fields are hidden before anything is sent to the provider, and every request is logged.",
    ],
    links: [["AI Providers", "/admin/integrations/ai-providers/providers"], ["Copilot", "/ai/copilot"], ["AI overview", "/ai/overview"]],
  },
  {
    id: "users",
    title: "Users and permissions",
    summary: "Inviting colleagues and deciding what they can do. For administrators.",
    body: [
      "Invite people from Users & Access → Invitations (by email) or share an invite link for a team.",
      "Each person has a role. Roles & Permissions shows what each role can see and do; Create Custom Role builds your own.",
      "Members lets you change someone's role, suspend their access (and reactivate it later), or remove them from the organisation when they leave. Their past work stays in the records.",
      "Access Audit shows who changed what in users and permissions.",
    ],
    links: [["Members", "/admin/users"], ["Invitations", "/admin/invitations"], ["Roles & Permissions", "/admin/roles"]],
  },
  {
    id: "account",
    title: "Your account and security",
    summary: "Your profile, password, two-factor authentication and where you're signed in.",
    body: [
      "Settings → Profile: your name and phone, and changing your password. Changing the password signs you out everywhere else.",
      "Settings → Security: turn on two-factor authentication (a code from an app on your phone at every sign-in). You also get ten one-time recovery codes; keep them safe in case you lose your phone.",
      "Where you're signed in lists every device using your account. Sign out any you don't recognise, then change your password.",
      "Text size and light/dark mode are in your account menu at the top right.",
    ],
    links: [["Profile", "/settings"], ["Security", "/settings?tab=security"]],
  },
];
