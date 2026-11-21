// Small math helpers shared by the hair module (allocation-free where it matters).

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  if (b <= a) return x >= b ? 1 : 0;
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const DEG = Math.PI / 180;

/** Deterministic PRNG (mulberry32). Returns () => [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (seeds per character / style). */
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Piecewise-linear lookup in a sorted table [[x, y], ...] (clamped at the ends). */
export function table(t, x) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const a = t[i - 1], b = t[i];
      // smooth (cosine) interpolation: no visible kinks in hairlines
      const u = (x - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    }
  }
  return t[t.length - 1][1];
}

// ---------------------------------------------------------------- vec3 on arrays
/** out = normalize(v) for a 3-array; returns length. */
export function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l > 1e-12) { v[0] /= l; v[1] /= l; v[2] /= l; }
  return l;
}

/** Removes the component of v along unit n (in place). */
export function reject3(v, n) {
  const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  v[0] -= d * n[0]; v[1] -= d * n[1]; v[2] -= d * n[2];
  return v;
}

/** Rotates v around unit axis k by angle a (Rodrigues), in place. */
export function rotate3(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c);
  const x = v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d;
  const y = v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d;
  const z = v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d;
  v[0] = x; v[1] = y; v[2] = z;
  return v;
}

/** Applies a column-major 4x4 matrix (Float32Array/array, offset o) to point (x,y,z) -> out[oo..]. */
export function xformPoint(M, o, x, y, z, out, oo) {
  out[oo] = M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12];
  out[oo + 1] = M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13];
  out[oo + 2] = M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14];
}

/** Applies the rotation part of a column-major 4x4 matrix to a direction. */
export function xformDir(M, o, x, y, z, out, oo) {
  out[oo] = M[o] * x + M[o + 4] * y + M[o + 8] * z;
  out[oo + 1] = M[o + 1] * x + M[o + 5] * y + M[o + 9] * z;
  out[oo + 2] = M[o + 2] * x + M[o + 6] * y + M[o + 10] * z;
}
