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
/** a hand smaller than this on screen (wrist -> middle fingertip, px) is grabbed whole: its fingers are too small to curl one */
const HAND_PX = 110;
/** a second finger this soon (ms from the first touch) or this close (px of travel) to a drag's start: it was a pinch */
const PINCH_MS = 300, PINCH_PX = 40;
/** "Tocca un punto": a contact this close (m, scaled) counts as reached */
const REACH_OK = 0.05;
/** anatomical axes a drag drives (twist needs the rings) */
const DRAG_KEYS = new Set(['flex', 'abd', 'lat', 'elev', 'prot']);
const FK_PARTS = new Set(['arm', 'forearm', 'shoulder', 'thigh', 'shin', 'abdomen', 'chest', 'neck']);
/** parts dragged by their far end (the touched skin of the back barely moves when it bends) */
const SPINE_LEVER = new Set(['abdomen', 'chest', 'neck']);
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
const _h1 = new THREE.Vector3(), _h2 = new THREE.Vector3(), _hp = { x: 0, y: 0 }, _hq = { x: 0, y: 0 };

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

  /**
   * "Ruota la vista" (close-ups): direct touch and the pose rings pause, a drag on the body
   * orbits the camera. Not saved; the close-up ends it.
   */
  get suspended() { return !!this._suspended; }
  setSuspended(on) {
    on = !!on;
    if (on === this.suspended) return;
    this._suspended = on;
    if (on) { this.press = null; this.closeMenu(); }
    this.app.dispatchEvent({ type: 'directtouch', suspended: on });
    this.app.invalidate();
  }

  /** true while a direct drag owns the pointer */
  get active() { return !!this.drag; }

  /** the core router routes the pointerup of a drag that came back near its start: eat it */
  eatsTap(e) { return !!e && e === this._eat; }

  /** a long press took the pending press (A4): forget it */
  cancelPress() { this.press = null; }

  /**
   * The palm is mostly metacarpal bones (finger controls 'f{n}0'): outside the Mani tool a
   * touch there means the hand (drag = IK, tap = hand menu), not the finger. The fingers too
   * while the hand is small on screen (full-body framing: one finger is a few px wide and its
   * curl would not even show): only the Mani tool or a close-up curls a single finger.
   * `ch` (the touched character) enables the size test.
   */
  palmAsHand(ctrl, ch = null) {
    if (!ctrl || ctrl.region !== 'finger' || !this.enabled || this.shell.activeToolId === 'hands') return ctrl;
    if (ctrl.phalanx !== 0 && (!ch || this.handSpan(ch, ctrl.side) >= HAND_PX)) return ctrl;
    return this.ctx.controls.get('hand.' + ctrl.side) || ctrl;
  }

  /** on-screen length of a hand (wrist -> tip of the middle finger), CSS px */
  handSpan(ch, side) {
    const { rig } = this.ctx;
    const bi = rig.model.boneIndex;
    const a = this._project(rig.worldPos(ch, bi.get('wrist.' + side), _h1), _hp);
    if (!a) return 0;
    const ax = a.x, ay = a.y;
    const b = this._project(rig.pointOnBone(ch, bi.get('finger3-3.' + side), 1, _h2), _hq);
    return b ? Math.hypot(b.x - ax, b.y - ay) : 0;
  }

  /** the press would pose the body (Tocco diretto on, a body part under it): the pose rings let it through */
  bodyUnder(e) { return !!this.bodyControl(e); }

  /** the control a press would drag (hips = pelvis, a small hand whole), or null */
  bodyControl(e) {
    if (!this._allowed(e)) return null;
    const hit = this.pickBody(e);
    if (!hit) return null;
    if (hit.character !== this.app.selection.character) return hit.control; // another character: never the selected part
    if (hit.character.bones[hit.bone]?.name === 'spine05' || hit.control.baseId === 'pelvis') return this.ctx.controls.get('pelvis');
    return this.palmAsHand(hit.control, hit.character);
  }

  _allowed(e) {
    const ctx = this.ctx;
    if (!this.enabled || this._suspended || !ctx.isActive() || this.armed || this.app.holdActive) return false;
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
    return !!hit && hit.character === ch && this.palmAsHand(hit.control, ch) === ctrl;
  }

  // ------------------------------------------------------------ input
  _onDown(e) {
    const busy = this._downIds.size > 0;
    this._downIds.add(e.pointerId);
    const d = this.drag;
    if (d) {
      if (e.pointerId === d.id) return;
      // a pinch whose first finger slid past the tap tolerance before the second one landed
      // (they land 30-80 ms apart): the drag is undone and the camera takes the gesture
      if (e.timeStamp - d.t0 < PINCH_MS || Math.hypot(d.x - d.x0, d.y - d.y0) < PINCH_PX) { this._yield(d); return; }
      e.stopImmediatePropagation();
      return;
    }
    // a second finger before the drag started: pinch / pan, the camera takes the gesture
    if (this.press) { this.press = null; return; }
    if (busy || !this._allowed(e)) return;
    const hit = this.pickBody(e);
    if (!hit) return;
    // nothing is stopped here: the core router (tap, long press) and the camera see the
    // press; only its moves are kept from the camera (see _onMove)
    this.press = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, hit, type: e.pointerType };
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

  /** gives a just-started drag back (pinch): pose, contacts and selection as before, no undo step */
  _yield(d) {
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    this.drag = null;
    this._end(d, true);
    const s0 = d.sel0;
    if (s0 && this.app.characters.includes(s0.character) && (this.app.selection.character !== s0.character || this.app.selection.part !== s0.part)) this.app.select(s0.character, s0.part);
  }

  /** pose, root offset and contacts of a character (restorePose puts them back, no event besides 'pose') */
  snapPose(ch) { return { q: ch.poseQuat.map((q) => q.clone()), root: ch.rootOffset.clone(), pins: JSON.stringify(ch.data?.pose?.pins || null) }; }

  restorePose(ch, u) {
    u.q.forEach((q, i) => ch.poseQuat[i].copy(q));
    ch.rootOffset.copy(u.root);
    const pins = JSON.parse(u.pins);
    const pd = ch.data.pose || (ch.data.pose = {});
    if (pins) pd.pins = pins; else { delete pd.pins; if (!Object.keys(pd).length) delete ch.data.pose; }
    ch.applyPose();
  }

  // ------------------------------------------------------------ drag
  _begin(p, e) {
    const { app, ctx } = this;
    const { rig, ik, state, contacts } = ctx;
    const hit = p.hit, ch = hit.character;
    if (!app.characters.includes(ch)) return;
    // the hips (lowest lumbar bone, pelvis bones) move the whole pelvis: crouch, sit, lean
    const hips = ch.bones[hit.bone]?.name === 'spine05' || hit.control.baseId === 'pelvis';
    const ctrl = hips ? ctx.controls.get('pelvis') : this.palmAsHand(hit.control, ch);
    // selection exactly as a tap would make it
    const mode = ctx.mode();
    const part = mode === 'rotate' ? ctrl.id : null;
    const sel0 = { character: app.selection.character, part: app.selection.part };
    if (app.selection.character !== ch || app.selection.part !== part) app.select(ch, part);
    // selected by a drag: its rings stay quiet (fainter, never in the way of the next drag)
    if (part) ctx.gizmo?.setQuiet(ch, part);
    this.closeMenu();
    const d = {
      id: p.id, ch, ctrl, hit, x0: p.x0, y0: p.y0, x: e.clientX, y: e.clientY, raf: 0, atLimit: false,
      t0: p.t0 ?? e.timeStamp, sel0,
      ctl: app.controls.enabled, kind: null, label: 'tocco diretto',
      undo: this.snapPose(ch),
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

  /**
   * grabbed point as the handle; too close to the pivot (no lever) or `lever` (back and neck:
   * the touched skin barely moves when they bend): the end of the part
   */
  _handleFor(d, ch, ctrl, lever = false) {
    const { rig } = this.ctx;
    const piv = rig.worldPos(ch, ctrl.pivotIndex, new THREE.Vector3());
    const lastName = ctrl.own[ctrl.own.length - 1];
    const li = rig.model.boneIndex.get(lastName);
    const end = rig.pointOnBone(ch, li, 1, new THREE.Vector3());
    const len = piv.distanceTo(end);
    if (!lever && d.hit.point.distanceTo(piv) >= 0.35 * len) {
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
    const { rig, state, controls } = this.ctx;
    d.kind = 'fk';
    d.dofs = [];
    const add = (c, damp) => c.axes.forEach((a, k) => {
      if (!DRAG_KEYS.has(a.key) || (a.extra && state.limits)) return;
      d.dofs.push({
        damp,
        get: () => rig.read(ch, c, k),
        set: (v, clamp) => { const r = rig.write(ch, c, k, v, clamp); rig.refreshControl(ch, c); return clamp && r.clamped; },
      });
    });
    add(ctrl, 1);
    // forearm / shin: a hinge alone cannot follow a sideways drag; the upper arm / thigh
    // helps (damped more: the elbow / knee bends first), so the touched point stays under the finger
    const upper = ctrl.baseId === 'forearm' ? 'arm.' : ctrl.baseId === 'shin' ? 'thigh.' : null;
    if (upper) add(controls.get(upper + ctrl.side), 3);
    d.follow = this.ctx.follow.begin(ch, ctrl);
    this._handleFor(d, ch, ctrl, SPINE_LEVER.has(ctrl.baseId));
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
      sync: (v) => { cur = v; }, // the pose was put back to the value v
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
    if (limited !== d.atLimit && d.dofs) this.shell.hint(limited ? `${d.ctrl.label} · al limite` : d.kind === 'fk' ? d.ctrl.label : '');
    d.atLimit = limited;
    ctx.edited(ch, false);
    app.invalidate();
  }

  /**
   * The handle follows the finger: damped least squares on the drag's degrees of freedom
   * (screen-space Jacobian by finite differences), limits clamp the result. A step is kept
   * only when it brings the handle closer to the finger (backtracking): against coupled
   * limits a plain step can overshoot back and forth, and a resting finger would make the
   * part flicker between two poses.
   */
  _follow(d) {
    const tx = d.h0.x + (d.x - d.x0), ty = d.h0.y + (d.y - d.y0);
    const n = d.dofs.length;
    if (!n) return false;
    const ch = d.ch, { rig } = this.ctx;
    const J = d.J || (d.J = new Float64Array(n * 2)), v0 = d.v0 || (d.v0 = new Float64Array(n));
    const save = d.saveQ || (d.saveQ = ch.poseQuat.map((q) => q.clone()));
    const H = 0.02;
    const errNow = () => { const c = this._project(this._handleWorld(d, _v), _s2); return c ? (tx - c.x) ** 2 + (ty - c.y) ** 2 : Infinity; };
    const restore = () => {
      for (let i = 0; i < save.length; i++) ch.poseQuat[i].copy(save[i]);
      rig.refreshAll(ch);
      for (let k = 0; k < n; k++) d.dofs[k].sync?.(v0[k]);
    };
    let limited = false;
    for (let it = 0; it < 3; it++) {
      const cur = this._project(this._handleWorld(d, _v), _s);
      if (!cur) break;
      const cx = cur.x, cy = cur.y;
      const ex = tx - cx, ey = ty - cy;
      const e0 = ex * ex + ey * ey;
      if (e0 < 0.25) break;
      for (let k = 0; k < n; k++) {
        const dof = d.dofs[k];
        v0[k] = dof.get();
        dof.set(v0[k] + H, false);
        const p = this._project(this._handleWorld(d, _v), _s2);
        J[k * 2] = p ? (p.x - cx) / H : 0; J[k * 2 + 1] = p ? (p.y - cy) / H : 0;
        dof.set(v0[k], false);
      }
      for (let i = 0; i < save.length; i++) save[i].copy(ch.poseQuat[i]);
      // (JtJ + lambda D) dx = Jt e   (D: per-dof damping, the hinge moves before the bone above it)
      const A = d.A || (d.A = new Float64Array(n * n)), g = d.g || (d.g = new Float64Array(n)), dx = d.dx || (d.dx = new Float64Array(n));
      let tr = 0;
      for (let k = 0; k < n; k++) tr += J[k * 2] * J[k * 2] + J[k * 2 + 1] * J[k * 2 + 1];
      const lam = 0.05 * tr + 40;
      for (let i = 0; i < n; i++) {
        g[i] = J[i * 2] * ex + J[i * 2 + 1] * ey;
        for (let j = 0; j < n; j++) A[i * n + j] = J[i * 2] * J[j * 2] + J[i * 2 + 1] * J[j * 2 + 1];
        A[i * n + i] += lam * (d.dofs[i].damp || 1);
      }
      if (!solveSmall(A, g, dx, n)) break;
      let ok = false, lim = false;
      for (let bt = 0, f = 1; bt < 4; bt++, f *= 0.5) {
        lim = false;
        for (let k = 0; k < n; k++) {
          const st = Math.max(-0.3, Math.min(0.3, dx[k] * f));
          lim = d.dofs[k].set(v0[k] + st, true) || lim;
        }
        if (errNow() < e0 - 0.01) { ok = true; break; }
        restore();
      }
      limited = limited || lim;
      if (!ok) break; // nothing closer within the limits: the part stays where it is
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
      // palm rejection / system gesture / pinch: the pose before the drag comes back, no undo step
      this.restorePose(ch, d.undo);
      return;
    }
    // a drag that could not move anything (limits, a straight arm turning about its own line)
    const same = d.undo.q.every((q, i) => Math.abs(q.dot(ch.poseQuat[i])) > 1 - 1e-9) && d.undo.root.distanceToSquared(ch.rootOffset) < 1e-12;
    if (same && d.dofs) { haptic('warning'); this.shell.hint(`${d.ctrl.label}: al limite, non si muove oltre`, 1500); }
    ctx.edited(ch, true, d.label);
  }

  // ------------------------------------------------------------ touch menu (hand / foot)
  /** after a tap selected a part: a hand or a foot opens its menu at the finger */
  maybeMenu(hit, x, y) {
    if (!this.enabled || !hit?.control || this.armed) return false;
    const c = this.palmAsHand(hit.control, hit.character);
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
    // short screens (a phone in landscape): no second lines, the card fits beside the finger
    const short = window.innerHeight < 500;
    const hint = (t) => (short ? undefined : t);
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
      items.push({ id: 'reach', label: 'Tocca un punto da raggiungere', icon: 'tap', hint: hint('Un oggetto, il pavimento, un personaggio'), onClick: () => this.arm(ch, eff) });
      if (pinned) items.push({ id: 'free', label: 'Libera contatto', icon: 'unlock', onClick: () => { api.unpin(ch, eff); toast(`${EFFECTOR_LABEL[eff]} libera`, { ms: 1400 }); } });
      else items.push({ id: 'pin', label: 'Fissa a superficie', icon: 'lock', hint: hint('Resta qui quando muovi il corpo'), onClick: () => this.pinHere(ch, eff) });
    } else {
      items.push({ id: 'floor', label: 'Appoggia a terra', icon: 'ground', onClick: () => this.footDown(ch, eff) });
      items.push({ id: 'reach', label: 'Tocca un punto', icon: 'tap', hint: hint('Un gradino, una sedia, un oggetto'), onClick: () => this.arm(ch, eff) });
      if (pinned) items.push({ id: 'free', label: 'Libera', icon: 'unlock', onClick: () => { api.unpin(ch, eff); toast(`${EFFECTOR_LABEL[eff]} libero`, { ms: 1400 }); } });
    }
    const m = stageMenu(items, {
      x, y, title: EFFECTOR_LABEL[eff], subtitle: pinned ? 'Contatto fissato · ' + ch.name : ch.name, body, width: short ? 300 : 276,
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
    this._reachPoint(a.ch, a.eff, hit);
    return true;
  }

  /**
   * "Tocca un punto": contact at a surface point. Out of reach (beyond the arm, a squat and a
   * natural bend of the back) the pose comes back untouched and no contact is kept: the toast
   * offers to walk there first (Avvicina, one undo step with the contact).
   */
  _reachPoint(ch, eff, hit, { approached = false } = {}) {
    const { ctx } = this;
    const u = this.snapPose(ch);
    const r = ctx.contacts.pinTo(ch, eff, hit.point, hit.normal, { target: hit.owner });
    if (r.ok || r.error < REACH_OK * (ch.root.scale.y || 1)) {
      ctx.edited(ch, !approached, 'contatto');
      haptic('success');
      return true;
    }
    this.restorePose(ch, u);
    haptic('warning');
    if (approached) { toast(`${EFFECTOR_LABEL[eff]}: non ci arriva neanche da vicino`, { kind: 'info', ms: 2200 }); return false; }
    toast('Troppo lontano da qui', {
      kind: 'info', ms: 4000, icon: 'footprint',
      action: { label: 'Avvicina', onClick: () => this.approachAndReach(ch, eff, hit) },
    });
    return false;
  }

  /** walks the character next to a point and makes the contact there (one undo step) */
  async approachAndReach(ch, eff, hit) {
    const { app, ctx } = this;
    if (!app.characters.includes(ch)) return false;
    let ok = false;
    await app.history.batch('raggiungi', () => {
      // close to the point, its hand side toward it (the squat and the arm do the rest)
      if (!ctx.api.approach(ch, hit.point, hit.point, { near: 0.3, commit: false })) return;
      ok = this._reachPoint(ch, eff, hit, { approached: true });
    });
    return ok;
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

/** solves the n x n system A x = b in place (Gaussian elimination, partial pivoting); false when singular */
function solveSmall(A, b, x, n) {
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
    if (Math.abs(A[p * n + c]) < 1e-12) return false;
    if (p !== c) {
      for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; }
      const t = b[c]; b[c] = b[p]; b[p] = t;
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c];
      if (!f) continue;
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
      b[r] -= f * b[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let t = b[r];
    for (let k = r + 1; k < n; k++) t -= A[r * n + k] * x[k];
    x[r] = t / A[r * n + r];
  }
  return true;
}
