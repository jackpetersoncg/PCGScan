// Recognisers for the common non-industrial payloads: URLs, contact cards,
// Wi-Fi joins, calendar events and so on. Mostly QR Code territory.

function kv(label, value, note) {
  return value ? { label, value, note } : null;
}

// Undoes the backslash escaping used by WIFI: and vCard payloads.
function unescapeValue(v) {
  return v.replace(/\\([\\;,:"])/g, "$1");
}

function parseURL(text) {
  const warnings = [];
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  const fields = [
    { label: "URL", value: text, isLink: true },
    { label: "Host", value: url.hostname },
  ];
  if (url.pathname && url.pathname !== "/") fields.push({ label: "Path", value: url.pathname });
  if (url.search) {
    for (const [k, v] of url.searchParams) fields.push({ label: `Query · ${k}`, value: v });
  }

  if (url.protocol === "http:") {
    warnings.push("This link is unencrypted HTTP; the destination cannot be verified.");
  }
  // Punycode host names are the standard vehicle for homograph spoofing.
  if (url.hostname.split(".").some((p) => p.startsWith("xn--"))) {
    warnings.push(
      `The host name uses punycode (${url.hostname}), which can imitate a familiar ` +
        `domain. Check it carefully before opening.`,
    );
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)) {
    warnings.push("The link points at a bare IP address rather than a domain name.");
  }
  if (url.username || url.password) {
    warnings.push("The link embeds credentials in the URL.");
  }

  return { kind: "Web link", fields, warnings };
}

function parseWifi(text) {
  const m = /^WIFI:(.*)$/is.exec(text);
  if (!m) return null;
  const out = {};
  // Split on semicolons that are not backslash-escaped.
  for (const part of m[1].split(/(?<!\\);/)) {
    const eq = part.indexOf(":");
    if (eq === -1) continue;
    out[part.slice(0, eq).toUpperCase()] = unescapeValue(part.slice(eq + 1));
  }
  const AUTH = {
    WPA: "WPA/WPA2", WPA2: "WPA2", WPA3: "WPA3", WEP: "WEP",
    nopass: "Open (no password)", "": "Unspecified",
  };
  const fields = [
    kv("Network name (SSID)", out.S),
    kv("Security", AUTH[out.T] ?? out.T),
    kv("Password", out.P),
    out.H === "true" ? { label: "Hidden network", value: "Yes" } : null,
  ].filter(Boolean);
  const warnings = [];
  if (out.T === "WEP") warnings.push("WEP is obsolete and offers effectively no protection.");
  return { kind: "Wi-Fi network", fields, warnings };
}

const VCARD_LABELS = {
  FN: "Full name", N: "Name", ORG: "Organisation", TITLE: "Job title",
  TEL: "Telephone", EMAIL: "Email", ADR: "Address", URL: "Website",
  NOTE: "Note", BDAY: "Birthday", NICKNAME: "Nickname",
};

function parseVCard(text) {
  if (!/^BEGIN:VCARD/im.test(text)) return null;
  const fields = [];
  // Unfold RFC 6350 continuation lines before parsing.
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  for (const line of lines) {
    const c = line.indexOf(":");
    if (c === -1) continue;
    const [name, ...params] = line.slice(0, c).split(";");
    const key = name.toUpperCase();
    if (key === "BEGIN" || key === "END" || key === "VERSION") continue;
    const label = VCARD_LABELS[key] ?? key;
    const type = params.find((p) => /^TYPE=/i.test(p))?.slice(5).replace(/,/g, ", ");
    let value = line.slice(c + 1).trim();
    if (key === "N" || key === "ADR") value = value.split(";").filter(Boolean).join(", ");
    if (value) {
      fields.push({ label: type ? `${label} (${type})` : label, value: unescapeValue(value) });
    }
  }
  return { kind: "Contact card", fields, warnings: [] };
}

function parseVEvent(text) {
  if (!/BEGIN:VEVENT/i.test(text)) return null;
  const LABELS = {
    SUMMARY: "Title", DTSTART: "Starts", DTEND: "Ends",
    LOCATION: "Location", DESCRIPTION: "Description", ORGANIZER: "Organiser",
  };
  const fields = [];
  for (const line of text.split(/\r?\n/)) {
    const c = line.indexOf(":");
    if (c === -1) continue;
    const key = line.slice(0, c).split(";")[0].toUpperCase();
    if (!LABELS[key]) continue;
    let value = line.slice(c + 1).trim();
    const dt = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(value);
    if (dt) {
      value = `${dt[1]}-${dt[2]}-${dt[3]}` + (dt[4] ? ` ${dt[4]}:${dt[5]}${dt[7] ? " UTC" : ""}` : "");
    }
    fields.push({ label: LABELS[key], value: unescapeValue(value) });
  }
  return { kind: "Calendar event", fields, warnings: [] };
}

function parseScheme(text) {
  const m = /^(mailto|tel|sms|smsto|geo|otpauth|bitcoin|matmsg):(.*)$/is.exec(text);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const rest = m[2];

  if (scheme === "mailto") {
    const [addr, query] = rest.split("?");
    const fields = [kv("To", decodeURIComponent(addr))].filter(Boolean);
    if (query) {
      for (const [k, v] of new URLSearchParams(query)) {
        fields.push({ label: k[0].toUpperCase() + k.slice(1), value: v });
      }
    }
    return { kind: "Email address", fields, warnings: [] };
  }
  if (scheme === "tel") {
    return { kind: "Phone number", fields: [{ label: "Number", value: rest }], warnings: [] };
  }
  if (scheme === "sms" || scheme === "smsto") {
    const [num, body] = rest.split(/[?:]/);
    return {
      kind: "Text message",
      fields: [kv("Number", num), kv("Message", body && decodeURIComponent(body))].filter(Boolean),
      warnings: [],
    };
  }
  if (scheme === "geo") {
    const [lat, lon] = rest.split(",");
    return {
      kind: "Geographic location",
      fields: [kv("Latitude", lat), kv("Longitude", lon)].filter(Boolean),
      warnings: [],
    };
  }
  if (scheme === "otpauth") {
    // Showing a TOTP seed on a screen someone else may be looking at defeats
    // the point of the second factor.
    return {
      kind: "Authenticator secret",
      fields: [{ label: "Payload", value: "not displayed" }],
      warnings: ["This is a two-factor authentication secret, so it is deliberately not shown."],
    };
  }
  return { kind: `${scheme} link`, fields: [{ label: "Value", value: rest }], warnings: [] };
}

function parsePlain(text) {
  const meta = [];
  if (/^\d+$/.test(text)) meta.push("numeric");
  meta.push(`${text.length} character${text.length === 1 ? "" : "s"}`);
  const lines = text.split(/\r?\n/).length;
  if (lines > 1) meta.push(`${lines} lines`);
  return {
    kind: "Plain text",
    fields: [
      { label: "Content", value: text },
      { label: "Characteristics", value: meta.join(", ") },
    ],
    warnings: [],
  };
}

/** Tries each recogniser in specificity order. Always returns a result. */
export function parseGeneric(text) {
  for (const fn of [parseWifi, parseVCard, parseVEvent, parseScheme, parseURL]) {
    const r = fn(text);
    if (r && r.fields.length) return r;
  }
  return parsePlain(text);
}
