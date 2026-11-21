// Procedural eyeball texture (one CanvasTexture shared by every character).
//
// UV layout of the MakeHuman eye proxy (measured, see landmarks.js):
//   - each eyeball is a disc in UV space (radius ~0.27) with the gaze axis at its
//     centre; the UV radius grows ~linearly with the angle from the gaze axis
//     (iris edge ~0.113 <-> ~24 deg, the visible sclera ends ~0.24 <-> ~60 deg);
//   - both cornea shells map into a small disc near (0.935, 0.067) that must be
//     fully transparent (the material uses an alpha test).
//
// Colour encoding. The material library's eye shader re-tints the iris with the
// spec colour (render/materials.js eyeHook): it isolates the iris by luminance,
// detects the pupil as "red ~ 0" and multiplies the spec colour by
// (texel.r / 0.066). So this texture encodes the iris *structure* in the red
// channel (detail factor f in [0.25, 2.4] -> linear red = 0.066 * f), keeps
// green / blue low so the luminance stays inside the iris mask, paints a black
// pupil and a neutral, slightly warm sclera (luminance well above the mask).
// The same texel statistics as the stock eye.png, so every render style
// (realistic tint, clay, ink) keeps working; the colour itself is free to
// change through the spec without regenerating the texture.
import * as THREE from 'three';

/** Iris / pupil radii in UV units (fit to the eye proxy geometry). */
export const IRIS_UV = 0.113;
export const PUPIL_UV = 0.036;

const linToSrgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Periodic smooth 1D value noise with `cells` cells per period, values in [-1, 1]. */
function ringNoise(cells, seed) {
  const r = rng(seed), tab = new Float32Array(cells);
  for (let i = 0; i < cells; i++) tab[i] = r() * 2 - 1;
  return (x) => { // x in "cells" units, any real
    const f = Math.floor(x), t = x - f, s = t * t * (3 - 2 * t);
    const i0 = ((f % cells) + cells) % cells, i1 = (i0 + 1) % cells;
    return tab[i0] + (tab[i1] - tab[i0]) * s;
  };
}

/** Periodic-in-x 2D value noise (x wraps every `cx` cells), values in [0, 1]. */
function polarNoise(cx, cy, seed) {
  const r = rng(seed), tab = new Float32Array(cx * cy);
  for (let i = 0; i < tab.length; i++) tab[i] = r();
  const at = (i, j) => tab[(((i % cx) + cx) % cx) + Math.min(cy - 1, Math.max(0, j)) * cx];
  return (x, y) => {
    const fx = Math.floor(x), fy = Math.floor(y);
    let tx = x - fx, ty = y - fy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = at(fx, fy), b = at(fx + 1, fy), c = at(fx, fy + 1), d = at(fx + 1, fy + 1);
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Sclera palette (sRGB 0..255): neutral warm white at the limbus, slightly pink
// in the corners where the lids hide it anyway.
const SCLERA_IN = [214, 208, 200];
const SCLERA_MID = [207, 197, 189];
const SCLERA_OUT = [196, 168, 160];

/**
 * Builds the texture. centers: [[u, v], [u, v]] UV of the gaze axis of each
 * eyeball (from the geometry). size: texture resolution (power of two).
 */
export function createEyeTexture(centers, size = 1024) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true });

  // ---- sclera: opaque base everywhere (mip levels must not bleed transparency into the balls)
  g.fillStyle = `rgb(${SCLERA_OUT.join(',')})`;
  g.fillRect(0, 0, size, size);
  const veinRnd = rng(91);
  for (const [u, v] of centers) {
    const cx = u * size, cy = (1 - v) * size;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 0.28 * size);
    grad.addColorStop(0, `rgb(${SCLERA_IN.join(',')})`);
    grad.addColorStop(0.45, `rgb(${SCLERA_IN.join(',')})`);
    grad.addColorStop(0.72, `rgb(${SCLERA_MID.join(',')})`);
    grad.addColorStop(1, `rgb(${SCLERA_OUT.join(',')})`);
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, 0.28 * size, 0, Math.PI * 2); g.fill();
    drawVeins(g, cx, cy, size, veinRnd);
  }

  // ---- iris + pupil, per pixel (only the squares around the irises)
  const fib1 = ringNoise(53, 7), fib2 = ringNoise(131, 11), fib3 = ringNoise(257, 13), jag = ringNoise(13, 17);
  const crypts = polarNoise(23, 6, 19), tone = polarNoise(9, 3, 23);
  const rIn = PUPIL_UV * size, rOut = IRIS_UV * size, blend = 0.017 * size;
  const R = Math.ceil(rOut + blend + 2);
  for (const [u, v] of centers) {
    const cx = u * size, cy = (1 - v) * size;
    const x0 = Math.max(0, Math.floor(cx - R)), y0 = Math.max(0, Math.floor(cy - R));
    const w = Math.min(size, Math.ceil(cx + R)) - x0, h = Math.min(size, Math.ceil(cy + R)) - y0;
    const img = g.getImageData(x0, y0, w, h), d = img.data;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        // supersample 2x2 only near the pupil / limbus edges
        const rc = Math.hypot(x0 + i + 0.5 - cx, y0 + j + 0.5 - cy);
        if (rc > rOut + blend + 1) continue;
        const ns = Math.abs(rc - rIn) < 1.5 || rc > rOut + blend - 1.5 ? 4 : 1;
        let ar = 0, ag = 0, ab = 0, cover = 0;
        for (let s = 0; s < ns; s++) {
          const px = ns === 1 ? x0 + i + 0.5 - cx : x0 + i + 0.25 + 0.5 * (s & 1) - cx;
          const py = ns === 1 ? y0 + j + 0.5 - cy : y0 + j + 0.25 + 0.5 * (s >> 1) - cy;
          const rho = Math.hypot(px, py);
          if (rho > rOut + blend) continue;
          const phi = Math.atan2(py, px) / (Math.PI * 2) + 0.5; // 0..1
          let cr, cg, cb, k = 1;
          if (rho < rIn) { cr = cg = cb = 0; } // pupil (pure black: the shader detects it)
          else {
            const t = (rho - rIn) / (rOut - rIn); // 0 pupil edge .. 1 iris edge
            const f = irisDetail(t, phi, fib1, fib2, fib3, jag, crypts, tone);
            const rl = 0.066 * Math.min(2.4, Math.max(0.25, f));
            cr = linToSrgb(rl) * 255; cg = cr * 0.3; cb = cr * 0.2;
            if (rho > rOut) k = 1 - smooth(rOut, rOut + blend, rho); // limbal blend into the sclera
          }
          ar += cr * k; ag += cg * k; ab += cb * k; cover += k;
        }
        if (cover <= 0) continue;
        const o = (j * w + i) * 4, c = cover / ns;
        // composite over the sclera already in the canvas
        d[o] = ar / ns + d[o] * (1 - c);
        d[o + 1] = ag / ns + d[o + 1] * (1 - c);
        d[o + 2] = ab / ns + d[o + 2] * (1 - c);
      }
    }
    g.putImageData(img, x0, y0);
  }

  // ---- transparent block for the cornea shells (u > 0.58, v < 0.39): large and
  // touching the texture corner so even small mip levels keep the cornea clear.
  g.clearRect(Math.floor(0.58 * size), Math.ceil(0.61 * size), size, size);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.name = 'pv-face-eye';
  return tex;
}

/**
 * Iris structure factor (1 = nominal iris colour). t: 0 at the pupil edge, 1 at
 * the limbus; phi: angle 0..1.
 */
function irisDetail(t, phi, fib1, fib2, fib3, jag, crypts, tone) {
  // radial fibres (wavy: the phase drifts with the radius)
  const fib = 0.5 * fib1(phi * 53 + 1.6 * t) + 0.32 * fib2(phi * 131 - 2.3 * t) + 0.18 * fib3(phi * 257 + 0.7 * t);
  let f = 1 + 0.34 * fib;
  // collarette: bright, jagged ring ~1/3 of the way out
  const tc = 0.3 + 0.05 * jag(phi * 13);
  f += 0.55 * Math.exp(-(((t - tc) / 0.07) ** 2));
  // pupillary zone a little lighter, ciliary zone darker towards the limbus
  f *= t < tc ? 1.12 : 1 - 0.42 * smooth(0.55, 1.0, t);
  // crypts (dark lacunae) in the ciliary zone
  const cr = crypts(phi * 23, t * 5);
  f *= 1 - 0.5 * smooth(0.62, 0.8, cr) * smooth(0.3, 0.42, t) * (1 - smooth(0.82, 0.95, t));
  // slow tonal variation so the iris is not perfectly uniform
  f *= 0.9 + 0.2 * tone(phi * 9, t * 2);
  // pupillary ruff (dark rim at the pupil) and limbal ring
  f *= 0.35 + 0.65 * smooth(0, 0.07, t);
  f *= 1 - 0.6 * smooth(0.84, 1.0, t);
  return f;
}

/** Faint conjunctival vessels in the outer sclera (they stay well above the iris luminance mask). */
function drawVeins(g, cx, cy, size, rnd) {
  g.save();
  g.lineCap = 'round';
  for (let n = 0; n < 16; n++) {
    let a = rnd() * Math.PI * 2;
    let r = (0.255 + rnd() * 0.012) * size;
    const steps = 6 + Math.floor(rnd() * 6);
    let x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    let wdt = (1.1 + rnd() * 1.4) * size / 1024;
    g.strokeStyle = `rgba(${150 + rnd() * 30 | 0}, ${70 + rnd() * 20 | 0}, ${70 + rnd() * 20 | 0}, ${0.1 + rnd() * 0.14})`;
    for (let s = 0; s < steps; s++) {
      a += (rnd() - 0.5) * 0.12;
      r -= (0.006 + rnd() * 0.008) * size;
      if (r < 0.15 * size) break;
      const nx = cx + Math.cos(a) * r, ny = cy + Math.sin(a) * r;
      g.lineWidth = wdt;
      g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      x = nx; y = ny; wdt *= 0.86;
    }
  }
  g.restore();
}
