// Small procedural textures of the environment layer (generated once on a 2D
// canvas, shared): neutral ground detail (the hue comes from vertex colours),
// water ripples, a round flake sprite.
import * as THREE from 'three';
import { makeRng } from '../rand.js';

const cache = new Map();

function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

/** Periodic gradient noise (lattice wrapped every `period` cells): seamless tiles, no artifacts. */
function periodicNoise(seed) {
  const rnd = makeRng(seed);
  const G = new Float32Array(512 * 2);
  for (let i = 0; i < 512; i++) { const a = rnd() * Math.PI * 2; G[i * 2] = Math.cos(a); G[i * 2 + 1] = Math.sin(a); }
  const hash = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 512;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, P) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const w = (v) => ((v % P) + P) % P;
    const g = (ix, iy, dx, dy) => { const h = hash(w(ix), w(iy)) * 2; return G[h] * dx + G[h + 1] * dy; };
    const u = fade(xf), v = fade(yf);
    const a = g(xi, yi, xf, yf), b = g(xi + 1, yi, xf - 1, yf), c = g(xi, yi + 1, xf, yf - 1), d = g(xi + 1, yi + 1, xf - 1, yf - 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.41;
  };
}

/** Tileable height field (periodic fbm) -> Float32Array size*size in 0..1. `cells`: lattice cells per tile at octave 0. */
function tileField(size, seed, cells, oct = 5, extra = null) {
  const n = periodicNoise(seed);
  const hf = new Float32Array(size * size);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, amp = 1, f = cells;
    for (let o = 0; o < oct; o++) { v += amp * n((x / size) * f, (y / size) * f, f); amp *= 0.5; f *= 2; }
    if (extra) v = extra(v, x, y);
    hf[y * size + x] = v;
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  for (let i = 0; i < hf.length; i++) hf[i] = (hf[i] - lo) / (hi - lo || 1);
  return hf;
}

function normalCanvas(hf, size, strength) {
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const H = (x, y) => hf[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    let nx = -dx, ny = dy, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Neutral ground detail: soft light-grey mottling + pebbles, with a matching normal map. */
export function groundDetail() {
  if (cache.has('ground')) return cache.get('ground');
  const S = 256;
  const hf = tileField(S, 71, 4, 5);
  const fine = tileField(S, 13, 32, 2);
  const c = canvas(S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S), d = img.data;
  const h2 = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const v = 0.88 + (hf[i] - 0.5) * 0.14 + (fine[i] - 0.5) * 0.1;
    const g = Math.max(0, Math.min(255, v * 255));
    d[i * 4] = g; d[i * 4 + 1] = g; d[i * 4 + 2] = g; d[i * 4 + 3] = 255;
    h2[i] = hf[i] * 0.6 + fine[i] * 0.4;
  }
  ctx.putImageData(img, 0, 0);
  const out = { map: tex(c, true), normalMap: tex(normalCanvas(h2, S, 2.6), false) };
  cache.set('ground', out);
  return out;
}

/** Water ripples normal map. */
export function waterNormal() {
  if (cache.has('water')) return cache.get('water');
  const S = 256;
  const hf = tileField(S, 5, 6, 4, (v, x) => v + 0.25 * Math.sin((x / S) * Math.PI * 2 * 6 + v * 3));
  const t = tex(normalCanvas(hf, S, 2.4), false);
  cache.set('water', t);
  return t;
}

/** Round soft sprite (snow flakes). */
export function flakeSprite() {
  if (cache.has('flake')) return cache.get('flake');
  const S = 64, c = canvas(S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set('flake', t);
  return t;
}
