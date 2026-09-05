import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  CheckCircle2, XCircle, Clock, ShieldAlert, AlertTriangle, Ban, LogIn, Mail, Building2,
} from "lucide-react";
import axiosInstance from "../../Helpers/axiosInstance";
import { logout } from "../../redux/authSlice";
import { findRoleTemplate } from "../../Helpers/mockRbacData";

function roleName(id) {
  return findRoleTemplate(id)?.name || id || "—";
}
function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function InviteAcceptance() {
  const { token } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { isLoggedIn, data: sessionUser } = useSelector((s) => s.auth);

  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const [continuedAnyway, setContinuedAnyway] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [resultStatus, setResultStatus] = useState(null); // "accepted" | "pending" | "declined"

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axiosInstance.get(`/invite/${token}`).then(({ data }) => {
      if (cancelled) return;
      if (!data?.invitation) { setInvalid(true); }
      else { setInvitation(data.invitation); setOrganization(data.organization); }
      setLoading(false);
    }).catch(() => { if (!cancelled) { setInvalid(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (sessionUser?.name || sessionUser?.FullName) setName(sessionUser.name || sessionUser.FullName);
  }, [sessionUser]);

  const handleAccept = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data } = await axiosInstance.post(`/invite/${token}/accept`, { name: name.trim() || undefined });
      if (data.pendingApproval) { setInvitation(data.invitation); setResultStatus("pending"); }
      else { setInvitation((prev) => ({ ...prev, status: "Accepted Preview" })); setResultStatus("accepted"); }
    } catch (error) {
      setSubmitError(error.response?.data?.error || "Something went wrong with this preview action.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await axiosInstance.post(`/invite/${token}/decline`);
      setResultStatus("declined");
    } catch (error) {
      setSubmitError(error.response?.data?.error || "Something went wrong with this preview action.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchAccount = async () => {
    await dispatch(logout());
    navigate("/login");
  };

  let state = "loading";
  if (!loading) {
    if (invalid) state = "invalid_token";
    else if (resultStatus === "accepted" || invitation.status === "Accepted Preview") state = "accepted";
    else if (resultStatus === "declined" || invitation.status === "Declined Preview") state = "declined";
    else if (resultStatus === "pending" || invitation.status === "Approval Required") state = "approval_pending";
    else if (invitation.status === "Revoked") state = "revoked";
    else if (invitation.status === "Expired" || new Date(invitation.expirationDate) < new Date()) state = "expired";
    else if (!isLoggedIn) state = "sign_in_required";
    else if (sessionUser?.email && sessionUser.email.toLowerCase() !== invitation.email.toLowerCase() && !continuedAnyway) state = "email_mismatch";
    else state = "valid";
  }

  return (
    <div className="min-h-screen bg-[#0a0b10] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="bg-[#12141c] border border-gray-800 rounded-2xl p-8 text-center">
          {state === "loading" && <p className="text-gray-400 text-sm">Loading invitation…</p>}

          {state === "invalid_token" && (
            <StateBlock icon={<XCircle size={40} className="text-red-400" />} title="Invalid invitation link"
              message="This invitation link doesn't match anything in this preview environment. It may have been mistyped or the preview data was reset." />
          )}

          {state === "revoked" && (
            <StateBlock icon={<Ban size={40} className="text-red-400" />} title="Invitation revoked"
              message="This invitation was revoked by an administrator and can no longer be used." />
          )}

          {state === "expired" && (
            <StateBlock icon={<Clock size={40} className="text-gray-400" />} title="Invitation expired"
              message={`This invitation expired on ${formatDate(invitation?.expirationDate)}. Ask an administrator to send a new one.`} />
          )}

          {state === "declined" && (
            <StateBlock icon={<XCircle size={40} className="text-gray-400" />} title="Invitation declined"
              message="You've declined this invitation preview. No account or membership was created." />
          )}

          {state === "accepted" && (
            <StateBlock icon={<CheckCircle2 size={40} className="text-emerald-400" />} title="Membership accepted (preview)"
              message={`You've accepted the invitation to join ${organization?.name || "this organization"} as ${roleName(invitation?.intendedRoleId)}. This is a frontend preview — no real account or backend membership was created.`} />
          )}

          {state === "approval_pending" && (
            <StateBlock icon={<ShieldAlert size={40} className="text-amber-400" />} title="Awaiting admin approval"
              message={`Your request to join ${organization?.name || "this organization"} has been submitted and is waiting for an administrator to approve it. This is a frontend preview — no real request was sent.`} />
          )}

          {state === "sign_in_required" && invitation && (
            <>
              <InvitationSummary invitation={invitation} organization={organization} />
              <StateBlock icon={<LogIn size={36} className="text-blue-400" />} title="Sign in to continue"
                message={`This invitation was sent to ${invitation.email}. Sign in (or use the preview's demo login) with that identity to accept it.`} />
              <div className="flex flex-col gap-2 mt-4">
                <button onClick={() => navigate("/login")} className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium">Sign In</button>
                <button onClick={() => navigate("/login")} className="w-full border border-gray-700 hover:bg-gray-800 text-gray-300 px-4 py-2.5 rounded-lg text-sm">Create Account</button>
              </div>
              <p className="text-[11px] text-gray-600 mt-3">Account creation isn't implemented in this frontend phase — use one of the preview's demo logins.</p>
            </>
          )}

          {state === "email_mismatch" && invitation && (
            <>
              <InvitationSummary invitation={invitation} organization={organization} />
              <StateBlock icon={<AlertTriangle size={36} className="text-amber-400" />} title="Signed in with a different email"
                message={`You're currently signed in as ${sessionUser?.email}, but this invitation was sent to ${invitation.email}.`} />
              <div className="flex flex-col gap-2 mt-4">
                <button onClick={() => setContinuedAnyway(true)} className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
                  Continue as {invitation.email} (preview)
                </button>
                <button onClick={handleSwitchAccount} className="w-full border border-gray-700 hover:bg-gray-800 text-gray-300 px-4 py-2.5 rounded-lg text-sm">Sign out and sign in again</button>
              </div>
            </>
          )}

          {state === "valid" && invitation && (
            <>
              <InvitationSummary invitation={invitation} organization={organization} />
              {invitation.personalMessage && (
                <p className="text-sm text-gray-300 italic bg-gray-900/50 border border-gray-800 rounded-lg p-3 my-4">&ldquo;{invitation.personalMessage}&rdquo;</p>
              )}
              <div className="text-left my-4">
                <label htmlFor="invitee-name" className="block text-xs text-gray-400 mb-1">Your name</label>
                <input id="invitee-name" value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Jordan Lee" />
              </div>
              {invitation.approvalRequired && (
                <p className="text-xs text-amber-300 flex items-center gap-1.5 justify-center mb-3"><ShieldAlert size={13} /> Accepting will submit your request for admin approval.</p>
              )}
              {submitError && <p className="text-xs text-red-400 mb-3">{submitError}</p>}
              <div className="flex gap-2">
                <button onClick={handleDecline} disabled={submitting} className="flex-1 border border-gray-700 hover:bg-gray-800 text-gray-300 px-4 py-2.5 rounded-lg text-sm disabled:opacity-40">Decline</button>
                <button onClick={handleAccept} disabled={submitting} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40">
                  {invitation.approvalRequired ? "Request to Join" : "Accept Invitation"}
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-[11px] text-gray-600 mt-4">
          This is a frontend-only preview. No real email, account, or backend membership is created here.
        </p>
      </div>
    </div>
  );
}

function InvitationSummary({ invitation, organization }) {
  return (
    <div className="mb-4">
      <div className="w-12 h-12 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center mx-auto mb-3">
        <Building2 size={22} className="text-blue-400" />
      </div>
      <h1 className="text-lg font-semibold text-white">Join {organization?.name || "this organization"}</h1>
      <p className="text-sm text-gray-400 mt-1 flex items-center justify-center gap-1"><Mail size={13} /> {invitation.email}</p>
      <p className="text-sm text-gray-300 mt-2">As <span className="text-white font-medium">{roleName(invitation.intendedRoleId)}</span>
        {invitation.department && <> · {invitation.department}</>}{invitation.team && <> / {invitation.team}</>}
      </p>
      <p className="text-[11px] text-gray-500 mt-1">Expires {formatDate(invitation.expirationDate)}</p>
    </div>
  );
}

function StateBlock({ icon, title, message }) {
  return (
    <div>
      <div className="flex justify-center mb-3">{icon}</div>
      <h1 className="text-lg font-semibold text-white mb-1">{title}</h1>
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}
