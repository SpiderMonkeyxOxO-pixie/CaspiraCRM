import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, XCircle, Clock, ShieldAlert, Ban, Building2, Users } from "lucide-react";
import axiosInstance from "../../Helpers/axiosInstance";
import { findRoleTemplate } from "../../Helpers/mockRbacData";

function roleName(id) {
  return findRoleTemplate(id)?.name || id || "—";
}
function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const ERROR_MESSAGES = {
  domain_not_allowed: "Your email domain isn't on this link's allowed list.",
  already_member: "This email already belongs to an active member of this organization.",
  usage_limit_reached: "This link has reached its maximum number of uses.",
  expired: "This link has expired.",
  revoked: "This link was revoked by an administrator.",
  invalid_token: "This link doesn't match anything in this preview environment.",
};

export default function JoinAcceptance() {
  const { token } = useParams();

  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [invalid, setInvalid] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null); // { kind: "accepted" | "pending", member? }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axiosInstance.get(`/join/${token}`).then(({ data }) => {
      if (cancelled) return;
      if (!data?.link) { setInvalid(true); }
      else { setLink(data.link); setOrganization(data.organization); }
      setLoading(false);
    }).catch(() => { if (!cancelled) { setInvalid(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data } = await axiosInstance.post(`/join/${token}/accept`, { name: name.trim(), email: email.trim() });
      if (data.pendingApproval) setResult({ kind: "pending" });
      else setResult({ kind: "accepted", member: data.member });
    } catch (error) {
      const code = error.response?.data?.error;
      setSubmitError(ERROR_MESSAGES[code] || "Something went wrong with this preview action.");
    } finally {
      setSubmitting(false);
    }
  };

  let state = "loading";
  if (!loading) {
    if (invalid) state = "invalid_token";
    else if (result?.kind === "accepted") state = "accepted";
    else if (result?.kind === "pending") state = "approval_pending";
    else if (link.status === "Revoked") state = "revoked";
    else if (link.status === "Expired" || new Date(link.expirationDate) < new Date()) state = "expired";
    else if (link.status === "Usage Limit Reached" || link.currentUses >= link.maxUses) state = "usage_limit_reached";
    else state = "form";
  }

  return (
    <div className="min-h-screen bg-[#0a0b10] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="bg-[#12141c] border border-gray-800 rounded-2xl p-8 text-center">
          {state === "loading" && <p className="text-gray-400 text-sm">Loading invite link…</p>}

          {state === "invalid_token" && (
            <StateBlock icon={<XCircle size={40} className="text-red-400" />} title="Invalid invite link"
              message={ERROR_MESSAGES.invalid_token} />
          )}

          {state === "revoked" && (
            <StateBlock icon={<Ban size={40} className="text-red-400" />} title="Link revoked" message={ERROR_MESSAGES.revoked} />
          )}

          {state === "expired" && (
            <StateBlock icon={<Clock size={40} className="text-gray-400" />} title="Link expired"
              message={`This link expired on ${formatDate(link?.expirationDate)}.`} />
          )}

          {state === "usage_limit_reached" && (
            <StateBlock icon={<Users size={40} className="text-amber-400" />} title="Link usage limit reached" message={ERROR_MESSAGES.usage_limit_reached} />
          )}

          {state === "accepted" && (
            <StateBlock icon={<CheckCircle2 size={40} className="text-emerald-400" />} title="Membership created (preview)"
              message={`You've joined ${organization?.name || "this organization"} as ${roleName(link?.defaultRoleId)}. This is a frontend preview — no real account or backend membership was created.`} />
          )}

          {state === "approval_pending" && (
            <StateBlock icon={<ShieldAlert size={40} className="text-amber-400" />} title="Awaiting admin approval"
              message={`Your request to join ${organization?.name || "this organization"} has been submitted and is waiting for an administrator to approve it. This is a frontend preview — no real request was sent.`} />
          )}

          {state === "form" && link && (
            <>
              <div className="mb-4">
                <div className="w-12 h-12 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center mx-auto mb-3">
                  <Building2 size={22} className="text-blue-400" />
                </div>
                <h1 className="text-lg font-semibold text-white">Join {organization?.name || "this organization"}</h1>
                <p className="text-sm text-gray-300 mt-2">You'll join as <span className="text-white font-medium">{roleName(link.defaultRoleId)}</span>
                  {link.department && <> · {link.department}</>}
                </p>
                {link.allowedEmailDomains.length > 0 && (
                  <p className="text-[11px] text-gray-500 mt-1">Restricted to: {link.allowedEmailDomains.join(", ")}</p>
                )}
                {link.approvalRequired && (
                  <p className="text-xs text-amber-300 flex items-center gap-1.5 justify-center mt-2"><ShieldAlert size={13} /> Joining requires admin approval before access is granted.</p>
                )}
              </div>

              <form onSubmit={handleSubmit} className="text-left space-y-3">
                <div>
                  <label htmlFor="join-name" className="block text-xs text-gray-400 mb-1">Your name</label>
                  <input id="join-name" required value={name} onChange={(e) => setName(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. Jordan Lee" />
                </div>
                <div>
                  <label htmlFor="join-email" className="block text-xs text-gray-400 mb-1">Your email</label>
                  <input id="join-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="e.g. jordan@example.com" />
                </div>
                {submitError && <p className="text-xs text-red-400">{submitError}</p>}
                <button type="submit" disabled={submitting} className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40">
                  {link.approvalRequired ? "Request to Join" : "Join Organization"}
                </button>
              </form>
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

function StateBlock({ icon, title, message }) {
  return (
    <div>
      <div className="flex justify-center mb-3">{icon}</div>
      <h1 className="text-lg font-semibold text-white mb-1">{title}</h1>
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}
