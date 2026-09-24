import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { X, ShieldAlert, ShieldCheck, CheckCircle2, Lock } from "lucide-react";
import useFocusTrap from "../../hooks/useFocusTrap";
import { createConnectionPreview, setWizardDraft, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canCreateConnections } from "./integrationsConfig";
import {
  SYNC_DIRECTIONS, CONFLICT_RULES, PREVIEW_CONNECTION_COMPLETE_MESSAGE,
  FRONTEND_CONNECTION_PREVIEW_LABEL, FRONTEND_CONNECTION_PREVIEW_EXPLANATION,
} from "../../Helpers/mockIntegrationsData";
import { BACKEND_ENABLED } from "../../Helpers/integrationsBackend";

const STEPS = [
  "Provider Overview", "Organization", "Capabilities", "Permissions", "Data Scope",
  "Sync Direction", "Field Mapping", "Notifications", "Security Review", "Confirmation",
];

const DATA_SCOPES = ["Organization", "Selected Users", "Selected Teams"];

// Multi-step frontend-only "Preview Setup" workflow. Nothing here contacts a
// real provider, exchanges a real OAuth token, or stores a real credential —
// see mockIntegrationsData.js's header comment for the full scope statement.
export default function PreviewConnectionWizard({ provider, actingRole, organizations, onClose, onCompleted }) {
  const dispatch = useDispatch();
  const { wizardDraft } = useSelector(selectIntegrations);
  const containerRef = useFocusTrap(true, onClose);

  const owner = isSystemOwner(actingRole);
  const fixedOrganizationId = !owner ? organizations[0]?.id || "" : "";
  const draftForThisProvider = wizardDraft?.providerKey === provider.key ? wizardDraft : null;

  const [step, setStep] = useState(draftForThisProvider?.step ?? 0);
  const [organizationId, setOrganizationId] = useState(draftForThisProvider?.organizationId ?? fixedOrganizationId);
  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState(draftForThisProvider?.selectedCapabilityIds ?? provider.capabilities.filter((c) => !c.unavailableReason).map((c) => c.id));
  const [dataScope, setDataScope] = useState(draftForThisProvider?.dataScope ?? "Organization");
  const [syncDirection, setSyncDirection] = useState(draftForThisProvider?.syncDirection ?? "Bidirectional");
  const [conflictRule, setConflictRule] = useState(draftForThisProvider?.conflictRule ?? "Most Recently Updated Wins");
  const [notifyOnFailure, setNotifyOnFailure] = useState(draftForThisProvider?.notifyOnFailure ?? true);
  const [notifyOnSuccess, setNotifyOnSuccess] = useState(draftForThisProvider?.notifyOnSuccess ?? false);
  const [securityAcknowledged, setSecurityAcknowledged] = useState(draftForThisProvider?.securityAcknowledged ?? false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!owner && fixedOrganizationId && organizationId !== fixedOrganizationId) setOrganizationId(fixedOrganizationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, fixedOrganizationId]);

  useEffect(() => {
    if (result) return;
    dispatch(setWizardDraft({
      providerKey: provider.key, step, organizationId, selectedCapabilityIds, dataScope,
      syncDirection, conflictRule, notifyOnFailure, notifyOnSuccess, securityAcknowledged,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, organizationId, selectedCapabilityIds, dataScope, syncDirection, conflictRule, notifyOnFailure, notifyOnSuccess, securityAcknowledged]);

  const selectedCapabilities = useMemo(
    () => provider.capabilities.filter((c) => selectedCapabilityIds.includes(c.id)),
    [provider, selectedCapabilityIds]
  );
  const requiredPermissions = useMemo(
    () => [...new Set(selectedCapabilities.map((c) => c.requiredPermission))],
    [selectedCapabilities]
  );
  const hasSensitiveCapability = selectedCapabilities.some((c) => c.sensitiveData);
  const hasApprovalCapability = selectedCapabilities.some((c) => c.requiresHumanApproval);

  const toggleCapability = (id) => {
    setSelectedCapabilityIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const canGoNext = () => {
    if (step === 1) return !!organizationId;
    if (step === 2) return selectedCapabilityIds.length > 0;
    if (step === 8) return securityAcknowledged;
    return true;
  };

  const goNext = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const handleComplete = async () => {
    setCreating(true);
    setCreateError(null);
    const action = await dispatch(createConnectionPreview({
      providerKey: provider.key,
      organizationId,
      capabilities: selectedCapabilityIds,
      dataScope,
      syncConfiguration: { direction: syncDirection, entityMappings: [], scheduleFrequency: "Manual", notifyOnFailure, notifyOnSuccess },
      fieldMappings: [],
    }));
    setCreating(false);
    if (createConnectionPreview.rejected.match(action)) {
      setCreateError(typeof action.payload === "string" ? action.payload : action.payload?.error || "Failed to create the preview connection.");
      return;
    }
    // Backend mode: the provider's own sign-in page grants access; the
    // backend then returns the browser to the new connection.
    if (BACKEND_ENABLED && action.payload?.authorizationUrl) {
      window.location.assign(action.payload.authorizationUrl);
      return;
    }
    setResult(action.payload);
    setStep(STEPS.length - 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-connection-wizard-title"
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[#0f1119] border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-[#0f1119] border-b border-gray-800 px-6 py-4 flex items-center justify-between z-10">
          <h2 id="preview-connection-wizard-title" className="text-lg font-bold text-white">Preview Setup — {provider.name}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-300 rounded-lg p-1"><X size={18} /></button>
        </div>

        <nav aria-label="Preview connection wizard steps" className="flex gap-1 px-6 pt-4 overflow-x-auto">
          {STEPS.map((label, i) => (
            <div key={label} aria-current={step === i ? "step" : undefined}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap ${
                step === i ? "bg-blue-600 text-white" : i < step ? "text-emerald-400" : "text-gray-500"
              }`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" /> {label}
            </div>
          ))}
        </nav>

        <div className="p-6 space-y-4">
          {step === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-300">{provider.longDescription}</p>
              <p className="text-xs text-gray-500">Authentication method: <span className="text-gray-300">{provider.authMethod}</span></p>
              <p className="text-xs text-gray-500">Provider plan: <span className="text-gray-300">{provider.pricingClassification}</span></p>
              {BACKEND_ENABLED ? (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
                  <p className="text-xs text-blue-200 font-medium">{provider.simulatorLabel || `You'll sign in at ${provider.name} to grant access.`}</p>
                  <p className="text-[11px] text-blue-100/80 mt-1">Only the permissions the selected capabilities need are requested. Tokens are encrypted on the server and never reach this browser.</p>
                  {provider.statusMessage && <p className="text-[11px] text-amber-200 mt-1">{provider.statusMessage}</p>}
                </div>
              ) : (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
                  <p className="text-xs text-blue-200 font-medium">{FRONTEND_CONNECTION_PREVIEW_LABEL}</p>
                  <p className="text-[11px] text-blue-100/80 mt-1">{FRONTEND_CONNECTION_PREVIEW_EXPLANATION}</p>
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div>
              <label htmlFor="wizard-org" className="block text-xs text-gray-400 mb-1">Organization</label>
              {owner ? (
                <select id="wizard-org" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Select an organization</option>
                  {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ) : (
                <p className="text-sm text-gray-300">{organizations.find((o) => o.id === fixedOrganizationId)?.name || "Your organization"}</p>
              )}
              <p className="text-[11px] text-gray-500 mt-2">This preview connection will belong to the selected organization only.</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-2">
              <p className="text-sm text-gray-400 mb-2">Choose which capabilities to include in this preview.</p>
              {provider.capabilities.map((c) => (
                <label key={c.id} className="flex items-start gap-2 border border-gray-800 rounded-lg p-3 cursor-pointer">
                  <input type="checkbox" checked={selectedCapabilityIds.includes(c.id)} onChange={() => toggleCapability(c.id)} disabled={!!c.unavailableReason} className="mt-0.5" />
                  <span>
                    <span className="text-sm text-white block">{c.name}</span>
                    <span className="text-[11px] text-gray-500">{c.crmModule} · {c.direction}</span>
                    {c.sensitiveData && <span className="text-[11px] text-amber-300 flex items-center gap-1 mt-0.5"><ShieldAlert size={11} /> Involves sensitive data</span>}
                    {c.requiresHumanApproval && <span className="text-[11px] text-blue-300 flex items-center gap-1 mt-0.5"><ShieldCheck size={11} /> Requires human approval</span>}
                    {c.unavailableReason && <span className="text-[11px] text-gray-500 block mt-0.5">{c.unavailableReason}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-2">
              <p className="text-sm text-gray-400 mb-2">These permissions are required for the capabilities you selected.</p>
              <ul className="space-y-1.5">
                {requiredPermissions.map((perm) => (
                  <li key={perm} className="flex items-center gap-2 text-sm text-gray-300 font-mono"><Lock size={13} className="text-gray-500" /> {perm}</li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-500">This follows the principle of least privilege — only permissions needed for the selected capabilities are requested.</p>
            </div>
          )}

          {step === 4 && (
            <div>
              <label htmlFor="wizard-scope" className="block text-xs text-gray-400 mb-1">CRM data scope</label>
              <select id="wizard-scope" value={dataScope} onChange={(e) => setDataScope(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                {DATA_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <p className="text-[11px] text-gray-500 mt-2">Controls which CRM records this preview connection may reference.</p>
            </div>
          )}

          {step === 5 && (
            <div>
              <label htmlFor="wizard-direction" className="block text-xs text-gray-400 mb-1">Synchronization direction</label>
              <select id="wizard-direction" value={syncDirection} onChange={(e) => setSyncDirection(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                {SYNC_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">Supported CRM entities for {provider.name}:</p>
              <div className="flex flex-wrap gap-1.5">
                {provider.supportedModules.map((m) => <span key={m} className="text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-300">{m}</span>)}
              </div>
              <div>
                <label htmlFor="wizard-conflict" className="block text-xs text-gray-400 mb-1">Default conflict rule</label>
                <select id="wizard-conflict" value={conflictRule} onChange={(e) => setConflictRule(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                  {CONFLICT_RULES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <p className="text-[11px] text-gray-500">Detailed field-level mapping can be configured after the preview connection is created, from the connection's Data Mapping tab.</p>
            </div>
          )}

          {step === 7 && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-200">
                <input type="checkbox" checked={notifyOnFailure} onChange={(e) => setNotifyOnFailure(e.target.checked)} />
                Notify me when a preview synchronization fails
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-200">
                <input type="checkbox" checked={notifyOnSuccess} onChange={(e) => setNotifyOnSuccess(e.target.checked)} />
                Notify me when a preview synchronization succeeds
              </label>
            </div>
          )}

          {step === 8 && (
            <div className="space-y-3">
              <ul className="text-sm text-gray-300 space-y-1.5">
                <li>Least-privilege permissions: only {requiredPermissions.length} permission(s) will be requested.</li>
                <li>Organization isolation: this connection will only ever reference data in the selected organization.</li>
                <li>Data leaving the CRM: {provider.dataLeavingCrm.join("; ")}</li>
                <li>Data entering the CRM: {provider.dataEnteringCrm.join("; ")}</li>
                {hasSensitiveCapability && <li className="text-amber-300 flex items-start gap-1.5"><ShieldAlert size={13} className="mt-0.5 shrink-0" /> One or more selected capabilities involve sensitive data.</li>}
                {hasApprovalCapability && <li className="text-blue-300 flex items-start gap-1.5"><ShieldCheck size={13} className="mt-0.5 shrink-0" /> One or more selected capabilities require human approval before acting.</li>}
                <li>Your organization owns the {provider.name} account — subscriptions and usage charges are paid directly to {provider.name}.</li>
                {BACKEND_ENABLED ? (
                  <>
                    <li>No credential is stored in this browser. Tokens are encrypted and kept on the server.</li>
                    <li>Nothing is synchronized until you set it up and confirm a preview. Disconnecting revokes access and stops all synchronization.</li>
                  </>
                ) : (
                  <>
                    <li>No credential is stored in this browser. Credentials will eventually be encrypted and stored on the backend.</li>
                    <li>Disconnecting later will stop all preview synchronization for this connection; it can be undone during the same session.</li>
                  </>
                )}
              </ul>
              <label className="flex items-start gap-2 text-sm text-gray-200 border-t border-gray-800 pt-3">
                <input type="checkbox" checked={securityAcknowledged} onChange={(e) => setSecurityAcknowledged(e.target.checked)} className="mt-0.5" />
                I have reviewed the security and access implications of this preview connection.
              </label>
            </div>
          )}

          {step === 9 && !result && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">Review your selections, then complete the preview connection.</p>
              <ReviewRow label="Organization" value={organizations.find((o) => o.id === organizationId)?.name || organizationId} />
              <ReviewRow label="Capabilities" value={`${selectedCapabilityIds.length} selected`} />
              <ReviewRow label="Data scope" value={dataScope} />
              <ReviewRow label="Sync direction" value={syncDirection} />
              {createError && <p className="text-xs text-red-400">{createError}</p>}
            </div>
          )}

          {step === 9 && result && (
            <div className="text-center py-6">
              <CheckCircle2 size={36} className="mx-auto text-emerald-400 mb-3" />
              <p className="text-white font-semibold mb-1">{PREVIEW_CONNECTION_COMPLETE_MESSAGE}</p>
              <p className="text-xs text-gray-500">{FRONTEND_CONNECTION_PREVIEW_EXPLANATION}</p>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-[#0f1119] border-t border-gray-800 px-6 py-4 flex items-center justify-between">
          {result ? (
            <>
              <span />
              <button onClick={() => onCompleted?.(result.connection)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Done</button>
            </>
          ) : (
            <>
              <button onClick={step === 0 ? onClose : goBack} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">
                {step === 0 ? "Cancel" : "Back"}
              </button>
              {step < STEPS.length - 1 ? (
                <button onClick={goNext} disabled={!canGoNext()} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  Continue
                </button>
              ) : (
                <button onClick={handleComplete} disabled={creating || !canCreateConnections(actingRole)} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  {BACKEND_ENABLED ? `Continue to ${provider.name} sign-in` : "Complete Preview Connection"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm border-b border-gray-800/60 pb-2">
      <span className="text-gray-400">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}
