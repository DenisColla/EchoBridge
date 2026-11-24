// Pose-dependent wrinkles.
//
// Two families of dynamic folds are added to the static drape of a garment:
//
// 1. Strain folds (everywhere, soft background). Every garment part keeps its
//    coarse (body resolution) rest surface with skin weights. After a pose change
//    the coarse vertices are CPU-skinned and, per vertex, the 2D deformation
//    gradient of the surface is fitted from the 1-ring (rest tangent coords ->
//    posed edge vectors). Its right Cauchy-Green tensor C = F^T F gives the
//    principal stretches: where the fabric is compressed (stretch < 1) folds
//    appear, running perpendicular to the compression; where it is pulled
//    (stretch > 1) fainter tension lines appear along the pull. They are drawn
//    from four precomputed fold fields per fine vertex (rings, around, two
//    diagonals; phases from smooth body coordinates + low-frequency noise; sharp
//    valleys, broad crests). Per frame only the four direction weights x
//    amplitude are computed per COARSE vertex, interpolated to the fine vertices:
//      disp = k * (static + amp * sum_p a_p * (field_p - bias)) (+ lift)
//    The peak-to-valley height is bounded by the slack the fabric has there
//    (pvCap: a close fit has little room to buckle into), and where the valleys
//    would go deeper than the inward room the pattern rises by at most LIFT_CAP of
//    its height: the rest is clipped flat on the body instead of inflating the
//    garment into a rubbery lump.
//
// 2. Crease folds (joint driven, the folds an artist draws). At the shoulder,
//    elbow, hip and knee the fabric on the inner side of the bend buckles into a
//    "half-lock" fan: arcs stacked across the crease line that converge at the
//    two pivots on the sides of the joint and fade there (the outer side is
//    pulled smooth). Each frame the bend angle and the direction of the bend are
//    read from the bone matrices (a dozen joints, no mesh work), then the fan is
//    evaluated on the fine vertices of the joint zones only: crisp valleys, soft
//    crests, wavelength and depth by fabric (denim broad and stiff, jersey soft
//    and many, lycra almost none). With the arms raised, thin tension ridges fan
//    out from the armpit down the torso side. Static ring stacks at cuffs and
//    ankles ease off as the elbow / knee bends (the sleeve or leg rides up).
//
// Strain is measured against a fold-free reference (rest pose with straight
// arms: the A-pose elbows are already bent). GPU skinning moves the displaced
// rest surface; normals are recomputed on the CPU. Layering (garments pushed
// over the ones below) and the skirt / leg collision are applied on top of it by
// GarmentRuntime (assemble.js).
import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { foldProfile } from './build.js';

const noiseGen = new ImprovedNoise();
/** smooth noise in [-1, 1] (approx) */
export const noise3 = (x, y, z) => noiseGen.noise(x, y, z) * 1.6;

const SQ2 = Math.SQRT1_2;
const TWO_PI = Math.PI * 2, INV_2PI = 1 / TWO_PI;

/** Scratch Float32Arrays shared by every garment runtime (grown on demand; never kept across calls). */
const _scratch = [];
export function scratch(slot, n) {
  let a = _scratch[slot];
  if (!a || a.length < n) a = _scratch[slot] = new Float32Array(Math.ceil(n * 1.25));
  return a;
}
/** fold fields are stored as Int16 (x 1/PROF_Q): fields lie in about [-1, 1] */
const PROF_Q = 8192;
/** fold field centre: crests rise by (1 - bias), valleys sink by bias (x amplitude) */
export const FOLD_BIAS = 0.5;
/** compression where folds start / where they reach full depth (fraction of the length) */
const COMP_MIN = 0.012, COMP_FULL = 0.18;
/** depth of fully developed folds relative to the garment fold amplitude (peak to valley ~ 0.5 wavelength) */
const RESPONSE = 0.45;
const TEN_MIN = 0.04, TEN_FULL = 0.26;
/** share of RESPONSE drawn by tension (pulled fabric shows faint lines, it does not buckle) */
const TEN_SHARE = 0.35;
/**
 * Most a fold pattern may rise outwards where its valleys cannot sink into the
 * body (share of its peak-to-valley height): beyond that the valleys are
 * clipped flat on the body. A whole pattern lifted by its full depth reads as an
 * inflated, rubbery garment (seat, knee, shoulders).
 */
export const LIFT_CAP = 0.25;

// ------------------------------------------------------------------ crease folds
/**
 * Joint fold behaviour per fabric. depth: peak-to-valley (m) of fully developed
 * joint folds at garment k = 1 and Vestibilità 0.5; wl: crease wavelength x the
 * garment's limb fold wavelength; ten: height (m) of the tension ridges (arms
 * raised); pv: scale of the slack bound of the strain folds.
 */
export const FOLD_FABRIC = {
  jersey: { depth: 0.0324, wl: 0.85, ten: 0.0086, pv: 1 },
  fleece: { depth: 0.0367, wl: 0.9, ten: 0.0067, pv: 1.15 },
  tricot: { depth: 0.0338, wl: 0.9, ten: 0.0098, pv: 1 },
  denim: { depth: 0.0344, wl: 1.0, ten: 0.0093, pv: 1 },
  poplin: { depth: 0.0297, wl: 0.85, ten: 0.0133, pv: 0.95 },
  wool: { depth: 0.0324, wl: 0.95, ten: 0.0098, pv: 0.95 },
  canvas: { depth: 0.0367, wl: 1.0, ten: 0.0098, pv: 1.1 },
  crepe: { depth: 0.0270, wl: 0.85, ten: 0.0069, pv: 0.9 },
  lycra: { depth: 0.0047, wl: 0.8, ten: 0.0013, pv: 0.35 },
};
const NO_CREASE = { depth: 0, wl: 1, ten: 0, pv: 0.8 };
export const foldFabric = (id) => FOLD_FABRIC[id] || NO_CREASE;

/** Angle (rad) from the inner side of a bend where its folds converge (the pivots, slightly past the sides). */
const PIV = 0.6 * Math.PI, INV_PIV = 1 / PIV;
/** Valley share of a crease fold (the rest rises as a crest). */
const CREASE_BIAS = 0.36;
/** Most a crease fold rises where its valley cannot sink (share of its peak-to-valley). */
const CREASE_LIFT = 0.26;
/** Diagonal tilt of the crease arcs (rad of phase per rad around): bent sleeves fold in spirals and Zs. */
const CREASE_TILT = 0.55;
/** Shortest crease wavelength in vertex spacings (fewer samples alias into lumps). */
const CREASE_SAMPLES = 3.3;
/** Static ring stacks at cuffs / ankles fade by this share when the elbow / knee is fully bent. */
const RING_EASE = 0.55;

/** Crease profile 0..1 with period 2pi: crisp valley at 0, soft crest at pi. */
const CP_N = 256;
const CPROF = new Float32Array(CP_N + 1);
for (let i = 0; i <= CP_N; i++) CPROF[i] = Math.pow(Math.abs(Math.sin((i / CP_N) * Math.PI)), 0.5);
/** Tension ridge profile 0..1 with period 2pi: a soft ridge at 0, flat in between (narrower would alias on the mesh). */
const TPROF = new Float32Array(CP_N + 1);
for (let i = 0; i <= CP_N; i++) TPROF[i] = Math.pow(0.5 + 0.5 * Math.cos((i / CP_N) * Math.PI * 2), 3);
function prof(T, ph) {
  let t = ph * INV_2PI;
  t -= Math.floor(t);
  const f = t * CP_N, i = f | 0;
  return T[i] + (T[i + 1] - T[i]) * (f - i);
}

/**
 * Joints: bend measured between a parent and a child bone. root = shoulder /
 * hip (the swing of the limb relative to the A-pose, read in the shoulder /
 * pelvis bone), mid = elbow / knee (absolute bend). ref: bend without folds,
 * full: bend where the folds are fully developed (rad).
 */
const JOINT_SPEC = {
  arm: [
    { parent: 'shoulder01', child: 'upperarm01', ref: 0.15, full: 2.0, at: 0.1, depth: 0.6 },
    { parent: 'upperarm02', child: 'lowerarm01', ref: 0.26, full: 1.75, at: 1, depth: 1 },
  ],
  leg: [
    { parent: 'pelvis', child: 'upperleg01', ref: 0.1, full: 1.5, at: 0.16, depth: 1 },
    { parent: 'upperleg02', child: 'lowerleg01', ref: 0.15, full: 1.65, at: 1, depth: 1 },
  ],
};

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const angDiff = (a, b) => { let d = a - b; d -= TWO_PI * Math.round(d * INV_2PI); return d; };

/**
 * Builds the joint crease folds of one draft (build time).
 * o: {wr (catalog wrinkle spec), fabric id, fitT, base Float32Array(nf) (amplitude
 *     multiplier: hem calm, bands, fades), spacing [5] (median fine edge per region)}
 * Returns {joints, rec, ten, ring, cover} or null. cover (Float32Array nf, 0..1):
 * where the crease folds own the compression (the strain folds are toned down there).
 */
export function creaseSetup(draft, bi, o) {
  const C = draft.coords, P = draft.P, nf = draft.nf;
  if (!C || !C.limb || !bi || !bi.limbs) return null;
  const model = bi.topo?.model;
  if (!model) return null;
  const fab = foldFabric(o.fabric);
  const wr = o.wr || {}, fitT = o.fitT ?? 0.5;
  const kg = wr.k ?? 0.8;
  const depth = fab.depth * kg * (0.55 + 0.9 * fitT);
  const joints = [], jmap = new Map();
  const joint = (r, mid) => {
    const key = r * 2 + (mid ? 1 : 0);
    if (jmap.has(key)) return jmap.get(key);
    const arm = r <= 2, side = r === 1 || r === 3 ? 'L' : 'R';
    const sp = JOINT_SPEC[arm ? 'arm' : 'leg'][mid ? 1 : 0];
    const pb = model.boneIndex.get(sp.parent + '.' + side), cb = model.boneIndex.get(sp.child + '.' + side);
    if (pb === undefined || cb === undefined) { jmap.set(key, -1); return -1; }
    const L = bi.limbs[r];
    const v3 = (A, s) => [A[s * 3], A[s * 3 + 1], A[s * 3 + 2]];
    const j = {
      r, arm, mid, pb, cb, ref: sp.ref, full: sp.full,
      Dp: v3(L.D, 0), Dc: v3(L.D, mid ? 1 : 0),
      Rp: mid ? v3(L.R, 0) : null, Qp: mid ? v3(L.Q, 0) : null, Rc: v3(L.R, mid ? 1 : 0), Qc: v3(L.Q, mid ? 1 : 0),
      // direction whose bend drives the tension ridges: arms up (theta 0), hips forward (front)
      up: arm ? 0 : Math.atan2(L.Q[2], L.R[2]),
      g: 0, thP: 0, thC: 0, raise: 0,
    };
    joints.push(j);
    jmap.set(key, joints.length - 1);
    return joints.length - 1;
  };
  const base = o.base, sp = o.spacing || [0, 0, 0, 0, 0];
  const wlArm = Math.max((wr.wlArm ?? (wr.wl ?? 0.05) * 0.75) * fab.wl, CREASE_SAMPLES * (sp[1] || sp[2] || 0.01));
  const wlLeg = Math.max((wr.wlLeg ?? (wr.wl ?? 0.05) * 0.95) * fab.wl, CREASE_SAMPLES * (sp[3] || sp[4] || 0.012));
  const cover = new Float32Array(nf);
  const idx = [], slot = [], sA = [], thA = [], ampA = [], phA = [], kA = [];
  if (depth > 1e-4) {
    for (let i = 0; i < nf; i++) {
      const r = C.limb[i];
      if (!r) continue;
      const a = C.aL[i];
      const arm = r <= 2, Lf = bi.limbs[r];
      const wl = arm ? wlArm : wlLeg, K = TWO_PI / wl;
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const b = base ? base[i] : 1;
      if (b < 0.02) continue;
      const mid = a > 0.5;
      if (a > 1.5) continue;
      // fold zone along the limb axis around the crease line
      const sC = mid ? Lf.L[0] : (arm ? JOINT_SPEC.arm[0].at : JOINT_SPEC.leg[0].at) * Lf.L[0];
      const s = C.sL[i] - sC;
      const E = (mid ? 2.3 : arm ? 2.0 : 2.6) * wl;
      const t = s / E;
      if (t <= -1 || t >= 1) continue;
      let env = (1 - t * t) * (1 - t * t);
      // limb-blend vertices deep in the torso (around the armpit / groin) fade out
      if (!mid) env *= smooth01((a + 0.28) / 0.18);
      if (env < 0.01) continue;
      const js = joint(r, mid);
      if (js < 0) continue;
      const n1 = noise3(x * 6.1 + 3.1, y * 6.1 - 1.7, z * 6.1 + 5.3);
      idx.push(i); slot.push(js * 2 + (mid && a < 1 ? 0 : 1)); sA.push(s); thA.push(C.thL[i]);
      ampA.push(depth * (arm ? JOINT_SPEC.arm : JOINT_SPEC.leg)[mid ? 1 : 0].depth * env * b * (0.8 + 0.25 * n1)); phA.push(0.8 * noise3(x * 9.3 - 7, y * 9.3 + 2, z * 9.3 - 4) + Math.PI * 0.08); kA.push(K);
      if (env > cover[i]) cover[i] = env;
    }
  }
  // tension ridges (drag lines): from the armpit down the torso side when the
  // arms are raised, from the crotch towards the knee across the front of the
  // thigh when the hip is flexed (sitting). Static fields, scaled per frame by
  // the joint's drive (see _joints)
  const tIdx = [], tVal = [], tJ = [];
  const tDepth = fab.ten * ((wr.kt ?? 0.35) / 0.35) * (1.25 - 0.5 * fitT);
  if (tDepth > 2e-5) {
    const tmp = new Float32Array(9);
    const push = (i, v, r) => {
      const js = joint(r, false);
      if (js < 0 || v < 2e-5) return;
      tIdx.push(i); tVal.push(v); tJ.push(js);
    };
    // armpits (torso coords), then one pass over the torso vertices for both arms
    const ap = [1, 2].map((r) => { const J = bi.limbs[r].J; bi.torsoCyl(J[0], J[1], J[2], tmp); return { r, th: tmp[0], y: J[1] - 0.075 }; });
    const yHi = Math.max(ap[0].y, ap[1].y) + 0.02, yLo = Math.min(ap[0].y, ap[1].y) - 0.34;
    for (let i = 0; i < nf; i++) {
      if (C.limb[i] && C.wT[i] < 0.55) continue;
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      if (y > yHi || y < yLo) continue;
      bi.torsoCyl(x, y, z, tmp);
      const thV = tmp[0], rV = tmp[1];
      for (const a of ap) {
        const dy = y - a.y;
        if (dy > 0.02 || dy < -0.34) continue;
        const dth = angDiff(thV, a.th);
        if (Math.abs(dth) > 1.7) continue;
        const dx = rV * dth, rho = Math.hypot(dx, dy);
        if (rho < 0.025 || rho > 0.32) continue;
        const psi = Math.atan2(dx, -dy);
        if (Math.abs(psi) > 1.35) continue;
        const envR = smooth01((rho - 0.025) / 0.05) * (1 - smooth01((rho - 0.14) / 0.18));
        const envA = Math.cos((psi / 1.35) * Math.PI * 0.5);
        const b = base ? base[i] : 1;
        const n1 = noise3(x * 8.3 + 1, y * 8.3 - 5, z * 8.3 + 2);
        push(i, tDepth * envR * envA * b * prof(TPROF, 14 * psi + 1.1 * n1) * (0.75 + 0.3 * n1), a.r);
      }
    }
    // crotch -> knee drag lines (legs: theta 0 = outer side, front = +z)
    for (const r of [3, 4]) {
      const Lf = bi.limbs[r];
      // theta 0 is the outer side, so the inner side is at pi
      const thF = Math.atan2(Lf.Q[2], Lf.R[2]), thM = Math.PI;
      const th0 = thF + 0.45 * angDiff(thM, thF); // front-inner top of the thigh
      const s0 = 0.06 * Lf.L[0];
      for (let i = 0; i < nf; i++) {
        if (C.limb[i] !== r || C.aL[i] < 0 || C.aL[i] > 0.95) continue;
        const ds = C.sL[i] - s0;
        if (ds < 0.02) continue;
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        Lf.cyl(C.aL[i], x, y, z, tmp);
        const dx = tmp[1] * angDiff(C.thL[i], th0), rho = Math.hypot(dx, ds);
        const psi = Math.atan2(dx * (angDiff(thF, thM) > 0 ? 1 : -1), ds); // > 0 towards the outer front
        if (psi < -0.45 || psi > 1.25 || rho > 0.34) continue;
        const envR = smooth01((rho - 0.03) / 0.06) * (1 - smooth01((rho - 0.16) / 0.18));
        const envA = Math.sin(((psi + 0.45) / 1.7) * Math.PI);
        const b = base ? base[i] : 1;
        const n1 = noise3(x * 8.1 - 3, y * 8.1 + 4, z * 8.1 + 6);
        push(i, 1.25 * tDepth * envR * envA * b * prof(TPROF, 11 * psi + 1.2 * n1) * (0.75 + 0.3 * n1), r);
      }
    }
  }
  // static ring stacks of the limbs (cuff bunching, ankle stacking) ease off with the bend
  let ring = null;
  if (o.ring) {
    const rIdx = [], rVal = [], rJ = [];
    for (let i = 0; i < nf; i++) {
      const v = o.ring[i];
      if (!v) continue;
      const r = C.limb[i];
      const js = r ? joint(r, true) : -1;
      if (js < 0) continue;
      rIdx.push(i); rVal.push(v); rJ.push(js);
      o.ring[i] = 0; // taken: the caller keeps the rest static
    }
    if (rIdx.length) ring = { idx: Uint32Array.from(rIdx), val: Float32Array.from(rVal), j: Uint8Array.from(rJ) };
  }
  if (!idx.length && !tIdx.length && !ring) return null;
  return {
    joints,
    rec: { n: idx.length, idx: Uint32Array.from(idx), slot: Uint8Array.from(slot), s: Float32Array.from(sA), th: Float32Array.from(thA), amp: Float32Array.from(ampA), ph: Float32Array.from(phA), K: Float32Array.from(kA) },
    ten: { n: tIdx.length, idx: Uint32Array.from(tIdx), val: Float32Array.from(tVal), j: Uint8Array.from(tJ) },
    ring,
    cover,
  };
}

/**
 * Wrinkle runtime of one garment part.
 * src: {coarse:{n, G, adj, skin:{idx,w}, coordsFrame}, nf, parents, profiles Float32Array(nf*4),
 *       amp Float32Array(nf), room Float32Array(nf), stat Float32Array(nf), pvCap? [base, perRoom],
 *       vcap?, crease? (creaseSetup)}
 */
export class WrinklePart {
  constructor(src) {
    const c = src.coarse;
    this.n = c.n;
    this.G = c.G;
    this.skinIdx = c.skin.idx;
    this.skinW = c.skin.w;
    this.adj = c.adj;
    this.nf = src.nf;
    // compact copies: coarse indices fit 16 bits, the fold fields 16-bit fixed point
    this.pIdx = this.n < 65536 ? Uint16Array.from(src.parents.idx) : src.parents.idx;
    this.pW = src.parents.w;
    const pf = src.profiles; // nf*4, already centered (field - bias)
    this.prof = new Int16Array(pf.length);
    for (let i = 0; i < pf.length; i++) this.prof[i] = Math.max(-32767, Math.min(32767, Math.round(pf[i] * PROF_Q)));
    this.amp = src.amp;
    this.room = src.room;
    /** per fine vertex: depth (m) below which valleys are squeezed (taut spans), or null */
    this.vcap = src.vcap || null;
    /**
     * slack bound of the strain folds [base, per m of room]: most peak-to-valley
     * height (m, at intensity 1) = base + room * perRoom; null = unbounded
     */
    this.pvCap = src.pvCap || null;
    this.stat = src.stat;
    this.kc = src.kc ?? 1;
    this.kt = src.kt ?? 0.35;
    this.spread = src.spread ?? 2;
    this.bias = src.bias ?? FOLD_BIAS;
    /** joint crease folds (creaseSetup) and their per-frame displacement */
    this.crease = src.crease || null;
    this.cd = this.crease ? new Float32Array(this.nf) : null;
    this.disp = new Float32Array(this.nf);
    this.active = false; // any dynamic fold currently applied
    // bones influencing this part: their skin matrices are compared every
    // frame, an unchanged set means unchanged folds (posing a finger never
    // re-evaluates the trousers)
    this._basis = c.basis;
    this._refM = src.refM;
    this.rebind();
  }

  /** (Re)derives everything that depends on the skin weights (after they changed). */
  rebind() {
    const used = new Set();
    for (let i = 0; i < this.skinW.length; i++) if (this.skinW[i] > 0) used.add(this.skinIdx[i]);
    // the bones the crease folds read their bends from
    if (this.crease) for (const j of this.crease.joints) { used.add(j.pb); used.add(j.cb); }
    this.bones = Int32Array.from([...used]);
    this.lastM = new Float32Array(this.bones.length * 16).fill(NaN);
    this._precompute(this._basis, this._refM);
  }

  /** True when the skin matrices of this part's bones changed since the last update. */
  _bonesMoved(M) {
    const { bones, lastM } = this;
    let moved = false;
    for (let b = 0; b < bones.length; b++) {
      const o = bones[b] * 16, l = b * 16;
      for (let k = 0; k < 12; k++) {
        const x = M[o + k];
        if (Math.abs(x - lastM[l + k]) > 1e-6 || lastM[l + k] !== lastM[l + k]) { moved = true; lastM[l + k] = x; }
      }
      lastM[l + 12] = M[o + 12]; lastM[l + 13] = M[o + 13]; lastM[l + 14] = M[o + 14];
    }
    return moved;
  }

  /** Linear blend skinning of the coarse rest surface with precomputed matrices -> Q. */
  _skin(M, Q) {
    const { n, G, skinIdx, skinW } = this;
    for (let i = 0; i < n; i++) {
      const x = G[i * 3], y = G[i * 3 + 1], z = G[i * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let k = 0; k < 4; k++) {
        const w = skinW[i * 4 + k];
        if (!w) continue;
        const o = skinIdx[i * 4 + k] * 16;
        ox += w * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
        oy += w * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
        oz += w * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
      }
      Q[i * 3] = ox; Q[i * 3 + 1] = oy; Q[i * 3 + 2] = oz;
    }
  }

  /** Rest tangent frames, 2D neighbour coords and the inverse second moments. */
  _precompute(basis, refM) {
    const { n, G, adj } = this;
    const deg = adj.off[n];
    this.R2 = new Float32Array(deg * 2);
    this.Minv = new Float32Array(n * 3);
    this.E = basis; // e1(3) e2(3) per vertex
    this.Crest = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const e = i * 6;
      let m11 = 0, m12 = 0, m22 = 0;
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) {
        const u = adj.adj[j];
        const rx = G[u * 3] - G[i * 3], ry = G[u * 3 + 1] - G[i * 3 + 1], rz = G[u * 3 + 2] - G[i * 3 + 2];
        const a = rx * basis[e] + ry * basis[e + 1] + rz * basis[e + 2];
        const b = rx * basis[e + 3] + ry * basis[e + 4] + rz * basis[e + 5];
        this.R2[j * 2] = a; this.R2[j * 2 + 1] = b;
        m11 += a * a; m12 += a * b; m22 += b * b;
      }
      const det = m11 * m22 - m12 * m12;
      if (det > 1e-14) { this.Minv[i * 3] = m22 / det; this.Minv[i * 3 + 1] = -m12 / det; this.Minv[i * 3 + 2] = m11 / det; }
    }
    // fold-free reference tensor, subtracted later. The reference is the rest
    // pose with straightened elbows (see referenceSkin): the A-pose elbows are
    // ~40 deg flexed, a sleeve built there would show no folds when sitting
    // with bent arms and pulled ones on a straight arm.
    if (refM) { const Q = scratch(2, n * 3); this._skin(refM, Q); this._tensors(Q, this.Crest, null); } else this._tensors(G, this.Crest, null);
  }

  /** Laplacian smoothing of the per-vertex strain tensors (in place). */
  _smoothTensor(C, passes) {
    const { n, adj } = this;
    const T = scratch(6, n * 3);
    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < n; i++) {
        let a = 0, b = 0, c = 0;
        const j0 = adj.off[i], j1 = adj.off[i + 1];
        for (let j = j0; j < j1; j++) { const u = adj.adj[j] * 3; a += C[u]; b += C[u + 1]; c += C[u + 2]; }
        const o = i * 3, d = j1 - j0;
        if (!d) { T[o] = C[o]; T[o + 1] = C[o + 1]; T[o + 2] = C[o + 2]; continue; }
        const h = 0.5 / d;
        T[o] = C[o] * 0.5 + a * h; T[o + 1] = C[o + 1] * 0.5 + b * h; T[o + 2] = C[o + 2] * 0.5 + c * h;
      }
      C.set(T.subarray(0, n * 3));
    }
  }

  /** C = F^T F per coarse vertex from positions X. out: n*3 (c11, c12, c22). */
  _tensors(X, out, rest) {
    const { n, adj, R2, Minv } = this;
    for (let i = 0; i < n; i++) {
      let a1x = 0, a1y = 0, a1z = 0, a2x = 0, a2y = 0, a2z = 0;
      const ox = X[i * 3], oy = X[i * 3 + 1], oz = X[i * 3 + 2];
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) {
        const u = adj.adj[j] * 3;
        const qx = X[u] - ox, qy = X[u + 1] - oy, qz = X[u + 2] - oz;
        const r1 = R2[j * 2], r2 = R2[j * 2 + 1];
        a1x += qx * r1; a1y += qy * r1; a1z += qz * r1;
        a2x += qx * r2; a2y += qy * r2; a2z += qz * r2;
      }
      const i11 = Minv[i * 3], i12 = Minv[i * 3 + 1], i22 = Minv[i * 3 + 2];
      const f1x = a1x * i11 + a2x * i12, f1y = a1y * i11 + a2y * i12, f1z = a1z * i11 + a2z * i12;
      const f2x = a1x * i12 + a2x * i22, f2y = a1y * i12 + a2y * i22, f2z = a1z * i12 + a2z * i22;
      let c11 = f1x * f1x + f1y * f1y + f1z * f1z, c12 = f1x * f2x + f1y * f2y + f1z * f2z, c22 = f2x * f2x + f2y * f2y + f2z * f2z;
      if (rest) { c11 -= rest[i * 3] - 1; c12 -= rest[i * 3 + 1]; c22 -= rest[i * 3 + 2] - 1; }
      out[i * 3] = c11; out[i * 3 + 1] = c12; out[i * 3 + 2] = c22;
    }
  }

  /**
   * Bend state of every crease joint from the skin matrices: g (0..1, how far
   * the folds are developed), thP / thC (angle of the inner side of the bend in
   * the parent / child limb segment frame, rest space), raise (arm lifted
   * towards its top side: drives the armpit tension ridges). Returns max g.
   */
  _joints(M) {
    let gMax = 0;
    for (const j of this.crease.joints) {
      const o = j.pb * 16, q = j.cb * 16, Dp = j.Dp, Dc = j.Dc;
      // posed directions: the parent segment (for the root: the limb as it would
      // be without its own swing) and the child segment
      let ux = M[o] * Dp[0] + M[o + 4] * Dp[1] + M[o + 8] * Dp[2];
      let uy = M[o + 1] * Dp[0] + M[o + 5] * Dp[1] + M[o + 9] * Dp[2];
      let uz = M[o + 2] * Dp[0] + M[o + 6] * Dp[1] + M[o + 10] * Dp[2];
      let dx = M[q] * Dc[0] + M[q + 4] * Dc[1] + M[q + 8] * Dc[2];
      let dy = M[q + 1] * Dc[0] + M[q + 5] * Dc[1] + M[q + 9] * Dc[2];
      let dz = M[q + 2] * Dc[0] + M[q + 6] * Dc[1] + M[q + 10] * Dc[2];
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1, dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      ux /= ul; uy /= ul; uz /= ul; dx /= dl; dy /= dl; dz /= dl;
      const c = Math.max(-1, Math.min(1, ux * dx + uy * dy + uz * dz));
      // folds show early in a bend and saturate (ease-out)
      let t = (Math.acos(c) - j.ref) / (j.full - j.ref);
      t = t <= 0 ? 0 : t >= 1 ? 1 : t;
      const g = 1 - (1 - t) * (1 - t);
      j.g = g;
      if (g < 1e-3) { j.g = 0; j.raise = 0; continue; }
      if (g > gMax) gMax = g;
      // inner side of the bend. Parent side: towards the child (d - c u), in the
      // parent's rest frame; child side: back towards the parent (-(u - c d)), the
      // side facing the motion, in the child's rest frame
      if (j.Rp) {
        const vx = dx - c * ux, vy = dy - c * uy, vz = dz - c * uz;
        const rx = M[o] * vx + M[o + 1] * vy + M[o + 2] * vz, ry = M[o + 4] * vx + M[o + 5] * vy + M[o + 6] * vz, rz = M[o + 8] * vx + M[o + 9] * vy + M[o + 10] * vz;
        j.thP = Math.atan2(rx * j.Qp[0] + ry * j.Qp[1] + rz * j.Qp[2], rx * j.Rp[0] + ry * j.Rp[1] + rz * j.Rp[2]);
      }
      const vx = c * dx - ux, vy = c * dy - uy, vz = c * dz - uz;
      const rx = M[q] * vx + M[q + 1] * vy + M[q + 2] * vz, ry = M[q + 4] * vx + M[q + 5] * vy + M[q + 6] * vz, rz = M[q + 8] * vx + M[q + 9] * vy + M[q + 10] * vz;
      j.thC = Math.atan2(rx * j.Qc[0] + ry * j.Qc[1] + rz * j.Qc[2], rx * j.Rc[0] + ry * j.Rc[1] + rz * j.Rc[2]);
      // drive of the tension ridges: arm raised towards its top (theta 0 = world
      // up in the A-pose), thigh flexed forwards
      j.raise = j.mid ? 0 : g * Math.max(0, Math.cos(j.thC - j.up));
    }
    return gMax;
  }

  /** Crease, tension and ring-stack displacement (m) of this pose into this.cd. Returns its largest |value|. */
  _creases(M, k) {
    const cr = this.crease, cd = this.cd, js = cr.joints, room = this.room;
    const gMax = this._joints(M);
    const R = cr.rec, T = cr.ten, G = cr.ring;
    for (let r = 0; r < R.n; r++) cd[R.idx[r]] = 0;
    for (let t = 0; t < T.n; t++) cd[T.idx[t]] = 0;
    if (G) for (let t = 0, n = G.idx.length; t < n; t++) cd[G.idx[t]] = 0;
    let mx = 0;
    if (gMax > 0) {
      const { idx, slot, s, th, amp, ph, K } = R;
      for (let r = 0, n = R.n; r < n; r++) {
        const sl = slot[r], j = js[sl >> 1], g = j.g;
        if (g === 0) continue;
        let dt = th[r] - (sl & 1 ? j.thC : j.thP);
        dt -= TWO_PI * Math.round(dt * INV_2PI);
        const u = (dt < 0 ? -dt : dt) * INV_PIV;
        if (u >= 1) continue;
        const w = Math.sqrt(1 - u * u);
        const ae = amp[r] * g * w * k; // peak to valley (m)
        if (ae < 2e-5) continue;
        // arcs stacked across the crease line, converging at the pivots
        const sh = s[r] / (w > 0.35 ? w : 0.35);
        let d = ae * (prof(CPROF, K[r] * sh + ph[r] + CREASE_TILT * dt) - CREASE_BIAS);
        // the valleys sink into the room the fabric has; beyond it the fold rises
        // (a crease keeps most of its V valley on the body: clipped valleys read as
        // lumps), by at most CREASE_LIFT of its depth: the joint zone does not inflate
        const i = idx[r];
        const lift = CREASE_BIAS * ae - room[i];
        if (lift > 0) d += lift < CREASE_LIFT * ae ? lift : CREASE_LIFT * ae;
        cd[i] += d;
        if (ae > mx) mx = ae;
      }
      for (let t = 0, n = T.n; t < n; t++) {
        const v = T.val[t] * js[T.j[t]].raise * k;
        cd[T.idx[t]] += v;
        if (v > mx) mx = v;
      }
    }
    if (G) {
      for (let t = 0, n = G.idx.length; t < n; t++) cd[G.idx[t]] += G.val[t] * k * (1 - RING_EASE * js[G.j[t]].g);
      if (gMax > 0 && mx < 1e-4) mx = 1e-4; // eased ring stacks differ from the rest drape
    }
    return mx;
  }

  /**
   * Updates the fine displacement for the character's current pose.
   * k: global x garment intensity. Returns true when the displacement changed.
   */
  update(ch, k, M = ch.updateSkinMatrices()) {
    const { n, nf, adj } = this;
    if (!this._bonesMoved(M) && this._k === k) return false;
    const Q = scratch(2, n * 3), A = scratch(3, n * 4), A2 = scratch(4, n * 4), C = scratch(5, n * 3);
    const cmax = this.crease ? this._creases(M, k) : 0;
    this._skin(M, Q);
    this._tensors(Q, C, this.Crest);
    // the strain of a skinned mesh is noisy at the vertex scale: smoothing the
    // tensor (not the amplitudes) gives coherent fold directions, hence long ridges
    this._smoothTensor(C, 2);
    const kc = this.kc, kt = this.kt;
    let maxA = 0;
    for (let i = 0; i < n; i++) {
      const a = C[i * 3], b = C[i * 3 + 1], c = C[i * 3 + 2];
      const tr = (a + c) * 0.5, dd = Math.sqrt(((a - c) * 0.5) ** 2 + b * b);
      const l1 = Math.sqrt(Math.max(0, tr - dd)), l2 = Math.sqrt(Math.max(0, tr + dd));
      const comp = 1 - l1, ten = l2 - 1;
      let amp = 0;
      // response (fraction of the full fold depth): a few % of compression already
      // buckles the fabric visibly; beyond ~30% it stacks into the same folds
      if (comp > COMP_MIN) amp += kc * RESPONSE * Math.sqrt(Math.min(1, (comp - COMP_MIN) / COMP_FULL));
      if (ten > TEN_MIN) amp += kt * RESPONSE * TEN_SHARE * Math.sqrt(Math.min(1, (ten - TEN_MIN) / TEN_FULL));
      // direction of the smallest stretch: cos/sin of twice its angle
      let c2 = 1, s2 = 0;
      if (dd > 1e-6) { c2 = -(a - c) * 0.5 / dd; s2 = -b / dd; }
      // direction weights (sum 1), sharpened so that one fold field dominates:
      // blending two orientations gives lumps instead of ridges
      const cc = c2 * c2 * c2 * c2, ss = s2 * s2 * s2 * s2, nw = 1 / (cc + ss || 1);
      const w0 = c2 > 0 ? cc * nw : 0, w90 = c2 < 0 ? cc * nw : 0;
      const w45 = s2 > 0 ? ss * nw : 0, w135 = s2 < 0 ? ss * nw : 0;
      A[i * 4] = amp * w0; A[i * 4 + 1] = amp * w90; A[i * 4 + 2] = amp * w45; A[i * 4 + 3] = amp * w135;
      if (amp > maxA) maxA = amp;
    }
    if (maxA < 1e-3 && cmax < 1e-5 && !this.active && this._k === k) return false;
    // spread the direction amplitudes over a ring or two: fabric bunches around
    // the crease, not only on its vertices (max-preserving diffusion)
    let src = A, dst = A2;
    for (let pass = 0; pass < this.spread; pass++) {
      for (let i = 0; i < n; i++) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        const d = adj.off[i + 1] - adj.off[i];
        for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j] * 4; s0 += src[u]; s1 += src[u + 1]; s2 += src[u + 2]; s3 += src[u + 3]; }
        const o = i * 4, h = d ? 0.5 / d : 0, g = d ? 0.5 : 1;
        // keep 85% of a vertex's own amplitude so the crease stays the deepest
        dst[o] = Math.max(src[o] * 0.85, src[o] * g + s0 * h);
        dst[o + 1] = Math.max(src[o + 1] * 0.85, src[o + 1] * g + s1 * h);
        dst[o + 2] = Math.max(src[o + 2] * 0.85, src[o + 2] * g + s2 * h);
        dst[o + 3] = Math.max(src[o + 3] * 0.85, src[o + 3] * g + s3 * h);
      }
      const t = src; src = dst; dst = t;
    }
    const AF = src;
    const { pIdx, pW, prof: pf, amp, room, stat, disp, bias, vcap, cd } = this;
    const capOn = !!this.pvCap, cap0 = capOn ? this.pvCap[0] * k : 0, capR = capOn ? this.pvCap[1] * k : 0;
    for (let i = 0; i < nf; i++) {
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
      const o4 = i * 4;
      for (let q = 0; q < 4; q++) {
        const w = pW[o4 + q];
        if (!w) continue;
        const p = pIdx[o4 + q] * 4;
        a0 += w * AF[p]; a1 += w * AF[p + 1]; a2 += w * AF[p + 2]; a3 += w * AF[p + 3];
      }
      let ai = amp[i] * k;
      // peak-to-valley height bounded by the slack of the fabric here
      const sa = a0 + a1 + a2 + a3;
      let pv = ai * sa;
      if (capOn) { const cap = cap0 + capR * room[i]; if (pv > cap) { pv = cap; ai = pv / sa; } }
      let d = stat[i] * k + ai * (1 / PROF_Q) * (a0 * pf[o4] + a1 * pf[o4 + 1] + a2 * pf[o4 + 2] + a3 * pf[o4 + 3]);
      // the fabric cannot fold into the body: where the inward room is smaller
      // than the valleys, the pattern rises a little (it buckles outwards); the
      // rest of the valley is clipped flat on the body below
      const lift = pv * bias - room[i];
      if (lift > 0) d += lift < LIFT_CAP * pv ? lift : LIFT_CAP * pv;
      // a taut span does not sag into the hollow it bridges: soft knee on valleys
      if (vcap && d < -vcap[i]) d = -vcap[i] + (d + vcap[i]) * 0.2;
      if (cd) d += cd[i];
      const r = -room[i];
      disp[i] = d < r ? r : d;
    }
    this.active = maxA >= 1e-3 || cmax >= 1e-5;
    this._k = k;
    return true;
  }

  /** Static-only displacement (rest pose / wrinkles disabled). */
  restDisp(k) {
    const { nf, stat, room, disp } = this;
    for (let i = 0; i < nf; i++) { const d = stat[i] * k, r = -room[i]; disp[i] = d < r ? r : d; }
    const G = this.crease?.ring;
    if (G) for (let t = 0, n = G.idx.length; t < n; t++) { const i = G.idx[t], r = -room[i], d = disp[i] + G.val[t] * k; disp[i] = d < r ? r : d; }
    this.active = false;
    this._k = k;
  }
}

const _ma = new THREE.Matrix4(), _mb = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _ax = new THREE.Vector3();
/** Residual elbow flexion of the fold-free reference arm (rad). */
const REF_ELBOW = 0.14;

/**
 * Skin matrices (rig space, 16 per bone) of the fold-free reference pose: the
 * rest pose with the forearms swung about the elbow until the arm is almost
 * straight. Folds are measured against it.
 */
export function referenceSkin(ch) {
  const NB = ch.bones.length, M = new Float32Array(NB * 16), model = ch.model;
  for (let i = 0; i < NB; i++) M[i * 16] = M[i * 16 + 5] = M[i * 16 + 10] = M[i * 16 + 15] = 1;
  for (const side of ['L', 'R']) {
    const ua = model.boneIndex.get('upperarm01.' + side), la = model.boneIndex.get('lowerarm01.' + side), wr = model.boneIndex.get('wrist.' + side);
    if (ua === undefined || la === undefined || wr === undefined) continue;
    _p0.setFromMatrixPosition(ch.restGlobal[ua]); _p1.setFromMatrixPosition(ch.restGlobal[la]); _p2.setFromMatrixPosition(ch.restGlobal[wr]);
    const u = _p1.clone().sub(_p0).normalize(), f = _p2.clone().sub(_p1).normalize();
    const ang = Math.acos(Math.max(-1, Math.min(1, u.dot(f)))) - REF_ELBOW;
    if (!(ang > 0.02)) continue;
    _ax.crossVectors(f, u).normalize();
    _q.setFromAxisAngle(_ax, ang);
    // rotation about the elbow joint: T(p1) R T(-p1)
    _ma.makeTranslation(_p1.x, _p1.y, _p1.z).multiply(_mb.makeRotationFromQuaternion(_q)).multiply(_mb.makeTranslation(-_p1.x, -_p1.y, -_p1.z));
    const below = new Uint8Array(NB);
    for (let b = 0; b < NB; b++) {
      below[b] = b === la || (model.bones[b].parent >= 0 && below[model.bones[b].parent]) ? 1 : 0;
      if (below[b]) _ma.toArray(M, b * 16);
    }
  }
  return M;
}

/**
 * Precomputes the four fold fields of a fine vertex set.
 * coords {wT, limb, sT, thT, sL, thL}; frames: {kT, NT, MT, kL[r], NL[r], ML[r]}
 * Returns Float32Array(nf*4) centered fields.
 */
export function foldFields(nf, coords, P, frames, bias = FOLD_BIAS) {
  const out = new Float32Array(nf * 4);
  const f = [0, 0, 0, 0];
  const eval4 = (s, th, kAx, N, M, x, y, z, w, acc) => {
    const n1 = noise3(x * 7.3, y * 7.3, z * 7.3), n2 = noise3(x * 7.3 + 31, y * 7.3 + 7, z * 7.3 - 11);
    const n3 = noise3(x * 4.1 - 5, y * 4.1 + 13, z * 4.1 + 2);
    // gently wavy rings (chevrons) + jittered diagonals
    const ring = kAx * s + 1.3 * n1 + 0.5 * Math.sin(th * 2 + 2.5 * n3);
    acc[0] += w * (foldProfile(ring) - bias);
    acc[1] += w * (foldProfile(N * th + 1.5 * n2 + 0.8 * Math.sin(kAx * 0.35 * s)) - bias);
    acc[2] += w * (foldProfile(kAx * SQ2 * s + M * th + 1.6 * n3) - bias);
    acc[3] += w * (foldProfile(kAx * SQ2 * s - M * th + 1.6 * n1) - bias);
  };
  for (let i = 0; i < nf; i++) {
    f[0] = f[1] = f[2] = f[3] = 0;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const wT = coords.limb[i] ? coords.wT[i] : 1;
    if (wT > 0.02) eval4(coords.sT[i], coords.thT[i], frames.kT, frames.NT, frames.MT, x, y, z, wT, f);
    const L = coords.limb[i];
    if (L && wT < 0.98) eval4(coords.sL[i], coords.thL[i], frames.kL[L], frames.NL[L], frames.ML[L], x, y, z, 1 - wT, f);
    out[i * 4] = f[0]; out[i * 4 + 1] = f[1]; out[i * 4 + 2] = f[2]; out[i * 4 + 3] = f[3];
  }
  return out;
}
