// /admin/platform — Backend Phase 13 Platform Operations for the System
// Owner and delegated platform roles: health and alerts, security findings
// and secret metadata, backups, restores and drills, disaster recovery,
// releases and deployments. Each tab shows only what the member's platform
// permissions open (GET /admin/platform/access); the API re-checks every
// request. Sensitive actions ask for the password again (recent auth).
import { useEffect, useId, useState } from "react";
import { ShieldAlert } from "lucide-react";
import * as api from "../../../Helpers/backendPlatformClient";
import { Loading, Modal, ErrorBox } from "../aiBackend/aiUi";
import { btn, btnPrimary, input, useAiLoad } from "../aiBackend/aiKit";
import { Tabs } from "../../AI/admin/AdminShell";
import { OverviewTab, SecurityTab, BackupsTab, RestoresTab, DisasterRecoveryTab, DeploymentsTab, AlertsTab } from "./PlatformSections";

const TABS = [
  ["overview", "Health", ["platform.health.read"]],
  ["alerts", "Alerts & jobs", ["platform.health.read"]],
  ["security", "Security & secrets", ["platform.security.read", "platform.secrets.read_metadata", "platform.vulnerability.read"]],
  ["backups", "Backups", ["platform.backup.read"]],
  ["restores", "Restores & drills", ["platform.backup.read", "platform.restore.plan", "platform.restore.approve"]],
  ["dr", "Disaster recovery", ["platform.dr.read"]],
  ["deployments", "Releases & deployments", ["platform.release.read", "platform.deployment.plan", "platform.deployment.approve"]],
];

export default function PlatformOperations() {
  const access = useAiLoad(() => api.platformAccess(), []);
  const [tab, setTab] = useState(null);
  const [prompt, setPrompt] = useState(null);

  useEffect(() => {
    api.setReauthPrompt(() => new Promise((resolve) => setPrompt({ resolve })));
    return () => api.setReauthPrompt(null);
  }, []);

  if (!api.PLATFORM_MODE_ENABLED) {
    return <div className="p-6 text-gray-300"><h1 className="text-xl font-semibold text-white">Platform Operations</h1><p className="mt-2 text-sm">Platform Operations needs the backend sign-in mode (VITE_BACKEND_AUTH_MODE=true).</p></div>;
  }
  if (access.loading) return <Loading what="Checking your access…" />;
  const perms = new Set(access.data?.permissions || []);
  const can = (p) => perms.has(p);
  const visible = TABS.filter(([, , requires]) => requires.some(can));
  if (access.error || !visible.length) {
    return (
      <div className="p-6">
        <div role="alert" className="max-w-xl bg-gray-900/60 border border-gray-800 rounded-xl p-5 text-gray-300 flex gap-3">
          <ShieldAlert className="text-amber-300 shrink-0" aria-hidden="true" />
          <div><h1 className="text-lg font-semibold text-white">Platform Operations</h1><p className="text-sm mt-1">This area is for the System Owner and delegated platform operators. Organization administrator roles don't include it.</p></div>
        </div>
      </div>
    );
  }
  const current = visible.some(([k]) => k === tab) ? tab : visible[0][0];
  const props = { can, environment: access.data.environment };
  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <nav aria-label="Breadcrumb" className="text-xs text-gray-500 flex items-center gap-1"><span>Administration</span><span>/</span><span className="text-gray-300">Platform Operations</span></nav>
      <div>
        <h1 className="text-2xl font-bold">Platform Operations <span className="ml-2 align-middle text-xs px-2 py-0.5 rounded-full border border-gray-700 text-gray-300">{access.data.environment}</span></h1>
        <p className="text-sm text-gray-400 mt-1 max-w-3xl">Security, backups, restores, disaster recovery and deployments for this environment. Restores, deployments and rollbacks need a second approver; sensitive actions ask for your password again. A green indicator isn't proof that a backup can be restored — only a passed restore drill is.</p>
      </div>
      <Tabs tabs={visible.map(([k, label]) => [k, label])} value={current} onChange={setTab} label="Platform sections" />
      {current === "overview" && <OverviewTab {...props} />}
      {current === "alerts" && <AlertsTab {...props} />}
      {current === "security" && <SecurityTab {...props} />}
      {current === "backups" && <BackupsTab {...props} />}
      {current === "restores" && <RestoresTab {...props} />}
      {current === "dr" && <DisasterRecoveryTab {...props} />}
      {current === "deployments" && <DeploymentsTab {...props} />}
      {prompt && <ReauthDialog onDone={(pw) => { prompt.resolve(pw); setPrompt(null); }} />}
    </div>
  );
}

// Password confirmation for sensitive actions. The value goes straight to
// POST /auth/reauthenticate and is never kept.
function ReauthDialog({ onDone }) {
  const id = useId();
  const [password, setPassword] = useState("");
  return (
    <Modal title="Confirm your password" onClose={() => onDone(null)}>
      <form onSubmit={(e) => { e.preventDefault(); if (password) onDone(password); }} className="space-y-3">
        <p className="text-sm text-gray-300">This action changes platform security or data recovery. Confirm your password to continue.</p>
        <label htmlFor={`${id}-pw`} className="block"><span className="text-xs text-gray-400">Password</span>
          <input id={`${id}-pw`} type="password" autoComplete="current-password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        <ErrorBox error={null} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={() => onDone(null)}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={!password}>Confirm</button>
        </div>
      </form>
    </Modal>
  );
}
