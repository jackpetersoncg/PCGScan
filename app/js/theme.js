// Theme preference: auto (follow the phone), light, or dark.
//
// "auto" is a *preference*, not a theme. It is resolved here to a concrete
// "light" or "dark" and written to <html data-theme>, which is the only thing
// css/app.css looks at. Resolving in JS rather than in a media query means each
// palette is defined exactly once -- see the note at the top of app.css.
//
// The forcing case is real: a field tool in direct sunlight is more legible in
// light mode regardless of what the phone's system setting says, and at night
// the reverse. Hence a manual override rather than system-only.

// Must match the key used by the inline pre-paint script in index.html.
const STORAGE_KEY = "pcg-scan-theme";

const PREFERENCES = ["auto", "light", "dark"];

// Kept in step with --bg for each theme so the browser and OS chrome
// (status bar, tab strip) match the page rather than banding against it.
const THEME_COLOR = { light: "#ffffff", dark: "#0b120e" };

const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");

/** @returns {"auto"|"light"|"dark"} */
export function getPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (PREFERENCES.includes(stored)) return stored;
  } catch {
    // Storage can throw in locked-down or private browsing modes; auto is a
    // perfectly good fallback, so this is not worth surfacing.
  }
  return "auto";
}

/** Resolves a preference to the theme actually rendered. */
export function resolve(preference = getPreference()) {
  if (preference === "light" || preference === "dark") return preference;
  return darkQuery?.matches ? "dark" : "light";
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;

  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = THEME_COLOR[theme];
}

/** @param {"auto"|"light"|"dark"} preference */
export function setPreference(preference) {
  if (!PREFERENCES.includes(preference)) return;
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Preference will not survive a reload, but the session still honours it.
  }
  apply(resolve(preference));
}

/**
 * Wires the radio group and starts following system changes.
 *
 * Real radio inputs are used rather than buttons with aria-pressed: the browser
 * then supplies exclusive selection, arrow-key navigation and the correct
 * screen-reader semantics for free.
 *
 * @param {HTMLElement} [container] element holding the radio inputs
 */
export function initTheme(container) {
  const preference = getPreference();
  apply(resolve(preference));

  if (container) {
    const inputs = container.querySelectorAll('input[type="radio"]');
    for (const input of inputs) {
      input.checked = input.value === preference;
      input.addEventListener("change", () => {
        if (input.checked) setPreference(input.value);
      });
    }
  }

  // Only relevant while the preference is "auto" -- an explicit choice should
  // survive the user changing their phone's setting.
  darkQuery?.addEventListener?.("change", () => {
    if (getPreference() === "auto") apply(resolve("auto"));
  });
}
