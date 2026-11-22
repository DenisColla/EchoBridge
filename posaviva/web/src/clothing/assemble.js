// Turns garment drafts (fine quad surfaces + extras) into one skinned
// BufferGeometry with UV seams, material groups and the per-frame wrinkle
// runtime (WrinklePart per draft). GarmentRuntime also keeps the garment over
// the layers below it while posing (inherited skin weights + a per-vertex
// outward push) and skirts off the legs (leg capsules, 3D offsets).
//
// UV sets:
//   uv  (channel 0): metric cylindrical coords (arc length around the region at a
//                    reference radius, axial distance) for the tiling weave map
//   uv1 (channel 1): garment atlas (one rect per region, angle x normalized body
//                    coordinate) for the per-garment detail map (seams, pockets…)
// Seams: vertices are split where the angle wraps and between regions.
import * as THREE from 'three';
import { quadNormals, buildAdjacency, buildEdges, len3 } from './mesh.js';
import { WrinklePart, foldFields, noise3, FOLD_BIAS, scratch } from './wrinkles.js';
import { staticFolds } from './build.js';
import { softSkin } from '../render/softskin.js';

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
/** Distance (m) from a garment edge over which the folds fade in (stiffer hem). */
const HEM_CALM = 0.022;
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
  const h = meshSpacing(draft);
  const wlT = wr.wl ?? 0.05, wlA = wr.wlArm ?? wlT * 0.75, wlL = wr.wlLeg ?? wlT * 0.95;
  // a fold needs about MIN_SAMPLES vertices per wavelength to read as a smooth
  // ridge and valley (fewer alias into lumpy noise): never shorter than that
  const mk = (wl, r, hr) => {
    wl = Math.max(wl, MIN_SAMPLES * hr);
    const k = (2 * Math.PI) / wl;
    return { k, N: Math.max(3, Math.round((2 * Math.PI * r) / (wl * 1.35))), M: Math.max(1, Math.round(k * r * Math.SQRT1_2)) };
  };
  const t = mk(wlT, rr[0], h[0]);
  const fr = { kT: t.k, NT: t.N, MT: t.M, kL: [0], NL: [0], ML: [0], rr };
  for (let r = 1; r <= 4; r++) { const q = mk(r <= 2 ? wlA : wlL, rr[r], h[r]); fr.kL[r] = q.k; fr.NL[r] = q.N; fr.ML[r] = q.M; }
  return fr;
}

/**
 * Local mesh density of a draft: k[i] = 1 where the vertex spacing is under 30%
 * of the median spacing, 0 above 75%; nbr = fine adjacency (CSR).
 */
function denseSpots(nf, quads, P) {
  const adj = buildAdjacency(nf, buildEdges(nf, quads));
  const le = new Float32Array(nf);
  for (let i = 0; i < nf; i++) {
    let s = 0, m = 0;
    for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j]; s += len3(P[u * 3] - P[i * 3], P[u * 3 + 1] - P[i * 3 + 1], P[u * 3 + 2] - P[i * 3 + 2]); m++; }
    le[i] = m ? s / m : 0;
  }
  const sorted = Float32Array.from(le).sort();
  const med = sorted[sorted.length >> 1] || 1;
  const k = new Float32Array(nf);
  let any = false;
  for (let i = 0; i < nf; i++) { const r = le[i] / med; k[i] = Math.min(1, Math.max(0, (0.75 - r) / 0.45)); if (k[i] > 0) any = true; }
  // grow a ring so the softening fades out instead of stopping at a vertex
  const k2 = k.slice();
  for (let i = 0; i < nf; i++) for (let j = adj.off[i]; j < adj.off[i + 1]; j++) if (k[adj.adj[j]] * 0.6 > k2[i]) k2[i] = k[adj.adj[j]] * 0.6;
  return { k: k2, adj, any };
}

/** Low-pass of the four fold fields over the dense spots (in place). */
function smoothDense(nf, prof, dense, iterations) {
  const { k, adj } = dense, tmp = new Float32Array(prof.length);
  for (let it = 0; it < iterations; it++) {
    tmp.set(prof);
    for (let i = 0; i < nf; i++) {
      if (!k[i]) continue;
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0, m = 0;
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j] * 4; a0 += prof[u]; a1 += prof[u + 1]; a2 += prof[u + 2]; a3 += prof[u + 3]; m++; }
      if (!m) continue;
      const w = 0.6 * k[i], o = i * 4;
      tmp[o] += (a0 / m - prof[o]) * w; tmp[o + 1] += (a1 / m - prof[o + 1]) * w; tmp[o + 2] += (a2 / m - prof[o + 2]) * w; tmp[o + 3] += (a3 / m - prof[o + 3]) * w;
    }
    prof.set(tmp);
  }
}

/** Vertices per fold wavelength (at least). */
const MIN_SAMPLES = 5.5;

/** Median fine edge length per region (0 torso, 1-4 limbs) of a draft. */
function meshSpacing(draft) {
  const C = draft.coords, P = draft.P, Q = draft.quads;
  const L = [[], [], [], [], []];
  for (let f = 0, nq = Q.length >> 2; f < nq; f += 2) {
    const a = Q[f * 4], b = Q[f * 4 + 1], c = Q[f * 4 + 3];
    const r = C.limb[a] && C.wT[a] < 0.5 ? C.limb[a] : 0;
    for (const e of [b, c]) L[r].push(len3(P[a * 3] - P[e * 3], P[a * 3 + 1] - P[e * 3 + 1], P[a * 3 + 2] - P[e * 3 + 2]));
  }
  return L.map((v) => { if (v.length < 8) return 0; v.sort((x, y) => x - y); return v[v.length >> 1]; });
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
    let l = len3(ex, ey, ez);
    if (l < 0.2) { // axis almost along the normal (e.g. shoulder top): any tangent
      const fx = Math.abs(nx) < 0.9 ? 1 : 0, fy = fx ? 0 : 1;
      const dd = fx * nx + fy * ny;
      ex = fx - dd * nx; ey = fy - dd * ny; ez = -dd * nz; l = len3(ex, ey, ez) || 1;
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
  const pos = [], uv = [], uv1 = [], skI = [], skW = [], rv2v = [], nid = [], main = [];
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
      main.push(1);
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
    // height of the edge finishes (rolled hems, bands, buttons) over their fine vertex:
    // the layer above must clear them too
    const lift = new Float32Array(nf);
    for (const ex of pc.extras || []) {
      if (!ex) continue;
      const base = rv2v.length, ne = ex.parent.length;
      for (let i = 0; i < ne; i++) {
        const v = ex.parent[i];
        if (v >= 0) {
          const h = (ex.pos[i * 3] - P[v * 3]) * N[v * 3] + (ex.pos[i * 3 + 1] - P[v * 3 + 1]) * N[v * 3 + 1] + (ex.pos[i * 3 + 2] - P[v * 3 + 2]) * N[v * 3 + 2];
          if (h > lift[v]) lift[v] = Math.min(h, 0.012);
        }
        rv2v.push(v >= 0 ? fineOffset + v : -1);
        nid.push(extraSlot++);
        main.push(0);
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
    const bias = wr.bias ?? FOLD_BIAS;
    const prof = foldFields(nf, C, P, fr, bias);
    // where the body mesh is much denser than around it (rings around the nipples,
    // the navel) the sharp fold valleys are sampled finely and show as pinpoint
    // creases: soften the folds there (fold fields low-passed, amplitude lowered)
    const dense = denseSpots(nf, d.quads, P);
    // fold amplitude: excess length c folded into waves of length L gives a
    // peak-to-trough of about (2L/pi) sqrt(c); k = garment softness/looseness
    const amp = new Float32Array(nf);
    const k0 = (wr.k ?? 0.8) * (0.6 + 0.8 * (d.fitT ?? 0.5)) * (2 / Math.PI) * FOLD_GAIN;
    const wlT = 2 * Math.PI / fr.kT;
    // a hem is a doubled, stiffer edge: folds die out over its last couple of
    // centimetres, so the edge reads as one clean line (no zigzag, no specks)
    const edgeCv = (d.loops || []).map((l) => d.cons?.findIndex((c) => c.id === l.id)).filter((k) => k >= 0).map((k) => d.cvals[k]);
    const hemK = (i) => {
      let m = Infinity;
      for (const cv of edgeCv) if (cv[i] < m) m = cv[i];
      if (m === Infinity) return 1;
      const t = Math.min(1, Math.max(0, m / HEM_CALM));
      return 0.3 + 0.7 * t * t * (3 - 2 * t);
    };
    const hem = new Float32Array(nf);
    for (let i = 0; i < nf; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const mod = 0.75 + 0.4 * noise3(x * 3.1 + 17, y * 3.1 - 3, z * 3.1 + 9);
      const L = C.limb[i], wT = L ? C.wT[i] : 1;
      const wl = wT * wlT + (1 - wT) * (L ? 2 * Math.PI / fr.kL[L] : wlT);
      hem[i] = hemK(i);
      amp[i] = k0 * wl * mod * (1 - 0.8 * (d.zone ? d.zone[i] : 0)) * (pc.ampScale ? pc.ampScale(i) : 1) * hem[i] * (1 - 0.6 * dense.k[i]);
    }
    if (dense.any) smoothDense(nf, prof, dense, 6);
    const stat = staticFolds(d, pc.folds, noise3);
    for (let i = 0; i < nf; i++) stat[i] *= 0.5 + 0.5 * hem[i];
    if (d.staticDisp) for (let i = 0; i < nf; i++) stat[i] += d.staticDisp[i];
    const coarse = d.coarse;
    const basis = coarseBasis(d, bi);
    // taut spans (fabric bridging a hollow: under the bust, across the cleavage,
    // behind the knee) fold little: their valleys may not sink into the hollow
    let vcap = null;
    if (d.span) {
      vcap = new Float32Array(nf);
      for (let i = 0; i < nf; i++) { const t = Math.min(1, Math.max(0, (d.span[i] - 0.004) / 0.016)); vcap[i] = 0.03 + (0.004 - 0.03) * t * t * (3 - 2 * t); }
    }
    const wp = new WrinklePart({
      coarse: { n: coarse.n, G: coarse.G, adj: coarse.adj || buildAdjacency(coarse.n, buildEdges(coarse.n, coarse.quads)), skin: coarse.skin, basis },
      nf, parents: coarse.parents, profiles: prof, amp, room: d.room, vcap, stat, bias, refM: opts.refM, kc: wr.kc ?? 1, kt: wr.kt ?? 0.35, spread: wr.spread ?? 4,
    });
    // height of the fabric over the body (seat pass: the layers keep their order when pressed)
    const hgt = new Float32Array(nf);
    if (d.B) for (let i = 0; i < nf; i++) { const o = i * 3; hgt[i] = (P[o] - d.B[o]) * d.BN[o] + (P[o + 1] - d.B[o + 1]) * d.BN[o + 1] + (P[o + 2] - d.B[o + 2]) * d.BN[o + 2]; }
    else if (d.room) for (let i = 0; i < nf; i++) hgt[i] = d.room[i] + (d.thick || 0.0025) + 0.002;
    // torso (not sleeve / trouser leg) vertices: the hem lift moves them
    const trs = new Uint8Array(nf);
    for (let i = 0; i < nf; i++) trs[i] = C.limb[i] && C.wT[i] < 0.5 ? 0 : 1;
    parts.push({ wp, offset: fineOffset, N, nf, P, skin: d.skin, adj: buildAdjacency(nf, buildEdges(nf, d.quads)), lift, hgt, trs, ring: d.kind === 'skirt' ? { rings: d.ring.rings, segs: d.ring.segs } : null });
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
  // fine (undisplaced) rest surface + skin weights: used by the layer pass
  const fineP = new Float32Array(fineOffset * 3), fineSI = new Uint16Array(fineOffset * 4), fineSW = new Float32Array(fineOffset * 4);
  const fineLift = new Float32Array(fineOffset), fineCoarse = new Uint8Array(fineOffset), fineH = new Float32Array(fineOffset), fineTorso = new Uint8Array(fineOffset);
  for (const p of parts) {
    fineTorso.set(p.trs, p.offset); delete p.trs;
    fineCoarse.fill(1, p.offset, p.offset + p.wp.n); // fine vertex c < n is coarse vertex c
    fineLift.set(p.lift, p.offset); delete p.lift;
    fineH.set(p.hgt, p.offset); delete p.hgt;
    dirN.set(p.N, p.offset * 3); p.wp.disp = disp.subarray(p.offset, p.offset + p.nf); delete p.N;
    fineP.set(p.P.subarray(0, p.nf * 3), p.offset * 3);
    fineSI.set(p.skin.idx.subarray(0, p.nf * 4), p.offset * 4); fineSW.set(p.skin.w.subarray(0, p.nf * 4), p.offset * 4);
    delete p.P; delete p.skin;
  }
  const rt = new GarmentRuntime(geo, parts, Int32Array.from(rv2v), Int32Array.from(nid), nslot, posArr, dirN, disp, idxArr);
  rt.main = Uint8Array.from(main);
  // fine vertex adjacency (global indices) for the layer pass
  const deg = new Int32Array(fineOffset + 1), lists = [];
  for (const p of parts) {
    const a = p.adj;
    for (let i = 0; i < p.nf; i++) deg[p.offset + i + 1] = a.off[i + 1] - a.off[i];
    lists.push(p);
  }
  for (let i = 0; i < fineOffset; i++) deg[i + 1] += deg[i];
  const adjL = new Int32Array(deg[fineOffset]);
  for (const p of lists) { const a = p.adj; for (let i = 0; i < p.nf; i++) for (let k = a.off[i], o = deg[p.offset + i]; k < a.off[i + 1]; k++, o++) adjL[o] = a.adj[k] + p.offset; delete p.adj; }
  rt.fine = { P: fineP, si: fineSI, sw: fineSW, n: fineOffset, adj: { off: deg, adj: adjL }, lift: fineLift, coarse: fineCoarse };
  if (parts.some((p) => p.ring)) rt.setLegs(legColliders(bi));
  if (!opts.noSeat) rt.setSeat(seatFrames(bi), fineH);
  if (opts.hemLift) rt.setHemLift(bi, opts.hemLift, fineTorso);
  return rt;
}

/**
 * Seat frames: per leg the rest hip joint and knee, the back of the thigh
 * (posterior direction perpendicular to the thigh axis) and the depth of the
 * back of the thigh below the axis at mid-thigh (rest body), with the bones
 * the frame moves with (thigh) and is measured against (pelvis).
 */
function seatFrames(bi) {
  const topo = bi.topo, model = topo.model, P = bi.P, out = [];
  for (const [r, side, sg] of [[3, 'L', 1], [4, 'R', -1]]) {
    const L = bi.limbs[r], A = bi.param[r - 1], J = L.J;
    const a0 = [J[0], J[1], J[2]], k0 = [J[3], J[4], J[5]];
    const u = [k0[0] - a0[0], k0[1] - a0[1], k0[2] - a0[2]], len = Math.hypot(u[0], u[1], u[2]) || 1;
    u[0] /= len; u[1] /= len; u[2] /= len;
    const b = [-u[0] * -u[2], -u[1] * -u[2], -1 - u[2] * -u[2]], bl = Math.hypot(b[0], b[1], b[2]) || 1;
    b[0] /= bl; b[1] /= bl; b[2] /= bl;
    let dm = 0.05;
    for (let v = 0; v < topo.nv; v++) {
      if (topo.limb[v] !== r || A[v] < 0.4 || A[v] > 0.6) continue;
      const d = (P[v * 3] - a0[0]) * b[0] + (P[v * 3 + 1] - a0[1]) * b[1] + (P[v * 3 + 2] - a0[2]) * b[2];
      if (d > dm) dm = d;
    }
    const bone = (n) => model.boneIndex.get(n);
    out.push({ sg, a0, k0, u0: u, b0: b, len, dm, ba: bone('upperleg01.' + side), bb: bone('lowerleg01.' + side), bp: bone('pelvis.' + side) ?? bone('root') });
  }
  return out;
}

/** Hip flexion (deg) over which the seat correction fades in. */
const SEAT_FLEX = [35, 80];
/** Extra depth (m) of the seat below the back-of-thigh line near the hip (gluteal pad). */
const SEAT_PAD = 0.01;
/** Excess (m) the pressed seat keeps at most (soft saturation: no hard crease). */
const SEAT_SOFT = 0.005;
/** Most height over the body (m) a vertex counts as its own layer thickness in the seat pass. */
const SEAT_HMAX = 0.012;

/**
 * Leg colliders for skirts: per leg two thigh capsules (hip -> mid-thigh -> knee:
 * the quadriceps bulge is wider than a straight taper from hip to knee) and a
 * shin capsule (knee -> ankle), tapered, in rest space, each end bound to the
 * bone it moves with. Radii: the 92nd percentile of the leg's body vertices
 * around the axis in each band.
 */
function legColliders(bi) {
  const topo = bi.topo, model = topo.model, P = bi.P, out = [], tmp = new Float32Array(9);
  for (const [r, side] of [[3, 'L'], [4, 'R']]) {
    const L = bi.limbs[r], A = bi.param[r - 1];
    const bins = [[], [], [], [], []]; // around the hip, mid-thigh, knee (thigh side), knee (shin side), ankle
    for (let v = 0; v < topo.nv; v++) {
      const a = A[v];
      if (a < 0.08 || a > 1.92 || topo.limb[v] !== r) continue;
      L.cyl(a, P[v * 3], P[v * 3 + 1], P[v * 3 + 2], tmp);
      const b = a < 0.3 ? 0 : a < 0.7 ? (a > 0.35 ? 1 : -1) : a < 1 ? (a > 0.78 ? 2 : -1) : a < 1.25 ? 3 : a > 1.7 ? 4 : -1;
      if (b >= 0) bins[b].push(tmp[1]);
    }
    const pct = (v, d) => { if (!v.length) return d; v.sort((x, y) => x - y); return v[Math.floor(v.length * 0.92)]; };
    const rHip = pct(bins[0], 0.08), rMid = pct(bins[1], 0.065), rKnee = Math.max(pct(bins[2], 0.05), pct(bins[3], 0.05)), rAnkle = pct(bins[4], 0.035);
    const bone = (n) => model.boneIndex.get(n + '.' + side);
    const J = L.J, mid = [(J[0] + J[3]) / 2, (J[1] + J[4]) / 2, (J[2] + J[5]) / 2];
    out.push({ a: [J[0], J[1], J[2]], b: mid, ba: bone('upperleg01'), bb: bone('upperleg01'), ra: rHip, rb: Math.max(rMid, (rHip + rKnee) / 2) });
    out.push({ a: mid, b: [J[3], J[4], J[5]], ba: bone('upperleg01'), bb: bone('lowerleg01'), ra: Math.max(rMid, (rHip + rKnee) / 2), rb: rKnee });
    out.push({ a: [J[3], J[4], J[5]], b: [J[6], J[7], J[8]], ba: bone('lowerleg01'), bb: bone('foot'), ra: rKnee, rb: rAnkle });
  }
  return out;
}
/** Clearance of a skirt over the legs (fabric thickness + a little air), m. */
const LEG_CLEAR = 0.006;
/** How much of a leg contact the fabric below it inherits per ring (hangs from the knee). */
const HANG = 0.965;
const _pa = new Float32Array(3);

/** Lowest posed height of garment points over the character's floor (m) and the coarse test reach. */
const FLOOR_Y = 0.0045, FLOOR_REACH = 0.075;


/** Search radius (m) for the layer below a garment vertex. */
const LAYER_REACH = 0.035;
/** Share of the skin weights a garment takes from the layer it rests on. */
const WEIGHT_INHERIT = 0.85;
/** Gap kept between a garment and the layer below while posing (m). */
const LAYER_GAP_MIN = 0.0035, LAYER_GAP_MAX = 0.006;
/** Rings (even) and per-ring falloff of the layer push around each contact. */
const LAYER_SPREAD = 4, LAYER_FALLOFF = 0.86;

/** Blended skin matrix (12 floats, column major 3x4) of fine vertex i into out. */
function blendMatrix(M, si, sw, i, out) {
  out.fill(0);
  for (let k = 0; k < 4; k++) {
    const w = sw[i * 4 + k];
    if (!w) continue;
    const o = si[i * 4 + k] * 16;
    out[0] += w * M[o]; out[1] += w * M[o + 1]; out[2] += w * M[o + 2];
    out[3] += w * M[o + 4]; out[4] += w * M[o + 5]; out[5] += w * M[o + 6];
    out[6] += w * M[o + 8]; out[7] += w * M[o + 9]; out[8] += w * M[o + 10];
    out[9] += w * M[o + 12]; out[10] += w * M[o + 13]; out[11] += w * M[o + 14];
  }
  return out;
}
const _ma = new Float32Array(12), _mb = new Float32Array(12);

/** Skin matrix of bone b applied to rest point p -> out. */
function xform(M, b, p, out) {
  const o = b * 16, x = p[0], y = p[1], z = p[2];
  out[0] = M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12];
  out[1] = M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13];
  out[2] = M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14];
  return out;
}

/** Linear part of the skin matrix of bone b applied to direction d -> out. */
function lin(M, b, d, out) {
  const o = b * 16, x = d[0], y = d[1], z = d[2];
  out[0] = M[o] * x + M[o + 4] * y + M[o + 8] * z;
  out[1] = M[o + 1] * x + M[o + 5] * y + M[o + 9] * z;
  out[2] = M[o + 2] * x + M[o + 6] * y + M[o + 10] * z;
  return out;
}
const _pb = new Float32Array(3), _pc = new Float32Array(3), _dq = new Float32Array(9);
const FWD = [0, 0, 1], DOWN = [0, -1, 0];
/** Arm elevation (deg, from hanging down) over which a top's hem lift fades in. */
const LIFT_ELEV = [70, 165];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Unit dual quaternions of every bone's skin matrix (rotation r, dual part d,
 * uniform scale s; 9 floats per bone), as the GPU skins with 'Deformazione
 * morbida' (render/softskin.js), so the CPU passes see the surface that is drawn.
 */
let _bdq = new Float32Array(0);
function boneDQs(M) {
  const nb = M.length >> 4;
  if (_bdq.length < nb * 9) _bdq = new Float32Array(nb * 9);
  for (let b = 0; b < nb; b++) {
    const o = b * 16, q = b * 9;
    const s = Math.hypot(M[o], M[o + 1], M[o + 2]);
    if (s < 1e-6) { _bdq.fill(0, q, q + 9); _bdq[q + 3] = 1; continue; }
    const is = 1 / s;
    const m00 = M[o] * is, m10 = M[o + 1] * is, m20 = M[o + 2] * is, m01 = M[o + 4] * is, m11 = M[o + 5] * is, m21 = M[o + 6] * is, m02 = M[o + 8] * is, m12 = M[o + 9] * is, m22 = M[o + 10] * is;
    let x, y, z, w;
    const tr = m00 + m11 + m22;
    if (tr > 0) { const k = 0.5 / Math.sqrt(tr + 1); w = 0.25 / k; x = (m21 - m12) * k; y = (m02 - m20) * k; z = (m10 - m01) * k; } else if (m00 > m11 && m00 > m22) { const k = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / k; x = 0.25 * k; y = (m01 + m10) / k; z = (m02 + m20) / k; } else if (m11 > m22) { const k = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / k; x = (m01 + m10) / k; y = 0.25 * k; z = (m12 + m21) / k; } else { const k = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / k; x = (m02 + m20) / k; y = (m12 + m21) / k; z = 0.25 * k; }
    const l = Math.hypot(x, y, z, w) || 1;
    x /= l; y /= l; z /= l; w /= l;
    const tx = M[o + 12] * is, ty = M[o + 13] * is, tz = M[o + 14] * is;
    // d = 0.5 * (t * w + t x r, -t . r)
    _bdq[q] = x; _bdq[q + 1] = y; _bdq[q + 2] = z; _bdq[q + 3] = w;
    _bdq[q + 4] = 0.5 * (tx * w + (ty * z - tz * y)); _bdq[q + 5] = 0.5 * (ty * w + (tz * x - tx * z)); _bdq[q + 6] = 0.5 * (tz * w + (tx * y - ty * x)); _bdq[q + 7] = -0.5 * (tx * x + ty * y + tz * z);
    _bdq[q + 8] = s;
  }
  return _bdq;
}
/** Blended unit dual quaternion of fine vertex i (antipodality against its first bone) -> out[9]. */
function dqBlend(D, si, sw, i, out) {
  out.fill(0);
  let ws = 0, ax = 0, ay = 0, az = 0, aw = 0;
  for (let k = 0; k < 4; k++) {
    const w = sw[i * 4 + k];
    if (!w && k) continue;
    const q = si[i * 4 + k] * 9;
    if (!k) { ax = D[q]; ay = D[q + 1]; az = D[q + 2]; aw = D[q + 3]; }
    const kk = D[q] * ax + D[q + 1] * ay + D[q + 2] * az + D[q + 3] * aw < 0 ? -w : w;
    for (let c = 0; c < 8; c++) out[c] += kk * D[q + c];
    out[8] += w * D[q + 8]; ws += w;
  }
  const l = Math.hypot(out[0], out[1], out[2], out[3]);
  if (l < 1e-6) { out.fill(0); out[3] = 1; out[8] = 1; return out; }
  for (let c = 0; c < 8; c++) out[c] /= l;
  out[8] /= ws || 1;
  return out;
}
/** Applies a blended dual quaternion to rest point (x, y, z) -> out. */
function dqApply(q, x, y, z, out) {
  const rx = q[0], ry = q[1], rz = q[2], rw = q[3], dx = q[4], dy = q[5], dz = q[6], dw = q[7];
  const cx = ry * z - rz * y + rw * x, cy = rz * x - rx * z + rw * y, cz = rx * y - ry * x + rw * z;
  let ox = x + 2 * (ry * cz - rz * cy), oy = y + 2 * (rz * cx - rx * cz), oz = z + 2 * (rx * cy - ry * cx);
  ox += 2 * (rw * dx - dw * rx + (ry * dz - rz * dy));
  oy += 2 * (rw * dy - dw * ry + (rz * dx - rx * dz));
  oz += 2 * (rw * dz - dw * rz + (rx * dy - ry * dx));
  out[0] = ox * q[8]; out[1] = oy * q[8]; out[2] = oz * q[8];
  return out;
}
/** Posed offset (x, y, z) back to rest space through a blended dual quaternion (inverse rotation and scale). */
function dqUnrotate(q, x, y, z, out) {
  const rx = -q[0], ry = -q[1], rz = -q[2], rw = q[3], is = 1 / (q[8] || 1);
  const cx = ry * z - rz * y + rw * x, cy = rz * x - rx * z + rw * y, cz = rx * y - ry * x + rw * z;
  out[0] = (x + 2 * (ry * cz - rz * cy)) * is; out[1] = (y + 2 * (rz * cx - rx * cz)) * is; out[2] = (z + 2 * (rx * cy - ry * cx)) * is;
  return out;
}

/** Solves A v = (x, y, z) for the 3x3 linear part of a blended matrix a (column major). */
function inv3(a, x, y, z, out) {
  const a00 = a[0], a10 = a[1], a20 = a[2], a01 = a[3], a11 = a[4], a21 = a[5], a02 = a[6], a12 = a[7], a22 = a[8];
  const c00 = a11 * a22 - a12 * a21, c01 = a02 * a21 - a01 * a22, c02 = a01 * a12 - a02 * a11;
  const det = a00 * c00 + a10 * c01 + a20 * c02;
  if (Math.abs(det) < 1e-9) { out[0] = x; out[1] = y; out[2] = z; return out; }
  const id = 1 / det;
  const c10 = a12 * a20 - a10 * a22, c11 = a00 * a22 - a02 * a20, c12 = a02 * a10 - a00 * a12;
  const c20 = a10 * a21 - a11 * a20, c21 = a01 * a20 - a00 * a21, c22 = a00 * a11 - a01 * a10;
  out[0] = (c00 * x + c01 * y + c02 * z) * id;
  out[1] = (c10 * x + c11 * y + c12 * z) * id;
  out[2] = (c20 * x + c21 * y + c22 * z) * id;
  return out;
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
    this.k = -1;
    /** outward push (m, along dirN) that keeps this garment over the layers below it */
    this.push = new Float32Array(disp.length);
    this.layers = null;
    /** free 3D offsets (rest space) of skirt vertices pushed off the legs */
    this.off3 = null;
    this.legs = null;
  }

  /**
   * Seated correction (see _seatPass): frames from seatFrames(bi), h = height of
   * each fine vertex over the body (rest). Candidates: fine vertices behind the hip
   * joints, from a little above them down to the knees.
   */
  setSeat(frames, h) {
    const P = this.fine.P, n = this.fine.n, idx = [], fr = [];
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      let best = -1;
      for (let f = 0; f < frames.length; f++) {
        const F = frames[f];
        if (y > F.a0[1] + 0.1 || y < F.k0[1] + 0.04 || z > F.a0[2] + 0.05 || x * F.sg < -0.03) continue;
        // the back half of the thigh and the seat only: a front or side vertex is never pressed
        if ((x - F.a0[0]) * F.b0[0] + (y - F.a0[1]) * F.b0[1] + (z - F.a0[2]) * F.b0[2] < 0.01) continue;
        if (best < 0 || Math.abs(x - F.a0[0]) < Math.abs(x - frames[best].a0[0])) best = f;
      }
      if (best >= 0) { idx.push(i); fr.push(best); }
    }
    if (!idx.length) return;
    const hh = new Float32Array(idx.length);
    for (let k = 0; k < idx.length; k++) hh[k] = Math.min(SEAT_HMAX, Math.max(0, h[idx[k]]));
    this.seat = { frames, idx: Int32Array.from(idx), fr: Uint8Array.from(fr), h: hh, on: false, posed: frames.map(() => ({ A: new Float32Array(3), u: new Float32Array(3), b: new Float32Array(3), w: 0, len: 1 })) };
    this.s3 = null;
    /** the seat pass is applied (the manager turns it off for underwear that is the outer layer) */
    this.seatClamp = true;
  }

  /**
   * Seated: at a strong hip flexion the skinned buttocks roll into two round lobes
   * below the line of the thighs (blended skinning of the gluteal fold, no seat to
   * press them flat). Every candidate vertex deeper below the back of its posed
   * thigh than the back-of-thigh line (+ a gluteal pad near the hip, + its own
   * height over the body so the layers keep their order) is pressed back towards
   * it, with a soft saturation; rest-space offsets through the inverse of the
   * vertex's skinning (dual quaternion or linear, as the renderer skins it).
   * Returns true when the offsets changed.
   */
  _seatPass(M) {
    const S = this.seat, F = this.fine, P = F.P, si = F.si, sw = F.sw, N = this.dirN, disp = this.disp, push = this.push;
    let any = false;
    S.frames.forEach((fr, q) => {
      const ps = S.posed[q];
      xform(M, fr.ba, fr.a0, _pa); ps.A.set(_pa);
      xform(M, fr.bb, fr.k0, _pb);
      let ux = _pb[0] - _pa[0], uy = _pb[1] - _pa[1], uz = _pb[2] - _pa[2];
      const l = Math.hypot(ux, uy, uz) || 1;
      ux /= l; uy /= l; uz /= l;
      ps.u[0] = ux; ps.u[1] = uy; ps.u[2] = uz; ps.len = l;
      // the thigh's posterior direction, turned with the thigh
      lin(M, fr.ba, fr.b0, _pc);
      let d = _pc[0] * ux + _pc[1] * uy + _pc[2] * uz;
      const bx = _pc[0] - d * ux, by = _pc[1] - d * uy, bz = _pc[2] - d * uz;
      const bl = Math.hypot(bx, by, bz) || 1;
      ps.b[0] = bx / bl; ps.b[1] = by / bl; ps.b[2] = bz / bl;
      // hip flexion: the thigh against its rest direction carried by the pelvis
      lin(M, fr.bp, fr.u0, _pc);
      const cl = Math.hypot(_pc[0], _pc[1], _pc[2]) || 1;
      d = (_pc[0] * ux + _pc[1] * uy + _pc[2] * uz) / cl;
      lin(M, fr.bp, FWD, _pb);
      const fwd = (ux - _pc[0] / cl) * _pb[0] + (uy - _pc[1] / cl) * _pb[1] + (uz - _pc[2] / cl) * _pb[2];
      const ang = fwd > 0 ? Math.acos(Math.max(-1, Math.min(1, d))) * 57.29578 : 0;
      const t = Math.min(1, Math.max(0, (ang - SEAT_FLEX[0]) / (SEAT_FLEX[1] - SEAT_FLEX[0])));
      ps.w = t * t * (3 - 2 * t);
      if (ps.w > 0) any = true;
    });
    if (!any || !this.seatClamp) {
      if (!S.on) return false;
      S.on = false;
      this.s3.fill(0);
      return true;
    }
    const s3 = this.s3 || (this.s3 = new Float32Array(disp.length * 3));
    const dq = softSkin.active ? boneDQs(M) : null;
    let changed = !S.on;
    S.on = true;
    for (let k = 0, m = S.idx.length; k < m; k++) {
      const i = S.idx[k], ps = S.posed[S.fr[k]], fr = S.frames[S.fr[k]], o = i * 3;
      let rx = 0, ry = 0, rz = 0;
      if (ps.w > 0) {
        const dd = disp[i] + push[i];
        let x = P[o] + N[o] * dd, y = P[o + 1] + N[o + 1] * dd, z = P[o + 2] + N[o + 2] * dd;
        if (this.off3) { x += this.off3[o]; y += this.off3[o + 1]; z += this.off3[o + 2]; }
        // posed position (and the frame to map a posed offset back to rest space)
        let px, py, pz;
        if (dq) { dqBlend(dq, si, sw, i, _dq); dqApply(_dq, x, y, z, _pa); px = _pa[0]; py = _pa[1]; pz = _pa[2]; } else {
          const a = blendMatrix(M, si, sw, i, _ma);
          px = a[0] * x + a[3] * y + a[6] * z + a[9]; py = a[1] * x + a[4] * y + a[7] * z + a[10]; pz = a[2] * x + a[5] * y + a[8] * z + a[11];
        }
        const ex = px - ps.A[0], ey = py - ps.A[1], ez = pz - ps.A[2];
        const ta = ex * ps.u[0] + ey * ps.u[1] + ez * ps.u[2], t = ta / ps.len;
        const g = ss(-0.7, -0.4, t) * (1 - ss(0.88, 1.04, t));
        if (g > 0) {
          const qd = ex * ps.b[0] + ey * ps.b[1] + ez * ps.b[2];
          const wx = ex - ta * ps.u[0] - qd * ps.b[0], wy = ey - ta * ps.u[1] - qd * ps.b[1], wz = ez - ta * ps.u[2] - qd * ps.b[2];
          const lat = 1 - ss(0.13, 0.2, Math.hypot(wx, wy, wz));
          const D = fr.dm + SEAT_PAD * (1 - ss(0.12, 0.55, t)) + S.h[k];
          const e = qd - D;
          if (e > 0 && lat > 0) {
            const keep = SEAT_SOFT * (1 - Math.exp(-e / SEAT_SOFT));
            const c = (keep - e) * ps.w * g * lat;
            const vx = ps.b[0] * c, vy = ps.b[1] * c, vz = ps.b[2] * c;
            if (dq) { dqUnrotate(_dq, vx, vy, vz, _pa); rx = _pa[0]; ry = _pa[1]; rz = _pa[2]; } else {
              inv3(blendMatrix(M, si, sw, i, _ma), vx, vy, vz, _pa); rx = _pa[0]; ry = _pa[1]; rz = _pa[2];
            }
          }
        }
      }
      if (Math.abs(rx - s3[o]) > 1e-5 || Math.abs(ry - s3[o + 1]) > 1e-5 || Math.abs(rz - s3[o + 2]) > 1e-5) changed = true;
      s3[o] = rx; s3[o + 1] = ry; s3[o + 2] = rz;
    }
    return changed;
  }

  /**
   * Hem lift of tops: raising the arms pulls the fabric up from the shoulders and
   * the side seams, so the lower part of a top rises with them (up to `amount` m
   * at the hem with both arms straight up; one arm lifts its own side). Rest-space
   * offsets along the torso axis of the torso vertices below the armpits.
   */
  setHemLift(bi, amount, torso) {
    const P = this.fine.P, n = this.fine.n, ya = bi.land.armpit - 0.03, idx = [], sv = [];
    for (let i = 0; i < n; i++) {
      if (!torso[i] || P[i * 3 + 1] > ya) continue;
      idx.push(i); sv.push(ss(ya, ya - 0.15, P[i * 3 + 1]));
    }
    if (!idx.length) return;
    const model = bi.topo.model, arm = (r, side) => {
      const J = bi.limbs[r].J;
      return { a: [J[0], J[1], J[2]], b: [J[3], J[4], J[5]], ba: model.boneIndex.get('upperarm01.' + side), bb: model.boneIndex.get('lowerarm01.' + side) };
    };
    this.hemLift = { amount, idx: Int32Array.from(idx), s: Float32Array.from(sv), arms: [arm(1, 'L'), arm(2, 'R')], chest: model.boneIndex.get('spine03') ?? 0, raise: [0, 0] };
    this.liftY = new Float32Array(this.disp.length);
  }

  /** Arm raise of both sides (0..1) -> liftY. Returns true when the lift changed. */
  _liftPass(M) {
    const H = this.hemLift;
    lin(M, H.chest, DOWN, _pc);
    const dl = Math.hypot(_pc[0], _pc[1], _pc[2]) || 1;
    let moved = false;
    H.arms.forEach((a, q) => {
      xform(M, a.ba, a.a, _pa); xform(M, a.bb, a.b, _pb);
      const ux = _pb[0] - _pa[0], uy = _pb[1] - _pa[1], uz = _pb[2] - _pa[2], ul = Math.hypot(ux, uy, uz) || 1;
      const elev = Math.acos(Math.max(-1, Math.min(1, (ux * _pc[0] + uy * _pc[1] + uz * _pc[2]) / (ul * dl)))) * 57.29578;
      const r = ss(LIFT_ELEV[0], LIFT_ELEV[1], elev);
      if (Math.abs(r - H.raise[q]) > 0.01 || (r === 0) !== (H.raise[q] === 0)) { H.raise[q] = r; moved = true; }
    });
    if (!moved) return false;
    const P = this.fine.P, L = this.liftY, [rl, rr] = H.raise;
    for (let k = 0; k < H.idx.length; k++) {
      const i = H.idx[k], wl = ss(-0.08, 0.08, P[i * 3]);
      L[i] = H.amount * H.s[k] * (rl * wl + rr * (1 - wl));
    }
    return true;
  }

  /**
   * Seat pass only (a garment hidden under other layers keeps no folds; its
   * shading is never seen, so the normals are not recomputed). Returns true if the
   * geometry changed.
   */
  updateSeat(M) {
    if (!this.seat || !this._seatPass(M)) return false;
    this.write(false);
    return true;
  }

  /** Enables the leg collision of the skirt parts (see legColliders). */
  setLegs(legs) {
    this.legs = legs;
    this.off3 = new Float32Array(this.disp.length * 3);
    this._legV = new Float32Array(this.disp.length * 3);
    this._legSig = new Float32Array(legs.length * 6).fill(NaN);
  }

  /**
   * Skirts hang from the waist with weights blended towards the pelvis, so a
   * raised thigh or a bent knee would come through the fabric: the skirt is
   * pushed off the (posed) leg capsules, the push is carried down the skirt
   * (fabric hangs from the knee like a tent) and spread around a little, then
   * mapped back to rest space. Returns true if the offsets changed.
   */
  _legPass(M) {
    const legs = this.legs, sig = this._legSig;
    // posed capsule ends (skip everything while the legs do not move)
    let moved = false;
    const caps = this._caps || (this._caps = legs.map(() => ({ a: new Float32Array(3), b: new Float32Array(3) })));
    legs.forEach((c, q) => {
      xform(M, c.ba, c.a, caps[q].a); xform(M, c.bb, c.b, caps[q].b);
      for (let k = 0; k < 3; k++) {
        if (Math.abs(caps[q].a[k] - sig[q * 6 + k]) > 1e-5 || !(sig[q * 6 + k] === sig[q * 6 + k])) moved = true;
        if (Math.abs(caps[q].b[k] - sig[q * 6 + 3 + k]) > 1e-5) moved = true;
        sig[q * 6 + k] = caps[q].a[k]; sig[q * 6 + 3 + k] = caps[q].b[k];
      }
    });
    if (!moved && !this._legsDirty) return false;
    this._legsDirty = false;
    const V = this._legV, off3 = this.off3, P = this.fine.P, N = this.dirN, si = this.fine.si, sw = this.fine.sw, disp = this.disp, push = this.push;
    V.fill(0);
    let any = false;
    for (const part of this.parts) {
      if (!part.ring) continue;
      const { rings, segs } = part.ring, o0 = part.offset;
      for (let i = o0, e = o0 + rings * segs; i < e; i++) {
        const a = blendMatrix(M, si, sw, i, _ma);
        const d = disp[i] + push[i], o = i * 3;
        const x = P[o] + N[o] * d, y = P[o + 1] + N[o + 1] * d, z = P[o + 2] + N[o + 2] * d;
        let px = a[0] * x + a[3] * y + a[6] * z + a[9], py = a[1] * x + a[4] * y + a[7] * z + a[10], pz = a[2] * x + a[5] * y + a[8] * z + a[11];
        const sx = px, sy = py, sz = pz;
        for (let q = 0; q < caps.length; q++) {
          const A = caps[q].a, B = caps[q].b, c = legs[q];
          const abx = B[0] - A[0], aby = B[1] - A[1], abz = B[2] - A[2];
          const l2 = abx * abx + aby * aby + abz * abz || 1e-9;
          let t = ((px - A[0]) * abx + (py - A[1]) * aby + (pz - A[2]) * abz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = px - (A[0] + abx * t), qy = py - (A[1] + aby * t), qz = pz - (A[2] + abz * t);
          const R = c.ra + (c.rb - c.ra) * t + LEG_CLEAR;
          const dd = qx * qx + qy * qy + qz * qz;
          if (dd >= R * R) continue;
          const dl = Math.sqrt(dd);
          if (dl < 1e-6) continue;
          const k = (R - dl) / dl;
          px += qx * k; py += qy * k; pz += qz * k;
        }
        if (px !== sx || py !== sy || pz !== sz) { V[o] = px - sx; V[o + 1] = py - sy; V[o + 2] = pz - sz; any = true; }
      }
      if (!any) continue;
      // the fabric below a contact hangs from it (carried down the skirt) ...
      for (let k = 1; k < rings; k++) for (let j = 0; j < segs; j++) {
        const i = (o0 + k * segs + j) * 3, u = (o0 + (k - 1) * segs + j) * 3;
        const ux = V[u] * HANG, uy = V[u + 1] * HANG, uz = V[u + 2] * HANG;
        if (ux * ux + uy * uy + uz * uz > V[i] * V[i] + V[i + 1] * V[i + 1] + V[i + 2] * V[i + 2]) { V[i] = ux; V[i + 1] = uy; V[i + 2] = uz; }
      }
      // ... and drapes around it (no sharp vertical crease at the contact's border)
      const row = this._row || (this._row = new Float32Array(512 * 3));
      for (let k = 0; k < rings; k++) for (let pass = 0; pass < 3; pass++) {
        const b = (o0 + k * segs) * 3;
        row.set(V.subarray(b, b + segs * 3));
        for (let j = 0; j < segs; j++) {
          const l = ((j + segs - 1) % segs) * 3, r = ((j + 1) % segs) * 3, c = j * 3;
          const mx = (row[l] + row[r]) * 0.4, my = (row[l + 1] + row[r + 1]) * 0.4, mz = (row[l + 2] + row[r + 2]) * 0.4;
          if (mx * mx + my * my + mz * mz > row[c] * row[c] + row[c + 1] * row[c + 1] + row[c + 2] * row[c + 2]) { V[b + c] = mx; V[b + c + 1] = my; V[b + c + 2] = mz; }
        }
      }
    }
    // posed offsets -> rest space (inverse of the blended linear part)
    let changed = false;
    for (const part of this.parts) {
      if (!part.ring) continue;
      const { rings, segs } = part.ring;
      for (let i = part.offset, e = part.offset + rings * segs; i < e; i++) {
        const o = i * 3;
        let rx = 0, ry = 0, rz = 0;
        if (V[o] || V[o + 1] || V[o + 2]) {
          const a = blendMatrix(M, si, sw, i, _ma);
          inv3(a, V[o], V[o + 1], V[o + 2], _pa);
          rx = _pa[0]; ry = _pa[1]; rz = _pa[2];
        }
        if (Math.abs(rx - off3[o]) > 1e-5 || Math.abs(ry - off3[o + 1]) > 1e-5 || Math.abs(rz - off3[o + 2]) > 1e-5) changed = true;
        off3[o] = rx; off3[o + 1] = ry; off3[o + 2] = rz;
      }
    }
    return changed;
  }

  /**
   * Pairs every vertex of this garment with the closest vertex of the garments
   * below it (rest pose). While posing, the two layers are skinned with
   * different weights and fold independently: the layer pass pushes this
   * garment out wherever the one below would come through.
   */
  bindLayers(inners) {
    this.layers = null;
    this.push.fill(0);
    const rts = inners.filter((r) => r && r !== this && r.fine);
    if (!rts.length || !this.fine) return;
    // grid of this garment's fine vertices
    const cell = LAYER_REACH, grid = new Map();
    const key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
    const P = this.fine.P, N = this.dirN, n = this.fine.n;
    for (let i = 0; i < n; i++) {
      const kk = key(Math.floor(P[i * 3] / cell), Math.floor(P[i * 3 + 1] / cell), Math.floor(P[i * 3 + 2] / cell));
      let a = grid.get(kk);
      if (!a) grid.set(kk, (a = []));
      a.push(i);
    }
    // every vertex of the layers below looks for the vertex of this garment over it
    // (testing all of them catches fold crests that rise between two vertices of this one)
    const out = [], rin = [], jin = [], gap = [];
    const r2 = LAYER_REACH * LAYER_REACH;
    // closest vertex of the layers below for each vertex of this garment
    const pd2 = new Float32Array(n).fill(Infinity), pr = new Int8Array(n).fill(-1), pj = new Int32Array(n);
    rts.forEach((r, ri) => {
      const Q = r.fine.P, M = r.dirN, onlyCoarse = r.layerCoarse ? r.fine.coarse : null;
      for (let j = 0; j < r.fine.n; j++) {
        // a layer with almost no folds of its own (underwear) is sampled at its coarse vertices
        if (onlyCoarse && !onlyCoarse[j]) continue;
        // every fine vertex of the layer below: a garment resting close on it
        // (T-shirt hem on jeans) would let fold crests between coarse vertices through
        const x = Q[j * 3], y = Q[j * 3 + 1], z = Q[j * 3 + 2];
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
        let best = r2, bi = -1, bg = 0;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const a = grid.get(key(cx + dx, cy + dy, cz + dz));
          if (!a) continue;
          for (const i of a) {
            const ex = P[i * 3] - x, ey = P[i * 3 + 1] - y, ez = P[i * 3 + 2] - z;
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 >= best) continue;
            const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
            if (nx * M[j * 3] + ny * M[j * 3 + 1] + nz * M[j * 3 + 2] < 0.4) continue;
            const g = ex * nx + ey * ny + ez * nz;
            if (g < -0.004) continue; // that vertex is not over this one
            best = d2; bi = i; bg = g;
          }
        }
        if (bi < 0) continue;
        out.push(bi); rin.push(ri); jin.push(j); gap.push(Math.min(LAYER_GAP_MAX, Math.max(LAYER_GAP_MIN, bg)));
        if (best < pd2[bi]) { pd2[bi] = best; pr[bi] = ri; pj[bi] = j; }
      }
    });
    if (!out.length) return;
    // vertices of this garment that no vertex below picked (between two picked
    // ones) take the closest of their neighbours' partners: otherwise the weights
    // they inherit alternate vertex by vertex and a hem lying on jeans tears into
    // teeth as the thighs move
    const adj = this.fine.adj;
    for (let ring = 0; ring < 2 && adj; ring++) {
      const was = pr.slice();
      for (let i = 0; i < n; i++) {
        if (was[i] >= 0) continue;
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        let best = r2;
        for (let k = adj.off[i]; k < adj.off[i + 1]; k++) {
          const u = adj.adj[k];
          if (was[u] < 0) continue;
          const r = rts[was[u]], j = pj[u], Q = r.fine.P, M = r.dirN;
          const ex = x - Q[j * 3], ey = y - Q[j * 3 + 1], ez = z - Q[j * 3 + 2];
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 >= best || nx * M[j * 3] + ny * M[j * 3 + 1] + nz * M[j * 3 + 2] < 0.4) continue;
          best = d2; pd2[i] = d2; pr[i] = was[u]; pj[i] = j;
        }
      }
    }
    this._inheritWeights(rts, pd2, pr, pj);
    // grouped by vertex of this garment: its posed frame is computed once
    const order = out.map((_, k) => k).sort((a, b) => out[a] - out[b]);
    const pick = (src, T) => T.from(order.map((k) => src[k]));
    this.layers = { rts, out: pick(out, Int32Array), rin: pick(rin, Uint8Array), jin: pick(jin, Int32Array), gap: pick(gap, Float32Array), need: new Float32Array(n) };
    this._layersDirty = true;
  }

  /**
   * Where this garment lies on another one it takes over (most of) that one's
   * skin weights, blended in over a few vertex rings: both layers then move
   * together (a T-shirt hem resting on jeans follows the thighs as the jeans
   * do instead of staying with the pelvis while the jeans move through it).
   */
  _inheritWeights(rts, pd2, pr, pj) {
    const F = this.fine, n = F.n, adj = F.adj;
    const near = 0.012, far = LAYER_REACH;
    let t = new Float32Array(n), t2 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (pr[i] < 0) continue;
      const d = Math.sqrt(pd2[i]);
      t[i] = d <= near ? 1 : d >= far ? 0 : 1 - (d - near) / (far - near);
    }
    // soften the border of the inherited region (no weight seam)
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) {
        if (pr[i] < 0) { t2[i] = 0; continue; }
        let s = 0, c = 0;
        for (let k = adj.off[i]; k < adj.off[i + 1]; k++) { s += t[adj.adj[k]]; c++; }
        t2[i] = c ? t[i] * 0.5 + (s / c) * 0.5 : t[i];
      }
      const x = t; t = t2; t2 = x;
    }
    const si = F.si, sw = F.sw, idx = [0, 0, 0, 0, 0, 0, 0, 0], w = [0, 0, 0, 0, 0, 0, 0, 0];
    let any = false;
    for (let i = 0; i < n; i++) {
      const a = t[i] * WEIGHT_INHERIT;
      if (a < 0.02) continue;
      any = true;
      const r = rts[pr[i]], j = pj[i];
      let m = 0;
      const addW = (b, x) => { if (x <= 0) return; for (let q = 0; q < m; q++) if (idx[q] === b) { w[q] += x; return; } idx[m] = b; w[m] = x; m++; };
      for (let k = 0; k < 4; k++) addW(si[i * 4 + k], sw[i * 4 + k] * (1 - a));
      for (let k = 0; k < 4; k++) addW(r.fine.si[j * 4 + k], r.fine.sw[j * 4 + k] * a);
      // keep the 4 largest, renormalised
      for (let k = 0; k < 4; k++) {
        let bq = -1, bw = 0;
        for (let q = 0; q < m; q++) if (w[q] > bw) { bw = w[q]; bq = q; }
        si[i * 4 + k] = bq >= 0 ? idx[bq] : 0; sw[i * 4 + k] = bw;
        if (bq >= 0) w[bq] = -1;
      }
      const s = sw[i * 4] + sw[i * 4 + 1] + sw[i * 4 + 2] + sw[i * 4 + 3] || 1;
      for (let k = 0; k < 4; k++) sw[i * 4 + k] /= s;
    }
    if (!any) return;
    // render vertices follow their fine vertex
    const SI = this.geometry.attributes.skinIndex, SW = this.geometry.attributes.skinWeight, rv2v = this.rv2v;
    for (let r = 0; r < rv2v.length; r++) {
      const v = rv2v[r];
      if (v < 0) continue;
      for (let k = 0; k < 4; k++) { SI.array[r * 4 + k] = si[v * 4 + k]; SW.array[r * 4 + k] = sw[v * 4 + k]; }
    }
    SI.needsUpdate = true; SW.needsUpdate = true;
    // the coarse strain surfaces (coarse vertex c = fine vertex c of its part)
    for (const p of this.parts) {
      const wp = p.wp;
      for (let c = 0; c < wp.n; c++) for (let k = 0; k < 4; k++) { wp.skinIdx[c * 4 + k] = si[(p.offset + c) * 4 + k]; wp.skinW[c * 4 + k] = sw[(p.offset + c) * 4 + k]; }
      wp.rebind();
    }
  }

  /** Recomputes the layer push for the current pose. Returns true if it changed. */
  _layerPass(M) {
    const L = this.layers, push = this.push, P = this.fine.P, si = this.fine.si, sw = this.fine.sw, N = this.dirN, disp = this.disp;
    const need = L.need;
    need.fill(0);
    let last = -1, px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
    for (let p = 0, np = L.out.length; p < np; p++) {
      const i = L.out[p], r = L.rts[L.rin[p]], j = L.jin[p];
      if (i !== last) {
        // this garment (without its push): posed position and normal
        last = i;
        const a = blendMatrix(M, si, sw, i, _ma);
        const d = disp[i], o = i * 3;
        const nx0 = N[o], ny0 = N[o + 1], nz0 = N[o + 2];
        const x = P[o] + nx0 * d, y = P[o + 1] + ny0 * d, z = P[o + 2] + nz0 * d;
        px = a[0] * x + a[3] * y + a[6] * z + a[9]; py = a[1] * x + a[4] * y + a[7] * z + a[10]; pz = a[2] * x + a[5] * y + a[8] * z + a[11];
        nx = a[0] * nx0 + a[3] * ny0 + a[6] * nz0; ny = a[1] * nx0 + a[4] * ny0 + a[7] * nz0; nz = a[2] * nx0 + a[5] * ny0 + a[8] * nz0;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
      }
      // the layer below, with its folds and its own push
      const b = blendMatrix(M, r.fine.si, r.fine.sw, j, _mb);
      const e = r.disp[j] + r.push[j] + r.fine.lift[j], q = j * 3, RN = r.dirN, RP = r.fine.P;
      const ux = RP[q] + RN[q] * e, uy = RP[q + 1] + RN[q + 1] * e, uz = RP[q + 2] + RN[q + 2] * e;
      let ox = 0, oy = 0, oz = 0;
      if (r.off3) { ox = r.off3[q]; oy = r.off3[q + 1]; oz = r.off3[q + 2]; }
      if (r.floorOn) { ox += r.fl3[q]; oy += r.fl3[q + 1]; oz += r.fl3[q + 2]; }
      if (r.seat?.on) { ox += r.s3[q]; oy += r.s3[q + 1]; oz += r.s3[q + 2]; }
      if (r.liftY) oy += r.liftY[j];
      const qx = b[0] * (ux + ox) + b[3] * (uy + oy) + b[6] * (uz + oz) + b[9], qy = b[1] * (ux + ox) + b[4] * (uy + oy) + b[7] * (uz + oz) + b[10], qz = b[2] * (ux + ox) + b[5] * (uy + oy) + b[8] * (uz + oz) + b[11];
      const v = L.gap[p] - ((px - qx) * nx + (py - qy) * ny + (pz - qz) * nz);
      if (v > need[i]) need[i] = v;
    }
    // the fabric is lifted over an area, not vertex by vertex: grow the push over
    // a few rings (a rising crest or a lifted thigh below lifts this one smoothly;
    // vertex by vertex, a hem lying close on jeans would show them through in teeth)
    const adj = this.fine.adj;
    if (adj) for (let pass = 0; pass < LAYER_SPREAD; pass++) {
      const src = pass & 1 ? push : need, dst = pass & 1 ? need : push;
      for (let i = 0; i < need.length; i++) {
        let m = src[i];
        for (let k = adj.off[i]; k < adj.off[i + 1]; k++) { const w = src[adj.adj[k]] * LAYER_FALLOFF; if (w > m) m = w; }
        dst[i] = m;
      }
    }
    let changed = false;
    for (let i = 0; i < need.length; i++) {
      const v = need[i];
      if (Math.abs(v - push[i]) > 1e-5 || (v === 0) !== (push[i] === 0)) changed = true;
    }
    if (changed) push.set(need);
    return changed;
  }

  /**
   * Recomputes wrinkles (and the layer push) for the current pose. innerMoved:
   * a garment below this one changed this frame. Returns true if the geometry changed.
   */
  update(ch, k, M, posed = true, innerMoved = false) {
    let changed = false;
    for (const p of this.parts) {
      if (posed) changed = p.wp.update(ch, k, M) || changed;
      else if (this.k !== k || p.wp.active) { p.wp.restDisp(k); changed = true; }
    }
    if (this.k !== k) changed = true;
    this.k = k;
    if (this.hemLift && posed) changed = this._liftPass(M) || changed;
    if (this.layers && (changed || innerMoved || this._layersDirty)) {
      this._layersDirty = false;
      changed = this._layerPass(M) || changed;
    }
    if (this.legs) {
      if (changed) this._legsDirty = true;
      changed = this._legPass(M) || changed;
    }
    // after the leg pass: a skirt pushed off the thighs is then pressed onto the seat
    if (this.seat && (posed || this.seat.on)) changed = this._seatPass(M) || changed;
    if (this.floor && (changed || innerMoved || this._floorDirty !== false)) {
      this._floorDirty = false;
      changed = this._floorPass(M) || changed;
    }
    if (changed) this.write();
    return changed;
  }

  /**
   * Floor contact: no vertex of the posed garment below the character's floor
   * (rig space y = 0: the root's own placement height). Lying, sitting or
   * kneeling on the ground, loose fabric would otherwise hang through it. Points
   * below are lifted onto the floor (rest-space offsets through the inverse of
   * their blended skin matrix, like the skirt's leg pass). Parts whose posed rest
   * surface stays well above the floor are skipped after a cheap coarse test.
   * Returns true when the offsets changed.
   */
  _floorPass(M) {
    const F = this.fine, P = F.P, si = F.si, sw = F.sw, N = this.dirN, disp = this.disp, push = this.push, off3 = this.off3;
    let near = false;
    for (const part of this.parts) {
      const wp = part.wp, G = wp.G, SI = wp.skinIdx, SW = wp.skinW;
      part.nearFloor = false;
      // coarse rest surface, posed: is any of it within reach of the floor?
      for (let i = 0; i < wp.n; i += 2) {
        const x = G[i * 3], y = G[i * 3 + 1], z = G[i * 3 + 2];
        let py = 0;
        for (let k = 0; k < 4; k++) {
          const w = SW[i * 4 + k];
          if (!w) continue;
          const o = SI[i * 4 + k] * 16;
          py += w * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
        }
        if (py < FLOOR_REACH) { part.nearFloor = true; near = true; break; }
      }
    }
    if (!near) {
      if (!this.floorOn) return false;
      this.floorOn = false;
      return true;
    }
    const fl3 = this.fl3 || (this.fl3 = new Float32Array(disp.length * 3));
    // offsets left from an earlier contact are void while the pass was off
    if (!this.floorOn) fl3.fill(0);
    let changed = false, any = false;
    for (const part of this.parts) {
      const o0 = part.offset, o1 = o0 + part.nf;
      if (!part.nearFloor) {
        for (let q = o0 * 3; q < o1 * 3; q++) if (fl3[q]) { fl3[q] = 0; changed = true; }
        continue;
      }
      const s3 = this.seat?.on ? this.s3 : null, liftY = this.liftY;
      for (let i = o0; i < o1; i++) {
        const d = disp[i] + push[i], o = i * 3;
        let x = P[o] + N[o] * d, y = P[o + 1] + N[o + 1] * d, z = P[o + 2] + N[o + 2] * d;
        if (off3) { x += off3[o]; y += off3[o + 1]; z += off3[o + 2]; }
        if (s3) { x += s3[o]; y += s3[o + 1]; z += s3[o + 2]; }
        if (liftY) y += liftY[i];
        // posed height first (the y row of the blended matrix only): most vertices are well above the floor
        let py = 0;
        for (let k = 0; k < 4; k++) {
          const w = sw[i * 4 + k];
          if (!w) continue;
          const q = si[i * 4 + k] * 16;
          py += w * (M[q + 1] * x + M[q + 5] * y + M[q + 9] * z + M[q + 13]);
        }
        let rx = 0, ry = 0, rz = 0;
        if (py < FLOOR_Y) {
          inv3(blendMatrix(M, si, sw, i, _ma), 0, FLOOR_Y - py, 0, _pa);
          rx = _pa[0]; ry = _pa[1]; rz = _pa[2];
          any = true;
        }
        if (Math.abs(rx - fl3[o]) > 1e-5 || Math.abs(ry - fl3[o + 1]) > 1e-5 || Math.abs(rz - fl3[o + 2]) > 1e-5) changed = true;
        fl3[o] = rx; fl3[o + 1] = ry; fl3[o + 2] = rz;
      }
    }
    this.floorOn = any;
    return changed;
  }

  write(normals = true) {
    const { rv2v, base, dirN, nid, index } = this;
    // scratch shared by every garment (writes never overlap)
    const nacc = scratch(0, this.nslot * 3), disp = scratch(1, this.disp.length);
    for (let i = 0, m = this.disp.length; i < m; i++) disp[i] = this.disp[i] + this.push[i];
    const posAttr = this.geometry.attributes.position, nrmAttr = this.geometry.attributes.normal;
    const P = posAttr.array, NR = nrmAttr.array;
    const n = rv2v.length;
    const off3 = this.off3, fl3 = this.floorOn ? this.fl3 : null, s3 = this.seat?.on ? this.s3 : null, liftY = this.liftY;
    for (let r = 0; r < n; r++) {
      const v = rv2v[r], o = r * 3;
      if (v < 0) { P[o] = base[o]; P[o + 1] = base[o + 1]; P[o + 2] = base[o + 2]; continue; }
      const d = disp[v], q = v * 3;
      P[o] = base[o] + dirN[q] * d; P[o + 1] = base[o + 1] + dirN[q + 1] * d; P[o + 2] = base[o + 2] + dirN[q + 2] * d;
      if (off3) { P[o] += off3[q]; P[o + 1] += off3[q + 1]; P[o + 2] += off3[q + 2]; }
      if (s3) { P[o] += s3[q]; P[o + 1] += s3[q + 1]; P[o + 2] += s3[q + 2]; }
      if (liftY) P[o + 1] += liftY[v];
      if (fl3) { P[o] += fl3[q]; P[o + 1] += fl3[q + 1]; P[o + 2] += fl3[q + 2]; }
    }
    if (!normals) { posAttr.needsUpdate = true; return; }
    nacc.fill(0, 0, this.nslot * 3);
    // a triangle facing against the rest normal of a main-surface vertex (a fold
    // turned inside out: shoe toe gaps, extreme poses) does not darken its shading
    const main = this.main;
    const add = (r, nx, ny, nz) => {
      if (main && main[r]) { const q = rv2v[r] * 3; if (nx * dirN[q] + ny * dirN[q + 1] + nz * dirN[q + 2] < 0) return; }
      const s = nid[r] * 3; nacc[s] += nx; nacc[s + 1] += ny; nacc[s + 2] += nz;
    };
    for (let t = 0, m = index.length; t < m; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      const ao = a * 3, bo = b * 3, co = c * 3;
      const ux = P[bo] - P[ao], uy = P[bo + 1] - P[ao + 1], uz = P[bo + 2] - P[ao + 2];
      const vx = P[co] - P[ao], vy = P[co + 1] - P[ao + 1], vz = P[co + 2] - P[ao + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      add(a, nx, ny, nz); add(b, nx, ny, nz); add(c, nx, ny, nz);
    }
    for (let r = 0; r < n; r++) {
      const s = nid[r] * 3;
      let x = nacc[s], y = nacc[s + 1], z = nacc[s + 2];
      let l = Math.sqrt(x * x + y * y + z * z);
      if (l < 1e-14) { const q = Math.max(0, rv2v[r]) * 3; x = dirN[q]; y = dirN[q + 1]; z = dirN[q + 2]; l = Math.sqrt(x * x + y * y + z * z) || 1; }
      NR[r * 3] = x / l; NR[r * 3 + 1] = y / l; NR[r * 3 + 2] = z / l;
    }
    posAttr.needsUpdate = true;
    nrmAttr.needsUpdate = true;
  }

  dispose() { this.geometry.dispose(); }
}
