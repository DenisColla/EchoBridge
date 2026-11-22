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
import { ControlSet } from './controls.js';
import { PoseRig } from './rig.js';
import { IKSolver } from './ik.js';
import { exaggerate, poseSnapshot } from './soft.js';

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
// They are the "Colonna morbida" profiles of the posing controls (controls.js): the
// back = 45% abdomen + 55% chest profile (flexion / side bend over the lumbar and
// thoracic spine, twist mostly thoracic, a little into the base of the neck), the neck
// = the neck profile (starting in the upper back). A preset is therefore exactly
// readable on the Addome / Busto / Collo sliders and bends as one continuous curve.
const CHAINS = {
  spine: [['spine05', [0.1515, 0.083, 0.139]], ['spine04', [0.169, 0.1265, 0.171]], ['spine03', [0.2045, 0.2115, 0.2245]], ['spine02', [0.2245, 0.266, 0.228]],
    ['spine01', [0.1865, 0.26, 0.1845]], ['neck01', [0.0475, 0.042, 0.042]], ['neck02', [0.0165, 0.011, 0.011]]],
  neck: [['spine02', [0.04, 0, 0.04]], ['spine01', [0.10, 0.08, 0.10]], ['neck01', [0.34, 0.36, 0.34]], ['neck02', [0.29, 0.30, 0.29]], ['neck03', [0.23, 0.26, 0.23]]],
};
const ALIAS = { clav: 'clavicle', sh: 'shoulder01' };
const META = new Set(['id', 'label', 'cat', 'ground', 'air', 'offset', 'note', 'touch', 'seat']);

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
export function compilePoseDef(def, lineGain = 1) {
  const acc = new BoneAcc();
  for (let [key, value] of Object.entries(def)) {
    if (META.has(key) || value == null) continue;
    if (lineGain !== 1 && LINE_KEYS.has(key)) value = gainOf(key, value, lineGain);
    const m = /^(.*)\.(L|R|LR)$/.exec(key);
    if (!m) { addJoint(acc, key, '', value, false); continue; }
    const [, base, side] = m;
    if (side !== 'R') addJoint(acc, base, '.L', value, false);
    if (side !== 'L') addJoint(acc, base, '.R', value, true);
  }
  return { bones: acc.toObject(), root: vec3(def.offset || [0, 0, 0]).map((v) => +v.toFixed(4)) };
}

/**
 * Line of action of the presets: the back, neck, head and whole-body lean / roll of the
 * authored values are amplified per category, so the torso reads as one clear, fluid
 * curve at a glance (comic poses are pushed further than life). The facing (root yaw)
 * and the limbs keep their authored values; the natural standing pose stays subtle.
 */
const LINE_GAIN = { stand: 1.3, action: 1.3, fight: 1.25, gesture: 1.25, sit: 1.2, floor: 1 };
/**
 * Whole-pose energy of the presets per category ("Dinamismo" baked in at apply time,
 * see soft.exaggerate: limbs, back and lean pushed away from a relaxed stance, the
 * legs at half strength, anatomical limits respected).
 */
const PRESET_DYNAMISM = { action: 1.3, fight: 1.25, gesture: 1.12 };
const PRESET_DYNAMISM_BY_ID = { superhero_landing: 1, sprint: 1.12 };
// (poses already at the edge: a deep forward lean must not tip over)
const LINE_GAIN_BY_ID = { relaxed: 1.1, superhero_landing: 1, sprint: 1.1, push: 1.1 };
const LINE_KEYS = new Set(['spine', 'neck', 'head', 'root']);
function gainOf(key, value, g) {
  const [x, y, z] = vec3(value);
  // root: [pitch, roll, yaw] -> the yaw (facing) is not a line of action
  return key === 'root' ? [x * g, y * g, z] : [x * g, y * g, z * g];
}

/**
 * [{id, label, category, pose:{bones,root}, ground, air?, touch?}] — `ground` = drop to
 * floor after applying (unless false), `air` = meters above the floor after the drop,
 * `touch` = hand contacts re-targeted on every body type (see reachTouches).
 */
export const POSE_PRESETS = POSE_DEFS.map((def) => {
  const gain = LINE_GAIN_BY_ID[def.id] ?? LINE_GAIN[def.cat] ?? 1;
  const p = { id: def.id, label: def.label, category: def.cat, pose: compilePoseDef(def, gain), ground: def.ground !== false };
  // (not for arms solved with the arm IK: their hand placement is exact)
  const dyn = PRESET_DYNAMISM_BY_ID[def.id] ?? PRESET_DYNAMISM[def.cat] ?? 1;
  if (dyn !== 1 && !def.air && !Object.keys(def).some((k) => /^(upperarm|lowerarm)/.test(k))) p.dynamism = dyn;
  if (def.air) p.air = def.air;
  if (def.touch) p.touch = def.touch;
  if (def.seat) p.seat = def.seat;
  return p;
});
const POSE_BY_ID = new Map(POSE_PRESETS.map((p) => [p.id, p]));
/** Preset used as the natural standing pose of a new character. */
export const NATURAL_POSE = 'relaxed';

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
    // same as Character.applyPose: the root also carries the shoe ground clearance
    if (i === 0) { b.position.add(ch.rootOffset); b.position.y += ch.groundClearance || 0; }
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

let _shoeTmp = new Float32Array(3 * 2048);
const _shoeMin = { L: Infinity, R: Infinity };
/** Lowest world y of the visible shoes (attachments with userData.groundContact) per side. */
function shoeMins(ch) {
  _shoeMin.L = Infinity; _shoeMin.R = Infinity;
  const W = ch.rig.matrixWorld.elements;
  for (const mesh of ch.attachments || []) {
    if (!mesh.userData?.groundContact || !mesh.visible || !mesh.isSkinnedMesh) continue;
    const g = mesh.geometry, pos = g.attributes.position;
    if (!pos || !g.attributes.skinIndex || !g.attributes.skinWeight) continue;
    if (_shoeTmp.length < pos.count * 3) _shoeTmp = new Float32Array(pos.count * 3);
    ch.skinPositions(pos.array, g.attributes.skinIndex.array, g.attributes.skinWeight.array, _shoeTmp, pos.count);
    const R = pos.array;
    for (let i = 0; i < pos.count; i++) {
      const y = W[1] * _shoeTmp[i * 3] + W[5] * _shoeTmp[i * 3 + 1] + W[9] * _shoeTmp[i * 3 + 2] + W[13];
      const sd = R[i * 3] > 0 ? 'L' : 'R'; // rest rig space: the character's left is +X
      if (y < _shoeMin[sd]) _shoeMin[sd] = y;
    }
  }
  return _shoeMin;
}

/** Lowest floor-contact point of one foot (world y): its shoe, or the skin minus the clearance. */
function footGroundY(ch, sd, shoes = shoeMins(ch)) {
  if (shoes[sd] < Infinity) return shoes[sd];
  return minWorldY(ch, bodyData(ch.model).foot[sd]) - (ch.groundClearance || 0) * (ch.root.scale.y || 1);
}

/**
 * World height of the lowest point that rests on the floor. Shoes (attachments tagged
 * userData.groundContact) touch it themselves, so a tilted outsole or a raised heel
 * cannot sink into it; the rest of the skin (knees, buttocks, hands, bare feet) keeps
 * the shoe clearance above it. The foot skin inside a shoe does not count: near the toe
 * the outsole is thinner than the clearance. Bone matrices must be current.
 */
export function lowestGroundY(ch, withShoes = true) {
  const d = bodyData(ch.model);
  if (!withShoes) return lowestBodyY(ch) - (ch.groundClearance || 0) * (ch.root.scale.y || 1);
  const shoes = shoeMins(ch);
  const L = footGroundY(ch, 'L', shoes), R = footGroundY(ch, 'R', shoes);
  return Math.min(minWorldY(ch, d.rest) - (ch.groundClearance || 0) * (ch.root.scale.y || 1), L, R);
}

/**
 * Feet resting on the character's floor: {L, R} booleans (lowest shoe / foot point
 * within `tol` meters of the placement height). Bone matrices must be current.
 */
export function feetOnFloor(ch, tol = 0.03) {
  const floor = ch.root.getWorldPosition(_v).y, sc = ch.root.scale.y || 1;
  const shoes = shoeMins(ch);
  return { L: footGroundY(ch, 'L', shoes) - floor < tol * sc, R: footGroundY(ch, 'R', shoes) - floor < tol * sc };
}

/** Pushes the arms out of the torso / legs (same fit as the presets). Fires no event. */
export function fitArms(ch) {
  const rootY = ch.restLocalPos[0].y;
  resolveArms(ch, rootY > 0 ? rootY / HIP_REF : 1);
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

// ---------------------------------------------------------------- body fitting
// The presets are fixed angles authored on f_normal. Two corrections make them sit
// right on every body type:
//  - seat: chair / stool poses put the buttocks at the seat height of a real chair
//    (props 'sedia' 0.45 m, 'sgabello' 0.65 m): the pelvis moves up or down and the
//    legs whose feet stand on the floor are re-solved with the leg IK (feet planted),
//    so a long-legged body raises its knees instead of floating above the chair.
//  - collide: arms that would pass through a bulkier torso, bust, hips or thighs
//    (arms crossed on a curvy body, hanging arms beside wide hips …) are pushed out:
//    the upper arm swings away about the shoulder, the forearm / hand moves the wrist
//    out with the two-bone arm IK.
let _solver = null; // IK on top of the anatomical controls, one per model
function solverFor(model) {
  if (!_solver || _solver.model !== model) _solver = { model, ik: new IKSolver(new PoseRig(new ControlSet(model))) };
  return _solver.ik;
}

const _bodyCache = new WeakMap(); // model -> vertex lists by dominant bone
function bodyData(model) {
  let d = _bodyCache.get(model);
  if (d) return d;
  const SI = model.skinIndex, SW = model.skinWeight, bi = model.boneIndex;
  const body = model.groupVertices[0];
  const dom = new Int16Array(model.vertexCount).fill(-1);
  for (const v of body) {
    let best = -1, bw = 0;
    for (let k = 0; k < 4; k++) if (SW[v * 4 + k] > bw) { bw = SW[v * 4 + k]; best = SI[v * 4 + k]; }
    dom[v] = best;
  }
  const byBones = (names) => {
    const set = new Set(names.map((n) => bi.get(n)).filter((i) => i !== undefined));
    const out = [];
    for (const v of body) if (set.has(dom[v])) out.push(v);
    return Int32Array.from(out);
  };
  const foot = (sd) => byBones([`foot.${sd}`, ...[1, 2, 3, 4, 5].map((t) => `toe${t}-1.${sd}`)]);
  const cloud = [];
  for (const v of body) if (dom[v] >= 0 && !ARM_RE.test(model.bones[dom[v]].name)) cloud.push(v);
  const feet = new Set([...foot('L'), ...foot('R')]);
  const rest = [];
  for (const v of body) if (!feet.has(v)) rest.push(v);
  d = {
    rest: Int32Array.from(rest), // every body vertex but the feet (grounding)
    seat: byBones(['root', 'pelvis.L', 'pelvis.R', 'spine05', 'upperleg01.L', 'upperleg01.R']),
    foot: { L: foot('L'), R: foot('R') },
    upper: { L: byBones(['upperarm01.L', 'upperarm02.L']), R: byBones(['upperarm01.R', 'upperarm02.R']) },
    fore: { L: byBones(['lowerarm01.L', 'lowerarm02.L']), R: byBones(['lowerarm01.R', 'lowerarm02.R']) },
    cloud: Int32Array.from(cloud), // torso, head, legs: what the arms must not enter
  };
  _bodyCache.set(model, d);
  return d;
}

/**
 * World positions (and optionally normals) of skinned body vertices, current bone
 * matrices (call updateBonesSilently first). out: Float32Array(3n).
 */
function skinWorld(ch, verts, out, nOut = null) {
  const M = ch.updateSkinMatrices();
  const R = ch.restPositions, N = ch.restNormals, SI = ch.model.skinIndex, SW = ch.model.skinWeight;
  const W = ch.rig.matrixWorld.elements;
  for (let j = 0; j < verts.length; j++) {
    const v = verts[j];
    const x = R[v * 3], y = R[v * 3 + 1], z = R[v * 3 + 2];
    const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    let ox = 0, oy = 0, oz = 0, mx = 0, my = 0, mz = 0;
    for (let k = 0; k < 4; k++) {
      const w = SW[v * 4 + k];
      if (!w) continue;
      const o = SI[v * 4 + k] * 16;
      ox += w * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
      oy += w * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
      oz += w * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
      if (nOut) {
        mx += w * (M[o] * nx + M[o + 4] * ny + M[o + 8] * nz);
        my += w * (M[o + 1] * nx + M[o + 5] * ny + M[o + 9] * nz);
        mz += w * (M[o + 2] * nx + M[o + 6] * ny + M[o + 10] * nz);
      }
    }
    out[j * 3] = W[0] * ox + W[4] * oy + W[8] * oz + W[12];
    out[j * 3 + 1] = W[1] * ox + W[5] * oy + W[9] * oz + W[13];
    out[j * 3 + 2] = W[2] * ox + W[6] * oy + W[10] * oz + W[14];
    if (nOut) {
      const ax = W[0] * mx + W[4] * my + W[8] * mz, ay = W[1] * mx + W[5] * my + W[9] * mz, az = W[2] * mx + W[6] * my + W[10] * mz;
      const l = Math.hypot(ax, ay, az) || 1;
      nOut[j * 3] = ax / l; nOut[j * 3 + 1] = ay / l; nOut[j * 3 + 2] = az / l;
    }
  }
  return out;
}

let _scratch = new Float32Array(3 * 4096);
function minWorldY(ch, verts) {
  if (_scratch.length < verts.length * 3) _scratch = new Float32Array(verts.length * 3);
  skinWorld(ch, verts, _scratch);
  let m = Infinity;
  for (let j = 0; j < verts.length; j++) if (_scratch[j * 3 + 1] < m) m = _scratch[j * 3 + 1];
  return m;
}

/** world floor height of a character (its placement + shoe clearance) */
function floorY(ch) { return ch.root.getWorldPosition(_v).y + (ch.groundClearance || 0) * ch.root.scale.y; }

/** moves the root along world up by dy (world meters) */
function liftRoot(ch, dy) {
  _up.set(0, 1, 0).applyQuaternion(ch.root.getWorldQuaternion(_wq).invert());
  ch.rootOffset.addScaledVector(_up, dy / (ch.root.scale.y || 1));
  updateBonesSilently(ch);
}

/** Seat fitting (see above). seat = seat height in meters above the character's floor. */
function fitSeat(ch, seat) {
  const d = bodyData(ch.model), ik = solverFor(ch.model);
  const sc = ch.root.scale.y || 1, floor = floorY(ch);
  updateBonesSilently(ch);
  // the body is grounded first: its lowest point (a foot) rests on the floor
  liftRoot(ch, floor - lowestBodyY(ch));
  // feet standing on the floor stay planted (ankle position + foot orientation)
  const pins = [];
  for (const sd of ['L', 'R']) {
    if (minWorldY(ch, d.foot[sd]) - floor > 0.03 * sc) continue;
    const chain = ik.chains['foot.' + sd];
    pins.push({ chain, pos: ik.rig.worldPos(ch, chain.end, new THREE.Vector3()), quat: ik.rig.worldQuat(ch, chain.end, new THREE.Quaternion()) });
  }
  // the thighs turn about the hips while the pelvis moves, which moves the lowest
  // seat point too: a few passes converge
  for (let it = 0; it < 4; it++) {
    const dy = floor + seat * sc - minWorldY(ch, d.seat);
    if (Math.abs(dy) < 0.003 * sc) break;
    liftRoot(ch, dy);
    for (const p of pins) ik.solveLimb(ch, p.chain, p.pos, p.quat, 4);
    updateBonesSilently(ch);
  }
}

// arm samples: [segment, t along it] (upper arm: shoulder -> elbow, forearm: elbow -> wrist)
// (the upper half of the upper arm is left out: under the armpit arm and torso always touch)
const ARM_SAMPLES = [['u', 0.7], ['u', 0.88], ['f', 0.12], ['f', 0.32], ['f', 0.52], ['f', 0.72], ['f', 0.9], ['h', 0.55], ['h', 1]];
const CLOTH_MARGIN = 0.004; // garments over the skin (meters, f_normal)
const PEN_EPS = 0.01; // tolerated contact: soft tissue gives way a little (meters)
const _ca = new THREE.Vector3(), _cb = new THREE.Vector3(), _cp = new THREE.Vector3(), _cn = new THREE.Vector3();

/** mean distance of a bone group's vertices to its axis (rest pose): limb radius */
function limbRadius(ch, verts, headBone, tailBone) {
  if (!verts.length) return 0.03;
  const a = ch.bones[headBone].getWorldPosition(_ca), b = ch.bones[tailBone].getWorldPosition(_cb);
  if (_scratch.length < verts.length * 3) _scratch = new Float32Array(verts.length * 3);
  skinWorld(ch, verts, _scratch);
  const ab = _cn.subVectors(b, a), l2 = ab.lengthSq() || 1;
  let sum = 0;
  for (let j = 0; j < verts.length; j++) {
    _cp.set(_scratch[j * 3] - a.x, _scratch[j * 3 + 1] - a.y, _scratch[j * 3 + 2] - a.z);
    const t = Math.max(0, Math.min(1, _cp.dot(ab) / l2));
    sum += _cp.addScaledVector(ab, -t).length();
  }
  return sum / verts.length;
}

/** Pushes the arms out of the torso / head / legs (see above). s = body scale vs f_normal. */
function resolveArms(ch, s) {
  const d = bodyData(ch.model);
  const sc = s * (ch.root.scale.x || 1);
  updateBonesSilently(ch);
  const cloud = d.cloud;
  const P = new Float32Array(cloud.length * 3), Nn = new Float32Array(cloud.length * 3);
  skinWorld(ch, cloud, P, Nn); // the torso does not move while the arms are adjusted
  const near = new Int32Array(cloud.length);
  for (const sd of ['L', 'R']) {
    const iU = boneIdx(ch, `upperarm01.${sd}`), iL = boneIdx(ch, `lowerarm01.${sd}`), iW = boneIdx(ch, `wrist.${sd}`), iK = boneIdx(ch, `finger3-1.${sd}`);
    if (iU < 0 || iL < 0 || iW < 0 || iK < 0) continue;
    // mean vertex distance from the bone axis (the bone runs off-center: a bit less is the true half-thickness)
    const rU = 0.8 * limbRadius(ch, d.upper[sd], iU, iL), rF = 0.85 * limbRadius(ch, d.fore[sd], iL, iW), rH = 0.02 * sc;
    // candidate body points near this arm (bounding sphere around the shoulder)
    const S = bonePos(ch, iU, new THREE.Vector3());
    const reach = (bonePos(ch, iL, _E).distanceTo(S) + bonePos(ch, iW, _W).distanceTo(_E)) + 0.2 * sc;
    let nn = 0;
    for (let j = 0; j < cloud.length; j++) {
      const dx = P[j * 3] - S.x, dy = P[j * 3 + 1] - S.y, dz = P[j * 3 + 2] - S.z;
      if (dx * dx + dy * dy + dz * dz < reach * reach) near[nn++] = j;
    }
    if (!nn) continue;
    for (let it = 0; it < 6; it++) {
      bonePos(ch, iU, _S); bonePos(ch, iL, _E); bonePos(ch, iW, _W); bonePos(ch, iK, _T);
      let worst = 0, wSeg = '', wT = 0;
      const wP = _P, wN = _nrm;
      for (const [seg, t] of ARM_SAMPLES) {
        let r;
        if (seg === 'u') { _cp.copy(_S).lerp(_E, t); r = rU; }
        else if (seg === 'f') { _cp.copy(_E).lerp(_W, t); r = rF * (1 - 0.25 * t); }
        else { _cp.copy(_W).lerp(_T, t); r = rH; }
        // nearest body point and its outward normal
        let bj = -1, bd = Infinity;
        for (let q = 0; q < nn; q++) {
          const j = near[q];
          const dx = P[j * 3] - _cp.x, dy = P[j * 3 + 1] - _cp.y, dz = P[j * 3 + 2] - _cp.z;
          const dd = dx * dx + dy * dy + dz * dz;
          if (dd < bd) { bd = dd; bj = j; }
        }
        const lim = r + CLOTH_MARGIN * sc;
        if (bj < 0 || bd > (lim + 0.03 * sc) ** 2) continue;
        _cn.set(Nn[bj * 3], Nn[bj * 3 + 1], Nn[bj * 3 + 2]);
        const sd2 = (_cp.x - P[bj * 3]) * _cn.x + (_cp.y - P[bj * 3 + 1]) * _cn.y + (_cp.z - P[bj * 3 + 2]) * _cn.z;
        const pen = lim - sd2;
        if (pen > worst) { worst = pen; wSeg = seg; wT = t; wP.copy(_cp); wN.copy(_cn); }
      }
      if (worst < PEN_EPS * sc) break;
      const push = worst - 0.5 * PEN_EPS * sc;
      if (wSeg === 'u') {
        // swing the upper arm away about the shoulder
        const arm = _tv.subVectors(wP, _S);
        const axis = _cb.crossVectors(arm, wN);
        const len = axis.length();
        if (len < 1e-6) break;
        axis.multiplyScalar(1 / len);
        _qb.setFromAxisAngle(axis, Math.min(0.5, push / Math.max(0.05, arm.length())));
        ch.bones[iU].parent.getWorldQuaternion(_qa2).multiply(ch.restLocalQuat[iU]);
        const F = _qa2, Fi = _q.copy(F).invert();
        ch.poseQuat[iU].premultiply(Fi.multiply(_qb).multiply(F));
        updateBonesSilently(ch);
      } else {
        // move the hand out: the wrist moves more than the sample point (lever from the elbow)
        const lever = wSeg === 'f' ? Math.max(0.35, wT) : 1;
        palmPoint(ch, sd, _ca);
        reachArm(ch, sd, _ca.addScaledVector(wN, Math.min(0.15 * sc, push / lever)), sc);
      }
    }
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
  // floor poses (kneeling, lying, sitting on the floor) rest on the body: shoes tucked under the
  // legs may dip into the floor rather than lift the whole body off it
  const onFloor = p.category === 'floor' || (p.category === 'sit' && !p.seat);
  const o = { ground: p.ground, air: p.air || 0, touch: p.touch, seat: p.seat || 0, collide: true, shoes: !onFloor, dynamism: p.dynamism || 1, ...opts, presetId: presetId };
  if (ch.data) setSeatMark(ch, o.seat && o.ground ? o.seat : 0);
  return applyPoseObject(ch, p.pose, o);
}

/**
 * Applies a pose in the contract format authored on f_normal (root offset scaled to
 * this body). opts: {ground=true, air=0, mirror=false, keepHands=false, touch=null,
 * dynamism=1 (exaggeration of the whole pose, see soft.exaggerate),
 * seat=0 (chair height to fit, meters), collide=false (push the arms out of the body),
 * shoes=true (shoes touch the floor and both feet are planted, see lowestGroundY /
 * plantFeet; false: the skin keeps the clearance, shoes may dip into the floor)}.
 * Fires a single 'pose' event.
 */
export function applyPoseObject(ch, pose, opts = {}) {
  const { ground = true, air = 0 } = opts;
  // which ready pose this is (ch.data.pose.preset): set by applyPosePreset, cleared otherwise
  if (ch.data) setPresetMark(ch, opts.presetId || null, !!opts.mirror);
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
  if (opts.dynamism && opts.dynamism !== 1) {
    const ik = solverFor(ch.model);
    exaggerate(ch, poseSnapshot(ch), opts.dynamism, ik.rig, ik.controls);
  }
  updateBonesSilently(ch);
  if (opts.seat && ground) fitSeat(ch, opts.seat);
  if (opts.touch) reachTouches(ch, opts.touch, !!opts.mirror, s);
  if (opts.collide) resolveArms(ch, s);
  if (ground) {
    updateBonesSilently(ch);
    // the character's own floor (its placement height); shoes touch it, the skin keeps the clearance
    const floor = ch.root.getWorldPosition(_v).y;
    const shoes = opts.shoes !== false;
    const drop = floor + air * s * ch.root.scale.y - lowestGroundY(ch, shoes);
    liftRoot(ch, drop);
    if (!air && shoes) plantFeet(ch, s);
  }
  ch.applyPose();
  return true;
}

// ---------------------------------------------------------------- both feet on the floor
// The presets are authored barefoot on f_normal. With shoes (thick, rounded outsoles) or
// on another body, a pose meant to stand on both feet (contrapposto, guards, walk …)
// may touch the floor with one shoe only while the other floats 5-17 mm. plantFeet()
// lowers the body onto the higher foot and lifts the lower one by the same amount with
// the leg IK (its knee bends a little, the foot keeps its orientation). Skipped when a
// foot is clearly lifted, or when another body part (a kneeling knee) would go through
// the floor.
const PLANT_MAX = 0.025; // m (f_normal): a foot closer than this to the floor stands on it
const _pq = [];
const _po = new THREE.Vector3(), _pp = new THREE.Vector3(), _pqt = new THREE.Quaternion();

function plantFeet(ch, s) {
  const sc = ch.root.scale.y || 1;
  updateBonesSilently(ch);
  const floor = ch.root.getWorldPosition(_v).y;
  let sh = shoeMins(ch);
  const yL = footGroundY(ch, 'L', sh) - floor, yR = footGroundY(ch, 'R', sh) - floor;
  const g = Math.abs(yL - yR);
  if (Math.min(yL, yR) > 0.003 * sc || g < 0.002 * sc || g > PLANT_MAX * s * sc) return;
  const lo = yL < yR ? 'L' : 'R';
  const ik = solverFor(ch.model), chain = ik.chains['foot.' + lo];
  if (!chain) return;
  // snapshot (restored when the result is not better)
  for (let i = 0; i < ch.poseQuat.length; i++) (_pq[i] || (_pq[i] = new THREE.Quaternion())).copy(ch.poseQuat[i]);
  _po.copy(ch.rootOffset);
  liftRoot(ch, -g);
  ik.rig.worldPos(ch, chain.end, _pp);
  ik.rig.worldQuat(ch, chain.end, _pqt);
  _pp.y += g;
  ik.solveLimb(ch, chain, _pp, _pqt, 4);
  updateBonesSilently(ch);
  // nothing may go through the floor (a kneeling knee, the other foot): re-ground, then judge
  liftRoot(ch, floor - lowestGroundY(ch));
  sh = shoeMins(ch);
  const nL = footGroundY(ch, 'L', sh) - floor, nR = footGroundY(ch, 'R', sh) - floor;
  if (Math.abs(nL - nR) < g - 0.001 * sc) return; // both feet closer to the floor: keep
  for (let i = 0; i < ch.poseQuat.length; i++) ch.poseQuat[i].copy(_pq[i]);
  ch.rootOffset.copy(_po);
  updateBonesSilently(ch);
}

// ---------------------------------------------------------------- seated poses
/**
 * Seat mark: a chair / stool preset records its seat height in ch.data.pose.seat
 * (meters above the floor, serialized with the character, cleared by any other
 * preset or a pose reset), so copying the pose to another body can fit the seat.
 */
export function seatMark(ch) { return +(ch.data?.pose?.seat) || 0; }
export function setSeatMark(ch, seat) {
  const d = ch.data.pose || (ch.data.pose = {});
  if (seat > 0) d.seat = Math.round(seat * 1000) / 1000; else delete d.seat;
  if (!Object.keys(d).length) delete ch.data.pose;
}

/**
 * Preset mark: the id of the last ready pose applied to the character, kept in
 * ch.data.pose.preset (+ presetMirror: true when applied mirrored), serialized with
 * the character. Cleared by any other pose edit (the pose module clears it on a final
 * edit; a pose applied with applyPoseObject without presetId clears it too).
 */
export function presetMark(ch) { return ch.data?.pose?.preset || null; }
export function setPresetMark(ch, id, mirror = false) {
  const d = ch.data.pose || (ch.data.pose = {});
  if (id) { d.preset = id; if (mirror) d.presetMirror = true; else delete d.presetMirror; } else { delete d.preset; delete d.presetMirror; }
  if (!Object.keys(d).length) delete ch.data.pose;
}

/**
 * Current seat height of a seated character (lowest buttock / upper-thigh point above
 * its floor, meters), or 0 when it does not sit: no seat mark, or the pose was edited
 * into a standing one (no thigh raised more than 40° from hanging straight down).
 */
export function measureSeat(ch) {
  if (!seatMark(ch)) return 0;
  updateBonesSilently(ch);
  let raised = false;
  for (const sd of ['L', 'R']) {
    const iH = boneIdx(ch, `upperleg01.${sd}`), iK = boneIdx(ch, `lowerleg01.${sd}`);
    if (iH < 0 || iK < 0) continue;
    bonePos(ch, iK, _ca).sub(bonePos(ch, iH, _cb)).normalize();
    if (_ca.y > -Math.cos(40 * DEG)) raised = true;
  }
  if (!raised) return 0;
  const sc = ch.root.scale.y || 1;
  const h = (minWorldY(ch, bodyData(ch.model).seat) - ch.root.getWorldPosition(_v).y) / sc;
  return h > 0.15 ? h : 0;
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
