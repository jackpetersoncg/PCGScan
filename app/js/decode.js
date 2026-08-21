// Thin wrapper around the vendored ZXing-C++ WebAssembly build.
//
// Two decisions here matter and are easy to get wrong:
//
//  1. `locateFile` is overridden so the .wasm loads from our own origin. The
//     library's default points at the jsDelivr CDN, which would break offline
//     use and add a third-party request to every cold start.
//
//  2. `textMode: "Plain"` is required. The default ("HRI") renders control
//     characters as printable escapes like "<GS>", which destroys the byte
//     structure that the GS1, AAMVA and ISO 15434 parsers depend on.

import { prepareZXingModule, readBarcodes } from "../vendor/zxing-wasm/reader/index.js";

/** The formats this scanner is built for. */
export const FORMATS = ["PDF417", "DataMatrix", "QRCode", "MaxiCode", "Aztec"];

export const FORMAT_LABELS = {
  PDF417: "PDF417",
  DataMatrix: "Data Matrix",
  QRCode: "QR Code",
  MicroQRCode: "Micro QR Code",
  rMQRCode: "rMQR Code",
  MaxiCode: "MaxiCode",
  Aztec: "Aztec",
};

const wasmURL = new URL("../vendor/zxing-wasm/reader/zxing_reader.wasm", import.meta.url).href;

prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasmURL : prefix + path),
  },
});

// Live video: favour latency. Every frame is one of many chances at the symbol,
// so an expensive exhaustive search per frame is the wrong trade.
const LIVE_OPTIONS = {
  formats: FORMATS,
  textMode: "Plain",
  tryHarder: false,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};

// Still image: there is only one chance, so spend the time.
const STILL_OPTIONS = {
  formats: FORMATS,
  textMode: "Plain",
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  tryDenoise: true,
  maxNumberOfSymbols: 8,
  returnErrors: false,
};

let ready = null;

/**
 * Loads and warms the WASM module. Called during startup so the first scan
 * does not pay the ~1 MB compile cost while the user is holding a label up.
 */
export function warmUp() {
  ready ??= readBarcodes(new ImageData(2, 2), { formats: ["QRCode"] }).then(
    () => true,
    (err) => {
      // Surface a genuine load failure rather than failing silently on scan.
      throw new Error(`Barcode engine failed to load: ${err.message}`);
    },
  );
  return ready;
}

/** Decode a single video frame. Returns the first valid result, or null. */
export async function decodeFrame(imageData) {
  const results = await readBarcodes(imageData, LIVE_OPTIONS);
  return results.find((r) => r.isValid) ?? null;
}

/** Decode a still image (photo or file). Returns every valid result found. */
export async function decodeStill(blob) {
  const results = await readBarcodes(blob, STILL_OPTIONS);
  return results.filter((r) => r.isValid);
}

/** Human-readable format name, falling back to the raw enum name. */
export function formatLabel(format) {
  return FORMAT_LABELS[format] ?? format;
}
