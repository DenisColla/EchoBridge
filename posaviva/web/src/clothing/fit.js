// Garment fitting on the coarse (body-resolution) garment surface:
//   hangFit       loose garments hang from the widest parts (chest, hips,
//                 thigh, biceps) instead of following every body concavity
//   bridgeSmooth  outward-only membrane smoothing with a minimum-offset
//                 constraint: fabric bridges cleavage, spine groove, buttocks
//                 and toes but never sinks into the body
//   smoothWeights skin weight diffusion for loose parts (no tearing)
import { LIMB_REGIONS, PART, NPART } from './body.js';
import { hull2, hullRadius, len2, len3 } from './mesh.js';

const NTH = 36; // angular bins of the hang grid
const DS = 0.015; // axial bin size (m)

/**
 * Loose-fit pass. For each region with garment vertices, a cylindrical grid
 * (axial x angular) stores the outer radius the fabric must reach; it is
 * propagated "downstream" (down the torso / along the limbs) with a maximal
 * taper slope so fabric hangs straight from protrusions. Vertices below the
 * envelope move radially outward by looseness * gap.
 * c: coarse context {n, body (Int32 body vertex per coarse vertex), P0, N0, off, G, coords}
 */
export function hangFit(c, bi, opts) {
  const { loose = 0, slope = 0.4, innerSlope = 1.2, torsoStartY = bi.land.armpit - 0.02, fade = null, bridgeSlope = 0.8, hullAmount = 0 } = opts;
  if (loose <= 0.001 && bridgeSlope >= 1.9 && hullAmount <= 0) return;
  const { n, P0, off, G, coords } = c;
  const tmp = new Float32Array(9);
  const regions = [0, ...LIMB_REGIONS];
  const rv = new Float32Array(n), sv = new Float32Array(n), tv = new Float32Array(n), dirs = new Float32Array(n * 3);
  for (const R of regions) {
    // gather member vertices
    let smin = Infinity, smax = -Infinity, count = 0;
    for (let i = 0; i < n; i++) {
      const w = R === 0 ? coords.wT[i] : (coords.limb[i] === R ? 1 - coords.wT[i] : 0);
      if (w < 0.3) { rv[i] = -1; continue; }
      const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2];
      let s;
      if (R === 0) { bi.torsoCyl(x, y, z, tmp); s = -y; } else { const a = coords.aL[i]; bi.limbs[R].cyl(Math.max(0, a), x, y, z, tmp); s = bi.limbs[R].metric(a); }
      rv[i] = tmp[1] + off[i]; sv[i] = s; tv[i] = tmp[0];
      dirs[i * 3] = tmp[5]; dirs[i * 3 + 1] = tmp[6]; dirs[i * 3 + 2] = tmp[7];
      if (s < smin) smin = s;
      if (s > smax) smax = s;
      count++;
    }
    if (count < 8) continue;
    const rows = Math.max(1, Math.ceil((smax - smin) / DS) + 1);
    const grid = new Float32Array(rows * NTH).fill(-1);
    const cell = (s, th) => {
      const r = Math.min(rows - 1, Math.max(0, Math.floor((s - smin) / DS)));
      const t = ((Math.floor(((th + Math.PI) / (2 * Math.PI)) * NTH) % NTH) + NTH) % NTH;
      return r * NTH + t;
    };
    for (let i = 0; i < n; i++) if (rv[i] >= 0) { const k = cell(sv[i], tv[i]); if (rv[i] > grid[k]) grid[k] = rv[i]; }
    // fill empty cells around each row, then empty rows from the previous one
    for (let r = 0; r < rows; r++) {
      const o = r * NTH;
      let any = false;
      for (let t = 0; t < NTH; t++) if (grid[o + t] >= 0) { any = true; break; }
      if (!any) { if (r > 0) for (let t = 0; t < NTH; t++) grid[o + t] = grid[o - NTH + t]; continue; }
      for (let pass = 0; pass < NTH; pass++) {
        let changed = false;
        for (let t = 0; t < NTH; t++) {
          if (grid[o + t] >= 0) continue;
          const a = grid[o + ((t + 1) % NTH)], b = grid[o + ((t + NTH - 1) % NTH)];
          if (a >= 0 || b >= 0) { grid[o + t] = Math.max(a, b); changed = true; }
        }
        if (!changed) break;
      }
    }
    // angular spread: fabric spans over small dips around the cross-section
    const row = new Float32Array(NTH);
    for (let r = 0; r < rows; r++) {
      const o = r * NTH;
      for (let t = 0; t < NTH; t++) row[t] = grid[o + t];
      for (let t = 0; t < NTH; t++) {
        const m = Math.max(row[(t + 1) % NTH], row[(t + NTH - 1) % NTH]) * 0.985;
        if (m > grid[o + t]) grid[o + t] = m;
      }
    }
    // two envelopes propagated down the axis with a maximal taper:
    //   bridge (steep): stiff fabric cannot follow steep concavities (under the bust, behind the knee)
    //   drape (fit dependent): loose fabric hangs straight from chest / hips / thigh / biceps
    const start = R === 0 ? -torsoStartY : 0.0;
    const gridB = grid.slice();
    // torso: horizontal convex hull per row below the armpits -> woven / knit
    // fabric spans straight across the cleavage, the spine groove, the buttocks
    if (R === 0 && hullAmount > 0) {
      const rowPts = Array.from({ length: rows }, () => []);
      for (let i = 0; i < n; i++) {
        if (rv[i] < 0) continue;
        const y = -sv[i];
        if (y > bi.land.armpit - 0.025) continue;
        const r = Math.min(rows - 1, Math.max(0, Math.floor((sv[i] - smin) / DS)));
        rowPts[r].push(-Math.sin(tv[i]) * rv[i], Math.cos(tv[i]) * rv[i]);
      }
      for (let r = 0; r < rows; r++) {
        const pts = rowPts[r];
        if (pts.length < 12) continue;
        const h = hull2(pts);
        if (h.length < 3) continue;
        for (let t = 0; t < NTH; t++) {
          const th = ((t + 0.5) / NTH) * 2 * Math.PI - Math.PI;
          const rh = hullRadius(h, -Math.sin(th), Math.cos(th)) * hullAmount + gridB[r * NTH + t] * (1 - hullAmount);
          if (rh > gridB[r * NTH + t]) gridB[r * NTH + t] = rh;
        }
      }
    }
    const propagate = (g, base) => {
      for (let r = 1; r < rows; r++) {
        const s = smin + r * DS;
        if (s < start) continue;
        for (let t = 0; t < NTH; t++) {
          let sl = base;
          if (R !== 0) {
            // inner side of limbs (towards the body / other leg) may not bulge
            const th = (t + 0.5) / NTH * 2 * Math.PI - Math.PI;
            const inner = Math.max(0, -Math.cos(th));
            sl = base + (Math.max(innerSlope, base) - base) * inner * inner;
          }
          const prev = g[(r - 1) * NTH + t] - sl * DS;
          if (prev > g[r * NTH + t]) g[r * NTH + t] = prev;
        }
      }
    };
    propagate(grid, slope);
    propagate(gridB, bridgeSlope);
    // move vertices outward
    for (let i = 0; i < n; i++) {
      if (rv[i] < 0) continue;
      const w = R === 0 ? coords.wT[i] : 1 - coords.wT[i];
      // bilinear lookup
      const fr = Math.max(0, Math.min(rows - 1.001, (sv[i] - smin) / DS - 0.5));
      const r0 = Math.floor(fr), r1 = Math.min(rows - 1, r0 + 1), ar = fr - r0;
      const ft = ((tv[i] + Math.PI) / (2 * Math.PI)) * NTH - 0.5;
      const t0 = ((Math.floor(ft) % NTH) + NTH) % NTH, t1 = (t0 + 1) % NTH, at = ft - Math.floor(ft);
      const lerp2 = (G2) => (G2[r0 * NTH + t0] * (1 - at) + G2[r0 * NTH + t1] * at) * (1 - ar) + (G2[r1 * NTH + t0] * (1 - at) + G2[r1 * NTH + t1] * at) * ar;
      const target = lerp2(grid), targetB = lerp2(gridB);
      let d = Math.max(Math.max(0, targetB - rv[i]), Math.max(0, target - rv[i]) * loose) * Math.min(1, w * 1.4);
      if (fade) d *= fade[i];
      G[i * 3] += dirs[i * 3] * d; G[i * 3 + 1] += dirs[i * 3 + 1] * d; G[i * 3 + 2] += dirs[i * 3 + 2] * d;
    }
  }
}

/**
 * Outward-only Laplacian smoothing (tangential relaxation + normal fill of
 * concavities) with the per-vertex minimum offset constraint. Boundary
 * vertices are smoothed along their loop only (straight, clean hems).
 */
export function bridgeSmooth(c, iterations, opts = {}) {
  const { n, P0, N0, off, G, adj, bnd, bprev, bnext } = c;
  const { tangential = 0.3, normal = 0.6 } = opts;
  const tmp = new Float32Array(n * 3);
  // edge-length weights: metric (not topological) smoothing, so dense vertex
  // clusters (nipples, navel) follow the surrounding surface
  const W = new Float32Array(adj.adj.length);
  for (let i = 0; i < n; i++) for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j]; W[j] = len3(P0[u * 3] - P0[i * 3], P0[u * 3 + 1] - P0[i * 3 + 1], P0[u * 3 + 2] - P0[i * 3 + 2]) + 1e-5; }
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      let ax = 0, ay = 0, az = 0, cnt = 0;
      if (bnd[i]) {
        const a = bprev[i], b = bnext[i];
        if (a >= 0 && b >= 0) { ax = G[a * 3] + G[b * 3]; ay = G[a * 3 + 1] + G[b * 3 + 1]; az = G[a * 3 + 2] + G[b * 3 + 2]; cnt = 2; }
      } else {
        for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j] * 3, w = W[j]; ax += G[u] * w; ay += G[u + 1] * w; az += G[u + 2] * w; cnt += w; }
      }
      if (!cnt) { tmp[o] = G[o]; tmp[o + 1] = G[o + 1]; tmp[o + 2] = G[o + 2]; continue; }
      const lx = ax / cnt - G[o], ly = ay / cnt - G[o + 1], lz = az / cnt - G[o + 2];
      const nx = N0[o], ny = N0[o + 1], nz = N0[o + 2];
      const ln = lx * nx + ly * ny + lz * nz;
      const tx = lx - ln * nx, ty = ly - ln * ny, tz = lz - ln * nz;
      const k = ln > 0 ? ln * normal : 0;
      const tw = bnd[i] ? tangential * 0.6 : tangential;
      tmp[o] = G[o] + tx * tw + nx * k;
      tmp[o + 1] = G[o + 1] + ty * tw + ny * k;
      tmp[o + 2] = G[o + 2] + tz * tw + nz * k;
    }
    G.set(tmp);
    enforceOffset(n, G, P0, N0, off);
    if (c.hard) enforceOffset(n, G, c.hard.P0, c.hard.N0, c.hard.offMin);
  }
}

/**
 * Final low-pass of the garment surface (edge-length weighted Laplacian,
 * interior vertices), then the offset constraints again. Removes any fabric
 * detail smaller than a couple of centimetres left by the body topology.
 */
export function metricSmooth(c, iterations) {
  const { n, P0, N0, off, G, adj, bnd } = c;
  if (iterations <= 0) return;
  const W = new Float32Array(adj.adj.length);
  for (let i = 0; i < n; i++) for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j]; W[j] = len3(P0[u * 3] - P0[i * 3], P0[u * 3 + 1] - P0[i * 3 + 1], P0[u * 3 + 2] - P0[i * 3 + 2]) + 1e-5; }
  const tmp = new Float32Array(n * 3);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      if (bnd[i]) { tmp[o] = G[o]; tmp[o + 1] = G[o + 1]; tmp[o + 2] = G[o + 2]; continue; }
      let ax = 0, ay = 0, az = 0, ws = 0;
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j] * 3, w = W[j]; ax += G[u] * w; ay += G[u + 1] * w; az += G[u + 2] * w; ws += w; }
      tmp[o] = G[o] * 0.5 + (ax / ws) * 0.5; tmp[o + 1] = G[o + 1] * 0.5 + (ay / ws) * 0.5; tmp[o + 2] = G[o + 2] * 0.5 + (az / ws) * 0.5;
    }
    G.set(tmp);
    enforceOffset(n, G, P0, N0, off);
    if (c.hard) enforceOffset(n, G, c.hard.P0, c.hard.N0, c.hard.offMin);
  }
}

/** G >= body + normal * off (signed distance along the body normal). */
export function enforceOffset(n, G, B, NB, off, slack = 0) {
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const d = (G[o] - B[o]) * NB[o] + (G[o + 1] - B[o + 1]) * NB[o + 1] + (G[o + 2] - B[o + 2]) * NB[o + 2];
    const need = off[i] - slack;
    if (d < need) { const k = need - d; G[o] += NB[o] * k; G[o + 1] += NB[o + 1] * k; G[o + 2] += NB[o + 2] * k; }
  }
}

/**
 * Dense skin weights over the bones used by the garment, diffused over the
 * coarse adjacency. W: Float32Array(n * nb) (in/out); amount: per-vertex 0..1.
 */
export function smoothWeights(n, nb, W, adj, iterations, amount) {
  if (iterations <= 0) return;
  const tmp = new Float32Array(W.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const o = i * nb, k = amount ? amount[i] : 1;
      const deg = adj.off[i + 1] - adj.off[i];
      if (!deg || k <= 0) { for (let b = 0; b < nb; b++) tmp[o + b] = W[o + b]; continue; }
      for (let b = 0; b < nb; b++) {
        let s = 0;
        for (let j = adj.off[i]; j < adj.off[i + 1]; j++) s += W[adj.adj[j] * nb + b];
        tmp[o + b] = W[o + b] * (1 - 0.5 * k) + (s / deg) * 0.5 * k;
      }
    }
    W.set(tmp);
  }
}

/** Top-4 bone weights from dense rows. Returns {idx: Uint16Array(n*4), w: Float32Array(n*4)}. */
export function top4(n, nb, W, boneIds) {
  const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
  const bi = [0, 0, 0, 0], bw = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    bw[0] = bw[1] = bw[2] = bw[3] = 0; bi[0] = bi[1] = bi[2] = bi[3] = 0;
    const o = i * nb;
    for (let b = 0; b < nb; b++) {
      const x = W[o + b];
      if (x <= bw[3]) continue;
      let k = 3;
      while (k > 0 && x > bw[k - 1]) { bw[k] = bw[k - 1]; bi[k] = bi[k - 1]; k--; }
      bw[k] = x; bi[k] = b;
    }
    const s = bw[0] + bw[1] + bw[2] + bw[3] || 1;
    for (let k = 0; k < 4; k++) { idx[i * 4 + k] = boneIds[bi[k]]; w[i * 4 + k] = bw[k] / s; }
  }
  return { idx, w };
}

/**
 * Shoes / socks: every foot vertex is pushed out to the convex hull of its
 * cross-section slab (perpendicular to the foot axis), so toe gaps, the arch
 * and small dips are bridged into one toe box; amount 0..1.
 */
export function footEnvelope(c, bi, amount = 1, iterations = 14) {
  const { n, adj, coords, body } = c;
  const topo = bi.topo, PW = topo.partW;
  const foot = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const o = body[i] * NPART; if ((coords.limb[i] === 3 || coords.limb[i] === 4) && PW[o + PART.footL] + PW[o + PART.footR] >= 0.3) foot[i] = 1; }
  // alternate: push out to the slab hulls, relax on the surface (untangles the
  // collapsed toe-gap walls), push again
  const tmp = new Float32Array(n * 3);
  for (let it = 0; it < iterations; it++) {
    footHull(c, bi, amount);
    const G = c.G;
    tmp.set(G);
    for (let i = 0; i < n; i++) {
      if (!foot[i] || c.bnd[i]) continue;
      let ax = 0, ay = 0, az = 0, k = 0;
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j] * 3; ax += G[u]; ay += G[u + 1]; az += G[u + 2]; k++; }
      if (!k) continue;
      tmp[i * 3] = G[i * 3] * 0.4 + (ax / k) * 0.6; tmp[i * 3 + 1] = G[i * 3 + 1] * 0.4 + (ay / k) * 0.6; tmp[i * 3 + 2] = G[i * 3 + 2] * 0.4 + (az / k) * 0.6;
    }
    G.set(tmp);
  }
  footHull(c, bi, amount);
}

function footHull(c, bi, amount) {
  const { n, G, coords, body } = c;
  const topo = bi.topo, PW = topo.partW;
  for (const R of [3, 4]) {
    const L = bi.limbs[R];
    const ax = L.J[6], ay = L.J[7], az = L.J[8];
    const D = [L.D[6], L.D[7], L.D[8]], RR = [L.R[6], L.R[7], L.R[8]], Q = [L.Q[6], L.Q[7], L.Q[8]];
    const rows = new Map();
    const idx = [], uu = [], vv = [], tt = [];
    for (let i = 0; i < n; i++) {
      if (coords.limb[i] !== R) continue;
      const v = body[i], o = v * NPART;
      if (PW[o + PART.footL] + PW[o + PART.footR] < 0.3) continue;
      const x = G[i * 3] - ax, y = G[i * 3 + 1] - ay, z = G[i * 3 + 2] - az;
      const t = x * D[0] + y * D[1] + z * D[2];
      const u = x * RR[0] + y * RR[1] + z * RR[2], w = x * Q[0] + y * Q[1] + z * Q[2];
      const row = Math.round(t / 0.008);
      if (!rows.has(row)) rows.set(row, []);
      rows.get(row).push(idx.length);
      idx.push(i); uu.push(u); vv.push(w); tt.push(t);
    }
    for (const list of rows.values()) {
      if (list.length < 5) continue;
      // centre of the slab, hull of its points
      let cu = 0, cv = 0;
      for (const k of list) { cu += uu[k]; cv += vv[k]; }
      cu /= list.length; cv /= list.length;
      const pts = [];
      for (const k of list) pts.push(uu[k] - cu, vv[k] - cv);
      const h = hull2(pts);
      if (h.length < 3) continue;
      for (const k of list) {
        const du = uu[k] - cu, dv = vv[k] - cv, r = len2(du, dv);
        if (r < 1e-5) continue;
        const rh = hullRadius(h, du / r, dv / r);
        if (rh <= r) continue;
        const push = (rh - r) * amount, i = idx[k];
        const ex = (RR[0] * du + Q[0] * dv) / r, ey = (RR[1] * du + Q[1] * dv) / r, ez = (RR[2] * du + Q[2] * dv) / r;
        G[i * 3] += ex * push; G[i * 3 + 1] += ey * push; G[i * 3 + 2] += ez * push;
      }
    }
  }
}
