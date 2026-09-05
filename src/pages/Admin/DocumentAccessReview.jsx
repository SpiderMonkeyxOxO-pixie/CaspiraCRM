import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { fetchOrganizations, fetchAccessReviewFindings, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { isSystemOwner } from "./documentsStorageConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function DocumentAccessReview() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { organizations, accessReviewFindings, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);
  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);
  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchAccessReviewFindings(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/documents-storage" className="hover:text-gray-300">Documents & Storage</Link>{" "}
        <span>/</span> <span className="text-gray-300">Access Review</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Document Access Review</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Every finding below explains what was detected and why it matters. Suggested actions remain previews — nothing here revokes
            access, removes a link, or changes a permission for real.
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

      {!loading && (
        <div className="grid gap-3">
          {accessReviewFindings.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-900/40 border border-gray-800 rounded-xl p-4">No access risks detected for this scope.</p>
          ) : accessReviewFindings.map((f) => (
            <div key={f.id} className="bg-gray-900/40 border border-amber-500/40 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <ShieldAlert size={16} className="text-amber-400" />
                  <h2 className="text-sm font-semibold text-white">{f.type}</h2>
                </div>
                <span className="text-[11px] text-gray-500">Checked {formatDateTime(f.freshness)}</span>
              </div>
              <p className="text-xs text-gray-400 mt-2">{f.why}</p>
              <dl className="grid sm:grid-cols-2 gap-2 mt-3 text-xs">
                <div>
                  <dt className="text-gray-500 uppercase text-[10px]">File</dt>
                  <dd className="text-gray-300">{f.fileName}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 uppercase text-[10px]">Provider</dt>
                  <dd className="text-gray-300">{findProvider(f.providerKey)?.name || f.providerKey}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 uppercase text-[10px]">Classification</dt>
                  <dd className="text-gray-300">{f.classification}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 uppercase text-[10px]">Affected Users</dt>
                  <dd className="text-gray-300">{f.affectedUsers.length > 0 ? f.affectedUsers.join(", ") : "None named"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 uppercase text-[10px]">Supporting Permission</dt>
                  <dd className="text-gray-300">{f.supportingPermission}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 uppercase text-[10px]">Required Approver</dt>
                  <dd className="text-gray-300">{f.requiredApprover}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-gray-500 uppercase text-[10px]">Suggested Action (Preview Only)</dt>
                  <dd className="text-gray-300">{f.requiredAction}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
