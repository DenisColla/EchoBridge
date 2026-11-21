// Hair-bearing regions of the head, expressed on the unit direction u from the
// head centre (HeadFrame.c): elevation e = asin(u.y) and azimuth a = |atan2(u.x, u.z)|
// (0 = front, 90 = ear, 180 = back), both in degrees. A region is the set of
// directions whose elevation is above a hairline curve e_min(a); masks return
// the signed angular distance to the hairline in degrees (> 0 inside).
import { table, rng, DEG, len3 } from './util.js';

// Natural hairlines (calibrated on the MakeHuman head: the ear sits at a ~ 85-115°).
const HAIRLINE_F = [[0, 31], [20, 30.5], [40, 27.5], [52, 22], [60, 13], [66, -2], [71, -12], [77, -13], [82, 1], [87, 15], [96, 19], [108, 18], [115, 9], [121, -14], [131, -32], [150, -44], [180, -49]];
// male: slightly receding temples (M shape), longer sideburns
const HAIRLINE_M = [[0, 32], [18, 33], [33, 37], [44, 33], [54, 22], [61, 10], [66, -6], [71, -20], [77, -22], [82, -2], [87, 15], [96, 19], [108, 18], [115, 9], [121, -14], [131, -32], [150, -44], [180, -50]];
// undercut / mohawk top region: above the parietal ridge
const TOPLINE = [[0, 31], [30, 34], [50, 44], [90, 52], [140, 46], [180, 40]];

export const elevation = (u) => Math.asin(u[1] > 1 ? 1 : u[1] < -1 ? -1 : u[1]) / DEG;
export const azimuth = (u) => Math.abs(Math.atan2(u[0], u[2])) / DEG;

/**
 * Creates a mask function mask(u) -> degrees (> 0 inside).
 * kind: 'natural' | 'top' (undercut: top of the head only) | 'strip' (mohawk crest)
 * opts: {sex:'F'|'M', front: extra degrees added to the front hairline (higher forehead), width (strip half width, u.x)}
 */
export function makeMask(kind, opts = {}) {
  const base = opts.sex === 'M' ? HAIRLINE_M : HAIRLINE_F;
  const front = opts.front || 0;
  const natural = (u) => {
    const a = azimuth(u);
    return elevation(u) - table(base, a) - front * Math.max(0, 1 - a / 70);
  };
  if (kind === 'top') return (u) => Math.min(natural(u), elevation(u) - table(TOPLINE, azimuth(u)));
  if (kind === 'strip') {
    const w = opts.width || 0.2;
    return (u) => Math.min(natural(u), (w - Math.abs(u[0])) / DEG);
  }
  return natural;
}

/**
 * Roughly uniform root directions inside a mask: Fibonacci sphere points,
 * filtered, then jittered. Returns {dirs: Float32Array(n*3), spacing (radians)}.
 * margin: minimum mask value (degrees) for a root.
 */
export function sampleRoots(mask, count, seed, margin = 0.5) {
  // estimate the solid-angle fraction of the region
  const probe = 3000;
  let inside = 0;
  const u = [0, 0, 0];
  const fib = (i, n, out) => {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), ph = i * 2.399963229728653;
    out[0] = r * Math.cos(ph); out[1] = y; out[2] = r * Math.sin(ph);
    return out;
  };
  for (let i = 0; i < probe; i++) if (mask(fib(i, probe, u)) > margin) inside++;
  const frac = Math.max(0.01, inside / probe);
  const n = Math.max(8, Math.round(count / frac));
  const spacing = Math.sqrt((4 * Math.PI) / n);
  const rnd = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    fib(i, n, u);
    // jitter in the tangent plane (keeps the blue-noise look, breaks the spiral pattern)
    tangentBasis(u, _t1, _t2);
    const j1 = (rnd() - 0.5) * spacing * 0.7, j2 = (rnd() - 0.5) * spacing * 0.7;
    let x = u[0] + _t1[0] * j1 + _t2[0] * j2, y = u[1] + _t1[1] * j1 + _t2[1] * j2, z = u[2] + _t1[2] * j1 + _t2[2] * j2;
    const l = len3(x, y, z); x /= l; y /= l; z /= l;
    u[0] = x; u[1] = y; u[2] = z;
    if (mask(u) > margin) out.push(x, y, z);
  }
  return { dirs: Float32Array.from(out), spacing };
}

const _t1 = [0, 0, 0], _t2 = [0, 0, 0];
/** Orthonormal tangent basis (t1, t2) of the unit vector u. */
export function tangentBasis(u, t1, t2) {
  // t1 = normalize(cross(u, ref)) with ref = Y unless u is nearly vertical
  let rx = 0, ry = 1, rz = 0;
  if (Math.abs(u[1]) > 0.9) { rx = 1; ry = 0; }
  let x = u[1] * rz - u[2] * ry, y = u[2] * rx - u[0] * rz, z = u[0] * ry - u[1] * rx;
  const l = len3(x, y, z) || 1;
  t1[0] = x / l; t1[1] = y / l; t1[2] = z / l;
  t2[0] = u[1] * t1[2] - u[2] * t1[1]; t2[1] = u[2] * t1[0] - u[0] * t1[2]; t2[2] = u[0] * t1[1] - u[1] * t1[0];
}
