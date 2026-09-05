import { Fragment, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { RefreshCw, ChevronDown, ChevronUp, CheckCircle2, PlugZap } from "lucide-react";
import {
  fetchOrganizations, fetchFormConnections, updateSalesMarketingFormFieldMapping, enableFormConnection,
  selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canViewFormsIntegrations, canManageFormsIntegrations } from "./salesMarketingConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";

const CRM_FIELD_OPTIONS = ["email", "companyName", "name", "phone", "country", "interestedProduct"];

export default function SalesFormsIntegration() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const { organizations, formConnections, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    dispatch(fetchOrganizations());
  }, [dispatch]);

  const refresh = () => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchFormConnections(filters));
  };

  useEffect(refresh, [dispatch, owner, selectedOrgId]);

  const canView = canViewFormsIntegrations(role);

  const handleMappingChange = (formConnectionId, mappingId, crmField) => {
    dispatch(updateSalesMarketingFormFieldMapping({ formConnectionId, mappingId, changes: { crmField } }));
  };

  const handleEnable = async (formConnectionId) => {
    await dispatch(enableFormConnection(formConnectionId));
    refresh();
  };

  if (!canView) {
    return <div className="p-4 md:p-6"><p className="text-sm text-red-400">You do not have permission to view Forms Integrations.</p></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <button onClick={() => navigate("/admin/integrations/sales-marketing")} className="hover:text-gray-300">Administration</button>
        <span>/</span>
        <button onClick={() => navigate("/admin/integrations/sales-marketing")} className="hover:text-gray-300">Sales &amp; Marketing</button>
        <span>/</span>
        <span className="text-gray-300">Forms</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Forms Integrations</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <div className="flex items-center gap-2">
          {owner && (
            <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All organizations</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <button onClick={refresh} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && formConnections.length === 0 && <div className="text-center text-gray-400 py-8 text-sm">Loading form connections…</div>}

      <section className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-800">
              <th className="p-3">Form</th>
              <th className="p-3">Provider</th>
              <th className="p-3">Status</th>
              <th className="p-3">Enabled</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {formConnections.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-xs text-gray-500">No form connections for this scope.</td></tr>
            ) : (
              formConnections.map((f) => {
                const mappedCrmFields = new Set(f.fieldMappings.map((m) => m.crmField));
                const unmapped = f.requiredCrmFields.filter((field) => !mappedCrmFields.has(field));
                const isOpen = expandedId === f.id;
                return (
                  <Fragment key={f.id}>
                    <tr className="border-b border-gray-800/60 hover:bg-gray-800/30 cursor-pointer" onClick={() => setExpandedId(isOpen ? null : f.id)}>
                      <td className="p-3 text-gray-200 flex items-center gap-1.5"><PlugZap size={13} className="text-gray-500" /> {f.formName}</td>
                      <td className="p-3 text-gray-400">{findProvider(f.providerKey)?.name || f.providerKey}</td>
                      <td className="p-3 text-gray-400 text-[11px]">{f.status}</td>
                      <td className="p-3 text-[11px]">{f.enabled ? <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 size={12} /> Enabled</span> : <span className="text-amber-400">Disabled</span>}</td>
                      <td className="p-3">{isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-800/20">
                        <td colSpan={5} className="p-4 space-y-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-[10px] text-gray-500 uppercase">
                                <th className="pb-2">Provider Field</th>
                                <th className="pb-2">CRM Field</th>
                                <th className="pb-2">Transformation</th>
                                <th className="pb-2">Required</th>
                              </tr>
                            </thead>
                            <tbody>
                              {f.fieldMappings.map((m) => (
                                <tr key={m.id} onClick={(e) => e.stopPropagation()}>
                                  <td className="py-1.5 text-gray-300">{m.providerField}</td>
                                  <td className="py-1.5">
                                    {canManageFormsIntegrations(role) ? (
                                      <select value={m.crmField} onChange={(e) => handleMappingChange(f.id, m.id, e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-[11px] text-white">
                                        {CRM_FIELD_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                                      </select>
                                    ) : <span className="text-gray-300">{m.crmField}</span>}
                                  </td>
                                  <td className="py-1.5 text-gray-500">{m.transformation}</td>
                                  <td className="py-1.5 text-gray-500">{m.required ? "Yes" : "No"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {unmapped.length > 0 && (
                            <p className="text-[11px] text-amber-300">Required CRM field(s) not yet mapped: {unmapped.join(", ")}.</p>
                          )}
                          {canManageFormsIntegrations(role) && !f.enabled && (
                            <button onClick={(e) => { e.stopPropagation(); handleEnable(f.id); }} className="text-[11px] px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white">Enable Form</button>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
