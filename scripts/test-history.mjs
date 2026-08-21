// CSV export tests. Run with `npm run test:csv`.
//
// The CSV layer is where silent corruption lives: an unescaped quote shifts
// every later column, a raw 0x1D byte breaks the file for most readers, and a
// payload starting "=" becomes an executable formula in Excel. All three are
// asserted here rather than eyeballed in a spreadsheet.

import { buildCSV, escapeCell, visibleControls, csvFilename } from "../app/js/history.js";

const GS = "\u001d";
const RS = "\u001e";
const EOT = "\u0004";

let pass = 0;
const failures = [];

function check(name, actual, expected) {
  if (actual === expected) {
    pass++;
  } else {
    failures.push(`${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}

function checkThat(name, condition, detail = "") {
  if (condition) pass++;
  else failures.push(`${name}${detail ? `\n      ${detail}` : ""}`);
}

const entry = (text, format = "QRCode", contentType = "Text", at = "2026-08-21T18:30:00.000Z") => ({
  id: "x",
  at,
  format,
  contentType,
  text,
});

// ------------------------------------------------------- cell escaping -------
check("plain value is unquoted", escapeCell("PC-1234"), "PC-1234");
check("comma forces quoting", escapeCell("a,b"), '"a,b"');
check("double quote is doubled and wrapped", escapeCell('say "hi"'), '"say ""hi"""');
// Newlines are tokenised rather than quoted, so no cell is ever multi-line.
// Embedded newlines are a classic source of CSV breakage in naive readers, and
// AAMVA payloads are full of them.
check("newline is tokenised, not quoted", escapeCell("a\nb"), "a<LF>b");
checkThat(
  "no cell can span lines",
  !escapeCell("line1\nline2\r\nline3").includes("\n"),
  escapeCell("line1\nline2\r\nline3"),
);
check("empty value stays empty", escapeCell(""), "");
check("null becomes empty", escapeCell(null), "");
check("undefined becomes empty", escapeCell(undefined), "");

// Formula injection: these must not reach a spreadsheet as live formulas.
check("equals is neutralised", escapeCell("=1+1"), "'=1+1");
check("plus is neutralised", escapeCell("+1"), "'+1");
check("minus is neutralised", escapeCell("-1"), "'-1");
check("at-sign is neutralised", escapeCell("@SUM(A1)"), "'@SUM(A1)");
check(
  "injection payload is neutralised and quoted when it also has a comma",
  escapeCell('=HYPERLINK("http://evil","click")'),
  `"'=HYPERLINK(""http://evil"",""click"")"`,
);
checkThat(
  "a neutralised cell never begins with = after escaping",
  !escapeCell("=cmd|' /C calc'!A0").replace(/^"/, "").startsWith("="),
  escapeCell("=cmd|' /C calc'!A0"),
);

// ------------------------------------------------- control characters --------
check("GS becomes a named token", visibleControls(`a${GS}b`), "a<GS>b");
check("RS and EOT become tokens", visibleControls(`${RS}${EOT}`), "<RS><EOT>");
check("LF becomes a token", visibleControls("a\nb"), "a<LF>b");
check("unnamed control becomes hex", visibleControls("\u0001"), "<0x01>");
checkThat(
  "no raw control bytes survive into a cell",
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(escapeCell(`x${GS}y${RS}z`)),
  escapeCell(`x${GS}y${RS}z`),
);

// -------------------------------------------------------------- layout ------
{
  const csv = buildCSV([entry("PCG-1234")]);
  const lines = csv.trim().split("\r\n");
  const header = lines[0].split(",");
  check("row count is header plus one", lines.length, 2);
  check("first column is local timestamp", header[0], "Scanned at (local)");
  check("second column is UTC", header[1], "Scanned at (UTC)");
  check("symbology column is not called Format", header[2], "Symbology");
  checkThat("raw payload column exists", header.includes("Raw payload"), lines[0]);
  checkThat("warnings column is last", header.at(-1) === "Warnings", header.at(-1));
  checkThat("uses CRLF line endings", csv.includes("\r\n"), JSON.stringify(csv.slice(0, 40)));
  checkThat("ends with a trailing newline", csv.endsWith("\r\n"));
}

// A GS1 batch should produce real per-field columns, not one opaque blob.
{
  const csv = buildCSV([
    entry(`01006141419999961726123110LOT1234A${GS}21SN7890`, "DataMatrix", "GS1"),
    entry(`010061414199999617270131`, "DataMatrix", "GS1"),
  ]);
  const [header, row1, row2] = csv.trim().split("\r\n");
  const cols = header.split(",");
  checkThat("GTIN has its own column", cols.includes("GTIN"), header);
  checkThat("lot number has its own column", cols.includes("Batch / lot number"), header);
  checkThat("serial has its own column", cols.includes("Serial number"), header);
  check("three lines for two scans", csv.trim().split("\r\n").length, 3);

  const gtinIndex = cols.indexOf("GTIN");
  check("GTIN value lands in its column", row1.split(",")[gtinIndex], "00614141999996");
  // The second scan has no lot; that cell must be empty, not shifted.
  const lotIndex = cols.indexOf("Batch / lot number");
  check("absent field leaves an empty cell", row2.split(",")[lotIndex], "");
}

// Mixed batch: every row must still have exactly as many cells as the header.
{
  const csv = buildCSV([
    entry(`01006141419999961726123110LOT9`, "DataMatrix", "GS1"),
    entry(`[)>${RS}01${GS}841706672${GS}840${GS}001${GS}1Z12345675${GS}UPSN${GS}123456${GS}089${GS}SHP99${GS}1/1${GS}25.5${GS}Y${GS}634 ALPHA DR${GS}PITTSBURGH${GS}PA${RS}${EOT}`, "MaxiCode", "ISO15434"),
    entry("https://pcgcorn.com/lot?id=44"),
  ]);
  const lines = csv.trim().split("\r\n");
  // Counting commas is unsafe with quoted cells, so parse properly.
  const parseRow = (line) => {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else cur += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    return cells;
  };
  const widths = lines.map((l) => parseRow(l).length);
  checkThat(
    "every row has the same cell count as the header",
    widths.every((w) => w === widths[0]),
    `widths: ${widths.join(", ")}`,
  );
  checkThat("mixed batch produced a wide sparse table", widths[0] > 20, `width ${widths[0]}`);
}

// Header names must be unique. The ISO 15434 parser emits its own "Format"
// field, which previously collided with the fixed symbology column.
{
  const csv = buildCSV([
    entry(`[)>${RS}01${GS}60540${GS}840${GS}001${RS}${EOT}`, "MaxiCode", "ISO15434"),
    entry("plain text"),
  ]);
  const cols = csv.trim().split("\r\n")[0].split(",");
  const dupes = cols.filter((c, i) => cols.indexOf(c) !== i);
  checkThat("no duplicate column names", dupes.length === 0, `duplicates: ${dupes.join(", ")}`);
  checkThat("the parser's own Format field is kept", cols.includes("Format"), cols.join(","));
  checkThat("derived Characteristics column is excluded", !cols.includes("Characteristics"), cols.join(","));
  checkThat("constant Envelope column is excluded", !cols.includes("Envelope"), cols.join(","));
}

// Warnings travel with the row that produced them.
{
  const misaligned = `[)>${RS}01${GS}841706672${GS}840${GS}001${GS}1Z12345675${GS}UPSN${GS}123456${GS}089${GS}1/1${GS}25.5${GS}Y${GS}634 ALPHA DR${GS}PITTSBURGH${GS}PA${RS}${EOT}`;
  const csv = buildCSV([entry(misaligned, "MaxiCode", "ISO15434")]);
  checkThat("field-alignment warning is exported", csv.includes("does not line up"), csv.slice(-200));
}

// An AAMVA scan must not leak raw control bytes into the file.
{
  const licence = `@\n${RS}\rANSI 636000100102DLDAQT64235789\nDCSSAMPLE\nDACMICHAEL\nDBB01311977\nDCGUSA\r${RS}`;
  const csv = buildCSV([entry(licence, "PDF417", "Binary")]);
  checkThat(
    "no raw control bytes anywhere in the CSV",
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(csv),
    "found raw control characters",
  );
  checkThat("family name is exported", csv.includes("SAMPLE"), "");
}

// -------------------------------------------------------------- filename ----
check("filename is timestamped", csvFilename(new Date(2026, 7, 21, 9, 5)), "pcg-scan-20260821-0905.csv");

// ------------------------------------------------------------------ report --
console.log(`\n${pass} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`FAIL  ${f}\n`);
process.exit(failures.length ? 1 : 0);
