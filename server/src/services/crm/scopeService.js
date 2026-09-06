// Resolves a Prisma `where` fragment from the caller's role scope —
// permissionGrants says WHICH actions are allowed; a Role's `defaultScope`
// (System-wide | Organization | Department | Team | Own | Assigned | Customer
// Account) says WHICH records. This is applied to every list/search/
// duplicate-detection/summary/export query, always AFTER organizationId is
// already in the `where` clause, never as an afterthought filter on already-
// fetched rows.
//
// `membership.roles` can carry more than one Role — the caller gets the
// LEAST restrictive scope among their granted roles for this module (an
// explicit second grant should widen access, not narrow it unexpectedly).
const SCOPE_RANK = ["Own", "Assigned", "Team", "Department", "Customer Account", "Organization", "System-wide"];

function broadestScope(membership, moduleId) {
  const scopes = membership.roles
    .filter((mr) => (mr.role.permissionGrants || []).some((g) => g.moduleId === moduleId))
    .map((mr) => mr.role.defaultScope)
    .filter(Boolean);
  if (scopes.length === 0) return "Own";
  return scopes.reduce((broadest, s) => (SCOPE_RANK.indexOf(s) > SCOPE_RANK.indexOf(broadest) ? s : broadest), scopes[0]);
}

// `ownerField` is the model's own-record field (e.g. "ownerMembershipId");
// `assignedField` only applies to models that have one (Activity's
// "assignedMembershipId" — Lead/Contact/Company have no separate assignee
// concept today, so pass null for those).
export function resolveCrmScopeWhere({ user, membership, isSystemOwnerOverride }, moduleId, { ownerField = "ownerMembershipId", assignedField = null } = {}) {
  if (isSystemOwnerOverride) return {};

  const scope = broadestScope(membership, moduleId);
  if (scope === "System-wide" || scope === "Organization") return {};

  if (scope === "Department") {
    return user.department ? { department: user.department } : { [ownerField]: membership.id };
  }
  if (scope === "Team") {
    return user.team ? { team: user.team } : { [ownerField]: membership.id };
  }
  if (scope === "Assigned" && assignedField) {
    return { OR: [{ [ownerField]: membership.id }, { [assignedField]: membership.id }] };
  }
  // "Own" (and any unrecognized/most-restrictive scope) — owned records
  // only, or also-assigned ones when the model supports it.
  return assignedField ? { OR: [{ [ownerField]: membership.id }, { [assignedField]: membership.id }] } : { [ownerField]: membership.id };
}
