// ISO/IEC 15434 envelope parser -- the "[)>" structure that carries almost all
// MaxiCode shipping data and some Data Matrix / PDF417 industrial labels.
//
//   "[)>" RS <formatId:2> GS <field> GS <field> ... RS EOT
//
// Field *order* inside format 01 varies between carriers and label revisions,
// so this parser labels only what it can positively identify by shape and shows
// every field with its index. Inferred labels are marked as such rather than
// being presented with the same confidence as the envelope itself.

import { countryName, parseGS1 } from "./gs1.js";

const RS = "\u001e";
const GS = "\u001d";
const EOT = "\u0004";

const FORMATS = {
  "01": "Transportation (structured carrier message)",
  "02": "ASC MH10 data identifiers (EDI)",
  "03": "ASC MH10 data identifiers",
  "04": "GS1 Data Matrix / ASC",
  "05": "GS1 application identifiers",
  "06": "ASC MH10 data identifiers",
  "07": "Free-form / proprietary",
  "08": "VDA (German automotive)",
  "09": "Structured data (CII)",
  "12": "ANSI X12 EDI",
  "13": "UN/EDIFACT",
  "14": "Free text",
  "20": "Structured text",
};

// Standard Carrier Alpha Codes commonly seen in MaxiCode secondary messages.
const SCAC = {
  UPSN: "UPS", FDEG: "FedEx Ground", FDEN: "FedEx Express",
  FDE: "FedEx", USPS: "USPS", DHLC: "DHL", CNWY: "XPO / Conway",
  RDWY: "Yellow / Roadway", ODFL: "Old Dominion", ABFS: "ArcBest",
};

// UPS secondary-message order, applied only when a SCAC anchor confirms it.
// `shape` is the pattern a field MUST match if it is present and non-empty.
// Optional fields are omitted on some label revisions, which shifts every
// later field; the shape checks turn that silent mislabel into a warning.
const UPS_SECONDARY = [
  { label: "Tracking number", shape: /^[0-9A-Z]{8,34}$/ },
  { label: "SCAC (carrier code)", shape: /^[A-Z]{2,4}$/ },
  { label: "Shipper account number" },
  { label: "Julian pickup day", shape: /^\d{3}$/ },
  { label: "Shipment ID" },
  { label: "Package n of x", shape: /^\d+\/\d+$/ },
  { label: "Package weight", shape: /^[\d.]{1,7}$/ },
  { label: "Address validation", shape: /^[YN]$/ },
  { label: "Ship-to street address" },
  { label: "Ship-to city" },
  { label: "Ship-to state", shape: /^[A-Z]{2,3}$/ },
];

export function looksLikeISO15434(text) {
  return text.startsWith("[)>");
}

/**
 * @param {string} text payload in textMode "Plain"
 */
export function parseISO15434(text) {
  const warnings = [];

  // Strip the envelope. The trailing RS+EOT is frequently missing in the wild.
  let body = text.slice(3);
  if (body.startsWith(RS)) body = body.slice(1);
  else warnings.push("Missing record separator after the \"[)>\" header.");

  const tail = body.lastIndexOf(RS);
  if (tail !== -1) body = body.slice(0, tail);
  else warnings.push("Missing trailing record separator.");
  body = body.replace(new RegExp(`${EOT}+$`), "");

  const formatId = body.slice(0, 2);
  const formatName = FORMATS[formatId];
  if (!formatName) warnings.push(`Unrecognised ISO 15434 format identifier "${formatId}".`);

  let rest = body.slice(2);
  if (rest.startsWith(GS)) rest = rest.slice(1);

  const envelope = [
    { label: "Envelope", value: "ISO/IEC 15434" },
    { label: "Format", value: `${formatId} — ${formatName ?? "unknown"}` },
  ];

  // Format 05 is simply a GS1 element string wrapped in the envelope.
  if (formatId === "05" || formatId === "04") {
    const gs1 = parseGS1(rest);
    return {
      kind: "ISO 15434 / GS1",
      fields: [...envelope, ...gs1.fields],
      warnings: [...warnings, ...gs1.warnings],
    };
  }

  if (formatId === "14" || formatId === "20" || formatId === "07") {
    return {
      kind: "ISO 15434 text",
      fields: [...envelope, { label: "Content", value: rest.split(GS).join(" ⎸ ") }],
      warnings,
    };
  }

  const raw = rest.split(GS);

  if (formatId !== "01") {
    return {
      kind: "ISO 15434 record",
      fields: [...envelope, ...raw.map((v, i) => ({ label: `Field ${i + 1}`, value: v }))],
      warnings,
    };
  }

  // ---- Format 01: transportation -----------------------------------------
  const fields = [...envelope];
  const labelled = new Set();
  let cursor = 0;

  // Some label revisions carry a two-digit message version before the primary
  // message; only treat a leading 2-digit field that way when what follows
  // still looks like a postal code plus numeric country and class.
  if (/^\d{2}$/.test(raw[0] ?? "") && /^\d{3}$/.test(raw[2] ?? "") && /^\d{3}$/.test(raw[3] ?? "")) {
    fields.push({ label: "Message version", value: raw[0], note: "field 1" });
    labelled.add(0);
    cursor = 1;
  }

  // Primary message: postal code, ISO 3166 numeric country, service class.
  const pc = raw[cursor];
  const cc = raw[cursor + 1];
  const sc = raw[cursor + 2];
  if (pc !== undefined && /^\d{3}$/.test(cc ?? "") && /^\d{3}$/.test(sc ?? "")) {
    const name = countryName(cc);
    fields.push({ label: "Postal code", value: pc, note: `field ${cursor + 1}` });
    fields.push({
      label: "Country code",
      value: name ? `${cc} — ${name}` : cc,
      note: `field ${cursor + 2}`,
      raw: name ? cc : undefined,
    });
    fields.push({ label: "Service class", value: sc, note: `field ${cursor + 3}` });
    labelled.add(cursor).add(cursor + 1).add(cursor + 2);
    cursor += 3;
  } else {
    warnings.push("Primary message does not match the expected postal code / country / class shape.");
  }

  // Secondary message: only apply the carrier field order when a SCAC anchors
  // it at the expected offset. Otherwise the fields are shown unlabelled --
  // a wrong label is worse than no label on a shipping document.
  const scacIndex = raw.findIndex((v, i) => i >= cursor && SCAC[v]);
  const anchored = scacIndex === cursor + 1;

  if (anchored) {
    // Confirm the field order before committing to it.
    const misfits = [];
    for (let i = 0; i < UPS_SECONDARY.length; i++) {
      const { shape } = UPS_SECONDARY[i];
      const v = raw[cursor + i];
      if (!shape || v === undefined || v === "") continue;
      if (!shape.test(v)) misfits.push(`field ${cursor + i + 1} ("${v}") is not a ${UPS_SECONDARY[i].label.toLowerCase()}`);
    }

    if (misfits.length) {
      warnings.push(
        `Carrier field order does not line up (${misfits.join("; ")}). ` +
          `An optional field is probably absent, so secondary fields are shown unlabelled.`,
      );
      fields.push({
        label: "Carrier",
        value: `${SCAC[raw[scacIndex]]} (${raw[scacIndex]})`,
        note: "identified from SCAC",
      });
    } else {
      fields.push({
        label: "Carrier",
        value: `${SCAC[raw[scacIndex]]} (${raw[scacIndex]})`,
        note: "identified from SCAC",
      });
      for (let i = 0; i < UPS_SECONDARY.length; i++) {
        const idx = cursor + i;
        if (idx >= raw.length || raw[idx] === "") continue;
        fields.push({
          label: UPS_SECONDARY[i].label,
          value: raw[idx],
          note: `field ${idx + 1}`,
          inferred: true,
        });
        labelled.add(idx);
      }
    }
  } else if (scacIndex !== -1) {
    warnings.push(
      `Carrier code "${raw[scacIndex]}" found at field ${scacIndex + 1}, not the expected ` +
        `field ${cursor + 2}; secondary fields are shown unlabelled.`,
    );
  }

  for (let i = cursor; i < raw.length; i++) {
    if (labelled.has(i) || raw[i] === "") continue;
    fields.push({ label: `Field ${i + 1}`, value: raw[i] });
  }

  return { kind: "MaxiCode structured carrier message", fields, warnings };
}
