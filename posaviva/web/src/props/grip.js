// Hand grip geometry, derived from the character's rest joints so it fits
// every body type and follows shape changes.
//
// Fist frame (rig rest space, then expressed in the wrist bone frame):
//   origin = center of the hole of a closed fist (palm side of the knuckle row)
//   +Y     = handle axis, exiting on the thumb / index side (slightly tilted
//            toward the fingers, as a real handle crosses the palm diagonally)
//   +Z     = knuckle direction (wrist -> metacarpo-phalangeal joints)
//   +X     = palm normal, pointing OUT of the palm
// Because +X is "out of the palm" on both hands, the right-hand frame is a
// mirror image (det = -1) of the left one: held props are mirrored on the right
// hand, exactly like hands are. three.js handles negative-determinant
// transforms (culling, normals, shadows) transparently.
import * as THREE from 'three';

const _K = new THREE.Vector3(), _W = new THREE.Vector3(), _f = new THREE.Vector3(), _a = new THREE.Vector3();
const _n = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _o = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Reference distance wrist -> knuckles of the default body (hand size normalization). */
const REF_HAND = 0.092;
/** Fist hole center relative to the knuckle row, in reference-hand meters. */
const FIST_BACK = 0.006; // toward the wrist
const FIST_PALM = 0.019; // out of the palm: the palm skin is ~1.7 cm from the knuckle axis
const HANDLE_TILT = 0.28; // handle axis = across-hand + tilt * finger direction

function joint(ch, boneName, end = 'head') {
  const i = ch.model.boneIndex.get(boneName);
  if (i === undefined) return null;
  return ch.jointPositions.get(ch.model.bones[i][end]) || null;
}

/** Palm basis of one hand in rig rest space. Returns false if the rig lacks hand joints. */
function palmBasis(ch, side) {
  const W = joint(ch, `wrist.${side}`);
  const k2 = joint(ch, `finger2-1.${side}`), k3 = joint(ch, `finger3-1.${side}`), k4 = joint(ch, `finger4-1.${side}`), k5 = joint(ch, `finger5-1.${side}`);
  if (!W || !k2 || !k3 || !k4 || !k5) return false;
  _W.copy(W);
  _K.copy(k2).add(k3).add(k4).add(k5).multiplyScalar(0.25);
  _f.subVectors(_K, _W);
  const handLen = _f.length();
  _f.normalize();
  _a.subVectors(k2, k5).normalize(); // pinky -> index
  // palm normal: (f x a) points out of the LEFT palm (verified against the thumb
  // position on the rest mesh); mirrored on the right hand.
  _n.crossVectors(_f, _a).normalize();
  if (side === 'R') _n.negate();
  return handLen;
}

/**
 * Fist frame of `side` ('L' | 'R') as a matrix in the wrist bone's local space.
 * @returns {THREE.Matrix4|null}
 */
export function fistFrame(ch, side, out = new THREE.Matrix4()) {
  const handLen = palmBasis(ch, side);
  const wi = ch.model.boneIndex.get(`wrist.${side}`);
  if (!handLen || wi === undefined) return null;
  const hs = handLen / REF_HAND;
  // handle axis in the palm plane, tilted toward the fingers
  _y.copy(_a).addScaledVector(_f, HANDLE_TILT);
  _y.addScaledVector(_n, -_y.dot(_n)).normalize();
  _z.copy(_f).addScaledVector(_y, -_f.dot(_y)).addScaledVector(_n, -_f.dot(_n)).normalize();
  _o.copy(_K).addScaledVector(_f, -FIST_BACK * hs).addScaledVector(_n, FIST_PALM * hs);
  _m.makeBasis(_n, _y, _z).setPosition(_o);
  return out.copy(ch.restGlobal[wi]).invert().multiply(_m);
}

// ---------------------------------------------------------------------------- adaptive grip
// Closes the hand around the held object:
//  - fingers 2..5: every joint (base to tip) bends about its anatomical hinge
//    axis until the next joint / the fingertip touches the handle cylinder
//    (radius + finger thickness). Works for any handle radius and body type.
//  - thumb: a few CCD iterations bring its tip onto the far side of the handle
//    (over the index finger), as in a power grip; flat objects (phone, book)
//    give their own thumb target (on the face away from the palm).

const FINGER_R = 0.0085; // finger half thickness (reference hand, meters)
const THUMB_R = 0.0095;
/** per joint (1..3) bend limits, radians */
const FINGER_LIMITS = [[-0.35, 1.75], [-0.1, 1.95], [-0.1, 1.45]];
const THUMB_MAX = [0.9, 1.1, 1.4]; // max rotation per thumb joint
const SCAN_STEP = 0.06;

const _fist = new THREE.Matrix4(), _W2 = new THREE.Matrix4(), _Wi = new THREE.Matrix4();
const _lp = new THREE.Vector3(), _ld = new THREE.Vector3(), _nw = new THREE.Vector3(), _zw = new THREE.Vector3();
const _cp = new THREE.Vector3(), _jp = new THREE.Vector3(), _wq = new THREE.Quaternion(), _tg = new THREE.Vector3();
const _base = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _axl = new THREE.Vector3(), _tmp = new THREE.Vector3(), _tmp2 = new THREE.Vector3();
const _restN = new THREE.Vector3(), _m3 = new THREE.Matrix3(), _ry = new THREE.Vector3();

/** distance of point p to the handle axis line (_lp, _ld) */
function distToAxis(p) {
  _tmp.subVectors(p, _lp);
  return _tmp.addScaledVector(_ld, -_tmp.dot(_ld)).length();
}

/**
 * Wraps the fingers of `side` around a cylinder of `radius` meters lying on the
 * fist frame's handle axis (offset `radius` out of the palm, as held props are).
 * opts.base(): optional starting hand pose (e.g. a pose-library preset) applied
 * to ch.poseQuat before solving; default = open hand.
 * opts.thumb: optional thumb tip target [x, y, z] in fist coordinates (meters).
 * Calls ch.applyPose() once at the end.
 */
export function wrapHand(ch, side, radius, { base = null, thumb = null } = {}) {
  const F = fistFrame(ch, side, _fist);
  const wrist = ch.boneByName.get(`wrist.${side}`);
  if (!F || !wrist) return false;
  _restN.copy(_n); // palm normal, rig rest space (left by fistFrame -> palmBasis)
  const bi = ch.model.boneIndex;
  const B = (name) => { const i = bi.get(`${name}.${side}`); return i === undefined ? -1 : i; };
  const fingerBones = [];
  for (let f = 1; f <= 5; f++) for (let j = 1; j <= 3; j++) { const i = B(`finger${f}-${j}`); if (i >= 0) fingerBones.push(i); }
  for (const i of fingerBones) ch.poseQuat[i].identity();
  if (base) base();
  for (const i of fingerBones) ch.bones[i].quaternion.copy(ch.restLocalQuat[i]).multiply(ch.poseQuat[i]);
  ch.rig.updateMatrixWorld(true);

  // handle axis in world space; the character scale applies to the hand, not to the prop
  const s = ch.root.scale.x || 1;
  _W2.multiplyMatrices(wrist.matrixWorld, F);
  _nw.setFromMatrixColumn(_W2, 0).normalize();
  _ld.setFromMatrixColumn(_W2, 1).normalize();
  _zw.setFromMatrixColumn(_W2, 2).normalize();
  _lp.setFromMatrixPosition(_W2).addScaledVector(_nw, radius);
  const hs = (palmBasis(ch, side) / REF_HAND) * s;

  const boneLen = (i) => {
    const b = ch.model.bones[i];
    return ch.jointPositions.get(b.head).distanceTo(ch.jointPositions.get(b.tail));
  };
  const endOf = (i, j, f, out) => {
    const next = j < 3 ? B(`finger${f}-${j + 1}`) : -1;
    if (next >= 0) return ch.bones[next].getWorldPosition(out);
    return out.set(0, boneLen(i), 0).applyMatrix4(ch.bones[i].matrixWorld);
  };
  const setDelta = (i, axisLocal, t) => {
    ch.poseQuat[i].copy(_base).multiply(_dq.setFromAxisAngle(axisLocal, t));
    ch.bones[i].quaternion.copy(ch.restLocalQuat[i]).multiply(ch.poseQuat[i]);
    ch.bones[i].updateMatrixWorld(true);
  };

  // ---- fingers: hinge axis from the rest frame (stays valid while the finger curls)
  for (let f = 2; f <= 5; f++) {
    for (let j = 1; j <= 3; j++) {
      const i = B(`finger${f}-${j}`);
      if (i < 0) continue;
      const R = ch.restGlobal[i];
      _ry.setFromMatrixColumn(R, 1).normalize();
      _axl.crossVectors(_ry, _restN);
      if (_axl.lengthSq() < 1e-10) continue;
      _axl.applyMatrix3(_m3.setFromMatrix4(R).transpose()).normalize(); // rig -> bone rest-local
      _base.copy(ch.poseQuat[i]);
      const target = radius + FINGER_R * hs;
      const [lo, hi] = FINGER_LIMITS[j - 1];
      const dAt = (t) => { setDelta(i, _axl, t); return distToAxis(endOf(i, j, f, _cp)); };
      const solve = () => {
        let prevT = lo, best = lo, bestD = dAt(lo), hit = bestD <= target ? lo : null;
        if (hit === null) {
          for (let t = lo + SCAN_STEP; t <= hi + 1e-6; t += SCAN_STEP) {
            const d = dAt(t);
            if (d < bestD) { bestD = d; best = t; }
            if (d <= target) { hit = t; break; }
            prevT = t;
          }
        }
        if (hit !== null && hit > lo) {
          let a = prevT, b = hit;
          for (let k = 0; k < 7; k++) { const m = (a + b) / 2; if (dAt(m) > target) a = m; else b = m; }
          return { t: (a + b) / 2, lo: false };
        }
        return hit === lo ? { t: Math.max(lo, 0), lo: true } : { t: best, lo: false };
      };
      let r = solve();
      // the starting pose (a hand preset made for a thinner handle) already bends this joint
      // into a thick body (a cup, a bottle): solve it again from a straight joint instead,
      // so the finger rests on the surface rather than through it
      if (r.lo && dAt(0) < target - 0.002 && Math.abs(_base.w) < 0.99999) { _base.identity(); r = solve(); }
      setDelta(i, _axl, r.t);
    }
  }

  // ---- thumb: CCD toward a target in fist coordinates
  const th = [B('finger1-1'), B('finger1-2'), B('finger1-3')];
  if (th.every((i) => i >= 0)) {
    _Wi.copy(_W2).invert();
    if (thumb) _tg.set(thumb[0] / s, thumb[1] / s, thumb[2] / s).applyMatrix4(_W2);
    else {
      // on the handle surface, wrist side of the axis, level with the index finger. A thin
      // handle: over the far side (a power grip); a thick body (a cup, a bottle, a vase): on
      // its side, where the thumb reaches (aimed at the far side it would cut through the body)
      const k2 = ch.bones[B('finger2-1')];
      const ky = k2 ? k2.getWorldPosition(_tmp2).applyMatrix4(_Wi).y : 0.02 / s;
      const Rt = radius + THUMB_R * hs, a = -0.6 - THREE.MathUtils.clamp((radius / hs - 0.02) / 0.025, 0, 1) * 0.95;
      _tg.copy(_lp).addScaledVector(_nw, Rt * Math.cos(a)).addScaledVector(_zw, Rt * Math.sin(a)).addScaledVector(_ld, ky * 0.55 * s);
    }
    const tipLen = boneLen(th[2]);
    const tip = (out) => out.set(0, tipLen, 0).applyMatrix4(ch.bones[th[2]].matrixWorld);
    const bases = th.map((i) => ch.poseQuat[i].clone());
    for (let it = 0; it < 12; it++) {
      for (let k = 2; k >= 0; k--) {
        const i = th[k], bone = ch.bones[i];
        bone.getWorldPosition(_jp);
        tip(_cp);
        _tmp.subVectors(_cp, _jp); _tmp2.subVectors(_tg, _jp);
        if (_tmp.lengthSq() < 1e-12 || _tmp2.lengthSq() < 1e-12) continue;
        _tmp.normalize(); _tmp2.normalize();
        const ang = Math.min(0.35, Math.acos(THREE.MathUtils.clamp(_tmp.dot(_tmp2), -1, 1)));
        if (ang < 1e-4) continue;
        _axl.crossVectors(_tmp, _tmp2);
        if (_axl.lengthSq() < 1e-12) continue;
        bone.getWorldQuaternion(_wq);
        _axl.applyQuaternion(_wq.invert()).normalize();
        ch.poseQuat[i].multiply(_dq.setFromAxisAngle(_axl, ang));
        // joint limit: total rotation from the starting pose
        _dq.copy(bases[k]).invert().multiply(ch.poseQuat[i]);
        const total = 2 * Math.acos(Math.min(1, Math.abs(_dq.w)));
        if (total > THUMB_MAX[k]) ch.poseQuat[i].copy(bases[k]).multiply(_dq.slerp(_base.identity(), 1 - THUMB_MAX[k] / total));
        bone.quaternion.copy(ch.restLocalQuat[i]).multiply(ch.poseQuat[i]);
        bone.updateMatrixWorld(true);
      }
    }
  }
  ch.applyPose();
  return true;
}
