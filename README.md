# PCG Scan

A branded, installable barcode scanner for iOS and Android that reads
**PDF417, Data Matrix, QR Code, MaxiCode and Aztec**. It is a Progressive Web
App: one static site, installed to the home screen, no app stores and no
developer accounts. All decoding happens on the device — nothing is uploaded.

## → **[Open the app](https://jackpetersoncg.github.io/PCGScan/)**

On a phone, open that link and choose **Share → Add to Home Screen** (iOS) or
**⋮ → Add to Home screen** (Android) to install it.

Before trusting a device in the field, open
**[the self test](https://jackpetersoncg.github.io/PCGScan/dev/selftest.html)**
on it — it decodes a known symbol of all five formats and reports what that
particular phone can actually read.

---

## Why a PWA, and why this decoder

The format list drove both decisions.

The free scanners built into the two platforms — Google ML Kit on Android and
Apple's Vision framework on iOS — read QR, Data Matrix, PDF417 and Aztec, but
**neither supports MaxiCode**. Requiring MaxiCode rules them out, and with them
the easy native path.

That leaves ZXing-C++ (free, reads all five) or a commercial SDK such as Scandit
or Dynamsoft (robust MaxiCode, per-app annual licensing). This app uses
**ZXing-C++ compiled to WebAssembly** ([`zxing-wasm`][zxing-wasm] 3.1.3), which
runs identically in Safari and Chrome — so one codebase covers both platforms
with no native build, no Xcode and no Mac.

### The MaxiCode caveat, stated plainly

MaxiCode is verified working (see [Testing](#testing)), but it is the weakest of
the five in ZXing-C++. It is `read`-only in the library — there is no encoder —
and its detector wants a reasonably square-on, evenly lit, in-focus symbol. QR
and Data Matrix tolerate far more angle, blur and glare.

If field read rates on real UPS labels prove disappointing, the fix is to swap
the decode engine rather than rewrite the app: everything behind
[`app/js/decode.js`](app/js/decode.js) is isolated to that one file. Budget for
a commercial SDK evaluation before assuming this is good enough for
high-throughput receiving.

[zxing-wasm]: https://github.com/Sec-ant/zxing-wasm

---

## Getting started

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Then open <http://localhost:8080>. `localhost` counts as a secure context, so
the camera works without HTTPS during development.

### Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Static dev server on port 8080 with correct `.wasm` MIME types |
| `npm run build` | Regenerates vendored WASM, icons and test fixtures |
| `npm test` | Parser (29 cases) and CSV export (43 cases) suites, pure Node |
| `npm run verify` | Encodes a symbol of each format and round-trips it through the decoder |

`npm run build` must be run at least once before the app will load — it copies
the WASM binary into `app/vendor/`.

---

## Testing on a phone

Easiest path: open the [deployed app](https://jackpetersoncg.github.io/PCGScan/)
— it is already on HTTPS, so nothing needs setting up.

To test *uncommitted local changes* on a phone, note that the camera requires a
**secure context**. `localhost` qualifies; a LAN address over plain HTTP does
not, and iOS is strict about this. Options:

- **Android**: `chrome://inspect` port forwarding lets the phone reach
  `localhost:8080` directly as a secure origin.
- **Either platform**: an HTTPS tunnel — `npx localtunnel --port 8080`,
  `cloudflared tunnel --url http://localhost:8080`, or ngrok.

### Theming

A **Theme** row in the app offers *Auto / Light / Dark*. Auto follows the
phone's setting and tracks changes to it live; an explicit choice overrides the
phone in both directions and persists in `localStorage`. The override exists
because the right theme outdoors is a lighting question, not a system-settings
question — direct sun favours light regardless of what the phone says.

Every colour in [`app/css/app.css`](app/css/app.css) is a semantic token
(`--text`, `--accent`, `--warn-bg`); the brand hexes are raw ingredients that
only the token layer consumes. To retheme, change the tokens, not the rules.

The theme is keyed off `<html data-theme>`, set to a concrete `light` or `dark`.
It is deliberately **not** a `prefers-color-scheme` media query: supporting an
explicit override through a media query needs the dark palette written twice
(once for `@media dark`, again for `[data-theme="dark"]`), and two copies of a
palette drift apart. Resolving the system preference in JS keeps one definition
per token.

That resolution happens in two places, which is intentional:

- [`js/theme-init.js`](app/js/theme-init.js) — a *classic* script in `<head>`,
  so it runs before first paint and nobody sees a flash of the wrong theme.
  Module scripts are deferred and would be too late. Shared with the self-test
  page so that themes correctly too.
- [`js/theme.js`](app/js/theme.js) — the module handling the switch,
  persistence, and the `matchMedia` listener that keeps Auto current.

Keep the storage key and the two `theme-color` values in step across both.
The switch is initialised before the camera and engine guards in `app.js`, so it
still works when the app cannot scan at all.

**The viewfinder is deliberately exempt.** `--stage-*` and `--scrim` stay dark
in both themes, because that surface is live camera video rather than UI: a
bright scrim reflects off glossy labels, and the guide overlay has to stay
legible against whatever the camera sees. Both platforms' camera apps do the
same.

Contrast is verified, not eyeballed. After changing any token, run the audit in
**both** schemes:

```js
const { auditBoth } = await import('./dev/contrast-audit.js'); await auditBoth();
```

It measures the *rendered* ratio of every themed component against its
effective background and prints a pass/fail table for both palettes, driving
`data-theme` itself so you do not have to touch the OS setting. All 30
components currently pass WCAG AA in both. It clicks the Stats toggle and needs
at least one saved scan, so the diagnostics panel and history rows exist to be
measured rather than reported absent.

Worth knowing: the warm grays straight off the brand sheet (Warm Gray 8 `#8D827A`) fail at 4.05:1 on white, and PCG orange
fails badly as text at 2.4:1 — which is why muted text is darkened from the
brand value and light-mode warnings use dark text on a pale orange tint,
keeping orange for the border and icon only.

### Device self test

Open **`/dev/selftest.html`** on any device to decode a known symbol of every
supported format and check the parsed output against expected values. This is
how you tell "this phone cannot read MaxiCode" apart from "that label is
damaged" — the fixtures are generated by an independent encoder (BWIPP), not by
the decoder under test.

The `app/dev/` directory is a diagnostic tool, not part of the app. Delete it
before deploying if you would rather not ship it.

---

## Deploying

Deployment is automatic. Pushing to `main` runs
[`.github/workflows/pages.yml`](.github/workflows/pages.yml), which gates on the
test suites and then publishes to GitHub Pages at
<https://jackpetersoncg.github.io/PCGScan/>.

GitHub Pages can only serve from the repository root or `/docs`, but the
deployable artifact is `app/`. The workflow therefore uploads `app/` as the
Pages artifact, which serves it from the site root without restructuring the
repository. Pages already serves `.wasm` as `application/wasm` and
`.webmanifest` as `application/manifest+json`, both verified live.

**On every deploy, bump `CACHE` in [`app/sw.js`](app/sw.js).** The service
worker serves the app shell cache-first, so without a version bump installed
clients keep running the old code indefinitely. This is the single easiest
thing to forget and the most confusing to debug.

One quirk to expect when testing a fresh deploy in a plain browser tab: Pages
serves assets with `Cache-Control: max-age=600`, so for up to ten minutes a
reload can pair newly-fetched HTML with a still-cached `app.js` and the app will
look half-updated — new markup, old behaviour. Hard-reload to confirm before
chasing it as a bug. Installed users are not affected: the service worker serves
the whole shell from one versioned cache, so they never get a mixed set.

### Hosting it elsewhere

`app/` is the entire deployable artifact — plain static files, no server-side
anything. It needs only HTTPS and the two MIME types above. **Azure Static Web
Apps** is a natural fit alongside PCG's Microsoft 365 tenancy if this ever needs
to move somewhere private; Cloudflare Pages and Netlify work identically. A
plain IIS site works too, but IIS does not know the `.wasm` MIME type by
default — you have to add it, or the decoder will refuse to load.

---

## What it does with a scan

A decoded symbol is **parsed into labelled fields** and displayed, then saved to
a local **history** which can be **exported as CSV**. (There is still no
clipboard action; that was offered and not selected.)

### History

Stored in `localStorage`, newest first, capped at 500 entries. Only
`{text, format, contentType}` plus a timestamp is persisted — the parsed view is
re-derived on display and on export, so parser improvements apply retroactively
to old scans and there is no second copy of the same data to keep in sync.

Two deliberate behaviours:

- **Authenticator secrets are never saved.** The parser already refuses to
  display an `otpauth:` payload; writing it to `localStorage` in the clear would
  undo that, so those scans are skipped and the user is told.
- **History can hold personal data.** An AAMVA scan means a name, date of birth
  and address sitting on the device. The UI says so and offers **Clear**; the
  data never leaves the phone.

Tapping a history row re-renders that scan's full parsed card.

### CSV export

Every parsed field label seen across the export becomes its own column, so a
batch of GS1 scans yields real `GTIN` / `Batch / lot number` / `Expiration date`
columns rather than one opaque blob. Mixed batches are correspondingly sparse,
which is the honest representation of mixed data. Fixed columns come first
(timestamps in both local and UTC), with the raw payload and any parser warnings
last.

Four things the CSV layer gets right, all covered by
[`scripts/test-history.mjs`](scripts/test-history.mjs) (43 cases) because each
fails silently rather than loudly:

- **Formula injection.** A payload beginning `=`, `+`, `-` or `@` executes as a
  formula when the file opens in Excel or Sheets. Barcode contents are untrusted
  input, so those cells are prefixed with an apostrophe to force text.
- **RFC 4180 quoting.** An unescaped quote shifts every later column.
- **Control characters** become named tokens (`<GS>`, `<RS>`). Raw `0x1D` bytes
  corrupt the file for most readers, and newlines are tokenised too so no cell
  ever spans lines — AAMVA payloads are full of both.
- **Unique headers.** The ISO 15434 parser emits a field called `Format`, which
  collided with the symbology column; that column is now `Symbology`, and any
  remaining collision is suffixed rather than duplicated.

Export prefers the **share sheet** (`navigator.share`) where available, because
on iOS that is markedly more reliable from an installed PWA than a download and
puts the file straight into Mail or Files. Elsewhere it falls back to a download
link. A UTF-8 BOM is prepended so Excel reads the encoding correctly instead of
mangling the em dashes in country names.

The parsers live in [`app/js/parsers/`](app/js/parsers/):

| Parser | Handles | Notable behaviour |
| --- | --- | --- |
| `gs1.js` | GS1 application identifiers | AI length table (fixed vs variable), implied decimal points, `YYMMDD` dates with the GS1 century window, `DD=00` end-of-month, ISO 3166 country names. Accepts both the raw FNC1 stream and the `(01)…` human-readable form. |
| `aamva.js` | Driver's licences / ID cards (PDF417) | Recovers elements by scanning rather than trusting the header's declared offsets, because real cards get them wrong. US `MMDDCCYY` vs Canadian `CCYYMMDD` dates, height/sex/eye-colour code expansion, expiry warning. |
| `iso15434.js` | MaxiCode + industrial `[)>` envelopes | Format-ID dispatch (`01` transportation, `05` delegates to GS1, `14`/`20` text). See below. |
| `generic.js` | URLs, Wi-Fi, vCard, calendar, `mailto:`/`tel:`/`geo:` | Flags punycode homograph hosts, plain HTTP, bare-IP hosts and embedded credentials. Never auto-navigates. Refuses to display `otpauth:` secrets. |

Dispatch uses ZXing's own `contentType` (`GS1`, `ISO15434`) where available,
which is more reliable than sniffing the text.

### One design decision worth knowing about

Carrier field order inside an ISO 15434 format-01 record varies between
carriers and label revisions, and optional fields are sometimes simply absent —
which shifts every field after them. Rather than trust a fixed table,
`iso15434.js` validates the shape of each field it is about to label (a package
count looks like `1/1`, an address-validation flag is `Y` or `N`). If the shapes
do not line up it **stops labelling and says so**, showing the fields
unlabelled with their positions instead. Labels it does apply from carrier
convention rather than from the data are marked *inferred* in the UI.

On a shipping document, a confidently wrong label is worse than no label.

---

## How it is put together

```
app/                      ← the entire deployable artifact
├── index.html
├── manifest.webmanifest
├── sw.js                 ← bump CACHE on every deploy
├── css/app.css           ← PCG palette; guide-box offsets mirror scanner.js
├── js/
│   ├── app.js            ← startup, controls, scan → parse → render cycle
│   ├── scanner.js        ← camera, frame loop, guide → sensor mapping
│   ├── decode.js         ← the only file that knows about ZXing
│   ├── render.js         ← builds DOM nodes, never innerHTML
│   ├── history.js        ← scan history + CSV export
│   ├── theme.js          ← theme switch, persistence, system tracking
│   ├── theme-init.js     ← classic script; applies theme before first paint
│   └── parsers/
├── vendor/zxing-wasm/    ← generated by `npm run build:vendor`
├── icons/                ← generated by `npm run build:icons`
└── dev/                  ← device self test; safe to delete
scripts/                  ← build + test tooling (never shipped)
```

Three things here are load-bearing and easy to break:

1. **`textMode: "Plain"`** in `decode.js`. The library's default renders control
   characters as printable escapes like `<GS>`, which destroys the byte
   structure every structured parser depends on.

2. **`locateFile`** is overridden so the `.wasm` loads from our own origin. The
   default points at the jsDelivr CDN, which would break offline use and add a
   third-party request to every cold start.

3. **The guide-box constants.** `GUIDE` in `scanner.js` and the `.guide`
   offsets in `app.css` describe the same rectangle. The video is displayed
   with `object-fit: cover`, so `mapGuideToVideo()` reverses that centre crop to
   find the matching sensor pixels. If the two drift apart, the app decodes an
   area that is not the box the user is aiming with — which reads as "the
   scanner is just bad". Change them together.

Barcode content is untrusted input: a QR code containing markup is trivial to
produce. `render.js` therefore builds DOM nodes and assigns via `textContent`,
and decoded links are never auto-navigated.

---

## Known limits

- **MaxiCode is the weak format.** See the caveat above.
- **Torch is Android-only.** iOS Safari exposes no torch API; the button is
  hidden when the capability is absent rather than shown dead.
- **Brand fonts need the network.** Prompt and Montserrat load from Google
  Fonts, so offline use falls back to the system stack. Self-host WOFF2 files if
  brand-exact type offline matters.
- **The install splash screen is always dark.** A web manifest has no
  per-scheme form of `background_color`, and it cannot see the in-app theme
  choice at all, so light-theme users get a brief dark splash before the app
  paints. Dark was chosen over white because the green icon reads better on it,
  and a white flash at night is more jarring than a dark one in daylight. iOS's
  `apple-mobile-web-app-status-bar-style` has the same limitation, which is why
  it is set to `default` and the status bar is tinted from a `theme-color` tag
  that `theme.js` keeps current instead.
- **The GS1 AI table is a working subset**, covering trade and logistics
  identifiers rather than all ~450 AIs. Unrecognised AIs are reported as such,
  not silently dropped. Extend the table in `gs1.js`.
- **iOS PWA camera performance** trails a native app. If throughput becomes the
  binding constraint, the parsers and UI port directly to a React Native shell
  — only `scanner.js` and `decode.js` would be replaced.
