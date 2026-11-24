// Soft posing helpers on top of the anatomical controls:
//  - SpineFollow: "Bacino compensa" — while the back is bent sideways or twisted
//    (Addome / Busto), the pelvis counter-tilts / counter-turns a little and the
//    planted feet stay where they are (leg IK): the hips drop on one side and the
//    shoulders on the other, as in a real contrapposto.
//  - exaggerate(): "Dinamismo" — scales every rotation of the pose away from a
//    relaxed neutral stance (limits respected) for more energetic comic poses.
//  - bendLine(): "Curva" — bends / straightens the line of action of the back.
//  - naturalness(): "Naturalezza" — small deterministic asymmetries per character.
import * as THREE from 'three';

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const AX_Y = new THREE.Vector3(0, 1, 0), AX_Z = new THREE.Vector3(0, 0, 1), AX_X = new THREE.Vector3(1, 0, 0);

/** share of the back's side bend / twist taken back by the pelvis */
const COUNTER_LAT = 0.35, COUNTER_ROT = 0.3;

export class SpineFollow {
  /** ctx: pose module context (rig, ik, controls, state, feetOnFloor(ch)) */
  constructor(ctx) {
    this.ctx = ctx;
    this.s = null;
  }

  /** Starts following an edit of `ctrl` (abdomen / chest only). Returns true when active. */
  begin(ch, ctrl) {
    this.s = null;
    const { state, controls, ik } = this.ctx;
    if (!state.counterTilt || !ch || !ctrl || (ctrl.baseId !== 'abdomen' && ctrl.baseId !== 'chest')) return false;
    const feet = this.ctx.feetOnFloor(ch);
    if (!feet.L || !feet.R) return false; // only for a figure standing on both feet
    const parts = [controls.get('abdomen'), controls.get('chest')];
    const lat = parts.map((c) => c.axes.findIndex((a) => a.key === 'lat'));
    const rot = parts.map((c) => c.axes.findIndex((a) => a.key === 'rot'));
    this.s = {
      ch, parts, lat, rot,
      lat0: this._sum(ch, parts, lat), rot0: this._sum(ch, parts, rot),
      root0: ch.poseQuat[0].clone(),
      pins: ['L', 'R'].map((sd) => ik.pin(ch, sd)),
    };
    return true;
  }

  _sum(ch, parts, keys) {
    let v = 0;
    parts.forEach((c, j) => { v += this.ctx.rig.read(ch, c, keys[j]); });
    return v;
  }

  /** After each write of the followed part (matrices are refreshed here). */
  update() {
    const s = this.s;
    if (!s) return;
    const { rig, ik } = this.ctx;
    const ch = s.ch;
    const dLat = this._sum(ch, s.parts, s.lat) - s.lat0, dRot = this._sum(ch, s.parts, s.rot) - s.rot0;
    // root frame: +Y forward (roll: + = left side up), +Z up (yaw: + = turn left)
    _q.setFromAxisAngle(AX_Y, COUNTER_LAT * dLat);
    _q2.setFromAxisAngle(AX_Z, -COUNTER_ROT * dRot);
    ch.poseQuat[0].copy(s.root0).multiply(_q).multiply(_q2);
    rig.refreshAll(ch);
    for (const p of s.pins) ik.solvePinned(ch, p);
  }

  end() { this.s = null; }
}

// ---------------------------------------------------------------- Dinamismo
/**
 * Neutral stance the exaggeration scales away from: rest pose with the arms hanging
 * along the body (the rest A-pose would push hanging arms into the torso).
 */
const NEUTRAL = {
  'upperarm01': [0, 0, 38], 'lowerarm01': [16, 0, 0],
};
const DEG = Math.PI / 180;

/** Per-bone neutral quaternions (cached per model). */
const _neutral = new WeakMap();
function neutralOf(model) {
  let n = _neutral.get(model);
  if (n) return n;
  n = model.bones.map(() => new THREE.Quaternion());
  const e = new THREE.Euler();
  for (const [base, [x, y, z]] of Object.entries(NEUTRAL)) {
    for (const sd of ['L', 'R']) {
      const i = model.boneIndex.get(`${base}.${sd}`);
      if (i === undefined) continue;
      n[i].setFromEuler(e.set(x * DEG, y * DEG, z * DEG, 'ZXY'));
      if (sd === 'R') n[i].set(n[i].x, -n[i].y, -n[i].z, n[i].w);
    }
  }
  _neutral.set(model, n);
  return n;
}

/** q^t for a unit quaternion (t may exceed 1: extrapolation along the same axis). */
function powQuat(q, t, out) {
  let w = Math.max(-1, Math.min(1, q.w));
  let x = q.x, y = q.y, z = q.z;
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; } // shortest arc
  const half = Math.acos(w), s = Math.sin(half);
  if (s < 1e-7) return out.set(0, 0, 0, 1);
  const a = Math.min(Math.PI * 0.98, half * t); // never past a half turn
  const k = Math.sin(a) / s;
  return out.set(x * k, y * k, z * k, Math.cos(a));
}

const SKIP = /^(eye|finger|metacarpal|toe)/; // hands / eyes keep their shape
/**
 * Share of the exaggeration per body region: the legs carry the body (a fully
 * exaggerated stride turns a run into a lunge once grounded), the head stays readable.
 */
function regionGain(name) {
  if (/^(upperleg|lowerleg|foot|pelvis\.)/.test(name)) return 0.5;
  if (/^(neck|head)/.test(name)) return 0.8;
  return 1;
}

/**
 * Snapshot for exaggerate(): pose quaternions + root offset.
 * @returns {{q: THREE.Quaternion[], root: THREE.Vector3}}
 */
export function poseSnapshot(ch) {
  return { q: ch.poseQuat.map((q) => q.clone()), root: ch.rootOffset.clone() };
}

/**
 * "Dinamismo": every rotation of `snap` scaled by `amount` away from the neutral
 * stance (1 = unchanged, 0 = neutral, 1.6 = 60% more), then each anatomical part is
 * clamped to its limits. The root rotation (whole body lean) is scaled too.
 */
export function exaggerate(ch, snap, amount, rig, controls) {
  const N = neutralOf(ch.model);
  const bones = ch.model.bones;
  for (let i = 0; i < bones.length; i++) {
    const q0 = snap.q[i];
    if (SKIP.test(bones[i].name)) { ch.poseQuat[i].copy(q0); continue; }
    if (i === 0) {
      // whole body: exaggerate the lean, not the facing (yaw about the root's up axis, +Z)
      const l = Math.hypot(q0.z, q0.w) || 1;
      _q3.set(0, 0, q0.z / l, q0.w / l); // twist (yaw)
      _q.copy(_q3).invert().multiply(q0); // swing (lean)
      powQuat(_q, amount, _q2);
      ch.poseQuat[0].copy(_q3).multiply(_q2);
      continue;
    }
    // delta from neutral in the bone frame: q0 = N * d  ->  q = N * d^amount
    _q.copy(N[i]).invert().multiply(q0);
    powQuat(_q, 1 + (amount - 1) * regionGain(bones[i].name), _q2);
    ch.poseQuat[i].copy(N[i]).multiply(_q2);
  }
  ch.rootOffset.copy(snap.root);
  if (rig.limits) {
    for (const c of controls.list) {
      if (c.free || c.region === 'finger') continue;
      for (let k = 0; k < c.axes.length; k++) {
        if (c.axes[k].extra) continue;
        const v = rig.read(ch, c, k), lim = rig.limitsOf(ch, c, k);
        if (lim && (v < lim[0] - 1e-4 || v > lim[1] + 1e-4)) rig.write(ch, c, k, v);
      }
    }
  }
}

// ---------------------------------------------------------------- Curva
/** axes of the back's line of action: [control id, axis key] */
const LINE_AXES = [['abdomen', 'flex'], ['abdomen', 'lat'], ['chest', 'flex'], ['chest', 'lat'], ['neck', 'flex'], ['neck', 'lat'], ['head', 'flex'], ['head', 'lat']];
/** gentle C curve used when the back is straight (flexion forward, radians per part) */
const DEFAULT_C = { 'abdomen.flex': 10 * DEG, 'chest.flex': 12 * DEG, 'neck.flex': 6 * DEG, 'head.flex': 2 * DEG };

/** Snapshot of the line-of-action axes for bendLine(). */
export function lineSnapshot(ch, rig, controls) {
  const vals = LINE_AXES.map(([id, key]) => {
    const c = controls.get(id); const k = c.axes.findIndex((a) => a.key === key);
    return { c, k, v: rig.read(ch, c, k), key: id + '.' + key };
  });
  const mag = Math.hypot(...vals.slice(0, 6).map((e) => e.v));
  return { vals, straight: mag < 6 * DEG };
}

/**
 * "Curva": t = 1 keeps the curve, 0 straightens the back (and neck), 2 doubles the
 * bend. A straight back bends into a gentle C (t > 1) or arches (t < 1).
 */
export function bendLine(ch, snap, t, rig) {
  for (const e of snap.vals) {
    const v = snap.straight ? e.v + (t - 1) * (DEFAULT_C[e.key] || 0) : e.v * t;
    rig.write(ch, e.c, e.k, v);
  }
}

// ---------------------------------------------------------------- Naturalezza
/** [control id (sided: both sides), axis key, amplitude deg] */
const NAT_AXES = [
  ['pelvis', 'lat', 2.5], ['pelvis', 'rot', 3],
  ['abdomen', 'lat', 3], ['abdomen', 'rot', 3], ['chest', 'lat', 3.5], ['chest', 'rot', 4], ['chest', 'flex', 2.5],
  ['neck', 'lat', 4], ['neck', 'rot', 6], ['head', 'lat', 5], ['head', 'rot', 7], ['head', 'flex', 4],
  ['shoulder', 'elev', 5], ['shoulder', 'prot', 5],
  ['arm', 'flex', 6], ['arm', 'abd', 4], ['arm', 'rot', 6],
  ['forearm', 'flex', 8], ['forearm', 'rot', 8], ['hand', 'flex', 8], ['hand', 'dev', 5],
  ['thigh', 'rot', 4], ['foot', 'abd', 5],
];

/** deterministic pseudo random in [-1, 1] from a string seed and an index */
function hashNoise(seed, n) {
  let h = 2166136261 ^ n * 16777619;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Per-axis offsets (radians) of a character at amount 1: [{c, k, d}] (pelvis root roll / yaw included). */
export function naturalOffsets(ch, controls) {
  const out = [];
  let n = 0;
  for (const [id, key, amp] of NAT_AXES) {
    for (const sd of controls.get(id) ? [''] : ['.L', '.R']) {
      const c = controls.get(id + sd);
      n++;
      if (!c) continue;
      const k = c.axes.findIndex((a) => a.key === key);
      if (k < 0) continue;
      out.push({ c, k, d: hashNoise(ch.id, n) * amp * DEG });
    }
  }
  return out;
}

/**
 * Adds (to - from) x the character's offsets: the slider moves from `from` to `to`
 * (0..1). Limits are respected. Matrices are not updated.
 */
export function applyNaturalness(ch, from, to, rig, controls) {
  const k = to - from;
  if (Math.abs(k) < 1e-6) return;
  for (const o of naturalOffsets(ch, controls)) {
    if (o.c.free) {
      // pelvis: rotate the root about its own axes (roll / yaw), no limits
      const ax = o.c.axes[o.k].key === 'lat' ? AX_Y : o.c.axes[o.k].key === 'rot' ? AX_Z : AX_X;
      ch.poseQuat[0].multiply(_q.setFromAxisAngle(ax, o.d * k));
      continue;
    }
    rig.write(ch, o.c, o.k, rig.read(ch, o.c, o.k) + o.d * k);
  }
}

