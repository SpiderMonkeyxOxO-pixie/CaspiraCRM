import { useState } from "react";
import * as ai from "../../../Helpers/backendAiClient";
import { AiPage, Panel, Badge, ErrorBox, Loading, Table } from "./aiUi";
import { useAiLoad, useAiAction, btnPrimary, input } from "./aiKit";

// Backend-mode model catalog and aliases. Features ask for an alias (fast,
// balanced, deep, structured); each alias points at a model per provider.
export default function AiModelsBackend() {
  const { data, error, loading, reload } = useAiLoad(async () => {
    const [m, a, c] = await Promise.all([ai.listModels(), ai.listAliases(), ai.listConnections()]);
    return { models: m.models, aliases: a.aliases, allowed: a.allowedAliases, connections: c.connections, simulatorLabel: c.simulatorLabel };
  });
  const [edits, setEdits] = useState({});
  const [run, busy, actionError] = useAiAction();

  const providers = [...new Set((data?.aliases || []).map((a) => a.providerKey))];
  const optionsFor = (providerKey) => {
    const verified = data.connections.find((c) => c.providerKey === providerKey)?.verifiedModels || [];
    const catalog = data.models.filter((m) => m.providerKey === providerKey).map((m) => m.modelId);
    return [...new Set([...catalog, ...verified])].sort();
  };

  return (
    <AiPage title="Models" description="Features never name a model. They ask for an alias, and each alias points at a model your organization's key can use." simulatorLabel={data?.simulatorLabel}>
      <ErrorBox error={error || actionError} onRetry={error ? reload : undefined} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Panel title="Model aliases">
            <div className="space-y-4">
              {providers.map((pk) => {
                const conn = data.connections.find((c) => c.providerKey === pk);
                return (
                  <div key={pk}>
                    <p className="text-sm text-gray-200 mb-2">{pk} {conn ? <Badge>{conn.status}</Badge> : <Badge tone="gray">Not connected</Badge>}</p>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                      {data.allowed.map((alias) => {
                        const row = data.aliases.find((a) => a.providerKey === pk && a.alias === alias);
                        const key = `${pk}:${alias}`;
                        const value = edits[key] ?? row?.modelId ?? "";
                        const verified = (conn?.verifiedModels || []).includes(value);
                        return (
                          <div key={alias} className="bg-gray-900/60 border border-gray-800 rounded-lg p-2">
                            <label htmlFor={key} className="text-xs text-gray-400">{alias}</label>
                            <select id={key} className={input} value={value} onChange={(e) => setEdits({ ...edits, [key]: e.target.value })}>
                              {!value && <option value="">—</option>}
                              {optionsFor(pk).map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-[11px] text-gray-500">{conn ? (verified ? "Available to your key" : "Not verified for your key") : ""}</span>
                              {edits[key] && edits[key] !== row?.modelId && (
                                <button type="button" className={btnPrimary} disabled={busy} onClick={() => run(() => ai.setAlias(alias, pk, edits[key], row?.persisted ? row.version : undefined), () => { setEdits((e) => { const n = { ...e }; delete n[key]; return n; }); reload(); })}>Save</button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
          <Panel title="Model catalog">
            <Table rows={data.models} columns={[
              { label: "Provider", key: "providerKey" },
              { label: "Model", render: (m) => <span className="text-gray-200">{m.displayName}<br /><code className="text-[11px] text-gray-500">{m.modelId}</code></span> },
              { label: "Capabilities", render: (m) => (m.capabilities || []).join(", ") },
              { label: "Context", render: (m) => (m.contextWindow ? m.contextWindow.toLocaleString() : "—") },
              { label: "Your key", render: (m) => (m.availableToOrganization ? <Badge tone="green">Available</Badge> : <Badge tone="gray">Not verified</Badge>) },
            ]} />
          </Panel>
        </>
      )}
    </AiPage>
  );
}
