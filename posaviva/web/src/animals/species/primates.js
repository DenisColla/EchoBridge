// Primates (gorilla, chimpanzee: knuckle-walking stance at rest) and the
// kangaroo (upright on its hind legs and tail). Same bone names as the
// quadrupeds, so the shared controls / poses machinery applies; the labels
// and the ready poses come from their own families ('primate', 'macropod').
import { quadruped, horn } from './quadruped.js';
import { mkCoat, sstep } from './coat.js';
import { mx, V } from './builder.js';

const furApe = { type: 'long', scale: 10, normalScale: 0.32, roughness: 0.88, sheen: 0.35 };
const furRoo = { type: 'short', scale: 12, normalScale: 0.2, roughness: 0.84, sheen: 0.35 };

function apeHead(B, c, { brow = 1, crest = 0 } = {}) {
  const { hp, HL, HW } = c;
  B.ell(hp(0.42, 0.06), [HW * 0.48 * brow, 0.08 * HL, 0.11 * HL], { bones: ['head'], part: 'head', k: 0.04 * HL, axes: c.HX });
  if (crest) B.ell(hp(0.15, 0.3), [0.05 * HL, 0.14 * HL * crest, 0.3 * HL], { bones: ['head'], part: 'head', k: 0.08 * HL, axes: c.HX });
}

function apeSkin(face = 1) {
  return (v, lm) => {
    // bare face, palms and soles (region 'skin')
    let w = 0;
    if (v.part === 'muzzle' || v.part === 'nose' || v.part === 'jaw') w = face;
    if (v.part === 'head') w = sstep(0.25, 0.75, v.n[2] * 0.9 + v.n[1] * 0.1) * face * 0.9;
    if (v.part === 'eyelid') w = face;
    if (v.part === 'ear') w = 0.85;
    if (v.part === 'finger' || v.part === 'toe') w = 0.8;
    if ((v.part === 'hand' || v.part === 'foot') && v.n[1] < -0.2) w = 0.9;
    return w;
  };
}

export const PRIMATES = [
  {
    id: 'gorilla', label: 'Gorilla', group: 'esotici', family: 'primate', gait: 'knuckle', tris: 26000,
    build: () => quadruped({
      H: 1.25,
      torsoLoft: [[-0.46, 0.64, 0.12, 0.1, 0.1], [-0.38, 0.66, 0.2, 0.16, 0.16], [-0.24, 0.7, 0.24, 0.2, 0.2], [-0.06, 0.76, 0.27, 0.22, 0.24], [0.12, 0.82, 0.3, 0.24, 0.26], [0.26, 0.86, 0.31, 0.22, 0.24], [0.38, 0.88, 0.25, 0.16, 0.16], [0.44, 0.88, 0.14, 0.1, 0.1]],
      torsoUp: [0, 1, -0.3], torsoCaps: [0.9, 0.6],
      hip: [0.15, 0.62, -0.34], knee: [0.24, 0.4, -0.12], hock: [0.2, 0.08, -0.3], hpaw: [0.2, 0.04, -0.17],
      scap: [0.16, 1.0, 0.16], shoulder: [0.3, 0.92, 0.28], elbow: [0.33, 0.52, 0.3], wrist: [0.31, 0.16, 0.34], fpaw: [0.31, 0.04, 0.38],
      spine: [[-0.24, 0.8], [0.0, 0.92], [0.22, 1.0]],
      tailBase: [-0.44, 0.66], tail: { bones: 0, len: 0.01 },
      neck: { base: [0.4, 0.98], ang: 18, len: 0.1, w0: 0.18, h0: 0.18, w1: 0.15, h1: 0.15 },
      head: {
        len: 0.34, pitch: 0, w: 0.8, cranium: [0.4, 0.38],
        muzzle: [[0.55, 0.36, 0.03, 0.32], [0.72, 0.28, 0.05, 0.28], [0.86, 0.2, 0.05, 0.22], [0.92, 0.15, 0.04, 0.16]], muzzleCap: 0.6,
        jaw: [[0.25, 0.3, 0.32], [0.6, 0.22, 0.28], [0.88, 0.15, 0.18]], slitY: -0.16, slitA: [0.62, 0.96],
        nose: { a: 0.8, b: 0.2, w: 0.2, h: 0.11, d: 0.08, nostril: 0.05 },
        eye: { a: 0.56, b: 0.3, x: 0.17, r: 0.045, dir: [0.15, 0.0, 0.99], open: 0.6 }, canine: 0.1, cheekA: 0.55,
      },
      ear: { type: 'round', len: 0.12, w: 0.13, a: 0.32, b: 0.15, x: 0.42, face: 0.9, ang: 60 },
      fore: [[0, 0.1, 0.1, 0.1], [1, 0.12, 0.12, 0.12], [1.5, 0.1, 0.1, 0.1], [2, 0.08, 0.075, 0.08], [2.4, 0.09, 0.085, 0.08], [3, 0.065, 0.06, 0.06], [3.5, 0.06, 0.05, 0.05]],
      hind: [[0, 0.12, 0.12, 0.13], [0.5, 0.11, 0.1, 0.11], [1, 0.075, 0.07, 0.075], [1.4, 0.075, 0.07, 0.08], [2, 0.055, 0.05, 0.05], [2.5, 0.055, 0.05, 0.05]],
      foot: { type: 'knuckle', size: 1.15 }, hindFoot: { type: 'ape', size: 1.1 },
      thighW: 0.9, thighD: 0.75, tricepsD: 1.0, scapW: 1.3, blend: 1.3,
      extras: (B, c) => { apeHead(B, c, { brow: 1.1, crest: 1.3 }); const { H } = c; B.ell([0, 0.96 * H, 0.18 * H], [0.26 * H, 0.14 * H, 0.2 * H], { bones: ['chest', 'neck1'], part: 'torso', k: 0.1 * H }); },
    }),
    coat: mkCoat({ pattern: { type: 'saddle', amount: 0 }, extra: { fn: (v, lm) => ((v.part === 'torso') && v.p[2] < 0.1 * lm.H ? sstep(0.2, 0.7, v.n[1]) * sstep(0.3 * lm.H, -0.1 * lm.H, v.p[2]) : 0) }, shade: 0.35, shadeFreq: 30 }),
    skinFn: apeSkin(1),
    fur: furApe, iris: '#3a2212', pupil: 'round', teethColor: '#e9e0c8',
    palettes: [
      { id: 'dorso', label: 'Dorso argentato', colors: { base: '#1e1c1c', extra: '#8f8c88', skin: '#1a1817', nose: '#141212', pad: '#1a1817' } },
      { id: 'nero', label: 'Nero', colors: { base: '#1a1818', extra: '#262322', skin: '#151313', nose: '#121010', pad: '#151313' } },
      { id: 'bruno', label: 'Bruno', colors: { base: '#3a2a22', extra: '#4a3a30', skin: '#1d1816', nose: '#141212', pad: '#1d1816' } },
    ],
  },
  {
    id: 'scimpanze', label: 'Scimpanzé', group: 'esotici', family: 'primate', gait: 'knuckle', tris: 24000,
    build: () => quadruped({
      H: 0.82,
      torsoLoft: [[-0.4, 0.66, 0.1, 0.09, 0.09], [-0.32, 0.68, 0.17, 0.14, 0.14], [-0.2, 0.72, 0.2, 0.17, 0.17], [-0.03, 0.78, 0.22, 0.19, 0.2], [0.13, 0.84, 0.23, 0.2, 0.21], [0.26, 0.88, 0.22, 0.18, 0.18], [0.36, 0.9, 0.17, 0.12, 0.12], [0.42, 0.9, 0.1, 0.08, 0.08]],
      torsoUp: [0, 1, -0.3], torsoCaps: [0.9, 0.6],
      hip: [0.13, 0.64, -0.3], knee: [0.2, 0.42, -0.08], hock: [0.17, 0.08, -0.26], hpaw: [0.17, 0.04, -0.13],
      scap: [0.13, 1.0, 0.16], shoulder: [0.24, 0.92, 0.26], elbow: [0.27, 0.52, 0.27], wrist: [0.25, 0.15, 0.31], fpaw: [0.25, 0.04, 0.35],
      spine: [[-0.2, 0.8], [0.0, 0.9], [0.2, 0.98]],
      tailBase: [-0.38, 0.66], tail: { bones: 0, len: 0.01 },
      neck: { base: [0.38, 0.98], ang: 22, len: 0.12, w0: 0.14, h0: 0.14, w1: 0.11, h1: 0.11 },
      head: {
        len: 0.3, pitch: 2, w: 0.7, cranium: [0.3, 0.33],
        muzzle: [[0.48, 0.3, 0.03, 0.26], [0.68, 0.24, 0.06, 0.24], [0.88, 0.2, 0.07, 0.2], [0.99, 0.16, 0.06, 0.15]], muzzleCap: 0.6,
        jaw: [[0.25, 0.24, 0.26], [0.62, 0.17, 0.22], [0.95, 0.12, 0.15]], slitY: -0.17, slitA: [0.62, 1.04],
        nose: { a: 0.78, b: 0.18, w: 0.1, h: 0.06, d: 0.06, nostril: 0.03 },
        eye: { a: 0.48, b: 0.27, x: 0.16, r: 0.055, dir: [0.18, 0.0, 0.98], open: 0.7 }, canine: 0.08, cheekA: 0.48,
      },
      ear: { type: 'round', len: 0.22, w: 0.22, a: 0.34, b: 0.14, x: 0.4, face: 0.95, ang: 75 },
      fore: [[0, 0.08, 0.08, 0.08], [1, 0.09, 0.09, 0.09], [1.5, 0.075, 0.075, 0.075], [2, 0.06, 0.055, 0.06], [2.4, 0.065, 0.06, 0.06], [3, 0.045, 0.04, 0.04], [3.5, 0.045, 0.04, 0.04]],
      hind: [[0, 0.1, 0.1, 0.11], [0.5, 0.09, 0.085, 0.09], [1, 0.06, 0.055, 0.06], [1.4, 0.06, 0.055, 0.065], [2, 0.042, 0.04, 0.04], [2.5, 0.042, 0.04, 0.04]],
      foot: { type: 'knuckle', size: 1.0 }, hindFoot: { type: 'ape', size: 1.05 },
      thighW: 0.85, thighD: 0.7, scapW: 1.1, blend: 1.2,
      extras: (B, c) => apeHead(B, c, { brow: 1.0, crest: 0 }),
    }),
    coat: mkCoat({ shade: 0.35, shadeFreq: 30 }),
    skinFn: apeSkin(1),
    fur: furApe, iris: '#5a3618', pupil: 'round', teethColor: '#e9e0c8',
    palettes: [
      { id: 'nero', label: 'Nero', colors: { base: '#1d1b1a', skin: '#c9a48c', nose: '#8a6a5a', pad: '#3a2e28' } },
      { id: 'scuro', label: 'Viso scuro', colors: { base: '#1d1b1a', skin: '#3a2e28', nose: '#2a2220', pad: '#2a2220' } },
    ],
  },
  {
    id: 'canguro', label: 'Canguro', group: 'esotici', family: 'macropod', gait: 'hopper', tris: 23000,
    build: () => quadruped({
      H: 1.0,
      torsoLoft: [[-0.42, 0.36, 0.1, 0.1, 0.1], [-0.32, 0.42, 0.19, 0.15, 0.17], [-0.17, 0.55, 0.19, 0.15, 0.17], [-0.06, 0.7, 0.16, 0.12, 0.14], [0.02, 0.83, 0.13, 0.1, 0.11], [0.06, 0.93, 0.09, 0.08, 0.08]],
      torsoUp: [0, 0.45, -1], torsoCaps: [0.8, 0.5],
      hip: [0.13, 0.42, -0.24], knee: [0.17, 0.34, 0.05], hock: [0.12, 0.05, -0.3], hpaw: [0.12, 0.03, 0.06],
      scap: [0.07, 0.86, 0.0], shoulder: [0.11, 0.8, 0.08], elbow: [0.12, 0.64, 0.1], wrist: [0.11, 0.55, 0.22], fpaw: [0.11, 0.5, 0.26],
      spine: [[-0.2, 0.5], [-0.07, 0.68], [0.02, 0.86]],
      tailBase: [-0.36, 0.38], tail: { len: 1.0, r: 0.075, carry: -24, curl: 22, taper: 0.8, bones: 6 },
      neck: { base: [0.07, 0.92], ang: 72, len: 0.16, w0: 0.08, h0: 0.08, w1: 0.06, h1: 0.065 },
      head: {
        len: 0.25, pitch: 18, w: 0.52, cranium: [0.27, 0.32],
        muzzle: [[0.42, 0.3, 0.02, 0.18], [0.62, 0.24, 0.03, 0.15], [0.84, 0.2, 0.03, 0.12], [0.97, 0.18, 0.02, 0.11]],
        jaw: [[0.2, 0.18, 0.16], [0.55, 0.12, 0.12], [0.9, 0.08, 0.08]], slitA: [0.62, 1.0],
        nose: { a: 0.98, b: 0.03, w: 0.09, h: 0.07, d: 0.05, nostril: 0.022 },
        eye: { a: 0.38, b: 0.25, x: 0.2, r: 0.07, dir: [0.7, 0.2, 0.69], open: 0.7 }, canine: 0,
      },
      ear: { type: 'erect', len: 0.6, w: 0.24, ang: 18, a: 0.18, b: 0.3, x: 0.16, face: 0.5 },
      fore: [[0, 0.03, 0.04, 0.04], [1, 0.04, 0.04, 0.045], [2, 0.03, 0.03, 0.03], [3, 0.022, 0.022, 0.02], [4, 0.02, 0.02, 0.02]],
      hind: [[0, 0.12, 0.15, 0.16], [0.5, 0.11, 0.12, 0.13], [1, 0.06, 0.06, 0.06], [1.5, 0.045, 0.04, 0.05], [2, 0.03, 0.03, 0.035], [2.5, 0.032, 0.025, 0.03], [3, 0.032, 0.025, 0.03]],
      foot: { type: 'paw', size: 0.45, claws: true }, hindFoot: { type: 'plantigrade', size: 0.9, clawK: 0.6 },
      thighW: 1.4, thighD: 1.4, tricepsD: 0.4, scapW: 0.5,
    }),
    coat: mkCoat({ under: { amount: 0.85 }, muzzle: 0.0, extra: { muzzle: 0.5 }, tailTip: 0.0, shade: 0.3 }),
    fur: furRoo, iris: '#2a1a10', pupil: 'round',
    palettes: [
      { id: 'rosso', label: 'Rosso', colors: { base: '#a8603a', under: '#e6d6c2', extra: '#e6d6c2', nose: '#2a2220' } },
      { id: 'grigio', label: 'Grigio', colors: { base: '#8a817a', under: '#d6cfc6', extra: '#d6cfc6', nose: '#2a2220' } },
    ],
  },
];
void horn; void mx; void V;
