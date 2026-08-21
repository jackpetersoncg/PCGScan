// Verification harness: encode a symbol with bwip-js (BWIPP), decode it with
// zxing-wasm, and confirm the payload survives the round trip.
// bwip-js is a devDependency used ONLY here -- it never ships in the PWA.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import bwipjs from "bwip-js/node";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

const wasmPath = fileURLToPath(
  new URL("../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm", import.meta.url),
);
const wasmBinary = await readFile(wasmPath);
prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: false });

const cases = [
  { name: "qrcode",     bcid: "qrcode",     format: "QRCode",     text: "PCG-QR-TEST-001", opts: { scale: 5 } },
  { name: "datamatrix", bcid: "datamatrix", format: "DataMatrix", text: "PCG-DM-TEST-002", opts: { scale: 5 } },
  { name: "pdf417",     bcid: "pdf417",     format: "PDF417",     text: "PCG-PDF417-TEST-003", opts: { scale: 4, height: 12 } },
  { name: "aztec",      bcid: "azteccode",  format: "Aztec",      text: "PCG-AZTEC-TEST-004", opts: { scale: 5 } },
  { name: "maxicode-m4", bcid: "maxicode",  format: "MaxiCode",   text: "PCG-MAXICODE-TEST-005", opts: { scale: 5, mode: 4 } },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  let png;
  try {
    png = await bwipjs.toBuffer({
      bcid: c.bcid,
      text: c.text,
      backgroundcolor: "FFFFFF", // bwip-js defaults to transparent, which ZXing reads as all-dark
      padding: 16,               // quiet zone
      ...c.opts,
    });
  } catch (err) {
    console.log(`ENCODE-FAIL  ${c.name.padEnd(13)} ${err.message ?? err}`);
    fail++;
    continue;
  }

  const results = await readBarcodes(new Uint8Array(png), {
    formats: [c.format],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    returnErrors: true,
  });

  const hit = results.find((r) => r.isValid);
  if (hit && hit.text === c.text) {
    console.log(`PASS         ${c.name.padEnd(13)} ${hit.format.padEnd(11)} "${hit.text}"`);
    pass++;
  } else {
    console.log(
      `DECODE-FAIL  ${c.name.padEnd(13)} got ${JSON.stringify(
        results.map((r) => ({ f: r.format, t: r.text, e: r.error })),
      )}`,
    );
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
