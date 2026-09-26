// Live acceptance page for an email invitation (/invitations/:token/accept,
// also /invite/:token) or a team invite link (/join/:token). The invitee
// creates their account here; afterwards they sign in normally.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { acceptInvitation, acceptJoinToken, validateInvitationToken, validateJoinToken } from "../../Helpers/backendAuthClient";

const input = "w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white";
const PASSWORD_HINT = "At least 10 characters, with a letter and a number. Don't include your email name.";

export default function AcceptBackend({ kind }) {
  const { token } = useParams();
  const isLink = kind === "join";
  const [info, setInfo] = useState(null); // { organizationName, roleName, email?, allowedDomains? }
  const [state, setState] = useState("loading"); // loading | invalid | form | done | pending | exists
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (isLink ? validateJoinToken(token) : validateInvitationToken(token))
      .then((data) => { if (!cancelled) { setInfo(data); setState("form"); } })
      .catch(() => { if (!cancelled) setState("invalid"); });
    return () => { cancelled = true; };
  }, [token, isLink]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      const payload = { name: form.name.trim(), password: form.password, ...(isLink ? { email: form.email.trim() } : {}) };
      const result = await (isLink ? acceptJoinToken(token, payload) : acceptInvitation(token, payload));
      setState(/awaiting/i.test(result?.message || "") ? "pending" : "done");
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === "ACCOUNT_EXISTS") setState("exists");
      else setError(err?.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0b10] flex items-center justify-center p-4 text-white">
      <div className="w-full max-w-md bg-[#12141c] border border-gray-800 rounded-2xl p-7">
        {state === "loading" && <p className="text-sm text-gray-400 text-center">Checking your link…</p>}
        {state === "invalid" && (
          <Message icon={<XCircle className="text-red-400" size={36} />} title="This link doesn't work"
            text="It may have expired, been replaced by a newer link, or already been used. Ask the person who invited you for a new one." />
        )}
        {state === "done" && (
          <Message icon={<CheckCircle2 className="text-emerald-400" size={36} />} title={`Welcome to ${info?.organizationName}`}
            text="Your account is ready. Sign in with your email and the password you just chose." action={<Link to="/login" className="inline-block mt-4 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium">Sign in</Link>} />
        )}
        {state === "pending" && (
          <Message icon={<Clock className="text-amber-400" size={36} />} title="Almost there"
            text={`Your account is created. An administrator at ${info?.organizationName} approves new members before they get access; you can sign in once they have.`} />
        )}
        {state === "exists" && (
          <Message icon={<CheckCircle2 className="text-blue-400" size={36} />} title="You already have an account"
            text="Sign in first, then open this invitation link again to join." action={<Link to="/login" className="inline-block mt-4 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium">Sign in</Link>} />
        )}
        {state === "form" && (
          <form onSubmit={submit} className="space-y-3">
            <div className="text-center mb-2">
              <h1 className="text-xl font-semibold">Join {info.organizationName}</h1>
              <p className="text-sm text-gray-400 mt-1">You're invited as <span className="text-gray-200">{info.roleName}</span>. Create your account to continue.</p>
            </div>
            {isLink ? (
              <label className="block text-sm">Work email *<input required type="email" autoComplete="email" className={`${input} mt-1`} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                {info.allowedDomains?.length > 0 && <span className="block text-xs text-gray-500 mt-1">Only {info.allowedDomains.map((d) => `@${d}`).join(", ")} addresses can join.</span>}
              </label>
            ) : (
              <p className="text-sm text-gray-400">Email: <span className="text-gray-200">{info.email}</span></p>
            )}
            <label className="block text-sm">Your name *<input required autoComplete="name" className={`${input} mt-1`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="block text-sm">Password *<input required type="password" autoComplete="new-password" minLength={10} className={`${input} mt-1`} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <span className="block text-xs text-gray-500 mt-1">{PASSWORD_HINT}</span>
            </label>
            <label className="block text-sm">Repeat password *<input required type="password" autoComplete="new-password" className={`${input} mt-1`} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></label>
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            <button type="submit" disabled={busy} className="w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm font-medium disabled:opacity-50">{busy ? "Creating your account…" : "Create account and join"}</button>
            <p className="text-xs text-gray-500 text-center">Already have an account? <Link to="/login" className="text-blue-300 hover:underline">Sign in</Link> first, then open this link again.</p>
          </form>
        )}
      </div>
    </div>
  );
}

function Message({ icon, title, text, action }) {
  return (
    <div className="text-center">
      <div className="flex justify-center mb-3">{icon}</div>
      <h1 className="text-lg font-semibold mb-1">{title}</h1>
      <p className="text-sm text-gray-400">{text}</p>
      {action}
    </div>
  );
}
