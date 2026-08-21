// Minimal static server for local development. `npm start`
//
// Exists rather than using a generic static server because two headers matter:
// a .wasm served as anything other than application/wasm is rejected by
// WebAssembly.instantiateStreaming, and .webmanifest needs its own type or the
// install prompt never appears.

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const ROOT = fileURLToPath(new URL("../app/", import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";

  // Resolve inside ROOT only; reject any traversal attempt.
  const target = join(ROOT, normalize(pathname).replace(/^([.][.][\\/])+/, ""));
  if (!target.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      res.writeHead(302, { location: `${pathname}/` }).end();
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
      "content-length": info.size,
      // The service worker must never be served stale during development.
      "cache-control": target.endsWith("sw.js") ? "no-store" : "no-cache",
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);

  console.log(`\n  PCG Scan dev server`);
  console.log(`  local   http://localhost:${PORT}/`);
  for (const ip of lan) console.log(`  network http://${ip}:${PORT}/`);
  console.log(
    `\n  Note: the camera needs a secure context. localhost counts as secure,\n` +
      `  but a phone hitting the network address over plain HTTP does not --\n` +
      `  use an HTTPS tunnel for on-device testing (see README).\n`,
  );
});
