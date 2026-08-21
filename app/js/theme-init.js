// Pre-paint theme application. Loaded as a CLASSIC script in <head> — not a
// module — because module scripts are deferred and would run after first paint,
// producing a visible flash of the wrong theme for anyone whose choice differs
// from their phone's setting.
//
// Its only job is to resolve the stored preference to a concrete theme and set
// the attribute css/app.css keys off. Everything interactive (the switch,
// persistence, following live system changes) lives in the theme.js module.
//
// Shared by index.html and dev/selftest.html so the diagnostic page themes
// correctly too. The resolution logic is intentionally mirrored in theme.js;
// keep STORAGE_KEY and the two colours in step across both files.
(function () {
  var STORAGE_KEY = "pcg-scan-theme";
  var THEME_COLOR = { light: "#ffffff", dark: "#0b120e" };

  var stored;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    // Storage throws in some locked-down and private-browsing modes. Falling
    // through to the system preference is the right behaviour, not an error.
  }

  var theme;
  if (stored === "light" || stored === "dark") {
    theme = stored;
  } else {
    theme =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  }

  document.documentElement.setAttribute("data-theme", theme);

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLOR[theme];
})();
