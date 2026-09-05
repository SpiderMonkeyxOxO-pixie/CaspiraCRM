import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Plus, Search, RefreshCw, Download, MoreHorizontal, Users, UserX, UsersRound,
  ShieldAlert, Clock, History,
} from "lucide-react";
import {
  fetchMembers, fetchOrganizations, changeMemberRole, suspendMember, reactivateMember, removeMember,
  assignMemberDepartmentTeam, selectAccessManagement,
} from "../../redux/admin/accessManagementSlice";
import {
  isSystemOwner, canInviteMembers, canChangeMemberRole, canSuspendMembers, canReactivateMembers,
  canRemoveMembers, canModifyMember, getInvitableRoleTemplates, isHighPrivilegeRoleId,
} from "./accessManagementConfig";
import { findRoleTemplate } from "../../Helpers/mockRbacData";
import InviteMemberWizard from "./InviteMemberWizard";

function roleName(roleIds = []) {
  return roleIds.map((id) => findRoleTemplate(id)?.name || id).join(", ") || "—";
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const STATUS_COLORS = {
  Active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Suspended: "bg-red-500/15 text-red-300 border-red-500/30",
  Invited: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Approval Pending": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Deactivated: "bg-gray-700/40 text-gray-400 border-gray-600/40",
  Removed: "bg-gray-800 text-gray-500 border-gray-700",
};

export default function MembersList() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, members, memberCounts, teams, departments, loading, error } = useSelector(selectAccessManagement);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const [showFilters, setShowFilters] = useState(false);
  const [openRowMenu, setOpenRowMenu] = useState(null);
  const [showInviteWizard, setShowInviteWizard] = useState(false);
  const [reasonModal, setReasonModal] = useState(null); // { member, kind, title, confirmLabel }
  const [reasonText, setReasonText] = useState("");
  const [roleChangeTarget, setRoleChangeTarget] = useState(null); // { member, newRoleId }
  const [assignModal, setAssignModal] = useState(null); // { member }
  const [assignDepartment, setAssignDepartment] = useState("");
  const [assignTeam, setAssignTeam] = useState("");

  const owner = isSystemOwner(role);
  const canInvite = canInviteMembers(role);
  const invitableRoles = getInvitableRoleTemplates(role);

  const filters = useMemo(() => {
    const p = {};
    for (const [k, v] of searchParams.entries()) p[k] = v;
    return p;
  }, [searchParams]);

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  useEffect(() => {
    dispatch(fetchMembers(filters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, JSON.stringify(filters)]);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchInput) next.set("search", searchInput); else next.delete("search");
      setSearchParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
  };

  const clearFilters = () => setSearchParams({});

  // Client-side refinements the mock API doesn't filter server-side:
  // high-privilege, has-pending-invitation-shaped views are metric-driven,
  // membersWithoutTeam is computed here too.
  const filteredMembers = useMemo(() => {
    let list = members;
    if (filters.highPrivilege === "true") list = list.filter((m) => m.roleIds.some(isHighPrivilegeRoleId));
    if (filters.noTeam === "true") list = list.filter((m) => !m.teamId);
    return list;
  }, [members, filters.highPrivilege, filters.noTeam]);

  const showOrganizationColumn = owner && organizations.length > 1;

  const cardFilters = {
    active: () => updateFilter("status", "Active"),
    suspended: () => updateFilter("status", "Suspended"),
    noTeam: () => updateFilter("noTeam", "true"),
    highPrivilege: () => updateFilter("highPrivilege", "true"),
  };

  const exportPreview = () => {
    const rows = filteredMembers.map((m) => ({
      Name: m.name, Email: m.email, Organization: organizations.find((o) => o.id === m.organizationId)?.name || m.organizationId,
      Role: roleName(m.roleIds), Department: m.departmentId || "", Team: teams.find((t) => t.id === m.teamId)?.name || "",
      Status: m.status, "Two-Factor": m.twoFactorStatus, "Joined": formatDate(m.joinedDate), "Last Active": formatDate(m.lastActive),
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Members Preview");
    XLSX.writeFile(workbook, "members-export-preview.xlsx");
  };

  const closeReasonModal = () => { setReasonModal(null); setReasonText(""); setRoleChangeTarget(null); };

  const openAssignModal = (member) => {
    setAssignModal({ member });
    setAssignDepartment(member.departmentId || "");
    setAssignTeam(member.teamId || "");
  };
  const closeAssignModal = () => { setAssignModal(null); setAssignDepartment(""); setAssignTeam(""); };
  const confirmAssign = async () => {
    if (!assignModal) return;
    await dispatch(assignMemberDepartmentTeam({ id: assignModal.member.id, department: assignDepartment || null, team: assignTeam || null }));
    closeAssignModal();
    dispatch(fetchMembers(filters));
  };

  const confirmReasonAction = async () => {
    if (!reasonText.trim() || !reasonModal) return;
    const { member, kind } = reasonModal;
    if (kind === "suspend") await dispatch(suspendMember({ id: member.id, reason: reasonText }));
    if (kind === "reactivate") await dispatch(reactivateMember({ id: member.id, reason: reasonText }));
    if (kind === "remove") await dispatch(removeMember({ id: member.id, reason: reasonText }));
    if (kind === "role" && roleChangeTarget) await dispatch(changeMemberRole({ id: member.id, newRoleId: roleChangeTarget.newRoleId, reason: reasonText }));
    closeReasonModal();
    dispatch(fetchMembers(filters));
  };

  return (
      <div className="p-4 md:p-6 space-y-5 text-white">
        <div className="text-xs text-gray-500 flex items-center gap-1">
          <span>Users &amp; Access</span> <span>/</span> <span className="text-gray-300">Members</span>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Members</h1>
            <p className="text-sm text-gray-400 mt-1 max-w-2xl">
              Everyone with access across your authorized organizations. Every invitation, role assignment and
              organization join shown here is a frontend preview — no real account or membership is created until a
              future backend phase.
            </p>
            <p className="text-xs text-gray-500 mt-1">{filteredMembers.length} member{filteredMembers.length === 1 ? "" : "s"} visible</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {owner && organizations.length > 1 && (
              <select
                aria-label="Organization"
                value={filters.organizationId || ""}
                onChange={(e) => updateFilter("organizationId", e.target.value)}
                className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="">All organizations</option>
                {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            {!owner && organizations[0] && (
              <span className="text-xs text-gray-500 border border-gray-800 rounded-lg px-3 py-2" title="Your organization is fixed and cannot be changed here.">
                {organizations[0].name}
              </span>
            )}
            <button onClick={() => dispatch(fetchMembers(filters))} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
              <RefreshCw size={15} /> Refresh
            </button>
            <button onClick={exportPreview} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
              <Download size={15} /> Export Preview
            </button>
            {canInvite && (
              <button onClick={() => setShowInviteWizard(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium">
                <Plus size={15} /> Invite Member
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <MetricCard label="Active Members" value={memberCounts?.active ?? "—"} onClick={cardFilters.active} />
          <MetricCard label="Pending Invitations" value={memberCounts?.pendingInvitations ?? "—"} icon={<Clock size={14} className="text-blue-400" />} />
          <MetricCard label="Suspended" value={memberCounts?.suspended ?? "—"} icon={<UserX size={14} className="text-red-400" />} onClick={cardFilters.suspended} />
          <MetricCard label="Without Team" value={members.filter((m) => !m.teamId).length} icon={<UsersRound size={14} />} onClick={cardFilters.noTeam} />
          <MetricCard label="High-Privilege" value={memberCounts?.administrators ?? "—"} icon={<ShieldAlert size={14} className="text-amber-400" />} onClick={cardFilters.highPrivilege} />
          <MetricCard label="Teams" value={memberCounts?.teams ?? "—"} icon={<Users size={14} />} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              aria-label="Search Members"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search members by name or email..."
              className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white"
            />
          </div>
          <button onClick={() => setShowFilters(true)} className="border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
            Filters {Object.keys(filters).length > 0 && `(${Object.keys(filters).length})`}
          </button>
          {Object.keys(filters).length > 0 && (
            <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-300">Clear all</button>
          )}
        </div>

        {loading && <div className="text-center text-gray-400 py-12 text-sm">Loading members…</div>}
        {error && (
          <div className="text-center py-12">
            <p className="text-red-400 text-sm mb-3">{error}</p>
            <button onClick={() => dispatch(fetchMembers(filters))} className="text-sm text-blue-400 hover:underline">Retry</button>
          </div>
        )}

        {!loading && !error && filteredMembers.length === 0 && (
          <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
            <Users size={28} className="mx-auto text-gray-600 mb-2" />
            <p className="text-gray-300 text-sm mb-1">No members match this view</p>
            <p className="text-gray-500 text-xs">Try adjusting your filters.</p>
          </div>
        )}

        {!loading && !error && filteredMembers.length > 0 && (
          <div className="overflow-x-auto border border-gray-800 rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
                <tr>
                  <th scope="col" className="text-left px-4 py-3">Member</th>
                  <th scope="col" className="text-left px-4 py-3">Email</th>
                  {showOrganizationColumn && <th scope="col" className="text-left px-4 py-3">Organization</th>}
                  <th scope="col" className="text-left px-4 py-3">Role</th>
                  <th scope="col" className="text-left px-4 py-3">Department</th>
                  <th scope="col" className="text-left px-4 py-3">Team</th>
                  <th scope="col" className="text-left px-4 py-3">Status</th>
                  <th scope="col" className="text-left px-4 py-3">2FA</th>
                  <th scope="col" className="text-left px-4 py-3">Last Active</th>
                  <th scope="col" className="text-left px-4 py-3">Joined</th>
                  <th scope="col" className="text-left px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => {
                  const canModify = canModifyMember(role, member);
                  const org = organizations.find((o) => o.id === member.organizationId);
                  const team = teams.find((t) => t.id === member.teamId);
                  return (
                    <tr key={member.id} className="border-t border-gray-800 hover:bg-gray-900/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-800 text-[11px] font-medium text-gray-300 shrink-0">
                            {member.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                          </span>
                          <span className="text-white font-medium">{member.name}</span>
                          {member.roleIds.some(isHighPrivilegeRoleId) && <ShieldAlert size={13} className="text-amber-400" aria-label="High privilege" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{member.email}</td>
                      {showOrganizationColumn && <td className="px-4 py-3 text-gray-300">{org?.name || member.organizationId}</td>}
                      <td className="px-4 py-3 text-gray-300">{roleName(member.roleIds)}</td>
                      <td className="px-4 py-3 text-gray-300">{member.departmentId || "—"}</td>
                      <td className="px-4 py-3 text-gray-300">{team?.name || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] border ${STATUS_COLORS[member.status] || ""}`}>{member.status}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{member.twoFactorStatus === "Enabled" ? "Enabled" : "Not enabled"}</td>
                      <td className="px-4 py-3 text-gray-400">{formatDate(member.lastActive)}</td>
                      <td className="px-4 py-3 text-gray-400">{formatDate(member.joinedDate)}</td>
                      <td className="px-4 py-3">
                        <div className="relative">
                          <button
                            onClick={() => setOpenRowMenu(openRowMenu === member.id ? null : member.id)}
                            aria-label={`Row actions for ${member.name}`}
                            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400"
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          {openRowMenu === member.id && (
                            <div role="menu" className="absolute right-0 mt-1 w-56 bg-[#12141c] border border-gray-800 rounded-xl shadow-xl z-20 py-1">
                              <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800" onClick={() => setOpenRowMenu(null)}>
                                View profile
                              </button>
                              <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800" onClick={() => setOpenRowMenu(null)}>
                                <History size={13} className="inline mr-1.5" /> View access history
                              </button>
                              {canModify && (
                                <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800"
                                  onClick={() => { setOpenRowMenu(null); openAssignModal(member); }}>
                                  Change department / team
                                </button>
                              )}
                              {canChangeMemberRole(role) && canModify && invitableRoles.length > 0 && (
                                <div className="border-t border-gray-800 my-1" role="none">
                                  <p className="px-4 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-gray-500">Change role</p>
                                  {invitableRoles.slice(0, 6).map((r) => (
                                    <button
                                      key={r.id} role="menuitem"
                                      className="w-full text-left px-4 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
                                      onClick={() => {
                                        setOpenRowMenu(null);
                                        setRoleChangeTarget({ member, newRoleId: r.id });
                                        setReasonModal({ member, kind: "role", title: `Change ${member.name}'s role to ${r.name}` });
                                      }}
                                    >
                                      {r.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="border-t border-gray-800 my-1" role="none" />
                              {member.status !== "Suspended" && canSuspendMembers(role) && canModify && (
                                <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-amber-300 hover:bg-gray-800"
                                  onClick={() => { setOpenRowMenu(null); setReasonModal({ member, kind: "suspend", title: `Suspend ${member.name}` }); }}>
                                  Suspend
                                </button>
                              )}
                              {member.status === "Suspended" && canReactivateMembers(role) && canModify && (
                                <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-emerald-300 hover:bg-gray-800"
                                  onClick={() => { setOpenRowMenu(null); setReasonModal({ member, kind: "reactivate", title: `Reactivate ${member.name}` }); }}>
                                  Reactivate
                                </button>
                              )}
                              {canRemoveMembers(role) && canModify && member.status !== "Removed" && (
                                <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-800"
                                  onClick={() => { setOpenRowMenu(null); setReasonModal({ member, kind: "remove", title: `Remove ${member.name} from the organization` }); }}>
                                  Remove from organization
                                </button>
                              )}
                              {!canModify && (
                                <p className="px-4 py-2 text-xs text-gray-500">You cannot modify a member with equal or higher administrative authority.</p>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {showFilters && (
          <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Filters">
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowFilters(false)} />
            <div className="relative bg-[#12141c] border-l border-gray-800 w-full max-w-sm h-full p-5 overflow-y-auto">
              <h3 className="text-lg font-semibold text-white mb-4">Filters</h3>
              <div className="space-y-4">
                <FilterSelect label="Role" value={filters.roleId} onChange={(v) => updateFilter("roleId", v)} options={invitableRoles.map((r) => ({ value: r.id, label: r.name }))} />
                <FilterSelect label="Department" value={filters.department} onChange={(v) => updateFilter("department", v)} options={departments.map((d) => ({ value: d, label: d }))} />
                <FilterSelect label="Team" value={filters.team} onChange={(v) => updateFilter("team", v)} options={teams.map((t) => ({ value: t.id, label: t.name }))} />
                <FilterSelect label="Membership status" value={filters.status} onChange={(v) => updateFilter("status", v)} options={["Active", "Suspended", "Invited", "Approval Pending", "Deactivated", "Removed"].map((s) => ({ value: s, label: s }))} />
                <FilterSelect label="Two-factor status" value={filters.twoFactorStatus} onChange={(v) => updateFilter("twoFactorStatus", v)} options={[{ value: "Enabled", label: "Enabled" }, { value: "Not Enabled", label: "Not Enabled" }]} />
              </div>
              <button onClick={() => setShowFilters(false)} className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium">Apply</button>
            </div>
          </div>
        )}

        {reasonModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={reasonModal.title}>
            <div className="absolute inset-0 bg-black/60" onClick={closeReasonModal} />
            <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold text-white mb-2">{reasonModal.title}</h3>
              <p className="text-sm text-gray-400 mb-3">This action updates frontend state only for this session. Provide a written reason.</p>
              <label htmlFor="member-action-reason" className="block text-xs text-gray-400 mb-1">Reason</label>
              <textarea id="member-action-reason" value={reasonText} onChange={(e) => setReasonText(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white mb-4" rows={3} />
              <div className="flex justify-end gap-2">
                <button onClick={closeReasonModal} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
                <button onClick={confirmReasonAction} disabled={!reasonText.trim()} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg">Confirm</button>
              </div>
            </div>
          </div>
        )}

        {assignModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Change ${assignModal.member.name}'s department and team`}>
            <div className="absolute inset-0 bg-black/60" onClick={closeAssignModal} />
            <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Change {assignModal.member.name}&rsquo;s department / team</h3>
              <div className="space-y-3">
                <FilterSelect label="Department" value={assignDepartment} onChange={setAssignDepartment} options={departments.map((d) => ({ value: d, label: d }))} />
                <FilterSelect
                  label="Team"
                  value={assignTeam}
                  onChange={setAssignTeam}
                  options={teams.filter((t) => t.organizationId === assignModal.member.organizationId).map((t) => ({ value: t.id, label: t.name }))}
                />
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={closeAssignModal} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
                <button onClick={confirmAssign} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Save</button>
              </div>
            </div>
          </div>
        )}

        {showInviteWizard && (
          <InviteMemberWizard
            actingRole={role}
            organizations={organizations}
            onClose={() => setShowInviteWizard(false)}
            onCompleted={() => { setShowInviteWizard(false); dispatch(fetchMembers(filters)); }}
          />
        )}
      </div>
  );
}

function MetricCard({ label, value, icon, onClick }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="text-left bg-gray-900/40 border border-gray-800 rounded-xl p-3 hover:border-gray-700 disabled:cursor-default transition">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase">{icon}{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
    </button>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <select aria-label={label} value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
        <option value="">All</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

