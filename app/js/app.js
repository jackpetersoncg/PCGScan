// Application wiring: startup, controls, and the scan -> parse -> render cycle.

import { Scanner } from "./scanner.js";
import { warmUp, decodeStill } from "./decode.js";
import { parse } from "./parsers/index.js";
import { renderResult, renderMultiple } from "./render.js";
import { initTheme } from "./theme.js";

const $ = (id) => document.getElementById(id);

const ui = {
  stage: $("stage"),
  video: $("preview"),
  guide: $("guide"),
  results: $("results"),
  status: $("status"),
  start: $("btn-start"),
  again: $("btn-again"),
  torch: $("btn-torch"),
  photo: $("btn-photo"),
  file: $("file-input"),
  cameras: $("camera-select"),
  cameraRow: $("camera-row"),
  zoom: $("zoom-input"),
  zoomRow: $("zoom-row"),
  diag: $("diagnostics"),
  diagToggle: $("btn-diag"),
  theme: document.querySelector(".segmented[role='radiogroup']"),
};

let scanner = null;
let torchOn = false;
let diagVisible = false;

function setStatus(message, tone = "info") {
  ui.status.textContent = message ?? "";
  ui.status.dataset.tone = tone;
  ui.status.hidden = !message;
}

function setScanning(active) {
  ui.stage.classList.toggle("is-scanning", active);
  ui.start.hidden = active;
  ui.again.hidden = true;
  ui.photo.disabled = false;
}

function showResult(node) {
  ui.results.replaceChildren(node);
  ui.results.hidden = false;
  ui.stage.classList.remove("is-scanning");
  ui.again.hidden = false;
  ui.start.hidden = true;
  ui.results.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearResult() {
  ui.results.replaceChildren();
  ui.results.hidden = true;
}

// ---------------------------------------------------------------- scanning ---

async function refreshCameraList() {
  const cameras = await Scanner.listCameras();
  if (cameras.length < 2) {
    ui.cameraRow.hidden = true;
    return;
  }
  ui.cameras.replaceChildren();
  cameras.forEach((cam, i) => {
    const opt = document.createElement("option");
    opt.value = cam.deviceId;
    // Labels are empty until permission is granted, hence the fallback.
    opt.textContent = cam.label || `Camera ${i + 1}`;
    ui.cameras.append(opt);
  });
  // Show the camera actually in use. Phones commonly default to the ultrawide,
  // which focuses poorly up close -- the user needs to see which one is live in
  // order to switch off it.
  const active = scanner.activeDeviceId;
  if (active && cameras.some((c) => c.deviceId === active)) ui.cameras.value = active;
  ui.cameraRow.hidden = false;
}

function applyCapabilities() {
  const caps = scanner.capabilities;

  // Torch is Android-only in practice; hiding it beats showing a dead control.
  ui.torch.hidden = !caps.torch;
  if (caps.zoom && caps.zoom.max > caps.zoom.min) {
    ui.zoom.min = caps.zoom.min;
    ui.zoom.max = caps.zoom.max;
    ui.zoom.step = caps.zoom.step || 0.1;
    ui.zoom.value = caps.zoom.min;
    ui.zoomRow.hidden = false;
  } else {
    ui.zoomRow.hidden = true;
  }
}

async function startScanning(deviceId) {
  clearResult();
  setStatus("Starting camera…");
  try {
    await scanner.start(deviceId);
  } catch (err) {
    setStatus(err.message, "error");
    setScanning(false);
    ui.start.hidden = false;
    return;
  }
  await refreshCameraList();
  applyCapabilities();
  setScanning(true);
  setStatus("Point the camera at a barcode.");
}

function onResult(result) {
  scanner.pause();
  const parsed = parse(result);
  showResult(renderResult(result, parsed));
  setStatus(null);
  if (navigator.vibrate) navigator.vibrate(40);
}

function onStats(stats) {
  if (!diagVisible) return;
  ui.diag.textContent =
    `${stats.fps.toFixed(1)} scans/s · ${stats.avgDecodeMs.toFixed(0)} ms per frame` +
    (stats.resolution ? ` · sensor ${stats.resolution}` : "");
}

function onError(err) {
  setStatus(err.message, "error");
}

// ------------------------------------------------------------ still images ---

async function scanStill(file) {
  if (!file) return;
  scanner?.pause();
  setStatus("Reading image…");
  ui.photo.disabled = true;
  try {
    const results = await decodeStill(file);
    if (!results.length) {
      setStatus(
        "No barcode found in that image. Fill the frame with the symbol, keep it " +
          "square-on, and avoid glare.",
        "error",
      );
      return;
    }
    showResult(renderMultiple(results.map((result) => ({ result, parsed: parse(result) }))));
    setStatus(null);
  } catch (err) {
    setStatus(`Could not read that image: ${err.message}`, "error");
  } finally {
    ui.photo.disabled = false;
    ui.file.value = "";
  }
}

// ----------------------------------------------------------------- startup ---

function wireControls() {
  ui.start.addEventListener("click", () => startScanning(ui.cameras.value || undefined));

  ui.again.addEventListener("click", () => {
    clearResult();
    setScanning(true);
    setStatus("Point the camera at a barcode.");
    scanner.resume();
  });

  ui.cameras.addEventListener("change", () => startScanning(ui.cameras.value));

  ui.torch.addEventListener("click", async () => {
    torchOn = !torchOn;
    const ok = await scanner.setTorch(torchOn);
    if (!ok) {
      torchOn = false;
      setStatus("This device did not accept torch control.", "error");
      return;
    }
    ui.torch.setAttribute("aria-pressed", String(torchOn));
    ui.torch.classList.toggle("is-on", torchOn);
  });

  ui.zoom.addEventListener("input", () => scanner.setZoom(Number(ui.zoom.value)));

  ui.photo.addEventListener("click", () => ui.file.click());
  ui.file.addEventListener("change", () => scanStill(ui.file.files?.[0]));

  ui.diagToggle.addEventListener("click", () => {
    diagVisible = !diagVisible;
    ui.diag.hidden = !diagVisible;
    ui.diagToggle.setAttribute("aria-pressed", String(diagVisible));
    if (!diagVisible) ui.diag.textContent = "";
  });

  // Releasing the camera when backgrounded avoids the "camera in use" state
  // some Android builds get stuck in, and stops draining the battery.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) scanner?.pause();
    else if (ui.stage.classList.contains("is-scanning")) scanner?.resume();
  });
}

async function main() {
  // Before the guards below: the theme switch must stay usable even when the
  // app cannot scan (insecure context, engine failed to load), or the user is
  // stuck with an error message they may not be able to read comfortably.
  initTheme(ui.theme);

  if (!window.isSecureContext) {
    setStatus(
      "Camera access needs a secure context. Open this app over HTTPS (or on " +
        "localhost) — plain HTTP will not work.",
      "error",
    );
    ui.start.disabled = true;
    return;
  }

  scanner = new Scanner({
    video: ui.video,
    container: ui.stage,
    onResult,
    onStats,
    onError,
  });

  wireControls();

  setStatus("Loading barcode engine…");
  try {
    await warmUp();
  } catch (err) {
    setStatus(err.message, "error");
    ui.start.disabled = true;
    return;
  }
  setStatus("Ready. Tap Start scanning.");

  if ("serviceWorker" in navigator) {
    // Registration failure only costs offline support, so it must not block use.
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

main();
