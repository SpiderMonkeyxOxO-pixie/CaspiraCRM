// Support page guides. Plain language for everyday staff; tour targets are
// data-tour="…" attributes on the pages.
const support = [
  {
    path: "/support/dashboard",
    title: "Support Dashboard",
    purpose: "How your support desk is doing right now: open tickets, tickets past their deadline, tickets nobody is working on, and which ones to handle next.",
    sections: [
      { heading: "Key figures", body: "Open Tickets counts everything not yet resolved. Response SLA Breached counts tickets that got no first reply in time. Resolution SLA Breached counts tickets not solved in time. Unassigned counts open tickets with no agent." },
      { heading: "Charts", body: "Tickets by Status shows how many tickets are at each step. Open Tickets by Priority splits the open ones by urgency. Click a bar or a slice to open the ticket list filtered that way." },
      { heading: "Suggested tickets to prioritize", body: "The eight open tickets that need you most, ranked by priority and by how close they are to missing their deadline. Work from the top." },
    ],
    tips: ["Keep Unassigned at zero: a ticket without an agent is a ticket nobody is watching."],
    tour: [
      { target: "support-kpis", title: "Your desk at a glance", body: "Open tickets, missed deadlines and unassigned tickets. Click a card to open the ticket list." },
      { target: "support-charts", title: "Where tickets stand", body: "Tickets by status and open tickets by priority. Click a bar or slice to filter the list." },
      { target: "support-next", title: "What to work on next", body: "The most urgent tickets, ranked for you. Click one to open it." },
    ],
  },
  {
    path: "/support/tickets",
    title: "Tickets",
    purpose: "A ticket is one customer question or problem. Every ticket belongs to a company, has a priority and a deadline, and stays here until it is solved.",
    sections: [
      { heading: "Creating a ticket", body: "New Ticket asks for the company, optionally the contact, a subject and a description. Choose where it came from (email, phone, chat or portal), a category and a priority." },
      { heading: "Priority and deadlines (SLA)", body: "The priority sets two deadlines: a first reply and a solution. Urgent: reply within 1 hour, solve within 4 hours. High: 4 and 24 hours. Medium: 8 and 48 hours. Low: 24 and 72 hours. Your administrator may have set different times." },
      { heading: "The Response SLA column", body: "On Track means there is time left. At Risk means less than 2 hours remain. Overdue means the deadline has passed. Met means it was answered in time." },
      { heading: "Search and filters", body: "Search by subject, company or ticket number, and filter by status or priority." },
    ],
    tips: ["Set the priority honestly: it decides the deadlines and the order on the dashboard."],
    tour: [
      { target: "tickets-add", title: "Log a ticket", body: "Record a new customer question or problem. Choose the company, a subject and a priority." },
      { target: "tickets-filters", title: "Find tickets", body: "Search by subject, company or ticket number, and filter by status or priority." },
      { target: "tickets-table", title: "The ticket list", body: "Each row shows the priority, status, reply deadline and agent. Click a ticket to work on it." },
    ],
  },
  {
    path: "/support/tickets/:id",
    title: "Ticket",
    purpose: "Everything about one ticket: the conversation, private notes, deadlines and who is handling it. Work the ticket from here until it is solved.",
    sections: [
      { heading: "How a ticket moves", body: "New → Open → In Progress → Waiting for Customer or Waiting for Internal Team → Resolved → Closed. \"Move to …\" takes it to the next step. The first reply moves a New ticket to Open by itself." },
      { heading: "Assign and escalate", body: "Assign gives the ticket to an agent and a department (Support, Billing or Technical). Escalate hands it to another department with a reason, which is kept in the escalation history." },
      { heading: "Replies and private notes", body: "Public Replies are your answers to the customer. They are saved on the ticket but not emailed yet, so also send your answer to the customer yourself. Private Notes are only for your team and never shown to the customer." },
      { heading: "Resolve and close", body: "Resolve asks for a short summary of the fix. Once the customer confirms it is solved, Close the ticket." },
      { heading: "Details and history", body: "The left panel shows priority, category, source, department, agent and a link to the company. History lists every change: status, assignment and deadlines." },
    ],
    tips: ["Write a private note whenever you hand a ticket over, so the next person knows what has been tried."],
    tour: [
      { target: "ticket-actions", title: "Work the ticket", body: "Move it to the next step, assign it, escalate it to another team, or resolve it." },
      { target: "ticket-sla", title: "Status and deadlines", body: "The current step and whether the reply and solution deadlines are on track." },
      { target: "ticket-details", title: "Ticket details", body: "Priority, category, agent and company, plus the escalation and change history." },
      { target: "ticket-conversation", title: "Replies and notes", body: "Switch between replies to the customer and private notes for your team. Replies are saved here but not emailed, so send them to the customer yourself too." },
    ],
  },
];

export default support;
