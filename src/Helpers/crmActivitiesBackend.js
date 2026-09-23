// Backend-mode data source for the Activities pages
// (VITE_BACKEND_CRM_SALES_MODE=true). The Activities UI keeps every
// activity in the store (agenda/calendar views need the whole set) and
// filters client-side, so this loads them all. Scheduling conflicts are
// computed client-side over the loaded list with the same rule the mock
// layer uses (findConflicts).
import * as crm from "./backendCrmClient";
import { findConflicts } from "./mockActivitiesData";
import { orgId, ownersMap, ownerFields, listAll } from "./crmBackendCommon";

export const BACKEND_ENABLED = crm.BACKEND_CRM_SALES_MODE_ENABLED;

// UI related-record type → API foreign key.
const RELATED_FIELDS = { Lead: "leadId", Contact: "contactId", Company: "companyId", Deal: "dealId" };

const RENAMED = {
  startAt: "scheduledStart",
  endAt: "scheduledEnd",
  timezone: "timeZone",
  assignedTeam: "team",
  parentActivityId: "followUpActivityId",
};

export function toUiActivity(activity, ownersById = new Map()) {
  if (!activity) return activity;
  const [relatedRecordType, apiField] = Object.entries(RELATED_FIELDS).find(([, field]) => activity[field]) || [null, null];
  const relation = apiField ? activity[apiField.replace(/Id$/, "")] : null;
  const ui = { ...activity };
  for (const [uiName, apiName] of Object.entries(RENAMED)) ui[uiName] = activity[apiName] ?? null;
  return {
    ...ui,
    ...ownerFields(activity, ownersById),
    relatedRecordType,
    relatedRecordId: apiField ? activity[apiField] : null,
    relatedRecordLabel: relation?.name || "",
    participants: Array.isArray(activity.participants) ? activity.participants : [],
    attachments: Array.isArray(activity.attachments) ? activity.attachments : [],
    // The follow-up created from this activity points back at it, not the
    // other way round, so the forward link isn't known from this record.
    followUpActivityId: null,
    auditLog: [],
  };
}

export function toApiActivity(payload = {}) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "relatedRecordType" || key === "relatedRecordLabel" || key === "ownerName" || key === "followUpActivityId") continue;
    if (key === "relatedRecordId") continue; // handled below with its type
    if (key === "ownerId") {
      // One person owns and is assigned an activity in the UI; scope rules
      // on the server look at either field.
      out.ownerMembershipId = value || null;
      out.assignedMembershipId = value || null;
    } else {
      out[RENAMED[key] || key] = value;
    }
  }
  if ("relatedRecordType" in payload || "relatedRecordId" in payload) {
    for (const field of Object.values(RELATED_FIELDS)) out[field] = null;
    const field = RELATED_FIELDS[payload.relatedRecordType];
    if (field && payload.relatedRecordId) out[field] = payload.relatedRecordId;
  }
  return out;
}

export async function listActivities() {
  const organizationId = orgId();
  const owners = await ownersMap();
  const activities = await listAll(async (page, pageSize) => {
    const { activities: items, total } = await crm.listActivities(organizationId, { page, pageSize });
    return { items: items || [], total };
  });
  return activities.map((a) => toUiActivity(a, owners));
}

export async function getActivity(activityId) {
  const [{ activity }, owners] = await Promise.all([crm.getActivity(orgId(), activityId), ownersMap()]);
  return toUiActivity(activity, owners);
}

export async function createActivity(payload, existing = []) {
  const { activity } = await crm.createActivity(orgId(), toApiActivity(payload));
  const created = toUiActivity(activity, await ownersMap());
  return { activity: created, conflicts: findConflicts(created, existing) };
}

export async function updateActivity(activityId, changes, existing = []) {
  const { activity } = await crm.updateActivity(orgId(), activityId, toApiActivity(changes));
  const updated = toUiActivity(activity, await ownersMap());
  return { activity: updated, conflicts: findConflicts(updated, existing) };
}

export async function completeActivity(activityId, { outcome, completionNote, followUp }) {
  const { activity, followUp: created } = await crm.completeActivity(orgId(), activityId, {
    outcome,
    completionNote,
    followUpRequired: !!followUp?.dueDate,
    createFollowUp: !!followUp?.dueDate,
    followUpDate: followUp?.dueDate || null,
    followUpTitle: followUp?.title,
    followUpOwnerMembershipId: followUp?.ownerId || undefined,
  });
  const owners = await ownersMap();
  return { activity: toUiActivity(activity, owners), followUp: created ? toUiActivity(created, owners) : null };
}

// A follow-up on an open activity: a new Scheduled activity on the same
// related record, pointing back at its parent.
export async function createFollowUp(activityId, { title, dueDate, ownerId }) {
  const parent = await getActivity(activityId);
  const { activity: followUp } = await createActivity({
    type: "Follow-up",
    title: title || `Follow-up: ${parent.title}`,
    dueDate,
    startAt: dueDate,
    ownerId: ownerId || parent.ownerId,
    relatedRecordType: parent.relatedRecordType,
    relatedRecordId: parent.relatedRecordId,
    parentActivityId: parent._id,
  });
  return { activity: parent, followUp };
}

export async function rescheduleActivity(activityId, { startAt, endAt, timezone, reminder }, existing = []) {
  return updateActivity(activityId, { startAt, endAt, dueDate: startAt, timezone, reminder }, existing);
}

export async function cancelActivity(activityId, reason) {
  const { activity } = await crm.cancelActivity(orgId(), activityId, reason);
  return toUiActivity(activity, await ownersMap());
}

export async function reopenActivity(activityId) {
  const { activity } = await crm.reopenActivity(orgId(), activityId);
  return toUiActivity(activity, await ownersMap());
}

const COPIED_FIELDS = [
  "type", "title", "description", "priority", "ownerId", "relatedRecordType", "relatedRecordId", "startAt", "endAt", "dueDate", "timezone",
  "reminder", "assignedTeam", "participants", "phone", "callDirection", "callPurpose", "expectedDurationMinutes", "emailDirection",
  "subject", "location", "agenda", "visibility",
];

export async function duplicateActivity(activityId) {
  const source = await getActivity(activityId);
  const copy = Object.fromEntries(COPIED_FIELDS.filter((f) => source[f] !== undefined).map((f) => [f, source[f]]));
  const { activity } = await createActivity({ ...copy, title: `${source.title} (copy)` });
  return activity;
}

export function conflictsFor(activity, existing = []) {
  return findConflicts(activity, existing);
}

async function bulk(payload) {
  await crm.bulkActivities(orgId(), payload);
  return Promise.all(payload.ids.map((id) => getActivity(id).catch(() => null))).then((list) => list.filter(Boolean));
}

export const bulkAssignActivities = (ids, ownerId) => bulk({ action: "assign", ids, ownerMembershipId: ownerId, assignedMembershipId: ownerId });
export const bulkRescheduleActivities = (ids, startAt) => bulk({ action: "reschedule", ids, scheduledStart: startAt, dueDate: startAt });
export const bulkCompleteActivities = (ids) => bulk({ action: "complete", ids });
export const bulkCancelActivities = (ids, reason) => bulk({ action: "cancel", ids, reason });
