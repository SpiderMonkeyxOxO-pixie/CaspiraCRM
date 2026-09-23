// Whether the caller holds `action` on `moduleId` — for a second permission
// inside a request whose route already checked the first one (e.g. changing
// an owner during an edit also needs "assign"). System Owner override
// passes, as it does in requireCrmOrgPermission.
export function hasGrant(req, moduleId, action) {
  if (req.isSystemOwnerOverride) return true;
  return membershipHasGrant(req.membership, moduleId, action);
}

export function membershipHasGrant(membership, moduleId, action) {
  return (membership?.roles || []).some((mr) => (mr.role.permissionGrants || []).some((g) => g.moduleId === moduleId && g.actions.includes(action)));
}
