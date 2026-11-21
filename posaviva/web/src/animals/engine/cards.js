// Explicit mesh parts of an animal (build time): thin closed slabs built from
// a grid of points ("sheets": feathers, wing membranes, fins that must stay
// thinner than the field resolution allows). They are not part of the signed
// distance body: each sheet carries its own skin weights (so overlapping
// feathers can slide over each other when a wing folds), UVs (0..1 per
// sheet, for the quill normal map) and coat info, and is appended to the
// baked body before packing.
//
// A sheet description (Builder.sheet):
//   grid  rows x cols of {p:[x,y,z], th (thickness, m), w:{bone: weight}, uv:[u,v]}
//         rows run along the sheet (t = 0 root .. 1 tip), cols across it
//         (s = -1 .. +1)
//   up    reference vector: the top face of the slab faces this way
//   part, tag, fi (index fraction for the coat), mat (region, default 'feather')
import { REGION_IDS } from './bake.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Closed slab mesh of one sheet: {P, N, UV, T, S, W, I}. */
export function sheetMesh(desc) {
  const G = desc.grid, nr = G.length, nc = G[0].length;
  const at = (i, j) => G[Math.max(0, Math.min(nr - 1, i))][Math.max(0, Math.min(nc - 1, j))];
  // grid normals from central differences
  const nrm = [];
  let orient = 0;
  for (let i = 0; i < nr; i++) {
    const row = [];
    for (let j = 0; j < nc; j++) {
      let du = sub(at(i + 1, j).p, at(i - 1, j).p), dv = sub(at(i, j + 1).p, at(i, j - 1).p);
      if (Math.hypot(...du) < 1e-9) du = sub(at(i + 1, j).p, at(i, j).p);
      if (Math.hypot(...dv) < 1e-9) dv = [1e-6, 0, 0];
      const n = cross(du, dv);
      orient += dot(n, desc.up || [0, 1, 0]);
      row.push(n);
    }
    nrm.push(row);
  }
  const sgn = orient >= 0 ? 1 : -1;
  for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
    let n = norm(nrm[i][j].map((x) => x * sgn));
    if (!Number.isFinite(n[0]) || Math.hypot(...n) < 0.5) n = norm(desc.up || [0, 1, 0]);
    nrm[i][j] = n;
  }
  const P = [], N = [], UV = [], T = [], S = [], W = [], I = [];
  const vert = (g, p, n, i, j) => {
    P.push(p); N.push(n); UV.push(g.uv || [j / (nc - 1), i / (nr - 1)]); T.push(i / (nr - 1)); S.push(nc > 1 ? (j / (nc - 1)) * 2 - 1 : 0); W.push(g.w);
    return P.length - 1;
  };
  const top = [], bot = [];
  for (let i = 0; i < nr; i++) {
    top.push([]); bot.push([]);
    for (let j = 0; j < nc; j++) {
      const g = G[i][j], n = nrm[i][j], h = (g.th ?? 0.001) / 2;
      top[i].push(vert(g, [g.p[0] + n[0] * h, g.p[1] + n[1] * h, g.p[2] + n[2] * h], n, i, j));
      bot[i].push(vert(g, [g.p[0] - n[0] * h, g.p[1] - n[1] * h, g.p[2] - n[2] * h], [-n[0], -n[1], -n[2]], i, j));
    }
  }
  // faces: (i,j) (i+1,j) (i+1,j+1) (i,j+1) has normal du x dv * sgn
  const quad = (a, b, c, d, flip) => { if (!flip) I.push(a, b, c, a, c, d); else I.push(a, c, b, a, d, c); };
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nc - 1; j++) {
    quad(top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1], sgn < 0);
    quad(bot[i][j], bot[i + 1][j], bot[i + 1][j + 1], bot[i][j + 1], sgn > 0);
  }
  // rim: boundary loop (row 0, last col, last row reversed, col 0 reversed), own vertices with outward normals
  const loop = [];
  for (let j = 0; j < nc; j++) loop.push([0, j]);
  for (let i = 1; i < nr; i++) loop.push([i, nc - 1]);
  for (let j = nc - 2; j >= 0; j--) loop.push([nr - 1, j]);
  for (let i = nr - 2; i > 0; i--) loop.push([i, 0]);
  // centroid for the outward direction
  let c = [0, 0, 0];
  for (const [i, j] of loop) { const p = G[i][j].p; c = [c[0] + p[0], c[1] + p[1], c[2] + p[2]]; }
  c = c.map((x) => x / loop.length);
  const L = loop.length;
  const rimT = [], rimB = [];
  for (let k = 0; k < L; k++) {
    const [i, j] = loop[k];
    const g = G[i][j], n = nrm[i][j];
    const prev = G[loop[(k - 1 + L) % L][0]][loop[(k - 1 + L) % L][1]].p, next = G[loop[(k + 1) % L][0]][loop[(k + 1) % L][1]].p;
    let out = cross(sub(next, prev), n);
    if (dot(out, sub(g.p, c)) < 0) out = out.map((x) => -x);
    out = norm(out);
    const h = (g.th ?? 0.001) / 2;
    rimT.push(vert(g, [g.p[0] + n[0] * h, g.p[1] + n[1] * h, g.p[2] + n[2] * h], out, i, j));
    rimB.push(vert(g, [g.p[0] - n[0] * h, g.p[1] - n[1] * h, g.p[2] - n[2] * h], out, i, j));
  }
  // winding of the rim quads: check against the outward normal
  for (let k = 0; k < L; k++) {
    const a = rimT[k], b = rimT[(k + 1) % L], cc = rimB[(k + 1) % L], d = rimB[k];
    const e1 = sub(P[b], P[a]), e2 = sub(P[d], P[a]);
    const fn = cross(e1, e2);
    const o = N[a];
    if (Math.hypot(...fn) < 1e-14) continue;
    quad(a, b, cc, d, dot(fn, o) > 0);
  }
  return { P, N, UV, T, S, W, I };
}

/**
 * Bakes the sheets of a species into arrays shaped like bake()'s output (plus
 * uv): skin weights from the sheet descriptions, region from desc.mat, coat
 * masks from the species coat function, AO from the body field.
 */
export function bakeSheets(sheets, field, bones, opts) {
  const boneIx = new Map(bones.map((b, i) => [b.name, i]));
  const P = [], N = [], UV = [], tri = [], triRegion = [], masks = [], extra = [], si = [], sw = [];
  const aoS = opts.aoScale || 0.02;
  const vInfo = { p: [0, 0, 0], n: [0, 0, 0], part: '', t: 0, s: 0, fi: 0, tag: null, bone: '', region: 'feather', regionW: 1, sheet: true };
  for (const desc of sheets) {
    const m = sheetMesh(desc);
    const base = P.length;
    const region = REGION_IDS[desc.mat || 'feather'] ?? REGION_IDS.feather;
    for (let v = 0; v < m.P.length; v++) {
      const p = m.P[v], n = m.N[v];
      P.push(p); N.push(n); UV.push(m.UV[v]);
      // weights: top 4, quantized to 255
      const ws = Object.entries(m.W[v] || {}).map(([b, w]) => { const i = boneIx.get(b); if (i === undefined) throw new Error('sheet: unknown bone ' + b); return [i, w]; }).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
      let tot = ws.reduce((s, x) => s + x[1], 0) || 1, q = 0;
      for (let k = 0; k < 4; k++) {
        const e = ws[k];
        si.push(e ? e[0] : 0);
        const wq = k === 3 || !ws[k + 1] ? (e ? 255 - q : 0) : Math.round((e[1] / tot) * 255);
        sw.push(e ? wq : 0);
        if (e) q += wq;
      }
      // AO from the body field (sheets do not occlude each other here)
      let occ = 0, sca = 1;
      for (let i = 1; i <= 5; i++) {
        const hh = aoS * i;
        const dd = field.eval(p[0] + n[0] * hh, p[1] + n[1] * hh, p[2] + n[2] * hh);
        occ += Math.max(0, hh - dd) / hh * sca;
        sca *= 0.7;
      }
      const ao = Math.max(0, Math.min(1, 1 - 0.55 * occ)) * (desc.ao ?? 1);
      vInfo.p[0] = p[0]; vInfo.p[1] = p[1]; vInfo.p[2] = p[2]; vInfo.n[0] = n[0]; vInfo.n[1] = n[1]; vInfo.n[2] = n[2];
      vInfo.part = desc.part || 'feather'; vInfo.tag = desc.tag || null; vInfo.t = m.T[v]; vInfo.s = m.S[v]; vInfo.fi = desc.fi ?? 0; vInfo.side = desc.side || 0;
      vInfo.region = desc.mat || 'feather'; vInfo.regionW = 1;
      const ws0 = ws[0] ? bones[ws[0][0]].name : bones[0].name;
      vInfo.bone = ws0;
      const c = opts.coat ? opts.coat(vInfo) : null;
      const cl = (x) => Math.round(Math.max(0, Math.min(1, x || 0)) * 255);
      masks.push(cl(c?.under), cl(c?.pattern), cl(c?.points), cl(c?.extra));
      // a sheet with a region other than feather keeps its region colour fully
      extra.push(region, desc.mat && desc.mat !== 'feather' && desc.mat !== 'fur' ? 255 : 0, cl(c ? c.shade ?? 0.5 : 0.5), Math.round(ao * 255));
    }
    for (let k = 0; k < m.I.length; k += 3) { tri.push(m.I[k] + base, m.I[k + 1] + base, m.I[k + 2] + base); triRegion.push(region); }
  }
  return { P, N, UV, tri, triRegion, masks, extra, si, sw };
}

/** Appends baked sheets to a baked body; triangles re-sorted into contiguous region groups. */
export function mergeSheets(body, sh, REGIONS) {
  const nb = body.positions.length / 3, ns = sh.P.length, n = nb + ns;
  const out = {
    positions: new Float32Array(n * 3), normals: new Float32Array(n * 3), chart: new Uint8Array(n), uv: new Float32Array(n * 2),
    masks: new Uint8Array(n * 4), extra: new Uint8Array(n * 4), skinIndex: new Uint8Array(n * 4), skinWeight: new Uint8Array(n * 4),
    stats: { ...body.stats, sheetVerts: ns, sheetTris: sh.tri.length / 3 },
  };
  out.positions.set(body.positions); out.normals.set(body.normals); out.chart.set(body.chart);
  out.masks.set(body.masks); out.extra.set(body.extra); out.skinIndex.set(body.skinIndex); out.skinWeight.set(body.skinWeight);
  for (let v = 0; v < ns; v++) {
    const o = nb + v;
    for (let k = 0; k < 3; k++) { out.positions[o * 3 + k] = sh.P[v][k]; out.normals[o * 3 + k] = sh.N[v][k]; }
    out.chart[o] = 3;
    out.uv[o * 2] = Math.max(0, Math.min(1, sh.UV[v][0])); out.uv[o * 2 + 1] = Math.max(0, Math.min(1, sh.UV[v][1]));
    for (let k = 0; k < 4; k++) {
      out.masks[o * 4 + k] = sh.masks[v * 4 + k]; out.extra[o * 4 + k] = sh.extra[v * 4 + k];
      out.skinIndex[o * 4 + k] = sh.si[v * 4 + k]; out.skinWeight[o * 4 + k] = sh.sw[v * 4 + k];
    }
  }
  // triangles of both, grouped by region
  const tris = [];
  for (const g of body.groups) {
    const r = REGIONS.indexOf(g.region);
    for (let k = g.start; k < g.start + g.count; k += 3) tris.push([r, body.indices[k], body.indices[k + 1], body.indices[k + 2]]);
  }
  for (let t = 0; t < sh.triRegion.length; t++) tris.push([sh.triRegion[t], sh.tri[t * 3] + nb, sh.tri[t * 3 + 1] + nb, sh.tri[t * 3 + 2] + nb]);
  tris.sort((a, b) => a[0] - b[0]);
  out.indices = new Uint32Array(tris.length * 3);
  out.groups = [];
  tris.forEach((t, k) => {
    out.indices[k * 3] = t[1]; out.indices[k * 3 + 1] = t[2]; out.indices[k * 3 + 2] = t[3];
    const region = REGIONS[t[0]];
    if (!out.groups.length || out.groups[out.groups.length - 1].region !== region) out.groups.push({ region, start: k * 3, count: 0 });
    out.groups[out.groups.length - 1].count += 3;
  });
  return out;
}
