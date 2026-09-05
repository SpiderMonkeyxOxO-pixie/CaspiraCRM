import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { ShieldAlert, Eye, Layers } from "lucide-react";
import { fetchAiRedactionRules, fetchAiContextAssemblyPreview, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { canViewAiRedactionPreview, canViewAiSensitiveContext } from "./aiProvidersConfig";
import { AI_ALWAYS_EXCLUDED_CLASSIFICATIONS, REDACTION_EXAMPLES, AI_USE_CASES } from "../../Helpers/mockAiProvidersData";
import { ORGANIZATIONS, DEFAULT_ORGANIZATION_ID } from "../../Helpers/mockAccessData";

export default function AiPrivacyConfig() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { aiRedactionRules, currentAiContextAssemblyPreview, loading, error } = useSelector(selectIntegrations);
  const [selectedUseCaseId, setSelectedUseCaseId] = useState(AI_USE_CASES[0]?.id || "");

  useEffect(() => {
    if (canViewAiRedactionPreview(role)) dispatch(fetchAiRedactionRules());
  }, [dispatch, role]);

  useEffect(() => {
    if (selectedUseCaseId && canViewAiSensitiveContext(role)) {
      dispatch(fetchAiContextAssemblyPreview({ useCaseId: selectedUseCaseId, organizationId: ORGANIZATIONS[0]?.id || DEFAULT_ORGANIZATION_ID }));
    }
  }, [dispatch, role, selectedUseCaseId]);

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/ai-providers" className="hover:text-gray-300">AI Providers</Link>{" "}
        <span>/</span> <span className="text-gray-300">Privacy</span>
      </div>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-white">Privacy and Data Protection</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <p className="text-sm text-gray-400 mt-1 max-w-2xl">
          Every data classification below has a fixed redaction rule. <span className="text-gray-300 font-medium">Credentials and Secrets</span>{" "}
          is always excluded from any AI request — no policy, including an Organization Administrator's, can override this.
        </p>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading privacy configuration…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <section>
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><ShieldAlert size={14} className="text-red-400" /> Data Classifications and Redaction Rules</h2>
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Classification</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Reason</th>
              </tr>
            </thead>
            <tbody>
              {aiRedactionRules.map((r) => (
                <tr key={r.classification} className="border-b border-gray-800/60 last:border-0" data-testid={`classification-row-${r.classification}`}>
                  <td className="px-4 py-3 text-gray-200">
                    {r.classification}
                    {AI_ALWAYS_EXCLUDED_CLASSIFICATIONS.includes(r.classification) && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-red-500/15 text-red-300 border border-red-500/30">Always Excluded</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{r.action}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><Eye size={14} className="text-blue-400" /> Redaction Preview</h2>
        <p className="text-xs text-gray-500 mb-2">Fixed, safe example values only — never real record data.</p>
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Example</th>
                <th className="px-4 py-3">Rule</th>
                <th className="px-4 py-3">Output</th>
              </tr>
            </thead>
            <tbody>
              {REDACTION_EXAMPLES.map((ex) => (
                <tr key={ex.original} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-xs text-gray-500">{ex.original}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{ex.rule}</td>
                  <td className="px-4 py-3 text-gray-200">{ex.output}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canViewAiSensitiveContext(role) && (
        <section>
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5"><Layers size={14} className="text-blue-400" /> Context Assembly Preview</h2>
          <label htmlFor="context-use-case" className="block text-[11px] text-gray-500 uppercase mb-1">Use Case</label>
          <select id="context-use-case" value={selectedUseCaseId} onChange={(e) => setSelectedUseCaseId(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white mb-3">
            {AI_USE_CASES.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>

          {currentAiContextAssemblyPreview && (
            <div className="grid md:grid-cols-3 gap-3">
              <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
                <p className="text-[11px] text-gray-500 uppercase mb-2">Included Fields</p>
                <ul className="space-y-1 text-xs text-gray-300">
                  {currentAiContextAssemblyPreview.includedFields.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </div>
              <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
                <p className="text-[11px] text-gray-500 uppercase mb-2">Redacted Fields</p>
                <ul className="space-y-1 text-xs text-amber-300">
                  {currentAiContextAssemblyPreview.redactedFields.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </div>
              <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3">
                <p className="text-[11px] text-gray-500 uppercase mb-2">Excluded Before Assembly</p>
                <ul className="space-y-1 text-xs text-gray-500">
                  {currentAiContextAssemblyPreview.excludedFields.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-2">Unauthorized records are excluded before context assembly, not filtered afterward. This preview never reveals the existence or count of any hidden record.</p>
        </section>
      )}
    </div>
  );
}
