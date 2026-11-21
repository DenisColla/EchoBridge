// In-viewport handles for the selected prop, drawn on a 2D overlay canvas so
// they keep a constant on-screen size (touch friendly) and never get inked or
// exported:
//   - corner brackets around the prop (selection indicator)
//   - ground ring + knob: drag to rotate (optional 15° snap)
//   - arrow knob above the prop: drag to change the height
//   - drag the prop itself: move it on the ground plane
// Handles are active only while the "Oggetti" tool is open. Held props show
// the brackets only (they follow the hand).
import * as THREE from 'three';
import { haptic } from '../ui/kit.js';
import { wrapAngle } from './manager.js';

const RING_N = 72;
const KNOB_R = 15; // px
const HIT_KNOB = 28; // px
const HIT_RING = 18; // px
const SNAP = Math.PI / 12; // 15°
const COLORS = { ring: '#4fd1c5', knob: '#7c6cff', bracket: '#ffffff', halo: 'rgba(0,0,0,0.45)' };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane();
const _pt = { x: 0, y: 0 };
const EDGE_BITS = [1, 2, 4]; // box corner index bits -> the 3 edges leaving a corner

export class PropGizmo {
  constructor(app, shell, manager, { isActive }) {
    this.app = app;
    this.shell = shell;
    this.manager = manager;
    this.isActive = isActive;
    this.snap = loadSnap();
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pv-pr-gizmo';
    shell.overlay.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    // screen-space geometry of the last drawn frame (client px), used for hit tests
    this.ringPts = new Float32Array(RING_N * 2);
    this.ringOk = false;
    this.center = { x: 0, y: 0, ok: false };
    this.rotKnob = { x: 0, y: 0, ok: false };
    this.hKnob = { x: 0, y: 0, ok: false };
    this.drag = null;
    this._drawn = false;
    this._rectsDirty = true; // DOM rects are cached (they only change on resize)
    app.addEventListener('resize', () => { this._rectsDirty = true; });
    app.addAfterRenderHook(() => this.draw());
    this._setupInput();
  }

  get target() {
    const p = this.manager.selected;
    return p && this.isActive() ? p : null;
  }

  // ------------------------------------------------------------ drawing
  _fitCanvas() {
    if (!this._rectsDirty && this._rect) return;
    this._rectsDirty = false;
    this._rect = this.app.canvas.getBoundingClientRect();
    const r = this.shell.overlay.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.dpr = dpr;
    this.ox = r.left; this.oy = r.top;
  }

  /** World -> client px. Returns false if behind the camera. */
  _project(world, out) {
    _v.copy(world).project(this.app.camera);
    if (_v.z > 1 || _v.z < -1) return false;
    const r = this._rect;
    out.x = r.left + (_v.x + 1) * 0.5 * r.width;
    out.y = r.top + (1 - _v.y) * 0.5 * r.height;
    return true;
  }

  /** World units per screen pixel at a world point. */
  _worldPerPixel(world) {
    const cam = this.app.camera, h = this._rect.height || 1;
    if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / h;
    _v2.copy(world).applyMatrix4(cam.matrixWorldInverse);
    return (2 * Math.max(0.01, -_v2.z) * Math.tan((cam.fov * Math.PI) / 360)) / cam.zoom / h;
  }

  draw() {
    const p = this.target;
    if (!p) {
      if (this._drawn) { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this._drawn = false; }
      this.ringOk = this.center.ok = this.rotKnob.ok = this.hKnob.ok = false;
      return;
    }
    this._fitCanvas();
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, -this.ox * dpr, -this.oy * dpr); // draw in client px
    this._drawn = true;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // --- brackets
    const corners = p.worldCorners();
    const pts = this._bracketPts || (this._bracketPts = Array.from({ length: 8 }, () => ({ x: 0, y: 0, ok: false })));
    let topY = -Infinity;
    for (let i = 0; i < 8; i++) { pts[i].ok = this._project(corners[i], pts[i]); topY = Math.max(topY, corners[i].y); }
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      for (let e = 0; e < 3; e++) {
        const j = i ^ EDGE_BITS[e];
        if (!pts[i].ok || !pts[j].ok) continue;
        const a = pts[i], b = pts[j];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + (b.x - a.x) * 0.22, a.y + (b.y - a.y) * 0.22);
      }
    }
    ctx.strokeStyle = COLORS.halo; ctx.lineWidth = 4.5; ctx.stroke();
    ctx.strokeStyle = COLORS.bracket; ctx.lineWidth = 2; ctx.stroke();

    this.ringOk = this.rotKnob.ok = this.hKnob.ok = false;
    if (p.hold) return;

    // --- rotation ring on the prop's base plane
    p.root.updateWorldMatrix(true, false);
    _c.setFromMatrixPosition(p.root.matrixWorld);
    _c.y += 0.004;
    const wpp = this._worldPerPixel(_c);
    const R = Math.max(p.footprintRadius() + 16 * wpp, 46 * wpp);
    this.center.ok = this._project(_c, this.center);
    let okAll = true;
    for (let i = 0; i < RING_N; i++) {
      const a = (i / RING_N) * Math.PI * 2;
      _v2.set(_c.x + Math.sin(a) * R, _c.y, _c.z + Math.cos(a) * R);
      if (!this._project(_v2, _pt)) { okAll = false; break; }
      this.ringPts[i * 2] = _pt.x; this.ringPts[i * 2 + 1] = _pt.y;
    }
    this.ringOk = okAll;
    if (okAll) {
      ctx.beginPath();
      for (let i = 0; i <= RING_N; i++) { const k = (i % RING_N) * 2; if (i) ctx.lineTo(this.ringPts[k], this.ringPts[k + 1]); else ctx.moveTo(this.ringPts[k], this.ringPts[k + 1]); }
      ctx.strokeStyle = COLORS.halo; ctx.lineWidth = 7; ctx.stroke();
      ctx.strokeStyle = this.drag?.mode === 'rotate' ? '#ffffff' : COLORS.ring; ctx.lineWidth = 3.5; ctx.stroke();
      // knob in the prop's facing direction
      const yaw = p.root.rotation.y;
      _v2.set(_c.x + Math.sin(yaw) * R, _c.y, _c.z + Math.cos(yaw) * R);
      this.rotKnob.ok = this._project(_v2, this.rotKnob);
      if (this.rotKnob.ok) drawKnob(ctx, this.rotKnob.x, this.rotKnob.y, 'rotate', this.drag?.mode === 'rotate');
    }

    // --- height knob above the prop
    _v2.set(_c.x, topY, _c.z);
    if (this._project(_v2, this.hKnob)) {
      const top = this._rect.top + 30;
      const ky = Math.max(top, this.hKnob.y - 38);
      ctx.beginPath(); ctx.moveTo(this.hKnob.x, this.hKnob.y - 4); ctx.lineTo(this.hKnob.x, ky + KNOB_R);
      ctx.strokeStyle = COLORS.halo; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
      this.hKnob.y = ky;
      this.hKnob.ok = true;
      drawKnob(ctx, this.hKnob.x, this.hKnob.y, 'height', this.drag?.mode === 'height');
    }
  }

  // ------------------------------------------------------------ hit testing
  hitTest(x, y) {
    if (this.hKnob.ok && Math.hypot(x - this.hKnob.x, y - this.hKnob.y) < HIT_KNOB) return 'height';
    if (this.rotKnob.ok && Math.hypot(x - this.rotKnob.x, y - this.rotKnob.y) < HIT_KNOB) return 'rotate';
    if (this.ringOk) {
      const P = this.ringPts;
      for (let i = 0; i < RING_N; i++) {
        const j = ((i + 1) % RING_N) * 2;
        if (distToSeg(x, y, P[i * 2], P[i * 2 + 1], P[j], P[j + 1]) < HIT_RING) return 'rotate';
      }
    }
    return null;
  }

  // ------------------------------------------------------------ input
  _setupInput() {
    const app = this.app, c = app.canvas;
    const down = (e) => {
      if (this.drag) { if (e.pointerId !== this.drag.pointerId) e.stopImmediatePropagation(); return; }
      if (e.button > 0) return;
      const p = this.target;
      if (!p || p.hold) return;
      let mode = this.hitTest(e.clientX, e.clientY);
      let hit = null;
      if (!mode) {
        app.pointerToNDC(e, _ndc);
        hit = this.manager.pick(_ndc, { only: p });
        if (hit) mode = 'move';
      }
      if (!mode) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this._startDrag(e, p, mode, hit);
    };
    const move = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      e.stopImmediatePropagation();
      d.lastX = e.clientX; d.lastY = e.clientY;
      if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; if (this.drag === d) this._dragTo(d.lastX, d.lastY); });
    };
    const up = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      e.stopImmediatePropagation();
      if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; if (e.type === 'pointerup') this._dragTo(e.clientX, e.clientY); }
      this.drag = null;
      app.controls.enabled = d.controlsWasEnabled;
      try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      this.shell.hint('');
      app.invalidate();
      if (d.moved) app.commit(d.mode === 'move' ? 'sposta oggetto' : d.mode === 'rotate' ? 'ruota oggetto' : 'altezza oggetto');
    };
    c.addEventListener('pointerdown', down, { capture: true });
    c.addEventListener('pointermove', move, { capture: true });
    c.addEventListener('pointerup', up, { capture: true });
    c.addEventListener('pointercancel', up, { capture: true });
  }

  _ray(x, y) {
    this.app.pointerToNDC({ clientX: x, clientY: y }, _ndc);
    const rc = this.manager.raycaster;
    rc.setFromCamera(_ndc, this.app.camera);
    return rc.ray;
  }

  _startDrag(e, p, mode, hit) {
    const app = this.app;
    const d = {
      pointerId: e.pointerId, mode, prop: p, moved: false, raf: 0,
      x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY,
      controlsWasEnabled: app.controls.enabled,
      startPos: p.root.position.clone(), startYaw: p.root.rotation.y,
    };
    app.controls.enabled = false;
    const ray = this._ray(e.clientX, e.clientY);
    if (mode === 'move') {
      d.planeY = hit ? hit.point.y : p.root.position.y;
      _plane.set(_n.set(0, 1, 0), -d.planeY);
      d.grab = ray.intersectPlane(_plane, new THREE.Vector3()) || p.root.position.clone();
      d.offset = p.root.position.clone().sub(d.grab);
      this.shell.hint('Trascina per spostare');
    } else if (mode === 'rotate') {
      d.planeY = p.root.position.y + 0.004;
      d.screen = Math.abs(ray.direction.y) < 0.18; // ring seen edge-on: turntable by horizontal drag
      if (!d.screen) {
        _plane.set(_n.set(0, 1, 0), -d.planeY);
        const q = ray.intersectPlane(_plane, _v);
        d.a0 = q ? Math.atan2(q.x - p.root.position.x, q.z - p.root.position.z) : 0;
      }
      d.lastSnap = Math.round(d.startYaw / SNAP);
      this._hintRotate(p.root.rotation.y);
    } else {
      // vertical plane through the prop, facing the camera
      const cam = app.camera;
      cam.getWorldDirection(_n); _n.y = 0;
      if (_n.lengthSq() < 1e-6) _n.set(0, 0, -1);
      _n.normalize();
      _plane.setFromNormalAndCoplanarPoint(_n, p.root.position);
      d.normal = _n.clone();
      const q = ray.intersectPlane(_plane, _v);
      d.y0 = q ? q.y : p.root.position.y;
      d.wpp = this._worldPerPixel(p.root.position);
      this._hintHeight(p.root.position.y);
    }
    this.drag = d;
    haptic(8);
    app.invalidate();
  }

  _dragTo(x, y) {
    const d = this.drag, p = d.prop, m = this.manager;
    if (!m.props.includes(p) || p.hold) return;
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < 3) return;
    const ray = this._ray(x, y);
    if (d.mode === 'move') {
      if (Math.abs(ray.direction.y) < 0.015) return;
      _plane.set(_n.set(0, 1, 0), -d.planeY);
      const q = ray.intersectPlane(_plane, _v);
      if (!q || q.distanceTo(ray.origin) > 60) return;
      m.moveTo(p, q.x + d.offset.x, q.z + d.offset.z);
    } else if (d.mode === 'rotate') {
      let yaw;
      if (d.screen) yaw = d.startYaw + (x - d.x0) * 0.012;
      else {
        _plane.set(_n.set(0, 1, 0), -d.planeY);
        const q = ray.intersectPlane(_plane, _v);
        if (!q) return;
        const a = Math.atan2(q.x - d.startPos.x, q.z - d.startPos.z);
        yaw = d.startYaw + wrapAngle(a - d.a0);
      }
      if (this.snap) {
        const k = Math.round(yaw / SNAP);
        if (k !== d.lastSnap) { d.lastSnap = k; haptic(6); }
        yaw = k * SNAP;
      }
      m.setYaw(p, yaw);
      this._hintRotate(p.root.rotation.y);
    } else {
      _plane.setFromNormalAndCoplanarPoint(d.normal, d.startPos);
      const q = ray.intersectPlane(_plane, _v);
      // fallback (plane edge-on): screen pixels -> meters at the prop distance
      let yNew = q ? d.startPos.y + (q.y - d.y0) : d.startPos.y - (y - d.y0) * d.wpp;
      yNew = THREE.MathUtils.clamp(yNew, -2, 8);
      if (Math.abs(yNew) < 0.015) yNew = 0; // magnet to the floor
      m.setHeight(p, yNew);
      this._hintHeight(yNew);
    }
    d.moved = true;
  }

  _hintRotate(yaw) { this.shell.hint(`Rotazione ${Math.round(THREE.MathUtils.radToDeg(yaw))}°${this.snap ? ' · scatto 15°' : ''}`); }
  _hintHeight(y) { this.shell.hint(`Altezza da terra ${y.toFixed(2)} m`); }

  setSnap(v) {
    this.snap = !!v;
    try { localStorage.setItem('pv.props.snap', this.snap ? '1' : '0'); } catch { /* ignore */ }
  }
}

function loadSnap() {
  try { return localStorage.getItem('pv.props.snap') !== '0'; } catch { return true; }
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Round knob with a small glyph ('rotate' arcs or 'height' arrows). */
function drawKnob(ctx, x, y, kind, active) {
  ctx.beginPath();
  ctx.arc(x, y, KNOB_R + 2.5, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.halo; ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, KNOB_R, 0, Math.PI * 2);
  ctx.fillStyle = active ? '#ffffff' : COLORS.knob; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  ctx.strokeStyle = active ? COLORS.knob : '#ffffff';
  ctx.fillStyle = active ? COLORS.knob : '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (kind === 'rotate') {
    ctx.arc(x, y, 7, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 7, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    arrowHead(ctx, x + 7 * Math.cos(Math.PI * 0.15), y + 7 * Math.sin(Math.PI * 0.15), -Math.PI * 0.35);
    arrowHead(ctx, x + 7 * Math.cos(Math.PI * 1.15), y + 7 * Math.sin(Math.PI * 1.15), Math.PI * 0.65);
  } else {
    ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.stroke();
    arrowHead(ctx, x, y - 8, -Math.PI / 2);
    arrowHead(ctx, x, y + 8, Math.PI / 2);
  }
}

function arrowHead(ctx, x, y, dir) {
  const s = 4;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(dir) * s, y + Math.sin(dir) * s);
  ctx.lineTo(x + Math.cos(dir + 2.3) * s, y + Math.sin(dir + 2.3) * s);
  ctx.lineTo(x + Math.cos(dir - 2.3) * s, y + Math.sin(dir - 2.3) * s);
  ctx.closePath();
  ctx.fill();
}
