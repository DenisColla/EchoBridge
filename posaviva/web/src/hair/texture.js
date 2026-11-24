// Procedural strand texture (shared by every character): fine longitudinal
// streaks with soft brightness variation. u runs around a clump (2 repeats),
// v along it (1 repeat every 9 cm). Kept subtle (85-100 % brightness) so toon
// bands and ink lines stay clean; clay / lines styles ignore colour maps.
import * as THREE from 'three';
import { rng } from './util.js';

let tex = null;

export function strandTexture() {
  if (tex) return tex;
  const W = 128, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  const rnd = rng(0x5eed);
  // per-column base brightness (strands), smoothed horizontally, with slow drift along v
  const col = new Float32Array(W), drift = new Float32Array(W);
  for (let x = 0; x < W; x++) { col[x] = rnd(); drift[x] = rnd() * Math.PI * 2; }
  const sm = new Float32Array(W);
  for (let x = 0; x < W; x++) sm[x] = (col[(x + W - 1) % W] + 2 * col[x] + col[(x + 1) % W]) / 4;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const along = 0.5 + 0.5 * Math.sin((y / H) * Math.PI * 2 * 2 + drift[x]);
      const v = 0.86 + 0.1 * sm[x] + 0.04 * along;
      const c = Math.round(Math.min(1, v) * 255);
      const i = (y * W + x) * 4;
      img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.name = 'pv-hair-strands';
  return tex;
}

let stub = null;
/** Stubble tile (UV metres / STUBBLE_TILE): white, alpha = soft follicle dots over a faint base. */
export const STUBBLE_TILE = 0.014;
export function stubbleTexture() {
  if (stub) return stub;
  const S = 128, N = 14; // ~1 mm between follicles
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  const A = new Float32Array(S * S).fill(0.3);
  const rnd = rng(0x57abb1e);
  const cell = S / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (rnd() < 0.12) continue; // a few gaps
    const cx = (i + 0.2 + 0.6 * rnd()) * cell, cy = (j + 0.2 + 0.6 * rnd()) * cell;
    // short slanted stroke: a stretched dot, mostly pointing down
    const r = cell * (0.22 + 0.14 * rnd()), ang = Math.PI / 2 + (rnd() - 0.5) * 0.9, el = 1.6 + rnd();
    const ca = Math.cos(ang), sa = Math.sin(ang), a = 0.8 + 0.2 * rnd();
    const ext = Math.ceil(r * el + 2);
    for (let y = Math.floor(cy - ext); y <= Math.ceil(cy + ext); y++) for (let x = Math.floor(cx - ext); x <= Math.ceil(cx + ext); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = (dx * ca + dy * sa) / el, v = -dx * sa + dy * ca;
      const d = Math.sqrt(u * u + v * v) / r;
      if (d >= 1) continue;
      const k = ((y % S) + S) % S * S + ((x % S) + S) % S;
      A[k] = Math.max(A[k], 0.3 + (a - 0.3) * (1 - d * d));
    }
  }
  for (let k = 0; k < S * S; k++) { const o = k * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = Math.round(A[k] * 255); }
  g.putImageData(img, 0, 0);
  stub = new THREE.CanvasTexture(cv);
  stub.wrapS = stub.wrapT = THREE.RepeatWrapping;
  stub.anisotropy = 4;
  stub.name = 'pv-stubble';
  return stub;
}
