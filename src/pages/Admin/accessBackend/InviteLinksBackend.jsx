import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { createInviteLink, listInviteLinks, listOrgRoles, revokeInviteLink, rotateInviteLink } from "../../../Helpers/backendAuthClient";
import { orgId } from "../../../Helpers/crmBackendCommon";
import { AccessPage, Badge, ErrorBox, LinkBox, Loading, Modal, Table } from "./accessUi";
import { btn, btnDanger, btnPrimary, defaultRoleId, errorText, fmtDate, input } from "./accessKit";

const NOTE = "Copy this link now; it isn't shown again. Anyone who has it can use it, so share it only where the right people will see it.";

export default function InviteLinksBackend() {
  const [links, setLinks] = useState(null);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ inviteLinks = [] }, { roles: r = [] }] = await Promise.all([listInviteLinks(orgId()), listOrgRoles(orgId())]);
      setLinks(inviteLinks);
      setRoles(r);
      setError(null);
    } catch (e) {
      setLinks([]);
      setError(errorText(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const roleName = useMemo(() => Object.fromEntries(roles.map((r) => [r._id, r.name])), [roles]);
  const statusOf = (l) => {
    if (l.status !== "Active") return l.status;
    if (l.expiresAt && new Date(l.expiresAt) < new Date()) return "Expired";
    if (l.maxUses && l.useCount >= l.maxUses) return "Used up";
    return "Active";
  };

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
    { label: "Role given", render: (l) => roleName[l.defaultRoleId] || "—" },
    { label: "Status", render: (l) => <Badge tone={statusOf(l) === "Active" ? "green" : "gray"}>{statusOf(l)}</Badge> },
    { label: "Used", render: (l) => `${l.useCount || 0}${l.maxUses ? ` of ${l.maxUses}` : ""}` },
    { label: "Expires", render: (l) => (l.expiresAt ? fmtDate(l.expiresAt) : "Never") },
    { label: "Who can join", render: (l) => (l.allowedDomains?.length ? `Emails at ${l.allowedDomains.join(", ")}` : "Anyone with the link") },
    { label: "Approval", render: (l) => (l.requiresApproval ? "An admin approves each person" : "Joins straight away") },
    {
      label: "Actions",
      render: (l) => l.status === "Active" && (
        <div className="flex gap-1.5">
          <button className={btn} disabled={busy} onClick={() => act(async () => {
            const { joinUrl } = await rotateInviteLink(orgId(), l._id);
            setDialog({ kind: "link", url: joinUrl, title: "New link" });
          })}>New link</button>
          <button className={btnDanger} disabled={busy} onClick={() => setDialog({ kind: "revoke", link: l })}>Revoke</button>
        </div>
      ),
    },
  ];

  return (
    <AccessPage title="Invite links" description="One link for a whole team. Everyone who opens it creates an account with the role you choose. Limit it to your company's email domain, a number of uses or a date, and choose whether an admin must approve each person (approve them under Members)."
      actions={<button className={btnPrimary} onClick={() => setDialog({ kind: "new" })}>Create invite link</button>}>
      <ErrorBox error={error} onRetry={load} />
      {links === null ? <Loading what="Loading invite links…" /> : <Table columns={columns} rows={links} empty="No invite links yet." />}

      {dialog?.kind === "new" && <NewLink roles={roles} onClose={() => setDialog(null)} onCreated={async (url) => { setDialog({ kind: "link", url, title: "Your invite link" }); await load(); }} />}
      {dialog?.kind === "link" && (
        <Modal title={dialog.title} onClose={() => setDialog(null)} footer={<button className={btnPrimary} onClick={() => setDialog(null)}>Done</button>}>
          <LinkBox url={dialog.url} note={NOTE} />
          <p className="text-xs text-gray-400">A new link replaces the old one: the old link stops working.</p>
        </Modal>
      )}
      {dialog?.kind === "revoke" && (
        <Modal title="Revoke invite link" onClose={() => setDialog(null)}
          footer={<><button className={btn} onClick={() => setDialog(null)}>Cancel</button><button className={btnDanger} disabled={busy} onClick={() => act(async () => { await revokeInviteLink(orgId(), dialog.link._id); setDialog(null); toast.success("Invite link revoked"); })}>Revoke</button></>}>
          <p className="text-sm text-gray-300">Nobody else will be able to join with this link. People who already joined keep their access.</p>
        </Modal>
      )}
    </AccessPage>
  );
}

function NewLink({ roles, onClose, onCreated }) {
  const [form, setForm] = useState({ defaultRoleId: defaultRoleId(roles), expiresInDays: "14", maxUses: "", domains: "", requiresApproval: true });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const allowedDomains = form.domains.split(/[\s,]+/).map((d) => d.replace(/^@/, "").trim()).filter(Boolean);
      const { joinUrl } = await createInviteLink(orgId(), {
        defaultRoleId: form.defaultRoleId,
        expiresInDays: form.expiresInDays ? Number(form.expiresInDays) : undefined,
        maxUses: form.maxUses ? Number(form.maxUses) : undefined,
        allowedDomains,
        requiresApproval: form.requiresApproval,
      });
      toast.success("Invite link created");
      await onCreated(joinUrl);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Create invite link" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">Role for people who join *
          <select required className={`${input} mt-1`} value={form.defaultRoleId} onChange={(e) => setForm({ ...form, defaultRoleId: e.target.value })}>
            {roles.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Expires after (days)<input type="number" min="1" className={`${input} mt-1`} value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })} placeholder="Never" /></label>
          <label className="block text-sm">Maximum uses<input type="number" min="1" className={`${input} mt-1`} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="No limit" /></label>
        </div>
        <label className="block text-sm">Only these email domains<input className={`${input} mt-1`} value={form.domains} onChange={(e) => setForm({ ...form, domains: e.target.value })} placeholder="e.g. caspirasolutions.com" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requiresApproval} onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })} /> An admin approves each person before they get access</label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy || !form.defaultRoleId}>Create link</button>
        </div>
      </form>
    </Modal>
  );
}
