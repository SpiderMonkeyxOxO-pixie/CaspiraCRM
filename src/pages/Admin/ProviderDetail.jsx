import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import {
  ArrowLeft, ShieldAlert, ShieldCheck, Lock, AlertTriangle, CheckCircle2, ArrowRightLeft,
} from "lucide-react";
import { fetchOrganizations, fetchProvider, fetchConnections, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { canCreateConnections, canViewMappings, canViewSync, canViewActivity } from "./integrationsConfig";
import { FRONTEND_CONNECTION_PREVIEW_LABEL, FRONTEND_CONNECTION_PREVIEW_EXPLANATION } from "../../Helpers/mockIntegrationsData";
import PreviewConnectionWizard from "./PreviewConnectionWizard";
import ProviderLogo from "./ProviderLogo";

const TABS = ["Overview", "Capabilities", "Setup", "Data Mapping", "Synchronization", "Health", "Activity", "Access"];

const STATUS_COLORS = {
  "Preview Connected": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Configuration Required": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Attention Required": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Preview Paused": "bg-gray-700/40 text-gray-300 border-gray-600/40",
  "Preview Disconnected": "bg-gray-800 text-gray-500 border-gray-700",
  "Preview Available": "bg-blue-500/15 text-blue-300 border-blue-500/30",
};

export default function ProviderDetail() {
  const { providerKey } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, currentProvider, connections, loading, error } = useSelector(selectIntegrations);

  const requestedTab = TABS.find((t) => t.toLowerCase() === (searchParams.get("tab") || "").toLowerCase());
  const [tab, setTab] = useState(requestedTab || "Overview");
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    dispatch(fetchOrganizations());
    dispatch(fetchConnections());
  }, [dispatch]);

  useEffect(() => {
    dispatch(fetchProvider(providerKey));
  }, [dispatch, providerKey]);

  useEffect(() => {
    if (requestedTab) setTab(requestedTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerKey]);

  const connection = useMemo(() => {
    const candidates = connections.filter((c) => c.providerKey === providerKey && c.status !== "Preview Disconnected");
    return candidates[0] || null;
  }, [connections, providerKey]);

  const orgName = useMemo(() => {
    if (!connection) return null;
    return organizations.find((o) => o.id === connection.organizationId)?.name || connection.organizationId;
  }, [connection, organizations]);

  if (loading && !currentProvider) {
    return <div className="p-4 md:p-6 text-gray-400 text-sm">Loading provider…</div>;
  }
  if (error || !currentProvider) {
    return (
      <div className="p-4 md:p-6 space-y-3">
        <p className="text-sm text-red-400">{error || "This provider is not part of the Integration Center preview."}</p>
        <button onClick={() => navigate("/admin/integrations/marketplace")} className="text-sm text-blue-400 hover:underline">Back to Marketplace</button>
      </div>
    );
  }

  const provider = currentProvider;
  const effectiveStatus = connection?.status || "Preview Available";

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1 flex-wrap">
        <Link to="/admin/integrations" className="hover:text-gray-300">Administration</Link> <span>/</span>
        <Link to="/admin/integrations" className="hover:text-gray-300">Integrations</Link> <span>/</span>
        <Link to="/admin/integrations/marketplace" className="hover:text-gray-300">Marketplace</Link> <span>/</span>
        <span className="text-gray-300">{provider.name}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button onClick={() => navigate("/admin/integrations/marketplace")} aria-label="Back to Marketplace" className="p-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-gray-400 mt-0.5">
            <ArrowLeft size={16} />
          </button>
          <ProviderLogo providerKey={provider.key} name={provider.name} size={40} />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-white">{provider.name}</h1>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_COLORS[effectiveStatus] || ""}`}>{effectiveStatus}</span>
            </div>
            <p className="text-sm text-gray-400 mt-1 max-w-2xl">{provider.shortDescription}</p>
            {connection && <p className="text-xs text-gray-500 mt-1">Organization: <span className="text-gray-300">{orgName}</span></p>}
          </div>
        </div>
        {canCreateConnections(role) && (
          <button
            onClick={() => (connection ? navigate(`/admin/integrations/connections/${connection.id}`) : setShowWizard(true))}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {connection ? "Manage Preview" : "Preview Setup"}
          </button>
        )}
      </div>

      <div className="border-b border-gray-800 flex gap-1 overflow-x-auto" role="tablist" aria-label="Provider detail sections">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === t ? "border-blue-500 text-white" : "border-transparent text-gray-400 hover:text-gray-200"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab provider={provider} effectiveStatus={effectiveStatus} />}
      {tab === "Capabilities" && <CapabilitiesTab provider={provider} />}
      {tab === "Setup" && (
        <SetupTab provider={provider} connection={connection} canCreate={canCreateConnections(role)} onOpenWizard={() => setShowWizard(true)} />
      )}
      {tab === "Data Mapping" && <SignpostTab provider={provider} connection={connection} allowed={canViewMappings(role)} label="data mapping" />}
      {tab === "Synchronization" && <SignpostTab provider={provider} connection={connection} allowed={canViewSync(role)} label="synchronization" />}
      {tab === "Health" && <SignpostTab provider={provider} connection={connection} allowed={canViewSync(role)} label="health" />}
      {tab === "Activity" && <SignpostTab provider={provider} connection={connection} allowed={canViewActivity(role)} label="activity" />}
      {tab === "Access" && <AccessTab provider={provider} />}

      {showWizard && (
        <PreviewConnectionWizard
          provider={provider}
          actingRole={role}
          organizations={organizations}
          onClose={() => setShowWizard(false)}
          onCompleted={(newConnection) => {
            setShowWizard(false);
            dispatch(fetchConnections());
            if (newConnection?.id) navigate(`/admin/integrations/connections/${newConnection.id}`);
          }}
        />
      )}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-white mb-2">{title}</h2>
      {children}
    </div>
  );
}

function OverviewTab({ provider, effectiveStatus }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Panel title="What this provider does">
        <p className="text-sm text-gray-300">{provider.longDescription}</p>
      </Panel>
      <Panel title="Supported CRM modules">
        <div className="flex flex-wrap gap-1.5">
          {provider.supportedModules.map((m) => <span key={m} className="text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-300">{m}</span>)}
        </div>
      </Panel>
      <Panel title="Data leaving the CRM">
        <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
          {provider.dataLeavingCrm.map((d) => <li key={d}>{d}</li>)}
        </ul>
      </Panel>
      <Panel title="Data entering the CRM">
        <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
          {provider.dataEnteringCrm.map((d) => <li key={d}>{d}</li>)}
        </ul>
      </Panel>
      <Panel title="Provider plan requirement">
        <p className="text-sm text-gray-300">{provider.pricingClassification}</p>
        <p className="text-xs text-gray-500 mt-1">{provider.planRequirement?.notes}</p>
      </Panel>
      <Panel title="Authentication method">
        <p className="text-sm text-gray-300">{provider.authMethod}</p>
        {provider.credentialFieldInfo && <p className="text-xs text-gray-500 mt-1">{provider.credentialFieldInfo.disabledPlaceholder}</p>}
      </Panel>
      <Panel title="Current preview status">
        <p className="text-sm text-gray-300">{effectiveStatus}</p>
      </Panel>
      <Panel title="Security considerations">
        <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
          {provider.securityNotes.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </Panel>
      <Panel title="Known limitations">
        <ul className="text-sm text-gray-300 space-y-1 list-disc list-inside">
          {provider.knownLimitations.map((k) => <li key={k}>{k}</li>)}
        </ul>
      </Panel>
    </div>
  );
}

function CapabilitiesTab({ provider }) {
  return (
    <div className="overflow-x-auto border border-gray-800 rounded-xl">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
          <tr>
            <th scope="col" className="text-left px-4 py-3">Capability</th>
            <th scope="col" className="text-left px-4 py-3">CRM Module</th>
            <th scope="col" className="text-left px-4 py-3">Direction</th>
            <th scope="col" className="text-left px-4 py-3">Required Permission</th>
            <th scope="col" className="text-left px-4 py-3">Availability</th>
            <th scope="col" className="text-left px-4 py-3">Notes</th>
          </tr>
        </thead>
        <tbody>
          {provider.capabilities.map((c) => (
            <tr key={c.id} className="border-t border-gray-800">
              <td className="px-4 py-3 text-white">
                {c.name}
                {c.description && <p className="text-xs text-gray-500 mt-0.5">{c.description}</p>}
              </td>
              <td className="px-4 py-3 text-gray-300">{c.crmModule}</td>
              <td className="px-4 py-3 text-gray-300 flex items-center gap-1"><ArrowRightLeft size={12} /> {c.direction}</td>
              <td className="px-4 py-3 text-gray-400 font-mono text-xs">{c.requiredPermission}</td>
              <td className="px-4 py-3 text-gray-300">{c.availability}</td>
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1">
                  {c.sensitiveData && <span className="text-[11px] text-amber-300 flex items-center gap-1"><ShieldAlert size={11} /> Sensitive data</span>}
                  {c.requiresHumanApproval && <span className="text-[11px] text-blue-300 flex items-center gap-1"><ShieldCheck size={11} /> Requires human approval</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SetupTab({ provider, connection, canCreate, onOpenWizard }) {
  if (!canCreate) {
    return <p className="text-sm text-gray-400">You do not have permission to set up or manage this integration.</p>;
  }
  return (
    <div className="space-y-4">
      <Panel title="Bring your own account">
        <ul className="text-sm text-gray-300 space-y-1.5">
          <li>Your organization connects its own {provider.name} account.</li>
          <li>{provider.name} subscriptions and usage charges are paid directly to the provider — this CRM does not include third-party service charges.</li>
          <li>Connection availability may depend on your organization's {provider.name} plan: <span className="text-gray-200">{provider.pricingClassification}</span>.</li>
          <li>System Owner and Organization Administrator control organization connections.</li>
          <li>Credentials will eventually be encrypted and stored on the backend. No credential is stored in this browser.</li>
        </ul>
      </Panel>
      {provider.credentialFieldInfo && (
        <Panel title={provider.credentialFieldInfo.label}>
          <input disabled placeholder={provider.credentialFieldInfo.disabledPlaceholder} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
        </Panel>
      )}
      <Panel title="Provider terms and pricing">
        <p className="text-sm text-gray-300">Provider terms and pricing must be verified directly with {provider.name} before any production activation.</p>
      </Panel>
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <p className="text-sm text-blue-200 font-medium mb-1">{FRONTEND_CONNECTION_PREVIEW_LABEL}</p>
        <p className="text-xs text-blue-100/80 mb-3">{FRONTEND_CONNECTION_PREVIEW_EXPLANATION}</p>
        {connection ? (
          <p className="text-xs text-gray-400">A preview connection already exists for your organization. Manage it from the connection detail page.</p>
        ) : (
          <button onClick={onOpenWizard} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            Preview Setup
          </button>
        )}
      </div>
    </div>
  );
}

function SignpostTab({ provider, connection, allowed, label }) {
  if (!allowed) {
    return <p className="text-sm text-gray-400">You do not have permission to view {label} for this integration.</p>;
  }
  if (!connection) {
    return (
      <div className="text-center py-12 border border-dashed border-gray-800 rounded-xl">
        <AlertTriangle size={24} className="mx-auto text-gray-600 mb-2" />
        <p className="text-sm text-gray-300">No preview connection exists yet for {provider.name}.</p>
        <p className="text-xs text-gray-500 mt-1">Complete Preview Setup to see {label} for this integration.</p>
      </div>
    );
  }
  return (
    <div className="text-center py-12 border border-dashed border-gray-800 rounded-xl">
      <CheckCircle2 size={24} className="mx-auto text-emerald-400 mb-2" />
      <p className="text-sm text-gray-300">A preview connection exists for {provider.name}.</p>
      <p className="text-xs text-gray-500 mt-1">Full {label} details are available on the connection's detail page.</p>
    </div>
  );
}

function AccessTab({ provider }) {
  return (
    <div className="space-y-4">
      <Panel title="Who can manage this integration">
        <ul className="text-sm text-gray-300 space-y-1.5">
          <li>System Owner may connect, configure and manage this integration for any authorized organization.</li>
          <li>Organization Administrator may connect, configure and manage this integration within their own organization only.</li>
          <li>Auditor / Checker may view this integration's configuration, activity and evidence, but cannot connect, reconfigure, retry, pause or disconnect it.</li>
          <li>Department and Team Managers see this integration's status only when explicitly granted.</li>
          <li>Standard members do not see this page unless explicitly permitted.</li>
        </ul>
      </Panel>
      <Panel title="Required permissions by capability">
        <ul className="text-xs text-gray-400 space-y-1 font-mono">
          {[...new Set(provider.capabilities.map((c) => c.requiredPermission))].map((perm) => <li key={perm} className="flex items-center gap-1.5"><Lock size={11} /> {perm}</li>)}
        </ul>
      </Panel>
    </div>
  );
}
