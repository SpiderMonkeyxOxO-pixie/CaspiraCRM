// Module-level guides: shown for any page of a module that doesn't have its
// own guide yet. Page guides live in the module files next to this one.
const general = [
  {
    path: "/crm/*",
    title: "CRM",
    purpose: "CRM is where you keep track of the people and companies you work with, and of every sales opportunity with them.",
    sections: [
      { heading: "Leads", body: "People or companies who might become customers. Qualify a lead to turn it into a contact, a company and a deal." },
      { heading: "Companies and contacts", body: "Your customers and the people who work there, with their history of calls, emails and meetings." },
      { heading: "Deals and pipeline", body: "Sales opportunities and the stage each one is at, from first contact to won or lost." },
      { heading: "Activities", body: "Calls, meetings, emails and tasks, planned and done." },
    ],
  },
  { path: "/sales/*", title: "Sales", purpose: "Sales turns deals into money: products and prices, quotes for customers, orders and contracts." },
  { path: "/support/*", title: "Support", purpose: "Support is where customer questions and problems arrive as tickets, get answered and are resolved on time." },
  { path: "/projects/*", title: "Projects", purpose: "Projects organises delivery work: tasks, boards, milestones and who is working on what." },
  { path: "/marketing/*", title: "Marketing", purpose: "Marketing reaches customers in groups: campaigns, audience segments, forms and email templates." },
  { path: "/finance/*", title: "Finance", purpose: "Finance records the money side: invoices, payments, expenses and the reports built from them." },
  { path: "/ai/*", title: "AI", purpose: "AI features help you summarise, find and prepare work. The AI only suggests; a person confirms every change." },
  { path: "/analytics/*", title: "Analytics", purpose: "Analytics shows the key figures of the business in dashboards, each figure traceable to its definition." },
  { path: "/reports/*", title: "Reports", purpose: "Reports are saved views of your data that you can rerun, schedule and export." },
  { path: "/admin/*", title: "Administration", purpose: "Administration manages who can use the system and what they can do, and connects it to other tools." },
  { path: "/platform/*", title: "Platform Operations", purpose: "Platform Operations is for the people who run the system itself: health, security, backups, restores and releases." },
  { path: "/settings/*", title: "Settings", purpose: "Your own account: your name and phone, your password, two-factor authentication and where you're signed in." },
];

export default general;
