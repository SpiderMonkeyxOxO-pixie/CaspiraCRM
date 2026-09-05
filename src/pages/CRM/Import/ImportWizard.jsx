import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Download, HelpCircle, X, AlertTriangle, Info } from "lucide-react";
import { createLead, updateLead } from "../../../redux/crm/leadsSlice";
import { createContact, updateContact } from "../../../redux/crm/contactsSlice";
import { createCompany, updateCompany } from "../../../redux/crm/companiesSlice";
import { createDeal, updateDeal } from "../../../redux/crm/dealsSlice";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { getRoleLabel } from "../../../utils/roleLabels";
import { RECORD_TYPES, RECORD_TYPE_ORDER, getRecordTypeConfig, autoMapHeaders, WIZARD_STEPS, IMPORT_LIMITS } from "./importConfig";
import { extractHeadersAndData, downloadTemplate } from "./fileParser";
import { buildRowValues, computeRowIdentifier, validateRow, classifyRow, findInFileDuplicateRowIndexes, IGNORE_KEY } from "./importValidation";
import { findFixtureDuplicates } from "./importDuplicates";
import { buildCreatePayload, buildUpdatePayload } from "./importExecution";
import ImportStepper from "./ImportStepper";
import StepRecordType from "./StepRecordType";
import StepUpload from "./StepUpload";
import StepMapping from "./StepMapping";
import StepValidation from "./StepValidation";
import StepDuplicates from "./StepDuplicates";
import StepReview from "./StepReview";
import StepResults from "./StepResults";

const CREATE_THUNKS = { leads: createLead, contacts: createContact, companies: createCompany, deals: createDeal };
const UPDATE_THUNKS = { leads: updateLead, contacts: updateContact, companies: updateCompany, deals: updateDeal };

function initialTypeFromQuery(searchParams) {
  const type = searchParams.get("type");
  return RECORD_TYPE_ORDER.includes(type) ? type : null;
}

export default function ImportWizard() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState(0);
  const [furthestReached, setFurthestReached] = useState(0);
  const [recordType, setRecordType] = useState(() => initialTypeFromQuery(searchParams));
  const [file, setFile] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [uploadState, setUploadState] = useState({ hasHeaderRow: true, selectedSheet: "", delimiter: "," });
  const [mapping, setMapping] = useState({});
  const [autoConfidence, setAutoConfidence] = useState({});
  const [transforms, setTransforms] = useState({});
  const [rowCorrections, setRowCorrections] = useState({});
  const [rowIncluded, setRowIncluded] = useState({});
  const [duplicateDecisions, setDuplicateDecisions] = useState({});
  const [session, setSession] = useState({ startedAt: null, completedAt: null });
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [previewProgress, setPreviewProgress] = useState({ done: 0, total: 0 });
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showStartOverConfirm, setShowStartOverConfirm] = useState(false);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const autoMappedForRef = useRef(null);

  const config = recordType ? getRecordTypeConfig(recordType) : null;
  const hasUnfinishedSession = step > 0 && step < WIZARD_STEPS.length - 1;

  // Real browser-level warning for tab close/refresh — a full in-app
  // navigation blocker would require this app to use a data router
  // (createBrowserRouter), which it doesn't; the persistent banner below
  // covers in-app navigation instead.
  useEffect(() => {
    if (!hasUnfinishedSession) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnfinishedSession]);

  const activeSheet = parseResult?.sheets.find((s) => s.name === uploadState.selectedSheet) || parseResult?.sheets[0];
  const { headers, data: allData } = useMemo(
    () => (activeSheet ? extractHeadersAndData(activeSheet.rows, uploadState.hasHeaderRow) : { headers: [], data: [] }),
    [activeSheet, uploadState.hasHeaderRow]
  );
  const data = useMemo(() => allData.slice(0, IMPORT_LIMITS.maxPreviewRows), [allData]);

  // Auto-map once per (recordType, header-set) — explicit buttons handle
  // re-running it afterward so it never fights a user's manual edits.
  useEffect(() => {
    if (!config || headers.length === 0) return;
    const signature = `${recordType}:${headers.join("|")}`;
    if (autoMappedForRef.current === signature) return;
    autoMappedForRef.current = signature;
    const { mapping: autoMapping, confidence } = autoMapHeaders(headers, config);
    setMapping(autoMapping);
    setAutoConfidence(confidence);
  }, [config, headers, recordType]);

  const builtRows = useMemo(() => {
    if (!config) return [];
    return data.map((row) => buildRowValues(recordType, row, headers, mapping, transforms));
  }, [config, data, headers, mapping, transforms, recordType]);

  const finalRows = useMemo(() => builtRows.map((values, idx) => ({ ...values, ...rowCorrections[idx] })), [builtRows, rowCorrections]);
  const inFileDuplicateIdx = useMemo(() => (config ? findInFileDuplicateRowIndexes(recordType, finalRows) : new Set()), [config, finalRows, recordType]);

  const validatedRows = useMemo(() => {
    if (!config) return [];
    return finalRows.map((values, idx) => {
      const { errors, warnings } = validateRow(recordType, values);
      const status = classifyRow(errors, warnings);
      const duplicateMatches = status !== "invalid" ? findFixtureDuplicates(recordType, values) : [];
      return {
        rowIndex: idx,
        identifier: computeRowIdentifier(recordType, values),
        status,
        errors,
        warnings,
        values,
        originalValues: builtRows[idx],
        included: rowIncluded[idx] !== false,
        isDuplicateInFile: inFileDuplicateIdx.has(idx),
        duplicateMatches,
        duplicateDecision: duplicateDecisions[idx],
      };
    });
  }, [config, finalRows, builtRows, recordType, rowIncluded, inFileDuplicateIdx, duplicateDecisions]);

  // ---------------- Navigation ----------------
  const goToStep = (i) => { if (i <= furthestReached) { setStep(i); document.getElementById("import-step-heading")?.focus(); } };
  const advance = useCallback(() => {
    const next = Math.min(step + 1, WIZARD_STEPS.length - 1);
    setStep(next);
    setFurthestReached((f) => Math.max(f, next));
    if (next === WIZARD_STEPS.length - 2) setSession((s) => ({ ...s, startedAt: s.startedAt || Date.now() }));
    setTimeout(() => document.getElementById("import-step-heading")?.focus(), 0);
  }, [step]);
  const goBack = () => { setStep((s) => Math.max(0, s - 1)); setTimeout(() => document.getElementById("import-step-heading")?.focus(), 0); };

  const resetAll = () => {
    setStep(0); setFurthestReached(0); setFile(null); setParseResult(null);
    setUploadState({ hasHeaderRow: true, selectedSheet: "", delimiter: "," });
    setMapping({}); setAutoConfidence({}); setTransforms({}); setRowCorrections({}); setRowIncluded({});
    setDuplicateDecisions({}); setSession({ startedAt: null, completedAt: null }); setResults(null);
    autoMappedForRef.current = null;
  };

  // ---------------- Step 1: record type ----------------
  const handleSelectRecordType = (type) => {
    if (type !== recordType) {
      setRecordType(type); setFile(null); setParseResult(null); setMapping({}); setAutoConfidence({}); setTransforms({});
      autoMappedForRef.current = null;
    }
  };

  // ---------------- Step 2: upload ----------------
  const handleFileParsed = (selectedFile, result) => {
    setFile(selectedFile);
    setParseResult(result);
    setUploadState((s) => ({ ...s, selectedSheet: result.sheets[0].name, delimiter: result.delimiter || s.delimiter }));
    setMapping({}); setAutoConfidence({}); setTransforms({}); setRowCorrections({}); setRowIncluded({}); setDuplicateDecisions({});
    autoMappedForRef.current = null;
  };
  const handleRemoveFile = () => { setFile(null); setParseResult(null); };

  // ---------------- Step 3: mapping ----------------
  const handleChangeMapping = (colIndex, destKey) => {
    setMapping((m) => ({ ...m, [colIndex]: destKey || IGNORE_KEY }));
    setAutoConfidence((c) => { const next = { ...c }; delete next[colIndex]; return next; });
  };
  const handleChangeTransform = (colIndex, transformKey) => setTransforms((t) => ({ ...t, [colIndex]: transformKey }));
  const handleApplyRecommended = () => {
    const { mapping: auto, confidence } = autoMapHeaders(headers, config);
    setMapping((m) => ({ ...auto, ...m }));
    setAutoConfidence((c) => ({ ...confidence, ...c }));
  };
  const handleResetAuto = () => {
    const { mapping: auto, confidence } = autoMapHeaders(headers, config);
    setMapping(auto);
    setAutoConfidence(confidence);
  };
  const handleClearAll = () => { setMapping({}); setAutoConfidence({}); };

  // ---------------- Step 4: validation ----------------
  const handleUpdateRowValue = (rowIndex, fieldKey, newValue) => setRowCorrections((c) => ({ ...c, [rowIndex]: { ...c[rowIndex], [fieldKey]: newValue } }));
  const handleResetRowField = (rowIndex, fieldKey) => setRowCorrections((c) => {
    if (!c[rowIndex]) return c;
    const nextRow = { ...c[rowIndex] };
    delete nextRow[fieldKey];
    return { ...c, [rowIndex]: nextRow };
  });
  const handleToggleIncluded = (rowIndex) => setRowIncluded((inc) => ({ ...inc, [rowIndex]: !(inc[rowIndex] !== false) }));

  // ---------------- Step 5: duplicates ----------------
  const handleSetDuplicateDecision = (rowIndex, decision) => setDuplicateDecisions((d) => ({ ...d, [rowIndex]: decision }));

  // ---------------- Step 6: run preview ----------------
  const runPreview = useCallback(async () => {
    setRunning(true);
    const eligible = validatedRows.filter((r) => r.included && r.status !== "invalid");
    const outcome = { created: [], updated: [], skipped: [], invalid: validatedRows.filter((r) => r.status === "invalid"), warnings: [] };
    setPreviewProgress({ done: 0, total: eligible.length });

    const CreateThunk = CREATE_THUNKS[recordType];
    const UpdateThunk = UPDATE_THUNKS[recordType];
    const BATCH_SIZE = 5;

    for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
      const batch = eligible.slice(i, i + BATCH_SIZE);
      for (const row of batch) {
        const decision = row.duplicateMatches.length > 0 ? (row.duplicateDecision || "reviewManually") : "createNew";
        if (decision === "skip" || decision === "reviewManually") {
          outcome.skipped.push(row);
          continue;
        }
        try {
          if (decision === "previewUpdate" && UpdateThunk) {
            const existingId = row.duplicateMatches[0].existing._id;
            const payload = buildUpdatePayload(recordType, row.values);
            const result = await dispatch(UpdateThunk({ id: existingId, changes: payload }));
            if (UpdateThunk.fulfilled.match(result)) outcome.updated.push(row);
            else { outcome.warnings.push(`Row ${row.rowIndex + 1}: update failed — kept as skipped.`); outcome.skipped.push(row); }
          } else {
            const payload = buildCreatePayload(recordType, row.values);
            const result = await dispatch(CreateThunk(payload));
            if (CreateThunk.fulfilled.match(result)) outcome.created.push(row);
            else { outcome.warnings.push(`Row ${row.rowIndex + 1}: ${result.payload?.message || result.payload || "creation failed"}.`); outcome.skipped.push(row); }
          }
        } catch {
          outcome.warnings.push(`Row ${row.rowIndex + 1}: unexpected error — kept as skipped.`);
          outcome.skipped.push(row);
        }
      }
      setPreviewProgress({ done: Math.min(i + BATCH_SIZE, eligible.length), total: eligible.length });
      // A short, real pause between batches — visible, honest progress on
      // larger files without artificially slowing down small ones.
      if (i + BATCH_SIZE < eligible.length) await new Promise((r) => setTimeout(r, 120));
    }

    outcome.skipped.push(...validatedRows.filter((r) => !r.included && r.status !== "invalid"));
    setResults(outcome);
    setSession((s) => ({ ...s, completedAt: Date.now(), file }));
    setRunning(false);
    advance();
  }, [validatedRows, recordType, dispatch, file, advance]);

  // ---------------- Cancel / Start over ----------------
  const confirmCancel = () => { setShowCancelConfirm(false); resetAll(); navigate("/crm/dashboard"); };
  const confirmStartOver = () => { setShowStartOverConfirm(false); resetAll(); };

  const canContinue = () => {
    if (step === 0) return !!recordType;
    if (step === 1) return !!parseResult;
    if (step === 2) return config.destinationFields.filter((f) => f.required).every((f) => Object.values(mapping).includes(f.key));
    if (step === 3) return validatedRows.some((r) => r.included && r.status !== "invalid");
    return true;
  };

  return (
    <div className="p-6 text-white max-w-6xl">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/crm/dashboard" className="hover:text-gray-300">CRM</Link> / <span className="text-gray-300">Import</span>
      </nav>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold">Import CRM Records</h1>
          <p className="text-sm text-gray-400 mt-1">A frontend preview wizard for bringing Leads, Contacts, Companies or Deals into this session's shared CRM data.</p>
          <p className="text-xs text-gray-500 mt-1">
            {results ? "Preview import completed" : hasUnfinishedSession ? "Import in progress — unsaved until you run the preview" : "No import session started"}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {config && <button onClick={() => downloadTemplate(config)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Download size={15} /> Download Template</button>}
          <button onClick={() => setShowGuidelines(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><HelpCircle size={15} /> Import Guidelines</button>
          <button onClick={() => setShowPermissions((v) => !v)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Info size={15} /> Permissions</button>
        </div>
      </div>

      {showPermissions && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 mb-4 text-xs text-gray-300">
          <p className="font-medium mb-1">Permissions preview (frontend only — backend enforcement comes later)</p>
          <ul className="space-y-0.5 text-gray-400">
            <li>Import: <span className="text-emerald-400">Allowed</span> for {getRoleLabel(role)}</li>
            <li>Export: <span className="text-emerald-400">Allowed</span> for {getRoleLabel(role)}</li>
            <li>Restricted sensitive fields: {role === "Super-Admin" ? "None" : "Financial fields remain read-only elsewhere in the CRM"}</li>
            <li>Owner assignment: {role === "Super-Admin" ? "Allowed for any team member" : `Restricted — Admins should assign to themselves or confirm with a ${getRoleLabel("Super-Admin")}`}</li>
          </ul>
        </div>
      )}

      {hasUnfinishedSession && (
        <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200 mb-4 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          You have an unfinished import session. Leaving this page (including closing the tab) will lose your in-memory progress — use Cancel Import to leave safely, or Start Over to reset.
        </div>
      )}

      <ImportStepper current={step} furthestReached={furthestReached} onNavigate={goToStep} />

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 sm:p-5 mb-4" tabIndex={-1} id="import-step-heading">
        {step === 0 && <StepRecordType recordType={recordType} onSelect={handleSelectRecordType} />}
        {step === 1 && recordType && (
          <StepUpload file={file} parseResult={parseResult} uploadState={uploadState} onFileParsed={handleFileParsed}
            onUpdateUploadState={(patch) => setUploadState((s) => ({ ...s, ...patch }))} onRemoveFile={handleRemoveFile} />
        )}
        {step === 2 && config && (
          <StepMapping recordType={recordType} config={config} headers={headers} sampleRows={data} mapping={mapping} autoConfidence={autoConfidence}
            transforms={transforms} onChangeMapping={handleChangeMapping} onChangeTransform={handleChangeTransform}
            onApplyRecommended={handleApplyRecommended} onResetAuto={handleResetAuto} onClearAll={handleClearAll} />
        )}
        {step === 3 && config && (
          <StepValidation recordType={recordType} config={config} rows={validatedRows} onUpdateRowValue={handleUpdateRowValue}
            onToggleIncluded={handleToggleIncluded} onResetRow={handleResetRowField} />
        )}
        {step === 4 && config && <StepDuplicates recordType={recordType} rows={validatedRows} onSetDecision={handleSetDuplicateDecision} />}
        {step === 5 && config && (
          <StepReview config={config} file={file} activeSheetName={activeSheet?.name} rows={validatedRows} onRunPreview={runPreview} running={running} />
        )}
        {step === 6 && config && results && <StepResults recordType={recordType} config={config} session={session} results={results} onStartAnother={confirmStartOver} />}

        {running && (
          <div className="mt-3 text-xs text-gray-400">
            Running preview... {previewProgress.done} of {previewProgress.total} rows processed.
            <div className="h-1.5 bg-gray-800 rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${previewProgress.total ? (previewProgress.done / previewProgress.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
      </div>

      {step < WIZARD_STEPS.length - 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button onClick={goBack} disabled={step === 0} className="px-4 py-2 rounded-lg border border-gray-700 text-sm disabled:opacity-30">Back</button>
            {step !== 5 && <button onClick={advance} disabled={!canContinue()} className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-sm font-medium">Continue</button>}
          </div>
          <div className="flex gap-2">
            {hasUnfinishedSession && <button onClick={() => setShowStartOverConfirm(true)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Start Over</button>}
            <button onClick={() => setShowCancelConfirm(true)} className="px-4 py-2 rounded-lg border border-red-800 text-red-400 hover:bg-red-900/20 text-sm">Cancel Import</button>
          </div>
        </div>
      )}
      {step === WIZARD_STEPS.length - 1 && (
        <div className="flex justify-end">
          <button onClick={() => setShowStartOverConfirm(true)} className="text-sm text-gray-400 hover:text-white">Start a completely new session</button>
        </div>
      )}

      {showGuidelines && <GuidelinesModal onClose={() => setShowGuidelines(false)} />}
      {showCancelConfirm && (
        <ConfirmDialog
          title="Cancel this import?"
          body="This clears everything parsed in this browser session and returns you to the CRM Dashboard. Nothing has been saved yet."
          confirmLabel="Cancel Import"
          onConfirm={confirmCancel}
          onClose={() => setShowCancelConfirm(false)}
        />
      )}
      {showStartOverConfirm && (
        <ConfirmDialog
          title="Start over?"
          body="This clears the in-memory import session — your uploaded file, mapping and validation corrections will be lost."
          confirmLabel="Start Over"
          onConfirm={confirmStartOver}
          onClose={() => setShowStartOverConfirm(false)}
        />
      )}
    </div>
  );
}

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose }) {
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-bold">{title}</h3>
        <p className="text-sm text-gray-400">{body}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Keep Going</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-sm font-medium">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function GuidelinesModal({ onClose }) {
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Import Guidelines" onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-6 space-y-3 max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">Import Guidelines</h2>
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <ul className="text-sm text-gray-300 space-y-2 list-disc list-inside">
          <li>Supported formats: .csv, .xlsx, .xls. Frontend preview limit: {(IMPORT_LIMITS.maxFileSizeBytes / (1024 * 1024)).toFixed(0)} MB per file, first {IMPORT_LIMITS.maxPreviewRows} rows previewed.</li>
          <li>During this frontend preview, your file is processed in this browser and is not uploaded to the server. This does not automatically apply to the future backend importer.</li>
          <li>Download a template first if you're unsure which columns to include — it has a header row and one example row.</li>
          <li>Map each column to a CRM field in Step 3; unmapped columns are ignored.</li>
          <li>Rows with errors can be corrected inline in Step 4 before continuing.</li>
          <li>Nothing is merged or updated automatically — you decide how each possible duplicate is handled in Step 5.</li>
          <li>Running the preview only updates this browser session's in-memory CRM data — no production records are created or changed.</li>
        </ul>
      </div>
    </div>
  );
}
