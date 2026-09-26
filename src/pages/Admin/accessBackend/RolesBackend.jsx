// Read-only view of the organization's roles and what they allow. Roles
// themselves are managed by the system owner; people are given roles under
// Members.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { listOrgPermissions } from "../../../Helpers/backendAuthClient";
import { orgId } from "../../../Helpers/crmBackendCommon";
import { AccessPage, Badge, ErrorBox, Loading, Panel, Table } from "./accessUi";
import { personName, useMembersAndRoles } from "./accessKit";

const label = (id) => id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function usePermissionCatalog() {
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    listOrgPermissions(orgId()).then((d) => setGroups(d.moduleGroups || [])).catch(() => setGroups([]));
  }, []);
  return groups;
}

const grantsOf = (role) => Object.fromEntries((Array.isArray(role.permissionGrants) ? role.permissionGrants : []).map((g) => [g.moduleId, g.actions || []]));

export function RolesListBackend() {
  const { members, roles, error, reload } = useMembersAndRoles();
  const holders = useMemo(() => {
    const count = {};
    (members || []).forEach((m) => (m.roles || []).forEach((r) => { count[r._id] = (count[r._id] || 0) + 1; }));
    return count;
  }, [members]);
  const columns = [
    { label: "Role", render: (r) => <Link className="text-blue-300 hover:underline" to={`/admin/roles/${r._id}`}>{r.name}</Link> },
    { label: "Type", render: (r) => <Badge tone={r.isBuiltIn ? "blue" : "violet"}>{r.isBuiltIn ? "Built-in" : r.type || "Custom"}</Badge> },
    { label: "What it is for", render: (r) => r.purpose || r.description || "—" },
    { label: "People", render: (r) => holders[r._id] || 0 },
  ];
  return (
    <AccessPage title="Roles" description="The roles people can have and what each one allows. To give someone a role, open Members and choose Roles next to their name. Roles themselves are maintained by your system owner."
      actions={<Link to="/admin/permissions" className="px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 text-sm">Compare all roles</Link>}>
      <ErrorBox error={error} onRetry={reload} />
      {members === null ? <Loading what="Loading roles…" /> : <Table columns={columns} rows={roles} empty="No roles available to you." />}
    </AccessPage>
  );
}

export function RoleDetailBackend() {
  const { roleId } = useParams();
  const { members, roles, error, reload } = useMembersAndRoles();
  const groups = usePermissionCatalog();
  const role = roles.find((r) => r._id === roleId);
  if (members === null) return <AccessPage title="Role"><Loading /></AccessPage>;
  if (!role) return <AccessPage title="Role"><ErrorBox error={error || "This role doesn't exist or isn't one you can see."} onRetry={reload} /></AccessPage>;
  const grants = grantsOf(role);
  const people = members.filter((m) => (m.roles || []).some((r) => r._id === roleId));
  return (
    <AccessPage title={role.name} description={role.purpose || role.description}>
      <Panel title={`People with this role (${people.length})`}>
        {people.length ? <p className="text-sm text-gray-300">{people.map(personName).join(", ")}</p> : <p className="text-sm text-gray-500">Nobody has this role yet.</p>}
      </Panel>
      <Panel title="What this role allows">
        <div className="space-y-3">
          {groups.map((g) => {
            const rows = g.modules.filter((m) => grants[m]?.length);
            if (!rows.length) return null;
            return (
              <div key={g.id}>
                <h3 className="text-xs uppercase text-gray-400 mb-1">{g.label}</h3>
                <ul className="space-y-1 text-sm">
                  {rows.map((m) => <li key={m}><span className="text-gray-200">{label(m)}:</span> <span className="text-gray-400">{grants[m].map(label).join(", ")}</span></li>)}
                </ul>
              </div>
            );
          })}
          {!Object.keys(grants).length && <p className="text-sm text-gray-500">This role has no permissions of its own.</p>}
        </div>
      </Panel>
      <Link to="/admin/roles" className="text-sm text-blue-300 hover:underline">← All roles</Link>
    </AccessPage>
  );
}

export function PermissionsMatrixBackend() {
  const { members, roles, error, reload } = useMembersAndRoles();
  const groups = usePermissionCatalog();
  if (members === null) return <AccessPage title="Compare roles"><Loading /></AccessPage>;
  return (
    <AccessPage title="Compare roles" description="Every role against every area. A tick means the role can at least view that area; hover to see exactly what it allows.">
      <ErrorBox error={error} onRetry={reload} />
      <div className="overflow-x-auto border border-gray-800 rounded-xl">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-900/60 text-gray-400">
            <tr><th scope="col" className="text-left px-3 py-2">Area</th>{roles.map((r) => <th key={r._id} scope="col" className="px-2 py-2 whitespace-nowrap">{r.name}</th>)}</tr>
          </thead>
          <tbody>
            {groups.flatMap((g) => [
              <tr key={g.id} className="bg-gray-900/40"><th colSpan={roles.length + 1} scope="colgroup" className="text-left px-3 py-1.5 text-gray-300">{g.label}</th></tr>,
              ...g.modules.map((m) => (
                <tr key={`${g.id}-${m}`} className="border-t border-gray-800">
                  <th scope="row" className="text-left font-normal px-3 py-1.5 text-gray-300 whitespace-nowrap">{label(m)}</th>
                  {roles.map((r) => {
                    const actions = grantsOf(r)[m] || [];
                    return <td key={r._id} className="text-center px-2 py-1.5" title={actions.map(label).join(", ") || "No access"}>{actions.length ? <span className="text-emerald-300" aria-label={actions.map(label).join(", ")}>✓</span> : <span className="text-gray-700" aria-label="No access">·</span>}</td>;
                  })}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </AccessPage>
  );
}
