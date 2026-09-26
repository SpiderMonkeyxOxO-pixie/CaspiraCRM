import { useCallback, useEffect, useMemo, useState } from "react";
import { listAuditEvents } from "../../../Helpers/backendAuthClient";
import { orgId } from "../../../Helpers/crmBackendCommon";
import { AccessPage, Badge, ErrorBox, Loading, Table } from "./accessUi";
import { btn, errorText, fmtDateTime, input, personName, useMembersAndRoles } from "./accessKit";

// Plain-language names for the access events people usually look for.
const ACTIONS = {
  "member.suspended": "Member suspended",
  "member.reactivated": "Member reactivated",
  "member.removed": "Member removed",
  "member.role_assigned": "Role given",
  "member.role_revoked": "Role taken away",
  "member.role_assign_denied": "Role change refused",
  "invitation.created": "Invitation created",
  "invitation.resent": "Invitation link renewed",
  "invitation.revoked": "Invitation revoked",
  "invitation.accepted": "Invitation accepted",
  "invite_link.created": "Invite link created",
  "invite_link.rotated": "Invite link renewed",
  "invite_link.revoked": "Invite link revoked",
  "invite_link.accepted": "Joined with invite link",
  "invite_link.rejected": "Invite link refused",
};
const PAGE_SIZE = 25;

export default function AccessAuditBackend() {
  const { members } = useMembersAndRoles();
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await listAuditEvents(orgId(), { page, pageSize: PAGE_SIZE, ...(action ? { action } : {}) }));
      setError(null);
    } catch (e) {
      setData({ auditEvents: [] });
      setError(errorText(e));
    }
  }, [page, action]);
  useEffect(() => { load(); }, [load]);

  const nameOf = useMemo(() => Object.fromEntries((members || []).map((m) => [m.user?._id, personName(m)])), [members]);
  const total = data?.pagination?.total || 0;

  const columns = [
    { label: "When", render: (e) => fmtDateTime(e.createdAt) },
    { label: "What", render: (e) => ACTIONS[e.action] || e.action },
    { label: "Who", render: (e) => nameOf[e.actorUserId] || (e.actorUserId ? "Former member or system" : "System") },
    { label: "Result", render: (e) => <Badge tone={e.result === "Success" ? "green" : "red"}>{e.result}</Badge> },
    { label: "Details", render: (e) => e.reason || e.targetType || "—" },
  ];

  return (
    <AccessPage title="Access audit" description="A permanent log of who changed what: roles, invitations, invite links and members, plus everything else the organization records. Entries can't be edited or deleted.">
      <ErrorBox error={error} onRetry={load} />
      <select className={`${input} w-auto`} aria-label="Filter by event" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
        <option value="">All events</option>
        {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {data === null ? <Loading what="Loading the audit log…" /> : <Table columns={columns} rows={data.auditEvents} empty="Nothing recorded yet." />}
      {total > PAGE_SIZE && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <button className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {Math.ceil(total / PAGE_SIZE)}</span>
          <button className={btn} disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </AccessPage>
  );
}
