import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { fetchFolderMappings, fetchDocumentSyncConflicts, resolveDocumentSyncConflict, selectIntegrations } from "../../redux/admin/integrationsSlice";
import { canViewFolderMappings, canResolveDocumentConflicts } from "./documentsStorageConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { FileClassification, DocumentSyncConflictResolution, NAMING_PLACEHOLDERS, validateNamingPattern } from "../../Helpers/mockDocumentsStorageData";
import ActionPreviewModal from "./ActionPreviewModal";

const TABS = [
  { key: "folders", label: "Folder Mappings" },
  { key: "associations", label: "Record Associations" },
  { key: "file-types", label: "File-Type Rules" },
  { key: "classification", label: "Classification Rules" },
  { key: "permissions", label: "Permission Mappings" },
  { key: "naming", label: "Naming Rules" },
  { key: "conflict-rules", label: "Conflict Rules" },
];

const CLASSIFICATION_EFFECTS = {
  Public: "Full metadata visible. Sharing unrestricted. Signature eligible.",
  Internal: "Full metadata visible internally. External sharing discouraged.",
  Confidential: "Metadata limited to authorized roles. Sharing warning shown before external actions.",
  Restricted: "Metadata heavily limited. Download availability restricted. Sharing blocked without approval.",
  Financial: "Visible to Finance Manager and System Owner by default. Retention behavior enforced.",
  Legal: "Visible to Contract/Legal Manager and System Owner by default. Signature eligible with approval.",
  "Personal Data": "Restricted metadata. Customer Portal visibility disabled by default.",
  "HR Restricted": "Visible to System Owner only by default. Never shown in Customer Portal.",
};

export default function DocumentMappingsConfig() {
  const dispatch = useDispatch();
  const role = useSelector((s) => s.auth.role);
  const { folderMappings, documentSyncConflicts, loading, error } = useSelector(selectIntegrations);
  const [activeTab, setActiveTab] = useState("folders");
  const [namingDraft, setNamingDraft] = useState("Contracts/{contractNumber}");
  const [resolvingConflict, setResolvingConflict] = useState(null);
  const [resolution, setResolution] = useState("");

  useEffect(() => {
    dispatch(fetchFolderMappings({}));
    dispatch(fetchDocumentSyncConflicts({}));
  }, [dispatch]);

  const namingValidation = validateNamingPattern(namingDraft);

  const confirmResolve = async () => {
    if (!resolvingConflict || !resolution) return;
    await dispatch(resolveDocumentSyncConflict({ conflictId: resolvingConflict.id, resolution }));
    setResolvingConflict(null);
    setResolution("");
    dispatch(fetchDocumentSyncConflicts({}));
  };

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/documents-storage" className="hover:text-gray-300">Documents & Storage</Link>{" "}
        <span>/</span> <span className="text-gray-300">Mappings</span>
      </div>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-white">Document & Folder Mappings</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
        </div>
        <p className="text-sm text-gray-400 mt-1 max-w-2xl">
          Folder mappings, naming rules and classification behavior for external storage providers. No real external folder is ever created.
        </p>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && canViewFolderMappings(role) && (
        <>
          <div className="flex flex-wrap items-center gap-1 border-b border-gray-800">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`px-3 py-2 text-sm ${activeTab === t.key ? "text-white border-b-2 border-blue-500" : "text-gray-400"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "folders" && (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">CRM Scope</th>
                    <th className="px-4 py-3">Naming Pattern</th>
                    <th className="px-4 py-3">Sync Direction</th>
                    <th className="px-4 py-3">Validation</th>
                    <th className="px-4 py-3">Conflict</th>
                  </tr>
                </thead>
                <tbody>
                  {folderMappings.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 text-xs">No folder mappings yet.</td></tr>
                  ) : folderMappings.map((m) => (
                    <tr key={m.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{findProvider(m.providerKey)?.name || m.providerKey}</td>
                      <td className="px-4 py-3 text-gray-300">{m.crmScope}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 font-mono">{m.namingPattern}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{m.syncDirection}</td>
                      <td className="px-4 py-3 text-[11px] text-emerald-400">{m.validation}</td>
                      <td className="px-4 py-3 text-xs text-amber-300">{m.conflictState || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "associations" && (
            <p className="text-sm text-gray-500 bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              Record associations are managed from each file's detail drawer on the Files route — this tab reflects the same underlying
              association records without duplicating the workflow.
            </p>
          )}

          {activeTab === "file-types" && (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-3">File type is detected from provider metadata and never changes signature eligibility on its own — classification does.</p>
              <ul className="text-sm text-gray-300 space-y-1">
                <li>PDF, Document, Spreadsheet, Presentation — all preview-eligible for CRM association.</li>
                <li>Unsupported or unrecognized file types are flagged for mapping review rather than silently accepted.</li>
              </ul>
            </div>
          )}

          {activeTab === "classification" && (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3">Classification</th>
                    <th className="px-4 py-3">Effect on Visibility, Sharing, Retention and Signature Eligibility</th>
                  </tr>
                </thead>
                <tbody>
                  {FileClassification.map((c) => (
                    <tr key={c} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{c}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{CLASSIFICATION_EFFECTS[c]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "permissions" && (
            <p className="text-sm text-gray-500 bg-gray-900/40 border border-gray-800 rounded-xl p-4">
              File-level sharing state and collaborator counts are reviewed on the Access Review route, which explains each permission
              finding in full rather than duplicating a second permission table here.
            </p>
          )}

          {activeTab === "naming" && (
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-3">
              <label htmlFor="naming-pattern-input" className="block text-xs text-gray-500 uppercase">Naming Pattern Preview</label>
              <input id="naming-pattern-input" value={namingDraft} onChange={(e) => setNamingDraft(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono" />
              {namingValidation.valid ? (
                <p className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={13} /> Valid naming pattern.</p>
              ) : (
                <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle size={13} /> {namingValidation.reason}</p>
              )}
              <div>
                <p className="text-xs text-gray-500 mb-1">Supported placeholders (no scripts or expressions are ever evaluated):</p>
                <div className="flex flex-wrap gap-1.5">
                  {NAMING_PLACEHOLDERS.map((p) => <span key={p} className="text-[11px] bg-gray-800 rounded px-2 py-0.5 text-gray-300 font-mono">{p}</span>)}
                </div>
              </div>
            </div>
          )}

          {activeTab === "conflict-rules" && (
            <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="px-4 py-3">Conflict Type</th>
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documentSyncConflicts.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500 text-xs">No synchronization conflicts to review.</td></tr>
                  ) : documentSyncConflicts.map((c) => (
                    <tr key={c.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-gray-300">{c.conflictType}</td>
                      <td className="px-4 py-3 text-gray-300">{findProvider(c.providerKey)?.name || c.providerKey}</td>
                      <td className="px-4 py-3">
                        <span className={c.resolutionState === "Open" ? "text-amber-300 text-[11px] flex items-center gap-1" : "text-emerald-400 text-[11px] flex items-center gap-1"}>
                          {c.resolutionState === "Open" ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {c.resolutionState}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {c.resolutionState === "Open" && canResolveDocumentConflicts(role) && (
                          <button onClick={() => setResolvingConflict(c)} className="text-sm text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {resolvingConflict && (
        <ActionPreviewModal
          title="Resolve Synchronization Conflict"
          actionLabel={resolvingConflict.conflictType}
          details={[
            { label: "Provider", value: findProvider(resolvingConflict.providerKey)?.name || resolvingConflict.providerKey },
            { label: "Description", value: resolvingConflict.description },
          ]}
          confirmLabel="Resolve"
          confirmDisabled={!resolution}
          onConfirm={confirmResolve}
          onCancel={() => { setResolvingConflict(null); setResolution(""); }}
          previewNotice="Resolving updates preview state only. No provider is contacted and no external record changes."
        >
          <div className="mb-3">
            <label htmlFor="dsc-resolution-select" className="block text-[11px] text-gray-500 uppercase mb-1">Resolution</label>
            <select id="dsc-resolution-select" value={resolution} onChange={(e) => setResolution(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="">Select a resolution…</option>
              {DocumentSyncConflictResolution.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </ActionPreviewModal>
      )}
    </div>
  );
}
