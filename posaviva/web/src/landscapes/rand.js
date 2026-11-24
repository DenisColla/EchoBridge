// Seeded randomness and noise for the landscape generators. Everything a
// landscape contains is derived from (spec, seed) through these helpers, so the
// same pair always rebuilds the same environment.

/** mulberry32: rng() in [0, 1) with helpers. */
export function makeRng(seed) {
  let a = (seed | 0) ^ 0x9e3779b9;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  r.chance = (p) => r() < p;
  r.sign = () => (r() < 0.5 ? -1 : 1);
  /** weighted pick: {key: weight} or [[value, weight]] */
  r.weighted = (w) => {
    const list = Array.isArray(w) ? w : Object.entries(w);
    let tot = 0;
    for (const [, x] of list) tot += Math.max(0, x);
    let t = r() * tot;
    for (const [k, x] of list) { t -= Math.max(0, x); if (t <= 0) return k; }
    return list[list.length - 1][0];
  };
  r.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  /** an independent child generator (keeps streams stable when one part changes) */
  r.fork = (salt) => makeRng(hashInt((seed | 0) * 31 + hashStr(String(salt))));
  r.seedInt = () => 1 + Math.floor(r() * 999998);
  return r;
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function hashInt(x) {
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** A new random seed (not reproducible: only used to start a new variant). */
export const freshSeed = () => 1 + Math.floor(Math.random() * 999998);

/**
 * 2D gradient noise (Perlin-like, seeded) with fbm and ridged variants.
 * n(x, y) ~ [-1, 1].
 */
export function makeNoise2(seed) {
  const perm = new Uint8Array(512);
  const rnd = makeRng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = new Float32Array(256), GY = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; GX[i] = Math.cos(a); GY[i] = Math.sin(a); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function n(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const g00 = perm[X + perm[Y]], g10 = perm[X + 1 + perm[Y]], g01 = perm[X + perm[Y + 1]], g11 = perm[X + 1 + perm[Y + 1]];
    const d00 = GX[g00] * xf + GY[g00] * yf;
    const d10 = GX[g10] * (xf - 1) + GY[g10] * yf;
    const d01 = GX[g01] * xf + GY[g01] * (yf - 1);
    const d11 = GX[g11] * (xf - 1) + GY[g11] * (yf - 1);
    const u = fade(xf), v = fade(yf);
    const a = d00 + (d10 - d00) * u, b = d01 + (d11 - d01) * u;
    return (a + (b - a) * v) * 1.414;
  }
  n.fbm = (x, y, oct = 4, lac = 2.03, gain = 0.5) => {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += amp * n(x * f + i * 17.3, y * f - i * 9.1); norm += amp; amp *= gain; f *= lac; }
    return s / norm;
  };
  /** ridged multifractal 0..1 (sharp crests: mountain ranges) */
  n.ridged = (x, y, oct = 5) => {
    let s = 0, amp = 0.5, f = 1, w = 1;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(n(x * f + i * 31.7, y * f + i * 7.7));
      v *= v; v *= w;
      w = Math.min(1, Math.max(0, v * 2));
      s += v * amp; amp *= 0.5; f *= 2.1;
    }
    return Math.min(1, s * 1.1);
  };
  return n;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
