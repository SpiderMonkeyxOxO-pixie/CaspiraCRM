import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { fetchAiModelAliases, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { findProvider } from "../../Helpers/mockIntegrationsData";

export default function AiModelCatalog() {
  const dispatch = useDispatch();
  const { aiModelAliases, loading, error } = useSelector(selectIntegrations);

  useEffect(() => { dispatch(fetchAiModelAliases()); }, [dispatch]);

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/ai-providers" className="hover:text-gray-300">AI Providers</Link>{" "}
        <span>/</span> <span className="text-gray-300">Models</span>
      </div>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-white">Model Catalog</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <p className="text-sm text-gray-400 mt-1 max-w-2xl">
          Models are referenced by provider-neutral alias — never by a hard-coded model name — so a use case or routing
          policy stays stable even if the underlying model changes. No cost figure below is an exact price; each is a
          classification only.
        </p>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading model catalog…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Alias</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Capabilities</th>
                <th className="px-4 py-3">Context</th>
                <th className="px-4 py-3">Input / Output</th>
                <th className="px-4 py-3">Cost Classification</th>
                <th className="px-4 py-3">Latency</th>
                <th className="px-4 py-3">Data Policy Compatibility</th>
                <th className="px-4 py-3">Evaluation Status</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {aiModelAliases.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-500 text-xs">No model aliases to preview yet.</td></tr>
              ) : aiModelAliases.map((m) => (
                <tr key={m.alias} className="border-b border-gray-800/60 last:border-0 align-top">
                  <td className="px-4 py-3 text-gray-200 font-medium" data-testid="model-alias">{m.alias}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{findProvider(m.providerKey)?.name || m.providerKey}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{m.capabilities.join(", ")}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{m.contextLimitReference}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{m.inputTypes.join("/")} → {m.outputTypes.join("/")}</td>
                  <td className="px-4 py-3 text-xs text-gray-300">{m.costClassification}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{m.latencyClassification}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{m.dataPolicyCompatibility.join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-[11px]">
                    <span className={m.evaluationStatus === "Passed" ? "text-emerald-400" : "text-gray-500"}>{m.evaluationStatus}</span>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-gray-300">{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
