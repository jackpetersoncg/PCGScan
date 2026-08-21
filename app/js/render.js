// Renders a decoded + parsed result.
//
// Everything here builds DOM nodes and assigns via textContent. A barcode is
// untrusted input -- a QR code containing markup is trivial to produce, so no
// decoded value is ever interpolated into innerHTML.

import { formatLabel } from "./decode.js";

const CONTROL_NAMES = {
  4: "EOT", 9: "TAB", 10: "LF", 13: "CR", 27: "ESC", 29: "GS", 30: "RS", 31: "US",
};

/** Replaces control characters with visible tokens for the raw payload view. */
function visibleControls(text) {
  const frag = document.createDocumentFragment();
  let buffer = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x7f) {
      if (buffer) {
        frag.append(document.createTextNode(buffer));
        buffer = "";
      }
      const tag = document.createElement("span");
      tag.className = "ctrl";
      tag.textContent = CONTROL_NAMES[code] ?? `0x${code.toString(16).padStart(2, "0")}`;
      frag.append(tag);
    } else {
      buffer += ch;
    }
  }
  if (buffer) frag.append(document.createTextNode(buffer));
  return frag;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {object} result  ZXing read result
 * @param {object} parsed  output of parsers/index.js
 * @returns {HTMLElement}
 */
export function renderResult(result, parsed) {
  const root = el("article", "result");

  // ---- header ------------------------------------------------------------
  const header = el("header", "result-head");
  header.append(el("span", "badge", formatLabel(result.format)));
  header.append(el("h2", "result-kind", parsed.kind));
  root.append(header);

  // ---- warnings ----------------------------------------------------------
  if (parsed.warnings.length) {
    const box = el("div", "warnings");
    box.setAttribute("role", "status");
    for (const w of parsed.warnings) {
      const row = el("p", "warning");
      row.append(el("span", "warning-icon", "!"));
      row.append(el("span", null, w));
      box.append(row);
    }
    root.append(box);
  }

  // ---- parsed fields -----------------------------------------------------
  if (parsed.fields.length) {
    const list = el("dl", "fields");
    for (const field of parsed.fields) {
      const term = el("dt");
      term.append(el("span", "field-label", field.label));
      if (field.note) term.append(el("span", "field-note", field.note));
      if (field.inferred) {
        const flag = el("span", "field-inferred", "inferred");
        flag.title = "Labelled from the carrier's usual field order, not from the data itself.";
        term.append(flag);
      }

      const def = el("dd");
      if (field.isLink) {
        // Never auto-navigate. The user taps, having seen the host and warnings.
        const link = el("a", "field-link", field.value);
        link.href = field.value;
        link.target = "_blank";
        link.rel = "noopener noreferrer nofollow";
        def.append(link);
      } else {
        def.append(el("span", "field-value", String(field.value)));
      }
      if (field.raw !== undefined) def.append(el("span", "field-raw", `raw: ${field.raw}`));

      list.append(term, def);
    }
    root.append(list);
  }

  // ---- raw payload -------------------------------------------------------
  const details = el("details", "raw");
  details.append(el("summary", null, "Raw payload"));

  const meta = el("dl", "raw-meta");
  const rawMeta = [
    ["Symbology", formatLabel(result.format)],
    ["Content type", result.contentType],
    ["Bytes", String(result.bytes?.length ?? 0)],
    ["Symbology identifier", result.symbologyIdentifier || "—"],
    ["Orientation", `${result.orientation}°`],
    result.isMirrored ? ["Mirrored", "yes"] : null,
    result.isInverted ? ["Inverted", "yes"] : null,
    result.sequenceSize > 0
      ? ["Structured append", `part ${result.sequenceIndex + 1} of ${result.sequenceSize}`]
      : null,
  ].filter(Boolean);
  for (const [k, v] of rawMeta) meta.append(el("dt", null, k), el("dd", null, v));
  details.append(meta);

  const pre = el("pre", "raw-text");
  pre.append(visibleControls(result.text));
  details.append(pre);
  root.append(details);

  return root;
}

/** A multi-symbol still-image scan renders one card per symbol. */
export function renderMultiple(pairs) {
  const frag = document.createDocumentFragment();
  if (pairs.length > 1) {
    frag.append(el("p", "multi-note", `${pairs.length} symbols found in this image.`));
  }
  for (const { result, parsed } of pairs) frag.append(renderResult(result, parsed));
  return frag;
}
