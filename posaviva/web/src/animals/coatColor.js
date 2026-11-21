// Coat colouring shared by the runtime and the build previews: per-vertex
// masks (under / pattern / points / extra), a surface region (hoof, nose,
// mouth …) and baked ambient occlusion turn into a colour with a palette.
//
// Palette (sRGB hex): {base, under, pattern, points, extra, keratin, nose,
// mouth, pad, skin, eyelid, iris}. Missing entries fall back to sensible
// defaults; `shadeAmp` scales the fur value variation (0..1).

export const REGION_KEYS = ['fur', 'keratin', 'nose', 'mouth', 'pad', 'skin', 'eyelid', 'feather', 'scale'];
const DEF = { base: '#8a6a4a', under: null, pattern: '#2a2018', points: '#2a2018', extra: '#f0ece4', keratin: '#3a3430', nose: '#2b2523', mouth: '#7a3b3b', pad: '#2b2624', skin: '#6b5850', eyelid: '#2b2523', scale: '#6e6258' };

export function hexToLin(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}
export function linToHex(c) {
  const f = (x) => { x = Math.max(0, Math.min(1, x)); x = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; return Math.round(x * 255); };
  return '#' + ((1 << 24) | (f(c[0]) << 16) | (f(c[1]) << 8) | f(c[2])).toString(16).slice(1);
}

/** Linear-RGB palette arrays of a palette object. */
export function compilePalette(pal) {
  const p = { ...DEF, ...pal };
  if (!p.under) p.under = p.base;
  const out = {};
  for (const k of ['base', 'under', 'pattern', 'points', 'extra']) out[k] = hexToLin(p[k]);
  out.regions = REGION_KEYS.map((r) => (r === 'fur' || r === 'feather' ? null : hexToLin(p[r] || DEF[r])));
  out.shadeAmp = pal.shadeAmp ?? 0.35;
  out.aoAmp = pal.aoAmp ?? 0.85;
  return out;
}

/**
 * Fills `out` (Float32Array n*3, linear RGB) from masks (Uint8 n*4) and
 * extra (Uint8 n*4: region, region weight, shade, ao).
 */
export function coatColors(pal, masks, extra, n, out) {
  const P = compilePalette(pal);
  const b = P.base, u = P.under, pt = P.pattern, po = P.points, ex = P.extra;
  for (let i = 0; i < n; i++) {
    const m0 = masks[i * 4] / 255, m1 = masks[i * 4 + 1] / 255, m2 = masks[i * 4 + 2] / 255, m3 = masks[i * 4 + 3] / 255;
    let r = b[0], g = b[1], bl = b[2];
    r += (u[0] - r) * m0; g += (u[1] - g) * m0; bl += (u[2] - bl) * m0;
    r += (pt[0] - r) * m1; g += (pt[1] - g) * m1; bl += (pt[2] - bl) * m1;
    r += (po[0] - r) * m2; g += (po[1] - g) * m2; bl += (po[2] - bl) * m2;
    r += (ex[0] - r) * m3; g += (ex[1] - g) * m3; bl += (ex[2] - bl) * m3;
    const sh = 1 + (extra[i * 4 + 2] / 255 - 0.5) * P.shadeAmp;
    r *= sh; g *= sh; bl *= sh;
    const reg = extra[i * 4], rw = extra[i * 4 + 1] / 255;
    const rc = P.regions[reg];
    if (rc && rw > 0) { r += (rc[0] - r) * rw; g += (rc[1] - g) * rw; bl += (rc[2] - bl) * rw; }
    const ao = 1 - (1 - extra[i * 4 + 3] / 255) * P.aoAmp;
    out[i * 3] = r * ao; out[i * 3 + 1] = g * ao; out[i * 3 + 2] = bl * ao;
  }
  return out;
}
