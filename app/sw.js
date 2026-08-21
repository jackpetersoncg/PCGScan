// Service worker: makes the app installable and usable with no network.
//
// Strategy is deliberately simple and conservative:
//   * app shell + WASM  -> cache-first, because they are versioned by CACHE below
//   * everything else   -> network, falling back to cache
//
// Bump CACHE on every deploy. Without that, clients keep serving the old shell.

// v4: scan history + CSV export (js/history.js)
const CACHE = "pcg-scan-v4";

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/scanner.js",
  "./js/decode.js",
  "./js/render.js",
  "./js/theme.js",
  "./js/theme-init.js",
  "./js/history.js",
  "./js/parsers/index.js",
  "./js/parsers/gs1.js",
  "./js/parsers/aamva.js",
  "./js/parsers/iso15434.js",
  "./js/parsers/generic.js",
  "./vendor/zxing-wasm/reader/index.js",
  "./vendor/zxing-wasm/share.js",
  "./vendor/zxing-wasm/reader/zxing_reader.wasm",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll is atomic — one 404 discards the whole install, which would
      // leave the app permanently uncached. Cache entries individually instead.
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {
            console.warn(`[pcg-scan] could not pre-cache ${url}`);
          }),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Only same-origin traffic is cached. The Google Fonts stylesheet is left to
  // the browser's own HTTP cache; offline it simply falls back to system fonts.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        // Navigations must resolve to something, or the user sees a browser error.
        if (request.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        return new Response("Offline and not cached.", {
          status: 503,
          headers: { "content-type": "text/plain" },
        });
      }
    })(),
  );
});
