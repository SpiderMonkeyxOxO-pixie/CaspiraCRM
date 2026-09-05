import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Plus, RefreshCw, Download, MoreHorizontal, Clock, MailCheck, ShieldAlert,
  CheckCircle2, XCircle, X, Copy, Send,
} from "lucide-react";
import {
  fetchInvitations, fetchOrganizations, resendInvitation, revokeInvitation,
  approveJoinRequest, rejectJoinRequest, selectAccessManagement,
} from "../../redux/admin/accessManagementSlice";
import { isSystemOwner, canInviteMembers, canResendInvitations, canRevokeInvitations } from "./accessManagementConfig";
import { findRoleTemplate } from "../../Helpers/mockRbacData";
import InviteMemberWizard from "./InviteMemberWizard";

function roleName(id) {
  return findRoleTemplate(id)?.name || id || "—";
}
function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_COLORS = {
  Draft: "bg-gray-700/40 text-gray-400 border-gray-600/40",
  Pending: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Email Preview Generated": "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Opened Preview": "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  "Approval Required": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Accepted Preview": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Declined Preview": "bg-gray-700/40 text-gray-400 border-gray-600/40",
  Expired: "bg-gray-800 text-gray-500 border-gray-700",
  Revoked: "bg-red-500/15 text-red-300 border-red-500/30",
  "Failed Preview": "bg-red-500/15 text-red-300 border-red-500/30",
};

export default function InvitationsList() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, invitations, invitationCounts, loading, error } = useSelector(selectAccessManagement);

  const [searchParams, setSearchParams] = useSearchParams();
  const [showInviteWizard, setShowInviteWizard] = useState(false);
  const [openRowMenu, setOpenRowMenu] = useState(null);
  const [detailInvitation, setDetailInvitation] = useState(null);
  const [revokeModal, setRevokeModal] = useState(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [copiedId, setCopiedId] = useState(null);

  const owner = isSystemOwner(role);
  const canInvite = canInviteMembers(role);

  const filters = useMemo(() => {
    const p = {};
    for (const [k, v] of searchParams.entries()) p[k] = v;
    return p;
  }, [searchParams]);

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);
  const filtersKey = JSON.stringify(filters);
  useEffect(() => { dispatch(fetchInvitations(filters)); }, [dispatch, filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
  };

  const approvalQueue = invitations.filter((i) => i.status === "Approval Required");
  const viewingApprovalQueue = filters.status === "Approval Required";

  const exportPreview = () => {
    const rows = invitations.map((i) => ({
      Recipient: i.email, Organization: organizations.find((o) => o.id === i.organizationId)?.name || i.organizationId,
      Role: roleName(i.intendedRoleId), Status: i.status, Created: formatDateTime(i.createdDate), Expiration: formatDateTime(i.expirationDate),
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Invitations Preview");
    XLSX.writeFile(workbook, "invitations-export-preview.xlsx");
  };

  const handleCopyLink = async (invitation) => {
    const url = `${window.location.origin}/invite/${invitation.frontendToken}`;
    try { await navigator.clipboard.writeText(url); } catch { /* clipboard may be unavailable in some environments */ }
    setCopiedId(invitation.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const confirmRevoke = async () => {
    if (!revokeReason.trim() || !revokeModal) return;
    await dispatch(revokeInvitation({ id: revokeModal.id, reason: revokeReason }));
    setRevokeModal(null); setRevokeReason("");
    dispatch(fetchInvitations(filters));
  };

  const confirmReject = async () => {
    if (!rejectReason.trim() || !rejectModal) return;
    await dispatch(rejectJoinRequest({ id: rejectModal.id, reason: rejectReason }));
    setRejectModal(null); setRejectReason("");
    dispatch(fetchInvitations(filters));
  };

  return (
      <div className="p-4 md:p-6 space-y-5 text-white">
        <div className="text-xs text-gray-500 flex items-center gap-1">
          <span>Users &amp; Access</span> <span>/</span> <span className="text-gray-300">Invitations</span>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Invitations</h1>
            <p className="text-sm text-gray-400 mt-1 max-w-2xl">
              Every invitation shown here is a frontend preview. No real email has been sent — Gmail delivery will be
              connected through a future backend phase.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => dispatch(fetchInvitations(filters))} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
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
          <MetricCard label="Pending" value={invitationCounts?.pending ?? "—"} icon={<Clock size={14} className="text-blue-400" />} onClick={() => updateFilter("status", "Pending")} />
          <MetricCard label="Email Previews" value={invitationCounts?.emailPreviews ?? "—"} icon={<MailCheck size={14} />} />
          <MetricCard label="Approval Required" value={invitationCounts?.approvalRequired ?? "—"} icon={<ShieldAlert size={14} className="text-amber-400" />} onClick={() => updateFilter("status", "Approval Required")} />
          <MetricCard label="Expiring Soon" value={invitationCounts?.expiringSoon ?? "—"} icon={<Clock size={14} className="text-amber-400" />} />
          <MetricCard label="Expired" value={invitationCounts?.expired ?? "—"} onClick={() => updateFilter("status", "Expired")} />
          <MetricCard label="Failed / Revoked" value={invitationCounts?.revoked ?? "—"} icon={<XCircle size={14} className="text-red-400" />} onClick={() => updateFilter("status", "Revoked")} />
        </div>

        {filters.status && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            Filtered by status: <span className="text-gray-200">{filters.status}</span>
            <button onClick={() => updateFilter("status", null)} className="text-blue-400 hover:underline">Clear</button>
          </div>
        )}

        {viewingApprovalQueue && approvalQueue.length > 0 && (
          <p className="text-xs text-amber-300 flex items-center gap-1"><ShieldAlert size={13} /> {approvalQueue.length} membership request{approvalQueue.length === 1 ? "" : "s"} awaiting your review.</p>
        )}

        {loading && <div className="text-center text-gray-400 py-12 text-sm">Loading invitations…</div>}
        {error && (
          <div className="text-center py-12">
            <p className="text-red-400 text-sm mb-3">{error}</p>
            <button onClick={() => dispatch(fetchInvitations(filters))} className="text-sm text-blue-400 hover:underline">Retry</button>
          </div>
        )}

        {!loading && !error && invitations.length === 0 && (
          <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
            <MailCheck size={28} className="mx-auto text-gray-600 mb-2" />
            <p className="text-gray-300 text-sm">No invitations match this view</p>
          </div>
        )}

        {!loading && !error && invitations.length > 0 && (
          <div className="overflow-x-auto border border-gray-800 rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
                <tr>
                  <th scope="col" className="text-left px-4 py-3">Recipient</th>
                  {owner && <th scope="col" className="text-left px-4 py-3">Organization</th>}
                  <th scope="col" className="text-left px-4 py-3">Intended Role</th>
                  <th scope="col" className="text-left px-4 py-3">Department / Team</th>
                  <th scope="col" className="text-left px-4 py-3">Created</th>
                  <th scope="col" className="text-left px-4 py-3">Expiration</th>
                  <th scope="col" className="text-left px-4 py-3">Status</th>
                  <th scope="col" className="text-left px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => {
                  const org = organizations.find((o) => o.id === invitation.organizationId);
                  const isApproval = invitation.status === "Approval Required";
                  const canAct = ["Pending", "Email Preview Generated", "Opened Preview", "Approval Required", "Failed Preview"].includes(invitation.status);
                  return (
                    <tr key={invitation.id} className="border-t border-gray-800 hover:bg-gray-900/30">
                      <td className="px-4 py-3">
                        <button onClick={() => setDetailInvitation(invitation)} className="text-blue-400 hover:underline">{invitation.email}</button>
                      </td>
                      {owner && <td className="px-4 py-3 text-gray-300">{org?.name || invitation.organizationId}</td>}
                      <td className="px-4 py-3 text-gray-300">{roleName(invitation.intendedRoleId)}</td>
                      <td className="px-4 py-3 text-gray-300">{[invitation.department, invitation.team].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="px-4 py-3 text-gray-400">{formatDateTime(invitation.createdDate)}</td>
                      <td className="px-4 py-3 text-gray-400">{formatDateTime(invitation.expirationDate)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] border ${STATUS_COLORS[invitation.status] || ""}`}>{invitation.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="relative">
                          <button onClick={() => setOpenRowMenu(openRowMenu === invitation.id ? null : invitation.id)} aria-label={`Row actions for ${invitation.email}`} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400">
                            <MoreHorizontal size={16} />
                          </button>
                          {openRowMenu === invitation.id && (
                            <div role="menu" className="absolute right-0 mt-1 w-52 bg-[#12141c] border border-gray-800 rounded-xl shadow-xl z-20 py-1">
                              <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800" onClick={() => { setOpenRowMenu(null); setDetailInvitation(invitation); }}>
                                View Details
                              </button>
                              <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800" onClick={() => { setOpenRowMenu(null); handleCopyLink(invitation); }}>
                                <Copy size={13} className="inline mr-1.5" /> {copiedId === invitation.id ? "Copied!" : "Copy Invitation Link"}
                              </button>
                              {canAct && !isApproval && canResendInvitations(role) && (
                                <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800"
                                  onClick={() => { setOpenRowMenu(null); dispatch(resendInvitation(invitation.id)).then(() => dispatch(fetchInvitations(filters))); }}>
                                  <Send size={13} className="inline mr-1.5" /> Resend Preview
                                </button>
                              )}
                              {isApproval && (
                                <>
                                  <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-emerald-300 hover:bg-gray-800"
                                    onClick={() => { setOpenRowMenu(null); dispatch(approveJoinRequest(invitation.id)).then(() => dispatch(fetchInvitations(filters))); }}>
                                    <CheckCircle2 size={13} className="inline mr-1.5" /> Approve Frontend Membership
                                  </button>
                                  <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-800"
                                    onClick={() => { setOpenRowMenu(null); setRejectModal(invitation); }}>
                                    <XCircle size={13} className="inline mr-1.5" /> Reject
                                  </button>
                                </>
                              )}
                              {canAct && canRevokeInvitations(role) && (
                                <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-800"
                                  onClick={() => { setOpenRowMenu(null); setRevokeModal(invitation); }}>
                                  Revoke
                                </button>
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

        {detailInvitation && (
          <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Invitation details for ${detailInvitation.email}`}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setDetailInvitation(null)} />
            <div className="relative bg-[#0f1119] border-l border-gray-800 w-full max-w-md h-full p-6 overflow-y-auto">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Invitation Details</h3>
                <button onClick={() => setDetailInvitation(null)} aria-label="Close" className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
              </div>
              <dl className="space-y-3 text-sm">
                <DetailRow label="Recipient" value={detailInvitation.email} />
                <DetailRow label="Organization" value={organizations.find((o) => o.id === detailInvitation.organizationId)?.name || detailInvitation.organizationId} />
                <DetailRow label="Intended role" value={roleName(detailInvitation.intendedRoleId)} />
                <DetailRow label="Department" value={detailInvitation.department || "—"} />
                <DetailRow label="Team" value={detailInvitation.team || "—"} />
                <DetailRow label="Manager" value={detailInvitation.manager || "—"} />
                <DetailRow label="Status" value={detailInvitation.status} />
                <DetailRow label="Expiration" value={formatDateTime(detailInvitation.expirationDate)} />
                <DetailRow label="Resend count" value={String(detailInvitation.resendCount)} />
                {detailInvitation.failureReason && <DetailRow label="Failure reason" value={detailInvitation.failureReason} />}
              </dl>
              <h4 className="text-sm font-semibold text-white mt-6 mb-2">Timeline</h4>
              <ul className="text-xs text-gray-400 space-y-1.5">
                <li>Invitation created — {formatDateTime(detailInvitation.createdDate)}</li>
                {detailInvitation.sentDate && <li>Email preview generated — {formatDateTime(detailInvitation.sentDate)}</li>}
                {detailInvitation.openedDate && <li>Link opened in preview — {formatDateTime(detailInvitation.openedDate)}</li>}
                {detailInvitation.status === "Approval Required" && <li>Approval requested</li>}
                {detailInvitation.acceptedDate && <li>Accepted in preview — {formatDateTime(detailInvitation.acceptedDate)}</li>}
                {detailInvitation.revokedDate && <li>Revoked — {formatDateTime(detailInvitation.revokedDate)}</li>}
              </ul>
              <p className="text-xs text-gray-500 mt-6 border-t border-gray-800 pt-4">
                This is a frontend-only preview. No real email was sent and no production invitation token exists.
              </p>
            </div>
          </div>
        )}

        {revokeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Revoke invitation to ${revokeModal.email}`}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setRevokeModal(null)} />
            <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold text-white mb-2">Revoke invitation to {revokeModal.email}</h3>
              <p className="text-sm text-gray-400 mb-3">This invitation's token will become unusable immediately. Provide a reason.</p>
              <label htmlFor="revoke-reason" className="block text-xs text-gray-400 mb-1">Reason</label>
              <textarea id="revoke-reason" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white mb-4" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setRevokeModal(null)} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
                <button onClick={confirmRevoke} disabled={!revokeReason.trim()} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg">Revoke</button>
              </div>
            </div>
          </div>
        )}

        {rejectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Reject membership request from ${rejectModal.email}`}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setRejectModal(null)} />
            <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold text-white mb-2">Reject membership request from {rejectModal.email}</h3>
              <label htmlFor="reject-reason" className="block text-xs text-gray-400 mb-1">Reason</label>
              <textarea id="reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white mb-4" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setRejectModal(null)} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
                <button onClick={confirmReject} disabled={!rejectReason.trim()} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg">Reject</button>
              </div>
            </div>
          </div>
        )}

        {showInviteWizard && (
          <InviteMemberWizard
            actingRole={role}
            organizations={organizations}
            onClose={() => setShowInviteWizard(false)}
            onCompleted={() => { setShowInviteWizard(false); dispatch(fetchInvitations(filters)); }}
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

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-gray-800/60 pb-2">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm text-white text-right">{value}</dd>
    </div>
  );
}
