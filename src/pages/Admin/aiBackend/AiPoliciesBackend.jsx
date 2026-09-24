import { useEffect, useState } from "react";
import * as ai from "../../../Helpers/backendAiClient";
import { AiPage, Panel, ErrorBox, Loading, Modal } from "./aiUi";
import { useAiLoad, useAiAction, btn, btnPrimary, input } from "./aiKit";

const USE_CASES = [["overview.narrative", "AI Overview narrative"], ["overview.explore", "AI Overview explore"], ["action.proposal", "Suggest an action"], ["evaluation.run", "Evaluation runs"]];

// Backend-mode AI policy for the organization.
export default function AiPoliciesBackend() {
  const { data, error, loading, reload } = useAiLoad(async () => {
    const [p, prov, acts] = await Promise.all([ai.getPolicy(), ai.listProviders(), ai.listActions({ pageSize: 1 }).catch(() => ({ actionTypes: [], prohibited: [] }))]);
    return { ...p, providers: prov.providers.filter((x) => x.availability === "Adapter"), actionTypes: acts.actionTypes || [], prohibited: acts.prohibited || [], simulatorLabel: prov.simulatorLabel };
  });
  const [form, setForm] = useState(null);
  const [confirmRetention, setConfirmRetention] = useState(null);
  const [run, busy, actionError] = useAiAction();
  useEffect(() => { if (data) setForm(structuredClone(data.policy)); }, [data]);

  const toggleList = (k, v) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  const save = (extra = {}) => run(() => ai.updatePolicy({
    enabled: form.enabled, allowedProviders: form.allowedProviders, allowedUseCases: form.allowedUseCases, personalData: form.personalData,
    maxRequestsPerUserPerHour: Number(form.maxRequestsPerUserPerHour), actionApprovals: form.actionApprovals, retention: form.retention,
    providerStorage: form.providerStorage, providerMemory: form.providerMemory, ...extra, ...(data.policy.persisted && { version: data.policy.version }),
  }), () => { setConfirmRetention(null); reload(); });
  const turningOnRetention = form && ((form.providerStorage && !data.policy.providerStorage) || (form.providerMemory && !data.policy.providerMemory));

  return (
    <AiPage title="Policies" description="What AI may do in your organization. Restricted and secret data is never sent to any provider, whatever this policy says." simulatorLabel={data?.simulatorLabel}>
      <ErrorBox error={error || actionError} onRetry={error ? reload : undefined} />
      {loading && !form ? <Loading /> : form && (
        <>
          <Panel title="General">
            <label className="flex items-center gap-2 text-sm text-gray-200"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> AI features are enabled for this organization</label>
            <div className="grid md:grid-cols-2 gap-4 mt-3">
              <fieldset>
                <legend className="text-xs text-gray-400 mb-1">Allowed providers (none ticked = providers enabled by default)</legend>
                {data.providers.map((p) => <label key={p.key} className="flex items-center gap-2 text-sm text-gray-200"><input type="checkbox" checked={form.allowedProviders.includes(p.key)} onChange={() => toggleList("allowedProviders", p.key)} /> {p.name}{!p.enabledByDefault && <span className="text-[11px] text-gray-500">(off by default)</span>}</label>)}
              </fieldset>
              <fieldset>
                <legend className="text-xs text-gray-400 mb-1">Allowed AI features (none ticked = all)</legend>
                {USE_CASES.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm text-gray-200"><input type="checkbox" checked={form.allowedUseCases.includes(k)} onChange={() => toggleList("allowedUseCases", k)} /> {l}</label>)}
              </fieldset>
            </div>
            <div className="grid md:grid-cols-2 gap-4 mt-3">
              <div>
                <label htmlFor="pd" className="text-xs text-gray-400">Personal data sent to providers</label>
                <select id="pd" className={input} value={form.personalData} onChange={(e) => setForm({ ...form, personalData: e.target.value })}>
                  <option value="Mask">Mask (j***@example.com)</option><option value="Pseudonymize">Pseudonymize (stable code)</option><option value="Exclude">Exclude entirely</option>
                </select>
              </div>
              <div>
                <label htmlFor="rph" className="text-xs text-gray-400">AI requests per person per hour</label>
                <input id="rph" type="number" min={1} className={input} value={form.maxRequestsPerUserPerHour} onChange={(e) => setForm({ ...form, maxRequestsPerUserPerHour: e.target.value })} />
              </div>
            </div>
          </Panel>

          <Panel title="Provider-side storage and memory">
            <p className="text-xs text-gray-400 mb-2">Both are off by default: requests go out with provider storage disabled and no provider memory feature is used.</p>
            <label className="flex items-center gap-2 text-sm text-gray-200"><input type="checkbox" checked={form.providerStorage} onChange={(e) => setForm({ ...form, providerStorage: e.target.checked })} /> Let providers store requests</label>
            <label className="flex items-center gap-2 text-sm text-gray-200"><input type="checkbox" checked={form.providerMemory} onChange={(e) => setForm({ ...form, providerMemory: e.target.checked })} /> Allow provider memory features</label>
          </Panel>

          <Panel title="AI action approvals">
            <p className="text-xs text-gray-400 mb-2">Every AI action needs a person's confirmation. Ticked actions also need a different person with approval rights.</p>
            <div className="grid md:grid-cols-2 gap-1">
              {data.actionTypes.map((t) => (
                <label key={t.key} className="flex items-center gap-2 text-sm text-gray-200">
                  <input type="checkbox" checked={form.actionApprovals[t.key] ?? ["assign_owner", "create_deal"].includes(t.key)} onChange={(e) => setForm({ ...form, actionApprovals: { ...form.actionApprovals, [t.key]: e.target.checked } })} /> {t.label}
                </label>
              ))}
            </div>
            {data.prohibited.length > 0 && <p className="text-xs text-gray-500 mt-3">Never done through AI: {data.prohibited.map((p) => p.what.toLowerCase()).join(", ")}.</p>}
          </Panel>

          <Panel title="Retention">
            <div className="grid sm:grid-cols-3 gap-2">
              {[["requestPayloadDays", "Redacted request snapshots (days)"], ["evaluationDays", "Evaluation results (days)"], ["feedbackDays", "Feedback (days)"], ["providerMetadataDays", "Provider request metadata (days)"]].map(([k, l]) => (
                <div key={k}><label htmlFor={k} className="text-xs text-gray-400">{l}</label><input id={k} type="number" min={1} className={input} value={form.retention[k]} onChange={(e) => setForm({ ...form, retention: { ...form.retention, [k]: Number(e.target.value) } })} /></div>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-2">Usage records and audit events are kept.</p>
          </Panel>

          <div className="flex gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => (turningOnRetention ? setConfirmRetention(true) : save())}>Save policy</button>
            <button type="button" className={btn} onClick={() => setForm(structuredClone(data.policy))}>Discard changes</button>
          </div>
        </>
      )}
      {confirmRetention && (
        <Modal title="Let the provider keep CRM data?" onClose={() => setConfirmRetention(null)} footer={<>
          <button type="button" className={btn} onClick={() => setConfirmRetention(null)}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => save({ confirmProviderRetention: true })}>Yes, turn it on</button>
        </>}>
          <p className="text-sm text-gray-300">With this on, the provider may retain the data sent in AI requests under its own terms. Restricted and secret data is still never sent.</p>
        </Modal>
      )}
    </AiPage>
  );
}
