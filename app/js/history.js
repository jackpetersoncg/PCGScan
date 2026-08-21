// Scan history and CSV export.
//
// Storage holds only what parse() needs -- {text, format, contentType} -- plus a
// timestamp. Parsed output is re-derived on display and on export rather than
// stored, so improvements to the parsers apply retroactively to old scans and
// there is no second copy of the same data to keep consistent.
//
// localStorage rather than IndexedDB: entries are a few hundred bytes, the cap
// below keeps the whole store well inside the ~5 MB budget, and synchronous
// reads keep the render path simple. Revisit if scans ever need to hold images.

import { parse } from "./parsers/index.js";

const STORAGE_KEY = "pcg-scan-history";
const MAX_ENTRIES = 500;

/** Fields worth showing as a one-line summary, most identifying first. */
const SUMMARY_PREFERENCE = [
  "Tracking number",
  "GTIN",
  "SSCC (shipping container)",
  "Licence / ID number",
  "Family name",
  "Network name (SSID)",
  "Full name",
  "URL",
  "Content",
];

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or unavailable storage must not take the app down; an empty
    // history is a safe reading.
    return [];
  }
}

function write(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    // Almost certainly the quota. Shed the oldest half and try once more --
    // losing old scans beats refusing to record the one just taken.
    try {
      const trimmed = entries.slice(0, Math.floor(entries.length / 2));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return true;
    } catch {
      return false;
    }
  }
}

/** Newest first. */
export function all() {
  return read();
}

export function count() {
  return read().length;
}

export function clear() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing useful to do */
  }
}

/**
 * Records a decoded result.
 *
 * @param {{text: string, format: string, contentType: string}} result
 * @returns {{ok: boolean, skipped?: string}}
 */
export function add(result) {
  // Authenticator secrets are deliberately not displayed by the parser; writing
  // one to localStorage in the clear would undo that. Skip rather than store.
  if (/^otpauth:/i.test(result.text)) {
    return { ok: false, skipped: "Authenticator secrets are not saved to history." };
  }

  const entries = read();
  entries.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    format: result.format,
    contentType: result.contentType,
    text: result.text,
  });
  const ok = write(entries.slice(0, MAX_ENTRIES));
  return { ok };
}

/** Re-derives the parsed view of a stored entry. */
export function parseEntry(entry) {
  return parse({ text: entry.text, format: entry.format, contentType: entry.contentType });
}

/** One-line description for a history row. */
export function summarise(entry, parsed = parseEntry(entry)) {
  for (const label of SUMMARY_PREFERENCE) {
    const hit = parsed.fields.find((f) => f.label === label);
    if (hit) return truncate(String(hit.value));
  }
  const firstReal = parsed.fields.find(
    (f) => !["Envelope", "Format", "Characteristics"].includes(f.label),
  );
  return truncate(String(firstReal?.value ?? entry.text));
}

function truncate(s, max = 60) {
  const clean = visibleControls(s).trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const CONTROL_NAMES = {
  4: "EOT", 9: "TAB", 10: "LF", 13: "CR", 27: "ESC", 29: "GS", 30: "RS", 31: "US",
};

/**
 * Replaces control characters with named tokens. Raw 0x1D bytes in a CSV cell
 * corrupt the file for most readers, and are invisible on screen either way.
 */
export function visibleControls(s) {
  return String(s).replace(/[\u0000-\u001f\u007f]/g, (ch) => {
    const code = ch.codePointAt(0);
    return `<${CONTROL_NAMES[code] ?? `0x${code.toString(16).padStart(2, "0")}`}>`;
  });
}

// ------------------------------------------------------------------- CSV -----

// "Symbology" rather than "Format": the ISO 15434 parser emits a field of its
// own called "Format" (the envelope's format identifier), and two identically
// named columns break pivot tables and confuse importers.
const FIXED_COLUMNS = [
  "Scanned at (local)",
  "Scanned at (UTC)",
  "Symbology",
  "Content type",
  "Parsed as",
];

// Display-only fields that would add columns carrying nothing the other columns
// do not already state: "Characteristics" is derived text ("15 characters") and
// "Envelope" is the constant "ISO/IEC 15434", already implied by "Parsed as".
const CSV_EXCLUDED_LABELS = new Set(["Characteristics", "Envelope"]);

/**
 * Guarantees unique header names. A parser is free to use any label it likes,
 * including one that collides with a fixed column or with another parser's, and
 * a duplicated header silently corrupts downstream analysis.
 */
function uniqueHeaders(names) {
  const seen = new Map();
  return names.map((name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} (${n})`;
  });
}

/**
 * Escapes one CSV cell per RFC 4180, and defuses spreadsheet formula injection.
 *
 * The second part matters: barcode contents are untrusted input, and a payload
 * beginning "=" or "+" is executed as a formula when the file is opened in
 * Excel or Sheets. Prefixing with an apostrophe forces it to be read as text.
 */
export function escapeCell(value) {
  let s = visibleControls(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function localTimestamp(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  // "YYYY-MM-DD HH:MM:SS" -- unambiguous and parsed correctly by Excel, unlike
  // an offset-bearing ISO string.
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * Builds a CSV where every parsed field label seen across the export becomes its
 * own column, so a batch of GS1 scans yields real GTIN / Lot / Expiry columns
 * rather than one opaque blob. Mixed batches are correspondingly sparse, which
 * is the honest representation of mixed data.
 *
 * @param {object[]} entries newest-first history entries
 * @returns {string} CSV text, without BOM
 */
export function buildCSV(entries) {
  const parsedByEntry = entries.map((e) => parseEntry(e));

  const dynamic = [];
  for (const parsed of parsedByEntry) {
    for (const field of parsed.fields) {
      if (CSV_EXCLUDED_LABELS.has(field.label)) continue;
      if (!dynamic.includes(field.label)) dynamic.push(field.label);
    }
  }

  const header = uniqueHeaders([...FIXED_COLUMNS, ...dynamic, "Raw payload", "Warnings"]);
  const rows = [header.map(escapeCell).join(",")];

  entries.forEach((entry, i) => {
    const parsed = parsedByEntry[i];
    const byLabel = new Map();
    for (const f of parsed.fields) {
      // A label can legitimately repeat (several "Field 4"-style rows); join
      // rather than silently dropping all but one.
      byLabel.set(f.label, byLabel.has(f.label) ? `${byLabel.get(f.label)} | ${f.value}` : f.value);
    }
    const row = [
      localTimestamp(entry.at),
      entry.at,
      entry.format,
      entry.contentType,
      parsed.kind,
      ...dynamic.map((label) => byLabel.get(label) ?? ""),
      entry.text,
      parsed.warnings.join(" | "),
    ];
    rows.push(row.map(escapeCell).join(","));
  });

  return `${rows.join("\r\n")}\r\n`;
}

export function csvFilename(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `pcg-scan-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}.csv`
  );
}

/**
 * Hands the CSV to the user. Prefers the share sheet, which on iOS is markedly
 * more reliable than a download from an installed PWA, and lets the file go
 * straight to Mail or Files. Falls back to a download link elsewhere.
 *
 * @returns {Promise<"shared"|"downloaded">}
 */
export async function exportCSV(entries = all()) {
  if (!entries.length) throw new Error("There are no scans to export.");

  const csv = buildCSV(entries);
  const name = csvFilename();
  // The BOM is what makes Excel read the file as UTF-8 rather than the local
  // codepage, which otherwise mangles the em dashes in country names.
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const file = new File([blob], name, { type: "text/csv" });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return "shared";
    } catch (err) {
      // A user-cancelled share must not fall through to a surprise download.
      if (err?.name === "AbortError") return "shared";
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
