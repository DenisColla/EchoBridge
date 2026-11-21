// Coat pattern helpers (build time). A species `coat(v)` receives the vertex
// info {p, n, part, t, bone, region} and returns masks {under, pattern,
// points, extra, shade} in 0..1 (see coatColor.js for how they are coloured).
import { fbm, noise3 } from '../engine/sdf.js';
import { clamp01, sstep } from './builder.js';

export { fbm, noise3, clamp01, sstep };

/** Lighter underside: downward-facing torso, throat, inner legs, chin. */
export function underside(v, { torso = 0.15, neck = 0.25, legs = 0.4, soft = 0.35 } = {}) {
  const { n, part } = v;
  if (part === 'torso' || part === 'chest' || part === 'belly') return sstep(torso, torso + soft, -n[1]);
  if (part === 'neck') return sstep(neck, neck + soft, -n[1] * 0.7 + n[2] * 0.7);
  if (part === 'jaw' || part === 'chin') return sstep(-0.2, 0.4, -n[1]);
  if (part === 'leg' || part === 'thigh' || part === 'arm') {
    const inner = -Math.sign(v.p[0] || 1) * n[0];
    return sstep(legs, legs + soft, inner) * 0.8;
  }
  if (part === 'tail') return sstep(0.2, 0.7, -n[1]) * 0.6;
  return 0;
}

/** Fine fur value variation (+ optional grizzle). */
export function furShade(v, freq = 60, amp = 0.5) {
  const p = v.p;
  return 0.5 + amp * 0.5 * fbm(p[0] * freq, p[1] * freq, p[2] * freq, 3, 7);
}

/** Banded stripes along a scalar coordinate with noise warp and break-up. */
export function stripes(phi, width = 0.3, breakup = 0) {
  const s = Math.abs(Math.sin(Math.PI * phi));
  let m = sstep(1 - width - 0.06, 1 - width + 0.06, s);
  if (breakup > 0) m *= sstep(breakup - 0.1, breakup + 0.1, 0.5 + 0.5 * breakup);
  return m;
}

/** Large irregular patches (cow, pinto): value noise threshold. */
export function patches(p, freq = 3, thr = 0.1, seed = 3) {
  const f = fbm(p[0] * freq, p[1] * freq, p[2] * freq, 4, seed);
  return sstep(thr - 0.04, thr + 0.04, f);
}

/** Cellular (Voronoi) cells: returns {d1, d2} distances to the nearest seeds in a jittered grid. */
export function cells(p, scale, seed = 1) {
  const x = p[0] * scale, y = p[1] * scale, z = p[2] * scale;
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d1 = 1e9, d2 = 1e9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const r1 = 0.5 + 0.45 * noise3(cx * 7.13 + 0.5, cy * 3.71 + 0.5, cz * 5.37 + 0.5, seed);
    const r2 = 0.5 + 0.45 * noise3(cx * 2.91 + 0.5, cy * 6.17 + 0.5, cz * 4.43 + 0.5, seed + 3);
    const r3 = 0.5 + 0.45 * noise3(cx * 5.53 + 0.5, cy * 2.39 + 0.5, cz * 7.77 + 0.5, seed + 5);
    const dx = cx + r1 - x, dy = cy + r2 - y, dz = cz + r3 - z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return { d1, d2 };
}

export const near = (p, c, r0, r1) => 1 - sstep(r0, r1, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));

// ------------------------------------------------------------------ declarative coats
const LEGLIKE = new Set(['leg', 'paw', 'claw', 'hoof', 'thigh']);
const HEADLIKE = new Set(['head', 'muzzle', 'jaw', 'nose', 'eyelid', 'ear', 'ruff']);

function lowLeg(v, lm, y0, y1) {
  if (!LEGLIKE.has(v.part)) return 0;
  if (v.part === 'thigh') return 0;
  return 1 - sstep(y0 * lm.H, y1 * lm.H, v.p[1]);
}

/** Body region tests shared by the coats. */
export const R = {
  under: (v, o = {}) => underside(v, o),
  legs: lowLeg,
  dorsal: (v) => ((v.part === 'torso' || v.part === 'neck' || v.part === 'mane' || v.part === 'thigh') ? sstep(0.15, 0.6, v.n[1]) : 0),
  muzzle: (v) => (v.part === 'muzzle' || v.part === 'nose' ? 1 : v.part === 'jaw' ? 0.8 : 0),
  ears: (v) => (v.part === 'ear' ? 1 : 0),
  earBack: (v) => (v.part === 'ear' ? sstep(-0.2, 0.4, -v.n[2]) : 0),
  tailTip: (v, t0 = 0.8) => (v.part === 'tail' || v.part === 'tuft' || v.part === 'tailhair' ? (v.part === 'tuft' ? 1 : sstep(t0, t0 + 0.08, v.t)) : 0),
  tail: (v) => (v.part === 'tail' || v.part === 'tuft' || v.part === 'tailhair' ? 1 : 0),
  mane: (v) => (v.part === 'mane' || v.part === 'tailhair' || v.part === 'tuft' ? 1 : 0),
  head: (v) => (HEADLIKE.has(v.part) ? 1 : 0),
  chest: (v) => (v.part === 'chest' ? sstep(0.0, 0.6, v.n[2]) : v.part === 'neck' ? sstep(0.3, 0.8, v.n[2] * 0.6 - v.n[1] * 0.8) * 0.8 : 0),
  rump: (v, lm) => ((v.part === 'torso' || v.part === 'thigh') && v.p[2] < lm.hip[2] + 0.05 * lm.H ? sstep(-0.2, 0.5, -v.n[2]) * sstep(lm.hip[1] - 0.25 * lm.H, lm.hip[1], v.p[1]) : 0),
  eyes: (v, lm) => { const e = lm.B?.eyes?.[0]; if (!e) return 0; const d = Math.min(Math.hypot(v.p[0] - e.pos[0], v.p[1] - e.pos[1], v.p[2] - e.pos[2]), Math.hypot(v.p[0] + e.pos[0], v.p[1] - e.pos[1], v.p[2] - e.pos[2])); return 1 - sstep(e.r * 1.25, e.r * 1.9, d); },
};

/** Body-flow coordinate for stripes: along the body on torso/neck, vertical on legs, along the tail. */
function flow(v, lm, warp = 1) {
  const p = v.p, H = lm.H;
  const n = fbm(p[0] * 6 / H, p[1] * 6 / H, p[2] * 6 / H, 3, 5) * 0.35 * warp;
  if (LEGLIKE.has(v.part) && v.part !== 'thigh') return p[1] / H * 7 + n;
  if (v.part === 'tail' || v.part === 'tuft') return v.t * 9 + n;
  if (HEADLIKE.has(v.part)) return (p[2] / H) * 18 + p[1] / H * 4 + n * 1.5;
  if (v.part === 'neck' || v.part === 'mane') return (p[2] - p[1] * 0.5) / H * 8 + n;
  return p[2] / H * 7.5 + (p[1] / H) * 1.2 * Math.sign(p[2]) + n;
}

/**
 * Declarative coat: {under, legs:[y0,y1], ears, muzzle, tailTip, mane, saddle,
 * pattern: {type: 'stripes'|'tabby'|'patches'|'giraffe'|'grizzle'|'spots'|'zebra', ...},
 * extra: {tailTip, chest, rump, under, muzzle, legs:[y0,y1], eyes, belly}, shade}
 * Returns (v, lm) -> masks.
 */
export function mkCoat(o = {}) {
  return (v, lm) => {
    const m = { under: 0, pattern: 0, points: 0, extra: 0, shade: 0.5 };
    if (o.under) m.under = R.under(v, typeof o.under === 'object' ? o.under : {}) * (typeof o.under === 'number' ? o.under : o.under.amount ?? 0.7);
    let pts = 0;
    if (o.legs) pts = Math.max(pts, R.legs(v, lm, o.legs[0], o.legs[1]));
    if (o.ears) pts = Math.max(pts, R.ears(v) * (o.ears === 'back' ? R.earBack(v) : 1));
    if (o.muzzle) pts = Math.max(pts, R.muzzle(v) * o.muzzle);
    if (o.tailTip) pts = Math.max(pts, R.tailTip(v, o.tailTip));
    if (o.mane) pts = Math.max(pts, R.mane(v) * o.mane);
    if (o.tail) pts = Math.max(pts, R.tail(v) * o.tail);
    if (o.eyes) pts = Math.max(pts, R.eyes(v, lm) * o.eyes);
    m.points = pts;
    const P = o.pattern;
    if (P) {
      const p = v.p, H = lm.H;
      let pat = 0;
      if (P.type === 'stripes' || P.type === 'zebra' || P.type === 'tabby') {
        const phi = flow(v, lm, P.warp ?? 1) * (P.freq ?? 1);
        pat = stripes(phi, P.width ?? 0.35);
        if (P.breakup) pat *= sstep(-0.15, 0.15, fbm(p[0] * 9 / H, p[1] * 9 / H, p[2] * 9 / H, 2, 9) + P.breakup);
        if (P.belly !== undefined) pat *= 1 - R.under(v) * P.belly;
        if (P.headK !== undefined && HEADLIKE.has(v.part)) pat *= P.headK;
      } else if (P.type === 'patches') {
        pat = patches(p, (P.freq ?? 3) / H, P.thr ?? 0.05, P.seed ?? 3);
        if (P.legsWhite) pat *= 1 - lowLeg(v, lm, P.legsWhite[0], P.legsWhite[1]);
      } else if (P.type === 'giraffe') {
        const c = cells(p, (P.scale ?? 7) / H, 2);
        pat = sstep(0.04, 0.09, c.d2 - c.d1) * (1 - lowLeg(v, lm, 0.1, 0.35) * 0.9) * (1 - R.under(v) * 0.6);
      } else if (P.type === 'grizzle') {
        pat = clamp01(0.5 + fbm(p[0] * 40 / H, p[1] * 40 / H, p[2] * 40 / H, 2, 11)) * (P.amount ?? 0.6);
      } else if (P.type === 'saddle') {
        pat = clamp01(R.dorsal(v) * (v.part === 'tail' ? 0.9 : 1) + (v.part === 'tail' ? sstep(0.1, 0.5, v.n[1]) * 0.8 : 0) + R.muzzle(v) * 0.85 + (v.part === 'ear' ? 0.9 : 0));
        pat = clamp01(pat + 0.2 * fbm(p[0] * 20 / H, p[1] * 20 / H, p[2] * 20 / H, 3, 2));
      } else if (P.type === 'spots') {
        const c = cells(p, (P.scale ?? 14) / H, 4);
        pat = 1 - sstep(P.r ?? 0.18, (P.r ?? 0.18) + 0.06, c.d1);
      }
      m.pattern = clamp01(pat * (P.amount ?? 1));
    }
    if (o.extra) {
      const X = o.extra;
      let e = 0;
      if (X.tailTip) e = Math.max(e, R.tailTip(v, X.tailTip));
      if (X.chest) e = Math.max(e, R.chest(v) * X.chest);
      if (X.rump) e = Math.max(e, R.rump(v, lm) * X.rump);
      if (X.under) e = Math.max(e, R.under(v) * X.under);
      if (X.muzzle) e = Math.max(e, R.muzzle(v) * X.muzzle);
      if (X.legs) e = Math.max(e, lowLeg(v, lm, X.legs[0], X.legs[1]));
      if (X.eyes) e = Math.max(e, R.eyes(v, lm) * X.eyes);
      if (X.mane) e = Math.max(e, R.mane(v) * X.mane);
      if (X.head) e = Math.max(e, R.head(v) * X.head);
      if (X.fn) e = Math.max(e, X.fn(v, lm));
      m.extra = e;
    }
    m.shade = furShade(v, (o.shadeFreq ?? 50) / lm.H * 0.57, o.shade ?? 0.35);
    return m;
  };
}
