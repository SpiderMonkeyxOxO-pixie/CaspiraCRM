// Gives members the Finance Manager or Accountant role on the real backend
// (POST/DELETE /organizations/:id/members/:memberId/roles). Needs the
// members:assign permission; the backend refuses otherwise and records
// every change in the audit log.
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { listMembers, listOrgRoles, assignMemberRole, revokeMemberRole } from "../../../Helpers/backendAuthClient";
import { orgId } from "../../../Helpers/crmBackendCommon";
import { resetFinanceAccess } from "../../../Helpers/financeAccess";
import { errorText } from "../../../Helpers/financeActions";
import { Panel } from "../financeUi";
import { buttonClass } from "../financeFormat";

const FINANCE_ROLE_KEYS = ["finance_manager", "accountant"];

export default function FinanceRolesPanel() {
  const [members, setMembers] = useState(null);
  const [roles, setRoles] = useState([]);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([listMembers(orgId(), { pageSize: 100 }), listOrgRoles(orgId())]);
      setMembers((m.members || []).filter((x) => x.status === "Active"));
      setRoles((r.roles || []).filter((x) => FINANCE_ROLE_KEYS.includes(x.key)));
    } catch {
      setMembers([]); // no members:view — the panel explains below
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (members === null) return null;
  if (!members.length || !roles.length) {
    return <Panel title="Finance roles"><p className="text-sm text-gray-400">Assigning Finance roles needs permission to view and manage members.</p></Panel>;
  }

  const toggle = async (member, role, has) => {
    setBusy(`${member._id}:${role._id}`);
    try {
      if (has) await revokeMemberRole(orgId(), member._id, role._id);
      else await assignMemberRole(orgId(), member._id, role._id);
      toast.success(`${role.name} ${has ? "removed from" : "given to"} ${member.user?.name || member.user?.username}`);
      resetFinanceAccess();
      await load();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Finance roles" subtitle="Finance Manager approves, posts and closes periods. Accountant prepares and posts. A member keeps their other roles. Changes take effect on their next page load and are audited.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-gray-400 text-left"><tr><th className="py-1.5 pr-3 font-medium">Member</th><th className="py-1.5 pr-3 font-medium">Current roles</th>{roles.map((r) => <th key={r._id} className="py-1.5 pr-3 font-medium">{r.name}</th>)}</tr></thead>
          <tbody>
            {members.map((m) => {
              const ids = new Set((m.roles || []).map((r) => r._id));
              return (
                <tr key={m._id} className="border-t border-gray-800">
                  <td className="py-1.5 pr-3">{m.user?.name || m.user?.username}<span className="block text-xs text-gray-500">{m.user?.email}</span></td>
                  <td className="py-1.5 pr-3 text-gray-400">{(m.roles || []).map((r) => r.name).join(", ") || "—"}</td>
                  {roles.map((r) => {
                    const has = ids.has(r._id);
                    return (
                      <td key={r._id} className="py-1.5 pr-3">
                        <button disabled={!!busy} onClick={() => toggle(m, r, has)} className={has ? buttonClass.danger : buttonClass.ghost}>
                          {busy === `${m._id}:${r._id}` ? "…" : has ? "Remove" : "Give"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
