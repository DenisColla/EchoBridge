// In-viewport posing handles, drawn on a 2D overlay canvas (constant screen
// size, touch friendly, never inked or exported) with their own pointer input:
//
//  Ruota (FK):  3 rings for the anatomical axes of the selected part (drag
//               along a ring, the allowed range is drawn as a band, the bone
//               direction as a knob) + a center sphere for free "trackball"
//               rotation. Limits are respected, a haptic tick marks a limit.
//  Trascina (IK): handles on hands, feet, head (aim) and pelvis.
//  Sposta:      ground ring (drag = move on the floor) + knob (drag = turn).
//  Linea:       one-finger stroke over the character = line of action (the body
//               bends to follow it, see actionLine.js); the current line of the
//               body and the last stroke are drawn faintly.
//  Joint dots ('Mostra articolazioni'): tap targets for small parts.
import * as THREE from 'three';
import { haptic } from '../ui/kit.js';
import { AXIS_COLORS, toDeg } from './controls.js';

const N_RING = 72;
const SIDES = ['L', 'R'];
const DASH = [3, 4], DASH2 = [4, 4], NODASH = [];
const RING_PX = { l: 70, m: 58, s: 44 };
const HIT_RING = 20, HIT_BALL = 22, BALL_R = 13, HIT_EFF = 27, EFF_R = 13, HIT_DOT = 20;
/** over the body (Tocco diretto on) a ring takes only a press right on its stroke: the part under the finger is dragged directly */
const HIT_RING_BODY = 7;
/** a press on a ring that stays this still for the long-press time goes to the long press (app.holdFrom) */
const HOLD_MS = 480, HOLD_SLOP = 4;
/** Hit radius scale per pointer type: a pen tip (S Pen) or a mouse is far more precise than a finger. */
const HIT_SCALE = { pen: 0.55, mouse: 0.75 };
const reach = (px, pointerType) => px * (HIT_SCALE[pointerType] || 1);
const EFFECTORS = [
  { id: 'hand.L', color: '#b69bff' }, { id: 'hand.R', color: '#b69bff' },
  { id: 'foot.L', color: '#4fd1c5' }, { id: 'foot.R', color: '#4fd1c5' },
  { id: 'head', color: '#ffd166' }, { id: 'pelvis', color: '#ff9f5a' },
];
const EFF_LABEL = { 'hand.L': 'Mano sinistra', 'hand.R': 'Mano destra', 'foot.L': 'Piede sinistro', 'foot.R': 'Piede destro', head: 'Sguardo', pelvis: 'Bacino' };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _c = new THREE.Vector3();
const _u = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _ax = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane();
const _pt = { x: 0, y: 0 }, _pa = { x: 0, y: 0 }, _pb = { x: 0, y: 0 };

export class PoseGizmo {
  /** ctx: module context (app, shell, controls, rig, ik, picker, state, sel(), isActive(), mode(), edited(ch, final, label)) */
  constructor(ctx) {
    this.ctx = ctx;
    const { app, shell } = ctx;
    this.app = app; this.shell = shell;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pv-pose-gizmo passthrough';
    shell.overlay.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.rings = [0, 1, 2].map(() => ({
      k: -1, ok: false, pts: new Float32Array(N_RING * 2), front: new Uint8Array(N_RING), color: '#fff', knob: { x: 0, y: 0, ok: false },
      band: false, b0: 0, b1: 0, a0: 0, basisU: new THREE.Vector3(), basisN: new THREE.Vector3(),
    }));
    this.center = { x: 0, y: 0, ok: false };
    this.effectors = EFFECTORS.map((e) => ({ ...e, x: 0, y: 0, ok: false, world: new THREE.Vector3() }));
    this.dots = [];
    this.ground = { pts: new Float32Array(N_RING * 2), ok: false, cx: 0, cy: 0, knob: { x: 0, y: 0, ok: false }, world: new THREE.Vector3(), r: 0.5 };
    this.drag = null;
    this._drawn = false;
    this._handPx = { L: 0, R: 0 };
    this._order = [];
    this._bi = (n) => ctx.rig.model.boneIndex.get(n);
    this._rect = null; this._rectsDirty = true;
    this.lineBox = { x0: 0, y0: 0, x1: 0, y1: 0, ok: false }; // screen bounds of the character (Linea)
    this._linePts = []; this._lineScr = []; this._strokeScr = [];
    app.addEventListener('resize', () => { this._rectsDirty = true; });
    ctx.shell.addEventListener?.('layout', () => { this._rectsDirty = true; });
    app.addAfterRenderHook(() => this.draw());
    this._setupInput();
  }

  // ------------------------------------------------------------ geometry helpers
  _fit() {
    if (!this._rectsDirty && this._rect) return;
    this._rectsDirty = false;
    this._rect = this.app.canvas.getBoundingClientRect();
    const r = this.shell.overlay.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.dpr = dpr; this.ox = r.left; this.oy = r.top;
  }

  /** world -> client px; false when behind the camera */
  _project(p, out) {
    _v.copy(p).project(this.app.camera);
    if (_v.z > 1 || _v.z < -1) return false;
    const r = this._rect;
    out.x = r.left + (_v.x + 1) * 0.5 * r.width;
    out.y = r.top + (1 - _v.y) * 0.5 * r.height;
    return true;
  }

  /** world units per screen pixel around p */
  _wpp(p) {
    const cam = this.app.camera;
    _v2.setFromMatrixColumn(cam.matrixWorld, 0).normalize().multiplyScalar(0.1).add(p);
    if (!this._project(p, _pa) || !this._project(_v2, _pb)) return 0.001;
    return 0.1 / Math.max(1e-3, Math.hypot(_pb.x - _pa.x, _pb.y - _pa.y));
  }

  _ray(x, y) {
    this.app.pointerToNDC({ clientX: x, clientY: y }, _ndc);
    const rc = this.ctx.picker.raycaster;
    this.app.camera.updateMatrixWorld();
    rc.setFromCamera(_ndc, this.app.camera);
    return rc.ray;
  }

  // ------------------------------------------------------------ drawing
  draw() {
    const ctx = this.ctx;
    // Vista pulita: no handles (direct touch still poses); hidden handles are not hit either
    const active = ctx.isActive() && !this.shell.cleanView;
    const ch = ctx.sel().character;
    if (!active || !ch || !ch.root.visible) {
      for (const r of this.rings) r.ok = false;
      this.center.ok = false; this.ground.ok = false; this.dots.length = 0;
      for (const e of this.effectors) e.ok = false;
      if (this._drawn) { this.g.setTransform(1, 0, 0, 1, 0, 0); this.g.clearRect(0, 0, this.canvas.width, this.canvas.height); this._drawn = false; }
      return;
    }
    this._fit();
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, -this.ox * this.dpr, -this.oy * this.dpr);
    this._drawn = true;
    const mode = ctx.mode();
    if (ctx.state.showJoints && mode === 'rotate') this._drawDots(ch);
    else this.dots.length = 0;
    for (const r of this.rings) r.ok = false;
    this.center.ok = false; this.ground.ok = false;
    for (const e of this.effectors) e.ok = false;
    this.lineBox.ok = false;
    if (mode === 'rotate') {
      const ctrl = ctx.sel().control;
      if (ctrl) this._drawRings(ch, ctrl);
    } else if (mode === 'ik') this._drawEffectors(ch);
    else if (mode === 'move') this._drawGround(ch);
    // (Linea only while the Posa panel is open: with the panel closed one-finger drags orbit)
    else if (mode === 'line' && this.shell.activeToolId === 'pose') this._drawLine(ch);
  }

  // ------------------------------------------------------------ line of action
  _drawLine(ch) {
    const g = this.g, line = this.ctx.line;
    // screen bounds of the character (stroke start area): body line + hands + elbows
    const pts = line.bodyLine(ch, this._linePts);
    const box = this.lineBox;
    box.x0 = box.y0 = Infinity; box.x1 = box.y1 = -Infinity;
    const scr = this._lineScr;
    let n = 0;
    const add = (p) => {
      if (!this._project(p, _pt)) return false;
      box.x0 = Math.min(box.x0, _pt.x); box.x1 = Math.max(box.x1, _pt.x); box.y0 = Math.min(box.y0, _pt.y); box.y1 = Math.max(box.y1, _pt.y);
      return true;
    };
    for (const p of pts) {
      if (!add(p)) continue;
      const o = scr[n] || (scr[n] = { x: 0, y: 0 });
      o.x = _pt.x; o.y = _pt.y; n++;
    }
    for (const id of ['hand.L', 'hand.R', 'foot.L', 'foot.R']) add(line.terminal(ch, id, _v2));
    box.ok = n > 1 && box.x1 > box.x0;
    if (!box.ok) return;
    const m = 56; // finger margin
    box.x0 -= m; box.y0 -= m; box.x1 += m; box.y1 += m;
    // current line of the body: faint dashed curve
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.setLineDash([2, 7]);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 5; smoothPath(g, scr, n); g.stroke();
    g.strokeStyle = 'rgba(255,184,107,.85)'; g.lineWidth = 2.5; smoothPath(g, scr, n); g.stroke();
    g.setLineDash(NODASH);
    // last stroke (world points on its plane): faint
    const last = line.last;
    if (last && last.ch === ch && !(this.drag?.kind === 'stroke')) {
      let k = 0;
      for (const p of last.world) {
        if (!this._project(p, _pt)) continue;
        const o = this._strokeScr[k] || (this._strokeScr[k] = { x: 0, y: 0 });
        o.x = _pt.x; o.y = _pt.y; k++;
      }
      g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 9; smoothPath(g, this._strokeScr, k); g.stroke();
      g.strokeStyle = 'rgba(182,155,255,.6)'; g.lineWidth = 5; smoothPath(g, this._strokeScr, k); g.stroke();
    }
    // stroke being drawn
    if (this.drag?.kind === 'stroke' && this.drag.pts.length > 1) {
      const P = this.drag.pts;
      g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 9; smoothPath(g, P, P.length); g.stroke();
      g.strokeStyle = '#c9b8ff'; g.lineWidth = 5; smoothPath(g, P, P.length); g.stroke();
    }
    g.restore();
  }

  _drawRings(ch, ctrl) {
    const { rig } = this.ctx;
    const g = this.g;
    const C = rig.worldPos(ch, ctrl.pivotIndex, _c);
    if (!this._project(C, this.center)) return;
    this.center.ok = true;
    const Rpx = RING_PX[ctrl.size] || 56;
    const wpp = this._wpp(C);
    const r = Rpx * wpp;
    const camPos = this.app.camera.getWorldPosition(_v3);
    const toCam = _w.subVectors(camPos, C).normalize();
    const vis = this.ctx.visibleAxes(ctrl);
    const dragK = this.drag?.kind === 'ring' ? this.drag.k : -1;
    // back halves first, then front halves (simple depth cue)
    const order = this._order;
    order.length = 0;
    for (let slot = 0; slot < vis.length; slot++) {
      const k = vis[slot];
      const ring = this.rings[slot];
      ring.k = k;
      ring.color = AXIS_COLORS[slot];
      rig.axisWorld(ch, ctrl, k, _ax);
      // basis of the ring plane
      _u.set(1, 0, 0); if (Math.abs(_u.dot(_ax)) > 0.9) _u.set(0, 1, 0);
      _u.addScaledVector(_ax, -_u.dot(_ax)).normalize();
      _n.crossVectors(_ax, _u);
      let ok = true;
      for (let j = 0; j < N_RING; j++) {
        const t = (j / N_RING) * Math.PI * 2;
        _v2.copy(C).addScaledVector(_u, Math.cos(t) * r).addScaledVector(_n, Math.sin(t) * r);
        if (!this._project(_v2, _pt)) { ok = false; break; }
        ring.pts[j * 2] = _pt.x; ring.pts[j * 2 + 1] = _pt.y;
        ring.front[j] = _v2.sub(C).dot(toCam) >= -1e-6 ? 1 : 0;
      }
      ring.ok = ok;
      if (!ok) continue;
      // bone direction knob + allowed range band
      const ref = this._refDir(ch, ctrl, k, _ax, _v2);
      const lim = rig.limitsOf(ch, ctrl, k);
      const val = rig.read(ch, ctrl, k);
      ring.knob.ok = false;
      if (ref) {
        // ref is in the ring plane: angle of ref in (u, n) basis
        const a0 = Math.atan2(ref.dot(_n), ref.dot(_u));
        ring.a0 = a0;
        if (this._project(_v3.copy(C).addScaledVector(ref, r), ring.knob)) ring.knob.ok = true;
        ring.band = !!lim;
        if (lim) {
          ring.b0 = a0 + (lim[0] - val); ring.b1 = a0 + (lim[1] - val);
          ring.basisU.copy(_u); ring.basisN.copy(_n);
        }
      } else ring.band = false;
      if (ring.band) this._drawBand(C, r, ring);
      order.push(slot);
    }
    const fade = this.isQuiet() && dragK < 0 ? 0.5 : 1; // quiet rings (selected by a drag): fainter
    for (let pass = 0; pass < 2; pass++) {
      for (const slot of order) {
        const ring = this.rings[slot];
        const hot = ring.k === dragK;
        g.strokeStyle = ring.color;
        g.lineCap = 'round';
        g.globalAlpha = (pass ? 1 : 0.32) * fade;
        g.lineWidth = pass ? (hot ? 5 : 3.2) : 2;
        // halo for contrast on any background
        if (pass) {
          g.save(); g.strokeStyle = 'rgba(0,0,0,.45)'; g.globalAlpha = fade; g.lineWidth = g.lineWidth + 3; this._strokeRing(ring, 1); g.restore();
        }
        this._strokeRing(ring, pass);
      }
    }
    g.globalAlpha = 1;
    for (const slot of order) {
      const ring = this.rings[slot];
      if (!ring.knob.ok) continue;
      g.beginPath(); g.arc(ring.knob.x, ring.knob.y, 6.5, 0, Math.PI * 2);
      g.fillStyle = ring.color; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
    }
    // trackball center
    g.beginPath(); g.arc(this.center.x, this.center.y, BALL_R, 0, Math.PI * 2);
    g.fillStyle = this.drag?.kind === 'ball' ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.28)';
    g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke();
    g.beginPath(); g.arc(this.center.x, this.center.y, 3, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  }

  /** direction (in the ring plane) used as the ring's "hand": the bone itself when possible */
  _refDir(ch, ctrl, k, axis, out) {
    const i = ctrl.axes[k].pd.i;
    const m = ch.bones[i].matrixWorld;
    for (const col of [1, 2, 0]) {
      out.setFromMatrixColumn(m, col).normalize();
      out.addScaledVector(axis, -out.dot(axis));
      if (out.lengthSq() > 0.12) return out.normalize();
    }
    return null;
  }

  _drawBand(C, r, ring) {
    const g = this.g;
    const a = ring.b0;
    let b = ring.b1;
    if (b - a > Math.PI * 2) b = a + Math.PI * 2;
    const steps = Math.max(6, Math.ceil(((b - a) / (Math.PI * 2)) * N_RING));
    g.beginPath();
    for (let j = 0; j <= steps; j++) {
      const t = a + ((b - a) * j) / steps;
      _v2.copy(C).addScaledVector(ring.basisU, Math.cos(t) * r).addScaledVector(ring.basisN, Math.sin(t) * r);
      if (!this._project(_v2, _pt)) return;
      if (j) g.lineTo(_pt.x, _pt.y); else g.moveTo(_pt.x, _pt.y);
    }
    g.strokeStyle = ring.color; g.globalAlpha = 0.22; g.lineWidth = 11; g.lineCap = 'butt';
    g.stroke();
    g.globalAlpha = 1;
  }

  _strokeRing(ring, front) {
    const g = this.g, P = ring.pts, F = ring.front;
    g.beginPath();
    let pen = false;
    for (let j = 0; j <= N_RING; j++) {
      const i = j % N_RING, ip = (j + N_RING - 1) % N_RING;
      const seg = j > 0 && (F[i] === front || F[ip] === front);
      if (seg) {
        if (!pen) { g.moveTo(P[ip * 2], P[ip * 2 + 1]); pen = true; }
        g.lineTo(P[i * 2], P[i * 2 + 1]);
      } else pen = false;
    }
    g.stroke();
  }

  _drawEffectors(ch) {
    const { ik, state } = this.ctx;
    const g = this.g;
    const dragId = this.drag?.kind === 'effector' ? this.drag.id : null;
    for (const e of this.effectors) {
      const p = dragId === e.id && this.drag.handle ? e.world.copy(this.drag.handle) : ik.effectorPoint(ch, e.id, e.world);
      e.ok = this._project(p, e);
      if (!e.ok) continue;
      // head aim: dotted line from the eyes to the handle
      if (e.id === 'head') {
        if (this._project(ik.eyeCenter(ch, _v2), _pa)) {
          g.save(); g.setLineDash(DASH); g.strokeStyle = 'rgba(255,209,102,.8)'; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(_pa.x, _pa.y); g.lineTo(e.x, e.y); g.stroke(); g.restore();
        }
      }
      const hot = dragId === e.id;
      g.beginPath(); g.arc(e.x, e.y, hot ? EFF_R + 3 : EFF_R, 0, Math.PI * 2);
      g.fillStyle = e.color; g.globalAlpha = hot ? 0.95 : 0.78; g.fill(); g.globalAlpha = 1;
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(255,255,255,.95)'; g.stroke();
      if (e.id.startsWith('foot') && state.pinFeet && dragId !== e.id) {
        // pin mark
        g.beginPath(); g.arc(e.x, e.y, 4, 0, Math.PI * 2); g.fillStyle = '#10141c'; g.fill();
      }
      if (e.id === 'pelvis') {
        g.strokeStyle = '#10141c'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(e.x - 6, e.y); g.lineTo(e.x + 6, e.y); g.moveTo(e.x, e.y - 6); g.lineTo(e.x, e.y + 6); g.stroke();
      }
    }
  }

  _groundCenter(ch, out) {
    // pelvis projected on the character's floor
    this.ctx.rig.worldPos(ch, 0, out);
    out.y = ch.root.getWorldPosition(_v3).y;
    return out;
  }

  _drawGround(ch) {
    const gr = this.ground, g = this.g;
    const C = this._groundCenter(ch, gr.world);
    gr.r = 0.5 * ch.root.scale.x;
    if (!this._project(C, _pt)) return;
    gr.cx = _pt.x; gr.cy = _pt.y;
    for (let j = 0; j < N_RING; j++) {
      const t = (j / N_RING) * Math.PI * 2;
      _v2.set(C.x + Math.cos(t) * gr.r, C.y, C.z + Math.sin(t) * gr.r);
      if (!this._project(_v2, _pt)) return;
      gr.pts[j * 2] = _pt.x; gr.pts[j * 2 + 1] = _pt.y;
    }
    gr.ok = true;
    const yaw = ch.root.rotation.y;
    // facing direction: dashed line + arrow head on the ring
    _v2.set(C.x + Math.sin(yaw) * gr.r, C.y, C.z + Math.cos(yaw) * gr.r);
    const faceOk = this._project(_v2, _pa);
    // turn knob: in the facing direction when that spot is visible, otherwise the
    // closest visible spot of the ring (in portrait the feet are often near the
    // bottom sheet, which would hide a knob drawn toward the camera)
    gr.knob.ok = this._knobSpot(C, gr.r * 1.18, yaw, gr.knob);
    const hot = this.drag?.kind === 'move' || this.drag?.kind === 'turn';
    g.beginPath();
    for (let j = 0; j <= N_RING; j++) { const i = j % N_RING; if (j) g.lineTo(gr.pts[i * 2], gr.pts[i * 2 + 1]); else g.moveTo(gr.pts[0], gr.pts[1]); }
    g.fillStyle = hot ? 'rgba(79,209,197,.18)' : 'rgba(79,209,197,.1)'; g.fill();
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 6; g.stroke();
    g.strokeStyle = '#4fd1c5'; g.lineWidth = 3; g.stroke();
    if (faceOk) {
      g.strokeStyle = '#4fd1c5'; g.lineWidth = 2.5; g.setLineDash(DASH2);
      g.beginPath(); g.moveTo(gr.cx, gr.cy); g.lineTo(_pa.x, _pa.y); g.stroke(); g.setLineDash(NODASH);
      const ax = _pa.x - gr.cx, ay = _pa.y - gr.cy, al = Math.hypot(ax, ay);
      if (al > 4) {
        const ux = ax / al, uy = ay / al;
        g.beginPath(); g.moveTo(_pa.x + ux * 9, _pa.y + uy * 9);
        g.lineTo(_pa.x - uy * 6, _pa.y + ux * 6); g.lineTo(_pa.x + uy * 6, _pa.y - ux * 6); g.closePath();
        g.fillStyle = '#4fd1c5'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke();
      }
    }
    if (gr.knob.ok) {
      g.beginPath(); g.arc(gr.knob.x, gr.knob.y, 14, 0, Math.PI * 2);
      g.fillStyle = '#7c6cff'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke();
      // rotate glyph
      g.beginPath(); g.arc(gr.knob.x, gr.knob.y, 6, -0.3, Math.PI * 1.35); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    }
  }

  /** screen spot of the turn knob on a ground circle (center C, radius r): see _drawGround */
  _knobSpot(C, r, yaw, out) {
    const rc = this._rect, ins = this.shell.getViewInsets?.() || { top: 0, right: 0, bottom: 0, left: 0 };
    const m = 22;
    const x0 = rc.left + ins.left + m, x1 = rc.right - ins.right - m, y0 = rc.top + ins.top + m, y1 = rc.bottom - ins.bottom - m;
    const free = (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    let best = false, bestD = Infinity;
    for (let k = 0; k < 36; k++) {
      // 0, +10°, -10°, +20° … : the first visible spot closest to the facing direction wins
      const da = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 18);
      const a = yaw + da;
      _v3.set(C.x + Math.sin(a) * r, C.y, C.z + Math.cos(a) * r);
      if (!this._project(_v3, _pb)) continue;
      if (k === 0) { out.x = _pb.x; out.y = _pb.y; best = true; } // fallback: facing spot
      if (free(_pb) && Math.abs(da) < bestD) { bestD = Math.abs(da); out.x = _pb.x; out.y = _pb.y; best = true; break; }
    }
    return best;
  }

  _drawDots(ch) {
    const { controls, rig } = this.ctx;
    const g = this.g;
    const sel = this.ctx.sel().control;
    // finger dots only when the hand is big enough on screen
    const handPx = this._handPx;
    for (const s of SIDES) {
      const ok = this._project(rig.worldPos(ch, this._bi('wrist.' + s), _v2), _pa) && this._project(rig.pointOnBone(ch, this._bi('finger3-3.' + s), 1, _v3), _pb);
      handPx[s] = ok ? Math.hypot(_pa.x - _pb.x, _pa.y - _pb.y) : 0;
    }
    let n = 0;
    for (const c of controls.list) {
      if (c.region === 'finger' && handPx[c.side] < 90) continue;
      const i = this._bi(c.dot[0]);
      const p = c.dot[1] ? rig.pointOnBone(ch, i, c.dot[1], _v2) : rig.worldPos(ch, i, _v2);
      if (!this._project(p, _pt)) continue;
      const d = this.dots[n] || (this.dots[n] = { id: '', x: 0, y: 0 });
      d.id = c.id; d.x = _pt.x; d.y = _pt.y; n++;
      const on = sel === c;
      const rad = c.region === 'finger' ? 4.5 : 6;
      g.beginPath(); g.arc(_pt.x, _pt.y, on ? rad + 2.5 : rad, 0, Math.PI * 2);
      g.fillStyle = on ? '#a89dff' : 'rgba(255,255,255,.85)'; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = 'rgba(16,20,28,.85)'; g.stroke();
    }
    this.dots.length = n;
  }

  // ------------------------------------------------------------ hit tests
  /** nearest joint dot within reach (client px); pointerType 'pen' / 'mouse' reach less far */
  hitDot(x, y, pointerType) {
    let best = null, bd = reach(HIT_DOT, pointerType);
    for (const d of this.dots) { const dd = Math.hypot(d.x - x, d.y - y); if (dd < bd) { bd = dd; best = d; } }
    return best ? best.id : null;
  }

  hitTest(x, y, pointerType) {
    const mode = this.ctx.mode();
    if (mode === 'rotate') {
      if (this.center.ok && Math.hypot(x - this.center.x, y - this.center.y) < reach(HIT_BALL, pointerType)) return { kind: 'ball' };
      let best = null, bd = reach(HIT_RING, pointerType);
      for (const ring of this.rings) {
        if (!ring.ok) continue;
        const d = this._distRing(ring, x, y);
        if (d < bd) { bd = d; best = ring; }
      }
      if (best) return { kind: 'ring', k: best.k, ring: best };
    } else if (mode === 'ik') {
      let best = null, bd = reach(HIT_EFF, pointerType);
      for (const e of this.effectors) { if (!e.ok) continue; const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } }
      if (best) return { kind: 'effector', id: best.id };
    } else if (mode === 'line') {
      const b = this.lineBox;
      if (b.ok && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return { kind: 'stroke' };
    } else if (mode === 'move') {
      const gr = this.ground;
      if (gr.knob.ok && Math.hypot(gr.knob.x - x, gr.knob.y - y) < 26) return { kind: 'turn' };
      if (gr.ok && (this._insidePoly(gr.pts, x, y) || this._distPoly(gr.pts, x, y) < 22)) return { kind: 'move' };
    }
    return null;
  }

  /**
   * hitTest as a press over the body sees it (Tocco diretto): a ring only on its stroke.
   * Used by the S Pen hover glow.
   */
  hitTestBody(x, y, pointerType) {
    const hit = this.hitTest(x, y, pointerType);
    if (hit && (hit.kind === 'ring' || hit.kind === 'ball') && this._yieldsToBody({ clientX: x, clientY: y, pointerType, button: 0, buttons: 0 }, hit)) return null;
    return hit;
  }

  /** a press on a ring / the ball that belongs to the body part under it (Tocco diretto) */
  _yieldsToBody(e, hit) {
    const under = this.ctx.direct?.bodyControl?.(e);
    if (!under) return false;
    const sel = this.ctx.sel().control;
    const other = under !== sel, x = e.clientX, y = e.clientY, pt = e.pointerType;
    if (other && this.isQuiet()) return true;
    if (hit.kind === 'ring') return this._distRing(hit.ring, x, y) > reach(HIT_RING_BODY, pt);
    return other && Math.hypot(x - this.center.x, y - this.center.y) > reach(BALL_R + 3, pt);
  }

  /**
   * Quiet rings: the part was selected by a direct drag, not by a tap. They are drawn fainter
   * and leave every press on another body part to direct touch; a tap on the part (or any
   * other selection) makes them normal handles again.
   */
  setQuiet(ch, part) { this._quiet = ch && part ? { ch, part } : null; this.app.invalidate(); }
  isQuiet() { const q = this._quiet, s = this.app.selection; return !!q && q.ch === s.character && q.part === s.part; }

  _distRing(ring, x, y) {
    const P = ring.pts, F = ring.front;
    let best = Infinity;
    for (let j = 0; j < N_RING; j++) {
      const i2 = (j + 1) % N_RING;
      let d = segDist(x, y, P[j * 2], P[j * 2 + 1], P[i2 * 2], P[i2 * 2 + 1]);
      if (!F[j] && !F[i2]) d += 5; // prefer the visible half
      if (d < best) best = d;
    }
    return best;
  }

  _distPoly(P, x, y) {
    let best = Infinity;
    for (let j = 0; j < N_RING; j++) { const i2 = (j + 1) % N_RING; best = Math.min(best, segDist(x, y, P[j * 2], P[j * 2 + 1], P[i2 * 2], P[i2 * 2 + 1])); }
    return best;
  }

  _insidePoly(P, x, y) {
    let inside = false;
    for (let i = 0, j = N_RING - 1; i < N_RING; j = i++) {
      const xi = P[i * 2], yi = P[i * 2 + 1], xj = P[j * 2], yj = P[j * 2 + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // ------------------------------------------------------------ input
  _setupInput() {
    const app = this.app, c = app.canvas;
    // pointers currently down on the canvas: a handle drag never starts in the
    // middle of another gesture (e.g. the second finger of a pinch)
    const downIds = new Set();
    const forget = (e) => downIds.delete(e.pointerId);
    window.addEventListener('pointerup', forget, true);
    window.addEventListener('pointercancel', forget, true);
    const down = (e) => {
      const busy = downIds.size > 0;
      downIds.add(e.pointerId);
      if (this.drag) { if (e.pointerId !== this.drag.pointerId) e.stopImmediatePropagation(); return; }
      // pen barrel (side) button held: the press orbits the camera (io/pen.js), no handle
      if (busy || e.button > 0 || (e.pointerType === 'pen' && ((e.buttons & 2) || this.app.penBarrel)) || !this.ctx.isActive()) return;
      if (this.ctx.direct?.suspended) return; // "Ruota la vista": every drag orbits
      const ch = this.ctx.sel().character;
      if (!ch) return;
      let hit = this.hitTest(e.clientX, e.clientY, e.pointerType);
      // "Tocco diretto": a press on the selected hand / foot / head drags it (IK) instead of the trackball
      if (hit?.kind === 'ball' && this.ctx.direct?.wantsBall(e, ch)) hit = null;
      // the rings and ball of the selected part cross the rest of the body: there they take only
      // a press right on a stroke / on the ball, and none at all while the part was selected by a
      // drag (quiet rings): any other press drags the part under the finger (or long-presses it)
      if (hit && (hit.kind === 'ring' || hit.kind === 'ball') && this._yieldsToBody(e, hit)) hit = null;
      if (!hit && this.ctx.mode() === 'move') {
        // drag the character itself
        this.app.pointerToNDC(e, _ndc);
        const p = this.ctx.picker.pick(_ndc, { only: ch });
        if (p) hit = { kind: 'move', point: p.point };
      }
      if (!hit) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this._start(e, ch, hit);
    };
    const move = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      e.stopImmediatePropagation();
      d.lastX = e.clientX; d.lastY = e.clientY; d.lastEv = e;
      if (d.holdT && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > HOLD_SLOP) { clearTimeout(d.holdT); d.holdT = 0; }
      if (d.kind === 'stroke') {
        // every point counts (coalesced ones too): the stroke is a curve, not a handle
        const evs = e.getCoalescedEvents?.() || [];
        for (const ce of evs.length ? evs : [e]) d.pts.push({ x: ce.clientX, y: ce.clientY });
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) >= d.slop) d.moved = true;
        app.invalidate();
        return;
      }
      if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; if (this.drag === d) this._update(d); });
    };
    const up = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      e.stopImmediatePropagation();
      if (d.holdT) { clearTimeout(d.holdT); d.holdT = 0; }
      // flush the throttled update (pending frame and/or a last move in the up event)
      const pending = !!d.raf;
      if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
      if (e.type === 'pointerup' && d.kind === 'stroke') d.pts.push({ x: e.clientX, y: e.clientY });
      if (e.type === 'pointerup') {
        const moved = e.clientX !== d.lastX || e.clientY !== d.lastY;
        d.lastX = e.clientX; d.lastY = e.clientY;
        if (pending || moved) this._update(d);
      }
      this.drag = null;
      d.cancelled = e.type === 'pointercancel';
      app.controls.enabled = d.controlsWasEnabled;
      try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      this.shell.hint('');
      this._end(d);
      // a quick tap on a handle (no drag): select what is under the finger instead
      if (!d.moved && e.type === 'pointerup' && e.timeStamp - d.t0 < 450 && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 10) this.ctx.routeTap?.(e);
      app.invalidate();
    };
    c.addEventListener('pointerdown', down, { capture: true });
    c.addEventListener('pointermove', move, { capture: true });
    c.addEventListener('pointerup', up, { capture: true });
    c.addEventListener('pointercancel', up, { capture: true });
  }

  _start(e, ch, hit) {
    const { app } = this;
    const { rig, ik, state } = this.ctx;
    const d = {
      pointerId: e.pointerId, kind: hit.kind, ch, moved: false, raf: 0,
      x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, px: e.clientX, py: e.clientY,
      controlsWasEnabled: app.controls.enabled, atLimit: false,
      // touch slop: a finger tap jitters a few px, it must not nudge the pose
      t0: e.timeStamp, slop: e.pointerType === 'touch' ? 7 : 3,
    };
    app.controls.enabled = false;
    if (hit.kind === 'stroke') {
      d.pts = [{ x: e.clientX, y: e.clientY }];
      this.shell.hint('Disegna la linea d\'azione');
    } else if (hit.kind === 'ring' || hit.kind === 'ball') {
      const ctrl = this.ctx.sel().control;
      d.ctrl = ctrl;
      // a hand / foot in a contact: turned freely during the drag, pinned again where it ends
      if (ctrl.baseId === 'hand' || ctrl.baseId === 'foot') this.ctx.contacts?.handleBegin(ch, ctrl.baseId + '.' + ctrl.side, 'rotate');
      d.follow = this.ctx.follow.begin(ch, ctrl);
      d.k = hit.k;
      d.center = rig.worldPos(ch, ctrl.pivotIndex, new THREE.Vector3());
      d.snap = rig.snapshot(ch, ctrl);
      if (hit.kind === 'ring') {
        d.axis = rig.axisWorld(ch, ctrl, hit.k, new THREE.Vector3());
        d.value = rig.read(ch, ctrl, hit.k);
        const ray = this._ray(e.clientX, e.clientY);
        const toCam = _v2.copy(ray.origin).sub(d.center).normalize();
        d.facing = Math.abs(toCam.dot(d.axis)) > 0.28;
        _plane.setFromNormalAndCoplanarPoint(d.axis, d.center);
        const p = d.facing ? ray.intersectPlane(_plane, new THREE.Vector3()) : null;
        if (p) d.prevVec = p.sub(d.center);
        else {
          d.facing = false;
          // tangent of the ring at the grabbed point, in screen px per radian
          const ring = hit.ring;
          let bj = 0, bd = Infinity;
          for (let j = 0; j < N_RING; j++) { const dd = Math.hypot(ring.pts[j * 2] - e.clientX, ring.pts[j * 2 + 1] - e.clientY); if (dd < bd) { bd = dd; bj = j; } }
          const j2 = (bj + 1) % N_RING, j0 = (bj + N_RING - 1) % N_RING;
          const dt = (2 * Math.PI * 2) / N_RING;
          let tx = (ring.pts[j2 * 2] - ring.pts[j0 * 2]) / dt, ty = (ring.pts[j2 * 2 + 1] - ring.pts[j0 * 2 + 1]) / dt;
          // ring sampled with increasing angle about its own basis normal (ax x u): orientation vs axis
          const l2 = tx * tx + ty * ty;
          const minL = (RING_PX[ctrl.size] || 56) * 0.35;
          if (l2 < minL * minL) { const l = Math.sqrt(l2) || 1; tx = (tx / l) * minL; ty = (ty / l) * minL; }
          d.tan = [tx, ty];
        }
        this._hintAxis(ch, ctrl, hit.k);
      } else this.shell.hint('Rotazione libera');
    } else if (hit.kind === 'effector') {
      d.id = hit.id;
      // dragging the handle of a hand / foot in a contact lets go of the contact
      if (hit.id.startsWith('hand') || hit.id.startsWith('foot')) this.ctx.contacts?.handleBegin(ch, hit.id, 'move');
      const handle = ik.effectorPoint(ch, hit.id, new THREE.Vector3());
      d.handle = handle.clone();
      d.start = handle.clone();
      const cam = app.camera;
      cam.getWorldDirection(_n);
      d.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(_n.clone(), handle);
      const ray = this._ray(e.clientX, e.clientY);
      const grab = ray.intersectPlane(d.plane, new THREE.Vector3()) || handle.clone();
      d.grabOffset = handle.clone().sub(grab);
      if (hit.id === 'pelvis') {
        d.rootStart = ch.rootOffset.clone();
        d.pins = state.pinFeet ? ['L', 'R'].map((s) => ik.pin(ch, s)) : [];
        this.shell.hint(state.pinFeet ? 'Bacino · piedi fissi' : 'Bacino');
      } else if (hit.id === 'head') {
        d.snapNeck = rig.snapshot(ch, ik.neck); d.snapHead = rig.snapshot(ch, ik.head);
        this.shell.hint('Sguardo: trascina dove guardare');
      } else {
        const chain = ik.chains[hit.id];
        d.chain = chain;
        d.reach = ik.reachSnapshot(ch, chain);
        d.endQuat = rig.worldQuat(ch, chain.end, new THREE.Quaternion());
        d.endOffset = rig.worldPos(ch, chain.end, new THREE.Vector3()).sub(handle); // wrist/ankle - handle (constant: orientation kept)
        // other foot stays planted
        d.pins = state.pinFeet && chain.kind === 'leg' ? [ik.pin(ch, chain.side === 'L' ? 'R' : 'L')] : [];
        this.shell.hint(EFF_LABEL[hit.id]);
      }
    } else if (hit.kind === 'move' || hit.kind === 'turn') {
      const C = this._groundCenter(ch, new THREE.Vector3());
      d.groundY = C.y;
      d.C = C;
      d.startPos = ch.root.position.clone();
      d.startYaw = ch.root.rotation.y;
      // on a landscape the character follows its ground (same height above it); one standing
      // on the ground at the start lands on the ground where it is released (sidewalks too)
      d.rel = d.startPos.y - this.ctx.floorAt(d.startPos.x, d.startPos.z);
      d.onGround = Math.abs(d.startPos.y - this.ctx.groundAt(d.startPos.x, d.startPos.z)) < 0.03;
      _plane.set(_n.set(0, 1, 0), -d.groundY);
      const ray = this._ray(e.clientX, e.clientY);
      d.grab = ray.intersectPlane(_plane, new THREE.Vector3());
      d.screenTurn = Math.abs(ray.direction.y) < 0.15 || !d.grab;
      // over a landscape a moved character follows the ground under the finger
      const L = this.app.landscapes;
      d.lift = hit.kind === 'move' && d.grab && L?.hasTerrain && L.rayGround ? d.groundY - L.heightAt(d.grab.x, d.grab.z) : null;
      if (hit.kind === 'turn') {
        d.a0 = d.grab ? Math.atan2(d.grab.x - C.x, d.grab.z - C.z) : 0;
        // pelvis offset from the placement origin (world, horizontal), to turn about the ring center
        d.offW = C.clone().sub(ch.root.position); d.offW.y = 0;
        d.lastSnap = Math.round((d.startYaw * 180) / Math.PI / 15);
        this._hintYaw(d.startYaw);
      } else this.shell.hint('Sposta il personaggio');
    }
    this.drag = d;
    // a finger / pen resting on a ring (it never started turning): after the long-press time
    // the press goes to the long press of what is under it (carry a character, object menu)
    if ((hit.kind === 'ring' || hit.kind === 'ball') && e.pointerType !== 'mouse') { d.lastEv = e; d.holdT = setTimeout(() => this._holdThrough(d), HOLD_MS); }
    haptic(8);
    app.invalidate();
  }

  _holdThrough(d) {
    d.holdT = 0;
    const app = this.app, e = d.lastEv;
    const drift = Math.hypot(d.lastX - d.x0, d.lastY - d.y0);
    if (this.drag !== d || d.moved || drift > HOLD_SLOP || !e || !app.holdFrom) return;
    // only where a long press means something: a body or an object under the finger
    app.pointerToNDC(e, _ndc);
    if (!this.ctx.picker.pick(_ndc) && !app.props?.pick?.(_ndc)) return;
    app.controls.enabled = d.controlsWasEnabled;
    this.shell.hint('');
    if (!app.holdFrom(e, drift, { x: d.x0, y: d.y0, t: d.t0 })) { app.controls.enabled = false; return; }
    // the long press took it: the handle lets go, nothing changed
    this.drag = null;
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    if (d.follow) this.ctx.follow.end();
    this.ctx.contacts?.handleEnd(false);
    app.invalidate();
  }

  _update(d) {
    if (d.kind === 'stroke') return;
    const x = d.lastX, y = d.lastY;
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < d.slop) return;
    const ch = d.ch;
    if (!this.app.characters.includes(ch)) return;
    const { rig, ik } = this.ctx;
    d.moved = true;
    let limited = false;
    if (d.kind === 'ring') {
      let delta = 0;
      if (d.facing) {
        _plane.setFromNormalAndCoplanarPoint(d.axis, d.center);
        const p = this._ray(x, y).intersectPlane(_plane, _v3);
        if (!p) return;
        const v1 = p.sub(d.center);
        if (v1.lengthSq() < 1e-10) return;
        _w.crossVectors(d.prevVec, v1);
        delta = Math.atan2(_w.dot(d.axis), d.prevVec.dot(v1));
        d.prevVec.copy(v1);
      } else {
        const mx = x - d.px, my = y - d.py;
        const [tx, ty] = d.tan;
        delta = (mx * tx + my * ty) / (tx * tx + ty * ty);
        // ring sampled counter-clockwise about (u x n) = axis -> positive angle direction
      }
      d.px = x; d.py = y;
      d.value += delta;
      const r = rig.write(ch, d.ctrl, d.k, d.value);
      limited = r.clamped;
      if (limited) d.value = r.value; // no wind-up past the limit
      rig.refreshControl(ch, d.ctrl);
      if (d.follow) this.ctx.follow.update();
      this._hintAxis(ch, d.ctrl, d.k);
    } else if (d.kind === 'ball') {
      const mx = x - d.px, my = y - d.py;
      d.px = x; d.py = y;
      const cam = this.app.camera;
      const right = _u.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
      const up = _n.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
      _ax.copy(up).multiplyScalar(mx).addScaledVector(right, my);
      const len = _ax.length();
      if (len < 1e-6) return;
      _q.setFromAxisAngle(_ax.multiplyScalar(1 / len), len * 0.0105);
      if (d.ctrl.coupled) limited = rig.rotateControl(ch, d.ctrl, _q, d.snap);
      else {
        for (const i of d.ctrl.freeRoots) rig.rotateWorld(ch, i, _q);
        if (d.ctrl.baseId === 'hand') this.ctx.transferWristTwist(ch, d.ctrl);
        limited = rig.project(ch, d.ctrl, d.snap);
      }
      rig.refreshControl(ch, d.ctrl);
      if (d.follow) this.ctx.follow.update();
    } else if (d.kind === 'effector') {
      const p = this._ray(x, y).intersectPlane(d.plane, _v3);
      if (!p) return;
      d.handle.copy(p).add(d.grabOffset);
      if (d.id === 'pelvis') {
        // world delta -> rig-space delta of the root offset
        const m = _m.copy(ch.rig.matrixWorld).invert();
        const a = _v.copy(d.start).applyMatrix4(m);
        const delta = _v2.copy(d.handle).applyMatrix4(m).sub(a);
        const off = _w.copy(d.rootStart).add(delta);
        ik.movePelvis(ch, off, d.pins);
        limited = ik.limited;
      } else if (d.id === 'head') {
        limited = ik.aimHead(ch, d.handle, d.snapNeck, d.snapHead);
      } else {
        const target = _w.copy(d.handle).add(d.endOffset);
        // far targets: clavicle + back (hands) or pelvis (feet) help the limb reach
        limited = ik.reach(ch, d.chain, target, d.reach);
        limited = ik.solveLimb(ch, d.chain, target, d.endQuat, 3) || limited;
        for (const pin of d.pins) ik.solvePinned(ch, pin);
      }
    } else if (d.kind === 'move') {
      _plane.set(_n.set(0, 1, 0), -d.groundY);
      const ray = this._ray(x, y);
      let p = d.lift != null ? this.app.landscapes.rayGround(ray, d.lift, _v3, 200) : null;
      if (!p) {
        if (Math.abs(ray.direction.y) < 0.01) return;
        p = ray.intersectPlane(_plane, _v3);
        if (!p || !d.grab || p.distanceTo(ray.origin) > 80) return;
      }
      const nx = d.startPos.x + p.x - d.grab.x, nz = d.startPos.z + p.z - d.grab.z;
      // contacts on the floor travel with the character, those on props / people stay
      const place = () => { ch.root.position.set(nx, this.ctx.floorAt(nx, nz) + d.rel, nz); ch.root.updateMatrixWorld(true); };
      if (this.ctx.contacts) this.ctx.contacts.carry(ch, place); else place();
      this.ctx.placed(ch);
    } else if (d.kind === 'turn') {
      let yaw;
      if (d.screenTurn) yaw = d.startYaw + (x - d.x0) * 0.012;
      else {
        _plane.set(_n.set(0, 1, 0), -d.groundY);
        const p = this._ray(x, y).intersectPlane(_plane, _v3);
        if (!p) return;
        const a = Math.atan2(p.x - d.C.x, p.z - d.C.z);
        yaw = d.startYaw + wrapAngle(a - d.a0);
      }
      const snapK = Math.round((yaw * 180) / Math.PI / 15);
      if (snapK !== d.lastSnap) { d.lastSnap = snapK; haptic(6); }
      // turn about the ring center: position = C - R(yaw) * R(startYaw)^-1 * offW
      const dy = yaw - d.startYaw;
      const ox = d.offW.x * Math.cos(dy) + d.offW.z * Math.sin(dy), oz = -d.offW.x * Math.sin(dy) + d.offW.z * Math.cos(dy);
      const place = () => {
        ch.root.rotation.y = wrapAngle(yaw);
        ch.root.position.set(d.C.x - ox, this.ctx.floorAt(d.C.x - ox, d.C.z - oz) + d.rel, d.C.z - oz);
        ch.root.updateMatrixWorld(true);
      };
      if (this.ctx.contacts) this.ctx.contacts.carry(ch, place); else place();
      this._hintYaw(yaw);
      this.ctx.placed(ch);
    }
    if (limited && !d.atLimit) haptic('tick');
    d.atLimit = limited;
    if (d.kind !== 'move' && d.kind !== 'turn') this.ctx.edited(ch, false);
    this.app.invalidate();
  }

  _end(d) {
    if (d.follow) this.ctx.follow.end();
    this.ctx.contacts?.handleEnd(d.moved && !d.cancelled);
    if (!d.moved) return;
    if (d.kind === 'stroke') { if (!d.cancelled) this.ctx.applyStroke(d.ch, d.pts); return; }
    const labels = { ring: 'ruota parte', ball: 'ruota parte', effector: 'trascina', move: 'sposta personaggio', turn: 'ruota personaggio' };
    if (d.kind === 'move' && d.onGround && this.app.characters.includes(d.ch)) {
      const pos = d.ch.root.position, y = this.ctx.groundAt(pos.x, pos.z);
      if (Math.abs(y - pos.y) > 1e-4) this.ctx.contacts.carry(d.ch, () => { pos.y = y; d.ch.root.updateMatrixWorld(true); });
    }
    if (d.kind === 'move' || d.kind === 'turn') this.ctx.placed(d.ch, true, labels[d.kind]);
    else this.ctx.edited(d.ch, true, labels[d.kind]);
  }

  _hintAxis(ch, ctrl, k) {
    const { rig } = this.ctx;
    const v = Math.round(toDeg(rig.readDisplay(ch, ctrl, k)));
    this.shell.hint(`${ctrl.axes[k].label}: ${v}°`);
  }

  _hintYaw(yaw) {
    let deg = Math.round((wrapAngle(yaw) * 180) / Math.PI);
    if (deg === -180) deg = 180;
    this.shell.hint(`Rotazione: ${deg}°`);
  }
}

/** smooth path (quadratic B-spline through midpoints) of the first n points */
function smoothPath(g, P, n) {
  g.beginPath();
  if (n < 2) return;
  g.moveTo(P[0].x, P[0].y);
  if (n === 2) { g.lineTo(P[1].x, P[1].y); return; }
  for (let i = 1; i < n - 1; i++) {
    const mx = (P[i].x + P[i + 1].x) / 2, my = (P[i].y + P[i + 1].y) / 2;
    g.quadraticCurveTo(P[i].x, P[i].y, mx, my);
  }
  g.lineTo(P[n - 1].x, P[n - 1].y);
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
