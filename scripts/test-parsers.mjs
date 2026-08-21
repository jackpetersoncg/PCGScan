// Parser test suite. Run with `npm test`.
// Assertions are on parsed field values, so a regression in any lookup table,
// date convention or field-alignment check fails here rather than in the field.

import { parse } from "../app/js/parsers/index.js";

const GS = ""; // group separator
const RS = ""; // record separator
const EOT = ""; // end of transmission

let pass = 0;
const failures = [];

/**
 * @param {string} name
 * @param {object} input   arguments for parse()
 * @param {object} expect  { kind?, has?: [[label, value]], warns?: [substring] }
 */
function check(name, input, expect) {
  let got;
  try {
    got = parse(input);
  } catch (err) {
    failures.push(`${name}: threw ${err.message}`);
    return;
  }

  const problems = [];
  if (expect.kind && got.kind !== expect.kind) {
    problems.push(`kind was "${got.kind}", expected "${expect.kind}"`);
  }
  for (const [label, value] of expect.has ?? []) {
    const field = got.fields.find((f) => f.label === label);
    if (!field) problems.push(`missing field "${label}"`);
    else if (String(field.value) !== value) {
      problems.push(`"${label}" was "${field.value}", expected "${value}"`);
    }
  }
  for (const label of expect.lacks ?? []) {
    if (got.fields.some((f) => f.label === label)) problems.push(`unexpected field "${label}"`);
  }
  for (const w of expect.warns ?? []) {
    if (!got.warnings.some((x) => x.includes(w))) {
      problems.push(`no warning containing "${w}" (got ${JSON.stringify(got.warnings)})`);
    }
  }
  if (expect.noWarnings && got.warnings.length) {
    problems.push(`unexpected warnings ${JSON.stringify(got.warnings)}`);
  }

  if (problems.length) failures.push(`${name}:\n    - ${problems.join("\n    - ")}`);
  else pass++;
}

const qr = (text) => ({ text, format: "QRCode", contentType: "Text" });
const dm = (text) => ({ text, format: "DataMatrix", contentType: "GS1" });
const pdf = (text) => ({ text, format: "PDF417", contentType: "Binary" });
const maxi = (text) => ({ text, format: "MaxiCode", contentType: "ISO15434" });

// ---------------------------------------------------------------- GS1 --------
check("GS1 concatenated with GS separator",
  dm(`01006141419999961726123110LOT1234A${GS}21SN7890`),
  { kind: "GS1 element string", noWarnings: true, has: [
    ["GTIN", "00614141999996"],
    ["Expiration date", "2026-12-31"],
    ["Batch / lot number", "LOT1234A"],
    ["Serial number", "SN7890"],
  ]});

check("GS1 human-readable parenthesised form",
  dm("(01)00614141999996(17)261231(10)LOT1234A(21)SN7890"),
  { kind: "GS1 element string", noWarnings: true, has: [
    ["GTIN", "00614141999996"],
    ["Batch / lot number", "LOT1234A"],
  ]});

check("GS1 implied decimal point and country lookup",
  dm(`00106141411234567890${GS}3103001250${GS}422840`),
  { has: [
    ["SSCC (shipping container)", "106141411234567890"],
    ["Net weight (kg)", "1.250"],
    ["Country of origin", "840 — United States"],
  ]});

check("GS1 end-of-month date (DD = 00)",
  dm("17261200"),
  { has: [["Expiration date", "2026-12 (end of month)"]] });

check("GS1 unknown AI is reported, not silently dropped",
  dm("01006141419999967999XYZ"),
  { warns: ["Unrecognised application identifier"] });

check("GS1 without FNC1 flag still recognised by shape",
  { text: "0100614141999996", format: "DataMatrix", contentType: "Text" },
  { kind: "GS1 element string", has: [["GTIN", "00614141999996"]] });

// -------------------------------------------------------------- AAMVA --------
const usLicence =
  `@\n${RS}\rANSI 636000100102DL00410288ZV03330015DL` +
  `DAQT64235789\nDCSSAMPLE\nDDEN\nDACMICHAEL\nDDFN\nDADJOHN\nDDGN\nDCAD\nDCBK\nDCDPH\n` +
  `DBD08242023\nDBB01311977\nDBA01312029\nDBC1\nDAU069 IN\nDAYBRO\n` +
  `DAG2300 WEST BROAD STREET\nDAIRICHMOND\nDAJVA\nDAK232690000\nDCGUSA\nDDK1\r${RS}`;

check("AAMVA US licence",
  pdf(usLicence),
  { kind: "AAMVA driver's licence / ID", noWarnings: true, has: [
    ["Issuer identification number", "636000"],
    ["Family name", "SAMPLE"],
    ["First name", "MICHAEL"],
    ["Licence / ID number", "T64235789"],
    ["Date of birth", "1977-01-31"],
    ["Expiration date", "2029-01-31"],
    ["Sex", "Male"],
    ["Height", "5' 9\" (69 in)"],
    ["Eye colour", "Brown"],
    ["Organ donor", "Yes"],
    ["State / province", "VA"],
  ],
    // The "ANSI" header must not be read as a data element.
    lacks: ["Jurisdiction-specific (ANS)"],
  });

check("AAMVA Canadian licence uses CCYYMMDD dates",
  pdf(`@\n${RS}\rANSI 636012100002DL00410277DLDAQ1234-56789\nDCSTREMBLAY\nDACMARIE\nDBB19850612\nDBC2\nDCGCAN\r${RS}`),
  { has: [["Date of birth", "1985-06-12"], ["Sex", "Female"], ["Country", "CAN"]] });

check("AAMVA expired document raises a warning",
  pdf(`@\n${RS}\rANSI 636000100102DLDAQX1\nDCSOLD\nDBA01152020\nDCGUSA\r${RS}`),
  { warns: ["expired 2020-01-15"] });

check("AAMVA jurisdiction-specific elements are surfaced",
  pdf(`@\n${RS}\rANSI 636000100102DLDAQX1\nDCSSMITH\nZVZVA01\r${RS}`),
  { has: [["Jurisdiction-specific (ZVZ)", "VA01"]] });

// ---------------------------------------------------- ISO 15434 / MaxiCode ---
const upsComplete =
  `[)>${RS}01${GS}841706672${GS}840${GS}001${GS}1Z12345675${GS}UPSN${GS}123456` +
  `${GS}089${GS}SHP99${GS}1/1${GS}25.5${GS}Y${GS}634 ALPHA DR${GS}PITTSBURGH${GS}PA${RS}${EOT}`;

check("MaxiCode UPS carrier message, complete",
  maxi(upsComplete),
  { kind: "MaxiCode structured carrier message", noWarnings: true, has: [
    ["Postal code", "841706672"],
    ["Country code", "840 — United States"],
    ["Service class", "001"],
    ["Carrier", "UPS (UPSN)"],
    ["Tracking number", "1Z12345675"],
    ["Package n of x", "1/1"],
    ["Package weight", "25.5"],
    ["Ship-to city", "PITTSBURGH"],
    ["Ship-to state", "PA"],
  ]});

check("MaxiCode with an empty optional field keeps alignment",
  maxi(`[)>${RS}01${GS}841706672${GS}840${GS}001${GS}1Z12345675${GS}UPSN${GS}123456${GS}089${GS}${GS}1/1${GS}25.5${GS}Y${GS}634 ALPHA DR${GS}PITTSBURGH${GS}PA${RS}${EOT}`),
  { noWarnings: true, has: [
    ["Package n of x", "1/1"],
    ["Ship-to state", "PA"],
  ]});

check("MaxiCode with a genuinely absent field refuses to mislabel",
  maxi(`[)>${RS}01${GS}841706672${GS}840${GS}001${GS}1Z12345675${GS}UPSN${GS}123456${GS}089${GS}1/1${GS}25.5${GS}Y${GS}634 ALPHA DR${GS}PITTSBURGH${GS}PA${RS}${EOT}`),
  { warns: ["does not line up"], lacks: ["Package weight", "Ship-to city"] });

check("MaxiCode unknown carrier leaves secondary fields unlabelled",
  maxi(`[)>${RS}01${GS}60540${GS}840${GS}001${GS}ABC123${GS}ZZZZ${RS}${EOT}`),
  { has: [["Postal code", "60540"], ["Field 4", "ABC123"]], lacks: ["Carrier"] });

check("ISO 15434 format 05 delegates to the GS1 parser",
  { text: `[)>${RS}05${GS}0100614141999996${GS}10LOT9${RS}${EOT}`, format: "DataMatrix", contentType: "ISO15434" },
  { kind: "ISO 15434 / GS1", has: [["GTIN", "00614141999996"], ["Batch / lot number", "LOT9"]] });

check("ISO 15434 missing trailing separators is tolerated",
  maxi(`[)>${RS}01${GS}60540${GS}840${GS}001`),
  { has: [["Postal code", "60540"]], warns: ["Missing trailing record separator"] });

// ------------------------------------------------------------- generic -------
check("URL with query parameters",
  qr("https://pcgcorn.com/lot?id=44&year=2026"),
  { kind: "Web link", noWarnings: true, has: [
    ["Host", "pcgcorn.com"],
    ["Query · id", "44"],
    ["Query · year", "2026"],
  ]});

// xn--80ak6aa92e.com renders as "аррӏе.com" -- Cyrillic homograph of apple.com.
check("Punycode host is flagged as a spoofing risk",
  qr("https://xn--80ak6aa92e.com/signin"),
  { kind: "Web link", warns: ["punycode"] });

check("Malformed URL falls back to plain text rather than throwing",
  qr("https://xn--pcgcrn-9za.com/"),
  { kind: "Plain text" });

check("Plain HTTP is flagged",
  qr("http://pcgcorn.com/"),
  { warns: ["unencrypted HTTP"] });

check("Bare IP host is flagged",
  qr("https://192.168.1.50/scan"),
  { warns: ["bare IP address"] });

// The escaped semicolon is the point of this case: an unescaped split would
// truncate the password at the backslash. Values are deliberately obvious
// placeholders so nothing here resembles a real network credential.
check("Wi-Fi payload with an escaped semicolon in the password",
  qr("WIFI:T:WPA;S:EXAMPLE-SSID;P:placeholder\\;value;H:true;;"),
  { kind: "Wi-Fi network", has: [
    ["Network name (SSID)", "EXAMPLE-SSID"],
    ["Security", "WPA/WPA2"],
    ["Password", "placeholder;value"],
    ["Hidden network", "Yes"],
  ]});

check("WEP network is flagged as obsolete",
  qr("WIFI:T:WEP;S:Old;P:1234;;"),
  { warns: ["WEP is obsolete"] });

check("vCard",
  qr("BEGIN:VCARD\nVERSION:3.0\nFN:Jack Cavanaugh\nORG:Peterson Corn Genetics, LLC\nTEL;TYPE=WORK:+15551234567\nEMAIL:jackc@pcgcorn.com\nEND:VCARD"),
  { kind: "Contact card", has: [
    ["Full name", "Jack Cavanaugh"],
    ["Organisation", "Peterson Corn Genetics, LLC"],
    ["Telephone (WORK)", "+15551234567"],
    ["Email", "jackc@pcgcorn.com"],
  ]});

check("Calendar event formats compact timestamps",
  qr("BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Nursery walk\nDTSTART:20260615T140000Z\nLOCATION:Plot 14\nEND:VEVENT\nEND:VCALENDAR"),
  { kind: "Calendar event", has: [
    ["Title", "Nursery walk"],
    ["Starts", "2026-06-15 14:00 UTC"],
    ["Location", "Plot 14"],
  ]});

check("mailto with subject and body",
  qr("mailto:jackc@pcgcorn.com?subject=Seed%20lot&body=Check%20this"),
  { kind: "Email address", has: [["To", "jackc@pcgcorn.com"], ["Subject", "Seed lot"]] });

check("Authenticator secrets are never displayed",
  qr("otpauth://totp/PCG:jackc?secret=JBSWY3DPEHPK3PXP&issuer=PCG"),
  { kind: "Authenticator secret", has: [["Payload", "not displayed"]], warns: ["deliberately not shown"] });

check("Plain text falls through with characteristics",
  qr("PC-1234 RM 105"),
  { kind: "Plain text", has: [["Content", "PC-1234 RM 105"], ["Characteristics", "14 characters"]] });

check("Numeric payload is described as numeric",
  qr("40072819"),
  { kind: "Plain text", has: [["Characteristics", "numeric, 8 characters"]] });

// ------------------------------------------------------------------ report ---
console.log(`\n${pass} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`FAIL  ${f}\n`);
process.exit(failures.length ? 1 : 0);
