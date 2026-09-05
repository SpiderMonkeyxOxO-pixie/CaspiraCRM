// In-memory mock Activities "database" — same pattern as the other
// mock*Data files. Activities are a first-class, schedulable CRM record
// (distinct from the lightweight per-record `activity[]` timelines already
// embedded on Leads/Contacts/Companies) that reference those records by
// type + id rather than duplicating them.
import { faker } from "@faker-js/faker";
import { leads, contacts, companies, deals, findLead, findContact, findCompany, findDeal } from "./mockCrmData";
import { CRM_TEAM, findTeamMember } from "./mockUsersData";

const id = () => faker.database.mongodbObjectId();

export const ACTIVITY_TYPES = ["Call", "Email", "Meeting", "Follow-up", "Task", "Note", "Customer Visit", "Status Update"];
// Stored, manually-set states. "Overdue" is deliberately NOT one of these —
// it's derived from a scheduled/due date vs. the current time, never stored.
export const ACTIVITY_STATUSES = ["Scheduled", "In Progress", "Completed", "Cancelled", "Missed"];
export const ACTIVITY_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
export const RELATED_RECORD_TYPES = ["Lead", "Contact", "Company", "Deal"];
export const CALL_DIRECTIONS = ["Outbound", "Inbound"];
export const EMAIL_DIRECTIONS = ["Outgoing", "Incoming"];
export const NOTE_VISIBILITIES = ["Private", "Team", "Public"];
export const CALL_OUTCOMES = ["Connected", "No Answer", "Voicemail", "Wrong Number", "Rescheduled", "Follow-up Required"];
export const MEETING_OUTCOMES = ["Completed", "Rescheduled", "Cancelled", "No Show", "Follow-up Required"];
export const REASON_REQUIRED_CANCEL = true;

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const atHour = (date, h, m = 0) => { const d = new Date(date); d.setHours(h, m, 0, 0); return d; };

function resolveRelated(relatedRecordType, relatedRecordId) {
  if (!relatedRecordType || !relatedRecordId) return null;
  const finders = { Lead: findLead, Contact: findContact, Company: findCompany, Deal: findDeal };
  const record = finders[relatedRecordType]?.(relatedRecordId);
  if (!record) return null;
  return record.name || record.title || record.companyName || "Untitled";
}

function activityAuditEntry(action, actor, { field, before, after, reason } = {}) {
  return { _id: id(), action, actor: actor || "System", at: new Date().toISOString(), field: field || null, before: before ?? null, after: after ?? null, reason: reason || null };
}

function makeActivity(overrides = {}) {
  const type = overrides.type || faker.helpers.arrayElement(ACTIVITY_TYPES);
  const owner = overrides.ownerId === null ? null : (findTeamMember(overrides.ownerId) || faker.helpers.arrayElement(CRM_TEAM));
  const relatedRecordType = overrides.relatedRecordType || faker.helpers.arrayElement(RELATED_RECORD_TYPES);
  const relatedRecordId = overrides.relatedRecordId !== undefined ? overrides.relatedRecordId : (
    relatedRecordType === "Lead" ? faker.helpers.arrayElement(leads)?._id
      : relatedRecordType === "Contact" ? faker.helpers.arrayElement(contacts)?._id
        : relatedRecordType === "Company" ? faker.helpers.arrayElement(companies)?._id
          : faker.helpers.arrayElement(deals)?._id
  );
  const createdAt = overrides.createdAt || faker.date.past({ years: 1 }).toISOString();
  const startAt = overrides.startAt !== undefined ? overrides.startAt : faker.date.soon({ days: 10 }).toISOString();

  return {
    _id: id(),
    type,
    title: overrides.title || `${type} — ${faker.company.buzzPhrase()}`,
    description: overrides.description || "",
    status: overrides.status || "Scheduled",
    priority: overrides.priority || faker.helpers.arrayElement(ACTIVITY_PRIORITIES),
    ownerId: owner?.id || null,
    ownerName: owner?.name || null,
    assignedTeam: overrides.assignedTeam || owner?.department || null,
    participants: overrides.participants || [],
    relatedRecordType: relatedRecordId ? relatedRecordType : null,
    relatedRecordId: relatedRecordId || null,
    relatedRecordLabel: overrides.relatedRecordLabel || resolveRelated(relatedRecordType, relatedRecordId) || null,
    startAt,
    endAt: overrides.endAt !== undefined ? overrides.endAt : null,
    dueDate: overrides.dueDate !== undefined ? overrides.dueDate : null,
    timezone: overrides.timezone || "America/New_York",
    reminder: overrides.reminder !== undefined ? overrides.reminder : { enabled: false, minutesBefore: 15 },
    outcome: overrides.outcome || null,
    completionNote: overrides.completionNote || null,
    attachments: overrides.attachments || [],
    // Call-specific
    phone: overrides.phone || null,
    callDirection: overrides.callDirection || null,
    expectedDurationMinutes: overrides.expectedDurationMinutes ?? null,
    callPurpose: overrides.callPurpose || null,
    // Email-specific
    emailDirection: overrides.emailDirection || null,
    subject: overrides.subject || null,
    // Meeting-specific
    location: overrides.location || null,
    agenda: overrides.agenda || null,
    // Note-specific
    visibility: overrides.visibility || null,
    // Relationships
    followUpActivityId: overrides.followUpActivityId || null,
    parentActivityId: overrides.parentActivityId || null,
    // Lifecycle
    auditLog: overrides.auditLog || [],
    createdBy: overrides.createdBy || "System",
    createdAt,
    updatedAt: overrides.updatedAt || createdAt,
    updatedBy: overrides.updatedBy || overrides.createdBy || "System",
    completedBy: overrides.completedBy || null,
    completedAt: overrides.completedAt || null,
    cancelReason: overrides.cancelReason || null,
    cancelledBy: overrides.cancelledBy || null,
    cancelledAt: overrides.cancelledAt || null,
    ...overrides,
  };
}

// Overdue is a UI-computed state, not a stored one: a Scheduled/In Progress
// activity whose start/due time has passed reads as Overdue everywhere in
// the UI without ever being written back to `status`.
export function effectiveStatus(activity) {
  if (["Completed", "Cancelled", "Missed"].includes(activity.status)) return activity.status;
  const reference = activity.dueDate || activity.startAt;
  if (reference && new Date(reference) < new Date()) return "Overdue";
  return activity.status;
}

export function isDoNotContact(activity) {
  if (activity.relatedRecordType !== "Contact" || !activity.relatedRecordId) return false;
  const contact = findContact(activity.relatedRecordId);
  return !!contact?.doNotContact;
}
export function doNotContactReason(activity) {
  if (activity.relatedRecordType !== "Contact" || !activity.relatedRecordId) return null;
  return findContact(activity.relatedRecordId)?.doNotContactReason || null;
}

// ---- Curated, named fixture scenarios ----
const leadId = leads[0]?._id;
const dncContact = contacts.find((c) => c.doNotContact) || contacts[0];
const richContact = contacts.find((c) => c.email === "renata.silva@activehistory.example") || contacts[0];
const richCompany = companies.find((c) => c.name === "Activedeal Ventures Group") || companies[0];
const richDeal = deals.find((d) => d.name === "Several Contacts Manufacturing — Activity-Rich Expansion") || deals[0];
const conflictOwnerId = "u2"; // Priya Nair — shared by the two overlapping fixtures below

const ACTIVITY_FIXTURES = [
  () => makeActivity({
    type: "Call", title: "Discovery call — pricing questions", status: "Scheduled",
    relatedRecordType: "Lead", relatedRecordId: leadId, ownerId: "u1",
    startAt: daysFromNow(2).toISOString(), phone: "+1-555-0142", callDirection: "Outbound",
    expectedDurationMinutes: 20, callPurpose: "Qualify budget and timeline",
  }),
  () => makeActivity({
    type: "Call", title: "Renewal check-in call", status: "Completed",
    relatedRecordType: "Contact", relatedRecordId: richContact._id, ownerId: "u2",
    startAt: daysAgo(2).toISOString(), phone: richContact.phone, callDirection: "Outbound",
    expectedDurationMinutes: 15, outcome: "Connected", completionNote: "Confirmed renewal intent, sending updated quote.",
    completedBy: "Priya Nair", completedAt: daysAgo(2).toISOString(),
  }),
  () => makeActivity({
    type: "Call", title: "Follow-up call attempt", status: "Missed",
    relatedRecordType: "Company", relatedRecordId: richCompany._id, ownerId: "u3",
    startAt: daysAgo(1).toISOString(), phone: richCompany.phone, callDirection: "Outbound",
    outcome: "No Answer",
  }),
  () => makeActivity({
    type: "Email", title: "Logged: Proposal follow-up email", status: "Completed",
    relatedRecordType: "Contact", relatedRecordId: richContact._id, ownerId: "u2",
    startAt: daysAgo(3).toISOString(), emailDirection: "Outgoing", subject: "Following up on your Q3 proposal",
    description: "Sent updated pricing and renewal terms.", completedBy: "Priya Nair", completedAt: daysAgo(3).toISOString(),
  }),
  () => makeActivity({
    type: "Meeting", title: "Kickoff meeting", status: "Scheduled",
    relatedRecordType: "Company", relatedRecordId: richCompany._id, ownerId: "u1",
    startAt: atHour(daysFromNow(1), 14).toISOString(), endAt: atHour(daysFromNow(1), 15).toISOString(),
    location: "https://meet.example.com/kickoff", agenda: "Introductions, timeline review, next steps",
    reminder: { enabled: true, minutesBefore: 30 },
  }),
  () => makeActivity({
    type: "Meeting", title: "Quarterly business review", status: "Completed",
    relatedRecordType: "Contact", relatedRecordId: richContact._id, ownerId: "u1",
    startAt: daysAgo(5).toISOString(), endAt: daysAgo(5).toISOString(),
    location: "Client office", agenda: "Review usage, discuss renewal",
    outcome: "Completed", completionNote: "Positive engagement, renewal likely.", completedBy: "Dominic Wuckert", completedAt: daysAgo(5).toISOString(),
  }),
  () => makeActivity({
    type: "Follow-up", title: "Overdue follow-up — send contract redline", status: "Scheduled",
    relatedRecordType: "Lead", relatedRecordId: leadId, ownerId: "u3",
    dueDate: daysAgo(4).toISOString(), startAt: daysAgo(4).toISOString(),
  }),
  () => makeActivity({
    type: "Follow-up", title: "Upcoming follow-up — check in on trial", status: "Scheduled",
    relatedRecordType: "Contact", relatedRecordId: contacts[1]?._id, ownerId: "u4",
    dueDate: daysFromNow(3).toISOString(), startAt: daysFromNow(3).toISOString(),
  }),
  () => makeActivity({
    type: "Task", title: "Prepare onboarding checklist", status: "Completed",
    relatedRecordType: "Company", relatedRecordId: richCompany._id, ownerId: "u5",
    dueDate: daysAgo(1).toISOString(), completedBy: "Liam O'Connor", completedAt: daysAgo(1).toISOString(),
  }),
  () => makeActivity({
    type: "Note", title: "Internal note — pricing sensitivity", status: "Completed",
    relatedRecordType: "Lead", relatedRecordId: leadId, ownerId: "u1",
    startAt: daysAgo(1).toISOString(), visibility: "Team",
    description: "Prospect flagged budget is tight this quarter — consider a smaller starter package.",
    completedBy: "Dominic Wuckert", completedAt: daysAgo(1).toISOString(),
  }),
  () => makeActivity({
    type: "Customer Visit", title: "On-site visit — annual review", status: "Scheduled",
    relatedRecordType: "Company", relatedRecordId: companies[2]?._id, ownerId: "u1",
    startAt: atHour(daysFromNow(7), 10).toISOString(), endAt: atHour(daysFromNow(7), 12).toISOString(),
    location: "Customer HQ", agenda: "Annual account review and expansion discussion",
  }),
  () => makeActivity({
    type: "Meeting", title: "Cancelled sync — rescheduling", status: "Cancelled",
    relatedRecordType: "Contact", relatedRecordId: contacts[2]?._id, ownerId: "u2",
    startAt: daysAgo(2).toISOString(), cancelReason: "Contact requested to postpone to next quarter",
    cancelledBy: "Priya Nair", cancelledAt: daysAgo(2).toISOString(),
  }),
  () => makeActivity({
    type: "Task", title: "Unassigned — review contract terms", status: "Scheduled",
    ownerId: null, dueDate: daysFromNow(5).toISOString(),
    relatedRecordType: "Deal", relatedRecordId: deals[0]?._id,
  }),
  // "Deal with activities" fixture — a call, a meeting and a task all tied
  // to the same deal, so its Activities tab shows a real history.
  () => makeActivity({
    type: "Call", title: "Negotiation call — pricing alignment", status: "Completed",
    relatedRecordType: "Deal", relatedRecordId: richDeal?._id, ownerId: "u2",
    startAt: daysAgo(4).toISOString(), callDirection: "Outbound", expectedDurationMinutes: 30,
    outcome: "Connected", completionNote: "Aligned on volume discount, awaiting final sign-off.",
    completedBy: "Priya Nair", completedAt: daysAgo(4).toISOString(),
  }),
  () => makeActivity({
    type: "Meeting", title: "Stakeholder review meeting", status: "Scheduled",
    relatedRecordType: "Deal", relatedRecordId: richDeal?._id, ownerId: "u2",
    startAt: atHour(daysFromNow(3), 13).toISOString(), endAt: atHour(daysFromNow(3), 14).toISOString(),
    location: "https://meet.example.com/expansion-review", agenda: "Walk through final commercial terms",
  }),
  () => makeActivity({
    type: "Task", title: "Prepare final commercial summary", status: "Scheduled",
    relatedRecordType: "Deal", relatedRecordId: richDeal?._id, ownerId: "u2",
    dueDate: daysFromNow(2).toISOString(),
  }),
  () => makeActivity({
    type: "Call", title: "Do-not-contact — outreach blocked", status: "Scheduled",
    relatedRecordType: "Contact", relatedRecordId: dncContact._id, ownerId: "u2",
    startAt: daysFromNow(1).toISOString(), phone: dncContact.phone, callDirection: "Outbound",
  }),
  () => {
    const withAttachment = makeActivity({
      type: "Email", title: "Logged: Signed order form attached", status: "Completed",
      relatedRecordType: "Company", relatedRecordId: richCompany._id, ownerId: "u1",
      startAt: daysAgo(6).toISOString(), emailDirection: "Incoming", subject: "Signed order form",
      completedBy: "Dominic Wuckert", completedAt: daysAgo(6).toISOString(),
    });
    withAttachment.attachments = [{ _id: id(), name: "order-form-signed.pdf", size: 84213, type: "application/pdf", dataUrl: null, uploadedBy: "Dominic Wuckert", uploadedAt: daysAgo(6).toISOString() }];
    return withAttachment;
  },
  // Schedule-conflict demo pair — same owner, overlapping times.
  () => makeActivity({
    type: "Call", title: "Conflict demo — pipeline review call", status: "Scheduled",
    relatedRecordType: "Contact", relatedRecordId: contacts[3]?._id, ownerId: conflictOwnerId,
    startAt: atHour(daysFromNow(2), 10).toISOString(), endAt: atHour(daysFromNow(2), 11).toISOString(), phone: "+1-555-0199", callDirection: "Outbound",
  }),
  () => makeActivity({
    type: "Meeting", title: "Conflict demo — partner sync", status: "Scheduled",
    relatedRecordType: "Company", relatedRecordId: companies[3]?._id, ownerId: conflictOwnerId,
    startAt: atHour(daysFromNow(2), 10, 30).toISOString(), endAt: atHour(daysFromNow(2), 11, 30).toISOString(), location: "Conference Room B",
  }),
];

export const activities = ACTIVITY_FIXTURES.map((build) => build());

// "Activity containing a follow-up activity" — create the follow-up second
// so it can reference the parent's real _id, then link both directions.
{
  const parent = activities.find((a) => a.title === "Renewal check-in call");
  if (parent) {
    const followUp = makeActivity({
      type: "Follow-up", title: "Follow-up — send renewal paperwork", status: "Scheduled",
      relatedRecordType: parent.relatedRecordType, relatedRecordId: parent.relatedRecordId, ownerId: parent.ownerId,
      dueDate: daysFromNow(2).toISOString(), parentActivityId: parent._id,
    });
    activities.push(followUp);
    parent.followUpActivityId = followUp._id;
  }
}

// Fill out the rest of the dataset with realistic random activities spread
// across owners, types and time buckets (overdue / today / this week / later).
activities.push(...faker.helpers.multiple(() => makeActivity({
  startAt: faker.helpers.arrayElement([
    faker.date.recent({ days: 10 }), // some overdue/past
    faker.date.soon({ days: 1 }), // today/tomorrow
    faker.date.soon({ days: 7 }), // this week
    faker.date.soon({ days: 30 }), // later
  ]).toISOString(),
  status: faker.helpers.arrayElement(["Scheduled", "Scheduled", "Scheduled", "Completed", "Cancelled", "Missed"]),
}), { count: 45 }));

export function findActivity(activityId) {
  return activities.find((a) => a._id === activityId);
}

// ---- Query ----
export function queryActivitiesLocal(list, params = {}) {
  const {
    search = "", type, status, priority, ownerId, team, relatedRecordType, relatedRecordId,
    dateFrom, dateTo, overdue, upcoming, completed, hasReminder, hasOutcome, createdBy,
    sort = "startAt", order = "asc", page = 1, pageSize = 20,
  } = params;

  let result = list.filter((a) => {
    if (type && a.type !== type) return false;
    if (status && effectiveStatus(a) !== status) return false;
    if (priority && a.priority !== priority) return false;
    if (ownerId === "unassigned" ? a.ownerId : ownerId && a.ownerId !== ownerId) return false;
    if (team && a.assignedTeam !== team) return false;
    if (relatedRecordType && a.relatedRecordType !== relatedRecordType) return false;
    if (relatedRecordId && a.relatedRecordId !== relatedRecordId) return false;
    if (createdBy && a.createdBy !== createdBy) return false;
    if (hasReminder === "true" && !a.reminder?.enabled) return false;
    if (hasOutcome === "true" && !a.outcome) return false;
    const reference = a.dueDate || a.startAt;
    if (dateFrom && reference && new Date(reference) < new Date(dateFrom)) return false;
    if (dateTo && reference && new Date(reference) > new Date(dateTo)) return false;
    if (overdue === "true" && effectiveStatus(a) !== "Overdue") return false;
    if (upcoming === "true" && (!reference || new Date(reference) < new Date() || ["Completed", "Cancelled"].includes(a.status))) return false;
    if (completed === "true" && a.status !== "Completed") return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = `${a.title} ${a.description} ${a.relatedRecordLabel} ${a.ownerName}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfWeek = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);
  const summary = {
    total: result.length,
    dueToday: result.filter((a) => { const r = a.dueDate || a.startAt; return r && new Date(r) >= startOfToday && new Date(r) < new Date(startOfToday.getTime() + 86400000) && !["Completed", "Cancelled"].includes(a.status); }).length,
    overdue: result.filter((a) => effectiveStatus(a) === "Overdue").length,
    upcoming: result.filter((a) => { const r = a.dueDate || a.startAt; return r && new Date(r) >= now && new Date(r) < endOfWeek && !["Completed", "Cancelled"].includes(a.status); }).length,
    completedThisWeek: result.filter((a) => a.completedAt && new Date(a.completedAt) >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)).length,
    unassigned: result.filter((a) => !a.ownerId).length,
  };

  result = [...result].sort((a, b) => {
    const dir = order === "asc" ? 1 : -1;
    const av = a[sort] ?? a.dueDate ?? a.startAt;
    const bv = b[sort] ?? b.dueDate ?? b.startAt;
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    return av > bv ? dir : -dir;
  });

  const total = result.length;
  const pageNum = Math.max(1, Number(page));
  const size = Math.max(1, Number(pageSize));
  const start = (pageNum - 1) * size;
  const pageItems = result.slice(start, start + size);

  return { activities: pageItems, total, page: pageNum, pageSize: size, summary };
}

// ---- Conflict detection ----
// Two scheduled activities for the same owner with overlapping [start,end)
// windows. This is a frontend-only heuristic over fixture data, never
// presented as backend-confirmed.
export function findConflicts(activity, list = activities) {
  if (!activity.ownerId || !activity.startAt || activity.status !== "Scheduled") return [];
  const start = new Date(activity.startAt).getTime();
  const end = activity.endAt ? new Date(activity.endAt).getTime() : start + 30 * 60 * 1000;
  return list.filter((other) => {
    if (other._id === activity._id) return false;
    if (other.ownerId !== activity.ownerId) return false;
    if (other.status !== "Scheduled") return false;
    if (!other.startAt) return false;
    const oStart = new Date(other.startAt).getTime();
    const oEnd = other.endAt ? new Date(other.endAt).getTime() : oStart + 30 * 60 * 1000;
    return start < oEnd && oStart < end;
  });
}

// ---- CRUD ----
export function createActivityRecord(payload, actor = "System") {
  const activity = makeActivity({ ...payload, createdBy: actor, updatedBy: actor, createdAt: new Date().toISOString() });
  // Notes are logged as already-completed activities per spec.
  if (activity.type === "Note" && !payload.status) {
    activity.status = "Completed";
    activity.completedBy = actor;
    activity.completedAt = activity.createdAt;
  }
  activities.unshift(activity);
  return activity;
}

const AUDIT_TRACKED_FIELDS = ["title", "status", "priority", "ownerId", "ownerName", "assignedTeam", "startAt", "endAt", "dueDate"];

export function updateActivityRecord(activityId, changes, actor = "System") {
  const activity = findActivity(activityId);
  if (!activity) return null;
  for (const field of AUDIT_TRACKED_FIELDS) {
    if (field in changes && changes[field] !== activity[field]) {
      activity.auditLog.push(activityAuditEntry("update", actor, { field, before: activity[field] ?? null, after: changes[field] ?? null, reason: changes.reason || null }));
    }
  }
  Object.assign(activity, changes);
  activity.updatedAt = new Date().toISOString();
  activity.updatedBy = actor;
  return activity;
}

export function completeActivityRecord(activityId, { outcome, completionNote, followUp }, actor = "System") {
  const activity = findActivity(activityId);
  if (!activity) return null;
  activity.status = "Completed";
  activity.outcome = outcome || null;
  activity.completionNote = completionNote || null;
  activity.completedBy = actor;
  activity.completedAt = new Date().toISOString();
  activity.updatedAt = activity.completedAt;
  activity.updatedBy = actor;
  activity.auditLog.push(activityAuditEntry("complete", actor, { field: "status", before: "Scheduled", after: "Completed", reason: outcome }));

  let createdFollowUp = null;
  if (followUp?.dueDate) {
    createdFollowUp = makeActivity({
      type: "Follow-up", title: followUp.title || `Follow-up: ${activity.title}`, status: "Scheduled",
      relatedRecordType: activity.relatedRecordType, relatedRecordId: activity.relatedRecordId,
      ownerId: followUp.ownerId || activity.ownerId, dueDate: followUp.dueDate, startAt: followUp.dueDate,
      parentActivityId: activity._id, createdBy: actor, createdAt: new Date().toISOString(),
    });
    activities.unshift(createdFollowUp);
    activity.followUpActivityId = createdFollowUp._id;
  }
  return { activity, followUp: createdFollowUp };
}

// Standalone "Add Follow-up" action from the detail drawer — same linking
// behavior as the one embedded in completeActivityRecord, but callable
// without also completing the parent activity.
export function createFollowUpForActivity(activityId, { title, dueDate, ownerId }, actor = "System") {
  const parent = findActivity(activityId);
  if (!parent) return null;
  const owner = ownerId ? findTeamMember(ownerId) : findTeamMember(parent.ownerId);
  const followUp = makeActivity({
    type: "Follow-up", title: title || `Follow-up: ${parent.title}`, status: "Scheduled",
    relatedRecordType: parent.relatedRecordType, relatedRecordId: parent.relatedRecordId,
    ownerId: owner?.id || null, dueDate, startAt: dueDate,
    parentActivityId: parent._id, createdBy: actor, createdAt: new Date().toISOString(),
  });
  activities.unshift(followUp);
  parent.followUpActivityId = followUp._id;
  parent.updatedAt = new Date().toISOString();
  parent.updatedBy = actor;
  return { activity: parent, followUp };
}

export function rescheduleActivityRecord(activityId, { startAt, endAt, timezone, reminder, reason }, actor = "System") {
  const activity = findActivity(activityId);
  if (!activity) return null;
  const before = { startAt: activity.startAt, endAt: activity.endAt };
  activity.auditLog.push(activityAuditEntry("reschedule", actor, { field: "startAt", before: before.startAt, after: startAt, reason }));
  activity.startAt = startAt;
  if (endAt !== undefined) activity.endAt = endAt;
  if (activity.dueDate) activity.dueDate = startAt;
  if (timezone) activity.timezone = timezone;
  if (reminder !== undefined) activity.reminder = reminder;
  if (activity.status === "Missed" || activity.status === "Cancelled") activity.status = "Scheduled";
  activity.updatedAt = new Date().toISOString();
  activity.updatedBy = actor;
  return activity;
}

export function cancelActivityRecord(activityId, reason, actor = "System") {
  const activity = findActivity(activityId);
  if (!activity) return null;
  activity.status = "Cancelled";
  activity.cancelReason = reason;
  activity.cancelledBy = actor;
  activity.cancelledAt = new Date().toISOString();
  activity.updatedAt = activity.cancelledAt;
  activity.updatedBy = actor;
  activity.auditLog.push(activityAuditEntry("cancel", actor, { field: "status", before: activity.status, after: "Cancelled", reason }));
  return activity;
}

export function reopenActivityRecord(activityId, actor = "System") {
  const activity = findActivity(activityId);
  if (!activity) return null;
  const before = activity.status;
  activity.status = "Scheduled";
  activity.completedAt = null;
  activity.completedBy = null;
  activity.cancelReason = null;
  activity.cancelledAt = null;
  activity.cancelledBy = null;
  activity.updatedAt = new Date().toISOString();
  activity.updatedBy = actor;
  activity.auditLog.push(activityAuditEntry("reopen", actor, { field: "status", before, after: "Scheduled" }));
  return activity;
}

export function duplicateActivityRecord(activityId, actor = "System") {
  const original = findActivity(activityId);
  if (!original) return null;
  const {
    _id: _originalId, auditLog: _auditLog, followUpActivityId: _followUpActivityId,
    completedAt: _completedAt, completedBy: _completedBy, cancelledAt: _cancelledAt,
    cancelledBy: _cancelledBy, cancelReason: _cancelReason, ...rest
  } = original;
  const copy = makeActivity({ ...rest, title: `${original.title} (Copy)`, status: "Scheduled", createdBy: actor, createdAt: new Date().toISOString(), auditLog: [] });
  activities.unshift(copy);
  return copy;
}

export function addActivityAttachment(activityId, file, actor) {
  const activity = findActivity(activityId);
  if (!activity) return null;
  activity.attachments.push({ _id: id(), name: file.name, size: file.size, type: file.type, dataUrl: file.dataUrl, uploadedBy: actor, uploadedAt: new Date().toISOString() });
  return activity;
}

function applyToActivities(activityIds, fn) {
  return activityIds.map((aid) => findActivity(aid)).filter(Boolean).map(fn);
}
export function bulkAssignActivities(activityIds, ownerId, actor) {
  return applyToActivities(activityIds, (a) => updateActivityRecord(a._id, { ownerId, ownerName: findTeamMember(ownerId)?.name || null }, actor));
}
export function bulkRescheduleActivities(activityIds, newStartAt, actor) {
  return applyToActivities(activityIds, (a) => rescheduleActivityRecord(a._id, { startAt: newStartAt, endAt: a.endAt ? new Date(new Date(newStartAt).getTime() + (new Date(a.endAt) - new Date(a.startAt))).toISOString() : null }, actor));
}
export function bulkCompleteActivities(activityIds, actor) {
  return applyToActivities(activityIds, (a) => completeActivityRecord(a._id, {}, actor).activity);
}
export function bulkCancelActivities(activityIds, reason, actor) {
  return applyToActivities(activityIds, (a) => cancelActivityRecord(a._id, reason, actor));
}
