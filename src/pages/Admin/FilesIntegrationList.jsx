import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useSearchParams } from "react-router-dom";
import { LayoutGrid, List, AlertTriangle, Lock, Globe, Unlink, Link2, Undo2 } from "lucide-react";
import {
  fetchOrganizations, fetchExternalFiles, unlinkExternalFile, fetchFileAssociations,
  associateFilePreview, undoLastAssociation, selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canUnlinkExternalFiles, canLinkExternalFiles } from "./documentsStorageConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { FileClassification, RelationshipType, resolveCrmRecordLabel } from "../../Helpers/mockDocumentsStorageData";
import ActionPreviewModal from "./ActionPreviewModal";

function formatBytes(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
const CLASSIFICATION_COLOR = {
  Public: "text-gray-400", Internal: "text-gray-300", Confidential: "text-amber-300", Restricted: "text-red-400",
  Financial: "text-amber-300", Legal: "text-amber-300", "Personal Data": "text-red-400", "HR Restricted": "text-red-400",
};

export default function FilesIntegrationList() {
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const role = useSelector((s) => s.auth.role);
  const { organizations, externalFiles, currentFileAssociations, lastAssociationUndo, loading, error } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [viewMode, setViewMode] = useState("table");
  const [search, setSearch] = useState("");
  const [classificationFilter, setClassificationFilter] = useState("");
  const [stateFilter, setStateFilter] = useState(searchParams.get("state") || "");
  const [detailFile, setDetailFile] = useState(null);
  const [unlinkTarget, setUnlinkTarget] = useState(null);
  const [unlinkReason, setUnlinkReason] = useState("");
  const [associateTarget, setAssociateTarget] = useState(null);
  const [assocModule, setAssocModule] = useState("");
  const [assocRecordId, setAssocRecordId] = useState("");
  const [assocRelationship, setAssocRelationship] = useState("Attachment");
  const [assocVisibility, setAssocVisibility] = useState("Internal");

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  const refetch = () => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchExternalFiles({ ...filters, search, classification: classificationFilter, canonicalState: stateFilter }));
  };
  useEffect(() => { refetch(); }, [dispatch, owner, selectedOrgId, search, classificationFilter, stateFilter]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);

  const openDetail = (file) => { setDetailFile(file); dispatch(fetchFileAssociations(file.id)); };
  const startUnlink = (file) => { setUnlinkTarget(file); setUnlinkReason(""); };
  const confirmUnlink = async () => {
    if (!unlinkTarget) return;
    await dispatch(unlinkExternalFile({ fileId: unlinkTarget.id, reason: unlinkReason }));
    setUnlinkTarget(null);
    setUnlinkReason("");
    refetch();
  };
  const startAssociate = (file) => { setAssociateTarget(file); setAssocModule(""); setAssocRecordId(""); setAssocRelationship("Attachment"); setAssocVisibility("Internal"); };
  const confirmAssociate = async () => {
    if (!associateTarget || !assocModule || !assocRecordId) return;
    await dispatch(associateFilePreview({ fileId: associateTarget.id, crmModule: assocModule, crmRecordId: assocRecordId, relationshipType: assocRelationship, visibility: assocVisibility }));
    setAssociateTarget(null);
    if (detailFile?.id === associateTarget.id) dispatch(fetchFileAssociations(associateTarget.id));
  };
  const undo = async () => {
    await dispatch(undoLastAssociation());
    if (detailFile) dispatch(fetchFileAssociations(detailFile.id));
  };

  const associationPreview = assocModule && assocRecordId ? resolveCrmRecordLabel(assocModule, assocRecordId) : null;

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/documents-storage" className="hover:text-gray-300">Documents & Storage</Link>{" "}
        <span>/</span> <span className="text-gray-300">Files</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">External Files</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Safe metadata references only — no file content is shown, and no real download link is ever provided.
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
          <div className="flex items-center border border-gray-700 rounded-lg overflow-hidden">
            <button onClick={() => setViewMode("table")} aria-label="Table view" aria-pressed={viewMode === "table"} className={`p-2 ${viewMode === "table" ? "bg-gray-700 text-white" : "text-gray-400"}`}><List size={16} /></button>
            <button onClick={() => setViewMode("card")} aria-label="Card view" aria-pressed={viewMode === "card"} className={`p-2 ${viewMode === "card" ? "bg-gray-700 text-white" : "text-gray-400"}`}><LayoutGrid size={16} /></button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files..." aria-label="Search files"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white" />
        <label htmlFor="classification-filter" className="sr-only">Classification</label>
        <select id="classification-filter" value={classificationFilter} onChange={(e) => setClassificationFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
          <option value="">All classifications</option>
          {FileClassification.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label htmlFor="state-filter" className="sr-only">Sync state</label>
        <select id="state-filter" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
          <option value="">All states</option>
          {["Available", "Linked", "Unlinked", "New Version Available", "Synchronization Required", "Restricted", "Unavailable"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && viewMode === "table" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Classification</th>
                <th className="px-4 py-3">Sharing</th>
                <th className="px-4 py-3">Sync State</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {externalFiles.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-500 text-xs">No files to preview yet.</td></tr>
              ) : externalFiles.map((f) => (
                <tr key={f.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3">
                    <button onClick={() => openDetail(f)} className="text-blue-400 hover:underline text-left">{f.fileName}</button>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{findProvider(f.providerKey)?.name || f.providerKey}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{f.fileType}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{formatBytes(f.sizeBytes)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{f.owner}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] ${CLASSIFICATION_COLOR[f.classification]}`}>{f.classification}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 flex items-center gap-1">
                    {f.sharingState === "Private" ? <Lock size={12} /> : <Globe size={12} />} {f.sharingState}
                  </td>
                  <td className="px-4 py-3">
                    <span className={f.canonicalState === "Conflict" || f.syncState === "Conflict" ? "text-amber-300 text-[11px] flex items-center gap-1" : "text-gray-300 text-[11px]"}>
                      {(f.canonicalState === "Conflict" || f.syncState === "Conflict") && <AlertTriangle size={12} />} {f.canonicalState}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(f.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {canLinkExternalFiles(role) && (
                        <button onClick={() => startAssociate(f)} title="Link to CRM Record" className="text-gray-400 hover:text-white"><Link2 size={15} /></button>
                      )}
                      {canUnlinkExternalFiles(role) && (
                        <button onClick={() => startUnlink(f)} title="Unlink Preview" className="text-gray-400 hover:text-red-400"><Unlink size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && viewMode === "card" && (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          {externalFiles.length === 0 ? (
            <p className="text-sm text-gray-500 col-span-full">No files to preview yet.</p>
          ) : externalFiles.map((f) => (
            <button key={f.id} onClick={() => openDetail(f)} className="text-left bg-gray-900/40 border border-gray-800 rounded-xl p-3 hover:border-gray-700">
              <p className="text-sm text-white truncate">{f.fileName}</p>
              <p className="text-[11px] text-gray-500 mt-1">{findProvider(f.providerKey)?.name || f.providerKey} · {formatBytes(f.sizeBytes)}</p>
              <span className={`text-[11px] ${CLASSIFICATION_COLOR[f.classification]}`}>{f.classification}</span>
            </button>
          ))}
        </div>
      )}

      {detailFile && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`${detailFile.fileName} details`}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setDetailFile(null)} />
          <div className="relative bg-[#12141c] border-l border-gray-800 w-full max-w-md h-full overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white truncate">{detailFile.fileName}</h2>
              <button onClick={() => setDetailFile(null)} aria-label="Close" className="text-gray-400 hover:text-white">×</button>
            </div>
            {lastAssociationUndo && (
              <button onClick={undo} className="flex items-center gap-1.5 text-xs text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">
                <Undo2 size={13} /> Undo Last Association
              </button>
            )}
            <dl className="space-y-2 text-sm">
              <Row label="Provider" value={findProvider(detailFile.providerKey)?.name || detailFile.providerKey} />
              <Row label="Provider Reference" value={detailFile.id} />
              <Row label="Size" value={formatBytes(detailFile.sizeBytes)} />
              <Row label="Content Type" value={detailFile.contentType} />
              <Row label="Created" value={formatDateTime(detailFile.createdAt)} />
              <Row label="Updated" value={formatDateTime(detailFile.updatedAt)} />
              <Row label="Owner" value={detailFile.owner} />
              <Row label="Version" value={detailFile.versionNumber} />
              <Row label="Classification" value={detailFile.classification} />
              <Row label="Scan Status" value={detailFile.scanStatus} />
              <Row label="Sharing Status" value={detailFile.sharingState} />
              <Row label="Synchronization State" value={detailFile.canonicalState} />
              <Row label="Data Freshness" value={formatDateTime(detailFile.updatedAt)} />
            </dl>
            <div>
              <h3 className="text-xs text-gray-500 uppercase mb-2">Associated CRM Records</h3>
              {currentFileAssociations.length === 0 ? (
                <p className="text-xs text-gray-500">No CRM record associations yet.</p>
              ) : (
                <ul className="space-y-1">
                  {currentFileAssociations.map((a) => {
                    const resolved = resolveCrmRecordLabel(a.crmModule, a.crmRecordId);
                    return (
                      <li key={a.id} className="text-xs text-gray-300">
                        {a.crmModule}: {resolved.available ? resolved.label : <span className="text-gray-500 italic">{resolved.label}</span>} — <span className="text-gray-500">{a.relationshipType}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {canLinkExternalFiles(role) && (
              <button onClick={() => startAssociate(detailFile)} className="w-full text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-2">
                Link to CRM Record
              </button>
            )}
          </div>
        </div>
      )}

      {unlinkTarget && (
        <ActionPreviewModal
          title="Unlink External File"
          actionLabel={`Unlink ${unlinkTarget.fileName}`}
          details={[{ label: "Provider", value: findProvider(unlinkTarget.providerKey)?.name }]}
          requiresReason
          reason={unlinkReason}
          onReasonChange={setUnlinkReason}
          confirmLabel="Unlink"
          onConfirm={confirmUnlink}
          onCancel={() => { setUnlinkTarget(null); setUnlinkReason(""); }}
          previewNotice="Unlinking removes the preview reference only. The real external file is never deleted."
        />
      )}

      {associateTarget && (
        <ActionPreviewModal
          title="Associate File with CRM Record"
          actionLabel={`Associate ${associateTarget.fileName}`}
          details={[
            { label: "Current Associations", value: currentFileAssociations.length },
            { label: "Proposed Record", value: associationPreview ? associationPreview.label : "Not selected" },
            { label: "Relationship Type", value: assocRelationship },
            { label: "Visibility", value: assocVisibility },
            { label: "Required Permission", value: "external_files.link" },
            ...(FileClassification.includes(associateTarget.classification) && ["Restricted", "Financial", "Legal", "Personal Data", "HR Restricted"].includes(associateTarget.classification)
              ? [{ label: "Sensitive-Data Warning", value: `This file is classified as ${associateTarget.classification}.` }]
              : []),
          ]}
          confirmLabel="Confirm"
          confirmDisabled={!assocModule || !assocRecordId || (associationPreview && !associationPreview.available)}
          onConfirm={confirmAssociate}
          onCancel={() => setAssociateTarget(null)}
          previewNotice="This updates a frontend association preview only. No file is moved, copied or modified at the provider."
        >
          <div className="grid sm:grid-cols-2 gap-2 mb-3">
            <div>
              <label htmlFor="assoc-module" className="block text-[11px] text-gray-500 uppercase mb-1">CRM Module</label>
              <select id="assoc-module" value={assocModule} onChange={(e) => { setAssocModule(e.target.value); setAssocRecordId(""); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="">Select…</option>
                {["Company", "Contact", "Lead", "Deal", "Quote", "Order", "Contract", "Project", "Task", "Support Ticket", "Invoice"].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="assoc-record" className="block text-[11px] text-gray-500 uppercase mb-1">Record ID</label>
              <input id="assoc-record" value={assocRecordId} onChange={(e) => setAssocRecordId(e.target.value)} placeholder="e.g. an existing record id"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white" />
              {assocModule === "Invoice" && <p className="text-[10px] text-amber-300 mt-1">Invoices require a future module — association will be marked unavailable.</p>}
            </div>
            <div>
              <label htmlFor="assoc-relationship" className="block text-[11px] text-gray-500 uppercase mb-1">Relationship Type</label>
              <select id="assoc-relationship" value={assocRelationship} onChange={(e) => setAssocRelationship(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                {RelationshipType.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="assoc-visibility" className="block text-[11px] text-gray-500 uppercase mb-1">Visibility</label>
              <select id="assoc-visibility" value={assocVisibility} onChange={(e) => setAssocVisibility(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white">
                <option value="Internal">Internal</option>
                <option value="Customer Portal">Customer Portal</option>
              </select>
            </div>
          </div>
        </ActionPreviewModal>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-gray-800/60 pb-2">
      <dt className="text-gray-500 text-[10px] uppercase">{label}</dt>
      <dd className="text-gray-200 break-words">{value ?? "—"}</dd>
    </div>
  );
}
