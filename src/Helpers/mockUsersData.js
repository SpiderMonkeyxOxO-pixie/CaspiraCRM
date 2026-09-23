// Fixed roster of assignable CRM owners. Lead/deal assignment must target a
// real, validated entry here rather than accepting arbitrary free text —
// this is what "prevent invalid owners" actually checks against.
export const CRM_TEAM = [
  { id: "u1", name: "Dominic Wuckert", role: "Sales Manager", department: "Sales" },
  { id: "u2", name: "Priya Nair", role: "Sales Rep", department: "Sales" },
  { id: "u3", name: "Marcus Chen", role: "Sales Rep", department: "Sales" },
  { id: "u4", name: "Fatima Al-Sayed", role: "Sales Rep", department: "Sales" },
  { id: "u5", name: "Liam O'Connor", role: "Support Rep", department: "Support" },
  { id: "u6", name: "Grace Kim", role: "Marketing Manager", department: "Marketing" },
];

export const CRM_DEPARTMENTS = ["Sales", "Support", "Marketing"];

// The mock session user isn't itself a CRM_TEAM roster member (there's no
// real per-user identity model here), so "owner=me" filters resolve to this
// fixed roster id for the life of the mock — shared by every route that
// supports an "owner=me" filter (Leads, Deals, Pipeline) rather than each
// one hard-coding its own id.
export const CURRENT_MOCK_OWNER_ID = "u1";

// Real organization members, registered by crmBackendCommon.js once loaded
// in backend mode, so name lookups by owner id work for membership ids too.
const registeredMembers = new Map();

export function registerTeamMembers(members) {
  for (const member of members) registeredMembers.set(member.id, member);
}

export function findTeamMember(ownerId) {
  return registeredMembers.get(ownerId) || CRM_TEAM.find((u) => u.id === ownerId);
}

export function isValidOwner(ownerId) {
  return CRM_TEAM.some((u) => u.id === ownerId);
}

export function isValidDepartment(department) {
  return CRM_DEPARTMENTS.includes(department);
}
