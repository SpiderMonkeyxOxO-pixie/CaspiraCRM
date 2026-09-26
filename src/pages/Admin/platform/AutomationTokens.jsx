// Automation tokens for host scripts (register-release.sh, deploy.sh and
// rollback.sh). The token is shown once at creation; the server keeps only a
// keyed hash. Creating one asks for the password again (recent auth).
import { useId, useState } from "react";
import { Copy, Check } from "lucide-react";
import * as api from "../../../Helpers/backendPlatformClient";
import { Badge, Table, ErrorBox, Loading, Panel, Modal } from "../aiBackend/aiUi";
import { btn, btnPrimary, btnDanger, input, fmtDate, useAiLoad, useAiAction } from "../aiBackend/aiKit";

const SCOPES = [
  ["release:register", "Register releases", "register-release.sh"],
  ["deployment:read", "Read deployment plans", "deploy.sh, rollback.sh"],
  ["deployment:report", "Report deployment progress", "deploy.sh, rollback.sh"],
  ["drill:record", "Record operator-run restore drills", "drill scripts"],
];
const HOST_SCRIPTS = ["release:register", "deployment:read", "deployment:report"];

function status(t) {
  if (t.revokedAt) return ["Revoked", "gray"];
  if (new Date(t.expiresAt) < new Date()) return ["Expired", "gray"];
  return ["Active", "green"];
}

function CreateDialog({ onClose, onCreated }) {
  const id = useId();
  const [name, setName] = useState("production host scripts");
  const [scopes, setScopes] = useState(HOST_SCRIPTS);
  const [days, setDays] = useState(30);
  const [run, busy, error] = useAiAction();
  const toggle = (s) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const submit = (e) => {
    e.preventDefault();
    run(() => api.createToken({ name, scopes, days: Number(days) }), (res) => onCreated(res));
  };
  return (
    <Modal title="Create an automation token" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor={`${id}-name`} className="block"><span className="text-xs text-gray-400">Name</span>
          <input id={`${id}-name`} className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <fieldset className="space-y-1.5">
          <legend className="text-xs text-gray-400 mb-1">What the token may do</legend>
          {SCOPES.map(([s, label, used]) => (
            <label key={s} className="flex items-start gap-2 text-sm text-gray-300">
              <input type="checkbox" className="mt-1" checked={scopes.includes(s)} onChange={() => toggle(s)} />
              <span>{label} <span className="text-xs text-gray-500">({used})</span></span>
            </label>
          ))}
        </fieldset>
        <label htmlFor={`${id}-days`} className="block"><span className="text-xs text-gray-400">Valid for (days, 1–90)</span>
          <input id={`${id}-days`} type="number" min={1} max={90} className={input} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy || !scopes.length || !name.trim()}>Create token</button>
        </div>
      </form>
    </Modal>
  );
}

function ShowOnce({ created, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(created.token); setCopied(true); } catch { /* copy by hand */ } };
  return (
    <Modal title="Your new automation token" onClose={onClose}>
      <p className="text-sm text-amber-300">Copy it now: it is shown only this once. If you lose it, revoke it and create a new one.</p>
      <div className="flex items-start gap-2">
        <code className="flex-1 block break-all text-xs bg-gray-800 border border-gray-700 rounded-lg p-3 text-white select-all">{created.token}</code>
        <button type="button" className={btn} onClick={copy} aria-label="Copy token">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
      </div>
      <p className="text-sm text-gray-300">Save it on the host, readable by root only (replace <code className="text-xs">production</code> for other environments):</p>
      <pre className="text-xs bg-gray-800 border border-gray-700 rounded-lg p-3 text-gray-200 whitespace-pre-wrap">{`install -d -m 0700 /etc/caspira/production
( umask 077; cat > /etc/caspira/production/deploy-token )   # paste, Enter, then Ctrl+D`}</pre>
      <div className="flex justify-end"><button type="button" className={btnPrimary} onClick={onClose}>I've saved it</button></div>
    </Modal>
  );
}

export default function AutomationTokens() {
  const tokens = useAiLoad(() => api.listTokens(), []);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [run, busy, error] = useAiAction();
  if (tokens.loading) return <Loading />;
  return (
    <Panel title="Automation tokens (host scripts)" actions={<button type="button" className={btnPrimary} onClick={() => setCreating(true)}>Create token…</button>}>
      <p className="text-xs text-gray-400 mb-2">Used by <code>register-release.sh</code>, <code>deploy.sh</code> and <code>rollback.sh</code> on the server, so releases go through deployment approval and gates. Each token is limited to the actions you choose and expires.</p>
      <ErrorBox error={error || tokens.error} />
      <Table rows={tokens.data?.tokens || []} empty="No automation tokens yet." columns={[
        { label: "Name", render: (t) => <span>{t.name}<span className="block text-[11px] text-gray-500"><code>{t.id}</code></span></span> },
        { label: "Scopes", render: (t) => <span className="text-xs">{(t.scopes || []).join(", ")}</span> },
        { label: "Status", render: (t) => { const [s, c] = status(t); return <Badge tone={c}>{s}</Badge>; } },
        { label: "Expires", render: (t) => fmtDate(t.expiresAt) },
        { label: "Last used", render: (t) => (t.lastUsedAt ? fmtDate(t.lastUsedAt) : "never") },
        { label: "", render: (t) => status(t)[0] === "Active" && <button type="button" className={btnDanger} disabled={busy} onClick={() => run(() => api.revokeToken(t.id), tokens.reload)}>Revoke</button> },
      ]} />
      {creating && <CreateDialog onClose={() => setCreating(false)} onCreated={(res) => { setCreating(false); setCreated(res); tokens.reload(); }} />}
      {created && <ShowOnce created={created} onClose={() => setCreated(null)} />}
    </Panel>
  );
}
