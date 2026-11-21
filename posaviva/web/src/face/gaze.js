// Eye gaze. Eye bones (eye.L / eye.R, children of `head`) have, measured on the
// rest frames: local +Y = gaze axis (forward), +X = character's left, +Z = down.
// A gaze (yaw, pitch) in an eye's rest-local frame is therefore
//   q = Rz(-yaw) * Rx(-pitch)      (yaw > 0 looks to the character's left, pitch > 0 up)
// and is written to the bone with ch.setBoneRotationSilent (no 'pose' storms).
//
// Every gaze mode reduces to "look at a point":
//   free   : a virtual point 1.5 m away in the head's frame, from the pad (gx, gy)
//   camera : the camera position (world)
//   point  : a world point chosen by tapping the scene
// so both eyes converge naturally. Per-eye limits: yaw +-35 deg, pitch -25..+18 deg
// (the MakeHuman upper lid retracts little: beyond ~18 deg up the iris disappears
// under it and the eyes look rolled back).
import * as THREE from 'three';

export const YAW_MAX = 35 * Math.PI / 180;
export const PITCH_MAX = 25 * Math.PI / 180;
/** upward limit (see above) */
export const PITCH_UP = 18 * Math.PI / 180;
/** focus distance of the free gaze (m): slight, natural convergence */
const FREE_FOCUS = 1.5;

const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _h = new THREE.Matrix4();
const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _e = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1);

/** Per-model indices (eye bones, head, chain root -> head). */
const _info = new WeakMap();
function info(model) {
  let I = _info.get(model);
  if (!I) {
    const head = model.boneIndex.get('head');
    const chain = [];
    for (let i = head; i >= 0; i = model.bones[i].parent) chain.unshift(i);
    I = { head, eyes: [model.boneIndex.get('eye.L'), model.boneIndex.get('eye.R')], chain };
    _info.set(model, I);
  }
  return I;
}

/** Quaternion (eye rest-local frame) for yaw / pitch in radians. */
export function gazeQuat(yaw, pitch, out = new THREE.Quaternion()) {
  _qa.setFromAxisAngle(AZ, -yaw);
  _qb.setFromAxisAngle(AX, -pitch);
  return out.multiplyQuaternions(_qa, _qb);
}

/**
 * Aims both eyes at a point given in the head bone's local frame.
 * Returns true if a bone rotation actually changed.
 */
export function aimHeadLocal(ch, T) {
  const I = info(ch.model);
  let changed = false;
  for (const i of I.eyes) {
    // eye rest transform relative to the head (independent of the current eye rotation)
    _m.compose(ch.restLocalPos[i], ch.restLocalQuat[i], _one);
    _v.copy(T).applyMatrix4(_mi.copy(_m).invert());
    const yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, Math.atan2(_v.x, _v.y)));
    const pitch = Math.max(-PITCH_MAX, Math.min(PITCH_UP, Math.atan2(-_v.z, Math.hypot(_v.x, _v.y))));
    gazeQuat(yaw, pitch, _q);
    if (Math.abs(_q.dot(ch.poseQuat[i])) < 0.9999999) {
      ch.setBoneRotationSilent(ch.bones[i].name, _q);
      changed = true;
    }
  }
  return changed;
}

/** Head-local target point of the free gaze (gx, gy in [-1, 1]: yaw / pitch fractions). */
export function freeTarget(ch, gx, gy, out = new THREE.Vector3()) {
  const I = info(ch.model);
  const yaw = gx * YAW_MAX, pitch = gy * (gy > 0 ? PITCH_UP : PITCH_MAX);
  // mid-eye point and face axes in rig rest space (X left, Y up, Z forward)
  _e.setFromMatrixPosition(ch.restGlobal[I.eyes[0]]).add(_t.setFromMatrixPosition(ch.restGlobal[I.eyes[1]])).multiplyScalar(0.5);
  out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(FREE_FOCUS).add(_e);
  return out.applyMatrix4(_mi.copy(ch.restGlobal[I.head]).invert());
}

/**
 * Fresh world matrix of the head bone (does not rely on matrixWorld being
 * current: the root may have been moved since the last render).
 */
export function headWorldMatrix(ch, out = new THREE.Matrix4()) {
  const I = info(ch.model);
  ch.root.updateWorldMatrix(true, false);
  out.multiplyMatrices(ch.root.matrixWorld, ch.rig.matrix);
  for (const i of I.chain) out.multiply(ch.bones[i].matrix);
  return out;
}

/** World point -> head-local (fresh matrices). */
export function worldToHead(ch, p, out = new THREE.Vector3()) {
  headWorldMatrix(ch, _h);
  return out.copy(p).applyMatrix4(_mi.copy(_h).invert());
}

/** Current gaze of the left eye as pad coordinates (approximate inverse, for the UI). */
export function currentPad(ch) {
  const I = info(ch.model);
  const q = ch.poseQuat[I.eyes[0]];
  _v.set(0, 1, 0).applyQuaternion(q);
  const pitch = Math.atan2(-_v.z, Math.hypot(_v.x, _v.y));
  return [Math.atan2(_v.x, _v.y) / YAW_MAX, pitch / (pitch > 0 ? PITCH_UP : PITCH_MAX)];
}

/** Mid-eye world position (fresh). */
export function eyesWorld(ch, out = new THREE.Vector3()) {
  const I = info(ch.model);
  headWorldMatrix(ch, _h);
  _e.setFromMatrixPosition(ch.restGlobal[I.eyes[0]]).add(_t.setFromMatrixPosition(ch.restGlobal[I.eyes[1]])).multiplyScalar(0.5);
  // rest rig -> head-local -> world
  return out.copy(_e).applyMatrix4(_mi.copy(ch.restGlobal[I.head]).invert()).applyMatrix4(_h);
}
