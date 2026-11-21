// Parametric tube garments around hips and legs (skirts, the skirt of the
// dress) and thin ribbons on the body surface (bra straps).
//
// Skirt: rings from the waist to the hem. Each ring follows the convex hull of
// the body cross-section at its height (fabric bridges between the legs),
// then hangs down with a maximal taper (pencil) or flares (A-line / flared).
// Drape folds are added around the circumference, growing towards the hem.
// Skin weights come from the body vertices under each ring point, blended
// towards the pelvis and smoothed around the ring the lower they are, so the
// fabric stretches between the legs instead of tearing when they spread.
import { buildEdges, buildAdjacency, boundaryLoops, hull2, hullRadius } from './mesh.js';
import { foldProfile, smoothstep } from './build.js';
import { noise3 } from './wrinkles.js';
import { PART, NPART } from './body.js';

const PI = Math.PI;

/**
 * spec: {top: y, hem: y, ease, thickness, flare (radius gain per m below the hips), taper (max
 *        inward slope), drape: {count, amp}, loose (weight blend towards the pelvis 0..1), segs}
 */
export function buildSkirtDraft(ctx, def, spec) {
  const { topo, bi, occ } = ctx;
  const P = bi.P, nvb = topo.nv, model = topo.model;
  const segs = spec.segs ?? 80;
  const yTop = spec.top, yHem = spec.hem;
  const dy = 0.011;
  const rings = Math.max(4, Math.ceil((yTop - yHem) / dy) + 1);
  const ys = new Float32Array(rings);
  for (let k = 0; k < rings; k++) ys[k] = yTop - (yTop - yHem) * (k / (rings - 1));
  const t = spec.thickness ?? 0.0025, ease = spec.ease ?? 0.006;
  // ---- body cross sections (torso + legs, no arms / hands)
  const slab = 0.012;
  const ringPts = Array.from({ length: rings }, () => []);
  const ringSrc = Array.from({ length: rings }, () => []);
  const okPart = (v) => {
    const o = v * NPART, W = topo.partW;
    return W[o + PART.armL] + W[o + PART.handL] + W[o + PART.armR] + W[o + PART.handR] < 0.3;
  };
  const yMin = yHem - slab, yMax = yTop + slab;
  for (let v = 0; v < nvb; v++) {
    const y = P[v * 3 + 1];
    if (y < yMin || y > yMax || !okPart(v)) continue;
    const k0 = Math.max(0, Math.floor((yTop - y - slab) / ((yTop - yHem) / (rings - 1)))), k1 = Math.min(rings - 1, Math.ceil((yTop - y + slab) / ((yTop - yHem) / (rings - 1))));
    for (let k = k0; k <= k1; k++) {
      if (Math.abs(ys[k] - y) > slab) continue;
      const cz = bi.cz(ys[k]);
      const x = P[v * 3], z = P[v * 3 + 2] - cz;
      const r = Math.hypot(x, z) || 1e-6, ex = (occ ? Math.max(0, occ[v]) : 0) + t + ease;
      ringPts[k].push(x * (r + ex) / r, z * (r + ex) / r);
      ringSrc[k].push(v);
    }
  }
  // ---- envelope radius per ring / angle
  const R = new Float32Array(rings * segs), env = new Float32Array(rings * segs), src = new Int32Array(rings * segs).fill(-1);
  for (let k = 0; k < rings; k++) {
    const pts = ringPts[k];
    if (pts.length < 6) { if (k > 0) for (let j = 0; j < segs; j++) { env[k * segs + j] = env[(k - 1) * segs + j]; src[k * segs + j] = src[(k - 1) * segs + j]; } continue; }
    const h = hull2(pts);
    for (let j = 0; j < segs; j++) {
      const th = (j / segs) * 2 * PI - PI;
      env[k * segs + j] = hullRadius(h, -Math.sin(th), Math.cos(th));
    }
    // source vertex per angle: the body point closest in angle (for skin weights)
    const best = new Float32Array(segs).fill(9);
    for (let q = 0; q < pts.length / 2; q++) {
      const th = Math.atan2(-pts[q * 2], pts[q * 2 + 1]);
      const j = ((Math.round(((th + PI) / (2 * PI)) * segs) % segs) + segs) % segs;
      const rr = Math.hypot(pts[q * 2], pts[q * 2 + 1]);
      const score = env[k * segs + j] - rr;
      if (score < best[j]) { best[j] = score; src[k * segs + j] = ringSrc[k][q]; }
    }
    for (let pass = 0; pass < segs; pass++) {
      let ch = false;
      for (let j = 0; j < segs; j++) if (src[k * segs + j] < 0) { const a = src[k * segs + (j + 1) % segs], b = src[k * segs + (j + segs - 1) % segs]; if (a >= 0 || b >= 0) { src[k * segs + j] = a >= 0 ? a : b; ch = true; } }
      if (!ch) break;
    }
  }
  // ---- hang / flare
  const hipsY = Math.min(yTop, spec.hangFrom ?? bi.land.hips);
  for (let k = 0; k < rings; k++) for (let j = 0; j < segs; j++) {
    const i = k * segs + j;
    let r = env[i];
    if (k > 0 && ys[k] < hipsY) {
      const prev = R[i - segs];
      const flare = (spec.flare ?? 0) * dy * (1 + 0.5 * Math.cos((j / segs) * 2 * PI - PI) ** 2);
      r = Math.max(r, prev - (spec.taper ?? 0.15) * dy + flare);
    }
    R[i] = r;
  }
  // angular smoothing (fabric does not follow small dips)
  const tmpR = new Float32Array(segs);
  for (let k = 0; k < rings; k++) {
    for (let it = 0; it < 2; it++) {
      for (let j = 0; j < segs; j++) tmpR[j] = R[k * segs + j];
      for (let j = 0; j < segs; j++) R[k * segs + j] = Math.max(tmpR[j], (tmpR[(j + 1) % segs] + tmpR[(j + segs - 1) % segs]) * 0.5);
    }
  }
  // ---- positions + static drape (applied as radial modulation of the rest shape)
  const nf = rings * segs;
  const Pf = new Float32Array(nf * 3), room = new Float32Array(nf), stat = new Float32Array(nf);
  const drape = spec.drape || { count: 10, amp: 0.004 };
  const len = yTop - yHem;
  for (let k = 0; k < rings; k++) for (let j = 0; j < segs; j++) {
    const i = k * segs + j, th = (j / segs) * 2 * PI - PI;
    const r = R[i];
    const below = Math.max(0, hipsY - ys[k]) / Math.max(0.05, len);
    const x0 = -Math.sin(th) * r, z0 = Math.cos(th) * r;
    const nz = noise3(x0 * 6, ys[k] * 2.5, z0 * 6);
    const fold = foldProfile(drape.count * th + 1.4 * nz + 0.6 * Math.sin(ys[k] * 9)) - 0.35;
    const a = drape.amp * smoothstep(0, 1, below) * (0.75 + 0.5 * noise3(x0 * 3 + 5, ys[k], z0 * 3));
    stat[i] = Math.max(fold * a, -(R[i] - env[i]) * 0.7);
    room[i] = Math.max(0, r - env[i] - 0.001);
    bi.torsoPoint(ys[k], th, r, Pf, i * 3);
  }
  // ---- quads (CCW seen from outside)
  const quads = new Uint32Array((rings - 1) * segs * 4);
  let q = 0;
  for (let k = 0; k + 1 < rings; k++) for (let j = 0; j < segs; j++) {
    const j1 = (j + 1) % segs;
    quads[q++] = k * segs + j; quads[q++] = k * segs + j1; quads[q++] = (k + 1) * segs + j1; quads[q++] = (k + 1) * segs + j;
  }
  // ---- skin weights: body weights under each point, blended towards the pelvis lower down, smoothed around
  const SI = model.skinIndex, SW = model.skinWeight;
  const boneLocal = new Map(), boneIds = [];
  const addBone = (b) => { if (!boneLocal.has(b)) { boneLocal.set(b, boneIds.length); boneIds.push(b); } return boneLocal.get(b); };
  for (let i = 0; i < nf; i++) { const v = src[i]; if (v < 0) continue; for (let kk = 0; kk < 4; kk++) if (SW[v * 4 + kk] > 0) addBone(SI[v * 4 + kk]); }
  const pelvisBones = ['root', 'spine05', 'pelvis.L', 'pelvis.R'].map((n) => model.boneIndex.get(n)).filter((b) => b !== undefined).map(addBone);
  const nb = boneIds.length;
  const W = new Float32Array(nf * nb);
  for (let i = 0; i < nf; i++) {
    const v = src[i];
    if (v < 0) { W[i * nb + pelvisBones[0]] = 1; continue; }
    for (let kk = 0; kk < 4; kk++) { const w = SW[v * 4 + kk]; if (w > 0) W[i * nb + boneLocal.get(SI[v * 4 + kk])] += w; }
  }
  // pelvis reference = average weights of the waist ring
  const pel = new Float32Array(nb);
  for (let j = 0; j < segs; j++) for (let b = 0; b < nb; b++) pel[b] += W[j * nb + b] / segs;
  const loose = spec.loose ?? 0.5;
  const row = new Float32Array(segs * nb);
  for (let k = 0; k < rings; k++) {
    const below = smoothstep(0, 1, Math.max(0, hipsY + 0.04 - ys[k]) / Math.max(0.05, len));
    const blend = loose * below;
    for (let j = 0; j < segs; j++) { const o = (k * segs + j) * nb; for (let b = 0; b < nb; b++) W[o + b] = W[o + b] * (1 - blend) + pel[b] * blend; }
    // angular diffusion grows towards the hem
    const iters = Math.round(2 + 14 * below * (0.5 + loose));
    for (let it = 0; it < iters; it++) {
      row.set(W.subarray(k * segs * nb, (k + 1) * segs * nb));
      for (let j = 0; j < segs; j++) {
        const o = (k * segs + j) * nb, a = ((j + 1) % segs) * nb, c = ((j + segs - 1) % segs) * nb;
        for (let b = 0; b < nb; b++) W[o + b] = row[j * nb + b] * 0.5 + (row[a + b] + row[c + b]) * 0.25;
      }
    }
  }
  // vertical diffusion
  for (let it = 0; it < 3; it++) for (let k = 1; k + 1 < rings; k++) for (let j = 0; j < segs; j++) {
    const o = (k * segs + j) * nb;
    for (let b = 0; b < nb; b++) W[o + b] = W[o + b] * 0.5 + (W[o - segs * nb + b] + W[o + segs * nb + b]) * 0.25;
  }
  const skin = top4w(nf, nb, W, boneIds);
  // ---- coords, zone (waistband), loops
  const wT = new Float32Array(nf).fill(1), limb = new Int8Array(nf), aL = new Float32Array(nf).fill(-0.3);
  const sT = new Float32Array(nf), thT = new Float32Array(nf), sL = new Float32Array(nf), thL = new Float32Array(nf), tT = new Float32Array(nf);
  const zone = new Float32Array(nf);
  const bandH = spec.band ?? 0;
  for (let k = 0; k < rings; k++) for (let j = 0; j < segs; j++) {
    const i = k * segs + j;
    sT[i] = -ys[k]; thT[i] = (j / segs) * 2 * PI - PI; tT[i] = bi.T(ys[k]);
    if (bandH > 0) zone[i] = 1 - smoothstep(bandH * 0.75, bandH * 1.15, yTop - ys[k]);
  }
  const E = buildEdges(nf, quads);
  const adj = buildAdjacency(nf, E);
  const loops = boundaryLoops(nf, quads, E).map((L) => ({ verts: L, id: L[0] < segs ? 'waist' : 'hem' }));
  const idx = new Int32Array(nf * 4), pw = new Float32Array(nf * 4);
  for (let i = 0; i < nf; i++) { idx[i * 4] = i; pw[i * 4] = 1; }
  const off = new Float32Array(nf).fill(t + ease);
  return {
    kind: 'skirt', def, n: nf, nf, P: Pf, quads, room, zone, off, thick: t,
    coords: { wT, limb, aL, sT, thT, sL, thL, tT }, cons: [], cvals: [], skin, loops, fitT: spec.fitT ?? 0.5,
    staticDisp: stat,
    coarse: { n: nf, G: Pf, quads, adj, skin, parents: { idx, w: pw }, coords: { wT, limb, aL } },
    ring: { rings, segs, ys, R, env },
  };
}

function top4w(n, nb, W, boneIds) {
  const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * nb;
    const best = [-1, -1, -1, -1], bw = [0, 0, 0, 0];
    for (let b = 0; b < nb; b++) {
      const x = W[o + b];
      if (x <= bw[3]) continue;
      let k = 3;
      while (k > 0 && x > bw[k - 1]) { bw[k] = bw[k - 1]; best[k] = best[k - 1]; k--; }
      bw[k] = x; best[k] = b;
    }
    const s = bw[0] + bw[1] + bw[2] + bw[3] || 1;
    for (let k = 0; k < 4; k++) { idx[i * 4 + k] = best[k] >= 0 ? boneIds[best[k]] : 0; w[i * 4 + k] = bw[k] / s; }
  }
  return { idx, w };
}

/** Occupancy contribution of a skirt draft to the body vertices it surrounds. */
export function skirtOccupancy(draft, bi, topo, occ) {
  const { rings, segs, ys, R } = draft.ring;
  const P = bi.P;
  const y0 = ys[rings - 1], y1 = ys[0], dy = (y1 - y0) / (rings - 1);
  for (let v = 0; v < topo.nv; v++) {
    const y = P[v * 3 + 1];
    if (y < y0 || y > y1) continue;
    const cz = bi.cz(y), x = P[v * 3], z = P[v * 3 + 2] - cz;
    const th = Math.atan2(-x, z);
    const k = Math.min(rings - 1, Math.round((y1 - y) / dy)), j = ((Math.round(((th + PI) / (2 * PI)) * segs) % segs) + segs) % segs;
    const gap = R[k * segs + j] - Math.hypot(x, z);
    if (gap > 0 && gap < 0.06 && gap > occ[v]) occ[v] = gap;
  }
}

/**
 * Ribbon (strap) following the body surface through control points.
 * Returns extras-like data with its own skin weights: {pos, nrm, skinIdx, skinW, tris, uv}
 */
export function ribbon(bi, topo, ctrl, opts = {}) {
  const width = opts.width ?? 0.012, off = opts.offset ?? 0.0025, samples = opts.samples ?? 40;
  const P = bi.P, N = bi.N, model = topo.model;
  // Catmull-Rom through control points
  const pts = [];
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return [0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3));
  };
  const segN = ctrl.length - 1;
  for (let s = 0; s < segN; s++) {
    const p0 = ctrl[Math.max(0, s - 1)], p1 = ctrl[s], p2 = ctrl[s + 1], p3 = ctrl[Math.min(segN, s + 2)];
    const steps = Math.ceil(samples / segN);
    for (let i = 0; i < steps; i++) pts.push(cr(p0, p1, p2, p3, i / steps));
  }
  pts.push(ctrl[segN]);
  // project to the body: nearest torso / neck vertex, then offset along its normal
  const cand = [];
  for (let v = 0; v < topo.nv; v++) if (topo.regionWeight(v, 0) > 0.3) cand.push(v);
  const proj = pts.map((p) => {
    let best = -1, bd = Infinity;
    for (const v of cand) { const d = (P[v * 3] - p[0]) ** 2 + (P[v * 3 + 1] - p[1]) ** 2 + (P[v * 3 + 2] - p[2]) ** 2; if (d < bd) { bd = d; best = v; } }
    return best;
  });
  const m = pts.length;
  const C = new Float32Array(m * 3), NN = new Float32Array(m * 3);
  for (let i = 0; i < m; i++) {
    const v = proj[i];
    for (let c = 0; c < 3; c++) { NN[i * 3 + c] = N[v * 3 + c]; C[i * 3 + c] = P[v * 3 + c] + N[v * 3 + c] * off; }
  }
  // smooth the projected path
  for (let it = 0; it < 4; it++) for (let i = 1; i + 1 < m; i++) for (let c = 0; c < 3; c++) C[i * 3 + c] = C[i * 3 + c] * 0.5 + (C[(i - 1) * 3 + c] + C[(i + 1) * 3 + c]) * 0.25;
  // keep it outside: max over the original offset point along the normal
  for (let i = 0; i < m; i++) {
    const v = proj[i];
    const d = (C[i * 3] - P[v * 3]) * N[v * 3] + (C[i * 3 + 1] - P[v * 3 + 1]) * N[v * 3 + 1] + (C[i * 3 + 2] - P[v * 3 + 2]) * N[v * 3 + 2];
    if (d < off) for (let c = 0; c < 3; c++) C[i * 3 + c] += N[v * 3 + c] * (off - d);
  }
  const pos = [], skinIdx = [], skinW = [], tris = [], uv = [];
  let arc = 0;
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
    let tx = C[b * 3] - C[a * 3], ty = C[b * 3 + 1] - C[a * 3 + 1], tz = C[b * 3 + 2] - C[a * 3 + 2];
    const nx = NN[i * 3], ny = NN[i * 3 + 1], nz = NN[i * 3 + 2];
    let sx = ty * nz - tz * ny, sy = tz * nx - tx * nz, sz = tx * ny - ty * nx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    if (i > 0) arc += Math.hypot(C[i * 3] - C[(i - 1) * 3], C[i * 3 + 1] - C[(i - 1) * 3 + 1], C[i * 3 + 2] - C[(i - 1) * 3 + 2]);
    for (const [k, h] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
      const lift = h ? 0.0012 : 0;
      pos.push(C[i * 3] + sx * k * width * 0.5 + nx * lift, C[i * 3 + 1] + sy * k * width * 0.5 + ny * lift, C[i * 3 + 2] + sz * k * width * 0.5 + nz * lift);
      const v = proj[i];
      for (let q = 0; q < 4; q++) { skinIdx.push(model.skinIndex[v * 4 + q]); skinW.push(model.skinWeight[v * 4 + q]); }
      uv.push(arc, k * width);
    }
  }
  // 4 vertices per sample: bottom-left, bottom-right, top-right, top-left (a flat band with a little thickness)
  for (let i = 0; i + 1 < m; i++) {
    const a = i * 4, b = (i + 1) * 4;
    // top face (2,3) and the two sides
    tris.push(a + 3, b + 2, a + 2, a + 3, b + 3, b + 2);
    tris.push(a + 2, b + 1, a + 1, a + 2, b + 2, b + 1);
    tris.push(a, b + 3, a + 3, a, b, b + 3);
  }
  return { pos, skinIdx, skinW, tris, uv, count: m * 4, proj };
}
