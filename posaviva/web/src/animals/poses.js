// Ready poses of the animal families (pure data: also used by the build
// previews). Angles are raw bone Euler XYZ in degrees in the world aligned
// rest frames (the animal faces +Z, its left is +X):
//   legs X+ = swing back; front: forearm X- = elbow flexes (paw forward),
//   hand X+ = carpus folds; hind: shin X+ = stifle flexes, foot X- = hock flexes
//   hips / back / neck / head X+ = nose down; jaw X+ = open; tail X+ = up
// A key ending with '*' is applied to both sides, mirrored (x, -y, -z) on the
// right. A value {a, y, z} gives the bone's ABSOLUTE side-view angle instead
// of a rotation: a = degrees from straight down, positive = pointing forward
// ('rest' = keep the rest direction), so a pose fits every species' own leg
// proportions (resolvePose computes the local X rotation from the rest bones). `air` = meters above the floor after the drop, per meter of height.
// `only` / `not` filter by species id; `gait` gives per-gait overrides.

const P = (id, label, bones, extra = {}) => ({ id, label, bones, ...extra });

// ------------------------------------------------------------------ quadrupeds
const QUAD = [
  P('stand', 'In piedi', {}),
  P('walk', 'Cammina', {
    'upperarm.L': [-16, 0, 0], 'forearm.L': [-28, 0, 0], 'hand.L': [58, 0, 0], 'fingers.L': [-10, 0, 0],
    'upperarm.R': [20, 0, 0], 'forearm.R': [4, 0, 0], 'hand.R': [-12, 0, 0],
    'thigh.L': [14, 0, 0], 'shin.L': [2, 0, 0], 'foot.L': [8, 0, 0],
    'thigh.R': [-24, 0, 0], 'shin.R': [42, 0, 0], 'foot.R': [-38, 0, 0], 'toes.R': [22, 0, 0],
    neck1: [6, 0, 0], neck2: [4, 0, 0], head: [6, -4, 0], tail1: [-4, 6, 0], tail2: [-4, 6, 0], spine2: [0, 3, 0],
  }),
  P('run', 'Corre / galoppo', {
    'upperarm.L': [-58, 0, 0], 'forearm.L': [-8, 0, 0], 'hand.L': [-6, 0, 0],
    'upperarm.R': [-40, 0, 0], 'forearm.R': [-22, 0, 0], 'hand.R': [30, 0, 0],
    'thigh.L': [44, 0, 0], 'shin.L': [-18, 0, 0], 'foot.L': [26, 0, 0], 'toes.L': [12, 0, 0],
    'thigh.R': [36, 0, 0], 'shin.R': [-10, 0, 0], 'foot.R': [18, 0, 0],
    spine1: [-6, 0, 0], spine2: [-6, 0, 0], chest: [-4, 0, 0], neck1: [14, 0, 0], neck2: [6, 0, 0], head: [10, 0, 0],
    tail1: [-8, 0, 0], tail2: [-4, 0, 0], 'ear*': [20, 0, 0],
  }, { air: 0.12 }),
  P('sit', 'Seduto', {
    hips: [-30, 0, 0], spine1: [-4, 0, 0], spine2: [-3, 0, 0],
    'thigh*': { a: 72, z: 4 }, 'shin*': { a: -58 }, 'foot*': { a: 90 }, 'toes*': { a: 92 },
    'upperarm*': { a: 'rest' }, 'forearm*': { a: 3 }, 'hand*': { a: 'rest' }, 'fingers*': { a: 'rest' },
    neck1: [12, 0, 0], neck2: [6, 0, 0], head: [14, 0, 0], tail1: { a: -98, y: 30 }, tail2: [0, 18, 0], tail3: [0, 10, 0],
  }, { gait: { unguligrade: { bones: { 'forearm*': { a: 4 }, 'hand*': { a: 'rest' }, 'thigh*': { a: 70, z: 6 }, 'shin*': { a: -62 }, 'foot*': { a: 92 }, 'toes*': { a: 100 }, tail1: { a: -75 } } } } }),
  P('lie', 'Sdraiato', {
    'upperarm*': { a: -62 }, 'forearm*': { a: 86 }, 'hand*': { a: 92 }, 'fingers*': { a: 92 },
    'thigh*': { a: 82, z: 14 }, 'shin*': { a: -98 }, 'foot*': { a: 86 }, 'toes*': { a: 92 },
    neck1: [-2, 0, 0], neck2: [4, 0, 0], head: [6, 0, 0], tail1: { a: -96, y: 30 }, tail2: [0, 22, 0], tail3: [0, 16, 0],
  }, { gait: { unguligrade: { bones: { 'upperarm*': { a: -62 }, 'forearm*': { a: 62 }, 'hand*': { a: -108 }, 'fingers*': { a: -86 } } } } }),
  P('sleep', 'Dorme', {
    'upperarm*': { a: -62 }, 'forearm*': { a: 86 }, 'hand*': { a: 92 }, 'fingers*': { a: 92 },
    'thigh*': { a: 82, z: 16 }, 'shin*': { a: -98 }, 'foot*': { a: 86 }, 'toes*': { a: 92 },
    spine1: [0, 14, 0], spine2: [0, 14, 0], chest: [0, 10, 0],
    neck1: [26, 30, 0], neck2: [14, 20, 0], head: [16, 14, 0],
    tail1: { a: -96, y: -44 }, tail2: [0, -30, 0], tail3: [0, -26, 0], tail4: [0, -20, 0],
    'ear*': [24, 0, 0],
  }, { sleep: true, gait: { unguligrade: { bones: { 'upperarm*': { a: -62 }, 'forearm*': { a: 62 }, 'hand*': { a: -108 }, 'fingers*': { a: -86 }, neck1: [6, 40, 0], neck2: [6, 30, 0], head: [20, 24, 0] } } } }),
  P('jump', 'Salto', {
    hips: [-16, 0, 0], spine1: [-6, 0, 0], spine2: [-6, 0, 0],
    'upperarm*': [-62, 0, 0], 'forearm*': [-46, 0, 0], 'hand*': [74, 0, 0],
    'thigh*': [52, 0, 0], 'shin*': [-24, 0, 0], 'foot*': [34, 0, 0], 'toes*': [16, 0, 0],
    neck1: [-6, 0, 0], head: [12, 0, 0], tail1: [-6, 0, 0], 'ear*': [24, 0, 0],
  }, { air: 0.35 }),
  P('attack', 'Attacco / ruggito', {
    hips: [8, 0, 0], spine1: [4, 0, 0], spine2: [6, 0, 0],
    'upperarm*': [-6, 0, 0], 'forearm*': [-22, 0, 0], 'hand*': [10, 0, 0],
    'upperarm.L': [-14, 0, -6],
    'thigh*': [-14, 0, 0], 'shin*': [38, 0, 0], 'foot*': [-30, 0, 0],
    neck1: [14, 0, 0], neck2: [-12, 0, 0], head: [-22, 0, 0], jaw: [36, 0, 0],
    tail1: [6, 0, 0], tail2: [4, 0, 0], 'ear*': [-30, 0, 0],
  }),
  P('lookup', 'Guarda in alto', {
    neck1: [-24, 0, 0], neck2: [-20, 0, 0], head: [-26, 8, 0], tail1: [6, 0, 0], 'ear*': [-10, 0, 0],
  }),
  P('play', 'Gioca', {
    hips: [24, 0, 0], spine1: [4, 0, 0], spine2: [6, 0, 0],
    'upperarm*': [-46, 0, 0], 'forearm*': [-96, 0, 0], 'hand*': [90, 0, 0], 'fingers*': [-8, 0, 0],
    'thigh*': [-20, 0, 0], 'shin*': [10, 0, 0], 'foot*': [-6, 0, 0],
    neck1: [-26, 0, 0], neck2: [-6, 0, 0], head: [-14, 0, 12], jaw: [14, 0, 0],
    tail1: [56, 0, 0], tail2: [20, 0, 0], tail3: [10, 0, 0], 'ear*': [-12, 0, 0],
  }, { only: ['cane_piccolo', 'cane_medio', 'cane_grande', 'lupo', 'volpe', 'gatto'] }),
  P('rear', 'Impennata', {
    hips: [-36, 0, 0], spine1: [-4, 0, 0], spine2: [-4, 0, 0],
    'thigh*': { a: 38 }, 'shin*': { a: -22 }, 'foot*': { a: 14 }, 'toes*': { a: 40 },
    'upperarm.L': { a: 62 }, 'forearm.L': { a: -24 }, 'hand.L': { a: -96 }, 'fingers.L': { a: -60 },
    'upperarm.R': { a: 40 }, 'forearm.R': { a: -42 }, 'hand.R': { a: -104 }, 'fingers.R': { a: -70 },
    neck1: [20, 0, 0], neck2: [6, 0, 0], head: [12, 0, 0], tail1: [24, 0, 0], tail2: [10, 0, 0], jaw: [10, 0, 0], 'ear*': [-30, 0, 0],
  }, { only: ['cavallo', 'zebra', 'unicorno', 'pegaso'] }),
];

// ------------------------------------------------------------------ primates (knuckle-walking stance at rest)
const PRIM = [
  P('stand', 'In piedi', {}),
  P('walk', 'Cammina', {
    'upperarm.L': [-18, 0, 0], 'forearm.L': [-10, 0, 0], 'upperarm.R': [16, 0, 0],
    'thigh.L': [10, 0, 0], 'shin.L': [10, 0, 0], 'thigh.R': [-24, 0, 0], 'shin.R': [36, 0, 0], 'foot.R': [-14, 0, 0],
    neck1: [4, 0, 0], head: [-4, -6, 0], spine2: [0, 4, 0],
  }),
  P('run', 'Corre', {
    hips: [10, 0, 0],
    'upperarm.L': [-50, 0, 0], 'forearm.L': [-30, 0, 0], 'upperarm.R': [-30, 0, 0], 'forearm.R': [-40, 0, 0],
    'thigh*': [36, 0, 0], 'shin*': [10, 0, 0], 'foot*': [16, 0, 0], head: [-10, 0, 0],
  }, { air: 0.08 }),
  P('upright', 'In piedi eretto', {
    hips: [-58, 0, 0], spine1: [-6, 0, 0], spine2: [-6, 0, 0],
    'thigh*': [36, 0, 8], 'shin*': [12, 0, 0], 'foot*': [10, 0, 0],
    'upperarm*': [62, 0, 14], 'forearm*': [-26, 0, 0], neck1: [18, 0, 0], head: [22, 0, 0],
  }),
  P('sit', 'Seduto', {
    hips: [-62, 0, 0], spine1: [8, 0, 0], spine2: [10, 0, 0],
    'thigh*': [-14, 0, 20], 'shin*': [100, 0, 0], 'foot*': [-50, 0, 0],
    'upperarm*': [52, 0, 6], 'forearm*': [-60, 0, 0], neck1: [22, 0, 0], head: [16, 0, 0],
  }),
  P('lie', 'Sdraiato', {
    hips: [10, 0, 0], 'upperarm*': [-60, 0, 20], 'forearm*': [-70, 0, 0],
    'thigh*': [-50, 0, 20], 'shin*': [90, 0, 0], neck1: [10, 0, 0], head: [-10, 0, 0],
  }),
  P('sleep', 'Dorme', {
    hips: [0, 0, 84], spine1: [10, 0, 0], spine2: [12, 0, 0],
    'upperarm*': [-60, 0, 0], 'forearm*': [-90, 0, 0], 'thigh*': [-70, 0, 0], 'shin*': [100, 0, 0], neck1: [20, 0, 0], head: [10, 0, 10],
  }, { sleep: true }),
  P('jump', 'Salto', {
    hips: [-30, 0, 0], 'upperarm*': [-120, 0, 20], 'forearm*': [-20, 0, 0], 'thigh*': [40, 0, 0], 'shin*': [-10, 0, 0], 'foot*': [30, 0, 0], head: [-10, 0, 0],
  }, { air: 0.3 }),
  P('attack', 'Attacco / ruggito', {
    hips: [-58, 0, 0], spine1: [-8, 0, 0], spine2: [-8, 0, 0],
    'thigh*': [30, 0, 10], 'shin*': [20, 0, 0], 'foot*': [6, 0, 0],
    'upperarm*': [-40, 0, 40], 'forearm*': [-100, 0, 0], 'hand*': [0, 0, 0],
    neck1: [10, 0, 0], head: [-14, 0, 0], jaw: [34, 0, 0],
  }),
  P('lookup', 'Guarda in alto', { neck1: [-24, 0, 0], neck2: [-14, 0, 0], head: [-28, 6, 0] }),
];

// ------------------------------------------------------------------ kangaroo (upright on hind legs and tail at rest)
const ROO = [
  P('stand', 'In piedi', {}),
  P('walk', 'Cammina', {
    hips: [48, 0, 0], spine1: [6, 0, 0], neck1: [-30, 0, 0], neck2: [-14, 0, 0], head: [-10, 0, 0],
    'upperarm*': [-40, 0, 0], 'forearm*': [10, 0, 0], 'hand*': [-20, 0, 0],
    'thigh*': [-30, 0, 0], 'shin*': [10, 0, 0], tail1: [-30, 0, 0], tail2: [-6, 0, 0],
  }),
  P('run', 'Salta / corre', {
    hips: [58, 0, 0], spine1: [-6, 0, 0], spine2: [-6, 0, 0], neck1: [-36, 0, 0], neck2: [-18, 0, 0], head: [-14, 0, 0],
    'upperarm*': [30, 0, 0], 'forearm*': [-30, 0, 0],
    'thigh*': [36, 0, 0], 'shin*': [-40, 0, 0], 'foot*': [50, 0, 0], 'toes*': [10, 0, 0],
    tail1: [-40, 0, 0], tail2: [-8, 0, 0], tail3: [-4, 0, 0], 'ear*': [20, 0, 0],
  }, { air: 0.35 }),
  P('sit', 'Seduto', {
    hips: [12, 0, 0], 'thigh*': [-30, 0, 0], 'shin*': [40, 0, 0], 'foot*': [-14, 0, 0],
    neck1: [-8, 0, 0], head: [-6, 0, 0], tail1: [-10, 0, 0],
  }),
  P('lie', 'Sdraiato', {
    hips: [0, 0, 82], spine1: [0, 10, 0], neck1: [10, 20, 0], head: [6, 10, 10],
    'thigh*': [-50, 0, 0], 'shin*': [70, 0, 0], 'foot*': [-20, 0, 0], 'upperarm*': [-30, 0, 0],
    tail1: [0, -20, 0], tail2: [0, -10, 0],
  }),
  P('sleep', 'Dorme', {
    hips: [0, 0, 84], spine1: [12, 14, 0], spine2: [12, 12, 0], neck1: [20, 26, 0], head: [16, 12, 12],
    'thigh*': [-70, 0, 0], 'shin*': [90, 0, 0], 'foot*': [-30, 0, 0], 'upperarm*': [-40, 0, 0], 'forearm*': [-40, 0, 0],
    tail1: [0, -30, 0], tail2: [0, -20, 0], tail3: [0, -14, 0], 'ear*': [30, 0, 0],
  }, { sleep: true }),
  P('jump', 'Salto', {
    hips: [40, 0, 0], neck1: [-30, 0, 0], head: [-10, 0, 0],
    'thigh*': [40, 0, 0], 'shin*': [-50, 0, 0], 'foot*': [60, 0, 0], 'toes*': [20, 0, 0],
    tail1: [-30, 0, 0], tail2: [-10, 0, 0], 'upperarm*': [20, 0, 0],
  }, { air: 0.5 }),
  P('attack', 'Attacco / boxe', {
    hips: [-16, 0, 0], spine1: [-4, 0, 0], 'thigh*': [26, 0, 0], 'shin*': [-30, 0, 0], 'foot*': [20, 0, 0],
    'upperarm.L': [-70, 0, 10], 'forearm.L': [-40, 0, 0], 'upperarm.R': [-40, 0, -10], 'forearm.R': [-80, 0, 0],
    neck1: [10, 0, 0], head: [6, 0, 0], jaw: [14, 0, 0], tail1: [30, 0, 0], 'ear*': [-20, 0, 0],
  }),
  P('lookup', 'Guarda in alto', { neck1: [-20, 0, 0], neck2: [-14, 0, 0], head: [-24, 6, 0], 'ear*': [-10, 0, 0] }),
];

export const FAMILY_POSES = { quadruped: QUAD, primate: PRIM, macropod: ROO };

/** Ready poses of a family added outside this file (families/*.js). */
export function registerPoses(family, list) { FAMILY_POSES[family] = list; }

// ------------------------------------------------------------------ rotation helpers (no three.js: also used at build time)
const D2R = Math.PI / 180;
export function eulerToQuat(e) { // degrees, intrinsic XYZ like THREE.Euler 'XYZ'
  const [a, b, c] = e.map((d) => (d * D2R) / 2);
  const c1 = Math.cos(a), c2 = Math.cos(b), c3 = Math.cos(c), s1 = Math.sin(a), s2 = Math.sin(b), s3 = Math.sin(c);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
export function quatToEuler(q) { // -> degrees XYZ (THREE.Euler.setFromRotationMatrix 'XYZ')
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - z * w), m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w), m32 = 2 * (y * z + x * w), m33 = 1 - 2 * (x * x + y * y);
  const yy = Math.asin(Math.max(-1, Math.min(1, m13)));
  let xx, zz;
  if (Math.abs(m13) < 0.9999999) { xx = Math.atan2(-m23, m33); zz = Math.atan2(-m12, m11); } else { xx = Math.atan2(m32, m22); zz = 0; }
  return [xx / D2R, yy / D2R, zz / D2R];
}
/** Rotation from the identity toward q at t (shortest arc). */
export function quatPow(q, t) {
  let [x, y, z, w] = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const half = Math.acos(Math.min(1, w)), s = Math.sin(half);
  if (s < 1e-9) return [0, 0, 0, 1];
  const k = Math.sin(half * t) / s;
  return [x * k, y * k, z * k, Math.cos(half * t)];
}

/** Bone Euler angles of the stored blends of a pose ({'wingFold*': 1, tailFan: 0.5}). */
function blendBones(entry, blend) {
  const out = {};
  if (!blend || !entry.blends) return out;
  for (const [k, t] of Object.entries(blend)) {
    const ids = k.endsWith('*') ? [k.slice(0, -1) + '.L', k.slice(0, -1) + '.R'] : [k];
    for (const id of ids) {
      for (const [bn, e] of Object.entries(entry.blends[id] || {})) out[bn] = t >= 1 ? e : quatToEuler(quatPow(eulerToQuat(e), t));
    }
  }
  return out;
}

/** Expands '*' keys: left as given, right mirrored. Returns {bone: [x, y, z]}. */
export function expandPose(bones) {
  const out = {};
  for (const [k, v] of Object.entries(bones)) {
    if (k.endsWith('*')) {
      const b = k.slice(0, -1);
      out[b + '.L'] = v;
      out[b + '.R'] = Array.isArray(v) ? [v[0], -v[1], -v[2]] : { ...v, y: -(v.y || 0), z: -(v.z || 0) };
    } else out[k] = v;
  }
  return out;
}

/** Poses available for a species entry (family list, filtered, with gait / species overrides merged). */
export function posesFor(entry) {
  const base = FAMILY_POSES[entry.family] || QUAD;
  const extra = entry.poses || {};
  return base.filter((p) => (!p.only || p.only.includes(entry.id)) && (!p.not || !p.not.includes(entry.id))).map((p) => {
    const ov = extra[p.id] || (p.gait && p.gait[entry.gait]) || null;
    if (!ov) return p;
    if (ov.replace) return { ...p, ...ov, bones: ov.bones };
    return { ...p, ...ov, bones: { ...p.bones, ...(ov.bones || {}) } };
  });
}

/**
 * Raw bone Euler XYZ (degrees) of a pose definition for a species entry:
 * expands '*' keys and turns absolute side-view angles into local rotations
 * using the species' rest bones (parents first).
 */
export function resolvePose(entry, def) {
  const bones = entry.bones;
  const byName = new Map(bones.map((b, i) => [b.name, i]));
  // def.compute(entry) -> {bone: [x, y, z]}: poses that depend on the species' bone lengths (snake coils)
  const ex = { ...blendBones(entry, def.blend), ...(def.compute ? def.compute(entry) : {}), ...expandPose(def.bones || def) };
  const out = {};
  const accX = new Float64Array(bones.length); // accumulated X rotation of the ancestors + self
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    const parentAcc = b.parent >= 0 ? accX[b.parent] : 0;
    let v = ex[b.name];
    if (v && !Array.isArray(v)) {
      const dz = b.tail[2] - b.head[2], dy = b.tail[1] - b.head[1];
      const rest = (Math.atan2(dz, -dy) * 180) / Math.PI;
      const target = v.a === 'rest' ? rest : v.a;
      // global angle = rest - (sum of X rotations): rotation +X swings a downward bone backwards
      let x = rest - parentAcc - target;
      while (x > 180) x -= 360;
      while (x < -180) x += 360;
      v = [x, v.y || 0, v.z || 0];
    }
    if (v) out[b.name] = v;
    accX[i] = parentAcc + (v ? v[0] : 0);
  }
  return out;
}
