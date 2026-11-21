// Turns garment drafts (fine quad surfaces + extras) into one skinned
// BufferGeometry with UV seams, material groups and the per-frame wrinkle
// runtime (WrinklePart per draft).
//
// UV sets:
//   uv  (channel 0): metric cylindrical coords (arc length around the region at a
//                    reference radius, axial distance) for the tiling weave map
//   uv1 (channel 1): garment atlas (one rect per region, angle x normalized body
//                    coordinate) for the per-garment detail map (seams, pockets…)
// Seams: vertices are split where the angle wraps and between regions.
import * as THREE from 'three';
import { quadNormals, buildAdjacency, buildEdges } from './mesh.js';
import { WrinklePart, foldFields, noise3 } from './wrinkles.js';
import { staticFolds } from './build.js';

/** Atlas rects [x0, y0, w, h] per region (0 torso, 1 arm L, 2 arm R, 3 leg L, 4 leg R). */
export const ATLAS = [
  [0.01, 0.01, 0.56, 0.44],
  [0.59, 0.01, 0.19, 0.44],
  [0.80, 0.01, 0.19, 0.44],
  [0.01, 0.47, 0.30, 0.52],
  [0.33, 0.47, 0.30, 0.52],
];
/** uv1 of plain (detail-free) geometry: a white corner of every detail map. */
export const WHITE_UV1 = [0.9, 0.9];
export const T_RANGE = [-0.6, 5.8];
export const A_RANGE = [-0.35, 3.0];
/** atlas coordinate of region r at angle theta and normalized body coordinate (T or limb param) */
export function atlasUV(r, theta, coord, out, o = 0) {
  const R = ATLAS[r];
  const norm = r === 0 ? (coord - T_RANGE[0]) / (T_RANGE[1] - T_RANGE[0]) : (coord - A_RANGE[0]) / (A_RANGE[1] - A_RANGE[0]);
  out[o] = R[0] + R[2] * (theta / (2 * Math.PI) + 0.5);
  out[o + 1] = R[1] + R[3] * Math.max(0, Math.min(1, norm));
  return out;
}

const R_REF = [0.15, 0.05, 0.05, 0.075, 0.075];
/** Artistic gain over the inextensible-strip estimate (real fabric bunches into fewer, deeper folds). */
export const FOLD_GAIN = 2.0;

/** Per-region reference radius and fold frames of a draft. */
function foldFrames(draft, wr, bi) {
  const C = draft.coords, P = draft.P, nf = draft.nf;
  const sum = new Float64Array(5), cnt = new Float64Array(5), tmp = new Float32Array(9);
  for (let i = 0; i < nf; i += 3) {
    const L = C.limb[i];
    if (!L || C.wT[i] > 0.5) { bi.torsoCyl(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], tmp); sum[0] += tmp[1]; cnt[0]++; } else {
      bi.limbs[L].cyl(Math.max(0, C.aL[i]), P[i * 3], P[i * 3 + 1], P[i * 3 + 2], tmp); sum[L] += tmp[1]; cnt[L]++;
    }
  }
  const rr = [0, 1, 2, 3, 4].map((r) => (cnt[r] ? sum[r] / cnt[r] : R_REF[r]));
  const wlT = wr.wl ?? 0.05, wlA = wr.wlArm ?? wlT * 0.75, wlL = wr.wlLeg ?? wlT * 0.95;
  const mk = (wl, r) => { const k = (2 * Math.PI) / wl; return { k, N: Math.max(3, Math.round((2 * Math.PI * r) / (wl * 1.35))), M: Math.max(1, Math.round(k * r * Math.SQRT1_2)) }; };
  const t = mk(wlT, rr[0]);
  const fr = { kT: t.k, NT: t.N, MT: t.M, kL: [0], NL: [0], ML: [0], rr };
  for (let r = 1; r <= 4; r++) { const q = mk(r <= 2 ? wlA : wlL, rr[r]); fr.kL[r] = q.k; fr.NL[r] = q.N; fr.ML[r] = q.M; }
  return fr;
}

/** Coarse strain basis: e1 along the region axis (projected), e2 = e1 x n (direction of increasing angle). */
function coarseBasis(draft, bi) {
  const c = draft.coarse, n = c.n, G = c.G;
  const N = quadNormals(n, c.quads, G);
  const B = new Float32Array(n * 6);
  const co = c.coords;
  for (let i = 0; i < n; i++) {
    let ax = 0, ay = -1, az = 0;
    if (co && co.limb[i] && co.wT[i] < 0.5) {
      const L = bi.limbs[co.limb[i]], a = co.aL[i], s = a < 1 ? 0 : a < 2 ? 1 : 2;
      ax = L.D[s * 3]; ay = L.D[s * 3 + 1]; az = L.D[s * 3 + 2];
    }
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    const d = ax * nx + ay * ny + az * nz;
    let ex = ax - d * nx, ey = ay - d * ny, ez = az - d * nz;
    let l = Math.hypot(ex, ey, ez);
    if (l < 0.2) { // axis almost along the normal (e.g. shoulder top): any tangent
      const fx = Math.abs(nx) < 0.9 ? 1 : 0, fy = fx ? 0 : 1;
      const dd = fx * nx + fy * ny;
      ex = fx - dd * nx; ey = fy - dd * ny; ez = -dd * nz; l = Math.hypot(ex, ey, ez) || 1;
    }
    ex /= l; ey /= l; ez /= l;
    B[i * 6] = ex; B[i * 6 + 1] = ey; B[i * 6 + 2] = ez;
    B[i * 6 + 3] = ey * nz - ez * ny; B[i * 6 + 4] = ez * nx - ex * nz; B[i * 6 + 5] = ex * ny - ey * nx;
  }
  return B;
}

/**
 * Assembles drafts into a geometry + runtime.
 * pieces: [{draft, extras: Extras[], faceGroup?(f)->group, wrinkle: def.wrinkle, folds: features, uvRegion?}]
 */
export function assemble(pieces, bi, opts = {}) {
  const pos = [], uv = [], uv1 = [], skI = [], skW = [], rv2v = [], nid = [];
  const groupsTris = [[], [], []];
  const parts = [];
  let fineOffset = 0, nslot = 0;
  const uvTmp = [0, 0];
  for (const pc of pieces) {
    const d = pc.draft;
    if (!d) continue;
    const nf = d.nf, C = d.coords, P = d.P;
    const N = d.N || quadNormals(nf, d.quads, P);
    d.N = N;
    // ---- main surface render vertices with seams
    const keyMap = new Map();
    const nq = d.quads.length >> 2;
    const thetaOf = (v, R) => (R === 0 ? C.thT[v] : (C.limb[v] === R ? C.thL[v] : C.thT[v]));
    const coordOf = (v, R) => (R === 0 ? C.tT[v] : (C.limb[v] === R ? C.aL[v] : 0));
    const sOf = (v, R) => (R === 0 ? C.sT[v] : (C.limb[v] === R ? C.sL[v] : C.sT[v]));
    const rRef = pc.uvRadius || [0.15, 0.05, 0.05, 0.07, 0.07];
    const getRV = (v, R, th) => {
      const shift = Math.round((th - thetaOf(v, R)) / (2 * Math.PI));
      const key = (v * 8 + R) * 4 + (shift + 1);
      let r = keyMap.get(key);
      if (r !== undefined) return r;
      r = rv2v.length;
      keyMap.set(key, r);
      rv2v.push(fineOffset + v);
      nid.push(nslot + v);
      pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      uv.push(th * rRef[R], sOf(v, R));
      atlasUV(R, th, coordOf(v, R), uvTmp);
      uv1.push(uvTmp[0], uvTmp[1]);
      for (let k = 0; k < 4; k++) { skI.push(d.skin.idx[v * 4 + k]); skW.push(d.skin.w[v * 4 + k]); }
      return r;
    };
    const ths = [0, 0, 0, 0];
    for (let f = 0; f < nq; f++) {
      const vs = [d.quads[f * 4], d.quads[f * 4 + 1], d.quads[f * 4 + 2], d.quads[f * 4 + 3]];
      // face region
      let wt = 0;
      const lc = [0, 0, 0, 0, 0];
      for (const v of vs) { const L = C.limb[v]; wt += L ? C.wT[v] : 1; if (L) lc[L] += 1 - C.wT[v]; }
      let R = 0;
      if (pc.uvRegion !== undefined) R = pc.uvRegion;
      else if (wt < 2) { let b = 0; for (let r = 1; r <= 4; r++) if (lc[r] > b) { b = lc[r]; R = r; } }
      const ref = thetaOf(vs[0], R);
      for (let k = 0; k < 4; k++) {
        let th = thetaOf(vs[k], R);
        if (th - ref > Math.PI) th -= 2 * Math.PI; else if (th - ref < -Math.PI) th += 2 * Math.PI;
        ths[k] = th;
      }
      const r0 = getRV(vs[0], R, ths[0]), r1 = getRV(vs[1], R, ths[1]), r2 = getRV(vs[2], R, ths[2]), r3 = getRV(vs[3], R, ths[3]);
      let g = 0;
      if (pc.faceGroup) g = pc.faceGroup(f, vs);
      else if (d.zone && d.zone[vs[0]] + d.zone[vs[1]] + d.zone[vs[2]] + d.zone[vs[3]] > 2) g = 1;
      // split along the shorter diagonal
      const a = vs[0] * 3, b = vs[1] * 3, c = vs[2] * 3, e = vs[3] * 3;
      const d02 = (P[a] - P[c]) ** 2 + (P[a + 1] - P[c + 1]) ** 2 + (P[a + 2] - P[c + 2]) ** 2;
      const d13 = (P[b] - P[e]) ** 2 + (P[b + 1] - P[e + 1]) ** 2 + (P[b + 2] - P[e + 2]) ** 2;
      if (d02 <= d13) groupsTris[g].push(r0, r1, r2, r0, r2, r3); else groupsTris[g].push(r0, r1, r3, r1, r2, r3);
    }
    // ---- extras
    let extraSlot = nslot + nf;
    for (const ex of pc.extras || []) {
      if (!ex) continue;
      const base = rv2v.length, ne = ex.parent.length;
      for (let i = 0; i < ne; i++) {
        const v = ex.parent[i];
        rv2v.push(v >= 0 ? fineOffset + v : -1);
        nid.push(extraSlot++);
        pos.push(ex.pos[i * 3], ex.pos[i * 3 + 1], ex.pos[i * 3 + 2]);
        uv.push(ex.uv[i * 2], ex.uv[i * 2 + 1]);
        uv1.push(ex.uv1 ? ex.uv1[i * 2] : WHITE_UV1[0], ex.uv1 ? ex.uv1[i * 2 + 1] : WHITE_UV1[1]);
        if (ex.skinIdx) for (let k = 0; k < 4; k++) { skI.push(ex.skinIdx[i * 4 + k]); skW.push(ex.skinW[i * 4 + k]); }
        else for (let k = 0; k < 4; k++) { skI.push(d.skin.idx[v * 4 + k]); skW.push(d.skin.w[v * 4 + k]); }
      }
      const gt = groupsTris[ex.group];
      for (const t of ex.tris) gt.push(base + t);
    }
    // ---- wrinkle runtime
    const wr = pc.wrinkle || {};
    const fr = foldFrames(d, wr, bi);
    const prof = foldFields(nf, C, P, fr, wr.bias ?? 0.3);
    // fold amplitude: excess length c folded into waves of length L gives a
    // peak-to-trough of about (2L/pi) sqrt(c); k = garment softness/looseness
    const amp = new Float32Array(nf);
    const k0 = (wr.k ?? 0.8) * (0.6 + 0.8 * (d.fitT ?? 0.5)) * (2 / Math.PI) * FOLD_GAIN;
    const wlT = 2 * Math.PI / fr.kT;
    for (let i = 0; i < nf; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const mod = 0.75 + 0.4 * noise3(x * 3.1 + 17, y * 3.1 - 3, z * 3.1 + 9);
      const L = C.limb[i], wT = L ? C.wT[i] : 1;
      const wl = wT * wlT + (1 - wT) * (L ? 2 * Math.PI / fr.kL[L] : wlT);
      amp[i] = k0 * wl * mod * (1 - 0.8 * (d.zone ? d.zone[i] : 0)) * (pc.ampScale ? pc.ampScale(i) : 1);
    }
    const stat = staticFolds(d, pc.folds, noise3);
    if (d.staticDisp) for (let i = 0; i < nf; i++) stat[i] += d.staticDisp[i];
    const coarse = d.coarse;
    const basis = coarseBasis(d, bi);
    const wp = new WrinklePart({
      coarse: { n: coarse.n, G: coarse.G, adj: coarse.adj || buildAdjacency(coarse.n, buildEdges(coarse.n, coarse.quads)), skin: coarse.skin, basis },
      nf, parents: coarse.parents, profiles: prof, amp, room: d.room, stat, kc: wr.kc ?? 1, kt: wr.kt ?? 0.35, spread: wr.spread ?? 4,
    });
    parts.push({ wp, offset: fineOffset, N, nf });
    fineOffset += nf;
    nslot = extraSlot;
  }
  if (!parts.length) return null;

  // ---- geometry
  const count = rv2v.length;
  const geo = new THREE.BufferGeometry();
  const posArr = new Float32Array(pos);
  geo.setAttribute('position', new THREE.BufferAttribute(posArr.slice(), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(uv1), 2));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(skI), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(skW), 4));
  const index = [];
  for (let g = 0; g < 3; g++) {
    if (!groupsTris[g].length) continue;
    geo.addGroup(index.length, groupsTris[g].length, g);
    for (const t of groupsTris[g]) index.push(t);
  }
  const idxArr = new Uint32Array(index);
  geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
  // global fine normals used as displacement direction
  const dirN = new Float32Array(fineOffset * 3), disp = new Float32Array(fineOffset);
  for (const p of parts) { dirN.set(p.N, p.offset * 3); p.wp.disp = disp.subarray(p.offset, p.offset + p.nf); }
  const rt = new GarmentRuntime(geo, parts, Int32Array.from(rv2v), Int32Array.from(nid), nslot, posArr, dirN, disp, idxArr);
  return rt;
}

/** Owns the geometry buffers and applies wrinkle displacements + normals. */
export class GarmentRuntime {
  constructor(geo, parts, rv2v, nid, nslot, base, dirN, disp, index) {
    this.geometry = geo;
    this.parts = parts;
    this.rv2v = rv2v;
    this.nid = nid;
    this.nslot = nslot;
    this.base = base;
    this.dirN = dirN;
    this.disp = disp;
    this.index = index;
    this.nacc = new Float32Array(nslot * 3);
    this.k = -1;
  }

  /** Recomputes wrinkles for the current pose. Returns true if the geometry changed. */
  update(ch, k, M, posed = true) {
    let changed = false;
    for (const p of this.parts) {
      if (posed) changed = p.wp.update(ch, k, M) || changed;
      else if (this.k !== k || p.wp.active) { p.wp.restDisp(k); changed = true; }
    }
    if (this.k !== k) changed = true;
    this.k = k;
    if (changed) this.write();
    return changed;
  }

  write() {
    const { rv2v, base, dirN, disp, nid, nacc, index } = this;
    const posAttr = this.geometry.attributes.position, nrmAttr = this.geometry.attributes.normal;
    const P = posAttr.array, NR = nrmAttr.array;
    const n = rv2v.length;
    for (let r = 0; r < n; r++) {
      const v = rv2v[r], o = r * 3;
      if (v < 0) { P[o] = base[o]; P[o + 1] = base[o + 1]; P[o + 2] = base[o + 2]; continue; }
      const d = disp[v], q = v * 3;
      P[o] = base[o] + dirN[q] * d; P[o + 1] = base[o + 1] + dirN[q + 1] * d; P[o + 2] = base[o + 2] + dirN[q + 2] * d;
    }
    nacc.fill(0);
    for (let t = 0, m = index.length; t < m; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      const ao = a * 3, bo = b * 3, co = c * 3;
      const ux = P[bo] - P[ao], uy = P[bo + 1] - P[ao + 1], uz = P[bo + 2] - P[ao + 2];
      const vx = P[co] - P[ao], vy = P[co + 1] - P[ao + 1], vz = P[co + 2] - P[ao + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      let s = nid[a] * 3; nacc[s] += nx; nacc[s + 1] += ny; nacc[s + 2] += nz;
      s = nid[b] * 3; nacc[s] += nx; nacc[s + 1] += ny; nacc[s + 2] += nz;
      s = nid[c] * 3; nacc[s] += nx; nacc[s + 1] += ny; nacc[s + 2] += nz;
    }
    for (let r = 0; r < n; r++) {
      const s = nid[r] * 3;
      const x = nacc[s], y = nacc[s + 1], z = nacc[s + 2];
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      NR[r * 3] = x / l; NR[r * 3 + 1] = y / l; NR[r * 3 + 2] = z / l;
    }
    posAttr.needsUpdate = true;
    nrmAttr.needsUpdate = true;
  }

  dispose() { this.geometry.dispose(); }
}
