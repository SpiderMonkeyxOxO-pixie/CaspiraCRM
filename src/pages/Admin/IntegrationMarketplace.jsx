import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, SlidersHorizontal, LayoutGrid, List, X, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine,
} from "lucide-react";
import { fetchOrganizations, fetchProviders, fetchConnections, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canCreateConnections } from "./integrationsConfig";
import { CATEGORIES, AUTH_METHODS, PRICING_CLASSIFICATIONS, MAPPABLE_CRM_ENTITIES, FRONTEND_CONNECTION_PREVIEW_LABEL } from "../../Helpers/mockIntegrationsData";
import ProviderLogo from "./ProviderLogo";

const SUPPORTED_MODULES = MAPPABLE_CRM_ENTITIES;

const DIRECTION_ICONS = {
  Bidirectional: <ArrowRightLeft size={12} />,
  "Import Only": <ArrowDownToLine size={12} />,
  "Export Only": <ArrowUpFromLine size={12} />,
};

function computeDataDirection(provider) {
  const directions = new Set(provider.capabilities.map((c) => c.direction));
  if (directions.has("both") || (directions.has("read") && directions.has("write"))) return "Bidirectional";
  if (directions.has("write")) return "Export Only";
  return "Import Only";
}

const STATUS_COLORS = {
  "Preview Connected": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Configuration Required": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Attention Required": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Preview Paused": "bg-gray-700/40 text-gray-300 border-gray-600/40",
  "Preview Disconnected": "bg-gray-800 text-gray-500 border-gray-700",
  "Preview Available": "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "Coming Soon": "bg-gray-800 text-gray-500 border-gray-700",
  Unavailable: "bg-gray-800 text-gray-500 border-gray-700",
};

export default function IntegrationMarketplace() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const { organizations, providers, connections, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("q") || "");
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState("grid");
  const [selectedOrgId, setSelectedOrgId] = useState("");

  const filters = useMemo(() => {
    const p = {};
    for (const [k, v] of searchParams.entries()) p[k] = v;
    return p;
  }, [searchParams]);

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  useEffect(() => {
    dispatch(fetchProviders({ search: filters.q, category: filters.category, pricingClassification: filters.plan, module: filters.module }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, JSON.stringify(filters)]);

  useEffect(() => {
    const orgFilter = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchConnections(orgFilter));
  }, [dispatch, owner, selectedOrgId]);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchInput) next.set("q", searchInput); else next.delete("q");
      setSearchParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearchParams({});
  };

  const hasActiveFilters = Object.keys(filters).length > 0;

  function connectionFor(providerKey) {
    const candidates = connections.filter((c) => c.providerKey === providerKey && c.status !== "Preview Disconnected");
    return candidates[0] || null;
  }

  const visibleProviders = useMemo(() => {
    let results = providers.slice();
    if (filters.status) {
      results = results.filter((p) => {
        const connection = connectionFor(p.key);
        const effectiveStatus = connection?.status || "Preview Available";
        return effectiveStatus === filters.status;
      });
    }
    if (filters.authMethod) results = results.filter((p) => p.authMethod === filters.authMethod);
    return results;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, connections, filters.status, filters.authMethod]);

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span> <span>Integrations</span> <span>/</span> <span className="text-gray-300">Marketplace</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Integration Marketplace</h1>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Browse every supported provider. Each connection you preview is a <span className="text-gray-300 font-medium">{FRONTEND_CONNECTION_PREVIEW_LABEL}</span> — no real provider account is contacted.
          </p>
        </div>
        {owner && (
          <div>
            <label htmlFor="marketplace-org" className="sr-only">Organization</label>
            <select id="marketplace-org" value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search providers..."
            aria-label="Search providers" className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white" />
        </div>
        <button onClick={() => setShowFilters(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
          <SlidersHorizontal size={15} /> Filters
        </button>
        <label htmlFor="marketplace-sort" className="sr-only">Sort</label>
        <select id="marketplace-sort" value={filters.sort || "name_asc"} onChange={(e) => updateFilter("sort", e.target.value === "name_asc" ? null : e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
          <option value="name_asc">Name (A–Z)</option>
          <option value="name_desc">Name (Z–A)</option>
        </select>
        <div className="flex border border-gray-700 rounded-lg overflow-hidden">
          <button onClick={() => setView("grid")} aria-label="Grid view" aria-pressed={view === "grid"} className={`p-2 ${view === "grid" ? "bg-gray-800 text-white" : "text-gray-500"}`}><LayoutGrid size={15} /></button>
          <button onClick={() => setView("list")} aria-label="List view" aria-pressed={view === "list"} className={`p-2 ${view === "list" ? "bg-gray-800 text-white" : "text-gray-500"}`}><List size={15} /></button>
        </div>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-blue-400 hover:underline">
            <X size={12} /> Clear filters
          </button>
        )}
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2 text-xs text-gray-400">
          {Object.entries(filters).map(([key, value]) => (
            <span key={key} className="px-2 py-1 rounded-full border border-gray-700 bg-gray-800/60">{key}: <span className="text-gray-200">{value}</span></span>
          ))}
        </div>
      )}

      {loading && <div className="text-center text-gray-400 py-12 text-sm">Loading the integration marketplace…</div>}
      {error && (
        <div className="text-center py-12">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <button onClick={() => dispatch(fetchProviders())} className="text-sm text-blue-400 hover:underline">Retry</button>
        </div>
      )}

      {!loading && !error && visibleProviders.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
          <Search size={28} className="mx-auto text-gray-600 mb-2" />
          <p className="text-gray-300 text-sm">No provider matches this search or filter combination.</p>
          <button onClick={clearFilters} className="text-xs text-blue-400 hover:underline mt-2">Clear filters</button>
        </div>
      )}

      {!loading && !error && visibleProviders.length > 0 && (
        <div className={view === "grid" ? "grid sm:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-3"}>
          {visibleProviders.map((provider) => (
            <ProviderCard
              key={provider.key}
              provider={provider}
              connection={connectionFor(provider.key)}
              view={view}
              canCreate={canCreateConnections(role)}
              onViewDetails={() => navigate(`/admin/integrations/${provider.key}`)}
              onPreviewSetup={(connection) => connection
                ? navigate(`/admin/integrations/connections/${connection.id}`)
                : navigate(`/admin/integrations/${provider.key}?tab=setup`)}
            />
          ))}
        </div>
      )}

      {showFilters && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowFilters(false)} />
          <div className="relative bg-[#12141c] border-l border-gray-800 w-full max-w-sm h-full p-5 overflow-y-auto">
            <h3 className="text-lg font-semibold text-white mb-4">Filters</h3>
            <div className="space-y-4">
              <FilterSelect label="Category" value={filters.category} onChange={(v) => updateFilter("category", v)} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
              <FilterSelect label="Connection status" value={filters.status} onChange={(v) => updateFilter("status", v)} options={["Preview Available", "Preview Connected", "Configuration Required", "Attention Required", "Preview Paused", "Preview Disconnected"].map((s) => ({ value: s, label: s }))} />
              <FilterSelect label="Provider plan" value={filters.plan} onChange={(v) => updateFilter("plan", v)} options={PRICING_CLASSIFICATIONS.map((p) => ({ value: p, label: p }))} />
              <FilterSelect label="Supported module" value={filters.module} onChange={(v) => updateFilter("module", v)} options={SUPPORTED_MODULES.map((m) => ({ value: m, label: m }))} />
              <FilterSelect label="Authentication method" value={filters.authMethod} onChange={(v) => updateFilter("authMethod", v)} options={AUTH_METHODS.map((a) => ({ value: a, label: a }))} />
            </div>
            <button onClick={() => setShowFilters(false)} className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium">Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderCard({ provider, connection, view, canCreate, onViewDetails, onPreviewSetup }) {
  const effectiveStatus = connection?.status || "Preview Available";
  const direction = computeDataDirection(provider);
  const isList = view === "list";
  return (
    <div role="group" aria-label={provider.name} className={`bg-gray-900/40 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition ${isList ? "flex items-center justify-between gap-4" : ""}`}>
      <div className={isList ? "flex items-center gap-4 flex-1 min-w-0" : ""}>
        <div className="flex items-center gap-2 mb-2">
          <ProviderLogo providerKey={provider.key} name={provider.name} size={32} />
          <h2 className="text-sm font-semibold text-white">{provider.name}</h2>
        </div>
        {!isList && <p className="text-xs text-gray-400 mb-3">{provider.shortDescription}</p>}
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-400">{provider.category}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_COLORS[effectiveStatus] || ""}`}>{effectiveStatus}</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-400 flex items-center gap-1">{DIRECTION_ICONS[direction]} {direction}</span>
        </div>
        {!isList && (
          <>
            <p className="text-[11px] text-gray-500 mb-1">Supports: {provider.supportedModules.join(", ")}</p>
            <p className="text-[11px] text-gray-500 mb-1">Auth: {provider.authMethod}</p>
            <p className="text-[11px] text-gray-500 mb-3">{provider.pricingClassification}</p>
          </>
        )}
      </div>
      <div className={`flex gap-2 ${isList ? "shrink-0" : "mt-2"}`}>
        <button onClick={onViewDetails} className="flex-1 border border-gray-700 hover:bg-gray-800 text-gray-300 px-3 py-1.5 rounded-lg text-xs">View Details</button>
        {canCreate && (
          <button onClick={() => onPreviewSetup(connection)} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
            {connection ? "Manage Preview" : "Preview Setup"}
          </button>
        )}
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <select aria-label={label} value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
        <option value="">All</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
