import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import toast from "react-hot-toast";
import { assignMemberRole, removeMember, revokeMemberRole, updateMember } from "../../../Helpers/backendAuthClient";
import { orgId } from "../../../Helpers/crmBackendCommon";
import { AccessPage, Badge, ErrorBox, Loading, Modal, Table } from "./accessUi";
import { btn, btnDanger, btnPrimary, errorText, fmtDate, input, personName, useMembersAndRoles } from "./accessKit";

const STATUS_TONE = { Active: "green", Suspended: "amber", Invited: "blue" };

export default function MembersBackend() {
  const { members, roles, error, reload } = useMembersAndRoles();
  const me = useSelector((s) => s.auth?.data?._id);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dialog, setDialog] = useState(null); // { kind: "roles" | "remove", member }
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => (members || []).filter((m) => {
    if (status && m.status !== status) return false;
    const q = search.trim().toLowerCase();
    return !q || [m.user?.name, m.user?.email, m.user?.username].some((v) => v?.toLowerCase().includes(q));
  }), [members, search, status]);

  const run = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      setDialog(null);
      await reload();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const setMemberStatus = (m, next, done) => run(() => updateMember(orgId(), m._id, next), done);

  const columns = [
    { label: "Member", render: (m) => <div>{personName(m)}{m.user?._id === me && <span className="text-xs text-gray-500"> (you)</span>}<span className="block text-xs text-gray-500">{m.user?.email}</span></div> },
    { label: "Roles", render: (m) => <div className="flex flex-wrap gap-1">{(m.roles || []).length ? m.roles.map((r) => <Badge key={r._id} tone="violet">{r.name}</Badge>) : <span className="text-gray-500">No role</span>}</div> },
    { label: "Status", render: (m) => <Badge tone={STATUS_TONE[m.status]}>{m.status === "Invited" ? "Waiting for approval" : m.status}</Badge> },
    { label: "Joined", render: (m) => fmtDate(m.joinedAt) },
    {
      label: "Actions",
      render: (m) => {
        const self = m.user?._id === me;
        return (
          <div className="flex flex-wrap gap-1.5">
            <button className={btn} disabled={busy} onClick={() => setDialog({ kind: "roles", member: m })}>Roles</button>
            {m.status === "Invited" && <button className={btnPrimary} disabled={busy} onClick={() => setMemberStatus(m, "Active", `${personName(m)} can now sign in`)}>Approve</button>}
            {m.status === "Active" && !self && <button className={btn} disabled={busy} onClick={() => setMemberStatus(m, "Suspended", `${personName(m)} is suspended`)}>Suspend</button>}
            {m.status === "Suspended" && <button className={btn} disabled={busy} onClick={() => setMemberStatus(m, "Active", `${personName(m)} is active again`)}>Reactivate</button>}
            {!self && <button className={btnDanger} disabled={busy} onClick={() => setDialog({ kind: "remove", member: m })}>Remove</button>}
          </div>
        );
      },
    },
  ];

  return (
    <AccessPage title="Members" description="Everyone in your organization. Give people roles, approve people waiting to join, suspend access for a while, or remove someone who has left. Every change is recorded in the access audit."
      actions={<Link to="/admin/invitations" className={btnPrimary}>Invite people</Link>}>
      <ErrorBox error={error} onRetry={reload} />
      <div className="flex flex-wrap gap-2">
        <input className={`${input} max-w-xs`} placeholder="Search name or email" aria-label="Search members" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={`${input} w-auto`} aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          <option value="Invited">Waiting for approval</option>
          <option value="Suspended">Suspended</option>
        </select>
      </div>
      {members === null ? <Loading what="Loading members…" /> : <Table columns={columns} rows={shown} empty="No members match." />}

      {dialog?.kind === "roles" && <RolesDialog member={dialog.member} roles={roles} busy={busy} onClose={() => setDialog(null)}
        onSave={(add, remove) => run(async () => {
          for (const id of add) await assignMemberRole(orgId(), dialog.member._id, id);
          for (const id of remove) await revokeMemberRole(orgId(), dialog.member._id, id);
        }, "Roles updated")} />}
      {dialog?.kind === "remove" && (
        <Modal title="Remove member" onClose={() => setDialog(null)}
          footer={<><button className={btn} onClick={() => setDialog(null)}>Cancel</button><button className={btnDanger} disabled={busy} onClick={() => run(() => removeMember(orgId(), dialog.member._id), `${personName(dialog.member)} was removed`)}>Remove</button></>}>
          <p className="text-sm text-gray-300">{personName(dialog.member)} will lose access to this organization straight away. Their past work stays in the records. To let them back in later, invite them again.</p>
        </Modal>
      )}
    </AccessPage>
  );
}

function RolesDialog({ member, roles, busy, onClose, onSave }) {
  const current = new Set((member.roles || []).map((r) => r._id));
  const [picked, setPicked] = useState(new Set(current));
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const add = [...picked].filter((id) => !current.has(id));
  const remove = [...current].filter((id) => !picked.has(id) && roles.some((r) => r._id === id));
  const hidden = (member.roles || []).filter((r) => !roles.some((x) => x._id === r._id));
  return (
    <Modal title={`Roles for ${personName(member)}`} onClose={onClose}
      footer={<><button className={btn} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={busy || (!add.length && !remove.length)} onClick={() => onSave(add, remove)}>Save</button></>}>
      <p className="text-xs text-gray-400">A person can have several roles; they get everything any of their roles allows. Changes apply on their next page load.</p>
      <ul className="space-y-1.5 max-h-80 overflow-y-auto">
        {roles.map((r) => (
          <li key={r._id}>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={picked.has(r._id)} onChange={() => toggle(r._id)} />
              <span>{r.name}{r.description && <span className="block text-xs text-gray-500">{r.description}</span>}</span>
            </label>
          </li>
        ))}
      </ul>
      {hidden.length > 0 && <p className="text-xs text-gray-500">Also has {hidden.map((r) => r.name).join(", ")}, which only a System Owner can change.</p>}
    </Modal>
  );
}
