// Backend Phase 5 — who can see and manage which project, plus the
// append-only project history. Organization scope comes first (as for every
// module); project membership is then how narrower scopes see projects.
// Membership never grants access to unrelated CRM or financial records.
import { broadestScope } from "../crm/scopeService.js";
import { hasGrant } from "../../utils/grants.js";
import { MANAGING_ROLES } from "./projectRulesService.js";

// Organization/System-wide: every project. Narrower: projects the member
// manages, created, belongs to (active member) or has a task assigned in;
// Department scope also sees its department's projects.
export function projectScopeWhere(req) {
  if (req.isSystemOwnerOverride) return {};
  const scope = broadestScope(req.membership, "projects");
  if (scope === "Organization" || scope === "System-wide") return {};
  const me = req.membership.id;
  const or = [
    { ownerMembershipId: me },
    { createdByMembershipId: me },
    { members: { some: { membershipId: me, active: true } } },
    { tasks: { some: { assigneeMembershipId: me } } },
  ];
  if ((scope === "Department" || scope === "Team") && req.user?.department) or.push({ department: req.user.department });
  return { OR: or };
}

// Tasks: organization scope, or tasks in projects the member can see
// through membership/management, or assigned to/created by them.
export function taskScopeWhere(req) {
  if (req.isSystemOwnerOverride) return {};
  const scope = broadestScope(req.membership, "tasks");
  if (scope === "Organization" || scope === "System-wide") return {};
  const me = req.membership.id;
  const or = [
    { assigneeMembershipId: me },
    { createdByMembershipId: me },
    { assignees: { some: { membershipId: me, removedAt: null } } },
    { project: { ownerMembershipId: me } },
    { project: { members: { some: { membershipId: me, active: true } } } },
  ];
  if ((scope === "Department" || scope === "Team") && req.user?.department) or.push({ project: { department: req.user.department } });
  return { OR: or };
}

// Whether the caller manages this project's work: an organization-wide
// grant holder (admin-level scope), the project manager, or an active
// member in a managing role with Edit access.
export function managesProject(req, project) {
  if (req.isSystemOwnerOverride) return true;
  const scope = broadestScope(req.membership, "projects");
  if ((scope === "Organization" || scope === "System-wide") && hasGrant(req, "projects", "edit")) return true;
  const me = req.membership?.id;
  if (!me) return false;
  if (project.ownerMembershipId === me) return true;
  return (project.members || []).some((m) => m.membershipId === me && m.active && m.accessLevel === "Edit" && MANAGING_ROLES.includes(m.role));
}

export function projectRoleOf(req, project) {
  const me = req.membership?.id;
  if (project.ownerMembershipId === me) return "Project Manager";
  return (project.members || []).find((m) => m.membershipId === me && m.active)?.role || null;
}

// Budget and other financial fields only with the financial-fields grant.
export const canSeeFinancials = (req) => hasGrant(req, "projects", "view_financial_fields");

// Append-only history. Pass a dedupeKey for anything a job might repeat.
export function projectActivity(tx, { organizationId, projectId, taskId = null, eventType, actorMembershipId = null, actorPortalAccountId = null, actorType = "Member", fromValue = null, toValue = null, reason = null, snapshot = {}, customerVisible = false, dedupeKey = null }) {
  return tx.projectActivity.create({
    data: {
      organizationId, projectId, taskId, eventType, actorType, actorMembershipId, actorPortalAccountId,
      fromValue: fromValue === null || fromValue === undefined ? null : String(fromValue),
      toValue: toValue === null || toValue === undefined ? null : String(toValue),
      reason, snapshot, customerVisible, dedupeKey,
    },
  });
}
