// Inverse kinematics on top of the anatomical controls:
//   - two-bone analytic limbs (arm: upperarm01 -> lowerarm01 -> wrist, leg:
//     upperleg01 -> lowerleg01 -> foot). The hinge (elbow / knee) only flexes
//     about its anatomical axis; the upper bone swings with the minimal rotation
//     from the current state (the elbow / knee swivel stays where it was, which
//     feels like dragging a real doll). Twist is redistributed over the twist
//     bones and every control is clamped by the anatomical limits.
//   - end orientation kept in world space (hand / foot flat): wrist twist is
//     moved to the forearm (pronation), excess foot yaw to the shin rotation.
//   - head aim (neck 40% + head), keeping the lateral tilt.
//   - pelvis translation with pinned feet (leg IK), clamped so legs stay reachable.
import * as THREE from 'three';

const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _W = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _I = new THREE.Quaternion();
const _inv = new THREE.Matrix4();
const _tPos = new THREE.Vector3(), _tQuat = new THREE.Quaternion();

export class IKSolver {
  /** @param {import('./rig.js').PoseRig} rig */
  constructor(rig) {
    this.rig = rig;
    this.controls = rig.controls;
    const bi = (n) => rig.model.boneIndex.get(n);
    const C = (id) => this.controls.get(id);
    this.chains = {};
    for (const s of ['L', 'R']) {
      this.chains['hand.' + s] = {
        kind: 'arm', side: s, upper: bi(`upperarm01.${s}`), lower: bi(`lowerarm01.${s}`), end: bi(`wrist.${s}`), twist: bi(`lowerarm02.${s}`),
        cUpper: C(`arm.${s}`), cLower: C(`forearm.${s}`), cEnd: C(`hand.${s}`),
      };
      this.chains['foot.' + s] = {
        kind: 'leg', side: s, upper: bi(`upperleg01.${s}`), lower: bi(`lowerleg01.${s}`), end: bi(`foot.${s}`), twist: bi(`lowerleg02.${s}`),
        cUpper: C(`thigh.${s}`), cLower: C(`shin.${s}`), cEnd: C(`foot.${s}`), cTwist: C(`shin.${s}`),
      };
    }
    this.neck = C('neck');
    this.head = C('head');
    this.iHead = bi('head');
    this.iNeck = bi('neck01');
    this.iEyeL = bi('eye.L'); this.iEyeR = bi('eye.R');
    this.limited = false; // last solve hit a limit
    /** character -> {L, R} last pins (flat reference while the heel is raised) */
    this._plants = new WeakMap();
  }

  /**
   * Solves a limb so that its end joint (wrist / ankle) reaches `target` (world)
   * and, if given, the end bone keeps the world rotation `endQuat`.
   */
  solveLimb(ch, chain, target, endQuat = null, iterations = 2) {
    const rig = this.rig;
    let limited = false;
    const snapU = chain.snapU = rig.snapshot(ch, chain.cUpper, chain.snapU);
    for (let it = 0; it < iterations; it++) {
      rig.worldPos(ch, chain.upper, _S); rig.worldPos(ch, chain.lower, _E); rig.worldPos(ch, chain.end, _W);
      const L1 = _S.distanceTo(_E), L2 = _E.distanceTo(_W);
      let d = _S.distanceTo(target);
      d = Math.min(Math.max(d, Math.abs(L1 - L2) + 1e-4), (L1 + L2) * 0.9995);
      // 1) hinge: interior angle by the law of cosines
      _a.subVectors(_S, _E).normalize(); _b.subVectors(_W, _E).normalize();
      const cur = Math.acos(THREE.MathUtils.clamp(_a.dot(_b), -1, 1));
      const want = Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
      const flex = rig.read(ch, chain.cLower, 0) + (cur - want);
      limited = rig.write(ch, chain.cLower, 0, flex).clamped || limited;
      rig.refreshBone(ch, chain.lower);
      // 2) swing the upper bone: minimal rotation bringing the end joint onto the target line
      rig.worldPos(ch, chain.end, _W);
      _a.subVectors(_W, _S); _b.subVectors(target, _S);
      if (_a.lengthSq() > 1e-10 && _b.lengthSq() > 1e-10) {
        _q.setFromUnitVectors(_a.normalize(), _b.normalize());
        rig.rotateWorld(ch, chain.upper, _q);
        limited = rig.project(ch, chain.cUpper, snapU) || limited;
        rig.refreshControl(ch, chain.cUpper);
      }
    }
    if (endQuat) limited = this.orientEnd(ch, chain, endQuat) || limited;
    this.limited = limited;
    return limited;
  }

  // ------------------------------------------------------------ whole-body reach
  /**
   * State a reach() call restores before recruiting the body: clavicle + back values
   * (hands), pelvis rotation (feet). Taken at drag start.
   */
  reachSnapshot(ch, chain, { spineMax = Infinity } = {}) {
    const rig = this.rig, C = (id) => this.controls.get(id);
    const parts = chain.kind === 'arm' ? [C('shoulder.' + chain.side), C('abdomen'), C('chest')] : [];
    const vals = [];
    for (const c of parts) for (let k = 0; k < c.axes.length; k++) vals.push([c, k, rig.read(ch, c, k)]);
    // spineMax (radians): how much the back may bend / twist to help a hand (a contact placed
    // by a tap keeps a natural back; a drag follows the finger as far as the limits allow)
    return { chain, vals, root: ch.poseQuat[0].clone(), spineMax };
  }

  /**
   * Whole-body reach: when the wrist / ankle target is beyond a comfortable reach of
   * the limb, the body helps — a hand recruits the clavicle (first, small) and then
   * the back (abdomen + chest bend / twist toward the target), a foot tilts the
   * pelvis (a high kick leans the body back). Weighted by how far the target is,
   * within the anatomical limits, always computed from the drag-start state so the
   * body comes back when the hand / foot returns within reach. Matrices refreshed.
   */
  reach(ch, chain, target, snap) {
    const rig = this.rig;
    for (const [c, k, v] of snap.vals) rig.write(ch, c, k, v, false);
    ch.poseQuat[0].copy(snap.root);
    rig.refreshAll(ch);
    rig.worldPos(ch, chain.upper, _S); rig.worldPos(ch, chain.lower, _E); rig.worldPos(ch, chain.end, _W);
    const L = _S.distanceTo(_E) + _E.distanceTo(_W);
    const comfy = (chain.kind === 'arm' ? 0.8 : 0.9) * L;
    let excess = _S.distanceTo(target) - comfy;
    if (excess <= 1e-4) return false;
    excess = Math.min(excess, 0.9 * L);
    let limited = false;
    if (chain.kind === 'arm') {
      // 1) clavicle: up to ~4 cm of shoulder travel (scaled to the body)
      const clav = this.controls.get('shoulder.' + chain.side);
      const iC = clav.pivotIndex;
      const dc = Math.min(excess * 0.45, 0.05 * L / 0.55);
      limited = this._swingToward(ch, clav, iC, _S, target, dc, null) || limited;
      // 2) back: abdomen ~45%, chest the rest (a few passes: the bend is spread over
      // the curved spine, so the shoulder travels less than a rigid turn would move it)
      const ab = this.controls.get('abdomen'), chs = this.controls.get('chest');
      // spineMax caps the total bend of the back (abdomen + chest, flexion and side bend): a swing
      // that would go past it is shortened; one that straightens a bent back is always allowed
      // (a second hand on the same table shares the bend; a back leaning the other way can come
      // back up)
      const cap = snap.spineMax ?? Infinity;
      const keys = [ab, chs].map((c) => [c.axes.findIndex((a) => a.key === 'flex'), c.axes.findIndex((a) => a.key === 'lat')]);
      const bend = () => {
        let b = 0;
        [ab, chs].forEach((c, j) => { const [f, l] = keys[j]; b += Math.hypot(f >= 0 ? rig.read(ch, c, f) : 0, l >= 0 ? rig.read(ch, c, l) : 0); });
        return b;
      };
      const swing = (ctrl, dist) => {
        if (!Number.isFinite(cap)) return this._swingToward(ch, ctrl, ctrl.pivotIndex, _S, target, dist, null);
        const b0 = bend(), max = Math.max(cap, b0);
        const vals = ctrl.axes.map((_, k) => rig.read(ch, ctrl, k));
        const undo = () => { vals.forEach((v, k) => rig.write(ch, ctrl, k, v, false)); rig.refreshControl(ch, ctrl); };
        let hit = this._swingToward(ch, ctrl, ctrl.pivotIndex, _S, target, dist, null);
        for (let i = 0, f = 0.5; i < 4 && bend() > max + 1e-4; i++, f *= 0.5) {
          undo();
          hit = this._swingToward(ch, ctrl, ctrl.pivotIndex, _S, target, dist * f, null) || true;
        }
        if (bend() > max + 1e-4) { undo(); return true; }
        return hit;
      };
      for (let it = 0; it < 3; it++) {
        rig.worldPos(ch, chain.upper, _S);
        excess = _S.distanceTo(target) - comfy;
        if (excess < 0.005 * L) break;
        limited = swing(ab, excess * 0.75) || limited;
        rig.worldPos(ch, chain.upper, _S);
        excess = _S.distanceTo(target) - comfy;
        if (excess < 0.005 * L) break;
        limited = swing(chs, excess * 0.9) || limited;
      }
    } else {
      // pelvis tilt about the root (max ~25°): the whole leg swings toward the target
      // (a high kick leans the body back, the standing leg is re-solved by its pin)
      rig.worldPos(ch, 0, _a);
      _b.subVectors(_W, _a); _c.subVectors(target, _a);
      if (_b.lengthSq() > 1e-8 && _c.lengthSq() > 1e-8) {
        _b.normalize(); _c.normalize();
        const ang = Math.min(Math.acos(THREE.MathUtils.clamp(_b.dot(_c), -1, 1)) * 0.4, (excess / L) * 1.2, 0.45);
        _a.crossVectors(_b, _c);
        if (_a.lengthSq() > 1e-10) {
          _q.setFromAxisAngle(_a.normalize(), ang);
          rig.rotateWorld(ch, 0, _q);
          rig.refreshBone(ch, 0);
        }
      }
    }
    return limited;
  }

  /** turns a part (world rotation about bone `pivot`) so the point P moves up to `dist` toward `target` */
  _swingToward(ch, ctrl, pivot, P, target, dist, snap) {
    const rig = this.rig;
    if (!(dist > 1e-5)) return false;
    rig.worldPos(ch, pivot, _a);
    _b.subVectors(P, _a);
    const r = _b.length();
    if (r < 1e-4) return false;
    _c.subVectors(target, P);
    const cl = _c.length();
    if (cl < 1e-5) return false;
    // wanted point: P moved toward the target, kept on the sphere of radius r about the pivot
    _c.multiplyScalar(Math.min(dist, cl) / cl).add(P).sub(_a).setLength(r);
    _q.setFromUnitVectors(_b.normalize(), _c.normalize());
    if (!snap && !ctrl.coupled) {
      const m = this._snaps || (this._snaps = new Map());
      m.set(ctrl, snap = rig.snapshot(ch, ctrl, m.get(ctrl)));
    }
    const hit = rig.rotateControl(ch, ctrl, _q, snap);
    rig.refreshControl(ch, ctrl);
    return hit;
  }

  /** Keeps the hand / foot world rotation, moving twist to the forearm / shin. */
  orientEnd(ch, chain, endQuat) {
    const rig = this.rig;
    const snapE = chain.snapE = rig.snapshot(ch, chain.cEnd, chain.snapE);
    let limited = false;
    for (let it = 0; it < 2; it++) {
      rig.setWorldQuat(ch, chain.end, endQuat);
      const e = rig.euler(ch, chain.end);
      if (chain.kind === 'arm') {
        // wrist twist (innermost Y) -> forearm pronation (hand 'rot' axis, distributed over the twist bones)
        const tw = e[1];
        rig.setEuler(ch, chain.end, e[0], 0, e[2]);
        const k = 2, ax = chain.cEnd.axes[k];
        rig.write(ch, chain.cEnd, k, rig.read(ch, chain.cEnd, k) + tw * ax.drives[0].sign, false);
        limited = rig.project(ch, chain.cEnd, snapE) || limited;
        rig.refreshControl(ch, chain.cEnd);
      } else {
        // foot yaw beyond its range -> shin rotation (both are "toes out" positive)
        const k = 1; // 'abd' (punta in fuori) axis index of the foot control
        const v = rig.read(ch, chain.cEnd, k);
        const lim = rig.limitsOf(ch, chain.cEnd, k);
        if (lim && (v > lim[1] || v < lim[0])) {
          const excess = v > lim[1] ? v - lim[1] : v - lim[0];
          const ts = rig.read(ch, chain.cTwist, 1);
          rig.write(ch, chain.cTwist, 1, ts + excess);
          rig.refreshBone(ch, chain.twist);
          rig.setWorldQuat(ch, chain.end, endQuat);
        }
        limited = rig.project(ch, chain.cEnd, snapE) || limited;
        rig.refreshBone(ch, chain.end);
      }
    }
    return limited;
  }

  /** Handle position of an effector (world) */
  effectorPoint(ch, id, out = new THREE.Vector3()) {
    const rig = this.rig;
    if (id === 'pelvis') return rig.worldPos(ch, 0, out);
    if (id === 'head') return this.aimPoint(ch, 0.32, out);
    const c = this.chains[id];
    if (c.kind === 'arm') {
      // palm center: between the wrist and the middle finger knuckle
      rig.worldPos(ch, c.end, out);
      const k = rig.model.boneIndex.get(`finger3-1.${c.side}`);
      return out.lerp(rig.worldPos(ch, k, _c), 0.55);
    }
    return rig.pointOnBone(ch, c.end, 0.55, out);
  }

  // ------------------------------------------------------------ head aim
  /** Eye center (world) */
  eyeCenter(ch, out = new THREE.Vector3()) {
    this.rig.worldPos(ch, this.iEyeL, out);
    return out.add(this.rig.worldPos(ch, this.iEyeR, _c)).multiplyScalar(0.5);
  }

  /** Face forward direction (world) from the head bone */
  faceForward(ch, out = new THREE.Vector3()) {
    // rig +Z expressed in the head's rest frame, then rotated by the current head
    const G = ch.restGlobal[this.iHead];
    _q2.setFromRotationMatrix(_inv.extractRotation(G)).invert();
    out.set(0, 0, 1).applyQuaternion(_q2);
    return out.applyQuaternion(this.rig.worldQuat(ch, this.iHead, _q2)).normalize();
  }

  aimPoint(ch, dist, out = new THREE.Vector3()) {
    this.eyeCenter(ch, out);
    return out.addScaledVector(this.faceForward(ch, _a), dist * ch.root.scale.y);
  }

  /** Turns neck + head so the face looks at `target` (world). snaps from rig.snapshot at drag start. */
  aimHead(ch, target, snapNeck, snapHead) {
    const rig = this.rig;
    let limited = false;
    const latN = this.neck.axes.findIndex((a) => a.key === 'lat'), latH = this.head.axes.findIndex((a) => a.key === 'lat');
    for (let it = 0; it < 3; it++) {
      for (const [ctrl, snap, share, lat] of [[this.neck, snapNeck, it === 0 ? 0.4 : 0.25, latN], [this.head, snapHead, 1, latH]]) {
        const O = this.eyeCenter(ch, _S);
        const f = this.faceForward(ch, _a);
        _b.subVectors(target, O);
        if (_b.lengthSq() < 1e-8) return false;
        _b.normalize();
        _q2.setFromUnitVectors(f, _b);
        _q.slerpQuaternions(_I, _q2, share); // (target must not alias the result)
        limited = rig.rotateControl(ch, ctrl, _q, snap) || limited;
        rig.write(ch, ctrl, lat, snap.axes[lat]); // aiming never tilts the head sideways
        rig.refreshControl(ch, ctrl);
      }
    }
    return limited;
  }

  // ------------------------------------------------------------ pelvis with pinned feet
  /**
   * Moves the root to `offset` (rig space). pins: [{chain, pos: Vector3 (ankle world), quat}] keep the feet planted.
   * The pelvis is pulled back toward the feet when a leg could not reach.
   */
  movePelvis(ch, offset, pins) {
    const rig = this.rig;
    ch.rootOffset.copy(offset);
    rig.refreshBone(ch, 0);
    if (pins.length) {
      // keep every pinned leg within its reach: not longer than the straight leg,
      // not shorter than the knee flexion limit allows (the pelvis stops, feet never slide)
      for (let it = 0; it < 4; it++) {
        let worst = 0;
        _c.set(0, 0, 0);
        for (const p of pins) {
          rig.worldPos(ch, p.chain.upper, _S);
          const A = this._raisedAnkle(p, _W);
          const d = _S.distanceTo(A);
          const dmin = this._minReach(ch, p);
          if (d > p.reach * 0.995) {
            const e = d - p.reach * 0.995;
            if (e > worst) { worst = e; _c.subVectors(A, _S).normalize().multiplyScalar(e); }
          } else if (d < dmin) {
            const e = dmin - d;
            if (e > worst) { worst = e; _c.subVectors(_S, A).normalize().multiplyScalar(e); }
          }
        }
        if (worst < 1e-5) break;
        // world delta -> rig space delta
        _inv.copy(ch.rig.matrixWorld).invert();
        _a.set(0, 0, 0).applyMatrix4(_inv);
        _b.copy(_c).applyMatrix4(_inv).sub(_a);
        ch.rootOffset.add(_b);
        rig.refreshBone(ch, 0);
      }
      for (const p of pins) this.solvePinned(ch, p);
    }
  }

  /**
   * Pin record for a leg at its current place: ankle position + foot rotation
   * (world), the ball of the foot (pivot of the heel raise) and the toe flexion.
   * If the foot is still where the last pinned solve left it with a raised heel,
   * the flat pin is reused so the heel can come back down.
   */
  pin(ch, side) {
    const rig = this.rig, chain = this.chains['foot.' + side];
    const pos = rig.worldPos(ch, chain.end, new THREE.Vector3());
    const quat = rig.worldQuat(ch, chain.end, new THREE.Quaternion());
    const plants = this._plants.get(ch);
    const prev = plants?.[side];
    if (prev && prev.raise > 1e-4 && prev.lastPos.distanceTo(pos) < 1e-3 && prev.lastQuat.angleTo(quat) < 1e-3) return prev;
    const L1 = rig.worldPos(ch, chain.upper, _S).distanceTo(rig.worldPos(ch, chain.lower, _E));
    const L2 = _E.distanceTo(pos);
    const toes = this.controls.get('toes.' + side);
    const ballIdx = rig.model.boneIndex.get('toe3-1.' + side);
    const m = ch.bones[chain.end].matrixWorld;
    const pin = {
      side, chain, pos, quat, reach: L1 + L2, L1, L2,
      ball: rig.worldPos(ch, ballIdx, new THREE.Vector3()),
      // plantar-flexion axis of the foot in world (anatomical sign of the foot 'flex' axis: -X)
      axis: new THREE.Vector3().setFromMatrixColumn(m, 0).normalize().multiplyScalar(-1),
      toes, toeFlex0: rig.read(ch, toes, 0), raise: 0,
      lastPos: pos.clone(), lastQuat: quat.clone(),
    };
    if (!plants) this._plants.set(ch, { [side]: pin }); else plants[side] = pin;
    return pin;
  }

  /** ankle target of a pin including its current heel raise (world) */
  _raisedAnkle(pin, out) {
    if (!(pin.raise > 0)) return out.copy(pin.pos);
    _q.setFromAxisAngle(pin.axis, pin.raise);
    return out.copy(pin.pos).sub(pin.ball).applyQuaternion(_q).add(pin.ball);
  }

  /** shortest hip-ankle distance the knee flexion limit allows (world units) */
  _minReach(ch, pin) {
    const lim = this.rig.limitsOf(ch, pin.chain.cLower, 0);
    if (!lim) return Math.abs(pin.L1 - pin.L2);
    const flexMax = lim[1] + this.rig.offset(ch, pin.chain.cLower, pin.chain.cLower.axes[0]);
    return Math.sqrt(Math.max(0, pin.L1 * pin.L1 + pin.L2 * pin.L2 + 2 * pin.L1 * pin.L2 * Math.cos(flexMax))) * 1.01;
  }

  /**
   * Solves a pinned leg. When the ankle cannot dorsiflex enough (limits on),
   * the heel rises: the foot pivots about the ball of the foot and the toes
   * extend to stay flat on the floor (natural deep squat / kneeling).
   */
  solvePinned(ch, pin) {
    const rig = this.rig, chain = pin.chain, foot = chain.cEnd;
    let raise = 0;
    for (let it = 0; it < 4; it++) {
      const pos = _tPos, quat = _tQuat;
      if (raise > 0) {
        _q.setFromAxisAngle(pin.axis, raise);
        pos.copy(pin.pos).sub(pin.ball).applyQuaternion(_q).add(pin.ball);
        quat.copy(_q).multiply(pin.quat);
      } else { pos.copy(pin.pos); quat.copy(pin.quat); }
      this.solveLimb(ch, chain, pos, quat, 3);
      const lim = rig.limitsOf(ch, foot, 0);
      if (!lim) break;
      const lo = lim[0]; // (shared scratch array)
      // ankle flexion the target orientation would need (unclamped)
      _q2.copy(ch.poseQuat[chain.end]);
      rig.setWorldQuat(ch, chain.end, quat);
      const need = rig.read(ch, foot, 0);
      ch.poseQuat[chain.end].copy(_q2);
      if (need < lo - 0.004) raise += lo - need;
      else if (raise > 0 && need > lo + 0.004) raise = Math.max(0, raise - (need - lo));
      else break;
    }
    if (raise > 0 || pin.raise > 0) {
      rig.write(ch, pin.toes, 0, pin.toeFlex0 - raise);
      rig.refreshControl(ch, pin.toes);
    }
    pin.raise = raise;
    rig.worldPos(ch, chain.end, pin.lastPos);
    rig.worldQuat(ch, chain.end, pin.lastQuat);
  }
}
