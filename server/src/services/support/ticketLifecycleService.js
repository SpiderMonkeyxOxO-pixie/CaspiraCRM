// Ticket SLA and status rules — the frontend's own vocabulary and windows
// (mockSupportData.js SLA_HOURS; ticketsSlice.js TICKET_STATUSES), computed
// on the server so a client can never set a deadline or skip a step.

export const TICKET_PRIORITIES = ["Low", "Medium", "High", "Urgent"];

// Hours from ticket creation to first response / to resolution.
export const SLA_HOURS = {
  Urgent: { response: 1, resolution: 4 },
  High: { response: 4, resolution: 24 },
  Medium: { response: 8, resolution: 48 },
  Low: { response: 24, resolution: 72 },
};

export function slaDeadlines(priority, from) {
  const sla = SLA_HOURS[priority] || SLA_HOURS.Medium;
  const start = new Date(from).getTime();
  return {
    slaResponseDeadline: new Date(start + sla.response * 3600 * 1000),
    slaResolutionDeadline: new Date(start + sla.resolution * 3600 * 1000),
  };
}

// Ordinary working steps. Resolved and Closed are reached only through
// /resolve (summary required) and /close (resolved first), and left only
// through /reopen (reason required).
const WORKING_TRANSITIONS = {
  New: ["Open"],
  Open: ["In Progress"],
  "In Progress": ["Waiting for Customer"],
  "Waiting for Customer": ["In Progress"],
};

export function canAdvance(from, to) {
  return (WORKING_TRANSITIONS[from] || []).includes(to);
}
