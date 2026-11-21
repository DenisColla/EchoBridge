// Ground handles of the selected animal on a 2D overlay canvas (constant
// on-screen size, never inked or exported): a ring around the body with a
// knob to turn it, and dragging the body moves it on the ground. Active only
// while the "Animali" tool is open. A press released without dragging falls
// through to the tap router (selects the touched body part).
import * as THREE from 'three';
import { haptic } from '../ui/kit.js';

const RING_N = 64, KNOB_R = 15, HIT_KNOB = 28, HIT_RING = 16, SNAP = Math.PI / 12;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(0, 1, 0);
const _ndc = new THREE.Vector2(), _plane = new THREE.Plane(), _box = new THREE.Box3();
const _pt = { x: 0, y: 0 };

export class AnimalGizmo {
  constructor(app, shell, manager, isActive) {
    this.app = app; this.shell = shell; this.manager = manager; this.isActive = isActive;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pv-an-gizmo';
    shell.overlay.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.ring = new Float32Array(RING_N * 2);
    this.ringOk = false;
    this.knob = { x: 0, y: 0, ok: false };
    this.drag = null;
    this._drawn = false;
    this._dirty = true;
    app.addEventListener('resize', () => { this._dirty = true; });
    app.addAfterRenderHook(() => this.draw());
    this._input();
  }

  get target() { const a = this.manager.selected; return a && this.isActive() && a.root.visible ? a : null; }

  _fit() {
    if (!this._dirty && this._rect) return;
    this._dirty = false;
    this._rect = this.app.canvas.getBoundingClientRect();
    const r = this.shell.overlay.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.dpr = dpr; this.ox = r.left; this.oy = r.top;
  }

  _project(world, out) {
    _v.copy(world).project(this.app.camera);
    if (_v.z > 1 || _v.z < -1) return false;
    const r = this._rect;
    out.x = r.left + (_v.x + 1) * 0.5 * r.width;
    out.y = r.top + (1 - _v.y) * 0.5 * r.height;
    return true;
  }

  draw() {
    const a = this.target;
    if (!a) {
      if (this._drawn) { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this._drawn = false; }
      this.ringOk = this.knob.ok = false;
      return;
    }
    this._fit();
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, -this.ox * dpr, -this.oy * dpr);
    this._drawn = true;
    // ring: ellipse-ish circle around the footprint (radius from the posed box)
    a.worldBox(_box);
    _c.set((_box.min.x + _box.max.x) / 2, a.root.position.y + 0.004, (_box.min.z + _box.max.z) / 2);
    const R = Math.max(0.25, Math.hypot(_box.max.x - _box.min.x, _box.max.z - _box.min.z) * 0.55);
    this.center = _c.clone();
    let ok = true;
    for (let i = 0; i < RING_N; i++) {
      const t = (i / RING_N) * Math.PI * 2;
      _v2.set(_c.x + Math.sin(t) * R, _c.y, _c.z + Math.cos(t) * R);
      if (!this._project(_v2, _pt)) { ok = false; break; }
      this.ring[i * 2] = _pt.x; this.ring[i * 2 + 1] = _pt.y;
    }
    this.ringOk = ok;
    this.knob.ok = false;
    if (!ok) return;
    ctx.beginPath();
    for (let i = 0; i <= RING_N; i++) { const k = (i % RING_N) * 2; if (i) ctx.lineTo(this.ring[k], this.ring[k + 1]); else ctx.moveTo(this.ring[k], this.ring[k + 1]); }
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = this.drag?.mode === 'rotate' ? '#ffffff' : '#f2a65a'; ctx.lineWidth = 3.5; ctx.stroke();
    const yaw = a.root.rotation.y;
    _v2.set(_c.x + Math.sin(yaw) * R, _c.y, _c.z + Math.cos(yaw) * R);
    this.knob.ok = this._project(_v2, this.knob);
    if (this.knob.ok) {
      const { x, y } = this.knob, act = this.drag?.mode === 'rotate';
      ctx.beginPath(); ctx.arc(x, y, KNOB_R + 2.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, KNOB_R, 0, Math.PI * 2); ctx.fillStyle = act ? '#ffffff' : '#f2a65a'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      ctx.strokeStyle = act ? '#f2a65a' : '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, 7, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 7, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    }
  }

  hitTest(x, y) {
    if (this.knob.ok && Math.hypot(x - this.knob.x, y - this.knob.y) < HIT_KNOB) return 'rotate';
    if (this.ringOk) {
      const P = this.ring;
      for (let i = 0; i < RING_N; i++) {
        const j = ((i + 1) % RING_N) * 2;
        if (segDist(x, y, P[i * 2], P[i * 2 + 1], P[j], P[j + 1]) < HIT_RING) return 'rotate';
      }
    }
    return null;
  }

  _ray(x, y) {
    this.app.pointerToNDC({ clientX: x, clientY: y }, _ndc);
    this.manager.raycaster.setFromCamera(_ndc, this.app.camera);
    return this.manager.raycaster.ray;
  }

  _input() {
    const app = this.app, c = app.canvas;
    const down = (e) => {
      if (this.drag) { if (e.pointerId !== this.drag.pointerId) e.stopImmediatePropagation(); return; }
      if (e.button > 0) return;
      const a = this.target;
      if (!a) return;
      let mode = this.hitTest(e.clientX, e.clientY);
      let hit = null;
      if (!mode) {
        app.pointerToNDC(e, _ndc);
        hit = this.manager.pick(_ndc, { only: a });
        if (hit) mode = 'move';
      }
      if (!mode) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const d = { pointerId: e.pointerId, mode, animal: a, moved: false, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, raf: 0, controls: app.controls.enabled, startPos: a.root.position.clone(), startYaw: a.root.rotation.y, event: e };
      app.controls.enabled = false;
      const ray = this._ray(e.clientX, e.clientY);
      if (mode === 'move') {
        d.planeY = a.root.position.y;
        _plane.set(_n, -d.planeY);
        const g = ray.intersectPlane(_plane, new THREE.Vector3()) || a.root.position.clone();
        d.offset = a.root.position.clone().sub(g);
      } else {
        _plane.set(_n, -(a.root.position.y + 0.004));
        const q = ray.intersectPlane(_plane, _v);
        const cc = this.center || a.root.position;
        d.cx = cc.x; d.cz = cc.z;
        d.a0 = q ? Math.atan2(q.x - cc.x, q.z - cc.z) : 0;
        d.screen = Math.abs(ray.direction.y) < 0.18;
        d.lastSnap = Math.round(d.startYaw / SNAP);
      }
      this.drag = d;
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
      if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; if (e.type === 'pointerup' && d.moved) this._dragTo(e.clientX, e.clientY); }
      this.drag = null;
      app.controls.enabled = d.controls;
      try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      this.shell.hint('');
      app.invalidate();
      if (d.moved) { this.manager.dispatchEvent({ type: 'change', animal: d.animal, what: 'placement' }); app.commit(d.mode === 'move' ? 'sposta animale' : 'ruota animale'); }
      else if (e.type === 'pointerup' && e.timeStamp - d.event.timeStamp < 450) app.routeTap(e); // a tap on the body: select the part
    };
    c.addEventListener('pointerdown', down, { capture: true });
    c.addEventListener('pointermove', move, { capture: true });
    c.addEventListener('pointerup', up, { capture: true });
    c.addEventListener('pointercancel', up, { capture: true });
  }

  _dragTo(x, y) {
    const d = this.drag, a = d.animal;
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < 6) return;
    if (!d.moved) haptic(8);
    const ray = this._ray(x, y);
    if (d.mode === 'move') {
      if (Math.abs(ray.direction.y) < 0.015) return;
      _plane.set(_n, -d.planeY);
      const q = ray.intersectPlane(_plane, _v);
      if (!q || q.distanceTo(ray.origin) > 80) return;
      a.root.position.set(q.x + d.offset.x, d.planeY, q.z + d.offset.z);
      this.shell.hint('Trascina per spostare');
    } else {
      let yaw;
      if (d.screen) yaw = d.startYaw + (x - d.x0) * 0.012;
      else {
        _plane.set(_n, -(a.root.position.y + 0.004));
        const q = ray.intersectPlane(_plane, _v);
        if (!q) return;
        yaw = d.startYaw + wrap(Math.atan2(q.x - d.cx, q.z - d.cz) - d.a0);
      }
      const k = Math.round(yaw / SNAP);
      if (Math.abs(yaw - k * SNAP) < 0.06) { if (k !== d.lastSnap) { d.lastSnap = k; haptic(6); } yaw = k * SNAP; }
      // turn around the ring centre (the body), not around the origin
      const dy = yaw - a.root.rotation.y;
      const px = a.root.position.x - d.cx, pz = a.root.position.z - d.cz;
      const cs = Math.cos(dy), sn = Math.sin(dy);
      a.root.position.x = d.cx + px * cs + pz * sn;
      a.root.position.z = d.cz - px * sn + pz * cs;
      a.root.rotation.y = yaw;
      this.shell.hint(`Rotazione ${Math.round(THREE.MathUtils.radToDeg(wrap(yaw)))}°`);
    }
    a.root.updateMatrixWorld(true);
    d.moved = true;
    this.app.invalidate();
  }
}

function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
