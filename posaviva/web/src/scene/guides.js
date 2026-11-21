// Perspective guides drawn on a 2D canvas above the viewport.
//
// Everything is derived from the real camera projection M = P·V:
//  - the vanishing point of a world direction d is the image of the point at
//    infinity (d, 0): homogeneous NDC (M·d).xyw — exact for any focal, pitch,
//    roll or view offset, and well defined even when it lies off-screen;
//  - the horizon is the vanishing line of horizontal planes: the line through
//    the vanishing points of two horizontal directions (cross product of their
//    homogeneous images), so it is correct also when tilted (Dutch angle).
// Guide lines are rays from each VP spaced evenly in angle across the frame
// (anchored on the horizon), clipped to the frame; parallel lines when the
// VP is at infinity.
import * as THREE from 'three';
import { characterYaw } from './bounds.js';

export const FRAME_RATIOS = [
  { id: '1:1', w: 1, h: 1 }, { id: '4:3', w: 4, h: 3 }, { id: '3:2', w: 3, h: 2 }, { id: '16:9', w: 16, h: 9 },
  { id: '2:1', w: 2, h: 1 }, { id: '9:16', w: 9, h: 16 }, { id: '3:4', w: 3, h: 4 },
];
export const GUIDE_COLORS = ['#ff5d73', '#4fc3ff', '#7dff9a', '#ffd166', '#ffffff', '#111111', '#b48cff'];
const AXIS_COLORS = ['#ff5d73', '#4fc3ff', '#7dff9a'];
const HORIZON_COLOR = '#ffd166';

export function defaultGuides() {
  // hidden by default: turning "Mostra guide" on with nothing chosen picks 2 points + horizon (guidesPanel.js)
  return { visible: false, mode: 0, horizon: false, yaw: 0, density: 16, color: null, opacity: 0.75, thirds: false, frame: null, mask: 0.5, gridSync: true };
}

const DEG = Math.PI / 180;
const _M = new THREE.Matrix4();
const _drawnEvent = { type: 'drawn' };
const DASH_1 = [6, 5], NO_DASH = [];

/** homogeneous NDC (x, y, w) of world direction (dx,dy,dz) under M -> pixel homogeneous */
function vpHomog(e, dx, dy, dz, W, H, out) {
  const x = e[0] * dx + e[4] * dy + e[8] * dz;
  const y = e[1] * dx + e[5] * dy + e[9] * dz;
  const w = e[3] * dx + e[7] * dy + e[11] * dz;
  // NDC -> pixels as a projective map: px = W/2 (x + w), py = H/2 (w - y)
  out[0] = (W / 2) * (x + w); out[1] = (H / 2) * (w - y); out[2] = w;
  return out;
}

/**
 * Liang–Barsky: clips p + t·d (t in [tmin, tmax]) to rect R. Writes the
 * parametric interval into _t and returns false when the line misses R.
 * (allocation free: called for every guide line on every camera change)
 */
const _t = [0, 0];
function clipLine(px, py, dx, dy, R, tmin, tmax) {
  let t0 = tmin, t1 = tmax;
  for (let i = 0; i < 4; i++) {
    const p = i === 0 ? -dx : i === 1 ? dx : i === 2 ? -dy : dy;
    const q = i === 0 ? px - R.x : i === 1 ? R.x + R.w - px : i === 2 ? py - R.y : R.y + R.h - py;
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  if (t0 > t1) return false;
  _t[0] = t0; _t[1] = t1;
  return true;
}

const _corners = new Float64Array(8);
function setCorners(R) {
  _corners[0] = R.x; _corners[1] = R.y; _corners[2] = R.x + R.w; _corners[3] = R.y;
  _corners[4] = R.x + R.w; _corners[5] = R.y + R.h; _corners[6] = R.x; _corners[7] = R.y + R.h;
}

const wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

export class PerspectiveGuides extends THREE.EventDispatcher {
  constructor(app, shell) {
    super();
    this.app = app;
    this.shell = shell;
    this.state = defaultGuides();
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'passthrough pv-sc-guides';
    shell.overlay.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this._key = new Float64Array(36);
    this._dirty = true;
    this._raf = 0;
    this._h = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
    // reusable records (drawing runs on every camera change: no allocations)
    this._vpPool = [0, 1, 2].map(() => ({ label: '', color: '', x: 0, y: 0, finite: true, onScreen: false, dir: [0, 0] }));
    this._axes = [0, 1, 2].map(() => ({ h: null, color: '', label: '', vertical: false }));
    this._horizon = { a: 0, b: 0, c: 0, angle: 0, p: [0, 0], d: [0, 0] };
    this._frame = { x: 0, y: 0, w: 0, h: 0 };
    this._full = { x: 0, y: 0, w: 0, h: 0 };
    this._area = { x: 0, y: 0, w: 0, h: 0 }; // exported image on the canvas (moves with the UI view offset)
    this._free = { x: 0, y: 0, w: 0, h: 0 }; // canvas area not covered by opaque UI (markers)
    this._exportCam = null;
    this._L = new Float64Array(3);
    this._fonts = new Map();
    /** last computed geometry (CSS pixels): {vps:[{label,x,y,finite,onScreen}], horizon, frame} */
    this.info = { vps: [], horizon: null, frame: null };
    app.addEventListener('resize', () => { this._resize(); this.redraw(); });
    // the off-screen VP indicators stay in the area not covered by the tool sheet / panel
    app.addEventListener('uilayout', () => this.redraw());
    this._resize();
  }

  // ---------------------------------------------------------------- state
  getState() { return { ...this.state }; }
  setState(s) {
    if (!s) return;
    const next = { ...defaultGuides(), ...s };
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this._syncGrid();
    this.redraw();
    this.dispatchEvent({ type: 'change' });
  }
  set(patch) {
    Object.assign(this.state, patch);
    if ('yaw' in patch || 'gridSync' in patch) this._syncGrid();
    this.redraw();
    this.dispatchEvent({ type: 'change' });
  }

  get active() {
    const s = this.state;
    return s.visible && (s.mode > 0 || s.horizon || s.thirds || !!s.frame);
  }

  /** Rotates the 3D floor grid together with the guide grid (optional). */
  _syncGrid() {
    const g = this.app.grid;
    if (!g) return;
    const y = this.state.gridSync ? this.state.yaw * DEG : 0;
    if (g.rotation.y !== y) { g.rotation.y = y; this.app.invalidate(); }
  }

  /** Aligns the grid yaw with the selected character's facing direction. */
  alignToCharacter() {
    const ch = this.app.selection.character;
    if (!ch) return false;
    this.set({ yaw: this._norm90(characterYaw(ch) / DEG) });
    return true;
  }

  /** Aligns one grid axis with the camera's horizontal view direction (1-point setup). */
  alignToView() {
    const cam = this.app.camera;
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fz = -e[10];
    if (Math.hypot(fx, fz) < 1e-6) return false;
    this.set({ yaw: this._norm90(Math.atan2(fx, fz) / DEG) });
    return true;
  }

  _norm90(deg) { let d = ((deg % 90) + 90) % 90; if (d > 45) d -= 90; return Math.round(d * 10) / 10; }

  // ---------------------------------------------------------------- drawing
  _resize() {
    const r = this.shell.overlay.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this._cssW = Math.max(1, r.width); this._cssH = Math.max(1, r.height); this._dpr = dpr;
    const w = Math.round(this._cssW * dpr), h = Math.round(this._cssH * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this._dirty = true;
  }

  /** Schedules a redraw on the next animation frame. */
  redraw() {
    this._dirty = true;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.afterRender(true); });
  }

  /** Called after each 3D render: redraws only when the camera (or settings) changed. */
  afterRender(force = false) {
    const cam = this.app.camera;
    const k = this._key, a = cam.matrixWorld.elements, b = cam.projectionMatrix.elements;
    let changed = force || this._dirty;
    for (let i = 0; i < 16; i++) { if (k[i] !== a[i]) { k[i] = a[i]; changed = true; } if (k[16 + i] !== b[i]) { k[16 + i] = b[i]; changed = true; } }
    if (k[32] !== this._cssW || k[33] !== this._cssH) { k[32] = this._cssW; k[33] = this._cssH; changed = true; }
    if (!changed) return;
    this._dirty = false;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.active) { this.info.vps.length = 0; this.info.horizon = this.info.frame = null; return; }
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    this.info = this.drawTo(ctx, this._cssW, this._cssH, 1, { area: this._screenArea(cam), markers: this._freeArea() });
    this.dispatchEvent(_drawnEvent);
  }

  /**
   * Where the exported image lies on the canvas (CSS px). While a tool panel is
   * open the UI shifts / zooms the projection with camera.setViewOffset (io
   * module): the export (rendered without offset) then maps to this rectangle.
   */
  _screenArea(cam) {
    const A = this._area, W = this._cssW, H = this._cssH, v = cam.view;
    if (v && v.enabled && v.width > 0 && v.height > 0) {
      const kx = W / v.width, ky = H / v.height;
      A.x = -v.offsetX * kx; A.y = -v.offsetY * ky; A.w = v.fullWidth * kx; A.h = v.fullHeight * ky;
    } else { A.x = 0; A.y = 0; A.w = W; A.h = H; }
    return A;
  }

  /** Canvas area not covered by opaque UI (top bar, sheet, side panel, toolbar). */
  _freeArea() {
    const F = this._free, W = this._cssW, H = this._cssH;
    let ins = null;
    try { ins = this.shell.getViewInsets?.(); } catch { ins = null; }
    // the floating top bar (character chip, undo, menu) always covers the top edge
    const tb = this.shell.topBar;
    const tbBottom = tb && tb.offsetHeight ? tb.offsetTop + tb.offsetHeight : 0;
    const t = Math.max(ins?.top || 0, tbBottom), r = ins?.right || 0, b = ins?.bottom || 0, l = ins?.left || 0;
    F.x = Math.min(l, W - 60); F.y = Math.min(t, H - 60);
    F.w = Math.max(60, W - l - r); F.h = Math.max(60, H - t - b);
    return F;
  }

  /**
   * Draws the guides onto a captured image (app.capture output, the plain camera
   * view at any resolution). opts.crop: the image will be cropped to the comic
   * panel afterwards (indicators are kept inside it, no mask or border).
   */
  drawOnCapture(canvas, { crop = false } = {}) {
    if (!this.active) return canvas;
    const src = this.app.camera;
    const cam = this._exportCam || (this._exportCam = new THREE.PerspectiveCamera());
    cam.copy(src, false);
    cam.view = null; // the export never carries the UI view offset
    cam.aspect = canvas.width / canvas.height;
    cam.updateProjectionMatrix();
    cam.matrixWorld.copy(src.matrixWorld);
    cam.matrixWorldInverse.copy(src.matrixWorldInverse);
    const W = canvas.width, H = canvas.height;
    const px = H / (this._cssH || H); // the vertical field of view is preserved: scale with the height
    const ctx = canvas.getContext('2d');
    ctx.save();
    const frame = this.state.frame ? this.frameRect(W, H, px) : null;
    try {
      this.drawTo(ctx, W, H, px, { camera: cam, mask: false, frameBorder: !crop, markers: crop && frame ? frame : null });
    } finally {
      ctx.restore();
      this.redraw(); // `info` (shared records) now describes the export: recompute the on-screen geometry
    }
    return canvas;
  }

  /** Frame rect (pixels) for a canvas of W×H, or null when no frame ratio is set. */
  frameRect(W, H, px = 1, frameId = this.state.frame, out = { x: 0, y: 0, w: 0, h: 0 }) {
    let fr = null;
    for (const f of FRAME_RATIOS) if (f.id === frameId) fr = f;
    if (!fr) return null;
    const m = 10 * px, r = fr.w / fr.h;
    let w = W - 2 * m, h = w / r;
    if (h > H - 2 * m) { h = H - 2 * m; w = h * r; }
    out.x = (W - w) / 2; out.y = (H - h) / 2; out.w = w; out.h = h;
    return out;
  }

  /** Frame rect inside `area` (the exported image as shown on a W×H canvas). */
  _frameIn(area, W, H, px, out) {
    const k = area.w / W; // zoom of the exported image on the canvas
    if (!this.frameRect(W, H, px, this.state.frame, out)) return null;
    out.x = area.x + out.x * k; out.y = area.y + out.y * k; out.w *= k; out.h *= k;
    return out;
  }

  /** Normalized (0..1) frame rect of the canvas — for exporters that crop to the comic panel. */
  getFrameRectNormalized() {
    const W = this._cssW, H = this._cssH;
    const R = this.frameRect(W, H, 1);
    return R ? { x: R.x / W, y: R.y / H, w: R.w / W, h: R.h / H } : null;
  }

  /**
   * Draws the guides for the current camera into any 2D context of W×H
   * pixels (px = line-width scale; e.g. an exporter drawing on a larger
   * canvas). Uses the matrices of the last rendered frame (roll included).
   * opts: camera (default app.camera), area (rect where the exported image lies,
   * default the whole canvas), markers (rect that holds the off-screen VP
   * indicators, default the whole canvas), mask / frameBorder (comic panel
   * decorations, default true).
   * Returns the computed geometry (a reused object).
   */
  drawTo(ctx, W, H, px = 1, opts = {}) {
    const s = this.state, cam = opts.camera || this.app.camera, info = this.info;
    const e = _M.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    info.vps.length = 0; info.horizon = null; info.frame = null;
    const full = this._full; full.x = 0; full.y = 0; full.w = W; full.h = H;
    const area = opts.area || full;
    const F = (s.frame && this._frameIn(area, W, H, px, this._frame)) || full;
    if (s.frame) info.frame = F;
    info.area = s.frame ? F : area;
    const M = opts.markers || full;
    const alpha = Math.max(0.05, Math.min(1, s.opacity));

    // mask outside the comic panel frame
    if (s.frame && opts.mask !== false) {
      ctx.globalAlpha = 1;
      if (this._maskKey !== s.mask) { this._maskKey = s.mask; this._maskStyle = `rgba(8,9,12,${s.mask})`; }
      ctx.fillStyle = this._maskStyle;
      ctx.fillRect(0, 0, W, F.y); ctx.fillRect(0, F.y + F.h, W, H - F.y - F.h);
      ctx.fillRect(0, F.y, F.x, F.h); ctx.fillRect(F.x + F.w, F.y, W - F.x - F.w, F.h);
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(F.x, F.y, F.w, F.h); ctx.clip();
    ctx.lineCap = 'round';

    // horizontal axes rotated by the grid yaw; vertical axis
    const yaw = s.yaw * DEG, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const hA = vpHomog(e, cy, 0, -sy, W, H, this._h[0]);
    const hB = vpHomog(e, sy, 0, cy, W, H, this._h[1]);
    const hC = vpHomog(e, 0, 1, 0, W, H, this._h[2]);

    // horizon = line through the two horizontal vanishing points (projective cross product)
    const L = this._L;
    L[0] = hA[1] * hB[2] - hA[2] * hB[1]; L[1] = hA[2] * hB[0] - hA[0] * hB[2]; L[2] = hA[0] * hB[1] - hA[1] * hB[0];
    const ln = Math.hypot(L[0], L[1]);
    let horizonAngle = 0;
    if (ln > 0 && ln > 1e-12 * Math.abs(L[2])) {
      const a = L[0] / ln, b = L[1] / ln, c = L[2] / ln;
      // direction along the line: (b, -a), pointing rightwards
      let dx = b, dy = -a;
      if (dx < 0 || (dx === 0 && dy < 0)) { dx = -dx; dy = -dy; }
      horizonAngle = Math.atan2(dy, dx);
      const Hz = this._horizon;
      Hz.a = a; Hz.b = b; Hz.c = c; Hz.angle = horizonAngle;
      Hz.p[0] = -a * c; Hz.p[1] = -b * c; // closest point to the origin
      Hz.d[0] = dx; Hz.d[1] = dy;
      info.horizon = Hz;
    }

    // which axes: 1 point = the horizontal axis most aligned with the view direction
    const fx = -cam.matrixWorld.elements[8], fz = -cam.matrixWorld.elements[10];
    const axes = this._axes;
    let nAxes = 0;
    if (s.mode === 1) {
      const dA = Math.abs(cy * fx - sy * fz), dB = Math.abs(sy * fx + cy * fz);
      if (dA > dB) this._setAxis(nAxes++, hA, AXIS_COLORS[0], 'PF', false); else this._setAxis(nAxes++, hB, AXIS_COLORS[1], 'PF', false);
    } else if (s.mode >= 2) {
      this._setAxis(nAxes++, hA, AXIS_COLORS[0], 'PF1', false);
      this._setAxis(nAxes++, hB, AXIS_COLORS[1], 'PF2', false);
      if (s.mode >= 3) this._setAxis(nAxes++, hC, AXIS_COLORS[2], 'PF3', true);
    }

    const N = Math.max(4, Math.min(60, Math.round(s.density)));
    for (let i = 0; i < nAxes; i++) {
      const ax = axes[i], vp = this._vpPool[i];
      vp.label = ax.label;
      vp.color = s.color || ax.color;
      this._drawFan(ctx, ax.h, F, N, ax.vertical ? null : horizonAngle, vp.color, alpha, px, vp);
      info.vps.push(vp);
    }

    // horizon line
    if (s.horizon && info.horizon) {
      const H0 = info.horizon;
      if (clipLine(H0.p[0], H0.p[1], H0.d[0], H0.d[1], F, -1e9, 1e9)) {
        const t0 = _t[0], t1 = _t[1];
        ctx.strokeStyle = s.color || HORIZON_COLOR;
        ctx.globalAlpha = Math.min(1, alpha + 0.15);
        ctx.lineWidth = 2 * px;
        ctx.beginPath();
        ctx.moveTo(H0.p[0] + H0.d[0] * t0, H0.p[1] + H0.d[1] * t0);
        ctx.lineTo(H0.p[0] + H0.d[0] * t1, H0.p[1] + H0.d[1] * t1);
        ctx.stroke();
        // label near the left end, along the (possibly tilted) line
        ctx.save();
        ctx.translate(H0.p[0] + H0.d[0] * (t0 + 8 * px), H0.p[1] + H0.d[1] * (t0 + 8 * px));
        ctx.rotate(H0.angle);
        this._label(ctx, 'Orizzonte', 4 * px, -6 * px, s.color || HORIZON_COLOR, px, 'left');
        ctx.restore();
      }
    }

    // rule of thirds (of the panel, else of the exported image)
    if (s.thirds) {
      const T = s.frame ? F : area;
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 * px;
      ctx.setLineDash(px === 1 ? DASH_1 : [6 * px, 5 * px]);
      ctx.beginPath();
      for (let i = 1; i <= 2; i++) {
        const x = T.x + (T.w * i) / 3, y = T.y + (T.h * i) / 3;
        ctx.moveTo(x, T.y); ctx.lineTo(x, T.y + T.h);
        ctx.moveTo(T.x, y); ctx.lineTo(T.x + T.w, y);
      }
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
    }
    ctx.restore();

    // vanishing point markers (on screen) or edge indicators (off screen)
    for (let i = 0; i < info.vps.length; i++) this._drawMarker(ctx, info.vps[i], M, px);

    // frame border + label
    if (s.frame && opts.frameBorder !== false) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(F.x, F.y, F.w, F.h);
      this._label(ctx, s.frame, F.x + 6 * px, F.y + 16 * px, '#ffffff', px, 'left');
    }
    ctx.globalAlpha = 1;
    return info;
  }

  _setAxis(i, h, color, label, vertical) { const a = this._axes[i]; a.h = h; a.color = color; a.label = label; a.vertical = vertical; }

  /**
   * Fan of guide lines toward a vanishing point (homogeneous pixel coords h),
   * clipped to R. Fills `res` with the VP position.
   */
  _drawFan(ctx, h, R, N, anchorAngle, color, alpha, px, res) {
    const hx = h[0], hy = h[1], hw = h[2];
    res.finite = true; res.onScreen = false; res.x = 0; res.y = 0;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1 * px;
    ctx.beginPath();
    setCorners(R);
    const C = _corners;
    if (Math.abs(hw) <= 1e-9 * (Math.abs(hx) + Math.abs(hy))) {
      // VP at infinity: parallel lines along (hx, hy), evenly spaced across R
      const l = Math.hypot(hx, hy) || 1, dx = hx / l, dy = hy / l, nx = -dy, ny = dx;
      res.finite = false; res.dir[0] = dx; res.dir[1] = dy;
      let s0 = Infinity, s1 = -Infinity;
      for (let i = 0; i < 8; i += 2) { const v = C[i] * nx + C[i + 1] * ny; if (v < s0) s0 = v; if (v > s1) s1 = v; }
      const step = (s1 - s0) / N;
      const anchor = (R.x + R.w / 2) * nx + (R.y + R.h / 2) * ny;
      for (let k = Math.ceil((s0 - anchor) / step); anchor + k * step <= s1; k++) {
        const v = anchor + k * step, ox = nx * v, oy = ny * v;
        if (clipLine(ox, oy, dx, dy, R, -1e9, 1e9)) { ctx.moveTo(ox + dx * _t[0], oy + dy * _t[0]); ctx.lineTo(ox + dx * _t[1], oy + dy * _t[1]); }
      }
      ctx.stroke();
      return res;
    }
    const vx = hx / hw, vy = hy / hw;
    res.x = vx; res.y = vy;
    const inside = vx >= R.x && vx <= R.x + R.w && vy >= R.y && vy <= R.y + R.h;
    let lo, hi;
    if (inside) { lo = -Math.PI; hi = Math.PI; } else {
      // angular span of the frame as seen from the (outside) VP
      const ref = Math.atan2(R.y + R.h / 2 - vy, R.x + R.w / 2 - vx);
      lo = Infinity; hi = -Infinity;
      for (let i = 0; i < 8; i += 2) { const d = wrap(Math.atan2(C[i + 1] - vy, C[i] - vx) - ref); if (d < lo) lo = d; if (d > hi) hi = d; }
      lo += ref; hi += ref;
    }
    const step = (hi - lo) / N;
    // anchor the fan on the horizon (for horizontal VPs) so the horizon is
    // always one of the guide lines and the spacing does not swim
    const mid = (lo + hi) / 2;
    let anchor = anchorAngle ?? Math.atan2(R.y + R.h / 2 - vy, R.x + R.w / 2 - vx);
    if (Math.abs(wrap(anchor + Math.PI - mid)) < Math.abs(wrap(anchor - mid))) anchor += Math.PI;
    anchor = mid + wrap(anchor - mid);
    const k0 = Math.ceil((lo - anchor) / step - 1e-9), k1 = Math.floor((hi - anchor) / step + 1e-9);
    for (let k = k0; k <= k1 && k - k0 < 400; k++) {
      if (inside && k === k1 && k1 - k0 >= N) break; // full circle: avoid the duplicate ray
      const a = anchor + k * step, dx = Math.cos(a), dy = Math.sin(a);
      if (clipLine(vx, vy, dx, dy, R, 0, 1e12)) { ctx.moveTo(vx + dx * _t[0], vy + dy * _t[0]); ctx.lineTo(vx + dx * _t[1], vy + dy * _t[1]); }
    }
    ctx.stroke();
    return res;
  }

  /** VP marker, or an arrow on the edge of rect M pointing at an off-screen VP. */
  _drawMarker(ctx, vp, M, px) {
    ctx.globalAlpha = 1;
    if (!vp.finite) return; // parallel lines: nothing to point at
    const onScreen = vp.x >= M.x && vp.x <= M.x + M.w && vp.y >= M.y && vp.y <= M.y + M.h;
    vp.onScreen = onScreen;
    if (onScreen) {
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.arc(vp.x, vp.y, 8 * px, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = vp.color; ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.arc(vp.x, vp.y, 7 * px, 0, Math.PI * 2);
      ctx.moveTo(vp.x - 12 * px, vp.y); ctx.lineTo(vp.x + 12 * px, vp.y);
      ctx.moveTo(vp.x, vp.y - 12 * px); ctx.lineTo(vp.x, vp.y + 12 * px);
      ctx.stroke();
      this._label(ctx, vp.label, vp.x + 11 * px, vp.y - 10 * px, vp.color, px, 'left');
      return;
    }
    // off-screen: arrow on the edge of M, on the line from its center toward the VP
    const cx = M.x + M.w / 2, cy = M.y + M.h / 2, m = 18 * px;
    const dx = vp.x - cx, dy = vp.y - cy;
    const k = Math.min(Math.abs((M.w / 2 - m) / (dx || 1e-9)), Math.abs((M.h / 2 - m) / (dy || 1e-9)));
    const ex = cx + dx * k, ey = cy + dy * k, a = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ex, ey); ctx.rotate(a);
    ctx.fillStyle = vp.color; ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1.5 * px;
    ctx.beginPath(); ctx.moveTo(9 * px, 0); ctx.lineTo(-7 * px, -7 * px); ctx.lineTo(-3 * px, 0); ctx.lineTo(-7 * px, 7 * px); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
    const lx = ex - Math.cos(a) * 16 * px, ly = ey - Math.sin(a) * 16 * px;
    this._label(ctx, vp.label, lx, ly + 4 * px, vp.color, px, Math.cos(a) > 0.3 ? 'right' : Math.cos(a) < -0.3 ? 'left' : 'center');
  }

  _label(ctx, text, x, y, color, px, align = 'left') {
    let font = this._fonts.get(px);
    if (!font) { font = `600 ${11 * px}px system-ui, sans-serif`; this._fonts.set(px, font); }
    ctx.font = font;
    ctx.textAlign = align;
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.globalAlpha = 1;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}
