// Ticket status and priority rules (Backend Phase 4, full spec). The
// frontend's vocabulary is kept (ticketsSlice.js TICKET_STATUSES /
// TICKET_PRIORITIES) and extended with the statuses the spec requires that
// the frontend didn't have yet: "Waiting for Internal Team" and "Cancelled".

// Priority definitions (documented, not just colours):
//   Urgent — the customer can't work or a production service is down.
//   High   — a major function is impaired; a workaround may exist.
//   Medium — normal priority: a question or a limited-impact problem.
//   Low    — minor issue, cosmetic problem or general enquiry.
export const TICKET_PRIORITIES = ["Low", "Medium", "High", "Urgent"];

export const TICKET_STATUSES = ["New", "Open", "In Progress", "Waiting for Customer", "Waiting for Internal Team", "Resolved", "Closed", "Cancelled"];

// Statuses in which a ticket is still being worked.
export const ACTIVE_STATUSES = ["New", "Open", "In Progress", "Waiting for Customer", "Waiting for Internal Team"];
export const FINISHED_STATUSES = ["Resolved", "Closed", "Cancelled"];

// Moves allowed through POST /transition. Resolved and Closed are reached
// only through /resolve (code or summary required) and /close (from
// Resolved, needs its own permission), and left only through /reopen
// (reason required). Cancelled needs a reason and is final.
const TRANSITIONS = {
  New: ["Open", "In Progress", "Waiting for Customer", "Waiting for Internal Team", "Cancelled"],
  Open: ["In Progress", "Waiting for Customer", "Waiting for Internal Team", "Cancelled"],
  "In Progress": ["Open", "Waiting for Customer", "Waiting for Internal Team", "Cancelled"],
  "Waiting for Customer": ["Open", "In Progress", "Cancelled"],
  "Waiting for Internal Team": ["Open", "In Progress", "Cancelled"],
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

// Kept for the pre-full-spec /advance endpoint (same rules as /transition).
export const canAdvance = canTransition;

export const RESOLVABLE_FROM = ["Open", "In Progress", "Waiting for Customer", "Waiting for Internal Team"];
export const REOPENABLE_FROM = ["Resolved", "Closed"];

// What a customer sees in the portal — never internal detail like
// "Waiting for Internal Team".
export function customerVisibleStatus(status) {
  if (status === "Waiting for Customer") return "Awaiting your reply";
  if (["Resolved", "Closed", "Cancelled"].includes(status)) return status;
  if (status === "New") return "Received";
  return "In progress";
}

export function normalizeSubject(subject) {
  return String(subject || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// ---- Legacy fixed SLA windows -------------------------------------------
// Used only when no SLA policy applies to a ticket (see slaService.js,
// which computes real clocks from versioned policies and business hours).
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
