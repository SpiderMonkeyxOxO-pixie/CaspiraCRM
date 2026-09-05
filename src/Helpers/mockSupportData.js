// In-memory mock Support "database" — same pattern as mockCrmData.js / mockSalesData.js.
import { faker } from "@faker-js/faker";
import { companies, contacts } from "./mockCrmData";

const id = () => faker.database.mongodbObjectId();
let ticketCounter = 4000;

const DEPARTMENTS = ["Support", "Billing", "Technical"];
const SUBJECTS = [
  "Unable to access account",
  "Invoice discrepancy",
  "Feature request: export to CSV",
  "Login page throwing an error",
  "Question about billing cycle",
  "Product not working as expected",
  "Request for refund",
  "Need help configuring integration",
];

// SLA windows in hours, by priority.
const SLA_HOURS = {
  Urgent: { response: 1, resolution: 4 },
  High: { response: 4, resolution: 24 },
  Medium: { response: 8, resolution: 48 },
  Low: { response: 24, resolution: 72 },
};

const addHours = (date, hours) => new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();

function makeTicket(overrides = {}) {
  const company = faker.helpers.arrayElement(companies);
  const companyContacts = contacts.filter((c) => c.companyId === company._id);
  const contact = companyContacts.length ? faker.helpers.arrayElement(companyContacts) : null;
  const priority = overrides.priority || faker.helpers.arrayElement(["Low", "Medium", "High", "Urgent"]);
  const createdAt = overrides.createdAt ? new Date(overrides.createdAt) : faker.date.recent({ days: 10 });
  const sla = SLA_HOURS[priority];

  return {
    _id: id(),
    ticketNumber: `TCK-${++ticketCounter}`,
    companyId: company._id,
    companyName: company.name,
    contactId: contact?._id || null,
    contactName: contact?.name || "Unknown",
    subject: faker.helpers.arrayElement(SUBJECTS),
    description: faker.lorem.paragraph(),
    source: faker.helpers.arrayElement(["Email", "Phone", "Chat", "Portal"]),
    category: faker.helpers.arrayElement(["Billing", "Technical", "Account", "General"]),
    priority,
    department: faker.helpers.arrayElement(DEPARTMENTS),
    assignedAgent: faker.datatype.boolean() ? faker.person.fullName() : null,
    // Customer Support and Communication Integrations (Phase 3): optional FK
    // into CRM_TEAM, kept alongside the free-text `assignedAgent` name above
    // for backward compatibility — closes a gap where Ticket assignment
    // didn't resolve against any roster the way Lead/Deal/Contact/Company
    // ownerId does. Also records the original provider source on the Ticket
    // itself, using the same shared-source-model precedent already
    // established on Lead in mockCrmData.js.
    assignedAgentId: overrides.assignedAgentId || null,
    sourceProviderKey: overrides.sourceProviderKey || null,
    sourceExternalReference: overrides.sourceExternalReference || null,
    status: faker.helpers.arrayElement(["New", "Open", "In Progress", "Waiting for Customer"]),
    slaResponseDeadline: addHours(createdAt, sla.response),
    slaResolutionDeadline: addHours(createdAt, sla.resolution),
    firstRespondedAt: null,
    publicReplies: [],
    privateNotes: [],
    escalations: [],
    resolution: null,
    csatScore: null,
    createdAt: createdAt.toISOString(),
    ...overrides,
  };
}

// Seed a realistic mix: some tickets fresh and still within their SLA
// window, some breached, and some already resolved/closed — rather than
// every open ticket looking overdue just because it was seeded days old.
function seedTicket() {
  const bucket = faker.helpers.arrayElement(["fresh", "fresh", "aging", "breached", "resolved", "resolved"]);
  const priority = faker.helpers.arrayElement(["Low", "Medium", "High", "Urgent"]);
  const sla = SLA_HOURS[priority];

  if (bucket === "resolved") {
    const createdAt = faker.date.recent({ days: 6 });
    const respondedAt = addHours(createdAt, sla.response * faker.number.float({ min: 0.2, max: 0.8 }));
    const status = faker.helpers.arrayElement(["Resolved", "Closed"]);
    return makeTicket({
      priority,
      createdAt: createdAt.toISOString(),
      status,
      firstRespondedAt: respondedAt,
      resolution: { summary: faker.lorem.sentence(), resolvedAt: addHours(createdAt, sla.resolution * 0.7) },
      csatScore: status === "Closed" ? faker.number.int({ min: 3, max: 5 }) : null,
    });
  }

  // "fresh" = created recently, well inside the SLA window (on-track).
  // "aging" = roughly half the SLA window elapsed (at-risk or fine).
  // "breached" = created long before the SLA window's response deadline.
  const ageHours = bucket === "fresh"
    ? faker.number.float({ min: 0.1, max: sla.response * 0.5 })
    : bucket === "aging"
      ? faker.number.float({ min: sla.response * 0.6, max: sla.response * 1.5 })
      : faker.number.float({ min: sla.response * 3, max: sla.response * 20 });

  const createdAt = new Date(Date.now() - ageHours * 60 * 60 * 1000);
  return makeTicket({ priority, createdAt: createdAt.toISOString() });
}

export const tickets = faker.helpers.multiple(() => seedTicket(), { count: 18 });

// Guarantee the Companies "open support tickets" fixture actually has one —
// the CRM package's Company detail Support tab is designed and tested
// against this specific company having real, open ticket data.
{
  const co = companies.find((c) => c.name === "Opentickets Support Holdings");
  if (co) {
    const contact = contacts.find((c) => c.companyId === co._id) || null;
    tickets.unshift(makeTicket({
      companyId: co._id, companyName: co.name, contactId: contact?._id || null, contactName: contact?.name || "Unknown",
      subject: "Recurring sync failures on nightly export", status: "Open", priority: "Urgent",
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    }));
  }
}

export function findTicket(ticketId) {
  return tickets.find((t) => t._id === ticketId);
}

export function createTicketRecord(payload) {
  const priority = payload.priority || "Medium";
  const createdAt = new Date();
  const sla = SLA_HOURS[priority];
  const ticket = makeTicket({
    ...payload,
    priority,
    status: "New",
    createdAt: createdAt.toISOString(),
    slaResponseDeadline: addHours(createdAt, sla.response),
    slaResolutionDeadline: addHours(createdAt, sla.resolution),
    publicReplies: [],
    privateNotes: [],
    escalations: [],
    resolution: null,
    csatScore: null,
  });
  tickets.unshift(ticket);
  return ticket;
}

export function updateTicketRecord(ticketId, changes) {
  const ticket = findTicket(ticketId);
  if (!ticket) return null;
  Object.assign(ticket, changes);
  return ticket;
}

export function addPublicReplyRecord(ticketId, message, author) {
  const ticket = findTicket(ticketId);
  if (!ticket) return null;
  ticket.publicReplies.push({ message, author: author || "Agent", at: new Date().toISOString() });
  if (!ticket.firstRespondedAt) ticket.firstRespondedAt = new Date().toISOString();
  if (ticket.status === "New") ticket.status = "Open";
  return ticket;
}

export function addPrivateNoteRecord(ticketId, message, author) {
  const ticket = findTicket(ticketId);
  if (!ticket) return null;
  ticket.privateNotes.push({ message, author: author || "Agent", at: new Date().toISOString() });
  return ticket;
}

export function escalateTicketRecord(ticketId, to, reason) {
  const ticket = findTicket(ticketId);
  if (!ticket) return null;
  ticket.escalations.push({ from: ticket.department, to, reason, at: new Date().toISOString() });
  ticket.department = to;
  return ticket;
}

export function resolveTicketRecord(ticketId, summary) {
  const ticket = findTicket(ticketId);
  if (!ticket) return null;
  ticket.status = "Resolved";
  ticket.resolution = { summary, resolvedAt: new Date().toISOString() };
  return ticket;
}
