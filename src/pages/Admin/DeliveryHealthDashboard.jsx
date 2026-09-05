import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { fetchOrganizations, fetchDeliveryHealthIndicators, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewDeliveryHealth } from "./projectsDevelopmentConfig";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function DeliveryHealthDashboard() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, deliveryHealthIndicators, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [showOnlyDetected, setShowOnlyDetected] = useState(false);

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchDeliveryHealthIndicators(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);

  const detectedCount = useMemo(() => deliveryHealthIndicators.filter((i) => i.detected).length, [deliveryHealthIndicators]);
  const visibleIndicators = useMemo(
    () => (showOnlyDetected ? deliveryHealthIndicators.filter((i) => i.detected) : deliveryHealthIndicators),
    [deliveryHealthIndicators, showOnlyDetected]
  );

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/projects-development" className="hover:text-gray-300">Projects & Development</Link>{" "}
        <span>/</span> <span className="text-gray-300">Delivery Health</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Delivery Health</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Each indicator below is a single, explained, deterministic calculation — never a vague overall score. Every detected indicator
            names what was checked, why it was flagged, the affected records, and who is required to act.
          </p>
          {!owner && orgLabel && <p className="text-xs text-gray-500 mt-1">Organization: <span className="text-gray-300">{orgLabel}</span></p>}
        </div>
        {owner && (
          <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" aria-label="Organization">
            <option value="">All organizations</option>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && canViewDeliveryHealth(role) && (
        <>
          <div className="flex items-center justify-between bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <p className="text-sm text-gray-300">
              <span className="text-amber-300 font-semibold">{detectedCount}</span> of {deliveryHealthIndicators.length} indicators are
              currently detected across this scope.
            </p>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" checked={showOnlyDetected} onChange={(e) => setShowOnlyDetected(e.target.checked)} />
              Show only detected indicators
            </label>
          </div>

          <div className="grid gap-3">
            {visibleIndicators.map((ind) => (
              <div key={ind.id} className={`bg-gray-900/40 border rounded-xl p-4 ${ind.detected ? "border-amber-500/40" : "border-gray-800"}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    {ind.detected ? <AlertTriangle size={16} className="text-amber-400" /> : <CheckCircle2 size={16} className="text-emerald-400" />}
                    <h2 className="text-sm font-semibold text-white">{ind.label}</h2>
                  </div>
                  <span className="text-[11px] text-gray-500">Checked {formatDateTime(ind.freshness)}</span>
                </div>
                <p className="text-xs text-gray-400 mt-2">{ind.why}</p>
                <dl className="grid sm:grid-cols-2 gap-2 mt-3 text-xs">
                  <div>
                    <dt className="text-gray-500 uppercase text-[10px]">Calculation</dt>
                    <dd className="text-gray-300 font-mono">{ind.calculation}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 uppercase text-[10px]">Fields Used</dt>
                    <dd className="text-gray-300">{ind.fields.join(", ")}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 uppercase text-[10px]">Affected Records</dt>
                    <dd className="text-gray-300">{ind.affected.length}</dd>
                  </div>
                  {ind.detected && (
                    <>
                      <div>
                        <dt className="text-gray-500 uppercase text-[10px]">Required Action</dt>
                        <dd className="text-gray-300">{ind.requiredAction}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500 uppercase text-[10px]">Required Approver</dt>
                        <dd className="text-gray-300">{ind.requiredApprover}</dd>
                      </div>
                    </>
                  )}
                </dl>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
