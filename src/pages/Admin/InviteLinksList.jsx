import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import * as XLSX from "xlsx";
import {
  Plus, RefreshCw, Download, MoreHorizontal, Link2, ShieldAlert, Clock, X, Copy, RotateCw, AlertTriangle,
} from "lucide-react";
import {
  fetchInviteLinks, fetchOrganizations, createInviteLink, rotateInviteLink, revokeInviteLink, selectAccessManagement,
} from "../../redux/admin/accessManagementSlice";
import {
  isSystemOwner, canManageInviteLinks, canRotateInviteLinks, canRevokeInviteLinks,
  LINK_SAFE_ROLE_IDS, INVITATION_EXPIRATION_PRESETS,
} from "./accessManagementConfig";
import { findRoleTemplate, ROLE_TEMPLATES } from "../../Helpers/mockRbacData";
import { DEPARTMENTS, teamsForOrganization, DEFAULT_ORGANIZATION_ID } from "../../Helpers/mockAccessData";

function roleName(id) {
  return findRoleTemplate(id)?.name || id || "—";
}
function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const STATUS_COLORS = {
  Draft: "bg-gray-700/40 text-gray-400 border-gray-600/40",
  "Active Preview": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Expiring Soon": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Usage Limit Reached": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Expired: "bg-gray-800 text-gray-500 border-gray-700",
  Revoked: "bg-red-500/15 text-red-300 border-red-500/30",
};

const SAFE_ROLE_TEMPLATES = ROLE_TEMPLATES.filter((r) => LINK_SAFE_ROLE_IDS.includes(r.id) && r.status === "Active");

const CREATE_DEFAULTS = {
  name: "", organizationId: "", defaultRoleId: SAFE_ROLE_TEMPLATES[0]?.id || "", department: "", team: "",
  allowedEmailDomains: "", approvalRequired: true, expirationPreset: "7d", maxUses: 25,
};

export default function InviteLinksList() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, inviteLinks, inviteLinkCounts, loading, error } = useSelector(selectAccessManagement);

  const owner = isSystemOwner(role);
  const canManage = canManageInviteLinks(role);

  const [openRowMenu, setOpenRowMenu] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(CREATE_DEFAULTS);
  const [createError, setCreateError] = useState(null);
  const [revokeModal, setRevokeModal] = useState(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [usageLink, setUsageLink] = useState(null);

  useEffect(() => { dispatch(fetchOrganizations()); dispatch(fetchInviteLinks()); }, [dispatch]);

  const fixedOrganizationId = !owner ? DEFAULT_ORGANIZATION_ID : "";
  useEffect(() => {
    if (!owner && fixedOrganizationId) setForm((f) => (f.organizationId === fixedOrganizationId ? f : { ...f, organizationId: fixedOrganizationId }));
  }, [owner, fixedOrganizationId]);

  const teamOptions = useMemo(() => teamsForOrganization(form.organizationId || fixedOrganizationId), [form.organizationId, fixedOrganizationId]);

  const exportPreview = () => {
    const rows = inviteLinks.map((l) => ({
      Name: l.name, Organization: organizations.find((o) => o.id === l.organizationId)?.name || l.organizationId,
      Role: roleName(l.defaultRoleId), Uses: `${l.currentUses}/${l.maxUses}`, Status: l.status, Expiration: formatDate(l.expirationDate),
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Invite Links Preview");
    XLSX.writeFile(workbook, "invite-links-export-preview.xlsx");
  };

  const handleCopyLink = async (link) => {
    const url = `${window.location.origin}/join/${link.secureTokenPreview}`;
    try { await navigator.clipboard.writeText(url); } catch { /* clipboard may be unavailable in some environments */ }
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const openCreate = () => {
    setForm({ ...CREATE_DEFAULTS, organizationId: fixedOrganizationId });
    setCreateError(null);
    setShowCreate(true);
  };

  const submitCreate = async () => {
    setCreateError(null);
    const preset = INVITATION_EXPIRATION_PRESETS.find((p) => p.value === form.expirationPreset);
    const expirationDate = preset?.hours ? new Date(Date.now() + preset.hours * 60 * 60 * 1000).toISOString() : null;
    const payload = {
      name: form.name.trim(),
      organizationId: form.organizationId || fixedOrganizationId,
      defaultRoleId: form.defaultRoleId,
      department: form.department || null,
      team: form.team || null,
      allowedEmailDomains: form.allowedEmailDomains.split(",").map((d) => d.trim()).filter(Boolean),
      approvalRequired: form.approvalRequired,
      expirationDate,
      maxUses: Number(form.maxUses) || 25,
      createdBy: null,
    };
    const result = await dispatch(createInviteLink(payload));
    if (createInviteLink.rejected.match(result)) {
      setCreateError(typeof result.payload === "string" ? result.payload : result.payload?.error || "Failed to create the invite link.");
      return;
    }
    setShowCreate(false);
    dispatch(fetchInviteLinks());
  };

  const confirmRevoke = async () => {
    if (!revokeReason.trim() || !revokeModal) return;
    await dispatch(revokeInviteLink({ id: revokeModal.id, reason: revokeReason }));
    setRevokeModal(null); setRevokeReason("");
    dispatch(fetchInviteLinks());
  };

  const highRiskWarning = !form.approvalRequired || form.allowedEmailDomains.trim() === "";

  return (
      <div className="p-4 md:p-6 space-y-5 text-white">
        <div className="text-xs text-gray-500 flex items-center gap-1">
          <span>Users &amp; Access</span> <span>/</span> <span className="text-gray-300">Invite Links</span>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Invite Links</h1>
            <p className="text-sm text-gray-400 mt-1 max-w-2xl">
              Reusable organization invite links, frontend preview only. High-privilege roles can never be assigned
              through a link — see Roles &amp; Permissions for the full role catalog.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => dispatch(fetchInviteLinks())} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
              <RefreshCw size={15} /> Refresh
            </button>
            <button onClick={exportPreview} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
              <Download size={15} /> Export Preview
            </button>
            {canManage && (
              <button onClick={openCreate} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium">
                <Plus size={15} /> Create Invite Link
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <MetricCard label="Active Links" value={inviteLinkCounts?.activePreview ?? "—"} icon={<Link2 size={14} className="text-emerald-400" />} />
          <MetricCard label="Expiring Soon" value={inviteLinkCounts?.expiringSoon ?? "—"} icon={<Clock size={14} className="text-amber-400" />} />
          <MetricCard label="Total Uses" value={inviteLinkCounts?.totalUses ?? "—"} />
          <MetricCard label="Approval Required" value={inviteLinkCounts?.approvalRequired ?? "—"} icon={<ShieldAlert size={14} />} />
          <MetricCard label="Domain Restricted" value={inviteLinkCounts?.domainRestricted ?? "—"} />
          <MetricCard label="Revoked" value={inviteLinkCounts?.revoked ?? "—"} />
        </div>

        {loading && <div className="text-center text-gray-400 py-12 text-sm">Loading invite links…</div>}
        {error && (
          <div className="text-center py-12">
            <p className="text-red-400 text-sm mb-3">{error}</p>
            <button onClick={() => dispatch(fetchInviteLinks())} className="text-sm text-blue-400 hover:underline">Retry</button>
          </div>
        )}

        {!loading && !error && inviteLinks.length === 0 && (
          <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
            <Link2 size={28} className="mx-auto text-gray-600 mb-2" />
            <p className="text-gray-300 text-sm">No invite links yet</p>
          </div>
        )}

        {!loading && !error && inviteLinks.length > 0 && (
          <div className="overflow-x-auto border border-gray-800 rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
                <tr>
                  <th scope="col" className="text-left px-4 py-3">Name</th>
                  {owner && <th scope="col" className="text-left px-4 py-3">Organization</th>}
                  <th scope="col" className="text-left px-4 py-3">Default Role</th>
                  <th scope="col" className="text-left px-4 py-3">Department / Team</th>
                  <th scope="col" className="text-left px-4 py-3">Uses</th>
                  <th scope="col" className="text-left px-4 py-3">Expiration</th>
                  <th scope="col" className="text-left px-4 py-3">Status</th>
                  <th scope="col" className="text-left px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {inviteLinks.map((link) => {
                  const org = organizations.find((o) => o.id === link.organizationId);
                  const isRevoked = link.status === "Revoked";
                  const isExpired = link.status === "Expired";
                  return (
                    <tr key={link.id} className="border-t border-gray-800 hover:bg-gray-900/30">
                      <td className="px-4 py-3 text-white font-medium">{link.name}</td>
                      {owner && <td className="px-4 py-3 text-gray-300">{org?.name || link.organizationId}</td>}
                      <td className="px-4 py-3 text-gray-300">{roleName(link.defaultRoleId)}</td>
                      <td className="px-4 py-3 text-gray-300">{[link.department, link.team].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => setUsageLink(link)} className="text-blue-400 hover:underline">{link.currentUses}/{link.maxUses}</button>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{formatDate(link.expirationDate)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] border ${STATUS_COLORS[link.status] || ""}`}>{link.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="relative">
                          <button onClick={() => setOpenRowMenu(openRowMenu === link.id ? null : link.id)} aria-label={`Row actions for ${link.name}`} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400">
                            <MoreHorizontal size={16} />
                          </button>
                          {openRowMenu === link.id && (
                            <div role="menu" className="absolute right-0 mt-1 w-52 bg-[#12141c] border border-gray-800 rounded-xl shadow-xl z-20 py-1">
                              <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800" onClick={() => { setOpenRowMenu(null); handleCopyLink(link); }}>
                                <Copy size={13} className="inline mr-1.5" /> {copiedId === link.id ? "Copied!" : "Copy Invite Link"}
                              </button>
                              <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800" onClick={() => { setOpenRowMenu(null); setUsageLink(link); }}>
                                View Usage
                              </button>
                              {!isRevoked && canRotateInviteLinks(role) && (
                                <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800"
                                  onClick={() => { setOpenRowMenu(null); dispatch(rotateInviteLink(link.id)).then(() => dispatch(fetchInviteLinks())); }}>
                                  <RotateCw size={13} className="inline mr-1.5" /> Rotate
                                </button>
                              )}
                              {!isRevoked && !isExpired && canRevokeInviteLinks(role) && (
                                <button role="menuitem" className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-800"
                                  onClick={() => { setOpenRowMenu(null); setRevokeModal(link); }}>
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

        {usageLink && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Usage for ${usageLink.name}`}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setUsageLink(null)} />
            <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-sm p-6">
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-lg font-semibold text-white">{usageLink.name}</h3>
                <button onClick={() => setUsageLink(null)} aria-label="Close" className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-gray-400">Uses</dt><dd className="text-white">{usageLink.currentUses} of {usageLink.maxUses}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-400">Last used</dt><dd className="text-white">{formatDate(usageLink.lastUsed)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-400">Created</dt><dd className="text-white">{formatDate(usageLink.createdDate)}</dd></div>
                {usageLink.rotatedDate && <div className="flex justify-between"><dt className="text-gray-400">Last rotated</dt><dd className="text-white">{formatDate(usageLink.rotatedDate)}</dd></div>}
                {usageLink.revocationReason && <div className="flex justify-between"><dt className="text-gray-400">Revocation reason</dt><dd className="text-white text-right">{usageLink.revocationReason}</dd></div>}
              </dl>
              <p className="text-xs text-gray-500 mt-4 border-t border-gray-800 pt-3">Preview-only usage counters — no real accounts have joined through this link.</p>
            </div>
          </div>
        )}

        {revokeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Revoke ${revokeModal.name}`}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setRevokeModal(null)} />
            <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold text-white mb-2">Revoke {revokeModal.name}</h3>
              <p className="text-sm text-gray-400 mb-3">This link will stop working immediately. Provide a reason.</p>
              <label htmlFor="link-revoke-reason" className="block text-xs text-gray-400 mb-1">Reason</label>
              <textarea id="link-revoke-reason" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white mb-4" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setRevokeModal(null)} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
                <button onClick={confirmRevoke} disabled={!revokeReason.trim()} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg">Revoke</button>
              </div>
            </div>
          </div>
        )}

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Create Invite Link">
            <div className="absolute inset-0 bg-black/60" onClick={() => setShowCreate(false)} />
            <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Create Invite Link</h3>
                <button onClick={() => setShowCreate(false)} aria-label="Close" className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
              </div>

              <div className="space-y-3">
                <div>
                  <label htmlFor="link-name" className="block text-xs text-gray-400 mb-1">Link name</label>
                  <input id="link-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Support agent onboarding" />
                </div>

                {owner && (
                  <div>
                    <label htmlFor="link-org" className="block text-xs text-gray-400 mb-1">Organization</label>
                    <select id="link-org" value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                      <option value="">Select an organization</option>
                      {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label htmlFor="link-role" className="block text-xs text-gray-400 mb-1">Default role</label>
                  <select id="link-role" value={form.defaultRoleId} onChange={(e) => setForm({ ...form, defaultRoleId: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                    {SAFE_ROLE_TEMPLATES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">Only roles safe for unattended, reusable links are shown. High-privilege roles are never available here.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="link-dept" className="block text-xs text-gray-400 mb-1">Department</label>
                    <select id="link-dept" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value, team: "" })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                      <option value="">None</option>
                      {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="link-team" className="block text-xs text-gray-400 mb-1">Team</label>
                    <select id="link-team" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                      <option value="">None</option>
                      {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="link-domains" className="block text-xs text-gray-400 mb-1">Allowed email domains (comma-separated)</label>
                  <input id="link-domains" value={form.allowedEmailDomains} onChange={(e) => setForm({ ...form, allowedEmailDomains: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. caspira.example" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="link-expiration" className="block text-xs text-gray-400 mb-1">Expiration</label>
                    <select id="link-expiration" value={form.expirationPreset} onChange={(e) => setForm({ ...form, expirationPreset: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                      {INVITATION_EXPIRATION_PRESETS.filter((p) => p.value !== "custom").map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="link-max-uses" className="block text-xs text-gray-400 mb-1">Max uses</label>
                    <input id="link-max-uses" type="number" min="1" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-200">
                  <input type="checkbox" checked={form.approvalRequired} onChange={(e) => setForm({ ...form, approvalRequired: e.target.checked })} />
                  Require admin approval before someone joins through this link
                </label>

                {highRiskWarning && (
                  <p className="text-xs text-amber-300 flex items-start gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    Disabling approval and/or leaving domains unrestricted increases the risk of unintended sign-ups. This is still a frontend preview only.
                  </p>
                )}

                {createError && <p className="text-xs text-red-400">{createError}</p>}
              </div>

              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
                <button onClick={submitCreate} disabled={!form.name.trim() || !(form.organizationId || fixedOrganizationId)}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg">
                  Create Invite Link
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}

function MetricCard({ label, value, icon }) {
  return (
    <div className="text-left bg-gray-900/40 border border-gray-800 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase">{icon}{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}
