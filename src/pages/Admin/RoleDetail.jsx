import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, Link } from "react-router-dom";
import {
  ChevronRight, Pencil, Copy, Eye, GitCompare, Ban, Archive, ArchiveRestore,
  ShieldAlert, Users, AlertTriangle, History, ScrollText, X,
} from "lucide-react";
import { fetchRole, archiveRole, restoreRole, disableRole, enableRole } from "../../redux/admin/rolesSlice";
import { ACTION_LABELS, isHighPrivilegeRole, findModule, hasPermission } from "../../Helpers/mockRbacData";
import { ROLE_TYPE_COLORS, ROLE_STATUS_COLORS, SCOPE_COLORS, FIELD_STATE_COLORS, formatDateTime } from "./rbacUtils";
import RoleBuilder from "./RoleBuilder";
import CompareRolesDialog from "./CompareRolesDialog";
import AccessPreviewPanel from "./AccessPreviewPanel";

const TABS = ["Overview", "Permissions", "Scopes", "Assigned Users", "Conflicts", "Change History", "Audit Preview"];

export default function RoleDetail() {
  const { roleId } = useParams();
  const dispatch = useDispatch();
  const { current, currentNotFound, loading } = useSelector((s) => s.adminRoles);

  const [tab, setTab] = useState("Overview");
  const [builderState, setBuilderState] = useState(null);
  const [showCompare, setShowCompare] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [showArchive, setShowArchive] = useState(false);

  useEffect(() => {
    dispatch(fetchRole(roleId));
  }, [dispatch, roleId]);

  if (loading && !current) return <div className="p-10 text-center text-gray-400 text-sm">Loading role…</div>;

  if (currentNotFound) {
    return (
      <div className="p-10 text-center">
        <p className="text-gray-300 mb-2">This role couldn't be found.</p>
        <p className="text-xs text-gray-500 mb-4">Frontend session state resets on a full page reload — a bookmarked role URL can 404 in a fresh session.</p>
        <Link to="/admin/roles" className="text-sm text-blue-400 hover:underline">Back to Roles</Link>
      </div>
    );
  }

  if (!current) return null;
  const { role, assignedUsers, conflicts, changeHistory, auditPreview, highRiskGrants } = current;

  const confirmArchive = () => {
    if (!archiveReason.trim()) return;
    dispatch(archiveRole({ id: role.id, reason: archiveReason })).then(() => {
      setShowArchive(false);
      setArchiveReason("");
      dispatch(fetchRole(roleId));
    });
  };

  return (
      <div className="p-4 md:p-6 space-y-5">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <Link to="/admin/roles" className="hover:text-gray-300">Users &amp; Access / Roles &amp; Permissions</Link> <ChevronRight size={12} /> <span className="text-gray-300">{role.name}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 bg-gray-900/40 border border-gray-800 rounded-xl p-5">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-2xl font-bold text-white">{role.name}</h1>
            <span className={`px-2 py-0.5 rounded-full text-[11px] border ${ROLE_TYPE_COLORS[role.type] || ""}`}>{role.type}</span>
            <span className={`px-2 py-0.5 rounded-full text-[11px] border ${ROLE_STATUS_COLORS[role.status] || ""}`}>{role.status}</span>
            {isHighPrivilegeRole(role) && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border bg-red-500/15 text-red-300 border-red-500/30">
                <ShieldAlert size={11} /> High privilege
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400 max-w-2xl">{role.description}</p>
          <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-500">
            <span>Default scope: <span className="text-gray-300">{role.defaultScope}</span></span>
            <span className="flex items-center gap-1"><Users size={12} /> {assignedUsers.length} assigned user{assignedUsers.length === 1 ? "" : "s"}</span>
            <span>Last updated: {role.updatedAt ? formatDateTime(role.updatedAt) : "—"}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <div className="flex gap-2 flex-wrap">
            {!role.isBuiltIn && (
              <button onClick={() => setBuilderState({ mode: "edit", role })} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm">
                <Pencil size={14} /> Edit Custom Role
              </button>
            )}
            <button onClick={() => setBuilderState({ mode: "duplicate", role })} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-gray-200 px-3 py-2 rounded-lg text-sm">
              <Copy size={14} /> Duplicate
            </button>
            <button onClick={() => setShowPreview(true)} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-gray-200 px-3 py-2 rounded-lg text-sm">
              <Eye size={14} /> Preview Access
            </button>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={() => setShowCompare(true)} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-2 py-1"><GitCompare size={13} /> Compare</button>
            {!role.isBuiltIn && role.status === "Active" && (
              <button onClick={() => dispatch(disableRole(role.id)).then(() => dispatch(fetchRole(roleId)))} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-2 py-1"><Ban size={13} /> Disable</button>
            )}
            {!role.isBuiltIn && role.status === "Inactive" && (
              <button onClick={() => dispatch(enableRole(role.id)).then(() => dispatch(fetchRole(roleId)))} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-2 py-1">Enable</button>
            )}
            {!role.isBuiltIn && role.status !== "Archived" && (
              <button onClick={() => setShowArchive(true)} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 px-2 py-1"><Archive size={13} /> Archive</button>
            )}
            {!role.isBuiltIn && role.status === "Archived" && (
              <button onClick={() => dispatch(restoreRole(role.id)).then(() => dispatch(fetchRole(roleId)))} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-2 py-1"><ArchiveRestore size={13} /> Restore</button>
            )}
          </div>
        </div>
      </div>

      {role.isBuiltIn && (
        <p className="text-xs text-gray-500 bg-gray-900/40 border border-gray-800 rounded-lg px-3 py-2">
          This is a built-in role template and can't be edited directly — duplicate it into a Custom Role to make changes.
        </p>
      )}

      <div className="border-b border-gray-800 flex gap-1 overflow-x-auto" role="tablist" aria-label="Role detail sections">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === t ? "border-blue-500 text-white" : "border-transparent text-gray-400 hover:text-gray-200"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid md:grid-cols-2 gap-4">
          <Panel title="Purpose">
            <p className="text-sm text-gray-300">{role.purpose}</p>
          </Panel>
          <Panel title="Scope">
            <p className="text-sm text-gray-300">Default: <span className={`px-2 py-0.5 rounded-full text-xs border ml-1 ${SCOPE_COLORS[role.defaultScope]}`}>{role.defaultScope}</span></p>
            <p className="text-xs text-gray-500 mt-2">Allowed: {role.allowedScopes.join(", ")}</p>
          </Panel>
          <Panel title="Module summary">
            <p className="text-sm text-gray-300">{role.permissionGrants.filter((g) => g.actions.length > 0).length} modules with at least one granted permission.</p>
          </Panel>
          <Panel title="Sensitive-data access">
            {Object.keys(role.sensitiveFields).length === 0 ? (
              <p className="text-sm text-gray-500">No sensitive fields configured — all hidden by default.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(role.sensitiveFields).map(([f, state]) => (
                  <span key={f} className={`px-2 py-0.5 rounded-md text-[11px] border ${FIELD_STATE_COLORS[state]}`}>{f.replace(/_/g, " ")}: {state}</span>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Approval capabilities">
            {Object.values(role.approvalRules || {}).filter(Boolean).length === 0 ? (
              <p className="text-sm text-gray-500">This role cannot approve any workflow.</p>
            ) : (
              <ul className="text-sm text-gray-300 list-disc list-inside">
                {Object.entries(role.approvalRules).filter(([, v]) => v).map(([k]) => <li key={k} className="capitalize">{k.replace(/_/g, " ")}</li>)}
              </ul>
            )}
          </Panel>
          <Panel title="Assigned departments">
            <p className="text-sm text-gray-300">{role.department || "Not department-specific"}</p>
          </Panel>
        </div>
      )}

      {tab === "Permissions" && <PermissionMatrixMini role={role} />}

      {tab === "Scopes" && (
        <div className="space-y-4 max-w-xl">
          <Panel title="Default scope"><p className="text-sm text-gray-300">{role.defaultScope}</p></Panel>
          <Panel title="Allowed scope overrides">
            <div className="flex flex-wrap gap-1.5">
              {role.allowedScopes.map((s) => <span key={s} className={`px-2 py-0.5 rounded-full text-xs border ${SCOPE_COLORS[s]}`}>{s}</span>)}
            </div>
          </Panel>
          <Panel title="Record-ownership rules">
            <p className="text-sm text-gray-300">{role.isOrdinaryRecordOwner ? "Users with this role are the ordinary owner of records they create." : "Users with this role are not treated as the ordinary record owner."}</p>
          </Panel>
          <Panel title="Customer-account restrictions">
            <p className="text-sm text-gray-300">{role.customerAccountRestricted ? "Restricted to a single external Customer Account." : "Not restricted to a customer account."}</p>
          </Panel>
        </div>
      )}

      {tab === "Assigned Users" && (
        <div className="border border-gray-800 rounded-xl overflow-hidden">
          <p className="text-xs text-gray-500 px-4 py-2 bg-gray-900/60 border-b border-gray-800">Fixture preview only — does not modify production user assignments.</p>
          {assignedUsers.length === 0 ? (
            <p className="text-sm text-gray-500 p-6 text-center">No users are assigned to this role.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
                <tr><th scope="col" className="text-left px-4 py-2">Name</th><th scope="col" className="text-left px-4 py-2">Email</th><th scope="col" className="text-left px-4 py-2">Department</th><th scope="col" className="text-left px-4 py-2">Status</th></tr>
              </thead>
              <tbody>
                {assignedUsers.map((u) => (
                  <tr key={u.id} className="border-t border-gray-800"><td className="px-4 py-2 text-gray-200">{u.name}</td><td className="px-4 py-2 text-gray-400">{u.email}</td><td className="px-4 py-2 text-gray-400">{u.department}</td><td className="px-4 py-2 text-emerald-400 text-xs">{u.status}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "Conflicts" && (
        <div className="space-y-3">
          {conflicts.length === 0 ? (
            <p className="text-sm text-gray-500 flex items-center gap-2 py-6 justify-center"><AlertTriangle size={14} /> No conflicts detected for this role.</p>
          ) : (
            conflicts.map((c, i) => (
              <div key={i} className={`border rounded-lg p-3 ${c.severity === "high" ? "bg-red-900/10 border-red-800/30" : "bg-amber-900/10 border-amber-800/30"}`}>
                <p className={`text-xs font-semibold mb-1 ${c.severity === "high" ? "text-red-300" : "text-amber-300"}`}>{c.type}</p>
                <p className="text-sm text-gray-300">{c.message}</p>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "Change History" && (
        <div className="space-y-2">
          {changeHistory.length === 0 ? (
            <p className="text-sm text-gray-500 flex items-center gap-2 py-6 justify-center"><History size={14} /> No recorded changes for this role.</p>
          ) : changeHistory.map((h, i) => (
            <div key={i} className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 text-sm">
              <div className="flex justify-between text-xs text-gray-500 mb-1"><span>{h.actor}</span><span>{formatDateTime(h.time)}</span></div>
              <p className="text-gray-200">{h.action}</p>
              <p className="text-xs text-gray-500 mt-1">{h.previousValue} → {h.newValue}</p>
              {h.reason && <p className="text-xs text-gray-500 italic mt-1">Reason: {h.reason}</p>}
            </div>
          ))}
        </div>
      )}

      {tab === "Audit Preview" && (
        <div className="border border-gray-800 rounded-xl overflow-hidden">
          {auditPreview.length === 0 ? (
            <p className="text-sm text-gray-500 flex items-center gap-2 py-10 justify-center"><ScrollText size={14} /> No audit entries recorded for this role.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
                <tr><th scope="col" className="text-left px-4 py-2">Actor</th><th scope="col" className="text-left px-4 py-2">Action</th><th scope="col" className="text-left px-4 py-2">Time</th><th scope="col" className="text-left px-4 py-2">Previous</th><th scope="col" className="text-left px-4 py-2">New</th><th scope="col" className="text-left px-4 py-2">Reason</th></tr>
              </thead>
              <tbody>
                {auditPreview.map((a, i) => (
                  <tr key={i} className="border-t border-gray-800 text-xs">
                    <td className="px-4 py-2 text-gray-200">{a.actor}</td><td className="px-4 py-2 text-gray-300">{a.action}</td><td className="px-4 py-2 text-gray-500">{formatDateTime(a.time)}</td>
                    <td className="px-4 py-2 text-gray-500">{a.previousValue}</td><td className="px-4 py-2 text-gray-500">{a.newValue}</td><td className="px-4 py-2 text-gray-500">{a.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {highRiskGrants.length > 0 && tab === "Overview" && (
        <p className="text-xs text-gray-500">{highRiskGrants.length} high-risk permission(s) — see the Conflicts tab for details.</p>
      )}

      {builderState && (
        <RoleBuilder mode={builderState.mode} role={builderState.role} onClose={() => setBuilderState(null)}
          onSaved={() => { setBuilderState(null); dispatch(fetchRole(roleId)); }} />
      )}
      {showCompare && <CompareRolesDialog initialRoleIds={[role.id]} onClose={() => setShowCompare(false)} />}

      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Preview Access">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowPreview(false)} />
          <div className="relative bg-[#0d0f16] border border-gray-800 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Preview Access — {role.name}</h2>
              <button onClick={() => setShowPreview(false)} aria-label="Close"><X size={20} className="text-gray-400 hover:text-white" /></button>
            </div>
            <AccessPreviewPanel initialRoleId={role.id} />
          </div>
        </div>
      )}

      {showArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Archive Role">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowArchive(false)} />
          <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Archive "{role.name}"</h3>
            <label className="block text-xs text-gray-400 mb-1">Reason</label>
            <textarea value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white mb-4" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowArchive(false)} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
              <button onClick={confirmArchive} disabled={!archiveReason.trim()} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg">Archive</button>
            </div>
          </div>
        </div>
      )}

      {tab === "Overview" && <InvitationsMembershipPanel role={role} />}
      </div>
  );
}

// Summarizes this role's Access Management capabilities — a preview of what
// it can do with Members/Invitations/Invite Links, not a duplicate of the
// Permissions tab's full grid.
function InvitationsMembershipPanel({ role }) {
  const has = (moduleId, action) => hasPermission(role.id, moduleId, action);
  const rows = [
    { label: "Can view members", value: has("members", "view") },
    { label: "Can invite members", value: has("members", "invite") },
    { label: "Can assign roles", value: has("members", "assign_role") },
    {
      label: "Assignable role level",
      value: role.id === "system_owner" ? "Any role except System Owner" : role.id === "organization_administrator" ? "Below Organization Administrator" : "None",
    },
    { label: "Can resend invitations", value: has("invitations", "resend") },
    { label: "Can revoke invitations", value: has("invitations", "revoke") },
    { label: "Can create invite links", value: has("invite_links", "create") },
    { label: "Can rotate invite links", value: has("invite_links", "rotate") },
    { label: "Can approve join requests", value: has("members", "invite") },
    { label: "Organization scope", value: role.id === "system_owner" ? "System-wide" : role.id === "organization_administrator" ? "Own organization only" : "None" },
  ];
  return (
    <Panel title="Invitations & Membership">
      <dl className="grid sm:grid-cols-2 gap-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2 border-b border-gray-800/60 pb-2">
            <dt className="text-xs text-gray-400">{row.label}</dt>
            <dd className="text-sm text-white text-right">
              {typeof row.value === "boolean" ? (
                <span className={row.value ? "text-emerald-400" : "text-gray-500"}>{row.value ? "Yes" : "No"}</span>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Panel({ title, children }) {
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
      {children}
    </div>
  );
}

function PermissionMatrixMini({ role }) {
  const [search, setSearch] = useState("");
  const grants = role.permissionGrants.filter((g) => g.actions.length > 0 && (!search || (findModule(g.moduleId)?.label || g.moduleId).toLowerCase().includes(search.toLowerCase())));
  return (
    <div className="space-y-3">
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search permissions..." aria-label="Search permissions"
        className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
      <div className="border border-gray-800 rounded-xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
            <tr><th scope="col" className="text-left px-4 py-2">Module</th><th scope="col" className="text-left px-4 py-2">Granted actions</th></tr>
          </thead>
          <tbody>
            {grants.length === 0 && <tr><td colSpan={2} className="text-center py-8 text-gray-500 text-sm">No permissions match your search.</td></tr>}
            {grants.map((g) => (
              <tr key={g.moduleId} className="border-t border-gray-800">
                <td className="px-4 py-2 text-gray-200">{findModule(g.moduleId)?.label || g.moduleId}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {g.actions.map((a) => <span key={a} className="px-1.5 py-0.5 rounded text-[11px] bg-gray-800 text-gray-300 border border-gray-700">{ACTION_LABELS[a]}</span>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
