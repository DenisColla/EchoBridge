// Crocodile and tortoise (quadruped archetype with sprawling legs, a long
// flat snout full of teeth / a domed shell). Family 'reptile'
// (families/reptile.js): quadruped controls, reptile ready poses.
import { quadruped, horn } from './quadruped.js';
import { sstep, fbm, clamp01, cells, R as REG } from './coat.js';
import { mx, V } from './builder.js';

// ------------------------------------------------------------------ crocodile
const CROC = {
  H: 0.38,
  torso: [[-2.0, 0.82, 0.42, 0.3, 0.45], [-1.65, 0.92, 0.3, 0.5, 0.42], [-1.1, 0.98, 0.24, 0.66, 0.4], [-0.4, 1.0, 0.22, 0.74, 0.4], [0.35, 0.99, 0.24, 0.72, 0.4], [0.95, 0.95, 0.3, 0.6, 0.42], [1.45, 0.86, 0.4, 0.44, 0.45]],
  torsoCaps: [0.5, 0.6],
  hip: [0.42, 0.6, -1.45], knee: [1.02, 0.5, -1.22], hock: [1.1, 0.14, -1.55], hpaw: [1.12, 0.045, -1.25],
  scap: [0.38, 0.75, 0.98], shoulder: [0.52, 0.56, 1.12], elbow: [0.98, 0.46, 0.92], wrist: [1.0, 0.12, 1.22], fpaw: [1.02, 0.045, 1.38],
  spine: [[-1.0, 0.72], [0.0, 0.75], [0.9, 0.72]], tailBase: [-1.95, 0.62],
  neck: { base: [1.4, 0.62], ang: 2, len: 0.75, w0: 0.42, h0: 0.3, w1: 0.36, h1: 0.24 },
  head: {
    len: 1.75, pitch: 3, w: 0.44, cranium: [0.16, 0.26],
    muzzle: [[0.28, 0.16, 0.02, 0.24], [0.45, 0.12, 0.02, 0.19], [0.68, 0.095, 0.02, 0.145], [0.88, 0.09, 0.02, 0.13], [0.99, 0.08, 0.02, 0.11]], muzzleCap: 0.5,
    jaw: [[0.12, 0.15, 0.26], [0.45, 0.08, 0.19], [0.75, 0.06, 0.14], [0.97, 0.055, 0.11]], slitY: -0.05, slitA: [0.1, 1.0],
    nose: { a: 0.95, b: -0.045, w: 0.05, h: 0.03, d: 0.04, nostril: 0.014 },
    eye: { a: 0.2, b: 0.22, x: 0.12, r: 0.032, dir: [0.45, 0.75, 0.45], open: 0.75, protrude: 0.5 }, canine: 0, cheekA: 0.22,
  },
  ear: { type: 'none' },
  fore: [[0, 0.2, 0.2, 0.2], [0.6, 0.2, 0.2, 0.2], [1, 0.14, 0.14, 0.15], [1.5, 0.12, 0.12, 0.12], [2, 0.1, 0.1, 0.1], [2.5, 0.1, 0.09, 0.09], [3, 0.08, 0.07, 0.07], [3.5, 0.08, 0.06, 0.06]],
  hind: [[0, 0.28, 0.28, 0.28], [0.5, 0.22, 0.22, 0.22], [1, 0.15, 0.15, 0.16], [1.5, 0.12, 0.12, 0.12], [2, 0.1, 0.09, 0.09], [2.5, 0.1, 0.08, 0.08]],
  foot: { type: 'plantigrade', size: 1.25, clawK: 0.6 },
  tail: { len: 4.6, r: 0.36, taper: 0.94, carry: -5, curl: -3, bones: 10 },
  blend: 1.2, thighW: 1.4, thighD: 0.9, tricepsD: 0.8, scapW: 0.9, legR: 1,
  extras: (B, c) => {
    const { H, hp, HL, tailPts } = c;
    // osteoderms: rows of scutes along the back and the double crest of the tail
    for (let i = 0; i < 12; i++) {
      const z = (-1.7 + i * 0.27) * H;
      for (const x of [0.12, 0.3]) B.sym((sx) => B.ell([sx * x * H, 0.99 * H - x * x * 0.4 * H, z], [0.07 * H, 0.06 * H, 0.1 * H], { bones: ['hips', 'spine1', 'spine2', 'chest'], part: 'scute', k: 0.04 * H }));
    }
    for (let i = 1; i < tailPts.length - 1; i++) {
      const p = tailPts[i], r = 0.36 * H * (1 - 0.94 * (i / (tailPts.length - 1)));
      const bone = 'tail' + Math.min(10, i + 1);
      for (const sx of i < 6 ? [1, -1] : [0]) B.ell([p[0] + sx * r * 0.45, p[1] + r * 0.95, p[2]], [r * 0.16, r * 0.38, r * 0.4], { bones: [bone, 'tail' + i], part: 'scute', k: r * 0.15 });
    }
    // raised orbits and the teeth rows (upper teeth overlap the lower jaw outside)
    B.sym((sx) => B.ell(mx(hp(0.2, 0.2, 0.12 * HL), sx), [0.055 * HL, 0.04 * HL, 0.07 * HL], { bones: ['head'], part: 'head', k: 0.025 * HL, axes: c.HX }));
    const MW = [[0.28, 0.24], [0.45, 0.19], [0.68, 0.145], [0.88, 0.13], [0.99, 0.11]];
    const muzW = (a) => { for (let i = 0; i < MW.length - 1; i++) if (a <= MW[i + 1][0]) { const t = Math.max(0, (a - MW[i][0]) / (MW[i + 1][0] - MW[i][0])); return MW[i][1] + (MW[i + 1][1] - MW[i][1]) * t; } return MW[MW.length - 1][1]; };
    for (let i = 0; i < 15; i++) {
      const a = 0.2 + i * 0.052;
      const w = muzW(a) * HL * 0.97;
      const len = (i === 3 || i === 13 ? 0.045 : 0.03) * HL;
      for (const sx of [1, -1]) {
        B.tooth('head', mx(hp(a, -0.045, w), sx), mx(hp(a + 0.004, -0.045 - len / HL, w * 1.02), sx), len * 0.3);
        B.tooth('jaw', mx(hp(a + 0.025, -0.055, w * 0.9), sx), mx(hp(a + 0.025, -0.055 + (len * 0.85) / HL, w * 0.92), sx), len * 0.28);
      }
    }
    void horn;
  },
};

function crocCoat(v, lm) {
  const p = v.p, H = lm.H;
  const m = { under: REG.under(v, { torso: 0.05, neck: 0.1, legs: 0.2, soft: 0.4 }), pattern: 0, points: 0, extra: 0, shade: 0.5 + 0.2 * fbm(p[0] * 30 / H, p[1] * 30 / H, p[2] * 30 / H, 3, 5) };
  if (v.part === 'jaw') m.under = sstep(0.1, -0.5, v.n[1]);
  // darker bands across the back and tail, scutes
  m.pattern = sstep(0.55, 0.8, Math.sin(p[2] / H * 2.2 + fbm(p[0] * 4 / H, 0, p[2] * 4 / H, 2, 3) * 1.5)) * (1 - m.under) * 0.7;
  if (v.part === 'scute') m.points = 0.6;
  const c = cells([p[0] * 2, p[1] * 2, p[2]], 9 / H, 3);
  m.extra = sstep(0.06, 0.02, c.d2 - c.d1) * 0.5 * (1 - m.under * 0.5);
  if (v.part === 'tail') m.pattern = Math.max(m.pattern, sstep(0.5, 0.7, Math.sin(v.t * 22)) * (1 - m.under) * 0.8);
  for (const k of ['under', 'pattern', 'points', 'extra']) m[k] = clamp01(m[k]);
  return m;
}

// ------------------------------------------------------------------ tortoise
const TORT = {
  H: 0.3,
  torso: [[-0.98, 0.55, 0.3, 0.38, 0.2], [-0.82, 0.86, 0.2, 0.64, 0.2], [-0.45, 1.02, 0.17, 0.8, 0.2], [0.0, 1.06, 0.17, 0.84, 0.2], [0.45, 1.01, 0.19, 0.8, 0.2], [0.8, 0.86, 0.23, 0.64, 0.2], [0.97, 0.6, 0.3, 0.42, 0.2]],
  torsoCaps: [0.5, 0.5],
  hip: [0.46, 0.34, -0.6], knee: [0.62, 0.26, -0.55], hock: [0.64, 0.13, -0.66], hpaw: [0.64, 0.045, -0.64],
  scap: [0.38, 0.46, 0.6], shoulder: [0.54, 0.36, 0.72], elbow: [0.7, 0.3, 0.7], wrist: [0.68, 0.11, 0.8], fpaw: [0.68, 0.045, 0.82],
  spine: [[-0.4, 0.62], [0.05, 0.64], [0.45, 0.62]], tailBase: [-0.9, 0.34],
  neck: { base: [0.86, 0.42], ang: 16, len: 0.58, w0: 0.2, h0: 0.2, w1: 0.15, h1: 0.15 },
  head: {
    len: 0.44, pitch: 10, w: 0.74, cranium: [0.3, 0.34],
    muzzle: [[0.45, 0.3, 0.03, 0.28], [0.66, 0.24, 0.05, 0.22], [0.84, 0.17, 0.07, 0.15]], muzzleCap: 0.4,
    jaw: [[0.2, 0.18, 0.28], [0.55, 0.12, 0.21], [0.82, 0.09, 0.13]], slitY: -0.14, slitA: [0.42, 0.9], slitTilt: -0.04,
    nose: { a: 0.86, b: 0.02, w: 0.05, h: 0.035, d: 0.025, nostril: 0.022 },
    eye: { a: 0.38, b: 0.2, x: 0.27, r: 0.07, dir: [0.85, 0.22, 0.48], open: 0.72 }, canine: 0,
  },
  ear: { type: 'none' },
  fore: [[0, 0.14, 0.14, 0.14], [1, 0.14, 0.14, 0.15], [2, 0.14, 0.15, 0.14], [3, 0.15, 0.17, 0.15], [4, 0.16, 0.16, 0.16]],
  hind: [[0, 0.15, 0.15, 0.15], [1, 0.14, 0.14, 0.14], [2, 0.13, 0.13, 0.13], [3, 0.14, 0.14, 0.14]],
  foot: { type: 'pillar', size: 1.45, nails: 5, nailSpread: 0.35 }, hindFoot: { nails: 4 },
  tail: { len: 0.3, r: 0.08, taper: 0.8, carry: -30, curl: 0, bones: 2 },
  blend: 1.2, thighW: 0.6, thighD: 0.6, tricepsD: 0.5, scapW: 0.5,
  extras: (B, c) => {
    const { H } = c;
    // marginal rim of the carapace and the flat plastron underneath
    B.loft([[-0.95, 0.36, 0.32], [-0.7, 0.3, 0.72], [-0.2, 0.28, 0.86], [0.3, 0.28, 0.86], [0.75, 0.3, 0.7], [0.96, 0.36, 0.32]].map(([z, y, w]) => ({ p: [0, y * H, z * H], w: w * H, ht: 0.04 * H, hb: 0.04 * H })), { bones: ['hips', 'spine1', 'spine2', 'chest'], part: 'rim', k: 0.05 * H, caps: [0.6, 0.6] });
    B.ell([0, 0.2 * H, 0], [0.7 * H, 0.06 * H, 0.9 * H], { bones: ['hips', 'spine1', 'spine2', 'chest'], part: 'plastron', k: 0.06 * H });
    // scute domes (subtle bumps) on the carapace
    const sc = [[0, 1.05, 0.0], [0, 1.0, 0.42], [0, 1.0, -0.42], [0, 0.9, 0.75], [0, 0.88, -0.75], [0.42, 0.88, 0.22], [0.42, 0.88, -0.22], [0.44, 0.82, 0.55], [0.44, 0.82, -0.55]];
    for (const [x, y, z] of sc) for (const sx of x ? [1, -1] : [1]) B.ell([sx * x * H, (y - 0.02) * H, z * H], [0.2 * H, 0.045 * H, 0.2 * H], { bones: ['hips', 'spine1', 'spine2', 'chest'], part: 'torso', k: 0.1 * H });
    // brow ridges: a stern reptile look
    B.sym((sx) => B.ell(mx(c.hp(0.36, 0.3, 0.22 * c.HL), sx), [0.06 * c.HL, 0.035 * c.HL, 0.1 * c.HL], { bones: ['head'], part: 'head', k: 0.03 * c.HL, axes: c.HX }));
  },
};

function tortCoat(v, lm) {
  const p = v.p, H = lm.H;
  const shell = v.part === 'torso' || v.part === 'rim' || v.part === 'plastron';
  const m = { under: 0, pattern: 0, points: 0, extra: 0, shade: 0.5 + 0.18 * fbm(p[0] * 40 / H, p[1] * 40 / H, p[2] * 40 / H, 3, 5) };
  if (shell) {
    // scutes: polygonal plates with dark seams (pattern) and growth rings (extra), lighter centres (under)
    const c = cells([p[0] * 1.15, p[1] * 0.5, p[2]], 2.6 / H, 9);
    m.pattern = sstep(0.07, 0.02, c.d2 - c.d1);
    m.extra = sstep(0.5, 0.8, Math.sin(c.d1 * 40)) * 0.35;
    m.under = sstep(0.35, 0.1, c.d1) * 0.6;
    if (v.part === 'plastron') { m.under = 0.4; m.points = 0.8; }
    if (v.part === 'rim') m.points = sstep(0.1, -0.5, v.n[1]) * 0.8;
  } else {
    // scaly skin; horny beak at the front of the jaws
    m.points = 1;
    if ((v.part === 'muzzle' || v.part === 'jaw') && v.p[2] > lm.nose[2] - 0.05 * H) { m.region = 'keratin'; m.regionW = 1; }
    m.under = REG.under(v, { torso: 0.2, neck: 0.1, legs: 0.3, soft: 0.5 }) * 0.5;
  }
  for (const k of ['under', 'pattern', 'points', 'extra']) m[k] = clamp01(m[k]);
  return m;
}

const scalesRough = { type: 'scales', scale: 7, normalScale: 0.55, roughness: 0.68, sheen: 0.05 };
void cells;

export const REPTILES = [
  {
    id: 'coccodrillo', label: 'Coccodrillo', group: 'rettili', family: 'reptile', gait: 'sprawl', tris: 22000, res: 620, blend: 0.1,
    heightLabel: 'Altezza circa',
    build: () => quadruped(CROC), coat: crocCoat, fur: scalesRough, iris: '#b89a3a', pupil: 'slit', teethColor: '#ebe4cc',
    palettes: [
      { id: 'nilo', label: 'Nilo', colors: { base: '#5a5e3a', under: '#c8c09a', pattern: '#33361f', points: '#3e4128', extra: '#2a2c18', keratin: '#2a2a22', nose: '#2a2a22', mouth: '#d8b8a0', pad: '#4a4a34', eyelid: '#4a4c30' } },
      { id: 'scuro', label: 'Scuro', colors: { base: '#3a3c30', under: '#a8a48c', pattern: '#22241c', points: '#2a2c22', extra: '#1a1c14', keratin: '#1e1e1a', nose: '#1e1e1a', mouth: '#d0b098', pad: '#2a2c22', eyelid: '#2a2c22' } },
      { id: 'albino', label: 'Chiaro', colors: { base: '#c8c0a0', under: '#ece6d0', pattern: '#a89e7a', points: '#b0a888', extra: '#9a9070', keratin: '#8a8270', nose: '#8a8270', mouth: '#e0b8a8', pad: '#b0a888', eyelid: '#b0a888' } },
    ],
  },
  {
    id: 'tartaruga', label: 'Tartaruga', sub: 'Testuggine', group: 'rettili', family: 'reptile', gait: 'tortoise', tris: 18000, res: 420, blend: 0.05,
    heightLabel: 'Altezza circa', limits: { rigidBack: true },
    build: () => quadruped(TORT), coat: tortCoat, fur: { type: 'wrinkle', scale: 7, normalScale: 0.5, roughness: 0.62, sheen: 0.05 }, iris: '#3a2a1a', pupil: 'round',
    palettes: [
      { id: 'terra', label: 'Terra', colors: { base: '#8a6a3a', under: '#c8a060', pattern: '#2a1e12', points: '#6e6250', extra: '#5a4428', keratin: '#3a3228', nose: '#2a2420', mouth: '#6a4a44', pad: '#5a5040', eyelid: '#5a5040' } },
      { id: 'scura', label: 'Scura', colors: { base: '#4a3e30', under: '#6a5a42', pattern: '#1a1612', points: '#5a5248', extra: '#2a221a', keratin: '#2a2420', nose: '#1e1a18', mouth: '#906860', pad: '#3a342c', eyelid: '#3a342c' } },
      { id: 'gialla', label: 'Gialla', colors: { base: '#b8902e', under: '#e0c060', pattern: '#1a1410', points: '#7a6e58', extra: '#3a2a10', keratin: '#3a3228', nose: '#2a2420', mouth: '#a07870', pad: '#5a5040', eyelid: '#5a5040' } },
    ],
  },
];
void V;
