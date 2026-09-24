import { useId, useState } from "react";
import * as ai from "../../../Helpers/backendAiClient";
import { AiPage, Panel, Badge, ErrorBox, Loading } from "./aiUi";
import { useAiLoad, useAiAction, btn, btnPrimary, input } from "./aiKit";

// Backend-mode routing and use-case settings: which provider and alias
// serve each AI feature, an optional fallback, and each feature's limits.
export default function AiRoutingBackend() {
  const { data, error, loading, reload } = useAiLoad(async () => {
    const [r, u, p] = await Promise.all([ai.listRouting(), ai.listUseCases(), ai.listProviders()]);
    return { routing: r.routingPolicies, useCases: u.useCases, providers: p.providers.filter((x) => x.availability === "Adapter" && x.allowedByPolicy), simulatorLabel: p.simulatorLabel };
  });
  const [run, busy, actionError] = useAiAction();

  return (
    <AiPage title="Routing" description="Each AI feature uses one provider and model alias. A fallback is used only when the primary is unavailable and your policy allows that provider to receive the same kinds of data." simulatorLabel={data?.simulatorLabel}>
      <ErrorBox error={error || actionError} onRetry={error ? reload : undefined} />
      {loading && !data ? <Loading /> : data && data.useCases.map((uc) => (
        <UseCaseCard key={uc.key} uc={uc} routing={data.routing.find((r) => r.useCaseKey === uc.key)} providers={data.providers} busy={busy} run={run} reload={reload} />
      ))}
    </AiPage>
  );
}

function UseCaseCard({ uc, routing, providers, busy, run, reload }) {
  const [r, setR] = useState({ primaryProviderKey: routing?.primaryProviderKey || "", primaryAlias: routing?.primaryAlias || uc.defaultAlias, fallbackProviderKey: routing?.fallbackProviderKey || "", fallbackAlias: routing?.fallbackAlias || uc.defaultAlias });
  const [u, setU] = useState({ enabled: uc.enabled, maxInputChars: uc.maxInputChars, maxOutputTokens: uc.maxOutputTokens, streamingAllowed: uc.streamingAllowed, allowedAliases: uc.allowedAliases });
  const saveRouting = () => run(() => ai.setRouting(uc.key, { ...r, fallbackProviderKey: r.fallbackProviderKey || null, ...(routing?.persisted && { version: routing.version }) }), reload);
  const saveUseCase = () => run(() => ai.updateUseCase(uc.key, { ...u, ...(uc.persisted && { version: uc.version }) }), reload);
  const reserved = !!uc.reserved;
  return (
    <Panel title={uc.label} actions={reserved ? <Badge tone="gray">Reserved for Phase 10</Badge> : <Badge tone={uc.enabled ? "green" : "gray"}>{uc.enabled ? "On" : "Off"}</Badge>}>
      <div className="grid lg:grid-cols-2 gap-4">
        <fieldset disabled={reserved} className="space-y-2">
          <legend className="text-xs text-gray-400 mb-1">Routing {routing && !routing.persisted && <span className="text-gray-500">(default)</span>}</legend>
          <div className="grid grid-cols-2 gap-2">
            <Select label="Primary provider" value={r.primaryProviderKey} onChange={(v) => setR({ ...r, primaryProviderKey: v })} options={["", ...providers.map((p) => p.key)]} />
            <Select label="Alias" value={r.primaryAlias} onChange={(v) => setR({ ...r, primaryAlias: v })} options={uc.allowedAliases} />
            <Select label="Fallback provider" value={r.fallbackProviderKey} onChange={(v) => setR({ ...r, fallbackProviderKey: v })} options={["", ...providers.map((p) => p.key).filter((k) => k !== r.primaryProviderKey)]} />
            <Select label="Fallback alias" value={r.fallbackAlias} onChange={(v) => setR({ ...r, fallbackAlias: v })} options={uc.allowedAliases} />
          </div>
          <button type="button" className={btnPrimary} disabled={busy || !r.primaryProviderKey} onClick={saveRouting}>Save routing</button>
        </fieldset>
        <fieldset disabled={reserved} className="space-y-2">
          <legend className="text-xs text-gray-400 mb-1">Limits</legend>
          <label className="flex items-center gap-2 text-sm text-gray-200"><input type="checkbox" checked={u.enabled} onChange={(e) => setU({ ...u, enabled: e.target.checked })} /> Feature enabled</label>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Max input (characters)" value={u.maxInputChars} onChange={(v) => setU({ ...u, maxInputChars: v })} />
            <Num label="Max output (tokens)" value={u.maxOutputTokens} onChange={(v) => setU({ ...u, maxOutputTokens: v })} />
          </div>
          <fieldset className="flex flex-wrap gap-3 text-sm text-gray-200">
            <legend className="text-xs text-gray-400">Allowed aliases</legend>
            {["fast", "balanced", "deep", "structured"].map((a) => (
              <label key={a} className="flex items-center gap-1"><input type="checkbox" checked={u.allowedAliases.includes(a)} onChange={(e) => setU({ ...u, allowedAliases: e.target.checked ? [...u.allowedAliases, a] : u.allowedAliases.filter((x) => x !== a) })} /> {a}</label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-gray-200"><input type="checkbox" checked={u.streamingAllowed} onChange={(e) => setU({ ...u, streamingAllowed: e.target.checked })} /> Allow streaming (drafts are replaced by the validated answer)</label>
          <p className="text-[11px] text-gray-500">Data sent: {uc.allowedClassifications.join(", ")}. Restricted and secret data is never sent.</p>
          <button type="button" className={btn} disabled={busy || !u.allowedAliases.length} onClick={saveUseCase}>Save limits</button>
        </fieldset>
      </div>
    </Panel>
  );
}

function Select({ label, value, onChange, options }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs text-gray-400">{label}</label>
      <select id={id} className={input} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o || "none"} value={o}>{o || "— none —"}</option>)}
      </select>
    </div>
  );
}

function Num({ label, value, onChange }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs text-gray-400">{label}</label>
      <input id={id} type="number" min={100} className={input} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
