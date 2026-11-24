// Contacts ("Fissa a superficie" / "Mantieni il contatto"): a hand or a foot put on a
// surface with IK — palm or sole turned onto the surface, resting a few millimetres
// above it — and pinned there. While a character has pins, every pose or placement
// change re-solves them (the arm / leg reaches back to the contact), so a hand on a
// table or on another character's shoulder stays put while the body, the pelvis or the
// character itself is moved. A contact on a prop follows the prop, a contact on a
// character follows the bone it touches; a contact on the floor / terrain is a world
// point.
//
// Per-character state (serialized with the character): ch.data.pose.pins = [{
//   e: 'hand.L' | 'hand.R' | 'foot.L' | 'foot.R',
//   p, n, f: [x, y, z]   contact point, surface normal, finger / toe direction (world;
//                        for a target: the last known values, used if it disappears)
//   t?: {k: 'ch', id, b, p, n, f} (bone frame of a character) | {k: 'prop', id, p, n, f}
// }]
// Markers: small rings on a 2D overlay canvas (never exported, never inked).
import * as THREE from 'three';

export const EFFECTORS = ['hand.L', 'hand.R', 'foot.L', 'foot.R'];
export const EFFECTOR_LABEL = { 'hand.L': 'Mano sinistra', 'hand.R': 'Mano destra', 'foot.L': 'Piede sinistro', 'foot.R': 'Piede destro' };
const EMPTY = Object.freeze([]);
/** palm skin over the wrist -> knuckles line and sole clearance, reference-hand meters */
const PALM_SKIN = 0.016, REST_GAP = 0.004, REF_HAND = 0.092;
/** a target contact farther than this from its effector after a move is let go (m) */
const LOST = 0.06;
/** back bend (rad) a contact placed by reach may add, and the reach it buys (m, scaled) for the squat */
const SPINE_MAX = 0.6, CROUCH_BACK = 0.15;

const _P = new THREE.Vector3(), _N = new THREE.Vector3(), _F = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _W = new THREE.Vector3(), _C = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3();
const _T = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _R = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix3();
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const arr = (v) => [r5(v.x), r5(v.y), r5(v.z)];

/** rotation taking the orthonormal frame (a1, b1) onto (a2, b2) (a = primary axis) */
function alignFrames(a1, b1, a2, b2, out) {
  const A1 = _a.copy(a1).normalize(), B1 = _b.copy(b1).addScaledVector(A1, -b1.dot(A1)).normalize();
  _m.makeBasis(A1, B1, _c.crossVectors(A1, B1));
  const A2 = _a.copy(a2).normalize(), B2 = _b.copy(b2).addScaledVector(A2, -b2.dot(A2)).normalize();
  _m2.makeBasis(A2, B2, _c.crossVectors(A2, B2));
  _m2.multiply(_m.transpose());
  return out.setFromRotationMatrix(_m2);
}

/** any unit vector perpendicular to n */
function perp(n, out) {
  out.set(0, 1, 0);
  if (Math.abs(n.y) > 0.9) out.set(0, 0, 1);
  return out.addScaledVector(n, -out.dot(n)).normalize();
}

export class ContactPins {
  /** ctx: pose module context (app, shell, rig, ik, controls, picker, state, isActive()) */
  constructor(ctx) {
    this.ctx = ctx;
    this.app = ctx.app;
    this._depth = 0;
    this._pending = new Set();
    this._listen = new WeakMap();
    /** `${ch.id}|${effector}` of contacts not enforced right now (their handle is being dragged) */
    this._suspended = new Set();
    this._feet = new WeakMap();
    /** extra overlay drawing (armed reach ring, carried character): fn(g, project) */
    this.decorators = new Set();
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pv-pose-gizmo pv-pose-pins passthrough';
    ctx.shell.overlay.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d');
    this._drawn = false;
    this._rect = null;
    this.app.addEventListener('resize', () => { this._rect = null; });
    ctx.shell.addEventListener?.('layout', () => { this._rect = null; });
    this.app.addAfterRenderHook(() => this.draw());
  }

  // ------------------------------------------------------------ data
  /** stored pins of a character (do not modify) */
  list(ch) { return ch?.data?.pose?.pins || EMPTY; }
  get(ch, eff) { return this.list(ch).find((p) => p.e === eff) || null; }
  label(eff) { return EFFECTOR_LABEL[eff] || eff; }
  has(ch, eff) { return !!this.get(ch, eff); }
  get keep() { return this.ctx.state.keepContacts !== false; }

  _store(ch) {
    const d = ch.data.pose || (ch.data.pose = {});
    return d.pins || (d.pins = []);
  }

  _clean(ch) {
    const d = ch.data?.pose;
    if (!d) return;
    if (d.pins && !d.pins.length) delete d.pins;
    if (!Object.keys(d).length) delete ch.data.pose;
  }

  /** removes a contact (no undo step); true if there was one */
  remove(ch, eff) {
    const list = ch?.data?.pose?.pins;
    if (!list) return false;
    const i = list.findIndex((p) => p.e === eff);
    if (i < 0) return false;
    list.splice(i, 1);
    this._clean(ch);
    this.app.invalidate();
    return true;
  }

  /** removes every contact of a character (no undo step) */
  clear(ch) {
    if (!ch?.data?.pose?.pins) return false;
    delete ch.data.pose.pins;
    this._clean(ch);
    this.app.invalidate();
    return true;
  }

  /** public description: [{effector, point, normal, target?}] (world) */
  describe(ch) {
    return this.list(ch).map((pin) => {
      const w = this._world(pin, new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
      const out = { effector: pin.e, point: w.P, normal: w.N };
      if (pin.t) {
        if (pin.t.k === 'ch') out.target = { character: this.app.characters.find((c) => c.id === pin.t.id) || null, bone: pin.t.b };
        else out.target = { prop: this._prop(pin.t.id) };
      }
      return out;
    });
  }

  _prop(id) { return this.app.props?.props?.find((q) => q.id === id) || null; }

  /** world matrix of a pin target, or null when it is gone */
  _frame(t) {
    if (!t) return null;
    if (t.k === 'ch') {
      const c = this.app.characters.find((x) => x.id === t.id);
      const b = c?.boneByName.get(t.b);
      if (!b) return null;
      c.root.updateMatrixWorld(true);
      return b.matrixWorld;
    }
    if (t.k === 'prop') {
      const p = this._prop(t.id);
      if (!p) return null;
      p.root.updateWorldMatrix(true, false);
      return p.root.matrixWorld;
    }
    return null;
  }

  /** world contact point / normal / tangent of a pin (from its target when there is one) */
  _world(pin, P = _P, N = _N, F = _F) {
    const M = this._frame(pin.t);
    if (M) {
      P.fromArray(pin.t.p).applyMatrix4(M);
      _m3.getNormalMatrix(M);
      N.fromArray(pin.t.n).applyMatrix3(_m3).normalize();
      F.fromArray(pin.t.f).transformDirection(M);
    } else {
      P.fromArray(pin.p); N.fromArray(pin.n).normalize(); F.fromArray(pin.f).normalize();
    }
    return { P, N, F };
  }

  /**
   * Owner of a surface point, as a pin target {k, id, b?} (no local data yet) or null (world).
   * hint: {character, bone} | {prop} | Object3D (a hit object) | null
   */
  targetOf(hint) {
    if (!hint) return null;
    if (hint.character && hint.bone != null) {
      const c = hint.character, b = typeof hint.bone === 'number' ? c.bones[hint.bone]?.name : hint.bone;
      return b ? { k: 'ch', id: c.id, b } : null;
    }
    if (hint.prop) return { k: 'prop', id: hint.prop.id };
    if (hint.isObject3D) {
      for (let o = hint; o; o = o.parent) if (o.userData?.prop?.id) return { k: 'prop', id: o.userData.prop.id };
    }
    return null;
  }

  // ------------------------------------------------------------ effector geometry
  /**
   * Current contact frame of an effector (world): end joint E (wrist / ankle), contact
   * point C (palm skin / shoe sole), primary axis A (palm: out of the palm; sole: up out
   * of the foot) and tangent B (finger / toe direction).
   */
  _effector(ch, eff, E, C, A, B) {
    const { rig, ik } = this.ctx;
    const side = eff.slice(-1), chain = ik.chains[eff];
    rig.worldPos(ch, chain.end, E);
    if (chain.kind === 'arm') {
      const bi = (n) => rig.model.boneIndex.get(`${n}.${side}`);
      const k2 = rig.worldPos(ch, bi('finger2-1'), _a), k5 = rig.worldPos(ch, bi('finger5-1'), _b);
      const k3 = rig.worldPos(ch, bi('finger3-1'), _c), k4 = rig.worldPos(ch, bi('finger4-1'), _d);
      B.copy(k2).add(k3).add(k4).add(k5).multiplyScalar(0.25).sub(E);
      const hs = B.length() / REF_HAND;
      B.normalize();
      _d.subVectors(k2, k5);
      A.crossVectors(B, _d).normalize();
      if (side === 'R') A.negate();
      ik.effectorPoint(ch, eff, C).addScaledVector(A, PALM_SKIN * hs);
      return;
    }
    // foot: rest-frame vectors of the sole (cached per shape)
    const fi = chain.end, f = this._footFrame(ch, side, fi);
    const Mw = ch.bones[fi].matrixWorld;
    C.copy(f.c).applyMatrix4(Mw);
    A.copy(f.up).transformDirection(Mw);
    B.copy(f.fwd).transformDirection(Mw);
  }

  /** sole contact point and up / toe directions in the foot bone frame */
  _footFrame(ch, side, fi) {
    let cache = this._feet.get(ch);
    const ref = ch.jointPositions;
    const gc = ch.groundClearance || 0;
    if (!cache || cache.ref !== ref.get('root____head') || cache.gc !== gc) {
      cache = { ref: ref.get('root____head'), gc };
      for (const s of ['L', 'R']) {
        const i = ch.model.boneIndex.get('foot.' + s), ib = ch.model.boneIndex.get('toe3-1.' + s);
        const bones = ch.model.bones;
        const A = ch.jointPositions.get(bones[i].head), Bl = ch.jointPositions.get(bones[ib].head);
        _q.setFromRotationMatrix(_m.extractRotation(ch.restGlobal[i])).invert();
        const cx = A.x + (Bl.x - A.x) * 0.3, cz = A.z + (Bl.z - A.z) * 0.3;
        cache[s] = {
          up: new THREE.Vector3(0, 1, 0).applyQuaternion(_q),
          fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(_q),
          c: new THREE.Vector3(cx - A.x, -(A.y + gc), cz - A.z).applyQuaternion(_q),
        };
      }
      this._feet.set(ch, cache);
    }
    return cache[side];
  }

  /** default tangent (finger / toe direction) of a new contact on a surface of normal N at P */
  _tangent(ch, eff, P, N, out) {
    const { rig, ik } = this.ctx;
    const chain = ik.chains[eff];
    const proj = (v) => v.addScaledVector(N, -v.dot(N));
    if (chain.kind === 'arm') {
      // fingers point away from the shoulder along the surface; on a wall: up
      rig.worldPos(ch, chain.upper, _a);
      proj(out.subVectors(P, _a));
      if (out.length() > 0.12 * ch.root.scale.y) return out.normalize();
      proj(out.set(0, 1, 0));
      if (out.lengthSq() > 0.09) return out.normalize();
      this._effector(ch, eff, _W, _C, _u, out);
      proj(out);
      return out.lengthSq() > 1e-4 ? out.normalize() : perp(N, out);
    }
    // toes: where the foot points now, else where the character faces
    this._effector(ch, eff, _W, _C, _u, out);
    proj(out);
    if (out.lengthSq() > 0.09) return out.normalize();
    out.set(0, 0, 1).transformDirection(ch.root.matrixWorld);
    proj(out);
    return out.lengthSq() > 1e-4 ? out.normalize() : perp(N, out);
  }

  // ------------------------------------------------------------ solving
  /**
   * Puts an effector on (P, N, F): palm / sole flat on the surface, end joint solved with
   * the limb IK (opts.reach: the body helps when the point is far: clavicle + back for a
   * hand, pelvis for a foot, the standing foot stays planted). Matrices refreshed, no
   * 'pose' event. Returns the remaining distance (m) between contact and target.
   */
  place(ch, eff, P, N, F, { reach = false } = {}) {
    const { rig, ik, state } = this.ctx;
    const chain = ik.chains[eff];
    if (!chain) return Infinity;
    const scale = ch.root.scale.y || 1;
    _T.copy(P).addScaledVector(N, REST_GAP * scale);
    const wantA = _d.copy(N);
    if (chain.kind === 'arm') wantA.negate(); // the palm faces the surface
    const wantA2 = wantA.clone(), F2 = F.clone();
    let pins = [];
    if (reach && chain.kind === 'leg' && state.pinFeet) {
      const other = chain.side === 'L' ? 'R' : 'L';
      if (this.ctx.feetOnFloor(ch)[other] || this.has(ch, 'foot.' + other)) pins = [ik.pin(ch, other)];
    }
    // a hand sent low (the floor, a low table): the knees bend first, and the back only
    // helps up to a natural bend (it never folds into the limits to chase a far point)
    if (reach && chain.kind === 'arm') this._crouch(ch, chain, _T);
    const snap = reach ? ik.reachSnapshot(ch, chain, { spineMax: chain.kind === 'arm' ? SPINE_MAX : Infinity }) : null;
    const E = new THREE.Vector3(), C = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3();
    if (reach) {
      // a far contact is walked there in small steps, like a drag (the limb IK keeps the
      // current elbow / knee swivel and the limits: one big jump can get stuck on them)
      this._effector(ch, eff, E, C, A, B);
      const C0 = C.clone(), off0 = C.clone().sub(E), Q0 = rig.worldQuat(ch, chain.end, new THREE.Quaternion());
      const Rfull = alignFrames(A, B, wantA2, F2, new THREE.Quaternion());
      const n = Math.min(10, Math.max(1, Math.ceil(C0.distanceTo(_T) / (0.07 * scale))));
      const Rk = new THREE.Quaternion(), Tk = new THREE.Vector3(), endQ = new THREE.Quaternion(), tgt = new THREE.Vector3();
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        Rk.identity().slerp(Rfull, t);
        endQ.copy(Rk).multiply(Q0);
        Tk.lerpVectors(C0, _T, t);
        tgt.copy(off0).applyQuaternion(Rk).negate().add(Tk);
        ik.reach(ch, chain, tgt, snap);
        ik.solveLimb(ch, chain, tgt, endQ, 3);
        for (const p of pins) ik.solvePinned(ch, p);
      }
    }
    let err = Infinity;
    for (let it = 0; it < 3; it++) {
      this._effector(ch, eff, E, C, A, B);
      alignFrames(A, B, wantA2, F2, _R);
      rig.worldQuat(ch, chain.end, _q).premultiply(_R);
      const endQuat = _q2.copy(_q);
      // end joint so that the rotated contact point lands on the target
      const target = _W.subVectors(C, E).applyQuaternion(_R).negate().add(_T);
      ik.solveLimb(ch, chain, target, endQuat, 3);
      for (const p of pins) ik.solvePinned(ch, p);
      this._effector(ch, eff, E, C, A, B);
      err = C.distanceTo(_T);
      if (err < 0.004 * scale) break;
    }
    return err;
  }

  /**
   * Standing character, hand target below the hips and out of a comfortable reach: a squat
   * with the feet planted (pelvis down, at most to a deep squat, knees within their limits)
   * and the hips flexing toward the target (pelvis tilted forward, at most ~40°), until the
   * shoulder is close enough for the arm and a natural bend of the back. Matrices refreshed.
   */
  _crouch(ch, chain, T) {
    const { rig, ik } = this.ctx;
    const s = ch.root.scale.y || 1;
    const feet = this.ctx.feetOnFloor(ch);
    const pins = ['L', 'R'].filter((sd) => feet[sd] || this.has(ch, 'foot.' + sd)).map((sd) => ik.pin(ch, sd));
    if (pins.length < 2) return; // seated, kneeling on one leg, in the air: no squat
    rig.refreshAll(ch);
    const S = new THREE.Vector3(), E = new THREE.Vector3(), W = new THREE.Vector3(), H = new THREE.Vector3();
    rig.worldPos(ch, chain.upper, S); rig.worldPos(ch, chain.lower, E); rig.worldPos(ch, chain.end, W);
    const L = S.distanceTo(E) + E.distanceTo(W);
    rig.worldPos(ch, 0, H);
    if (T.y > H.y - 0.08 * s) return; // only below the hips
    const floorY = Math.min(pins[0].pos.y, pins[1].pos.y);
    const maxDrop = 0.45 * Math.max(0, H.y - floorY);
    const help = 0.92 * L + CROUCH_BACK * s; // a nearly straight arm + what the back adds
    const inv = new THREE.Matrix4().copy(ch.rig.matrixWorld).invert();
    const dR = new THREE.Vector3(), axis = new THREE.Vector3(), q = new THREE.Quaternion();
    const y0 = H.y;
    // the knees bend only for a low target (the floor, a coffee table); at a table or a
    // counter the hips flex and the legs stay straight
    const low = T.y < floorY + 0.55 * (y0 - floorY);
    const maxLean = low ? 0.85 : 0.45; // a squat leans further than a lean on a table
    // how far the pelvis already leans (a second hand on the same table: the total stays natural)
    _f.setFromMatrixColumn(ch.bones[0].matrixWorld, 1).normalize();
    _u.setFromMatrixColumn(ch.restGlobal[0], 1).transformDirection(ch.rig.matrixWorld);
    let leaned = Math.min(maxLean, Math.acos(Math.max(-1, Math.min(1, _f.dot(_u)))));
    for (let it = 0; it < 10; it++) {
      rig.worldPos(ch, chain.upper, S);
      const need = S.distanceTo(T) - help;
      if (need < 0.01 * s) break;
      let moved = false;
      // 1) the hips flex: the pelvis tilts toward the target (the legs are re-solved on the planted feet)
      rig.worldPos(ch, 0, H);
      axis.set(T.x - H.x, 0, T.z - H.z);
      if (leaned < maxLean && axis.lengthSq() > 1e-6) {
        const da = Math.min(0.12, maxLean - leaned);
        axis.normalize().cross(_up); // horizontal, perpendicular to the way to the target
        q.setFromAxisAngle(axis.negate(), da);
        rig.rotateWorld(ch, 0, q);
        rig.refreshBone(ch, 0);
        ik.movePelvis(ch, ch.rootOffset.clone(), pins);
        leaned += da;
        moved = true;
      }
      // 2) down (the knees bend), never below a deep squat
      rig.worldPos(ch, 0, H);
      const dy = low ? Math.min(need * 0.5, maxDrop - (y0 - H.y)) : 0;
      if (dy > 1e-3 * s) {
        const before = ch.rootOffset.clone();
        dR.set(H.x, H.y - dy, H.z).applyMatrix4(inv).sub(H.clone().applyMatrix4(inv));
        ik.movePelvis(ch, before.clone().add(dR), pins);
        moved = ch.rootOffset.distanceToSquared(before) > 1e-8 || moved;
      }
      if (!moved) break; // a deep squat, leaning as far as it goes
    }
  }

  /** Re-solves every enforced contact of a character (no event). Returns true if any. */
  solve(ch) {
    const list = this.list(ch);
    if (!list.length || !this.keep) return false;
    let any = false;
    this.ctx.rig.refreshAll(ch);
    for (const pin of list) {
      if (this._suspended.has(ch.id + '|' + pin.e)) continue;
      const { P, N, F } = this._world(pin);
      const P2 = P.clone(), N2 = N.clone(), F2 = F.clone();
      this.place(ch, pin.e, P2, N2, F2);
      if (pin.t) { pin.p = arr(P2); pin.n = arr(N2); pin.f = arr(F2); }
      any = true;
    }
    return any;
  }

  /** characters with a contact on `ch` */
  _dependents(ch) {
    const out = [];
    for (const c of this.app.characters) if (c !== ch && this.list(c).some((p) => p.t?.k === 'ch' && p.t.id === ch.id)) out.push(c);
    return out;
  }

  /** any contact on a prop? (props moving re-solve them) */
  _onProp(prop) {
    const out = [];
    for (const c of this.app.characters) if (this.list(c).some((p) => p.t?.k === 'prop' && p.t.id === prop.id)) out.push(c);
    return out;
  }

  /**
   * A character's pose or placement changed: re-solve its contacts and those of the
   * characters touching it (each at most once per change; nested events are queued).
   */
  changed(src) {
    if (this.app.history?.restoring || !this.keep) return;
    if (this._depth > 0) { this._pending.add(src); return; }
    if (!this.list(src).length && !this._dependents(src).length) return;
    this._depth++;
    try {
      const queue = [src], done = new Set();
      while (queue.length) {
        const c = queue.shift();
        if (done.has(c) || !this.app.characters.includes(c)) continue;
        done.add(c);
        if (this.solve(c)) c.applyPose();
        queue.push(...this._dependents(c));
        for (const p of this._pending) if (!done.has(p)) queue.push(p);
        this._pending.clear();
      }
    } finally { this._depth--; this._pending.clear(); }
  }

  attach(ch) {
    if (this._listen.has(ch)) return;
    const fn = () => this.changed(ch);
    this._listen.set(ch, fn);
    ch.addEventListener('pose', fn);
    ch.addEventListener('placement', fn);
  }

  detach(ch) {
    const fn = this._listen.get(ch);
    if (!fn) return;
    ch.removeEventListener('pose', fn);
    ch.removeEventListener('placement', fn);
    this._listen.delete(ch);
  }

  /** a prop moved: re-solve the contacts resting on it */
  propChanged(prop) {
    if (!prop || this.app.history?.restoring) return;
    for (const c of this._onProp(prop)) this.changed(c);
  }

  // ------------------------------------------------------------ high level
  /**
   * Contact: puts the effector on the surface (palm / sole on it, IK, the body helps) and,
   * with keep, pins it. opts.target: owner hint ({character, bone} | {prop} | Object3D),
   * found from the point when omitted. Returns {ok, error} (ok: within 3 cm).
   */
  pinTo(ch, eff, point, normal, { keep = true, target, reach = true, tangent = null } = {}) {
    if (!ch || !this.ctx.ik.chains[eff]) return { ok: false, error: Infinity };
    const P = new THREE.Vector3().copy(point), N = new THREE.Vector3().copy(normal);
    if (N.lengthSq() < 1e-8) N.set(0, 1, 0);
    N.normalize();
    this.remove(ch, eff);
    this.ctx.rig.refreshAll(ch);
    let Fv = null;
    if (tangent) {
      Fv = new THREE.Vector3().copy(tangent);
      Fv.addScaledVector(N, -Fv.dot(N));
      Fv = Fv.lengthSq() > 1e-6 ? Fv.normalize() : null;
    }
    if (!Fv) Fv = this._tangent(ch, eff, P, N, new THREE.Vector3());
    const err = this.place(ch, eff, P, N, Fv, { reach });
    if (keep) {
      const pin = { e: eff, p: arr(P), n: arr(N), f: arr(Fv) };
      const t = target === undefined ? this.findOwner(P, N, ch, 0.05, eff) : this.targetOf(target);
      if (t) {
        const M = this._frame(t);
        if (M) {
          _m.copy(M).invert();
          _m3.getNormalMatrix(_m);
          t.p = arr(_a.copy(P).applyMatrix4(_m));
          t.n = arr(_b.copy(N).applyMatrix3(_m3).normalize());
          t.f = arr(_c.copy(Fv).transformDirection(_m));
          pin.t = t;
        }
      }
      this._store(ch).push(pin);
    }
    this.app.invalidate();
    return { ok: err < 0.03 * (ch.root.scale.y || 1), error: err };
  }

  /**
   * Pins an effector where it is now (palm / sole frame kept), on the surface under it
   * when there is one close by. Returns true.
   */
  pinHere(ch, eff) {
    const E = new THREE.Vector3(), C = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3();
    this.ctx.rig.refreshAll(ch);
    this._effector(ch, eff, E, C, A, B);
    const N = A.clone();
    if (this.ctx.ik.chains[eff].kind === 'arm') N.negate();
    const owner = this.findOwner(C, N, ch, 0.06, eff);
    this.remove(ch, eff);
    const pin = { e: eff, p: arr(C), n: arr(N), f: arr(B) };
    if (owner) {
      const M = this._frame(owner);
      _m.copy(M).invert();
      _m3.getNormalMatrix(_m);
      owner.p = arr(_a.copy(C).applyMatrix4(_m));
      owner.n = arr(_b.copy(N).applyMatrix3(_m3).normalize());
      owner.f = arr(_c.copy(B).transformDirection(_m));
      pin.t = owner;
    }
    this._store(ch).push(pin);
    this.app.invalidate();
    return true;
  }

  /**
   * What is at P (a short ray from P + N*reach back along -N): a prop or another
   * character's bone, as a target {k, id, b?}; null = world (floor, terrain, room).
   */
  findOwner(P, N, self = null, reach = 0.05, eff = null) {
    const ray = new THREE.Ray(_a.copy(P).addScaledVector(N, reach), _b.copy(N).negate());
    const hit = this.hitSurface(ray, { self, eff, far: reach * 2 + 0.02, floor: false });
    return hit ? this.targetOf(hit.owner) : null;
  }

  /**
   * First surface along a world ray: another character's body (CPU skinned triangles; the
   * character itself only where a contact of `eff` may go), props / buildings / city
   * items / terrain / animals in app.world and the studio floor. Held props are skipped.
   * Returns {point, normal (toward the ray origin), distance, owner} | null; owner is
   * {character, bone} for a body, the hit Object3D otherwise (see targetOf).
   */
  hitSurface(ray, { self = null, eff = null, far = Infinity, floor = true } = {}) {
    const app = this.app, picker = this.ctx.picker;
    let best = null;
    for (const c of app.characters) {
      const hit = picker.rayHit(c, ray, far);
      if (!hit || (best && hit.distance >= best.distance)) continue;
      if (c === self && !this._selfOk(c, hit.bone, eff)) continue;
      best = { point: hit.point, normal: picker.normalAt(c, hit.tri), distance: hit.distance, owner: { character: c, bone: hit.bone } };
    }
    const rc = this._rc || (this._rc = new THREE.Raycaster());
    rc.ray.copy(ray);
    rc.near = 0; rc.far = Math.min(far, best ? best.distance : Infinity);
    const objs = this._sceneMeshes(floor);
    for (const hit of rc.intersectObjects(objs, false)) {
      const t = this.targetOf(hit.object);
      if (t?.k === 'prop' && this._prop(t.id)?.hold) continue; // a prop in a hand
      const n = new THREE.Vector3(0, 1, 0);
      if (hit.face) { _m3.getNormalMatrix(hit.object.matrixWorld); n.copy(hit.face.normal).applyMatrix3(_m3).normalize(); }
      best = { point: hit.point.clone(), normal: n, distance: hit.distance, owner: hit.object };
      break;
    }
    rc.far = Infinity;
    if (!best) return null;
    if (best.normal.dot(ray.direction) > 0) best.normal.negate();
    return best;
  }

  /** visible meshes of the scene a hand or a foot can rest on (no characters, no helpers) */
  _sceneMeshes(floor = true) {
    const app = this.app, roots = new Set(app.characters.map((c) => c.root));
    const out = [];
    const walk = (o) => {
      if (!o.visible || roots.has(o) || o.userData?.isHelper) return;
      if ((o.isMesh || o.isSkinnedMesh) && !o.isPoints && !o.isLine) {
        // skinned bounds are cached by three.js and go stale when posed (animals)
        if (o.isSkinnedMesh) { o.boundingSphere = null; o.boundingBox = null; }
        out.push(o);
      }
      for (const k of o.children) walk(k);
    };
    app.world.updateMatrixWorld(true);
    walk(app.world);
    if (floor && app.ground?.visible !== false && app.ground) out.push(app.ground);
    return out;
  }

  /** a hand may touch its own body, but not its own arm (a foot never its own body) */
  _selfOk(ch, boneIdx, eff) {
    if (!eff) return true;
    if (eff.startsWith('foot')) return false;
    const name = ch.bones[boneIdx]?.name || '';
    const side = eff.slice(-1);
    if (!name.endsWith('.' + side)) return true;
    return !/^(upperarm|lowerarm|wrist|finger|metacarpal|clavicle|shoulder)/.test(name);
  }

  /** Lets go of a contact whose effector ended far from it (after a move). Returns the effectors released. */
  releaseLost(ch) {
    const out = [];
    const E = new THREE.Vector3(), C = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3();
    for (const pin of [...this.list(ch)]) {
      const { P } = this._world(pin);
      this._effector(ch, pin.e, E, C, A, B);
      if (C.distanceTo(P) > LOST * (ch.root.scale.y || 1)) { this.remove(ch, pin.e); out.push(pin.e); }
    }
    return out;
  }

  /**
   * Runs fn (a placement change of ch: slide, teleport) so that contacts on the floor /
   * terrain (world points: the feet it stands on) travel with the character, while contacts
   * on props and characters stay where they are. The caller then re-solves (placement event).
   */
  carry(ch, fn) {
    const loc = [];
    ch.root.updateMatrixWorld(true);
    _m.copy(ch.root.matrixWorld).invert();
    for (const pin of this.list(ch)) {
      if (pin.t) continue;
      loc.push([pin, _a.fromArray(pin.p).applyMatrix4(_m).toArray(), _b.fromArray(pin.n).transformDirection(_m).toArray(), _c.fromArray(pin.f).transformDirection(_m).toArray()]);
    }
    fn();
    ch.root.updateMatrixWorld(true);
    const M = ch.root.matrixWorld;
    for (const [pin, p, n, f] of loc) {
      pin.p = arr(_a.fromArray(p).applyMatrix4(M));
      pin.n = arr(_b.fromArray(n).transformDirection(M));
      pin.f = arr(_c.fromArray(f).transformDirection(M));
    }
  }

  /** a handle drag of an effector begins / ends: its contact is not enforced meanwhile */
  suspend(ch, eff, on) {
    const k = ch.id + '|' + eff;
    if (on) this._suspended.add(k); else this._suspended.delete(k);
  }

  /**
   * A gizmo drag starts on a contact's effector. kind 'move' (IK handle, direct drag): the
   * contact is let go (the drag's undo step records it); 'rotate' (rings / trackball of the
   * hand or foot): not enforced during the drag, then pinned again where it ends.
   */
  handleBegin(ch, eff, kind) {
    this._handle = null;
    if (!ch || !this.has(ch, eff)) return false;
    this.suspend(ch, eff, true);
    this._handle = { ch, eff, kind };
    return true;
  }

  /** end of that drag: moved = the handle really moved (a tap changes nothing) */
  handleEnd(moved = true) {
    const h = this._handle;
    if (!h) return;
    this._handle = null;
    this.suspend(h.ch, h.eff, false);
    if (!moved || !this.app.characters.includes(h.ch)) return;
    if (h.kind === 'move') {
      this.remove(h.ch, h.eff);
      this.ctx.shell.hint(`${EFFECTOR_LABEL[h.eff]}: contatto liberato`, 1400);
    } else this.pinHere(h.ch, h.eff);
  }

  // ------------------------------------------------------------ markers
  _fit() {
    if (this._rect) return;
    this._rect = this.app.canvas.getBoundingClientRect();
    const r = this.ctx.shell.overlay.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.dpr = dpr; this.ox = r.left; this.oy = r.top;
  }

  /** world -> client px (false when behind the camera) */
  project(p, out) {
    const v = _d.copy(p).project(this.app.camera);
    if (v.z > 1 || v.z < -1) return false;
    const r = this._rect || this.app.canvas.getBoundingClientRect();
    out.x = r.left + (v.x + 1) * 0.5 * r.width;
    out.y = r.top + (1 - v.y) * 0.5 * r.height;
    return true;
  }

  draw() {
    const app = this.app;
    let any = this.decorators.size > 0;
    // Vista pulita: no contact markers (the transient rings of a carry / reach still show)
    const markers = this.ctx.isActive() && !this.ctx.shell.cleanView;
    const show = markers || this.decorators.size > 0;
    if (show && !any) for (const c of app.characters) if (c.root.visible && this.list(c).length) { any = true; break; }
    const g = this.g;
    if (!show || !any) {
      if (this._drawn) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.canvas.width, this.canvas.height); this._drawn = false; }
      return;
    }
    this._fit();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, -this.ox * this.dpr, -this.oy * this.dpr);
    this._drawn = true;
    const pt = { x: 0, y: 0 };
    /** decorators: world -> client px object, or null when behind the camera */
    const project = (p, out = pt) => (this.project(p, out) ? out : null);
    if (markers) {
      for (const c of app.characters) {
        if (!c.root.visible) continue;
        for (const pin of this.list(c)) {
          const { P, N } = this._world(pin, _P, _N, _F);
          const active = this.keep && !this._suspended.has(c.id + '|' + pin.e);
          this._ring(g, P, N, 0.035 * (c.root.scale.y || 1), pin.t?.k === 'ch' ? '#ffb86b' : '#4fd1c5', active);
        }
      }
    }
    for (const fn of this.decorators) { try { fn(g, project); } catch (e) { console.warn('[pose] overlay', e); } }
  }

  /** ring of radius r (m) in the plane of normal N at P, + center dot */
  _ring(g, P, N, r, color, solid = true) {
    const U = perp(N, _u), V = _f.crossVectors(N, U);
    const pts = [];
    for (let j = 0; j <= 24; j++) {
      const t = (j / 24) * Math.PI * 2;
      const q = _c.copy(P).addScaledVector(U, Math.cos(t) * r).addScaledVector(V, Math.sin(t) * r);
      const o = { x: 0, y: 0 };
      if (!this.project(q, o)) return;
      pts.push(o);
    }
    g.save();
    g.beginPath();
    pts.forEach((o, j) => (j ? g.lineTo(o.x, o.y) : g.moveTo(o.x, o.y)));
    g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke();
    g.lineWidth = 2.5; g.strokeStyle = color;
    if (!solid) g.setLineDash([4, 4]);
    g.stroke();
    g.setLineDash([]);
    const o = { x: 0, y: 0 };
    if (this.project(P, o)) {
      g.beginPath(); g.arc(o.x, o.y, 3.2, 0, Math.PI * 2);
      g.fillStyle = color; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke();
    }
    g.restore();
  }
}
