// Copies the zxing-wasm ES module + WASM binary into app/vendor so the PWA is
// fully self-contained. Without this the library's default `locateFile` fetches
// the .wasm from the jsDelivr CDN, which would break offline use and put an
// external dependency in the request path.
import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const src = `${root}node_modules/zxing-wasm/dist/`;
const dest = `${root}app/vendor/zxing-wasm/`;

await mkdir(`${dest}reader`, { recursive: true });

// Only three files are actually needed at runtime: reader/index.js imports
// ../share.js, and the module loads the .wasm alongside.
await cp(`${src}es/reader/index.js`, `${dest}reader/index.js`);
await cp(`${src}es/share.js`, `${dest}share.js`);
await cp(`${src}reader/zxing_reader.wasm`, `${dest}reader/zxing_reader.wasm`);

const wasm = await readFile(`${dest}reader/zxing_reader.wasm`);
const { version } = JSON.parse(await readFile(`${root}node_modules/zxing-wasm/package.json`, "utf8"));
const sha = createHash("sha256").update(wasm).digest("hex").slice(0, 16);

await writeFile(
  `${dest}VENDORED.md`,
  `# Vendored — do not edit by hand\n\n` +
    `Regenerate with \`npm run build:vendor\`.\n\n` +
    `- source: \`zxing-wasm@${version}\` (ZXing-C++ compiled to WebAssembly)\n` +
    `- wasm size: ${(wasm.byteLength / 1024).toFixed(0)} KB\n` +
    `- wasm sha256: \`${sha}…\`\n`,
);

for (const f of ["reader/index.js", "share.js", "reader/zxing_reader.wasm"]) {
  const s = await stat(`${dest}${f}`);
  console.log(`  ${f.padEnd(28)} ${(s.size / 1024).toFixed(0)} KB`);
}
console.log(`vendored zxing-wasm@${version}`);
