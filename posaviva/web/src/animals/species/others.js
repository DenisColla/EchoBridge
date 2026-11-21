// Rabbit, bear, elephant, rhinoceros (quadruped archetype with special feet / heads).
import { quadruped, horn } from './quadruped.js';
import { mkCoat, sstep } from './coat.js';
import { mx, V } from './builder.js';

const furShort = { type: 'short', scale: 16, normalScale: 0.2, roughness: 0.84, sheen: 0.4 };
const furLong = { type: 'long', scale: 8, normalScale: 0.32, roughness: 0.88, sheen: 0.4 };
const skinWrinkle = { type: 'wrinkle', scale: 3.2, normalScale: 0.7, roughness: 0.82, sheen: 0.05 };

export const OTHERS = [
  {
    id: 'coniglio', label: 'Coniglio', group: 'domestici', family: 'quadruped', gait: 'plantigrade', tris: 18000,
    build: () => quadruped({
      H: 0.2,
      torso: [[-0.92, 0.7, 0.24, 0.24], [-0.8, 0.95, 0.14, 0.36], [-0.55, 1.03, 0.1, 0.4], [-0.25, 1.0, 0.12, 0.39], [0.05, 0.9, 0.16, 0.34], [0.3, 0.8, 0.22, 0.28], [0.5, 0.7, 0.3, 0.2]],
      torsoCaps: [0.9, 0.6],
      hip: [0.24, 0.45, -0.58], knee: [0.3, 0.32, -0.25], hock: [0.26, 0.07, -0.78], hpaw: [0.27, 0.04, -0.42],
      scap: [0.18, 0.78, 0.18], shoulder: [0.22, 0.48, 0.38], elbow: [0.22, 0.3, 0.28], wrist: [0.2, 0.08, 0.42], fpaw: [0.2, 0.035, 0.5],
      spine: [[-0.45, 0.62], [-0.1, 0.62], [0.2, 0.62]], tailBase: [-0.92, 0.55],
      neck: { base: [0.42, 0.62], ang: 32, len: 0.2, w0: 0.28, h0: 0.32, w1: 0.24, h1: 0.27 },
      head: {
        len: 0.56, pitch: 22, w: 0.66, cranium: [0.32, 0.34],
        muzzle: [[0.5, 0.33, 0.03, 0.24], [0.7, 0.27, 0.05, 0.21], [0.88, 0.21, 0.05, 0.16], [0.97, 0.16, 0.03, 0.11]],
        jaw: [[0.25, 0.2, 0.2], [0.6, 0.1, 0.13], [0.9, 0.06, 0.07]], slitY: -0.18, slitA: [0.75, 1.0],
        nose: { a: 0.97, b: 0.03, w: 0.06, h: 0.05, d: 0.035, nostril: 0.014 },
        eye: { a: 0.42, b: 0.33, x: 0.24, r: 0.1, dir: [0.9, 0.25, 0.36], open: 0.8 }, canine: 0,
      },
      ear: { type: 'erect', len: 1.1, w: 0.19, ang: 7, tiltZ: -0.28, a: 0.24, b: 0.44, x: 0.12, face: 0.75, mid: 1.15 },
      fore: [[0, 0.06, 0.12, 0.1], [1, 0.09, 0.1, 0.12], [2, 0.06, 0.06, 0.06], [3, 0.045, 0.045, 0.04], [4, 0.04, 0.035, 0.035]],
      hind: [[0, 0.2, 0.26, 0.28], [0.5, 0.18, 0.2, 0.22], [1, 0.1, 0.1, 0.1], [1.6, 0.07, 0.05, 0.06], [2, 0.06, 0.04, 0.05], [2.6, 0.06, 0.04, 0.05], [3, 0.06, 0.04, 0.05]],
      foot: { type: 'paw', size: 0.9, claws: false },
      hindFoot: { type: 'plantigrade', size: 0.75, clawK: 0.3 },
      tail: { len: 0.14, r: 0.11, carry: 40, curl: 0, taper: 0.2, bones: 1 },
      thighW: 1.8, thighD: 1.8, tricepsD: 0.6, scapW: 0.8,
    }),
    coat: mkCoat({ under: 0.7, extra: { tailTip: 0.01 }, shade: 0.3 }),
    fur: furShort, iris: '#3a2212', pupil: 'round',
    palettes: [
      { id: 'grigio', label: 'Selvatico', colors: { base: '#8a7a68', under: '#e6dfd2', extra: '#f2eee6', nose: '#b88a86' } },
      { id: 'bianco', label: 'Bianco', colors: { base: '#efebe5', under: '#f6f3ee', extra: '#f6f3ee', nose: '#d9a5a0', iris: '#b8443e' } },
      { id: 'nero', label: 'Nero', colors: { base: '#2a2725', under: '#3a3634', extra: '#3a3634', nose: '#4a3a38' } },
      { id: 'fulvo', label: 'Fulvo', colors: { base: '#c08a52', under: '#ecd9bc', extra: '#f2eee6', nose: '#b88a86' } },
    ],
  },
  {
    id: 'orso', label: 'Orso', group: 'selvatici', family: 'quadruped', gait: 'plantigrade', tris: 25000,
    build: () => quadruped({
      H: 1.0,
      torso: [[-0.74, 0.82, 0.4, 0.12], [-0.64, 0.93, 0.33, 0.24], [-0.42, 0.95, 0.3, 0.28], [-0.12, 0.95, 0.3, 0.3], [0.14, 1.0, 0.33, 0.3], [0.34, 1.05, 0.36, 0.28], [0.5, 0.98, 0.41, 0.24], [0.62, 0.84, 0.47, 0.16]],
      hip: [0.17, 0.6, -0.52], knee: [0.2, 0.35, -0.36], hock: [0.17, 0.1, -0.6], hpaw: [0.17, 0.05, -0.42],
      scap: [0.15, 0.95, 0.25], shoulder: [0.21, 0.6, 0.48], elbow: [0.22, 0.4, 0.38], wrist: [0.2, 0.1, 0.44], fpaw: [0.2, 0.05, 0.56],
      spine: [[-0.35, 0.8], [0.0, 0.82], [0.3, 0.88]], tailBase: [-0.72, 0.74],
      neck: { base: [0.58, 0.78], ang: 12, len: 0.3, w0: 0.24, h0: 0.28, w1: 0.17, h1: 0.2 },
      head: {
        len: 0.42, pitch: 12, w: 0.72, cranium: [0.28, 0.32],
        muzzle: [[0.45, 0.3, 0.02, 0.2], [0.62, 0.23, 0.03, 0.15], [0.82, 0.19, 0.03, 0.12], [0.97, 0.17, 0.02, 0.1]],
        jaw: [[0.2, 0.18, 0.2], [0.55, 0.12, 0.13], [0.9, 0.09, 0.08]], slitA: [0.55, 1.02],
        nose: { a: 0.985, b: 0.03, w: 0.085, h: 0.07, d: 0.05, nostril: 0.02 },
        eye: { a: 0.42, b: 0.23, x: 0.22, r: 0.035, dir: [0.42, 0.12, 0.9], open: 0.6 }, canine: 0.1,
      },
      ear: { type: 'round', len: 0.15, w: 0.16, a: 0.2, b: 0.42, x: 0.32 },
      fore: [[0, 0.05, 0.1, 0.08], [0.5, 0.09, 0.12, 0.12], [1, 0.1, 0.12, 0.14], [1.5, 0.095, 0.1, 0.13], [2, 0.085, 0.09, 0.09], [2.4, 0.08, 0.09, 0.075], [3, 0.07, 0.065, 0.06], [3.5, 0.07, 0.06, 0.06]],
      hind: [[0, 0.13, 0.16, 0.2], [0.45, 0.12, 0.13, 0.16], [1, 0.085, 0.08, 0.1], [1.4, 0.075, 0.07, 0.1], [2, 0.065, 0.06, 0.07], [2.5, 0.065, 0.055, 0.06]],
      foot: { type: 'plantigrade', size: 1.45, clawK: 1.1 },
      tail: { len: 0.1, r: 0.05, carry: -60, curl: 0, taper: 0.4, bones: 1 },
      blend: 1.25, thighW: 1.2, thighD: 1.1,
      extras: (B, c) => { const { H } = c; B.ell([0, 0.98 * H, 0.32 * H], [0.18 * H, 0.12 * H, 0.2 * H], { bones: ['chest', 'spine2'], part: 'torso', k: 0.1 * H, noise: { amp: 0.012 * H, freq: 12 / H, seed: 3 } }); },
    }),
    coat: mkCoat({ under: 0.2, muzzle: 0.5, legs: [0.15, 0.4], shade: 0.45, shadeFreq: 30 }),
    fur: furLong, iris: '#3a2414', pupil: 'round', teethColor: '#eee4cc',
    palettes: [
      { id: 'bruno', label: 'Bruno', colors: { base: '#5e4128', under: '#6e5034', points: '#3a2818', nose: '#1d1816', keratin: '#3a3029' } },
      { id: 'nero', label: 'Nero', colors: { base: '#1f1c1b', under: '#262220', points: '#8a6a48', nose: '#141212', keratin: '#2a2523' } },
      { id: 'polare', label: 'Polare', colors: { base: '#ece6d6', under: '#f2eee2', points: '#e6dfcc', nose: '#181616', keratin: '#3a3530' } },
    ],
  },
  {
    id: 'elefante', label: 'Elefante', group: 'esotici', family: 'quadruped', gait: 'graviportal', tris: 27000,
    build: () => quadruped({
      H: 2.9,
      torso: [[-0.55, 0.86, 0.5, 0.12], [-0.46, 0.96, 0.42, 0.22], [-0.3, 0.98, 0.38, 0.26], [-0.1, 0.96, 0.36, 0.27], [0.12, 0.98, 0.38, 0.27], [0.3, 1.0, 0.42, 0.25], [0.44, 0.95, 0.47, 0.21], [0.54, 0.82, 0.52, 0.14]],
      hip: [0.15, 0.68, -0.38], knee: [0.16, 0.42, -0.31], hock: [0.14, 0.17, -0.38], hpaw: [0.14, 0.04, -0.35],
      scap: [0.15, 0.92, 0.26], shoulder: [0.18, 0.66, 0.4], elbow: [0.18, 0.47, 0.34], wrist: [0.165, 0.16, 0.36], fpaw: [0.165, 0.04, 0.38],
      spine: [[-0.22, 0.86], [0.04, 0.86], [0.26, 0.9]], tailBase: [-0.54, 0.84],
      neck: { base: [0.5, 0.8], ang: 28, len: 0.13, w0: 0.2, h0: 0.26, w1: 0.19, h1: 0.24 },
      head: {
        len: 0.4, pitch: 72, w: 0.78, cranium: [0.4, 0.34],
        muzzle: [[0.42, 0.42, 0.04, 0.26], [0.62, 0.36, 0.04, 0.22], [0.78, 0.3, 0.03, 0.18]], muzzleCap: 0.6,
        jaw: [[0.25, 0.2, 0.2], [0.55, 0.14, 0.12], [0.75, 0.08, 0.08]], slitY: -0.12, slitA: [0.62, 0.86],
        nose: null, eye: { a: 0.26, b: 0.28, x: 0.34, r: 0.035, dir: [0.9, 0.1, 0.42], open: 0.6 }, canine: 0, cheekA: 0.32,
      },
      ear: { type: 'flap', len: 1.55, w: 1.25, th: 0.035, a: 0.08, b: 0.3, x: 0.42 },
      fore: [[0, 0.06, 0.09, 0.08], [0.5, 0.1, 0.11, 0.12], [1, 0.11, 0.11, 0.12], [1.5, 0.1, 0.1, 0.1], [2, 0.095, 0.095, 0.095], [3, 0.085, 0.085, 0.085], [3.6, 0.088, 0.088, 0.088], [4, 0.09, 0.09, 0.09]],
      hind: [[0, 0.13, 0.14, 0.16], [0.5, 0.12, 0.12, 0.13], [1, 0.1, 0.1, 0.1], [2, 0.085, 0.085, 0.085], [2.6, 0.087, 0.087, 0.087], [3, 0.09, 0.09, 0.09]],
      foot: { type: 'pillar', size: 1.05, nails: 4 },
      hindFoot: { nails: 3 },
      tail: { len: 0.4, r: 0.025, carry: -84, curl: 0, taper: 0.4, bones: 4, tuft: 0.03 },
      blend: 1.3, thighW: 1.3, thighD: 1.0,
      extras: (B, c) => {
        const { hp, HL, H } = c;
        // trunk: a bone chain hanging from the upper lip
        const n = 6, pts = [];
        let p = hp(0.72, 0.12), dir = V.norm([0, -0.25, 1]);
        const total = 0.75 * H;
        pts.push(p);
        for (let i = 1; i <= n; i++) {
          const a = (i / n) * 1.25;
          dir = V.norm([0, -Math.sin(0.25 + a), Math.cos(0.25 + a) * 0.6]);
          p = V.add(p, V.mul(dir, total / n));
          pts.push(p);
        }
        for (let i = 0; i < n; i++) B.bone('trunk' + (i + 1), i ? 'trunk' + i : 'head', pts[i], pts[i + 1]);
        B.loft(pts.map((q, i) => { const r = (0.075 - 0.05 * (i / n)) * H; return { p: q, w: r, ht: r * 0.95, hb: r * 0.95 }; }),
          { bones: pts.slice(0, n).map((_, i) => 'trunk' + (i + 1)), part: 'trunk', k: 0.05 * H, caps: [0.5, 0.4], res: 5 });
        B.ell(V.add(pts[n], V.mul(dir, 0.0)), [0.032 * H, 0.032 * H, 0.02 * H], { op: 'sub', k: 0.01 * H, mat: 'nose' });
        // tusks from the upper jaw, curving forward and up
        B.sym((sx) => horn(B, [mx(hp(0.6, 0.1, 0.2 * HL), sx), mx(hp(0.88, 0.3, 0.23 * HL), sx), mx(hp(1.08, 0.58, 0.21 * HL), sx), mx(hp(1.14, 0.85, 0.15 * HL), sx)], [0.06 * HL, 0.055 * HL, 0.042 * HL, 0.012 * HL], ['head'], { part: 'tusk' }));
      },
    }),
    coat: mkCoat({ under: 0.2, shade: 0.25, shadeFreq: 20 }),
    fur: skinWrinkle, iris: '#3a2618', pupil: 'round',
    palettes: [
      { id: 'grigio', label: 'Grigio', colors: { base: '#7c7772', under: '#86817c', keratin: '#e6dbc4', nose: '#5a5550' } },
      { id: 'fango', label: 'Fangoso', colors: { base: '#8a6e58', under: '#8e7460', keratin: '#e1d3b6', nose: '#5a4a40' } },
    ],
  },
  {
    id: 'rinoceronte', label: 'Rinoceronte', group: 'esotici', family: 'quadruped', gait: 'graviportal', tris: 25000,
    build: () => quadruped({
      H: 1.7,
      torso: [[-0.72, 0.88, 0.46, 0.12], [-0.62, 0.97, 0.38, 0.25], [-0.42, 0.98, 0.33, 0.29], [-0.16, 0.95, 0.3, 0.3], [0.1, 0.98, 0.32, 0.29], [0.3, 1.03, 0.36, 0.27], [0.46, 0.98, 0.4, 0.23], [0.58, 0.84, 0.45, 0.15]],
      hip: [0.18, 0.64, -0.52], knee: [0.2, 0.42, -0.4], hock: [0.16, 0.2, -0.58], hpaw: [0.16, 0.05, -0.54],
      scap: [0.16, 0.92, 0.3], shoulder: [0.21, 0.6, 0.5], elbow: [0.21, 0.42, 0.4], wrist: [0.185, 0.18, 0.44], fpaw: [0.185, 0.05, 0.46],
      spine: [[-0.3, 0.82], [0.02, 0.84], [0.3, 0.9]], tailBase: [-0.7, 0.85],
      neck: { base: [0.56, 0.74], ang: -2, len: 0.2, w0: 0.24, h0: 0.3, w1: 0.2, h1: 0.24 },
      head: {
        len: 0.48, pitch: 38, w: 0.55, cranium: [0.25, 0.3],
        muzzle: [[0.38, 0.32, 0.03, 0.22], [0.6, 0.26, 0.03, 0.2], [0.85, 0.22, 0.04, 0.2], [0.98, 0.21, 0.04, 0.21]], muzzleCap: 0.3,
        jaw: [[0.2, 0.22, 0.2], [0.55, 0.14, 0.16], [0.92, 0.1, 0.18]], slitY: -0.18, slitA: [0.62, 1.0],
        nose: { a: 0.97, b: 0.06, w: 0.08, h: 0.06, d: 0.03, nostril: 0.03 },
        eye: { a: 0.42, b: 0.25, x: 0.24, r: 0.03, dir: [0.85, 0.15, 0.5], open: 0.6 }, canine: 0,
      },
      ear: { type: 'erect', len: 0.3, w: 0.15, ang: 25, a: 0.05, b: 0.3, x: 0.2, face: 0.6, mid: 1.0 },
      fore: [[0, 0.06, 0.1, 0.09], [0.5, 0.1, 0.12, 0.13], [1, 0.11, 0.12, 0.14], [1.5, 0.1, 0.1, 0.12], [2, 0.09, 0.09, 0.09], [3, 0.075, 0.075, 0.075], [4, 0.08, 0.08, 0.08]],
      hind: [[0, 0.14, 0.15, 0.19], [0.5, 0.13, 0.13, 0.15], [1, 0.1, 0.1, 0.11], [2, 0.08, 0.08, 0.08], [3, 0.08, 0.08, 0.08]],
      foot: { type: 'pillar', size: 0.82, nails: 3, nailSpread: 0.6 },
      tail: { len: 0.32, r: 0.025, carry: -84, curl: 0, taper: 0.4, bones: 3, tuft: 0.03 },
      blend: 1.3, thighW: 1.3,
      extras: (B, c) => {
        const { hp, HL, H } = c;
        horn(B, [hp(0.9, 0.12), hp(0.9, 0.4), hp(0.82, 0.68), hp(0.72, 0.86)], [0.12 * HL, 0.085 * HL, 0.05 * HL, 0.012 * HL], ['head'], { part: 'horn' });
        horn(B, [hp(0.68, 0.18), hp(0.67, 0.32), hp(0.63, 0.42)], [0.08 * HL, 0.05 * HL, 0.015 * HL], ['head'], { part: 'horn' });
        // skin folds at the shoulder and the flank
        B.sym((sx) => {
          B.ell([sx * 0.26 * H, 0.66 * H, 0.38 * H], [0.05 * H, 0.26 * H, 0.06 * H], { bones: ['chest', 'scapula' + (sx > 0 ? '.L' : '.R')], part: 'torso', k: 0.06 * H });
          B.ell([sx * 0.25 * H, 0.6 * H, -0.4 * H], [0.05 * H, 0.22 * H, 0.06 * H], { bones: ['hips'], part: 'torso', k: 0.06 * H });
        });
      },
    }),
    coat: mkCoat({ under: 0.2, shade: 0.25, shadeFreq: 20 }),
    fur: skinWrinkle, iris: '#2a1c14', pupil: 'round',
    palettes: [
      { id: 'grigio', label: 'Grigio', colors: { base: '#8a857e', under: '#938e87', keratin: '#6e655c', nose: '#5a5550' } },
      { id: 'scuro', label: 'Scuro', colors: { base: '#5a5652', under: '#625e5a', keratin: '#4a433e', nose: '#3a3634' } },
    ],
  },
];
