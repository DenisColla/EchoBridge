// Physics-lite for hanging hair.
//
// Everything is solved in HEAD REST SPACE: the space the hair geometry is
// authored in (rig rest space of a mesh rigidly skinned to the head bone).
// Points attached to the scalp are therefore constant, and a pose change only
// changes (a) the gravity direction seen from the head and (b) where the body
// colliders are relative to the head. That makes the solve cheap and lets the
// GPU skinning carry the rigid part between re-solves.
//
// BodyColliders: capsules fitted to the body at rest (neck, shoulders, upper
// arms, torso as stacked rounded slabs) and bound to bones; update() moves them
// into head space for the current pose. Plus the head hull (HeadMap) and the
// ground plane.
//
// GuideSolver: position-based relaxation of guide polylines: gravity, pull to
// the styled rest shape (stiffness), follow-the-leader length constraints with
// bending resistance, collisions. Runs a bounded number of iterations per frame
// until settled.
import * as THREE from 'three';
import { smoothstep, len2, len3 } from './util.js';

const _m = new THREE.Matrix4(), _hinv = new THREE.Matrix4(), _mb = new THREE.Matrix4();
const _v = new THREE.Vector3(), _p0 = new THREE.Vector3();
const _chest = [0, 0, 0];

const ARM = /^(upperarm|lowerarm|wrist|finger|metacarpal|shoulder01)/;
/** Angular sectors of a torso band cross-section. */
const NSECT = 32;
const TWO_PI = Math.PI * 2;
/** continuous sector coordinate (0..NSECT) of direction (x, z): 0 = front */
const sectorF = (x, z) => { let a = Math.atan2(x, z) / TWO_PI; if (a < 0) a += 1; const f = a * NSECT; return f >= NSECT ? 0 : f; };
const sectorOf = (x, z) => Math.min(NSECT - 1, Math.floor(sectorF(x, z) + 0.5) % NSECT);
/** Empty sectors (arm cut-outs) are interpolated from their nearest filled neighbours, then lightly smoothed (never shrunk). */
function fillSectors(R) {
  const n = R.length, src = Float32Array.from(R);
  for (let a = 0; a < n; a++) {
    if (src[a] > 0) continue;
    let l = 1, r = 1;
    while (l < n && !(src[(a - l + n) % n] > 0)) l++;
    while (r < n && !(src[(a + r) % n] > 0)) r++;
    const A = src[(a - l + n) % n], B = src[(a + r) % n];
    R[a] = A + (B - A) * (l / (l + r));
  }
  const T = Float32Array.from(R);
  for (let a = 0; a < n; a++) R[a] = Math.max(T[a], (T[(a + n - 1) % n] + 2 * T[a] + T[(a + 1) % n]) / 4);
}
/** Extra height over garments (m): pose folds rise above the rest cloth surface. */
const CLOTH_MARGIN = 0.003;

export class BodyColliders {
  /**
   * @param {import('../core/Character.js').Character} ch
   * @param {object} frame headFrame
   * @param {THREE.Mesh[]} garments skinned garment meshes (rest-space geometry): hair rests on clothes
   * @param {Float32Array|null} outer outer garment surface height over each body vertex (clothing
   *   module, app.clothing.outerOffsets): when given, every fit is made on the DRESSED body (body
   *   vertices raised by it) instead of the garment meshes
   */
  constructor(ch, frame, garments = [], outer = null) {
    this.ch = ch;
    const m = ch.model, s = frame.s;
    const J = (n) => ch.jointPositions.get(n + '____head');
    const bi = (n) => m.boneIndex.get(n);
    const caps = []; // {a:[x,y,z], ba, b:[x,y,z], bb, r}
    // sample points: body vertices (dressed) + garment vertices, with their skin weights
    const bodyV = m.groupVertices[0];
    if (outer && outer.length < bodyV.length) outer = null;
    if (outer) garments = [];
    const dressed = !!outer && outer.some((h) => h > 0);
    let count = bodyV.length;
    for (const g of garments) count += g.geometry.attributes.position.count;
    const P = new Float32Array(count * 3), SI = new Uint16Array(count * 4), SW = new Float32Array(count * 4);
    const RN = ch.restNormals;
    bodyV.forEach((v, i) => {
      // cloth surface (+ an allowance for its pose folds) over the skin
      const h = outer && outer[i] > 0 ? outer[i] + CLOTH_MARGIN : 0;
      for (let q = 0; q < 3; q++) P[i * 3 + q] = ch.shapePositions[v * 3 + q] + RN[v * 3 + q] * h;
      for (let q = 0; q < 4; q++) { SI[i * 4 + q] = m.skinIndex[v * 4 + q]; SW[i * 4 + q] = m.skinWeight[v * 4 + q]; }
    });
    let o = bodyV.length;
    for (const g of garments) {
      const a = g.geometry.attributes, gp = a.position.array, gi = a.skinIndex?.array, gw = a.skinWeight?.array;
      P.set(gp.subarray(0, a.position.count * 3), o * 3);
      if (gi && gw) { SI.set(gi.subarray(0, a.position.count * 4), o * 4); SW.set(gw.subarray(0, a.position.count * 4), o * 4); }
      o += a.position.count;
    }
    const nBody = bodyV.length;
    const boneW = (v, set) => { let w = 0; for (let k = 0; k < 4; k++) if (set.has(SI[v * 4 + k])) w += SW[v * 4 + k]; return w; };
    const armBones = new Set(m.bones.map((b, i) => (ARM.test(b.name) ? i : -1)).filter((i) => i >= 0));

    /** median-ish (percentile) distance of selected vertices to segment AB */
    const fitR = (A, B, filter, pct, t0 = 0.15, t1 = 0.85, upperOnly = false) => {
      const abx = B.x - A.x, aby = B.y - A.y, abz = B.z - A.z, l2 = abx * abx + aby * aby + abz * abz;
      const ds = [];
      for (let v = 0; v < count; v++) {
        if (!filter(v)) continue;
        const x = P[v * 3] - A.x, y = P[v * 3 + 1] - A.y, z = P[v * 3 + 2] - A.z;
        const t = (x * abx + y * aby + z * abz) / l2;
        if (t < t0 || t > t1) continue;
        const dx = x - abx * t, dy = y - aby * t, dz = z - abz * t;
        if (upperOnly && dy < 0) continue;
        const d = len3(dx, dy, dz);
        if (d < 0.2 * s) ds.push(d);
      }
      if (!ds.length) return 0.04 * s;
      ds.sort((a, b) => a - b);
      return ds[Math.min(ds.length - 1, Math.floor(ds.length * pct))];
    };

    // neck
    const neckSet = new Set(['neck01', 'neck02', 'neck03'].map(bi));
    const n0 = J('neck01'), hh = J('head');
    caps.push({ a: [n0.x, n0.y - 0.01 * s, n0.z], ba: bi('neck01'), b: [hh.x, hh.y, hh.z], bb: bi('neck03'), r: fitR(n0, hh, (v) => v < nBody && boneW(v, neckSet) > 0.5, 0.35) * 0.95 });
    // shoulders (trapezius ridge) + upper arms
    for (const side of ['L', 'R']) {
      const sg = side === 'L' ? 1 : -1;
      const ua = J('upperarm01.' + side), la = J('lowerarm01.' + side);
      const A = new THREE.Vector3(0.045 * s * sg, n0.y - 0.03 * s, n0.z - 0.006 * s);
      const torsoV = (v) => boneW(v, armBones) < 0.3;
      // over clothes the colliders must reach the cloth surface (hair rests ON it):
      // fitted higher in the distance distribution of the dressed body
      const r = fitR(A, ua, torsoV, dressed ? 0.62 : 0.45, 0.1, 0.9, true);
      caps.push({ a: A.toArray(), ba: bi('clavicle.' + side), b: [ua.x, ua.y, ua.z], bb: bi('clavicle.' + side), r: Math.max(0.03 * s, r * (dressed ? 1 : 0.95)) });
      const upSet = new Set([bi('upperarm01.' + side), bi('upperarm02.' + side)]);
      const ra = fitR(ua, la, (v) => boneW(v, upSet) > 0.5, dressed ? 0.72 : 0.5, 0.15, 0.85);
      caps.push({ a: [ua.x, ua.y, ua.z], ba: bi('upperarm01.' + side), b: [la.x, la.y, la.z], bb: bi('upperarm02.' + side), r: ra * (dressed ? 1 : 0.95) });
    }
    // torso: generalized cylinder (stack of measured cross-sections), each band bound
    // to the spine bone at its height
    const spines = ['spine01', 'spine02', 'spine03', 'spine04', 'spine05'].map((n) => ({ n, i: bi(n), y: J(n).y }));
    // from the neck base (upper back / collar region) down to the hips
    const yTop = Math.max(J('upperarm01.L').y + 0.01 * s, n0.y - 0.015 * s), yBot = J('spine05').y - 0.12 * s;
    const nb = Math.max(4, Math.round((yTop - yBot) / (0.035 * s)));
    const bands = [];
    // the back and front of the armpit (scapula, pectoral fold) are partly arm
    // weighted: keep them inside the shoulder line, where long hair falls
    const xIn = Math.abs(J('upperarm01.L').x) - 0.02 * s;
    // cross-section of each band: radius per angle around the band centre (star shaped,
    // the max over the band's vertices in each sector), fitted to the dressed body, so
    // the front of the shoulders, the bust and the shoulder blades are all enclosed
    for (let k = 0; k <= nb; k++) {
      const y = yTop - ((yTop - yBot) * k) / nb;
      let zf = -1e9, zb = 1e9, cnt = 0;
      const sel = [];
      for (let v = 0; v < count; v++) {
        if (Math.abs(P[v * 3 + 1] - y) > 0.01 * s) continue;
        const aw = boneW(v, armBones);
        if (aw > 0.6 || (aw > 0.25 && Math.abs(P[v * 3]) > xIn)) continue;
        const z = P[v * 3 + 2];
        if (z > zf) zf = z;
        if (z < zb) zb = z;
        sel.push(v);
        cnt++;
      }
      if (cnt < 8) { if (bands.length) bands.push({ ...bands[bands.length - 1], y }); continue; }
      const cz = (zf + zb) / 2, R = new Float32Array(NSECT);
      for (const v of sel) {
        const x = P[v * 3], z = P[v * 3 + 2] - cz;
        const r = len2(x, z), a = sectorOf(x, z);
        if (r > R[a]) R[a] = r;
      }
      fillSectors(R);
      const sp = spines.find((q) => q.y <= y + 0.02 * s) || spines[spines.length - 1];
      let Rmax = 0;
      for (let a = 0; a < NSECT; a++) if (R[a] > Rmax) Rmax = R[a];
      bands.push({ y, cz, R, Rmax, bone: sp.i });
    }
    this.bands = bands;
    this.nb = bands.length;
    this.bandDy = (yTop - yBot) / nb;
    /** per band: head space -> bone rest space (M) and back (Mi), column-major 4x4 */
    this.bandM = new Float32Array(this.nb * 16);
    this.bandMi = new Float32Array(this.nb * 16);
    for (let k = 0; k < this.nb; k++) for (const A of [this.bandM, this.bandMi]) { A[k * 16] = A[k * 16 + 5] = A[k * 16 + 10] = A[k * 16 + 15] = 1; }
    this.rest = caps;
    this.n = caps.length;
    /** current capsules in head space: ax ay az bx by bz r | bounding sphere cx cy cz R */
    this.cur = new Float32Array(this.n * 11);
    this.gravity = new Float32Array([0, -1, 0]);
    /** ground plane in head space: n (3), d  (n.p + d >= 0 above ground) */
    this.ground = new Float32Array([0, 1, 0, 0]);
    /** body axis for clump frames: from head centre towards the upper chest (head space) */
    this.down = new Float32Array([0, -1, 0]);
    /** body front (chest +Z) in head space: strands slide off shoulders towards +-front */
    this.front = new Float32Array([0, 0, 1]);
    this.sig = new Float32Array(this.n * 6 + 3);
    /** outward normal of the last contact reported by push() */
    this.hitN = new Float32Array(3);
    this._chestRest = J('spine01').toArray();
    this._chestBone = bi('spine01');
    this._headBone = frame.headBone;
    this._c = frame.c;
    this.update(true);
  }

  /**
   * Moves the colliders into head space for the current pose.
   * rest=true: the rest pose (head space = rig rest space), used while growing.
   * Returns the largest change (m or rad-ish) since the last call (for re-solve decisions).
   */
  update(rest = false) {
    const ch = this.ch, cur = this.cur;
    let S = null;
    if (!rest) {
      S = ch.updateSkinMatrices();
      _hinv.fromArray(S, this._headBone * 16).invert();
    }
    const tr = (p, bone, out, o) => {
      if (rest) { out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2]; return; }
      _mb.fromArray(S, bone * 16);
      _m.multiplyMatrices(_hinv, _mb);
      _v.set(p[0], p[1], p[2]).applyMatrix4(_m);
      out[o] = _v.x; out[o + 1] = _v.y; out[o + 2] = _v.z;
    };
    // torso bands
    for (let k = 0; k < this.nb; k++) {
      if (rest) { _m.identity(); _m.toArray(this.bandM, k * 16); _m.toArray(this.bandMi, k * 16); continue; }
      _mb.fromArray(S, this.bands[k].bone * 16);
      _m.multiplyMatrices(_hinv, _mb); // bone rest -> head space
      _m.toArray(this.bandMi, k * 16);
      _m.invert().toArray(this.bandM, k * 16);
    }
    for (let i = 0; i < this.n; i++) {
      const c = this.rest[i], o = i * 11;
      tr(c.a, c.ba, cur, o);
      tr(c.b, c.bb, cur, o + 3);
      cur[o + 6] = c.r;
      cur[o + 7] = (cur[o] + cur[o + 3]) / 2; cur[o + 8] = (cur[o + 1] + cur[o + 4]) / 2; cur[o + 9] = (cur[o + 2] + cur[o + 5]) / 2;
      cur[o + 10] = len3(cur[o + 3] - cur[o], cur[o + 4] - cur[o + 1], cur[o + 5] - cur[o + 2]) / 2 + c.r;
    }
    // gravity and ground in head space
    const g = this.gravity, gp = this.ground;
    if (rest) { g[0] = 0; g[1] = -1; g[2] = 0; gp[0] = 0; gp[1] = 1; gp[2] = 0; gp[3] = 1e3; }
    else {
      // world down -> rig -> head rest space
      const rigW = ch.rig.matrixWorld;
      _m.copy(rigW).invert();
      _v.set(0, -1, 0).transformDirection(_m); // world down in rig space
      _mb.multiplyMatrices(_hinv, _m); // world -> head rest space
      _v.transformDirection(_hinv);
      g[0] = _v.x; g[1] = _v.y; g[2] = _v.z;
      // ground: world y = 0 plane
      const p0 = _p0.set(0, 0, 0).applyMatrix4(_mb);
      const n0 = _v.set(0, 1, 0).transformDirection(_mb);
      gp[0] = n0.x; gp[1] = n0.y; gp[2] = n0.z; gp[3] = -(n0.x * p0.x + n0.y * p0.y + n0.z * p0.z);
    }
    // body axis
    const chest = _chest;
    tr(this._chestRest, this._chestBone, chest, 0);
    if (rest) { this.front[0] = 0; this.front[1] = 0; this.front[2] = 1; }
    else {
      _mb.fromArray(S, this._chestBone * 16);
      _m.multiplyMatrices(_hinv, _mb);
      _v.set(0, 0, 1).transformDirection(_m);
      this.front[0] = _v.x; this.front[1] = _v.y; this.front[2] = _v.z;
    }
    const c = this._c;
    let dx = chest[0] - c.x, dy = chest[1] - c.y, dz = chest[2] - c.z;
    const dl = len3(dx, dy, dz) || 1;
    this.down[0] = dx / dl; this.down[1] = dy / dl; this.down[2] = dz / dl;
    // change signature
    const sig = this.sig;
    let change = 0;
    for (let i = 0; i < this.n; i++) for (let k = 0; k < 6; k++) {
      const v = cur[i * 11 + k], d = Math.abs(v - sig[i * 6 + k]);
      if (d > change) change = d;
      sig[i * 6 + k] = v;
    }
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(g[k] - sig[this.n * 6 + k]) * 0.12; // ~1 deg of tilt ~ 2 mm
      if (d > change) change = d;
      sig[this.n * 6 + k] = g[k];
    }
    return change;
  }

  /**
   * Pushes point (x,y,z) out of every capsule and above the ground (radius r).
   * Writes the result into out[o..o+2]; returns true if it moved.
   */
  push(x, y, z, r, out, o) {
    const cur = this.cur;
    let hit = false;
    for (let i = 0; i < this.n; i++) {
      const q = i * 11;
      const R = cur[q + 10] + r;
      const ex = x - cur[q + 7], ey = y - cur[q + 8], ez = z - cur[q + 9];
      if (ex * ex + ey * ey + ez * ez > R * R) continue;
      const ax = cur[q], ay = cur[q + 1], az = cur[q + 2];
      const abx = cur[q + 3] - ax, aby = cur[q + 4] - ay, abz = cur[q + 5] - az;
      const l2 = abx * abx + aby * aby + abz * abz || 1e-12;
      let t = ((x - ax) * abx + (y - ay) * aby + (z - az) * abz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (ax + abx * t), dy = y - (ay + aby * t), dz = z - (az + abz * t);
      const d2 = dx * dx + dy * dy + dz * dz, rr = cur[q + 6] + r;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-9;
      const k = rr / d;
      x = ax + abx * t + dx * k; y = ay + aby * t + dy * k; z = az + abz * t + dz * k;
      const hn = this.hitN;
      hn[0] = dx / d; hn[1] = dy / d; hn[2] = dz / d;
      hit = true;
    }
    // torso (quick reject above the shoulders / below the hips in the top / bottom band frames)
    // (radius per angle, interpolated between the two bands around the point)
    const M = this.bandM, bands = this.bands, nb = this.nb;
    const yTop = M[1] * x + M[5] * y + M[9] * z + M[13];
    const ob = (nb - 1) * 16;
    const yBot = M[ob + 1] * x + M[ob + 5] * y + M[ob + 9] * z + M[ob + 13];
    // bands are evenly spaced in rest height: start the search at the estimated band
    const k0 = yTop > bands[0].y + r || yBot < bands[nb - 1].y - r ? nb : Math.max(0, Math.min(nb - 2, Math.floor((bands[0].y - yTop) / this.bandDy) - 1));
    for (let k = k0; k < nb - 1; k++) {
      const o = k * 16;
      const qy = M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13];
      const b0 = bands[k], b1 = bands[k + 1];
      if (qy > b0.y || qy < b1.y) continue;
      const qx = M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12];
      const qz = M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14];
      const t = (b0.y - qy) / (b0.y - b1.y);
      // the top band is rounded off (dome) so points entering from above are pushed smoothly
      const dome = k === 0 ? Math.sqrt(0.15 + 0.85 * t) : 1;
      const cz = b0.cz + (b1.cz - b0.cz) * t;
      const dz = qz - cz, rr = len2(qx, dz);
      if (rr >= Math.max(b0.Rmax, b1.Rmax) * dome + r) break; // clearly outside
      const f = sectorF(qx, dz), a0 = f | 0, a1 = (a0 + 1) % NSECT, fa = f - a0;
      const Rb0 = b0.R[a0] + (b0.R[a1] - b0.R[a0]) * fa, Rb1 = b1.R[a0] + (b1.R[a1] - b1.R[a0]) * fa;
      const Rs = (Rb0 + (Rb1 - Rb0) * t) * dome + r;
      if (rr >= Rs) break;
      // radial projection onto the section
      let nx = 0, nz = -1;
      if (rr > 1e-6) { nx = qx / rr; nz = dz / rr; }
      const px = nx * Rs, pz = cz + nz * Rs;
      const Mi = this.bandMi;
      x = Mi[o] * px + Mi[o + 4] * qy + Mi[o + 8] * pz + Mi[o + 12];
      y = Mi[o + 1] * px + Mi[o + 5] * qy + Mi[o + 9] * pz + Mi[o + 13];
      z = Mi[o + 2] * px + Mi[o + 6] * qy + Mi[o + 10] * pz + Mi[o + 14];
      const hn = this.hitN;
      hn[0] = Mi[o] * nx + Mi[o + 8] * nz; hn[1] = Mi[o + 1] * nx + Mi[o + 9] * nz; hn[2] = Mi[o + 2] * nx + Mi[o + 10] * nz;
      hit = true;
      break;
    }
    const gp = this.ground;
    const h = gp[0] * x + gp[1] * y + gp[2] * z + gp[3] - r;
    if (h < 0) { x -= gp[0] * h; y -= gp[1] * h; z -= gp[2] * h; hit = true; this.hitN[0] = gp[0]; this.hitN[1] = gp[1]; this.hitN[2] = gp[2]; }
    out[o] = x; out[o + 1] = y; out[o + 2] = z;
    return hit;
  }
}

const _hn = [0, 0, 0];
/**
 * Keeps a point at least `margin` outside the head hull. The test is radial (the
 * hull is star-shaped around c) but the response is along the local surface
 * normal by the distance to the tangent plane: well conditioned even where the
 * rays graze the surface (neck walls, under the jaw). Returns true if moved.
 */
export function pushHead(map, x, y, z, margin, out, o) {
  const c = map.c;
  const dx = x - c.x, dy = y - c.y, dz = z - c.z;
  const r = len3(dx, dy, dz);
  out[o] = x; out[o + 1] = y; out[o + 2] = z;
  if (r < 1e-6) return false;
  const rh = map.sample(dx, dy, dz, _hn);
  if (rh <= 0 || r >= rh + margin * 3) return false;
  const cos = (dx * _hn[0] + dy * _hn[1] + dz * _hn[2]) / r;
  const d = (r - rh) * Math.max(0.2, cos); // signed distance to the tangent plane
  if (d >= margin) return false;
  const k = margin - d;
  out[o] = x + _hn[0] * k; out[o + 1] = y + _hn[1] * k; out[o + 2] = z + _hn[2] * k;
  return true;
}

/**
 * Relaxation solver for guide polylines (head rest space).
 * guides: [{start (point offset), K, pin, rad, shape:Float32Array(K) per-point pull to rest, bend}]
 */
export class GuideSolver {
  /** lengths: optional polylines whose segment lengths are the inextensible lengths (default: rest) */
  constructor(rest, guides, map, colliders, lengths = rest) {
    this.rest = rest; // Float32Array of all guide points
    this.cur = Float32Array.from(rest);
    this.guides = guides;
    this.map = map;
    this.col = colliders;
    this.seg = new Float32Array(rest.length / 3);
    for (const g of guides) for (let k = 1; k < g.K; k++) {
      const a = (g.start + k - 1) * 3, b = a + 3;
      this.seg[g.start + k] = len3(lengths[b] - lengths[a], lengths[b + 1] - lengths[a + 1], lengths[b + 2] - lengths[a + 2]);
    }
    this.gStep = 0.008 * (map.scale || 1);
    /** contact in the last iteration: 1 body (with its normal in cn), 2 head */
    this.contact = new Uint8Array(rest.length / 3);
    this.cn = new Float32Array(rest.length);
    /** friction coefficient of hair resting on the body (shoulders, back, arms) */
    this.mu = 0.7;
    this.settled = true;
    this.lastMove = 0;
    this._t = new Float32Array(3);
  }

  /** Restarts from the rest shape (e.g. after load: big jumps converge faster from rest). */
  reset() { this.cur.set(this.rest); this.contact.fill(0); this.settled = false; }

  /** n iterations; returns the max point displacement of the last iteration (mean in this.meanMove). */
  iterate(n) {
    const { cur, rest, seg, col, map } = this;
    const g = col.gravity, gs = this.gStep;
    const tmp = this._t, contact = this.contact, cn = this.cn, mu = this.mu;
    let maxMove = 0;
    let sum = 0, cnt = 0;
    for (let it = 0; it < n; it++) {
      maxMove = 0; sum = 0; cnt = 0;
      for (const gd of this.guides) {
        const s0 = gd.start, K = gd.K, pin = gd.pin;
        const shape = gd.shape, bend = gd.bend, rad = gd.rad;
        for (let k = pin; k < K; k++) {
          const o = (s0 + k) * 3;
          const ox = cur[o], oy = cur[o + 1], oz = cur[o + 2];
          // gravity + pull towards the styled rest shape
          const w = shape[k];
          let gx = g[0] * gs, gy = g[1] * gs, gz = g[2] * gs;
          if (contact[s0 + k] === 1) {
            // friction cone: resting hair only slides where the surface is steep enough
            const nx = cn[o], ny = cn[o + 1], nz = cn[o + 2];
            const gn = gx * nx + gy * ny + gz * nz;
            if (gn < 0) {
              const tx = gx - gn * nx, ty = gy - gn * ny, tz = gz - gn * nz;
              const tl = len3(tx, ty, tz), lim = -gn * mu;
              const f = tl > lim ? (tl - lim) / tl : 0;
              gx = tx * f; gy = ty * f; gz = tz * f;
            }
          }
          let x = ox + gx, y = oy + gy, z = oz + gz;
          x += (rest[o] - x) * w; y += (rest[o + 1] - y) * w; z += (rest[o + 2] - z) * w;
          // follow the leader (inextensible) with bending resistance
          const p = o - 3;
          let dx = x - cur[p], dy = y - cur[p + 1], dz = z - cur[p + 2];
          let l = len3(dx, dy, dz) || 1e-9;
          dx /= l; dy /= l; dz /= l;
          if (k >= 2 && bend > 0) {
            const q = p - 3;
            let px = cur[p] - cur[q], py = cur[p + 1] - cur[q + 1], pz = cur[p + 2] - cur[q + 2];
            const pl = len3(px, py, pz) || 1e-9;
            dx += (px / pl) * bend; dy += (py / pl) * bend; dz += (pz / pl) * bend;
            l = len3(dx, dy, dz) || 1e-9;
            dx /= l; dy /= l; dz /= l;
          }
          const L = seg[s0 + k];
          x = cur[p] + dx * L; y = cur[p + 1] + dy * L; z = cur[p + 2] + dz * L;
          // collisions: body, head
          let hit = col.push(x, y, z, rad, tmp, 0) ? 1 : 0;
          if (hit) { cn[o] = col.hitN[0]; cn[o + 1] = col.hitN[1]; cn[o + 2] = col.hitN[2]; }
          if (gd.head && pushHead(map, tmp[0], tmp[1], tmp[2], rad, tmp, 0)) hit = 2;
          contact[s0 + k] = hit;
          x = tmp[0]; y = tmp[1]; z = tmp[2];
          const mv = Math.abs(x - ox) + Math.abs(y - oy) + Math.abs(z - oz);
          if (mv > maxMove) { maxMove = mv; this.worst = s0 + k; }
          sum += mv; cnt++;
          cur[o] = x; cur[o + 1] = y; cur[o + 2] = z;
        }
      }
    }
    this.lastMove = maxMove;
    this.meanMove = cnt ? sum / cnt : 0;
    return maxMove;
  }
}

/** Default per-point shape stiffness profile: strong near the scalp, free tips. */
export function shapeProfile(K, pin, near, far, span = 0.5) {
  const a = new Float32Array(K);
  for (let k = 0; k < K; k++) {
    const t = K - pin > 1 ? (k - pin) / (K - pin - 1) : 1;
    a[k] = k < pin ? 1 : near + (far - near) * smoothstep(0, span, t);
  }
  return a;
}
