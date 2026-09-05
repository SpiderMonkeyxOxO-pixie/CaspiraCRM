import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { Sparkles, Bot, Gem, Cloud, HardDrive, Plus, Pause, Play, ShieldAlert } from "lucide-react";
import {
  fetchOrganizations, fetchAiProviderConnections, createAiProviderConnectionPreview,
  pauseAiProviderConnectionPreview, selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canCreateProviderConnectionPreview, canPauseProviderConnection } from "./aiProvidersConfig";
import { PHASE7_PROVIDERS } from "../../Helpers/mockAiProvidersData";
import ActionPreviewModal from "./ActionPreviewModal";

const PROVIDER_ICONS = { Sparkles, Bot, Gem, Cloud, HardDrive };

function ProviderIcon({ name, ...props }) {
  const Icon = PROVIDER_ICONS[name] || Sparkles;
  return <Icon {...props} />;
}

function emptyDraft() {
  return {
    providerKey: PHASE7_PROVIDERS[0].key,
    connectionModel: "Organization-Managed",
    permittedCapabilities: [],
    permittedCrmModules: ["Deals"],
  };
}

export default function AiProviderConnectionList() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, aiProviderConnections, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [pauseTarget, setPauseTarget] = useState(null);

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);
  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchAiProviderConnections(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const connectionByProvider = useMemo(() => {
    const map = {};
    aiProviderConnections.forEach((c) => { if (!map[c.providerKey]) map[c.providerKey] = c; });
    return map;
  }, [aiProviderConnections]);

  const startWizard = () => { setDraft(emptyDraft()); setWizardOpen(true); };
  const activeProvider = draft && PHASE7_PROVIDERS.find((p) => p.key === draft.providerKey);
  const toggleCapability = (id) => {
    setDraft((d) => ({
      ...d,
      permittedCapabilities: d.permittedCapabilities.includes(id)
        ? d.permittedCapabilities.filter((c) => c !== id)
        : [...d.permittedCapabilities, id],
    }));
  };

  const confirmWizard = async () => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    const result = await dispatch(createAiProviderConnectionPreview({ ...draft, organizationId: selectedOrgId || organizations[0]?.id }));
    if (createAiProviderConnectionPreview.fulfilled.match(result)) {
      setWizardOpen(false);
      setDraft(null);
      dispatch(fetchAiProviderConnections(filters));
    }
  };

  const startPauseToggle = (connection) => setPauseTarget(connection);
  const confirmPauseToggle = async () => {
    if (!pauseTarget) return;
    const paused = pauseTarget.state !== "Preview Paused";
    await dispatch(pauseAiProviderConnectionPreview({ connectionId: pauseTarget.id, paused }));
    setPauseTarget(null);
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchAiProviderConnections(filters));
  };

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/ai-providers" className="hover:text-gray-300">AI Providers</Link>{" "}
        <span>/</span> <span className="text-gray-300">Providers</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Provider Connections</h1>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Every connection below is an <span className="text-gray-300 font-medium">AI Provider Connection Preview</span> —
            no provider account is ever contacted and no credential is ever stored. The connection model defaults to{" "}
            <span className="text-gray-300 font-medium">Organization-Managed</span> ("bring your own provider account");
            a Platform-Managed option is shown only as a future, non-selectable possibility.
          </p>
          {!owner && orgLabel && <p className="text-xs text-gray-500 mt-1">Organization: <span className="text-gray-300">{orgLabel}</span></p>}
        </div>
        <div className="flex items-center gap-2">
          {owner && (
            <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" aria-label="Organization">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          {canCreateProviderConnectionPreview(role) && (
            <button onClick={startWizard} className="flex items-center gap-1.5 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-2">
              <Plus size={14} /> Preview Provider Setup
            </button>
          )}
        </div>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading provider previews…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {PHASE7_PROVIDERS.map((p) => {
            const conn = connectionByProvider[p.key];
            return (
              <div key={p.key} className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <ProviderIcon name={p.icon} size={18} className="text-blue-400" />
                  <h2 className="text-sm font-semibold text-white">{p.name}</h2>
                </div>
                <p className="text-xs text-gray-400">{p.shortDescription}</p>
                <div className="flex flex-wrap gap-1.5">
                  {p.capabilities.slice(0, 4).map((c) => (
                    <span key={c.id} className="px-2 py-0.5 rounded-full text-[10px] bg-gray-800 text-gray-300 border border-gray-700">{c.name}</span>
                  ))}
                </div>
                <div className="mt-auto pt-2 border-t border-gray-800 flex items-center justify-between">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${conn ? "bg-blue-500/15 text-blue-300 border-blue-500/30" : "bg-gray-800 text-gray-400 border-gray-700"}`}>
                    {conn ? conn.state : "Not Configured"}
                  </span>
                  {conn && canPauseProviderConnection(role) && ["Preview Configured", "Preview Paused"].includes(conn.state) && (
                    <button onClick={() => startPauseToggle(conn)} title={conn.state === "Preview Paused" ? "Resume Preview" : "Pause Preview"} className="text-gray-400 hover:text-white">
                      {conn.state === "Preview Paused" ? <Play size={15} /> : <Pause size={15} />}
                    </button>
                  )}
                </div>
                {conn?.lastError && (
                  <p className="flex items-start gap-1.5 text-[11px] text-amber-300"><ShieldAlert size={13} className="mt-0.5 shrink-0" /> {conn.lastError}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pauseTarget && (
        <ActionPreviewModal
          title={pauseTarget.state === "Preview Paused" ? "Resume Provider Connection Preview" : "Pause Provider Connection Preview"}
          actionLabel={`${pauseTarget.state === "Preview Paused" ? "Resume" : "Pause"} the ${PHASE7_PROVIDERS.find((p) => p.key === pauseTarget.providerKey)?.name} connection preview`}
          details={[{ label: "Current State", value: pauseTarget.state }]}
          confirmLabel={pauseTarget.state === "Preview Paused" ? "Resume Preview" : "Pause Preview"}
          onConfirm={confirmPauseToggle}
          onCancel={() => setPauseTarget(null)}
          previewNotice="This updates preview state only. No provider account is contacted."
        />
      )}

      {wizardOpen && draft && (
        <ActionPreviewModal
          title="Preview Provider Setup"
          actionLabel="Complete AI Provider Preview"
          details={[]}
          confirmLabel="Complete AI Provider Preview"
          onConfirm={confirmWizard}
          onCancel={() => { setWizardOpen(false); setDraft(null); }}
          previewNotice="Provider preview configured. No provider account was contacted and no credential was stored."
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="wizard-provider" className="block text-[11px] text-gray-500 uppercase mb-1">Provider</label>
              <select id="wizard-provider" value={draft.providerKey} onChange={(e) => setDraft((d) => ({ ...d, providerKey: e.target.value, permittedCapabilities: [] }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                {PHASE7_PROVIDERS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </div>

            <div>
              <p className="text-[11px] text-gray-500 uppercase mb-1">Connection Model</p>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-xs text-gray-200">
                  <input type="radio" checked readOnly /> Organization-Managed (bring your own provider account)
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-500" title="Not yet available">
                  <input type="radio" disabled /> Future Platform-Managed Option
                </label>
              </div>
            </div>

            {activeProvider && (
              <div>
                <p className="text-[11px] text-gray-500 uppercase mb-1">Capabilities to Permit</p>
                <div className="space-y-1">
                  {activeProvider.capabilities.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-xs text-gray-200">
                      <input type="checkbox" checked={draft.permittedCapabilities.includes(c.id)} onChange={() => toggleCapability(c.id)} />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[11px] text-gray-500">No API key, endpoint, resource ID or credential of any kind is requested by this preview.</p>
          </div>
        </ActionPreviewModal>
      )}
    </div>
  );
}
