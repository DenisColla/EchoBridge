// Pose & hand preset library (data + helpers). Contract used by the posing UI:
//   POSE_CATEGORIES, POSE_PRESETS, HAND_PRESETS, PRESERVED_BONES,
//   applyPosePreset, applyHandPreset, mirrorPose (+ getPosePreset, getHandPreset, HAND_BONES)
// Pose format = Character.getPose(): {bones:{boneName:[x,y,z,w]}, root:[x,y,z]} with
// rotations in each bone's rest-local frame (see ARCHITECTURE.md).
//
// The presets are AUTHORED in a readable form (library-data/*.js: Euler degrees per
// joint, a few anatomical macros) and compiled once, at module load, into that format.
//
// ---------------------------------------------------------------------------------
// Bone-local axes (measured empirically on f_normal: single-bone rotations rendered
// front / side / top). Rest pose = A-pose: arms 45° down, elbows ~40° flexed with the
// forearms pointing forward, palms facing the thighs / down. Bone frames: +Y runs
// along the bone (head -> tail), X is the normal of MakeHuman's rotation plane,
// Z = X × Y. Euler angles are applied in intrinsic 'ZXY' order (Z first, then X,
// then the twist about the bone itself, Y). All values are written for the LEFT
// side; a right-side bone receives the mirrored rotation (x,y,z,w) -> (x,-y,-z,w),
// so a symmetric pose uses identical numbers on both sides.
//
//   root           X+ whole body leans back        Y+ rolls to its right (left side up)
//                  Z+ turns to its left (yaw)       (root: +Y = forward, +Z = up)
//   spine05..01,   X+ extension (lean back / look up), X- flexion (bend forward / nod)
//   neck01..03,    Y+ twist toward the character's left
//   head           Z+ side bend toward the character's left (left ear to shoulder)
//   clavicle       X+ shoulder back (retraction)    X- forward (protraction)
//                  Z+ shoulder down                 Z- shrug (elevation)
//   shoulder01,    Z- raise sideways: rest is 45° down, so Z+40 ≈ arm along the
//   upperarm01       body, Z-45 = horizontal, Z-135 = vertical (share the last
//                    part with clavicle / shoulder01 for a natural shoulder)
//                  X- swing forward (flexion)       X+ swing back (extension)
//                  Y+ internal rotation             Y- external rotation
//   upperarm02     twist bone: Y as upperarm01 (humeral twist is split 50/50)
//   lowerarm01     X- elbow flexion (rest ≈ 40° flexed: X+40 = straight, X-50 ≈ 90°)
//   lowerarm02     Y- supination (palm turns forward / up), Y+ pronation; the
//                    forearm twist is split 35% lowerarm01 / 65% lowerarm02
//   wrist          Z+ flexion (toward the palm)     Z- extension (back of the hand)
//                  X+ ulnar deviation (pinky side)  X- radial deviation (thumb side)
//                  (local -X is the palm normal of the left hand)
//   finger2..5-n   X- curl (flexion)                Z+ toward the pinky side
//   metacarpal1..4 X- cups the palm
//   finger1-1      thumb CMC: X- across the palm toward the fingers, X+ back/out;
//                  Z- spreads away from the index in the palm plane, Z+ toward it;
//                  Y+ turns the pad toward the fingers (opposition)
//   finger1-2, 1-3 X- flexion
//   upperleg01     X+ hip flexion (leg forward)     X- extension (leg back)
//                  Z+ abduction (out)               Z- adduction
//                  Y+ internal rotation (toes in)   Y- external rotation
//   upperleg02     twist bone: Y as upperleg01 (thigh twist split 50/50)
//   lowerleg01     X- knee flexion
//   foot           X+ dorsiflexion (toes up)        X- plantar flexion (pointed)
//                  Z+ toes outward                  Y+ inversion (sole inward)
//   toe1..5-1      X+ up                            X- curl
//   pelvis.L/R     hip "bones" (unused by presets: root + spine do the pelvis)
// ---------------------------------------------------------------------------------
import * as THREE from 'three';
import { HAND_DEFS } from './library-data/hands.js';
import { POSE_DEFS } from './library-data/poses.js';

export const POSE_CATEGORIES = [
  { id: 'stand', label: 'In piedi' },
  { id: 'action', label: 'Azione' },
  { id: 'fight', label: 'Combattimento' },
  { id: 'sit', label: 'Seduti' },
  { id: 'floor', label: 'A terra' },
  { id: 'gesture', label: 'Gesti' },
];

/** Bones owned by other modules that presets must never overwrite. */
export const PRESERVED_BONES = ['eye.L', 'eye.R'];

/** Bones of one hand driven by hand presets (no side suffix). */
export const HAND_BONES = [
  'metacarpal1', 'metacarpal2', 'metacarpal3', 'metacarpal4',
  'finger1-1', 'finger1-2', 'finger1-3', 'finger2-1', 'finger2-2', 'finger2-3', 'finger3-1', 'finger3-2', 'finger3-3',
  'finger4-1', 'finger4-2', 'finger4-3', 'finger5-1', 'finger5-2', 'finger5-3',
];

/**
 * Root (hip) height of the authoring body (f_normal, measured: rest root joint at
 * 0.872 m). Root offsets of the presets are scaled by rootHeight / HIP_REF so they
 * fit every body type.
 */
export const HIP_REF = 0.872;

// ================================================================= compiler
const DEG = Math.PI / 180;
const _e = new THREE.Euler();
const _qa = new THREE.Quaternion();

/**
 * Quaternion of local Euler degrees, intrinsic order Z, X, Y by default (or 'XZY':
 * flex first, then abduct about the flexed bone; the twist Y is always last);
 * mirrored for the right side.
 */
function eulerQuat(x, y, z, mirror, out = new THREE.Quaternion(), order = 'ZXY') {
  out.setFromEuler(_e.set(x * DEG, y * DEG, z * DEG, order));
  if (mirror) out.set(out.x, -out.y, -out.z, out.w);
  return out;
}

/** Accumulates rotations per bone (later contributions are applied after earlier ones). */
class BoneAcc {
  constructor() { this.map = new Map(); }
  add(name, x, y, z, mirror, order) {
    if (!x && !y && !z) return;
    const q = eulerQuat(x, y, z, mirror, _qa, order);
    const cur = this.map.get(name);
    if (cur) cur.multiply(q); else this.map.set(name, q.clone());
  }
  addQuat(name, q) {
    const cur = this.map.get(name);
    if (cur) cur.multiply(q); else this.map.set(name, q.clone());
  }
  toObject() {
    const out = {};
    for (const [n, q] of this.map) {
      q.normalize();
      if (Math.abs(q.w) > 0.9999995) continue;
      out[n] = [+q.x.toFixed(6), +q.y.toFixed(6), +q.z.toFixed(6), +q.w.toFixed(6)];
    }
    return out;
  }
}

// ---------------------------------------------------------------- hands
/** finger curl definition -> bones of one finger (left-hand convention). */
function addFinger(acc, n, def, sign, sfx, mirror) {
  if (!def) return;
  const [mcp = 0, pip = 0, dip = 0, spread = 0] = def;
  acc.add(`finger${n}-1${sfx}`, -mcp, 0, sign * spread, mirror);
  acc.add(`finger${n}-2${sfx}`, -pip, 0, 0, mirror);
  acc.add(`finger${n}-3${sfx}`, -dip, 0, 0, mirror);
}

/** Writes a hand definition (HAND_DEFS format) into an accumulator. */
function addHandDef(acc, def, sfx = '', mirror = false) {
  // spread sign: index toward the thumb is local Z-, ring / pinky toward the ulnar side Z+
  addFinger(acc, 2, def.i, -1, sfx, mirror);
  addFinger(acc, 3, def.m, 1, sfx, mirror);
  addFinger(acc, 4, def.r, 1, sfx, mirror);
  addFinger(acc, 5, def.p, 1, sfx, mirror);
  if (def.t) {
    const [x = 0, y = 0, z = 0, f2 = 0, f3 = 0] = def.t;
    acc.add(`finger1-1${sfx}`, x, y, z, mirror);
    acc.add(`finger1-2${sfx}`, -f2, 0, 0, mirror);
    acc.add(`finger1-3${sfx}`, -f3, 0, 0, mirror);
  }
  const cup = def.cup || 0;
  if (cup) [0, 0.35, 0.7, 1].forEach((k, j) => acc.add(`metacarpal${j + 1}${sfx}`, -cup * k, 0, 0, mirror));
}

/** [{id, label, bones:{'finger1-1':[x,y,z,w], ...}}] rotations for the LEFT hand, bone names WITHOUT side suffix */
export const HAND_PRESETS = HAND_DEFS.map((def) => {
  const acc = new BoneAcc();
  addHandDef(acc, def);
  const bones = acc.toObject();
  // complete: every hand bone listed (identity when not moved) so presets fully replace each other
  for (const b of HAND_BONES) if (!bones[b]) bones[b] = [0, 0, 0, 1];
  return { id: def.id, label: def.label, bones };
});
const HAND_BY_ID = new Map(HAND_PRESETS.map((p) => [p.id, p]));
const HAND_DEF_BY_ID = new Map(HAND_DEFS.map((d) => [d.id, d]));

// ---------------------------------------------------------------- bodies
// Distributed chains: per bone [wx, wy, wz] share of the macro's [x, y, z].
// Flexion / side bending spread over the lumbar + thoracic spine, twist mostly
// thoracic (as in a real spine); the neck carries the base of a head movement.
const CHAINS = {
  spine: [['spine05', [0.10, 0.04, 0.12]], ['spine04', [0.20, 0.12, 0.22]], ['spine03', [0.24, 0.20, 0.24]], ['spine02', [0.24, 0.30, 0.22]], ['spine01', [0.22, 0.34, 0.20]]],
  neck: [['neck01', [0.40, 0.36, 0.40]], ['neck02', [0.34, 0.34, 0.34]], ['neck03', [0.26, 0.30, 0.26]]],
};
const ALIAS = { clav: 'clavicle', sh: 'shoulder01' };
const META = new Set(['id', 'label', 'cat', 'ground', 'air', 'offset', 'note', 'touch']);

function vec3(v) { return typeof v === 'number' ? [v, 0, 0] : [v[0] || 0, v[1] || 0, v[2] || 0]; }
/** optional 4th element of a joint value: Euler order ('ZXY' default, 'XZY') */
function orderOf(v) { return Array.isArray(v) && typeof v[3] === 'string' ? v[3] : 'ZXY'; }

/** Expands one authoring key (already resolved to a single side) into bone rotations. */
function addJoint(acc, base, sfx, value, mirror) {
  if (base === 'hand') {
    const [id, amount = 1] = Array.isArray(value) ? value : [value, 1];
    const def = HAND_DEF_BY_ID.get(id);
    if (!def) { console.warn('[poselib] unknown hand preset', id); return; }
    const tmp = new BoneAcc();
    addHandDef(tmp, def, sfx, mirror);
    for (const [n, q] of tmp.map) acc.addQuat(n, amount >= 1 ? q : _qa.identity().slerp(q, amount));
    return;
  }
  const [x, y, z] = vec3(value);
  const o = orderOf(value);
  // twist splits: the twist (Y) is the last intrinsic rotation, so giving part of it
  // to the child twist bone leaves the end orientation unchanged
  switch (base) {
    case 'spine': case 'neck':
      for (const [bone, w] of CHAINS[base]) acc.add(bone, x * w[0], y * w[1], z * w[2], mirror, o);
      return;
    case 'arm': // upper arm with the humeral twist split over the twist bone
      acc.add(`upperarm01${sfx}`, x, y * 0.5, z, mirror, o);
      acc.add(`upperarm02${sfx}`, 0, y * 0.5, 0, mirror);
      return;
    case 'fore': // elbow flexion + forearm pronation / supination (mostly distal)
      acc.add(`lowerarm01${sfx}`, x, y * 0.35, z, mirror, o);
      acc.add(`lowerarm02${sfx}`, 0, y * 0.65, 0, mirror);
      return;
    case 'thigh':
      acc.add(`upperleg01${sfx}`, x, y * 0.5, z, mirror, o);
      acc.add(`upperleg02${sfx}`, 0, y * 0.5, 0, mirror);
      return;
    case 'knee':
      acc.add(`lowerleg01${sfx}`, x, y * 0.5, z, mirror, o);
      acc.add(`lowerleg02${sfx}`, 0, y * 0.5, 0, mirror);
      return;
    case 'toes':
      for (let t = 1; t <= 5; t++) acc.add(`toe${t}-1${sfx}`, x, y, z, mirror, o);
      return;
    default:
      acc.add((ALIAS[base] || base) + sfx, x, y, z, mirror, o);
  }
}

/**
 * Compiles one authoring definition (library-data/poses.js format) into the
 * contract pose format {bones, root}. Exported for tools / user-made presets.
 */
export function compilePoseDef(def) {
  const acc = new BoneAcc();
  for (const [key, value] of Object.entries(def)) {
    if (META.has(key) || value == null) continue;
    const m = /^(.*)\.(L|R|LR)$/.exec(key);
    if (!m) { addJoint(acc, key, '', value, false); continue; }
    const [, base, side] = m;
    if (side !== 'R') addJoint(acc, base, '.L', value, false);
    if (side !== 'L') addJoint(acc, base, '.R', value, true);
  }
  return { bones: acc.toObject(), root: vec3(def.offset || [0, 0, 0]).map((v) => +v.toFixed(4)) };
}

/**
 * [{id, label, category, pose:{bones,root}, ground, air?, touch?}] — `ground` = drop to
 * floor after applying (unless false), `air` = meters above the floor after the drop,
 * `touch` = hand contacts re-targeted on every body type (see reachTouches).
 */
export const POSE_PRESETS = POSE_DEFS.map((def) => {
  const p = { id: def.id, label: def.label, category: def.cat, pose: compilePoseDef(def), ground: def.ground !== false };
  if (def.air) p.air = def.air;
  if (def.touch) p.touch = def.touch;
  return p;
});
const POSE_BY_ID = new Map(POSE_PRESETS.map((p) => [p.id, p]));

export function getPosePreset(id) { return POSE_BY_ID.get(id) || null; }
export function getHandPreset(id) { return HAND_BY_ID.get(id) || null; }

// ================================================================= runtime
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3(), _up = new THREE.Vector3(), _wq = new THREE.Quaternion();

/** Mirror a pose object left<->right ((x,y,z,w) -> (x,-y,-z,w), .L<->.R). */
export function mirrorPose(pose) {
  const out = { bones: {}, root: pose.root ? [-pose.root[0], pose.root[1], pose.root[2]] : [0, 0, 0] };
  for (const [name, q] of Object.entries(pose.bones || {})) {
    const m = name.endsWith('.L') ? name.slice(0, -2) + '.R' : name.endsWith('.R') ? name.slice(0, -2) + '.L' : name;
    out.bones[m] = [q[0], -q[1], -q[2], q[3]];
  }
  return out;
}

/** Bone transforms from poseQuat/rootOffset without firing 'pose' (internal two-pass apply). */
function updateBonesSilently(ch) {
  const bones = ch.bones;
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    b.position.copy(ch.restLocalPos[i]);
    if (i === 0) b.position.add(ch.rootOffset);
    b.quaternion.copy(ch.restLocalQuat[i]).multiply(ch.poseQuat[i]);
  }
  ch.root.updateMatrixWorld(true);
}

/** Lowest world-space Y of the skinned body (same measure as Character.dropToGround). */
function lowestBodyY(ch) {
  const M = ch.updateSkinMatrices();
  const R = ch.restPositions, SI = ch.model.skinIndex, SW = ch.model.skinWeight;
  const W = ch.rig.matrixWorld.elements;
  let minY = Infinity;
  for (const v of ch.model.groupVertices[0]) {
    const x = R[v * 3], y = R[v * 3 + 1], z = R[v * 3 + 2];
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = SW[v * 4 + k];
      if (!w) continue;
      const o = SI[v * 4 + k] * 16;
      ox += w * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
      oy += w * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
      oz += w * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
    }
    const wy = W[1] * ox + W[5] * oy + W[9] * oz + W[13];
    if (wy < minY) minY = wy;
  }
  return minY;
}

// ---------------------------------------------------------------- hand contacts
// Presets are authored on f_normal with plain FK. A hand resting on the body (hips,
// chin, thighs …) would sink into a bulkier body or float beside a slimmer one, so
// such presets carry `touch: {L|R: [vertex, standoff]}`: a body-mesh vertex (same
// topology on every body type, so it is the same anatomical landmark everywhere) and
// the distance of the palm point from the skin along the vertex normal (hand / fist
// half-thickness, f_normal meters). At apply time each hand is brought onto that
// landmark with an analytic two-bone IK (elbow hinge + upper-arm swing), which keeps
// the authored elbow direction and hand orientation.
const _P = new THREE.Vector3(), _S = new THREE.Vector3(), _E = new THREE.Vector3(), _W = new THREE.Vector3();
const _T = new THREE.Vector3(), _k = new THREE.Vector3(), _u = new THREE.Vector3(), _u2 = new THREE.Vector3();
const _es = new THREE.Vector3(), _tv = new THREE.Vector3(), _qa2 = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _mt = new THREE.Matrix4();
const MAX_REACH_FIX = 0.4; // meters: larger corrections mean a very unusual body, skip

function boneIdx(ch, name) { const i = ch.model.boneIndex.get(name); return i === undefined ? -1 : i; }
function bonePos(ch, i, out) { return out.setFromMatrixPosition(ch.bones[i].matrixWorld); }

/** Contact point of a hand (world): on the palm, between the wrist and the middle knuckle. */
function palmPoint(ch, side, out) {
  const w = boneIdx(ch, `wrist.${side}`), k = boneIdx(ch, `finger3-1.${side}`);
  bonePos(ch, w, out);
  return out.lerp(bonePos(ch, k, _tv), 0.6);
}

/** World position (and optionally normal) of a skinned body vertex (current bone matrices). */
function vertexWorld(ch, v, out, normalOut = null) {
  const SI = ch.model.skinIndex, SW = ch.model.skinWeight, R = ch.restPositions, N = ch.restNormals;
  out.set(0, 0, 0);
  if (normalOut) normalOut.set(0, 0, 0);
  for (let k = 0; k < 4; k++) {
    const w = SW[v * 4 + k];
    if (!w) continue;
    const b = SI[v * 4 + k];
    _mt.multiplyMatrices(ch.bones[b].matrixWorld, ch.skeleton.boneInverses[b]);
    out.addScaledVector(_tv.set(R[v * 3], R[v * 3 + 1], R[v * 3 + 2]).applyMatrix4(_mt), w);
    if (normalOut) normalOut.addScaledVector(_tv.set(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]).transformDirection(_mt), w);
  }
  if (normalOut) normalOut.normalize();
  return out;
}

const ARM_RE = /^(clavicle|shoulder01|upperarm|lowerarm|wrist|finger|metacarpal)/;
let _bodyCand = null; // body vertices usable as landmarks (not on the arms), per model
function landmarkVertices(model) {
  if (_bodyCand && _bodyCand.model === model) return _bodyCand.list;
  const list = [];
  for (const v of model.groupVertices[0]) {
    let best = -1, bw = 0;
    for (let k = 0; k < 4; k++) if (model.skinWeight[v * 4 + k] > bw) { bw = model.skinWeight[v * 4 + k]; best = model.skinIndex[v * 4 + k]; }
    if (best >= 0 && !ARM_RE.test(model.bones[best].name)) list.push(v, best);
  }
  _bodyCand = { model, list: Int32Array.from(list) };
  return _bodyCand.list;
}

/**
 * Authoring helper: nearest landmark for one hand in the current pose (use on
 * f_normal): the non-arm body vertex closest to the palm point, optionally limited to
 * vertices whose main bone matches `boneFilter` (RegExp). Returns [vertex, distance,
 * bone]; a preset's touch entry is [vertex, standoff].
 */
export function measureTouch(ch, side, boneFilter = null) {
  ch.root.updateMatrixWorld(true);
  palmPoint(ch, side, _P);
  const cand = landmarkVertices(ch.model);
  let bestV = -1, bestB = -1, bestD = Infinity;
  for (let i = 0; i < cand.length; i += 2) {
    if (boneFilter && !boneFilter.test(ch.model.bones[cand[i + 1]].name)) continue;
    const d = vertexWorld(ch, cand[i], _T).distanceToSquared(_P);
    if (d < bestD) { bestD = d; bestV = cand[i]; bestB = cand[i + 1]; }
  }
  return bestV < 0 ? null : [bestV, +Math.sqrt(bestD).toFixed(3), ch.model.bones[bestB].name];
}

const _mirrorCache = new WeakMap(); // model -> Map(v -> mirrored v)
/** Left/right symmetric body vertex (nearest to the mirrored base-mesh position; cached). */
function mirrorVertex(model, v) {
  let m = _mirrorCache.get(model);
  if (!m) _mirrorCache.set(model, (m = new Map()));
  if (m.has(v)) return m.get(v);
  const B = model.basePositions;
  const x = -B[v * 3], y = B[v * 3 + 1], z = B[v * 3 + 2];
  let best = -1, bd = Infinity;
  for (const w of model.groupVertices[0]) {
    const dx = B[w * 3] - x, dy = B[w * 3 + 1] - y, dz = B[w * 3 + 2] - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = w; }
  }
  m.set(v, best);
  return best;
}

/** Two-bone IK: moves the palm point of `side` to world `target` (bones already up to date). */
function reachArm(ch, side, target, scale) {
  const iU = boneIdx(ch, `upperarm01.${side}`), iL = boneIdx(ch, `lowerarm01.${side}`), iW = boneIdx(ch, `wrist.${side}`);
  if (iU < 0 || iL < 0 || iW < 0) return;
  for (let it = 0; it < 2; it++) {
    bonePos(ch, iU, _S); bonePos(ch, iL, _E); bonePos(ch, iW, _W);
    palmPoint(ch, side, _P);
    if (_P.distanceTo(target) < 0.002 * scale) return;
    if (it === 0 && _P.distanceTo(target) > MAX_REACH_FIX * scale) return;
    const Wt = _T.copy(target).sub(_P).add(_W); // wanted wrist position (palm offset kept)
    const a = _E.distanceTo(_S), b = _W.distanceTo(_E);
    // keep the elbow between ~8° and ~150° of flexion
    const dMax = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(8 * DEG));
    const dMin = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(150 * DEG));
    const d = Math.min(dMax, Math.max(dMin, Wt.distanceTo(_S)));
    // 1) elbow hinge: rotation about the forearm's rest X axis (through E) giving |W - S| = d
    ch.bones[iL].parent.getWorldQuaternion(_qa2).multiply(ch.restLocalQuat[iL]);
    _k.set(1, 0, 0).applyQuaternion(_qa2).normalize();
    _es.subVectors(_E, _S);
    _u.subVectors(_W, _E);
    const upar = _u.dot(_k);
    _u2.copy(_u).addScaledVector(_k, -upar); // u⊥
    const A = _es.dot(_u2), B = _es.dot(_tv.crossVectors(_k, _u2));
    const K = (d * d - _es.lengthSq() - _u.lengthSq()) / 2 - _es.dot(_k) * upar;
    const Rm = Math.hypot(A, B);
    if (Rm > 1e-9) {
      const phi = Math.atan2(B, A), c = Math.acos(Math.max(-1, Math.min(1, K / Rm)));
      let delta = phi + c, alt = phi - c;
      const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
      delta = wrap(delta); alt = wrap(alt);
      if (Math.abs(alt) < Math.abs(delta)) delta = alt;
      _qb.setFromAxisAngle(_tv.set(1, 0, 0), delta);
      ch.poseQuat[iL].premultiply(_qb);
      _u.applyAxisAngle(_k, delta);
      _W.copy(_E).add(_u);
    }
    // 2) swing the upper arm so the wrist points at the wanted position
    _u.subVectors(_W, _S).normalize();
    _u2.subVectors(Wt, _S).normalize();
    _qb.setFromUnitVectors(_u, _u2); // world-space swing
    ch.bones[iU].parent.getWorldQuaternion(_qa2).multiply(ch.restLocalQuat[iU]); // frame of poseQuat
    // pose' = F^-1 * swing * F * pose
    const F = _qa2, Fi = _q.copy(F).invert();
    ch.poseQuat[iU].premultiply(Fi.multiply(_qb).multiply(F));
    updateBonesSilently(ch);
  }
}

const _target = new THREE.Vector3(), _nrm = new THREE.Vector3();
/** Brings the hands of a preset with `touch` data onto their landmarks (scale = body / f_normal). */
function reachTouches(ch, touch, mirror, scale) {
  const s = scale * (ch.root.scale.x || 1);
  for (const sd of ['L', 'R']) {
    const t = touch[mirror ? (sd === 'L' ? 'R' : 'L') : sd];
    if (!t) continue;
    const v = mirror ? mirrorVertex(ch.model, t[0]) : t[0];
    if (v < 0 || v >= ch.model.vertexCount) continue;
    vertexWorld(ch, v, _target, _nrm);
    reachArm(ch, sd, _target.addScaledVector(_nrm, (t[1] ?? 0.02) * s), s);
  }
}

/**
 * Applies a full-body preset (fires a single 'pose' event).
 * opts: {mirror=false, keepHands=false (leave the current finger poses untouched)}.
 * The caller records the undo step (app.commit).
 */
export function applyPosePreset(ch, presetId, opts = {}) {
  const p = POSE_BY_ID.get(presetId);
  if (!p) return false;
  return applyPoseObject(ch, p.pose, { ground: p.ground, air: p.air || 0, touch: p.touch, ...opts });
}

/**
 * Applies a pose in the contract format authored on f_normal (root offset scaled to
 * this body). opts: {ground=true, air=0, mirror=false, keepHands=false, touch=null}.
 * Fires a single 'pose' event.
 */
export function applyPoseObject(ch, pose, opts = {}) {
  const { ground = true, air = 0 } = opts;
  if (opts.mirror) pose = mirrorPose(pose);
  const bi = ch.model.boneIndex;
  const keep = new Set(PRESERVED_BONES);
  if (opts.keepHands) for (const s of ['.L', '.R']) for (const b of HAND_BONES) keep.add(b + s);
  for (let i = 0; i < ch.poseQuat.length; i++) if (!keep.has(ch.bones[i].name)) ch.poseQuat[i].identity();
  for (const [name, a] of Object.entries(pose.bones || {})) {
    const i = bi.get(name);
    if (i !== undefined && !keep.has(name)) ch.poseQuat[i].set(a[0], a[1], a[2], a[3]).normalize();
  }
  // root offsets were authored on f_normal: scale them to this body's hip height
  const rootY = ch.restLocalPos[0].y;
  const s = rootY > 0 ? rootY / HIP_REF : 1;
  const r = pose.root || [0, 0, 0];
  ch.rootOffset.set(r[0] * s, r[1] * s, r[2] * s);
  if (opts.touch) {
    updateBonesSilently(ch);
    reachTouches(ch, opts.touch, !!opts.mirror, s);
  }
  if (ground) {
    updateBonesSilently(ch);
    const parentY = ch.root.getWorldPosition(_v).y + (ch.groundClearance || 0) * ch.root.scale.y;
    const drop = parentY + air * s * ch.root.scale.y - lowestBodyY(ch);
    _up.set(0, 1, 0).applyQuaternion(ch.root.getWorldQuaternion(_wq).invert());
    ch.rootOffset.addScaledVector(_up, drop / (ch.root.scale.y || 1));
  }
  ch.applyPose();
  return true;
}

/**
 * Applies a hand preset to 'L' | 'R' | 'both', blended from the open rest hand by
 * amount (0..1). Sets every finger + metacarpal bone of the hand(s).
 */
export function applyHandPreset(ch, presetId, side = 'both', amount = 1) {
  const p = HAND_BY_ID.get(presetId);
  if (!p) return false;
  const t = Math.max(0, Math.min(1, amount));
  const sides = side === 'both' ? ['L', 'R'] : [side];
  for (const sd of sides) {
    for (const b of HAND_BONES) {
      const i = ch.model.boneIndex.get(`${b}.${sd}`);
      if (i === undefined) continue;
      const q = p.bones[b];
      _q.set(q[0], sd === 'R' ? -q[1] : q[1], sd === 'R' ? -q[2] : q[2], q[3]).normalize();
      if (t < 1) ch.poseQuat[i].identity().slerp(_q, t); else ch.poseQuat[i].copy(_q);
    }
  }
  ch.applyPose();
  return true;
}
