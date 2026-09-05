import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { X, Mail, Link2, ShieldAlert, CheckCircle2, AlertTriangle } from "lucide-react";
import useFocusTrap from "../../hooks/useFocusTrap";
import { createInvitation, validateInvitationRecipient, selectAccessManagement } from "../../redux/admin/accessManagementSlice";
import {
  isSystemOwner, getInvitableRoleTemplates, requiresHighPrivilegeConfirmation,
  INVITATION_EXPIRATION_PRESETS, DEFAULT_EXPIRATION_PRESET,
} from "./accessManagementConfig";

const STEPS = ["Invitation Method", "Recipient", "Organization & Access", "Review", "Email Preview"];

function expirationIsoFromPreset(preset, customDate) {
  if (preset === "custom") return customDate ? new Date(customDate).toISOString() : null;
  const found = INVITATION_EXPIRATION_PRESETS.find((p) => p.value === preset);
  if (!found?.hours) return null;
  return new Date(Date.now() + found.hours * 60 * 60 * 1000).toISOString();
}

// Multi-step frontend-only invitation preview workflow. Nothing here sends
// a real email, generates a production-grade secure token, or creates a
// real account/membership — see mockAccessData.js's header comment for the
// full scope statement this whole package operates under.
export default function InviteMemberWizard({ actingRole, organizations, onClose, onCompleted }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { members, teams, departments, recipientValidation } = useSelector(selectAccessManagement);
  const containerRef = useFocusTrap(true, onClose);

  const owner = isSystemOwner(actingRole);
  const invitableRoles = useMemo(() => getInvitableRoleTemplates(actingRole), [actingRole]);
  const fixedOrganizationId = !owner ? organizations[0]?.id || "" : "";

  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [personalMessage, setPersonalMessage] = useState("");
  const [organizationId, setOrganizationId] = useState(fixedOrganizationId);
  const [intendedRoleId, setIntendedRoleId] = useState("");
  const [department, setDepartment] = useState("");
  const [team, setTeam] = useState("");
  const [manager, setManager] = useState("");
  const [expirationPreset, setExpirationPreset] = useState(DEFAULT_EXPIRATION_PRESET);
  const [customExpiration, setCustomExpiration] = useState("");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [require2FASetup, setRequire2FASetup] = useState(false);
  const [highPrivilegeConfirmed, setHighPrivilegeConfirmed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [result, setResult] = useState(null); // created invitation

  const needsHighPrivilegeConfirmation = requiresHighPrivilegeConfirmation(actingRole, intendedRoleId);
  const teamsForOrg = teams.filter((t) => t.organizationId === organizationId);
  const membersForOrg = members.filter((m) => m.organizationId === organizationId);

  // Organization Administrator's organization becomes known asynchronously
  // (fetchOrganizations() may still be in flight when this wizard first
  // mounts) — sync it in as soon as it's available rather than freezing an
  // empty value at mount via useState's initializer.
  useEffect(() => {
    if (!owner && fixedOrganizationId && organizationId !== fixedOrganizationId) setOrganizationId(fixedOrganizationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, fixedOrganizationId]);

  // Debounced so rapid keystrokes coalesce into one validation request for
  // the final typed value, instead of one request per keystroke racing to
  // overwrite state with whichever happens to resolve last.
  useEffect(() => {
    if (!email || !organizationId) return undefined;
    const t = setTimeout(() => dispatch(validateInvitationRecipient({ email, organizationId })), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, organizationId]);

  const emailFormatValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const recipientBlocksProgress = email && emailFormatValid && recipientValidation && recipientValidation.valid === false;

  const canProceedFromRecipient = emailFormatValid && !recipientBlocksProgress;
  const canProceedFromAccess = !!organizationId && !!intendedRoleId && (!needsHighPrivilegeConfirmation || highPrivilegeConfirmed);

  const goNext = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const handleSelectMethod = (selected) => {
    if (selected === "link") {
      onClose();
      navigate("/admin/invite-links");
      return;
    }
    goNext();
  };

  const handleGeneratePreview = async () => {
    setCreating(true);
    setCreateError(null);
    const action = await dispatch(createInvitation({
      email, organizationId, intendedRoleId,
      department: department || null, team: team || null, manager: manager || null,
      personalMessage, expirationDate: expirationIsoFromPreset(expirationPreset, customExpiration),
      approvalRequired,
    }));
    setCreating(false);
    if (createInvitation.fulfilled.match(action)) {
      setResult(action.payload.invitation);
    } else {
      setCreateError(action.payload?.message || action.payload || "Failed to generate the invitation preview.");
    }
  };

  const orgName = organizations.find((o) => o.id === organizationId)?.name || "your organization";
  const roleName = invitableRoles.find((r) => r.id === intendedRoleId)?.name || intendedRoleId;
  const previewToken = result?.frontendToken;
  const previewUrl = previewToken ? `${window.location.origin}/invite/${previewToken}` : `${window.location.origin}/invite/preview-token-not-yet-generated`;
  const previewExpiration = result?.expirationDate || expirationIsoFromPreset(expirationPreset, customExpiration);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-wizard-title"
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[#0f1119] border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-[#0f1119] border-b border-gray-800 px-6 py-4 flex items-center justify-between z-10">
          <h2 id="invite-wizard-title" className="text-lg font-bold text-white">Invite Member</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-300 rounded-lg p-1"><X size={18} /></button>
        </div>

        <nav aria-label="Invite wizard steps" className="flex gap-1 px-6 pt-4 overflow-x-auto">
          {STEPS.map((label, i) => (
            <div
              key={label}
              aria-current={step === i ? "step" : undefined}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap ${
                step === i ? "bg-blue-600 text-white" : i < step ? "text-emerald-400" : "text-gray-500"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" /> {label}
            </div>
          ))}
        </nav>

        <div className="p-6">
          {step === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400 mb-3">How would you like to grant access?</p>
              <button
                onClick={() => handleSelectMethod("email")}
                className="w-full flex items-start gap-3 border border-gray-700 hover:border-blue-500 rounded-xl p-4 text-left"
              >
                <Mail className="text-blue-400 mt-0.5" size={20} />
                <div>
                  <p className="text-white font-medium">Invite by Email</p>
                  <p className="text-xs text-gray-400 mt-1">Send a single, role-specific invitation to one person's email address.</p>
                </div>
              </button>
              <button
                onClick={() => handleSelectMethod("link")}
                className="w-full flex items-start gap-3 border border-gray-700 hover:border-blue-500 rounded-xl p-4 text-left"
              >
                <Link2 className="text-blue-400 mt-0.5" size={20} />
                <div>
                  <p className="text-white font-medium">Create Organization Invite Link</p>
                  <p className="text-xs text-gray-400 mt-1">A reusable link for onboarding multiple people into a safe, non-administrative role.</p>
                </div>
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="invite-email" className="block text-sm text-gray-300 mb-1.5">Email address</label>
                <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="name@company.com" />
                {email && !emailFormatValid && <p className="text-xs text-red-400 mt-1">Enter a valid email address.</p>}
                {recipientValidation && email && emailFormatValid && recipientValidation.valid === false && (
                  <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertTriangle size={12} /> {recipientValidation.message}</p>
                )}
                {recipientValidation && recipientValidation.valid && recipientValidation.warning && (
                  <p className="text-xs text-amber-400 mt-1 flex items-center gap-1"><AlertTriangle size={12} /> {recipientValidation.message}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="invite-first-name" className="block text-sm text-gray-300 mb-1.5">First name <span className="text-gray-500">(optional)</span></label>
                  <input id="invite-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label htmlFor="invite-last-name" className="block text-sm text-gray-300 mb-1.5">Last name <span className="text-gray-500">(optional)</span></label>
                  <input id="invite-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              </div>
              <div>
                <label htmlFor="invite-message" className="block text-sm text-gray-300 mb-1.5">Personal message <span className="text-gray-500">(optional)</span></label>
                <textarea id="invite-message" value={personalMessage} onChange={(e) => setPersonalMessage(e.target.value)} rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="invite-org" className="block text-sm text-gray-300 mb-1.5">Organization</label>
                {owner ? (
                  <select id="invite-org" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option value="">Select an organization...</option>
                    {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                ) : (
                  <input id="invite-org" disabled value={orgName} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400" title="Your organization is fixed and cannot be changed." />
                )}
              </div>

              <div>
                <label htmlFor="invite-role" className="block text-sm text-gray-300 mb-1.5">Role</label>
                <select id="invite-role" value={intendedRoleId} onChange={(e) => setIntendedRoleId(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Select a role...</option>
                  {invitableRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                {needsHighPrivilegeConfirmation && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium mb-1">High-privilege role</p>
                      <p>Organization Administrator has full operational control over an organization. This can only be granted through a direct email invitation, never a reusable link.</p>
                      <label className="flex items-center gap-2 mt-2">
                        <input type="checkbox" checked={highPrivilegeConfirmed} onChange={(e) => setHighPrivilegeConfirmed(e.target.checked)} />
                        I understand and want to invite this person as an Organization Administrator.
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="invite-department" className="block text-sm text-gray-300 mb-1.5">Department</label>
                  <select id="invite-department" value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option value="">None</option>
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="invite-team" className="block text-sm text-gray-300 mb-1.5">Team</label>
                  <select id="invite-team" value={team} onChange={(e) => setTeam(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option value="">None</option>
                    {teamsForOrg.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="invite-manager" className="block text-sm text-gray-300 mb-1.5">Manager</label>
                <select id="invite-manager" value={manager} onChange={(e) => setManager(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">None</option>
                  {membersForOrg.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="invite-expiration" className="block text-sm text-gray-300 mb-1.5">Invitation expiration</label>
                <select id="invite-expiration" value={expirationPreset} onChange={(e) => setExpirationPreset(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  {INVITATION_EXPIRATION_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                {expirationPreset === "custom" && (
                  <input type="date" value={customExpiration} onChange={(e) => setCustomExpiration(e.target.value)} className="mt-2 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                )}
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={approvalRequired} onChange={(e) => setApprovalRequired(e.target.checked)} /> Require administrator approval after acceptance
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={require2FASetup} onChange={(e) => setRequire2FASetup(e.target.checked)} /> Require two-factor setup (preview)
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                This member will join <span className="text-white">{orgName}</span> as a{" "}
                <span className="text-white">{roleName}</span>
                {department ? <> in the <span className="text-white">{department}</span> department</> : null}
                {team ? <>, team <span className="text-white">{teamsForOrg.find((t) => t.id === team)?.name}</span></> : null}.
              </p>
              <dl className="grid sm:grid-cols-2 gap-3 text-sm">
                <ReviewRow label="Recipient" value={`${firstName || lastName ? `${firstName} ${lastName}`.trim() + " — " : ""}${email}`} />
                <ReviewRow label="Organization" value={orgName} />
                <ReviewRow label="Role" value={roleName} />
                <ReviewRow label="Department" value={department || "—"} />
                <ReviewRow label="Team" value={teamsForOrg.find((t) => t.id === team)?.name || "—"} />
                <ReviewRow label="Manager" value={membersForOrg.find((m) => m.id === manager)?.name || "—"} />
                <ReviewRow label="Expiration" value={INVITATION_EXPIRATION_PRESETS.find((p) => p.value === expirationPreset)?.label || "—"} />
                <ReviewRow label="Approval required" value={approvalRequired ? "Yes" : "No"} />
                <ReviewRow label="Two-factor setup" value={require2FASetup ? "Required (preview)" : "Not required"} />
                <ReviewRow label="Invited by" value={owner ? "System Owner (you)" : "Organization Administrator (you)"} />
              </dl>
              {needsHighPrivilegeConfirmation && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> This is a high-privilege Organization Administrator invitation. Confirm before continuing.
                </div>
              )}
              <p className="text-xs text-gray-500">No email will be sent yet — the next step only generates a preview.</p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 text-xs text-blue-300">
                No email will be sent during this frontend phase. Gmail delivery will be connected through the backend later.
              </div>

              <div className="rounded-xl border border-gray-800 bg-white text-gray-900 overflow-hidden">
                <div className="bg-gray-100 px-4 py-2 text-xs text-gray-500 border-b border-gray-200">
                  Subject: You&rsquo;re invited to join {orgName}
                </div>
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-8 w-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-bold">{orgName.slice(0, 2).toUpperCase()}</span>
                    <span className="font-semibold">{orgName}</span>
                  </div>
                  <p className="text-sm">Hi{firstName ? ` ${firstName}` : ""},</p>
                  <p className="text-sm">
                    {owner ? "The System Owner" : "An Organization Administrator"} has invited you to join <strong>{orgName}</strong> as a{" "}
                    <strong>{roleName}</strong>{department ? ` in ${department}` : ""}{team ? `, ${teamsForOrg.find((t) => t.id === team)?.name}` : ""}.
                  </p>
                  {personalMessage && <p className="text-sm italic text-gray-600 border-l-2 border-gray-300 pl-3">&ldquo;{personalMessage}&rdquo;</p>}
                  <p className="text-xs text-gray-500">This invitation expires on {previewExpiration ? new Date(previewExpiration).toLocaleString() : "—"}.</p>
                  <a href={previewUrl} onClick={(e) => e.preventDefault()} className="inline-block bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg">Accept Invitation</a>
                  <p className="text-xs text-gray-500 break-all">Or copy this link: {previewUrl}</p>
                  <p className="text-xs text-gray-500 border-t border-gray-200 pt-2 mt-2">
                    This invitation is intended for {email || "the recipient"}. Do not forward this link. If you weren&rsquo;t expecting this, you can safely ignore this email.
                  </p>
                </div>
              </div>

              {createError && <p className="text-sm text-red-400">{createError}</p>}

              {result && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" /> Invitation preview generated and added to Pending Invitations.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-[#0f1119] border-t border-gray-800 px-6 py-4 flex justify-between">
          <button onClick={step === 0 ? onClose : goBack} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {step === 1 && <button onClick={goNext} disabled={!canProceedFromRecipient} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg">Continue</button>}
          {step === 2 && <button onClick={goNext} disabled={!canProceedFromAccess} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg">Continue</button>}
          {step === 3 && <button onClick={goNext} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Continue</button>}
          {step === 4 && !result && (
            <button onClick={handleGeneratePreview} disabled={creating} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg">
              {creating ? "Generating..." : "Generate Email Invitation Preview"}
            </button>
          )}
          {step === 4 && result && (
            <button onClick={onCompleted} className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-gray-800/60 pb-2">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm text-white text-right">{value}</dd>
    </div>
  );
}
