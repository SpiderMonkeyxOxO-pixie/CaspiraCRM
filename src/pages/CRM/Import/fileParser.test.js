import { describe, it, expect } from "vitest";
import {
  detectExtension, isSupportedFile, parseCsvText, detectDelimiter, dedupeHeaders, extractHeadersAndData,
} from "./fileParser";

describe("fileParser — detectExtension / isSupportedFile", () => {
  it("detectExtension returns the lowercased final extension", () => {
    expect(detectExtension("Leads Export.CSV")).toBe(".csv");
    expect(detectExtension("data.backup.xlsx")).toBe(".xlsx");
  });

  it("detectExtension returns an empty string when there is no extension", () => {
    expect(detectExtension("README")).toBe("");
  });

  it("isSupportedFile accepts csv/xlsx/xls and rejects everything else", () => {
    expect(isSupportedFile(new File(["a"], "leads.csv"))).toBe(true);
    expect(isSupportedFile(new File(["a"], "leads.xlsx"))).toBe(true);
    expect(isSupportedFile(new File(["a"], "leads.xls"))).toBe(true);
    expect(isSupportedFile(new File(["a"], "leads.txt"))).toBe(false);
    expect(isSupportedFile(new File(["a"], "leads.pdf"))).toBe(false);
  });
});

describe("fileParser — parseCsvText", () => {
  it("parses a simple comma-delimited file into rows of strings", () => {
    const rows = parseCsvText("first_name,email\nPriya,priya@example.com\n");
    expect(rows).toEqual([["first_name", "email"], ["Priya", "priya@example.com"]]);
  });

  it("keeps a comma inside a quoted field intact", () => {
    const rows = parseCsvText('name,address\n"Doe, Jane","123 Main St"');
    expect(rows[1]).toEqual(["Doe, Jane", "123 Main St"]);
  });

  it("keeps a literal newline inside a quoted field intact (full-text parsing, not line-by-line)", () => {
    const rows = parseCsvText('name,notes\n"Jane Doe","Line one\nLine two"');
    expect(rows).toEqual([["name", "notes"], ["Jane Doe", "Line one\nLine two"]]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    const rows = parseCsvText('name,quote\n"Jane","She said ""hello"""');
    expect(rows[1][1]).toBe('She said "hello"');
  });

  it("supports a custom delimiter", () => {
    const rows = parseCsvText("a;b;c\n1;2;3", ";");
    expect(rows).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("drops trailing fully-blank lines rather than producing an empty row", () => {
    const rows = parseCsvText("a,b\n1,2\n\n\n");
    expect(rows).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("fileParser — detectDelimiter", () => {
  it("detects comma by default", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
  });
  it("detects semicolon-delimited files", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
  });
  it("detects tab-delimited files", () => {
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
  });
  it("detects pipe-delimited files", () => {
    expect(detectDelimiter("a|b|c")).toBe("|");
  });
  it("falls back to comma when no delimiter candidate appears in the header line", () => {
    expect(detectDelimiter("justoneword")).toBe(",");
  });
});

describe("fileParser — dedupeHeaders", () => {
  it("fills blank headers with a positional placeholder", () => {
    expect(dedupeHeaders(["Name", "", "Email"])).toEqual(["Name", "Column 2", "Email"]);
  });
  it("disambiguates duplicate headers by appending a counter", () => {
    expect(dedupeHeaders(["Email", "Email", "Email"])).toEqual(["Email", "Email (2)", "Email (3)"]);
  });
});

describe("fileParser — extractHeadersAndData", () => {
  it("uses the first row as headers and pads short header rows out to the widest data row", () => {
    const rows = [["Name", "Email"], ["Jane", "jane@example.com", "extra"]];
    const { headers, data } = extractHeadersAndData(rows, true);
    expect(headers).toEqual(["Name", "Email", "Column 3"]);
    expect(data).toEqual([["Jane", "jane@example.com", "extra"]]);
  });

  it("generates positional headers and treats every row as data when there is no header row", () => {
    const rows = [["Jane", "jane@example.com"], ["Tomas", "tomas@example.com"]];
    const { headers, data } = extractHeadersAndData(rows, false);
    expect(headers).toEqual(["Column 1", "Column 2"]);
    expect(data).toEqual(rows);
  });

  it("returns empty headers and data for an empty input", () => {
    expect(extractHeadersAndData([], true)).toEqual({ headers: [], data: [] });
  });
});
