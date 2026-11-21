// Per-vertex data of a meshed animal (build time): normals, skin weights
// (primitive ownership -> species bones -> surface diffusion), material
// regions, coat masks, ambient occlusion from the field and the box-mapping
// charts used for the fur normal map.

const REGIONS = ['fur', 'keratin', 'nose', 'mouth', 'pad', 'skin', 'eyelid'];
export const REGION_IDS = Object.fromEntries(REGIONS.map((r, i) => [r, i]));
export { REGIONS };

function vertexNormals(P, I) {
  const n = new Float32Array(P.length);
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // area weighted
    for (const o of [a, b, c]) { n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

function adjacency(nv, I) {
  const sets = Array.from({ length: nv }, () => new Set());
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i], b = I[i + 1], c = I[i + 2];
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
  }
  const start = new Int32Array(nv + 1);
  for (let v = 0; v < nv; v++) start[v + 1] = start[v] + sets[v].size;
  const list = new Int32Array(start[nv]);
  for (let v = 0; v < nv; v++) { let k = start[v]; for (const u of sets[v]) list[k++] = u; }
  return { start, list };
}

function segDist(px, py, pz, a, b) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const l2 = bx * bx + by * by + bz * bz || 1e-12;
  let t = ((px - a[0]) * bx + (py - a[1]) * by + (pz - a[2]) * bz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - a[0] - bx * t, py - a[1] - by * t, pz - a[2] - bz * t);
}

/**
 * @param mesh {positions, indices}
 * @param field Field of the species
 * @param bones [{name, parent, head, tail}]
 * @param opts {blend (m, joint blend radius), coat(v) -> masks, aoScale (m), h}
 */
export function bake(mesh, field, bones, opts) {
  const P = mesh.positions, I = mesh.indices;
  const nv = P.length / 3, nb = bones.length;
  const N = vertexNormals(P, I);
  const adj = adjacency(nv, I);
  const boneIx = new Map(bones.map((b, i) => [b.name, i]));
  const prims = field.prims.filter((p) => p.op === 'add');
  for (const p of prims) {
    p._bix = p.bones.map((b) => { const i = boneIx.get(b); if (i === undefined) throw new Error(`unknown bone ${b} (part ${p.part})`); return i; });
  }
  // mean edge length
  let el = 0, ec = 0;
  for (let i = 0; i < I.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = I[i + j] * 3, b = I[i + (j + 1) % 3] * 3;
    el += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); ec++;
  }
  el /= ec;

  // ---- ownership
  const W = new Float32Array(nv * nb);
  const dom = new Int32Array(nv); // dominant primitive (index into prims)
  const domParam = new Float32Array(nv);
  const regionW = new Float32Array(nv * REGIONS.length);
  const d = new Float32Array(prims.length);
  const h = opts.h || el;
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    let dmin = Infinity, best = 0;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      const bx = Math.max(p.min[0] - x, 0, x - p.max[0]), by = Math.max(p.min[1] - y, 0, y - p.max[1]), bz = Math.max(p.min[2] - z, 0, z - p.max[2]);
      if (Math.sqrt(bx * bx + by * by + bz * bz) > dmin + p.k + 0.05) { d[i] = Infinity; continue; }
      d[i] = field.primDist(p, x, y, z) - (p.weightBias || 0);
      if (d[i] < dmin) { dmin = d[i]; best = i; }
    }
    dom[v] = best;
    domParam[v] = prims[best].param(x, y, z);
    let tot = 0;
    for (let i = 0; i < prims.length; i++) {
      if (d[i] === Infinity) continue;
      const p = prims[i];
      const span = 0.5 * p.k + 0.6 * h;
      let o = 1 - (d[i] - dmin) / span;
      if (o <= 0) continue;
      o = o * o * p.weight;
      tot += o;
      regionW[v * REGIONS.length + (REGION_IDS[p.mat] ?? 0)] += o;
      if (!p._bix.length) continue;
      // nearest allowed bone segment
      let bb = p._bix[0], bd = Infinity;
      for (const bi of p._bix) {
        const B = bones[bi];
        const dd = segDist(x, y, z, B.head, B.tail);
        if (dd < bd) { bd = dd; bb = bi; }
      }
      W[v * nb + bb] += o;
    }
    if (tot > 0) for (let r = 0; r < REGIONS.length; r++) regionW[v * REGIONS.length + r] /= tot;
  }
  // normalise
  const normRow = (v) => {
    let s = 0;
    for (let b = 0; b < nb; b++) s += W[v * nb + b];
    if (s > 0) for (let b = 0; b < nb; b++) W[v * nb + b] /= s;
    else W[v * nb] = 1;
  };
  for (let v = 0; v < nv; v++) normRow(v);

  // ---- surface diffusion (smooth joints, no rigid segments)
  const blend = opts.blend || 0.04;
  const iters = Math.max(2, Math.min(220, Math.round(2.2 * (blend / el) ** 2)));
  let A = W, Bf = new Float32Array(W.length);
  for (let it = 0; it < iters; it++) {
    for (let v = 0; v < nv; v++) {
      const s0 = adj.start[v], s1 = adj.start[v + 1], cnt = s1 - s0;
      const o = v * nb;
      if (!cnt) { for (let b = 0; b < nb; b++) Bf[o + b] = A[o + b]; continue; }
      const k = 0.5 / cnt;
      for (let b = 0; b < nb; b++) Bf[o + b] = 0.5 * A[o + b];
      for (let e = s0; e < s1; e++) {
        const u = adj.list[e] * nb;
        for (let b = 0; b < nb; b++) Bf[o + b] += k * A[u + b];
      }
    }
    const t = A; A = Bf; Bf = t;
  }
  // locked bones (e.g. jaw / head across the lips): optional sharpening
  // ---- top 4
  const skinIndex = new Uint8Array(nv * 4), skinWeight = new Uint8Array(nv * 4);
  const tmpI = [0, 0, 0, 0], tmpW = [0, 0, 0, 0];
  for (let v = 0; v < nv; v++) {
    for (let k = 0; k < 4; k++) { tmpI[k] = 0; tmpW[k] = 0; }
    for (let b = 0; b < nb; b++) {
      const w = A[v * nb + b];
      if (w <= tmpW[3]) continue;
      let k = 3;
      while (k > 0 && tmpW[k - 1] < w) { tmpW[k] = tmpW[k - 1]; tmpI[k] = tmpI[k - 1]; k--; }
      tmpW[k] = w; tmpI[k] = b;
    }
    // drop tiny influences, quantize to 255 total
    let s = 0;
    for (let k = 0; k < 4; k++) { if (tmpW[k] < 0.02) tmpW[k] = 0; s += tmpW[k]; }
    let q = 0;
    for (let k = 0; k < 4; k++) {
      skinIndex[v * 4 + k] = tmpI[k];
      const wq = k === 3 ? 255 - q : Math.round((tmpW[k] / s) * 255);
      skinWeight[v * 4 + k] = Math.max(0, wq);
      q += skinWeight[v * 4 + k];
    }
    if (q !== 255) skinWeight[v * 4] += 255 - q;
  }

  // ---- ambient occlusion from the field (rest pose)
  const ao = new Float32Array(nv);
  const aoS = opts.aoScale || 0.02;
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    let occ = 0, sca = 1;
    for (let i = 1; i <= 5; i++) {
      const hh = aoS * i;
      const dd = field.eval(x + nx * hh, y + ny * hh, z + nz * hh);
      occ += Math.max(0, hh - dd) / hh * sca;
      sca *= 0.7;
    }
    ao[v] = Math.max(0, Math.min(1, 1 - 0.55 * occ));
  }

  // ---- carved surfaces (mouth slit, nostrils …) take the material of the cutting primitive
  const subs = field.prims.filter((p) => p.op === 'sub' && p.mat && p.mat !== 'fur');
  if (subs.length) {
    for (let v = 0; v < nv; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      for (const p of subs) {
        const bx = Math.max(p.min[0] - x, 0, x - p.max[0]), by = Math.max(p.min[1] - y, 0, y - p.max[1]), bz = Math.max(p.min[2] - z, 0, z - p.max[2]);
        if (Math.sqrt(bx * bx + by * by + bz * bz) > p.k + 2 * h) continue;
        const dd = -field.primDist(p, x, y, z); // >= ~0 on the carved wall
        const w = 1 - Math.abs(dd) / (0.6 * p.k + 1.2 * h);
        if (w <= 0) continue;
        const o = v * REGIONS.length;
        for (let r = 0; r < REGIONS.length; r++) regionW[o + r] *= (1 - w);
        regionW[o + (REGION_IDS[p.mat] ?? 0)] += w;
      }
    }
  }
  // ---- region per vertex
  const region = new Uint8Array(nv), regionWt = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    let br = 0, bw = 0;
    for (let r = 1; r < REGIONS.length; r++) { const w = regionW[v * REGIONS.length + r]; if (w > bw) { bw = w; br = r; } }
    region[v] = br; regionWt[v] = bw;
  }

  // ---- coat masks (species function)
  const masks = new Uint8Array(nv * 4), shade = new Float32Array(nv);
  const vInfo = { p: [0, 0, 0], n: [0, 0, 0], part: '', t: 0, prim: null, bone: '', weights: null };
  for (let v = 0; v < nv; v++) {
    vInfo.p[0] = P[v * 3]; vInfo.p[1] = P[v * 3 + 1]; vInfo.p[2] = P[v * 3 + 2];
    vInfo.n[0] = N[v * 3]; vInfo.n[1] = N[v * 3 + 1]; vInfo.n[2] = N[v * 3 + 2];
    const pr = prims[dom[v]];
    vInfo.part = pr.part; vInfo.t = domParam[v]; vInfo.prim = pr; vInfo.tag = pr.tag;
    vInfo.bone = bones[skinIndex[v * 4]].name;
    vInfo.region = REGIONS[region[v]]; vInfo.regionW = regionWt[v];
    const m = opts.coat ? opts.coat(vInfo) : null;
    const c = (x) => Math.round(Math.max(0, Math.min(1, x || 0)) * 255);
    if (m) {
      masks[v * 4] = c(m.under); masks[v * 4 + 1] = c(m.pattern); masks[v * 4 + 2] = c(m.points); masks[v * 4 + 3] = c(m.extra); shade[v] = m.shade ?? 0.5;
      if (m.region && m.regionW > regionWt[v]) { region[v] = REGION_IDS[m.region] ?? 0; regionWt[v] = m.regionW; }
    } else shade[v] = 0.5;
  }

  // ---- triangle groups by region (majority of confident vertices)
  const nt = I.length / 3;
  const triRegion = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    const cnt = new Map();
    for (let j = 0; j < 3; j++) {
      const v = I[t * 3 + j];
      const r = regionWt[v] > 0.5 ? region[v] : 0;
      cnt.set(r, (cnt.get(r) || 0) + 1);
    }
    let br = 0, bc = 0;
    for (const [r, c] of cnt) if (c > bc || (c === bc && r !== 0)) { bc = c; br = r; }
    triRegion[t] = bc >= 2 ? br : 0;
  }

  // ---- box mapping charts: split vertices per chart of their faces
  // chart per vertex from its smoothed normal (big contiguous charts, few seams),
  // a triangle takes the majority chart of its corners
  const vChart = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) {
    let sx = Math.abs(N[v * 3]), sy = Math.abs(N[v * 3 + 1]), sz = Math.abs(N[v * 3 + 2]);
    for (let e = adj.start[v]; e < adj.start[v + 1]; e++) { const u = adj.list[e]; sx += Math.abs(N[u * 3]); sy += Math.abs(N[u * 3 + 1]); sz += Math.abs(N[u * 3 + 2]); }
    vChart[v] = sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2;
  }
  const triChart = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    const c0 = vChart[I[t * 3]], c1 = vChart[I[t * 3 + 1]], c2 = vChart[I[t * 3 + 2]];
    triChart[t] = c1 === c2 ? c1 : c0;
  }
  const remap = new Map();
  const src = [];
  const chart = [];
  const outI = new Uint32Array(I.length);
  for (let t = 0; t < nt; t++) {
    for (let j = 0; j < 3; j++) {
      const v = I[t * 3 + j], key = v * 3 + triChart[t];
      let nvI = remap.get(key);
      if (nvI === undefined) { nvI = src.length; remap.set(key, nvI); src.push(v); chart.push(triChart[t]); }
      outI[t * 3 + j] = nvI;
    }
  }
  // reorder triangles by region group
  const order = Array.from({ length: nt }, (_, i) => i).sort((a, b) => triRegion[a] - triRegion[b]);
  const sortedI = new Uint32Array(I.length);
  const groups = [];
  for (let k = 0; k < nt; k++) {
    const t = order[k];
    for (let j = 0; j < 3; j++) sortedI[k * 3 + j] = outI[t * 3 + j];
    const r = triRegion[t];
    if (!groups.length || groups[groups.length - 1].region !== REGIONS[r]) groups.push({ region: REGIONS[r], start: k * 3, count: 0 });
    groups[groups.length - 1].count += 3;
  }
  const n2 = src.length;
  const out = {
    positions: new Float32Array(n2 * 3), normals: new Float32Array(n2 * 3), chart: Uint8Array.from(chart),
    masks: new Uint8Array(n2 * 4), extra: new Uint8Array(n2 * 4), skinIndex: new Uint8Array(n2 * 4), skinWeight: new Uint8Array(n2 * 4),
    indices: sortedI, groups,
    stats: { verts: n2, tris: nt, diffusionIters: iters, edge: el },
  };
  for (let i = 0; i < n2; i++) {
    const v = src[i];
    for (let k = 0; k < 3; k++) { out.positions[i * 3 + k] = P[v * 3 + k]; out.normals[i * 3 + k] = N[v * 3 + k]; }
    for (let k = 0; k < 4; k++) {
      out.masks[i * 4 + k] = masks[v * 4 + k];
      out.skinIndex[i * 4 + k] = skinIndex[v * 4 + k];
      out.skinWeight[i * 4 + k] = skinWeight[v * 4 + k];
    }
    out.extra[i * 4] = region[v];
    out.extra[i * 4 + 1] = Math.round(Math.min(1, regionWt[v] * 1.6 - 0.3 > 0 ? regionWt[v] * 1.6 - 0.3 : 0) * 255);
    out.extra[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, shade[v])) * 255);
    out.extra[i * 4 + 3] = Math.round(ao[v] * 255);
  }
  return out;
}
