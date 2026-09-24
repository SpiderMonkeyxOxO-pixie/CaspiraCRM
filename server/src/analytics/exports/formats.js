// Backend Phase 12 — export file writers (no third-party dependencies).
// Every cell is neutralized against spreadsheet formula injection; each file
// carries its generation metadata (time, range, time zone, base currency,
// metric versions) and the requester watermark.

// A cell that a spreadsheet would treat as a formula gets a leading quote.
export function neutralize(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /^[=+\-@\t\r|]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}

const csvCell = (v) => { const s = neutralize(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// table: { title, columns: [label], rows: [[cell]], meta: [[label, value]] }
export function toCsv(table) {
  const lines = [table.columns.map(csvCell).join(","), ...table.rows.map((r) => r.map(csvCell).join(","))];
  lines.push("", ...table.meta.map(([k, v]) => `${csvCell(`# ${k}`)},${csvCell(v)}`));
  // A byte-order mark so spreadsheet apps read the file as UTF-8.
  return Buffer.from(`﻿${lines.join("\r\n")}\r\n`, "utf8");
}

export function toJson(table) {
  return Buffer.from(JSON.stringify({ title: table.title, columns: table.columns, rows: table.rows, meta: Object.fromEntries(table.meta) }, null, 2), "utf8");
}

// ─── XLSX: a minimal Office Open XML workbook in a stored (uncompressed) zip ──
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zipStore(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8"); const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const xml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const colName = (i) => { let s = ""; let n = i + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

function sheetXml(rows) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${colName(ci)}${ri + 1}`;
    // Numbers stay numeric; everything else is an inline string (never a formula).
    if ((typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^-?\d{1,15}(\.\d+)?$/.test(v))) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(neutralize(v))}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function toXlsx(table) {
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="About" sheetId="2" r:id="rId2"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml([table.columns, ...table.rows]) },
    { name: "xl/worksheets/sheet2.xml", data: sheetXml([["Field", "Value"], ...table.meta]) },
  ].map((f) => ({ name: f.name, data: Buffer.from(f.data, "utf8") }));
  return zipStore(files);
}

// ─── PDF: a minimal text document (Helvetica, A4 landscape, paginated) ─────────
const pdfText = (s) => String(s).replace(/[^\x20-\x7E]/g, "?").replace(/([\\()])/g, "\\$1");

export function toPdf(table) {
  const widthChars = 130;
  const colW = Math.max(8, Math.floor(widthChars / Math.max(1, table.columns.length)));
  const fit = (s) => { const t = String(s ?? ""); return (t.length > colW - 1 ? `${t.slice(0, colW - 2)}~` : t).padEnd(colW); };
  const lines = [
    { text: table.title, size: 14 }, { text: "", size: 9 },
    { text: table.columns.map(fit).join(""), size: 8, mono: true },
    { text: "-".repeat(Math.min(widthChars, colW * table.columns.length)), size: 8, mono: true },
    ...table.rows.map((r) => ({ text: r.map((c) => fit(neutralize(c))).join(""), size: 8, mono: true })),
    { text: "", size: 9 },
    ...table.meta.map(([k, v]) => ({ text: `${k}: ${v}`, size: 8 })),
  ];
  const perPage = 48;
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  const objects = [];
  const add = (s) => { objects.push(s); return objects.length; };
  const catalogId = add(null); const pagesId = add(null);
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const monoId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const pageIds = [];
  pages.forEach((pageLines, pi) => {
    let y = 560;
    const ops = ["BT"];
    for (const l of pageLines) { ops.push(`/${l.mono ? "F2" : "F1"} ${l.size} Tf 1 0 0 1 36 ${y} Tm (${pdfText(l.text)}) Tj`); y -= l.size + 3; }
    ops.push(`/F1 7 Tf 1 0 0 1 36 20 Tm (${pdfText(`${table.watermark || ""}  -  page ${pi + 1} of ${pages.length}`)}) Tj`, "ET");
    const stream = ops.join("\n");
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${monoId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export const FORMATS = {
  csv: { write: toCsv, mime: "text/csv; charset=utf-8", ext: "csv" },
  xlsx: { write: toXlsx, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  pdf: { write: toPdf, mime: "application/pdf", ext: "pdf" },
  json: { write: toJson, mime: "application/json", ext: "json" },
};
