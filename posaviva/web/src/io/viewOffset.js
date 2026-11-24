// Keeps the 3D subject visible when the tool sheet / side panel covers part of
// the canvas. The camera keeps its pose: only the projection window moves
// (PerspectiveCamera.setViewOffset), so orbiting, picking (NDC), overlays that
// project with camera.projectionMatrix and the undo history are unaffected.
//
// Model: a point that the un-offset camera shows at canvas pixel p is shown at
//   p' = C + s * (p - canvasCenter)
// with C = projection center on the canvas and s <= 1 (zoom-out to fit).
// When the panel opens we fit the selected character's on-screen bounds into
// the uncovered area (only zooming out, never in). With the panel closed the
// offset is the identity, so the view equals the exported image.
// Captures (app.capture) render without offset: see the 'capture' listener.
import * as THREE from 'three';

const DURATION = 320; // ms, matches the sheet transition
const S_MIN = 0.32;
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export class ViewOffset {
  constructor(app, shell) {
    this.app = app;
    this.shell = shell;
    this.camera = app.camera;
    this.enabled = true;
    this.cur = { s: 1, ox: 0, oy: 0 };
    this.target = { s: 1, ox: 0, oy: 0 };
    this._from = { s: 1, ox: 0, oy: 0 };
    this._t0 = 0;
    this._animating = false;
    this._suspended = false;
    this._selT = 0;
    this._holdUntil = 0;
    this._refreshT = 0;

    shell.addEventListener('layout', (e) => this.update({ live: e.live }));
    app.addEventListener('resize', () => this._apply());
    app.addEventListener('selection', () => {
      if (!this._covered() || performance.now() < this._holdUntil) return;
      // let a framing tween (e.g. after adding a character) start first
      clearTimeout(this._selT);
      this._selT = setTimeout(() => this.update({ keepIfVisible: true }), 90);
    });
    app.addEventListener('capture', (e) => {
      if (e.phase === 'before') this.suspend(); else this.resume();
    });
    // the selected prop (and its rotation ring / height knob) joins the subject in the
    // Oggetti tool: refit when another prop is selected (props are created after us)
    const hookProps = () => {
      if (this._propsHooked || !app.props?.addEventListener) return;
      this._propsHooked = true;
      app.props.addEventListener('select', () => {
        if (!this._covered() || this.shell.activeToolId !== 'props') return;
        clearTimeout(this._selT);
        this._selT = setTimeout(() => this.update({ keepIfVisible: true }), 60);
      });
    };
    app.addEventListener('ready', hookProps);
    app.addEventListener('tool', hookProps);
    // body shape changes from any source (Corpo sliders, sex, undo/redo of a shape …)
    // resize the selected character: refit once it settles
    this._shapeCh = null;
    this._shapeT = 0;
    this._onShape = () => {
      if (!this._covered()) return;
      clearTimeout(this._shapeT);
      this._shapeT = setTimeout(() => this.update({ keepIfVisible: true }), 250);
    };
    const bindShape = () => {
      const ch = app.selection?.character || null;
      if (ch === this._shapeCh) return;
      this._shapeCh?.removeEventListener('shape', this._onShape);
      this._shapeCh = ch;
      ch?.addEventListener('shape', this._onShape);
    };
    app.addEventListener('selection', bindShape);
    app.addEventListener('ready', bindShape);
    /** OrbitControls pan speed without offset (read when an offset starts) */
    this._basePan = null;
    app.addRenderHook(() => this._tick());
  }

  /** A tool panel or (tablets) a docked panel such as the voice commands covers part of the view. */
  _covered() { return this.shell.viewCovered ?? this.shell.panelOpen; }

  /** True while a non-identity offset is applied. */
  get active() { return !!this.camera.view?.enabled; }

  /** Temporarily render without offset (captures, thumbnails). Call resume() afterwards. */
  suspend() {
    this._suspended = true;
    if (this.camera.view?.enabled) { this.camera.view.enabled = false; this.camera.updateProjectionMatrix(); }
  }

  resume() { this._suspended = false; this._apply(); }

  /** Runs fn() with the plain camera projection (synchronously). */
  without(fn) {
    const was = this._suspended;
    this.suspend();
    try { return fn(); } finally { if (!was) this.resume(); }
  }

  setEnabled(on) { this.enabled = !!on; this.update(); }

  /** Ignore selection changes for a while (e.g. a camera framing tween follows). */
  holdSelection(ms) { this._holdUntil = performance.now() + ms; }

  /** Full refit after ms (e.g. once a framing tween has ended). */
  refreshAfter(ms) {
    clearTimeout(this._refreshT);
    this._refreshT = setTimeout(() => { if (this._covered()) this.update(); }, ms);
  }

  /**
   * Recomputes the target offset. live: follow immediately (sheet drag).
   * keepIfVisible: keep the current offset when the subject is already inside the free area.
   */
  update({ live = false, keepIfVisible = false } = {}) {
    const t = this._computeTarget(keepIfVisible);
    if (!t) return;
    this.target = t;
    if (live) { this._animating = false; Object.assign(this.cur, t); this._apply(); return; }
    Object.assign(this._from, this.cur);
    this._t0 = performance.now();
    this._animating = true;
    this.app.invalidate();
  }

  _tick() {
    if (!this._animating) return false;
    const k = Math.min(1, (performance.now() - this._t0) / DURATION), e = easeOut(k);
    const f = this._from, t = this.target, c = this.cur;
    c.s = f.s + (t.s - f.s) * e; c.ox = f.ox + (t.ox - f.ox) * e; c.oy = f.oy + (t.oy - f.oy) * e;
    if (k >= 1) this._animating = false;
    this._apply();
    return this._animating;
  }

  _apply() {
    const cam = this.camera, c = this.cur;
    const W = this.app.canvas.clientWidth || 1, H = this.app.canvas.clientHeight || 1;
    const identity = Math.abs(c.s - 1) < 1e-4 && Math.abs(c.ox) < 0.25 && Math.abs(c.oy) < 0.25;
    const ctl = this.app.controls;
    if (this._suspended || identity) {
      if (cam.view?.enabled) cam.clearViewOffset();
      else if (Math.abs(cam.aspect - W / H) > 1e-6) { cam.aspect = W / H; cam.updateProjectionMatrix(); }
      if (this._basePan !== null && !this._suspended) { ctl.panSpeed = this._basePan; this._basePan = null; }
    } else {
      const Wv = W * c.s, Hv = H * c.s;
      // full image = the camera frame scaled by s; window = the canvas, shifted so the
      // frame center lands on (W/2 + ox, H/2 + oy)
      cam.setViewOffset(Wv, Hv, Wv / 2 - (W / 2 + c.ox), Hv / 2 - (H / 2 + c.oy), W, H);
      // OrbitControls pans by the un-offset frame: on screen everything is scaled by s,
      // so a two-finger pan would lag behind the fingers. Compensate.
      if (ctl) {
        if (this._basePan === null) this._basePan = ctl.panSpeed;
        ctl.panSpeed = this._basePan / Math.max(S_MIN, c.s);
      }
    }
    this.app.invalidate();
  }

  // ---------------------------------------------------------------- target
  _computeTarget(keepIfVisible) {
    if (!this.enabled || !this._covered()) return { s: 1, ox: 0, oy: 0 };
    const W = this.app.canvas.clientWidth, H = this.app.canvas.clientHeight;
    if (!W || !H) return null;
    const ins = this.shell.getViewInsets();
    const F = { x: ins.left, y: ins.top, w: Math.max(60, W - ins.left - ins.right), h: Math.max(60, H - ins.top - ins.bottom) };
    const fcx = F.x + F.w / 2, fcy = F.y + F.h / 2;
    const B = this._subjectRect(W, H);

    if (B && keepIfVisible) {
      // already inside the free area with the current offset? then do not move
      const c = this.cur;
      const x0 = W / 2 + c.ox + c.s * (B.x - W / 2), y0 = H / 2 + c.oy + c.s * (B.y - H / 2);
      const x1 = x0 + B.w * c.s, y1 = y0 + B.h * c.s;
      if (x0 >= F.x - 4 && y0 >= F.y - 4 && x1 <= F.x + F.w + 4 && y1 <= F.y + F.h + 4) return null;
    }

    let s, cx, cy;
    // a subject not larger than the screen is fitted (even when partly off-screen);
    // a bigger one means the user zoomed on a detail
    if (B && (B.prop || (B.h <= H * 1.8 && B.w <= W * 1.8))) {
      // fit the subject (zoom out only), centered in the free area
      s = Math.min(1, (F.w * 0.92) / B.w, (F.h * 0.9) / B.h);
      s = Math.max(S_MIN, s);
      const bcx = B.x + B.w / 2, bcy = B.y + B.h / 2;
      cx = fcx - s * (bcx - W / 2);
      cy = fcy - s * (bcy - H / 2);
    } else {
      // zoomed on a detail (or nothing selected): keep what is at the screen center visible
      s = Math.max(0.6, Math.min(1, (F.h / H) * 1.35, (F.w / W) * 1.35));
      cx = fcx; cy = fcy;
    }
    return { s, ox: cx - W / 2, oy: cy - H / 2 };
  }

  /**
   * Screen rect (CSS px, un-offset projection) of the selected character, or of all
   * visible characters when none is selected, or of the prop being edited in the
   * Oggetti tool (prop: true). visible = fraction of it inside the canvas.
   */
  _subjectRect(W, H) {
    const app = this.app;
    const sel = app.selection?.character;
    // editing a free prop (Oggetti tool): the prop and its handles are the subject
    // (a held prop follows its character, which stays the subject)
    let prop = this.shell.activeToolId === 'props' ? app.props?.selected : null;
    if (prop && (prop.hold || !prop.root.visible || !prop.worldCorners)) prop = null;
    const list = prop ? [] : sel ? [sel] : app.characters.filter((c) => c.root.visible);
    if (!list.length && !prop) return null;
    const cam = this.camera;
    cam.updateMatrixWorld();
    // un-offset projection matrix
    const view = cam.view, had = !!view?.enabled;
    if (had) { view.enabled = false; cam.updateProjectionMatrix(); }
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    if (had) { view.enabled = true; cam.updateProjectionMatrix(); }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    const e = _m.elements;
    for (const ch of list) {
      ch.root.updateWorldMatrix(true, true);
      const P = ch.getSkinnedPositions(), M = ch.rig.matrixWorld;
      const verts = app.model.groupVertices[0];
      for (let i = 0; i < verts.length; i += 11) {
        const k = verts[i] * 3;
        _v.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(M);
        const w = e[3] * _v.x + e[7] * _v.y + e[11] * _v.z + e[15];
        if (w <= cam.near) continue; // behind the camera
        const nx = (e[0] * _v.x + e[4] * _v.y + e[8] * _v.z + e[12]) / w;
        const ny = (e[1] * _v.x + e[5] * _v.y + e[9] * _v.z + e[13]) / w;
        const sx = (nx * 0.5 + 0.5) * W, sy = (0.5 - ny * 0.5) * H;
        if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
        n++;
      }
    }
    if (prop) {
      for (const c of prop.worldCorners()) {
        const w = e[3] * c.x + e[7] * c.y + e[11] * c.z + e[15];
        if (w <= cam.near) continue;
        const sx = ((e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12]) / w * 0.5 + 0.5) * W;
        const sy = (0.5 - (e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13]) / w * 0.5) * H;
        if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
        n++;
      }
    }
    if (!n || x1 - x0 < 2 || y1 - y0 < 2) return null;
    // characters: hair / hands between sampled vertices; props: the rotation ring
    // around the base and the height knob above the top
    const pad = prop ? 0.1 * Math.max(x1 - x0, y1 - y0) + 40 : 0.04 * (y1 - y0);
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    const ix = Math.max(0, Math.min(W, x1) - Math.max(0, x0)), iy = Math.max(0, Math.min(H, y1) - Math.max(0, y0));
    const visible = (ix * iy) / ((x1 - x0) * (y1 - y0));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, visible, prop: !!prop };
  }
}
