// Theme contrast audit. Dev tool, not part of the app.
//
// Measures the *rendered* contrast ratio of every themed component against its
// effective background, in whichever colour scheme the browser is currently
// reporting. Hand-calculating these from hex values is error-prone: the value
// that matters is what the browser actually composites, including inherited and
// semi-transparent backgrounds.
//
// Usage, from the console on index.html:
//   const { audit } = await import('./dev/contrast-audit.js');
//   await audit();
//
// Re-run it after any change to the token blocks in css/app.css, in BOTH
// schemes. Toggle the scheme via the OS setting or devtools rendering panel.

const TARGETS = [
  ["body text", ".field-value"],
  ["field label (dim)", ".field-label"],
  ["field note (faint)", ".field-note"],
  ["result heading", ".result-kind"],
  ["brand PCG", ".brand-pcg"],
  ["badge", ".badge"],
  ["warning text", ".warning"],
  ["warning icon", ".warning-icon"],
  ["inferred flag", ".field-inferred"],
  ["error status", '.status[data-tone="error"]'],
  ["raw meta dt", ".raw-meta dt"],
  ["raw payload", ".raw-text"],
  ["control chip", ".ctrl"],
  ["primary button", ".btn-primary:not([hidden])"],
  ["ghost button", ".btn-ghost"],
  ["torch active", ".btn-ghost.is-on"],
  ["footer", ".footer p"],
  ["stats button", ".icon-btn"],
  ["viewfinder text", ".stage-idle"],
  ["link", ".field-link"],
];

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const parseColor = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);

const contrast = (fg, bg) => {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

// Walks ancestors for the first opaque background, which is what the element's
// text is really sitting on.
function effectiveBackground(el) {
  let node = el;
  while (node) {
    const c = parseColor(getComputedStyle(node).backgroundColor);
    if (c.length === 3 || (c.length === 4 && c[3] > 0.85)) return c.slice(0, 3);
    node = node.parentElement;
  }
  return [255, 255, 255];
}

/**
 * Populates the page with a result card plus the components that only appear in
 * certain states (warnings, inferred labels, error status, active torch), so
 * the audit covers them rather than reporting them absent.
 */
export async function seed() {
  const blob = await (await fetch("./dev/fixtures/aamva-pdf417.png")).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "seed.png", { type: "image/png" }));
  const input = document.getElementById("file-input");
  input.files = dt.files;
  input.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 1800));

  const status = document.getElementById("status");
  status.hidden = false;
  status.dataset.tone = "error";
  status.textContent = "sample error text";

  document.querySelector(".raw")?.setAttribute("open", "");
  document.querySelector(".btn-ghost")?.classList.add("is-on");

  const result = document.querySelector(".result");
  if (!result) throw new Error("no result card rendered; cannot audit");

  if (!result.querySelector(".warning")) {
    const wrap = document.createElement("div");
    wrap.className = "warnings";
    const p = document.createElement("p");
    p.className = "warning";
    const icon = document.createElement("span");
    icon.className = "warning-icon";
    icon.textContent = "!";
    const text = document.createElement("span");
    text.textContent = "sample warning text";
    p.append(icon, text);
    wrap.append(p);
    result.prepend(wrap);
  }
  if (!result.querySelector(".field-inferred")) {
    const flag = document.createElement("span");
    flag.className = "field-inferred";
    flag.textContent = "inferred";
    result.querySelector(".fields dt")?.append(flag);
  }
  if (!result.querySelector(".field-link")) {
    const link = document.createElement("a");
    link.className = "field-link";
    link.href = "https://example.com";
    link.textContent = "https://example.com";
    result.querySelector(".fields dd")?.append(link);
  }
}

/** @returns {{scheme: string, pass: boolean, rows: object[]}} */
export function measure() {
  const rows = [];
  for (const [name, selector] of TARGETS) {
    const el = document.querySelector(selector);
    if (!el) {
      rows.push({ name, ratio: null, need: null, ok: null, note: "absent" });
      continue;
    }
    const cs = getComputedStyle(el);
    const ratio = contrast(parseColor(cs.color).slice(0, 3), effectiveBackground(el));
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    // WCAG "large text" is 24px, or 18.66px when bold.
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    rows.push({ name, ratio: +ratio.toFixed(2), need, ok: ratio >= need, px: +size.toFixed(1) });
  }
  const scheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return { scheme, pass: rows.every((r) => r.ok !== false), rows };
}

/** Seeds the page, measures, and prints a table. */
export async function audit() {
  await seed();
  const result = measure();
  const failures = result.rows.filter((r) => r.ok === false);
  console.log(
    `%c${result.scheme.toUpperCase()} — ${failures.length ? `${failures.length} FAILING` : "all pass"}`,
    `font-weight:bold;color:${failures.length ? "crimson" : "green"}`,
  );
  console.table(
    result.rows.map((r) => ({
      component: r.name,
      ratio: r.ratio ?? "—",
      required: r.need ?? "—",
      px: r.px ?? "—",
      verdict: r.ok === null ? "absent" : r.ok ? "pass" : "FAIL",
    })),
  );
  return result;
}
