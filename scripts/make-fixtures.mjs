// Generates the barcode images used by the in-browser self-test page, plus a
// manifest of what each one should decode to.
//
// bwip-js (BWIPP) is the encoder, and is a devDependency only -- it is never
// shipped in the app. It is used here because ZXing itself cannot *write*
// MaxiCode or Aztec (both are read-only in zxing-cpp), so round-tripping needs
// an independent encoder. That independence is the point: it means the test
// exercises a real symbol rather than one produced by the code under test.

import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import bwipjs from "bwip-js/node";

const OUT = fileURLToPath(new URL("../app/dev/fixtures/", import.meta.url));
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const GS = "";
const RS = "";
const EOT = "";

const fixtures = [
  {
    file: "qrcode.png",
    title: "QR Code — plain text",
    bcid: "qrcode",
    text: "PCG-QR-TEST-001",
    opts: { scale: 5 },
    expect: { format: "QRCode", kind: "Plain text" },
  },
  {
    file: "datamatrix.png",
    title: "Data Matrix — plain text",
    bcid: "datamatrix",
    text: "PCG-DM-TEST-002",
    opts: { scale: 5 },
    expect: { format: "DataMatrix", kind: "Plain text" },
  },
  {
    file: "pdf417.png",
    title: "PDF417 — plain text",
    bcid: "pdf417",
    text: "PCG-PDF417-TEST-003",
    opts: { scale: 4, height: 12 },
    expect: { format: "PDF417", kind: "Plain text" },
  },
  {
    file: "aztec.png",
    title: "Aztec — plain text",
    bcid: "azteccode",
    text: "PCG-AZTEC-TEST-004",
    opts: { scale: 5 },
    expect: { format: "Aztec", kind: "Plain text" },
  },
  {
    file: "maxicode.png",
    title: "MaxiCode — mode 4 plain text",
    bcid: "maxicode",
    text: "PCG-MAXICODE-TEST-005",
    opts: { scale: 5, mode: 4 },
    expect: { format: "MaxiCode", kind: "Plain text" },
  },
  {
    file: "maxicode-ups.png",
    title: "MaxiCode — UPS structured carrier message",
    bcid: "maxicode",
    opts: { scale: 5, mode: 2 },
    text:
      `[)>${RS}01${GS}841706672${GS}840${GS}001${GS}1Z12345675${GS}UPSN${GS}123456` +
      `${GS}089${GS}SHP99${GS}1/1${GS}25.5${GS}Y${GS}634 ALPHA DR${GS}PITTSBURGH${GS}PA${RS}${EOT}`,
    expect: {
      format: "MaxiCode",
      kind: "MaxiCode structured carrier message",
      fields: { "Country code": "840 — United States", "Ship-to city": "PITTSBURGH" },
    },
  },
  {
    file: "gs1-datamatrix.png",
    title: "GS1 Data Matrix — GTIN / expiry / lot / serial",
    bcid: "gs1datamatrix",
    // The encoder takes the human-readable form, but a GS1 symbol carries the
    // raw AI stream: fixed-length AIs run together and only variable-length
    // ones are terminated by GS. `decoded` is what ZXing must give back.
    text: "(01)00614141999996(17)261231(10)LOT1234A(21)SN7890",
    decoded: `01006141419999961726123110LOT1234A${GS}21SN7890`,
    opts: { scale: 5 },
    expect: {
      format: "DataMatrix",
      kind: "GS1 element string",
      fields: { GTIN: "00614141999996", "Expiration date": "2026-12-31" },
    },
  },
  {
    file: "aamva-pdf417.png",
    title: "PDF417 — AAMVA driver's licence",
    bcid: "pdf417",
    opts: { scale: 3, height: 16 },
    text:
      `@\n${RS}\rANSI 636000100102DL00410288ZV03330015DL` +
      `DAQT64235789\nDCSSAMPLE\nDACMICHAEL\nDBB01311977\nDBA01312029\nDBC1\n` +
      `DAU069 IN\nDAYBRO\nDAJVA\nDCGUSA\r${RS}`,
    expect: {
      format: "PDF417",
      kind: "AAMVA driver's licence / ID",
      fields: { "Family name": "SAMPLE", Height: "5' 9\" (69 in)" },
    },
  },
];

const manifest = [];

for (const f of fixtures) {
  const png = await bwipjs.toBuffer({
    bcid: f.bcid,
    text: f.text,
    // BWIPP renders a transparent background by default, which ZXing reads as
    // an all-dark image and fails on. An opaque white ground plus a quiet zone
    // is what a real printed label looks like.
    backgroundcolor: "FFFFFF",
    padding: 16,
    ...f.opts,
  });
  await writeFile(`${OUT}${f.file}`, png);
  manifest.push({
    file: f.file,
    title: f.title,
    // What the decoder should return, which is not always what the encoder took.
    text: f.decoded ?? f.text,
    encoderInput: f.decoded ? f.text : undefined,
    expect: f.expect,
    bytes: png.byteLength,
  });
  console.log(`  ${f.file.padEnd(24)} ${(png.byteLength / 1024).toFixed(1)} KB  ${f.title}`);
}

await writeFile(`${OUT}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n${manifest.length} fixtures written to app/dev/fixtures/`);
