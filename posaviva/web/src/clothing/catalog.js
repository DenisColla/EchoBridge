// Garment catalog (Italian labels). Each definition tells the builder where
// the fabric is (mask constraints over body coordinates, see build.js), how it
// fits (thickness, ease, looseness, hang), how its edges are finished
// (hems, rib bands, collars, lapels), its fabric, static folds and wrinkle
// character. Torso heights use the body coordinate T (body.js):
//   0 crotch, 1 hip joint, 2 waist, 3 bust/chest, 4 shoulder joint, 5 neck base
// limb params: arm 0 shoulder .. 1 elbow .. 2 wrist, leg 0 hip .. 1 knee .. 2 ankle .. 3 toes.
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

/** Static fold presets */
const cuffBunch = (near, amp = 0.0025, width = 0.09, wl = 0.028) => ({ type: 'rings', region: 'arm', near, width, amp, wl });
const ankleStack = (near, amp = 0.004, width = 0.12, wl = 0.04) => ({ type: 'rings', region: 'leg', near, width, amp, wl });
const backSlack = (amp = 0.0025) => ({ type: 'rings', region: 'torso', near: 'hem', width: 0.13, amp, wl: 0.045, sector: [Math.PI, 1.3] });

export const GARMENTS = [
  // ------------------------------------------------------------------ tops
  {
    id: 'tshirt', label: 'T-shirt', cat: 'top', slot: 'top', layer: 3, styles: ['casual', 'sport'], icon: 'tshirt',
    fabric: 'jersey', color: '#f1efe9', palette: PAL.basic,
    mask: (k) => [k.above('hem', k.y(0.85)), crew(k), ...sleeves(k, 0.42), HEAD(k)],
    bands: { neck: { h: 0.017 } },
    edges: { neck: { type: 'hem', r: 0.0022 }, default: { type: 'hem' } },
    fit: { thickness: 0.0022, ease: [0.001, 0.022], loose: [0.1, 0.8], slope: [0.6, 0.15], bridgeSlope: 0.55, bridge: 16, smooth: 16 },
    wrinkle: { k: 0.75, wl: 0.055, wlArm: 0.034 },
    folds: [backSlack(0.002), { type: 'rings', region: 'arm', near: ['sleeveL', 'sleeveR'], width: 0.05, amp: 0.0012, wl: 0.03 }],
    weightBlend: hemToPelvis(0.95),
    details: 'tshirt',
  },
  {
    id: 'tank', label: 'Canotta', cat: 'top', slot: 'top', layer: 3, styles: ['casual', 'sport'], icon: 'tank',
    fabric: 'jersey', color: '#e9e6df', palette: PAL.basic,
    mask: (k) => [
      k.above('hem', k.y(0.45)),
      k.neckline('neck', { front: 0.11, back: 0.06, width: k.bi.neckRadius + 0.03, shape: 'scoop' }),
      k.armhole('armholeL', 'L', { inset: 0.045, drop: 0.03, rx: 0.05, ry: 0.08 }),
      k.armhole('armholeR', 'R', { inset: 0.045, drop: 0.03, rx: 0.05, ry: 0.08 }),
      ARMS(k), HEAD(k),
    ],
    edges: { default: { type: 'hem', r: 0.0018 } },
    fit: { thickness: 0.002, ease: [0.0008, 0.018], loose: [0.05, 0.7], slope: [0.7, 0.2], bridgeSlope: 0.6, bridge: 16, smooth: 8 },
    wrinkle: { k: 0.6, wl: 0.052 },
    folds: [backSlack(0.0015)],
    weightBlend: hemToPelvis(0.95),
    details: 'tank',
  },
  {
    id: 'longsleeve', label: 'Maglia a maniche lunghe', cat: 'top', slot: 'top', layer: 3, styles: ['casual', 'sport'], icon: 'longsleeve',
    fabric: 'jersey', color: '#2b3a55', palette: PAL.basic,
    mask: (k) => [k.above('hem', k.y(0.85)), crew(k, 0.06, 0.018, 0.016), ...sleeves(k, 1.97), HEAD(k), k.exclude('hands', ['handL', 'handR'], 0.5)],
    bands: { neck: { h: 0.016 }, sleeveL: { h: 0.035 }, sleeveR: { h: 0.035 } },
    edges: { default: { type: 'hem' } },
    fit: { thickness: 0.0024, ease: [0.0012, 0.02], loose: [0.1, 0.75], slope: [0.6, 0.15], bridgeSlope: 0.55, bridge: 16, smooth: 8 },
    wrinkle: { k: 0.85, wl: 0.055, wlArm: 0.032 },
    folds: [backSlack(0.002), cuffBunch(['sleeveL', 'sleeveR'], 0.0032, 0.12, 0.03)],
    weightBlend: hemToPelvis(0.95),
    details: 'plainKnit',
  },
  {
    id: 'sweatshirt', label: 'Felpa', cat: 'top', slot: 'top', layer: 3, styles: ['casual', 'sport'], icon: 'sweatshirt',
    fabric: 'fleece', color: '#8a8d93', palette: PAL.basic,
    mask: (k) => [k.above('hem', k.y(0.28)), crew(k, 0.055, 0.015, 0.014), ...sleeves(k, 1.96), HEAD(k), k.exclude('hands', ['handL', 'handR'], 0.5)],
    bands: { hem: { h: 0.06 }, sleeveL: { h: 0.06 }, sleeveR: { h: 0.06 }, neck: { h: 0.022 } },
    edges: { default: { type: 'hem', r: 0.003 } },
    fit: { thickness: 0.0048, ease: [0.008, 0.03], loose: [0.5, 1.0], slope: [0.35, 0.06], bridgeSlope: 0.45, bridge: 18, wSmooth: 3, smooth: 16 },
    wrinkle: { k: 1.0, wl: 0.07, wlArm: 0.042, kt: 0.25 },
    folds: [cuffBunch(['sleeveL', 'sleeveR'], 0.006, 0.16, 0.042), { type: 'rings', region: 'torso', near: 'hem', width: 0.13, amp: 0.004, wl: 0.05 }],
    weightBlend: hemToPelvis(0.95),
    details: 'sweatshirt',
  },
  {
    id: 'trackjacket', label: 'Felpa con zip', cat: 'top', slot: 'outer', layer: 4, styles: ['sport', 'casual'], icon: 'trackjacket',
    fabric: 'tricot', color: '#2c5aa0', palette: PAL.sport, trim: '#f2f2f2',
    mask: (k) => [k.above('hem', k.y(0.3)), crew(k, 0.04, 0.0, 0.03), ...sleeves(k, 1.96), HEAD(k), k.exclude('hands', ['handL', 'handR'], 0.5)],
    bands: { hem: { h: 0.045 }, sleeveL: { h: 0.05 }, sleeveR: { h: 0.05 } },
    edges: { neck: { type: 'collar', at: () => ({ stand: 0.04, flap: 0.0, lift: 0 }) }, default: { type: 'hem', r: 0.0028 } },
    fit: { thickness: 0.0035, ease: [0.006, 0.026], loose: [0.4, 0.9], slope: [0.4, 0.1], bridgeSlope: 0.45, bridge: 18, wSmooth: 3, smooth: 16 },
    wrinkle: { k: 0.9, wl: 0.065, wlArm: 0.04 },
    folds: [cuffBunch(['sleeveL', 'sleeveR'], 0.005, 0.14, 0.04), { type: 'crease', region: 'torso', theta: 0, amp: 0.0018, halfWidth: 0.004 }],
    hardware: { zipper: true },
    weightBlend: hemToPelvis(0.95),
    details: 'trackjacket',
  },
  {
    id: 'shirt', label: 'Camicia', cat: 'top', slot: 'top', layer: 1, styles: ['formal', 'casual'], icon: 'shirt',
    fabric: 'poplin', color: '#f4f4f2', palette: ['#f4f4f2', '#a9c4e0', '#e9dccb', '#ffffff', '#2b3a55', '#d9a6a6', '#8a9a78', '#1d1f24'],
    mask: (k) => [k.above('hem', k.y(0.08)), crew(k, 0.07, 0.008, 0.012), ...sleeves(k, 1.97), HEAD(k), k.exclude('hands', ['handL', 'handR'], 0.5)],
    bands: { sleeveL: { h: 0.06 }, sleeveR: { h: 0.06 } },
    edges: {
      neck: { type: 'collar', at: (q) => ({ stand: 0.032, flap: 0.045 + 0.03 * Math.max(0, Math.cos(q.theta)) ** 6, lift: 0.006, skip: Math.abs(q.theta) < 0.12 }) },
      default: { type: 'hem', r: 0.0016 },
    },
    fit: { thickness: 0.0018, ease: [0.003, 0.025], loose: [0.2, 0.8], slope: [0.6, 0.15], bridgeSlope: 0.45, bridge: 16, smooth: 8 },
    wrinkle: { k: 0.85, wl: 0.052, wlArm: 0.034, kt: 0.45 },
    folds: [cuffBunch(['sleeveL', 'sleeveR'], 0.0035, 0.13, 0.03), { type: 'crease', region: 'torso', theta: 0, amp: 0.0014, halfWidth: 0.006 }, backSlack(0.003)],
    hardware: { shirtButtons: true },
    weightBlend: hemToPelvis(0.8),
    details: 'shirt',
  },
  {
    id: 'blazer', label: 'Giacca / blazer', cat: 'top', slot: 'outer', layer: 4, styles: ['formal'], icon: 'blazer',
    fabric: 'wool', color: '#2f3a4f', palette: PAL.formal,
    mask: (k) => [
      k.above('hem', k.y(-0.05)),
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
      thickness: 0.005, ease: [0.005, 0.018], loose: [0.25, 0.6], slope: [0.35, 0.12], bridgeSlope: 0.45, bridge: 20, wSmooth: 3, smooth: 20,
      // structured shoulders: a little padding on top of the shoulders
      offset: (c, i, P0, bi) => { const y = P0[i * 3 + 1], x = Math.abs(P0[i * 3]); return 0.004 * Math.max(0, 1 - Math.abs(y - bi.land.shoulder - 0.02) / 0.06) * Math.max(0, 1 - Math.abs(x - bi.land.shoulderX + 0.02) / 0.07); },
    },
    weightBlend: hemToPelvis(0.6),
    wrinkle: { k: 0.7, wl: 0.07, wlArm: 0.042, kt: 0.3 },
    folds: [cuffBunch(['sleeveL', 'sleeveR'], 0.004, 0.12, 0.04)],
    hardware: { blazerButtons: true },
    details: 'blazer',
  },
  {
    id: 'sporttop', label: 'Top sportivo', cat: 'top', slot: 'top', layer: 3, styles: ['sport'], sex: 'F', icon: 'sporttop',
    fabric: 'lycra', color: '#1d1f24', palette: PAL.sport,
    mask: (k) => [
      k.above('hem', k.land.underBust - 0.045),
      k.neckline('neck', { front: 0.1, back: 0.09, width: k.bi.neckRadius + 0.035, shape: 'scoop', backShape: 'scoop' }),
      k.armhole('armholeL', 'L', { inset: 0.06, drop: 0.035, rx: 0.06, ry: 0.09 }),
      k.armhole('armholeR', 'R', { inset: 0.06, drop: 0.035, rx: 0.06, ry: 0.09 }),
      ARMS(k), HEAD(k),
    ],
    bands: { hem: { h: 0.035 } },
    edges: { default: { type: 'hem', r: 0.002 } },
    fit: { thickness: 0.002, ease: [0.0, 0.006], loose: [0, 0.1], bridge: 26, smooth: 20, bridgeSlope: 0.9 },
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
    fit: { thickness: 0.003, ease: [0.0015, 0.026], loose: [0.0, 0.6], slope: [1.4, 0.3], bridge: 12 },
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
    fit: { thickness: 0.0028, ease: [0.004, 0.028], loose: [0.4, 0.9], slope: [0.35, 0.08], innerSlope: 1.6, bridge: 14 },
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
      thickness: 0.0045, ease: [0.006, 0.03], loose: [0.5, 1.0], slope: [0.5, 0.12], innerSlope: 1.6, bridge: 16, wSmooth: 3,
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
    fit: { thickness: 0.0035, ease: [0.006, 0.03], loose: [0.55, 1.0], slope: [0.4, 0.1], innerSlope: 1.6, bridge: 14, wSmooth: 3 },
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
    fit: { thickness: 0.003, ease: [0.004, 0.03], loose: [0.3, 0.9], slope: [0.8, 0.2], innerSlope: 1.6, bridge: 12 },
    wrinkle: { k: 0.8, wl: 0.055 },
    details: 'shorts',
  },
  {
    id: 'leggings', label: 'Leggings', cat: 'bottom', slot: 'bottom', layer: 2, styles: ['sport', 'casual'], icon: 'leggings',
    fabric: 'lycra', color: '#1d1f24', palette: PAL.sport,
    mask: (k) => [k.below('waist', k.y(1.95)), ...legs(k, 1.9), ARMS(k), FEET(k)],
    bands: { waist: { h: 0.04 } },
    edges: { default: { type: 'hem', r: 0.0015 } },
    fit: { thickness: 0.0014, ease: [0.0, 0.004], loose: [0, 0.05], bridge: 8, bridgeSlope: 2, smooth: 4 },
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
          k.above('hem', k.y(1.45)),
          k.neckline('neck', { front: 0.12, back: 0.08, width: k.bi.neckRadius + 0.03, shape: 'scoop' }),
          k.armhole('armholeL', 'L', { inset: 0.05, drop: 0.025, rx: 0.05, ry: 0.08 }),
          k.armhole('armholeR', 'R', { inset: 0.05, drop: 0.025, rx: 0.05, ry: 0.08 }),
          ARMS(k), HEAD(k),
        ],
        edges: { hem: { type: 'none' }, default: { type: 'hem', r: 0.0018 } },
        fit: { thickness: 0.002, ease: [0.001, 0.012], loose: [0.0, 0.3], slope: [1.4, 0.6], bridge: 20 },
        wrinkle: { k: 0.7, wl: 0.055 },
      },
      {
        kind: 'skirt',
        skirt: (bi, fit) => ({ top: bi.yOfT(2.0), hem: bi.joint('lowerleg01.L')[1] + 0.02, ease: 0.004 + fit * 0.01, flare: 0.08 + fit * 0.2, taper: 0.0, drape: { count: 9, amp: 0.016 + fit * 0.01 }, loose: 0.35, band: 0.0, segs: 96 }),
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
    fit: { thickness: 0.003, ease: [0.003, 0.008], loose: [0, 0], bridge: 30, wSmooth: 4, smooth: 24, offset: toeBox(0.007, 0.004), finalSmooth: 10, envelope: 1 },
    subdiv: 0,
    wrinkle: { k: 0.15, wl: 0.03 },
    details: 'sneakers',
  },
  {
    id: 'dressshoes', label: 'Scarpe eleganti', cat: 'shoes', slot: 'shoes', layer: 1, styles: ['formal'], icon: 'dressshoes',
    fabric: 'leather', color: '#1b1b1c', palette: PAL.shoes, sole: { color: '#3a2a20', top: 0.014, below: 0.005, welt: 0.004 },
    mask: (k) => [lowerLegs(k, 2.03, 0.75), k.only('feetonly', ['legL', 'footL', 'legR', 'footR'], 0.5), instepOpening(k)],
    edges: { default: { type: 'hem', r: 0.0022, depth: 0.01 } },
    fit: { thickness: 0.0025, ease: [0.002, 0.006], loose: [0, 0], bridge: 34, wSmooth: 4, smooth: 24, offset: toeBox(0.006, 0.002, 0.012), finalSmooth: 10, envelope: 1 },
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
    fit: { thickness: 0.004, ease: [0.004, 0.012], loose: [0, 0.3], bridge: 30, wSmooth: 4, smooth: 24, offset: toeBox(0.008, 0.005), finalSmooth: 10, envelope: 1 },
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
          fit: { thickness: 0.0012, ease: [0, 0.002], loose: [0, 0], bridge: 22, bridgeSlope: 2, smooth: 6 },
          wrinkle: { k: 0.12, wl: 0.03 },
        },
        {
          mask: (k) => [braShape(k), ARMS(k)],
          bands: { band: { h: 0.025 } },
          edges: { default: { type: 'hem', r: 0.0014 } },
          fit: { thickness: 0.0018, ease: [0.002, 0.004], loose: [0, 0], bridge: 30, bridgeSlope: 0.9, smooth: 30 },
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
