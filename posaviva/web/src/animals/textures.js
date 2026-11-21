// Procedural textures of the animals (generated once, cached):
//  - tileable fur / skin detail normal maps per coat type
//  - eye textures (iris + pupil shape) laid out for a front planar projection
// The eye texture follows the luminance conventions of the material library
// eye shader (iris dark and reddish, pupil pure black, sclera light), so the
// iris tint, the clay mannequin eye and the ink circles of the lines style work.
import * as THREE from 'three';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Periodic value noise on an n x n lattice (wraps). */
function periodicNoise(n, seed) {
  const r = rng(seed), tab = new Float32Array(n * n);
  for (let i = 0; i < tab.length; i++) tab[i] = r();
  return (x, y) => {
    const fx = Math.floor(x), fy = Math.floor(y);
    let tx = x - fx, ty = y - fy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const i0 = ((fx % n) + n) % n, j0 = ((fy % n) + n) % n, i1 = (i0 + 1) % n, j1 = (j0 + 1) % n;
    const a = tab[i0 + j0 * n], b = tab[i1 + j0 * n], c = tab[i0 + j1 * n], d = tab[i1 + j1 * n];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

const FUR = {
  // strokes: count, length (px), width, jitter of the direction; base noise amplitude
  short: { strokes: 2600, len: [5, 11], width: 1.1, alpha: 0.35, noise: 0.5, nf: 32, blur: 0.6 },
  long: { strokes: 1500, len: [14, 30], width: 1.6, alpha: 0.32, noise: 0.6, nf: 12, blur: 0.8 },
  smooth: { strokes: 1800, len: [6, 12], width: 1, alpha: 0.18, noise: 0.25, nf: 24, blur: 1 },
  wool: { curls: 420, noise: 0.5, nf: 24, blur: 1 },
  wrinkle: { cells: 46, noise: 0.6, nf: 8, blur: 1 },
  bristle: { strokes: 900, len: [8, 18], width: 1.2, alpha: 0.45, noise: 0.35, nf: 20, blur: 0.5 },
  feather: { strokes: 700, len: [10, 22], width: 2.6, alpha: 0.25, noise: 0.4, nf: 10, blur: 1 },
  scales: { scales: 18, noise: 0.25, nf: 16, blur: 0.6 },
};

const furCache = new Map();

/** Tileable tangent-space normal map for a coat type (CanvasTexture, repeat wrapping). */
export function furNormalMap(type = 'short') {
  let t = furCache.get(type);
  if (t) return t;
  const cfg = FUR[type] || FUR.short;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#808080';
  g.fillRect(0, 0, S, S);
  const r = rng(type.length * 977 + 13);
  const wrapDraw = (fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy); };
  if (cfg.strokes) {
    g.lineCap = 'round';
    for (let i = 0; i < cfg.strokes; i++) {
      const x = r() * S, y = r() * S, l = cfg.len[0] + r() * (cfg.len[1] - cfg.len[0]);
      const a = Math.PI / 2 + (r() - 0.5) * 0.7; // mostly along v
      const v = r() < 0.5 ? 255 : 0;
      g.strokeStyle = `rgba(${v},${v},${v},${cfg.alpha * (0.5 + r() * 0.5)})`;
      g.lineWidth = cfg.width * (0.6 + r() * 0.8);
      const dx = Math.cos(a) * l, dy = Math.sin(a) * l, bend = (r() - 0.5) * l * 0.4;
      wrapDraw((ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + dx / 2 + bend, y + oy + dy / 2, x + ox + dx, y + oy + dy); g.stroke(); });
    }
  }
  if (cfg.curls) {
    for (let i = 0; i < cfg.curls; i++) {
      const x = r() * S, y = r() * S, rad = 3 + r() * 6;
      wrapDraw((ox, oy) => {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.7, 'rgba(160,160,160,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, rad, 0, Math.PI * 2); g.fill();
      });
    }
  }
  if (cfg.scales) {
    const n = cfg.scales, cs = S / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i + (j % 2) * 0.5) * cs, y = j * cs * 0.9;
      wrapDraw((ox, oy) => {
        const gr = g.createRadialGradient(x + ox, y + oy - cs * 0.2, 0, x + ox, y + oy, cs * 0.7);
        gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.85, 'rgba(128,128,128,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(x + ox, y + oy, cs * 0.62, cs * 0.55, 0, 0, Math.PI * 2); g.fill();
      });
    }
  }
  const img = g.getImageData(0, 0, S, S);
  const hgt = new Float32Array(S * S);
  const nz = periodicNoise(cfg.nf, 7 + type.length);
  const nz2 = periodicNoise(cfg.nf * 2, 11 + type.length);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x / S) * cfg.nf, v = (y / S) * cfg.nf;
    hgt[y * S + x] = img.data[(y * S + x) * 4] / 255 + cfg.noise * (nz(u, v) * 0.6 + nz2(u * 2, v * 2) * 0.4 - 0.5);
  }
  if (cfg.cells) { // wrinkled skin: cracks along the edges of a jittered cell grid + low folds
    const n = cfg.cells, pts = [];
    const rr = rng(91);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push([0.2 + rr() * 0.6, 0.2 + rr() * 0.6]);
    const fold = periodicNoise(4, 5);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const px = x / S, py = y / S, ci = Math.floor(px * n), cj = Math.floor(py * n);
      let d1 = 9, d2 = 9;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (((ci + di) % n) + n) % n, jj = (((cj + dj) % n) + n) % n, p = pts[ii + jj * n];
        const d = Math.hypot(px - (ci + di + p[0]) / n, py - (cj + dj + p[1]) / n);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      const edge = Math.min(1, (d2 - d1) * n * 3);
      hgt[y * S + x] += edge * 0.9 + Math.sin((py * 3 + fold(px * 4, py * 4) * 0.8) * Math.PI * 2) * 0.25;
    }
  }
  // blur once (wrap) to soften aliasing
  const b = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let s = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += hgt[((y + j + S) % S) * S + ((x + i + S) % S)] * (i || j ? 1 : 2);
    b[y * S + x] = hgt[y * S + x] * (1 - cfg.blur) + (s / 10) * cfg.blur;
  }
  const out = g.createImageData(S, S);
  const k = 2.2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const hx = b[y * S + ((x + 1) % S)] - b[y * S + ((x - 1 + S) % S)];
    const hy = b[((y + 1) % S) * S + x] - b[((y - 1 + S) % S) * S + x];
    let nx = -hx * k, ny = hy * k, nzz = 1;
    const l = Math.hypot(nx, ny, nzz);
    nx /= l; ny /= l; nzz /= l;
    const o = (y * S + x) * 4;
    out.data[o] = (nx * 0.5 + 0.5) * 255; out.data[o + 1] = (ny * 0.5 + 0.5) * 255; out.data[o + 2] = (nzz * 0.5 + 0.5) * 255; out.data[o + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.name = 'pv-animal-fur-' + type;
  furCache.set(type, t);
  return t;
}

const eyeCache = new Map();

/**
 * Eye texture for a pupil shape: 'round' | 'slit' (vertical, cats/foxes) |
 * 'bar' (horizontal, goats/sheep/horses/deer/cows). Front planar layout:
 * the gaze axis is the texture centre, the iris fills most of it.
 */
export function eyeTexture(pupil = 'round', irisFrac = 0.86) {
  const key = pupil + ':' + irisFrac;
  let t = eyeCache.get(key);
  if (t) return t;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const img = g.createImageData(S, S);
  const R = S / 2, rIris = R * irisFrac;
  const fib = periodicNoise(64, 3), fib2 = periodicNoise(160, 9);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5 - R) / R, dy = (y + 0.5 - R) / R, d = Math.hypot(dx, dy) * R;
    const ang = (Math.atan2(dy, dx) / (Math.PI * 2) + 0.5);
    let r, gg, bb;
    if (d > rIris) { // sclera (hidden by the lids most of the time)
      r = 168; gg = 160; bb = 152;
    } else {
      const t = d / rIris;
      const f = 0.75 + 0.35 * fib(ang * 64, t * 4) + 0.25 * fib2(ang * 160, t * 2);
      const limbal = 1 - 0.55 * Math.pow(Math.max(0, (t - 0.78) / 0.22), 1.5);
      const collar = 1 + 0.25 * Math.exp(-((t - 0.32) ** 2) / 0.01);
      const k = f * limbal * collar;
      r = 74 * k; gg = 52 * k; bb = 38 * k; // red ~0.066 linear on average (see the eye shader)
    }
    // pupil
    let inP;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (pupil === 'slit') inP = (ax / 0.07) ** 2 + (ay / 0.62) ** 2 < 1;
    else if (pupil === 'bar') inP = (ax / 0.42) ** 4 + (ay / 0.16) ** 2 < 1;
    else inP = d < R * 0.3;
    if (inP) { r = 0; gg = 0; bb = 0; }
    const o = (y * S + x) * 4;
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = bb; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.name = 'pv-animal-eye-' + pupil;
  eyeCache.set(key, t);
  return t;
}
