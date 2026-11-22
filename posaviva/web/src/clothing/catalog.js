// Garment catalog (Italian labels). Each definition tells the builder where
// the fabric is (mask constraints over body coordinates, see build.js), how it
// fits (thickness, ease, looseness, hang), how its edges are finished
// (hems, rib bands, collars, lapels), its fabric, static folds and wrinkle
// character. Torso heights use the body coordinate T (body.js):
//   0 crotch, 1 hip joint, 2 waist, 3 bust/chest, 4 shoulder joint, 5 neck base
// limb params: arm 0 shoulder .. 1 elbow .. 2 wrist, leg 0 hip .. 1 knee .. 2 ankle .. 3 toes.
//
// fit (all distances in m; [a, b] = value at Vestibilità 0 "Aderente" and 1 "Largo"):
//   thickness            fabric thickness
//   ease, easeMid        radial ease over the smoothed body (easeMid: value at 0.5;
//                        quadratic through the three, so the slider steps read as
//                        aderente / slim / normale / comodo / largo)
//   easeMap(c,i,P0,bi,t) per-vertex ease multiplier (trouserEase, topEase)
//   contact              share of the ease removed where the body faces up: the
//                        garment rests on shoulders, upper bust, hip shelf (0.75)
//   loose, slope         drape of the body of the garment: share of the gap to the
//                        hanging envelope, and its taper (m/m, interpolated in ratio)
//   bridgeSlope          stiffness: steepest inward slope under a protrusion (under
//                        the bust, below the shoulder blades, behind the knee)
//   sleeve / leg         {loose, slope, slopeUpper (thigh / upper arm), bridgeSlope}
//                        drape of the limbs: the "cut" (skinny .. straight .. loose)
//   bridge, smooth, finalSmooth, wSmooth, wSmoothMin, loopSmooth   smoothing passes
//   offset(c,i,P0,bi)    extra local offset (shoulder pads, toe box), envelope (shoes)
//   hull, bridgeSlope    may be [at 0, at 1] pairs (a knit clings when fitted, drapes oversize)
//   membrane             0..1 (or a pair): the front / back 2-D membrane over bust, belly,
//                        shoulder blades (fit.js membraneEnvelope); tension: its sag
//   seatBridge           0..1 (or a pair): trousers span the gluteal cleft and the groin V
//   leg.sexShift         {F: dt}: Vestibilità offset of the leg cut for a sex
//   bumpSigma            radius (m) of the bump removal on the fabric (molded cups: larger)
// garment fields: hemLift (m: tops rise with raised arms), replacesBra (sports bra), foldFade
import { PART, NPART } from './body.js';

export const CATEGORIES = [
  { id: 'top', label: 'Sopra' },
  { id: 'bottom', label: 'Sotto' },
  { id: 'full', label: 'Interi' },
  { id: 'shoes', label: 'Scarpe' },
  { id: 'under', label: 'Calze e intimo' },
];

export const STYLES = [
  { id: 'casual', label: 'Casual' },
  { id: 'formal', label: 'Formale' },
  { id: 'sport', label: 'Sport/Action' },
];

/** Slots: one item each. `layer` orders the build (inner first). */
export const SLOTS = ['underwear', 'socks', 'top', 'bottom', 'full', 'outer', 'shoes'];

const PAL = {
  basic: ['#f4f2ee', '#1d1f24', '#8a8d93', '#2b3a55', '#7b2d2d', '#3d5a40', '#c9a66b', '#d97a8c'],
  denim: ['#3b5577', '#2a3a55', '#5d7898', '#1f2430', '#8aa1b8', '#4a4f57', '#e8e4da', '#6b4f3a'],
  formal: ['#22252b', '#2f3a4f', '#55585f', '#6b5a45', '#e9e6df', '#3c2f2a', '#5a2430', '#1a1a1a'],
  sport: ['#1d1f24', '#e8e8e8', '#c8323a', '#2c5aa0', '#e2b13c', '#3a8a5a', '#7a4fa0', '#ff7a3d'],
  shoes: ['#f2f2f0', '#1b1b1c', '#5b3a26', '#8a6a4a', '#2b3a55', '#a0302f', '#6d6f73', '#c9b48f'],
  under: ['#f3efe9', '#1c1c1e', '#d9b7a5', '#a8c2d8', '#b53a4b', '#7a8a99', '#e7c6d2', '#5a4a6a'],
};

const HEAD = (k) => k.exclude('head', ['head'], 0.5);
const ARMS = (k) => k.exclude('arms', ['armL', 'handL', 'armR', 'handR'], 0.45);
const FEET = (k) => k.exclude('feet', ['footL', 'footR'], 0.5);
const sleeves = (k, len) => [k.sleeve('sleeveL', 'L', len), k.sleeve('sleeveR', 'R', len)];
const legs = (k, len) => [k.legMax('legL', 'L', len), k.legMax('legR', 'R', len)];
/**
 * keep only the lower legs/feet below leg param `min` (both sides). heel: also keep
 * the vertices weighted to the foot above this (the back of the heel projects onto
 * the shin with a param below the ankle: low shoes would be open at the back)
 */
const lowerLegs = (k, min, heel = 0) => {
  const W = k.bi.topo.partW;
  return k.custom('cuff', (v) => {
    const c = Math.max((k.bi.param[2][v] - min) * k.bi.limbs[3].L[1], (k.bi.param[3][v] - min) * k.bi.limbs[4].L[1]);
    if (!heel) return c;
    const fw = Math.max(W[v * NPART + PART.footL], W[v * NPART + PART.footR]);
    return Math.max(c, (fw - heel) * 0.12);
  });
};
const crew = (k, front = 0.065, back = 0.02, extra = 0.018) => k.neckline('neck', { front, back, width: k.bi.neckRadius + extra });
/**
 * Hem heights (torso coordinate T, see body.js) of untucked tops: a tee, tank or
 * long sleeve ends a little above the hip joint (over the jeans waistband, not
 * across the hip flexion crease where the thighs would tear it), a rib band
 * (sweatshirt, track jacket) grips the hip bone.
 */
const TOP_HEM = 1.1, BAND_HEM = 1.05;
/**
 * Straps of sleeveless tops: the neckline stops this far inside the shoulder
 * joint and the armhole STRAP_INSET inside it, so a strap is ~5 cm wide: two
 * body faces at least (a one-face strap is dropped by the selection cleanup).
 */
const STRAP_INSET = 0.04;
const strapNeck = (k, inner = 0.095) => Math.min(k.bi.neckRadius + 0.03, k.land.shoulderX - inner);

/**
 * Ease map of trousers (multiplier of the garment ease): jeans and trousers
 * hug the waist, hips and seat, the thigh gets a little more room and the
 * full ease from the knee down (where the cut decides the leg line).
 */
const trouserEase = (seat = 0.5, thigh = 0.8) => (c, i) => {
  const L = c.limb[i];
  if (L < 3) return seat;
  const a = c.aL[i], w = 1 - c.wT[i];
  const leg = a <= 0 ? seat : a < 0.5 ? seat + ((thigh - seat) * a) / 0.5 : a < 1 ? thigh + ((1 - thigh) * (a - 0.5)) / 0.5 : 1;
  return seat + (leg - seat) * w;
};
/**
 * Ease map of tops: snug over the shoulders and upper chest, the full ease from
 * the bust to the waist, then less again over the hips (a hem cut about as wide
 * as the chest rests on the hips instead of standing off them).
 */
const topEase = (shoulder = 0.45, hip = 0.55) => (c, i, P0, bi) => {
  if (c.limb[i] && c.wT[i] < 0.5) return 1;
  const y = P0[i * 3 + 1], T = bi.T(y);
  const up = shoulder + (1 - shoulder) * Math.min(1, Math.max(0, (bi.land.armpit + 0.02 - y) / 0.08));
  const lo = hip + (1 - hip) * Math.min(1, Math.max(0, (T - 1.2) / 0.7));
  return Math.min(up, lo);
};

/**
 * Ease map of a tailored jacket: snug over the shoulders, the full ease at the
 * chest, suppressed at the waist (darts: the jacket draws in), opening again
 * over the hips and the seat.
 */
const jacketEase = (shoulder = 0.5, waist = 0.45, hip = 0.9) => (c, i, P0, bi) => {
  if (c.limb[i] && c.wT[i] < 0.5) return 1;
  const y = P0[i * 3 + 1], T = bi.T(y);
  const up = shoulder + (1 - shoulder) * Math.min(1, Math.max(0, (bi.land.armpit + 0.02 - y) / 0.08));
  const d = T - 2;
  const mid = d >= 0 ? waist + (1 - waist) * Math.min(1, d / 0.8) : waist + (hip - waist) * Math.min(1, -d / 0.8);
  return Math.min(up, mid);
};

/** Ease map of a tucked top: the ease of `map`, reduced to 30% below the waist (the waistband holds the fabric flat). */
const tuckedEase = (map) => (c, i, P0, bi, t) => map(c, i, P0, bi, t) * (0.3 + 0.7 * Math.min(1, Math.max(0, (bi.T(P0[i * 3 + 1]) - 1.7) / 0.5)));
/** looseFade: no drape within `a` m of the cut `id`, full drape from `b` m. */
const fadeAbove = (id, a, b) => (c, i, cv, cons) => {
  const k = cons.findIndex((q) => q.id === id);
  if (k < 0) return 1;
  const x = Math.min(1, Math.max(0, (cv[k][i] - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** Static fold presets */
const cuffBunch = (near, amp = 0.0025, width = 0.09, wl = 0.028) => ({ type: 'rings', region: 'arm', near, width, amp, wl });
const ankleStack = (near, amp = 0.004, width = 0.12, wl = 0.04) => ({ type: 'rings', region: 'leg', near, width, amp, wl });
const backSlack = (amp = 0.0025) => ({ type: 'rings', region: 'torso', near: 'hem', width: 0.13, amp, wl: 0.045, sector: [Math.PI, 1.3] });

export const GARMENTS = [
  // ------------------------------------------------------------------ tops
  {
    id: 'tshirt', label: 'T-shirt', cat: 'top', slot: 'top', layer: 3, styles: ['casual', 'sport'], icon: 'tshirt',
    hemLift: 0.045,
    fabric: 'jersey', color: '#f1efe9', palette: PAL.basic,
    mask: (k) => [k.above('hem', k.y(TOP_HEM)), crew(k), ...sleeves(k, 0.42), HEAD(k)],
    bands: { neck: { h: 0.017 } },
    edges: { neck: { type: 'hem', r: 0.0022 }, default: { type: 'hem' } },
    // Vestibilità: aderente (stretch, ~3 cm of chest ease) .. normale (~9 cm) .. largo (oversize, ~22 cm)
    fit: {
      thickness: 0.0022, ease: [0.0006, 0.028], easeMid: 0.0095, easeMap: topEase(0.55), loose: [0.0, 0.75], slope: [0.9, 0.12], bridge: 6, smooth: 16,
      // jersey: clings back under the bust when fitted, drapes from it when oversize
      bridgeSlope: [1.3, 0.35], hull: [0.45, 0.85], membrane: [0.9, 0.6],
      sleeve: { loose: [0.05, 0.6], slope: [1.2, 0.15], bridgeSlope: 1.2 },
    },
    wrinkle: { k: 0.75, wl: 0.055, wlArm: 0.034 },
    folds: [backSlack(0.002), { type: 'rings', region: 'arm', near: ['sleeveL', 'sleeveR'], width: 0.05, amp: 0.0012, wl: 0.03 }],
    weightBlend: hemToPelvis(0.95),
    details: 'tshirt',
  },
  {
    id: 'tank', label: 'Canotta', cat: 'top', slot: 'top', layer: 3, styles: ['casual', 'sport'], icon: 'tank',
    hemLift: 0.04,
    fabric: 'jersey', color: '#e9e6df', palette: PAL.basic,
    mask: (k) => [
      k.above('hem', k.y(TOP_HEM)),
      k.neckline('neck', { front: 0.11, back: 0.06, width: strapNeck(k), shape: 'scoop' }),
      k.armhole('armholeL', 'L', { inset: STRAP_INSET, drop: 0.03, rx: 0.05, ry: 0.08 }),
      k.armhole('armholeR', 'R', { inset: STRAP_INSET, drop: 0.03, rx: 0.05, ry: 0.08 }),
      ARMS(k), HEAD(k),
    ],
    edges: { default: { type: 'hem', r: 0.0018 } },
    // rib knit: back in under the bust and at the waist (no tent from the bust apex)
    // unless worn oversize
    fit: { thickness: 0.002, ease: [0.0, 0.022], easeMid: 0.0055, easeMap: topEase(0.55, 0.5), loose: [0.0, 0.7], slope: [1.2, 0.15], bridgeSlope: [1.7, 0.45], hull: [0.3, 0.85], membrane: [1, 0.6], bridge: 6, smooth: 12 },
    wrinkle: { k: 0.6, wl: 0.052 },
    folds: [backSlack(0.0015)],
    weightBlend: hemToPelvis(0.95),
    details: 'tank',
  },
  {
    id: 'longsleeve', label: 'Maglia a maniche lunghe', cat: 'top', slot: 'top', layer: 3, styles: ['casual', 'sport'], icon: 'longsleeve',
    hemLift: 0.045,
    fabric: 'jersey', color: '#2b3a55', palette: PAL.basic,
    mask: (k) => [k.above('hem', k.y(TOP_HEM)), crew(k, 0.06, 0.018, 0.016), ...sleeves(k, 1.97), HEAD(k), k.exclude('hands', ['handL', 'handR'], 0.5)],
    bands: { neck: { h: 0.016 }, sleeveL: { h: 0.035 }, sleeveR: { h: 0.035 } },
    edges: { default: { type: 'hem' } },
    fit: {
      thickness: 0.0024, ease: [0.0006, 0.026], easeMid: 0.009, easeMap: topEase(0.55), loose: [0.0, 0.75], slope: [0.9, 0.12], bridge: 6, smooth: 14,
      bridgeSlope: [1.3, 0.35], hull: [0.45, 0.85], membrane: [0.9, 0.6],
      sleeve: { loose: [0.05, 0.5], slope: [1.2, 0.2], bridgeSlope: 1.2 },
    },
    wrinkle: { k: 0.85, wl: 0.055, wlArm: 0.032 },
    folds: [backSlack(0.002), cuffBunch(['sleeveL', 'sleeveR'], 0.0032, 0.12, 0.03)],
    weightBlend: hemToPelvis(0.95),
    details: 'plainKnit',
  },
  {
    id: 'sweatshirt', label: 'Felpa', cat: 'top', slot: 'top', layer: 3, styles: ['casual', 'sport'], icon: 'sweatshirt',
    hemLift: 0.04,
    fabric: 'fleece', color: '#8a8d93', palette: PAL.basic,
    mask: (k) => [k.above('hem', k.y(BAND_HEM)), crew(k, 0.055, 0.015, 0.014), ...sleeves(k, 1.96), HEAD(k), k.exclude('hands', ['handL', 'handR'], 0.5)],
    bands: { hem: { h: 0.06 }, sleeveL: { h: 0.06 }, sleeveR: { h: 0.06 }, neck: { h: 0.022 } },
    edges: { default: { type: 'hem', r: 0.003 } },
    fit: {
      thickness: 0.0048, ease: [0.003, 0.032], easeMid: 0.012, easeMap: topEase(0.6), loose: [0.3, 1.0], slope: [0.5, 0.06], bridgeSlope: 0.45, membrane: 0.6, bridge: 8, wSmooth: 3, smooth: 16,
      sleeve: { loose: [0.2, 0.8], slope: [0.8, 0.1], bridgeSlope: 1.0 },
    },
    wrinkle: { k: 1.0, wl: 0.07, wlArm: 0.042, kt: 0.25 },
    folds: [cuffBunch(['sleeveL', 'sleeveR'], 0.006, 0.16, 0.042), { type: 'rings', region: 'torso', near: 'hem', width: 0.13, amp: 0.004, wl: 0.05 }],
    weightBlend: hemToPelvis(0.95),
    details: 'sweatshirt',
  },
  {
    id: 'trackjacket', label: 'Felpa con zip', cat: 'top', slot: 'outer', layer: 4, styles: ['sport', 'casual'], icon: 'trackjacket',
    hemLift: 0.04,
    fabric: 'tricot', color: '#2c5aa0', palette: PAL.sport, trim: '#f2f2f2',
    mask: (k) => [k.above('hem', k.y(BAND_HEM)), crew(k, 0.04, 0.0, 0.03), ...sleeves(k, 1.96), HEAD(k), k.exclude('hands', ['handL', 'handR'], 0.5)],
    bands: { hem: { h: 0.045 }, sleeveL: { h: 0.05 }, sleeveR: { h: 0.05 } },
    edges: { neck: { type: 'collar', at: () => ({ stand: 0.04, flap: 0.0, lift: 0 }) }, default: { type: 'hem', r: 0.0028 } },
    fit: {
      thickness: 0.0035, ease: [0.003, 0.028], easeMid: 0.01, easeMap: topEase(0.6), loose: [0.25, 0.9], slope: [0.6, 0.1], bridgeSlope: 0.45, membrane: 0.6, bridge: 8, wSmooth: 3, smooth: 16,
      sleeve: { loose: [0.15, 0.7], slope: [0.9, 0.12], bridgeSlope: 1.0 },
    },
    wrinkle: { k: 0.9, wl: 0.065, wlArm: 0.04 },
    folds: [cuffBunch(['sleeveL', 'sleeveR'], 0.005, 0.14, 0.04), { type: 'crease', region: 'torso', theta: 0, amp: 0.0018, halfWidth: 0.004 }],
    hardware: { zipper: true },
    weightBlend: hemToPelvis(0.95),
    details: 'trackjacket',
  },
  {
    id: 'shirt', label: 'Camicia', cat: 'top', slot: 'top', layer: 1, styles: ['formal', 'casual'], icon: 'shirt',
    hemLift: 0.03,
    fabric: 'poplin', color: '#f4f4f2', palette: ['#f4f4f2', '#a9c4e0', '#e9dccb', '#ffffff', '#2b3a55', '#d9a6a6', '#8a9a78', '#1d1f24'],
    // always tucked in (layer 1, under the bottoms): the hem ends a hand below the
    // waistband, flat and with no rolled edge (no ridge, no lump at the crotch)
    mask: (k) => [k.above('hem', k.y(1.25)), crew(k, 0.07, 0.008, 0.012), ...sleeves(k, 1.97), HEAD(k), k.exclude('hands', ['handL', 'handR'], 0.5)],
    bands: { sleeveL: { h: 0.06 }, sleeveR: { h: 0.06 } },
    edges: {
      neck: { type: 'collar', at: (q) => ({ stand: 0.032, flap: 0.045 + 0.03 * Math.max(0, Math.cos(q.theta)) ** 6, lift: 0.006, skip: Math.abs(q.theta) < 0.12 }) },
      hem: { type: 'none' },
      default: { type: 'hem', r: 0.0016 },
    },
    // tucked: no folds (and no room reserved for them) under the waistband
    foldFade: [1.45, 1.95, 0.1],
    fit: {
      thickness: 0.0018, ease: [0.0015, 0.026], easeMid: 0.01, easeMap: tuckedEase(topEase(0.5)), loose: [0.15, 0.8], slope: [0.8, 0.15], bridgeSlope: 0.45, bridge: 6, smooth: 12,
      // tucked in: the drape from the chest dies out towards the hem (the trousers hold it flat)
      looseFade: fadeAbove('hem', 0.035, 0.11),
      sleeve: { loose: [0.1, 0.6], slope: [1.0, 0.15], bridgeSlope: 1.0 },
    },
    wrinkle: { k: 0.85, wl: 0.052, wlArm: 0.034, kt: 0.45 },
    folds: [cuffBunch(['sleeveL', 'sleeveR'], 0.0035, 0.13, 0.03), { type: 'crease', region: 'torso', theta: 0, amp: 0.0014, halfWidth: 0.006 }, backSlack(0.003)],
    hardware: { shirtButtons: true },
    weightBlend: hemToPelvis(0.8),
    details: 'shirt',
  },
  {
    id: 'blazer', label: 'Giacca / blazer', cat: 'top', slot: 'outer', layer: 4, styles: ['formal'], icon: 'blazer',
    hemLift: 0.035,
    fabric: 'wool', color: '#2f3a4f', palette: PAL.formal,
    mask: (k) => [
      // the hem covers the seat but stays above the crotch: one loop around the hips
      // (below the crotch the body faces of the inner thighs close the jacket into shorts)
      k.above('hem', k.y(0.3)),
      k.neckline('neck', { front: Math.max(0.12, k.land.neck - k.y(2.25)), back: 0.012, width: k.bi.neckRadius + 0.022, shape: 'v' }),
      ...sleeves(k, 1.92), HEAD(k), k.exclude('hands', ['handL', 'handR'], 0.5),
    ],
    edges: {
      neck: {
        type: 'collar', at: (q) => {
          const front = Math.max(0, Math.cos(q.theta));
          const yb = q.bi.yOfT(2.25);
          const lapel = 0.075 * Math.min(1, Math.max(0, (q.y - yb) / 0.16)) ** 0.8;
          return { stand: 0.03 * (1 - front) ** 2, flap: Math.max(0.04 * (1 - front), lapel * front * 1.15), lift: 0.004 };
        },
      },
      default: { type: 'hem', r: 0.0035, depth: 0.03 },
    },
    fit: {
      thickness: 0.005, ease: [0.004, 0.018], easeMid: 0.008, easeMap: jacketEase(), loose: [0.25, 0.6], slope: [0.35, 0.12], bridgeSlope: 0.45, membrane: 1, bridge: 20, wSmooth: 3, smooth: 20,
      // tailored sleeves: straight from the deltoid, a little taper to the cuff (no balloon)
      sleeve: { loose: [0.1, 0.45], slope: [0.9, 0.2], bridgeSlope: 1.0 },
      // structured shoulders: a little padding on top of the shoulders
      offset: (c, i, P0, bi) => { const y = P0[i * 3 + 1], x = Math.abs(P0[i * 3]); return 0.004 * Math.max(0, 1 - Math.abs(y - bi.land.shoulder - 0.02) / 0.06) * Math.max(0, 1 - Math.abs(x - bi.land.shoulderX + 0.02) / 0.07); },
    },
    weightBlend: hemToPelvis(0.9),
    wrinkle: { k: 0.7, wl: 0.07, wlArm: 0.042, kt: 0.3 },
    folds: [cuffBunch(['sleeveL', 'sleeveR'], 0.004, 0.12, 0.04)],
    hardware: { blazerButtons: true },
    details: 'blazer',
  },
  {
    id: 'sporttop', label: 'Top sportivo', cat: 'top', slot: 'top', layer: 3, styles: ['sport'], sex: 'F', icon: 'sporttop',
    hemLift: 0.015,
    fabric: 'lycra', color: '#1d1f24', palette: PAL.sport,
    // a sports bra: worn instead of the bra (no cups or straps under it)
    replacesBra: true,
    mask: (k) => [
      k.above('hem', k.land.underBust - 0.045),
      // straps at least ~3 cm wide (armhole inset 6 cm): on narrow shoulders or a full neck a
      // thinner strap falls below the mesh resolution and is dropped on one side
      k.neckline('neck', { front: 0.1, back: 0.09, width: Math.min(k.bi.neckRadius + 0.035, k.land.shoulderX - 0.06 - 0.03), shape: 'scoop', backShape: 'scoop' }),
      k.armhole('armholeL', 'L', { inset: 0.06, drop: 0.035, rx: 0.06, ry: 0.09 }),
      k.armhole('armholeR', 'R', { inset: 0.06, drop: 0.035, rx: 0.06, ry: 0.09 }),
      ARMS(k), HEAD(k),
    ],
    bands: { hem: { h: 0.035 } },
    edges: { default: { type: 'hem', r: 0.002 } },
    // compression: one rounded volume over both breasts (membrane), snug under them
    fit: { thickness: 0.002, ease: [0.0, 0.006], loose: [0, 0.1], bridge: 26, smooth: 20, bridgeSlope: 0.9, hull: 1, membrane: 1, contact: 0.3 },
    wrinkle: { k: 0.2, wl: 0.035 },
    details: 'sporttop',
  },

  // ------------------------------------------------------------------ bottoms
  {
    id: 'jeans', label: 'Jeans', cat: 'bottom', slot: 'bottom', layer: 2, styles: ['casual'], icon: 'jeans',
    fabric: 'denim', color: '#3b5577', palette: PAL.denim,
    mask: (k) => [k.below('waist', k.y(1.55)), ...legs(k, 1.97), ARMS(k), FEET(k)],
    bands: { waist: { h: 0.038 } },
    edges: { default: { type: 'hem', r: 0.0028, depth: 0.02 } },
    // Vestibilità: skinny (hugs to the ankle) .. slim .. regular (straight from
    // the knee) .. relaxed .. loose. Seat and hips always fit close.
    fit: {
      thickness: 0.0026, ease: [0.0004, 0.02], easeMid: 0.0055, easeMap: trouserEase(0.5, 0.8), contact: 0.6,
      loose: [0.0, 0.3], slope: [1.6, 0.35], bridgeSlope: 1.1, bridge: 4,
      // at Normale a straight leg tapering a little to the hem (~39 cm round on a man);
      // women's jeans are cut a step slimmer at the same Vestibilità
      leg: { loose: [0.1, 0.95], slope: [0.6, 0.012], slopeUpper: [1.4, 0.04], bridgeSlope: 0.9, sexShift: { F: -0.15 } },
      seatBridge: [0.7, 1],
    },
    wrinkle: { k: 0.8, wl: 0.058, wlLeg: 0.046, kt: 0.3 },
    folds: [ankleStack(['legL', 'legR'], 0.0045, 0.12, 0.045)],
    hardware: { jeansButton: true },
    details: 'jeans',
  },
  {
    id: 'trousers', label: 'Pantaloni eleganti', cat: 'bottom', slot: 'bottom', layer: 2, styles: ['formal'], icon: 'trousers',
    fabric: 'wool', color: '#2a2d33', palette: PAL.formal,
    mask: (k) => [k.below('waist', k.y(1.75)), ...legs(k, 2.02), ARMS(k), FEET(k)],
    bands: { waist: { h: 0.036 } },
    edges: { default: { type: 'hem', r: 0.0025, depth: 0.03 } },
    fit: {
      thickness: 0.0028, ease: [0.0015, 0.024], easeMid: 0.0085, easeMap: trouserEase(0.55, 0.9), contact: 0.6, loose: [0.05, 0.4], slope: [1.4, 0.3], bridgeSlope: 1.0, innerSlope: 1.6, bridge: 5,
      // pressed straight leg: hangs from the seat and the knee, hem about 42 cm round
      leg: { loose: [0.45, 1.0], slope: [0.3, 0.02], slopeUpper: [0.8, 0.05], bridgeSlope: 0.8, sexShift: { F: -0.1 } },
      seatBridge: [0.8, 1],
    },
    wrinkle: { k: 0.8, wl: 0.065, wlLeg: 0.055 },
    folds: [
      { type: 'crease', region: 'leg', theta: Math.PI / 2, amp: 0.0032, halfWidth: 0.0045, sector: [Math.PI / 2, 0.6] },
      { type: 'crease', region: 'leg', theta: -Math.PI / 2, amp: 0.0032, halfWidth: 0.0045, sector: [-Math.PI / 2, 0.6] },
      ankleStack(['legL', 'legR'], 0.004, 0.1, 0.05),
    ],
    details: 'trousers',
  },
  {
    id: 'sweatpants', label: 'Pantaloni della tuta', cat: 'bottom', slot: 'bottom', layer: 2, styles: ['sport', 'casual'], icon: 'sweatpants',
    fabric: 'fleece', color: '#5a5d63', palette: PAL.sport,
    mask: (k) => [k.below('waist', k.y(1.7)), ...legs(k, 1.96), ARMS(k), FEET(k)],
    bands: { waist: { h: 0.045 }, legL: { h: 0.06 }, legR: { h: 0.06 } },
    edges: { default: { type: 'hem', r: 0.003 } },
    fit: {
      thickness: 0.0045, ease: [0.003, 0.03], easeMid: 0.012, easeMap: trouserEase(0.6, 0.95), contact: 0.6, loose: [0.1, 0.5], slope: [1.2, 0.25], bridgeSlope: 1.0, innerSlope: 1.6, bridge: 6, wSmooth: 3,
      leg: { loose: [0.5, 1.0], slope: [0.15, 0.008], slopeUpper: [0.5, 0.04], bridgeSlope: 0.8 },
      seatBridge: [0.8, 1],
      looseFade: (c, i, cv, cons) => { const a = cons.findIndex((q) => q.id === 'legL'), b = cons.findIndex((q) => q.id === 'legR'); const d = Math.min(cv[a][i], cv[b][i]); return Math.min(1, Math.max(0.1, (d - 0.03) / 0.16)); },
    },
    wrinkle: { k: 1.0, wl: 0.07, wlLeg: 0.052, kt: 0.25 },
    folds: [ankleStack(['legL', 'legR'], 0.007, 0.17, 0.045)],
    details: 'sweatpants',
  },
  {
    id: 'cargo', label: 'Pantaloni cargo', cat: 'bottom', slot: 'bottom', layer: 2, styles: ['casual', 'sport'], icon: 'cargo',
    fabric: 'canvas', color: '#5b5e45', palette: ['#5b5e45', '#2a2d2a', '#8a7a5a', '#3f4a3c', '#6b6e72', '#c2b28f', '#2b3a55', '#4a3a2a'],
    mask: (k) => [k.below('waist', k.y(1.5)), ...legs(k, 1.98), ARMS(k), FEET(k)],
    bands: { waist: { h: 0.04 } },
    edges: { default: { type: 'hem', r: 0.003, depth: 0.025 } },
    fit: {
      thickness: 0.0035, ease: [0.003, 0.03], easeMid: 0.012, easeMap: trouserEase(0.6, 0.95), contact: 0.6, loose: [0.1, 0.5], slope: [1.2, 0.25], bridgeSlope: 1.0, innerSlope: 1.6, bridge: 6, wSmooth: 3,
      leg: { loose: [0.55, 1.0], slope: [0.12, 0.006], slopeUpper: [0.4, 0.02], bridgeSlope: 0.8 },
      seatBridge: [0.8, 1],
    },
    wrinkle: { k: 1.0, wl: 0.068, wlLeg: 0.055 },
    folds: [
      ankleStack(['legL', 'legR'], 0.006, 0.15, 0.05),
      // side pockets in relief (outer thigh)
      { type: 'bump', region: 'leg', amp: 0.006, sector: [0, 0.5], sRange: [0.21, 0.37] },
    ],
    details: 'cargo',
  },
  {
    id: 'shorts', label: 'Shorts', cat: 'bottom', slot: 'bottom', layer: 2, styles: ['casual', 'sport'], icon: 'shorts',
    fabric: 'canvas', color: '#c2b28f', palette: PAL.basic.concat(['#c2b28f']),
    mask: (k) => [k.below('waist', k.y(1.55)), ...legs(k, 0.4), ARMS(k)],
    bands: { waist: { h: 0.036 } },
    edges: { default: { type: 'hem', r: 0.0028, depth: 0.02 } },
    fit: {
      thickness: 0.003, ease: [0.002, 0.028], easeMid: 0.01, easeMap: trouserEase(0.55, 1.0), contact: 0.6, loose: [0.1, 0.5], slope: [1.2, 0.3], bridgeSlope: 1.0, innerSlope: 1.6, bridge: 5,
      leg: { loose: [0.15, 0.9], slope: [0.8, 0.05], bridgeSlope: 0.8 },
      seatBridge: [0.8, 1],
    },
    wrinkle: { k: 0.8, wl: 0.055 },
    details: 'shorts',
  },
  {
    id: 'leggings', label: 'Leggings', cat: 'bottom', slot: 'bottom', layer: 2, styles: ['sport', 'casual'], icon: 'leggings',
    fabric: 'lycra', color: '#1d1f24', palette: PAL.sport,
    mask: (k) => [k.below('waist', k.y(1.95)), ...legs(k, 1.9), ARMS(k), FEET(k)],
    bands: { waist: { h: 0.04 } },
    edges: { default: { type: 'hem', r: 0.0015 } },
    fit: { thickness: 0.0014, ease: [0.0, 0.004], loose: [0, 0.05], bridge: 8, bridgeSlope: 2, smooth: 4, seatBridge: [0.5, 0.7] },
    wrinkle: { k: 0.3, wl: 0.03 },
    details: 'leggings',
  },
  {
    id: 'miniskirt', label: 'Gonna corta', cat: 'bottom', slot: 'bottom', layer: 2, styles: ['casual'], icon: 'miniskirt', kind: 'skirt',
    fabric: 'denim', color: '#2a3a55', palette: PAL.denim.concat(PAL.basic.slice(0, 2)),
    skirt: (bi, fit) => ({ top: bi.yOfT(1.75), hem: bi.land.hipJoint - 0.33 * (bi.land.hipJoint - bi.joint('lowerleg01.L')[1]) - 0.06, ease: 0.003 + fit * 0.012, flare: 0.25 + fit * 0.35, taper: 0.05, drape: { count: 9, amp: 0.004 + fit * 0.004 }, loose: 0.3, band: 0.035 }),
    edges: { default: { type: 'hem', r: 0.0028 } },
    wrinkle: { k: 0.7, wl: 0.06 },
    details: 'skirt',
  },
  {
    id: 'pencilskirt', label: 'Gonna a tubino', cat: 'bottom', slot: 'bottom', layer: 2, styles: ['formal'], icon: 'pencilskirt', kind: 'skirt',
    fabric: 'wool', color: '#22252b', palette: PAL.formal,
    skirt: (bi, fit) => ({ top: bi.yOfT(2.0), hem: bi.joint('lowerleg01.L')[1] + 0.035, ease: 0.002 + fit * 0.01, flare: 0, taper: 0.22 - fit * 0.15, drape: { count: 6, amp: 0.0015 }, loose: 0.2, band: 0.03 }),
    edges: { default: { type: 'hem', r: 0.003, depth: 0.03 } },
    wrinkle: { k: 0.6, wl: 0.06 },
    details: 'pencil',
  },
  {
    id: 'flaredskirt', label: 'Gonna svasata midi', cat: 'bottom', slot: 'bottom', layer: 2, styles: ['casual', 'formal'], icon: 'flaredskirt', kind: 'skirt',
    fabric: 'crepe', color: '#7b2d2d', palette: PAL.basic,
    skirt: (bi, fit) => ({ top: bi.yOfT(2.0), hem: bi.joint('lowerleg01.L')[1] - 0.17, ease: 0.003 + fit * 0.008, flare: 0.12 + fit * 0.22, taper: 0.0, drape: { count: 8, amp: 0.026 + fit * 0.012 }, loose: 0.35, band: 0.03, segs: 96 }),
    edges: { default: { type: 'hem', r: 0.0022 } },
    wrinkle: { k: 0.8, wl: 0.08 },
    details: 'skirt',
  },

  // ------------------------------------------------------------------ full
  {
    id: 'dress', label: 'Vestito', cat: 'full', slot: 'full', layer: 2, styles: ['formal', 'casual'], icon: 'dress',
    fabric: 'crepe', color: '#5a2430', palette: ['#5a2430', '#1d1f24', '#2b3a55', '#d9b7a5', '#3d5a40', '#e9e6df', '#c9a66b', '#7a4fa0'],
    parts: [
      {
        mask: (k) => [
          k.above('hem', k.y(1.6)),
          k.neckline('neck', { front: 0.12, back: 0.08, width: strapNeck(k), shape: 'scoop' }),
          k.armhole('armholeL', 'L', { inset: STRAP_INSET, drop: 0.025, rx: 0.05, ry: 0.08 }),
          k.armhole('armholeR', 'R', { inset: STRAP_INSET, drop: 0.025, rx: 0.05, ry: 0.08 }),
          ARMS(k), HEAD(k),
        ],
        edges: { hem: { type: 'none' }, default: { type: 'hem', r: 0.0018 } },
        fit: { thickness: 0.002, ease: [0.0006, 0.014], easeMid: 0.005, easeMap: topEase(0.6), loose: [0.0, 0.3], slope: [1.4, 0.6], bridgeSlope: 0.6, membrane: 0.9, bridge: 8, smooth: 12 },
        wrinkle: { k: 0.7, wl: 0.055 },
        // under the skirt the bodice stays (almost) flat: the skirt rests on it
        foldFade: [1.75, 2.2, 0.12],
      },
      {
        kind: 'skirt',
        skirt: (bi, fit) => ({ top: bi.yOfT(2.0), hem: bi.joint('lowerleg01.L')[1] + 0.02, ease: 0.004 + fit * 0.01, flare: 0.08 + fit * 0.2, taper: 0.0, drape: { count: 9, amp: 0.016 + fit * 0.01 }, loose: 0.35, band: 0.0, segs: 96, hug: 0.09, onSurf: true }),
        edges: { waist: { type: 'none' }, default: { type: 'hem', r: 0.0022 } },
        wrinkle: { k: 0.7, wl: 0.075 },
      },
    ],
    details: 'dress',
  },

  // ------------------------------------------------------------------ shoes
  {
    id: 'sneakers', label: 'Sneakers', cat: 'shoes', slot: 'shoes', layer: 1, styles: ['casual', 'sport'], icon: 'sneakers',
    fabric: 'sneaker', color: '#f2f2f0', palette: PAL.shoes, sole: { color: '#cdc9c0', top: 0.026, below: 0.006, welt: 0.006 },
    mask: (k) => [lowerLegs(k, 1.93, 0.6), k.only('feetonly', ['legL', 'footL', 'legR', 'footR'], 0.5)],
    edges: { default: { type: 'hem', r: 0.004, depth: 0.012 } },
    fit: { thickness: 0.003, ease: [0.003, 0.008], loose: [0, 0], bridge: 30, wSmooth: 4, wSmoothMin: 1, smooth: 24, offset: toeBox(0.007, 0.004), finalSmooth: 10, envelope: 1 },
    subdiv: 0,
    wrinkle: { k: 0.15, wl: 0.03 },
    details: 'sneakers',
  },
  {
    id: 'dressshoes', label: 'Scarpe eleganti', cat: 'shoes', slot: 'shoes', layer: 1, styles: ['formal'], icon: 'dressshoes',
    fabric: 'leather', color: '#1b1b1c', palette: PAL.shoes, sole: { color: '#3a2a20', top: 0.014, below: 0.005, welt: 0.004 },
    mask: (k) => [lowerLegs(k, 2.03, 0.75), k.only('feetonly', ['legL', 'footL', 'legR', 'footR'], 0.5), instepOpening(k)],
    edges: { default: { type: 'hem', r: 0.0022, depth: 0.01 } },
    fit: { thickness: 0.0025, ease: [0.002, 0.006], loose: [0, 0], bridge: 34, wSmooth: 4, wSmoothMin: 1, smooth: 24, offset: toeBox(0.006, 0.002, 0.012), finalSmooth: 10, envelope: 1 },
    subdiv: 0,
    wrinkle: { k: 0.1, wl: 0.03 },
    details: 'dressshoes',
  },
  {
    id: 'boots', label: 'Stivali / anfibi', cat: 'shoes', slot: 'shoes', layer: 1, styles: ['casual', 'sport'], icon: 'boots',
    fabric: 'leather', color: '#3b2c22', palette: PAL.shoes, sole: { color: '#151413', top: 0.03, below: 0.007, welt: 0.007 },
    mask: (k) => [lowerLegs(k, 1.45), k.only('feetonly', ['legL', 'footL', 'legR', 'footR'], 0.5)],
    bands: { cuff: { h: 0.03 } },
    edges: { default: { type: 'hem', r: 0.004, depth: 0.015 } },
    fit: { thickness: 0.004, ease: [0.004, 0.012], loose: [0, 0.3], bridge: 30, wSmooth: 4, wSmoothMin: 1, smooth: 24, offset: toeBox(0.008, 0.005), finalSmooth: 10, envelope: 1 },
    subdiv: 0,
    wrinkle: { k: 0.25, wl: 0.045 },
    details: 'boots',
  },

  // ------------------------------------------------------------------ socks & underwear
  {
    id: 'socks', label: 'Calzini', cat: 'under', slot: 'socks', layer: 0, styles: ['casual', 'sport', 'formal'], icon: 'socks',
    fabric: 'rib', color: '#f0eeea', palette: PAL.under,
    mask: (k) => [lowerLegs(k, 1.62), k.only('feetonly', ['legL', 'footL', 'legR', 'footR'], 0.5)],
    bands: { cuff: { h: 0.03 } },
    edges: { default: { type: 'hem', r: 0.0015 } },
    fit: { thickness: 0.0012, ease: [0.0, 0.003], loose: [0, 0], bridge: 24, smooth: 16, finalSmooth: 6, envelope: 0.7 },
    subdiv: 0,
    wrinkle: { k: 0.35, wl: 0.03 },
    details: 'socks',
  },
  {
    id: 'underwear', label: 'Intimo', cat: 'under', slot: 'underwear', layer: 0, styles: ['casual', 'sport', 'formal'], icon: 'underwear',
    fabric: 'micro', color: '#f3efe9', palette: PAL.under,
    // female: slip + bra (with straps); male: boxer briefs
    partsBySex: {
      F: [
        {
          mask: (k) => [
            k.below('waist', k.y(1.35)),
            briefLegs(k, 'L'), briefLegs(k, 'R'), ARMS(k),
          ],
          bands: { waist: { h: 0.012 } },
          edges: { default: { type: 'hem', r: 0.0012 } },
          // the body's own weights (rides the skin exactly); only a thin rim of skin stays visible
          fit: { thickness: 0.0012, ease: [0, 0.002], loose: [0, 0], bridge: 22, bridgeSlope: 2, smooth: 6, wSmoothMin: 0 },
          hideMargin: 0.01,
          wrinkle: { k: 0.12, wl: 0.03 },
        },
        {
          mask: (k) => [braShape(k), ARMS(k)],
          bands: { band: { h: 0.025 } },
          edges: { default: { type: 'hem', r: 0.0014 } },
          // molded cups: round domes (no apex point for the tops over them to copy)
          // (a support garment: it follows the lower pole of the bust, no straight fall from the apex)
          fit: { thickness: 0.0018, ease: [0.002, 0.004], loose: [0, 0], bridge: 30, bridgeSlope: 2, smooth: 30, contact: 0 },
          // a molded cup: only its very rim must clear the skin (a wide edge zone
          // would wrap it over the nipples)
          hideMargin: 0.008,
          wrinkle: { k: 0.12, wl: 0.03 },
          straps: true,
        },
      ],
      M: [
        {
          mask: (k) => [k.below('waist', k.y(1.5)), ...legs(k, 0.24), ARMS(k)],
          bands: { waist: { h: 0.032 } },
          edges: { default: { type: 'hem', r: 0.0014 } },
          fit: { thickness: 0.0015, ease: [0, 0.003], loose: [0, 0], bridge: 22, bridgeSlope: 2, smooth: 6 },
          wrinkle: { k: 0.12, wl: 0.035 },
        },
      ],
    },
    details: 'underwear',
  },
];

/** Leg opening of briefs: high on the hip and at the front, covering the buttocks at the back. */
function briefLegs(k, side) {
  return k.legMax('leg' + side, side, (front) => {
    const back = Math.max(0, -front);
    return 0.035 + 0.17 * back * back - 0.02 * Math.max(0, front);
  });
}

/** Bralette: under-bust band all around + cups in front, shaped top edge. */
function braShape(k) {
  const L = k.land, bi = k.bi;
  const yU = L.underBust, yB = L.bust;
  return k.custom('band', (v, x, y, z) => {
    const cz = bi.cz(y);
    const fr = Math.max(0, Math.min(1, (z - cz + 0.02) / 0.07));
    const ax = Math.abs(x);
    // cup top: low at the centre gore, rising to the strap anchors
    const cupTop = yB + 0.012 + 0.65 * Math.max(0, ax - 0.015) - 0.45 * Math.max(0, ax - 0.09);
    const top = (yU + 0.012) * (1 - fr) + cupTop * fr;
    return Math.min(y - (yU - 0.03), top - y);
  });
}

/**
 * Shoe volume: extra room around the toes (toe box) and over the instep;
 * `point` lengthens the toe for dress shoes.
 */
function toeBox(toe, top, point = 0) {
  return (c, i, P0, bi) => {
    const r = c.limb[i];
    if (r < 3) return 0;
    const a = c.aL[i];
    if (a < 2) return 0;
    const t = Math.min(1, Math.max(0, (a - 2.35) / 0.45));
    const y = P0[i * 3 + 1];
    return toe * t + top * Math.min(1, Math.max(0, (y - 0.03) / 0.04)) + point * Math.max(0, (a - 2.75) / 0.25);
  };
}

/** Dress shoes: oval opening on the instep. */
function instepOpening(k) {
  const bi = k.bi;
  return k.custom('opening', (v, x, y, z) => {
    let best = 1;
    for (const r of [3, 4]) {
      const a = bi.param[r - 1][v];
      if (a < 1.8) continue;
      // height above the sole and distance along the foot from the ankle
      const along = (a - 2) * bi.limbs[r].L[2];
      const h = y - 0.035;
      const e = (along / 0.075) ** 2 + Math.max(0, -h / 0.035) ** 2;
      best = Math.min(best, e - 1 + (h < 0 ? 1 : 0));
    }
    return best * 0.05;
  });
}

/** Skin weights of a long jacket hem blended towards the pelvis (no tearing when legs lift). */
function hemToPelvis(amount) {
  return (W, nb, boneLocal, c, bi, model) => {
    const pel = ['root', 'spine05'].map((n) => boneLocal.get(model.boneIndex.get(n))).filter((b) => b !== undefined);
    if (!pel.length) return;
    const isLeg = new Uint8Array(nb);
    for (const [bone, b] of boneLocal) if (/upperleg|lowerleg/.test(model.bones[bone].name)) isLeg[b] = 1;
    const yh = bi.land.hipJoint + 0.08;
    for (let i = 0; i < c.n; i++) {
      const y = c.P0[i * 3 + 1];
      if (y > yh) continue;
      const t = Math.min(1, (yh - y) / 0.12) * amount;
      const o = i * nb;
      let legs = 0;
      for (let b = 0; b < nb; b++) if (isLeg[b]) { legs += W[o + b] * t; W[o + b] *= 1 - t; }
      for (const b of pel) W[o + b] += legs / pel.length;
    }
  };
}

export const GARMENT_BY_ID = new Map(GARMENTS.map((g) => [g.id, g]));

/** Quick outfits per style (one tap). */
export const OUTFITS = [
  { id: 'casual', label: 'Casual', items: { F: ['tshirt', 'jeans', 'sneakers', 'underwear', 'socks'], M: ['tshirt', 'jeans', 'sneakers', 'underwear', 'socks'] } },
  { id: 'formal', label: 'Formale', items: { F: ['shirt', 'pencilskirt', 'blazer', 'dressshoes', 'underwear'], M: ['shirt', 'trousers', 'blazer', 'dressshoes', 'underwear', 'socks'] } },
  { id: 'sport', label: 'Sport/Action', items: { F: ['sporttop', 'leggings', 'sneakers', 'underwear', 'socks'], M: ['tank', 'sweatpants', 'sneakers', 'underwear', 'socks'] } },
  { id: 'street', label: 'Street', items: { F: ['sweatshirt', 'cargo', 'boots', 'underwear', 'socks'], M: ['sweatshirt', 'cargo', 'boots', 'underwear', 'socks'] } },
  { id: 'under', label: 'Solo intimo', items: { F: ['underwear'], M: ['underwear'] } },
];

/** Default outfit of new characters. */
export function defaultOutfit(sex) {
  const ids = sex === 'M' ? ['tshirt', 'jeans', 'sneakers', 'underwear', 'socks'] : ['tshirt', 'jeans', 'sneakers', 'underwear', 'socks'];
  return ids.map((id) => newItem(id, sex));
}

const DEFAULT_COLORS = { F: { tshirt: '#f1efe9', jeans: '#3b5577', sneakers: '#f2f2f0' }, M: { tshirt: '#2b3a55', jeans: '#2a3a55', sneakers: '#f2f2f0' } };

export function newItem(id, sex = 'F') {
  const g = GARMENT_BY_ID.get(id);
  return { id, color: DEFAULT_COLORS[sex]?.[id] || g.color, fit: 0.5, wrinkles: 1 };
}

/** Garments available for a sex. */
export function garmentsFor(sex, cat) {
  return GARMENTS.filter((g) => (!g.sex || g.sex === sex) && (!cat || g.cat === cat));
}
