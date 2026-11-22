// Terrain recipes for the presets: relief functions (local frame: characters
// near the origin, camera towards +Z, background towards -Z) and biome colours.
import { makeNoise2, smooth, clamp, lerp } from '../rand.js';

const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mix3 = (a, b, t, out) => { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; };

/**
 * Relief. o: {
 *   stageR: flat radius (m), blend: width of the transition,
 *   undul: amplitude of gentle ground waves (near), undulScale,
 *   hills: {amp, scale, start, end?}, mountains: {amp, start, scale, sharp (0..1), back (0..1: only behind), plateau?},
 *   dunes: {amp, scale}, basin: {x, z, r, depth} (lake bowl), coast: {z (shore line, local), depth, slope, wave},
 *   base: constant offset outside the stage (rooftops: -60), flatR: city flat radius (no hills inside)
 * }
 */
export function relief(seed, o) {
  const n = makeNoise2(seed), n2 = makeNoise2(seed + 101);
  const stageR = o.stageR ?? 8, blend = o.blend ?? 10;
  const flatR = o.flatR ?? 0;
  return (x, z) => {
    const r = Math.hypot(x, z);
    if (r < stageR && !o.coast && !o.basin) return 0;
    let h = 0;
    const k = smooth(stageR, stageR + blend, r);
    const kf = flatR ? smooth(flatR, flatR * 1.4 + 20, r) : 1;
    if (o.undul) h += o.undul * n.fbm(x / (o.undulScale || 22), z / (o.undulScale || 22), 3) * k;
    if (o.dunes) {
      const d = o.dunes, s = d.scale || 26;
      // asymmetric dunes: ridges across the wind (x), soft windward, steep lee
      const w = x / s + 0.35 * n2(x / 60, z / 60), v = z / (s * 0.7) + 0.6 * n2(x / 90 + 4, z / 90);
      const ridge = Math.pow(Math.abs(Math.sin(v + 0.7 * Math.sin(w))), 1.6);
      h += d.amp * (0.35 + 0.65 * ridge) * (0.6 + 0.4 * n.fbm(x / 70, z / 70, 3)) * k;
    }
    if (o.hills) {
      const hh = o.hills, kk = smooth(hh.start ?? stageR + 10, (hh.start ?? stageR + 10) + (hh.ramp ?? 60), r) * (hh.end ? 1 - smooth(hh.end, hh.end * 1.5, r) : 1);
      h += hh.amp * (0.55 + 0.45 * n.fbm(x / (hh.scale || 90), z / (hh.scale || 90), 4)) * kk * kf;
    }
    if (o.mountains) {
      const m = o.mountains;
      const back = m.back ?? 0.7; // 1 = only behind the characters
      const dirK = lerp(1, smooth(-0.2, 0.6, -z / (r || 1)), back);
      const kk = smooth(m.start, m.start + (m.ramp ?? m.start * 0.8), r) * dirK;
      if (kk > 0.001) {
        const s = m.scale || 260;
        let v = lerp(n.fbm(x / s, z / s, 5) * 0.5 + 0.5, n.ridged(x / s, z / s, 6), m.sharp ?? 0.7);
        if (m.plateau) v = Math.min(v, m.plateau) + Math.max(0, v - m.plateau) * 0.15; // mesas
        h += m.amp * v * kk;
      }
    }
    if (o.bumps) for (const b of o.bumps) {
      const d = Math.hypot(x - b.x, z - b.z);
      if (d < b.r) h = Math.max(h, h * 0.3 + b.h * (1 - smooth(b.r * 0.35, b.r, d)));
    }
    if (o.basin) {
      const b = o.basin, d = Math.hypot(x - b.x, z - b.z);
      const wob = 1 + 0.18 * n2(Math.atan2(z - b.z, x - b.x) * 1.5, 3.3);
      const t = d / (b.r * wob);
      if (t < 1.6) h -= b.depth * (1 - smooth(0.55, 1.15, t));
      if (t < 1.05) h = Math.min(h, -b.depth * (1 - smooth(0.6, 1.05, t)) + 0.05);
    }
    if (o.coast) {
      const c = o.coast;
      // shore line at local z = c.z (+ waves of the coastline); sea towards -Z
      const zs = c.z + (c.wave ?? 6) * n2(x / 45, 7.1) + (c.bay ? c.bay * Math.exp(-(x * x) / (2 * 60 * 60)) : 0);
      const d = z - zs; // > 0 land
      if (d < 0) h = Math.min(h, -c.depth * smooth(0, c.slope ?? 30, -d));
      else h *= smooth(0, c.landRamp ?? 25, d);
      h += d < 0 ? 0 : 0;
    }
    if (o.base) h += o.base * smooth(o.baseR0 ?? stageR, o.baseR1 ?? stageR + 0.5, r);
    return h;
  };
}

/**
 * Biome colour function. o: {
 *   base: hex (main ground), alt: hex (patch variation), dirt: hex, rock: hex, sand: hex, snow: hex,
 *   rockSlope: 0..1 (slope above which rock shows), snowLine: m, snowCover: 0..1,
 *   water: level (sand / mud near it), fields: {scale, colors[]} (crop strips), path: fn(x,z)->0..1,
 *   stage: hex (under the characters), stageR
 * }
 */
export function biome(seed, o) {
  const n = makeNoise2(seed + 7), n2 = makeNoise2(seed + 31);
  const base = hexRgb(o.base), alt = hexRgb(o.alt || o.base), dirt = hexRgb(o.dirt || '#7a6347'), rock = hexRgb(o.rock || '#85817a');
  const sand = hexRgb(o.sand || '#d8c49a'), snow = hexRgb(o.snow || '#eef1f5'), stage = o.stage ? hexRgb(o.stage) : null;
  const fields = o.fields ? o.fields.colors.map(hexRgb) : null;
  const tmp = [0, 0, 0];
  return (x, z, h, slope, out) => {
    const r = Math.hypot(x, z);
    // main ground with soft patches
    const p = n.fbm(x / 18, z / 18, 3) * 0.5 + 0.5;
    mix3(base, alt, smooth(0.35, 0.75, p), out);
    if (o.dirtAmt) mix3(out, dirt, smooth(1 - o.dirtAmt, 1.05 - o.dirtAmt * 0.5, n2.fbm(x / 9, z / 9, 3) * 0.5 + 0.5) * 0.85, out);
    if (fields && r > (o.fields.from ?? 30)) {
      const s = o.fields.scale || 40;
      const cell = Math.floor(x / s + n2(x / 300, z / 300) * 0.8) * 7 + Math.floor(z / (s * 0.6));
      const c = fields[((cell % fields.length) + fields.length) % fields.length];
      const stripe = 0.85 + 0.15 * Math.sin(z * 1.4);
      tmp[0] = c[0] * stripe; tmp[1] = c[1] * stripe; tmp[2] = c[2] * stripe;
      mix3(out, tmp, smooth(o.fields.from ?? 30, (o.fields.from ?? 30) + 15, r) * 0.9, out);
    }
    if (o.path) { const t = o.path(x, z); if (t > 0) mix3(out, dirt, t, out); }
    if (o.water !== undefined && o.water !== null) {
      const w = o.water;
      mix3(out, o.mud ? dirt : sand, 1 - smooth(w + 0.25, w + (o.beach ?? 1.6), h), out);
      if (h < w - 0.2) mix3(out, dirt, 0.6, out);
    }
    if (o.rockSlope !== undefined) mix3(out, rock, smooth(o.rockSlope, o.rockSlope + 0.18, slope + 0.08 * n.fbm(x / 7, z / 7, 2)), out);
    if (o.rockHigh) mix3(out, rock, smooth(o.rockHigh, o.rockHigh * 1.6, h) * 0.9, out);
    const sl = o.snowLine ?? Infinity;
    let sn = h > sl ? smooth(sl, sl + 40, h + 25 * n.fbm(x / 60, z / 60, 3)) * (1 - smooth(0.55, 0.8, slope)) : 0;
    if (o.snowCover) sn = Math.max(sn, o.snowCover * (1 - smooth(0.35, 0.7, slope)) * (0.75 + 0.25 * smooth(0.3, 0.6, p)));
    if (sn > 0) mix3(out, snow, clamp(sn, 0, 1), out);
    if (stage && r < o.stageR) mix3(out, stage, 1 - smooth(o.stageR * 0.6, o.stageR, r), out);
    // ground near the stage a bit brighter / far ground darker (aerial depth comes from fog)
    const k = 0.94 + 0.12 * (1 - smooth(20, 300, r));
    out[0] *= k; out[1] *= k; out[2] *= k;
    return out;
  };
}

export { hexRgb };
