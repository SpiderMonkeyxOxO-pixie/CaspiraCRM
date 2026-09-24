import { useState } from "react";
import * as ai from "../../../Helpers/backendAiClient";
import { AiPage, Panel, Badge, ErrorBox, Loading, Modal } from "./aiUi";
import { useAiLoad, useAiAction, fmtDate, btn, btnPrimary, btnDanger, input } from "./aiKit";

// Backend-mode provider connections. The organization's own API key is sent
// once to the server (encrypted there) and never shown again.
export default function AiProvidersBackend() {
  const { data, error, loading, reload } = useAiLoad(async () => {
    const [p, c] = await Promise.all([ai.listProviders(), ai.listConnections()]);
    return { ...p, connections: c.connections };
  });
  const [dialog, setDialog] = useState(null); // { kind, provider, connection }
  const [run, busy, actionError] = useAiAction();
  const act = (fn) => run(fn, reload);

  return (
    <AiPage title="Providers" description="Connect your organization's own AI provider accounts. A provider shows Connected only after the server has verified the key with the provider and found an approved model." simulatorLabel={data?.simulatorLabel}>
      <ErrorBox error={error || actionError} onRetry={error ? reload : undefined} />
      {loading && !data ? <Loading /> : data && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.providers.map((p) => {
            const c = data.connections.find((x) => x.providerKey === p.key);
            const canConnect = p.availability === "Adapter" && p.allowedByPolicy;
            return (
              <Panel key={p.key} title={p.name} actions={<Badge>{p.connectionStatus}</Badge>}>
                <p className="text-xs text-gray-400 mb-2">{p.description}</p>
                {p.availability !== "Adapter" && <p className="text-xs text-gray-500">{p.availabilityReason}</p>}
                {p.availability === "Adapter" && !p.allowedByPolicy && <p className="text-xs text-amber-300">Not allowed by your AI policy{p.enabledByDefault ? "" : " (off by default — allow it in Policies)"}.</p>}
                {p.dataRetentionNote && <p className="text-[11px] text-gray-500 mt-1">{p.dataRetentionNote}</p>}
                {c && (
                  <dl className="text-xs text-gray-300 mt-3 space-y-1">
                    {c.simulatorLabel && <div className="text-violet-300">{c.simulatorLabel}</div>}
                    <div className="flex justify-between gap-2"><dt className="text-gray-500">Key</dt><dd>{c.keyHint || (c.mode === "Simulator" ? "not needed" : "—")}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-gray-500">Verified</dt><dd>{fmtDate(c.verifiedAt)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-gray-500">Models available</dt><dd>{c.verifiedModels.length}</dd></div>
                    {c.lastError && <div className="text-amber-300">{c.lastError.message}</div>}
                  </dl>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  {!c && canConnect && p.key !== "simulator" && <button type="button" className={btnPrimary} onClick={() => setDialog({ kind: "connect", provider: p })}>Connect</button>}
                  {c && c.status !== "Disabled" && <button type="button" className={btn} disabled={busy} onClick={() => act(() => ai.verifyConnection(c._id))}>Verify</button>}
                  {c && c.mode === "Live" && <button type="button" className={btn} onClick={() => setDialog({ kind: "rotate", provider: p, connection: c })}>Rotate key</button>}
                  {c && c.status !== "Disabled" && p.key !== "simulator" && <button type="button" className={btn} disabled={busy} onClick={() => act(() => ai.disableConnection(c._id))}>Disable</button>}
                  {c && c.status === "Disabled" && <button type="button" className={btn} disabled={busy} onClick={() => act(() => ai.enableConnection(c._id))}>Enable</button>}
                  {c && p.key !== "simulator" && <button type="button" className={btnDanger} onClick={() => setDialog({ kind: "remove", provider: p, connection: c })}>Remove</button>}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
      {dialog?.kind === "connect" && <KeyDialog title={`Connect ${dialog.provider.name}`} provider={dialog.provider} simulator={!!data?.simulatorLabel} onClose={() => setDialog(null)} onSubmit={(key, name) => ai.createConnection(dialog.provider.key, key, name)} onDone={() => { setDialog(null); reload(); }} />}
      {dialog?.kind === "rotate" && <KeyDialog title={`Rotate ${dialog.provider.name} key`} provider={dialog.provider} rotate onClose={() => setDialog(null)} onSubmit={(key) => ai.rotateKey(dialog.connection._id, key)} onDone={() => { setDialog(null); reload(); }} />}
      {dialog?.kind === "remove" && <RemoveDialog provider={dialog.provider} connection={dialog.connection} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />}
    </AiPage>
  );
}

function KeyDialog({ title, provider, rotate, simulator, onClose, onSubmit, onDone }) {
  const [key, setKey] = useState("");
  const [name, setName] = useState(provider.name);
  const [result, setResult] = useState(null);
  const [run, busy, error] = useAiAction();
  const submit = () => run(() => onSubmit(key, name), (out) => { setKey(""); setResult(out); });
  return (
    <Modal title={title} onClose={result ? onDone : onClose} footer={result ? <button type="button" className={btnPrimary} onClick={onDone}>Done</button> : <>
      <button type="button" className={btn} onClick={onClose}>Cancel</button>
      <button type="button" className={btnPrimary} disabled={busy || (!simulator && !key.trim())} onClick={submit}>{rotate ? "Save and verify" : "Connect and verify"}</button>
    </>}>
      {result ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-200">Status: <Badge>{result.connection.status}</Badge></p>
          {result.connection.lastError && <p className="text-sm text-amber-300">{result.connection.lastError.message}</p>}
          {result.verification?.message && <p className="text-sm text-amber-300">{result.verification.message}</p>}
          <p className="text-xs text-gray-400">{result.note}</p>
        </div>
      ) : (
        <>
          {!rotate && (
            <>
              <label className="block text-xs text-gray-400" htmlFor="conn-name">Connection name</label>
              <input id="conn-name" className={input} value={name} onChange={(e) => setName(e.target.value)} />
            </>
          )}
          <label className="block text-xs text-gray-400" htmlFor="conn-key">{provider.name} API key{simulator ? " (optional in simulator mode)" : ""}</label>
          <input id="conn-key" type="password" autoComplete="off" spellCheck={false} className={input} value={key} onChange={(e) => setKey(e.target.value)} />
          <p className="text-xs text-gray-500">The key is sent once over HTTPS, encrypted on the server and never shown again. It isn't stored in this browser. Your organization pays {provider.name} directly for usage.</p>
          {simulator && <p className="text-xs text-violet-300">Simulator mode: this connection uses the AI Provider Simulator — no external AI provider is contacted.</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </>
      )}
    </Modal>
  );
}

function RemoveDialog({ provider, connection, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [run, busy, error] = useAiAction();
  return (
    <Modal title={`Remove ${provider.name}`} onClose={onClose} footer={<>
      <button type="button" className={btn} onClick={onClose}>Cancel</button>
      <button type="button" className={btnDanger} disabled={busy} onClick={() => run(() => ai.removeConnection(connection._id, reason), onDone)}>Remove</button>
    </>}>
      <p className="text-sm text-gray-300">The stored key is revoked and AI features stop using {provider.name}. Revoke the key at {provider.name} too if it's no longer needed.</p>
      <label className="block text-xs text-gray-400" htmlFor="remove-reason">Reason</label>
      <textarea id="remove-reason" className={input} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </Modal>
  );
}
