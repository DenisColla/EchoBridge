// Procedural fabric textures, generated lazily and cached (shared by every garment):
//  - weave maps (tileable DataTexture, uv channel 0 = metric weave UVs): RGB =
//    normal of the fine weave (jersey knit, rib, fleece, denim twill, poplin,
//    wool twill, canvas, lycra, microfiber, crepe, tricot, leather grain,
//    sneaker mesh); A = weave tone (yarn tops light, gaps dark, mean 0.5)
//  - fabric character maps (tileable, uv channel 0, ~10 cm tile): the mid-scale
//    texture that still reads at figure scale (2-20 mm): R = tone (heather,
//    slub, denim warp streaks, fleece mottle), G = roughness, BA = relief normal xy
//  - detail maps (one per garment, uv channel 1 = garment atlas, see
//    assemble.js atlasLayout): tailoring drawn in body coordinates. No colour
//    space; R = tone (128 = unchanged, x2 range: wash fading lightens, seam
//    shadows darken), G = thread paint (mixes towards the thread colour), B =
//    relief height (128 = flat: seams sink, welts, plackets and pocket edges
//    rise; bump mapped by the cloth material).
// Hem stitching follows the real garment edges and is drawn by the cloth shader
// (attribute pvEdge), not here.
import * as THREE from 'three';
import { atlasLayout, atlasLen, atlasUnit, atlasCirc, ATLAS_GAP } from './assemble.js';
import { len3 } from './mesh.js';

const TAU = Math.PI * 2;
const PI = Math.PI;

// ------------------------------------------------------------------ fabric properties
/**
 * Weave: tile (m), ns (normal strength), wt (weave tone strength).
 * Character: char (pattern), cTile (m), tone / rough / mid (tone, roughness and
 * relief strengths).
 * Cloth BRDF: roughness, sheen + sheenRough (grazing velvet of knits and fleece),
 * spec (specular intensity: fabric is a poor mirror), sheenTint (sheen colour
 * towards white), clearcoat (polished leather). knit: bands are rib knit.
 */
export const FABRICS = {
  jersey: { tile: 0.016, ns: 0.45, wt: 0.14, char: 'heather', cTile: 0.1, tone: 0.07, rough: 0.05, mid: 0.05, roughness: 0.9, sheen: 0.6, sheenRough: 0.72, spec: 0.28, sheenTint: 0.1, knit: true },
  rib: { tile: 0.02, ns: 0.8, wt: 0.22, char: 'heather', cTile: 0.08, tone: 0.05, rough: 0.04, mid: 0.04, roughness: 0.9, sheen: 0.55, sheenRough: 0.72, spec: 0.28, sheenTint: 0.1, knit: true },
  fleece: { tile: 0.025, ns: 0.35, wt: 0.1, char: 'fleece', cTile: 0.12, tone: 0.08, rough: 0.05, mid: 0.06, roughness: 0.96, sheen: 0.8, sheenRough: 0.85, spec: 0.2, sheenTint: 0.08, knit: true },
  tricot: { tile: 0.016, ns: 0.3, wt: 0.06, char: 'tricot', cTile: 0.08, tone: 0.03, rough: 0.06, mid: 0.05, roughness: 0.55, sheen: 0.45, sheenRough: 0.45, spec: 0.45, sheenTint: 0.2, knit: true },
  denim: { tile: 0.012, ns: 0.6, wt: 0.2, char: 'denim', cTile: 0.12, tone: 0.11, rough: 0.05, mid: 0.06, roughness: 0.88, sheen: 0.22, sheenRough: 0.6, spec: 0.3, sheenTint: 0.12 },
  poplin: { tile: 0.008, ns: 0.25, wt: 0.06, char: 'poplin', cTile: 0.08, tone: 0.025, rough: 0.04, mid: 0.03, roughness: 0.66, sheen: 0.3, sheenRough: 0.5, spec: 0.38, sheenTint: 0.18 },
  wool: { tile: 0.01, ns: 0.3, wt: 0.08, char: 'wool', cTile: 0.1, tone: 0.045, rough: 0.05, mid: 0.045, roughness: 0.78, sheen: 0.45, sheenRough: 0.55, spec: 0.34, sheenTint: 0.14 },
  canvas: { tile: 0.012, ns: 0.55, wt: 0.18, char: 'canvas', cTile: 0.1, tone: 0.09, rough: 0.05, mid: 0.13, roughness: 0.9, sheen: 0.22, sheenRough: 0.65, spec: 0.28, sheenTint: 0.1 },
  lycra: { tile: 0.012, ns: 0.18, wt: 0.03, char: 'smooth', cTile: 0.08, tone: 0.02, rough: 0.06, mid: 0.03, roughness: 0.5, sheen: 0.35, sheenRough: 0.4, spec: 0.5, sheenTint: 0.2, knit: true },
  micro: { tile: 0.012, ns: 0.15, wt: 0.03, char: 'smooth', cTile: 0.08, tone: 0.02, rough: 0.05, mid: 0.03, roughness: 0.64, sheen: 0.4, sheenRough: 0.5, spec: 0.38, sheenTint: 0.15, knit: true },
  crepe: { tile: 0.02, ns: 0.35, wt: 0.08, char: 'crepe', cTile: 0.08, tone: 0.03, rough: 0.05, mid: 0.12, roughness: 0.8, sheen: 0.5, sheenRough: 0.6, spec: 0.32, sheenTint: 0.15 },
  leather: { tile: 0.03, ns: 0.35, wt: 0.08, char: 'leather', cTile: 0.1, tone: 0.07, rough: 0.1, mid: 0.1, roughness: 0.52, sheen: 0, spec: 0.55, sheenTint: 0 },
  calf: { tile: 0.03, ns: 0.2, wt: 0.04, char: 'leather', cTile: 0.1, tone: 0.04, rough: 0.08, mid: 0.05, roughness: 0.34, sheen: 0, spec: 0.7, sheenTint: 0, clearcoat: 0.35, weave: 'leather' },
  sneaker: { tile: 0.02, ns: 0.4, wt: 0.12, char: 'mesh', cTile: 0.06, tone: 0.05, rough: 0.05, mid: 0.1, roughness: 0.7, sheen: 0.2, sheenRough: 0.6, spec: 0.35, sheenTint: 0.1 },
};
/** Weave pattern of a fabric (a few share one). */
const weaveOf = (type) => FABRICS[type]?.weave || type;

// ------------------------------------------------------------------ tileable noise
/** Lattices of random values per (period, seed): tileable value noise without per-call hashing. */
const _lat = [];
function lattice(period, seed) {
  const key = period * 977 + seed;
  let L = _lat[key];
  if (L) return L;
  L = new Float32Array(period * period);
  let s = (seed * 2654435761 + period * 40503) >>> 0;
  for (let i = 0; i < L.length; i++) { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; L[i] = s / 4294967296; }
  _lat[key] = L;
  return L;
}
/** Tileable value noise in [0, 1] at (x, y) over integer periods px x py. */
function vnoise2(x, y, px, py, seed = 1) {
  const P = px > py ? px : py, L = _lat[P * 977 + seed] || lattice(P, seed);
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  let x0 = xi % px; if (x0 < 0) x0 += px;
  let y0 = yi % py; if (y0 < 0) y0 += py;
  const x1 = x0 + 1 === px ? 0 : x0 + 1, y1 = y0 + 1 === py ? 0 : y0 + 1;
  const a = L[y0 * P + x0], b = L[y0 * P + x1], c = L[y1 * P + x0], d = L[y1 * P + x1];
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
const vnoise = (x, y, period, seed) => vnoise2(x, y, period, period, seed);

// ------------------------------------------------------------------ weave maps
const _weave = new Map();

/** Tileable weave map of a fabric (256 x 256): RGB normal, A tone (mean 0.5). */
export function weaveNormal(type) {
  const wtype = weaveOf(type);
  if (_weave.has(type)) return _weave.get(type);
  const S = 256;
  const H = new Float32Array(S * S);
  const fr = (x) => x - Math.floor(x);
  const knit = (u, v, cols, rows) => {
    // V-shaped knit stitches: two slanted lobes per stitch
    const x = fr(u * cols), y = fr(v * rows);
    const l = Math.exp(-(((x - 0.27 + (y - 0.5) * 0.35) / 0.17) ** 2) - (((y - 0.5) / 0.42) ** 2));
    const r = Math.exp(-(((x - 0.73 - (y - 0.5) * 0.35) / 0.17) ** 2) - (((y - 0.5) / 0.42) ** 2));
    return Math.max(l, r);
  };
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = i / S, v = j / S;
    let h = 0;
    switch (wtype) {
      case 'jersey': h = knit(u, v, 16, 16) + 0.25 * vnoise(u * 8, v * 8, 8, 3); break;
      case 'micro': h = knit(u, v, 32, 32) * 0.6 + 0.1 * vnoise(u * 16, v * 16, 16, 3); break;
      case 'lycra': h = knit(u, v, 32, 32) * 0.5; break;
      case 'tricot': h = 0.6 * Math.abs(Math.sin(u * 32 * PI)) + 0.3 * knit(u, v, 32, 64); break;
      case 'rib': h = Math.pow(Math.abs(Math.sin(u * 8 * PI)), 0.6) + 0.25 * knit(u, v, 16, 16); break;
      case 'fleece': h = 0.6 * knit(u, v, 16, 16) + 0.5 * vnoise(u * 16, v * 16, 16, 3) + 0.2 * vnoise(u * 64, v * 64, 64, 5); break;
      case 'denim': {
        // 3/1 twill: diagonal wales + warp slubs
        const t = fr(u * 16 + v * 16);
        h = Math.pow(Math.sin(t * PI), 0.8) * 0.8 + 0.25 * vnoise2(u * 64, v * 4, 64, 4, 3) + 0.15 * vnoise(u * 64, v * 64, 64, 5);
        break;
      }
      case 'wool': { const t = fr(u * 16 + v * 16); h = 0.5 * Math.sin(t * PI) + 0.35 * vnoise(u * 32, v * 32, 32, 3); break; }
      case 'poplin': h = 0.5 * (Math.sin(u * 32 * PI) ** 2) * (0.6 + 0.4 * Math.sin(v * 32 * PI) ** 2) + 0.5 * (Math.sin(v * 32 * PI) ** 2) * 0.3; break;
      case 'canvas': h = 0.55 * Math.abs(Math.sin(u * 16 * PI)) * Math.abs(Math.sin(v * 16 * PI + (Math.floor(u * 16) % 2) * 1.57)) + 0.25 * vnoise(u * 32, v * 32, 32, 3); break;
      case 'crepe': h = 0.6 * vnoise(u * 32, v * 32, 32, 3) + 0.4 * vnoise(u * 64, v * 64, 64, 5); break;
      case 'leather': {
        // cellular grain
        const gx = u * 32, gy = v * 32, cx = Math.floor(gx), cy = Math.floor(gy);
        const Lg = lattice(32, 9), Lh = lattice(32, 11);
        let d1 = 9;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const qx = ((cx + a) % 32 + 32) % 32, qy = ((cy + b) % 32 + 32) % 32;
          const px = cx + a + Lg[qy * 32 + qx], py = cy + b + Lh[qy * 32 + qx];
          d1 = Math.min(d1, Math.sqrt((gx - px) ** 2 + (gy - py) ** 2));
        }
        h = Math.min(1, d1 * 1.4) + 0.2 * vnoise(u * 8, v * 8, 8, 3);
        break;
      }
      case 'sneaker': h = 0.6 * (Math.abs(Math.sin(u * 16 * PI)) * Math.abs(Math.sin(v * 16 * PI))) ** 0.5 + 0.2 * vnoise(u * 32, v * 32, 32, 3); break;
      default: h = 0;
    }
    H[j * S + i] = h;
  }
  // tone: normalized height (yarn tops light), mean 0.5
  let mn = Infinity, mx = -Infinity, mean = 0;
  for (let i = 0; i < S * S; i++) { const h = H[i]; if (h < mn) mn = h; if (h > mx) mx = h; mean += h; }
  mean /= S * S;
  const span = Math.max(1e-6, Math.max(mx - mean, mean - mn));
  const data = new Uint8Array(S * S * 4);
  const k = 3.0;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const hx = H[j * S + ((i + 1) % S)] - H[j * S + ((i + S - 1) % S)];
    const hy = H[((j + 1) % S) * S + i] - H[((j + S - 1) % S) * S + i];
    let nx = -hx * k, ny = -hy * k, nz = 1;
    const l = len3(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    const o = (j * S + i) * 4;
    data[o] = Math.round((nx * 0.5 + 0.5) * 255); data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255); data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    data[o + 3] = Math.round(Math.max(0, Math.min(1, 0.5 + 0.5 * (H[j * S + i] - mean) / span)) * 255);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  const tile = FABRICS[type]?.tile ?? 0.02;
  tex.repeat.set(1 / tile, 1 / tile);
  tex.channel = 0;
  tex.name = 'pv-weave-' + type;
  tex.needsUpdate = true;
  _weave.set(type, tex);
  return tex;
}

// ------------------------------------------------------------------ fabric character maps
const _char = new Map();

/**
 * Mid-scale fabric character map (tileable, 256 x 256 over FABRICS[type].cTile).
 * Patterns are in tile units: u around the body (weft / courses), v down it (warp / wales).
 */
export function fabricChar(type) {
  if (_char.has(type)) return _char.get(type);
  const S = CHAR_SIZE;
  // neutral until generated (idle time, a few ms per slice: startup is not delayed)
  const data = new Uint8Array(S * S * 4).fill(128);
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.name = 'pv-fabric-' + type;
  tex.needsUpdate = true;
  _char.set(type, tex);
  schedule(charSteps(type, tex));
  return tex;
}

const CHAR_SIZE = 256;
/** Generator filling a character map (yields between row slices). */
function* charSteps(type, tex) {
  const f = FABRICS[type] || FABRICS.jersey, S = CHAR_SIZE;
  const T = new Float32Array(S * S), R = new Float32Array(S * S), Hh = new Float32Array(S * S);
  const fbm = (u, v, p, seed, oct = 3) => { let s = 0, a = 0.5, w = 0; for (let o = 0; o < oct; o++) { s += a * vnoise(u * p, v * p, p, seed + o); w += a; a *= 0.5; p *= 2; } return s / w; };
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    if (i === 0 && j % 16 === 15) yield;
    const u = i / S, v = j / S, o = j * S + i;
    let t = 0, r = 0, h = 0;
    switch (f.char) {
      case 'heather': {
        // melange speckle (1-2 mm) + slub streaks along the courses (around the body)
        const sp = vnoise(u * 96, v * 96, 96, 21) - 0.5;
        const sp2 = vnoise(u * 160, v * 160, 160, 24) - 0.5;
        const sl = vnoise2(u * 24, v * 110, 24, 110, 22) - 0.5;
        const bl = fbm(u, v, 6, 23) - 0.5;
        t = sp * 0.8 + sp2 * 0.6 + sl * 0.45 + bl * 0.5;
        r = sp * 0.6 - bl;
        h = sl * 0.4 + sp * 0.4;
        break;
      }
      case 'fleece': {
        // soft mottle + pilling bumps
        const m = fbm(u, v, 10, 31) - 0.5;
        const pill = Math.max(0, vnoise(u * 60, v * 60, 60, 32) - 0.66) * 3.0;
        const sp = vnoise(u * 80, v * 80, 80, 33) - 0.5;
        t = m * 1.3 + sp * 0.6 + pill * 0.4;
        r = -m;
        h = pill * 0.7 + sp * 0.3;
        break;
      }
      case 'tricot': {
        const w = Math.sin(u * TAU * 60) * 0.5;
        const m = fbm(u, v, 6, 41) - 0.5;
        t = m * 0.8 + w * 0.2; r = m * 0.6; h = w * 0.6;
        break;
      }
      case 'denim': {
        // warp streaks (vertical, irregular indigo), slubs (short light dashes), mottle
        const st = vnoise2(u * 140, v * 5, 140, 5, 51) - 0.5;
        const st2 = vnoise2(u * 60, v * 3, 60, 3, 52) - 0.5;
        const sl = Math.max(0, vnoise2(u * 90, v * 18, 90, 18, 53) - 0.66) * 3.0;
        const m = fbm(u, v, 5, 54) - 0.5;
        t = st * 1.0 + st2 * 0.8 + sl * 0.9 + m * 0.7;
        r = -sl * 0.5 + m * 0.4;
        h = st * 0.6 + sl * 0.8;
        break;
      }
      case 'poplin': {
        // end-on-end: fine alternating warp shades, faint mottle
        const e = (Math.floor(u * 200) % 2) - 0.5;
        const m = fbm(u, v, 8, 61) - 0.5;
        t = e * 0.35 + m * 0.7; r = m * 0.5; h = m * 0.3;
        break;
      }
      case 'wool': {
        // twill diagonal at ~2 mm + heathered mottle
        const d = Math.sin((u + v) * TAU * 50) * 0.5;
        const m = fbm(u, v, 8, 71) - 0.5;
        const sp = vnoise(u * 100, v * 100, 100, 72) - 0.5;
        t = m * 0.8 + sp * 0.6 + d * 0.25; r = sp * 0.5; h = d * 0.5 + m * 0.3;
        break;
      }
      case 'canvas': {
        // basket weave ~2 mm + slubs both ways
        const bx = Math.abs(Math.sin(u * PI * 50)), by = Math.abs(Math.sin(v * PI * 50));
        const sx = vnoise2(u * 6, v * 50, 6, 50, 81) - 0.5, sy = vnoise2(u * 50, v * 6, 50, 6, 82) - 0.5;
        const m = fbm(u, v, 6, 83) - 0.5;
        t = sx * 0.8 + sy * 0.8 + m * 0.7 + (bx * by - 0.4) * 0.3; r = m * 0.5; h = bx * by + (sx + sy) * 0.3;
        break;
      }
      case 'crepe': {
        const p = (vnoise(u * 40, v * 40, 40, 91) * 0.67 + vnoise(u * 80, v * 80, 80, 93) * 0.33) - 0.5;
        const m = fbm(u, v, 8, 92) - 0.5;
        t = p * 0.5 + m * 0.6; r = p * 0.6; h = p * 1.4;
        break;
      }
      case 'leather': {
        const m = fbm(u, v, 6, 101) - 0.5;
        const c = fbm(u, v, 30, 102, 2) - 0.5;
        t = m * 1.2 + c * 0.4; r = c * 0.8 - m * 0.4; h = c * 1.2;
        break;
      }
      case 'mesh': {
        const hx = Math.abs(Math.sin(u * PI * 24)), hy = Math.abs(Math.sin(v * PI * 24));
        const hole = Math.max(0, 0.35 - hx * hy) * 2.5;
        t = -hole * 0.9 + (vnoise(u * 20, v * 20, 20, 111) - 0.5) * 0.4; r = hole * 0.5; h = -hole;
        break;
      }
      default: { const m = fbm(u, v, 8, 121) - 0.5; t = m; r = m * 0.5; h = m * 0.3; }
    }
    T[o] = t; R[o] = r; Hh[o] = h;
  }
  // normalize each channel to [-1, 1] around its mean
  const norm = (A) => {
    let mean = 0;
    for (let i = 0; i < A.length; i++) mean += A[i];
    mean /= A.length;
    let m = 1e-6;
    for (let i = 0; i < A.length; i++) { A[i] -= mean; m = Math.max(m, Math.abs(A[i])); }
    for (let i = 0; i < A.length; i++) A[i] /= m;
  };
  norm(T); norm(R); norm(Hh);
  yield;
  const data = tex.image.data;
  const q = (x) => Math.max(0, Math.min(255, Math.round((x * 0.5 + 0.5) * 255)));
  // relief normal from the height (central differences, tile-wrapped); slope 1 ~ full scale
  const k = S / 24;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const o = j * S + i;
    const hx = (Hh[j * S + ((i + 1) % S)] - Hh[j * S + ((i + S - 1) % S)]) * k;
    const hy = (Hh[((j + 1) % S) * S + i] - Hh[((j + S - 1) % S) * S + i]) * k;
    const l = Math.hypot(hx, hy, 1);
    data[o * 4] = q(T[o]); data[o * 4 + 1] = q(R[o]); data[o * 4 + 2] = q(-hx / l); data[o * 4 + 3] = q(-hy / l);
  }
  tex.needsUpdate = true;
}

// ------------------------------------------------------------------ idle-time generation
const _jobs = [];
const _ready = [], _updated = new Set();
let _timer = 0;
/** Slice budget (ms) of the texture jobs per idle callback. */
const SLICE_MS = 4;
function schedule(gen) { _jobs.push(gen); kick(); }
function kick() {
  if (_timer || !_jobs.length) return;
  const run = (dl) => {
    _timer = 0;
    const t0 = performance.now(), budget = dl?.timeRemaining ? Math.max(SLICE_MS, Math.min(12, dl.timeRemaining())) : SLICE_MS;
    while (_jobs.length && performance.now() - t0 < budget) {
      if (_jobs[0].next().done) { _jobs.shift(); for (const fn of _updated) fn(); }
    }
    if (_jobs.length) kick();
    else { const r = _ready.splice(0); r.forEach((f) => f()); }
  };
  _timer = typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: 120 }) : setTimeout(run, 0);
}
/** Resolves when every fabric texture asked for so far is generated (tests, captures). */
export function whenFabricsReady() { return _jobs.length ? new Promise((r) => _ready.push(r)) : Promise.resolve(); }
/** fn() is called when a fabric texture finished generating (redraw). */
export function onFabricUpdate(fn) { _updated.add(fn); }

/** Character map uv scale relative to the weave map uv (both sampled from uv0). */
export function fabricScale(type) { const f = FABRICS[type] || FABRICS.jersey; return f.tile / f.cTile; }

// ------------------------------------------------------------------ detail maps
/** Detail map side (px): one atlas per garment (about 1 mm per texel on a top or trousers). */
const DETAIL_SIZE = 1024;
const _detail = new Map();
/** Neutral texel: tone 1, no paint, flat. */
const NEUTRAL = 'rgb(128,0,128)';

/**
 * Detail map of a garment definition (its `details` drawing on its `atlas`
 * layout), null without one or without a DOM. Cached per drawing + layout.
 */
export function detailMap(def) {
  const id = typeof def === 'string' ? def : def?.details;
  if (!id || typeof document === 'undefined') return null;
  const draw = DRAW[id];
  if (!draw) return null;
  const lay = atlasLayout(typeof def === 'object' ? def.atlas : null);
  const S = (typeof def === 'object' && def.detailSize) || DETAIL_SIZE;
  const key = `${id}|${S}|${lay.key}`;
  if (_detail.has(key)) return _detail.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = NEUTRAL;
  g.fillRect(0, 0, S, S);
  draw(makeApi(g, lay, S));
  const tex = new THREE.CanvasTexture(cv);
  // the atlas is drawn top-down in uv1 order (assemble.js atlasUV): no flip
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.channel = 1;
  tex.anisotropy = 4;
  tex.name = 'pv-detail-' + id;
  _detail.set(key, tex);
  return tex;
}

/**
 * Debug: an atlas showing the panels (colours) and a body coordinate grid (T or
 * limb param every 0.25, angle every 22.5 deg; thicker at integers, white at angle 0).
 */
export function debugAtlas(def) {
  const lay = atlasLayout(def?.atlas), S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  const cols = ['#d33', '#3a3', '#33d', '#db3', '#d3d'];
  const a = makeApi(g, lay, S);
  for (let r = 0; r < 5; r++) {
    const R = lay.rects[r];
    if (!R) continue;
    g.fillStyle = cols[r]; g.fillRect(R[0] * S, R[1] * S, R[2] * S, R[3] * S);
    const [c0, c1] = lay.ranges[r];
    for (let c = Math.ceil(c0 * 4) / 4; c <= c1; c += 0.25) a.raw(r, a.around(r, c), Number.isInteger(c) ? 5 : 1.5, '#000');
    for (let k = -8; k <= 8; k++) a.raw(r, a.along(r, (k * PI) / 8, c0, c1), k % 4 === 0 ? 5 : 1.5, k === 0 ? '#fff' : '#000');
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.channel = 1;
  return tex;
}

/** Composite operation + colour of each channel operation (amount k in 0..1). */
const OPS = {
  dark: (k) => ['multiply', `rgb(${Math.round(255 * (1 - k))},255,255)`], // tone x (1 - k)
  light: (k) => ['screen', `rgb(${Math.round(255 * k)},0,0)`], // tone towards 2
  paint: (k) => ['lighten', `rgb(0,${Math.round(255 * k)},0)`], // thread coverage
  up: (k) => ['lighten', `rgb(0,0,${Math.round(128 + 127 * k)})`], // relief up to 0.5 + k / 2
  down: (k) => ['darken', `rgb(255,255,${Math.round(128 - 128 * k)})`], // relief down
};
const rgba = (col, a) => col.replace('rgb(', 'rgba(').replace(')', `,${a})`);

/**
 * Drawing API in garment coordinates: points [theta, coord] of panel r (0 torso
 * (coord = T), 1-2 sleeves, 3-4 legs (coord = limb param)). Sizes are in mm.
 * Every primitive is clipped to its panel rect plus its margin and drawn three
 * times around (theta +- 2 pi): the wrap seam and the mip levels sample there.
 */
function makeApi(g, lay, S) {
  const pxmm = (lay.s * S) / 1000; // canvas px per mm along the body
  const R = lay.rects;
  const P = (r, th, c) => {
    const q = R[r], n = (atlasLen(r, c) - lay.len0[r]) / (lay.len1[r] - lay.len0[r]);
    return [(q[0] + q[2] * (th / TAU + 0.5)) * S, (q[1] + q[3] * n) * S];
  };
  /** radius (m) of the representative body at coord c of panel r (smooth between units) */
  const radius = (r, c) => {
    const k = c - 0.5, i = Math.floor(k), t = k - i;
    return (atlasCirc(r, i) * (1 - t) + atlasCirc(r, i + 1) * t) / TAU;
  };
  const toPx = (r, pts) => pts.map(([th, c]) => P(r, th, c));
  /** polyline offset by d px to the left of its direction (canvas space) */
  const offsetPx = (q, d) => {
    if (!d) return q;
    const n = q.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = q[Math.max(0, i - 1)], b = q[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      out.push([q[i][0] - dy * d, q[i][1] + dx * d]);
    }
    return out;
  };
  /** run fn(shiftPx) clipped to panel r, for the three wrap copies */
  const inPanel = (r, fn) => {
    const q = R[r];
    if (!q) return;
    const m = (ATLAS_GAP / 2) * S;
    g.save();
    g.beginPath();
    g.rect(q[0] * S - m, q[1] * S - m, q[2] * S + 2 * m, q[3] * S + 2 * m);
    g.clip();
    for (const k of [-1, 0, 1]) fn(k * q[2] * S);
    g.restore();
  };
  const setOp = (op, k, alpha = 1) => { const [mode, col] = OPS[op](k); g.globalCompositeOperation = mode; g.strokeStyle = col; g.fillStyle = col; g.globalAlpha = alpha; };
  const tracePx = (q, sx, close) => {
    g.beginPath();
    q.forEach(([x, y], i) => (i ? g.lineTo(x + sx, y) : g.moveTo(x + sx, y)));
    if (close) g.closePath();
  };
  const api = {
    lay, pxmm,
    has: (r) => !!R[r],
    /** coord + mm along the body (positive = increasing coord) */
    dc: (r, c, mm) => c + mm / 1000 / atlasUnit(r, c),
    /** angle of mm around the body at coord c */
    dth: (r, c, mm) => mm / 1000 / radius(r, c),
    /** horizontal ring at coord c (theta a..b) */
    around(r, c, a = -PI, b = PI, n = 64) { const p = []; for (let i = 0; i <= n; i++) p.push([a + (b - a) * (i / n), c]); return p; },
    /** line along the body at angle th from c0 to c1 */
    along(r, th, c0, c1, n = 32) { const p = []; for (let i = 0; i <= n; i++) p.push([th, c0 + (c1 - c0) * (i / n)]); return p; },
    /** smooth polyline through control points (Catmull-Rom, n samples per span) */
    curve(pts, n = 10) {
      if (pts.length < 3) return pts;
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (let k = 0; k < n; k++) {
          const t = k / n, t2 = t * t, t3 = t2 * t;
          out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
        }
      }
      out.push(pts[pts.length - 1]);
      return out;
    },
    /** mirrored copy of points (theta -> -theta), reversed so offsets stay on the same side */
    mirror: (pts) => pts.map(([t, c]) => [-t, c]).reverse(),
    /** stroke with a channel operation: w mm wide, opt {off (mm, left), dash [mm, mm], alpha, close} */
    stroke(r, pts, w, op, k, opt = {}) {
      inPanel(r, (sx) => {
        setOp(op, k, opt.alpha ?? 1);
        g.lineWidth = Math.max(1.1, w * pxmm);
        g.lineCap = opt.dash ? 'butt' : 'round'; g.lineJoin = 'round';
        g.setLineDash(opt.dash ? opt.dash.map((x) => Math.max(1, x * pxmm)) : []);
        tracePx(offsetPx(toPx(r, pts), (opt.off || 0) * pxmm), sx, opt.close);
        g.stroke();
      });
    },
    /** filled polygon with a channel operation */
    fill(r, pts, op, k, alpha = 1) {
      inPanel(r, (sx) => { setOp(op, k, alpha); tracePx(toPx(r, pts), sx, true); g.fill(); });
    },
    /** soft elliptical blob (radial falloff) at (th, c): rx, ry in mm, rot (rad, canvas) */
    blob(r, th, c, rx, ry, op, k, rot = 0) {
      inPanel(r, (sx) => {
        const [x, y] = P(r, th, c);
        const [mode, col] = OPS[op](k);
        g.globalCompositeOperation = mode; g.globalAlpha = 1;
        g.save();
        g.translate(x + sx, y); g.rotate(rot); g.scale(Math.max(1, rx * pxmm), Math.max(1, ry * pxmm));
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(0.45, rgba(col, 0.55)); gr.addColorStop(1, rgba(col, 0));
        g.fillStyle = gr;
        g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill();
        g.restore();
      });
    },
    /** soft line (strokes from wide and faint to narrow): whiskers, honeycombs, wear */
    softLine(r, pts, w, op, k) {
      for (const [f, a] of [[1, 0.3], [0.6, 0.4], [0.3, 0.55]]) api.stroke(r, pts, w * f, op, k, { alpha: a });
    },
    /** sewn seam: a groove with its shadow (the bump adds the light / dark pair) */
    seam(r, pts, k = 1, opt = {}) {
      api.stroke(r, pts, 2.6, 'down', 0.55 * k, opt);
      api.stroke(r, pts, 1.4, 'dark', 0.3 * k, opt);
    },
    /** stitching: dashed thread (paint + raised), at offset mm from the path */
    stitch(r, pts, off = 0, opt = {}) {
      const w = opt.w ?? 1.0, dash = opt.dash ?? [2.8, 1.4], k = opt.k ?? 1;
      api.stroke(r, pts, w + 1.4, 'dark', 0.12 * k, { off, alpha: 0.7 });
      api.stroke(r, pts, w, 'paint', 0.92 * k, { off, dash });
      api.stroke(r, pts, w, 'up', 0.35 * k, { off, dash });
    },
    /** seam with topstitching at the given offsets (mm, + = left of the path direction) */
    topstitched(r, pts, offs = [3], k = 1, opt = {}) { api.seam(r, pts, k); for (const o of offs) api.stitch(r, pts, o, opt); },
    /** raised area (double fabric: placket, patch pocket, flap) with a shadowed outline */
    raised(r, pts, h = 0.35, shadow = 0.2) {
      api.fill(r, pts, 'up', h);
      api.stroke(r, pts, 1.8, 'dark', shadow, { close: true });
      api.stroke(r, pts, 1.3, 'down', 0.35, { close: true });
    },
    /** rivet / snap / small button: metal (paint) disc, raised, dark rim */
    rivet(r, th, c, d = 4.5) {
      const ring = [];
      for (let i = 0; i <= 16; i++) { const a = (i / 16) * TAU; ring.push([th + Math.cos(a) * api.dth(r, c, d / 2), api.dc(r, c, (Math.sin(a) * d) / 2)]); }
      api.fill(r, ring, 'up', 0.85);
      api.fill(r, ring, 'paint', 1);
      api.stroke(r, ring, 0.8, 'dark', 0.4, { close: true });
    },
    /** rectangle [th0, th1] x [c0, c1] as a closed point list */
    rect: (th0, c0, th1, c1) => [[th0, c0], [th1, c0], [th1, c1], [th0, c1], [th0, c0]],
    /** belt loop over the waistband: raised bar, shadow, bar tacks */
    beltLoop(r, th, c0, c1, wmm = 10) {
      const hw = api.dth(r, (c0 + c1) / 2, wmm / 2);
      api.raised(r, api.rect(th - hw, c0, th + hw, c1), 0.6, 0.32);
      for (const c of [api.dc(r, c0, 2.5), api.dc(r, c1, -2.5)]) api.stroke(r, [[th - hw * 0.75, c], [th + hw * 0.75, c]], 1.3, 'paint', 0.9);
    },
    /** plain colour stroke (debug atlas) */
    raw(r, pts, wpx, col) { inPanel(r, (sx) => { g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.strokeStyle = col; g.lineWidth = wpx; g.setLineDash([]); tracePx(toPx(r, pts), sx, false); g.stroke(); }); },
  };
  return api;
}

const ARMS = [1, 2], LEGS = [3, 4];
/** Front of a leg panel (leg frames: theta 0 = outer side; +90 deg is the front of the left leg, the back of the right one). */
const legFront = (r) => (r === 3 ? PI / 2 : -PI / 2);
/** Top / shoulder line of a sleeve panel: theta 0 (arm frames take world up as reference); the underarm is at +-pi. */

/** Common seams of a set-in sleeve top: side seams, shoulder seams, armhole and underarm seams. */
function topSeams(a, { side = 3.65, k = 0.8, shoulder = true, armhole = true } = {}) {
  for (const s of [1, -1]) a.seam(0, a.along(0, s * PI / 2, -0.8, side), k);
  if (shoulder) for (const s of [1, -1]) a.seam(0, a.along(0, s * (PI / 2 + 0.1), 4.0, 5.3), k);
  for (const r of ARMS) if (a.has(r)) {
    const [c0, c1] = a.lay.ranges[r];
    if (armhole) a.seam(r, a.around(r, Math.max(c0, a.lay.armCut) + 0.04), k);
    a.seam(r, a.along(r, PI, c0, c1 + 0.2), k);
  }
}

/**
 * Belt loops over the waistband of trousers (trim band; its topstitching follows
 * the real edge, see the cloth shader's top stitch). waist = T of the top edge, band in mm.
 */
function waistband(a, waist, band, loops = [0.55, 1.45, PI - 0.38]) {
  const c0 = a.dc(0, waist, -band - 2), c1 = a.dc(0, waist, 4);
  for (const th of loops) for (const s of [1, -1]) a.beltLoop(0, s * th, c0, c1);
  a.beltLoop(0, PI, c0, c1);
}

/** Wash wear of denim: faded thigh fronts, knees and seat; whiskers at the hip crease; honeycombs behind the knees. */
function denimWash(a, { seat = true, legs = true, k = 1 } = {}) {
  if (seat) for (const s of [1, -1]) a.blob(0, s * (PI - 0.55), 0.65, 70, 55, 'light', 0.13 * k);
  // whiskers: soft light streaks fanning out from the crotch over the hip crease
  for (const s of [1, -1]) {
    for (let i = 0; i < 6; i++) {
      const t0 = 0.28 + i * 0.07, len = 0.45 + (i % 2 ? 0.12 : 0.28);
      const pts = a.curve([[s * 0.3, t0], [s * (0.3 + len * 0.55), t0 + 0.12 + i * 0.035], [s * (0.3 + len), t0 + 0.2 + i * 0.05]], 8);
      a.softLine(0, pts, 4.5, 'light', 0.2 * k);
    }
  }
  if (!legs) return;
  for (const r of LEGS) {
    if (!a.has(r)) continue;
    const f = legFront(r);
    a.blob(r, f, 0.45, 75, 160, 'light', 0.16 * k);
    a.blob(r, f, 1.02, 45, 50, 'light', 0.1 * k);
    // honeycombs behind the knee
    for (let i = 0; i < 4; i++) {
      const c = 1.02 + i * 0.045, w = 0.55 - Math.abs(i - 1.5) * 0.1;
      a.softLine(r, a.curve([[-f - w, c + 0.02], [-f, c - 0.015], [-f + w, c + 0.02]], 6), 3.5, 'light', 0.16 * k);
    }
    // whiskers continuing on the upper thigh front
    for (let i = 0; i < 3; i++) a.softLine(r, [[f - 0.9 + i * 0.25, 0.05 + i * 0.03], [f - 0.2 + i * 0.25, 0.14 + i * 0.04]], 4, 'light', 0.14 * k);
  }
}

/** Per-garment detail drawings (garment coordinates, see assemble.js atlasUV). */
const DRAW = {
  tshirt(a) { topSeams(a); },
  tank(a) { for (const s of [1, -1]) a.seam(0, a.along(0, s * PI / 2, -0.8, 3.7), 0.8); },
  plainKnit(a) { topSeams(a); },
  sweatshirt(a) {
    // raglan seams from the neck rib to the underarm, side and underarm seams
    for (const s of [1, -1]) {
      for (const [th0, th1] of [[0.55, 1.3], [PI - 0.6, PI - 1.35]]) a.topstitched(0, a.curve([[s * th0, 5.15], [s * (th0 + th1) * 0.5, 4.4], [s * th1, 3.6]], 8), [s * 3], 0.9);
      a.seam(0, a.along(0, s * PI / 2, -0.8, 3.65), 0.9);
    }
    for (const r of ARMS) if (a.has(r)) a.seam(r, a.along(r, PI, -0.4, 2.3), 0.9);
    // neck V insert
    a.seam(0, [[-0.16, 5.05], [0, 4.82], [0.16, 5.05]], 0.9);
  },
  trackjacket(a) {
    // zipper: tape, teeth (paint = zipper colour), welts of the zipped side pockets
    a.raised(0, a.rect(-0.05, -0.8, 0.05, 6), 0.3, 0.25);
    a.stroke(0, a.along(0, 0, -0.8, 6), 5, 'up', 0.7);
    a.stroke(0, a.along(0, 0, -0.8, 6), 5, 'paint', 1, { dash: [1.2, 0.9] });
    a.stroke(0, a.along(0, 0, -0.8, 6), 0.8, 'dark', 0.5);
    for (const s of [1, -1]) a.stitch(0, a.along(0, s * 0.075, -0.8, 6), 0, { k: 0.6 });
    for (const s of [1, -1]) {
      const w = a.curve([[s * 0.75, 1.05], [s * 0.86, 1.55], [s * 0.98, 2.05]], 6);
      a.raised(0, [...w.map(([t, c]) => [t - s * 0.02, c]), ...w.slice().reverse().map(([t, c]) => [t + s * 0.03, c])], 0.35, 0.3);
      a.stroke(0, w, 1.4, 'paint', 0.8);
    }
    topSeams(a, { k: 0.7 });
    // contrast stripes along the outer sleeve (paint = thread colour)
    for (const r of ARMS) if (a.has(r)) for (const o of [-0.13, 0.13]) { a.stroke(r, a.along(r, o, 0, 2.2), 7, 'paint', 1); a.stroke(r, a.along(r, o, 0, 2.2), 7, 'up', 0.15); }
  },
  shirt(a) {
    // button placket (3 cm, double fabric, stitched on both sides); the buttons are geometry
    const pk = (c) => a.dth(0, c, 15);
    const pl = [];
    for (let c = -0.8; c <= 5.4; c += 0.2) pl.push([pk(c), c]);
    for (let c = 5.4; c >= -0.8; c -= 0.2) pl.push([-pk(c), c]);
    a.raised(0, pl, 0.32, 0.25);
    for (const s of [1, -1]) a.stitch(0, a.along(0, s * a.dth(0, 3, 11), -0.8, 5.4), 0, { k: 0.8 });
    // chest pocket (wearer's left)
    const pkt = [[-0.3, 3.62], [-0.72, 3.62], [-0.72, 3.08], [-0.51, 2.96], [-0.3, 3.08], [-0.3, 3.62]];
    a.raised(0, pkt, 0.25, 0.22);
    a.stitch(0, pkt, 2.5, { k: 0.8 });
    a.stroke(0, [[-0.3, 3.55], [-0.72, 3.55]], 1, 'paint', 0.6, { dash: [2.6, 1.4] });
    // back yoke with a box pleat under it
    for (const s of [1, -1]) a.topstitched(0, a.around(0, 4.45, s * (PI / 2 + 0.2), s * PI), [-2.5], 0.9);
    for (const s of [1, -1]) a.seam(0, a.along(0, PI + s * 0.09, 3.6, 4.45), 0.6);
    a.fill(0, a.rect(PI - 0.09, 3.6, PI + 0.09, 4.45), 'up', 0.15);
    // side seams (felled), sleeve seams, armholes; shoulder line under the yoke
    for (const s of [1, -1]) a.topstitched(0, a.along(0, s * PI / 2, -0.8, 3.6), [s * 3], 0.7, { k: 0.7 });
    topSeams(a, { shoulder: false, k: 0.75 });
    for (const r of ARMS) if (a.has(r)) {
      // sleeve placket above the cuff (back of the forearm)
      const pts = a.along(r, 0.55, 1.55, 1.82);
      a.raised(r, [...pts.map(([t, c]) => [t - 0.12, c]), ...pts.slice().reverse().map(([t, c]) => [t + 0.12, c])], 0.25, 0.2);
    }
  },
  blazer(a) {
    for (const s of [1, -1]) {
      // flap pockets at the hips: flap raised over a dark welt opening (a hand above
      // the hem at T 0.3, clear of the front cutaway below the lower button)
      const PK = 1.4;
      const fl = a.rect(s * 0.6, a.dc(0, PK, -38), s * 1.3, PK);
      a.stroke(0, a.around(0, PK, s * 0.6, s * 1.3), 3.5, 'dark', 0.55);
      a.raised(0, fl, 0.45, 0.35);
      a.stitch(0, fl, s * 3, { k: 0.5 });
      // princess seams (front and back), side panel seams
      a.seam(0, a.curve([[s * 0.46, -0.6], [s * 0.42, 1.3], [s * 0.5, 2.6], [s * 0.75, 3.7], [s * 1.05, 4.2]], 8), 0.9);
      a.seam(0, a.curve([[s * (PI - 0.55), -0.6], [s * (PI - 0.5), 1.6], [s * (PI - 0.6), 3.2], [s * (PI - 0.95), 4.1]], 8), 0.9);
      a.seam(0, a.along(0, s * PI * 0.62, -0.6, 3.6), 0.8);
      a.seam(0, a.along(0, s * (PI / 2 + 0.1), 4.0, 5.3), 0.8);
    }
    // breast welt pocket (wearer's left)
    const bw = a.rect(-0.75, 3.4, -1.12, a.dc(0, 3.4, 18));
    a.raised(0, bw, 0.45, 0.3);
    a.stroke(0, a.around(0, 3.4, -1.12, -0.75), 1.8, 'dark', 0.5);
    // centre back seam and vent
    a.seam(0, a.along(0, PI, -0.8, 5.3), 0.9);
    a.stroke(0, a.along(0, PI - 0.02, -0.8, 0.75), 2.2, 'dark', 0.45);
    a.fill(0, a.rect(PI - 0.02, -0.8, PI + 0.12, 0.75), 'up', 0.25);
    // front edge below the button: the overlap of the two fronts
    a.stroke(0, a.along(0, 0.02, -0.8, 2.2), 2.4, 'dark', 0.55);
    a.fill(0, a.rect(0.02, -0.8, -0.14, 2.2), 'up', 0.25);
    for (const r of ARMS) if (a.has(r)) {
      // two-piece sleeve, set-in armhole, cuff buttons on the back of the sleeve
      const [c0, c1] = a.lay.ranges[r];
      a.seam(r, a.along(r, PI, c0, c1 + 0.2), 0.9); a.seam(r, a.along(r, 0.45, c0 + 0.3, c1 + 0.2), 0.8);
      a.seam(r, a.around(r, Math.max(c0, a.lay.armCut) + 0.04), 0.9);
      for (let i = 0; i < 3; i++) a.rivet(r, 0.62, 1.84 - i * 0.05, 9);
    }
  },
  sporttop(a) { for (const s of [1, -1]) { a.seam(0, a.along(0, s * PI / 2, 2.2, 4.2), 0.8); a.seam(0, a.curve([[s * 0.4, 3.3], [s * 0.9, 3.6], [s * 1.35, 3.9]], 6), 0.6); } },
  jeans(a) {
    denimWash(a);
    // waistband (top edge at T 1.55, 38 mm) with belt loops, the button is geometry
    waistband(a, 1.55, 38, [0.6, 1.45, PI - 0.4]);
    const wb = a.dc(0, 1.55, -38);
    for (const s of [1, -1]) {
      // front pocket: scooped opening, double topstitch, rivet at its outer end
      const op = a.curve([[s * 0.33, wb], [s * 0.5, a.dc(0, wb, -55)], [s * 0.82, a.dc(0, wb, -80)], [s * 1.18, a.dc(0, wb, -90)]], 8);
      a.raised(0, [...op, [s * 1.4, wb], [s * 0.33, wb]], 0.18, 0.12);
      a.stroke(0, op, 2.6, 'dark', 0.45);
      a.stroke(0, op, 2.4, 'down', 0.5);
      a.stitch(0, op, s * -3.5);
      a.stitch(0, op, s * -9);
      a.rivet(0, s * 1.18, a.dc(0, wb, -88));
      // back: yoke (V to the centre back), patch pocket with double stitch, rivets
      const yoke = a.curve([[s * (PI / 2 + 0.05), a.dc(0, wb, -18)], [s * (PI - 0.5), a.dc(0, wb, -45)], [s * PI, a.dc(0, wb, -70)]], 8);
      a.topstitched(0, yoke, [s * 3.5, s * 9.5]);
      const pt = a.dc(0, wb, -78), pb = a.dc(0, pt, -150), cx = s * (PI - 0.55), hw = 0.37;
      const bp = [[cx - hw, pt], [cx + hw, a.dc(0, pt, 5)], [cx + hw * 0.92, a.dc(0, pb, 18)], [cx, pb], [cx - hw * 0.92, a.dc(0, pb, 18)], [cx - hw, pt]];
      a.raised(0, bp, 0.4, 0.28);
      a.stitch(0, bp, s * 3); a.stitch(0, bp, s * 8);
      for (const e of [cx - hw, cx + hw]) a.rivet(0, e, a.dc(0, pt, -3), 3.5);
      // outseam on the hips (continues down the leg)
      a.topstitched(0, a.along(0, s * PI / 2, -0.8, wb), [s * 3]);
    }
    // coin pocket (wearer's right) and fly J-stitch
    const cp = a.rect(0.62, a.dc(0, wb, -2), 0.92, a.dc(0, wb, -48));
    a.stroke(0, cp.slice(0, 4), 1.6, 'down', 0.35); a.stitch(0, [[0.62, a.dc(0, wb, -48)], [0.92, a.dc(0, wb, -48)]], -3);
    for (const e of [0.62, 0.92]) a.stitch(0, a.along(0, e, a.dc(0, wb, -48), wb), 0);
    const fly = a.curve([[-0.13, wb], [-0.13, 0.75], [-0.08, 0.52], [0, 0.42]], 8);
    a.stroke(0, a.along(0, 0, 0.42, wb), 2.2, 'dark', 0.3); a.stroke(0, a.along(0, 0, 0.42, wb), 2, 'down', 0.4);
    a.stitch(0, fly, 0); a.stitch(0, fly, -6);
    a.fill(0, [...fly, [0, wb]], 'up', 0.2);
    a.seam(0, a.along(0, PI, -0.8, wb), 1);
    a.stitch(0, a.along(0, PI, -0.8, wb), 4); a.stitch(0, a.along(0, PI, -0.8, wb), -4);
    // legs: felled outseam (double stitched) and inseam
    for (const r of LEGS) if (a.has(r)) {
      a.topstitched(r, a.along(r, 0, -0.4, 2.3), [3, 8]);
      a.topstitched(r, a.along(r, PI, -0.4, 2.3), [-3]);
      a.topstitched(r, a.along(r, -PI, -0.4, 2.3), [3]);
      a.softLine(r, a.along(r, 0.06, 0, 2.2), 2.5, 'light', 0.12);
    }
  },
  trousers(a) {
    waistband(a, 1.75, 36, [0.55, 1.35, PI - 0.42]);
    const wb = a.dc(0, 1.75, -36);
    for (const s of [1, -1]) {
      // slant front pocket, back welt pocket with button, back dart
      const sl = [[s * 0.62, wb], [s * 1.08, a.dc(0, wb, -165)]];
      a.stroke(0, sl, 2.6, 'dark', 0.5); a.stroke(0, sl, 2.2, 'down', 0.5); a.stitch(0, sl, s * -4, { k: 0.5 });
      const wy = a.dc(0, wb, -65), wl = [[s * (PI - 0.22), wy], [s * (PI - 0.78), wy]];
      a.raised(0, [[s * (PI - 0.22), wy], [s * (PI - 0.78), wy], [s * (PI - 0.78), a.dc(0, wy, -6)], [s * (PI - 0.22), a.dc(0, wy, -6)], [s * (PI - 0.22), wy]], 0.4, 0.3);
      a.stroke(0, wl, 1.6, 'dark', 0.6);
      a.rivet(0, s * (PI - 0.5), a.dc(0, wy, -12), 10);
      a.seam(0, [[s * (PI - 0.5), wb], [s * (PI - 0.5), a.dc(0, wb, -55)]], 0.7);
      a.seam(0, a.along(0, s * PI / 2, -0.8, wb), 0.9);
    }
    const fly = a.curve([[-0.12, wb], [-0.12, 0.7], [-0.06, 0.5], [0, 0.42]], 8);
    a.stroke(0, a.along(0, 0, 0.42, wb), 2, 'dark', 0.35); a.stitch(0, fly, 0, { k: 0.45 });
    a.seam(0, a.along(0, PI, -0.8, wb), 0.9);
    for (const r of LEGS) if (a.has(r)) {
      a.seam(r, a.along(r, 0, -0.4, 2.3), 0.9); a.seam(r, a.along(r, PI, -0.4, 2.3), 0.8); a.seam(r, a.along(r, -PI, -0.4, 2.3), 0.8);
      // pressed creases (front and back): sharp ridge with a light line
      for (const th of [PI / 2, -PI / 2]) { a.stroke(r, a.along(r, th, 0.08, 2.3), 2.2, 'up', 0.5); a.stroke(r, a.along(r, th, 0.08, 2.3), 1.2, 'light', 0.08); }
    }
  },
  sweatpants(a) {
    // gathered elastic waist (ruching in the band), drawstring, side seam pockets
    const top = 1.7, b0 = a.dc(0, top, -45);
    for (let th = -PI; th < PI; th += 0.055) {
      const j = Math.sin(th * 37.1) * 0.012;
      a.stroke(0, [[th + j, a.dc(0, b0, 3)], [th - j, a.dc(0, top, -3)]], 2.2, 'down', 0.35);
      a.stroke(0, [[th + 0.022 + j, a.dc(0, b0, 3)], [th + 0.022 - j, a.dc(0, top, -3)]], 2.4, 'up', 0.3);
    }
    a.stitch(0, a.around(0, a.dc(0, b0, 4)), 0, { k: 0.7 });
    for (const s of [1, -1]) {
      const cord = a.curve([[s * 0.05, a.dc(0, top, -12)], [s * 0.07, a.dc(0, top, -60)], [s * 0.1, a.dc(0, top, -130)]], 6);
      a.stroke(0, cord, 4.5, 'up', 0.7); a.stroke(0, cord, 4, 'paint', 1); a.stroke(0, cord, 5.5, 'dark', 0.2, { alpha: 0.6 });
      a.rivet(0, s * 0.05, a.dc(0, top, -12), 5);
      const op = [[s * 1.15, a.dc(0, b0, -20)], [s * 1.42, a.dc(0, b0, -180)]];
      a.stroke(0, op, 2.4, 'dark', 0.45); a.stroke(0, op, 2.2, 'down', 0.45);
      a.seam(0, a.along(0, s * PI / 2, -0.8, b0), 0.8);
    }
    for (const r of LEGS) if (a.has(r)) { a.seam(r, a.along(r, 0, -0.4, 2.3), 0.8); a.seam(r, a.along(r, PI, -0.4, 2.3), 0.7); a.seam(r, a.along(r, -PI, -0.4, 2.3), 0.7); }
  },
  cargo(a) {
    waistband(a, 1.55, 40, [0.6, 1.4, PI - 0.4]);
    const wb = a.dc(0, 1.55, -40);
    for (const s of [1, -1]) {
      const sl = a.curve([[s * 0.45, wb], [s * 0.75, a.dc(0, wb, -70)], [s * 1.05, a.dc(0, wb, -110)]], 6);
      a.stroke(0, sl, 2.6, 'dark', 0.5); a.stroke(0, sl, 2.2, 'down', 0.5); a.stitch(0, sl, s * -4); a.stitch(0, sl, s * -9);
      // back flap pockets
      const y = a.dc(0, wb, -70), cx = s * (PI - 0.55);
      const pk = a.rect(cx - 0.32, y, cx + 0.32, a.dc(0, y, -140));
      a.raised(0, pk, 0.3, 0.25); a.stitch(0, pk, 3);
      const fl = a.rect(cx - 0.35, a.dc(0, y, 6), cx + 0.35, a.dc(0, y, -45));
      a.raised(0, fl, 0.5, 0.4); a.stitch(0, fl, 3); a.rivet(0, cx, a.dc(0, y, -35), 9);
      a.topstitched(0, a.along(0, s * PI / 2, -0.8, wb), [s * 3, s * 8]);
    }
    a.stroke(0, a.along(0, 0, 0.42, wb), 2.2, 'dark', 0.35);
    a.stitch(0, a.curve([[-0.13, wb], [-0.13, 0.72], [-0.07, 0.5], [0, 0.42]], 8), 0);
    a.topstitched(0, a.along(0, PI, -0.8, wb), [4, -4]);
    for (const r of LEGS) if (a.has(r)) {
      a.topstitched(r, a.along(r, 0, -0.4, 2.3), [3, 8]);
      a.topstitched(r, a.along(r, PI, -0.4, 2.3), [-3]); a.topstitched(r, a.along(r, -PI, -0.4, 2.3), [3]);
      // bellows side pocket with flap and snap (matches the relief bump, leg param 0.55..0.95)
      const p = a.rect(-0.5, 0.56, 0.5, 0.97);
      a.raised(r, p, 0.45, 0.35); a.stitch(r, p, 3); a.stitch(r, p, 8);
      const fl = a.rect(-0.55, 0.5, 0.55, 0.64);
      a.raised(r, fl, 0.7, 0.5); a.stitch(r, fl, 3);
      a.rivet(r, 0, 0.6, 10);
      // knee panel seams
      const f = legFront(r);
      for (const c of [0.88, 1.2]) a.topstitched(r, a.around(r, c, f - 1.1, f + 1.1), [3]);
    }
  },
  shorts(a) {
    waistband(a, 1.55, 36, [0.6, 1.45, PI - 0.4]);
    const wb = a.dc(0, 1.55, -36);
    for (const s of [1, -1]) {
      const sl = [[s * 0.5, wb], [s * 1.05, a.dc(0, wb, -150)]];
      a.stroke(0, sl, 2.6, 'dark', 0.5); a.stroke(0, sl, 2.2, 'down', 0.5); a.stitch(0, sl, s * -4, { k: 0.7 });
      const wy = a.dc(0, wb, -60);
      a.raised(0, a.rect(s * (PI - 0.25), wy, s * (PI - 0.78), a.dc(0, wy, -6)), 0.4, 0.3);
      a.stroke(0, [[s * (PI - 0.25), wy], [s * (PI - 0.78), wy]], 1.6, 'dark', 0.6);
      a.seam(0, a.along(0, s * PI / 2, -0.8, wb), 0.9);
    }
    a.stroke(0, a.along(0, 0, 0.42, wb), 2, 'dark', 0.35);
    a.stitch(0, a.curve([[-0.12, wb], [-0.12, 0.72], [-0.06, 0.5], [0, 0.42]], 8), 0, { k: 0.7 });
    a.seam(0, a.along(0, PI, -0.8, wb), 0.9);
    for (const r of LEGS) if (a.has(r)) { a.seam(r, a.along(r, 0, -0.4, 1), 0.9); a.seam(r, a.along(r, PI, -0.4, 1), 0.8); a.seam(r, a.along(r, -PI, -0.4, 1), 0.8); }
  },
  leggings(a) {
    // flatlock seams: flat, wide zigzag cover stitch
    const flat = (r, pts) => { a.stroke(r, pts, 4, 'up', 0.12); a.stroke(r, pts, 4.5, 'paint', 0.35, { dash: [0.8, 0.8] }); a.stroke(r, pts, 1, 'dark', 0.15); };
    flat(0, a.along(0, PI, -0.8, 2.2)); flat(0, a.along(0, 0, -0.8, 0.9));
    for (const s of [1, -1]) flat(0, a.curve([[s * PI / 2, 2.2], [s * (PI / 2 + 0.2), 1.0], [s * (PI / 2 + 0.6), -0.2]], 6));
    for (const r of LEGS) if (a.has(r)) { flat(r, a.along(r, PI, -0.4, 2.3)); flat(r, a.along(r, -PI, -0.4, 2.3)); }
  },
  skirt(a) { for (const s of [1, -1]) a.seam(0, a.along(0, s * PI / 2, -6, 2.3), 0.8); a.seam(0, a.along(0, PI, -6, 2.3), 0.6); a.raised(0, a.rect(PI - 0.04, a.dc(0, 1.7, -180), PI + 0.04, 2.3), 0.2, 0.3); },
  mini(a) {
    denimWash(a, { legs: false, seat: true, k: 0.8 });
    waistband(a, 1.75, 35, [0.6, 1.45, PI - 0.4]);
    const wb = a.dc(0, 1.75, -35);
    for (const s of [1, -1]) {
      const op = a.curve([[s * 0.33, wb], [s * 0.5, a.dc(0, wb, -55)], [s * 0.82, a.dc(0, wb, -80)], [s * 1.18, a.dc(0, wb, -90)]], 8);
      a.stroke(0, op, 2.6, 'dark', 0.45); a.stroke(0, op, 2.4, 'down', 0.5); a.stitch(0, op, s * -3.5); a.stitch(0, op, s * -9);
      a.rivet(0, s * 1.18, a.dc(0, wb, -88));
      a.topstitched(0, a.curve([[s * (PI / 2 + 0.05), a.dc(0, wb, -18)], [s * (PI - 0.5), a.dc(0, wb, -45)], [s * PI, a.dc(0, wb, -70)]], 8), [s * 3.5, s * 9.5]);
      const pt = a.dc(0, wb, -78), pb = a.dc(0, pt, -130), cx = s * (PI - 0.55), hw = 0.34;
      const bp = [[cx - hw, pt], [cx + hw, pt], [cx + hw * 0.92, a.dc(0, pb, 16)], [cx, pb], [cx - hw * 0.92, a.dc(0, pb, 16)], [cx - hw, pt]];
      a.raised(0, bp, 0.4, 0.28); a.stitch(0, bp, s * 3); a.stitch(0, bp, s * 8);
      a.topstitched(0, a.along(0, s * PI / 2, -3, wb), [s * 3, s * 8]);
    }
    a.stroke(0, a.along(0, 0, 0.55, wb), 2.2, 'dark', 0.3);
    a.stitch(0, a.curve([[-0.13, wb], [-0.13, 0.8], [-0.07, 0.62], [0, 0.55]], 8), 0);
    a.topstitched(0, a.along(0, 0, -3, 0.55), [4, -4]);
    a.topstitched(0, a.along(0, PI, -3, wb), [4, -4]);
  },
  pencil(a) {
    // centre back seam with a concealed zipper and a kick pleat at the hem, side seams, darts
    a.seam(0, a.along(0, PI, -6, 2.3), 0.9);
    a.stroke(0, a.along(0, PI, a.dc(0, 2.0, -190), 2.0), 2, 'dark', 0.35);
    a.rivet(0, PI, a.dc(0, 2.0, -6), 3);
    a.fill(0, a.rect(PI - 0.03, -6, PI + 0.09, -3.4), 'up', 0.3);
    a.stroke(0, a.along(0, PI - 0.03, -6, -3.4), 2, 'dark', 0.45);
    for (const s of [1, -1]) {
      a.seam(0, a.along(0, s * PI / 2, -6, 2.3), 0.85);
      a.seam(0, [[s * 0.5, 1.95], [s * 0.52, 1.35]], 0.7);
      a.seam(0, [[s * (PI - 0.55), 1.95], [s * (PI - 0.56), 1.15]], 0.7);
    }
  },
  dress(a) {
    for (const s of [1, -1]) {
      a.seam(0, a.curve([[s * 0.42, 2.0], [s * 0.4, 2.5], [s * 0.55, 3.1], [s * 0.78, 3.7]], 8), 0.8);
      a.seam(0, a.curve([[s * (PI - 0.5), 2.0], [s * (PI - 0.48), 2.8], [s * (PI - 0.65), 3.7]], 8), 0.8);
      a.seam(0, a.along(0, s * PI / 2, -6, 3.7), 0.8);
    }
    a.topstitched(0, a.around(0, 2.0), [-2.5], 0.9, { k: 0.5 });
    // back zipper
    a.seam(0, a.along(0, PI, -6, 5.2), 0.9);
    a.stroke(0, a.along(0, PI, 1.4, 5.0), 2, 'dark', 0.35);
    a.rivet(0, PI, 4.95, 3);
  },
  // shoes: above the ankle (leg param < 2) angles are in the shin frame (legFront =
  // front, -legFront = heel), on the foot (>= 2) in the foot frame (0 = top, +-pi = sole)
  sneakers(a) {
    for (const r of LEGS) {
      if (!a.has(r)) continue;
      const f = legFront(r);
      // tongue and lacing area on the instep, eyelets, laces
      const c0 = 2.03, c1 = 2.42;
      a.raised(r, [[-0.34, c0], [0.34, c0], [0.24, c1], [-0.24, c1], [-0.34, c0]], 0.3, 0.3);
      for (let i = 0; i < 6; i++) {
        const c = c0 + ((c1 - c0) * (i + 0.5)) / 6, w = 0.3 - i * 0.012;
        a.stroke(r, [[-w + 0.04, c], [w - 0.04, c + 0.035]], 3.2, 'up', 0.8);
        a.stroke(r, [[-w + 0.04, c], [w - 0.04, c + 0.035]], 3, 'paint', 0.9);
        for (const e of [-w, w]) a.rivet(r, e, c, 3.2);
      }
      // toe cap, side overlays, heel counter seam
      a.topstitched(r, a.around(r, 2.64, -1.5, 1.5), [-2.5], 0.9);
      for (const s of [1, -1]) a.topstitched(r, a.curve([[s * 0.45, 2.02], [s * 1.3, 2.18], [s * 1.7, 2.45], [s * 2.0, 2.7]], 6), [s * 2.5], 0.8);
      a.topstitched(r, a.along(r, -f, 1.6, 1.99), [3, -3], 0.8);
    }
  },
  dressshoes(a) {
    for (const r of LEGS) {
      if (!a.has(r)) continue;
      // cap toe with broguing, closed lacing (oxford), quarter seams, heel seam
      a.topstitched(r, a.around(r, 2.6, -1.5, 1.5), [-2], 0.9, { k: 0.5 });
      for (let th = -1.3; th <= 1.3; th += 0.09) a.fill(r, [[th, 2.63], [th + 0.025, 2.63], [th + 0.025, 2.645], [th, 2.645]], 'down', 0.6);
      a.raised(r, [[-0.22, 2.06], [0.22, 2.06], [0.2, 2.3], [-0.2, 2.3], [-0.22, 2.06]], 0.15, 0.3);
      for (let i = 0; i < 4; i++) { const c = 2.1 + i * 0.05; a.stroke(r, [[-0.17, c], [0.17, c + 0.01]], 2.4, 'up', 0.6); a.stroke(r, [[-0.17, c], [0.17, c + 0.01]], 2.2, 'paint', 0.9); }
      for (const s of [1, -1]) a.topstitched(r, a.curve([[s * 0.24, 2.05], [s * 0.9, 2.2], [s * 1.6, 2.15], [s * 2.1, 2.02]], 6), [s * 2], 0.8, { k: 0.5 });
      a.seam(r, a.along(r, -legFront(r), 1.6, 1.99), 0.8);
    }
  },
  boots(a) {
    for (const r of LEGS) {
      if (!a.has(r)) continue;
      const f = legFront(r);
      // tongue, lace hooks and laces up the shaft front and over the instep
      a.raised(r, a.rect(f - 0.32, 1.45, f + 0.32, 1.995), 0.2, 0.3);
      a.raised(r, a.rect(-0.3, 2.005, 0.3, 2.25), 0.2, 0.3);
      const lace = (c, th, w) => {
        a.stroke(r, [[th - w, c], [th + w, c + 0.04]], 3.2, 'up', 0.8);
        a.stroke(r, [[th - w, c], [th + w, c + 0.04]], 3, 'paint', 0.85);
        a.rivet(r, th - w - 0.06, c, 4); a.rivet(r, th + w + 0.06, c, 4);
      };
      for (let i = 0; i < 6; i++) lace(1.5 + i * 0.08, f, 0.26);
      for (let i = 0; i < 3; i++) lace(2.04 + i * 0.07, 0, 0.24);
      // quarter seams, heel seam, toe cap
      for (const s of [1, -1]) a.topstitched(r, a.along(r, f + s * 0.42, 1.4, 1.99), [s * 2.5, s * 6], 0.9);
      a.topstitched(r, a.around(r, 2.7, -1.6, 1.6), [-2.5, -6], 0.9);
      a.topstitched(r, a.along(r, -f, 1.4, 1.99), [3, -3], 0.8);
    }
  },
  socks(a) {
    for (const r of LEGS) {
      if (!a.has(r)) continue;
      // reinforced toe and heel (denser knit, a little darker), toe seam
      a.blob(r, 0, 2.85, 60, 40, 'dark', 0.12);
      a.blob(r, -legFront(r), 1.96, 45, 55, 'dark', 0.12);
      a.seam(r, a.around(r, 2.82, -1.4, 1.4), 0.6);
    }
  },
  underwear(a) { a.seam(0, a.along(0, 0, -0.8, 0.9), 0.5); for (const s of [1, -1]) a.seam(0, a.along(0, s * PI / 2, -0.8, 1.6), 0.5); },
};

/** Hardware material colors. */
export const HARDWARE = {
  shirt: { color: '#f2efe8', roughness: 0.35, metalness: 0 },
  blazer: { color: '#1d1b1a', roughness: 0.4, metalness: 0 },
  metal: { color: '#b8a27a', roughness: 0.35, metalness: 0.8 },
  zipper: { color: '#c8c8cc', roughness: 0.3, metalness: 0.8 },
};

/**
 * Thread colour of a garment: def.thread (contrast stitching: jeans gold, track
 * jacket white stripes), else a tone of the garment colour.
 */
export function threadColor(def, color) {
  if (def.thread) return def.thread;
  const c = new THREE.Color(color), hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * 0.85, hsl.l > 0.45 ? hsl.l * 0.72 : Math.min(1, hsl.l * 1.35 + 0.05));
  return '#' + c.getHexString();
}
