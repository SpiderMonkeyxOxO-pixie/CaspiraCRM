import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { fetchSignatureTemplates, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { canManageSignatureTemplates } from "./documentsStorageConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function SignatureTemplatesList() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { signatureTemplates, loading, error } = useSelector(selectIntegrations);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { dispatch(fetchSignatureTemplates({})); }, [dispatch]);

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/documents-storage" className="hover:text-gray-300">Documents & Storage</Link>{" "}
        <span>/</span> <span className="text-gray-300">Templates</span>
      </div>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-white">Signature Templates</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <p className="text-sm text-gray-400 mt-1 max-w-2xl">
          Field mappings show which CRM fields feed each template. Restricted fields are flagged and cannot be mapped by an unauthorized
          user. This is not an unrestricted legal-document generator — only the fixed template types below are represented.
        </p>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl divide-y divide-gray-800">
          {signatureTemplates.length === 0 ? (
            <p className="px-4 py-6 text-center text-gray-500 text-xs">No signature templates to preview yet.</p>
          ) : signatureTemplates.map((t) => (
            <div key={t.id}>
              <button onClick={() => setExpandedId(expandedId === t.id ? null : t.id)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-800/30">
                <div className="flex items-center gap-2">
                  {expandedId === t.id ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                  <div>
                    <p className="text-sm text-white">{t.name}</p>
                    <p className="text-[11px] text-gray-500">{findProvider(t.providerKey)?.name || t.providerKey} · {t.documentType} · v{t.version}</p>
                  </div>
                </div>
                <span className="text-[11px] text-emerald-400">{t.status}</span>
              </button>
              {expandedId === t.id && (
                <div className="px-4 pb-4 space-y-3">
                  <div className="flex flex-wrap gap-4 text-xs text-gray-400">
                    <span>Related CRM Module: <span className="text-gray-300">{t.relatedCrmModule}</span></span>
                    <span>Recipient Roles: <span className="text-gray-300">{t.recipientRoles.join(", ")}</span></span>
                    <span>Last Updated: <span className="text-gray-300">{formatDateTime(t.updatedAt)}</span></span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 uppercase border-b border-gray-800">
                        <th className="py-2 pr-4">CRM Field</th>
                        <th className="py-2 pr-4">Template Field</th>
                        <th className="py-2 pr-4">Field Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.fieldMappings.map((fm) => (
                        <tr key={fm.templateFieldLabel} className="border-b border-gray-800/60 last:border-0">
                          <td className="py-2 pr-4 text-gray-300">{fm.crmField}</td>
                          <td className="py-2 pr-4 text-gray-300 flex items-center gap-1">
                            {fm.restricted && !canManageSignatureTemplates(role) ? <><Lock size={11} className="text-amber-300" /> Restricted</> : fm.templateFieldLabel}
                          </td>
                          <td className="py-2 pr-4 text-gray-400">{fm.fieldType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
