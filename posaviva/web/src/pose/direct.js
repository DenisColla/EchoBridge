// "Tocco diretto": posing by touching the body itself (no handle needed).
//
//  - A press on a body part that starts moving poses it right away (the part gets
//    selected as with a tap): hand / foot = IK effector in the camera-facing plane through
//    the touched point (the body helps for far targets, the standing foot stays planted),
//    head = aim (neck + head), pelvis = move with planted feet; arm, forearm, shoulder,
//    thigh, shin, abdomen, chest, neck = anatomical rotation (flexion, abduction / side
//    bend within the limits: the touched point follows the finger, a small damped
//    least-squares on the two anatomical axes); a finger = curl of that finger. With the
//    hand (foot) in a contact, dragging the arm (leg) swings the elbow (knee) around the
//    shoulder-wrist line. One undo step per drag.
//  - The press is shared with the core router (tap, long press) and the camera: nothing
//    is taken until the finger moves past the tap tolerance; the camera never gets the
//    moves of a press that started on the body. Two fingers still zoom / pan; a press on
//    empty space, or on clothes / hair away from the body, orbits as before.
//  - A tap on a hand or a foot opens a small menu at the finger (hand shapes, "Tocca un
//    punto da raggiungere", contacts); it never blocks the view and closes at the next
//    touch on the scene.
//  - "Tocca un punto": the next tap on a surface sends the hand / foot there and pins it
//    (contacts.js).
import * as THREE from 'three';
import { haptic, stageMenu, h, toast } from '../ui/kit.js';
import { EFFECTOR_LABEL } from './contacts.js';
import { CURL } from './handsPanel.js';

/** px a press must travel before it poses (= the core tap / long-press tolerance) */
const SLOP = 10;
/** anatomical axes a drag drives (twist needs the rings) */
const DRAG_KEYS = new Set(['flex', 'abd', 'lat', 'elev', 'prot']);
const FK_PARTS = new Set(['arm', 'forearm', 'shoulder', 'thigh', 'shin', 'abdomen', 'chest', 'neck']);
const D = Math.PI / 180;
export const HAND_SHAPES = [
  { id: 'pugno', preset: 'fist', label: 'Pugno' },
  { id: 'aperta', preset: 'open', label: 'Aperta' },
  { id: 'afferra', preset: 'grip', label: 'Afferra' },
  { id: 'indica', preset: 'point', label: 'Indica' },
  { id: 'rilassata', preset: 'relaxed', label: 'Rilassata' },
];
const PART_HINT = { hand: 'Mano', foot: 'Piede', toes: 'Piede', head: 'Testa: trascina dove guardare', pelvis: 'Bacino' };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _ndc = new THREE.Vector2();
const _s = { x: 0, y: 0 }, _s2 = { x: 0, y: 0 };

export class DirectTouch {
  /** ctx: pose module context (+ contacts, api) */
  constructor(ctx) {
    this.ctx = ctx;
    this.app = ctx.app;
    this.shell = ctx.shell;
    this.press = null;
    this.drag = null;
    this.menu = null;
    this.armed = null;
    this._downIds = new Set();
    this._eat = null; // the pointerup that ended a drag: the router must not make it a tap
    this._installed = false;
    this._armDeco = (g, project) => this._drawArmed(g, project);
    const app = this.app;
    // the touch menu closes at the next touch on the scene (before anything else sees it)
    window.addEventListener('pointerdown', (e) => { if (this.menu && e.target === app.canvas) this.closeMenu(); }, true);
    const forget = (e) => this._downIds.delete(e.pointerId);
    window.addEventListener('pointerup', forget, true);
    window.addEventListener('pointercancel', forget, true);
    app.addEventListener('tool', () => { this.closeMenu(); if (this.armed && !ctx.isActive()) this.disarm(); });
    app.addEventListener('selection', (e) => { if (this.armed && e.character !== this.armed.ch) this.disarm(); });
    app.addEventListener('characters', () => { if (this.armed && !app.characters.includes(this.armed.ch)) this.disarm(); });
    app.addEventListener('loaded', () => { this.closeMenu(); this.disarm(); });
    // Vista pulita: the touch menu closes (kit.stageMenu) and a pending "Tocca un punto" ends
    app.addEventListener('cleanview', (e) => { if (e.on) { this.closeMenu(); this.disarm(); } });
  }

  /**
   * Canvas listeners in the capture phase, registered after every module (on 'ready'):
   * handles of the pose gizmo, props, animals and lights keep their priority.
   */
  install() {
    if (this._installed) return;
    this._installed = true;
    const c = this.app.canvas;
    c.addEventListener('pointerdown', (e) => this._onDown(e), { capture: true });
    c.addEventListener('pointermove', (e) => this._onMove(e), { capture: true });
    c.addEventListener('pointerup', (e) => this._onUp(e), { capture: true });
    c.addEventListener('pointercancel', (e) => this._onUp(e), { capture: true });
    // the moves of a press on the body reach the canvas listeners (the core router cancels
    // its long press with them) but stop before the document, where the camera listens
    const host = c.parentElement || document.body;
    host.addEventListener('pointermove', (e) => {
      if ((this.press && e.pointerId === this.press.id) || (this.drag && e.pointerId === this.drag.id)) e.stopPropagation();
    });
  }

  get enabled() { return this.ctx.state.direct !== false; }

  /** true while a direct drag owns the pointer */
  get active() { return !!this.drag; }

  /** the core router routes the pointerup of a drag that came back near its start: eat it */
  eatsTap(e) { return !!e && e === this._eat; }

  /** a long press took the pending press (A4): forget it */
  cancelPress() { this.press = null; }

  /**
   * The palm is mostly metacarpal bones (finger controls 'f{n}0'): outside the Mani tool a
   * touch there means the hand (drag = IK, tap = hand menu), not the finger.
   */
  palmAsHand(ctrl) {
    if (!ctrl || ctrl.region !== 'finger' || ctrl.phalanx !== 0 || !this.enabled || this.shell.activeToolId === 'hands') return ctrl;
    return this.ctx.controls.get('hand.' + ctrl.side) || ctrl;
  }

  _allowed(e) {
    const ctx = this.ctx;
    if (!this.enabled || !ctx.isActive() || this.armed || this.app.holdActive) return false;
    if (e.button > 0 || (e.pointerType === 'pen' && ((e.buttons & 2) || this.app.penBarrel))) return false;
    const mode = ctx.mode();
    if (mode === 'move') return false; // Sposta: the gizmo drags the character
    if (mode === 'line' && this.shell.activeToolId === 'pose') return false; // the stroke tool
    return true;
  }

  /** body part under a pointer event (picking ignores clothes and hair), or null */
  pickBody(e, { occlusion = true } = {}) {
    this.app.pointerToNDC(e, _ndc);
    const hit = this.ctx.picker.pick(_ndc);
    if (!hit || !hit.control) return null;
    if (this.shell.activeToolId === 'hands' && hit.control.region !== 'hand' && hit.control.region !== 'finger') return null;
    if (occlusion) {
      // an object in front of the body keeps the press (its own tap / long press)
      const pp = this.app.props?.pick?.(_ndc, { occlusion: false });
      if (pp && pp.distance < hit.distance - 0.01) return null;
    }
    return hit;
  }

  /**
   * The gizmo's trackball sits on the joint of the selected part: on a hand, a foot or the
   * head, a press there drags the part directly (IK) instead of turning it freely.
   */
  wantsBall(e, ch) {
    if (!this._allowed(e)) return false;
    const ctrl = this.ctx.sel().control;
    if (!ctrl || !['hand', 'foot', 'head'].includes(ctrl.baseId)) return false;
    const hit = this.pickBody(e, { occlusion: false });
    return !!hit && hit.character === ch && this.palmAsHand(hit.control) === ctrl;
  }

  // ------------------------------------------------------------ input
  _onDown(e) {
    const busy = this._downIds.size > 0;
    this._downIds.add(e.pointerId);
    if (this.drag) { if (e.pointerId !== this.drag.id) e.stopImmediatePropagation(); return; }
    // a second finger before the drag started: pinch / pan, the camera takes the gesture
    if (this.press) { this.press = null; return; }
    if (busy || !this._allowed(e)) return;
    const hit = this.pickBody(e);
    if (!hit) return;
    // nothing is stopped here: the core router (tap, long press) and the camera see the
    // press; only its moves are kept from the camera (see _onMove)
    this.press = { id: e.pointerId, x0: e.clientX, y0: e.clientY, hit, type: e.pointerType };
  }

  _onMove(e) {
    const p = this.press;
    if (p && e.pointerId === p.id) {
      if (this.app.holdActive) { this.press = null; return; } // a long press owns it now
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > SLOP) {
        this.press = null;
        try { this._begin(p, e); } catch (err) { console.error('[pose] direct drag', err); this._abort(); }
      }
      return;
    }
    const d = this.drag;
    if (d && e.pointerId === d.id) {
      d.x = e.clientX; d.y = e.clientY;
      if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; if (this.drag === d) this._safeUpdate(d); });
    }
  }

  _onUp(e) {
    if (this.press && e.pointerId === this.press.id) { this.press = null; return; } // tap or long press: the router decides
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    // a move still waiting for its frame (slow frames: every move of a quick drag) is applied now
    const pending = !!d.raf;
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    const cancelled = e.type === 'pointercancel';
    if (!cancelled && (pending || e.clientX !== d.x || e.clientY !== d.y)) { d.x = e.clientX; d.y = e.clientY; this._safeUpdate(d); }
    this.drag = null;
    this._eat = e;
    this._end(d, cancelled);
  }

  _abort() {
    const d = this.drag;
    this.drag = null;
    if (d) this._end(d, true);
  }

  // ------------------------------------------------------------ drag
  _begin(p, e) {
    const { app, ctx } = this;
    const { rig, ik, state, contacts } = ctx;
    const hit = p.hit, ch = hit.character;
    if (!app.characters.includes(ch)) return;
    // the hips (lowest lumbar bone, pelvis bones) move the whole pelvis: crouch, sit, lean
    const hips = ch.bones[hit.bone]?.name === 'spine05' || hit.control.baseId === 'pelvis';
    const ctrl = hips ? ctx.controls.get('pelvis') : this.palmAsHand(hit.control);
    // selection exactly as a tap would make it
    const mode = ctx.mode();
    const part = mode === 'rotate' ? ctrl.id : null;
    if (app.selection.character !== ch || app.selection.part !== part) app.select(ch, part);
    this.closeMenu();
    const d = {
      id: p.id, ch, ctrl, hit, x0: p.x0, y0: p.y0, x: e.clientX, y: e.clientY, raf: 0, atLimit: false,
      ctl: app.controls.enabled, kind: null, label: 'tocco diretto',
      undo: { q: ch.poseQuat.map((q) => q.clone()), root: ch.rootOffset.clone(), pins: JSON.stringify(ch.data?.pose?.pins || null) },
    };
    app.controls.enabled = false;
    this.drag = d; // from here an error ends the drag cleanly (_abort: controls and pose restored)
    const base = ctrl.baseId, side = ctrl.side;
    const eff = base === 'hand' ? 'hand.' + side : base === 'foot' || base === 'toes' ? 'foot.' + side : null;
    // camera-facing drag plane through the touched point (IK kinds)
    app.camera.getWorldDirection(_n);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(_n.clone(), hit.point);
    if (eff) {
      d.kind = 'eff'; d.eff = eff; d.plane = plane; d.grab = hit.point.clone();
      contacts.handleBegin(ch, eff, 'move');
      const chain = d.chain = ik.chains[eff];
      d.reach = ik.reachSnapshot(ch, chain);
      d.endQuat = rig.worldQuat(ch, chain.end, new THREE.Quaternion());
      d.end0 = rig.worldPos(ch, chain.end, new THREE.Vector3());
      const other = side === 'L' ? 'R' : 'L';
      d.pins = state.pinFeet && chain.kind === 'leg' && !contacts.has(ch, 'foot.' + other) ? [ik.pin(ch, other)] : [];
      this.shell.hint(EFFECTOR_LABEL[eff]);
    } else if (base === 'head') {
      d.kind = 'head'; d.plane = plane; d.grab = hit.point.clone();
      d.aim0 = ik.aimPoint(ch, 0.32, new THREE.Vector3());
      d.snapNeck = rig.snapshot(ch, ik.neck); d.snapHead = rig.snapshot(ch, ik.head);
      this.shell.hint(PART_HINT.head);
    } else if (base === 'pelvis') {
      d.kind = 'pelvis'; d.plane = plane; d.grab = hit.point.clone();
      d.rootStart = ch.rootOffset.clone();
      d.pins = state.pinFeet ? ['L', 'R'].filter((s) => !contacts.has(ch, 'foot.' + s)).map((s) => ik.pin(ch, s)) : [];
      this.shell.hint(state.pinFeet ? 'Bacino · piedi fissi' : 'Bacino');
    } else if (ctrl.region === 'finger') {
      this._setupCurl(d, ch, ctrl);
    } else if (FK_PARTS.has(base)) {
      const limb = ['arm', 'forearm'].includes(base) ? 'hand.' + side : ['thigh', 'shin'].includes(base) ? 'foot.' + side : null;
      if (limb && contacts.has(ch, limb) && contacts.keep) this._setupSwivel(d, ch, ctrl, ik.chains[limb]);
      else this._setupFK(d, ch, ctrl);
    } else {
      this.drag = null;
      app.controls.enabled = d.ctl;
      return;
    }
    haptic(8);
    this._safeUpdate(d);
  }

  /** handle point (world) of a Jacobian drag */
  _handleWorld(d, out) { return out.copy(d.hl).applyMatrix4(d.ch.bones[d.hb].matrixWorld); }

  _project(p, out) {
    _v2.copy(p).project(this.app.camera);
    if (_v2.z > 1 || _v2.z < -1) return null;
    const r = this.app.canvas.getBoundingClientRect();
    out.x = r.left + (_v2.x + 1) * 0.5 * r.width;
    out.y = r.top + (1 - _v2.y) * 0.5 * r.height;
    return out;
  }

  /** grabbed point as the handle; too close to the pivot (no lever): the end of the part */
  _handleFor(d, ch, ctrl) {
    const { rig } = this.ctx;
    const piv = rig.worldPos(ch, ctrl.pivotIndex, new THREE.Vector3());
    const lastName = ctrl.own[ctrl.own.length - 1];
    const li = rig.model.boneIndex.get(lastName);
    const end = rig.pointOnBone(ch, li, 1, new THREE.Vector3());
    const len = piv.distanceTo(end);
    if (d.hit.point.distanceTo(piv) >= 0.35 * len) {
      d.hb = d.hit.bone;
      _m.copy(ch.bones[d.hb].matrixWorld).invert();
      d.hl = d.hit.point.clone().applyMatrix4(_m);
    } else {
      d.hb = li;
      _m.copy(ch.bones[li].matrixWorld).invert();
      d.hl = end.applyMatrix4(_m);
    }
    d.h0 = { ...this._project(this._handleWorld(d, _v), { x: 0, y: 0 }) };
    if (d.h0.x == null) d.h0 = { x: d.x0, y: d.y0 };
  }

  _setupFK(d, ch, ctrl) {
    const { rig, state } = this.ctx;
    d.kind = 'fk';
    d.dofs = [];
    ctrl.axes.forEach((a, k) => {
      if (!DRAG_KEYS.has(a.key) || (a.extra && state.limits)) return;
      d.dofs.push({
        get: () => rig.read(ch, ctrl, k),
        set: (v, clamp) => { const r = rig.write(ch, ctrl, k, v, clamp); rig.refreshControl(ch, ctrl); return clamp && r.clamped; },
      });
    });
    d.follow = this.ctx.follow.begin(ch, ctrl);
    this._handleFor(d, ch, ctrl);
    this.shell.hint(ctrl.label);
  }

  /** finger curl: the three phalanges together (same profile as the Mani panel) */
  _setupCurl(d, ch, ctrl) {
    const { rig, controls } = this.ctx;
    const n = ctrl.finger, s = ctrl.side;
    const segs = [1, 2, 3].map((j) => controls.get(`f${n}${j}.${s}`));
    const flexK = segs.map((c) => c.axes.findIndex((a) => a.key === 'flex'));
    const w = CURL[n];
    const den = w.reduce((t, x) => t + x * x, 0);
    const base = ch.bones[segs[0].pivotIndex];
    d.kind = 'curl';
    d.dofs = [{
      get: () => segs.reduce((t, c, j) => t + (rig.read(ch, c, flexK[j]) / D) * w[j], 0) / den,
      set: (v, clamp) => {
        let hit = false;
        segs.forEach((c, j) => { hit = rig.write(ch, c, flexK[j], w[j] * D * v, clamp).clamped || hit; });
        for (const c of segs) { const b = ch.bones[c.pivotIndex]; b.quaternion.copy(ch.restLocalQuat[c.pivotIndex]).multiply(ch.poseQuat[c.pivotIndex]); }
        base.updateMatrixWorld(true);
        return clamp && hit;
      },
    }];
    // lever: the fingertip
    const tip = segs[2].pivotIndex;
    d.hb = tip;
    d.hl = rig.pointOnBone(ch, tip, 1, new THREE.Vector3()).applyMatrix4(_m.copy(ch.bones[tip].matrixWorld).invert());
    d.h0 = { ...this._project(this._handleWorld(d, _v), { x: 0, y: 0 }) };
    if (d.h0.x == null) d.h0 = { x: d.x0, y: d.y0 };
    this.shell.hint(`${ctrl.label.split(' · ')[0]}: piega il dito`);
  }

  /** a limb whose hand / foot is in a contact: the drag swings the elbow / knee */
  _setupSwivel(d, ch, ctrl, chain) {
    const { rig } = this.ctx;
    d.kind = 'swivel';
    const snapU = rig.snapshot(ch, chain.cUpper);
    let cur = 0;
    d.dofs = [{
      get: () => cur,
      set: (v, clamp) => {
        const S = rig.worldPos(ch, chain.upper, new THREE.Vector3());
        const W = rig.worldPos(ch, chain.end, new THREE.Vector3());
        const axis = W.sub(S).normalize();
        rig.rotateWorld(ch, chain.upper, _q.setFromAxisAngle(axis, v - cur));
        cur = v;
        const hit = rig.project(ch, chain.cUpper, snapU);
        rig.refreshControl(ch, chain.cUpper);
        return clamp && hit;
      },
    }];
    this._handleFor(d, ch, ctrl);
    this.shell.hint(chain.kind === 'arm' ? 'Gomito (la mano resta appoggiata)' : 'Ginocchio (il piede resta appoggiato)');
  }

  _safeUpdate(d) {
    try { this._update(d); } catch (err) { console.error('[pose] direct drag', err); }
  }

  _update(d) {
    const { app, ctx } = this;
    const { rig, ik } = ctx;
    const ch = d.ch;
    if (!app.characters.includes(ch)) return;
    let limited = false;
    if (d.plane) {
      app.pointerToNDC({ clientX: d.x, clientY: d.y }, _ndc);
      const rc = ctx.picker.raycaster;
      app.camera.updateMatrixWorld();
      rc.setFromCamera(_ndc, app.camera);
      const p = rc.ray.intersectPlane(d.plane, _v);
      if (!p) return;
      const delta = p.sub(d.grab);
      if (d.kind === 'eff') {
        const target = _v2.copy(d.end0).add(delta);
        limited = ik.reach(ch, d.chain, target, d.reach);
        limited = ik.solveLimb(ch, d.chain, target, d.endQuat, 3) || limited;
        for (const pin of d.pins) ik.solvePinned(ch, pin);
      } else if (d.kind === 'head') {
        limited = ik.aimHead(ch, _v2.copy(d.aim0).add(delta), d.snapNeck, d.snapHead);
      } else if (d.kind === 'pelvis') {
        const m = _m.copy(ch.rig.matrixWorld).invert();
        const a = _v2.copy(d.grab).applyMatrix4(m);
        const b = _n.copy(d.grab).add(delta).applyMatrix4(m);
        ik.movePelvis(ch, b.sub(a).add(d.rootStart), d.pins);
        limited = ik.limited;
      }
    } else {
      limited = this._follow(d);
      if (d.follow) ctx.follow.update();
    }
    if (limited && !d.atLimit) haptic('tick');
    d.atLimit = limited;
    ctx.edited(ch, false);
    app.invalidate();
  }

  /**
   * The handle follows the finger: damped least squares on the drag's degrees of freedom
   * (screen-space Jacobian by finite differences), limits clamp the result.
   */
  _follow(d) {
    const tx = d.h0.x + (d.x - d.x0), ty = d.h0.y + (d.y - d.y0);
    const n = d.dofs.length;
    if (!n) return false;
    const J = d.J || (d.J = new Float64Array(n * 2)), v0 = d.v0 || (d.v0 = new Float64Array(n));
    const H = 0.02;
    let limited = false;
    for (let it = 0; it < 3; it++) {
      const cur = this._project(this._handleWorld(d, _v), _s);
      if (!cur) break;
      const ex = tx - cur.x, ey = ty - cur.y;
      if (ex * ex + ey * ey < 0.25) break;
      for (let k = 0; k < n; k++) {
        const dof = d.dofs[k];
        v0[k] = dof.get();
        dof.set(v0[k] + H, false);
        const p = this._project(this._handleWorld(d, _v), _s2) || cur;
        J[k * 2] = (p.x - cur.x) / H; J[k * 2 + 1] = (p.y - cur.y) / H;
        dof.set(v0[k], false);
      }
      // (JtJ + lambda I) dx = Jt e
      let a = 0, b = 0, c = 0, g0 = 0, g1 = 0;
      for (let k = 0; k < n; k++) {
        const jx = J[k * 2], jy = J[k * 2 + 1];
        if (k === 0) { a = jx * jx + jy * jy; g0 = jx * ex + jy * ey; } else { c = jx * jx + jy * jy; g1 = jx * ex + jy * ey; b = J[0] * jx + J[1] * jy; }
      }
      const lam = 0.05 * (a + c) + 40;
      let d0, d1 = 0;
      if (n === 1) d0 = g0 / (a + lam);
      else {
        const A = a + lam, C = c + lam, det = A * C - b * b;
        if (Math.abs(det) < 1e-9) break;
        d0 = (C * g0 - b * g1) / det; d1 = (A * g1 - b * g0) / det;
      }
      const step = [d0, d1];
      for (let k = 0; k < n; k++) {
        const s = Math.max(-0.3, Math.min(0.3, step[k]));
        limited = d.dofs[k].set(v0[k] + s, true) || limited;
      }
    }
    return limited;
  }

  _end(d, cancelled) {
    const { app, ctx } = this;
    app.controls.enabled = d.ctl;
    if (d.follow) ctx.follow.end();
    this.shell.hint('');
    const ch = d.ch;
    ctx.contacts.handleEnd(!cancelled);
    if (!app.characters.includes(ch)) return;
    if (cancelled) {
      // palm rejection / system gesture: the pose before the drag comes back, no undo step
      d.undo.q.forEach((q, i) => ch.poseQuat[i].copy(q));
      ch.rootOffset.copy(d.undo.root);
      const pins = JSON.parse(d.undo.pins);
      const pd = ch.data.pose || (ch.data.pose = {});
      if (pins) pd.pins = pins; else { delete pd.pins; if (!Object.keys(pd).length) delete ch.data.pose; }
      ch.applyPose();
      return;
    }
    ctx.edited(ch, true, d.label);
  }

  // ------------------------------------------------------------ touch menu (hand / foot)
  /** after a tap selected a part: a hand or a foot opens its menu at the finger */
  maybeMenu(hit, x, y) {
    if (!this.enabled || !hit?.control || this.armed) return false;
    const c = this.palmAsHand(hit.control);
    const eff = c.baseId === 'hand' ? 'hand.' + c.side : c.baseId === 'foot' || c.baseId === 'toes' ? 'foot.' + c.side : null;
    if (!eff) return false;
    this.openMenu(hit.character, eff, x, y);
    return true;
  }

  closeMenu() {
    const m = this.menu;
    this.menu = null;
    if (m) m.close(null);
  }

  openMenu(ch, eff, x, y) {
    const { ctx } = this;
    const api = ctx.api;
    this.closeMenu();
    const pinned = ctx.contacts.has(ch, eff);
    const side = eff.slice(-1), isHand = eff.startsWith('hand');
    const items = [];
    let body = null;
    if (isHand) {
      const chips = HAND_SHAPES.map((s) => {
        const b = h('button', { type: 'button', class: 'pv-chip pv-pose-tm-chip' }, s.label);
        b.addEventListener('click', () => {
          haptic('tick');
          api.handShape(ch, side, s.id);
          for (const o of chips) o.classList.toggle('active', o === b);
        });
        return b;
      });
      body = h('div', { class: 'pv-pose-tm-shapes' }, ...chips);
      items.push({ id: 'reach', label: 'Tocca un punto da raggiungere', icon: 'tap', hint: 'Un oggetto, il pavimento, un personaggio', onClick: () => this.arm(ch, eff) });
      if (pinned) items.push({ id: 'free', label: 'Libera contatto', icon: 'unlock', onClick: () => { api.unpin(ch, eff); toast(`${EFFECTOR_LABEL[eff]} libera`, { ms: 1400 }); } });
      else items.push({ id: 'pin', label: 'Fissa a superficie', icon: 'lock', hint: 'Resta qui quando muovi il corpo', onClick: () => this.pinHere(ch, eff) });
    } else {
      items.push({ id: 'floor', label: 'Appoggia a terra', icon: 'ground', onClick: () => this.footDown(ch, eff) });
      items.push({ id: 'reach', label: 'Tocca un punto', icon: 'tap', hint: 'Un gradino, una sedia, un oggetto', onClick: () => this.arm(ch, eff) });
      if (pinned) items.push({ id: 'free', label: 'Libera', icon: 'unlock', onClick: () => { api.unpin(ch, eff); toast(`${EFFECTOR_LABEL[eff]} libero`, { ms: 1400 }); } });
    }
    const m = stageMenu(items, {
      x, y, title: EFFECTOR_LABEL[eff], subtitle: pinned ? 'Contatto fissato · ' + ch.name : ch.name, body, width: 276,
      onClose: () => { if (this.menu === m) this.menu = null; },
    });
    // never in the way: no dimming, touches outside go to the scene (and close it)
    m.el.classList.add('pv-pose-touchmenu');
    this.menu = m;
    return m;
  }

  pinHere(ch, eff) {
    if (!this.app.characters.includes(ch)) return false;
    this.ctx.contacts.pinHere(ch, eff);
    this.ctx.edited(ch, true, 'fissa contatto', { keepPreset: true });
    haptic('success');
    toast(`${EFFECTOR_LABEL[eff]} fissata: resta qui quando muovi il corpo`, { kind: 'ok', ms: 1800 });
    return true;
  }

  /** "Appoggia a terra" (foot): flat on the surface under it (floor, terrain, a step), pinned */
  footDown(ch, eff) {
    const { ctx, app } = this;
    if (!app.characters.includes(ch)) return false;
    const chain = ctx.ik.chains[eff];
    ctx.rig.refreshAll(ch);
    const A = ctx.rig.worldPos(ch, chain.end, new THREE.Vector3());
    const ray = new THREE.Ray(A.clone().add(new THREE.Vector3(0, 0.25 * ch.root.scale.y, 0)), new THREE.Vector3(0, -1, 0));
    const hit = ctx.contacts.hitSurface(ray, { self: ch, eff, far: 4 });
    const P = hit ? hit.point : new THREE.Vector3(A.x, ctx.groundAt(A.x, A.z), A.z);
    const N = hit && hit.normal.y > 0.5 ? hit.normal : new THREE.Vector3(0, 1, 0);
    // the sole goes under the ankle (not under the touched point)
    const r = ctx.api.pinTo(ch, eff, P, N, { target: hit ? hit.owner : null, label: 'appoggia il piede' });
    haptic(r ? 'success' : 'warning');
    if (!r) toast('Il piede non arriva fin lì', { kind: 'info', ms: 1800 });
    return r;
  }

  // ------------------------------------------------------------ "Tocca un punto"
  /** the next tap on a surface sends the effector there (contact) */
  arm(ch, eff) {
    const { app } = this;
    this.disarm();
    this.closeMenu();
    const off = app.addTapHandler((t) => this._armTap(t), 100);
    const popBack = app.pushBackHandler(() => { if (!this.armed) return false; this.disarm(); this.shell.hint('Annullato', 1000); return true; });
    this.armed = { ch, eff, off, popBack };
    this.ctx.contacts.decorators.add(this._armDeco);
    this.shell.hint(`${EFFECTOR_LABEL[eff]}: tocca il punto da raggiungere`);
    haptic('tick');
    app.invalidate();
  }

  disarm() {
    const a = this.armed;
    if (!a) return;
    this.armed = null;
    a.off(); a.popBack();
    this.ctx.contacts.decorators.delete(this._armDeco);
    this.shell.hint('');
    this.app.invalidate();
  }

  _armTap({ ndc }) {
    const a = this.armed;
    if (!a) return false;
    const { app, ctx } = this;
    if (!app.characters.includes(a.ch)) { this.disarm(); return false; }
    app.camera.updateMatrixWorld();
    const rc = ctx.picker.raycaster;
    rc.setFromCamera(ndc, app.camera);
    const hit = ctx.contacts.hitSurface(rc.ray.clone(), { self: a.ch, eff: a.eff });
    if (!hit) {
      haptic('warning');
      this.shell.hint('Qui non c\'è nulla da toccare: scegli un oggetto, il pavimento o un personaggio', 2200);
      setTimeout(() => { if (this.armed === a) this.shell.hint(`${EFFECTOR_LABEL[a.eff]}: tocca il punto da raggiungere`); }, 2300);
      return true;
    }
    this.disarm();
    const ok = ctx.api.pinTo(a.ch, a.eff, hit.point, hit.normal, { target: hit.owner });
    haptic(ok ? 'success' : 'warning');
    if (!ok) toast('Troppo lontano: avvicina il personaggio, il contatto resta', { kind: 'info', ms: 2200 });
    return true;
  }

  _drawArmed(g, project) {
    const a = this.armed;
    if (!a || !a.ch.root.visible) return;
    const p = this.ctx.ik.effectorPoint(a.ch, a.eff, _v);
    const o = project(p, { x: 0, y: 0 });
    if (!o) return;
    g.save();
    g.beginPath(); g.arc(o.x, o.y, 24, 0, Math.PI * 2);
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.4)'; g.stroke();
    g.setLineDash([5, 5]); g.lineWidth = 3; g.strokeStyle = '#b69bff'; g.stroke();
    g.setLineDash([]);
    g.beginPath(); g.arc(o.x, o.y, 5, 0, Math.PI * 2); g.fillStyle = '#b69bff'; g.fill();
    g.restore();
  }
}
