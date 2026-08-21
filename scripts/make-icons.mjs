// Renders the PCG Scan app icons from an inline SVG source.
// Run with `npm run build:icons`.
//
// The mark is a scanner reticle in PCG green: brand-recognisable at 192px and
// still legible in a 48px launcher slot.

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = fileURLToPath(new URL("../app/icons/", import.meta.url));
await mkdir(OUT, { recursive: true });

const GREEN = "#028345";
const GREEN_LIGHT = "#70C497";
const GREEN_DARK = "#2A5135";
const BG = "#0B120E";

/**
 * @param {object} opts
 * @param {boolean} opts.maskable  inset the art for Android's safe zone
 * @param {boolean} opts.plate     draw the rounded background plate
 */
function svg({ maskable = false, plate = true } = {}) {
  // Android masks maskable icons to a circle inscribed in the middle 80%, so
  // the artwork is scaled to sit inside that safe zone.
  const s = maskable ? 0.68 : 0.84;
  const c = 256;
  const half = (512 * s) / 2;
  const x0 = c - half;
  const x1 = c + half;
  const arm = half * 0.42;
  const stroke = maskable ? 30 : 34;

  const corner = (px, py, dx, dy) =>
    `<path d="M ${px + dx * arm} ${py} L ${px} ${py} L ${px} ${py + dy * arm}" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GREEN_LIGHT}"/>
      <stop offset="0.55" stop-color="${GREEN}"/>
      <stop offset="1" stop-color="${GREEN_DARK}"/>
    </linearGradient>
  </defs>
  ${plate ? `<rect width="512" height="512" rx="${maskable ? 0 : 108}" fill="url(#plate)"/>` : `<rect width="512" height="512" fill="${BG}"/>`}
  <g fill="none" stroke="${plate ? "#FFFFFF" : GREEN_LIGHT}" stroke-width="${stroke}"
     stroke-linecap="round" stroke-linejoin="round">
    ${corner(x0, x0, 1, 1)}
    ${corner(x1, x0, -1, 1)}
    ${corner(x0, x1, 1, -1)}
    ${corner(x1, x1, -1, -1)}
  </g>
  <rect x="${x0 + stroke * 0.9}" y="${c - stroke * 0.42}"
        width="${(x1 - x0) - stroke * 1.8}" height="${stroke * 0.84}" rx="${stroke * 0.42}"
        fill="${plate ? "#FFFFFF" : GREEN_LIGHT}" opacity="0.95"/>
</svg>`;
}

const targets = [
  { file: "icon-192.png", size: 192, opts: {} },
  { file: "icon-512.png", size: 512, opts: {} },
  { file: "maskable-512.png", size: 512, opts: { maskable: true } },
  { file: "apple-touch-icon.png", size: 180, opts: {} },
  { file: "favicon-32.png", size: 32, opts: {} },
];

for (const { file, size, opts } of targets) {
  const png = await sharp(Buffer.from(svg(opts))).resize(size, size).png().toBuffer();
  await writeFile(`${OUT}${file}`, png);
  console.log(`  ${file.padEnd(24)} ${size}×${size}  ${(png.byteLength / 1024).toFixed(1)} KB`);
}

// Keep the SVG next to the PNGs so the mark can be regenerated or restyled.
await writeFile(`${OUT}icon.svg`, svg());
console.log("icons written to app/icons/");
