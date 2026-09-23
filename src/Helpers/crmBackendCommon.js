// Shared plumbing for the backend-mode CRM adapters (crmLeadsBackend.js,
// crmContactsBackend.js, crmCompaniesBackend.js): the active organization,
// its members as owner choices, the note → activity-timeline mapping, and
// the "not available yet" error used instead of silently falling back to
// mock data.
import * as crm from "./backendCrmClient";
import { listMembers } from "./backendAuthClient";
import { getActiveOrganizationId } from "./backendSession";
import { registerTeamMembers } from "./mockUsersData";

export const MAX_PAGE_SIZE = 100; // server cap — larger requests are paged through

export class BackendNotSupportedError extends Error {}

export function notSupported(what) {
  return new BackendNotSupportedError(`${what} isn't available with the real backend yet.`);
}

export function orgId() {
  const id = getActiveOrganizationId();
  if (!id) throw new Error("No active organization — log out and back in.");
  return id;
}

let ownersPromise = null;

// [{ id: membershipId, userId, name, role }] — owner pickers use these ids
// as `ownerId`, so they round-trip to ownerMembershipId directly. A role
// without members:view gets an error here; that degrades to an empty list
// ("Unassigned" only) rather than breaking the page.
export function fetchCrmOwners() {
  ownersPromise ||= listMembers(orgId(), { pageSize: 100 })
    .then(({ members }) =>
      (members || [])
        .filter((m) => m.status === "Active")
        .map((m) => ({ id: m._id, userId: m.userId, name: m.user?.name || m.user?.username || "Member", role: m.roles?.[0]?.name || "" }))
    )
    .then((owners) => {
      registerTeamMembers(owners);
      return owners;
    })
    .catch(() => []);
  return ownersPromise;
}

export function resetCrmOwnersCache() {
  ownersPromise = null;
}

export async function ownersMap() {
  return new Map((await fetchCrmOwners()).map((o) => [o.id, o]));
}

export function ownerFields(record, ownersById) {
  return {
    ownerId: record.ownerMembershipId || null,
    ownerName: ownersById.get(record.ownerMembershipId)?.name || (record.ownerMembershipId ? "Member" : null),
  };
}

export async function currentMembershipId() {
  let me = null;
  try {
    me = JSON.parse(localStorage.getItem("data") || "null");
  } catch {
    me = null;
  }
  return (await fetchCrmOwners()).find((o) => o.userId === me?._id)?.id || null;
}

// ownerId filter → ownerMembershipId ("me" → the caller's own membership),
// and the server's page-size cap.
export async function ownerAndPagingParams({ ownerId, pageSize, ...rest } = {}) {
  const out = { ...rest };
  if (ownerId === "me") out.ownerMembershipId = (await currentMembershipId()) || "none";
  else if (ownerId) out.ownerMembershipId = ownerId;
  out.pageSize = Math.min(MAX_PAGE_SIZE, Number(pageSize) || 20);
  return out;
}

// Timeline = a "created" entry plus the record's CrmNotes, oldest first.
export function activityTimeline(record, notes, ownersById, createdLabel) {
  return [
    { _id: `${record._id}-created`, type: "created", actor: "System", at: record.createdAt, description: createdLabel, meta: {} },
    ...notes.map((n) => ({
      _id: n._id,
      type: "note",
      actor: ownersById.get(n.authorMembershipId)?.name || "Member",
      at: n.createdAt,
      description: n.body,
      meta: {},
    })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
}

export function listNotesFor(recordRef) {
  return crm.listNotes(orgId(), recordRef).then((r) => r.notes || []).catch(() => []);
}

export function addNoteTo(recordRef, body) {
  return crm.createNote(orgId(), { ...recordRef, body });
}

// Pages through a list endpoint until every matching record is loaded.
export async function listAll(fetchPage) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const { items, total } = await fetchPage(page, MAX_PAGE_SIZE);
    all.push(...items);
    if (all.length >= total || items.length === 0) return all;
  }
}

export function newIdempotencyKey(prefix) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
