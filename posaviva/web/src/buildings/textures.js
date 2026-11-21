// Procedural, tileable facade / roof textures (CanvasTexture, generated lazily
// the first time a material needs them, then cached for the session).
//
// Every texture is a luminance-like pattern around 1.0 that MULTIPLIES the
// material color (so the user color picker tints brick, plaster, roof tiles…),
// plus a tangent-space normal map derived from a height field. A few textures
// carry baked colors (window interiors, signs, awnings, curtain walls) and are
// used with a light material color.
//
// UVs are in meters (see kit.js): `TEX[id].size` is the world size of one tile.
import * as THREE from 'three';

// ---------------------------------------------------------------- noise helpers
function rngOf(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash2 = (a, b) => {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Periodic value noise, cx × cy cells over an N × N tile (values 0..1). */
function vnoise(N, cx, cy, rnd) {
  const L = new Float32Array(cx * cy);
  for (let i = 0; i < L.length; i++) L[i] = rnd();
  const out = new Float32Array(N * N);
  const fx = new Float32Array(N), ix0 = new Int32Array(N), ix1 = new Int32Array(N);
  for (let x = 0; x < N; x++) {
    const g = (x * cx) / N, i = Math.floor(g), f = g - i;
    fx[x] = f * f * (3 - 2 * f); ix0[x] = i % cx; ix1[x] = (i + 1) % cx;
  }
  for (let y = 0; y < N; y++) {
    const g = (y * cy) / N, j = Math.floor(g), f0 = g - j, fy = f0 * f0 * (3 - 2 * f0);
    const r0 = (j % cy) * cx, r1 = ((j + 1) % cy) * cx;
    for (let x = 0; x < N; x++) {
      const a = L[r0 + ix0[x]], b = L[r0 + ix1[x]], c = L[r1 + ix0[x]], d = L[r1 + ix1[x]];
      const top = a + (b - a) * fx[x], bot = c + (d - c) * fx[x];
      out[y * N + x] = top + (bot - top) * fy;
    }
  }
  return out;
}

/** Fractal sum of periodic value noise, normalized to ~0..1. Anisotropy: ax/ay multiply the cell counts. */
function fbm(N, base, oct, rnd, { ax = 1, ay = 1, gain = 0.5 } = {}) {
  const out = new Float32Array(N * N);
  let amp = 1, tot = 0, c = base;
  for (let o = 0; o < oct; o++) {
    const n = vnoise(N, Math.max(1, Math.round(c * ax)), Math.max(1, Math.round(c * ay)), rnd);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp; amp *= gain; c *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

/** Periodic jittered Voronoi: returns {f1, f2, id} per pixel. gx × gy cells. */
function voronoi(N, gx, gy, rnd, jitter = 0.85) {
  const px = new Float32Array(gx * gy), py = new Float32Array(gx * gy);
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    px[j * gx + i] = (i + 0.5 + (rnd() - 0.5) * jitter) / gx;
    py[j * gx + i] = (j + 0.5 + (rnd() - 0.5) * jitter) / gy;
  }
  const f1 = new Float32Array(N * N), f2 = new Float32Array(N * N), id = new Int32Array(N * N);
  // distances in "cell units" so stones keep their aspect when gx != gy
  for (let y = 0; y < N; y++) {
    const v = (y + 0.5) / N, cj = Math.floor(v * gy);
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, ci = Math.floor(u * gx);
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (ci + di + gx) % gx, jj = (cj + dj + gy) % gy, k = jj * gx + ii;
        let dx = (px[k] + (ci + di - ii) / gx - u) * gx, dy = (py[k] + (cj + dj - jj) / gy - v) * gy;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
      }
      const p = y * N + x;
      f1[p] = Math.sqrt(d1); f2[p] = Math.sqrt(d2); id[p] = best;
    }
  }
  return { f1, f2, id };
}

// ---------------------------------------------------------------- generator context
class Ctx {
  constructor(N, seed, wear) {
    this.N = N;
    this.rnd = rngOf(seed);
    this.wear = wear;
    this.H = new Float32Array(N * N);
    this.R = new Float32Array(N * N).fill(1);
    this.G = new Float32Array(N * N).fill(1);
    this.B = new Float32Array(N * N).fill(1);
  }
  gray(p, v) { this.R[p] = v; this.G[p] = v; this.B[p] = v; }
  rgb(p, r, g, b) { this.R[p] = r; this.G[p] = g; this.B[p] = b; }
  mul(p, k) { this.R[p] *= k; this.G[p] *= k; this.B[p] *= k; }
}

/**
 * Masonry courses: rows × cols blocks per tile (cols may vary per row with jitter),
 * running bond offset, mortar and bevel in pixels. Calls shade(p, info) per pixel.
 */
function masonry(c, { rows, cols, mortar = 2, bevel = 2, bond = 0.5, jitter = 0, rowJitter = 0, depth = 1, mortarH = 0 }, shade) {
  const { N, rnd } = c;
  // row boundaries (optionally irregular heights)
  const ry = [0];
  for (let r = 1; r < rows; r++) ry.push(((r + (rnd() - 0.5) * rowJitter) / rows) * N);
  ry.push(N);
  // per row: block cut positions
  const cuts = [];
  for (let r = 0; r < rows; r++) {
    const off = jitter > 0 ? rnd() * N : (r % 2) * bond * (N / cols);
    const xs = [];
    for (let k = 0; k < cols; k++) xs.push(off + ((k + (k ? (rnd() - 0.5) * jitter : 0)) / cols) * N);
    cuts.push(xs);
  }
  for (let r = 0; r < rows; r++) {
    const y0 = ry[r], y1 = ry[r + 1];
    const xs = cuts[r];
    for (let y = Math.floor(y0); y < Math.min(N, Math.ceil(y1)); y++) {
      const dy = Math.min(y + 0.5 - y0, y1 - (y + 0.5));
      for (let x = 0; x < N; x++) {
        // block index along the row (wrapping cut list)
        let xx = x + 0.5 - xs[0];
        xx = ((xx % N) + N) % N;
        let k = 0;
        while (k + 1 < xs.length && xx >= xs[k + 1] - xs[0]) k++;
        const xa = xs[k] - xs[0], xb = k + 1 < xs.length ? xs[k + 1] - xs[0] : N;
        const dx = Math.min(xx - xa, xb - xx);
        const e = Math.min(dx, dy);
        const p = y * N + x;
        const inMortar = e < mortar / 2;
        const t = inMortar ? 0 : bevel > 0 ? smooth(0, bevel, e - mortar / 2) : 1;
        c.H[p] = inMortar ? mortarH : mortarH + (1 - mortarH) * t * depth;
        shade(p, { mortar: inMortar, id: hash2(r * 131 + 7, k * 17 + 3), row: r, col: k, edge: e - mortar / 2, t, u: (xx - xa) / Math.max(1, xb - xa), v: (y + 0.5 - y0) / Math.max(1, y1 - y0) });
      }
    }
  }
}

// ---------------------------------------------------------------- generators
// Each gen(c) writes c.H (height 0..1) and c.R/G/B (multipliers ~0..1.1).
const GEN = {
  plaster(c) {
    const { N, rnd } = c;
    const lo = fbm(N, 3, 4, rnd), grain = fbm(N, 64, 2, rnd), mid = fbm(N, 12, 3, rnd);
    for (let p = 0; p < N * N; p++) {
      c.H[p] = grain[p] * 0.55 + mid[p] * 0.45;
      c.gray(p, 0.9 + (lo[p] - 0.5) * 0.1 + (grain[p] - 0.5) * 0.05);
    }
  },
  stucco(c) {
    const { N, rnd } = c;
    const lo = fbm(N, 4, 4, rnd), grain = fbm(N, 48, 3, rnd, { gain: 0.65 });
    for (let p = 0; p < N * N; p++) {
      c.H[p] = grain[p];
      c.gray(p, 0.84 + (lo[p] - 0.5) * 0.16 + (grain[p] - 0.5) * 0.14);
    }
  },
  brick(c) {
    const n = fbm(c.N, 32, 3, c.rnd), lo = fbm(c.N, 4, 3, c.rnd);
    masonry(c, { rows: 28, cols: 8, mortar: 3.2, bevel: 2.2, bond: 0.5 }, (p, b) => {
      if (b.mortar) { c.rgb(p, 1.0, 1.0, 1.0); c.H[p] = 0.05 + n[p] * 0.1; return; }
      const v = 0.7 + (b.id - 0.5) * 0.28 + (n[p] - 0.5) * 0.12 + (lo[p] - 0.5) * 0.08 - (b.id > 0.93 ? 0.18 : 0);
      const h = hash2(b.row, b.col * 3 + 1) - 0.5;
      c.rgb(p, v * (1 + h * 0.08), v, v * (1 - h * 0.1));
      c.H[p] += (n[p] - 0.5) * 0.25;
    });
  },
  stone(c) { // ashlar: large regular blocks
    const n = fbm(c.N, 24, 4, c.rnd), lo = fbm(c.N, 3, 3, c.rnd);
    masonry(c, { rows: 6, cols: 4, mortar: 2.5, bevel: 3, bond: 0.5, jitter: 0.35 }, (p, b) => {
      if (b.mortar) { c.gray(p, 0.72); return; }
      c.gray(p, 0.86 + (b.id - 0.5) * 0.14 + (n[p] - 0.5) * 0.14 + (lo[p] - 0.5) * 0.06);
      c.H[p] = c.H[p] * 0.85 + n[p] * 0.15;
    });
  },
  bugnato(c) { // rusticated base: deep chamfered joints
    const n = fbm(c.N, 24, 4, c.rnd);
    masonry(c, { rows: 5, cols: 2, mortar: 4, bevel: 14, bond: 0.5 }, (p, b) => {
      if (b.mortar) { c.gray(p, 0.55); return; }
      c.gray(p, (0.84 + (b.id - 0.5) * 0.1 + (n[p] - 0.5) * 0.12) * (0.82 + 0.18 * b.t));
    });
  },
  rubble(c) { // irregular field stones in lime mortar
    const { N, rnd } = c;
    const vo = voronoi(N, 9, 12, rnd), n = fbm(N, 32, 4, rnd), lo = fbm(N, 4, 3, rnd);
    for (let p = 0; p < N * N; p++) {
      const e = vo.f2[p] - vo.f1[p];
      const t = smooth(0.08, 0.35, e);
      const id = hash2(vo.id[p], 5);
      c.H[p] = t * (0.75 + n[p] * 0.25);
      if (t < 0.02) c.gray(p, 0.92 + (n[p] - 0.5) * 0.1);
      else {
        const v = (0.62 + id * 0.34 + (n[p] - 0.5) * 0.2 + (lo[p] - 0.5) * 0.08) * (0.75 + 0.25 * t);
        const hue = hash2(vo.id[p], 9) - 0.5;
        c.rgb(p, v * (1 + hue * 0.12), v, v * (1 - hue * 0.16));
      }
    }
  },
  castle(c) { // rough cut blocks of irregular size
    const n = fbm(c.N, 28, 4, c.rnd, { gain: 0.6 });
    masonry(c, { rows: 7, cols: 4, mortar: 3, bevel: 5, jitter: 0.6, rowJitter: 0.5 }, (p, b) => {
      if (b.mortar) { c.gray(p, 0.62); return; }
      const v = 0.72 + (b.id - 0.5) * 0.3 + (n[p] - 0.5) * 0.22;
      const hue = hash2(b.row * 3, b.col) - 0.5;
      c.rgb(p, v * (1 + hue * 0.08), v, v * (1 - hue * 0.12));
      c.H[p] = c.H[p] * 0.7 + n[p] * 0.3 * b.t;
    });
  },
  concrete(c) {
    const { N, rnd } = c;
    const lo = fbm(N, 4, 4, rnd), sp = fbm(N, 96, 2, rnd), mid = fbm(N, 16, 3, rnd);
    const rows = 4, cols = 2, rh = N / rows, cw = N / cols;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const p = y * N + x;
      let v = 0.86 + (lo[p] - 0.5) * 0.12 + (mid[p] - 0.5) * 0.06 + (sp[p] > 0.78 ? -0.08 : 0);
      let h = 0.5 + (sp[p] - 0.5) * 0.3;
      const jy = Math.min(y % rh, rh - (y % rh)), jx = Math.min(x % cw, cw - (x % cw));
      if (jy < 1.2 || jx < 1.2) { v -= 0.12; h = 0.25; }
      // form-tie holes
      for (const [hx, hy] of [[cw * 0.2, rh * 0.5], [cw * 0.8, rh * 0.5]]) {
        const dx = (x % cw) - hx, dy = (y % rh) - hy, d = Math.hypot(dx, dy);
        if (d < 4) { v -= 0.25 * (1 - d / 4); h = 0.1 + d / 16; }
      }
      c.gray(p, v); c.H[p] = h;
    }
  },
  precast(c) { // large industrial panels, one panel per tile
    const { N, rnd } = c;
    const lo = fbm(N, 3, 4, rnd), sp = fbm(N, 80, 2, rnd);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const p = y * N + x;
      const j = Math.min(x, N - 1 - x) < 2.5 || Math.min(y, N - 1 - y) < 1.5;
      c.gray(p, j ? 0.58 : 0.88 + (lo[p] - 0.5) * 0.1 + (sp[p] - 0.5) * 0.06);
      c.H[p] = j ? 0 : 0.6 + sp[p] * 0.2;
    }
  },
  klinker(c) { // 1960s ceramic strip tiles, stack bond
    const n = fbm(c.N, 40, 2, c.rnd);
    masonry(c, { rows: 20, cols: 5, mortar: 2.4, bevel: 1.2, bond: 0 }, (p, b) => {
      if (b.mortar) { c.gray(p, 1.08); return; }
      c.gray(p, 0.82 + (b.id - 0.5) * 0.12 + (n[p] - 0.5) * 0.05);
    });
  },
  wood(c) { // horizontal lap siding
    const { N, rnd } = c;
    const grain = fbm(N, 6, 4, rnd, { ax: 1, ay: 12 }), lo = fbm(N, 4, 2, rnd);
    const boards = 10, bh = N / boards;
    for (let y = 0; y < N; y++) {
      const k = Math.floor(y / bh), t = (y - k * bh) / bh;
      for (let x = 0; x < N; x++) {
        const p = y * N + x, sh = hash2(k, 3) - 0.5;
        c.H[p] = 0.25 + 0.75 * t;
        const v = (0.8 + sh * 0.12 + (grain[p] - 0.5) * 0.22 + (lo[p] - 0.5) * 0.05) * (t < 0.08 ? 0.72 : 1);
        c.rgb(p, v * 1.02, v, v * 0.97);
      }
    }
  },
  woodV(c) { // vertical planks with gaps
    const { N, rnd } = c;
    const grain = fbm(N, 6, 4, rnd, { ax: 12, ay: 1 }), knots = fbm(N, 24, 2, rnd);
    const planks = 8, pw = N / planks;
    for (let x = 0; x < N; x++) {
      const k = Math.floor(x / pw), t = (x - k * pw) / pw, gap = t < 0.035 || t > 0.985;
      for (let y = 0; y < N; y++) {
        const p = y * N + x, sh = hash2(k, 11) - 0.5;
        c.H[p] = gap ? 0 : 0.8 + (grain[p] - 0.5) * 0.3;
        let v = gap ? 0.28 : 0.78 + sh * 0.16 + (grain[p] - 0.5) * 0.25;
        if (!gap && knots[p] > 0.8) v *= 0.75;
        c.rgb(p, v * 1.02, v, v * 0.96);
      }
    }
  },
  logs(c) { // horizontal round logs with light chinking
    const { N, rnd } = c;
    const grain = fbm(N, 5, 4, rnd, { ax: 1, ay: 14 });
    const n = 6, lh = N / n;
    for (let y = 0; y < N; y++) {
      const k = Math.floor(y / lh), t = ((y - k * lh) / lh) * 2 - 1;
      const prof = Math.sqrt(Math.max(0, 1 - t * t));
      for (let x = 0; x < N; x++) {
        const p = y * N + x, sh = hash2(k, 21) - 0.5;
        if (prof < 0.3) { c.gray(p, 0.86); c.H[p] = 0.15; continue; }
        c.H[p] = prof;
        const v = (0.74 + sh * 0.14 + (grain[p] - 0.5) * 0.22) * (0.65 + 0.35 * prof);
        c.rgb(p, v * 1.03, v, v * 0.95);
      }
    }
  },
  tiles(c) { // Italian clay roof tiles (coppi): convex rows, overlapping courses
    const { N, rnd } = c;
    const n = fbm(N, 32, 3, rnd), lo = fbm(N, 4, 3, rnd);
    const cols = 9, rows = 4, cw = N / cols, rh = N / rows;
    for (let y = 0; y < N; y++) {
      const r = Math.floor(y / rh), t = (y - r * rh) / rh;
      for (let x = 0; x < N; x++) {
        const xo = x + (r % 2) * cw * 0.5;
        const k = Math.floor(xo / cw) % cols, s = (xo % cw) / cw;
        const bump = Math.pow(Math.sin(Math.PI * s), 0.6);
        const p = y * N + x;
        c.H[p] = 0.55 * bump + 0.45 * t;
        const id = hash2(r * 13 + k, 77);
        let v = (0.78 + (id - 0.5) * 0.36 + (n[p] - 0.5) * 0.12 + (lo[p] - 0.5) * 0.1) * (0.62 + 0.38 * bump);
        if (t < 0.1) v *= 0.55 + t * 4.5;
        c.rgb(p, v, v * (0.96 + (id - 0.5) * 0.08), v * (0.92 + (id - 0.5) * 0.1));
      }
    }
  },
  slate(c) { // shingles / slate
    const n = fbm(c.N, 40, 3, c.rnd);
    masonry(c, { rows: 8, cols: 6, mortar: 2, bevel: 0, bond: 0.5, jitter: 0.25 }, (p, b) => {
      c.H[p] = b.mortar ? 0 : 0.3 + 0.7 * b.v;
      const v = b.mortar ? 0.45 : (0.78 + (b.id - 0.5) * 0.3 + (n[p] - 0.5) * 0.12) * (b.v < 0.08 ? 0.7 : 1);
      c.gray(p, v);
    });
  },
  seam(c) { // standing seam metal (ribs along the slope = constant u)
    const { N, rnd } = c;
    const lo = fbm(N, 4, 3, rnd, { ax: 1, ay: 4 });
    const ribs = 4, w = N / ribs;
    for (let x = 0; x < N; x++) {
      const d = Math.abs((x % w) - w / 2) / (w / 2); // 0 at rib
      const rib = 1 - smooth(0, 0.06, 1 - d);
      for (let y = 0; y < N; y++) {
        const p = y * N + x;
        c.H[p] = d > 0.94 ? 1 : 0.3 + lo[p] * 0.08;
        c.gray(p, 0.9 + (lo[p] - 0.5) * 0.08 - rib * 0.0);
      }
    }
  },
  corrugated(c) {
    const { N, rnd } = c;
    const lo = fbm(N, 4, 3, rnd);
    const waves = 16;
    for (let x = 0; x < N; x++) {
      const s = Math.sin((x / N) * waves * Math.PI * 2);
      for (let y = 0; y < N; y++) {
        const p = y * N + x;
        c.H[p] = 0.5 + 0.5 * s;
        c.gray(p, 0.88 + 0.06 * s + (lo[p] - 0.5) * 0.06);
      }
    }
  },
  membrane(c) { // flat roof: bitumen membrane with roll overlaps + gravel speckle
    const { N, rnd } = c;
    const sp = fbm(N, 128, 2, rnd), lo = fbm(N, 4, 3, rnd);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const p = y * N + x;
      const seam = (y % (N / 4)) < 2;
      c.gray(p, (0.8 + (sp[p] - 0.5) * 0.3 + (lo[p] - 0.5) * 0.12) * (seam ? 0.8 : 1));
      c.H[p] = seam ? 0.9 : sp[p] * 0.5;
    }
  },
  paving(c) { // square concrete slabs (sidewalks, plazas)
    const n = fbm(c.N, 40, 3, c.rnd), lo = fbm(c.N, 4, 3, c.rnd);
    masonry(c, { rows: 6, cols: 6, mortar: 2, bevel: 1, bond: 0 }, (p, b) => {
      c.gray(p, b.mortar ? 0.6 : 0.86 + (b.id - 0.5) * 0.1 + (n[p] - 0.5) * 0.08 + (lo[p] - 0.5) * 0.08);
    });
  },
  marble(c) {
    const { N, rnd } = c;
    const w = fbm(N, 4, 5, rnd, { gain: 0.6 }), n = fbm(N, 32, 2, rnd);
    masonry(c, { rows: 5, cols: 2, mortar: 1.6, bevel: 1, bond: 0.5 }, (p, b) => {
      const x = p % N, y = (p / N) | 0;
      const vein = Math.abs(Math.sin((x * 0.012 + y * 0.02 + w[p] * 9 + b.id * 3) * Math.PI));
      const v = 0.95 + (n[p] - 0.5) * 0.04 - Math.pow(1 - vein, 14) * 0.25 - (b.id - 0.5) * 0.04;
      c.rgb(p, v, v * 0.995, v * 0.98);
      if (b.mortar) c.mul(p, 0.85);
    });
  },
  travertine(c) {
    const { N, rnd } = c;
    const st = fbm(N, 4, 4, rnd, { ax: 1, ay: 10 }), pores = fbm(N, 96, 1, rnd);
    masonry(c, { rows: 4, cols: 2, mortar: 1.6, bevel: 1, bond: 0.5 }, (p, b) => {
      let v = 0.9 + (st[p] - 0.5) * 0.14 + (b.id - 0.5) * 0.05;
      if (pores[p] > 0.86) { v -= 0.08; c.H[p] *= 0.75; }
      c.rgb(p, v * 1.01, v, v * 0.95);
      if (b.mortar) c.mul(p, 0.85);
    });
  },
  louver(c) { // shutter slats (persiane)
    const { N } = c;
    const slats = 10, sh = N / slats;
    for (let y = 0; y < N; y++) {
      const t = (y % sh) / sh;
      for (let x = 0; x < N; x++) {
        const p = y * N + x;
        c.H[p] = 0.2 + 0.8 * t;
        c.gray(p, t < 0.12 ? 0.45 : 0.82 + 0.18 * t);
      }
    }
  },
  rolling(c) { // roller shutter slats (tapparelle)
    const { N } = c;
    const slats = 10, sh = N / slats;
    for (let y = 0; y < N; y++) {
      const t = (y % sh) / sh, prof = Math.sin(Math.PI * t);
      for (let x = 0; x < N; x++) {
        const p = y * N + x;
        c.H[p] = prof;
        c.gray(p, t < 0.06 || t > 0.95 ? 0.55 : 0.85 + 0.12 * prof);
      }
    }
  },
  panels(c) { // sectional / roll-up door
    const { N, rnd } = c;
    const lo = fbm(N, 4, 2, rnd);
    for (let y = 0; y < N; y++) {
      const t = (y % (N / 4)) / (N / 4), r = (y % (N / 32)) / (N / 32);
      for (let x = 0; x < N; x++) {
        const p = y * N + x;
        const groove = t < 0.03;
        c.H[p] = groove ? 0 : 0.6 + 0.15 * Math.sin(Math.PI * r);
        c.gray(p, groove ? 0.5 : 0.9 + (lo[p] - 0.5) * 0.05 - 0.03 * (1 - Math.sin(Math.PI * r)));
      }
    }
  },
  asphalt(c) {
    const { N, rnd } = c;
    const sp = fbm(N, 128, 2, rnd), lo = fbm(N, 4, 4, rnd), st = fbm(N, 10, 3, rnd);
    for (let p = 0; p < N * N; p++) {
      c.gray(p, 0.86 + (sp[p] - 0.5) * 0.35 + (lo[p] - 0.5) * 0.12 - (st[p] > 0.72 ? 0.12 : 0));
      c.H[p] = sp[p];
    }
  },
  shoji(c) { // rice paper with a dark wooden lattice (baked colors)
    const { N, rnd } = c;
    const fib = fbm(N, 64, 2, rnd, { ax: 1, ay: 3 });
    const cx = 3, cy = 4;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const p = y * N + x;
      const gx = Math.min((x % (N / cx)), (N / cx) - (x % (N / cx))), gy = Math.min((y % (N / cy)), (N / cy) - (y % (N / cy)));
      if (gx < 4 || gy < 4) { c.rgb(p, 0.24, 0.17, 0.12); c.H[p] = 1; }
      else { const v = 0.95 + (fib[p] - 0.5) * 0.06; c.rgb(p, v, v * 0.98, v * 0.92); c.H[p] = 0.3; }
    }
  },
};

/** Generic dirt / weathering overlays (wear 1 = lived-in, 2 = run-down). */
function applyWear(c, family) {
  const k = c.wear;
  if (!k || family === 'none') return;
  const { N, rnd } = c;
  const grime = fbm(N, 3, 4, rnd), streak = fbm(N, 24, 3, rnd, { ax: 1.6, ay: 0.12 }), patch = fbm(N, 3, 5, rnd, { gain: 0.55 });
  const crack = k > 1 ? fbm(N, 6, 5, rnd, { gain: 0.6 }) : null;
  for (let p = 0; p < N * N; p++) {
    let d = Math.max(0, grime[p] - 0.42) * 0.35 * k + Math.max(0, streak[p] - 0.5) * 0.35 * k;
    if (family === 'roof') {
      // moss / lichen
      const m = smooth(0.55, 0.7, patch[p]) * 0.5 * k;
      c.R[p] *= 1 - m * 0.45; c.G[p] *= 1 - m * 0.2; c.B[p] *= 1 - m * 0.55;
    } else if (family === 'metal') {
      const r = smooth(0.52, 0.75, streak[p]) * 0.5 * k;
      c.R[p] *= 1 - r * 0.15; c.G[p] *= 1 - r * 0.4; c.B[p] *= 1 - r * 0.6;
    } else if (k > 1 && family === 'wall') {
      // fallen plaster: recessed patches with an earthy tone
      const m = smooth(0.66, 0.69, patch[p]);
      if (m > 0) { c.H[p] = c.H[p] * (1 - m) + (c.H[p] * 0.4 - 0.5) * m; c.R[p] *= 1 - m * 0.18; c.G[p] *= 1 - m * 0.3; c.B[p] *= 1 - m * 0.38; }
      // hairline cracks
      const cr = Math.abs(crack[p] - 0.5);
      if (cr < 0.006) { d += 0.25; c.H[p] -= 0.4; }
    }
    if (family === 'stone' && k > 1) {
      // efflorescence
      const e = smooth(0.7, 0.78, patch[p]) * 0.25;
      c.R[p] += e; c.G[p] += e; c.B[p] += e;
    }
    c.mul(p, 1 - Math.min(0.55, d));
  }
}

// ---------------------------------------------------------------- texture table
/**
 * size: tile size in meters [u, v]; res: pixels; family: wear overlay kind;
 * normal: normal-map strength (slope of the height field per pixel), roughness hint.
 */
export const TEX = {
  plaster: { size: [4, 4], res: 512, family: 'wall', normal: 0.6 },
  stucco: { size: [3, 3], res: 512, family: 'wall', normal: 1.5 },
  brick: { size: [2.1, 2.1], res: 512, family: 'stone', normal: 3.2 },
  stone: { size: [2.4, 2.4], res: 512, family: 'stone', normal: 3 },
  bugnato: { size: [2.4, 2.4], res: 512, family: 'stone', normal: 4.5 },
  rubble: { size: [2.4, 2.4], res: 512, family: 'stone', normal: 4 },
  castle: { size: [3, 3], res: 512, family: 'stone', normal: 3.5 },
  concrete: { size: [2.4, 2.4], res: 512, family: 'wall', normal: 2 },
  precast: { size: [3, 3], res: 256, family: 'wall', normal: 3 },
  klinker: { size: [1.2, 1.2], res: 512, family: 'stone', normal: 2.4 },
  wood: { size: [1.8, 1.8], res: 512, family: 'wood', normal: 2.6 },
  woodV: { size: [1.6, 1.6], res: 512, family: 'wood', normal: 2.6 },
  logs: { size: [1.5, 1.5], res: 512, family: 'wood', normal: 3.4 },
  tiles: { size: [1.6, 1.6], res: 512, family: 'roof', normal: 4 },
  slate: { size: [1.6, 1.6], res: 512, family: 'roof', normal: 3 },
  seam: { size: [1.8, 1.8], res: 256, family: 'metal', normal: 6 },
  corrugated: { size: [1.2, 1.2], res: 256, family: 'metal', normal: 3 },
  membrane: { size: [4, 4], res: 512, family: 'roof', normal: 1.6 },
  paving: { size: [2.4, 2.4], res: 512, family: 'stone', normal: 2.4 },
  marble: { size: [3, 3], res: 512, family: 'none', normal: 1.6 },
  travertine: { size: [2.4, 2.4], res: 512, family: 'stone', normal: 1.6 },
  louver: { size: [0.5, 0.5], res: 128, family: 'none', normal: 3 },
  rolling: { size: [0.45, 0.45], res: 128, family: 'none', normal: 2.4 },
  panels: { size: [2, 2], res: 256, family: 'none', normal: 3 },
  asphalt: { size: [4, 4], res: 512, family: 'none', normal: 1.2 },
  shoji: { size: [0.9, 0.9], res: 256, family: 'none', normal: 1.5 },
};

const cache = new Map();

function toTextures(c, def) {
  const N = c.N, n = N * N;
  const can = document.createElement('canvas');
  can.width = can.height = N;
  const g = can.getContext('2d');
  const img = g.createImageData(N, N), d = img.data;
  for (let p = 0, q = 0; p < n; p++, q += 4) {
    d[q] = Math.min(255, Math.max(0, c.R[p] * 255));
    d[q + 1] = Math.min(255, Math.max(0, c.G[p] * 255));
    d[q + 2] = Math.min(255, Math.max(0, c.B[p] * 255));
    d[q + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(can);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  let normalMap = null;
  if (def.normal) {
    const can2 = document.createElement('canvas');
    can2.width = can2.height = N;
    const g2 = can2.getContext('2d');
    const im2 = g2.createImageData(N, N), e = im2.data, H = c.H, s = def.normal;
    for (let y = 0; y < N; y++) {
      const ym = ((y - 1 + N) % N) * N, yp = ((y + 1) % N) * N, yr = y * N;
      for (let x = 0; x < N; x++) {
        const xm = (x - 1 + N) % N, xp = (x + 1) % N;
        const nx = (H[yr + xm] - H[yr + xp]) * 0.5 * s, ny = (H[yp + x] - H[ym + x]) * 0.5 * s;
        const il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        const q = (yr + x) * 4;
        e[q] = (nx * il * 0.5 + 0.5) * 255; e[q + 1] = (ny * il * 0.5 + 0.5) * 255; e[q + 2] = (il * 0.5 + 0.5) * 255; e[q + 3] = 255;
      }
    }
    g2.putImageData(im2, 0, 0);
    normalMap = new THREE.CanvasTexture(can2);
    normalMap.colorSpace = THREE.NoColorSpace;
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.anisotropy = 4;
  }
  return { map, normalMap };
}

/** {map, normalMap} for a texture id and wear level (0..2). Generated on first use. */
export function getTex(id, wear = 0) {
  const def = TEX[id];
  if (!def) return null;
  const w = def.family === 'none' ? 0 : Math.max(0, Math.min(2, wear | 0));
  const key = `${id}|${w}`;
  let t = cache.get(key);
  if (t) return t;
  const c = new Ctx(def.res, 1000 + Object.keys(TEX).indexOf(id) * 97, w);
  GEN[id](c);
  applyWear(c, def.family);
  t = toTextures(c, def);
  // the clean and lived-in levels share the height field (wear 1 only stains)
  if (w === 1) { const t0 = cache.get(`${id}|0`); if (t0?.normalMap) { t.normalMap.dispose(); t.normalMap = t0.normalMap; } }
  cache.set(key, t);
  return t;
}

// ---------------------------------------------------------------- baked atlases
const atlasCache = new Map();
function canvasTex(can, srgb = true) {
  const t = new THREE.CanvasTexture(can);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Window interiors (4 × 4 cells): a dark room seen through glass, with curtains,
 * blinds, a lamp or furniture silhouettes and a soft sky reflection. `lit` = the
 * same rooms at night with warm lights on (used as emissive map).
 */
export function glassAtlas(lit = false) {
  const key = lit ? 'glassLit' : 'glass';
  if (atlasCache.has(key)) return atlasCache.get(key);
  const S = 512, C = 4, cs = S / C;
  const can = document.createElement('canvas');
  can.width = can.height = S;
  const g = can.getContext('2d');
  const rnd = rngOf(lit ? 4242 : 4241);
  for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) {
    const x0 = i * cs, y0 = j * cs;
    g.save();
    g.beginPath(); g.rect(x0, y0, cs, cs); g.clip();
    const warm = lit ? [255, 196 + rnd() * 40, 120 + rnd() * 50] : null;
    // room depth: back wall and floor
    const back = lit ? `rgb(${warm[0] * 0.75 | 0},${warm[1] * 0.68 | 0},${warm[2] * 0.6 | 0})` : `rgb(${46 + rnd() * 30 | 0},${50 + rnd() * 26 | 0},${56 + rnd() * 22 | 0})`;
    g.fillStyle = back; g.fillRect(x0, y0, cs, cs);
    const gr = g.createLinearGradient(0, y0, 0, y0 + cs);
    gr.addColorStop(0, lit ? 'rgba(255,240,200,0.35)' : 'rgba(0,0,0,0.25)');
    gr.addColorStop(0.7, 'rgba(0,0,0,0)');
    gr.addColorStop(1, lit ? 'rgba(60,30,10,0.35)' : 'rgba(0,0,0,0.35)');
    g.fillStyle = gr; g.fillRect(x0, y0, cs, cs);
    // furniture silhouettes / frames on the back wall
    const kind = Math.floor(rnd() * 5);
    g.fillStyle = lit ? 'rgba(70,40,20,0.55)' : 'rgba(18,20,24,0.55)';
    if (kind === 0) g.fillRect(x0 + cs * 0.15, y0 + cs * 0.62, cs * 0.5, cs * 0.38); // sofa / cabinet
    if (kind === 1) { g.fillRect(x0 + cs * 0.55, y0 + cs * 0.3, cs * 0.3, cs * 0.7); g.fillRect(x0 + cs * 0.1, y0 + cs * 0.75, cs * 0.3, cs * 0.25); }
    if (kind === 2) { g.fillStyle = lit ? 'rgba(255,250,230,0.7)' : 'rgba(120,130,140,0.35)'; g.fillRect(x0 + cs * 0.3, y0 + cs * 0.25, cs * 0.25, cs * 0.18); }
    if (kind === 3 && lit) { const r = g.createRadialGradient(x0 + cs * 0.5, y0 + cs * 0.15, 2, x0 + cs * 0.5, y0 + cs * 0.15, cs * 0.6); r.addColorStop(0, 'rgba(255,250,220,0.9)'); r.addColorStop(1, 'rgba(255,220,160,0)'); g.fillStyle = r; g.fillRect(x0, y0, cs, cs); }
    // curtains or blinds
    const cur = rnd();
    if (cur < 0.45) {
      const CUR = ['#e8e4dc', '#d9d2c2', '#c9c2b0', '#f2efe8', '#b8b0a0', '#8a7d6b', '#e8e4dc', '#9a3b30', '#4a5f78'];
      const col = lit ? `rgba(${200 + rnd() * 55 | 0},${150 + rnd() * 60 | 0},${100 + rnd() * 60 | 0},0.9)` : CUR[Math.floor(rnd() * CUR.length)];
      g.fillStyle = col;
      const w = cs * (0.12 + rnd() * 0.18);
      g.fillRect(x0, y0, w, cs); g.fillRect(x0 + cs - w, y0, w, cs);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let k = 0; k < 6; k++) { g.fillRect(x0 + (k / 6) * w, y0, 2, cs); g.fillRect(x0 + cs - w + (k / 6) * w, y0, 2, cs); }
    } else if (cur < 0.75) {
      const down = cs * (0.15 + rnd() * 0.6);
      g.fillStyle = lit ? 'rgba(250,225,170,0.92)' : 'rgba(196,196,190,0.95)';
      g.fillRect(x0, y0, cs, down);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = y0 + 3; y < y0 + down; y += 5) g.fillRect(x0, y, cs, 1);
    } else if (cur < 0.88) {
      // sheer net curtain
      g.fillStyle = lit ? 'rgba(255,235,190,0.5)' : 'rgba(225,225,220,0.55)';
      g.fillRect(x0, y0, cs, cs);
    }
    // sky / opposite building reflection (day only): diagonal sheen
    if (!lit) {
      const rg = g.createLinearGradient(x0, y0, x0 + cs, y0 + cs);
      rg.addColorStop(0, 'rgba(200,220,240,0.34)'); rg.addColorStop(0.45, 'rgba(160,185,210,0.12)'); rg.addColorStop(1, 'rgba(255,255,255,0.0)');
      g.fillStyle = rg; g.fillRect(x0, y0, cs, cs);
    }
    g.restore();
  }
  const t = canvasTex(can);
  atlasCache.set(key, t);
  return t;
}

/**
 * Curtain-wall glazing: a tile of 8 modules × 4 floors (vision glass with
 * per-panel reflection variation, dark spandrels, light mullions). Luminance
 * pattern (tinted by the material color). `lit` gives the matching night
 * emissive map with random lit offices.
 */
export function curtainWall(lit = false) {
  const key = lit ? 'cwLit' : 'cw';
  if (atlasCache.has(key)) return atlasCache.get(key);
  const W = 512, Hh = 512, mx = 8, my = 4, cw = W / mx, ch = Hh / my;
  const can = document.createElement('canvas');
  can.width = W; can.height = Hh;
  const g = can.getContext('2d');
  const rnd = rngOf(lit ? 991 : 990);
  g.fillStyle = lit ? '#000' : '#888';
  g.fillRect(0, 0, W, Hh);
  for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
    const x0 = i * cw, y0 = j * ch;
    const spand = ch * 0.24; // spandrel band at the bottom of each floor
    if (lit) {
      const on = rnd() < 0.42;
      if (on) {
        const b = 0.55 + rnd() * 0.45;
        g.fillStyle = `rgb(${255 * b | 0},${(225 + rnd() * 30) * b | 0},${(170 + rnd() * 60) * b | 0})`;
        g.fillRect(x0 + 3, y0 + 3, cw - 6, ch - spand - 6);
      }
      continue;
    }
    const v = 0.46 + rnd() * 0.22;
    const gr = g.createLinearGradient(x0, y0, x0 + cw * 0.6, y0 + ch);
    gr.addColorStop(0, `rgb(${255 * (v + 0.16) | 0},${255 * (v + 0.17) | 0},${255 * (v + 0.18) | 0})`);
    gr.addColorStop(1, `rgb(${255 * v | 0},${255 * v | 0},${255 * (v + 0.02) | 0})`);
    g.fillStyle = gr;
    g.fillRect(x0, y0, cw, ch - spand);
    g.fillStyle = `rgb(${255 * 0.3 | 0},${255 * 0.31 | 0},${255 * 0.33 | 0})`;
    g.fillRect(x0, y0 + ch - spand, cw, spand);
    // mullions & transoms (light aluminium)
    g.fillStyle = '#e8e8e8';
    g.fillRect(x0, y0, 3, ch); g.fillRect(x0, y0 + ch - spand - 2, cw, 3); g.fillRect(x0, y0, cw, 2);
  }
  const t = canvasTex(can);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  atlasCache.set(key, t);
  return t;
}

/** Normal map of the curtain wall mullion grid (matches curtainWall()). */
export function curtainWallNormal() {
  if (atlasCache.has('cwN')) return atlasCache.get('cwN');
  const W = 512, Hh = 512, mx = 8, my = 4, cw = W / mx, ch = Hh / my;
  const can = document.createElement('canvas');
  can.width = W; can.height = Hh;
  const g = can.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, W, Hh);
  for (let i = 0; i < mx; i++) {
    g.fillStyle = 'rgb(70,128,230)'; g.fillRect(i * cw + 3, 0, 2, Hh); // right side of a mullion
    g.fillStyle = 'rgb(186,128,230)'; g.fillRect(i * cw - 2, 0, 2, Hh);
  }
  for (let j = 0; j < my; j++) {
    const y = j * ch + ch * 0.76;
    g.fillStyle = 'rgb(128,186,230)'; g.fillRect(0, y + 1, W, 2);
    g.fillStyle = 'rgb(128,70,230)'; g.fillRect(0, y - 3, W, 2);
  }
  const t = canvasTex(can, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  atlasCache.set('cwN', t);
  return t;
}

/** Shop / landmark signs: 4 × 8 cells of 256 × 64 px. Returns {tex, cells: Map(text -> [u0,v0,u1,v1])}. */
export const SIGNS = [
  ['BAR', '#1d3b5c', '#ffffff'], ['PIZZERIA', '#7a1f24', '#fff3d6'], ['FARMACIA', '#1f7a3a', '#ffffff'], ['PANETTERIA', '#c9a227', '#3a2214'],
  ['TABACCHI', '#1a1a1a', '#ffffff'], ['CAFFÈ', '#3a2214', '#f2e3c2'], ['RISTORANTE', '#2f4a6b', '#ffe9b0'], ['HOTEL', '#111111', '#e8c46a'],
  ['MACELLERIA', '#8b1d1d', '#ffffff'], ['GELATERIA', '#f2a6b8', '#5b1d33'], ['LIBRERIA', '#24412f', '#f0e6cf'], ['FIORI', '#4f6b3a', '#ffffff'],
  ['ALIMENTARI', '#e8e4dc', '#7a1f24'], ['TRATTORIA', '#6b4a2f', '#fff3d6'], ['BOUTIQUE', '#000000', '#d8c08a'], ['OTTICA', '#ffffff', '#1d3b5c'],
  ['BANCA', '#0f2a4a', '#ffffff'], ['CINEMA', '#7a1f24', '#ffd24a'], ['MERCATO', '#c0504d', '#ffffff'], ['POSTE', '#ffcc00', '#1d3b5c'],
  ['STAZIONE', '#1d3b5c', '#ffffff'], ['OFFICINA', '#3b3b40', '#ff9a3c'], ['BIRRERIA', '#5a3311', '#ffd47a'], ['SUSHI', '#111111', '#ff5a4a'],
  ['FUEL', '#c0221c', '#ffffff'], ['MARKET', '#1f6b3a', '#ffffff'], ['CAFÉ', '#f4efe6', '#3a2214'], ['TEATRO', '#3d1f3a', '#f2d78a'],
  ['MUSEO', '#e8e4dc', '#222222'], ['MOTEL', '#2b6a8a', '#ffe36a'], ['DINER', '#c0221c', '#fff8e0'], ['PUB', '#173b2a', '#e8c46a'],
];
/** UV rect [u0,v0,u1,v1] of a sign text in the atlas (no canvas needed). */
export function signCell(text) {
  let k = SIGNS.findIndex((s) => s[0] === text);
  if (k < 0) k = 0;
  const C = 4, R = 8, i = k % C, j = Math.floor(k / C);
  return [i / C, 1 - (j + 1) / R, (i + 1) / C, 1 - j / R];
}
export function signAtlas() {
  if (atlasCache.has('signs')) return atlasCache.get('signs');
  const cw = 256, chh = 64, C = 4, R = 8;
  const can = document.createElement('canvas');
  can.width = cw * C; can.height = chh * R;
  const g = can.getContext('2d');
  const cells = new Map();
  SIGNS.forEach(([text, bg, fg], k) => {
    const i = k % C, j = Math.floor(k / C), x0 = i * cw, y0 = j * chh;
    g.fillStyle = bg; g.fillRect(x0, y0, cw, chh);
    g.strokeStyle = fg; g.globalAlpha = 0.5; g.lineWidth = 3; g.strokeRect(x0 + 5, y0 + 5, cw - 10, chh - 10); g.globalAlpha = 1;
    g.fillStyle = fg;
    const serif = k % 3 === 1;
    let size = 40;
    g.font = `${serif ? '' : 'bold '}${size}px ${serif ? 'Georgia, serif' : 'Helvetica, Arial, sans-serif'}`;
    while (g.measureText(text).width > cw - 30 && size > 16) { size -= 2; g.font = `${serif ? '' : 'bold '}${size}px ${serif ? 'Georgia, serif' : 'Helvetica, Arial, sans-serif'}`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, x0 + cw / 2, y0 + chh / 2 + 2);
    // texture v goes up (flipY): cell rows from the top of the canvas
    cells.set(text, [i / C, 1 - (j + 1) / R, (i + 1) / C, 1 - j / R]);
  });
  const res = { tex: canvasTex(can), cells };
  atlasCache.set('signs', res);
  return res;
}

/** Striped awning fabric (baked colors: white + color), stripes along u, 0.25 m wide each. Tile 1 m. */
export function awningTex(color) {
  const key = 'awning' + color;
  if (atlasCache.has(key)) return atlasCache.get(key);
  const can = document.createElement('canvas');
  can.width = 128; can.height = 32;
  const g = can.getContext('2d');
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#f4f1ea' : color; g.fillRect(i * 32, 0, 32, 32); }
  g.fillStyle = 'rgba(0,0,0,0.06)';
  for (let y = 0; y < 32; y += 3) g.fillRect(0, y, 128, 1);
  const t = canvasTex(can);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  atlasCache.set(key, t);
  return t;
}
