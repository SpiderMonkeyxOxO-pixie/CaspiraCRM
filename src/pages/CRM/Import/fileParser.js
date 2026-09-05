// Client-side file parsing only — nothing here ever sends the file over the
// network. CSV is parsed with a small hand-written parser (quoted fields,
// custom delimiters); spreadsheets reuse the xlsx library already installed
// and used elsewhere in the app for export, so no new dependency is added.
import * as XLSX from "xlsx";
import { IMPORT_LIMITS } from "./importConfig";

export function detectExtension(filename) {
  const m = /\.[^.]+$/.exec(filename || "");
  return m ? m[0].toLowerCase() : "";
}

export function isSupportedFile(file) {
  const ext = detectExtension(file.name);
  return IMPORT_LIMITS.supportedExtensions.includes(ext);
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the file — it may be corrupted or unreadable."));
    reader.readAsArrayBuffer(file);
  });
}

// A full-text CSV parser (not line-by-line) so a quoted field containing a
// literal newline is still handled correctly.
export function parseCsvText(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(cur); cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      rows.push(row); row = [];
    } else {
      cur += c;
    }
  }
  if (cur !== "" || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export function detectDelimiter(text) {
  const firstLine = (text.split(/\r?\n/)[0] || "");
  const candidates = [",", ";", "\t", "|"];
  const counts = candidates.map((d) => ({ d, count: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].d : ",";
}

// Duplicate/blank headers are made unique rather than silently colliding —
// "Duplicate headers" and "Missing headers" are both handled here.
export function dedupeHeaders(rawHeaders) {
  const seen = new Map();
  return rawHeaders.map((h, i) => {
    const base = (h || "").toString().trim() || `Column ${i + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count > 1 ? `${base} (${count})` : base;
  });
}

export function extractHeadersAndData(rows, hasHeaderRow) {
  if (!rows.length) return { headers: [], data: [] };
  const colCount = Math.max(...rows.map((r) => r.length));
  if (hasHeaderRow) {
    const headers = dedupeHeaders(rows[0]);
    while (headers.length < colCount) headers.push(`Column ${headers.length + 1}`);
    return { headers, data: rows.slice(1) };
  }
  const headers = Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
  return { headers, data: rows };
}

// Reads and parses a File entirely in memory. Returns every sheet found
// (spreadsheets can have more than one); CSV always produces a single sheet.
export async function parseImportFile(file, { delimiter } = {}) {
  if (!isSupportedFile(file)) {
    throw new Error(`Unsupported file type. Supported formats: ${IMPORT_LIMITS.supportedExtensions.join(", ")}.`);
  }
  if (file.size > IMPORT_LIMITS.maxFileSizeBytes) {
    throw new Error(`This file is larger than the ${(IMPORT_LIMITS.maxFileSizeBytes / (1024 * 1024)).toFixed(0)} MB frontend preview limit.`);
  }
  const ext = detectExtension(file.name);
  const buffer = await readFileAsArrayBuffer(file);

  if (ext === ".csv") {
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    } catch {
      throw new Error("Couldn't decode this file as text — it may not be a valid CSV.");
    }
    const usedDelimiter = delimiter || detectDelimiter(text);
    const rows = parseCsvText(text, usedDelimiter);
    if (rows.length === 0) throw new Error("This file appears to be empty.");
    return { fileType: "csv", encoding: "UTF-8 (detected)", delimiter: usedDelimiter, rawText: text, sheets: [{ name: "Sheet1", rows }] };
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    throw new Error("Couldn't read this spreadsheet — it may be corrupted or in an unsupported format.");
  }
  if (!workbook.SheetNames.length) throw new Error("This spreadsheet has no sheets.");
  // sheet_to_json with raw:false returns each cell's *displayed* value — the
  // calculated result of a formula, never the formula itself.
  const sheets = workbook.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: "" });
    return { name, rows: rows.map((r) => r.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))) };
  }).filter((s) => s.rows.length > 0);
  if (!sheets.length) throw new Error("Every sheet in this spreadsheet is empty.");
  return { fileType: ext.replace(".", ""), encoding: null, delimiter: null, sheets };
}

export function reparseCsvDelimiter(rawText, delimiter) {
  return parseCsvText(rawText, delimiter);
}

// ---- Templates ----
export function downloadTemplate(config) {
  const headers = config.templateColumns.map((c) => c.key);
  const example = config.templateColumns.map((c) => c.example);
  const aoa = [headers, example];
  if (config.destinationFields.some((f) => f.type === "date")) {
    aoa.push([`# Dates should use YYYY-MM-DD format.`]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Template");
  XLSX.writeFile(wb, `${config.id}_import_template.xlsx`);
}

// ---- Error / result reports ----
export function downloadReport(filename, rows, columns) {
  const data = rows.map((r) => {
    const out = {};
    for (const col of columns) out[col.label] = r[col.key] ?? "";
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, filename);
}
