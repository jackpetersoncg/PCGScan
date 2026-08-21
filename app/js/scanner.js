// Camera plumbing and the frame loop.
//
// The awkward part of any web scanner is the coordinate mapping. The video is
// displayed with `object-fit: cover`, so what the user sees is a centre crop of
// the sensor frame. The scan region must be derived from the *same* mapping as
// the on-screen guide, or the app decodes an area that does not match the box
// the user is aiming with -- which reads as "the scanner is just bad".

import { decodeFrame } from "./decode.js";

// Fractions of the container occupied by the guide box, mirrored in app.css.
// Kept here as the single source of truth for the mapping maths.
export const GUIDE = { left: 0.06, right: 0.06, top: 0.18, bottom: 0.18 };

// Bound per-frame decode cost. Beyond this the extra pixels buy little for a
// symbol that is filling the guide box anyway.
const MAX_SCAN_EDGE = 1600;

export class Scanner {
  /**
   * @param {object} opts
   * @param {HTMLVideoElement} opts.video
   * @param {HTMLElement} opts.container element the video is fitted into
   * @param {(result: object) => void} opts.onResult
   * @param {(stats: object) => void} [opts.onStats]
   * @param {(err: Error) => void} opts.onError
   */
  constructor({ video, container, onResult, onStats, onError }) {
    this.video = video;
    this.container = container;
    this.onResult = onResult;
    this.onStats = onStats ?? (() => {});
    this.onError = onError;

    this.stream = null;
    this.track = null;
    this.running = false;
    this.decoding = false;
    this.frameHandle = null;

    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });

    this.frames = 0;
    this.decodeMs = 0;
    this.statsSince = 0;
  }

  /** Cameras the browser will admit to having. Labels require permission. */
  static async listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  /**
   * @param {string} [deviceId] specific camera, else the rear-facing default
   */
  async start(deviceId) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "This browser does not expose camera access. On iOS the camera is only " +
          "available in Safari or an installed web app, and always over HTTPS.",
      );
    }

    await this.stop();

    // A high request resolution is what makes Data Matrix and MaxiCode legible
    // at arm's length; the browser clamps to whatever the sensor supports.
    const video = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      throw new Error(describeCameraError(err));
    }

    this.track = this.stream.getVideoTracks()[0];

    // Continuous autofocus is the single biggest quality win on a phone, but is
    // unsupported on plenty of devices -- a rejection here is not fatal.
    try {
      const caps = this.track.getCapabilities?.() ?? {};
      if (caps.focusMode?.includes("continuous")) {
        await this.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      }
    } catch {
      /* focus control unavailable; carry on */
    }

    this.video.srcObject = this.stream;
    this.video.setAttribute("playsinline", "");
    this.video.muted = true;
    await this.video.play();

    this.running = true;
    this.frames = 0;
    this.decodeMs = 0;
    this.statsSince = performance.now();
    this.#schedule();
  }

  async stop() {
    this.running = false;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.track = null;
    if (this.video.srcObject) this.video.srcObject = null;
  }

  /** Pauses decoding but keeps the preview alive, so resuming is instant. */
  pause() {
    this.running = false;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  resume() {
    if (this.running || !this.stream) return;
    this.running = true;
    this.statsSince = performance.now();
    this.frames = 0;
    this.decodeMs = 0;
    this.#schedule();
  }

  get isRunning() {
    return this.running;
  }

  /** deviceId of the camera actually selected, which may not be the one asked for. */
  get activeDeviceId() {
    return this.track?.getSettings?.().deviceId ?? null;
  }

  // ---- device capabilities ------------------------------------------------

  get capabilities() {
    const caps = this.track?.getCapabilities?.() ?? {};
    return {
      // Torch is Android Chrome only in practice; iOS Safari exposes no API.
      torch: Boolean(caps.torch),
      zoom: caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step ?? 0.1 } : null,
      resolution: this.video.videoWidth
        ? `${this.video.videoWidth}×${this.video.videoHeight}`
        : null,
    };
  }

  async setTorch(on) {
    if (!this.track) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: on }] });
      return true;
    } catch {
      return false;
    }
  }

  async setZoom(value) {
    if (!this.track) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ zoom: value }] });
      return true;
    } catch {
      return false;
    }
  }

  // ---- frame loop ---------------------------------------------------------

  #schedule() {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(() => this.#tick());
  }

  async #tick() {
    if (!this.running) return;
    if (this.decoding || this.video.readyState < 2) return this.#schedule();

    this.decoding = true;
    const started = performance.now();
    try {
      const imageData = this.#grabScanRegion();
      if (imageData) {
        const hit = await decodeFrame(imageData);
        this.decodeMs += performance.now() - started;
        this.frames++;
        this.#reportStats();
        if (hit && this.running) {
          this.decoding = false;
          this.onResult(hit);
          return;
        }
      }
    } catch (err) {
      this.onError(err);
      this.decoding = false;
      return;
    }
    this.decoding = false;
    this.#schedule();
  }

  #reportStats() {
    const elapsed = performance.now() - this.statsSince;
    if (elapsed < 1000) return;
    this.onStats({
      fps: this.frames / (elapsed / 1000),
      avgDecodeMs: this.decodeMs / Math.max(1, this.frames),
      resolution: this.capabilities.resolution,
    });
    this.frames = 0;
    this.decodeMs = 0;
    this.statsSince = performance.now();
  }

  /**
   * Copies the guide-box region of the current frame into the scratch canvas
   * and returns its pixels. Returns null until the video reports its size.
   */
  #grabScanRegion() {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return null;

    const roi = mapGuideToVideo(this.container, vw, vh);
    if (roi.sw < 8 || roi.sh < 8) return null;

    // Downscale only when the region is larger than the decoder needs.
    const shrink = Math.min(1, MAX_SCAN_EDGE / Math.max(roi.sw, roi.sh));
    const dw = Math.max(8, Math.round(roi.sw * shrink));
    const dh = Math.max(8, Math.round(roi.sh * shrink));

    if (this.canvas.width !== dw || this.canvas.height !== dh) {
      this.canvas.width = dw;
      this.canvas.height = dh;
    }

    this.ctx.drawImage(this.video, roi.sx, roi.sy, roi.sw, roi.sh, 0, 0, dw, dh);
    return this.ctx.getImageData(0, 0, dw, dh);
  }
}

/**
 * Maps the CSS guide box onto sensor pixel coordinates, accounting for the
 * centre crop that `object-fit: cover` performs.
 */
export function mapGuideToVideo(container, vw, vh) {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  if (!cw || !ch) return { sx: 0, sy: 0, sw: vw, sh: vh };

  // `cover` scales by the larger ratio, so the video overflows on one axis.
  const scale = Math.max(cw / vw, ch / vh);
  const overflowX = (vw * scale - cw) / 2;
  const overflowY = (vh * scale - ch) / 2;

  const boxX = GUIDE.left * cw;
  const boxY = GUIDE.top * ch;
  const boxW = (1 - GUIDE.left - GUIDE.right) * cw;
  const boxH = (1 - GUIDE.top - GUIDE.bottom) * ch;

  const sx = (boxX + overflowX) / scale;
  const sy = (boxY + overflowY) / scale;
  const sw = boxW / scale;
  const sh = boxH / scale;

  // Clamp so a rounding error can never ask the canvas for out-of-bounds pixels.
  const cx = Math.max(0, Math.min(vw, sx));
  const cy = Math.max(0, Math.min(vh, sy));
  return {
    sx: cx,
    sy: cy,
    sw: Math.max(0, Math.min(vw - cx, sw)),
    sh: Math.max(0, Math.min(vh - cy, sh)),
  };
}

function describeCameraError(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return (
        "Camera access was denied. Allow it for this site in your browser " +
        "settings, then reload."
      );
    case "NotFoundError":
    case "OverconstrainedError":
      return "No usable camera was found on this device.";
    case "NotReadableError":
      return "The camera is in use by another app. Close it and try again.";
    default:
      return `The camera could not be started (${err?.name ?? "unknown error"}).`;
  }
}
