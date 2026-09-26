import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Laptop, LogOut, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import * as api from "../../Helpers/backendAuthClient";

const card = "bg-gray-900 border border-gray-700 rounded-xl p-6";
const input = "w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500";
const primary = "px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed";
const secondary = "px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 text-sm font-medium disabled:opacity-50";
const errorOf = (err, fallback) => err?.response?.data?.message || fallback;

// "Chrome on Windows" from a user-agent string.
function describeDevice(ua = "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : ua ? "Browser" : "Unknown device";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Android|iPhone|iPad|Mobile/.test(ua) };
}

const when = (d) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// Asks for the password when the server wants a recent sign-in, then retries.
function PasswordPrompt({ onDone, onCancel }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.reauthenticate(password); onDone(); }
    catch (err) { toast.error(errorOf(err, "That password is not correct.")); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="reauth-title" className={`relative w-[400px] max-w-full ${card}`}>
        <h3 id="reauth-title" className="text-lg font-semibold text-white">Confirm your password</h3>
        <p className="text-sm text-gray-400 mt-1">For your security, confirm it's you before changing two-factor authentication.</p>
        <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} mt-4`} placeholder="Password" aria-label="Password" />
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className={secondary}>Cancel</button>
          <button type="submit" disabled={!password || busy} className={primary}>{busy ? "Checking…" : "Continue"}</button>
        </div>
      </form>
    </div>
  );
}

function TwoFactor({ user, onChanged }) {
  const [mode, setMode] = useState("idle"); // idle | setup | disable
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(null); // action waiting for the password prompt
  const enabled = !!user?.twoFactorEnabled;

  const withRecentAuth = async (action) => {
    try { await action(); }
    catch (err) {
      if (err?.response?.data?.code === "REAUTHENTICATION_REQUIRED") setRetry(() => action);
      else toast.error(errorOf(err, "Something went wrong. Try again."));
    }
  };

  const begin = () => withRecentAuth(async () => {
    const data = await api.startMfaSetup();
    setSetup(data); setCode(""); setMode("setup");
  });

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    await withRecentAuth(async () => {
      if (mode === "setup") { await api.enableMfa(code); toast.success("Two-factor authentication is on."); }
      else { await api.disableMfa(code); toast.success("Two-factor authentication is off."); }
      setMode("idle"); setSetup(null); setCode("");
      onChanged();
    });
    setBusy(false);
  };

  return (
    <section className={card} aria-labelledby="mfa-title">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg border ${enabled ? "bg-emerald-500/15 border-emerald-500/30" : "bg-amber-500/10 border-amber-500/20"}`}>
            {enabled ? <ShieldCheck className="text-emerald-400" size={20} /> : <ShieldOff className="text-amber-400" size={20} />}
          </div>
          <div>
            <h4 id="mfa-title" className="text-lg font-semibold text-white">Two-factor authentication</h4>
            <p className="text-sm text-gray-400 mt-0.5">
              {enabled ? "On. Signing in needs your password and a code from your authenticator app." : "Off. Add a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) to every sign-in."}
            </p>
          </div>
        </div>
        {mode === "idle" && (enabled
          ? <button type="button" onClick={() => { setCode(""); setMode("disable"); }} className={`${secondary} whitespace-nowrap shrink-0`}>Turn off</button>
          : <button type="button" onClick={begin} className={`${primary} whitespace-nowrap shrink-0`}>Turn on</button>)}
      </div>

      {mode !== "idle" && (
        <form onSubmit={confirm} className="mt-5 border-t border-gray-700 pt-5 space-y-4">
          {mode === "setup" && setup && (
            <div className="flex flex-col sm:flex-row gap-5 items-start">
              <img src={setup.qrCode} alt="QR code for your authenticator app" className="w-40 h-40 rounded-lg bg-white p-2 border border-gray-700" />
              <ol className="text-sm text-gray-300 space-y-2 list-decimal pl-5">
                <li>Open your authenticator app and scan this QR code.</li>
                <li>Can't scan? Enter this key instead: <code className="block mt-1 font-mono text-xs break-all text-white bg-gray-800 rounded px-2 py-1">{setup.secret.match(/.{1,4}/g).join(" ")}</code></li>
                <li>Type the 6-digit code the app shows.</li>
              </ol>
            </div>
          )}
          {mode === "disable" && <p className="text-sm text-gray-300">Enter a current code from your authenticator app to turn two-factor authentication off.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className={`${input.replace("w-full ", "")} w-44 tracking-[0.3em] font-mono`} placeholder="123456" aria-label="6-digit code" />
            <button type="submit" disabled={code.length !== 6 || busy} className={primary}>{mode === "setup" ? "Turn on" : "Turn off"}</button>
            <button type="button" onClick={() => { setMode("idle"); setSetup(null); }} className={secondary}>Cancel</button>
          </div>
        </form>
      )}

      {retry && <PasswordPrompt onCancel={() => setRetry(null)} onDone={() => { const a = retry; setRetry(null); withRecentAuth(a); }} />}
    </section>
  );
}

function Sessions() {
  const [sessions, setSessions] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.listSessions().then((d) => setSessions(d.sessions || [])).catch(() => setSessions([])), []);
  useEffect(() => { load(); }, [load]);

  const revoke = async (id) => {
    try { await api.revokeSession(id); toast.success("That session was signed out."); load(); }
    catch (err) { toast.error(errorOf(err, "Couldn't sign that session out.")); }
  };
  const revokeOthers = async () => {
    setBusy(true);
    try { await api.revokeOtherSessions(); toast.success("All other sessions were signed out."); load(); }
    catch (err) { toast.error(errorOf(err, "Couldn't sign the other sessions out.")); }
    finally { setBusy(false); }
  };
  const others = (sessions || []).filter((s) => !s.current).length;

  return (
    <section className={card} aria-labelledby="sessions-title">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h4 id="sessions-title" className="text-lg font-semibold text-white">Where you're signed in</h4>
          <p className="text-sm text-gray-400 mt-0.5">Sign out any session you don't recognise, then change your password.</p>
        </div>
        <button type="button" onClick={revokeOthers} disabled={busy || !others} className={secondary}>
          <span className="inline-flex items-center gap-2"><LogOut size={16} /> Sign out all others</span>
        </button>
      </div>
      {sessions === null ? <p className="text-sm text-gray-400">Loading…</p> : !sessions.length ? <p className="text-sm text-gray-400">No active sessions found.</p> : (
        <>
        <ul className="border border-gray-700 rounded-lg">
          {(showAll ? sessions : sessions.slice(0, 5)).map((s) => {
            const d = describeDevice(s.userAgent);
            const Icon = d.mobile ? Smartphone : Laptop;
            return (
              <li key={s._id} className="flex items-center justify-between gap-3 p-3 border-b border-gray-800 last:border-b-0">
                <div className="flex items-center gap-3 min-w-0">
                  <Icon size={20} className="text-gray-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{d.label}</span>
                      {s.current && <span className="text-[11px] rounded px-1.5 py-0.5 border bg-emerald-500/15 text-emerald-300 border-emerald-500/30">This device</span>}
                    </div>
                    <div className="text-xs text-gray-400">{s.ipAddress || "Unknown address"} · signed in {when(s.createdAt)}</div>
                  </div>
                </div>
                {!s.current && <button type="button" onClick={() => revoke(s._id)} className="text-sm text-red-400 hover:underline shrink-0">Sign out</button>}
              </li>
            );
          })}
        </ul>
        {sessions.length > 5 && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-sm text-blue-400 hover:underline">
            {showAll ? "Show fewer" : `Show all ${sessions.length} sessions`}
          </button>
        )}
        </>
      )}
    </section>
  );
}

function Security({ user, onUserChanged }) {
  return (
    <div className="space-y-6">
      <TwoFactor user={user} onChanged={onUserChanged} />
      <Sessions />
    </div>
  );
}

export default Security;
