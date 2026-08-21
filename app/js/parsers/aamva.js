// AAMVA driver's licence / ID card parser (PDF417).
//
// Layout per the AAMVA DL/ID Card Design Standard:
//   "@" LF RS CR "ANSI " <IIN:6> <ver:2> <jurisdictionVer:2> <entries:2>
//   then one 10-char subfile designator per entry: <type:2><offset:4><length:4>
//   then the subfiles themselves, each a run of LF-separated elements whose
//   first three characters are the element ID.
//
// Real-world cards deviate from the spec constantly (wrong offsets, CR vs LF,
// missing header counts), so this reads the header for metadata but recovers the
// elements by scanning rather than trusting the declared offsets.

const ELEMENTS = {
  DAQ: "Licence / ID number",
  DCS: "Family name",
  DAC: "First name",
  DAD: "Middle name",
  DCU: "Name suffix",
  DBD: "Issue date",
  DBB: "Date of birth",
  DBA: "Expiration date",
  DBC: "Sex",
  DAY: "Eye colour",
  DAZ: "Hair colour",
  DAU: "Height",
  DAW: "Weight (lb)",
  DAX: "Weight (kg)",
  DCE: "Weight range",
  DAG: "Street address",
  DAH: "Street address 2",
  DAI: "City",
  DAJ: "State / province",
  DAK: "Postal code",
  DCG: "Country",
  DCF: "Document discriminator",
  DCK: "Inventory control number",
  DCA: "Vehicle class",
  DCB: "Restriction codes",
  DCD: "Endorsement codes",
  DCL: "Race / ethnicity",
  DCI: "Place of birth",
  DDA: "Compliance type",
  DDB: "Card revision date",
  DDC: "HazMat endorsement expiry",
  DDD: "Limited duration document",
  DDE: "Family name truncated",
  DDF: "First name truncated",
  DDG: "Middle name truncated",
  DDH: "Under-18 until",
  DDI: "Under-19 until",
  DDJ: "Under-21 until",
  DDK: "Organ donor",
  DDL: "Veteran",
};

const SEX = { 1: "Male", 2: "Female", 9: "Not specified" };
const COLOURS = {
  BLK: "Black", BLU: "Blue", BRO: "Brown", GRY: "Grey", GRN: "Green",
  HAZ: "Hazel", MAR: "Maroon", PNK: "Pink", DIC: "Dichromatic",
  BAL: "Bald", BLD: "Blonde", RED: "Red/Auburn", SDY: "Sandy", WHI: "White",
  UNK: "Unknown",
};
const TRUNCATION = { T: "Truncated", N: "Not truncated", U: "Unknown" };
const COMPLIANCE = { F: "Fully compliant", N: "Non-compliant" };

// Dates are MMDDCCYY in the US and CCYYMMDD in Canada. The country element is
// the reliable discriminator; where it is absent, a leading value above 12
// cannot be a month.
function parseDate(v, country) {
  if (!/^\d{8}$/.test(v)) return v;
  const canadian = country === "CAN" || Number(v.slice(0, 2)) > 12;
  const [y, m, d] = canadian
    ? [v.slice(0, 4), v.slice(4, 6), v.slice(6, 8)]
    : [v.slice(4, 8), v.slice(0, 2), v.slice(2, 4)];
  return `${y}-${m}-${d}`;
}

function parseHeight(v) {
  const m = /^(\d{2,3})\s*(IN|CM)$/i.exec(v.trim());
  if (!m) return v;
  const n = Number(m[1]);
  if (m[2].toUpperCase() === "IN") return `${Math.floor(n / 12)}' ${n % 12}" (${n} in)`;
  return `${n} cm`;
}

/**
 * @param {string} text payload in textMode "Plain"
 */
export function parseAAMVA(text) {
  const warnings = [];
  const header = /ANSI\s?(\d{6})(\d{2})(\d{2})?(\d{2})?/.exec(text);

  // Elements run from their 3-char ID to the next LF, CR or RS. The leading
  // \x0a|\x0d|\x1e anchor prevents matching an ID that appears inside a value.
  const raw = new Map();
  const re = /[\n\r\u001e]([DZ][A-Z]{2})([^\n\r\u001e]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, id, value] = m;
    if (!raw.has(id)) raw.set(id, value.trim());
  }

  // The first subfile's first element sits right after the designator block and
  // has no preceding LF, so pick it up separately.
  const firstEl = /(?:DL|ID)([DZ][A-Z]{2})([^\n\r\u001e]*)/.exec(text);
  if (firstEl && !raw.has(firstEl[1])) raw.set(firstEl[1], firstEl[2].trim());

  if (!raw.size) {
    return { kind: "AAMVA card", fields: [], warnings: ["No AAMVA data elements found."] };
  }

  const country = raw.get("DCG");
  const fields = [];
  const unknown = [];

  // Present a stable, human-sensible order rather than the card's byte order.
  const ORDER = [
    "DCS", "DAC", "DAD", "DCU", "DBB", "DBC", "DAQ", "DBA", "DBD",
    "DAG", "DAH", "DAI", "DAJ", "DAK", "DCG",
    "DAU", "DAW", "DAX", "DCE", "DAY", "DAZ",
    "DCA", "DCB", "DCD", "DDK", "DDL",
    "DCF", "DCK", "DDA", "DDB", "DDH", "DDI", "DDJ",
  ];
  const keys = [...ORDER.filter((k) => raw.has(k)), ...[...raw.keys()].filter((k) => !ORDER.includes(k))];

  for (const id of keys) {
    const value = raw.get(id);
    if (value === "" || value === "NONE") continue;
    const label = ELEMENTS[id];
    if (!label) { unknown.push({ id, value }); continue; }

    let shown = value;
    if (/^(DBB|DBA|DBD|DDB|DDC|DDH|DDI|DDJ)$/.test(id)) shown = parseDate(value, country);
    else if (id === "DBC") shown = SEX[value] ?? value;
    else if (id === "DAY" || id === "DAZ") shown = COLOURS[value.toUpperCase()] ?? value;
    else if (id === "DAU") shown = parseHeight(value);
    else if (/^DD[EFG]$/.test(id)) shown = TRUNCATION[value] ?? value;
    else if (id === "DDA") shown = COMPLIANCE[value] ?? value;
    else if (id === "DDK" || id === "DDL") shown = value === "1" ? "Yes" : "No";

    fields.push({ label, value: shown, note: id, raw: shown === value ? undefined : value });
  }

  for (const { id, value } of unknown) {
    fields.push({ label: `Jurisdiction-specific (${id})`, value, note: id });
  }

  const meta = [];
  if (header) {
    meta.push({ label: "Issuer identification number", value: header[1], note: "IIN" });
    meta.push({ label: "AAMVA version", value: header[2] });
  } else {
    warnings.push("No ANSI header found — element IDs were recovered by scanning.");
  }

  const expiry = raw.get("DBA");
  if (expiry && /^\d{8}$/.test(expiry)) {
    const iso = parseDate(expiry, country);
    if (Date.parse(iso) < Date.now()) warnings.push(`Document expired ${iso}.`);
  }

  return { kind: "AAMVA driver's licence / ID", fields: [...meta, ...fields], warnings };
}

/** Cheap discriminator used by the dispatcher. */
export function looksLikeAAMVA(text) {
  return /ANSI\s?\d{6}/.test(text.slice(0, 40)) || /^@[\n\r\u001e]/.test(text);
}
