import { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, MinusCircle, PlayCircle } from "lucide-react";
import { fetchAiEvaluationScenarios, runAiEvaluationScenarioPreview, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { canRunAiEvaluationPreview } from "./aiProvidersConfig";
import { AI_USE_CASES } from "../../Helpers/mockAiProvidersData";

function formatDate(iso) {
  if (!iso) return "Not yet run";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function getUseCaseLabel(id) {
  return AI_USE_CASES.find((u) => u.id === id)?.label || id;
}
const RESULT_ICON = { Pass: <CheckCircle2 size={14} className="text-emerald-400" />, Fail: <XCircle size={14} className="text-red-400" />, "Not Evaluated": <MinusCircle size={14} className="text-gray-500" /> };

export default function AiEvaluationsList() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { aiEvaluationScenarios, loading, error } = useSelector(selectIntegrations);

  useEffect(() => { dispatch(fetchAiEvaluationScenarios()); }, [dispatch]);

  const byMetric = useMemo(() => {
    const map = {};
    aiEvaluationScenarios.forEach((s) => { (map[s.metric] ||= []).push(s); });
    return map;
  }, [aiEvaluationScenarios]);

  const runScenario = (id) => dispatch(runAiEvaluationScenarioPreview(id));

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/ai-providers" className="hover:text-gray-300">AI Providers</Link>{" "}
        <span>/</span> <span className="text-gray-300">Evaluations</span>
      </div>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-white">Evaluations</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <p className="text-sm text-gray-400 mt-1 max-w-2xl">
          Fixture-based evaluation scenarios, including prompt-injection resistance and cross-organization leakage
          checks. Every scenario runs against fixed inputs — never a real provider response.
        </p>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading evaluation scenarios…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && Object.entries(byMetric).map(([metric, scenarios]) => (
        <section key={metric}>
          <h2 className="text-sm font-semibold text-white mb-3">{metric}</h2>
          <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                  <th className="px-4 py-3">Scenario</th>
                  <th className="px-4 py-3">Use Case</th>
                  <th className="px-4 py-3">Expected Behavior</th>
                  <th className="px-4 py-3">Result</th>
                  <th className="px-4 py-3">Last Run</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s) => (
                  <tr key={s.id} className="border-b border-gray-800/60 last:border-0 align-top">
                    <td className="px-4 py-3 text-gray-200">{s.scenario}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{getUseCaseLabel(s.useCaseId)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-xs">{s.expectedBehavior}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-[11px] text-gray-300">{RESULT_ICON[s.result]} {s.result}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(s.lastRun)}</td>
                    <td className="px-4 py-3 text-right">
                      {canRunAiEvaluationPreview(role) && (
                        <button onClick={() => runScenario(s.id)} className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white ml-auto">
                          <PlayCircle size={13} /> Run Preview
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
