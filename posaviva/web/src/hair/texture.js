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
