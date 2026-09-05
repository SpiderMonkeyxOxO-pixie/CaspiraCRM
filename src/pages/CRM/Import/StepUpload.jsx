import { useCallback, useRef, useState } from "react";
import { Upload, FileText, X, AlertCircle, RefreshCw } from "lucide-react";
import { parseImportFile, reparseCsvDelimiter, extractHeadersAndData } from "./fileParser";
import { IMPORT_LIMITS } from "./importConfig";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const DELIMITER_OPTIONS = [{ value: ",", label: "Comma (,)" }, { value: ";", label: "Semicolon (;)" }, { value: "\t", label: "Tab" }, { value: "|", label: "Pipe (|)" }];

export default function StepUpload({ file, parseResult, uploadState, onFileParsed, onUpdateUploadState, onRemoveFile }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);

  const doParse = useCallback(async (selectedFile, delimiter) => {
    setParsing(true);
    setParseError(null);
    try {
      const result = await parseImportFile(selectedFile, { delimiter });
      onFileParsed(selectedFile, result);
    } catch (err) {
      setParseError(err.message || "Couldn't parse this file.");
    } finally {
      setParsing(false);
    }
  }, [onFileParsed]);

  const handleFiles = (files) => {
    const selected = files?.[0];
    if (!selected) return;
    doParse(selected);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  if (!file) {
    return (
      <div>
        <h2 className="text-base font-semibold mb-1">Upload a file</h2>
        <p className="text-sm text-gray-400 mb-4">
          Supported formats: .csv, .xlsx, .xls · Frontend preview limit: {(IMPORT_LIMITS.maxFileSizeBytes / (1024 * 1024)).toFixed(0)} MB per file,
          first {IMPORT_LIMITS.maxPreviewRows} rows shown in preview.
        </p>
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
          className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-10 text-sm text-gray-400 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500
            ${dragOver ? "border-blue-500 bg-blue-900/10" : "border-gray-700 hover:border-gray-600"}`}
        >
          <Upload size={24} />
          <span>Drag and drop a file here, or <span className="text-blue-400 underline">browse</span></span>
          <span className="text-xs text-gray-500">You can also press Enter or Space while this area is focused to open the file picker.</span>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => handleFiles(e.target.files)} aria-label="Choose a file to import" />
        </label>
        {parsing && <p className="text-sm text-gray-400 mt-3 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Parsing file in your browser...</p>}
        {parseError && (
          <div role="alert" className="mt-3 bg-red-900/15 border border-red-800/40 rounded-lg p-3 text-sm text-red-200 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {parseError}
          </div>
        )}
        <p className="text-xs text-gray-500 mt-4">
          <strong>File privacy:</strong> During this frontend preview, your file is processed in this browser and is not uploaded to the server.
          This does not automatically apply to how the future backend importer will handle files.
        </p>
      </div>
    );
  }

  const activeSheet = parseResult?.sheets?.find((s) => s.name === uploadState.selectedSheet) || parseResult?.sheets?.[0];
  const { headers, data } = activeSheet ? extractHeadersAndData(activeSheet.rows, uploadState.hasHeaderRow) : { headers: [], data: [] };
  const previewRows = data.slice(0, 10);

  return (
    <div>
      <h2 className="text-base font-semibold mb-3">Review your file</h2>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <FileText size={22} className="text-blue-400 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium truncate">{file.name}</p>
              <p className="text-xs text-gray-400">
                {parseResult.fileType.toUpperCase()} · {formatSize(file.size)}
                {parseResult.encoding && ` · ${parseResult.encoding}`}
                {" · "}{data.length} row{data.length === 1 ? "" : "s"} · {headers.length} column{headers.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => inputRef.current?.click()} className="text-xs text-blue-400 hover:underline">Replace file</button>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => handleFiles(e.target.files)} aria-label="Replace the uploaded file" />
            <button onClick={onRemoveFile} className="flex items-center gap-1 text-xs text-red-400 hover:underline"><X size={12} /> Remove</button>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mt-4">
          {parseResult.sheets.length > 1 && (
            <div>
              <label htmlFor="import-sheet" className="block text-xs mb-1 text-gray-400">Sheet</label>
              <select id="import-sheet" value={uploadState.selectedSheet} onChange={(e) => onUpdateUploadState({ selectedSheet: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
                {parseResult.sheets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>
          )}
          {parseResult.fileType === "csv" && (
            <div>
              <label htmlFor="import-delimiter" className="block text-xs mb-1 text-gray-400">Delimiter</label>
              <select id="import-delimiter" value={uploadState.delimiter}
                onChange={(e) => {
                  const delimiter = e.target.value;
                  onUpdateUploadState({ delimiter });
                  const rows = reparseCsvDelimiter(parseResult.rawText, delimiter);
                  onFileParsed(file, { ...parseResult, delimiter, sheets: [{ name: "Sheet1", rows }] });
                }}
                className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
                {DELIMITER_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="flex items-center gap-2 text-sm mt-5 sm:mt-0">
              <input type="checkbox" checked={uploadState.hasHeaderRow} onChange={(e) => onUpdateUploadState({ hasHeaderRow: e.target.checked })} />
              First row contains headers
            </label>
          </div>
        </div>
      </div>

      <p className="text-sm font-medium mb-2">Header preview</p>
      <div className="overflow-x-auto border border-gray-800 rounded-xl mb-2">
        <table className="w-full text-xs">
          <caption className="sr-only">First rows of the uploaded file, showing the detected headers</caption>
          <thead className="bg-gray-900/60 text-gray-400 text-left">
            <tr>{headers.map((h, i) => <th key={i} scope="col" className="px-3 py-2 whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {previewRows.length === 0 ? (
              <tr><td colSpan={headers.length || 1} className="px-3 py-4 text-center text-gray-500">No data rows found.</td></tr>
            ) : previewRows.map((row, ri) => (
              <tr key={ri} className="border-t border-gray-800">
                {headers.map((_, ci) => <td key={ci} className="px-3 py-2 text-gray-300 whitespace-nowrap max-w-50 truncate" title={row[ci]}>{row[ci] === "" || row[ci] == null ? <span className="text-gray-600 italic">empty</span> : String(row[ci])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Showing the first {Math.min(10, data.length)} of {data.length} rows. Formulas display their calculated result, not the formula text.</p>
    </div>
  );
}
