// Hair clumps ("strands"): centre-line polylines rendered as tapered tubes
// with a flattened elliptic cross-section (wide along the hair layer, thin
// across it). Normals are the ellipse normals bent towards the layer normal so
// overlapping clumps shade like one smooth volume (clean toon bands / ink).
//
// StrandSet: growable list of clump definitions (rest centre lines in rig rest
// space). HairGeometry: one BufferGeometry holding the skin-bound cap, every
// tube and optional solid parts (puffs, hair ties); writeStrand() re-extrudes
// one tube from any centre line (rest or simulated) without allocating.
import * as THREE from 'three';
import { smoothstep, clamp, len2, len3 } from './util.js';

export const DETAIL_NONE = 0, DETAIL_WAVE = 1, DETAIL_CURL = 2;

/**
 * @typedef {object} StrandDef
 * @property {Float32Array} pts   K*3 centre line (rest, rig space)
 * @property {number} w           half width (m)
 * @property {number} [flat]      thickness / width (0..1)
 * @property {number} [rootW]     width factor at the root
 * @property {number} [taper0]    normalised length where the tip taper starts
 * @property {number} [tipW]      width factor at the tip
 * @property {number} [tone]      brightness multiplier (vertex colour)
 * @property {number} [samples]   render samples along the clump (>= K)
 * @property {number} [sides]     ring segments
 * @property {number[]} [axis]    fixed thin axis (spikes / fins); default: outward from the head/body axis
 * @property {{type:number, amp:number, wl:number, phase:number, start:number, depth?:number}} [detail]
 * @property {number} [pin]       number of rigid points from the root (K = fully rigid)
 * @property {number} [layer]     extra collision radius (m) keeping layers apart when simulated
 * @property {number} [bias]      normal bend towards the layer normal (0..1)
 * @property {number[]} [skinIndex] 4 bone indices (default: rigid on the head bone)
 * @property {number[]} [skinWeight] 4 weights
 */

export class StrandSet {
  constructor() { /** @type {StrandDef[]} */ this.list = []; }
  add(def) { this.list.push(def); return this.list.length - 1; }
  get length() { return this.list.length; }
}

// scratch (grown on demand, shared: geometry writes are synchronous)
let _cap = 0;
let SP, ST, SN, SB, SA;
function ensureScratch(n) {
  if (n <= _cap) return;
  _cap = Math.max(n, 64);
  SP = new Float32Array(_cap * 3); ST = new Float32Array(_cap * 3); SN = new Float32Array(_cap * 3); SB = new Float32Array(_cap * 3); SA = new Float32Array(_cap);
}

const _rings = new Map();
/**
 * Per ring vertex j: [cos, sin, normal coefficient along B, along N] for a
 * flattened ellipse (thickness = flat * width) whose normal is bent by `bias`
 * towards the layer normal N. Cached by (S, flat, bias).
 */
function ringTable(S, flat, bias) {
  const key = S * 1e6 + Math.round(flat * 1000) * 1000 + Math.round(bias * 999);
  let R = _rings.get(key);
  if (R) return R;
  R = new Float32Array((S + 1) * 4);
  for (let j = 0; j <= S; j++) {
    const a = (j / S) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    // gradient of the ellipse (x/w)^2 + (y/(flat w))^2 ~ (ca * flat, sa), normalised, + bias * N
    let gb = ca * flat, gn = sa;
    const gl = len2(gb, gn) || 1;
    gb /= gl; gn = gn / gl + bias;
    const l = len2(gb, gn) || 1;
    R[j * 4] = ca; R[j * 4 + 1] = sa; R[j * 4 + 2] = gb / l; R[j * 4 + 3] = gn / l;
  }
  _rings.set(key, R);
  return R;
}

/** Catmull-Rom resampling of K points (uniform parameter) into M points of out. */
function resample(src, so, K, out, M) {
  if (M === K) { for (let i = 0; i < K * 3; i++) out[i] = src[so + i]; return; }
  for (let m = 0; m < M; m++) {
    const f = (m / (M - 1)) * (K - 1);
    const i = Math.min(K - 2, Math.floor(f)), t = f - i;
    const i0 = Math.max(0, i - 1), i2 = i + 1, i3 = Math.min(K - 1, i + 2);
    const t2 = t * t, t3 = t2 * t;
    const c0 = -0.5 * t3 + t2 - 0.5 * t, c1 = 1.5 * t3 - 2.5 * t2 + 1, c2 = -1.5 * t3 + 2 * t2 + 0.5 * t, c3 = 0.5 * t3 - 0.5 * t2;
    for (let k = 0; k < 3; k++) {
      out[m * 3 + k] = c0 * src[so + i0 * 3 + k] + c1 * src[so + i * 3 + k] + c2 * src[so + i2 * 3 + k] + c3 * src[so + i3 * 3 + k];
    }
  }
}

/** Central-difference unit tangents of M points. */
function tangents(P, M, T) {
  for (let m = 0; m < M; m++) {
    const a = Math.max(0, m - 1), b = Math.min(M - 1, m + 1);
    let x = P[b * 3] - P[a * 3], y = P[b * 3 + 1] - P[a * 3 + 1], z = P[b * 3 + 2] - P[a * 3 + 2];
    const l = len3(x, y, z);
    if (l < 1e-9) { if (m) { x = T[m * 3 - 3]; y = T[m * 3 - 2]; z = T[m * 3 - 1]; } else { x = 0; y = -1; z = 0; } }
    else { x /= l; y /= l; z /= l; }
    T[m * 3] = x; T[m * 3 + 1] = y; T[m * 3 + 2] = z;
  }
}

/**
 * Thin-axis frames: N = reference "outward" direction made orthogonal to T,
 * B = T x N. axisFrame = {cx,cy,cz, dx,dy,dz}: outward is measured from the ray
 * c + t*d (head centre, then down the body). fixed: constant reference axis.
 */
function frames(P, T, M, N, B, axisFrame, fixed) {
  let px = 0, py = 0, pz = 1;
  for (let m = 0; m < M; m++) {
    const o = m * 3;
    let ox, oy, oz;
    if (fixed) { ox = fixed[0]; oy = fixed[1]; oz = fixed[2]; }
    else {
      const A = axisFrame;
      const rx = P[o] - A.cx, ry = P[o + 1] - A.cy, rz = P[o + 2] - A.cz;
      const t = Math.max(0, rx * A.dx + ry * A.dy + rz * A.dz);
      ox = rx - A.dx * t; oy = ry - A.dy * t; oz = rz - A.dz * t;
    }
    const tx = T[o], ty = T[o + 1], tz = T[o + 2];
    const d = ox * tx + oy * ty + oz * tz;
    ox -= d * tx; oy -= d * ty; oz -= d * tz;
    let l = len3(ox, oy, oz);
    if (l < 1e-6) { ox = px; oy = py; oz = pz; const d2 = ox * tx + oy * ty + oz * tz; ox -= d2 * tx; oy -= d2 * ty; oz -= d2 * tz; l = len3(ox, oy, oz) || 1; }
    ox /= l; oy /= l; oz /= l;
    if (m && ox * px + oy * py + oz * pz < -0.2 && fixed) { ox = -ox; oy = -oy; oz = -oz; }
    N[o] = ox; N[o + 1] = oy; N[o + 2] = oz;
    B[o] = ty * oz - tz * oy; B[o + 1] = tz * ox - tx * oz; B[o + 2] = tx * oy - ty * ox;
    px = ox; py = oy; pz = oz;
  }
}

export class HairGeometry {
  /**
   * @param {StrandSet} strands
   * @param {import('./patch.js').SkinPatch|null} patch scalp cap (body-weighted)
   * @param {{pos:Float32Array, nor:Float32Array, tone:Float32Array, index:Uint32Array|number[]}[]} solids rigid extra meshes (rest space)
   * @param {number} headBone bone index all non-cap vertices are bound to
   */
  constructor(strands, patch, solids, headBone) {
    this.strands = strands;
    this.patch = patch;
    let nv = patch ? patch.count : 0, ni = patch ? patch.index.length : 0;
    this.vStart = new Uint32Array(strands.length);
    this.samples = new Uint16Array(strands.length);
    this.sides = new Uint8Array(strands.length);
    let maxM = 8;
    strands.list.forEach((s, i) => {
      const K = s.pts.length / 3;
      const M = Math.max(K, s.samples || K), S = s.sides || 6;
      this.vStart[i] = nv; this.samples[i] = M; this.sides[i] = S;
      nv += M * (S + 1); ni += (M - 1) * S * 6;
      maxM = Math.max(maxM, M);
    });
    this.solidStart = nv;
    for (const so of solids) { nv += so.pos.length / 3; ni += so.index.length; }
    ensureScratch(maxM);
    this.vertexCount = nv;

    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(nv * 3);
    this.nor = new Float32Array(nv * 3);
    this.col = new Float32Array(nv * 3);
    this.uv = new Float32Array(nv * 2);
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let io = 0;
    // cap
    if (patch) {
      si.set(patch.skinIndex); sw.set(patch.skinWeight);
      for (let k = 0; k < patch.index.length; k++) index[io++] = patch.index[k];
      for (let v = 0; v < patch.count; v++) this.col.fill(0.62, v * 3, v * 3 + 3);
      // the cap samples one texel row (no streaks across face boundaries)
    }
    for (let v = patch ? patch.count : 0; v < nv; v++) { si[v * 4] = headBone; sw[v * 4] = 1; }
    // strands bound to the skin (facial hair) carry their own weights
    strands.list.forEach((st, i) => {
      if (!st.skinIndex) return;
      const n = this.samples[i] * (this.sides[i] + 1), v0 = this.vStart[i];
      for (let v = v0; v < v0 + n; v++) for (let k = 0; k < 4; k++) { si[v * 4 + k] = st.skinIndex[k]; sw[v * 4 + k] = st.skinWeight[k]; }
    });
    // tubes: topology, colours
    strands.list.forEach((s, i) => {
      const M = this.samples[i], S = this.sides[i], v0 = this.vStart[i];
      for (let m = 0; m < M - 1; m++) for (let j = 0; j < S; j++) {
        const a = v0 + m * (S + 1) + j, b = a + 1, c = a + S + 1, d = c + 1;
        index[io++] = a; index[io++] = c; index[io++] = b;
        index[io++] = b; index[io++] = c; index[io++] = d;
      }
      const tone = s.tone ?? 1;
      for (let m = 0; m < M; m++) {
        const t = m / (M - 1);
        const along = tone * (0.7 + 0.3 * smoothstep(0, 0.3, t)) * (1 + 0.07 * t);
        for (let j = 0; j <= S; j++) {
          const under = Math.sin((j / S) * Math.PI * 2) < -0.2 ? 0.8 : 1;
          const v = v0 + m * (S + 1) + j;
          this.col.fill(clamp(along * under, 0, 1.3), v * 3, v * 3 + 3);
          this.uv[v * 2] = (j / S) * 2;
        }
      }
    });
    // solids
    let sv = this.solidStart;
    for (const so of solids) {
      const n = so.pos.length / 3;
      this.pos.set(so.pos, sv * 3); this.nor.set(so.nor, sv * 3);
      for (let v = 0; v < n; v++) this.col.fill(so.tone[v], (sv + v) * 3, (sv + v) * 3 + 3);
      if (so.uv) this.uv.set(so.uv, sv * 2);
      for (let k = 0; k < so.index.length; k++) index[io++] = so.index[k] + sv;
      sv += n;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-2, -1, -2), new THREE.Vector3(2, 3, 2));
    this.geometry = geo;
  }

  /** Copies the fitted cap positions / normals into the buffers. */
  writePatch() {
    if (!this.patch) return;
    this.pos.set(this.patch.pos, 0);
    this.nor.set(this.patch.nor, 0);
  }

  /**
   * Extrudes tube i around the centre line src (K points at offset so, floats).
   * axisFrame: see frames(). All math in place on shared scratch arrays.
   */
  writeStrand(i, src, so, axisFrame) {
    const s = this.strands.list[i];
    const K = s.pts.length / 3, M = this.samples[i], S = this.sides[i];
    const P = SP, T = ST, N = SN, B = SB, A = SA;
    resample(src, so, K, P, M);
    // arc length
    A[0] = 0;
    for (let m = 1; m < M; m++) A[m] = A[m - 1] + len3(P[m * 3] - P[m * 3 - 3], P[m * 3 + 1] - P[m * 3 - 2], P[m * 3 + 2] - P[m * 3 - 1]);
    const len = A[M - 1] || 1e-6;
    const fixed = s.axis || null;
    const det = s.detail;
    if (det && det.type) {
      tangents(P, M, T);
      frames(P, T, M, N, B, axisFrame, fixed);
      for (let m = 0; m < M; m++) {
        const ramp = smoothstep(det.start, det.start + 0.06, A[m]) * (det.fade ? 1 - 0.5 * smoothstep(len * 0.6, len, A[m]) : 1);
        if (!ramp) continue;
        const ph = (A[m] / det.wl) * Math.PI * 2 + det.phase;
        let ob, on;
        if (det.type === DETAIL_WAVE) { ob = Math.sin(ph); on = (det.depth ?? 0.35) * Math.cos(ph * 0.5); }
        else { ob = Math.cos(ph); on = Math.sin(ph); }
        const a = det.amp * ramp, o = m * 3;
        P[o] += (B[o] * ob + N[o] * on) * a;
        P[o + 1] += (B[o + 1] * ob + N[o + 1] * on) * a;
        P[o + 2] += (B[o + 2] * ob + N[o + 2] * on) * a;
      }
    }
    tangents(P, M, T);
    frames(P, T, M, N, B, axisFrame, fixed);
    const w0 = s.w, flat = s.flat ?? 0.38, rootW = s.rootW ?? 0.65, taper0 = s.taper0 ?? 0.55, tipW = s.tipW ?? 0.1;
    const bias = s.bias ?? 0.45, spread = s.spread || 0, pin = s.pin ?? K;
    // hanging part fans out: widen from the hang point on
    const sp0 = Math.min(0.9, pin / (K - 1));
    const pos = this.pos, nor = this.nor, uv = this.uv;
    // ring tables: the ellipse normal bent towards the layer normal does not depend on the
    // width, only on the flatness -> per-strand coefficients, no trig / sqrt per vertex
    const R = ringTable(S, flat, bias);
    let v = this.vStart[i];
    for (let m = 0; m < M; m++) {
      const t = m / (M - 1);
      let prof = (rootW + (1 - rootW) * smoothstep(0, 0.14, t)) * (1 - (1 - tipW) * smoothstep(taper0, 1, t));
      if (spread) prof *= 1 + spread * smoothstep(sp0, sp0 + 0.35, t);
      const w = Math.max(1e-5, w0 * prof), th = Math.max(1e-5, w * flat);
      const o = m * 3;
      const px = P[o], py = P[o + 1], pz = P[o + 2];
      const bx = B[o], by = B[o + 1], bz = B[o + 2], nx = N[o], ny = N[o + 1], nz = N[o + 2];
      const vv = A[m] / 0.09;
      for (let j = 0; j <= S; j++) {
        const ca = R[j * 4] * w, sa = R[j * 4 + 1] * th, cb = R[j * 4 + 2], cn = R[j * 4 + 3];
        const q = v * 3;
        pos[q] = px + bx * ca + nx * sa;
        pos[q + 1] = py + by * ca + ny * sa;
        pos[q + 2] = pz + bz * ca + nz * sa;
        nor[q] = bx * cb + nx * cn; nor[q + 1] = by * cb + ny * cn; nor[q + 2] = bz * cb + nz * cn;
        uv[v * 2 + 1] = vv;
        v++;
      }
    }
  }

  markDirty(uvToo = false) {
    const a = this.geometry.attributes;
    a.position.needsUpdate = true;
    a.normal.needsUpdate = true;
    if (uvToo) a.uv.needsUpdate = true;
  }

  dispose() { this.geometry.dispose(); }
}
