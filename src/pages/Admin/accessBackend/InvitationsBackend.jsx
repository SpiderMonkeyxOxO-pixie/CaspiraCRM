import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { createInvitation, listInvitations, listOrgRoles, resendInvitation, revokeInvitation } from "../../../Helpers/backendAuthClient";
import { orgId } from "../../../Helpers/crmBackendCommon";
import { AccessPage, Badge, ErrorBox, LinkBox, Loading, Modal, Table } from "./accessUi";
import { btn, btnDanger, btnPrimary, defaultRoleId, errorText, fmtDate, input } from "./accessKit";

const STATUS_TONE = { Pending: "blue", Accepted: "green", Revoked: "gray", Expired: "gray" };
const LINK_NOTE = "Copy this link now and send it to the person yourself (for example by email or chat); it isn't shown again. An email is also sent automatically once your administrator has set up an email service.";

export default function InvitationsBackend() {
  const [invitations, setInvitations] = useState(null);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: "new" } | { kind: "link", url, email } | { kind: "revoke", invitation }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ invitations: list = [] }, { roles: r = [] }] = await Promise.all([listInvitations(orgId()), listOrgRoles(orgId())]);
      setInvitations(list);
      setRoles(r);
      setError(null);
    } catch (e) {
      setInvitations([]);
      setError(errorText(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const roleName = useMemo(() => Object.fromEntries(roles.map((r) => [r._id, r.name])), [roles]);
  const statusOf = (i) => (i.status === "Pending" && new Date(i.expiresAt) < new Date() ? "Expired" : i.status);

  const act = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { label: "Email", key: "email" },
    { label: "Role", render: (i) => roleName[i.roleId] || "—" },
    { label: "Status", render: (i) => <Badge tone={STATUS_TONE[statusOf(i)]}>{statusOf(i)}</Badge> },
    { label: "Sent", render: (i) => fmtDate(i.createdAt) },
    { label: "Expires", render: (i) => fmtDate(i.expiresAt) },
    {
      label: "Actions",
      render: (i) => i.status === "Pending" && (
        <div className="flex gap-1.5">
          <button className={btn} disabled={busy} onClick={() => act(async () => {
            const { acceptUrl } = await resendInvitation(orgId(), i._id);
            setDialog({ kind: "link", url: acceptUrl, email: i.email });
          })}>New link</button>
          <button className={btnDanger} disabled={busy} onClick={() => setDialog({ kind: "revoke", invitation: i })}>Revoke</button>
        </div>
      ),
    },
  ];

  return (
    <AccessPage title="Invitations" description="Invite one person by email with a chosen role. They open their personal link, choose a password, and join straight away. Links expire after 7 days."
      actions={<button className={btnPrimary} onClick={() => setDialog({ kind: "new" })}>Invite someone</button>}>
      <ErrorBox error={error} onRetry={load} />
      {invitations === null ? <Loading what="Loading invitations…" /> : <Table columns={columns} rows={invitations} empty="No invitations yet." />}

      {dialog?.kind === "new" && <NewInvitation roles={roles} onClose={() => setDialog(null)} onCreated={async (url, email) => { setDialog({ kind: "link", url, email }); await load(); }} />}
      {dialog?.kind === "link" && (
        <Modal title={`Invitation link for ${dialog.email}`} onClose={() => setDialog(null)} footer={<button className={btnPrimary} onClick={() => setDialog(null)}>Done</button>}>
          <LinkBox url={dialog.url} note={LINK_NOTE} />
          <p className="text-xs text-gray-400">Only this person's email can use it, and only once. Any earlier link for them no longer works.</p>
        </Modal>
      )}
      {dialog?.kind === "revoke" && (
        <Modal title="Revoke invitation" onClose={() => setDialog(null)}
          footer={<><button className={btn} onClick={() => setDialog(null)}>Cancel</button><button className={btnDanger} disabled={busy} onClick={() => act(async () => { await revokeInvitation(orgId(), dialog.invitation._id); setDialog(null); toast.success("Invitation revoked"); })}>Revoke</button></>}>
          <p className="text-sm text-gray-300">The link sent to {dialog.invitation.email} will stop working.</p>
        </Modal>
      )}
    </AccessPage>
  );
}

function NewInvitation({ roles, onClose, onCreated }) {
  const [form, setForm] = useState({ email: "", roleId: defaultRoleId(roles), message: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { acceptUrl, invitation } = await createInvitation(orgId(), { email: form.email.trim(), roleId: form.roleId, message: form.message.trim() || undefined });
      toast.success("Invitation created");
      await onCreated(acceptUrl, invitation?.email || form.email.trim());
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Invite someone" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">Email *<input required type="email" className={`${input} mt-1`} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label className="block text-sm">Role *
          <select required className={`${input} mt-1`} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
            {roles.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">Personal message<textarea rows={2} className={`${input} mt-1`} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy || !form.roleId}>Create invitation</button>
        </div>
      </form>
    </Modal>
  );
}
