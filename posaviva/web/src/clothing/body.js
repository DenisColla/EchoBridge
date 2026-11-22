// Body analysis for garment generation.
//
// BodyTopo (static, one per HumanModel): body quads, edges, adjacency and the
// anatomical part weights of every body vertex (from the skin weights).
// BodyInfo (one per character, refreshed on 'shape'): limb parameters, torso
// center line, landmark heights and the cylindrical frames used to fit
// garments, place cuts, lay out UVs and orient wrinkles.
//
// Body coordinates (rest pose, rig space):
//   arm param  a: 0 shoulder joint .. 1 elbow .. 2 wrist .. 3 finger tips
//   leg param  l: 0 hip joint .. 1 knee .. 2 ankle .. 3 toe tips
//   torso      T: 0 crotch, 1 hip joint, 2 waist, 3 bust/chest, 4 shoulder joint, 5 neck base
// Vertices that are not part of a limb get a = l = -0.3 (blended by the
// limb skin weight so the fields stay continuous across the armpit / groin).
import { buildEdges, buildAdjacency, len2, len3 } from './mesh.js';

export const PART = { torso: 0, neck: 1, head: 2, armL: 3, handL: 4, armR: 5, handR: 6, legL: 7, footL: 8, legR: 9, footR: 10 };
export const NPART = 11;
/** Fitting / wrinkle regions: 0 torso (incl. neck), 1 arm L, 2 arm R, 3 leg L, 4 leg R. */
export const REGION = { T: 0, AL: 1, AR: 2, LL: 3, LR: 4 };
export const LIMB_REGIONS = [1, 2, 3, 4];
const NONLIMB = -0.3;

function partOfBone(name) {
  const side = name.endsWith('.R') ? 'R' : 'L';
  if (/^(root|spine|pelvis|clavicle)/.test(name)) return PART.torso;
  if (/^neck/.test(name)) return PART.neck;
  if (/^(head|eye)/.test(name)) return PART.head;
  if (/^(shoulder01|upperarm|lowerarm)/.test(name)) return PART['arm' + side];
  if (/^(wrist|finger|metacarpal)/.test(name)) return PART['hand' + side];
  if (/^(upperleg|lowerleg)/.test(name)) return PART['leg' + side];
  return PART['foot' + side];
}

/** Segment of a limb chain a bone belongs to (0 upper, 1 lower, 2 extremity) or -1. */
function segOfBone(name) {
  if (/^(shoulder01|upperarm|upperleg)/.test(name)) return 0;
  if (/^(lowerarm|lowerleg)/.test(name)) return 1;
  if (/^(wrist|finger|metacarpal|foot|toe)/.test(name)) return 2;
  return -1;
}

const _topoCache = new WeakMap();

export class BodyTopo {
  static of(model) {
    let t = _topoCache.get(model);
    if (!t) { t = new BodyTopo(model); _topoCache.set(model, t); }
    return t;
  }

  constructor(model) {
    this.model = model;
    const bv = model.groupVertices[0];
    // body vertices are the first contiguous block of mesh vertices
    if (bv[0] !== 0 || bv[bv.length - 1] !== bv.length - 1) throw new Error('clothing: body vertices are not contiguous');
    const nv = this.nv = bv.length;
    const faces = model.groupFaces[0];
    this.nf = faces.length;
    this.faceIds = Int32Array.from(faces); // local body face -> model face index
    this.quads = new Uint32Array(this.nf * 4);
    for (let i = 0; i < this.nf; i++) for (let k = 0; k < 4; k++) this.quads[i * 4 + k] = model.faceV[faces[i] * 4 + k];
    this.E = buildEdges(nv, this.quads);
    this.adj = buildAdjacency(nv, this.E);
    // vertex -> faces (CSR)
    const cnt = new Int32Array(nv + 1);
    for (let i = 0; i < this.quads.length; i++) cnt[this.quads[i] + 1]++;
    for (let i = 0; i < nv; i++) cnt[i + 1] += cnt[i];
    const fill = cnt.slice(0, nv), vfl = new Int32Array(cnt[nv]);
    for (let f = 0; f < this.nf; f++) for (let k = 0; k < 4; k++) { const v = this.quads[f * 4 + k]; vfl[fill[v]++] = f; }
    this.vf = { off: cnt, list: vfl };
    // faces within 2 vertex rings of every vertex (for the crease clearance)
    const nOff = new Int32Array(nv + 1), nList = [];
    const mark = new Int32Array(this.nf).fill(-1);
    for (let v = 0; v < nv; v++) {
      const ring = [v];
      for (let j = this.adj.off[v]; j < this.adj.off[v + 1]; j++) ring.push(this.adj.adj[j]);
      for (const u of ring) for (let j = cnt[u]; j < cnt[u + 1]; j++) { const f = vfl[j]; if (mark[f] !== v) { mark[f] = v; nList.push(f); } }
      nOff[v + 1] = nList.length;
    }
    this.nearFaces = { off: nOff, list: Int32Array.from(nList) };

    // anatomical part weights + limb segment weights per vertex
    const NB = model.bones.length;
    this.bonePart = new Int8Array(NB);
    this.boneSeg = new Int8Array(NB);
    model.bones.forEach((b, i) => { this.bonePart[i] = partOfBone(b.name); this.boneSeg[i] = segOfBone(b.name); });
    this.partW = new Float32Array(nv * NPART);
    this.segW = new Float32Array(nv * 3); // weights of the dominant limb's 3 segments
    this.limb = new Int8Array(nv); // dominant limb region (1..4) or 0
    const SI = model.skinIndex, SW = model.skinWeight;
    const limbOfPart = [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
    const lw = new Float32Array(5);
    for (let v = 0; v < nv; v++) {
      lw.fill(0);
      for (let k = 0; k < 4; k++) {
        const w = SW[v * 4 + k];
        if (!w) continue;
        const p = this.bonePart[SI[v * 4 + k]];
        this.partW[v * NPART + p] += w;
        lw[limbOfPart[p]] += w;
      }
      let best = 0, bl = 0;
      for (let r = 1; r < 5; r++) if (lw[r] > best) { best = lw[r]; bl = r; }
      this.limb[v] = bl;
      if (!bl) continue;
      for (let k = 0; k < 4; k++) {
        const w = SW[v * 4 + k];
        if (!w) continue;
        const b = SI[v * 4 + k];
        if (limbOfPart[this.bonePart[b]] === bl && this.boneSeg[b] >= 0) this.segW[v * 3 + this.boneSeg[b]] += w;
      }
    }
  }

  /** Total weight of a limb region (1..4) incl. its extremity, or of the torso+neck+head (0). */
  regionWeight(v, r) {
    const W = this.partW, o = v * NPART;
    switch (r) {
      case 0: return W[o] + W[o + 1] + W[o + 2];
      case 1: return W[o + 3] + W[o + 4];
      case 2: return W[o + 5] + W[o + 6];
      case 3: return W[o + 7] + W[o + 8];
      default: return W[o + 9] + W[o + 10];
    }
  }
}

// chain bone names per limb region: [root joint bone, mid joint bone, end joint bone, tip helper]
const CHAINS = {
  1: { side: 'L', bones: ['upperarm01.L', 'lowerarm01.L', 'wrist.L'], tip: ['finger3-2.L', 'finger3-3.L'], refUp: true },
  2: { side: 'R', bones: ['upperarm01.R', 'lowerarm01.R', 'wrist.R'], tip: ['finger3-2.R', 'finger3-3.R'], refUp: true },
  3: { side: 'L', bones: ['upperleg01.L', 'lowerleg01.L', 'foot.L'], tip: ['foot.L', 'toe2-1.L'], refUp: false },
  4: { side: 'R', bones: ['upperleg01.R', 'lowerleg01.R', 'foot.R'], tip: ['foot.R', 'toe2-1.R'], refUp: false },
};

/** One limb: polyline of 4 joints (root, mid, end, tip) with per-segment frames. */
class LimbFrame {
  constructor() {
    this.J = new Float32Array(12); // 4 joints
    this.D = new Float32Array(9); // unit directions of the 3 segments
    this.L = new Float32Array(3); // segment lengths
    this.R = new Float32Array(9); // reference (theta = 0) direction per segment, perpendicular to D
    this.Q = new Float32Array(9); // D x R (theta = +90deg)
  }

  set(joints, lateral) {
    this.J.set(joints);
    for (let s = 0; s < 3; s++) {
      let dx = this.J[s * 3 + 3] - this.J[s * 3], dy = this.J[s * 3 + 4] - this.J[s * 3 + 1], dz = this.J[s * 3 + 5] - this.J[s * 3 + 2];
      const l = len3(dx, dy, dz) || 1e-4;
      dx /= l; dy /= l; dz /= l;
      this.L[s] = l; this.D[s * 3] = dx; this.D[s * 3 + 1] = dy; this.D[s * 3 + 2] = dz;
      // reference: arms -> world up, legs -> outer side (lateral); extremity of legs (foot) -> up
      let rx = lateral[0], ry = lateral[1], rz = lateral[2];
      if (s === 2 && lateral[1] === 0) { rx = 0; ry = 1; rz = 0; }
      const d = rx * dx + ry * dy + rz * dz;
      rx -= d * dx; ry -= d * dy; rz -= d * dz;
      let rl = len3(rx, ry, rz);
      if (rl < 1e-3) { rx = 0; ry = 0; rz = 1; const d2 = rz * dz; rx -= d2 * dx; ry -= d2 * dy; rz -= d2 * dz; rl = len3(rx, ry, rz) || 1; }
      rx /= rl; ry /= rl; rz /= rl;
      this.R[s * 3] = rx; this.R[s * 3 + 1] = ry; this.R[s * 3 + 2] = rz;
      this.Q[s * 3] = dy * rz - dz * ry; this.Q[s * 3 + 1] = dz * rx - dx * rz; this.Q[s * 3 + 2] = dx * ry - dy * rx;
    }
  }

  /** Normalized param of the projection of p on segment s (0..1 inside). */
  proj(s, x, y, z) {
    const o = s * 3;
    return ((x - this.J[o]) * this.D[o] + (y - this.J[o + 1]) * this.D[o + 1] + (z - this.J[o + 2]) * this.D[o + 2]) / this.L[s];
  }

  /** Metric arc length of a normalized chain param. */
  metric(a) {
    if (a <= 1) return a * this.L[0];
    if (a <= 2) return this.L[0] + (a - 1) * this.L[1];
    return this.L[0] + this.L[1] + (a - 2) * this.L[2];
  }

  /**
   * Cylindrical coordinates of p around segment floor(a) (clamped 0..2).
   * out: [theta, r, axisX, axisY, axisZ, radialX, radialY, radialZ, segment]
   */
  cyl(a, x, y, z, out) {
    const s = a < 1 ? 0 : a < 2 ? 1 : 2, o = s * 3;
    const t = this.proj(s, x, y, z) * this.L[s];
    const ax = this.J[o] + this.D[o] * t, ay = this.J[o + 1] + this.D[o + 1] * t, az = this.J[o + 2] + this.D[o + 2] * t;
    let rx = x - ax, ry = y - ay, rz = z - az;
    const r = len3(rx, ry, rz) || 1e-6;
    rx /= r; ry /= r; rz /= r;
    out[0] = Math.atan2(rx * this.Q[o] + ry * this.Q[o + 1] + rz * this.Q[o + 2], rx * this.R[o] + ry * this.R[o + 1] + rz * this.R[o + 2]);
    out[1] = r; out[2] = ax; out[3] = ay; out[4] = az; out[5] = rx; out[6] = ry; out[7] = rz; out[8] = s;
    return out;
  }

  /** Point at chain param a, angle theta, radius r (rig space) -> out[0..2]. */
  point(a, theta, r, out, o = 0) {
    const s = a < 1 ? 0 : a < 2 ? 1 : 2, k = s * 3;
    const t = (a - s) * this.L[s];
    const c = Math.cos(theta) * r, sn = Math.sin(theta) * r;
    out[o] = this.J[k] + this.D[k] * t + this.R[k] * c + this.Q[k] * sn;
    out[o + 1] = this.J[k + 1] + this.D[k + 1] * t + this.R[k + 1] * c + this.Q[k + 1] * sn;
    out[o + 2] = this.J[k + 2] + this.D[k + 2] * t + this.R[k + 2] * c + this.Q[k + 2] * sn;
    return out;
  }
}

const YBIN = 0.01, YMAX = 2.6, NYB = Math.ceil(YMAX / YBIN);
/** Minimal distance (m) of the waist landmark below the under-bust. */
const WAIST_UNDER = 0.045;
/** Gaussian width (m) of the spatial bump removal on fabric base surfaces. */
const BUMP_SIGMA = 0.009;

/**
 * Lowers small convex bumps (nipples, navel rim, knuckles of the toes) of a
 * surface X in place: each vertex is compared with the area-weighted Gaussian
 * average of its spatial neighbourhood (not its mesh neighbours: the nipples are
 * densely meshed and survive any graph smoothing) and pulled down along its
 * normal by the excess. Hollows and large forms (bust, buttocks, muscles) stay.
 */
export function flattenBumps(X, N, nv, sigma, strength = 0.9) {
  const R = sigma * 2.5, R2 = R * R, inv = 1 / (2 * sigma * sigma);
  const key = (x, y, z) => ((Math.floor(x / R) + 1024) * 2048 + Math.floor(y / R) + 1024) * 2048 + Math.floor(z / R) + 1024;
  const grid = new Map();
  for (let v = 0; v < nv; v++) { const k = key(X[v * 3], X[v * 3 + 1], X[v * 3 + 2]); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(v); }
  // vertex area ~ squared distance to the nearest neighbour (dense spots weigh less)
  const area = new Float32Array(nv).fill(R2);
  for (const l of grid.values()) for (const v of l) {
    const x = X[v * 3], y = X[v * 3 + 1], z = X[v * 3 + 2];
    const cx = Math.floor(x / R), cy = Math.floor(y / R), cz = Math.floor(z / R);
    let best = R2;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const m = grid.get(((cx + dx + 1024) * 2048 + cy + dy + 1024) * 2048 + cz + dz + 1024);
      if (!m) continue;
      for (const u of m) { if (u === v) continue; const d = (X[u * 3] - x) ** 2 + (X[u * 3 + 1] - y) ** 2 + (X[u * 3 + 2] - z) ** 2; if (d < best) best = d; }
    }
    area[v] = best;
  }
  const out = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    const x = X[v * 3], y = X[v * 3 + 1], z = X[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    const cx = Math.floor(x / R), cy = Math.floor(y / R), cz = Math.floor(z / R);
    let sx = 0, sy = 0, sz = 0, sw = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const m = grid.get(((cx + dx + 1024) * 2048 + cy + dy + 1024) * 2048 + cz + dz + 1024);
      if (!m) continue;
      for (const u of m) {
        // the same sheet only (not the other thigh, the arm against the torso)
        if (N[u * 3] * nx + N[u * 3 + 1] * ny + N[u * 3 + 2] * nz < 0.3) continue;
        const ex = X[u * 3] - x, ey = X[u * 3 + 1] - y, ez = X[u * 3 + 2] - z, d2 = ex * ex + ey * ey + ez * ez;
        if (d2 > R2) continue;
        const w = Math.exp(-d2 * inv) * area[u];
        sx += ex * w; sy += ey * w; sz += ez * w; sw += w;
      }
    }
    if (sw <= 0) continue;
    const bump = -(sx * nx + sy * ny + sz * nz) / sw; // height of v above its neighbourhood
    if (bump > 0) out[v] = bump;
  }
  for (let v = 0; v < nv; v++) if (out[v] > 0) { const k = out[v] * strength; X[v * 3] -= N[v * 3] * k; X[v * 3 + 1] -= N[v * 3 + 1] * k; X[v * 3 + 2] -= N[v * 3 + 2] * k; }
}

export class BodyInfo {
  /** @param {BodyTopo} topo */
  constructor(topo) {
    this.topo = topo;
    const nv = topo.nv;
    /** limb params per vertex for each limb region 1..4 (index r-1) */
    this.param = [new Float32Array(nv), new Float32Array(nv), new Float32Array(nv), new Float32Array(nv)];
    this.limbs = { 1: new LimbFrame(), 2: new LimbFrame(), 3: new LimbFrame(), 4: new LimbFrame() };
    this.czBins = new Float32Array(NYB); // torso center z per height bin
    this.version = 0;
    this._tmp = new Float32Array(9);
  }

  /** Recomputes everything from the character's current rest shape. */
  update(ch) {
    const topo = this.topo, nv = topo.nv, model = topo.model;
    this.P = ch.restPositions; this.N = ch.restNormals;
    const P = this.P;
    const J = (name) => { const e = ch.restGlobal[model.boneIndex.get(name)].elements; return [e[12], e[13], e[14]]; };
    this.joint = J;
    for (const r of [1, 2, 3, 4]) {
      const c = CHAINS[r];
      const a = J(c.bones[0]), b = J(c.bones[1]), d = J(c.bones[2]);
      const t0 = J(c.tip[0]), t1 = J(c.tip[1]);
      // tip: extrapolate past the last finger/toe joint
      const k = r <= 2 ? 1.0 : 0.45;
      const tip = [t1[0] + (t1[0] - t0[0]) * k, t1[1] + (t1[1] - t0[1]) * k, t1[2] + (t1[2] - t0[2]) * k];
      const lateral = c.refUp ? [0, 1, 0] : [c.side === 'L' ? 1 : -1, 0, 0];
      this.limbs[r].set([...a, ...b, ...d, ...tip], lateral);
    }
    // limb params (weight-blended projections)
    const SW = topo.segW;
    for (const r of [1, 2, 3, 4]) {
      const L = this.limbs[r], out = this.param[r - 1];
      for (let v = 0; v < nv; v++) {
        const w = topo.regionWeight(v, r);
        if (w < 1e-4 || topo.limb[v] !== r) { out[v] = NONLIMB; continue; }
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        const w0 = SW[v * 3], w1 = SW[v * 3 + 1], w2 = SW[v * 3 + 2], ws = w0 + w1 + w2;
        let a = NONLIMB;
        if (ws > 1e-5) a = (w0 * L.proj(0, x, y, z) + w1 * (1 + L.proj(1, x, y, z)) + w2 * (2 + L.proj(2, x, y, z))) / ws;
        out[v] = w * a + (1 - w) * NONLIMB;
      }
    }
    this._torsoCenter();
    this._landmarks(ch);
    this._clearance();
    this.version++;
  }

  /**
   * Crease clearance: how far along its normal a point must leave each vertex
   * to be outside every body face of its 2-ring neighbourhood (groin, under the
   * bust, armpits, buttocks). Garments add it to their minimum offset.
   */
  _clearance() {
    const topo = this.topo, P = this.P, N = this.N, Q = topo.quads, nv = topo.nv;
    const fc = this._fc || (this._fc = new Float32Array(topo.nf * 3)), fn = this._fn || (this._fn = new Float32Array(topo.nf * 3));
    for (let f = 0; f < topo.nf; f++) {
      const a = Q[f * 4] * 3, b = Q[f * 4 + 1] * 3, c = Q[f * 4 + 2] * 3, d = Q[f * 4 + 3] * 3;
      for (let k = 0; k < 3; k++) fc[f * 3 + k] = (P[a + k] + P[b + k] + P[c + k] + P[d + k]) * 0.25;
      const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2];
      const vx = P[d] - P[b], vy = P[d + 1] - P[b + 1], vz = P[d + 2] - P[b + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = len3(nx, ny, nz) || 1;
      fn[f * 3] = nx / l; fn[f * 3 + 1] = ny / l; fn[f * 3 + 2] = nz / l;
    }
    const out = this.clearance || (this.clearance = new Float32Array(nv));
    const risky = this.risky || (this.risky = new Uint8Array(nv));
    const { off, list } = topo.nearFaces;
    for (let v = 0; v < nv; v++) {
      const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
      let h = 0, dip = 0;
      for (let j = off[v]; j < off[v + 1]; j++) {
        const q = list[j] * 4;
        for (let k = 0; k < 4; k++) { const u = Q[q + k] * 3; const d = (P[u] - px) * nx + (P[u + 1] - py) * ny + (P[u + 2] - pz) * nz; if (d > dip) dip = d; }
      }
      risky[v] = dip > 0.0012 ? 1 : 0;
      for (let j = off[v]; j < off[v + 1]; j++) {
        const f = list[j];
        const fx = fn[f * 3], fy = fn[f * 3 + 1], fz = fn[f * 3 + 2];
        const cosA = nx * fx + ny * fy + nz * fz;
        if (cosA < 0.25) continue;
        // ray p + n t meets the face plane at t
        const t = ((fc[f * 3] - px) * fx + (fc[f * 3 + 1] - py) * fy + (fc[f * 3 + 2] - pz) * fz) / cosA;
        if (t <= h || t > 0.04) continue;
        // inside the quad? (edge tests in the face plane, small tolerance)
        const x = px + nx * t, y = py + ny * t, z = pz + nz * t;
        let inside = true;
        for (let k = 0; k < 4 && inside; k++) {
          const a = Q[f * 4 + k] * 3, b = Q[f * 4 + ((k + 1) & 3)] * 3;
          const ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2];
          const qx = x - P[a], qy = y - P[a + 1], qz = z - P[a + 2];
          const cx = ey * qz - ez * qy, cy = ez * qx - ex * qz, cz = ex * qy - ey * qx;
          if (cx * fx + cy * fy + cz * fz < -1e-7) inside = false;
        }
        if (inside) h = t;
      }
      out[v] = h;
      if (h > 0) risky[v] = 1;
    }
  }

  /** Drops build-time caches (smoothed base surfaces, edge weights): rebuilt on demand. */
  releaseCaches() {
    this._bases?.clear();
    this._edgeW = null;
  }

  /** Unit normals of the body quads (rest shape), refreshed by update(). */
  faceNormals() { return this._fn; }

  /**
   * Base surface for fabric (cached per body shape): edge-length weighted
   * Taubin smoothing (lambda/mu) of the whole body. Metric weights make it
   * robust to the dense mesh around nipples, navel and hands; Taubin removes
   * small features (nipples, navel rim, ribs, toes gaps) without shrinking the
   * large shapes (breasts, buttocks, muscles).
   */
  smoothBase(iterations) {
    const key = `${this.version}|${iterations}`;
    this._bases ||= new Map();
    const hit = this._bases.get(key);
    if (hit) return hit;
    if (this._bases.size > 8) this._bases.clear();
    const topo = this.topo, nv = topo.nv, P = this.P, { off, adj } = topo.adj;
    const W = this._edgeW || (this._edgeW = new Float32Array(adj.length));
    for (let v = 0; v < nv; v++) for (let j = off[v]; j < off[v + 1]; j++) { const u = adj[j]; W[j] = len3(P[u * 3] - P[v * 3], P[u * 3 + 1] - P[v * 3 + 1], P[u * 3 + 2] - P[v * 3 + 2]) + 1e-5; }
    let L = P.slice(0, nv * 3), tmp = new Float32Array(nv * 3);
    for (let it = 0; it < iterations * 2; it++) {
      const k = it & 1 ? -0.53 : 0.5;
      for (let v = 0; v < nv; v++) {
        let ax = 0, ay = 0, az = 0, ws = 0;
        for (let j = off[v]; j < off[v + 1]; j++) { const u = adj[j] * 3, w = W[j]; ax += L[u] * w; ay += L[u + 1] * w; az += L[u + 2] * w; ws += w; }
        const o = v * 3;
        tmp[o] = L[o] + k * (ax / ws - L[o]); tmp[o + 1] = L[o + 1] + k * (ay / ws - L[o + 1]); tmp[o + 2] = L[o + 2] + k * (az / ws - L[o + 2]);
      }
      const t = L; L = tmp; tmp = t;
    }
    flattenBumps(L, this.N, nv, BUMP_SIGMA);
    this._bases.set(key, L);
    return L;
  }

  _torsoCenter() {
    const topo = this.topo, P = this.P, nv = topo.nv;
    const zmin = new Float32Array(NYB).fill(1e9), zmax = new Float32Array(NYB).fill(-1e9);
    for (let v = 0; v < nv; v++) {
      if (topo.regionWeight(v, 0) < 0.6) continue;
      const b = Math.max(0, Math.min(NYB - 1, Math.floor(P[v * 3 + 1] / YBIN)));
      const z = P[v * 3 + 2];
      if (z < zmin[b]) zmin[b] = z;
      if (z > zmax[b]) zmax[b] = z;
    }
    const cz = this.czBins;
    let last = NaN;
    for (let b = 0; b < NYB; b++) { cz[b] = zmax[b] > zmin[b] ? (zmin[b] + zmax[b]) / 2 : NaN; }
    // fill gaps (nearest) and smooth
    for (let b = 0; b < NYB; b++) { if (Number.isNaN(cz[b])) cz[b] = last; else last = cz[b]; }
    last = NaN;
    for (let b = NYB - 1; b >= 0; b--) { if (Number.isNaN(cz[b])) cz[b] = last; else last = cz[b]; }
    for (let b = 0; b < NYB; b++) if (Number.isNaN(cz[b])) cz[b] = 0;
    const tmp = cz.slice();
    for (let b = 0; b < NYB; b++) {
      let s = 0, n = 0;
      for (let k = -4; k <= 4; k++) { const j = b + k; if (j >= 0 && j < NYB) { s += tmp[j]; n++; } }
      cz[b] = s / n;
    }
  }

  /** Torso center z at height y. */
  cz(y) {
    const f = y / YBIN - 0.5;
    const b = Math.max(0, Math.min(NYB - 2, Math.floor(f)));
    const t = Math.max(0, Math.min(1, f - b));
    return this.czBins[b] * (1 - t) + this.czBins[b + 1] * t;
  }

  _landmarks(ch) {
    const topo = this.topo, P = this.P, nv = topo.nv, J = this.joint;
    const neck = J('neck01'), shoulderL = J('upperarm01.L'), hipL = J('upperleg01.L'), head = J('head');
    // torso half width per height bin (torso + legs, no arms) and front z (torso only)
    const halfW = new Float32Array(NYB), front = new Float32Array(NYB).fill(-1e9);
    let crotch = Infinity, crotchAny = Infinity, armpit = -Infinity;
    for (let v = 0; v < nv; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      const b = Math.max(0, Math.min(NYB - 1, Math.floor(y / YBIN)));
      const wArm = topo.regionWeight(v, 1) + topo.regionWeight(v, 2);
      const wT = topo.regionWeight(v, 0);
      if (wArm < 0.2 && wT > 0.3 && Math.abs(x) > halfW[b]) halfW[b] = Math.abs(x);
      if (wT > 0.6 && z > front[b]) front[b] = z;
      // crotch: where the legs part, at the perineum (behind the hip joints' plane): a male
      // body's genitals hang lower in front and would drop the hems and the crotch seams
      if (Math.abs(x) < 0.012 && y < hipL[1] && y > hipL[1] * 0.6) {
        if (z <= hipL[2] && y < crotch) crotch = y;
        if (y < crotchAny) crotchAny = y;
      }
      // armpit: lowest vertex of the arm/torso junction, near the torso
      if (wArm > 0.35 && wArm < 0.65 && y < shoulderL[1] && Math.abs(x) < Math.abs(shoulderL[0]) + 0.03 && y > armpit - 1) {
        if (armpit === -Infinity || y < armpit) armpit = y;
      }
    }
    if (!Number.isFinite(crotch)) crotch = Number.isFinite(crotchAny) ? crotchAny : hipL[1] - 0.06;
    if (!Number.isFinite(armpit)) armpit = shoulderL[1] - 0.1;
    const binOf = (y) => Math.max(0, Math.min(NYB - 1, Math.floor(y / YBIN)));
    // waist: narrowest between hip joint + 6% and armpit - 10%
    const H = neck[1] - crotch;
    let waist = (hipL[1] + armpit) / 2, wmin = Infinity;
    for (let b = binOf(hipL[1] + 0.12 * H); b <= binOf(armpit - 0.12 * H); b++) if (halfW[b] > 0 && halfW[b] < wmin) { wmin = halfW[b]; waist = (b + 0.5) * YBIN; }
    // bust / chest: most forward point between waist and armpit
    let bust = (waist + armpit) / 2, fmax = -Infinity;
    for (let b = binOf(waist + 0.45 * (armpit - waist)); b <= binOf(armpit); b++) if (front[b] > fmax) { fmax = front[b]; bust = (b + 0.5) * YBIN; }
    // under bust: first height below the bust where the front recedes by 60% of (bust - waist front)
    const fw = front[binOf(waist)];
    let under = bust - 0.06 * H;
    for (let b = binOf(bust); b >= binOf(waist); b--) if (front[b] < fmax - 0.6 * (fmax - fw)) { under = (b + 0.5) * YBIN; break; }
    // a full bust over a short torso (Curvy) narrows the torso right under the breasts: a waist
    // found there would lift every waistband to the bust. Keep it at least WAIST_UNDER below
    // the under-bust (narrowest below that)
    if (under - waist < WAIST_UNDER) {
      let w2 = waist, m2 = Infinity;
      for (let b = binOf(hipL[1] + 0.12 * H); b <= binOf(under - WAIST_UNDER); b++) if (halfW[b] > 0 && halfW[b] < m2) { m2 = halfW[b]; w2 = (b + 0.5) * YBIN; }
      if (Number.isFinite(m2)) waist = w2;
    }
    // widest hips between crotch and waist
    let hips = hipL[1], hmax = -Infinity;
    for (let b = binOf(crotch); b <= binOf(waist); b++) if (halfW[b] > hmax) { hmax = halfW[b]; hips = (b + 0.5) * YBIN; }
    this.land = {
      crotch, hipJoint: hipL[1], hips, waist, underBust: under, bust, armpit, shoulder: shoulderL[1], neck: neck[1],
      neckZ: neck[2], neckPoint: neck, head: head[1], shoulderX: Math.abs(shoulderL[0]), hipX: Math.abs(hipL[0]),
      bustZ: fmax, height: head[1] + 0.12,
    };
    // torso coordinate knots (strictly increasing)
    const ky = [crotch, hipL[1], waist, bust, shoulderL[1], neck[1]];
    for (let i = 1; i < ky.length; i++) if (ky[i] <= ky[i - 1] + 0.01) ky[i] = ky[i - 1] + 0.01;
    this.tKnots = ky;
    this.neckRadius = this._neckRadius(neck);
  }

  _neckRadius(neck) {
    const topo = this.topo, P = this.P;
    let r = 0, n = 0;
    for (let v = 0; v < topo.nv; v++) {
      if (topo.partW[v * NPART + PART.neck] < 0.5) continue;
      const y = P[v * 3 + 1];
      if (Math.abs(y - neck[1] - 0.02) > 0.02) continue;
      r += len2(P[v * 3], P[v * 3 + 2] - neck[2]); n++;
    }
    return n ? r / n : 0.055;
  }

  /** Torso coordinate T(y) (piecewise linear through the landmark knots, linear extrapolation). */
  T(y) {
    const k = this.tKnots;
    if (y <= k[1]) return (y - k[1]) / (k[1] - k[0]) + 1;
    for (let i = 1; i < 5; i++) if (y <= k[i + 1]) return i + (y - k[i]) / (k[i + 1] - k[i]);
    return 5 + (y - k[5]) / (k[5] - k[4]);
  }

  /** Height of torso coordinate t. */
  yOfT(t) {
    const k = this.tKnots;
    if (t <= 1) return k[1] + (t - 1) * (k[1] - k[0]);
    if (t >= 5) return k[5] + (t - 5) * (k[5] - k[4]);
    const i = Math.floor(t);
    return k[i] + (t - i) * (k[i + 1] - k[i]);
  }

  /** Torso cylindrical coords of (x,y,z): out [theta, r, axisX, axisY, axisZ, radX, radY, radZ]. theta 0 = front, right-handed about -Y. */
  torsoCyl(x, y, z, out) {
    const cz = this.cz(y);
    let rx = x, rz = z - cz;
    const r = len2(rx, rz) || 1e-6;
    rx /= r; rz /= r;
    out[0] = Math.atan2(-rx, rz); out[1] = r;
    out[2] = 0; out[3] = y; out[4] = cz;
    out[5] = rx; out[6] = 0; out[7] = rz; out[8] = 0;
    return out;
  }

  /** Torso point at height y, angle theta, radius r. */
  torsoPoint(y, theta, r, out, o = 0) {
    out[o] = -Math.sin(theta) * r; out[o + 1] = y; out[o + 2] = this.cz(y) + Math.cos(theta) * r;
    return out;
  }
}
