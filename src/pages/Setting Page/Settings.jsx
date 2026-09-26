import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useDispatch, useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Lock, Settings as SettingsIcon, Shield, UserCircle } from "lucide-react";
import { getUserData } from "../../redux/authSlice";
import * as api from "../../Helpers/backendAuthClient";
import { InitialsAvatar, displayName } from "../../components/account/accountDisplay";
import { getRoleLabel } from "../../utils/roleLabels";
import Security from "./Security";

const card = "bg-gray-900 border border-gray-700 rounded-xl p-6";
const input = "w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500";
const readOnly = "w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-gray-400 cursor-not-allowed";
const label = "block text-sm font-medium text-gray-300 mb-1.5";
const primary = "px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed";
const secondary = "px-5 py-2.5 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 font-medium disabled:opacity-50";
const errorOf = (err, fallback) => err?.response?.data?.message || fallback;

// Same rules the server applies (accountController.passwordProblem).
function passwordChecks(password, user) {
  const lower = password.toLowerCase();
  const personal = [user?.username, user?.email?.split("@")[0]].some((v) => v && v.length >= 3 && lower.includes(v.toLowerCase()));
  return [
    ["At least 10 characters", password.length >= 10],
    ["A letter and a number", /[A-Za-z]/.test(password) && /\d/.test(password)],
    ["Not your username or email", !!password && !personal],
  ];
}

function PasswordInput({ id, value, onChange, autoComplete, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? "text" : "password"} value={value} onChange={onChange} autoComplete={autoComplete} placeholder={placeholder} className={`${input} pr-11`} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-300">
        {show ? <EyeOff size={20} /> : <Eye size={20} />}
      </button>
    </div>
  );
}

function BasicDetails({ user, onSaved }) {
  const [form, setForm] = useState({ fullName: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const reset = () => setForm({ fullName: displayName(user), phone: user?.phone || "" });
  useEffect(reset, [user]);
  const dirty = form.fullName.trim() !== displayName(user) || form.phone.trim() !== (user?.phone || "");

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateMyProfile({ fullName: form.fullName, phone: form.phone });
      toast.success("Your details were saved.");
      onSaved();
    } catch (err) { toast.error(errorOf(err, "Couldn't save your details.")); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} className={card} aria-labelledby="basic-title">
      <div className="flex items-center gap-4 mb-6">
        <InitialsAvatar user={user} size={64} />
        <div className="min-w-0">
          <h3 id="basic-title" className="text-xl font-semibold text-white">Basic details</h3>
          <p className="text-sm text-gray-400">{getRoleLabel(user?.role)}</p>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <label htmlFor="fullName" className={label}>Full name</label>
          <input id="fullName" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} autoComplete="name" className={input} placeholder="Your full name" />
        </div>
        <div>
          <label htmlFor="phone" className={label}>Phone number</label>
          <input id="phone" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} autoComplete="tel" className={input} placeholder="+374 10 123456" />
        </div>
        <div>
          <label htmlFor="username" className={label}>Username</label>
          <input id="username" value={user?.username || ""} disabled className={readOnly} />
        </div>
        <div>
          <label htmlFor="email" className={label}>Email</label>
          <input id="email" value={user?.email || ""} disabled className={readOnly} />
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-3">Your username, email and role are managed by your administrator.</p>
      <div className="flex justify-end gap-3 mt-6">
        <button type="button" onClick={reset} disabled={!dirty || busy} className={secondary}>Reset</button>
        <button type="submit" disabled={!dirty || busy || form.fullName.trim().length < 2} className={primary}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}

function ChangePassword({ user }) {
  const empty = { current: "", next: "", confirm: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const checks = passwordChecks(form.next, user);
  const ready = form.current && checks.every(([, ok]) => ok) && form.next === form.confirm;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { message } = await api.changeMyPassword(form.current, form.next);
      toast.success(message || "Password changed.");
      setForm(empty);
    } catch (err) { toast.error(errorOf(err, "Couldn't change your password.")); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className={card} aria-labelledby="password-title">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30"><Lock className="text-blue-400" size={20} /></div>
        <div>
          <h3 id="password-title" className="text-xl font-semibold text-white">Change password</h3>
          <p className="text-sm text-gray-400">Changing it signs you out everywhere else.</p>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="md:col-span-2 md:w-1/2 md:pr-2.5">
          <label htmlFor="current" className={label}>Current password</label>
          <PasswordInput id="current" value={form.current} onChange={set("current")} autoComplete="current-password" placeholder="Current password" />
        </div>
        <div>
          <label htmlFor="next" className={label}>New password</label>
          <PasswordInput id="next" value={form.next} onChange={set("next")} autoComplete="new-password" placeholder="New password" />
          <ul className="mt-2 space-y-1 text-xs" aria-label="Password requirements">
            {checks.map(([text, ok]) => (
              <li key={text} className={ok ? "text-emerald-400" : "text-gray-500"}>{ok ? "✓" : "•"} {text}</li>
            ))}
          </ul>
        </div>
        <div>
          <label htmlFor="confirm" className={label}>Confirm new password</label>
          <PasswordInput id="confirm" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" placeholder="Repeat the new password" />
          {form.confirm && form.next !== form.confirm && <p className="text-red-400 text-xs mt-2">The passwords don't match.</p>}
        </div>
      </div>
      <div className="flex justify-end mt-6">
        <button type="submit" disabled={!ready || busy} className={primary}>{busy ? "Changing…" : "Change password"}</button>
      </div>
    </form>
  );
}

const TABS = [
  { id: "profile", label: "Profile", icon: UserCircle },
  { id: "security", label: "Security", icon: Shield },
];

function Settings() {
  const dispatch = useDispatch();
  const user = useSelector((state) => state?.auth?.data);
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "profile";
  const refreshUser = () => dispatch(getUserData());

  return (
    <div className="min-h-full text-white p-4 md:p-6">
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon className="text-blue-400" size={26} />
        <h2 className="text-2xl font-bold text-white">Settings</h2>
      </div>
      <div className="flex flex-col lg:flex-row gap-6">
        <nav className="lg:w-56 shrink-0" aria-label="Settings sections">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-2 space-y-1">
            {TABS.map(({ id, label: text, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setParams(id === "profile" ? {} : { tab: id })} aria-current={tab === id ? "page" : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium ${tab === id ? "bg-blue-500/10 text-blue-400 border border-blue-500/30" : "text-gray-300 hover:bg-gray-800 border border-transparent"}`}>
                <Icon size={18} /> {text}
              </button>
            ))}
          </div>
        </nav>
        <div className="flex-1 min-w-0 space-y-6 max-w-4xl">
          {tab === "profile" ? (
            <>
              <BasicDetails user={user} onSaved={refreshUser} />
              <ChangePassword user={user} />
            </>
          ) : (
            <Security user={user} onUserChanged={refreshUser} />
          )}
        </div>
      </div>
    </div>
  );
}

export default Settings;
