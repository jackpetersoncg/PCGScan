// GS1 Application Identifier parser.
//
// ZXing reports contentType "GS1" when the symbol carries an FNC1 in the first
// position. In textMode "Plain" the payload arrives as AIs concatenated back to
// back, with GS (0x1D) terminating variable-length elements only. Fixed-length
// AIs have no separator, so decoding requires the length table below.

const GS = "\u001d";

// [dataLength | null for variable, label, formatter]
// dataLength excludes the AI digits themselves.
const AI = {
  "00": [18, "SSCC (shipping container)"],
  "01": [14, "GTIN"],
  "02": [14, "GTIN of contained items"],
  "10": [null, "Batch / lot number"],
  "11": [6, "Production date", date6],
  "12": [6, "Due date", date6],
  "13": [6, "Packaging date", date6],
  "15": [6, "Best before date", date6],
  "16": [6, "Sell by date", date6],
  "17": [6, "Expiration date", date6],
  "20": [2, "Product variant"],
  "21": [null, "Serial number"],
  "22": [null, "Consumer product variant"],
  "240": [null, "Additional product ID"],
  "241": [null, "Customer part number"],
  "242": [null, "Made-to-order variation"],
  "243": [null, "Packaging component number"],
  "250": [null, "Secondary serial number"],
  "251": [null, "Reference to source entity"],
  "253": [null, "GDTI"],
  "254": [null, "GLN extension component"],
  "30": [null, "Variable count of items"],
  "37": [null, "Count of trade items"],
  "400": [null, "Customer purchase order number"],
  "401": [null, "GINC (consignment)"],
  "402": [17, "GSIN (shipment)"],
  "403": [null, "Routing code"],
  "410": [13, "Ship to / deliver to GLN"],
  "411": [13, "Bill to / invoice to GLN"],
  "412": [13, "Purchased from GLN"],
  "413": [13, "Ship for / deliver for GLN"],
  "414": [13, "Physical location GLN"],
  "415": [13, "Invoicing party GLN"],
  "416": [13, "Production / service location GLN"],
  "417": [13, "Party GLN"],
  "420": [null, "Ship to postal code (same country)"],
  "421": [null, "Ship to postal code (with country)"],
  "422": [3, "Country of origin", country3],
  "423": [null, "Country of initial processing", country3],
  "424": [3, "Country of processing", country3],
  "425": [null, "Country of disassembly", country3],
  "426": [3, "Country covering full process", country3],
  "427": [null, "Country subdivision of origin"],
  "7001": [13, "NATO stock number"],
  "7003": [10, "Expiration date and time"],
  "8005": [6, "Price per unit of measure"],
  "8018": [18, "GSRN (service relation)"],
  "8020": [null, "Payment slip reference"],
  "8200": [null, "Product URL"],
};

// AI families that share a length: 31nn-36nn measurements, 39nn amounts, 90-99 internal.
function lookup(ai) {
  if (AI[ai]) return AI[ai];
  if (/^3[1-6]\d\d$/.test(ai)) return [6, measureLabel(ai), decimalOf(ai)];
  if (/^39[0-3]\d$/.test(ai)) return [null, "Amount payable", decimalOf(ai)];
  if (/^9[0-9]$/.test(ai)) return [null, `Company internal (${ai})`];
  return null;
}

const MEASURES = {
  310: ["Net weight", "kg"], 311: ["Length", "m"], 312: ["Width", "m"],
  313: ["Height", "m"], 314: ["Area", "m²"], 315: ["Net volume", "l"],
  316: ["Net volume", "m³"], 320: ["Net weight", "lb"], 321: ["Length", "in"],
  322: ["Length", "ft"], 323: ["Length", "yd"], 324: ["Width", "in"],
  327: ["Height", "in"], 330: ["Gross weight", "kg"], 340: ["Gross weight", "lb"],
  350: ["Area", "in²"], 356: ["Net weight", "troy oz"], 360: ["Net volume", "qt"],
  364: ["Net volume", "in³"],
};

function measureLabel(ai) {
  const m = MEASURES[ai.slice(0, 3)];
  return m ? `${m[0]} (${m[1]})` : `Measurement (${ai})`;
}

// The 4th AI digit is an implied decimal-point position.
function decimalOf(ai) {
  const places = Number(ai[3]);
  return (v) => {
    if (!/^\d+$/.test(v)) return v;
    if (places === 0) return String(Number(v));
    const s = v.padStart(places + 1, "0");
    return `${Number(s.slice(0, -places))}.${s.slice(-places)}`;
  };
}

// GS1 dates are YYMMDD. DD == "00" means "end of month, day not specified".
// The century window follows GS1 General Specifications 7.12: a year more than
// 50 ahead of the current year belongs to the previous century.
function date6(v) {
  if (!/^\d{6}$/.test(v)) return v;
  const yy = Number(v.slice(0, 2));
  const mm = v.slice(2, 4);
  const dd = v.slice(4, 6);
  const nowYY = new Date().getFullYear() % 100;
  const century = yy - nowYY >= 51 ? -1 : yy - nowYY <= -50 ? 1 : 0;
  const year = Math.floor(new Date().getFullYear() / 100) * 100 + yy + century * 100;
  return dd === "00" ? `${year}-${mm} (end of month)` : `${year}-${mm}-${dd}`;
}

const COUNTRIES = {
  "004": "Afghanistan", "032": "Argentina", "036": "Australia", "040": "Austria",
  "056": "Belgium", "076": "Brazil", "124": "Canada", "152": "Chile",
  "156": "China", "170": "Colombia", "203": "Czechia", "208": "Denmark",
  "246": "Finland", "250": "France", "276": "Germany", "300": "Greece",
  "348": "Hungary", "356": "India", "372": "Ireland", "376": "Israel",
  "380": "Italy", "392": "Japan", "410": "South Korea", "484": "Mexico",
  "528": "Netherlands", "554": "New Zealand", "578": "Norway", "586": "Pakistan",
  "604": "Peru", "608": "Philippines", "616": "Poland", "620": "Portugal",
  "643": "Russia", "710": "South Africa", "724": "Spain", "752": "Sweden",
  "756": "Switzerland", "764": "Thailand", "792": "Türkiye", "804": "Ukraine",
  "826": "United Kingdom", "840": "United States", "858": "Uruguay",
  "862": "Venezuela", "704": "Viet Nam",
};

export function countryName(code) {
  return COUNTRIES[String(code).padStart(3, "0")] ?? null;
}

function country3(v) {
  const n = countryName(v);
  return n ? `${v} — ${n}` : v;
}


// Parses the parenthesised human-readable form, where each AI is delimited.
function parseHRI(text) {
  const fields = [];
  const warnings = [];
  const re = /\((\d{2,4})\)([^(]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, ai, value] = m;
    const spec = lookup(ai);
    if (!spec) {
      warnings.push(`Unrecognised application identifier (${ai}).`);
      fields.push({ label: `Unknown AI ${ai}`, value });
      continue;
    }
    const [dataLen, label, format] = spec;
    if (dataLen !== null && value.length !== dataLen) {
      warnings.push(`AI ${ai} expects ${dataLen} characters, found ${value.length}.`);
    }
    const formatted = format ? format(value) : value;
    fields.push({
      label,
      value: formatted,
      note: `AI ${ai}`,
      raw: formatted === value ? undefined : value,
    });
  }
  if (!fields.length) warnings.push("No application identifiers found.");
  return { kind: "GS1 element string", fields, warnings };
}

/**
 * Parse a GS1 element string into labelled fields.
 * @param {string} text payload in textMode "Plain"
 */
export function parseGS1(text) {
  // Tolerate the human-readable form "(01)0061…(10)LOT1" as well as raw
  // FNC1-separated data. The parenthesised form delimits every AI explicitly,
  // so it must NOT be flattened into the concatenated form first -- doing that
  // loses the boundaries that variable-length AIs depend on.
  if (/^\(\d{2,4}\)/.test(text)) return parseHRI(text);
  const fields = [];
  const warnings = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === GS) { i++; continue; }

    // AIs are 2-4 digits; try longest first so 3xxx beats 3x.
    let ai = null;
    let spec = null;
    for (const len of [4, 3, 2]) {
      const candidate = text.slice(i, i + len);
      if (!/^\d+$/.test(candidate)) continue;
      const found = lookup(candidate);
      if (found) { ai = candidate; spec = found; break; }
    }

    if (!ai) {
      warnings.push(`Unrecognised application identifier at offset ${i}; stopped parsing.`);
      fields.push({ label: "Unparsed remainder", value: text.slice(i).split(GS).join(" ⎸ ") });
      break;
    }

    i += ai.length;
    const [dataLen, label, format] = spec;
    let value;
    if (dataLen === null) {
      const end = text.indexOf(GS, i);
      value = end === -1 ? text.slice(i) : text.slice(i, end);
      i += value.length;
    } else {
      value = text.slice(i, i + dataLen);
      i += dataLen;
      if (value.length < dataLen) {
        warnings.push(`AI ${ai} expects ${dataLen} characters but only ${value.length} remain.`);
      }
    }

    const formatted = format ? format(value) : value;
    fields.push({
      label,
      value: formatted,
      note: `AI ${ai}`,
      raw: formatted === value ? undefined : value,
    });
  }

  return { kind: "GS1 element string", fields, warnings };
}
